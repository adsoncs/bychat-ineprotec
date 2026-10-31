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
  // Estes campos são JSON no banco: o `??` só cobre a coluna inteira nula, não
  // uma lista que faltou dentro dela. Uma blacklist gravada como `{phones: []}`
  // — sem `emails` — passava por aqui e estourava em `emails.includes(...)`,
  // derrubando cada tick da cadência. Cada lista tem de ter o seu próprio piso.
  const lista = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : [])
  const bl = (row.blacklist ?? {}) as Partial<GovernanceConfig['blacklist']>
  const janela = (row.silenceWindow ?? {}) as Partial<GovernanceConfig['silenceWindow']>

  return {
    maxPerChannelPerDay: (row.maxPerChannelPerDay as GovernanceConfig['maxPerChannelPerDay']) ?? {},
    silenceWindow: {
      ...DEFAULT_GOVERNANCE.silenceWindow,
      ...(janela && typeof janela === 'object' ? janela : {}),
    },
    blacklist: { phones: lista(bl.phones), emails: lista(bl.emails) },
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

// ─── Pedido de saída escrito pelo contato ───────────────
//
// O rodapé dos templates de marketing promete "responda SAIR". Até aqui só o
// módulo de Disparos Inteligentes ouvia essa palavra, e apenas para quem estava
// numa campanha — quem pedisse para sair de um fluxo automático continuava
// recebendo. Uma promessa dessas no rodapé precisa valer em qualquer conversa.

// Opt-in por instalação: Setting `whatsapp.optout_por_palavra` (padrão desligado).
// Ligado, qualquer mensagem recebida curta com "SAIR"/"PARAR"/… marca o opt-out
// de WhatsApp do lead (os envios automáticos passam a respeitá-lo). Desligado,
// só o módulo de Disparos ouve essas palavras, como sempre.
async function optOutPorPalavraLigado(): Promise<boolean> {
  const row = await prisma.setting.findUnique({ where: { key: 'whatsapp.optout_por_palavra' } }).catch(() => null)
  return ['true', '1', 'sim', 'on'].includes(String(row?.value ?? '').replace(/^"|"$/g, '').trim().toLowerCase())
}

/** Palavras que significam "não me mande mais nada". */
const OPT_OUT_WORDS = /^\s*(pare|parar|sair|saia|cancelar|cancela|descadastrar|remover|stop|nao quero|não quero)\b/i

export function isOptOutRequest(text: string | null | undefined): boolean {
  const t = String(text ?? '').trim()
  // Só frase curta: "cancelar minha visita de quinta" é outra conversa, e tirar
  // o contato do WhatsApp por causa dela seria pior que não ouvir.
  if (!t || t.length > 40) return false
  return OPT_OUT_WORDS.test(t)
}

/**
 * Ouve o pedido de saída numa mensagem recebida e registra o opt-out. NÃO
 * consome a mensagem: ela continua entrando na conversa, porque o atendente
 * precisa ver que o contato pediu para sair.
 */
export async function tratarPedidoDeSaida(phone: string, texto: string | null | undefined): Promise<boolean> {
  if (!isOptOutRequest(texto)) return false
  if (!(await optOutPorPalavraLigado())) return false
  const norm = (phone || '').replace(/\D/g, '')
  if (norm.length < 8) return false
  const lead = await prisma.lead.findFirst({
    where: { whatsapp: { contains: norm.slice(-8) } },
    orderBy: { lastMessageAt: 'desc' },
    select: { id: true },
  })
  if (!lead) return false
  return registrarPedidoDeSaida(lead.id)
}

/**
 * Marca o lead como opt-out de WhatsApp. Idempotente. Retorna true se registrou
 * agora (para quem quiser confirmar ao contato que o pedido foi atendido).
 */
export async function registrarPedidoDeSaida(leadId: number): Promise<boolean> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { optOutChannels: true } })
  if (!lead) return false
  const atuais = parseOptOutChannels(lead.optOutChannels)
  if (atuais.includes('whatsapp')) return false
  await prisma.lead.update({
    where: { id: leadId },
    data: { optOutChannels: [...atuais, 'whatsapp'] as any },
  })
  console.log(`[governance] opt-out de WhatsApp registrado para o lead ${leadId}`)
  return true
}

// Exports auxiliares pra testes/outros consumidores
export const __test = { isInSilenceWindow, nextOpenWindow, parseOptOutChannels }
