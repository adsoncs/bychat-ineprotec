// services/restanteAgora.ts
//
// PAGAR O RESTANTE AGORA (19/11/2026). As parcelas que ainda faltam de uma
// inscrição já paga (o restante de uma transferência de curso, o boleto
// parcelado ainda não gerado) só podiam ser pagas uma a uma, em boleto ou Pix,
// pelo Meu Portal. Caso real: o aluno queria quitar a diferença no cartão.
//
//  • O agente LIBERA no painel (permissão "Alterar forma de pagamento"): escolhe
//    as parcelas e o máximo de vezes no cartão.
//  • O aluno PAGA no Meu Portal: em até N vezes no cartão, SEM juros (o valor é
//    exatamente a soma das parcelas). Desconto só por CUPOM, que ele aplica lá.
//  • Pago o cartão, as parcelas cobertas viram "pagas" no Meu Portal e somem da
//    inadimplência. Boleto já gerado de uma delas é cancelado no Asaas.
//
// Fica em paymentPlan.restanteAgora (sem tabela nova). Referência no Asaas:
// `portal-restante:<registrationId>`.

import { prisma } from '../lib/prisma.js'
import { logEvent } from './leadHistory.js'
import { registrarEventoDaInscricao } from './inscricaoAssistida.js'
import { faturasDaInscricao, inscricoesDaConta } from './areaDoAluno.js'
import { conexaoDaInscricao, conexaoAceitaCombinado, configDaInscricao, cancelarNoGateway, hojeBr } from './pagamentoCombinado.js'
import { createAsaasOrder, createOrFindAsaasCustomer, silenciarAvisosDeCriacaoAsaas, ASAAS_STATUS_MAP } from './paymentAsaas.js'
import { avaliarCupom } from './portalCupom.js'
import { cobrancaDoPortal } from './portalCobranca.js'
import { ehSimulado, criarCobrancaSimulada } from './pagamentoSimulado.js'

export type SituacaoDoRestante = 'liberado' | 'aguardando' | 'pago' | 'cancelado' | 'estornado'

export interface RestanteAgora {
  status: SituacaoDoRestante
  numeros: number[]
  valorCentavos: number
  parcelasMax: number
  motivo: string
  liberadoEm: string
  porUserId: number | null
  porNome: string | null
  cobranca?: {
    id: string
    installmentId: string | null
    invoiceUrl: string | null
    provider: string
    valorCentavos: number
    descontoCentavos: number
    cupom: string | null
    parcelas: number
    em: string
  } | null
  pagoEm?: string | null
  encerradoEm?: string | null
  encerradoPor?: string | null
}

export interface ParcelaRestante {
  numero: number
  titulo: string
  valorCentavos: number
  vencimento: string | null
  situacao: string
  /** Boleto já gerado (Asaas) — é cancelado quando o cartão for aprovado. */
  cobrancaId: string | null
}

interface Operador { userId: number; nome: string }
type Erro = { ok: false; status: number; erro: string }

const FECHADAS = ['cancelled', 'transferred', 'merged', 'expired']
const VIVOS: SituacaoDoRestante[] = ['liberado', 'aguardando']
const PARCELAS_MAX = 12
const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/** O que está gravado na inscrição (ou null). */
export function lerRestante(plano: unknown): RestanteAgora | null {
  const r = (plano as any)?.restanteAgora
  return r && typeof r === 'object' && Array.isArray(r.numeros) ? (r as RestanteAgora) : null
}

async function regCompleta(registrationId: number) {
  const base = await prisma.enrollmentRegistration.findUnique({ where: { id: registrationId }, select: { leadId: true } })
  if (!base?.leadId) return null
  return (await inscricoesDaConta(base.leadId)).find((x) => x.id === registrationId) ?? null
}

/**
 * Parcelas que ainda faltam pagar: previstas (não geradas) e boletos gerados em
 * aberto das parcelas do Meu Portal. Pagamento combinado/acordo tem a própria
 * ferramenta (Alterar forma de pagamento) e não entra aqui.
 */
