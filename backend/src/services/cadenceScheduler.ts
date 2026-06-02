// src/services/cadenceScheduler.ts
//
// Sales Engagement B1: Worker BullMQ que dirige as cadências outbound.
//
// Modelo: um job repetido a cada 60s ('tick') varre `CadenceEnrollment` com
// status='active' e `nextActionAt <= now`. Pra cada uma:
//   1. Carrega o step atual (`cadenceId`, `order = currentStep`).
//   2. Executa via `executeStep(step, enrollment)` — em B1 é stub que loga;
//      B2 vai conectar com `dispatchAction`, B3 vai criar Activity p/ steps manuais.
//   3. Avança `currentStep += 1`. Se há próximo step, calcula `nextActionAt`
//      somando `dayOffset + hourOffset` ao agora. Se não há, marca
//      `status='completed'` com `exitReason='completed_all_steps'`.
//
// Limite por tick: 200 enrollments. Mais que isso e o worker ficaria pesado;
// como o tick roda a cada 60s, 200/min = 12k/hora — folgado pra qualquer cenário
// realista de cadências outbound.

import { Worker, Job } from 'bullmq'
import { prisma } from '../lib/prisma.js'
import { queues, redisConnection } from '../lib/queues.js'
import { bullmqJobsTotal, captureException } from '../lib/observability.js'
import { canSendNow, type Channel } from './messageGovernance.js'
import { resolveVariables } from './workflowActions.js'
import { appendPreferencesLink } from './preferencesToken.js'
import { eventBus, type DomainEvent } from '../lib/eventBus.js'
import { classifyReply, type ReplyClass } from './cadenceReplyClassifier.js'

const QUEUE_NAME = 'wf-cadence-scheduler'
const TICK_JOB_NAME = 'tick'
const TICK_INTERVAL_MS = 60_000
const MAX_ENROLLMENTS_PER_TICK = 200

let worker: Worker | null = null

/** Inicia o worker + agenda o job repetido. Idempotente: se já há um job
 * recorrente registrado com o mesmo nome, o BullMQ ignora (mesma key). */
export async function startCadenceScheduler(): Promise<void> {
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
    console.error(`[cadenceScheduler] tick falhou:`, err.message)
    bullmqJobsTotal.inc({ queue: QUEUE_NAME, status: 'failed' })
    captureException(err, { queue: QUEUE_NAME, jobId: job?.id })
  })
  worker.on('completed', () => {
    bullmqJobsTotal.inc({ queue: QUEUE_NAME, status: 'completed' })
  })

  // Job repetido. `repeat.every` cria a chave repeatable; chamar de novo com
  // os mesmos parâmetros é no-op (BullMQ deduplica por key).
  await queues.cadenceScheduler.add(
    TICK_JOB_NAME,
    {},
    { repeat: { every: TICK_INTERVAL_MS }, removeOnComplete: 100, removeOnFail: 50 },
  )

  // B5: pause-on-reply. Quando o lead responde (qualquer canal monitorado pelo
  // bus), pausa as enrollments ativas em cadências com `pauseOnReply=true`.
  eventBus.on('message.received', handleMessageReceived)

  // Fase 23: Ganho/Perdido encerram qualquer cadência ativa do lead, sem
  // depender de `exitOnConversion` ou `exitOnStatuses` configurados.
  eventBus.on('lead.won', (e: DomainEvent) => { exitAllForLead(e.leadId, 'won').catch(() => {}) })
  eventBus.on('lead.lost', (e: DomainEvent) => {
    exitAllForLead(e.leadId, 'lost').catch(() => {})
    // Fase 23.1: auto-enroll em cadências de recuperação configuradas com a objeção.
    const reasonId = e.payload?.metadata?.reasonId
    if (reasonId) {
      autoEnrollByLossReason(e.leadId, Number(reasonId)).catch((err) => {
        console.error(`[cadenceScheduler] auto-enroll falhou lead ${e.leadId} reason ${reasonId}:`, err)
      })
    }
  })
}

