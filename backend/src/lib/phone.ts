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

/** Um bloco de dígitos é um telefone BR plausível (DDD válido + 8 ou 9 dígitos)? */
function isBrBlock(d: string): boolean {
  return /^(1[1-9]|[2-9][1-9])\d{8,9}$/.test(d)
}

/**
 * Formulários (sobretudo o Lead Ads da Meta) às vezes chegam com DOIS telefones
 * colados no mesmo campo — ex.: "1898123391718920016015" = 18981233917 +
 * 18920016015. O valor inteiro não é discável e a Meta devolve 131009 ("número
 * no formato incorreto") no disparo. Recupera o PRIMEIRO número quando — e só
 * quando — a divisão é inequívoca: os dois blocos são telefones BR plausíveis.
 * Qualquer outro comprimento estranho (LID de 15 dígitos, ruído) devolve null,
 * para nunca inventar um número a partir de lixo.
 */
export function firstOfConcatenated(raw: string | null | undefined): string | null {
  const d = onlyDigits(raw)
  if (d.length < 20 || d.length > 26) return null
  const candidates: string[] = []
  for (const cut of [10, 11, 12, 13]) {
    const head = d.slice(0, cut)
    const tail = d.slice(cut)
    const headOk = isBrBlock(head) || (head.startsWith('55') && isBrBlock(head.slice(2)))
    const tailOk = isBrBlock(tail) || (tail.startsWith('55') && isBrBlock(tail.slice(2)))
    if (headOk && tailOk) candidates.push(head)
  }
  // Divisão ambígua (mais de um corte válido) → não arrisca.
  return candidates.length === 1 ? candidates[0] : null
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
  // Um "@lid" explícito é identificador de privacidade, nunca telefone.
  if (String(raw || '').toLowerCase().includes('@lid')) return null

  let d = onlyDigits(raw)
  if (!d) return null
  // Remove prefixo de discagem internacional "00".
  d = d.replace(/^00/, '')
  // DDI 55 repetido ("555518…", acontece quando um caminho já normalizado é
  // normalizado de novo por outro que também prefixa). Roda ANTES do corte por
  // comprimento, senão "555518981233917" (15 díg.) seria descartado como LID.
  while (/^55(55(?:1[1-9]|[2-9][1-9])9?\d{8})$/.test(d)) d = d.slice(2)
  // DDD escrito no formato antigo de discagem, com zero à esquerda: "018998128130"
  // (operadora + DDD) e "5501899…". Sem isso o número cai no fallback "outro país"
  // e sai do CRM sem o 55 — foi o caso do lead 156 (Meta Lead Ads).
  if (/^0[1-9][1-9]\d{8,9}$/.test(d)) d = d.slice(1)
  else if (/^550[1-9][1-9]\d{8,9}$/.test(d)) d = '55' + d.slice(3)

  if (d.length > 13) {
    // Longo demais para telefone: LID, ruído — ou dois números colados no mesmo
    // campo de formulário, único caso recuperável (divisão inequívoca).
    const first = firstOfConcatenated(d)
    if (!first) return null
    d = first
  }
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

/**
 * Número pronto para DISCAGEM nas APIs de WhatsApp (Evolution e Cloud API), em
 * dígitos com DDI: "5518998196075". Devolve `null` quando o valor não é um
 * telefone discável (LID, sem DDD, lixo) — nesse caso o caller deve ABORTAR o
 * envio com erro explicativo em vez de mandar para a API e colecionar
 * `exists:false` (Evolution) ou 131009 (Meta).
 *
 * Um JID completo ("...@lid", "...@g.us") NÃO passa por aqui: é identificador de
 * sessão, não telefone — quem envia deve repassá-lo intacto.
 */
export function toWaNumber(raw: string | null | undefined): string | null {
  const key = phoneKey(raw)
  if (!key) return null
  // Fora do padrão BR (13 díg) só aceita comprimento internacional plausível.
  if (key.length < 10 || key.length > 15) return null
  return key
}

/** Dois valores representam o mesmo contato telefônico? */
export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = phoneKey(a)
  const kb = phoneKey(b)
  return ka !== null && ka === kb
}
