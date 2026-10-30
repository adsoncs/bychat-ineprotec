// src/routes/activities.ts
// CRUD de atividades agendadas (WhatsApp, email, SMS, ligação, reunião, tarefa, nota)

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware, type JwtPayload } from '../lib/auth.js'
import { logEvent, EVENT_TYPES, getIp, getOperator } from '../services/leadHistory.js'
import { markFirstResponseIfNeeded } from '../services/routing/helpers.js'
import { replaceVariables, buildLeadVars } from './templates.js'
import { getEmailConfig, getFromAddress, getReplyTo, registrarEnvioDeEmail } from '../services/notify.js'
import { getBranding } from '../lib/branding.js'
import { canUserAccessLead, type AccessRole } from '../lib/teamAccess.js'
import { validarEnvioWhatsapp, enviarAtividadeWhatsapp, temEnvioWhatsapp, migrarAgendadasAntigas, type MetaEnvioWhatsapp } from '../services/atividadeWhatsapp.js'
import { OPEN_ACTIVITY_STATUSES, whereActivityOpen, whereActivityOverdue, whereActivityOwnedBy, whereActivityUnowned, whereActivityVisibleTo, canUserSeeActivity } from '../lib/activityStatus.js'

const ACTIVITY_TYPES = ['whatsapp', 'email', 'sms', 'call', 'meeting', 'task', 'note', 'follow_up']
const ACTIVITY_STATUSES = ['pending', 'completed', 'cancelled', 'overdue', 'sent', 'failed']
// 'sending' é interno: a atividade foi tomada pelo executor e está saindo.
// Ninguém grava esse status pela API.

