// src/services/routing/workingHours.ts
// Lead Routing F2 — checagem TZ-aware de horário de trabalho.
//
// Decisões:
// - "HH:MM" comparado lexicograficamente — funciona porque é zero-padded 24h
//   e sempre comparamos strings do mesmo formato.
// - Janelas que cruzam meia-noite (ex: 22:00 → 02:00) são suportadas pelo
//   inversão: start > end ⇒ "está dentro" se now >= start OU now <= end.
// - Cache memoizado em memória (TTL curto) das listas por user/team. Em alto
//   volume isso evita uma query Prisma por lead inbound. Invalidado pelos
//   endpoints de PUT (chamam invalidateWorkingHoursCache).
//
// O cálculo de weekday/hora no fuso do agente usa Intl.DateTimeFormat — não
// precisamos de date-fns-tz pra um caso simples. Cada linha pode ter um TZ
// diferente (multi-cidade no futuro), então a checagem é por entrada.

import { prisma } from '../../lib/prisma.js'

interface WorkingHourEntry {
  weekday: number
  startTime: string
  endTime: string
  timezone: string
}

const CACHE_TTL_MS = 30_000
const _agentCache = new Map<number, { entries: WorkingHourEntry[]; expiresAt: number }>()
const _teamCache = new Map<number, { entries: WorkingHourEntry[]; expiresAt: number }>()

export function invalidateWorkingHoursCache(opts?: { userId?: number; teamId?: number }) {
  if (!opts) {
    _agentCache.clear()
    _teamCache.clear()
    return
  }
  if (opts.userId != null) _agentCache.delete(opts.userId)
  if (opts.teamId != null) _teamCache.delete(opts.teamId)
}

async function getAgentEntries(userId: number): Promise<WorkingHourEntry[]> {
  const cached = _agentCache.get(userId)
  if (cached && cached.expiresAt > Date.now()) return cached.entries
  const rows = await prisma.agentWorkingHour.findMany({
    where: { userId },
    select: { weekday: true, startTime: true, endTime: true, timezone: true },
  })
  _agentCache.set(userId, { entries: rows, expiresAt: Date.now() + CACHE_TTL_MS })
  return rows
}

async function getTeamEntries(teamId: number): Promise<WorkingHourEntry[]> {
  const cached = _teamCache.get(teamId)
  if (cached && cached.expiresAt > Date.now()) return cached.entries
  const rows = await prisma.teamWorkingHour.findMany({
    where: { teamId },
    select: { weekday: true, startTime: true, endTime: true, timezone: true },
  })
  _teamCache.set(teamId, { entries: rows, expiresAt: Date.now() + CACHE_TTL_MS })
  return rows
}

interface LocalNow {
  weekday: number   // 0..6 (domingo=0)
  hhmm: string      // "HH:MM"
}

function getLocalNow(now: Date, timezone: string): LocalNow {
  // Intl.DateTimeFormat com weekday curto não dá número direto; usamos
  // 'en-US' com hour/minute/weekday e mapeamos. Para weekday num, o jeito
  // mais robusto é construir Date com formatToParts e ler.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = fmt.formatToParts(now)
  let weekdayStr = 'Sun'
  let hour = '00'
  let minute = '00'
  for (const p of parts) {
    if (p.type === 'weekday') weekdayStr = p.value
    else if (p.type === 'hour') hour = p.value === '24' ? '00' : p.value
    else if (p.type === 'minute') minute = p.value
  }
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return { weekday: weekdayMap[weekdayStr] ?? 0, hhmm: `${hour}:${minute}` }
}

function entryMatchesNow(entry: WorkingHourEntry, now: Date): boolean {
  const { weekday: targetWeekday, hhmm } = getLocalNow(now, entry.timezone)
  if (entry.weekday !== targetWeekday) {
    // Janela cruzando meia-noite — se start > end e a janela do dia anterior
    // ainda está ativa, considera ontem como match.
    if (entry.startTime <= entry.endTime) return false
    const prevDay = (targetWeekday + 6) % 7
    if (entry.weekday !== prevDay) return false
    // estamos no dia seguinte, dentro do "rabo" da janela: hhmm <= endTime
    return hhmm <= entry.endTime
  }
  if (entry.startTime <= entry.endTime) {
    return hhmm >= entry.startTime && hhmm <= entry.endTime
  }
  // Janela cruzando meia-noite no MESMO weekday (ex: 22:00 → 23:59 só conta a 1ª parte)
  return hhmm >= entry.startTime
}

// True quando o agente está dentro do horário configurado.
// Se o agente NÃO tem nenhuma linha em AgentWorkingHour, considera-se 24/7
// (compat backward — só quem configurou tem restrição).
export async function isAgentWithinWorkingHours(userId: number, now: Date = new Date()): Promise<boolean> {
  const entries = await getAgentEntries(userId)
  if (entries.length === 0) return true
  return entries.some((e) => entryMatchesNow(e, now))
}

// True quando o setor está aberto. Caller deve verificar antes que
// Team.workingHoursEnabled = true. Sem linhas configuradas = aberto (mesmo
// princípio do agente).
export async function isTeamOpen(teamId: number, now: Date = new Date()): Promise<boolean> {
  const entries = await getTeamEntries(teamId)
  if (entries.length === 0) return true
  return entries.some((e) => entryMatchesNow(e, now))
}

// Versão batch — recebe userIds e retorna um Set com os que estão dentro.
// Útil pro picker filtrar a lista de candidatos em 1 ida ao cache.
export async function filterAgentsWithinWorkingHours(
  userIds: number[],
  now: Date = new Date(),
): Promise<Set<number>> {
  const allowed = new Set<number>()
  for (const id of userIds) {
    if (await isAgentWithinWorkingHours(id, now)) allowed.add(id)
  }
  return allowed
}
