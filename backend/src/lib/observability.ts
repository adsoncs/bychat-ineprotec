// src/lib/observability.ts
// Error tracking (Sentry/GlitchTip) + Prometheus metrics
// Fase 14.1 - Observabilidade

import * as Sentry from '@sentry/node'
import client from 'prom-client'

const SENTRY_DSN = process.env.SENTRY_DSN || ''
const NODE_ENV = process.env.NODE_ENV || 'development'
const RELEASE = process.env.APP_RELEASE || 'bychat-beyond@dev'

export const register = new client.Registry()
register.setDefaultLabels({ service: 'bychat-beyond' })

let initialized = false

export function initObservability() {
  if (initialized) return
  initialized = true

  if (SENTRY_DSN) {
    Sentry.init({
      dsn: SENTRY_DSN,
      environment: NODE_ENV,
      release: RELEASE,
      tracesSampleRate: NODE_ENV === 'production' ? 0.1 : 1.0,
      sendDefaultPii: false,
      beforeSend(event) {
        const msg = event.exception?.values?.[0]?.value || ''
        if (/rate limit|CSRF|Origem não permitida|não autorizado/i.test(msg)) return null
        return event
      },
    })
    console.log('[observability] Sentry/GlitchTip init OK')
  } else {
    console.log('[observability] SENTRY_DSN não configurado — error tracking desabilitado')
  }

  client.collectDefaultMetrics({ register, prefix: 'bychat_' })
}

// ─── Métricas HTTP ──────────────────────────────────────
export const httpRequestsTotal = new client.Counter({
  name: 'bychat_http_requests_total',
  help: 'Total de requests HTTP',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [register],
})

export const httpRequestDuration = new client.Histogram({
  name: 'bychat_http_request_duration_seconds',
  help: 'Duração de requests HTTP em segundos',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5, 10],
  registers: [register],
})

// ─── Métricas BullMQ ────────────────────────────────────
export const bullmqJobsTotal = new client.Counter({
  name: 'bychat_bullmq_jobs_total',
  help: 'Total de jobs BullMQ processados',
  labelNames: ['queue', 'status'] as const,
  registers: [register],
})

export const bullmqJobDuration = new client.Histogram({
  name: 'bychat_bullmq_job_duration_seconds',
  help: 'Duração de jobs BullMQ em segundos',
  labelNames: ['queue'] as const,
  buckets: [0.1, 0.5, 1, 3, 5, 10, 30, 60, 120],
  registers: [register],
})

// ─── Métricas Workflow Engine ───────────────────────────
export const workflowStepsTotal = new client.Counter({
  name: 'bychat_workflow_steps_total',
  help: 'Total de steps de workflow executados',
  labelNames: ['type', 'status'] as const,
  registers: [register],
})

// ─── Métricas Webhook Dispatcher ────────────────────────
export const webhooksDispatchedTotal = new client.Counter({
  name: 'bychat_webhooks_dispatched_total',
  help: 'Total de webhooks outbound disparados',
  labelNames: ['event', 'status'] as const,
  registers: [register],
})

// ─── Helpers de captura ─────────────────────────────────
export function captureException(err: unknown, ctx?: Record<string, any>) {
  if (!SENTRY_DSN) return
  Sentry.withScope((scope) => {
    if (ctx) {
      for (const [k, v] of Object.entries(ctx)) scope.setExtra(k, v)
    }
    Sentry.captureException(err)
  })
}

export function captureMessage(msg: string, level: 'info' | 'warning' | 'error' = 'info') {
  if (!SENTRY_DSN) return
  Sentry.captureMessage(msg, level)
}

export { Sentry, client }
