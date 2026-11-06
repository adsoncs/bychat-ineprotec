// services/valorPersonalizado.ts
//
// VALOR PERSONALIZADO (04/11/2026) — matrícula interna pelo painel.
//
// No atendimento (inscricaoAssistida), o agente com a permissão "Valor
// personalizado" troca a matrícula e a mensalidade do plano escolhido. Sem teto:
// pode ficar abaixo ou acima da tabela. A troca é gravada na inscrição
// (condicaoNegociada) e aplicada sobre o plano em services/planoFinanceiro,
// então a tela, a cobrança, o contrato e as parcelas fazem a conta de sempre:
// desconto do Pix/boleto à vista e de pontualidade incidem sobre o combinado.
//
// O candidato vê só o valor final — nada aqui chega à resposta dele.
// Depois do pagamento a condição trava (as parcelas já nasceram dela).

import type { FastifyRequest } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { atendenteDe, registrarEventoDaInscricao } from './inscricaoAssistida.js'
import {
  aplicarCondicaoNegociada, condicaoNegociadaDaInscricao, condicoesDaOpcao, dataIso, descreverOpcao, formasDaOpcao, lerValorCombinado,
  lerRegrasDoPlano, opcoesDoPlano, planoPorId, planosDaOferta, resumoDoPlano, totalDeParcelas,
  type CondicaoNegociada, type PlanoDaOferta, type RegrasDoPlano,
} from './planoFinanceiro.js'

/** O agente desta requisição pode personalizar valores? null = não é atendimento. */
export async function podeValorPersonalizado(req: FastifyRequest): Promise<{ pode: boolean; userId: number; nome: string } | null> {
  const at = atendenteDe(req)
  if (!at) return null
  const u = await prisma.user.findUnique({ where: { id: at.userId }, select: { role: true } }).catch(() => null)
  if (!u) return { pode: false, userId: at.userId, nome: at.nome }
  if (u.role === 'SUPERADMIN') return { pode: true, userId: at.userId, nome: at.nome }
  const { resolvePermissions } = await import('../lib/permissions.js')
  const perms = await resolvePermissions(at.userId, u.role).catch(() => ({} as any))
  return { pode: !!perms.edu_valor_personalizado?.canEdit, userId: at.userId, nome: at.nome }
}

const reais = (c: number) => Math.round(c) / 100

// ── Editor: o plano inteiro, em reais, como a tela do agente edita ─────────

type FormaEd = { ativo: boolean; descontoPct: number; valorBase: number | null }
type ParceladoEd = { ativo: boolean; parcelasMax: number; jurosMesPct: number | null; faixas: { ate: number; jurosMesPct: number }[]; valorBase: number | null }
type OpcaoEd = { ativo: boolean; pix: FormaEd; boleto: FormaEd; cartao: ParceladoEd; boletoParcelado: ParceladoEd }
export interface EditorDoPlano {
  matricula: number
  mensalidade: number
  numParcelas: number
  diaVencimento: number
  opcoes: { entrada: OpcaoEd; integral: OpcaoEd }
  pontualidade: RegrasDoPlano['pontualidade']
  vencimentoEntrada: string | null
  primeiraSeguinte: string | null
}

function editorDe(p: PlanoDaOferta, cn?: CondicaoNegociada | null): EditorDoPlano {
  const parcelado = (f: { ativo: boolean; parcelasMax: number; faixas: { ate: number; jurosMesPct: number }[]; valorBase: number | null }): ParceladoEd => ({
    ativo: f.ativo, parcelasMax: f.parcelasMax, faixas: f.faixas, valorBase: f.valorBase,
    // Um juro só (ou nenhum) cabe num campo; várias faixas ficam como estão (null).
    jurosMesPct: f.faixas.length === 0 ? 0 : f.faixas.length === 1 ? f.faixas[0]!.jurosMesPct : null,
  })
  const opcao = (o: RegrasDoPlano['entrada']): OpcaoEd => ({
    ativo: o.ativo,
    pix: { ativo: o.pix.ativo, descontoPct: o.pix.descontoPct, valorBase: o.pix.valorBase },
    boleto: { ativo: o.boleto.ativo, descontoPct: o.boleto.descontoPct, valorBase: o.boleto.valorBase },
    cartao: parcelado(o.cartao), boletoParcelado: parcelado(o.boletoParcelado),
  })
  return {
    matricula: reais(p.taxaMatriculaCentavos), mensalidade: reais(p.valorParcelaCentavos),
    numParcelas: p.numParcelas, diaVencimento: p.diaVencimento,
    opcoes: { entrada: opcao(p.regras.entrada), integral: opcao(p.regras.integral) },
    pontualidade: { ...p.regras.pontualidade },
    vencimentoEntrada: cn?.vencimentoEntrada ?? null, primeiraSeguinte: cn?.primeiraSeguinte ?? null,
  }
}

