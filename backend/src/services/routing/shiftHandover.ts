// src/services/routing/shiftHandover.ts
// Reforma F5 — hand-off automático ao fim do turno do agente.
//
// Detecta agentes cujo AgentWorkingHour terminou há > toleranceMinutes
// (no fuso de cada linha) e devolve à fila os leads ainda atribuídos.
//
// Reuso intencional: a checagem de "agente está fora do horário" já existe em
// isAgentWithinWorkingHours (workingHours.ts). Não usamos diretamente porque
// precisamos do detalhe "fim do turno há quanto tempo" — usamos query SQL
// nas entries.
//
// Setting routing.shift.enabled controla se roda. Default OFF.

import { prisma } from '../../lib/prisma.js'
import { logEvent, EVENT_TYPES } from '../leadHistory.js'
import { getShiftConfig } from '../teamRouting.js'
import { reassignPendingCadenceActivities } from './helpers.js'

const INTERVAL_MS = 10 * 60 * 1000  // 10min

let _handle: ReturnType<typeof setInterval> | null = null

// Para cada linha AgentWorkingHour, calcula o momento da última transição
// "dentro→fora" no fuso configurado. Se foi há mais que tolerance, agente
// está em "pós-turno" e seus leads são liberados.
//
// Implementação prática: percorre agentes com leads abertos atribuídos;
// se NENHUMA entry diz que ele está dentro agora E pelo menos uma terminou
// nos últimos 24h, considera "saiu do turno".
async function findHandoverCandidates(toleranceMinutes: number): Promise<Array<{ userId: number; leadIds: number[] }>> {
  const now = new Date()
  const toleranceMs = toleranceMinutes * 60_000

  // 1. Agentes com pelo menos 1 lead aberto + horário configurado
  const agents = await prisma.user.findMany({
    where: {
      active: true,
      role: { not: 'VIEWER' },
      assignedLeads: { some: { outcome: null } },
      workingHours: { some: {} },
    },
    select: {
      id: true,
      workingHours: { select: { weekday: true, startTime: true, endTime: true, timezone: true } },
      assignedLeads: {
        where: { outcome: null },
        select: { id: true },
      },
    },
  })
  if (agents.length === 0) return []

  const out: Array<{ userId: number; leadIds: number[] }> = []
  for (const agent of agents) {
    if (agent.workingHours.length === 0) continue

    // Avalia cada entry pra ver se está fora do horário "há mais que tolerance".
    // Para isso: calcula o "minuto agora" no fuso da entry e verifica se entry
    // já passou do endTime há > toleranceMs (mesmo dia da semana).
    const stillIn = agent.workingHours.some((e) => entryStillInside(e, now))
    if (stillIn) continue   // ainda em turno → pula

    // Saiu há quanto tempo? Olha pra última entry do dia (ou anterior).
    const minutesSinceShiftEnd = minutesSinceLastShiftEnd(agent.workingHours, now)
    if (minutesSinceShiftEnd === null) continue  // sem dado pra calcular
    if (minutesSinceShiftEnd < toleranceMinutes) continue

    out.push({ userId: agent.id, leadIds: agent.assignedLeads.map((l) => l.id) })
    void toleranceMs  // referenciado pra silenciar lint se não usado direto
  }
  return out
}

interface WHEntry {
  weekday: number
  startTime: string
  endTime: string
  timezone: string
}

function getLocalParts(now: Date, timezone: string): { weekday: number; hhmm: string; minutes: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  })
  const parts = fmt.formatToParts(now)
  let weekdayStr = 'Sun', hour = '00', minute = '00'
  for (const p of parts) {
    if (p.type === 'weekday') weekdayStr = p.value
    else if (p.type === 'hour') hour = p.value === '24' ? '00' : p.value
    else if (p.type === 'minute') minute = p.value
  }
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  const w = weekdayMap[weekdayStr] ?? 0
  const hh = parseInt(hour)
  const mm = parseInt(minute)
  return { weekday: w, hhmm: `${hour}:${minute}`, minutes: hh * 60 + mm }
}

function entryStillInside(e: WHEntry, now: Date): boolean {
  const { weekday, hhmm } = getLocalParts(now, e.timezone)
  if (e.weekday !== weekday) {
    // janela cruzando meia-noite (start > end): conta o "rabo" no dia seguinte
    if (e.startTime <= e.endTime) return false
    const prev = (weekday + 6) % 7
    if (e.weekday !== prev) return false
    return hhmm <= e.endTime
  }
  if (e.startTime <= e.endTime) return hhmm >= e.startTime && hhmm <= e.endTime
  return hhmm >= e.startTime  // 22:00→02:00 no mesmo weekday cobre só 22..23:59
}

// Quantos minutos passaram desde o ÚLTIMO endTime relevante? Olha o weekday atual
// e o anterior. Retorna null se nenhum endTime se aplica.
function minutesSinceLastShiftEnd(entries: WHEntry[], now: Date): number | null {
  let best: number | null = null
  for (const e of entries) {
    const { weekday, minutes } = getLocalParts(now, e.timezone)
    const [eh, em] = e.endTime.split(':').map((n) => parseInt(n)) as [number, number]
    const endMinutesInDay = eh * 60 + em

    if (e.weekday === weekday) {
      // mesmo dia: se já passou do end, mede a diferença
      if (minutes >= endMinutesInDay) {
        const delta = minutes - endMinutesInDay
        if (best === null || delta < best) best = delta
      }
    } else if (e.weekday === ((weekday + 6) % 7)) {
      // dia anterior: já passou do end definitivamente
      const minutesSinceMidnight = minutes
      const delta = minutesSinceMidnight + (24 * 60 - endMinutesInDay)
      if (best === null || delta < best) best = delta
    }
  }
  return best
}

async function releaseLead(leadId: number, oldUserId: number): Promise<boolean> {
  const result = await prisma.lead.updateMany({
    where: { id: leadId, assignedUserId: oldUserId },
    data: { assignedUserId: null },
  })
  if (result.count === 0) return false
  const reassigned = await reassignPendingCadenceActivities(leadId, null)
  logEvent({
    leadId,
    type: EVENT_TYPES.SHIFT_HANDOVER,
    category: 'operator',
    title: 'Lead liberado — agente saiu do turno',
    actorType: 'system',
    metadata: { previousAssignedUserId: oldUserId, reassignedCadenceActivities: reassigned },
  })
  return true
}

export async function runShiftHandover(): Promise<{ enabled: boolean; released: number }> {
  const cfg = await getShiftConfig()
  if (!cfg.enabled) return { enabled: false, released: 0 }

  const candidates = await findHandoverCandidates(cfg.toleranceMinutes)
  let released = 0
  for (const c of candidates) {
    for (const leadId of c.leadIds) {
      const ok = await releaseLead(leadId, c.userId)
      if (ok) released++
    }
  }
  if (released > 0) {
    console.log(`[routing/shiftHandover] ${released} leads liberados em ${candidates.length} agentes`)
  }
  return { enabled: true, released }
}

export function startShiftHandoverScheduler(): void {
  if (_handle) return
  console.log('[routing/shiftHandover] scheduler iniciado (cada 10min)')
  _handle = setInterval(() => {
    runShiftHandover().catch((e) => {
      console.error('[routing/shiftHandover] erro:', (e as any)?.message ?? e)
    })
  }, INTERVAL_MS)
}

export function stopShiftHandoverScheduler(): void {
  if (_handle) { clearInterval(_handle); _handle = null }
}
