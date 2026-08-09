// src/routes/helpdesk.ts
// Módulo Helpdesk / Chamados — Fase 0 (núcleo).
// CRUD de tickets + thread de comentários (público/interno) + timeline.
// Gating de permissão é feito pelo modulePermissionHook (routePrefixes em moduleRegistry).

import { FastifyInstance } from 'fastify'
import { promises as fs } from 'fs'
import { join, extname } from 'path'
import crypto from 'crypto'
import { prisma } from '../lib/prisma.js'
import { redis } from '../lib/redis.js'
import { authMiddleware } from '../lib/auth.js'
import { requireApiKey } from '../lib/apiKey.js'
import { resolvePermissions } from '../lib/permissions.js'
import { parseExport, runImport, importCounts, fetchRemote } from '../services/helpdeskImport.js'
import { listSideConversations, createSideConversation, sendSideMessage, addInboundSideMessage, closeSideConversation } from '../services/helpdeskSideConversation.js'
import { getOperator } from '../services/leadHistory.js'

/**
 * Agente pode EDITAR o chamado? (canEdit no módulo helpdesk; SUPERADMIN sempre).
 * Quem tem só "Ver" é colaborador (F25): nota interna + seguir, sem editar.
 */
async function helpdeskCanEdit(req: any): Promise<boolean> {
  const user = req.user
  if (!user) return false
  if (user.role === 'SUPERADMIN') return true
  try {
    const perms = await resolvePermissions(user.userId, user.role)
    return !!perms['helpdesk']?.canEdit
  } catch { return false }
}
import {
  nextTicketNumber,
  logTicketEvent,
  intakeTicket,
  createSurveyOnSolve,
  resolveOrganizationId,
  resolveDefaultTeamId,
  sanitizeHelpdeskCustomFields,
  computeHelpdeskReport,
  resolveHelpdeskPeriod,
  emitHelpdeskWebhook,
  canTransition,
  attachmentUrl,
  TICKET_STATUSES,
  TICKET_PRIORITIES,
  TICKET_TYPES,
  TICKET_CHANNELS,
  TERMINAL_STATUSES,
  type TicketStatus,
} from '../services/helpdesk.js'
import { applySlaToTicket, pauseSla, resumeSla, markFirstResponseSla, clearNextResponseSla, armNextResponseSla } from '../services/helpdeskSla.js'
import { runTriggers, applyTicketActions, renderTemplate } from '../services/helpdeskAutomation.js'
import { aiConfigured, aiTriage, aiSuggestReply, aiSummarize, aiSuggestMacro, aiRewrite, aiQaTicket } from '../services/helpdeskAi.js'
import { isConversationBacked, sendTicketChannelReply, sendTicketEmailReply, getTicketConversation, getTicketCalls, startTicketCall } from '../services/helpdeskChannel.js'
import { notifyTicketAgent } from '../services/helpdeskNotify.js'

const PAUSED_STATUSES = ['pending', 'on_hold']

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024 // 25MB

function sanitizeExt(name: string): string {
  const raw = (extname(name).slice(1) || 'bin').toLowerCase()
  return raw.replace(/[^a-z0-9]/g, '').slice(0, 10) || 'bin'
}

const LINK_TYPES = ['related', 'duplicate', 'blocks', 'blocked_by', 'parent', 'child', 'problem', 'incident', 'follow_up', 'merged']
const INVERSE_LINK: Record<string, string> = {
  related: 'related', duplicate: 'duplicate',
  blocks: 'blocked_by', blocked_by: 'blocks',
  parent: 'child', child: 'parent',
  problem: 'incident', incident: 'problem',
  follow_up: 'follow_up_of', merged: 'merged_from',
}
function inverseLinkType(t: string): string { return INVERSE_LINK[t] || t }

async function getTicketLinks(ticketId: number) {
  const [direct, inverse] = await Promise.all([
    prisma.helpdeskTicketLink.findMany({ where: { ticketId } }),
    prisma.helpdeskTicketLink.findMany({ where: { linkedTicketId: ticketId } }),
  ])
  const otherIds = Array.from(new Set([...direct.map((l) => l.linkedTicketId), ...inverse.map((l) => l.ticketId)]))
  const others = otherIds.length ? await prisma.helpdeskTicket.findMany({ where: { id: { in: otherIds } }, select: { id: true, number: true, subject: true, status: true } }) : []
  const map = new Map(others.map((o) => [o.id, o]))
  const out: any[] = []
  for (const l of direct) { const o = map.get(l.linkedTicketId); if (o) out.push({ id: l.id, type: l.type, number: o.number, subject: o.subject, status: o.status }) }
  for (const l of inverse) { const o = map.get(l.ticketId); if (o) out.push({ id: l.id, type: inverseLinkType(l.type), number: o.number, subject: o.subject, status: o.status }) }
  return out
}

function serializeAttachment(a: {
  id: number; ticketId: number; commentId: number | null; fileName: string; fileSize: number;
  mimeType: string; storagePath: string; uploadedById: number | null; uploadedByName: string | null; createdAt: Date;
}) {
  return {
    id: a.id, ticketId: a.ticketId, commentId: a.commentId, fileName: a.fileName,
    fileSize: a.fileSize, mimeType: a.mimeType, url: attachmentUrl(a.storagePath),
    uploadedById: a.uploadedById, uploadedByName: a.uploadedByName, createdAt: a.createdAt,
  }
}

const TICKET_LIST_SELECT = {
  id: true, number: true, subject: true, status: true, priority: true, type: true,
  channel: true, assignedUserId: true, teamId: true, requesterLeadId: true,
  requesterName: true, requesterEmail: true, requesterPhone: true,
  firstResponseAt: true, solvedAt: true, closedAt: true, reopenCount: true,
  lastActivityAt: true, createdAt: true, updatedAt: true,
  slaResolutionStatus: true, targetResolutionAt: true,
  slaFirstResponseStatus: true, targetFirstResponseAt: true,
  organizationId: true, isSpam: true,
}