/** Frases das condições do plano em vigor (o que o candidato vai encontrar). */
function resumoDe(p: PlanoDaOferta, cn: CondicaoNegociada | null): string[] {
  const out: string[] = [resumoDoPlano(p) + ` · vencimento todo dia ${p.diaVencimento}`]
  for (const o of opcoesDoPlano(p)) {
    const d = descreverOpcao(p, o)
    out.push(`${d.rotulo}: ${d.detalhe}`)
    for (const c of condicoesDaOpcao(p, o)) out.push(`  · ${c}`)
  }
  const pt = p.regras.pontualidade
  if (pt.ativo && pt.descontoPct > 0) out.push(`Pontualidade: ${pt.descontoPct}% pagando até ${pt.ateVencimento ? 'o vencimento' : `o dia ${pt.diaLimite}`}${pt.terminaEm90 ? ' (termina em ,90)' : ''}`)
  if (cn?.vencimentoEntrada) out.push(`Cobrança de agora vence em ${cn.vencimentoEntrada.split('-').reverse().join('/')}`)
  if (cn?.primeiraSeguinte) out.push(`1ª parcela seguinte em ${cn.primeiraSeguinte.split('-').reverse().join('/')} (as demais, mês a mês)`)
  return out
}

/** O que a tela do agente mostra sobre o plano em tela (nunca vai ao candidato). */
export async function negociacaoParaAtendimento(req: FastifyRequest, registrationId: number, planoId: number | null | undefined) {
  const quem = await podeValorPersonalizado(req)
  if (!quem) return null
  const atual = await condicaoNegociadaDaInscricao(registrationId)
  const tabela = planoId ? await planoPorId(planoId) : null
  const vale = atual && tabela && atual.planoId === tabela.id ? atual : null
  const emVigor = tabela ? aplicarCondicaoNegociada(tabela, vale) : null
  return {
    pode: quem.pode,
    plano: tabela ? {
      id: tabela.id,
      nome: tabela.nome,
      temMatricula: tabela.taxaMatriculaCentavos > 0,
      temMensalidade: tabela.numParcelas > 0,
      totalParcelas: totalDeParcelas(tabela),
      matricula: reais(tabela.taxaMatriculaCentavos),
      mensalidade: reais(tabela.valorParcelaCentavos),
      precoPorForma: [tabela.regras.entrada, tabela.regras.integral].some((f) =>
        [f.pix, f.boleto, f.cartao, f.boletoParcelado].some((x) => x.valorBase !== null)),
    } : null,
    /** Valores da tabela (para comparar) e os em vigor (para preencher o editor). */
    tabela: tabela ? editorDe(tabela) : null,
    editor: emVigor ? editorDe(emVigor, vale) : null,
    resumo: emVigor ? resumoDe(emVigor, vale) : [],
    atual: atual ? {
      planoId: atual.planoId,
      matricula: reais(atual.taxaMatriculaCentavos),
      mensalidade: reais(atual.valorParcelaCentavos),
      tabela: { matricula: reais(atual.tabela.taxaMatriculaCentavos), mensalidade: reais(atual.tabela.valorParcelaCentavos) },
      completo: !!atual.regras,
      motivo: atual.motivo,
      por: atual.porNome,
      em: atual.em,
    } : null,
  }
}

function lerReais(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  // "1.234,56" e "199,90" (com vírgula: ponto é milhar) ou "199.90" (sem vírgula).
  const t = String(v).trim().replace(/[R$\s]/g, '')
  const n = typeof v === 'number' ? v : Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100)
}

