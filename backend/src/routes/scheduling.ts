// Módulo de Agendamento de Reuniões (scheduling).
// Fase 1: CRUD de Tipos de Reunião (MeetingType).
// Disponibilidade/slots (Fase 2), página pública (Fase 3), CRM/confirmação (5-6) a seguir.
import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { adminOnly, authMiddleware, type JwtPayload } from '../lib/auth.js'
import { type WeeklyRule, type ExceptionRule } from '../services/schedulingSlots.js'
import { getExternalGoogleEvents, pushBlockToGoogle, updateBlockInGoogle, deleteBlockFromGoogle } from '../services/schedulingGoogle.js'
import { logUserAudit, auditActor } from '../services/userAudit.js'

// Disponibilidade padrão quando o tipo ainda não tem agenda: seg-sex 09-18.
const DEFAULT_RULES: WeeklyRule[] = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: '09:00', end: '18:00' }))

// Carrega (rules + exceptions) de um tipo de reunião. Sem persistir default.
async function loadAvailability(meetingTypeId: number) {
  const schedule = await prisma.availabilitySchedule.findFirst({ where: { meetingTypeId } })
  const exceptions = schedule
    ? await prisma.availabilityException.findMany({ where: { scheduleId: schedule.id }, orderBy: { date: 'asc' } })
    : []
  const rules = (schedule?.rules as unknown as WeeklyRule[]) || DEFAULT_RULES
  return { schedule, rules, exceptions }
}

const MANAGER_ROLES = ['SUPERADMIN', 'ADMIN', 'MANAGER']
const LOCATION_TYPES = ['google_meet', 'phone', 'whatsapp', 'in_person', 'custom']
// fixed: dono operador fixo (mt.ownerUserId). team_routing: distribui pela Equipe
// (mt.teamId) usando o motor de Roteamento de Leads. round_robin: legado, não usado.
const ASSIGNMENT_MODES = ['fixed', 'round_robin', 'team_routing']

function slugify(s: string): string {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .substring(0, 90) || 'reuniao'
}

async function uniqueSlug(base: string, ignoreId?: number): Promise<string> {
  let slug = base
  let n = 1
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const found = await prisma.meetingType.findUnique({ where: { slug }, select: { id: true } })
    if (!found || found.id === ignoreId) return slug
    n += 1
    slug = `${base}-${n}`.substring(0, 100)
  }
}

const numOrNull = (v: any): number | null => {
  if (v === undefined || v === null || v === '') return null
  const n = parseInt(String(v), 10)
  return Number.isFinite(n) ? n : null
}
const numOr = (v: any, def: number): number => numOrNull(v) ?? def

