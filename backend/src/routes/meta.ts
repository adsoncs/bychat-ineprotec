// src/routes/meta.ts
// Integração Meta (Facebook) Lead Ads — webhook, OAuth, forms, processamento de leads

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'
import { logEvent, getIp, getOperator, EVENT_TYPES } from '../services/leadHistory.js'
import { notifyNewLead } from '../services/notify.js'
import { generateUid, flagDuplicate } from '../services/dedup.js'
import { getMetaAppId, getMetaAppSecret, getMetaConfigId, metaFetch, META_GRAPH_URL } from '../lib/meta.js'
import { queues } from '../lib/queues.js'
import { pickOperatorForTeam, resolveRoutingFromContext } from '../services/teamRouting.js'

const META_POLL_INTERVAL = parseInt(process.env.META_POLL_INTERVAL || '300000') // 5 min default


// ─── Token de longa duração ─────────────────────────────

async function exchangeLongLivedToken(shortToken: string): Promise<string> {
  try {
    const appId = await getMetaAppId()
    const appSecret = await getMetaAppSecret()
    if (!appSecret) {
      console.log('[Meta] App secret nao configurado, usando token original')
      return shortToken
    }
    const resp = await metaFetch(
      `/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${shortToken}`,
      shortToken
    )
    if (resp.access_token) {
      console.log(`[Meta] Token de longa duracao obtido (expira em ${resp.expires_in || 'N/A'}s)`)
      return resp.access_token
    }
    return shortToken
  } catch (err: any) {
    console.warn(`[Meta] Falha ao trocar token para longa duracao: ${err.message}`)
    return shortToken
  }
}

async function exchangeLongLivedPageToken(userLongToken: string, pageId: string): Promise<string> {
  try {
    const pagesResp = await metaFetch(`/${pageId}?fields=access_token`, userLongToken)
    if (pagesResp.access_token) {
      console.log(`[Meta] Page token de longa duracao obtido para page ${pageId}`)
      return pagesResp.access_token
    }
    return userLongToken
  } catch (err: any) {
    console.warn(`[Meta] Falha ao obter page token longa duracao: ${err.message}`)
    return userLongToken
  }
}

// ─── Polling automático de leads ────────────────────────

let metaPollTimer: ReturnType<typeof setInterval> | null = null

export function startMetaLeadPoller() {
  if (metaPollTimer) return
  console.log(`[Meta] Poller de leads iniciado (intervalo: ${META_POLL_INTERVAL / 1000}s)`)

  // Primeira execução após 30s (dar tempo do servidor estabilizar)
  setTimeout(() => pollAllMetaForms(), 30000)

  metaPollTimer = setInterval(() => {
    pollAllMetaForms().catch(err => {
      console.error(`[Meta] Erro no poller: ${err.message}`)
    })
  }, META_POLL_INTERVAL)
}

async function pollAllMetaForms() {
  const integrations = await prisma.metaIntegration.findMany({
    where: { active: true },
    include: { forms: { where: { status: 'active' } } }
  })

  if (integrations.length === 0) return

  let totalCreated = 0

  for (const integration of integrations) {
    for (const form of integration.forms) {
      try {
        const created = await pollFormLeads(form, integration)
        totalCreated += created
      } catch (err: any) {
        console.error(`[Meta] Poll falhou para form ${form.formId}: ${err.message}`)
      }
    }
  }

  if (totalCreated > 0) {
    console.log(`[Meta] Poller: ${totalCreated} novos leads importados`)
  }
}

async function pollFormLeads(form: any, integration: any): Promise<number> {
  let created = 0
  // Pagina /leads via paging.next até esgotar. Sem isso, formulários com
  // muitos leads ficam capados na 1ª página (incidente 2026-05-20: 880 leads
  // perdidos no backfill da Terram).
  let leadsData: any = await metaFetch(
    `/${form.formId}/leads?fields=id,created_time,field_data,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,platform&limit=100`,
    integration.pageAccessToken
  )

  let pagesFetched = 0
  while (leadsData && Array.isArray(leadsData.data) && leadsData.data.length > 0) {
    for (const leadData of leadsData.data) {
      const metaLeadId = String(leadData.id)

      const existing = await prisma.metaLeadLog.findFirst({ where: { metaLeadId, status: 'processed' } })
      if (existing) continue

      const recentFail = await prisma.metaLeadLog.findFirst({
        where: { metaLeadId, status: 'failed', createdAt: { gte: new Date(Date.now() - 3600000) } }
      })
      if (recentFail) continue

      try {
        const fieldData = leadData.field_data || []
        const fields: Record<string, string> = {}
        for (const fd of fieldData) {
          fields[fd.name] = Array.isArray(fd.values) ? fd.values.join(', ') : String(fd.values || '')
        }

        const campaignData = {
          campaign_id: leadData.campaign_id, campaign_name: leadData.campaign_name,
          adset_id: leadData.adset_id, adset_name: leadData.adset_name,
          ad_id: leadData.ad_id, ad_name: leadData.ad_name,
          platform: leadData.platform, created_time: leadData.created_time,
        }

        const log = await prisma.metaLeadLog.create({
          data: { metaLeadId, metaFormId: form.formId, metaPageId: integration.pageId, status: 'received', rawData: fields, campaignData }
        })

        const formWithIntegration = { ...form, integration }
        const lead = await createLeadFromMeta(formWithIntegration, fields, { metaLeadId, pageId: integration.pageId, campaignData }, null)

        await prisma.metaLeadLog.update({ where: { id: log.id }, data: { status: 'processed', leadId: lead.id, processedAt: new Date() } })
        created++
      } catch (err: any) {
        await prisma.metaLeadLog.create({
          data: { metaLeadId, metaFormId: form.formId, metaPageId: integration.pageId, status: 'failed', errorMessage: `[poller] ${err.message}` }
        }).catch(() => {})
      }
    }

    pagesFetched++
    const next = leadsData.paging?.next
    if (!next || pagesFetched >= 100) break
    const resp = await fetch(next)
    if (!resp.ok) break
    leadsData = await resp.json()
  }

  if (created > 0) {
    await prisma.metaForm.update({ where: { id: form.id }, data: { leadsReceived: { increment: created }, lastLeadAt: new Date() } })
    await prisma.metaIntegration.update({ where: { id: integration.id }, data: { leadsReceived: { increment: created } } })
  }

  return created
}

// ─── Routes ──────────────────────────────────────────────

