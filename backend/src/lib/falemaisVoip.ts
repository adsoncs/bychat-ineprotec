// src/lib/falemaisVoip.ts
//
// Cliente da integração VoIP FaleMaisVoip (PABX Virtual). São DUAS APIs distintas,
// com hosts e autenticações diferentes — esta lib encapsula ambas:
//
//   API A — Sigma REST (telefonia / click-to-call)
//     base default: https://app.falemaisvoip.com.br/api/seg
//     token público: GET v1/token/{user}/{password} → hex de 41 chars
//     GET|POST v1/dial/{token}/{ext}/{phone}            → { status:"ok", id }
//     GET|POST v1/dialcallerid/{token}/{ext}/{phone}/{callerid}
//     GET|POST v1/queue/{token}/{accountcode}/{queue}/{phone}
//     GET v1/audio/{token}/{id}/info                    → JSON CDR (campo `gravacao` = URL do wav)
//     GET /api/v1/download/{id}.wav                      → wav (host base, FORA do /api/seg)
//       OBS: v1/audio/{id}/get devolve 200 com corpo VAZIO — não usar p/ baixar.
//     Não há webhook de status → polling em audio/{id}/info.
//
//   API B — Gravações PabxVirtual (histórico + download em massa)
//     base default: https://apigravacoes.falemaisvoip.com.br
//     POST /api/login {email,password} → token (header `token` nas demais)
//     GET /api/ligacoes (body {data_inicial,data_final,exportar})  ≤10 dias
//     GET /api/download/{token}/{uniqueid}                          gravação individual
//     GET /api/downloadMassa (body {data_inicial,data_final})       ≤30 dias, async + callback
//     GET|POST|PUT /api/callback                                    URL de notificação do zip
//
// Settings (UI → VoIP → Conexão). Segredos criptografados em repouso via encryptToken.
// Padrão de cache espelha lib/phoneIdentity.ts (TTL 60s). Após salvar pela rota de
// settings, chamar clearVoipCache().

import { request as httpsRequest } from 'node:https'
import { request as httpRequest } from 'node:http'
import { prisma } from './prisma.js'
import { decryptToken } from '../services/cloudApi.js'

const DEFAULT_SIGMA_BASE = 'https://app.falemaisvoip.com.br/api/seg'
const DEFAULT_GRAVACOES_BASE = 'https://apigravacoes.falemaisvoip.com.br'

export interface VoipConfig {
  enabled: boolean
  sigmaBaseUrl: string
  sigmaUser: string
  sigmaPassword: string
  sigmaToken: string
  sigmaAccountCode: string
  sigmaDefaultCallerId: string
  gravacoesBaseUrl: string
  gravacoesEmail: string
  gravacoesPassword: string
  gravacoesInsecureTLS: boolean
  recordingsAutoSync: boolean
  recordingsSyncIntervalMin: number
}

const DEFAULT_CONFIG: VoipConfig = {
  enabled: false,
  sigmaBaseUrl: DEFAULT_SIGMA_BASE,
  sigmaUser: '',
  sigmaPassword: '',
  sigmaToken: '',
  sigmaAccountCode: '',
  sigmaDefaultCallerId: '',
  gravacoesBaseUrl: DEFAULT_GRAVACOES_BASE,
  gravacoesEmail: '',
  gravacoesPassword: '',
  gravacoesInsecureTLS: false,
  recordingsAutoSync: false,
  recordingsSyncIntervalMin: 60,
}

export const VOIP_SETTING_KEYS = [
  'voip.enabled',
  'voip.sigma.base_url',
  'voip.sigma.user',
  'voip.sigma.password',
  'voip.sigma.token',
  'voip.sigma.account_code',
  'voip.sigma.default_caller_id',
  'voip.gravacoes.base_url',
  'voip.gravacoes.email',
  'voip.gravacoes.password',
  'voip.gravacoes.insecure_tls',
  'voip.recordings.auto_sync',
  'voip.recordings.sync_interval_min',
] as const

