// src/routes/acaRequerimento.ts
// Módulo Acadêmico · O2.2 + F8 — Secretaria Virtual / Requerimentos (admin).
// Fila de solicitações do aluno com protocolo, SLA e workflow. Ao DEFERIR um
// tipo que gera documento, emite o documento automaticamente. F8 adiciona:
// categorias, custo (gera parcela TAXA ao deferir), deferimento automático e
// trâmites (encaminhamento entre setores/usuários).

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'
import { emitirDocumentoAluno, type DocTipo } from '../services/acaDocumentos.js'
import { contratoAtivoDoAluno } from '../services/acaContrato.js'

export async function proximoProtocolo(): Promise<string> {
  const ano = new Date().getFullYear()
  const count = await prisma.acaRequerimento.count({ where: { protocolo: { startsWith: `REQ-${ano}-` } } })
  return `REQ-${ano}-${String(count + 1).padStart(4, '0')}`
}

/**
 * F8 — gera a taxa do requerimento (parcela TAXA no contrato ativo do aluno),
 * vencendo em N dias. Best-effort: sem contrato ativo, não gera (retorna null).
 */
export async function gerarCustoRequerimento(alunoId: number, custoCentavos: number, descricao: string): Promise<number | null> {
  if (!custoCentavos || custoCentavos <= 0) return null
  const contratoId = await contratoAtivoDoAluno(alunoId)
  if (!contratoId) return null
  const ultima = await prisma.acaParcela.findFirst({ where: { contratoId }, orderBy: { nroParcela: 'desc' }, select: { nroParcela: true } })
  const venc = new Date(); venc.setDate(venc.getDate() + 7)
  const parcela = await prisma.acaParcela.create({
    data: {
      contratoId, nroParcela: (ultima?.nroParcela ?? 0) + 1, tipo: 'TAXA',
      valorBrutoCentavos: custoCentavos, dataVencimento: venc, situacao: 'ABERTA',
    },
    select: { id: true },
  })
  return parcela.id
}

function tipoData(b: any, _partial = false) {
  const data: any = {}
  if ('nome' in b) data.nome = String(b.nome).slice(0, 120)
  if ('descricao' in b) data.descricao = b.descricao || null
  if ('geraDocumento' in b) data.geraDocumento = b.geraDocumento || null
  if ('slaDias' in b) data.slaDias = Number(b.slaDias) || 5
  if ('ordem' in b) data.ordem = Number(b.ordem) || 0
  if ('ativo' in b) data.ativo = !!b.ativo
  if ('categoriaId' in b) data.categoriaId = b.categoriaId ? Number(b.categoriaId) : null
  if ('custoCentavos' in b) data.custoCentavos = Math.max(0, Number(b.custoCentavos) || 0)
  if ('deferimentoAutomatico' in b) data.deferimentoAutomatico = !!b.deferimentoAutomatico
  if ('restricaoJson' in b) data.restricaoJson = b.restricaoJson ? (typeof b.restricaoJson === 'string' ? b.restricaoJson : JSON.stringify(b.restricaoJson)) : null
  if ('camposJson' in b) data.camposJson = b.camposJson ? (typeof b.camposJson === 'string' ? b.camposJson : JSON.stringify(b.camposJson)) : null
  return data
}

