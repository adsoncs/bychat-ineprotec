// src/services/smartBroadcast/variants.ts
//
// Conteúdo da mensagem. Mil cópias byte-a-byte idênticas saindo de um número em
// sequência é o padrão mais fácil de agrupar do outro lado — e também o que mais
// gera denúncia, porque o destinatário reconhece na hora que é disparo.
//
// Duas ferramentas, que se combinam:
//   • VARIAÇÕES — o operador escreve N redações diferentes da mesma mensagem;
//   • SPINTAX   — dentro de cada redação, {Oi|Olá|Bom dia} sorteia na hora.
//
// A escolha da variação é DETERMINÍSTICA por destinatário (hash do telefone).
// Sorteio puro concentraria variações por azar em lotes pequenos; o hash
// distribui parelho e, de quebra, garante que reprocessar a campanha mande a
// mesma redação para a mesma pessoa.

export interface MessageBlock {
  /** Redações alternativas. A primeira é a principal; as demais entram no rodízio. */
  variants: string[]
  mediaUrl?: string | null
  mediaType?: 'image' | 'video' | 'document' | 'audio' | null
  mediaName?: string | null
  /** Pausa antes do PRÓXIMO bloco (ms) — a quebra em várias bolhas. */
  delayAfterMs?: number | null
}

/** djb2 — estável entre execuções (Math.random não serviria aqui). */
function hashString(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h >>> 0
}

/** Índice da variação que este destinatário recebe. */
export function pickVariantIndex(key: string, total: number): number {
  if (total <= 1) return 0
  return hashString(key) % total
}

/**
 * Expande `{a|b|c}` (com aninhamento) sorteando uma opção por ocorrência.
 * Resolve de dentro para fora, então `{Oi|{Olá|E aí}}` funciona.
 */
export function expandSpintax(text: string): string {
  let out = String(text ?? '')
  // Limite de segurança: texto malformado não pode virar laço infinito.
  for (let guard = 0; guard < 100; guard++) {
    const match = /\{([^{}]*)\}/.exec(out)
    if (!match) break
    const options = (match[1] ?? '').split('|')
    const chosen = options[Math.floor(Math.random() * options.length)] ?? ''
    out = out.slice(0, match.index) + chosen + out.slice(match.index + match[0].length)
  }
  return out
}

/**
 * Substitui `{{campo}}` pelos valores do destinatário. Campo sem valor vira
 * string vazia — e `limparEspacos` tira o buraco que sobra ("Olá , tudo bem?").
 */
export function interpolateVars(text: string, vars: Record<string, string>): string {
  return String(text ?? '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_all, key: string) => vars[key] ?? '')
}

/**
 * Markdown que o WhatsApp NÃO entende, convertido para o que ele entende.
 *
 * Quem escreve a campanha (ou pede o texto a uma IA) escreve em Markdown por
 * hábito: `**negrito**`, `### Título`, listas com `-`. No WhatsApp isso chega
 * literal — a família lê "**Colégio Severiano**" com os asteriscos à mostra, e
 * o disparo inteiro parece amador. Converter aqui, na renderização, é melhor do
 * que pedir ao operador que decore a sintaxe do WhatsApp.
 */
export function whatsappMarkdown(text: string): string {
  return String(text ?? '')
    // "# Título" / "### Título" → negrito, que é o mais próximo que existe lá.
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+(.+?)[ \t]*$/gm, '*$1*')
    // **negrito** → *negrito* (no WhatsApp o negrito é UM asterisco).
    .replace(/\*\*([^*\n]+)\*\*/g, '*$1*')
    // __itálico__ → _itálico_
    .replace(/__([^_\n]+)__/g, '_$1_')
    // Marcador de lista no começo da linha → bolinha.
    .replace(/^[ \t]{0,3}[*-][ \t]+/gm, '• ')
}

/**
 * Limpa o rastro de variável vazia — "Olá , tudo bem?" vira "Olá, tudo bem?".
 * Roda no fim, depois do spintax, senão a expansão reintroduz espaços duplos.
 */
export function tidy(text: string): string {
  return whatsappMarkdown(text)
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([,.!?])/g, '$1')
    .trim()
}

/** Nomes de variáveis usados no texto — a UI mostra o que precisa ser mapeado. */
export function extractVarNames(blocks: MessageBlock[]): string[] {
  const found = new Set<string>()
  for (const b of blocks) {
    for (const v of b.variants ?? []) {
      for (const m of String(v ?? '').matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) {
        if (m[1]) found.add(m[1])
      }
    }
  }
  return [...found]
}

/** O texto tem ao menos uma variável? Mensagem 100% genérica é o que mais denuncia. */
export function hasPersonalization(blocks: MessageBlock[]): boolean {
  return extractVarNames(blocks).length > 0
}

/**
 * URL do `{{link}}` para UM destinatário. O mesmo endereço literal repetido em
 * milhares de mensagens é fácil de agrupar (e de bloquear); com UTMs da campanha
 * e um identificador por destinatário, cada mensagem carrega uma URL distinta —
 * e o clique chega ao tracking já sabendo de qual campanha veio.
 */
