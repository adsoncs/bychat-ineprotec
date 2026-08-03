// src/routes/smartBroadcast.ts
// Disparos Inteligentes — campanhas pelos números próprios (Evolution).
// Motor em services/smartBroadcast/*.

import { FastifyInstance } from 'fastify'
import { read, utils, write } from 'xlsx'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'
import {
  buildRecipientsFromLeads, buildRecipientsFromRows, planCampaign, poolStatus,
  startCampaign, pauseCampaign, resumeCampaign, cancelCampaign, campaignMetrics,
  validateForStart, previewSamples, extractVarNames, contentDiversity, buildRecipientLink,
  variantPerformance, assessRisk,
  suppress, unsuppress, suppressMany, listProfiles, seedSystemProfiles,
  DEFAULT_PACING, DEFAULT_WINDOW, DEFAULT_WARMUP_CURVE,
  type MessageBlock,
} from '../services/smartBroadcast/index.js'

export async function smartBroadcastRoutes(app: FastifyInstance) {

  // ─── Números disponíveis + saúde ──────────────────────
  app.get('/api/admin/smart-broadcast/senders', { preHandler: authMiddleware }, async () => {
    const instances = await prisma.whatsAppInstance.findMany({
      where: { active: true },
      select: { id: true, name: true, instanceName: true, phone: true },
      orderBy: { id: 'asc' },
    })
    const pool = await poolStatus(instances.map((i) => ({ id: i.id, instanceName: i.instanceName })))
    const byId = new Map(pool.map((p) => [p.instanceId, p.health]))
    return {
      senders: instances.map((i) => {
        const h = byId.get(i.id)
        return {
          id: i.id, name: i.name, instanceName: i.instanceName, phone: i.phone,
          warmupDay: h?.warmupDay ?? 1,
          dailyCap: h?.dailyCap ?? DEFAULT_WARMUP_CURVE[0],
          sentToday: h?.sent ?? 0,
          state: h?.state ?? 'warming',
          score: h?.score ?? 100,
          pausedUntil: h?.pausedUntil ?? null,
          pauseReason: h?.pauseReason ?? null,
        }
      }),
      warmupCurve: DEFAULT_WARMUP_CURVE,
    }
  })

  // ─── CRUD ─────────────────────────────────────────────
  app.get('/api/admin/smart-broadcast/campaigns', { preHandler: authMiddleware }, async () => {
    const campaigns = await prisma.smartCampaign.findMany({ orderBy: { createdAt: 'desc' } })
    return { campaigns }
  })

  app.post('/api/admin/smart-broadcast/campaigns', { preHandler: authMiddleware }, async (req, reply) => {
    const b = req.body as any
    const user = (req as any).user
    if (!b.name?.trim()) return reply.code(400).send({ error: 'Informe o nome da campanha' })

    const campaign = await prisma.smartCampaign.create({
      data: {
        name: String(b.name).trim().slice(0, 191),
        senderInstances: b.senderInstances ?? [],
        messageBlocks: b.messageBlocks ?? [{ variants: [''] }],
        audienceType: b.audienceType === 'import' ? 'import' : 'leads',
        pacingConfig: { ...DEFAULT_PACING, ...(b.pacingConfig ?? {}) },
        windowConfig: { ...DEFAULT_WINDOW, ...(b.windowConfig ?? {}) },
        dailyCapPerNumber: Number(b.dailyCapPerNumber) || DEFAULT_WARMUP_CURVE[0],
        requireOptIn: !!b.requireOptIn,
        usePreferredTime: !!b.usePreferredTime,
        legalBasis: b.legalBasis ?? null,
        optOutFooter: b.optOutFooter ?? null,
        linkUrl: b.linkUrl ?? null,
        replyActions: b.replyActions ?? undefined,
        status: 'draft',
        createdByUserId: user?.userId ?? null,
      },
    })
    return reply.code(201).send({ campaign })
  })

  app.get('/api/admin/smart-broadcast/campaigns/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const campaign = await prisma.smartCampaign.findUnique({ where: { id: Number(id) } })
    if (!campaign) return reply.code(404).send({ error: 'Campanha não encontrada' })
    const metrics = await campaignMetrics(campaign.id)
    const recipients = await prisma.smartCampaignRecipient.findMany({
      where: { campaignId: campaign.id },
      orderBy: [{ plannedAt: 'asc' }, { id: 'asc' }],
      take: 100,
    })
    return { campaign, metrics, recipients }
  })

  app.put('/api/admin/smart-broadcast/campaigns/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const b = req.body as any
    const campaign = await prisma.smartCampaign.findUnique({ where: { id: Number(id) } })
    if (!campaign) return reply.code(404).send({ error: 'Campanha não encontrada' })
    if (!['draft', 'scheduled', 'paused'].includes(campaign.status)) {
      return reply.code(400).send({ error: 'Campanha em andamento não pode ser editada — pause antes' })
    }
    const data: any = {}
    if (b.name !== undefined) data.name = String(b.name).trim().slice(0, 191)
    if (b.senderInstances !== undefined) data.senderInstances = b.senderInstances
    if (b.messageBlocks !== undefined) data.messageBlocks = b.messageBlocks
    if (b.pacingConfig !== undefined) data.pacingConfig = { ...DEFAULT_PACING, ...b.pacingConfig }
    if (b.windowConfig !== undefined) data.windowConfig = { ...DEFAULT_WINDOW, ...b.windowConfig }
    if (b.dailyCapPerNumber !== undefined) data.dailyCapPerNumber = Number(b.dailyCapPerNumber) || DEFAULT_WARMUP_CURVE[0]
    if (b.requireOptIn !== undefined) data.requireOptIn = !!b.requireOptIn
    if (b.usePreferredTime !== undefined) data.usePreferredTime = !!b.usePreferredTime
    if (b.legalBasis !== undefined) data.legalBasis = b.legalBasis
    if (b.optOutFooter !== undefined) data.optOutFooter = b.optOutFooter ? String(b.optOutFooter).slice(0, 191) : null
    if (b.linkUrl !== undefined) data.linkUrl = b.linkUrl ? String(b.linkUrl).slice(0, 500) : null
    if (b.replyActions !== undefined) data.replyActions = b.replyActions
    if (b.audienceType !== undefined && campaign.status === 'draft') {
      data.audienceType = b.audienceType === 'import' ? 'import' : 'leads'
    }
    const updated = await prisma.smartCampaign.update({ where: { id: campaign.id }, data })
    return { campaign: updated }
  })

  app.delete('/api/admin/smart-broadcast/campaigns/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const c = await prisma.smartCampaign.findUnique({ where: { id: Number(id) } })
    if (!c) return reply.code(404).send({ error: 'Campanha não encontrada' })
    if (c.status === 'running') return reply.code(400).send({ error: 'Pause ou cancele a campanha antes de excluir' })
    await prisma.smartCampaign.delete({ where: { id: c.id } })
    return { ok: true }
  })

  // ─── Prévia da mensagem ───────────────────────────────
  // Mostra 8 renderizações reais — é assim que o operador percebe que escreveu
  // pouca variação, antes de mandar mil mensagens iguais.
  app.post('/api/admin/smart-broadcast/preview', { preHandler: authMiddleware }, async (req) => {
    const b = req.body as any
    const blocks = (b.messageBlocks ?? []) as MessageBlock[]
    const sample = {
      nome: 'Maria Silva', primeiro_nome: 'Maria', empresa: 'Acme', cidade: 'Goiânia',
      ...(b.linkUrl ? { link: buildRecipientLink(b.linkUrl, b.name ?? 'campanha', 1234) } : {}),
      ...(b.sampleVars ?? {}),
    }
    const opts = { optOutFooter: b.optOutFooter ?? null }
    // Diversidade estimada sobre 200 destinatários fictícios: mostra na hora se
    // as variações escritas dão conta do tamanho da lista.
    const fake = Array.from({ length: 200 }, (_, i) => ({ phoneKey: `55629${String(i).padStart(8, '0')}`, variables: sample }))
    return {
      samples: previewSamples(blocks, sample, 8, opts),
      variables: extractVarNames(blocks),
      diversity: contentDiversity(blocks, fake, opts),
    }
  })

  // ─── Perfis de ritmo ──────────────────────────────────
  app.get('/api/admin/smart-broadcast/pacing-profiles', { preHandler: authMiddleware }, async () => {
    // Semeia na primeira leitura também: tenant que nunca rodou o worker ainda
    // assim vê os três perfis de sistema.
    await seedSystemProfiles().catch(() => {})
    return { profiles: await listProfiles() }
  })

  // ─── Lista de bloqueio (supressão global) ─────────────
  app.get('/api/admin/smart-broadcast/suppressions', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const where: any = {}
    if (q.search) where.phone = { contains: String(q.search) }
    const [items, total] = await Promise.all([
      prisma.smartSuppression.findMany({
        where, orderBy: { createdAt: 'desc' },
        take: Math.min(Number(q.limit) || 100, 500), skip: Number(q.offset) || 0,
      }),
      prisma.smartSuppression.count({ where }),
    ])
    return { items, total }
  })

  app.post('/api/admin/smart-broadcast/suppressions', { preHandler: authMiddleware }, async (req, reply) => {
    const b = req.body as any
    const user = (req as any).user
    // Aceita um número ou uma lista colada (uma por linha / separada por vírgula).
    const raw = String(b.phones ?? b.phone ?? '')
    const phones = raw.split(/[\n,;]+/).map((p) => p.trim()).filter(Boolean)
    if (!phones.length) return reply.code(400).send({ error: 'Informe ao menos um telefone' })
    const res = await suppressMany(phones, b.reason ?? 'manual', b.note, user?.userId ?? null)
    return { ok: true, ...res }
  })

  app.delete('/api/admin/smart-broadcast/suppressions/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const row = await prisma.smartSuppression.findUnique({ where: { id: Number(id) } })
    if (!row) return reply.code(404).send({ error: 'Registro não encontrado' })
    await unsuppress(row.phone)
    await prisma.smartSuppression.deleteMany({ where: { id: row.id } })
    return { ok: true }
  })

  // ─── Nota de risco ────────────────────────────────────
  app.get('/api/admin/smart-broadcast/campaigns/:id/risk', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      return await assessRisk({ campaignId: Number((req.params as any).id) })
    } catch (err: any) {
      return reply.code(404).send({ error: String(err?.message ?? err) })
    }
  })

  // ─── Audiência ────────────────────────────────────────
  app.post('/api/admin/smart-broadcast/campaigns/:id/audience/leads', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const b = req.body as any
    const campaign = await prisma.smartCampaign.findUnique({ where: { id: Number(id) } })
    if (!campaign) return reply.code(404).send({ error: 'Campanha não encontrada' })
    const leadIds: number[] = Array.isArray(b.leadIds) ? b.leadIds.map(Number).filter(Boolean) : []
    if (!leadIds.length) return reply.code(400).send({ error: 'Selecione ao menos um lead' })

    const where: any = { id: { in: leadIds } }
    // "Só quem já conversou": exige relacionamento prévio — ao menos uma mensagem
    // RECEBIDA daquele contato. É o recorte mais protetor que dá para verificar
    // no banco (o sistema não guarda opt-in explícito de WhatsApp), e é também o
    // público que menos denuncia, porque reconhece quem está falando.
    if (campaign.requireOptIn) where.messages = { some: { fromMe: false } }

    const leads = await prisma.lead.findMany({
      where,
      select: { id: true, nome: true, empresa: true, email: true, whatsapp: true, cidade: true, segmento: true, customFields: true },
    })
    await prisma.smartCampaign.update({
      where: { id: campaign.id },
      data: { audienceType: 'leads', audienceMeta: { count: leads.length, requestedIds: leadIds.length } },
    })
    const res = await buildRecipientsFromLeads(campaign, leads)
    return { ok: true, ...res, ignoredByOptIn: leadIds.length - leads.length }
  })

  app.post('/api/admin/smart-broadcast/campaigns/:id/audience/parse', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const campaign = await prisma.smartCampaign.findUnique({ where: { id: Number(id) } })
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
    if (rows.length > 20000) return reply.code(400).send({ error: 'Máximo de 20.000 linhas por campanha' })
    const headers = Object.keys(rows[0])
    await prisma.smartCampaign.update({
      where: { id: campaign.id },
      data: { audienceType: 'import', audienceMeta: { source: 'import', fileName: data.filename, headers, rows } },
    })
    return { headers, sampleRows: rows.slice(0, 5), totalRows: rows.length }
  })

  app.post('/api/admin/smart-broadcast/campaigns/:id/audience/import-commit', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const b = req.body as any
    const campaign = await prisma.smartCampaign.findUnique({ where: { id: Number(id) } })
    if (!campaign) return reply.code(404).send({ error: 'Campanha não encontrada' })
    const meta = (campaign.audienceMeta ?? {}) as any
    if (!Array.isArray(meta.rows)) return reply.code(400).send({ error: 'Envie a planilha primeiro' })
    if (!b.phoneColumn) return reply.code(400).send({ error: 'Indique a coluna do WhatsApp' })
    const res = await buildRecipientsFromRows(campaign, meta.rows, b.phoneColumn, b.nameColumn || undefined)
    await prisma.smartCampaign.update({
      where: { id: campaign.id },
      data: { audienceMeta: { source: 'import', fileName: meta.fileName, headers: meta.headers } },
    })
    return { ok: true, ...res }
  })

  app.get('/api/admin/smart-broadcast/audience-template', { preHandler: authMiddleware }, async (_req, reply) => {
    const cols = ['whatsapp', 'nome', 'empresa', 'cidade']
    const ws = utils.aoa_to_sheet([cols, ['5562999999999', 'Maria Silva', 'Acme', 'Goiânia']])
    const wb = utils.book_new()
    utils.book_append_sheet(wb, ws, 'destinatarios')
    const buf = write(wb, { type: 'buffer', bookType: 'xlsx' })
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    reply.header('Content-Disposition', 'attachment; filename="modelo_disparo_inteligente.xlsx"')
    return reply.send(buf)
  })

  // ─── Simulação (dry-run) ──────────────────────────────
  // Roda o planner inteiro e devolve a agenda SEM enviar nem gravar nada.
  app.post('/api/admin/smart-broadcast/campaigns/:id/simulate', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const campaign = await prisma.smartCampaign.findUnique({ where: { id: Number(id) } })
    if (!campaign) return reply.code(404).send({ error: 'Campanha não encontrada' })
    const problems = validateForStart(campaign)
    try {
      const plan = await planCampaign(campaign.id, { dryRun: true, skipNumberCheck: (req.body as any)?.skipNumberCheck !== false })
      return { plan, problems }
    } catch (err: any) {
      return reply.code(400).send({ error: String(err?.message ?? err), problems })
    }
  })

  // ─── Ações ────────────────────────────────────────────
  app.post('/api/admin/smart-broadcast/campaigns/:id/start', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const b = req.body as any
    const campaign = await prisma.smartCampaign.findUnique({ where: { id: Number(id) } })
    if (!campaign) return reply.code(404).send({ error: 'Campanha não encontrada' })
    if (!['draft', 'scheduled', 'paused'].includes(campaign.status)) {
      return reply.code(400).send({ error: `Campanha não pode ser iniciada (status ${campaign.status})` })
    }
    try {
      const res = await startCampaign(campaign.id, b?.scheduledAt ? new Date(b.scheduledAt) : null)
      return { ok: true, ...res }
    } catch (err: any) {
      return reply.code(400).send({ error: String(err?.message ?? err) })
    }
  })

  app.post('/api/admin/smart-broadcast/campaigns/:id/pause', { preHandler: authMiddleware }, async (req) => {
    await pauseCampaign(Number((req.params as any).id))
    return { ok: true }
  })

  app.post('/api/admin/smart-broadcast/campaigns/:id/resume', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const plan = await resumeCampaign(Number((req.params as any).id))
      return { ok: true, plan }
    } catch (err: any) {
      return reply.code(400).send({ error: String(err?.message ?? err) })
    }
  })

  app.post('/api/admin/smart-broadcast/campaigns/:id/cancel', { preHandler: authMiddleware }, async (req) => {
    await cancelCampaign(Number((req.params as any).id))
    return { ok: true }
  })

  // ─── Acompanhamento ───────────────────────────────────
  app.get('/api/admin/smart-broadcast/campaigns/:id/metrics', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const c = await prisma.smartCampaign.findUnique({ where: { id: Number(id) }, select: { id: true } })
    if (!c) return reply.code(404).send({ error: 'Campanha não encontrada' })
    return campaignMetrics(c.id)
  })

  // Desempenho por variação de texto (A/B).
  app.get('/api/admin/smart-broadcast/campaigns/:id/variants', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      return await variantPerformance(Number((req.params as any).id))
    } catch (err: any) {
      return reply.code(404).send({ error: String(err?.message ?? err) })
    }
  })

  app.get('/api/admin/smart-broadcast/campaigns/:id/recipients', { preHandler: authMiddleware }, async (req) => {
    const { id } = req.params as any
    const q = req.query as any
    const where: any = { campaignId: Number(id) }
    if (q.status) where.status = q.status
    const recipients = await prisma.smartCampaignRecipient.findMany({
      where,
      orderBy: [{ plannedAt: 'asc' }, { id: 'asc' }],
      take: Math.min(Number(q.limit) || 100, 500),
      skip: Number(q.offset) || 0,
    })
    return { recipients }
  })
}
