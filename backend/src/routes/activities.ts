// src/routes/activities.ts
// CRUD de atividades agendadas (WhatsApp, email, SMS, ligação, reunião, tarefa, nota)

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware, type JwtPayload } from '../lib/auth.js'
import { logEvent, EVENT_TYPES, getIp, getOperator } from '../services/leadHistory.js'
import { markFirstResponseIfNeeded } from '../services/routing/helpers.js'
import { replaceVariables, buildLeadVars } from './templates.js'
import { getEmailConfig, getFromAddress } from '../services/notify.js'
import { getBranding } from '../lib/branding.js'
import { canUserAccessLead, type AccessRole } from '../lib/teamAccess.js'

const ACTIVITY_TYPES = ['whatsapp', 'email', 'sms', 'call', 'meeting', 'task', 'note', 'follow_up']
const ACTIVITY_STATUSES = ['pending', 'completed', 'cancelled', 'overdue', 'sent', 'failed']

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
          assignedUserId: body.assignedUserId ?? user.userId,
          assignedTeamId: body.assignedTeamId ?? null,
          attachmentUrl: body.attachmentUrl || null,
          attachmentName: body.attachmentName || null,
          attachmentType: body.attachmentType || null,
          // notifyLead: opt-in do operador para avisar o lead (convite Google + WhatsApp).
          // Default OFF — só notifica se vier true explícito do painel.
          // recordMeeting: opt-OUT de gravação por reunião (F0.5). Grava false só na
          // recusa explícita; ausência = segue a policy do tenant (shouldRecordMeeting).
          metadata: { ...(body.metadata || {}), bodyHtml: bodyHtml || undefined, notifyLead: body.notifyLead === true ? true : undefined, recordMeeting: body.recordMeeting === false ? false : undefined },
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
      const limit = Math.min(parseInt(q.limit) || 50, 200)
      const offset = parseInt(q.offset) || 0

      const where: any = {}
      if (q.status) where.status = q.status
      if (q.type) where.type = q.type
      if (q.leadId) where.leadId = parseInt(q.leadId)
      if (q.userId) where.userId = parseInt(q.userId)

      // Módulo Resumo: filtro por quem EXECUTA (não por quem criou).
      if (q.assignedUserId) where.assignedUserId = parseInt(q.assignedUserId)
      if (q.assignedTeamId) where.assignedTeamId = parseInt(q.assignedTeamId)
      if (q.unassigned === 'true') where.assignedUserId = null
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
        where.status = 'pending'
        where.scheduledAt = { lt: new Date() }
      } else if (q.view === 'upcoming') {
        // Pendentes agendadas para AMANHA em diante (exclui hoje e atrasadas)
        const tomorrow = new Date(); tomorrow.setHours(0,0,0,0); tomorrow.setDate(tomorrow.getDate() + 1)
        where.status = 'pending'
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

      const [overdue, today, week, byType] = await Promise.all([
        prisma.activity.count({ where: { status: 'pending', scheduledAt: { lt: now } } }),
        prisma.activity.count({ where: { status: 'pending', scheduledAt: { gte: todayStart, lte: todayEnd } } }),
        prisma.activity.count({ where: { status: 'pending', scheduledAt: { gte: todayStart, lte: weekEnd } } }),
        prisma.activity.groupBy({ by: ['type'], where: { status: 'pending' }, _count: true }),
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

      const data: any = {}
      if (body.title !== undefined) data.title = body.title
      if (body.description !== undefined) data.description = body.description
      if (body.scheduledAt !== undefined) data.scheduledAt = new Date(body.scheduledAt)
      if (body.reminderAt !== undefined) data.reminderAt = body.reminderAt ? new Date(body.reminderAt) : null
      if (body.messageBody !== undefined) data.messageBody = body.messageBody
      if (body.messageSubject !== undefined) data.messageSubject = body.messageSubject
      if (body.recipientPhone !== undefined) data.recipientPhone = body.recipientPhone
      if (body.recipientEmail !== undefined) data.recipientEmail = body.recipientEmail
      if (body.type !== undefined && ACTIVITY_TYPES.includes(body.type)) data.type = body.type
      if (body.attachmentUrl !== undefined) data.attachmentUrl = body.attachmentUrl
      if (body.attachmentName !== undefined) data.attachmentName = body.attachmentName
      if (body.attachmentType !== undefined) data.attachmentType = body.attachmentType
      if (body.assignedUserId !== undefined) data.assignedUserId = body.assignedUserId
      if (body.assignedTeamId !== undefined) data.assignedTeamId = body.assignedTeamId

      if (body.status !== undefined && ACTIVITY_STATUSES.includes(body.status)) {
        data.status = body.status
        if (body.status === 'completed' && !existing.completedAt) {
          data.completedAt = new Date()
        }
      }

      if (body.result !== undefined) data.result = body.result

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
  const results: string[] = []

  try {
    if (activity.type === 'whatsapp') {
      const phone = activity.recipientPhone || lead?.whatsapp
      if (!phone) throw new Error('Numero de WhatsApp nao encontrado')

      // 1. Enviar texto se houver — passa leadId pra escolher instância do dono
      if (activity.messageBody) {
        const textResult = await sendWhatsAppText(phone, activity.messageBody, activity.leadId)
        results.push(textResult)
      }

      // 2. Enviar anexo se houver (PDF, imagem, documento)
      if (activity.attachmentUrl) {
        const mediaResult = await sendWhatsAppMedia(phone, activity.attachmentUrl, activity.attachmentName, activity.attachmentType, activity.messageBody ? undefined : activity.title, activity.leadId)
        results.push(mediaResult)
      }

      if (results.length === 0) throw new Error('Nenhum conteudo para enviar (sem mensagem e sem anexo)')
      result = results.join(' | ')

    } else if (activity.type === 'email') {
      const email = activity.recipientEmail || lead?.email
      if (!email) throw new Error('Email nao encontrado')

      const meta = (activity.metadata || {}) as any
      const htmlBody = meta.bodyHtml || activity.messageBody || ''
      const subject = activity.messageSubject || activity.title

      result = await sendEmailActivity(email, subject, htmlBody, activity.attachmentUrl, activity.attachmentName)

    } else if (activity.type === 'sms' && activity.messageBody) {
      result = 'SMS: funcionalidade a ser integrada com provedor'
    } else {
      result = 'Atividade marcada como concluida'
    }

    await prisma.activity.update({
      where: { id: activity.id },
      data: { status: 'sent', completedAt: new Date(), result }
    })

    // Salvar mensagem no historico de conversa do lead (whatsapp)
    if (activity.type === 'whatsapp' && activity.messageBody) {
      prisma.message.create({
        data: {
          leadId: activity.leadId,
          fromMe: true,
          body: activity.messageBody,
          mediaType: activity.attachmentType?.startsWith('image') ? 'image' : activity.attachmentUrl ? 'document' : 'text',
          mediaUrl: activity.attachmentUrl || null,
          mediaName: activity.attachmentName || null,
          senderName: activity.userName || 'Sistema',
          ack: 1,
          timestamp: new Date(),
        }
      }).catch(() => {})

      prisma.lead.update({
        where: { id: activity.leadId },
        data: { lastMessageAt: new Date() }
      }).catch(() => {})
    }

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

// ── Normalizacao de numero de WhatsApp ──
function normalizePhone(phone: string): string {
  // Remove tudo que nao e digito
  let num = phone.replace(/\D/g, '')

  // Se ja e um JID (contém @), extrair numero
  if (phone.includes('@')) {
    num = phone.split('@')[0].replace(/\D/g, '')
  }

  // Se comeca com 0, remove (ex: 062991138484 -> 62991138484)
  if (num.startsWith('0')) num = num.substring(1)

  // Se tem 10-11 digitos (DDD + numero BR sem codigo pais), adiciona 55
  if (num.length >= 10 && num.length <= 11 && !num.startsWith('55')) {
    num = '55' + num
  }

  // Correcao: numeros BR com 9o digito — alguns ficam com 13 digitos (5562991138484)
  // Formato correto: 55 + DDD(2) + 9 + numero(8) = 13 digitos
  // Formato antigo:  55 + DDD(2) + numero(8) = 12 digitos (fixo sem 9)

  return num
}

// ── Evolution API helpers ──
function getEvoConfig() {
  const url = process.env.EVOLUTION_API_URL
  const key = process.env.EVOLUTION_API_KEY
  if (!url || !key) throw new Error('Evolution API nao configurada')
  return { url, key }
}

/**
 * Resolve a instância WhatsApp correta pra enviar mensagem deste lead:
 *   1. Se o lead tem assignedUserId E o agente tem instância dedicada
 *      (ownerUserId), usa a do agente — preserva a identidade ("número
 *      do dono do lead").
 *   2. Senão, primeira ativa (comportamento legado, evita quebrar
 *      tenants single-instance).
 *
 * Bug fix: antes, findFirst({active:true}) sem ordem retornava sempre
 * a 1ª instância (geralmente terram_n1/Luiz). Resultado: msg da Flavia
 * pra lead dela saía pelo número do Luiz.
 */
async function getInstanceForLead(leadId: number | null | undefined): Promise<string> {
  if (leadId) {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { assignedUserId: true },
    })
    if (lead?.assignedUserId) {
      const ownInst = await prisma.whatsAppInstance.findFirst({
        where: { ownerUserId: lead.assignedUserId, active: true },
        orderBy: { id: 'asc' },
        select: { instanceName: true },
      })
      if (ownInst) return ownInst.instanceName
    }
  }
  const fallback = await prisma.whatsAppInstance.findFirst({
    where: { active: true },
    orderBy: { id: 'asc' },
  })
  if (!fallback) throw new Error('Nenhuma instancia WhatsApp ativa')
  return fallback.instanceName
}

// ── WhatsApp: texto ──
async function sendWhatsAppText(phone: string, text: string, leadId?: number | null): Promise<string> {
  const { url, key } = getEvoConfig()
  const inst = await getInstanceForLead(leadId ?? null)
  const number = normalizePhone(phone)

  const resp = await fetch(`${url}/message/sendText/${inst}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: key },
    body: JSON.stringify({ number, text })
  })

  const data = await resp.json().catch(() => null) as any
  if (!resp.ok) {
    const errDetail = data?.response?.message?.[0]?.exists === false
      ? `Numero ${number} nao encontrado no WhatsApp`
      : JSON.stringify(data?.response || data?.error || resp.status)
    throw new Error(`Evolution sendText: ${errDetail}`)
  }
  return `Texto enviado para ${number} (${data?.key?.id || 'ok'})`
}

// ── WhatsApp: midia (PDF, imagem, documento) ──
async function sendWhatsAppMedia(phone: string, mediaUrl: string, fileName?: string | null, mimeType?: string | null, caption?: string, leadId?: number | null): Promise<string> {
  const { url, key } = getEvoConfig()
  const inst = await getInstanceForLead(leadId ?? null)
  const number = normalizePhone(phone)

  const mediatype = mimeType?.startsWith('image') ? 'image'
    : mimeType?.startsWith('video') ? 'video'
    : mimeType?.startsWith('audio') ? 'audio'
    : 'document'

  const resp = await fetch(`${url}/message/sendMedia/${inst}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: key },
    body: JSON.stringify({
      number,
      mediatype,
      media: mediaUrl,
      fileName: fileName || undefined,
      caption: caption || undefined,
    })
  })

  const data = await resp.json().catch(() => null) as any
  if (!resp.ok) {
    const errDetail = JSON.stringify(data?.response || data?.error || resp.status)
    throw new Error(`Evolution sendMedia: ${errDetail}`)
  }
  return `${mediatype} enviado para ${number} (${data?.key?.id || 'ok'})`
}