export function buildRecipientLink(baseUrl: string, campaignName: string, recipientId: number): string {
  const raw = String(baseUrl ?? '').trim()
  if (!raw) return ''
  try {
    const url = new URL(raw.startsWith('http') ? raw : `https://${raw}`)
    if (!url.searchParams.has('utm_source')) url.searchParams.set('utm_source', 'whatsapp')
    if (!url.searchParams.has('utm_medium')) url.searchParams.set('utm_medium', 'disparo')
    if (!url.searchParams.has('utm_campaign')) {
      url.searchParams.set('utm_campaign', campaignName.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60))
    }
    url.searchParams.set('rc', String(recipientId))
    return url.toString()
  } catch {
    return raw
  }
}

export interface RenderedBlock {
  text: string
  mediaUrl: string | null
  mediaType: string | null
  mediaName: string | null
  delayAfterMs: number
}

export interface RenderOptions {
  /** Rodapé de saída, anexado à ÚLTIMA bolha com texto. */
  optOutFooter?: string | null
}

/** Monta o que sai de fato para um destinatário: variação → spintax → variáveis. */
export function renderBlocks(
  blocks: MessageBlock[],
  vars: Record<string, string>,
  phoneKey: string,
  options: RenderOptions = {},
): RenderedBlock[] {
  const rendered = (blocks ?? []).map((block, i) => {
    const variants = (block.variants ?? []).filter((v) => String(v ?? '').trim().length > 0)
    // Índice deslocado pelo bloco: quem pega a variação 2 do bloco 1 não pega
    // necessariamente a 2 do bloco 2 — mais combinações com o mesmo material.
    const idx = variants.length ? (pickVariantIndex(phoneKey, variants.length) + i) % variants.length : 0
    const raw = variants[idx] ?? ''
    return {
      // Ordem importa: as variáveis saem PRIMEIRO. O spintax casa `{...}` e
      // devoraria as chaves internas de `{{nome}}`, deixando o literal
      // "nome" no texto enviado.
      text: tidy(expandSpintax(interpolateVars(raw, vars))),
      mediaUrl: block.mediaUrl ?? null,
      mediaType: block.mediaType ?? null,
      mediaName: block.mediaName ?? null,
      delayAfterMs: Math.max(0, block.delayAfterMs ?? 0),
    }
  })

  // Rodapé só na última bolha COM TEXTO — grudado numa bolha de mídia ele
  // viraria legenda solta, e repetido em todas seria ruído.
  const footer = String(options.optOutFooter ?? '').trim()
  if (footer) {
    for (let i = rendered.length - 1; i >= 0; i--) {
      if (rendered[i]!.text) {
        rendered[i]!.text = `${rendered[i]!.text}\n\n${footer}`
        break
      }
    }
  }
  return rendered
}

/**
 * Quantas mensagens REALMENTE distintas a campanha vai produzir. É a métrica que
 * o operador precisa ver antes de disparar: 2.000 mensagens e 3 textos distintos
 * é um disparo; 2.000 mensagens e 1.900 textos distintos parece conversa.
 *
 * Trabalha sobre uma amostra — renderizar a lista inteira só para contar seria
 * caro e não mudaria a conclusão.
 */
export function contentDiversity(
  blocks: MessageBlock[],
  sampleRecipients: Array<{ phoneKey: string; variables: Record<string, string> }>,
  options: RenderOptions = {},
): { sampled: number; distinct: number; ratio: number; topRepeated: number } {
  if (!sampleRecipients.length) return { sampled: 0, distinct: 0, ratio: 1, topRepeated: 0 }
  const counts = new Map<string, number>()
  for (const r of sampleRecipients) {
    const text = renderBlocks(blocks, r.variables ?? {}, r.phoneKey, options).map((b) => b.text).join('\n')
    counts.set(text, (counts.get(text) ?? 0) + 1)
  }
  const distinct = counts.size
  const topRepeated = Math.max(...counts.values())
  return {
    sampled: sampleRecipients.length,
    distinct,
    ratio: Math.round((distinct / sampleRecipients.length) * 100) / 100,
    topRepeated,
  }
}

/** Índice da variação do primeiro bloco — guardado no destinatário p/ relatório de A/B. */
export function primaryVariantIndex(blocks: MessageBlock[], phoneKey: string): number {
  const variants = (blocks?.[0]?.variants ?? []).filter((v) => String(v ?? '').trim().length > 0)
  return variants.length ? pickVariantIndex(phoneKey, variants.length) : 0
}

/**
 * Amostra de como as mensagens vão sair — a prévia do wizard. Mostrar 8 exemplos
 * reais é a forma mais honesta de o operador perceber que escreveu pouca variação.
 */
export function previewSamples(
  blocks: MessageBlock[],
  sampleVars: Record<string, string>,
  n = 8,
  options: RenderOptions = {},
): string[][] {
  const out: string[][] = []
  for (let i = 0; i < n; i++) {
    out.push(renderBlocks(blocks, sampleVars, `preview-${i}`, options).map((b) => b.text))
  }
  return out
}
