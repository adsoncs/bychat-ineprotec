// src/services/apifyClient.ts
//
// Cliente mínimo da API do Apify, usado pelos coletores do Radar de Reputação
// (reviews do Google Maps, Reclame Aqui). Só o necessário: rodar um actor,
// esperar terminar e ler o dataset.
//
// CUSTO: a conta é FREE (US$ 5/mês). Todo coletor que chama daqui deve impor
// teto de itens e é obrigado a passar por checkCredits() antes de disparar —
// estourar o crédito não falha "de leve", trava a conta inteira até o mês virar.

const API = 'https://api.apify.com/v2'
const DEFAULT_TIMEOUT_MS = 5 * 60_000

export class ApifyError extends Error {}

function token(): string {
  const t = process.env.APIFY_TOKEN
  if (!t) throw new ApifyError('APIFY_TOKEN não configurado no .env')
  return t
}

async function call<T>(path: string, init: RequestInit = {}, timeoutMs = 60_000): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new ApifyError(`Apify ${path} → HTTP ${res.status} ${body.slice(0, 300)}`)
  }
  return (await res.json()) as T
}

export interface ApifyAccount {
  username: string
  plan: string | null
  monthlyCreditsUsd: number | null
  currentSpendUsd: number | null
  remainingUsd: number | null
}

/** Saldo antes de gastar. Sem isso, o coletor descobre o limite estourando-o. */
export async function checkCredits(): Promise<ApifyAccount> {
  const me = await call<any>('/users/me')
  const d = me?.data || {}
  const plan = d.plan || {}
  const monthly = typeof plan.monthlyUsageCreditsUsd === 'number' ? plan.monthlyUsageCreditsUsd : null

  let spend: number | null = null
  try {
    const usage = await call<any>('/users/me/usage/monthly')
    spend = usage?.data?.totalUsageCreditsUsdAfterVolumeDiscount
      ?? usage?.data?.totalUsageCreditsUsd
      ?? null
  } catch { /* endpoint varia por plano — seguimos sem o gasto */ }

  return {
    username: d.username || '?',
    plan: plan.id || null,
    monthlyCreditsUsd: monthly,
    currentSpendUsd: typeof spend === 'number' ? Number(spend.toFixed(4)) : null,
    remainingUsd: monthly !== null && typeof spend === 'number' ? Number((monthly - spend).toFixed(4)) : null,
  }
}

export interface RunResult<T = any> {
  runId: string
  status: string
  items: T[]
  usageUsd: number | null
}

/**
 * Roda um actor e espera o resultado (run-sync-get-dataset-items).
 * `actorId` no formato "username~actor-name".
 */
export async function runActor<T = any>(
  actorId: string,
  input: Record<string, unknown>,
  opts: { timeoutMs?: number; maxItems?: number } = {},
): Promise<RunResult<T>> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const qs = new URLSearchParams({ timeout: String(Math.floor(timeoutMs / 1000)) })
  if (opts.maxItems) qs.set('maxItems', String(opts.maxItems))

  const items = await call<T[]>(
    `/acts/${actorId}/run-sync-get-dataset-items?${qs}`,
    { method: 'POST', body: JSON.stringify(input) },
    timeoutMs + 30_000,
  )

  return { runId: '', status: 'SUCCEEDED', items: Array.isArray(items) ? items : [], usageUsd: null }
}

/** Último run do actor — usado para saber quanto o run realmente custou. */
export async function lastRunUsage(actorId: string): Promise<{ usageUsd: number | null; status: string | null }> {
  try {
    const r = await call<any>(`/acts/${actorId}/runs/last`)
    const d = r?.data || {}
    return { usageUsd: typeof d.usageTotalUsd === 'number' ? Number(d.usageTotalUsd.toFixed(4)) : null, status: d.status || null }
  } catch {
    return { usageUsd: null, status: null }
  }
}
