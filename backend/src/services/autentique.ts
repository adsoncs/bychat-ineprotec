// src/services/autentique.ts
// Integração com a Autentique (assinatura eletrônica) — GraphQL v2.
// https://docs.autentique.com.br/api · endpoint https://api.autentique.com.br/v2/graphql
// Auth: Authorization: Bearer <token>. Upload de arquivo via "GraphQL multipart request spec".
//
// Tudo aqui é isolado: se não houver token/modo=AUTENTIQUE, o orquestrador usa o modo
// SIMULADO (sem rede), então o fluxo é 100% testável sem credencial.

import { prisma } from '../lib/prisma.js'
import crypto from 'crypto'

const ENDPOINT = 'https://api.autentique.com.br/v2/graphql'

export interface AutentiqueConfig { modo: 'SIMULADO' | 'AUTENTIQUE'; token: string | null; sandbox: boolean }

async function getSetting(key: string): Promise<string | null> {
  const r = await prisma.setting.findUnique({ where: { key }, select: { value: true } })
  const v = r?.value as any
  return typeof v === 'string' ? v : (v == null ? null : String(v))
}

/** Configuração efetiva: token vem do env (preferência) ou Setting; modo idem. */
export async function getConfig(): Promise<AutentiqueConfig> {
  const token = process.env.AUTENTIQUE_API_TOKEN || (await getSetting('assinatura.autentique.token')) || null
  const modoRaw = (await getSetting('assinatura.modo')) || (token ? 'AUTENTIQUE' : 'SIMULADO')
  const modo = modoRaw === 'AUTENTIQUE' && token ? 'AUTENTIQUE' : 'SIMULADO'
  const sandbox = (await getSetting('assinatura.autentique.sandbox')) !== 'false' // default true (não consome documento)
  return { modo, token, sandbox }
}

export async function setConfig(p: { modo?: string; token?: string; sandbox?: boolean; webhookSecret?: string }): Promise<void> {
  const up = async (key: string, value: string, label: string, fieldType = 'text') =>
    prisma.setting.upsert({ where: { key }, update: { value: value as any }, create: { key, label, grp: 'academico', fieldType, value: value as any } })
  const tokenInformado = typeof p.token === 'string' && p.token.trim().length > 0
  if (p.token !== undefined) await up('assinatura.autentique.token', p.token.trim(), 'Token Autentique', 'text')
  // Se um token foi informado e o modo não foi explicitamente SIMULADO, liga o Autentique.
  const modoFinal = p.modo === 'SIMULADO' ? 'SIMULADO' : (p.modo === 'AUTENTIQUE' || tokenInformado) ? 'AUTENTIQUE' : undefined
  if (modoFinal !== undefined) await up('assinatura.modo', modoFinal, 'Modo de assinatura')
  if (p.sandbox !== undefined) await up('assinatura.autentique.sandbox', p.sandbox ? 'true' : 'false', 'Sandbox Autentique', 'boolean')
  if (p.webhookSecret !== undefined) await up('assinatura.autentique.webhook_secret', p.webhookSecret.trim(), 'Webhook secret Autentique', 'password')
}

/** Secret do webhook (Settings ou env). Vazio = verificação desligada. */
export async function getWebhookSecret(): Promise<string | null> {
  return process.env.AUTENTIQUE_WEBHOOK_SECRET || (await getSetting('assinatura.autentique.webhook_secret')) || null
}

/**
 * Verifica a assinatura do webhook (header x-autentique-signature = HMAC-SHA256(secret, rawBody) em hex).
 * Retorna: 'ok' (válida), 'invalida' (não confere), 'sem_secret' (verificação desligada — aceita).
 */
export async function verificarAssinaturaWebhook(rawBody: Buffer | string | undefined, signature: string | undefined): Promise<'ok' | 'invalida' | 'sem_secret'> {
  const secret = await getWebhookSecret()
  if (!secret) return 'sem_secret'
  if (!rawBody || !signature) return 'invalida'
  const calc = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(calc, 'hex'); const b = Buffer.from(String(signature).trim(), 'hex')
  if (a.length !== b.length) return 'invalida'
  return crypto.timingSafeEqual(a, b) ? 'ok' : 'invalida'
}

interface GqlResult<T> { data?: T; errors?: Array<{ message: string }> }

async function gql<T>(token: string, query: string, variables: any): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  const j = (await res.json()) as GqlResult<T>
  if (j.errors?.length) throw new Error('Autentique: ' + j.errors.map((e) => e.message).join('; '))
  if (!j.data) throw new Error('Autentique: resposta vazia (HTTP ' + res.status + ')')
  return j.data
}

const DELIVERY: Record<string, string> = { EMAIL: 'DELIVERY_METHOD_EMAIL', SMS: 'DELIVERY_METHOD_SMS', WHATSAPP: 'DELIVERY_METHOD_WHATSAPP' }

