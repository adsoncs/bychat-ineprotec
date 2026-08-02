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

/**
 * Devolve a conversa ao bot sozinho quando o atendimento humano esfriou.
 *
 * Sem isto, a pausa é eterna: basta um operador responder uma vez para o lead
 * sair do alcance do chatbot para sempre — inclusive para agendar. Numa operação
 * que quer o agendamento 100% pelo bot, é o que faz o volume represar.
 *
 * Critério (conservador de propósito): só retoma se NINGUÉM do lado da empresa
 * escreveu há mais de `hours` horas. Durante a pausa o bot não envia nada, então
 * qualquer mensagem `fromMe` posterior ao carimbo é humana — se houver uma
 * recente, o operador ainda está na conversa e o bot não entra por cima.
 *
 * Ligado por tenant em `chatbot.takeover_auto_resume_hours` (ausente/0 = nunca).
 */
export async function autoResumeIfStale(leadId: number): Promise<boolean> {
  const raw = await prisma.setting.findUnique({ where: { key: 'chatbot.takeover_auto_resume_hours' } }).catch(() => null)
  const hours = Number(String(raw?.value ?? '').replace(/"/g, '')) || 0
  if (hours <= 0) return false

  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { formData: true } }).catch(() => null)
  const mark = readBotPause(lead?.formData)
  if (!mark) return false

  const pausedAt = new Date(mark.at)
  if (isNaN(pausedAt.getTime())) return false
  const lastOut = await prisma.message.findFirst({
    where: { leadId, fromMe: true, isInternal: false },
    orderBy: { id: 'desc' },
    select: { createdAt: true },
  }).catch(() => null)
  const ref = lastOut && lastOut.createdAt > pausedAt ? lastOut.createdAt : pausedAt
  if (Date.now() - ref.getTime() < hours * 3600000) return false

  const base: any = { ...((lead?.formData || {}) as object) }
  delete base._botPaused
  await prisma.lead.update({ where: { id: leadId }, data: { formData: base } }).catch(() => {})

  logEvent({
    leadId,
    type: EVENT_TYPES.BOT_RESUMED,
    category: 'system',
    title: 'Chatbot reativado automaticamente',
    source: 'system',
    actorType: 'system',
    description: `Sem resposta da equipe há mais de ${hours}h (humano assumiu em ${mark.at}); o chatbot voltou a responder nesta conversa.`,
  })
  return true
}
