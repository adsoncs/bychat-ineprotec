// src/services/workflowEngine.ts
// Motor de workflows — escuta domain events e orquestra execuções

import { prisma } from '../lib/prisma.js'
import { eventBus, type DomainEvent } from '../lib/eventBus.js'
import { queues } from '../lib/queues.js'
import { evaluateCondition } from './workflowConditions.js'
import { dispatchAction } from './workflowActions.js'
import { logEvent, EVENT_TYPES } from './leadHistory.js'

// ─── Trigger Matching ───────────────────────────────────

/**
 * Compara um valor do evento com o esperado no filtro do gatilho.
 *
 * Array = "qualquer um destes". É o que permite um workflow só cobrir vários
 * formulários/funis/chatbots — antes cada valor exigia um workflow duplicado, e
 * bastava criar um formulário novo para o aviso silenciosamente parar de sair.
 * Escalar continua funcionando igual (comparação por string, tolerante a
 * number x "number" vindo do JSON).
 */
function valueMatches(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    if (expected.length === 0) return true // lista vazia = sem filtro
    return expected.some((e) => String(e) === String(actual))
  }
  return String(actual) === String(expected)
}

function matchesTriggerConfig(triggerConfig: any, event: DomainEvent): boolean {
  if (!triggerConfig) return true // sem filtro = aceita tudo

  const cfg = typeof triggerConfig === 'string' ? JSON.parse(triggerConfig) : triggerConfig

  for (const [key, expected] of Object.entries(cfg)) {
    const actual = event.payload?.[key]
      ?? event.payload?.metadata?.[key]
      ?? event.payload?.newValue
      ?? (event as any)[key]

    // Para stage_changed: verificar newValue
    if (key === 'stageKey' || key === 'newValue') {
      if (!valueMatches(event.payload?.newValue, expected)) return false
      continue
    }

    if (key === 'oldValue') {
      if (!valueMatches(event.payload?.oldValue, expected)) return false
      continue
    }

    if (key === 'channel') {
      if (!valueMatches(event.payload?.channel, expected)) return false
      continue
    }

    if (key === 'funnelId') {
      if (!valueMatches(event.funnelId, expected) && !valueMatches(event.payload?.metadata?.funnelId, expected)) return false
      continue
    }

    if (key === 'chatbotId') {
      if (!valueMatches(event.chatbotId, expected) && !valueMatches(event.payload?.metadata?.chatbotId, expected)) return false
      continue
    }

    // Fase 23.1: filtro por objeção em lead.lost — aceita reasonIds (array) ou reasonId (single)
    if (key === 'reasonIds' && Array.isArray(expected)) {
      const eventReasonId = event.payload?.metadata?.reasonId
      if (eventReasonId == null) return false
      if (!expected.map(Number).includes(Number(eventReasonId))) return false
      continue
    }
    if (key === 'reasonId') {
      const eventReasonId = event.payload?.metadata?.reasonId
      if (Number(eventReasonId) !== Number(expected)) return false
      continue
    }

    // Demais chaves (formId, etc.): escalar ou lista.
    if (!valueMatches(actual, expected)) return false
  }

  return true
}

// ─── Core: Handle Domain Event ──────────────────────────

