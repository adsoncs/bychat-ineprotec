// src/services/atividadeWhatsapp.ts
//
// Envio de WhatsApp por ATIVIDADE — o único agendador de mensagem do sistema.
//
// Antes havia dois: o "Agendar mensagem" do Conversas (tabela própria, envio
// seguro) e a atividade de WhatsApp do módulo Atividades, que mandava direto
// pela Evolution — sem Cloud API, sem número da conversa, sem janela de 24h,
// sem opt-out, e gravando a mensagem no histórico à mão (sem id do WhatsApp,
// logo sem tiques e com risco de duplicar no eco do webhook). Os agendamentos
// do Conversas nem apareciam em Atividades.
//
// Agora o agendamento do Conversas É uma atividade, e toda atividade de
// WhatsApp sai pelo sendTicketMessage — o mesmo ponto do envio manual.
//
// Dados do envio ficam em `metadata` (sem migração de banco):
//   channelId        número de saída ("evolution:<inst>" | "cloud:<id>")
//   cancelIfReplied  cancela se o contato responder depois do agendamento
//   kind             'text' | 'template_hsm'
//   hsmPayload       { name, language, components } do modelo aprovado
//   attempts         tentativas de falha transitória
//   sentMessageId    Message.id gerado no envio

import { prisma } from '../lib/prisma.js'
import { canSendNow } from './messageGovernance.js'
import { sendTicketMessage } from './ticketMessageSender.js'
import { logEvent } from './leadHistory.js'

/** Depois disto a atividade vira 'failed' em vez de tentar para sempre. */
const MAX_TENTATIVAS = 3

export interface MetaEnvioWhatsapp {
  channelId?: string | null
  cancelIfReplied?: boolean
  kind?: 'text' | 'template_hsm'
  hsmPayload?: { name: string; language: string; components?: unknown } | null
  attempts?: number
  sentMessageId?: number
  [k: string]: unknown
}

type Erro = { ok: false; status: number; error: string; code?: string; lockedChannelId?: string }

/**
 * Valida o número de saída e a janela de 24h ANTES de gravar a atividade.
 *
 * Regra do número:
 *  - conversa em andamento (número travado) → é ele, sem escolha;
 *  - contato sem conversa (formulário, portal, Meta Ads…) → o operador
 *    PRECISA escolher; não há padrão, para ninguém mandar pelo número errado
 *    sem perceber.
 *
 * Janela: Cloud API com texto livre e janela fechada no horário escolhido é
 * recusada — só modelo aprovado (HSM) seria entregue.
 */
export async function validarEnvioWhatsapp(input: {
  leadId: number
  user: { userId: number; role: string }
  channelId?: string | null
  kind: 'text' | 'template_hsm'
  scheduledAt: Date
}): Promise<{ ok: true; channelId: string } | Erro> {
  const wp = await import('./whatsappProvider.js')
  const canais = await wp.resolveSenderChannels(input.user)
  const travado = await wp.canalDaConversa(input.leadId)

  let channelId = input.channelId || null
  if (travado) {
    if (channelId && channelId !== travado.channelId) {
      const c = canais.find((x: any) => x.id === travado.channelId)
      return {
        ok: false,
        status: 409,
        code: 'CHANNEL_LOCKED',
        lockedChannelId: travado.channelId,
        error: `Esta conversa é do número ${c?.number || c?.label || travado.channelId}. O envio sai por ele; para outro número, abra uma conversa nova por ele.`,
      }
    }
    if (!travado.ativo) {
      return {
        ok: false,
        status: 409,
        code: 'CHANNEL_UNAVAILABLE',
        error: 'O número desta conversa está desconectado. Reconecte-o em Canais para agendar — a mensagem não pode sair por outro número.',
      }
    }
    channelId = travado.channelId
  }
  if (!channelId) {
    return { ok: false, status: 400, code: 'CHANNEL_REQUIRED', error: 'Este contato ainda não tem conversa: escolha por qual número a mensagem vai sair.' }
  }
  const canal = canais.find((c: any) => c.id === channelId)
  if (!canal) {
    return { ok: false, status: 403, error: 'Você não tem acesso a esse número de envio.' }
  }

  if (input.kind === 'text' && canal.provider === 'cloud_api') {
    const connId = Number(String(canal.id).split(':')[1]) || null
    const win = await wp.getCloudWindowState(input.leadId, connId).catch(() => null)
    const numero = canal.number || canal.label
    const fechada = !win || !win.open
    const fechaAntes = !!win?.expiresAt && input.scheduledAt.getTime() > new Date(win.expiresAt).getTime()
    if (fechada || fechaAntes) {
      return {
        ok: false,
        status: 400,
        code: 'WINDOW_HSM_REQUIRED',
        error: fechada
          ? `A janela de 24h do número ${numero} está fechada: o contato não escreveu nas últimas 24h. Pelo WhatsApp Oficial só sai modelo aprovado — escolha um modelo.`
          : `No horário escolhido a janela de 24h do número ${numero} já terá fechado. Antecipe o horário ou escolha um modelo aprovado.`,
      }
    }
  }
  return { ok: true, channelId }
}

