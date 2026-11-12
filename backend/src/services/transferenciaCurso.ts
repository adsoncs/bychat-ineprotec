// services/transferenciaCurso.ts
//
// TRANSFERÊNCIA DE CURSO (09/11/2026). O candidato se inscreve, paga, assina e logo
// depois quer outro curso. Decisões do cliente:
//   - o que foi EFETIVAMENTE recebido vira crédito na nova inscrição;
//   - vale o plano do curso novo, e o crédito abate primeiro a entrada (matrícula ou
//     1ª parcela). Se não cobrir, o aluno paga só o restante no portal;
//   - se sobrar, a sobra quita as PRÓXIMAS parcelas inteiras (a 1ª cobrança passa
//     para depois delas) e o resto, menor que uma parcela, é dividido nas restantes;
//   - contrato novo completo na nova inscrição; o antigo fica como estava;
//   - documentos do mesmo tipo vão junto com a mesma situação (aprovado segue aprovado):
//     ficam pendentes só os que o curso novo pede a mais.
//
// A inscrição antiga é encerrada ('cancelled' + `_transferidaPara`), sem apagar nada:
// pagamento, contrato e documentos dela continuam lá como histórico. A proposta
// (comissão) muda de inscrição junto, com a data e a forma da venda original.
//
// Nada aqui envia mensagem ao aluno: quem conduz a conversa é o agente.

import { copyFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join, extname } from 'path'
import crypto from 'crypto'
import { prisma } from '../lib/prisma.js'
import { registrarEventoDaInscricao } from './inscricaoAssistida.js'
import { logEvent } from './leadHistory.js'
import { requisitosDaCondicao } from './docCondicional.js'
import {
  baseDaForma, escolhaParaGravar, lerRegrasDoPlano, opcoesDoPlano, planosDaOferta, valorIntegral,
  type CondicaoNegociada, type FormasDePagamento, type PlanoDaOferta,
} from './planoFinanceiro.js'
import { vencimentoPrevisto } from './areaDoAluno.js'

const FECHADAS = ['cancelled', 'merged', 'expired']
/** Abaixo disso o gateway não emite cobrança: a diferença vai para as parcelas. */
export const MINIMO_COBRANCA_CENTAVOS = 500
const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export interface Operador { userId: number; nome: string }

// ─── Distribuição do crédito (pura, testável) ───────────────────────────────

export interface Distribuicao {
  caso: 'sem_credito' | 'reduz_entrada' | 'cobre_entrada'
  creditoCentavos: number
  /** Entrada do curso novo pela tabela (matrícula, ou 1ª parcela sem matrícula). */
  entradaTabelaCentavos: number
  /** O que o aluno ainda paga de entrada (0 quando o crédito cobre). */
  entradaAPagarCentavos: number
  /** Crédito usado na entrada. */
  creditoNaEntradaCentavos: number
  parcelasQuitadas: number
  parcelasRestantes: number
  /** Valor de cada parcela depois do crédito. */
  novaParcelaCentavos: number
  /** Crédito que não coube no curso novo. */
  sobraCentavos: number
  /** Diferença de centavos que ficou com o aluno pelo arredondamento (≥ 0). */
  arredondamentoCentavos: number
  totalCursoCentavos: number
  /** Total do curso novo descontado o crédito (o que o aluno ainda paga, somando tudo). */
  totalAPagarCentavos: number
  /** Valores a gravar (null = sem condição especial). */
  condicao: { taxaMatriculaCentavos: number; valorParcelaCentavos: number; numParcelas: number; mesesAdiante: number } | null
}

/**
 * Como o crédito entra no plano do curso novo. O plano é matrícula T + N parcelas de V
 * (sem matrícula, a entrada é a 1ª parcela).
 */
export function distribuirCredito(plano: { taxaMatriculaCentavos: number; valorParcelaCentavos: number; numParcelas: number }, creditoCentavos: number): Distribuicao {
  const T = Math.max(0, plano.taxaMatriculaCentavos)
  const V = Math.max(0, plano.valorParcelaCentavos)
  const N = Math.max(0, plano.numParcelas)
  const C = Math.max(0, Math.round(creditoCentavos))
  const E = T > 0 ? T : V
  // Sem matrícula, a entrada é a 1ª das N parcelas.
  const depois = T > 0 ? N : Math.max(0, N - 1)
  const totalCurso = T + V * N
  const base: Distribuicao = {
    caso: 'sem_credito', creditoCentavos: C, entradaTabelaCentavos: E, entradaAPagarCentavos: E, creditoNaEntradaCentavos: 0,
    parcelasQuitadas: 0, parcelasRestantes: depois, novaParcelaCentavos: V, sobraCentavos: 0, arredondamentoCentavos: 0,
    totalCursoCentavos: totalCurso, totalAPagarCentavos: totalCurso, condicao: null,
  }
  if (C <= 0 || E <= 0) return base

  // O crédito não cobre a entrada: ela fica menor e o aluno paga o restante.
  if (E - C >= MINIMO_COBRANCA_CENTAVOS) {
    return {
      ...base, caso: 'reduz_entrada', entradaAPagarCentavos: E - C, creditoNaEntradaCentavos: C,
      totalAPagarCentavos: totalCurso - C,
      condicao: { taxaMatriculaCentavos: E - C, valorParcelaCentavos: V, numParcelas: depois, mesesAdiante: 0 },
    }
  }

  // Cobre a entrada (ou falta menos que o mínimo do gateway, que vai para as parcelas).
  const L = C - E
  let k = 0
  let R = L
  if (L > 0 && V > 0) { k = Math.min(depois, Math.floor(L / V)); R = L - k * V }
  const n = depois - k
  let nova = V
  let sobra = 0
  let arred = 0
  if (n === 0) {
    sobra = Math.max(0, R)
  } else {
    // Arredonda a favor do aluno: no total ele paga no máximo o que deve.
    nova = Math.floor((n * V - R) / n)
    arred = n * V - R - n * nova
  }
  const aPagar = n * nova
  return {
    ...base, caso: 'cobre_entrada', entradaAPagarCentavos: 0, creditoNaEntradaCentavos: Math.min(C, E),
    parcelasQuitadas: k, parcelasRestantes: n, novaParcelaCentavos: nova, sobraCentavos: sobra, arredondamentoCentavos: arred,
    totalAPagarCentavos: aPagar,
    condicao: { taxaMatriculaCentavos: E, valorParcelaCentavos: n > 0 ? nova : V, numParcelas: n, mesesAdiante: k },
  }
}

