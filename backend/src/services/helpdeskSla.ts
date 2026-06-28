// src/services/helpdeskSla.ts
// Motor de SLA do Helpdesk (Fase 4): match de política, cálculo de metas com
// business hours, pausa/retomada e recomputação de status (ok/at_risk/breached).

import { prisma } from '../lib/prisma.js'
import { logTicketEvent, TERMINAL_STATUSES, type TicketStatus, type TicketPriority } from './helpdesk.js'

export type SlaStatus = 'pending' | 'met' | 'at_risk' | 'breached'

interface Window { start: string; end: string } // "HH:MM"
export interface Calendar {
  timezone: string
  weekdayHours: Record<string, Window[]> // "0".."6" (0=domingo)
  holidays: string[] // "YYYY-MM-DD"
}

interface PriorityMins { low?: number; normal?: number; high?: number; urgent?: number }
interface PolicyRow {
  id: number
  order: number
  conditions: { priorities?: string[]; channels?: string[]; types?: string[]; teamIds?: number[] }
  firstResponseMins: PriorityMins
  resolutionMins: PriorityMins
  nextResponseMins?: PriorityMins | null
  useBusinessHours: boolean
  calendarId: number | null
}

// ─────────────── Timezone helpers ───────────────
function tzOffsetMs(date: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  })
  const p: Record<string, string> = {}
  for (const part of dtf.formatToParts(date)) if (part.type !== 'literal') p[part.type] = part.value
  let hour = Number(p.hour)
  if (hour === 24) hour = 0
  const asUTC = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), hour, Number(p.minute), Number(p.second))
  return asUTC - date.getTime()
}

function getZonedParts(date: Date, tz: string): { year: number; month: number; day: number; minutesOfDay: number } {
  const off = tzOffsetMs(date, tz)
  const local = new Date(date.getTime() + off)
  return {
    year: local.getUTCFullYear(), month: local.getUTCMonth() + 1, day: local.getUTCDate(),
    minutesOfDay: local.getUTCHours() * 60 + local.getUTCMinutes(),
  }
}

function zonedToUtc(year: number, month: number, day: number, minutesOfDay: number, tz: string): Date {
  const h = Math.floor(minutesOfDay / 60), mi = minutesOfDay % 60
  const naive = Date.UTC(year, month - 1, day, h, mi)
  const off = tzOffsetMs(new Date(naive), tz)
  return new Date(naive - off)
}

function pad(n: number): string { return n < 10 ? `0${n}` : String(n) }
function toMin(hhmm: string): number { const [h, m] = hhmm.split(':').map(Number); return (h || 0) * 60 + (m || 0) }
function weekdayOf(year: number, month: number, day: number): number { return new Date(Date.UTC(year, month - 1, day)).getUTCDay() }
function nextDay(year: number, month: number, day: number): { year: number; month: number; day: number } {
  const d = new Date(Date.UTC(year, month - 1, day + 1))
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }
}

/** Avança `minutes` minutos ÚTEIS a partir de `start`, respeitando o calendário. */
export function addBusinessMinutes(start: Date, minutes: number, cal: Calendar): Date {
  if (minutes <= 0) return start
  let remaining = minutes
  const z = getZonedParts(start, cal.timezone)
  let { year, month, day } = z
  let curMin = z.minutesOfDay

  for (let guard = 0; guard < 3660; guard++) {
    const dateStr = `${year}-${pad(month)}-${pad(day)}`
    const windows = cal.holidays.includes(dateStr) ? [] : (cal.weekdayHours[String(weekdayOf(year, month, day))] || [])
    for (const w of windows) {
      const ws = toMin(w.start), we = toMin(w.end)
      if (curMin >= we) continue
      const effStart = Math.max(curMin, ws)
      if (effStart >= we) continue
      const avail = we - effStart
      if (remaining <= avail) return zonedToUtc(year, month, day, effStart + remaining, cal.timezone)
      remaining -= avail
      curMin = we
    }
    ;({ year, month, day } = nextDay(year, month, day))
    curMin = 0
  }
  return new Date(start.getTime() + minutes * 60_000) // fallback 24/7
}

// ─────────────── Match de política + cálculo ───────────────
function conditionsMatch(p: PolicyRow, t: { priority: string; channel: string; type: string; teamId: number | null }): boolean {
  const c = p.conditions || {}
  if (c.priorities?.length && !c.priorities.includes(t.priority)) return false
  if (c.channels?.length && !c.channels.includes(t.channel)) return false
  if (c.types?.length && !c.types.includes(t.type)) return false
  if (c.teamIds?.length && (t.teamId == null || !c.teamIds.includes(t.teamId))) return false
  return true
}

async function loadCalendar(id: number | null): Promise<Calendar | null> {
  if (id == null) return null
  const row = await prisma.helpdeskBusinessCalendar.findUnique({ where: { id } })
  if (!row) return null
  return {
    timezone: row.timezone,
    weekdayHours: (row.weekdayHours as any) || {},
    holidays: (row.holidays as any) || [],
  }
}

