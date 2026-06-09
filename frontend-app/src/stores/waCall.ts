// Estado global da chamada de voz WhatsApp (WebRTC) — alimenta o WaCallWidget.
// Diferente de voipCall.ts (FaleMais click-to-call): aqui o áudio roda no navegador.
import { create } from 'zustand'

export type WaCallStatus =
  | 'ringing'
  | 'requesting_permission'
  | 'permission_denied'
  | 'connecting'
  | 'active'
  | 'ended'
export type WaCallDirection = 'incoming' | 'outgoing'

export interface WaCallState {
  callId: string
  leadId: number | null
  from: string
  direction: WaCallDirection
  status: WaCallStatus
  cloudApiConnectionId: number | null
  startedAt: number | null
  error?: string
}

interface WaCallStore {
  call: WaCallState | null
  muted: boolean
  setCall: (call: WaCallState | null) => void
  patch: (partial: Partial<WaCallState>) => void
  setMuted: (muted: boolean) => void
  clear: () => void
}

export const useWaCall = create<WaCallStore>((set) => ({
  call: null,
  muted: false,
  setCall: (call) => set({ call }),
  patch: (partial) =>
    set((s) => (s.call ? { call: { ...s.call, ...partial } } : s)),
  setMuted: (muted) => set({ muted }),
  clear: () => set({ call: null, muted: false }),
}))
