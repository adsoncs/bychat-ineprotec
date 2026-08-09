// src/routes/agents.ts
// Lead Routing — Fase 1
// CRUD admin para "Agentes" (usuários cujo role pode receber leads).
//
// Reforma F1 (2026-05-21): substituído filtro User.isAgent por role IN
// (AGENT, MANAGER, ADMIN, SUPERADMIN). VIEWER nunca recebe. A coluna
// User.isAgent ainda existe (deprecated) mas o frontend já não envia ela
// — em F1.7 a UI passa a alternar role.
//
// Não cria usuários novos: opera sobre User.role + AgentProfile.
// Apenas ADMIN/SUPERADMIN podem alterar.

import { FastifyInstance } from 'fastify'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { authMiddleware, adminOnly, type JwtPayload } from '../lib/auth.js'
import { resolvePeriod } from '../lib/period.js'
import { invalidateRoutingCache, invalidateShiftCache } from '../services/teamRouting.js'
import { invalidateWorkingHoursCache } from '../services/routing/workingHours.js'
import { invalidateRulesCache, validateConditions, validateAction, simulateRouting, type RoutingContext } from '../services/routing/policyEngine.js'
import { resolveRoutingFromContext } from '../services/teamRouting.js'
import { logUserAudit, auditActor } from '../services/userAudit.js'

// Working hours — validações compartilhadas entre endpoints de agente e setor.

interface WorkingHourInput {
  weekday: number
  startTime: string
  endTime: string
  timezone?: string
}

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/

function validateWorkingHours(input: unknown): { ok: true; entries: WorkingHourInput[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: 'workingHours deve ser um array' }
  if (input.length > 7) return { ok: false, error: 'no máximo 1 entrada por dia da semana' }
  const seen = new Set<number>()
  const out: WorkingHourInput[] = []
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') return { ok: false, error: 'entrada de horário inválida' }
    const e = raw as Record<string, unknown>
    if (typeof e.weekday !== 'number' || e.weekday < 0 || e.weekday > 6 || !Number.isInteger(e.weekday)) {
      return { ok: false, error: 'weekday deve ser inteiro 0..6 (0=domingo)' }
    }
    if (seen.has(e.weekday)) return { ok: false, error: `weekday ${e.weekday} duplicado` }
    seen.add(e.weekday)
    if (typeof e.startTime !== 'string' || !HHMM_RE.test(e.startTime)) {
      return { ok: false, error: `startTime inválido (HH:MM 24h) no weekday ${e.weekday}` }
    }
    if (typeof e.endTime !== 'string' || !HHMM_RE.test(e.endTime)) {
      return { ok: false, error: `endTime inválido (HH:MM 24h) no weekday ${e.weekday}` }
    }
    if (e.timezone != null && typeof e.timezone !== 'string') {
      return { ok: false, error: `timezone inválido no weekday ${e.weekday}` }
    }
    // Validação real do TZ usando Intl: se nome desconhecido, lança.
    if (e.timezone) {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: e.timezone })
      } catch {
        return { ok: false, error: `timezone "${e.timezone}" não reconhecido (use IANA, ex: America/Sao_Paulo)` }
      }
    }
    out.push({
      weekday: e.weekday,
      startTime: e.startTime,
      endTime: e.endTime,
      timezone: (e.timezone as string | undefined) || 'America/Sao_Paulo',
    })
  }
  return { ok: true, entries: out }
}

const AGENT_LIST_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  active: true,
  workStatus: true,
  capacity: true,
  // isAgent é DEPRECATED (Reforma F1). Mantido no select por compat com UI antiga
  // até F1.7. Derivado de role na resposta (não usado como filtro funcional).
  isAgent: true,
  lastSeenAt: true,
  agentProfile: {
    select: {
      id: true,
      active: true,
      weight: true,
      maxDailyLeads: true,
      vacationUntil: true,
      notes: true,
      updatedAt: true,
    },
  },
} as const

interface UpdateAgentBody {
  // Reforma F1: aceita `role` (canônico) E `isAgent` (compat backward).
  // - role: define o papel diretamente (AGENT/MANAGER/ADMIN/SUPERADMIN/VIEWER)
  // - isAgent=true E user.role=VIEWER → promove a AGENT
  // - isAgent=false E user.role=AGENT → regride a VIEWER
  // - demais combinações: role permanece (apenas espelha isAgent na coluna deprecated)
  role?: 'SUPERADMIN' | 'ADMIN' | 'MANAGER' | 'AGENT' | 'VIEWER'
  isAgent?: boolean
  weight?: number
  maxDailyLeads?: number | null
  vacationUntil?: string | null
  notes?: string | null
  active?: boolean
}

