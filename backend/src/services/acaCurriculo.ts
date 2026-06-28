// src/services/acaCurriculo.ts
// Módulo Acadêmico · F6 — Currículo Avançado. Monta a "grade do aluno": cruza a
// matriz curricular da turma com resultados (diários), aproveitamentos deferidos
// e dependências, classificando cada componente por situação.

import { prisma } from '../lib/prisma.js'

export type GradeStatus = 'APROVADO' | 'CURSANDO' | 'APROVEITADO' | 'DEPENDENCIA' | 'REPROVADO' | 'PENDENTE'

export async function montarGrade(matriculaId: number) {
  const mat = await prisma.acaMatricula.findUnique({
    where: { id: matriculaId },
    select: { id: true, alunoId: true, turmaId: true, turma: { select: { nome: true, matrizId: true } } },
  })
  if (!mat) throw new Error('Matrícula não encontrada')
  const matrizId = mat.turma.matrizId
  if (!matrizId) return { matriculaId, turma: mat.turma.nome, matrizId: null, componentes: [], resumo: {}, semMatriz: true }

  const componentes = await prisma.acaComponente.findMany({
    where: { matrizId },
    select: { id: true, fase: true, obrigatoria: true, disciplinaId: true, disciplina: { select: { nome: true, codigo: true, cargaHoraria: true } } },
    orderBy: [{ fase: 'asc' }, { id: 'asc' }],
  })

  // resultados da turma para esta matrícula (por disciplinaId)
  const diarios = await prisma.acaDiario.findMany({ where: { turmaId: mat.turmaId }, select: { id: true, disciplinaId: true } })
  const diarioDaDisc = new Map(diarios.map((d) => [d.disciplinaId, d.id]))
  const resultados = diarios.length
    ? await prisma.acaResultado.findMany({ where: { diarioId: { in: diarios.map((d) => d.id) }, matriculaId }, select: { diarioId: true, situacao: true, mediaFinal: true } })
    : []
  const resByDisc = new Map<number, { situacao: string; mediaFinal: number | null }>()
  for (const r of resultados) {
    const disc = diarios.find((d) => d.id === r.diarioId)?.disciplinaId
    if (disc != null) resByDisc.set(disc, { situacao: r.situacao, mediaFinal: r.mediaFinal })
  }

  const aproveitados = new Set((await prisma.acaAproveitamento.findMany({ where: { matriculaId, status: 'DEFERIDO' }, select: { componenteId: true } })).map((a) => a.componenteId))
  const deps = await prisma.acaDependencia.findMany({ where: { matriculaId }, select: { componenteId: true, situacao: true } })
  const depByComp = new Map(deps.map((d) => [d.componenteId, d.situacao]))

  const resumo: Record<GradeStatus, number> = { APROVADO: 0, CURSANDO: 0, APROVEITADO: 0, DEPENDENCIA: 0, REPROVADO: 0, PENDENTE: 0 }
  const out = componentes.map((c) => {
    let status: GradeStatus = 'PENDENTE'
    let media: number | null = null
    if (aproveitados.has(c.id)) status = 'APROVEITADO'
    else {
      const res = resByDisc.get(c.disciplinaId)
      if (res) {
        media = res.mediaFinal
        status = res.situacao === 'APROVADO' ? 'APROVADO' : res.situacao.startsWith('REPROVADO') ? 'REPROVADO' : 'CURSANDO'
      } else if (depByComp.has(c.id)) {
        status = depByComp.get(c.id) === 'CUMPRIDA' ? 'APROVADO' : 'DEPENDENCIA'
      } else if (diarioDaDisc.has(c.disciplinaId)) {
        status = 'CURSANDO'
      }
    }
    resumo[status]++
    return {
      componenteId: c.id, fase: c.fase, obrigatoria: c.obrigatoria,
      disciplina: c.disciplina?.nome ?? '—', codigo: c.disciplina?.codigo ?? null,
      cargaHoraria: c.disciplina?.cargaHoraria ?? 0, status, media,
    }
  })
  return { matriculaId, turma: mat.turma.nome, matrizId, componentes: out, resumo, semMatriz: false }
}
