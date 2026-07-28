// src/services/negotiationSuggestion.ts
//
// Monta o rascunho de uma Negociação a partir do que o lead já traz da Kommo,
// para o operador não redigitar o que o CRM antigo já sabia: o curso escolhido
// (com o valor de tabela do catálogo), a forma de pagamento, o parcelamento e o
// desconto negociado.
//
// Por que resolver os campos pelo NOME e não pela chave: as chaves locais são
// `kommo_<field_id>` e os ids mudam de conta para conta — hardcodá-los
// quebraria em qualquer outro tenant. O nome do campo na Kommo ("Parcelamento",
// "Forma de Pagamento") é estável e está guardado no KommoMapping.
//
// Só sugere; não persiste nada. Quem grava é o POST /api/admin/negotiations
// normal, depois que o operador confirmar.

import { prisma } from '../lib/prisma.js'

/** Campos derivados pelo import (nossos, não da Kommo) — ver kommoSync. */
const CF_CURSO_VALOR = 'kommo_curso_valor'

export interface NegotiationSuggestionItem {
  productId: number | null
  nome: string
  quantidade: number
  precoUnit: number
  descontoItem: number
}

export interface NegotiationSuggestion {
  titulo: string
  items: NegotiationSuggestionItem[]
  pagamentoForma: string | null
  parcelas: number | null
  descontoTipo: 'valor' | 'percent' | null
  descontoValor: number | null
  condicaoPagamento: string | null
  /** De onde cada dado veio — a UI avisa que o rascunho é da Kommo. */
  origem: string | null
}

/** Nome do campo na Kommo → chave local (`kommo_<id>`). Um nome pode ter mais de
 * um campo (a conta tem dois "Forma de Pagamento"); devolvemos todas as chaves. */
async function kommoFieldKeysByName(): Promise<Map<string, string[]>> {
  const rows = await prisma.kommoMapping.findMany({ where: { entityType: 'custom_field' }, select: { meta: true } })
  const map = new Map<string, string[]>()
  for (const r of rows) {
    const m = r.meta as any
    if (!m?.name || !m?.key) continue
    const nome = String(m.name).trim().toLowerCase()
    map.set(nome, [...(map.get(nome) ?? []), m.key])
  }
  return map
}

/**
 * Contexto compartilhado da sugestão (campos e catálogo). Carregado uma vez e
 * reusado — o import de negociações fechadas percorre centenas de leads e não
 * pode reconsultar isto por lead.
 */
export interface SuggestionContext {
  byName: Map<string, string[]>
  productsByName: Map<string, { id: number; preco: number | null }>
}

export async function loadSuggestionContext(): Promise<SuggestionContext> {
  const [byName, products] = await Promise.all([
    kommoFieldKeysByName(),
    prisma.product.findMany({ where: { active: true }, select: { id: true, nome: true, preco: true }, orderBy: { id: 'asc' } }),
  ])
  const productsByName = new Map<string, { id: number; preco: number | null }>()
  for (const p of products) {
    const k = p.nome.trim().toLowerCase()
    if (!productsByName.has(k)) productsByName.set(k, { id: p.id, preco: p.preco != null ? Number(p.preco) : null })
  }
  return { byName, productsByName }
}

/** Primeiro valor não-vazio entre as chaves candidatas. */
function pick(cf: Record<string, any>, keys: string[] | undefined): any {
  for (const k of keys ?? []) {
    const v = cf[k]
    if (v !== null && v !== undefined && v !== '') return Array.isArray(v) ? v[0] : v
  }
  return null
}

