// src/lib/waCallManager.ts
//
// Gerencia a mídia WebRTC das chamadas de voz WhatsApp (Business Calling API).
// Sinalização: eventos wa_call:* chegam pelo WebSocket (onServerEvent); as respostas
// (SDP answer da entrante / offer da saída) vão por POST em /api/wa-calls/*.
//
// Fluxo não-trickle: a Meta troca um único par offer/answer, então esperamos o ICE
// gathering completar antes de mandar o SDP (waitIceComplete).

import { onServerEvent } from './realtime'
import { api } from './apiClient'
import { useWaCall, type WaCallState } from '@/stores/waCall'

interface IceResponse {
  iceServers: RTCIceServer[]
  ttl: number
  expiresAt: number
}

let pc: RTCPeerConnection | null = null
let localStream: MediaStream | null = null
let remoteAudio: HTMLAudioElement | null = null
// Dados da entrante enquanto "tocando" (antes do operador aceitar).
let pendingOffer: { callId: string; sdp: string; cloudApiConnectionId: number | null } | null = null
let initialized = false

function store() {
  return useWaCall.getState()
}

function ensureRemoteAudio(): HTMLAudioElement {
  if (!remoteAudio) {
    remoteAudio = document.createElement('audio')
    remoteAudio.autoplay = true
    remoteAudio.setAttribute('playsinline', 'true')
    remoteAudio.style.display = 'none'
    document.body.appendChild(remoteAudio)
  }
  return remoteAudio
}

async function fetchIceServers(): Promise<RTCIceServer[]> {
  try {
    const res = await api.get<IceResponse>('/wa-calls/ice')
    return res.iceServers || []
  } catch {
    // fallback: STUN público (sem TURN, só funciona em redes sem NAT simétrico)
    return [{ urls: 'stun:stun.l.google.com:19302' }]
  }
}

/** Espera o ICE gathering completar (ou timeout) — necessário no fluxo não-trickle. */
function waitIceComplete(peer: RTCPeerConnection, timeoutMs = 2500): Promise<void> {
  if (peer.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      peer.removeEventListener('icegatheringstatechange', check)
      resolve()
    }
    const check = () => {
      if (peer.iceGatheringState === 'complete') done()
    }
    peer.addEventListener('icegatheringstatechange', check)
    setTimeout(done, timeoutMs)
  })
}

async function createPeer(): Promise<RTCPeerConnection> {
  const iceServers = await fetchIceServers()
  const peer = new RTCPeerConnection({ iceServers })

  localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
  for (const track of localStream.getTracks()) peer.addTrack(track, localStream)

  peer.addEventListener('track', (ev) => {
    const [stream] = ev.streams
    if (stream) ensureRemoteAudio().srcObject = stream
  })

  peer.addEventListener('connectionstatechange', () => {
    if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') {
      cleanup('ended')
    }
  })

  return peer
}

function cleanup(finalStatus: WaCallState['status'] = 'ended') {
  try { pc?.getSenders().forEach((s) => s.track?.stop()) } catch { /* ignore */ }
  try { localStream?.getTracks().forEach((t) => t.stop()) } catch { /* ignore */ }
  try { pc?.close() } catch { /* ignore */ }
  pc = null
  localStream = null
  pendingOffer = null
  if (remoteAudio) remoteAudio.srcObject = null

  const cur = store().call
  if (cur) {
    store().patch({ status: finalStatus })
    // some o widget após um instante no estado terminal
    setTimeout(() => {
      const c = useWaCall.getState().call
      if (c && c.status === 'ended') useWaCall.getState().clear()
    }, 4000)
  }
}

// ─── Ações expostas ao widget ───────────────────────────

/** Operador aceita a chamada entrante: cria o peer e responde o SDP offer da Meta. */
export async function acceptIncoming(): Promise<void> {
  const call = store().call
  if (!call || call.direction !== 'incoming' || !pendingOffer) return
  store().patch({ status: 'connecting' })

  try {
    pc = await createPeer()
    await pc.setRemoteDescription({ type: 'offer', sdp: pendingOffer.sdp })
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    await waitIceComplete(pc)

    await api.post(`/wa-calls/${encodeURIComponent(call.callId)}/accept`, {
      sdpAnswer: pc.localDescription?.sdp,
      cloudApiConnectionId: pendingOffer.cloudApiConnectionId,
    })
    pendingOffer = null
    store().patch({ status: 'active', startedAt: Date.now() })
  } catch (e: any) {
    store().patch({ status: 'ended', error: e?.message || 'Falha ao atender' })
    cleanup('ended')
  }
}

