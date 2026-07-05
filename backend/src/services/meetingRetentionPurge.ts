// src/services/meetingRetentionPurge.ts
// F0.6 — Retenção / expurgo (LGPD, minimização — art. 15/16). Apaga as gravações
// de reunião em uploads/meeting-recordings/ mais antigas que o prazo configurado
// (Setting meetings.recording.retention_days, default 90 dias). Roda uma vez no
// boot e a cada 24h — mesmo padrão do startTrashPurgeScheduler (services/trash.ts).
//
// Observação: o expurgo dos REGISTROS no banco (transcrição/LeadAttachment/Activity)
// entra no F1, quando o modelo de dados de reunião existir. Aqui governamos os
// ARQUIVOS de gravação, que é o que já pode existir no diretório. A retenção é
// aplicada independentemente de a gravação estar ligada/desligada (se foi desligada,
// os arquivos antigos ainda devem ser expurgados).

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '../lib/prisma.js'

// Mesma convenção dos demais serviços (voipRecordingSync, leadAttachments):
// cwd do backend + ../uploads.
const RECORDINGS_DIR = join(process.cwd(), '..', 'uploads', 'meeting-recordings')
const DEFAULT_RETENTION_DAYS = 90

function unwrap(raw: unknown): string {
  if (raw === null || raw === undefined) return ''
  if (typeof raw === 'string') return raw.replace(/^"|"$/g, '').trim()
  return String(raw)
}

async function getRetentionDays(): Promise<number> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: 'meetings.recording.retention_days' } })
    const n = parseInt(unwrap(row?.value), 10)
    if (Number.isFinite(n) && n >= 1) return Math.min(n, 3650)
  } catch { /* usa o default */ }
  return DEFAULT_RETENTION_DAYS
}

export async function purgeExpiredMeetingRecordings(): Promise<{ removed: number; scanned: number }> {
  const retentionDays = await getRetentionDays()
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
  let removed = 0
  let scanned = 0

  let entries: string[]
  try {
    entries = await fs.readdir(RECORDINGS_DIR)
  } catch {
    // Diretório ainda não existe (módulo sem uso) — nada a fazer.
    return { removed: 0, scanned: 0 }
  }

  for (const name of entries) {
    const full = join(RECORDINGS_DIR, name)
    try {
      const st = await fs.stat(full)
      if (!st.isFile()) continue
      scanned++
      if (st.mtimeMs < cutoff) {
        await fs.unlink(full)
        removed++
      }
    } catch {
      /* arquivo problemático: ignora e segue */
    }
  }

  if (removed > 0) {
    console.log(`[MeetingRetention] expurgou ${removed}/${scanned} gravação(ões) além de ${retentionDays}d`)
  }
  return { removed, scanned }
}

let _timer: ReturnType<typeof setInterval> | null = null

export function startMeetingRetentionPurge(): void {
  if (_timer) return
  // Uma vez no boot, depois a cada 24h.
  purgeExpiredMeetingRecordings().catch(err => console.error('[MeetingRetention] erro:', err?.message || err))
  _timer = setInterval(() => {
    purgeExpiredMeetingRecordings().catch(err => console.error('[MeetingRetention] erro:', err?.message || err))
  }, 24 * 60 * 60 * 1000)
  if (typeof _timer.unref === 'function') _timer.unref()
  console.log('[MeetingRetention] scheduler de expurgo de gravações iniciado')
}
