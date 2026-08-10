// Lógica compartilhada do módulo de Agendamento: disponibilidade, slots e criação
// de reserva (lead + booking). Usado pelas rotas admin e pública.
import { randomBytes } from 'crypto'
import { prisma } from '../lib/prisma.js'
import { computeSlots, type WeeklyRule, type ExceptionRule, type DaySlots } from './schedulingSlots.js'
import { generateUid, normalizePhone, findDuplicate } from './dedup.js'
import { eventBus } from '../lib/eventBus.js'
import { getExternalGoogleEvents } from './schedulingGoogle.js'
import { pickOperatorForTeam } from './teamRouting.js'

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

/** Agenda PESSOAL de um operador (regras + exceções), com o padrão seg-sex 09-18
 *  quando ele nunca configurou "Minha disponibilidade". */
export async function personalSchedule(userId: number): Promise<{ rules: WeeklyRule[]; exceptions: ExceptionRule[] }> {
  const schedule = await prisma.availabilitySchedule.findFirst({ where: { ownerUserId: userId, meetingTypeId: null } })
  const exceptions = schedule
    ? await prisma.availabilityException.findMany({ where: { scheduleId: schedule.id }, orderBy: { date: 'asc' } })
    : []
  return {
    rules: (schedule?.rules as unknown as WeeklyRule[]) || DEFAULT_RULES,
    exceptions: exceptions.map((e) => ({
      date: e.date.toISOString().slice(0, 10), unavailable: e.unavailable, startTime: e.startTime, endTime: e.endTime,
    })),
  }
}

/** Duração assumida para uma atividade do CRM, que não tem hora de término. */
const ACTIVITY_BLOCK_MIN = 60

/** Tudo que ocupa a agenda de um operador na janela: reuniões dele (de QUALQUER
 *  tipo), bloqueios manuais, compromissos do CRM e eventos do Google Calendar.
 *
 *  As atividades entram porque a Agenda já as mostra como compromisso — antes o
 *  motor de slots as ignorava e continuava ofertando um horário em que o operador
 *  tem reunião marcada no CRM. Reuniões que nasceram de uma reserva têm
 *  `booking.activityId` e são puladas, senão contariam duas vezes. */
export async function operatorBusy(
  userId: number, from: Date, to: Date, excludeBookingId?: number | null,
): Promise<{ startAt: Date; endAt: Date }[]> {
  const [bookings, blocks, activities, bookingActivities, google] = await Promise.all([
    prisma.booking.findMany({
      where: {
        operatorUserId: userId,
        status: { notIn: ['cancelled', 'no_show', 'rescheduled'] },
        endAt: { gt: from }, startAt: { lt: to },
        ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
      },
      select: { startAt: true, endAt: true },
    }),
    prisma.calendarBlock.findMany({
      where: { operatorUserId: userId, endAt: { gt: from }, startAt: { lt: to } },
      select: { startAt: true, endAt: true },
    }),
    prisma.activity.findMany({
      where: {
        type: { in: ['meeting', 'call'] },
        status: { in: ['pending', 'overdue'] },
        // `assignedUserId` é quem executa; `userId` (criador) só vale como
        // fallback quando ninguém foi designado.
        OR: [{ assignedUserId: userId }, { assignedUserId: null, userId }],
        scheduledAt: { gte: new Date(from.getTime() - ACTIVITY_BLOCK_MIN * 60000), lt: to },
      },
      select: { id: true, scheduledAt: true },
    }),
    prisma.booking.findMany({ where: { activityId: { not: null } }, select: { activityId: true } }),
    getExternalGoogleEvents(userId, from, to).catch(() => []),
  ])
  const fromBooking = new Set(bookingActivities.map((b) => b.activityId!))
  const activitySpans = activities
    .filter((a) => !fromBooking.has(a.id))
    .map((a) => ({ startAt: a.scheduledAt, endAt: new Date(a.scheduledAt.getTime() + ACTIVITY_BLOCK_MIN * 60000) }))
  return [
    ...bookings,
    ...blocks,
    ...activitySpans,
    ...google.map((e: any) => ({ startAt: new Date(e.startAt), endAt: new Date(e.endAt) })),
  ]
}

