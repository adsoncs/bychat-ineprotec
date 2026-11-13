// src/routes/portalFinanceiro.ts
//
// Financeiro das matrículas do portal (Educacional › Financeiro do portal).
//
// É o que entrou pelo checkout: taxa de inscrição ou, quando o portal cobra o
// curso, a matrícula/1ª mensalidade. As mensalidades seguintes são do ERP
// (Acadêmico › Financeiro) e não aparecem aqui — a divisão é a mesma que o
// contrato usa ao abater o que já foi pago no portal.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { adminOnly, type JwtPayload } from '../lib/auth.js'
import { logEvent } from '../services/leadHistory.js'
import { iuguDaConexao, cancelarFaturaIugu, baixaExternaIugu, estornarFaturaIugu, buscarFaturaIugu, enviarFaturaPorEmailIugu } from '../services/paymentIugu.js'
import { appUrl } from '../lib/appUrl.js'
import { guardTela } from '../lib/eduTelas.js'

type Situacao = 'pago' | 'pendente' | 'vencido' | 'falhou' | 'estornado' | 'cancelado' | 'transferido' | 'sem_cobranca'

/** Situação que a secretaria entende, a partir dos campos de pagamento. */
function situacaoDe(r: { paymentStatus: string | null; paymentExpiresAt: Date | null; status: string | null; paymentId: string | null }): Situacao {
  const ps = String(r.paymentStatus || '')
  if (ps === 'paid') return 'pago'
  if (ps === 'refunded') return 'estornado'
  if (r.status === 'transferred' && ps !== 'paid') return 'transferido'
  if (r.status === 'cancelled' && ps !== 'paid') return 'cancelado'
  if (ps === 'failed') return 'falhou'
  if (ps === 'overdue' || ps === 'expired') return 'vencido'
  if (ps === 'pending') return r.paymentExpiresAt && r.paymentExpiresAt < new Date() ? 'vencido' : 'pendente'
  return r.paymentId ? 'pendente' : 'sem_cobranca'
}

const meioDe = (m: string | null | undefined): 'pix' | 'boleto' | 'cartao' | 'link' | 'manual' | 'credito' | null => {
  const s = String(m || '').toUpperCase()
  // Crédito de transferência de curso: não é dinheiro novo nem cartão (contém "CREDIT").
  if (s === 'CREDITO') return 'credito'
  if (s.includes('PIX')) return 'pix'
  if (s.includes('BOLETO') || s.includes('BANK_SLIP')) return 'boleto'
  if (s.includes('CARD') || s.includes('CREDIT')) return 'cartao'
  if (s === 'MANUAL') return 'manual'
  if (s === 'UNDEFINED' || s === 'LINK') return 'link'
  return null
}

const mascaraCpf = (c: unknown) => {
  const d = String(c ?? '').replace(/\D/g, '')
  return d.length === 11 ? `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**` : null
}

const SELECT_LINHA = {
  id: true, candidateCode: true, status: true, createdAt: true, formData: true,
  paymentId: true, paymentStatus: true, paymentAmount: true, paymentMethod: true,
  paymentPaidAt: true, paymentExpiresAt: true, paymentPlan: true, paymentUrl: true,
  lead: { select: { id: true, nome: true, email: true, whatsapp: true } },
  portal: { select: { id: true, nome: true, paymentScope: true, paymentConnection: { select: { provider: true } } } },
  processRegistration: {
    select: {
      selectionProcess: { select: { id: true, nome: true, taxaInscricao: true } },
      offering: { select: { id: true, nome: true, course: { select: { id: true, nome: true } } } },
    },
  },
  paymentMethods: { orderBy: { createdAt: 'desc' as const }, take: 1, select: { provider: true, method: true, status: true } },
  titulos: { select: { ordem: true, origem: true, meio: true, pagoComo: true, status: true, valorCentavos: true, valorPagoCentavos: true, paidAt: true, vencimento: true, externalId: true } },
  _count: { select: { paymentMethods: true } },
} as const

/** Dia de Brasília (YYYY-MM-DD) de uma data com hora, ou a própria data. */
const diaBr = (v: Date | string | null | undefined): string | null => {
  if (!v) return null
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d)
}
const hojeBrDia = () => diaBr(new Date())!
const centavos = (n: number) => Math.round(n * 100) / 100

/** Cada dinheiro que ENTROU (no dia em que entrou) e cada cobrança da matrícula
 *  com o seu vencimento: 1ª cobrança do portal, parcelas geradas no Meu Portal e
 *  títulos do combinado/acordo. O título que é a própria 1ª cobrança (mesmo id
 *  no gateway) conta uma vez só. */