async function handleDomainEvent(event: DomainEvent): Promise<void> {
  try {
    // Buscar workflows ativos que escutam este evento
    const workflows = await prisma.workflow.findMany({
      where: {
        active: true,
        triggerEvent: event.type,
      },
      include: { steps: { orderBy: { position: 'asc' } } },
    })

    for (const workflow of workflows) {
      // Verificar filtro do trigger
      if (!matchesTriggerConfig(workflow.triggerConfig, event)) continue

      // Verificar escopo de funil/chatbot
      if (workflow.funnelId && event.funnelId && workflow.funnelId !== event.funnelId) continue
      if (workflow.chatbotId && event.chatbotId && workflow.chatbotId !== event.chatbotId) continue

      // Verificar política de re-entrada
      if (workflow.reentryPolicy === 'never') {
        const existing = await prisma.workflowExecution.findFirst({
          where: { workflowId: workflow.id, leadId: event.leadId, status: { in: ['running', 'paused'] } }
        })
        if (existing) continue
      } else if (workflow.reentryPolicy === 'after_completion') {
        const running = await prisma.workflowExecution.findFirst({
          where: { workflowId: workflow.id, leadId: event.leadId, status: 'running' }
        })
        if (running) continue
      }

      // Criar execução
      const execution = await prisma.workflowExecution.create({
        data: {
          workflowId: workflow.id,
          leadId: event.leadId,
          status: 'running',
          triggerData: { event: event.type, payload: event.payload, timestamp: event.timestamp.toISOString() },
        }
      })

      logEvent({
        leadId: event.leadId,
        type: EVENT_TYPES.WORKFLOW_STARTED,
        category: 'system',
        title: `Workflow "${workflow.name}" iniciado`,
        source: 'workflow_engine',
        actorType: 'system',
        metadata: { workflowId: workflow.id, executionId: execution.id, triggerEvent: event.type },
      })

      console.log(`[Workflow] Started "${workflow.name}" for lead #${event.leadId} (execution #${execution.id})`)

      // Encontrar primeiro step (menor position)
      const firstStep = workflow.steps[0]
      if (firstStep) {
        // Se o primeiro step é trigger, pular para o próximo
        const startStep = firstStep.type === 'trigger' && firstStep.nextStepId
          ? workflow.steps.find(s => s.id === firstStep.nextStepId) || workflow.steps[1]
          : firstStep

        if (startStep) {
          await executeNextStep(execution.id, startStep.id)
        } else {
          await completeExecution(execution.id, 'completed')
        }
      } else {
        await completeExecution(execution.id, 'completed')
      }
    }
  } catch (err) {
    console.error(`[Workflow] Error handling event ${event.type}:`, err)
  }
}

// ─── Execute Step ───────────────────────────────────────