function toNumber(v: any): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(String(v).replace(/[^\d.,-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

/**
 * Extrai o número de parcelas de um texto livre. O campo da Kommo é usado de
 * formas diferentes pela equipe — "12x", "12", "186,25 12X" (valor da parcela +
 * quantidade), "Até 12x no cartão" —, então a forma "<n>x" tem prioridade sobre
 * um número solto. Valores fora de 1..120 são valor em reais, não parcela, e
 * caem para condição de pagamento livre.
 */
function parseParcelas(v: any): number | null {
  if (v === null || v === undefined) return null
  const s = String(v)
  const comX = s.match(/(\d{1,3})\s*[xX]/)
  const cand = comX ? comX[1] : (s.match(/^\s*(\d{1,3})\s*$/)?.[1] ?? null)
  if (!cand) return null
  const n = parseInt(cand, 10)
  return Number.isFinite(n) && n > 0 && n <= 120 ? n : null
}

/** Texto livre da Kommo → enum do módulo (pix | cartao | boleto | dinheiro). */
function parseFormaPagamento(v: any): string | null {
  const s = String(v ?? '').toLowerCase()
  if (!s) return null
  if (s.includes('pix')) return 'pix'
  if (s.includes('cart') || s.includes('credito') || s.includes('crédito') || s.includes('debito') || s.includes('débito')) return 'cartao'
  if (s.includes('boleto') || s.includes('carn')) return 'boleto'
  if (s.includes('dinheiro') || s.includes('espécie') || s.includes('especie')) return 'dinheiro'
  return null
}

/**
 * Monta a sugestão a partir dos custom fields de um lead já carregado. Usado
 * tanto pelo endpoint (1 lead) quanto pelo import de negociações fechadas (N).
 */
export function buildSuggestionFromFields(cf: Record<string, any>, ctx: SuggestionContext): NegotiationSuggestion | null {
  if (!cf || Object.keys(cf).length === 0) return null
  const { byName, productsByName } = ctx

  // ── Curso → item da proposta ──
  const cursoKeys = byName.get('curso de interesse 1') ?? []
  const curso = pick(cf, cursoKeys)
  const items: NegotiationSuggestionItem[] = []
  if (curso) {
    const nome = String(curso).substring(0, 191)
    // Preço: o do catálogo local (fonte da verdade hoje) e, se o produto não
    // existir, o valor que o import derivou do catálogo da Kommo.
    const product = productsByName.get(nome.trim().toLowerCase())
    const precoUnit = product?.preco != null ? product.preco : (toNumber(cf[CF_CURSO_VALOR]) ?? 0)
    items.push({ productId: product?.id ?? null, nome, quantidade: 1, precoUnit, descontoItem: 0 })
  }

  // ── Condições comerciais ──
  const pagamentoForma = parseFormaPagamento(pick(cf, byName.get('forma de pagamento')))
  const parcelasRaw = pick(cf, byName.get('parcelamento'))
  const parcelas = parseParcelas(parcelasRaw)
  const descValor = toNumber(pick(cf, byName.get('valor do desconto (r$)')))
  const descPercent = toNumber(pick(cf, byName.get('desconto (%)')))

  let descontoTipo: 'valor' | 'percent' | null = null
  let descontoValor: number | null = null
  if (descValor != null && descValor > 0) { descontoTipo = 'valor'; descontoValor = descValor }
  else if (descPercent != null && descPercent > 0) { descontoTipo = 'percent'; descontoValor = descPercent }

  // Parcelamento que não virou número (ex: "entrada + 3x") vira condição livre,
  // para o operador não perder o combinado.
  const condicaoPagamento = parcelasRaw && parcelas == null ? String(parcelasRaw).substring(0, 500) : null

  const temAlgo = items.length > 0 || pagamentoForma || parcelas || descontoValor || condicaoPagamento
  if (!temAlgo) return null

  return {
    titulo: items.length > 0 ? `Proposta — ${items[0].nome}`.substring(0, 191) : 'Proposta',
    items,
    pagamentoForma,
    parcelas,
    descontoTipo,
    descontoValor,
    condicaoPagamento,
    origem: 'kommo',
  }
}

/**
 * Rascunho sugerido para um lead. Devolve null quando não há nada de comercial
 * a sugerir (o operador começa do zero, como antes).
 */
export async function buildNegotiationSuggestion(leadId: number): Promise<NegotiationSuggestion | null> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { customFields: true } })
  if (!lead) return null
  const ctx = await loadSuggestionContext()
  return buildSuggestionFromFields(((lead.customFields as any) || {}) as Record<string, any>, ctx)
}
