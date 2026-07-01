// Webhook que recebe as push notifications do Gmail via Google Cloud Pub/Sub.
// Configurar no GCP uma subscription PUSH para:
//   https://<APP_URL>/api/webhooks/gmail?token=<GMAIL_PUBSUB_TOKEN>
// O corpo é { message: { data: base64(JSON {emailAddress, historyId}) }, subscription }.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { syncGmailByEmail } from '../services/gmailInboundSync.js'

async function expectedToken(): Promise<string> {
  if (process.env.GMAIL_PUBSUB_TOKEN) return process.env.GMAIL_PUBSUB_TOKEN
  const s = await prisma.setting.findUnique({ where: { key: 'gmail.pubsub_token' } }).catch(() => null)
  return s ? String(s.value).replace(/"/g, '').trim() : ''
}

export async function gmailWebhookRoutes(app: FastifyInstance) {
  app.post('/api/webhooks/gmail', async (req, reply) => {
    // Valida o segredo da subscription (defesa contra POSTs forjados).
    const token = (req.query as any)?.token || ''
    const expected = await expectedToken()
    if (!expected || token !== expected) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    try {
      const body = req.body as any
      const dataB64 = body?.message?.data
      if (dataB64) {
        const decoded = JSON.parse(Buffer.from(dataB64, 'base64').toString('utf8'))
        const email = decoded?.emailAddress
        if (email) {
          // Fire-and-forget: responde 200 rápido (Pub/Sub re-tenta em não-2xx).
          syncGmailByEmail(email).catch((e) => console.error('[gmailWebhook] sync falhou:', e?.message))
        }
      }
    } catch (e) {
      console.error('[gmailWebhook] payload inválido:', (e as Error).message)
    }
    // Sempre 200 para o Pub/Sub não re-enfileirar (o sync é idempotente).
    return reply.code(200).send({ ok: true })
  })
}
