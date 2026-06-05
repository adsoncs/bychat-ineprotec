// Lógica compartilhada do módulo de Agendamento: disponibilidade, slots e criação
// de reserva (lead + booking). Usado pelas rotas admin e pública.
import { randomBytes } from 'crypto'
import { prisma } from '../lib/prisma.js'
import { computeSlots, type WeeklyRule, type ExceptionRule, type DaySlots } from './schedulingSlots.js'
import { generateUid, normalizePhone, findDuplicate } from './dedup.js'
import { eventBus } from '../lib/eventBus.js'
import { getExternalGoogleEvents } from './schedulingGoogle.js'

export const DEFAULT_RULES: WeeklyRule[] = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: '09:00', end: '18:00' }))

export async function loadAvailability(meetingTypeId: number) {
  const schedule = await prisma.availabilitySchedule.findFirst({ where: { meetingTypeId } })
  const exceptions = schedule
    ? await prisma.availabilityException.findMany({ where: { scheduleId: schedule.id }, orderBy: { date: 'asc' } })
    : []
  const rules = (schedule?.rules as unknown as WeeklyRule[]) || DEFAULT_RULES
  return { schedule, rules, exceptions }
}

type MeetingTypeRow = Awaited<ReturnType<typeof prisma.meetingType.findUnique>>

// Resolve um tipo de reunião ATIVO pelo slug (null se inexistente/inativo).
// Compartilhado pela rota pública de agendamento e pelo runner de chatbot.
export async function getActiveMeetingType(slug: string): Promise<NonNullable<MeetingTypeRow> | null> {
  const mt = await prisma.meetingType.findUnique({ where: { slug } })
  if (!mt || !mt.active) return null
  return mt
}

// Resolve a agenda efetiva de um tipo: agenda própria do tipo → agenda do operador
// dono (reutilizada entre os tipos dele) → padrão seg-sex 09-18.
export async function resolveScheduleForType(mt: { id: number; ownerUserId: number | null }) {
  let schedule = await prisma.availabilitySchedule.findFirst({ where: { meetingTypeId: mt.id } })
  if (!schedule && mt.ownerUserId) {
    schedule = await prisma.availabilitySchedule.findFirst({ where: { ownerUserId: mt.ownerUserId, meetingTypeId: null } })
  }
  const exceptions = schedule
    ? await prisma.availabilityException.findMany({ where: { scheduleId: schedule.id }, orderBy: { date: 'asc' } })
    : []
  const rules = (schedule?.rules as unknown as WeeklyRule[]) || DEFAULT_RULES
  return { schedule, rules, exceptions }
}

export async function getMeetingTypeSlots(mt: NonNullable<MeetingTypeRow>, opts: { from?: string; to?: string } = {}): Promise<DaySlots[]> {
  const { rules, exceptions } = await resolveScheduleForType(mt)
  const windowEnd = new Date(Date.now() + mt.bookingWindowDays * 86400000)
  const bookings = await prisma.booking.findMany({
    where: {
      status: { notIn: ['cancelled', 'no_show', 'rescheduled'] },
      endAt: { gt: new Date() },
      startAt: { lt: windowEnd },
      ...(mt.ownerUserId ? { operatorUserId: mt.ownerUserId } : { meetingTypeId: mt.id }),
    },
    select: { startAt: true, endAt: true },
  })
  // Bloqueios/compromissos manuais do dono também ocupam a agenda → removem slots.
  const blocks = mt.ownerUserId
    ? await prisma.calendarBlock.findMany({
        where: { operatorUserId: mt.ownerUserId, endAt: { gt: new Date() }, startAt: { lt: windowEnd } },
        select: { startAt: true, endAt: true },
      })
    : []
  // Eventos do Google Calendar pessoal do dono também ocupam a agenda (free/busy).
  const googleBusyRaw = await getExternalGoogleEvents(mt.ownerUserId, new Date(), windowEnd)
  const googleBusy = googleBusyRaw.map((e) => ({ startAt: new Date(e.startAt), endAt: new Date(e.endAt) }))
  const busy = [...bookings, ...blocks, ...googleBusy]
  return computeSlots({
    timezone: mt.timezone,
    durationMin: mt.durationMin,
    slotIncrementMin: mt.slotIncrementMin,
    bufferBeforeMin: mt.bufferBeforeMin,
    bufferAfterMin: mt.bufferAfterMin,
    minNoticeMin: mt.minNoticeMin,
    bookingWindowDays: mt.bookingWindowDays,
    maxPerDay: mt.maxPerDay,
    visibleSlotsPerDay: mt.visibleSlotsPerDay,
    rules,
    exceptions: exceptions.map((e) => ({
      date: e.date.toISOString().slice(0, 10), unavailable: e.unavailable, startTime: e.startTime, endTime: e.endTime,
    })) as ExceptionRule[],
    bookings: busy,
    fromDate: opts.from,
    toDate: opts.to,
  })
}