export async function parcelasRestantes(registrationId: number): Promise<ParcelaRestante[]> {
  const r = await regCompleta(registrationId)
  if (!r) return []
  const plano = (r.paymentPlan ?? {}) as any
  if (plano.combinado) return []
  const { faturas } = await faturasDaInscricao(r)
  const porCobranca = new Map<string, number>()
  for (const [n, g] of Object.entries((plano.parcelasPortal ?? {}) as Record<string, any>)) if (g?.id) porCobranca.set(String(g.id), Number(n))
  const out: ParcelaRestante[] = []
  for (const f of faturas) {
    let numero: number | null = null
    let cobrancaId: string | null = null
    const prev = f.chave.match(/^prevista:\d+:(\d+)$/)
    if (prev && f.situacao === 'prevista') numero = Number(prev[1])
    const asaas = f.chave.match(/^asaas:(.+)$/)
    if (asaas && (f.situacao === 'aberta' || f.situacao === 'vencida') && porCobranca.has(asaas[1]!)) {
      numero = porCobranca.get(asaas[1]!)!
      cobrancaId = asaas[1]!
    }
    if (numero == null) continue
    out.push({ numero, titulo: f.titulo, valorCentavos: Math.round(f.valor * 100), vencimento: f.vencimento, situacao: f.situacao, cobrancaId })
  }
  return out.sort((a, b) => a.numero - b.numero)
}

/** Painel: as parcelas que faltam e a situação da liberação. */
export async function estadoDoRestante(registrationId: number) {
  const reg = await prisma.enrollmentRegistration.findUnique({ where: { id: registrationId }, select: { status: true, paymentStatus: true, paymentPlan: true } })
  if (!reg) return null
  const restante = lerRestante(reg.paymentPlan)
  const parcelas = await parcelasRestantes(registrationId)
  const conn = await conexaoDaInscricao(registrationId)
  let impedimento: string | null = null
  if (FECHADAS.includes(reg.status)) impedimento = 'A inscrição está encerrada.'
  else if (reg.paymentStatus !== 'paid') impedimento = 'A 1ª cobrança ainda não foi paga: troque a forma por "Trocar plano".'
  else if ((reg.paymentPlan as any)?.combinado) impedimento = 'Pagamento combinado: use "Alterar forma de pagamento".'
  else if (!conexaoAceitaCombinado(conn)) impedimento = 'O portal desta inscrição não tem conexão Asaas ativa.'
  else if (!parcelas.length && !(restante && VIVOS.includes(restante.status))) impedimento = 'Não há parcelas a pagar.'
  return { parcelas, restante, impedimento, parcelasMax: PARCELAS_MAX }
}

/** Agente libera o pagamento do restante no cartão para o aluno. */
export async function liberarRestante(registrationId: number, body: any, op: Operador): Promise<{ ok: true; valorCentavos: number } | Erro> {
  const e = await estadoDoRestante(registrationId)
  if (!e) return { ok: false, status: 404, erro: 'Inscrição não encontrada.' }
  if (e.impedimento) return { ok: false, status: 409, erro: e.impedimento }
  if (e.restante && VIVOS.includes(e.restante.status)) return { ok: false, status: 409, erro: 'Já há um pagamento do restante liberado. Cancele antes de liberar outro.' }
  const pedidas = Array.isArray(body?.numeros) ? (body.numeros as unknown[]).map(Number).filter(Number.isInteger) : e.parcelas.map((p) => p.numero)
  const escolhidas = e.parcelas.filter((p) => pedidas.includes(p.numero))
  if (!escolhidas.length) return { ok: false, status: 400, erro: 'Escolha ao menos uma parcela.' }
  const parcelasMax = Math.min(PARCELAS_MAX, Math.max(1, Math.round(Number(body?.parcelasMax) || 1)))
  const motivo = String(body?.motivo ?? '').trim().slice(0, 500)
  if (motivo.length < 3) return { ok: false, status: 400, erro: 'Informe o motivo (ex.: "aluno quer quitar a diferença no cartão").' }
  const valorCentavos = escolhidas.reduce((s, p) => s + p.valorCentavos, 0)
  const restante: RestanteAgora = {
    status: 'liberado', numeros: escolhidas.map((p) => p.numero), valorCentavos, parcelasMax, motivo,
    liberadoEm: new Date().toISOString(), porUserId: op.userId, porNome: op.nome, cobranca: null,
  }
  await gravar(registrationId, restante)
  await registrarEventoDaInscricao({
    registrationId, etapa: 'pagamento', acao: 'restante_liberado', ator: 'atendente', userId: op.userId, userName: op.nome,
    dados: { parcelas: restante.numeros, valor: valorCentavos / 100, parcelasMax, motivo },
  })
  return { ok: true, valorCentavos }
}

