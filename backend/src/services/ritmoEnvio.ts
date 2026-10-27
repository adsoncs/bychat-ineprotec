// src/services/ritmoEnvio.ts
// Ritmo dos envios AUTOMÁTICOS por linha de WhatsApp.
//
// Em 27/10 a linha principal do elementus foi derrubada pelo WhatsApp logo
// depois de 29 mensagens de fluxo saírem em 61 s (uma a cada 0,25 s): todas as
// execuções que esperavam o horário comercial acordaram juntas às 09:00. Para
// uma linha QR Code (Evolution/Baileys), rajada de texto parecido para contatos
// frios é exatamente o padrão que o WhatsApp bane.
//
// Cada envio automático reserva a sua vez na linha: a reserva é atômica no
// Redis (script Lua), então dois workers/varreduras nunca pegam a mesma vez, e o
// intervalo é sorteado para não formar um compasso regular. Conversa ativa
// (operador no painel, resposta do chatbot) NÃO passa por aqui.
//
// Redis fora do ar = sem espera (não bloqueia o envio).

import { redis } from '../lib/redis.js'

type ProviderName = 'evolution' | 'cloud_api'

/** Intervalo sorteado entre dois envios automáticos na MESMA linha. */
const INTERVALO_MS: Record<ProviderName, { min: number; max: number }> = {
  evolution: { min: 20_000, max: 45_000 }, // QR Code: o que protege o número
  cloud_api: { min: 1_000, max: 3_000 },   // API oficial: só evita rajada
}

// Devolve quantos ms faltam para a vez reservada e já empurra a próxima vez.
const RESERVAR = `
local agora = tonumber(ARGV[1])
local proxima = tonumber(redis.call('GET', KEYS[1]) or '0')
local vez = math.max(agora, proxima)
local seguinte = vez + tonumber(ARGV[2])
redis.call('SET', KEYS[1], seguinte, 'PX', seguinte - agora + 60000)
return vez - agora
`

/** Chave da linha a partir do provider (`instanceName` / `phoneNumberId`). */
export function linhaDoProvider(provider: { providerName: ProviderName } & Record<string, any>): string | null {
  if (provider.providerName === 'evolution' && provider.instanceName) return `evolution:${provider.instanceName}`
  if (provider.providerName === 'cloud_api' && provider.phoneNumberId) return `cloud_api:${provider.phoneNumberId}`
  return null
}

/** Reserva a próxima vez na linha. Retorna quantos ms esperar até ela (0 = já). */
export async function reservarVez(linha: string, providerName: ProviderName): Promise<number> {
  const { min, max } = INTERVALO_MS[providerName]
  const intervalo = min + Math.floor(Math.random() * (max - min))
  try {
    const ms = Number(await redis.eval(RESERVAR, 1, `ritmo:wa:${linha}`, Date.now(), intervalo))
    return Number.isFinite(ms) && ms > 0 ? ms : 0
  } catch {
    return 0
  }
}

/** Para varreduras em laço: reserva a vez e espera por ela. */
export async function esperarVez(provider: { providerName: ProviderName } & Record<string, any>): Promise<void> {
  const linha = linhaDoProvider(provider)
  if (!linha) return
  const ms = await reservarVez(linha, provider.providerName)
  if (ms > 0) await new Promise((r) => setTimeout(r, ms))
}
