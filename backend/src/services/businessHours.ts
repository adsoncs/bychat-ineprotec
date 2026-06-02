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