export async function executeNextStep(executionId: number, stepId: number): Promise<void> {
  try {
    const execution = await prisma.workflowExecution.findUnique({
      where: { id: executionId },
      include: { workflow: true }
    })
    if (!execution || execution.status !== 'running') return

    const step = await prisma.workflowStep.findUnique({ where: { id: stepId } })
    if (!step) {
      await completeExecution(executionId, 'completed')
      return
    }

    // Atualizar current step
    await prisma.workflowExecution.update({
      where: { id: executionId },
      data: { currentStepId: stepId }
    })

    const config = step.config as any

    switch (step.type) {
      case 'action': {
        // Repassa o triggerData (payload do evento) para que dispatchAction
        // possa interpolar variáveis como {{candidateCode}}, {{reviewNote}}, etc.
        const trigData = (execution.triggerData as any) || {}
        await dispatchAction(config, executionId, stepId, execution.leadId, trigData)
        break
      }

      case 'wait': {
        let durationMs = calculateDelayMs(config.duration, config.unit)
        // `businessHoursOnly` no step: a retomada cai no próximo horário de
        // atendimento em vez de disparar de madrugada (o delay é aritmética pura,
        // então um "esperar 2 dias" marcado às 23h vencia às 23h).
        if (config.businessHoursOnly) {
          const { getBusinessHoursConfig, nextBusinessTime } = await import('./businessHours.js')
          const bh = await getBusinessHoursConfig()
          // `enabled: true` de propósito: quem marcou "só em horário comercial" NESTE
          // passo já decidiu. O toggle global governa a auto-resposta fora do
          // expediente — deixar ele mandar aqui faria o passo virar letra morta em
          // todo tenant que não usa aquele recurso (a agenda padrão, seg-sex 9-18,
          // continua valendo como base).
          const target = nextBusinessTime({ ...bh, enabled: true }, new Date(Date.now() + durationMs))
          durationMs = Math.max(0, target.getTime() - Date.now())
        }
        // Criar step execution para tracking
        const stepExec = await prisma.workflowStepExecution.create({
          data: {
            executionId,
            stepId,
            status: 'waiting',
            startedAt: new Date(),
            scheduledAt: new Date(Date.now() + durationMs),
          }
        })

        // Job delayed no BullMQ
        const job = await queues.workflowStep.add('resume', {
          executionId,
          nextStepId: step.nextStepId,
          stepExecutionId: stepExec.id,
        }, {
          delay: durationMs,
          jobId: `wf-wait-${executionId}-${stepId}-${Date.now()}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 10000 },
        })

        await prisma.workflowStepExecution.update({
          where: { id: stepExec.id },
          data: { jobId: job.id }
        })

        console.log(`[Workflow] Execution #${executionId} waiting ${config.duration} ${config.unit} (step #${stepId})`)
        break
      }

      case 'condition': {
        const result = await evaluateCondition(config, execution.leadId)

        await prisma.workflowStepExecution.create({
          data: {
            executionId,
            stepId,
            status: 'completed',
            startedAt: new Date(),
            completedAt: new Date(),
            result: { evaluated: true, result },
          }
        })

        const nextId = result ? step.nextStepId : step.altStepId
        if (nextId) {
          await executeNextStep(executionId, nextId)
        } else {
          await completeExecution(executionId, 'completed')
        }
        break
      }

      case 'branch': {
        const conditions = config.conditions || []
        let matched = false

        for (const cond of conditions) {
          const result = await evaluateCondition(cond, execution.leadId)
          if (result && cond.nextStepId) {
            await prisma.workflowStepExecution.create({
              data: {
                executionId,
                stepId,
                status: 'completed',
                startedAt: new Date(),
                completedAt: new Date(),
                result: { branch: cond, matched: true },
              }
            })
            await executeNextStep(executionId, cond.nextStepId)
            matched = true
            break
          }
        }

        if (!matched) {
          await prisma.workflowStepExecution.create({
            data: {
              executionId,
              stepId,
              status: 'completed',
              startedAt: new Date(),
              completedAt: new Date(),
              result: { branch: 'default', matched: false },
            }
          })
          // Nenhuma condição casou: o caminho "senão" é o altStepId (é o que a UI
          // e o canvas chamam de "Se NÃO atender"). NÃO cair no nextStepId — em
          // ramificação ele é só o destino visual das condições, e usá-lo como
          // padrão faz o fluxo executar justamente com quem foi filtrado fora.
          if (config.defaultStepId) {
            await executeNextStep(executionId, config.defaultStepId)
          } else if (step.altStepId) {
            await executeNextStep(executionId, step.altStepId)
          } else {
            await completeExecution(executionId, 'completed')
          }
        }
        break
      }

      case 'goal': {
        // Goal steps são verificados via checkGoal, não executados diretamente
        // Se chegou aqui, o goal foi atingido
        await prisma.workflowStepExecution.create({
          data: {
            executionId,
            stepId,
            status: 'completed',
            startedAt: new Date(),
            completedAt: new Date(),
            result: { goalReached: true },
          }
        })
        await completeExecution(executionId, 'goal_reached')
        break
      }

      default: {
        // Tipo desconhecido — pular para próximo
        if (step.nextStepId) {
          await executeNextStep(executionId, step.nextStepId)
        } else {
          await completeExecution(executionId, 'completed')
        }
      }
    }
  } catch (err) {
    console.error(`[Workflow] Error executing step ${stepId} for execution ${executionId}:`, err)
    await prisma.workflowStepExecution.create({
      data: {
        executionId,
        stepId,
        status: 'failed',
        startedAt: new Date(),
        completedAt: new Date(),
        error: String(err),
      }
    }).catch(() => {})
  }
}

// ─── Pause / Resume / Goal Check ────────────────────────

export async function handleLeadReply(leadId: number): Promise<void> {
  const executions = await prisma.workflowExecution.findMany({
    where: { leadId, status: 'running' },
    include: { workflow: true }
  })

  for (const exec of executions) {
    if (exec.workflow.pauseOnReply) {
      await prisma.workflowExecution.update({
        where: { id: exec.id },
        data: { status: 'paused', pausedAt: new Date(), pauseReason: 'reply_received' }
      })
      logEvent({
        leadId,
        type: EVENT_TYPES.WORKFLOW_PAUSED,
        category: 'system',
        title: `Workflow "${exec.workflow.name}" pausado (lead respondeu)`,
        source: 'workflow_engine',
        actorType: 'system',
        metadata: { workflowId: exec.workflowId, executionId: exec.id },
      })
      console.log(`[Workflow] Paused execution #${exec.id} (lead #${leadId} replied)`)
    }
  }
}

export async function resumeExecution(executionId: number): Promise<void> {
  const execution = await prisma.workflowExecution.findUnique({ where: { id: executionId } })
  if (!execution || execution.status !== 'paused') return

  await prisma.workflowExecution.update({
    where: { id: executionId },
    data: { status: 'running', pausedAt: null, pauseReason: null }
  })

  // Retomar do step atual
  if (execution.currentStepId) {
    const step = await prisma.workflowStep.findUnique({ where: { id: execution.currentStepId } })
    if (step?.nextStepId) {
      await executeNextStep(executionId, step.nextStepId)
    }
  }
}

export async function cancelExecution(executionId: number): Promise<void> {
  await prisma.workflowExecution.update({
    where: { id: executionId },
    data: { status: 'cancelled', completedAt: new Date() }
  })
}

async function checkGoal(event: DomainEvent): Promise<void> {
  // Buscar execuções running cujo workflow tem goalEvent matching
  const executions = await prisma.workflowExecution.findMany({
    where: {
      leadId: event.leadId,
      status: 'running',
      workflow: { goalEvent: event.type }
    },
    include: { workflow: true }
  })

  for (const exec of executions) {
    if (matchesTriggerConfig(exec.workflow.goalConfig, event)) {
      await completeExecution(exec.id, 'goal_reached')
      logEvent({
        leadId: event.leadId,
        type: EVENT_TYPES.WORKFLOW_COMPLETED,
        category: 'system',
        title: `Workflow "${exec.workflow.name}" concluído (meta atingida)`,
        source: 'workflow_engine',
        actorType: 'system',
        metadata: { workflowId: exec.workflowId, executionId: exec.id, goalEvent: event.type },
      })
      console.log(`[Workflow] Goal reached for execution #${exec.id} (event: ${event.type})`)
    }
  }
}

// ─── Helpers ────────────────────────────────────────────

async function completeExecution(executionId: number, status: string): Promise<void> {
  await prisma.workflowExecution.update({
    where: { id: executionId },
    data: { status, completedAt: new Date() }
  })
}

function calculateDelayMs(duration: number, unit: string): number {
  switch (unit) {
    case 'seconds': return duration * 1000
    case 'minutes': return duration * 60 * 1000
    case 'hours': return duration * 3600 * 1000
    case 'days': return duration * 86400 * 1000
    default: return duration * 60 * 1000 // default minutes
  }
}

// ─── Startup ────────────────────────────────────────────

export function startWorkflowEngine(): void {
  // Escutar todos os domain events
  eventBus.on('*', async (event: DomainEvent) => {
    try {
      await handleDomainEvent(event)
      await checkGoal(event)

      // Pause on reply
      if (event.type === 'message.received') {
        await handleLeadReply(event.leadId)
      }
    } catch (err) {
      console.error(`[WorkflowEngine] Error processing event ${event.type}:`, err)
    }
  })

  console.log('[WorkflowEngine] Engine iniciada — escutando domain events')
}