/** Agente cancela a liberação (e a cobrança do cartão, se o aluno já tinha aberto). */
export async function cancelarRestante(registrationId: number, op: Operador): Promise<{ ok: true } | Erro> {
  const reg = await prisma.enrollmentRegistration.findUnique({ where: { id: registrationId }, select: { paymentPlan: true } })
  const restante = lerRestante(reg?.paymentPlan)
  if (!restante || !VIVOS.includes(restante.status)) return { ok: false, status: 409, erro: 'Não há pagamento do restante liberado.' }
  if (restante.cobranca?.id) {
    const c = await cancelarCobranca(registrationId, restante)
    if (!c.ok) return { ok: false, status: 502, erro: `Não foi possível cancelar a cobrança no Asaas (${c.message}). Tente de novo.` }
  }
  await gravar(registrationId, { ...restante, status: 'cancelado', encerradoEm: new Date().toISOString(), encerradoPor: op.nome })
  await registrarEventoDaInscricao({ registrationId, etapa: 'pagamento', acao: 'restante_cancelado', ator: 'atendente', userId: op.userId, userName: op.nome, dados: { valor: restante.valorCentavos / 100 } })
  return { ok: true }
}

async function cancelarCobranca(registrationId: number, restante: RestanteAgora): Promise<{ ok: true } | { ok: false; message: string }> {
  const c = restante.cobranca
  if (!c?.id || c.provider !== 'asaas') return { ok: true }
  return cancelarNoGateway(await configDaInscricao(registrationId), { externalId: c.id, installmentId: c.installmentId, provider: 'asaas' })
}

async function gravar(registrationId: number, restante: RestanteAgora) {
  // Relê antes de gravar: outro campo do paymentPlan pode ter mudado.
  const atual = await prisma.enrollmentRegistration.findUnique({ where: { id: registrationId }, select: { paymentPlan: true } })
  await prisma.enrollmentRegistration.update({
    where: { id: registrationId },
    data: { paymentPlan: { ...((atual?.paymentPlan ?? {}) as any), restanteAgora: restante } as any },
  })
}

// ─── Meu Portal (o aluno) ───────────────────────────────────────────────────

/** O que o Meu Portal mostra. As parcelas pagas no meio do caminho saem da conta. */
export async function restanteParaAluno(r: { id: number; paymentPlan: unknown }) {
  const restante = lerRestante(r.paymentPlan)
  if (!restante || !VIVOS.includes(restante.status)) return null
  const abertas = await parcelasRestantes(r.id)
  const numeros = restante.numeros.filter((n) => abertas.some((p) => p.numero === n))
  // Aguardando o cartão: as parcelas seguem "abertas" até a aprovação.
  if (!numeros.length && restante.status === 'liberado') return null
  const valorCentavos = restante.status === 'aguardando' && restante.cobranca
    ? restante.valorCentavos
    : abertas.filter((p) => numeros.includes(p.numero)).reduce((s, p) => s + p.valorCentavos, 0)
  return {
    valor: valorCentavos / 100,
    parcelas: numeros.length || restante.numeros.length,
    parcelasMax: restante.parcelasMax,
    aguardando: restante.status === 'aguardando' && restante.cobranca
      ? { link: restante.cobranca.invoiceUrl, valor: restante.cobranca.valorCentavos / 100, parcelas: restante.cobranca.parcelas, cupom: restante.cobranca.cupom }
      : null,
  }
}

async function regDoAluno(leadId: number, codigo: string) {
  const r = (await inscricoesDaConta(leadId)).find((x) => x.candidateCode === codigo)
  return r && r.portal?.areaDoAluno ? r : null
}

/** Valor com o cupom (prévia, sem gravar nada). */
async function comCupom(r: { id: number; portalId: number; formData: unknown }, valorCentavos: number, codigo: string | null) {
  if (!codigo) return { ok: true as const, valorCentavos, descontoCentavos: 0, cupom: null as string | null, maxParcelas: null as number | null }
  const ctx = (await cobrancaDoPortal(r.id).catch(() => null))?.contexto ?? null
  const fd = (r.formData ?? {}) as Record<string, any>
  const a = await avaliarCupom({
    codigo, valor: valorCentavos / 100, portalId: r.portalId, cpf: String(fd.cpf || '').replace(/\D/g, '') || null,
    contexto: ctx, escopo: 'curso', metodo: 'credit_card',
  })
  if ('valido' in a && a.valido === false) return { ok: false as const, erro: a.motivo }
  const ap = a as Exclude<typeof a, { valido: false }>
  const final = Math.max(0, Math.round(ap.valorComCupom * 100))
  return { ok: true as const, valorCentavos: final, descontoCentavos: valorCentavos - final, cupom: ap.code, maxParcelas: ap.maxParcelas }
}

