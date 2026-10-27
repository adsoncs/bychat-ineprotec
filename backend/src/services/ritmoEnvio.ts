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
import { prisma } from '../lib/prisma.js'

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

// ─── Teto diário por linha QR Code ──────────────────────────────────────────
// O ritmo espaça, mas não limita: 300 execuções acordando no mesmo dia ainda
// viram 300 mensagens pela mesma linha. Passou do teto, o envio de fluxo vai
// para o próximo dia permitido (ver wf-whatsapp em workers.ts). Configurável em
// Fluxos › Proteção dos números (setting `workflows.teto_diario_qr`); 0 = sem
// teto. Cloud API fica de fora: a Meta já limita por tier.

export const TETO_PADRAO_QR = 80

/** Teto do dia cheio na linha — quem chamou reagenda o envio. */
export class TetoDiarioCheio extends Error {
  constructor(public linha: string) {
    super(`Teto diário de envios automáticos atingido na linha ${linha}`)
    this.name = 'TetoDiarioCheio'
  }
}
export const CHAVE_TETO = 'workflows.teto_diario_qr'
let tetoCache: { valor: number; ate: number } | null = null

export async function lerTetoDiario(): Promise<number> {
  if (tetoCache && tetoCache.ate > Date.now()) return tetoCache.valor
  const row = await prisma.setting.findUnique({ where: { key: CHAVE_TETO }, select: { value: true } }).catch(() => null)
  const n = row ? Number(String(row.value ?? '').replace(/"/g, '')) : NaN
  const valor = Number.isFinite(n) && n >= 0 ? Math.floor(n) : TETO_PADRAO_QR
  tetoCache = { valor, ate: Date.now() + 60_000 }
  return valor
}

export function invalidarTeto(): void {
  tetoCache = null
}

/** Dia corrente em Brasília (UTC−3), no formato AAAA-MM-DD. */
function diaBrasilia(agora = Date.now()): string {
  return new Date(agora - 3 * 3_600_000).toISOString().slice(0, 10)
}

const chaveTeto = (linha: string) => `teto:wa:${linha}:${diaBrasilia()}`

// Ocupa uma vaga do dia; teto cheio devolve 0 sem ocupar.
const CONSUMIR = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], 172800) end
if n > tonumber(ARGV[1]) then redis.call('DECR', KEYS[1]) return 0 end
return 1
`

/** Ocupa uma vaga do teto de hoje na linha. false = teto cheio. Redis fora = libera. */
export async function consumirTeto(linha: string, providerName: ProviderName): Promise<boolean> {
  if (providerName !== 'evolution') return true
  const teto = await lerTetoDiario()
  if (teto <= 0) return true
  try {
    return Number(await redis.eval(CONSUMIR, 1, chaveTeto(linha), teto)) === 1
  } catch {
    return true
  }
}

/** Envios automáticos de hoje por linha QR (para a tela). */
export async function usoDoDia(instancias: string[]): Promise<Record<string, number>> {
  if (!instancias.length) return {}
  const vals = await redis.mget(...instancias.map((i) => chaveTeto(`evolution:${i}`))).catch(() => [] as (string | null)[])
  return Object.fromEntries(instancias.map((i, k) => [i, Number(vals[k] ?? 0) || 0]))
}

/**
 * Próximo horário para um envio que estourou o teto: amanhã às 08:00 de
 * Brasília, empurrado pela janela de silêncio do lead (fim de semana, por
 * exemplo), mais 0–120 min sorteados para a fila não acordar toda junta.
 */
export async function proximaAbertura(leadId: number, agora = Date.now()): Promise<number> {
  const brt = new Date(agora - 3 * 3_600_000)
  let alvo = Date.UTC(brt.getUTCFullYear(), brt.getUTCMonth(), brt.getUTCDate() + 1, 11, 0, 0)
  try {
    const { canSendNow } = await import('./messageGovernance.js')
    const r = await canSendNow(leadId, 'whatsapp', new Date(alvo))
    if (!r.ok && r.reason === 'silence_window' && r.retryAt) alvo = Math.max(alvo, r.retryAt.getTime())
  } catch { /* governança fora: fica o horário padrão */ }
  return alvo + Math.floor(Math.random() * 120 * 60_000)
}
