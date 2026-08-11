// src/services/scheduledMessageScheduler.ts
//
// Dispara as mensagens que o operador agendou no Conversas.
//
// Modelo: um job repetido a cada 60s ('tick') varre ScheduledMessage com
// status='pending' e scheduledAt <= now. Para cada uma:
//   1. cancelIfReplied — se o contato respondeu depois do agendamento, cancela.
//      Follow-up que chega depois de a pessoa já ter falado é constrangedor.
//   2. canSendNow — governança NA HORA do disparo, não no agendamento: opt-out
//      entre uma coisa e outra é o caso clássico, e mandar mensagem para quem
//      pediu descadastro é problema de LGPD, não bug de UX.
//   3. sendTicketMessage — o MESMO ponto do envio manual, então número travado,
//      janela de 24h e permissão de instância valem igual.
//
// O canal é resolvido no disparo (channelId é só uma dica gravada no
// agendamento): entre agendar e enviar, o contato pode ter respondido por outro
// número e mudado o lock da conversa.
//
// Limite por tick: 100. A 60s por tick isso dá 6k/hora — muito acima de
// qualquer volume realista de agendamento manual, e evita que um acúmulo
// (servidor parado a noite toda) vire uma rajada de centenas de envios.

import { Worker, Job } from 'bullmq'
import { prisma } from '../lib/prisma.js'
import { queues, redisConnection } from '../lib/queues.js'
import { bullmqJobsTotal, captureException } from '../lib/observability.js'
import { canSendNow } from './messageGovernance.js'
import { sendTicketMessage } from './ticketMessageSender.js'

const QUEUE_NAME = 'wf-scheduled-messages'
const TICK_JOB_NAME = 'tick'
const TICK_INTERVAL_MS = 60_000
const MAX_PER_TICK = 100
/** Depois disto o agendamento vira 'failed' em vez de tentar para sempre. */
const MAX_ATTEMPTS = 3

let worker: Worker | null = null

export async function startScheduledMessageScheduler(): Promise<void> {
  if (worker) return

  worker = new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      if (job.name !== TICK_JOB_NAME) return
      await processTick()
    },
    { connection: redisConnection, concurrency: 1 },
  )

  worker.on('failed', (job, err) => {
    console.error('[scheduledMessages] tick falhou:', err.message)
    bullmqJobsTotal.inc({ queue: QUEUE_NAME, status: 'failed' })
    captureException(err, { queue: QUEUE_NAME, jobId: job?.id })
  })
  worker.on('completed', () => {
    bullmqJobsTotal.inc({ queue: QUEUE_NAME, status: 'completed' })
  })

  // Job repetido; chamar de novo com os mesmos parâmetros é no-op (o BullMQ
  // deduplica pela repeat key).
  await queues.scheduledMessages.add(
    TICK_JOB_NAME,
    {},
    { repeat: { every: TICK_INTERVAL_MS }, removeOnComplete: 100, removeOnFail: 50 },
  )

  console.log(`[scheduledMessages] scheduler iniciado (tick ${TICK_INTERVAL_MS / 1000}s, até ${MAX_PER_TICK}/tick)`)
}

export async function processTick(): Promise<void> {
  const now = new Date()
  const devidas = await prisma.scheduledMessage.findMany({
    where: { status: 'pending', scheduledAt: { lte: now } },
    orderBy: { scheduledAt: 'asc' },
    take: MAX_PER_TICK,
    include: { template: { select: { id: true, body: true } } },
  })
  if (!devidas.length) return

  for (const sm of devidas) {
    try {
      await dispararUma(sm)
    } catch (err: any) {
      console.error(`[scheduledMessages] #${sm.id} erro inesperado: ${err?.message}`)
      await marcarFalha(sm.id, sm.attempts, err?.message || 'erro desconhecido')
    }
  }
}

