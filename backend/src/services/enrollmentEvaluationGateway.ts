// src/services/enrollmentEvaluationGateway.ts
// Gateway compartilhado de avaliação de inscrições. Concentra a lógica usada
// tanto pelas rotas (enrollmentDocReview, enrollmentEvaluations) quanto por
// jobs/serviços que precisam decidir se a inscrição está pronta para avançar
// (ex.: aiEssayReview no auto-veredito).
//
// Mora em services/ pra evitar dependência circular: services importam disto;
// rotas importam disto. Nenhum import de routes acontece aqui.

import { prisma } from '../lib/prisma.js'
import { eventBus } from '../lib/eventBus.js'
import { logEvent, EVENT_TYPES } from './leadHistory.js'

export type EvaluationStatus = 'pending' | 'approved' | 'rejected' | 'na'
export type DocsCompletionStatus = 'pending' | 'rejected' | 'complete'

/**
 * Calcula status documental derivado a partir de requirements (esperados) + docs (efetivos).
 * Considera apenas requirements `required: true` para o veredito final.
 *
 *  - 'pending':  algum obrigatório sem upload OU em status 'pending'
 *  - 'rejected': algum obrigatório com último upload em 'rejected' (precisa reenvio)
 *  - 'complete': todos os obrigatórios estão 'approved'
 *
 * `pending` tem prioridade sobre `rejected` (se uma parte falta enviar, o candidato
 * ainda pode estar em processo — não trata como "aguardando reenvio").
 */
export function computeDocsCompletionStatus(requirements: any[], docs: any[]): DocsCompletionStatus {
  const required = requirements.filter(r => r.required)
  if (required.length === 0) return 'complete'  // sem obrigatórios definidos

  // Index do último doc por code (docs vem ordenado desc por uploadedAt)
  const latestByCode: Record<string, any> = {}
  for (const d of docs) {
    const code = d.type?.code || d.typeCode
    if (!code) continue
    if (!latestByCode[code]) latestByCode[code] = d
  }

  let hasPending = false
  let hasRejected = false
  for (const r of required) {
    const code = r.documentType?.code
    const d = code ? latestByCode[code] : null
    if (!d) { hasPending = true; continue }
    if (d.status === 'pending') hasPending = true
    else if (d.status === 'rejected') hasRejected = true
    // approved → ok
  }
  if (hasPending) return 'pending'
  if (hasRejected) return 'rejected'
  return 'complete'
}

/**
 * Avalia o status da AVALIAÇÃO específica do modo de ingresso (não documental).
 * Retorna 'na' quando o modo não exige avaliação.
 */
export async function computeEvaluationStatus(registrationId: number): Promise<{
  status: EvaluationStatus
  evaluationType: string | null
  detail?: any
}> {
  const reg = await prisma.enrollmentRegistration.findUnique({
    where: { id: registrationId },
    select: {
      processRegistration: {
        select: {
          selectionProcess: {
            select: {
              entryMode: { select: { evaluationType: true, code: true } },
            },
          },
        },
      },
    },
  })
  const evType = reg?.processRegistration?.selectionProcess?.entryMode?.evaluationType || null
  if (!evType || evType === 'none' || evType === 'docs') return { status: 'na', evaluationType: evType }

  if (evType === 'enem') {
    const last = await prisma.enemScoreImport.findFirst({
      where: { registrationId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, passed: true, validatedAt: true },
    })
    if (!last) return { status: 'pending', evaluationType: evType }
    if (!last.validatedAt && last.passed == null) return { status: 'pending', evaluationType: evType }
    return { status: last.passed ? 'approved' : 'rejected', evaluationType: evType, detail: { importId: last.id } }
  }

  if (evType === 'exam_presencial') {
    const last = await prisma.presencialExam.findFirst({
      where: { registrationId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, verdict: true },
    })
    if (!last || last.verdict === 'pending') return { status: 'pending', evaluationType: evType }
    return { status: last.verdict === 'approved' ? 'approved' : 'rejected', evaluationType: evType, detail: { examId: last.id } }
  }

  if (evType === 'exam_online') {
    const last = await prisma.essaySubmission.findFirst({
      where: { registrationId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, passed: true },
    })
    if (!last) return { status: 'pending', evaluationType: evType }
    if (last.status === 'approved') return { status: 'approved', evaluationType: evType, detail: { submissionId: last.id } }
    if (last.status === 'rejected') return { status: 'rejected', evaluationType: evType, detail: { submissionId: last.id } }
    return { status: 'pending', evaluationType: evType, detail: { submissionId: last.id, state: last.status } }
  }

  return { status: 'pending', evaluationType: evType }
}

