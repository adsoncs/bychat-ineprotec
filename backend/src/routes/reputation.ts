// src/routes/reputation.ts
// Radar de Reputação — API de leitura da base ingerida do Consumidor.gov.br
// e disparo manual da ingestão. Ver services/reputationIngest.ts.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { adminOnly } from '../lib/auth.js'
import { ingestPeriod, ingestMissing, listPublications } from '../services/reputationIngest.js'
import { scanMany, domainsFromLeads, normalizeDomain } from '../services/webStackDetect.js'
import { discoverAgencies } from '../services/competitorRadar.js'
import { checkCredits } from '../services/apifyClient.js'
import { listCensusReleases, ingestCensusYear, ingestMissingCensus } from '../services/inepIngest.js'

const ORDERABLE = new Set(['opportunityScore', 'complaints', 'unansweredRate', 'avgScore', 'complaintsDelta', 'name'])

export async function reputationRoutes(app: FastifyInstance) {
  // ── Listagem de empresas (o "radar") ──
  app.get('/api/admin/reputation/companies', { preHandler: adminOnly }, async (req) => {
    const q = req.query as any
    const search = String(q?.q || '').trim()
    const segment = String(q?.segment || '').trim()
    const status = String(q?.status || '').trim()
    const minComplaints = parseInt(String(q?.minComplaints || '0'), 10) || 0
    const limit = Math.min(parseInt(String(q?.limit || '50'), 10) || 50, 500)
    const offset = parseInt(String(q?.offset || '0'), 10) || 0
    const orderBy = ORDERABLE.has(String(q?.orderBy)) ? String(q.orderBy) : 'opportunityScore'
    const dir = String(q?.dir) === 'asc' ? 'asc' : 'desc'

    const where: any = {}
    if (search) where.name = { contains: search }
    if (segment) where.segment = segment
    if (status) where.status = status
    if (minComplaints > 0) where.complaints = { gte: minComplaints }

    const [companies, total] = await Promise.all([
      prisma.reputationCompany.findMany({
        where,
        orderBy: [{ [orderBy]: dir } as any, { complaints: 'desc' }],
        take: limit,
        skip: offset,
      }),
      prisma.reputationCompany.count({ where }),
    ])
    return { companies, total, limit, offset }
  })

  // ── Detalhe + série histórica ──
  app.get('/api/admin/reputation/companies/:id', { preHandler: adminOnly }, async (req, reply) => {
    const id = parseInt(String((req.params as any).id), 10)
    const company = await prisma.reputationCompany.findUnique({
      where: { id },
      include: { snapshots: { orderBy: { period: 'asc' } } },
    })
    if (!company) return reply.code(404).send({ error: 'Empresa não encontrada' })
    return { company }
  })

  // ── Marcar status / anotar (pipeline de prospecção) ──
  app.patch('/api/admin/reputation/companies/:id', { preHandler: adminOnly }, async (req, reply) => {
    const id = parseInt(String((req.params as any).id), 10)
    const b = (req.body as any) || {}
    const data: any = {}
    if (b.status !== undefined) {
      const s = String(b.status)
      if (!['new', 'prospecting', 'converted', 'ignored'].includes(s)) {
        return reply.code(400).send({ error: 'status inválido' })
      }
      data.status = s
    }
    if (b.notes !== undefined) data.notes = String(b.notes || '').slice(0, 5000) || null
    if (b.leadId !== undefined) data.leadId = b.leadId === null ? null : parseInt(String(b.leadId), 10)
    if (Object.keys(data).length === 0) return reply.code(400).send({ error: 'Nada para atualizar' })

    const company = await prisma.reputationCompany.update({ where: { id }, data })
    return { company }
  })

  // ── Segmentos (para o filtro e para leitura de mercado) ──
  app.get('/api/admin/reputation/segments', { preHandler: adminOnly }, async () => {
    const rows = await prisma.reputationCompany.groupBy({
      by: ['segment'],
      _count: { _all: true },
      _sum: { complaints: true },
      _avg: { opportunityScore: true },
    })
    const segments = rows
      .filter(r => r.segment)
      .map(r => ({
        segment: r.segment,
        companies: r._count._all,
        complaints: r._sum.complaints || 0,
        avgOpportunity: Math.round(r._avg.opportunityScore || 0),
      }))
      .sort((a, b) => b.complaints - a.complaints)
    return { segments }
  })

  // ── Status da ingestão: o que já temos × o que a fonte publicou ──
  app.get('/api/admin/reputation/imports', { preHandler: adminOnly }, async () => {
    const imports = await prisma.reputationImport.findMany({ orderBy: { period: 'desc' }, take: 36 })
    let available: { period: string; publishedAt: string }[] = []
    let sourceError: string | null = null
    try {
      available = (await listPublications()).slice(0, 12).map(p => ({ period: p.period, publishedAt: p.publishedAt }))
    } catch (err: any) {
      sourceError = String(err?.message || err)
    }
    return { imports, available, sourceError }
  })

  // ── Disparo manual da ingestão ──
  // Sem body → puxa o período publicado mais recente que ainda falta.
  // { period: "2026-06", force?: true } → reprocessa um período específico.
  app.post('/api/admin/reputation/imports', { preHandler: adminOnly }, async (req, reply) => {
    const b = (req.body as any) || {}
    const period = String(b.period || '').trim()
    if (period && !/^\d{4}-\d{2}$/.test(period)) {
      return reply.code(400).send({ error: 'period deve ser YYYY-MM' })
    }
    try {
      if (period) {
        const result = await ingestPeriod(period, { force: b.force === true })
        return { result }
      }
      const results = await ingestMissing(Math.min(parseInt(String(b.max || '1'), 10) || 1, 6))
      return { results }
    } catch (err: any) {
      return reply.code(502).send({ error: String(err?.message || err) })
    }
  })

  // ── Detector de stack: lacuna de marketing no site do prospect ──

  // Lista os scans. `onlyGaps` esconde os indeterminados (sites que bloquearam
  // a leitura), que têm gapScore 0 e não significam ausência de marketing.
  app.get('/api/admin/reputation/stack', { preHandler: adminOnly }, async (req) => {
    const q = req.query as any
    const limit = Math.min(parseInt(String(q?.limit || '100'), 10) || 100, 500)
    const search = String(q?.q || '').trim()
    const where: any = {}
    if (search) where.domain = { contains: search }
    if (String(q?.onlyGaps) === 'true') where.gapScore = { gt: 0 }

    const [scans, total] = await Promise.all([
      prisma.webStackScan.findMany({ where, orderBy: [{ gapScore: 'desc' }, { scannedAt: 'desc' }], take: limit }),
      prisma.webStackScan.count({ where }),
    ])
    return { scans, total }
  })

  // Dispara varredura. `{ domains: [...] }` ou `{ fromLeads: true, limit }`
  // (usa o domínio do e-mail corporativo dos leads do CRM).
  app.post('/api/admin/reputation/stack', { preHandler: adminOnly }, async (req, reply) => {
    const b = (req.body as any) || {}
    let domains: string[] = []

    if (b.fromLeads === true) {
      const limit = Math.min(parseInt(String(b.limit || '100'), 10) || 100, 500)
      domains = (await domainsFromLeads(limit)).map((d) => d.domain)
    } else if (Array.isArray(b.domains)) {
      domains = b.domains.map((d: unknown) => normalizeDomain(String(d))).filter(Boolean)
    }

    if (domains.length === 0) return reply.code(400).send({ error: 'Informe domains[] ou fromLeads: true' })
    if (domains.length > 300) return reply.code(400).send({ error: 'Máximo de 300 domínios por chamada' })

    const results = await scanMany(domains, { concurrency: 6 })
    const gaps = results.filter((r) => r.gapScore >= 40).length
    const blocked = results.filter((r) => r.gapScore === 0 && r.error).length
    return { scanned: results.length, gaps, blocked, results }
  })

  // ── Radar de concorrentes (agências) ──

  app.get('/api/admin/reputation/competitors', { preHandler: adminOnly }, async (req) => {
    const q = req.query as any
    const city = String(q?.city || '').trim()
    const onlyWithNegatives = String(q?.onlyWithNegatives) === 'true'
    const where: any = {}
    if (city) where.city = { contains: city }
    if (onlyWithNegatives) where.negativeWithText = { gt: 0 }

    const agencies = await prisma.competitorAgency.findMany({
      where,
      orderBy: [{ negativeWithText: 'desc' }, { reviewsCount: 'desc' }],
      take: Math.min(parseInt(String(q?.limit || '100'), 10) || 100, 300),
      include: { reviews: { orderBy: { stars: 'asc' }, take: 5 } },
    })

    // Junta a varredura de stack do site de cada agência, quando existe.
    const domains = agencies.map((a) => a.domain).filter(Boolean) as string[]
    const scans = domains.length
      ? await prisma.webStackScan.findMany({ where: { domain: { in: domains } } })
      : []
    const byDomain = new Map(scans.map((s) => [s.domain, s]))

    return {
      agencies: agencies.map((a) => ({ ...a, stack: a.domain ? byDomain.get(a.domain) ?? null : null })),
      total: await prisma.competitorAgency.count({ where }),
    }
  })

  // Saldo do Apify — a conta é FREE (US$ 5/mês), então a UI mostra antes de gastar.
  app.get('/api/admin/reputation/competitors/credits', { preHandler: adminOnly }, async (_req, reply) => {
    try {
      return { credits: await checkCredits() }
    } catch (err: any) {
      return reply.code(502).send({ error: String(err?.message || err) })
    }
  })

  // Dispara a descoberta numa praça. Consome crédito do Apify.
  app.post('/api/admin/reputation/competitors', { preHandler: adminOnly }, async (req, reply) => {
    const b = (req.body as any) || {}
    const location = String(b.location || '').trim()
    if (!location) return reply.code(400).send({ error: 'Informe location (ex.: "Goiânia, GO")' })
    try {
      const result = await discoverAgencies({
        location,
        term: b.term ? String(b.term) : undefined,
        maxPlaces: b.maxPlaces ? parseInt(String(b.maxPlaces), 10) : undefined,
        maxReviewsPerPlace: b.maxReviews ? parseInt(String(b.maxReviews), 10) : undefined,
        scanSites: b.scanSites !== false,
      })
      return { result }
    } catch (err: any) {
      return reply.code(502).send({ error: String(err?.message || err) })
    }
  })

  // ── Radar educacional (Censo Escolar / INEP) ──

  app.get('/api/admin/reputation/schools', { preHandler: adminOnly }, async (req) => {
    const q = req.query as any
    const search = String(q?.q || '').trim()
    const uf = String(q?.uf || '').trim().toUpperCase()
    const city = String(q?.city || '').trim()
    const minClasses = parseInt(String(q?.minClasses || '3'), 10) || 0
    const onlyDropping = String(q?.onlyDropping) === 'true'
    const onlyWithPhone = String(q?.onlyWithPhone) === 'true'
    const limit = Math.min(parseInt(String(q?.limit || '100'), 10) || 100, 500)

    const where: any = {}
    if (search) where.name = { contains: search }
    if (uf) where.uf = uf
    if (city) where.city = { contains: city }
    if (minClasses > 0) where.classes = { gte: minClasses }
    if (onlyDropping) where.classesDelta = { lt: 0 }
    if (onlyWithPhone) where.phone = { not: null }

    const [schools, total] = await Promise.all([
      prisma.educationInstitution.findMany({
        where,
        orderBy: [{ opportunityScore: 'desc' }, { classes: 'desc' }],
        take: limit,
      }),
      prisma.educationInstitution.count({ where }),
    ])
    return { schools, total }
  })

  // Estados com escolas ingeridas — alimenta o filtro de UF.
  app.get('/api/admin/reputation/schools/ufs', { preHandler: adminOnly }, async () => {
    const rows = await prisma.educationInstitution.groupBy({
      by: ['uf'],
      _count: { _all: true },
      orderBy: { _count: { uf: 'desc' } },
    })
    return { ufs: rows.filter((r) => r.uf).map((r) => ({ uf: r.uf, schools: r._count._all })) }
  })

  app.get('/api/admin/reputation/schools/imports', { preHandler: adminOnly }, async () => {
    const imports = await prisma.educationImport.findMany({ orderBy: { year: 'desc' }, take: 12 })
    let available: number[] = []
    let sourceError: string | null = null
    try {
      available = (await listCensusReleases()).slice(0, 6).map((r) => r.year)
    } catch (err: any) {
      sourceError = String(err?.message || err)
    }
    return { imports, available, sourceError }
  })

  // Ingestão do censo. Demora minutos (pacote de dezenas de MB + 200 mil
  // linhas), então dispara em background e responde na hora — a UI acompanha
  // pelo status em /schools/imports.
  app.post('/api/admin/reputation/schools/imports', { preHandler: adminOnly }, async (req, reply) => {
    const b = (req.body as any) || {}
    const year = b.year ? parseInt(String(b.year), 10) : null
    if (year !== null && (!isFinite(year) || year < 2015 || year > 2100)) {
      return reply.code(400).send({ error: 'year inválido' })
    }
    const force = b.force === true

    const task = year
      ? ingestCensusYear(year, { force })
      : ingestMissingCensus(1)
    task.catch((err: any) => console.error('[inep] ingestão em background falhou:', err?.message || err))

    return { started: true, year: year ?? 'mais recente pendente' }
  })
}
