// src/routes/whatsapp.ts
// Gerenciamento de instância WhatsApp via Evolution API + webhook para chat diagnóstico

import { FastifyInstance } from 'fastify'
import crypto from 'crypto'
import { writeFile, mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { prisma } from '../lib/prisma.js'
import { redis } from '../lib/redis.js'
import { logSecurityEvent } from '../services/security.js'
import { resolveLeadForContact, reconcileLeadIdentity } from '../services/contactIdentity.js'
import { isLikelyLid, onlyDigits } from '../lib/phone.js'
import { authMiddleware, adminOnly } from '../lib/auth.js'
import { logEvent, EVENT_TYPES } from '../services/leadHistory.js'
import { processChatbotMessage, chatbotTriggerAllows } from '../services/chatbotFlow.js'
import { processScriptedChatbotMessage } from '../services/scriptedChatbotFlow.js'
import { detectOrigin, stripTrackingRef, saveLeadOrigin } from '../services/originDetection.js'
import { resolveDefaultTeamId, resolveRoutingFromContext } from '../services/teamRouting.js'
import { instanceAcceptsGroups, resolveGroupLead, groupSenderName } from '../services/whatsappGroups.js'
import { broadcastRealtimeEvent } from './realtime.js'

// ─── Evolution API helpers ────────────────────────────────

// Throttle do alerta de webhook sem autenticação (1x/h) — evita flood de logs.
let lastEvolutionWebhookWarn = 0

function evoUrl() { return process.env.EVOLUTION_API_URL || '' }
function evoKey() { return process.env.EVOLUTION_API_KEY || '' }
function evoInstance() { return process.env.EVOLUTION_INSTANCE || 'beyond-main' }

async function evoFetch(path: string, method = 'GET', body?: any) {
  const opts: any = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'apikey': evoKey()
    }
  }
  if (body) opts.body = JSON.stringify(body)
  const res = await fetch(`${evoUrl()}${path}`, opts)
  const text = await res.text()
  try { return JSON.parse(text) } catch { return text }
}

async function sendWhatsAppMessage(number: string, text: string, instanceName?: string | null) {
  // Responde pela instância que RECEBEU a mensagem (multi-instância). Sem ela,
  // cai na instância global do .env (EVOLUTION_INSTANCE) — comportamento antigo.
  return evoFetch(`/message/sendText/${instanceName || evoInstance()}`, 'POST', { number, text })
}

// ─── Foto de perfil do contato: hospedar LOCALMENTE ──────────────────────────
// As URLs devolvidas pela Evolution (pps.whatsapp.net) são ASSINADAS e EXPIRAM
// (parâmetro oe=) em alguns dias → guardá-las cru faz a foto "sumir" depois. Aqui
// baixamos os bytes e salvamos em /uploads/avatars/<leadId>.jpg (servido pelo
// próprio backend, URL estável que nunca expira). Auto-throttle pelo mtime do
// arquivo: só re-busca se o avatar local tiver passado do TTL (a foto pode mudar
// no WhatsApp). Roda em background — nunca bloqueia o processamento da mensagem.
const AVATAR_DIR = join(process.cwd(), '..', 'uploads', 'avatars')
const AVATAR_TTL_MS = 24 * 60 * 60 * 1000 // re-busca no máx. 1x/dia por contato

async function cacheProfilePicture(leadId: number, currentUrl: string | null, phone: string, instance: string, app: FastifyInstance): Promise<void> {
  if (!phone || /@lid$/.test(phone) || phone.replace(/\D/g, '').length > 15) return // ignora LID/placeholder
  const file = join(AVATAR_DIR, `${leadId}.jpg`)
  const isLocal = !!currentUrl && currentUrl.startsWith('/uploads/avatars/')
  if (isLocal) {
    // Já hospedado: só renova se o arquivo local passou do TTL.
    try { const s = await stat(file); if (Date.now() - s.mtimeMs < AVATAR_TTL_MS) return } catch { /* sem arquivo → re-baixa */ }
  }
  try {
    const result: any = await evoFetch(`/chat/fetchProfilePictureUrl/${instance}`, 'POST', { number: phone })
    const picUrl: string | null = result?.profilePictureUrl || result?.picture || result?.url || null
    if (!picUrl) return // contato sem foto pública (privacidade) — preserva o atual
    const res = await fetch(picUrl)
    if (!res.ok) return
    const buf = Buffer.from(await res.arrayBuffer())
    await mkdir(AVATAR_DIR, { recursive: true })
    await writeFile(file, buf)
    // ?v= força o navegador a recarregar quando a foto é atualizada.
    const publicUrl = `/uploads/avatars/${leadId}.jpg?v=${Date.now()}`
    await prisma.lead.update({ where: { id: leadId }, data: { profilePicUrl: publicUrl } }).catch(() => {})
  } catch (e: any) {
    app.log.warn(`[avatar] lead ${leadId}: ${e?.message || e}`)
  }
}

// ─── LID → Phone resolver (consulta PostgreSQL da Evolution API) ───

import pg from 'pg'

// Cache em memória: LID → phone number
const lidPhoneCache = new Map<string, string>()

// Pool de conexão com PostgreSQL da Evolution API
let evoPgPool: pg.Pool | null = null
function getEvoPgPool(): pg.Pool {
  if (!evoPgPool) {
    // Sem credencial default no código — exige EVOLUTION_PG_URL configurada.
    const connectionString = process.env.EVOLUTION_PG_URL
    if (!connectionString) {
      throw new Error('EVOLUTION_PG_URL não configurada — pool Postgres do Evolution indisponível')
    }
    evoPgPool = new pg.Pool({
      connectionString,
      max: 3,
      idleTimeoutMillis: 30000
    })
  }
  return evoPgPool
}

