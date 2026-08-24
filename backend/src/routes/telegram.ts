import type { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware, adminOnly } from '../lib/auth.js'
import { broadcastRealtimeEvent } from './realtime.js'
import { randomBytes } from 'crypto'

/**
 * Telegram Bot API integration.
 *
 * Storage: usamos a tabela genérica `Setting` (chave 'telegram.connection')
 * em vez de criar nova tabela — mantém o schema enxuto e a migration zero.
 *
 * Fluxo:
 *   1. Admin cria bot no @BotFather → recebe um TOKEN
 *   2. Admin envia POST /telegram/connect com { botToken }
 *   3. Backend chama getMe pra validar e setWebhook apontando pra
 *      /telegram/webhook?secret=<random> com header secret_token
 *   4. Telegram envia updates → criamos Lead + Message
 */

const TELEGRAM_API = 'https://api.telegram.org'
const SETTING_KEY = 'telegram.connection'

interface TelegramConnection {
  botToken: string
  botUsername: string
  botName: string
  webhookSecret: string
  webhookUrl: string
  active: boolean
  connectedAt: string
}

async function loadConnection(): Promise<TelegramConnection | null> {
  const row = await prisma.setting.findUnique({ where: { key: SETTING_KEY } })
  if (!row) return null
  try {
    const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value
    return parsed as TelegramConnection
  } catch {
    return null
  }
}

async function saveConnection(conn: TelegramConnection): Promise<void> {
  const value = JSON.stringify(conn)
  await prisma.setting.upsert({
    where: { key: SETTING_KEY },
    update: { value },
    create: { key: SETTING_KEY, value, label: 'Telegram bot connection', grp: 'channels', fieldType: 'json' },
  })
}

async function tg(method: string, token: string, params?: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params ?? {}),
  })
  const data = await res.json()
  if (!data.ok) throw new Error(data.description ?? `Telegram API error ${res.status}`)
  return data.result
}