/**
 * (Re)calcula e grava as metas de SLA de um ticket. Chamado na ingestão, na
 * mudança de prioridade e na reabertura. Sem política aplicável → limpa o SLA.
 */
export async function applySlaToTicket(ticketId: number): Promise<void> {
  const t = await prisma.helpdeskTicket.findUnique({ where: { id: ticketId } })
  if (!t) return
  if (TERMINAL_STATUSES.includes(t.status as TicketStatus)) return

  const policies = await prisma.helpdeskSlaPolicy.findMany({ where: { active: true }, orderBy: { order: 'asc' } }) as unknown as PolicyRow[]
  // F9: organização pode forçar uma política de SLA (override do match por condições).
  let policy: PolicyRow | undefined
  if (t.organizationId) {
    const org = await prisma.helpdeskOrganization.findUnique({ where: { id: t.organizationId }, select: { slaPolicyId: true } })
    if (org?.slaPolicyId) policy = policies.find((p) => p.id === org.slaPolicyId)
  }
  if (!policy) policy = policies.find((p) => conditionsMatch(p, { priority: t.priority, channel: t.channel, type: t.type, teamId: t.teamId }))
  if (!policy) {
    await prisma.helpdeskTicket.update({ where: { id: ticketId }, data: { slaPolicyId: null, targetFirstResponseAt: null, targetResolutionAt: null, slaFirstResponseStatus: null, slaResolutionStatus: null } })
    return
  }

  const prio = t.priority as TicketPriority
  const frMin = policy.firstResponseMins?.[prio]
  const resMin = policy.resolutionMins?.[prio]
  const cal = policy.useBusinessHours ? await loadCalendar(policy.calendarId) : null
  const base = t.createdAt

  const calc = (mins: number | undefined): Date | null => {
    if (mins == null || mins <= 0) return null
    return cal ? addBusinessMinutes(base, mins, cal) : new Date(base.getTime() + mins * 60_000)
  }

  const data: any = {
    slaPolicyId: policy.id,
    targetFirstResponseAt: t.firstResponseAt ? t.targetFirstResponseAt : calc(frMin),
    targetResolutionAt: calc(resMin),
    slaFirstResponseStatus: t.firstResponseAt ? (t.slaFirstResponseStatus || 'met') : 'pending',
    slaResolutionStatus: 'pending',
  }
  await prisma.helpdeskTicket.update({ where: { id: ticketId }, data })
}

/** Pausa o relógio de resolução (status pending/on_hold). Idempotente. */
export async function pauseSla(ticketId: number): Promise<void> {
  const t = await prisma.helpdeskTicket.findUnique({ where: { id: ticketId }, select: { slaPausedAt: true } })
  if (!t || t.slaPausedAt) return
  await prisma.helpdeskTicket.update({ where: { id: ticketId }, data: { slaPausedAt: new Date() } })
}

/** Retoma o relógio: acumula o tempo pausado e empurra a meta de resolução. */
export async function resumeSla(ticketId: number): Promise<void> {
  const t = await prisma.helpdeskTicket.findUnique({ where: { id: ticketId }, select: { slaPausedAt: true, slaPausedMs: true, targetResolutionAt: true } })
  if (!t || !t.slaPausedAt) return
  const pausedMs = Date.now() - t.slaPausedAt.getTime()
  await prisma.helpdeskTicket.update({
    where: { id: ticketId },
    data: {
      slaPausedAt: null,
      slaPausedMs: (t.slaPausedMs || 0) + pausedMs,
      targetResolutionAt: t.targetResolutionAt ? new Date(t.targetResolutionAt.getTime() + pausedMs) : null,
    },
  })
}

/** Marca a meta de 1ª resposta como cumprida (met) ou estourada (breached). */
export async function markFirstResponseSla(ticketId: number): Promise<void> {
  const t = await prisma.helpdeskTicket.findUnique({ where: { id: ticketId }, select: { targetFirstResponseAt: true } })
  if (!t) return
  const breached = t.targetFirstResponseAt ? Date.now() > t.targetFirstResponseAt.getTime() : false
  await prisma.helpdeskTicket.update({ where: { id: ticketId }, data: { slaFirstResponseStatus: breached ? 'breached' : 'met' } })
}

/**
 * F27 — ARMA o relógio de PRÓXIMA resposta: chamado quando o CLIENTE responde.
 * Define o alvo a partir de AGORA usando a política vigente (nextResponseMins),
 * respeitando horário comercial. Reseta a cada resposta do cliente.
 */
