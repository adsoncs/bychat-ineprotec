// src/services/smartBroadcast/senderPool.ts
//
// Quem fala com quem. A campanha declara um POOL de números; aqui se decide qual
// deles atende cada destinatário.
//
// A regra mais importante é a AFINIDADE: se este contato já trocou mensagem com
// um dos números do pool, é esse número que fala com ele de novo. Isso não é
// detalhe de engenharia — é o que separa "continuar uma conversa" de "abordagem
// fria de um desconhecido". Para o destinatário, a conversa tem histórico; para
// o WhatsApp, é um par que já conversou antes; e para o operador, a resposta cai
// no mesmo lugar de sempre.
//
// O que sobra (contato novo) é dividido entre os números por RODÍZIO PONDERADO
// pelo score de saúde: número com entrega boa e resposta recebe mais, número
// com falhas recebe menos, número bloqueado não recebe nada.

import { prisma } from '../../lib/prisma.js'
import { getOrCreateHealth, isAvailable, type SenderHealth } from './health.js'

export interface PoolEntry {
  instanceId: number
  instanceName: string
  health: SenderHealth
}

/**
 * Números do pool que estão de fato aptos: ativos no cadastro, não bloqueados,
 * não em pausa do disjuntor e com teto diário sobrando.
 */
export async function resolvePool(senderInstances: unknown): Promise<PoolEntry[]> {
  const declared = Array.isArray(senderInstances) ? (senderInstances as any[]) : []
  const names = declared.map((s) => String(s?.instanceName ?? '')).filter(Boolean)
  if (!names.length) return []

  const instances = await prisma.whatsAppInstance.findMany({
    where: { instanceName: { in: names }, active: true },
    select: { id: true, instanceName: true },
  })

  const out: PoolEntry[] = []
  for (const inst of instances) {
    const health = await getOrCreateHealth(inst.id, inst.instanceName)
    out.push({ instanceId: inst.id, instanceName: inst.instanceName, health })
  }
  return out
}

export function availableSenders(pool: PoolEntry[], now: Date = new Date()): PoolEntry[] {
  return pool.filter((p) => isAvailable(p.health, now))
}

/**
 * Mapa leadId → número do pool com que o lead JÁ conversou (o mais recente).
 * Só olha mensagens da Evolution: conversa que veio pela Cloud API não cria
 * afinidade com nenhum chip.
 */
export async function affinityMap(leadIds: number[], poolNames: string[]): Promise<Map<number, string>> {
  const out = new Map<number, string>()
  if (!leadIds.length || !poolNames.length) return out
  const msgs = await prisma.message.findMany({
    where: {
      leadId: { in: leadIds },
      provider: 'evolution',
      evolutionInstance: { in: poolNames },
      isInternal: false,
    },
    select: { leadId: true, evolutionInstance: true },
    orderBy: { timestamp: 'desc' },
    take: 20_000,
  })
  for (const m of msgs) {
    if (!m.evolutionInstance) continue
    if (!out.has(m.leadId)) out.set(m.leadId, m.evolutionInstance)
  }
  return out
}

export interface Assignment {
  recipientId: number
  instanceId: number
  instanceName: string
  /** true quando veio de conversa anterior (usado no relatório da simulação). */
  byAffinity: boolean
}

/**
 * Distribui os destinatários entre os números do pool.
 *
 * 1º passe: afinidade — quem já conversou fica com o mesmo número.
 * 2º passe: o restante entra num rodízio ponderado por score (roleta), que
 *           empurra o volume para os números mais saudáveis sem nunca zerar os
 *           outros — concentrar tudo no melhor número seria a melhor forma de
 *           queimá-lo também.
 */
export async function distribute(
  recipients: Array<{ id: number; leadId: number | null }>,
  pool: PoolEntry[],
): Promise<Assignment[]> {
  if (!pool.length) return []

  const poolNames = pool.map((p) => p.instanceName)
  const byName = new Map(pool.map((p) => [p.instanceName, p]))
  const leadIds = recipients.map((r) => r.leadId).filter((id): id is number => typeof id === 'number')
  const affinity = await affinityMap(leadIds, poolNames)

  // Pesos: score + piso 5 para nenhum número ficar de fora do sorteio.
  const weights = pool.map((p) => Math.max(5, p.health.score))
  const totalWeight = weights.reduce((a, b) => a + b, 0)

  function roulette(): PoolEntry {
    let r = Math.random() * totalWeight
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i] ?? 0
      if (r <= 0) return pool[i]!
    }
    return pool[pool.length - 1]!
  }

  const out: Assignment[] = []
  for (const rec of recipients) {
    const preferred = rec.leadId != null ? affinity.get(rec.leadId) : undefined
    const entry = (preferred && byName.get(preferred)) || roulette()
    out.push({
      recipientId: rec.id,
      instanceId: entry.instanceId,
      instanceName: entry.instanceName,
      byAffinity: !!(preferred && byName.has(preferred)),
    })
  }
  return out
}
