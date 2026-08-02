// src/services/reputationIngest.ts
//
// Radar de Reputação — F0: ingestão da base aberta do Consumidor.gov.br (Senacon/MJ).
//
// Fonte oficial e gratuita, publicada mensalmente (~dia 6-8 do mês seguinte):
//   índice:    GET /pages/publicacao/externo/publicacoes.json?indicadorTipoPublicacao=2
//   download:  GET /pages/publicacao/externo/{codigo}/download   → finalizadas_YYYY-MM.zip
//
// O ZIP traz um CSV único (~140 MB, `;`, UTF-8 com BOM) com uma linha por
// reclamação FINALIZADA no mês. 19 colunas, sendo as que interessam:
//   Nome Fantasia | Segmento de Mercado | Área | UF | Problema |
//   Respondida (S/N) | Avaliação Reclamação | Nota do Consumidor (1-5) |
//   Tempo Resposta (dias)
//
// LGPD: a base é anonimizada na origem — não há nome, CPF, e-mail nem telefone
// do consumidor, só recortes demográficos (região/UF/cidade, sexo, faixa etária).
// Agregamos por EMPRESA e descartamos a linha; nada de dado pessoal é persistido.
// Não adicione aqui nenhuma tentativa de identificar o reclamante.
//
// Observação de escala: o CSV é grande mas o resultado é pequeno (~1.4 mil
// empresas participantes). Streamamos o arquivo e agregamos em memória —
// o Map final cabe folgado em alguns MB.

import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import readline from 'node:readline'
import { prisma } from '../lib/prisma.js'
import { isModuleEnabled } from '../lib/moduleManager.js'

const BASE_URL = process.env.REPUTATION_SOURCE_URL || 'https://consumidor.gov.br'
const INDEX_PATH = '/pages/publicacao/externo/publicacoes.json?indicadorTipoPublicacao=2'
const UA = 'Mozilla/5.0 (compatible; ByChatRadarReputacao/1.0)'
const FETCH_TIMEOUT_MS = 5 * 60_000

export interface Publication {
  period: string // YYYY-MM
  codigo: string
  fileName: string
  bytes: number
  publishedAt: string
}

// ── Índice de publicações ────────────────────────────────────────────────────

// Lista os períodos disponíveis na fonte, do mais recente para o mais antigo.
export async function listPublications(): Promise<Publication[]> {
  const res = await fetch(`${BASE_URL}${INDEX_PATH}`, {
    headers: { 'User-Agent': UA, accept: 'application/json' },
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new Error(`índice de publicações retornou HTTP ${res.status}`)
  const rows = (await res.json()) as any[]

  const out: Publication[] = []
  for (const r of Array.isArray(rows) ? rows : []) {
    const name = String(r?.nomeArquivo || '')
    // Só as bases mensais completas. Ignora os consolidados diários
    // (usuarios_consolidados.csv / reclamacoes_consolidados.csv) e os ZIPs
    // semestrais legados de 2018 e anteriores.
    const m = /^finalizadas_(\d{4})-(\d{2})\.zip$/i.exec(name)
    if (!m) continue
    out.push({
      period: `${m[1]}-${m[2]}`,
      codigo: String(r.codigo),
      fileName: name,
      bytes: Number(r.tamanhoArquivo) || 0,
      publishedAt: String(r.dataPublicacao || ''),
    })
  }
  out.sort((a, b) => b.period.localeCompare(a.period))
  return out
}

// ── Parsing ──────────────────────────────────────────────────────────────────

// Split de linha CSV com suporte a campo entre aspas (o dump usa `;` e raramente
// aspas, mas um único campo com `;` dentro desalinharia a linha inteira).
function splitCsv(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ } else quoted = false
      } else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === ';') { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur)
  return out
}

// Chave estável entre períodos: o "Nome Fantasia" é o único identificador que a
// base traz (não há CNPJ). Normalizamos para absorver variação de acento/caixa.
export function companySlug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 191)
}

interface Agg {
  name: string
  segment: string
  area: string
  complaints: number
  unanswered: number
  rated: number
  unresolved: number
  scoreSum: number
  scoreCount: number
  daysSum: number
  daysCount: number
  problems: Map<string, number>
  ufs: Map<string, number>
  channels: Map<string, number>
}

function newAgg(name: string): Agg {
  return {
    name, segment: '', area: '',
    complaints: 0, unanswered: 0, rated: 0, unresolved: 0,
    scoreSum: 0, scoreCount: 0, daysSum: 0, daysCount: 0,
    problems: new Map(), ufs: new Map(), channels: new Map(),
  }
}

function bump(m: Map<string, number>, k: string) {
  if (!k) return
  m.set(k, (m.get(k) || 0) + 1)
}

