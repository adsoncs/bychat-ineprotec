import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { adminOnly } from '../lib/auth.js'
import { getAuthenticatedClient } from '../lib/google.js'

// Google Ads API version (gerenciado em um lugar pra atualizações futuras).
// Google sunsetta versões a cada ~12 meses; quando subir, validar que todos os
// campos GAQL ainda existem (`conversion_action.value_settings.*`, etc).
// Versão centralizada em lib/googleAdsApi (override por env GOOGLE_ADS_API_VERSION).
// O Google bloqueia versões antigas (v20 bloqueada em 2026-07 com UNSUPPORTED_VERSION).
import { GOOGLE_ADS_API_VERSION, GOOGLE_ADS_API_BASE } from '../lib/googleAdsApi.js'

// ── Developer Token global ───────────────────────────────────
// O token é da APLICAÇÃO (Beyond), não do cliente. Vive em Setting global,
// configurado UMA VEZ pela admin. Cliente leigo nunca vê isso.
// Cache de 60s pra evitar bater no DB em todo upload de conversão.
const TOKEN_CACHE_KEY = 'google.ads.developer_token'
let tokenCache: { value: string | null; expiresAt: number } | null = null

async function getDeveloperToken(): Promise<string | null> {
  if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.value
  const row = await prisma.setting.findUnique({ where: { key: TOKEN_CACHE_KEY }, select: { value: true } }).catch(() => null)
  let token: string | null = null
  if (row?.value) {
    const v = row.value as any
    const raw = typeof v === 'string' ? v : (v?.token || v?.value || '')
    token = String(raw).trim() || null
  }
  tokenCache = { value: token, expiresAt: Date.now() + 60_000 }
  return token
}

export function invalidateGoogleAdsTokenCache() {
  tokenCache = null
}

// Helper de chamada à Google Ads API com OAuth + dev token unificado.
// Retorna { ok, status, data } pra caller decidir error code.
async function callGoogleAdsApi(
  connectionId: number,
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown },
): Promise<{ ok: boolean; status: number; data: any }> {
  const developerToken = await getDeveloperToken()
  if (!developerToken) {
    return { ok: false, status: 412, data: { error: 'developer_token_missing', message: 'Developer Token não configurado. Admin precisa cadastrar em Configurações > Google Ads.' } }
  }
  const auth = await getAuthenticatedClient(connectionId)
  const accessToken = (await auth.getAccessToken()).token
  if (!accessToken) {
    return { ok: false, status: 401, data: { error: 'oauth_token_missing', message: 'Conexão Google sem access token. Reconecte em /app/google.' } }
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': developerToken,
    'Content-Type': 'application/json',
  }
  // Login Customer ID (MCC) — opcional. Necessário quando token vive em MCC
  // e a chamada é contra sub-conta. Se não setado, helper omite o header.
  try {
    const loginRow = await prisma.setting.findUnique({ where: { key: 'google.ads.login_customer_id' }, select: { value: true } })
    if (loginRow?.value) {
      const v: any = loginRow.value
      const raw = typeof v === 'string' ? v : (v?.id || v?.value || '')
      const id = String(raw).replace(/\D/g, '')
      if (id) headers['login-customer-id'] = id
    }
  } catch { /* silencioso */ }
  const url = `${GOOGLE_ADS_API_BASE}${path}`
  const resp = await fetch(url, {
    method: init.method,
    headers,
    body: init.body ? JSON.stringify(init.body) : undefined,
  })
  // Tenta JSON primeiro; se o Google responder HTML (ex: versão deprecated da
  // API → página 404 do Google), preserva o body bruto pra extractGoogleAdsError
  // poder detectar e dar mensagem útil ao operador.
  const ct = resp.headers.get('content-type') || ''
  let data: any
  if (ct.includes('application/json')) {
    data = await resp.json().catch(() => ({}))
  } else {
    const text = await resp.text().catch(() => '')
    data = { _raw: text.slice(0, 500), _contentType: ct, _status: resp.status }
  }
  if (!resp.ok) {
    console.error(`[googleAds] ${init.method} ${url} → ${resp.status}`, JSON.stringify(data).slice(0, 800))
  }
  return { ok: resp.ok, status: resp.status, data }
}

