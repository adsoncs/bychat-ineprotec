// src/services/paymentPagarme.ts
// Cliente Pagar.me v5 — cria link de pagamento (paymentlinks) hospedado, aceitando
// PIX + cartão + boleto. UX para leigo: 1 chave secreta basta.
// Doc: https://docs.pagar.me/reference/

const PAGARME_BASE = 'https://api.pagar.me/core/v5'

export interface PagarmeConfig {
  apiKey: string                       // sk_test_… (teste) ou sk_… (produção)
  environment?: 'production' | 'sandbox'  // derivado do prefixo da chave
  webhookToken?: string
}

/** Detecta ambiente a partir do prefixo da secret key. */
export function detectPagarmeEnvironment(apiKey: string): 'sandbox' | 'production' {
  return /^sk_test_/.test(String(apiKey || '').trim()) ? 'sandbox' : 'production'
}

export function parsePagarmeConfig(raw: any): PagarmeConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const apiKey = typeof raw.apiKey === 'string' ? raw.apiKey.trim() : ''
  if (!apiKey) return null
  return {
    apiKey,
    environment: detectPagarmeEnvironment(apiKey),
    webhookToken: typeof raw.webhookToken === 'string' ? raw.webhookToken : undefined,
  }
}

function authHeader(apiKey: string): string {
  return 'Basic ' + Buffer.from(`${apiKey}:`).toString('base64')
}

