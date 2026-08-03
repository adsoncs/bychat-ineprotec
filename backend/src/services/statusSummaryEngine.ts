// src/services/statusSummaryEngine.ts
// Motor de Resumos — ponto de entrada ÚNICO para classificar a situação de um lead.
//
// A ideia: o operador não arrasta card nem inventa o título da tarefa. Ele
// escolhe o Resumo que descreve a situação ("AT-200 SOLICITOU MATRICULA") e o
// motor deriva tudo — move de etapa/funil, conclui o que ficou aberto, cria as
// atividades certas com prazo e responsável, marca ganho/perdido com objeção e
// inscreve em cadência. Dois consultores na mesma situação produzem o mesmo
// estado no CRM; é isso que torna o funil mensurável.
//
// TODO caminho de entrada (painel, workflow, chatbot, API, cron da escada) chama
// applyStatusSummary. Não duplicar esses efeitos em call site nenhum.

import { prisma } from '../lib/prisma.js'
import { eventBus } from '../lib/eventBus.js'
import { logEvent, EVENT_TYPES } from './leadHistory.js'
import { moveLeadStage } from './leadStageMove.js'
import { markLeadWon, markLeadLost } from './leadOutcome.js'
import { getBusinessHoursConfig, nextBusinessTime } from './businessHours.js'
import { pickOperatorForTeam } from './teamRouting.js'

export const STATUS_SUMMARY_EVENT = 'lead.summary_changed'

export type ApplySource = 'panel' | 'workflow' | 'chatbot' | 'api' | 'auto_advance' | 'import' | 'seed'

export interface ApplyStatusSummaryInput {
  leadId: number
  /** Código do resumo (ex.: "AT-200"). Resolvido no catálogo do funil do lead. */
  code: string
  userId?: number | null
  userName?: string | null
  source?: ApplySource
  note?: string
  /** Objeção escolhida pelo operador — obrigatória quando requireLossReason. */
  lossReasonId?: number | null
  /**
   * Data explícita para as atividades com dueMode 'lead_defined' ("o lead pediu
   * pra chamar dia 20"). Ignorada nos demais modos.
   */
  dueAt?: Date | null
  /** Pula validação de allowedFromStages/requiredFields (cron, import, seed). */
  skipGuards?: boolean
}

export interface ApplyStatusSummaryResult {
  leadId: number
  summaryId: number
  code: string
  previousCode: string | null
  movedStage: { from: string | null; to: string | null } | null
  createdActivityIds: number[]
  closedActivities: number
  outcomeApplied: 'won' | 'lost' | null
  enrolledCadenceId: number | null
}

export class StatusSummaryError extends Error {
  constructor(message: string, readonly code: string, readonly details?: unknown) {
    super(message)
    this.name = 'StatusSummaryError'
  }
}

/**
 * Resolve o resumo pelo código dentro do escopo do lead.
 * Catálogo é POR FUNIL: procura primeiro o resumo do funil do lead, depois o
 * global (funnelId null). Assim um tenant pode ter AT-200 com efeitos diferentes
 * em funis diferentes, e ainda manter um catálogo comum de base.
 */
export async function resolveSummary(code: string, funnelId: number | null) {
  const candidates = await prisma.statusSummary.findMany({
    where: {
      code,
      active: true,
      ...(funnelId != null
        ? { OR: [{ funnelId }, { funnelId: null }] }
        : { funnelId: null }),
    },
    include: {
      activities: {
        include: { activityTemplate: true },
        orderBy: { order: 'asc' },
      },
    },
  })
  if (candidates.length === 0) return null
  // Específico do funil ganha do global.
  return candidates.find((c) => c.funnelId === funnelId) ?? candidates[0]
}

type ResolvedSummary = NonNullable<Awaited<ReturnType<typeof resolveSummary>>>
type SummaryActivity = ResolvedSummary['activities'][number]

/**
 * Prazo de uma tarefa a partir do modo. Exportado para o worker de tarefas do
 * Workflow usar a MESMA regra — senão o produto teria duas noções de "3 dias".
 */
export async function resolveTaskDueAt(mode: string, value: number, explicitDueAt?: Date | null): Promise<Date> {
  return resolveDueAt(mode, value, explicitDueAt, new Date())
}

/** Responsável de uma tarefa, resolvido pelo lead. Espelho do resolveAssignee. */
export async function resolveTaskAssignee(
  leadId: number,
  tpl: { assigneeMode: string; assigneeUserId: number | null; assigneeTeamId: number | null },
  actorUserId: number | null = null,
): Promise<{ assignedUserId: number | null; assignedTeamId: number | null }> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { assignedUserId: true, teamId: true },
  })
  if (!lead) return { assignedUserId: actorUserId, assignedTeamId: null }
  return resolveAssignee(tpl, lead, actorUserId)
}

