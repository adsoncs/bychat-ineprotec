// src/services/inepIngest.ts
//
// Radar Educacional (F3) — ingestão dos microdados do Censo Escolar (INEP/MEC).
//
// Por que esta fonte: são ~42 mil escolas privadas EM ATIVIDADE no país, 93%
// com telefone publicado — universo 25x maior e muito mais local que a base de
// reclamações do Consumidor.gov.br, e é exatamente o perfil PME que a agência
// atende. O sinal de dor é a QUEDA DE TURMAS ano a ano (a rede privada vem
// encolhendo) combinada com a imaturidade digital declarada no próprio censo.
//
// Só lemos as tabelas Escola e Turma, ambas agregadas por estabelecimento.
// As tabelas de Aluno, Docente e Gestor NÃO são abertas aqui — não precisamos
// de dado individual para prospectar uma escola, e não vamos tratá-lo.
//
// ARMADILHA DE TLS (custou tempo, não regredir): download.inep.gov.br serve um
// certificado válido mas NÃO envia o intermediário da cadeia (RNP ICPEdu, sob
// GlobalSign Root R46). O `curl` do sistema falha com "unknown CA" até instalar
// o intermediário, e o Node ignora o truststore do SO — por isso o PEM vai
// versionado em backend/certs/ e é injetado explicitamente na conexão.

import https from 'node:https'
import tls from 'node:tls'
import { spawn } from 'node:child_process'
import { createWriteStream, readFileSync, existsSync, statSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import readline from 'node:readline'
import { prisma } from '../lib/prisma.js'
import { isModuleEnabled } from '../lib/moduleManager.js'

const INDEX_URL = 'https://www.gov.br/inep/pt-br/acesso-a-informacao/dados-abertos/microdados/censo-escolar'
const UA = 'Mozilla/5.0 (compatible; ByChatRadar/1.0)'
const DEP_PRIVADA = '4'
const SITUACAO_ATIVA = '1'

// ── TLS ──────────────────────────────────────────────────────────────────────

let _ca: string[] | null = null
function inepCa(): string[] {
  if (_ca) return _ca
  const here = dirname(fileURLToPath(import.meta.url))
  // dist/services → ../../certs | src/services (tsx) → ../../certs
  const candidates = [
    join(here, '..', '..', 'certs', 'rnp-icpedu.pem'),
    join(here, '..', '..', '..', 'certs', 'rnp-icpedu.pem'),
  ]
  const extra = candidates.filter(existsSync).map((p) => readFileSync(p, 'utf8'))
  _ca = [...tls.rootCertificates, ...extra]
  return _ca
}

function httpsGet(url: string, depth = 0): Promise<{ body: Buffer; status: number; url: string }> {
  return new Promise((resolve, reject) => {
    if (depth > 5) return reject(new Error('redirects demais'))
    const u = new URL(url)
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'GET',
        headers: { 'User-Agent': UA },
        timeout: 120_000,
        ca: inepCa(),
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          return httpsGet(new URL(res.headers.location, url).toString(), depth + 1).then(resolve, reject)
        }
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => resolve({ body: Buffer.concat(chunks), status: res.statusCode || 0, url }))
        res.on('error', reject)
      },
    )
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    req.end()
  })
}

// ── índice de anos publicados ────────────────────────────────────────────────

export interface CensusRelease { year: number; url: string }

/**
 * Lê a página oficial e extrai os anos disponíveis.
 * O nome do arquivo não é estável (2025 saiu como
 * `microdados_censo_escolar_2025_.zip`, com underscore extra), então
 * derivamos sempre da página em vez de montar a URL na mão.
 */
export async function listCensusReleases(): Promise<CensusRelease[]> {
  const { body, status } = await httpsGet(INDEX_URL)
  if (status !== 200) throw new Error(`página do INEP retornou HTTP ${status}`)
  const html = body.toString('utf8')

  const out = new Map<number, string>()
  const re = /https?:\/\/[^"'\s]*microdados_censo_escolar_(\d{4})_?\.zip/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const year = Number(m[1])
    if (year >= 2015) out.set(year, m[0])
  }
  return [...out.entries()].map(([year, url]) => ({ year, url })).sort((a, b) => b.year - a.year)
}

