// src/routes/teams.ts
// Equipes (setores) — CRUD + gestão de membros para atendimento humano.

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { moveToTrash, snapshotEntity } from '../services/trash.js'
import { authMiddleware, adminOnly, type JwtPayload } from '../lib/auth.js'
import { isAdminRole, isTeamLeader } from '../lib/teamAccess.js'

// Guard: permite ADMIN/SUPERADMIN OU líder do setor específico (rota tem :id).
// Para uso em endpoints de gestão de membros (POST/PUT/DELETE /admin/teams/:id/members[/:userId]).
async function requireTeamLeaderOrAdmin(req: FastifyRequest, reply: FastifyReply) {
  await authMiddleware(req, reply)
  if (reply.sent) return
  const user = (req as any).user as JwtPayload
  if (isAdminRole(user.role)) return
  const params = req.params as any
  const teamId = parseInt(params?.id)
  if (!teamId) {
    return reply.code(400).send({ error: 'teamId inválido' })
  }
  if (await isTeamLeader(user.userId, teamId)) return
  return reply.code(403).send({ error: 'Apenas administradores ou líderes deste setor podem alterar membros' })
}

const TEAM_SELECT = {
  id: true, name: true, slug: true, description: true,
  color: true, icon: true, active: true, position: true,
  routingMode: true,
  createdAt: true, updatedAt: true,
}

const MEMBER_SELECT = {
  id: true, isLeader: true, createdAt: true,
  user: { select: { id: true, name: true, email: true, role: true, active: true, lastSeenAt: true } },
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 50)
}