/**
 * Horários em que CADA operador elegível da equipe está livre, no formato
 * `Set<startAt ISO>`. É a peça que faltava no modo "Orquestrar pela Equipe":
 * antes os slots saíam da agenda do TIPO e o agente era sorteado depois, sem
 * ninguém olhar a agenda dele — um agente que não atende de manhã recebia
 * reunião de manhã.
 */
async function freeSlotsByOperator(
  mt: NonNullable<MeetingTypeRow>,
  operatorIds: number[],
  opts: { from?: string; to?: string },
): Promise<Map<number, Set<string>>> {
  const windowEnd = new Date(Date.now() + mt.bookingWindowDays * 86400000)
  const out = new Map<number, Set<string>>()
  for (const uid of operatorIds) {
    const { rules, exceptions } = await personalSchedule(uid)
    const busy = await operatorBusy(uid, new Date(), windowEnd)
    // maxPerDay/visibleSlotsPerDay são tetos DO TIPO — aplicados na malha do
    // tipo, não aqui, senão cortariam a agenda de cada operador em separado.
    const days = computeSlots({
      timezone: mt.timezone,
      durationMin: mt.durationMin,
      slotIncrementMin: mt.slotIncrementMin,
      bufferBeforeMin: mt.bufferBeforeMin,
      bufferAfterMin: mt.bufferAfterMin,
      minNoticeMin: mt.minNoticeMin,
      bookingWindowDays: mt.bookingWindowDays,
      maxPerDay: null,
      visibleSlotsPerDay: null,
      rules, exceptions, bookings: busy,
      fromDate: opts.from, toDate: opts.to,
    })
    out.set(uid, new Set(days.flatMap((d) => d.slots.map((s) => s.startAt))))
  }
  return out
}

/** Operadores da equipe que estão livres num intervalo específico. */
export async function operatorsFreeAt(teamId: number, startAt: Date, endAt: Date, tz: string): Promise<number[]> {
  const { listSchedulableOperators, operatorsOnVacationAt } = await import('./teamRouting.js')
  const ids = await listSchedulableOperators(teamId, startAt)
  const ferias = await operatorsOnVacationAt(ids, startAt)
  const free: number[] = []
  for (const uid of ids) {
    if (ferias.has(uid)) continue
    const { rules, exceptions } = await personalSchedule(uid)
    if (!withinRules(startAt, rules, exceptions, tz)) continue
    const busy = await operatorBusy(uid, startAt, endAt)
    if (busy.some((b) => b.startAt < endAt && startAt < b.endAt)) continue
    free.push(uid)
  }
  return free
}

/** O instante cai dentro das regras semanais (respeitando exceções do dia)? */
function withinRules(at: Date, rules: WeeklyRule[], exceptions: ExceptionRule[], tz: string): boolean {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at)
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? ''
  const dateStr = `${g('year')}-${g('month')}-${g('day')}`
  const h = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(at)
  const gh = (t: string) => h.find((x) => x.type === t)?.value ?? ''
  const hhmm = `${gh('hour') === '24' ? '00' : gh('hour')}:${gh('minute')}`
  const exc = exceptions.find((e) => e.date === dateStr)
  if (exc) {
    if (exc.unavailable) return false
    if (exc.startTime && exc.endTime) return exc.startTime <= hhmm && hhmm < exc.endTime
    return false
  }
  const weekday = new Date(`${dateStr}T12:00:00Z`).getUTCDay()
  return rules.some((r) => r.weekday === weekday && r.start <= hhmm && hhmm < r.end)
}

