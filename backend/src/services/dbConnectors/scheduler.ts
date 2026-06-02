// Scheduler do conector de BD externo. Tick a cada 60s varre conectores
// ativos e dispara runConnector quando (now - lastRunAt) >= intervalMinutes.
//
// Concorrência 1 para evitar 2 ticks simultâneos. Mesmo padrão de
// cadenceScheduler — sem cron externo, só BullMQ repeat.

import { Worker, Job } from 'bullmq'
import { prisma } from '../../lib/prisma.js'
import { queues, redisConnection } from '../../lib/queues.js'
import { bullmqJobsTotal, captureException } from '../../lib/observability.js'
import { runConnector } from './runner.js'

const QUEUE_NAME = 'wf-db-connector'
const TICK_JOB_NAME = 'tick'
const TICK_INTERVAL_MS = 60_000
const MAX_CONNECTORS_PER_TICK = 50

let worker: Worker | null = null

export async function startDbConnectorScheduler(): Promise<void> {
  if (worker) return

  worker = new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      if (job.name !== TICK_JOB_NAME) return
      await processTick()
    },
    { connection: redisConnection, concurrency: 1 },
  )

  worker.on('failed', (job, err) => {
    console.error('[dbConnectorScheduler] tick falhou:', err.message)
    bullmqJobsTotal.inc({ queue: QUEUE_NAME, status: 'failed' })
    captureException(err, { queue: QUEUE_NAME, jobId: job?.id })
  })
  worker.on('completed', () => {
    bullmqJobsTotal.inc({ queue: QUEUE_NAME, status: 'completed' })
  })

  await queues.dbConnector.add(
    TICK_JOB_NAME,
    {},
    {
      repeat: { every: TICK_INTERVAL_MS },
      jobId: 'db-connector-tick',
      removeOnComplete: true,
      removeOnFail: true,
    },
  )
  console.log('[dbConnectorScheduler] iniciado (tick 60s)')
}

async function processTick(): Promise<void> {
  const now = new Date()
  // Carrega ativos. Filtra em memória pq SQL com expressão (lastRunAt + interval) é chato.
  const connectors = await prisma.dbConnector.findMany({
    where: { active: true, lastRunStatus: { not: 'running' } },
    select: { id: true, intervalMinutes: true, lastRunAt: true },
    take: MAX_CONNECTORS_PER_TICK,
  })
  for (const c of connectors) {
    const due = !c.lastRunAt || (now.getTime() - c.lastRunAt.getTime()) >= c.intervalMinutes * 60_000
    if (!due) continue
    try {
      const r = await runConnector(c.id, { triggeredBy: 'cron' })
      if (r.leadsCreated > 0 || r.errors > 0) {
        console.log(`[dbConnectorScheduler] connector ${c.id}: ${r.leadsCreated} criados, ${r.leadsSkipped} skip, ${r.errors} err`)
      }
    } catch (err: any) {
      console.error(`[dbConnectorScheduler] connector ${c.id} falhou:`, err?.message)
    }
  }
}