// ── Email: com suporte a HTML e anexos ──
async function sendEmailActivity(to: string, subject: string, html: string, attachmentUrl?: string | null, attachmentName?: string | null): Promise<string> {
  const cfg = await getEmailConfig()
  const brand = await getBranding()
  const provider = cfg['email.provider'] || 'resend'

  const fromAddress = getFromAddress(cfg, 'Atividades')

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
    const mailOpts: any = { from: fromAddress, to, subject: subject || brand.brandName, html: finalHtml }

    if (attachmentUrl) {
      try {
        const fileResp = await fetch(attachmentUrl)
        if (fileResp.ok) {
          const buffer = Buffer.from(await fileResp.arrayBuffer())
          mailOpts.attachments = [{ filename: attachmentName || 'anexo', content: buffer }]
        }
      } catch (e) { console.warn('Erro ao baixar anexo para SMTP:', e) }
    }

    const result = await transporter.sendMail(mailOpts)
    return result.messageId || 'smtp-sent'
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

  await resend.emails.send(emailOpts)
  return `Email enviado para ${to}${attachmentUrl ? ' (com anexo)' : ''}`
}

// ── Scheduler (roda a cada minuto) ──────────────────────

export function startActivityScheduler(): void {
  setTimeout(async () => {
    await processScheduledActivities()
    setInterval(processScheduledActivities, 60 * 1000)
    console.log('[Activities] Scheduler started — checking every 1min')
  }, 15000)
}

async function processScheduledActivities(): Promise<void> {
  try {
    const now = new Date()

    // 1. Marcar atividades atrasadas
    await prisma.activity.updateMany({
      where: {
        status: 'pending',
        scheduledAt: { lt: new Date(now.getTime() - 30 * 60 * 1000) } // 30min de tolerancia
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
      await executeActivity(activity)
    }

    if (toExecute.length > 0) {
      console.log(`[Activities] Executed ${toExecute.length} scheduled activities`)
    }
  } catch (err) {
    console.error('[Activities] Scheduler error:', err)
  }
}
