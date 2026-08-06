// src/routes/cloudApiWebhook.ts
// Webhook para receber mensagens e status da WhatsApp Cloud API Oficial

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { redis } from '../lib/redis.js'
import { getMetaAppSecret } from '../lib/meta.js'
import { validateWebhookSignature, markAsRead, downloadMedia, decryptToken, normalizePhone } from '../services/cloudApi.js'
import { processChatbotMessage, chatbotTriggerAllows } from '../services/chatbotFlow.js'
import { processScriptedChatbotMessage } from '../services/scriptedChatbotFlow.js'
import { logEvent, EVENT_TYPES } from '../services/leadHistory.js'
import { detectOrigin, stripTrackingRef, saveLeadOrigin } from '../services/originDetection.js'
import { broadcastRealtimeEvent } from './realtime.js'
import { resolveRoutingFromContext, resolveDefaultTeamId, pickOperatorForTeam } from '../services/teamRouting.js'
import { handleTemplateStatusWebhook, handleTemplateQualityWebhook } from '../services/cloudApiTemplates.js'
import { handleCallsWebhook } from '../services/cloudApiCallsWebhook.js'
import { handleMessageEchoes, handleAppStateSync, handleHistory } from '../services/cloudApiCoexistence.js'
import { tryConfirmBookingReply } from '../services/schedulingNotify.js'
import { generateUid } from '../services/dedup.js'
import { resolveLeadForContact, reconcileLeadIdentity } from '../services/contactIdentity.js'
import { deriveLeadOrigin } from '../lib/leadOrigin.js'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'

// ─── Status Mapping ─────────────────────────────────────

const STATUS_MAP: Record<string, number> = {
  'sent': 1,
  'delivered': 2,
  'read': 3,
  'failed': -1,
}

// ─── Routes ─────────────────────────────────────────────

