// src/services/paymentSync.ts
// Sincronização de cobranças com Pagar.me/Asaas — recovery quando webhook não chegou.
//
// Dois caminhos consumem essa lógica:
//   1. POST /api/admin/payment-providers/:id/sync-charge  (manual, on-demand)
//   2. Cron de reconciliação (varre EnrollmentPaymentMethod pending das últimas 48h)
//
// Idempotente: side effects (logEvent, sendPaymentConfirmation, conversions++)
// só disparam na transição `pending → paid`, e a transição é uma escrita
// condicional — de dois processos simultâneos (webhook + cron), só um a vence.

import { prisma } from '../lib/prisma.js'
import { decryptToken } from './cloudApi.js'
import { ASAAS_STATUS_MAP } from './paymentAsaas.js'
import { buscarFaturaIugu, iuguDaConexao, type IuguFatura } from './paymentIugu.js'
import { logEvent } from './leadHistory.js'

interface SyncConnectionRow {
  id: number
  provider: string
  active: boolean
  apiKey: string
  environment: string
  publicKey?: string | null
}

export interface NormalizedCharge {
  externalId: string
  status: string                 // mapeado: pending|paid|overdue|failed|refunded
  paidAt: Date | null
  billingType: string | null     // PIX | BOLETO | CREDIT_CARD | null
  enrollmentRefId: number | null
  amount: number | null
}

const PAGARME_STATUS_MAP: Record<string, string> = {
  paid: 'paid',
  authorized_pending_capture: 'pending',
  pending: 'pending',
  processing: 'pending',
  waiting_payment: 'pending',
  not_authorized: 'overdue',
  failed: 'failed',
  canceled: 'overdue',
  refunded: 'refunded',
  partial_refunded: 'refunded',
  chargedback: 'refunded',
  overpaid: 'paid',
  underpaid: 'pending',
}

async function fetchNormalizedFromProvider(
  conn: SyncConnectionRow,
  externalId: string,
): Promise<NormalizedCharge | { error: string }> {
  const apiKeyPlain = (() => { try { return decryptToken(conn.apiKey) } catch { return null } })()
  if (!apiKeyPlain) return { error: 'Falha ao decifrar credenciais' }

  if (conn.provider === 'pagarme') {
    const path = externalId.startsWith('or_')
      ? `/orders/${encodeURIComponent(externalId)}`
      : `/charges/${encodeURIComponent(externalId)}`
    const r = await fetch(`https://api.pagar.me/core/v5${path}`, {
      headers: { 'Authorization': 'Basic ' + Buffer.from(`${apiKeyPlain}:`).toString('base64') },
      signal: AbortSignal.timeout(15_000),
    })
    const data: any = await r.json().catch(() => ({}))
    if (!r.ok) return { error: `Pagar.me: ${data?.message || `HTTP ${r.status}`}` }

    const charge = data.charges && Array.isArray(data.charges) ? data.charges[0] : data
    const refRaw = String(
      data.code
      || data.metadata?.external_reference
      || charge?.code
      || charge?.metadata?.external_reference
      || ''
    )
    const m = refRaw.match(/^enrollment-(\d+)$/)
    return {
      externalId: charge?.id || data.id,
      status: PAGARME_STATUS_MAP[String(charge?.status || data.status || '').toLowerCase()] || 'pending',
      paidAt: (charge?.paid_at || data.closed_at) ? new Date(charge?.paid_at || data.closed_at) : null,
      billingType: charge?.payment_method ? String(charge.payment_method).toUpperCase() : null,
      enrollmentRefId: m ? parseInt(m[1]) : null,
      amount: charge?.amount ? Number(charge.amount) / 100 : null,
    }
  }

  if (conn.provider === 'asaas') {
    const base = conn.environment === 'production' ? 'https://api.asaas.com/v3' : 'https://api-sandbox.asaas.com/v3'
    const r = await fetch(`${base}/payments/${encodeURIComponent(externalId)}`, {
      headers: { 'access_token': apiKeyPlain },
      signal: AbortSignal.timeout(15_000),
    })
    const data: any = await r.json().catch(() => ({}))
    if (!r.ok) return { error: `Asaas: ${data?.errors?.[0]?.description || `HTTP ${r.status}`}` }
    const refRaw = String(data.externalReference || '')
    const m = refRaw.match(/^enrollment-(\d+)$/)
    return {
      externalId: data.id,
      status: ASAAS_STATUS_MAP[data.status] || 'pending',
      paidAt: data.paymentDate
        ? new Date(data.paymentDate)
        : (data.confirmedDate ? new Date(data.confirmedDate) : null),
      billingType: data.billingType || null,
      enrollmentRefId: m ? parseInt(m[1]) : null,
      amount: data.value ? Number(data.value) : null,
    }
  }

  if (conn.provider === 'iugu') {
    const cfg = iuguDaConexao(conn)
    if (!cfg) return { error: 'Falha ao decifrar credenciais' }
    try {
      return cobrancaDaFaturaIugu(await buscarFaturaIugu(cfg, externalId))
    } catch (e: any) {
      return { error: e?.message || 'iugu: falha ao consultar a fatura' }
    }
  }

  return { error: `Provedor não suportado: ${conn.provider}` }
}

