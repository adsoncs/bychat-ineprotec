// src/services/clinicaExperts/client.ts
//
// Cliente HTTP da API da Clinica Experts.
//
// Duas coisas mandam no desenho deste arquivo:
//
//  1. **120 requisições por minuto (2 por segundo).** Estourar devolve 429 e
//     não há header dizendo quanto sobrou — só o erro. Por isso cada chamada
//     passa por uma fila serializada com espaçamento mínimo: é mais barato
//     esperar 500 ms do que descobrir o teto no meio de um agendamento.
//
//  2. **`/available-hours` responde UM dia de UM profissional por vez.** Montar
//     um calendário de 60 dias seriam 60 chamadas por profissional — daí o
//     cache curto em memória e o carregamento sob demanda (ver `ocupacao.ts`).
//
// Nada aqui conhece agenda nem lead: é só transporte.

import { getConfig } from './config.js'

const BASE_URL = 'https://api.clinicaexperts.com.br/api/v1'

/** Espaçamento entre chamadas. O teto é 2/s; 600 ms deixa folga para o relógio
 *  do servidor deles não contar duas no mesmo segundo. */
const INTERVALO_MS = 600

/** Tentativas em erro que passa (429 e 5xx). Erro de dado (4xx) não repete. */
const TENTATIVAS = 3

const TIMEOUT_MS = 20_000

export class ClinicaExpertsError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly corpo?: unknown,
  ) {
    super(message)
    this.name = 'ClinicaExpertsError'
  }
}

// ── Fila serializada ────────────────────────────────────────────────────────
// Uma corrente de promessas: cada chamada espera a anterior terminar e o
// intervalo mínimo passar. Simples e suficiente — o volume aqui é de agenda,
// não de disparo em massa.

let ultima = Promise.resolve()
let ultimoEnvioEm = 0

function naFila<T>(fn: () => Promise<T>): Promise<T> {
  const proxima = ultima.then(async () => {
    const espera = ultimoEnvioEm + INTERVALO_MS - Date.now()
    if (espera > 0) await new Promise((r) => setTimeout(r, espera))
    ultimoEnvioEm = Date.now()
    return fn()
  })
  // A corrente não pode quebrar quando uma chamada falha, senão toda chamada
  // seguinte herda a rejeição e a integração morre até o restart.
  ultima = proxima.then(() => undefined, () => undefined)
  return proxima
}

// ── Chamada ─────────────────────────────────────────────────────────────────

export interface OpcoesChamada {
  metodo?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  query?: Record<string, string | number | boolean | undefined | null>
  corpo?: unknown
}

function montarUrl(caminho: string, query?: OpcoesChamada['query']): string {
  const url = new URL(BASE_URL + caminho)
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v === undefined || v === null || v === '') continue
    // Booleano vai como 1/0. O validador deles (Laravel `boolean`) recusa a
    // string "true" — `?active=true` responde 422 "O campo active deve conter
    // o valor verdadeiro ou falso", que parece erro nosso e não é.
    url.searchParams.set(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v))
  }
  return url.toString()
}

/**
 * Faz uma chamada autenticada. Lança `ClinicaExpertsError` com o status e o
 * corpo — quem chama decide o que fazer; não engolimos erro aqui porque uma
 * falha ao espelhar um agendamento precisa aparecer no log com a causa.
 */
export async function chamar<T = unknown>(caminho: string, opts: OpcoesChamada = {}): Promise<T> {
  const cfg = await getConfig()
  if (!cfg.token) throw new ClinicaExpertsError('Integração sem token configurado', 0)

  const url = montarUrl(caminho, opts.query)
  const metodo = opts.metodo ?? 'GET'

  let ultimoErro: ClinicaExpertsError | null = null

  for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
    const resposta = await naFila(async () => {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
      try {
        const r = await fetch(url, {
          method: metodo,
          headers: {
            Authorization: `Bearer ${cfg.token}`,
            Accept: 'application/json',
            ...(opts.corpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(opts.corpo !== undefined ? { body: JSON.stringify(opts.corpo) } : {}),
          signal: ctrl.signal,
        })
        const texto = await r.text()
        let corpo: unknown = null
        try { corpo = texto ? JSON.parse(texto) : null } catch { corpo = texto }
        return { ok: r.ok, status: r.status, corpo }
      } catch (e: any) {
        // Timeout/rede: tratado como 0 para entrar na regra de repetição.
        return { ok: false, status: 0, corpo: e?.name === 'AbortError' ? 'timeout' : String(e?.message ?? e) }
      } finally {
        clearTimeout(timer)
      }
    })

    if (resposta.ok) return resposta.corpo as T

    const msg = mensagemDoErro(resposta.corpo, resposta.status)
    ultimoErro = new ClinicaExpertsError(msg, resposta.status, resposta.corpo)

    // 429 e 5xx (e falha de rede) valem outra tentativa; 4xx de dado, não —
    // repetir um CPF inválido três vezes só gasta a cota.
    const repetivel = resposta.status === 429 || resposta.status >= 500 || resposta.status === 0
    if (!repetivel || tentativa === TENTATIVAS) break

    // Recuo progressivo. No 429 começa mais alto: a janela deles é de 1 minuto.
    const base = resposta.status === 429 ? 5_000 : 1_000
    await new Promise((r) => setTimeout(r, base * tentativa))
  }

  throw ultimoErro ?? new ClinicaExpertsError('Falha desconhecida', 0)
}

/** Extrai a frase mais útil do corpo de erro (a API usa `message` + `errors`). */
function mensagemDoErro(corpo: unknown, status: number): string {
  if (corpo && typeof corpo === 'object') {
    const c = corpo as any
    if (typeof c.message === 'string' && c.message) {
      const detalhes = c.errors && typeof c.errors === 'object'
        ? Object.values(c.errors).flat().filter((x) => typeof x === 'string').join('; ')
        : ''
      return detalhes && detalhes !== c.message ? `${c.message} — ${detalhes}` : c.message
    }
  }
  if (typeof corpo === 'string' && corpo.trim()) return corpo.slice(0, 300)
  if (status === 429) return 'Limite de requisições da Clinica Experts atingido (120/min)'
  if (status === 401 || status === 403) return 'Token da Clinica Experts recusado — gere outro na aba Integrações'
  if (status === 0) return 'Clinica Experts não respondeu'
  return `Clinica Experts respondeu ${status}`
}

// ── Formatos de resposta ────────────────────────────────────────────────────

/** Envelope paginado: `{ data, meta }`. `data` vem como objeto quando é um
 *  registro só — normalizado para lista aqui, senão cada chamador reinventa. */
export interface Pagina<T> {
  itens: T[]
  meta: { page: number; per_page: number; last_page: number; of: number } | null
}

export function normalizarPagina<T>(resposta: any): Pagina<T> {
  const d = resposta?.data
  const itens: T[] = Array.isArray(d) ? d : d ? [d] : []
  return { itens, meta: resposta?.meta ?? null }
}