const num = (v: unknown, min: number, max: number): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(String(v).replace(',', '.'))
  return Number.isFinite(n) && n >= min && n <= max ? n : null
}
const hojeBr = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
const somarDias = (iso: string, dias: number) => new Date(new Date(`${iso}T12:00:00Z`).getTime() + dias * 86_400_000).toISOString().slice(0, 10)

type Lido = { valores: Omit<CondicaoNegociada, 'planoId' | 'tabela' | 'motivo' | 'porUserId' | 'porNome' | 'em'> } | { erro: string }

/** Formato simples (só matrícula e mensalidade) — o de 04/11, ainda aceito. */
function lerSimples(body: any, plano: PlanoDaOferta): Lido {
  const matricula = plano.taxaMatriculaCentavos > 0 ? lerReais(body?.matricula) : 0
  const mensalidade = plano.numParcelas > 0 || plano.taxaMatriculaCentavos === 0 ? lerReais(body?.mensalidade) : plano.valorParcelaCentavos
  if (plano.taxaMatriculaCentavos > 0 && (matricula === null || matricula <= 0)) return { erro: 'Informe o valor da matrícula (maior que zero). Para isentar, use um cupom de 100%.' }
  if (mensalidade === null || mensalidade <= 0) return { erro: 'Informe o valor da mensalidade (maior que zero).' }
  return { valores: { taxaMatriculaCentavos: matricula ?? 0, valorParcelaCentavos: mensalidade, numParcelas: null, diaVencimento: null, regras: null, vencimentoEntrada: null, primeiraSeguinte: null } }
}

