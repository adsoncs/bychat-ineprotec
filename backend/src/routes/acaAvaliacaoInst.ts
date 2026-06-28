// src/routes/acaAvaliacaoInst.ts
// Módulo Acadêmico · F13 — Avaliação Institucional / CPA. Questionários por
// dimensões + perguntas (escala/NPS/texto/sim-não), aplicação por link público
// (magic-link, kind 'aca-aval') e dashboard de resultados.

import crypto from 'crypto'
import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'
import { mintPortalToken as mintToken, verifyPortalToken as verifyToken } from '../lib/acaPortalToken.js'
import { HEAD, esc, baseUrl } from './acaPortal.js'

const TIPO_LABEL: Record<string, string> = { ESCALA: 'Escala (1–5)', NPS: 'NPS (0–10)', TEXTO: 'Texto livre', SIMNAO: 'Sim / Não' }

export async function acaAvaliacaoInstRoutes(app: FastifyInstance) {
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    try { const out: Record<string, any> = {}; for (const [k, v] of new URLSearchParams(body as string)) out[k] = v; done(null, out) }
    catch (e) { done(e as Error, undefined) }
  })
  const tokOf = (req: any) => (req.query?.t as string) || ''

  // ───────── Avaliações ─────────
  app.get('/api/admin/aca/avaliacao-inst', { preHandler: authMiddleware }, async () => {
    const rows = await prisma.acaAvaliacaoInst.findMany({ orderBy: { id: 'desc' }, take: 200, include: { _count: { select: { dimensoes: true } } } })
    const ids = rows.map((r) => r.id)
    const parts = ids.length ? await prisma.acaAvalResposta.findMany({ where: { avaliacaoId: { in: ids } }, select: { avaliacaoId: true, sessaoId: true }, distinct: ['avaliacaoId', 'sessaoId'] }) : []
    const pMap: Record<number, number> = {}
    for (const p of parts) pMap[p.avaliacaoId] = (pMap[p.avaliacaoId] ?? 0) + 1
    return { avaliacoes: rows.map((r) => ({ ...r, dimensoes: r._count.dimensoes, participacoes: pMap[r.id] ?? 0 })) }
  })
  app.post('/api/admin/aca/avaliacao-inst', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    if (!b.nome) return reply.code(400).send({ error: 'nome obrigatório' })
    return reply.code(201).send({ avaliacao: await prisma.acaAvaliacaoInst.create({ data: { nome: String(b.nome).slice(0, 191), descricao: b.descricao || null, publico: ['ALUNO', 'PROFESSOR', 'TODOS'].includes(b.publico) ? b.publico : 'TODOS', anonima: b.anonima !== false } }) })
  })
  app.put('/api/admin/aca/avaliacao-inst/:id', { preHandler: authMiddleware }, async (req) => {
    const id = Number((req.params as any).id); const b = (req.body as any) || {}
    const data: any = {}
    if ('nome' in b) data.nome = String(b.nome).slice(0, 191)
    if ('descricao' in b) data.descricao = b.descricao || null
    if ('publico' in b && ['ALUNO', 'PROFESSOR', 'TODOS'].includes(b.publico)) data.publico = b.publico
    if ('status' in b && ['RASCUNHO', 'ABERTA', 'ENCERRADA'].includes(b.status)) data.status = b.status
    if ('anonima' in b) data.anonima = !!b.anonima
    return { avaliacao: await prisma.acaAvaliacaoInst.update({ where: { id }, data }) }
  })

  // ── Estrutura (dimensões + perguntas) ──
  app.get('/api/admin/aca/avaliacao-inst/:id/estrutura', { preHandler: authMiddleware }, async (req) => {
    const avaliacaoId = Number((req.params as any).id)
    const dims = await prisma.acaAvalDimensao.findMany({ where: { avaliacaoId }, orderBy: [{ ordem: 'asc' }, { id: 'asc' }], include: { perguntas: { orderBy: [{ ordem: 'asc' }, { id: 'asc' }] } } })
    return { dimensoes: dims }
  })
  app.post('/api/admin/aca/avaliacao-inst/:id/dimensoes', { preHandler: authMiddleware }, async (req, reply) => {
    const avaliacaoId = Number((req.params as any).id); const b = (req.body as any) || {}
    if (!b.nome) return reply.code(400).send({ error: 'nome obrigatório' })
    return reply.code(201).send({ dimensao: await prisma.acaAvalDimensao.create({ data: { avaliacaoId, nome: String(b.nome).slice(0, 191), ordem: Number(b.ordem) || 0 } }) })
  })
  app.delete('/api/admin/aca/avaliacao-inst/dimensoes/:id', { preHandler: authMiddleware }, async (req) => {
    await prisma.acaAvalDimensao.delete({ where: { id: Number((req.params as any).id) } }); return { ok: true }
  })
  app.post('/api/admin/aca/avaliacao-inst/dimensoes/:id/perguntas', { preHandler: authMiddleware }, async (req, reply) => {
    const dimensaoId = Number((req.params as any).id); const b = (req.body as any) || {}
    if (!b.enunciado) return reply.code(400).send({ error: 'enunciado obrigatório' })
    return reply.code(201).send({ pergunta: await prisma.acaAvalPergunta.create({ data: { dimensaoId, tipo: ['ESCALA', 'NPS', 'TEXTO', 'SIMNAO'].includes(b.tipo) ? b.tipo : 'ESCALA', enunciado: String(b.enunciado).slice(0, 2000), ordem: Number(b.ordem) || 0 } }) })
  })
  app.delete('/api/admin/aca/avaliacao-inst/perguntas/:id', { preHandler: authMiddleware }, async (req) => {
    await prisma.acaAvalPergunta.delete({ where: { id: Number((req.params as any).id) } }); return { ok: true }
  })

  // ── Link público ──
  app.post('/api/admin/aca/avaliacao-inst/:id/link', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id); const b = (req.body as any) || {}
    const dias = Math.min(Math.max(Number(b.dias) || 60, 1), 365)
    const av = await prisma.acaAvaliacaoInst.findUnique({ where: { id }, select: { id: true } })
    if (!av) return reply.code(404).send({ error: 'Avaliação não encontrada' })
    const token = mintToken('aca-aval', id, dias)
    return { url: `${baseUrl(req)}/aval?t=${encodeURIComponent(token)}`, token }
  })

  // ── Resultado (agregação) ──
  app.get('/api/admin/aca/avaliacao-inst/:id/resultado', { preHandler: authMiddleware }, async (req) => {
    const avaliacaoId = Number((req.params as any).id)
    const dims = await prisma.acaAvalDimensao.findMany({ where: { avaliacaoId }, orderBy: [{ ordem: 'asc' }], include: { perguntas: { orderBy: [{ ordem: 'asc' }] } } })
    const respostas = await prisma.acaAvalResposta.findMany({ where: { avaliacaoId } })
    const porPergunta = new Map<number, typeof respostas>()
    for (const r of respostas) { const a = porPergunta.get(r.perguntaId) ?? []; a.push(r); porPergunta.set(r.perguntaId, a) }
    const participacoes = new Set(respostas.map((r) => r.sessaoId)).size

    const dimsOut = dims.map((d) => {
      const perguntas = d.perguntas.map((p) => {
        const rs = porPergunta.get(p.id) ?? []
        if (p.tipo === 'TEXTO') return { id: p.id, enunciado: p.enunciado, tipo: p.tipo, respostas: rs.filter((r) => r.texto).map((r) => r.texto), n: rs.length }
        const vals = rs.map((r) => r.valor).filter((v) => v != null) as number[]
        const media = vals.length ? Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 100) / 100 : null
        let nps: number | null = null
        if (p.tipo === 'NPS' && vals.length) {
          const prom = vals.filter((v) => v >= 9).length, det = vals.filter((v) => v <= 6).length
          nps = Math.round(((prom - det) / vals.length) * 100)
        }
        let pctSim: number | null = null
        if (p.tipo === 'SIMNAO' && vals.length) pctSim = Math.round((vals.filter((v) => v === 1).length / vals.length) * 100)
        return { id: p.id, enunciado: p.enunciado, tipo: p.tipo, media, nps, pctSim, n: vals.length }
      })
      const escalas = perguntas.filter((p) => p.tipo === 'ESCALA' && p.media != null).map((p) => p.media as number)
      const mediaDim = escalas.length ? Math.round((escalas.reduce((s, v) => s + v, 0) / escalas.length) * 100) / 100 : null
      return { id: d.id, nome: d.nome, mediaDim, perguntas }
    })
    return { participacoes, dimensoes: dimsOut }
  })

  // ───────── Público: formulário SSR ─────────
  app.get('/aval', async (req, reply) => {
    const p = verifyToken(tokOf(req), 'aca-aval')
    const pageErr = (code: number, t: string, s = '') => reply.code(code).type('text/html').send(`<!doctype html><html lang="pt-BR"><head><title>${t}</title>${HEAD}</head><body><div class="card"><h1>${t}</h1>${s ? `<p class="sub">${s}</p>` : ''}</div></body></html>`)
    if (!p) return pageErr(403, 'Link inválido ou expirado')
    const av = await prisma.acaAvaliacaoInst.findUnique({ where: { id: p.id }, include: { dimensoes: { orderBy: [{ ordem: 'asc' }], include: { perguntas: { orderBy: [{ ordem: 'asc' }] } } } } })
    if (!av) return pageErr(404, 'Avaliação não encontrada')
    if (av.status !== 'ABERTA') return pageErr(403, 'Avaliação indisponível', 'Esta avaliação não está aberta para respostas no momento.')
    const tk = encodeURIComponent(tokOf(req))

    const campo = (pid: number, tipo: string) => {
      if (tipo === 'ESCALA') return `<div>${[1, 2, 3, 4, 5].map((v) => `<label style="margin-right:10px"><input type="radio" name="q_${pid}" value="${v}" required> ${v}</label>`).join('')}</div>`
      if (tipo === 'NPS') return `<div style="display:flex;flex-wrap:wrap;gap:6px">${Array.from({ length: 11 }, (_, v) => `<label style="font-size:13px"><input type="radio" name="q_${pid}" value="${v}" required> ${v}</label>`).join('')}</div>`
      if (tipo === 'SIMNAO') return `<div><label style="margin-right:12px"><input type="radio" name="q_${pid}" value="1" required> Sim</label><label><input type="radio" name="q_${pid}" value="0"> Não</label></div>`
      return `<textarea name="q_${pid}" rows="3" style="width:100%"></textarea>`
    }
    const body = av.dimensoes.map((d) => `<div class="card"><h2 style="margin-top:0">${esc(d.nome)}</h2>${d.perguntas.map((q) => `<div style="margin-bottom:14px"><div style="font-size:14px;margin-bottom:5px">${esc(q.enunciado)}</div>${campo(q.id, q.tipo)}</div>`).join('')}</div>`).join('')

    reply.type('text/html').send(`<!doctype html><html lang="pt-BR"><head><title>${esc(av.nome)}</title>${HEAD}</head><body>
      <h1>${esc(av.nome)}</h1>${av.descricao ? `<p class="sub">${esc(av.descricao)}</p>` : ''}
      ${av.anonima ? '<p class="sub">🔒 Respostas anônimas.</p>' : ''}
      <form method="post" action="/api/public/aca/aval/responder?t=${tk}">${body}<div style="margin-top:8px"><button type="submit">Enviar respostas</button></div></form>
      <footer>Avaliação institucional.</footer></body></html>`)
  })

  app.post('/api/public/aca/aval/responder', async (req, reply) => {
    const tok = tokOf(req); const p = verifyToken(tok, 'aca-aval')
    if (!p) return reply.code(403).send({ error: 'token inválido' })
    const av = await prisma.acaAvaliacaoInst.findUnique({ where: { id: p.id }, select: { status: true } })
    if (!av || av.status !== 'ABERTA') return reply.code(403).send({ error: 'avaliação não está aberta' })
    const perguntas = await prisma.acaAvalPergunta.findMany({ where: { dimensao: { avaliacaoId: p.id } }, select: { id: true, tipo: true } })
    const b = (req.body as any) || {}
    const sessaoId = crypto.randomUUID()
    const data: any[] = []
    for (const q of perguntas) {
      const raw = b[`q_${q.id}`]
      if (raw == null || raw === '') continue
      if (q.tipo === 'TEXTO') data.push({ avaliacaoId: p.id, perguntaId: q.id, sessaoId, texto: String(raw).slice(0, 4000) })
      else { const v = Number(raw); if (!Number.isNaN(v)) data.push({ avaliacaoId: p.id, perguntaId: q.id, sessaoId, valor: v }) }
    }
    if (data.length) await prisma.acaAvalResposta.createMany({ data })
    return reply.type('text/html').send(`<!doctype html><html lang="pt-BR"><head><title>Obrigado</title>${HEAD}</head><body><div class="card"><h1>Respostas enviadas ✅</h1><p class="sub">Obrigado por participar da avaliação institucional.</p></div></body></html>`)
  })
}
