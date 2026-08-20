// src/services/workflowConditions.ts
// Avaliador de condições para workflow steps

import { prisma } from '../lib/prisma.js'

interface ConditionConfig {
  type?: string       // has_tag, not_has_tag, time_since, stage_is, source_is, lost_reason_in
  field?: string      // lead.status, lead.source, lead.originType, lead.funnelId, lead.customFields.cargo, lead.lostReason.name
  operator?: string   // equals, not_equals, contains, gt, lt, gte, lte, in
  value?: any
  tagName?: string
  unit?: string       // hours, minutes, days
  reasonIds?: number[] // Fase 23.1: lista de objeções para `lost_reason_in`
}

/** Normaliza `value` de condição em lista: aceita array, CSV ou escalar. */
function valueList(value: any): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean)
  if (value === undefined || value === null) return []
  return String(value).split(',').map((v) => v.trim()).filter(Boolean)
}

export async function evaluateCondition(config: ConditionConfig, leadId: number): Promise<boolean> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      tags: { include: { tag: true } },
      lostReason: { select: { id: true, name: true } },
    },
  })
  if (!lead) return false

  // Agendamento: base de qualquer automação de recuperação ("ofereci horários e a
  // pessoa não marcou"). Reserva cancelada não conta como agendada — o lead volta
  // a ser alvo de recuperação, que é o comportamento desejado.
  if (config.type === 'has_booking' || config.type === 'not_has_booking') {
    const booking = await prisma.booking.findFirst({
      where: { leadId: lead.id, status: { not: 'cancelled' } },
      select: { id: true },
    })
    return config.type === 'has_booking' ? !!booking : !booking
  }

  // Etapa atual do lead. O editor de fluxos oferece "O lead está em uma etapa
  // específica" desde sempre, mas nenhum ramo tratava o tipo aqui — a condição
  // caía no `return false` do fim e o fluxo seguia eternamente pelo "senão".
  // Aceita uma etapa ou várias (array/CSV): "está em NOVO ou CONTATADO".
  if (config.type === 'stage_is' || config.type === 'stage_is_not') {
    const alvo = valueList(config.value)
    if (alvo.length === 0) return false // sem etapa escolhida = condição incompleta
    const bate = alvo.includes(String(lead.status))
    return config.type === 'stage_is' ? bate : !bate
  }

  // Origem do lead. Mesmo caso do `stage_is`. Compara com `originType` (o campo
  // granular: meta_ctwa, google_ads, trackable_link...) E com o `source` legado,
  // porque os dois convivem — `source='landing_page'` cobre tanto web_form
  // quanto google_ads, então exigir só um dos campos perderia lead de verdade.
  if (config.type === 'source_is' || config.type === 'source_is_not') {
    const alvo = valueList(config.value)
    if (alvo.length === 0) return false
    const bate = alvo.includes(String(lead.originType)) || alvo.includes(String(lead.source))
    return config.type === 'source_is' ? bate : !bate
  }

  // Tag conditions
  if (config.type === 'has_tag') {
    return lead.tags.some((lt: any) => lt.tag.name === config.tagName)
  }
  if (config.type === 'not_has_tag') {
    return !lead.tags.some((lt: any) => lt.tag.name === config.tagName)
  }

  // Fase 23.1: lead perdido com objeção em uma lista
  if (config.type === 'lost_reason_in') {
    if (lead.outcome !== 'lost' || lead.lostReasonId == null) return false
    const ids = (config.reasonIds || []).map(Number)
    return ids.includes(Number(lead.lostReasonId))
  }
  if (config.type === 'lost_reason_not_in') {
    if (lead.outcome !== 'lost' || lead.lostReasonId == null) return true
    const ids = (config.reasonIds || []).map(Number)
    return !ids.includes(Number(lead.lostReasonId))
  }

  // Time since conditions
  if (config.type === 'time_since') {
    const fieldValue = getLeadField(lead, config.field || '')
    if (!fieldValue) return false
    const date = new Date(fieldValue)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const unitMultiplier = config.unit === 'days' ? 86400000 : config.unit === 'hours' ? 3600000 : 60000
    const diffInUnit = diffMs / unitMultiplier
    return compareValues(diffInUnit, config.operator || 'gt', config.value)
  }

  // Field conditions
  if (config.field) {
    const fieldValue = getLeadField(lead, config.field)
    return compareValues(fieldValue, config.operator || 'equals', config.value)
  }

  return false
}

function getLeadField(lead: any, field: string): any {
  // Direct lead fields
  if (field.startsWith('lead.')) {
    const key = field.replace('lead.', '')

    // Custom fields
    if (key.startsWith('customFields.')) {
      const cfKey = key.replace('customFields.', '')
      const customFields = lead.customFields || {}
      return customFields[cfKey]
    }

    // Fase 23.1: relacionamentos — lead.lostReason.name, lead.lostReason.id
    if (key.startsWith('lostReason.')) {
      const subKey = key.replace('lostReason.', '')
      return lead.lostReason ? lead.lostReason[subKey] : undefined
    }

    // Standard fields
    return lead[key]
  }

  return lead[field]
}

function compareValues(actual: any, operator: string, expected: any): boolean {
  if (actual === undefined || actual === null) {
    return operator === 'not_equals' ? expected !== null : false
  }

  switch (operator) {
    case 'equals':
      return String(actual) === String(expected)
    case 'not_equals':
      return String(actual) !== String(expected)
    case 'contains':
      return String(actual).toLowerCase().includes(String(expected).toLowerCase())
    case 'gt':
      return Number(actual) > Number(expected)
    case 'lt':
      return Number(actual) < Number(expected)
    case 'gte':
      return Number(actual) >= Number(expected)
    case 'lte':
      return Number(actual) <= Number(expected)
    case 'in':
      if (Array.isArray(expected)) return expected.map(String).includes(String(actual))
      return String(expected).split(',').map(s => s.trim()).includes(String(actual))
    default:
      return String(actual) === String(expected)
  }
}