// ─── O que já foi recebido ──────────────────────────────────────────────────

export interface Recebido { totalCentavos: number; itens: Array<{ rotulo: string; centavos: number }>; avisos: string[] }

/** Dinheiro que de fato entrou nesta inscrição (mais o crédito que ela já trouxe). */
export async function recebidoDaInscricao(registrationId: number): Promise<Recebido> {
  const reg = await prisma.enrollmentRegistration.findUnique({
    where: { id: registrationId },
    select: { id: true, paymentStatus: true, paymentAmount: true, paymentMethod: true, paymentPlan: true, formData: true },
  })
  const out: Recebido = { totalCentavos: 0, itens: [], avisos: [] }
  if (!reg) return out
  const pp = (reg.paymentPlan ?? {}) as Record<string, any>
  const fd = (reg.formData ?? {}) as Record<string, any>
  const somar = (rotulo: string, c: number) => { if (c > 0) { out.itens.push({ rotulo, centavos: c }); out.totalCentavos += c } }

  const veio = Number(fd._transferencia?.creditoCentavos) || 0
  if (veio > 0) somar(`Crédito trazido de ${fd._transferencia?.deCodigo ?? 'outra inscrição'}`, veio)

  const titulos = await prisma.enrollmentTitulo.findMany({
    where: { registrationId, valorPagoCentavos: { gt: 0 }, status: { in: ['paga', 'aberta', 'aguardando'] } },
    select: { origem: true, ordem: true, meio: true, valorPagoCentavos: true, acordoId: true },
    orderBy: { ordem: 'asc' },
  })
  for (const t of titulos) {
    somar(t.origem === 'acordo' ? `Acordo nº ${t.acordoId} · parcela ${t.ordem}` : `Pagamento combinado ${t.ordem} (${t.meio})`, t.valorPagoCentavos)
  }

  const metodo = String(reg.paymentMethod ?? '').toUpperCase()
  if (!pp.combinado && reg.paymentStatus === 'paid' && metodo !== 'ISENTO' && metodo !== 'CREDITO') {
    somar(pp.planoFinanceiro?.opcao === 'integral' ? 'Curso completo' : 'Entrada', Math.round(Number(reg.paymentAmount ?? 0) * 100))
  }
  if (reg.paymentStatus === 'refunded') out.avisos.push('O pagamento desta inscrição foi estornado e não entra no crédito.')

  // Parcelas que o aluno gerou no Meu Portal: a situação está no Asaas.
  const geradas = Object.entries((pp.parcelasPortal ?? {}) as Record<string, any>).filter(([, g]) => g?.id)
  if (geradas.length) {
    const { configDaInscricao } = await import('./pagamentoCombinado.js')
    const { consultarCobrancaAsaas, ASAAS_STATUS_MAP } = await import('./paymentAsaas.js')
    const cfg = await configDaInscricao(registrationId).catch(() => null)
    for (const [n, g] of geradas) {
      if (!cfg) { out.avisos.push(`Parcela ${n} do Meu Portal: sem conexão com o Asaas para conferir se foi paga.`); continue }
      const p = await consultarCobrancaAsaas(cfg, g.id).catch(() => null)
      if (!p) { out.avisos.push(`Parcela ${n} do Meu Portal: não foi possível consultar no Asaas.`); continue }
      if (ASAAS_STATUS_MAP[String(p.status)] === 'paid') somar(`Parcela ${n} (Meu Portal)`, Math.round(Number(p.value ?? g.valor ?? 0) * 100))
    }
  }

  const erp = await prisma.acaMatricula.count({ where: { enrollmentRegistrationId: registrationId } }).catch(() => 0)
  if (erp) out.avisos.push('Esta inscrição já virou matrícula no acadêmico: parcelas pagas lá não entram no crédito. Confira e ajuste o acadêmico.')
  return out
}

// ─── Prévia ─────────────────────────────────────────────────────────────────

export interface Alvo { portalId: number; offeringId: number; campusId?: number | null; planoId?: number | null; precoPor?: string | null }

// ─── Preço do curso novo (12/11/2026) ───────────────────────────────────────
// O plano tem um preço por forma de pagamento no curso completo (ex.: cartão
// 12x 149,90 = 1.798,80; boleto parcelado 12x 216,90 = 2.602,80). Antes a
// transferência usava sempre a tabela (preço-base) — quem tinha fechado no
// boleto ficava mais barato. Agora a equipe escolhe na tela; o padrão é a
// forma que o aluno usou na inscrição antiga.
export type PrecoPor = 'tabela' | 'cartao' | 'boletoParcelado' | 'boleto' | 'pix'
const ROTULO_DO_PRECO: Record<PrecoPor, string> = {
  tabela: 'Tabela do plano', cartao: 'Cartão', boletoParcelado: 'Boleto parcelado', boleto: 'Boleto à vista', pix: 'Pix à vista',
}

