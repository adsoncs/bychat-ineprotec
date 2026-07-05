// src/lib/meetingBotSeat.ts
// Licença do bot de reunião POR USUÁRIO (seat) — unidade de cobrança do módulo.
// O bot só roda para reuniões de um usuário com licença ATIVA (enabled). A partir
// da ativação, o bot passa a operar (autoJoin) nas reuniões desse usuário.

import { prisma } from './prisma.js'

export interface UserBotConfig {
  userId: number
  enabled: boolean
  autoJoin: boolean
  language: string
  botName: string | null
}

const DEFAULTS: Omit<UserBotConfig, 'userId'> = {
  enabled: false, autoJoin: true, language: 'pt', botName: null,
}

// Cache do conjunto de usuários com licença ativa (gate quente).
let _enabled: Set<number> | null = null
let _at = 0
const TTL = 60_000

async function enabledSet(): Promise<Set<number>> {
  if (_enabled && Date.now() - _at < TTL) return _enabled
  const rows = await prisma.userMeetingBot.findMany({ where: { enabled: true }, select: { userId: true } })
  _enabled = new Set(rows.map(r => r.userId))
  _at = Date.now()
  return _enabled
}

export function invalidateSeatCache(): void {
  _at = 0
  _enabled = null
}

/** O usuário tem licença de bot ATIVA? (gate de cobrança) */
export async function isUserBotEnabled(userId: number | null | undefined): Promise<boolean> {
  if (!userId) return false
  return (await enabledSet()).has(userId)
}

/** Config do bot de um usuário (com defaults quando não há seat). */
export async function getUserBot(userId: number): Promise<UserBotConfig> {
  const row = await prisma.userMeetingBot.findUnique({ where: { userId } })
  if (!row) return { userId, ...DEFAULTS }
  return {
    userId,
    enabled: row.enabled,
    autoJoin: row.autoJoin,
    language: row.language,
    botName: row.botName,
  }
}

export interface SetUserBotInput {
  enabled?: boolean
  autoJoin?: boolean
  language?: string
  botName?: string | null
}

/** Ativa/desativa/configura o seat de um usuário. Retorna o registro atualizado. */
export async function setUserBot(userId: number, input: SetUserBotInput, activatedByUserId?: number | null) {
  const existing = await prisma.userMeetingBot.findUnique({ where: { userId } })
  const wasEnabled = existing?.enabled ?? false
  const enabling = input.enabled === true && !wasEnabled

  const update: any = {}
  if (input.enabled !== undefined) update.enabled = !!input.enabled
  if (input.autoJoin !== undefined) update.autoJoin = !!input.autoJoin
  if (input.language !== undefined) update.language = String(input.language).slice(0, 10) || 'pt'
  if (input.botName !== undefined) update.botName = input.botName ? String(input.botName).slice(0, 100) : null
  if (enabling) { update.activatedAt = new Date(); update.activatedByUserId = activatedByUserId ?? null }

  const rec = await prisma.userMeetingBot.upsert({
    where: { userId },
    create: {
      userId,
      enabled: input.enabled === true,
      autoJoin: input.autoJoin ?? DEFAULTS.autoJoin,
      language: input.language ? String(input.language).slice(0, 10) : DEFAULTS.language,
      botName: input.botName ? String(input.botName).slice(0, 100) : null,
      activatedAt: input.enabled === true ? new Date() : null,
      activatedByUserId: input.enabled === true ? (activatedByUserId ?? null) : null,
    },
    update,
  })
  invalidateSeatCache()
  return rec
}

/** Quantos seats ativos (billing). */
export async function countActiveSeats(): Promise<number> {
  return prisma.userMeetingBot.count({ where: { enabled: true } })
}