async function dispararUma(sm: any): Promise<void> {
  // 1. O contato respondeu depois de agendarmos? Então o follow-up perdeu o sentido.
  if (sm.cancelIfReplied) {
    const respondeu = await prisma.message.findFirst({
      where: { leadId: sm.leadId, fromMe: false, timestamp: { gt: sm.createdAt } },
      select: { id: true },
    })
    if (respondeu) {
      await prisma.scheduledMessage.update({
        where: { id: sm.id },
        data: { status: 'skipped', errorMessage: 'Cancelada automaticamente: o contato respondeu antes do horário agendado.' },
      })
      return
    }
  }

  // 2. Governança na hora do envio (opt-out, blacklist, janela de silêncio,
  //    frequency cap). Bloqueio definitivo cancela; o resto reagenda.
  const gov = await canSendNow(sm.leadId, 'whatsapp')
  if (!gov.ok) {
    const hardBlock = gov.reason === 'opt_out' || gov.reason === 'blacklist' || gov.reason === 'lead_not_found'
    if (hardBlock) {
      await prisma.scheduledMessage.update({
        where: { id: sm.id },
        data: {
          status: 'skipped',
          errorMessage: `Bloqueado por governança: ${gov.reason}${gov.details ? ` — ${gov.details}` : ''}`,
        },
      })
      return
    }
    // silence_window / frequency_cap → empurra para quando puder.
    const retryAt = gov.retryAt ?? new Date(Date.now() + 30 * 60_000)
    await prisma.scheduledMessage.update({ where: { id: sm.id }, data: { scheduledAt: retryAt } })
    return
  }

  // 3. Corpo: o template é resolvido AGORA, não no agendamento — se o nome ou a
  //    etapa do lead mudaram no intervalo, sai o valor do dia do disparo.
  let body: string | null = sm.body ?? null
  if (sm.kind === 'text' && sm.templateId) {
    const bruto = sm.template?.body || sm.body || ''
    body = await resolverVariaveis(bruto, sm.leadId)
  }

  if (sm.kind === 'text' && (!body || !body.trim())) {
    await prisma.scheduledMessage.update({
      where: { id: sm.id },
      data: { status: 'failed', errorMessage: 'Mensagem vazia (template removido ou sem corpo).' },
    })
    return
  }

  // 4. Ator = quem agendou, com o PAPEL REAL dele. Nada de assumir SUPERADMIN
  //    para "facilitar": SUPERADMIN ignora o lock de canal, e o disparo passaria
  //    a furar justamente a regra que o envio manual respeita. Sem o criador
  //    (usuário excluído), não há em nome de quem enviar.
  const criador = sm.createdByUserId
    ? await prisma.user.findUnique({ where: { id: sm.createdByUserId }, select: { id: true, role: true, active: true } })
    : null
  if (!criador || criador.active === false) {
    await prisma.scheduledMessage.update({
      where: { id: sm.id },
      data: { status: 'failed', errorMessage: 'Quem agendou não está mais ativo no sistema — a mensagem não foi enviada.' },
    })
    return
  }

  // channelId NÃO é repassado de propósito: deixar o sender resolver o número
  // evita disparar por um canal que deixou de ser o da conversa desde então.
  const r = await sendTicketMessage({
    leadId: sm.leadId,
    body,
    mediaType: sm.kind === 'template_hsm' ? 'template' : 'text',
    template: sm.kind === 'template_hsm' ? (sm.hsmPayload as any) : null,
    actor: { userId: criador.id, role: criador.role },
    origin: 'scheduled',
  })

  if (r.ok) {
    await prisma.scheduledMessage.update({
      where: { id: sm.id },
      data: { status: 'sent', sentAt: new Date(), sentMessageId: r.message.id, errorMessage: null },
    })
    return
  }

  // CHANNEL_LOCKED e WINDOW_CLOSED não se resolvem sozinhos com o tempo —
  // insistir só empilharia tentativa. Falha direto, com o motivo legível.
  if (r.code === 'CHANNEL_LOCKED' || r.code === 'WINDOW_CLOSED' || r.status === 403 || r.status === 400) {
    await prisma.scheduledMessage.update({
      where: { id: sm.id },
      data: { status: 'failed', errorMessage: r.error, attempts: { increment: 1 } },
    })
    return
  }
  await marcarFalha(sm.id, sm.attempts, r.error)
}

/** Falha transitória: tenta de novo no próximo tick até MAX_ATTEMPTS. */
async function marcarFalha(id: number, attempts: number, erro: string): Promise<void> {
  const proxima = attempts + 1
  await prisma.scheduledMessage.update({
    where: { id },
    data: proxima >= MAX_ATTEMPTS
      ? { status: 'failed', errorMessage: erro, attempts: proxima }
      : { attempts: proxima, errorMessage: erro, scheduledAt: new Date(Date.now() + 5 * 60_000) },
  })
}

/** Interpola {{variaveis}} do template com os dados atuais do lead. */
async function resolverVariaveis(tpl: string, leadId: number): Promise<string> {
  if (!tpl.includes('{{')) return tpl
  const lead = await prisma.lead.findUnique({ where: { id: leadId } })
  if (!lead) return tpl
  const { resolveVariables } = await import('./workflowActions.js')
  return resolveVariables(tpl, lead, {})
}
