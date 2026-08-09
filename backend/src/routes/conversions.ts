// src/routes/conversions.ts
// Rotas para Conversions API (Meta CAPI) + Google Ads Offline Conversions

import { FastifyInstance } from 'fastify'
import crypto from 'crypto'
import { prisma } from '../lib/prisma.js'
import { authMiddleware, adminOnly } from '../lib/auth.js'
import { resolvePeriod } from '../lib/period.js'
import { getCapiConfig, getStageEventMappings, sendCapiEvent, retryFailedEvents } from '../services/metaCapi.js'
import { sendLeadQualityFeedback, type LeadQuality } from '../services/metaLeadQualityFeedback.js'
import { getAttributionReport, getLeadJourney } from '../services/attribution.js'

const sha256 = (v: string) => crypto.createHash('sha256').update(v.trim().toLowerCase()).digest('hex')

export async function conversionsRoutes(app: FastifyInstance) {

  // ═══════════════════════════════════════════════
  // META CAPI — Configuração
  // ═══════════════════════════════════════════════

  // GET /api/admin/conversions/capi/config — Ler configuração atual
  app.get('/api/admin/conversions/capi/config', { preHandler: adminOnly }, async () => {
    // Lê cada setting direto pra que a UI mostre estado parcial — getCapiConfig()
    // só retorna preenchido quando pixelId E accessToken existem (precondição do
    // envio), o que escondia o que o usuário acabou de salvar.
    const [pixelSetting, tokenSetting, testCodeSetting, autoSendRow] = await Promise.all([
      prisma.setting.findUnique({ where: { key: 'capi.pixel_id' } }),
      prisma.setting.findUnique({ where: { key: 'capi.access_token' } }),
      prisma.setting.findUnique({ where: { key: 'capi.test_event_code' } }),
      prisma.setting.findUnique({ where: { key: 'capi.auto_send_on_lead_won' } }),
    ])
    const unwrap = (v: unknown): string =>
      typeof v === 'string' ? v.replace(/^"|"$/g, '') : v == null ? '' : String(v).replace(/^"|"$/g, '')
    const pixelId = pixelSetting?.value ? unwrap(pixelSetting.value) : ''
    const accessToken = tokenSetting?.value ? unwrap(tokenSetting.value) : ''
    const testEventCode = testCodeSetting?.value ? unwrap(testCodeSetting.value) : ''
    const autoSendOnLeadWon = autoSendRow?.value
      ? unwrap(autoSendRow.value).trim().toLowerCase() === 'true'
      : false

    const mappings = await getStageEventMappings()

    // Buscar etapas disponíveis para mapeamento
    const funnels = await prisma.funnel.findMany({
      where: { active: true },
      include: { stages: { orderBy: { position: 'asc' } } }
    })

    return {
      configured: !!pixelId && !!accessToken,
      pixelId,
      hasToken: !!accessToken,
      testEventCode,
      stageMappings: mappings,
      autoSendOnLeadWon,
      funnels: funnels.map(f => ({
        id: f.id,
        name: f.name,
        stages: f.stages.map(s => ({ key: s.key, name: s.name }))
      })),
    }
  })

  // PUT /api/admin/conversions/capi/config — Salvar configuração (parcial)
  // Só atualiza os campos que vierem explicitamente no body. Assim, salvar a aba
  // Configuração não apaga o mapeamento de etapas (e vice-versa).
  app.put('/api/admin/conversions/capi/config', { preHandler: adminOnly }, async (req) => {
    const body = req.body as any
    const settings: Array<{ key: string; value: string }> = []

    if (body.pixelId !== undefined) settings.push({ key: 'capi.pixel_id', value: String(body.pixelId || '') })
    // accessToken: só atualiza se veio com valor não-vazio (pra preservar token ao salvar outros campos)
    if (typeof body.accessToken === 'string' && body.accessToken.trim()) {
      settings.push({ key: 'capi.access_token', value: body.accessToken.trim() })
    }
    if (body.testEventCode !== undefined) settings.push({ key: 'capi.test_event_code', value: String(body.testEventCode || '') })
    if (body.stageMappings !== undefined) settings.push({ key: 'capi.stage_mappings', value: JSON.stringify(body.stageMappings || {}) })
    if (body.autoSendOnLeadWon !== undefined) settings.push({ key: 'capi.auto_send_on_lead_won', value: body.autoSendOnLeadWon ? 'true' : 'false' })

    for (const s of settings) {
      await prisma.setting.upsert({
        where: { key: s.key },
        create: { key: s.key, value: s.value, grp: 'conversions', label: s.key },
        update: { value: s.value },
      })
    }

    return { ok: true }
  })

  // POST /api/admin/conversions/capi/test — Enviar evento de teste
  app.post('/api/admin/conversions/capi/test', { preHandler: adminOnly }, async (req) => {
    const config = await getCapiConfig()
    if (!config) return { ok: false, error: 'CAPI não configurado' }

    // Meta exige uma combinação de identificadores fortes em user_data — só `country`
    // é considerado "ampla demais" e gera erro 2804050. Pra um teste de configuração,
    // mandamos: external_id (sha256 de um marker), email/phone fake, IP e user-agent
    // do request, e um fbp sintético — combinação suficiente pra Meta aceitar.
    const ip = (req.ip || req.headers['x-forwarded-for'] as string || '127.0.0.1').toString().split(',')[0]?.trim()
    const ua = String(req.headers['user-agent'] || 'BeyondHub/CAPI-Test')
    const fbp = `fb.1.${Date.now()}.${Math.floor(Math.random() * 1e10)}`

    // Enviar evento PageView de teste
    const payload = {
      data: [{
        event_name: 'PageView',
        event_time: Math.floor(Date.now() / 1000),
        event_id: `test_${Date.now()}`,
        action_source: 'system_generated',
        user_data: {
          em: [sha256('test+capi@beyondhub.test')],
          ph: [sha256('5511999990000')],
          external_id: [sha256(`capi-test-${config.pixelId}`)],
          country: [sha256('br')],
          fbp,
          ...(ip ? { client_ip_address: ip } : {}),
          ...(ua ? { client_user_agent: ua } : {}),
        },
      }],
      ...(config.testEventCode ? { test_event_code: config.testEventCode } : {}),
    }

    try {
      const url = `https://graph.facebook.com/v19.0/${config.pixelId}/events?access_token=${config.accessToken}`
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const result = await resp.json() as any
      if (!resp.ok || result?.error) {
        // Extrai mensagem real do Meta pra UI ter algo útil
        const fbErr = result?.error
        const msg = fbErr
          ? `${fbErr.message || 'erro'}${fbErr.code ? ` (code ${fbErr.code}` + (fbErr.error_subcode ? `/${fbErr.error_subcode}` : '') + ')' : ''}${fbErr.error_user_msg ? ` — ${fbErr.error_user_msg}` : ''}`
          : `HTTP ${resp.status}`
        console.error('[CAPI test] Meta retornou erro:', JSON.stringify(result))
        return { ok: false, error: msg, response: result }
      }
      return { ok: true, response: result }
    } catch (err: any) {
      console.error('[CAPI test] exceção no fetch:', err)
      return { ok: false, error: `Falha de conexão: ${err.message || err}` }
    }
  })

  // POST /api/admin/conversions/capi/send — Enviar evento manual
  app.post('/api/admin/conversions/capi/send', { preHandler: adminOnly }, async (req) => {
    const body = req.body as any
    if (!body.leadId || !body.eventName) {
      return { ok: false, error: 'leadId e eventName obrigatórios' }
    }

    const result = await sendCapiEvent({
      leadId: body.leadId,
      eventName: body.eventName,
      value: body.value || undefined,
      funnelStage: body.funnelStage || undefined,
    })

    return { ok: result.success, eventId: result.eventId, error: result.error }
  })

  // POST /api/admin/conversions/capi/retry — Reenviar eventos falhados
  app.post('/api/admin/conversions/capi/retry', { preHandler: adminOnly }, async () => {
    const count = await retryFailedEvents()
    return { ok: true, retried: count }
  })

  // ═══════════════════════════════════════════════
  // LOG DE EVENTOS — Dashboard unificado
  // ═══════════════════════════════════════════════

  // GET /api/admin/conversions/events — Listar eventos enviados
  app.get('/api/admin/conversions/events', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const page = parseInt(q.page) || 1
    const limit = Math.min(parseInt(q.limit) || 50, 200)
    const platform = q.platform || undefined
    const status = q.status || undefined
    const { from: since, to: until } = resolvePeriod(q, 30)

    const where: any = { createdAt: { gte: since, lte: until } }
    if (platform) where.platform = platform
    if (status) where.status = status

    const [events, total] = await Promise.all([
      prisma.conversionEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.conversionEvent.count({ where }),
    ])

    return { events, total, page, limit }
  })

  // GET /api/admin/conversions/stats — Métricas de conversões
  app.get('/api/admin/conversions/stats', { preHandler: authMiddleware }, async (req) => {
    const { from: since, to: until } = resolvePeriod(req.query, 30)
    const period = { gte: since, lte: until }

    const [total, sent, failed, pending, byEvent, byDay] = await Promise.all([
      prisma.conversionEvent.count({ where: { createdAt: period } }),
      prisma.conversionEvent.count({ where: { status: 'sent', createdAt: period } }),
      prisma.conversionEvent.count({ where: { status: 'failed', createdAt: period } }),
      prisma.conversionEvent.count({ where: { status: 'pending', createdAt: period } }),
      prisma.$queryRaw`
        SELECT eventName, platform, COUNT(*) as count,
               SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
               SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
        FROM bychat_conversion_events
        WHERE createdAt >= ${since} AND createdAt <= ${until}
        GROUP BY eventName, platform
        ORDER BY count DESC
      ` as Promise<any[]>,
      prisma.$queryRaw`
        SELECT DATE(createdAt) as date, COUNT(*) as total,
               SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent
        FROM bychat_conversion_events
        WHERE createdAt >= ${since} AND createdAt <= ${until}
        GROUP BY DATE(createdAt)
        ORDER BY date ASC
      ` as Promise<any[]>,
    ])

    return {
      overview: { total, sent, failed, pending },
      byEvent: (byEvent || []).map((e: any) => ({
        eventName: e.eventName,
        platform: e.platform,
        count: Number(e.count),
        sent: Number(e.sent),
        failed: Number(e.failed),
      })),
      byDay: (byDay || []).map((d: any) => ({
        date: d.date,
        total: Number(d.total),
        sent: Number(d.sent),
      })),
    }
  })

  // ═══════════════════════════════════════════════
  // GOOGLE ADS — Conversões Offline
  // ═══════════════════════════════════════════════

  // GET /api/admin/conversions/google/gclids — Listar leads com GCLID capturado
  app.get('/api/admin/conversions/google/gclids', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const days = parseInt(q.days) || 30
    const since = new Date()
    since.setDate(since.getDate() - days)

    const leads = await prisma.lead.findMany({
      where: {
        gclid: { not: null },
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, nome: true, email: true, whatsapp: true,
        gclid: true, status: true, saleDetected: true, saleValue: true,
        createdAt: true, saleDetectedAt: true,
      }
    })

    const totalWithGclid = leads.length
    const withSale = leads.filter(l => l.saleDetected).length

    return { leads, totalWithGclid, withSale }
  })

  // GET /api/admin/conversions/google/export-csv — Exportar conversões para Google Ads (CSV)
  app.get('/api/admin/conversions/google/export-csv', { preHandler: authMiddleware }, async (req, reply) => {
    const q = req.query as any
    const days = parseInt(q.days) || 90

    const since = new Date()
    since.setDate(since.getDate() - days)

    // Buscar leads com GCLID que tiveram venda detectada
    const leads = await prisma.lead.findMany({
      where: {
        gclid: { not: null },
        saleDetected: true,
        saleDetectedAt: { gte: since },
      },
      orderBy: { saleDetectedAt: 'desc' },
      select: {
        gclid: true, saleValue: true, saleDetectedAt: true, status: true,
      }
    })

    // Formato CSV compatível com Google Ads Offline Conversions
    // https://support.google.com/google-ads/answer/7014069
    const header = 'Parameters:TimeZone=America/Sao_Paulo\nGoogle Click ID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency'
    const rows = leads.map(l => {
      const time = l.saleDetectedAt ? new Date(l.saleDetectedAt).toISOString().replace('T', ' ').replace('Z', '') : ''
      const value = l.saleValue ? Number(l.saleValue) : 0
      return `${l.gclid},Purchase,${time},${value},BRL`
    })

    const csv = header + '\n' + rows.join('\n')

    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="google-ads-conversions-${new Date().toISOString().slice(0, 10)}.csv"`)
      .send(csv)
  })

  // POST /api/admin/conversions/google/send — Enviar conversão individual para registro
  app.post('/api/admin/conversions/google/send', { preHandler: adminOnly }, async (req) => {
    const body = req.body as any
    if (!body.leadId) return { ok: false, error: 'leadId obrigatório' }

    const lead = await prisma.lead.findUnique({
      where: { id: body.leadId },
      select: { id: true, gclid: true, saleValue: true, saleDetectedAt: true, nome: true, email: true, whatsapp: true }
    })
    if (!lead?.gclid) return { ok: false, error: 'Lead sem GCLID' }

    const eventId = `gads_${Date.now()}_${lead.id}`

    await prisma.conversionEvent.create({
      data: {
        leadId: lead.id,
        platform: 'google_ads',
        eventName: body.eventName || 'Purchase',
        eventTime: lead.saleDetectedAt || new Date(),
        value: lead.saleValue || null,
        currency: 'BRL',
        gclid: lead.gclid,
        eventId,
        userEmail: lead.email || null,
        userPhone: lead.whatsapp || null,
        userFirstName: lead.nome?.split(/\s+/)[0] || null,
        status: 'sent', // CSV-based = considerado enviado quando exportado
      }
    })

    return { ok: true, eventId }
  })

  // ═══════════════════════════════════════════════
  // ATRIBUIÇÃO MULTI-TOUCH
  // ═══════════════════════════════════════════════

  // GET /api/admin/conversions/attribution — Relatório de atribuição
  app.get('/api/admin/conversions/attribution', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const days = parseInt(q.days) || 30
    const model = (['first_touch', 'last_touch', 'linear'].includes(q.model) ? q.model : 'linear') as any

    const report = await getAttributionReport(days, model)
    return { model, days, data: report }
  })

  // GET /api/admin/conversions/attribution/lead/:leadId — Jornada de touchpoints do lead
  app.get('/api/admin/conversions/attribution/lead/:leadId', { preHandler: authMiddleware }, async (req) => {
    const { leadId } = req.params as any
    const journey = await getLeadJourney(parseInt(leadId))
    return { leadId: parseInt(leadId), touchpoints: journey }
  })

  // ═══════════════════════════════════════════════
  // META LEAD ADS — Quality Feedback
  // ═══════════════════════════════════════════════

  // GET /api/admin/conversions/lead-quality/config — toggle + stats
  app.get('/api/admin/conversions/lead-quality/config', { preHandler: adminOnly }, async () => {
    const row = await prisma.setting.findUnique({ where: { key: 'meta.lead_quality_feedback_enabled' } })
    const raw = row?.value ? (typeof row.value === 'string' ? row.value : String(row.value)) : ''
    const enabled = raw.replace(/^"|"$/g, '').trim().toLowerCase() === 'true'

    // Stats: contagens por status do feedback nos últimos 30 dias
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const [sent, failed, recent] = await Promise.all([
      prisma.metaLeadLog.count({ where: { status: 'quality_feedback_sent', createdAt: { gte: since } } }),
      prisma.metaLeadLog.count({ where: { status: 'quality_feedback_failed', createdAt: { gte: since } } }),
      prisma.metaLeadLog.findMany({
        where: { status: { in: ['quality_feedback_sent', 'quality_feedback_failed'] } },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, leadId: true, metaLeadId: true, status: true, errorMessage: true, createdAt: true },
      }),
    ])

    return { enabled, stats: { sent, failed }, recent }
  })

  // PUT /api/admin/conversions/lead-quality/config — liga/desliga
  app.put('/api/admin/conversions/lead-quality/config', { preHandler: adminOnly }, async (req) => {
    const body = req.body as any
    if (typeof body.enabled !== 'boolean') return { ok: false, error: 'enabled (boolean) obrigatório' }
    await prisma.setting.upsert({
      where: { key: 'meta.lead_quality_feedback_enabled' },
      create: { key: 'meta.lead_quality_feedback_enabled', value: body.enabled ? 'true' : 'false', grp: 'conversions', label: 'Meta Lead Quality Feedback' },
      update: { value: body.enabled ? 'true' : 'false' },
    })
    return { ok: true, enabled: body.enabled }
  })

  // POST /api/admin/conversions/lead-quality/send — envio manual de feedback
  app.post('/api/admin/conversions/lead-quality/send', { preHandler: adminOnly }, async (req) => {
    const body = req.body as any
    const leadId = Number(body.leadId)
    const quality = String(body.quality || '').toUpperCase() as LeadQuality
    if (!leadId || !['INVALID', 'NOT_INTERESTED', 'INTERESTED', 'CONVERTED'].includes(quality)) {
      return { ok: false, error: 'leadId e quality (INVALID/NOT_INTERESTED/INTERESTED/CONVERTED) obrigatórios' }
    }
    const result = await sendLeadQualityFeedback({ leadId, quality })
    return result
  })
}
