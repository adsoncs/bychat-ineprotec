import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { adminOnly, authMiddleware } from '../lib/auth.js'
import { gmailSendEmail, gmailGetProfile } from '../lib/google.js'

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