/** Calcula o vencimento de uma atividade a partir do modo de prazo. */
async function resolveDueAt(
  mode: string,
  value: number,
  explicitDueAt: Date | null | undefined,
  now: Date,
): Promise<Date> {
  switch (mode) {
    case 'immediate':
      return now
    case 'hours':
      return new Date(now.getTime() + value * 3600_000)
    case 'days':
      return new Date(now.getTime() + value * 86_400_000)
    case 'business_days': {
      // Conta `value` dias ÚTEIS, pulando os dias sem expediente durante a
      // contagem — não basta somar dias corridos e empurrar o resultado, senão
      // "cobrar em 5 dias úteis" cai em 5 dias corridos.
      const cfg = await getBusinessHoursConfig()
      // Horário comercial desligado (default da instalação): assume seg–sex,
      // que é a expectativa de quem escreve "dias úteis" numa régua de cobrança.
      const isWorkday = (d: Date): boolean => {
        if (!cfg.enabled) {
          const wd = d.getDay()
          return wd !== 0 && wd !== 6
        }
        const slots = cfg.schedule[String(d.getDay())]
        return !!slots && slots.length > 0
      }

      const cursor = new Date(now)
      let remaining = Math.max(0, value)
      // Teto defensivo: catálogo mal configurado (todo dia sem expediente) não
      // pode virar laço infinito.
      for (let guard = 0; remaining > 0 && guard < 400; guard++) {
        cursor.setDate(cursor.getDate() + 1)
        if (isWorkday(cursor)) remaining--
      }
      // Já no dia certo, encaixa no horário de atendimento quando houver um.
      return nextBusinessTime(cfg, cursor)
    }
    case 'lead_defined':
      // Sem data informada, vira imediata: melhor o operador ver a pendência hoje
      // do que a atividade sumir com vencimento indefinido.
      return explicitDueAt ?? now
    default:
      return now
  }
}

/** Resolve quem executa a atividade gerada. */
async function resolveAssignee(
  tpl: { assigneeMode: string; assigneeTeamId: number | null; assigneeUserId: number | null },
  lead: { assignedUserId: number | null; teamId: number | null },
  actorUserId: number | null,
  /** Responsável da atividade anterior — evita órfã na escada automática. */
  fallback?: { assignedUserId: number | null; assignedTeamId: number | null } | null,
): Promise<{ assignedUserId: number | null; assignedTeamId: number | null }> {
  switch (tpl.assigneeMode) {
    case 'team':
      // Fila do setor, sem dono — quem estiver livre puxa.
      return { assignedUserId: null, assignedTeamId: tpl.assigneeTeamId ?? lead.teamId }
    case 'user':
      return { assignedUserId: tpl.assigneeUserId, assignedTeamId: tpl.assigneeTeamId ?? null }
    case 'round_robin': {
      const teamId = tpl.assigneeTeamId ?? lead.teamId
      if (!teamId) return { assignedUserId: actorUserId, assignedTeamId: null }
      const picked = await pickOperatorForTeam(teamId).catch(() => null)
      return { assignedUserId: picked, assignedTeamId: teamId }
    }
    case 'creator':
      return { assignedUserId: actorUserId, assignedTeamId: null }
    case 'lead_owner':
    default:
      return {
        assignedUserId: lead.assignedUserId ?? actorUserId ?? fallback?.assignedUserId ?? null,
        assignedTeamId: lead.teamId ?? fallback?.assignedTeamId ?? null,
      }
  }
}

/** Valida as travas de governança do resumo. Lança StatusSummaryError. */
function assertGuards(
  summary: ResolvedSummary,
  lead: { status: string | null; customFields: unknown },
  lossReasonId: number | null | undefined,
) {
  const allowed = summary.allowedFromStages as string[] | null
  if (Array.isArray(allowed) && allowed.length > 0) {
    if (!lead.status || !allowed.includes(lead.status)) {
      throw new StatusSummaryError(
        `O resumo ${summary.code} só pode ser aplicado a partir das etapas: ${allowed.join(', ')}`,
        'STAGE_NOT_ALLOWED',
        { allowed, current: lead.status },
      )
    }
  }

  const required = summary.requiredFields as string[] | null
  if (Array.isArray(required) && required.length > 0) {
    const cf = (lead.customFields ?? {}) as Record<string, unknown>
    const missing = required.filter((k) => {
      const v = cf[k]
      return v === undefined || v === null || v === ''
    })
    if (missing.length > 0) {
      throw new StatusSummaryError(
        `Preencha antes de aplicar ${summary.code}: ${missing.join(', ')}`,
        'REQUIRED_FIELDS_MISSING',
        { missing },
      )
    }
  }

  if (summary.requireLossReason && !lossReasonId && !summary.defaultLossReasonId) {
    throw new StatusSummaryError(
      `O resumo ${summary.code} exige que você aponte a objeção`,
      'LOSS_REASON_REQUIRED',
    )
  }
}

