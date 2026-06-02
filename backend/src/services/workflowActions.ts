// src/services/workflowActions.ts
// Despacha ações de workflow para as filas BullMQ correspondentes

import { prisma } from '../lib/prisma.js'
import { queues } from '../lib/queues.js'
import { logEvent, EVENT_TYPES } from './leadHistory.js'
import { canSendNow, type Channel } from './messageGovernance.js'
import { appendPreferencesLink } from './preferencesToken.js'

/** Heurística simples pra decidir se um corpo é HTML — se contém tags. */
function looksLikeHtml(s: string): boolean {
  return /<[a-z][\s\S]*>/i.test(s)
}

// A5: pré-checagem central de governança antes de enfileirar envios.
//   - opt_out / blacklist / lead_not_found → bloqueio definitivo (step.failed)
//   - silence_window / frequency_cap       → defer (job entra na fila com delay)
async function enforceGovernance(
  leadId: number,
  channel: Channel,
  stepExecId: number,
): Promise<{ allow: true; delayMs: number } | { allow: false }> {
  const result = await canSendNow(leadId, channel)
  if (result.ok) return { allow: true, delayMs: 0 }

  const hardBlock =
    result.reason === 'opt_out' || result.reason === 'blacklist' || result.reason === 'lead_not_found'

  if (hardBlock) {
    await prisma.workflowStepExecution.update({
      where: { id: stepExecId },
      data: {
        status: 'failed',
        error: `Bloqueado por governança: ${result.reason}${result.details ? ` — ${result.details}` : ''}`,
        completedAt: new Date(),
      },
    })
    return { allow: false }
  }

  // silence_window / frequency_cap → defer.
  const delayMs = result.retryAt ? Math.max(0, result.retryAt.getTime() - Date.now()) : 0
  return { allow: true, delayMs }
}

interface ActionConfig {
  actionType: string
  // send_whatsapp / send_sms
  message?: string
  templateId?: number // referência opcional a MessageTemplate (id)
  // send_email
  subject?: string
  body?: string
  to?: string
  // change_stage
  stageKey?: string
  funnelId?: number
  // add_tag / remove_tag
  tagName?: string
  // create_task
  title?: string
  taskType?: string
  description?: string
  // webhook
  url?: string
  method?: string
  headers?: Record<string, string>
  webhookBody?: Record<string, any>
  // assignToTeam / transferToTeam
  teamId?: number
  // assignToUser
  userId?: number
  // transferToTeam
  reason?: string
}

function describeAssignment(
  user: { name?: string | null; email?: string | null } | null,
  team: { name?: string | null } | null,
): string {
  const userPart = user ? (user.name || user.email || 'operador') : 'fila'
  const teamPart = team?.name || 'sem setor'
  return `${userPart} / ${teamPart}`
}

// Resolve variáveis no texto. Aceita {{nome}}, {{empresa}}, {{whatsapp}}, {{email}},
// {{segmento}}, {{cidade}}, {{status}} (do lead) e qualquer chave do triggerData
// (payload do evento que disparou o workflow). Permite chaves aninhadas com
// notação de ponto (ex: {{enrollment.candidateCode}}, {{document.reviewNote}}).
export function resolveVariables(text: string, lead: any, triggerData: any = {}): string {
  if (!text) return ''
  // Achata uma única camada do triggerData pra acesso direto: {{candidateCode}}.
  const flat: Record<string, any> = {
    nome: lead?.nome || '',
    empresa: lead?.empresa || '',
    whatsapp: lead?.whatsapp || '',
    email: lead?.email || '',
    segmento: lead?.segmento || '',
    cidade: lead?.cidade || '',
    status: lead?.status || '',
    data_hoje: new Date().toLocaleDateString('pt-BR'),
  }
  // Trigger payload pode vir como { event, payload } (formato do workflowEngine)
  // ou direto. Suportamos ambos.
  const root = triggerData?.payload && typeof triggerData.payload === 'object' ? triggerData.payload : triggerData
  if (root && typeof root === 'object') {
    for (const [k, v] of Object.entries(root)) {
      if (v !== null && v !== undefined && (typeof v !== 'object' || v instanceof Date)) {
        flat[k] = v instanceof Date ? v.toLocaleDateString('pt-BR') : v
      }
    }
  }
  // Substitui {{path.to.value}} suportando 1 nível de aninhamento.
  return String(text).replace(/\{\{([\w.]+)\}\}/g, (_, key) => {
    const k = String(key).trim()
    if (k in flat) return String(flat[k] ?? '')
    if (k.includes('.')) {
      const [a, b] = k.split('.')
      const obj = (root as any)?.[a]
      if (obj && typeof obj === 'object' && b in obj) return String(obj[b] ?? '')
    }
    return ''
  })
}

