import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type LeadColumnKey =
  | 'empresa'
  | 'nome'
  | 'whatsapp'
  | 'email'
  | 'segmento'
  | 'cidade'
  | 'status'
  | 'score'
  | 'aiScore'
  | 'tags'
  | 'funil'
  | 'origem'
  | 'data'
  | 'uid'
  | 'assignee'

export const LEAD_COLUMN_LABELS: Record<LeadColumnKey, string> = {
  empresa: 'Empresa',
  nome: 'Nome',
  whatsapp: 'WhatsApp',
  email: 'E-mail',
  segmento: 'Segmento',
  cidade: 'Cidade',
  status: 'Status',
  score: 'Score',
  aiScore: 'Score IA',
  tags: 'Tags',
  funil: 'Funil',
  origem: 'Origem',
  data: 'Criado',
  uid: 'ID',
  assignee: 'Responsável',
}

export const ALL_LEAD_COLUMNS: LeadColumnKey[] = [
  'empresa', 'nome', 'whatsapp', 'email', 'segmento', 'cidade',
  'status', 'score', 'aiScore', 'tags', 'funil', 'origem', 'data', 'uid',
  'assignee',
]

const DEFAULT_VISIBLE: LeadColumnKey[] = ['nome', 'status', 'aiScore', 'assignee', 'origem', 'data']

interface LeadsColumnsState {
  visible: LeadColumnKey[]
  setVisible: (cols: LeadColumnKey[]) => void
  toggle: (col: LeadColumnKey) => void
  reset: () => void
}

export const useLeadsColumnsStore = create<LeadsColumnsState>()(
  persist(
    (set, get) => ({
      visible: DEFAULT_VISIBLE,
      setVisible: (visible) => set({ visible }),
      toggle: (col) => {
        const cur = get().visible
        if (cur.includes(col)) set({ visible: cur.filter((x) => x !== col) })
        else set({ visible: [...cur, col] })
      },
      reset: () => set({ visible: DEFAULT_VISIBLE }),
    }),
    {
      name: 'bh:leads-columns',
      version: 2,
      migrate: (persistedState: any, version: number) => {
        if (version < 2 && persistedState?.visible) {
          return {
            ...persistedState,
            visible: persistedState.visible.filter((c: string) => c !== 'empresa' && c !== 'score'),
          }
        }
        return persistedState
      },
    },
  ),
)