export async function getMeetingTypeSlots(mt: NonNullable<MeetingTypeRow>, opts: { from?: string; to?: string } = {}): Promise<DaySlots[]> {
  // No modo "Orquestrar pela Equipe" não há dono fixo: a agenda do tipo define o
  // TETO do que pode ser ofertado, e logo abaixo cada slot ainda precisa ter ao
  // menos um operador da equipe livre nele.
  const ownerForAgenda = mt.assignmentMode === 'team_routing' ? null : mt.ownerUserId
  const { rules, exceptions } = await resolveScheduleForType({ id: mt.id, ownerUserId: ownerForAgenda })
  const windowEnd = new Date(Date.now() + mt.bookingWindowDays * 86400000)
  const bookings = await prisma.booking.findMany({
    where: {
      status: { notIn: ['cancelled', 'no_show', 'rescheduled'] },
      endAt: { gt: new Date() },
      startAt: { lt: windowEnd },
      ...(ownerForAgenda ? { operatorUserId: ownerForAgenda } : { meetingTypeId: mt.id }),
    },
    select: { startAt: true, endAt: true },
  })
  // Bloqueios/compromissos manuais do dono também ocupam a agenda → removem slots.
  const blocks = ownerForAgenda
    ? await prisma.calendarBlock.findMany({
        where: { operatorUserId: ownerForAgenda, endAt: { gt: new Date() }, startAt: { lt: windowEnd } },
        select: { startAt: true, endAt: true },
      })
    : []
  // Eventos do Google Calendar pessoal do dono também ocupam a agenda (free/busy).
  const googleBusyRaw = await getExternalGoogleEvents(ownerForAgenda, new Date(), windowEnd)
  const googleBusy = googleBusyRaw.map((e) => ({ startAt: new Date(e.startAt), endAt: new Date(e.endAt) }))
  const busy = [...bookings, ...blocks, ...googleBusy]
  const teamMode = mt.assignmentMode === 'team_routing' && !!mt.teamId
  const days = computeSlots({
    timezone: mt.timezone,
    durationMin: mt.durationMin,
    slotIncrementMin: mt.slotIncrementMin,
    bufferBeforeMin: mt.bufferBeforeMin,
    bufferAfterMin: mt.bufferAfterMin,
    minNoticeMin: mt.minNoticeMin,
    bookingWindowDays: mt.bookingWindowDays,
    maxPerDay: mt.maxPerDay,
    // No modo equipe o corte por dia sai depois do cruzamento com as agendas
    // dos operadores — cortar antes esconderia horários que alguém atende.
    visibleSlotsPerDay: teamMode ? null : mt.visibleSlotsPerDay,
    rules,
    exceptions: exceptions.map((e) => ({
      date: e.date.toISOString().slice(0, 10), unavailable: e.unavailable, startTime: e.startTime, endTime: e.endTime,
    })) as ExceptionRule[],
    bookings: busy,
    fromDate: opts.from,
    toDate: opts.to,
  })
  if (!teamMode) return days

  // Modo equipe: o slot só sobrevive se ALGUM operador elegível estiver livre
  // nele. Sem isso o cliente marca 09:00 e o rodízio entrega a quem só atende à
  // tarde (bug do agente Asafe, 10/08/2026).
  const { listSchedulableOperators, operatorsOnVacationAt } = await import('./teamRouting.js')
  // `at: windowEnd` mantém na lista quem volta de férias dentro da janela; a
  // ausência de cada um é descontada por slot logo abaixo.
  const horizon = new Date(Date.now() + mt.bookingWindowDays * 86400000)
  const operatorIds = await listSchedulableOperators(mt.teamId!, horizon)
  if (operatorIds.length === 0) return []
  const byOperator = await freeSlotsByOperator(mt, operatorIds, opts)
  const vacation = new Map<string, Set<number>>()
  const onVacation = async (startAt: string) => {
    let set = vacation.get(startAt)
    if (!set) { set = await operatorsOnVacationAt(operatorIds, new Date(startAt)); vacation.set(startAt, set) }
    return set
  }
  const anyFree = async (startAt: string) => {
    const ferias = await onVacation(startAt)
    return operatorIds.some((uid) => !ferias.has(uid) && byOperator.get(uid)?.has(startAt))
  }
  const cut = mt.visibleSlotsPerDay
  const out: DaySlots[] = []
  for (const d of days) {
    const keep: typeof d.slots = []
    for (const s of d.slots) if (await anyFree(s.startAt)) keep.push(s)
    const slots = cut != null ? keep.slice(0, cut) : keep
    if (slots.length > 0) out.push({ ...d, slots })
  }
  return out
}