// Fase 23.1: ao marcar lead como Perdido, inscreve-o em cadências ativas
// configuradas com `entryOnLossReasonIds` contendo a objeção.
// Dedup natural pelo @@unique([cadenceId, leadId]); upsert respeita re-perda.
async function autoEnrollByLossReason(leadId: number, reasonId: number): Promise<void> {
  const candidates = await prisma.salesCadence.findMany({
    where: { status: 'active' },
    select: {
      id: true,
      name: true,
      entryOnLossReasonIds: true,
      steps: { select: { order: true, dayOffset: true, hourOffset: true }, orderBy: { order: 'asc' }, take: 1 },
    },
  })
  const matched = candidates.filter(c => {
    const ids = Array.isArray(c.entryOnLossReasonIds) ? (c.entryOnLossReasonIds as any[]).map(Number) : []
    return ids.includes(reasonId)
  })
  if (matched.length === 0) return

  for (const cad of matched) {
    const firstStep = cad.steps[0]
    const offsetMs =
      ((firstStep?.dayOffset ?? 0) * 86_400_000) +
      ((firstStep?.hourOffset ?? 0) * 3_600_000)
    const nextActionAt = new Date(Date.now() + offsetMs)

    // Se já existe enrollment ativo/pausado nesta cadência, não recria.
    const existing = await prisma.cadenceEnrollment.findUnique({
      where: { cadenceId_leadId: { cadenceId: cad.id, leadId } },
      select: { id: true, status: true },
    })
    if (existing && (existing.status === 'active' || existing.status === 'paused')) continue

    if (existing) {
      // Reativa enrollment encerrado/completo (re-perda com mesma objeção).
      await prisma.cadenceEnrollment.update({
        where: { id: existing.id },
        data: {
          status: 'active',
          currentStep: 0,
          nextActionAt,
          exitReason: null,
          pauseReason: null,
          lastReplyClass: null,
          lastActionAt: null,
          enrolledAt: new Date(),
        },
      })
    } else {
      await prisma.cadenceEnrollment.create({
        data: {
          leadId,
          cadenceId: cad.id,
          status: 'active',
          currentStep: 0,
          nextActionAt,
        },
      })
    }
    console.log(`[cadenceScheduler] lead ${leadId} auto-inscrito em "${cad.name}" (#${cad.id}) por objeção ${reasonId}`)
  }
}

async function exitAllForLead(leadId: number, reason: 'won' | 'lost'): Promise<void> {
  if (!leadId) return
  try {
    const result = await prisma.cadenceEnrollment.updateMany({
      where: { leadId, status: { in: ['active', 'paused'] } },
      data: { status: 'exited', exitReason: reason, nextActionAt: null, lastActionAt: new Date() },
    })
    if (result.count > 0) {
      console.log(`[cadenceScheduler] lead ${leadId} → ${result.count} enrollment(s) encerrado(s) por ${reason}`)
    }
  } catch (err) {
    console.error(`[cadenceScheduler] falha encerrando enrollments do lead ${leadId} por ${reason}:`, err)
  }
}

async function handleMessageReceived(event: DomainEvent): Promise<void> {
  if (!event.leadId) return
  try {
    const enrollments = await prisma.cadenceEnrollment.findMany({
      where: {
        leadId: event.leadId,
        status: 'active',
        cadence: { pauseOnReply: true, status: 'active' },
      },
      select: { id: true },
    })
    if (enrollments.length === 0) return

    // C4: classifica antes de reagir. Se IA falhar (sem key, erro de rede,
    // resposta fora do enum), cai pro fallback de pause cego (B5).
    const lastMsg = await prisma.message.findFirst({
      where: { leadId: event.leadId, fromMe: false },
      orderBy: { timestamp: 'desc' },
      select: { body: true },
    })

    let replyClass: ReplyClass | null = null
    if (lastMsg?.body?.trim()) {
      try {
        replyClass = await classifyReply(lastMsg.body)
      } catch (err) {
        console.warn(`[cadenceScheduler] classifier falhou, usando fallback:`, (err as Error).message)
      }
    }

    const ids = enrollments.map((e) => e.id)
    await applyReplyReaction(event.leadId, ids, replyClass)
  } catch (err) {
    console.error(`[cadenceScheduler] reply handling lead ${event.leadId} falhou:`, err)
    captureException(err as Error, { stage: 'reply_reaction', leadId: event.leadId })
  }
}

