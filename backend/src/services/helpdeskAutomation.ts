// src/services/helpdeskAutomation.ts
// Automação do Helpdesk (Fase 5): executor de ações compartilhado, engine de
// triggers (event-based) e cron de automations (time-based).

import { prisma } from '../lib/prisma.js'
import { logTicketEvent, createSurveyOnSolve, canTransition, TICKET_STATUSES, TICKET_PRIORITIES, TICKET_TYPES, TERMINAL_STATUSES, type TicketStatus } from './helpdesk.js'
import { applySlaToTicket, pauseSla, resumeSla, markFirstResponseSla } from './helpdeskSla.js'

const PAUSED_STATUSES = ['pending', 'on_hold']

export interface TicketActions {
  setStatus?: string
  setPriority?: string
  setType?: string
  assignUserId?: number | null
  teamId?: number | null
  addTagIds?: number[]
  reply?: { body: string; visibility?: 'public' | 'internal' }
}

export function renderTemplate(tpl: string, t: { number: number; subject: string; requesterName: string | null }): string {
  return (tpl || '')
    .replace(/\{\{\s*ticket\.number\s*\}\}/g, String(t.number))
    .replace(/\{\{\s*ticket\.subject\s*\}\}/g, t.subject || '')
    .replace(/\{\{\s*requester\.name\s*\}\}/g, t.requesterName || '')
}

/**
 * Executor único de ações sobre um ticket — usado por macros, triggers e
 * automations. Cuida das reações de SLA (recalcular/pausar/retomar) e do log.
 */
export async function applyTicketActions(ticketId: number, actions: TicketActions, op?: { userId?: number; userName?: string }): Promise<void> {
  const t = await prisma.helpdeskTicket.findUnique({ where: { id: ticketId } })
  if (!t) return
  const data: any = {}
  const events: Array<{ type: string; title: string }> = []

  if (actions.setPriority && TICKET_PRIORITIES.includes(actions.setPriority as any) && actions.setPriority !== t.priority) {
    data.priority = actions.setPriority
    events.push({ type: 'priority_changed', title: `Prioridade → ${actions.setPriority}` })
  }
  if (actions.setType && TICKET_TYPES.includes(actions.setType as any) && actions.setType !== t.type) {
    data.type = actions.setType
    events.push({ type: 'type_changed', title: `Tipo → ${actions.setType}` })
  }
  if ('assignUserId' in actions && (actions.assignUserId ?? null) !== t.assignedUserId) {
    data.assignedUserId = actions.assignUserId ?? null
    events.push({ type: 'assigned', title: data.assignedUserId ? `Atribuído (automação) a #${data.assignedUserId}` : 'Atribuição removida (automação)' })
  }
  if ('teamId' in actions && (actions.teamId ?? null) !== t.teamId) {
    data.teamId = actions.teamId ?? null
    events.push({ type: 'team_changed', title: data.teamId ? `Setor #${data.teamId} (automação)` : 'Setor removido (automação)' })
  }
  if (Array.isArray(actions.addTagIds) && actions.addTagIds.length) {
    const cur: number[] = Array.isArray(t.tags) ? (t.tags as number[]) : []
    const merged = Array.from(new Set([...cur, ...actions.addTagIds.map(Number)]))
    if (merged.length !== cur.length) {
      data.tags = merged
      events.push({ type: 'tags_changed', title: 'Tags atualizadas (automação)' })
    }
  }

  let statusChanged = false
  let oldStatus = t.status
  if (actions.setStatus && TICKET_STATUSES.includes(actions.setStatus as any) && actions.setStatus !== t.status && canTransition(t.status as TicketStatus, actions.setStatus as TicketStatus)) {
    const ns = actions.setStatus as TicketStatus
    data.status = ns
    statusChanged = true
    if (ns === 'solved' && !t.solvedAt) data.solvedAt = new Date()
    if (ns === 'closed' && !t.closedAt) data.closedAt = new Date()
    if (TERMINAL_STATUSES.includes(t.status as TicketStatus) && !TERMINAL_STATUSES.includes(ns)) { data.reopenCount = { increment: 1 }; data.solvedAt = null; data.closedAt = null }
    events.push({ type: 'status_changed', title: `Status: ${t.status} → ${ns} (automação)` })
  }

  // Resposta/nota
  let marksFirstResponse = false
  if (actions.reply?.body) {
    const visibility = actions.reply.visibility === 'internal' ? 'internal' : 'public'
    const body = renderTemplate(actions.reply.body, { number: t.number, subject: t.subject, requesterName: t.requesterName })
    await prisma.helpdeskComment.create({
      data: { ticketId, authorType: op?.userId ? 'agent' : 'system', authorUserId: op?.userId ?? null, authorName: op?.userName ?? 'Automação', visibility, channel: t.channel, body },
    })
    if (visibility === 'public' && !t.firstResponseAt) { data.firstResponseAt = new Date(); marksFirstResponse = true }
    if (visibility === 'public' && t.status === 'new' && !data.status) { data.status = 'open'; statusChanged = true; oldStatus = 'new' }
    events.push({ type: 'comment_added', title: visibility === 'internal' ? 'Nota interna (automação)' : 'Resposta (automação)' })
  }

  if (Object.keys(data).length === 0 && events.length === 0) return
  data.lastActivityAt = new Date()
  await prisma.helpdeskTicket.update({ where: { id: ticketId }, data })

  for (const ev of events) await logTicketEvent({ ticketId, type: ev.type, title: ev.title, userId: op?.userId, userName: op?.userName, actorType: op?.userId ? 'agent' : 'system' })

  // CSAT ao resolver via automação
  if (statusChanged && data.status === 'solved') await createSurveyOnSolve(ticketId)
  // Reações de SLA
  if (marksFirstResponse) await markFirstResponseSla(ticketId)
  if (data.priority) await applySlaToTicket(ticketId)
  else if (statusChanged && data.status) {
    const wasPaused = PAUSED_STATUSES.includes(oldStatus)
    const isPaused = PAUSED_STATUSES.includes(data.status)
    if (TERMINAL_STATUSES.includes(oldStatus as TicketStatus) && !TERMINAL_STATUSES.includes(data.status)) await applySlaToTicket(ticketId)
    else if (isPaused && !wasPaused) await pauseSla(ticketId)
    else if (wasPaused && !isPaused) await resumeSla(ticketId)
  }
}

