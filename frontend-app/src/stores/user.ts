import { create } from 'zustand'

export type WorkStatus = 'available' | 'away' | 'busy' | 'offline'

export interface CurrentUser {
  id: string | number
  email: string
  name: string
  role: string
  /**
   * Dono do produto — quem administra a loja de apps.
   *
   * É atributo e não papel de propósito: o código compara `role ===
   * 'SUPERADMIN'` em dezenas de lugares sem hierarquia, e um papel novo faria
   * o dono ter MENOS acesso que o superadmin do cliente. Aqui ele só adiciona.
   */
  isOwner?: boolean
  avatarUrl?: string
  active?: boolean
  lastLoginAt?: string | null
  createdAt?: string | null
  workStatus?: WorkStatus
  workStatusUpdatedAt?: string | null
  capacity?: number
}

export interface UserState {
  user: CurrentUser | null
  setUser: (user: CurrentUser | null) => void
  clear: () => void
}

export const useUserStore = create<UserState>((set) => ({
  user: null,
  setUser: (user) => set({ user }),
  clear: () => set({ user: null }),
}))
