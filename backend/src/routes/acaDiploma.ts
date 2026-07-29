// src/routes/acaDiploma.ts
// Módulo Acadêmico · F17 — Diploma Digital MEC (rotas /api/admin/aca/diploma +
// página pública de validação /diploma/validar).

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'
import { HEAD, esc } from './acaPortal.js'
import { diplomaConfig, criarDiploma, gerarXmlDiploma, assinarDiploma, registrarDiploma, anularDiploma, validarPorCodigo } from '../services/acaDiploma.js'

const ST_LABEL: Record<string, string> = { RASCUNHO: 'Rascunho', XML_GERADO: 'XML gerado', ASSINADO: 'Assinado', REGISTRADO: 'Registrado', ANULADO: 'Anulado' }

export async function acaDiplomaRoutes(app: FastifyInstance) {
  // ── Config da IES ──
  app.get('/api/admin/aca/diploma/config', { preHandler: authMiddleware }, async () => ({ config: await diplomaConfig() }))
  app.put('/api/admin/aca/diploma/config', { preHandler: authMiddleware }, async (req) => {
    const b = (req.body as any) || {}
    const data: any = {}
    for (const k of ['iesEmissora', 'cnpjEmissora', 'codigoMecEmissora', 'iesRegistradora', 'codigoMecRegistradora', 'reitor', 'secretario', 'provedorAssinatura']) if (k in b) data[k] = b[k] || null
    if ('ativo' in b) data.ativo = !!b.ativo
    const ex = await prisma.acaDiplomaConfig.findFirst()
    return { config: ex ? await prisma.acaDiplomaConfig.update({ where: { id: ex.id }, data }) : await prisma.acaDiplomaConfig.create({ data }) }
  })

  // ── Lista: concluintes + status do diploma ──
  app.get('/api/admin/aca/diploma/diplomas', { preHandler: authMiddleware }, async () => {
    const mats = await prisma.acaMatricula.findMany({
      where: { status: 'CONCLUIDO' }, orderBy: { dataConclusao: 'desc' }, take: 500,
      select: { id: true, dataConclusao: true, aluno: { select: { ra: true, lead: { select: { nome: true } } } } },
    })
    const diplomas = await prisma.acaDiploma.findMany({ where: { matriculaId: { in: mats.map((m) => m.id) } } })
    const dMap = new Map(diplomas.map((d) => [d.matriculaId, d]))
    return {
      itens: mats.map((m) => {
        const d = dMap.get(m.id)
        return { matriculaId: m.id, alunoNome: m.aluno.lead.nome, ra: m.aluno.ra, dataConclusao: m.dataConclusao, diplomaId: d?.id ?? null, status: d?.status ?? null, numero: d?.numero ?? null, codigoValidacao: d?.codigoValidacao ?? null }
      }),
    }
  })

  const wrap = (fn: () => Promise<any>) => async (_req: any, reply: any) => { try { return await fn() } catch (e: any) { return reply.code(400).send({ error: e?.message || 'erro' }) } }

  app.post('/api/admin/aca/diploma/diplomas', { preHandler: authMiddleware }, async (req, reply) =>
    wrap(async () => {
      const b = (req.body as any) || {}
      return { diploma: await criarDiploma(Number(b.matriculaId), { ignorarEnade: !!b.ignorarEnade, justificativaEnade: b.justificativaEnade }) }
    })(req, reply))
  app.post('/api/admin/aca/diploma/diplomas/:id/xml', { preHandler: authMiddleware }, async (req, reply) =>
    wrap(async () => ({ diploma: await gerarXmlDiploma(Number((req.params as any).id)) }))(req, reply))
  app.post('/api/admin/aca/diploma/diplomas/:id/assinar', { preHandler: authMiddleware }, async (req, reply) =>
    wrap(async () => ({ diploma: await assinarDiploma(Number((req.params as any).id), String((req.body as any)?.assinaturaInfo || 'Assinatura registrada (integração ICP-Brasil)')) }))(req, reply))
  app.post('/api/admin/aca/diploma/diplomas/:id/registrar', { preHandler: authMiddleware }, async (req, reply) =>
    wrap(async () => ({ diploma: await registrarDiploma(Number((req.params as any).id), (req.body as any) || {}) }))(req, reply))
  app.post('/api/admin/aca/diploma/diplomas/:id/anular', { preHandler: authMiddleware }, async (req, reply) =>
    wrap(async () => ({ diploma: await anularDiploma(Number((req.params as any).id), String((req.body as any)?.motivo || '')) }))(req, reply))

  app.get('/api/admin/aca/diploma/diplomas/:id/xml', { preHandler: authMiddleware }, async (req, reply) => {
    const d = await prisma.acaDiploma.findUnique({ where: { id: Number((req.params as any).id) }, select: { xmlDiplomado: true, codigoValidacao: true } })
    if (!d?.xmlDiplomado) return reply.code(404).send({ error: 'XML não gerado' })
    reply.header('Content-Type', 'application/xml; charset=utf-8').header('Content-Disposition', `attachment; filename="diploma-${d.codigoValidacao || 'doc'}.xml"`).send(d.xmlDiplomado)
  })

  // ── Validação pública (sem auth) ──
  app.get('/api/public/aca/diploma/validar', async (req, reply) => {
    const r = await validarPorCodigo(String((req.query as any)?.codigo || ''))
    if (!r) return reply.code(404).send({ error: 'Código não encontrado' })
    return r
  })
  app.get('/diploma/validar', async (req, reply) => {
    const codigo = String((req.query as any)?.codigo || '')
    const r = codigo ? await validarPorCodigo(codigo) : null
    const body = !r ? `<div class="card"><h1>Diploma não encontrado</h1><p class="sub">Verifique o código informado.</p></div>`
      : r.anulado ? `<div class="card" style="border-color:#f5b5b5"><h1 style="color:#a11">Diploma ANULADO</h1><p class="sub">Este diploma foi anulado e não tem validade.</p></div>`
      : `<div class="card"><h1>${r.valido ? '✅ Diploma autêntico' : '⏳ Diploma em processamento'}</h1>
          <p class="sub">Situação: <b>${ST_LABEL[r.status] || r.status}</b></p>
          <table><tbody>
          <tr><td>Diplomado</td><td><b>${esc(r.nome)}</b></td></tr>
          <tr><td>Curso</td><td>${esc(r.curso)}</td></tr>
          <tr><td>Carga horária</td><td>${r.cargaHoraria}h</td></tr>
          ${r.numero ? `<tr><td>Número</td><td>${esc(r.numero)}</td></tr>` : ''}
          ${r.dataEmissao ? `<tr><td>Emissão</td><td>${new Date(r.dataEmissao).toLocaleDateString('pt-BR')}</td></tr>` : ''}
          </tbody></table></div>`
    reply.type('text/html').send(`<!doctype html><html lang="pt-BR"><head><title>Validação de Diploma Digital</title>${HEAD}</head><body><h1>Validação de Diploma Digital</h1><p class="sub">Código: <code>${esc(codigo)}</code></p>${body}<footer>Validação pública de diploma digital.</footer></body></html>`)
  })
}