export async function metaRoutes(app: FastifyInstance) {

  // Auto-seed: garantir que settings Meta existam
  const metaSettings = [
    { key: 'meta.app_id', label: 'Meta App ID', fieldType: 'text' },
    { key: 'meta.app_secret', label: 'Meta App Secret', fieldType: 'password' },
    { key: 'meta.config_id', label: 'Lead Ads — Config ID (Facebook Login for Business)', fieldType: 'text' },
    { key: 'meta.wa_config_id', label: 'WhatsApp Embedded Signup — Config ID', fieldType: 'text' },
  ]
  for (const s of metaSettings) {
    await prisma.setting.upsert({
      where: { key: s.key }, update: {},
      create: { key: s.key, value: '', label: s.label, grp: 'meta', fieldType: s.fieldType }
    }).catch(() => {})
  }

  // ══════════════════════════════════════════════════════
  //  WEBHOOK — Verificacao e recebimento de leads
  // ══════════════════════════════════════════════════════

  // GET /api/meta/webhook — Verificacao do webhook pela Meta
  app.get('/api/meta/webhook', async (req, reply) => {
    const q = req.query as any
    const mode = q['hub.mode']
    const token = q['hub.verify_token']
    const challenge = q['hub.challenge']

    // Buscar verify token configurado — SEM fallback para literal previsível.
    // Se nenhum verify token estiver configurado, a verificação falha (fail-closed).
    const integration = await prisma.metaIntegration.findFirst({ where: { active: true } })
    const verifyToken = integration?.webhookSecret || process.env.META_VERIFY_TOKEN || ''

    if (mode === 'subscribe' && verifyToken && typeof token === 'string' && token === verifyToken) {
      app.log.info('[Meta] Webhook verified successfully')
      return reply.code(200).send(challenge)
    }

    // Nunca logar o valor do token recebido (poderia vazar um token válido mal digitado).
    app.log.warn(`[Meta] Webhook verification failed: mode=${mode}, hasToken=${!!token}, configured=${!!verifyToken}`)
    return reply.code(403).send('Verification failed')
  })

  // POST /api/meta/webhook — Receber eventos de lead do Meta
  app.post('/api/meta/webhook', async (req, reply) => {
    try {
      // ── Validação de assinatura X-Hub-Signature-256 ───────────────────
      // rawBody é capturado no preParsing do server.ts para esta rota. Sem isso,
      // qualquer um forja leadgen_id e injeta leads falsos.
      const rawBody = (req as any).rawBody as Buffer | undefined
      const signature = req.headers['x-hub-signature-256'] as string | undefined
      const appSecret = await getMetaAppSecret()
      if (appSecret) {
        const { validateWebhookSignature } = await import('../services/cloudApi.js')
        if (!rawBody || !signature || !validateWebhookSignature(rawBody, signature, appSecret)) {
          app.log.warn('[Meta] Webhook signature inválida — rejeitando')
          return reply.code(401).send('Invalid signature')
        }
      } else if (process.env.META_WEBHOOK_STRICT === '1') {
        app.log.warn('[Meta][SECURITY] sem app secret + STRICT — rejeitando webhook')
        return reply.code(401).send('Signature required')
      } else {
        app.log.warn('[Meta][SECURITY] app secret ausente — webhook aceito SEM verificação. Configure META_APP_SECRET.')
      }

      const body = req.body as any

      // Responde 200 imediatamente (Meta exige < 10s)
      reply.code(200).send('EVENT_RECEIVED')

      // Processar em background
      if (body?.entry) {
        for (const entry of body.entry) {
          const pageId = String(entry.id || '')
          const changes = entry.changes || []

          for (const change of changes) {
            if (change.field === 'leadgen') {
              const value = change.value || {}
              const metaLeadId = String(value.leadgen_id || value.lead_id || '')
              const metaFormId = String(value.form_id || value.leadgen_id || '')

              if (metaLeadId) {
                // Idempotência/anti-replay: o Meta reenvia o evento em falha de ACK.
                // SET NX no leadgen_id evita re-buscar/re-inserir o mesmo lead.
                const { redis } = await import('../lib/redis.js')
                let fresh: string | null = '1'
                try { fresh = await redis.set(`metalead:${metaLeadId}`, '1', 'EX', 86400, 'NX') } catch { /* segue */ }
                if (fresh === null) continue
                processMetaLead(metaLeadId, metaFormId, pageId, app).catch(err => {
                  app.log.error(`[Meta] Lead processing failed: ${err.message}`)
                })
              }
            }
          }
        }
      }
    } catch (err: any) {
      app.log.error(`[Meta] Webhook error: ${err.message}`)
      return reply.code(200).send('OK')
    }
  })

  // ══════════════════════════════════════════════════════
  //  FACEBOOK JS SDK — recebe token do frontend
  // ══════════════════════════════════════════════════════

  // GET /api/meta/app-id — Retorna App ID para o JS SDK do frontend
  app.get('/api/meta/app-id', async (req, reply) => {
    try {
      const appId = await getMetaAppId()
      return { appId }
    } catch {
      return { appId: null }
    }
  })

  // GET /api/meta/config — Retorna App ID + Config ID (interno, cliente nao precisa saber)
  app.get('/api/meta/config', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const appId = await getMetaAppId()
      const configId = await getMetaConfigId()
      const appSecret = await getMetaAppSecret()
      return { appId, configId: configId || null, hasSecret: !!appSecret }
    } catch {
      return { appId: null, configId: null, hasSecret: false }
    }
  })

  // POST /api/meta/connect-with-token — Recebe access token (BISU ou user), busca paginas
  app.post('/api/meta/connect-with-token', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const { userAccessToken } = req.body as any
      if (!userAccessToken) return reply.code(400).send({ error: 'userAccessToken obrigatorio' })

      // Buscar paginas do usuario/BISU com o token
      const pagesResp = await metaFetch('/me/accounts?fields=id,name,access_token,category&limit=100', userAccessToken)
      const pages = (pagesResp.data || []).map((p: any) => ({
        id: p.id,
        name: p.name,
        accessToken: p.access_token,
        category: p.category,
      }))

      if (pages.length === 0) {
        return reply.code(400).send({ error: 'Nenhuma pagina encontrada. Verifique as permissoes.' })
      }

      // Salvar token temporariamente
      await prisma.setting.upsert({
        where: { key: 'meta.oauth_pending' },
        update: { value: JSON.stringify({ userToken: userAccessToken, pages, ts: Date.now() }) },
        create: { key: 'meta.oauth_pending', value: JSON.stringify({ userToken: userAccessToken, pages, ts: Date.now() }), label: 'Meta OAuth Pending', grp: 'meta', fieldType: 'json' }
      })

      return { ok: true, pages }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // GET /api/meta/oauth/callback — callback do OAuth clássico por redirect.
  // O Facebook redireciona o navegador (popup) para cá com ?code&state.
  // Sem authMiddleware: é o browser do Facebook, não tem sessão do app.
  // Repassa code/state/error para a janela que abriu o popup e fecha.
  app.get('/api/meta/oauth/callback', async (req, reply) => {
    const { code, state, error, error_description } = req.query as any
    const payload = JSON.stringify({
      type: 'meta-oauth',
      code: typeof code === 'string' ? code : null,
      state: typeof state === 'string' ? state : null,
      error: error ? String(error_description || error) : null,
    })
    return reply.type('text/html').send(
      `<!doctype html><meta charset="utf-8"><title>Meta</title><script>` +
        `try{(window.opener||window.parent).postMessage(${payload},'*')}catch(e){}` +
        `window.close();document.body&&(document.body.innerText='Pode fechar esta janela.');` +
        `</script>Pode fechar esta janela.`,
    )
  })

  // POST /api/meta/connect-bisu ��� Fluxo Facebook Login for Business (code exchange)
  app.post('/api/meta/connect-bisu', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const { code, redirectUri } = req.body as any
      if (!code) return reply.code(400).send({ error: 'code obrigatorio' })

      const appId = await getMetaAppId()
      const appSecret = await getMetaAppSecret()
      if (!appSecret) return reply.code(400).send({ error: 'Meta App Secret nao configurado. Va em Configuracoes > Meta Ads.' })

      // Fluxo OAuth clássico por redirect: o code foi obtido pelo diálogo
      // /dialog/oauth com um redirect_uri que NÓS controlamos
      // (${APP_URL}/api/meta/oauth/callback). A troca usa EXATAMENTE esse
      // mesmo redirect_uri — sem isto dá OAuthException 100/36008.
      // Nunca usar metaFetch aqui (anexa &access_token=<2º arg>).
      const codeStr = String(code)
      const redir = typeof redirectUri === 'string' ? redirectUri : ''
      if (!redir) return reply.code(400).send({ error: 'redirectUri obrigatorio' })
      app.log.info(`[Meta connect-bisu] exchange appId=${appId} graph=${META_GRAPH_URL} codeLen=${codeStr.length} codePrefix=${codeStr.slice(0, 12)}… redirect_uri=${redir}`)

      const exUrl = `${META_GRAPH_URL}/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&redirect_uri=${encodeURIComponent(redir)}&code=${encodeURIComponent(code)}`
      const exResp = await fetch(exUrl)
      const tokenResp: any = await exResp.json().catch(() => ({}))
      if (!exResp.ok || !tokenResp.access_token) {
        const e = tokenResp.error || {}
        const detail = [e.message, e.type, e.code != null ? `code ${e.code}` : null, e.error_subcode != null ? `subcode ${e.error_subcode}` : null, e.fbtrace_id ? `trace ${e.fbtrace_id}` : null].filter(Boolean).join(' · ')
        app.log.error(`[Meta connect-bisu] FALHA troca code: HTTP ${exResp.status} redirect_uri=${redir} ${detail}`)
        return reply.code(400).send({ error: `Falha ao trocar code por token: ${detail || `HTTP ${exResp.status}`}` })
      }
      app.log.info(`[Meta connect-bisu] troca OK`)

      const accessToken = tokenResp.access_token

      // Verificar tipo do token (BISU tokens nao expiram)
      let tokenInfo: any = {}
      try {
        tokenInfo = await metaFetch(`/debug_token?input_token=${accessToken}`, `${appId}|${appSecret}`)
        tokenInfo = tokenInfo.data || tokenInfo
      } catch {}

      const tokenType = tokenInfo.granular_scopes ? 'bisu' : (tokenInfo.type || 'unknown')
      const expiresAt = tokenInfo.data_access_expires_at || tokenInfo.expires_at || 0

      app.log.info(`[Meta] Token recebido: tipo=${tokenType}, expira=${expiresAt ? new Date(expiresAt * 1000).toISOString() : 'never'}`)

      // Buscar paginas com o token BISU
      const pagesResp = await metaFetch('/me/accounts?fields=id,name,access_token,category&limit=100', accessToken)
      const pages = (pagesResp.data || []).map((p: any) => ({
        id: p.id,
        name: p.name,
        accessToken: p.access_token,
        category: p.category,
      }))

      if (pages.length === 0) {
        return reply.code(400).send({ error: 'Nenhuma pagina encontrada. O cliente precisa selecionar ao menos uma pagina no dialog do Facebook.' })
      }

      // Salvar temporariamente
      await prisma.setting.upsert({
        where: { key: 'meta.oauth_pending' },
        update: { value: JSON.stringify({ userToken: accessToken, pages, tokenType, expiresAt, ts: Date.now() }) },
        create: { key: 'meta.oauth_pending', value: JSON.stringify({ userToken: accessToken, pages, tokenType, expiresAt, ts: Date.now() }), label: 'Meta OAuth Pending', grp: 'meta', fieldType: 'json' }
      })

      return { ok: true, pages, tokenType }
    } catch (err: any) {
      app.log.error(`[Meta] BISU connect error: ${err.message}`)
      return reply.code(500).send({ error: err.message })
    }
  })

  // POST /api/meta/select-page — Selecionar pagina e ativar integracao
  app.post('/api/meta/select-page', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const { pageId } = req.body as any
      if (!pageId) return reply.code(400).send({ error: 'pageId obrigatorio' })

      const setting = await prisma.setting.findUnique({ where: { key: 'meta.oauth_pending' } })
      if (!setting) return reply.code(404).send({ error: 'Faca login no Facebook primeiro' })

      const data = typeof setting.value === 'string' ? JSON.parse(setting.value) : setting.value as any
      const page = (data.pages || []).find((p: any) => p.id === String(pageId))
      if (!page) return reply.code(404).send({ error: 'Pagina nao encontrada' })

      const { randomBytes } = await import('crypto')
      const webhookSecret = randomBytes(16).toString('hex')
      let appId = ''
      try { appId = await getMetaAppId() } catch {}

      // Token BISU já é permanente; para tokens normais, trocar para longa duração
      const isBisu = data.tokenType === 'bisu'
      let finalPageToken = page.accessToken
      let finalUserToken = data.userToken

      if (!isBisu) {
        finalUserToken = await exchangeLongLivedToken(data.userToken)
        finalPageToken = await exchangeLongLivedPageToken(finalUserToken, page.id)
      }

      app.log.info(`[Meta] Conectando page ${page.id} (${page.name}) — token tipo: ${isBisu ? 'BISU (permanente)' : 'long-lived'}`)

      // Preservar leadsReceived se já existia
      const existing = await prisma.metaIntegration.findUnique({ where: { pageId: String(page.id) } })
      const prevLeads = existing?.leadsReceived || 0

      const integration = await prisma.metaIntegration.upsert({
        where: { pageId: String(page.id) },
        update: { pageName: page.name, pageAccessToken: finalPageToken, userAccessToken: finalUserToken, appId, webhookSecret, active: true, metadata: { tokenType: isBisu ? 'bisu' : 'long_lived', connectedAt: new Date().toISOString(), reconnectedAt: new Date().toISOString() } },
        create: { pageId: String(page.id), pageName: page.name, pageAccessToken: finalPageToken, userAccessToken: finalUserToken, appId, webhookSecret, active: true, leadsReceived: prevLeads, metadata: { tokenType: isBisu ? 'bisu' : 'long_lived', connectedAt: new Date().toISOString() } }
      })

      // Inscrever webhook automaticamente
      let webhookSubscribed = false
      try {
        await metaFetch(`/${page.id}/subscribed_apps?subscribed_fields=leadgen`, finalPageToken, 'POST')
        webhookSubscribed = true
      } catch (subErr: any) {
        app.log.warn(`[Meta] Webhook auto-subscribe failed: ${subErr.message}`)
      }

      // Sincronizar formularios (preservando contadores historicos)
      let formCount = 0
      try {
        const formsData = await metaFetch(`/${page.id}/leadgen_forms?fields=id,name,status,leads_count,created_time,questions`, finalPageToken)
        for (const f of (formsData.data || [])) {
          // Contar leads reais a partir da tabela Lead (fonte da verdade);
          // metaLeadLog pode estar truncado em imports/snapshots e divergir.
          const realCount = await prisma.lead.count({
            where: { source: 'meta_lead_ads', metaFormId: String(f.id) }
          })
          const lastLog = await prisma.lead.findFirst({
            where: { source: 'meta_lead_ads', metaFormId: String(f.id) },
            orderBy: { createdAt: 'desc' },
            select: { createdAt: true }
          })

          // Check if this form existed before (possibly under another integrationId) to preserve mapping
          const prevForm = await prisma.metaForm.findFirst({ where: { formId: String(f.id) }, select: { fieldMapping: true, funnelId: true, stageKey: true, autoComplete: true } })

          await prisma.metaForm.upsert({
            where: { integrationId_formId: { integrationId: integration.id, formId: String(f.id) } },
            update: { formName: f.name || f.id, leadsReceived: realCount, lastLeadAt: lastLog?.createdAt || undefined, metadata: { questions: f.questions, status: f.status, leads_count: f.leads_count } },
            create: {
              integrationId: integration.id, formId: String(f.id), formName: f.name || f.id,
              leadsReceived: realCount, lastLeadAt: lastLog?.createdAt || null,
              fieldMapping: prevForm?.fieldMapping || undefined,
              funnelId: prevForm?.funnelId || undefined,
              stageKey: prevForm?.stageKey || 'NOVO',
              autoComplete: prevForm?.autoComplete || false,
              metadata: { questions: f.questions, status: f.status, leads_count: f.leads_count }
            }
          })
          formCount++
        }
      } catch {}

      await prisma.setting.delete({ where: { key: 'meta.oauth_pending' } }).catch(() => {})

      return {
        ok: true,
        integration: { id: integration.id, pageId: integration.pageId, pageName: integration.pageName },
        webhookSubscribed, formsSync: formCount,
        tokenType: isBisu ? 'bisu (permanente)' : 'long_lived',
      }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // ══════════════════════════════════════════════════════
  //  DEBUG — Verificar paginas e permissoes do token
  // ══════════════════════════════════════════════════════

  // GET /api/meta/debug — Mostra todas as paginas, permissoes e info do token atual
  app.get('/api/meta/debug', { preHandler: authMiddleware }, async (req, reply) => {
    const results: any = { integrations: [], tokenTests: [] }

    try {
      // 1. Verificar integrações existentes
      const integrations = await prisma.metaIntegration.findMany()
      results.integrations = integrations.map(i => ({ id: i.id, pageId: i.pageId, pageName: i.pageName, active: i.active }))

      // 2. Para cada integração, testar o token e listar paginas disponíveis
      for (const integ of integrations) {
        const test: any = { pageId: integ.pageId, pageName: integ.pageName }

        // Debug do token
        try {
          const appId = await getMetaAppId()
          const appSecret = await getMetaAppSecret()
          if (appSecret) {
            const debugResp = await metaFetch(`/debug_token?input_token=${integ.pageAccessToken}`, `${appId}|${appSecret}`)
            test.tokenDebug = debugResp.data || debugResp
          } else {
            test.tokenDebug = 'APP_SECRET vazio — nao eh possivel debugar token'
          }
        } catch (err: any) {
          test.tokenDebug = `Erro: ${err.message}`
        }

        // Listar TODAS as paginas acessíveis com o userAccessToken
        if (integ.userAccessToken) {
          try {
            const pagesResp = await metaFetch('/me/accounts?fields=id,name,category,access_token&limit=100', integ.userAccessToken)
            test.allPages = (pagesResp.data || []).map((p: any) => ({ id: p.id, name: p.name, category: p.category, hasToken: !!p.access_token }))
            test.totalPages = test.allPages.length
          } catch (err: any) {
            test.allPages = `Erro: ${err.message}`
          }

          // Verificar permissoes do token
          try {
            const permsResp = await metaFetch('/me/permissions', integ.userAccessToken)
            test.permissions = (permsResp.data || [])
          } catch (err: any) {
            test.permissions = `Erro: ${err.message}`
          }
        } else {
          test.allPages = 'Sem userAccessToken salvo — nao eh possivel listar paginas'
        }

        results.tokenTests.push(test)
      }

      // 3. Config atual
      results.config = {
        META_APP_ID: process.env.META_APP_ID ? '***' + process.env.META_APP_ID.slice(-4) : 'nao definido',
        META_APP_SECRET: process.env.META_APP_SECRET ? 'definido' : 'VAZIO',
        META_CONFIG_ID: process.env.META_CONFIG_ID || 'nao definido',
      }

    } catch (err: any) {
      results.error = err.message
    }

    return results
  })

  // ══════════════════════════════════════════════════════
  //  CONFIGURAÇÃO — Status, gerenciar integracao
  // ══════════════════════════════════════════════════════

  // GET /api/meta/status — Status da integracao (com verificação de token)
  app.get('/api/meta/status', { preHandler: authMiddleware }, async (req, reply) => {
    const integrations = await prisma.metaIntegration.findMany({
      include: { forms: { select: { id: true, formId: true, formName: true, status: true, funnelId: true, stageKey: true, defaultTeamId: true, leadsReceived: true, lastLeadAt: true, fieldMapping: true, metadata: true } } }
    })

    // Verificar saúde do token e contar leads reais para cada integração
    const results = await Promise.all(integrations.map(async (integ) => {
      let tokenStatus = 'unknown'
      let tokenError = ''
      try {
        await metaFetch(`/${integ.pageId}?fields=id`, integ.pageAccessToken)
        tokenStatus = 'valid'
      } catch (err: any) {
        tokenStatus = 'expired'
        tokenError = err.message
      }

      // Contar leads reais do log (sobrevive a reconexões)
      const realLeadsCount = await prisma.metaLeadLog.count({
        where: { metaPageId: integ.pageId, status: 'processed' }
      })

      // Contar leads reais por formulário
      const formsWithRealCount = await Promise.all((integ.forms || []).map(async (form) => {
        const formLeadsCount = await prisma.metaLeadLog.count({
          where: { metaFormId: form.formId, status: 'processed' }
        })
        const lastLog = await prisma.metaLeadLog.findFirst({
          where: { metaFormId: form.formId, status: 'processed' },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true }
        })
        return {
          ...form,
          leadsReceived: formLeadsCount,
          lastLeadAt: lastLog?.createdAt || form.lastLeadAt
        }
      }))

      const meta = (integ.metadata || {}) as any
      return {
        ...integ,
        leadsReceived: realLeadsCount,
        forms: formsWithRealCount,
        tokenStatus, tokenError, tokenType: meta.tokenType || 'unknown'
      }
    }))

    return { integrations: results, pollerActive: !!metaPollTimer }
  })

  // POST /api/meta/connect — Conectar pagina Facebook
  app.post('/api/meta/connect', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const { pageId, pageAccessToken, pageName, appId, userAccessToken } = req.body as any

      if (!pageId || !pageAccessToken) {
        return reply.code(400).send({ error: 'pageId e pageAccessToken sao obrigatorios' })
      }

      // Validar token fazendo uma chamada de teste
      let resolvedPageName = pageName || ''
      try {
        const pageInfo = await metaFetch(`/${pageId}?fields=name,id`, pageAccessToken)
        resolvedPageName = pageInfo.name || pageName || pageId
      } catch (err: any) {
        return reply.code(400).send({ error: `Token invalido ou sem permissao: ${err.message}` })
      }

      // Trocar para token de longa duração (60 dias)
      let longPageToken = pageAccessToken
      if (userAccessToken) {
        const longUserToken = await exchangeLongLivedToken(userAccessToken)
        longPageToken = await exchangeLongLivedPageToken(longUserToken, pageId)
      }

      // Gerar verify token unico
      const { randomBytes } = await import('crypto')
      const webhookSecret = randomBytes(16).toString('hex')

      const integration = await prisma.metaIntegration.upsert({
        where: { pageId: String(pageId) },
        update: {
          pageName: resolvedPageName,
          pageAccessToken: longPageToken,
          userAccessToken: userAccessToken || null,
          appId: appId || null,
          webhookSecret,
          active: true,
        },
        create: {
          pageId: String(pageId),
          pageName: resolvedPageName,
          pageAccessToken: longPageToken,
          userAccessToken: userAccessToken || null,
          appId: appId || null,
          webhookSecret,
          active: true,
        }
      })

      // Inscrever webhook automaticamente
      let webhookSubscribed = false
      try {
        await metaFetch(`/${pageId}/subscribed_apps?subscribed_fields=leadgen`, longPageToken, 'POST')
        webhookSubscribed = true
        app.log.info(`[Meta] Webhook inscrito via connect manual para page ${pageId}`)
      } catch (subErr: any) {
        app.log.warn(`[Meta] Webhook auto-subscribe falhou (connect manual): ${subErr.message}`)
      }

      const webhookUrl = `${process.env.APP_URL || 'https://bychat.ia.br'}/api/meta/webhook`

      return {
        ok: true,
        integration: { id: integration.id, pageId: integration.pageId, pageName: integration.pageName },
        webhookUrl,
        webhookSubscribed,
        verifyToken: webhookSecret,
        instructions: webhookSubscribed
          ? 'Webhook inscrito automaticamente! Leads chegarao em tempo real + polling a cada 5min.'
          : 'Configure o webhook no Meta Developers com a URL e verify token acima. Subscription: leadgen. O polling automatico ja esta ativo como fallback.'
      }
    } catch (err: any) {
      app.log.error(`[Meta] Connect error: ${err.message}`)
      return reply.code(500).send({ error: err.message })
    }
  })

  // DELETE /api/meta/integrations/:id — Desconectar pagina (preserva logs historicos)
  app.delete('/api/meta/integrations/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const intId = parseInt(id)

    // Desassociar forms da integração (mas NÃO apagar metaLeadLog)
    await prisma.metaForm.deleteMany({ where: { integrationId: intId } })
    await prisma.metaIntegration.delete({ where: { id: intId } })
    return { ok: true }
  })

  // POST /api/meta/integrations/:id/toggle — Ativar/desativar
  app.post('/api/meta/integrations/:id/toggle', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const integration = await prisma.metaIntegration.findUnique({ where: { id: parseInt(id) } })
    if (!integration) return reply.code(404).send({ error: 'Integracao nao encontrada' })
    await prisma.metaIntegration.update({ where: { id: parseInt(id) }, data: { active: !integration.active } })
    return { ok: true, active: !integration.active }
  })

  // ══════════════════════════════════════════════════════
  //  FORMULARIOS — Listar e vincular forms
  // ══════════════════════════════════════════════════════

  // POST /api/meta/integrations/:id/sync-forms — Sincronizar formularios da pagina
  app.post('/api/meta/integrations/:id/sync-forms', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const { id } = req.params as any
      const integration = await prisma.metaIntegration.findUnique({ where: { id: parseInt(id) } })
      if (!integration) return reply.code(404).send({ error: 'Integracao nao encontrada' })

      // Buscar forms da pagina via Graph API
      const data = await metaFetch(
        `/${integration.pageId}/leadgen_forms?fields=id,name,status,leads_count,created_time,questions`,
        integration.pageAccessToken
      )

      const forms = data.data || []
      const synced = []

      // Load custom fields for auto-mapping
      const customFields = await prisma.customField.findMany({ where: { active: true } })
      const cfLookup: Record<string, string> = {}
      for (const cf of customFields) {
        cfLookup[cf.key.toLowerCase()] = `cf_${cf.key}`
        cfLookup[cf.label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')] = `cf_${cf.key}`
      }

      const nameP = /^(full_name|first_name|last_name|nome|name)$/i
      const emailP = /^(email|e-mail|email_address)$/i
      const phoneP = /^(phone_number|phone|telefone|whatsapp|celular|mobile)$/i
      const compP = /^(company_name|company|empresa)$/i
      const cityP = /^(city|cidade)$/i

      for (const f of forms) {
        const prevForm = await prisma.metaForm.findFirst({ where: { formId: String(f.id) }, select: { fieldMapping: true, funnelId: true, stageKey: true, autoComplete: true } })

        // Auto-generate mapping if no existing mapping
        let autoMapping: Record<string, string> | undefined = undefined
        if (!prevForm?.fieldMapping && f.questions) {
          autoMapping = {}
          for (const q of f.questions) {
            const key = q.key || q.label || ''
            if (nameP.test(key)) autoMapping[key] = 'nome'
            else if (emailP.test(key)) autoMapping[key] = 'email'
            else if (phoneP.test(key)) autoMapping[key] = 'whatsapp'
            else if (compP.test(key)) autoMapping[key] = 'empresa'
            else if (cityP.test(key)) autoMapping[key] = 'cidade'
            else {
              const nk = key.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
              const nl = (q.label || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
              if (cfLookup[nk]) autoMapping[key] = cfLookup[nk]
              else if (cfLookup[nl]) autoMapping[key] = cfLookup[nl]
              else autoMapping[key] = '_formData'
            }
          }
        }

        const form = await prisma.metaForm.upsert({
          where: { integrationId_formId: { integrationId: integration.id, formId: String(f.id) } },
          update: {
            formName: f.name || f.id,
            ...(autoMapping && !prevForm?.fieldMapping ? { fieldMapping: autoMapping } : {}),
            metadata: { questions: f.questions, status: f.status, leads_count: f.leads_count, created_time: f.created_time },
          },
          create: {
            integrationId: integration.id,
            formId: String(f.id),
            formName: f.name || f.id,
            fieldMapping: prevForm?.fieldMapping || autoMapping || undefined,
            funnelId: prevForm?.funnelId || undefined,
            stageKey: prevForm?.stageKey || 'NOVO',
            autoComplete: prevForm?.autoComplete || false,
            metadata: { questions: f.questions, status: f.status, leads_count: f.leads_count, created_time: f.created_time },
          }
        })
        synced.push(form)
      }

      await prisma.metaIntegration.update({ where: { id: integration.id }, data: { lastSyncAt: new Date() } })

      return { ok: true, forms: synced, total: synced.length }
    } catch (err: any) {
      app.log.error(`[Meta] Sync forms error: ${err.message}`)
      return reply.code(500).send({ error: err.message })
    }
  })

  // PUT /api/meta/forms/:id — Configurar form (vincular a funil, mapeamento)
  app.put('/api/meta/forms/:id', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const { id } = req.params as any
      const body = req.body as any
      const data: any = {}

      if (body.funnelId !== undefined) data.funnelId = body.funnelId
      if (body.stageKey !== undefined) data.stageKey = body.stageKey
      if (body.defaultTeamId !== undefined) data.defaultTeamId = body.defaultTeamId
      if (body.fieldMapping !== undefined) data.fieldMapping = body.fieldMapping
      if (body.autoComplete !== undefined) data.autoComplete = body.autoComplete
      if (body.status !== undefined) data.status = body.status

      const form = await prisma.metaForm.update({ where: { id: parseInt(id) }, data })
      return { ok: true, form }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // GET /api/meta/forms — Listar todos os forms configurados
  app.get('/api/meta/forms', { preHandler: authMiddleware }, async (req, reply) => {
    const forms = await prisma.metaForm.findMany({
      include: { integration: { select: { pageId: true, pageName: true, active: true } } },
      orderBy: { leadsReceived: 'desc' }
    })
    return { forms }
  })

  // POST /api/meta/forms/:id/toggle — Ativar/desativar form individual
  app.post('/api/meta/forms/:id/toggle', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const form = await prisma.metaForm.findUnique({ where: { id: parseInt(id) } })
    if (!form) return reply.code(404).send({ error: 'Form nao encontrado' })
    const newStatus = form.status === 'active' ? 'paused' : 'active'
    await prisma.metaForm.update({ where: { id: parseInt(id) }, data: { status: newStatus } })
    return { ok: true, status: newStatus }
  })

  // POST /api/meta/forms/:id/pull-leads — Puxar leads existentes do form via Graph API
  app.post('/api/meta/forms/:id/pull-leads', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const { id } = req.params as any
      const form = await prisma.metaForm.findUnique({ where: { id: parseInt(id) }, include: { integration: true } })
      if (!form) return reply.code(404).send({ error: 'Form nao encontrado' })
      if (!form.integration.pageAccessToken) return reply.code(400).send({ error: 'Token de acesso nao configurado' })

      // Buscar leads do form via Graph API, paginando até esgotar
      let leadsData: any = await metaFetch(
        `/${form.formId}/leads?fields=id,created_time,field_data,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,platform&limit=100`,
        form.integration.pageAccessToken
      )

      let created = 0, skipped = 0, failed = 0, total = 0
      let pagesFetched = 0

      while (leadsData && Array.isArray(leadsData.data) && leadsData.data.length > 0) {
        total += leadsData.data.length

        for (const leadData of leadsData.data) {
          const metaLeadId = String(leadData.id)

          const existing = await prisma.metaLeadLog.findFirst({ where: { metaLeadId, status: 'processed' } })
          if (existing) { skipped++; continue }

          try {
            const fieldData = leadData.field_data || []
            const fields: Record<string, string> = {}
            for (const fd of fieldData) {
              fields[fd.name] = Array.isArray(fd.values) ? fd.values.join(', ') : String(fd.values || '')
            }

            const campaignData = {
              campaign_id: leadData.campaign_id, campaign_name: leadData.campaign_name,
              adset_id: leadData.adset_id, adset_name: leadData.adset_name,
              ad_id: leadData.ad_id, ad_name: leadData.ad_name,
              platform: leadData.platform, created_time: leadData.created_time,
            }

            const log = await prisma.metaLeadLog.create({
              data: { metaLeadId, metaFormId: form.formId, metaPageId: form.integration.pageId, status: 'received', rawData: fields, campaignData }
            })

            const lead = await createLeadFromMeta(form, fields, { metaLeadId, pageId: form.integration.pageId, campaignData }, app)

            await prisma.metaLeadLog.update({ where: { id: log.id }, data: { status: 'processed', leadId: lead.id, processedAt: new Date() } })
            created++
          } catch (err: any) {
            failed++
            await prisma.metaLeadLog.create({
              data: { metaLeadId, metaFormId: form.formId, metaPageId: form.integration.pageId, status: 'failed', errorMessage: err.message }
            }).catch(() => {})
          }
        }

        pagesFetched++
        const next = leadsData.paging?.next
        if (!next || pagesFetched >= 100) break
        const resp = await fetch(next)
        if (!resp.ok) break
        leadsData = await resp.json()
      }

      if (created > 0) {
        await prisma.metaForm.update({ where: { id: form.id }, data: { leadsReceived: { increment: created }, lastLeadAt: new Date() } })
        await prisma.metaIntegration.update({ where: { id: form.integration.id }, data: { leadsReceived: { increment: created } } })
      }

      return { ok: true, total, created, skipped, failed, pages: pagesFetched }
    } catch (err: any) {
      app.log.error(`[Meta] Pull leads error: ${err.message}`)
      return reply.code(500).send({ error: err.message })
    }
  })

  // POST /api/meta/forms/:id/reprocess — Reprocessar leads existentes com mapeamento atual
  app.post('/api/meta/forms/:id/reprocess', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const { id } = req.params as any
      const form = await prisma.metaForm.findUnique({ where: { id: parseInt(id) } })
      if (!form) return reply.code(404).send({ error: 'Form nao encontrado' })

      const mapping = (form.fieldMapping as Record<string, string>) || DEFAULT_FIELD_MAP

      // Find all processed logs for this form that have rawData
      const logs = await prisma.metaLeadLog.findMany({
        where: { metaFormId: form.formId, status: 'processed', leadId: { not: null } },
        select: { id: true, leadId: true, rawData: true }
      })

      let updated = 0, skipped = 0

      for (const log of logs) {
        if (!log.leadId || !log.rawData) { skipped++; continue }

        const fields = log.rawData as Record<string, string>
        const customFieldValues: Record<string, string> = {}
        const standardUpdates: Record<string, string> = {}

        for (const [metaField, value] of Object.entries(fields)) {
          const leadField = mapping[metaField] || DEFAULT_FIELD_MAP[metaField]
          if (!leadField || leadField === '_ignore' || leadField === '_formData' || !value) continue

          if (leadField.startsWith('cf_')) {
            customFieldValues[leadField.slice(3)] = value
          } else {
            if (standardUpdates[leadField]) standardUpdates[leadField] += ' ' + value
            else standardUpdates[leadField] = value
          }
        }

        if (Object.keys(customFieldValues).length === 0 && Object.keys(standardUpdates).length === 0) {
          skipped++; continue
        }

        // Get current lead to merge custom fields
        const lead = await prisma.lead.findUnique({ where: { id: log.leadId }, select: { customFields: true, nome: true, empresa: true, email: true, whatsapp: true, segmento: true, cidade: true } })
        if (!lead) { skipped++; continue }

        const updateData: any = {}

        // Merge custom fields
        if (Object.keys(customFieldValues).length > 0) {
          updateData.customFields = { ...((lead.customFields as any) || {}), ...customFieldValues }
        }

        // Fill empty standard fields only (don't overwrite existing data)
        if (standardUpdates.nome && !lead.nome) updateData.nome = standardUpdates.nome
        if (standardUpdates.empresa && !lead.empresa) updateData.empresa = standardUpdates.empresa
        if (standardUpdates.email && !lead.email) updateData.email = standardUpdates.email
        if (standardUpdates.whatsapp && !lead.whatsapp) updateData.whatsapp = standardUpdates.whatsapp
        if (standardUpdates.segmento && !lead.segmento) updateData.segmento = standardUpdates.segmento
        if (standardUpdates.cidade && !lead.cidade) updateData.cidade = standardUpdates.cidade

        if (Object.keys(updateData).length === 0) { skipped++; continue }

        await prisma.lead.update({ where: { id: log.leadId }, data: updateData })
        updated++
      }

      return { ok: true, total: logs.length, updated, skipped }
    } catch (err: any) {
      app.log.error(`[Meta] Reprocess error: ${err.message}`)
      return reply.code(500).send({ error: err.message })
    }
  })

  // POST /api/meta/forms/:id/update-custom-fields — Preenche SÓ os campos
  // personalizados (cf_*) dos leads já importados, a partir do payload bruto
  // (MetaLeadLog.rawData) e do mapeamento atual. Não toca em campos núcleo.
  // Idempotente: só preenche cf vazio/ausente, nunca sobrescreve valor já
  // existente (preserva edição manual). Útil quando os leads foram puxados
  // antes de o mapeamento de campos personalizados ser feito.
  app.post('/api/meta/forms/:id/update-custom-fields', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const { id } = req.params as any
      const form = await prisma.metaForm.findUnique({ where: { id: parseInt(id) } })
      if (!form) return reply.code(404).send({ error: 'Form nao encontrado' })

      const mapping = (form.fieldMapping as Record<string, string>) || DEFAULT_FIELD_MAP
      const hasCustomTarget = Object.values(mapping).some(
        (v) => typeof v === 'string' && v.startsWith('cf_'),
      )
      if (!hasCustomTarget) {
        return { ok: true, total: 0, updated: 0, skipped: 0, message: 'Nenhum campo do Meta está mapeado para campo personalizado.' }
      }

      const logs = await prisma.metaLeadLog.findMany({
        where: { metaFormId: form.formId, status: 'processed', leadId: { not: null } },
        select: { id: true, leadId: true, rawData: true },
      })

      let updated = 0, skipped = 0

      for (const log of logs) {
        if (!log.leadId || !log.rawData) { skipped++; continue }

        const fields = log.rawData as Record<string, string>
        const customFieldValues: Record<string, string> = {}

        for (const [metaField, value] of Object.entries(fields)) {
          const leadField = mapping[metaField] || DEFAULT_FIELD_MAP[metaField]
          if (!leadField || !leadField.startsWith('cf_') || !value) continue
          customFieldValues[leadField.slice(3)] = value
        }

        if (Object.keys(customFieldValues).length === 0) { skipped++; continue }

        const lead = await prisma.lead.findUnique({
          where: { id: log.leadId },
          select: { customFields: true },
        })
        if (!lead) { skipped++; continue }

        const current = (lead.customFields as Record<string, any>) || {}
        const merged: Record<string, any> = { ...current }
        let changed = false
        for (const [k, v] of Object.entries(customFieldValues)) {
          const cur = current[k]
          if (cur === undefined || cur === null || cur === '') {
            merged[k] = v
            changed = true
          }
        }

        if (!changed) { skipped++; continue }

        await prisma.lead.update({ where: { id: log.leadId }, data: { customFields: merged } })
        updated++
      }

      return { ok: true, total: logs.length, updated, skipped }
    } catch (err: any) {
      app.log.error(`[Meta] update-custom-fields error: ${err.message}`)
      return reply.code(500).send({ error: err.message })
    }
  })

  // GET /api/meta/forms/:id/fields — Retorna os campos do form Meta (para mapeamento visual)
  app.get('/api/meta/forms/:id/fields', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const form = await prisma.metaForm.findUnique({ where: { id: parseInt(id) }, include: { integration: true } })
    if (!form) return reply.code(404).send({ error: 'Form nao encontrado' })

    // Campos vem do metadata.questions salvo na sincronizacao
    const meta = (form.metadata || {}) as any
    const questions = meta.questions || []

    const metaFields = questions.map((q: any) => ({
      key: q.key || q.label || '',
      label: (q.label || q.key || '').replace(/_/g, ' '),
      type: q.type || 'CUSTOM',
    }))

    const leadFields = [
      { key: 'nome', label: 'Nome do contato' },
      { key: 'empresa', label: 'Nome da empresa' },
      { key: 'email', label: 'E-mail' },
      { key: 'whatsapp', label: 'WhatsApp / Telefone' },
      { key: 'segmento', label: 'Segmento' },
      { key: 'cidade', label: 'Cidade' },
      { key: '_ignore', label: '(ignorar campo)' },
      { key: '_formData', label: 'Salvar em dados extras (formData)' },
    ]

    // Include custom fields as mapping targets
    const customFields = await prisma.customField.findMany({ where: { active: true }, orderBy: { position: 'asc' } })
    for (const cf of customFields) {
      leadFields.push({ key: `cf_${cf.key}`, label: `Campo: ${cf.label}` })
    }

    // Auto-suggest mapping for unmapped fields
    const currentMapping = (form.fieldMapping as Record<string, string>) || {}
    const autoSuggest: Record<string, string> = {}
    const namePatterns = /^(full_name|first_name|last_name|nome|name|nome_completo)$/i
    const emailPatterns = /^(email|e-mail|email_address|correo)$/i
    const phonePatterns = /^(phone_number|phone|telefone|whatsapp|celular|mobile|tel)$/i
    const companyPatterns = /^(company_name|company|empresa|razao_social|business)$/i
    const cityPatterns = /^(city|cidade|municipio)$/i

    // Build lookup for custom fields by normalized key/label
    const cfLookup: Record<string, string> = {}
    for (const cf of customFields) {
      cfLookup[cf.key.toLowerCase()] = `cf_${cf.key}`
      cfLookup[cf.label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')] = `cf_${cf.key}`
    }

    for (const mf of metaFields) {
      if (currentMapping[mf.key]) continue // already mapped
      if (namePatterns.test(mf.key)) autoSuggest[mf.key] = 'nome'
      else if (emailPatterns.test(mf.key)) autoSuggest[mf.key] = 'email'
      else if (phonePatterns.test(mf.key)) autoSuggest[mf.key] = 'whatsapp'
      else if (companyPatterns.test(mf.key)) autoSuggest[mf.key] = 'empresa'
      else if (cityPatterns.test(mf.key)) autoSuggest[mf.key] = 'cidade'
      else {
        // Try to match with existing custom field by key or label
        const normalizedKey = mf.key.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
        const normalizedLabel = (mf.label || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
        if (cfLookup[normalizedKey]) autoSuggest[mf.key] = cfLookup[normalizedKey]
        else if (cfLookup[normalizedLabel]) autoSuggest[mf.key] = cfLookup[normalizedLabel]
      }
    }

    return { metaFields, leadFields, currentMapping, autoSuggest }
  })

  // ══════════════════════════════════════════════════════
  //  LOGS — Historico de leads recebidos
  // ══════════════════════════════════════════════════════

  // GET /api/meta/logs — Historico de leads processados
  app.get('/api/meta/logs', { preHandler: authMiddleware }, async (req, reply) => {
    const q = req.query as any
    const limit = Math.min(parseInt(q.limit) || 50, 200)
    const offset = parseInt(q.offset) || 0
    const where: any = {}
    if (q.status) where.status = q.status
    if (q.formId) where.metaFormId = q.formId

    const [logs, total] = await Promise.all([
      prisma.metaLeadLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, skip: offset }),
      prisma.metaLeadLog.count({ where })
    ])
    return { logs, total }
  })

  // POST /api/meta/test-lead — Simular recebimento de lead (para testes)
  app.post('/api/meta/test-lead', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const { formId, fields } = req.body as any
      if (!formId) return reply.code(400).send({ error: 'formId obrigatorio' })

      const form = await prisma.metaForm.findFirst({ where: { formId: String(formId) }, include: { integration: true } })
      if (!form) return reply.code(404).send({ error: 'Formulario nao encontrado' })

      // Simular dados de lead
      const testFields = fields || {
        full_name: 'Lead de Teste Meta',
        email: 'teste@meta.com',
        phone_number: '+5562999990000',
        company_name: 'Empresa Teste Meta',
        city: 'Goiania',
      }

      const lead = await createLeadFromMeta(form, testFields, {
        metaLeadId: `test_${Date.now()}`,
        pageId: form.integration.pageId,
        campaignData: { campaign_name: 'Teste Manual', ad_name: 'Teste' },
      }, app)

      return { ok: true, lead: { id: lead.id, empresa: lead.empresa, nome: lead.nome } }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })
}

