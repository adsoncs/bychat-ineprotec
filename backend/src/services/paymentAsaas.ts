// src/services/paymentAsaas.ts
// Cliente Asaas + criação de cobranças + parser de webhooks.
// Doc: https://docs.asaas.com/reference/

const ASAAS_BASE = {
  production: 'https://api.asaas.com/v3',
  sandbox: 'https://api-sandbox.asaas.com/v3',
}

export interface AsaasConfig {
  apiKey: string
  environment?: 'production' | 'sandbox'
  webhookToken?: string
  billingType?: 'UNDEFINED' | 'PIX' | 'BOLETO' | 'CREDIT_CARD'
  /** Configurações opcionais de desconto/multa/juros (passam direto ao Asaas) */
  fine?: { value: number; type?: 'FIXED' | 'PERCENTAGE' }
  interest?: { value: number; type?: 'PERCENTAGE' }
}

export function parseAsaasConfig(raw: any): AsaasConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const apiKey = typeof raw.apiKey === 'string' ? raw.apiKey.trim() : ''
  if (!apiKey) return null
  return {
    apiKey,
    environment: raw.environment === 'production' ? 'production' : 'sandbox',
    webhookToken: typeof raw.webhookToken === 'string' ? raw.webhookToken : undefined,
    billingType: ['UNDEFINED','PIX','BOLETO','CREDIT_CARD'].includes(raw.billingType) ? raw.billingType : 'UNDEFINED',
    fine: raw.fine,
    interest: raw.interest,
  }
}

async function asaasFetch(config: AsaasConfig, path: string, method = 'GET', body?: any): Promise<any> {
  const base = ASAAS_BASE[config.environment || 'sandbox']
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'access_token': config.apiKey,
      'User-Agent': 'bychat-beyond/1.0',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = data?.errors?.[0]?.description || data?.message || `HTTP ${res.status}`
    const err: any = new Error(`Asaas: ${msg}`)
    err.status = res.status
    err.data = data
    throw err
  }
  return data
}

// ─── Customer ────────────────────────────────────────────

export interface AsaasCustomerInput {
  name: string
  email?: string
  cpfCnpj?: string
  phone?: string
  mobilePhone?: string
  postalCode?: string
  address?: string
  externalReference?: string
}

export async function createOrFindAsaasCustomer(config: AsaasConfig, input: AsaasCustomerInput): Promise<{ id: string; name: string }> {
  // Se tem CPF, tenta buscar antes (evita duplicar)
  if (input.cpfCnpj) {
    const clean = String(input.cpfCnpj).replace(/\D/g, '')
    if (clean) {
      const found = await asaasFetch(config, `/customers?cpfCnpj=${clean}`).catch(() => ({ data: [] }))
      if (found?.data?.length > 0) return { id: found.data[0].id, name: found.data[0].name }
    }
  }
  const body: any = { name: input.name }
  if (input.email) body.email = input.email
  if (input.cpfCnpj) body.cpfCnpj = String(input.cpfCnpj).replace(/\D/g, '')
  if (input.mobilePhone || input.phone) body.mobilePhone = String(input.mobilePhone || input.phone).replace(/\D/g, '')
  if (input.postalCode) body.postalCode = String(input.postalCode).replace(/\D/g, '')
  if (input.address) body.address = input.address
  if (input.externalReference) body.externalReference = input.externalReference
  const customer = await asaasFetch(config, '/customers', 'POST', body)
  return { id: customer.id, name: customer.name }
}

// ─── Payment ─────────────────────────────────────────────

export interface AsaasPaymentInput {
  customerId: string
  value: number
  dueDate: Date
  description?: string
  externalReference: string   // nosso enrollmentId como string
  billingType?: 'UNDEFINED' | 'PIX' | 'BOLETO' | 'CREDIT_CARD'
  callbackUrl?: string  // URL para onde o Asaas redireciona após pagar pelo checkout
}

export interface AsaasPaymentResult {
  id: string
  status: string
  billingType: string
  invoiceUrl: string       // URL pública do pagamento (checkout Asaas)
  bankSlipUrl?: string
  pixQrCode?: string
  dueDate: string
  value: number
}

export async function createAsaasPayment(config: AsaasConfig, input: AsaasPaymentInput): Promise<AsaasPaymentResult> {
  const body: any = {
    customer: input.customerId,
    billingType: input.billingType || config.billingType || 'UNDEFINED',
    value: Number(input.value.toFixed(2)),
    dueDate: input.dueDate.toISOString().slice(0, 10),
    description: (input.description || '').substring(0, 499),
    externalReference: input.externalReference,
  }
  if (input.callbackUrl) body.callback = { successUrl: input.callbackUrl, autoRedirect: true }
  if (config.fine) body.fine = config.fine
  if (config.interest) body.interest = config.interest

  const p = await asaasFetch(config, '/payments', 'POST', body)
  return {
    id: p.id,
    status: p.status,
    billingType: p.billingType,
    invoiceUrl: p.invoiceUrl,
    bankSlipUrl: p.bankSlipUrl,
    dueDate: p.dueDate,
    value: p.value,
  }
}

export async function getAsaasPaymentStatus(config: AsaasConfig, paymentId: string): Promise<any> {
  return asaasFetch(config, `/payments/${encodeURIComponent(paymentId)}`)
}

