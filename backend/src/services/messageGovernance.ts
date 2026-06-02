// src/services/messageGovernance.ts
//
// Sales Engagement A3 + A4: governança central de envio.
//
// Função única `canSendNow(leadId, channel)` que TODOS os pontos de envio
// (cadência, workflow, broadcast manual, atendimento) devem chamar antes de
// disparar uma mensagem. Garante:
//   1. Opt-out: respeita Lead.optOutChannels (A2)
//   2. Silence window: bloqueia 22h-8h + weekends opcional
//   3. Blacklist: phones/emails marcados não recebem
//   4. Frequency cap: limite N msgs/canal/lead/dia (ChannelGovernance por equipe)
//
// A4: config é lida de `ChannelGovernance` (FK Team). Lookup em ordem:
//   lead.teamId → ChannelGovernance(teamId=lead.teamId) → ChannelGovernance(teamId=null)
//   → DEFAULT_GOVERNANCE (constante neste arquivo).

import { prisma } from '../lib/prisma.js'

export type Channel = 'whatsapp' | 'email' | 'sms' | 'call' | 'manual' | 'linkedin'

export type BlockReason = 'opt_out' | 'silence_window' | 'frequency_cap' | 'blacklist' | 'lead_not_found'

export interface CanSendResult {
  ok: boolean
  reason?: BlockReason
  /** quando re-tentar (silence_window, frequency_cap). Ausente em opt_out/blacklist (não readmite). */
  retryAt?: Date
  details?: string
}

export interface GovernanceConfig {
  /** Máximo de envios por canal por lead em 24h. Canais não listados = sem limite. */
  maxPerChannelPerDay: Partial<Record<Channel, number>>
  /** Janela de silêncio (HH:mm). start > end = atravessa meia-noite (ex: 22:00→08:00). */
  silenceWindow: { start: string; end: string; weekends: boolean }
  /** Telefones (E.164 sem +) e emails (lowercase) bloqueados. */
  blacklist: { phones: string[]; emails: string[] }
}

const DEFAULT_GOVERNANCE: GovernanceConfig = {
  maxPerChannelPerDay: { whatsapp: 2, email: 1, sms: 1 },
  silenceWindow: { start: '22:00', end: '08:00', weekends: true },
  blacklist: { phones: [], emails: [] },
}

/** Carrega config de governança aplicável ao lead. Ordem de lookup:
 *   1. ChannelGovernance(teamId = lead.teamId, active=true)
 *   2. ChannelGovernance(teamId = null, active=true)  — global
 *   3. DEFAULT_GOVERNANCE
 *
 * O lead pode ser passado direto (caller já carregou) pra evitar query extra. */
async function loadGovernanceForLead(
  leadOrId: number | { id: number; teamId: number | null },
): Promise<GovernanceConfig> {
  let teamId: number | null = null
  if (typeof leadOrId === 'number') {
    const lead = await prisma.lead.findUnique({ where: { id: leadOrId }, select: { teamId: true } })
    teamId = lead?.teamId ?? null
  } else {
    teamId = leadOrId.teamId
  }

  // Tenta config do time, senão global, senão default
  const row =
    (teamId !== null
      ? await prisma.channelGovernance.findUnique({ where: { teamId } })
      : null) ??
    (await prisma.channelGovernance.findFirst({ where: { teamId: null, active: true } }))

  if (!row || row.active === false) return DEFAULT_GOVERNANCE
  return rowToConfig(row)
}

function rowToConfig(row: {
  maxPerChannelPerDay: unknown
  silenceWindow: unknown
  blacklist: unknown
}): GovernanceConfig {
  return {
    maxPerChannelPerDay: (row.maxPerChannelPerDay as GovernanceConfig['maxPerChannelPerDay']) ?? {},
    silenceWindow: (row.silenceWindow as GovernanceConfig['silenceWindow']) ?? DEFAULT_GOVERNANCE.silenceWindow,
    blacklist: (row.blacklist as GovernanceConfig['blacklist']) ?? { phones: [], emails: [] },
  }
}

/** Conta mensagens enviadas pra este lead nas últimas 24h, por canal.
 * WhatsApp: tabela `Message` (fromMe=true) — fonte canônica.
 * Demais canais (email/sms/call/linkedin): contagem via `LeadEvent`
 * filtrado por channel + category='communication' (caller deve registrar
 * o LeadEvent ao enviar pra que o cap funcione). */