/**
 * Aplica um resumo a um lead e executa todos os efeitos declarados.
 * Ordem importa: guardas → grava resumo → conclui abertas → move etapa →
 * outcome → cria atividades → cadência → histórico → evento.
 */
export async function applyStatusSummary(
  input: ApplyStatusSummaryInput,
): Promise<ApplyStatusSummaryResult> {
  const {
    leadId, code, userId = null, userName = null,
    source = 'panel', note, lossReasonId, dueAt, skipGuards,
  } = input

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true, status: true, funnelId: true, chatbotId: true, customFields: true,
      assignedUserId: true, teamId: true, whatsapp: true, email: true,
      statusSummaryId: true,
      statusSummary: { select: { id: true, code: true } },
    },
  })
  if (!lead) throw new StatusSummaryError(`Lead ${leadId} não encontrado`, 'LEAD_NOT_FOUND')

  const summary = await resolveSummary(code, lead.funnelId ?? null)
  if (!summary) {
    throw new StatusSummaryError(
      `Resumo ${code} não existe no catálogo deste funil`,
      'SUMMARY_NOT_FOUND',
    )
  }

  if (!skipGuards) assertGuards(summary, lead, lossReasonId)

  const now = new Date()
  const previousCode = lead.statusSummary?.code ?? null
  const previousSummaryId = lead.statusSummaryId ?? null

  // 1) Grava o resumo atual no lead.
  await prisma.lead.update({
    where: { id: leadId },
    data: { statusSummaryId: summary.id, statusSummaryAt: now },
  })

  // 2) Conclui as atividades pendentes ANTES de gerar as novas — é o "conclui a
  //    atividade em aberto e altera o resumo" que o processo repete a cada passo.
  //
  //    Antes de fechar, guarda quem estava responsável: num degrau da escada
  //    aplicado pelo cron (sem operador) e com lead sem dono, a atividade nova
  //    nasceria órfã e a cobrança perderia o responsável no meio do caminho.
  const previousAssignee = await prisma.activity.findFirst({
    where: { leadId, status: 'pending', OR: [{ assignedUserId: { not: null } }, { assignedTeamId: { not: null } }] },
    orderBy: { createdAt: 'desc' },
    select: { assignedUserId: true, assignedTeamId: true },
  })

  let closedActivities = 0
  if (summary.closeOpenActivities) {
    const res = await prisma.activity.updateMany({
      where: { leadId, status: 'pending' },
      data: { status: 'completed', completedAt: now, result: `Concluída ao aplicar ${summary.code}` },
    })
    closedActivities = res.count
  }

  // 3) Move de etapa/funil.
  let movedStage: { from: string | null; to: string | null } | null = null
  if (summary.targetStageKey || summary.targetFunnelId) {
    const moved = await moveLeadStage({
      leadId,
      toStageKey: summary.targetStageKey,
      toFunnelId: summary.targetFunnelId,
      source: 'status_summary',
      reason: `Resumo ${summary.code} — ${summary.name}`,
      userId,
      metadata: { summaryId: summary.id, summaryCode: summary.code },
    })
    if (moved.moved) movedStage = { from: moved.fromStageKey, to: moved.toStageKey }
  }

  // 4) Outcome. Delega pro leadOutcome, que já cancela cadências/atividades e
  //    move pra etapa terminal quando o funil tem uma.
  let outcomeApplied: 'won' | 'lost' | null = null
  if (summary.setOutcome === 'won') {
    await markLeadWon({ leadId, note: note ?? `Resumo ${summary.code}`, userId: userId ?? undefined, userName: userName ?? undefined })
    outcomeApplied = 'won'
  } else if (summary.setOutcome === 'lost') {
    await markLeadLost({
      leadId,
      reasonId: lossReasonId ?? summary.defaultLossReasonId ?? undefined,
      note: note ?? `Resumo ${summary.code}`,
      userId: userId ?? undefined,
      userName: userName ?? undefined,
    })
    outcomeApplied = 'lost'
  }

  // 5) Atividades do catálogo. Quando o lead foi perdido/ganho, não gera nada:
  //    o leadOutcome acabou de cancelar as pendências, criar novas seria briga.
  const createdActivityIds: number[] = []
  if (!outcomeApplied) {
    for (const link of summary.activities) {
      const id = await createActivityFromTemplate(link, {
        lead, summary, actorUserId: userId, userName, dueAt, now, previousAssignee,
      })
      if (id) createdActivityIds.push(id)
    }
  }

  // 6) Cadência (reusa SalesCadence — a escada de follow-up já existe pronta).
  let enrolledCadenceId: number | null = null
  if (summary.enrollCadenceId && !outcomeApplied) {
    const enrolled = await prisma.cadenceEnrollment.upsert({
      where: { cadenceId_leadId: { cadenceId: summary.enrollCadenceId, leadId } },
      create: { cadenceId: summary.enrollCadenceId, leadId, nextActionAt: now, status: 'active' },
      update: {},
      select: { cadenceId: true },
    }).catch(() => null)
    enrolledCadenceId = enrolled?.cadenceId ?? null
  }

  const effects = {
    movedStage,
    createdActivityIds,
    closedActivities,
    outcomeApplied,
    enrolledCadenceId,
  }

  // 7) Histórico append-only — é o que permite medir conversão por resumo.
  await prisma.leadStatusHistory.create({
    data: {
      leadId,
      fromSummaryId: previousSummaryId,
      toSummaryId: summary.id,
      fromCode: previousCode,
      toCode: summary.code,
      changedByUserId: userId,
      source,
      note: note ?? null,
      effects: effects as never,
    },
  }).catch(() => { /* histórico não pode derrubar a operação */ })

  logEvent({
    leadId,
    type: EVENT_TYPES.STATUS_CHANGED,
    category: 'lifecycle',
    title: `Resumo: ${summary.code} — ${summary.name}`,
    source,
    actorType: userId ? 'operator' : 'system',
    userId: userId ?? undefined,
    userName: userName ?? undefined,
    oldValue: previousCode ?? undefined,
    newValue: summary.code,
    description: note,
    metadata: effects,
  })

  // 8) Evento de domínio — Workflows podem reagir a "virou AT-033".
  eventBus.emitDomain({
    type: STATUS_SUMMARY_EVENT,
    leadId,
    funnelId: lead.funnelId ?? undefined,
    chatbotId: lead.chatbotId ?? undefined,
    payload: {
      oldValue: previousCode,
      newValue: summary.code,
      metadata: {
        summaryId: summary.id,
        summaryCode: summary.code,
        sector: summary.sector,
        temperature: summary.temperature,
        source,
        ...effects,
      },
    },
    timestamp: now,
  })

  return {
    leadId,
    summaryId: summary.id,
    code: summary.code,
    previousCode,
    movedStage,
    createdActivityIds,
    closedActivities,
    outcomeApplied,
    enrolledCadenceId,
  }
}

