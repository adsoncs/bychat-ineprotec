// src/lib/aiKeys.ts
//
// Resolve API keys de IA (Anthropic / OpenAI) do banco primeiro, com fallback
// pra `process.env`. Usado por todos os serviços que chamam IA.
//
// Onde está salvo:
//   - Configurações > APIs / Tokens (UI admin) → grava em `Setting`:
//     - `ai.anthropic_api_key`
//     - `ai.openai_api_key`
//   - .env: `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` (fallback / dev local)
//
// Cache de 60s pra evitar 1 query a cada classify/scoring. Ao salvar uma key
// nova pela UI, leva até 60s pra propagar — aceitável (UI já avisa).

import { prisma } from './prisma.js'

interface CacheEntry {
  value: string | null
  expiresAt: number
}

const TTL_MS = 60_000
const cache = new Map<string, CacheEntry>()

async function readSetting(key: string): Promise<string | null> {
  const now = Date.now()
  const cached = cache.get(key)
  if (cached && cached.expiresAt > now) return cached.value

  let value: string | null = null
  try {
    const row = await prisma.setting.findUnique({ where: { key } })
    if (row && row.value !== null && row.value !== undefined) {
      // Setting.value é Json — pode vir como string ("xxx"), número, ou objeto.
      // O writer salva como JSON.stringify(string) que vira `"xxx"`. Aspas externas
      // são removidas. Aceitamos string direta também.
      const raw = typeof row.value === 'string' ? row.value : String(row.value)
      const trimmed = raw.replace(/^"|"$/g, '').trim()
      if (trimmed) value = trimmed
    }
  } catch {
    // DB indisponível por algum motivo — cai pro env.
  }

  cache.set(key, { value, expiresAt: now + TTL_MS })
  return value
}

/** Anthropic key — Setting `ai.anthropic_api_key` → env `ANTHROPIC_API_KEY` → null. */
export async function getAnthropicKey(): Promise<string | null> {
  const fromDb = await readSetting('ai.anthropic_api_key')
  if (fromDb) return fromDb
  return process.env.ANTHROPIC_API_KEY || null
}

/** OpenAI key — Setting `ai.openai_api_key` → env `OPENAI_API_KEY` → null. */
export async function getOpenAiKey(): Promise<string | null> {
  const fromDb = await readSetting('ai.openai_api_key')
  if (fromDb) return fromDb
  return process.env.OPENAI_API_KEY || null
}

export type AiProvider = 'anthropic' | 'openai'

/** Provider preferencial (Setting `ai.primary_provider` → 'anthropic'). */
export async function getPrimaryProvider(): Promise<AiProvider> {
  const v = await readSetting('ai.primary_provider')
  return v === 'openai' ? 'openai' : 'anthropic'
}

/** Modelo Anthropic configurado pelo admin → env override → default. */
export async function getAnthropicModel(): Promise<string> {
  const fromDb = await readSetting('ai.anthropic_model')
  if (fromDb) return fromDb
  return process.env.SALES_AI_MODEL_ANTHROPIC || 'claude-sonnet-4-6'
}

/** Modelo OpenAI configurado pelo admin → env override → default. */
export async function getOpenAiModel(): Promise<string> {
  const fromDb = await readSetting('ai.openai_model')
  if (fromDb) return fromDb
  return process.env.SALES_AI_MODEL_OPENAI || 'gpt-4o'
}

/** Limpa o cache (testes, ou após salvar key nova se quiser propagação imediata). */
export function clearAiKeysCache(): void {
  cache.clear()
}