async function pagarmeFetch(config: PagarmeConfig, path: string, method = 'GET', body?: any): Promise<any> {
  const res = await fetch(`${PAGARME_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': authHeader(config.apiKey),
      'User-Agent': 'bychat-beyond/1.0',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    // Pagar.me retorna `errors` em dois formatos:
    //   array:  [{ message: "..." }]
    //   objeto: { "Field.Path": ["msg1", "msg2"] }  ← formato ASP.NET ProblemDetails
    let detail = ''
    if (Array.isArray(data?.errors)) {
      detail = data.errors.map((e: any) => e?.message).filter(Boolean).join('; ')
    } else if (data?.errors && typeof data.errors === 'object') {
      detail = Object.entries(data.errors)
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
        .join('; ')
    }
    const msg = data?.message
      || detail
      || `HTTP ${res.status}`
    const err: any = new Error(`Pagar.me: ${msg}`)
    err.status = res.status
    err.data = data
    throw err
  }
  return data
}

// Ping leve para validar a chave.
// /merchants/me só responde para chaves de marketplace/reseller; uma sk_ de merchant
// comum recebe 401/403 ali mesmo sendo válida. Por isso usamos fallback para /orders.
export async function pingPagarme(apiKey: string): Promise<{ ok: boolean; message: string }> {
  const envLabel = detectPagarmeEnvironment(apiKey) === 'sandbox' ? 'TESTE' : 'PRODUÇÃO'
  try {
    const res = await fetch(`${PAGARME_BASE}/merchants/me`, {
      method: 'GET',
      headers: { 'Authorization': authHeader(apiKey), 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (res.ok) {
      const d: any = await res.json().catch(() => ({}))
      const name = d?.name || d?.business_name || d?.legal_name || 'conta válida'
      return { ok: true, message: `Conectado: ${name} (${envLabel})` }
    }
    const r2 = await fetch(`${PAGARME_BASE}/orders?size=1`, {
      method: 'GET',
      headers: { 'Authorization': authHeader(apiKey), 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (r2.status === 401 || r2.status === 403) {
      return { ok: false, message: 'Chave inválida ou sem permissão' }
    }
    if (!r2.ok) {
      const txt = await r2.text().catch(() => '')
      return { ok: false, message: `HTTP ${r2.status}: ${txt.substring(0, 160) || r2.statusText}` }
    }
    return { ok: true, message: `Conectado (${envLabel})` }
  } catch (e: any) {
    return { ok: false, message: `Falha de rede: ${e.message}` }
  }
}

// ─── Customer ────────────────────────────────────────────

export interface PagarmeCustomerInput {
  name: string
  email?: string
  cpfCnpj?: string
  phone?: string
  externalReference?: string
}

function buildPhone(raw: string | undefined) {
  if (!raw) return undefined
  const digits = String(raw).replace(/\D/g, '')
  // Pagar.me aceita { mobile_phone: { country_code, area_code, number } } — só BR pra leigo
  if (digits.length < 10) return undefined
  const areaCode = digits.slice(-11, -9) || digits.slice(0, 2)
  const number = digits.slice(-9)
  return { country_code: '55', area_code: areaCode, number }
}

export async function createOrFindPagarmeCustomer(config: PagarmeConfig, input: PagarmeCustomerInput): Promise<{ id: string; name: string }> {
  if (input.cpfCnpj) {
    const clean = String(input.cpfCnpj).replace(/\D/g, '')
    if (clean) {
      const found = await pagarmeFetch(config, `/customers?document=${clean}`).catch(() => ({ data: [] }))
      if (Array.isArray(found?.data) && found.data.length > 0) {
        return { id: found.data[0].id, name: found.data[0].name }
      }
    }
  }
  const cleanDoc = input.cpfCnpj ? String(input.cpfCnpj).replace(/\D/g, '') : undefined
  const body: any = {
    name: input.name,
    type: cleanDoc && cleanDoc.length === 14 ? 'company' : 'individual',
  }
  if (input.email) body.email = input.email
  if (cleanDoc) {
    body.document = cleanDoc
    body.document_type = cleanDoc.length === 14 ? 'CNPJ' : 'CPF'
  }
  const phone = buildPhone(input.phone)
  if (phone) body.phones = { mobile_phone: phone }
  if (input.externalReference) body.code = input.externalReference

  const customer = await pagarmeFetch(config, '/customers', 'POST', body)
  return { id: customer.id, name: customer.name }
}

// ─── Payment Link ────────────────────────────────────────

export interface PagarmePaymentInput {
  customerId?: string
  customer?: PagarmeCustomerInput
  value: number          // BRL (reais), convertido para centavos internamente
  dueDate: Date
  description?: string
  externalReference: string   // "enrollment-<id>"
  callbackUrl?: string
}

export interface PagarmePaymentResult {
  id: string
  status: string
  invoiceUrl: string
  dueDate: string
  value: number          // BRL
}

/**
 * Cria um link de pagamento aceitando PIX, cartão e boleto.
 * Retorna o `url` hospedado pelo Pagar.me, equivalente ao `invoiceUrl` do Asaas.
 */
export async function createPagarmePayment(config: PagarmeConfig, input: PagarmePaymentInput): Promise<PagarmePaymentResult> {
  const amountCents = Math.round(Number(input.value) * 100)
  const expiresInSec = Math.max(60, Math.floor((input.dueDate.getTime() - Date.now()) / 1000))
  // Boleto exige due_in (em dias) — não aceita due_at junto com expires_in global.
  const boletoDueInDays = Math.max(1, Math.ceil(expiresInSec / 86400))
  const description = (input.description || 'Cobrança').substring(0, 64)

  const body: any = {
    is_building: false,
    name: description,
    type: 'order',
    expires_in: expiresInSec,
    payment_settings: {
      accepted_payment_methods: ['credit_card', 'pix', 'boleto'],
      credit_card_settings: {
        operation_type: 'auth_and_capture',
        installments: [{ number: 1, total: amountCents }],
      },
      pix_settings: {
        expires_in: expiresInSec,
      },
      // Pagar.me rejeita `due_at` no boleto quando `expires_in` global está setado;
      // exige `due_in` (em dias) como alternativa.
      boleto_settings: {
        due_in: boletoDueInDays,
        instructions: description.substring(0, 255),
      },
    },
    cart_settings: {
      items: [{
        amount: amountCents,
        name: description,
        default_quantity: 1,
        description: description,
      }],
    },
    metadata: { external_reference: input.externalReference },
  }
  if (input.callbackUrl) body.layout_settings = { ...(body.layout_settings || {}), success_url: input.callbackUrl }

  if (input.customerId) {
    body.customer_settings = { customer_id: input.customerId }
  } else if (input.customer) {
    const cleanDoc = input.customer.cpfCnpj ? String(input.customer.cpfCnpj).replace(/\D/g, '') : undefined
    const phone = buildPhone(input.customer.phone)
    body.customer_settings = {
      customer: {
        name: input.customer.name,
        type: cleanDoc && cleanDoc.length === 14 ? 'company' : 'individual',
        ...(input.customer.email ? { email: input.customer.email } : {}),
        ...(cleanDoc ? { document: cleanDoc, document_type: cleanDoc.length === 14 ? 'CNPJ' : 'CPF' } : {}),
        ...(phone ? { phones: { mobile_phone: phone } } : {}),
      },
    }
  }

  const link = await pagarmeFetch(config, '/paymentlinks', 'POST', body)
  return {
    id: link.id,
    status: link.status || 'active',
    invoiceUrl: link.url,
    dueDate: input.dueDate.toISOString(),
    value: input.value,
  }
}

// ─── Checkout transparente — Orders API ──────────────────
// Diferente do paymentlink (página hospedada), aqui criamos uma Order direto e
// extraímos os dados (QR PIX, linha do boleto) para renderizar no nosso portal.

export type PagarmeOrderMethod = 'pix' | 'boleto' | 'credit_card'

export interface PagarmeOrderInput {
  method: PagarmeOrderMethod
  customer: PagarmeCustomerInput
  value: number              // BRL
  dueDate: Date
  description?: string
  externalReference: string
  /** Cartão: token gerado no frontend via tokenizecard.js (PCI SAQ A). Obrigatório se method='credit_card'. */
  cardToken?: string
  installments?: number      // cartão; default 1
}

export interface PagarmeOrderResult {
  orderId: string
  chargeId: string | null
  status: string             // mapeado via PAGARME_STATUS_MAP (pending|paid|...)
  value: number
  // PIX
  pixQrCode?: string         // string copy-paste
  pixQrCodeUrl?: string      // URL da imagem PNG
  expiresAt?: string         // ISO
  // Boleto
  boletoLine?: string
  boletoBarcode?: string
  boletoPdfUrl?: string
  boletoDueAt?: string
  // Cartão
  cardLastDigits?: string
  cardBrand?: string
}

/**
 * Cria uma Order no Pagar.me v5 com método transparente. NÃO redireciona —
 * retorna os dados para o frontend renderizar (QR PIX, linha do boleto, status do cartão).
 */
export async function createPagarmeOrder(config: PagarmeConfig, input: PagarmeOrderInput): Promise<PagarmeOrderResult> {
  const amountCents = Math.round(Number(input.value) * 100)
  const expiresInSec = Math.max(60, Math.floor((input.dueDate.getTime() - Date.now()) / 1000))
  const boletoDueInDays = Math.max(1, Math.ceil(expiresInSec / 86400))
  const description = (input.description || 'Cobrança').substring(0, 64)

  const cleanDoc = input.customer.cpfCnpj ? String(input.customer.cpfCnpj).replace(/\D/g, '') : undefined
  const phone = buildPhone(input.customer.phone)
  const customerPayload: any = {
    name: input.customer.name,
    type: cleanDoc && cleanDoc.length === 14 ? 'company' : 'individual',
    ...(input.customer.email ? { email: input.customer.email } : {}),
    ...(cleanDoc ? { document: cleanDoc, document_type: cleanDoc.length === 14 ? 'CNPJ' : 'CPF' } : {}),
    ...(phone ? { phones: { mobile_phone: phone } } : {}),
  }

  const payment: any = { payment_method: input.method }
  if (input.method === 'pix') {
    payment.pix = { expires_in: expiresInSec }
  } else if (input.method === 'boleto') {
    payment.boleto = { due_in: boletoDueInDays, instructions: description.substring(0, 255) }
  } else if (input.method === 'credit_card') {
    if (!input.cardToken) throw new Error('Pagar.me: cardToken obrigatório para método credit_card')
    payment.credit_card = {
      operation_type: 'auth_and_capture',
      installments: Math.max(1, Math.min(input.installments || 1, 12)),
      statement_descriptor: description.substring(0, 13), // limite Pagar.me
      card_token: input.cardToken,
    }
  }

  const body = {
    // `code` em items é obrigatório pelo gateway pra boleto (412 The item Code is required).
    items: [{ amount: amountCents, description: description, quantity: 1, code: input.externalReference }],
    customer: customerPayload,
    payments: [payment],
    code: input.externalReference,
    metadata: { external_reference: input.externalReference },
  }

  const order = await pagarmeFetch(config, '/orders', 'POST', body)
  const charge = Array.isArray(order?.charges) && order.charges.length > 0 ? order.charges[0] : null
  const lastTx = charge?.last_transaction || {}

  // Gateway pode aceitar a request (HTTP 200) mas recusar a cobrança no fluxo de
  // antifraude/emissor — vem `charge.status === 'failed'` + `last_transaction.gateway_response.errors`.
  // Tratamos isso como falha de criação pra que o caller (/payment-init) retorne erro claro pro UI.
  const chargeStatusRaw = String(charge?.status || '').toLowerCase()
  if (chargeStatusRaw === 'failed' || lastTx.status === 'with_error' || lastTx.status === 'failed') {
    const gw = lastTx.gateway_response || {}
    const detail = Array.isArray(gw.errors) && gw.errors[0]?.message
      ? gw.errors.map((e: any) => e.message).join('; ')
      : `gateway recusou (${chargeStatusRaw || lastTx.status})`
    const err: any = new Error(`Pagar.me recusou a cobrança: ${detail}`)
    err.gateway = gw
    err.chargeId = charge?.id
    throw err
  }

  const result: PagarmeOrderResult = {
    orderId: order.id,
    chargeId: charge?.id ?? null,
    status: PAGARME_STATUS_MAP[chargeStatusRaw || String(order?.status || '').toLowerCase()] || 'pending',
    value: input.value,
  }

  if (input.method === 'pix') {
    result.pixQrCode = lastTx.qr_code
    result.pixQrCodeUrl = lastTx.qr_code_url
    result.expiresAt = lastTx.expires_at || new Date(Date.now() + expiresInSec * 1000).toISOString()
  } else if (input.method === 'boleto') {
    result.boletoLine = lastTx.line
    result.boletoBarcode = lastTx.barcode
    result.boletoPdfUrl = lastTx.pdf || lastTx.url
    result.boletoDueAt = lastTx.due_at || new Date(Date.now() + boletoDueInDays * 86400 * 1000).toISOString()
  } else if (input.method === 'credit_card') {
    const card = lastTx.card || {}
    result.cardLastDigits = card.last_four_digits
    result.cardBrand = card.brand
  }

  return result
}

// ─── Webhook event parsing ───────────────────────────────

// Pagar.me envia tipos como "order.paid", "charge.paid", "charge.refunded" etc.
// Mapa para o status interno (mesmas chaves que ASAAS_STATUS_MAP).
export const PAGARME_STATUS_MAP: Record<string, string> = {
  paid:              'paid',
  authorized_pending_capture: 'pending',
  pending:           'pending',
  processing:        'pending',
  waiting_payment:   'pending',
  not_authorized:    'overdue',
  failed:            'overdue',
  canceled:          'overdue',
  refunded:          'refunded',
  partial_refunded:  'refunded',
  chargedback:       'refunded',
  overpaid:          'paid',
  underpaid:         'pending',
}

export function isPagarmePaymentEvent(event: string): boolean {
  if (typeof event !== 'string') return false
  return event.startsWith('order.') || event.startsWith('charge.')
}

/**
 * Normaliza o payload do webhook do Pagar.me para o shape comum:
 * - id: identificador do pagamento (charge.id ou order.id)
 * - status: status interno (paid/pending/overdue/refunded)
 * - billingType: PIX/CREDIT_CARD/BOLETO (em caixa alta, igual Asaas)
 * - externalReference: extraído de order.code/metadata
 * - paymentDate: data de confirmação (se houver)
 * - value: valor em BRL (reais)
 */
export interface PagarmeWebhookNormalized {
  id: string
  status: string
  billingType: string
  externalReference: string | null
  paymentDate: string | null
  value: number
}

export function parsePagarmeWebhookPayload(body: any): { event: string; payment: PagarmeWebhookNormalized | null } {
  const event = String(body?.type || body?.event || '')
  const data = body?.data || body?.payment || {}

  // Pagar.me retorna ora 'order' ora 'charge' como objeto principal
  const order = data.code !== undefined || data.charges ? data : null
  const charge = data.code === undefined && data.payment_method ? data : (order?.charges?.[0] || null)

  const billingMap: Record<string, string> = {
    credit_card: 'CREDIT_CARD',
    debit_card:  'CREDIT_CARD',
    pix:         'PIX',
    boleto:      'BOLETO',
  }
  const rawMethod = charge?.payment_method || charge?.last_transaction?.payment_method || data?.payment_method || ''
  const billingType = billingMap[String(rawMethod).toLowerCase()] || 'UNDEFINED'

  const rawStatus = String(charge?.status || order?.status || data?.status || '').toLowerCase()
  const status = PAGARME_STATUS_MAP[rawStatus] || 'pending'

  const externalReference = order?.code
    || data?.code
    || data?.metadata?.external_reference
    || order?.metadata?.external_reference
    || null

  const paidAt = charge?.paid_at || order?.closed_at || data?.paid_at || null

  const amountCents = Number(charge?.amount ?? order?.amount ?? data?.amount ?? 0)
  const value = amountCents > 0 ? amountCents / 100 : 0

  const id = String(charge?.id || order?.id || data?.id || '')
  if (!id) return { event, payment: null }

  return {
    event,
    payment: {
      id,
      status,
      billingType,
      externalReference,
      paymentDate: paidAt,
      value,
    },
  }
}
