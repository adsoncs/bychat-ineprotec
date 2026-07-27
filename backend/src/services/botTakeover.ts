// src/services/botTakeover.ts
//
// Pausa do chatbot por intervenção humana ("human takeover").
//
// Regra: quando um operador responde ao lead pelo painel, o chatbot PARA de
// responder naquela conversa — em definitivo, até alguém devolver o atendimento
// ao bot pela tela de Conversas. Antes disso, o bot continuava respondendo por
// cima do atendente (e ainda lia as falas dele como se fossem próprias, porque
// o histórico do LLM mapeia `fromMe: true` → role 'assistant').
//
// O marcador vive em `lead.formData._botPaused` — fora do estado da jornada
// (`_aiJourney` / `_script`), de propósito: vale para qualquer motor, inclusive
// para leads que ainda nem têm estado de chatbot.
//
// NÃO pausa: nota interna (não vai ao lead) e disparos automáticos (workflow,
// cadência, broadcast) — esses não passam pela rota do painel.

import { prisma } from '../lib/prisma.js'
import { logEvent, EVENT_TYPES } from './leadHistory.js'

export interface BotPauseMark {
  at: string           // ISO da intervenção
  byUserId?: number | null
  byName?: string | null
}

/** Lê o marcador de pausa do lead (null = bot liberado). */
export function readBotPause(formData: unknown): BotPauseMark | null {
  const fd = (formData || {}) as any
  const p = fd._botPaused
  if (!p || typeof p !== 'object' || !p.at) return null
  return p as BotPauseMark
}

/** true = o chatbot NÃO deve responder neste lead. */
export async function isBotPaused(leadId: number): Promise<boolean> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { formData: true } }).catch(() => null)
  return !!readBotPause(lead?.formData)
}

/**
 * Marca a conversa como assumida por humano. Idempotente: se já estava pausada,
 * mantém o carimbo original (quem assumiu primeiro) e não duplica evento.
 */
export async function pauseBotForHuman(
  leadId: number,
  operator: { userId?: number | null; userName?: string | null },
): Promise<boolean> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { formData: true } }).catch(() => null)
  if (!lead) return false
  if (readBotPause(lead.formData)) return false

  const base = (lead.formData || {}) as any
  const mark: BotPauseMark = {
    at: new Date().toISOString(),
    byUserId: operator.userId ?? null,
    byName: operator.userName ?? null,
  }
  await prisma.lead.update({
    where: { id: leadId },
    data: { formData: { ...base, _botPaused: mark } },
  }).catch(() => {})

  logEvent({
    leadId,
    type: EVENT_TYPES.BOT_PAUSED_HUMAN,
    category: 'system',
    title: 'Chatbot pausado — atendimento assumido por humano',
    source: 'panel',
    actorType: operator.userId ? 'operator' : 'system',
    userId: operator.userId ?? undefined,
    userName: operator.userName ?? undefined,
    description: 'O operador respondeu ao lead; o chatbot não responde mais nesta conversa até ser devolvido manualmente.',
  })
  return true
}

/** Devolve a conversa ao chatbot (botão "devolver ao bot"). */
export async function resumeBot(
  leadId: number,
  operator: { userId?: number | null; userName?: string | null },
): Promise<boolean> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { formData: true } }).catch(() => null)
  if (!lead) return false
  const mark = readBotPause(lead.formData)
  if (!mark) return false

  const base: any = { ...((lead.formData || {}) as object) }
  delete base._botPaused
  await prisma.lead.update({ where: { id: leadId }, data: { formData: base } }).catch(() => {})

  logEvent({
    leadId,
    type: EVENT_TYPES.BOT_RESUMED,
    category: 'system',
    title: 'Chatbot reativado nesta conversa',
    source: 'panel',
    actorType: operator.userId ? 'operator' : 'system',
    userId: operator.userId ?? undefined,
    userName: operator.userName ?? undefined,
    description: `Atendimento devolvido ao chatbot (estava com humano desde ${mark.at}).`,
  })
  return true
}