// ═══════════════════════════════════════════════════════
//  PROCESSAMENTO DE LEAD META (core logic)
// ═══════════════════════════════════════════════════════

async function processMetaLead(metaLeadId: string, metaFormId: string, pageId: string, app: any) {
  // 1. Verificar duplicata
  const existingLog = await prisma.metaLeadLog.findFirst({ where: { metaLeadId, status: 'processed' } })
  if (existingLog) {
    console.log(`[Meta] Lead ${metaLeadId} already processed, skipping`)
    return
  }

  // 2. Criar log de recebimento
  const log = await prisma.metaLeadLog.create({
    data: { metaLeadId, metaFormId, metaPageId: pageId, status: 'received' }
  })

  try {
    // 3. Buscar integracao e form
    const integration = await prisma.metaIntegration.findFirst({
      where: { pageId, active: true }
    })
    if (!integration) throw new Error(`Nenhuma integracao ativa para page ${pageId}`)

    const form = await prisma.metaForm.findFirst({
      where: { formId: metaFormId, integrationId: integration.id },
      include: { integration: true }
    })

    // Se form nao existe no sistema, criar automaticamente
    const resolvedForm = form || await prisma.metaForm.create({
      data: {
        integrationId: integration.id,
        formId: metaFormId,
        formName: `Form ${metaFormId}`,
        status: 'active',
      },
      include: { integration: true }
    })

    // 4. Buscar dados do lead via Graph API
    const leadData = await metaFetch(
      `/${metaLeadId}?fields=id,created_time,field_data,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,form_id,platform`,
      integration.pageAccessToken
    )

    // 5. Extrair campos
    const fieldData = leadData.field_data || []
    const fields: Record<string, string> = {}
    for (const fd of fieldData) {
      fields[fd.name] = Array.isArray(fd.values) ? fd.values.join(', ') : String(fd.values || '')
    }

    // Dados da campanha
    const campaignData = {
      campaign_id: leadData.campaign_id,
      campaign_name: leadData.campaign_name,
      adset_id: leadData.adset_id,
      adset_name: leadData.adset_name,
      ad_id: leadData.ad_id,
      ad_name: leadData.ad_name,
      platform: leadData.platform,
      form_id: leadData.form_id || metaFormId,
      created_time: leadData.created_time,
    }

    // 6. Atualizar log com dados brutos
    await prisma.metaLeadLog.update({
      where: { id: log.id },
      data: { rawData: fields, campaignData }
    })

    // 7. Criar lead no sistema
    const lead = await createLeadFromMeta(resolvedForm, fields, {
      metaLeadId,
      pageId,
      campaignData,
    }, app)

    // 8. Marcar log como processado
    await prisma.metaLeadLog.update({
      where: { id: log.id },
      data: { status: 'processed', leadId: lead.id, processedAt: new Date() }
    })

    // 9. Atualizar contadores
    await prisma.metaForm.update({
      where: { id: resolvedForm.id },
      data: { leadsReceived: { increment: 1 }, lastLeadAt: new Date() }
    })
    await prisma.metaIntegration.update({
      where: { id: integration.id },
      data: { leadsReceived: { increment: 1 }, lastSyncAt: new Date() }
    })

    console.log(`[Meta] Lead #${lead.id} created from Meta lead ${metaLeadId} (form: ${metaFormId})`)
  } catch (err: any) {
    await prisma.metaLeadLog.update({
      where: { id: log.id },
      data: { status: 'failed', errorMessage: err.message }
    })
    throw err
  }
}