export async function previaDoCupom(leadId: number, codigo: string, cupom: string) {
  const r = await regDoAluno(leadId, codigo)
  if (!r) return { ok: false as const, status: 404, erro: 'Inscrição não encontrada.' }
  const v = await restanteParaAluno(r)
  if (!v) return { ok: false as const, status: 409, erro: 'Não há pagamento do restante liberado.' }
  const c = await comCupom(r, Math.round(v.valor * 100), cupom.trim() || null)
  if (!c.ok) return { ok: false as const, status: 400, erro: c.erro }
  return { ok: true as const, valor: c.valorCentavos / 100, desconto: c.descontoCentavos / 100, cupom: c.cupom, parcelasMax: Math.min(v.parcelasMax, c.maxParcelas ?? v.parcelasMax) }
}

/** O aluno escolheu as vezes (e o cupom): cria a cobrança no cartão e devolve o link. */
export async function pagarRestante(leadId: number, codigo: string, body: any, req?: any): Promise<{ ok: true; link: string } | Erro> {
  const r = await regDoAluno(leadId, codigo)
  if (!r) return { ok: false, status: 404, erro: 'Inscrição não encontrada.' }
  const restante = lerRestante(r.paymentPlan)
  if (!restante || !VIVOS.includes(restante.status)) return { ok: false, status: 409, erro: 'Não há pagamento do restante liberado. Fale com a secretaria.' }
  if ((r.paymentPlan as any)?.demonstracao) return { ok: false, status: 409, erro: 'Inscrição de demonstração: a cobrança não é gerada de verdade.' }
  const abertas = await parcelasRestantes(r.id)
  const escolhidas = abertas.filter((p) => restante.numeros.includes(p.numero))
  if (!escolhidas.length) return { ok: false, status: 409, erro: 'As parcelas já foram pagas.' }
  const cheio = escolhidas.reduce((s, p) => s + p.valorCentavos, 0)
  const c = await comCupom(r, cheio, String(body?.cupom ?? '').trim() || null)
  if (!c.ok) return { ok: false, status: 400, erro: c.erro }
  if (c.valorCentavos <= 0) return { ok: false, status: 400, erro: 'Com este cupom não sobra valor a pagar: fale com a secretaria.' }
  const maximo = Math.min(restante.parcelasMax, c.maxParcelas ?? restante.parcelasMax)
  const parcelas = Math.min(maximo, Math.max(1, Math.round(Number(body?.parcelas) || 1)))

  // Mesma escolha de antes e o link ainda vale: reaproveita (cliques repetidos).
  const ant = restante.status === 'aguardando' ? restante.cobranca : null
  if (ant && ant.parcelas === parcelas && ant.valorCentavos === c.valorCentavos && ant.cupom === c.cupom && ant.invoiceUrl) return { ok: true, link: ant.invoiceUrl }
  if (ant) {
    const x = await cancelarCobranca(r.id, restante)
    if (!x.ok) return { ok: false, status: 502, erro: 'Não foi possível trocar a forma agora. Tente de novo em alguns minutos.' }
  }

  const conn = await conexaoDaInscricao(r.id)
  if (!conexaoAceitaCombinado(conn)) return { ok: false, status: 503, erro: 'Pagamento indisponível no momento. Fale com a secretaria.' }
  const fd = (r.formData ?? {}) as Record<string, any>
  const valor = c.valorCentavos / 100
  const amanha = new Date(Date.now() + 86_400_000)
  const descricao = `Restante do curso (${escolhidas.length} ${escolhidas.length === 1 ? 'parcela' : 'parcelas'}) — ${r.candidateCode}`
  const referencia = `portal-restante:${r.id}`
  let cobranca: NonNullable<RestanteAgora['cobranca']>
  try {
    if (ehSimulado(conn!.provider)) {
      const sim = criarCobrancaSimulada({ metodo: 'credit_card', valor, vencimento: amanha, referencia, descricao } as any)
      cobranca = { id: sim.chargeId, installmentId: null, invoiceUrl: (sim as any).invoiceUrl ?? (sim as any).paymentUrl ?? null, provider: 'simulado', valorCentavos: c.valorCentavos, descontoCentavos: c.descontoCentavos, cupom: c.cupom, parcelas, em: new Date().toISOString() }
    } else {
      const cfg = await configDaInscricao(r.id)
      if (!cfg) return { ok: false, status: 503, erro: 'Pagamento indisponível no momento. Fale com a secretaria.' }
      const cpf = String(fd.cpf || '').replace(/\D/g, '')
      if (!cpf) return { ok: false, status: 400, erro: 'A inscrição não tem CPF: fale com a secretaria.' }
      const cliente = { name: r.lead?.nome || String(fd.nome || 'Aluno'), email: r.lead?.email || fd.email || undefined, cpfCnpj: cpf, mobilePhone: r.lead?.whatsapp || fd.whatsapp || undefined, externalReference: `lead-${leadId}`,
        // Responsável financeiro empresa (CNPJ): a cobrança sai no nome dela.
        ...((await import('./dadosCadastro.js')).pagadorEmpresa(fd) ?? {}) }
      // Como no combinado: o Asaas não manda e-mail/SMS da cobrança (nenhum envio automático).
      const cus = await createOrFindAsaasCustomer(cfg, cliente as any)
      await silenciarAvisosDeCriacaoAsaas(cfg, cus.id).catch(() => {})
      const o = await createAsaasOrder(cfg, {
        method: 'credit_card',
        customer: cliente as any,
        value: valor, dueDate: amanha, description: descricao, externalReference: referencia, hospedado: true,
        ...(parcelas > 1 ? { installmentCount: parcelas } : {}),
      } as any)
      cobranca = { id: o.paymentId, installmentId: o.installmentId ?? null, invoiceUrl: o.invoiceUrl ?? null, provider: 'asaas', valorCentavos: c.valorCentavos, descontoCentavos: c.descontoCentavos, cupom: c.cupom, parcelas, em: new Date().toISOString() }
    }
  } catch (e: any) {
    return { ok: false, status: 502, erro: 'Não foi possível abrir o pagamento no cartão agora. Tente de novo em alguns minutos.' }
  }
  if (!cobranca.invoiceUrl) return { ok: false, status: 502, erro: 'O pagamento foi criado, mas o link não voltou. Atualize a página.' }
  await gravar(r.id, { ...restante, status: 'aguardando', valorCentavos: cheio, numeros: escolhidas.map((p) => p.numero), cobranca })
  await registrarEventoDaInscricao({
    registrationId: r.id, etapa: 'pagamento', acao: 'restante_cobranca_criada', ator: 'candidato', req: req ?? null,
    dados: { valor, valorCheio: cheio / 100, desconto: c.descontoCentavos / 100, cupom: c.cupom, parcelas, cobranca: cobranca.id },
  })
  return { ok: true, link: cobranca.invoiceUrl }
}