/** A fatura da iugu no formato que o resto da reconciliação entende. */
export function cobrancaDaFaturaIugu(f: IuguFatura): NormalizedCharge {
  const m = String(f.referencia || '').match(/^enrollment-(\d+)$/)
  return {
    externalId: f.id,
    status: f.status,
    paidAt: f.pagoEm,
    billingType: f.meio,
    enrollmentRefId: m ? parseInt(m[1]!) : null,
    amount: (f.pagoCentavos ?? f.totalCentavos) ? (f.pagoCentavos ?? f.totalCentavos) / 100 : null,
  }
}

export interface SyncResult {
  ok: boolean
  error?: string
  enrollmentId?: number
  candidateCode?: string
  paymentStatus?: string
  wasPaid?: boolean
  transitionedToPaid?: boolean
}

/**
 * Busca uma cobrança no provedor e aplica os mesmos updates que o webhook faria
 * no DB. Idempotente.
 */
export async function syncChargeFromProvider(
  conn: SyncConnectionRow,
  externalId: string,
  // Quem já consultou o provedor (o gatilho da iugu, por exemplo) passa o
  // resultado — sem isso a mesma fatura seria buscada duas vezes seguidas.
  jaConsultada?: NormalizedCharge,
): Promise<SyncResult> {
  const norm = jaConsultada ?? await fetchNormalizedFromProvider(conn, externalId)
  if ('error' in norm) return { ok: false, error: norm.error }

  let enrollmentRefId = norm.enrollmentRefId
  if (!enrollmentRefId) {
    const reg = await prisma.enrollmentRegistration.findFirst({
      where: { paymentId: norm.externalId },
      select: { id: true },
    })
    if (reg) enrollmentRefId = reg.id
  }
  if (!enrollmentRefId) {
    return {
      ok: false,
      error: 'Não consegui linkar essa cobrança a uma inscrição (externalReference esperado: enrollment-<id>)',
    }
  }

  const enrollment = await prisma.enrollmentRegistration.findUnique({
    where: { id: enrollmentRefId },
    select: {
      id: true, leadId: true, candidateCode: true,
      paymentStatus: true, paymentPaidAt: true, status: true, portalId: true,
    },
  })
  if (!enrollment) return { ok: false, error: 'Inscrição não encontrada' }

  const wasPaid = enrollment.paymentStatus === 'paid'
  const isPaidNow = norm.status === 'paid'

  const updates: any = {
    paymentStatus: norm.status,
    ...(norm.billingType ? { paymentMethod: norm.billingType } : {}),
  }
  if (isPaidNow && !enrollment.paymentPaidAt) {
    updates.paymentPaidAt = norm.paidAt || new Date()
    updates.status = 'paid'
  }
  if (norm.amount) updates.paymentAmount = norm.amount

  // Quem faz a transição para "pago" precisa ser um só.
  //
  // O webhook do provedor e o cron de reconciliação perseguem a mesma cobrança,
  // e o Asaas reenvia o webhook quando não recebe 200 depressa. Lendo o estado
  // antes e decidindo depois, dois processos simultâneos veem "ainda não pago"
  // e ambos disparam os efeitos: conversão contada duas vezes, candidato
  // recebendo duas confirmações e o evento de campanha indo em dobro.
  //
  // A escrita condicional resolve sem transação nem lock: só quem realmente
  // mudou a linha de "não pago" para "pago" tem `count === 1` e seguirá para os
  // efeitos. O segundo a chegar atualiza zero linhas e segue quieto.
  let euFizATransicao = false
  if (isPaidNow) {
    const r = await prisma.enrollmentRegistration.updateMany({
      where: { id: enrollment.id, paymentStatus: { not: 'paid' } },
      data: updates,
    })
    euFizATransicao = r.count === 1
    // Já estava pago: ainda assim atualiza o que não é o marco (valor, método).
    if (!euFizATransicao) {
      const { paymentPaidAt, status, ...semMarco } = updates
      if (Object.keys(semMarco).length) {
        await prisma.enrollmentRegistration.update({ where: { id: enrollment.id }, data: semMarco })
      }
    }
  } else {
    await prisma.enrollmentRegistration.update({ where: { id: enrollment.id }, data: updates })
  }

  // Upsert do EnrollmentPaymentMethod
  const existing = await prisma.enrollmentPaymentMethod.findFirst({
    where: { registrationId: enrollment.id, externalId: norm.externalId },
    select: { id: true },
  })
  if (existing) {
    await prisma.enrollmentPaymentMethod.update({
      where: { id: existing.id },
      data: {
        status: norm.status,
        ...(isPaidNow && norm.paidAt ? { paidAt: norm.paidAt } : {}),
      },
    })
  } else {
    const methodKind = norm.billingType === 'PIX' ? 'pix'
      : norm.billingType === 'BOLETO' ? 'boleto'
      : norm.billingType === 'CREDIT_CARD' ? 'credit_card'
      : 'pix'
    await prisma.enrollmentPaymentMethod.create({
      data: {
        registrationId: enrollment.id,
        method: methodKind,
        provider: conn.provider,
        externalId: norm.externalId,
        status: norm.status,
        amount: norm.amount ?? 0,
        paidAt: isPaidNow && norm.paidAt ? norm.paidAt : null,
      },
    })
  }

  // Side effects — só para quem venceu a corrida da transição.
  if (euFizATransicao) {
    // A reconciliação confirma pagamento igual ao webhook, então consome o
    // cupom pelo mesmo caminho — senão quem pagou por aqui não teria o resgate
    // registrado, e o cupom ficaria eternamente "reservado".
    void import('./portalCupom.js').then((m) => m.consumirCupom(enrollment.id)).catch(() => {})

    await prisma.enrollmentPortal.update({
      where: { id: enrollment.portalId },
      data: { conversions: { increment: 1 } },
    }).catch(() => {})
    if (enrollment.leadId) {
      logEvent({
        leadId: enrollment.leadId,
        type: 'payment_received',
        category: 'lifecycle',
        title: `Pagamento recebido — ${enrollment.candidateCode}`,
        channel: 'payment',
        source: conn.provider,
        actorType: 'system',
        metadata: {
          paymentId: norm.externalId,
          amount: norm.amount,
          billingType: norm.billingType,
          sync: 'auto',
        },
      })
    }
    import('./enrollmentNotify.js').then(m =>
      m.sendPaymentConfirmation?.({ enrollmentId: enrollment.id }).catch(() => {})
    ).catch(() => {})
  }

  return {
    ok: true,
    enrollmentId: enrollment.id,
    candidateCode: enrollment.candidateCode,
    paymentStatus: norm.status,
    wasPaid,
    transitionedToPaid: euFizATransicao,
  }
}