/** Preço do curso completo em cada forma ligada no plano (a tabela sempre entra). */
export function precosDoPlano(p: PlanoDaOferta): Array<{ chave: PrecoPor; rotulo: string; totalCentavos: number }> {
  const out: Array<{ chave: PrecoPor; rotulo: string; totalCentavos: number }> = [
    { chave: 'tabela', rotulo: ROTULO_DO_PRECO.tabela, totalCentavos: Math.round(valorIntegral(p) * 100) },
  ]
  if (!p.regras.integral.ativo) return out
  for (const forma of ['cartao', 'boletoParcelado', 'boleto', 'pix'] as const) {
    if (!p.regras.integral[forma]?.ativo) continue
    out.push({ chave: forma, rotulo: ROTULO_DO_PRECO[forma], totalCentavos: Math.round(baseDaForma(p, 'integral', forma) * 100) })
  }
  return out
}

/** O plano com as parcelas recalculadas para o total escolhido (matrícula, número e dia iguais). */
export function precificar(p: PlanoDaOferta, totalCentavos: number): PlanoDaOferta {
  if (p.numParcelas <= 0 || totalCentavos === Math.round(valorIntegral(p) * 100)) return p
  return { ...p, valorParcelaCentavos: Math.round((totalCentavos - p.taxaMatriculaCentavos) / p.numParcelas) }
}

/** A forma em que o aluno fechou a inscrição antiga — o padrão da escolha. */
function precoDaInscricaoAntiga(pp: Record<string, any>): PrecoPor {
  const meio = String(pp?.meio ?? '')
  if (meio === 'boleto') return Number(pp?.parcelas) > 1 ? 'boletoParcelado' : 'boleto'
  if (meio === 'pix') return 'pix'
  if (meio === 'credit_card' || meio === 'cartao') return 'cartao'
  return 'tabela'
}

async function lerInscricao(id: number) {
  return prisma.enrollmentRegistration.findUnique({
    where: { id },
    select: {
      id: true, candidateCode: true, status: true, portalId: true, leadId: true, formData: true, contratoAceite: true,
      paymentStatus: true, paymentPlan: true, vendedorUserId: true, processRegistrationId: true,
      utmSource: true, utmMedium: true, utmCampaign: true, fbclid: true, gclid: true, referrer: true,
      portal: { select: { id: true, nome: true, slug: true } },
      processRegistration: { select: { offeringId: true, offering: { select: { nome: true, course: { select: { nome: true } } } } } },
      documents: { orderBy: { uploadedAt: 'desc' } },
    },
  })
}
type Inscricao = NonNullable<Awaited<ReturnType<typeof lerInscricao>>>

async function exigidosDoProcesso(processoId: number, formData: unknown) {
  const sp: any = await prisma.selectionProcess.findUnique({
    where: { id: processoId },
    select: {
      useCustomDocuments: true,
      documentRequirements: { select: { required: true, condicao: true, documentType: { select: { code: true, name: true } } } },
      entryMode: { select: { documentRequirements: { select: { required: true, condicao: true, documentType: { select: { code: true, name: true } } } } } },
    },
  })
  if (!sp) return [] as Array<{ required: boolean; documentType: { code: string; name: string } }>
  const lista = sp.useCustomDocuments && sp.documentRequirements?.length ? sp.documentRequirements : (sp.entryMode?.documentRequirements ?? [])
  // Sem as dispensas da inscrição antiga: o curso novo é outra decisão.
  return requisitosDaCondicao(lista, { ...(formData as object), _dispensas: undefined }) as Array<{ required: boolean; documentType: { code: string; name: string } }>
}

/** Último envio de cada tipo. Reprovado não vai: o aluno precisa mandar de novo. */
function documentosParaLevar(reg: Inscricao, codigos: Set<string>) {
  const ultimo = new Map<string, Inscricao['documents'][number]>()
  for (const d of reg.documents) if (!ultimo.has(d.typeCode)) ultimo.set(d.typeCode, d)
  const levados = [...ultimo.values()].filter((d) => codigos.has(d.typeCode) && d.status !== 'rejected')
  const ficam = [...ultimo.values()].filter((d) => !codigos.has(d.typeCode))
  const reprovados = [...ultimo.values()].filter((d) => codigos.has(d.typeCode) && d.status === 'rejected')
  return { levados, ficam, reprovados }
}

/** Regras do plano sem preço próprio por forma: o preço passa a sair dos valores com crédito. */
function semPrecoProprio(p: PlanoDaOferta) {
  const sem = (f: FormasDePagamento): FormasDePagamento => ({
    pix: { ...f.pix, valorBase: null }, boleto: { ...f.boleto, valorBase: null },
    cartao: { ...f.cartao, valorBase: null }, boletoParcelado: { ...f.boletoParcelado, valorBase: null },
  })
  const r = lerRegrasDoPlano({ ...p.regras, entrada: { ...p.regras.entrada, ...sem(p.regras.entrada) }, integral: { ...p.regras.integral, ...sem(p.regras.integral) } })!
  return { entrada: r.entrada, integral: r.integral, pontualidade: r.pontualidade }
}

