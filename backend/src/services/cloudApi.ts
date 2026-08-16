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

/** De qual tela veio a chamada, deduzido do caminho da Graph. O tradutor de
 *  erros precisa disso: "(#100)" num envio fala de contato, e no perfil fala de
 *  campo do formulário. */
function contextForPath(path: string): 'send' | 'profile' | 'automation' | 'account' {
  if (path.includes('/messages')) return 'send'
  if (path.includes('whatsapp_business_profile')) return 'profile'
  if (path.includes('conversational_automation')) return 'automation'
  return 'account'
}

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
    throw new Error(humanizeWhatsAppError(err, resp.status, contextForPath(path)))
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
  mediaType: 'image' | 'video' | 'audio' | 'document' | 'sticker',
  media: { link?: string; id?: string; caption?: string; filename?: string }
): Promise<{ messageId: string | null }> {
  const mediaObj: any = {}
  if (media.link) mediaObj.link = media.link
  if (media.id) mediaObj.id = media.id
  // Figurinha não aceita legenda na Cloud API — mandar `caption` faz a Meta
  // rejeitar a mensagem inteira.
  if (media.caption && mediaType !== 'sticker') mediaObj.caption = media.caption
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

/** Setores aceitos pela Meta ao **gravar** o campo `vertical` do perfil.
 *  Qualquer outro valor faz a Meta rejeitar a atualização inteira — por isso a
 *  lista é fechada. Ela é a que a própria Graph devolve no erro (#100), e não
 *  bate com a de leitura: `UNDEFINED` só aparece na leitura (significa "setor
 *  nunca definido") e `NOT_A_BIZ` não é aceito em nenhuma das duas pontas. */
export const BUSINESS_VERTICALS = [
  'OTHER', 'AUTO', 'BEAUTY', 'APPAREL', 'EDU', 'ENTERTAIN', 'EVENT_PLAN',
  'FINANCE', 'GROCERY', 'GOVT', 'HOTEL', 'HEALTH', 'NONPROFIT', 'PROF_SERVICES',
  'RETAIL', 'TRAVEL', 'RESTAURANT', 'ALCOHOL', 'ONLINE_GAMBLING',
  'PHYSICAL_GAMBLING', 'OTC_DRUGS', 'MATRIMONY_SERVICE',
] as const

export type BusinessVertical = typeof BUSINESS_VERTICALS[number]

export interface BusinessProfileInput {
  about?: string
  address?: string
  description?: string
  email?: string
  vertical?: string
  websites?: string[]
  profile_picture_handle?: string
}

/** Grava o perfil da empresa (o que o cliente vê ao abrir a conversa no WhatsApp).
 *  A Meta só altera os campos enviados; o que não vier no body permanece.
 *
 *  Dois campos não aceitam ser esvaziados e derrubam a chamada inteira quando
 *  vão em branco — quem monta o payload precisa omiti-los nesse caso:
 *    • `about` em branco  → 500 "(#131000) Something went wrong"
 *    • `vertical` vazio ou 'UNDEFINED' → 400 "(#100) Param vertical must be one of…"
 *  `address`, `description`, `email` e `websites` aceitam vazio normalmente. */
export async function updateBusinessProfile(
  phoneNumberId: string,
  token: string,
  fields: BusinessProfileInput
): Promise<void> {
  await cloudApiFetch(`/${phoneNumberId}/whatsapp_business_profile`, token, 'POST', {
    messaging_product: 'whatsapp',
    ...fields,
  })
}

/** Sobe um arquivo pela Resumable Upload API e devolve o `handle` (`h`).
 *  A foto de perfil não aceita URL nem media id — só esse handle.
 *  A sessão de upload é do APP; instalações antigas subiam pelo WABA, então o
 *  WABA fica de reserva para não quebrar quem já dependia disso. */
export async function uploadResumable(
  ownerId: string,
  token: string,
  buffer: Buffer,
  mimeType: string,
  fallbackOwnerId?: string
): Promise<string> {
  const attempt = async (owner: string): Promise<string> => {
    const sessionResp = await fetch(`${GRAPH_URL}/${owner}/uploads`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_length: buffer.length, file_type: mimeType, messaging_product: 'whatsapp' }),
    })
    const session = await sessionResp.json() as any
    if (!session?.id) {
      throw new Error(session?.error?.message || 'A Meta não abriu a sessão de upload')
    }
    const uploadResp = await fetch(`${GRAPH_URL}/${session.id}`, {
      method: 'POST',
      headers: { 'Authorization': `OAuth ${token}`, 'Content-Type': mimeType, 'file_offset': '0' },
      body: buffer as any,
    })
    const uploadResult = await uploadResp.json() as any
    if (!uploadResult?.h) {
      throw new Error(uploadResult?.error?.message || 'A Meta não devolveu o identificador do arquivo')
    }
    return uploadResult.h as string
  }

  try {
    return await attempt(ownerId)
  } catch (err) {
    if (!fallbackOwnerId || fallbackOwnerId === ownerId) throw err
    return attempt(fallbackOwnerId)
  }
}

/** Dados do número que a Meta mantém e a integração só lê (nome verificado,
 *  status de revisão do nome, qualidade, limite de disparo, webhook em uso). */
export async function getPhoneNumberInfo(phoneNumberId: string, token: string): Promise<any> {
  const fields = [
    'id', 'display_phone_number', 'verified_name', 'name_status', 'new_name_status',
    'code_verification_status', 'quality_rating', 'messaging_limit_tier',
    'platform_type', 'throughput', 'is_official_business_account', 'is_on_biz_app',
    'status', 'account_mode', 'search_visibility', 'webhook_configuration',
    'last_onboarded_time',
  ].join(',')
  return cloudApiFetch(`/${phoneNumberId}?fields=${fields}`, token)
}

// ─── Automação conversacional (o que aparece na conversa) ────

export interface ConversationalCommand { command_name: string; command_description: string }

export interface ConversationalAutomation {
  enable_welcome_message: boolean
  /** "Perguntas frequentes": até 4 atalhos que o cliente toca ao abrir a conversa. */
  prompts: string[]
  /** Comandos com "/": até 30. */
  commands: ConversationalCommand[]
}

export async function getConversationalAutomation(
  phoneNumberId: string,
  token: string
): Promise<ConversationalAutomation> {
  const result = await cloudApiFetch(`/${phoneNumberId}?fields=conversational_automation`, token)
  const ca = result?.conversational_automation || {}
  return {
    enable_welcome_message: ca.enable_welcome_message === true,
    prompts: Array.isArray(ca.prompts) ? ca.prompts : [],
    commands: Array.isArray(ca.commands) ? ca.commands : [],
  }
}

export async function updateConversationalAutomation(
  phoneNumberId: string,
  token: string,
  input: Partial<ConversationalAutomation>
): Promise<void> {
  const body: Record<string, any> = {}
  if (input.enable_welcome_message !== undefined) body.enable_welcome_message = input.enable_welcome_message
  // A Meta substitui a lista inteira: mandar [] é o jeito de apagar tudo.
  if (input.prompts !== undefined) body.prompts = input.prompts
  if (input.commands !== undefined) body.commands = input.commands
  await cloudApiFetch(`/${phoneNumberId}/conversational_automation`, token, 'POST', body)
}

/** Troca o PIN da verificação em duas etapas do número (exigido no re-registro). */
export async function setTwoStepPin(phoneNumberId: string, token: string, pin: string): Promise<void> {
  await cloudApiFetch(`/${phoneNumberId}`, token, 'POST', { pin })
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