/** Reage à classificação. Sempre persiste `lastReplyClass` (mesmo null) pra debug. */
async function applyReplyReaction(
  leadId: number,
  enrollmentIds: number[],
  replyClass: ReplyClass | null,
): Promise<void> {
  const now = new Date()

  // Sem classificação → fallback ao pause cego (comportamento original B5).
  if (!replyClass) {
    await prisma.cadenceEnrollment.updateMany({
      where: { id: { in: enrollmentIds } },
      data: {
        status: 'paused',
        pauseReason: 'reply_received',
        lastActionAt: now,
      },
    })
    return
  }

  // Atualiza lastReplyClass em todos (até 100; em prática são 1-2 por lead).
  await prisma.cadenceEnrollment.updateMany({
    where: { id: { in: enrollmentIds } },
    data: { lastReplyClass: replyClass, lastActionAt: now },
  })

  switch (replyClass) {
    case 'positiva':
    case 'duvida': {
      // Não pausa — cadência continua, mas operador é notificado pra tomar ação.
      const title =
        replyClass === 'positiva'
          ? 'Lead respondeu positivamente — ligar/responder hoje'
          : 'Lead enviou dúvida — responder'
      await createOperatorActivity(leadId, title, replyClass)
      break
    }
    case 'objecao': {
      await prisma.cadenceEnrollment.updateMany({
        where: { id: { in: enrollmentIds } },
        data: { status: 'paused', pauseReason: 'objection_received' },
      })
      await createOperatorActivity(leadId, 'Tratar objeção do lead', 'objecao')
      break
    }
    case 'desinteresse': {
      // Opt-out inferido: marca todos os canais e exited.
      await prisma.lead.update({
        where: { id: leadId },
        data: { optOutChannels: ['whatsapp', 'email', 'sms'] },
      })
      await prisma.cadenceEnrollment.updateMany({
        where: { id: { in: enrollmentIds } },
        data: {
          status: 'exited',
          exitReason: 'opted_out_inferred',
          nextActionAt: null,
        },
      })
      break
    }
    case 'fora_fit': {
      await prisma.cadenceEnrollment.updateMany({
        where: { id: { in: enrollmentIds } },
        data: { status: 'exited', exitReason: 'fora_fit', nextActionAt: null },
      })
      break
    }
  }
}

async function createOperatorActivity(
  leadId: number,
  title: string,
  replyClass: ReplyClass,
): Promise<void> {
  await prisma.activity.create({
    data: {
      leadId,
      userId: null,
      userName: 'cadência (IA)',
      type: 'follow_up',
      title,
      status: 'pending',
      scheduledAt: new Date(),
      metadata: { source: 'cadenceReplyClassifier', replyClass },
    },
  })
}

/** Para o worker (testes / shutdown). */
export async function stopCadenceScheduler(): Promise<void> {
  eventBus.off('message.received', handleMessageReceived)
  if (!worker) return
  await worker.close()
  worker = null
}

// ─── Tick processing ─────────────────────────────────────

async function processTick(): Promise<void> {
  const now = new Date()
  const due = await prisma.cadenceEnrollment.findMany({
    where: {
      status: 'active',
      nextActionAt: { lte: now },
      cadence: { status: 'active' },
    },
    orderBy: { nextActionAt: 'asc' },
    take: MAX_ENROLLMENTS_PER_TICK,
    include: {
      cadence: { select: { id: true, status: true, exitOnConversion: true } },
    },
  })

  for (const enrollment of due) {
    try {
      await processEnrollment(enrollment.id)
    } catch (err) {
      // Erro num enrollment não derruba o tick. Loga e segue.
      console.error(`[cadenceScheduler] enrollment ${enrollment.id} falhou:`, err)
      captureException(err as Error, { enrollmentId: enrollment.id })
    }
  }
}

/** Processa um único enrollment: executa step atual, avança currentStep,
 * recalcula nextActionAt (ou conclui se acabou os steps). */
