// src/routes/acaCenso.ts
// Módulo Acadêmico · F18 — Censo INEP (Educação Superior) + ENADE (rotas
// /api/admin/aca/censo). Validação de consistência, exportações e justificativas.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'
import { coletarMatriculas, validarConsistencia, selecaoEnade } from '../services/acaCenso.js'

const esc = (v: any) => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
const dataBR = (d: any) => (d ? new Date(d).toLocaleDateString('pt-BR') : '')

export async function acaCensoRoutes(app: FastifyInstance) {
  // Anos-base disponíveis (dos períodos letivos)
  app.get('/api/admin/aca/censo/anos', { preHandler: authMiddleware }, async () => {
    const periodos = await prisma.acaPeriodoLetivo.findMany({ where: { anoLetivo: { not: null } }, select: { anoLetivo: true }, distinct: ['anoLetivo'], orderBy: { anoLetivo: 'desc' } })
    return { anos: periodos.map((p) => p.anoLetivo).filter(Boolean) }
  })

  // ── Validação de consistência ──
  app.get('/api/admin/aca/censo/validacao', { preHandler: authMiddleware }, async (req) => {
    const anoBase = (req.query as any).anoBase ? Number((req.query as any).anoBase) : undefined
    return validarConsistencia(anoBase)
  })

  // ── Censo Superior (export) ──
  app.get('/api/admin/aca/censo/superior.csv', { preHandler: authMiddleware }, async (req, reply) => {
    const anoBase = (req.query as any).anoBase ? Number((req.query as any).anoBase) : undefined
    const linhas = await coletarMatriculas(anoBase)
    const head = ['CPF', 'Nome', 'Nascimento', 'Sexo', 'RA', 'Curso', 'Turma', 'Período', 'Ano', 'Situação', 'Data matrícula', 'Data conclusão']
    const rows = linhas.map((l) => [l.cpf, l.nome, dataBR(l.nascimento), l.sexo, l.ra, l.curso, l.turma, l.periodo, l.anoLetivo ?? '', l.status, dataBR(l.dataMatricula), dataBR(l.dataConclusao)].map(esc).join(';'))
    reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="censo-superior${anoBase ? `-${anoBase}` : ''}.csv"`).send('\uFEFF' + [head.join(';'), ...rows].join('\r\n'))
  })

  // ── ENADE ──
  app.get('/api/admin/aca/censo/enade', { preHandler: authMiddleware }, async (req) => {
    const ano = Number((req.query as any).ano) || new Date().getFullYear()
    const r = await selecaoEnade(ano)
    return { ano: r.ano, totalIngressantes: r.totalIngressantes, totalConcluintes: r.totalConcluintes, porCurso: r.porCurso, amostra: { ingressantes: r.ingressantes.slice(0, 10), concluintes: r.concluintes.slice(0, 10) } }
  })
  app.get('/api/admin/aca/censo/enade.csv', { preHandler: authMiddleware }, async (req, reply) => {
    const ano = Number((req.query as any).ano) || new Date().getFullYear()
    const r = await selecaoEnade(ano)
    const head = ['Categoria', 'CPF', 'Nome', 'RA', 'Curso', 'Situação']
    const linhas = [
      ...r.ingressantes.map((l) => ['Ingressante', l.cpf, l.nome, l.ra, l.curso, l.status]),
      ...r.concluintes.map((l) => ['Concluinte', l.cpf, l.nome, l.ra, l.curso, l.status]),
    ].map((cols) => cols.map(esc).join(';'))
    reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="enade-${ano}.csv"`).send('\uFEFF' + [head.join(';'), ...linhas].join('\r\n'))
  })

  // ── Justificativas de censo ──
  app.get('/api/admin/aca/censo/justificativas', { preHandler: authMiddleware }, async (req) => {
    const anoBase = (req.query as any).anoBase ? Number((req.query as any).anoBase) : undefined
    return { justificativas: await prisma.acaCensoJustificativa.findMany({ where: anoBase ? { anoBase } : {}, orderBy: { id: 'desc' } }) }
  })
  app.post('/api/admin/aca/censo/justificativas', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    if (!b.matriculaId || !b.anoBase || !b.motivo) return reply.code(400).send({ error: 'matriculaId, anoBase e motivo obrigatórios' })
    const j = await prisma.acaCensoJustificativa.upsert({
      where: { matriculaId_anoBase: { matriculaId: Number(b.matriculaId), anoBase: Number(b.anoBase) } },
      create: { matriculaId: Number(b.matriculaId), anoBase: Number(b.anoBase), motivo: String(b.motivo).slice(0, 2000) },
      update: { motivo: String(b.motivo).slice(0, 2000) },
    })
    return reply.code(201).send({ justificativa: j })
  })
  app.delete('/api/admin/aca/censo/justificativas/:id', { preHandler: authMiddleware }, async (req) => {
    await prisma.acaCensoJustificativa.delete({ where: { id: Number((req.params as any).id) } }); return { ok: true }
  })
}
