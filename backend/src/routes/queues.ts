// src/routes/queues.ts
// Monitoramento de filas BullMQ — todas as 11 filas + envios + stats agregados

import { FastifyInstance } from 'fastify'
import { adminOnly } from '../lib/auth.js'
import { queues } from '../lib/queues.js'
import { prisma } from '../lib/prisma.js'

// Mapa de TODAS as filas existentes (era 5; agora 11). SMS estava sem expor.
const QUEUE_MAP: Record<string, any> = {
  whatsapp: queues.whatsapp,
  email: queues.email,
  sms: queues.sms,
  webhook: queues.webhook,
  'internal-task': queues.internalTask,
  'workflow-step': queues.workflowStep,
  enrichment: queues.enrichment,
  'document-review': queues.documentReview,
  'essay-correction': queues.essayCorrection,
  'cadence-scheduler': queues.cadenceScheduler,
  'priority-score': queues.priorityScore,
}

// Canais "communication" — geram OutboundSend
const COMMUNICATION_CHANNELS = ['whatsapp', 'email', 'sms', 'webhook']

export async function queueRoutes(app: FastifyInstance) {

  // GET /api/admin/queues — Stats de todas as filas + estado paused
  app.get('/api/admin/queues', { preHandler: adminOnly }, async () => {
    const stats = []
    for (const [name, queue] of Object.entries(QUEUE_MAP)) {
      const [waiting, active, completed, failed, delayed, paused] = await Promise.all([
        queue.getWaitingCount(),
        queue.getActiveCount(),
        queue.getCompletedCount(),
        queue.getFailedCount(),
        queue.getDelayedCount(),
        queue.isPaused(),
      ])
      stats.push({
        name, waiting, active, completed, failed, delayed, paused,
        isCommunication: COMMUNICATION_CHANNELS.includes(name),
      })
    }
    return { queues: stats }
  })

  // GET /api/admin/queues/stats — Stats agregados últimas 24h por canal
  app.get('/api/admin/queues/stats', { preHandler: adminOnly }, async (req) => {
    const q = req.query as any
    const hours = Math.min(parseInt(q.hours) || 24, 24 * 30)
    const since = new Date(Date.now() - hours * 3600_000)

    const sends = await prisma.$queryRaw<any[]>`
      SELECT
        channel,
        status,
        COUNT(*) as total,
        AVG(latencyMs) as avgLatencyMs
      FROM bychat_outbound_sends
      WHERE createdAt >= ${since}
      GROUP BY channel, status
    `

    // Top 5 erros por canal
    const errors = await prisma.$queryRaw<any[]>`
      SELECT channel, error, COUNT(*) as total
      FROM bychat_outbound_sends
      WHERE createdAt >= ${since} AND status = 'failed' AND error IS NOT NULL
      GROUP BY channel, error
      ORDER BY total DESC
      LIMIT 20
    `

    // Mini timeseries hour-by-hour
    const series = await prisma.$queryRaw<any[]>`
      SELECT
        DATE_FORMAT(createdAt, '%Y-%m-%d %H:00:00') as bucket,
        channel,
        status,
        COUNT(*) as total
      FROM bychat_outbound_sends
      WHERE createdAt >= ${since}
      GROUP BY bucket, channel, status
      ORDER BY bucket ASC
    `

    // Reorganizar: { channel: { sent, delivered, failed, queued, processing, avgLatencyMs } }
    const byChannel: Record<string, any> = {}
    for (const ch of COMMUNICATION_CHANNELS) {
      byChannel[ch] = { sent: 0, delivered: 0, read: 0, failed: 0, queued: 0, processing: 0, total: 0, avgLatencyMs: null }
    }
    for (const r of sends) {
      const ch = byChannel[r.channel] ?? (byChannel[r.channel] = { sent: 0, delivered: 0, read: 0, failed: 0, queued: 0, processing: 0, total: 0, avgLatencyMs: null })
      const total = Number(r.total)
      ch[r.status] = (ch[r.status] || 0) + total
      ch.total += total
      if (r.avgLatencyMs != null && (ch.avgLatencyMs == null || r.status === 'sent' || r.status === 'delivered')) {
        ch.avgLatencyMs = Math.round(Number(r.avgLatencyMs))
      }
    }

    return {
      since: since.toISOString(),
      hours,
      byChannel,
      topErrors: errors.map(e => ({ channel: e.channel, error: e.error, total: Number(e.total) })),
      series: series.map(s => ({
        bucket: s.bucket instanceof Date ? s.bucket.toISOString() : String(s.bucket),
        channel: s.channel,
        status: s.status,
        total: Number(s.total),
      })),
    }
  })

  // GET /api/admin/queues/sends — Lista de envios persistidos (OutboundSend)
  app.get('/api/admin/queues/sends', { preHandler: adminOnly }, async (req) => {
    const q = req.query as any
    const channel = q.channel || undefined
    const status = q.status || undefined
    const leadId = q.leadId ? parseInt(q.leadId) : undefined
    const search = q.search || undefined
    const limit = Math.min(parseInt(q.limit) || 50, 200)
    const offset = parseInt(q.offset) || 0
    const sinceHours = parseInt(q.sinceHours) || 168 // default 7d

    const where: any = {
      createdAt: { gte: new Date(Date.now() - sinceHours * 3600_000) },
    }
    if (channel) where.channel = channel
    if (status) where.status = status
    if (leadId) where.leadId = leadId
    if (search) {
      where.OR = [
        { recipient: { contains: search } },
        { error: { contains: search } },
      ]
    }

    const [sends, total] = await Promise.all([
      prisma.outboundSend.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: {
          lead: { select: { id: true, nome: true, empresa: true, whatsapp: true, email: true } },
        },
      }),
      prisma.outboundSend.count({ where }),
    ])

    return { sends, total, limit, offset }
  })

  // GET /api/admin/queues/sends/:id — Detalhe completo de um envio
  app.get('/api/admin/queues/sends/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const send = await prisma.outboundSend.findUnique({
      where: { id: parseInt(id) },
      include: {
        lead: { select: { id: true, nome: true, empresa: true, whatsapp: true, email: true } },
      },
    })
    if (!send) return reply.code(404).send({ error: 'Envio não encontrado' })
    return { send }
  })

  // GET /api/admin/queues/:name/jobs — Jobs de uma fila (BullMQ direto)
  app.get('/api/admin/queues/:name/jobs', { preHandler: adminOnly }, async (req, reply) => {
    const { name } = req.params as any
    const { status = 'failed', limit = '20', offset = '0' } = req.query as any
    const queue = QUEUE_MAP[name]
    if (!queue) return reply.code(404).send({ error: 'Fila não encontrada' })

    const start = parseInt(offset)
    const end = start + parseInt(limit) - 1

    let jobs: any[]
    switch (status) {
      case 'waiting': jobs = await queue.getWaiting(start, end); break
      case 'active': jobs = await queue.getActive(start, end); break
      case 'completed': jobs = await queue.getCompleted(start, end); break
      case 'failed': jobs = await queue.getFailed(start, end); break
      case 'delayed': jobs = await queue.getDelayed(start, end); break
      default: jobs = await queue.getFailed(start, end)
    }

    return {
      jobs: jobs.map(j => ({
        id: j.id,
        name: j.name,
        data: j.data,
        status: j.failedReason ? 'failed' : status,
        attempts: j.attemptsMade,
        maxAttempts: j.opts?.attempts,
        failedReason: j.failedReason,
        processedOn: j.processedOn,
        finishedOn: j.finishedOn,
        delay: j.delay,
        timestamp: j.timestamp,
      }))
    }
  })

  // GET /api/admin/queues/:name/jobs/:id — Detalhe completo de 1 job
  app.get('/api/admin/queues/:name/jobs/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { name, id } = req.params as any
    const queue = QUEUE_MAP[name]
    if (!queue) return reply.code(404).send({ error: 'Fila não encontrada' })
    const job = await queue.getJob(id)
    if (!job) return reply.code(404).send({ error: 'Job não encontrado' })

    return {
      job: {
        id: job.id,
        name: job.name,
        data: job.data,
        opts: job.opts,
        progress: job.progress,
        attempts: job.attemptsMade,
        maxAttempts: job.opts?.attempts,
        returnvalue: job.returnvalue,
        failedReason: job.failedReason,
        stacktrace: job.stacktrace,
        processedOn: job.processedOn,
        finishedOn: job.finishedOn,
        delay: job.delay,
        timestamp: job.timestamp,
      },
    }
  })

  // POST /api/admin/queues/:name/jobs/:id/retry — Retry individual
  app.post('/api/admin/queues/:name/jobs/:id/retry', { preHandler: adminOnly }, async (req, reply) => {
    const { name, id } = req.params as any
    const queue = QUEUE_MAP[name]
    if (!queue) return reply.code(404).send({ error: 'Fila não encontrada' })
    const job = await queue.getJob(id)
    if (!job) return reply.code(404).send({ error: 'Job não encontrado' })
    try {
      await job.retry()
      return { ok: true }
    } catch (e: any) {
      return reply.code(400).send({ error: e.message })
    }
  })

  // DELETE /api/admin/queues/:name/jobs/:id — Remover job individual
  app.delete('/api/admin/queues/:name/jobs/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { name, id } = req.params as any
    const queue = QUEUE_MAP[name]
    if (!queue) return reply.code(404).send({ error: 'Fila não encontrada' })
    const job = await queue.getJob(id)
    if (!job) return reply.code(404).send({ error: 'Job não encontrado' })
    await job.remove()
    return { ok: true }
  })

  // POST /api/admin/queues/:name/pause — Pausar fila
  app.post('/api/admin/queues/:name/pause', { preHandler: adminOnly }, async (req, reply) => {
    const { name } = req.params as any
    const queue = QUEUE_MAP[name]
    if (!queue) return reply.code(404).send({ error: 'Fila não encontrada' })
    await queue.pause()
    return { ok: true, paused: true }
  })

  // POST /api/admin/queues/:name/resume — Retomar fila
  app.post('/api/admin/queues/:name/resume', { preHandler: adminOnly }, async (req, reply) => {
    const { name } = req.params as any
    const queue = QUEUE_MAP[name]
    if (!queue) return reply.code(404).send({ error: 'Fila não encontrada' })
    await queue.resume()
    return { ok: true, paused: false }
  })

  // POST /api/admin/queues/:name/retry-all — Retry todos os jobs falhados
  app.post('/api/admin/queues/:name/retry-all', { preHandler: adminOnly }, async (req, reply) => {
    const { name } = req.params as any
    const queue = QUEUE_MAP[name]
    if (!queue) return reply.code(404).send({ error: 'Fila não encontrada' })

    const failed = await queue.getFailed(0, 500)
    let retried = 0
    for (const job of failed) {
      try {
        await job.retry()
        retried++
      } catch { /* skip */ }
    }
    return { retried, total: failed.length }
  })

  // DELETE /api/admin/queues/:name/clean — Limpar jobs
  app.delete('/api/admin/queues/:name/clean', { preHandler: adminOnly }, async (req, reply) => {
    const { name } = req.params as any
    const { status = 'completed', grace = '3600000' } = req.query as any
    const queue = QUEUE_MAP[name]
    if (!queue) return reply.code(404).send({ error: 'Fila não encontrada' })

    const cleaned = await queue.clean(parseInt(grace), 1000, status)
    return { cleaned: cleaned.length, status }
  })
}