export async function armNextResponseSla(ticketId: number): Promise<void> {
  const t = await prisma.helpdeskTicket.findUnique({ where: { id: ticketId }, select: { priority: true, status: true, slaPolicyId: true } })
  if (!t || TERMINAL_STATUSES.includes(t.status as TicketStatus)) return
  if (!t.slaPolicyId) return
  const policy = await prisma.helpdeskSlaPolicy.findUnique({ where: { id: t.slaPolicyId } }) as unknown as PolicyRow | null
  const mins = policy?.nextResponseMins?.[t.priority as TicketPriority]
  if (!policy || mins == null || mins <= 0) return
  const cal = policy.useBusinessHours ? await loadCalendar(policy.calendarId) : null
  const now = new Date()
  const target = cal ? addBusinessMinutes(now, mins, cal) : new Date(now.getTime() + mins * 60_000)
  await prisma.helpdeskTicket.update({ where: { id: ticketId }, data: { targetNextResponseAt: target, slaNextResponseStatus: 'pending' } })
}

/**
 * F27 — PARA o relógio de próxima resposta: chamado quando o AGENTE responde
 * publicamente. Marca met/breached e zera o alvo.
 */
export async function clearNextResponseSla(ticketId: number): Promise<void> {
  const t = await prisma.helpdeskTicket.findUnique({ where: { id: ticketId }, select: { targetNextResponseAt: true } })
  if (!t || !t.targetNextResponseAt) return
  const breached = Date.now() > t.targetNextResponseAt.getTime()
  await prisma.helpdeskTicket.update({ where: { id: ticketId }, data: { slaNextResponseStatus: breached ? 'breached' : 'met', targetNextResponseAt: null } })
}

/** Status a partir de um alvo: pending → at_risk (≤20% ou ≤15min) → breached. */
function statusFor(target: Date | null, base: Date, now: number): SlaStatus {
  if (!target) return 'pending'
  const t = target.getTime()
  if (now > t) return 'breached'
  const total = t - base.getTime()
  const atRiskWindow = Math.max(15 * 60_000, total * 0.2)
  return t - now <= atRiskWindow ? 'at_risk' : 'pending'
}

/**
 * Varredura periódica: recomputa status de SLA dos tickets ativos e registra
 * evento `sla_breached` na primeira vez que estoura. Retorna nº de updates.
 */
export async function sweepSla(): Promise<number> {
  const now = Date.now()
  const tickets = await prisma.helpdeskTicket.findMany({
    where: { status: { notIn: ['solved', 'closed'] }, OR: [{ targetFirstResponseAt: { not: null } }, { targetResolutionAt: { not: null } }, { targetNextResponseAt: { not: null } }] },
    select: { id: true, createdAt: true, firstResponseAt: true, slaPausedAt: true, targetFirstResponseAt: true, targetResolutionAt: true, targetNextResponseAt: true, slaFirstResponseStatus: true, slaResolutionStatus: true, slaNextResponseStatus: true, slaBreachNotifiedAt: true },
  })
  let updates = 0
  for (const t of tickets) {
    const data: any = {}
    // 1ª resposta (não pausa)
    if (!t.firstResponseAt && t.targetFirstResponseAt) {
      const ns = statusFor(t.targetFirstResponseAt, t.createdAt, now)
      if (ns !== t.slaFirstResponseStatus) data.slaFirstResponseStatus = ns
    }
    // Resolução (pausada não avança)
    if (!t.slaPausedAt && t.targetResolutionAt) {
      const ns = statusFor(t.targetResolutionAt, t.createdAt, now)
      if (ns !== t.slaResolutionStatus) data.slaResolutionStatus = ns
    }
    // F27 — Próxima resposta (relógio armado quando o cliente respondeu)
    if (t.targetNextResponseAt) {
      const ns = statusFor(t.targetNextResponseAt, t.createdAt, now)
      if (ns !== t.slaNextResponseStatus) data.slaNextResponseStatus = ns
    }
    const breachedNow = data.slaFirstResponseStatus === 'breached' || data.slaResolutionStatus === 'breached' || data.slaNextResponseStatus === 'breached'
    const atRiskNow = data.slaFirstResponseStatus === 'at_risk' || data.slaResolutionStatus === 'at_risk' || data.slaNextResponseStatus === 'at_risk'
    let notify: 'sla_breached' | 'sla_at_risk' | null = null
    if (breachedNow && !t.slaBreachNotifiedAt) {
      data.slaBreachNotifiedAt = new Date()
      await logTicketEvent({ ticketId: t.id, type: 'sla_breached', title: 'SLA estourado', actorType: 'system' })
      notify = 'sla_breached'
    } else if (atRiskNow) {
      notify = 'sla_at_risk'
    }
    if (Object.keys(data).length) {
      await prisma.helpdeskTicket.update({ where: { id: t.id }, data })
      updates++
    }
    if (notify) {
      try { const { notifyTicketAgent } = await import('./helpdeskNotify.js'); await notifyTicketAgent(t.id, notify) } catch { /* best-effort */ }
    }
  }
  return updates
}

let _slaInterval: NodeJS.Timeout | null = null
export function startSlaScheduler(): void {
  if (_slaInterval) return
  const tick = () => { sweepSla().catch((e) => console.error('[helpdesk-sla] sweep falhou:', (e as Error).message)) }
  _slaInterval = setInterval(tick, 60_000)
  setTimeout(tick, 8_000) // primeira passada logo após boot
}