export interface Recebimento { dia: string; em: string | null; valor: number; meio: string | null; origem: 'cobranca' | 'parcela' | 'titulo'; rotulo: string }
export interface Vencimento { dia: string; valor: number; paga: boolean; rotulo: string }
function movimentos(r: any, plano: Record<string, any>) {
  const recebimentos: Recebimento[] = []
  // Transferida (troca de curso, pela ferramenta ou à mão): o que ela recebeu
  // virou crédito na inscrição nova, que já conta como pago. Contar aqui também
  // dobrava o recebido (Valdeci 2026-11: 173,90 no dia 10 e de novo no dia 11).
  // Mesma regra da Receita única.
  const transferida = r.status === 'transferred'
  // Expirada: a inscrição não seguiu, então o que não foi pago não é dívida (decisão de 13/11/2026).
  // O que ela pagou continua contando como recebido.
  const expirada = r.status === 'expired'
  const vencimentos: Vencimento[] = []
  // Combinado: o plano diz "combinado"; o meio é o do título que é a 1ª cobrança.
  const tituloDaReg = ((r.titulos ?? []) as any[]).find((t) => t.externalId && t.externalId === r.paymentId)
  const meioDaReg = meioDe(plano.meio ?? r.paymentMethod) ?? meioDe(tituloDaReg?.pagoComo ?? tituloDaReg?.meio) ?? meioDe(r.paymentMethods?.[0]?.method)
  // No combinado o paymentAmount é o TOTAL combinado; a 1ª cobrança vale só o
  // título dela (Gabrielly 2PZE: 1.750 + título de 1.450 somava 3.200).
  const valorDaReg = tituloDaReg
    ? (tituloDaReg.status === 'paga' && tituloDaReg.valorPagoCentavos ? tituloDaReg.valorPagoCentavos : tituloDaReg.valorCentavos) / 100
    : r.paymentStatus === 'paid'
      ? Number(r.paymentAmount ?? plano.valorCobrado ?? 0)
      : Number(plano.valorCobrado ?? r.paymentAmount ?? 0)
  const nParcelas = Number(plano.parcelas ?? 1) || 1
  const rotuloReg = nParcelas > 1 ? `Parcela 1 de ${nParcelas}` : (plano.rotulo ?? 'Cobrança')
  if (r.paymentStatus === 'paid' && r.paymentPaidAt && !transferida) {
    recebimentos.push({ dia: diaBr(r.paymentPaidAt)!, em: new Date(r.paymentPaidAt).toISOString(), valor: valorDaReg, meio: meioDaReg, origem: 'cobranca', rotulo: rotuloReg })
  }
  if (r.paymentExpiresAt && r.paymentStatus !== 'refunded' && r.status !== 'cancelled' && r.status !== 'transferred' && !(expirada && r.paymentStatus !== 'paid')) {
    vencimentos.push({ dia: diaBr(r.paymentExpiresAt)!, valor: valorDaReg, paga: r.paymentStatus === 'paid', rotulo: rotuloReg })
  }
  for (const [n, g] of Object.entries((plano.parcelasPortal ?? {}) as Record<string, any>)) {
    if (!g || g.situacao === 'renegociada' || g.situacao === 'cancelada') continue
    const rot = `Parcela ${n}${nParcelas > 1 ? ` de ${nParcelas}` : ''}`
    const valor = Number(g.valor ?? 0)
    if (g.situacao === 'paga' && g.pagaEm && !transferida) recebimentos.push({ dia: diaBr(g.pagaEm)!, em: String(g.pagaEm).length > 10 ? String(g.pagaEm) : null, valor, meio: 'boleto', origem: 'parcela', rotulo: rot })
    if (g.vencimento && !(expirada && g.situacao !== 'paga')) vencimentos.push({ dia: String(g.vencimento).slice(0, 10), valor, paga: g.situacao === 'paga', rotulo: rot })
  }
  const titulos = (r.titulos ?? []) as any[]
  const totalTit = titulos.filter((t) => t.status !== 'cancelada' && t.status !== 'renegociada').length
  for (const t of titulos) {
    if (t.externalId && r.paymentId && t.externalId === r.paymentId) continue // é a 1ª cobrança
    if (['cancelada', 'renegociada', 'estornada', 'substituida'].includes(t.status)) continue // substituída: trocada por outra forma
    const rot = `${t.origem === 'acordo' ? 'Acordo' : 'Pagamento'} ${t.ordem}${totalTit > 1 ? ` de ${totalTit}` : ''}`
    const valor = (t.status === 'paga' && t.valorPagoCentavos ? t.valorPagoCentavos : t.valorCentavos) / 100
    if (t.status === 'paga' && t.paidAt && !transferida) recebimentos.push({ dia: diaBr(t.paidAt)!, em: new Date(t.paidAt).toISOString(), valor, meio: meioDe(t.pagoComo ?? t.meio), origem: 'titulo', rotulo: rot })
    if (t.vencimento && !(expirada && t.status !== 'paga')) vencimentos.push({ dia: t.vencimento, valor, paga: t.status === 'paga', rotulo: rot })
  }
  recebimentos.sort((a, b) => a.dia.localeCompare(b.dia))
  vencimentos.sort((a, b) => a.dia.localeCompare(b.dia))
  const hoje = hojeBrDia()
  const abertos = vencimentos.filter((v) => !v.paga)
  return {
    recebimentos,
    vencimentos,
    recebidoTotal: centavos(recebimentos.reduce((a, x) => a + x.valor, 0)),
    pagamentosFeitos: recebimentos.length,
    ultimoPagamento: recebimentos.length ? (recebimentos[recebimentos.length - 1]!.em ?? recebimentos[recebimentos.length - 1]!.dia) : null,
    emAberto: centavos(abertos.reduce((a, x) => a + x.valor, 0)),
    vencidoValor: centavos(abertos.filter((v) => v.dia < hoje).reduce((a, x) => a + x.valor, 0)),
    parcelasEmAberto: abertos.length,
    proximoVencimento: abertos.find((v) => v.dia >= hoje)?.dia ?? null,
    vencimentoMaisAntigo: abertos[0]?.dia ?? null,
  }
}

