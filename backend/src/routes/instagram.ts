import type { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware, adminOnly } from '../lib/auth.js'
import { broadcastRealtimeEvent } from './realtime.js'
import { randomBytes, createHmac, timingSafeEqual } from 'crypto'
import { getMetaAppId, getMetaAppSecret, getMetaIgConfigId, META_GRAPH_URL } from '../lib/meta.js'
import {
  IG_BUSINESS_SCOPES,
  IG_GRAPH_URL,
  buildAuthorizeUrl,
  consumeOAuthState,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  fetchProfile,
  getInstagramAppId,
  getInstagramAppSecret,
  getInstagramRedirectUri,
  persistOAuthState,
  refreshLongLivedToken,
} from '../lib/instagramOAuth.js'

/**
 * Instagram Messaging integration (Meta Messenger Platform).
 *
 * IMPORTANTE: a Messenger Platform exige:
 *   1. App Meta com produto "Instagram messaging" habilitado
 *   2. App review com permissões `instagram_business_basic` +
 *      `instagram_business_manage_messages`
 *   3. Conta Instagram Business/Creator vinculada a uma Página do Facebook
 *   4. Page Access Token (não confundir com User Access Token)
 *
 * Esta implementação cobre o lado backend "depois do app review":
 *   - Salvar pageAccessToken + igUserId
 *   - Receber webhooks de DMs (Graph API v21.0)
 *   - Enviar resposta via /me/messages
 *
 * O OAuth/Embedded Signup do Instagram NÃO está implementado aqui (depende do
 * app review do cliente). Por enquanto o admin precisa colar o pageAccessToken
 * obtido manualmente no Graph API Explorer ou via reuse do token salvo no
 * Cloud API embedded signup (se a página estiver linkada).
 */

const META_GRAPH = 'https://graph.facebook.com/v21.0'
const SETTING_KEY = 'instagram.connection'
const SETTING_KEY_V2 = 'instagram.connection_v2'
const WEBHOOK_SECRET_KEY = 'instagram.webhook_secret'

/**
 * Conexão via Instagram Login API for Business (fluxo direto, sem Facebook).
 * Coexiste com o fluxo antigo (Facebook Login + Pages) em SETTING_KEY.
 */
interface InstagramBusinessConnection {
  flow: 'instagram_business_login'
  igUserId: string
  username: string
  name?: string
  accountType?: string
  profilePictureUrl?: string
  accessToken: string
  /** Unix ms — long-lived dura ~60d, renovado via refresh_access_token. */
  tokenExpiresAt: number
  tokenIssuedAt: number
  scopes: string[]
  active: boolean
  connectedAt: string
  connectedByUserId?: number
}

async function loadConnectionV2(): Promise<InstagramBusinessConnection | null> {
  const row = await prisma.setting.findUnique({ where: { key: SETTING_KEY_V2 } })
  if (!row) return null
  try {
    const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value
    return parsed as InstagramBusinessConnection
  } catch {
    return null
  }
}

async function saveConnectionV2(conn: InstagramBusinessConnection): Promise<void> {
  const value = JSON.stringify(conn)
  await prisma.setting.upsert({
    where: { key: SETTING_KEY_V2 },
    update: { value },
    create: {
      key: SETTING_KEY_V2,
      value,
      label: 'Instagram Business Login connection',
      grp: 'channels',
      fieldType: 'json',
    },
  })
}

interface InstagramConnection {
  pageId: string
  pageName: string
  igUserId: string
  igUsername: string
  pageAccessToken: string
  active: boolean
  connectedAt: string
  /** Unix ms; 0/undefined = nunca expira (System User token). */
  tokenExpiresAt?: number
  /** "user" | "long_lived" | "system_user" | "page" */
  tokenType?: string
}

async function loadConnection(): Promise<InstagramConnection | null> {
  const row = await prisma.setting.findUnique({ where: { key: SETTING_KEY } })
  if (!row) return null
  try {
    const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value
    return parsed as InstagramConnection
  } catch {
    return null
  }
}

