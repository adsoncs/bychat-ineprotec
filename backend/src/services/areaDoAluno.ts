// services/areaDoAluno.ts
//
// "Meu Portal" — a área do aluno no portal logado (04/11/2026, pedido do
// ineprotec). Depois da inscrição enviada, a pessoa não tinha onde ver as
// faturas, os documentos e o contrato juntos: o portal só mostrava as etapas.
//
// Liga por instituição (Setting `portal_area_aluno` = true). Desligada, o
// portal segue exatamente como era.
//
// Este serviço monta o que o servidor sabe da inscrição: as faturas (a cobrança
// do portal e, quando o gateway parcelou, cada parcela lida direto do Asaas) e
// os contratos/termos. Documentos e dados do curso vêm das rotas que o portal
// já usa (/api/candidate/me e /registrations/:code/resumo), com o token da
// inscrição que esta resposta devolve.
import { prisma } from '../lib/prisma.js'
import { signCandidateToken } from '../lib/candidateAuth.js'
import { decryptToken } from './cloudApi.js'
import { fetchAsaasBoletoLinha, fetchAsaasPixQr, type AsaasConfig } from './paymentAsaas.js'

export type SituacaoDaFatura = 'paga' | 'aberta' | 'vencida' | 'cancelada' | 'estornada' | 'prevista'

export interface Fatura {
  /** Identifica a fatura nas ações (copiar PIX/linha): `reg:<id>` ou `asaas:<paymentId>`. */
  chave: string
  titulo: string
  detalhe: string | null
  valor: number
  vencimento: string | null
  situacao: SituacaoDaFatura
  pagaEm: string | null
  meio: string | null
  /** Página de pagamento do gateway (PIX, boleto e cartão). */
  pagar: string | null
  boletoPdf: string | null
  recibo: string | null
  /** PIX/linha que já temos gravados (cobrança do portal). */
  pix: string | null
  linha: string | null
  /** Dá para buscar PIX/linha no gateway (parcela do Asaas em aberto). */
  buscarCodigos: boolean
}

export interface ContratoDoAluno {
  id: number
  titulo: string
  forma: 'eletronica' | 'aceite' | 'papel'
  situacao: 'assinado' | 'aguardando'
  assinadoEm: string | null
  /** O PDF sai de /api/public/registrations/:code/contrato/pdf (token da inscrição). */
  temPdf: boolean
}

const EM_INSCRICAO = ['draft', 'pending']
const MEIO: Record<string, string> = {
  PIX: 'PIX', BOLETO: 'Boleto', CREDIT_CARD: 'Cartão de crédito', CARTAO: 'Cartão de crédito', DEBIT_CARD: 'Cartão de débito',
  MANUAL: 'Pago na secretaria', UNDEFINED: null as any,
}
const meioLegivel = (m: string | null | undefined) => {
  const s = String(m || '').toUpperCase()
  if (!s) return null
  if (s.includes('PIX')) return 'PIX'
  if (s.includes('BOLETO') || s.includes('BANK_SLIP')) return 'Boleto'
  if (s.includes('CREDIT')) return 'Cartão de crédito'
  return MEIO[s] ?? null
}
const hojeBr = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())

export async function areaAtiva(): Promise<boolean> {
  const s = await prisma.setting.findUnique({ where: { key: 'portal_area_aluno' }, select: { value: true } }).catch(() => null)
  return s?.value === true || s?.value === 'true'
}

// ─── Asaas: parcelas do parcelamento ─────────────────────────────────────────
// Cartão parcelado (e carnê, se um dia o checkout criar) vira um "installment"
// no Asaas, com uma cobrança por mês. Lemos ao abrir o Financeiro (cache curto)
// em vez de copiar para o banco: o que o aluno vê é sempre o que o Asaas diz.

const cache = new Map<string, { em: number; dados: any }>()
const CACHE_MS = 60_000