export async function agentsRoutes(app: FastifyInstance) {
  // GET /api/admin/agents — Lista candidatos a agente com estatística mínima.
  //
  // Retorna TODOS os usuários ativos (admin pode habilitar quem quiser), com:
  //   - isAgent atual + AgentProfile (se existir)
  //   - openLeadCount (leads sem outcome e ainda assignedUserId=user.id)
  //   - teamCount (quantos setores ele participa)
  // A página /app/routing usa pra mostrar grid de agentes.
  app.get('/api/admin/agents', { preHandler: [authMiddleware, adminOnly] }, async () => {
    const users = await prisma.user.findMany({
      where: { active: true },
      // Ordena AGENT primeiro, depois MANAGER/ADMIN/SUPERADMIN (atendem), VIEWER por último.
      // Como Prisma não suporta ORDER BY enum CASE diretamente, faz por isAgent (legado)
      // e dentro disso por nome — em F1.7 a ordenação migra para CASE WHEN role IN (...).
      orderBy: [{ isAgent: 'desc' }, { name: 'asc' }],
      select: AGENT_LIST_SELECT,
    })
    if (users.length === 0) return { agents: [] }

    const userIds = users.map((u) => u.id)
    const [openLeadGroups, teamCountGroups] = await Promise.all([
      prisma.lead.groupBy({
        by: ['assignedUserId'],
        where: { assignedUserId: { in: userIds }, outcome: null },
        _count: { _all: true },
      }),
      prisma.teamMember.groupBy({
        by: ['userId'],
        where: { userId: { in: userIds } },
        _count: { _all: true },
      }),
    ])
    const openByUser = new Map<number, number>()
    for (const g of openLeadGroups) {
      if (g.assignedUserId === null) continue
      openByUser.set(g.assignedUserId, g._count._all)
    }
    const teamCountByUser = new Map<number, number>()
    for (const g of teamCountGroups) {
      teamCountByUser.set(g.userId, g._count._all)
    }

    return {
      agents: users.map((u) => ({
        ...u,
        openLeadCount: openByUser.get(u.id) ?? 0,
        teamCount: teamCountByUser.get(u.id) ?? 0,
      })),
    }
  })

  // GET /api/admin/agents/:userId — Detalhe de um único agente
  app.get<{ Params: { userId: string } }>(
    '/api/admin/agents/:userId',
    { preHandler: [authMiddleware, adminOnly] },
    async (req, reply) => {
      const userId = parseInt(req.params.userId)
      if (!Number.isFinite(userId)) return reply.code(400).send({ error: 'userId inválido' })
      const user = await prisma.user.findUnique({ where: { id: userId }, select: AGENT_LIST_SELECT })
      if (!user) return reply.code(404).send({ error: 'Usuário não encontrado' })
      return { agent: user }
    },
  )

  // PATCH /api/admin/agents/:userId — Atualiza isAgent + AgentProfile.
  //
  // - isAgent=true cria AgentProfile (idempotente via upsert)
  // - isAgent=false NÃO apaga o profile (mantém histórico/peso para reativação futura)
  // - vacationUntil aceita ISO string ou null
  // - weight: 1..10 (validado)
  app.patch<{ Params: { userId: string }; Body: UpdateAgentBody }>(
    '/api/admin/agents/:userId',
    { preHandler: [authMiddleware, adminOnly] },
    async (req, reply) => {
      const userId = parseInt(req.params.userId)
      if (!Number.isFinite(userId)) return reply.code(400).send({ error: 'userId inválido' })

      const body = req.body || {}
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, isAgent: true },
      })
      if (!user) return reply.code(404).send({ error: 'Usuário não encontrado' })

      // Reforma F1: deriva mudança de role a partir de body.role OU body.isAgent.
      // - body.role explícito ganha precedência (validar enum).
      // - body.isAgent: promove VIEWER→AGENT ou regride AGENT→VIEWER. Demais roles
      //   apenas espelham isAgent (compat com UI antiga). SUPERADMIN nunca regride.
      const VALID_ROLES = ['SUPERADMIN', 'ADMIN', 'MANAGER', 'AGENT', 'VIEWER'] as const
      const userPatch: { isAgent?: boolean; role?: typeof VALID_ROLES[number] } = {}
      if (body.role && (VALID_ROLES as readonly string[]).includes(body.role)) {
        userPatch.role = body.role
        userPatch.isAgent = body.role !== 'VIEWER'  // sincroniza coluna deprecated
      } else if (typeof body.isAgent === 'boolean') {
        userPatch.isAgent = body.isAgent
        if (body.isAgent && user.role === 'VIEWER') userPatch.role = 'AGENT'
        else if (!body.isAgent && user.role === 'AGENT') userPatch.role = 'VIEWER'
        // MANAGER/ADMIN/SUPERADMIN: só atualiza isAgent (role inalterado).
      }

      const profilePatch: {
        active?: boolean
        weight?: number
        maxDailyLeads?: number | null
        vacationUntil?: Date | null
        notes?: string | null
      } = {}

      if (typeof body.active === 'boolean') profilePatch.active = body.active
      if (typeof body.weight === 'number') {
        if (body.weight < 1 || body.weight > 10) {
          return reply.code(400).send({ error: 'weight deve estar entre 1 e 10' })
        }
        profilePatch.weight = Math.floor(body.weight)
      }
      if (body.maxDailyLeads === null) profilePatch.maxDailyLeads = null
      else if (typeof body.maxDailyLeads === 'number') {
        if (body.maxDailyLeads < 1) {
          return reply.code(400).send({ error: 'maxDailyLeads deve ser >= 1 ou null' })
        }
        profilePatch.maxDailyLeads = Math.floor(body.maxDailyLeads)
      }
      if (body.vacationUntil === null) profilePatch.vacationUntil = null
      else if (typeof body.vacationUntil === 'string') {
        const dt = new Date(body.vacationUntil)
        if (Number.isNaN(dt.getTime())) {
          return reply.code(400).send({ error: 'vacationUntil inválido (use ISO 8601)' })
        }
        profilePatch.vacationUntil = dt
      }
      if (body.notes === null) profilePatch.notes = null
      else if (typeof body.notes === 'string') {
        profilePatch.notes = body.notes.slice(0, 255)
      }

      // Decide se precisa garantir AgentProfile.
      // Cria profile quando:
      //   - usuário tem role que recebe leads (não VIEWER)
      //   - admin enviou qualquer campo de profile (mesmo sem mudar role)
      const willBeAgent = (userPatch.role ?? user.role) !== 'VIEWER'
      const hasProfileChanges = Object.keys(profilePatch).length > 0
      const ensureProfile = willBeAgent || hasProfileChanges

      await prisma.$transaction(async (tx) => {
        if (Object.keys(userPatch).length > 0) {
          await tx.user.update({ where: { id: userId }, data: userPatch })
        }
        if (ensureProfile) {
          await tx.agentProfile.upsert({
            where: { userId },
            create: { userId, ...profilePatch },
            update: profilePatch,
          })
        }
      })

      // Invalida cache do feature flag e do team padrão (defensivo — não muda aqui,
      // mas se o admin estiver no fluxo de habilitar agentes, pode trocar a flag
      // logo em seguida; mais barato invalidar que ficar preso a cache antigo).
      invalidateRoutingCache()

      const updated = await prisma.user.findUnique({ where: { id: userId }, select: AGENT_LIST_SELECT })
      return { agent: updated }
    },
  )

  // GET /api/admin/routing/feature-flag — Estado do Setting routing.v2.enabled
  // Endpoint utilitário pro painel mostrar o toggle e ler valor atual.
  app.get('/api/admin/routing/feature-flag', { preHandler: [authMiddleware, adminOnly] }, async () => {
    const setting = await prisma.setting.findUnique({ where: { key: 'routing.v2.enabled' } })
    let enabled = false
    if (setting?.value != null) {
      const raw = setting.value as any
      if (typeof raw === 'boolean') enabled = raw
      else if (typeof raw === 'string') enabled = raw.toLowerCase() === 'true'
      else if (typeof raw === 'number') enabled = raw !== 0
    }
    return { enabled, label: setting?.label ?? 'Roteamento V2 (filtro por agente)' }
  })

  // POST /api/admin/routing/feature-flag — Toggle do Setting (apenas SUPERADMIN).
  app.post<{ Body: { enabled: boolean } }>(
    '/api/admin/routing/feature-flag',
    { preHandler: [authMiddleware, adminOnly] },
    async (req, reply) => {
      const body = req.body || {}
      if (typeof body.enabled !== 'boolean') {
        return reply.code(400).send({ error: 'enabled (boolean) é obrigatório' })
      }
      // Quando ligar, garante que existe ao menos 1 agente — senão o motor
      // novo bloqueia 100% dos leads no round-robin/least_loaded/random.
      if (body.enabled) {
        // Reforma F1: conta usuários ativos cuja role recebe leads (não VIEWER).
        const agentCount = await prisma.user.count({
          where: { active: true, role: { not: 'VIEWER' } },
        })
        if (agentCount === 0) {
          return reply.code(409).send({
            error: 'Nenhum usuário com papel que recebe leads (AGENT/MANAGER/ADMIN). Marque pelo menos um antes de habilitar o Roteamento V2.',
          })
        }
      }
      await prisma.setting.upsert({
        where: { key: 'routing.v2.enabled' },
        create: {
          key: 'routing.v2.enabled',
          value: body.enabled,
          label: 'Roteamento V2 (filtro por agente)',
          grp: 'routing',
          fieldType: 'boolean',
        },
        update: { value: body.enabled },
      })
      invalidateRoutingCache()
      return { enabled: body.enabled }
    },
  )

  // ── Working Hours — Agente ────────────────────────────────────────────
  // GET /api/admin/agents/:userId/working-hours → array ordenado por weekday.
  app.get<{ Params: { userId: string } }>(
    '/api/admin/agents/:userId/working-hours',
    { preHandler: [authMiddleware, adminOnly] },
    async (req, reply) => {
      const userId = parseInt(req.params.userId)
      if (!Number.isFinite(userId)) return reply.code(400).send({ error: 'userId inválido' })
      const exists = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
      if (!exists) return reply.code(404).send({ error: 'Usuário não encontrado' })
      const workingHours = await prisma.agentWorkingHour.findMany({
        where: { userId },
        orderBy: { weekday: 'asc' },
        select: { id: true, weekday: true, startTime: true, endTime: true, timezone: true },
      })
      return { workingHours }
    },
  )

  // PUT /api/admin/agents/:userId/working-hours → replace-all (envia array; backend
  // apaga e recria). Mais simples que diff e idempotente do lado UI.
  app.put<{ Params: { userId: string }; Body: { workingHours: unknown } }>(
    '/api/admin/agents/:userId/working-hours',
    { preHandler: [authMiddleware, adminOnly] },
    async (req, reply) => {
      const userId = parseInt(req.params.userId)
      if (!Number.isFinite(userId)) return reply.code(400).send({ error: 'userId inválido' })
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
      if (!user) return reply.code(404).send({ error: 'Usuário não encontrado' })

      const v = validateWorkingHours(req.body?.workingHours)
      if (!v.ok) return reply.code(400).send({ error: v.error })

      await prisma.$transaction(async (tx) => {
        await tx.agentWorkingHour.deleteMany({ where: { userId } })
        if (v.entries.length > 0) {
          await tx.agentWorkingHour.createMany({
            data: v.entries.map((e) => ({
              userId,
              weekday: e.weekday,
              startTime: e.startTime,
              endTime: e.endTime,
              timezone: e.timezone || 'America/Sao_Paulo',
            })),
          })
        }
      })
      invalidateWorkingHoursCache({ userId })

      const workingHours = await prisma.agentWorkingHour.findMany({
        where: { userId },
        orderBy: { weekday: 'asc' },
        select: { id: true, weekday: true, startTime: true, endTime: true, timezone: true },
      })
      return { workingHours }
    },
  )

  // ── Working Hours — Setor (Team) ──────────────────────────────────────
  app.get<{ Params: { teamId: string } }>(
    '/api/admin/teams/:teamId/working-hours',
    { preHandler: [authMiddleware, adminOnly] },
    async (req, reply) => {
      const teamId = parseInt(req.params.teamId)
      if (!Number.isFinite(teamId)) return reply.code(400).send({ error: 'teamId inválido' })
      const team = await prisma.team.findUnique({
        where: { id: teamId },
        select: { id: true, workingHoursEnabled: true },
      })
      if (!team) return reply.code(404).send({ error: 'Setor não encontrado' })
      const workingHours = await prisma.teamWorkingHour.findMany({
        where: { teamId },
        orderBy: { weekday: 'asc' },
        select: { id: true, weekday: true, startTime: true, endTime: true, timezone: true },
      })
      return { workingHoursEnabled: team.workingHoursEnabled, workingHours }
    },
  )

  // PUT permite enviar enabled (toggle) + array de horários no mesmo request.
  app.put<{
    Params: { teamId: string }
    Body: { workingHours: unknown; workingHoursEnabled?: boolean }
  }>(
    '/api/admin/teams/:teamId/working-hours',
    { preHandler: [authMiddleware, adminOnly] },
    async (req, reply) => {
      const teamId = parseInt(req.params.teamId)
      if (!Number.isFinite(teamId)) return reply.code(400).send({ error: 'teamId inválido' })
      const team = await prisma.team.findUnique({ where: { id: teamId }, select: { id: true } })
      if (!team) return reply.code(404).send({ error: 'Setor não encontrado' })

      const v = validateWorkingHours(req.body?.workingHours)
      if (!v.ok) return reply.code(400).send({ error: v.error })

      await prisma.$transaction(async (tx) => {
        await tx.teamWorkingHour.deleteMany({ where: { teamId } })
        if (v.entries.length > 0) {
          await tx.teamWorkingHour.createMany({
            data: v.entries.map((e) => ({
              teamId,
              weekday: e.weekday,
              startTime: e.startTime,
              endTime: e.endTime,
              timezone: e.timezone || 'America/Sao_Paulo',
            })),
          })
        }
        if (typeof req.body?.workingHoursEnabled === 'boolean') {
          await tx.team.update({
            where: { id: teamId },
            data: { workingHoursEnabled: req.body.workingHoursEnabled },
          })
        }
      })
      invalidateWorkingHoursCache({ teamId })

      const fresh = await prisma.team.findUnique({
        where: { id: teamId },
        select: { workingHoursEnabled: true },
      })
      const workingHours = await prisma.teamWorkingHour.findMany({
        where: { teamId },
        orderBy: { weekday: 'asc' },
        select: { id: true, weekday: true, startTime: true, endTime: true, timezone: true },
      })
      return { workingHoursEnabled: fresh?.workingHoursEnabled ?? false, workingHours }
    },
  )

  // ── Setting routing.out_of_hours_team_id ──────────────────────────────
  app.get('/api/admin/routing/out-of-hours-team', { preHandler: [authMiddleware, adminOnly] }, async () => {
    const setting = await prisma.setting.findUnique({ where: { key: 'routing.out_of_hours_team_id' } })
    let teamId: number | null = null
    if (setting?.value != null) {
      const raw = setting.value as any
      if (typeof raw === 'number') teamId = raw
      else if (typeof raw === 'string' && /^\d+$/.test(raw)) teamId = parseInt(raw)
      else if (typeof raw === 'object' && raw && typeof raw.id === 'number') teamId = raw.id
    }
    return { teamId }
  })

  app.post<{ Body: { teamId: number | null } }>(
    '/api/admin/routing/out-of-hours-team',
    { preHandler: [authMiddleware, adminOnly] },
    async (req, reply) => {
      const teamId = req.body?.teamId
      if (teamId !== null && (typeof teamId !== 'number' || !Number.isFinite(teamId))) {
        return reply.code(400).send({ error: 'teamId deve ser número ou null' })
      }
      if (teamId !== null && teamId !== undefined) {
        const team = await prisma.team.findUnique({ where: { id: teamId }, select: { id: true, active: true } })
        if (!team) return reply.code(404).send({ error: 'Setor não encontrado' })
        if (!team.active) return reply.code(400).send({ error: 'Setor inativo' })
      }
      // Setting.value é JSON: precisa de Prisma.JsonNull p/ persistir null,
      // senão TS reclama (JsonNull | InputJsonValue).
      const persistValue: Prisma.InputJsonValue | typeof Prisma.JsonNull =
        teamId === null || teamId === undefined ? Prisma.JsonNull : teamId
      await prisma.setting.upsert({
        where: { key: 'routing.out_of_hours_team_id' },
        create: {
          key: 'routing.out_of_hours_team_id',
          value: persistValue,
          label: 'Setor de plantão fora do horário',
          grp: 'routing',
          fieldType: 'team',
        },
        update: { value: persistValue },
      })
      invalidateRoutingCache()
      return { teamId: teamId ?? null }
    },
  )

  // ── Escalation (F8) ───────────────────────────────────────────────────
  // GET/POST /api/admin/routing/escalation — controla o cron que devolve leads
  // encalhados / de agentes em férias/offline/inativos. Lê e grava 3 Settings.

  app.get('/api/admin/routing/escalation', { preHandler: [authMiddleware, adminOnly] }, async () => {
    const rows = await prisma.setting.findMany({
      where: {
        key: { in: ['routing.escalation.enabled', 'routing.escalation.minutes', 'routing.escalation.reassignOnOffline'] },
      },
      select: { key: true, value: true },
    })
    const byKey = new Map(rows.map((r) => [r.key, r.value]))
    const readBool = (v: unknown, fb: boolean): boolean => {
      if (v == null) return fb
      if (typeof v === 'boolean') return v
      if (typeof v === 'string') return v.toLowerCase() === 'true'
      if (typeof v === 'number') return v !== 0
      return fb
    }
    const readNum = (v: unknown, fb: number): number => {
      if (typeof v === 'number' && Number.isFinite(v)) return v
      if (typeof v === 'string') { const n = parseInt(v); if (Number.isFinite(n)) return n }
      return fb
    }
    return {
      enabled: readBool(byKey.get('routing.escalation.enabled'), false),
      minutes: Math.max(5, readNum(byKey.get('routing.escalation.minutes'), 60)),
      reassignOnOffline: readBool(byKey.get('routing.escalation.reassignOnOffline'), true),
    }
  })

  app.post<{ Body: { enabled?: boolean; minutes?: number; reassignOnOffline?: boolean } }>(
    '/api/admin/routing/escalation',
    { preHandler: [authMiddleware, adminOnly] },
    async (req, reply) => {
      const body = req.body || {}
      const upserts: { key: string; value: unknown; label: string; grp: string; fieldType: string }[] = []
      if (typeof body.enabled === 'boolean') {
        upserts.push({
          key: 'routing.escalation.enabled', value: body.enabled,
          label: 'Escalação automática ativa', grp: 'routing', fieldType: 'boolean',
        })
      }
      if (typeof body.minutes === 'number') {
        if (body.minutes < 5 || body.minutes > 1440) {
          return reply.code(400).send({ error: 'minutes deve estar entre 5 e 1440 (24h)' })
        }
        upserts.push({
          key: 'routing.escalation.minutes', value: Math.floor(body.minutes),
          label: 'Minutos sem resposta para devolver lead à fila', grp: 'routing', fieldType: 'number',
        })
      }
      if (typeof body.reassignOnOffline === 'boolean') {
        upserts.push({
          key: 'routing.escalation.reassignOnOffline', value: body.reassignOnOffline,
          label: 'Devolver leads de agentes offline há >30min', grp: 'routing', fieldType: 'boolean',
        })
      }
      if (upserts.length === 0) return reply.code(400).send({ error: 'nenhum campo para atualizar' })

      await prisma.$transaction(
        upserts.map((u) =>
          prisma.setting.upsert({
            where: { key: u.key },
            create: u as any,
            update: { value: u.value as any },
          }),
        ),
      )
      invalidateRoutingCache()
      return { ok: true }
    },
  )

  // ── Shift Handover (F5/F6) ────────────────────────────────────────────
  app.get('/api/admin/routing/shift', { preHandler: [authMiddleware, adminOnly] }, async () => {
    const rows = await prisma.setting.findMany({
      where: { key: { in: ['routing.shift.enabled', 'routing.shift.toleranceMinutes'] } },
      select: { key: true, value: true },
    })
    const byKey = new Map(rows.map((r) => [r.key, r.value]))
    const readBool = (v: unknown, fb: boolean): boolean => {
      if (v == null) return fb
      if (typeof v === 'boolean') return v
      if (typeof v === 'string') return v.toLowerCase() === 'true'
      if (typeof v === 'number') return v !== 0
      return fb
    }
    const readNum = (v: unknown, fb: number): number => {
      if (typeof v === 'number' && Number.isFinite(v)) return v
      if (typeof v === 'string') { const n = parseInt(v); if (Number.isFinite(n)) return n }
      return fb
    }
    return {
      enabled: readBool(byKey.get('routing.shift.enabled'), false),
      toleranceMinutes: Math.max(0, Math.min(240, readNum(byKey.get('routing.shift.toleranceMinutes'), 30))),
    }
  })

  app.post<{ Body: { enabled?: boolean; toleranceMinutes?: number } }>(
    '/api/admin/routing/shift',
    { preHandler: [authMiddleware, adminOnly] },
    async (req, reply) => {
      const body = req.body || {}
      const upserts: { key: string; value: unknown; label: string; grp: string; fieldType: string }[] = []
      if (typeof body.enabled === 'boolean') {
        upserts.push({
          key: 'routing.shift.enabled', value: body.enabled,
          label: 'Hand-off no fim do turno', grp: 'routing', fieldType: 'boolean',
        })
      }
      if (typeof body.toleranceMinutes === 'number') {
        if (body.toleranceMinutes < 0 || body.toleranceMinutes > 240) {
          return reply.code(400).send({ error: 'toleranceMinutes deve estar entre 0 e 240' })
        }
        upserts.push({
          key: 'routing.shift.toleranceMinutes', value: Math.floor(body.toleranceMinutes),
          label: 'Tolerância após fim do turno (min)', grp: 'routing', fieldType: 'number',
        })
      }
      if (upserts.length === 0) return reply.code(400).send({ error: 'nenhum campo para atualizar' })
      await prisma.$transaction(
        upserts.map((u) => prisma.setting.upsert({
          where: { key: u.key }, create: u as any, update: { value: u.value as any },
        })),
      )
      invalidateShiftCache()
      return { ok: true }
    },
  )

  // ── Transfer timeout (F3/F6) ──────────────────────────────────────────
  app.get('/api/admin/routing/transfer-timeout', { preHandler: [authMiddleware, adminOnly] }, async () => {
    const s = await prisma.setting.findUnique({ where: { key: 'routing.transfer.timeoutHours' } })
    let hours = 24
    if (s?.value != null) {
      const v = s.value as any
      if (typeof v === 'number' && Number.isFinite(v)) hours = v
      else if (typeof v === 'string') { const n = parseInt(v); if (Number.isFinite(n)) hours = n }
    }
    return { hours: Math.max(1, Math.min(168, hours)) }
  })

  app.post<{ Body: { hours: number } }>(
    '/api/admin/routing/transfer-timeout',
    { preHandler: [authMiddleware, adminOnly] },
    async (req, reply) => {
      const h = req.body?.hours
      if (typeof h !== 'number' || !Number.isFinite(h) || h < 1 || h > 168) {
        return reply.code(400).send({ error: 'hours deve estar entre 1 e 168 (7 dias)' })
      }
      await prisma.setting.upsert({
        where: { key: 'routing.transfer.timeoutHours' },
        create: {
          key: 'routing.transfer.timeoutHours',
          value: Math.floor(h),
          label: 'Transferência — auto-cancela após (horas)',
          grp: 'routing',
          fieldType: 'number',
        },
        update: { value: Math.floor(h) },
      })
      return { hours: Math.floor(h) }
    },
  )

  // ── Agent Skills (F5) ─────────────────────────────────────────────────
  // Habilidades do agente. Skill é VARCHAR(64) livre (admin define vocabulário).
  // Endpoints: GET / PUT por agente (replace-all) + GET de todas as skills do
  // tenant para autocomplete na UI.

  app.get<{ Params: { userId: string } }>(
    '/api/admin/agents/:userId/skills',
    { preHandler: [authMiddleware, adminOnly] },
    async (req, reply) => {
      const userId = parseInt(req.params.userId)
      if (!Number.isFinite(userId)) return reply.code(400).send({ error: 'userId inválido' })
      const exists = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
      if (!exists) return reply.code(404).send({ error: 'Usuário não encontrado' })
      const skills = await prisma.agentSkill.findMany({
        where: { userId },
        orderBy: { skill: 'asc' },
        select: { id: true, skill: true, level: true },
      })
      return { skills }
    },
  )

  interface SkillInput {
    skill: string
    level?: number
  }

  app.put<{ Params: { userId: string }; Body: { skills: SkillInput[] } }>(
    '/api/admin/agents/:userId/skills',
    { preHandler: [authMiddleware, adminOnly] },
    async (req, reply) => {
      const userId = parseInt(req.params.userId)
      if (!Number.isFinite(userId)) return reply.code(400).send({ error: 'userId inválido' })
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
      if (!user) return reply.code(404).send({ error: 'Usuário não encontrado' })

      const raw = req.body?.skills
      if (!Array.isArray(raw)) return reply.code(400).send({ error: 'skills deve ser array' })
      if (raw.length > 50) return reply.code(400).send({ error: 'máximo 50 skills por agente' })

      const seen = new Set<string>()
      const cleaned: { skill: string; level: number }[] = []
      for (const item of raw) {
        if (!item || typeof item !== 'object') continue
        const s = String((item as any).skill ?? '').trim().toLowerCase().slice(0, 64)
        if (!s) continue
        if (seen.has(s)) continue
        seen.add(s)
        let level = parseInt(String((item as any).level ?? '1'))
        if (!Number.isFinite(level) || level < 1) level = 1
        if (level > 5) level = 5
        cleaned.push({ skill: s, level })
      }

      await prisma.$transaction(async (tx) => {
        await tx.agentSkill.deleteMany({ where: { userId } })
        if (cleaned.length > 0) {
          await tx.agentSkill.createMany({
            data: cleaned.map((c) => ({ userId, skill: c.skill, level: c.level })),
          })
        }
      })

      const skills = await prisma.agentSkill.findMany({
        where: { userId },
        orderBy: { skill: 'asc' },
        select: { id: true, skill: true, level: true },
      })
      return { skills }
    },
  )

  // Lista todas as skills distintas no tenant — pra autocomplete no rule builder.
  app.get('/api/admin/routing/skills', { preHandler: [authMiddleware, adminOnly] }, async () => {
    const rows = await prisma.agentSkill.findMany({
      distinct: ['skill'],
      orderBy: { skill: 'asc' },
      select: { skill: true },
    })
    return { skills: rows.map((r) => r.skill) }
  })

  // ── Routing Rules (F4) ────────────────────────────────────────────────
  // Regras condicionais em cascata. Avaliadas em order ASC; primeira que casa
  // (todas conditions AND) define teamId ou userId do lead.

  app.get('/api/admin/routing/rules', { preHandler: [authMiddleware, adminOnly] }, async () => {
    const rules = await prisma.routingRule.findMany({
      orderBy: { order: 'asc' },
      select: {
        id: true, order: true, name: true, enabled: true,
        conditions: true, action: true, description: true,
        matchedCount: true, lastMatchedAt: true,
        createdAt: true, updatedAt: true,
      },
    })
    return { rules }
  })

  interface RuleBody {
    name?: string
    enabled?: boolean
    conditions?: unknown
    action?: unknown
    description?: string | null
    order?: number
  }

  // POST cria uma regra no final da cascade (order = max+1) se order não vier.
  app.post<{ Body: RuleBody }>(
    '/api/admin/routing/rules',
    { preHandler: [authMiddleware, adminOnly] },
    async (req, reply) => {
      const body = req.body || {}
      const name = (body.name || '').trim()
      if (!name) return reply.code(400).send({ error: 'name é obrigatório' })

      const cv = validateConditions(body.conditions)
      if (!cv.ok) return reply.code(400).send({ error: cv.error })
      const av = validateAction(body.action)
      if (!av.ok) return reply.code(400).send({ error: av.error })

      // Valida que team/user existe e está ativo (fail fast em vez de regra "morta").
      if (av.value.type === 'team' || av.value.type === 'skill') {
        const t = await prisma.team.findUnique({ where: { id: av.value.teamId }, select: { active: true } })
        if (!t?.active) return reply.code(400).send({ error: 'Setor não encontrado ou inativo' })
      } else {
        const u = await prisma.user.findUnique({ where: { id: av.value.userId }, select: { active: true } })
        if (!u?.active) return reply.code(400).send({ error: 'Usuário não encontrado ou inativo' })
      }

      let order = typeof body.order === 'number' ? body.order : null
      if (order == null) {
        const max = await prisma.routingRule.aggregate({ _max: { order: true } })
        order = (max._max.order ?? -1) + 1
      }

      const actorUserId = (req as any).user?.userId as number | undefined

      const rule = await prisma.routingRule.create({
        data: {
          name: name.slice(0, 120),
          enabled: body.enabled ?? true,
          conditions: cv.value as any,
          action: av.value as any,
          description: body.description?.slice(0, 255) ?? null,
          order,
          createdByUserId: actorUserId ?? null,
        },
      })
      invalidateRulesCache()
      void logUserAudit({ action: 'routing_rule.created', targetType: 'routing_rule', targetLabel: rule.name, ...auditActor(req) })
      return { rule }
    },
  )

  app.patch<{ Params: { ruleId: string }; Body: RuleBody }>(
    '/api/admin/routing/rules/:ruleId',
    { preHandler: [authMiddleware, adminOnly] },
    async (req, reply) => {
      const ruleId = parseInt(req.params.ruleId)
      if (!Number.isFinite(ruleId)) return reply.code(400).send({ error: 'ruleId inválido' })
      const existing = await prisma.routingRule.findUnique({ where: { id: ruleId } })
      if (!existing) return reply.code(404).send({ error: 'Regra não encontrada' })

      const body = req.body || {}
      const patch: Record<string, unknown> = {}

      if (typeof body.name === 'string') {
        const name = body.name.trim()
        if (!name) return reply.code(400).send({ error: 'name não pode ser vazio' })
        patch.name = name.slice(0, 120)
      }
      if (typeof body.enabled === 'boolean') patch.enabled = body.enabled
      if (body.conditions !== undefined) {
        const cv = validateConditions(body.conditions)
        if (!cv.ok) return reply.code(400).send({ error: cv.error })
        patch.conditions = cv.value as any
      }
      if (body.action !== undefined) {
        const av = validateAction(body.action)
        if (!av.ok) return reply.code(400).send({ error: av.error })
        if (av.value.type === 'team' || av.value.type === 'skill') {
          const t = await prisma.team.findUnique({ where: { id: av.value.teamId }, select: { active: true } })
          if (!t?.active) return reply.code(400).send({ error: 'Setor não encontrado ou inativo' })
        } else {
          const u = await prisma.user.findUnique({ where: { id: av.value.userId }, select: { active: true } })
          if (!u?.active) return reply.code(400).send({ error: 'Usuário não encontrado ou inativo' })
        }
        patch.action = av.value as any
      }
      if (body.description === null) patch.description = null
      else if (typeof body.description === 'string') patch.description = body.description.slice(0, 255)
      if (typeof body.order === 'number') patch.order = body.order

      const rule = await prisma.routingRule.update({ where: { id: ruleId }, data: patch })
      invalidateRulesCache()
      void logUserAudit({ action: 'routing_rule.updated', targetType: 'routing_rule', targetLabel: rule.name, changes: { fields: Object.keys(patch) }, ...auditActor(req) })
      return { rule }
    },
  )

  app.delete<{ Params: { ruleId: string } }>(
    '/api/admin/routing/rules/:ruleId',
    { preHandler: [authMiddleware, adminOnly] },
    async (req, reply) => {
      const ruleId = parseInt(req.params.ruleId)
      if (!Number.isFinite(ruleId)) return reply.code(400).send({ error: 'ruleId inválido' })
      const existing = await prisma.routingRule.findUnique({ where: { id: ruleId } })
      if (!existing) return reply.code(404).send({ error: 'Regra não encontrada' })
      await prisma.routingRule.delete({ where: { id: ruleId } })
      invalidateRulesCache()
      void logUserAudit({ action: 'routing_rule.deleted', targetType: 'routing_rule', targetLabel: existing.name, ...auditActor(req) })
      return { deleted: true }
    },
  )

  // Reorder: recebe array de IDs na ordem desejada; reatribui order=0..n-1.
  app.post<{ Body: { ruleIds: number[] } }>(
    '/api/admin/routing/rules/reorder',
    { preHandler: [authMiddleware, adminOnly] },
    async (req, reply) => {
      const ids = req.body?.ruleIds
      if (!Array.isArray(ids) || ids.some((x) => typeof x !== 'number')) {
        return reply.code(400).send({ error: 'ruleIds deve ser array de números' })
      }
      const existing = await prisma.routingRule.findMany({ where: { id: { in: ids } }, select: { id: true } })
      if (existing.length !== ids.length) {
        return reply.code(400).send({ error: 'Algum ruleId inválido' })
      }
      await prisma.$transaction(
        ids.map((id, idx) =>
          prisma.routingRule.update({ where: { id }, data: { order: idx } }),
        ),
      )
      invalidateRulesCache()
      return { ok: true }
    },
  )

  // ── SLA (F10) ─────────────────────────────────────────────────────────
  // GET/POST /api/admin/routing/sla — Setting `routing.sla.firstResponseMinutes`.
  // GET /api/admin/routing/sla/metrics?from=&to= (ou range=7d|30d) — por agente:
  //   total atendidos, dentro do SLA, fora, % SLA, tempo médio de 1ª resposta.

  const SLA_KEY = 'routing.sla.firstResponseMinutes'

  app.get('/api/admin/routing/sla', { preHandler: [authMiddleware, adminOnly] }, async () => {
    const s = await prisma.setting.findUnique({ where: { key: SLA_KEY } })
    let minutes = 30
    if (s?.value != null) {
      const v = s.value as any
      if (typeof v === 'number' && Number.isFinite(v)) minutes = v
      else if (typeof v === 'string') { const n = parseInt(v); if (Number.isFinite(n)) minutes = n }
    }
    return { minutes: Math.max(1, Math.min(1440, minutes)) }
  })

  app.post<{ Body: { minutes: number } }>(
    '/api/admin/routing/sla',
    { preHandler: [authMiddleware, adminOnly] },
    async (req, reply) => {
      const m = req.body?.minutes
      if (typeof m !== 'number' || !Number.isFinite(m) || m < 1 || m > 1440) {
        return reply.code(400).send({ error: 'minutes deve estar entre 1 e 1440' })
      }
      await prisma.setting.upsert({
        where: { key: SLA_KEY },
        create: {
          key: SLA_KEY,
          value: Math.floor(m),
          label: 'SLA — tempo máximo de primeira resposta (minutos)',
          grp: 'routing',
          fieldType: 'number',
        },
        update: { value: Math.floor(m) },
      })
      return { minutes: Math.floor(m) }
    },
  )

  app.get<{ Querystring: { range?: string; from?: string; to?: string } }>(
    '/api/admin/routing/sla/metrics',
    { preHandler: [authMiddleware, adminOnly] },
    async (req) => {
      const { from: since, to: until, days } = resolvePeriod(req.query, 7)

      const slaSetting = await prisma.setting.findUnique({ where: { key: SLA_KEY } })
      let slaMinutes = 30
      if (slaSetting?.value != null) {
        const v = slaSetting.value as any
        if (typeof v === 'number') slaMinutes = v
        else if (typeof v === 'string') { const n = parseInt(v); if (Number.isFinite(n)) slaMinutes = n }
      }
      const slaMs = slaMinutes * 60_000

      // Pega leads atribuídos no período. Ignora leads sem assignedAt (caíram em
      // fila sem nunca terem operador) — métrica é "leads que algum agente tocou".
      const leads = await prisma.lead.findMany({
        where: {
          assignedAt: { gte: since, lte: until },
          assignedUserId: { not: null },
        },
        select: {
          id: true, assignedUserId: true, assignedAt: true, firstResponseAt: true,
          assignedUser: { select: { id: true, name: true } },
        },
      })

      interface Agg {
        userId: number
        name: string
        attended: number
        responded: number
        slaMet: number
        slaMissed: number
        sumResponseMs: number
      }
      const byAgent = new Map<number, Agg>()
      for (const l of leads) {
        if (!l.assignedUserId || !l.assignedAt) continue
        const key = l.assignedUserId
        let a = byAgent.get(key)
        if (!a) {
          a = {
            userId: key,
            name: l.assignedUser?.name ?? `#${key}`,
            attended: 0, responded: 0, slaMet: 0, slaMissed: 0, sumResponseMs: 0,
          }
          byAgent.set(key, a)
        }
        a.attended++
        if (l.firstResponseAt) {
          const delta = l.firstResponseAt.getTime() - l.assignedAt.getTime()
          if (delta >= 0) {
            a.responded++
            a.sumResponseMs += delta
            if (delta <= slaMs) a.slaMet++
            else a.slaMissed++
          }
        }
      }

      const agents = [...byAgent.values()]
        .map((a) => ({
          userId: a.userId,
          name: a.name,
          attended: a.attended,
          responded: a.responded,
          pending: a.attended - a.responded,
          slaMet: a.slaMet,
          slaMissed: a.slaMissed,
          slaPercent: a.responded > 0 ? Math.round((a.slaMet / a.responded) * 100) : null,
          avgFirstResponseMin: a.responded > 0 ? Math.round((a.sumResponseMs / a.responded) / 60_000) : null,
        }))
        .sort((a, b) => b.attended - a.attended)

      // Total geral
      const totals = agents.reduce(
        (acc, a) => ({
          attended: acc.attended + a.attended,
          responded: acc.responded + a.responded,
          slaMet: acc.slaMet + a.slaMet,
          slaMissed: acc.slaMissed + a.slaMissed,
        }),
        { attended: 0, responded: 0, slaMet: 0, slaMissed: 0 },
      )

      return {
        rangeDays: days,
        slaMinutes,
        totals: {
          ...totals,
          slaPercent: totals.responded > 0
            ? Math.round((totals.slaMet / totals.responded) * 100)
            : null,
        },
        agents,
      }
    },
  )

  // ── Simulador (F9) ────────────────────────────────────────────────────
  // Recebe um contexto sintético, retorna a inspeção de cada regra + decisão
  // final que seria aplicada (chamando resolveRoutingFromContext de verdade —
  // honra v2 flag, working hours, capacity, etc.).
  app.post<{ Body: { context?: RoutingContext } }>(
    '/api/admin/routing/simulate',
    { preHandler: [authMiddleware, adminOnly] },
    async (req, reply) => {
      const ctx = (req.body?.context ?? {}) as RoutingContext
      // Normalização defensiva: coerce numbers em strings vindos do form.
      if (typeof (ctx as any).formId === 'string') {
        const n = parseInt((ctx as any).formId)
        ;(ctx as any).formId = Number.isFinite(n) ? n : null
      }
      if (typeof (ctx as any).chatbotId === 'string') {
        const n = parseInt((ctx as any).chatbotId)
        ;(ctx as any).chatbotId = Number.isFinite(n) ? n : null
      }
      try {
        const inspection = await simulateRouting(ctx)
        const decision = await resolveRoutingFromContext(ctx)
        return { inspection, decision }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Falha ao simular'
        return reply.code(500).send({ error: msg })
      }
    },
  )

  // ── Logs (F9) ─────────────────────────────────────────────────────────
  // GET /api/admin/routing/logs?type=rule|escalation|all&limit=100
  // Filtra LeadEvent por tipos de roteamento + decora com snippet do lead.
  app.get<{ Querystring: { type?: string; limit?: string } }>(
    '/api/admin/routing/logs',
    { preHandler: [authMiddleware, adminOnly] },
    async (req) => {
      const q = req.query || {}
      const filter = (q.type || 'all').toLowerCase()
      const limit = Math.min(Math.max(parseInt(q.limit || '50'), 10), 200)

      const types: string[] = []
      if (filter === 'rule' || filter === 'all') types.push('routing_rule_matched')
      if (filter === 'escalation' || filter === 'all') types.push('agent_reassigned_escalation')

      const events = await prisma.leadEvent.findMany({
        where: { type: { in: types } },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true, leadId: true, type: true, title: true, metadata: true, createdAt: true,
        },
      })

      // Decora com snippet do lead (sem N+1: 1 query agregada).
      const leadIds = [...new Set(events.map((e) => e.leadId))]
      const leads = leadIds.length > 0
        ? await prisma.lead.findMany({
            where: { id: { in: leadIds } },
            select: { id: true, empresa: true, nome: true, assignedUserId: true, teamId: true },
          })
        : []
      const byLead = new Map(leads.map((l) => [l.id, l]))

      return {
        logs: events.map((e) => ({
          ...e,
          lead: byLead.get(e.leadId) ?? null,
        })),
      }
    },
  )
}
