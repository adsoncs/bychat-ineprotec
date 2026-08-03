// src/services/smartBroadcast/replies.ts
//
// Resposta do destinatário. É o sinal mais valioso do módulo inteiro: mensagem
// que gera conversa é mensagem que as pessoas queriam receber, e número que
// recebe resposta é número que o WhatsApp vê como legítimo.
//
// Serve a três coisas ao mesmo tempo:
//   • alimenta a taxa de resposta que o disjuntor usa para parar campanha ruim;
//   • melhora o score do número no rodízio;
//   • marca o destinatário como `replied`, o que tira o resto da sequência da
//     frente dele — quem já respondeu está falando com um humano agora.
//
// Chamado pelo webhook de mensagens recebidas (routes/whatsapp.ts).

import { prisma } from '../../lib/prisma.js'
import { phoneKey } from '../../lib/phone.js'
import { bumpCounters } from './health.js'

/** Só liga a resposta à campanha se ela veio numa janela plausível. */
const REPLY_WINDOW_MS = 72 * 3600_000

/** Palavras que significam "não me mande mais nada". */
const OPT_OUT_WORDS = /^\s*(pare|parar|sair|saia|cancelar|cancela|descadastrar|remover|stop|nao quero|não quero)\b/i

/**
 * Registra que este telefone respondeu. Idempotente: chamada repetida para o
 * mesmo destinatário não conta duas vezes.
 */
export async function registerReply(rawPhone: string, text: string | null | undefined): Promise<void> {
  const key = phoneKey(rawPhone)
  if (!key) return

  const since = new Date(Date.now() - REPLY_WINDOW_MS)
  const rec = await prisma.smartCampaignRecipient.findFirst({
    where: { phoneKey: key, status: { in: ['sent', 'delivered', 'read'] }, sentAt: { gte: since } },
    orderBy: { sentAt: 'desc' },
  })
  if (!rec) return

  await prisma.smartCampaignRecipient.update({
    where: { id: rec.id },
    data: { status: 'replied', repliedAt: new Date() },
  })
  const campaign = await prisma.smartCampaign.update({
    where: { id: rec.campaignId },
    data: { repliedCount: { increment: 1 } },
  }).catch(() => null)
  if (rec.assignedInstanceId) await bumpCounters(rec.assignedInstanceId, { replies: 1 }).catch(() => {})

  // Pedido explícito de saída vale mais que qualquer campanha em andamento.
  if (OPT_OUT_WORDS.test(String(text ?? ''))) {
    await applyOptOut(key, rec.leadId)
    return
  }

  // Quem respondeu está falando com gente agora: sai de qualquer outra campanha
  // que ainda não disparou para ele. Duas abordagens no mesmo dia, vindas de
  // números diferentes, é a forma mais rápida de virar denúncia.
  await prisma.smartCampaignRecipient.updateMany({
    where: { phoneKey: key, status: { in: ['pending', 'scheduled'] } },
    data: { status: 'skipped', skipReason: 'replied_elsewhere' },
  }).catch(() => {})

  if (campaign && rec.leadId) await applyReplyActions(campaign, rec.leadId)
}

/**
 * Ações configuradas para quando o contato responde: mover de etapa, atribuir
 * dono, registrar atividade de retorno. Sem isso a resposta cai na inbox e
 * depende de alguém reparar — que é como campanha boa vira lead perdido.
 */
