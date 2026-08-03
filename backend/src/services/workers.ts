// src/services/workers.ts
// BullMQ workers para as filas de execução

import { Worker, UnrecoverableError } from 'bullmq'
import { prisma } from '../lib/prisma.js'
import { toWaNumber } from '../lib/phone.js'
import { redisConnection } from '../lib/queues.js'
import { logEvent, EVENT_TYPES } from './leadHistory.js'
import { bullmqJobsTotal, bullmqJobDuration, captureException } from '../lib/observability.js'
import { trackedSend } from './outboundSendTracking.js'

let workers: Worker[] = []

// ─── Helpers ────────────────────────────────────────────

async function getWhatsAppConfig() {
  const rows = await prisma.setting.findMany({
    where: { key: { in: ['whatsapp.evolution_url', 'whatsapp.evolution_key', 'whatsapp.evolution_instance'] } }
  })
  const cfg: Record<string, string> = {}
  rows.forEach(r => { cfg[r.key] = typeof r.value === 'string' ? r.value : String(r.value) })
  return {
    url: cfg['whatsapp.evolution_url'] || process.env.EVOLUTION_API_URL || '',
    key: cfg['whatsapp.evolution_key'] || process.env.EVOLUTION_API_KEY || '',
    instance: cfg['whatsapp.evolution_instance'] || process.env.EVOLUTION_INSTANCE || '',
  }
}

async function updateStepExecution(stepExecutionId: number | undefined, status: string, result?: any, error?: string) {
  if (!stepExecutionId) return
  await prisma.workflowStepExecution.update({
    where: { id: stepExecutionId },
    data: {
      status,
      ...(result ? { result } : {}),
      ...(error ? { error } : {}),
      ...(status === 'completed' || status === 'failed' ? { completedAt: new Date() } : {}),
    }
  })
}

async function advanceWorkflow(stepExecutionId: number | undefined) {
  if (!stepExecutionId) return
  const stepExec = await prisma.workflowStepExecution.findUnique({
    where: { id: stepExecutionId },
    include: { step: true, execution: true }
  })
  if (!stepExec) return
  if (stepExec.execution.status !== 'running') return

  // Se há próximo step, executa. Se não há, encerra a execution como completed
  // — sem isso, executions ficam eternamente em 'running' e bloqueiam a re-entrada
  // de workflows com reentryPolicy='after_completion' ou 'never'.
  if (stepExec.step.nextStepId) {
    const { executeNextStep } = await import('./workflowEngine.js')
    await executeNextStep(stepExec.executionId, stepExec.step.nextStepId)
  } else {
    await prisma.workflowExecution.update({
      where: { id: stepExec.executionId },
      data: { status: 'completed', completedAt: new Date() },
    })
  }
}

// ─── WhatsApp Worker ────────────────────────────────────