export async function activitiesRoutes(app: FastifyInstance) {

  // ── POST /api/activities — Criar atividade ──
  app.post('/api/activities', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const body = req.body as any
      const user = (req as any).user as JwtPayload

      if (!body.leadId || !body.type || !body.title || !body.scheduledAt) {
        return reply.code(400).send({ error: 'leadId, type, title e scheduledAt sao obrigatorios' })
      }

      if (!ACTIVITY_TYPES.includes(body.type)) {
        return reply.code(400).send({ error: `Tipo invalido. Use: ${ACTIVITY_TYPES.join(', ')}` })
      }

      // Verifica se lead existe
      const lead = await prisma.lead.findUnique({ where: { id: body.leadId }, select: { id: true, whatsapp: true, email: true, empresa: true } })
      if (!lead) return reply.code(404).send({ error: 'Lead nao encontrado' })

      // Se template selecionado, substituir variaveis
      let messageBody = body.messageBody || null
      let messageSubject = body.messageSubject || null
      let bodyHtml = body.bodyHtml || null

      if (body.templateId) {
        const template = await prisma.messageTemplate.findUnique({ where: { id: body.templateId } })
        if (template) {
          const vars = buildLeadVars(lead, user.name || user.email)
          if (!messageBody) messageBody = replaceVariables(template.body, vars)
          if (!messageSubject && template.subject) messageSubject = replaceVariables(template.subject, vars)
          if (!bodyHtml && template.bodyHtml) bodyHtml = replaceVariables(template.bodyHtml, vars)

          // Increment usage count
          prisma.messageTemplate.update({ where: { id: template.id }, data: { usageCount: { increment: 1 } } }).catch(() => {})
        }
      }

      // WhatsApp com mensagem = envio de verdade: número e janela de 24h são
      // validados AGORA, para o erro aparecer a quem agenda e não no histórico.
      const hsmPayload = body.kind === 'template_hsm' ? body.hsmPayload : null
      let envioWhatsapp: MetaEnvioWhatsapp | null = null
      if (temEnvioWhatsapp({ type: body.type, messageBody, attachmentUrl: body.attachmentUrl, metadata: { kind: body.kind, hsmPayload } })) {
        if (hsmPayload && (!hsmPayload.name || !hsmPayload.language)) {
          return reply.code(400).send({ error: 'Modelo aprovado inválido (name e language obrigatórios).' })
        }
        if (!(await canUserAccessLead(user.userId, user.role as AccessRole, body.leadId))) {
          return reply.code(403).send({ error: 'Sem permissão sobre este lead' })
        }
        const v = await validarEnvioWhatsapp({
          leadId: body.leadId, user: { userId: user.userId, role: user.role },
          channelId: body.channelId ?? null, kind: hsmPayload ? 'template_hsm' : 'text',
          scheduledAt: new Date(body.scheduledAt),
        })
        if (!v.ok) return reply.code(v.status).send({ error: v.error, code: v.code, lockedChannelId: v.lockedChannelId })
        envioWhatsapp = {
          channelId: v.channelId,
          cancelIfReplied: body.cancelIfReplied !== false,
          kind: hsmPayload ? 'template_hsm' : 'text',
          ...(hsmPayload ? { hsmPayload } : {}),
        }
      }

      const activity = await prisma.activity.create({
        data: {
          leadId: body.leadId,
          userId: user.userId,
          userName: user.name || user.email,
          type: body.type,
          title: body.title,
          description: body.description || null,
          status: 'pending',
          scheduledAt: new Date(body.scheduledAt),
          reminderAt: body.reminderAt ? new Date(body.reminderAt) : null,
          recipientPhone: body.recipientPhone || lead.whatsapp || null,
          recipientEmail: body.recipientEmail || lead.email || null,
          messageBody: messageBody,
          messageSubject: messageSubject,
          templateId: body.templateId || null,
          // Módulo Resumo: responsável pela EXECUÇÃO. Sem nada informado, cai em
          // quem criou — comportamento de antes do módulo, preservado.
          assignedUserId: body.assignedUserId ?? user.userId,
          assignedTeamId: body.assignedTeamId ?? null,
          attachmentUrl: body.attachmentUrl || null,
          attachmentName: body.attachmentName || null,
          attachmentType: body.attachmentType || null,
          // notifyLead: opt-in do operador para avisar o lead (convite Google + WhatsApp).
          // Default OFF — só notifica se vier true explícito do painel.
          // recordMeeting: opt-OUT de gravação por reunião (F0.5). Grava false só na
          // recusa explícita; ausência = segue a policy do tenant (shouldRecordMeeting).
          metadata: { ...(body.metadata || {}), ...(envioWhatsapp || {}), bodyHtml: bodyHtml || undefined, notifyLead: body.notifyLead === true ? true : undefined, recordMeeting: body.recordMeeting === false ? false : undefined },
        }
      })

      logEvent({
        leadId: body.leadId,
        type: 'activity_created',
        category: 'operator',
        title: `Atividade agendada: ${body.type} - ${body.title}`,
        source: 'panel',
        ...getOperator(req),
        description: `${body.type} agendado para ${new Date(body.scheduledAt).toLocaleString('pt-BR')}`,
        metadata: { activityId: activity.id, type: body.type, scheduledAt: body.scheduledAt },
        ipAddress: getIp(req),
      })

      // Sync to Google Calendar + Google Tasks (fire-and-forget)
      import('../services/googleCalendarSync.js').then(m => m.syncActivityToCalendar(activity.id)).catch(() => {})
      import('../routes/googleTasks.js').then(m => m.syncActivityToGoogleTasks(activity.id)).catch(() => {})

      return reply.code(201).send({ ok: true, activity })
    } catch (err: any) {
      app.log.error(`Activity create error: ${err.message}`)
      return reply.code(500).send({ error: err.message })
    }
  })

  // ── GET /api/activities — Listar atividades (global, com filtros) ──
  app.get('/api/activities', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const q = req.query as any
      const user = (req as any).user as JwtPayload
      const limit = Math.min(parseInt(q.limit) || 50, 200)
      const offset = parseInt(q.offset) || 0

      const where: any = {}
      // Filtros com OR (atrasada, responsável) entram aqui para não se sobrescreverem.
      const and: any[] = []
      // Alcance: agente só as suas, líder as do setor, admin todas.
      const visivel = await whereActivityVisibleTo(user.userId, user.role)
      if (visivel) and.push(visivel)
      if (q.status) where.status = q.status
      if (q.type) where.type = q.type
      if (q.leadId) where.leadId = parseInt(q.leadId)
      if (q.userId) where.userId = parseInt(q.userId)

      // Módulo Resumo: filtro por quem EXECUTA (não por quem criou). É o que
      // separa a fila da Secretaria da fila do Comercial quando o handoff é
      // feito por atividade. `assignedTeamId` sem `assignedUserId` = fila do
      // setor, sem dono — o operador puxa. Sem designado, vale quem criou e,
      // sem ninguém (Kommo, IA), o dono do lead — ver whereActivityOwnedBy.
      if (q.assignedUserId) and.push(whereActivityOwnedBy(parseInt(q.assignedUserId)))
      if (q.assignedTeamId) where.assignedTeamId = parseInt(q.assignedTeamId)
      if (q.unassigned === 'true') and.push(whereActivityUnowned)
      if (q.templateCode) where.templateCode = String(q.templateCode).toUpperCase()

      // Filtro rapido: hoje, semana, atrasadas, agendadas (amanha+), concluidas
      // ATENÇÃO: views 'today/week/upcoming' são períodos fixos por scheduledAt
      // e SOBRESCREVEM eventual from/to vindo do front (UX desabilita os pickers nessas views).
      if (q.view === 'today') {
        const start = new Date(); start.setHours(0,0,0,0)
        const end = new Date(); end.setHours(23,59,59,999)
        where.scheduledAt = { gte: start, lte: end }
      } else if (q.view === 'week') {
        const start = new Date(); start.setHours(0,0,0,0)
        const end = new Date(start.getTime() + 7 * 86400000)
        where.scheduledAt = { gte: start, lte: end }
      } else if (q.view === 'overdue') {
        // O scheduler grava 'overdue' 30 min depois do horário; antes disso
        // ela ainda está 'pending'. As duas contam como atrasadas.
        and.push(whereActivityOverdue())
      } else if (q.view === 'upcoming') {
        // Pendentes agendadas para AMANHA em diante (exclui hoje e atrasadas)
        const tomorrow = new Date(); tomorrow.setHours(0,0,0,0); tomorrow.setDate(tomorrow.getDate() + 1)
        where.status = { in: OPEN_ACTIVITY_STATUSES }
        where.scheduledAt = { gte: tomorrow }
      } else if (q.view === 'completed') {
        where.status = 'completed'
      }

      // Filtro de periodo custom — combina com views overdue/completed/sem view.
      // Em today/week/upcoming, ignorado (period fixo do KPI vence).
      const periodIgnoresCustom = q.view === 'today' || q.view === 'week' || q.view === 'upcoming'
      if (!periodIgnoresCustom && (q.from || q.to)) {
        const dateField = q.dateField === 'createdAt' ? 'createdAt' : 'scheduledAt'
        const existing = (where[dateField] as Record<string, Date> | undefined) || {}
        if (q.from) existing.gte = new Date(q.from)
        if (q.to) {
          const toDate = new Date(q.to)
          // Aceita formato YYYY-MM-DD (sem hora) e inclui o dia inteiro
          if (q.to.length === 10) toDate.setHours(23, 59, 59, 999)
          existing.lte = toDate
        }
        where[dateField] = existing
      }
      if (and.length) where.AND = and

      const [activities, total] = await Promise.all([
        prisma.activity.findMany({
          where,
          orderBy: { scheduledAt: 'asc' },
          take: limit,
          skip: offset,
          include: {
            lead: { select: { id: true, empresa: true, nome: true, whatsapp: true, email: true, status: true } },
            assignedUser: { select: { id: true, name: true, email: true } },
            assignedTeam: { select: { id: true, name: true, color: true } },
          }
        }),
        prisma.activity.count({ where })
      ])

      return { activities, total, limit, offset }
    } catch (err: any) {
      app.log.error(`Activities list error: ${err.message}`)
      return reply.code(500).send({ error: err.message })
    }
  })

  // ── GET /api/activities/summary — Resumo para dashboard ──
  app.get('/api/activities/summary', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const now = new Date()
      const todayStart = new Date(); todayStart.setHours(0,0,0,0)
      const todayEnd = new Date(); todayEnd.setHours(23,59,59,999)
      const weekEnd = new Date(todayStart.getTime() + 7 * 86400000)
      const user = (req as any).user as JwtPayload
      const visivel = await whereActivityVisibleTo(user.userId, user.role)
      const vis = (w: any) => (visivel ? { AND: [w, visivel] } : w)

      const [overdue, today, week, byType] = await Promise.all([
        prisma.activity.count({ where: vis(whereActivityOverdue(now)) }),
        prisma.activity.count({ where: vis({ ...whereActivityOpen, scheduledAt: { gte: todayStart, lte: todayEnd } }) }),
        prisma.activity.count({ where: vis({ ...whereActivityOpen, scheduledAt: { gte: todayStart, lte: weekEnd } }) }),
        prisma.activity.groupBy({ by: ['type'], where: vis(whereActivityOpen), _count: true }),
      ])

      return { overdue, today, week, byType: byType.map(t => ({ type: t.type, count: t._count })) }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // ── GET /api/leads/:id/activities — Atividades de um lead ──
  app.get('/api/leads/:id/activities', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const { id } = req.params as any
      // Isolamento per-agent: AGENT só vê leads dele (scope=own).
      {
        const _user = (req as any).user as { userId: number; role: string }
        const _ok = await canUserAccessLead(_user.userId, _user.role as AccessRole, parseInt(id))
        if (!_ok) return reply.code(403).send({ error: 'Sem permissão sobre este lead' })
      }
      const q = req.query as any
      const status = q.status || undefined

      const activities = await prisma.activity.findMany({
        where: { leadId: parseInt(id), ...(status ? { status } : {}) },
        orderBy: { scheduledAt: 'asc' },
        take: 100,
        include: {
          assignedUser: { select: { id: true, name: true, email: true } },
          assignedTeam: { select: { id: true, name: true, color: true } },
        },
      })

      return { activities }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // ── PUT /api/activities/:id — Atualizar atividade ──
  app.put('/api/activities/:id', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const { id } = req.params as any
      const body = req.body as any

      const existing = await prisma.activity.findUnique({ where: { id: parseInt(id) } })
      if (!existing) return reply.code(404).send({ error: 'Atividade nao encontrada' })
      {
        const _user = (req as any).user as JwtPayload
        if (!(await canUserSeeActivity(_user.userId, _user.role, parseInt(id)))) {
          return reply.code(403).send({ error: 'Sem permissão sobre esta atividade' })
        }
      }

      const mexeNoEnvio = ['messageBody', 'channelId', 'kind', 'hsmPayload', 'cancelIfReplied', 'attachmentUrl', 'scheduledAt']
        .some((k) => body[k] !== undefined)
      if (existing.type === 'whatsapp' && ['sent', 'sending'].includes(existing.status) && mexeNoEnvio) {
        return reply.code(409).send({ error: 'Esta mensagem já foi enviada (ou está saindo) e não pode mais ser alterada.' })
      }

      const data: any = {}
      if (body.title !== undefined) data.title = body.title
      if (body.description !== undefined) data.description = body.description
      if (body.scheduledAt !== undefined) data.scheduledAt = new Date(body.scheduledAt)
      if (body.reminderAt !== undefined) data.reminderAt = body.reminderAt ? new Date(body.reminderAt) : null
      if (body.messageBody !== undefined) data.messageBody = body.messageBody
      if (body.messageSubject !== undefined) data.messageSubject = body.messageSubject
      if (body.templateId !== undefined) data.templateId = body.templateId || null
      if (body.recipientPhone !== undefined) data.recipientPhone = body.recipientPhone
      if (body.recipientEmail !== undefined) data.recipientEmail = body.recipientEmail
      if (body.type !== undefined && ACTIVITY_TYPES.includes(body.type)) data.type = body.type
      if (body.attachmentUrl !== undefined) data.attachmentUrl = body.attachmentUrl
      if (body.attachmentName !== undefined) data.attachmentName = body.attachmentName
      if (body.attachmentType !== undefined) data.attachmentType = body.attachmentType
      // Repasse de atividade entre pessoas/setores (o "manda pro supervisor" do
      // processo). null é valor válido: devolve para a fila do setor.
      if (body.assignedUserId !== undefined) data.assignedUserId = body.assignedUserId
      if (body.assignedTeamId !== undefined) data.assignedTeamId = body.assignedTeamId

      if (body.status !== undefined && ACTIVITY_STATUSES.includes(body.status)) {
        data.status = body.status
        if (body.status === 'completed' && !existing.completedAt) {
          data.completedAt = new Date()
        }
      }

      if (body.result !== undefined) data.result = body.result

      // WhatsApp que vai ser ENVIADO: número e janela revalidados com os
      // valores finais (o que mudou por cima do que já estava gravado).
      const metaAtual = ((existing.metadata as any) || {}) as MetaEnvioWhatsapp
      const tipoFinal = data.type ?? existing.type
      const hsmFinal = body.kind !== undefined
        ? (body.kind === 'template_hsm' ? body.hsmPayload : null)
        : (metaAtual.kind === 'template_hsm' ? metaAtual.hsmPayload : null)
      const finalAtv = {
        type: tipoFinal,
        messageBody: data.messageBody !== undefined ? data.messageBody : existing.messageBody,
        attachmentUrl: data.attachmentUrl !== undefined ? data.attachmentUrl : existing.attachmentUrl,
        metadata: { kind: hsmFinal ? 'template_hsm' : 'text', hsmPayload: hsmFinal },
      }
      const statusFinal = data.status ?? existing.status
      if (mexeNoEnvio && ['pending', 'overdue', 'failed'].includes(statusFinal) && temEnvioWhatsapp(finalAtv)) {
        const _user = (req as any).user as JwtPayload
        const v = await validarEnvioWhatsapp({
          leadId: existing.leadId, user: { userId: _user.userId, role: _user.role },
          channelId: body.channelId !== undefined ? body.channelId : metaAtual.channelId,
          kind: hsmFinal ? 'template_hsm' : 'text',
          scheduledAt: data.scheduledAt ?? existing.scheduledAt,
        })
        if (!v.ok) return reply.code(v.status).send({ error: v.error, code: v.code, lockedChannelId: v.lockedChannelId })
        data.metadata = {
          ...metaAtual,
          channelId: v.channelId,
          cancelIfReplied: body.cancelIfReplied !== undefined ? body.cancelIfReplied !== false : metaAtual.cancelIfReplied !== false,
          kind: hsmFinal ? 'template_hsm' : 'text',
          hsmPayload: hsmFinal ?? undefined,
          attempts: 0,
        }
        // Falhou e foi corrigida: volta para a fila.
        if (statusFinal === 'failed' && data.status === undefined) data.status = 'pending'
      }

      // Reagendar uma atrasada para o futuro devolve ela para a fila de
      // pendentes; sem isso ela seguia "Atrasada" com data futura e sumia das
      // Próximas. O inverso (pendente para o passado) o scheduler resolve.
      if (data.scheduledAt && data.status === undefined && existing.status === 'overdue' && data.scheduledAt.getTime() > Date.now()) {
        data.status = 'pending'
      }

      const activity = await prisma.activity.update({
        where: { id: parseInt(id) },
        data,
      })

      // Se a atividade já tem evento no Google e o título/horário mudaram,
      // atualiza o evento (sem reenviar convite ao lead).
      const metaExisting = (existing.metadata as any) || {}
      if (metaExisting.googleCalendarEventId && (data.title !== undefined || data.scheduledAt !== undefined)) {
        import('../services/googleCalendarSync.js').then(m => m.updateActivityInCalendar(parseInt(id))).catch(() => {})
      }

      // Log se completou ou cancelou
      if (data.status && data.status !== existing.status) {
        logEvent({
          leadId: existing.leadId,
          type: data.status === 'completed' ? 'activity_completed' : 'activity_updated',
          category: 'operator',
          title: `Atividade ${data.status === 'completed' ? 'concluida' : data.status === 'cancelled' ? 'cancelada' : 'atualizada'}: ${existing.title}`,
          source: 'panel',
          ...getOperator(req),
          oldValue: existing.status,
          newValue: data.status,
          metadata: { activityId: existing.id, type: existing.type },
          ipAddress: getIp(req),
        })
      }

      // F10: ao concluir uma atividade, marca a primeira resposta do agente
      // atribuído no lead (idempotente — só seta se ainda for null).
      if (data.status === 'completed') {
        const operator = getOperator(req)
        if (operator.userId) {
          markFirstResponseIfNeeded(existing.leadId, operator.userId).catch((e) => {
            req.log.warn({ err: e }, '[routing/SLA] markFirstResponseIfNeeded falhou')
          })
        }
      }

      // E4: se Activity veio de cadência (metadata.cadenceEnrollmentId) e foi
      // marcada como completed, registra qual operador completou na CadenceStepExecution.
      // Permite drill-down "Por operador" no dashboard de métricas.
      if (data.status === 'completed' && existing.metadata) {
        const meta = existing.metadata as any
        const enrollmentId = typeof meta.cadenceEnrollmentId === 'number' ? meta.cadenceEnrollmentId : null
        if (enrollmentId) {
          const operator = getOperator(req)
          await prisma.cadenceStepExecution
            .updateMany({
              where: { activityId: existing.id, completedAt: null },
              data: {
                operatorUserId: operator.userId ?? null,
                completedAt: new Date(),
              },
            })
            .catch((err) => {
              app.log.error(`Falha ao linkar operador na CadenceStepExecution: ${err.message}`)
            })
        }
      }

      return { ok: true, activity }
    } catch (err: any) {
      app.log.error(`Activity update error: ${err.message}`)
      return reply.code(500).send({ error: err.message })
    }
  })

  // ── DELETE /api/activities/:id — Deletar atividade ──
  app.delete('/api/activities/:id', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const { id } = req.params as any
      const existing = await prisma.activity.findUnique({ where: { id: parseInt(id) } })
      if (!existing) return reply.code(404).send({ error: 'Atividade nao encontrada' })
      {
        const _user = (req as any).user as JwtPayload
        if (!(await canUserSeeActivity(_user.userId, _user.role, parseInt(id)))) {
          return reply.code(403).send({ error: 'Sem permissão sobre esta atividade' })
        }
      }

      const protectedStatuses = ['completed', 'sent']
      if (protectedStatuses.includes(existing.status)) {
        return reply.code(403).send({ error: 'Atividades já executadas não podem ser excluídas. Elas permanecem no histórico.' })
      }

      await prisma.activity.delete({ where: { id: parseInt(id) } })

      logEvent({
        leadId: existing.leadId,
        type: 'activity_deleted',
        category: 'operator',
        title: `Atividade removida: ${existing.title}`,
        source: 'panel',
        ...getOperator(req),
        metadata: { type: existing.type, scheduledAt: existing.scheduledAt.toISOString() },
        ipAddress: getIp(req),
      })

      return { ok: true }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // ── POST /api/activities/:id/execute — Executar atividade manualmente (enviar msg) ──
  app.post('/api/activities/:id/execute', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const { id } = req.params as any
      const activity = await prisma.activity.findUnique({
        where: { id: parseInt(id) },
        include: { lead: { select: { whatsapp: true, email: true, empresa: true } } }
      })
      if (!activity) return reply.code(404).send({ error: 'Atividade nao encontrada' })
      {
        const _user = (req as any).user as JwtPayload
        if (!(await canUserSeeActivity(_user.userId, _user.role, parseInt(id)))) {
          return reply.code(403).send({ error: 'Sem permissão sobre esta atividade' })
        }
      }

      if (temEnvioWhatsapp(activity)) {
        const _user = (req as any).user as JwtPayload
        if (['sent', 'sending'].includes(activity.status)) {
          return reply.code(409).send({ error: 'Esta mensagem já foi enviada.' })
        }
        // Toma a atividade antes de enviar: o executor de 1 minuto não pode
        // pegar a mesma ao mesmo tempo e mandar em dobro.
        const tomada = await prisma.activity.updateMany({ where: { id: activity.id, status: activity.status }, data: { status: 'sending' } })
        if (tomada.count !== 1) return reply.code(409).send({ error: 'Esta mensagem já está sendo enviada.' })
        const result = await enviarAtividadeWhatsapp(activity, { manual: { userId: _user.userId, role: _user.role } })
        const final = await prisma.activity.findUnique({ where: { id: activity.id }, select: { status: true } })
        if (final?.status !== 'sent') return reply.code(422).send({ error: result })
        return { ok: true, result }
      }

      const result = await executeActivity(activity, app)

      return { ok: true, result }
    } catch (err: any) {
      app.log.error(`Activity execute error: ${err.message}`)
      return reply.code(500).send({ error: err.message })
    }
  })
}