export async function previaDaTransferencia(deId: number, alvo: Alvo) {
  const bloqueios: string[] = []
  const avisos: string[] = []
  const reg = await lerInscricao(deId)
  if (!reg) return { ok: false as const, erro: 'Inscrição não encontrada.', status: 404 }
  if (FECHADAS.includes(reg.status)) bloqueios.push('Esta inscrição já está encerrada (cancelada, mesclada ou expirada).')
  if (!reg.leadId) bloqueios.push('A inscrição não tem ficha de lead.')

  const { ofertasDoPortal } = await import('../routes/matriculaInterna.js')
  const cat = await ofertasDoPortal(alvo.portalId)
  if (!cat) return { ok: false as const, erro: 'Portal não encontrado.', status: 404 }
  if (!cat.portal.active) bloqueios.push('O portal escolhido está desativado.')
  if (cat.portal.formMode === 'interest') bloqueios.push('O portal escolhido só capta interesse: não tem inscrição completa.')
  const oferta = cat.ofertas.find((o) => o.id === Number(alvo.offeringId))
  if (!oferta || !oferta.processoId) return { ok: false as const, erro: 'Curso inválido para este portal.', status: 400 }
  const polo = oferta.polos.length === 1 ? oferta.polos[0]! : oferta.polos.find((p) => p.id === Number(alvo.campusId)) ?? null
  if (oferta.polos.length > 1 && !polo) bloqueios.push('Escolha o polo.')
  if (reg.processRegistration?.offeringId === oferta.id && reg.portalId === alvo.portalId) bloqueios.push('A inscrição já é deste curso.')

  if (reg.leadId) {
    const pr = await prisma.processRegistration.findUnique({ where: { leadId_offeringId: { leadId: reg.leadId, offeringId: oferta.id } }, select: { id: true } })
    if (pr && pr.id !== reg.processRegistrationId) {
      const outra = await prisma.enrollmentRegistration.findFirst({ where: { processRegistrationId: pr.id, status: { notIn: FECHADAS } }, select: { candidateCode: true } })
      if (outra) bloqueios.push(`Esta pessoa já tem a inscrição ${outra.candidateCode} neste curso.`)
    }
  }
  const trocaPendente = await prisma.enrollmentTroca.count({ where: { registrationId: deId, status: 'PENDENTE' } })
  if (trocaPendente) bloqueios.push('Há uma troca de forma de pagamento aguardando o cartão: conclua ou cancele antes.')
  const acordo = await prisma.enrollmentTitulo.count({ where: { registrationId: deId, origem: 'acordo', status: { in: ['prevista', 'aberta'] } } })
  if (acordo) avisos.push('Há parcelas de acordo em aberto nesta inscrição: elas serão canceladas.')
  const sei = await prisma.seiEnvio.findUnique({ where: { registrationId: deId }, select: { status: true } }).catch(() => null)
  if (sei) avisos.push(`A inscrição já foi enviada ao SEI (${sei.status}): ajuste o curso lá também.`)

  // Financeiro. Portal que cobra só a taxa de inscrição: o crédito abate a taxa do processo novo.
  const recebido = await recebidoDaInscricao(deId)
  avisos.push(...recebido.avisos)
  const escopo = (await prisma.enrollmentPortal.findUnique({ where: { id: alvo.portalId }, select: { paymentScope: true } }))?.paymentScope === 'curso' ? 'curso' as const : 'taxa' as const
  const planos = escopo === 'curso' ? (await planosDaOferta(oferta.id)).filter((p) => opcoesDoPlano(p).length > 0) : []
  const planoBase = planos.find((p) => p.id === Number(alvo.planoId)) ?? planos[0] ?? null
  const precos = planoBase ? precosDoPlano(planoBase) : []
  const precoPadrao = ((): PrecoPor => { const x = precoDaInscricaoAntiga((reg.paymentPlan ?? {}) as any); return precos.some((q) => q.chave === x) ? x : 'tabela' })()
  const precoPor: PrecoPor = (precos.find((q) => q.chave === alvo.precoPor)?.chave) ?? precoPadrao
  const plano = planoBase ? precificar(planoBase, precos.find((q) => q.chave === precoPor)!.totalCentavos) : null
  const taxaCentavos = escopo === 'taxa'
    ? Math.round(Number((await prisma.selectionProcess.findUnique({ where: { id: oferta.processoId }, select: { taxaInscricao: true } }))?.taxaInscricao ?? 0) * 100)
    : 0
  if (escopo === 'curso' && !plano && recebido.totalCentavos > 0) bloqueios.push('O curso novo não tem plano de pagamento cadastrado: cadastre o plano para o crédito poder ser aplicado.')
  // Mesma forma da inscrição antiga: a 1ª paga com desconto de pontualidade
  // conta como parcela inteira (o desconto já foi concedido no boleto). Sem isso,
  // ao manter o preço do boleto o aluno passaria a "dever" o desconto (12/11/2026).
  const ppAntigo = (reg.paymentPlan ?? {}) as any
  const pontualidadeCentavos = plano && reg.paymentStatus === 'paid' && precoPor === precoPadrao && precoPor !== 'tabela'
    ? Math.max(0, Math.round(Number(ppAntigo.descontoPontualidade || 0) * 100)) : 0
  const dist = plano ? distribuirCredito(plano, recebido.totalCentavos + pontualidadeCentavos)
    : escopo === 'taxa' && taxaCentavos > 0 ? distribuirCredito({ taxaMatriculaCentavos: taxaCentavos, valorParcelaCentavos: 0, numParcelas: 0 }, recebido.totalCentavos)
    : null
  if (!dist && recebido.totalCentavos > 0 && escopo === 'taxa') {
    avisos.push(`O portal novo não cobra taxa: o crédito de ${brl(recebido.totalCentavos)} não tem onde entrar e fica como sobra para devolução.`)
  }
  if (dist?.sobraCentavos) avisos.push(`O crédito passa o valor do curso novo: sobram ${brl(dist.sobraCentavos)}, que não têm onde entrar. A devolução fica com a equipe (estorno no Asaas).`)
  if (dist?.caso === 'cobre_entrada' && dist.creditoCentavos < dist.entradaTabelaCentavos) {
    avisos.push(`Faltavam ${brl(dist.entradaTabelaCentavos - dist.creditoCentavos)} para a entrada, abaixo do mínimo de cobrança: a diferença foi para as parcelas.`)
  }
  const primeiraSeguinte = dist && dist.parcelasQuitadas > 0 && dist.parcelasRestantes > 0
    ? vencimentoPrevisto(new Date(), 1 + dist.parcelasQuitadas, plano!.diaVencimento) : null

  // Documentos
  const exigidos = await exigidosDoProcesso(oferta.processoId, reg.formData)
  const codigos = new Set(exigidos.map((e) => e.documentType.code))
  const docs = documentosParaLevar(reg, codigos)
  const levadosCod = new Set(docs.levados.map((d) => d.typeCode))
  const faltam = exigidos.filter((e) => !levadosCod.has(e.documentType.code))

  // Contrato
  const envelopes = await prisma.acaAssinatura.findMany({ where: { registrationId: deId, status: { not: 'CANCELADO' } }, select: { id: true, status: true, titulo: true } })
  const assinado = envelopes.some((e) => e.status === 'ASSINADO')
  const aceito = !!reg.contratoAceite
  const pendentes = envelopes.filter((e) => ['RASCUNHO', 'ENVIADO', 'PARCIAL'].includes(e.status))

  const moodle = await prisma.moodleAcesso.findUnique({ where: { registrationId: deId }, select: { status: true, cursoNome: true } }).catch(() => null)
  if (moodle && ['LIBERADO', 'SUSPENSO'].includes(moodle.status)) avisos.push(`O acesso ao Moodle (${moodle.cursoNome ?? 'curso antigo'}) será suspenso; o novo é liberado quando a nova inscrição estiver paga e com o contrato assinado.`)

  return {
    ok: true as const,
    bloqueios, avisos,
    de: {
      id: reg.id, codigo: reg.candidateCode, portal: reg.portal?.nome ?? null,
      curso: reg.processRegistration?.offering?.course?.nome ?? reg.processRegistration?.offering?.nome ?? null,
      status: reg.status, pago: reg.paymentStatus === 'paid',
    },
    para: {
      portalId: cat.portal.id, portal: cat.portal.nome, offeringId: oferta.id, escopo, taxaCentavos, curso: oferta.curso ?? oferta.nome, ingresso: oferta.ingresso,
      polo: polo ? { id: polo.id, nome: polo.nome } : null,
      plano: plano ? { id: plano.id, nome: plano.nome, matricula: plano.taxaMatriculaCentavos, parcela: plano.valorParcelaCentavos, numParcelas: plano.numParcelas, dia: plano.diaVencimento } : null,
      planos: planos.map((p) => ({ id: p.id, nome: p.nome })),
      precos, precoPor, precoPadrao,
    },
    financeiro: { recebido, distribuicao: dist, primeiraSeguinte, ...(pontualidadeCentavos ? { pontualidadeCentavos } : {}) },
    documentos: {
      levados: docs.levados.map((d) => ({ codigo: d.typeCode, nome: d.label, status: d.status })),
      faltam: faltam.map((e) => ({ codigo: e.documentType.code, nome: e.documentType.name, obrigatorio: e.required })),
      ficam: docs.ficam.map((d) => ({ codigo: d.typeCode, nome: d.label, status: d.status })),
      reprovados: docs.reprovados.map((d) => ({ codigo: d.typeCode, nome: d.label })),
    },
    contrato: { antigo: assinado ? 'assinado' : aceito ? 'aceito' : envelopes.length ? 'pendente' : 'nenhum', pendentesParaCancelar: pendentes.length },
    // Para a confirmação recusar se algo mudou entre a prévia e o clique.
    assinatura: `${recebido.totalCentavos}:${pontualidadeCentavos}:${plano?.id ?? 0}:${precoPor}:${docs.levados.length}`,
  }
}

