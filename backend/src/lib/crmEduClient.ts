// src/lib/crmEduClient.ts
//
// Cliente HTTP do CRM Educacional (Wakeme). Resolve credenciais do banco
// (Setting grp='crmedu') com fallback pra env e cuida do ciclo de token.
//
// Onde está salvo (Configurações > Integrações > CRM Educacional):
//   - Setting `crmedu.base_url`  (ex: "https://unialfa.crmeducacional.com.br")
//   - Setting `crmedu.username`  (usuário de integração)
//   - Setting `crmedu.password`
//   - Setting `crmedu.enabled`   ("true"/"false")
//   - .env (fallback/dev): CRMEDU_BASE_URL / CRMEDU_USER / CRMEDU_PASS
//
// ARMADILHAS desta API, todas confirmadas contra a base real da unialfa:
//
//  1. A URL NÃO segue a documentação. A doc mostra "XXXapi.crmeducacional.com",
//     mas a instância real é "<cliente>.crmeducacional.com.br" — .com.br e sem
//     o sufixo "api". Pior: "*api.crmeducacional.com" é DNS curinga e responde
//     "Falha ao autenticar" para QUALQUER prefixo, então um host que responde
//     não prova que o prefixo existe. Sempre usar a URL que o cliente acessa.
//
//  2. O IIS exige Content-Length em POST. BuscarLeadsSemInscricao manda tudo na
//     query string e o corpo é vazio; sem 'Content-Length: 0' explícito o fetch
//     do Node fica pendurado até o timeout (não dá erro claro).
//
//  3. O header é 'Authorization: bearer'. O par access_token + token_type que a
//     documentação mostra devolve 401.
//
//  4. O refresh token ROTACIONA e morre. Quando o refresh falha, refazemos o
//     login por senha (self-healing) — mesmo padrão do ads-raptor, que roda
//     essa integração em produção há meses.
//
//  5. HTTP 200 não significa sucesso: em erro de negócio a API devolve 200 com
//     {"Status":"Falha"} no corpo.

import { prisma } from './prisma.js'

const SETTINGS_TTL_MS = 60_000
const MIN_INTERVAL_MS = 1_300 // teto documentado: 50 req/min por usuário
const MAX_RETRIES = 3

export interface CrmEduConfig {
  baseUrl: string | null
  username: string | null
  password: string | null
  enabled: boolean
}

/** Erro de autenticação (401/403) — credencial inválida ou sem permissão. */
export class CrmEduAuthError extends Error {
  constructor(message = 'Credenciais do CRM Educacional inválidas ou sem permissão') {
    super(message)
    this.name = 'CrmEduAuthError'
  }
}

let cfgCache: { value: CrmEduConfig; expiresAt: number } | null = null
let tokenCache: { accessToken: string; refreshToken: string | null; expiresAt: number } | null = null
let lastCallAt = 0

function unwrap(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const raw = typeof value === 'string' ? value : String(value)
  const trimmed = raw.replace(/^"|"$/g, '').trim()
  return trimmed || null
}

export async function getCrmEduConfig(force = false): Promise<CrmEduConfig> {
  if (!force && cfgCache && cfgCache.expiresAt > Date.now()) return cfgCache.value
  const rows = await prisma.setting.findMany({ where: { key: { startsWith: 'crmedu.' } } })
  const map = new Map(rows.map((r) => [r.key, r.value]))
  const value: CrmEduConfig = {
    baseUrl: (unwrap(map.get('crmedu.base_url')) ?? process.env.CRMEDU_BASE_URL ?? null)?.replace(/\/+$/, '') ?? null,
    username: unwrap(map.get('crmedu.username')) ?? process.env.CRMEDU_USER ?? null,
    password: unwrap(map.get('crmedu.password')) ?? process.env.CRMEDU_PASS ?? null,
    enabled: (unwrap(map.get('crmedu.enabled')) ?? 'false').toLowerCase() === 'true',
  }
  cfgCache = { value, expiresAt: Date.now() + SETTINGS_TTL_MS }
  return value
}

/** Zera os caches — chamar depois de salvar a configuração pela UI. */
export function resetCrmEduCache(): void {
  cfgCache = null
  tokenCache = null
}

async function espacar(): Promise<void> {
  const delta = Date.now() - lastCallAt
  if (delta < MIN_INTERVAL_MS) await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - delta))
  lastCallAt = Date.now()
}

interface TokenResposta {
  access_token: string
  refresh_token?: string
  expires_in?: number
}