export interface CriarDocSigner {
  nome: string; email?: string | null; telefone?: string | null
  acao?: string          // SIGN | APPROVE | RECOGNIZE | WITNESS
  delivery?: string      // EMAIL | SMS | WHATSAPP
  exigeCpf?: boolean; exigeSelfie?: boolean; cpf?: string | null
  positions?: Array<{ x: number; y: number; z: number; element?: string }>
}
export interface DocOptions {
  message?: string | null
  reminder?: string | null   // DAILY | WEEKLY
  sortable?: boolean         // ordem sequencial
  refusable?: boolean
  deadlineAt?: string | null // ISO
}
export interface CriarDocResult {
  id: string
  signatures: Array<{ public_id: string; name: string | null; email: string | null; link: { short_link: string } | null }>
}

/** Cria um documento para assinatura enviando o PDF (multipart GraphQL upload), com recursos completos. */
export async function criarDocumento(token: string, sandbox: boolean, name: string, signers: CriarDocSigner[], pdf: Buffer, opts: DocOptions = {}): Promise<CriarDocResult> {
  const query = `mutation Criar($document: DocumentInput!, $signers: [SignerInput!]!, $file: Upload!, $sandbox: Boolean) {
    createDocument(document: $document, signers: $signers, file: $file, sandbox: $sandbox) {
      id name
      signatures { public_id name email action { name } link { short_link } }
    }
  }`
  const document: any = { name }
  if (opts.message) document.message = opts.message
  if (opts.reminder) document.reminder = opts.reminder
  if (opts.sortable !== undefined) document.sortable = opts.sortable
  if (opts.refusable !== undefined) document.refusable = opts.refusable
  if (opts.deadlineAt) document.deadline_at = opts.deadlineAt

  const variables = {
    document,
    signers: signers.map((s, i) => {
      const sig: any = { action: s.acao || 'SIGN' }
      if (s.email) sig.email = s.email
      if (s.nome) sig.name = s.nome
      if (s.telefone && (s.delivery === 'SMS' || s.delivery === 'WHATSAPP')) sig.phone = s.telefone
      if (s.delivery && DELIVERY[s.delivery]) sig.delivery_method = DELIVERY[s.delivery]
      const verifs: any[] = []
      if (s.exigeCpf) verifs.push({ type: 'SECURITY_VERIFICATION_CPF', ...(s.cpf ? { cpf: s.cpf } : {}) })
      if (s.exigeSelfie) verifs.push({ type: 'SECURITY_VERIFICATION_LIVENESS' })
      if (verifs.length) sig.security_verifications = verifs
      if (s.positions?.length) sig.positions = s.positions.map((p) => ({ x: String(p.x), y: String(p.y), z: p.z, element: p.element || 'SIGNATURE' }))
      if (opts.sortable) sig.group = i // ordem sequencial = grupos crescentes
      return sig
    }),
    file: null,
    sandbox,
  }
  const form = new FormData()
  form.append('operations', JSON.stringify({ query, variables }))
  form.append('map', JSON.stringify({ '0': ['variables.file'] }))
  form.append('0', new Blob([pdf], { type: 'application/pdf' }), `${name}.pdf`)

  const res = await fetch(ENDPOINT, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form })
  const j = (await res.json()) as GqlResult<{ createDocument: CriarDocResult }>
  if (j.errors?.length) throw new Error('Autentique: ' + j.errors.map((e) => e.message).join('; '))
  if (!j.data?.createDocument) throw new Error('Autentique: createDocument falhou (HTTP ' + res.status + ')')
  return j.data.createDocument
}

/** Remove um documento na Autentique. */
export async function removerDocumento(token: string, id: string): Promise<boolean> {
  const d = await gql<{ deleteDocument: boolean }>(token, `mutation($id: UUID!) { deleteDocument(id: $id) }`, { id })
  return !!d.deleteDocument
}

/** Reenvia o convite de assinatura para signatários pendentes. */
export async function reenviarAssinaturas(token: string, publicIds: string[]): Promise<boolean> {
  if (!publicIds.length) return false
  const d = await gql<{ resendSignatures: boolean }>(token, `mutation($public_ids: [String!]!) { resendSignatures(public_ids: $public_ids) }`, { public_ids: publicIds })
  return !!d.resendSignatures
}

export interface DocStatus {
  id: string
  files?: { signed: string | null; original: string | null } | null
  signatures: Array<{
    public_id: string; name: string | null; email: string | null
    link: { short_link: string | null } | null
    viewed: { created_at: string } | null
    signed: { created_at: string } | null
    rejected: { created_at: string } | null
  }>
}

/** Consulta o status de um documento (status + link de assinatura + link do PDF assinado). */
export async function consultarDocumento(token: string, id: string): Promise<DocStatus> {
  const query = `query($id: UUID!) { document(id: $id) {
    id name files { signed original }
    signatures { public_id name email link { short_link } viewed { created_at } signed { created_at } rejected { created_at } }
  } }`
  const d = await gql<{ document: DocStatus }>(token, query, { id })
  return d.document
}
