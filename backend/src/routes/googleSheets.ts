import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { adminOnly } from '../lib/auth.js'
import {
  getAuthUrl, exchangeCode, listSpreadsheets, createSpreadsheet,
  listSheetTabs, writeHeaders, listCalendars, isGoogleConfigured,
} from '../lib/google.js'
import { SHEETS_EVENTS, SHEETS_EVENT_LABELS, invalidateGoogleSheetsCache, testGoogleSheetIntegration } from '../services/googleSheetsSync.js'
import { encryptToken } from '../services/cloudApi.js'
import { provisionOperatorIntegrations } from './integrationsGoogle.js'

export async function googleSheetsRoutes(app: FastifyInstance) {

  // Auto-seed: garantir que settings Google existam
  const googleSettings = [
    { key: 'google.client_id', label: 'Google Client ID', fieldType: 'text' },
    { key: 'google.client_secret', label: 'Google Client Secret', fieldType: 'password' },
    { key: 'google.redirect_uri', label: 'Google Redirect URI', fieldType: 'text' },
  ]
  for (const s of googleSettings) {
    await prisma.setting.upsert({
      where: { key: s.key }, update: {},
      create: { key: s.key, value: '', label: s.label, grp: 'google', fieldType: s.fieldType }
    }).catch(() => {})
  }

  // ── Google Config (credentials via admin panel) ───────

  // GET /api/admin/google/config — Check if Google is configured + return masked info
  app.get('/api/admin/google/config', { preHandler: adminOnly }, async () => {
    const configured = await isGoogleConfigured()
    // Return masked client ID so admin knows it's set
    const rows = await prisma.setting.findMany({ where: { grp: 'google' } })
    const config: Record<string, string> = {}
    rows.forEach(r => {
      const val = typeof r.value === 'string' ? r.value : String(r.value)
      config[r.key] = val.replace(/^"|"$/g, '')
    })
    const clientId = process.env.GOOGLE_CLIENT_ID || config['google.client_id'] || ''
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET || config['google.client_secret'] || ''
    // Auto-generate redirect URI
    const appUrl = (process.env.APP_URL || '').replace(/\/$/, '')
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || config['google.redirect_uri'] || (appUrl ? `${appUrl}/api/admin/google/callback` : '')
    return {
      configured,
      clientId: clientId ? clientId.substring(0, 12) + '••••••' : '',
      hasSecret: !!clientSecret,
      redirectUri,
    }
  })

  // PUT /api/admin/google/config — Save Google credentials via admin panel
  app.put('/api/admin/google/config', { preHandler: adminOnly }, async (req, reply) => {
    const body = req.body as any
    const updates: Array<{ key: string; value: string }> = []

    if (body.clientId !== undefined) updates.push({ key: 'google.client_id', value: body.clientId.trim() })
    if (body.clientSecret !== undefined && !body.clientSecret.startsWith('••••••')) {
      updates.push({ key: 'google.client_secret', value: body.clientSecret.trim() })
    }
    // Redirect URI is auto-generated, but allow override
    if (body.redirectUri !== undefined) {
      updates.push({ key: 'google.redirect_uri', value: body.redirectUri.trim() })
    }

    for (const u of updates) {
      await prisma.setting.upsert({
        where: { key: u.key },
        update: { value: u.value },
        create: { key: u.key, value: u.value, label: u.key, grp: 'google', fieldType: 'text' },
      })
    }

    return { ok: true }
  })

  // ── Reset Credentials ─────────────────────────────────

  // POST /api/admin/google/reset-credentials — Remove ALL Google data (credentials, connections, integrations, configs, logs)
  app.post('/api/admin/google/reset-credentials', { preHandler: adminOnly }, async (req, reply) => {
    try {
      // Delete in dependency order (children first)
      await prisma.googleSheetLog.deleteMany({})
      await prisma.calendarSyncLog.deleteMany({})
      await prisma.googleSheetIntegration.deleteMany({})
      await prisma.googleCalendarIntegration.deleteMany({})
      await prisma.googleDriveConfig.deleteMany({})
      await prisma.googleTasksConfig.deleteMany({})
      await prisma.gmailConfig.deleteMany({})
      await prisma.googleAdsConfig.deleteMany({})
      await prisma.gA4Config.deleteMany({})
      await prisma.googleConnection.deleteMany({})

      // Clear OAuth credentials from settings
      await prisma.setting.updateMany({
        where: { grp: 'google' },
        data: { value: '' },
      })

      invalidateGoogleSheetsCache()
      console.log('[Google] All credentials and integrations reset by admin')
      return { ok: true }
    } catch (err: any) {
      console.error('[Google] Reset error:', err)
      return reply.code(500).send({ error: err.message })
    }
  })

  // ── OAuth Flow ────────────────────────────────────────

  // GET /api/admin/google/auth-url — Generate OAuth2 URL
  app.get('/api/admin/google/auth-url', { preHandler: adminOnly }, async (req, reply) => {
    try {
      const url = await getAuthUrl()
      return { url }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // GET /api/admin/google/callback — OAuth2 callback
  // state="user:<id>" → conexão do operador (kind=OPERATOR, vinculada ao user)
  // state vazio       → conexão da empresa (kind=COMPANY)
  app.get('/api/admin/google/callback', async (req, reply) => {
    const { code, error, state } = req.query as any
    if (error) {
      return reply.type('text/html').send(`<script>window.opener.postMessage({type:'google-auth-error',error:'${error}'},'*');window.close()</script>`)
    }
    if (!code) {
      return reply.type('text/html').send(`<script>window.opener.postMessage({type:'google-auth-error',error:'no_code'},'*');window.close()</script>`)
    }

    try {
      const data = await exchangeCode(code)

      const operatorMatch = typeof state === 'string' ? state.match(/^user:(\d+)$/) : null
      const operatorUserId = operatorMatch ? parseInt(operatorMatch[1]) : null
      const kind = operatorUserId ? 'OPERATOR' : 'COMPANY'

      const encAccessToken = encryptToken(data.accessToken)
      const encRefreshToken = data.refreshToken ? encryptToken(data.refreshToken) : undefined
      const conn = await prisma.googleConnection.upsert({
        where: { email: data.email },
        create: {
          email: data.email,
          accessToken: encAccessToken,
          refreshToken: encRefreshToken || '',
          tokenExpiresAt: data.expiresAt,
          scopes: data.scopes,
          kind,
          userId: operatorUserId,
          createdBy: operatorUserId,
        },
        update: {
          accessToken: encAccessToken,
          refreshToken: encRefreshToken || undefined,
          tokenExpiresAt: data.expiresAt,
          scopes: data.scopes,
          active: true,
          // Se já existia, preserva o kind/userId originais (não sobrescreve uma COMPANY pré-existente)
        },
      })

      // Para conexão de operador: garantir kind/userId mesmo em update e auto-provisionar integrações
      if (operatorUserId) {
        if (conn.kind !== 'OPERATOR' || conn.userId !== operatorUserId) {
          await prisma.googleConnection.update({
            where: { id: conn.id },
            data: { kind: 'OPERATOR', userId: operatorUserId },
          })
        }
        await provisionOperatorIntegrations(conn.id, operatorUserId)
      } else {
        // Conexão da empresa: garantir que kind é COMPANY (em caso de re-conexão)
        if (conn.kind !== 'COMPANY') {
          await prisma.googleConnection.update({
            where: { id: conn.id },
            data: { kind: 'COMPANY', userId: null },
          })
        }
      }
      invalidateGoogleSheetsCache()

      return reply.type('text/html').send(`<script>window.opener.postMessage({type:'google-auth-success',email:'${data.email}',kind:'${kind}'},'*');window.close()</script>`)
    } catch (err: any) {
      console.error('[Google] OAuth callback error:', err)
      return reply.type('text/html').send(`<script>window.opener.postMessage({type:'google-auth-error',error:'${err.message?.substring(0, 100)}'},'*');window.close()</script>`)
    }
  })

  // ── Google Connections ────────────────────────────────

  // GET /api/admin/google/connections
  app.get('/api/admin/google/connections', { preHandler: adminOnly }, async () => {
    const connections = await prisma.googleConnection.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, email: true, active: true, scopes: true,
        createdAt: true, updatedAt: true,
        kind: true, userId: true,
      },
    })
    return { data: connections }
  })

  // DELETE /api/admin/google/connections/:id
  app.delete('/api/admin/google/connections/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const conn = await prisma.googleConnection.findUnique({ where: { id: parseInt(id) } })
    if (!conn) return reply.code(404).send({ error: 'Conexao nao encontrada' })
    await prisma.googleConnection.delete({ where: { id: parseInt(id) } })
    invalidateGoogleSheetsCache()
    return { ok: true }
  })

  // ── Spreadsheet helpers ───────────────────────────────

  // GET /api/admin/google/spreadsheets?connectionId=1
  app.get('/api/admin/google/spreadsheets', { preHandler: adminOnly }, async (req, reply) => {
    const { connectionId } = req.query as any
    if (!connectionId) return reply.code(400).send({ error: 'connectionId obrigatorio' })
    try {
      const files = await listSpreadsheets(parseInt(connectionId))
      return { data: files }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // POST /api/admin/google/spreadsheets — Create new spreadsheet
  app.post('/api/admin/google/spreadsheets', { preHandler: adminOnly }, async (req, reply) => {
    const { connectionId, title } = req.body as any
    if (!connectionId || !title) return reply.code(400).send({ error: 'connectionId e title obrigatorios' })
    try {
      const result = await createSpreadsheet(parseInt(connectionId), title)
      return { data: result }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // GET /api/admin/google/spreadsheets/:spreadsheetId/tabs?connectionId=1
  app.get('/api/admin/google/spreadsheets/:spreadsheetId/tabs', { preHandler: adminOnly }, async (req, reply) => {
    const { spreadsheetId } = req.params as any
    const { connectionId } = req.query as any
    if (!connectionId) return reply.code(400).send({ error: 'connectionId obrigatorio' })
    try {
      const tabs = await listSheetTabs(parseInt(connectionId), spreadsheetId)
      return { data: tabs }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // ── Sheet Integrations CRUD ───────────────────────────

  // GET /api/admin/google/sheets/events
  app.get('/api/admin/google/sheets/events', { preHandler: adminOnly }, async () => {
    return { data: SHEETS_EVENTS, labels: SHEETS_EVENT_LABELS }
  })

  // GET /api/admin/google/sheets/fields — Available fields for mapping
  app.get('/api/admin/google/sheets/fields', { preHandler: adminOnly }, async () => {
    const leadFields = [
      { key: 'lead.id', label: 'ID', group: 'lead' },
      { key: 'lead.uid', label: 'Codigo (UID)', group: 'lead' },
      { key: 'lead.nome', label: 'Nome', group: 'lead' },
      { key: 'lead.empresa', label: 'Empresa', group: 'lead' },
      { key: 'lead.whatsapp', label: 'WhatsApp', group: 'lead' },
      { key: 'lead.email', label: 'Email', group: 'lead' },
      { key: 'lead.segmento', label: 'Segmento', group: 'lead' },
      { key: 'lead.cidade', label: 'Cidade', group: 'lead' },
      { key: 'lead.status', label: 'Etapa', group: 'lead' },
      { key: 'lead.source', label: 'Origem', group: 'lead' },
      { key: 'lead.saleDetected', label: 'Venda detectada', group: 'lead' },
      { key: 'lead.saleValue', label: 'Valor da venda', group: 'lead' },
      { key: 'lead.createdAt', label: 'Data de criacao', group: 'lead' },
    ]

    const eventFields = [
      { key: 'event.type', label: 'Tipo do evento', group: 'event' },
      { key: 'event.timestamp', label: 'Data/hora do evento', group: 'event' },
      { key: 'event.payload.oldStage', label: 'Etapa anterior', group: 'event' },
      { key: 'event.payload.newStage', label: 'Nova etapa', group: 'event' },
      { key: 'event.payload.tag', label: 'Tag', group: 'event' },
      { key: 'event.payload.assignedTo', label: 'Atribuido a', group: 'event' },
    ]

    // Load custom fields
    const customFields = await prisma.customField.findMany({
      where: { active: true },
      select: { key: true, label: true },
      orderBy: { position: 'asc' },
    })
    const cfFields = customFields.map(cf => ({
      key: `lead.customFields.${cf.key}`,
      label: cf.label,
      group: 'custom',
    }))

    return { fields: [...leadFields, ...eventFields, ...cfFields] }
  })

  // GET /api/admin/google/sheets — List integrations
  app.get('/api/admin/google/sheets', { preHandler: adminOnly }, async () => {
    const integrations = await prisma.googleSheetIntegration.findMany({
      orderBy: { createdAt: 'desc' },
      include: { connection: { select: { email: true } } },
    })
    return { data: integrations }
  })

  // POST /api/admin/google/sheets — Create integration
  app.post('/api/admin/google/sheets', { preHandler: adminOnly }, async (req, reply) => {
    const body = req.body as any
    if (!body.name || !body.connectionId || !body.spreadsheetId || !body.spreadsheetName) {
      return reply.code(400).send({ error: 'name, connectionId, spreadsheetId e spreadsheetName sao obrigatorios' })
    }

    const events: string[] = body.events || ['*']
    for (const e of events) {
      if (e !== '*' && !SHEETS_EVENTS.includes(e as any)) {
        return reply.code(400).send({ error: `Evento invalido: ${e}` })
      }
    }

    const fieldMapping = body.fieldMapping || [
      { header: 'Nome', source: 'lead.nome' },
      { header: 'Empresa', source: 'lead.empresa' },
      { header: 'WhatsApp', source: 'lead.whatsapp' },
      { header: 'Email', source: 'lead.email' },
      { header: 'Etapa', source: 'lead.status' },
      { header: 'Evento', source: 'event.type' },
    ]

    const user = (req as any).user
    const integration = await prisma.googleSheetIntegration.create({
      data: {
        name: body.name,
        connectionId: parseInt(body.connectionId),
        spreadsheetId: body.spreadsheetId,
        spreadsheetName: body.spreadsheetName,
        sheetName: body.sheetName || 'Sheet1',
        events: events as any,
        fieldMapping: fieldMapping as any,
        includeTimestamp: body.includeTimestamp !== false,
        createdBy: user?.userId || null,
      },
    })

    // Write header row
    const headers = fieldMapping.map((m: any) => m.header)
    if (body.includeTimestamp !== false) headers.push('Data/Hora')
    try {
      await writeHeaders(parseInt(body.connectionId), body.spreadsheetId, body.sheetName || 'Sheet1', headers)
    } catch { /* non-critical */ }

    invalidateGoogleSheetsCache()
    return reply.code(201).send({ data: integration })
  })

  // PUT /api/admin/google/sheets/:id
  app.put('/api/admin/google/sheets/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const body = req.body as any

    const existing = await prisma.googleSheetIntegration.findUnique({ where: { id: parseInt(id) } })
    if (!existing) return reply.code(404).send({ error: 'Integracao nao encontrada' })

    const data: any = {}
    if (body.name !== undefined) data.name = body.name
    if (body.active !== undefined) data.active = body.active
    if (body.sheetName !== undefined) data.sheetName = body.sheetName
    if (body.includeTimestamp !== undefined) data.includeTimestamp = body.includeTimestamp
    if (body.fieldMapping !== undefined) data.fieldMapping = body.fieldMapping
    if (body.events) {
      for (const e of body.events) {
        if (e !== '*' && !SHEETS_EVENTS.includes(e as any)) {
          return reply.code(400).send({ error: `Evento invalido: ${e}` })
        }
      }
      data.events = body.events
    }

    const updated = await prisma.googleSheetIntegration.update({ where: { id: parseInt(id) }, data })
    invalidateGoogleSheetsCache()
    return { data: updated }
  })

  // DELETE /api/admin/google/sheets/:id
  app.delete('/api/admin/google/sheets/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const existing = await prisma.googleSheetIntegration.findUnique({ where: { id: parseInt(id) } })
    if (!existing) return reply.code(404).send({ error: 'Integracao nao encontrada' })
    await prisma.googleSheetIntegration.delete({ where: { id: parseInt(id) } })
    invalidateGoogleSheetsCache()
    return { ok: true }
  })

  // POST /api/admin/google/sheets/:id/test
  app.post('/api/admin/google/sheets/:id/test', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    try {
      const result = await testGoogleSheetIntegration(parseInt(id))
      return result
    } catch (err: any) {
      return reply.code(404).send({ error: err.message })
    }
  })

  // POST /api/admin/google/sheets/:id/setup-headers — Write headers to sheet
  app.post('/api/admin/google/sheets/:id/setup-headers', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const integration = await prisma.googleSheetIntegration.findUnique({
      where: { id: parseInt(id) },
      select: { connectionId: true, spreadsheetId: true, sheetName: true, fieldMapping: true, includeTimestamp: true },
    })
    if (!integration) return reply.code(404).send({ error: 'Integracao nao encontrada' })

    const mapping = integration.fieldMapping as Array<{ header: string }>
    const headers = mapping.map(m => m.header)
    if (integration.includeTimestamp) headers.push('Data/Hora')

    try {
      await writeHeaders(integration.connectionId, integration.spreadsheetId, integration.sheetName, headers)
      return { ok: true }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // GET /api/admin/google/sheets/:id/logs
  app.get('/api/admin/google/sheets/:id/logs', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const q = req.query as any
    const limit = Math.min(parseInt(q.limit) || 50, 200)
    const offset = parseInt(q.offset) || 0

    const existing = await prisma.googleSheetIntegration.findUnique({ where: { id: parseInt(id) } })
    if (!existing) return reply.code(404).send({ error: 'Integracao nao encontrada' })

    const [data, total] = await Promise.all([
      prisma.googleSheetLog.findMany({
        where: { integrationId: parseInt(id) },
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      prisma.googleSheetLog.count({ where: { integrationId: parseInt(id) } }),
    ])

    return { data, total, limit, offset }
  })

  // ── Google Calendar helpers (shared routes) ───────────

  // GET /api/admin/google/calendars?connectionId=1
  app.get('/api/admin/google/calendars', { preHandler: adminOnly }, async (req, reply) => {
    const { connectionId } = req.query as any
    if (!connectionId) return reply.code(400).send({ error: 'connectionId obrigatorio' })
    try {
      const calendars = await listCalendars(parseInt(connectionId))
      return { data: calendars }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })
}