// ─── Executar ───────────────────────────────────────────────────────────────

const pastaDocs = () => join(process.cwd(), '..', 'uploads', 'enrollment-docs')

/** Cópia física do arquivo: apagar o documento numa inscrição não pode sumir com o da outra. */
async function copiarArquivo(fileUrl: string, novoId: number): Promise<string | null> {
  const nome = fileUrl.split('/uploads/enrollment-docs/')[1]?.split('?')[0]
  if (!nome || !/^[A-Za-z0-9._-]+$/.test(nome)) return null
  const origem = join(pastaDocs(), nome)
  if (!existsSync(origem)) return null
  const novo = `${novoId}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${extname(nome).toLowerCase()}`
  await copyFile(origem, join(pastaDocs(), novo))
  return fileUrl.replace(nome, novo)
}

export async function transferirCurso(deId: number, body: any, op: Operador): Promise<
  { ok: true; paraId: number; paraCodigo: string; portalId: number; avisos: string[] } | { ok: false; status: number; erro: string }
> {
  const motivo = String(body?.motivo ?? '').trim().slice(0, 500)
  if (motivo.length < 5) return { ok: false, status: 400, erro: 'Informe o motivo da transferência.' }
  const alvo: Alvo = { portalId: Number(body?.portalId), offeringId: Number(body?.offeringId), campusId: body?.campusId ? Number(body.campusId) : null, planoId: body?.planoId ? Number(body.planoId) : null, precoPor: body?.precoPor ? String(body.precoPor) : null }
  const previa = await previaDaTransferencia(deId, alvo)
  if (!previa.ok) return { ok: false, status: previa.status, erro: previa.erro }
  if (previa.bloqueios.length) return { ok: false, status: 409, erro: previa.bloqueios[0]! }
  if (body?.assinatura && body.assinatura !== previa.assinatura) {
    return { ok: false, status: 409, erro: 'Os valores mudaram desde a prévia (pagamento ou plano). Revise antes de confirmar.' }
  }

  const reg = (await lerInscricao(deId))!
  const dist = previa.financeiro.distribuicao
  const planoBase = previa.para.plano ? (await planosDaOferta(previa.para.offeringId)).find((p) => p.id === previa.para.plano!.id)! : null
  // O mesmo preço que a prévia mostrou (forma escolhida pela equipe).
  const precoEscolhido = previa.para.precos.find((q) => q.chave === previa.para.precoPor)
  const plano = planoBase && precoEscolhido ? precificar(planoBase, precoEscolhido.totalCentavos) : planoBase
  const credito = previa.financeiro.recebido.totalCentavos
  const agora = new Date()
  const { fechamentoDaVenda } = await import('./propostaDaInscricao.js')
  const fech = await fechamentoDaVenda(deId).catch(() => null)
  const transferencia = {
    deId, deCodigo: reg.candidateCode, creditoCentavos: credito, em: agora.toISOString(), por: op.nome,
    valorCursoCentavos: plano ? Math.round(valorIntegral(plano) * 100) : 0,
    ...(precoEscolhido ? { precoPor: previa.para.precoPor, precoRotulo: precoEscolhido.rotulo } : {}),
    ...(fech ? { fechamento: { data: fech.data.toISOString(), forma: fech.forma } } : {}),
  }

  const condicao: (CondicaoNegociada & { transferencia: typeof transferencia }) | null = plano && dist?.condicao
    ? {
      planoId: plano.id,
      taxaMatriculaCentavos: dist.condicao.taxaMatriculaCentavos,
      valorParcelaCentavos: dist.condicao.valorParcelaCentavos,
      numParcelas: dist.condicao.numParcelas,
      diaVencimento: plano.diaVencimento,
      regras: semPrecoProprio(plano),
      vencimentoEntrada: null,
      primeiraSeguinte: previa.financeiro.primeiraSeguinte,
      ...(plano.taxaMatriculaCentavos === 0 ? { entradaComoParcela: true } : {}),
      tabela: { taxaMatriculaCentavos: planoBase!.taxaMatriculaCentavos, valorParcelaCentavos: planoBase!.valorParcelaCentavos, numParcelas: planoBase!.numParcelas, diaVencimento: planoBase!.diaVencimento },
      motivo: `Crédito de ${brl(credito)} da transferência de ${reg.candidateCode}`,
      porUserId: op.userId, porNome: op.nome, em: agora.toISOString(),
      transferencia,
    }
    : null

  // Taxa de inscrição (sem plano): o restante a pagar vai como valor combinado.
  const valorAvulso = !plano && previa.para.escopo === 'taxa' && dist?.caso === 'reduz_entrada'
    ? { valorAvulso: { valorCentavos: dist.entradaAPagarCentavos, tabelaCentavos: dist.entradaTabelaCentavos, motivo: `Crédito de ${brl(credito)} da transferência de ${reg.candidateCode}`, porNome: op.nome, em: agora.toISOString() }, transferencia }
    : null

  // Nada some da inscrição antiga: ela fica encerrada como histórico.
  const fdAntigo = (reg.formData ?? {}) as Record<string, any>
  const { _dispensas: _d, _transferidaPara: _t, _transferencia: _tr, ...fdBase } = fdAntigo
  const formData = {
    ...fdBase,
    offeringId: previa.para.offeringId,
    campusId: previa.para.polo?.id ?? null,
    campusNome: previa.para.polo?.nome ?? null,
    _transferencia: transferencia,
  }
  const { generateCandidateCode } = await import('./enrollmentCode.js')
  const codigo = await generateCandidateCode(previa.para.portalId)
  const pagoPeloCredito = dist?.caso === 'cobre_entrada'
  const processoId = (await prisma.courseOffering.findUnique({ where: { id: previa.para.offeringId }, select: { selectionProcessId: true } }))!.selectionProcessId
  if (!processoId) return { ok: false, status: 400, erro: 'O curso novo não tem processo seletivo.' }

  let novoId = 0
  const copias: string[] = []
  try {
    await prisma.$transaction(async (tx) => {
      // Primeiro encerra a antiga: dois cliques ao mesmo tempo não fazem duas transferências.
      const fechou = await tx.enrollmentRegistration.updateMany({
        where: { id: deId, status: { notIn: FECHADAS } },
        data: { status: 'cancelled', atendidoPorUserId: op.userId },
      })
      if (fechou.count !== 1) throw new Error('JA_ENCERRADA')
      const pr = await tx.processRegistration.upsert({
        where: { leadId_offeringId: { leadId: reg.leadId!, offeringId: previa.para.offeringId } },
        update: { status: 'inscrito' },
        create: { leadId: reg.leadId!, offeringId: previa.para.offeringId, selectionProcessId: processoId, status: 'inscrito' },
      })
      // Voltando a um curso que a pessoa já fez: o vínculo com o processo é um só por curso,
      // e a inscrição encerrada de antes solta ele (o curso fica no histórico dela).
      const presas = await tx.enrollmentRegistration.findMany({ where: { processRegistrationId: pr.id, status: { in: FECHADAS } }, select: { id: true, formData: true } })
      for (const x of presas) {
        await tx.enrollmentRegistration.update({
          where: { id: x.id },
          data: { processRegistrationId: null, formData: { ...((x.formData ?? {}) as object), _cursoDaInscricao: previa.para.curso } as any },
        })
      }
      const nova = await tx.enrollmentRegistration.create({
        data: {
          portalId: previa.para.portalId, candidateCode: codigo, status: pagoPeloCredito ? 'paid' : 'pending',
          formData: formData as any, leadId: reg.leadId, processRegistrationId: pr.id,
          origem: 'transferencia', criadoPorUserId: op.userId, atendidoPorUserId: op.userId,
          vendedorUserId: reg.vendedorUserId,
          utmSource: reg.utmSource, utmMedium: reg.utmMedium, utmCampaign: reg.utmCampaign, fbclid: reg.fbclid, gclid: reg.gclid, referrer: reg.referrer,
          ...(condicao ? { condicaoNegociada: condicao as any } : valorAvulso ? { condicaoNegociada: valorAvulso as any } : {}),
          ...(pagoPeloCredito && plano && condicao ? {
            paymentStatus: 'paid', paymentPaidAt: agora, paymentMethod: 'CREDITO',
            paymentAmount: dist!.creditoNaEntradaCentavos / 100, paymentId: `credito-${deId}-${agora.getTime()}`,
            paymentPlan: {
              planoFinanceiro: escolhaParaGravar({ ...plano, taxaMatriculaCentavos: condicao.taxaMatriculaCentavos, valorParcelaCentavos: condicao.valorParcelaCentavos, numParcelas: dist!.condicao!.numParcelas }, 'entrada', true),
              meio: 'credito', parcelas: 1, valorCobrado: dist!.creditoNaEntradaCentavos / 100,
              condicaoNegociada: condicao, transferencia,
            } as any,
          } : {}),
          ...(pagoPeloCredito && !plano ? {
            paymentStatus: 'paid', paymentPaidAt: agora, paymentMethod: 'CREDITO',
            paymentAmount: dist!.creditoNaEntradaCentavos / 100, paymentId: `credito-${deId}-${agora.getTime()}`,
            paymentPlan: { meio: 'credito', parcelas: 1, valorCobrado: dist!.creditoNaEntradaCentavos / 100, transferencia } as any,
          } : {}),
        },
        select: { id: true },
      })
      novoId = nova.id

      for (const d of previa.documentos.levados) {
        const orig = reg.documents.find((x) => x.typeCode === d.codigo)!
        const url = await copiarArquivo(orig.fileUrl, nova.id)
        if (url) copias.push(url)
        const { id: _id, registrationId: _r, fileUrl, ...resto } = orig as any
        const dados: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(resto)) if (v !== null && v !== undefined) dados[k] = v
        await tx.enrollmentDocument.create({ data: { ...(dados as any), registrationId: nova.id, fileUrl: url ?? fileUrl } })
      }

      await tx.enrollmentRegistration.update({
        where: { id: deId },
        data: { formData: { ...fdAntigo, _cursoDaInscricao: previa.de.curso, _transferidaPara: { id: nova.id, codigo, em: agora.toISOString(), por: op.nome, motivo } } as any },
      })
      if (reg.processRegistrationId && reg.processRegistrationId !== pr.id) {
        await tx.processRegistration.update({ where: { id: reg.processRegistrationId }, data: { status: 'transferido' } }).catch(() => {})
      }
      // A venda é a mesma: a proposta (e a comissão) muda de inscrição.
      await tx.negotiation.updateMany({ where: { registrationId: deId }, data: { registrationId: nova.id, offeringId: previa.para.offeringId } as any })
      await tx.enrollmentTransferencia.create({
        data: {
          deRegistrationId: deId, paraRegistrationId: nova.id, leadId: reg.leadId,
          recebidoCentavos: credito, creditoCentavos: credito,
          entradaCentavos: dist?.creditoNaEntradaCentavos ?? 0, parcelasQuitadas: dist?.parcelasQuitadas ?? 0, sobraCentavos: dist ? dist.sobraCentavos : credito,
          motivo, criadoPorUserId: op.userId, criadoPorNome: op.nome,
          detalhes: {
            de: previa.de, para: previa.para, recebido: previa.financeiro.recebido, distribuicao: dist, primeiraSeguinte: previa.financeiro.primeiraSeguinte,
            documentos: previa.documentos, contrato: previa.contrato, avisos: previa.avisos,
          } as any,
        },
      })
    }, { timeout: 30_000 })
  } catch (e: any) {
    // Cópias feitas antes da falha não ficam órfãs.
    const { unlink } = await import('fs/promises')
    for (const u of copias) { const n = u.split('/uploads/enrollment-docs/')[1]; if (n) await unlink(join(pastaDocs(), n)).catch(() => {}) }
    if (e?.message === 'JA_ENCERRADA') return { ok: false, status: 409, erro: 'Esta inscrição já foi encerrada ou transferida.' }
    throw e
  }

  // Fora da transação: gateway, assinatura e Moodle. Falha vira aviso, nunca desfaz.
  const avisos = [...previa.avisos]
  const antes = await prisma.enrollmentRegistration.findUnique({ where: { id: deId }, select: { paymentStatus: true, paymentId: true, paymentUrl: true, paymentExpiresAt: true } })
  const { cancelarCobrancasAbertas } = await import('./inscricaoDuplicada.js')
  avisos.push(...await cancelarCobrancasAbertas(deId, `Transferida para ${codigo}`).catch((e: any) => [String(e?.message || e)]))
  const { cancelarTitulosAbertos } = await import('./pagamentoCombinado.js')
  avisos.push(...await cancelarTitulosAbertos(deId, `Transferida para ${codigo}`, { origem: 'acordo' }).catch((e: any) => [String(e?.message || e)]))
  // O cancelamento limpa a situação do pagamento; na antiga ela é o histórico do que foi pago.
  if (antes) await prisma.enrollmentRegistration.update({ where: { id: deId }, data: antes }).catch(() => {})
  avisos.push(...await cancelarParcelasDoPortal(deId, codigo))

  const pendentes = await prisma.acaAssinatura.findMany({ where: { registrationId: deId, status: { in: ['RASCUNHO', 'ENVIADO', 'PARCIAL'] } }, select: { id: true } })
  if (pendentes.length) {
    const { cancelar } = await import('./acaAssinatura.js')
    for (const p of pendentes) await cancelar(p.id).catch((e: any) => avisos.push(`Assinatura pendente nº ${p.id}: ${e?.message || e} — cancele no provedor.`))
  }
  const moodle = await prisma.moodleAcesso.findUnique({ where: { registrationId: deId }, select: { status: true } }).catch(() => null)
  if (moodle?.status === 'LIBERADO') {
    const { suspender } = await import('./moodleAcessos.js')
    await suspender(deId, { origem: 'manual', userId: op.userId, userName: op.nome }).catch((e: any) => avisos.push(`Moodle: ${e?.message || e} — suspenda o curso antigo à mão.`))
  }

  const dados = {
    de: reg.candidateCode, para: codigo, curso: previa.para.curso, credito: credito / 100, motivo,
    caso: dist?.caso ?? 'sem_plano', parcelasQuitadas: dist?.parcelasQuitadas ?? 0, documentosLevados: previa.documentos.levados.length,
  }
  await registrarEventoDaInscricao({ registrationId: deId, etapa: 'inscricao', acao: 'transferida', ator: 'atendente', userId: op.userId, userName: op.nome, dados })
  await registrarEventoDaInscricao({ registrationId: novoId, etapa: 'inscricao', acao: 'criada_por_transferencia', ator: 'atendente', userId: op.userId, userName: op.nome, dados })
  if (reg.leadId) {
    logEvent({
      leadId: reg.leadId, type: 'enrollment_transfer' as any, category: 'operator',
      title: `Transferência de curso: ${reg.candidateCode} → ${codigo} (${previa.para.curso})`,
      description: `${motivo}${credito > 0 ? ` · crédito de ${brl(credito)}` : ''}`,
      actorType: 'operator', userId: op.userId, userName: op.nome,
      metadata: { de: deId, para: novoId, creditoCentavos: credito },
    })
  }
  const funil = await import('./funilDaJornada.js')
  funil.sincronizarFunil(novoId)
  funil.sincronizarFunil(deId)
  await import('./propostaDaInscricao.js').then((m) => m.sincronizarPropostaDaInscricao(novoId)).catch(() => {})
  return { ok: true, paraId: novoId, paraCodigo: codigo, portalId: previa.para.portalId, avisos }
}