async function configDoPortal(portalId: number): Promise<AsaasConfig | null> {
  const p = await prisma.enrollmentPortal.findUnique({ where: { id: portalId }, select: { paymentConnectionId: true } })
  if (!p?.paymentConnectionId) return null
  const c = await prisma.paymentProviderConnection.findUnique({
    where: { id: p.paymentConnectionId }, select: { provider: true, environment: true, apiKey: true },
  })
  if (!c || c.provider !== 'asaas') return null
  try {
    return { apiKey: decryptToken(c.apiKey), environment: c.environment === 'production' ? 'production' : 'sandbox' }
  } catch { return null }
}

async function asaasGet(cfg: AsaasConfig, path: string): Promise<any> {
  const chave = `${cfg.environment}:${path}`
  const c = cache.get(chave)
  if (c && Date.now() - c.em < CACHE_MS) return c.dados
  const base = cfg.environment === 'production' ? 'https://api.asaas.com/v3' : 'https://api-sandbox.asaas.com/v3'
  const r = await fetch(base + path, { headers: { access_token: cfg.apiKey, 'User-Agent': 'crm-integracao/1.0' }, signal: AbortSignal.timeout(10_000) })
  const dados = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`Asaas: ${dados?.errors?.[0]?.description || `HTTP ${r.status}`}`)
  cache.set(chave, { em: Date.now(), dados })
  if (cache.size > 500) cache.delete(cache.keys().next().value as string)
  return dados
}

function situacaoAsaas(p: any): SituacaoDaFatura | null {
  if (p.deleted) return null
  const s = String(p.status || '')
  if (['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH', 'DUNNING_RECEIVED'].includes(s)) return 'paga'
  if (s.startsWith('REFUND') || s.startsWith('CHARGEBACK')) return 'estornada'
  if (s === 'OVERDUE' || s === 'DUNNING_REQUESTED') return 'vencida'
  if (s === 'PENDING' || s === 'AWAITING_RISK_ANALYSIS') return p.dueDate && p.dueDate < hojeBr() ? 'vencida' : 'aberta'
  return 'aberta'
}

export function faturaDoAsaas(p: any, total: number): Fatura | null {
  const situacao = situacaoAsaas(p)
  if (!situacao) return null
  const n = Number(p.installmentNumber) || null
  const aberta = situacao === 'aberta' || situacao === 'vencida'
  return {
    chave: `asaas:${p.id}`,
    titulo: n && total > 1 ? `Parcela ${n} de ${total}` : (p.description || 'Cobrança'),
    detalhe: null,
    valor: Number(p.value) || 0,
    vencimento: p.dueDate || null,
    situacao,
    pagaEm: p.paymentDate || p.clientPaymentDate || p.confirmedDate || null,
    meio: meioLegivel(p.billingType),
    pagar: aberta ? (p.invoiceUrl || null) : null,
    boletoPdf: aberta && p.billingType === 'BOLETO' ? (p.bankSlipUrl || null) : null,
    recibo: situacao === 'paga' ? (p.transactionReceiptUrl || null) : null,
    pix: null, linha: null,
    buscarCodigos: aberta && ['BOLETO', 'PIX', 'UNDEFINED'].includes(String(p.billingType)),
  }
}

// ─── A inscrição da conta ───────────────────────────────────────────────────

const SELECT_REG = {
  id: true, candidateCode: true, status: true, portalId: true, createdAt: true, contratoAceite: true,
  paymentId: true, paymentStatus: true, paymentAmount: true, paymentMethod: true, paymentPaidAt: true,
  paymentExpiresAt: true, paymentUrl: true, paymentPlan: true,
  portal: { select: { nome: true, slug: true, paymentScope: true } },
  processRegistration: { select: { offering: { select: { nome: true, course: { select: { nome: true } } } } } },
  paymentMethods: {
    orderBy: { createdAt: 'desc' as const }, take: 5,
    select: { method: true, provider: true, status: true, externalId: true, qrCode: true, boletoLine: true, boletoPdfUrl: true, paidAt: true },
  },
} as const