async function pedirToken(cfg: CrmEduConfig, body: Record<string, string>): Promise<TokenResposta> {
  const r = await fetch(`${cfg.baseUrl}/api/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(30_000),
  })
  const txt = await r.text()
  let json: any = null
  try { json = JSON.parse(txt) } catch { /* resposta não-JSON */ }
  if (!r.ok || !json?.access_token) {
    throw new CrmEduAuthError(`token HTTP ${r.status}: ${txt.slice(0, 200)}`)
  }
  return json as TokenResposta
}

/**
 * Token válido, renovando quando necessário. Tenta o refresh_token primeiro e,
 * se ele tiver rotacionado/morrido, refaz o login por senha.
 */
export async function getAccessToken(force = false): Promise<string> {
  const cfg = await getCrmEduConfig()
  if (!cfg.baseUrl || !cfg.username || !cfg.password) {
    throw new CrmEduAuthError('CRM Educacional não configurado (base_url, username e password)')
  }
  // 60s de folga para não usar um token que expira no meio da chamada
  if (!force && tokenCache && tokenCache.expiresAt - 60_000 > Date.now()) return tokenCache.accessToken

  if (!force && tokenCache?.refreshToken) {
    try {
      const t = await pedirToken(cfg, { grant_type: 'refresh_token', refresh_token: tokenCache.refreshToken })
      tokenCache = {
        accessToken: t.access_token,
        refreshToken: t.refresh_token ?? tokenCache.refreshToken,
        expiresAt: Date.now() + (t.expires_in ?? 3600) * 1000,
      }
      return tokenCache.accessToken
    } catch {
      // refresh morto → cai no login por senha abaixo
    }
  }

  const t = await pedirToken(cfg, {
    grant_type: 'password',
    username: cfg.username,
    password: cfg.password,
    authentication_type: 'APICRMEducacional',
  })
  tokenCache = {
    accessToken: t.access_token,
    refreshToken: t.refresh_token ?? null,
    expiresAt: Date.now() + (t.expires_in ?? 86400) * 1000,
  }
  return tokenCache.accessToken
}

/**
 * POST autenticado com retry/backoff. `corpoVazio` manda 'Content-Length: 0'
 * (obrigatório no IIS quando não há body — ver armadilha 2 no topo).
 */
export async function crmEduPost<T = unknown>(
  caminho: string,
  opts: { body?: unknown; timeoutMs?: number } = {},
): Promise<T> {
  const cfg = await getCrmEduConfig()
  if (!cfg.baseUrl) throw new CrmEduAuthError('CRM Educacional sem base_url configurada')
  const temCorpo = opts.body !== undefined

  let ultimoErro: Error | null = null
  for (let tentativa = 0; tentativa <= MAX_RETRIES; tentativa++) {
    await espacar()
    const token = await getAccessToken(tentativa > 0 && ultimoErro instanceof CrmEduAuthError)
    const headers: Record<string, string> = { Authorization: `bearer ${token}` }
    if (temCorpo) headers['Content-Type'] = 'application/json'
    else headers['Content-Length'] = '0'

    try {
      const r = await fetch(`${cfg.baseUrl}${caminho}`, {
        method: 'POST',
        headers,
        ...(temCorpo ? { body: JSON.stringify(opts.body) } : {}),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 240_000),
      })

      if (r.status === 401 || r.status === 403) {
        ultimoErro = new CrmEduAuthError(`HTTP ${r.status} em ${caminho}`)
        tokenCache = null
        continue // renova o token e tenta de novo
      }
      if (r.status === 429 || r.status >= 500) {
        ultimoErro = new Error(`HTTP ${r.status} em ${caminho}`)
        await new Promise((res) => setTimeout(res, 2_000 * (tentativa + 1)))
        continue
      }
      const txt = await r.text()
      if (!r.ok) throw new Error(`HTTP ${r.status} em ${caminho}: ${txt.slice(0, 200)}`)
      if (!txt) return null as T
      return JSON.parse(txt) as T
    } catch (e: any) {
      if (e instanceof CrmEduAuthError) throw e
      ultimoErro = e
      // timeout/rede: espera e tenta de novo
      await new Promise((res) => setTimeout(res, 2_000 * (tentativa + 1)))
    }
  }
  throw ultimoErro ?? new Error(`Falha em ${caminho}`)
}

/** Lead cru como o CRM devolve (só os campos que consumimos; são ~130 no total). */
export interface CrmEduLead {
  Id: string
  Nome: string | null
  SobreNome: string | null
  NomeCompleto: string | null
  Email: string | null
  TelefoneCelular: string | null
  TelefoneComercial: string | null
  CPF: string | null
  DataNascimento: string | null
  SituacaoFunil: number | null
  DataCriacao: string | null
  DataModificacao: string | null
  CampaignSource: string | null
  CampaignName: string | null
  CampaignMedium: string | null
  CampaignContent: string | null
  CampaignTerm: string | null
  OrigemClientePotencial: number | null
  EnderecoCidade: string | null
  EnderecoEstado: string | null
  [k: string]: unknown
}

/** Soma dias a uma data AAAA-MM-DD, devolvendo no mesmo formato. */
function somarDias(data: string, dias: number): string {
  const d = new Date(`${data}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

/**
 * Leads sem inscrição criados na janela [de, ate] — INCLUSIVA nos dois lados,
 * datas AAAA-MM-DD.
 *
 * ⚠ `dataFinal` da API é EXCLUSIVA: o filtro dela é
 * `criação >= dataInicial AND criação < dataFinal`, no fuso local (-03).
 * Comprovado contra a base da unialfa: `27→28` devolve só o dia 27, `27→27`
 * devolve vazio. Por isso somamos 1 dia aqui — quem chama raciocina com um
 * intervalo fechado e não precisa saber disso. Sem esse ajuste, janelas
 * contíguas (…22–28, 29–…) perdem silenciosamente o último dia de cada uma.
 *
 * Outros dois limites que moldam a sincronização:
 *  - o endpoint só devolve leads com SituacaoFunil "Potencial"; quem virou
 *    inscrito/matriculado NÃO é acessível por API e simplesmente some da lista;
 *  - não há paginação: a janela é a única alavanca. Medido na unialfa —
 *    30 dias ≈ 3.871 leads / 14 MB / 23 s; 90 dias ≈ 16.431 / 61 MB / 114 s;
 *    1 ano estoura o timeout. Daí o fatiamento em janelas curtas.
 *
 * Quando não há leads no período a API devolve `null` (e não lista vazia).
 */
export async function buscarLeadsSemInscricao(de: string, ate: string): Promise<CrmEduLead[]> {
  const fimExclusivo = somarDias(ate, 1)
  const r = await crmEduPost<CrmEduLead[] | null>(
    `/api/BuscarLeadsSemInscricao?dataInicial=${de}&dataFinal=${fimExclusivo}`,
  )
  return Array.isArray(r) ? r : []
}