// ─── helpers de leitura do valor Json do Setting ────────────
function unwrap(raw: unknown): string {
  if (raw === null || raw === undefined) return ''
  if (typeof raw === 'string') return raw.replace(/^"|"$/g, '').trim()
  if (typeof raw === 'boolean') return raw ? 'true' : 'false'
  if (typeof raw === 'number') return String(raw)
  return ''
}
function asBool(raw: unknown): boolean {
  const s = unwrap(raw).toLowerCase()
  return s === 'true' || s === '1' || s === 'yes'
}
function asInt(raw: unknown, fallback: number): number {
  const n = parseInt(unwrap(raw), 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}
function decryptSafe(cipher: string): string {
  if (!cipher) return ''
  try { return decryptToken(cipher) } catch { return '' }
}
function trimSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

// Normaliza telefone para apenas dígitos (FaleMaisVoip aceita 8-11 dígitos).
export function normalizePhone(phone: string): string {
  return (phone || '').replace(/\D/g, '')
}

// ─── config (cache 60s) ─────────────────────────────────────
const TTL_MS = 60_000
let cache: { value: VoipConfig; expiresAt: number } | null = null

export async function getVoipConfig(): Promise<VoipConfig> {
  const now = Date.now()
  if (cache && cache.expiresAt > now) return cache.value
  try {
    const rows = await prisma.setting.findMany({ where: { key: { in: [...VOIP_SETTING_KEYS] } } })
    const byKey = new Map(rows.map((r) => [r.key, r.value]))
    const value: VoipConfig = {
      enabled: asBool(byKey.get('voip.enabled')),
      sigmaBaseUrl: trimSlash(unwrap(byKey.get('voip.sigma.base_url')) || DEFAULT_SIGMA_BASE),
      sigmaUser: unwrap(byKey.get('voip.sigma.user')),
      sigmaPassword: decryptSafe(unwrap(byKey.get('voip.sigma.password'))),
      sigmaToken: decryptSafe(unwrap(byKey.get('voip.sigma.token'))),
      sigmaAccountCode: unwrap(byKey.get('voip.sigma.account_code')),
      sigmaDefaultCallerId: unwrap(byKey.get('voip.sigma.default_caller_id')),
      gravacoesBaseUrl: trimSlash(unwrap(byKey.get('voip.gravacoes.base_url')) || DEFAULT_GRAVACOES_BASE),
      gravacoesEmail: unwrap(byKey.get('voip.gravacoes.email')),
      gravacoesPassword: decryptSafe(unwrap(byKey.get('voip.gravacoes.password'))),
      gravacoesInsecureTLS: asBool(byKey.get('voip.gravacoes.insecure_tls')),
      recordingsAutoSync: asBool(byKey.get('voip.recordings.auto_sync')),
      recordingsSyncIntervalMin: asInt(byKey.get('voip.recordings.sync_interval_min'), 60),
    }
    cache = { value, expiresAt: now + TTL_MS }
    return value
  } catch {
    return DEFAULT_CONFIG
  }
}

export function clearVoipCache(): void {
  cache = null
  sigmaTokenCache = null
  gravacoesTokenCache = null
}

// ─── HTTP de baixo nível ────────────────────────────────────
// fetch (undici) NÃO permite body em GET. A API de Gravações documenta GET com
// body JSON, então usamos node:http(s) para esses casos. Para a Sigma (params na
// URL, sem body) o fetch padrão basta.

interface RawResponse { status: number; text: string; buffer: Buffer }

function rawRequest(
  method: string,
  url: string,
  opts: { headers?: Record<string, string>; body?: string; insecureTLS?: boolean } = {},
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const isHttps = u.protocol === 'https:'
    const fn = isHttps ? httpsRequest : httpRequest
    const headers: Record<string, string> = { Accept: 'application/json', ...(opts.headers || {}) }
    if (opts.body) {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json'
      headers['Content-Length'] = String(Buffer.byteLength(opts.body))
    }
    const req = fn(
      {
        method,
        hostname: u.hostname,
        port: u.port || (isHttps ? 443 : 80),
        path: u.pathname + u.search,
        headers,
        timeout: 20_000,
        // Bypass de validação TLS (opt-in, escopado): usado só nas Gravações,
        // cujo cert da FaleMaisVoip está vencido. Inseguro (sem checagem de cert).
        ...(opts.insecureTLS && isHttps ? { rejectUnauthorized: false } : {}),
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c as Buffer))
        res.on('end', () => {
          const buffer = Buffer.concat(chunks)
          resolve({ status: res.statusCode || 0, text: buffer.toString('utf8'), buffer })
        })
      },
    )
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('VoIP request timeout')))
    if (opts.body) req.write(opts.body)
    req.end()
  })
}

