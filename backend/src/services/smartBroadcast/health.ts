// src/services/smartBroadcast/health.ts
//
// Saúde por número (SmartSenderHealth): uma linha por instância por dia.
// É onde vivem o AQUECIMENTO e o TETO DIÁRIO — as duas travas que decidem se um
// chip sobrevive à primeira campanha.
//
// Aquecimento: número recém-conectado que dispara 300 mensagens no primeiro dia
// é o caso clássico de bloqueio em horas. A escada padrão sobe devagar
// (20 → 35 → 50 → 80 → 120 → 180 → 250) e SÓ AVANÇA se o dia anterior teve
// comportamento saudável — se a taxa de resposta despencou ou houve muita falha,
// o degrau congela. Aquecer não é esperar o calendário passar, é acumular
// histórico de conversa que não gerou reclamação.

import { prisma } from '../../lib/prisma.js'

/** Escada padrão de envios/dia por número. */
export const DEFAULT_WARMUP_CURVE = [20, 35, 50, 80, 120, 180, 250]

export type SenderState = 'warming' | 'healthy' | 'throttled' | 'paused' | 'blocked'

/** Meia-noite UTC do dia local — chave de agrupamento das linhas diárias. */
export function dayStart(at: Date = new Date()): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()))
}

export interface SenderHealth {
  id: number
  instanceId: number
  instanceName: string
  sent: number
  delivered: number
  failed: number
  replies: number
  notFound: number
  warmupDay: number
  dailyCap: number
  state: string
  pausedUntil: Date | null
  pauseReason: string | null
  score: number
}

/**
 * Linha de hoje do número, criada na hora se não existir. O warmupDay e o teto
 * são herdados do último dia em que o número trabalhou — e o degrau só sobe se
 * aquele dia foi saudável.
 */
export async function getOrCreateHealth(
  instanceId: number,
  instanceName: string,
  curve: number[] = DEFAULT_WARMUP_CURVE,
): Promise<SenderHealth> {
  const day = dayStart()
  const existing = await prisma.smartSenderHealth.findUnique({
    where: { instanceId_day: { instanceId, day } },
  })
  if (existing) return existing as SenderHealth

  const previous = await prisma.smartSenderHealth.findFirst({
    where: { instanceId, day: { lt: day } },
    orderBy: { day: 'desc' },
  })

  let warmupDay = 1
  let state: SenderState = 'warming'
  if (previous) {
    // Sobe um degrau só se ontem rodou de verdade e sem sinal ruim.
    const workedYesterday = previous.sent >= Math.floor(previous.dailyCap * 0.5)
    const failRate = previous.sent > 0 ? previous.failed / previous.sent : 0
    const replyRate = previous.sent > 0 ? previous.replies / previous.sent : 1
    const healthy = workedYesterday && failRate < 0.1 && (previous.sent < 30 || replyRate >= 0.01)
    warmupDay = healthy ? previous.warmupDay + 1 : previous.warmupDay
    state = previous.state === 'blocked' ? 'blocked' : warmupDay >= curve.length ? 'healthy' : 'warming'
  }

  const dailyCap = curve[Math.min(warmupDay - 1, curve.length - 1)] ?? curve[curve.length - 1] ?? 20

  const created = await prisma.smartSenderHealth.create({
    data: {
      instanceId, instanceName, day,
      warmupDay, dailyCap, state,
      // Bloqueio não expira sozinho: só sai disso com ação humana (novo QR,
      // outro chip). Herdar o motivo evita o número voltar ao rodízio calado.
      pauseReason: previous?.state === 'blocked' ? previous.pauseReason : null,
    },
  })
  return created as SenderHealth
}

/** Quanto este número ainda pode enviar hoje. */
export function remainingToday(h: SenderHealth): number {
  if (h.state === 'blocked' || h.state === 'paused') return 0
  return Math.max(0, h.dailyCap - h.sent)
}

/** Está apto a enviar agora? (respeita pausa temporária do disjuntor) */
export function isAvailable(h: SenderHealth, now: Date = new Date()): boolean {
  if (h.state === 'blocked') return false
  if (h.pausedUntil && h.pausedUntil.getTime() > now.getTime()) return false
  return remainingToday(h) > 0
}

export async function bumpCounters(
  instanceId: number,
  patch: Partial<Record<'sent' | 'delivered' | 'failed' | 'replies' | 'notFound', number>>,
): Promise<void> {
  const day = dayStart()
  const data: Record<string, { increment: number }> = {}
  for (const [k, v] of Object.entries(patch)) if (v) data[k] = { increment: v }
  if (!Object.keys(data).length) return
  await prisma.smartSenderHealth.updateMany({ where: { instanceId, day }, data })
}

/**
 * Recalcula o score (0–100) que pondera o rodízio entre números. Entrega e
 * resposta puxam para cima; falha e número inexistente puxam para baixo.
 */
export async function refreshScore(instanceId: number): Promise<number> {
  const day = dayStart()
  const h = await prisma.smartSenderHealth.findUnique({ where: { instanceId_day: { instanceId, day } } })
  if (!h) return 100
  if (h.state === 'blocked') return 0
  const sent = Math.max(1, h.sent)
  const failRate = h.failed / sent
  const notFoundRate = h.notFound / sent
  const replyRate = h.replies / sent
  let score = 100
  score -= Math.round(failRate * 120)
  score -= Math.round(notFoundRate * 80)
  score += Math.round(Math.min(0.2, replyRate) * 50)
  score = Math.max(0, Math.min(100, score))
  await prisma.smartSenderHealth.update({ where: { id: h.id }, data: { score } })
  return score
}