// ── Executor de atividades ──────────────────────────────

async function executeActivity(activity: any, app?: any): Promise<string> {
  const lead = activity.lead || await prisma.lead.findUnique({
    where: { id: activity.leadId },
    select: { id: true, whatsapp: true, email: true, empresa: true, nome: true, segmento: true, cidade: true, scores: true, maturidade: true, solucaoNome: true, status: true }
  })
  let result = ''

  try {
    if (activity.type === 'whatsapp' && temEnvioWhatsapp(activity)) {
      // Caminho único do envio de WhatsApp (número da conversa, janela, opt-out,
      // tiques). Ele mesmo grava o desfecho na atividade.
      return await enviarAtividadeWhatsapp(activity)
    } else if (activity.type === 'email') {
      const email = activity.recipientEmail || lead?.email
      if (!email) throw new Error('Email nao encontrado')

      const meta = (activity.metadata || {}) as any
      const htmlBody = meta.bodyHtml || activity.messageBody || ''
      const subject = activity.messageSubject || activity.title

      result = await sendEmailActivity(email, subject, htmlBody, activity.attachmentUrl, activity.attachmentName)

    } else if (activity.type === 'sms') {
      // Antes isto só marcava a atividade como "enviada" sem mandar nada.
      // Agora vai pelo provedor de Configurações → SMS (Comtele); falha de
      // verdade vira status 'failed' com o motivo, no catch abaixo.
      const phone = activity.recipientPhone || lead?.whatsapp
      if (!phone) throw new Error('Numero de telefone nao encontrado')
      if (!activity.messageBody?.trim()) throw new Error('Nenhuma mensagem para enviar')
      const optOut = activity.leadId ? await prisma.lead.findUnique({ where: { id: activity.leadId }, select: { optOutChannels: true } }) : null
      if (Array.isArray(optOut?.optOutChannels) && (optOut!.optOutChannels as string[]).includes('sms')) {
        throw new Error('Lead pediu para nao receber SMS')
      }
      const { sendSms } = await import('../services/smsProvider.js')
      const r = await sendSms({ to: phone, message: activity.messageBody })
      if (!r.ok) throw new Error(`SMS: ${r.error || 'falha no envio'}`)
      result = `SMS enviado${r.providerId ? ` (${r.providerId})` : ''}`
    } else {
      result = 'Atividade marcada como concluida'
    }

    await prisma.activity.update({
      where: { id: activity.id },
      data: { status: 'sent', completedAt: new Date(), result }
    })

    logEvent({
      leadId: activity.leadId,
      type: 'activity_executed',
      category: 'communication',
      title: `${activity.type} enviado: ${activity.title}`,
      channel: activity.type,
      source: 'system',
      actorType: 'system',
      description: result,
      metadata: { activityId: activity.id, type: activity.type, hasAttachment: !!activity.attachmentUrl },
    })

    return result
  } catch (err: any) {
    const errMsg = err.message || 'Erro desconhecido'
    await prisma.activity.update({
      where: { id: activity.id },
      data: { status: 'failed', result: errMsg }
    })
    if (app) app.log.error(`Activity execution failed #${activity.id}: ${errMsg}`)
    return `Falha: ${errMsg}`
  }
}

