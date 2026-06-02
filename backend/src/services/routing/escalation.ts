// src/services/routing/escalation.ts
// Lead Routing F8 — cron de escalação automática.
//
// 4 motivos de release (devolve lead pra fila → assignedUserId=null):
//   1. agent_on_vacation — agente entrou em ausência (AgentProfile.vacationUntil > now)
//   2. agent_inactive    — User.active=false OU AgentProfile.active=false OU role=VIEWER
//   3. agent_offline     — workStatus=offline há > 30min e Setting reassignOnOffline=true
//   4. no_response       — lead atribuído há > escalationMinutes sem Activity completed
//                          do operador desde assignedAt
//
// Para cada release:
//   - prisma.lead.update { assignedUserId: null, assignedAt: keepIfTeam ? now : null }
//   - reassignPendingCadenceActivities(leadId, null)
//   - logEvent EVENT_TYPES.AGENT_REASSIGNED_ESCALATION (com reason no metadata)
//
// Roda a cada 5min. Inerte enquanto Setting routing.escalation.enabled=false.

import { prisma } from '../../lib/prisma.js'
import { getEscalationConfig } from '../teamRouting.js'
import { reassignPendingCadenceActivities } from './helpers.js'
import { logEvent, EVENT_TYPES } from '../leadHistory.js'

const OFFLINE_THRESHOLD_MS = 30 * 60 * 1000   // 30min sem ficar online

type ReleaseReason = 'agent_on_vacation' | 'agent_inactive' | 'agent_offline' | 'no_response'

interface ReleaseCandidate {
  leadId: number
  assignedUserId: number
  teamId: number | null
  reason: ReleaseReason
  details?: Record<string, unknown>
}

async function releaseLead(c: ReleaseCandidate): Promise<void> {
  // Atualização atômica: só libera se ainda estiver atribuído ao mesmo user
  // (defensivo — cron concorrente / mudança humana entre query e update).
  const result = await prisma.lead.updateMany({
    where: { id: c.leadId, assignedUserId: c.assignedUserId },
    data: { assignedUserId: null, assignedAt: c.teamId ? new Date() : null },
  })
  if (result.count === 0) return

  const reassigned = await reassignPendingCadenceActivities(c.leadId, null)
  logEvent({
    leadId: c.leadId,
    type: EVENT_TYPES.AGENT_REASSIGNED_ESCALATION,
    category: 'operator',
    title: titleForReason(c.reason),
    actorType: 'system',
    metadata: {
      previousAssignedUserId: c.assignedUserId,
      reason: c.reason,
      reassignedCadenceActivities: reassigned,
      ...(c.details ?? {}),
    },
  })
}

function titleForReason(r: ReleaseReason): string {
  switch (r) {
    case 'agent_on_vacation': return 'Lead devolvido — agente em ausência'
    case 'agent_inactive': return 'Lead devolvido — agente inativo'
    case 'agent_offline': return 'Lead devolvido — agente offline'
    case 'no_response': return 'Lead devolvido — sem resposta'
  }
}

async function findInactiveAgentLeads(): Promise<ReleaseCandidate[]> {
  // Leads em aberto atribuídos a agentes que não deveriam estar recebendo.
  // Cobre 3 cenários: férias, profile pausado, user inativo OU role=VIEWER
  // (Reforma F1: substituiu o filtro isAgent=false legado).
  const now = new Date()
  const rows = await prisma.lead.findMany({
    where: {
      assignedUserId: { not: null },
      outcome: null,
      OR: [
        { assignedUser: { active: false } },
        { assignedUser: { role: 'VIEWER' } },
        { assignedUser: { agentProfile: { active: false } } },
        { assignedUser: { agentProfile: { vacationUntil: { gt: now } } } },
      ],
    },
    select: {
      id: true,
      assignedUserId: true,
      teamId: true,
      assignedUser: {
        select: {
          active: true,
          role: true,
          agentProfile: { select: { active: true, vacationUntil: true } },
        },
      },
    },
  })

  const out: ReleaseCandidate[] = []
  for (const r of rows) {
    if (!r.assignedUserId) continue
    const u = r.assignedUser
    if (!u) continue
    let reason: ReleaseReason
    if (u.agentProfile?.vacationUntil && u.agentProfile.vacationUntil > now) {
      reason = 'agent_on_vacation'
    } else {
      reason = 'agent_inactive'
    }
    out.push({ leadId: r.id, assignedUserId: r.assignedUserId, teamId: r.teamId, reason })
  }
  return out
}

