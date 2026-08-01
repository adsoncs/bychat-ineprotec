// src/services/cloudApi.ts
// Servico para chamadas à WhatsApp Cloud API (API Oficial Meta)

import { createCipheriv, createDecipheriv, randomBytes, createHmac, timingSafeEqual } from 'crypto'

const GRAPH_URL = 'https://graph.facebook.com/v22.0'

// ─── Token Encryption (AES-256-GCM) ─────────────────────

function getTokenKey(): Buffer {
  const key = process.env.CLOUD_API_TOKEN_KEY
  if (!key || key.length < 32) {
    throw new Error('CLOUD_API_TOKEN_KEY deve ter pelo menos 32 caracteres hex. Gere com: openssl rand -hex 32')
  }
  return Buffer.from(key.slice(0, 64), 'hex') // 32 bytes = 256 bits
}

export function encryptToken(plaintext: string): string {
  const key = getTokenKey()
  const iv = randomBytes(12) // GCM usa 12 bytes
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  // formato: iv:authTag:encrypted (tudo em hex)
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`
}

export function decryptToken(ciphertext: string): string {
  const key = getTokenKey()
  const parts = ciphertext.split(':')
  if (parts.length !== 3) throw new Error('Token criptografado invalido')
  const iv = Buffer.from(parts[0], 'hex')
  const authTag = Buffer.from(parts[1], 'hex')
  const encrypted = Buffer.from(parts[2], 'hex')
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)
  return decipher.update(encrypted) + decipher.final('utf8')
}

// ─── Webhook Signature Validation ────────────────────────

export function validateWebhookSignature(rawBody: Buffer, signature: string, appSecret: string): boolean {
  if (!signature || !signature.startsWith('sha256=')) return false
  const expectedSig = `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`
  // Comparação em tempo constante (evita timing attack na assinatura).
  const a = Buffer.from(signature)
  const b = Buffer.from(expectedSig)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

// ─── Cloud API HTTP Client ──────────────────────────────

export async function cloudApiFetch(
  path: string,
  token: string,
  method = 'GET',
  body?: any,
  useBearer = true
): Promise<any> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (useBearer) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const opts: RequestInit = { method, headers }
  if (body) opts.body = JSON.stringify(body)

  const resp = await fetch(`${GRAPH_URL}${path}`, opts)
  if (!resp.ok) {
    const err = await resp.text()
    // Códigos da Meta (131047, 131026, 190…) viram frase de operador; o texto
    // original fica no log, que é onde o suporte precisa dele.
    console.warn(`[cloudApi] ${resp.status} em ${path}: ${err.slice(0, 500)}`)
    const { humanizeWhatsAppError } = await import('../lib/whatsappErrors.js')
    throw new Error(humanizeWhatsAppError(err, resp.status))
  }
  return resp.json()
}

// ─── Send Messages ──────────────────────────────────────

export async function sendTextMessage(
  phoneNumberId: string,
  token: string,
  to: string,
  text: string
): Promise<{ messageId: string | null }> {
  const result = await cloudApiFetch(`/${phoneNumberId}/messages`, token, 'POST', {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { preview_url: true, body: text },
  })
  return { messageId: result?.messages?.[0]?.id || null }
}

export async function sendMediaMessage(
  phoneNumberId: string,
  token: string,
  to: string,
  mediaType: 'image' | 'video' | 'audio' | 'document',
  media: { link?: string; id?: string; caption?: string; filename?: string }
): Promise<{ messageId: string | null }> {
  const mediaObj: any = {}
  if (media.link) mediaObj.link = media.link
  if (media.id) mediaObj.id = media.id
  if (media.caption) mediaObj.caption = media.caption
  if (media.filename && mediaType === 'document') mediaObj.filename = media.filename

  const result = await cloudApiFetch(`/${phoneNumberId}/messages`, token, 'POST', {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: mediaType,
    [mediaType]: mediaObj,
  })
  return { messageId: result?.messages?.[0]?.id || null }
}

export async function sendTemplateMessage(
  phoneNumberId: string,
  token: string,
  to: string,
  templateName: string,
  language: string,
  components?: any[]
): Promise<{ messageId: string | null }> {
  const template: any = {
    name: templateName,
    language: { code: language },
  }
  if (components && components.length > 0) {
    template.components = components
  }

  const result = await cloudApiFetch(`/${phoneNumberId}/messages`, token, 'POST', {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template,
  })
  return { messageId: result?.messages?.[0]?.id || null }
}

export async function sendInteractiveMessage(
  phoneNumberId: string,
  token: string,
  to: string,
  interactive: any
): Promise<{ messageId: string | null }> {
  const result = await cloudApiFetch(`/${phoneNumberId}/messages`, token, 'POST', {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive,
  })
  return { messageId: result?.messages?.[0]?.id || null }
}

export async function sendReactionMessage(
  phoneNumberId: string,
  token: string,
  to: string,
  messageId: string,
  emoji: string
): Promise<{ messageId: string | null }> {
  const result = await cloudApiFetch(`/${phoneNumberId}/messages`, token, 'POST', {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'reaction',
    reaction: { message_id: messageId, emoji },
  })
  return { messageId: result?.messages?.[0]?.id || null }
}

// ─── Message Status ─────────────────────────────────────

export async function markAsRead(
  phoneNumberId: string,
  token: string,
  messageId: string
): Promise<void> {
  await cloudApiFetch(`/${phoneNumberId}/messages`, token, 'POST', {
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: messageId,
  })
}

// ─── Media Download ─────────────────────────────────────

export async function getMediaUrl(mediaId: string, token: string): Promise<string> {
  const result = await cloudApiFetch(`/${mediaId}`, token)
  if (!result?.url) throw new Error(`Media URL nao encontrada para ${mediaId}`)
  return result.url
}

export async function downloadMedia(mediaId: string, token: string): Promise<{ buffer: Buffer; mimeType: string }> {
  // Step 1: obter URL da midia
  const url = await getMediaUrl(mediaId, token)

  // Step 2: download do conteudo com auth header
  const resp = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` }
  })
  if (!resp.ok) throw new Error(`Download media falhou: ${resp.status}`)

  const mimeType = resp.headers.get('content-type') || 'application/octet-stream'
  const arrayBuffer = await resp.arrayBuffer()
  return { buffer: Buffer.from(arrayBuffer), mimeType }
}

