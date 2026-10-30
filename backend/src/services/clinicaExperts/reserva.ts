// src/services/clinicaExperts/reserva.ts
//
// Fecha a reserva do fluxo em três passos **sem duplicar o motor**.
//
// `createBooking()` já resolve muita coisa que não vale reescrever: junta o
// lead pelo telefone/e-mail, tem trava contra dois pacientes no mesmo horário,
// cria a atividade, manda a confirmação, move o funil e dispara o evento que os
// fluxos escutam. Reimplementar tudo isso aqui criaria dois caminhos que se
// afastam com o tempo — e o segundo sempre fica para trás.
//
// A saída é passar para ele um tipo de agendamento **sintético**: o mesmo do
// banco, com três campos trocados em memória.
//
//   durationMin    → a duração do procedimento escolhido (5 a 60 min lá,
//                    contra o valor fixo do tipo)
//   ownerUserId    → o profissional escolhido (ou o que o rodízio escolheu)
//   assignmentMode → 'fixed', porque a escolha já foi feita aqui
//
// Nada é gravado com esses valores no MeetingType: o objeto sintético morre no
// fim da função. E como `getMeetingTypeSlots` monta a agenda a partir do dono,
// a validação interna de `createBooking` passa a olhar exatamente a agenda que
// a página ofereceu ao paciente.

import { prisma } from '../../lib/prisma.js'
import { createBooking, type BookInput, type BookResult } from '../schedulingService.js'
import { profissionaisDaLinha, profissionalTemHorario, type EscolhaValidada } from './linhaServico.js'

const LOG = '[clinicaExperts/reserva]'

type MeetingType = Parameters<typeof createBooking>[0]

export interface EntradaComEscolha extends Omit<BookInput, 'funnelOverride'> {
  escolha: EscolhaValidada
}

/**
 * Quem atende, quando o paciente disse "sem preferência".
 *
 * Entre os que atendem a linha, fica com quem está livre naquele horário; entre
 * os livres, com quem tem menos reservas na semana — para o trabalho não cair
 * todo no primeiro da lista. Empate é resolvido pelo id, para o resultado ser
 * previsível em vez de aleatório.
 */
async function escolherEntreOsLivres(
  mt: MeetingType, inicio: Date, duracaoMin: number,
): Promise<number | null> {
  const candidatos = await profissionaisDaLinha(mt.id)
  if (!candidatos.length) return null

  // "Livre" aqui é a MESMA pergunta que a página fez ao montar a grade: o
  // horário aparece na agenda daquele profissional? Conferir só sobreposição
  // não bastava — o tipo mostra apenas os primeiros horários de cada dia
  // (`visibleSlotsPerDay`), e um horário fora desse teto passaria por "livre"
  // aqui e seria recusado logo adiante, na validação do motor.
  const livres: number[] = []
  for (const c of candidatos) {
    if (await profissionalTemHorario(mt, c.usuarioId, duracaoMin, inicio.toISOString())) {
      livres.push(c.usuarioId)
    }
  }
  if (!livres.length) return null
  if (livres.length === 1) return livres[0]!

  const semana = new Date(Date.now() + 7 * 86400000)
  const carga = await prisma.booking.groupBy({
    by: ['operatorUserId'],
    where: {
      operatorUserId: { in: livres },
      status: { notIn: ['cancelled', 'no_show', 'rescheduled'] },
      startAt: { gte: new Date(), lt: semana },
    },
    _count: { _all: true },
  }).catch(() => [] as Array<{ operatorUserId: number | null; _count: { _all: number } }>)

  const porUsuario = new Map(carga.map((c) => [c.operatorUserId, c._count._all]))
  return [...livres].sort((a, b) => (porUsuario.get(a) ?? 0) - (porUsuario.get(b) ?? 0) || a - b)[0]!
}

/**
 * Cria a reserva com o procedimento e o profissional que o paciente escolheu.
 */
export async function criarReservaComEscolha(mt: MeetingType, entrada: EntradaComEscolha): Promise<BookResult> {
  const { escolha, ...input } = entrada

  const inicio = new Date(input.startAt)
  if (Number.isNaN(inicio.getTime())) return { ok: false, error: 'Horário inválido.' }

  let operador = escolha.usuarioId
  if (!operador) {
    operador = await escolherEntreOsLivres(mt, inicio, escolha.duracaoMin)
    if (!operador) {
      // Aconteceu entre a tela mostrar o horário e o paciente confirmar: alguém
      // fechou antes. É a mesma frase do motor para horário ocupado.
      return { ok: false, error: 'Esse horário acabou de ser reservado. Escolha outro.' }
    }
    console.log(`${LOG} sem preferência → profissional ${operador} (livre e com menor carga)`)
  }

  const sintetico = {
    ...mt,
    durationMin: escolha.duracaoMin,
    ownerUserId: operador,
    assignmentMode: 'fixed',
  } as MeetingType

  const r = await createBooking(sintetico, input as BookInput)

  if (r.ok && r.booking) {
    console.log(`${LOG} reserva ${r.booking.id}: procedimento ${escolha.procedimentoId} (${escolha.duracaoMin} min) com o profissional ${operador}`)
  }
  return r
}
