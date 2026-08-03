import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware, adminOnly, type JwtPayload } from '../lib/auth.js'
import { buildLeadAccessWhere } from '../lib/teamAccess.js'

export async function kanbanRoutes(app: FastifyInstance) {

  // ── GET /api/admin/kanban/funnels-summary ──
  app.get('/api/admin/kanban/funnels-summary', { preHandler: authMiddleware }, async () => {
    const funnels = await prisma.funnel.findMany({
      where: { active: true },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      include: {
        stages: { where: { active: true }, orderBy: { position: 'asc' }, select: { id: true, key: true, name: true, color: true } },
        _count: { select: { leads: true, stages: true } }
      }
    })

    // Count leads per stage for each funnel
    const result = await Promise.all(funnels.map(async (f) => {
      const stageCounts = await prisma.lead.groupBy({
        by: ['status'],
        where: { funnelId: f.id },
        _count: true
      })
      const stageMap: Record<string, number> = {}
      stageCounts.forEach(sc => { stageMap[sc.status] = sc._count })

      return {
        id: f.id,
        name: f.name,
        description: f.description,
        isDefault: f.isDefault,
        createdAt: f.createdAt,
        stageCount: f._count.stages,
        leadCount: f._count.leads,
        stages: f.stages.map(s => ({ ...s, leadCount: stageMap[s.key] || 0 }))
      }
    }))

    return { funnels: result }
  })

  // ── GET /api/admin/kanban/board ──
  app.get('/api/admin/kanban/board', { preHandler: authMiddleware }, async (req) => {
    const user = (req as any).user as JwtPayload
    const q = req.query as any
    const qFunnelId = q.funnelId

    // Resolve funnel
    let funnelId: number | undefined
    if (qFunnelId) {
      funnelId = Number(qFunnelId)
    } else {
      const def = await prisma.funnel.findFirst({ where: { isDefault: true } })
      funnelId = def?.id
    }

    const stageWhere: any = { active: true }
    // Kanban exibe apenas leads qualificados — conversas WhatsApp ad-hoc ficam
    // na aba Conversas até que o operador as promova.
    const leadWhere: any = { qualifiedAt: { not: null } }
    if (funnelId) {
      stageWhere.funnelId = funnelId
      leadWhere.funnelId = funnelId
    }

    // Filtros compartilhados com /api/bychat/leads — Kanban respeita os mesmos
    // filtros aplicados pelo operador no SavedFiltersBar (scope='leads').
    if (q.outcome === 'open') leadWhere.outcome = null
    else if (q.outcome === 'won') leadWhere.outcome = 'won'
    else if (q.outcome === 'lost') leadWhere.outcome = 'lost'
    else if (q.outcome === 'classified') leadWhere.outcome = { in: ['won', 'lost'] }

    if (q.aiScoreLabel && ['hot', 'warm', 'cold'].includes(q.aiScoreLabel)) {
      leadWhere.aiScoreLabel = q.aiScoreLabel
    }

    if (q.sources) {
      const arr = String(q.sources).split(',').map((s: string) => s.trim()).filter(Boolean)
      if (arr.length > 0) leadWhere.source = { in: arr }
    } else if (q.source) {
      leadWhere.source = String(q.source)
    }

    if (q.assignedUserIds) {
      const ids = String(q.assignedUserIds).split(',').map((s: string) => parseInt(s.trim())).filter(Number.isInteger)
      if (ids.length > 0) leadWhere.assignedUserId = { in: ids }
    } else if (q.assignedUserId === 'me') {
      leadWhere.assignedUserId = user.userId
    } else if (q.assignedUserId) {
      const id = parseInt(String(q.assignedUserId))
      if (Number.isInteger(id)) leadWhere.assignedUserId = id
    } else if (q.onlyUnassigned === '1') {
      leadWhere.assignedUserId = null
    }

    if (q.tagIds) {
      const ids = String(q.tagIds).split(',').map((s: string) => parseInt(s.trim())).filter(Number.isInteger)
      if (ids.length > 0) leadWhere.tags = { some: { tagId: { in: ids } } }
    }

    if (q.dateFrom || q.dateTo) {
      leadWhere.createdAt = {}
      if (q.dateFrom) leadWhere.createdAt.gte = new Date(q.dateFrom)
      if (q.dateTo) leadWhere.createdAt.lte = new Date(q.dateTo + 'T23:59:59')
    }

    if (q.search) {
      leadWhere.OR = [
        { empresa: { contains: q.search } },
        { nome: { contains: q.search } },
        { whatsapp: { contains: q.search } },
        { email: { contains: q.search } },
      ]
    }

    // Reforma F1: scope efetivo do user no módulo 'leads'.
    const scopeWhere = await buildLeadAccessWhere(user.userId, user.role)
    const andClauses: any[] = []
    if (Object.keys(scopeWhere).length > 0) andClauses.push(scopeWhere)
    // Toggle "Ocultar perdidos": esconde outcome='lost', mantendo abertos (null) e
    // ganhos. Só aplica quando NÃO há filtro outcome explícito (o filtro vence).
    // OR explícito porque { not: 'lost' } no Prisma exclui linhas NULL.
    if (q.hideLost === '1' && !q.outcome) {
      andClauses.push({ OR: [{ outcome: null }, { outcome: { not: 'lost' } }] })
    }
    if (andClauses.length > 0) leadWhere.AND = andClauses

    const [stages, leads, perm, funnels] = await Promise.all([
      prisma.stage.findMany({ where: stageWhere, orderBy: { position: 'asc' } }),
      prisma.lead.findMany({ where: leadWhere, orderBy: { createdAt: 'desc' },
        select: { id: true, empresa: true, nome: true, whatsapp: true, email: true, scores: true, status: true, source: true, metaFormId: true, completed: true, createdAt: true, updatedAt: true, annotation: true, outcome: true, outcomeAt: true,
          // O card exibe os campos personalizados marcados showInKanban.
          customFields: true,
          assignedUserId: true, assignedAt: true, teamId: true,
          assignedUser: { select: { id: true, name: true } },
          // Módulo Resumo: o card mostra o código da situação atual.
          statusSummary: { select: { id: true, code: true, name: true, color: true } },
          tags: { select: { tag: { select: { id: true, name: true, color: true } } } } }
      }),
      prisma.kanbanPermission.findUnique({ where: { role: user.role as any } }),
      prisma.funnel.findMany({ where: { active: true }, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }], select: { id: true, name: true, isDefault: true } })
    ])

    // Count pending activities per lead
    const leadIds = leads.map(l => l.id)
    const actCounts = leadIds.length > 0 ? await prisma.activity.groupBy({
      by: ['leadId'],
      where: { leadId: { in: leadIds }, status: { in: ['pending', 'overdue'] } },
      _count: true,
    }) : []
    const actMap: Record<number, number> = {}
    actCounts.forEach(a => { actMap[a.leadId] = a._count })

    // Lookup Meta form names
    const metaFormIds = [...new Set(leads.map(l => l.metaFormId).filter(Boolean))] as string[]
    const metaFormNames: Record<string, string> = {}
    if (metaFormIds.length > 0) {
      const forms = await prisma.metaForm.findMany({ where: { formId: { in: metaFormIds } }, select: { formId: true, formName: true } })
      forms.forEach(f => { metaFormNames[f.formId] = f.formName })
    }

    // Lead classificado (outcome=won/lost) permanece na etapa que o gestor escolheu —
    // o badge/cor no card sinaliza o estado sem o sistema impor uma coluna fixa.
    const grouped: Record<string, any[]> = {}
    stages.forEach(s => { grouped[s.key] = [] })
    leads.forEach(l => {
      const enriched = { ...l, _activityCount: actMap[l.id] || 0, _metaFormName: l.metaFormId ? metaFormNames[l.metaFormId] || null : null }
      if (grouped[l.status]) grouped[l.status].push(enriched)
    })

    return {
      stages,
      leads: grouped,
      funnels,
      currentFunnelId: funnelId,
      permissions: {
        // SUPERADMIN sempre tudo. Caso a row da role esteja na tabela, vale ela.
        // Senão, default seguro: ADMIN/MANAGER/AGENT podem avançar (operacional);
        // só ADMIN pode retroceder por default. VIEWER nunca move.
        canAdvance: user.role === 'SUPERADMIN'
          ? true
          : (perm?.canAdvance ?? ['ADMIN', 'MANAGER', 'AGENT'].includes(user.role)),
        canRetreat: user.role === 'SUPERADMIN'
          ? true
          : (perm?.canRetreat ?? user.role === 'ADMIN'),
      }
    }
  })

  // ── GET /api/admin/kanban/permissions ──
  app.get('/api/admin/kanban/permissions', { preHandler: adminOnly }, async () => {
    const perms = await prisma.kanbanPermission.findMany()
    return { permissions: perms }
  })

  // ── PUT /api/admin/kanban/permissions ──
  app.put('/api/admin/kanban/permissions', { preHandler: adminOnly }, async (req) => {
    const { permissions } = req.body as any
    for (const p of permissions) {
      await prisma.kanbanPermission.upsert({
        where: { role: p.role },
        update: { canAdvance: p.canAdvance, canRetreat: p.canRetreat },
        create: { role: p.role, canAdvance: p.canAdvance, canRetreat: p.canRetreat }
      })
    }
    return { ok: true }
  })
}