type Reg = NonNullable<Awaited<ReturnType<typeof inscricoesDaConta>>>[number]

export async function inscricoesDaConta(leadId: number) {
  return prisma.enrollmentRegistration.findMany({
    where: { leadId, status: { not: 'merged' } }, orderBy: { id: 'desc' }, select: SELECT_REG,
  })
}

const nomeDoCurso = (r: Reg) => r.processRegistration?.offering?.course?.nome || r.processRegistration?.offering?.nome || r.portal?.nome || 'Inscrição'

/** O que a cobrança do portal representa, na língua do aluno. */
function tituloDaCobranca(r: Reg): string {
  const plano = (r.paymentPlan ?? {}) as any
  if (r.portal?.paymentScope !== 'curso') return 'Taxa de inscrição'
  const parcelas = Number(plano.parcelas) || 1
  if (plano.meio === 'boleto' && parcelas > 1) return `Parcela 1 de ${parcelas}`
  if (plano.planoFinanceiro?.opcao === 'entrada') return 'Matrícula'
  return 'Curso completo'
}

function situacaoDaCobranca(r: Reg): SituacaoDaFatura | null {
  const ps = String(r.paymentStatus || '')
  if (ps === 'paid') return 'paga'
  if (ps === 'refunded') return 'estornada'
  if (r.status === 'cancelled' || r.status === 'expired') return r.paymentId ? 'cancelada' : null
  if (ps === 'overdue' || ps === 'expired') return 'vencida'
  if (ps === 'pending' || ps === 'failed') return r.paymentExpiresAt && r.paymentExpiresAt < new Date() ? 'vencida' : 'aberta'
  return r.paymentId ? 'aberta' : null
}

