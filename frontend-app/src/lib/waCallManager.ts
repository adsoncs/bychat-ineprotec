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
let remoteStream: MediaStream | null = null
let remoteAudio: HTMLAudioElement | null = null
// Dados da entrante enquanto "tocando" (antes do operador aceitar).
let pendingOffer: { callId: string; sdp: string; cloudApiConnectionId: number | null } | null = null
let initialized = false

// ─── Gravação (MediaRecorder mixando mic + áudio remoto) ──
let mediaRecorder: MediaRecorder | null = null
let recordedChunks: BlobPart[] = []
let recordAudioCtx: AudioContext | null = null

function pickRecMime(): string {
  const opts = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
  for (const m of opts) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(m)) return m
  }
  return ''
}

/** Inicia a gravação misturando microfone local + áudio remoto. Best-effort. */
async function startRecording() {
  if (mediaRecorder || !localStream || !remoteStream) return
  try {
    const Ctx: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext
    recordAudioCtx = new Ctx()
    // O AudioContext nasce 'suspended' pela política de autoplay → o destino de mixagem
    // fica MUDO e a gravação sai vazia (<1KB, descartada). resume() reativa — o clique em
    // Atender/Ligar dá a "sticky activation" que o navegador exige. Sem isso, nada é gravado.
    if (recordAudioCtx.state === 'suspended') { try { await recordAudioCtx.resume() } catch { /* ignore */ } }
    const dest = recordAudioCtx.createMediaStreamDestination()
    recordAudioCtx.createMediaStreamSource(localStream).connect(dest)
    recordAudioCtx.createMediaStreamSource(remoteStream).connect(dest)
    const mime = pickRecMime()
    recordedChunks = []
    mediaRecorder = mime ? new MediaRecorder(dest.stream, { mimeType: mime }) : new MediaRecorder(dest.stream)
    mediaRecorder.addEventListener('dataavailable', (e) => {
      if (e.data && e.data.size > 0) recordedChunks.push(e.data)
    })
    mediaRecorder.start(1000) // coleta em blocos de 1s (não perde áudio se cair)
  } catch {
    mediaRecorder = null
  }
}

/** Para a gravação e envia ao backend (vincula à Activity + histórico do lead). */
async function stopAndUploadRecording(callId: string | null) {
  const recorder = mediaRecorder
  mediaRecorder = null
  if (recorder && recorder.state !== 'inactive') {
    await new Promise<void>((resolve) => {
      recorder.addEventListener('stop', () => resolve(), { once: true })
      try { recorder.stop() } catch { resolve() }
    })
  }
  try { recordAudioCtx?.close() } catch { /* ignore */ }
  recordAudioCtx = null

  const chunks = recordedChunks
  recordedChunks = []
  // Diagnósticos: a gravação é best-effort, mas logamos o motivo de não subir — antes
  // falhava em silêncio (era impossível saber por que a Activity não aparecia).
  if (!callId) { console.warn('[wa-call] gravação não enviada: callId ausente'); return }
  if (chunks.length === 0) { console.warn('[wa-call] gravação não enviada: nenhum áudio capturado (AudioContext suspenso? microfone?)'); return }

  const type = (recorder?.mimeType || 'audio/webm').split(';')[0] || 'audio/webm'
  const blob = new Blob(chunks, { type })
  if (blob.size < 1024) { console.warn(`[wa-call] gravação descartada: vazia/curtíssima (${blob.size} bytes)`); return }

  try {
    const form = new FormData()
    form.append('file', blob, `wa-call.${type.includes('mp4') ? 'm4a' : 'webm'}`)
    await api.post(`/wa-calls/${encodeURIComponent(callId)}/recording`, form)
    console.info(`[wa-call] gravação enviada (${blob.size} bytes, call ${callId})`)
  } catch (e) {
    console.warn('[wa-call] falha ao enviar gravação:', e)
  }
}

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

// Erro de microfone com uma flag indicando bloqueio definitivo do site (precisa reset manual).
class MicError extends Error {
  blocked: boolean
  constructor(message: string, blocked = false) {
    super(message)
    this.blocked = blocked
  }
}

const MIC_BLOCKED_MSG =
  'Este site está bloqueado para o microfone. Vá em chrome://settings/content/microphone, '
  + 'remova "bychat.ia.br" da lista "Não tem permissão" (ícone de lixeira) — ou clique no cadeado '
  + 'da barra de endereço → Microfone → Permitir — recarregue a página e tente de novo.'

/** Estado atual da permissão de microfone (Permissions API), se disponível. */
async function micPermissionState(): Promise<PermissionState | 'unknown'> {
  try {
    const status = await navigator.permissions?.query({ name: 'microphone' as PermissionName })
    return status?.state ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

/** Captura o microfone, traduzindo os erros do getUserMedia para mensagens claras. */
async function getMicStream(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new MicError('Seu navegador não permite áudio aqui (use HTTPS e um navegador compatível).')
  }
  // IMPORTANTE: chamar getUserMedia DIRETO, sem nenhum await antes — qualquer await
  // (ex.: permissions.query) consome a "ativação por gesto" e o Chrome rejeita SEM
  // mostrar o pedido. O estado da permissão só é consultado DEPOIS, em caso de erro.
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
  } catch (e: any) {
    const name = e?.name || ''
    if (name === 'NotAllowedError' || name === 'SecurityError' || /permission|denied/i.test(e?.message || '')) {
      // Distingue "negou agora no prompt" (pode tentar de novo) de "site bloqueado" (precisa reset).
      const blocked = (await micPermissionState()) === 'denied'
      throw new MicError(blocked ? MIC_BLOCKED_MSG : 'Permissão de microfone negada. Clique em "Tentar novamente" e escolha Permitir.', blocked)
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      throw new MicError('Nenhum microfone encontrado neste dispositivo.')
    }
    if (name === 'NotReadableError' || name === 'TrackStartError') {
      throw new MicError('O microfone está em uso por outro app. Feche-o e tente de novo.')
    }
    throw new MicError('Não foi possível acessar o microfone: ' + (e?.message || name || 'erro desconhecido'))
  }
}