// Valida que o horário escolhido é realmente um slot disponível (anti-tampering
// e anti-double-booking). Retorna o ISO normalizado do slot ou null.
export async function validateSlot(
  mt: NonNullable<MeetingTypeRow>,
  startAtISO: string,
  opts: { operatorUserId?: number | null; excludeBookingId?: number | null } = {},
): Promise<string | null> {
  const target = new Date(startAtISO)
  if (Number.isNaN(target.getTime())) return null
  const days = await getMeetingTypeSlots(mt)
  let hit: string | null = null
  for (const d of days) for (const s of d.slots) if (s.startAt === target.toISOString()) hit = s.startAt
  if (!hit) return null

  // Remarcação de reunião que JÁ tem dono: o novo horário também precisa caber
  // na agenda dele. Sem isso, remarcar valida contra a malha geral do tipo e
  // empurra a reunião para fora do expediente do operador que vai atender.
  if (opts.operatorUserId) {
    const end = new Date(target.getTime() + mt.durationMin * 60000)
    const { rules, exceptions } = await personalSchedule(opts.operatorUserId)
    if (!withinRules(target, rules, exceptions, mt.timezone)) return null
    const busy = await operatorBusy(opts.operatorUserId, target, end, opts.excludeBookingId)
    if (busy.some((b) => b.startAt < end && target < b.endAt)) return null
  }
  return hit
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

  // Operador/equipe efetivos da reunião.
  //  • fixed (padrão): dono operador fixo do tipo (mt.ownerUserId).
  //  • team_routing: distribui pela Equipe (mt.teamId) usando o motor de Roteamento
  //    de Leads (pickOperatorForTeam: round-robin/least-loaded, working-hours e
  //    disponibilidade). Se ninguém elegível, fica na fila da equipe (operador null).
  let effectiveOperatorId: number | null = mt.ownerUserId
  let effectiveTeamId: number | null = mt.defaultTeamId ?? null
  if (mt.assignmentMode === 'team_routing' && mt.teamId) {
    effectiveTeamId = mt.teamId
    // O rodízio escolhe SÓ entre quem está livre NESTE horário. Antes ele era
    // chamado sem saber a hora da reunião e podia entregar a quem não atende
    // àquela hora. Ninguém livre (corrida entre dois clientes no mesmo slot) →
    // null, e a reunião fica na fila da equipe em vez de cair no agente errado.
    const livres = await operatorsFreeAt(mt.teamId, startAt, endAt, mt.timezone).catch(() => [] as number[])
    effectiveOperatorId = await pickOperatorForTeam(mt.teamId, { onlyUserIds: livres }).catch(() => null)
    if (!effectiveOperatorId && livres.length > 0) {
      // O rodízio olha presença/horário AGORA. Para uma reunião marcada de
      // madrugada ou para a semana que vem isso zeraria o pool e a reunião
      // ficaria órfã — havendo quem atenda NAQUELE horário, entrega ao de
      // menor carga em vez de mandar para a fila.
      const { leastLoadedAmong } = await import('./teamRouting.js')
      effectiveOperatorId = await leastLoadedAmong(livres).catch(() => null)
      if (effectiveOperatorId) {
        console.warn(`[scheduling] tipo ${mt.id}: ninguém presente agora; reunião de ${startAt.toISOString()} para o operador ${effectiveOperatorId} (livre no horário, menor carga)`)
      }
    }
    if (!effectiveOperatorId) {
      console.warn(`[scheduling] tipo ${mt.id}: nenhum operador livre em ${startAt.toISOString()} — reunião na fila da equipe ${mt.teamId}`)
    }
  }

  // Trava anti-corrida: entre validar o slot e gravar aqui, outro cliente pode
  // ter fechado o mesmo horário com o mesmo operador (a validação e a criação
  // não são atômicas). Reconfere antes de tocar em lead ou reserva e devolve o erro
  // normal de horário ocupado em vez de deixar dois clientes na mesma hora.
  if (effectiveOperatorId) {
    const conflito = await prisma.booking.findFirst({
      where: {
        operatorUserId: effectiveOperatorId,
        status: { notIn: ['cancelled', 'no_show', 'rescheduled'] },
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
      select: { id: true },
    })
    if (conflito) {
      console.warn(`[scheduling] corrida no slot ${startAt.toISOString()} (operador ${effectiveOperatorId}, reserva ${conflito.id} chegou antes)`)
      return { ok: false, error: 'Esse horário acabou de ser reservado. Escolha outro.' }
    }
  }

  // Dedup: linka lead existente por whatsapp/email; senão cria novo.
  let leadId: number | null = null
  const dup = await findDuplicate(whatsapp || undefined, email || undefined)
  if (dup?.lead?.id) {
    const lid = dup.lead.id
    leadId = lid
    // A reunião passa para o operador efetivo (dono fixo do tipo OU operador roteado
    // pela equipe). Mesmo que o lead já tenha outro responsável, ao agendar ele vai
    // para quem atende os agendamentos. No modo equipe, também vincula a equipe (mantém
    // o lead na fila dela quando ninguém está elegível no momento).
    const dupData: { assignedUserId?: number; assignedAt?: Date; teamId?: number; email?: string; whatsapp?: string; nome?: string } = {}
    if (effectiveOperatorId) { dupData.assignedUserId = effectiveOperatorId; dupData.assignedAt = new Date() }
    if (mt.assignmentMode === 'team_routing' && effectiveTeamId) dupData.teamId = effectiveTeamId
    // Backfill de contato: o agendamento sempre traz e-mail/telefone. Preenche o que estiver
    // faltando no lead (sem sobrescrever o que já existe), pra o e-mail aparecer no card e os
    // e-mails de convite/confirmação serem enviados (eles leem lead.email).
    const cur = await prisma.lead.findUnique({ where: { id: lid }, select: { email: true, whatsapp: true, nome: true } }).catch(() => null)
    if (email && !(cur?.email || '').trim()) dupData.email = email
    if (whatsapp && !(cur?.whatsapp || '').trim()) dupData.whatsapp = whatsapp
    if (input.name && !(cur?.nome || '').trim()) dupData.nome = String(input.name).trim()
    if (Object.keys(dupData).length) await prisma.lead.update({ where: { id: lid }, data: dupData }).catch(() => {})
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
        teamId: effectiveTeamId,
        assignedUserId: effectiveOperatorId ?? null,
        assignedAt: effectiveOperatorId ? new Date() : null,
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
      operatorUserId: effectiveOperatorId ?? null,
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
          // Agendar é o avanço mais forte que existe aqui: invalida sugestão
          // pendente que ainda descrevia o lead antes da visita marcada.
          const { supersedePendingSuggestions } = await import('./stageSuggestions.js')
          await supersedePendingSuggestions(leadId, 'lead_moved')
        }
      } catch { /* não bloqueia a reserva */ }
    }

    // Activity 'meeting' (timeline + agenda + sync Google Calendar/Meet).
    try {
      let ownerName: string | null = null
      if (effectiveOperatorId) {
        const u = await prisma.user.findUnique({ where: { id: effectiveOperatorId }, select: { name: true, email: true } })
        ownerName = u?.name || u?.email || null
      }
      const reminderAt = new Date(startAt.getTime() - 60 * 60000)
      const activity = await prisma.activity.create({
        data: {
          leadId,
          userId: effectiveOperatorId ?? null,
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

    // Evento de domínio (workflows escutam). Inclui o form de origem do lead (_formId)
    // p/ permitir filtrar notificações por formulário no agendamento.
    const leadForm = await prisma.lead.findUnique({ where: { id: leadId }, select: { formData: true } }).catch(() => null)
    const originFormId = (leadForm?.formData as any)?._formId ?? null
    // Nome do formulário junto do id: é o que permite um aviso único dizer de
    // onde veio ({{origem}} no template) em vez de um workflow por formulário.
    const originFormName = originFormId
      ? (await prisma.form.findUnique({ where: { id: Number(originFormId) }, select: { name: true } }).catch(() => null))?.name ?? null
      : null
    eventBus.emitDomain({
      type: 'meeting.scheduled',
      leadId,
      ...(mt.funnelId ? { funnelId: mt.funnelId } : {}),
      payload: {
        bookingId: booking.id, meetingTypeId: mt.id, startAt: booking.startAt.toISOString(),
        formId: originFormId,
        metadata: { formId: originFormId, formName: originFormName, meetingTypeName: mt.name },
      },
    } as any)
  }

  return { ok: true, booking: { id: booking.id, token: booking.token, startAt: booking.startAt.toISOString(), endAt: booking.endAt.toISOString(), status: booking.status } }
}