// ─────────────── Triggers (event-based) ───────────────
interface TriggerConditions { priorities?: string[]; channels?: string[]; types?: string[]; statuses?: string[]; teamIds?: number[]; subjectContains?: string }

function matchTrigger(c: TriggerConditions, t: { priority: string; channel: string; type: string; status: string; teamId: number | null; subject: string }): boolean {
  if (c.priorities?.length && !c.priorities.includes(t.priority)) return false
  if (c.channels?.length && !c.channels.includes(t.channel)) return false
  if (c.types?.length && !c.types.includes(t.type)) return false
  if (c.statuses?.length && !c.statuses.includes(t.status)) return false
  if (c.teamIds?.length && (t.teamId == null || !c.teamIds.includes(t.teamId))) return false
  if (c.subjectContains && !t.subject.toLowerCase().includes(c.subjectContains.toLowerCase())) return false
  return true
}

/** Executa os triggers ativos de um evento cujas condições casam com o ticket. */
export async function runTriggers(event: 'created' | 'replied' | 'status_changed', ticketId: number): Promise<number> {
  const triggers = await prisma.helpdeskTrigger.findMany({ where: { active: true, event }, orderBy: { order: 'asc' } })
  if (!triggers.length) return 0
  let fired = 0
  for (const tr of triggers) {
    const t = await prisma.helpdeskTicket.findUnique({ where: { id: ticketId }, select: { priority: true, channel: true, type: true, status: true, teamId: true, subject: true } })
    if (!t) break
    if (!matchTrigger((tr.conditions as TriggerConditions) || {}, t)) continue
    await applyTicketActions(ticketId, (tr.actions as TicketActions) || {})
    await prisma.helpdeskTrigger.update({ where: { id: tr.id }, data: { runCount: { increment: 1 } } })
    await logTicketEvent({ ticketId, type: 'trigger_fired', title: `Trigger "${tr.name}" executado`, actorType: 'system' })
    fired++
  }
  return fired
}

// ─────────────── Automations (time-based / cron) ───────────────
interface AutomationConditions { statuses?: string[]; olderThanMins?: number; noFirstResponse?: boolean; channels?: string[] }

export async function runAutomations(): Promise<number> {
  const automations = await prisma.helpdeskAutomation.findMany({ where: { active: true } })
  if (!automations.length) return 0
  let applied = 0
  for (const au of automations) {
    const c = (au.conditions as AutomationConditions) || {}
    const where: any = { status: { notIn: ['closed'] } }
    if (c.statuses?.length) where.status = { in: c.statuses }
    if (c.channels?.length) where.channel = { in: c.channels }
    if (c.noFirstResponse) where.firstResponseAt = null
    if (c.olderThanMins && c.olderThanMins > 0) where.lastActivityAt = { lt: new Date(Date.now() - c.olderThanMins * 60_000) }

    const tickets = await prisma.helpdeskTicket.findMany({ where, select: { id: true }, take: 200 })
    for (const t of tickets) {
      await applyTicketActions(t.id, (au.actions as TicketActions) || {})
      await logTicketEvent({ ticketId: t.id, type: 'automation_fired', title: `Automação "${au.name}" aplicada`, actorType: 'system' })
      applied++
    }
    await prisma.helpdeskAutomation.update({ where: { id: au.id }, data: { runCount: { increment: tickets.length }, lastRunAt: new Date() } })
  }
  return applied
}

let _autoInterval: NodeJS.Timeout | null = null
export function startAutomationScheduler(): void {
  if (_autoInterval) return
  const tick = () => { runAutomations().catch((e) => console.error('[helpdesk-automation] falhou:', (e as Error).message)) }
  _autoInterval = setInterval(tick, 120_000) // a cada 2 min
  setTimeout(tick, 15_000)
}