// ─── Cron de reconciliação ────────────────────────────────
// Varre EnrollmentPaymentMethod pending das últimas 48h e força sync.
// Roda a cada 60s. Garante captura mesmo quando o webhook do provider não está
// configurado ou falhou. O sync em si é idempotente — se já estava paid, não faz nada.

let reconciliationTimer: NodeJS.Timeout | null = null
const RECONCILIATION_INTERVAL_MS = 60_000        // 1 min
const RECONCILIATION_BATCH = 30                  // até 30 methods por tick
const RECONCILIATION_WINDOW_HOURS = 48           // só métodos criados nas últimas 48h
const RECONCILIATION_THROTTLE_MS = 1000          // 1s entre requests pra não bater rate-limit

async function reconcilePendingPayments(): Promise<{ checked: number; transitioned: number; errors: number }> {
  const since = new Date(Date.now() - RECONCILIATION_WINDOW_HOURS * 3600 * 1000)
  const methods = await prisma.enrollmentPaymentMethod.findMany({
    where: {
      status: 'pending',
      createdAt: { gte: since },
      externalId: { not: null },
    },
    orderBy: { createdAt: 'desc' },
    take: RECONCILIATION_BATCH,
    select: {
      id: true, externalId: true, provider: true, registrationId: true,
      registration: {
        select: {
          portal: {
            select: {
              paymentConnection: { select: { id: true, provider: true, active: true, apiKey: true, environment: true, publicKey: true } },
            },
          },
        },
      },
    },
  })

  let transitioned = 0
  let errors = 0

  for (const m of methods) {
    const conn = m.registration?.portal?.paymentConnection
    if (!conn || !conn.active || !m.externalId) continue
    // A cobrança só pode ser consultada no provedor que a emitiu. Depois de
    // trocar o provedor do portal (simulado → Asaas, por exemplo), as cobranças
    // antigas continuavam sendo perguntadas ao provedor novo, que nunca as
    // reconhece: erro a cada tick, para sempre, gastando chamada de API.
    if (m.provider && m.provider !== conn.provider) continue
    try {
      const result = await syncChargeFromProvider(conn, m.externalId)
      if (result.transitionedToPaid) transitioned++
      if (!result.ok) errors++
    } catch (e) {
      errors++
    }
    // Throttle
    await new Promise(r => setTimeout(r, RECONCILIATION_THROTTLE_MS))
  }

  return { checked: methods.length, transitioned, errors }
}