export async function cloudApiWebhookRoutes(app: FastifyInstance) {

  // GET /api/cloud-api/webhook — Verificacao do webhook pela Meta
  app.get('/api/cloud-api/webhook', async (req, reply) => {
    const q = req.query as any
    const mode = q['hub.mode']
    const token = q['hub.verify_token']
    const challenge = q['hub.challenge']

    if (mode !== 'subscribe' || !token) {
      return reply.code(403).send('Verification failed')
    }

    // Buscar verify token da conexao ativa
    const conn = await prisma.cloudApiConnection.findFirst({ where: { active: true } })
    const expectedToken = conn?.verifyToken || process.env.CLOUD_API_VERIFY_TOKEN || ''

    if (token === expectedToken) {
      app.log.info('[CloudAPI] Webhook verified successfully')
      return reply.code(200).send(challenge)
    }

    app.log.warn(`[CloudAPI] Webhook verification failed: token mismatch`)
    return reply.code(403).send('Verification failed')
  })

  // POST /api/cloud-api/webhook — Receber eventos da Cloud API
  app.post('/api/cloud-api/webhook', async (req, reply) => {
    try {
      // Validar assinatura HMAC (obrigatório quando app secret configurado)
      const rawBody = (req as any).rawBody as Buffer | undefined
      const signature = req.headers['x-hub-signature-256'] as string
      const appSecret = await getMetaAppSecret()
      if (appSecret) {
        if (!rawBody || !signature) {
          app.log.warn('[CloudAPI] Missing webhook signature — rejecting')
          return reply.code(401).send('Missing webhook signature')
        }
        if (!validateWebhookSignature(rawBody, signature, appSecret)) {
          app.log.warn('[CloudAPI] Invalid webhook signature')
          return reply.code(401).send('Invalid signature')
        }
      } else {
        // Sem app secret configurado não há como validar a assinatura. Por padrão
        // aceitamos (legado) com alerta; com CLOUD_API_WEBHOOK_STRICT=1 rejeitamos
        // (fail-closed) para impedir injeção de eventos forjados.
        if (process.env.CLOUD_API_WEBHOOK_STRICT === '1') {
          app.log.warn('[CloudAPI][SECURITY] sem app secret + STRICT — rejeitando webhook não verificável')
          return reply.code(401).send('Webhook signature required')
        }
        app.log.warn('[CloudAPI][SECURITY] app secret ausente — webhook aceito SEM verificação de assinatura. Configure META_APP_SECRET.')
      }

      const body = req.body as any

      // Responder 200 imediatamente (Meta exige < 20s)
      reply.code(200).send('OK')

      // Processar payload
      if (body?.object !== 'whatsapp_business_account') return

      for (const entry of (body.entry || [])) {
        const wabaId = String(entry.id || '')

        for (const change of (entry.changes || [])) {
          const value = change.value || {}

          // ── Status de template (aprovação/reprovação/pausa) em tempo real ──
          // Antes esses eventos eram descartados e o status local ficava preso em
          // PENDING. (Requer que o campo esteja habilitado no Webhook do App Meta.)
          if (change.field === 'message_template_status_update') {
            await handleTemplateStatusWebhook(wabaId, value).catch(err =>
              app.log.error(`[CloudAPI] template status update error: ${err.message}`))
            continue
          }
          if (change.field === 'message_template_quality_update') {
            await handleTemplateQualityWebhook(wabaId, value).catch(err =>
              app.log.error(`[CloudAPI] template quality update error: ${err.message}`))
            continue
          }

          // ── Chamadas de voz (WhatsApp Business Calling API) ──
          // Requer o campo `calls` habilitado no Webhook do App Meta.
          if (change.field === 'calls') {
            const callPhoneNumberId = value.metadata?.phone_number_id || ''
            const callConn = await prisma.cloudApiConnection.findFirst({
              where: { active: true, phoneNumberId: callPhoneNumberId },
              select: { id: true, phoneNumberId: true, ownerUserId: true },
            })
            if (!callConn) {
              app.log.warn(`[CloudAPI][calls] No connection for phoneNumberId ${callPhoneNumberId}`)
              continue
            }
            await handleCallsWebhook(value, callConn, app).catch(err =>
              app.log.error(`[CloudAPI][calls] handler error: ${err.message}`))
            continue
          }

          // ── Coexistência (número também ativo no app do celular) ──
          // `smb_message_echoes` = o dono respondeu pelo aparelho;
          // `smb_app_state_sync` = agenda de contatos do app;
          // `history` = importação das conversas antigas, pós-onboarding.
          if (change.field === 'smb_message_echoes' || change.field === 'smb_app_state_sync' || change.field === 'history') {
            const coexPhoneId = value.metadata?.phone_number_id || ''
            const coexConn = await prisma.cloudApiConnection.findFirst({
              where: { active: true, phoneNumberId: coexPhoneId },
              select: { id: true, phoneNumberId: true },
            })
            if (!coexConn) {
              app.log.warn(`[Coexistence] sem conexão para phoneNumberId ${coexPhoneId}`)
              continue
            }
            if (change.field === 'smb_message_echoes') {
              await handleMessageEchoes(value, coexConn, app).catch(err =>
                app.log.error(`[Coexistence] echoes: ${err.message}`))
            } else if (change.field === 'smb_app_state_sync') {
              await handleAppStateSync(value, app).catch(err =>
                app.log.error(`[Coexistence] state sync: ${err.message}`))
            } else {
              await handleHistory(value, coexConn, app).catch(err =>
                app.log.error(`[Coexistence] history: ${err.message}`))
            }
            continue
          }

          if (change.field !== 'messages') continue

          const phoneNumberId = value.metadata?.phone_number_id || ''

          // Buscar conexao para este WABA/phone
          const conn = await prisma.cloudApiConnection.findFirst({
            where: { active: true, phoneNumberId }
          })
          if (!conn) {
            app.log.warn(`[CloudAPI] No connection for phoneNumberId ${phoneNumberId}`)
            continue
          }

          const token = decryptToken(conn.systemUserToken)

          // Processar mensagens recebidas
          if (value.messages) {
            const contacts = value.contacts || []
            for (const msg of value.messages) {
              const contactName =
                contacts.find((c: any) => c.wa_id === msg.from)?.profile?.name ||
                contacts[0]?.profile?.name ||
                ''
              await processIncomingMessage(msg, phoneNumberId, token, conn, app, contactName).catch(err => {
                app.log.error(`[CloudAPI] Message processing error: ${err.message}`)
              })
            }
          }

          // Processar status updates
          if (value.statuses) {
            for (const status of value.statuses) {
              await processStatusUpdate(status, app).catch(err => {
                app.log.error(`[CloudAPI] Status update error: ${err.message}`)
              })
            }
          }
        }
      }
    } catch (err: any) {
      app.log.error(`[CloudAPI] Webhook error: ${err.message}`)
    }
  })
}

