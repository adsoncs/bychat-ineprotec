// src/services/smartBroadcast/preferredTime.ts
//
// Em que horário CADA contato costuma responder.
//
// A agenda padrão distribui os destinatários na ordem em que entraram na lista —
// o que é arbitrário. Se o histórico mostra que uma pessoa só responde de manhã
// e outra só depois das 18h, mandar para as duas às 10h desperdiça metade dos
// envios. Aqui se olha o histórico de mensagens RECEBIDAS de cada lead e se
// extrai a faixa de horário em que ela realmente fala.
//
// Não é previsão sofisticada: é a hora mais frequente das respostas passadas,
// exigindo um mínimo de mensagens para não confiar em coincidência. Quem não tem
// histórico fica neutro e não é reordenado.

import { prisma } from '../../lib/prisma.js'

/** Mensagens recebidas mínimas para acreditar no padrão. */
const MIN_MESSAGES = 3
const LOOKBACK_MS = 180 * 24 * 3600_000
const TZ = 'America/Sao_Paulo'

function hourIn(date: Date, timeZone: string): number {
  const s = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', hour12: false }).format(date)
  const h = Number(s)
  return Number.isFinite(h) ? (h === 24 ? 0 : h) : 12
}

/**
 * Hora preferida (0-23) por lead. Ausente quando não há histórico suficiente —
 * o chamador deve tratar como "tanto faz", não como meia-noite.
 */
export async function preferredHours(leadIds: number[], timeZone = TZ): Promise<Map<number, number>> {
  const out = new Map<number, number>()
  const ids = [...new Set(leadIds.filter((n): n is number => typeof n === 'number'))]
  if (!ids.length) return out

  const since = new Date(Date.now() - LOOKBACK_MS)
  const buckets = new Map<number, number[]>()

  for (let i = 0; i < ids.length; i += 500) {
    const msgs = await prisma.message.findMany({
      where: { leadId: { in: ids.slice(i, i + 500) }, fromMe: false, isInternal: false, timestamp: { gte: since } },
      select: { leadId: true, timestamp: true },
      take: 30_000,
    })
    for (const m of msgs) {
      const arr = buckets.get(m.leadId) ?? []
      arr.push(hourIn(m.timestamp, timeZone))
      buckets.set(m.leadId, arr)
    }
  }

  for (const [leadId, hours] of buckets) {
    if (hours.length < MIN_MESSAGES) continue
    // Faixa de 3 horas mais movimentada — hora cheia isolada é ruído.
    const counts = new Array(24).fill(0)
    for (const h of hours) counts[h]++
    let bestHour = 12
    let bestSum = -1
    for (let h = 0; h < 24; h++) {
      const sum = counts[h] + counts[(h + 1) % 24] + counts[(h + 23) % 24]
      if (sum > bestSum) { bestSum = sum; bestHour = h }
    }
    out.set(leadId, bestHour)
  }

  return out
}

/**
 * Reordena os destinatários para casar com uma agenda cronológica: quem responde
 * cedo recebe os primeiros horários do dia, quem responde tarde recebe os
 * últimos. Sem preferência = meio-dia, que cai no meio da fila.
 */
export function orderByPreferredHour<T extends { recipientId: number }>(
  list: T[],
  leadIdByRecipient: Map<number, number | null>,
  hours: Map<number, number>,
): T[] {
  if (!hours.size) return list
  return [...list].sort((a, b) => {
    const la = leadIdByRecipient.get(a.recipientId)
    const lb = leadIdByRecipient.get(b.recipientId)
    const ha = (la != null ? hours.get(la) : undefined) ?? 12
    const hb = (lb != null ? hours.get(lb) : undefined) ?? 12
    if (ha !== hb) return ha - hb
    return a.recipientId - b.recipientId
  })
}