// ─── Audit de webhook hits ────────────────────────────────
// Persistido pelos handlers Pagar.me/Asaas pra alimentar o painel admin.
// Falha de log NÃO bloqueia processamento — sempre wrap em try/catch.

export interface WebhookHitInput {
  connectionId: number | null
  provider: string                                // pagarme | asaas
  eventType: string
  externalId: string | null
  status: 'received' | 'processed' | 'ignored' | 'notFound' | 'error'
  registrationId?: number | null
  errorMessage?: string | null
  payload: any
  signatureValid?: boolean
  remoteIp?: string | null
  userAgent?: string | null
}

export async function recordWebhookHit(input: WebhookHitInput): Promise<number | null> {
  try {
    const row = await prisma.paymentWebhookHit.create({
      data: {
        connectionId: input.connectionId,
        provider: input.provider,
        eventType: input.eventType || 'unknown',
        externalId: input.externalId ?? null,
        status: input.status,
        registrationId: input.registrationId ?? null,
        errorMessage: input.errorMessage ?? null,
        payload: input.payload || {},
        signatureValid: input.signatureValid ?? true,
        remoteIp: input.remoteIp ?? null,
        userAgent: input.userAgent ?? null,
      },
      select: { id: true },
    })
    return row.id
  } catch (e: any) {
    console.warn('[recordWebhookHit] falhou:', e?.message)
    return null
  }
}

export async function updateWebhookHit(
  id: number,
  patch: { status: WebhookHitInput['status']; errorMessage?: string | null; registrationId?: number | null },
): Promise<void> {
  try {
    await prisma.paymentWebhookHit.update({
      where: { id },
      data: {
        status: patch.status,
        errorMessage: patch.errorMessage ?? null,
        ...(patch.registrationId !== undefined ? { registrationId: patch.registrationId } : {}),
      },
    })
  } catch (e: any) {
    console.warn('[updateWebhookHit] falhou:', e?.message)
  }
}

export function startPaymentReconciliationScheduler(): void {
  if (reconciliationTimer) return
  reconciliationTimer = setInterval(async () => {
    try {
      const r = await reconcilePendingPayments()
      if (r.transitioned > 0 || r.errors > 0) {
        console.log(`[PaymentSync] tick — checked=${r.checked} transitionedToPaid=${r.transitioned} errors=${r.errors}`)
      }
      // Mensalidades do ERP cobradas pela iugu: mesma rede de segurança para
      // quando o gatilho não chega (URL mudou, gatilho não cadastrado…).
      const erp = await import('./acaFinanceiro.js').then((m) => m.reconciliarParcelasIugu()).catch(() => null)
      if (erp && (erp.baixadas > 0 || erp.erros > 0)) {
        console.log(`[PaymentSync] parcelas iugu — conferidas=${erp.conferidas} baixadas=${erp.baixadas} erros=${erp.erros}`)
      }
    } catch (err: any) {
      console.warn('[PaymentSync] erro no cron:', err?.message || err)
    }
  }, RECONCILIATION_INTERVAL_MS)
  console.log(`[PaymentSync] Reconciliation scheduler iniciado (a cada ${RECONCILIATION_INTERVAL_MS / 1000}s)`)
}
