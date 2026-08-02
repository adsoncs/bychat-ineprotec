// src/services/heCensusIngest.ts
//
// Inteligência de Mercado — Ensino Superior: ingestão do Censo da Educação
// Superior (INEP/MEC).
//
// O pacote anual tem ~457 MB e o arquivo de cursos, ~720 mil linhas × 223
// colunas (uma linha por curso × local — um curso EAD aparece em cada polo).
// Guardamos ~45 colunas no fato e pré-agregamos por praça; o dashboard lê só
// o agregado.
//
// Reaproveita as lições da ingestão do Censo Escolar (services/inepIngest.ts):
// CSVs em latin-1, download por `curl` (o cliente https do Node cai com
// ECONNRESET neste host), cadeia TLS incompleta resolvida por backend/certs/,
// e listener de 'close' registrado ANTES de consumir o stdout do unzip.

import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import readline from 'node:readline'
import { prisma } from '../lib/prisma.js'
import { isModuleEnabled } from '../lib/moduleManager.js'

const INDEX_URL = 'https://www.gov.br/inep/pt-br/acesso-a-informacao/dados-abertos/microdados/censo-da-educacao-superior'
const UA = 'Mozilla/5.0 (compatible; ByChatMarket/1.0)'
const BATCH = 1000

// TP_CATEGORIA_ADMINISTRATIVA: 4 privada c/ fins, 5 privada s/ fins, 7 especial
const PRIVATE_CATEGORIES = new Set([4, 5, 7])

export interface HeRelease { year: number; url: string }

function certPath(): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url))
  return [
    join(here, '..', '..', 'certs', 'rnp-icpedu.pem'),
    join(here, '..', '..', '..', 'certs', 'rnp-icpedu.pem'),
  ].find(existsSync)
}

function curl(args: string[], timeoutMs = 900_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const pem = certPath()
    const base = [
      '-sSL', '--fail', '--retry', '5', '--retry-delay', '5', '--retry-all-errors',
      '--max-time', String(Math.floor(timeoutMs / 1000)),
      '--capath', '/etc/ssl/certs',
      ...(pem ? ['--cacert', pem] : []),
      '-A', UA,
    ]
    const p = spawn('curl', [...base, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => { out += String(d) })
    p.stderr.on('data', (d) => { err += String(d).slice(0, 500) })
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`curl falhou (exit ${code}): ${err.trim()}`))))
  })
}

/** Anos publicados, lidos da página oficial (o nome do arquivo não é estável). */
export async function listHeReleases(): Promise<HeRelease[]> {
  const html = await curl([INDEX_URL], 120_000)
  const out = new Map<number, string>()
  const re = /https?:\/\/[^"'\s]*microdados_censo_da_educacao_superior_(\d{4})_?\.zip/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const year = Number(m[1])
    if (year >= 2015) out.set(year, m[0])
  }
  return [...out.entries()].map(([year, url]) => ({ year, url })).sort((a, b) => b.year - a.year)
}

async function listEntries(zipPath: string): Promise<string[]> {
  const list = await new Promise<string>((resolve, reject) => {
    const p = spawn('unzip', ['-Z1', zipPath])
    let out = ''
    p.stdout.on('data', (d) => { out += String(d) })
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`unzip -Z1 falhou (${code})`))))
  })
  return list.split('\n').map((s) => s.trim()).filter(Boolean)
}

/**
 * Linhas de um CSV do pacote, em latin-1.
 * O listener de 'close' vem antes do laço de propósito — ver inepIngest.ts.
 */
async function* csvRows(zipPath: string, entry: string): AsyncGenerator<{ f: string[]; ix: Record<string, number> }> {
  const proc = spawn('unzip', ['-p', zipPath, entry], { stdio: ['ignore', 'pipe', 'pipe'] })
  const closed = new Promise<number>((resolve) => proc.on('close', (code) => resolve(code ?? 0)))
  proc.stdout.setEncoding('latin1')
  const rl = readline.createInterface({ input: proc.stdout, crlfDelay: Infinity })

  let ix: Record<string, number> | null = null
  for await (const line of rl) {
    if (!line.trim()) continue
    const f = line.split(';')
    if (!ix) {
      ix = {}
      f.forEach((h, i) => { ix![h.replace(/^﻿/, '').trim()] = i })
      continue
    }
    yield { f, ix }
  }
  const code = await closed
  if (code !== 0) throw new Error(`unzip -p falhou (exit ${code}) ao ler ${entry}`)
}