async function applyReplyActions(campaign: { id: number; name: string; replyActions: unknown }, leadId: number): Promise<void> {
  const actions = (campaign.replyActions ?? {}) as {
    moveToFunnelId?: number
    moveToStageKey?: string
    assignToUserId?: number
    createActivity?: boolean
  }
  if (!actions || typeof actions !== 'object') return

  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { status: true, funnelId: true, assignedUserId: true } })
  if (!lead) return

  const data: Record<string, unknown> = {}
  if (actions.moveToStageKey) data.status = actions.moveToStageKey
  if (actions.moveToFunnelId) data.funnelId = actions.moveToFunnelId
  // Não rouba lead de quem já é dono — só preenche vazio.
  if (actions.assignToUserId && !lead.assignedUserId) data.assignedUserId = actions.assignToUserId

  if (Object.keys(data).length) {
    await prisma.lead.update({ where: { id: leadId }, data }).catch(() => {})
    const { logEvent } = await import('../leadHistory.js')
    const { EVENT_TYPES } = await import('../leadHistory.js')
    logEvent({
      leadId,
      type: EVENT_TYPES.STATUS_CHANGED,
      category: 'lifecycle',
      title: `Respondeu ao disparo "${campaign.name}"`,
      source: 'smart_broadcast',
      actorType: 'system',
      oldValue: lead.status,
      newValue: String(data.status ?? lead.status),
      metadata: { campaignId: campaign.id },
    })
  }

  if (actions.createActivity) {
    // `data` é montado solto de propósito: o modelo Activity não é idêntico em
    // todas as instalações (o campo de responsável só existe onde o módulo de
    // Resumo já foi aplicado). Tenta com responsável e, se o schema local não
    // conhecer o campo, refaz sem ele — a atividade é o que importa.
    const base: Record<string, unknown> = {
      leadId,
      type: 'follow_up',
      title: `Retornar contato — respondeu ao disparo "${campaign.name}"`.slice(0, 191),
      description: 'Criada automaticamente pelo módulo Disparos Inteligentes quando o contato respondeu.',
      // 30 min: resposta a disparo esfria rápido.
      scheduledAt: new Date(Date.now() + 30 * 60_000),
      status: 'pending',
    }
    await prisma.activity
      .create({ data: { ...base, assignedUserId: actions.assignToUserId ?? null } as any })
      .catch(() => prisma.activity.create({ data: base as any }))
      .catch((e) => console.warn('[smartBroadcast] atividade de retorno não criada:', e?.message))
  }
}

/**
 * Marca opt-out de WhatsApp no lead e remove o telefone de todas as campanhas
 * que ainda não dispararam para ele.
 */
export async function applyOptOut(key: string, leadId: number | null): Promise<void> {
  if (leadId) {
    const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { optOutChannels: true } })
    const current = Array.isArray(lead?.optOutChannels) ? (lead!.optOutChannels as string[]) : []
    if (!current.includes('whatsapp')) {
      await prisma.lead.update({
        where: { id: leadId },
        data: { optOutChannels: [...current, 'whatsapp'] as any },
      }).catch(() => {})
    }
  }
  await prisma.smartCampaignRecipient.updateMany({
    where: { phoneKey: key, status: { in: ['pending', 'scheduled'] } },
    data: { status: 'skipped', skipReason: 'opt_out' },
  })
  console.log(`[smartBroadcast] opt-out registrado para ${key}`)
}

/**
 * Confirmação de entrega/leitura vinda do webhook (MESSAGES_UPDATE da Evolution,
 * onde o ack sobe: 2 = entregue, 3 = lido).
 */
export async function applyAck(externalId: string, ack: number): Promise<void> {
  if (!externalId) return
  const data = ack >= 3
    ? { status: 'read', readAt: new Date() }
    : ack >= 2
      ? { status: 'delivered', deliveredAt: new Date() }
      : null
  if (!data) return
  // Nunca rebaixa: quem já respondeu não volta a ser "entregue".
  const rec = await prisma.smartCampaignRecipient.findFirst({ where: { externalId } })
  if (!rec || ['replied', 'read'].includes(rec.status)) return
  await prisma.smartCampaignRecipient.update({ where: { id: rec.id }, data }).catch(() => {})
  if (ack >= 2 && rec.assignedInstanceId && rec.status === 'sent') {
    await bumpCounters(rec.assignedInstanceId, { delivered: 1 }).catch(() => {})
  }
}
