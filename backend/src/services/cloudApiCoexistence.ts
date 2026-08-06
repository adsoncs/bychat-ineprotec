// src/services/cloudApiCoexistence.ts
//
// Espelhamento do app WhatsApp Business (coexistência).
//
// Num número em coexistência o dono continua atendendo pelo celular. Sem tratar
// estes webhooks, o ByChat enxerga só metade da conversa: vê o que o cliente
// manda e o que o painel responde, mas NÃO vê o que o vendedor respondeu pelo
// aparelho. O histórico fica furado e — pior — o chatbot continua achando que
// ninguém atendeu, e responde por cima de uma conversa humana em andamento.
//
// Dois webhooks entram aqui:
//   • smb_message_echoes  — mensagem enviada pelo app do celular
//   • smb_app_state_sync  — contatos da agenda do app (nome do contato)
//
// Regra que vale a pena registrar: mensagem vinda do celular é humano falando.
// Por isso ela PAUSA o bot, exatamente como faz o operador que responde pelo
// painel (services/botTakeover.ts). Sem isso a coexistência criaria o problema
// que o takeover foi feito para resolver.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { redis } from '../lib/redis.js'
import { phoneKey } from '../lib/phone.js'
import { resolveLeadForContact } from './contactIdentity.js'
import { pauseBotForHuman } from './botTakeover.js'
import { normalizePhone } from './cloudApi.js'
import { broadcastRealtimeEvent } from '../routes/realtime.js'

/** Texto legível a partir do corpo da mensagem, por tipo. */
function extractContent(msg: any): { text: string; mediaType: string; mediaUrl: string; mediaName: string } {
  const type = msg?.type || 'text'
  switch (type) {
    case 'text':
      return { text: msg.text?.body || '', mediaType: 'text', mediaUrl: '', mediaName: '' }
    case 'image':
      return { text: msg.image?.caption || '', mediaType: 'image', mediaUrl: '', mediaName: '' }
    case 'video':
      return { text: msg.video?.caption || '', mediaType: 'video', mediaUrl: '', mediaName: '' }
    case 'audio':
      return { text: '', mediaType: 'audio', mediaUrl: '', mediaName: '' }
    case 'document':
      return { text: msg.document?.caption || '', mediaType: 'document', mediaUrl: '', mediaName: msg.document?.filename || '' }
    case 'sticker':
      return { text: '', mediaType: 'sticker', mediaUrl: '', mediaName: '' }
    case 'location':
      return { text: `📍 ${msg.location?.name || ''} ${msg.location?.address || ''}`.trim() || '📍 Localização', mediaType: 'text', mediaUrl: '', mediaName: '' }
    case 'contacts':
      return { text: '👤 Contato compartilhado', mediaType: 'text', mediaUrl: '', mediaName: '' }
    default:
      return { text: `[${type}]`, mediaType: 'text', mediaUrl: '', mediaName: '' }
  }
}

/**
 * Mensagens que o dono enviou PELO CELULAR. Grava como `fromMe` na conversa do
 * lead, para o operador do painel ver a conversa inteira.
 */
export async function handleMessageEchoes(
  value: any,
  conn: { id: number; phoneNumberId: string },
  app: FastifyInstance,
): Promise<void> {
  const echoes: any[] = Array.isArray(value?.message_echoes) ? value.message_echoes : []
  if (!echoes.length) return

  for (const msg of echoes) {
    const msgId = String(msg?.id || '')
    // `to` é o cliente — `from` aqui é o próprio número da empresa.
    const clientPhone = normalizePhone(String(msg?.to || ''))
    if (!clientPhone) continue

    // Idempotência: a Meta reenvia o mesmo evento quando não recebe ACK. Sem
    // isso a mesma mensagem apareceria repetida na conversa.
    if (msgId) {
      try {
        const fresh = await redis.set(`wamsg-echo:${msgId}`, '1', 'EX', 86400, 'NX')
        if (fresh === null) continue
      } catch { /* redis fora: o filtro por externalId abaixo ainda protege */ }
    }

    // A mensagem enviada PELO PAINEL também volta como echo. Ela já foi gravada
    // no envio, então gravar de novo duplicaria — o externalId denuncia.
    if (msgId) {
      const already = await prisma.message.findFirst({ where: { externalId: msgId }, select: { id: true } })
      if (already) continue
    }

    const resolved = await resolveLeadForContact({ phone: clientPhone }).catch(() => null)
    const lead = resolved?.lead
    if (!lead) {
      // Conversa que só existe no celular e nunca passou pelo ByChat. Criar lead
      // aqui é decisão de produto (poluiria a base com quem o vendedor contatou
      // por fora), então por ora só registramos.
      app.log.info(`[Coexistence] echo de ${clientPhone} sem lead correspondente — ignorado`)
      continue
    }

    const { text, mediaType, mediaUrl, mediaName } = extractContent(msg)
    const timestamp = msg?.timestamp ? new Date(parseInt(msg.timestamp) * 1000) : new Date()

    await prisma.message.create({
      data: {
        leadId: lead.id,
        fromMe: true,
        body: text || `[${mediaType}]`,
        mediaType,
        mediaUrl: mediaUrl || null,
        mediaName: mediaName || null,
        provider: 'cloud_api',
        cloudApiConnectionId: conn.id,
        externalId: msgId || null,
        senderName: 'Celular',
        timestamp,
        ack: 1,
      },
    }).catch((e) => app.log.warn(`[Coexistence] falha ao gravar echo: ${e.message}`))

    // Humano assumiu pelo celular → bot sai de cena, como no takeover do painel.
    await pauseBotForHuman(lead.id, { userId: null, userName: 'Atendimento pelo celular' }).catch(() => {})

    // Atualiza a conversa aberta no painel na hora (mesmo evento do inbound).
    broadcastRealtimeEvent({
      type: 'message:received',
      payload: { leadId: lead.id, mediaType, channel: 'cloud_api', fromPhone: true },
      scope: { leadId: lead.id },
    }).catch(() => {})
    await prisma.lead.update({
      where: { id: lead.id },
      data: { lastMessageAt: timestamp, lastActivityAt: new Date() },
    }).catch(() => {})
    app.log.info(`[Coexistence] echo do celular → lead ${lead.id} (${clientPhone})`)
  }
}

