// src/services/voipCallService.ts
// Lógica do click-to-call e do polling de status/gravação da Sigma REST.
// O worker wf-voip-poll (services/workers.ts) chama pollCall(); a Sigma não tem
// webhook de status, então re-enfileiramos o poll até a chamada terminar.

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '../lib/prisma.js'
import { queues } from '../lib/queues.js'
import {
  getVoipConfig,
  dial,
  dialCallerId,
  getAudioInfo,
  downloadRecording,
  normalizePhone,
  type VoipConfig,
} from '../lib/falemaisVoip.js'

const POLL_DELAY_MS = 6_000
const MAX_POLLS = 60 // ~6 min de janela de polling
// Após a chamada atender, a gravação pode levar alguns segundos para ficar
// disponível na FaleMais. Re-tentamos o download nessa cadência até conseguir.
const REC_RETRY_DELAY_MS = 15_000
const MAX_REC_RETRIES = 20 // ~5 min tentando baixar a gravação

// Extrai a URL pronta da gravação do CDR (campo `gravacao` de audio/info).
function recordingUrlFromRaw(raw: unknown): string | undefined {
  const g = raw && typeof raw === 'object' ? (raw as { gravacao?: unknown }).gravacao : undefined
  return typeof g === 'string' && /^https?:\/\//i.test(g) ? g : undefined
}

function fileUrl(storagePath: string): string {
  const base = process.env.APP_URL || `http://localhost:${process.env.PORT || 3005}`
  return `${base}/uploads/${storagePath}`
}

// Mapeia o status textual do CDR (audio/info) para o status interno do VoipCall.
function mapStatus(raw: string): { status: string; terminal: boolean } {
  const s = (raw || '').toUpperCase().replace(/[\s_-]+/g, '')
  if (s === 'ANSWERED') return { status: 'completed', terminal: true }
  if (s === 'NOANSWER') return { status: 'no_answer', terminal: true }
  if (s === 'BUSY') return { status: 'busy', terminal: true }
  if (s === 'FAILED' || s === 'CONGESTION') return { status: 'failed', terminal: true }
  // status desconhecido mas presente → trata como concluída (há CDR)
  return { status: 'completed', terminal: true }
}

export interface CreateCallInput {
  leadId?: number | null
  phone: string
  userId?: number | null
  userName?: string | null
  extension: string
  callerId?: string | null
}

// FaleMaisVoip disca no formato NACIONAL (DDD + número = 10-11 díg). Os leads são
// salvos com o código do país (55 + DDD + número = 12-13 díg), então removemos o 55
// antes de discar. Só remove quando começa com 55 e tem 12-13 dígitos (não mexe em
// números já locais nem em internacionais de outro tamanho).
function toLocalBrNumber(digits: string): string {
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) return digits.slice(2)
  return digits
}

// Origina a chamada (click-to-call) e registra VoipCall (+ Activity se houver lead).
export async function createClickToCall(input: CreateCallInput): Promise<{ ok: boolean; call?: any; error?: string }> {
  const cfg = await getVoipConfig()
  if (!cfg.enabled) return { ok: false, error: 'Módulo VoIP desativado' }

  const phone = toLocalBrNumber(normalizePhone(input.phone))
  if (phone.length < 8 || phone.length > 11) return { ok: false, error: 'Telefone inválido (8 a 11 dígitos)' }
  if (!input.extension) return { ok: false, error: 'Operador sem ramal configurado' }

  const callerId = input.callerId ? toLocalBrNumber(normalizePhone(input.callerId)) : toLocalBrNumber(cfg.sigmaDefaultCallerId || '')

  let dialRes
  try {
    dialRes = callerId
      ? await dialCallerId(input.extension, phone, callerId, cfg)
      : await dial(input.extension, phone, cfg)
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Falha ao originar a chamada' }
  }

  if (!dialRes.ok || !dialRes.id) {
    return { ok: false, error: dialRes.cause || 'Não foi possível originar a chamada' }
  }

  const call = await prisma.voipCall.create({
    data: {
      leadId: input.leadId ?? null,
      userId: input.userId ?? null,
      userName: input.userName ?? null,
      extension: input.extension,
      phone,
      callerId: callerId || null,
      direction: 'outbound',
      provider: 'falemais',
      providerCallId: dialRes.id,
      status: 'dialing',
      source: 'click_to_call',
    },
  })

  // Activity tipo "call" para aparecer na timeline do lead (leadId é obrigatório no model)
  if (input.leadId) {
    const activity = await prisma.activity.create({
      data: {
        leadId: input.leadId,
        userId: input.userId ?? null,
        userName: input.userName ?? null,
        type: 'call',
        title: `Ligação para ${phone}`,
        status: 'pending',
        scheduledAt: new Date(),
        recipientPhone: phone,
        metadata: { voipCallId: call.id, providerCallId: dialRes.id, direction: 'outbound' },
      },
    })
    await prisma.voipCall.update({ where: { id: call.id }, data: { activityId: activity.id } })
  }

  await startCallPolling(call.id)
  return { ok: true, call }
}

export async function startCallPolling(callId: number): Promise<void> {
  await queues.voipPoll.add(
    'poll',
    { callId, attempt: 0 },
    { delay: POLL_DELAY_MS, removeOnComplete: 200, removeOnFail: 100 },
  )
}

