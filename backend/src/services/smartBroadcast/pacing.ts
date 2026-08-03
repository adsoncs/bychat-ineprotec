// src/services/smartBroadcast/pacing.ts
//
// Ritmo de envio. É a peça que separa este módulo do disparo pela Cloud API:
// lá o limitador existe para não estourar cota; aqui ele existe para o padrão de
// envio não parecer uma máquina.
//
// Três decisões que valem explicação:
//
// 1. O intervalo é sorteado de uma LOG-NORMAL truncada, não de uma uniforme.
//    Pessoa real manda várias mensagens em sequência rápida e de vez em quando
//    some por alguns minutos — a distribuição tem cauda longa à direita. Uniforme
//    entre 40s e 180s produz média cravada em 110s e desvio pequeno, que é
//    justamente o tipo de regularidade que denuncia automação.
//
// 2. O trabalho acontece em SESSÕES. A cada ~20 envios entra uma pausa longa
//    ("foi almoçar", "entrou em reunião"). Sem isso, mesmo com intervalo
//    irregular, o número envia 12 horas seguidas sem parar — coisa que nenhum
//    operador humano faz.
//
// 3. Nada é enviado fora da JANELA configurada, e o início de cada dia leva um
//    atraso aleatório de até ~35 min. Começar todo dia 09:00:00 em ponto é
//    assinatura de robô tão clara quanto o intervalo fixo.
//
// O resultado é uma lista de horários (`plannedAt`) que fica PERSISTIDA por
// destinatário. A agenda é auditável ("por que essa mensagem sai 14:37?"),
// sobrevive a restart do backend e permite mostrar ao usuário, antes de disparar,
// exatamente quando a campanha vai começar e terminar.

export interface PacingConfig {
  /** Menor intervalo entre dois envios do MESMO número (ms). */
  minDelayMs: number
  /** Maior intervalo — o sorteio é truncado aqui. */
  maxDelayMs: number
  /** Quantos envios até a pausa longa (varia ±25% a cada sessão). */
  sessionSize: number
  /** Duração da pausa longa (ms, varia ±35%). */
  sessionBreakMs: number
  typingEnabled: boolean
  readReceipts: boolean
}

export interface WindowConfig {
  /** Dias da semana permitidos (0=domingo … 6=sábado). */
  days: number[]
  /** "09:00" — início da janela, hora local do timezone. */
  from: string
  /** "18:00" — fim da janela. */
  to: string
  timezone: string
}

export const DEFAULT_PACING: PacingConfig = {
  minDelayMs: 40_000,
  maxDelayMs: 180_000,
  sessionSize: 20,
  sessionBreakMs: 600_000,
  typingEnabled: true,
  readReceipts: true,
}

export const DEFAULT_WINDOW: WindowConfig = {
  days: [1, 2, 3, 4, 5],
  from: '09:00',
  to: '18:00',
  timezone: 'America/Sao_Paulo',
}

// ─── Aleatoriedade ──────────────────────────────────────

/** Normal padrão (Box-Muller). */
function gaussian(): number {
  let u = 0
  let v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/** Variação percentual simétrica: jitter(1000, 0.25) → 750..1250. */
export function jitter(base: number, pct: number): number {
  return Math.round(base * (1 + (Math.random() * 2 - 1) * pct))
}

/**
 * Intervalo entre dois envios. Log-normal com mediana perto do primeiro terço da
 * faixa: a maioria dos intervalos fica curta, com algumas esperas bem longas —
 * que é o formato real de quem está conversando e faz outras coisas no meio.
 */
export function sampleDelayMs(cfg: PacingConfig): number {
  const min = Math.max(1_000, cfg.minDelayMs)
  const max = Math.max(min + 1_000, cfg.maxDelayMs)
  const median = min + (max - min) * 0.3
  // Reamostra em vez de aparar nos extremos: com clamp, ~1 em cada 6 intervalos
  // caía EXATAMENTE no mínimo ou no máximo, criando dois valores repetidos com
  // frequência alta — justamente o tipo de regularidade que se quer evitar.
  for (let i = 0; i < 12; i++) {
    const value = median * Math.exp(0.55 * gaussian())
    if (value >= min && value <= max) return Math.round(value)
  }
  return Math.round(min + Math.random() * (max - min))
}

// ─── Timezone ───────────────────────────────────────────
// Sem dependência externa: Intl resolve o offset do timezone no instante dado.
// (O Brasil não usa horário de verão desde 2019, mas o cálculo abaixo continua
// correto se voltar, porque o offset é consultado por instante.)

interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  weekday: number
}