/** Parcelas que o aluno gerou no Meu Portal e ainda não pagou: cancela no Asaas. */
async function cancelarParcelasDoPortal(registrationId: number, codigo: string): Promise<string[]> {
  const reg = await prisma.enrollmentRegistration.findUnique({ where: { id: registrationId }, select: { paymentPlan: true } })
  const geradas = Object.entries(((reg?.paymentPlan as any)?.parcelasPortal ?? {}) as Record<string, any>).filter(([, g]) => g?.id)
  if (!geradas.length) return []
  const { configDaInscricao } = await import('./pagamentoCombinado.js')
  const { consultarCobrancaAsaas, cancelarCobrancaAsaas, ASAAS_STATUS_MAP } = await import('./paymentAsaas.js')
  const cfg = await configDaInscricao(registrationId).catch(() => null)
  if (!cfg) return ['Parcelas do Meu Portal: sem conexão com o Asaas — cancele as abertas no painel do Asaas.']
  const avisos: string[] = []
  for (const [n, g] of geradas) {
    const p = await consultarCobrancaAsaas(cfg, g.id).catch(() => null)
    if (!p || p.deleted || ASAAS_STATUS_MAP[String(p.status)] === 'paid') continue
    const r = await cancelarCobrancaAsaas(cfg, g.id).catch((e: any) => ({ ok: false, message: String(e?.message || e) }))
    if (!r.ok) avisos.push(`Parcela ${n} do Meu Portal (${g.id}): ${r.message} — cancele no Asaas (transferida para ${codigo}).`)
  }
  return avisos
}

