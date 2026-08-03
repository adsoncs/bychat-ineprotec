// src/services/smartBroadcast/typing.ts
//
// Simulação de digitação. Antes de cada mensagem o número emite presença
// "composing" por um tempo proporcional ao tamanho do texto, depois "paused", e
// só então envia.
//
// Isso resolve dois problemas de uma vez: do lado do destinatário a conversa
// deixa de ter mensagens que surgem do nada (o que é desconfortável e leva a
// bloqueio), e do lado do protocolo o número passa a emitir os mesmos eventos de
// presença que um aparelho em uso emitiria.
//
// A velocidade é sorteada por mensagem — a mesma pessoa não digita sempre no
// mesmo ritmo — e o tempo total é limitado: ninguém fica 40 segundos com
// "digitando…" na tela, isso chamaria mais atenção do que ajudaria.

import type { EvolutionProvider } from '../whatsappProvider.js'

const MIN_TYPING_MS = 1_400
const MAX_TYPING_MS = 12_000
/** Caracteres por segundo — faixa de quem digita rápido no celular. */
const CPS_MIN = 12
const CPS_MAX = 22

export function typingDurationFor(text: string): number {
  const len = String(text ?? '').length
  const cps = CPS_MIN + Math.random() * (CPS_MAX - CPS_MIN)
  const ms = (len / cps) * 1000
  return Math.round(Math.min(MAX_TYPING_MS, Math.max(MIN_TYPING_MS, ms)))
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))
}

/**
 * Mostra "digitando…" pelo tempo adequado ao texto e devolve o controle só
 * quando terminou. Falha de presença NUNCA impede o envio: é enfeite
 * comportamental, não pré-requisito — se a Evolution recusar, seguimos adiante.
 */
export async function simulateTyping(
  provider: EvolutionProvider,
  phone: string,
  text: string,
  kind: 'composing' | 'recording' = 'composing',
): Promise<void> {
  const duration = typingDurationFor(text)
  try {
    await provider.sendPresence(phone, kind, duration)
    await sleep(duration)
    await provider.sendPresence(phone, 'paused', 0)
  } catch {
    // Presença é best-effort — segue o envio.
    await sleep(Math.min(duration, 3_000))
  }
}

/**
 * Pausa curta entre duas bolhas da mesma mensagem. Quem manda "Oi, Maria!" e
 * depois o assunto não emenda as duas no mesmo segundo.
 */
export function interBubbleDelay(configured: number): number {
  if (configured > 0) return configured
  return 1_200 + Math.floor(Math.random() * 2_600)
}