function parseJsonSafe(text: string): any {
  try { return JSON.parse(text) } catch { return null }
}

// ════════════════════════════════════════════════════════════
// API A — Sigma REST (click-to-call)
// ════════════════════════════════════════════════════════════

let sigmaTokenCache: { token: string; expiresAt: number } | null = null
const SIGMA_TOKEN_TTL_MS = 10 * 60_000 // re-gera a cada 10 min

export interface DialResult { ok: boolean; id?: string; status?: string; cause?: string }
export interface AudioInfo {
  status: string
  src?: string
  dst?: string
  duration?: string
  calldate?: string
  gravacao?: string
  raw?: any
}

async function sigmaGet(cfg: VoipConfig, path: string): Promise<RawResponse> {
  return rawRequest('GET', `${cfg.sigmaBaseUrl}/${path}`)
}

export async function sigmaStatus(cfg?: VoipConfig): Promise<{ ok: boolean; info?: any; error?: string }> {
  const c = cfg || (await getVoipConfig())
  try {
    const res = await sigmaGet(c, 'v1/status')
    const json = parseJsonSafe(res.text)
    if (res.status >= 200 && res.status < 300 && json?.status === 'ok') return { ok: true, info: json.info }
    return { ok: false, error: json?.status || `HTTP ${res.status}` }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'erro de rede' }
  }
}

export async function getSigmaToken(cfg?: VoipConfig, force = false): Promise<string> {
  const c = cfg || (await getVoipConfig())
  // Token estático fornecido pela FaleMaisVoip — usa direto e dispensa o
  // exchange user/senha (v1/token/...). Tem precedência quando preenchido.
  if (c.sigmaToken) return c.sigmaToken
  const now = Date.now()
  if (!force && sigmaTokenCache && sigmaTokenCache.expiresAt > now) return sigmaTokenCache.token
  if (!c.sigmaUser || !c.sigmaPassword) throw new Error('Credenciais Sigma (usuário/senha ou token) não configuradas')
  const res = await sigmaGet(c, `v1/token/${encodeURIComponent(c.sigmaUser)}/${encodeURIComponent(c.sigmaPassword)}`)
  const json = parseJsonSafe(res.text)
  const token = json?.token
  if (!token || json?.status !== 'ok') throw new Error('Falha ao autenticar na Sigma (token não autorizado)')
  sigmaTokenCache = { token, expiresAt: now + SIGMA_TOKEN_TTL_MS }
  return token
}

function parseDial(res: RawResponse): DialResult {
  const json = parseJsonSafe(res.text)
  if (json?.status === 'ok' && json?.id) return { ok: true, id: json.id, status: 'ok' }
  return { ok: false, status: json?.status, cause: json?.cause || `HTTP ${res.status}` }
}

export async function dial(extension: string, phone: string, cfg?: VoipConfig): Promise<DialResult> {
  const c = cfg || (await getVoipConfig())
  const token = await getSigmaToken(c)
  const ph = normalizePhone(phone)
  const res = await sigmaGet(c, `v1/dial/${token}/${encodeURIComponent(extension)}/${encodeURIComponent(ph)}`)
  return parseDial(res)
}