export async function helpdeskRoutes(app: FastifyInstance) {
  // ── GET /api/helpdesk/meta ── Opções de domínio para a UI ──
  app.get('/api/helpdesk/meta', { preHandler: authMiddleware }, async () => {
    return {
      statuses: TICKET_STATUSES,
      priorities: TICKET_PRIORITIES,
      types: TICKET_TYPES,
      channels: TICKET_CHANNELS,
    }
  })

  // ── GET /api/helpdesk/tickets ── Lista + contadores por status ──
  app.get('/api/helpdesk/tickets', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as Record<string, string | undefined>
    const where: any = { isSpam: q.spam === '1' } // por padrão exclui spam; ?spam=1 mostra só spam
    if (q.status) where.status = q.status
    if (q.priority) where.priority = q.priority
    if (q.type) where.type = q.type
    if (q.channel) where.channel = q.channel
    if (q.assignedUserId === 'me') where.assignedUserId = getOperator(req).userId ?? -1
    else if (q.assignedUserId === 'null') where.assignedUserId = null
    else if (q.assignedUserId) where.assignedUserId = Number(q.assignedUserId)
    if (q.teamId) where.teamId = Number(q.teamId)
    if (q.organizationId) where.organizationId = Number(q.organizationId)
    if (q.q) {
      const term = q.q.trim()
      const asNum = Number(term)
      where.OR = [
        { subject: { contains: term } },
        { requesterName: { contains: term } },
        { requesterEmail: { contains: term } },
        ...(Number.isFinite(asNum) ? [{ number: asNum }] : []),
      ]
    }

    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200)
    const offset = Math.max(Number(q.offset) || 0, 0)

    const [tickets, total, byStatus] = await Promise.all([
      prisma.helpdeskTicket.findMany({
        where,
        select: TICKET_LIST_SELECT,
        orderBy: [{ lastActivityAt: 'desc' }],
        take: limit,
        skip: offset,
      }),
      prisma.helpdeskTicket.count({ where }),
      prisma.helpdeskTicket.groupBy({ by: ['status'], _count: { _all: true } }),
    ])

    const counters: Record<string, number> = {}
    for (const s of TICKET_STATUSES) counters[s] = 0
    let open = 0
    for (const g of byStatus) {
      counters[g.status] = g._count._all
      if (!TERMINAL_STATUSES.includes(g.status as TicketStatus)) open += g._count._all
    }
    counters.open_total = open

    return { tickets, total, counters }
  })

  // ── POST /api/helpdesk/tickets ── Criar chamado ──
  app.post('/api/helpdesk/tickets', { preHandler: authMiddleware }, async (req, reply) => {
    const b = req.body as any
    const subject = (b?.subject || '').toString().trim()
    if (!subject) return reply.code(400).send({ error: 'Assunto (subject) é obrigatório' })

    if (b.status && !TICKET_STATUSES.includes(b.status)) return reply.code(400).send({ error: 'status inválido' })
    if (b.priority && !TICKET_PRIORITIES.includes(b.priority)) return reply.code(400).send({ error: 'priority inválido' })
    if (b.type && !TICKET_TYPES.includes(b.type)) return reply.code(400).send({ error: 'type inválido' })
    if (b.channel && !TICKET_CHANNELS.includes(b.channel)) return reply.code(400).send({ error: 'channel inválido' })

    const cf = await sanitizeHelpdeskCustomFields(b.customFields)
    if (cf.error) return reply.code(400).send({ error: cf.error })

    const op = getOperator(req)
    const number = await nextTicketNumber()
    const organizationId = await resolveOrganizationId(b.requesterEmail)
    // Sem setor/dono explícito → usa o setor padrão (depois o roteamento atribui).
    const teamId = b.teamId != null ? Number(b.teamId) : (b.assignedUserId == null ? await resolveDefaultTeamId() : null)

    const ticket = await prisma.helpdeskTicket.create({
      data: {
        number,
        subject,
        status: b.status || 'new',
        priority: b.priority || 'normal',
        type: b.type || 'question',
        channel: b.channel || 'manual',
        organizationId,
        assignedUserId: b.assignedUserId != null ? Number(b.assignedUserId) : null,
        teamId,
        requesterLeadId: b.requesterLeadId != null ? Number(b.requesterLeadId) : null,
        requesterName: b.requesterName ?? null,
        requesterEmail: b.requesterEmail ?? null,
        requesterPhone: b.requesterPhone ?? null,
        customFields: Object.keys(cf.values).length ? (cf.values as any) : undefined,
        tags: b.tags ?? undefined,
        createdById: op.userId ?? null,
        createdByName: op.userName ?? null,
        lastActivityAt: new Date(),
      },
    })

    await logTicketEvent({
      ticketId: ticket.id, type: 'created', title: `Chamado #${number} aberto`,
      userId: op.userId, userName: op.userName, actorType: 'agent',
    })

    // Descrição inicial vira o primeiro comentário público da thread.
    const description = (b?.description || '').toString().trim()
    if (description) {
      await prisma.helpdeskComment.create({
        data: {
          ticketId: ticket.id, authorType: 'agent', authorUserId: op.userId ?? null,
          authorName: op.userName ?? null, visibility: 'public', channel: ticket.channel,
          body: description,
        },
      })
    }

    await applySlaToTicket(ticket.id)
    await runTriggers('created', ticket.id)
    const { routeTicket } = await import('../services/helpdeskRouting.js')
    await routeTicket(ticket.id)
    await emitHelpdeskWebhook('helpdesk.ticket.created', ticket.id)
    const withSla = await prisma.helpdeskTicket.findUnique({ where: { id: ticket.id } })
    return reply.code(201).send({ ticket: withSla ?? ticket })
  })

  // ── GET /api/helpdesk/tickets/:id ── Detalhe + thread + timeline ──
  app.get('/api/helpdesk/tickets/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const ticket = await prisma.helpdeskTicket.findUnique({ where: { id } })
    if (!ticket) return reply.code(404).send({ error: 'Chamado não encontrado' })

    const [comments, events, followers, attachments, survey, qa] = await Promise.all([
      prisma.helpdeskComment.findMany({ where: { ticketId: id }, orderBy: { createdAt: 'asc' } }),
      prisma.helpdeskTicketEvent.findMany({ where: { ticketId: id }, orderBy: { createdAt: 'asc' } }),
      prisma.helpdeskFollower.findMany({ where: { ticketId: id }, orderBy: { createdAt: 'asc' } }),
      prisma.helpdeskAttachment.findMany({ where: { ticketId: id }, orderBy: { createdAt: 'asc' } }),
      prisma.helpdeskSurvey.findUnique({ where: { ticketId: id }, select: { rating: true, comment: true, respondedAt: true } }),
      prisma.helpdeskQaReview.findUnique({ where: { ticketId: id }, select: { score: true, tone: true, strengths: true, weaknesses: true, summary: true } }),
    ])

    const links = await getTicketLinks(id)
    const [conversation, calls] = await Promise.all([
      getTicketConversation(ticket.requesterLeadId),
      getTicketCalls(ticket.requesterLeadId),
    ])
    return { ticket, comments, events, followers, attachments: attachments.map(serializeAttachment), survey, qa, links, conversation, calls }
  })

  // ── PATCH /api/helpdesk/tickets/:id ── Atualizar campos / transicionar status ──
  app.patch('/api/helpdesk/tickets/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const current = await prisma.helpdeskTicket.findUnique({ where: { id } })
    if (!current) return reply.code(404).send({ error: 'Chamado não encontrado' })

    const b = req.body as any
    const op = getOperator(req)
    const data: any = {}
    const events: Array<{ type: string; title: string; oldValue?: string; newValue?: string }> = []

    if (typeof b.subject === 'string' && b.subject.trim() && b.subject !== current.subject) {
      data.subject = b.subject.trim()
    }

    if (b.priority && b.priority !== current.priority) {
      if (!TICKET_PRIORITIES.includes(b.priority)) return reply.code(400).send({ error: 'priority inválido' })
      data.priority = b.priority
      events.push({ type: 'priority_changed', title: `Prioridade: ${current.priority} → ${b.priority}`, oldValue: current.priority, newValue: b.priority })
    }

    if (b.type && b.type !== current.type) {
      if (!TICKET_TYPES.includes(b.type)) return reply.code(400).send({ error: 'type inválido' })
      data.type = b.type
      events.push({ type: 'type_changed', title: `Tipo: ${current.type} → ${b.type}`, oldValue: current.type, newValue: b.type })
    }

    if ('assignedUserId' in b && Number(b.assignedUserId) !== current.assignedUserId) {
      data.assignedUserId = b.assignedUserId != null ? Number(b.assignedUserId) : null
      events.push({ type: 'assigned', title: data.assignedUserId ? `Atribuído ao usuário #${data.assignedUserId}` : 'Atribuição removida', oldValue: String(current.assignedUserId ?? ''), newValue: String(data.assignedUserId ?? '') })
    }

    if ('teamId' in b && Number(b.teamId) !== current.teamId) {
      data.teamId = b.teamId != null ? Number(b.teamId) : null
      events.push({ type: 'team_changed', title: data.teamId ? `Setor #${data.teamId}` : 'Setor removido', oldValue: String(current.teamId ?? ''), newValue: String(data.teamId ?? '') })
    }

    if (b.status && b.status !== current.status) {
      if (!TICKET_STATUSES.includes(b.status)) return reply.code(400).send({ error: 'status inválido' })
      const newStatus: TicketStatus = b.status
      if (!canTransition(current.status as TicketStatus, newStatus)) {
        return reply.code(409).send({ error: `Transição inválida: ${current.status} → ${newStatus}` })
      }
      data.status = newStatus
      events.push({ type: 'status_changed', title: `Status: ${current.status} → ${newStatus}`, oldValue: current.status, newValue: newStatus })

      // Marcos de ciclo de vida.
      if (newStatus === 'solved' && !current.solvedAt) data.solvedAt = new Date()
      if (newStatus === 'closed' && !current.closedAt) data.closedAt = new Date()
      // Reabertura: sai de um status terminal de volta para ativo.
      if (TERMINAL_STATUSES.includes(current.status as TicketStatus) && !TERMINAL_STATUSES.includes(newStatus)) {
        data.reopenCount = { increment: 1 }
        data.solvedAt = null
        data.closedAt = null
        events.push({ type: 'reopened', title: 'Chamado reaberto' })
      }
    }

    // Campos personalizados (group=helpdesk): merge parcial sobre os existentes.
    if (b.customFields && typeof b.customFields === 'object') {
      const cf = await sanitizeHelpdeskCustomFields(b.customFields, false, true)
      if (cf.error) return reply.code(400).send({ error: cf.error })
      if (Object.keys(cf.values).length) {
        const merged = { ...((current.customFields as object) || {}), ...cf.values }
        data.customFields = merged
        events.push({ type: 'fields_updated', title: 'Campos personalizados atualizados' })
      }
    }

    if (Object.keys(data).length === 0) return { ticket: current }

    data.lastActivityAt = new Date()
    await prisma.helpdeskTicket.update({ where: { id }, data })
    for (const ev of events) {
      await logTicketEvent({ ticketId: id, type: ev.type, title: ev.title, userId: op.userId, userName: op.userName, actorType: 'agent', oldValue: ev.oldValue ?? null, newValue: ev.newValue ?? null })
    }

    // ── Reações de SLA ──
    const reopened = TERMINAL_STATUSES.includes(current.status as TicketStatus) && data.status && !TERMINAL_STATUSES.includes(data.status as TicketStatus)
    if (reopened || (data.priority && data.priority !== current.priority)) {
      await applySlaToTicket(id) // recalcula metas
    } else if (data.status) {
      const wasPaused = PAUSED_STATUSES.includes(current.status)
      const isPaused = PAUSED_STATUSES.includes(data.status)
      if (isPaused && !wasPaused) await pauseSla(id)
      if (wasPaused && !isPaused) await resumeSla(id)
    }

    if (data.status === 'solved') await createSurveyOnSolve(id)
    if (data.status) {
      await runTriggers('status_changed', id)
      await emitHelpdeskWebhook('helpdesk.ticket.status_changed', id, { from: current.status, to: data.status })
      if (data.status === 'solved') await emitHelpdeskWebhook('helpdesk.ticket.solved', id)
    }

    const ticket = await prisma.helpdeskTicket.findUnique({ where: { id } })
    return { ticket }
  })

  // ── POST /api/helpdesk/tickets/:id/comments ── Responder / nota interna ──
  app.post('/api/helpdesk/tickets/:id/comments', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const current = await prisma.helpdeskTicket.findUnique({ where: { id } })
    if (!current) return reply.code(404).send({ error: 'Chamado não encontrado' })

    const b = req.body as any
    const body = (b?.body || '').toString().trim()
    if (!body) return reply.code(400).send({ error: 'Conteúdo (body) é obrigatório' })
    const visibility = b.visibility === 'internal' ? 'internal' : 'public'
    // Agente colaborador (canView sem canEdit) só pode adicionar NOTA INTERNA.
    if (visibility === 'public' && !(await helpdeskCanEdit(req))) {
      return reply.code(403).send({ error: 'Como agente colaborador, você só pode adicionar notas internas (não responder ao solicitante).' })
    }
    const op = getOperator(req)

    // Ticket com conversa real (WhatsApp/chat): resposta pública sai pelo canal
    // do cliente reusando o módulo de Conversas (whatsappProvider).
    let channelSent: boolean | undefined
    let channelError: string | undefined
    if (visibility === 'public' && isConversationBacked(current)) {
      const r = await sendTicketChannelReply(current, body, { userId: op.userId, userName: op.userName, role: (req as any).user?.role })
      channelSent = r.ok
      if (!r.ok) channelError = r.error
    } else if (visibility === 'public' && current.channel === 'email' && current.requesterEmail) {
      const r = await sendTicketEmailReply(current, body, { userId: op.userId, userName: op.userName })
      channelSent = r.ok
      if (!r.ok) channelError = r.error
    }

    const comment = await prisma.helpdeskComment.create({
      data: {
        ticketId: id, authorType: 'agent', authorUserId: op.userId ?? null,
        authorName: op.userName ?? null, visibility, channel: channelSent ? current.channel : (b.channel ?? null),
        body, attachments: b.attachments ?? undefined,
      },
    })

    // Atualiza atividade; primeira resposta pública do agente marca firstResponseAt.
    const update: any = { lastActivityAt: new Date() }
    const marksFirstResponse = visibility === 'public' && !current.firstResponseAt
    if (marksFirstResponse) update.firstResponseAt = new Date()
    // Resposta pública num ticket "new" promove para "open".
    if (visibility === 'public' && current.status === 'new') update.status = 'open'
    await prisma.helpdeskTicket.update({ where: { id }, data: update })
    if (marksFirstResponse) await markFirstResponseSla(id)
    // F27 — resposta pública do agente para o relógio de próxima resposta.
    if (visibility === 'public') await clearNextResponseSla(id)

    await logTicketEvent({
      ticketId: id, type: 'comment_added',
      title: visibility === 'internal' ? 'Nota interna adicionada' : 'Resposta enviada',
      userId: op.userId, userName: op.userName, actorType: 'agent',
    })

    if (visibility === 'public') {
      await runTriggers('replied', id)
      await emitHelpdeskWebhook('helpdesk.ticket.replied', id)
    }

    return reply.code(201).send({ comment, channelSent, channelError })
  })

  // ── DELETE /api/helpdesk/tickets/:id ── Remover chamado ──
  app.delete('/api/helpdesk/tickets/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const current = await prisma.helpdeskTicket.findUnique({ where: { id } })
    if (!current) return reply.code(404).send({ error: 'Chamado não encontrado' })
    // Filhos sem FK de cascata (ticketId Int @unique / sem @relation): remover explicitamente.
    await prisma.helpdeskSurvey.deleteMany({ where: { ticketId: id } })
    await prisma.helpdeskQaReview.deleteMany({ where: { ticketId: id } })
    await prisma.helpdeskTicketLink.deleteMany({ where: { OR: [{ ticketId: id }, { linkedTicketId: id }] } })
    // Conversas paralelas (F27): ticketId sem @relation → não cascateia; remover mensagens + conversas.
    const scs = await prisma.helpdeskSideConversation.findMany({ where: { ticketId: id }, select: { id: true } })
    if (scs.length) {
      await prisma.helpdeskSideMessage.deleteMany({ where: { sideConversationId: { in: scs.map((s) => s.id) } } })
      await prisma.helpdeskSideConversation.deleteMany({ where: { ticketId: id } })
    }
    await prisma.helpdeskTicket.delete({ where: { id } }) // cascata remove comments/events/followers/attachments
    return { ok: true }
  })

  // ════════════════════ ATRIBUIÇÃO ════════════════════

  // POST /tickets/:id/claim ── Agente assume o chamado ──
  app.post('/api/helpdesk/tickets/:id/claim', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const t = await prisma.helpdeskTicket.findUnique({ where: { id } })
    if (!t) return reply.code(404).send({ error: 'Chamado não encontrado' })
    const op = getOperator(req)
    if (!op.userId) return reply.code(400).send({ error: 'Usuário não identificado' })
    const data: any = { assignedUserId: op.userId, lastActivityAt: new Date() }
    if (t.status === 'new') data.status = 'open'
    const ticket = await prisma.helpdeskTicket.update({ where: { id }, data })
    await logTicketEvent({ ticketId: id, type: 'assigned', title: `${op.userName} assumiu o chamado`, userId: op.userId, userName: op.userName, actorType: 'agent', newValue: String(op.userId) })
    await notifyTicketAgent(id, 'assigned')
    return { ticket }
  })

  // POST /tickets/:id/assign ── Atribuir a agente e/ou setor ──
  app.post('/api/helpdesk/tickets/:id/assign', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const t = await prisma.helpdeskTicket.findUnique({ where: { id } })
    if (!t) return reply.code(404).send({ error: 'Chamado não encontrado' })
    const b = req.body as any
    const op = getOperator(req)
    const data: any = { lastActivityAt: new Date() }
    const events: Array<{ type: string; title: string; oldValue?: string; newValue?: string }> = []

    if ('userId' in b) {
      const uid = b.userId != null ? Number(b.userId) : null
      if (uid !== t.assignedUserId) {
        if (uid != null) {
          const u = await prisma.user.findUnique({ where: { id: uid }, select: { id: true, name: true, active: true } })
          if (!u || !u.active) return reply.code(400).send({ error: 'Usuário inválido ou inativo' })
          data.assignedUserId = uid
          events.push({ type: 'assigned', title: `Atribuído a ${u.name}`, oldValue: String(t.assignedUserId ?? ''), newValue: String(uid) })
        } else {
          data.assignedUserId = null
          events.push({ type: 'assigned', title: 'Atribuição de agente removida', oldValue: String(t.assignedUserId ?? '') })
        }
      }
    }
    if ('teamId' in b) {
      const tid = b.teamId != null ? Number(b.teamId) : null
      if (tid !== t.teamId) {
        data.teamId = tid
        events.push({ type: 'team_changed', title: tid ? `Setor #${tid}` : 'Setor removido', oldValue: String(t.teamId ?? ''), newValue: String(tid ?? '') })
      }
    }
    if (events.length === 0) return { ticket: t }
    const ticket = await prisma.helpdeskTicket.update({ where: { id }, data })
    for (const ev of events) await logTicketEvent({ ticketId: id, ...ev, userId: op.userId, userName: op.userName, actorType: 'agent' })
    if ('assignedUserId' in data && data.assignedUserId != null) await notifyTicketAgent(id, 'assigned')
    return { ticket }
  })

  // POST /tickets/:id/release ── Devolver à fila ──
  app.post('/api/helpdesk/tickets/:id/release', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const t = await prisma.helpdeskTicket.findUnique({ where: { id } })
    if (!t) return reply.code(404).send({ error: 'Chamado não encontrado' })
    const op = getOperator(req)
    const ticket = await prisma.helpdeskTicket.update({ where: { id }, data: { assignedUserId: null, lastActivityAt: new Date() } })
    await logTicketEvent({ ticketId: id, type: 'released', title: `${op.userName} devolveu o chamado à fila`, userId: op.userId, userName: op.userName, actorType: 'agent' })
    return { ticket }
  })

  // POST /tickets/:id/call ── Click-to-call para o solicitante (reusa VoIP) ──
  app.post('/api/helpdesk/tickets/:id/call', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const t = await prisma.helpdeskTicket.findUnique({ where: { id }, select: { id: true, requesterLeadId: true, requesterPhone: true } })
    if (!t) return reply.code(404).send({ error: 'Chamado não encontrado' })
    const op = getOperator(req)
    const r = await startTicketCall(t, { userId: op.userId })
    if (!r.ok) return reply.code(400).send({ error: r.error })
    await logTicketEvent({ ticketId: id, type: 'call_started', title: 'Ligação iniciada (click-to-call)', userId: op.userId, userName: op.userName, actorType: 'agent' })
    return { ok: true, call: r.call }
  })

  // POST /tickets/:id/spam ── Marca/desmarca como spam (F13) ──
  app.post('/api/helpdesk/tickets/:id/spam', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    if (!await prisma.helpdeskTicket.findUnique({ where: { id }, select: { id: true } })) return reply.code(404).send({ error: 'Chamado não encontrado' })
    const value = (req.body as any)?.value !== false
    const op = getOperator(req)
    const ticket = await prisma.helpdeskTicket.update({ where: { id }, data: { isSpam: value, lastActivityAt: new Date() } })
    await logTicketEvent({ ticketId: id, type: value ? 'marked_spam' : 'unmarked_spam', title: value ? 'Marcado como spam' : 'Removido do spam', userId: op.userId, userName: op.userName, actorType: 'agent' })
    return { ticket }
  })

  // ════════════════════ SOLICITANTE (REQUESTER) ════════════════════

  // GET /leads/search?q= ── Busca de leads p/ vincular como solicitante ──
  app.get('/api/helpdesk/leads/search', { preHandler: authMiddleware }, async (req) => {
    const q = ((req.query as any).q || '').toString().trim()
    if (!q) return { leads: [] }
    const leads = await prisma.lead.findMany({
      where: { OR: [{ nome: { contains: q } }, { email: { contains: q } }, { whatsapp: { contains: q } }, { empresa: { contains: q } }] },
      select: { id: true, nome: true, email: true, whatsapp: true, empresa: true },
      take: 10,
      orderBy: { updatedAt: 'desc' },
    })
    return { leads }
  })

  // POST /tickets/:id/requester ── Vincular a um Lead (herda contato) ou definir contato manual ──
  app.post('/api/helpdesk/tickets/:id/requester', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const t = await prisma.helpdeskTicket.findUnique({ where: { id } })
    if (!t) return reply.code(404).send({ error: 'Chamado não encontrado' })
    const b = req.body as any
    const op = getOperator(req)
    const data: any = { lastActivityAt: new Date() }

    if (b.leadId != null) {
      const lead = await prisma.lead.findUnique({ where: { id: Number(b.leadId) }, select: { id: true, nome: true, email: true, whatsapp: true } })
      if (!lead) return reply.code(404).send({ error: 'Lead não encontrado' })
      data.requesterLeadId = lead.id
      data.requesterName = lead.nome || null
      data.requesterEmail = lead.email || null
      data.requesterPhone = lead.whatsapp || null
    } else {
      if ('requesterName' in b) data.requesterName = b.requesterName || null
      if ('requesterEmail' in b) data.requesterEmail = b.requesterEmail || null
      if ('requesterPhone' in b) data.requesterPhone = b.requesterPhone || null
    }
    const ticket = await prisma.helpdeskTicket.update({ where: { id }, data })
    await logTicketEvent({ ticketId: id, type: 'requester_changed', title: `Solicitante: ${ticket.requesterName || ticket.requesterEmail || '—'}`, userId: op.userId, userName: op.userName, actorType: 'agent' })
    return { ticket }
  })

  // DELETE /tickets/:id/requester ── Desvincular lead (mantém contato desnormalizado) ──
  app.delete('/api/helpdesk/tickets/:id/requester', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const t = await prisma.helpdeskTicket.findUnique({ where: { id } })
    if (!t) return reply.code(404).send({ error: 'Chamado não encontrado' })
    const op = getOperator(req)
    const ticket = await prisma.helpdeskTicket.update({ where: { id }, data: { requesterLeadId: null, lastActivityAt: new Date() } })
    await logTicketEvent({ ticketId: id, type: 'requester_changed', title: 'Lead desvinculado do solicitante', userId: op.userId, userName: op.userName, actorType: 'agent' })
    return { ticket }
  })

  // ════════════════════ SEGUIDORES / CC ════════════════════

  // POST /tickets/:id/followers ── Adicionar seguidor (userId OU email) ──
  app.post('/api/helpdesk/tickets/:id/followers', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const t = await prisma.helpdeskTicket.findUnique({ where: { id } })
    if (!t) return reply.code(404).send({ error: 'Chamado não encontrado' })
    const b = req.body as any
    const op = getOperator(req)
    let name: string | null = b.name ?? null
    const data: any = { ticketId: id, name }
    if (b.userId != null) {
      const u = await prisma.user.findUnique({ where: { id: Number(b.userId) }, select: { id: true, name: true } })
      if (!u) return reply.code(404).send({ error: 'Usuário não encontrado' })
      data.userId = u.id
      data.name = name || u.name
      name = data.name
    } else if (b.email) {
      data.email = String(b.email).trim()
      name = name || data.email
    } else {
      return reply.code(400).send({ error: 'Informe userId ou email' })
    }
    const follower = await prisma.helpdeskFollower.create({ data })
    await prisma.helpdeskTicket.update({ where: { id }, data: { lastActivityAt: new Date() } })
    await logTicketEvent({ ticketId: id, type: 'follower_added', title: `Seguidor adicionado: ${name}`, userId: op.userId, userName: op.userName, actorType: 'agent' })
    return reply.code(201).send({ follower })
  })

  // DELETE /tickets/:id/followers/:fid ── Remover seguidor ──
  app.delete('/api/helpdesk/tickets/:id/followers/:fid', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const fid = Number((req.params as any).fid)
    const f = await prisma.helpdeskFollower.findUnique({ where: { id: fid } })
    if (!f || f.ticketId !== id) return reply.code(404).send({ error: 'Seguidor não encontrado' })
    await prisma.helpdeskFollower.delete({ where: { id: fid } })
    return { ok: true }
  })

  // POST /tickets/:id/follow ── Seguir o chamado (próprio usuário, F25) ──
  // Disponível ao AGENTE COLABORADOR (só 'view'): não edita o chamado.
  app.post('/api/helpdesk/tickets/:id/follow', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const t = await prisma.helpdeskTicket.findUnique({ where: { id }, select: { id: true } })
    if (!t) return reply.code(404).send({ error: 'Chamado não encontrado' })
    const op = getOperator(req)
    if (!op.userId) return reply.code(401).send({ error: 'Autenticação necessária' })
    const existing = await prisma.helpdeskFollower.findFirst({ where: { ticketId: id, userId: op.userId } })
    if (existing) return { ok: true, following: true, follower: existing }
    const follower = await prisma.helpdeskFollower.create({ data: { ticketId: id, userId: op.userId, name: op.userName ?? null } })
    await logTicketEvent({ ticketId: id, type: 'follower_added', title: `${op.userName || 'Colaborador'} começou a seguir`, userId: op.userId, userName: op.userName, actorType: 'agent' })
    return reply.code(201).send({ ok: true, following: true, follower })
  })

  // DELETE /tickets/:id/follow ── Deixar de seguir (próprio usuário) ──
  app.delete('/api/helpdesk/tickets/:id/follow', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const op = getOperator(req)
    if (!op.userId) return reply.code(401).send({ error: 'Autenticação necessária' })
    await prisma.helpdeskFollower.deleteMany({ where: { ticketId: id, userId: op.userId } })
    return { ok: true, following: false }
  })

  // ════════════════════ CONVERSAS PARALELAS / SIDE CONVERSATIONS (F27) ════════════════════

  // GET /tickets/:id/side-conversations ── Lista conversas paralelas + mensagens ──
  app.get('/api/helpdesk/tickets/:id/side-conversations', { preHandler: authMiddleware }, async (req) => {
    const id = Number((req.params as any).id)
    return { conversations: await listSideConversations(id) }
  })

  // POST /tickets/:id/side-conversations ── Abre conversa paralela + 1ª mensagem ──
  app.post('/api/helpdesk/tickets/:id/side-conversations', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const b = (req.body as any) || {}
    const channel = b.channel === 'whatsapp' ? 'whatsapp' : 'email'
    const body = (b.body || '').toString().trim()
    if (!body) return reply.code(400).send({ error: 'Mensagem (body) obrigatória' })
    if (channel === 'email' && !b.targetEmail) return reply.code(400).send({ error: 'Informe o e-mail do destinatário' })
    if (channel === 'whatsapp' && !b.targetPhone) return reply.code(400).send({ error: 'Informe o WhatsApp do destinatário' })
    const op = getOperator(req)
    try {
      const r = await createSideConversation(id, { channel, targetName: b.targetName, targetEmail: b.targetEmail, targetPhone: b.targetPhone, subject: b.subject, body }, op)
      return reply.code(201).send(r)
    } catch (e) { return reply.code(400).send({ error: (e as Error).message }) }
  })

  // POST /tickets/:id/side-conversations/:scid/messages ── Nova mensagem (outbound) ──
  app.post('/api/helpdesk/tickets/:id/side-conversations/:scid/messages', { preHandler: authMiddleware }, async (req, reply) => {
    const scid = Number((req.params as any).scid)
    const b = (req.body as any) || {}
    const body = (b.body || '').toString().trim()
    if (!body) return reply.code(400).send({ error: 'Mensagem (body) obrigatória' })
    const op = getOperator(req)
    try { return await sendSideMessage(scid, body, op) }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }) }
  })

  // POST /tickets/:id/side-conversations/:scid/inbound ── Registra resposta recebida ──
  app.post('/api/helpdesk/tickets/:id/side-conversations/:scid/inbound', { preHandler: authMiddleware }, async (req, reply) => {
    const scid = Number((req.params as any).scid)
    const b = (req.body as any) || {}
    const body = (b.body || '').toString().trim()
    if (!body) return reply.code(400).send({ error: 'Mensagem (body) obrigatória' })
    try { return await addInboundSideMessage(scid, body, b.authorName) }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }) }
  })

  // POST /tickets/:id/side-conversations/:scid/close ── Encerra a conversa paralela ──
  app.post('/api/helpdesk/tickets/:id/side-conversations/:scid/close', { preHandler: authMiddleware }, async (req) => {
    const scid = Number((req.params as any).scid)
    return closeSideConversation(scid)
  })

  // ════════════════════ TAGS (catálogo existente) ════════════════════

  // POST /tickets/:id/tags ── Define o conjunto de tags (array de tagIds) ──
  app.post('/api/helpdesk/tickets/:id/tags', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const t = await prisma.helpdeskTicket.findUnique({ where: { id } })
    if (!t) return reply.code(404).send({ error: 'Chamado não encontrado' })
    const b = req.body as any
    const ids: number[] = Array.isArray(b.tagIds) ? b.tagIds.map(Number).filter(Number.isFinite) : []
    // Valida contra o catálogo (apenas tags ativas existentes entram).
    const valid = ids.length ? await prisma.tag.findMany({ where: { id: { in: ids }, active: true }, select: { id: true } }) : []
    const validIds = valid.map((v) => v.id)
    const op = getOperator(req)
    const ticket = await prisma.helpdeskTicket.update({ where: { id }, data: { tags: validIds, lastActivityAt: new Date() } })
    await logTicketEvent({ ticketId: id, type: 'tags_changed', title: `Tags atualizadas (${validIds.length})`, userId: op.userId, userName: op.userName, actorType: 'agent', newValue: validIds.join(',') })
    return { ticket }
  })

  // ════════════════════ CAMPOS PERSONALIZADOS (catálogo group=helpdesk) ════════════════════

  // GET /custom-fields ── Catálogo de campos do helpdesk (group=helpdesk, ativos) ──
  app.get('/api/helpdesk/custom-fields', { preHandler: authMiddleware }, async () => {
    const fields = await prisma.customField.findMany({
      where: { group: 'helpdesk', active: true },
      orderBy: [{ position: 'asc' }, { label: 'asc' }],
      select: { id: true, key: true, label: true, type: true, placeholder: true, options: true, required: true, description: true },
    })
    return { fields }
  })

  // GET /tags-catalog ── Catálogo de tags ativas (p/ seletor no ticket) ──
  app.get('/api/helpdesk/tags-catalog', { preHandler: authMiddleware }, async () => {
    const tags = await prisma.tag.findMany({
      where: { active: true },
      select: { id: true, name: true, color: true },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
    })
    return { tags }
  })

  // ════════════════════ AUXILIARES (selects da UI) ════════════════════

  // GET /agents ── Usuários atribuíveis (ativos) ──
  app.get('/api/helpdesk/agents', { preHandler: authMiddleware }, async () => {
    const agents = await prisma.user.findMany({
      where: { active: true },
      select: { id: true, name: true, email: true, role: true, isAgent: true },
      orderBy: { name: 'asc' },
    })
    return { agents }
  })

  // GET /teams ── Setores ativos ──
  app.get('/api/helpdesk/teams', { preHandler: authMiddleware }, async () => {
    const teams = await prisma.team.findMany({
      where: { active: true },
      select: { id: true, name: true, color: true, slug: true },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
    })
    return { teams }
  })

  // ════════════════════ ANEXOS ════════════════════

  // POST /tickets/:id/attachments ── Upload multipart (campo "file", opcional "commentId") ──
  app.post('/api/helpdesk/tickets/:id/attachments', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const t = await prisma.helpdeskTicket.findUnique({ where: { id } })
    if (!t) return reply.code(404).send({ error: 'Chamado não encontrado' })

    const file = await (req as any).file?.({ limits: { fileSize: MAX_ATTACHMENT_BYTES } })
    if (!file) return reply.code(400).send({ error: 'Nenhum arquivo enviado' })

    const ext = sanitizeExt(file.filename || '')
    const uploadsDir = join(process.cwd(), '..', 'uploads', 'helpdesk-attachments')
    await fs.mkdir(uploadsDir, { recursive: true })
    const savedName = `${id}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`
    const filePath = join(uploadsDir, savedName)

    const chunks: Buffer[] = []
    let total = 0
    for await (const c of file.file) {
      total += c.length
      if (total > MAX_ATTACHMENT_BYTES) return reply.code(413).send({ error: 'Arquivo muito grande (máx 25MB)' })
      chunks.push(c)
    }
    await fs.writeFile(filePath, Buffer.concat(chunks))

    const commentIdRaw = file.fields?.commentId?.value
    const commentId = commentIdRaw != null && Number.isFinite(Number(commentIdRaw)) ? Number(commentIdRaw) : null
    const op = getOperator(req)

    const created = await prisma.helpdeskAttachment.create({
      data: {
        ticketId: id, commentId,
        fileName: (file.filename || 'arquivo').slice(0, 255),
        fileSize: total,
        mimeType: file.mimetype || 'application/octet-stream',
        storagePath: `helpdesk-attachments/${savedName}`,
        uploadedById: op.userId ?? null,
        uploadedByName: op.userName ?? null,
      },
    })
    await prisma.helpdeskTicket.update({ where: { id }, data: { lastActivityAt: new Date() } })
    await logTicketEvent({ ticketId: id, type: 'attachment_added', title: `Anexo: ${created.fileName}`, userId: op.userId, userName: op.userName, actorType: 'agent' })
    return reply.code(201).send({ attachment: serializeAttachment(created) })
  })

  // DELETE /tickets/:id/attachments/:aid ── Remove anexo (DB + disco) ──
  app.delete('/api/helpdesk/tickets/:id/attachments/:aid', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const aid = Number((req.params as any).aid)
    const att = await prisma.helpdeskAttachment.findUnique({ where: { id: aid } })
    if (!att || att.ticketId !== id) return reply.code(404).send({ error: 'Anexo não encontrado' })
    await prisma.helpdeskAttachment.delete({ where: { id: aid } })
    try {
      await fs.unlink(join(process.cwd(), '..', 'uploads', att.storagePath))
    } catch (err) {
      console.warn('[helpdesk] unlink anexo falhou:', (err as Error).message)
    }
    return { ok: true }
  })

  // ════════════════════ AÇÕES EM MASSA (BULK) ════════════════════

  // POST /tickets/bulk ── Aplica uma ação a vários chamados de uma vez ──
  // body: { ids: number[], action: 'status'|'priority'|'assign'|'team'|'tag'|'delete', value }
  app.post('/api/helpdesk/tickets/bulk', { preHandler: authMiddleware }, async (req, reply) => {
    const b = req.body as any
    const ids: number[] = Array.isArray(b.ids) ? b.ids.map(Number).filter(Number.isFinite) : []
    const action = b.action as string
    if (!ids.length) return reply.code(400).send({ error: 'Nenhum chamado selecionado' })
    const op = getOperator(req)

    if (action === 'delete') {
      const r = await prisma.helpdeskTicket.deleteMany({ where: { id: { in: ids } } })
      return { updated: r.count, skipped: [] }
    }

    const tickets = await prisma.helpdeskTicket.findMany({ where: { id: { in: ids } } })
    let updated = 0
    const skipped: number[] = []

    for (const t of tickets) {
      const data: any = { lastActivityAt: new Date() }
      let evt: { type: string; title: string; newValue?: string } | null = null

      if (action === 'status') {
        if (!TICKET_STATUSES.includes(b.value)) return reply.code(400).send({ error: 'status inválido' })
        const ns: TicketStatus = b.value
        if (!canTransition(t.status as TicketStatus, ns)) { skipped.push(t.id); continue }
        data.status = ns
        if (ns === 'solved' && !t.solvedAt) data.solvedAt = new Date()
        if (ns === 'closed' && !t.closedAt) data.closedAt = new Date()
        if (TERMINAL_STATUSES.includes(t.status as TicketStatus) && !TERMINAL_STATUSES.includes(ns)) {
          data.reopenCount = { increment: 1 }; data.solvedAt = null; data.closedAt = null
        }
        evt = { type: 'status_changed', title: `Status: ${t.status} → ${ns}`, newValue: ns }
      } else if (action === 'priority') {
        if (!TICKET_PRIORITIES.includes(b.value)) return reply.code(400).send({ error: 'priority inválido' })
        data.priority = b.value
        evt = { type: 'priority_changed', title: `Prioridade → ${b.value}`, newValue: b.value }
      } else if (action === 'assign') {
        data.assignedUserId = b.value != null ? Number(b.value) : null
        evt = { type: 'assigned', title: data.assignedUserId ? `Atribuído ao usuário #${data.assignedUserId}` : 'Atribuição removida' }
      } else if (action === 'team') {
        data.teamId = b.value != null ? Number(b.value) : null
        evt = { type: 'team_changed', title: data.teamId ? `Setor #${data.teamId}` : 'Setor removido' }
      } else if (action === 'tag') {
        const tagId = Number(b.value)
        const cur: number[] = Array.isArray(t.tags) ? (t.tags as number[]) : []
        if (cur.includes(tagId)) { skipped.push(t.id); continue }
        data.tags = [...cur, tagId]
        evt = { type: 'tags_changed', title: `Tag #${tagId} adicionada` }
      } else if (action === 'spam') {
        data.isSpam = b.value !== false
        evt = { type: data.isSpam ? 'marked_spam' : 'unmarked_spam', title: data.isSpam ? 'Marcado como spam' : 'Removido do spam' }
      } else {
        return reply.code(400).send({ error: 'Ação inválida' })
      }

      await prisma.helpdeskTicket.update({ where: { id: t.id }, data })
      if (evt) await logTicketEvent({ ticketId: t.id, type: evt.type, title: evt.title, userId: op.userId, userName: op.userName, actorType: 'agent', newValue: evt.newValue ?? null })
      // Reações de SLA no bulk
      if (action === 'priority') {
        await applySlaToTicket(t.id)
      } else if (action === 'status') {
        const ns = b.value as TicketStatus
        const wasPaused = PAUSED_STATUSES.includes(t.status)
        const isPaused = PAUSED_STATUSES.includes(ns)
        if (TERMINAL_STATUSES.includes(t.status as TicketStatus) && !TERMINAL_STATUSES.includes(ns)) await applySlaToTicket(t.id)
        else if (isPaused && !wasPaused) await pauseSla(t.id)
        else if (wasPaused && !isPaused) await resumeSla(t.id)
        if (ns === 'solved') await createSurveyOnSolve(t.id)
      }
      updated++
    }
    return { updated, skipped }
  })

  // ════════════════════ PRESENÇA / COLISÃO ════════════════════

  // POST /tickets/:id/presence ── Heartbeat: marca que estou vendo + retorna outros viewers ──
  app.post('/api/helpdesk/tickets/:id/presence', { preHandler: authMiddleware }, async (req) => {
    const id = Number((req.params as any).id)
    const op = getOperator(req)
    const key = `hd:viewing:${id}`
    const now = Date.now()
    const STALE_MS = 25_000
    try {
      if (op.userId) {
        await redis.hset(key, String(op.userId), JSON.stringify({ name: op.userName || 'Operador', ts: now }))
        await redis.expire(key, 60)
      }
      const all = await redis.hgetall(key)
      const viewers: Array<{ userId: number; name: string }> = []
      for (const [uid, raw] of Object.entries(all)) {
        try {
          const v = JSON.parse(raw) as { name: string; ts: number }
          if (now - v.ts > STALE_MS) { await redis.hdel(key, uid); continue }
          if (Number(uid) !== op.userId) viewers.push({ userId: Number(uid), name: v.name })
        } catch { /* entrada corrompida — ignora */ }
      }
      return { viewers }
    } catch {
      return { viewers: [] }
    }
  })

  // ════════════════════ CONFIGURAÇÕES DO MÓDULO ════════════════════

  // GET /api/admin/helpdesk/settings ── Config de canais (setor default, inbound) ──
  app.get('/api/admin/helpdesk/settings', { preHandler: authMiddleware }, async () => {
    const rows = await prisma.setting.findMany({ where: { key: { in: ['helpdesk.default_team_id', 'helpdesk.inbound_email_secret', 'helpdesk.auto_assign', 'helpdesk.notify_agents'] } } })
    const byKey = new Map(rows.map((r) => [r.key, r.value]))
    const secret = byKey.get('helpdesk.inbound_email_secret')
    const truthy = (v: any) => v == null ? true : (v === true || String(v).replace(/"/g, '') === 'true')
    return {
      defaultTeamId: byKey.get('helpdesk.default_team_id') ? Number(String(byKey.get('helpdesk.default_team_id')).replace(/"/g, '')) : null,
      inboundEmailConfigured: !!secret,
      autoAssign: truthy(byKey.get('helpdesk.auto_assign')),
      notifyAgents: truthy(byKey.get('helpdesk.notify_agents')),
    }
  })

  // POST /api/admin/helpdesk/settings ── Atualiza config ──
  app.post('/api/admin/helpdesk/settings', { preHandler: authMiddleware }, async (req) => {
    const b = (req.body as any) || {}
    async function setKey(key: string, value: any, label: string) {
      await prisma.setting.upsert({
        where: { key },
        create: { key, value, label, grp: 'helpdesk', fieldType: 'string' },
        update: { value },
      })
    }
    if ('defaultTeamId' in b) await setKey('helpdesk.default_team_id', b.defaultTeamId != null ? Number(b.defaultTeamId) : null, 'Setor padrão do Helpdesk')
    if ('autoAssign' in b) await setKey('helpdesk.auto_assign', !!b.autoAssign, 'Atribuição automática do Helpdesk')
    if ('notifyAgents' in b) await setKey('helpdesk.notify_agents', !!b.notifyAgents, 'Notificar agentes (Helpdesk)')
    if (b.regenerateInboundSecret) {
      const secret = crypto.randomBytes(24).toString('hex')
      await setKey('helpdesk.inbound_email_secret', secret, 'Segredo do inbound de e-mail do Helpdesk')
      return { ok: true, inboundEmailSecret: secret }
    }
    return { ok: true }
  })

  // ════════════════════ SLA: POLÍTICAS E CALENDÁRIOS ════════════════════

  // GET /api/admin/helpdesk/sla-policies ── Lista políticas ──
  app.get('/api/admin/helpdesk/sla-policies', { preHandler: authMiddleware }, async () => {
    const policies = await prisma.helpdeskSlaPolicy.findMany({ orderBy: { order: 'asc' } })
    return { policies }
  })

  // POST /api/admin/helpdesk/sla-policies ── Cria política ──
  app.post('/api/admin/helpdesk/sla-policies', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    if (!b.name) return reply.code(400).send({ error: 'name obrigatório' })
    const policy = await prisma.helpdeskSlaPolicy.create({
      data: {
        name: String(b.name).slice(0, 120),
        order: Number(b.order) || 0,
        active: b.active !== false,
        conditions: b.conditions ?? {},
        firstResponseMins: b.firstResponseMins ?? {},
        resolutionMins: b.resolutionMins ?? {},
        nextResponseMins: b.nextResponseMins ?? undefined,
        useBusinessHours: !!b.useBusinessHours,
        calendarId: b.calendarId != null ? Number(b.calendarId) : null,
      },
    })
    return reply.code(201).send({ policy })
  })

  // PUT /api/admin/helpdesk/sla-policies/:id ── Atualiza política ──
  app.put('/api/admin/helpdesk/sla-policies/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const exists = await prisma.helpdeskSlaPolicy.findUnique({ where: { id } })
    if (!exists) return reply.code(404).send({ error: 'Política não encontrada' })
    const b = (req.body as any) || {}
    const data: any = {}
    for (const k of ['name', 'order', 'active', 'conditions', 'firstResponseMins', 'resolutionMins', 'nextResponseMins', 'useBusinessHours', 'calendarId']) {
      if (k in b) data[k] = b[k]
    }
    if ('calendarId' in data && data.calendarId != null) data.calendarId = Number(data.calendarId)
    const policy = await prisma.helpdeskSlaPolicy.update({ where: { id }, data })
    return { policy }
  })

  // DELETE /api/admin/helpdesk/sla-policies/:id ──
  app.delete('/api/admin/helpdesk/sla-policies/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    await prisma.helpdeskSlaPolicy.delete({ where: { id } }).catch(() => null)
    return reply.send({ ok: true })
  })

  // GET /api/admin/helpdesk/calendars ──
  app.get('/api/admin/helpdesk/calendars', { preHandler: authMiddleware }, async () => {
    const calendars = await prisma.helpdeskBusinessCalendar.findMany({ orderBy: { id: 'asc' } })
    return { calendars }
  })

  // POST /api/admin/helpdesk/calendars ──
  app.post('/api/admin/helpdesk/calendars', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    if (!b.name) return reply.code(400).send({ error: 'name obrigatório' })
    const calendar = await prisma.helpdeskBusinessCalendar.create({
      data: {
        name: String(b.name).slice(0, 120),
        timezone: b.timezone || 'America/Sao_Paulo',
        weekdayHours: b.weekdayHours ?? {},
        holidays: b.holidays ?? [],
      },
    })
    return reply.code(201).send({ calendar })
  })

  // PUT /api/admin/helpdesk/calendars/:id ──
  app.put('/api/admin/helpdesk/calendars/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const exists = await prisma.helpdeskBusinessCalendar.findUnique({ where: { id } })
    if (!exists) return reply.code(404).send({ error: 'Calendário não encontrado' })
    const b = (req.body as any) || {}
    const data: any = {}
    for (const k of ['name', 'timezone', 'weekdayHours', 'holidays']) if (k in b) data[k] = b[k]
    const calendar = await prisma.helpdeskBusinessCalendar.update({ where: { id }, data })
    return { calendar }
  })

  // DELETE /api/admin/helpdesk/calendars/:id ──
  app.delete('/api/admin/helpdesk/calendars/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    await prisma.helpdeskBusinessCalendar.delete({ where: { id } }).catch(() => null)
    return reply.send({ ok: true })
  })

  // ════════════════════ AUTOMAÇÃO: MACROS / TRIGGERS / AUTOMATIONS ════════════════════

  // ── Macros ──
  app.get('/api/admin/helpdesk/macros', { preHandler: authMiddleware }, async () => ({ macros: await prisma.helpdeskMacro.findMany({ orderBy: { name: 'asc' } }) }))
  app.post('/api/admin/helpdesk/macros', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    if (!b.name) return reply.code(400).send({ error: 'name obrigatório' })
    const macro = await prisma.helpdeskMacro.create({ data: { name: String(b.name).slice(0, 120), actions: b.actions ?? {}, replyTemplate: b.replyTemplate ?? null, active: b.active !== false } })
    return reply.code(201).send({ macro })
  })
  app.put('/api/admin/helpdesk/macros/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    if (!await prisma.helpdeskMacro.findUnique({ where: { id } })) return reply.code(404).send({ error: 'Macro não encontrada' })
    const b = (req.body as any) || {}
    const data: any = {}
    for (const k of ['name', 'actions', 'replyTemplate', 'active']) if (k in b) data[k] = b[k]
    return { macro: await prisma.helpdeskMacro.update({ where: { id }, data }) }
  })
  app.delete('/api/admin/helpdesk/macros/:id', { preHandler: authMiddleware }, async (req) => {
    await prisma.helpdeskMacro.delete({ where: { id: Number((req.params as any).id) } }).catch(() => null)
    return { ok: true }
  })

  // POST /tickets/:id/apply-macro ── Aplica ações da macro e devolve o texto de resposta p/ o compositor ──
  app.post('/api/helpdesk/tickets/:id/apply-macro', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const ticket = await prisma.helpdeskTicket.findUnique({ where: { id } })
    if (!ticket) return reply.code(404).send({ error: 'Chamado não encontrado' })
    const macro = await prisma.helpdeskMacro.findUnique({ where: { id: Number((req.body as any)?.macroId) } })
    if (!macro || !macro.active) return reply.code(404).send({ error: 'Macro não encontrada' })
    const op = getOperator(req)
    // Aplica as ações da macro EXCETO a resposta (esta volta para o compositor p/ revisão).
    const { reply: _r, ...actions } = (macro.actions as any) || {}
    await applyTicketActions(id, actions, { userId: op.userId, userName: op.userName })
    await prisma.helpdeskMacro.update({ where: { id: macro.id }, data: { usageCount: { increment: 1 } } })
    const replyText = macro.replyTemplate ? renderTemplate(macro.replyTemplate, { number: ticket.number, subject: ticket.subject, requesterName: ticket.requesterName }) : ''
    const updated = await prisma.helpdeskTicket.findUnique({ where: { id } })
    return { ticket: updated, replyText }
  })

  // ── Triggers ──
  app.get('/api/admin/helpdesk/triggers', { preHandler: authMiddleware }, async () => ({ triggers: await prisma.helpdeskTrigger.findMany({ orderBy: { order: 'asc' } }) }))
  app.post('/api/admin/helpdesk/triggers', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    if (!b.name || !b.event) return reply.code(400).send({ error: 'name e event obrigatórios' })
    const trigger = await prisma.helpdeskTrigger.create({ data: { name: String(b.name).slice(0, 120), event: b.event, conditions: b.conditions ?? {}, actions: b.actions ?? {}, active: b.active !== false, order: Number(b.order) || 0 } })
    return reply.code(201).send({ trigger })
  })
  app.put('/api/admin/helpdesk/triggers/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    if (!await prisma.helpdeskTrigger.findUnique({ where: { id } })) return reply.code(404).send({ error: 'Trigger não encontrado' })
    const b = (req.body as any) || {}
    const data: any = {}
    for (const k of ['name', 'event', 'conditions', 'actions', 'active', 'order']) if (k in b) data[k] = b[k]
    return { trigger: await prisma.helpdeskTrigger.update({ where: { id }, data }) }
  })
  app.delete('/api/admin/helpdesk/triggers/:id', { preHandler: authMiddleware }, async (req) => {
    await prisma.helpdeskTrigger.delete({ where: { id: Number((req.params as any).id) } }).catch(() => null)
    return { ok: true }
  })

  // ── Automations ──
  app.get('/api/admin/helpdesk/automations', { preHandler: authMiddleware }, async () => ({ automations: await prisma.helpdeskAutomation.findMany({ orderBy: { name: 'asc' } }) }))
  app.post('/api/admin/helpdesk/automations', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    if (!b.name) return reply.code(400).send({ error: 'name obrigatório' })
    const automation = await prisma.helpdeskAutomation.create({ data: { name: String(b.name).slice(0, 120), conditions: b.conditions ?? {}, actions: b.actions ?? {}, active: b.active !== false } })
    return reply.code(201).send({ automation })
  })
  app.put('/api/admin/helpdesk/automations/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    if (!await prisma.helpdeskAutomation.findUnique({ where: { id } })) return reply.code(404).send({ error: 'Automação não encontrada' })
    const b = (req.body as any) || {}
    const data: any = {}
    for (const k of ['name', 'conditions', 'actions', 'active']) if (k in b) data[k] = b[k]
    return { automation: await prisma.helpdeskAutomation.update({ where: { id }, data }) }
  })
  app.delete('/api/admin/helpdesk/automations/:id', { preHandler: authMiddleware }, async (req) => {
    await prisma.helpdeskAutomation.delete({ where: { id: Number((req.params as any).id) } }).catch(() => null)
    return { ok: true }
  })

  // ════════════════════ INTELIGÊNCIA ARTIFICIAL (F12) ════════════════════
  app.get('/api/helpdesk/ai/status', { preHandler: authMiddleware }, async () => ({ configured: await aiConfigured() }))

  // POST /tickets/:id/ai/triage ── Sugere prioridade/tipo/sentimento (não aplica) ──
  app.post('/api/helpdesk/tickets/:id/ai/triage', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    if (!await aiConfigured()) return reply.code(503).send({ error: 'IA não configurada (Configurações › APIs)' })
    try { return await aiTriage(id) } catch (e) { return reply.code(502).send({ error: 'Falha na IA: ' + (e as Error).message }) }
  })

  // POST /tickets/:id/ai/suggest-reply ── Rascunho de resposta p/ o compositor ──
  app.post('/api/helpdesk/tickets/:id/ai/suggest-reply', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    if (!await aiConfigured()) return reply.code(503).send({ error: 'IA não configurada (Configurações › APIs)' })
    try { return await aiSuggestReply(id) } catch (e) { return reply.code(502).send({ error: 'Falha na IA: ' + (e as Error).message }) }
  })

  // POST /tickets/:id/ai/summarize ── Resumo do chamado (TL;DR) ──
  app.post('/api/helpdesk/tickets/:id/ai/summarize', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    if (!await aiConfigured()) return reply.code(503).send({ error: 'IA não configurada (Configurações › APIs)' })
    try { return await aiSummarize(id) } catch (e) { return reply.code(502).send({ error: 'Falha na IA: ' + (e as Error).message }) }
  })

  // POST /tickets/:id/ai/triage-apply ── Triagem da IA aplicada (prioridade+tipo) ──
  app.post('/api/helpdesk/tickets/:id/ai/triage-apply', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    if (!await prisma.helpdeskTicket.findUnique({ where: { id }, select: { id: true } })) return reply.code(404).send({ error: 'Chamado não encontrado' })
    if (!await aiConfigured()) return reply.code(503).send({ error: 'IA não configurada (Configurações › APIs)' })
    try {
      const t = await aiTriage(id)
      const op = getOperator(req)
      await applyTicketActions(id, { setPriority: t.priority, setType: t.type }, { userId: op.userId, userName: op.userName })
      await logTicketEvent({ ticketId: id, type: 'ai_triage_applied', title: `IA aplicou triagem: ${t.priority}/${t.type} (${t.sentiment})`, userId: op.userId, userName: op.userName, actorType: 'agent' })
      const ticket = await prisma.helpdeskTicket.findUnique({ where: { id } })
      return { applied: { priority: t.priority, type: t.type }, sentiment: t.sentiment, summary: t.summary, ticket }
    } catch (e) { return reply.code(502).send({ error: 'Falha na IA: ' + (e as Error).message }) }
  })

  // POST /tickets/:id/ai/suggest-macro ── Sugere a melhor macro ──
  app.post('/api/helpdesk/tickets/:id/ai/suggest-macro', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    if (!await aiConfigured()) return reply.code(503).send({ error: 'IA não configurada (Configurações › APIs)' })
    try { return await aiSuggestMacro(id) } catch (e) { return reply.code(502).send({ error: 'Falha na IA: ' + (e as Error).message }) }
  })

  // POST /tickets/:id/qa ── Auditoria de qualidade (QA) por IA ──
  app.post('/api/helpdesk/tickets/:id/qa', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const ticket = await prisma.helpdeskTicket.findUnique({ where: { id }, select: { id: true, assignedUserId: true } })
    if (!ticket) return reply.code(404).send({ error: 'Chamado não encontrado' })
    if (!await aiConfigured()) return reply.code(503).send({ error: 'IA não configurada (Configurações › APIs)' })
    try {
      const r = await aiQaTicket(id)
      const op = getOperator(req)
      const review = await prisma.helpdeskQaReview.upsert({
        where: { ticketId: id },
        create: { ticketId: id, score: r.score, tone: r.tone, strengths: r.strengths, weaknesses: r.weaknesses, summary: r.summary, agentUserId: ticket.assignedUserId, autoGenerated: true },
        update: { score: r.score, tone: r.tone, strengths: r.strengths, weaknesses: r.weaknesses, summary: r.summary },
      })
      await logTicketEvent({ ticketId: id, type: 'qa_reviewed', title: `QA: nota ${r.score ?? '—'}/100 (${r.tone ?? '—'})`, userId: op.userId, userName: op.userName, actorType: 'agent' })
      return { review }
    } catch (e) { return reply.code(502).send({ error: 'Falha na IA: ' + (e as Error).message }) }
  })

  // GET /admin/helpdesk/qa/stats ── Médias de QA por agente ──
  app.get('/api/admin/helpdesk/qa/stats', { preHandler: authMiddleware }, async (req) => {
    const { range, from, to } = resolveHelpdeskPeriod(req.query)
    const reviews = await prisma.helpdeskQaReview.findMany({ where: { createdAt: { gte: from, lte: to }, score: { not: null } }, select: { score: true, agentUserId: true, tone: true } })
    const all = reviews.map((r) => r.score!).filter((s) => s != null)
    const avg = all.length ? Math.round(all.reduce((a, b) => a + b, 0) / all.length) : null
    const byAgentMap = new Map<number, number[]>()
    for (const r of reviews) { if (r.agentUserId == null) continue; const a = byAgentMap.get(r.agentUserId) || []; a.push(r.score!); byAgentMap.set(r.agentUserId, a) }
    const ids = [...byAgentMap.keys()]
    const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }) : []
    const umap = new Map(users.map((u) => [u.id, u.name || u.email]))
    const byAgent = ids.map((uid) => { const a = byAgentMap.get(uid)!; return { agentUserId: uid, name: umap.get(uid) || `#${uid}`, avg: Math.round(a.reduce((x, y) => x + y, 0) / a.length), count: a.length } }).sort((x, y) => y.avg - x.avg)
    return { range, reviewed: all.length, avg, byAgent }
  })

  // POST /ai/rewrite ── Reescreve/traduz um rascunho de resposta ──
  app.post('/api/helpdesk/ai/rewrite', { preHandler: authMiddleware }, async (req, reply) => {
    if (!await aiConfigured()) return reply.code(503).send({ error: 'IA não configurada (Configurações › APIs)' })
    const b = (req.body as any) || {}
    if (!b.text) return reply.code(400).send({ error: 'text obrigatório' })
    try { return await aiRewrite(b.text, b.mode || 'friendly') } catch (e) { return reply.code(502).send({ error: 'Falha na IA: ' + (e as Error).message }) }
  })

  // ════════════════════ LGPD: ANONIMIZAÇÃO (F14) ════════════════════
  // POST /api/admin/helpdesk/lgpd/anonymize { email } ── Redige o PII do solicitante ──
  app.post('/api/admin/helpdesk/lgpd/anonymize', { preHandler: authMiddleware }, async (req, reply) => {
    const email = ((req.body as any)?.email || '').toString().trim().toLowerCase()
    if (!email || !email.includes('@')) return reply.code(400).send({ error: 'E-mail inválido' })
    const op = getOperator(req)
    const tickets = await prisma.helpdeskTicket.findMany({ where: { requesterEmail: email }, select: { id: true } })
    if (tickets.length === 0) return { ok: true, tickets: 0, comments: 0 }
    const ids = tickets.map((t) => t.id)
    const redactedName = 'Titular anonimizado'
    const r1 = await prisma.helpdeskTicket.updateMany({ where: { id: { in: ids } }, data: { requesterName: redactedName, requesterEmail: null, requesterPhone: null, requesterLeadId: null } })
    // Anonimiza autoria dos comentários do solicitante (mantém o conteúdo da thread).
    const r2 = await prisma.helpdeskComment.updateMany({ where: { ticketId: { in: ids }, authorType: 'requester' }, data: { authorName: redactedName } })
    for (const id of ids) await logTicketEvent({ ticketId: id, type: 'lgpd_anonymized', title: 'Dados do solicitante anonimizados (LGPD)', userId: op.userId, userName: op.userName, actorType: 'agent' })
    return { ok: true, tickets: r1.count, comments: r2.count }
  })

  // ════════════════════ RELATÓRIOS & ANALYTICS (F11) ════════════════════
  app.get('/api/admin/helpdesk/reports', { preHandler: authMiddleware }, async (req) => {
    const p = resolveHelpdeskPeriod(req.query)
    return computeHelpdeskReport(p.range, { from: p.from, to: p.to })
  })

  // GET /api/admin/helpdesk/reports/export ── CSV dos chamados do período ──
  app.get('/api/admin/helpdesk/reports/export', { preHandler: authMiddleware }, async (req, reply) => {
    const { range, from, to } = resolveHelpdeskPeriod(req.query)
    const rows = await prisma.helpdeskTicket.findMany({ where: { createdAt: { gte: from, lte: to } }, orderBy: { number: 'asc' }, take: 10000, select: { number: true, subject: true, status: true, priority: true, channel: true, type: true, requesterEmail: true, createdAt: true, firstResponseAt: true, solvedAt: true, slaResolutionStatus: true } })
    const esc = (v: any) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
    const mins = (a: Date | null, b: Date) => a ? Math.round((a.getTime() - b.getTime()) / 60000) : ''
    const header = ['numero', 'assunto', 'status', 'prioridade', 'canal', 'tipo', 'solicitante', 'criado_em', 'min_1a_resposta', 'min_resolucao', 'sla_resolucao']
    const lines = [header.join(',')]
    for (const r of rows) lines.push([r.number, r.subject, r.status, r.priority, r.channel, r.type, r.requesterEmail || '', r.createdAt.toISOString(), mins(r.firstResponseAt, r.createdAt), mins(r.solvedAt, r.createdAt), r.slaResolutionStatus || ''].map(esc).join(','))
    reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="helpdesk-${range}.csv"`).send(lines.join('\n'))
  })

  // ════════════════════ IMPORTADOR Zendesk/Freshdesk (F26) ════════════════════

  // POST /import/upload ── Importa de uma EXPORTAÇÃO JSON colada/enviada ──
  // body: { source: 'zendesk'|'freshdesk', data: <export json>, dryRun?: boolean }
  app.post('/api/admin/helpdesk/import/upload', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    const source = b.source === 'freshdesk' ? 'freshdesk' : b.source === 'zendesk' ? 'zendesk' : null
    if (!source) return reply.code(400).send({ error: "source inválido (use 'zendesk' ou 'freshdesk')" })
    let data = b.data
    if (typeof data === 'string') { try { data = JSON.parse(data) } catch { return reply.code(400).send({ error: 'data não é JSON válido' }) } }
    if (!data || typeof data !== 'object') return reply.code(400).send({ error: 'data (exportação) obrigatório' })
    try {
      const normalized = parseExport(source, data)
      // Default seguro: dryRun=true (preview) a menos que o cliente envie dryRun:false.
      const report = await runImport(normalized, { dryRun: b.dryRun !== false })
      return { report, counts: importCounts(normalized) }
    } catch (e) { return reply.code(500).send({ error: (e as Error).message }) }
  })

  // POST /import/remote ── Importa direto da API do provedor ──
  // body: { source, credentials, dryRun?: boolean }
  //   zendesk: { subdomain, email, apiToken }   freshdesk: { domain, apiKey }
  app.post('/api/admin/helpdesk/import/remote', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    const source = b.source === 'freshdesk' ? 'freshdesk' : b.source === 'zendesk' ? 'zendesk' : null
    if (!source) return reply.code(400).send({ error: "source inválido" })
    const creds = b.credentials || {}
    if (source === 'zendesk' && !(creds.subdomain && creds.email && creds.apiToken)) return reply.code(400).send({ error: 'Informe subdomain, email e apiToken do Zendesk' })
    if (source === 'freshdesk' && !(creds.domain && creds.apiKey)) return reply.code(400).send({ error: 'Informe domain e apiKey do Freshdesk' })
    try {
      const raw = await fetchRemote(source, creds)
      const normalized = parseExport(source, raw)
      const report = await runImport(normalized, { dryRun: !!b.dryRun })
      return { report, counts: importCounts(normalized) }
    } catch (e) { return reply.code(502).send({ error: 'Falha ao buscar do provedor: ' + (e as Error).message }) }
  })

  // ════════════════════ CSAT: ESTATÍSTICAS (admin) ════════════════════
  app.get('/api/admin/helpdesk/csat/stats', { preHandler: authMiddleware }, async (req) => {
    const { range, from, to } = resolveHelpdeskPeriod(req.query)
    const period = { gte: from, lte: to }

    const [sent, responded, byRating, byAgent, recent] = await Promise.all([
      prisma.helpdeskSurvey.count({ where: { sentAt: period } }),
      prisma.helpdeskSurvey.findMany({ where: { sentAt: period, respondedAt: { not: null } }, select: { rating: true } }),
      prisma.helpdeskSurvey.groupBy({ by: ['rating'], where: { sentAt: period, respondedAt: { not: null } }, _count: { _all: true } }),
      prisma.helpdeskSurvey.groupBy({ by: ['agentUserId'], where: { sentAt: period, respondedAt: { not: null }, agentUserId: { not: null } }, _avg: { rating: true }, _count: { _all: true } }),
      prisma.helpdeskSurvey.findMany({ where: { sentAt: period, respondedAt: { not: null }, comment: { not: null } }, orderBy: { respondedAt: 'desc' }, take: 10, select: { rating: true, comment: true, respondedAt: true, ticketId: true } }),
    ])

    const ratings = responded.map((r) => r.rating || 0).filter(Boolean)
    const avg = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null
    // CSAT% = avaliações 4-5 sobre total respondido
    const positive = ratings.filter((r) => r >= 4).length
    const csatPct = ratings.length ? Math.round((positive / ratings.length) * 100) : null

    const agentIds = byAgent.map((a) => a.agentUserId!).filter(Boolean)
    const users = agentIds.length ? await prisma.user.findMany({ where: { id: { in: agentIds } }, select: { id: true, name: true, email: true } }) : []
    const userMap = new Map(users.map((u) => [u.id, u.name || u.email]))

    return {
      range, sent, responded: ratings.length, responseRate: sent ? Math.round((ratings.length / sent) * 100) : 0,
      avg, csatPct,
      distribution: [1, 2, 3, 4, 5].map((r) => ({ rating: r, count: byRating.find((b) => b.rating === r)?._count._all || 0 })),
      byAgent: byAgent.map((a) => ({ agentUserId: a.agentUserId, name: userMap.get(a.agentUserId!) || `#${a.agentUserId}`, avg: a._avg.rating, count: a._count._all })).sort((x, y) => (y.avg || 0) - (x.avg || 0)),
      recentComments: recent,
    }
  })

  // ════════════════════ RELACIONAMENTO ENTRE TICKETS (F10) ════════════════════

  // POST /tickets/:id/links ── Relaciona a outro chamado (por número) ──
  app.post('/api/helpdesk/tickets/:id/links', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const ticket = await prisma.helpdeskTicket.findUnique({ where: { id }, select: { id: true, number: true } })
    if (!ticket) return reply.code(404).send({ error: 'Chamado não encontrado' })
    const b = (req.body as any) || {}
    const type = LINK_TYPES.includes(b.type) ? b.type : 'related'
    const target = await prisma.helpdeskTicket.findUnique({ where: { number: Number(b.targetNumber) }, select: { id: true, number: true } })
    if (!target) return reply.code(404).send({ error: `Chamado #${b.targetNumber} não encontrado` })
    if (target.id === id) return reply.code(400).send({ error: 'Não é possível relacionar um chamado a ele mesmo' })
    const op = getOperator(req)
    const link = await prisma.helpdeskTicketLink.upsert({
      where: { ticketId_linkedTicketId_type: { ticketId: id, linkedTicketId: target.id, type } },
      create: { ticketId: id, linkedTicketId: target.id, type, createdById: op.userId ?? null, createdByName: op.userName ?? null },
      update: {},
    })
    await logTicketEvent({ ticketId: id, type: 'link_added', title: `Relacionado a #${target.number} (${type})`, userId: op.userId, userName: op.userName, actorType: 'agent' })
    return reply.code(201).send({ link })
  })

  // DELETE /tickets/:id/links/:linkId ──
  app.delete('/api/helpdesk/tickets/:id/links/:linkId', { preHandler: authMiddleware }, async (req) => {
    await prisma.helpdeskTicketLink.delete({ where: { id: Number((req.params as any).linkId) } }).catch(() => null)
    return { ok: true }
  })

  // POST /tickets/:id/merge ── Mescla este chamado em outro (move thread/anexos) ──
  app.post('/api/helpdesk/tickets/:id/merge', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const source = await prisma.helpdeskTicket.findUnique({ where: { id } })
    if (!source) return reply.code(404).send({ error: 'Chamado não encontrado' })
    const target = await prisma.helpdeskTicket.findUnique({ where: { number: Number((req.body as any)?.intoNumber) } })
    if (!target) return reply.code(404).send({ error: 'Chamado de destino não encontrado' })
    if (target.id === id) return reply.code(400).send({ error: 'Destino inválido' })
    const op = getOperator(req)

    await prisma.helpdeskComment.updateMany({ where: { ticketId: id }, data: { ticketId: target.id } })
    await prisma.helpdeskAttachment.updateMany({ where: { ticketId: id }, data: { ticketId: target.id } })
    await prisma.helpdeskComment.create({ data: { ticketId: target.id, authorType: 'system', authorName: op.userName ?? 'Sistema', visibility: 'internal', body: `Chamado #${source.number} mesclado neste.` } })
    await prisma.helpdeskTicketLink.create({ data: { ticketId: id, linkedTicketId: target.id, type: 'merged', createdById: op.userId ?? null, createdByName: op.userName ?? null } }).catch(() => null)
    // Encerra a origem
    await prisma.helpdeskTicket.update({ where: { id }, data: { status: 'closed', closedAt: new Date(), lastActivityAt: new Date() } })
    await logTicketEvent({ ticketId: id, type: 'merged', title: `Mesclado em #${target.number}`, userId: op.userId, userName: op.userName, actorType: 'agent' })
    await logTicketEvent({ ticketId: target.id, type: 'merge_received', title: `Recebeu a mescla de #${source.number}`, userId: op.userId, userName: op.userName, actorType: 'agent' })
    await prisma.helpdeskTicket.update({ where: { id: target.id }, data: { lastActivityAt: new Date() } })
    return { ok: true, intoNumber: target.number }
  })

  // POST /tickets/:id/follow-up ── Cria chamado de continuação ──
  app.post('/api/helpdesk/tickets/:id/follow-up', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const source = await prisma.helpdeskTicket.findUnique({ where: { id } })
    if (!source) return reply.code(404).send({ error: 'Chamado não encontrado' })
    const b = (req.body as any) || {}
    const op = getOperator(req)
    const created = await intakeTicket({
      subject: (b.subject || `Follow-up: ${source.subject}`).toString().slice(0, 255),
      description: b.description, channel: 'manual', priority: source.priority as any,
      requesterLeadId: source.requesterLeadId ?? undefined,
      requesterName: source.requesterName ?? undefined, requesterEmail: source.requesterEmail ?? undefined, requesterPhone: source.requesterPhone ?? undefined,
      createdById: op.userId, createdByName: op.userName, requesterAuthored: false,
    })
    await prisma.helpdeskTicketLink.create({ data: { ticketId: created.id, linkedTicketId: id, type: 'follow_up', createdById: op.userId ?? null, createdByName: op.userName ?? null } }).catch(() => null)
    await logTicketEvent({ ticketId: id, type: 'link_added', title: `Follow-up criado: #${created.number}`, userId: op.userId, userName: op.userName, actorType: 'agent' })
    return reply.code(201).send({ number: created.number, id: created.id })
  })

  // POST /tickets/:id/resolve-incidents ── (problema) resolve os incidentes vinculados ──
  app.post('/api/helpdesk/tickets/:id/resolve-incidents', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    if (!await prisma.helpdeskTicket.findUnique({ where: { id }, select: { id: true } })) return reply.code(404).send({ error: 'Chamado não encontrado' })
    const op = getOperator(req)
    // incidentes = links onde este ticket aponta com type 'incident', OU outros apontam com type 'problem'
    const [a, b] = await Promise.all([
      prisma.helpdeskTicketLink.findMany({ where: { ticketId: id, type: 'incident' }, select: { linkedTicketId: true } }),
      prisma.helpdeskTicketLink.findMany({ where: { linkedTicketId: id, type: 'problem' }, select: { ticketId: true } }),
    ])
    const incidentIds = Array.from(new Set([...a.map((x) => x.linkedTicketId), ...b.map((x) => x.ticketId)]))
    let resolved = 0
    for (const incId of incidentIds) {
      const inc = await prisma.helpdeskTicket.findUnique({ where: { id: incId }, select: { status: true } })
      if (!inc || TERMINAL_STATUSES.includes(inc.status as TicketStatus)) continue
      await prisma.helpdeskTicket.update({ where: { id: incId }, data: { status: 'solved', solvedAt: new Date(), lastActivityAt: new Date() } })
      await createSurveyOnSolve(incId)
      await logTicketEvent({ ticketId: incId, type: 'status_changed', title: 'Resolvido pelo problema vinculado', userId: op.userId, userName: op.userName, actorType: 'agent', newValue: 'solved' })
      resolved++
    }
    return { ok: true, resolved }
  })

  // ════════════════════ ORGANIZAÇÕES (B2B, F9) ════════════════════
  app.get('/api/admin/helpdesk/organizations', { preHandler: authMiddleware }, async () => {
    const organizations = await prisma.helpdeskOrganization.findMany({ orderBy: { name: 'asc' } })
    // contagem de chamados abertos por org
    const counts = await prisma.helpdeskTicket.groupBy({ by: ['organizationId'], where: { organizationId: { not: null }, status: { notIn: ['closed'] } }, _count: { _all: true } })
    const countMap = new Map(counts.map((c) => [c.organizationId, c._count._all]))
    return { organizations: organizations.map((o) => ({ ...o, openTickets: countMap.get(o.id) || 0 })) }
  })
  app.post('/api/admin/helpdesk/organizations', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    if (!b.name) return reply.code(400).send({ error: 'name obrigatório' })
    const domains = Array.isArray(b.domains) ? b.domains.map((d: string) => String(d).toLowerCase().trim()).filter(Boolean) : []
    const org = await prisma.helpdeskOrganization.create({ data: { name: String(b.name).slice(0, 150), domains, supportPlan: b.supportPlan ?? null, slaPolicyId: b.slaPolicyId != null ? Number(b.slaPolicyId) : null, notes: b.notes ?? null, active: b.active !== false } })
    return reply.code(201).send({ organization: org })
  })
  app.put('/api/admin/helpdesk/organizations/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    if (!await prisma.helpdeskOrganization.findUnique({ where: { id } })) return reply.code(404).send({ error: 'Organização não encontrada' })
    const b = (req.body as any) || {}
    const data: any = {}
    for (const k of ['name', 'supportPlan', 'notes', 'active']) if (k in b) data[k] = b[k]
    if ('domains' in b) data.domains = Array.isArray(b.domains) ? b.domains.map((d: string) => String(d).toLowerCase().trim()).filter(Boolean) : []
    if ('slaPolicyId' in b) data.slaPolicyId = b.slaPolicyId != null ? Number(b.slaPolicyId) : null
    return { organization: await prisma.helpdeskOrganization.update({ where: { id }, data }) }
  })
  app.delete('/api/admin/helpdesk/organizations/:id', { preHandler: authMiddleware }, async (req) => {
    const id = Number((req.params as any).id)
    await prisma.helpdeskTicket.updateMany({ where: { organizationId: id }, data: { organizationId: null } })
    await prisma.helpdeskOrganization.delete({ where: { id } }).catch(() => null)
    return { ok: true }
  })
  // Visão da organização: chamados + métricas
  app.get('/api/admin/helpdesk/organizations/:id/tickets', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const org = await prisma.helpdeskOrganization.findUnique({ where: { id } })
    if (!org) return reply.code(404).send({ error: 'Organização não encontrada' })
    const tickets = await prisma.helpdeskTicket.findMany({ where: { organizationId: id }, select: TICKET_LIST_SELECT, orderBy: { lastActivityAt: 'desc' }, take: 200 })
    const byStatus = await prisma.helpdeskTicket.groupBy({ by: ['status'], where: { organizationId: id }, _count: { _all: true } })
    return { organization: org, tickets, byStatus: byStatus.map((s) => ({ status: s.status, count: s._count._all })) }
  })

  // ════════════════════ WHATSAPP / CHAT → TICKET ════════════════════

  // POST /tickets/from-lead/:leadId ── Abre um chamado a partir de um lead/conversa ──
  app.post('/api/helpdesk/tickets/from-lead/:leadId', { preHandler: authMiddleware }, async (req, reply) => {
    const leadId = Number((req.params as any).leadId)
    const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, nome: true, email: true, whatsapp: true } })
    if (!lead) return reply.code(404).send({ error: 'Lead não encontrado' })
    const b = (req.body as any) || {}
    const op = getOperator(req)
    const ticket = await intakeTicket({
      subject: (b.subject || `Atendimento — ${lead.nome || lead.whatsapp || 'Lead'}`).toString().slice(0, 255),
      description: b.description,
      channel: 'whatsapp',
      priority: b.priority,
      type: b.type,
      requesterLeadId: lead.id,
      requesterName: lead.nome || null as any,
      requesterEmail: lead.email || null as any,
      requesterPhone: lead.whatsapp || null as any,
      createdById: op.userId,
      createdByName: op.userName,
      requesterAuthored: false,
    })
    return reply.code(201).send({ ticket })
  })

  // ════════════════════ CANAIS EXTERNOS (públicos) ════════════════════

  // POST /api/v1/helpdesk/tickets ── Criação via API pública (X-API-Key) ──
  app.post('/api/v1/helpdesk/tickets', { preHandler: requireApiKey('helpdesk:write') }, async (req, reply) => {
    const b = (req.body as any) || {}
    const subject = (b.subject || '').toString().trim()
    if (!subject) return reply.code(400).send({ error: 'subject é obrigatório' })
    if (b.priority && !TICKET_PRIORITIES.includes(b.priority)) return reply.code(400).send({ error: 'priority inválido' })
    if (b.type && !TICKET_TYPES.includes(b.type)) return reply.code(400).send({ error: 'type inválido' })
    const ticket = await intakeTicket({
      subject,
      description: b.description,
      channel: 'api',
      priority: b.priority,
      type: b.type,
      requesterName: b.requesterName,
      requesterEmail: b.requesterEmail,
      requesterPhone: b.requesterPhone,
    })
    return reply.code(201).send({ ticket: { id: ticket.id, number: ticket.number, status: ticket.status } })
  })

  // POST /api/v1/helpdesk/inbound-email ── Webhook de e-mail recebido (inbound parse) ──
  // Autentica por segredo próprio (Setting `helpdesk.inbound_email_secret`), via
  // header `x-inbound-secret` ou query `?secret=`. Compatível com Mailgun/SendGrid/Postmark.
  // Threading: extrai `#<protocolo>` do assunto → adiciona à thread; senão abre novo ticket.
  app.post('/api/v1/helpdesk/inbound-email', async (req, reply) => {
    const secretRow = await prisma.setting.findUnique({ where: { key: 'helpdesk.inbound_email_secret' } })
    const expected = secretRow?.value ? String((secretRow.value as any)).replace(/"/g, '') : ''
    const provided = (req.headers['x-inbound-secret'] as string) || (req.query as any)?.secret || ''
    if (!expected || provided !== expected) return reply.code(401).send({ error: 'Segredo de inbound inválido' })

    const b = (req.body as any) || {}
    const from = (b.from || b.sender || '').toString()
    const fromEmail = (from.match(/<([^>]+)>/)?.[1] || from).trim().toLowerCase()
    const fromName = (b.fromName || from.replace(/<[^>]+>/, '').trim() || fromEmail).toString().slice(0, 191)
    const subject = (b.subject || '(sem assunto)').toString()
    const body = (b.text || b.body || b.plain || '').toString().trim() || '(mensagem vazia)'

    // Threading por protocolo no assunto: "[#1003]" / "#1003".
    const m = subject.match(/#(\d{3,})/)
    if (m) {
      const number = Number(m[1])
      const existing = await prisma.helpdeskTicket.findUnique({ where: { number } })
      if (existing) {
        await prisma.helpdeskComment.create({
          data: { ticketId: existing.id, authorType: 'requester', authorName: fromName, visibility: 'public', channel: 'email', body },
        })
        const upd: any = { lastActivityAt: new Date() }
        // Resposta do solicitante reabre ticket resolvido.
        if (existing.status === 'solved') { upd.status = 'open'; upd.reopenCount = { increment: 1 }; upd.solvedAt = null }
        await prisma.helpdeskTicket.update({ where: { id: existing.id }, data: upd })
        await logTicketEvent({ ticketId: existing.id, type: 'comment_added', title: `Resposta por e-mail de ${fromName}`, actorType: 'requester' })
        await armNextResponseSla(existing.id).catch(() => {}) // F27 — cliente respondeu por e-mail
        await notifyTicketAgent(existing.id, 'customer_reply')
        return reply.code(200).send({ ok: true, ticketId: existing.id, threaded: true })
      }
    }

    // Novo ticket
    const ticket = await intakeTicket({
      subject: subject.replace(/^(re|fwd?):\s*/i, '').slice(0, 255) || '(sem assunto)',
      description: body,
      channel: 'email',
      requesterName: fromName,
      requesterEmail: fromEmail || undefined,
    })
    return reply.code(201).send({ ok: true, ticketId: ticket.id, number: ticket.number, threaded: false })
  })
}