// Mapeamento padrao de campos Meta -> Lead
const DEFAULT_FIELD_MAP: Record<string, string> = {
  'full_name': 'nome',
  'first_name': 'nome',
  'last_name': 'nome',
  'email': 'email',
  'phone_number': 'whatsapp',
  'phone': 'whatsapp',
  'company_name': 'empresa',
  'company': 'empresa',
  'city': 'cidade',
  'state': 'cidade',
  'zip_code': 'cidade',
  'job_title': 'segmento',
  'street_address': 'cidade',
}

async function createLeadFromMeta(
  form: any,
  fields: Record<string, string>,
  meta: { metaLeadId: string; pageId: string; campaignData: any },
  app: any
) {
  // Aplicar mapeamento (custom ou default)
  const mapping = (form.fieldMapping as Record<string, string>) || DEFAULT_FIELD_MAP
  const mapped: Record<string, string> = {}
  const extraData: Record<string, string> = {} // campos mapeados para _formData
  const customFieldValues: Record<string, string> = {} // campos cf_*

  for (const [metaField, value] of Object.entries(fields)) {
    const leadField = mapping[metaField] || DEFAULT_FIELD_MAP[metaField]
    if (!leadField || leadField === '_ignore' || !value) continue

    if (leadField === '_formData') {
      extraData[metaField] = value
    } else if (leadField.startsWith('cf_')) {
      customFieldValues[leadField.slice(3)] = value
    } else if (mapped[leadField]) {
      mapped[leadField] += ' ' + value
    } else {
      mapped[leadField] = value
    }
  }

  // Meta é fonte externa não confiável: o usuário pode digitar lixo no form e
  // estourar o limite da coluna, fazendo o INSERT falhar e o poller retentar o
  // mesmo lead pra sempre (incidente vantari: phone com 33 chars > VarChar(30)).
  // Saneia o telefone (mantém + e dígitos, E.164) e trunca os campos núcleo.
  if (mapped.whatsapp) mapped.whatsapp = mapped.whatsapp.replace(/[^\d+]/g, '').slice(0, 30)
  if (mapped.nome) mapped.nome = mapped.nome.slice(0, 191)
  if (mapped.empresa) mapped.empresa = mapped.empresa.slice(0, 191)
  if (mapped.email) mapped.email = mapped.email.slice(0, 191)
  if (mapped.segmento) mapped.segmento = mapped.segmento.slice(0, 100)
  if (mapped.cidade) mapped.cidade = mapped.cidade.slice(0, 100)

  const cd = meta.campaignData || {}

  // Determinar funil e etapa (usar funil configurado ou funil padrao do sistema)
  let funnelId = form.funnelId || undefined
  if (!funnelId) {
    const defaultFunnel = await prisma.funnel.findFirst({ where: { isDefault: true, active: true } })
    if (defaultFunnel) funnelId = defaultFunnel.id
  }
  const stageKey = form.stageKey || 'NOVO'

  // Fase 24 (Categoria A): SEMPRE cria lead novo. flagDuplicate é chamado depois
  // pra sinalizar match com lead existente — operador resolve em /app/leads/duplicates.

  // Roteamento: form.defaultTeamId (rota explícita) > RoutingRule (F4) > cascata.
  // Campanha/conjunto/anúncio do Meta entram como utm equivalentes para regras.
  let routedTeamId: number | null = form.defaultTeamId ?? null
  let routedUserId: number | null = null
  let routedRuleId: number | null = null
  if (routedTeamId) {
    routedUserId = await pickOperatorForTeam(routedTeamId)
  } else {
    const decision = await resolveRoutingFromContext({
      source: 'meta',
      formId: form.id,
      utmSource: 'facebook',
      utmMedium: 'paid',
      utmCampaign: cd.campaign_name || null,
      utmContent: cd.ad_name || null,
      utmTerm: cd.adset_name || null,
    })
    routedTeamId = decision.teamId
    routedUserId = decision.userId
    routedRuleId = decision.ruleId
  }
  // Data real do submit no Meta (cd.created_time vem em ISO 8601). Se ausente
  // ou inválida, cai pra now() — evita lead "sem data" mas preserva a verdade
  // histórica em pulls retroativos (sem isso, todos os leads importados em
  // bulk recebem createdAt = momento do import, distorcendo relatórios de ROI).
  const submitTime = (() => {
    if (!cd.created_time) return null
    const d = new Date(cd.created_time)
    return Number.isNaN(d.getTime()) ? null : d
  })()
  const lead = await prisma.lead.create({
    data: {
      uid: await generateUid(),
      ...(submitTime ? { createdAt: submitTime } : {}),
      empresa: mapped.empresa || mapped.nome || 'Lead Meta',
      nome: mapped.nome || '',
      whatsapp: mapped.whatsapp || '',
      email: mapped.email || '',
      segmento: mapped.segmento || null,
      cidade: mapped.cidade || null,
      formData: {
        _source: 'meta_lead_ads',
        ...extraData,
        _metaFields: fields,
        _metaCampaign: cd,
        _metaLeadId: meta.metaLeadId,
        _metaFormId: form.formId,
        _metaFormName: form.formName,
      },
      scores: {},
      customFields: Object.keys(customFieldValues).length > 0 ? customFieldValues : undefined,
      status: stageKey,
      teamId: routedTeamId,
      assignedUserId: routedUserId,
      assignedAt: routedUserId ? new Date() : null,
      ...(funnelId ? { funnelId } : {}),
      completed: form.autoComplete || false,
      source: 'meta_lead_ads',
      sourceId: meta.metaLeadId,
      campaignId: cd.campaign_id || null,
      campaignName: cd.campaign_name || null,
      adsetId: cd.adset_id || null,
      adsetName: cd.adset_name || null,
      adId: cd.ad_id || null,
      adName: cd.ad_name || null,
      metaFormId: form.formId,
      metaPageId: meta.pageId,
      utmSource: 'facebook',
      utmMedium: 'paid',
      utmCampaign: cd.campaign_name || null,
      originType: 'meta_lead_ads',
      lgpdConsent: true,
      lgpdConsentAt: new Date(),
      enrichmentStatus: 'pending',
      qualifiedAt: new Date(),
      qualificationSource: 'meta_lead_ads',
    }
  })

  // Consentimento LGPD implícito: ao submeter um Meta Lead Form, o usuário aceitou
  // a política de privacidade do Facebook Lead Ads, que autoriza o anunciante a
  // processar os dados (inclui enriquecimento com fontes públicas).
  logEvent({
    leadId: lead.id,
    type: 'lgpd_consent',
    category: 'system',
    title: 'Consentimento LGPD implícito (Meta Lead Ads)',
    channel: 'system',
    source: 'meta_lead_ads',
    actorType: 'integration',
    description: 'Lead aceitou política de privacidade ao submeter o formulário Meta',
  })

  // Enfileira enriquecimento (LinkedIn, email discovery, CNPJ, sócios...)
  try {
    await queues.enrichment.add('enrich', { leadId: lead.id }, {
      attempts: 2,
      backoff: { type: 'exponential', delay: 5000 },
    })
  } catch (err) {
    console.error('[meta] falha ao enfileirar enriquecimento:', err)
  }

  // Log de historico
  logEvent({
    leadId: lead.id,
    type: 'lead_created',
    category: 'integration',
    title: 'Lead criado via Meta Lead Ads',
    channel: 'meta_lead_ads',
    source: 'webhook',
    actorType: 'integration',
    description: `Lead "${lead.empresa}" recebido do formulario "${form.formName}"${cd.campaign_name ? ` (Campanha: ${cd.campaign_name})` : ''}`,
    metadata: {
      metaLeadId: meta.metaLeadId,
      formId: form.formId,
      formName: form.formName,
      campaignName: cd.campaign_name,
      adName: cd.ad_name,
      platform: cd.platform,
      fields: Object.keys(fields),
    },
  })

  if (routedRuleId) {
    logEvent({
      leadId: lead.id,
      type: EVENT_TYPES.ROUTING_RULE_MATCHED,
      category: 'lifecycle',
      title: `Regra de roteamento aplicada (#${routedRuleId})`,
      actorType: 'system',
      metadata: { ruleId: routedRuleId, teamId: routedTeamId, userId: routedUserId },
    })
  }

  // Fase 24: detecta possível duplicado (best-effort, não bloqueia o flow)
  flagDuplicate({ newLeadId: lead.id, channel: 'metaLeadAds' }).catch((e) => {
    console.error('[Meta] flagDuplicate error:', (e as any).message)
  })

  // Notificar admin
  notifyNewLead(lead).catch(err => {
    console.error('[Meta] Notify error:', err.message)
  })

  return lead
}