async function createPeer(stream: MediaStream): Promise<RTCPeerConnection> {
  const iceServers = await fetchIceServers()
  const peer = new RTCPeerConnection({ iceServers })

  localStream = stream
  for (const track of stream.getTracks()) peer.addTrack(track, stream)

  peer.addEventListener('track', (ev) => {
    const [stream] = ev.streams
    if (stream) {
      remoteStream = stream
      ensureRemoteAudio().srcObject = stream
      void startRecording() // grava assim que há os dois lados de áudio
    }
  })

  peer.addEventListener('connectionstatechange', () => {
    if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') {
      cleanup('ended')
    }
  })

  return peer
}

function cleanup(finalStatus: WaCallState['status'] = 'ended') {
  // Para e envia a gravação (best-effort) ANTES de derrubar os streams — o stop()
  // dispara o flush do último bloco; o upload roda em background.
  const recCallId = store().call?.callId || null
  void stopAndUploadRecording(recCallId)

  try { pc?.getSenders().forEach((s) => s.track?.stop()) } catch { /* ignore */ }
  try { localStream?.getTracks().forEach((t) => t.stop()) } catch { /* ignore */ }
  try { pc?.close() } catch { /* ignore */ }
  pc = null
  localStream = null
  remoteStream = null
  pendingOffer = null
  outboundParams = null
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

// Parâmetros da chamada de saída em curso — usados para retomar após conceder o microfone.
let outboundParams: { to: string; connId: number | null } | null = null

/**
 * Pede o microfone e prossegue a chamada (entrante ou saída). Se a permissão for
 * negada, deixa a chamada no estado 'permission_denied' (com botão "Tentar novamente"),
 * sem derrubar o fluxo. Ao conceder, segue automaticamente.
 */
async function proceedCall(): Promise<{ ok: boolean; error?: string }> {
  const call = store().call
  if (!call) return { ok: false }

  // 1) Solicita o microfone (mostra "Permitindo microfone…" durante o prompt nativo).
  store().patch({ status: 'requesting_permission', error: '' })
  let stream: MediaStream
  try {
    stream = await getMicStream()
  } catch (e: any) {
    store().patch({ status: 'permission_denied', error: e?.message || 'Microfone bloqueado' })
    return { ok: false, error: 'permission_denied' }
  }

  // 2) Mídia + sinalização.
  store().patch({ status: 'connecting', error: '' })
  try {
    pc = await createPeer(stream)

    if (call.direction === 'incoming') {
      if (!pendingOffer) throw new Error('Chamada não está mais disponível')
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
      return { ok: true }
    }

    // Saída
    const offer = await pc.createOffer({ offerToReceiveAudio: true })
    await pc.setLocalDescription(offer)
    await waitIceComplete(pc)
    const res = await api.post<{ ok: boolean; callId: string | null }>('/wa-calls/connect', {
      to: outboundParams?.to ?? call.from,
      sdpOffer: pc.localDescription?.sdp,
      ...(outboundParams?.connId ? { cloudApiConnectionId: outboundParams.connId } : {}),
    })
    if (!res.callId) throw new Error('Gateway não retornou callId')
    store().patch({ callId: res.callId })
    return { ok: true }
  } catch (e: any) {
    const msg = e?.message || 'Falha na chamada'
    cleanup('ended')
    useWaCall.getState().clear()
    return { ok: false, error: msg }
  }
}

/** Re-tenta após o operador conceder o microfone nas configurações do navegador. */
export async function retryPermission(): Promise<{ ok: boolean; error?: string }> {
  return proceedCall()
}

/** Cancela a chamada antes de conectar (ex.: a partir da tela de permissão). */
export function cancelCall(): void {
  cleanup('ended')
  useWaCall.getState().clear()
}

/** Operador aceita a chamada entrante. */
export async function acceptIncoming(): Promise<void> {
  const call = store().call
  if (!call || call.direction !== 'incoming' || !pendingOffer) return
  await proceedCall()
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

/**
 * Inicia uma chamada de saída para `to` (E.164 sem +). Requer permissão (opt-in).
 * `cloudApiConnectionId` é opcional — o backend cai para a única conexão ativa.
 * Retorna { ok:false, error:'no_permission' } quando falta o opt-in do cliente.
 */
export async function startOutbound(
  to: string,
  cloudApiConnectionId: number | null = null,
  leadId: number | null = null
): Promise<{ ok: boolean; error?: string }> {
  if (store().call) return { ok: false, error: 'Já existe uma chamada em andamento' }

  outboundParams = { to, connId: cloudApiConnectionId }
  store().setCall({
    callId: '',
    leadId,
    from: to,
    direction: 'outgoing',
    status: 'requesting_permission',
    cloudApiConnectionId,
    startedAt: null,
  })

  return proceedCall()
}

/** Pede ao cliente a permissão de chamada (opt-in). */
export async function requestCallPermission(
  to: string,
  cloudApiConnectionId: number | null = null
): Promise<{ ok: boolean; error?: string }> {
  try {
    await api.post('/wa-calls/request-permission', {
      to,
      ...(cloudApiConnectionId ? { cloudApiConnectionId } : {}),
    })
    return { ok: true }
  } catch (e: any) {
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