// Extrai mensagem amigável de erro da Google Ads API. Cobre 4 formatos:
//   1. Padrão Google API: { error: { message, code, status } }
//   2. Aninhado Google Ads: { error: { details: [{ errors: [{ message, errorCode }] }] } }
//   3. Response não-JSON (HTML): { _raw, _contentType } — gerado por callGoogleAdsApi
//   4. String pura
function extractGoogleAdsError(data: any, status?: number): string {
  // 3. Resposta não-JSON (versão da API deprecated/sunset, página 404 do Google, etc)
  if (data?._raw && typeof data._raw === 'string') {
    if (status === 404) {
      return 'Versão da Google Ads API indisponível (404). A versão configurada no servidor pode ter sido descontinuada — atualize GOOGLE_ADS_API_VERSION.'
    }
    if (data._contentType?.includes('html')) {
      return `Google retornou HTML em vez de JSON (status ${status ?? '?'}). Possíveis causas: versão da API deprecated, endpoint errado ou bloqueio de rede. Detalhe: ${data._raw.slice(0, 120).replace(/\s+/g, ' ')}…`
    }
    return `Resposta inesperada do Google Ads (status ${status ?? '?'}): ${data._raw.slice(0, 200)}`
  }
  // 2. Erro aninhado
  const nested = data?.error?.details?.[0]?.errors?.[0]
  if (nested?.message) {
    const code = nested.errorCode ? ` [${Object.keys(nested.errorCode).join(',')}]` : ''
    return `${nested.message}${code}`
  }
  // 1. Padrão Google API
  if (data?.error?.message) {
    const code = data.error.status ? ` [${data.error.status}]` : ''
    return `${data.error.message}${code}`
  }
  // 4. String
  if (typeof data === 'string') return data
  // Sem fallback genérico — devolve algo informativo
  return `Falha na Google Ads API (status ${status ?? '?'}). Verifique Developer Token e permissões da conta.`
}