function topN(m: Map<string, number>, n: number): Record<string, number> {
  return Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n))
}

// ── Score de oportunidade ────────────────────────────────────────────────────

// 0..100 — o quanto a empresa "dói" hoje, e portanto o quanto vale a abordagem.
// Pesos: negligência (não responder) pesa mais que insatisfação, porque é o
// problema que a agência resolve diretamente e é visível de fora.
export function computeOpportunityScore(a: {
  complaints: number
  unanswered: number
  rated: number
  unresolved: number
  scoreAvg: number | null
  trend: number | null // variação % do volume vs. período anterior
}): number {
  if (a.complaints <= 0) return 0

  const wUnanswered = a.unanswered / a.complaints                       // 0..1
  const wUnresolved = a.rated > 0 ? a.unresolved / a.rated : 0.5        // sem avaliação = neutro
  const wScore = a.scoreAvg === null ? 0.5 : Math.max(0, Math.min(1, (5 - a.scoreAvg) / 4))
  // Volume em escala log: 10 recl. ≈ 0.33, 100 ≈ 0.67, 1000+ ≈ 1.0
  const wVolume = Math.min(1, Math.log10(a.complaints + 1) / 3)
  // Piora de 50%+ no volume satura o componente de tendência.
  const wTrend = a.trend === null ? 0.3 : Math.max(0, Math.min(1, a.trend / 0.5))

  const raw = 0.30 * wUnanswered + 0.20 * wUnresolved + 0.20 * wScore + 0.20 * wVolume + 0.10 * wTrend
  return Math.round(raw * 100)
}

// ── Ingestão ─────────────────────────────────────────────────────────────────

