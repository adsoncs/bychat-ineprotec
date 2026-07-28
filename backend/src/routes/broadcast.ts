// src/routes/broadcast.ts
// Disparo em massa via WhatsApp Cloud API — CRUD de campanhas, audiência
// (leads/import), modelo de planilha, ações e métricas. Ver services/broadcast.ts.

import { FastifyInstance } from 'fastify'
import { read, utils, write } from 'xlsx'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'
import {
  extractTemplateVariables, buildRecipientsFromLeads, buildRecipientsFromRows,
  estimateCampaignCost, startCampaign, pauseCampaign, resumeCampaign, cancelCampaign,
} from '../services/broadcast.js'

export async function broadcastRoutes(app: FastifyInstance) {

  // GET /campaigns — lista
  app.get('/api/admin/broadcast/campaigns', { preHandler: authMiddleware }, async () => {
    const campaigns = await prisma.broadcastCampaign.findMany({
      orderBy: { createdAt: 'desc' },
      include: { cloudApiConnection: { select: { displayPhone: true, displayName: true } } },
    })
    return { campaigns }
  })

  // POST /campaigns — cria rascunho
  app.post('/api/admin/broadcast/campaigns', { preHandler: authMiddleware }, async (req, reply) => {
    const b = req.body as any
    const user = (req as any).user
    if (!b.name || !b.cloudApiConnectionId || !b.templateId) {
      return reply.code(400).send({ error: 'name, cloudApiConnectionId e templateId obrigatórios' })
    }
    const tpl = await prisma.cloudApiTemplate.findUnique({ where: { id: Number(b.templateId) } })
    if (!tpl) return reply.code(404).send({ error: 'Template não encontrado' })
    if (tpl.status !== 'APPROVED') return reply.code(400).send({ error: 'Só templates APROVADOS podem ser usados em disparo' })

    const campaign = await prisma.broadcastCampaign.create({
      data: {
        name: b.name,
        cloudApiConnectionId: Number(b.cloudApiConnectionId),
        templateId: tpl.id,
        templateName: tpl.name,
        templateLanguage: tpl.language,
        templateCategory: tpl.category,
        variableMapping: b.variableMapping || {},
        audienceType: b.audienceType === 'import' ? 'import' : 'leads',
        status: 'draft',
        createdByUserId: user?.userId ?? null,
      },
    })
    return reply.code(201).send({ campaign })
  })

  // GET /template-variables?templateId= — variáveis do template p/ mapeamento
  app.get('/api/admin/broadcast/template-variables', { preHandler: authMiddleware }, async (req, reply) => {
    const q = req.query as any
    const tpl = await prisma.cloudApiTemplate.findUnique({ where: { id: Number(q.templateId) }, select: { components: true } })
    if (!tpl) return reply.code(404).send({ error: 'Template não encontrado' })
    return extractTemplateVariables(tpl.components)
  })

  // GET /campaigns/:id — detalhe + métricas + amostra de destinatários
  app.get('/api/admin/broadcast/campaigns/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const campaign = await prisma.broadcastCampaign.findUnique({
      where: { id: Number(id) },
      include: { cloudApiConnection: { select: { displayPhone: true, displayName: true } } },
    })
    if (!campaign) return reply.code(404).send({ error: 'Campanha não encontrada' })
    const metrics = await campaignMetrics(campaign.id, campaign.templateCategory)
    const recipients = await prisma.broadcastRecipient.findMany({ where: { campaignId: campaign.id }, orderBy: { id: 'asc' }, take: 100 })
    return { campaign, metrics, recipients }
  })

  // PUT /campaigns/:id — edita rascunho
  app.put('/api/admin/broadcast/campaigns/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const b = req.body as any
    const campaign = await prisma.broadcastCampaign.findUnique({ where: { id: Number(id) } })
    if (!campaign) return reply.code(404).send({ error: 'Campanha não encontrada' })
    if (!['draft', 'scheduled'].includes(campaign.status)) return reply.code(400).send({ error: 'Só rascunhos/agendadas podem ser editados' })
    const data: any = {}
    if (b.name !== undefined) data.name = b.name
    if (b.variableMapping !== undefined) data.variableMapping = b.variableMapping
    if (b.scheduledAt !== undefined) data.scheduledAt = b.scheduledAt ? new Date(b.scheduledAt) : null

    // Número de envio e template só mudam enquanto for RASCUNHO: numa campanha
    // agendada os destinatários já estão resolvidos com as variáveis do template
    // atual, e trocá-lo por baixo deixaria a fila inconsistente.
    let templateChanged = false
    if (campaign.status === 'draft') {
      if (b.cloudApiConnectionId !== undefined) data.cloudApiConnectionId = Number(b.cloudApiConnectionId)
      if (b.audienceType !== undefined) data.audienceType = b.audienceType === 'import' ? 'import' : 'leads'
      if (b.templateId !== undefined && Number(b.templateId) !== campaign.templateId) {
        const tpl = await prisma.cloudApiTemplate.findUnique({ where: { id: Number(b.templateId) } })
        if (!tpl) return reply.code(404).send({ error: 'Template não encontrado' })
        if (tpl.status !== 'APPROVED') return reply.code(400).send({ error: 'Só templates APROVADOS podem ser usados em disparo' })
        data.templateId = tpl.id
        data.templateName = tpl.name
        data.templateLanguage = tpl.language
        data.templateCategory = tpl.category
        templateChanged = true
      }
    }

    // Trocar de template invalida o mapeamento de variáveis e os destinatários
    // já resolvidos — a audiência precisa ser reprocessada no wizard.
    if (templateChanged) {
      data.variableMapping = b.variableMapping ?? {}
      await prisma.broadcastRecipient.deleteMany({ where: { campaignId: campaign.id } })
      data.totalRecipients = 0
      data.skippedCount = 0
    }

    const updated = await prisma.broadcastCampaign.update({ where: { id: campaign.id }, data })
    return { campaign: updated, recipientsReset: templateChanged }
  })

  // DELETE /campaigns/:id
  app.delete('/api/admin/broadcast/campaigns/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const c = await prisma.broadcastCampaign.findUnique({ where: { id: Number(id) } })
    if (!c) return reply.code(404).send({ error: 'Campanha não encontrada' })
    if (c.status === 'running') return reply.code(400).send({ error: 'Pause ou cancele a campanha antes de excluir' })
    await prisma.broadcastCampaign.delete({ where: { id: c.id } })
    return { ok: true }
  })

  // POST /campaigns/:id/audience/leads — audiência por leads selecionados
  app.post('/api/admin/broadcast/campaigns/:id/audience/leads', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const b = req.body as any
    const campaign = await prisma.broadcastCampaign.findUnique({ where: { id: Number(id) } })
    if (!campaign) return reply.code(404).send({ error: 'Campanha não encontrada' })
    const leadIds: number[] = Array.isArray(b.leadIds) ? b.leadIds.map(Number).filter(Boolean) : []
    if (!leadIds.length) return reply.code(400).send({ error: 'Selecione ao menos um lead' })
    const leads = await prisma.lead.findMany({
      where: { id: { in: leadIds } },
      select: { id: true, nome: true, empresa: true, email: true, whatsapp: true, cidade: true, segmento: true, customFields: true },
    })
    await prisma.broadcastCampaign.update({ where: { id: campaign.id }, data: { audienceType: 'leads', audienceMeta: { count: leads.length } } })
    const res = await buildRecipientsFromLeads(campaign, leads)
    return { ok: true, ...res }
  })

  // POST /campaigns/:id/audience/parse — sobe planilha, devolve colunas (guarda rows)
  app.post('/api/admin/broadcast/campaigns/:id/audience/parse', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const campaign = await prisma.broadcastCampaign.findUnique({ where: { id: Number(id) } })
    if (!campaign) return reply.code(404).send({ error: 'Campanha não encontrada' })
    const data = await req.file()
    if (!data) return reply.code(400).send({ error: 'Arquivo obrigatório' })
    const buf = await data.toBuffer()
    const wb = read(buf, { type: 'buffer' })
    const sheet = wb.Sheets[wb.SheetNames[0]]
    const rows = utils.sheet_to_json<Record<string, any>>(sheet, { defval: '' }).map((r) => {
      const o: Record<string, string> = {}
      for (const k of Object.keys(r)) o[String(k).trim()] = String(r[k] ?? '').trim()
      return o
    })
    if (!rows.length) return reply.code(400).send({ error: 'Planilha vazia' })
    if (rows.length > 50000) return reply.code(400).send({ error: 'Máximo de 50.000 linhas' })
    const headers = Object.keys(rows[0])
    // guarda as linhas na campanha para o commit (limpas após criar destinatários)
    await prisma.broadcastCampaign.update({
      where: { id: campaign.id },
      data: { audienceType: 'import', audienceMeta: { source: 'import', fileName: data.filename, headers, rows } },
    })
    return { headers, sampleRows: rows.slice(0, 5), totalRows: rows.length }
  })

  // POST /campaigns/:id/audience/import-commit — gera destinatários da planilha
  app.post('/api/admin/broadcast/campaigns/:id/audience/import-commit', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const b = req.body as any
    const campaign = await prisma.broadcastCampaign.findUnique({ where: { id: Number(id) } })
    if (!campaign) return reply.code(404).send({ error: 'Campanha não encontrada' })
    const meta = (campaign.audienceMeta || {}) as any
    if (!Array.isArray(meta.rows)) return reply.code(400).send({ error: 'Envie a planilha primeiro' })
    if (!b.phoneColumn) return reply.code(400).send({ error: 'Indique a coluna do WhatsApp' })
    const res = await buildRecipientsFromRows(campaign, meta.rows, b.phoneColumn, b.nameColumn || undefined)
    // limpa as linhas cruas (já viraram destinatários) mantendo metadados
    await prisma.broadcastCampaign.update({ where: { id: campaign.id }, data: { audienceMeta: { source: 'import', fileName: meta.fileName, headers: meta.headers } } })
    return { ok: true, ...res }
  })

  // GET /audience-template?templateId= — modelo XLSX para download
  app.get('/api/admin/broadcast/audience-template', { preHandler: authMiddleware }, async (req, reply) => {
    const q = req.query as any
    const cols = ['whatsapp', 'nome']
    if (q.templateId) {
      const tpl = await prisma.cloudApiTemplate.findUnique({ where: { id: Number(q.templateId) }, select: { components: true } })
      if (tpl) {
        const { keys } = extractTemplateVariables(tpl.components)
        for (const k of keys) cols.push(`var_${k.replace(':', '_')}`) // ex.: var_body_1
      }
    }
    const ws = utils.aoa_to_sheet([cols, ['5562999999999', 'Maria', ...cols.slice(2).map(() => 'exemplo')]])
    const wb = utils.book_new()
    utils.book_append_sheet(wb, ws, 'destinatarios')
    const buf = write(wb, { type: 'buffer', bookType: 'xlsx' })
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    reply.header('Content-Disposition', 'attachment; filename="modelo_disparo.xlsx"')
    return reply.send(buf)
  })

  // POST /campaigns/:id/start — inicia agora ou agenda
  app.post('/api/admin/broadcast/campaigns/:id/start', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const b = req.body as any
    const campaign = await prisma.broadcastCampaign.findUnique({ where: { id: Number(id) } })
    if (!campaign) return reply.code(404).send({ error: 'Campanha não encontrada' })
    if (!['draft', 'scheduled', 'paused'].includes(campaign.status)) return reply.code(400).send({ error: `Campanha não pode ser iniciada (status ${campaign.status})` })
    const pending = await prisma.broadcastRecipient.count({ where: { campaignId: campaign.id, status: 'pending' } })
    if (pending === 0) return reply.code(400).send({ error: 'Nenhum destinatário válido para enviar' })

    const when = b.scheduledAt ? new Date(b.scheduledAt) : null
    if (when && when.getTime() > Date.now() + 30_000) {
      await prisma.broadcastCampaign.update({ where: { id: campaign.id }, data: { status: 'scheduled', scheduledAt: when } })
      return { ok: true, status: 'scheduled', scheduledAt: when }
    }
    await startCampaign(campaign.id)
    return { ok: true, status: 'running' }
  })

  app.post('/api/admin/broadcast/campaigns/:id/pause', { preHandler: authMiddleware }, async (req) => { await pauseCampaign(Number((req.params as any).id)); return { ok: true } })
  app.post('/api/admin/broadcast/campaigns/:id/resume', { preHandler: authMiddleware }, async (req) => { await resumeCampaign(Number((req.params as any).id)); return { ok: true } })
  app.post('/api/admin/broadcast/campaigns/:id/cancel', { preHandler: authMiddleware }, async (req) => { await cancelCampaign(Number((req.params as any).id)); return { ok: true } })

  // GET /campaigns/:id/metrics — métricas em tempo real
  app.get('/api/admin/broadcast/campaigns/:id/metrics', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const c = await prisma.broadcastCampaign.findUnique({ where: { id: Number(id) }, select: { id: true, templateCategory: true } })
    if (!c) return reply.code(404).send({ error: 'Campanha não encontrada' })
    return campaignMetrics(c.id, c.templateCategory)
  })

  // GET /campaigns/:id/recipients — lista paginada (filtro por status)
  app.get('/api/admin/broadcast/campaigns/:id/recipients', { preHandler: authMiddleware }, async (req) => {
    const { id } = req.params as any
    const q = req.query as any
    const where: any = { campaignId: Number(id) }
    if (q.status) where.status = q.status
    const recipients = await prisma.broadcastRecipient.findMany({ where, orderBy: { id: 'asc' }, take: Math.min(Number(q.limit) || 100, 500), skip: Number(q.offset) || 0 })
    return { recipients }
  })
}

// ─── Métricas ───────────────────────────────────────────
async function campaignMetrics(campaignId: number, category: string) {
  const grouped = await prisma.broadcastRecipient.groupBy({ by: ['status'], where: { campaignId }, _count: true })
  const counts: Record<string, number> = { pending: 0, queued: 0, sent: 0, delivered: 0, read: 0, failed: 0, skipped: 0 }
  for (const g of grouped) counts[g.status] = g._count
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  // "processados" = tudo que saiu (sent/delivered/read), pois delivered/read implicam sent
  const reached = counts.sent + counts.delivered + counts.read
  // Custo estimado da campanha inteira = destinatários enviáveis (exclui os pulados).
  const sendable = total - counts.skipped
  const estimatedCostUsd = await estimateCampaignCost(category, sendable)
  return {
    counts, total,
    progress: total ? Math.round(((reached + counts.failed + counts.skipped) / total) * 100) : 0,
    estimatedCostUsd,
  }
}