function linha(r: any) {
  const plano = (r.paymentPlan ?? {}) as Record<string, any>
  const escopo = plano.escopo === 'curso' || (!plano.escopo && r.portal?.paymentScope === 'curso') ? 'curso' : 'taxa'
  // Valor cheio (antes de cupom e desconto): valorCheio é gravado desde o
  // cupom; nas cobranças antigas, o de tabela é o cheio.
  const valorTabela = Number(plano.valorCheio ?? plano.valorTabela ?? (escopo === 'taxa' ? r.processRegistration?.selectionProcess?.taxaInscricao : 0) ?? 0) || null
  const descontoCupom = Number(plano.descontoCupom ?? 0)
  const descontoAVista = Number(plano.descontoAVista ?? 0)
  const ultimo = r.paymentMethods?.[0]
  // Parcelas seguintes geradas e pagas pelo aluno no Meu Portal (boleto
  // parcelado). Não são a cobrança da inscrição, mas são dinheiro recebido:
  // antes ficavam fora do Financeiro e só o aluno as via.
  const parcelasPortal = Object.entries((plano.parcelasPortal ?? {}) as Record<string, any>)
    .map(([n, g]) => ({ numero: Number(n), valor: g?.valor != null ? Number(g.valor) : null, vencimento: g?.vencimento ?? null, situacao: String(g?.situacao ?? 'aberta'), pagaEm: g?.pagaEm ?? null, invoiceUrl: g?.invoiceUrl ?? null, cobranca: g?.id ?? null }))
    .sort((a, b) => a.numero - b.numero)
  const recebidoParcelas = Math.round(parcelasPortal.filter((p) => p.situacao === 'paga').reduce((a, p) => a + (p.valor ?? 0), 0) * 100) / 100
  const mov = movimentos(r, plano)
  return {
    ...mov,
    /** No período do filtro (preenchido em recortar). */
    recebidoNoPeriodo: null as number | null,
    venceNoPeriodo: null as number | null,
    id: r.id,
    candidateCode: r.candidateCode,
    nome: r.lead?.nome ?? (r.formData as any)?.nome ?? null,
    leadId: r.lead?.id ?? null,
    email: r.lead?.email ?? null,
    whatsapp: r.lead?.whatsapp ?? null,
    cpf: mascaraCpf((r.formData as any)?.cpf),
    portal: r.portal ? { id: r.portal.id, nome: r.portal.nome } : null,
    curso: r.processRegistration?.offering?.course ?? null,
    oferta: r.processRegistration?.offering ? { id: r.processRegistration.offering.id, nome: r.processRegistration.offering.nome } : null,
    processo: r.processRegistration?.selectionProcess ? { id: r.processRegistration.selectionProcess.id, nome: r.processRegistration.selectionProcess.nome } : null,
    escopo,
    rotulo: plano.rotulo ?? (escopo === 'curso' ? 'Matrícula / 1ª mensalidade' : 'Taxa de inscrição'),
    valorTabela,
    descontoCupom,
    descontoAVista,
    cupom: plano.cupom ?? null,
    acrescimo: Number(plano.acrescimo ?? 0),
    // O que a instituição recebe de fato (cupom e desconto já aplicados; antes
    // das taxas do gateway). Pago: o valor confirmado. Em aberto: o da cobrança
    // vigente, gravado no plano — o paymentAmount já foi sujo por sincronização
    // de cobrança antiga (R$ 2.508 numa inscrição de boleto de R$ 5,02).
    valorCobrado: r.paymentStatus === 'paid'
      ? (r.paymentAmount != null ? Number(r.paymentAmount) : plano.valorCobrado != null ? Number(plano.valorCobrado) : null)
      : (plano.valorCobrado != null ? Number(plano.valorCobrado) : r.paymentAmount != null ? Number(r.paymentAmount) : null),
    /** Inscrições da mesma pessoa mescladas nesta (preenchido na consulta). */
    mescladas: [] as string[],
    parcelas: Number(plano.parcelas ?? 1) || 1,
    meio: meioDe(plano.meio ?? r.paymentMethod) ?? meioDe(mov.recebimentos[0]?.meio) ?? meioDe(r.paymentMethods?.[0]?.method),
    gateway: ultimo?.provider ?? r.portal?.paymentConnection?.provider ?? null,
    situacao: situacaoDe(r),
    paymentStatus: r.paymentStatus,
    inscricaoStatus: r.status,
    pagoEm: r.paymentPaidAt,
    portalId: r.portal?.id ?? null,
    venceEm: r.paymentExpiresAt,
    criadoEm: r.createdAt,
    tentativas: r._count?.paymentMethods ?? 0,
    temLink: !!r.paymentUrl,
    parcelasPortal,
    recebidoParcelas,
  }
}

