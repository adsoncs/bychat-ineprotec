// src/routes/helpdeskKb.ts
// Base de Conhecimento / Help Center (F6): CRUD admin + API pública (Help Center)
// com busca, votos, contagem de views e deflection (sugestões ao abrir chamado).

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'
import { getOperator } from '../services/leadHistory.js'

function slugify(s: string): string {
  return (s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200) || 'item'
}

async function uniqueArticleSlug(base: string, ignoreId?: number): Promise<string> {
  let slug = base
  for (let i = 0; i < 50; i++) {
    const found = await prisma.kbArticle.findUnique({ where: { slug }, select: { id: true } })
    if (!found || found.id === ignoreId) return slug
    slug = `${base}-${i + 2}`
  }
  return `${base}-${Date.now()}`
}
async function uniqueCategorySlug(base: string, ignoreId?: number): Promise<string> {
  let slug = base
  for (let i = 0; i < 50; i++) {
    const found = await prisma.kbCategory.findUnique({ where: { slug }, select: { id: true } })
    if (!found || found.id === ignoreId) return slug
    slug = `${base}-${i + 2}`
  }
  return `${base}-${Date.now()}`
}

// Constrói condições OR a partir das palavras do termo (>=3 chars), casando
// qualquer palavra em título/keywords/excerpt — melhor que substring da frase toda.
function buildSearchOR(term: string): any[] {
  const words = Array.from(new Set(term.toLowerCase().split(/\s+/).filter((w) => w.length >= 3)))
  if (!words.length) return [{ title: { contains: term } }]
  const or: any[] = []
  for (const w of words) or.push({ title: { contains: w } }, { keywords: { contains: w } }, { excerpt: { contains: w } })
  return or
}

const ARTICLE_PUBLIC_SELECT = {
  id: true, title: true, slug: true, excerpt: true, body: true, categoryId: true,
  votesUp: true, votesDown: true, viewCount: true, locale: true, updatedAt: true, publishedAt: true,
}