// ─── Template Management ────────────────────────────────

export async function getTemplates(wabaId: string, token: string): Promise<any[]> {
  // Pede explicitamente os campos de diagnóstico: sem `rejected_reason`/`quality_score`
  // a Meta não os retorna e ficamos cegos ao motivo de uma reprovação/pausa.
  const fields = 'id,name,language,category,status,rejected_reason,quality_score,components'
  const result = await cloudApiFetch(`/${wabaId}/message_templates?fields=${fields}&limit=250`, token)
  return result?.data || []
}

export async function createTemplate(
  wabaId: string,
  token: string,
  templateData: {
    name: string
    language: string
    category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION'
    components: any[]
  }
): Promise<any> {
  return cloudApiFetch(`/${wabaId}/message_templates`, token, 'POST', templateData)
}

export async function deleteTemplate(
  wabaId: string,
  token: string,
  templateName: string
): Promise<void> {
  await cloudApiFetch(`/${wabaId}/message_templates?name=${encodeURIComponent(templateName)}`, token, 'DELETE')
}

// ─── Phone Number & Business Profile ────────────────────

export async function getPhoneNumbers(wabaId: string, token: string): Promise<any[]> {
  const result = await cloudApiFetch(`/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating,platform_type,throughput,status`, token)
  return result?.data || []
}

export async function getBusinessProfile(phoneNumberId: string, token: string): Promise<any> {
  const result = await cloudApiFetch(`/${phoneNumberId}/whatsapp_business_profile?fields=about,address,description,email,profile_picture_url,websites,vertical`, token)
  return result?.data?.[0] || {}
}

export async function getWabaInfo(wabaId: string, token: string): Promise<any> {
  return cloudApiFetch(`/${wabaId}?fields=name,currency,timezone_id,account_review_status,business_verification_status,ownership_type`, token)
}

// ─── Webhook Subscription ───────────────────────────────

export async function subscribeWebhook(
  wabaId: string,
  token: string
): Promise<boolean> {
  try {
    await cloudApiFetch(`/${wabaId}/subscribed_apps`, token, 'POST')
    return true
  } catch (err: any) {
    console.error(`[CloudAPI] Webhook subscription failed: ${err.message}`)
    return false
  }
}

// ─── Phone Number Format Helpers ────────────────────────

/** Normaliza telefone para formato internacional sem + (ex: 5562999999999) */
export function normalizePhone(phone: string): string {
  return phone.replace(/[\s\-\(\)\+]/g, '')
}