export async function faturasDaInscricao(r: Reg): Promise<{ faturas: Fatura[]; aviso: string | null }> {
  const plano = (r.paymentPlan ?? {}) as any
  const faturas: Fatura[] = []
  let aviso: string | null = null
  const cfg = r.portalId ? await configDoPortal(r.portalId) : null

  // 1) Parcelado no gateway: cada parcela é uma cobrança do Asaas.
  if (plano.installmentId && cfg) {
    try {
      const d = await asaasGet(cfg, `/payments?installment=${encodeURIComponent(plano.installmentId)}&limit=100`)
      const lista: any[] = Array.isArray(d?.data) ? d.data : []
      const total = lista.filter((p) => !p.deleted).length || Number(plano.parcelas) || lista.length
      for (const p of lista.sort((a, b) => (a.installmentNumber ?? 0) - (b.installmentNumber ?? 0))) {
        const f = faturaDoAsaas(p, total)
        if (f) faturas.push(f)
      }
      if (faturas.length) return { faturas, aviso: plano.meio === 'credit_card' ? 'As parcelas do cartão são cobradas automaticamente na fatura do seu cartão, todo mês.' : null }
    } catch {
      aviso = 'Não foi possível consultar as parcelas agora. Mostramos o que temos registrado; tente de novo em alguns minutos.'
    }
  }

  // 2) A cobrança do portal (a única, ou a 1ª do boleto parcelado).
  const situacao = situacaoDaCobranca(r)
  if (situacao && r.paymentAmount != null) {
    const aberta = situacao === 'aberta' || situacao === 'vencida'
    const ultima = r.paymentMethods.find((m) => m.status === 'pending') ?? r.paymentMethods[0]
    const manual = String(r.paymentMethod || '').toUpperCase() === 'MANUAL'
    let recibo: string | null = null
    if (situacao === 'paga' && !manual && cfg && r.paymentId && !String(r.paymentId).startsWith('manual')) {
      recibo = await asaasGet(cfg, `/payments/${encodeURIComponent(r.paymentId)}`).then((p) => p?.transactionReceiptUrl || null).catch(() => null)
    }
    const parcelasCartao = plano.meio === 'credit_card' && Number(plano.parcelas) > 1 ? Number(plano.parcelas) : 0
    faturas.push({
      chave: `reg:${r.id}`,
      titulo: tituloDaCobranca(r),
      detalhe: parcelasCartao ? `em ${parcelasCartao}x no cartão` : (manual ? 'Registrado pela secretaria' : null),
      valor: Number(r.paymentAmount),
      vencimento: aberta && r.paymentExpiresAt ? hojeBrDe(r.paymentExpiresAt) : null,
      situacao,
      pagaEm: r.paymentPaidAt ? r.paymentPaidAt.toISOString() : null,
      meio: meioLegivel(r.paymentMethod) ?? meioLegivel(ultima?.method),
      pagar: aberta ? (r.paymentUrl || null) : null,
      boletoPdf: aberta ? (ultima?.boletoPdfUrl || null) : null,
      recibo,
      pix: aberta ? (ultima?.qrCode || null) : null,
      linha: aberta ? (ultima?.boletoLine || null) : null,
      buscarCodigos: false,
    })
  }

  // 3) Boleto parcelado: o portal cobra a 1ª; as demais são do contrato e só
  //    viram boleto quando forem geradas. Mostramos como previstas — sem link,
  //    sem prometer data de envio.
  const n = Number(plano.parcelas) || 1
  if (plano.meio === 'boleto' && n > 1 && !plano.installmentId && situacao !== 'cancelada') {
    const valor = Number(plano.valorParcela) || 0
    const dia = await diaDoVencimento(plano.planoFinanceiro?.planoId)
    const base = r.paymentPaidAt ?? r.createdAt
    for (let i = 2; i <= n; i++) {
      faturas.push({
        chave: `prevista:${r.id}:${i}`, titulo: `Parcela ${i} de ${n}`, detalhe: null, valor,
        vencimento: dia ? vencimentoPrevisto(base, i - 1, dia) : null, situacao: 'prevista', pagaEm: null,
        meio: 'Boleto', pagar: null, boletoPdf: null, recibo: null, pix: null, linha: null, buscarCodigos: false,
      })
    }
    aviso = aviso ?? 'As parcelas previstas seguem o seu plano de pagamento. Quando o boleto de cada uma for emitido, ele aparece aqui para pagar.'
  }
  return { faturas, aviso }
}

function hojeBrDe(d: Date) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d) }

async function diaDoVencimento(planoId: unknown): Promise<number | null> {
  const id = Number(planoId)
  if (!Number.isFinite(id) || id <= 0) return null
  const p = await prisma.acaPlanoPagamento.findUnique({ where: { id }, select: { diaVencimento: true } }).catch(() => null)
  return p?.diaVencimento ?? null
}

/** Dia `dia` do mês, `meses` depois da data-base (no fuso de Brasília). */
function vencimentoPrevisto(base: Date, meses: number, dia: number): string {
  const [a, m] = hojeBrDe(base).split('-').map(Number)
  const alvo = new Date(Date.UTC(a, m - 1 + meses, 1))
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate()
  alvo.setUTCDate(Math.min(dia, ultimo))
  return alvo.toISOString().slice(0, 10)
}

// ─── Contratos e termos ─────────────────────────────────────────────────────

