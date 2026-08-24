// src/services/smartBroadcast/precheck.ts
//
// "Esse número existe no WhatsApp?" — perguntado ANTES de gastar um envio.
//
// Mandar mensagem para número que não tem WhatsApp é um dos comportamentos mais
// característicos de lista comprada, e o custo de descobrir isso enviando é alto:
// cada tentativa conta contra o número remetente. A consulta é barata, o
// resultado muda pouco, então guardamos em cache por 45 dias.
//
// A consulta sai pela própria instância que vai enviar — é a mesma sessão que
// faria a busca se um humano abrisse a conversa.

import { prisma } from '../../lib/prisma.js'
import { phoneKey } from '../../lib/phone.js'
import { createEvolutionProviderFor } from '../whatsappProvider.js'

const CACHE_TTL_MS = 45 * 24 * 3600_000
const BATCH = 50

export interface CheckResult {
  /** phoneKey → existe no WhatsApp */
  map: Map<string, boolean>
  checked: number
  fromCache: number
}

/**
 * Verifica uma lista de telefones. Números já vistos recentemente saem do cache;
 * o resto vai em lotes para a Evolution.
 *
 * Falha da API NÃO condena o número: se não deu para verificar, o destinatário
 * segue no plano (assumir "não existe" por causa de um timeout apagaria a
 * campanha inteira por um problema de infraestrutura).
 */
export async function checkNumbers(instanceName: string, phones: string[]): Promise<CheckResult> {
  const map = new Map<string, boolean>()
  const keys = [...new Set(phones.map((p) => phoneKey(p)).filter((k): k is string => !!k))]
  if (!keys.length) return { map, checked: 0, fromCache: 0 }

  const since = new Date(Date.now() - CACHE_TTL_MS)
  const cached = await prisma.smartNumberCheck.findMany({
    where: { phoneKey: { in: keys }, checkedAt: { gte: since } },
    select: { phoneKey: true, exists: true },
  })
  for (const c of cached) map.set(c.phoneKey, c.exists)

  const pending = keys.filter((k) => !map.has(k))
  if (!pending.length) return { map, checked: 0, fromCache: cached.length }

  const provider = createEvolutionProviderFor(instanceName)
  let checked = 0
  for (let i = 0; i < pending.length; i += BATCH) {
    const chunk = pending.slice(i, i + BATCH)
    try {
      const results = await provider.checkNumbers(chunk)
      for (const r of results) {
        const key = phoneKey(r.number)
        if (!key) continue
        // Contato que a instância conhece pelo nome, mas que a consulta diz não
        // existir, é conta em modo @lid — o telefone deixou de ser o
        // identificador que `onWhatsApp` resolve. Sem veredito, segue no plano:
        // mesmo tratamento da falha de API (ver cabeçalho).
        if (!r.exists && r.name) {
          console.warn(`[smartBroadcast] ${key}: consulta diz que não existe, mas o contato é conhecido ("${r.name}") — tratado como inconclusivo`)
          continue
        }
        map.set(key, r.exists)
        checked++
        await prisma.smartNumberCheck.upsert({
          where: { phoneKey: key },
          create: { phoneKey: key, exists: r.exists, jid: r.jid },
          update: { exists: r.exists, jid: r.jid, checkedAt: new Date() },
        }).catch(() => {})
      }
      // Consulta em rajada também é padrão de robô: respira entre os lotes.
      await new Promise((r) => setTimeout(r, 1_200 + Math.random() * 1_800))
    } catch (err: any) {
      console.warn(`[smartBroadcast] checagem de números falhou (lote ${i / BATCH + 1}): ${err?.message ?? err}`)
      // Sem veredito → segue no plano. Ver comentário do cabeçalho.
    }
  }

  return { map, checked, fromCache: cached.length }
}
