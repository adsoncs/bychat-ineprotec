// src/services/cadenceMetrics.ts
//
// Sales Engagement E1+E4 (final): métricas completas de cadências.
// Resposta única consumida pelo dashboard.
//
// Convenções:
//   - "enrolled"        = total histórico (todos status)
//   - "byStatus"        = breakdown corrente
//   - "byExitReason"    = histórico de saídas
//   - "byReplyClass"    = soma das classificações IA (C3) já registradas
//   - "byChannel"       = execuções (sent/created_activity) por canal — E4
//   - "byOperator"      = activities completadas por operador (nome) — E4
//   - "stepReach"       = enrollments por currentStep — alimenta detector de "step morto" (E3)
//   - "conversionRate"  = % de leads inscritos que viraram DetectedSale APÓS o enrollment
//                          (filtra detectedAt >= enrolledAt — sem over-count)
//
// Performance: ~6 queries agregadas. Indexes em CadenceStepExecution
// (cadenceId+executedAt, operatorUserId) cobrem os groupBys.

import { prisma } from '../lib/prisma.js'

export interface OperatorBreakdown {
  userId: number
  name: string | null
  email: string | null
  count: number
}

export interface CadenceMetrics {
  cadenceId: number
  enrolled: number
  byStatus: Record<string, number>
  byExitReason: Record<string, number>
  byReplyClass: Record<string, number>
  byChannel: Record<string, number>
  byOperator: OperatorBreakdown[]
  stepReach: { step: number; count: number }[]
  conversionRate: number
  conversionCount: number
}

export async function getCadenceMetrics(cadenceId: number): Promise<CadenceMetrics> {
  const [byStatus, byExitReason, byReplyClass, stepGroups, enrolled, byChannelGroup, operatorGroups, conversionRows] =
    await Promise.all([
      prisma.cadenceEnrollment.groupBy({
        by: ['status'],
        where: { cadenceId },
        _count: { _all: true },
      }),
      prisma.cadenceEnrollment.groupBy({
        by: ['exitReason'],
        where: { cadenceId, exitReason: { not: null } },
        _count: { _all: true },
      }),
      prisma.cadenceEnrollment.groupBy({
        by: ['lastReplyClass'],
        where: { cadenceId, lastReplyClass: { not: null } },
        _count: { _all: true },
      }),
      prisma.cadenceEnrollment.groupBy({
        by: ['currentStep'],
        where: { cadenceId },
        _count: { _all: true },
      }),
      prisma.cadenceEnrollment.count({ where: { cadenceId } }),

      // E4: por canal — só conta execuções "produtivas" (sent ou created_activity).
      prisma.cadenceStepExecution.groupBy({
        by: ['channel'],
        where: { cadenceId, status: { in: ['sent', 'created_activity'] } },
        _count: { _all: true },
      }),

      // E4: por operador — activities completadas por humano.
      prisma.cadenceStepExecution.groupBy({
        by: ['operatorUserId'],
        where: { cadenceId, operatorUserId: { not: null }, completedAt: { not: null } },
        _count: { _all: true },
      }),

      // Conversão real: DetectedSale onde detectedAt >= enrollment.enrolledAt
      // do mesmo lead na mesma cadência. Lead que tinha sale ANTES do enrollment
      // não conta. DISTINCT no leadId pra não contar duas vendas do mesmo lead.
      prisma.$queryRaw<Array<{ converted: bigint }>>`
        SELECT COUNT(DISTINCT ce.leadId) AS converted
        FROM bychat_cadence_enrollments ce
        INNER JOIN bychat_detected_sales ds
          ON ds.leadId = ce.leadId
          AND ds.detectedAt >= ce.enrolledAt
          AND ds.status IN ('detected', 'confirmed')
        WHERE ce.cadenceId = ${cadenceId}
      `,
    ])

  // Resolve nomes dos operadores
  const operatorIds = operatorGroups
    .map((g) => g.operatorUserId)
    .filter((id): id is number => typeof id === 'number')
  const operators = operatorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: operatorIds } },
        select: { id: true, name: true, email: true },
      })
    : []
  const operatorMap = new Map(operators.map((u) => [u.id, u]))

  const byOperator: OperatorBreakdown[] = operatorGroups
    .filter((g) => g.operatorUserId !== null)
    .map((g) => {
      const u = operatorMap.get(g.operatorUserId as number)
      return {
        userId: g.operatorUserId as number,
        name: u?.name ?? null,
        email: u?.email ?? null,
        count: g._count._all,
      }
    })
    .sort((a, b) => b.count - a.count)

  const conversionCount = conversionRows[0] ? Number(conversionRows[0].converted) : 0

  return {
    cadenceId,
    enrolled,
    byStatus: toRecord(byStatus, 'status'),
    byExitReason: toRecord(byExitReason, 'exitReason'),
    byReplyClass: toRecord(byReplyClass, 'lastReplyClass'),
    byChannel: toRecord(byChannelGroup, 'channel'),
    byOperator,
    stepReach: stepGroups
      .map((g) => ({ step: g.currentStep, count: g._count._all }))
      .sort((a, b) => a.step - b.step),
    conversionRate: enrolled > 0 ? conversionCount / enrolled : 0,
    conversionCount,
  }
}

// ─── Helpers ─────────────────────────────────────────────

function toRecord<K extends string>(
  groups: Array<Record<K, string | null> & { _count: { _all: number } }>,
  field: K,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const g of groups) {
    const key = (g[field] as string | null) ?? 'unknown'
    out[key] = g._count._all
  }
  return out
}
