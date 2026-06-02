// src/routes/funnelConversion.ts
//
// Relatório de conversão visual do funil — taxa entre etapas, tempo médio
// de permanência, identificação de gargalos. Agrega de `LeadStageMovement`
// (já existente, populado por todas as fontes de movimentação).

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { adminOnly } from '../lib/auth.js'

function parseDateRange(q: any): { from: Date; to: Date; fromStr: string; toStr: string } {
  const today = new Date()
  const dEnd = q?.dateTo ? new Date(q.dateTo) : today
  const dStart = q?.dateFrom ? new Date(q.dateFrom) : new Date(today.getTime() - 29 * 24 * 60 * 60 * 1000)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return {
    from: new Date(`${fmt(dStart)}T00:00:00.000Z`),
    to: new Date(`${fmt(dEnd)}T23:59:59.999Z`),
    fromStr: fmt(dStart),
    toStr: fmt(dEnd),
  }
}

export async function funnelConversionRoutes(app: FastifyInstance) {

  // GET /api/admin/funnels/:id/conversion-report
  //   ?dateFrom&dateTo&source (opt: 'meta_lead_ads' | 'manual' | ...)
  //
  // Retorna:
  //   - stages: lista ordenada com leadsEnteredCount + currentCount + avgTimeInStageSec
  //   - conversions: pares consecutivos com count + rate% + bottleneck flag (rate < 50% do maior)
  //   - sources: distribuição de leads por source (origem) no período
  app.get('/api/admin/funnels/:id/conversion-report', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const funnelId = parseInt(id)
    if (!funnelId) return reply.code(400).send({ error: 'funnelId inválido' })

    const q = req.query as any
    const { from, to, fromStr, toStr } = parseDateRange(q)
    const sourceFilter: string | undefined = typeof q?.source === 'string' && q.source ? q.source : undefined

    const funnel = await prisma.funnel.findUnique({
      where: { id: funnelId },
      include: { stages: { where: { active: true }, orderBy: { position: 'asc' } } },
    })
    if (!funnel) return reply.code(404).send({ error: 'Funil não encontrado' })

    const stageKeys = funnel.stages.map(s => s.key)
    const positionByKey = new Map(funnel.stages.map(s => [s.key, s.position]))

    // Pega movimentações no período DENTRO deste funil
    const movWhere: any = {
      movedAt: { gte: from, lte: to },
      OR: [
        { toFunnelId: funnelId },
        { fromFunnelId: funnelId },
      ],
    }
    if (sourceFilter) movWhere.source = sourceFilter
    const movements = await prisma.leadStageMovement.findMany({
      where: movWhere,
      orderBy: { movedAt: 'asc' },
      select: { leadId: true, fromStageKey: true, toStageKey: true, movedAt: true, source: true },
    })

    // Leads que estão atualmente em cada etapa (snapshot final)
    const leadsByCurrent = await prisma.lead.groupBy({
      by: ['status'],
      where: {
        funnelId,
        status: { in: stageKeys as any },
      },
      _count: { _all: true },
    })
    const currentByStage = new Map<string, number>()
    for (const r of leadsByCurrent) {
      if (r.status) currentByStage.set(r.status, r._count._all)
    }

    // Contagem de "entradas" (movimentações TO X) por etapa
    const entriesByStage = new Map<string, number>()
    for (const m of movements) {
      if (m.toStageKey) entriesByStage.set(m.toStageKey, (entriesByStage.get(m.toStageKey) ?? 0) + 1)
    }

    // Tempo médio em cada etapa: para cada lead, ordena movimentações e
    // soma (saída - entrada) por stage; ao final faz média.
    interface StageTimeAcc { totalSec: number; samples: number }
    const stageTime = new Map<string, StageTimeAcc>()
    const byLead = new Map<number, typeof movements>()
    for (const m of movements) {
      const arr = byLead.get(m.leadId) ?? []
      arr.push(m)
      byLead.set(m.leadId, arr)
    }
    for (const [_, lst] of byLead) {
      // Já está em ordem ascendente
      for (let i = 0; i < lst.length - 1; i++) {
        const a = lst[i]
        const b = lst[i + 1]
        if (!a.toStageKey) continue
        const dt = Math.max(0, Math.floor((b.movedAt.getTime() - a.movedAt.getTime()) / 1000))
        const cur = stageTime.get(a.toStageKey) ?? { totalSec: 0, samples: 0 }
        cur.totalSec += dt
        cur.samples++
        stageTime.set(a.toStageKey, cur)
      }
    }

    const stagesOut = funnel.stages.map(s => {
      const t = stageTime.get(s.key)
      return {
        key: s.key,
        name: s.name,
        color: s.color,
        position: s.position,
        terminalKind: s.terminalKind,
        entriesInPeriod: entriesByStage.get(s.key) ?? 0,
        currentCount: currentByStage.get(s.key) ?? 0,
        avgTimeInStageSec: t && t.samples > 0 ? Math.round(t.totalSec / t.samples) : null,
        samples: t?.samples ?? 0,
      }
    })

    // Conversions: para cada par consecutivo (i → i+1), quantos leads passaram de A para B
    // no período. Conta movimentações com fromStageKey == A e toStageKey == B (qualquer
    // fonte). Taxa = (count entre par) / (entradas em A no período), 0..1.
    interface ConvPair { fromKey: string; toKey: string; fromName: string; toName: string; count: number; rate: number; bottleneck: boolean }
    const pairs: ConvPair[] = []
    for (let i = 0; i < funnel.stages.length - 1; i++) {
      const a = funnel.stages[i]
      const b = funnel.stages[i + 1]
      const transitions = movements.filter(m => m.fromStageKey === a.key && m.toStageKey === b.key).length
      const denom = stagesOut[i].entriesInPeriod || currentByStage.get(a.key) || 0
      const rate = denom > 0 ? transitions / denom : 0
      pairs.push({
        fromKey: a.key,
        toKey: b.key,
        fromName: a.name,
        toName: b.name,
        count: transitions,
        rate,
        bottleneck: false,
      })
    }
    // Marca gargalo: pair com taxa < 50% da maior taxa entre pares (e ao menos 5 entradas).
    const maxRate = Math.max(0, ...pairs.map(p => p.rate))
    for (const p of pairs) {
      const denomEnoughs = stagesOut.find(s => s.key === p.fromKey)?.entriesInPeriod ?? 0
      if (denomEnoughs >= 5 && maxRate > 0 && p.rate < maxRate * 0.5) p.bottleneck = true
    }

    // Sources (origens) no período — útil pra entender de onde vem os leads do funil
    const sources = await prisma.lead.groupBy({
      by: ['source'],
      where: { funnelId, createdAt: { gte: from, lte: to } },
      _count: { _all: true },
    })

    // KPIs gerais
    const leadsEntered = movements.filter(m => m.fromStageKey === null || m.fromFunnelId !== funnelId).length
    const wonStage = funnel.stages.find(s => s.terminalKind === 'won')
    const lostStage = funnel.stages.find(s => s.terminalKind === 'lost')
    const wonCount = wonStage ? entriesByStage.get(wonStage.key) ?? 0 : 0
    const lostCount = lostStage ? entriesByStage.get(lostStage.key) ?? 0 : 0
    const totalEnteredFunnel = await prisma.lead.count({ where: { funnelId, createdAt: { gte: from, lte: to } } })
    const conversionRate = totalEnteredFunnel > 0 ? wonCount / totalEnteredFunnel : 0

    return {
      funnel: { id: funnel.id, name: funnel.name },
      range: { from: fromStr, to: toStr },
      stages: stagesOut,
      conversions: pairs,
      kpis: {
        totalEntered: totalEnteredFunnel,
        wonCount,
        lostCount,
        conversionRate, // 0..1
        bottleneckCount: pairs.filter(p => p.bottleneck).length,
      },
      sources: sources.map(s => ({ source: s.source || 'desconhecido', count: s._count._all })).sort((a, b) => b.count - a.count),
      _meta: { movementsAnalyzed: movements.length, leadsTracked: byLead.size },
    }
  })
}
