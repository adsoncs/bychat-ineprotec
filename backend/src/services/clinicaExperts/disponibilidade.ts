// src/services/clinicaExperts/disponibilidade.ts
//
// Os horários que a clínica considera livres para um profissional num dia.
//
// Por que isto existe: a importação de ocupação traz os AGENDAMENTOS de lá,
// mas não a jornada. Se o profissional atende das 11h às 19h na clínica e a
// agenda dele aqui diz 09h às 18h, as 09h aparecem livres nos dois cálculos
// daqui e mesmo assim a clínica recusa — foi o 409 "Message undeliverable" do
// primeiro teste de ponta a ponta, com o paciente já tendo visto a confirmação.
//
// `/available-hours` responde a pergunta certa: dado o profissional e o dia,
// que horários ela aceita? É um dia por chamada, então cada resposta fica em
// memória por alguns minutos — o limite lá é de 120 chamadas por minuto e a
// página pública consulta vários dias de uma vez.
//
// Regra de ouro: **falha aqui não zera a oferta**. Se a clínica não responder,
// o filtro é ignorado e valem só os cálculos daqui — oferecer de mais é ruim,
// mas oferecer nada é pior.

import { chamar } from './client.js'
import { dataLocal } from './tempo.js'

const LOG = '[clinicaExperts/disponibilidade]'
const CACHE_MS = 5 * 60_000

/** Chave: `uuid|AAAA-MM-DD`. Valor: horários "HH:MM" que a clínica aceita. */
const cache = new Map<string, { em: number; horas: Set<string> | null }>()

/**
 * Horários livres na clínica. `null` significa "não deu para saber" — e quem
 * chama deve tratar como "sem restrição", nunca como "nada livre".
 */
export async function horasLivresNaClinica(
  profissionalUuid: string,
  dia: string,
  intervaloMin?: number,
): Promise<Set<string> | null> {
  const chave = `${profissionalUuid}|${dia}`
  const guardado = cache.get(chave)
  if (guardado && Date.now() - guardado.em < CACHE_MS) return guardado.horas

  try {
    const r = await chamar<any>('/available-hours', {
      query: {
        professional_uuid: profissionalUuid,
        date: dia,
        ...(intervaloMin ? { interval: intervaloMin } : {}),
      },
    })
    // A resposta real vem como `{ "data": ["08:00", ...] }` — a documentação
    // mostra um array solto. Aceita as duas formas.
    const lista: unknown = Array.isArray(r) ? r : r?.data
    if (!Array.isArray(lista)) {
      cache.set(chave, { em: Date.now(), horas: null })
      return null
    }
    const horas = new Set(lista.map((h) => String(h).slice(0, 5)))
    cache.set(chave, { em: Date.now(), horas })
    return horas
  } catch (e: any) {
    console.warn(`${LOG} ${profissionalUuid} em ${dia}: ${e?.message ?? e} — filtro ignorado`)
    cache.set(chave, { em: Date.now(), horas: null })
    return null
  }
}

/** Esquece o que está guardado (usado depois de criar/cancelar na clínica). */
export function esquecerDisponibilidade(profissionalUuid?: string): void {
  if (!profissionalUuid) { cache.clear(); return }
  for (const k of [...cache.keys()]) if (k.startsWith(`${profissionalUuid}|`)) cache.delete(k)
}

/**
 * Filtra os horários calculados aqui, deixando só os que a clínica também
 * aceita. Dias que ela não soube responder passam inteiros.
 */
export async function filtrarPelaClinica(
  dias: Array<{ date: string; weekday: number; slots: Array<{ startAt: string; endAt: string; label: string }> }>,
  profissionalUuid: string,
  fuso: string,
): Promise<typeof dias> {
  const saida: typeof dias = []
  for (const d of dias) {
    const horas = await horasLivresNaClinica(profissionalUuid, d.date)
    if (!horas) { saida.push(d); continue }
    const slots = d.slots.filter((s) => {
      // O rótulo já é a hora local ("09:30"); quando faltar, é recalculado a
      // partir do início, para não depender do formato de quem gerou.
      const hhmm = /^\d{2}:\d{2}$/.test(s.label)
        ? s.label
        : horaLocal(new Date(s.startAt), fuso)
      return horas.has(hhmm)
    })
    if (slots.length) saida.push({ ...d, slots })
  }
  return saida
}

function horaLocal(data: Date, fuso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: fuso, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(data)
}

/** O dia (AAAA-MM-DD) de um instante, no fuso da agenda. */
export const diaDe = dataLocal
