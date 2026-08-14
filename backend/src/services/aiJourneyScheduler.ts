// src/services/aiJourneyScheduler.ts
//
// Tick da Jornada Automática por IA.
//
// Antes, o único gatilho de análise era `message.received` com debounce de 60s.
// Isso deixava dois buracos:
//   - lead que parou de escrever nunca era reavaliado, então a sugestão dele
//     congelava na tela por semanas;
//   - mensagem que chegava durante o cooldown (ou cujo job falhou) não voltava
//     a ser considerada — a análise simplesmente não acontecia.
//
// O tick cobre os dois, sem virar um varredor caro: ele NÃO reanalisa a base
// inteira periodicamente. Só pega quem tem motivo — mensagem nova ainda não
// analisada, ou sugestão pendente velha o bastante para merecer uma segunda
// opinião — e ainda poda as pendentes que o estado atual do lead já invalidou.

import { Worker, Job } from 'bullmq'
import { prisma } from '../lib/prisma.js'
import { queues, redisConnection } from '../lib/queues.js'
import { pruneStaleSuggestions } from './stageSuggestions.js'

const QUEUE_NAME = 'wf-ai-journey-scheduler'
const TICK_JOB_NAME = 'ai-journey-tick'
const TICK_INTERVAL_MS = 10 * 60_000

/** Teto de análises enfileiradas por tick — segura o custo de IA. */
const MAX_PER_TICK = 20
/** Sugestão pendente sem decisão por mais que isso pede reavaliação. */
const RECHECK_PENDING_HOURS = 48
/** Conversa parada há mais que isso não interessa mais ao pipeline. */
const ACTIVITY_WINDOW_DAYS = 30

let worker: Worker | null = null

/**
 * Leads que merecem uma análise agora. Duas origens, unidas:
 *  (a) tem mensagem posterior à última análise — o debounce perdeu ou o
 *      cooldown barrou na hora, e ninguém mais voltaria a esse lead;
 *  (b) tem sugestão pendente parada há RECHECK_PENDING_HOURS — é o caso que o
 *      usuário enxerga como "a sugestão não atualiza".
 *
 * `$queryRaw` porque a condição (a) compara duas colunas da mesma linha, coisa
 * que o Prisma não expressa no `where`.
 */
async function pickCandidates(): Promise<number[]> {
  // `l.lastMessageAt` precisa estar no SELECT: com DISTINCT, o MySQL recusa
  // ORDER BY por coluna ausente na lista (erro 3065). Como é função de `l.id`,
  // incluí-la não muda a deduplicação.
  const rows = await prisma.$queryRaw<Array<{ id: number; lastMessageAt: Date | null }>>`
    SELECT DISTINCT l.id, l.lastMessageAt
    FROM bychat_leads l
    JOIN bychat_funnels f ON f.id = l.funnelId AND f.aiStageEnabled = 1
    LEFT JOIN bychat_stages st ON st.funnelId = l.funnelId AND st.\`key\` = l.status
    LEFT JOIN bychat_lead_stage_suggestions s
      ON s.leadId = l.id AND s.status = 'pending'
     AND s.createdAt < DATE_SUB(NOW(), INTERVAL ${RECHECK_PENDING_HOURS} HOUR)
    WHERE l.outcome IS NULL
      AND st.terminalKind IS NULL
      AND l.isGroup = 0
      AND l.lastMessageAt IS NOT NULL
      AND l.lastMessageAt >= DATE_SUB(NOW(), INTERVAL ${ACTIVITY_WINDOW_DAYS} DAY)
      AND (
        (l.aiStageAnalyzedAt IS NULL OR l.lastMessageAt > l.aiStageAnalyzedAt)
        OR s.id IS NOT NULL
      )
    ORDER BY l.lastMessageAt DESC
    LIMIT ${MAX_PER_TICK}
  `
  return rows.map(r => r.id)
}

async function processTick(): Promise<void> {
  const pruned = await pruneStaleSuggestions()
  const prunedTotal = Object.values(pruned).reduce((a, b) => a + b, 0)
  if (prunedTotal) {
    const detail = Object.entries(pruned).map(([k, v]) => `${k}=${v}`).join(' ')
    console.log(`[aiJourneyScheduler] ${prunedTotal} sugestão(ões) invalidada(s): ${detail}`)
  }

  const candidates = await pickCandidates()
  if (!candidates.length) return

  // `force` pula o cooldown: quem chegou até aqui já passou pelos filtros de
  // "vale a pena", e sem isso o job seria descartado do outro lado.
  await queues.aiJourney.addBulk(candidates.map(leadId => ({
    name: 'analyze',
    data: { leadId, force: true },
    opts: { attempts: 2, backoff: { type: 'exponential' as const, delay: 30_000 } },
  })))
  console.log(`[aiJourneyScheduler] ${candidates.length} lead(s) enfileirado(s) para reanálise`)
}

export async function startAiJourneyScheduler(): Promise<void> {
  if (worker) return

  worker = new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      if (job.name !== TICK_JOB_NAME) return
      await processTick()
    },
    { connection: redisConnection, concurrency: 1 },
  )

  worker.on('failed', (_job, err) => {
    // `err.message` vem VAZIO em erro do Prisma (a descrição fica no corpo do
    // objeto). Logar só ele deixava "tick falhou:" sem causa nenhuma no log —
    // foi assim que um erro de SQL passou dois ticks despercebido.
    const detail = (err as any)?.message || (err as any)?.meta?.message || String(err)
    console.error('[aiJourneyScheduler] tick falhou:', detail.slice(0, 500))
  })

  await queues.aiJourneyScheduler.add(
    TICK_JOB_NAME,
    {},
    { repeat: { every: TICK_INTERVAL_MS }, removeOnComplete: 50, removeOnFail: 20 },
  )
  console.log(`[aiJourneyScheduler] tick a cada ${TICK_INTERVAL_MS / 60000} min (poda sugestões vencidas + reanalisa parados)`)
}

export async function stopAiJourneyScheduler(): Promise<void> {
  await worker?.close()
  worker = null
}
