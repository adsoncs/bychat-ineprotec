// src/routes/heMarket.ts
// Inteligência de Mercado — Ensino Superior. Consultas do dashboard entregue
// à IES cliente. Tudo lê o agregado `bychat_he_market`, exceto a comparação
// "minha IES vs mercado" e a lista de concorrentes, que precisam do fato.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { adminOnly } from '../lib/auth.js'
import { listHeReleases, ingestHeYear, ingestMissingHe } from '../services/heCensusIngest.js'

const MY_IES_KEY = 'higher_ed.my_ies'

/** Converte BigInt/Decimal do driver em number — JSON.stringify quebra em BigInt. */
const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))

/**
 * ARMADILHA DO CENSO (verificada nos dados de 2024): cursos EAD declaram
 * **zero vagas** em cada polo — a vaga fica registrada na sede, enquanto os
 * ingressantes aparecem polo a polo. São 458.838 registros no país com
 * ingressantes e nenhuma vaga.
 *
 * Consequência: somar EAD e presencial produz ocupação sem sentido (Goiás
 * aparentava 85,7% quando a presencial real é 34,1%, e municípios chegavam a
 * 218%). Por isso ocupação, vagas ociosas e candidatos/vaga são calculados
 * **apenas sobre a modalidade presencial** (seatsPres/entrantsPres, vindos de
 * um SUM condicional nas queries). Para EAD ficam nulos — e a UI precisa dizer
 * isso, em vez de exibir um número inventado.
 */
function ratios(r: any) {
  const seats = n(r.seats), applicants = n(r.applicants), entrants = n(r.entrants), enrolled = n(r.enrolled)
  // Quando a query não separa modalidade, cai para os totais (recortes que já
  // são presenciais por construção, como a aba de concorrentes filtrada).
  const seatsPres = r.seatsPres !== undefined ? n(r.seatsPres) : seats
  const entrantsPres = r.entrantsPres !== undefined ? n(r.entrantsPres) : entrants
  const applicantsPres = r.applicantsPres !== undefined ? n(r.applicantsPres) : applicants

  return {
    seats, applicants, entrants, enrolled,
    seatsPres, entrantsPres,
    graduates: n(r.graduates), dropped: n(r.dropped), locked: n(r.locked),
    fies: n(r.fies), prouni: n(r.prouni),
    institutions: n(r.institutions),
    courses: n(r.courses),
    // Só presencial — ver comentário acima.
    occupancy: seatsPres > 0 ? entrantsPres / seatsPres : null,
    idleSeats: seatsPres > 0 ? Math.max(0, seatsPres - entrantsPres) : null,
    applicantsPerSeat: seatsPres > 0 ? applicantsPres / seatsPres : null,
    // Conversão do funil de captação vale para as duas modalidades: inscrito e
    // ingressante são contados no mesmo registro.
    conversion: applicants > 0 ? entrants / applicants : null,
    dropoutRate: enrolled > 0 ? n(r.dropped) / enrolled : null,
    lockedRate: enrolled > 0 ? n(r.locked) / enrolled : null,
  }
}

/** Colunas de SUM condicional que alimentam as métricas presenciais. */
const PRES_SUMS = `
  SUM(CASE WHEN modality = 1 THEN seats ELSE 0 END) seatsPres,
  SUM(CASE WHEN modality = 1 THEN entrants ELSE 0 END) entrantsPres,
  SUM(CASE WHEN modality = 1 THEN applicants ELSE 0 END) applicantsPres`

async function latestYear(): Promise<number | null> {
  const row = await prisma.heImport.findFirst({ where: { status: 'done' }, orderBy: { year: 'desc' }, select: { year: true } })
  return row?.year ?? null
}

async function getMyIes(): Promise<number[]> {
  const s = await prisma.setting.findUnique({ where: { key: MY_IES_KEY } })
  const v = s?.value as any
  if (Array.isArray(v)) return v.map(Number).filter(Number.isFinite)
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v)
      return Array.isArray(parsed) ? parsed.map(Number).filter(Number.isFinite) : []
    } catch { return [] }
  }
  return []
}

