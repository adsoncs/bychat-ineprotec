// src/services/acaDocente.ts
// Módulo Acadêmico · F14 — Docente / RH Acadêmico. Cálculo de atividades docentes
// e geração de pendências de aceite a partir dos diários atribuídos ao professor.

import { prisma } from '../lib/prisma.js'

/** Valor de uma atividade: horas × valor-hora × fator (em centavos). */
export function calcValorAtividade(horas: number, valorHoraCentavos: number, fator: number): number {
  return Math.round((horas || 0) * (valorHoraCentavos || 0) * (fator || 1))
}

/**
 * Gera aceites PENDENTES para os diários atribuídos ao professor (professorUserId
 * = docente.userId) que ainda não têm aceite. Retorna quantos foram criados.
 */
export async function gerarAceitesPendentes(docenteId: number): Promise<{ criados: number }> {
  const docente = await prisma.acaDocente.findUnique({ where: { id: docenteId }, select: { userId: true } })
  if (!docente) throw new Error('Docente não encontrado')
  const diarios = await prisma.acaDiario.findMany({ where: { professorUserId: docente.userId, ativo: true }, select: { id: true } })
  if (!diarios.length) return { criados: 0 }
  const existentes = await prisma.acaDocenteAceite.findMany({ where: { docenteId, diarioId: { in: diarios.map((d) => d.id) } }, select: { diarioId: true } })
  const jaTem = new Set(existentes.map((e) => e.diarioId))
  const novos = diarios.filter((d) => !jaTem.has(d.id))
  if (novos.length) await prisma.acaDocenteAceite.createMany({ data: novos.map((d) => ({ docenteId, diarioId: d.id, status: 'PENDENTE' as const })) })
  return { criados: novos.length }
}

/**
 * Resumo de atividades por docente numa competência (mês): total de horas e valor.
 */
export async function resumoCompetencia(competencia: string) {
  const ativs = await prisma.acaAtividadeDocente.findMany({ where: { competencia } })
  const porDocente = new Map<number, { horas: number; valor: number; qtd: number }>()
  for (const a of ativs) {
    const g = porDocente.get(a.docenteId) ?? { horas: 0, valor: 0, qtd: 0 }
    g.horas += a.horas; g.valor += a.valorCentavos; g.qtd++
    porDocente.set(a.docenteId, g)
  }
  const docIds = [...porDocente.keys()]
  const docentes = docIds.length ? await prisma.acaDocente.findMany({ where: { id: { in: docIds } }, select: { id: true, userId: true } }) : []
  const userIds = docentes.map((d) => d.userId)
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : []
  const uMap = new Map(users.map((u) => [u.id, u.name]))
  const dMap = new Map(docentes.map((d) => [d.id, uMap.get(d.userId) ?? `Docente #${d.id}`]))
  const linhas = docIds.map((id) => ({ docenteId: id, nome: dMap.get(id) ?? `Docente #${id}`, ...porDocente.get(id)! }))
  linhas.sort((a, b) => b.valor - a.valor)
  return { competencia, totalHoras: linhas.reduce((s, l) => s + l.horas, 0), totalValorCentavos: linhas.reduce((s, l) => s + l.valor, 0), docentes: linhas }
}
