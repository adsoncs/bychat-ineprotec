// src/services/clicksign.ts
// Integração com a Clicksign (assinatura eletrônica) — API v3 "Envelope".
// https://developers.clicksign.com · JSON:API (application/vnd.api+json)
// Auth: header Authorization com o access token da conta (sem "Bearer").
//
// Diferenças que moldam este arquivo, comparado com a Autentique:
// - Montagem em passos: envelope → documento (PDF base64) → signatários →
//   requisitos (quem assina o quê, e como se autentica) → ativar (status running).
// - A API NÃO devolve link de assinatura. A pessoa recebe o convite pela própria
//   Clicksign (e-mail/WhatsApp/SMS) ou assina no Widget Embedded dentro da nossa
//   página (incluso no sandbox; em produção é contratado à parte).
// - Polling é proibido pela Clicksign: status vem do webhook (HMAC-SHA256 no
//   header Content-Hmac) e só então consultamos a API para confirmar.
// - Links de download expiram em ~5 min: a via assinada é baixada e guardada no
//   sistema quando o envelope fecha (ver `baixarPdfAssinado`).

import crypto from 'crypto'
import { prisma } from '../lib/prisma.js'

export interface ClicksignConfig {
  token: string | null
  sandbox: boolean
  /** HMAC SHA256 Secret gerado pela Clicksign ao cadastrar o webhook. */
  webhookSecret: string | null
  /** Widget Embedded contratado: o aluno assina dentro do portal. */
  widget: boolean
}

async function getSetting(key: string): Promise<string | null> {
  const r = await prisma.setting.findUnique({ where: { key }, select: { value: true } })
  const v = r?.value as any
  return typeof v === 'string' ? v : (v == null ? null : String(v))
}

export async function getConfig(): Promise<ClicksignConfig> {
  const token = process.env.CLICKSIGN_ACCESS_TOKEN || (await getSetting('assinatura.clicksign.access_token')) || null
  return {
    token,
    // Padrão sandbox: documento de teste não tem validade jurídica nem custa nada.
    sandbox: (await getSetting('assinatura.clicksign.sandbox')) !== 'false',
    webhookSecret: process.env.CLICKSIGN_WEBHOOK_SECRET || (await getSetting('assinatura.clicksign.webhook_secret')) || null,
    widget: (process.env.CLICKSIGN_WIDGET ?? (await getSetting('assinatura.clicksign.widget'))) === 'true',
  }
}

export async function setConfig(p: { token?: string; sandbox?: boolean; webhookSecret?: string; widget?: boolean }): Promise<void> {
  const up = async (key: string, value: string, label: string, fieldType = 'text') =>
    prisma.setting.upsert({ where: { key }, update: { value: value as any }, create: { key, label, grp: 'academico', fieldType, value: value as any } })
  // Chaves terminadas em token/secret são cifradas pelo middleware do Prisma.
  if (p.token !== undefined) await up('assinatura.clicksign.access_token', p.token.trim(), 'Access token Clicksign', 'password')
  if (p.sandbox !== undefined) await up('assinatura.clicksign.sandbox', p.sandbox ? 'true' : 'false', 'Sandbox Clicksign', 'boolean')
  if (p.webhookSecret !== undefined) await up('assinatura.clicksign.webhook_secret', p.webhookSecret.trim(), 'HMAC secret do webhook Clicksign', 'password')
  if (p.widget !== undefined) await up('assinatura.clicksign.widget', p.widget ? 'true' : 'false', 'Widget Embedded Clicksign', 'boolean')
}

export function host(sandbox: boolean): string {
  return process.env.CLICKSIGN_API_URL?.replace(/\/$/, '') || (sandbox ? 'https://sandbox.clicksign.com' : 'https://app.clicksign.com')
}

/**
 * Header `Content-Hmac: sha256=<hex>` = HMAC-SHA256(secret, corpo cru).
 * 'sem_secret' = verificação desligada (aceita, mas o conteúdo nunca é confiado:
 * o status é sempre reconsultado na API).
 */
