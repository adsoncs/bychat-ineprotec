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
  // create_task — prazo e responsável (módulo Resumo). Ausentes = vence agora,
  // dono é o responsável pelo lead (comportamento anterior ao módulo).
  dueMode?: string // immediate | hours | days | business_days
  dueValue?: number
  assigneeMode?: string // lead_owner | team | user | round_robin | creator
  assigneeUserId?: number | null
  assigneeTeamId?: number | null
  templateCode?: string | null
  // set_summary
  code?: string
  note?: string
  lossReasonId?: number | null
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
  // notify_operator (aviso interno ao operador/setor responsável)
  waTemplateId?: number
  emailTemplateId?: number
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
        // Prazo e responsável (módulo Resumo). Omitidos = comportamento antigo:
        // vence agora, dono é o responsável pelo lead.
        dueMode: config.dueMode || 'immediate',
        dueValue: config.dueValue ?? 0,
        assigneeMode: config.assigneeMode || 'lead_owner',
        assigneeUserId: config.assigneeUserId ?? null,
        assigneeTeamId: config.assigneeTeamId ?? null,
        templateCode: config.templateCode || null,
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

    case 'set_summary': {
      // Aplica um Resumo pelo motor. NÃO duplica os efeitos aqui: mover etapa,
      // criar atividade e marcar ganho/perdido saem todos de applyStatusSummary,
      // que é o único lugar onde essas regras vivem.
      if (!config.code) {
        await prisma.workflowStepExecution.update({
          where: { id: stepExec.id },
          data: { status: 'failed', error: 'code do resumo não informado', completedAt: new Date() },
        })
        return
      }
      try {
        const { applyStatusSummary } = await import('./statusSummaryEngine.js')
        const result = await applyStatusSummary({
          leadId,
          code: String(config.code).trim().toUpperCase(),
          source: 'workflow',
          note: config.note ? resolveVariables(config.note, lead) : undefined,
          lossReasonId: config.lossReasonId ?? null,
          // Workflow não tem operador na frente pra corrigir campo faltando: as
          // travas de governança são de painel, aqui elas só travariam a automação.
          skipGuards: true,
        })
        await prisma.workflowStepExecution.update({
          where: { id: stepExec.id },
          data: { status: 'completed', result: result as never, completedAt: new Date() },
        })
      } catch (e) {
        await prisma.workflowStepExecution.update({
          where: { id: stepExec.id },
          data: { status: 'failed', error: (e as Error).message, completedAt: new Date() },
        })
        return
      }
      const stepSum = await prisma.workflowStep.findUnique({ where: { id: stepId } })
      if (stepSum?.nextStepId) {
        const { executeNextStep } = await import('./workflowEngine.js')
        await executeNextStep(executionId, stepSum.nextStepId)
      }
      break
    }

    case 'resume_bot': {
      // Devolve a conversa ao chatbot antes de uma retomada automática. Sem isto, o
      // fluxo cutuca um lead que o bot está proibido de atender (a pausa por takeover
      // é definitiva): a pessoa responde e ninguém do outro lado responde.
      const minutes = Number((config as any).skipIfRecentOperatorMin ?? 24 * 60)
      const since = new Date(Date.now() - minutes * 60000)
      const recentOutbound = await prisma.message.findFirst({
        where: { leadId, fromMe: true, isInternal: false, createdAt: { gt: since } },
        select: { id: true },
      })
      if (recentOutbound) {
        await prisma.workflowStepExecution.update({
          where: { id: stepExec.id },
          data: { status: 'skipped', result: { reason: 'atendimento humano recente' }, completedAt: new Date() },
        })
        return
      }
      const { resumeBot } = await import('./botTakeover.js')
      const resumed = await resumeBot(leadId, { userId: null, userName: 'Fluxo automático' })
      await prisma.workflowStepExecution.update({
        where: { id: stepExec.id },
        data: { status: 'completed', result: { resumed }, completedAt: new Date() },
      })
      return
    }

    case 'notify_operator': {
      // Aviso de NOVO LEAD à equipe (não vai ao lead). Envia direto (síncrono), sem
      // governança/opt-out. Destinos GERAIS configuráveis em Configurações › Empresa ›
      // Dados de Notificações (listas de e-mails e WhatsApps; fallback p/ env legada).
      // Cópia opcional para os agentes ativos (toggle ccAgents). Texto vem de
      // MessageTemplate (editável).
      const { getNotificationTargets, sendEmailGeneric, getEmailConfig, getFromAddress } = await import('./notify.js')
      const targets = await getNotificationTargets()
      const generalPhones = targets.whatsapps
      const generalEmail = targets.emails.join(', ')
      // Cópia para os e-mails dos agentes ativos, quando habilitado.
      let ccList = ''
      if (targets.ccAgents) {
        const agents = await prisma.user.findMany({ where: { active: true, isAgent: true }, select: { email: true } })
        ccList = Array.from(new Set(agents.map((a) => a.email).filter(Boolean))).join(', ')
      }
      // Nome do operador responsável (apenas para a variável {{operador}} do template).
      let opName = ''
      if (lead.assignedUserId) {
        const u = await prisma.user.findUnique({ where: { id: lead.assignedUserId }, select: { name: true } })
        opName = u?.name || ''
      }
      const origem = triggerData?.payload?.metadata?.formName || triggerData?.payload?.metadata?.formId || ''
      const enriched = { ...triggerData, payload: { ...(triggerData?.payload || {}), operador: opName, origem, etapa: lead.status || '' } }

      // WhatsApp → todos os números gerais
      if (generalPhones.length > 0 && config.waTemplateId) {
        const tpl = await prisma.messageTemplate.findUnique({ where: { id: config.waTemplateId } })
        const body = resolveVariables(tpl?.body || '', lead, enriched)
        if (body.trim()) {
          // Aviso interno → Evolution (número conectado da instância). Não usar
          // getDefaultProvider (pode cair na Cloud API, que não entrega texto
          // livre a número fora da janela 24h).
          const { createEvolutionProvider } = await import('./whatsappProvider.js')
          const provider = createEvolutionProvider()
          const { registrarSaidaParaGrupo } = await import('./groupOutboundLog.js')
          for (const phone of generalPhones) {
            try {
              const r = await provider.sendText(phone, body)
              // Destino é grupo acompanhado no painel: a bolha entra na conversa.
              // Sem isso o aviso existia só no WhatsApp, e quem respondesse
              // citando ele chegava aqui sem o trecho citado.
              await registrarSaidaParaGrupo({
                destino: phone, texto: body, externalId: r?.messageId ?? null,
                instanceName: (provider as any).instanceName ?? null,
              })
            } catch (e: any) { console.warn(`[notify_operator] WhatsApp falhou (${phone}):`, e?.message) }
          }
          prisma.messageTemplate.update({ where: { id: config.waTemplateId }, data: { usageCount: { increment: 1 } } }).catch(() => {})
        }
      }
      // E-mail → destino geral + cópia aos agentes
      const email = generalEmail
      if (email && config.emailTemplateId) {
        const tpl = await prisma.messageTemplate.findUnique({ where: { id: config.emailTemplateId } })
        const { decodeHtmlIfEscaped } = await import('../lib/interpolate.js')
        const subject = resolveVariables(tpl?.subject || 'Novo lead', lead, enriched)
        const html = resolveVariables(decodeHtmlIfEscaped(tpl?.bodyHtml) || tpl?.body || '', lead, enriched)
        if (html.trim()) {
          try {
            const cfg = await getEmailConfig()
            await sendEmailGeneric({ from: getFromAddress(cfg, 'Novo lead'), to: email, ...(ccList ? { cc: ccList } : {}), subject, html })
            prisma.messageTemplate.update({ where: { id: config.emailTemplateId }, data: { usageCount: { increment: 1 } } }).catch(() => {})
          } catch (e: any) { console.warn('[notify_operator] e-mail falhou:', e?.message) }
        }
      }
      await prisma.workflowStepExecution.update({
        where: { id: stepExec.id },
        data: { status: 'completed', completedAt: new Date(), result: { phone: generalPhones.join(', ') || null, email: email || null, cc: ccList || null } },
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