export async function helpdeskKbRoutes(app: FastifyInstance) {
  // ═══════════════ ADMIN: CATEGORIAS ═══════════════
  app.get('/api/admin/helpdesk/kb/categories', { preHandler: authMiddleware }, async () => ({
    categories: await prisma.kbCategory.findMany({ orderBy: [{ position: 'asc' }, { name: 'asc' }], include: { _count: { select: { articles: true } } } }),
  }))
  app.post('/api/admin/helpdesk/kb/categories', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    if (!b.name) return reply.code(400).send({ error: 'name obrigatório' })
    const slug = await uniqueCategorySlug(slugify(b.slug || b.name))
    const category = await prisma.kbCategory.create({ data: { name: String(b.name).slice(0, 150), slug, description: b.description ?? null, icon: b.icon ?? null, position: Number(b.position) || 0, active: b.active !== false } })
    return reply.code(201).send({ category })
  })
  app.put('/api/admin/helpdesk/kb/categories/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    if (!await prisma.kbCategory.findUnique({ where: { id } })) return reply.code(404).send({ error: 'Categoria não encontrada' })
    const b = (req.body as any) || {}
    const data: any = {}
    for (const k of ['name', 'description', 'icon', 'position', 'active']) if (k in b) data[k] = b[k]
    if (b.slug) data.slug = await uniqueCategorySlug(slugify(b.slug), id)
    return { category: await prisma.kbCategory.update({ where: { id }, data }) }
  })
  app.delete('/api/admin/helpdesk/kb/categories/:id', { preHandler: authMiddleware }, async (req) => {
    await prisma.kbCategory.delete({ where: { id: Number((req.params as any).id) } }).catch(() => null)
    return { ok: true }
  })

  // ═══════════════ ADMIN: ARTIGOS ═══════════════
  app.get('/api/admin/helpdesk/kb/articles', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as Record<string, string | undefined>
    const where: any = {}
    if (q.status) where.status = q.status
    if (q.categoryId) where.categoryId = Number(q.categoryId)
    if (q.q) where.OR = [{ title: { contains: q.q } }, { keywords: { contains: q.q } }]
    const articles = await prisma.kbArticle.findMany({ where, orderBy: { updatedAt: 'desc' }, take: 200 })
    return { articles }
  })
  app.get('/api/admin/helpdesk/kb/articles/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const article = await prisma.kbArticle.findUnique({ where: { id: Number((req.params as any).id) } })
    if (!article) return reply.code(404).send({ error: 'Artigo não encontrado' })
    return { article }
  })
  app.post('/api/admin/helpdesk/kb/articles', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    if (!b.title) return reply.code(400).send({ error: 'title obrigatório' })
    const op = getOperator(req)
    const slug = await uniqueArticleSlug(slugify(b.slug || b.title))
    const status = b.status === 'published' ? 'published' : 'draft'
    const article = await prisma.kbArticle.create({
      data: {
        title: String(b.title).slice(0, 255), slug,
        excerpt: b.excerpt ?? null, body: b.body ?? '', keywords: b.keywords ?? null,
        categoryId: b.categoryId != null ? Number(b.categoryId) : null,
        status, visibility: b.visibility === 'internal' ? 'internal' : 'public', locale: b.locale || 'pt-BR',
        seoTitle: b.seoTitle ?? null, seoDescription: b.seoDescription ?? null,
        authorId: op.userId ?? null, authorName: op.userName ?? null,
        publishedAt: status === 'published' ? new Date() : null,
      },
    })
    return reply.code(201).send({ article })
  })
  app.put('/api/admin/helpdesk/kb/articles/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const cur = await prisma.kbArticle.findUnique({ where: { id } })
    if (!cur) return reply.code(404).send({ error: 'Artigo não encontrado' })
    const b = (req.body as any) || {}
    const data: any = {}
    for (const k of ['title', 'excerpt', 'body', 'keywords', 'categoryId', 'visibility', 'locale', 'seoTitle', 'seoDescription']) if (k in b) data[k] = b[k]
    if (b.categoryId !== undefined) data.categoryId = b.categoryId != null ? Number(b.categoryId) : null
    if (b.slug) data.slug = await uniqueArticleSlug(slugify(b.slug), id)
    if (b.status && b.status !== cur.status) {
      data.status = b.status === 'published' ? 'published' : 'draft'
      if (data.status === 'published' && !cur.publishedAt) data.publishedAt = new Date()
    }
    return { article: await prisma.kbArticle.update({ where: { id }, data }) }
  })
  app.delete('/api/admin/helpdesk/kb/articles/:id', { preHandler: authMiddleware }, async (req) => {
    await prisma.kbArticle.delete({ where: { id: Number((req.params as any).id) } }).catch(() => null)
    return { ok: true }
  })

  // ═══════════════ PÚBLICO: HELP CENTER (sem auth — /api/v1/ escapa do gating) ═══════════════
  app.get('/api/v1/helpdesk/kb/categories', async () => ({
    categories: await prisma.kbCategory.findMany({ where: { active: true }, orderBy: [{ position: 'asc' }, { name: 'asc' }], select: { id: true, name: true, slug: true, description: true, icon: true } }),
  }))

  app.get('/api/v1/helpdesk/kb/articles', async (req) => {
    const q = req.query as Record<string, string | undefined>
    const where: any = { status: 'published', visibility: 'public' }
    if (q.categorySlug) {
      const cat = await prisma.kbCategory.findUnique({ where: { slug: q.categorySlug }, select: { id: true } })
      where.categoryId = cat?.id ?? -1
    }
    if (q.q) where.OR = buildSearchOR(q.q)
    const articles = await prisma.kbArticle.findMany({ where, orderBy: [{ viewCount: 'desc' }], take: 50, select: { id: true, title: true, slug: true, excerpt: true, categoryId: true, viewCount: true, updatedAt: true } })
    return { articles }
  })

  app.get('/api/v1/helpdesk/kb/articles/:slug', async (req, reply) => {
    const slug = (req.params as any).slug
    const article = await prisma.kbArticle.findFirst({ where: { slug, status: 'published', visibility: 'public' }, select: ARTICLE_PUBLIC_SELECT })
    if (!article) return reply.code(404).send({ error: 'Artigo não encontrado' })
    await prisma.kbArticle.update({ where: { id: article.id }, data: { viewCount: { increment: 1 } } }).catch(() => null)
    return { article }
  })

  app.post('/api/v1/helpdesk/kb/articles/:slug/vote', async (req, reply) => {
    const slug = (req.params as any).slug
    const dir = (req.body as any)?.dir === 'down' ? 'down' : 'up'
    const article = await prisma.kbArticle.findFirst({ where: { slug, status: 'published' }, select: { id: true } })
    if (!article) return reply.code(404).send({ error: 'Artigo não encontrado' })
    await prisma.kbArticle.update({ where: { id: article.id }, data: dir === 'up' ? { votesUp: { increment: 1 } } : { votesDown: { increment: 1 } } })
    return { ok: true }
  })

  // Deflection: artigos sugeridos a partir de um texto (assunto do chamado).
  app.get('/api/v1/helpdesk/kb/suggest', async (req) => {
    const term = ((req.query as any).q || '').toString().trim()
    if (term.length < 3) return { articles: [] }
    const articles = await prisma.kbArticle.findMany({
      where: { status: 'published', visibility: 'public', OR: buildSearchOR(term) },
      orderBy: [{ viewCount: 'desc' }], take: 5,
      select: { id: true, title: true, slug: true, excerpt: true },
    })
    return { articles }
  })

  // POST /api/v1/helpdesk/kb/ask ── Answer-bot generativo (F17). Responde com a IA
  // a partir da KB; se a IA estiver indisponível/falhar, cai p/ artigos (deflection).
  app.post('/api/v1/helpdesk/kb/ask', async (req) => {
    const question = ((req.body as any)?.question || '').toString().trim()
    if (question.length < 3) return { answer: '', articles: [], answered: false, aiAvailable: false }
    const matched = await prisma.kbArticle.findMany({
      where: { status: 'published', visibility: 'public', OR: buildSearchOR(question) },
      orderBy: [{ viewCount: 'desc' }], take: 4,
      select: { title: true, slug: true, excerpt: true },
    })
    try {
      const { aiConfigured, aiAnswerFromKb } = await import('../services/helpdeskAi.js')
      if (!(await aiConfigured())) return { answer: '', articles: matched, answered: false, aiAvailable: false }
      const r = await aiAnswerFromKb(question)
      return { answer: r.answer, answered: r.answered, articles: r.articles.length ? r.articles : matched, aiAvailable: true }
    } catch (e) {
      return { answer: '', articles: matched, answered: false, aiAvailable: false, error: (e as Error).message }
    }
  })

  // Versão autenticada do suggest (para o painel do agente, sem depender de /api/v1).
  app.get('/api/helpdesk/kb/suggest', { preHandler: authMiddleware }, async (req) => {
    const term = ((req.query as any).q || '').toString().trim()
    if (term.length < 3) return { articles: [] }
    const articles = await prisma.kbArticle.findMany({
      where: { status: 'published', OR: buildSearchOR(term) },
      orderBy: [{ viewCount: 'desc' }], take: 5,
      select: { id: true, title: true, slug: true, excerpt: true },
    })
    return { articles }
  })
}