async function countSentLast24h(leadId: number, channel: Channel, now: Date): Promise<number> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  if (channel === 'whatsapp') {
    return prisma.message.count({
      where: { leadId, fromMe: true, timestamp: { gte: since } },
    })
  }
  return prisma.leadEvent.count({
    where: { leadId, channel, category: 'communication', createdAt: { gte: since } },
  })
}

/** Ponto de entrada principal. Chamar antes de qualquer envio outbound. */
export async function canSendNow(
  leadId: number,
  channel: Channel,
  now: Date = new Date(),
): Promise<CanSendResult> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, teamId: true, optOutChannels: true, whatsapp: true, email: true },
  })
  if (!lead) {
    return { ok: false, reason: 'lead_not_found', details: `Lead ${leadId} não encontrado` }
  }

  // 1. Opt-out por canal (A2)
  const optedOut = parseOptOutChannels(lead.optOutChannels)
  if (optedOut.includes(channel)) {
    return { ok: false, reason: 'opt_out', details: `Lead optou por não receber ${channel}` }
  }

  const config = await loadGovernanceForLead({ id: lead.id, teamId: lead.teamId })

  // 2. Silence window
  if (isInSilenceWindow(now, config.silenceWindow)) {
    return {
      ok: false,
      reason: 'silence_window',
      retryAt: nextOpenWindow(now, config.silenceWindow),
      details: `Fora da janela permitida (${config.silenceWindow.start}–${config.silenceWindow.end})`,
    }
  }

  // 3. Blacklist
  const phone = (lead.whatsapp ?? '').replace(/\D/g, '')
  const email = (lead.email ?? '').toLowerCase().trim()
  if ((channel === 'whatsapp' || channel === 'sms' || channel === 'call') && phone && config.blacklist.phones.includes(phone)) {
    return { ok: false, reason: 'blacklist', details: 'Telefone na blacklist' }
  }
  if (channel === 'email' && email && config.blacklist.emails.includes(email)) {
    return { ok: false, reason: 'blacklist', details: 'Email na blacklist' }
  }

  // 4. Frequency cap (A4)
  const cap = config.maxPerChannelPerDay[channel]
  if (cap !== undefined && cap >= 0) {
    const sent = await countSentLast24h(leadId, channel, now)
    if (sent >= cap) {
      // Re-tenta quando passar 24h da mensagem mais antiga da janela.
      // Aproximação: simplesmente +1h pra evitar query custosa do timestamp exato.
      const retryAt = new Date(now.getTime() + 60 * 60 * 1000)
      return {
        ok: false,
        reason: 'frequency_cap',
        retryAt,
        details: `Cap atingido: ${sent}/${cap} envios em 24h pelo canal ${channel}`,
      }
    }
  }

  return { ok: true }
}

// ─── Helpers internos ───────────────────────────────────────

function parseOptOutChannels(raw: unknown): string[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === 'string')
  return []
}

function parseHm(hm: string): { h: number; m: number } {
  const [h, m] = hm.split(':').map((s) => Number.parseInt(s, 10))
  return { h: h || 0, m: m || 0 }
}

function isInSilenceWindow(now: Date, sw: GovernanceConfig['silenceWindow']): boolean {
  const day = now.getDay()
  if (sw.weekends && (day === 0 || day === 6)) return true

  const start = parseHm(sw.start)
  const end = parseHm(sw.end)
  const startMin = start.h * 60 + start.m
  const endMin = end.h * 60 + end.m
  const nowMin = now.getHours() * 60 + now.getMinutes()

  // start > end = atravessa meia-noite (ex: 22:00 → 08:00)
  if (startMin > endMin) return nowMin >= startMin || nowMin < endMin
  return nowMin >= startMin && nowMin < endMin
}

/** Próximo horário em que envios são permitidos. */
function nextOpenWindow(now: Date, sw: GovernanceConfig['silenceWindow']): Date {
  const end = parseHm(sw.end)
  const next = new Date(now)
  next.setHours(end.h, end.m, 0, 0)

  // Se end já passou hoje, vai pra amanhã
  if (next <= now) next.setDate(next.getDate() + 1)

  // Pula weekends se silenciados
  if (sw.weekends) {
    while (next.getDay() === 0 || next.getDay() === 6) {
      next.setDate(next.getDate() + 1)
    }
  }
  return next
}

// Exports auxiliares pra testes/outros consumidores
export const __test = { isInSilenceWindow, nextOpenWindow, parseOptOutChannels }
