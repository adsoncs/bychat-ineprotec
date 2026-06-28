// src/lib/phone.ts
//
// Identidade canônica de telefone — fonte ÚNICA de verdade para casar contatos.
// Resolve as 3 fontes de divergência que fragmentavam o mesmo contato em vários
// leads/conversas:
//   1) código de país 55 presente em uns, ausente em outros;
//   2) 9º dígito do celular BR presente em uns, ausente em outros;
//   3) WhatsApp LID (@lid, identificador de privacidade) que NÃO é telefone.
//
// `phoneKey()` devolve a chave canônica (ex.: "5544991323882") usada para o
// match EXATO. Todas as variações do mesmo número colapsam na mesma chave:
//   44991323882  → 5544991323882
//   554491323882 → 5544991323882   (faltava o 9)
//   5544991323882→ 5544991323882
//   74607944044732 (LID, 14 díg.) → null  (não é telefone)

/** Só os dígitos. */
export function onlyDigits(raw: string | null | undefined): string {
  return (raw || '').replace(/\D/g, '')
}

/** Heurística: parece um WhatsApp LID (não é telefone discável)? */
export function isLikelyLid(raw: string | null | undefined): boolean {
  const s = (raw || '').toLowerCase()
  if (s.includes('@lid')) return true
  const d = onlyDigits(raw)
  // Telefone BR/intl tem no máx. 13 dígitos (55 + DDD + 9 + 8). Acima disso é LID/ruído.
  return d.length > 13
}

/**
 * Chave canônica de telefone para MATCH. Devolve `null` quando o valor não é um
 * telefone identificável (LID, lixo, curto demais) — o caller NUNCA deve tratar
 * `null` como número.
 *
 * Foco em Brasil (tenants BR). Números 10–13 dígitos são tratados como BR e
 * normalizados para `55 + DDD(2) + 9 + 8` (13 dígitos). Demais formatos plausíveis
 * (intl) caem no fallback "só dígitos" para manter uma chave estável sem colidir.
 */
export function phoneKey(raw: string | null | undefined): string | null {
  if (isLikelyLid(raw)) return null
  let d = onlyDigits(raw)
  if (!d) return null
  // Remove prefixo de discagem internacional "00".
  d = d.replace(/^00/, '')
  if (d.length < 10) return null // sem DDD não dá pra identificar com segurança

  let core: string // DDD + número, sem o 55
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) {
    core = d.slice(2)
  } else if (d.length === 10 || d.length === 11) {
    core = d
  } else {
    // Outro país / formato fora do padrão BR: usa os dígitos como chave estável.
    return d
  }

  const ddd = core.slice(0, 2)
  let num = core.slice(2)
  if (num.length === 8) num = '9' + num // insere o 9º dígito do celular
  if (num.length !== 9) return d.length >= 10 ? '55' + core : d // fallback defensivo
  // DDD válido no Brasil: 11–99 (primeiro dígito 1–9, sem zero à esquerda).
  if (!/^[1-9][1-9]$/.test(ddd)) return '55' + ddd + num
  return '55' + ddd + num
}

/** Telefone para EXIBIÇÃO/ENVIO (canônico se BR; senão os dígitos). */
export function displayPhone(raw: string | null | undefined): string {
  return phoneKey(raw) ?? onlyDigits(raw)
}

/** Dois valores representam o mesmo contato telefônico? */
export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = phoneKey(a)
  const kb = phoneKey(b)
  return ka !== null && ka === kb
}