async function resolveLidToPhone(lid: string, pushName?: string): Promise<string> {
  // Check cache first
  const cached = lidPhoneCache.get(lid)
  if (cached) return cached

  try {
    const pool = getEvoPgPool()

    // Obter instanceId do LID
    const instResult = await pool.query(
      `SELECT "instanceId" FROM "Contact" WHERE "remoteJid" = $1 LIMIT 1`, [lid]
    )
    if (instResult.rows.length === 0) return ''
    const instanceId = instResult.rows[0].instanceId

    // Estratégia 1: Contatos com mesmo profilePicUrl (mais confiável)
    const picResult = await pool.query(`
      SELECT b."remoteJid"
      FROM "Contact" a
      JOIN "Contact" b ON a."profilePicUrl" = b."profilePicUrl" AND a."instanceId" = b."instanceId"
      WHERE a."remoteJid" = $1
        AND b."remoteJid" LIKE '%@s.whatsapp.net'
        AND a."profilePicUrl" IS NOT NULL
        AND a."profilePicUrl" != ''
      LIMIT 1
    `, [lid])

    if (picResult.rows.length > 0) {
      const phone = (picResult.rows[0].remoteJid as string).replace('@s.whatsapp.net', '')
      lidPhoneCache.set(lid, phone)
      console.log(`[LID] Resolved ${lid} -> ${phone} (profilePicUrl match)`)
      return phone
    }

    // Estratégia 2: Mensagens enviadas (fromMe=true) para @s.whatsapp.net
    // Excluir: número da instância (ownerJid) e números que já têm LID mapeado
    const ownerResult = await pool.query(
      `SELECT "ownerJid" FROM "Instance" WHERE "id" = $1`, [instanceId]
    )
    const ownerJid = ownerResult.rows[0]?.ownerJid || ''

    const msgResult = await pool.query(`
      SELECT DISTINCT sent."key"->>'remoteJid' as phone_jid
      FROM "Message" sent
      WHERE sent."key"->>'fromMe' = 'true'
        AND sent."key"->>'remoteJid' LIKE '%@s.whatsapp.net'
        AND sent."instanceId" = $1
        AND sent."key"->>'remoteJid' != $2
        AND sent."key"->>'remoteJid' NOT IN (
          SELECT b."remoteJid" FROM "Contact" a
          JOIN "Contact" b ON a."profilePicUrl" = b."profilePicUrl" AND a."instanceId" = b."instanceId"
          WHERE a."remoteJid" LIKE '%@lid' AND b."remoteJid" LIKE '%@s.whatsapp.net'
            AND a."profilePicUrl" IS NOT NULL AND a."profilePicUrl" != ''
            AND a."instanceId" = $1
        )
    `, [instanceId, ownerJid])

    if (msgResult.rows.length === 1) {
      // Exatamente 1 número phone não mapeado — é o nosso LID
      const phone = (msgResult.rows[0].phone_jid as string).replace('@s.whatsapp.net', '')
      lidPhoneCache.set(lid, phone)
      console.log(`[LID] Resolved ${lid} -> ${phone} (message correlation, unique unmapped)`)
      return phone
    }

    // Estratégia 3: Contatos com mesmo pushName (exact match, mesma instância)
    if (pushName) {
      const nameResult = await pool.query(`
        SELECT b."remoteJid"
        FROM "Contact" a
        JOIN "Contact" b ON a."pushName" = b."pushName" AND a."instanceId" = b."instanceId"
        WHERE a."remoteJid" = $1
          AND b."remoteJid" LIKE '%@s.whatsapp.net'
        LIMIT 1
      `, [lid])

      if (nameResult.rows.length > 0) {
        const phone = (nameResult.rows[0].remoteJid as string).replace('@s.whatsapp.net', '')
        lidPhoneCache.set(lid, phone)
        console.log(`[LID] Resolved ${lid} -> ${phone} (pushName match)`)
        return phone
      }
    }
  } catch (err: any) {
    console.warn(`[LID] Resolution failed for ${lid}: ${err.message}`)
  }

  return ''
}

// ─── Audio transcription ─────────────────────────────────

async function downloadAudioFromEvolution(messageKey: any, instanceName?: string): Promise<Buffer | null> {
  try {
    const inst = instanceName || evoInstance()
    const result = await evoFetch(`/chat/getBase64FromMediaMessage/${inst}`, 'POST', { message: { key: messageKey } })
    if (result?.base64) {
      return Buffer.from(result.base64, 'base64')
    }
    return null
  } catch (err) {
    console.error('[Audio] Failed to download from Evolution:', err)
    return null
  }
}

// ─── Mídia recebida (Evolution): baixar/descriptografar e hospedar localmente ──
// As URLs que a Evolution entrega (mmg.whatsapp.net/...*.enc) são CRIPTOGRAFADAS
// ponta-a-ponta e NÃO renderizam no navegador. getBase64FromMediaMessage devolve
// os bytes DECIFRADOS → salvamos em /uploads/evolution-media/<arquivo> (URL
// estável servida pelo backend). Mesmo padrão do saveCloudApiMedia e dos avatares.
const EVO_MEDIA_DIR = join(process.cwd(), '..', 'uploads', 'evolution-media')

function evoExtFromMime(mime: string, fallback: string): string {
  const m = (mime || '').split(';')[0].trim().toLowerCase()
  const map: Record<string, string> = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
    'video/mp4': 'mp4', 'video/3gpp': '3gp', 'video/quicktime': 'mov',
    'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/amr': 'amr', 'audio/wav': 'wav',
    'application/pdf': 'pdf',
  }
  if (map[m]) return map[m]
  const sub = (m.split('/')[1] || '').replace(/[^a-z0-9]/g, '')
  return sub || fallback
}

