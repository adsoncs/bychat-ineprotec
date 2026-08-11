// src/routes/scheduledMessages.ts
// Mensagens agendadas do Conversas — criar, listar, cancelar, reagendar.
//
// O disparo em si é do scheduledMessageScheduler (tick de 60s). Aqui só se
// cuida do registro: quem pode agendar o quê, para quando, e como desmarcar.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware, type JwtPayload } from '../lib/auth.js'
import { canUserAccessLead } from '../lib/teamAccess.js'
import { logEvent, EVENT_TYPES, getIp, getOperator } from '../services/leadHistory.js'

/** Menor antecedência aceita. Abaixo disso o tick de 60s não daria conta e o
 *  operador teria a sensação de "agendei e não saiu". */
const MIN_ANTECEDENCIA_MS = 60_000
/** Teto de 1 ano — evita typo de ano (2027 → 2077) virar agendamento fantasma. */
const MAX_HORIZONTE_MS = 365 * 24 * 3600 * 1000

export async function scheduledMessagesRoutes(app: FastifyInstance) {
  // ── GET /api/atendimento/tickets/:leadId/scheduled — agendadas da conversa ──
  app.get('/api/atendimento/tickets/:leadId/scheduled', { preHandler: authMiddleware }, async (req, reply) => {
    const user = (req as any).user as JwtPayload
    const leadId = parseInt((req.params as any).leadId)
    if (!await canUserAccessLead(user.userId, user.role, leadId)) {
      return reply.code(403).send({ error: 'Sem permissão sobre este lead' })
    }
    const { status } = req.query as { status?: string }
    const items = await prisma.scheduledMessage.findMany({
      where: { leadId, ...(status ? { status } : {}) },
      orderBy: { scheduledAt: 'asc' },
      include: {
        template: { select: { id: true, name: true, shortcut: true } },
        createdBy: { select: { id: true, name: true, email: true } },
      },
    })
    return { items }
  })

  // ── POST /api/atendimento/tickets/:leadId/scheduled — agendar ──────────────
  app.post('/api/atendimento/tickets/:leadId/scheduled', { preHandler: authMiddleware }, async (req, reply) => {
    const user = (req as any).user as JwtPayload
    const leadId = parseInt((req.params as any).leadId)
    if (!await canUserAccessLead(user.userId, user.role, leadId)) {
      return reply.code(403).send({ error: 'Sem permissão sobre este lead' })
    }

    const { scheduledAt, kind, templateId, body, hsmPayload, channelId, cancelIfReplied } = req.body as any

    const quando = new Date(scheduledAt)
    if (isNaN(quando.getTime())) {
      return reply.code(400).send({ error: 'Data/hora inválida.' })
    }
    const emMs = quando.getTime() - Date.now()
    if (emMs < MIN_ANTECEDENCIA_MS) {
      return reply.code(400).send({ error: 'Escolha um horário pelo menos 1 minuto à frente.' })
    }
    if (emMs > MAX_HORIZONTE_MS) {
      return reply.code(400).send({ error: 'O agendamento não pode passar de 1 ano.' })
    }

    const tipo = kind === 'template_hsm' ? 'template_hsm' : 'text'

    if (tipo === 'template_hsm') {
      if (!hsmPayload?.name || !hsmPayload?.language) {
        return reply.code(400).send({ error: 'Modelo HSM inválido (name e language obrigatórios).' })
      }
    } else {
      // Texto: ou vem um template interno, ou vem corpo digitado.
      if (!templateId && !(body || '').trim()) {
        return reply.code(400).send({ error: 'Escreva a mensagem ou escolha um modelo.' })
      }
      if (templateId) {
        const tpl = await prisma.messageTemplate.findUnique({ where: { id: Number(templateId) }, select: { id: true, active: true } })
        if (!tpl || !tpl.active) return reply.code(400).send({ error: 'Modelo não encontrado ou inativo.' })
      }
    }

    // Número de envio: valida contra os canais que ESTE operador pode usar, e
    // contra o lock da conversa — as mesmas regras do envio manual. Sem isso, o
    // agendamento seria uma porta lateral para responder por outro número.
    const wp = await import('../services/whatsappProvider.js')
    const canais = await wp.resolveSenderChannels({ userId: user.userId, role: user.role })
    let canal = channelId ? canais.find((c: any) => c.id === channelId) : null
    if (channelId && !canal) {
      return reply.code(403).send({ error: 'Você não tem acesso a esse número de envio.' })
    }
    if (canal && !wp.canOverrideConversationChannel(user.role)) {
      const locked = await wp.lockedChannelForLead(leadId, { userId: user.userId, role: user.role })
      if (locked && locked.channelId !== canal.id) {
        const label = canais.find((c: any) => c.id === locked.channelId)
        return reply.code(409).send({
          error: `Esta conversa está em andamento pelo número ${label?.number || label?.label || locked.channelId}. O agendamento precisa sair por ele — é o número que o contato conhece.`,
          code: 'CHANNEL_LOCKED',
          lockedChannelId: locked.channelId,
        })
      }
    }
    // Sem escolha explícita, o aviso considera o número que a conversa usaria.
    if (!canal) {
      const sug = await wp.suggestChannelForLead(leadId, { userId: user.userId, role: user.role }).catch(() => null)
      canal = sug?.channelId ? canais.find((c: any) => c.id === sug.channelId) ?? null : null
    }

    // Aviso (não bloqueio) de janela de 24h. Só faz sentido na Cloud API: a
    // Evolution não tem janela. Antes o aviso saía em qualquer caso, com um "se
    // esta conversa sai pela Cloud API" que o operador não tinha como responder.
    let aviso: string | null = null
    if (tipo === 'text' && canal?.provider === 'cloud_api') {
      const win = await wp.getCloudWindowState(leadId).catch(() => null)
      const numero = canal.number || canal.label
      if (win && !win.open) {
        // Janela nunca abriu (ou já fechou): esperar não melhora nada — sem
        // `expiresAt` a checagem de "vai fechar antes da hora" não pegava este
        // caso, o mais comum de todos, e o agendamento nascia condenado.
        aviso = `A janela de 24h do número ${numero} está fechada — o contato não escreveu nas últimas 24h. Como ele é WhatsApp Oficial, uma mensagem de texto não será entregue no horário agendado; use um número Evolution ou um modelo aprovado (HSM).`
      } else if (win?.expiresAt && quando.getTime() > new Date(win.expiresAt).getTime()) {
        aviso = `No horário escolhido a janela de 24h já terá fechado para o número ${numero}. Como ele é WhatsApp Oficial, só um modelo aprovado (HSM) seria entregue — considere antecipar o horário ou agendar por um número Evolution.`
      }
    }

    const criada = await prisma.scheduledMessage.create({
      data: {
        leadId,
        scheduledAt: quando,
        kind: tipo,
        templateId: tipo === 'text' && templateId ? Number(templateId) : null,
        body: tipo === 'text' ? (body ?? null) : null,
        hsmPayload: tipo === 'template_hsm' ? hsmPayload : undefined,
        channelId: channelId ?? null,
        cancelIfReplied: cancelIfReplied !== false,
        createdByUserId: user.userId,
      },
      include: { template: { select: { id: true, name: true } } },
    })

    logEvent({
      leadId,
      type: EVENT_TYPES.MESSAGE_SENT,
      category: 'communication',
      title: `Mensagem agendada para ${quando.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
      channel: 'whatsapp',
      source: 'panel',
      ...getOperator(req),
      description: (body || criada.template?.name || '').substring(0, 200),
      metadata: { scheduledMessageId: criada.id, kind: tipo, scheduledAt: quando.toISOString() },
      ipAddress: getIp(req),
    } as any)

    return { item: criada, ...(aviso ? { aviso } : {}) }
  })

  // ── PUT /api/atendimento/scheduled/:id — reagendar/editar (só pendente) ────
  app.put('/api/atendimento/scheduled/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const user = (req as any).user as JwtPayload
    const id = parseInt((req.params as any).id)
    const sm = await prisma.scheduledMessage.findUnique({ where: { id } })
    if (!sm) return reply.code(404).send({ error: 'Agendamento não encontrado' })
    if (!await canUserAccessLead(user.userId, user.role, sm.leadId)) {
      return reply.code(403).send({ error: 'Sem permissão sobre este lead' })
    }
    if (sm.status !== 'pending') {
      return reply.code(409).send({ error: `Este agendamento já está como "${sm.status}" e não pode mais ser alterado.` })
    }

    const { scheduledAt, body, cancelIfReplied } = req.body as any
    const data: any = {}
    if (scheduledAt !== undefined) {
      const quando = new Date(scheduledAt)
      if (isNaN(quando.getTime())) return reply.code(400).send({ error: 'Data/hora inválida.' })
      const emMs = quando.getTime() - Date.now()
      if (emMs < MIN_ANTECEDENCIA_MS) return reply.code(400).send({ error: 'Escolha um horário pelo menos 1 minuto à frente.' })
      if (emMs > MAX_HORIZONTE_MS) return reply.code(400).send({ error: 'O agendamento não pode passar de 1 ano.' })
      data.scheduledAt = quando
    }
    if (body !== undefined) data.body = body
    if (cancelIfReplied !== undefined) data.cancelIfReplied = !!cancelIfReplied

    const item = await prisma.scheduledMessage.update({ where: { id }, data })
    return { item }
  })

  // ── DELETE /api/atendimento/scheduled/:id — cancelar ───────────────────────
  // Não apaga a linha: o histórico de "ia sair e foi cancelada" é justamente o
  // que explica, depois, por que a mensagem nunca chegou.
  app.delete('/api/atendimento/scheduled/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const user = (req as any).user as JwtPayload
    const id = parseInt((req.params as any).id)
    const sm = await prisma.scheduledMessage.findUnique({ where: { id } })
    if (!sm) return reply.code(404).send({ error: 'Agendamento não encontrado' })
    if (!await canUserAccessLead(user.userId, user.role, sm.leadId)) {
      return reply.code(403).send({ error: 'Sem permissão sobre este lead' })
    }
    if (sm.status !== 'pending') {
      return reply.code(409).send({ error: `Este agendamento já está como "${sm.status}".` })
    }

    const item = await prisma.scheduledMessage.update({
      where: { id },
      data: { status: 'canceled', canceledByUserId: user.userId },
    })

    logEvent({
      leadId: sm.leadId,
      type: EVENT_TYPES.MESSAGE_SENT,
      category: 'communication',
      title: 'Mensagem agendada cancelada',
      channel: 'whatsapp',
      source: 'panel',
      ...getOperator(req),
      metadata: { scheduledMessageId: id },
      ipAddress: getIp(req),
    } as any)

    return { item }
  })

  // ── GET /api/atendimento/scheduled — todas as pendentes do operador ────────
  // Alimenta um badge/lista "minhas mensagens agendadas" fora da conversa.
  app.get('/api/atendimento/scheduled', { preHandler: authMiddleware }, async (req) => {
    const user = (req as any).user as JwtPayload
    const items = await prisma.scheduledMessage.findMany({
      where: { status: 'pending', createdByUserId: user.userId },
      orderBy: { scheduledAt: 'asc' },
      take: 100,
      include: {
        lead: { select: { id: true, nome: true, whatsapp: true } },
        template: { select: { id: true, name: true } },
      },
    })
    return { items }
  })
}