export async function verificarAssinaturaWebhook(rawBody: Buffer | string | undefined, header: string | undefined): Promise<'ok' | 'invalida' | 'sem_secret'> {
  const { webhookSecret } = await getConfig()
  if (!webhookSecret) return 'sem_secret'
  if (!rawBody || !header) return 'invalida'
  const recebido = String(header).trim().replace(/^sha256=/i, '')
  const calc = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex')
  const a = Buffer.from(calc, 'hex'); const b = Buffer.from(recebido, 'hex')
  if (a.length !== b.length) return 'invalida'
  return crypto.timingSafeEqual(a, b) ? 'ok' : 'invalida'
}

export class ClicksignError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}

async function api<T = any>(cfg: ClicksignConfig, metodo: 'GET' | 'POST' | 'PATCH' | 'DELETE', caminho: string, corpo?: unknown): Promise<T> {
  if (!cfg.token) throw new ClicksignError('Clicksign: access token não configurado', 0)
  const r = await fetch(`${host(cfg.sandbox)}/api/v3${caminho}`, {
    method: metodo,
    headers: { Authorization: cfg.token, Accept: 'application/vnd.api+json', ...(corpo !== undefined ? { 'Content-Type': 'application/vnd.api+json' } : {}) },
    ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
    signal: AbortSignal.timeout(30_000),
  })
  const texto = await r.text()
  let data: any = null
  try { data = texto ? JSON.parse(texto) : null } catch { data = null }
  if (!r.ok) {
    const erros: any[] = Array.isArray(data?.errors) ? data.errors : []
    const msg = erros.map((e) => e?.detail || e?.title).filter(Boolean).join('; ') || `HTTP ${r.status}`
    throw new ClicksignError(`Clicksign: ${msg}`, r.status)
  }
  return data as T
}

// ─────────────────────────── Tradução de vocabulário ───────────────────────────

/** Nossa ação → papel de qualificação da Clicksign. */
const PAPEL: Record<string, string> = { SIGN: 'sign', APPROVE: 'approve', RECOGNIZE: 'receipt', WITNESS: 'witness' }
/** Lembrete do template (vocabulário Autentique) → intervalo em dias da Clicksign. */
const LEMBRETE: Record<string, number> = { DAILY: 1, WEEKLY: 7 }

/** Telefone BR com 10–11 dígitos (sem 55), que é o que a Clicksign aceita. */
export function telefoneClicksign(t: string | null | undefined): string | null {
  let d = String(t || '').replace(/\D/g, '')
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2)
  return d.length === 10 || d.length === 11 ? d : null
}
export function cpfClicksign(c: string | null | undefined): string | null {
  const d = String(c || '').replace(/\D/g, '')
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : null
}
/** A Clicksign exige ao menos duas palavras no nome. */
function nomeClicksign(n: string): string {
  const s = String(n || '').trim().replace(/\s+/g, ' ')
  return s.includes(' ') ? s : `${s || 'Signatário'} (assinante)`
}

export interface CriarSigner {
  nome: string; email?: string | null; telefone?: string | null; cpf?: string | null
  acao: string; delivery: string; exigeCpf: boolean; exigeSelfie: boolean
}
export interface CriarOpcoes { mensagem?: string | null; lembrete?: string | null; ordenado?: boolean; recusavel?: boolean; prazo?: string | null }
export interface CriarResultado { envelopeId: string; documentoId: string; signatarios: string[] }

/**
 * Canal do convite. LINK só existe com o Widget (o aluno assina na nossa página,
 * sem convite); sem widget, quem chama precisa ter escolhido e-mail/WhatsApp/SMS.
 */
function canalDoConvite(s: CriarSigner): 'email' | 'whatsapp' | 'sms' | 'none' {
  if (s.delivery === 'WHATSAPP') return 'whatsapp'
  if (s.delivery === 'SMS') return 'sms'
  if (s.delivery === 'LINK') return 'none'
  return 'email'
}
/** Token de autenticação pelo canal que a pessoa de fato tem. */
function canalDoToken(s: CriarSigner): 'email' | 'whatsapp' | 'sms' {
  if (s.delivery === 'WHATSAPP' && telefoneClicksign(s.telefone)) return 'whatsapp'
  if (s.delivery === 'SMS' && telefoneClicksign(s.telefone)) return 'sms'
  if (s.email) return 'email'
  return telefoneClicksign(s.telefone) ? 'whatsapp' : 'email'
}