// Campos editáveis no create/update (saneamento básico).
function buildData(body: any, isCreate: boolean) {
  const data: any = {}
  if (body.name !== undefined) data.name = String(body.name).trim().substring(0, 191)
  if (body.description !== undefined) data.description = body.description ? String(body.description) : null
  if (body.color !== undefined) data.color = body.color ? String(body.color).substring(0, 20) : null
  if (body.active !== undefined) data.active = !!body.active

  if (body.durationMin !== undefined) data.durationMin = Math.max(5, numOr(body.durationMin, 30))
  if (body.bufferBeforeMin !== undefined) data.bufferBeforeMin = Math.max(0, numOr(body.bufferBeforeMin, 0))
  if (body.bufferAfterMin !== undefined) data.bufferAfterMin = Math.max(0, numOr(body.bufferAfterMin, 0))
  if (body.slotIncrementMin !== undefined) data.slotIncrementMin = Math.max(5, numOr(body.slotIncrementMin, 30))
  if (body.minNoticeMin !== undefined) data.minNoticeMin = Math.max(0, numOr(body.minNoticeMin, 240))
  if (body.bookingWindowDays !== undefined) data.bookingWindowDays = Math.max(1, numOr(body.bookingWindowDays, 60))
  if (body.maxPerDay !== undefined) data.maxPerDay = numOrNull(body.maxPerDay)
  if (body.visibleSlotsPerDay !== undefined) data.visibleSlotsPerDay = numOrNull(body.visibleSlotsPerDay)
  if (body.timezone !== undefined) data.timezone = String(body.timezone || 'America/Sao_Paulo').substring(0, 60)

  if (body.locationType !== undefined) data.locationType = LOCATION_TYPES.includes(body.locationType) ? body.locationType : 'google_meet'
  if (body.locationDetail !== undefined) data.locationDetail = body.locationDetail ? String(body.locationDetail).substring(0, 255) : null

  if (body.assignmentMode !== undefined) data.assignmentMode = ASSIGNMENT_MODES.includes(body.assignmentMode) ? body.assignmentMode : 'fixed'
  if (body.ownerUserId !== undefined) data.ownerUserId = numOrNull(body.ownerUserId)
  if (body.teamId !== undefined) data.teamId = numOrNull(body.teamId)

  if (body.funnelId !== undefined) data.funnelId = numOrNull(body.funnelId)
  if (body.stageKey !== undefined) data.stageKey = body.stageKey ? String(body.stageKey).substring(0, 60) : null
  if (body.defaultTeamId !== undefined) data.defaultTeamId = numOrNull(body.defaultTeamId)
  if (body.landingPageId !== undefined) data.landingPageId = numOrNull(body.landingPageId)

  if (body.intakeFields !== undefined) data.intakeFields = body.intakeFields ?? null
  if (body.confirmationConfig !== undefined) data.confirmationConfig = body.confirmationConfig ?? null
  if (body.pixelConfig !== undefined) data.pixelConfig = body.pixelConfig ?? null

  if (isCreate) {
    // defaults seguros
    if (data.durationMin === undefined) data.durationMin = 30
    if (data.locationType === undefined) data.locationType = 'google_meet'
  }
  return data
}

