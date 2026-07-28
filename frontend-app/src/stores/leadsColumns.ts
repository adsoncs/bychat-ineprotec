import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** Colunas nativas do lead. Campos personalizados entram como `cf:<key>` —
 * ver `LeadColumnKey`. */
export type LeadFixedColumnKey =
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

/** Coluna da lista: nativa ou um campo personalizado (`cf:<key>`), que o
 * usuário liga em Configurações → Campos personalizados (showInList). */
export type LeadColumnKey = LeadFixedColumnKey | `cf:${string}`

export function isCustomColumn(col: LeadColumnKey): col is `cf:${string}` {
  return col.startsWith('cf:')
}

/** `cf:kommo_1308426` → `kommo_1308426` */
export function customColumnKey(col: LeadColumnKey): string {
  return col.slice(3)
}

export const LEAD_COLUMN_LABELS: Record<LeadFixedColumnKey, string> = {
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

export const ALL_LEAD_COLUMNS: LeadFixedColumnKey[] = [
  'empresa', 'nome', 'whatsapp', 'email', 'segmento', 'cidade',
  'status', 'score', 'aiScore', 'tags', 'funil', 'origem', 'data', 'uid',
  'assignee',
]

const DEFAULT_VISIBLE: LeadColumnKey[] = ['nome', 'status', 'aiScore', 'assignee', 'origem', 'data']

/** Rótulo da coluna: nativa vem do mapa fixo; `cf:` vem do CustomField (o
 * chamador passa o dicionário key→label vindo de useCustomFields). */
export function leadColumnLabel(col: LeadColumnKey, cfLabels?: Record<string, string>): string {
  if (isCustomColumn(col)) {
    const key = customColumnKey(col)
    return cfLabels?.[key] ?? key
  }
  return LEAD_COLUMN_LABELS[col]
}

interface LeadsColumnsState {
  visible: LeadColumnKey[]
  /** Campos personalizados já oferecidos como coluna — evita reinserir um campo
   * que o operador ocultou de propósito. */
  seenCustom: string[]
  setVisible: (cols: LeadColumnKey[]) => void
  toggle: (col: LeadColumnKey) => void
  reset: () => void
  /** Adota como coluna os campos marcados "mostrar na lista" que este operador
   * ainda não viu. Assim, ligar o toggle em Configurações basta para o campo
   * aparecer, sem cada um ter que abrir o seletor de colunas. */
  syncCustomColumns: (keys: string[]) => void
}

export const useLeadsColumnsStore = create<LeadsColumnsState>()(
  persist(
    (set, get) => ({
      visible: DEFAULT_VISIBLE,
      seenCustom: [],
      setVisible: (visible) => set({ visible }),
      toggle: (col) => {
        const cur = get().visible
        if (cur.includes(col)) set({ visible: cur.filter((x) => x !== col) })
        else set({ visible: [...cur, col] })
      },
      reset: () => set({ visible: DEFAULT_VISIBLE }),
      syncCustomColumns: (keys) => {
        const { visible } = get()
        // localStorage de versões anteriores não tem seenCustom.
        const seenCustom = get().seenCustom ?? []
        const novos = keys.filter((k) => !seenCustom.includes(k))
        if (novos.length === 0) return
        set({
          seenCustom: [...seenCustom, ...novos],
          visible: [...visible, ...novos.map((k) => `cf:${k}` as const).filter((c) => !visible.includes(c))],
        })
      },
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
