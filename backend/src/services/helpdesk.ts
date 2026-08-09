// src/services/helpdesk.ts
// Serviços de apoio do módulo Helpdesk (Fase 0).

import crypto from 'crypto'
import { prisma } from '../lib/prisma.js'

// Constantes de domínio (validação + UI). Mantidas aqui para servirem de
// fonte única ao backend; o frontend consome via GET /api/helpdesk/meta.
export const TICKET_STATUSES = ['new', 'open', 'pending', 'on_hold', 'solved', 'closed'] as const
export const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
export const TICKET_TYPES = ['question', 'incident', 'problem', 'task'] as const
export const TICKET_CHANNELS = ['email', 'web', 'whatsapp', 'chat', 'api', 'phone', 'manual'] as const

export type TicketStatus = (typeof TICKET_STATUSES)[number]
export type TicketPriority = (typeof TICKET_PRIORITIES)[number]

// Status considerados "terminais" (relógio de resolução parado).
export const TERMINAL_STATUSES: TicketStatus[] = ['solved', 'closed']

// Máquina de estados: transições permitidas a partir de cada status.
export const STATUS_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  new: ['open', 'pending', 'on_hold', 'solved', 'closed'],
  open: ['pending', 'on_hold', 'solved', 'closed'],
  pending: ['open', 'on_hold', 'solved', 'closed'],
  on_hold: ['open', 'pending', 'solved', 'closed'],
  solved: ['open', 'closed'], // reabrir ou fechar definitivamente
  closed: ['open'], // só reabertura
}

export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  if (from === to) return true
  return STATUS_TRANSITIONS[from]?.includes(to) ?? false
}

// URL pública de um anexo (servido por /uploads/*, já registrado em server.ts).
export function attachmentUrl(storagePath: string): string {
  const base = process.env.APP_URL || `http://localhost:${process.env.PORT || 3005}`
  return `${base}/uploads/${storagePath}`
}

/**
 * Próximo número de protocolo. `update ... increment` é atômico no InnoDB;
 * o @unique em HelpdeskTicket.number é a defesa final contra colisão.
 * Se a linha de sequência ainda não existir (primeiro ticket do tenant), cria
 * a partir de 1000 → primeiro protocolo = 1001.
 */
export async function nextTicketNumber(): Promise<number> {
  try {
    const row = await prisma.helpdeskSequence.update({
      where: { name: 'ticket' },
      data: { current: { increment: 1 } },
    })
    return row.current
  } catch {
    // Linha ainda não existe — cria de forma idempotente.
    try {
      const row = await prisma.helpdeskSequence.create({ data: { name: 'ticket', current: 1001 } })
      return row.current
    } catch {
      // Corrida na criação: alguém criou primeiro — agora o update funciona.
      const row = await prisma.helpdeskSequence.update({
        where: { name: 'ticket' },
        data: { current: { increment: 1 } },
      })
      return row.current
    }
  }
}

interface TicketEventInput {
  ticketId: number
  type: string
  title: string
  userId?: number | undefined
  userName?: string | undefined
  actorType?: string
  oldValue?: string | null
  newValue?: string | null
  metadata?: unknown
}

