// src/routes/acaVestibular.ts
// Módulo Acadêmico · F11 — Processo Seletivo (rotas /api/admin/aca/vestibular).
// Consulta do resultado da classificação e dados da inscrição (grupos, motivos
// de cancelamento, empresas, extras). Classificar e convocar é do Portal.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'

const PR_STATUS: Record<string, string> = { inscrito: 'Inscrito', pago_taxa: 'Taxa paga', classificado: 'Classificado', convocado: 'Convocado', matriculado: 'Matriculado', desistente: 'Desistente', reprovado: 'Reprovado' }

export async function acaVestibularRoutes(app: FastifyInstance) {
  // ── Processos (picker) ──
  app.get('/api/admin/aca/vestibular/processos', { preHandler: authMiddleware }, async () => {
    const ps = await prisma.selectionProcess.findMany({ where: { active: true }, orderBy: { id: 'desc' }, take: 100, select: { id: true, nome: true, periodoLetivo: true, notaCorte: true, status: true } })
    const ids = ps.map((p) => p.id)
    const counts = ids.length ? await prisma.processRegistration.groupBy({ by: ['selectionProcessId'], where: { selectionProcessId: { in: ids } }, _count: { _all: true } }) : []
    const cMap = new Map(counts.map((c) => [c.selectionProcessId, c._count._all]))
    return { processos: ps.map((p) => ({ ...p, candidatos: cMap.get(p.id) ?? 0 })) }
  })

  // ── Candidatos do processo (+nota/posição/ensalamento) ──
  app.get('/api/admin/aca/vestibular/processos/:id/candidatos', { preHandler: authMiddleware }, async (req) => {
    const selectionProcessId = Number((req.params as any).id)
    const regs = await prisma.processRegistration.findMany({
      where: { selectionProcessId }, orderBy: [{ posicaoClassificacao: 'asc' }, { inscritoEm: 'asc' }], take: 1000,
      select: { id: true, status: true, notaClassificacao: true, posicaoClassificacao: true, inscritoEm: true, lead: { select: { nome: true } } },
    })
    // Nota e posição vêm do Portal, dono da classificação desde a Fase 4. As
    // tabelas de nota por componente e de ensalamento não são mais lidas: nunca
    // tiveram uma linha e ninguém escreve nelas.
    const counts: Record<string, number> = {}
    for (const r of regs) counts[r.status] = (counts[r.status] ?? 0) + 1
    return {
      candidatos: regs.map((r) => ({
        id: r.id, nome: r.lead.nome, status: r.status, statusLabel: PR_STATUS[r.status] ?? r.status,
        notaFinal: r.notaClassificacao, posicao: r.posicaoClassificacao,
      })),
      counts,
    }
  })

  // ── Componentes de nota, classificação, convocação e ensalamento: REMOVIDOS ──
  //
  // Fase 4 da consolidação ERP × Portal (10/09/2026). Estas rotas escreviam em
  // ProcessRegistration — a tabela do Portal — com régua própria: usavam sempre
  // `selectionProcess.notaCorte`, mesmo em processo de redação (que tem
  // `essayCutoff`), ignoravam o corte por oferta, tratavam quem ainda não tinha
  // nota como nota 0 (reprovando em massa), rebaixavam quem já estava convocado
  // e não registravam uma linha de histórico sequer.
  //
  // Quem classifica e convoca agora é o Portal:
  //   GET  /api/admin/educacional/selection-processes/:id/classification
  //   POST /api/admin/educacional/selection-processes/:id/classify
  //   POST /api/admin/educacional/selection-processes/:id/convoke
  // Regras em services/portalClassificacao.ts.
  //
  // O ensalamento saiu junto: é infraestrutura de prova presencial, e a
  // instituição não aplica prova (ver Fase 3). As tabelas continuam no schema,
  // vazias e sem leitor.

  // ───────── F12 — Inscrição avançada ─────────
  // Grupos de inscrição (por processo)
  app.get('/api/admin/aca/vestibular/grupos', { preHandler: authMiddleware }, async (req) => {
    const selectionProcessId = Number((req.query as any).processoId)
    return { grupos: await prisma.acaGrupoInscricao.findMany({ where: { selectionProcessId }, orderBy: [{ ordem: 'asc' }, { id: 'asc' }] }) }
  })
  app.post('/api/admin/aca/vestibular/grupos', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    if (!b.selectionProcessId || !b.nome) return reply.code(400).send({ error: 'selectionProcessId e nome obrigatórios' })
    return reply.code(201).send({ grupo: await prisma.acaGrupoInscricao.create({ data: { selectionProcessId: Number(b.selectionProcessId), nome: String(b.nome).slice(0, 120), ordem: Number(b.ordem) || 0 } }) })
  })
  app.delete('/api/admin/aca/vestibular/grupos/:id', { preHandler: authMiddleware }, async (req) => {
    const id = Number((req.params as any).id)
    await prisma.acaInscricaoExtra.updateMany({ where: { grupoId: id }, data: { grupoId: null } })
    await prisma.acaGrupoInscricao.delete({ where: { id } })
    return { ok: true }
  })

  // Motivos de cancelamento (cadastro global)
  app.get('/api/admin/aca/vestibular/motivos-cancelamento', { preHandler: authMiddleware }, async () => ({ motivos: await prisma.acaMotivoCancelamento.findMany({ orderBy: { id: 'asc' } }) }))
  app.post('/api/admin/aca/vestibular/motivos-cancelamento', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    if (!b.nome) return reply.code(400).send({ error: 'nome obrigatório' })
    return reply.code(201).send({ motivo: await prisma.acaMotivoCancelamento.create({ data: { nome: String(b.nome).slice(0, 120) } }) })
  })

  // Empresas (inscrição B2B)
  app.get('/api/admin/aca/vestibular/empresas', { preHandler: authMiddleware }, async () => ({ empresas: await prisma.acaInscricaoEmpresa.findMany({ orderBy: { id: 'asc' } }) }))
  app.post('/api/admin/aca/vestibular/empresas', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    if (!b.nome) return reply.code(400).send({ error: 'nome obrigatório' })
    return reply.code(201).send({ empresa: await prisma.acaInscricaoEmpresa.create({ data: { nome: String(b.nome).slice(0, 191), cnpj: b.cnpj || null, contato: b.contato || null } }) })
  })

  // Atributos extras de uma inscrição (grupo/empresa/como conheceu)
  app.put('/api/admin/aca/vestibular/inscricoes/:regId/extra', { preHandler: authMiddleware }, async (req, reply) => {
    const processRegistrationId = Number((req.params as any).regId); const b = (req.body as any) || {}
    const reg = await prisma.processRegistration.findUnique({ where: { id: processRegistrationId }, select: { id: true } })
    if (!reg) return reply.code(404).send({ error: 'Inscrição não encontrada' })
    const data = { grupoId: b.grupoId ? Number(b.grupoId) : null, empresaId: b.empresaId ? Number(b.empresaId) : null, comoConheceu: b.comoConheceu ? String(b.comoConheceu).slice(0, 120) : null }
    const extra = await prisma.acaInscricaoExtra.upsert({ where: { processRegistrationId }, create: { processRegistrationId, ...data }, update: data })
    return { extra }
  })

  // Cancelar inscrição com motivo (→ ProcessRegistration desistente)
  app.post('/api/admin/aca/vestibular/inscricoes/:regId/cancelar', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).regId); const b = (req.body as any) || {}
    const reg = await prisma.processRegistration.findUnique({ where: { id }, select: { id: true } })
    if (!reg) return reply.code(404).send({ error: 'Inscrição não encontrada' })
    let motivoNome = 'Cancelamento'
    if (b.motivoId) { const m = await prisma.acaMotivoCancelamento.findUnique({ where: { id: Number(b.motivoId) }, select: { nome: true } }); if (m) motivoNome = m.nome }
    const reqUp = await prisma.processRegistration.update({ where: { id }, data: { status: 'desistente', desistenteEm: new Date(), observacao: `Cancelado: ${motivoNome}` } })
    return { ok: true, status: reqUp.status }
  })

  // Extras de todos os candidatos de um processo (p/ enriquecer a lista)
  app.get('/api/admin/aca/vestibular/processos/:id/extras', { preHandler: authMiddleware }, async (req) => {
    const selectionProcessId = Number((req.params as any).id)
    const regs = await prisma.processRegistration.findMany({ where: { selectionProcessId }, select: { id: true } })
    const regIds = regs.map((r) => r.id)
    const extras = regIds.length ? await prisma.acaInscricaoExtra.findMany({ where: { processRegistrationId: { in: regIds } } }) : []
    const grupos = await prisma.acaGrupoInscricao.findMany({ where: { selectionProcessId }, select: { id: true, nome: true } })
    const empresas = await prisma.acaInscricaoEmpresa.findMany({ select: { id: true, nome: true } })
    const gMap = new Map(grupos.map((g) => [g.id, g.nome])); const eMap = new Map(empresas.map((e) => [e.id, e.nome]))
    const out: Record<number, any> = {}
    for (const ex of extras) out[ex.processRegistrationId] = { grupoId: ex.grupoId, grupoNome: ex.grupoId ? gMap.get(ex.grupoId) ?? null : null, empresaId: ex.empresaId, empresaNome: ex.empresaId ? eMap.get(ex.empresaId) ?? null : null, comoConheceu: ex.comoConheceu }
    return { extras: out }
  })
}