export async function telegramRoutes(app: FastifyInstance) {
  // GET /api/telegram/connection — retorna status (sem expor o token)
  app.get('/api/telegram/connection', { preHandler: authMiddleware }, async () => {
    const conn = await loadConnection()
    if (!conn) return { connected: false }
    return {
      connected: true,
      botUsername: conn.botUsername,
      botName: conn.botName,
      webhookUrl: conn.webhookUrl,
      active: conn.active,
      connectedAt: conn.connectedAt,
    }
  })

  // POST /api/telegram/connect — admin envia o botToken
  app.post('/api/telegram/connect', { preHandler: adminOnly }, async (req, reply) => {
    const body = req.body as { botToken?: string }
    const botToken = (body.botToken ?? '').trim()
    if (!botToken) return reply.code(400).send({ error: 'botToken obrigatório' })

    let me: any
    try {
      me = await tg('getMe', botToken)
    } catch (err: any) {
      return reply.code(400).send({ error: `Token inválido: ${err.message}` })
    }

    const appUrl = process.env.APP_URL || `https://${req.hostname}`
    const webhookSecret = randomBytes(16).toString('hex')
    const webhookUrl = `${appUrl}/api/telegram/webhook`

    try {
      await tg('setWebhook', botToken, {
        url: webhookUrl,
        secret_token: webhookSecret,
        allowed_updates: ['message', 'edited_message', 'callback_query'],
      })
    } catch (err: any) {
      return reply.code(500).send({ error: `Falha ao registrar webhook: ${err.message}` })
    }

    const conn: TelegramConnection = {
      botToken,
      botUsername: me.username,
      botName: me.first_name,
      webhookSecret,
      webhookUrl,
      active: true,
      connectedAt: new Date().toISOString(),
    }
    await saveConnection(conn)

    return {
      ok: true,
      botUsername: me.username,
      botName: me.first_name,
      webhookUrl,
    }
  })

  // POST /api/telegram/disconnect — remove webhook + apaga config
  app.post('/api/telegram/disconnect', { preHandler: adminOnly }, async () => {
    const conn = await loadConnection()
    if (conn) {
      try {
        await tg('deleteWebhook', conn.botToken)
      } catch {
        // ignore — Telegram pode estar fora; remover localmente mesmo assim
      }
      await prisma.setting.delete({ where: { key: SETTING_KEY } }).catch(() => {})
    }
    return { ok: true }
  })

  // POST /api/telegram/send-test — testar envio
  app.post('/api/telegram/send-test', { preHandler: adminOnly }, async (req, reply) => {
    const body = req.body as { chatId?: string; text?: string }
    const conn = await loadConnection()
    if (!conn) return reply.code(400).send({ error: 'Telegram não conectado' })
    if (!body.chatId) return reply.code(400).send({ error: 'chatId obrigatório' })
    try {
      const msg = await tg('sendMessage', conn.botToken, {
        chat_id: body.chatId,
        text: body.text ?? 'Teste de conexão Telegram',
      })
      return { ok: true, messageId: msg.message_id }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // POST /api/telegram/webhook — receber updates do Telegram
  // Telegram envia o secret no header X-Telegram-Bot-Api-Secret-Token
  app.post('/api/telegram/webhook', async (req, reply) => {
    const conn = await loadConnection()
    if (!conn || !conn.active) return reply.code(404).send({ error: 'No connection' })

    const headerSecret = req.headers['x-telegram-bot-api-secret-token']
    if (headerSecret !== conn.webhookSecret) {
      return reply.code(401).send({ error: 'Invalid secret' })
    }

    const update = req.body as any
    const message = update?.message ?? update?.edited_message
    if (!message) return { ok: true }

    const chat = message.chat
    const from = message.from
    if (!chat || !from) return { ok: true }

    // Identificador único: telegram:<userId>
    const uid = `telegram:${from.id}`
    const fullName = [from.first_name, from.last_name].filter(Boolean).join(' ').trim() || from.username || `Telegram #${from.id}`

    let lead = await prisma.lead.findFirst({ where: { uid } })
    // Lista de bloqueio: como no Instagram, só casa quando o lead já existe —
    // o Telegram não entrega e-mail nem telefone.
    if (lead) {
      const { findLeadBlockById, rejectInboundMessage } = await import('../services/leadBlocklist.js')
      if (await findLeadBlockById(lead.id).catch(() => null)) {
        await rejectInboundMessage(
          { email: lead.email, whatsapp: lead.whatsapp }, 'Telegram', message.text ?? '',
        ).catch(() => null)
        return { ok: true }
      }
    }
    if (!lead) {
      lead = await prisma.lead.create({
        data: {
          uid,
          nome: fullName,
          empresa: from.username ?? '',
          whatsapp: '', // Telegram não tem WhatsApp; usar uid pra dedupe
          email: '',
          status: 'NOVO',
          source: 'telegram',
          originType: 'telegram',
          scores: {},
          analysis: {},
          formData: { telegramChatId: chat.id, telegramUserId: from.id, telegramUsername: from.username ?? null },
        },
      })
      broadcastRealtimeEvent({
        type: 'lead:created',
        payload: { id: lead.id, nome: lead.nome, status: lead.status },
      })
    }

    const text = message.text ?? message.caption ?? '[mídia]'
    const created = await prisma.message.create({
      data: {
        leadId: lead.id,
        fromMe: false,
        body: text,
        mediaType: message.photo ? 'image' : message.voice ? 'audio' : message.document ? 'document' : 'text',
        provider: 'telegram',
        senderName: fullName,
        externalId: String(message.message_id),
        timestamp: new Date(message.date * 1000),
      },
    })

    broadcastRealtimeEvent({
      type: 'message:received',
      payload: { leadId: lead.id, messageId: created.id, channel: 'telegram' },
      scope: { leadId: lead.id },
    })

    return { ok: true }
  })
}