// ─── Process Incoming Message ───────────────────────────

async function processIncomingMessage(
  msg: any,
  phoneNumberId: string,
  token: string,
  conn: any,
  app: FastifyInstance,
  contactName: string = ''
) {
  const phone = normalizePhone(msg.from || '')
  const msgId = msg.id || ''
  const msgType = msg.type || 'text'
  const timestamp = msg.timestamp ? new Date(parseInt(msg.timestamp) * 1000) : new Date()

  if (!phone) return

  // Marcar como lida automaticamente
  if (msgId) {
    markAsRead(phoneNumberId, token, msgId).catch(() => {})
  }

  // Idempotência/anti-replay: a Meta reenvia o mesmo evento em falha de ACK.
  // SET NX no wamid garante que cada mensagem é processada uma única vez (evita
  // mensagem duplicada + re-disparo de fluxos de chatbot/IA).
  if (msgId) {
    try {
      const fresh = await redis.set(`wamsg:${msgId}`, '1', 'EX', 86400, 'NX')
      if (fresh === null) return // já processado
    } catch { /* redis indisponível — segue (a coluna externalId ainda evita parte) */ }
  }

  // Extrair conteudo baseado no tipo
  let text = ''
  let mediaType = 'text'
  let mediaUrl = ''
  let mediaName = ''
  // Id do botão/linha clicado (interactive reply). Preservado para casar a opção
  // diretamente pelo value no motor de chatbot (mais robusto que casar por texto,
  // que pode vir truncado ao limite de 20 chars do WhatsApp).
  let interactiveReplyId: string | null = null
  // Respostas de um WhatsApp Flow (nfm_reply) — todos os campos coletados de uma vez.
  let flowResponse: Record<string, any> | null = null

  switch (msgType) {
    case 'text':
      text = msg.text?.body || ''
      break

    case 'image':
      mediaType = 'image'
      text = msg.image?.caption || ''
      if (msg.image?.id) {
        mediaUrl = await saveCloudApiMedia(msg.image.id, token, 'image', app)
      }
      break

    case 'video':
      mediaType = 'video'
      text = msg.video?.caption || ''
      if (msg.video?.id) {
        mediaUrl = await saveCloudApiMedia(msg.video.id, token, 'video', app)
      }
      break

    case 'audio':
      mediaType = 'audio'
      if (msg.audio?.id) {
        mediaUrl = await saveCloudApiMedia(msg.audio.id, token, 'audio', app)
      }
      break

    case 'document':
      mediaType = 'document'
      text = msg.document?.caption || ''
      mediaName = msg.document?.filename || ''
      if (msg.document?.id) {
        mediaUrl = await saveCloudApiMedia(msg.document.id, token, 'document', app)
      }
      break

    case 'sticker':
      mediaType = 'sticker'
      if (msg.sticker?.id) {
        mediaUrl = await saveCloudApiMedia(msg.sticker.id, token, 'sticker', app)
      }
      break

    case 'location':
      text = `📍 Localização: ${msg.location?.latitude}, ${msg.location?.longitude}`
      if (msg.location?.name) text += ` (${msg.location.name})`
      break

    case 'interactive':
      if (msg.interactive?.button_reply) {
        text = msg.interactive.button_reply.title || msg.interactive.button_reply.id || ''
        interactiveReplyId = msg.interactive.button_reply.id || null
      } else if (msg.interactive?.list_reply) {
        text = msg.interactive.list_reply.title || msg.interactive.list_reply.id || ''
        interactiveReplyId = msg.interactive.list_reply.id || null
      } else if (msg.interactive?.nfm_reply) {
        // WhatsApp Flow concluído: as respostas vêm em response_json (string).
        text = '[formulário preenchido]'
        try { flowResponse = JSON.parse(msg.interactive.nfm_reply.response_json || '{}') } catch { flowResponse = {} }
      }
      break

    case 'button':
      text = msg.button?.text || msg.button?.payload || ''
      break

    case 'reaction':
      // Ignorar reacoes por enquanto
      return

    default:
      text = `[${msgType}]`
  }

  const msgText = text

  // Sem conteúdo de texto nem mídia — nada a registrar
  if (!msgText && mediaType === 'text') return

  // Confirmação de agendamento: lead com reserva pendente tocou no botão "Confirmar
  // reunião" (type button/interactive) ou respondeu afirmativo. Marca confirmada e
  // responde — sem deixar o chatbot tratar o "Sim" como conversa.
  try {
    const confirmed = await tryConfirmBookingReply(phone, msgText, interactiveReplyId)
    if (confirmed) return
  } catch (e) { app.log.warn(`Booking confirm error: ${e}`) }

  // Detectar origem da conversa (Cloud API pode ter referral de CTWA ads)
  let originData = null
  try {
    originData = await detectOrigin(phone, msgText, msg, 'cloud_api')
  } catch (e) { app.log.warn(`Origin detection error: ${e}`) }

  // conn.chatbotId define o modo, espelhando a instância Evolution
  // (COM chatbot → bot de IA; SEM chatbot → atendimento humano).
  // Gate de ativação: se o chatbot exige palavra-chave e a mensagem (cold start) não
  // casa, trata como SEM chatbot → cai no atendimento humano abaixo.
  const hasChatbot = conn.chatbotId != null && await chatbotTriggerAllows(conn.chatbotId, phone, msgText)

  if (!hasChatbot) {
    // ── Atendimento humano: salva a mensagem e roteia, sem rodar IA ──
    // Match tolerante ao 9º dígito: o Cloud API às vezes entrega o número BR
    // sem o nono dígito (5562991138484 → 556291138484). Tenta exato e cai para
    // os últimos 8 dígitos, igual ao webhook Evolution (whatsapp.ts:481,879) —
    // evita criar lead duplicado para um contato que já existe.
    // Identidade canônica unificada (lib/phone.ts + contactIdentity): casa por
    // phoneKey EXATO, colapsando todas as variações (com/sem 55, com/sem 9º dígito).
    // Substitui o antigo "whatsapp contains últimos-8" (frágil e propenso a duplicar).
    const resolved = await resolveLeadForContact({ phone })
    let lead = resolved.lead
      ? await prisma.lead.findUnique({ where: { id: resolved.lead.id } })
      : null
    if (lead) {
      // Backfill preguiçoso: garante phoneKey em leads legados que casaram.
      await reconcileLeadIdentity(
        lead.id,
        { whatsapp: lead.whatsapp, waLid: lead.waLid, phoneKey: lead.phoneKey },
        { phone },
      )
    }

    if (!lead) {
      // Roteamento por equipe/agente, espelhando o webhook Evolution:
      //   1. conn.ownerUserId → conexão dedicada a um agente (bypass, F2);
      //   2. regras V2 (resolveRoutingFromContext);
      //   3. conn.defaultTeamId (setor padrão da conexão) → fallback global;
      //   4. picker do setor (round-robin/least-loaded conforme Team.routingMode).
      let routedTeamId: number | null = null
      let routedUserId: number | null = null
      let routedRuleName: string | null = null
      if (conn.ownerUserId) {
        routedUserId = conn.ownerUserId
      } else {
        const routing = await resolveRoutingFromContext({ source: 'whatsapp', chatbotId: conn.chatbotId ?? null })
        routedTeamId = routing.teamId
        routedUserId = routing.userId
        routedRuleName = routing.ruleName ?? null
        if (!routedTeamId && !routedUserId) {
          routedTeamId = conn.defaultTeamId ?? await resolveDefaultTeamId({ chatbotId: conn.chatbotId ?? null })
          if (routedTeamId) {
            routedUserId = await pickOperatorForTeam(routedTeamId)
          }
        }
      }
      const originType = (originData?.originType as any) || deriveLeadOrigin({
        source: 'whatsapp',
        channel: 'whatsapp',
        utmSource: originData?.utmSource ?? null,
        ctwaClid: originData?.ctwaClid ?? null,
        gclid: originData?.gclid ?? null,
        trackableLinkId: originData?.trackableLinkId ?? null,
      })
      lead = await prisma.lead.create({
        data: {
          uid: await generateUid(),
          nome: contactName || phone,
          empresa: '',
          whatsapp: phone,
          email: '',
          formData: { _source: 'whatsapp' },
          scores: {},
          lastStep: 0,
          completed: false,
          lastActivityAt: new Date(),
          source: 'whatsapp',
          originType,
          teamId: routedTeamId,
          assignedUserId: routedUserId,
          assignedAt: routedUserId ? new Date() : null,
        }
      })
      if (originData) {
        saveLeadOrigin(lead.id, originData).catch(e => app.log.warn(`Origin save error: ${e}`))
      }
      logEvent({
        leadId: lead.id,
        type: EVENT_TYPES.LEAD_CREATED,
        category: 'lifecycle',
        title: 'Lead criado via WhatsApp Cloud API',
        channel: 'whatsapp',
        source: 'webhook',
        actorType: 'lead',
        description: `Novo lead iniciou conversa pelo WhatsApp (${phone})`,
        metadata: { phone, source: 'whatsapp', provider: 'cloud_api', originType },
      })
      const routedVia = conn.ownerUserId ? 'conexão dedicada (agente)' : (routedRuleName || (conn.defaultTeamId ? 'setor padrão da conexão' : 'fallback'))
      app.log.info(`[CloudAPI] Lead ${lead.id} roteado via "${routedVia}" → team=${routedTeamId}, user=${routedUserId}`)
    }

    const created = await prisma.message.create({
      data: {
        leadId: lead.id,
        fromMe: false,
        body: msgText || `[${mediaType}]`,
        mediaType: mediaType || 'text',
        mediaUrl: mediaUrl || null,
        mediaName: mediaName || null,
        provider: 'cloud_api',
        cloudApiConnectionId: conn.id,
        senderName: contactName || lead.nome || phone,
        externalId: msgId || null,
        timestamp,
      }
    })
    // Reforma F4: scope.leadId — só sockets com acesso ao lead recebem.
    broadcastRealtimeEvent({
      type: 'message:received',
      payload: { leadId: lead.id, messageId: created.id, mediaType, channel: 'cloud_api' },
      scope: { leadId: lead.id },
    })
    await prisma.lead.update({
      where: { id: lead.id },
      data: { unreadMessages: { increment: 1 }, lastMessageAt: new Date(), lastActivityAt: new Date() }
    })
    logEvent({
      leadId: lead.id,
      type: EVENT_TYPES.MESSAGE_RECEIVED,
      category: 'communication',
      title: 'Mensagem recebida via WhatsApp Cloud API',
      channel: 'whatsapp',
      source: 'webhook',
      actorType: 'lead',
      description: (msgText || `[${mediaType}]`).substring(0, 200),
      metadata: { mediaType, messageId: msgId, phone, provider: 'cloud_api' },
    })

    // Reabre conversa se já existia mas estava encerrada (paridade Evolution).
    // Lead que nunca teve conversa aberta fica na "Caixa de entrada bruta".
    if (lead.conversationOpenedAt && lead.conversationClosedAt) {
      const { ensureConversationOpen } = await import('../services/leadConversation.js')
      ensureConversationOpen(lead.id, { reason: 'reopen_message' }).catch(() => {})
    }
    return
  }

  // ── Com chatbot vinculado: roda o bot de IA, passando o chatbotId correto ──
  if (!msgText) return
  app.log.info(`[CloudAPI] Message from ${phone}: ${msgText.substring(0, 100)}`)

  const cleanMsg = stripTrackingRef(msgText)
  const sendFn = async (p: string, t: string) => {
    const { sendTextMessage } = await import('../services/cloudApi.js')
    return sendTextMessage(phoneNumberId, token, p, t)
  }
  // Cloud API → suporta botões/lista nativos. Injetado nos motores de chatbot;
  // se ausente (Evolution), eles renderizam as opções como texto numerado.
  const sendInteractiveFn = async (p: string, interactive: any) => {
    const { sendInteractiveMessage } = await import('../services/cloudApi.js')
    return sendInteractiveMessage(phoneNumberId, token, p, interactive)
  }

  // Chatbot determinístico (scripted): roda a jornada do form vinculado.
  const chatbot = conn.chatbotId ? await prisma.chatbot.findUnique({ where: { id: conn.chatbotId } }) : null
  // Jornada 100% IA: a IA conduz a conversa e chama ferramentas determinísticas.
  if (chatbot?.mode === 'ai_journey' && chatbot.formId) {
    const form = await prisma.form.findUnique({ where: { id: chatbot.formId } })
    if (form?.active) {
      const { processAiJourneyMessage } = await import('../services/aiJourneyEngine.js')
      await processAiJourneyMessage(phone, cleanMsg, app, msgId, sendFn, 'cloud_api', originData, conn.chatbotId, null, chatbot, form, sendInteractiveFn, conn.funnelId ?? null, conn.stageKey ?? null, contactName)
      return
    }
  }
  if (chatbot?.mode === 'scripted' && chatbot.formId) {
    const form = await prisma.form.findUnique({ where: { id: chatbot.formId } })
    if (form?.active) {
      await processScriptedChatbotMessage(phone, cleanMsg, app, msgId, sendFn, 'cloud_api', originData, conn.chatbotId, null, chatbot, form, sendInteractiveFn, interactiveReplyId, flowResponse, conn.funnelId ?? null, conn.stageKey ?? null)
      return
    }
  }
  await processChatbotMessage(phone, cleanMsg, app, msgId, sendFn, 'cloud_api', originData, conn.chatbotId, null, sendInteractiveFn, interactiveReplyId, conn.funnelId ?? null, conn.stageKey ?? null)
}

