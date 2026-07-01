// Plano B do recebimento de Gmail: POLLING periódico (sem Pub/Sub).
// Em vez de o Google empurrar (push) via webhook, nós puxamos a cada N minutos
// chamando o MESMO motor de sincronização (syncGmailChannel → History API desde
// o lastHistoryId). Não depende de tópico Pub/Sub nem de IAM no service account
// do Google, então contorna a política de compartilhamento restrito da organização.

import { prisma } from '../lib/prisma.js'
import { syncGmailChannel } from './gmailInboundSync.js'

const DEFAULT_INTERVAL_MS = 3 * 60 * 1000 // 3 min
const MIN_INTERVAL_MS = 60 * 1000         // piso de segurança (cota Gmail)

let running = false // trava reentrância: evita ticks sobrepostos se o sync demorar

async function resolveIntervalMs(): Promise<number> {
  const fromEnv = parseInt(process.env.GMAIL_POLL_INTERVAL_MS || '', 10)
  if (Number.isFinite(fromEnv) && fromEnv > 0) return Math.max(fromEnv, MIN_INTERVAL_MS)
  const s = await prisma.setting.findUnique({ where: { key: 'gmail.poll_interval_ms' } }).catch(() => null)
  if (s) {
    const v = parseInt(String(s.value).replace(/"/g, '').trim(), 10)
    if (Number.isFinite(v) && v > 0) return Math.max(v, MIN_INTERVAL_MS)
  }
  return DEFAULT_INTERVAL_MS
}

/** Um ciclo: sincroniza todas as caixas com recebimento ligado (syncReplies). */
async function pollTick(): Promise<void> {
  if (running) return
  running = true
  try {
    const configs = await prisma.gmailConfig.findMany({
      where: { active: true, syncReplies: true, connection: { active: true } },
      select: { id: true },
    })
    if (configs.length === 0) return
    let total = 0
    for (const c of configs) {
      try {
        total += await syncGmailChannel(c.id)
      } catch (e) {
        console.error(`[gmailPoll] falha sincronizando config ${c.id}:`, (e as Error).message)
      }
    }
    if (total > 0) console.log(`[gmailPoll] ${total} resposta(s) registrada(s) em ${configs.length} caixa(s)`)
  } finally {
    running = false
  }
}

export function startGmailInboundPoll(): void {
  resolveIntervalMs()
    .then((intervalMs) => {
      console.log(`[gmailPoll] recebimento por polling ativo (a cada ${Math.round(intervalMs / 1000)}s)`)
      // primeiro ciclo logo após o boot, depois em intervalo fixo
      setTimeout(() => { pollTick().catch(() => {}) }, 30_000)
      setInterval(() => { pollTick().catch(() => {}) }, intervalMs)
    })
    .catch((e) => console.error('[gmailPoll] falha ao iniciar:', (e as Error).message))
}