async function createActivityFromTemplate(
  link: SummaryActivity,
  ctx: {
    lead: { id: number; whatsapp: string | null; email: string | null; assignedUserId: number | null; teamId: number | null }
    summary: ResolvedSummary
    actorUserId: number | null
    userName: string | null
    dueAt: Date | null | undefined
    now: Date
    previousAssignee: { assignedUserId: number | null; assignedTeamId: number | null } | null
  },
): Promise<number | null> {
  const tpl = link.activityTemplate
  if (!tpl || !tpl.active) return null

  const mode = link.dueOverrideMode ?? tpl.dueMode
  const value = link.dueOverrideValue ?? tpl.dueValue
  const scheduledAt = await resolveDueAt(mode, value, ctx.dueAt, ctx.now)
  const assignee = await resolveAssignee(tpl, ctx.lead, ctx.actorUserId, ctx.previousAssignee)

  // Título carrega o código: é como o time procura ("cadê o AT-WP-06 dele?").
  const title = `${tpl.code} — ${link.titleOverride ?? tpl.name}`.slice(0, 191)

  let messageBody: string | null = null
  let messageSubject: string | null = null
  if (tpl.messageTemplateId) {
    const mt = await prisma.messageTemplate.findUnique({
      where: { id: tpl.messageTemplateId },
      select: { body: true, subject: true },
    })
    messageBody = mt?.body ?? null
    messageSubject = mt?.subject ?? null
  }

  const activity = await prisma.activity.create({
    data: {
      leadId: ctx.lead.id,
      userId: ctx.actorUserId,
      userName: ctx.userName,
      assignedUserId: assignee.assignedUserId,
      assignedTeamId: assignee.assignedTeamId,
      templateCode: tpl.code,
      type: tpl.type,
      title,
      description: tpl.defaultDescription,
      status: 'pending',
      scheduledAt,
      recipientPhone: tpl.type === 'whatsapp' || tpl.type === 'sms' ? ctx.lead.whatsapp : null,
      recipientEmail: tpl.type === 'email' ? ctx.lead.email : null,
      messageBody,
      messageSubject,
      templateId: tpl.messageTemplateId,
      metadata: { summaryId: ctx.summary.id, summaryCode: ctx.summary.code, activityTemplateId: tpl.id } as never,
    },
    select: { id: true },
  })
  return activity.id
}
