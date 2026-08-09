/**
 * Período de um relatório a partir da querystring.
 *
 * As telas de indicador nasceram cada uma com o seu parâmetro (`days=30`,
 * `range=30d`, `from`/`to`), e só as últimas aceitavam intervalo livre — trocar
 * para "Personalizado" numa tela antiga simplesmente não fazia nada. Este
 * resolvedor entende os três e é a conta única de todas elas.
 *
 * Precedência: `from`/`to` (ou `dateFrom`/`dateTo`) > `range` (7d/30d/90d) >
 * `days` > o padrão da rota. Datas invertidas são corrigidas em vez de
 * rejeitadas — quem digitou na ordem errada vê o período que quis, não uma tela
 * vazia.
 */
export interface ResolvedPeriod {
  from: Date
  to: Date
  /** dias inteiros cobertos (>= 1) — para séries diárias e rótulos */
  days: number
}

const DAY = 86_400_000

function parseDay(v: unknown, endOfDay: boolean): Date | null {
  const s = typeof v === 'string' ? v.trim() : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(`${s}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

export function resolvePeriod(query: any, defaultDays = 30): ResolvedPeriod {
  let from = parseDay(query?.from ?? query?.dateFrom, false)
  let to = parseDay(query?.to ?? query?.dateTo, true)
  if (from && to && from > to) { const swap = from; from = to; to = swap }

  const range = typeof query?.range === 'string' ? query.range : ''
  const presetDays = range === '7d' ? 7 : range === '30d' ? 30 : range === '90d' ? 90 : null
  const rawDays = Number(query?.days)
  // Teto de 5 anos: `days` vem da URL e uma janela absurda varreria a tabela toda.
  const queryDays = Number.isFinite(rawDays) && rawDays > 0 ? Math.min(Math.floor(rawDays), 1825) : null

  const end = to ?? new Date()
  const start = from ?? new Date(end.getTime() - (presetDays ?? queryDays ?? defaultDays) * DAY)
  return {
    from: start,
    to: end,
    days: Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY)),
  }
}