// ── leitura do pacote ────────────────────────────────────────────────────────

/**
 * Baixa direto para disco (o pacote passa de 70 MB — não cabe bem em memória).
 *
 * O servidor do INEP derruba conexões longas com ECONNRESET com frequência,
 * então tentamos algumas vezes com espera crescente. Não é paranoia: aconteceu
 * na primeira execução real.
 */
function downloadOnce(url: string, dest: string, depth = 0): Promise<number> {
  return new Promise((resolve, reject) => {
    if (depth > 5) return reject(new Error('redirects demais'))
    const u = new URL(url)
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'GET',
        headers: { 'User-Agent': UA, Connection: 'keep-alive' },
        timeout: 300_000,
        ca: inepCa(),
      },
      (res) => {
        const status = res.statusCode || 0
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume()
          return downloadOnce(new URL(res.headers.location, url).toString(), dest, depth + 1).then(resolve, reject)
        }
        if (status !== 200) {
          res.resume()
          return reject(new Error(`download retornou HTTP ${status}`))
        }
        let bytes = 0
        const ws = createWriteStream(dest)
        res.on('data', (c: Buffer) => { bytes += c.length })
        res.on('error', (e) => { ws.destroy(); reject(e) })
        ws.on('error', reject)
        res.pipe(ws)
        ws.on('finish', () => {
          if (bytes < 1_000_000) return reject(new Error(`arquivo suspeito: ${bytes} bytes`))
          resolve(bytes)
        })
      },
    )
    req.on('timeout', () => req.destroy(new Error('timeout no download')))
    req.on('error', reject)
    req.end()
  })
}

/**
 * Baixa via `curl` do sistema.
 *
 * O cliente https do Node cai com ECONNRESET de forma reprodutível neste host
 * do INEP (testado: 4 tentativas seguidas, todas resetadas), enquanto o curl
 * baixa os 33 MB sem falhar. O certificado intermediário está instalado no
 * truststore do SO (/usr/local/share/ca-certificates/rnp-icpedu-gr46-2025.crt),
 * então o curl valida a cadeia normalmente — e passamos --cacert como reforço
 * caso o host ainda não tenha rodado update-ca-certificates.
 */
function download(url: string, dest: string): Promise<number> {
  const here = dirname(fileURLToPath(import.meta.url))
  const pem = [
    join(here, '..', '..', 'certs', 'rnp-icpedu.pem'),
    join(here, '..', '..', '..', 'certs', 'rnp-icpedu.pem'),
  ].find(existsSync)

  return new Promise((resolve, reject) => {
    // Flags primeiro, URL e destino por último — inserir opção no meio de
    // `-o <arquivo>` faz o curl tratar a flag como nome de arquivo.
    // `--retry` sozinho NÃO cobre "Connection reset by peer" no meio da
    // transferência (curl 35), que é justamente o que este host faz de forma
    // intermitente — daí --retry-all-errors, e -C - para retomar de onde parou
    // em vez de rebaixar os 33 MB inteiros.
    const args = [
      '-sSL', '--fail', '--retry', '5', '--retry-delay', '5', '--retry-all-errors',
      '-C', '-', '--max-time', '900',
      '--capath', '/etc/ssl/certs',
      ...(pem ? ['--cacert', pem] : []),
      '-A', UA, '-o', dest, url,
    ]

    const p = spawn('curl', args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    p.stderr.on('data', (d) => { stderr += String(d).slice(0, 500) })
    p.on('error', reject)
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(`curl falhou (exit ${code}): ${stderr.trim()}`))
      try {
        const bytes = statSync(dest).size
        if (bytes < 1_000_000) return reject(new Error(`arquivo suspeito: ${bytes} bytes`))
        resolve(bytes)
      } catch (err) {
        reject(err)
      }
    })
  })
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
 * O INEP mudou o layout do pacote entre 2024 e 2025 — e vai mudar de novo.
 *
 *   ≤ 2024: um arquivo único `microdados_ed_basica_<ano>.csv` com escola E
 *           turmas (QT_TUR_*) na mesma linha. A pasta interna às vezes tem
 *           sufixo ("..._2024_defeso").
 *   ≥ 2025: `Tabela_Escola_<ano>.csv` + `Tabela_Turma_<ano>.csv` separados.
 *
 * Detectamos pelo conteúdo do zip em vez de assumir por ano.
 */