function filtros(q: any) {
  // Mesclada em outra (duplicidade) não é linha própria: entra na principal.
  const where: any = { OR: [{ paymentId: { not: null } }, { portal: { requirePayment: true } }], status: { not: 'merged' } }
  const de = q.de ? new Date(`${q.de}T00:00:00-03:00`) : null
  const ate = q.ate ? new Date(`${q.ate}T23:59:59.999-03:00`) : null
  if ((de || ate) && dataPor(q) === 'inscricao') where.createdAt = { ...(de ? { gte: de } : {}), ...(ate ? { lte: ate } : {}) }
  if (q.portalId) where.portalId = parseInt(q.portalId)
  if (q.offeringId) where.processRegistration = { offeringId: parseInt(q.offeringId) }
  else if (q.courseId) where.processRegistration = { offering: { courseId: parseInt(q.courseId) } }
  if (q.processId) where.processRegistration = { ...(where.processRegistration ?? {}), selectionProcessId: parseInt(q.processId) }
  if (q.search) {
    const t = String(q.search).trim()
    where.AND = [{ OR: [{ candidateCode: { contains: t } }, { lead: { nome: { contains: t } } }, { lead: { email: { contains: t } } }, { paymentId: { contains: t } }] }]
  }
  return where
}

/** A que data o período se refere: o dia em que o dinheiro entrou (padrão),
 *  o vencimento das cobranças ou a data da inscrição. */
type DataPor = 'pagamento' | 'vencimento' | 'inscricao'
function dataPor(q: any): DataPor {
  return q.dataPor === 'vencimento' || q.dataPor === 'inscricao' ? q.dataPor : 'pagamento'
}

/** Recorte por pagamento ou vencimento: só as linhas com movimento no período,
 *  e o valor que caiu nele. Sem período, tudo vale. */
function recortar(itens: ReturnType<typeof linha>[], q: any) {
  const de = q.de ? String(q.de) : '0000-00-00'
  const ate = q.ate ? String(q.ate) : '9999-99-99'
  const dentro = (d: string) => d >= de && d <= ate
  for (const l of itens) {
    l.recebidoNoPeriodo = centavos(l.recebimentos.filter((x) => dentro(x.dia)).reduce((a, x) => a + x.valor, 0))
    l.venceNoPeriodo = centavos(l.vencimentos.filter((x) => dentro(x.dia)).reduce((a, x) => a + x.valor, 0))
  }
  const modo = dataPor(q)
  if (modo === 'inscricao' || (!q.de && !q.ate)) return itens
  return itens.filter((l) => (modo === 'pagamento' ? l.recebimentos : l.vencimentos).some((x) => dentro(x.dia)))
}

/** Filtros que dependem do cálculo da linha (situação, meio, cupom, gateway…). */
function filtrarLinhas(itens: ReturnType<typeof linha>[], q: any) {
  return itens.filter((l) =>
    (!q.situacao || String(q.situacao).split(',').includes(l.situacao))
    && (!q.meio || l.meio === q.meio)
    && (!q.gateway || l.gateway === q.gateway)
    && (!q.escopo || l.escopo === q.escopo)
    && (!q.cupom || (q.cupom === 'com' ? !!l.cupom : q.cupom === 'sem' ? !l.cupom : l.cupom === String(q.cupom).toUpperCase())),
  )
}

function indicadores(itens: ReturnType<typeof linha>[], q: any) {
  const soma = (f: (l: any) => number) => Math.round(itens.reduce((a, l) => a + f(l), 0) * 100) / 100
  const pagos = itens.filter((l) => l.situacao === 'pago')
  const comCobranca = itens.filter((l) => l.situacao !== 'sem_cobranca')
  // Dinheiro que entrou: no período, quando o período é por pagamento; senão,
  // tudo o que entrou nas inscrições do recorte.
  const porPagamento = dataPor(q) === 'pagamento' && (q.de || q.ate)
  const de = q.de ? String(q.de) : '0000-00-00'
  const ate = q.ate ? String(q.ate) : '9999-99-99'
  const entradas = itens.flatMap((l) => l.recebimentos.filter((x) => !porPagamento || (x.dia >= de && x.dia <= ate)).map((x) => ({ ...x, l })))
  const porMeio: Record<string, { quantidade: number; valor: number }> = {}
  for (const e of entradas) {
    const k = e.meio ?? 'outro'
    porMeio[k] = porMeio[k] ?? { quantidade: 0, valor: 0 }
    porMeio[k].quantidade++; porMeio[k].valor = centavos(porMeio[k].valor + e.valor)
  }
  const porCurso = new Map<string, { curso: string; inscritos: number; pagos: number; recebido: number }>()
  for (const l of itens) {
    const k = l.curso?.nome ?? 'Sem curso'
    const a = porCurso.get(k) ?? { curso: k, inscritos: 0, pagos: 0, recebido: 0 }
    a.inscritos++
    if (l.situacao === 'pago') a.pagos++
    porCurso.set(k, a)
  }
  for (const e of entradas) {
    const a = porCurso.get(e.l.curso?.nome ?? 'Sem curso')!
    a.recebido = centavos(a.recebido + e.valor)
  }
  const porDia = new Map<string, number>()
  for (const e of entradas) porDia.set(e.dia, centavos((porDia.get(e.dia) ?? 0) + e.valor))
  const contar = (s: Situacao) => itens.filter((l) => l.situacao === s).length
  const recebido = centavos(entradas.reduce((a, e) => a + e.valor, 0))
  return {
    inscricoes: itens.length,
    comCobranca: comCobranca.length,
    pagos: pagos.length,
    /** Quantos pagamentos (1ª cobrança, parcelas e títulos) entraram no recebido. */
    pagamentos: entradas.length,
    conversao: comCobranca.length ? Math.round((pagos.length / comCobranca.length) * 1000) / 10 : 0,
    recebido,
    parcelasPagas: entradas.filter((e) => e.origem !== 'cobranca').length,
    pendente: soma((l) => (l.situacao === 'pendente' ? l.valorCobrado ?? l.valorTabela ?? 0 : 0)),
    vencido: soma((l) => (l.situacao === 'vencido' ? l.valorCobrado ?? l.valorTabela ?? 0 : 0)),
    emAberto: soma((l) => l.emAberto),
    vencidoTotal: soma((l) => l.vencidoValor),
    ticketMedio: entradas.length ? centavos(recebido / entradas.length) : 0,
    descontos: soma((l) => (l.situacao === 'pago' ? l.descontoCupom + l.descontoAVista : 0)),
    comCupom: pagos.filter((l) => l.cupom).length,
    porSituacao: { pago: contar('pago'), pendente: contar('pendente'), vencido: contar('vencido'), falhou: contar('falhou'), estornado: contar('estornado'), cancelado: contar('cancelado'), transferido: contar('transferido'), sem_cobranca: contar('sem_cobranca') },
    porMeio,
    porCurso: [...porCurso.values()].sort((a, b) => b.recebido - a.recebido || b.inscritos - a.inscritos).slice(0, 12),
    porDia: [...porDia.entries()].sort().map(([dia, valor]) => ({ dia, valor })),
  }
}

