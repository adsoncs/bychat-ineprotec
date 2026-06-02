import { create } from 'zustand'

export type WorkStatus = 'available' | 'away' | 'busy' | 'offline'

export interface CurrentUser {
  id: string | number
  email: string
  name: string
  role: string
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