// ── Email: com suporte a HTML e anexos ──
async function sendEmailActivity(to: string, subject: string, html: string, attachmentUrl?: string | null, attachmentName?: string | null): Promise<string> {
  const cfg = await getEmailConfig()
  const brand = await getBranding()
  const provider = cfg['email.provider'] || 'resend'

  const fromAddress = getFromAddress(cfg)

  // Se nao tem HTML formatado, wrapa em template basico
  const isHtml = html.includes('<') && html.includes('>')
  const finalHtml = isHtml ? html : `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#333;white-space:pre-line">${html}</div>`

  // Se provider é SMTP, usa nodemailer
  if (provider === 'smtp') {
    const nodemailer = await import('nodemailer')
    const host = cfg['smtp.host']
    const port = parseInt(cfg['smtp.port'] || '587')
    const secure = cfg['smtp.secure'] === 'true'
    const user = cfg['smtp.user']
    const pass = cfg['smtp.pass']
    if (!host || !user || !pass) throw new Error('SMTP não configurado')

    const transporter = nodemailer.default.createTransport({ host, port, secure, auth: { user, pass } })
    const replyTo = getReplyTo(cfg)
    const mailOpts: any = { from: fromAddress, to, subject: subject || brand.brandName, html: finalHtml, ...(replyTo ? { replyTo } : {}) }

    if (attachmentUrl) {
      try {
        const fileResp = await fetch(attachmentUrl)
        if (fileResp.ok) {
          const buffer = Buffer.from(await fileResp.arrayBuffer())
          mailOpts.attachments = [{ filename: attachmentName || 'anexo', content: buffer }]
        }
      } catch (e) { console.warn('Erro ao baixar anexo para SMTP:', e) }
    }

    const id = await registrarEnvioDeEmail({ to, subject: mailOpts.subject, origem: 'atividade', provider, lancarSeBloqueado: true },
      async ({ headers }) => (await transporter.sendMail({ ...mailOpts, headers })).messageId || null)
    return id || 'smtp-sent'
  }

  // Resend
  const apiKey = cfg['notification.resend_api_key'] || process.env.RESEND_API_KEY
  if (!apiKey) throw new Error('RESEND_API_KEY nao configurada')

  const { Resend } = await import('resend')
  const resend = new Resend(apiKey)

  const emailOpts: any = {
    from: fromAddress,
    to,
    subject: subject || brand.brandName,
    html: finalHtml,
    ...(getReplyTo(cfg) ? { reply_to: getReplyTo(cfg) } : {}),
  }

  // Baixar e anexar arquivo se houver
  if (attachmentUrl) {
    try {
      const fileResp = await fetch(attachmentUrl)
      if (fileResp.ok) {
        const buffer = Buffer.from(await fileResp.arrayBuffer())
        emailOpts.attachments = [{
          filename: attachmentName || 'anexo',
          content: buffer,
        }]
      }
    } catch (err) {
      console.warn(`[Activity] Falha ao baixar anexo ${attachmentUrl}:`, err)
    }
  }

  // O SDK não lança em falha: devolve `error`. Sem esta checagem a atividade
  // saía como "enviada" com o e-mail recusado.
  await registrarEnvioDeEmail({ to, subject: emailOpts.subject, origem: 'atividade', provider, lancarSeBloqueado: true }, async ({ headers, tags }) => {
    const r: any = await resend.emails.send({ ...emailOpts, headers, tags })
    if (r?.error) throw new Error(`Resend: ${r.error.message || JSON.stringify(r.error)}`)
    return r?.data?.id || null
  })
  return `Email enviado para ${to}${attachmentUrl ? ' (com anexo)' : ''}`
}