/** Operador recusa a chamada entrante. */
export async function rejectIncoming(): Promise<void> {
  const call = store().call
  if (!call) return
  try {
    await api.post(`/wa-calls/${encodeURIComponent(call.callId)}/reject`, {
      cloudApiConnectionId: call.cloudApiConnectionId,
    })
  } catch { /* ignore */ }
  cleanup('ended')
}

/** Encerra a chamada ativa (qualquer sentido). */
export async function hangup(): Promise<void> {
  const call = store().call
  if (call?.callId) {
    try {
      await api.post(`/wa-calls/${encodeURIComponent(call.callId)}/terminate`, {
        cloudApiConnectionId: call.cloudApiConnectionId,
      })
    } catch { /* ignore */ }
  }
  cleanup('ended')
}

/** Inicia uma chamada de saída para `to` (E.164 sem +). Requer permissão (Fase 4). */
export async function startOutbound(
  to: string,
  cloudApiConnectionId: number,
  leadId: number | null = null
): Promise<{ ok: boolean; error?: string }> {
  if (store().call) return { ok: false, error: 'Já existe uma chamada em andamento' }

  store().setCall({
    callId: '',
    leadId,
    from: to,
    direction: 'outgoing',
    status: 'connecting',
    cloudApiConnectionId,
    startedAt: null,
  })

  try {
    pc = await createPeer()
    const offer = await pc.createOffer({ offerToReceiveAudio: true })
    await pc.setLocalDescription(offer)
    await waitIceComplete(pc)

    const res = await api.post<{ ok: boolean; callId: string | null }>('/wa-calls/connect', {
      to,
      sdpOffer: pc.localDescription?.sdp,
      cloudApiConnectionId,
    })
    if (!res.callId) throw new Error('Gateway não retornou callId')
    store().patch({ callId: res.callId })
    return { ok: true }
  } catch (e: any) {
    store().patch({ status: 'ended', error: e?.message || 'Falha ao ligar' })
    cleanup('ended')
    return { ok: false, error: e?.message }
  }
}

export function toggleMute(): void {
  const muted = !store().muted
  localStream?.getAudioTracks().forEach((t) => { t.enabled = !muted })
  store().setMuted(muted)
}

// ─── Sinalização (eventos do servidor) ──────────────────

/** Inicializa os listeners de chamada. Chamar 1x no shell. Retorna cleanup. */
export function initWaCallManager(): () => void {
  if (initialized) return () => {}
  initialized = true

  const off = onServerEvent((ev) => {
    const p = (ev.payload || {}) as any
    switch (ev.type) {
      case 'wa_call:incoming': {
        // Chamada entrante: guarda o offer e mostra "tocando".
        if (store().call) {
          // já em chamada → recusa automática
          void api.post(`/wa-calls/${encodeURIComponent(p.callId)}/reject`, {
            cloudApiConnectionId: p.cloudApiConnectionId ?? null,
          }).catch(() => {})
          return
        }
        pendingOffer = {
          callId: p.callId,
          sdp: p.sdpOffer || '',
          cloudApiConnectionId: p.cloudApiConnectionId ?? null,
        }
        store().setCall({
          callId: p.callId,
          leadId: p.leadId ?? null,
          from: p.from || '',
          direction: 'incoming',
          status: 'ringing',
          cloudApiConnectionId: p.cloudApiConnectionId ?? null,
          startedAt: null,
        })
        break
      }
      case 'wa_call:answer': {
        // Resposta SDP da nossa chamada de saída.
        const call = store().call
        if (call && pc && (!call.callId || call.callId === p.callId)) {
          pc.setRemoteDescription({ type: 'answer', sdp: p.sdpAnswer || '' })
            .then(() => store().patch({ status: 'active', startedAt: Date.now(), callId: p.callId || call.callId }))
            .catch((e) => { store().patch({ status: 'ended', error: e.message }); cleanup('ended') })
        }
        break
      }
      case 'wa_call:ended': {
        const call = store().call
        if (call && (!p.callId || call.callId === p.callId)) cleanup('ended')
        break
      }
      case 'wa_call:status': {
        const call = store().call
        if (call && call.callId === p.callId && p.status) {
          // status informativo; não mexe no fluxo de mídia
        }
        break
      }
    }
  })

  return () => { off(); initialized = false }
}