// Valida que o horário escolhido é realmente um slot disponível (anti-tampering
// e anti-double-booking). Retorna o ISO normalizado do slot ou null.
export async function validateSlot(mt: NonNullable<MeetingTypeRow>, startAtISO: string): Promise<string | null> {
  const target = new Date(startAtISO)
  if (Number.isNaN(target.getTime())) return null
  const days = await getMeetingTypeSlots(mt)
  for (const d of days) for (const s of d.slots) if (s.startAt === target.toISOString()) return s.startAt
  return null
}

export interface BookInput {
  name: string
  email?: string | null
  phone?: string | null
  startAt: string
  answers?: unknown
  timezone?: string | null
  visitorId?: string | null
  utm?: { source?: string; medium?: string; campaign?: string; content?: string; term?: string } | null
  // Funil efetivo (ex.: funil da conexão do chatbot). Quando setado, a reunião move
  // o lead para a etapa do tipo (mt.stageKey) DENTRO deste funil, em vez de mt.funnelId.
  funnelOverride?: number | null
}

export interface BookResult {
  ok: boolean
  error?: string
  booking?: { id: number; token: string; startAt: string; endAt: string; status: string }
}

export async function createBooking(mt: NonNullable<MeetingTypeRow>, input: BookInput): Promise<BookResult> {
  if (!input.name || !String(input.name).trim()) return { ok: false, error: 'Informe seu nome' }
  if (!input.email && !input.phone) return { ok: false, error: 'Informe e-mail ou telefone' }

  const validStart = await validateSlot(mt, input.startAt)
  if (!validStart) return { ok: false, error: 'Horário indisponível. Escolha outro.' }

  const startAt = new Date(validStart)
  const endAt = new Date(startAt.getTime() + mt.durationMin * 60000)
  const whatsapp = input.phone ? normalizePhone(String(input.phone)) : ''
  const email = input.email ? String(input.email).trim().toLowerCase() : ''
  // Funil efetivo: override (funil da conexão) tem prioridade sobre o do tipo.
  const effFunnelId = input.funnelOverride ?? mt.funnelId ?? null

  // Dedup: linka lead existente por whatsapp/email; senão cria novo.
  let leadId: number | null = null
  const dup = await findDuplicate(whatsapp || undefined, email || undefined)
  if (dup?.lead?.id) {
    const lid = dup.lead.id
    leadId = lid
    // A reunião pertence ao DONO do tipo (operador principal de agendamentos).
    // Mesmo que o lead tenha sido roteado antes para outro agente (form/chatbot),
    // ao agendar ele passa a ser do dono — só o dono atende os agendamentos.
    if (mt.ownerUserId) {
      await prisma.lead.update({ where: { id: lid }, data: { assignedUserId: mt.ownerUserId, assignedAt: new Date() } }).catch(() => {})
    }
  } else {
    const lead = await prisma.lead.create({
      data: {
        uid: await generateUid(),
        nome: String(input.name).trim(),
        whatsapp: whatsapp || '',
        email: email || '',
        empresa: String(input.name).trim() || 'Lead Agendamento',
        formData: { _source: 'scheduling', _meetingTypeId: mt.id, answers: input.answers ?? null },
        scores: {},
        status: mt.stageKey || 'NOVO',
        teamId: mt.defaultTeamId ?? null,
        assignedUserId: mt.ownerUserId ?? null,
        assignedAt: mt.ownerUserId ? new Date() : null,
        ...(effFunnelId ? { funnelId: effFunnelId } : {}),
        completed: false,
        source: 'scheduling',
        utmSource: input.utm?.source ?? null,
        utmMedium: input.utm?.medium ?? null,
        utmCampaign: input.utm?.campaign ?? null,
        utmContent: input.utm?.content ?? null,
        utmTerm: input.utm?.term ?? null,
        originType: 'scheduling',
        qualifiedAt: new Date(),
        qualificationSource: 'scheduling',
      },
      select: { id: true },
    })
    leadId = lead.id
  }

  const token = randomBytes(16).toString('hex')
  const booking = await prisma.booking.create({
    data: {
      token,
      meetingTypeId: mt.id,
      leadId,
      operatorUserId: mt.ownerUserId ?? null,
      startAt,
      endAt,
      timezone: mt.timezone,
      status: 'scheduled',
      inviteeName: String(input.name).trim().substring(0, 191),
      inviteeEmail: email || null,
      inviteePhone: whatsapp || null,
      answers: (input.answers as any) ?? null,
      locationType: mt.locationType,
      source: 'scheduling',
      visitorId: input.visitorId ? String(input.visitorId).substring(0, 64) : null,
      utmSource: input.utm?.source ?? null,
      utmMedium: input.utm?.medium ?? null,
      utmCampaign: input.utm?.campaign ?? null,
      utmContent: input.utm?.content ?? null,
      utmTerm: input.utm?.term ?? null,
    },
    select: { id: true, token: true, startAt: true, endAt: true, status: true },
  })

  await prisma.meetingType.update({ where: { id: mt.id }, data: { totalBookings: { increment: 1 } } }).catch(() => {})

  // ── Fase 6: integração CRM ──
  if (leadId) {
    // Move o lead pra etapa do tipo (novos já nascem lá; dedup-existentes movem).
    if (effFunnelId && mt.stageKey) {
      try {
        const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { funnelId: true, status: true } })
        if (lead && (lead.status !== mt.stageKey || lead.funnelId !== effFunnelId)) {
          const prevStatus = lead.status
          const prevFunnel = lead.funnelId
          await prisma.lead.update({ where: { id: leadId }, data: { status: mt.stageKey, funnelId: effFunnelId } })
          await prisma.leadStageMovement.create({
            data: { leadId, fromFunnelId: prevFunnel, toFunnelId: effFunnelId, fromStageKey: prevStatus ?? null, toStageKey: mt.stageKey, source: 'scheduling' },
          }).catch(() => {})
        }
      } catch { /* não bloqueia a reserva */ }
    }

    // Activity 'meeting' (timeline + agenda + sync Google Calendar/Meet).
    try {
      let ownerName: string | null = null
      if (mt.ownerUserId) {
        const u = await prisma.user.findUnique({ where: { id: mt.ownerUserId }, select: { name: true, email: true } })
        ownerName = u?.name || u?.email || null
      }
      const reminderAt = new Date(startAt.getTime() - 60 * 60000)
      const activity = await prisma.activity.create({
        data: {
          leadId,
          userId: mt.ownerUserId ?? null,
          userName: ownerName,
          type: 'meeting',
          title: `Reunião: ${mt.name}`,
          description: 'Agendada via página pública de agendamento.',
          status: 'pending',
          scheduledAt: startAt,
          reminderAt: reminderAt > new Date() ? reminderAt : null,
          recipientPhone: whatsapp || null,
          recipientEmail: email || null,
          metadata: { bookingId: booking.id, bookingToken: booking.token, meetingTypeId: mt.id, locationType: mt.locationType },
        },
        select: { id: true },
      })
      await prisma.booking.update({ where: { id: booking.id }, data: { activityId: activity.id } })
      // Gera evento no Google Calendar (+ Meet link em activity.metadata) e, ao terminar,
      // dispara a confirmação (WhatsApp + e-mail) com o link já disponível — background.
      import('./googleCalendarSync.js')
        .then((m) => m.syncActivityToCalendar(activity.id))
        .catch(() => {})
        .finally(() => { import('./schedulingNotify.js').then((n) => n.notifyBooking(booking.id, 'confirmation')).catch(() => {}) })
    } catch {
      // Sem Activity (ex.: erro) — ainda assim envia a confirmação.
      import('./schedulingNotify.js').then((n) => n.notifyBooking(booking.id, 'confirmation')).catch(() => {})
    }

    // Evento de domínio (workflows escutam).
    eventBus.emitDomain({
      type: 'meeting.scheduled',
      leadId,
      ...(mt.funnelId ? { funnelId: mt.funnelId } : {}),
      payload: { bookingId: booking.id, meetingTypeId: mt.id, startAt: booking.startAt.toISOString() },
    } as any)
  }

  return { ok: true, booking: { id: booking.id, token: booking.token, startAt: booking.startAt.toISOString(), endAt: booking.endAt.toISOString(), status: booking.status } }
}