async function processEnrollment(enrollmentId: number): Promise<void> {
  const enrollment = await prisma.cadenceEnrollment.findUnique({
    where: { id: enrollmentId },
  })
  if (!enrollment || enrollment.status !== 'active') return

  // B4: avalia critérios de saída ANTES do step. Se atendido, marca exited
  // e não executa o step.
  const exit = await checkExitConditions(enrollment)
  if (exit) {
    await prisma.cadenceEnrollment.update({
      where: { id: enrollment.id },
      data: { status: 'exited', exitReason: exit, nextActionAt: null, lastActionAt: new Date() },
    })
    return
  }

  const step = await prisma.cadenceStep.findFirst({
    where: { cadenceId: enrollment.cadenceId, order: enrollment.currentStep },
  })

  // Sem step nessa posição = cadência terminou (passou do último step).
  if (!step) {
    await prisma.cadenceEnrollment.update({
      where: { id: enrollment.id },
      data: {
        status: 'completed',
        exitReason: 'completed_all_steps',
        nextActionAt: null,
        lastActionAt: new Date(),
      },
    })
    return
  }

  const result = await executeStep(step, enrollment)
  // skipAdvance = step bloqueado/diferido ou enrollment encerrado dentro do executeStep.
  // O próprio executeStep já gravou o estado terminal/de espera; nada a avançar.
  if (result?.skipAdvance) return

  // C5: step de break-up é terminal — após o envio, encerra a enrollment
  // independente de haver próximo step. Mensagem amigável de despedida; lead
  // pode voltar respondendo (B5/C4 capturam e reativam o relacionamento).
  if (step.isBreakUp) {
    await prisma.cadenceEnrollment.update({
      where: { id: enrollment.id },
      data: {
        status: 'completed',
        exitReason: 'break_up_sent',
        currentStep: enrollment.currentStep + 1,
        nextActionAt: null,
        lastActionAt: new Date(),
      },
    })
    return
  }

  // Avança pro próximo step. Builder Visual (Fase 26): se `step.nextStepId`
  // estiver definido, segue o sucessor explícito do canvas; senão, fallback
  // pro modo linear histórico (`order = currentStep + 1`).
  let nextStep = null as Awaited<ReturnType<typeof prisma.cadenceStep.findFirst>>
  if (step.nextStepId) {
    nextStep = await prisma.cadenceStep.findUnique({
      where: { id: step.nextStepId },
    })
    // Defesa: se o step apontado mudou de cadência (não deveria), ignora.
    if (nextStep && nextStep.cadenceId !== enrollment.cadenceId) nextStep = null
  }
  if (!nextStep) {
    nextStep = await prisma.cadenceStep.findFirst({
      where: { cadenceId: enrollment.cadenceId, order: enrollment.currentStep + 1 },
    })
  }

  if (!nextStep) {
    await prisma.cadenceEnrollment.update({
      where: { id: enrollment.id },
      data: {
        status: 'completed',
        exitReason: 'completed_all_steps',
        currentStep: enrollment.currentStep + 1,
        nextActionAt: null,
        lastActionAt: new Date(),
      },
    })
    return
  }

  const nextAt = computeNextActionAt(nextStep.dayOffset, nextStep.hourOffset)
  await prisma.cadenceEnrollment.update({
    where: { id: enrollment.id },
    data: {
      currentStep: nextStep.order,
      nextActionAt: nextAt,
      lastActionAt: new Date(),
    },
  })
}

/** Calcula o instante absoluto pro próximo step a partir do offset relativo
 * configurado no `CadenceStep` (medido a partir de AGORA, não da enrollment). */
function computeNextActionAt(dayOffset: number, hourOffset: number): Date {
  const ms = (dayOffset * 24 + hourOffset) * 60 * 60 * 1000
  return new Date(Date.now() + ms)
}

/** Resultado opcional do executeStep — se `skipAdvance=true`, o caller não
 * avança `currentStep` (o estado já foi gravado: enrollment exited/diferido). */
interface ExecuteStepResult {
  skipAdvance?: boolean
}

/** Executa o step da cadência. B2 cobre steps automáticos (whatsapp/email/sms);
 * B3 cobre steps manuais (`isManual=true` → cria Activity).
 * E4 (final): toda execução grava uma `CadenceStepExecution` pro dashboard. */