export async function schedulingRoutes(app: FastifyInstance) {
  // ── LIST ──
  app.get('/api/admin/scheduling/meeting-types', { preHandler: adminOnly }, async () => {
    const items = await prisma.meetingType.findMany({ orderBy: { id: 'asc' } })
    return { items }
  })

  // Operadores que JÁ conectaram o Google Calendar (kind=OPERATOR ativo, com scope
  // calendar). Usado no editor de tipo de reunião p/ avisar quando o dono escolhido
  // não tem agenda sincronizável (senão a sync falha em silêncio).
  app.get('/api/admin/scheduling/google-operators', { preHandler: adminOnly }, async () => {
    const conns = await prisma.googleConnection.findMany({
      where: { active: true, kind: 'OPERATOR', userId: { not: null } },
      select: { userId: true, scopes: true },
    })
    const connectedUserIds = conns
      .filter((c) => (c.scopes || '').includes('calendar'))
      .map((c) => c.userId!)
    return { connectedUserIds }
  })

  // ── GET ONE ──
  app.get('/api/admin/scheduling/meeting-types/:id', { preHandler: adminOnly }, async (req, reply) => {
    const id = parseInt((req.params as any).id, 10)
    const item = await prisma.meetingType.findUnique({ where: { id } })
    if (!item) return reply.code(404).send({ error: 'Tipo de reunião não encontrado' })
    return { item }
  })

  // ── CREATE ──
  app.post('/api/admin/scheduling/meeting-types', { preHandler: adminOnly }, async (req, reply) => {
    const body = (req.body as any) || {}
    if (!body.name || !String(body.name).trim()) {
      return reply.code(400).send({ error: 'Nome é obrigatório' })
    }
    const data = buildData(body, true)
    const baseSlug = body.slug ? slugify(body.slug) : slugify(body.name)
    data.slug = await uniqueSlug(baseSlug)
    const created = await prisma.meetingType.create({ data })
    return { item: created }
  })

  // ── UPDATE ──
  app.patch('/api/admin/scheduling/meeting-types/:id', { preHandler: adminOnly }, async (req, reply) => {
    const id = parseInt((req.params as any).id, 10)
    const exists = await prisma.meetingType.findUnique({ where: { id }, select: { id: true } })
    if (!exists) return reply.code(404).send({ error: 'Tipo de reunião não encontrado' })
    const body = (req.body as any) || {}
    const data = buildData(body, false)
    if (body.slug !== undefined && body.slug) data.slug = await uniqueSlug(slugify(body.slug), id)
    const updated = await prisma.meetingType.update({ where: { id }, data })
    return { item: updated }
  })

  // ── DELETE ── (bloqueia se houver reservas; sugere desativar)
  app.delete('/api/admin/scheduling/meeting-types/:id', { preHandler: adminOnly }, async (req, reply) => {
    const id = parseInt((req.params as any).id, 10)
    const bookings = await prisma.booking.count({ where: { meetingTypeId: id } })
    if (bookings > 0) {
      return reply.code(409).send({ error: `Há ${bookings} reserva(s) neste tipo. Desative em vez de excluir.` })
    }
    try {
      await prisma.meetingType.delete({ where: { id } })
      return { ok: true }
    } catch {
      return reply.code(404).send({ error: 'Tipo de reunião não encontrado' })
    }
  })

  // ── DISPONIBILIDADE: GET (rules + exceptions) ──
  app.get('/api/admin/scheduling/meeting-types/:id/availability', { preHandler: adminOnly }, async (req, reply) => {
    const id = parseInt((req.params as any).id, 10)
    const mt = await prisma.meetingType.findUnique({ where: { id }, select: { id: true, timezone: true } })
    if (!mt) return reply.code(404).send({ error: 'Tipo de reunião não encontrado' })
    const { rules, exceptions } = await loadAvailability(id)
    return {
      timezone: mt.timezone,
      rules,
      exceptions: exceptions.map((e) => ({
        id: e.id,
        date: e.date.toISOString().slice(0, 10),
        unavailable: e.unavailable,
        startTime: e.startTime,
        endTime: e.endTime,
        note: e.note,
      })),
    }
  })

  // ── DISPONIBILIDADE: PUT (upsert rules + substitui exceptions) ──
  app.put('/api/admin/scheduling/meeting-types/:id/availability', { preHandler: adminOnly }, async (req, reply) => {
    const id = parseInt((req.params as any).id, 10)
    const mt = await prisma.meetingType.findUnique({ where: { id }, select: { id: true, name: true, timezone: true } })
    if (!mt) return reply.code(404).send({ error: 'Tipo de reunião não encontrado' })
    const body = (req.body as any) || {}

    // Saneia rules: weekday 0-6, "HH:mm", start < end.
    const rawRules: any[] = Array.isArray(body.rules) ? body.rules : []
    const rules: WeeklyRule[] = rawRules
      .map((r) => ({ weekday: parseInt(r.weekday, 10), start: String(r.start || ''), end: String(r.end || '') }))
      .filter((r) => r.weekday >= 0 && r.weekday <= 6 && /^\d{2}:\d{2}$/.test(r.start) && /^\d{2}:\d{2}$/.test(r.end) && r.start < r.end)

    const existing = await prisma.availabilitySchedule.findFirst({ where: { meetingTypeId: id } })
    const schedule = existing
      ? await prisma.availabilitySchedule.update({ where: { id: existing.id }, data: { rules: rules as any, timezone: mt.timezone } })
      : await prisma.availabilitySchedule.create({ data: { name: `Agenda — ${mt.name}`, meetingTypeId: id, timezone: mt.timezone, rules: rules as any } })

    // Substitui exceções.
    await prisma.availabilityException.deleteMany({ where: { scheduleId: schedule.id } })
    const rawExc: any[] = Array.isArray(body.exceptions) ? body.exceptions : []
    for (const e of rawExc) {
      if (!e.date || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) continue
      await prisma.availabilityException.create({
        data: {
          scheduleId: schedule.id,
          date: new Date(e.date + 'T00:00:00Z'),
          unavailable: e.unavailable !== false,
          startTime: e.startTime || null,
          endTime: e.endTime || null,
          note: e.note ? String(e.note).substring(0, 191) : null,
        },
      })
    }
    return { ok: true }
  })

  // ── SLOTS disponíveis (preview admin; público reusa na Fase 3) ──
  app.get('/api/admin/scheduling/meeting-types/:id/slots', { preHandler: adminOnly }, async (req, reply) => {
    const id = parseInt((req.params as any).id, 10)
    const mt = await prisma.meetingType.findUnique({ where: { id } })
    if (!mt) return reply.code(404).send({ error: 'Tipo de reunião não encontrado' })
    const q = (req.query as any) || {}
    // MESMA função da página pública: o preview do admin precisa mostrar
    // exatamente o que o cliente vê. Calculando por conta própria aqui, o
    // preview exibia horários que a oferta real já descartava (no modo equipe,
    // os que nenhum operador atende).
    const { getMeetingTypeSlots } = await import('../services/schedulingService.js')
    const days = await getMeetingTypeSlots(mt, {
      ...(q.from ? { from: String(q.from) } : {}),
      ...(q.to ? { to: String(q.to) } : {}),
    })
    return { timezone: mt.timezone, durationMin: mt.durationMin, days }
  })

  // ── DISPONIBILIDADE DO OPERADOR (agenda pessoal, reusada pelos tipos dele) ──
  // Duas portas para os MESMOS dados: `my-availability` (o próprio operador) e
  // `users/:userId/availability` (gerente/admin cuidando da agenda da equipe —
  // ninguém precisa pedir ao agente que entre no sistema para ajustar um horário).

  /** Leitura crua da agenda pessoal; devolve o padrão seg-sex 09-18 se não existir. */
  async function readUserAvailability(userId: number) {
    const schedule = await prisma.availabilitySchedule.findFirst({ where: { ownerUserId: userId, meetingTypeId: null } })
    const exceptions = schedule
      ? await prisma.availabilityException.findMany({ where: { scheduleId: schedule.id }, orderBy: { date: 'asc' } })
      : []
    return {
      timezone: schedule?.timezone || 'America/Sao_Paulo',
      rules: (schedule?.rules as unknown as WeeklyRule[]) || DEFAULT_RULES,
      exceptions: exceptions.map((e) => ({ id: e.id, date: e.date.toISOString().slice(0, 10), unavailable: e.unavailable, startTime: e.startTime, endTime: e.endTime })),
    }
  }

  /** Grava a agenda pessoal. `ownerName` só nomeia o registro na criação. */
  async function writeUserAvailability(userId: number, ownerName: string | null, body: any) {
    const rawRules: any[] = Array.isArray(body?.rules) ? body.rules : []
    const rules: WeeklyRule[] = rawRules
      .map((r) => ({ weekday: parseInt(r.weekday, 10), start: String(r.start || ''), end: String(r.end || '') }))
      .filter((r) => r.weekday >= 0 && r.weekday <= 6 && /^\d{2}:\d{2}$/.test(r.start) && /^\d{2}:\d{2}$/.test(r.end) && r.start < r.end)
    const tz = String(body?.timezone || 'America/Sao_Paulo').substring(0, 60)

    const existing = await prisma.availabilitySchedule.findFirst({ where: { ownerUserId: userId, meetingTypeId: null } })
    const schedule = existing
      ? await prisma.availabilitySchedule.update({ where: { id: existing.id }, data: { rules: rules as any, timezone: tz } })
      : await prisma.availabilitySchedule.create({ data: { name: `Agenda de ${ownerName || ('user ' + userId)}`, ownerUserId: userId, timezone: tz, rules: rules as any } })

    await prisma.availabilityException.deleteMany({ where: { scheduleId: schedule.id } })
    const rawExc: any[] = Array.isArray(body?.exceptions) ? body.exceptions : []
    for (const e of rawExc) {
      if (!e.date || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) continue
      await prisma.availabilityException.create({
        data: { scheduleId: schedule.id, date: new Date(e.date + 'T00:00:00Z'), unavailable: e.unavailable !== false, startTime: e.startTime || null, endTime: e.endTime || null, note: e.note ? String(e.note).substring(0, 191) : null },
      })
    }
    return { rules, timezone: tz, exceptionCount: rawExc.length }
  }

  app.get('/api/admin/scheduling/my-availability', { preHandler: authMiddleware }, async (req) => {
    return readUserAvailability((req as any).user.userId as number)
  })

  app.put('/api/admin/scheduling/my-availability', { preHandler: authMiddleware }, async (req) => {
    const user = (req as any).user as JwtPayload
    await writeUserAvailability(user.userId, user.name ?? null, req.body)
    return { ok: true }
  })

  // Agenda de OUTRO operador. Só gerente/admin/superadmin; o próprio dono também
  // passa aqui (o frontend usa esta rota quando abre a agenda de alguém da lista).
  app.get('/api/admin/scheduling/users/:userId/availability', { preHandler: authMiddleware }, async (req, reply) => {
    const user = (req as any).user as JwtPayload
    const targetId = parseInt((req.params as any).userId, 10)
    if (!Number.isFinite(targetId)) return reply.code(400).send({ error: 'Usuário inválido' })
    if (targetId !== user.userId && !MANAGER_ROLES.includes(user.role)) {
      return reply.code(403).send({ error: 'Só gerente, administrador ou superadmin pode ver a disponibilidade de outro operador.' })
    }
    const target = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true, name: true, email: true, active: true } })
    if (!target) return reply.code(404).send({ error: 'Usuário não encontrado' })
    return { ...(await readUserAvailability(targetId)), user: { id: target.id, name: target.name, email: target.email, active: target.active } }
  })

  app.put('/api/admin/scheduling/users/:userId/availability', { preHandler: authMiddleware }, async (req, reply) => {
    const user = (req as any).user as JwtPayload
    const targetId = parseInt((req.params as any).userId, 10)
    if (!Number.isFinite(targetId)) return reply.code(400).send({ error: 'Usuário inválido' })
    if (targetId !== user.userId && !MANAGER_ROLES.includes(user.role)) {
      return reply.code(403).send({ error: 'Só gerente, administrador ou superadmin pode editar a disponibilidade de outro operador.' })
    }
    const target = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true, name: true, email: true } })
    if (!target) return reply.code(404).send({ error: 'Usuário não encontrado' })

    const before = await readUserAvailability(targetId)
    const saved = await writeUserAvailability(targetId, target.name ?? target.email, req.body)

    // Mexer na agenda de outra pessoa fica no histórico dela — quem alterou, quando
    // e o que era antes. Editar a própria não gera ruído no histórico.
    if (targetId !== user.userId) {
      void logUserAudit({
        action: 'scheduling.availability_changed',
        targetUserId: targetId,
        targetType: 'user',
        targetLabel: target.name || target.email,
        changes: {
          rules: { from: before.rules, to: saved.rules },
          timezone: { from: before.timezone, to: saved.timezone },
          exceptions: { from: before.exceptions.length, to: saved.exceptionCount },
        },
        ...auditActor(req),
      })
    }
    return { ok: true }
  })

  // ════════════════════ AGENDA / CALENDÁRIO ════════════════════
  // Eventos no intervalo [from,to): reservas de clientes (auto), atividades agendadas
  // do CRM e bloqueios/compromissos manuais. Managers veem todos ou filtram por
  // operador; demais veem apenas a própria agenda.
  app.get('/api/admin/scheduling/calendar', { preHandler: authMiddleware }, async (req, reply) => {
    const user = (req as any).user as JwtPayload
    const q = (req.query as any) || {}
    const from = q.from ? new Date(q.from) : new Date()
    const to = q.to ? new Date(q.to) : new Date(Date.now() + 31 * 86400000)
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
      return reply.code(400).send({ error: 'Intervalo inválido' })
    }
    const isManager = MANAGER_ROLES.includes(user.role)
    const requested = numOrNull(q.operatorUserId)
    const operatorId = isManager ? requested : user.userId // null (manager) = todos

    const bookings = await prisma.booking.findMany({
      where: {
        startAt: { lt: to }, endAt: { gt: from },
        status: { notIn: ['cancelled', 'rescheduled'] },
        ...(operatorId ? { operatorUserId: operatorId } : {}),
      },
      orderBy: { startAt: 'asc' }, take: 1000,
    })
    const blocks = await prisma.calendarBlock.findMany({
      where: { startAt: { lt: to }, endAt: { gt: from }, ...(operatorId ? { operatorUserId: operatorId } : {}) },
      orderBy: { startAt: 'asc' }, take: 1000,
    })
    const activitiesRaw = await prisma.activity.findMany({
      where: {
        scheduledAt: { gte: from, lt: to },
        type: { in: ['meeting', 'call', 'task', 'follow_up'] },
        status: { notIn: ['cancelled'] },
        ...(operatorId ? { userId: operatorId } : {}),
      },
      select: { id: true, leadId: true, userId: true, userName: true, type: true, title: true, status: true, scheduledAt: true },
      orderBy: { scheduledAt: 'asc' }, take: 1000,
    })
    const bookingActivityIds = new Set(bookings.map((b) => b.activityId).filter(Boolean) as number[])
    const activities = activitiesRaw.filter((a) => !bookingActivityIds.has(a.id) && a.scheduledAt)

    // Resolve nomes (tipos, leads, operadores).
    const mtIds = [...new Set(bookings.map((b) => b.meetingTypeId))]
    const types = mtIds.length ? await prisma.meetingType.findMany({ where: { id: { in: mtIds } }, select: { id: true, name: true, color: true, locationType: true } }) : []
    const typeMap = new Map(types.map((t) => [t.id, t]))
    const leadIds = [...new Set([...bookings.map((b) => b.leadId), ...activities.map((a) => a.leadId)].filter(Boolean))] as number[]
    const leads = leadIds.length ? await prisma.lead.findMany({ where: { id: { in: leadIds } }, select: { id: true, nome: true } }) : []
    const leadMap = new Map(leads.map((l) => [l.id, l.nome]))
    const opIds = [...new Set([...bookings.map((b) => b.operatorUserId), ...blocks.map((b) => b.operatorUserId), ...activities.map((a) => a.userId)].filter(Boolean))] as number[]
    const ops = opIds.length ? await prisma.user.findMany({ where: { id: { in: opIds } }, select: { id: true, name: true } }) : []
    const opMap = new Map(ops.map((o) => [o.id, o.name]))

    const events: any[] = [
      ...bookings.map((b) => {
        const t = typeMap.get(b.meetingTypeId)
        return {
          id: `booking:${b.id}`, refId: b.id, kind: 'booking', token: b.token,
          title: b.inviteeName || (b.leadId ? leadMap.get(b.leadId) : '') || t?.name || 'Reunião',
          startAt: b.startAt.toISOString(), endAt: b.endAt.toISOString(), allDay: false,
          status: b.status, color: t?.color || '#1a73e8',
          confirmedAt: b.confirmedAt ? b.confirmedAt.toISOString() : null,
          confirmRequestedAt: b.confirmRequestedAt ? b.confirmRequestedAt.toISOString() : null,
          meetingTypeName: t?.name ?? null, locationType: b.locationType || t?.locationType || null,
          meetLink: b.meetLink ?? null,
          operatorUserId: b.operatorUserId ?? null, operatorName: b.operatorUserId ? (opMap.get(b.operatorUserId) ?? null) : null,
          leadId: b.leadId ?? null, leadName: b.leadId ? (leadMap.get(b.leadId) ?? null) : null,
          inviteeName: b.inviteeName ?? null, inviteeEmail: b.inviteeEmail ?? null, inviteePhone: b.inviteePhone ?? null,
        }
      }),
      ...blocks.map((b) => ({
        id: `block:${b.id}`, refId: b.id, kind: 'block', blockKind: b.kind,
        title: b.title || (b.kind === 'busy' ? 'Bloqueado' : 'Compromisso'),
        startAt: b.startAt.toISOString(), endAt: b.endAt.toISOString(), allDay: b.allDay,
        status: 'scheduled', color: b.color || (b.kind === 'busy' ? '#94a3b8' : '#7c3aed'),
        note: b.note ?? null,
        operatorUserId: b.operatorUserId ?? null, operatorName: b.operatorUserId ? (opMap.get(b.operatorUserId) ?? null) : null,
      })),
      ...activities.map((a) => ({
        id: `activity:${a.id}`, refId: a.id, kind: 'activity', activityType: a.type,
        title: a.title || a.type, startAt: a.scheduledAt!.toISOString(),
        endAt: new Date(a.scheduledAt!.getTime() + 30 * 60000).toISOString(), allDay: false,
        status: a.status, color: '#0891b2',
        operatorUserId: a.userId ?? null, operatorName: a.userName || (a.userId ? (opMap.get(a.userId) ?? null) : null),
        leadId: a.leadId ?? null, leadName: a.leadId ? (leadMap.get(a.leadId) ?? null) : null,
      })),
    ]

    // Eventos externos do Google Calendar (read-only). Para um operador específico,
    // busca só o dele; na visão "Todos os operadores", busca de TODOS os operadores
    // com Google conectado — antes só buscava no modo individual, por isso a agenda
    // do Google não aparecia em "Todos". getExternalGoogleEvents é cacheado (TTL),
    // então as N chamadas ficam baratas após o primeiro load.
    const googleConns = await prisma.googleConnection.findMany({
      where: { active: true, kind: 'OPERATOR', ...(operatorId ? { userId: operatorId } : {}) },
      select: { userId: true },
    })
    const googleOpIds = [...new Set(googleConns.map((c) => c.userId).filter((x): x is number => x != null))]
    const googleConnected = googleOpIds.length > 0
    // Resolve nomes de operadores que só têm evento no Google (não estavam no opMap).
    const missingNameIds = googleOpIds.filter((id) => !opMap.has(id))
    if (missingNameIds.length) {
      const more = await prisma.user.findMany({ where: { id: { in: missingNameIds } }, select: { id: true, name: true } })
      for (const u of more) opMap.set(u.id, u.name)
    }
    const googleResults = await Promise.all(
      googleOpIds.map(async (opId) => ({ opId, ext: await getExternalGoogleEvents(opId, from, to) })),
    )
    for (const { opId, ext } of googleResults) {
      for (const e of ext) {
        events.push({
          id: `google:${opId}:${e.eventId}`, refId: 0, kind: 'google', googleEventId: e.eventId,
          title: e.summary, startAt: e.startAt, endAt: e.endAt, allDay: e.allDay,
          status: 'busy', color: '#0b8043', htmlLink: e.htmlLink,
          operatorUserId: opId, operatorName: opMap.get(opId) ?? null,
        } as any)
      }
    }
    return { events, scope: operatorId ? 'operator' : (isManager ? 'all' : 'self'), operatorUserId: operatorId ?? null, canSeeAll: isManager, googleConnected }
  })

  // Cria bloqueio/compromisso manual. Não-managers criam só na própria agenda.
  app.post('/api/admin/scheduling/calendar/blocks', { preHandler: authMiddleware }, async (req, reply) => {
    const user = (req as any).user as JwtPayload
    const b = (req.body as any) || {}
    const start = new Date(b.startAt), end = new Date(b.endAt)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return reply.code(400).send({ error: 'Datas inválidas' })
    const isManager = MANAGER_ROLES.includes(user.role)
    const operatorUserId = isManager ? (numOrNull(b.operatorUserId) ?? user.userId) : user.userId
    const created = await prisma.calendarBlock.create({
      data: {
        operatorUserId,
        title: String(b.title || '').substring(0, 191),
        kind: b.kind === 'event' ? 'event' : 'busy',
        startAt: start, endAt: end, allDay: !!b.allDay,
        color: b.color ? String(b.color).substring(0, 20) : null,
        note: b.note ? String(b.note) : null,
        createdByUserId: user.userId, source: 'manual',
      },
    })
    pushBlockToGoogle(created.id).catch(() => {}) // espelha no Google (background)
    return { item: created }
  })

  app.patch('/api/admin/scheduling/calendar/blocks/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const user = (req as any).user as JwtPayload
    const id = parseInt((req.params as any).id, 10)
    const existing = await prisma.calendarBlock.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ error: 'Bloqueio não encontrado' })
    const isManager = MANAGER_ROLES.includes(user.role)
    if (!isManager && existing.operatorUserId !== user.userId) return reply.code(403).send({ error: 'Sem permissão' })
    const b = (req.body as any) || {}
    const data: any = {}
    if (b.title !== undefined) data.title = String(b.title || '').substring(0, 191)
    if (b.kind !== undefined) data.kind = b.kind === 'event' ? 'event' : 'busy'
    if (b.startAt !== undefined) { const s = new Date(b.startAt); if (!Number.isNaN(s.getTime())) data.startAt = s }
    if (b.endAt !== undefined) { const e = new Date(b.endAt); if (!Number.isNaN(e.getTime())) data.endAt = e }
    if (b.allDay !== undefined) data.allDay = !!b.allDay
    if (b.color !== undefined) data.color = b.color ? String(b.color).substring(0, 20) : null
    if (b.note !== undefined) data.note = b.note ? String(b.note) : null
    if (isManager && b.operatorUserId !== undefined) data.operatorUserId = numOrNull(b.operatorUserId)
    const start = data.startAt ?? existing.startAt, end = data.endAt ?? existing.endAt
    if (end <= start) return reply.code(400).send({ error: 'Fim deve ser após o início' })
    const updated = await prisma.calendarBlock.update({ where: { id }, data })
    updateBlockInGoogle(updated.id).catch(() => {}) // sincroniza alteração no Google
    return { item: updated }
  })

  app.delete('/api/admin/scheduling/calendar/blocks/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const user = (req as any).user as JwtPayload
    const id = parseInt((req.params as any).id, 10)
    const existing = await prisma.calendarBlock.findUnique({ where: { id }, select: { id: true, operatorUserId: true, googleEventId: true, googleCalendarId: true } })
    if (!existing) return reply.code(404).send({ error: 'Bloqueio não encontrado' })
    if (!MANAGER_ROLES.includes(user.role) && existing.operatorUserId !== user.userId) return reply.code(403).send({ error: 'Sem permissão' })
    await prisma.calendarBlock.delete({ where: { id } })
    deleteBlockFromGoogle(existing.googleEventId, existing.googleCalendarId, existing.operatorUserId).catch(() => {}) // remove do Google
    return { ok: true }
  })

  // Muda status de uma reserva pela agenda (concluir / não compareceu / cancelar).
  app.patch('/api/admin/scheduling/calendar/bookings/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const user = (req as any).user as JwtPayload
    const id = parseInt((req.params as any).id, 10)
    const bk = await prisma.booking.findUnique({ where: { id } })
    if (!bk) return reply.code(404).send({ error: 'Reserva não encontrada' })
    if (!MANAGER_ROLES.includes(user.role) && bk.operatorUserId !== user.userId) return reply.code(403).send({ error: 'Sem permissão' })
    const body = (req.body as any) || {}
    const status = String(body.status || '')
    if (!['scheduled', 'confirmed', 'completed', 'no_show', 'cancelled'].includes(status)) return reply.code(400).send({ error: 'Status inválido' })
    await prisma.booking.update({ where: { id }, data: { status, ...(status === 'cancelled' ? { cancelReason: body.reason ? String(body.reason).substring(0, 255) : 'Cancelado pelo painel' } : {}) } })
    if (bk.activityId) {
      if (status === 'cancelled') {
        await prisma.activity.update({ where: { id: bk.activityId }, data: { status: 'cancelled' } }).catch(() => {})
        import('../services/googleCalendarSync.js').then((m: any) => m.unsyncActivityFromCalendar?.(bk.activityId)).catch(() => {})
      } else if (status === 'completed') {
        await prisma.activity.update({ where: { id: bk.activityId }, data: { status: 'completed', completedAt: new Date() } }).catch(() => {})
      }
    }
    return { ok: true }
  })

  // Healthcheck do módulo.
  app.get('/api/admin/scheduling/ping', { preHandler: adminOnly }, async () => {
    const [types, bookings] = await Promise.all([prisma.meetingType.count(), prisma.booking.count()])
    return { ok: true, module: 'scheduling', meetingTypes: types, bookings }
  })
}