async function saveConnection(conn: InstagramConnection): Promise<void> {
  const value = JSON.stringify(conn)
  await prisma.setting.upsert({
    where: { key: SETTING_KEY },
    update: { value },
    create: { key: SETTING_KEY, value, label: 'Instagram connection', grp: 'channels', fieldType: 'json' },
  })
}

/**
 * Verify token persistido independente da conexão.
 *
 * Por que separado: o painel do Meta App exige que o desenvolvedor configure
 * Callback URL + Verify Token no dashboard ANTES da conta ser conectada — Meta
 * faz um GET de verificação que precisa bater com este secret. Se o secret
 * vivesse dentro de InstagramConnection, ele só existiria após /connect, mas
 * o /connect só funciona depois do webhook estar verificado no Meta. Chicken
 * and egg. Por isso o secret é gerado/exibido antes (via /webhook-info) e
 * preservado entre reconexões.
 */
async function getOrCreateWebhookSecret(): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key: WEBHOOK_SECRET_KEY } })
  if (row?.value) {
    const raw = typeof row.value === 'string' ? row.value : String(row.value)
    const v = raw.replace(/^"|"$/g, '')
    if (v) return v
  }
  const secret = randomBytes(16).toString('hex')
  await prisma.setting.upsert({
    where: { key: WEBHOOK_SECRET_KEY },
    update: { value: secret },
    create: {
      key: WEBHOOK_SECRET_KEY,
      value: secret,
      label: 'Instagram webhook verify token',
      grp: 'channels',
      fieldType: 'string',
    },
  })
  return secret
}

function buildWebhookUrl(req: { hostname?: string }): string {
  const appUrl = process.env.APP_URL || `https://${req.hostname ?? 'localhost'}`
  return `${appUrl.replace(/\/$/, '')}/api/instagram/webhook`
}

async function fb(path: string, token: string, init?: { method?: string; body?: unknown }): Promise<any> {
  const url = `${META_GRAPH}${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`
  const res = await fetch(url, {
    method: init?.method ?? 'GET',
    headers: init?.body ? { 'Content-Type': 'application/json' } : {},
    body: init?.body ? JSON.stringify(init.body) : undefined,
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error?.message ?? `Graph error ${res.status}`)
  return data
}

/**
 * Inspeciona um token via /debug_token e devolve metadata útil.
 * `expires_at` em segundos unix; 0 = nunca expira (System User Token).
 */
/**
 * Parse + valida HMAC-SHA256 do `signed_request` que Meta manda em
 * deauthorize / data-deletion callbacks. Formato:
 *   <base64url(signature)>.<base64url(JSON payload)>
 * Assinado com app_secret. Retorna o payload se válido; lança se não.
 */
async function parseSignedRequest(signed: string): Promise<Record<string, unknown>> {
  const [sigB64, payloadB64] = signed.split('.', 2)
  if (!sigB64 || !payloadB64) throw new Error('formato inválido')
  const fromB64Url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  const sig = fromB64Url(sigB64)
  const secret = await getInstagramAppSecret()
  const expected = createHmac('sha256', secret).update(payloadB64).digest()
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) {
    throw new Error('assinatura inválida')
  }
  const payload = JSON.parse(fromB64Url(payloadB64).toString('utf8'))
  return payload as Record<string, unknown>
}

async function debugToken(input: string): Promise<{ type?: string; expiresAt?: number; isValid?: boolean }> {
  try {
    const appId = await getMetaAppId()
    const appSecret = await getMetaAppSecret()
    if (!appId || !appSecret) return {}
    const url = `${META_GRAPH}/debug_token?input_token=${encodeURIComponent(input)}&access_token=${encodeURIComponent(`${appId}|${appSecret}`)}`
    const res = await fetch(url)
    const json = await res.json()
    const d = json.data ?? {}
    return {
      type: d.type,
      // Meta retorna em segundos; convertemos para ms. 0 ou ausente = nunca expira.
      expiresAt: d.expires_at ? d.expires_at * 1000 : 0,
      isValid: !!d.is_valid,
    }
  } catch {
    return {}
  }
}