export async function acaRequerimentoRoutes(app: FastifyInstance) {
  // ── Categorias (F8) ──
  app.get('/api/admin/aca/requerimento-categorias', { preHandler: authMiddleware }, async () => ({
    categorias: await prisma.acaRequerimentoCategoria.findMany({ orderBy: [{ ordem: 'asc' }, { id: 'asc' }] }),
  }))
  app.post('/api/admin/aca/requerimento-categorias', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    if (!b.nome) return reply.code(400).send({ error: 'nome obrigatório' })
    const categoria = await prisma.acaRequerimentoCategoria.create({ data: { nome: String(b.nome).slice(0, 120), ordem: Number(b.ordem) || 0 } })
    return reply.code(201).send({ categoria })
  })
  app.put('/api/admin/aca/requerimento-categorias/:id', { preHandler: authMiddleware }, async (req) => {
    const id = Number((req.params as any).id); const b = (req.body as any) || {}
    const data: any = {}
    if ('nome' in b) data.nome = String(b.nome).slice(0, 120)
    if ('ordem' in b) data.ordem = Number(b.ordem) || 0
    if ('ativo' in b) data.ativo = !!b.ativo
    return { categoria: await prisma.acaRequerimentoCategoria.update({ where: { id }, data }) }
  })

  // ── Tipos de requerimento (config; estendido na F8) ──
  app.get('/api/admin/aca/requerimento-tipos', { preHandler: authMiddleware }, async () => ({ tipos: await prisma.acaRequerimentoTipo.findMany({ orderBy: [{ ordem: 'asc' }, { id: 'asc' }] }) }))
  app.post('/api/admin/aca/requerimento-tipos', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    if (!b.nome) return reply.code(400).send({ error: 'nome obrigatório' })
    const tipo = await prisma.acaRequerimentoTipo.create({ data: tipoData(b) })
    return reply.code(201).send({ tipo })
  })
  app.put('/api/admin/aca/requerimento-tipos/:id', { preHandler: authMiddleware }, async (req) => {
    const id = Number((req.params as any).id)
    return { tipo: await prisma.acaRequerimentoTipo.update({ where: { id }, data: tipoData((req.body as any) || {}, true) }) }
  })

  // ── Fila de requerimentos ──
  app.get('/api/admin/aca/requerimentos', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const where: any = {}
    if (q.status) where.status = String(q.status)
    if (q.alunoId) where.alunoId = Number(q.alunoId)
    const reqs = await prisma.acaRequerimento.findMany({ where, orderBy: [{ createdAt: 'desc' }], take: 300 })
    const alunoIds = [...new Set(reqs.map((r) => r.alunoId))]
    const alunos = alunoIds.length ? await prisma.aluno.findMany({ where: { id: { in: alunoIds } }, select: { id: true, ra: true, lead: { select: { nome: true } } } }) : []
    const aMap = new Map(alunos.map((a) => [a.id, a]))
    const itens = reqs.map((r) => ({ ...r, ra: aMap.get(r.alunoId)?.ra ?? null, alunoNome: aMap.get(r.alunoId)?.lead.nome ?? '—' }))
    const contagem = await prisma.acaRequerimento.groupBy({ by: ['status'], _count: { _all: true } })
    const counts: Record<string, number> = {}
    for (const c of contagem) counts[c.status] = c._count._all
    return { itens, counts }
  })

  app.get('/api/admin/aca/requerimentos/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const r = await prisma.acaRequerimento.findUnique({ where: { id } })
    if (!r) return reply.code(404).send({ error: 'Requerimento não encontrado' })
    const aluno = await prisma.aluno.findUnique({ where: { id: r.alunoId }, select: { ra: true, lead: { select: { nome: true, email: true, whatsapp: true } } } })
    const tramites = await prisma.acaRequerimentoTramite.findMany({ where: { requerimentoId: id }, orderBy: { createdAt: 'asc' } })
    // enriquece trâmites com nomes de usuário
    const uids = [...new Set(tramites.flatMap((t) => [t.deUserId, t.paraUserId]).filter(Boolean) as number[])]
    const users = uids.length ? await prisma.user.findMany({ where: { id: { in: uids } }, select: { id: true, name: true } }) : []
    const uMap = new Map(users.map((u) => [u.id, u.name]))
    const tipo = r.tipoId ? await prisma.acaRequerimentoTipo.findUnique({ where: { id: r.tipoId } }) : null
    return {
      requerimento: { ...r, ra: aluno?.ra ?? null, alunoNome: aluno?.lead.nome ?? '—', email: aluno?.lead.email, whatsapp: aluno?.lead.whatsapp },
      tipo,
      tramites: tramites.map((t) => ({ ...t, deNome: t.deUserId ? uMap.get(t.deUserId) ?? null : null, paraNome: t.paraUserId ? uMap.get(t.paraUserId) ?? null : null })),
    }
  })

  // ── Tramitar (F8): encaminha o requerimento a um usuário/setor ──
  app.post('/api/admin/aca/requerimentos/:id/tramitar', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id); const b = (req.body as any) || {}
    const r = await prisma.acaRequerimento.findUnique({ where: { id }, select: { id: true, status: true } })
    if (!r) return reply.code(404).send({ error: 'Requerimento não encontrado' })
    const deUserId = (req as any).user?.userId ?? null
    const tramite = await prisma.acaRequerimentoTramite.create({
      data: {
        requerimentoId: id, deUserId,
        paraUserId: b.paraUserId ? Number(b.paraUserId) : null,
        paraTeamId: b.paraTeamId ? Number(b.paraTeamId) : null,
        estado: b.estado ? String(b.estado).slice(0, 16) : r.status,
        comentario: b.comentario ? String(b.comentario) : null,
      },
    })
    // tramitar move para EM_ANALISE se ainda estiver ABERTO
    if (r.status === 'ABERTO') await prisma.acaRequerimento.update({ where: { id }, data: { status: 'EM_ANALISE' } })
    return reply.code(201).send({ tramite })
  })

  // ── Atualizar (workflow + resposta; defere → documento + custo F8) ──
  app.put('/api/admin/aca/requerimentos/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id); const b = (req.body as any) || {}
    const r = await prisma.acaRequerimento.findUnique({ where: { id } })
    if (!r) return reply.code(404).send({ error: 'Requerimento não encontrado' })
    const userId = (req as any).user?.userId ?? null
    const data: any = {}
    if ('status' in b) data.status = String(b.status)
    if ('resposta' in b) data.resposta = b.resposta ? String(b.resposta) : null

    if (b.status === 'DEFERIDO' && r.tipoId) {
      const tipo = await prisma.acaRequerimentoTipo.findUnique({ where: { id: r.tipoId }, select: { geraDocumento: true, custoCentavos: true } })
      // documento
      if (tipo?.geraDocumento && !r.documentoId) {
        try { const doc = await emitirDocumentoAluno(tipo.geraDocumento as DocTipo, r.alunoId, userId); data.documentoId = doc.id } catch { /* segue sem doc */ }
      }
      // custo (F8) — gera parcela TAXA uma única vez
      if (tipo?.custoCentavos && tipo.custoCentavos > 0 && !r.custoParcelaId) {
        const parcelaId = await gerarCustoRequerimento(r.alunoId, tipo.custoCentavos, `Taxa: ${r.tipoNome}`)
        if (parcelaId) data.custoParcelaId = parcelaId
      }
    }
    if (['DEFERIDO', 'INDEFERIDO', 'CONCLUIDO'].includes(b.status)) { data.respondidoPorUserId = userId; data.respondidoEm = new Date() }
    const requerimento = await prisma.acaRequerimento.update({ where: { id }, data })
    return { requerimento }
  })
}