function zonedParts(date: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short',
    hour12: false,
  })
  const parts: Record<string, string> = {}
  for (const p of fmt.formatToParts(date)) parts[p.type] = p.value
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour === '24' ? '0' : parts.hour),
    minute: Number(parts.minute),
    weekday: weekdays[parts.weekday ?? 'Mon'] ?? 1,
  }
}

/** Diferença (ms) entre a hora local do timezone e o UTC, no instante dado. */
function tzOffsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, date.getUTCSeconds())
  return asUtc - Math.floor(date.getTime() / 60_000) * 60_000
}

/** Constrói o instante UTC correspondente a uma data/hora LOCAL do timezone. */
function fromZoned(y: number, m: number, d: number, hh: number, mm: number, timeZone: string): Date {
  const guess = Date.UTC(y, m - 1, d, hh, mm)
  const off = tzOffsetMs(new Date(guess), timeZone)
  return new Date(guess - off)
}

function parseHm(hm: string, fallback: [number, number]): [number, number] {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm ?? '')
  if (!m) return fallback
  const h = Math.min(23, Math.max(0, Number(m[1])))
  const mi = Math.min(59, Math.max(0, Number(m[2])))
  return [h, mi]
}

// ─── Janela ─────────────────────────────────────────────

/** O instante cai dentro da janela (dia da semana + faixa de horário)? */
export function isInsideWindow(at: Date, win: WindowConfig): boolean {
  const p = zonedParts(at, win.timezone)
  if (!win.days.includes(p.weekday)) return false
  const [fh, fm] = parseHm(win.from, [9, 0])
  const [th, tm] = parseHm(win.to, [18, 0])
  const cur = p.hour * 60 + p.minute
  return cur >= fh * 60 + fm && cur < th * 60 + tm
}

/**
 * Próximo instante válido a partir de `at`. Se já está dentro da janela, devolve
 * `at`. Se não, joga para a abertura do próximo dia permitido, somando um atraso
 * aleatório de 0–35 min (ninguém começa a trabalhar no segundo exato).
 */
export function nextWindowStart(at: Date, win: WindowConfig): Date {
  if (isInsideWindow(at, win)) return at
  return openingAfter(at, win, false)
}

/**
 * Abertura do PRÓXIMO dia permitido, ignorando o que resta de hoje. É o que se
 * usa quando o teto diário do número foi atingido: não basta "esperar um pouco",
 * o número só volta a falar amanhã.
 */
export function nextDayOpening(at: Date, win: WindowConfig): Date {
  return openingAfter(at, win, true)
}

/**
 * Abertura da janela a partir de `at`. Com `skipToday`, começa a procurar do dia
 * seguinte. O horário devolvido leva um atraso aleatório de até 35 min — dia de
 * trabalho que começa 09:00:00 cravado é assinatura de robô.
 */
function openingAfter(at: Date, win: WindowConfig, skipToday: boolean): Date {
  const [fh, fm] = parseHm(win.from, [9, 0])
  const base = zonedParts(at, win.timezone)
  const nowMinutes = base.hour * 60 + base.minute
  const openMinutes = fh * 60 + fm

  for (let offset = 0; offset < 14; offset++) {
    // Meio-dia como âncora evita que somar dias esbarre em transição de fuso.
    const probe = new Date(fromZoned(base.year, base.month, base.day, 12, 0, win.timezone).getTime() + offset * 24 * 3600_000)
    const p = zonedParts(probe, win.timezone)
    if (!win.days.includes(p.weekday)) continue
    if (offset === 0 && (skipToday || nowMinutes >= openMinutes)) continue
    const opening = fromZoned(p.year, p.month, p.day, fh, fm, win.timezone)
    return new Date(opening.getTime() + Math.floor(Math.random() * 35 * 60_000))
  }
  // Configuração sem nenhum dia permitido: devolve o próprio instante para não
  // travar o planejamento (a validação da campanha já barra esse caso).
  return at
}

