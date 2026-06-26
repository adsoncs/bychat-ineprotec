// Rotas de enriquecimento de lead.
// GET  /api/bychat/leads/:id/enrichment        → lista fatos coletados + score
// POST /api/bychat/leads/:id/enrichment/run    → enfileira job (ou roda sync se ?sync=1)
// POST /api/bychat/leads/:id/lgpd              → registra consentimento LGPD

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { queues } from '../lib/queues.js'
import { authMiddleware } from '../lib/auth.js'
import { logEvent, getIp } from '../services/leadHistory.js'
import { socialSearchEnabled, invalidateSocialSearchCache } from '../services/enrichment/identity.js'

export async function enrichmentRoutes(app: FastifyInstance) {

  // Overview para a página "Inteligência" — paginada, com busca e filtros.
  // Query: ?page=1&limit=50&search=...&status=done|partial|pending|running|enriched|no_lgpd&lgpd=true|false
  // ?orderBy=recent|opportunity|score (default: recent)
  app.get('/api/bychat/enrichment/overview', { preHandler: authMiddleware }, async (req, reply) => {
    const q = req.query as any
    const page  = Math.max(1, parseInt(q.page || '1'))
    const limit = Math.min(Math.max(parseInt(q.limit || '50'), 1), 200)
    const skip  = (page - 1) * limit
    const status = q.status as string | undefined
    const search = typeof q.search === 'string' ? q.search.trim() : ''
    const orderBy = (q.orderBy === 'opportunity' || q.orderBy === 'score') ? q.orderBy : 'recent'

    const where: any = {}

    // Filtros de status (mapeia os presets do frontend)
    if (status === 'pending')   where.enrichmentStatus = { in: ['pending', null] as any }
    else if (status === 'done')    where.enrichmentStatus = 'done'
    else if (status === 'partial') where.enrichmentStatus = 'partial'
    else if (status === 'running') where.enrichmentStatus = 'running'
    else if (status === 'enriched') where.enrichmentStatus = { in: ['done', 'partial'] }
    else if (status === 'not_enriched') where.OR = [{ enrichmentStatus: null }, { enrichmentStatus: { notIn: ['done', 'partial'] } }]

    // LGPD
    if (q.lgpd === 'true')  where.lgpdConsent = true
    if (q.lgpd === 'false') where.lgpdConsent = false

    // Busca textual em nome, empresa, email, whatsapp, uid
    if (search) {
      const searchClause = {
        OR: [
          { nome:     { contains: search } },
          { empresa:  { contains: search } },
          { email:    { contains: search } },
          { whatsapp: { contains: search } },
          { uid:      { contains: search } },
        ],
      }
      if (where.OR) {
        where.AND = [{ OR: where.OR }, searchClause]
        delete where.OR
      } else {
        where.OR = searchClause.OR
      }
    }

    // ── Modo "opportunity": ranking computado em JS porque combina vários fatores
    // (score + canais + recência) que não dão pra ordenar direto no banco sem raw SQL.
    // Limitamos a 5000 leads no universo para não estourar memória — ranking faz
    // mais sentido para leads recentes que ainda têm chance de conversão.
    const RANK_UNIVERSE = 5000
    const isComputed = orderBy === 'opportunity'

    const baseSelect = {
      id: true, uid: true, nome: true, empresa: true, whatsapp: true, email: true,
      lgpdConsent: true, lgpdConsentAt: true, lgpdConsentSource: true, lgpdConsentBy: true,
      enrichmentStatus: true, enrichmentScore: true, enrichedAt: true,
      createdAt: true, updatedAt: true,
      status: true, funnelId: true,
      conversationOpenedAt: true, conversationClosedAt: true,
    } as const

    let leads: any[]
    let total: number

    if (isComputed) {
      const candidates = await prisma.lead.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }],
        take: RANK_UNIVERSE,
        select: baseSelect,
      })
      const now = Date.now()
      const ranked = candidates.map((l) => {
        // score base (0-100)
        const score = l.enrichmentScore ?? 0
        // canais validados: +10 cada
        const channels = (l.email && l.email.includes('@') ? 10 : 0) + (l.whatsapp && l.whatsapp.length >= 10 ? 10 : 0)
        // recência: leads com sinal nas últimas 24h sobem; leads parados há >30d caem
        const ageMs = now - new Date(l.updatedAt).getTime()
        const days = ageMs / 86_400_000
        const recency = days < 1 ? 25 : days < 7 ? 18 : days < 30 ? 8 : days < 90 ? -5 : -20
        // status do funil — leads em estágios iniciais ainda têm jornada para percorrer
        const stagePush = l.status === 'NOVO' || l.status === 'CONTATADO' ? 8 : 0
        // bônus se já está enriquecido (dados acionáveis)
        const enrichBonus = l.enrichmentStatus === 'done' ? 5 : l.enrichmentStatus === 'partial' ? 2 : 0

        const opportunity = Math.max(0, Math.min(150, score + channels + recency + stagePush + enrichBonus))
        return { ...l, _opportunity: opportunity }
      })
      ranked.sort((a, b) => b._opportunity - a._opportunity)
      leads = ranked.slice(skip, skip + limit)
      total = ranked.length
    } else if (orderBy === 'score') {
      ;[leads, total] = await Promise.all([
        prisma.lead.findMany({
          where,
          orderBy: [{ enrichmentScore: 'desc' }, { enrichedAt: 'desc' }],
          skip,
          take: limit,
          select: baseSelect,
        }),
        prisma.lead.count({ where }),
      ])
    } else {
      ;[leads, total] = await Promise.all([
        prisma.lead.findMany({
          where,
          orderBy: [{ enrichedAt: 'desc' }, { createdAt: 'desc' }],
          skip,
          take: limit,
          select: baseSelect,
        }),
        prisma.lead.count({ where }),
      ])
    }

    // Contagem de fatos por lead (num único groupBy, só para os leads da página)
    const leadIds = leads.map(l => l.id)
    const factCounts = leadIds.length > 0
      ? await prisma.leadEnrichment.groupBy({
          by: ['leadId'],
          where: { leadId: { in: leadIds }, status: 'active' },
          _count: { _all: true },
        })
      : []
    const factMap = new Map<number, number>()
    for (const f of factCounts) factMap.set(f.leadId, f._count._all)

    // Stats globais (independem do filtro atual — são o panorama total do sistema)
    const [totalLeads, consentedLeads, enrichedLeads, totalFactsGlobal] = await Promise.all([
      prisma.lead.count(),
      prisma.lead.count({ where: { lgpdConsent: true } }),
      prisma.lead.count({ where: { enrichmentStatus: { in: ['done', 'partial'] } } }),
      prisma.leadEnrichment.count({ where: { status: 'active' } }),
    ])
    const avgScoreRow = await prisma.lead.aggregate({
      _avg: { enrichmentScore: true },
      where: { enrichmentStatus: { in: ['done', 'partial'] } },
    })

    // Counts dos filtros (para mostrar "Todos (N) · Enriquecidos (M)" sem uma query extra por filtro)
    const filterCounts = await Promise.all([
      prisma.lead.count(),                                                                // all
      prisma.lead.count({ where: { enrichmentStatus: { in: ['done', 'partial'] } } }),    // enriched
      prisma.lead.count({ where: { OR: [{ enrichmentStatus: null }, { enrichmentStatus: { notIn: ['done', 'partial'] } }] } }), // not_enriched
      prisma.lead.count({ where: { lgpdConsent: true } }),                                // consented
      prisma.lead.count({ where: { lgpdConsent: false } }),                               // no_lgpd
    ])

    const enrichedList = leads.map(l => ({
      ...l,
      totalFacts: factMap.get(l.id) || 0,
      ...(typeof l._opportunity === 'number' ? { opportunity: l._opportunity } : {}),
    }))

    return {
      leads: enrichedList,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
      stats: {
        totalLeads,
        consentedLeads,
        enrichedLeads,
        totalFactsGlobal,
        avgScore: avgScoreRow._avg.enrichmentScore ? Math.round(Number(avgScoreRow._avg.enrichmentScore)) : null,
      },
      filterCounts: {
        all:          filterCounts[0],
        enriched:     filterCounts[1],
        not_enriched: filterCounts[2],
        consented:    filterCounts[3],
        no_lgpd:      filterCounts[4],
      },
    }
  })

  // Listar fatos do lead
  app.get('/api/bychat/leads/:id/enrichment', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const leadId = parseInt(id)
    if (!leadId) return reply.code(400).send({ error: 'ID inválido' })

    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true, nome: true, empresa: true, email: true, whatsapp: true,
        lgpdConsent: true, lgpdConsentAt: true, lgpdConsentSource: true, lgpdConsentBy: true,
        enrichmentStatus: true, enrichmentScore: true, enrichedAt: true,
      },
    })
    if (!lead) return reply.code(404).send({ error: 'Lead não encontrado' })

    const q = req.query as { includeDisputed?: string }
    const includeDisputed = q.includeDisputed === '1'
    const facts = await prisma.leadEnrichment.findMany({
      where: includeDisputed
        ? { leadId, status: { in: ['active', 'disputed'] } }
        : { leadId, status: 'active' },
      orderBy: [{ source: 'asc' }, { field: 'asc' }],
    })

    // Agrupa por source
    const bySource: Record<string, any[]> = {}
    for (const f of facts) {
      if (!bySource[f.source]) bySource[f.source] = []
      bySource[f.source].push({
        id: f.id, field: f.field, value: f.value, confidence: f.confidence,
        fetchedAt: f.fetchedAt, status: f.status,
      })
    }

    // Candidatos a verificar (descobertas por NOME, sem âncora de identidade). NÃO
    // entram no dossiê/score — o agente confirma ou descarta. Inclui a proveniência
    // (query usada + por que achamos) para o agente julgar.
    const candidateRows = await prisma.leadEnrichment.findMany({
      where: { leadId, status: 'candidate' },
      orderBy: [{ confidence: 'desc' }, { source: 'asc' }],
    })
    const candidates = candidateRows.map((c) => {
      const raw = (c.rawData ?? {}) as Record<string, any>
      return {
        id: c.id, source: c.source, field: c.field, value: c.value, confidence: c.confidence,
        fetchedAt: c.fetchedAt,
        platform: raw.platform ?? c.field.replace('_url', ''),
        query: raw.query ?? null,
        reason: raw.corroboration ?? null, // por que é só candidato
      }
    })

    return reply.send({ lead, facts, bySource, totalFacts: facts.length, candidates })
  })

  // Disparar enriquecimento
  app.post('/api/bychat/leads/:id/enrichment/run', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const leadId = parseInt(id)
    const q = req.query as { sync?: string; maxTier?: string; force?: string }
    const sync = q.sync === '1'
    const maxTier = q.maxTier ? (parseInt(q.maxTier) as 1 | 2 | 3) : 3
    const force = q.force === '1'

    const lead = await prisma.lead.findUnique({ where: { id: leadId } })
    if (!lead) return reply.code(404).send({ error: 'Lead não encontrado' })
    if (!lead.lgpdConsent) return reply.code(403).send({ error: 'Lead sem consentimento LGPD' })

    if (sync) {
      const { enrichLead } = await import('../services/enrichment/index.js')
      const res = await enrichLead(leadId, { maxTier, force })
      return reply.send({ ok: true, ...res })
    }
    await queues.enrichment.add('enrich', { leadId, maxTier, force }, {
      attempts: 2,
      backoff: { type: 'exponential', delay: 5000 },
    })
    return reply.send({ ok: true, queued: true })
  })

  // Registrar consentimento LGPD.
  // Sem auth = chamado pelo formulário público (titular consentindo).
  // Com auth = chamado pelo admin/painel (operator_override — requer base legal própria).
  app.post('/api/bychat/leads/:id/lgpd', async (req, reply) => {
    const { id } = req.params as { id: string }
    const leadId = parseInt(id)
    const body = req.body as { consent: boolean }
    if (typeof body?.consent !== 'boolean') return reply.code(400).send({ error: 'consent obrigatório' })

    const authHeader = req.headers.authorization
    let operatorUserId: number | null = null
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const { verifyToken } = await import('../lib/auth.js')
        const payload = verifyToken(authHeader.slice(7))
        operatorUserId = payload.userId
      } catch { /* fallthrough → titular */ }
    }
    const consentSource = body.consent
      ? (operatorUserId ? 'operator_override' : 'titular')
      : null

    const lead = await prisma.lead.update({
      where: { id: leadId },
      data: {
        lgpdConsent: body.consent,
        lgpdConsentAt: body.consent ? new Date() : null,
        lgpdConsentSource: consentSource,
        lgpdConsentBy: body.consent && operatorUserId ? operatorUserId : null,
      },
    })
    logEvent({
      leadId,
      type: 'lgpd_consent',
      category: 'system',
      title: body.consent ? 'Consentimento LGPD registrado' : 'Consentimento LGPD revogado',
      channel: 'system',
      source: 'form',
      actorType: 'lead',
      ipAddress: getIp(req),
    })

    // Se autorizou, enfileira enriquecimento automaticamente
    if (body.consent) {
      await queues.enrichment.add('enrich', { leadId }, { attempts: 2, backoff: { type: 'exponential', delay: 5000 } })
    }
    return reply.send({ ok: true, lead: { id: lead.id, lgpdConsent: lead.lgpdConsent } })
  })

  // Toggle: busca SOCIAL por nome (gera "candidatos a verificar"). Default OFF —
  // com ele desligado o motor não anexa social não-verificado (sem alucinação).
  app.get('/api/bychat/enrichment/admin/social-search', { preHandler: authMiddleware }, async (_req, reply) => {
    return reply.send({ enabled: await socialSearchEnabled() })
  })
  app.put('/api/bychat/enrichment/admin/social-search', { preHandler: authMiddleware }, async (req, reply) => {
    const enabled = (req.body as { enabled?: boolean })?.enabled === true
    await prisma.setting.upsert({
      where: { key: 'enrichment.socialSearch.enabled' },
      update: { value: enabled },
      create: { key: 'enrichment.socialSearch.enabled', value: enabled, label: 'Busca social por nome (candidatos)', grp: 'intelligence', fieldType: 'boolean' },
    })
    invalidateSocialSearchCache()
    return reply.send({ ok: true, enabled })
  })

  // Painel do operador: observabilidade do motor de enrichment.
  // Retorna métricas para o admin entender saúde dos providers, custo e qualidade.
  app.get('/api/bychat/enrichment/admin/stats', { preHandler: authMiddleware }, async (_req, reply) => {
    const since24h = new Date(Date.now() - 24 * 3600 * 1000)
    const since7d = new Date(Date.now() - 7 * 86_400_000)

    // 1. Fatos ativos vs disputados por source
    const [activeBySource, disputedBySource] = await Promise.all([
      prisma.leadEnrichment.groupBy({
        by: ['source'],
        where: { status: 'active' },
        _count: { _all: true },
        _avg: { confidence: true },
      }),
      prisma.leadEnrichment.groupBy({
        by: ['source'],
        where: { status: 'disputed' },
        _count: { _all: true },
      }),
    ])
    const disputedMap = new Map(disputedBySource.map(d => [d.source, d._count._all]))

    const providers = activeBySource.map(s => {
      const disputed = disputedMap.get(s.source) ?? 0
      const total = s._count._all + disputed
      const trustRate = total > 0 ? Math.round(((s._count._all) / total) * 1000) / 10 : 100
      return {
        source: s.source,
        activeFacts: s._count._all,
        disputedFacts: disputed,
        avgConfidence: s._avg.confidence ? Math.round(s._avg.confidence * 100) : null,
        trustRate, // % de fatos não contestados
      }
    })

    // 2. Runs nas últimas 24h: agrupar por status do enrichment_completed event
    const recentRuns = await prisma.leadEvent.findMany({
      where: { type: 'enrichment_completed', createdAt: { gte: since24h } },
      select: { id: true, leadId: true, createdAt: true, title: true, metadata: true },
      orderBy: { createdAt: 'desc' },
      take: 500,
    })
    const runsCount = { done: 0, partial: 0, failed: 0 }
    let totalErrors = 0
    const errorBuckets: Record<string, number> = {}
    for (const r of recentRuns) {
      const meta = r.metadata as { score?: number; errors?: string[]; factsAdded?: number } | null
      const errors = meta?.errors ?? []
      if (errors.length > 0 && (meta?.factsAdded ?? 0) === 0) runsCount.failed++
      else if (errors.length > 0) runsCount.partial++
      else runsCount.done++
      totalErrors += errors.length
      for (const e of errors) {
        const provider = e.split(':')[0]?.trim() ?? 'unknown'
        errorBuckets[provider] = (errorBuckets[provider] ?? 0) + 1
      }
    }

    const errorsByProvider = Object.entries(errorBuckets)
      .map(([provider, count]) => ({ provider, count }))
      .sort((a, b) => b.count - a.count)

    // 3. Top 20 leads com mais fatos disputados
    const topDisputedLeads = await prisma.leadEnrichment.groupBy({
      by: ['leadId'],
      where: { status: 'disputed' },
      _count: { _all: true },
      orderBy: { _count: { id: 'desc' } },
      take: 20,
    })
    const disputedLeadIds = topDisputedLeads.map(l => l.leadId)
    const disputedLeadsMeta = disputedLeadIds.length > 0
      ? await prisma.lead.findMany({
          where: { id: { in: disputedLeadIds } },
          select: { id: true, nome: true, empresa: true },
        })
      : []
    const disputedMetaMap = new Map(disputedLeadsMeta.map(l => [l.id, l]))
    const disputedLeads = topDisputedLeads.map(l => ({
      ...l,
      disputedCount: l._count._all,
      nome: disputedMetaMap.get(l.leadId)?.nome ?? null,
      empresa: disputedMetaMap.get(l.leadId)?.empresa ?? null,
    }))

    // 4. Histórico simples: runs por dia nos últimos 7d
    const runsLast7d = await prisma.leadEvent.findMany({
      where: { type: 'enrichment_completed', createdAt: { gte: since7d } },
      select: { createdAt: true },
    })
    const dailyRuns: Record<string, number> = {}
    for (const r of runsLast7d) {
      const day = r.createdAt.toISOString().slice(0, 10)
      dailyRuns[day] = (dailyRuns[day] ?? 0) + 1
    }
    const daily = Object.entries(dailyRuns)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, count]) => ({ day, count }))

    // 5. Auditoria LGPD — quantos leads consentiram via titular vs operator_override
    const [titularCount, overrideCount, legacyCount] = await Promise.all([
      prisma.lead.count({ where: { lgpdConsent: true, lgpdConsentSource: 'titular' } }),
      prisma.lead.count({ where: { lgpdConsent: true, lgpdConsentSource: 'operator_override' } }),
      prisma.lead.count({ where: { lgpdConsent: true, lgpdConsentSource: 'legacy' } }),
    ])

    return reply.send({
      providers,
      runsLast24h: { ...runsCount, totalErrors, errorsByProvider },
      topDisputedLeads: disputedLeads,
      dailyRuns: daily,
      lgpdAudit: {
        titular: titularCount,
        operatorOverride: overrideCount,
        legacy: legacyCount,
      },
    })
  })

  // Forçar a sweep de re-enriquecimento agora (em vez de esperar o cron horário).
  app.post('/api/bychat/enrichment/rerun-stale', { preHandler: authMiddleware }, async (_req, reply) => {
    const { runEnrichmentRerunSweep } = await import('../services/enrichmentRerunJob.js')
    const enqueued = await runEnrichmentRerunSweep()
    return reply.send({ ok: true, enqueued })
  })

  // Disparar enriquecimento em massa para vários leads. Pula leads sem LGPD.
  app.post('/api/bychat/leads/enrichment/bulk-run', { preHandler: authMiddleware }, async (req, reply) => {
    const body = req.body as { leadIds?: number[]; maxTier?: 1 | 2 | 3; force?: boolean }
    if (!Array.isArray(body?.leadIds) || body.leadIds.length === 0) {
      return reply.code(400).send({ error: 'leadIds obrigatório (array não vazio)' })
    }
    const ids = body.leadIds.map(Number).filter(Boolean).slice(0, 500)
    const maxTier = (body.maxTier === 1 || body.maxTier === 2 || body.maxTier === 3) ? body.maxTier : 3
    const force = body.force === true

    const consented = await prisma.lead.findMany({
      where: { id: { in: ids }, lgpdConsent: true },
      select: { id: true },
    })
    const consentedIds = new Set(consented.map(l => l.id))
    let enqueued = 0
    for (const id of ids) {
      if (!consentedIds.has(id)) continue
      try {
        await queues.enrichment.add('enrich', { leadId: id, maxTier, force }, {
          attempts: 2,
          backoff: { type: 'exponential', delay: 5000 },
        })
        enqueued++
      } catch (err) {
        console.error('[bulk-run] falha ao enfileirar:', err)
      }
    }
    return reply.send({ ok: true, enqueued, skipped: ids.length - enqueued })
  })

  // Registrar consentimento LGPD em massa — usado pela página Inteligência.
  // POST /api/bychat/leads/lgpd/bulk  { leadIds: number[], consent: boolean, runEnrichment?: boolean }
  app.post('/api/bychat/leads/lgpd/bulk', { preHandler: authMiddleware }, async (req, reply) => {
    const body = req.body as { leadIds: number[]; consent: boolean; runEnrichment?: boolean }
    if (!Array.isArray(body?.leadIds) || body.leadIds.length === 0) {
      return reply.code(400).send({ error: 'leadIds obrigatório (array não vazio)' })
    }
    if (typeof body.consent !== 'boolean') {
      return reply.code(400).send({ error: 'consent obrigatório (boolean)' })
    }

    const ids = body.leadIds.map(Number).filter(Boolean).slice(0, 500)
    const now = body.consent ? new Date() : null
    const operator = (req as any).user as { userId?: number } | undefined
    const operatorUserId = operator?.userId ?? null

    const result = await prisma.lead.updateMany({
      where: { id: { in: ids } },
      data: {
        lgpdConsent: body.consent,
        lgpdConsentAt: now,
        // Bulk pelo painel é SEMPRE operator_override — operador assumindo base legal
        // própria (ex: contrato comercial, interesse legítimo). Nunca finja titular.
        lgpdConsentSource: body.consent ? 'operator_override' : null,
        lgpdConsentBy: body.consent ? operatorUserId : null,
        ...(body.consent ? { enrichmentStatus: 'pending' } : {}),
      },
    })

    // Log de auditoria por lead (fire-and-forget, não bloqueia resposta)
    for (const id of ids) {
      logEvent({
        leadId: id,
        type: 'lgpd_consent',
        category: 'system',
        title: body.consent ? 'Consentimento LGPD (massa — operador)' : 'Consentimento LGPD revogado (massa — operador)',
        channel: 'system',
        source: 'panel',
        actorType: 'operator',
        ipAddress: getIp(req),
      })
    }

    // Enfileira enriquecimento se solicitado
    let enqueued = 0
    if (body.consent && body.runEnrichment !== false) {
      for (const id of ids) {
        try {
          await queues.enrichment.add('enrich', { leadId: id }, {
            attempts: 2,
            backoff: { type: 'exponential', delay: 5000 },
          })
          enqueued++
        } catch (err) {
          console.error('[bulk-lgpd] falha ao enfileirar:', err)
        }
      }
    }

    return reply.send({
      ok: true,
      updated: result.count,
      enqueued,
      consent: body.consent,
    })
  })

  // Dossiê consolidado (JSON)
  app.get('/api/bychat/leads/:id/dossier', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { buildDossier } = await import('../services/enrichment/dossier.js')
    const dossier = await buildDossier(parseInt(id))
    return reply.send(dossier)
  })

  // Gerar/regenerar Sugestões de abordagem por IA (botão na aba Inteligência do lead).
  // Lê Contexto do Negócio + persona padrão + funil + custom fields + enrichment ativo.
  // Se faltar contexto essencial (nome da empresa + oferta), devolve missingContext sem chamar IA.
  app.post('/api/bychat/leads/:id/approach-suggestions', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const userId = (req as any).user?.id as number | undefined
    const { generateApproachSuggestions } = await import('../services/aiApproachSuggestions.js')
    try {
      const result = await generateApproachSuggestions(parseInt(id), { actorUserId: userId })
      return reply.send(result)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return reply.code(500).send({ error: msg })
    }
  })

  // Insights heurísticos (chips contextuais para o vendedor)
  app.get('/api/bychat/leads/:id/insights', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { buildInsights } = await import('../services/enrichment/insights.js')
    const insights = await buildInsights(parseInt(id))
    return reply.send({ insights })
  })

  // Dossiê em PDF
  app.get('/api/bychat/leads/:id/dossier.pdf', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { buildDossier, renderDossierPdf } = await import('../services/enrichment/dossier.js')
    const dossier = await buildDossier(parseInt(id))
    const pdf = await renderDossierPdf(dossier)
    reply.header('Content-Type', 'application/pdf')
    reply.header('Content-Disposition', `attachment; filename="dossie-${dossier.lead.id}.pdf"`)
    return reply.send(pdf)
  })

  // Remover um fato específico (direito de exclusão LGPD art. 18)
  app.delete('/api/bychat/leads/:id/enrichment/:factId', { preHandler: authMiddleware }, async (req, reply) => {
    const { id, factId } = req.params as { id: string; factId: string }
    await prisma.leadEnrichment.delete({ where: { id: parseInt(factId) } })
    return reply.send({ ok: true })
  })

  // Marcar fato como contestado (operador discorda do dado, mas preserva histórico).
  // Esses fatos são ocultados do dossier e da listagem padrão, mas continuam no banco
  // para auditoria — e permitem que o motor aprenda a não confiar na fonte.
  app.post('/api/bychat/leads/:id/enrichment/:factId/dispute', { preHandler: authMiddleware }, async (req, reply) => {
    const { id, factId } = req.params as { id: string; factId: string }
    const body = (req.body ?? {}) as { reason?: string; restore?: boolean }
    const fact = await prisma.leadEnrichment.findUnique({ where: { id: parseInt(factId) } })
    if (!fact || fact.leadId !== parseInt(id)) return reply.code(404).send({ error: 'Fato não encontrado' })

    const newStatus = body.restore ? 'active' : 'disputed'
    await prisma.leadEnrichment.update({
      where: { id: fact.id },
      data: {
        status: newStatus,
        rawData: {
          ...((fact.rawData ?? {}) as Record<string, unknown>),
          disputed: body.restore ? null : { at: new Date().toISOString(), reason: body.reason ?? null },
        },
      },
    })

    logEvent({
      leadId: fact.leadId,
      type: body.restore ? 'enrichment_fact_restored' : 'enrichment_fact_disputed',
      category: 'system',
      title: body.restore
        ? `Fato restaurado: ${fact.source}.${fact.field}`
        : `Fato contestado: ${fact.source}.${fact.field}`,
      description: body.reason ?? undefined,
      channel: 'system',
      source: 'panel',
      actorType: 'operator',
      ipAddress: getIp(req),
    })

    return reply.send({ ok: true, status: newStatus })
  })

  // Confirmar um CANDIDATO (descoberta por nome) como verdadeiro → vira fato 'active'
  // e passa a contar no dossiê. Marca rawData.confirmed para sobreviver a re-runs.
  app.post('/api/bychat/leads/:id/enrichment/:factId/confirm', { preHandler: authMiddleware }, async (req, reply) => {
    const { id, factId } = req.params as { id: string; factId: string }
    const fact = await prisma.leadEnrichment.findUnique({ where: { id: parseInt(factId) } })
    if (!fact || fact.leadId !== parseInt(id)) return reply.code(404).send({ error: 'Candidato não encontrado' })

    await prisma.leadEnrichment.update({
      where: { id: fact.id },
      data: {
        status: 'active',
        rawData: { ...((fact.rawData ?? {}) as Record<string, unknown>), confirmed: { at: new Date().toISOString() } },
      },
    })
    logEvent({
      leadId: fact.leadId,
      type: 'enrichment_candidate_confirmed',
      category: 'system',
      title: `Candidato confirmado: ${fact.source}.${fact.field}`,
      channel: 'system', source: 'panel', actorType: 'operator', ipAddress: getIp(req),
    })
    return reply.send({ ok: true, status: 'active' })
  })

  // Descartar um CANDIDATO (não é a pessoa) → status 'rejected' (some da lista,
  // preserva histórico para o motor aprender a não confiar na fonte/query).
  app.post('/api/bychat/leads/:id/enrichment/:factId/dismiss', { preHandler: authMiddleware }, async (req, reply) => {
    const { id, factId } = req.params as { id: string; factId: string }
    const body = (req.body ?? {}) as { reason?: string }
    const fact = await prisma.leadEnrichment.findUnique({ where: { id: parseInt(factId) } })
    if (!fact || fact.leadId !== parseInt(id)) return reply.code(404).send({ error: 'Candidato não encontrado' })

    await prisma.leadEnrichment.update({
      where: { id: fact.id },
      data: {
        status: 'rejected',
        rawData: { ...((fact.rawData ?? {}) as Record<string, unknown>), dismissed: { at: new Date().toISOString(), reason: body.reason ?? null } },
      },
    })
    logEvent({
      leadId: fact.leadId,
      type: 'enrichment_candidate_dismissed',
      category: 'system',
      title: `Candidato descartado: ${fact.source}.${fact.field}`,
      description: body.reason ?? undefined,
      channel: 'system', source: 'panel', actorType: 'operator', ipAddress: getIp(req),
    })
    return reply.send({ ok: true, status: 'rejected' })
  })

  // Lista as promoções do último enriquecimento (campos do Lead que foram preenchidos
  // automaticamente a partir dos fatos coletados).
  app.get('/api/bychat/leads/:id/enrichment/promotions', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const leadId = parseInt(id)
    if (!leadId) return reply.code(400).send({ error: 'ID inválido' })

    const lastEvent = await prisma.leadEvent.findFirst({
      where: { leadId, type: 'enrichment_completed' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, createdAt: true, metadata: true },
    })

    if (!lastEvent || !lastEvent.metadata) {
      return reply.send({ eventId: null, promotions: [], at: null })
    }

    const meta = lastEvent.metadata as { promoted?: { field: string; oldValue: string | null; newValue: string; source: string; confidence: number }[] }
    return reply.send({
      eventId: lastEvent.id,
      at: lastEvent.createdAt,
      promotions: Array.isArray(meta.promoted) ? meta.promoted : [],
    })
  })

  // Reverte um campo promovido para seu valor anterior. O field deve ser um dos campos
  // promovíveis (email/empresa/cidade) e deve aparecer no metadata do evento.
  app.post('/api/bychat/leads/:id/enrichment/revert-promotion', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const leadId = parseInt(id)
    const body = req.body as { eventId?: number; field?: string }
    if (!leadId || !body?.eventId || !body?.field) {
      return reply.code(400).send({ error: 'eventId e field obrigatórios' })
    }

    const event = await prisma.leadEvent.findUnique({ where: { id: body.eventId } })
    if (!event || event.leadId !== leadId || event.type !== 'enrichment_completed') {
      return reply.code(404).send({ error: 'Evento não encontrado' })
    }
    const meta = event.metadata as { promoted?: { field: string; oldValue: string | null; newValue: string }[] } | null
    const promo = meta?.promoted?.find(p => p.field === body.field)
    if (!promo) return reply.code(404).send({ error: 'Promoção não encontrada' })

    const allowed = new Set(['email', 'empresa', 'cidade'])
    if (!allowed.has(body.field)) return reply.code(400).send({ error: 'field não revertível' })

    // Strings não-nuláveis no schema (email/empresa) — restaurar como string vazia se oldValue é null.
    // cidade é nullable, então pode receber null direto.
    const restored = promo.oldValue ?? (body.field === 'cidade' ? null : '')
    await prisma.lead.update({
      where: { id: leadId },
      data: { [body.field]: restored } as any,
    })

    // Marca a promoção como revertida (mantém histórico, só sinaliza)
    const newPromoted = (meta?.promoted ?? []).map(p =>
      p.field === body.field ? { ...p, revertedAt: new Date().toISOString() } : p,
    )
    await prisma.leadEvent.update({
      where: { id: event.id },
      data: { metadata: { ...(meta as any), promoted: newPromoted } },
    })

    logEvent({
      leadId,
      type: 'enrichment_promotion_reverted',
      category: 'system',
      title: `Promoção revertida: ${body.field}`,
      channel: 'system',
      source: 'panel',
      actorType: 'operator',
      oldValue: promo.newValue,
      newValue: typeof restored === 'string' ? restored : undefined,
      ipAddress: getIp(req),
    })

    return reply.send({ ok: true, restored })
  })
}