async function resolveLayout(zipPath: string, year: number): Promise<{ schoolEntry: string; turmaEntry: string | null }> {
  const entries = await listEntries(zipPath)
  const school = entries.find((e) => new RegExp(`Tabela_Escola_${year}\\.csv$`, 'i').test(e))
  if (school) {
    const turma = entries.find((e) => new RegExp(`Tabela_Turma_${year}\\.csv$`, 'i').test(e)) || null
    return { schoolEntry: school, turmaEntry: turma }
  }
  const single = entries.find((e) => new RegExp(`microdados_ed_basica_${year}\\.csv$`, 'i').test(e))
  if (single) return { schoolEntry: single, turmaEntry: null }

  throw new Error(`layout desconhecido no pacote de ${year}: ${entries.filter((e) => e.endsWith('.csv')).join(', ') || 'nenhum CSV'}`)
}

/**
 * Itera as linhas de um CSV `;` de dentro do zip, sem materializar o arquivo.
 *
 * O listener de 'close' é registrado ANTES de consumir a saída, de propósito:
 * se ele fosse registrado depois do laço, o evento já teria ocorrido e o await
 * ficaria pendente para sempre. Como não sobraria nenhum handle ativo, o Node
 * encerraria o processo silenciosamente com código 0 no meio da ingestão —
 * exatamente o que acontecia aqui (parava por volta de 40 mil escolas, sem
 * erro e sem marcar o import como concluído).
 */
async function* csvRows(zipPath: string, entry: string): AsyncGenerator<Record<string, string>> {
  const proc = spawn('unzip', ['-p', zipPath, entry], { stdio: ['ignore', 'pipe', 'pipe'] })
  const closed = new Promise<number>((resolve) => proc.on('close', (code) => resolve(code ?? 0)))
  // Os CSVs do INEP são latin-1 (ISO-8859-1), não UTF-8 — decodificar errado
  // grava "Goi�nia" no banco. Verificado: o byte 0xF4 de "Rondônia" é
  // inválido em UTF-8.
  proc.stdout.setEncoding('latin1')
  const rl = readline.createInterface({ input: proc.stdout, crlfDelay: Infinity })
  let header: string[] | null = null
  for await (const line of rl) {
    if (!line.trim()) continue
    const cells = line.split(';')
    if (!header) {
      // latin-1 no arquivo do INEP: o cabeçalho pode vir com BOM/acentos quebrados,
      // mas as chaves que usamos são ASCII puro (CO_ENTIDADE, NU_TELEFONE…).
      header = cells.map((h) => h.replace(/^﻿/, '').trim())
      continue
    }
    const row: Record<string, string> = {}
    for (let i = 0; i < header.length; i++) row[header[i]] = (cells[i] ?? '').trim()
    yield row
  }
  const code = await closed
  if (code !== 0) throw new Error(`unzip -p falhou (exit ${code}) ao ler ${entry}`)
}

// ── score ────────────────────────────────────────────────────────────────────

/**
 * 0..100 — prioridade de abordagem de uma escola privada.
 *
 * Pesa a DOR (perder turmas) acima do porte: uma escola de 20 turmas que caiu
 * 15% precisa de marketing com mais urgência do que uma de 40 turmas estável.
 * Escolas minúsculas (< 3 turmas) são despriorizadas — normalmente creche de
 * fundo de quintal, sem orçamento para agência.
 */