// Setor default de entrada (roteamento simples). Setting `helpdesk.default_team_id`.
export async function resolveDefaultTeamId(): Promise<number | null> {
  try {
    const s = await prisma.setting.findUnique({ where: { key: 'helpdesk.default_team_id' } })
    if (!s) return null
    const raw = s.value as any
    const n = Number(typeof raw === 'string' ? raw.replace(/"/g, '') : raw)
    if (!Number.isFinite(n) || n <= 0) return null
    const team = await prisma.team.findFirst({ where: { id: n, active: true }, select: { id: true } })
    return team?.id ?? null
  } catch {
    return null
  }
}

/** Resolve a organização (B2B) pelo domínio do e-mail do solicitante. */
export async function resolveOrganizationId(email?: string | null): Promise<number | null> {
  if (!email || !email.includes('@')) return null
  const domain = email.split('@')[1]?.toLowerCase().trim()
  if (!domain) return null
  try {
    const orgs = await prisma.helpdeskOrganization.findMany({ where: { active: true }, select: { id: true, domains: true } })
    for (const o of orgs) {
      const domains = (Array.isArray(o.domains) ? o.domains : []) as string[]
      if (domains.some((d) => String(d).toLowerCase().trim() === domain)) return o.id
    }
  } catch { /* tabela ausente em tenant não migrado */ }
  return null
}

export interface IntakeInput {
  subject: string
  description?: string | undefined
  channel: (typeof TICKET_CHANNELS)[number]
  priority?: TicketPriority | undefined
  type?: (typeof TICKET_TYPES)[number] | undefined
  requesterName?: string | undefined
  requesterEmail?: string | undefined
  requesterPhone?: string | undefined
  requesterLeadId?: number | undefined
  createdById?: number | undefined
  createdByName?: string | undefined
  // Quando true, a descrição entra como comentário do SOLICITANTE (canais externos);
  // quando false/omitido em canal interno, entra como comentário do agente.
  requesterAuthored?: boolean | undefined
  // Respostas dos campos personalizados (CustomField group=helpdesk) coletadas na abertura.
  customFields?: Record<string, unknown> | undefined
}

/**
 * Valida/normaliza respostas de campos personalizados contra o catálogo
 * (CustomField group=helpdesk). Mantém só chaves conhecidas, coage valores e
 * checa obrigatórios. `portalOnly` restringe ao subconjunto showInForm.
 * Retorna { values } ou { error } (mensagem amigável p/ HTTP 400).
 */
export async function sanitizeHelpdeskCustomFields(
  raw: unknown,
  portalOnly = false,
  partial = false,
): Promise<{ values: Record<string, unknown>; error?: string }> {
  const input = (raw && typeof raw === 'object') ? (raw as Record<string, unknown>) : {}
  const fields = await prisma.customField.findMany({
    where: { group: 'helpdesk', active: true, ...(portalOnly ? { showInForm: true } : {}) },
    select: { key: true, label: true, type: true, options: true, required: true },
  })
  const values: Record<string, unknown> = {}
  for (const f of fields) {
    // Edição parcial (PATCH): só processa as chaves enviadas; não exige obrigatórios ausentes.
    if (partial && !(f.key in input)) continue
    let v = input[f.key]
    const empty = v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0)
    if (empty) {
      if (f.required && !partial) return { values: {}, error: `O campo "${f.label}" é obrigatório.` }
      continue
    }
    if (f.type === 'number' || f.type === 'currency') {
      const n = Number(v)
      if (Number.isNaN(n)) return { values: {}, error: `O campo "${f.label}" deve ser numérico.` }
      v = n
    } else if (f.type === 'checkbox') {
      v = v === true || v === 'true' || v === 1 || v === '1'
    } else if (f.type === 'multiselect') {
      v = (Array.isArray(v) ? v : [v]).map((x) => String(x))
    } else {
      v = String(v).slice(0, 2000)
    }
    // valida opções de select/multiselect
    if ((f.type === 'select' || f.type === 'multiselect') && Array.isArray(f.options)) {
      const allowed = new Set((f.options as any[]).map((o) => String(o?.value ?? o)))
      const picks = Array.isArray(v) ? v : [v]
      for (const p of picks) {
        if (!allowed.has(String(p))) return { values: {}, error: `Valor inválido para "${f.label}".` }
      }
    }
    values[f.key] = v
  }
  return { values }
}

/**
 * Ponto único de ENTRADA de tickets (qualquer canal: email, web, api, whatsapp…).
 * Gera protocolo, aplica roteamento default, registra evento e cria o 1º comentário.
 */
export async function intakeTicket(input: IntakeInput) {
  const number = await nextTicketNumber()
  const teamId = await resolveDefaultTeamId()
  const organizationId = await resolveOrganizationId(input.requesterEmail)

  const ticket = await prisma.helpdeskTicket.create({
    data: {
      number,
      subject: input.subject.slice(0, 255),
      status: 'new',
      priority: input.priority || 'normal',
      type: input.type || 'question',
      channel: input.channel,
      teamId,
      organizationId,
      requesterLeadId: input.requesterLeadId ?? null,
      requesterName: input.requesterName ?? null,
      requesterEmail: input.requesterEmail ?? null,
      requesterPhone: input.requesterPhone ?? null,
      createdById: input.createdById ?? null,
      createdByName: input.createdByName ?? null,
      customFields: (input.customFields && Object.keys(input.customFields).length) ? (input.customFields as object) : undefined,
      lastActivityAt: new Date(),
    },
  })

  await logTicketEvent({
    ticketId: ticket.id,
    type: 'created',
    title: `Chamado #${number} aberto via ${input.channel}`,
    userId: input.createdById,
    userName: input.createdByName,
    actorType: input.createdById ? 'agent' : 'system',
  })

  const description = (input.description || '').trim()
  if (description) {
    const requesterAuthored = input.requesterAuthored ?? ['email', 'web', 'whatsapp', 'chat', 'api'].includes(input.channel)
    await prisma.helpdeskComment.create({
      data: {
        ticketId: ticket.id,
        authorType: requesterAuthored ? 'requester' : 'agent',
        authorUserId: requesterAuthored ? null : (input.createdById ?? null),
        authorName: requesterAuthored ? (input.requesterName || input.requesterEmail || 'Solicitante') : (input.createdByName ?? null),
        visibility: 'public',
        channel: input.channel,
        body: description,
      },
    })
  }

  // Aplica metas de SLA + triggers de criação (import dinâmico evita ciclos).
  try {
    const { applySlaToTicket } = await import('./helpdeskSla.js')
    await applySlaToTicket(ticket.id)
    const { runTriggers } = await import('./helpdeskAutomation.js')
    await runTriggers('created', ticket.id)
    const { routeTicket } = await import('./helpdeskRouting.js')
    await routeTicket(ticket.id) // auto-assign pelo roteamento do setor (F20)
    await emitHelpdeskWebhook('helpdesk.ticket.created', ticket.id)
  } catch (e) {
    console.error('[helpdesk] pós-ingestão (SLA/triggers/routing) falhou:', (e as Error).message)
  }

  return ticket
}

/**
 * Cria a pesquisa de satisfação (CSAT) ao resolver o ticket. Idempotente
 * (ticketId é unique). Registra o agente/equipe responsáveis no momento.
 * Retorna o token público da pesquisa (ou null se já existia/sem ação).
 */
export async function createSurveyOnSolve(ticketId: number): Promise<string | null> {
  try {
    const t = await prisma.helpdeskTicket.findUnique({ where: { id: ticketId }, select: { id: true, assignedUserId: true, teamId: true } })
    if (!t) return null
    const existing = await prisma.helpdeskSurvey.findUnique({ where: { ticketId }, select: { token: true } })
    if (existing) return existing.token
    const token = crypto.randomBytes(24).toString('hex')
    await prisma.helpdeskSurvey.create({ data: { ticketId, token, agentUserId: t.assignedUserId, teamId: t.teamId } })
    await logTicketEvent({ ticketId, type: 'survey_sent', title: 'Pesquisa de satisfação enviada', actorType: 'system' })
    return token
  } catch (e) {
    console.error('[helpdesk] createSurveyOnSolve falhou:', (e as Error).message)
    return null
  }
}

/** Emite um evento do helpdesk para os webhooks de saída (F13). Best-effort. */
export async function emitHelpdeskWebhook(eventType: string, ticketId: number, extra?: Record<string, any>): Promise<void> {
  try {
    const t = await prisma.helpdeskTicket.findUnique({ where: { id: ticketId }, select: { number: true, subject: true, status: true, priority: true, type: true, channel: true, requesterEmail: true, requesterName: true, organizationId: true, assignedUserId: true, teamId: true } })
    if (!t) return
    const { dispatchStandaloneEvent } = await import('./webhookDispatcher.js')
    await dispatchStandaloneEvent(eventType, { ticket: t, ...(extra || {}) })
  } catch (e) {
    console.error('[helpdesk] emit webhook falhou:', (e as Error).message)
  }
}

/** Grava um evento imutável na timeline do ticket. Best-effort (não quebra o fluxo). */
export async function logTicketEvent(e: TicketEventInput): Promise<void> {
  try {
    await prisma.helpdeskTicketEvent.create({
      data: {
        ticketId: e.ticketId,
        type: e.type,
        title: e.title,
        userId: e.userId ?? null,
        userName: e.userName ?? null,
        actorType: e.actorType ?? (e.userId ? 'agent' : 'system'),
        oldValue: e.oldValue ?? null,
        newValue: e.newValue ?? null,
        metadata: (e.metadata ?? undefined) as any,
      },
    })
  } catch (err) {
    console.error('[helpdesk] logTicketEvent falhou:', (err as Error).message)
  }
}

// ════════════════════ RELATÓRIOS (reusado por /reports e widgets) ════════════════════

export type HelpdeskReportRange = '7d' | '30d' | '90d'

/**
 * Período de um relatório a partir da query: `from`/`to` (YYYY-MM-DD, do
 * intervalo personalizado) têm precedência sobre o preset `range`. Datas
 * invertidas são corrigidas em vez de rejeitadas — o operador que digitou na
 * ordem errada vê o período que quis, não uma tela vazia.
 */
export function resolveHelpdeskPeriod(q: any): { range: string; from: Date; to: Date } {
  const range = ((q?.range ?? '30d') as unknown as string).toString()
  const days = range === '7d' ? 7 : range === '90d' ? 90 : 30
  const parse = (v: unknown, endOfDay: boolean): Date | null => {
    const s = typeof v === 'string' ? v.trim() : ''
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
    const d = new Date(`${s}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`)
    return Number.isNaN(d.getTime()) ? null : d
  }
  let from = parse(q?.from ?? q?.dateFrom, false)
  let to = parse(q?.to ?? q?.dateTo, true)
  if (from && to && from > to) { const swap = from; from = to; to = swap }
  const end = to ?? new Date()
  return { range, from: from ?? new Date(end.getTime() - days * 86_400_000), to: end }
}

/**
 * Calcula o relatório consolidado do helpdesk para um período. Fonte única
 * consumida tanto pela rota /api/admin/helpdesk/reports quanto pelos widgets
 * de dashboard (F24). Cap em 5000 tickets do período (flag `capped`).
 *
 * `explicit` (dateFrom/dateTo do seletor de período) tem precedência sobre o
 * preset: sem ele, um intervalo personalizado escolhido no painel era descartado
 * e o widget respondia sempre pelos últimos 30 dias.
 */
export async function computeHelpdeskReport(
  range: string,
  explicit?: { from?: Date | undefined; to?: Date | undefined },
) {
  const days = range === '7d' ? 7 : range === '90d' ? 90 : 30
  const to = explicit?.to ?? new Date()
  const since = explicit?.from ?? new Date(to.getTime() - days * 86_400_000)
  const period = { gte: since, lte: to }

  const REPORT_SELECT = { id: true, status: true, priority: true, channel: true, type: true, assignedUserId: true, createdAt: true, firstResponseAt: true, solvedAt: true, reopenCount: true, slaFirstResponseStatus: true, slaResolutionStatus: true }
  const [rows, backlog, solvedInRange, surveys] = await Promise.all([
    prisma.helpdeskTicket.findMany({ where: { createdAt: period }, select: REPORT_SELECT, take: 5000 }),
    // Backlog é estoque de agora (tickets ainda abertos), mas restrito aos que
    // entraram no período — senão o card não muda ao trocar o seletor.
    prisma.helpdeskTicket.count({ where: { status: { notIn: ['solved', 'closed'] }, createdAt: period } }),
    prisma.helpdeskTicket.count({ where: { solvedAt: period } }),
    prisma.helpdeskSurvey.findMany({ where: { sentAt: period, respondedAt: { not: null }, agentUserId: { not: null } }, select: { agentUserId: true, rating: true } }),
  ])

  const tally = (key: keyof typeof rows[0]) => {
    const m: Record<string, number> = {}
    for (const r of rows) { const v = String(r[key] ?? '—'); m[v] = (m[v] || 0) + 1 }
    return Object.entries(m).map(([k, count]) => ({ key: k, count })).sort((a, b) => b.count - a.count)
  }

  const frMet = rows.filter((r) => r.slaFirstResponseStatus === 'met').length
  const frBreached = rows.filter((r) => r.slaFirstResponseStatus === 'breached').length
  const resMet = rows.filter((r) => r.slaResolutionStatus === 'met').length
  const resBreached = rows.filter((r) => r.slaResolutionStatus === 'breached').length

  const frTimes = rows.filter((r) => r.firstResponseAt).map((r) => (r.firstResponseAt!.getTime() - r.createdAt.getTime()) / 60000)
  const resTimes = rows.filter((r) => r.solvedAt).map((r) => (r.solvedAt!.getTime() - r.createdAt.getTime()) / 60000)
  const avg = (a: number[]) => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null

  const agentMap = new Map<number, { assigned: number; solved: number; resTimes: number[]; reopened: number }>()
  for (const r of rows) {
    if (r.assignedUserId == null) continue
    const a = agentMap.get(r.assignedUserId) || { assigned: 0, solved: 0, resTimes: [], reopened: 0 }
    a.assigned++
    if (r.solvedAt) { a.solved++; a.resTimes.push((r.solvedAt.getTime() - r.createdAt.getTime()) / 60000) }
    a.reopened += r.reopenCount || 0
    agentMap.set(r.assignedUserId, a)
  }
  const csatByAgent = new Map<number, number[]>()
  for (const s of surveys) { const arr = csatByAgent.get(s.agentUserId!) || []; if (s.rating) arr.push(s.rating); csatByAgent.set(s.agentUserId!, arr) }
  const agentIds = [...agentMap.keys()]
  const users = agentIds.length ? await prisma.user.findMany({ where: { id: { in: agentIds } }, select: { id: true, name: true, email: true } }) : []
  const userMap = new Map(users.map((u) => [u.id, u.name || u.email]))
  const byAgent = agentIds.map((uid) => {
    const a = agentMap.get(uid)!
    const csat = csatByAgent.get(uid) || []
    return { agentUserId: uid, name: userMap.get(uid) || `#${uid}`, assigned: a.assigned, solved: a.solved, avgResolutionMins: avg(a.resTimes), reopened: a.reopened, csatAvg: csat.length ? Number((csat.reduce((x, y) => x + y, 0) / csat.length).toFixed(1)) : null }
  }).sort((x, y) => y.solved - x.solved)

  // Uma barra por dia do período escolhido (não mais "últimos N dias a partir de
  // hoje"): com intervalo personalizado antigo isso deixava o gráfico vazio.
  // Cap de 370 dias — acima disso o eixo vira ruído e a série pesa à toa.
  const dayKey = (d: Date) => d.toISOString().slice(0, 10)
  const trendMap = new Map<string, { created: number; solved: number }>()
  const spanDays = Math.min(370, Math.max(1, Math.round((to.getTime() - since.getTime()) / 86_400_000) + 1))
  for (let i = spanDays - 1; i >= 0; i--) trendMap.set(dayKey(new Date(to.getTime() - i * 86_400_000)), { created: 0, solved: 0 })
  for (const r of rows) { const k = dayKey(r.createdAt); const t = trendMap.get(k); if (t) t.created++ }
  for (const r of rows) { if (r.solvedAt) { const k = dayKey(r.solvedAt); const t = trendMap.get(k); if (t) t.solved++ } }
  const trend = [...trendMap.entries()].map(([date, v]) => ({ date, ...v }))

  return {
    range: range === '7d' || range === '90d' ? range : '30d',
    period: { from: dayKey(since), to: dayKey(to) },
    volume: { created: rows.length, solved: solvedInRange, backlog, reopened: rows.reduce((s, r) => s + (r.reopenCount || 0), 0), capped: rows.length >= 5000 },
    byStatus: tally('status'), byPriority: tally('priority'), byChannel: tally('channel'), byType: tally('type'),
    sla: { frMet, frBreached, frPct: frMet + frBreached ? Math.round((frMet / (frMet + frBreached)) * 100) : null, resMet, resBreached, resPct: resMet + resBreached ? Math.round((resMet / (resMet + resBreached)) * 100) : null },
    times: { avgFirstResponseMins: avg(frTimes), avgResolutionMins: avg(resTimes) },
    byAgent, trend,
  }
}
