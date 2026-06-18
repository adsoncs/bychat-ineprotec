// src/routes/acaSecretaria.ts
// Módulo Acadêmico · P7 — Secretaria / Documentos.
// Monta o histórico escolar consolidado e emite documentos oficiais NUMERADOS
// (histórico, declaração de matrícula, declaração de frequência, ata) em PDF.
// Rotas /api/admin/aca/*.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'
import { renderDocumentoPdf } from '../services/acaDocRender.js'
import { montarHistorico, emitirDocumentoAluno, emitirAtaTurma, emitirCertificado, type DocTipo } from '../services/acaDocumentos.js'

export async function acaSecretariaRoutes(app: FastifyInstance) {
  // ── GET /alunos/:id/historico — prévia do histórico (dados) ──
  app.get('/api/admin/aca/alunos/:id/historico', { preHandler: authMiddleware }, async (req, reply) => {
    const hist = await montarHistorico(Number((req.params as any).id))
    if (!hist) return reply.code(404).send({ error: 'Aluno não encontrado' })
    return hist
  })

  // ── GET /documentos — lista de documentos emitidos (filtro alunoId/turmaId) ──
  app.get('/api/admin/aca/documentos', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const where: any = {}
    if (q.alunoId) where.alunoId = Number(q.alunoId)
    if (q.turmaId) where.turmaId = Number(q.turmaId)
    if (q.tipo) where.tipo = String(q.tipo)
    const documentos = await prisma.acaDocumento.findMany({ where, orderBy: { emitidoEm: 'desc' }, take: 200 })
    return { documentos }
  })

  // ── POST /documentos — emite (gera número + snapshot) ──
  app.post('/api/admin/aca/documentos', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    const tipo = String(b.tipo || '')
    const userId = (req as any).user?.userId ?? null
    try {
      if (tipo === 'ATA_RESULTADOS') return reply.code(201).send({ documento: await emitirAtaTurma(Number(b.turmaId), userId) })
      const doc = await emitirDocumentoAluno(tipo as DocTipo, Number(b.alunoId), userId)
      return reply.code(201).send({ documento: doc })
    } catch (e: any) {
      const msg = e?.message || 'Falha ao emitir'
      return reply.code(msg === 'tipo inválido' ? 400 : 404).send({ error: msg })
    }
  })

  // ── POST /matriculas/:id/certificado — emite o certificado (O2.8) ──
  app.post('/api/admin/aca/matriculas/:id/certificado', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const doc = await emitirCertificado(Number((req.params as any).id), (req as any).user?.userId ?? null)
      return reply.code(201).send({ documento: doc })
    } catch (e: any) { return reply.code(400).send({ error: e?.message || 'Falha ao certificar' }) }
  })

  // ── GET /egressos — concluintes (status CONCLUIDO) + certificado ──
  app.get('/api/admin/aca/egressos', { preHandler: authMiddleware }, async () => {
    const mats = await prisma.acaMatricula.findMany({
      where: { status: 'CONCLUIDO' },
      orderBy: { dataConclusao: 'desc' }, take: 500,
      select: { id: true, dataConclusao: true, alunoId: true, aluno: { select: { ra: true, lead: { select: { nome: true } } } }, turma: { select: { nome: true } } },
    })
    const alunoIds = [...new Set(mats.map((m) => m.alunoId))]
    const certs = alunoIds.length ? await prisma.acaDocumento.findMany({ where: { alunoId: { in: alunoIds }, tipo: 'CERTIFICADO' }, select: { id: true, alunoId: true, numero: true } }) : []
    const certByAluno = new Map(certs.map((c) => [c.alunoId, c]))
    const itens = mats.map((m) => ({ matriculaId: m.id, alunoId: m.alunoId, ra: m.aluno.ra, nome: m.aluno.lead.nome, turma: m.turma.nome, dataConclusao: m.dataConclusao, certificado: certByAluno.get(m.alunoId) ?? null }))
    return { itens }
  })

  // ── GET /documentos/:id/pdf — renderiza o PDF a partir do snapshot ──
  app.get('/api/admin/aca/documentos/:id/pdf', { preHandler: authMiddleware }, async (req, reply) => {
    const doc = await prisma.acaDocumento.findUnique({ where: { id: Number((req.params as any).id) } })
    if (!doc) return reply.code(404).send({ error: 'Documento não encontrado' })
    const pdf = await renderDocumentoPdf(doc)
    if (!pdf) return reply.code(400).send({ error: 'tipo inválido' })
    reply.header('Content-Type', 'application/pdf')
    reply.header('Content-Disposition', `inline; filename="${doc.tipo.toLowerCase()}-${doc.numero.replace('/', '-')}.pdf"`)
    return reply.send(pdf)
  })

  // ── DELETE /documentos/:id — remove (reemissão gera novo número) ──
  app.delete('/api/admin/aca/documentos/:id', { preHandler: authMiddleware }, async (req) => {
    await prisma.acaDocumento.delete({ where: { id: Number((req.params as any).id) } }).catch(() => {})
    return { ok: true }
  })
}