/** Editor completo: valores, parcelas, opções, formas, descontos, juros, pontualidade e datas. */
function lerEditor(e: any, plano: PlanoDaOferta): Lido {
  const matricula = lerReais(e?.matricula)
  if (matricula === null) return { erro: 'Valor da matrícula inválido (use 0 para não ter matrícula separada).' }
  const numParcelas = num(e?.numParcelas, 0, 60)
  if (numParcelas === null || !Number.isInteger(numParcelas)) return { erro: 'Quantidade de mensalidades inválida (de 0 a 60).' }
  const mensalidade = numParcelas > 0 ? lerReais(e?.mensalidade) : 0
  if (numParcelas > 0 && (mensalidade === null || mensalidade <= 0)) return { erro: 'Informe o valor da mensalidade (maior que zero).' }
  if (matricula === 0 && numParcelas === 0) return { erro: 'Sem matrícula e sem mensalidades não há o que cobrar.' }
  const dia = num(e?.diaVencimento, 1, 28)
  if (dia === null || !Number.isInteger(dia)) return { erro: 'Dia de vencimento inválido (de 1 a 28).' }

  const formaSimples = (f: any, nome: string): FormaEd | string => {
    const descontoPct = num(f?.descontoPct ?? 0, 0, 90)
    if (descontoPct === null) return `Desconto do ${nome} inválido (de 0 a 90%).`
    const vb = f?.valorBase === null || f?.valorBase === undefined || f?.valorBase === '' ? null : lerReais(f.valorBase)
    if (vb !== null && vb <= 0) return `Preço próprio do ${nome} inválido.`
    return { ativo: !!f?.ativo, descontoPct, valorBase: vb === null ? null : vb / 100 }
  }
  const formaParcelada = (f: any, nome: string, teto: number, base: { faixas: { ate: number; jurosMesPct: number }[] }): ParceladoEd | string => {
    const parcelasMax = num(f?.parcelasMax ?? 1, 1, teto)
    if (parcelasMax === null || !Number.isInteger(parcelasMax)) return `Parcelas do ${nome}: de 1 a ${teto}.`
    const juros = f?.jurosMesPct === null || f?.jurosMesPct === undefined || f?.jurosMesPct === '' ? null : num(f.jurosMesPct, 0, 20)
    if (f?.jurosMesPct !== null && f?.jurosMesPct !== undefined && f?.jurosMesPct !== '' && juros === null) return `Juros do ${nome} inválidos (de 0 a 20% ao mês).`
    const vb = f?.valorBase === null || f?.valorBase === undefined || f?.valorBase === '' ? null : lerReais(f.valorBase)
    if (vb !== null && vb <= 0) return `Preço próprio do ${nome} inválido.`
    // juros null = mantém as faixas que já estavam (da tabela ou do combinado).
    const faixas = juros === null ? base.faixas.filter((x) => x.ate <= parcelasMax) : juros > 0 ? [{ ate: parcelasMax, jurosMesPct: juros }] : []
    return { ativo: !!f?.ativo, parcelasMax, jurosMesPct: juros, faixas, valorBase: vb === null ? null : vb / 100 }
  }
  const opcao = (o: any, nome: string, tab: RegrasDoPlano['entrada']) => {
    const pix = formaSimples(o?.pix, `Pix (${nome})`)
    const boleto = formaSimples(o?.boleto, `boleto à vista (${nome})`)
    const cartao = formaParcelada(o?.cartao, `cartão (${nome})`, 12, tab.cartao)
    const boletoParcelado = formaParcelada(o?.boletoParcelado, `boleto parcelado (${nome})`, 48, tab.boletoParcelado)
    for (const x of [pix, boleto, cartao, boletoParcelado]) if (typeof x === 'string') return x
    const c = cartao as ParceladoEd, b = boletoParcelado as ParceladoEd
    return {
      ativo: !!o?.ativo, pix, boleto,
      cartao: { ativo: c.ativo, parcelasMax: c.parcelasMax, faixas: c.faixas, valorBase: c.valorBase },
      boletoParcelado: { ativo: b.ativo, parcelasMax: Math.max(2, b.parcelasMax), faixas: b.faixas, valorBase: b.valorBase },
    }
  }
  const entrada = opcao(e?.opcoes?.entrada, 'matrícula/1ª parcela', plano.regras.entrada)
  if (typeof entrada === 'string') return { erro: entrada }
  const integral = opcao(e?.opcoes?.integral, 'curso completo', plano.regras.integral)
  if (typeof integral === 'string') return { erro: integral }
  const pt = e?.pontualidade ?? {}
  const ptPct = num(pt.descontoPct ?? 0, 0, 90)
  const ptDia = num(pt.diaLimite ?? 5, 1, 28)
  if (ptPct === null || ptDia === null) return { erro: 'Pontualidade inválida (desconto de 0 a 90%, dia de 1 a 28).' }

  const hoje = hojeBr()
  const vencimentoEntrada = e?.vencimentoEntrada ? dataIso(e.vencimentoEntrada) : null
  if (e?.vencimentoEntrada && !vencimentoEntrada) return { erro: 'Data de vencimento da cobrança de agora inválida.' }
  if (vencimentoEntrada && (vencimentoEntrada < hoje || vencimentoEntrada > somarDias(hoje, 90))) return { erro: 'O vencimento da cobrança de agora deve ser de hoje até 90 dias.' }
  const primeiraSeguinte = e?.primeiraSeguinte ? dataIso(e.primeiraSeguinte) : null
  if (e?.primeiraSeguinte && !primeiraSeguinte) return { erro: 'Data da 1ª parcela seguinte inválida.' }
  if (primeiraSeguinte && (primeiraSeguinte <= hoje || primeiraSeguinte > somarDias(hoje, 400))) return { erro: 'A 1ª parcela seguinte deve ser depois de hoje (até 400 dias).' }
  if (primeiraSeguinte && vencimentoEntrada && primeiraSeguinte <= vencimentoEntrada) return { erro: 'A 1ª parcela seguinte deve vencer depois da cobrança de agora.' }

  const regras = lerRegrasDoPlano({
    destino: plano.regras.destino, entrada, integral,
    pontualidade: { ativo: !!pt.ativo, descontoPct: ptPct, diaLimite: ptDia, ateVencimento: !!pt.ateVencimento, terminaEm90: !!pt.terminaEm90 },
  })!
  return {
    valores: {
      taxaMatriculaCentavos: matricula, valorParcelaCentavos: mensalidade ?? 0,
      numParcelas, diaVencimento: dia,
      regras: { entrada: regras.entrada, integral: regras.integral, pontualidade: regras.pontualidade },
      vencimentoEntrada, primeiraSeguinte,
    },
  }
}

type Resultado = { ok: true; condicao: CondicaoNegociada | null; avisos: string[] } | { ok: false; status: number; erro: string }

