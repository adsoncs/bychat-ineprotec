import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { adminOnly, authMiddleware } from '../lib/auth.js'
import { gmailSendEmail, gmailGetProfile, gmailWatch, gmailStopWatch } from '../lib/google.js'
import { syncGmailChannel } from '../services/gmailInboundSync.js'

async function resolvePubsubTopic(): Promise<string> {
  if (process.env.GMAIL_PUBSUB_TOPIC) return process.env.GMAIL_PUBSUB_TOPIC
  const s = await prisma.setting.findUnique({ where: { key: 'gmail.pubsub_topic' } }).catch(() => null)
  return s ? String(s.value).replace(/"/g, '').trim() : ''
}

export async function gmailRoutes(app: FastifyInstance) {

  // GET /api/admin/google/gmail/config
  app.get('/api/admin/google/gmail/config', { preHandler: adminOnly }, async () => {
    const configs = await prisma.gmailConfig.findMany({
      orderBy: { createdAt: 'desc' },
    })
    return { data: configs }
  })

  // POST /api/admin/google/gmail/config
  app.post('/api/admin/google/gmail/config', { preHandler: adminOnly }, async (req, reply) => {
    const body = req.body as any
    if (!body.connectionId) return reply.code(400).send({ error: 'connectionId obrigatorio' })

    // Verify Gmail access
    try {
      const profile = await gmailGetProfile(parseInt(body.connectionId))
      const user = (req as any).user
      const config = await prisma.gmailConfig.create({
        data: {
          connectionId: parseInt(body.connectionId),
          senderName: body.senderName || user?.name || '',
          signature: body.signature || '',
          createdBy: user?.userId || null,
        },
      })
      return reply.code(201).send({ data: { ...config, email: profile.email } })
    } catch (err: any) {
      return reply.code(500).send({ error: `Erro ao verificar Gmail: ${err.message}` })
    }
  })

  // PUT /api/admin/google/gmail/config/:id
  app.put('/api/admin/google/gmail/config/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const body = req.body as any
    const data: any = {}
    if (body.senderName !== undefined) data.senderName = body.senderName
    if (body.signature !== undefined) data.signature = body.signature
    if (body.active !== undefined) data.active = body.active
    const updated = await prisma.gmailConfig.update({ where: { id: parseInt(id) }, data })
    return { data: updated }
  })

  // DELETE /api/admin/google/gmail/config/:id
  app.delete('/api/admin/google/gmail/config/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    await prisma.gmailConfig.delete({ where: { id: parseInt(id) } })
    return { ok: true }
  })

  // POST /api/admin/google/gmail/send — Send email via Gmail
  // Roteamento Híbrido B: prefere Gmail do operador autenticado;
  // se ele não tiver Gmail conectado, cai no GmailConfig da empresa (kind=COMPANY).
  app.post('/api/admin/google/gmail/send', { preHandler: authMiddleware }, async (req, reply) => {
    const body = req.body as any
    if (!body.to || !body.subject || !body.body) {
      return reply.code(400).send({ error: 'to, subject e body sao obrigatorios' })
    }

    const userId = (req as any).user?.userId as number | undefined

    // 1) Tenta config vinculada ao operador atual
    let config = userId
      ? await prisma.gmailConfig.findFirst({
          where: {
            active: true,
            connection: { active: true, userId, kind: 'OPERATOR' },
          },
          include: { connection: { select: { email: true, kind: true } } },
        })
      : null

    // 2) Fallback: config da empresa
    if (!config) {
      config = await prisma.gmailConfig.findFirst({
        where: {
          active: true,
          connection: { active: true, kind: 'COMPANY' },
        },
        include: { connection: { select: { email: true, kind: true } } },
      })
    }

    if (!config) return reply.code(400).send({ error: 'Gmail nao configurado' })

    try {
      const fromName = config.senderName || (req as any).user?.name || ''
      const fromEmail = config.connection?.email || ''

      let bodyHtml = body.bodyHtml || ''
      if (config.signature) {
        bodyHtml = bodyHtml
          ? `${bodyHtml}<br><br>${config.signature}`
          : `<p>${body.body.replace(/\n/g, '<br>')}</p><br>${config.signature}`
      }

      const result = await gmailSendEmail(config.connectionId, {
        to: body.to,
        subject: body.subject,
        body: body.body,
        bodyHtml: bodyHtml || undefined,
        from: fromName ? `${fromName} <${fromEmail}>` : fromEmail,
        replyTo: body.replyTo || undefined,
      })

      await prisma.gmailConfig.update({
        where: { id: config.id },
        data: { totalSent: { increment: 1 } },
      })

      return { success: true, messageId: result.messageId }
    } catch (err: any) {
      await prisma.gmailConfig.update({
        where: { id: config.id },
        data: { totalFailed: { increment: 1 } },
      }).catch(() => {})
      return reply.code(500).send({ error: err.message })
    }
  })

  // POST /api/admin/google/gmail/config/:id/watch — Ativa recebimento
  // Com tópico Pub/Sub → registra o watch (push). Sem tópico → Plano B:
  // ativa recebimento por POLLING (o cron startGmailInboundPoll sincroniza),
  // só estabelecendo a linha de base do lastHistoryId. Não depende de Pub/Sub.
  app.post('/api/admin/google/gmail/config/:id/watch', { preHandler: adminOnly }, async (req, reply) => {
    const id = parseInt((req.params as any).id, 10)
    const config = await prisma.gmailConfig.findUnique({ where: { id } })
    if (!config) return reply.code(404).send({ error: 'Config não encontrada' })
    const topic = await resolvePubsubTopic()

    // Plano B — sem tópico: liga o recebimento por polling.
    if (!topic) {
      try {
        const profile = await gmailGetProfile(config.connectionId)
        const updated = await prisma.gmailConfig.update({
          where: { id },
          data: { syncReplies: true, lastHistoryId: String(profile.historyId || ''), watchExpiration: null, lastSyncAt: new Date() },
        })
        return { data: updated, mode: 'poll' }
      } catch (err: any) {
        return reply.code(500).send({ error: `Falha ao ativar recebimento (polling): ${err.message}` })
      }
    }

    // Push via Pub/Sub.
    try {
      const { historyId, expiration } = await gmailWatch(config.connectionId, topic)
      const updated = await prisma.gmailConfig.update({
        where: { id },
        data: { syncReplies: true, lastHistoryId: String(historyId || ''), watchExpiration: expiration, lastSyncAt: new Date() },
      })
      return { data: updated, mode: 'push', watch: { historyId, expiration } }
    } catch (err: any) {
      return reply.code(500).send({ error: `Falha ao ativar watch: ${err.message}` })
    }
  })

  // POST /api/admin/google/gmail/config/:id/unwatch — Desativa recebimento
  app.post('/api/admin/google/gmail/config/:id/unwatch', { preHandler: adminOnly }, async (req, reply) => {
    const id = parseInt((req.params as any).id, 10)
    const config = await prisma.gmailConfig.findUnique({ where: { id } })
    if (!config) return reply.code(404).send({ error: 'Config não encontrada' })
    try { await gmailStopWatch(config.connectionId) } catch { /* ok */ }
    const updated = await prisma.gmailConfig.update({ where: { id }, data: { syncReplies: false, watchExpiration: null } })
    return { data: updated }
  })

  // POST /api/admin/google/gmail/config/:id/sync — Sincroniza respostas agora (manual)
  app.post('/api/admin/google/gmail/config/:id/sync', { preHandler: adminOnly }, async (req, reply) => {
    const id = parseInt((req.params as any).id, 10)
    try {
      const ingested = await syncGmailChannel(id)
      return { ok: true, ingested }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // POST /api/leads/:leadId/email — Envia e-mail ao cliente pela caixa da empresa
  // e grava como Activity (thread). Aceita replyToActivityId p/ responder na thread.
  // Aceita JSON (sem anexos) OU multipart/form-data (campos + arquivos "files").
  app.post('/api/leads/:leadId/email', { preHandler: authMiddleware }, async (req, reply) => {
    const leadId = parseInt((req.params as any).leadId, 10)
    const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true } })
    if (!lead) return reply.code(404).send({ error: 'Lead não encontrado' })
    const user = (req as any).user

    const MAX_PER_FILE = 15 * 1024 * 1024 // 15MB/arquivo
    const MAX_TOTAL = 18 * 1024 * 1024    // 18MB no total (Gmail rejeita msg > ~25MB já codificada)

    const fields: Record<string, string> = {}
    const attachments: Array<{ filename: string; mimeType: string; content: Buffer }> = []

    const isMultipart = typeof (req as any).isMultipart === 'function' && (req as any).isMultipart()
    if (isMultipart) {
      let total = 0
      try {
        for await (const part of (req as any).parts({ limits: { fileSize: MAX_PER_FILE } })) {
          if (part.type === 'file') {
            const chunks: Buffer[] = []
            for await (const c of part.file) {
              total += c.length
              if (total > MAX_TOTAL) return reply.code(413).send({ error: 'Anexos excedem o limite total de 18MB.' })
              chunks.push(c)
            }
            if (part.file.truncated) return reply.code(413).send({ error: `Anexo "${part.filename}" excede 15MB.` })
            attachments.push({
              filename: part.filename || 'arquivo',
              mimeType: part.mimetype || 'application/octet-stream',
              content: Buffer.concat(chunks),
            })
          } else {
            fields[part.fieldname] = String(part.value ?? '')
          }
        }
      } catch (e: any) {
        return reply.code(400).send({ error: `Falha ao ler anexos: ${e?.message || e}` })
      }
    } else {
      Object.assign(fields, (req.body as any) || {})
    }

    if (!fields.to || !fields.subject || !fields.body) {
      return reply.code(400).send({ error: 'to, subject e body são obrigatórios' })
    }

    try {
      const { sendLeadEmail } = await import('../services/gmailClientEmail.js')
      const r = await sendLeadEmail({
        leadId,
        userId: user?.userId ?? null,
        userName: user?.name ?? null,
        to: String(fields.to),
        subject: String(fields.subject),
        body: String(fields.body),
        bodyHtml: fields.bodyHtml ? String(fields.bodyHtml) : undefined,
        replyToActivityId: fields.replyToActivityId ? parseInt(String(fields.replyToActivityId), 10) : null,
        attachments,
      })
      return reply.code(201).send({ ok: true, ...r })
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // GET /api/admin/google/gmail/profile — Get Gmail profile
  app.get('/api/admin/google/gmail/profile', { preHandler: adminOnly }, async (req, reply) => {
    const config = await prisma.gmailConfig.findFirst({ where: { active: true } })
    if (!config) return reply.code(400).send({ error: 'Gmail nao configurado' })
    try {
      const profile = await gmailGetProfile(config.connectionId)
      return { data: profile }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })
}