export function computeEducationScore(a: {
  classes: number
  classesDelta: number | null
  hasInternetAdmin: boolean
  hasInternetLearn: boolean
}): number {
  if (a.classes < 3) return Math.min(20, a.classes * 5)

  // Porte: 5 turmas ≈ 0,3 · 20 ≈ 0,65 · 60+ ≈ 1
  const wSize = Math.min(1, Math.log10(a.classes + 1) / 1.8)
  // Queda de 20%+ satura. Crescimento não pontua (não há dor a resolver).
  const wDrop = a.classesDelta === null ? 0.35 : Math.max(0, Math.min(1, -a.classesDelta / 0.2))
  // Lacuna digital declarada no censo
  const gaps = (a.hasInternetAdmin ? 0 : 1) + (a.hasInternetLearn ? 0 : 1)
  const wDigital = gaps / 2

  return Math.round(100 * (0.40 * wDrop + 0.35 * wSize + 0.25 * wDigital))
}

// ── ingestão ─────────────────────────────────────────────────────────────────

const yn = (v: string) => v === '1'
const int = (v: string) => {
  const n = parseInt(v, 10)
  return isFinite(n) ? n : 0
}

export interface InepIngestResult {
  year: number
  rowsRead: number
  schools: number
  durationMs: number
  skipped?: boolean
}

