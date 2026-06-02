// src/services/evolutionUpgrade.ts
// Detecta versão da Evolution API, compara com última release do GitHub e dispara
// upgrade controlado via script shell. Para SUPERADMIN apenas, com rate limit e
// backup automático + rollback embutidos no script.

import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'

const EVO_URL = process.env.EVOLUTION_API_URL || ''
const EVO_KEY = process.env.EVOLUTION_API_KEY || ''
const UPGRADE_SCRIPT = '/var/www/bychat-beyond/scripts/upgrade-evolution.sh'

interface VersionInfo {
  installed: string | null
  latest: string | null
  latestPublished: string | null
  upToDate: boolean
  changelog: string | null
  releaseUrl: string | null
}

export interface UpgradeJob {
  id: string
  startedAt: Date
  finishedAt: Date | null
  targetTag: string
  status: 'running' | 'success' | 'failed' | 'rolled_back'
  triggeredBy: { userId: number; email: string }
  logs: string[]
  backupPath: string | null
  error: string | null
}

// Job em memória (um upgrade por vez). Persistência em banco é overkill.
let _activeJob: UpgradeJob | null = null
let _lastJob: UpgradeJob | null = null

// Rate limit simples em memória
let _lastUpgradeAt: Date | null = null
const MIN_INTERVAL_MS = 60 * 60 * 1000  // 1 hora

// ─── Leitura de versão ───────────────────────────────────

export async function getInstalledVersion(): Promise<string | null> {
  if (!EVO_URL) return null
  try {
    const res = await fetch(EVO_URL, {
      headers: EVO_KEY ? { apikey: EVO_KEY } : {},
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const data: any = await res.json()
    return data?.version || null
  } catch {
    return null
  }
}

let _githubCache: { data: any; expiresAt: number } | null = null

export async function getLatestVersion(): Promise<{ tag: string; publishedAt: string; body: string; htmlUrl: string } | null> {
  if (_githubCache && _githubCache.expiresAt > Date.now()) return _githubCache.data
  try {
    const res = await fetch('https://api.github.com/repos/EvolutionAPI/evolution-api/releases/latest', {
      signal: AbortSignal.timeout(10000),
      headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'bychat-beyond' },
    })
    if (!res.ok) return null
    const d: any = await res.json()
    const out = {
      tag: d.tag_name as string,
      publishedAt: d.published_at as string,
      body: d.body as string,
      htmlUrl: d.html_url as string,
    }
    // Cache por 1 hora
    _githubCache = { data: out, expiresAt: Date.now() + 60 * 60 * 1000 }
    return out
  } catch {
    return null
  }
}

function normalizeTag(v: string | null): string {
  if (!v) return ''
  return v.replace(/^v/i, '').trim()
}

export async function getVersionInfo(): Promise<VersionInfo> {
  const [installed, latest] = await Promise.all([getInstalledVersion(), getLatestVersion()])
  const installedNorm = normalizeTag(installed)
  const latestNorm = normalizeTag(latest?.tag || null)
  return {
    installed,
    latest: latest?.tag || null,
    latestPublished: latest?.publishedAt || null,
    upToDate: !!installedNorm && !!latestNorm && installedNorm === latestNorm,
    changelog: latest?.body || null,
    releaseUrl: latest?.htmlUrl || null,
  }
}

// ─── Upgrade ─────────────────────────────────────────────

export function getActiveJob(): UpgradeJob | null {
  return _activeJob
}

export function getLastJob(): UpgradeJob | null {
  return _activeJob || _lastJob
}

export function canStartUpgrade(): { ok: boolean; reason?: string; waitSeconds?: number } {
  if (_activeJob) return { ok: false, reason: 'Já existe um upgrade em andamento' }
  if (_lastUpgradeAt) {
    const elapsed = Date.now() - _lastUpgradeAt.getTime()
    if (elapsed < MIN_INTERVAL_MS) {
      return { ok: false, reason: 'Rate limit (máx 1 upgrade por hora)', waitSeconds: Math.ceil((MIN_INTERVAL_MS - elapsed) / 1000) }
    }
  }
  return { ok: true }
}

async function ensureScriptExecutable(): Promise<void> {
  try {
    await fs.access(UPGRADE_SCRIPT)
    await fs.chmod(UPGRADE_SCRIPT, 0o755)
  } catch (e: any) {
    throw new Error(`Script de upgrade não encontrado: ${UPGRADE_SCRIPT}`)
  }
}

export async function startUpgrade(targetTag: string, user: { userId: number; email: string }): Promise<UpgradeJob> {
  const guard = canStartUpgrade()
  if (!guard.ok) throw new Error(guard.reason)

  await ensureScriptExecutable()

  const job: UpgradeJob = {
    id: `up-${Date.now()}`,
    startedAt: new Date(),
    finishedAt: null,
    targetTag,
    status: 'running',
    triggeredBy: user,
    logs: [`[${new Date().toISOString()}] Upgrade para ${targetTag} iniciado por ${user.email}`],
    backupPath: null,
    error: null,
  }
  _activeJob = job
  _lastUpgradeAt = new Date()

  // Dispara o script em background (não bloqueia a request)
  runUpgradeProcess(job).catch((err) => {
    job.logs.push(`[FATAL] ${err?.message || err}`)
    job.status = 'failed'
    job.error = err?.message || String(err)
    job.finishedAt = new Date()
    _lastJob = job
    _activeJob = null
  })

  return job
}

function runUpgradeProcess(job: UpgradeJob): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn('bash', [UPGRADE_SCRIPT, job.targetTag], {
      env: { ...process.env, UPGRADE_JOB_ID: job.id },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const append = (chunk: Buffer, label?: string) => {
      const text = chunk.toString('utf8')
      for (const line of text.split('\n')) {
        if (!line.trim()) continue
        const prefix = label === 'stderr' ? '[ERR]' : ''
        job.logs.push(`${prefix}${line}`)
        // Limita histórico em memória
        if (job.logs.length > 2000) job.logs.splice(0, job.logs.length - 2000)

        // Detecta path do backup (para exibir no UI)
        const m = line.match(/BACKUP_DIR=(\S+)/)
        if (m) job.backupPath = m[1]
      }
    }

    child.stdout.on('data', (c) => append(c))
    child.stderr.on('data', (c) => append(c, 'stderr'))

    child.on('close', (code) => {
      job.finishedAt = new Date()
      if (code === 0) {
        job.status = 'success'
        job.logs.push(`[${new Date().toISOString()}] Upgrade concluído com sucesso (exit=0)`)
      } else if (code === 10) {
        job.status = 'rolled_back'
        job.logs.push(`[${new Date().toISOString()}] Upgrade falhou no health check. Rollback executado (exit=10)`)
      } else {
        job.status = 'failed'
        job.error = `Exit code ${code}`
        job.logs.push(`[${new Date().toISOString()}] Upgrade falhou (exit=${code})`)
      }
      _lastJob = job
      _activeJob = null
      resolve()
    })

    child.on('error', (err) => {
      job.status = 'failed'
      job.error = err.message
      job.finishedAt = new Date()
      _lastJob = job
      _activeJob = null
      resolve()
    })
  })
}
