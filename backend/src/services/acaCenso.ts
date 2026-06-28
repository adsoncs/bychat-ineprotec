// src/services/acaCenso.ts
// Módulo Acadêmico · F18 — Censo INEP (Educação Superior) + ENADE. Coleta de
// dados, validação de consistência e seleção ENADE (ingressantes/concluintes).
// ⚠️ Os leiautes oficiais do INEP variam por ano-base; entregue como base
// consolidada, mapeável ao layout vigente.

import { prisma } from '../lib/prisma.js'

export interface LinhaCenso {
  matriculaId: number; alunoId: number; cpf: string; nome: string; nascimento: Date | null; sexo: string
  ra: string; curso: string; turma: string; periodo: string; anoLetivo: number | null
  status: string; dataMatricula: Date; dataConclusao: Date | null
}

const cursoCache = new Map<number, string>()
async function cursoDaOferta(offId: number | null | undefined): Promise<string> {
  if (!offId) return '—'
  if (cursoCache.has(offId)) return cursoCache.get(offId)!
  const off = await prisma.courseOffering.findUnique({ where: { id: offId }, select: { courseId: true } })
  let nome = '—'
  if (off) { const c = await prisma.course.findUnique({ where: { id: off.courseId }, select: { nome: true } }); nome = c?.nome || '—' }
  cursoCache.set(offId, nome)
  return nome
}

export async function coletarMatriculas(anoBase?: number): Promise<LinhaCenso[]> {
  const where: any = { status: { in: ['MATRICULADO', 'TRANCADO', 'CONCLUIDO', 'EVADIDO', 'TRANSFERIDO'] } }
  if (anoBase) where.turma = { periodoLetivo: { anoLetivo: anoBase } }
  const mats = await prisma.acaMatricula.findMany({
    where, orderBy: { id: 'asc' }, take: 5000,
    select: {
      id: true, alunoId: true, status: true, dataMatricula: true, dataConclusao: true,
      aluno: { select: { ra: true, cpf: true, dataNascimento: true, sexo: true, lead: { select: { nome: true } } } },
      turma: { select: { nome: true, courseOfferingId: true, periodoLetivo: { select: { codigo: true, anoLetivo: true } } } },
    },
  })
  const out: LinhaCenso[] = []
  for (const m of mats) {
    out.push({
      matriculaId: m.id, alunoId: m.alunoId, cpf: m.aluno.cpf || '', nome: m.aluno.lead.nome,
      nascimento: m.aluno.dataNascimento, sexo: m.aluno.sexo || '', ra: m.aluno.ra || '',
      curso: await cursoDaOferta(m.turma.courseOfferingId), turma: m.turma.nome,
      periodo: m.turma.periodoLetivo?.codigo || '—', anoLetivo: m.turma.periodoLetivo?.anoLetivo ?? null,
      status: m.status, dataMatricula: m.dataMatricula, dataConclusao: m.dataConclusao,
    })
  }
  return out
}

/** Valida consistência para o censo: campos obrigatórios ausentes por matrícula. */
export async function validarConsistencia(anoBase?: number) {
  const linhas = await coletarMatriculas(anoBase)
  const justifs = await prisma.acaCensoJustificativa.findMany({ where: anoBase ? { anoBase } : {}, select: { matriculaId: true } })
  const justificadas = new Set(justifs.map((j) => j.matriculaId))
  const inconsistencias = linhas.map((l) => {
    const problemas: string[] = []
    if (!l.cpf) problemas.push('CPF ausente')
    if (!l.nascimento) problemas.push('Data de nascimento ausente')
    if (!l.sexo) problemas.push('Sexo ausente')
    if (l.curso === '—') problemas.push('Curso não vinculado')
    return { matriculaId: l.matriculaId, nome: l.nome, ra: l.ra, curso: l.curso, problemas, justificada: justificadas.has(l.matriculaId) }
  }).filter((x) => x.problemas.length > 0)
  return {
    total: linhas.length, comInconsistencia: inconsistencias.length,
    pendentes: inconsistencias.filter((i) => !i.justificada).length, inconsistencias,
  }
}

/** Seleção ENADE: ingressantes (matriculados no ano) e concluintes (concluídos no ano). */
export async function selecaoEnade(ano: number) {
  const linhas = await coletarMatriculas()
  const ingressantes = linhas.filter((l) => l.dataMatricula && new Date(l.dataMatricula).getFullYear() === ano)
  const concluintes = linhas.filter((l) => l.status === 'CONCLUIDO' && l.dataConclusao && new Date(l.dataConclusao).getFullYear() === ano)
  const porCurso = new Map<string, { ingressantes: number; concluintes: number }>()
  for (const l of ingressantes) { const g = porCurso.get(l.curso) ?? { ingressantes: 0, concluintes: 0 }; g.ingressantes++; porCurso.set(l.curso, g) }
  for (const l of concluintes) { const g = porCurso.get(l.curso) ?? { ingressantes: 0, concluintes: 0 }; g.concluintes++; porCurso.set(l.curso, g) }
  return {
    ano, totalIngressantes: ingressantes.length, totalConcluintes: concluintes.length,
    porCurso: [...porCurso.entries()].map(([curso, v]) => ({ curso, ...v })),
    ingressantes, concluintes,
  }
}