// ─── Checkout transparente ──────────────────────────────
// Asaas: o QR do PIX vem em endpoint separado; boleto traz bankSlipUrl/identificationField
// no próprio Payment retornado. Aqui unificamos no shape PagarmeOrderResult (compatível com
// PagarmeOrder*) pra simplificar o caller.

export interface AsaasPixQr {
  encodedImage: string     // base64 do PNG (sem prefixo data:image)
  payload: string          // string copy-paste
  expirationDate: string   // ISO
}

/**
 * Busca dados do QR Code PIX de um pagamento Asaas.
 * Só faz sentido chamar após createAsaasPayment com billingType=PIX (ou UNDEFINED com fallback).
 */
export async function fetchAsaasPixQr(config: AsaasConfig, paymentId: string): Promise<AsaasPixQr | null> {
  try {
    const r = await asaasFetch(config, `/payments/${encodeURIComponent(paymentId)}/pixQrCode`)
    if (!r?.encodedImage || !r?.payload) return null
    return {
      encodedImage: r.encodedImage,
      payload: r.payload,
      expirationDate: r.expirationDate,
    }
  } catch {
    return null
  }
}

export type AsaasOrderMethod = 'pix' | 'boleto' | 'credit_card'

export interface AsaasOrderInput {
  method: AsaasOrderMethod
  customer: AsaasCustomerInput
  value: number
  dueDate: Date
  description?: string
  externalReference: string
  /** Cartão Asaas: token salvo previamente (tokenizeCreditCard endpoint) */
  cardToken?: string
  remoteIp?: string         // exigido pra cartão
}

export interface AsaasOrderResult {
  paymentId: string
  status: string
  billingType: string
  value: number
  // PIX
  pixQrCode?: string        // payload copy-paste
  pixQrCodeUrl?: string     // data:image/png;base64,…
  expiresAt?: string
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
 * Cria uma cobrança transparente no Asaas e retorna os dados pra renderizar no portal.
 * Inclui PIX (busca o QR depois), boleto (já vem bankSlipUrl/identificationField) e cartão (com card_token).
 */
export async function createAsaasOrder(config: AsaasConfig, input: AsaasOrderInput): Promise<AsaasOrderResult> {
  // 1) customer
  const cust = await createOrFindAsaasCustomer(config, input.customer)

  // 2) cria payment com billingType correto
  const billingType =
    input.method === 'pix' ? 'PIX'
    : input.method === 'boleto' ? 'BOLETO'
    : 'CREDIT_CARD'

  const body: any = {
    customer: cust.id,
    billingType,
    value: Number(input.value.toFixed(2)),
    dueDate: input.dueDate.toISOString().slice(0, 10),
    description: (input.description || '').substring(0, 499),
    externalReference: input.externalReference,
  }
  if (input.method === 'credit_card') {
    if (!input.cardToken) throw new Error('Asaas: cardToken obrigatório para método credit_card')
    body.creditCardToken = input.cardToken
    if (input.remoteIp) body.remoteIp = input.remoteIp
  }

  const p = await asaasFetch(config, '/payments', 'POST', body)
  const result: AsaasOrderResult = {
    paymentId: p.id,
    status: ASAAS_STATUS_MAP[p.status] || 'pending',
    billingType: p.billingType,
    value: Number(p.value),
  }

  if (input.method === 'pix') {
    const qr = await fetchAsaasPixQr(config, p.id)
    if (qr) {
      result.pixQrCode = qr.payload
      result.pixQrCodeUrl = `data:image/png;base64,${qr.encodedImage}`
      result.expiresAt = qr.expirationDate
    }
  } else if (input.method === 'boleto') {
    if (p.identificationField) result.boletoLine = p.identificationField
    if (p.nossoNumero) result.boletoBarcode = p.nossoNumero
    if (p.bankSlipUrl) result.boletoPdfUrl = p.bankSlipUrl
    if (p.dueDate) result.boletoDueAt = p.dueDate
  } else if (input.method === 'credit_card') {
    const cc = p.creditCard || {}
    if (cc.creditCardNumber) result.cardLastDigits = String(cc.creditCardNumber).slice(-4)
    if (cc.creditCardBrand) result.cardBrand = cc.creditCardBrand
  }

  return result
}

// ─── Webhook event parsing ───────────────────────────────

// Mapa de eventos do Asaas para nosso status interno
export const ASAAS_STATUS_MAP: Record<string, string> = {
  PENDING:          'pending',
  RECEIVED:         'paid',
  CONFIRMED:        'paid',
  RECEIVED_IN_CASH: 'paid',
  OVERDUE:          'overdue',
  REFUNDED:         'refunded',
  REFUND_REQUESTED: 'refunded',
  CHARGEBACK_REQUESTED: 'refunded',
  CHARGEBACK_DISPUTE:   'refunded',
  AWAITING_CHARGEBACK_REVERSAL: 'refunded',
  DUNNING_REQUESTED: 'overdue',
  DUNNING_RECEIVED:  'paid',
}

export interface AsaasWebhookPayload {
  event: string           // PAYMENT_CONFIRMED, PAYMENT_OVERDUE, etc
  payment: {
    id: string
    status: string
    value: number
    billingType: string
    externalReference?: string
    paymentDate?: string
    confirmedDate?: string
    invoiceUrl?: string
  }
}

export function isAsaasPaymentEvent(event: string): boolean {
  return typeof event === 'string' && event.startsWith('PAYMENT_')
}
