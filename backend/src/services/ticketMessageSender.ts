// src/services/ticketMessageSender.ts
// Envio de mensagem numa conversa (ticket) do Conversas — ponto ÚNICO.
//
// Este código era o corpo de POST /api/atendimento/tickets/:leadId/messages.
// Saiu de lá para que o envio AGENDADO passe exatamente pelas mesmas regras que
// o envio manual. Reimplementar o envio por fora custaria repetir (e deixar
// divergir) oito regras que só existiam dentro do handler:
//
//   1. getProviderForSender  — o número de saída é o do REMETENTE
//   2. lockedChannelForLead  — conversa em andamento TRAVA o número; responder
//      por outro abre um segundo fio no aparelho do contato
//   3. canSendVia            — instância owner-only
//   4. janela de 24h         — fora dela a Cloud API só aceita template HSM
//   5. grupo               — a Cloud API não fala em grupo (limitação do Meta)
//   6. assinatura do operador no fim do texto
//   7. ensureConversationOpen — outbound reabre o ticket
//   8. Instagram/Messenger  — respondem pela Graph, não pelo WhatsApp
//
// A rota HTTP virou um invólucro: traduz o resultado em reply.code(). O erro
// carrega `status`/`code` porque o frontend já reage a CHANNEL_LOCKED e
// WINDOW_CLOSED — mudar esse contrato quebraria a UI.

import { prisma } from '../lib/prisma.js'
import { logEvent, EVENT_TYPES } from './leadHistory.js'
import { broadcastRealtimeEvent } from '../routes/realtime.js'
import { montarPrefixo } from './operatorIdentity.js'

export interface TicketMessageActor {
  userId: number
  role: string
  name?: string | null
  email?: string | null
}

export interface SendTicketMessageInput {
  leadId: number
  body?: string | null
  mediaType?: string | null
  mediaUrl?: string | null
  mediaName?: string | null
  isInternal?: boolean
  quotedMsgId?: number | null
  /** Override do seletor de número. Sem isto, resolve pelo remetente. */
  channelId?: string | null
  template?: { name?: string; language?: string; components?: unknown } | null
  actor: TicketMessageActor
  /** 'panel' = operador digitou agora · 'scheduled' = disparo agendado. */
  origin?: 'panel' | 'scheduled'
  /**
   * Continuação de uma sequência (a 2ª mensagem em diante de um envio quebrado).
   * Não leva a identificação do operador: essas mensagens costumam existir para
   * isolar algo que o cliente vai COPIAR — código PIX, cupom —, e um "*Rafael ·
   * Suporte*" na frente iria junto na cópia, quebrando justamente o motivo de
   * ter separado.
   */
  continuacao?: boolean
  /** Auditoria: vem de getOperator(req)/getIp(req) na rota; ausente no agendado. */
  operatorMeta?: Record<string, unknown>
  ipAddress?: string | null
  log?: { info: (msg: string) => void; error: (msg: string) => void }
}

export type SendTicketMessageResult =
  | { ok: true; message: any; pausedBot: boolean }
  | { ok: false; status: number; error: string; code?: string; detail?: string; lockedChannelId?: string }

const noopLog = { info: () => {}, error: () => {} }

/**
 * A mensagem é só um código para o cliente copiar?
 *
 * Rede de segurança do prefixo do operador: mesmo fora de uma sequência (o
 * operador colou o PIX sozinho no compositor), identificar quem falou colaria
 * o nome dentro do que vai ser copiado. Reconhece BR Code do PIX pelo formato
 * — começa com o payload EMV e fecha com CRC válido.
 */