/** Atividade de WhatsApp que o executor deve ENVIAR (e não só lembrar). */
export function temEnvioWhatsapp(a: { type: string; messageBody?: string | null; attachmentUrl?: string | null; metadata?: unknown }): boolean {
  if (a.type !== 'whatsapp') return false
  const meta = (a.metadata || {}) as MetaEnvioWhatsapp
  return !!(a.messageBody?.trim() || a.attachmentUrl || (meta.kind === 'template_hsm' && meta.hsmPayload))
}

function tipoDaMidia(mime?: string | null): string {
  if (mime?.startsWith('image')) return 'image'
  if (mime?.startsWith('video')) return 'video'
  if (mime?.startsWith('audio')) return 'audio'
  return 'document'
}

/**
 * Envia a atividade e grava o desfecho nela. Devolve o texto do resultado.
 *
 * `manual`: o operador clicou em "Enviar agora" — quem clicou é o ator, e o
 * "cancelar se responder" não se aplica (a decisão de enviar é dele, agora).
 */
export async function enviarAtividadeWhatsapp(
  activity: any,
  opts: { manual?: { userId: number; role: string } } = {},
): Promise<string> {
  try {
    return await enviar(activity, opts)
  } catch (err: any) {
    // Nunca deixar presa em 'sending': erro inesperado vira falha legível.
    const r = `Falha: ${err?.message || 'erro desconhecido'}`
    await prisma.activity.update({ where: { id: activity.id }, data: { status: 'failed', result: r } }).catch(() => {})
    return r
  }
}

async function enviar(
  activity: any,
  opts: { manual?: { userId: number; role: string } },
): Promise<string> {
  const meta = ((activity.metadata || {}) as MetaEnvioWhatsapp)
  const salvar = async (data: Record<string, unknown>, metaExtra: Partial<MetaEnvioWhatsapp> = {}) => {
    await prisma.activity.update({
      where: { id: activity.id },
      data: { ...data, metadata: { ...meta, ...metaExtra } as any },
    })
  }

  // 1. O contato respondeu depois do agendamento? O follow-up perdeu o sentido.
  if (!opts.manual && meta.cancelIfReplied) {
    const respondeu = await prisma.message.findFirst({
      where: { leadId: activity.leadId, fromMe: false, timestamp: { gt: activity.createdAt } },
      select: { id: true },
    })
    if (respondeu) {
      const r = 'Cancelada automaticamente: o contato respondeu antes do horário agendado.'
      await salvar({ status: 'cancelled', result: r })
      return r
    }
  }

  // 2. Governança NA HORA do envio: opt-out entre agendar e enviar é o caso
  //    clássico. Bloqueio definitivo cancela; janela de silêncio reagenda.
  const gov = await canSendNow(activity.leadId, 'whatsapp')
  if (!gov.ok) {
    const definitivo = gov.reason === 'opt_out' || gov.reason === 'blacklist' || gov.reason === 'lead_not_found'
    if (definitivo || opts.manual) {
      const r = `Bloqueado por governança: ${gov.reason}${gov.details ? ` — ${gov.details}` : ''}`
      await salvar({ status: definitivo ? 'cancelled' : 'failed', result: r })
      return r
    }
    const retryAt = gov.retryAt ?? new Date(Date.now() + 30 * 60_000)
    await salvar({ status: 'pending', scheduledAt: retryAt })
    return `Reagendada para ${retryAt.toISOString()} (${gov.reason})`
  }

  // 3. Ator com o PAPEL REAL. Assumir SUPERADMIN furaria o número travado,
  //    justamente a regra que o envio manual respeita.
  let actor = opts.manual ?? null
  if (!actor) {
    const criador = activity.userId
      ? await prisma.user.findUnique({ where: { id: activity.userId }, select: { id: true, role: true, active: true } })
      : null
    if (!criador || criador.active === false) {
      const r = 'Quem agendou não está mais ativo no sistema — a mensagem não foi enviada.'
      await salvar({ status: 'failed', result: r })
      return r
    }
    actor = { userId: criador.id, role: criador.role }
  }

  const hsm = meta.kind === 'template_hsm' && meta.hsmPayload ? meta.hsmPayload : null
  // Variáveis ({{nome}}, {{empresa}}, {{operador}}…) resolvidas AGORA: se o
  // nome do lead mudou entre agendar e enviar, sai o do dia do envio. Antes,
  // digitadas sem modelo, iam literais para o contato.
  let corpo: string | null = activity.messageBody ?? null
  if (!hsm && corpo?.includes('{{')) {
    const lead = await prisma.lead.findUnique({ where: { id: activity.leadId } })
    const { resolveVariables } = await import('./workflowActions.js')
    corpo = resolveVariables(corpo, lead, { operador: activity.userName || '' })
  }
  const mandar = (channelId?: string | null) => sendTicketMessage({
    leadId: activity.leadId,
    body: corpo,
    ...(hsm
      ? { mediaType: 'template', template: hsm as any }
      : activity.attachmentUrl
        ? { mediaType: tipoDaMidia(activity.attachmentType), mediaUrl: activity.attachmentUrl, mediaName: activity.attachmentName ?? null }
        : { mediaType: 'text' }),
    actor,
    origin: 'scheduled',
    ...(channelId ? { channelId } : {}),
  })

  let r = await mandar(meta.channelId)
  // Entre agendar e enviar o contato pode ter respondido por outro número e
  // mudado o número da conversa: sai pelo número que a conversa usa AGORA.
  if (!r.ok && r.code === 'CHANNEL_LOCKED' && meta.channelId) r = await mandar(null)

  if (r.ok) {
    const res = 'Mensagem enviada pelo WhatsApp'
    await salvar({ status: 'sent', completedAt: new Date(), result: res }, { sentMessageId: r.message?.id })
    logEvent({
      leadId: activity.leadId,
      type: 'activity_executed',
      category: 'communication',
      title: `WhatsApp enviado: ${activity.title}`,
      channel: 'whatsapp',
      source: opts.manual ? 'panel' : 'system',
      actorType: opts.manual ? 'user' : 'system',
      description: (activity.messageBody || '').substring(0, 200),
      metadata: { activityId: activity.id, messageId: r.message?.id },
    } as any)
    return res
  }

  // Número travado, janela fechada, permissão: não se resolvem esperando.
  const definitivo = opts.manual || r.code === 'CHANNEL_LOCKED' || r.code === 'WINDOW_CLOSED' || r.status === 403 || r.status === 400
  const tentativas = (meta.attempts ?? 0) + 1
  if (definitivo || tentativas >= MAX_TENTATIVAS) {
    await salvar({ status: 'failed', result: r.error }, { attempts: tentativas })
  } else {
    await salvar({ status: 'pending', result: r.error, scheduledAt: new Date(Date.now() + 5 * 60_000) }, { attempts: tentativas })
  }
  return `Falha: ${r.error}`
}