// Persiste um buffer de mídia já decifrado e devolve a URL pública local.
async function saveMediaBuffer(buf: Buffer, mime: string, mediaType: string, app: FastifyInstance): Promise<string> {
  try {
    // 'gif' compartilha o container do vídeo: o WhatsApp entrega MP4 sem áudio.
    const fb = mediaType === 'image' ? 'jpg'
      : mediaType === 'video' || mediaType === 'gif' ? 'mp4'
        : mediaType === 'audio' ? 'ogg'
          : mediaType === 'sticker' ? 'webp' : 'bin'
    const ext = evoExtFromMime(mime, fb)
    await mkdir(EVO_MEDIA_DIR, { recursive: true })
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`
    await writeFile(join(EVO_MEDIA_DIR, fileName), buf)
    return `/uploads/evolution-media/${fileName}`
  } catch (e: any) {
    app.log.warn(`[evo-media] write ${mediaType}: ${e?.message || e}`)
    return ''
  }
}

// Baixa+descriptografa a mídia da Evolution e salva localmente (URL estável).
async function saveEvolutionMedia(messageKey: any, instance: string, mediaType: string, mime: string, app: FastifyInstance): Promise<string> {
  try {
    const result: any = await evoFetch(`/chat/getBase64FromMediaMessage/${instance}`, 'POST', { message: { key: messageKey } })
    if (!result?.base64) return ''
    return await saveMediaBuffer(Buffer.from(result.base64, 'base64'), mime || result?.mimetype || '', mediaType, app)
  } catch (e: any) {
    app.log.warn(`[evo-media] fetch ${mediaType}: ${e?.message || e}`)
    return ''
  }
}

async function transcribeAudio(audioBuffer: Buffer): Promise<string | null> {
  try {
    const { writeFileSync, unlinkSync, mkdirSync } = await import('fs')
    const { join } = await import('path')
    const { execSync } = await import('child_process')
    const { randomUUID } = await import('crypto')

    const tmpDir = '/tmp/bychat-audio'
    mkdirSync(tmpDir, { recursive: true })

    const tmpFile = join(tmpDir, `${randomUUID()}.ogg`)
    writeFileSync(tmpFile, audioBuffer)

    const scriptPath = join(process.cwd(), 'scripts', 'transcribe.py')
    const result = execSync(`python3 "${scriptPath}" "${tmpFile}"`, {
      timeout: 60000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    })

    // Cleanup temp file
    try { unlinkSync(tmpFile) } catch { /* ignore */ }

    const parsed = JSON.parse(result.trim())
    if (parsed.error) {
      console.error(`[Audio] Transcription error: ${parsed.error}`)
      return null
    }
    return parsed.text || null
  } catch (err: any) {
    console.error('[Audio] Local transcription failed:', err.message || err)
    return null
  }
}

// ─── Routes ───────────────────────────────────────────────

export async function whatsappRoutes(app: FastifyInstance) {

  // GET /api/whatsapp/status — Status da conexão da instância
  app.get('/api/whatsapp/status', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const result = await evoFetch(`/instance/connectionState/${evoInstance()}`)
      // Normalizar resposta: Evolution API retorna { instance: { state: "open" } }
      const state = result?.instance?.state || result?.state || 'disconnected'
      // Mantém cache em memória em sincronia — evita que SSE reporte estado antigo
      const normalized = (state === 'open' || state === 'connected') ? 'connected' : 'disconnected'
      if (lastConnectionState !== normalized) {
        broadcastConnectionState(normalized)
      }
      return { instance: evoInstance(), state }
    } catch (err: any) {
      return { instance: evoInstance(), state: 'disconnected', error: err.message }
    }
  })

  // POST /api/whatsapp/connect — Gerar QR code para conexão
  app.post('/api/whatsapp/connect', { preHandler: adminOnly }, async (req, reply) => {
    try {
      // Primeiro tenta verificar se instância existe
      let instanceExists = false
      try {
        const state = await evoFetch(`/instance/connectionState/${evoInstance()}`)
        // Evolution API retorna { status: 404 } quando instância não existe
        instanceExists = !!state && !state.status && !state.error
      } catch {}

      // Se não existe, cria a instância
      if (!instanceExists) {
        const webhookUrl = `${process.env.APP_URL || 'https://bychat.ia.br'}/api/whatsapp/webhook`
        const createResult = await evoFetch('/instance/create', 'POST', {
          instanceName: evoInstance(),
          integration: 'WHATSAPP-BAILEYS',
          qrcode: true,
          webhook: {
            url: webhookUrl,
            webhookByEvents: false,
            webhookBase64: false,
            events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE', 'PRESENCE_UPDATE']
          }
        })
        // Se a criação já retornou QR code, devolve direto
        if (createResult?.qrcode?.base64 || createResult?.base64) {
          return createResult
        }
      }

      // Gera QR code
      const qr = await evoFetch(`/instance/connect/${evoInstance()}`)
      return qr
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // POST /api/whatsapp/disconnect — Desconectar instância
  app.post('/api/whatsapp/disconnect', { preHandler: adminOnly }, async (req, reply) => {
    try {
      await evoFetch(`/instance/logout/${evoInstance()}`, 'DELETE')
      return { ok: true }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // POST /api/whatsapp/restart — Reiniciar instância
  app.post('/api/whatsapp/restart', { preHandler: adminOnly }, async (req, reply) => {
    try {
      await evoFetch(`/instance/restart/${evoInstance()}`, 'PUT')
      return { ok: true }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // Estado de conexão em memória para SSE
  // 'unknown' = ainda não sincronizado com Evolution; evita reportar OFF falso-positivo
  let lastConnectionState: string = 'unknown'
  const sseClients: Set<any> = new Set()

  // Sincroniza estado inicial consultando Evolution (fire-and-forget no start + on demand)
  async function syncConnectionStateFromEvolution(): Promise<string> {
    try {
      const result = await evoFetch(`/instance/connectionState/${evoInstance()}`)
      const state = result?.instance?.state || result?.state || ''
      const normalized = (state === 'open' || state === 'connected') ? 'connected' : 'disconnected'
      lastConnectionState = normalized
      return normalized
    } catch {
      lastConnectionState = 'disconnected'
      return 'disconnected'
    }
  }

  // Ao subir, busca o estado real uma vez (não bloqueia o boot)
  syncConnectionStateFromEvolution().catch(() => {})

  // Cooldown de reconexão por instância: evita loop de restart
  // Map<instanceName, timestamp do último restart disparado>
  const lastRestartAt = new Map<string, number>()
  const RESTART_COOLDOWN_MS = 30_000

  // Baileys DisconnectReason → ação
  // Referência: @whiskeysockets/baileys/src/Types/DisconnectReason.ts
  const DISCONNECT_REASONS: Record<number, { name: string; action: 'restart' | 'requires_qr' | 'give_up' | 'none' }> = {
    401: { name: 'loggedOut',           action: 'requires_qr' }, // sessão invalidada — novo QR obrigatório
    403: { name: 'forbidden',           action: 'requires_qr' },
    405: { name: 'multideviceMismatch', action: 'requires_qr' },
    408: { name: 'timedOut',            action: 'restart'     },
    411: { name: 'connectionLost',      action: 'restart'     },
    428: { name: 'connectionClosed',    action: 'restart'     },
    440: { name: 'connectionReplaced',  action: 'give_up'     }, // outra sessão assumiu — reconectar só ejeta de novo
    500: { name: 'badSession',          action: 'restart'     },
    515: { name: 'restartRequired',     action: 'restart'     },
  }

  async function tryAutoRestart(instanceName: string, reasonName: string) {
    const now = Date.now()
    const last = lastRestartAt.get(instanceName) || 0
    if (now - last < RESTART_COOLDOWN_MS) {
      app.log.warn(`[WA/restart] Skipping auto-restart for ${instanceName} (${reasonName}) — cooldown active (${Math.round((RESTART_COOLDOWN_MS - (now - last))/1000)}s left)`)
      return
    }
    lastRestartAt.set(instanceName, now)
    app.log.info(`[WA/restart] Auto-restarting ${instanceName} due to ${reasonName}`)
    try {
      await evoFetch(`/instance/restart/${instanceName}`, 'PUT')
      app.log.info(`[WA/restart] ${instanceName} restart request accepted by Evolution`)
    } catch (err: any) {
      app.log.error(`[WA/restart] ${instanceName} restart failed: ${err?.message || err}`)
    }
  }

  // GET /api/whatsapp/connection-stream — SSE para estado de conexão em tempo real
  app.get('/api/whatsapp/connection-stream', async (req, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    })
    // Se nunca sincronizou com a Evolution, faz fetch pontual antes de emitir.
    // Evita reportar "disconnected" falso-positivo quando a instância já está conectada
    // mas nenhum webhook connection.update foi recebido desde o último restart do backend.
    let stateToSend = lastConnectionState
    if (stateToSend === 'unknown') {
      stateToSend = await syncConnectionStateFromEvolution()
    }
    reply.raw.write(`data: ${JSON.stringify({ state: stateToSend })}\n\n`)
    sseClients.add(reply.raw)
    req.raw.on('close', () => { sseClients.delete(reply.raw) })
  })

  function broadcastConnectionState(state: string) {
    lastConnectionState = state
    const msg = `data: ${JSON.stringify({ state })}\n\n`
    for (const client of sseClients) {
      try { client.write(msg) } catch { sseClients.delete(client) }
    }
  }

  // POST /api/whatsapp/webhook — Recebe mensagens do Evolution API
  app.post('/api/whatsapp/webhook', async (req, reply) => {
    try {
      // ── Autenticidade do webhook ──────────────────────────────────────
      // Sem auth, qualquer um pode injetar mensagens/leads forjados. Configure
      // EVOLUTION_WEBHOOK_KEY no .env e adicione o mesmo valor como header
      // (x-webhook-token ou apikey) na config do webhook do Evolution. Quando a
      // env está setada a verificação é obrigatória (fail-closed); sem ela,
      // mantemos o comportamento legado com alerta para não perder mensagens.
      const expectedWebhookKey = process.env.EVOLUTION_WEBHOOK_KEY || ''
      if (expectedWebhookKey) {
        const got = String(req.headers['x-webhook-token'] || req.headers['apikey'] || '')
        const gotBuf = Buffer.from(got)
        const expBuf = Buffer.from(expectedWebhookKey)
        const valid = gotBuf.length === expBuf.length && crypto.timingSafeEqual(gotBuf, expBuf)
        if (!valid) {
          await logSecurityEvent({ ip: req.ip, type: 'whatsapp_webhook_unauthorized', severity: 'high', path: req.url, details: 'Webhook Evolution sem token válido' }).catch(() => {})
          return reply.code(401).send({ error: 'Não autorizado' })
        }
      } else if (Date.now() - lastEvolutionWebhookWarn > 3600_000) {
        lastEvolutionWebhookWarn = Date.now()
        app.log.warn('[WA/webhook][SECURITY] EVOLUTION_WEBHOOK_KEY não configurada — webhook aceita requests não autenticados. Configure para impedir injeção de mensagens/leads.')
      }

      const body = req.body as any

      // Evolution API envia eventos com diferentes formatos
      const event = body.event || ''

      app.log.info(`[Webhook] Event: ${event}`)

      // Handle connection state updates
      if (event === 'connection.update') {
        const data = body.data || {}
        const state = data.state || data.status || ''
        const statusReason = data.statusReason ?? data.lastDisconnect?.error?.output?.statusCode
        const instName = body.instance || data.instance || data.instanceName || evoInstance()

        // Diagnóstico: payload completo em uma linha para facilitar grep/análise
        app.log.info({
          msg: '[WA/connection.update]',
          instance: instName,
          state,
          statusReason,
          reasonName: typeof statusReason === 'number' ? DISCONNECT_REASONS[statusReason]?.name : undefined,
          payload: data
        })

        if (state === 'open' || state === 'connected') {
          broadcastConnectionState('connected')
          return { ok: true }
        }

        if (state === 'close' || state === 'disconnected') {
          broadcastConnectionState('disconnected')

          if (typeof statusReason === 'number' && DISCONNECT_REASONS[statusReason]) {
            const { name, action } = DISCONNECT_REASONS[statusReason]
            if (action === 'restart') {
              // Fire-and-forget: não bloqueia o webhook
              tryAutoRestart(instName, name).catch(() => {})
            } else if (action === 'requires_qr') {
              app.log.error(`[WA] Instance ${instName} requires new QR (${name}, code=${statusReason}) — manual reconnect needed`)
              // Sessão invalidada é o sinal mais grave para os Disparos
              // Inteligentes: o número sai de circulação e toda campanha que
              // dependia dele pausa na hora, em vez de seguir falhando em silêncio.
              import('../services/smartBroadcast/index.js')
                .then((m) => m.blockSender(instName, `sessão encerrada pelo WhatsApp (${name}, código ${statusReason})`))
                .catch(() => {})
            } else if (action === 'give_up') {
              app.log.warn(`[WA] Instance ${instName} gave up (${name}, code=${statusReason}) — not reconnecting`)
            }
          } else {
            app.log.warn(`[WA] Instance ${instName} disconnected with unknown statusReason=${statusReason}`)
          }
        }
        return { ok: true }
      }

      // Handle ACK updates (message status: sent, delivered, read)
      if (event === 'messages.update') {
        const STATUS_MAP: Record<string, number> = {
          'PENDING': 0, 'SERVER_ACK': 1, 'DELIVERY_ACK': 2, 'READ': 3, 'PLAYED': 4,
          'pending': 0, 'server_ack': 1, 'delivery_ack': 2, 'read': 3, 'played': 4
        }
        try {
          const updates = Array.isArray(body.data) ? body.data : [body.data]
          for (const upd of updates) {
            const msgId = upd?.key?.id || upd?.keyId || ''
            const rawStatus = upd?.update?.status ?? upd?.status
            if (!msgId || rawStatus === undefined) continue

            let ack: number
            if (typeof rawStatus === 'number') {
              ack = rawStatus
            } else {
              ack = STATUS_MAP[String(rawStatus)] ?? 0
            }

            const result = await prisma.message.updateMany({
              where: { externalId: msgId },
              data: { ack }
            })
            if (result.count > 0) {
              app.log.info(`[ACK] ${msgId} -> ack=${ack} (${rawStatus})`)
            }
            // Entrega/leitura também alimentam os Disparos Inteligentes: é o que
            // permite ver que um número parou de entregar antes de queimá-lo.
            if (ack >= 2) {
              import('../services/smartBroadcast/replies.js')
                .then((m) => m.applyAck(msgId, ack))
                .catch(() => {})
            }
          }
        } catch (ackErr: any) {
          app.log.warn(`ACK update error: ${ackErr.message}`)
        }
        return { ok: true }
      }

      // Presence (digitando/gravando). Não persiste — só broadcast efêmero.
      if (event === 'presence.update') {
        try {
          const data = body.data || {}
          // Evolution v2 entrega { id: <remoteJid>, presences: { <jid>: { lastKnownPresence: 'composing' | ... } } }.
          // Algumas versões usam `presence` direto. Tolerar ambas.
          const remoteJid: string = data.id || data.remoteJid || ''
          const presences = data.presences || {}
          const presenceVal: string = (() => {
            const direct = data.presence || data.lastKnownPresence
            if (typeof direct === 'string') return direct
            const first = Object.values(presences)[0] as any
            return first?.lastKnownPresence || first?.presence || ''
          })()

          if (!remoteJid || !presenceVal) return { ok: true }

          // composing = digitando texto. recording = gravando áudio.
          // available / unavailable / paused = parou.
          const isTyping = presenceVal === 'composing' || presenceVal === 'recording'
          const kind: 'text' | 'audio' = presenceVal === 'recording' ? 'audio' : 'text'

          // Match remoteJid → lead. Tolerante: tenta waLid, depois últimos 8 dígitos.
          let lead: { id: number } | null = null
          if (remoteJid.includes('@lid')) {
            lead = await prisma.lead.findFirst({ where: { waLid: remoteJid }, select: { id: true } })
          }
          if (!lead) {
            const phoneDigits = remoteJid.replace(/\D/g, '')
            if (phoneDigits.length >= 8) {
              lead = await prisma.lead.findFirst({
                where: { whatsapp: { contains: phoneDigits.slice(-8) } },
                orderBy: { lastMessageAt: 'desc' },
                select: { id: true },
              })
            }
          }
          if (!lead) return { ok: true }

          broadcastRealtimeEvent({
            type: 'chat:typing',
            payload: {
              leadId: lead.id,
              kind,
              isTyping,
              // Expira em 8s (Evolution costuma reemitir composing a cada ~5s).
              expiresAt: isTyping ? Date.now() + 8_000 : 0,
            },
            scope: { leadId: lead.id },
          })
        } catch (typingErr: any) {
          app.log.warn(`presence.update error: ${typingErr.message}`)
        }
        return { ok: true }
      }

      // Só processa mensagens recebidas
      if (event !== 'messages.upsert') {
        app.log.info(`[Webhook] Ignoring event: ${event}`)
        return { ok: true }
      }

      const data = body.data || {}
      const message = data.message || {}
      const key = data.key || {}
      const messageId = key.id || ''
      // Instância real que recebeu a mensagem (vem no payload da Evolution).
      // Crítico para roteamento de equipe e lookup de chatbot vinculado: cada
      // instância pode ter defaultTeamId/chatbotId distintos. Usar evoInstance()
      // (que sempre retorna a env var EVOLUTION_INSTANCE) leva a roteamento errado
      // em multi-instância — todo lead acabaria atribuído ao team da instância
      // padrão, ignorando a configuração de cada conexão.
      const inboundInstance: string = body.instance || data.instance || data.instanceName || evoInstance()

      // Extrai número e texto
      // Evolution API v2 pode enviar remoteJid como LID (@lid) em vez de @s.whatsapp.net
      // Nesse caso, o número real vem no campo body.sender (ex: "556291138484@s.whatsapp.net")
      const remoteJid = key.remoteJid || ''
      let phone = ''
      // JID @lid a persistir no lead quando aplicável. Usado pra associar msgs futuras do mesmo LID.
      let waLidToPersist: string | null = null

      // ── Mensagem de GRUPO ──
      // Historicamente descartada aqui. Agora depende do toggle `receiveGroups`
      // da conexão: OFF (default) mantém o descarte; ON segue para o fluxo de
      // grupo mais abaixo, que NUNCA chama chatbot nem enriquecimento.
      const isGroupMsg = remoteJid.endsWith('@g.us')
      if (isGroupMsg && !(await instanceAcceptsGroups(inboundInstance))) {
        return { ok: true }
      }

      if (remoteJid.endsWith('@lid')) {
        // LID (@lid) é um identificador de PRIVACIDADE do WhatsApp — NÃO é telefone.
        // Tenta obter o número real via Evolution; o match CRM (waLid/phoneKey/nome)
        // fica a cargo do resolvedor de identidade unificado, abaixo.
        waLidToPersist = remoteJid
        const resolved = await resolveLidToPhone(remoteJid, data.pushName)
        if (resolved) {
          phone = resolved
          app.log.info(`[Webhook] LID ${remoteJid} resolved to phone: ${phone}`)
        } else {
          phone = '' // sem número ainda — o resolvedor tenta achar o lead existente
        }
      } else {
        phone = remoteJid.replace('@s.whatsapp.net', '').replace('@g.us', '')
      }

      // ── Identidade canônica unificada (fix definitivo de duplicação) ──
      // Acha o lead deste contato por waLid → phoneKey → nome e ADOTA o telefone
      // já cadastrado nele, fazendo todos os lookups abaixo convergirem para o
      // MESMO lead. Reconcilia (backfill phoneKey, grava waLid recém-descoberto).
      //
      // NÃO roda para grupo: o "telefone" ali são os dígitos do JID e o pushName
      // é o do PARTICIPANTE, então o match por nome acharia (e reconciliaria) o
      // lead pessoal de quem falou. Grupo dedupa por groupJid, mais abaixo.
      if (!isGroupMsg) {
        const ident = await resolveLeadForContact({ phone, waLid: waLidToPersist, pushName: data.pushName })
        if (ident.lead) {
          if (ident.lead.whatsapp && !isLikelyLid(ident.lead.whatsapp)) phone = ident.lead.whatsapp
          await reconcileLeadIdentity(
            ident.lead.id,
            { whatsapp: ident.lead.whatsapp, waLid: ident.lead.waLid, phoneKey: ident.lead.phoneKey },
            { phone: phone || undefined, waLid: waLidToPersist },
          )
        } else if (!phone && remoteJid.endsWith('@lid')) {
          // Contato puro-LID NOVO (sem telefone, sem match): placeholder com os
          // dígitos do LID só pra não derrubar a mensagem — waLid fica gravado e
          // mensagens futuras (com o número real) convergem via reconcile.
          phone = onlyDigits(remoteJid)
        }
      }

      // Mensagens enviadas por nós — salvar externalId + ack inicial
      if (key.fromMe) {
        if (messageId && (phone || isGroupMsg)) {
          try {
            // Find the most recent sent message to this lead without externalId
            // (no grupo, o lead é achado pelo JID — não há telefone).
            const lead = isGroupMsg
              ? await prisma.lead.findFirst({ where: { groupJid: remoteJid }, orderBy: { createdAt: 'asc' } })
              : await prisma.lead.findFirst({ where: { whatsapp: phone }, orderBy: { createdAt: 'desc' } })
            if (lead) {
              const recentMsg = await prisma.message.findFirst({
                where: { leadId: lead.id, fromMe: true, externalId: null },
                orderBy: { timestamp: 'desc' }
              })
              if (recentMsg) {
                await prisma.message.update({
                  where: { id: recentMsg.id },
                  data: { externalId: messageId, ack: 1 }
                })
              }
            }
          } catch { /* ignore */ }
        }
        return { ok: true }
      }

      // Idempotência (anti-reentrega): a Evolution reenvia o MESMO messages.upsert
      // em reconexão/restart de instância/retry de webhook. Sem este guard, a mesma
      // mensagem (mesmo key.id) era reinserida por algum dos message.create abaixo
      // → duplicata na tela de Conversas. Mesma proteção que o Cloud API já tinha
      // (wamsg). SET NX é atômico (vence reentregas quase simultâneas); o fallback
      // em banco cobre Redis indisponível (reentregas em reconexão chegam depois,
      // então o findFirst por externalId pega). Só recebidas (fromMe já retornou).
      if (messageId) {
        try {
          const fresh = await redis.set(`evomsg:${messageId}`, '1', 'EX', 86400, 'NX')
          if (fresh === null) return { ok: true } // já processado
        } catch {
          const dup = await prisma.message.findFirst({
            where: { externalId: messageId, fromMe: false },
            select: { id: true },
          })
          if (dup) return { ok: true }
        }
      }

      const text = message.conversation ||
                   message.extendedTextMessage?.text ||
                   message.buttonsResponseMessage?.selectedButtonId ||
                   message.listResponseMessage?.singleSelectReply?.selectedRowId ||
                   ''

      // Resposta a Disparo Inteligente: marca o destinatário como respondido
      // (tira o resto da campanha da frente dele), conta para a taxa de resposta
      // — que é o termômetro de risco do módulo — e aplica opt-out quando o
      // texto é um pedido de saída ("PARE", "SAIR"). Best-effort: nunca segura
      // o processamento normal da mensagem.
      // `endsWith('@g.us')` em vez da variável de grupo: nem toda instalação
      // tem o suporte a grupos, e a checagem pelo JID vale em todas.
      if (phone && !remoteJid.endsWith('@g.us')) {
        import('../services/smartBroadcast/replies.js')
          .then((m) => m.registerReply(phone, text))
          .catch(() => {})
      }

      // Detect media messages
      let mediaType = 'text'
      let mediaUrl = ''
      let mediaName = ''
      let mediaCaption = ''

      if (message.imageMessage) {
        mediaType = 'image'
        mediaCaption = message.imageMessage.caption || ''
        mediaUrl = await saveEvolutionMedia(key, inboundInstance, 'image', message.imageMessage.mimetype || '', app)
      } else if (message.videoMessage) {
        // GIF no WhatsApp não é GIF: o app converte para MP4 sem áudio e marca
        // `gifPlayback`. Sem essa distinção o GIF chega como vídeo comum e a
        // conversa mostra um player parado, esperando play — que é o oposto de
        // um GIF. Guardamos o tipo 'gif' para a UI tocar em loop, sem controles.
        mediaType = message.videoMessage.gifPlayback ? 'gif' : 'video'
        mediaCaption = message.videoMessage.caption || ''
        mediaUrl = await saveEvolutionMedia(key, inboundInstance, mediaType, message.videoMessage.mimetype || '', app)
      } else if (message.audioMessage) {
        mediaType = 'audio'
        // Baixa UMA vez: salva o arquivo tocável E transcreve do mesmo buffer.
        try {
          const audioBuf = await downloadAudioFromEvolution(key, inboundInstance)
          if (audioBuf) {
            mediaUrl = await saveMediaBuffer(audioBuf, message.audioMessage.mimetype || '', 'audio', app)
            const transcription = await transcribeAudio(audioBuf)
            if (transcription) {
              mediaCaption = transcription
              app.log.info(`[Audio] Transcribed from ${phone}: ${transcription.substring(0, 100)}`)
            }
          }
        } catch (transcribeErr: any) {
          app.log.warn(`[Audio] error: ${transcribeErr.message}`)
        }
      } else if (message.documentMessage) {
        mediaType = 'document'
        mediaName = message.documentMessage.fileName || ''
        mediaCaption = message.documentMessage.caption || ''
        mediaUrl = await saveEvolutionMedia(key, inboundInstance, 'document', message.documentMessage.mimetype || '', app)
      } else if (message.stickerMessage) {
        mediaType = 'sticker'
        mediaUrl = await saveEvolutionMedia(key, inboundInstance, 'sticker', message.stickerMessage.mimetype || '', app)
      }

      const msgText = text || mediaCaption

      // ── Inbound de GRUPO ──
      // Caminho próprio e curto: grava a mensagem na conversa do grupo e para
      // aqui. NÃO segue para chatbot (responder no grupo é spam para todos os
      // participantes), detecção de origem ou enriquecimento — nada disso faz
      // sentido para um grupo, que não é uma pessoa. Aceita mídia sem legenda,
      // por isso vem depois da extração acima.
      if (isGroupMsg) {
        if (!msgText && mediaType === 'text') return { ok: true }
        const participantJid: string = key.participant || data.participant || ''
        const groupLead = await resolveGroupLead({ groupJid: remoteJid, instanceName: inboundInstance })
        const createdGroupMsg = await prisma.message.create({
          data: {
            leadId: groupLead.id,
            fromMe: false,
            body: msgText || `[${mediaType}]`,
            mediaType,
            mediaUrl: mediaUrl || null,
            mediaName: mediaName || null,
            // Quem falou dentro do grupo — sem isso a conversa fica ilegível.
            senderName: groupSenderName(data.pushName, participantJid),
            externalId: messageId || null,
            provider: 'evolution',
            evolutionInstance: inboundInstance,
            timestamp: new Date(),
          },
        })
        await prisma.lead.update({
          where: { id: groupLead.id },
          data: { unreadMessages: { increment: 1 }, lastMessageAt: new Date(), lastActivityAt: new Date() },
        })
        broadcastRealtimeEvent({
          type: 'message:received',
          payload: { leadId: groupLead.id, messageId: createdGroupMsg.id, mediaType, channel: 'whatsapp_group' },
          scope: { leadId: groupLead.id },
        })
        logEvent({
          leadId: groupLead.id,
          type: EVENT_TYPES.MESSAGE_RECEIVED,
          category: 'communication',
          title: 'Mensagem recebida em grupo de WhatsApp',
          channel: 'whatsapp',
          source: 'webhook',
          actorType: 'lead',
          description: (msgText || `[${mediaType}]`).substring(0, 200),
          metadata: { mediaType, messageId, groupJid: remoteJid, participant: participantJid || null },
        })
        app.log.info(`[Webhook] Grupo "${groupLead.nome}" (${remoteJid}) via ${inboundInstance}: ${(msgText || mediaType).substring(0, 80)}`)
        return { ok: true }
      }

      // Salva mídia SEM texto (imagem/áudio sem legenda/transcrição) aqui, pois
      // o fluxo abaixo só persiste quando há `msgText` (retorna em !msgText).
      // Mídia COM texto (ex.: áudio transcrito, imagem com legenda) NÃO entra
      // aqui: é persistida uma única vez pelo create downstream (atendimento ou
      // engine do chatbot), que já grava mediaType/mediaUrl/mediaName — evita a
      // duplicação (este bloco + o create de baixo gravavam a mesma mensagem).
      if (mediaType !== 'text' && !msgText && phone) {
        const existingLead = await prisma.lead.findFirst({
          where: { whatsapp: phone },
          orderBy: { createdAt: 'desc' }
        })
        if (existingLead) {
          await prisma.message.create({
            data: {
              leadId: existingLead.id,
              fromMe: false,
              body: msgText || `[${mediaType}]`,
              mediaType,
              mediaUrl,
              mediaName: mediaName || null,
              senderName: existingLead.nome || phone,
              externalId: messageId || null,
              provider: 'evolution',
              evolutionInstance: inboundInstance,
              timestamp: new Date()
            }
          })
          await prisma.lead.update({
            where: { id: existingLead.id },
            data: { unreadMessages: { increment: 1 }, lastMessageAt: new Date(), lastActivityAt: new Date() }
          })
          // If no text content, don't process through AI
          if (!msgText) return { ok: true }
        }
      }

      if (!msgText || !phone) return { ok: true }

      app.log.info(`WhatsApp msg from ${phone}: ${msgText.substring(0, 100)}`)

      // Log mensagem recebida (se lead existe)
      const existingLeadForLog = await prisma.lead.findFirst({ where: { whatsapp: phone }, orderBy: { createdAt: 'desc' } })

      // Foto de perfil do contato (assíncrono, não bloqueia): baixa e hospeda
      // localmente. O helper se auto-limita pelo TTL e migra URLs antigas
      // (pps.whatsapp.net, que expiram) para o avatar local estável.
      if (existingLeadForLog) {
        cacheProfilePicture(existingLeadForLog.id, existingLeadForLog.profilePicUrl, phone, inboundInstance, app)
      } else if (phone) {
        // Contato NOVO: o lead será criado adiante por este inbound (chatbot ou
        // atendimento). Resolve em background e já baixa a foto na 1ª mensagem.
        setTimeout(() => {
          prisma.lead.findFirst({ where: { whatsapp: phone }, orderBy: { createdAt: 'desc' } })
            .then((l) => { if (l) cacheProfilePicture(l.id, l.profilePicUrl, phone, inboundInstance, app) })
            .catch(() => {})
        }, 4000)
      }

      if (existingLeadForLog) {
        logEvent({
          leadId: existingLeadForLog.id,
          type: EVENT_TYPES.MESSAGE_RECEIVED,
          category: 'communication',
          title: 'Mensagem recebida via WhatsApp',
          channel: 'whatsapp',
          source: 'webhook',
          actorType: 'lead',
          description: msgText.substring(0, 200),
          metadata: { mediaType, messageId, phone },
        })
      }

      // Detectar origem da conversa
      let originData = null
      try {
        originData = await detectOrigin(phone, msgText, body.data, 'evolution')
      } catch (e) { app.log.warn(`Origin detection error: ${e}`) }

      // Strip tracking reference from message before processing
      const cleanMsg = stripTrackingRef(msgText)

      // Verificar se a instância tem chatbot vinculado — usar a instância real
      // que recebeu o webhook, não a env var EVOLUTION_INSTANCE.
      const whatsappInstance = await prisma.whatsAppInstance.findFirst({
        where: { instanceName: inboundInstance },
        select: { chatbotId: true, funnelId: true, stageKey: true }
      })
      // Gate de ativação por palavra-chave: se o chatbot exige gatilho e a mensagem
      // (cold start) não casa, trata como SEM chatbot → atendimento humano.
      const hasChatbot = whatsappInstance?.chatbotId != null && await chatbotTriggerAllows(whatsappInstance.chatbotId, phone, cleanMsg)

      if (!hasChatbot) {
        // Sem chatbot vinculado — apenas salvar mensagem no atendimento, sem IA
        app.log.info(`[Webhook] No chatbot linked to instance ${inboundInstance}, saving message only`)
        let lead = existingLeadForLog
        if (!lead) {
          const { generateUid } = await import('../services/dedup.js')
          // Fix C (Reforma F2): se a instância tem `ownerUserId`, o lead é
          // atribuído DIRETO ao operador dono — sem passar por cascata de
          // setor. resolveRoutingFromContext retorna { teamId, userId } —
          // userId não-nulo quando a instância é dedicada a um agente.
          const routing = await resolveRoutingFromContext({
            source: 'whatsapp',
            instanceName: inboundInstance,
          })
          const { deriveLeadOrigin } = await import('../lib/leadOrigin.js')
          lead = await prisma.lead.create({
            data: {
              uid: await generateUid(),
              nome: data.pushName || phone,
              empresa: '',
              whatsapp: phone,
              email: '',
              formData: { _source: 'whatsapp' },
              scores: {},
              lastStep: 0,
              completed: false,
              lastActivityAt: new Date(),
              source: 'whatsapp',
              originType: deriveLeadOrigin({ source: 'whatsapp', channel: 'whatsapp' }),
              teamId: routing.teamId,
              assignedUserId: routing.userId,
              assignedAt: routing.userId ? new Date() : null,
              waLid: waLidToPersist,
            }
          })
          if (routing.ruleName) {
            app.log.info(`[Webhook] Lead ${lead.id} roteado via "${routing.ruleName}" → team=${routing.teamId}, user=${routing.userId}`)
          }
        }
        await prisma.message.create({
          data: {
            leadId: lead.id,
            fromMe: false,
            body: msgText,
            mediaType: mediaType || 'text',
            mediaUrl: mediaUrl || null,
            mediaName: mediaName || null,
            provider: 'evolution',
            evolutionInstance: inboundInstance,
            senderName: data.pushName || lead.nome || phone,
            externalId: messageId || null,
            timestamp: new Date()
          }
        })
        await prisma.lead.update({
          where: { id: lead.id },
          data: { unreadMessages: { increment: 1 }, lastMessageAt: new Date(), lastActivityAt: new Date() }
        })

        // Reabre conversa se já existia mas estava encerrada (closedAt preenchido).
        // Lead que NUNCA teve conversa aberta fica na "Caixa de entrada bruta" —
        // a mensagem é registrada acima mas não vira ticket sozinha.
        if (lead.conversationOpenedAt && lead.conversationClosedAt) {
          const { ensureConversationOpen } = await import('../services/leadConversation.js')
          ensureConversationOpen(lead.id, { reason: 'reopen_message' }).catch(() => {})
        }

        // Auto-resposta fora do horário de atendimento (apenas no caminho sem chatbot)
        try {
          const { getBusinessHoursConfig, isWithinBusinessHours, shouldSendAutoReply } = await import('../services/businessHours.js')
          const bhConfig = await getBusinessHoursConfig()
          if (bhConfig.enabled && bhConfig.message && !isWithinBusinessHours(bhConfig)) {
            if (await shouldSendAutoReply(lead.id, bhConfig.throttleHours)) {
              const sent = await sendWhatsAppMessage(phone, bhConfig.message).catch(() => null)
              if (sent) {
                await prisma.message.create({
                  data: {
                    leadId: lead.id,
                    fromMe: true,
                    body: bhConfig.message,
                    mediaType: 'text',
                    provider: 'evolution',
                    evolutionInstance: inboundInstance,
                    senderName: 'Sistema (fora do expediente)',
                    externalId: sent?.key?.id || null,
                    timestamp: new Date(),
                  },
                })
                await prisma.leadEvent.create({
                  data: {
                    leadId: lead.id,
                    type: 'auto_reply_business_hours',
                    category: 'system',
                    title: 'Auto-resposta enviada (fora do horário)',
                    channel: 'whatsapp',
                    source: 'business_hours',
                    actorType: 'system',
                  },
                })
              }
            }
          }
        } catch (bhErr: any) {
          app.log.warn(`Business hours auto-reply error: ${bhErr.message}`)
        }

        return { ok: true }
      }

      // Processar mensagem do diagnóstico (via chatbot flow com Evolution provider)
      const evoSendFn = async (p: string, t: string) => {
        // Responde pela instância que recebeu a mensagem (multi-instância).
        const result = await sendWhatsAppMessage(p, t, inboundInstance)
        return { messageId: result?.key?.id || null }
      }
      // Chatbot determinístico (scripted): roda a jornada do form vinculado.
      const cbId = whatsappInstance?.chatbotId
      const chatbot = cbId ? await prisma.chatbot.findUnique({ where: { id: cbId } }) : null
      const promoteFunnelId = whatsappInstance?.funnelId ?? null
      const promoteStageKey = whatsappInstance?.stageKey ?? null
      // Jornada 100% IA: a IA conduz a conversa e chama ferramentas determinísticas.
      if (chatbot?.mode === 'ai_journey' && chatbot.formId) {
        const form = await prisma.form.findUnique({ where: { id: chatbot.formId } })
        if (form?.active) {
          const { processAiJourneyMessage } = await import('../services/aiJourneyEngine.js')
          await processAiJourneyMessage(phone, cleanMsg, app, messageId, evoSendFn, 'evolution', originData, cbId, inboundInstance, chatbot, form, null, promoteFunnelId, promoteStageKey, data.pushName || null)
          return { ok: true }
        }
      }
      if (chatbot?.mode === 'scripted' && chatbot.formId) {
        const form = await prisma.form.findUnique({ where: { id: chatbot.formId } })
        if (form?.active) {
          await processScriptedChatbotMessage(phone, cleanMsg, app, messageId, evoSendFn, 'evolution', originData, cbId, inboundInstance, chatbot, form, null, null, null, promoteFunnelId, promoteStageKey)
          return { ok: true }
        }
      }
      await processChatbotMessage(phone, cleanMsg, app, messageId, evoSendFn, 'evolution', originData, cbId, inboundInstance, null, null, promoteFunnelId, promoteStageKey)

      return { ok: true }
    } catch (err: any) {
      app.log.error(`Webhook error: ${err.message}`)
      return { ok: true } // Sempre retorna 200 para o webhook
    }
  })

  // GET /api/whatsapp/profile-pic/:phone — Busca/atualiza a foto do contato e a
  // hospeda localmente (URL estável). Força refresh removendo o avatar atual.
  app.get('/api/whatsapp/profile-pic/:phone', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const { phone } = req.params as any
      const number = String(phone).replace(/\D/g, '')
      const lead = await prisma.lead.findFirst({ where: { whatsapp: { contains: number.slice(-8) } }, orderBy: { createdAt: 'desc' } })
      if (!lead) return { profilePicUrl: null }
      // Força re-busca: passa currentUrl=null para ignorar o throttle.
      await cacheProfilePicture(lead.id, null, lead.whatsapp || number, evoInstance(), app)
      const updated = await prisma.lead.findUnique({ where: { id: lead.id }, select: { profilePicUrl: true } })
      return { profilePicUrl: updated?.profilePicUrl ?? null }
    } catch (err: any) {
      return { profilePicUrl: null }
    }
  })

  // ══════════════════════════════════════════════
  // PERFIL DO WHATSAPP (foto, nome, status)
  // ══════════════════════════════════════════════

  // GET /api/whatsapp/business-profile/:instanceName — Buscar perfil da instância
  app.get('/api/whatsapp/business-profile/:instanceName', { preHandler: adminOnly }, async (req, reply) => {
    const { instanceName } = req.params as any
    try {
      // 1. Buscar dados da instância (ownerJid, profilePicUrl)
      const instances = await evoFetch(`/instance/fetchInstances`, 'GET').catch(() => [])
      const inst = Array.isArray(instances) ? instances.find((i: any) => i.name === instanceName) : null
      const ownerJid = inst?.ownerJid || ''
      const phone = ownerJid.split('@')[0] || ''

      // 2. Buscar perfil completo (nome, foto, status) usando o número do owner
      let profileData: any = null
      if (phone) {
        profileData = await evoFetch(`/chat/fetchProfile/${instanceName}`, 'POST', { number: phone }).catch(() => null)
      }

      return {
        profilePicUrl: profileData?.picture || inst?.profilePicUrl || null,
        name: profileData?.name || inst?.profileName || null,
        status: profileData?.status?.status?.trim() || null,
        phone: phone || null,
        isBusiness: profileData?.isBusiness || false,
      }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // PUT /api/whatsapp/business-profile/:instanceName/name — Atualizar nome do perfil
  app.put('/api/whatsapp/business-profile/:instanceName/name', { preHandler: adminOnly }, async (req, reply) => {
    const { instanceName } = req.params as any
    const { name } = req.body as any
    if (!name || !name.trim()) return reply.code(400).send({ error: 'Nome é obrigatório' })
    try {
      await evoFetch(`/chat/updateProfileName/${instanceName}`, 'POST', { name: name.trim() })
      return { ok: true }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // PUT /api/whatsapp/business-profile/:instanceName/status — Atualizar status/recado
  app.put('/api/whatsapp/business-profile/:instanceName/status', { preHandler: adminOnly }, async (req, reply) => {
    const { instanceName } = req.params as any
    const { status } = req.body as any
    if (!status) return reply.code(400).send({ error: 'Status é obrigatório' })
    try {
      await evoFetch(`/chat/updateProfileStatus/${instanceName}`, 'POST', { status: status.trim() })
      return { ok: true }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // PUT /api/whatsapp/business-profile/:instanceName/picture — Atualizar foto do perfil
  app.put('/api/whatsapp/business-profile/:instanceName/picture', { preHandler: adminOnly }, async (req, reply) => {
    const { instanceName } = req.params as any
    const { url: pictureUrl } = req.body as any
    if (!pictureUrl) return reply.code(400).send({ error: 'URL da imagem é obrigatória' })
    try {
      const result = await evoFetch(`/chat/updateProfilePicture/${instanceName}`, 'POST', { picture: pictureUrl })
      return { ok: true, result }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // DELETE /api/whatsapp/business-profile/:instanceName/picture — Remover foto do perfil
  app.delete('/api/whatsapp/business-profile/:instanceName/picture', { preHandler: adminOnly }, async (req, reply) => {
    const { instanceName } = req.params as any
    try {
      // Usar imagem transparente 1x1 para "remover" (Evolution API não suporta remoção direta)
      await evoFetch(`/chat/updateProfilePicture/${instanceName}`, 'POST', {
        picture: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='
      })
      return { ok: true }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // POST /api/whatsapp/set-webhook — Configura webhook na instância
  app.post('/api/whatsapp/set-webhook', { preHandler: adminOnly }, async (req, reply) => {
    try {
      const webhookUrl = `${process.env.APP_URL || 'https://bychat.ia.br'}/api/whatsapp/webhook`
      const result = await evoFetch(`/webhook/set/${evoInstance()}`, 'POST', {
        webhook: {
          url: webhookUrl,
          enabled: true,
          webhookByEvents: false,
          webhookBase64: false,
          events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE']
        }
      })
      return { ok: true, webhookUrl, result }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })
}

// ─── WhatsApp Chat Processing ─────────────────────────────
// MOVIDO para src/services/chatbotFlow.ts → processChatbotMessage()
