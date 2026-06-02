// src/services/lossReasonSpike.ts
// Fase 23.1-E: detecção de spike de objeção.
// Cron horário: para cada objeção ativa, compara count(últimas 24h) vs
// média diária dos 30d anteriores. Se exceder threshold (default 50%),
// emite evento `loss_reason.spike` no eventBus (webhooks/Sheets recebem).
// Toggle via setting `alerts.loss_reason_spike` ('true' | 'false', default false).
// Threshold via setting `alerts.loss_reason_spike_pct` (number, default 50).

import { prisma } from '../lib/prisma.js'
import { eventBus } from '../lib/eventBus.js'

const TICK_INTERVAL_MS = 60 * 60_000 // 1h
let timer: NodeJS.Timeout | null = null

async function isEnabled(): Promise<{ enabled: boolean; pct: number }> {
  const [toggleRow, pctRow] = await Promise.all([
    prisma.setting.findUnique({ where: { key: 'alerts.loss_reason_spike' } }),
    prisma.setting.findUnique({ where: { key: 'alerts.loss_reason_spike_pct' } }),
  ])
  const raw = toggleRow ? (typeof toggleRow.value === 'string' ? toggleRow.value : String(toggleRow.value)) : ''
  const enabled = raw.replace(/^"|"$/g, '').trim().toLowerCase() === 'true'
  const pctRaw = pctRow ? (typeof pctRow.value === 'string' ? pctRow.value : String(pctRow.value)) : ''
  const pct = Number(pctRaw.replace(/^"|"$/g, '').trim()) || 50
  return { enabled, pct: Math.max(10, pct) }
}

// Cooldown: não emitir spike da mesma objeção mais de 1x por 24h.
// Usa setting com chave `alerts.loss_reason_last_spike.<reasonId>` (ISO).
async function checkCooldown(reasonId: number): Promise<boolean> {
  const key = `alerts.loss_reason_last_spike.${reasonId}`
  const row = await prisma.setting.findUnique({ where: { key } })
  if (!row) return false
  const raw = typeof row.value === 'string' ? row.value : String(row.value)
  const last = new Date(raw.replace(/^"|"$/g, '').trim())
  if (!Number.isFinite(last.getTime())) return false
  return Date.now() - last.getTime() < 24 * 3_600_000
}

async function markFired(reasonId: number): Promise<void> {
  const key = `alerts.loss_reason_last_spike.${reasonId}`
  await prisma.setting.upsert({
    where: { key },
    create: { key, value: new Date().toISOString(), grp: 'alerts', label: key, fieldType: 'text' },
    update: { value: new Date().toISOString() },
  })
}

async function tick(): Promise<void> {
  try {
    const { enabled, pct } = await isEnabled()
    if (!enabled) return

    const now = new Date()
    const last24h = new Date(now.getTime() - 24 * 3_600_000)
    const baselineFrom = new Date(now.getTime() - 30 * 86_400_000)

    const reasons = await prisma.lossReason.findMany({ where: { active: true }, select: { id: true, name: true } })
    if (reasons.length === 0) return

    for (const r of reasons) {
      const [recent, baseline] = await Promise.all([
        prisma.lead.count({ where: { outcome: 'lost', lostReasonId: r.id, outcomeAt: { gte: last24h } } }),
        prisma.lead.count({ where: { outcome: 'lost', lostReasonId: r.id, outcomeAt: { gte: baselineFrom, lt: last24h } } }),
      ])
      // Baseline insuficiente (<10 ocorrências em 30d) = ignora pra evitar ruído.
      if (baseline < 10) continue
      const dailyAvg = baseline / 29
      if (dailyAvg < 0.5) continue
      const change = ((recent - dailyAvg) / dailyAvg) * 100
      if (change < pct) continue
      if (await checkCooldown(r.id)) continue

      eventBus.emitDomain({
        type: 'loss_reason.spike',
        leadId: 0, // evento de sistema, não vinculado a um lead
        payload: {
          reasonId: r.id,
          reasonName: r.name,
          recentCount: recent,
          baselineDailyAvg: Math.round(dailyAvg * 10) / 10,
          changePct: Math.round(change),
          windowHours: 24,
        },
        timestamp: now,
      })
      await markFired(r.id)
      console.log(`[lossReasonSpike] objeção "${r.name}" disparou alerta: ${recent} em 24h (média 30d=${dailyAvg.toFixed(1)}/dia, +${Math.round(change)}%)`)
    }
  } catch (err) {
    console.error('[lossReasonSpike] tick falhou:', err)
  }
}

export function startLossReasonSpikeWatcher(): void {
  if (timer) return
  // Roda primeira verificação após 5min do boot (evita spike no startup).
  setTimeout(() => { tick().catch(() => {}) }, 5 * 60_000)
  timer = setInterval(() => { tick().catch(() => {}) }, TICK_INTERVAL_MS)
  console.log(`[lossReasonSpike] watcher iniciado (a cada ${TICK_INTERVAL_MS / 60_000}min)`)
}

export function stopLossReasonSpikeWatcher(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
