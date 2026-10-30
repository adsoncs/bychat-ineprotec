// src/routes/scheduledMessages.ts
// Mensagens agendadas do Conversas — criar, listar, cancelar, reagendar.
//
// Desde 29/10/2026 o agendamento é uma ATIVIDADE de WhatsApp (módulo
// Atividades): um agendador só, visível no Atividades, e que envia pelo mesmo
// caminho do envio manual (services/atividadeWhatsapp.ts). Estas rotas mantêm
// os endereços e o formato que o Conversas já usava; por baixo, tudo é
// bychat_activities. A tabela antiga só guarda o histórico de antes.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware, type JwtPayload } from '../lib/auth.js'
import { canUserAccessLead } from '../lib/teamAccess.js'
import { logEvent, EVENT_TYPES, getIp, getOperator } from '../services/leadHistory.js'
import { validarEnvioWhatsapp, type MetaEnvioWhatsapp } from '../services/atividadeWhatsapp.js'

/** Menor antecedência aceita. Abaixo disso o ciclo de 60s não daria conta e o
 *  operador teria a sensação de "agendei e não saiu". */
const MIN_ANTECEDENCIA_MS = 60_000
/** Teto de 1 ano — evita typo de ano (2027 → 2077) virar agendamento fantasma. */
const MAX_HORIZONTE_MS = 365 * 24 * 3600 * 1000

/** Atividade → formato que o Conversas conhece. */
const STATUS_DA_TELA: Record<string, string> = { pending: 'pending', sending: 'pending', sent: 'sent', cancelled: 'canceled', failed: 'failed', completed: 'sent', overdue: 'pending' }
function paraItem(a: any) {
  const meta = (a.metadata || {}) as MetaEnvioWhatsapp
  return {
    id: a.id,
    leadId: a.leadId,
    scheduledAt: a.scheduledAt,
    status: STATUS_DA_TELA[a.status] ?? a.status,
    kind: meta.kind === 'template_hsm' ? 'template_hsm' : 'text',
    templateId: a.templateId ?? null,
    body: a.messageBody ?? null,
    channelId: meta.channelId ?? null,
    cancelIfReplied: meta.cancelIfReplied !== false,
    createdByUserId: a.userId ?? null,
    sentAt: a.status === 'sent' ? a.completedAt : null,
    errorMessage: ['failed', 'cancelled'].includes(a.status) ? a.result : null,
    template: meta.kind === 'template_hsm' && meta.hsmPayload ? { id: 0, name: meta.hsmPayload.name } : null,
    createdBy: a.userId ? { id: a.userId, name: a.userName ?? null, email: null } : null,
  }
}

function validarHorario(scheduledAt: unknown): { quando: Date } | { error: string } {
  const quando = new Date(scheduledAt as any)
  if (isNaN(quando.getTime())) return { error: 'Data/hora inválida.' }
  const emMs = quando.getTime() - Date.now()
  if (emMs < MIN_ANTECEDENCIA_MS) return { error: 'Escolha um horário pelo menos 1 minuto à frente.' }
  if (emMs > MAX_HORIZONTE_MS) return { error: 'O agendamento não pode passar de 1 ano.' }
  return { quando }
}

/** Só WhatsApp com conteúdo — lembrete "chamar no WhatsApp" não é envio. */
const ehEnvio = { type: 'whatsapp', messageBody: { not: null } } as const