export async function ingestCensusYear(year: number, opts: { force?: boolean } = {}): Promise<InepIngestResult> {
  const t0 = Date.now()

  const existing = await prisma.educationImport.findUnique({ where: { year } })
  if (existing?.status === 'done' && !opts.force) {
    return { year, rowsRead: existing.rowsRead, schools: existing.schools, durationMs: 0, skipped: true }
  }

  const releases = await listCensusReleases()
  const rel = releases.find((r) => r.year === year)
  if (!rel) throw new Error(`censo ${year} não está publicado (disponíveis: ${releases.map((r) => r.year).join(', ')})`)

  await prisma.educationImport.upsert({
    where: { year },
    create: { year, fileName: rel.url.split('/').pop() || null, status: 'running' },
    update: { status: 'running', error: null, rowsRead: 0, schools: 0 },
  })

  const dir = await mkdtemp(join(tmpdir(), 'inep-'))
  const zipPath = join(dir, `censo_${year}.zip`)

  try {
    const bytes = await download(rel.url, zipPath)

    const { schoolEntry, turmaEntry } = await resolveLayout(zipPath, year)

    // 1) Turmas por escola. No layout novo vêm num arquivo à parte (cabe num
    //    Map: ~180 mil escolas); no antigo já estão na linha da escola.
    const turmas = new Map<string, { bas: number; inf: number; fund: number; med: number; prof: number; eja: number }>()
    if (turmaEntry) {
      for await (const r of csvRows(zipPath, turmaEntry)) {
        const co = r['CO_ENTIDADE']
        if (!co) continue
        turmas.set(co, {
          bas: int(r['QT_TUR_BAS']), inf: int(r['QT_TUR_INF']), fund: int(r['QT_TUR_FUND']),
          med: int(r['QT_TUR_MED']), prof: int(r['QT_TUR_PROF']), eja: int(r['QT_TUR_EJA']),
        })
      }
    }

    // 2) Escolas privadas ativas → grava em lotes.
    const escolaEntry = schoolEntry
    let rowsRead = 0
    let schools = 0
    let batch: any[][] = []

    const flush = async () => {
      if (batch.length === 0) return
      // INSERT ... ON DUPLICATE KEY UPDATE: 42 mil upserts um a um levaria
      // minutos; em lotes de 500 o carregamento inteiro roda em segundos.
      const cols = [
        'inepCode', 'name', 'uf', 'city', 'cityCode', 'district', 'address', 'zip', 'phone',
        'privateCategory', 'urban', 'lastYear', 'classes', 'classesInf', 'classesFund',
        'classesMed', 'classesProf', 'classesEja', 'hasInternet', 'hasInternetAdmin',
        'hasInternetLearn', 'updatedAt',
      ]
      const placeholders = batch.map(() => `(${cols.map(() => '?').join(',')})`).join(',')
      const updates = cols.filter((c) => c !== 'inepCode').map((c) => `\`${c}\`=VALUES(\`${c}\`)`).join(',')
      const sql = `INSERT INTO bychat_education_institutions (${cols.map((c) => `\`${c}\``).join(',')}) VALUES ${placeholders} ON DUPLICATE KEY UPDATE ${updates}`
      await prisma.$executeRawUnsafe(sql, ...batch.flat())
      batch = []
    }

    const now = new Date()
    for await (const r of csvRows(zipPath, escolaEntry)) {
      rowsRead++
      if (r['TP_DEPENDENCIA'] !== DEP_PRIVADA) continue
      if (r['TP_SITUACAO_FUNCIONAMENTO'] !== SITUACAO_ATIVA) continue
      const co = r['CO_ENTIDADE']
      if (!co) continue

      const t = turmaEntry
        ? (turmas.get(co) || { bas: 0, inf: 0, fund: 0, med: 0, prof: 0, eja: 0 })
        : {
            bas: int(r['QT_TUR_BAS']), inf: int(r['QT_TUR_INF']), fund: int(r['QT_TUR_FUND']),
            med: int(r['QT_TUR_MED']), prof: int(r['QT_TUR_PROF']), eja: int(r['QT_TUR_EJA']),
          }
      batch.push([
        co.slice(0, 20),
        (r['NO_ENTIDADE'] || 'sem nome').slice(0, 191),
        (r['SG_UF'] || '').slice(0, 2) || null,
        (r['NO_MUNICIPIO'] || '').slice(0, 120) || null,
        (r['CO_MUNICIPIO'] || '').slice(0, 10) || null,
        (r['NO_BAIRRO'] || '').slice(0, 120) || null,
        [r['DS_ENDERECO'], r['NU_ENDERECO'], r['DS_COMPLEMENTO']].filter(Boolean).join(', ').slice(0, 500) || null,
        (r['CO_CEP'] || '').slice(0, 12) || null,
        (r['NU_TELEFONE'] || '').slice(0, 40) || null,
        r['TP_CATEGORIA_ESCOLA_PRIVADA'] ? int(r['TP_CATEGORIA_ESCOLA_PRIVADA']) : null,
        r['TP_LOCALIZACAO'] === '1',
        year,
        t.bas, t.inf, t.fund, t.med, t.prof, t.eja,
        yn(r['IN_INTERNET']), yn(r['IN_INTERNET_ADMINISTRATIVO']), yn(r['IN_INTERNET_APRENDIZAGEM']),
        now,
      ])
      schools++
      if (batch.length >= 500) await flush()
      if (schools % 10_000 === 0) console.log(`[inep] ${year}: ${schools.toLocaleString('pt-BR')} escolas privadas gravadas…`)
    }
    await flush()
    console.log(`[inep] ${year}: leitura concluída (${rowsRead.toLocaleString('pt-BR')} linhas), calculando tendência e score…`)

    // 3) Snapshot do ano + tendência + score, em SQL (42 mil linhas de ida e
    //    volta pelo cliente seria desperdício).
    await prisma.$executeRawUnsafe(`
      INSERT INTO bychat_education_snapshots (institutionId, year, classes, classesInf, classesFund, classesMed, createdAt)
      SELECT id, ?, classes, classesInf, classesFund, classesMed, NOW()
      FROM bychat_education_institutions WHERE lastYear = ?
      ON DUPLICATE KEY UPDATE classes=VALUES(classes), classesInf=VALUES(classesInf),
        classesFund=VALUES(classesFund), classesMed=VALUES(classesMed)
    `, year, year)

    await prisma.$executeRawUnsafe(`
      UPDATE bychat_education_institutions i
      JOIN bychat_education_snapshots prev ON prev.institutionId = i.id AND prev.year = ?
      SET i.classesDelta = CASE WHEN prev.classes > 0 THEN (i.classes - prev.classes) / prev.classes ELSE NULL END
      WHERE i.lastYear = ?
    `, year - 1, year)

    const recomputed = await recomputeScores(year)

    const durationMs = Date.now() - t0
    await prisma.educationImport.update({
      where: { year },
      data: { status: 'done', rowsRead, schools, fileBytes: bytes, durationMs, error: null },
    })
    console.log(`[inep] censo ${year}: ${rowsRead.toLocaleString('pt-BR')} escolas lidas → ${schools.toLocaleString('pt-BR')} privadas ativas (${recomputed} scores) em ${Math.round(durationMs / 1000)}s`)
    return { year, rowsRead, schools, durationMs }
  } catch (err: any) {
    await prisma.educationImport.update({
      where: { year },
      data: { status: 'failed', error: String(err?.message || err).slice(0, 2000), durationMs: Date.now() - t0 },
    }).catch(() => {})
    throw err
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/** Recalcula o score das escolas de um ano. Feito em lote no cliente porque a
 *  fórmula vive no TypeScript — duplicá-la em SQL sairia caro de manter. */
export async function recomputeScores(year: number): Promise<number> {
  const BATCH = 2000
  let cursor = 0
  let total = 0
  for (;;) {
    const rows = await prisma.educationInstitution.findMany({
      where: { lastYear: year, id: { gt: cursor } },
      orderBy: { id: 'asc' },
      take: BATCH,
      select: { id: true, classes: true, classesDelta: true, hasInternetAdmin: true, hasInternetLearn: true },
    })
    if (rows.length === 0) break
    cursor = rows[rows.length - 1].id

    // Agrupa por score para transformar N updates em ~100 updateMany.
    const byScore = new Map<number, number[]>()
    for (const r of rows) {
      const s = computeEducationScore({
        classes: r.classes, classesDelta: r.classesDelta,
        hasInternetAdmin: r.hasInternetAdmin, hasInternetLearn: r.hasInternetLearn,
      })
      const arr = byScore.get(s)
      if (arr) arr.push(r.id)
      else byScore.set(s, [r.id])
    }
    for (const [score, ids] of byScore) {
      await prisma.educationInstitution.updateMany({ where: { id: { in: ids } }, data: { opportunityScore: score } })
    }
    total += rows.length
  }
  return total
}

/** Ingere os anos publicados que ainda faltam, do mais recente para trás. */
export async function ingestMissingCensus(max = 1): Promise<InepIngestResult[]> {
  const releases = await listCensusReleases()
  const done = await prisma.educationImport.findMany({ where: { status: 'done' }, select: { year: true } })
  const have = new Set(done.map((d) => d.year))
  const todo = releases.filter((r) => !have.has(r.year)).slice(0, max)

  const out: InepIngestResult[] = []
  for (const r of todo) {
    try {
      out.push(await ingestCensusYear(r.year))
    } catch (err: any) {
      console.error(`[inep] falha ao ingerir ${r.year}:`, err?.message || err)
    }
  }
  return out
}

// ── job ──────────────────────────────────────────────────────────────────────

const TICK_MS = 7 * 24 * 60 * 60 * 1000 // semanal — o censo sai 1x por ano
let _timer: NodeJS.Timeout | null = null

export function startInepCensusJob(): void {
  if (_timer) return
  const tick = async () => {
    try {
      if (!(await isModuleEnabled('reputation_radar'))) return
      const res = await ingestMissingCensus(1)
      for (const r of res) if (!r.skipped) console.log(`[inep] censo ${r.year} ingerido: ${r.schools} escolas privadas`)
    } catch (err: any) {
      console.error('[inep] tick falhou:', err?.message || err)
    }
  }
  // 30 min após o boot: o pacote tem ~77 MB e a leitura é pesada; não deve
  // competir com o warmup nem com a ingestão do Consumidor.gov.br.
  setTimeout(() => {
    void tick()
    _timer = setInterval(() => void tick(), TICK_MS)
  }, 30 * 60 * 1000)
}

export function stopInepCensusJob(): void {
  if (_timer) { clearInterval(_timer); _timer = null }
}