/**
 * Cria o envelope completo e ativa. Devolve os ids dos signatários NA MESMA
 * ORDEM em que foram passados — o chamador associa por posição, sem casar por
 * e-mail/nome. Se algum passo falhar depois de criado, o rascunho é apagado
 * para não sobrar envelope pela metade na conta do cliente.
 */
export async function criarEnvelope(cfg: ClicksignConfig, titulo: string, pdf: Buffer, signers: CriarSigner[], op: CriarOpcoes = {}): Promise<CriarResultado> {
  const lembrete = op.lembrete ? LEMBRETE[op.lembrete] ?? null : null
  const env = await api(cfg, 'POST', '/envelopes', { data: { type: 'envelopes', attributes: {
    name: titulo.slice(0, 255), locale: 'pt-BR', auto_close: true, block_after_refusal: !!op.recusavel,
    remind_interval: lembrete,
    ...(op.prazo ? { deadline_at: op.prazo } : {}),
    ...(op.mensagem ? { default_message: op.mensagem.slice(0, 2000) } : {}),
  } } })
  const envelopeId: string = env?.data?.id
  if (!envelopeId) throw new ClicksignError('Clicksign: envelope sem id na resposta', 0)
  try {
    const nomeArq = `${titulo.replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 80) || 'contrato'}.pdf`
    const doc = await api(cfg, 'POST', `/envelopes/${envelopeId}/documents`, { data: { type: 'documents', attributes: {
      filename: nomeArq, content_base64: `data:application/pdf;base64,${pdf.toString('base64')}`,
    } } })
    const documentoId: string = doc?.data?.id
    if (!documentoId) throw new ClicksignError('Clicksign: documento sem id na resposta', 0)

    const ids: string[] = []
    for (const [i, s] of signers.entries()) {
      const tel = telefoneClicksign(s.telefone)
      const cpf = cpfClicksign(s.cpf)
      const canal = canalDoConvite(s)
      const sg = await api(cfg, 'POST', `/envelopes/${envelopeId}/signers`, { data: { type: 'signers', attributes: {
        name: nomeClicksign(s.nome),
        ...(s.email ? { email: s.email } : {}),
        ...(tel ? { phone_number: tel } : {}),
        has_documentation: !!s.exigeCpf,
        ...(s.exigeCpf && cpf ? { documentation: cpf } : {}),
        refusable: !!op.recusavel,
        group: op.ordenado ? i + 1 : 1,
        communicate_events: {
          signature_request: canal,
          signature_reminder: s.email && lembrete ? 'email' : 'none',
          document_signed: !s.email && tel ? 'whatsapp' : 'email',
        },
      } } })
      const sid: string = sg?.data?.id
      if (!sid) throw new ClicksignError('Clicksign: signatário sem id na resposta', 0)
      ids.push(sid)
      const rel = { document: { data: { type: 'documents', id: documentoId } }, signer: { data: { type: 'signers', id: sid } } }
      await api(cfg, 'POST', `/envelopes/${envelopeId}/requirements`, { data: { type: 'requirements',
        attributes: { action: 'agree', role: PAPEL[s.acao] || 'sign' }, relationships: rel } })
      await api(cfg, 'POST', `/envelopes/${envelopeId}/requirements`, { data: { type: 'requirements',
        attributes: { action: 'provide_evidence', auth: canalDoToken(s) }, relationships: rel } })
      if (s.exigeSelfie) {
        await api(cfg, 'POST', `/envelopes/${envelopeId}/requirements`, { data: { type: 'requirements',
          attributes: { action: 'provide_evidence', auth: 'selfie' }, relationships: rel } })
      }
    }
    await api(cfg, 'PATCH', `/envelopes/${envelopeId}`, { data: { id: envelopeId, type: 'envelopes', attributes: { status: 'running' } } })
    return { envelopeId, documentoId, signatarios: ids }
  } catch (e) {
    await api(cfg, 'DELETE', `/envelopes/${envelopeId}`).catch(() => {})
    throw e
  }
}