const int = (f: string[], ix: Record<string, number>, c: string): number => {
  const i = ix[c]
  if (i === undefined || i >= f.length) return 0
  const n = parseInt(f[i], 10)
  return isFinite(n) ? n : 0
}
const str = (f: string[], ix: Record<string, number>, c: string, max = 255): string | null => {
  const i = ix[c]
  if (i === undefined || i >= f.length) return null
  const v = f[i].trim()
  return v ? v.slice(0, max) : null
}

export interface HeIngestResult {
  year: number
  courses: number
  institutions: number
  marketRows: number
  durationMs: number
  skipped?: boolean
}

export async function ingestHeYear(year: number, opts: { force?: boolean } = {}): Promise<HeIngestResult> {
  const t0 = Date.now()

  const existing = await prisma.heImport.findUnique({ where: { year } })
  if (existing?.status === 'done' && !opts.force) {
    return { year, courses: existing.courses, institutions: existing.institutions, marketRows: existing.marketRows, durationMs: 0, skipped: true }
  }

  const rel = (await listHeReleases()).find((r) => r.year === year)
  if (!rel) throw new Error(`censo superior ${year} não está publicado`)

  await prisma.heImport.upsert({
    where: { year },
    create: { year, fileName: rel.url.split('/').pop() || null, status: 'running' },
    update: { status: 'running', error: null, courses: 0, institutions: 0, marketRows: 0 },
  })

  const dir = await mkdtemp(join(tmpdir(), 'hecensus-'))
  const zipPath = join(dir, `he_${year}.zip`)

  try {
    await curl(['-C', '-', '-o', zipPath, rel.url])
    const bytes = statSync(zipPath).size
    if (bytes < 10_000_000) throw new Error(`pacote suspeito: ${bytes} bytes`)

    const entries = await listEntries(zipPath)
    const iesEntry = entries.find((e) => /MICRODADOS_ED_SUP_IES_\d{4}\.CSV$/i.test(e))
    const cursoEntry = entries.find((e) => /MICRODADOS_CADASTRO_CURSOS_\d{4}\.CSV$/i.test(e))
    if (!cursoEntry) throw new Error(`tabela de cursos não encontrada: ${entries.filter((e) => /\.csv$/i.test(e)).join(', ')}`)

    // ── 1) IES ──
    let institutions = 0
    if (iesEntry) {
      let batch: any[][] = []
      const flushIes = async () => {
        if (!batch.length) return
        const cols = ['coIes', 'name', 'acronym', 'uf', 'city', 'isCapital', 'organization', 'category', 'isPrivate', 'updatedAt']
        const ph = batch.map(() => `(${cols.map(() => '?').join(',')})`).join(',')
        const upd = cols.filter((c) => c !== 'coIes').map((c) => `\`${c}\`=VALUES(\`${c}\`)`).join(',')
        await prisma.$executeRawUnsafe(
          `INSERT INTO bychat_he_institutions (${cols.map((c) => `\`${c}\``).join(',')}) VALUES ${ph} ON DUPLICATE KEY UPDATE ${upd}`,
          ...batch.flat(),
        )
        batch = []
      }
      const now = new Date()
      for await (const { f, ix } of csvRows(zipPath, iesEntry)) {
        const coIes = int(f, ix, 'CO_IES')
        if (!coIes) continue
        const category = int(f, ix, 'TP_CATEGORIA_ADMINISTRATIVA')
        batch.push([
          coIes,
          str(f, ix, 'NO_IES') || 'sem nome',
          str(f, ix, 'SG_IES', 60),
          str(f, ix, 'SG_UF_IES', 2),
          str(f, ix, 'NO_MUNICIPIO_IES', 120),
          int(f, ix, 'IN_CAPITAL_IES') === 1,
          int(f, ix, 'TP_ORGANIZACAO_ACADEMICA') || null,
          category || null,
          PRIVATE_CATEGORIES.has(category),
          now,
        ])
        institutions++
        if (batch.length >= BATCH) await flushIes()
      }
      await flushIes()
      console.log(`[he-censo] ${year}: ${institutions.toLocaleString('pt-BR')} IES`)
    }

    // ── 2) Cursos (fato) ──
    // Reingestão limpa: apagar o ano é mais barato e seguro que tentar casar
    // chave natural (curso × local × modalidade colide em alguns registros).
    await prisma.$executeRawUnsafe('DELETE FROM bychat_he_courses WHERE year = ?', year)

    const COLS = [
      'year', 'coIes', 'coCurso', 'name', 'cineArea', 'cineDetailed', 'degree', 'modality',
      'category', 'organization', 'uf', 'city', 'cityCode', 'isCapital',
      'seats', 'seatsNight', 'applicants', 'entrants', 'entrantsNight', 'entrantsEnem',
      'entrantsVest', 'entrantsFies', 'entrantsProuni',
      'enrolled', 'enrolledFem', 'enrolled1824', 'enrolled2529', 'enrolled30p',
      'graduates', 'locked', 'dropped', 'transferred', 'enrolledFies', 'enrolledProuni',
    ]
    const insertSql = `INSERT INTO bychat_he_courses (${COLS.map((c) => `\`${c}\``).join(',')}) VALUES `

    let courses = 0
    let batch: any[][] = []
    const flush = async () => {
      if (!batch.length) return
      const ph = batch.map(() => `(${COLS.map(() => '?').join(',')})`).join(',')
      await prisma.$executeRawUnsafe(insertSql + ph, ...batch.flat())
      batch = []
    }

    for await (const { f, ix } of csvRows(zipPath, cursoEntry)) {
      const coIes = int(f, ix, 'CO_IES')
      const coCurso = int(f, ix, 'CO_CURSO')
      if (!coIes || !coCurso) continue

      batch.push([
        year, coIes, coCurso,
        str(f, ix, 'NO_CURSO') || 'sem nome',
        str(f, ix, 'NO_CINE_AREA_GERAL', 120),
        str(f, ix, 'NO_CINE_AREA_DETALHADA', 191),
        int(f, ix, 'TP_GRAU_ACADEMICO') || null,
        int(f, ix, 'TP_MODALIDADE_ENSINO') || null,
        int(f, ix, 'TP_CATEGORIA_ADMINISTRATIVA') || null,
        int(f, ix, 'TP_ORGANIZACAO_ACADEMICA') || null,
        str(f, ix, 'SG_UF', 2),
        str(f, ix, 'NO_MUNICIPIO', 120),
        int(f, ix, 'CO_MUNICIPIO') || null,
        int(f, ix, 'IN_CAPITAL') === 1,
        int(f, ix, 'QT_VG_TOTAL'), int(f, ix, 'QT_VG_TOTAL_NOTURNO'),
        int(f, ix, 'QT_INSCRITO_TOTAL'),
        int(f, ix, 'QT_ING'), int(f, ix, 'QT_ING_NOTURNO'),
        int(f, ix, 'QT_ING_ENEM'), int(f, ix, 'QT_ING_VESTIBULAR'),
        int(f, ix, 'QT_ING_FIES'), int(f, ix, 'QT_ING_PROUNII') + int(f, ix, 'QT_ING_PROUNIP'),
        int(f, ix, 'QT_MAT'), int(f, ix, 'QT_MAT_FEM'),
        int(f, ix, 'QT_MAT_18_24'), int(f, ix, 'QT_MAT_25_29'),
        int(f, ix, 'QT_MAT_30_34') + int(f, ix, 'QT_MAT_35_39') + int(f, ix, 'QT_MAT_40_49') + int(f, ix, 'QT_MAT_50_59') + int(f, ix, 'QT_MAT_60_MAIS'),
        int(f, ix, 'QT_CONC'),
        int(f, ix, 'QT_SIT_TRANCADA'), int(f, ix, 'QT_SIT_DESVINCULADO'), int(f, ix, 'QT_SIT_TRANSFERIDO'),
        int(f, ix, 'QT_MAT_FIES'), int(f, ix, 'QT_MAT_PROUNII') + int(f, ix, 'QT_MAT_PROUNIP'),
      ])
      courses++
      if (batch.length >= BATCH) await flush()
      if (courses % 100_000 === 0) console.log(`[he-censo] ${year}: ${courses.toLocaleString('pt-BR')} registros de curso…`)
    }
    await flush()

    // ── 3) Agregação por praça ──
    const marketRows = await rebuildMarket(year)

    const durationMs = Date.now() - t0
    await prisma.heImport.update({
      where: { year },
      data: { status: 'done', courses, institutions, marketRows, fileBytes: bytes, durationMs, error: null },
    })
    console.log(`[he-censo] ${year}: ${courses.toLocaleString('pt-BR')} cursos → ${marketRows.toLocaleString('pt-BR')} recortes de mercado em ${Math.round(durationMs / 1000)}s`)
    return { year, courses, institutions, marketRows, durationMs }
  } catch (err: any) {
    await prisma.heImport.update({
      where: { year },
      data: { status: 'failed', error: String(err?.message || err).slice(0, 2000), durationMs: Date.now() - t0 },
    }).catch(() => {})
    throw err
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Reconstrói o agregado do ano inteiramente em SQL — trazer 720 mil linhas para
 * o cliente só para somá-las seria desperdício. `institutions` usa COUNT
 * DISTINCT, que é o número que interessa ("quantas IES disputam esta praça").
 */
export async function rebuildMarket(year: number): Promise<number> {
  await prisma.$executeRawUnsafe('DELETE FROM bychat_he_market WHERE year = ?', year)
  await prisma.$executeRawUnsafe(`
    INSERT INTO bychat_he_market
      (year, uf, cityCode, city, cineArea, modality, isPrivate,
       courses, institutions, seats, applicants, entrants, enrolled, graduates, dropped, locked, fies, prouni, createdAt)
    SELECT
      year, uf, cityCode, MIN(city), cineArea, modality,
      CASE WHEN category IN (4,5,7) THEN 1 ELSE 0 END AS isPrivate,
      COUNT(*), COUNT(DISTINCT coIes),
      SUM(seats), SUM(applicants), SUM(entrants), SUM(enrolled),
      SUM(graduates), SUM(dropped), SUM(locked), SUM(enrolledFies), SUM(enrolledProuni), NOW()
    FROM bychat_he_courses
    WHERE year = ?
    GROUP BY year, uf, cityCode, cineArea, modality, CASE WHEN category IN (4,5,7) THEN 1 ELSE 0 END
  `, year)
  const [{ n }] = await prisma.$queryRawUnsafe<{ n: bigint }[]>('SELECT COUNT(*) AS n FROM bychat_he_market WHERE year = ?', year)
  return Number(n)
}

export async function ingestMissingHe(max = 1): Promise<HeIngestResult[]> {
  const releases = await listHeReleases()
  const done = await prisma.heImport.findMany({ where: { status: 'done' }, select: { year: true } })
  const have = new Set(done.map((d) => d.year))
  const out: HeIngestResult[] = []
  for (const r of releases.filter((x) => !have.has(x.year)).slice(0, max)) {
    try {
      out.push(await ingestHeYear(r.year))
    } catch (err: any) {
      console.error(`[he-censo] falha ao ingerir ${r.year}:`, err?.message || err)
    }
  }
  return out
}

// ── job ──────────────────────────────────────────────────────────────────────

const TICK_MS = 7 * 24 * 60 * 60 * 1000
let _timer: NodeJS.Timeout | null = null

export function startHeCensusJob(): void {
  if (_timer) return
  const tick = async () => {
    try {
      if (!(await isModuleEnabled('higher_ed_market'))) return
      await ingestMissingHe(1)
    } catch (err: any) {
      console.error('[he-censo] tick falhou:', err?.message || err)
    }
  }
  // 45 min após o boot: o pacote tem ~457 MB, não deve concorrer com as outras
  // ingestões nem com o warmup.
  setTimeout(() => {
    void tick()
    _timer = setInterval(() => void tick(), TICK_MS)
  }, 45 * 60 * 1000)
}

export function stopHeCensusJob(): void {
  if (_timer) { clearInterval(_timer); _timer = null }
}
