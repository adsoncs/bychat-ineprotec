// src/services/acaAlocacao.ts
// Módulo Acadêmico · F15 — Alocação de Recursos. Detecção de conflito de reserva
// de ambiente (mesmo ambiente, mesmo dia, faixa de horário sobreposta).

import { prisma } from '../lib/prisma.js'

/** Reservas ATIVAS que conflitam com a faixa [horaInicio, horaFim) no ambiente/dia. */
export async function conflitosReserva(ambienteId: number, data: Date, horaInicio: string, horaFim: string, excludeId?: number) {
  const dia = new Date(Date.UTC(data.getUTCFullYear(), data.getUTCMonth(), data.getUTCDate()))
  const prox = new Date(dia); prox.setUTCDate(prox.getUTCDate() + 1)
  const reservas = await prisma.acaReserva.findMany({
    where: { ambienteId, status: 'ATIVA', data: { gte: dia, lt: prox }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true, horaInicio: true, horaFim: true, finalidade: true },
  })
  // sobreposição: inicioA < fimB && fimA > inicioB (comparação lexical de "HH:MM")
  return reservas.filter((r) => horaInicio < r.horaFim && horaFim > r.horaInicio)
}