export async function dispatchAction(
  config: ActionConfig,
  executionId: number,
  stepId: number,
  leadId: number,
  triggerData: any = {},
): Promise<void> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } })
  if (!lead) throw new Error(`Lead ${leadId} não encontrado`)

  // Criar step execution
  const stepExec = await prisma.workflowStepExecution.create({
    data: {
      executionId,
      stepId,
      status: 'running',
      startedAt: new Date(),
    }
  })

  switch (config.actionType) {
    case 'send_whatsapp': {
      // Resolve template (se templateId) ou usa message inline (fallback).
      let message = config.message || ''
      if (config.templateId) {
        const tpl = await prisma.messageTemplate.findUnique({ where: { id: config.templateId } })
        if (!tpl) {
          await prisma.workflowStepExecution.update({
            where: { id: stepExec.id },
            data: { status: 'failed', error: `Template ${config.templateId} não encontrado`, completedAt: new Date() }
          })
          return
        }
        // bumpa usageCount (auditoria); silencia falha
        prisma.messageTemplate.update({ where: { id: tpl.id }, data: { usageCount: { increment: 1 } } }).catch(() => {})
        message = tpl.body || ''
      }
      message = resolveVariables(message, lead, triggerData)
      if (!message.trim()) {
        await prisma.workflowStepExecution.update({
          where: { id: stepExec.id },
          data: { status: 'failed', error: 'Mensagem vazia', completedAt: new Date() }
        })
        return
      }
      const gov = await enforceGovernance(leadId, 'whatsapp', stepExec.id)
      if (!gov.allow) return
      const job = await queues.whatsapp.add('send', {
        leadId,
        message,
        stepExecutionId: stepExec.id,
      }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        delay: gov.delayMs,
      })
      await prisma.workflowStepExecution.update({
        where: { id: stepExec.id },
        data: { jobId: job.id }
      })
      break
    }

    case 'send_email': {
      // Resolve template (se templateId) ou usa subject/body inline (fallback).
      let subject = config.subject || ''
      let body = config.body || ''
      if (config.templateId) {
        const tpl = await prisma.messageTemplate.findUnique({ where: { id: config.templateId } })
        if (!tpl) {
          await prisma.workflowStepExecution.update({
            where: { id: stepExec.id },
            data: { status: 'failed', error: `Template ${config.templateId} não encontrado`, completedAt: new Date() }
          })
          return
        }
        prisma.messageTemplate.update({ where: { id: tpl.id }, data: { usageCount: { increment: 1 } } }).catch(() => {})
        subject = tpl.subject || subject
        // bodyHtml tem prioridade pra email; cai no body texto se vazio.
        body = tpl.bodyHtml || tpl.body || body
      }
      subject = resolveVariables(subject, lead, triggerData)
      body = resolveVariables(body, lead, triggerData)
      const gov = await enforceGovernance(leadId, 'email', stepExec.id)
      if (!gov.allow) return
      // A7: rodapé com link da central de preferências (LGPD).
      body = await appendPreferencesLink(body, leadId, looksLikeHtml(body) ? 'html' : 'text')
      const job = await queues.email.add('send', {
        leadId,
        subject,
        body,
        to: config.to,
        stepExecutionId: stepExec.id,
      }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 10000 },
        delay: gov.delayMs,
      })
      await prisma.workflowStepExecution.update({
        where: { id: stepExec.id },
        data: { jobId: job.id }
      })
      break
    }

    case 'send_sms': {
      // SMS via provider configurado em Settings (atualmente Comtele).
      // Mesmo fluxo de queue do send_whatsapp/send_email.
      let message = config.message || ''
      if (config.templateId) {
        const tpl = await prisma.messageTemplate.findUnique({ where: { id: config.templateId } })
        if (!tpl) {
          await prisma.workflowStepExecution.update({
            where: { id: stepExec.id },
            data: { status: 'failed', error: `Template ${config.templateId} não encontrado`, completedAt: new Date() }
          })
          return
        }
        prisma.messageTemplate.update({ where: { id: tpl.id }, data: { usageCount: { increment: 1 } } }).catch(() => {})
        message = tpl.body || ''
      }
      message = resolveVariables(message, lead, triggerData)
      if (!message.trim()) {
        await prisma.workflowStepExecution.update({
          where: { id: stepExec.id },
          data: { status: 'failed', error: 'Mensagem vazia', completedAt: new Date() }
        })
        return
      }
      const gov = await enforceGovernance(leadId, 'sms', stepExec.id)
      if (!gov.allow) return
      const job = await queues.sms.add('send', {
        leadId,
        message,
        stepExecutionId: stepExec.id,
      }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        delay: gov.delayMs,
      })
      await prisma.workflowStepExecution.update({
        where: { id: stepExec.id },
        data: { jobId: job.id }
      })
      break
    }

    case 'change_stage': {
      // Executa direto (operação rápida, sem fila)
      const oldStatus = lead.status
      const updateData: any = { status: config.stageKey }
      if (config.funnelId) updateData.funnelId = config.funnelId

      await prisma.lead.update({ where: { id: leadId }, data: updateData })

      logEvent({
        leadId,
        type: EVENT_TYPES.STATUS_CHANGED,
        category: 'lifecycle',
        title: `Etapa alterada por workflow`,
        source: 'workflow',
        actorType: 'system',
        oldValue: oldStatus,
        newValue: config.stageKey,
        metadata: { funnelId: config.funnelId, executionId },
      })

      await prisma.workflowStepExecution.update({
        where: { id: stepExec.id },
        data: { status: 'completed', completedAt: new Date(), result: { oldStatus, newStatus: config.stageKey } }
      })

      // Avançar workflow
      const step = await prisma.workflowStep.findUnique({ where: { id: stepId } })
      if (step?.nextStepId) {
        const { executeNextStep } = await import('./workflowEngine.js')
        await executeNextStep(executionId, step.nextStepId)
      }
      break
    }

    case 'add_tag': {
      if (!config.tagName) break
      // Buscar ou criar tag
      let tag = await prisma.tag.findFirst({ where: { name: config.tagName } })
      if (!tag) {
        tag = await prisma.tag.create({ data: { name: config.tagName, color: '#1a73e8' } })
      }
      // Verificar se já tem
      const exists = await prisma.leadTag.findUnique({
        where: { leadId_tagId: { leadId, tagId: tag.id } }
      })
      if (!exists) {
        await prisma.leadTag.create({ data: { leadId, tagId: tag.id } })
        logEvent({
          leadId,
          type: EVENT_TYPES.TAG_ADDED,
          category: 'lifecycle',
          title: `Tag "${config.tagName}" adicionada por workflow`,
          source: 'workflow',
          actorType: 'system',
          newValue: config.tagName,
          metadata: { executionId },
        })
      }

      await prisma.workflowStepExecution.update({
        where: { id: stepExec.id },
        data: { status: 'completed', completedAt: new Date(), result: { tagName: config.tagName } }
      })

      const step2 = await prisma.workflowStep.findUnique({ where: { id: stepId } })
      if (step2?.nextStepId) {
        const { executeNextStep } = await import('./workflowEngine.js')
        await executeNextStep(executionId, step2.nextStepId)
      }
      break
    }

    case 'remove_tag': {
      if (!config.tagName) break
      const tag = await prisma.tag.findFirst({ where: { name: config.tagName } })
      if (tag) {
        await prisma.leadTag.deleteMany({ where: { leadId, tagId: tag.id } })
        logEvent({
          leadId,
          type: EVENT_TYPES.TAG_REMOVED,
          category: 'lifecycle',
          title: `Tag "${config.tagName}" removida por workflow`,
          source: 'workflow',
          actorType: 'system',
          oldValue: config.tagName,
          metadata: { executionId },
        })
      }

      await prisma.workflowStepExecution.update({
        where: { id: stepExec.id },
        data: { status: 'completed', completedAt: new Date() }
      })

      const step3 = await prisma.workflowStep.findUnique({ where: { id: stepId } })
      if (step3?.nextStepId) {
        const { executeNextStep } = await import('./workflowEngine.js')
        await executeNextStep(executionId, step3.nextStepId)
      }
      break
    }

    case 'create_task': {
      const job = await queues.internalTask.add('create', {
        leadId,
        title: resolveVariables(config.title || 'Tarefa do workflow', lead),
        type: config.taskType || 'task',
        description: config.description ? resolveVariables(config.description, lead) : undefined,
        stepExecutionId: stepExec.id,
      }, {
        attempts: 2,
        backoff: { type: 'fixed', delay: 5000 },
      })
      await prisma.workflowStepExecution.update({
        where: { id: stepExec.id },
        data: { jobId: job.id }
      })
      break
    }

    case 'assign_to_team': {
      if (!config.teamId) {
        await prisma.workflowStepExecution.update({
          where: { id: stepExec.id },
          data: { status: 'failed', error: 'teamId não informado', completedAt: new Date() },
        })
        return
      }
      const team = await prisma.team.findUnique({
        where: { id: config.teamId },
        select: { id: true, name: true, active: true },
      })
      if (!team || !team.active) {
        await prisma.workflowStepExecution.update({
          where: { id: stepExec.id },
          data: { status: 'failed', error: `Equipe ${config.teamId} não existe ou está inativa`, completedAt: new Date() },
        })
        return
      }

      // Se já tem operador atribuído mas ele não é membro da nova equipe, libera
      // (mantém o assignedUserId apenas quando faz sentido na nova equipe).
      let nextAssignedUserId = lead.assignedUserId
      if (lead.assignedUserId && lead.teamId !== team.id) {
        const isMember = await prisma.teamMember.findUnique({
          where: { teamId_userId: { teamId: team.id, userId: lead.assignedUserId } },
          select: { id: true },
        })
        if (!isMember) nextAssignedUserId = null
      }

      const oldTeam = lead.teamId
        ? await prisma.team.findUnique({ where: { id: lead.teamId }, select: { name: true } })
        : null
      const oldUser = lead.assignedUserId
        ? await prisma.user.findUnique({ where: { id: lead.assignedUserId }, select: { id: true, name: true, email: true } })
        : null
      const newUser = nextAssignedUserId
        ? await prisma.user.findUnique({ where: { id: nextAssignedUserId }, select: { id: true, name: true, email: true } })
        : null

      const oldLabel = describeAssignment(oldUser, oldTeam)
      const newLabel = describeAssignment(newUser, team)

      await prisma.lead.update({
        where: { id: leadId },
        data: {
          teamId: team.id,
          assignedUserId: nextAssignedUserId,
          assignedAt: new Date(),
        },
      })

      logEvent({
        leadId,
        type: EVENT_TYPES.OPERATOR_ASSIGNED,
        category: 'operator',
        title: `Lead atribuído ao setor ${team.name} por workflow`,
        source: 'workflow',
        actorType: 'system',
        oldValue: oldLabel,
        newValue: newLabel,
        metadata: {
          executionId,
          previousAssignedUserId: lead.assignedUserId,
          previousTeamId: lead.teamId,
          newAssignedUserId: nextAssignedUserId,
          newTeamId: team.id,
        },
      })

      await prisma.workflowStepExecution.update({
        where: { id: stepExec.id },
        data: {
          status: 'completed',
          completedAt: new Date(),
          result: { teamId: team.id, teamName: team.name, releasedUser: lead.assignedUserId !== nextAssignedUserId },
        },
      })

      const stepAssignTeam = await prisma.workflowStep.findUnique({ where: { id: stepId } })
      if (stepAssignTeam?.nextStepId) {
        const { executeNextStep } = await import('./workflowEngine.js')
        await executeNextStep(executionId, stepAssignTeam.nextStepId)
      }
      break
    }

    case 'assign_to_user': {
      if (!config.userId) {
        await prisma.workflowStepExecution.update({
          where: { id: stepExec.id },
          data: { status: 'failed', error: 'userId não informado', completedAt: new Date() },
        })
        return
      }
      const targetUser = await prisma.user.findUnique({
        where: { id: config.userId },
        select: { id: true, name: true, email: true, active: true },
      })
      if (!targetUser || !targetUser.active) {
        await prisma.workflowStepExecution.update({
          where: { id: stepExec.id },
          data: { status: 'failed', error: `Operador ${config.userId} não existe ou está inativo`, completedAt: new Date() },
        })
        return
      }

      // Coerência de equipe: se a equipe atual não inclui o operador, ajusta
      // para a primeira equipe que ele integra. Sem nenhuma equipe, falha.
      let nextTeamId = lead.teamId
      if (nextTeamId) {
        const isMember = await prisma.teamMember.findUnique({
          where: { teamId_userId: { teamId: nextTeamId, userId: targetUser.id } },
          select: { id: true },
        })
        if (!isMember) nextTeamId = null
      }
      if (!nextTeamId) {
        const firstMembership = await prisma.teamMember.findFirst({
          where: { userId: targetUser.id, team: { active: true } },
          orderBy: { teamId: 'asc' },
          select: { teamId: true },
        })
        if (firstMembership) nextTeamId = firstMembership.teamId
      }
      if (!nextTeamId) {
        await prisma.workflowStepExecution.update({
          where: { id: stepExec.id },
          data: { status: 'failed', error: 'Operador não pertence a nenhuma equipe ativa', completedAt: new Date() },
        })
        return
      }

      const newTeam = await prisma.team.findUnique({ where: { id: nextTeamId }, select: { id: true, name: true } })
      const oldTeam = lead.teamId
        ? await prisma.team.findUnique({ where: { id: lead.teamId }, select: { name: true } })
        : null
      const oldUser = lead.assignedUserId
        ? await prisma.user.findUnique({ where: { id: lead.assignedUserId }, select: { id: true, name: true, email: true } })
        : null

      const oldLabel = describeAssignment(oldUser, oldTeam)
      const newLabel = describeAssignment(targetUser, newTeam)

      await prisma.lead.update({
        where: { id: leadId },
        data: {
          assignedUserId: targetUser.id,
          teamId: nextTeamId,
          assignedAt: new Date(),
        },
      })

      logEvent({
        leadId,
        type: EVENT_TYPES.OPERATOR_ASSIGNED,
        category: 'operator',
        title: `Lead atribuído a ${targetUser.name || targetUser.email} por workflow`,
        source: 'workflow',
        actorType: 'system',
        oldValue: oldLabel,
        newValue: newLabel,
        metadata: {
          executionId,
          previousAssignedUserId: lead.assignedUserId,
          previousTeamId: lead.teamId,
          newAssignedUserId: targetUser.id,
          newTeamId: nextTeamId,
        },
      })

      await prisma.workflowStepExecution.update({
        where: { id: stepExec.id },
        data: {
          status: 'completed',
          completedAt: new Date(),
          result: { userId: targetUser.id, teamId: nextTeamId },
        },
      })

      const stepAssignUser = await prisma.workflowStep.findUnique({ where: { id: stepId } })
      if (stepAssignUser?.nextStepId) {
        const { executeNextStep } = await import('./workflowEngine.js')
        await executeNextStep(executionId, stepAssignUser.nextStepId)
      }
      break
    }

    case 'transfer_to_team': {
      if (!config.teamId) {
        await prisma.workflowStepExecution.update({
          where: { id: stepExec.id },
          data: { status: 'failed', error: 'teamId não informado', completedAt: new Date() },
        })
        return
      }
      const team = await prisma.team.findUnique({
        where: { id: config.teamId },
        select: { id: true, name: true, active: true },
      })
      if (!team || !team.active) {
        await prisma.workflowStepExecution.update({
          where: { id: stepExec.id },
          data: { status: 'failed', error: `Equipe ${config.teamId} não existe ou está inativa`, completedAt: new Date() },
        })
        return
      }

      // Transferência sempre devolve o lead para a fila da nova equipe (libera operador).
      const oldTeam = lead.teamId
        ? await prisma.team.findUnique({ where: { id: lead.teamId }, select: { name: true } })
        : null
      const oldUser = lead.assignedUserId
        ? await prisma.user.findUnique({ where: { id: lead.assignedUserId }, select: { id: true, name: true, email: true } })
        : null

      const oldLabel = describeAssignment(oldUser, oldTeam)
      const newLabel = describeAssignment(null, team)

      const reason = config.reason ? resolveVariables(config.reason, lead, triggerData) : undefined

      await prisma.lead.update({
        where: { id: leadId },
        data: {
          teamId: team.id,
          assignedUserId: null,
          assignedAt: new Date(),
        },
      })

      logEvent({
        leadId,
        type: EVENT_TYPES.OPERATOR_ASSIGNED,
        category: 'operator',
        title: `Lead transferido para setor ${team.name} por workflow`,
        source: 'workflow',
        actorType: 'system',
        oldValue: oldLabel,
        newValue: newLabel,
        description: reason,
        metadata: {
          executionId,
          previousAssignedUserId: lead.assignedUserId,
          previousTeamId: lead.teamId,
          newAssignedUserId: null,
          newTeamId: team.id,
          transfer: true,
        },
      })

      await prisma.workflowStepExecution.update({
        where: { id: stepExec.id },
        data: {
          status: 'completed',
          completedAt: new Date(),
          result: { teamId: team.id, teamName: team.name, reason: reason ?? null },
        },
      })

      const stepTransfer = await prisma.workflowStep.findUnique({ where: { id: stepId } })
      if (stepTransfer?.nextStepId) {
        const { executeNextStep } = await import('./workflowEngine.js')
        await executeNextStep(executionId, stepTransfer.nextStepId)
      }
      break
    }

    case 'webhook': {
      const webhookBody = config.webhookBody || {
        leadId: lead.id,
        nome: lead.nome,
        empresa: lead.empresa,
        whatsapp: lead.whatsapp,
        email: lead.email,
        status: lead.status,
        executionId,
      }
      const job = await queues.webhook.add('call', {
        url: config.url,
        method: config.method || 'POST',
        headers: config.headers || {},
        body: webhookBody,
        leadId,
        stepExecutionId: stepExec.id,
      }, {
        attempts: 5,
        backoff: { type: 'exponential', delay: 30000 },
      })
      await prisma.workflowStepExecution.update({
        where: { id: stepExec.id },
        data: { jobId: job.id }
      })
      break
    }

    default:
      await prisma.workflowStepExecution.update({
        where: { id: stepExec.id },
        data: { status: 'failed', error: `Action type desconhecido: ${config.actionType}`, completedAt: new Date() }
      })
  }
}
