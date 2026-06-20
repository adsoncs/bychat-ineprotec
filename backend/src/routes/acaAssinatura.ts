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

  // ── Criar (escrito / upload / inline) ──
  app.post('/api/admin/aca/assinatura', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    if (!b.titulo) return reply.code(400).send({ error: 'título obrigatório' })
    const env = await svc.criar({
      alunoId: b.alunoId ? Number(b.alunoId) : null, matriculaId: b.matriculaId ? Number(b.matriculaId) : null,
      contratoId: b.contratoId ? Number(b.contratoId) : null, titulo: String(b.titulo),
      origem: b.origem, templateId: b.templateId ? Number(b.templateId) : null, tipoNegocio: b.tipoNegocio || null,
      corpoTexto: b.corpoTexto || null, arquivoBase64: b.arquivoBase64 || null, arquivoNome: b.arquivoNome || null,
      deadlineEm: b.deadlineEm || null, reminder: b.reminder || null, sortable: !!b.sortable, refusable: b.refusable !== false, mensagem: b.mensagem || null,
      signatarios: Array.isArray(b.signatarios) ? b.signatarios : undefined,
    })
    return reply.code(201).send({ envelope: env })
  })

  // ── Criar a partir de um template ──
  app.post('/api/admin/aca/assinatura/de-template', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    if (!b.templateId) return reply.code(400).send({ error: 'templateId obrigatório' })
    try {
      const env = await svc.criarDeTemplate(Number(b.templateId), { alunoId: b.alunoId ? Number(b.alunoId) : null, matriculaId: b.matriculaId ? Number(b.matriculaId) : null, contratoId: b.contratoId ? Number(b.contratoId) : null, titulo: b.titulo })
      return reply.code(201).send({ envelope: env })
    } catch (e: any) { return reply.code(400).send({ error: e?.message || 'Falha' }) }
  })

  app.get('/api/admin/aca/assinatura/variaveis', { preHandler: authMiddleware }, async () => ({ variaveis: svc.VARIAVEIS_DISPONIVEIS }))

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
  app.post('/api/admin/aca/assinatura/:id/reenviar', { preHandler: authMiddleware }, async (req, reply) => {
    try { return await svc.reenviar(Number((req.params as any).id)) }
    catch (e: any) { return reply.code(400).send({ error: e?.message || 'Falha' }) }
  })

  // ── Templates de contrato (por tipo de negócio) ──
  app.get('/api/admin/aca/assinatura/templates', { preHandler: authMiddleware }, async () =>
    ({ templates: await prisma.acaContratoTemplate.findMany({ orderBy: [{ ordem: 'asc' }, { id: 'asc' }] }) }))
  app.post('/api/admin/aca/assinatura/templates', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    if (!b.nome || !b.corpoTexto) return reply.code(400).send({ error: 'nome e corpo obrigatórios' })
    const t = await prisma.acaContratoTemplate.create({ data: {
      nome: String(b.nome).slice(0, 191), tipoNegocio: b.tipoNegocio || 'OUTRO', descricao: b.descricao || null,
      corpoTexto: String(b.corpoTexto), config: b.config ?? null, signatariosPadrao: b.signatariosPadrao ?? null,
      ativo: b.ativo !== false, ordem: Number(b.ordem) || 0,
    } })
    return reply.code(201).send({ template: t })
  })
  app.put('/api/admin/aca/assinatura/templates/:id', { preHandler: authMiddleware }, async (req) => {
    const b = (req.body as any) || {}; const data: any = {}
    for (const k of ['nome', 'tipoNegocio', 'descricao', 'corpoTexto']) if (k in b) data[k] = b[k]
    if ('config' in b) data.config = b.config ?? null
    if ('signatariosPadrao' in b) data.signatariosPadrao = b.signatariosPadrao ?? null
    if ('ativo' in b) data.ativo = !!b.ativo
    if ('ordem' in b) data.ordem = Number(b.ordem) || 0
    return { template: await prisma.acaContratoTemplate.update({ where: { id: Number((req.params as any).id) }, data }) }
  })
  app.delete('/api/admin/aca/assinatura/templates/:id', { preHandler: authMiddleware }, async (req) => {
    await prisma.acaContratoTemplate.delete({ where: { id: Number((req.params as any).id) } }).catch(() => {})
    return { ok: true }
  })

  // ── Gatilhos (disparo automático por evento) ──
  app.get('/api/admin/aca/assinatura/gatilhos', { preHandler: authMiddleware }, async () => {
    const gs = await prisma.acaContratoGatilho.findMany({ orderBy: { id: 'desc' } })
    const tids = [...new Set(gs.map((g) => g.templateId))]
    const ts = tids.length ? await prisma.acaContratoTemplate.findMany({ where: { id: { in: tids } }, select: { id: true, nome: true } }) : []
    const tMap = new Map(ts.map((t) => [t.id, t.nome]))
    return { gatilhos: gs.map((g) => ({ ...g, templateNome: tMap.get(g.templateId) ?? null })) }
  })
  app.post('/api/admin/aca/assinatura/gatilhos', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    if (!b.nome || !b.evento || !b.templateId) return reply.code(400).send({ error: 'nome, evento e template obrigatórios' })
    const g = await prisma.acaContratoGatilho.create({ data: {
      nome: String(b.nome).slice(0, 191), evento: b.evento, templateId: Number(b.templateId),
      filtroTipoNegocio: b.filtroTipoNegocio || null, autoEnviar: !!b.autoEnviar, ativo: b.ativo !== false,
    } })
    return reply.code(201).send({ gatilho: g })
  })
  app.put('/api/admin/aca/assinatura/gatilhos/:id', { preHandler: authMiddleware }, async (req) => {
    const b = (req.body as any) || {}; const data: any = {}
    for (const k of ['nome', 'evento', 'filtroTipoNegocio']) if (k in b) data[k] = b[k] || null
    if ('templateId' in b) data.templateId = Number(b.templateId)
    if ('autoEnviar' in b) data.autoEnviar = !!b.autoEnviar
    if ('ativo' in b) data.ativo = !!b.ativo
    return { gatilho: await prisma.acaContratoGatilho.update({ where: { id: Number((req.params as any).id) }, data }) }
  })
  app.delete('/api/admin/aca/assinatura/gatilhos/:id', { preHandler: authMiddleware }, async (req) => {
    await prisma.acaContratoGatilho.delete({ where: { id: Number((req.params as any).id) } }).catch(() => {})
    return { ok: true }
  })

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
