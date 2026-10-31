// src/lib/waInteractive.ts
//
// Builders de mensagens interativas nativas do WhatsApp (Cloud API oficial):
//   - Reply Buttons  → até 3 opções
//   - List Message   → 4 a 10 opções
// Acima de 10 opções não há formato interativo → o chamador deve cair no texto
// numerado (fallback). Botões só funcionam na Cloud API; na Evolution/Baileys a
// Meta bloqueou esses tipos, então o motor de chatbot nem chama estes builders
// quando o provider é 'evolution'.
//
// Limites da Meta respeitados aqui (truncados para não estourar o request):
//   body.text       ≤ 1024   | button title ≤ 20 | reply id ≤ 256
//   list row title  ≤ 24     | row description ≤ 72 | list button ≤ 20
//   section title   ≤ 24

export interface Choice {
  id: string
  title: string
  description?: string
}

const MAX_BUTTONS = 3
const MAX_ROWS = 10
const BODY_MAX = 1024
const BTN_TITLE_MAX = 20
const ID_MAX = 256
const ROW_TITLE_MAX = 24
const ROW_DESC_MAX = 72
const LIST_BTN_MAX = 20
const SECTION_TITLE_MAX = 24

function trunc(s: string | null | undefined, n: number): string {
  const v = String(s ?? '').trim()
  return v.length <= n ? v : v.slice(0, n - 1) + '…'
}

/** Reply Buttons (≤3). Retorna null se vazio ou >3. */
export function buildButtons(body: string, choices: Choice[]): any | null {
  if (!choices.length || choices.length > MAX_BUTTONS) return null
  return {
    type: 'button',
    body: { text: trunc(body, BODY_MAX) },
    action: {
      buttons: choices.map((c) => ({
        type: 'reply',
        reply: { id: trunc(c.id, ID_MAX), title: trunc(c.title, BTN_TITLE_MAX) },
      })),
    },
  }
}

/** List Message (≤10). Retorna null se vazio ou >10. */
export function buildList(
  body: string,
  choices: Choice[],
  opts?: { button?: string; sectionTitle?: string },
): any | null {
  if (!choices.length || choices.length > MAX_ROWS) return null
  return {
    type: 'list',
    body: { text: trunc(body, BODY_MAX) },
    action: {
      button: trunc(opts?.button || 'Ver opções', LIST_BTN_MAX),
      sections: [
        {
          title: trunc(opts?.sectionTitle || 'Opções', SECTION_TITLE_MAX),
          rows: choices.map((c) => ({
            id: trunc(c.id, ID_MAX),
            title: trunc(c.title, ROW_TITLE_MAX),
            ...(c.description ? { description: trunc(c.description, ROW_DESC_MAX) } : {}),
          })),
        },
      ],
    },
  }
}

/**
 * Escolhe o melhor formato interativo para um conjunto de opções:
 *   ≤3 (títulos até 20) → botões | até 10 → lista | >10 → null (chamador usa texto numerado).
 */
export function buildChoices(
  body: string,
  choices: Choice[],
  opts?: { button?: string; sectionTitle?: string },
): any | null {
  if (!choices.length) return null
  // Botão corta o título em 20; a linha da lista aceita 24. Se algum título
  // não cabe no botão, vai como lista em vez de chegar cortado ("Sede - Pindamonhang…").
  const cabeEmBotao = choices.every((c) => String(c.title ?? '').trim().length <= BTN_TITLE_MAX)
  if (choices.length <= MAX_BUTTONS && cabeEmBotao) return buildButtons(body, choices)
  if (choices.length <= MAX_ROWS) return buildList(body, choices, opts)
  return null
}

/** Representação textual das opções (fallback p/ Evolution e log de auditoria). */
export function choicesToText(body: string, choices: Choice[], hint = 'Responda com o número da opção.'): string {
  const list = choices
    .map((c, i) => `${i + 1}) ${c.title}${c.description ? ` — ${c.description}` : ''}`)
    .join('\n')
  return `${body}\n\n${list}\n\n_${hint}_`
}

/**
 * Separa um label de opção em título curto + descrição, para caber nos limites
 * da Meta (row title ≤ 24) sem perder informação: o resto vai para a
 * description da row (≤ 72). Reconhece "*Nome* — descrição" (negrito) e os
 * separadores comuns (— – : ou " - " com espaços). Sem separador reconhecido, o
 * label inteiro vira o título (comportamento idêntico ao anterior).
 */
export function splitChoiceLabel(label: string | null | undefined): { title: string; description?: string } {
  const s = String(label ?? '').trim()
  if (!s) return { title: '' }
  // "*Nome* — descrição": nome em negrito markdown, resto é descrição.
  const bold = s.match(/^\*([^*]+)\*\s*(?:[—–:-]\s*)?(.*)$/)
  if (bold && bold[1].trim()) {
    const title = bold[1].trim()
    const rest = bold[2].trim()
    return rest ? { title, description: rest } : { title }
  }
  // "Nome — descrição" / "Nome: descrição" / "Nome - descrição" (com espaços).
  const m = s.match(/^(.{1,24}?)\s*[—–:]\s*(.+)$/) || s.match(/^(.{1,24}?)\s+-\s+(.+)$/)
  if (m && m[2].trim()) return { title: m[1].trim(), description: m[2].trim() }
  return { title: s }
}