async function executeStep(
  step: { id: number; channel: string; isManual: boolean; templateId: number | null },
  enrollment: { id: number; leadId: number; cadenceId: number },
): Promise<ExecuteStepResult | void> {
  if (step.isManual) {
    await createActivityForManualStep(step, enrollment)
    return // avança normalmente — a Activity vira tarefa do operador.
  }

  const channel = normalizeChannel(step.channel)
  if (!channel) {
    console.warn(`[cadenceScheduler] step ${step.id}: canal '${step.channel}' inválido`)
    await recordExecution(step, enrollment, step.channel, 'failed', { errorMessage: `canal inválido: ${step.channel}` })
    return
  }

  // ── 1. Governança ──
  const gov = await canSendNow(enrollment.leadId, channel)
  if (!gov.ok) {
    const hardBlock =
      gov.reason === 'opt_out' || gov.reason === 'blacklist' || gov.reason === 'lead_not_found'
    if (hardBlock) {
      const exitReason =
        gov.reason === 'opt_out' ? 'opted_out'
        : gov.reason === 'blacklist' ? 'blacklisted'
        : 'lead_invalid'
      await prisma.cadenceEnrollment.update({
        where: { id: enrollment.id },
        data: { status: 'exited', exitReason, nextActionAt: null, lastActionAt: new Date() },
      })
      await recordExecution(step, enrollment, channel, `skipped_${exitReason}`, {
        errorMessage: gov.details,
      })
    } else {
      // silence_window / frequency_cap → re-tenta no próximo tick após retryAt.
      await prisma.cadenceEnrollment.update({
        where: { id: enrollment.id },
        data: {
          nextActionAt: gov.retryAt ?? new Date(Date.now() + 60 * 60 * 1000),
          pauseReason: 'governance_blocked',
        },
      })
      await recordExecution(step, enrollment, channel, `skipped_${gov.reason}`, {
        errorMessage: gov.details,
      })
    }
    return { skipAdvance: true }
  }

  // ── 2. Resolve template + vars ──
  const lead = await prisma.lead.findUnique({ where: { id: enrollment.leadId } })
  if (!lead) {
    await prisma.cadenceEnrollment.update({
      where: { id: enrollment.id },
      data: { status: 'exited', exitReason: 'lead_invalid', nextActionAt: null, lastActionAt: new Date() },
    })
    await recordExecution(step, enrollment, channel, 'skipped_lead_invalid')
    return { skipAdvance: true }
  }

  let subject = ''
  let body = ''
  if (step.templateId) {
    const tpl = await prisma.messageTemplate.findUnique({ where: { id: step.templateId } })
    if (!tpl) {
      console.warn(`[cadenceScheduler] step ${step.id}: template ${step.templateId} não encontrado`)
      await recordExecution(step, enrollment, channel, 'skipped_template_missing', {
        errorMessage: `template ${step.templateId} não encontrado`,
      })
      return // avança mesmo assim — step "mudo" não trava a cadência
    }
    prisma.messageTemplate
      .update({ where: { id: tpl.id }, data: { usageCount: { increment: 1 } } })
      .catch(() => {})
    subject = tpl.subject || ''
    body = channel === 'email' ? tpl.bodyHtml || tpl.body || '' : tpl.body || ''
  }

  body = resolveVariables(body, lead, {})
  subject = resolveVariables(subject, lead, {})

  if (!body.trim()) {
    console.warn(`[cadenceScheduler] step ${step.id}: corpo vazio (lead ${lead.id}); avançando`)
    await recordExecution(step, enrollment, channel, 'skipped_empty_body')
    return
  }

  // ── 3. Enfileira no worker do canal ──
  const meta = { cadenceEnrollmentId: enrollment.id, cadenceStepId: step.id }
  let jobId: string | null = null
  if (channel === 'email') {
    body = await appendPreferencesLink(body, lead.id, looksLikeHtml(body) ? 'html' : 'text')
    const job = await queues.email.add(
      'send',
      { leadId: lead.id, subject, body, ...meta },
      { attempts: 3, backoff: { type: 'exponential', delay: 10000 } },
    )
    jobId = String(job.id)
  } else if (channel === 'whatsapp') {
    const job = await queues.whatsapp.add(
      'send',
      { leadId: lead.id, message: body, ...meta },
      { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
    )
    jobId = String(job.id)
  } else if (channel === 'sms') {
    const job = await queues.sms.add(
      'send',
      { leadId: lead.id, message: body, ...meta },
      { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
    )
    jobId = String(job.id)
  }
  // Outros canais (call/linkedin) caem em isManual=true (tratado acima).
  await recordExecution(step, enrollment, channel, 'sent', { jobId })
}

/** B4: avalia se o enrollment deve ser removido da cadência ANTES de
 * executar o próximo step. Retorna `exitReason` ou `null` se deve continuar.
 * Critérios:
 *   - Lead apagado/inexistente → 'lead_invalid'
 *   - `cadence.exitOnConversion=true` E lead tem DetectedSale ativa
 *     (status='detected'|'confirmed') → 'converted'
 *   - `lead.status` em `cadence.exitOnStatuses` → 'status_exit'
 */
async function checkExitConditions(enrollment: {
  id: number
  leadId: number
  cadenceId: number
}): Promise<string | null> {
  const cadence = await prisma.salesCadence.findUnique({
    where: { id: enrollment.cadenceId },
    select: { exitOnConversion: true, exitOnStatuses: true },
  })
  if (!cadence) return null

  const lead = await prisma.lead.findUnique({
    where: { id: enrollment.leadId },
    select: { id: true, status: true, outcome: true },
  })
  if (!lead) return 'lead_invalid'

  // Fase 23: outcome é fonte da verdade — sempre prevalece sobre exitOnStatuses.
  if (lead.outcome === 'won') return 'won'
  if (lead.outcome === 'lost') return 'lost'

  const exitStatuses = parseStringArray(cadence.exitOnStatuses)
  if (exitStatuses.length > 0 && exitStatuses.includes(lead.status)) {
    return 'status_exit'
  }

  if (cadence.exitOnConversion) {
    const sale = await prisma.detectedSale.findFirst({
      where: { leadId: lead.id, status: { in: ['detected', 'confirmed'] } },
      select: { id: true },
    })
    if (sale) return 'converted'
  }

  return null
}

function parseStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((x): x is string => typeof x === 'string')
}

function normalizeChannel(c: string): Channel | null {
  const valid: Channel[] = ['whatsapp', 'email', 'sms', 'call', 'manual', 'linkedin']
  return (valid as string[]).includes(c) ? (c as Channel) : null
}

function looksLikeHtml(s: string): boolean {
  return /<[a-z][\s\S]*>/i.test(s)
}

/** B3: step manual vira `Activity` na fila do operador (Today's Tasks).
 * `userId` é null porque foi criada pelo sistema; o operador da equipe
 * dona do lead vê ela na sua lista. `metadata.cadenceEnrollmentId` permite
 * fechar o ciclo (operador completa a tarefa → cadência segue). */
async function createActivityForManualStep(
  step: { id: number; channel: string; templateId: number | null },
  enrollment: { id: number; leadId: number; cadenceId: number },
): Promise<void> {
  const lead = await prisma.lead.findUnique({
    where: { id: enrollment.leadId },
    // F7: assignedUserId é necessário para herdar o responsável na Activity criada.
    select: { id: true, nome: true, whatsapp: true, email: true, assignedUserId: true },
  })
  if (!lead) {
    await recordExecution(step, enrollment, step.channel, 'skipped_lead_invalid')
    return
  }

  let title = `Tarefa de cadência (${step.channel})`
  let messageBody: string | null = null
  let messageSubject: string | null = null

  if (step.templateId) {
    const tpl = await prisma.messageTemplate.findUnique({ where: { id: step.templateId } })
    if (tpl) {
      title = tpl.subject ? resolveVariables(tpl.subject, lead, {}) : title
      messageBody = resolveVariables(tpl.body || '', lead, {}) || null
      messageSubject = tpl.subject ? resolveVariables(tpl.subject, lead, {}) : null
    }
  }

  const activity = await prisma.activity.create({
    data: {
      leadId: lead.id,
      // F7: Activity gerada por cadência herda o responsável atual do lead.
      // null se ainda em fila (sem operador atribuído) — aparece pra fila do setor.
      // userName fica como 'cadência' por marker semântico (reassign em cascata usa).
      userId: lead.assignedUserId ?? null,
      userName: 'cadência',
      type: step.channel,
      title,
      status: 'pending',
      scheduledAt: new Date(),
      templateId: step.templateId ?? null,
      messageBody,
      messageSubject,
      recipientPhone: step.channel === 'whatsapp' || step.channel === 'sms' ? lead.whatsapp : null,
      recipientEmail: step.channel === 'email' ? lead.email : null,
      metadata: {
        cadenceEnrollmentId: enrollment.id,
        cadenceStepId: step.id,
        cadenceId: enrollment.cadenceId,
      },
    },
  })

  await recordExecution(step, enrollment, step.channel, 'created_activity', {
    activityId: activity.id,
  })
}

/** E4: registra uma `CadenceStepExecution` pra alimentar drill-down do dashboard.
 * Fire-and-forget seria perigoso (queremos a métrica), mas qualquer falha aqui
 * NÃO derruba o caller — o pior cenário é uma execução não rastreada (loga). */
async function recordExecution(
  step: { id: number },
  enrollment: { id: number; leadId: number; cadenceId: number },
  channel: string,
  status: string,
  extra: { jobId?: string | null; activityId?: number | null; errorMessage?: string | null } = {},
): Promise<void> {
  try {
    await prisma.cadenceStepExecution.create({
      data: {
        enrollmentId: enrollment.id,
        stepId: step.id,
        leadId: enrollment.leadId,
        cadenceId: enrollment.cadenceId,
        channel,
        status,
        jobId: extra.jobId ?? null,
        activityId: extra.activityId ?? null,
        errorMessage: extra.errorMessage ?? null,
      },
    })
  } catch (err) {
    console.error(`[cadenceScheduler] falha ao registrar StepExecution:`, err)
  }
}
