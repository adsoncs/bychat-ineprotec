// src/services/helpdeskRouting.ts
// Roteamento do Helpdesk (F20). Conecta a entrada de tickets ao motor de
// roteamento de leads do bychat (`pickOperatorForTeam`: round-robin / menor
// carga / aleatório, respeitando capacidade, horário e disponibilidade) —
// NÃO recria roteamento.

import { prisma } from '../lib/prisma.js'

async function autoAssignEnabled(): Promise<boolean> {
  try {
    const s = await prisma.setting.findUnique({ where: { key: 'helpdesk.auto_assign' } })
    if (!s) return true // default: ligado
    const v = s.value as any
    return v === true || String(v).replace(/"/g, '') === 'true'
  } catch {
    return true
  }
}

/**
 * Atribui automaticamente um operador ao ticket usando o modo de roteamento do
 * setor (`Team.routingMode`). Idempotente: só age em ticket sem dono e com setor.
 * Retorna o userId atribuído ou null.
 */
export async function routeTicket(ticketId: number): Promise<number | null> {
  if (!(await autoAssignEnabled())) return null
  const t = await prisma.helpdeskTicket.findUnique({ where: { id: ticketId }, select: { id: true, teamId: true, assignedUserId: true } })
  if (!t || t.assignedUserId != null || t.teamId == null) return null
  try {
    const { pickOperatorForTeam } = await import('./teamRouting.js')
    const uid = await pickOperatorForTeam(t.teamId)
    if (!uid) return null
    await prisma.helpdeskTicket.update({ where: { id: ticketId }, data: { assignedUserId: uid, lastActivityAt: new Date() } })
    const { logTicketEvent } = await import('./helpdesk.js')
    await logTicketEvent({ ticketId, type: 'assigned', title: `Atribuído automaticamente (roteamento do setor)`, actorType: 'system', newValue: String(uid) })
    const { notifyTicketAgent } = await import('./helpdeskNotify.js')
    await notifyTicketAgent(ticketId, 'assigned')
    return uid
  } catch (e) {
    console.error('[helpdesk-routing] routeTicket falhou:', (e as Error).message)
    return null
  }
}

/**
 * Varredura: atribui tickets que entraram sem dono em setores com roteamento
 * ativo (cobre quem entrou quando não havia agente disponível). A cada 2 min.
 */
export async function sweepUnassigned(): Promise<number> {
  if (!(await autoAssignEnabled())) return 0
  const since = new Date(Date.now() - 2 * 60_000)
  const routedTeams = await prisma.team.findMany({ where: { active: true, routingMode: { not: 'manual' } }, select: { id: true } })
  if (!routedTeams.length) return 0
  const tickets = await prisma.helpdeskTicket.findMany({
    where: { assignedUserId: null, teamId: { in: routedTeams.map((t) => t.id) }, status: { notIn: ['solved', 'closed'] }, createdAt: { lt: since } },
    select: { id: true }, take: 100,
  })
  let n = 0
  for (const t of tickets) { if (await routeTicket(t.id)) n++ }
  return n
}

let _interval: NodeJS.Timeout | null = null
export function startHelpdeskRoutingScheduler(): void {
  if (_interval) return
  const tick = () => { sweepUnassigned().catch((e) => console.error('[helpdesk-routing] sweep falhou:', (e as Error).message)) }
  _interval = setInterval(tick, 120_000)
  setTimeout(tick, 20_000)
}