export async function dialCallerId(extension: string, phone: string, callerId: string, cfg?: VoipConfig): Promise<DialResult> {
  const c = cfg || (await getVoipConfig())
  const token = await getSigmaToken(c)
  const ph = normalizePhone(phone)
  const cid = normalizePhone(callerId)
  const res = await sigmaGet(c, `v1/dialcallerid/${token}/${encodeURIComponent(extension)}/${encodeURIComponent(ph)}/${encodeURIComponent(cid)}`)
  return parseDial(res)
}

export async function queueDial(accountcode: string, queue: string, phone: string, cfg?: VoipConfig): Promise<DialResult> {
  const c = cfg || (await getVoipConfig())
  const token = await getSigmaToken(c)
  const ph = normalizePhone(phone)
  const res = await sigmaGet(c, `v1/queue/${token}/${encodeURIComponent(accountcode)}/${encodeURIComponent(queue)}/${encodeURIComponent(ph)}`)
  return parseDial(res)
}

// Recupera o status/CDR de uma chamada (modo info). Retorna null se ainda não há
// áudio/CDR (chamada em curso) ou em caso de erro.
export async function getAudioInfo(id: string, cfg?: VoipConfig): Promise<AudioInfo | null> {
  const c = cfg || (await getVoipConfig())
  const token = await getSigmaToken(c)
  const res = await sigmaGet(c, `v1/audio/${token}/${encodeURIComponent(id)}/info`)
  const json = parseJsonSafe(res.text)
  if (!json || !json.status) return null
  // erro vem como { status: "Audio não encontrado - clid: ..." }
  if (/não encontrado|nao encontrado|not found/i.test(String(json.status))) return null
  return { status: json.status, src: json.src, dst: json.dst, duration: json.duration, calldate: json.calldate, gravacao: json.gravacao, raw: json }
}

// Baixa o WAV da gravação. O endpoint correto é {host}/api/v1/download/{id}.wav
// (host derivado do sigmaBaseUrl, ex.: https://app.falemaisvoip.com.br) — e NÃO o
// v1/audio/{token}/{id}/get da Sigma, que responde HTTP 200 com corpo VAZIO.
// O CDR (audio/info) já entrega essa URL pronta no campo `gravacao`: passe-a direto.
// Na falta dela, passe o providerCallId (id do dial) que a URL canônica é montada —
// o nome do arquivo é o próprio id da chamada (ex.: 8c687e1c…af4.wav).
// Retorna null quando não disponível ainda (200 vazio) ou em erro (corpo JSON).
export async function downloadRecording(recordingUrlOrId: string, cfg?: VoipConfig): Promise<Buffer | null> {
  const c = cfg || (await getVoipConfig())
  let url = recordingUrlOrId
  if (!/^https?:\/\//i.test(recordingUrlOrId)) {
    const origin = new URL(c.sigmaBaseUrl).origin
    url = `${origin}/api/v1/download/${encodeURIComponent(recordingUrlOrId)}.wav`
  }
  const res = await rawRequest('GET', url)
  if (res.status < 200 || res.status >= 300) return null
  if (!res.buffer.length) return null // 200 vazio = gravação ainda não disponível
  if (res.buffer.slice(0, 1).toString() === '{') return null // JSON = erro/status
  return res.buffer
}

// ════════════════════════════════════════════════════════════
// API B — Gravações PabxVirtual (histórico + massa)
// ════════════════════════════════════════════════════════════

let gravacoesTokenCache: { token: string; expiresAt: number } | null = null
const GRAVACOES_TOKEN_TTL_MS = 30 * 60_000

export interface LigacaoCDR {
  uniqueid?: string
  src?: string
  dst?: string
  duration?: string | number
  calldate?: string
  disposition?: string
  [k: string]: unknown
}