export async function instagramRoutes(app: FastifyInstance) {
  // GET /api/instagram/connection — devolve a conexão ativa, dando preferência
  // ao fluxo novo (Instagram Login API for Business).
  app.get('/api/instagram/connection', { preHandler: authMiddleware }, async () => {
    const v2 = await loadConnectionV2()
    if (v2) {
      return {
        connected: true,
        flow: 'instagram_business_login' as const,
        igUserId: v2.igUserId,
        igUsername: v2.username,
        igName: v2.name ?? null,
        accountType: v2.accountType ?? null,
        profilePictureUrl: v2.profilePictureUrl ?? null,
        active: v2.active,
        connectedAt: v2.connectedAt,
        tokenExpiresAt: v2.tokenExpiresAt,
        tokenType: 'ig_long_lived' as const,
        scopes: v2.scopes,
      }
    }
    const conn = await loadConnection()
    if (!conn) return { connected: false }
    return {
      connected: true,
      flow: 'facebook_login' as const,
      pageId: conn.pageId,
      pageName: conn.pageName,
      igUserId: conn.igUserId,
      igUsername: conn.igUsername,
      active: conn.active,
      connectedAt: conn.connectedAt,
      tokenExpiresAt: conn.tokenExpiresAt ?? null,
      tokenType: conn.tokenType ?? null,
    }
  })

  // GET /api/instagram/oauth-config — devolve estado da config OAuth (sem secret).
  app.get('/api/instagram/oauth-config', { preHandler: adminOnly }, async (req) => {
    const appIdRow = await prisma.setting.findUnique({ where: { key: 'instagram.app_id' } })
    const secretRow = await prisma.setting.findUnique({ where: { key: 'instagram.app_secret' } })
    const redirectRow = await prisma.setting.findUnique({ where: { key: 'instagram.redirect_uri' } })
    const readVal = (r: typeof appIdRow) =>
      r ? (typeof r.value === 'string' ? r.value : String(r.value)).replace(/^"|"$/g, '') : ''
    const appId = readVal(appIdRow) || process.env.IG_APP_ID || ''
    const hasSecret = !!(readVal(secretRow) || process.env.IG_APP_SECRET)
    const redirectUri = readVal(redirectRow) || process.env.IG_REDIRECT_URI ||
      `${(process.env.APP_URL || `https://${req.hostname}`).replace(/\/$/, '')}/api/oauth/instagram/callback`
    return {
      appId: appId || null,
      hasSecret,
      redirectUri,
      isConfigured: !!appId && hasSecret,
      // pistas pra o usuário cadastrar no Meta
      deauthorizeUrl: `${(process.env.APP_URL || `https://${req.hostname}`).replace(/\/$/, '')}/api/oauth/instagram/deauthorize`,
      dataDeletionUrl: `${(process.env.APP_URL || `https://${req.hostname}`).replace(/\/$/, '')}/api/oauth/instagram/data-deletion`,
    }
  })

  // POST /api/instagram/oauth-config — salva config OAuth.
  app.post('/api/instagram/oauth-config', { preHandler: adminOnly }, async (req, reply) => {
    const body = req.body as { appId?: string; appSecret?: string; redirectUri?: string }
    const appId = body.appId?.trim()
    const appSecret = body.appSecret?.trim()
    const redirectUri = body.redirectUri?.trim()
    if (!appId) return reply.code(400).send({ error: 'appId obrigatório' })
    if (!redirectUri) return reply.code(400).send({ error: 'redirectUri obrigatório' })

    const upsert = (key: string, value: string, label: string) =>
      prisma.setting.upsert({
        where: { key },
        update: { value },
        create: { key, value, label, grp: 'channels', fieldType: 'string' },
      })
    await upsert('instagram.app_id', appId, 'Instagram App ID (Login API for Business)')
    await upsert('instagram.redirect_uri', redirectUri, 'Instagram OAuth redirect URI')
    // Só atualiza secret se foi enviado (vazio = manter atual)
    if (appSecret) {
      await upsert('instagram.app_secret', appSecret, 'Instagram App Secret')
    }
    return { ok: true }
  })

  // ───────────────────────────────────────────────────────────────
  // Instagram Login API for Business (fluxo direto pelo Instagram)
  // ───────────────────────────────────────────────────────────────

  // GET /api/oauth/instagram/start — gera state CSRF e devolve a URL de
  // consent do Instagram em JSON. O front faz o redirect (window.location).
  // Não usa redirect HTTP aqui porque o authMiddleware lê o JWT do header
  // Authorization, que o browser não envia em navegação top-level.
  app.get('/api/oauth/instagram/start', { preHandler: authMiddleware }, async (req, reply) => {
    const userId = (req as any).user?.userId as number | undefined
    let appId: string
    let redirectUri: string
    try {
      appId = await getInstagramAppId()
      redirectUri = await getInstagramRedirectUri(req)
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
    const state = randomBytes(16).toString('hex')
    await persistOAuthState(state, userId)
    const url = buildAuthorizeUrl({ state, redirectUri, appId })
    return { url }
  })

  // GET /api/oauth/instagram/callback — IG redireciona aqui após consent.
  // Não exige auth (o IG não manda cookie do bychat); validamos via state CSRF.
  app.get('/api/oauth/instagram/callback', async (req, reply) => {
    const q = req.query as { code?: string; state?: string; error?: string; error_description?: string }
    const appUrl = (process.env.APP_URL || `https://${req.hostname}`).replace(/\/$/, '')
    const failureRedirect = (msg: string) =>
      reply.redirect(`${appUrl}/app/instagram?error=${encodeURIComponent(msg)}`)

    if (q.error) {
      return failureRedirect(q.error_description || q.error)
    }
    if (!q.code || !q.state) {
      return failureRedirect('Resposta inválida do Instagram (faltando code ou state).')
    }

    // CSRF
    const stateCheck = await consumeOAuthState(q.state)
    if (!stateCheck.valid) {
      return failureRedirect('State inválido ou expirado. Tente conectar novamente.')
    }

    let appId: string
    let appSecret: string
    let redirectUri: string
    try {
      appId = await getInstagramAppId()
      appSecret = await getInstagramAppSecret()
      redirectUri = await getInstagramRedirectUri(req)
    } catch (err: any) {
      return failureRedirect(err.message)
    }

    // 1. code → short-lived
    let shortToken: string
    let userIdFromIg: string
    let grantedScopes: string[]
    try {
      const tok = await exchangeCodeForToken({ code: q.code, appId, appSecret, redirectUri })
      shortToken = tok.access_token
      userIdFromIg = String(tok.user_id)
      grantedScopes = Array.isArray(tok.permissions)
        ? tok.permissions
        : typeof tok.permissions === 'string'
          ? tok.permissions.split(',').map((s) => s.trim()).filter(Boolean)
          : [...IG_BUSINESS_SCOPES]
    } catch (err: any) {
      return failureRedirect(err.message)
    }

    // 2. short → long-lived (60d)
    let longToken: string
    let expiresInSec: number
    try {
      const ll = await exchangeForLongLivedToken({ shortLivedToken: shortToken, appSecret })
      longToken = ll.access_token
      expiresInSec = ll.expires_in
    } catch (err: any) {
      return failureRedirect(err.message)
    }

    // 3. perfil
    let profile: Awaited<ReturnType<typeof fetchProfile>>
    try {
      profile = await fetchProfile(longToken)
    } catch (err: any) {
      return failureRedirect(err.message)
    }

    // 4. salva conexão
    const now = Date.now()
    const conn: InstagramBusinessConnection = {
      flow: 'instagram_business_login',
      igUserId: profile.user_id || userIdFromIg,
      username: profile.username,
      name: profile.name,
      accountType: profile.account_type,
      profilePictureUrl: profile.profile_picture_url,
      accessToken: longToken,
      tokenIssuedAt: now,
      tokenExpiresAt: now + expiresInSec * 1000,
      scopes: grantedScopes,
      active: true,
      connectedAt: new Date(now).toISOString(),
      connectedByUserId: stateCheck.userId,
    }
    await saveConnectionV2(conn)

    return reply.redirect(`${appUrl}/app/instagram?connected=1`)
  })

  // POST /api/oauth/instagram/disconnect — remove só a conexão v2.
  app.post('/api/oauth/instagram/disconnect', { preHandler: adminOnly }, async () => {
    await prisma.setting.delete({ where: { key: SETTING_KEY_V2 } }).catch(() => {})
    return { ok: true }
  })

  // POST /api/oauth/instagram/deauthorize — Meta chama quando o usuário remove
  // o app no Instagram. Body é signed_request (formato Meta).
  app.post('/api/oauth/instagram/deauthorize', async (req, reply) => {
    const body = req.body as { signed_request?: string }
    if (!body?.signed_request) return reply.code(400).send({ error: 'signed_request obrigatório' })
    try {
      const parsed = await parseSignedRequest(body.signed_request)
      const igUserId = String(parsed.user_id || '')
      if (igUserId) {
        const v2 = await loadConnectionV2()
        if (v2 && v2.igUserId === igUserId) {
          await prisma.setting.delete({ where: { key: SETTING_KEY_V2 } }).catch(() => {})
        }
      }
    } catch {
      // signed_request inválido — ignora silenciosamente; Meta espera 200 OK.
    }
    return { ok: true }
  })

  // POST /api/oauth/instagram/data-deletion — Meta GDPR data deletion request.
  // Deve devolver { url, confirmation_code } pra Meta poder mostrar o status.
  app.post('/api/oauth/instagram/data-deletion', async (req, reply) => {
    const body = req.body as { signed_request?: string }
    if (!body?.signed_request) return reply.code(400).send({ error: 'signed_request obrigatório' })
    let igUserId = ''
    try {
      const parsed = await parseSignedRequest(body.signed_request)
      igUserId = String(parsed.user_id || '')
    } catch {
      return reply.code(400).send({ error: 'signed_request inválido' })
    }
    if (igUserId) {
      const v2 = await loadConnectionV2()
      if (v2 && v2.igUserId === igUserId) {
        await prisma.setting.delete({ where: { key: SETTING_KEY_V2 } }).catch(() => {})
      }
    }
    const code = randomBytes(8).toString('hex')
    const appUrl = (process.env.APP_URL || `https://${req.hostname}`).replace(/\/$/, '')
    return {
      url: `${appUrl}/app/instagram?deletion=${code}`,
      confirmation_code: code,
    }
  })

  // GET /api/instagram/webhook-info — devolve URL + verify token para o usuário
  // colar no painel do Meta App. Existe antes da conexão (Meta exige webhook
  // verificado antes de subscrever páginas).
  app.get('/api/instagram/webhook-info', { preHandler: adminOnly }, async (req) => {
    const verifyToken = await getOrCreateWebhookSecret()
    return {
      webhookUrl: buildWebhookUrl(req),
      verifyToken,
    }
  })

  // GET /api/instagram/config — appId + configId para o popup do FB SDK no
  // frontend. Quando configId está presente, o usuário entra pelo Embedded
  // Signup (guiado); caso contrário, cai no fallback manual de Page ID + Token.
  app.get('/api/instagram/config', { preHandler: authMiddleware }, async () => {
    try {
      const appId = await getMetaAppId().catch(() => '')
      const configId = await getMetaIgConfigId()
      return { appId: appId || null, configId: configId || null }
    } catch {
      return { appId: null, configId: null }
    }
  })

  // POST /api/instagram/embedded-signup — recebe code (BISU) ou accessToken,
  // troca por long-lived, lista as páginas do usuário com IG Business vinculado.
  // Se vier { pageId } selecionado, conecta direto; senão devolve a lista.
  app.post('/api/instagram/embedded-signup', { preHandler: adminOnly }, async (req, reply) => {
    const body = req.body as { code?: string; accessToken?: string; pageId?: string }
    let userToken = body.accessToken?.trim()

    // 1. Trocar code por user access token (BISU)
    if (!userToken && body.code) {
      try {
        const appId = await getMetaAppId()
        const appSecret = await getMetaAppSecret()
        if (!appSecret) return reply.code(500).send({ error: 'META_APP_SECRET não configurado' })
        const url = `${META_GRAPH_URL}/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&code=${encodeURIComponent(body.code)}`
        const r = await fetch(url)
        const j: any = await r.json()
        if (!r.ok || !j.access_token) {
          return reply.code(400).send({ error: `Falha ao trocar code: ${j.error?.message ?? r.status}` })
        }
        userToken = j.access_token
      } catch (err: any) {
        return reply.code(400).send({ error: `Erro na troca de code: ${err.message}` })
      }
    }
    if (!userToken) return reply.code(400).send({ error: 'code ou accessToken obrigatório' })

    // 2. Trocar por long-lived (60 dias) — só se não for system user.
    try {
      const appId = await getMetaAppId()
      const appSecret = await getMetaAppSecret()
      if (appSecret) {
        const debug = await debugToken(userToken)
        if (debug.type !== 'SYSTEM') {
          const ll: any = await fetch(
            `${META_GRAPH_URL}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${encodeURIComponent(userToken)}`,
          ).then((r) => r.json())
          if (typeof ll.access_token === 'string') userToken = ll.access_token
        }
      }
    } catch {
      // segue com short-lived; caller verá tokenExpiresAt curto
    }
    if (!userToken) return reply.code(500).send({ error: 'Token vazio após troca' })

    // 3. Listar páginas com IG Business vinculado
    let accounts: any
    try {
      accounts = await fb(
        '/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}',
        userToken,
      )
    } catch (err: any) {
      return reply.code(400).send({ error: `Falha ao listar páginas: ${err.message}` })
    }

    const eligible = (accounts.data ?? []).filter((p: any) => p.instagram_business_account?.id)
    if (eligible.length === 0) {
      return reply.code(400).send({
        error:
          'Nenhuma das suas páginas do Facebook tem Instagram Business vinculado. Vincule no Meta Business Suite e tente novamente.',
      })
    }

    // 4a. Sem pageId selecionado e múltiplas opções → devolve a lista pro front
    // escolher. Devolvemos `accessToken` para o front re-enviar na próxima
    // chamada com pageId — escopo admin-only sobre HTTPS, exposição ~segundos.
    if (!body.pageId && eligible.length > 1) {
      return {
        ok: true,
        needsPageSelection: true,
        accessToken: userToken,
        pages: eligible.map((p: any) => ({
          pageId: p.id,
          pageName: p.name,
          igUsername: p.instagram_business_account.username,
          igUserId: p.instagram_business_account.id,
        })),
      }
    }

    // 4b. Página única ou já escolhida → conectar direto.
    const chosen = body.pageId
      ? eligible.find((p: any) => p.id === body.pageId)
      : eligible[0]
    if (!chosen) return reply.code(400).send({ error: 'Página selecionada não está na lista de elegíveis' })

    const pageAccessToken = chosen.access_token
    const ig = chosen.instagram_business_account

    // Subscrever página aos eventos
    try {
      await fb(
        `/${chosen.id}/subscribed_apps?subscribed_fields=messages,messaging_postbacks`,
        pageAccessToken,
        { method: 'POST' },
      )
    } catch (err: any) {
      return reply.code(500).send({ error: `Falha ao subscrever webhook: ${err.message}` })
    }

    const debug = await debugToken(pageAccessToken)
    const conn: InstagramConnection = {
      pageId: chosen.id,
      pageName: chosen.name,
      igUserId: ig.id,
      igUsername: ig.username,
      pageAccessToken,
      active: true,
      connectedAt: new Date().toISOString(),
      tokenExpiresAt: debug.expiresAt ?? 0,
      tokenType: debug.type ?? 'page',
    }
    await saveConnection(conn)

    return {
      ok: true,
      connected: true,
      pageName: chosen.name,
      igUsername: ig.username,
      tokenExpiresAt: conn.tokenExpiresAt,
    }
  })

  // POST /api/instagram/connect — admin envia pageAccessToken + pageId
  app.post('/api/instagram/connect', { preHandler: adminOnly }, async (req, reply) => {
    const body = req.body as { pageAccessToken?: string; pageId?: string }
    const pageAccessToken = body.pageAccessToken?.trim()
    const pageId = body.pageId?.trim()
    if (!pageAccessToken || !pageId) {
      return reply.code(400).send({ error: 'pageAccessToken e pageId obrigatórios' })
    }

    let pageInfo: any
    try {
      pageInfo = await fb(
        `/${pageId}?fields=id,name,instagram_business_account{id,username}`,
        pageAccessToken,
      )
    } catch (err: any) {
      return reply.code(400).send({ error: `Token/Page inválido: ${err.message}` })
    }

    const ig = pageInfo.instagram_business_account
    if (!ig) {
      return reply.code(400).send({
        error: 'A página não tem Instagram Business vinculado. Vincule no Meta Business Suite.',
      })
    }

    // Subscrever a página aos eventos de messages
    try {
      await fb(`/${pageId}/subscribed_apps?subscribed_fields=messages,messaging_postbacks`, pageAccessToken, {
        method: 'POST',
      })
    } catch (err: any) {
      return reply.code(500).send({ error: `Falha ao subscrever webhook: ${err.message}` })
    }

    const debug = await debugToken(pageAccessToken)
    const conn: InstagramConnection = {
      pageId,
      pageName: pageInfo.name,
      igUserId: ig.id,
      igUsername: ig.username,
      pageAccessToken,
      active: true,
      connectedAt: new Date().toISOString(),
      tokenExpiresAt: debug.expiresAt ?? 0,
      tokenType: debug.type ?? 'page',
    }
    await saveConnection(conn)

    return {
      ok: true,
      pageName: pageInfo.name,
      igUsername: ig.username,
      tokenExpiresAt: conn.tokenExpiresAt,
    }
  })

  // POST /api/instagram/disconnect
  app.post('/api/instagram/disconnect', { preHandler: adminOnly }, async () => {
    const conn = await loadConnection()
    if (conn) {
      try {
        await fb(`/${conn.pageId}/subscribed_apps`, conn.pageAccessToken, { method: 'DELETE' })
      } catch {
        // ignore
      }
      await prisma.setting.delete({ where: { key: SETTING_KEY } }).catch(() => {})
    }
    return { ok: true }
  })

  // GET /api/instagram/recent-recipients — últimos leads que mandaram DM,
  // para popular o seletor do "Enviar teste" (evita pedir IGSID cru ao usuário).
  app.get('/api/instagram/recent-recipients', { preHandler: adminOnly }, async () => {
    const leads = await prisma.lead.findMany({
      where: { source: 'instagram' },
      orderBy: { updatedAt: 'desc' },
      take: 20,
      select: { id: true, nome: true, formData: true, uid: true, updatedAt: true },
    })
    const list = leads
      .map((l) => {
        const fd = (l.formData ?? {}) as Record<string, unknown>
        const igsid = String(fd.instagramSenderId ?? '')
        return igsid ? { leadId: l.id, name: l.nome, igsid, updatedAt: l.updatedAt } : null
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
    return { recipients: list }
  })

  // POST /api/instagram/send-test
  app.post('/api/instagram/send-test', { preHandler: adminOnly }, async (req, reply) => {
    const body = req.body as { recipientId?: string; text?: string }
    const conn = await loadConnection()
    if (!conn) return reply.code(400).send({ error: 'Instagram não conectado' })
    if (!body.recipientId) return reply.code(400).send({ error: 'recipientId obrigatório (IGSID)' })
    try {
      const sent = await fb(`/${conn.pageId}/messages`, conn.pageAccessToken, {
        method: 'POST',
        body: {
          recipient: { id: body.recipientId },
          message: { text: body.text ?? 'Teste de conexão Instagram' },
          messaging_type: 'RESPONSE',
        },
      })
      return { ok: true, messageId: sent.message_id }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // GET /api/instagram/webhook — verify (Meta envia hub.verify_token na assinatura)
  // Valida contra o secret persistido em Setting (não na conexão), pois o Meta
  // precisa verificar o webhook ANTES de qualquer página estar conectada.
  app.get('/api/instagram/webhook', async (req, reply) => {
    const q = req.query as { 'hub.mode'?: string; 'hub.verify_token'?: string; 'hub.challenge'?: string }
    const verifyToken = await getOrCreateWebhookSecret()
    if (q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === verifyToken) {
      return reply.send(q['hub.challenge'] ?? '')
    }
    return reply.code(403).send({ error: 'Invalid verify_token' })
  })

  // POST /api/instagram/webhook — receber mensagens
  app.post('/api/instagram/webhook', async (req, reply) => {
    const conn = await loadConnection()
    if (!conn || !conn.active) return reply.code(404).send({ error: 'Not connected' })

    const body = req.body as any
    if (body.object !== 'instagram' && body.object !== 'page') return { ok: true }

    for (const entry of body.entry ?? []) {
      for (const evt of entry.messaging ?? []) {
        const senderId = evt.sender?.id
        const text = evt.message?.text
        const isEcho = evt.message?.is_echo
        if (!senderId || isEcho) continue

        const uid = `instagram:${senderId}`
        let lead = await prisma.lead.findFirst({ where: { uid } })
        if (!lead) {
          lead = await prisma.lead.create({
            data: {
              uid,
              nome: `Instagram #${senderId}`,
              empresa: '',
              whatsapp: '',
              email: '',
              status: 'NOVO',
              source: 'instagram',
              originType: 'instagram',
              scores: {},
              analysis: {},
              formData: { instagramSenderId: senderId },
            },
          })
          broadcastRealtimeEvent({
            type: 'lead:created',
            payload: { id: lead.id, nome: lead.nome, status: lead.status },
          })
        }

        const created = await prisma.message.create({
          data: {
            leadId: lead.id,
            fromMe: false,
            body: text ?? '[mídia]',
            mediaType: text ? 'text' : 'image',
            provider: 'instagram',
            senderName: lead.nome,
            externalId: evt.message?.mid ?? null,
            timestamp: new Date(evt.timestamp ?? Date.now()),
          },
        })

        broadcastRealtimeEvent({
          type: 'message:received',
          payload: { leadId: lead.id, messageId: created.id, channel: 'instagram' },
          scope: { leadId: lead.id },
        })
      }
    }

    return reply.send({ ok: true })
  })
}

// ───────────────────────────────────────────────────────────────────
// Refresher do long-lived token (Instagram Login API for Business)
// Renova a cada ~50d (Meta exige >24h após emissão; recomenda renovar
// quando faltar <7d pra expirar). Roda 1x/dia.
// ───────────────────────────────────────────────────────────────────

let igRefreshTimer: ReturnType<typeof setInterval> | null = null

export function startInstagramTokenRefresher(): void {
  if (igRefreshTimer) return
  // Primeira execução 60s após boot, depois a cada 24h.
  setTimeout(() => {
    refreshIgTokenIfNeeded().catch((e) => console.error('[IG refresh] erro:', e.message))
    igRefreshTimer = setInterval(() => {
      refreshIgTokenIfNeeded().catch((e) => console.error('[IG refresh] erro:', e.message))
    }, 24 * 60 * 60 * 1000)
  }, 60_000)
  console.log('[IG] Token refresher iniciado — verifica diariamente.')
}

async function refreshIgTokenIfNeeded(): Promise<void> {
  const conn = await loadConnectionV2()
  if (!conn || !conn.active) return
  const now = Date.now()
  const issuedDaysAgo = (now - conn.tokenIssuedAt) / (24 * 60 * 60 * 1000)
  const remainingDays = (conn.tokenExpiresAt - now) / (24 * 60 * 60 * 1000)
  // Meta exige no mínimo 24h após issuance pra renovar; renovamos quando faltar <7d.
  if (issuedDaysAgo < 1) return
  if (remainingDays > 7) return
  try {
    const refreshed = await refreshLongLivedToken(conn.accessToken)
    const updated: InstagramBusinessConnection = {
      ...conn,
      accessToken: refreshed.access_token,
      tokenIssuedAt: now,
      tokenExpiresAt: now + refreshed.expires_in * 1000,
    }
    await saveConnectionV2(updated)
    console.log(`[IG refresh] token renovado p/ @${conn.username} (válido +${Math.round(refreshed.expires_in / 86400)}d)`)
  } catch (e: any) {
    console.error(`[IG refresh] falha pra @${conn.username}:`, e.message)
  }
}