export async function teamsRoutes(app: FastifyInstance) {

  // ── GET /api/teams — Listar equipes ativas (qualquer autenticado) ──
  app.get('/api/teams', { preHandler: authMiddleware }, async () => {
    const teams = await prisma.team.findMany({
      where: { active: true },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
      select: TEAM_SELECT,
    })
    return { teams }
  })

  // ── GET /api/admin/teams — Listar todas (incluindo inativas) com contadores ──
  // Aberto para qualquer autenticado: Manager precisa ver setores para gerenciar membros nos seus.
  app.get('/api/admin/teams', { preHandler: authMiddleware }, async () => {
    const teams = await prisma.team.findMany({
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
      select: {
        ...TEAM_SELECT,
        _count: { select: { members: true, leads: true, chatbots: true } },
      },
    })
    return {
      teams: teams.map(t => ({
        ...t,
        memberCount: t._count.members,
        leadCount: t._count.leads,
        chatbotCount: t._count.chatbots,
        _count: undefined,
      })),
    }
  })

  // ── POST /api/admin/teams — Criar equipe ──
  app.post('/api/admin/teams', { preHandler: adminOnly }, async (req, reply) => {
    const body = req.body as any
    if (!body.name || !String(body.name).trim()) {
      return reply.code(400).send({ error: 'Nome obrigatório' })
    }

    const name = String(body.name).trim()
    const slug = body.slug ? slugify(body.slug) : slugify(name)
    if (!slug) return reply.code(400).send({ error: 'Slug inválido' })

    const existing = await prisma.team.findUnique({ where: { slug } })
    if (existing) return reply.code(409).send({ error: `Já existe equipe com slug "${slug}"` })

    const maxPos = await prisma.team.aggregate({ _max: { position: true } })

    const allowedModes = ['manual', 'round_robin', 'least_loaded', 'random']
    const team = await prisma.team.create({
      data: {
        name,
        slug,
        description: body.description ? String(body.description).substring(0, 255) : null,
        color: body.color || '#6B7280',
        icon: body.icon || null,
        position: body.position ?? ((maxPos._max.position ?? -1) + 1),
        active: body.active ?? true,
        routingMode: allowedModes.includes(body.routingMode) ? body.routingMode : 'manual',
      },
      select: TEAM_SELECT,
    })

    return reply.code(201).send({ ok: true, team })
  })

  // ── PUT /api/admin/teams/:id — Editar equipe ──
  app.put('/api/admin/teams/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const body = req.body as any

    const data: any = {}
    if (body.name !== undefined) data.name = String(body.name).trim()
    if (body.slug !== undefined) {
      const newSlug = slugify(body.slug)
      if (!newSlug) return reply.code(400).send({ error: 'Slug inválido' })
      const conflict = await prisma.team.findFirst({
        where: { slug: newSlug, NOT: { id: parseInt(id) } },
      })
      if (conflict) return reply.code(409).send({ error: `Slug "${newSlug}" já em uso` })
      data.slug = newSlug
    }
    if (body.description !== undefined) data.description = body.description ? String(body.description).substring(0, 255) : null
    if (body.color !== undefined) data.color = body.color
    if (body.icon !== undefined) data.icon = body.icon || null
    if (body.position !== undefined) data.position = body.position
    if (body.active !== undefined) data.active = body.active
    if (body.routingMode !== undefined) {
      const allowedModes = ['manual', 'round_robin', 'least_loaded', 'random']
      if (!allowedModes.includes(body.routingMode)) {
        return reply.code(400).send({ error: 'routingMode inválido', allowed: allowedModes })
      }
      data.routingMode = body.routingMode
    }

    try {
      const team = await prisma.team.update({
        where: { id: parseInt(id) },
        data,
        select: TEAM_SELECT,
      })
      return { ok: true, team }
    } catch (err: any) {
      if (err.code === 'P2025') return reply.code(404).send({ error: 'Equipe não encontrada' })
      throw err
    }
  })

  // ── DELETE /api/admin/teams/:id — Deletar equipe ──
  // Leads e chatbots vinculados ficam com teamId NULL (ON DELETE SET NULL).
  app.delete('/api/admin/teams/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const user = (req as any).user as JwtPayload
    try {
      const snapshot = await snapshotEntity('team', parseInt(id))
      if (snapshot) {
        await moveToTrash({
          entityType: 'team', entityId: parseInt(id), entityLabel: (snapshot as any).name,
          snapshot, deletedBy: user?.userId, deletedByName: user?.name || user?.email,
        })
      }
      await prisma.team.delete({ where: { id: parseInt(id) } })
      return { ok: true }
    } catch (err: any) {
      if (err.code === 'P2025') return reply.code(404).send({ error: 'Equipe não encontrada' })
      throw err
    }
  })

  // ── PUT /api/admin/teams/reorder — Reordenar ──
  app.put('/api/admin/teams/reorder', { preHandler: adminOnly }, async (req, reply) => {
    const { items } = req.body as any
    if (!Array.isArray(items)) return reply.code(400).send({ error: 'items obrigatório' })
    for (const item of items) {
      await prisma.team.update({ where: { id: item.id }, data: { position: item.position } })
    }
    return { ok: true }
  })

  // ── GET /api/admin/teams/:id/members — Listar membros (qualquer autenticado) ──
  app.get('/api/admin/teams/:id/members', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const team = await prisma.team.findUnique({ where: { id: parseInt(id) }, select: { id: true } })
    if (!team) return reply.code(404).send({ error: 'Equipe não encontrada' })

    const members = await prisma.teamMember.findMany({
      where: { teamId: parseInt(id) },
      orderBy: [{ isLeader: 'desc' }, { createdAt: 'asc' }],
      select: MEMBER_SELECT,
    })
    return { members }
  })

  // ── GET /api/admin/teams/:id/eligible-members — Usuários ativos que ainda NÃO são membros ──
  // Permite admin OU líder do setor (mesmo guard das mutações de membro).
  // Endpoint dedicado para evitar dependência de /api/admin/users (admin-only).
  app.get('/api/admin/teams/:id/eligible-members', { preHandler: requireTeamLeaderOrAdmin }, async (req, reply) => {
    const { id } = req.params as any
    const teamId = parseInt(id)
    const currentMembers = await prisma.teamMember.findMany({
      where: { teamId },
      select: { userId: true },
    })
    const memberIds = currentMembers.map(m => m.userId)
    const candidates = await prisma.user.findMany({
      where: {
        active: true,
        id: { notIn: memberIds.length > 0 ? memberIds : [-1] },
      },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, email: true, role: true },
    })
    return { candidates }
  })

  // ── POST /api/admin/teams/:id/members — Adicionar membro ──
  // Admin OU líder do setor pode gerenciar membros.
  app.post('/api/admin/teams/:id/members', { preHandler: requireTeamLeaderOrAdmin }, async (req, reply) => {
    const { id } = req.params as any
    const body = req.body as any
    if (!body.userId) return reply.code(400).send({ error: 'userId obrigatório' })

    const teamId = parseInt(id)
    const userId = parseInt(body.userId)

    const [team, user] = await Promise.all([
      prisma.team.findUnique({ where: { id: teamId }, select: { id: true } }),
      prisma.user.findUnique({ where: { id: userId }, select: { id: true } }),
    ])
    if (!team) return reply.code(404).send({ error: 'Equipe não encontrada' })
    if (!user) return reply.code(404).send({ error: 'Usuário não encontrado' })

    const existing = await prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
    })
    if (existing) return reply.code(409).send({ error: 'Usuário já é membro desta equipe' })

    const member = await prisma.teamMember.create({
      data: { teamId, userId, isLeader: !!body.isLeader },
      select: MEMBER_SELECT,
    })
    return reply.code(201).send({ ok: true, member })
  })

  // ── PUT /api/admin/teams/:id/members/:userId — Atualizar membro (isLeader) ──
  // Admin OU líder do setor.
  app.put('/api/admin/teams/:id/members/:userId', { preHandler: requireTeamLeaderOrAdmin }, async (req, reply) => {
    const { id, userId } = req.params as any
    const body = req.body as any

    const data: any = {}
    if (body.isLeader !== undefined) data.isLeader = !!body.isLeader

    try {
      const member = await prisma.teamMember.update({
        where: { teamId_userId: { teamId: parseInt(id), userId: parseInt(userId) } },
        data,
        select: MEMBER_SELECT,
      })
      return { ok: true, member }
    } catch (err: any) {
      if (err.code === 'P2025') return reply.code(404).send({ error: 'Membro não encontrado' })
      throw err
    }
  })

  // ── DELETE /api/admin/teams/:id/members/:userId — Remover membro ──
  // Admin OU líder do setor.
  app.delete('/api/admin/teams/:id/members/:userId', { preHandler: requireTeamLeaderOrAdmin }, async (req, reply) => {
    const { id, userId } = req.params as any
    try {
      await prisma.teamMember.delete({
        where: { teamId_userId: { teamId: parseInt(id), userId: parseInt(userId) } },
      })
      return { ok: true }
    } catch (err: any) {
      if (err.code === 'P2025') return reply.code(404).send({ error: 'Membro não encontrado' })
      throw err
    }
  })

  // ── GET /api/admin/teams/orphans — Contagem de leads sem setor ──
  app.get('/api/admin/teams/orphans', { preHandler: adminOnly }, async () => {
    const count = await prisma.lead.count({ where: { teamId: null } })
    return { count }
  })

  // ── POST /api/admin/teams/apply-fallback — Aplicar setor fallback global em leads órfãos ──
  // Usa o setting default_team_id como destino. Atualiza apenas leads com teamId NULL.
  // Útil após configurar fallback global pela primeira vez (leads históricos).
  app.post('/api/admin/teams/apply-fallback', { preHandler: adminOnly }, async (req, reply) => {
    const body = (req.body as any) || {}
    // Permite override do teamId destino via body.teamId; senão busca o setting global
    let teamId: number | null = body.teamId ? parseInt(body.teamId) : null
    if (!teamId) {
      const setting = await prisma.setting.findUnique({ where: { key: 'default_team_id' } })
      if (setting?.value != null) {
        const raw = setting.value as any
        if (typeof raw === 'number') teamId = raw
        else if (typeof raw === 'string' && /^\d+$/.test(raw)) teamId = parseInt(raw)
        else if (typeof raw === 'object' && typeof raw.id === 'number') teamId = raw.id
      }
    }
    if (!teamId) {
      return reply.code(400).send({ error: 'Setor fallback global não configurado. Configure em Equipes antes de aplicar.' })
    }

    const team = await prisma.team.findUnique({ where: { id: teamId }, select: { id: true, name: true, active: true } })
    if (!team || !team.active) return reply.code(400).send({ error: 'Setor destino inválido ou inativo' })

    const result = await prisma.lead.updateMany({
      where: { teamId: null },
      data: { teamId },
    })

    return { ok: true, affected: result.count, teamId, teamName: team.name }
  })

  // ── GET /api/admin/team-metrics — Performance dos operadores ──
  // Query: from (ISO), to (ISO), teamId?, userId?, funnelId?, qualificationSource?
  // Retorna por operador: 15+ KPIs (volume, conversão, receita, atividade,
  // produtividade, tempos). Totais agregados no header da página.
  app.get('/api/admin/team-metrics', { preHandler: authMiddleware }, async (req, reply) => {
    const q = req.query as any
    const from = q.from ? new Date(q.from) : new Date(Date.now() - 30 * 24 * 3600 * 1000)
    const to = q.to ? new Date(q.to) : new Date()
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return reply.code(400).send({ error: 'from/to inválidos (use ISO 8601)' })
    }
    const teamFilter = q.teamId ? Number(q.teamId) : null
    const userFilter = q.userId ? Number(q.userId) : null
    const funnelFilter = q.funnelId ? Number(q.funnelId) : null
    const qualificationFilter = q.qualificationSource ? String(q.qualificationSource) : null

    // Universo: leads atribuídos no período (assignedAt como âncora — conta o
    // trabalho do operador, não a criação).
    const where: any = {
      assignedUserId: userFilter ?? { not: null },
      assignedAt: { gte: from, lte: to },
    }
    if (teamFilter) where.teamId = teamFilter
    if (funnelFilter) where.funnelId = funnelFilter
    if (qualificationFilter) where.qualificationSource = qualificationFilter

    const leads = await prisma.lead.findMany({
      where,
      select: {
        id: true,
        assignedUserId: true,
        teamId: true,
        createdAt: true,
        assignedAt: true,
        conversationOpenedAt: true,
        conversationClosedAt: true,
        outcome: true,
        outcomeAt: true,
        saleValue: true,
        priorityScore: true,
        qualificationSource: true,
      },
    })

    const leadIds = leads.map((l) => l.id)
    const leadIdToOperator = new Map<number, number>()
    for (const l of leads) if (l.assignedUserId) leadIdToOperator.set(l.id, l.assignedUserId)

    // ── Coleta paralela de dados auxiliares ────────────────────────────
    const [firstReplies, activities, messagesByOp, stageMovements, cadenceManualSteps] = await Promise.all([
      // Primeira mensagem do operador após assignedAt (tempo de primeira resposta).
      leadIds.length === 0 ? Promise.resolve([]) : prisma.message.findMany({
        where: {
          leadId: { in: leadIds },
          fromMe: true,
          isInternal: false,
        },
        orderBy: [{ leadId: 'asc' }, { timestamp: 'asc' }],
        select: { leadId: true, timestamp: true },
        // pega só primeira por lead na agregação.
      }),
      // Atividades criadas no período pelos operadores (filtro userIds).
      prisma.activity.findMany({
        where: {
          createdAt: { gte: from, lte: to },
          userId: userFilter ?? { not: null },
        },
        select: { id: true, userId: true, status: true, completedAt: true, scheduledAt: true },
      }),
      // Contagem de mensagens enviadas pelo operador no período.
      // Usa a junção via leadId atribuído ao operador.
      leadIds.length === 0 ? Promise.resolve([]) : prisma.message.groupBy({
        by: ['leadId'],
        where: {
          leadId: { in: leadIds },
          fromMe: true,
          timestamp: { gte: from, lte: to },
          isInternal: false,
        },
        _count: { _all: true },
      }),
      // Movimentações de stage feitas por usuário no período.
      prisma.leadStageMovement.groupBy({
        by: ['movedByUserId'],
        where: {
          movedAt: { gte: from, lte: to },
          movedByUserId: userFilter ?? { not: null },
        },
        _count: { _all: true },
      }),
      // Cadence steps manuais (tarefas de cadência) completadas pelo operador.
      prisma.cadenceStepExecution.groupBy({
        by: ['operatorUserId'],
        where: {
          executedAt: { gte: from, lte: to },
          operatorUserId: userFilter ?? { not: null },
          status: 'created_activity',
        },
        _count: { _all: true },
      }),
    ])

    // Primeira resposta por lead.
    const firstReplyByLead = new Map<number, Date>()
    for (const m of firstReplies) {
      if (!firstReplyByLead.has(m.leadId)) firstReplyByLead.set(m.leadId, m.timestamp)
    }

    // Mensagens enviadas por operador (somando todos os leads dele).
    const messagesByOpMap = new Map<number, number>()
    for (const m of messagesByOp) {
      const op = leadIdToOperator.get(m.leadId)
      if (!op) continue
      messagesByOpMap.set(op, (messagesByOpMap.get(op) ?? 0) + m._count._all)
    }

    // Stage moves por operador (filtro adicional aplicado depois pra
    // teamId — leadStageMovement não tem teamId direto, então herda do lead).
    const stageMovesByUser = new Map<number, number>()
    for (const r of stageMovements) {
      if (r.movedByUserId !== null) stageMovesByUser.set(r.movedByUserId, r._count._all)
    }

    // Cadence steps manuais por operador.
    const cadenceStepsByUser = new Map<number, number>()
    for (const r of cadenceManualSteps) {
      if (r.operatorUserId !== null) cadenceStepsByUser.set(r.operatorUserId, r._count._all)
    }

    // Atividades por operador (criadas/completadas/overdue/pendentes).
    const activityByUser = new Map<number, {
      created: number
      completed: number
      pending: number
      overdue: number
      avgCompletionMs: number
      completionN: number
    }>()
    const now = Date.now()
    for (const a of activities) {
      if (a.userId === null) continue
      const acc = activityByUser.get(a.userId) ?? {
        created: 0, completed: 0, pending: 0, overdue: 0, avgCompletionMs: 0, completionN: 0,
      }
      acc.created++
      if (a.status === 'completed') {
        acc.completed++
        if (a.completedAt && a.scheduledAt) {
          const dt = a.completedAt.getTime() - a.scheduledAt.getTime()
          if (Number.isFinite(dt)) { acc.avgCompletionMs += dt; acc.completionN++ }
        }
      } else if (a.status === 'pending') {
        acc.pending++
        if (a.scheduledAt && a.scheduledAt.getTime() < now) acc.overdue++
      } else if (a.status === 'overdue') {
        acc.overdue++
      }
      activityByUser.set(a.userId, acc)
    }

    // Agrega lead-level por operador.
    const byUser = new Map<number, {
      total: number
      resolved: number
      won: number
      lost: number
      tmeMs: number; tmeN: number
      tmaMs: number; tmaN: number
      frtMs: number; frtN: number
      priorityScoreSum: number; priorityScoreN: number
      revenue: number; salesCount: number
    }>()
    for (const l of leads) {
      if (!l.assignedUserId) continue
      const acc = byUser.get(l.assignedUserId) ?? {
        total: 0, resolved: 0, won: 0, lost: 0,
        tmeMs: 0, tmeN: 0, tmaMs: 0, tmaN: 0, frtMs: 0, frtN: 0,
        priorityScoreSum: 0, priorityScoreN: 0,
        revenue: 0, salesCount: 0,
      }
      acc.total++
      if (l.outcome === 'won') {
        acc.resolved++; acc.won++
        // Receita = valor da venda do lead ganho (lead.saleValue), mesma fonte da
        // Visão Geral. DetectedSale foi abandonado (tabela vazia nos tenants).
        const sv = l.saleValue ? Number(l.saleValue) : 0
        if (sv > 0) { acc.revenue += sv; acc.salesCount++ }
      }
      else if (l.outcome === 'lost') { acc.resolved++; acc.lost++ }
      // TME
      if (l.assignedAt && l.createdAt) {
        const tme = l.assignedAt.getTime() - l.createdAt.getTime()
        if (tme >= 0) { acc.tmeMs += tme; acc.tmeN++ }
      }
      // TMA
      if (l.conversationOpenedAt && l.conversationClosedAt) {
        const tma = l.conversationClosedAt.getTime() - l.conversationOpenedAt.getTime()
        if (tma >= 0) { acc.tmaMs += tma; acc.tmaN++ }
      }
      // FRT — primeira resposta após assignedAt
      const reply = firstReplyByLead.get(l.id)
      if (l.assignedAt && reply && reply.getTime() >= l.assignedAt.getTime()) {
        const frt = reply.getTime() - l.assignedAt.getTime()
        if (frt >= 0) { acc.frtMs += frt; acc.frtN++ }
      }
      // Prioridade média dos leads atendidos
      if (typeof l.priorityScore === 'number') {
        acc.priorityScoreSum += l.priorityScore
        acc.priorityScoreN++
      }
      byUser.set(l.assignedUserId, acc)
    }

    // Buscar dados dos usuários — inclui usuários que têm atividade/movimentação
    // mesmo sem leads atribuídos no período.
    const allUserIds = new Set<number>()
    for (const id of byUser.keys()) allUserIds.add(id)
    for (const id of activityByUser.keys()) allUserIds.add(id)
    for (const id of stageMovesByUser.keys()) allUserIds.add(id)
    for (const id of cadenceStepsByUser.keys()) allUserIds.add(id)
    if (userFilter) allUserIds.add(userFilter)

    // Operadores = quem ATENDE leads, conforme "Roteamento de Leads > Agentes":
    // role AGENT (sempre) OU qualquer perfil marcado com o toggle isAgent=true
    // (ex.: um ADMIN habilitado como agente). ADMIN/MANAGER SEM o toggle não conta.
    const users = allUserIds.size === 0 ? [] : await prisma.user.findMany({
      where: { id: { in: Array.from(allUserIds) }, OR: [{ role: 'AGENT' }, { isAgent: true }] },
      select: { id: true, name: true, email: true, active: true, capacity: true, workStatus: true },
    })
    const userMap = new Map(users.map((u) => [u.id, u]))

    const operators = Array.from(allUserIds).filter((id) => userMap.has(id)).map((userId) => {
      const u = userMap.get(userId)
      const s = byUser.get(userId)
      const act = activityByUser.get(userId)
      const total = s?.total ?? 0
      const won = s?.won ?? 0
      const resolved = s?.resolved ?? 0
      return {
        userId,
        name: u?.name ?? null,
        email: u?.email ?? null,
        active: u?.active ?? false,
        capacity: u?.capacity ?? 5,
        workStatus: u?.workStatus ?? 'offline',
        leadsAttended: total,
        leadsResolved: resolved,
        leadsWon: won,
        leadsLost: s?.lost ?? 0,
        resolutionRate: total > 0 ? Math.round((resolved / total) * 1000) / 10 : 0,
        winRate: total > 0 ? Math.round((won / total) * 1000) / 10 : 0,
        avgWaitTimeMs: s && s.tmeN > 0 ? Math.round(s.tmeMs / s.tmeN) : null,
        avgHandlingTimeMs: s && s.tmaN > 0 ? Math.round(s.tmaMs / s.tmaN) : null,
        avgFirstResponseMs: s && s.frtN > 0 ? Math.round(s.frtMs / s.frtN) : null,
        avgPriorityScore: s && s.priorityScoreN > 0 ? Math.round((s.priorityScoreSum / s.priorityScoreN) * 10) / 10 : null,
        revenue: s?.revenue ?? 0,
        salesCount: s?.salesCount ?? 0,
        avgTicket: s && s.salesCount > 0 ? Math.round((s.revenue / s.salesCount) * 100) / 100 : 0,
        messagesSent: messagesByOpMap.get(userId) ?? 0,
        activitiesCreated: act?.created ?? 0,
        activitiesCompleted: act?.completed ?? 0,
        activitiesPending: act?.pending ?? 0,
        activitiesOverdue: act?.overdue ?? 0,
        avgActivityCompletionMs: act && act.completionN > 0 ? Math.round(act.avgCompletionMs / act.completionN) : null,
        stageMoves: stageMovesByUser.get(userId) ?? 0,
        cadenceManualSteps: cadenceStepsByUser.get(userId) ?? 0,
      }
    }).sort((a, b) => b.leadsAttended - a.leadsAttended || b.revenue - a.revenue)

    // Totais agregados
    const totalAttended = operators.reduce((s, o) => s + o.leadsAttended, 0)
    const totalWon = operators.reduce((s, o) => s + o.leadsWon, 0)
    const totalRevenue = operators.reduce((s, o) => s + o.revenue, 0)
    const totalSales = operators.reduce((s, o) => s + o.salesCount, 0)

    function avgOf(field: keyof typeof operators[number]): number | null {
      const list = operators
        .map((o) => o[field] as number | null)
        .filter((v): v is number => v !== null && v > 0)
      return list.length === 0 ? null : Math.round(list.reduce((s, v) => s + v, 0) / list.length)
    }

    const totals = {
      operators: operators.filter((o) => o.leadsAttended > 0).length,
      leadsAttended: totalAttended,
      leadsResolved: operators.reduce((s, o) => s + o.leadsResolved, 0),
      leadsWon: totalWon,
      leadsLost: operators.reduce((s, o) => s + o.leadsLost, 0),
      winRate: totalAttended > 0 ? Math.round((totalWon / totalAttended) * 1000) / 10 : 0,
      revenue: totalRevenue,
      salesCount: totalSales,
      avgTicket: totalSales > 0 ? Math.round((totalRevenue / totalSales) * 100) / 100 : 0,
      messagesSent: operators.reduce((s, o) => s + o.messagesSent, 0),
      activitiesCreated: operators.reduce((s, o) => s + o.activitiesCreated, 0),
      activitiesCompleted: operators.reduce((s, o) => s + o.activitiesCompleted, 0),
      activitiesOverdue: operators.reduce((s, o) => s + o.activitiesOverdue, 0),
      stageMoves: operators.reduce((s, o) => s + o.stageMoves, 0),
      cadenceManualSteps: operators.reduce((s, o) => s + o.cadenceManualSteps, 0),
      avgWaitTimeMs: avgOf('avgWaitTimeMs'),
      avgHandlingTimeMs: avgOf('avgHandlingTimeMs'),
      avgFirstResponseMs: avgOf('avgFirstResponseMs'),
    }

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      filters: {
        teamId: teamFilter,
        userId: userFilter,
        funnelId: funnelFilter,
        qualificationSource: qualificationFilter,
      },
      operators,
      totals,
    }
  })

  // ── GET /api/admin/team-metrics/operator/:userId/breakdown — Drill-down
  // por operador: distribuição de outcomes, top loss reasons, top fontes de
  // qualificação, série temporal de receita semanal. Só calcula no período.
  app.get<{ Params: { userId: string } }>(
    '/api/admin/team-metrics/operator/:userId/breakdown',
    { preHandler: authMiddleware },
    async (req, reply) => {
      const userId = Number(req.params.userId)
      if (!Number.isFinite(userId)) return reply.code(400).send({ error: 'userId inválido' })
      const q = req.query as any
      const from = q.from ? new Date(q.from) : new Date(Date.now() - 30 * 24 * 3600 * 1000)
      const to = q.to ? new Date(q.to) : new Date()
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        return reply.code(400).send({ error: 'from/to inválidos' })
      }

      const target = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, isAgent: true } })
      if (!target || (target.role !== 'AGENT' && !target.isAgent)) {
        return reply.code(404).send({ error: 'Operador não encontrado' })
      }

      const where: any = {
        assignedUserId: userId,
        assignedAt: { gte: from, lte: to },
      }

      const [outcomes, lossReasonsAgg, sources, salesTimeline, lossReasonsList] = await Promise.all([
        prisma.lead.groupBy({
          by: ['outcome'],
          where,
          _count: { _all: true },
        }),
        prisma.lead.groupBy({
          by: ['lostReasonId'],
          where: { ...where, outcome: 'lost', lostReasonId: { not: null } },
          _count: { _all: true },
        }),
        prisma.lead.groupBy({
          by: ['qualificationSource'],
          where: { ...where, qualificationSource: { not: null } },
          _count: { _all: true },
        }),
        // Receita por dia: leads ganhos (lead.saleValue) do operador no período.
        prisma.lead.findMany({
          where: { ...where, outcome: 'won', saleValue: { gt: 0 } },
          select: { saleValue: true, outcomeAt: true, assignedAt: true },
          orderBy: { outcomeAt: 'asc' },
        }),
        // Resolve nomes dos motivos de perda (top 5).
        prisma.lossReason.findMany({
          select: { id: true, name: true, color: true },
        }),
      ])

      // Outcomes em formato { won, lost, open }
      const outcomeMap: Record<string, number> = { won: 0, lost: 0, open: 0 }
      for (const r of outcomes) {
        const key = r.outcome ?? 'open'
        outcomeMap[key] = (outcomeMap[key] ?? 0) + r._count._all
      }

      // Top loss reasons (ordenados por count desc, top 5)
      const reasonNameById = new Map(lossReasonsList.map((r) => [r.id, { name: r.name, color: r.color }]))
      const lossReasons = lossReasonsAgg
        .filter((r) => r.lostReasonId !== null)
        .map((r) => ({
          reasonId: r.lostReasonId!,
          name: reasonNameById.get(r.lostReasonId!)?.name ?? `#${r.lostReasonId}`,
          color: reasonNameById.get(r.lostReasonId!)?.color ?? null,
          count: r._count._all,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5)

      // Sources
      const qualificationSources = sources.map((r) => ({
        source: r.qualificationSource ?? 'unknown',
        count: r._count._all,
      })).sort((a, b) => b.count - a.count)

      // Receita: agrupa por dia (dia do ganho; cai no assignedAt se sem outcomeAt).
      const revenueByDay = new Map<string, number>()
      for (const s of salesTimeline) {
        const day = s.outcomeAt ?? s.assignedAt
        if (!day) continue
        const key = day.toISOString().slice(0, 10) // YYYY-MM-DD
        revenueByDay.set(key, (revenueByDay.get(key) ?? 0) + (s.saleValue ? Number(s.saleValue) : 0))
      }
      const revenueTimeline = Array.from(revenueByDay.entries())
        .map(([date, value]) => ({ date, value }))
        .sort((a, b) => a.date.localeCompare(b.date))

      return {
        userId,
        from: from.toISOString(),
        to: to.toISOString(),
        outcomes: outcomeMap,
        lossReasons,
        qualificationSources,
        revenueTimeline,
      }
    },
  )

  // ── GET /api/admin/team-metrics/workload — Carga de trabalho atual ──
  // Leads ativos (sem outcome), atividades pendentes/overdue, capacidade
  // utilizada. Usa o estado AGORA — não depende de período.
  app.get('/api/admin/team-metrics/workload', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const teamFilter = q.teamId ? Number(q.teamId) : null

    const leadWhere: any = {
      assignedUserId: { not: null },
      outcome: null, // ativo = sem outcome ainda
    }
    if (teamFilter) leadWhere.teamId = teamFilter

    const [activeLeads, pendingActivities, overdueActivities, allUsers] = await Promise.all([
      prisma.lead.groupBy({
        by: ['assignedUserId'],
        where: leadWhere,
        _count: { _all: true },
      }),
      prisma.activity.groupBy({
        by: ['userId'],
        where: { status: 'pending', userId: { not: null } },
        _count: { _all: true },
      }),
      prisma.activity.groupBy({
        by: ['userId'],
        where: {
          OR: [
            { status: 'overdue' },
            { status: 'pending', scheduledAt: { lt: new Date() } },
          ],
          userId: { not: null },
        },
        _count: { _all: true },
      }),
      prisma.user.findMany({
        where: { active: true, OR: [{ role: 'AGENT' }, { isAgent: true }] },
        select: { id: true, name: true, email: true, capacity: true, workStatus: true, lastSeenAt: true },
      }),
    ])

    const activeMap = new Map<number, number>()
    for (const r of activeLeads) if (r.assignedUserId !== null) activeMap.set(r.assignedUserId, r._count._all)
    const pendingMap = new Map<number, number>()
    for (const r of pendingActivities) if (r.userId !== null) pendingMap.set(r.userId, r._count._all)
    const overdueMap = new Map<number, number>()
    for (const r of overdueActivities) if (r.userId !== null) overdueMap.set(r.userId, r._count._all)

    const items = allUsers
      .map((u) => {
        const active = activeMap.get(u.id) ?? 0
        const cap = u.capacity ?? 5
        return {
          userId: u.id,
          name: u.name,
          email: u.email,
          capacity: cap,
          workStatus: u.workStatus ?? 'offline',
          lastSeenAt: u.lastSeenAt?.toISOString() ?? null,
          activeLeads: active,
          activitiesPending: pendingMap.get(u.id) ?? 0,
          activitiesOverdue: overdueMap.get(u.id) ?? 0,
          utilization: cap > 0 ? Math.round((active / cap) * 100) : 0,
        }
      })
      // Mostra só quem tem alguma carga ou tá disponível recente
      .filter((i) => i.activeLeads > 0 || i.activitiesPending > 0 || i.activitiesOverdue > 0 || i.workStatus === 'available')
      .sort((a, b) => b.activeLeads - a.activeLeads || b.activitiesPending - a.activitiesPending)

    return { items }
  })

  // ── GET /api/atendimento/my-teams — Equipes do usuário logado ──
  app.get('/api/atendimento/my-teams', { preHandler: authMiddleware }, async (req) => {
    const user = (req as any).user as JwtPayload
    const memberships = await prisma.teamMember.findMany({
      where: { userId: user.userId },
      select: {
        isLeader: true,
        team: { select: TEAM_SELECT },
      },
    })
    return {
      teams: memberships
        .filter(m => m.team.active)
        .map(m => ({ ...m.team, isLeader: m.isLeader })),
    }
  })
}