async function findOfflineAgentLeads(): Promise<ReleaseCandidate[]> {
  const threshold = new Date(Date.now() - OFFLINE_THRESHOLD_MS)
  // Pega leads atribuídos a agentes offline cuja última atividade foi há > 30min.
  // workStatusUpdatedAt pode ser null em users antigos — exigimos preenchido.
  const rows = await prisma.lead.findMany({
    where: {
      assignedUserId: { not: null },
      outcome: null,
      assignedUser: {
        workStatus: 'offline',
        workStatusUpdatedAt: { lt: threshold },
      },
    },
    select: { id: true, assignedUserId: true, teamId: true },
  })
  return rows
    .filter((r) => r.assignedUserId != null)
    .map((r) => ({
      leadId: r.id,
      assignedUserId: r.assignedUserId as number,
      teamId: r.teamId,
      reason: 'agent_offline' as const,
    }))
}

async function findStaleLeads(minutes: number): Promise<ReleaseCandidate[]> {
  // Lead "encalhado": atribuído há > N min, ainda em aberto, sem nenhuma
  // Activity COMPLETED após assignedAt (operador efetivamente agiu).
  // Limitamos a 200 candidatos por ciclo pra não estourar runtime.
  const threshold = new Date(Date.now() - minutes * 60_000)
  const candidates = await prisma.lead.findMany({
    where: {
      assignedUserId: { not: null },
      outcome: null,
      assignedAt: { lt: threshold },
    },
    select: { id: true, assignedUserId: true, teamId: true, assignedAt: true },
    orderBy: { assignedAt: 'asc' },
    take: 200,
  })
  if (candidates.length === 0) return []

  // Para cada candidato, verifica se houve atividade completada pelo operador
  // após assignedAt. completedAt é o sinal de "operador fez algo concreto".
  const out: ReleaseCandidate[] = []
  for (const c of candidates) {
    if (!c.assignedUserId || !c.assignedAt) continue
    const completedSince = await prisma.activity.count({
      where: {
        leadId: c.id,
        status: 'completed',
        completedAt: { gte: c.assignedAt },
      },
    })
    if (completedSince === 0) {
      out.push({
        leadId: c.id,
        assignedUserId: c.assignedUserId,
        teamId: c.teamId,
        reason: 'no_response',
        details: { assignedAt: c.assignedAt.toISOString(), elapsedMinutes: minutes },
      })
    }
  }
  return out
}

interface RunResult {
  enabled: boolean
  vacation: number
  inactive: number
  offline: number
  noResponse: number
  total: number
}

export async function runEscalationCheck(): Promise<RunResult> {
  const config = await getEscalationConfig()
  if (!config.enabled) return { enabled: false, vacation: 0, inactive: 0, offline: 0, noResponse: 0, total: 0 }

  let vacation = 0
  let inactive = 0
  let offline = 0
  let noResponse = 0
  const seenLeadIds = new Set<number>()

  // 1+2. Férias e inativos (1 query cobrindo os dois).
  const inactiveCandidates = await findInactiveAgentLeads()
  for (const c of inactiveCandidates) {
    if (seenLeadIds.has(c.leadId)) continue
    seenLeadIds.add(c.leadId)
    await releaseLead(c)
    if (c.reason === 'agent_on_vacation') vacation++
    else inactive++
  }

  // 3. Offline (opt-in).
  if (config.reassignOnOffline) {
    const offlineCandidates = await findOfflineAgentLeads()
    for (const c of offlineCandidates) {
      if (seenLeadIds.has(c.leadId)) continue
      seenLeadIds.add(c.leadId)
      await releaseLead(c)
      offline++
    }
  }

  // 4. Sem resposta.
  const stale = await findStaleLeads(config.minutes)
  for (const c of stale) {
    if (seenLeadIds.has(c.leadId)) continue
    seenLeadIds.add(c.leadId)
    await releaseLead(c)
    noResponse++
  }

  const total = vacation + inactive + offline + noResponse
  if (total > 0) {
    console.log(
      `[routing/escalation] ${total} leads devolvidos — ` +
      `férias:${vacation} inativos:${inactive} offline:${offline} no_response:${noResponse}`,
    )
  }
  return { enabled: true, vacation, inactive, offline, noResponse, total }
}

const INTERVAL_MS = 5 * 60 * 1000  // 5min

let _intervalHandle: ReturnType<typeof setInterval> | null = null

export function startEscalationScheduler(): void {
  if (_intervalHandle) return
  console.log('[routing/escalation] scheduler iniciado (cada 5min)')
  // Não roda imediatamente pra dar tempo dos seeds completarem.
  _intervalHandle = setInterval(() => {
    runEscalationCheck().catch((e) => {
      console.error('[routing/escalation] erro no ciclo:', (e as any)?.message ?? e)
    })
  }, INTERVAL_MS)
}

export function stopEscalationScheduler(): void {
  if (_intervalHandle) {
    clearInterval(_intervalHandle)
    _intervalHandle = null
  }
}