/** Histórico das transferências que envolvem a inscrição (de ou para). */
export async function transferenciasDa(registrationId: number) {
  const lista = await prisma.enrollmentTransferencia.findMany({
    where: { OR: [{ deRegistrationId: registrationId }, { paraRegistrationId: registrationId }] },
    orderBy: { id: 'desc' },
  })
  const ids = [...new Set(lista.flatMap((t) => [t.deRegistrationId, t.paraRegistrationId]))]
  const regs = await prisma.enrollmentRegistration.findMany({ where: { id: { in: ids } }, select: { id: true, candidateCode: true, portalId: true } })
  const r = new Map(regs.map((x) => [x.id, x]))
  return lista.map((t) => ({
    id: t.id, em: t.createdAt, por: t.criadoPorNome, motivo: t.motivo,
    sentido: t.deRegistrationId === registrationId ? 'saiu' as const : 'veio' as const,
    de: r.get(t.deRegistrationId) ?? { id: t.deRegistrationId, candidateCode: '?', portalId: 0 },
    para: r.get(t.paraRegistrationId) ?? { id: t.paraRegistrationId, candidateCode: '?', portalId: 0 },
    creditoCentavos: t.creditoCentavos, entradaCentavos: t.entradaCentavos, parcelasQuitadas: t.parcelasQuitadas, sobraCentavos: t.sobraCentavos,
    detalhes: t.detalhes,
  }))
}