async function downloadZip(codigo: string, dest: string): Promise<number> {
  const res = await fetch(`${BASE_URL}/pages/publicacao/externo/${codigo}/download`, {
    headers: { 'User-Agent': UA },
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok || !res.body) throw new Error(`download retornou HTTP ${res.status}`)
  let bytes = 0
  const src = Readable.fromWeb(res.body as any)
  src.on('data', (c: Buffer) => { bytes += c.length })
  await pipeline(src, createWriteStream(dest))
  if (bytes < 1_000_000) throw new Error(`arquivo suspeito: só ${bytes} bytes (esperado ~10 MB)`)
  return bytes
}

// Abre o CSV de dentro do pacote baixado como stream de leitura.
//
// Duas armadilhas da fonte, ambas descobertas na prática:
//   1. O ZIP publicado pelo sistema usa deflate64, que nenhuma lib de zip do npm
//      (unzipper/adm-zip/yauzl) descompacta — por isso usamos o `unzip` do SO.
//   2. Nos meses publicados manualmente por um servidor (ex.: 2026-05), o ZIP
//      não contém o CSV e sim um **.7z** com o CSV dentro. Aí precisa do `7z`.
async function openCsvProcess(zipPath: string, workDir: string) {
  const list = await new Promise<string>((resolve, reject) => {
    const p = spawn('unzip', ['-Z1', zipPath])
    let out = ''
    p.stdout.on('data', d => { out += String(d) })
    p.on('close', code => (code === 0 ? resolve(out) : reject(new Error(`unzip -Z1 falhou (exit ${code})`))))
  })
  const entry = list.split('\n').map(s => s.trim()).filter(Boolean)[0]
  if (!entry) throw new Error('pacote veio vazio')

  if (/\.csv$/i.test(entry)) {
    return spawn('unzip', ['-p', zipPath], { stdio: ['ignore', 'pipe', 'pipe'] })
  }

  if (/\.7z$/i.test(entry)) {
    // 7z não lê de stdin, então materializa o .7z antes de streamar o CSV.
    await new Promise<void>((resolve, reject) => {
      const p = spawn('unzip', ['-o', '-q', zipPath, '-d', workDir], { stdio: ['ignore', 'ignore', 'pipe'] })
      p.on('close', code => (code === 0 ? resolve() : reject(new Error(`unzip do .7z falhou (exit ${code})`))))
    })
    return spawn('7z', ['e', '-so', join(workDir, entry)], { stdio: ['ignore', 'pipe', 'pipe'] })
  }

  throw new Error(`formato interno não suportado: ${entry}`)
}

// Lê o CSV do pacote e agrega por empresa.
async function aggregateFromZip(zipPath: string, workDir: string): Promise<{ byCompany: Map<string, Agg>; rows: number }> {
  const proc = await openCsvProcess(zipPath, workDir)
  let stderr = ''
  proc.stderr.on('data', (d) => { stderr += String(d).slice(0, 2000) })

  const rl = readline.createInterface({ input: proc.stdout, crlfDelay: Infinity })
  const byCompany = new Map<string, Agg>()
  let rows = 0
  let idx: Record<string, number> | null = null

  for await (const rawLine of rl) {
    const line = rows === 0 && idx === null ? rawLine.replace(/^\uFEFF/, '') : rawLine
    if (!line.trim()) continue

    if (idx === null) {
      const hdr = splitCsv(line).map(h => h.trim())
      idx = {}
      hdr.forEach((h, i) => { idx![h] = i })
      const required = ['Nome Fantasia', 'Respondida', 'Avaliação Reclamação']
      const missing = required.filter(c => idx![c] === undefined)
      if (missing.length) throw new Error(`layout inesperado do CSV, faltam colunas: ${missing.join(', ')}`)
      continue
    }

    const f = splitCsv(line)
    const name = (f[idx['Nome Fantasia']] || '').trim()
    if (!name) continue
    const slug = companySlug(name)
    if (!slug) continue

    let a = byCompany.get(slug)
    if (!a) { a = newAgg(name); byCompany.set(slug, a) }

    a.complaints++
    rows++
    if (!a.segment) a.segment = (f[idx['Segmento de Mercado']] || '').trim()
    if (!a.area) a.area = (f[idx['Área']] || '').trim()

    if ((f[idx['Respondida']] || '').trim().toUpperCase() === 'N') a.unanswered++

    const aval = (f[idx['Avaliação Reclamação']] || '').trim()
    if (aval && !/^N[aã]o Avaliada$/i.test(aval)) {
      a.rated++
      if (/^N[aã]o Resolvida$/i.test(aval)) a.unresolved++
    }

    const nota = parseFloat((f[idx['Nota do Consumidor']] || '').replace(',', '.'))
    if (isFinite(nota) && nota > 0) { a.scoreSum += nota; a.scoreCount++ }

    const dias = parseFloat((f[idx['Tempo Resposta']] || '').replace(',', '.'))
    if (isFinite(dias) && dias >= 0) { a.daysSum += dias; a.daysCount++ }

    bump(a.problems, (f[idx['Problema']] || '').trim().slice(0, 255))
    bump(a.ufs, (f[idx['UF']] || '').trim().slice(0, 2))
    bump(a.channels, (f[idx['Como Comprou Contratou']] || '').trim())
  }

  const code: number = await new Promise((resolve) => proc.on('close', resolve))
  if (code !== 0) throw new Error(`descompactação falhou (exit ${code}): ${stderr.trim()}`)
  if (rows === 0) throw new Error('CSV veio vazio')

  return { byCompany, rows }
}

export interface IngestResult {
  period: string
  rows: number
  companies: number
  durationMs: number
  skipped?: boolean
}

// Ingere um período (YYYY-MM). Idempotente: se já houve import 'done' para o
// período, retorna skipped a menos que `force`.
export async function ingestPeriod(period: string, opts: { force?: boolean } = {}): Promise<IngestResult> {
  const t0 = Date.now()

  const existing = await prisma.reputationImport.findUnique({ where: { period } })
  if (existing?.status === 'done' && !opts.force) {
    return { period, rows: existing.rows, companies: existing.companies, durationMs: 0, skipped: true }
  }

  const pubs = await listPublications()
  const pub = pubs.find(p => p.period === period)
  if (!pub) throw new Error(`período ${period} não está publicado na fonte`)

  await prisma.reputationImport.upsert({
    where: { period },
    create: { period, sourceCode: pub.codigo, fileName: pub.fileName, status: 'running' },
    update: { sourceCode: pub.codigo, fileName: pub.fileName, status: 'running', error: null, rows: 0, companies: 0 },
  })

  const dir = await mkdtemp(join(tmpdir(), 'reputation-'))
  const zipPath = join(dir, pub.fileName)

  try {
    const bytes = await downloadZip(pub.codigo, zipPath)
    const { byCompany, rows } = await aggregateFromZip(zipPath, dir)

    // Período anterior (para tendência). Ex.: 2026-06 → 2026-05
    const [y, m] = period.split('-').map(Number)
    const prevDate = new Date(Date.UTC(y, m - 2, 1))
    const prevPeriod = `${prevDate.getUTCFullYear()}-${String(prevDate.getUTCMonth() + 1).padStart(2, '0')}`

    for (const [slug, a] of byCompany) {
      const avgScore = a.scoreCount > 0 ? a.scoreSum / a.scoreCount : null
      const avgDays = a.daysCount > 0 ? a.daysSum / a.daysCount : null

      const company = await prisma.reputationCompany.upsert({
        where: { slug },
        create: { slug, name: a.name, segment: a.segment || null, area: a.area || null },
        update: { name: a.name, segment: a.segment || null, area: a.area || null },
      })

      await prisma.reputationSnapshot.upsert({
        where: { companyId_period: { companyId: company.id, period } },
        create: {
          companyId: company.id, period,
          complaints: a.complaints, unanswered: a.unanswered, rated: a.rated, unresolved: a.unresolved,
          avgScore, avgResponseDays: avgDays,
          breakdown: { problems: topN(a.problems, 10), ufs: topN(a.ufs, 10), channels: topN(a.channels, 10) },
        },
        update: {
          complaints: a.complaints, unanswered: a.unanswered, rated: a.rated, unresolved: a.unresolved,
          avgScore, avgResponseDays: avgDays,
          breakdown: { problems: topN(a.problems, 10), ufs: topN(a.ufs, 10), channels: topN(a.channels, 10) },
        },
      })

      // Só recalcula os agregados denormalizados se este é o período mais
      // recente da empresa — reprocessar um mês antigo não deve "rejuvenescer" o card.
      if (!company.lastPeriod || period >= company.lastPeriod) {
        const prev = await prisma.reputationSnapshot.findUnique({
          where: { companyId_period: { companyId: company.id, period: prevPeriod } },
          select: { complaints: true },
        })
        const trend = prev && prev.complaints > 0 ? (a.complaints - prev.complaints) / prev.complaints : null

        await prisma.reputationCompany.update({
          where: { id: company.id },
          data: {
            lastPeriod: period,
            complaints: a.complaints,
            unansweredRate: a.complaints > 0 ? a.unanswered / a.complaints : null,
            unresolvedRate: a.rated > 0 ? a.unresolved / a.rated : null,
            ratedShare: a.complaints > 0 ? a.rated / a.complaints : null,
            avgScore,
            avgResponseDays: avgDays,
            topProblem: [...a.problems.entries()].sort((x, z) => z[1] - x[1])[0]?.[0] || null,
            topUf: [...a.ufs.entries()].sort((x, z) => z[1] - x[1])[0]?.[0] || null,
            complaintsDelta: trend,
            opportunityScore: computeOpportunityScore({
              complaints: a.complaints, unanswered: a.unanswered, rated: a.rated,
              unresolved: a.unresolved, scoreAvg: avgScore, trend,
            }),
          },
        })
      }
    }

    const durationMs = Date.now() - t0
    await prisma.reputationImport.update({
      where: { period },
      data: { status: 'done', rows, companies: byCompany.size, fileBytes: bytes, durationMs, error: null },
    })
    console.log(`[reputation] ${period}: ${rows.toLocaleString('pt-BR')} reclamações → ${byCompany.size} empresas em ${Math.round(durationMs / 1000)}s`)
    return { period, rows, companies: byCompany.size, durationMs }
  } catch (err: any) {
    await prisma.reputationImport.update({
      where: { period },
      data: { status: 'failed', error: String(err?.message || err).slice(0, 2000), durationMs: Date.now() - t0 },
    }).catch(() => {})
    throw err
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

// Ingere todos os períodos publicados que ainda não temos, do mais novo para o
// mais antigo, limitado a `max` (a base tem histórico desde 2019 — puxar tudo
// de uma vez levaria horas e não muda a decisão comercial).
export async function ingestMissing(max = 1): Promise<IngestResult[]> {
  const pubs = await listPublications()
  const done = await prisma.reputationImport.findMany({ where: { status: 'done' }, select: { period: true } })
  const have = new Set(done.map(d => d.period))

  const todo = pubs.filter(p => !have.has(p.period)).slice(0, max)
  const results: IngestResult[] = []
  for (const p of todo) {
    try {
      results.push(await ingestPeriod(p.period))
    } catch (err: any) {
      console.error(`[reputation] falha ao ingerir ${p.period}:`, err?.message || err)
    }
  }
  return results
}

// ── Job recorrente ───────────────────────────────────────────────────────────

const TICK_MS = 24 * 60 * 60 * 1000 // 1x/dia — a fonte publica 1x/mês
let _timer: NodeJS.Timeout | null = null

export function startReputationRadarJob(): void {
  if (_timer) return
  const tick = async () => {
    try {
      if (!(await isModuleEnabled('reputation_radar'))) return
      const res = await ingestMissing(1)
      if (res.length === 0) return
      for (const r of res) {
        if (!r.skipped) console.log(`[reputation] novo período ingerido: ${r.period} (${r.companies} empresas)`)
      }
    } catch (err: any) {
      console.error('[reputation] tick falhou:', err?.message || err)
    }
  }
  // 10 min após o boot: a ingestão baixa ~10 MB e lê 140 MB, não deve competir
  // com o warmup do app.
  setTimeout(() => {
    void tick()
    _timer = setInterval(() => void tick(), TICK_MS)
  }, 10 * 60 * 1000)
}

export function stopReputationRadarJob(): void {
  if (_timer) { clearInterval(_timer); _timer = null }
}
