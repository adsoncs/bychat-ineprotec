// Job recorrente que detecta leads enriquecidos há mais de N dias e enfileira
// um novo enriquecimento. Mantém os dossiês frescos sem ação manual.
//
// Critérios:
//   - lgpdConsent = true
//   - enrichmentStatus em ('done', 'partial')
//   - enrichedAt < (hoje - STALE_DAYS)
//   - lead "ativo": updatedAt > (hoje - ACTIVE_WINDOW_DAYS) — não desperdiça
//     chamadas em leads dormentes que ninguém vai abrir.
//   - SUSPENSO se for fim de semana (rate limit suave).

import { prisma } from '../lib/prisma.js'
import { queues } from '../lib/queues.js'

const TICK_MS = 60 * 60 * 1000 // 1 hora — reavalia a cada hora se há leads para reenriquecer
const STALE_DAYS = Number(process.env.ENRICHMENT_RERUN_STALE_DAYS ?? 30)
const ACTIVE_WINDOW_DAYS = Number(process.env.ENRICHMENT_RERUN_ACTIVE_DAYS ?? 90)
const BATCH_SIZE = Number(process.env.ENRICHMENT_RERUN_BATCH ?? 50)

let _timer: NodeJS.Timeout | null = null

export async function runEnrichmentRerunSweep(): Promise<number> {
  const now = new Date()
  const day = now.getDay()
  // 0 = domingo, 6 = sábado — pula fim de semana para reduzir custo Hunter/Google
  if (day === 0 || day === 6) return 0

  const staleBefore = new Date(now.getTime() - STALE_DAYS * 86_400_000)
  const activeAfter = new Date(now.getTime() - ACTIVE_WINDOW_DAYS * 86_400_000)

  const candidates = await prisma.lead.findMany({
    where: {
      lgpdConsent: true,
      enrichmentStatus: { in: ['done', 'partial'] },
      enrichedAt: { lt: staleBefore },
      updatedAt: { gt: activeAfter },
    },
    orderBy: [{ enrichmentScore: 'desc' }, { enrichedAt: 'asc' }],
    take: BATCH_SIZE,
    select: { id: true },
  })

  if (candidates.length === 0) return 0

  let enqueued = 0
  for (const c of candidates) {
    try {
      await queues.enrichment.add('enrich', { leadId: c.id, maxTier: 3, force: true }, {
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
      })
      enqueued++
    } catch (err) {
      console.error('[enrichment-rerun] falha ao enfileirar leadId=', c.id, err)
    }
  }
  return enqueued
}

export function startEnrichmentRerunJob(): void {
  if (_timer) return
  const tick = async () => {
    try {
      const enqueued = await runEnrichmentRerunSweep()
      if (enqueued > 0) {
        console.log(`[enrichment-rerun] ${enqueued} leads enfileirados para reenriquecimento (stale > ${STALE_DAYS}d)`)
      }
    } catch (err) {
      console.error('[enrichment-rerun] tick falhou:', err)
    }
  }
  // Espera 5 min após boot para não competir com warmup
  setTimeout(() => {
    void tick()
    _timer = setInterval(() => void tick(), TICK_MS)
  }, 5 * 60 * 1000)
}

export function stopEnrichmentRerunJob(): void {
  if (_timer) { clearInterval(_timer); _timer = null }
}