/** Junta em cada linha os códigos das inscrições mescladas nela. */
async function comMescladas<T extends { id: number; mescladas: string[] }>(itens: T[]): Promise<T[]> {
  if (!itens.length) return itens
  const filhas = await prisma.enrollmentRegistration.findMany({
    where: { mergedIntoId: { in: itens.map((l) => l.id) } }, select: { mergedIntoId: true, candidateCode: true },
  })
  const por = new Map<number, string[]>()
  for (const f of filhas) por.set(f.mergedIntoId!, [...(por.get(f.mergedIntoId!) ?? []), f.candidateCode])
  for (const l of itens) l.mescladas = por.get(l.id) ?? []
  return itens
}

async function conexaoIuguDa(regId: number) {
  const r = await prisma.enrollmentRegistration.findUnique({
    where: { id: regId },
    select: { portal: { select: { paymentConnection: { select: { provider: true, apiKey: true, publicKey: true, environment: true, active: true } } } } },
  })
  const c = r?.portal?.paymentConnection
  return c?.provider === 'iugu' ? iuguDaConexao(c) : null
}

export async function portalFinanceiroRoutes(app: FastifyInstance) {
  const BASE = '/api/admin/educational/portal-financeiro'

  // Lista + indicadores do mesmo recorte
  app.get(BASE, { preHandler: guardTela('admin') }, async (req) => {
    const q = req.query as any
    const rows = await prisma.enrollmentRegistration.findMany({
      where: filtros(q), select: SELECT_LINHA, orderBy: { createdAt: 'desc' }, take: 5000,
    })
    const itens = recortar(filtrarLinhas(await comMescladas(rows.map(linha)), q), q)
    const ordem = String(q.ordenar || 'recentes')
    if (ordem === 'valor') itens.sort((a, b) => (b.valorCobrado ?? 0) - (a.valorCobrado ?? 0))
    if (ordem === 'pagamento') itens.sort((a, b) => String(b.ultimoPagamento ?? '').localeCompare(String(a.ultimoPagamento ?? '')))
    if (ordem === 'vencimento') itens.sort((a, b) => String(a.vencimentoMaisAntigo ?? '9999').localeCompare(String(b.vencimentoMaisAntigo ?? '9999')))
    if (ordem === 'recebido') itens.sort((a, b) => (b.recebidoNoPeriodo ?? 0) - (a.recebidoNoPeriodo ?? 0))
    const limit = Math.max(1, Math.min(parseInt(q.limit) || 50, 500))
    const offset = parseInt(q.offset) || 0
    return { indicadores: indicadores(itens, q), dataPor: dataPor(q), total: itens.length, limit, offset, items: itens.slice(offset, offset + limit) }
  })

  app.get(`${BASE}/export.csv`, { preHandler: guardTela('admin') }, async (req, reply) => {
    const q = req.query as any
    const rows = await prisma.enrollmentRegistration.findMany({ where: filtros(q), select: SELECT_LINHA, orderBy: { createdAt: 'desc' }, take: 20000 })
    const itens = recortar(filtrarLinhas(await comMescladas(rows.map(linha)), q), q)
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const n = (v: number | null) => (v == null ? '' : v.toFixed(2).replace('.', ','))
    const dt = (d: Date | string | null) => (d ? new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '')
    const linhas = [
      ['Código', 'Candidato', 'E-mail', 'Portal', 'Curso', 'Oferta', 'Processo', 'Cobrança', 'Valor de tabela', 'Desconto cupom', 'Desconto à vista', 'Cupom', 'Valor cobrado', 'Parcelas', 'Meio', 'Gateway', 'Situação', 'Pago em', 'Vence em', 'Inscrito em', 'Último pagamento', 'Recebido no período', 'Recebido total', 'Em aberto', 'Vencido', 'Próximo vencimento', 'Vence no período'].join(';'),
      ...itens.map((l) => [l.candidateCode, l.nome, l.email, l.portal?.nome, l.curso?.nome, l.oferta?.nome, l.processo?.nome, l.rotulo,
        n(l.valorTabela), n(l.descontoCupom), n(l.descontoAVista), l.cupom, n(l.valorCobrado), l.parcelas, l.meio, l.gateway, l.situacao,
        dt(l.pagoEm), dt(l.venceEm), dt(l.criadoEm), l.ultimoPagamento ? String(l.ultimoPagamento).slice(0, 10).split('-').reverse().join('/') : '',
        n(l.recebidoNoPeriodo), n(l.recebidoTotal), n(l.emAberto), n(l.vencidoValor),
        l.proximoVencimento ? l.proximoVencimento.split('-').reverse().join('/') : '', n(l.venceNoPeriodo)].map(esc).join(';')),
    ]
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="financeiro-portal.csv"')
    return '﻿' + linhas.join('\n')
  })

  // Detalhe: tentativas, avisos do gateway, cupom, linha do tempo
  app.get(`${BASE}/:id`, { preHandler: guardTela('admin') }, async (req, reply) => {
    const id = parseInt((req.params as any).id)
    const r0 = await prisma.enrollmentRegistration.findUnique({ where: { id }, select: { ...SELECT_LINHA, mergedIntoId: true } })
    if (!r0) return reply.code(404).send({ error: 'Inscrição não encontrada' })
    // Aberta pela mesclada: mostra a principal — é ela que vale.
    const r = r0.mergedIntoId
      ? (await prisma.enrollmentRegistration.findUnique({ where: { id: r0.mergedIntoId }, select: { ...SELECT_LINHA, mergedIntoId: true } })) ?? r0
      : r0
    const filhas = await prisma.enrollmentRegistration.findMany({ where: { mergedIntoId: r.id }, select: { id: true, candidateCode: true } })
    const codigoDe = new Map([[r.id, r.candidateCode], ...filhas.map((f) => [f.id, f.candidateCode] as [number, string])])
    const [tentativas, avisos, resgate, eventos] = await Promise.all([
      prisma.enrollmentPaymentMethod.findMany({
        where: { registrationId: { in: [r.id, ...filhas.map((f) => f.id)] } }, orderBy: { createdAt: 'desc' },
        select: { id: true, registrationId: true, provider: true, method: true, status: true, amount: true, externalId: true, createdAt: true, paidAt: true, expiresAt: true, boletoLine: true, boletoPdfUrl: true, qrCode: true, cardBrand: true, cardLastDigits: true, lastErrorMessage: true },
      }),
      prisma.paymentWebhookHit.findMany({
        where: { OR: [{ registrationId: r.id }, ...(r.paymentId ? [{ externalId: r.paymentId }] : [])] },
        orderBy: { receivedAt: 'desc' }, take: 50,
        select: { id: true, provider: true, eventType: true, status: true, receivedAt: true, errorMessage: true },
      }),
      prisma.couponRedemption.findFirst({ where: { registrationId: r.id }, include: { coupon: { select: { id: true, code: true, description: true } } } }),
      r.lead?.id
        ? prisma.leadEvent.findMany({
            where: { leadId: r.lead.id, type: { startsWith: 'payment' } }, orderBy: { createdAt: 'desc' }, take: 30,
            select: { id: true, type: true, title: true, description: true, createdAt: true, userName: true },
          }).catch(() => [])
        : Promise.resolve([]),
    ])
    const [l] = await comMescladas([linha(r)])
    return {
      linha: l,
      plano: r.paymentPlan,
      paymentUrl: r.paymentUrl,
      tentativas: tentativas.map((t) => ({
        ...t, amount: t.amount != null ? Number(t.amount) : null,
        // Tentativa de uma inscrição mesclada nesta: a tela marca de qual veio.
        deInscricao: t.registrationId !== r.id ? codigoDe.get(t.registrationId) ?? null : null,
      })),
      avisos,
      cupom: resgate ? { ...resgate.coupon, desconto: Number(resgate.discountValue), em: resgate.redeemedAt } : null,
      eventos,
    }
  })

  // Baixa manual: pagou por fora (dinheiro, transferência, PIX direto na conta).
  // Mesmo caminho da página da inscrição (services/pagamentoManual): comprovante
  // obrigatório, motivo, dia do pagamento; efeitos de pagamento confirmado uma
  // vez só; na iugu a fatura aberta fica "paga externamente".
  app.post(`${BASE}/:id/baixa-manual`, { preHandler: guardTela('admin') }, async (req, reply) => {
    const id = parseInt((req.params as any).id)
    const user = (req as any).user as JwtPayload
    const { pagamentoManualDaRequisicao } = await import('../services/pagamentoManual.js')
    const r = await pagamentoManualDaRequisicao(req, id, { id: user.userId, nome: user.name })
    if (!r.ok) return reply.code(r.status).send({ error: r.erro })
    return { ok: true }
  })

  // Cancelar a cobrança pendente (a inscrição continua; a pessoa pode gerar outra).
  app.post(`${BASE}/:id/cancelar-cobranca`, { preHandler: guardTela('admin') }, async (req, reply) => {
    const id = parseInt((req.params as any).id)
    const user = (req as any).user as JwtPayload
    const reg = await prisma.enrollmentRegistration.findUnique({ where: { id }, select: { leadId: true, candidateCode: true, paymentStatus: true } })
    if (!reg) return reply.code(404).send({ error: 'Inscrição não encontrada' })
    if (reg.paymentStatus === 'paid') return reply.code(400).send({ error: 'Cobrança já paga — para devolver, use o estorno' })
    // Asaas e iugu cancelados de verdade no gateway (antes o Asaas só gerava
    // aviso para cancelar à mão) — mesma rotina da mesclagem de inscrições.
    const abertas = await prisma.enrollmentPaymentMethod.count({ where: { registrationId: id, status: 'pending' } })
    const { cancelarCobrancasAbertas } = await import('../services/inscricaoDuplicada.js')
    const avisos = await cancelarCobrancasAbertas(id, 'Cancelada pela secretaria')
    await prisma.enrollmentRegistration.update({ where: { id }, data: { paymentStatus: null, paymentId: null, paymentUrl: null, paymentExpiresAt: null } })
    if (reg.leadId) {
      logEvent({ leadId: reg.leadId, type: 'payment_canceled', category: 'lifecycle', channel: 'payment', source: 'manual', title: `Cobrança cancelada pela secretaria — ${reg.candidateCode}`, actorType: 'operator', userId: user.userId, userName: user.name, metadata: { registrationId: id } })
    }
    return { ok: true, canceladas: abertas, avisos }
  })

  // Reenviar a COBRANÇA (não o acesso ao portal). Duas entregas, como no
  // reenvio de link: a secretaria muitas vezes já está falando com a pessoa no
  // Conversas — então a rota monta a mensagem pronta (valor, vencimento, PIX,
  // linha digitável, link) para ela copiar; e, na iugu, também dispara o e-mail
  // oficial da fatura, que já vai com boleto e PIX.
  async function cobrancaAberta(id: number) {
    const reg = await prisma.enrollmentRegistration.findUnique({
      where: { id },
      select: {
        id: true, leadId: true, candidateCode: true, paymentStatus: true, paymentUrl: true, paymentExpiresAt: true,
        lead: { select: { nome: true, email: true, whatsapp: true } },
        portal: { select: { nome: true } },
      },
    })
    if (!reg) return null
    const abertas = await prisma.enrollmentPaymentMethod.findMany({
      where: { registrationId: id, status: 'pending' }, orderBy: { createdAt: 'desc' },
    })
    return { reg, abertas }
  }

  app.get(`${BASE}/:id/cobranca-mensagem`, { preHandler: guardTela('admin') }, async (req, reply) => {
    const id = parseInt((req.params as any).id)
    const c = await cobrancaAberta(id)
    if (!c) return reply.code(404).send({ error: 'Inscrição não encontrada' })
    const { reg, abertas } = c
    if (reg.paymentStatus === 'paid') return reply.code(400).send({ error: 'Esta inscrição já está paga' })
    if (!abertas.length) return reply.code(400).send({ error: 'Não há cobrança em aberto — o candidato gera uma nova pelo portal' })

    const pix = abertas.find((m) => m.qrCode)?.qrCode ?? null
    const boleto = abertas.find((m) => m.boletoLine || m.boletoPdfUrl) ?? null
    let link = reg.paymentUrl || null
    const iugu = abertas.find((m) => m.provider === 'iugu' && m.externalId)
    if (iugu && !link) {
      const cfg = await conexaoIuguDa(id)
      const f = cfg ? await buscarFaturaIugu(cfg, iugu.externalId!).catch(() => null) : null
      link = f?.urlSegura ?? null
    }
    const valor = Number(abertas[0]!.amount)
    const vence = abertas[0]!.expiresAt ?? abertas[0]!.boletoDueAt ?? reg.paymentExpiresAt
    const base = appUrl()
    const linhas = [
      `Olá${reg.lead?.nome ? `, ${reg.lead.nome.split(' ')[0]}` : ''}! Segue a cobrança da sua inscrição ${reg.candidateCode}${reg.portal?.nome ? ` em ${reg.portal.nome}` : ''}.`,
      '',
      `Valor: ${valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}${vence ? ` · vence em ${new Date(vence).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}` : ''}`,
      ...(pix ? ['', 'PIX copia e cola:', pix] : []),
      ...(boleto?.boletoLine ? ['', 'Boleto — linha digitável:', boleto.boletoLine] : []),
      ...(boleto?.boletoPdfUrl ? [`Boleto em PDF: ${boleto.boletoPdfUrl}`] : []),
      ...(link ? ['', `Pagar online: ${link}`] : []),
      ...(base ? ['', `Acompanhe sua inscrição: ${base}/candidato/${reg.candidateCode}`] : []),
    ]
    return {
      texto: linhas.join('\n'),
      whatsapp: reg.lead?.whatsapp ?? null,
      email: reg.lead?.email ?? null,
      leadId: reg.leadId,
      // E-mail oficial da fatura: só na iugu.
      emailIugu: !!iugu,
    }
  })

  app.post(`${BASE}/:id/reenviar-cobranca-email`, { preHandler: guardTela('admin') }, async (req, reply) => {
    const id = parseInt((req.params as any).id)
    const user = (req as any).user as JwtPayload
    const c = await cobrancaAberta(id)
    if (!c) return reply.code(404).send({ error: 'Inscrição não encontrada' })
    if (c.reg.paymentStatus === 'paid') return reply.code(400).send({ error: 'Esta inscrição já está paga' })
    const iugu = c.abertas.filter((m) => m.provider === 'iugu' && m.externalId)
    if (!iugu.length) return reply.code(400).send({ error: 'Envio por e-mail disponível para cobranças da iugu. Para os outros gateways, copie a mensagem.' })
    const cfg = await conexaoIuguDa(id)
    if (!cfg) return reply.code(400).send({ error: 'Conexão iugu indisponível' })
    // Uma fatura por meio pode estar aberta (PIX e boleto): reenvia a mais recente.
    const r = await enviarFaturaPorEmailIugu(cfg, iugu[0]!.externalId!)
    if (!r.ok) return reply.code(502).send({ error: r.message || 'A iugu não enviou o e-mail' })
    if (c.reg.leadId) {
      logEvent({ leadId: c.reg.leadId, type: 'payment_resent', category: 'lifecycle', channel: 'payment', source: 'iugu', title: `Cobrança reenviada por e-mail — ${c.reg.candidateCode}`, actorType: 'operator', userId: user.userId, userName: user.name, metadata: { registrationId: id, fatura: iugu[0]!.externalId } })
    }
    return { ok: true, email: c.reg.lead?.email ?? null }
  })

  // Estorno (iugu: cartão e PIX; parcial só no cartão).
  app.post(`${BASE}/:id/estornar`, { preHandler: guardTela('admin') }, async (req, reply) => {
    const id = parseInt((req.params as any).id)
    const b = (req.body as any) || {}
    const user = (req as any).user as JwtPayload
    const reg = await prisma.enrollmentRegistration.findUnique({ where: { id }, select: { leadId: true, candidateCode: true, paymentStatus: true } })
    if (!reg) return reply.code(404).send({ error: 'Inscrição não encontrada' })
    if (reg.paymentStatus !== 'paid') return reply.code(400).send({ error: 'Só dá para estornar cobrança paga' })
    const paga = await prisma.enrollmentPaymentMethod.findFirst({ where: { registrationId: id, status: 'paid' }, orderBy: { paidAt: 'desc' } })
    if (!paga) return reply.code(400).send({ error: 'Pagamento não encontrado' })
    if (paga.provider === 'manual') return reply.code(400).send({ error: 'Baixa manual: devolva o valor por fora e cancele a inscrição, se for o caso' })
    if (paga.provider !== 'iugu') return reply.code(400).send({ error: `Estorno pelo sistema disponível para a iugu. Para ${paga.provider}, faça no painel do gateway` })
    const cfg = await conexaoIuguDa(id)
    if (!cfg || !paga.externalId) return reply.code(400).send({ error: 'Conexão iugu indisponível' })
    // Pago pelo link da iugu, o registro guarda method 'link': o meio de verdade
    // (cartão, PIX ou boleto) só a fatura sabe. Sem isso, o estorno parcial de
    // um cartão pago pelo link era recusado como se não fosse cartão.
    let meio = paga.method
    if (meio !== 'pix' && meio !== 'boleto' && meio !== 'credit_card') {
      const f = await buscarFaturaIugu(cfg, paga.externalId).catch(() => null)
      meio = f?.meio === 'CREDIT_CARD' ? 'credit_card' : f?.meio === 'PIX' ? 'pix' : f?.meio === 'BOLETO' ? 'boleto' : meio
    }
    if (meio === 'boleto') return reply.code(400).send({ error: 'Boleto não tem estorno automático na iugu — devolva por transferência' })
    const parcial = b.valor ? Math.round(Number(b.valor) * 100) : undefined
    if (parcial && meio !== 'credit_card') return reply.code(400).send({ error: 'Estorno parcial só no cartão' })
    try {
      const f = await estornarFaturaIugu(cfg, paga.externalId, parcial)
      await prisma.enrollmentPaymentMethod.update({ where: { id: paga.id }, data: { status: f.status === 'refunded' || !parcial ? 'refunded' : paga.status } })
      if (!parcial) await prisma.enrollmentRegistration.update({ where: { id }, data: { paymentStatus: 'refunded' } })
      if (reg.leadId) {
        logEvent({ leadId: reg.leadId, type: 'payment_refunded', category: 'lifecycle', channel: 'payment', source: 'iugu', title: `Pagamento estornado${parcial ? ' (parcial)' : ''} — ${reg.candidateCode}`, description: String(b.motivo || '').slice(0, 300) || undefined, actorType: 'operator', userId: user.userId, userName: user.name, metadata: { registrationId: id, parcialCentavos: parcial ?? null } })
      }
      return { ok: true }
    } catch (e: any) {
      return reply.code(502).send({ error: e?.message || 'Falha ao estornar na iugu' })
    }
  })
}
