// src/lib/consumo.ts
//
// Consumo medido — base da volumetria e do repasse ao cliente (o preço do
// repasse mora na loja central; aqui é só o que de fato consumimos).
//
// IA: toda chamada à Anthropic/OpenAI passa a resposta para `registrarUsoIA`
// logo depois de ler o JSON. O modelo gravado é o que a API devolve (o que
// rodou de verdade), não o pedido. Nunca lança e nunca atrasa a resposta.

import { prisma } from './prisma.js'

export type ProvedorIA = 'anthropic' | 'openai'

/** USD por 1 milhão de tokens: entrada, saída, escrita e leitura de cache. */
export interface PrecoIA { entrada: number; saida: number; cacheEscrita: number; cacheLeitura: number }

/**
 * Preço de tabela dos provedores (USD / 1M tokens). Prefixo mais longo vence
 * ("claude-haiku-4-5" antes de "claude-haiku"). Pode ser sobrescrito sem
 * deploy pela Setting `consumo.precos_ia` = { "<prefixo>": { entrada, saida,
 * cacheEscrita, cacheLeitura } }. Modelo sem preço grava custo null — o painel
 * avisa.
 */
const PRECOS_PADRAO: Record<string, PrecoIA> = {
  // Anthropic
  'claude-opus-4-5': { entrada: 5, saida: 25, cacheEscrita: 6.25, cacheLeitura: 0.5 },
  'claude-opus-4-6': { entrada: 5, saida: 25, cacheEscrita: 6.25, cacheLeitura: 0.5 },
  'claude-opus-4': { entrada: 15, saida: 75, cacheEscrita: 18.75, cacheLeitura: 1.5 },
  'claude-sonnet-4': { entrada: 3, saida: 15, cacheEscrita: 3.75, cacheLeitura: 0.3 },
  'claude-3-7-sonnet': { entrada: 3, saida: 15, cacheEscrita: 3.75, cacheLeitura: 0.3 },
  'claude-3-5-sonnet': { entrada: 3, saida: 15, cacheEscrita: 3.75, cacheLeitura: 0.3 },
  'claude-haiku-4-5': { entrada: 1, saida: 5, cacheEscrita: 1.25, cacheLeitura: 0.1 },
  'claude-3-5-haiku': { entrada: 0.8, saida: 4, cacheEscrita: 1, cacheLeitura: 0.08 },
  'claude-3-haiku': { entrada: 0.25, saida: 1.25, cacheEscrita: 0.3, cacheLeitura: 0.03 },
  // OpenAI (cache: só leitura; escrita não é cobrada à parte)
  'gpt-4o-mini': { entrada: 0.15, saida: 0.6, cacheEscrita: 0, cacheLeitura: 0.075 },
  'gpt-4o': { entrada: 2.5, saida: 10, cacheEscrita: 0, cacheLeitura: 1.25 },
  'gpt-4.1-nano': { entrada: 0.1, saida: 0.4, cacheEscrita: 0, cacheLeitura: 0.025 },
  'gpt-4.1-mini': { entrada: 0.4, saida: 1.6, cacheEscrita: 0, cacheLeitura: 0.1 },
  'gpt-4.1': { entrada: 2, saida: 8, cacheEscrita: 0, cacheLeitura: 0.5 },
  'gpt-5-nano': { entrada: 0.05, saida: 0.4, cacheEscrita: 0, cacheLeitura: 0.005 },
  'gpt-5-mini': { entrada: 0.25, saida: 2, cacheEscrita: 0, cacheLeitura: 0.025 },
  'gpt-5': { entrada: 1.25, saida: 10, cacheEscrita: 0, cacheLeitura: 0.125 },
  'o4-mini': { entrada: 1.1, saida: 4.4, cacheEscrita: 0, cacheLeitura: 0.275 },
}

let cachePrecos: { em: number; tabela: Record<string, PrecoIA> } | null = null

export async function tabelaDePrecosIA(): Promise<Record<string, PrecoIA>> {
  if (cachePrecos && Date.now() - cachePrecos.em < 60_000) return cachePrecos.tabela
  let extra: Record<string, PrecoIA> = {}
  try {
    const s = await prisma.setting.findUnique({ where: { key: 'consumo.precos_ia' }, select: { value: true } })
    const v = typeof s?.value === 'string' ? JSON.parse(s.value) : s?.value
    if (v && typeof v === 'object') extra = v as Record<string, PrecoIA>
  } catch { /* sem override */ }
  const tabela = { ...PRECOS_PADRAO, ...extra }
  cachePrecos = { em: Date.now(), tabela }
  return tabela
}

export function precoDoModelo(tabela: Record<string, PrecoIA>, modelo: string): PrecoIA | null {
  const m = modelo.toLowerCase()
  let melhor: string | null = null
  for (const p of Object.keys(tabela)) if (m.startsWith(p) && (!melhor || p.length > melhor.length)) melhor = p
  return melhor ? tabela[melhor] ?? null : null
}

/** Tokens de uma resposta, nos dois formatos de API. */
export function tokensDaResposta(provedor: ProvedorIA, resposta: any): { entrada: number; saida: number; cacheEscrita: number; cacheLeitura: number } | null {
  const u = resposta?.usage
  if (!u) return null
  const n = (x: unknown) => (Number.isFinite(Number(x)) ? Math.max(0, Math.round(Number(x))) : 0)
  if (provedor === 'anthropic') {
    // input_tokens já vem SEM o cache; escrita e leitura vêm à parte.
    return { entrada: n(u.input_tokens), saida: n(u.output_tokens), cacheEscrita: n(u.cache_creation_input_tokens), cacheLeitura: n(u.cache_read_input_tokens) }
  }
  // OpenAI: prompt_tokens INCLUI o que veio do cache.
  const cache = n(u.prompt_tokens_details?.cached_tokens)
  return { entrada: Math.max(0, n(u.prompt_tokens) - cache), saida: n(u.completion_tokens), cacheEscrita: 0, cacheLeitura: cache }
}

/**
 * Registra o uso de uma chamada de IA. Chame logo depois de ler o JSON da
 * resposta: `registrarUsoIA('chatbot', 'anthropic', data)`. Não espera, não lança.
 */
export function registrarUsoIA(funcionalidade: string, provedor: ProvedorIA, resposta: unknown, extra?: { leadId?: number | null }): void {
  void (async () => {
    const t = tokensDaResposta(provedor, resposta)
    if (!t) return
    const modelo = String((resposta as any)?.model ?? 'desconhecido').slice(0, 100)
    const preco = precoDoModelo(await tabelaDePrecosIA(), modelo)
    const custo = preco
      ? (t.entrada * preco.entrada + t.saida * preco.saida + t.cacheEscrita * preco.cacheEscrita + t.cacheLeitura * preco.cacheLeitura) / 1_000_000
      : null
    await prisma.consumoEvento.create({
      data: {
        fonte: 'ia', provedor, item: modelo, funcionalidade: funcionalidade.slice(0, 60),
        ...t, quantidade: t.entrada + t.saida + t.cacheEscrita + t.cacheLeitura, unidade: 'token',
        custoUsd: custo, leadId: extra?.leadId ?? null,
      },
    })
  })().catch((e) => console.warn('[consumo] falha ao registrar uso de IA:', (e as Error).message))
}