/**
 * Contatos da agenda do app. Serve para dar NOME a quem o ByChat só conhece
 * pelo número — o vendedor já salvou "João da Obra" no celular, e a conversa
 * no painel aparecia como "5562...".
 */
export async function handleAppStateSync(
  value: any,
  app: FastifyInstance,
): Promise<void> {
  const items: any[] = Array.isArray(value?.state_sync) ? value.state_sync : []
  if (!items.length) return

  let renamed = 0
  for (const item of items) {
    if (item?.type !== 'contact') continue
    // 'remove' apaga o contato da agenda do celular — não é motivo para mexer
    // no lead do CRM, que tem vida própria.
    if (item?.action === 'remove') continue

    const phone = normalizePhone(String(item?.contact?.phone_number || ''))
    const fullName = String(item?.contact?.full_name || '').trim()
    if (!phone || !fullName) continue

    const key = phoneKey(phone)
    if (!key) continue

    const lead = await prisma.lead.findFirst({
      where: { phoneKey: key },
      orderBy: { createdAt: 'desc' },
      select: { id: true, nome: true },
    }).catch(() => null)
    if (!lead) continue

    // Só preenche quando o lead está sem nome de verdade (ou nomeado com o
    // próprio telefone). Sobrescrever um nome que o operador digitou seria
    // deixar a agenda do celular mandar no CRM.
    const atual = (lead.nome || '').trim()
    const semNome = !atual || atual === phone || /^\+?\d[\d\s()-]*$/.test(atual)
    if (!semNome) continue

    await prisma.lead.update({ where: { id: lead.id }, data: { nome: fullName.slice(0, 191) } }).catch(() => {})
    renamed++
  }
  if (renamed) app.log.info(`[Coexistence] ${renamed} lead(s) renomeado(s) pela agenda do celular`)
}

/**
 * Histórico importado (webhook `history`), disparado pela sincronização
 * pós-onboarding. Chega em blocos e pode levar até 24h.
 *
 * Grava apenas o que casa com lead existente e ainda não está na conversa.
 */
export async function handleHistory(
  value: any,
  conn: { id: number; phoneNumberId: string },
  app: FastifyInstance,
): Promise<void> {
  const threads: any[] = Array.isArray(value?.history) ? value.history : []
  if (!threads.length) return

  let saved = 0
  for (const thread of threads) {
    const msgs: any[] = Array.isArray(thread?.messages) ? thread.messages : []
    for (const msg of msgs) {
      const msgId = String(msg?.id || '')
      if (!msgId) continue
      const exists = await prisma.message.findFirst({ where: { externalId: msgId }, select: { id: true } })
      if (exists) continue

      // `from` = quem enviou. Se for o número da empresa, é mensagem nossa.
      const fromMe = normalizePhone(String(msg?.from || '')) === normalizePhone(value?.metadata?.display_phone_number || '')
      const otherPhone = normalizePhone(String(fromMe ? msg?.to : msg?.from) || '')
      if (!otherPhone) continue

      const resolved = await resolveLeadForContact({ phone: otherPhone }).catch(() => null)
      if (!resolved?.lead) continue

      const { text, mediaType, mediaName } = extractContent(msg)
      await prisma.message.create({
        data: {
          leadId: resolved.lead.id,
          fromMe,
          body: text || `[${mediaType}]`,
          mediaType,
          mediaName: mediaName || null,
          provider: 'cloud_api',
          cloudApiConnectionId: conn.id,
          externalId: msgId,
          senderName: fromMe ? 'Celular (histórico)' : null,
          timestamp: msg?.timestamp ? new Date(parseInt(msg.timestamp) * 1000) : new Date(),
          ack: fromMe ? 1 : 0,
        },
      }).then(() => { saved++ }).catch(() => {})
    }
  }
  if (saved) app.log.info(`[Coexistence] histórico: ${saved} mensagem(ns) importada(s)`)
}

/**
 * Pede à Meta a sincronização de contatos e histórico. Assíncrono: a resposta é
 * só o aceite, os dados chegam depois pelos webhooks acima.
 */
export async function requestSync(
  phoneNumberId: string,
  token: string,
  syncType: 'history' | 'smb_app_state_sync',
): Promise<{ requestId: string | null }> {
  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/smb_app_data`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', sync_type: syncType }),
  })
  const data: any = await res.json()
  if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`)
  return { requestId: data?.request_id ?? null }
}