export async function heMarketRoutes(app: FastifyInstance) {
  // ── Panorama da praça ──
  app.get('/api/admin/he-market/overview', { preHandler: adminOnly }, async (req) => {
    const q = req.query as any
    const year = parseInt(String(q?.year || '0'), 10) || (await latestYear())
    if (!year) return { year: null, empty: true }

    const uf = String(q?.uf || '').trim().toUpperCase()
    const cityCode = parseInt(String(q?.cityCode || '0'), 10) || null

    const where: string[] = ['year = ?']
    const params: any[] = [year]
    if (uf) { where.push('uf = ?'); params.push(uf) }
    if (cityCode) { where.push('cityCode = ?'); params.push(cityCode) }
    const W = where.join(' AND ')

    const sum = `SUM(seats) seats, SUM(applicants) applicants, SUM(entrants) entrants, SUM(enrolled) enrolled,
                 SUM(graduates) graduates, SUM(dropped) dropped, SUM(locked) locked, SUM(fies) fies, SUM(prouni) prouni,
                 SUM(courses) courses, ${PRES_SUMS}`

    const [total] = await prisma.$queryRawUnsafe<any[]>(
      `SELECT ${sum}, (SELECT COUNT(DISTINCT coIes) FROM bychat_he_courses WHERE ${W.replace(/\byear\b/g, 'year')}) institutions
       FROM bychat_he_market WHERE ${W}`, ...params, ...params)

    const [priv] = await prisma.$queryRawUnsafe<any[]>(`SELECT ${sum} FROM bychat_he_market WHERE ${W} AND isPrivate = 1`, ...params)
    const [ead] = await prisma.$queryRawUnsafe<any[]>(`SELECT ${sum} FROM bychat_he_market WHERE ${W} AND modality = 2`, ...params)
    const [pres] = await prisma.$queryRawUnsafe<any[]>(`SELECT ${sum} FROM bychat_he_market WHERE ${W} AND modality = 1`, ...params)

    // Ano anterior, mesmo recorte — só se estiver ingerido. Sem isso o número
    // é um retrato solto; com isso vira tendência, que é o que decide.
    const prevYear = year - 1
    const hasPrev = await prisma.heImport.findFirst({ where: { year: prevYear, status: 'done' }, select: { year: true } })
    let previous: any = null
    if (hasPrev) {
      const prevParams = [prevYear, ...params.slice(1)]
      const [pt] = await prisma.$queryRawUnsafe<any[]>(`SELECT ${sum} FROM bychat_he_market WHERE ${W}`, ...prevParams)
      const [pp] = await prisma.$queryRawUnsafe<any[]>(`SELECT ${sum} FROM bychat_he_market WHERE ${W} AND modality = 1`, ...prevParams)
      previous = { year: prevYear, total: ratios(pt || {}), presential: ratios(pp || {}) }
    }

    // Anos disponíveis para o seletor da tela.
    const years = (await prisma.heImport.findMany({
      where: { status: 'done' }, orderBy: { year: 'desc' }, select: { year: true },
    })).map((r) => r.year)

    return {
      year,
      years,
      total: ratios(total || {}),
      presential: ratios(pres || {}),
      // EAD não declara vaga por polo: ocupação e vagas ociosas vêm nulas aqui
      // de propósito. Use matrículas/ingressantes para dimensionar EAD.
      ead: ratios(ead || {}),
      private: ratios(priv || {}),
      previous,
    }
  })

  // ── Áreas de conhecimento (CINE) ──
  app.get('/api/admin/he-market/areas', { preHandler: adminOnly }, async (req) => {
    const q = req.query as any
    const year = parseInt(String(q?.year || '0'), 10) || (await latestYear())
    if (!year) return { areas: [] }
    const uf = String(q?.uf || '').trim().toUpperCase()
    const cityCode = parseInt(String(q?.cityCode || '0'), 10) || null

    const where = ['year = ?', 'cineArea IS NOT NULL']
    const params: any[] = [year]
    if (uf) { where.push('uf = ?'); params.push(uf) }
    if (cityCode) { where.push('cityCode = ?'); params.push(cityCode) }

    const rows = await prisma.$queryRawUnsafe<any[]>(`
      SELECT cineArea, SUM(seats) seats, SUM(applicants) applicants, SUM(entrants) entrants,
             SUM(enrolled) enrolled, SUM(graduates) graduates, SUM(dropped) dropped, SUM(locked) locked,
             SUM(fies) fies, SUM(prouni) prouni, SUM(courses) courses, SUM(institutions) institutions,
             ${PRES_SUMS}
      FROM bychat_he_market WHERE ${where.join(' AND ')}
      GROUP BY cineArea ORDER BY SUM(enrolled) DESC`, ...params)

    return { areas: rows.map((r) => ({ cineArea: r.cineArea, ...ratios(r) })) }
  })

  // ── Praças (municípios) de uma UF ──
  app.get('/api/admin/he-market/cities', { preHandler: adminOnly }, async (req) => {
    const q = req.query as any
    const year = parseInt(String(q?.year || '0'), 10) || (await latestYear())
    if (!year) return { cities: [] }
    const uf = String(q?.uf || '').trim().toUpperCase()

    const where = ['year = ?', 'city IS NOT NULL']
    const params: any[] = [year]
    if (uf) { where.push('uf = ?'); params.push(uf) }

    const rows = await prisma.$queryRawUnsafe<any[]>(`
      SELECT cityCode, MIN(city) city, MIN(uf) uf, SUM(seats) seats, SUM(applicants) applicants,
             SUM(entrants) entrants, SUM(enrolled) enrolled, SUM(dropped) dropped, SUM(locked) locked,
             SUM(graduates) graduates, SUM(fies) fies, SUM(prouni) prouni, SUM(courses) courses,
             MAX(institutions) institutions, ${PRES_SUMS}
      FROM bychat_he_market WHERE ${where.join(' AND ')}
      GROUP BY cityCode ORDER BY SUM(enrolled) DESC LIMIT 200`, ...params)

    return { cities: rows.map((r) => ({ cityCode: n(r.cityCode), city: r.city, uf: r.uf, ...ratios(r) })) }
  })

  // ── UFs disponíveis ──
  app.get('/api/admin/he-market/ufs', { preHandler: adminOnly }, async (req) => {
    const year = parseInt(String((req.query as any)?.year || '0'), 10) || (await latestYear())
    if (!year) return { ufs: [] }
    const rows = await prisma.$queryRawUnsafe<any[]>(`
      SELECT uf, SUM(enrolled) enrolled FROM bychat_he_market
      WHERE year = ? AND uf IS NOT NULL GROUP BY uf ORDER BY uf`, year)
    return { ufs: rows.map((r) => ({ uf: r.uf, enrolled: n(r.enrolled) })) }
  })

  // ── Concorrentes na praça ──
  // Sai do fato porque precisa nomear as IES, não só somar.
  app.get('/api/admin/he-market/competitors', { preHandler: adminOnly }, async (req) => {
    const q = req.query as any
    const year = parseInt(String(q?.year || '0'), 10) || (await latestYear())
    if (!year) return { competitors: [] }
    const uf = String(q?.uf || '').trim().toUpperCase()
    const cityCode = parseInt(String(q?.cityCode || '0'), 10) || null
    const cineArea = String(q?.cineArea || '').trim()

    const where = ['c.year = ?']
    const params: any[] = [year]
    if (uf) { where.push('c.uf = ?'); params.push(uf) }
    if (cityCode) { where.push('c.cityCode = ?'); params.push(cityCode) }
    if (cineArea) { where.push('c.cineArea = ?'); params.push(cineArea) }

    const rows = await prisma.$queryRawUnsafe<any[]>(`
      SELECT c.coIes, MAX(i.name) name, MAX(i.acronym) acronym, MAX(i.isPrivate) isPrivate,
             COUNT(*) courses, SUM(c.seats) seats, SUM(c.applicants) applicants, SUM(c.entrants) entrants,
             SUM(c.enrolled) enrolled, SUM(c.dropped) dropped, SUM(c.locked) locked,
             SUM(c.graduates) graduates, SUM(c.enrolledFies) fies, SUM(c.enrolledProuni) prouni
      FROM bychat_he_courses c
      LEFT JOIN bychat_he_institutions i ON i.coIes = c.coIes
      WHERE ${where.join(' AND ')}
      GROUP BY c.coIes ORDER BY SUM(c.enrolled) DESC LIMIT 60`, ...params)

    const myIes = await getMyIes()
    const totalEnrolled = rows.reduce((s, r) => s + n(r.enrolled), 0)

    return {
      competitors: rows.map((r) => ({
        coIes: n(r.coIes),
        name: r.name || `IES ${n(r.coIes)}`,
        acronym: r.acronym,
        isPrivate: !!n(r.isPrivate),
        isMine: myIes.includes(n(r.coIes)),
        share: totalEnrolled > 0 ? n(r.enrolled) / totalEnrolled : null,
        ...ratios(r),
      })),
    }
  })

  // ── Demanda reprimida: onde abrir/expandir curso ──
  // Alta pressão por vaga + ocupação alta = mercado pedindo mais oferta.
  app.get('/api/admin/he-market/opportunities', { preHandler: adminOnly }, async (req) => {
    const q = req.query as any
    const year = parseInt(String(q?.year || '0'), 10) || (await latestYear())
    if (!year) return { opportunities: [] }
    const uf = String(q?.uf || '').trim().toUpperCase()
    const cityCode = parseInt(String(q?.cityCode || '0'), 10) || null

    // Só presencial: em EAD a vaga não é declarada por polo, então
    // "candidatos por vaga" seria divisão por zero disfarçada.
    const where = ['year = ?', 'cineArea IS NOT NULL', 'seats > 0', 'modality = 1']
    const params: any[] = [year]
    if (uf) { where.push('uf = ?'); params.push(uf) }
    if (cityCode) { where.push('cityCode = ?'); params.push(cityCode) }

    const rows = await prisma.$queryRawUnsafe<any[]>(`
      SELECT cineArea, modality, SUM(seats) seats, SUM(applicants) applicants, SUM(entrants) entrants,
             SUM(enrolled) enrolled, SUM(courses) courses, MAX(institutions) institutions,
             SUM(dropped) dropped, SUM(locked) locked, SUM(graduates) graduates, SUM(fies) fies, SUM(prouni) prouni
      FROM bychat_he_market WHERE ${where.join(' AND ')}
      GROUP BY cineArea, modality
      HAVING SUM(seats) >= 100
      ORDER BY (SUM(applicants) / SUM(seats)) DESC LIMIT 25`, ...params)

    return {
      opportunities: rows.map((r) => ({
        cineArea: r.cineArea,
        modality: n(r.modality),
        ...ratios(r),
      })),
    }
  })

  // ── Minha IES vs mercado ──
  app.get('/api/admin/he-market/my-ies', { preHandler: adminOnly }, async (req) => {
    const q = req.query as any
    const year = parseInt(String(q?.year || '0'), 10) || (await latestYear())
    const myIes = await getMyIes()
    if (!year || myIes.length === 0) return { year, myIes, configured: myIes.length > 0, courses: [], summary: null, benchmark: null }

    const placeholders = myIes.map(() => '?').join(',')

    const [summary] = await prisma.$queryRawUnsafe<any[]>(`
      SELECT COUNT(*) courses, SUM(seats) seats, SUM(applicants) applicants, SUM(entrants) entrants,
             SUM(enrolled) enrolled, SUM(graduates) graduates, SUM(dropped) dropped, SUM(locked) locked,
             SUM(enrolledFies) fies, SUM(enrolledProuni) prouni
      FROM bychat_he_courses WHERE year = ? AND coIes IN (${placeholders})`, year, ...myIes)

    // Benchmark: mesmas praças (município) e mesmas áreas em que a IES atua,
    // excluindo ela própria — comparar com o país inteiro não diria nada.
    const [benchmark] = await prisma.$queryRawUnsafe<any[]>(`
      SELECT COUNT(*) courses, SUM(seats) seats, SUM(applicants) applicants, SUM(entrants) entrants,
             SUM(enrolled) enrolled, SUM(graduates) graduates, SUM(dropped) dropped, SUM(locked) locked,
             SUM(enrolledFies) fies, SUM(enrolledProuni) prouni
      FROM bychat_he_courses
      WHERE year = ? AND coIes NOT IN (${placeholders})
        AND (cityCode, cineArea) IN (
          SELECT DISTINCT cityCode, cineArea FROM bychat_he_courses
          WHERE year = ? AND coIes IN (${placeholders}) AND cityCode IS NOT NULL AND cineArea IS NOT NULL
        )`, year, ...myIes, year, ...myIes)

    // Curso a curso: onde a vaga está sobrando.
    const courses = await prisma.$queryRawUnsafe<any[]>(`
      SELECT name, cineArea, city, modality, degree,
             seats, applicants, entrants, enrolled, graduates, dropped, locked,
             enrolledFies fies, enrolledProuni prouni, 1 courses, 1 institutions
      FROM bychat_he_courses
      WHERE year = ? AND coIes IN (${placeholders})
      ORDER BY (seats - entrants) DESC LIMIT 100`, year, ...myIes)

    return {
      year,
      myIes,
      configured: true,
      summary: ratios(summary || {}),
      benchmark: ratios(benchmark || {}),
      courses: courses.map((c) => ({
        name: c.name, cineArea: c.cineArea, city: c.city,
        modality: n(c.modality), degree: n(c.degree),
        ...ratios(c),
      })),
    }
  })

  // ── Configuração: quais CO_IES são "minha instituição" ──
  app.get('/api/admin/he-market/settings', { preHandler: adminOnly }, async () => {
    const myIes = await getMyIes()
    const list = myIes.length
      ? await prisma.heInstitution.findMany({ where: { coIes: { in: myIes } } })
      : []
    return { myIes, institutions: list }
  })

  app.put('/api/admin/he-market/settings', { preHandler: adminOnly }, async (req, reply) => {
    const b = (req.body as any) || {}
    if (!Array.isArray(b.myIes)) return reply.code(400).send({ error: 'myIes deve ser uma lista de códigos CO_IES' })
    const ids = b.myIes.map((v: unknown) => parseInt(String(v), 10)).filter(Number.isFinite).slice(0, 50)
    // upsert, não updateMany: Setting nova não existe ainda e updateMany viraria
    // no-op silencioso (mesmo gotcha já corrigido em outras telas).
    // `label`, `grp` e `fieldType` são obrigatórios no model Setting — sem eles
    // o create do upsert falha com 500 (o update sozinho passaria despercebido
    // até alguém salvar pela primeira vez).
    await prisma.setting.upsert({
      where: { key: MY_IES_KEY },
      create: {
        key: MY_IES_KEY,
        value: ids,
        label: 'Instituições próprias (Mercado — Ensino Superior)',
        grp: 'higher_ed',
        fieldType: 'json',
      } as any,
      update: { value: ids } as any,
    })
    return { myIes: ids }
  })

  // Busca de IES para o seletor da configuração.
  app.get('/api/admin/he-market/institutions', { preHandler: adminOnly }, async (req) => {
    const q = req.query as any
    const search = String(q?.q || '').trim()
    const uf = String(q?.uf || '').trim().toUpperCase()
    const where: any = {}
    if (search) where.OR = [{ name: { contains: search } }, { acronym: { contains: search } }]
    if (uf) where.uf = uf
    const institutions = await prisma.heInstitution.findMany({
      where, orderBy: { name: 'asc' }, take: 50,
    })
    return { institutions }
  })

  // ── Ingestão ──
  app.get('/api/admin/he-market/imports', { preHandler: adminOnly }, async () => {
    const imports = await prisma.heImport.findMany({ orderBy: { year: 'desc' }, take: 12 })
    let available: number[] = []
    let sourceError: string | null = null
    try {
      available = (await listHeReleases()).slice(0, 6).map((r) => r.year)
    } catch (err: any) {
      sourceError = String(err?.message || err)
    }
    return { imports, available, sourceError }
  })

  // O pacote tem ~457 MB e 720 mil linhas: dispara em background e responde já.
  app.post('/api/admin/he-market/imports', { preHandler: adminOnly }, async (req, reply) => {
    const b = (req.body as any) || {}
    const year = b.year ? parseInt(String(b.year), 10) : null
    if (year !== null && (!isFinite(year) || year < 2015 || year > 2100)) {
      return reply.code(400).send({ error: 'year inválido' })
    }
    const task = year ? ingestHeYear(year, { force: b.force === true }) : ingestMissingHe(1)
    task.catch((err: any) => console.error('[he-censo] ingestão em background falhou:', err?.message || err))
    return { started: true, year: year ?? 'mais recente pendente' }
  })
}