// ─── Aviso do gateway ───────────────────────────────────────────────────────

/**
 * Aviso do Asaas da cobrança do restante. Cartão parcelado: chega um aviso por
 * parcela da compra, todos com a mesma referência — vale o 1º pago.
 */
export async function aplicarAvisoDoRestante(registrationId: number, event: string, payment: any): Promise<boolean> {
  const reg = await prisma.enrollmentRegistration.findUnique({ where: { id: registrationId }, select: { paymentPlan: true, leadId: true, candidateCode: true } })
  const plano = (reg?.paymentPlan ?? null) as Record<string, any> | null
  const restante = lerRestante(plano)
  if (!plano || !restante?.cobranca) return false
  const c = restante.cobranca
  const daCobranca = payment?.id === c.id || (!!c.installmentId && payment?.installment === c.installmentId)
  if (!daCobranca) return true // aviso de uma cobrança substituída: nada a fazer
  const novo = event === 'PAYMENT_DELETED' || payment?.deleted ? 'canceled' : (ASAAS_STATUS_MAP[payment?.status] || 'pending')

  if (novo === 'paid' && restante.status !== 'pago') {
    const pagaEm = payment?.paymentDate ?? payment?.confirmedDate ?? hojeBr()
    const pp = { ...((plano.parcelasPortal ?? {}) as Record<string, any>) }
    const boletos: string[] = []
    for (const n of restante.numeros) {
      const g = pp[String(n)]
      if (g?.id && (!g.situacao || g.situacao === 'aberta')) boletos.push(String(g.id))
      if (g?.situacao === 'paga' && !g.viaRestante) continue // paga por fora antes: não sobrescreve
      pp[String(n)] = { ...(g ?? {}), situacao: 'paga', pagaEm, viaRestante: c.installmentId ?? c.id, ...(g?.id ? { boletoCancelado: g.id } : {}) }
    }
    await prisma.enrollmentRegistration.update({
      where: { id: registrationId },
      data: { paymentPlan: { ...plano, parcelasPortal: pp, restanteAgora: { ...restante, status: 'pago', pagoEm: pagaEm } } as any },
    })
    // Boleto que o aluno tinha gerado de uma das parcelas: não pode mais ser pago.
    const cfg = boletos.length ? await configDaInscricao(registrationId) : null
    for (const id of boletos) await cancelarNoGateway(cfg, { externalId: id, installmentId: null, provider: 'asaas' }).catch(() => {})
    if (c.cupom) await registrarUsoDoCupom(registrationId, c).catch(() => {})
    await registrarEventoDaInscricao({ registrationId, etapa: 'pagamento', acao: 'restante_pago', ator: 'sistema', dados: { parcelas: restante.numeros, valor: c.valorCentavos / 100, vezes: c.parcelas, cupom: c.cupom, cobranca: c.id, pagaEm } })
    if (reg?.leadId) {
      logEvent({
        leadId: reg.leadId, type: 'payment_received', category: 'lifecycle', channel: 'payment', source: 'asaas', actorType: 'system',
        title: `Restante pago no cartão — ${restante.numeros.length} ${restante.numeros.length === 1 ? 'parcela' : 'parcelas'} · ${reg.candidateCode}`,
        description: `${brl(c.valorCentavos)} em ${c.parcelas}x${c.cupom ? ` · cupom ${c.cupom}` : ''}`,
        metadata: { parcelas: restante.numeros, paymentId: c.id, origem: 'restante_agora' },
      })
    }
    return true
  }

  if ((novo === 'refunded' || novo === 'canceled') && restante.status === 'pago') {
    // Estorno do cartão: as parcelas voltam a ser devidas.
    const pp = { ...((plano.parcelasPortal ?? {}) as Record<string, any>) }
    for (const n of restante.numeros) {
      const g = pp[String(n)]
      if (g?.viaRestante) { const { viaRestante: _v, boletoCancelado: _b, pagaEm: _p, ...resto } = g; delete pp[String(n)]; if (resto.id && !_b) pp[String(n)] = { ...resto, situacao: 'aberta' } }
    }
    await prisma.enrollmentRegistration.update({
      where: { id: registrationId },
      data: { paymentPlan: { ...plano, parcelasPortal: pp, restanteAgora: { ...restante, status: 'estornado', encerradoEm: new Date().toISOString() } } as any },
    })
    await registrarEventoDaInscricao({ registrationId, etapa: 'pagamento', acao: 'restante_estornado', ator: 'sistema', dados: { parcelas: restante.numeros, cobranca: c.id } })
    return true
  }

  if (novo === 'canceled' && restante.status === 'aguardando') {
    // Cobrança apagada no Asaas antes de pagar: volta a "liberado" (o aluno tenta de novo).
    await gravar(registrationId, { ...restante, status: 'liberado', cobranca: null })
  }
  return true
}

async function registrarUsoDoCupom(registrationId: number, c: NonNullable<RestanteAgora['cobranca']>) {
  const cupom = await prisma.coupon.findUnique({ where: { code: c.cupom! } })
  if (!cupom) return
  await prisma.$transaction([
    prisma.couponRedemption.create({ data: {
      couponId: cupom.id, registrationId,
      amountBefore: (c.valorCentavos + c.descontoCentavos) / 100, discountValue: c.descontoCentavos / 100, amountAfter: c.valorCentavos / 100,
      couponSnapshot: { code: cupom.code, type: cupom.type, value: Number(cupom.value), uso: 'restante_agora' } as any,
    } }),
    prisma.coupon.update({ where: { id: cupom.id }, data: { usageCount: { increment: 1 } } }),
  ])
}
