import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const MAX_RECENTS = 5

export interface RecentsState {
  ids: string[]
  push: (id: string) => void
  clear: () => void
}

export const useRecentsStore = create<RecentsState>()(
  persist(
    (set) => ({
      ids: [],
      push: (id) =>
        set((s) => {
          const next = [id, ...s.ids.filter((x) => x !== id)].slice(0, MAX_RECENTS)
          return { ids: next }
        }),
      clear: () => set({ ids: [] }),
    }),
    { name: 'bh:recents' },
  ),
)