export async function googleAdsRoutes(app: FastifyInstance) {

  // Auto-seed do Setting do Developer Token global (admin cadastra depois)
  await prisma.setting.upsert({
    where: { key: TOKEN_CACHE_KEY },
    update: {},
    create: {
      key: TOKEN_CACHE_KEY,
      value: '',
      label: 'Google Ads — Developer Token',
      grp: 'integrations',
      fieldType: 'password',
    },
  }).catch(() => {})

  // ── GET /api/admin/google/ads/dev-token-status ─── Status do token global ──
  app.get('/api/admin/google/ads/dev-token-status', { preHandler: adminOnly }, async () => {
    const token = await getDeveloperToken()
    return { configured: !!token, length: token ? token.length : 0 }
  })

  // ── GET /api/admin/google/ads/list-accessible-customers ───
  // Auto-detecta as contas Google Ads que o operador OAuth-logado tem acesso.
  // Substitui o input manual de Customer ID — leigo escolhe num dropdown.
  app.get('/api/admin/google/ads/list-accessible-customers', { preHandler: adminOnly }, async (req, reply) => {
    const q = req.query as any
    const connectionId = parseInt(q.connectionId || '0')
    if (!connectionId) return reply.code(400).send({ error: 'connectionId obrigatório' })

    const r = await callGoogleAdsApi(connectionId, '/customers:listAccessibleCustomers', { method: 'GET' })
    if (!r.ok) return reply.code(r.status).send({ error: extractGoogleAdsError(r.data, r.status), details: r.data })

    // Retorno da API: { resourceNames: ['customers/1234567890', ...] }
    const resourceNames: string[] = Array.isArray(r.data?.resourceNames) ? r.data.resourceNames : []
    if (resourceNames.length === 0) {
      return { data: [] }
    }

    // Pega nome amigável de cada conta via search (descriptiveName, currencyCode, isManager)
    const customers: Array<{ id: string; resourceName: string; descriptiveName: string | null; currencyCode: string | null; isManager: boolean }> = []
    for (const rn of resourceNames) {
      const customerId = rn.replace('customers/', '')
      const searchResp = await callGoogleAdsApi(
        connectionId,
        `/customers/${customerId}/googleAds:search`,
        {
          method: 'POST',
          body: {
            query: 'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.manager FROM customer LIMIT 1',
          },
        },
      )
      if (searchResp.ok && Array.isArray(searchResp.data?.results) && searchResp.data.results[0]) {
        const c = searchResp.data.results[0].customer
        customers.push({
          id: customerId,
          resourceName: rn,
          descriptiveName: c?.descriptiveName ?? null,
          currencyCode: c?.currencyCode ?? null,
          isManager: !!c?.manager,
        })
      } else {
        // Sem permissão de leitura ou MCC sem read direto — devolve a info mínima
        customers.push({ id: customerId, resourceName: rn, descriptiveName: null, currencyCode: null, isManager: false })
      }
    }

    return { data: customers }
  })

  // ── GET /api/admin/google/ads/list-conversion-actions ───
  // Lista as conversion actions da conta escolhida — leigo escolhe num dropdown
  // em vez de digitar ID. Filtra só as que estão habilitadas.
  app.get('/api/admin/google/ads/list-conversion-actions', { preHandler: adminOnly }, async (req, reply) => {
    const q = req.query as any
    const connectionId = parseInt(q.connectionId || '0')
    const customerId = String(q.customerId || '').replace(/[^0-9]/g, '')
    if (!connectionId || !customerId) return reply.code(400).send({ error: 'connectionId e customerId obrigatórios' })

    const r = await callGoogleAdsApi(
      connectionId,
      `/customers/${customerId}/googleAds:search`,
      {
        method: 'POST',
        body: {
          query: `SELECT conversion_action.id,
                         conversion_action.name,
                         conversion_action.category,
                         conversion_action.type,
                         conversion_action.status,
                         conversion_action.resource_name,
                         conversion_action.value_settings.default_value,
                         conversion_action.value_settings.default_currency_code
                  FROM conversion_action
                  WHERE conversion_action.status = 'ENABLED'
                  ORDER BY conversion_action.name`,
        },
      },
    )
    if (!r.ok) return reply.code(r.status).send({ error: extractGoogleAdsError(r.data, r.status), details: r.data })

    const results = Array.isArray(r.data?.results) ? r.data.results : []
    const actions = results.map((row: any) => {
      const ca = row.conversionAction || {}
      return {
        id: ca.id,
        name: ca.name,
        category: ca.category,
        type: ca.type,
        status: ca.status,
        resourceName: ca.resourceName,
        defaultValue: ca.valueSettings?.defaultValue ?? null,
        defaultCurrency: ca.valueSettings?.defaultCurrencyCode ?? null,
      }
    })
    return { data: actions }
  })

  // GET /api/admin/google/ads/config — Configs já cadastradas
  app.get('/api/admin/google/ads/config', { preHandler: adminOnly }, async () => {
    const configs = await prisma.googleAdsConfig.findMany({ orderBy: { createdAt: 'desc' } })
    return { data: configs }
  })

  // POST /api/admin/google/ads/config — Cadastrar conta
  // Mudanças (Fase 25, simplificação leigo):
  //   - developerToken NÃO vem mais do body (é Setting global, gerenciado pelo admin)
  //   - conversionAction agora aceita o ID OU o resource name; normaliza pra ID
  app.post('/api/admin/google/ads/config', { preHandler: adminOnly }, async (req, reply) => {
    const body = req.body as any
    if (!body.connectionId || !body.customerId) {
      return reply.code(400).send({ error: 'connectionId e customerId são obrigatórios' })
    }
    const developerToken = await getDeveloperToken()
    if (!developerToken) {
      return reply.code(412).send({
        error: 'Developer Token não configurado. Admin precisa cadastrar em Configurações > Integrações > Google Ads antes de criar contas.',
      })
    }
    const cleanCid = String(body.customerId).replace(/[^0-9]/g, '')
    if (!cleanCid) return reply.code(400).send({ error: 'customerId inválido' })

    // conversionAction pode vir como "customers/1234/conversionActions/567" ou só "567"
    let conversionActionId: string | null = null
    if (body.conversionAction) {
      const raw = String(body.conversionAction).trim()
      const match = raw.match(/(?:conversionActions\/)?(\d+)$/)
      if (match) conversionActionId = match[1] || null
      else conversionActionId = raw
    }

    const user = (req as any).user
    const config = await prisma.googleAdsConfig.create({
      data: {
        connectionId: parseInt(body.connectionId),
        customerId: cleanCid,
        // Mantemos a coluna por retrocompat de schema, mas o token efetivo vem do
        // Setting global (read em runtime). Storage do token aqui = vazio.
        developerToken: '',
        conversionAction: conversionActionId,
        autoSendConversions: body.autoSendConversions === true,
        createdBy: user?.userId || null,
      },
    })
    return reply.code(201).send({ data: config })
  })

  // PUT /api/admin/google/ads/config/:id — Editar
  app.put('/api/admin/google/ads/config/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const body = req.body as any
    const data: any = {}
    if (body.customerId !== undefined) data.customerId = String(body.customerId).replace(/[^0-9]/g, '')
    if (body.conversionAction !== undefined) {
      if (body.conversionAction === null) data.conversionAction = null
      else {
        const raw = String(body.conversionAction).trim()
        const match = raw.match(/(?:conversionActions\/)?(\d+)$/)
        data.conversionAction = match?.[1] ?? raw
      }
    }
    if (body.autoSendConversions !== undefined) data.autoSendConversions = body.autoSendConversions
    if (body.active !== undefined) data.active = body.active
    const updated = await prisma.googleAdsConfig.update({ where: { id: parseInt(id) }, data })
    return { data: updated }
  })

  // DELETE /api/admin/google/ads/config/:id
  app.delete('/api/admin/google/ads/config/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    await prisma.googleAdsConfig.delete({ where: { id: parseInt(id) } })
    return { ok: true }
  })

  // GET /api/admin/google/ads/leads-with-gclid — Leads com GCLID para conversão
  app.get('/api/admin/google/ads/leads-with-gclid', { preHandler: adminOnly }, async (req) => {
    const q = req.query as any
    const limit = Math.min(parseInt(q.limit) || 50, 200)
    const offset = parseInt(q.offset) || 0
    const onlySales = q.onlySales === 'true'

    const where: any = { gclid: { not: null } }
    if (onlySales) where.saleDetected = true

    const [leads, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        select: {
          id: true, nome: true, empresa: true, whatsapp: true, email: true,
          gclid: true, saleDetected: true, saleValue: true, status: true,
          source: true, createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      prisma.lead.count({ where }),
    ])

    return { data: leads, total, limit, offset }
  })

  // POST /api/admin/google/ads/send-conversion — Enviar conversão offline
  app.post('/api/admin/google/ads/send-conversion', { preHandler: adminOnly }, async (req, reply) => {
    const body = req.body as any
    if (!body.leadId) return reply.code(400).send({ error: 'leadId obrigatório' })

    const config = await prisma.googleAdsConfig.findFirst({ where: { active: true } })
    if (!config) return reply.code(400).send({ error: 'Google Ads não configurado' })
    if (!config.conversionAction) return reply.code(400).send({ error: 'Conta sem conversion action escolhida — edite a configuração' })

    const developerToken = await getDeveloperToken()
    if (!developerToken) return reply.code(412).send({ error: 'Developer Token não configurado' })

    const lead = await prisma.lead.findUnique({
      where: { id: parseInt(body.leadId) },
      select: { gclid: true, saleValue: true, nome: true, createdAt: true },
    })
    if (!lead?.gclid) return reply.code(400).send({ error: 'Lead não possui GCLID' })

    try {
      const auth = await getAuthenticatedClient(config.connectionId)
      const token = (await auth.getAccessToken()).token

      const conversionPayload = {
        conversions: [{
          gclid: lead.gclid,
          conversionAction: `customers/${config.customerId}/conversionActions/${config.conversionAction}`,
          conversionDateTime: new Date().toISOString().replace('T', ' ').replace('Z', '+00:00'),
          conversionValue: lead.saleValue || body.value || 0,
          currencyCode: 'BRL',
        }],
        partialFailure: true,
      }

      const resp = await fetch(
        `${GOOGLE_ADS_API_BASE}/customers/${config.customerId}:uploadClickConversions`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'developer-token': developerToken,
          },
          body: JSON.stringify(conversionPayload),
        }
      )

      const result = await resp.json() as any

      if (resp.ok) {
        await prisma.googleAdsConfig.update({
          where: { id: config.id },
          data: { totalSent: { increment: 1 }, lastSentAt: new Date() },
        })
        return { success: true, result }
      } else {
        await prisma.googleAdsConfig.update({
          where: { id: config.id },
          data: { totalFailed: { increment: 1 } },
        })
        return reply.code(400).send({ error: extractGoogleAdsError(result), details: result })
      }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // POST /api/admin/google/ads/send-batch — Enviar conversões em lote
  app.post('/api/admin/google/ads/send-batch', { preHandler: adminOnly }, async (req, reply) => {
    const body = req.body as any
    const leadIds: number[] = body.leadIds || []
    if (leadIds.length === 0) return reply.code(400).send({ error: 'leadIds obrigatório' })

    const config = await prisma.googleAdsConfig.findFirst({ where: { active: true } })
    if (!config) return reply.code(400).send({ error: 'Google Ads não configurado' })
    if (!config.conversionAction) return reply.code(400).send({ error: 'Conta sem conversion action escolhida' })

    const developerToken = await getDeveloperToken()
    if (!developerToken) return reply.code(412).send({ error: 'Developer Token não configurado' })

    const leads = await prisma.lead.findMany({
      where: { id: { in: leadIds }, gclid: { not: null } },
      select: { id: true, gclid: true, saleValue: true, createdAt: true },
    })

    if (leads.length === 0) return reply.code(400).send({ error: 'Nenhum lead com GCLID encontrado' })

    try {
      const auth = await getAuthenticatedClient(config.connectionId)
      const token = (await auth.getAccessToken()).token

      const conversions = leads.map(lead => ({
        gclid: lead.gclid,
        conversionAction: `customers/${config.customerId}/conversionActions/${config.conversionAction}`,
        conversionDateTime: new Date().toISOString().replace('T', ' ').replace('Z', '+00:00'),
        conversionValue: lead.saleValue || 0,
        currencyCode: 'BRL',
      }))

      const resp = await fetch(
        `${GOOGLE_ADS_API_BASE}/customers/${config.customerId}:uploadClickConversions`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'developer-token': developerToken,
          },
          body: JSON.stringify({ conversions, partialFailure: true }),
        }
      )

      const result = await resp.json()
      const sent = leads.length

      await prisma.googleAdsConfig.update({
        where: { id: config.id },
        data: { totalSent: { increment: sent }, lastSentAt: new Date() },
      })

      return { success: true, sent, result }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // ── Login Customer ID (MCC) ──────────────────────────────
  // Quando o developer token vive numa MCC e a conta sincronizada é uma sub-conta,
  // o header `login-customer-id` da MCC é OBRIGATÓRIO. Sem ele a API ou nega ou
  // devolve `results: []` silenciosamente. Vive em Setting `google.ads.login_customer_id`.

  app.get('/api/admin/google/ads/login-customer-id', { preHandler: adminOnly }, async () => {
    const row = await prisma.setting.findUnique({ where: { key: 'google.ads.login_customer_id' }, select: { value: true } }).catch(() => null)
    let id: string | null = null
    if (row?.value) {
      const v: any = row.value
      const raw = typeof v === 'string' ? v : (v?.id || v?.value || '')
      id = String(raw).replace(/\D/g, '') || null
    }
    return { loginCustomerId: id }
  })

  app.put('/api/admin/google/ads/login-customer-id', { preHandler: adminOnly }, async (req) => {
    const body = (req.body as any) || {}
    const id = String(body.loginCustomerId || '').replace(/\D/g, '')
    await prisma.setting.upsert({
      where: { key: 'google.ads.login_customer_id' },
      create: { key: 'google.ads.login_customer_id', label: 'Google Ads — Login Customer ID (MCC)', grp: 'integrations', fieldType: 'text', value: id as any },
      update: { value: id as any },
    })
    return { ok: true, loginCustomerId: id || null }
  })

  // ── Conversion Map (Fase 28-B: 1 CA por trigger interno) ──────────────────

  const SUPPORTED_TRIGGERS = [
    'lead.won',
    'lead_qualified',
    'enrollment.payment_confirmed',
    'diagnosis.completed',
  ] as const
  type SupportedTrigger = (typeof SUPPORTED_TRIGGERS)[number]

  function isSupportedTrigger(t: any): t is SupportedTrigger {
    return typeof t === 'string' && (SUPPORTED_TRIGGERS as readonly string[]).includes(t)
  }

  // GET /api/admin/google/ads/conversion-map → retorna o mapping da config ativa
  app.get('/api/admin/google/ads/conversion-map', { preHandler: adminOnly }, async () => {
    const config = await prisma.googleAdsConfig.findFirst({
      where: { active: true },
      include: { conversionMap: { orderBy: { trigger: 'asc' } } },
    })
    return {
      configId: config?.id ?? null,
      supportedTriggers: SUPPORTED_TRIGGERS,
      items: config?.conversionMap ?? [],
    }
  })

  // PUT /api/admin/google/ads/conversion-map → upsert em lote
  // body: { items: [{ trigger, conversionAction, valueSource, fixedValue?, isPrimary?, enabled? }] }
  app.put('/api/admin/google/ads/conversion-map', { preHandler: adminOnly }, async (req, reply) => {
    const body = (req.body as any) || {}
    const items: any[] = Array.isArray(body.items) ? body.items : []

    const config = await prisma.googleAdsConfig.findFirst({ where: { active: true } })
    if (!config) return reply.code(400).send({ error: 'Google Ads não configurado' })

    const triggersInBody = new Set<string>()
    for (const it of items) {
      if (!isSupportedTrigger(it.trigger)) {
        return reply.code(400).send({ error: `Trigger não suportado: ${it.trigger}` })
      }
      if (!it.conversionAction || typeof it.conversionAction !== 'string') {
        return reply.code(400).send({ error: `Conversion action obrigatória para trigger ${it.trigger}` })
      }
      triggersInBody.add(it.trigger)
    }

    for (const it of items) {
      const valueSource = ['zero', 'sale_value', 'fixed'].includes(it.valueSource) ? it.valueSource : 'zero'
      const fixedValue = valueSource === 'fixed' && typeof it.fixedValue === 'number' ? it.fixedValue : null
      await prisma.googleAdsConversionMap.upsert({
        where: { configId_trigger: { configId: config.id, trigger: it.trigger } },
        create: {
          configId: config.id,
          trigger: it.trigger,
          conversionAction: String(it.conversionAction).trim().substring(0, 191),
          valueSource,
          fixedValue,
          isPrimary: !!it.isPrimary,
          enabled: it.enabled !== false,
        },
        update: {
          conversionAction: String(it.conversionAction).trim().substring(0, 191),
          valueSource,
          fixedValue,
          isPrimary: !!it.isPrimary,
          enabled: it.enabled !== false,
        },
      })
    }

    // Remove mappings que não foram enviados (operador desmarcou trigger)
    await prisma.googleAdsConversionMap.deleteMany({
      where: { configId: config.id, trigger: { notIn: Array.from(triggersInBody) } },
    })

    // Mantém GoogleAdsConfig.conversionAction (legado/compat) apontando para o trigger
    // 'lead.won' do map — endpoints antigos de send-conversion/send-batch continuam funcionando.
    const leadWonMap = items.find(i => i.trigger === 'lead.won')
    await prisma.googleAdsConfig.update({
      where: { id: config.id },
      data: { conversionAction: leadWonMap?.conversionAction ?? null },
    })

    return { ok: true, count: items.length }
  })
}
