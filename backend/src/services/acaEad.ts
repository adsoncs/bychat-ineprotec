// src/services/acaEad.ts
// Módulo Acadêmico · F19 — EAD / Ponte com o LMS próprio. O LMS (a construir) é o
// ponto de integração: em modo SIMULADO o fluxo roda local; em AO_VIVO chamaria
// a API do LMS (criar curso, matricular, puxar notas).

import crypto from 'crypto'
import { prisma } from '../lib/prisma.js'

export async function eadConfig() {
  return (await prisma.acaEadConfig.findFirst()) || null
}

/**
 * Sincroniza a turma EAD com o LMS: matricula os alunos (MATRICULADO) no curso do
 * LMS. SIMULADO grava o vínculo local; AO_VIVO chamaria o LMS (ponto de integração).
 */
export async function sincronizarTurmaEad(eadTurmaId: number) {
  const ead = await prisma.acaEadTurma.findUnique({ where: { id: eadTurmaId }, select: { id: true, turmaId: true } })
  if (!ead) throw new Error('Turma EAD não encontrada')
  const cfg = await eadConfig()
  const aoVivo = cfg?.modo === 'AO_VIVO' && cfg?.ativo
  const matriculas = await prisma.acaMatricula.findMany({ where: { turmaId: ead.turmaId, status: 'MATRICULADO' }, select: { id: true } })
  let sincronizadas = 0
  for (const m of matriculas) {
    // AO_VIVO: aqui entraria a chamada ao LMS (enrol). SIMULADO: gera ref local.
    const lmsEnrollRef = aoVivo ? null /* preenchido pela API do LMS */ : `SIM-${crypto.randomBytes(6).toString('hex')}`
    await prisma.acaEadMatricula.upsert({
      where: { matriculaId: m.id },
      create: { matriculaId: m.id, eadTurmaId, lmsEnrollRef, status: aoVivo ? 'PENDENTE' : 'SINCRONIZADA', syncedAt: aoVivo ? null : new Date() },
      update: { eadTurmaId, lmsEnrollRef, status: aoVivo ? 'PENDENTE' : 'SINCRONIZADA', syncedAt: aoVivo ? null : new Date() },
    })
    sincronizadas++
  }
  return { total: matriculas.length, sincronizadas, modo: aoVivo ? 'AO_VIVO' : 'SIMULADO' }
}

/** Recebe médias do LMS (push) ou lançamento manual. */
export async function receberNotasEad(notas: Array<{ matriculaId: number; disciplina: string; nota: number }>, origem = 'LMS') {
  let salvas = 0
  for (const n of notas) {
    if (n.matriculaId == null || n.nota == null || !n.disciplina) continue
    await prisma.acaEadNota.create({ data: { matriculaId: Number(n.matriculaId), disciplina: String(n.disciplina).slice(0, 191), nota: Number(n.nota), origem: origem === 'MANUAL' ? 'MANUAL' : 'LMS' } })
    salvas++
  }
  return { salvas }
}
