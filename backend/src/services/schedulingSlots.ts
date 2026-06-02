// Motor de cálculo de slots disponíveis para o módulo de Agendamento.
// Fuso/DST tratados com Intl (sem dependência externa). Horários definidos no
// fuso do tipo de reunião; slots retornados em UTC (startAt/endAt ISO) + label local.

export interface WeeklyRule { weekday: number; start: string; end: string } // weekday 0=Dom..6=Sáb, "HH:mm"
export interface ExceptionRule { date: string; unavailable: boolean; startTime?: string | null; endTime?: string | null }
export interface BookingSpan { startAt: Date; endAt: Date }

export interface SlotEngineInput {
  timezone: string
  durationMin: number
  slotIncrementMin: number
  bufferBeforeMin: number
  bufferAfterMin: number
  minNoticeMin: number
  bookingWindowDays: number
  maxPerDay: number | null
  visibleSlotsPerDay: number | null
  rules: WeeklyRule[]
  exceptions: ExceptionRule[]
  bookings: BookingSpan[]
  now?: Date
  fromDate?: string // 'YYYY-MM-DD' (limite inferior opcional)
  toDate?: string   // 'YYYY-MM-DD' (limite superior opcional)
}

export interface DaySlots { date: string; weekday: number; slots: { startAt: string; endAt: string; label: string }[] }

const pad = (n: number) => String(n).padStart(2, '0')
const parseHM = (s: string): [number, number] => { const [h, m] = String(s).split(':').map((x) => parseInt(x, 10)); return [h || 0, m || 0] }

// Minutos que o fuso está à frente do UTC no instante `date`.
function tzOffsetMinutes(date: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  })
  const p: any = {}
  for (const part of dtf.formatToParts(date)) p[part.type] = part.value
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour === 24 ? 0 : +p.hour, +p.minute, +p.second)
  return Math.round((asUTC - date.getTime()) / 60000)
}

// Hora local (parede) num fuso → instante UTC. Refinado p/ bordas de DST.
function zonedToUtc(y: number, mo: number, d: number, hh: number, mm: number, tz: string): Date {
  const naive = Date.UTC(y, mo - 1, d, hh, mm, 0)
  let offset = tzOffsetMinutes(new Date(naive), tz)
  let utc = naive - offset * 60000
  offset = tzOffsetMinutes(new Date(utc), tz)
  utc = naive - offset * 60000
  return new Date(utc)
}

// Data local (Y-M-D) de um instante, no fuso.
function ymdInTz(date: Date, tz: string): { y: number; mo: number; d: number } {
  const dtf = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
  const p: any = {}
  for (const part of dtf.formatToParts(date)) p[part.type] = part.value
  return { y: +p.year, mo: +p.month, d: +p.day }
}

export function computeSlots(input: SlotEngineInput): DaySlots[] {
  const now = input.now ?? new Date()
  const tz = input.timezone || 'America/Sao_Paulo'
  const dur = input.durationMin
  const inc = Math.max(5, input.slotIncrementMin || dur)
  const bufBefore = input.bufferBeforeMin || 0
  const bufAfter = input.bufferAfterMin || 0
  const minNoticeMs = (input.minNoticeMin || 0) * 60000
  const earliest = new Date(now.getTime() + minNoticeMs)

  // Janelas ocupadas pelas reservas (com buffers aplicados aos dois lados).
  const busy = input.bookings.map((b) => ({
    s: b.startAt.getTime() - bufBefore * 60000,
    e: b.endAt.getTime() + bufAfter * 60000,
  }))
  // Reservas por data local (p/ maxPerDay).
  const bookingsByDate = new Map<string, number>()
  for (const b of input.bookings) {
    const p = ymdInTz(b.startAt, tz)
    const k = `${p.y}-${pad(p.mo)}-${pad(p.d)}`
    bookingsByDate.set(k, (bookingsByDate.get(k) || 0) + 1)
  }

  const today = ymdInTz(now, tz)
  const out: DaySlots[] = []

  for (let i = 0; i <= input.bookingWindowDays; i++) {
    // Âncora ao meio-dia UTC do dia base+i → lê a data local com segurança.
    const anchor = new Date(Date.UTC(today.y, today.mo - 1, today.d + i, 12, 0, 0))
    const p = ymdInTz(anchor, tz)
    const dateStr = `${p.y}-${pad(p.mo)}-${pad(p.d)}`
    if (input.fromDate && dateStr < input.fromDate) continue
    if (input.toDate && dateStr > input.toDate) continue

    const weekday = new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay()

    // Resolve as faixas do dia: exceção tem prioridade.
    const exc = input.exceptions.find((e) => e.date === dateStr)
    let ranges: Array<[string, string]> = []
    if (exc) {
      if (exc.unavailable) ranges = []
      else if (exc.startTime && exc.endTime) ranges = [[exc.startTime, exc.endTime]]
    } else {
      ranges = input.rules.filter((r) => r.weekday === weekday).map((r) => [r.start, r.end] as [string, string])
    }
    if (ranges.length === 0) continue

    // Teto por dia já atingido?
    const already = bookingsByDate.get(dateStr) || 0
    if (input.maxPerDay != null && already >= input.maxPerDay) continue
    const remainingDay = input.maxPerDay != null ? input.maxPerDay - already : Infinity

    const daySlots: { startAt: string; endAt: string; label: string }[] = []
    for (const [start, end] of ranges) {
      const [sh, sm] = parseHM(start)
      const [eh, em] = parseHM(end)
      let cur = sh * 60 + sm
      const endMin = eh * 60 + em
      while (cur + dur <= endMin) {
        const hh = Math.floor(cur / 60), mm = cur % 60
        const slotStart = zonedToUtc(p.y, p.mo, p.d, hh, mm, tz)
        const slotEnd = new Date(slotStart.getTime() + dur * 60000)
        cur += inc
        if (slotStart.getTime() < earliest.getTime()) continue
        // conflito com reservas (com buffers)
        const sStart = slotStart.getTime() - bufBefore * 60000
        const sEnd = slotEnd.getTime() + bufAfter * 60000
        const conflict = busy.some((b) => sStart < b.e && sEnd > b.s)
        if (conflict) continue
        daySlots.push({ startAt: slotStart.toISOString(), endAt: slotEnd.toISOString(), label: `${pad(hh)}:${pad(mm)}` })
      }
    }
    if (daySlots.length === 0) continue
    daySlots.sort((a, b) => a.startAt.localeCompare(b.startAt))
    let limited = daySlots
    if (input.visibleSlotsPerDay != null) limited = limited.slice(0, input.visibleSlotsPerDay)
    if (remainingDay !== Infinity) limited = limited.slice(0, remainingDay)
    out.push({ date: dateStr, weekday, slots: limited })
  }

  return out
}
