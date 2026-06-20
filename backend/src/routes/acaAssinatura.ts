// src/routes/acaAssinatura.ts
// Módulo Acadêmico · Assinatura de Contratos (aca_assinatura) — Autentique + modo SIMULADO.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'
import * as svc from '../services/acaAssinatura.js'
import { getConfig, setConfig } from '../services/autentique.js'

const ENV_INCLUDE = { signatarios: { orderBy: { ordem: 'asc' as const } } }

export async function acaAssinaturaRoutes(app: FastifyInstance) {
  // ── Config (sem expor o token) ──
  app.get('/api/admin/aca/assinatura/config', { preHandler: authMiddleware }, async () => {
    const c = await getConfig()
    return { modo: c.modo, sandbox: c.sandbox, tokenConfigurado: !!c.token }
  })
  app.put('/api/admin/aca/assinatura/config', { preHandler: authMiddleware }, async (req) => {
    const b = (req.body as any) || {}
    await setConfig({ modo: b.modo, token: b.token, sandbox: b.sandbox })
    const c = await getConfig()
    return { modo: c.modo, sandbox: c.sandbox, tokenConfigurado: !!c.token }
  })

  // ── Lista ──
  app.get('/api/admin/aca/assinatura', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const where: any = {}
    if (q.status) where.status = q.status
    if (q.alunoId) where.alunoId = Number(q.alunoId)
    const rows = await prisma.acaAssinatura.findMany({
      where, orderBy: { id: 'desc' }, take: 200,
      include: { signatarios: { select: { id: true, status: true } } },
    })
    const alunoIds = [...new Set(rows.map((r) => r.alunoId).filter(Boolean))] as number[]
    const alunos = alunoIds.length ? await prisma.aluno.findMany({ where: { id: { in: alunoIds } }, select: { id: true, ra: true, lead: { select: { nome: true } } } }) : []
    const aMap = new Map(alunos.map((a) => [a.id, a]))
    return {
      envelopes: rows.map((r) => ({
        id: r.id, titulo: r.titulo, status: r.status, provider: r.provider, enviadoEm: r.enviadoEm, finalizadoEm: r.finalizadoEm,
        alunoNome: r.alunoId ? aMap.get(r.alunoId)?.lead.nome ?? null : null,
        ra: r.alunoId ? aMap.get(r.alunoId)?.ra ?? null : null,
        totalSignatarios: r.signatarios.length, assinados: r.signatarios.filter((s) => s.status === 'ASSINADO').length,
      })),
    }
  })

  // ── Detalhe ──
  app.get('/api/admin/aca/assinatura/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const env = await prisma.acaAssinatura.findUnique({ where: { id: Number((req.params as any).id) }, include: ENV_INCLUDE })
    if (!env) return reply.code(404).send({ error: 'Envelope não encontrado' })
    return { envelope: env }
  })

  // ── Criar ──
  app.post('/api/admin/aca/assinatura', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    if (!b.titulo) return reply.code(400).send({ error: 'título obrigatório' })
    const env = await svc.criar({
      alunoId: b.alunoId ? Number(b.alunoId) : null, matriculaId: b.matriculaId ? Number(b.matriculaId) : null,
      contratoId: b.contratoId ? Number(b.contratoId) : null, titulo: String(b.titulo),
      termoTexto: b.termoTexto || null, signatarios: Array.isArray(b.signatarios) ? b.signatarios : undefined,
    })
    return reply.code(201).send({ envelope: env })
  })

  // ── Enviar / Sincronizar / Simular / Cancelar ──
  app.post('/api/admin/aca/assinatura/:id/enviar', { preHandler: authMiddleware }, async (req, reply) => {
    try { return { envelope: await svc.enviar(Number((req.params as any).id)) } }
    catch (e: any) { return reply.code(400).send({ error: e?.message || 'Falha ao enviar' }) }
  })
  app.post('/api/admin/aca/assinatura/:id/sincronizar', { preHandler: authMiddleware }, async (req, reply) => {
    try { return { envelope: await svc.sincronizar(Number((req.params as any).id)) } }
    catch (e: any) { return reply.code(400).send({ error: e?.message || 'Falha ao sincronizar' }) }
  })
  app.post('/api/admin/aca/assinatura/:id/simular/:sid', { preHandler: authMiddleware }, async (req, reply) => {
    try { return { envelope: await svc.simularAssinatura(Number((req.params as any).id), Number((req.params as any).sid)) } }
    catch (e: any) { return reply.code(400).send({ error: e?.message || 'Falha' }) }
  })
  app.post('/api/admin/aca/assinatura/:id/cancelar', { preHandler: authMiddleware }, async (req) =>
    ({ envelope: await svc.cancelar(Number((req.params as any).id)) }))

  // ── PDF do contrato (preview/gerado) ──
  app.get('/api/admin/aca/assinatura/:id/pdf', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const { buffer, titulo } = await svc.gerarPdf(Number((req.params as any).id))
      reply.header('Content-Type', 'application/pdf').header('Content-Disposition', `inline; filename="${titulo.replace(/[^\w.-]/g, '_')}.pdf"`)
      return reply.send(buffer)
    } catch (e: any) { return reply.code(404).send({ error: e?.message || 'PDF indisponível' }) }
  })

  // ── Webhook público da Autentique (sem auth) ──
  app.post('/api/webhooks/autentique', async (req, reply) => {
    try { const r = await svc.processarWebhook(req.body); return reply.code(200).send(r) }
    catch { return reply.code(200).send({ ok: true }) }
  })
}
