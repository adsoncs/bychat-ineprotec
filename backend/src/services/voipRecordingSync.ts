// src/services/voipRecordingSync.ts
// Sincronização do histórico de chamadas (CDR) + gravações via API de Gravações
// (PabxVirtual). Importa /ligacoes do período, casa lead por telefone (8 dígitos)
// e baixa a gravação individual de cada chamada. Pode rodar manualmente (rota) ou
// em loop (startVoipRecordingSync, gated por config.recordingsAutoSync).

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '../lib/prisma.js'
import { getVoipConfig, listLigacoes, downloadGravacao, normalizePhone, type LigacaoCDR } from '../lib/falemaisVoip.js'
import { findDuplicate } from './dedup.js'
import { captureException } from '../lib/observability.js'

function fileUrl(storagePath: string): string {
  const base = process.env.APP_URL || `http://localhost:${process.env.PORT || 3005}`
  return `${base}/uploads/${storagePath}`
}

function mapDisposition(raw: string): string {
  const s = (raw || '').toUpperCase().replace(/[\s_-]+/g, '')
  if (s === 'ANSWERED') return 'completed'
  if (s === 'NOANSWER') return 'no_answer'
  if (s === 'BUSY') return 'busy'
  if (s === 'FAILED' || s === 'CONGESTION') return 'failed'
  return 'completed'
}

// Escolhe o número externo do CDR (não o ramal interno tipo "saida-...").
function externalPhone(cdr: LigacaoCDR): string {
  for (const v of [cdr.dst, cdr.src]) {
    const digits = normalizePhone(String(v ?? ''))
    if (digits.length >= 8) return digits
  }
  return normalizePhone(String(cdr.dst ?? cdr.src ?? ''))
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export interface SyncResult {
  imported: number
  updated: number
  recordings: number
  matched: number
  total: number
  error?: string
}

// Janela máxima de /ligacoes é 10 dias.
export async function syncVoipRecordings(opts: { from?: string; to?: string } = {}): Promise<SyncResult> {
  const result: SyncResult = { imported: 0, updated: 0, recordings: 0, matched: 0, total: 0 }
  const cfg = await getVoipConfig()
  if (!cfg.gravacoesEmail || !cfg.gravacoesPassword) {
    result.error = 'Credenciais da API de Gravações não configuradas'
    return result
  }

  const to = opts.to || toDateStr(new Date())
  const from = opts.from || toDateStr(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)) // últimos 2 dias por padrão

  let cdrs: LigacaoCDR[]
  try {
    cdrs = await listLigacoes(from, to, cfg)
  } catch (e: any) {
    result.error = e?.message || 'Falha ao listar ligações'
    return result
  }
  result.total = cdrs.length

  for (const cdr of cdrs) {
    const uniqueid = cdr.uniqueid ? String(cdr.uniqueid) : ''
    if (!uniqueid) continue
    try {
      const phone = externalPhone(cdr)
      const status = mapDisposition(String(cdr.disposition ?? ''))
      const duration = cdr.duration != null ? parseInt(String(cdr.duration), 10) : null
      const startedAt = cdr.calldate ? new Date(String(cdr.calldate)) : new Date()

      const existing = await prisma.voipCall.findFirst({ where: { uniqueid } })

      // Match de lead por telefone (8 dígitos) — só busca se ainda não temos
      let leadId = existing?.leadId ?? null
      if (!leadId && phone) {
        const dup = await findDuplicate(phone, undefined)
        if (dup.lead) { leadId = dup.lead.id; result.matched++ }
      }

      let callId: number
      if (existing) {
        const upd = await prisma.voipCall.update({
          where: { id: existing.id },
          data: {
            leadId: leadId ?? existing.leadId,
            status,
            durationSec: Number.isFinite(duration as number) ? (duration as number) : existing.durationSec,
            raw: cdr as any,
          },
        })
        callId = upd.id
        result.updated++
      } else {
        const created = await prisma.voipCall.create({
          data: {
            leadId,
            phone: phone || 'desconhecido',
            direction: 'outbound',
            provider: 'falemais',
            uniqueid,
            status,
            startedAt,
            durationSec: Number.isFinite(duration as number) ? (duration as number) : null,
            source: 'bulk_sync',
            raw: cdr as any,
          },
        })
        callId = created.id
        result.imported++
      }

      // Baixa a gravação se ainda não temos (só p/ chamadas atendidas)
      const current = await prisma.voipCall.findUnique({ where: { id: callId } })
      if (current && !current.recordingUrl && status === 'completed') {
        const buf = await downloadGravacao(uniqueid, cfg)
        if (buf && buf.length) {
          const dir = join(process.cwd(), '..', 'uploads', 'voip-recordings')
          await fs.mkdir(dir, { recursive: true })
          const fileName = `bulk-${callId}-${Date.now()}.wav`
          await fs.writeFile(join(dir, fileName), buf)
          const storagePath = `voip-recordings/${fileName}`
          await prisma.voipCall.update({
            where: { id: callId },
            data: { recordingPath: storagePath, recordingUrl: fileUrl(storagePath), recordingSyncedAt: new Date() },
          })
          result.recordings++
        }
      }
    } catch (e: any) {
      captureException(e, { context: 'voipRecordingSync', uniqueid })
    }
  }

  return result
}

// ─── Loop opcional ──────────────────────────────────────────
let _timer: ReturnType<typeof setInterval> | null = null
let _lastRunAt = 0
let _running = false

export function startVoipRecordingSync(): void {
  if (_timer) return
  const TICK_MS = 60_000 // checa a cada minuto; respeita o intervalo configurado
  _timer = setInterval(async () => {
    if (_running) return
    try {
      const cfg = await getVoipConfig()
      if (!cfg.enabled || !cfg.recordingsAutoSync) return
      const intervalMs = Math.max(5, cfg.recordingsSyncIntervalMin) * 60_000
      if (Date.now() - _lastRunAt < intervalMs) return
      _running = true
      _lastRunAt = Date.now()
      const r = await syncVoipRecordings()
      if (r.error) console.warn('[VoIP sync] erro:', r.error)
      else console.log(`[VoIP sync] ${r.imported} novas, ${r.updated} atualizadas, ${r.recordings} gravações, ${r.matched} casadas`)
    } catch (e: any) {
      console.error('[VoIP sync] tick falhou:', e?.message)
    } finally {
      _running = false
    }
  }, TICK_MS)
  if (typeof _timer.unref === 'function') _timer.unref()
  console.log('[VoIP sync] loop de sincronização de gravações iniciado')
}
