// src/services/waCallRecording.ts
//
// Persiste a gravação de áudio de uma chamada WhatsApp (WebRTC). O áudio é gravado
// no navegador do operador (MediaRecorder mixando microfone + áudio remoto) e enviado
// ao encerrar. Aqui salvamos o arquivo, vinculamos uma Activity tipo "call" à timeline
// do lead e registramos no histórico — espelhando o fluxo do FaleMais.

import { prisma } from '../lib/prisma.js'
import { logEvent } from './leadHistory.js'
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

function fileUrl(storagePath: string): string {
  const base = process.env.APP_URL || `http://localhost:${process.env.PORT || 3005}`
  return `${base}/uploads/${storagePath}`
}

function extFor(mime: string): string {
  if (mime.includes('ogg')) return 'ogg'
  if (mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac')) return 'm4a'
  if (mime.includes('wav')) return 'wav'
  return 'webm'
}

export interface SaveRecordingResult {
  ok: boolean
  url?: string
  reason?: string
}

export async function saveWaCallRecording(
  callId: string,
  buffer: Buffer,
  mimeType: string,
  user?: { userId?: number; name?: string; email?: string }
): Promise<SaveRecordingResult> {
  if (!buffer?.length) return { ok: false, reason: 'áudio vazio' }

  const call = await prisma.voipCall.findFirst({
    where: { provider: 'whatsapp', providerCallId: callId },
    orderBy: { id: 'desc' },
  })
  if (!call) return { ok: false, reason: 'chamada não encontrada' }

  // Salva o arquivo em uploads/voip-recordings/
  const dir = join(process.cwd(), '..', 'uploads', 'voip-recordings')
  await mkdir(dir, { recursive: true })
  const fileName = `wa-${call.id}-${Date.now()}.${extFor(mimeType)}`
  await writeFile(join(dir, fileName), buffer)
  const storagePath = `voip-recordings/${fileName}`
  const url = fileUrl(storagePath)

  const userName = user?.name || user?.email || call.userName || null
  const userId = user?.userId ?? call.userId ?? null

  // Garante a Activity tipo "call" na timeline do lead (cria se ainda não existe).
  let activityId = call.activityId
  if (!activityId && call.leadId) {
    const activity = await prisma.activity.create({
      data: {
        leadId: call.leadId,
        userId,
        userName,
        type: 'call',
        title: `Ligação WhatsApp ${call.direction === 'inbound' ? 'recebida de' : 'para'} ${call.phone}`,
        status: 'completed',
        scheduledAt: call.startedAt ?? new Date(),
        completedAt: new Date(),
        recipientPhone: call.phone,
        attachmentUrl: url,
        attachmentName: fileName,
        attachmentType: mimeType || 'audio/webm',
        metadata: {
          voipCallId: call.id,
          providerCallId: callId,
          direction: call.direction,
          durationSec: call.durationSec,
          recordingUrl: url,
          channel: 'whatsapp_calling',
        },
      },
    })
    activityId = activity.id
  } else if (activityId) {
    // Activity já existe → anexa a gravação.
    await prisma.activity.update({
      where: { id: activityId },
      data: {
        status: 'completed',
        completedAt: new Date(),
        attachmentUrl: url,
        attachmentName: fileName,
        attachmentType: mimeType || 'audio/webm',
        metadata: { voipCallId: call.id, providerCallId: callId, recordingUrl: url, channel: 'whatsapp_calling' },
      },
    }).catch(() => {})
  }

  await prisma.voipCall.update({
    where: { id: call.id },
    data: {
      recordingPath: storagePath,
      recordingUrl: url,
      recordingSyncedAt: new Date(),
      ...(activityId ? { activityId } : {}),
      ...(userId ? { userId } : {}),
      ...(userName ? { userName } : {}),
    },
  })

  if (call.leadId) {
    logEvent({
      leadId: call.leadId,
      type: 'call_recorded',
      category: 'communication',
      title: `Ligação WhatsApp ${call.direction === 'inbound' ? 'recebida' : 'realizada'} (gravada)`,
      description: call.durationSec != null ? `Duração: ${call.durationSec}s` : undefined,
      channel: 'whatsapp',
      source: 'whatsapp_calling',
      actorType: 'operator',
      userId: userId ?? undefined,
      userName: userName ?? undefined,
      metadata: { voipCallId: call.id, providerCallId: callId, recordingUrl: url },
    })
  }

  return { ok: true, url }
}