export async function gravacoesLogin(cfg?: VoipConfig, force = false): Promise<string> {
  const c = cfg || (await getVoipConfig())
  const now = Date.now()
  if (!force && gravacoesTokenCache && gravacoesTokenCache.expiresAt > now) return gravacoesTokenCache.token
  if (!c.gravacoesEmail || !c.gravacoesPassword) throw new Error('Credenciais de Gravações (email/senha) não configuradas')
  const res = await rawRequest('POST', `${c.gravacoesBaseUrl}/api/login`, {
    body: JSON.stringify({ email: c.gravacoesEmail, password: c.gravacoesPassword }),
    insecureTLS: c.gravacoesInsecureTLS,
  })
  const json = parseJsonSafe(res.text)
  const token = json?.token || json?.data?.token
  if (!token) throw new Error('Falha ao autenticar na API de Gravações')
  gravacoesTokenCache = { token, expiresAt: now + GRAVACOES_TOKEN_TTL_MS }
  return token
}

// Lista chamadas (CDR) de um período (máx 10 dias). A API documenta GET com body
// JSON; alguns backends PHP também aceitam query string — enviamos os dois.
export async function listLigacoes(dataInicial: string, dataFinal: string, cfg?: VoipConfig): Promise<LigacaoCDR[]> {
  const c = cfg || (await getVoipConfig())
  const token = await gravacoesLogin(c)
  const qs = `?data_inicial=${encodeURIComponent(dataInicial)}&data_final=${encodeURIComponent(dataFinal)}`
  const res = await rawRequest('GET', `${c.gravacoesBaseUrl}/api/ligacoes${qs}`, {
    headers: { token },
    body: JSON.stringify({ data_inicial: dataInicial, data_final: dataFinal }),
    insecureTLS: c.gravacoesInsecureTLS,
  })
  const json = parseJsonSafe(res.text)
  if (Array.isArray(json)) return json as LigacaoCDR[]
  if (Array.isArray(json?.data)) return json.data as LigacaoCDR[]
  if (Array.isArray(json?.ligacoes)) return json.ligacoes as LigacaoCDR[]
  return []
}

export async function downloadGravacao(uniqueid: string, cfg?: VoipConfig): Promise<Buffer | null> {
  const c = cfg || (await getVoipConfig())
  const token = await gravacoesLogin(c)
  const res = await rawRequest('GET', `${c.gravacoesBaseUrl}/api/download/${token}/${encodeURIComponent(uniqueid)}`, { insecureTLS: c.gravacoesInsecureTLS })
  if (res.status < 200 || res.status >= 300) return null
  if (res.buffer.slice(0, 1).toString() === '{') return null
  return res.buffer
}

// Solicita preparo do zip em massa (assíncrono). O sistema notifica a URL de
// callback quando estiver pronto. Retorna o nome/arquivo informado pela API.
export async function requestDownloadMassa(dataInicial: string, dataFinal: string, cfg?: VoipConfig): Promise<{ ok: boolean; file?: string; raw?: any }> {
  const c = cfg || (await getVoipConfig())
  const token = await gravacoesLogin(c)
  const res = await rawRequest('GET', `${c.gravacoesBaseUrl}/api/downloadMassa`, {
    headers: { token },
    body: JSON.stringify({ data_inicial: dataInicial, data_final: dataFinal }),
    insecureTLS: c.gravacoesInsecureTLS,
  })
  const json = parseJsonSafe(res.text)
  const file = json?.file || json?.arquivo || json?.zip
  return { ok: res.status >= 200 && res.status < 300, file, raw: json }
}

// Cadastra/atualiza a URL de callback que receberá a notificação do zip pronto.
export async function registerCallbackUrl(url: string, cfg?: VoipConfig): Promise<{ ok: boolean; raw?: any }> {
  const c = cfg || (await getVoipConfig())
  const token = await gravacoesLogin(c)
  const res = await rawRequest('POST', `${c.gravacoesBaseUrl}/api/callback`, {
    headers: { token },
    body: JSON.stringify({ url }),
    insecureTLS: c.gravacoesInsecureTLS,
  })
  return { ok: res.status >= 200 && res.status < 300, raw: parseJsonSafe(res.text) }
}

export async function gravacoesPing(cfg?: VoipConfig): Promise<{ ok: boolean; error?: string }> {
  try {
    await gravacoesLogin(cfg, true)
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'erro' }
  }
}