/**
 * Gateway final: docs completos + avaliação OK → emite evento `enrollment.fully_evaluated`
 * e move o lead para `portal.finalApprovalStageKey`, se configurado.
 *
 * Idempotente — só age quando o lead ainda não está na stage destino.
 *
 * `actorUserId` pode ser null quando disparado por sistema (ex.: worker de IA).
 */
export async function tryAutoAdvanceOnEvaluationComplete(
  registrationId: number,
  actorUserId: number | null,
): Promise<boolean> {
  const reg = await prisma.enrollmentRegistration.findUnique({
    where: { id: registrationId },
    select: {
      id: true, candidateCode: true,
      lead: { select: { id: true, status: true } },
      portal: { select: { id: true, nome: true, finalApprovalStageKey: true, funnel: { select: { stages: { select: { key: true, name: true } } } } } },
      processRegistration: {
        select: {
          selectionProcess: {
            select: {
              useCustomDocuments: true,
              documentRequirements: { select: { required: true, documentType: { select: { code: true } } } },
              entryMode: {
                select: {
                  evaluationType: true,
                  documentRequirements: { select: { required: true, documentType: { select: { code: true } } } },
                },
              },
            },
          },
        },
      },
      documents: { select: { status: true, typeCode: true, type: { select: { code: true } } }, orderBy: { uploadedAt: 'desc' } },
    },
  })
  if (!reg?.lead || !reg.portal?.finalApprovalStageKey) return false
  if (reg.lead.status === reg.portal.finalApprovalStageKey) return false  // já está lá

  const sp: any = reg.processRegistration?.selectionProcess
  const reqs = sp
    ? (sp.useCustomDocuments && Array.isArray(sp.documentRequirements) && sp.documentRequirements.length > 0
        ? sp.documentRequirements
        : (sp.entryMode?.documentRequirements || []))
    : []

  const docsStatus = computeDocsCompletionStatus(reqs, reg.documents as any[])
  if (docsStatus !== 'complete') return false

  const evalRes = await computeEvaluationStatus(reg.id)
  if (evalRes.status !== 'approved' && evalRes.status !== 'na') return false

  const stageKey = reg.portal.finalApprovalStageKey
  await prisma.lead.update({
    where: { id: reg.lead.id },
    data: { status: stageKey, updatedAt: new Date() },
  })

  logEvent({
    leadId: reg.lead.id,
    type: EVENT_TYPES.STATUS_CHANGED,
    category: 'lifecycle',
    title: `Etapa alterada automaticamente (aprovação final): "${stageKey}"`,
    source: 'system',
    actorType: 'system',
    description: `Documentos completos + avaliação ${evalRes.evaluationType || ''} aprovada (inscrição ${reg.candidateCode}).`,
    metadata: {
      registrationId: reg.id, candidateCode: reg.candidateCode,
      portalId: reg.portal.id, newStageKey: stageKey,
      trigger: 'evaluation_complete', evaluationType: evalRes.evaluationType,
      actorUserId: actorUserId || undefined,
    },
  })

  // Emite evento de inscrição totalmente avaliada — workflow opcional pode notificar.
  eventBus.emitDomain({
    type: 'enrollment.fully_evaluated',
    leadId: reg.lead.id,
    payload: {
      registrationId: reg.id,
      candidateCode: reg.candidateCode,
      portalNome: reg.portal.nome,
      evaluationType: evalRes.evaluationType,
    },
    timestamp: new Date(),
  })

  return true
}
