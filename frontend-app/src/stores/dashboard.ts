import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** Quais widgets do Dashboard estão visíveis. Persistido por usuário no localStorage. */
export type DashboardWidget = 'kpis' | 'secondary' | 'chart' | 'funnels' | 'sources' | 'recent'

export const ALL_WIDGETS: { id: DashboardWidget; label: string }[] = [
  { id: 'kpis', label: 'KPIs principais' },
  { id: 'secondary', label: 'Atividades & visitantes' },
  { id: 'chart', label: 'Leads por dia (gráfico)' },
  { id: 'funnels', label: 'Funis' },
  { id: 'sources', label: 'Origens' },
  { id: 'recent', label: 'Leads recentes' },
]

interface DashboardState {
  visible: DashboardWidget[]
  setVisible: (w: DashboardWidget[]) => void
  toggle: (w: DashboardWidget) => void
  reset: () => void
}

const DEFAULT_VISIBLE: DashboardWidget[] = ['kpis', 'secondary', 'chart', 'funnels', 'sources', 'recent']

export const useDashboardStore = create<DashboardState>()(
  persist(
    (set, get) => ({
      visible: DEFAULT_VISIBLE,
      setVisible: (visible) => set({ visible }),
      toggle: (w) => {
        const cur = get().visible
        if (cur.includes(w)) set({ visible: cur.filter((x) => x !== w) })
        else set({ visible: [...cur, w] })
      },
      reset: () => set({ visible: DEFAULT_VISIBLE }),
    }),
    { name: 'bh:dashboard' },
  ),
)
