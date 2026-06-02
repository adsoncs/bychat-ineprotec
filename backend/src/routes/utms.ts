// src/routes/utms.ts
//
// CRUD da biblioteca de UTMs (Ferramentas > UTMs).
// O `fullUrl` é montado server-side a partir dos campos — fonte da verdade.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { adminOnly, type JwtPayload } from '../lib/auth.js'

interface UtmInput {
  name?: string
  baseUrl?: string
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  utmTerm?: string | null
  utmContent?: string | null
  utmId?: string | null
  notes?: string | null
  tags?: string[] | null
  active?: boolean
  archived?: boolean
}

function s(v: any, max: number): string {
  if (v === null || v === undefined) return ''
  return String(v).trim().substring(0, max)
}

function buildFullUrl(input: {
  baseUrl: string
  utmSource: string
  utmMedium: string
  utmCampaign: string
  utmTerm?: string | null
  utmContent?: string | null
  utmId?: string | null
}): string {
  // Aceita URL com path/query/hash. Se já houver UTMs, sobrescreve as do mesmo nome.
  let url: URL
  try {
    url = new URL(input.baseUrl)
  } catch {
    return input.baseUrl // se inválida, retorna como veio — UI valida antes
  }
  url.searchParams.set('utm_source', input.utmSource)
  url.searchParams.set('utm_medium', input.utmMedium)
  url.searchParams.set('utm_campaign', input.utmCampaign)
  if (input.utmTerm)    url.searchParams.set('utm_term', input.utmTerm)
  else                  url.searchParams.delete('utm_term')
  if (input.utmContent) url.searchParams.set('utm_content', input.utmContent)
  else                  url.searchParams.delete('utm_content')
  if (input.utmId)      url.searchParams.set('utm_id', input.utmId)
  else                  url.searchParams.delete('utm_id')
  return url.toString()
}

function validateRequired(body: UtmInput): string | null {
  if (!body.name || !s(body.name, 191)) return 'Nome é obrigatório'
  if (!body.baseUrl || !s(body.baseUrl, 2048)) return 'URL base é obrigatória'
  try { new URL(String(body.baseUrl)) } catch { return 'URL base inválida' }
  if (!body.utmSource || !s(body.utmSource, 100)) return 'utm_source é obrigatório'
  if (!body.utmMedium || !s(body.utmMedium, 100)) return 'utm_medium é obrigatório'
  if (!body.utmCampaign || !s(body.utmCampaign, 191)) return 'utm_campaign é obrigatório'
  return null
}

function buildDataFromInput(body: UtmInput) {
  const baseUrl   = s(body.baseUrl, 2048)
  const utmSource = s(body.utmSource, 100)
  const utmMedium = s(body.utmMedium, 100)
  const utmCampaign = s(body.utmCampaign, 191)
  const utmTerm    = body.utmTerm ? s(body.utmTerm, 191) : null
  const utmContent = body.utmContent ? s(body.utmContent, 191) : null
  const utmId      = body.utmId ? s(body.utmId, 191) : null
  const fullUrl = buildFullUrl({ baseUrl, utmSource, utmMedium, utmCampaign, utmTerm, utmContent, utmId })
  return {
    name: s(body.name, 191),
    baseUrl,
    utmSource,
    utmMedium,
    utmCampaign,
    utmTerm,
    utmContent,
    utmId,
    fullUrl,
    notes: body.notes ? s(body.notes, 10_000) : null,
    tags: Array.isArray(body.tags) ? (body.tags.slice(0, 20).map(t => s(t, 60)).filter(Boolean) as any) : null,
    active: body.active !== false,
    archived: !!body.archived,
  }
}

export async function utmsRoutes(app: FastifyInstance) {

  // GET /api/admin/utms — listar com filtros simples (search/archived/active/tag)
  app.get('/api/admin/utms', { preHandler: adminOnly }, async (req) => {
    const q = req.query as any
    const search = typeof q?.search === 'string' ? q.search.trim() : ''
    const showArchived = q?.archived === 'true' || q?.archived === '1'
    const onlyActive = q?.active === 'true' || q?.active === '1'

    const where: any = { archived: showArchived }
    if (onlyActive) where.active = true
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { utmCampaign: { contains: search } },
        { utmSource: { contains: search } },
        { utmMedium: { contains: search } },
        { baseUrl: { contains: search } },
      ]
    }

    const [data, total] = await Promise.all([
      prisma.utmLink.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        take: 500,
      }),
      prisma.utmLink.count({ where }),
    ])
    return { data, total }
  })

  // GET /api/admin/utms/suggestions — autocompleta source/medium/campaign do uso histórico
  app.get('/api/admin/utms/suggestions', { preHandler: adminOnly }, async () => {
    const [sources, mediums, campaigns] = await Promise.all([
      prisma.utmLink.findMany({ distinct: ['utmSource'], select: { utmSource: true }, take: 200 }),
      prisma.utmLink.findMany({ distinct: ['utmMedium'], select: { utmMedium: true }, take: 200 }),
      prisma.utmLink.findMany({ distinct: ['utmCampaign'], select: { utmCampaign: true }, take: 500, orderBy: { updatedAt: 'desc' } }),
    ])
    return {
      sources: sources.map(s => s.utmSource).filter(Boolean),
      mediums: mediums.map(m => m.utmMedium).filter(Boolean),
      campaigns: campaigns.map(c => c.utmCampaign).filter(Boolean),
    }
  })

  // GET /api/admin/utms/:id
  app.get('/api/admin/utms/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const row = await prisma.utmLink.findUnique({ where: { id: parseInt(id) } })
    if (!row) return reply.code(404).send({ error: 'UTM não encontrada' })
    return { data: row }
  })

  // POST /api/admin/utms
  app.post('/api/admin/utms', { preHandler: adminOnly }, async (req, reply) => {
    const body = (req.body as UtmInput) || {}
    const err = validateRequired(body)
    if (err) return reply.code(400).send({ error: err })

    const user = (req as any).user as JwtPayload
    const data = buildDataFromInput(body)
    const row = await prisma.utmLink.create({
      data: { ...data, createdById: user?.userId ?? null } as any,
    })
    return reply.code(201).send({ data: row })
  })

  // PUT /api/admin/utms/:id
  app.put('/api/admin/utms/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const body = (req.body as UtmInput) || {}
    const err = validateRequired(body)
    if (err) return reply.code(400).send({ error: err })

    const data = buildDataFromInput(body)
    try {
      const row = await prisma.utmLink.update({ where: { id: parseInt(id) }, data: data as any })
      return { data: row }
    } catch (e: any) {
      return reply.code(404).send({ error: e.message })
    }
  })

  // PATCH /api/admin/utms/:id/archive — toggle arquivar/restaurar
  app.patch('/api/admin/utms/:id/archive', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const body = (req.body as any) || {}
    try {
      const row = await prisma.utmLink.update({
        where: { id: parseInt(id) },
        data: { archived: !!body.archived },
      })
      return { data: row }
    } catch (e: any) {
      return reply.code(404).send({ error: e.message })
    }
  })

  // DELETE /api/admin/utms/:id — apaga (use archive quando quiser preservar histórico)
  app.delete('/api/admin/utms/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    try {
      await prisma.utmLink.delete({ where: { id: parseInt(id) } })
      return { ok: true }
    } catch (e: any) {
      return reply.code(404).send({ error: e.message })
    }
  })
}