function createWhatsAppWorker() {
  return new Worker('wf-whatsapp', async (job) => {
    const { leadId, message, stepExecutionId } = job.data
    const lead = await prisma.lead.findUnique({ where: { id: leadId } })
    if (!lead || !lead.whatsapp) throw new Error(`Lead ${leadId} sem WhatsApp`)

    // Número canônico com DDI para as APIs de WhatsApp. Sem isto o disparo saía
    // com o valor cru do CRM — canais como o Lead Ads entregam "18988059971",
    // sem o 55 — e a Evolution respondia `exists:false`. Quando o valor nem é um
    // telefone discável (sem DDD, LID, dois números colados sem divisão clara),
    // falha AQUI com mensagem útil em vez de queimar 3 tentativas na API.
    const to = toWaNumber(lead.whatsapp)
    if (!to) {
      const err = `Lead ${leadId} com WhatsApp inválido ("${lead.whatsapp}") — número não discável, corrija o cadastro`
      await updateStepExecution(stepExecutionId, 'failed', null, err)
      throw new UnrecoverableError(err)
    }

    const cfg = await getWhatsAppConfig()
    if (!cfg.url || !cfg.key) throw new Error('WhatsApp não configurado')

    // Resolver instância vinculada ao chatbot do lead (NUNCA usar fallback genérico)
    let inst: string | null = null
    if (lead.chatbotId) {
      const instance = await prisma.whatsAppInstance.findFirst({
        where: { chatbotId: lead.chatbotId, active: true }
      })
      if (instance) inst = instance.instanceName
    }
    // Fallback: instância da env (configurada pelo admin)
    if (!inst) inst = cfg.instance
    if (!inst) throw new Error('Nenhuma instância WhatsApp vinculada ao chatbot do lead')

    const result = await trackedSend({
      channel: 'whatsapp',
      queueName: 'wf-whatsapp',
      jobId: job.id ? String(job.id) : null,
      leadId,
      recipient: to,
      bodyPreview: message,
      attempts: job.attemptsMade + 1,
      maxAttempts: job.opts?.attempts ?? null,
      source: stepExecutionId ? 'workflow' : 'system',
      sourceId: stepExecutionId ?? null,
    }, async () => {
      const resp = await fetch(`${cfg.url}/message/sendText/${inst}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: cfg.key },
        body: JSON.stringify({ number: to, text: message })
      })

      if (!resp.ok) {
        const errText = await resp.text().catch(() => 'Unknown error')
        throw new Error(`WhatsApp send failed (${resp.status}): ${errText}`)
      }

      const data = await resp.json().catch(() => ({}))
      return { externalId: data?.key?.id || null, metadata: { instance: inst } }
    })

    // Salvar mensagem no banco
    await prisma.message.create({
      data: {
        leadId,
        body: message,
        fromMe: true,
        senderName: 'Workflow',
        ack: 1,
        externalId: result.externalId ?? undefined,
        provider: 'evolution',
        evolutionInstance: inst,
      }
    })

    logEvent({
      leadId,
      type: EVENT_TYPES.MESSAGE_SENT,
      category: 'communication',
      title: 'Mensagem de workflow enviada via WhatsApp',
      channel: 'whatsapp',
      source: 'workflow',
      actorType: 'system',
      description: message.substring(0, 200),
      metadata: { externalId: result.externalId },
    })

    await updateStepExecution(stepExecutionId, 'completed', { messageId: result.externalId })
    await advanceWorkflow(stepExecutionId)

  }, {
    connection: redisConnection,
    concurrency: 2,
    limiter: { max: 20, duration: 60000 },
  })
}

// ─── Email Worker ───────────────────────────────────────

function createEmailWorker() {
  return new Worker('wf-email', async (job) => {
    const { leadId, subject, body, to, stepExecutionId } = job.data
    const lead = await prisma.lead.findUnique({ where: { id: leadId } })
    const email = to || lead?.email
    if (!email) throw new Error(`Lead ${leadId} sem email`)

    // Importar dinamicamente para evitar dependencia circular
    const { getEmailConfig } = await import('./notify.js')
    const cfg = await getEmailConfig()
    const provider = cfg['email.provider'] || 'resend'

    const trackResult = await trackedSend({
      channel: 'email',
      queueName: 'wf-email',
      jobId: job.id ? String(job.id) : null,
      leadId: leadId ?? null,
      recipient: email,
      subject,
      bodyPreview: body,
      attempts: job.attemptsMade + 1,
      maxAttempts: job.opts?.attempts ?? null,
      source: stepExecutionId ? 'workflow' : 'system',
      sourceId: stepExecutionId ?? null,
    }, async () => {
      let providerMessageId: string | null = null

      if (provider === 'smtp') {
        const nodemailer = (await import('nodemailer')).default
        const host = cfg['smtp.host']
        const port = parseInt(cfg['smtp.port'] || '587')
        const secure = cfg['smtp.secure'] === 'true'
        const user = cfg['smtp.user']
        const pass = cfg['smtp.pass']
        if (!host || !user || !pass) throw new Error('SMTP não configurado')

        const transporter = nodemailer.createTransport({ host, port, secure, auth: { user, pass } })
        const fromName = cfg['smtp.from_name'] || 'BeyondHub'
        const fromEmail = cfg['smtp.from_email'] || user
        const info = await transporter.sendMail({
          from: `${fromName} <${fromEmail}>`,
          to: email,
          subject,
          html: body,
        })
        providerMessageId = info?.messageId || null
        if (info?.accepted && info.accepted.length === 0 && (info.rejected?.length ?? 0) > 0) {
          throw new Error(`SMTP rejeitou destinatário: ${info.rejected.join(', ')}`)
        }
      } else {
        const { Resend } = await import('resend')
        const apiKey = cfg['notification.resend_api_key'] || process.env.RESEND_API_KEY
        if (!apiKey) throw new Error('Resend API key não configurada')
        const resend = new Resend(apiKey)
        const domain = cfg['notification.email_domain'] || 'agenciabeyond.com.br'
        const senderName = cfg['notification.sender_name'] || 'BeyondHub'
        const result = await resend.emails.send({
          from: `${senderName} <noreply@${domain}>`,
          to: email,
          subject,
          html: body,
        })
        if ((result as any)?.error) {
          const err: any = (result as any).error
          throw new Error(`Resend rejeitou: ${err.message || err.name || JSON.stringify(err)}`)
        }
        providerMessageId = (result as any)?.data?.id || null
      }

      return { externalId: providerMessageId, metadata: { provider, to: email } }
    })

    const providerMessageId = trackResult.externalId

    logEvent({
      leadId,
      type: EVENT_TYPES.NOTIFICATION_SENT,
      category: 'communication',
      title: 'Email de workflow enviado',
      channel: 'email',
      source: 'workflow',
      actorType: 'system',
      description: subject,
      metadata: { providerMessageId, provider, to: email },
    })

    await updateStepExecution(stepExecutionId, 'completed', { sentTo: email, providerMessageId })
    await advanceWorkflow(stepExecutionId)

  }, {
    connection: redisConnection,
    concurrency: 5,
    limiter: { max: 60, duration: 60000 },
  })
}

// ─── SMS Worker (Comtele) ───────────────────────────────

function createSmsWorker() {
  return new Worker('wf-sms', async (job) => {
    const { leadId, message, to, sender, stepExecutionId } = job.data
    const lead = await prisma.lead.findUnique({ where: { id: leadId } })
    const phone = to || lead?.whatsapp
    if (!phone) throw new Error(`Lead ${leadId} sem telefone`)

    const result = await trackedSend({
      channel: 'sms',
      queueName: 'wf-sms',
      jobId: job.id ? String(job.id) : null,
      leadId: leadId ?? null,
      recipient: phone,
      bodyPreview: message,
      attempts: job.attemptsMade + 1,
      maxAttempts: job.opts?.attempts ?? null,
      source: stepExecutionId ? 'workflow' : 'system',
      sourceId: stepExecutionId ?? null,
    }, async () => {
      const { sendSms } = await import('./smsProvider.js')
      const r = await sendSms({ to: phone, message, sender })
      if (!r.ok) throw new Error(r.error || 'Falha no envio SMS')
      return { externalId: r.providerId ?? null, metadata: { sender } }
    })

    logEvent({
      leadId,
      type: EVENT_TYPES.NOTIFICATION_SENT,
      category: 'communication',
      title: 'SMS de workflow enviado',
      channel: 'sms',
      source: 'workflow',
      actorType: 'system',
      description: message?.substring(0, 200),
      metadata: { providerId: result.externalId },
    })

    await updateStepExecution(stepExecutionId, 'completed', { sentTo: phone, providerId: result.externalId })
    await advanceWorkflow(stepExecutionId)
  }, {
    connection: redisConnection,
    concurrency: 5,
    limiter: { max: 60, duration: 60000 },
  })
}

// ─── Webhook Worker ─────────────────────────────────────

function createWebhookWorker() {
  return new Worker('wf-webhook', async (job) => {
    const { url, method, headers, body, leadId, stepExecutionId } = job.data

    const trackResult = await trackedSend({
      channel: 'webhook',
      queueName: 'wf-webhook',
      jobId: job.id ? String(job.id) : null,
      leadId: leadId ?? null,
      recipient: url,
      bodyPreview: body ? JSON.stringify(body) : null,
      attempts: job.attemptsMade + 1,
      maxAttempts: job.opts?.attempts ?? null,
      source: stepExecutionId ? 'workflow' : 'system',
      sourceId: stepExecutionId ?? null,
    }, async () => {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 30000)

      try {
        const resp = await fetch(url, {
          method: method || 'POST',
          headers: { 'Content-Type': 'application/json', ...(headers || {}) },
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        })

        const status = resp.status
        const responseBody = await resp.text().catch(() => '')

        if (!resp.ok) throw new Error(`Webhook failed (${status}): ${responseBody.substring(0, 200)}`)

        return { externalId: null, metadata: { status, responseBody: responseBody.substring(0, 500) } }
      } finally {
        clearTimeout(timeout)
      }
    })

    await updateStepExecution(stepExecutionId, 'completed', trackResult.metadata)
    await advanceWorkflow(stepExecutionId)

  }, {
    connection: redisConnection,
    concurrency: 3,
  })
}

// ─── Internal Task Worker ───────────────────────────────

function createInternalTaskWorker() {
  return new Worker('wf-internal-task', async (job) => {
    const {
      leadId, title, type, description, stepExecutionId,
      dueMode, dueValue, assigneeMode, assigneeUserId, assigneeTeamId, templateCode,
    } = job.data

    // Prazo e responsável: antes toda tarefa de workflow nascia vencendo AGORA e
    // sem dono, o que a tornava inútil para cobrança escalonada. Reusa a mesma
    // resolução do motor de Resumos pra não haver duas regras de prazo no produto.
    const { resolveTaskDueAt, resolveTaskAssignee } = await import('./statusSummaryEngine.js')
    const scheduledAt = await resolveTaskDueAt(dueMode || 'immediate', Number(dueValue) || 0)
    const assignee = await resolveTaskAssignee(leadId, {
      assigneeMode: assigneeMode || 'lead_owner',
      assigneeUserId: assigneeUserId ?? null,
      assigneeTeamId: assigneeTeamId ?? null,
    })

    await prisma.activity.create({
      data: {
        leadId,
        type: type || 'task',
        title: title || 'Tarefa do workflow',
        description: description || null,
        status: 'pending',
        scheduledAt,
        assignedUserId: assignee.assignedUserId,
        assignedTeamId: assignee.assignedTeamId,
        templateCode: templateCode || null,
      }
    })

    await updateStepExecution(stepExecutionId, 'completed', { created: true })
    await advanceWorkflow(stepExecutionId)

  }, {
    connection: redisConnection,
    concurrency: 5,
  })
}

// ─── Workflow Step Worker (delayed waits) ───────────────

function createWorkflowStepWorker() {
  return new Worker('wf-workflow-step', async (job) => {
    const { executionId, nextStepId } = job.data

    const execution = await prisma.workflowExecution.findUnique({ where: { id: executionId } })
    if (!execution || execution.status !== 'running') {
      console.log(`[WorkflowStep] Execution ${executionId} is ${execution?.status || 'not found'}, skipping`)
      return
    }

    const { executeNextStep } = await import('./workflowEngine.js')
    await executeNextStep(executionId, nextStepId)

  }, {
    connection: redisConnection,
    concurrency: 3,
  })
}

// ─── Enrichment Worker ──────────────────────────────────

// ─── Document Review Worker (F2 — análise documental via IA) ───────
// Consome fila wf-document-review. Cada job recebe { docId } e delega ao
// service aiDocumentReview que carrega o arquivo, envia para Claude Vision
// e grava o resultado em EnrollmentDocument.aiAnalysis.

function createDocumentReviewWorker() {
  return new Worker('wf-document-review', async (job) => {
    const { docId } = job.data as { docId: number }
    if (!docId) throw new Error('Job sem docId')
    const { reviewDocumentById } = await import('./aiDocumentReview.js')
    return await reviewDocumentById(docId)
  }, {
    connection: redisConnection,
    concurrency: 2,                  // Claude rate-limit amigável
    limiter: { max: 10, duration: 60_000 }, // 10 chamadas/min por instância
  })
}

function createEssayCorrectionWorker() {
  return new Worker('wf-essay-correction', async (job) => {
    const { submissionId } = job.data as { submissionId: number }
    if (!submissionId) throw new Error('Job sem submissionId')
    const { correctEssayById } = await import('./aiEssayReview.js')
    return await correctEssayById(submissionId)
  }, {
    connection: redisConnection,
    concurrency: 2,
    limiter: { max: 10, duration: 60_000 },
  })
}

function createEnrichmentWorker() {
  return new Worker('wf-enrichment', async (job) => {
    const { leadId, maxTier, force } = job.data as { leadId: number; maxTier?: 1 | 2 | 3; force?: boolean }
    const { enrichLead } = await import('./enrichment/index.js')
    const res = await enrichLead(leadId, { maxTier, force })
    return res
  }, {
    connection: redisConnection,
    concurrency: 2,              // não martelar APIs públicas
    limiter: { max: 20, duration: 60000 },
  })
}

function createConversationAuditWorker() {
  return new Worker('wf-conversation-audit', async (job) => {
    const { leadId, triggeredBy, triggeredById } = job.data as { leadId: number; triggeredBy?: string; triggeredById?: number | null }
    if (!leadId) throw new Error('Job sem leadId')
    const { auditLeadConversation } = await import('./conversationAuditAi.js')
    return await auditLeadConversation(leadId, { triggeredBy, triggeredById })
  }, {
    connection: redisConnection,
    concurrency: 2,
    limiter: { max: 30, duration: 60_000 },   // proteção contra rate-limit da Anthropic/OpenAI
  })
}

function createAiJourneyWorker() {
  return new Worker('wf-ai-journey', async (job) => {
    const { leadId } = job.data as { leadId: number }
    if (!leadId) throw new Error('Job sem leadId')
    const { runAiJourneyForLead } = await import('./aiJourneyService.js')
    return await runAiJourneyForLead(leadId)
  }, {
    connection: redisConnection,
    concurrency: 3,
    limiter: { max: 60, duration: 60_000 },
  })
}

function createVoipPollWorker() {
  return new Worker('wf-voip-poll', async (job) => {
    const { callId, attempt } = job.data as { callId: number; attempt?: number }
    if (!callId) throw new Error('Job sem callId')
    const { pollCall } = await import('./voipCallService.js')
    return await pollCall(callId, attempt || 0)
  }, {
    connection: redisConnection,
    concurrency: 5,
    limiter: { max: 10, duration: 1_000 }, // /audio info é limitado a 10 req/s
  })
}

// ─── Startup ────────────────────────────────────────────

export function startWorkers(): void {
  try {
    workers = [
      createWhatsAppWorker(),
      createEmailWorker(),
      createSmsWorker(),
      createWebhookWorker(),
      createInternalTaskWorker(),
      createWorkflowStepWorker(),
      createEnrichmentWorker(),
      createDocumentReviewWorker(),
      createEssayCorrectionWorker(),
      createConversationAuditWorker(),
      createAiJourneyWorker(),
      createVoipPollWorker(),
    ]

    // Error handlers + métricas de observabilidade
    workers.forEach(w => {
      w.on('failed', async (job, err) => {
        console.error(`[Worker:${w.name}] Job ${job?.id} failed:`, err.message)
        bullmqJobsTotal.inc({ queue: w.name, status: 'failed' })
        captureException(err, {
          queue: w.name,
          jobId: job?.id,
          jobName: job?.name,
          attemptsMade: job?.attemptsMade,
          data: job?.data,
        })
        // Marca o WorkflowStepExecution como 'failed' SOMENTE depois que todas
        // as tentativas foram esgotadas. Sem isso o step fica eternamente em
        // 'running' e o admin pensa que enviou. Idempotente: só atualiza se ainda
        // estiver em 'running' (BullMQ pode disparar 'failed' em retries).
        const stepExecutionId = (job?.data as any)?.stepExecutionId
        if (!stepExecutionId) return
        const opts = job?.opts || {}
        const maxAttempts = (opts as any).attempts || 1
        const made = job?.attemptsMade || 0
        // Só finaliza quando exauriu retries
        if (made < maxAttempts) return
        try {
          await prisma.workflowStepExecution.updateMany({
            where: { id: stepExecutionId, status: 'running' },
            data: {
              status: 'failed',
              error: err.message?.substring(0, 500) || 'Job falhou',
              completedAt: new Date(),
            },
          })
          // Também encerra a WorkflowExecution-mãe — sem isso ela fica eternamente
          // em 'running' e bloqueia novos disparos do workflow para o mesmo lead
          // (reentryPolicy='after_completion'). Marcamos como 'failed' pra deixar
          // claro que o workflow não chegou ao fim.
          const stepExec = await prisma.workflowStepExecution.findUnique({
            where: { id: stepExecutionId },
            select: { executionId: true },
          })
          if (stepExec?.executionId) {
            await prisma.workflowExecution.updateMany({
              where: { id: stepExec.executionId, status: 'running' },
              data: { status: 'failed', completedAt: new Date() },
            })
          }
        } catch (e: any) {
          console.error(`[Worker:${w.name}] failed-handler db update error:`, e.message)
        }
      })
      w.on('completed', (job) => {
        bullmqJobsTotal.inc({ queue: w.name, status: 'completed' })
        const ts = (job as any)?.processedOn
        const fin = (job as any)?.finishedOn
        if (ts && fin) bullmqJobDuration.observe({ queue: w.name }, (fin - ts) / 1000)
      })
    })

    console.log(`[Workers] ${workers.length} workers iniciados (whatsapp, email, sms, webhook, internal-task, workflow-step, enrichment, document-review, essay-correction, conversation-audit, ai-journey, voip-poll)`)

    // Graceful shutdown
    const shutdown = async () => {
      await Promise.all(workers.map(w => w.close()))
      console.log('[Workers] Todos os workers encerrados')
    }
    process.on('SIGTERM', shutdown)
    process.on('SIGINT', shutdown)

  } catch (err) {
    console.error('[Workers] Falha ao iniciar workers:', err)
  }
}
