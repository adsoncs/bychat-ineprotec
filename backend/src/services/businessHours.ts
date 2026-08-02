// src/services/businessHours.ts
// Determina se o momento atual está dentro do horário de atendimento configurado
// e busca a mensagem de auto-resposta para fora do expediente.
//
// Configuração persistida em bychat_settings (key=business_hours):
// {
//   enabled: true,
//   timezone: "America/Sao_Paulo",
//   schedule: {
//     "0": null,                                    // domingo: fechado
//     "1": [{ start: "09:00", end: "18:00" }],     // segunda
//     "2": [{ start: "09:00", end: "18:00" }],
//     "3": [{ start: "09:00", end: "18:00" }],
//     "4": [{ start: "09:00", end: "18:00" }],
//     "5": [{ start: "09:00", end: "18:00" }],
//     "6": null                                     // sábado: fechado
//   },
//   message: "Olá! Nosso horário de atendimento é seg-sex 9h-18h. Retornaremos em breve.",
//   throttleHours: 12                               // não reenviar pra mesmo número antes disso
// }

import { prisma } from '../lib/prisma.js'

export interface BusinessHoursConfig {
  enabled: boolean
  timezone: string
  schedule: Record<string, Array<{ start: string; end: string }> | null>
  message: string
  throttleHours: number
}

const DEFAULT_CONFIG: BusinessHoursConfig = {
  enabled: false,
  timezone: 'America/Sao_Paulo',
  schedule: {
    '0': null,
    '1': [{ start: '09:00', end: '18:00' }],
    '2': [{ start: '09:00', end: '18:00' }],
    '3': [{ start: '09:00', end: '18:00' }],
    '4': [{ start: '09:00', end: '18:00' }],
    '5': [{ start: '09:00', end: '18:00' }],
    '6': null,
  },
  message: 'Olá! Nosso horário de atendimento é de segunda a sexta, das 9h às 18h. Sua mensagem foi recebida e responderemos no próximo expediente.',
  throttleHours: 12,
}

let _cache: { config: BusinessHoursConfig; expiresAt: number } | null = null
const CACHE_TTL_MS = 60_000

export async function getBusinessHoursConfig(): Promise<BusinessHoursConfig> {
  if (_cache && _cache.expiresAt > Date.now()) return _cache.config

  const setting = await prisma.setting.findUnique({ where: { key: 'business_hours' } })
  let config: BusinessHoursConfig
  if (setting && setting.value && typeof setting.value === 'object') {
    config = { ...DEFAULT_CONFIG, ...(setting.value as any) }
  } else {
    config = DEFAULT_CONFIG
  }

  _cache = { config, expiresAt: Date.now() + CACHE_TTL_MS }
  return config
}

export function invalidateBusinessHoursCache() {
  _cache = null
}

/** Retorna true se o momento atual está dentro de algum slot do dia. */
export function isWithinBusinessHours(config: BusinessHoursConfig, now: Date = new Date()): boolean {
  if (!config.enabled) return true  // se desativado, sempre considera dentro

  // Pega data/hora local no timezone configurado
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: config.timezone,
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
  const parts = fmt.formatToParts(now)
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  const wkRaw = parts.find(p => p.type === 'weekday')?.value || 'Sun'
  const wk = weekdayMap[wkRaw] ?? 0
  const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0')
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0')
  const nowMinutes = hour * 60 + minute

  const slots = config.schedule[String(wk)]
  if (!slots || slots.length === 0) return false

  for (const slot of slots) {
    const [sH, sM] = slot.start.split(':').map(Number)
    const [eH, eM] = slot.end.split(':').map(Number)
    const startMin = sH * 60 + (sM || 0)
    const endMin = eH * 60 + (eM || 0)
    if (nowMinutes >= startMin && nowMinutes < endMin) return true
  }
  return false
}

const DIA_NOME = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']
const DIA_CURTO = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']

function hhmm(s: string): string {
  const [h, m] = String(s).split(':')
  return (m && m !== '00') ? `${Number(h)}h${m}` : `${Number(h)}h`
}

/**
 * Horário de atendimento em texto corrido ("segunda a sexta, das 9h às 18h") a
 * partir do que está em Cadastros › Atendimento.
 *
 * Existe para o chatbot ter UMA fonte de verdade sobre quando a equipe responde.
 * Sem isto, perguntado "vocês respondem ainda hoje?", o modelo inventa uma
 * resposta plausível — e o cliente recebe uma promessa que ninguém fez.
 *
 * Devolve null quando não há nenhum dia configurado (aí o bot não deve afirmar
 * horário nenhum, em vez de cair num padrão que pode não ser o da empresa).
 */