async function inscricaoParaMudar(registrationId: number) {
  const reg = await prisma.enrollmentRegistration.findUnique({
    where: { id: registrationId },
    select: {
      id: true, paymentStatus: true, paymentPaidAt: true, condicaoNegociada: true,
      processRegistration: { select: { offeringId: true } },
    },
  })
  if (!reg) return { erro: { ok: false as const, status: 404, erro: 'Inscrição não encontrada.' } }
  if (reg.paymentStatus === 'paid' || reg.paymentPaidAt) {
    return { erro: { ok: false as const, status: 409, erro: 'O pagamento desta inscrição já foi feito: o valor não pode mais ser alterado por aqui.' } }
  }
  return { reg }
}

/** Uma cobrança aberta foi gerada com o valor antigo: cancela para não ser paga. */
async function cancelarAbertas(registrationId: number): Promise<string[]> {
  const abertas = await prisma.enrollmentPaymentMethod.count({ where: { registrationId, status: 'pending' } })
  if (!abertas) return []
  const { cancelarCobrancasAbertas } = await import('./inscricaoDuplicada.js')
  const avisos = await cancelarCobrancasAbertas(registrationId, 'Valor personalizado pelo atendimento').catch((e: any) => [String(e?.message || e)])
  return [`A cobrança aberta com o valor anterior foi cancelada (${abertas}). Gere a nova cobrança.`, ...avisos]
}

/** Sem plano (taxa, ou curso sem plano): o que a tela do agente edita. Nunca vai ao candidato. */
export async function valorAvulsoParaAtendimento(req: FastifyRequest, registrationId: number, cob: { valor: number; valorDaTabela?: number; fonte: string }, portalCobra: boolean) {
  const quem = await podeValorPersonalizado(req)
  if (!quem) return null
  const r = await prisma.enrollmentRegistration.findUnique({ where: { id: registrationId }, select: { condicaoNegociada: true } })
  const c = lerValorCombinado(r?.condicaoNegociada)
  return {
    pode: quem.pode, portalCobra, valor: cob.valor,
    tabela: cob.fonte === 'negociado' ? (cob.valorDaTabela ?? 0) : cob.valor,
    combinado: c ? { motivo: c.motivo, por: c.porNome, em: c.em } : null,
  }
}

async function salvarValorAvulso(req: FastifyRequest, registrationId: number, body: any, quem: { userId: number; nome: string }): Promise<Resultado> {
  const { cobrancaDoPortal } = await import('./portalCobranca.js')
  const cob = await cobrancaDoPortal(registrationId)
  if (!cob) return { ok: false, status: 404, erro: 'Inscrição não encontrada.' }
  if (cob.fonte === 'plano_erp') return { ok: false, status: 400, erro: 'Este curso tem plano de pagamento: edite as condições do plano.' }
  const centavos = lerReais(body.valorAvulso)
  if (centavos === null || centavos <= 0) return { ok: false, status: 400, erro: 'Informe um valor maior que zero. Para isentar, use um cupom de 100%.' }
  const motivo = String(body?.motivo ?? '').trim()
  if (motivo.length < 3) return { ok: false, status: 400, erro: 'Informe o motivo do valor personalizado.' }
  const tabela = cob.fonte === 'negociado' ? (cob.valorDaTabela ?? 0) : cob.valor
  await prisma.enrollmentRegistration.update({
    where: { id: registrationId },
    data: { condicaoNegociada: { valorAvulso: { valorCentavos: centavos, tabelaCentavos: Math.round(tabela * 100), motivo: motivo.slice(0, 500), porUserId: quem.userId, porNome: quem.nome, em: new Date().toISOString() } } as any },
  })
  const avisos = await cancelarAbertas(registrationId)
  await registrarEventoDaInscricao({
    registrationId, etapa: 'pagamento', acao: 'valor_personalizado', ator: 'atendente', userId: quem.userId, userName: quem.nome, req,
    dados: { valor: reais(centavos), tabela, motivo: motivo.slice(0, 500) },
  })
  return { ok: true, condicao: null, avisos }
}