export function ehCodigoCopiavel(body?: string | null): boolean {
  const t = (body || '').trim()
  // Só rejeita QUEBRA DE LINHA: o BR Code tem espaço no nome do beneficiário
  // ("ADSON CONCEICAO SANTOS"), então barrar espaço rejeitava o próprio PIX.
  if (!t || /[\n\r]/.test(t)) return false
  if (!/^000201/.test(t) || t.length < 60) return false
  const corpo = t.slice(0, -4)
  let crc = 0xffff
  for (let i = 0; i < corpo.length; i++) {
    crc ^= corpo.charCodeAt(i) << 8
    for (let j = 0; j < 8; j++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
  }
  return crc.toString(16).toUpperCase().padStart(4, '0') === t.slice(-4).toUpperCase()
}

export async function sendTicketMessage(input: SendTicketMessageInput): Promise<SendTicketMessageResult> {
  const {
    leadId: lid, mediaUrl, mediaName, isInternal, channelId, template,
    actor, origin = 'panel', operatorMeta, ipAddress, log = noopLog, continuacao,
  } = input
  const msgBody = input.body
  const mType = input.mediaType || 'text'

  // quotedMsgId é o ID interno (Message.id); o provider precisa do externalId.
  const quotedInternalId: number | null =
    typeof input.quotedMsgId === 'number' && Number.isFinite(input.quotedMsgId) ? input.quotedMsgId : null
  let quotedExternalId: string | null = null
  if (quotedInternalId !== null) {
    const ref = await prisma.message.findUnique({
      where: { id: quotedInternalId },
      select: { externalId: true, leadId: true },
    })
    if (ref && ref.leadId === lid) quotedExternalId = ref.externalId
  }

  if (mType === 'text' && (!msgBody || !msgBody.trim())) {
    return { ok: false, status: 400, error: 'Mensagem vazia' }
  }

  // Nome vem do banco (Meu Perfil), não do JWT, que pode estar velho. A signature
  // é anexada no fim das mensagens outbound de texto.
  const dbUser = await prisma.user.findUnique({
    where: { id: actor.userId },
    select: { name: true, email: true, signature: true },
  })
  const user = {
    userId: actor.userId,
    role: actor.role,
    name: dbUser?.name || actor.name,
    email: dbUser?.email || actor.email,
  }
  const userSignature = dbUser?.signature?.trim() || null

  const lead = await prisma.lead.findUnique({ where: { id: lid } })
  if (!lead) return { ok: false, status: 404, error: 'Lead nao encontrado' }

  // Operador mandou mensagem = atendimento ativo. Idempotente: cobre outbound em
  // lead que estava na caixa bruta ou em ticket já resolvido.
  if (!isInternal) {
    const { ensureConversationOpen } = await import('./leadConversation.js')
    ensureConversationOpen(lead.id, {
      byUserId: user.userId,
      byUserName: user.name || user.email || undefined,
      reason: 'outbound',
    }).catch(() => {})
  }

  let sentExternalId: string | null = null
  let sentProvider: string = 'evolution'
  let sentInstance: string | null = null
  let sentCloudConnId: number | null = null
  let sendError: string | null = null

  // Identificação do operador (Configurações › Conversas). Vai na PRIMEIRA linha
  // porque o WhatsApp não tem cabeçalho de remetente dentro da conversa. Nunca
  // em nota interna (não chega ao contato) nem em áudio/figurinha/HSM — o
  // próprio montarPrefixo devolve '' nesses casos.
  const prefixoOperador = isInternal || continuacao || ehCodigoCopiavel(msgBody)
    ? ''
    : await montarPrefixo({ leadId: lid, mediaType: mType, actorUserId: user.userId }).catch(() => '')

  const finalTextBody = (() => {
    const raw = (msgBody || '').trim()
    const comAssinatura = !isInternal && mType === 'text' && userSignature
      ? `${raw}\n\n_-- ${userSignature}_`
      : raw
    // Sem corpo (mídia sem legenda) o prefixo viraria uma legenda só com o nome
    // — o contato receberia a foto com "*Rafael · Suporte*" embaixo e nada mais.
    if (!prefixoOperador || !comAssinatura) return comAssinatura
    return `${prefixoOperador}${comAssinatura}`
  })()

  if (!isInternal) {
    // Lead de Instagram/Messenger → responde via Graph /me/messages.
    const igRecipient: string | null =
      (lead.source === 'instagram' || lead.source === 'messenger' ||
       (lead.uid || '').startsWith('instagram:') || (lead.uid || '').startsWith('messenger:'))
        ? ((lead.formData as any)?.instagramSenderId || (lead.formData as any)?.messengerSenderId ||
           (lead.uid || '').replace(/^(instagram|messenger):/, '') || null)
        : null

    if (igRecipient) {
      const igChannel = (lead.source === 'messenger' || (lead.uid || '').startsWith('messenger:')) ? 'messenger' : 'instagram'
      const lastIn = await prisma.message.findFirst({
        where: { leadId: lid, fromMe: false },
        orderBy: { timestamp: 'desc' },
        select: { timestamp: true },
      })
      const withinWindow = !!lastIn && (Date.now() - lastIn.timestamp.getTime()) < 24 * 3600 * 1000
      let attachment: { type: string; url: string } | undefined
      if (mType !== 'text') {
        if (!mediaUrl) return { ok: false, status: 400, error: 'Mídia sem arquivo para enviar.' }
        // Instagram não tem tipo próprio para figurinha nem GIF: figurinha (.webp)
        // vai como imagem e GIF (.mp4) como vídeo — o mais próximo do esperado.
        const igType = mType === 'image' || mType === 'sticker' ? 'image'
          : mType === 'video' || mType === 'gif' ? 'video'
            : mType === 'audio' ? 'audio' : 'file'
        const base = (process.env.APP_URL || '').replace(/\/$/, '')
        attachment = { type: igType, url: /^https?:\/\//.test(mediaUrl) ? mediaUrl : `${base}${mediaUrl}` }
      }
      const { sendInstagramDM } = await import('../routes/instagram.js')
      const r = await sendInstagramDM(igRecipient, finalTextBody, { withinWindow, attachment })
      sentProvider = igChannel
      sentExternalId = r.messageId
      sendError = r.error
    } else {
      try {
        const wp = await import('./whatsappProvider.js')
        let provider: any
        let instanceName: string | null
        let cloudConnId: number | null = null

        if (channelId) {
          // Override explícito do seletor de número. Valida acesso do operador.
          const allowed = await wp.resolveSenderChannels({ userId: user.userId, role: user.role })
          if (!allowed.some((c: any) => c.id === channelId)) {
            return { ok: false, status: 403, error: 'Você não tem acesso a esse número de envio.' }
          }
          // Conversa em andamento trava o número: o contato só conhece aquele por
          // onde falou. Exceção: SUPERADMIN pode trocar deliberadamente.
          const locked = wp.canOverrideConversationChannel(user.role)
            ? null
            : await wp.lockedChannelForLead(lid, { userId: user.userId, role: user.role })
          if (locked && locked.channelId !== channelId) {
            const lockedLabel = allowed.find((c: any) => c.id === locked.channelId)
            return {
              ok: false,
              status: 409,
              code: 'CHANNEL_LOCKED',
              lockedChannelId: locked.channelId,
              error: `Esta conversa já está em andamento pelo número ${lockedLabel?.number || lockedLabel?.label || locked.channelId}. A resposta precisa sair por ele — é o número que o contato conhece.`,
            }
          }
          const r = await wp.getProviderForChannel(channelId)
          provider = r.provider; instanceName = r.instanceName; cloudConnId = r.cloudApiConnectionId
        } else {
          // A instância vem do REMETENTE (AGENT usa a própria dedicada; admin sem
          // instância usa a default), inclusive a conexão Cloud dedicada dele.
          const r = await wp.getProviderForSender(lead, { userId: user.userId, role: user.role })
          provider = r.provider; instanceName = r.instanceName; cloudConnId = r.cloudApiConnectionId ?? null
        }
        sentProvider = provider.providerName
        sentInstance = instanceName
        sentCloudConnId = cloudConnId

        // Regra owner-only da instância.
        if (instanceName && provider.providerName === 'evolution') {
          const { canSendVia } = await import('./teamRouting.js')
          const ok = await canSendVia(user.userId, user.role, lid, instanceName)
          if (!ok.ok) {
            return { ok: false, status: 403, error: ok.reason || 'Sem permissão para enviar por essa instância' }
          }
        }

        // Grupo pela Cloud API é impossível: a Groups API do Meta só opera grupos
        // criados por ela mesma, exige selo verde e limita a 8 participantes.
        if ((lead as any).isGroup && provider.providerName === 'cloud_api') {
          return {
            ok: false,
            status: 400,
            code: 'GROUP_NOT_SUPPORTED_CLOUD_API',
            error: 'O WhatsApp Oficial (Cloud API) não envia mensagens para grupos. Use uma conexão Evolution para falar neste grupo.',
          }
        }

        // Janela de 24h (Cloud API): fora dela, só template HSM aprovado.
        if (provider.providerName === 'cloud_api' && mType !== 'template') {
          const win = await wp.getCloudWindowState(lid)
          if (!win.open) {
            return {
              ok: false,
              status: 409,
              code: 'WINDOW_CLOSED',
              error: 'Janela de 24h fechada: fora das 24h da última mensagem do contato, o WhatsApp Oficial só permite enviar um modelo (template) aprovado pela Meta.',
            }
          }
        }

        let result: any
        // Grupo: o destino é o JID "<id>@g.us" (não há telefone).
        const destinatario: string = (lead as any).groupJid || (lead as any).waLid || lead.whatsapp

        if (mType === 'template') {
          if (provider.providerName !== 'cloud_api') {
            return { ok: false, status: 400, error: 'Modelos HSM só podem ser enviados pelo WhatsApp Oficial (Cloud API).' }
          }
          if (!template?.name || !template?.language) {
            return { ok: false, status: 400, error: 'Template inválido (name e language obrigatórios).' }
          }
          result = await provider.sendTemplate(destinatario, template.name, template.language, template.components)
        } else if (mType === 'text') {
          result = await provider.sendText(destinatario, finalTextBody, quotedExternalId ? { quotedExternalId } : undefined)
        } else if (mType === 'audio') {
          result = await provider.sendAudio(destinatario, mediaUrl)
        } else {
          result = await provider.sendMedia(destinatario, mediaUrl, mType, finalTextBody || undefined, mediaName || undefined)
        }

        sentExternalId = result?.messageId || null
        log.info(`[Atendimento] Sent ${mType} via ${sentProvider}${instanceName ? ` (${instanceName})` : ''}${cloudConnId ? ` (cloud#${cloudConnId})` : ''}, externalId=${sentExternalId}`)
      } catch (sendErr: any) {
        sendError = sendErr.message
        // "Número não tem WhatsApp" numa conversa que ESTÁ acontecendo é a
        // checagem da Evolution falhando, não o cadastro errado (o provider já
        // repetiu no JID canônico antes de chegar aqui). Mandar o operador
        // "conferir o telefone no cadastro" nesse caso o faz mexer num número
        // certo — e o certo é tentar de novo.
        if (sendErr?.waNumberNotFound) {
          const prova = await prisma.message.findFirst({
            where: { leadId: lid, OR: [{ fromMe: false }, { ack: { gte: 2 } }] },
            select: { id: true },
          }).catch(() => null)
          if (prova) {
            sendError = 'O WhatsApp não confirmou o número agora — a conferência do servidor falhou, mas esta conversa já teve mensagem entregue. Tente enviar de novo em instantes.'
          }
        }
        log.error(`WhatsApp send error: ${sendErr.message}`)
      }
    }
  }

  // Falhou o envio (e não é nota interna): erro sem salvar. A mensagem já vem
  // traduzida dos providers (lib/whatsappErrors); o nome do canal só entra
  // quando NÃO é WhatsApp, para não gerar "Falha ao enviar via WhatsApp: o
  // número não tem WhatsApp".
  if (!isInternal && sendError) {
    const canalLabel = sentProvider === 'instagram' ? 'Instagram' : sentProvider === 'messenger' ? 'Messenger' : null
    return {
      ok: false,
      status: 502,
      error: canalLabel ? `${canalLabel}: ${sendError}` : sendError,
      detail: sendError,
    }
  }

  // Origem do canal (qual número saiu) — para distinguir conversas na UI.
  let outEvolutionInstance: string | null = null
  let outCloudApiConnectionId: number | null = null
  if (!isInternal) {
    if (sentProvider === 'evolution') {
      outEvolutionInstance = sentInstance
    } else if (sentProvider === 'cloud_api') {
      outCloudApiConnectionId = sentCloudConnId
        ?? (await prisma.cloudApiConnection.findFirst({ where: { active: true }, select: { id: true } }))?.id
        ?? null
    }
  }

  const message = await prisma.message.create({
    data: {
      leadId: lid,
      fromMe: true,
      body: finalTextBody,
      // Template HSM entra como texto (preview já renderizado) para ficar
      // legível no histórico de Conversas.
      mediaType: mType === 'template' ? 'text' : mType,
      mediaUrl: mediaUrl || null,
      mediaName: mediaName || null,
      isInternal: isInternal || false,
      provider: isInternal ? 'evolution' : sentProvider,
      evolutionInstance: outEvolutionInstance,
      cloudApiConnectionId: outCloudApiConnectionId,
      senderName: user.name || user.email || 'Agente',
      externalId: sentExternalId,
      quotedMsgId: quotedInternalId,
      ack: sentExternalId ? 1 : 0,
      timestamp: new Date(),
    },
  })

  // Registra o disparo Cloud API para o painel de acompanhamento/custo.
  if (!isInternal && sentProvider === 'cloud_api' && sentExternalId) {
    const { recordOutbound } = await import('./cloudApiBilling.js')
    recordOutbound({
      wamid: sentExternalId,
      connectionId: outCloudApiConnectionId,
      leadId: lid,
      templateName: mType === 'template' ? (template?.name ?? null) : null,
    }).catch(() => {})
  }

  broadcastRealtimeEvent({
    type: 'message:sent',
    payload: { leadId: lid, messageId: message.id, fromMe: true },
  })

  await prisma.lead.update({ where: { id: lid }, data: { lastMessageAt: new Date() } })

  // Takeover humano: o operador falou com o lead → o chatbot para de responder
  // nesta conversa até alguém devolvê-la ao bot. Nota interna não conta.
  let pausedBot = false
  if (!isInternal) {
    const { pauseBotForHuman } = await import('./botTakeover.js')
    pausedBot = await pauseBotForHuman(lid, { userId: user.userId, userName: user.name })
  }

  // Só chame de "do operador" quando houver operador identificado. Sem
  // operatorMeta o envio é automático (aviso de transferência, por exemplo), e
  // o título antigo afirmava um autor humano que a auditoria não tem como achar.
  const via = sentExternalId ? 'WhatsApp' : 'painel'
  const temOperador = Boolean((operatorMeta as any)?.userName)

  logEvent({
    leadId: lid,
    type: isInternal ? EVENT_TYPES.MESSAGE_INTERNAL : EVENT_TYPES.MESSAGE_SENT,
    category: 'communication',
    title: isInternal
      ? 'Nota interna adicionada'
      : origin === 'scheduled'
        ? `Mensagem agendada enviada via ${via}`
        : temOperador
          ? `Mensagem enviada pelo operador via ${via}`
          : `Mensagem automática enviada via ${via}`,
    channel: isInternal ? 'system' : (sentExternalId ? 'whatsapp' : 'manual'),
    source: origin === 'scheduled' ? 'scheduled' : 'panel',
    ...(operatorMeta || {}),
    description: (msgBody || '').substring(0, 200),
    metadata: { mediaType: mType, isInternal, externalId: sentExternalId, messageId: message.id, origin },
    ...(ipAddress ? { ipAddress } : {}),
  } as any)

  return { ok: true, message, pausedBot }
}