/**
 * Horário de atendimento SÓ se a empresa tiver cadastrado de fato.
 *
 * `getBusinessHoursConfig` cai num padrão (seg-sex 9h-18h) quando não há nada
 * salvo — útil para a tela não abrir vazia, perigoso para o chatbot: ele
 * afirmaria ao cliente um horário que ninguém configurou. Aqui, sem registro,
 * a resposta é null e o bot fica proibido de citar horário.
 */
export async function getConfiguredBusinessHours(): Promise<string | null> {
  const setting = await prisma.setting.findUnique({ where: { key: 'business_hours' } }).catch(() => null)
  if (!setting || !setting.value || typeof setting.value !== 'object') return null
  const config = { ...DEFAULT_CONFIG, ...(setting.value as any) }
  return formatBusinessHours(config)
}

export function formatBusinessHours(config: BusinessHoursConfig): string | null {
  const dias: Array<{ wk: number; txt: string }> = []
  for (let wk = 0; wk < 7; wk++) {
    const slots = config.schedule[String(wk)]
    if (!slots || !slots.length) continue
    dias.push({ wk, txt: slots.map((s) => `das ${hhmm(s.start)} às ${hhmm(s.end)}`).join(' e ') })
  }
  if (!dias.length) return null

  // Agrupa dias seguidos com o mesmo horário: "segunda a sexta, das 9h às 18h".
  const partes: string[] = []
  let i = 0
  while (i < dias.length) {
    let j = i
    while (j + 1 < dias.length && dias[j + 1].wk === dias[j].wk + 1 && dias[j + 1].txt === dias[i].txt) j++
    if (j > i) partes.push(`de ${DIA_CURTO[dias[i].wk]} a ${DIA_CURTO[dias[j].wk]}, ${dias[i].txt}`)
    else partes.push(`${DIA_NOME[dias[i].wk]}, ${dias[i].txt}`)
    i = j + 1
  }
  return partes.join('; ')
}

/**
 * Empurra um instante para o próximo horário de atendimento.
 *
 * Automação sem isto manda mensagem às 3h da manhã: um "esperar 2 dias" agendado
 * às 23h vence às 23h. Para o cliente, chegar fora de hora é intrusivo e ainda
 * queima a reputação do número.
 *
 * Devolve a data original quando já cai dentro do expediente (ou quando o
 * horário comercial está desligado). Varre no máximo 14 dias — se a agenda
 * estiver toda vazia, devolve a data original em vez de entrar em laço.
 */
export function nextBusinessTime(config: BusinessHoursConfig, when: Date): Date {
  if (!config.enabled) return when
  if (isWithinBusinessHours(config, when)) return when

  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: config.timezone, hour12: false, weekday: 'short', hour: '2-digit', minute: '2-digit' })

  let cursor = new Date(when)
  for (let i = 0; i < 14 * 24 * 4; i++) { // passos de 15min por até 14 dias
    const parts = fmt.formatToParts(cursor)
    const wk = weekdayMap[parts.find((p) => p.type === 'weekday')?.value || 'Sun'] ?? 0
    const hour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0')
    const minute = parseInt(parts.find((p) => p.type === 'minute')?.value || '0')
    const slots = config.schedule[String(wk)]
    if (slots && slots.length) {
      const nowMin = hour * 60 + minute
      // Primeiro slot que ainda vai começar (ou já está correndo) neste dia.
      for (const slot of slots) {
        const [sH, sM] = slot.start.split(':').map(Number)
        const [eH, eM] = slot.end.split(':').map(Number)
        const startMin = sH * 60 + (sM || 0)
        const endMin = eH * 60 + (eM || 0)
        if (nowMin >= startMin && nowMin < endMin) return cursor
        if (nowMin < startMin) return new Date(cursor.getTime() + (startMin - nowMin) * 60000)
      }
    }
    // Nada mais hoje: pula para o começo do dia seguinte e continua a busca.
    cursor = new Date(cursor.getTime() + (24 * 60 - (hour * 60 + minute)) * 60000)
  }
  return when
}

// Throttle: evita reenviar a mesma mensagem várias vezes ao mesmo número.
// Usa LeadEvent (type='auto_reply_business_hours') como registro.
export async function shouldSendAutoReply(leadId: number, throttleHours: number): Promise<boolean> {
  const cutoff = new Date(Date.now() - throttleHours * 3600_000)
  const last = await prisma.leadEvent.findFirst({
    where: {
      leadId,
      type: 'auto_reply_business_hours',
      createdAt: { gte: cutoff },
    },
    select: { id: true },
  })
  return !last
}
