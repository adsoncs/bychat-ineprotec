import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const MAX_FAVORITES = 5

export interface FavoritesState {
  ids: string[]
  toggle: (id: string) => void
  isFavorite: (id: string) => boolean
}

export const useFavoritesStore = create<FavoritesState>()(
  persist(
    (set, get) => ({
      ids: [],
      isFavorite: (id) => get().ids.includes(id),
      toggle: (id) =>
        set((s) => {
          if (s.ids.includes(id)) {
            return { ids: s.ids.filter((x) => x !== id) }
          }
          if (s.ids.length >= MAX_FAVORITES) return s
          return { ids: [...s.ids, id] }
        }),
    }),
    { name: 'bh:favorites' },
  ),
)
