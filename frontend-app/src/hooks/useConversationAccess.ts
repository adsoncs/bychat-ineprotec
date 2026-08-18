import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import type { UserRole } from './useUsers'

/** Papéis que a matriz aceita. SUPERADMIN nunca é regido por ela. */
export type PapelDaMatriz = Exclude<UserRole, 'SUPERADMIN'>

export type TipoConversa = 'contact' | 'group'
export type SujeitoTipo = 'role' | 'user'

/** Coringa: qualquer canal, inclusive os que não são WhatsApp. */
export const CANAL_QUALQUER = '*'

export interface CanalDaMatriz {
  key: string
  label: string
  hint: string | null
  number: string | null
  color: string | null
  provider: 'any' | 'evolution' | 'cloud_api'
  /** false = este canal nunca vai ter conversa de grupo (Cloud API, toggle off). */
  recebeGrupos: boolean
}

export interface RegraDeAcesso {
  subjectType: SujeitoTipo
  subjectId: string
  channelKey: string
  kind: TipoConversa
  canView: boolean
  canCreate: boolean
  canEdit: boolean
  canDelete: boolean
}

export interface UsuarioDaMatriz {
  id: number
  name: string | null
  email: string
  role: UserRole
}

interface RespostaAcesso {
  canais: CanalDaMatriz[]
  papeis: PapelDaMatriz[]
  usuarios: UsuarioDaMatriz[]
  regras: RegraDeAcesso[]
  /** Quem já está sob a matriz — o resto segue o comportamento padrão. */
  configurados: { roles: string[]; users: number[] }
}

const CHAVE = ['conversation-access'] as const

export function useConversationAccess() {
  return useQuery({
    queryKey: CHAVE,
    queryFn: () => api.get<RespostaAcesso>('/admin/conversation-access'),
    staleTime: 30_000,
  })
}

export interface RegraParaSalvar {
  channelKey: string
  kind: TipoConversa
  canView: boolean
  canCreate: boolean
  canEdit: boolean
  canDelete: boolean
}

export function useSaveConversationAccess() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ subjectType, subjectId, rules }: {
      subjectType: SujeitoTipo
      subjectId: string
      rules: RegraParaSalvar[]
    }) =>
      api.put<{ ok: true; rules: number; configurado: boolean }>(
        `/admin/conversation-access/${subjectType}/${encodeURIComponent(subjectId)}`,
        { rules },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CHAVE })
      // A matriz muda o que a própria lista de conversas devolve.
      void qc.invalidateQueries({ queryKey: ['atendimento'] })
      void qc.invalidateQueries({ queryKey: ['unread-count'] })
    },
  })
}