/** Início do dia local (00:00) do instante dado — chave para agrupar por dia. */
export function localDayKey(at: Date, timeZone: string): string {
  const p = zonedParts(at, timeZone)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

// ─── Agenda ─────────────────────────────────────────────

export interface PlanOptions {
  /** Quantos envios planejar para ESTE número. */
  count: number
  /** Não começar antes disto (agendamento da campanha). */
  startFrom: Date
  pacing: PacingConfig
  window: WindowConfig
  /**
   * Teto de envios por dia. Aceita um número fixo ou a escada de aquecimento
   * (curva[0] no primeiro dia da campanha, curva[1] no segundo, …). Atingido o
   * teto, o restante escorrega para o dia seguinte.
   */
  dailyCap: number | number[]
}

/**
 * Gera os horários de envio de UM número. Cada número tem agenda própria e
 * independente — dois números atendem em paralelo, como duas pessoas fariam.
 */
export function planSchedule(opts: PlanOptions): Date[] {
  const { count, pacing, window: win } = opts
  const out: Date[] = []
  if (count <= 0) return out

  const capFor = (dayIndex: number): number => {
    if (Array.isArray(opts.dailyCap)) {
      if (opts.dailyCap.length === 0) return Number.MAX_SAFE_INTEGER
      return opts.dailyCap[Math.min(dayIndex, opts.dailyCap.length - 1)] ?? 1
    }
    return opts.dailyCap > 0 ? opts.dailyCap : Number.MAX_SAFE_INTEGER
  }

  let cursor = nextWindowStart(new Date(Math.max(Date.now(), opts.startFrom.getTime())), win)
  let currentDay = localDayKey(cursor, win.timezone)
  let dayIndex = 0
  let sentToday = 0
  let sessionLeft = Math.max(1, jitter(pacing.sessionSize, 0.25))

  for (let i = 0; i < count; i++) {
    // Teto do dia batido → só no próximo dia permitido. (Somar horas não serve:
    // se o teto acaba de manhã, o cursor cairia de volta na janela de hoje.)
    if (sentToday >= capFor(dayIndex)) {
      cursor = nextDayOpening(cursor, win)
      currentDay = localDayKey(cursor, win.timezone)
      dayIndex++
      sentToday = 0
      sessionLeft = Math.max(1, jitter(pacing.sessionSize, 0.25))
    }

    // Saiu da janela (fim de expediente) → próxima abertura válida.
    if (!isInsideWindow(cursor, win)) {
      cursor = nextWindowStart(cursor, win)
      const key = localDayKey(cursor, win.timezone)
      if (key !== currentDay) {
        currentDay = key
        dayIndex++
        sentToday = 0
      }
      sessionLeft = Math.max(1, jitter(pacing.sessionSize, 0.25))
    }

    out.push(new Date(cursor.getTime()))
    sentToday++
    sessionLeft--

    // Intervalo até o próximo — e, de tempos em tempos, a pausa longa.
    let step = sampleDelayMs(pacing)
    if (sessionLeft <= 0) {
      step += Math.max(60_000, jitter(pacing.sessionBreakMs, 0.35))
      sessionLeft = Math.max(1, jitter(pacing.sessionSize, 0.25))
    }
    cursor = new Date(cursor.getTime() + step)
  }

  return out
}

/** Resumo legível de uma agenda — alimenta o "Simular" da tela. */
export function summarizeSchedule(dates: Date[], timeZone: string): {
  first: Date | null
  last: Date | null
  perDay: Array<{ day: string; count: number }>
} {
  if (!dates.length) return { first: null, last: null, perDay: [] }
  const byDay = new Map<string, number>()
  for (const d of dates) {
    const k = localDayKey(d, timeZone)
    byDay.set(k, (byDay.get(k) ?? 0) + 1)
  }
  return {
    first: dates[0] ?? null,
    last: dates[dates.length - 1] ?? null,
    perDay: [...byDay.entries()].map(([day, count]) => ({ day, count })).sort((a, b) => a.day.localeCompare(b.day)),
  }
}