export interface SituacaoSignatario { id: string | null; email: string | null; telefone: string | null; status: 'ASSINADO' | 'REJEITADO'; em: Date | null }
export interface Situacao {
  envelope: string | null // draft | running | canceled | closed
  documento: string | null
  /** Só quem assinou ou recusou — os demais seguem pendentes. */
  signatarios: SituacaoSignatario[]
}

/**
 * Situação do envelope. A v3 não tem status por signatário: quem assinou e quem
 * recusou sai dos eventos do documento (`sign`, `refusal`).
 */
export async function consultar(cfg: ClicksignConfig, envelopeId: string, documentoId: string): Promise<Situacao> {
  const [env, doc, evs] = await Promise.all([
    api(cfg, 'GET', `/envelopes/${envelopeId}`),
    api(cfg, 'GET', `/envelopes/${envelopeId}/documents/${documentoId}`),
    api(cfg, 'GET', `/envelopes/${envelopeId}/documents/${documentoId}/events`),
  ])
  const signatarios: SituacaoSignatario[] = []
  for (const e of (Array.isArray(evs?.data) ? evs.data : [])) {
    const nome = e?.attributes?.name
    if (nome !== 'sign' && nome !== 'refusal') continue
    const s = e?.attributes?.data?.signer ?? {}
    signatarios.push({
      id: s.key ? String(s.key) : s.id ? String(s.id) : null,
      email: s.email ? String(s.email).toLowerCase() : null,
      telefone: telefoneClicksign(s.phone_number),
      status: nome === 'sign' ? 'ASSINADO' : 'REJEITADO',
      em: e?.attributes?.created ? new Date(e.attributes.created) : null,
    })
  }
  return { envelope: env?.data?.attributes?.status ?? null, documento: doc?.data?.attributes?.status ?? null, signatarios }
}

/** Via assinada (link temporário, ~5 min), baixada na hora. null se ainda não fechou. */
export async function baixarPdfAssinado(cfg: ClicksignConfig, envelopeId: string, documentoId: string): Promise<Buffer | null> {
  const doc = await api(cfg, 'GET', `/envelopes/${envelopeId}/documents/${documentoId}`)
  const url: string | undefined = doc?.data?.links?.files?.signed
  if (!url) return null
  const r = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!r.ok) return null
  return Buffer.from(await r.arrayBuffer())
}

/** Cancela um envelope em andamento (rascunho é apagado). */
export async function cancelar(cfg: ClicksignConfig, envelopeId: string): Promise<void> {
  try {
    await api(cfg, 'PATCH', `/envelopes/${envelopeId}`, { data: { id: envelopeId, type: 'envelopes', attributes: { status: 'canceled' } } })
  } catch (e) {
    if (e instanceof ClicksignError && (e.status === 422 || e.status === 400)) {
      await api(cfg, 'DELETE', `/envelopes/${envelopeId}`)
      return
    }
    throw e
  }
}

/** Reenvia o convite a quem ainda não assinou (a Clicksign pula quem já assinou). */
export async function reenviar(cfg: ClicksignConfig, envelopeId: string, mensagem?: string | null): Promise<void> {
  await api(cfg, 'POST', `/envelopes/${envelopeId}/notifications`, { data: { type: 'notifications', attributes: { ...(mensagem ? { message: mensagem } : {}) } } })
}

/** Teste de credencial: lista 1 envelope. */
export async function ping(cfg: ClicksignConfig): Promise<{ ok: boolean; message: string }> {
  try {
    await api(cfg, 'GET', '/envelopes?page[size]=1')
    return { ok: true, message: `Conectado à Clicksign (${cfg.sandbox ? 'sandbox' : 'produção'})` }
  } catch (e: any) {
    if (e instanceof ClicksignError && e.status === 401) return { ok: false, message: 'Token recusado pela Clicksign (401). Confira o token e o ambiente (sandbox × produção).' }
    return { ok: false, message: e?.message || 'Falha ao falar com a Clicksign' }
  }
}

/** Ids que o webhook traz: a chave do documento (e do envelope, se vier). */
export function idsDoWebhook(body: any): string[] {
  const ids = new Set<string>()
  const doc = body?.document ?? body?.data?.document
  for (const v of [doc?.key, doc?.id, body?.envelope?.id, body?.envelope?.key, body?.data?.envelope?.id]) if (v) ids.add(String(v))
  return [...ids]
}