export async function contratosDaInscricao(r: Reg): Promise<ContratoDoAluno[]> {
  const envs = await prisma.acaAssinatura.findMany({
    where: { registrationId: r.id, status: { in: ['ENVIADO', 'PARCIAL', 'ASSINADO'] } },
    orderBy: { id: 'desc' }, select: { id: true, titulo: true, provider: true, status: true, finalizadoEm: true },
  })
  const lista: ContratoDoAluno[] = envs.map((e) => ({
    id: e.id,
    titulo: tituloParaAluno(e.titulo),
    forma: e.provider === 'PRESENCIAL' ? 'papel' : (e.provider === 'AUTENTIQUE' || e.provider === 'CLICKSIGN') ? 'eletronica' : 'aceite',
    situacao: e.status === 'ASSINADO' ? 'assinado' : 'aguardando',
    assinadoEm: e.status === 'ASSINADO' && e.finalizadoEm ? e.finalizadoEm.toISOString() : null,
    // Só o envelope atual tem PDF pela rota do candidato (o mais recente aberto).
    temPdf: false,
  }))
  if (lista.length) lista[0].temPdf = true
  // Aceite sem envelope (termo simples do portal): registro do aceite, sem PDF próprio.
  const aceite = r.contratoAceite as any
  if (!lista.length && aceite?.em) {
    lista.push({ id: 0, titulo: 'Termo de aceite', forma: 'aceite', situacao: 'assinado', assinadoEm: String(aceite.em), temPdf: true })
  }
  return lista
}

/** "Contrato assinado no papel — Fulano de Tal" → "Contrato assinado no papel". */
function tituloParaAluno(t: string) { return String(t || 'Contrato').split(' — ')[0].trim() || 'Contrato' }

// ─── A resposta da área ─────────────────────────────────────────────────────

export async function montarArea(leadId: number, codigo?: string | null) {
  const regs = await inscricoesDaConta(leadId)
  if (!regs.length) return { ativa: true as const, modo: 'sem-inscricao' as const }
  const r = (codigo && regs.find((x) => x.candidateCode === codigo)) || regs.find((x) => x.status !== 'cancelled') || regs[0]
  if (EM_INSCRICAO.includes(r.status)) return { ativa: true as const, modo: 'inscricao' as const }
  const [fin, contratos] = await Promise.all([faturasDaInscricao(r), contratosDaInscricao(r)])
  const proxima = fin.faturas
    .filter((f) => f.situacao === 'aberta' || f.situacao === 'vencida')
    .sort((a, b) => String(a.vencimento || '9').localeCompare(String(b.vencimento || '9')))[0] ?? null
  return {
    ativa: true as const,
    modo: 'aluno' as const,
    inscricao: { id: r.id, codigo: r.candidateCode, status: r.status, curso: nomeDoCurso(r), portal: r.portal?.nome ?? null, portalSlug: r.portal?.slug ?? null, criadaEm: r.createdAt.toISOString() },
    inscricoes: regs.map((x) => ({ codigo: x.candidateCode, curso: nomeDoCurso(x), status: x.status })),
    token: signCandidateToken(r.id, r.candidateCode, undefined, 'painel'),
    financeiro: {
      faturas: fin.faturas,
      aviso: fin.aviso,
      proxima,
      emAberto: fin.faturas.filter((f) => f.situacao === 'aberta' || f.situacao === 'vencida').reduce((s, f) => s + f.valor, 0),
      vencidas: fin.faturas.filter((f) => f.situacao === 'vencida').length,
      pagas: fin.faturas.filter((f) => f.situacao === 'paga').length,
    },
    contratos,
    // AVA: integração futura. Enquanto não houver, o portal mostra "em breve".
    ava: { disponivel: false as const, url: null as string | null },
  }
}

/** PIX copia-e-cola e linha digitável de uma parcela do Asaas — só se for da inscrição da conta. */
export async function codigosDaFatura(leadId: number, codigo: string, chave: string) {
  const regs = await inscricoesDaConta(leadId)
  const r = regs.find((x) => x.candidateCode === codigo)
  if (!r) return null
  const { faturas } = await faturasDaInscricao(r)
  const f = faturas.find((x) => x.chave === chave)
  if (!f || !f.buscarCodigos || !chave.startsWith('asaas:')) return null
  const cfg = await configDoPortal(r.portalId)
  if (!cfg) return null
  const id = chave.slice('asaas:'.length)
  const [pix, linha] = await Promise.all([fetchAsaasPixQr(cfg, id).catch(() => null), fetchAsaasBoletoLinha(cfg, id).catch(() => null)])
  return { pix: pix?.payload ?? null, linha: linha?.linha ?? null }
}