/**
 * Leva para Atividades os agendamentos pendentes da tabela antiga
 * (bychat_scheduled_messages) e desliga o disparador antigo. Idempotente: só
 * mexe no que está 'pending', e marca cada um como 'migrada'.
 */
export async function migrarAgendadasAntigas(): Promise<void> {
  try {
    const { queues } = await import('../lib/queues.js')
    const q: any = queues.scheduledMessages
    await q.removeRepeatable?.('tick', { every: 60_000 }).catch?.(() => {})
    await q.drain?.().catch?.(() => {})
  } catch { /* fila antiga ausente: nada a desligar */ }

  const pendentes = await prisma.scheduledMessage.findMany({
    where: { status: 'pending' },
    include: { template: { select: { body: true } }, createdBy: { select: { name: true, email: true } } },
  })
  for (const sm of pendentes) {
    const lead = await prisma.lead.findUnique({ where: { id: sm.leadId }, select: { whatsapp: true } })
    const corpo = sm.body || sm.template?.body || null
    const a = await prisma.activity.create({
      data: {
        leadId: sm.leadId,
        userId: sm.createdByUserId,
        userName: sm.createdBy?.name || sm.createdBy?.email || null,
        assignedUserId: sm.createdByUserId,
        type: 'whatsapp',
        title: 'Mensagem agendada',
        status: 'pending',
        scheduledAt: sm.scheduledAt,
        recipientPhone: lead?.whatsapp ?? null,
        messageBody: corpo,
        templateId: sm.templateId,
        createdAt: sm.createdAt,
        metadata: {
          origem: 'conversas',
          channelId: sm.channelId,
          cancelIfReplied: sm.cancelIfReplied,
          kind: sm.kind === 'template_hsm' ? 'template_hsm' : 'text',
          ...(sm.hsmPayload ? { hsmPayload: sm.hsmPayload } : {}),
          migradaDeAgendamento: sm.id,
        } as any,
      },
    })
    await prisma.scheduledMessage.update({
      where: { id: sm.id },
      data: { status: 'migrada', errorMessage: `Migrada para a atividade #${a.id}` },
    })
  }
  if (pendentes.length) console.log(`[Activities] ${pendentes.length} agendamento(s) do Conversas migrado(s) para Atividades`)
}