// Executado pelo worker. Consulta o CDR; finaliza ou re-enfileira. Quando a chamada
// foi atendida mas a gravação ainda não está disponível, re-enfileira só para baixá-la.
export async function pollCall(callId: number, attempt: number): Promise<{ done: boolean; status?: string }> {
  const call = await prisma.voipCall.findUnique({ where: { id: callId } })
  if (!call || !call.providerCallId) return { done: true }

  const cfg = await getVoipConfig()

  // Já finalizada: a única pendência possível é a gravação de uma chamada atendida.
  if (['completed', 'no_answer', 'busy', 'failed'].includes(call.status)) {
    if (call.status === 'completed' && !call.recordingPath) {
      const ok = await downloadRecordingForCall(call.id, call.providerCallId, cfg, recordingUrlFromRaw(call.raw)).catch(() => false)
      if (!ok && attempt + 1 <= MAX_REC_RETRIES) {
        await queues.voipPoll.add('poll', { callId, attempt: attempt + 1 }, { delay: REC_RETRY_DELAY_MS, removeOnComplete: 200, removeOnFail: 100 })
        return { done: false, status: call.status }
      }
    }
    return { done: true, status: call.status }
  }

  let info = null
  try {
    info = await getAudioInfo(call.providerCallId, cfg)
  } catch {
    info = null
  }

  if (!info) {
    // ainda em curso (sem CDR) — re-enfileira ou desiste após o limite
    if (attempt + 1 >= MAX_POLLS) {
      await finalize(call.id, 'no_answer', null, null, cfg)
      return { done: true, status: 'no_answer' }
    }
    await queues.voipPoll.add('poll', { callId, attempt: attempt + 1 }, { delay: POLL_DELAY_MS, removeOnComplete: 200, removeOnFail: 100 })
    return { done: false }
  }

  const { status } = mapStatus(info.status)
  const duration = info.duration ? parseInt(String(info.duration), 10) : null
  const downloaded = await finalize(call.id, status, Number.isFinite(duration as number) ? (duration as number) : null, info.raw, cfg)
  // Atendida mas gravação ainda não pronta → re-enfileira só para o download.
  if (status === 'completed' && !downloaded) {
    await queues.voipPoll.add('poll', { callId, attempt: 0 }, { delay: REC_RETRY_DELAY_MS, removeOnComplete: 200, removeOnFail: 100 })
    return { done: false, status }
  }
  return { done: true, status }
}

// Persiste o status/CDR e tenta baixar a gravação. Retorna true se já tem gravação
// (ou se não há o que baixar); false se a chamada foi atendida mas a gravação ainda
// não veio (o chamador re-enfileira o download).
async function finalize(callId: number, status: string, durationSec: number | null, raw: any, cfg: VoipConfig): Promise<boolean> {
  const answered = status === 'completed'
  const call = await prisma.voipCall.update({
    where: { id: callId },
    data: {
      status,
      durationSec: durationSec ?? undefined,
      answeredAt: answered ? new Date() : undefined,
      raw: raw ?? undefined,
    },
  })

  // Atualiza a Activity vinculada
  if (call.activityId) {
    const label = status === 'completed' ? 'atendida' : status === 'no_answer' ? 'não atendida' : status === 'busy' ? 'ocupado' : 'falhou'
    await prisma.activity.update({
      where: { id: call.activityId },
      data: {
        status: 'completed',
        completedAt: new Date(),
        description: `Ligação ${label}${durationSec ? ` · ${durationSec}s` : ''}`,
      },
    }).catch(() => {})
  }

  // Baixa a gravação quando a chamada foi atendida (usa a URL pronta do CDR)
  if (answered && call.providerCallId) {
    return await downloadRecordingForCall(call.id, call.providerCallId, cfg, recordingUrlFromRaw(raw)).catch(() => false)
  }
  return true // não-atendida: não há gravação a baixar
}

// Baixa o wav e persiste em uploads/voip-recordings/. Aceita a URL pronta do CDR
// (campo `gravacao`); na falta dela, usa o providerCallId p/ montar a URL canônica.
export async function downloadRecordingForCall(callId: number, providerCallId: string, cfg?: VoipConfig, recordingUrl?: string): Promise<boolean> {
  const c = cfg || (await getVoipConfig())
  const buf = await downloadRecording(recordingUrl || providerCallId, c)
  if (!buf || !buf.length) return false

  const dir = join(process.cwd(), '..', 'uploads', 'voip-recordings')
  await fs.mkdir(dir, { recursive: true })
  const fileName = `${callId}-${Date.now()}.wav`
  await fs.writeFile(join(dir, fileName), buf)
  const storagePath = `voip-recordings/${fileName}`

  const call = await prisma.voipCall.update({
    where: { id: callId },
    data: { recordingPath: storagePath, recordingUrl: fileUrl(storagePath), recordingSyncedAt: new Date() },
  })

  // Anexa a gravação à Activity (campos legados de 1 arquivo) p/ aparecer na timeline
  if (call.activityId) {
    await prisma.activity.update({
      where: { id: call.activityId },
      data: {
        attachmentUrl: call.recordingUrl,
        attachmentName: fileName,
        attachmentType: 'audio/wav',
        metadata: { voipCallId: call.id, providerCallId, recordingUrl: call.recordingUrl },
      },
    }).catch(() => {})
  }
  return true
}