// ── Scheduler (roda a cada minuto) ──────────────────────

export function startActivityScheduler(): void {
  setTimeout(async () => {
    // O agendador do Conversas virou atividade: o que ficou pendente na tabela
    // antiga vem para cá antes do primeiro ciclo.
    await migrarAgendadasAntigas().catch((e) => console.error('[Activities] migração dos agendamentos falhou:', e?.message || e))
    // Servidor caiu no meio de um envio: a atividade ficou em 'sending'. Não
    // dá para saber se saiu — vira falha com aviso, e a pessoa confere.
    await prisma.activity.updateMany({
      where: { status: 'sending' },
      data: { status: 'failed', result: 'Envio interrompido (o servidor reiniciou). Confira na conversa se a mensagem saiu antes de reenviar.' },
    }).catch(() => {})
    await processScheduledActivities()
    setInterval(processScheduledActivities, 60 * 1000)
    console.log('[Activities] Scheduler started — checking every 1min')
  }, 15000)
}

// Um ciclo por vez: um ciclo lento não pode se sobrepor ao seguinte e pegar
// a mesma mensagem duas vezes.
let processando = false

async function processScheduledActivities(): Promise<void> {
  if (processando) return
  processando = true
  try {
    const now = new Date()

    // 1. Marcar atividades atrasadas. Envio automático (whatsapp/email com
    // mensagem) fica de fora: quem decide o status dele é o executor abaixo
    // (sent/failed). Antes, com fila acumulada ou servidor parado por mais de
    // 30 min, a mensagem virava 'overdue' e nunca era enviada.
    await prisma.activity.updateMany({
      where: {
        status: 'pending',
        scheduledAt: { lt: new Date(now.getTime() - 30 * 60 * 1000) }, // 30min de tolerancia
        NOT: { type: { in: ['whatsapp', 'email'] }, messageBody: { not: null } },
      },
      data: { status: 'overdue' }
    })

    // 2. Executar atividades de envio automatico (whatsapp, email) no horario
    const toExecute = await prisma.activity.findMany({
      where: {
        status: 'pending',
        type: { in: ['whatsapp', 'email'] },
        scheduledAt: { lte: now },
        messageBody: { not: null },
      },
      include: { lead: { select: { whatsapp: true, email: true, empresa: true } } },
      take: 10, // processa 10 por vez
    })

    for (const activity of toExecute) {
      // Toma a atividade antes de enviar: o "Enviar agora" manual pode estar
      // pegando a mesma neste instante.
      if (temEnvioWhatsapp(activity)) {
        const tomada = await prisma.activity.updateMany({ where: { id: activity.id, status: 'pending' }, data: { status: 'sending' } })
        if (tomada.count !== 1) continue
      }
      await executeActivity(activity)
    }

    if (toExecute.length > 0) {
      console.log(`[Activities] Executed ${toExecute.length} scheduled activities`)
    }
  } catch (err) {
    console.error('[Activities] Scheduler error:', err)
  } finally {
    processando = false
  }
}
