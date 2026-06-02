// src/services/kommoWorker.ts
//
// Worker da fila wf-kommo-sync. Processa a importação/sync da Kommo em fases
// encadeadas com self-continuation por página (cada job faz 1 página e enfileira
// a próxima), o que mantém os jobs curtos e resilientes mesmo com +15k registros.
//
// Cadeia: metadata → contacts(1..n) → leads(1..n) → notes(1..n) → tasks(1..n) → done
//
// concurrency=1: só 1 página em voo por vez (preserva ordem das fases e evita
// corrida no KommoMapping). O disparo (manual/cron) começa sempre em 'metadata'.

import { Worker } from 'bullmq'
import { redisConnection, queues } from '../lib/queues.js'
import { getKommoConfig, isKommoConfigured, KommoAuthError } from '../lib/kommoClient.js'
import { resolveDefaultTeamId } from './teamRouting.js'
import * as K from './kommoSync.js'

type Phase = 'metadata' | 'contacts' | 'leads' | 'notes' | 'tasks'
interface JobData { phase: Phase; page?: number; mode?: 'full' | 'incremental'; since?: number; startedAt?: number }

async function enqueue(data: JobData): Promise<void> {
  await queues.kommoSync.add('sync', data, { removeOnComplete: 50, removeOnFail: 50, attempts: 3, backoff: { type: 'exponential', delay: 5000 } })
}

/** Dispara um sync completo (ou incremental). Chamado pelo endpoint e pelo cron. */
export async function triggerKommoSync(mode: 'full' | 'incremental'): Promise<void> {
  const since = mode === 'incremental' ? (await K.getLastSyncAt()) ?? undefined : undefined
  const startedAt = Math.floor(Date.now() / 1000)
  await K.setSyncState({ phase: 'starting', mode, startedAt, running: true })
  await enqueue({ phase: 'metadata', mode, since, startedAt })
}

let worker: Worker | null = null

export function startKommoWorker(): Worker {
  if (worker) return worker
  worker = new Worker(
    'wf-kommo-sync',
    async (job) => {
      const d = job.data as JobData
      const cfg = await getKommoConfig(true)
      if (!isKommoConfigured(cfg)) throw new Error('Kommo não configurado (defina subdomínio e token)')
      const since = d.mode === 'incremental' ? d.since : undefined
      const startedAt = d.startedAt ?? Math.floor(Date.now() / 1000)
      const base = { mode: d.mode, since, startedAt }

      try {
        if (d.phase === 'metadata') {
          const meta = await K.importMetadata(cfg)
          await K.setSyncState({ phase: 'metadata', ...meta, running: true, ...base })
          await enqueue({ phase: 'contacts', page: 1, ...base })
          return meta
        }

        if (d.phase === 'contacts') {
          const page = d.page || 1
          const r = await K.importContactsPage(page, since, cfg)
          await K.setSyncState({ phase: 'contacts', page, processed: r.processed, running: true, ...base })
          await enqueue(r.hasNext ? { phase: 'contacts', page: page + 1, ...base } : { phase: 'leads', page: 1, ...base })
          return r
        }

        if (d.phase === 'leads') {
          const page = d.page || 1
          const defaultTeamId = await resolveDefaultTeamId({}).catch(() => null)
          const r = await K.importLeadsPage(page, defaultTeamId, since, cfg)
          await K.setSyncState({ phase: 'leads', page, processed: r.processed, created: r.created, updated: r.updated, running: true, ...base })
          await enqueue(r.hasNext ? { phase: 'leads', page: page + 1, ...base } : { phase: 'notes', page: 1, ...base })
          return r
        }

        if (d.phase === 'notes') {
          const page = d.page || 1
          const r = await K.importNotesPage(page, since, cfg)
          await K.setSyncState({ phase: 'notes', page, processed: r.processed, created: r.created, running: true, ...base })
          await enqueue(r.hasNext ? { phase: 'notes', page: page + 1, ...base } : { phase: 'tasks', page: 1, ...base })
          return r
        }

        if (d.phase === 'tasks') {
          const page = d.page || 1
          const r = await K.importTasksPage(page, since, cfg)
          await K.setSyncState({ phase: 'tasks', page, processed: r.processed, created: r.created, running: true, ...base })
          if (r.hasNext) {
            await enqueue({ phase: 'tasks', page: page + 1, ...base })
          } else {
            await K.setLastSyncAt(startedAt)
            await K.setSyncState({ phase: 'done', running: false, finishedAt: Math.floor(Date.now() / 1000), startedAt, mode: d.mode })
          }
          return r
        }
      } catch (err: any) {
        if (err instanceof KommoAuthError) {
          await K.setSyncState({ phase: 'error', running: false, error: 'Token Kommo expirado/inválido (401)', at: d.phase, startedAt })
        }
        throw err
      }
    },
    { connection: redisConnection, concurrency: 1, lockDuration: 120_000 },
  )

  worker.on('failed', (job, err) => {
    console.error(`[kommo-sync] job ${job?.id} (${(job?.data as any)?.phase}) falhou:`, err?.message)
  })
  return worker
}

// Cron incremental: a cada CRON_MIN minutos, se a integração estiver ativa e
// não houver sync em andamento, dispara um sync incremental (updated_at >
// last_sync_at). Não roda o full automático — só o delta. O full é manual.
const CRON_MIN = parseInt(process.env.KOMMO_SYNC_INTERVAL_MIN || '15', 10)

export function startKommoCron(): void {
  const tick = async () => {
    try {
      const cfg = await getKommoConfig(true)
      if (!cfg.enabled || !isKommoConfigured(cfg)) return
      const state = await K.getSyncState()
      if (state?.running) return
      // só dispara incremental se já houve um full antes (tem last_sync_at)
      if ((await K.getLastSyncAt()) == null) return
      await triggerKommoSync('incremental')
    } catch (err: any) {
      console.warn('[kommo-cron] tick falhou:', err?.message || err)
    }
  }
  setInterval(tick, CRON_MIN * 60_000)
}