export async function scheduledMessagesRoutes(app: FastifyInstance) {
  // ── GET /api/atendimento/tickets/:leadId/scheduled — agendadas da conversa ──
  app.get('/api/atendimento/tickets/:leadId/scheduled', { preHandler: authMiddleware }, async (req, reply) => {
    const user = (req as any).user as JwtPayload
    const leadId = parseInt((req.params as any).leadId)
    if (!await canUserAccessLead(user.userId, user.role, leadId)) {
      return reply.code(403).send({ error: 'Sem permissão sobre este lead' })
    }
    const { status } = req.query as { status?: string }
    const filtroStatus = status === 'pending' ? { status: { in: ['pending', 'sending'] } }
      : status === 'canceled' ? { status: 'cancelled' }
      : status ? { status } : {}
    const atividades = await prisma.activity.findMany({
      where: { leadId, ...ehEnvio, ...filtroStatus },
      orderBy: { scheduledAt: 'asc' },
      take: 100,
    })
    return { items: atividades.map(paraItem) }
  })

  // ── POST /api/atendimento/tickets/:leadId/scheduled — agendar ──────────────
  app.post('/api/atendimento/tickets/:leadId/scheduled', { preHandler: authMiddleware }, async (req, reply) => {
    const user = (req as any).user as JwtPayload
    const leadId = parseInt((req.params as any).leadId)
    if (!await canUserAccessLead(user.userId, user.role, leadId)) {
      return reply.code(403).send({ error: 'Sem permissão sobre este lead' })
    }

    const { scheduledAt, kind, templateId, body, hsmPayload, channelId, cancelIfReplied } = req.body as any
    const h = validarHorario(scheduledAt)
    if ('error' in h) return reply.code(400).send({ error: h.error })
    const quando = h.quando

    const tipo = kind === 'template_hsm' ? 'template_hsm' : 'text'
    let corpo: string | null = (body || '').trim() ? body : null
    if (tipo === 'template_hsm') {
      if (!hsmPayload?.name || !hsmPayload?.language) {
        return reply.code(400).send({ error: 'Modelo aprovado inválido (name e language obrigatórios).' })
      }
      // O corpo é a prévia legível do modelo — é o que fica no histórico.
      corpo = corpo ?? `[Modelo] ${hsmPayload.name}`
    } else {
      if (templateId && !corpo) {
        const tpl = await prisma.messageTemplate.findUnique({ where: { id: Number(templateId) }, select: { active: true, body: true } })
        if (!tpl || !tpl.active) return reply.code(400).send({ error: 'Modelo não encontrado ou inativo.' })
        corpo = tpl.body
      }
      if (!corpo) return reply.code(400).send({ error: 'Escreva a mensagem ou escolha um modelo.' })
    }

    const v = await validarEnvioWhatsapp({ leadId, user: { userId: user.userId, role: user.role }, channelId, kind: tipo, scheduledAt: quando })
    if (!v.ok) return reply.code(v.status).send({ error: v.error, code: v.code, lockedChannelId: v.lockedChannelId })

    const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { whatsapp: true } })
    const criada = await prisma.activity.create({
      data: {
        leadId,
        userId: user.userId,
        userName: user.name || user.email,
        assignedUserId: user.userId,
        type: 'whatsapp',
        title: tipo === 'template_hsm' ? `Modelo agendado: ${hsmPayload.name}` : 'Mensagem agendada',
        status: 'pending',
        scheduledAt: quando,
        recipientPhone: lead?.whatsapp ?? null,
        messageBody: corpo,
        templateId: tipo === 'text' && templateId ? Number(templateId) : null,
        metadata: {
          origem: 'conversas',
          channelId: v.channelId,
          cancelIfReplied: cancelIfReplied !== false,
          kind: tipo,
          ...(tipo === 'template_hsm' ? { hsmPayload } : {}),
        } as any,
      },
    })

    logEvent({
      leadId,
      type: EVENT_TYPES.MESSAGE_SENT,
      category: 'communication',
      title: `Mensagem agendada para ${quando.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
      channel: 'whatsapp',
      source: 'panel',
      ...getOperator(req),
      description: (corpo || '').substring(0, 200),
      metadata: { activityId: criada.id, kind: tipo, scheduledAt: quando.toISOString() },
      ipAddress: getIp(req),
    } as any)

    return { item: paraItem(criada) }
  })

  // ── PUT /api/atendimento/scheduled/:id — reagendar/editar (só pendente) ────
  app.put('/api/atendimento/scheduled/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const user = (req as any).user as JwtPayload
    const id = parseInt((req.params as any).id)
    const a = await prisma.activity.findUnique({ where: { id } })
    if (!a || a.type !== 'whatsapp') return reply.code(404).send({ error: 'Agendamento não encontrado' })
    if (!await canUserAccessLead(user.userId, user.role, a.leadId)) {
      return reply.code(403).send({ error: 'Sem permissão sobre este lead' })
    }
    if (a.status !== 'pending') {
      return reply.code(409).send({ error: 'Este agendamento já saiu da fila e não pode mais ser alterado.' })
    }

    const { scheduledAt, body, cancelIfReplied } = req.body as any
    const meta = ((a.metadata as any) || {}) as MetaEnvioWhatsapp
    const data: any = {}
    if (scheduledAt !== undefined) {
      const h = validarHorario(scheduledAt)
      if ('error' in h) return reply.code(400).send({ error: h.error })
      data.scheduledAt = h.quando
      const v = await validarEnvioWhatsapp({
        leadId: a.leadId, user: { userId: user.userId, role: user.role },
        channelId: meta.channelId, kind: meta.kind === 'template_hsm' ? 'template_hsm' : 'text', scheduledAt: h.quando,
      })
      if (!v.ok) return reply.code(v.status).send({ error: v.error, code: v.code })
    }
    if (body !== undefined) data.messageBody = body
    if (cancelIfReplied !== undefined) data.metadata = { ...meta, cancelIfReplied: !!cancelIfReplied }

    const item = await prisma.activity.update({ where: { id }, data })
    return { item: paraItem(item) }
  })

  // ── DELETE /api/atendimento/scheduled/:id — cancelar ───────────────────────
  // Não apaga: "ia sair e foi cancelada" é o que explica, depois, por que a
  // mensagem nunca chegou.
  app.delete('/api/atendimento/scheduled/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const user = (req as any).user as JwtPayload
    const id = parseInt((req.params as any).id)
    const a = await prisma.activity.findUnique({ where: { id } })
    if (!a || a.type !== 'whatsapp') return reply.code(404).send({ error: 'Agendamento não encontrado' })
    if (!await canUserAccessLead(user.userId, user.role, a.leadId)) {
      return reply.code(403).send({ error: 'Sem permissão sobre este lead' })
    }
    const r = await prisma.activity.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'cancelled', result: `Cancelada por ${user.name || user.email}` },
    })
    if (r.count !== 1) return reply.code(409).send({ error: 'Este agendamento já saiu da fila.' })

    logEvent({
      leadId: a.leadId,
      type: EVENT_TYPES.MESSAGE_SENT,
      category: 'communication',
      title: 'Mensagem agendada cancelada',
      channel: 'whatsapp',
      source: 'panel',
      ...getOperator(req),
      metadata: { activityId: id },
      ipAddress: getIp(req),
    } as any)

    const item = await prisma.activity.findUnique({ where: { id } })
    return { item: paraItem(item) }
  })

  // ── GET /api/atendimento/scheduled — todas as pendentes do operador ────────
  app.get('/api/atendimento/scheduled', { preHandler: authMiddleware }, async (req) => {
    const user = (req as any).user as JwtPayload
    const atividades = await prisma.activity.findMany({
      where: { ...ehEnvio, status: 'pending', userId: user.userId },
      orderBy: { scheduledAt: 'asc' },
      take: 100,
      include: { lead: { select: { id: true, nome: true, whatsapp: true } } },
    })
    return { items: atividades.map((a) => ({ ...paraItem(a), lead: a.lead })) }
  })
}