// ─── Process Status Update ──────────────────────────────

async function processStatusUpdate(status: any, app: FastifyInstance) {
  const msgId = status.id || ''
  const statusValue = status.status || ''
  const ack = STATUS_MAP[statusValue]

  if (!msgId) return

  if (ack !== undefined) {
    const result = await prisma.message.updateMany({
      where: { externalId: msgId },
      data: { ack }
    })
    if (result.count > 0) {
      app.log.info(`[CloudAPI] ACK ${msgId} -> ${statusValue} (ack=${ack})`)
    }
  }

  // Captura categoria/cobrança que a Meta envia em pricing/conversation — base do
  // painel de custo. (Antes era descartado: só o ack era usado.)
  const error = statusValue === 'failed' && status.errors?.length > 0 ? status.errors[0] : null
  if (error) {
    app.log.error(`[CloudAPI] Message ${msgId} failed: ${error.code} - ${error.title}: ${error.message}`)
  }
  try {
    const pricing = status.pricing || {}
    // Atualiza destinatário de broadcast (se a msg for de uma campanha).
    import('../services/broadcast.js').then(m => m.applyStatusToBroadcast(msgId, statusValue)).catch(() => {})
    const { applyStatusToLog } = await import('../services/cloudApiBilling.js')
    await applyStatusToLog(msgId, {
      status: statusValue || undefined,
      category: pricing.category ?? status.conversation?.origin?.type ?? undefined,
      billable: typeof pricing.billable === 'boolean' ? pricing.billable : undefined,
      pricingModel: pricing.pricing_model ?? undefined,
      errorCode: error ? String(error.code) : undefined,
      errorTitle: error ? String(error.title || error.message || '') : undefined,
    })
  } catch (e: any) {
    app.log.warn(`[CloudAPI] billing log update failed for ${msgId}: ${e.message}`)
  }
}

// ─── Media Download Helper ──────────────────────────────

async function saveCloudApiMedia(mediaId: string, token: string, type: string, app: FastifyInstance): Promise<string> {
  try {
    const { buffer, mimeType } = await downloadMedia(mediaId, token)

    // Determinar extensao
    const extMap: Record<string, string> = {
      'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
      'video/mp4': 'mp4', 'video/3gpp': '3gp',
      'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/opus': 'opus',
      'application/pdf': 'pdf',
    }
    const ext = extMap[mimeType] || type.substring(0, 3)

    // Salvar em uploads/
    const uploadsDir = join(process.cwd(), '..', 'uploads', 'cloud-api')
    mkdirSync(uploadsDir, { recursive: true })

    const fileName = `${randomUUID()}.${ext}`
    const filePath = join(uploadsDir, fileName)
    writeFileSync(filePath, buffer)

    // Retornar URL relativa
    return `/uploads/cloud-api/${fileName}`
  } catch (err: any) {
    app.log.error(`[CloudAPI] Media download failed for ${mediaId}: ${err.message}`)
    return ''
  }
}
