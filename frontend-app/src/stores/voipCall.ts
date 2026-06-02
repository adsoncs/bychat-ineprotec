// Estado global da "ligação ativa" — alimenta o widget flutuante de chamada.
// Guardamos só o id; o widget faz polling do status via /voip/calls/:id.
import { create } from 'zustand'

interface ActiveCallState {
  activeCallId: number | null
  startCall: (id: number) => void
  clear: () => void
}

export const useActiveCall = create<ActiveCallState>((set) => ({
  activeCallId: null,
  startCall: (id) => set({ activeCallId: id }),
  clear: () => set({ activeCallId: null }),
}))
