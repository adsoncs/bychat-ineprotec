// src/routes/acaSistec.ts
// Módulo Acadêmico · O2.10 — Exportação SISTEC / Censo (educação profissional).
// Consolida matrículas + dados do aluno/curso/situação em CSV, base para a
// prestação de informações ao MEC. O leiaute oficial varia; aqui entregamos a
// extração estruturada com o mapeamento de situação (ajustável ao layout vigente).

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'

// Matrícula (interna) → situação SISTEC
const SITUACAO: Record<string, string> = {
  MATRICULADO: 'EM_CURSO', CONCLUIDO: 'CONCLUIDA', EVADIDO: 'ABANDONO',
  TRANCADO: 'TRANCADA', TRANSFERIDO: 'TRANSFERIDO_EXTERNO', CANCELADO: 'DESLIGADO',
}
const INCLUIR = Object.keys(SITUACAO) // exclui INSCRITO/PRE_MATRICULA

async function coletar(filtros: { periodoLetivoId?: number; turmaId?: number }) {
  const turmaWhere: any = {}
  if (filtros.turmaId) turmaWhere.id = filtros.turmaId
  if (filtros.periodoLetivoId) turmaWhere.periodoLetivoId = filtros.periodoLetivoId
  const mats = await prisma.acaMatricula.findMany({
    where: { status: { in: INCLUIR as any }, ...(Object.keys(turmaWhere).length ? { turma: turmaWhere } : {}) },
    orderBy: [{ turmaId: 'asc' }, { id: 'asc' }],
    select: {
      status: true, dataMatricula: true, dataConclusao: true,
      aluno: { select: { ra: true, cpf: true, dataNascimento: true, sexo: true, lead: { select: { nome: true } } } },
      turma: { select: { nome: true, courseOfferingId: true, matrizId: true, periodoLetivo: { select: { codigo: true } } } },
    },
  })
  // resolve curso + carga horária (matriz) com cache
  const offCache = new Map<number, string>()
  const chCache = new Map<number, number>()
  const out = []
  for (const m of mats) {
    let curso = '—'
    const offId = m.turma.courseOfferingId
    if (offId) {
      if (offCache.has(offId)) curso = offCache.get(offId)!
      else { const off = await prisma.courseOffering.findUnique({ where: { id: offId }, select: { courseId: true } }); if (off) { const c = await prisma.course.findUnique({ where: { id: off.courseId }, select: { nome: true } }); curso = c?.nome || '—' } offCache.set(offId, curso) }
    }
    let chCurso = 0
    if (m.turma.matrizId) {
      if (chCache.has(m.turma.matrizId)) chCurso = chCache.get(m.turma.matrizId)!
      else {
        const comps = await prisma.acaComponente.findMany({ where: { matrizId: m.turma.matrizId }, select: { disciplina: { select: { cargaHoraria: true } } } })
        chCurso = comps.reduce((s, c) => s + (c.disciplina?.cargaHoraria || 0), 0)
        chCache.set(m.turma.matrizId, chCurso)
      }
    }
    out.push({
      cpf: m.aluno.cpf || '', nome: m.aluno.lead.nome, nascimento: m.aluno.dataNascimento, sexo: m.aluno.sexo || '', ra: m.aluno.ra || '',
      curso, turma: m.turma.nome, periodo: m.turma.periodoLetivo?.codigo || '', cargaHoraria: chCurso,
      situacao: SITUACAO[m.status] || m.status, dataMatricula: m.dataMatricula, dataConclusao: m.dataConclusao,
    })
  }
  return out
}

export async function acaSistecRoutes(app: FastifyInstance) {
  // ── Prévia (contagens por situação) ──
  app.get('/api/admin/aca/sistec/preview', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const linhas = await coletar({ periodoLetivoId: q.periodoLetivoId ? Number(q.periodoLetivoId) : undefined, turmaId: q.turmaId ? Number(q.turmaId) : undefined })
    const porSituacao: Record<string, number> = {}
    let semCpf = 0
    for (const l of linhas) { porSituacao[l.situacao] = (porSituacao[l.situacao] || 0) + 1; if (!l.cpf) semCpf++ }
    return { total: linhas.length, porSituacao, semCpf, amostra: linhas.slice(0, 8) }
  })

  // ── Exportação CSV ──
  app.get('/api/admin/aca/sistec/export.csv', { preHandler: authMiddleware }, async (req, reply) => {
    const q = req.query as any
    const linhas = await coletar({ periodoLetivoId: q.periodoLetivoId ? Number(q.periodoLetivoId) : undefined, turmaId: q.turmaId ? Number(q.turmaId) : undefined })
    const esc = (s: any) => `"${String(s ?? '').replace(/"/g, '""')}"`
    const data = (d: any) => (d ? new Date(d).toLocaleDateString('pt-BR') : '')
    const head = ['CPF', 'Nome', 'DataNascimento', 'Sexo', 'RA', 'Curso', 'Turma', 'Periodo', 'CargaHorariaCurso', 'SituacaoSISTEC', 'DataMatricula', 'DataConclusao']
    const rows = linhas.map((l) => [l.cpf, l.nome, data(l.nascimento), l.sexo, l.ra, l.curso, l.turma, l.periodo, l.cargaHoraria, l.situacao, data(l.dataMatricula), data(l.dataConclusao)].map(esc).join(';'))
    reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', 'attachment; filename="sistec-censo.csv"')
    return reply.send('﻿' + [head.map(esc).join(';'), ...rows].join('\n'))
  })
}
