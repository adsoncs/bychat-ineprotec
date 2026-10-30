// src/services/clinicaExperts/tempo.ts
//
// Datas no formato que a Clinica Experts aceita.
//
// A API **recusa UTC com `Z`**. Mandar `2026-08-24T16:00:00.000Z` — que é o que
// `Date.toISOString()` produz — devolve 422:
//
//   "A data de início deve estar no formato ISO 8601: YYYY-MM-DDTHH:MM:SS±HH:MM.
//    Exemplo: 2025-03-07T14:30:00-03:00"
//
// Ou seja: ISO 8601 com offset numérico, sem milissegundos. Como o horário é
// sempre lido por uma pessoa na recepção da clínica, o offset usado é o do fuso
// da agenda (não o do servidor, que pode estar em UTC) — assim o que a clínica
// vê é a hora local do paciente.

const FUSO_PADRAO = 'America/Sao_Paulo'

/** Minutos que o fuso está à frente do UTC no instante dado (trata horário de
 *  verão sozinho, porque pergunta ao Intl no instante certo). */
function offsetMinutos(data: Date, fuso: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: fuso,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  })
  const p: Record<string, string> = {}
  for (const parte of dtf.formatToParts(data)) p[parte.type] = parte.value
  const comoUtc = Date.UTC(
    Number(p.year), Number(p.month) - 1, Number(p.day),
    Number(p.hour) === 24 ? 0 : Number(p.hour), Number(p.minute), Number(p.second),
  )
  return Math.round((comoUtc - data.getTime()) / 60000)
}

const dois = (n: number) => String(n).padStart(2, '0')

/**
 * `2026-08-24T14:30:00-03:00` — o formato exigido pela API.
 */
export function isoComOffset(data: Date, fuso: string = FUSO_PADRAO): string {
  const off = offsetMinutos(data, fuso)
  const local = new Date(data.getTime() + off * 60000)
  const sinal = off < 0 ? '-' : '+'
  const abs = Math.abs(off)
  return (
    `${local.getUTCFullYear()}-${dois(local.getUTCMonth() + 1)}-${dois(local.getUTCDate())}` +
    `T${dois(local.getUTCHours())}:${dois(local.getUTCMinutes())}:${dois(local.getUTCSeconds())}` +
    `${sinal}${dois(Math.floor(abs / 60))}:${dois(abs % 60)}`
  )
}

/** `2026-08-24` no fuso da agenda — é o que `/available-hours` espera em `date`. */
export function dataLocal(data: Date, fuso: string = FUSO_PADRAO): string {
  const off = offsetMinutos(data, fuso)
  const local = new Date(data.getTime() + off * 60000)
  return `${local.getUTCFullYear()}-${dois(local.getUTCMonth() + 1)}-${dois(local.getUTCDate())}`
}

/**
 * Começo e fim do dia, no fuso da agenda.
 *
 * A consulta de agendamentos filtra por data **e pela hora do dia**: pedir a
 * partir de "hoje 21:30" devolve zero, porque a API entende que só interessam
 * agendamentos marcados depois das 21:30 — em qualquer dia da janela. Medido
 * contra a API real: 00:00→23:59 devolveu 30 agendamentos; 09:00→10:00, apenas
 * os 7 marcados nesse intervalo de horário. Nada disso está documentado.
 *
 * Por isso toda varredura de período tem que começar às 00:00:00 e terminar às
 * 23:59:59.
 */
export function inicioDoDia(data: Date, fuso: string = FUSO_PADRAO): string {
  return `${dataLocal(data, fuso)}T00:00:00${offsetTexto(data, fuso)}`
}

export function fimDoDia(data: Date, fuso: string = FUSO_PADRAO): string {
  return `${dataLocal(data, fuso)}T23:59:59${offsetTexto(data, fuso)}`
}

function offsetTexto(data: Date, fuso: string): string {
  const off = offsetMinutos(data, fuso)
  const abs = Math.abs(off)
  return `${off < 0 ? '-' : '+'}${dois(Math.floor(abs / 60))}:${dois(abs % 60)}`
}