export async function salvarValorPersonalizado(req: FastifyRequest, registrationId: number, body: any): Promise<Resultado> {
  const quem = await podeValorPersonalizado(req)
  if (!quem) return { ok: false, status: 403, erro: 'Valor personalizado só existe no atendimento pelo painel.' }
  if (!quem.pode) return { ok: false, status: 403, erro: 'Seu perfil não pode personalizar valores (permissão "Valor personalizado").' }

  const x = await inscricaoParaMudar(registrationId)
  if ('erro' in x) return x.erro!
  const { reg } = x
  if (body?.valorAvulso !== undefined) return salvarValorAvulso(req, reg.id, body, quem)

  const planoId = Number(body?.planoId)
  const planos: PlanoDaOferta[] = await planosDaOferta(reg.processRegistration?.offeringId)
  const plano = planos.find((p) => p.id === planoId)
  if (!plano) return { ok: false, status: 400, erro: 'Escolha um plano de pagamento desta oferta.' }

  const motivo = String(body?.motivo ?? '').trim()
  if (motivo.length < 3) return { ok: false, status: 400, erro: 'Informe o motivo do valor personalizado.' }

  const lida = body?.editor ? lerEditor(body.editor, plano) : lerSimples(body, plano)
  if ('erro' in lida) return { ok: false, status: 400, erro: lida.erro }

  const condicao: CondicaoNegociada = {
    planoId: plano.id,
    ...lida.valores,
    tabela: {
      taxaMatriculaCentavos: plano.taxaMatriculaCentavos, valorParcelaCentavos: plano.valorParcelaCentavos,
      numParcelas: plano.numParcelas, diaVencimento: plano.diaVencimento,
    },
    motivo: motivo.slice(0, 500),
    porUserId: quem.userId,
    porNome: quem.nome,
    em: new Date().toISOString(),
  }
  const emVigor = aplicarCondicaoNegociada(plano, condicao)
  if (!opcoesDoPlano(emVigor).length || !opcoesDoPlano(emVigor).some((o) => {
    const f = formasDaOpcao(emVigor, o)
    return f.pix.ativo || f.boleto.ativo || f.cartao.ativo || f.boletoParcelado.ativo
  })) {
    return { ok: false, status: 400, erro: 'Deixe ao menos uma opção (matrícula/1ª parcela ou curso completo) com uma forma de pagamento ligada.' }
  }
  await prisma.enrollmentRegistration.update({ where: { id: reg.id }, data: { condicaoNegociada: condicao as any } })
  const avisos = await cancelarAbertas(reg.id)
  await registrarEventoDaInscricao({
    registrationId: reg.id, etapa: 'pagamento', acao: 'valor_personalizado', ator: 'atendente',
    userId: quem.userId, userName: quem.nome, req,
    dados: {
      plano: plano.nome,
      matricula: reais(condicao.taxaMatriculaCentavos), mensalidade: reais(condicao.valorParcelaCentavos),
      tabelaMatricula: reais(plano.taxaMatriculaCentavos), tabelaMensalidade: reais(plano.valorParcelaCentavos),
      motivo: condicao.motivo,
      resumo: resumoDe(emVigor, condicao),
    },
  })
  return { ok: true, condicao, avisos }
}

export async function removerValorPersonalizado(req: FastifyRequest, registrationId: number): Promise<Resultado> {
  const quem = await podeValorPersonalizado(req)
  if (!quem) return { ok: false, status: 403, erro: 'Valor personalizado só existe no atendimento pelo painel.' }
  if (!quem.pode) return { ok: false, status: 403, erro: 'Seu perfil não pode personalizar valores (permissão "Valor personalizado").' }
  const x = await inscricaoParaMudar(registrationId)
  if ('erro' in x) return x.erro!
  if (!x.reg.condicaoNegociada) return { ok: true, condicao: null, avisos: [] }
  await prisma.enrollmentRegistration.update({ where: { id: x.reg.id }, data: { condicaoNegociada: null as any } })
  const avisos = await cancelarAbertas(x.reg.id)
  await registrarEventoDaInscricao({
    registrationId: x.reg.id, etapa: 'pagamento', acao: 'valor_personalizado_removido', ator: 'atendente',
    userId: quem.userId, userName: quem.nome, req, dados: null,
  })
  return { ok: true, condicao: null, avisos }
}
