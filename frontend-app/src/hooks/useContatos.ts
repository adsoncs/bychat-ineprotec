// Módulo Contatos — quem já falou com a empresa e ainda não virou Lead.
//
// Não há entidade nova: contato e lead são o mesmo registro em estados
// diferentes. Por isso a promoção reaproveita os hooks de Leads
// (`useQualifyLead` / `useQualifyLeadsBulk`) em vez de ter os seus.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface Contato {
  id: number
  nome: string | null
  whatsapp: string | null
  email: string | null
  empresa: string | null
  source: string | null
  instanceName: string | null
  isGroup: boolean
  profilePicUrl: string | null
  /** Como o contato se identifica no WhatsApp dele. Só referência. */
  pushName: string | null
  nomeWhatsappAgenda: string | null
  unreadMessages: number
  lastMessageAt: string | null
  createdAt: string
  assignedUserId: number | null
  assignedUser: { id: number; name: string } | null
  teamId: number | null
  team: { id: number; name: string; color: string | null } | null
  conversationOpenedAt: string | null
  conversationClosedAt: string | null
  tags: Array<{ id: number; name: string; color: string | null }>
}

export interface ContatosFilters {
  search?: string | undefined
  canal?: string | undefined
  origem?: string | undefined
  /** `excluir` (padrão) · `incluir` · `apenas` — grupos de WhatsApp. */
  grupos?: 'excluir' | 'incluir' | 'apenas' | undefined
  /** Só quem a empresa já respondeu. */
  respondeu?: boolean | undefined
  limit?: number | undefined
  offset?: number | undefined
}

function query(f: ContatosFilters): string {
  const p = new URLSearchParams()
  if (f.search) p.set('search', f.search)
  if (f.canal) p.set('canal', f.canal)
  if (f.origem) p.set('origem', f.origem)
  if (f.grupos) p.set('grupos', f.grupos)
  if (f.respondeu) p.set('respondeu', '1')
  if (f.limit != null) p.set('limit', String(f.limit))
  if (f.offset != null) p.set('offset', String(f.offset))
  const s = p.toString()
  return s ? `?${s}` : ''
}

export function useContatos(filters: ContatosFilters = {}) {
  return useQuery({
    queryKey: ['contatos', filters],
    queryFn: () => api.get<{ contatos: Contato[]; total: number }>(`/contatos${query(filters)}`),
    staleTime: 10_000,
    // Contato novo chega por mensagem, não por ação de quem está olhando a
    // tela: sem recarga a lista fica parada enquanto a fila cresce. Mesmo
    // ritmo do Conversas.
    refetchInterval: 15_000,
  })
}

export interface ResumoContatos {
  total: number
  grupos: number
  respondeu: number
  semResposta: number
}

/**
 * Contadores do topo. Existe para o acúmulo deixar de ser invisível.
 *
 * Recebe o MESMO recorte da lista: número de topo que não bate com o que está
 * na tela ensina o operador a desconfiar dos dois.
 */
export function useResumoContatos(filters: Pick<ContatosFilters, 'search' | 'canal' | 'origem'> = {}) {
  return useQuery({
    queryKey: ['contatos-resumo', filters],
    queryFn: () => api.get<ResumoContatos>(`/contatos/resumo${query(filters)}`),
    staleTime: 10_000,
    refetchInterval: 30_000,
  })
}

export interface CanalDeContato {
  instanceName: string
  label: string
  number: string | null
  contatos: number
}

export interface OrigemDeContato {
  source: string
  contatos: number
}

/**
 * As opções dos filtros: números e origens que de fato têm contato nesta lista
 * — e que este usuário pode ver. Um seletor que oferece uma linha reservada já
 * entrega a informação que a reserva esconde.
 */
export function useFiltrosDeContato() {
  return useQuery({
    queryKey: ['contatos-filtros'],
    queryFn: () => api.get<{ canais: CanalDeContato[]; origens: OrigemDeContato[] }>('/contatos/canais'),
    staleTime: 60_000,
  })
}

// ── Ações ──────────────────────────────────────────────────────────────
//
// Criar, editar e apagar têm rotas próprias no módulo Contatos (e não as de
// Leads) porque cada uma passa pela permissão de `contatos`: o administrador
// ajusta quem cria, quem edita e quem apaga sem mexer no acesso a Leads.

export interface NovoContatoInput {
  nome: string
  telefone: string
  email?: string
  empresa?: string
}

export function useCriarContato() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: NovoContatoInput) =>
      api.post<{ ok: true; contato: { id: number; nome: string; whatsapp: string } }>('/contatos', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['contatos'] })
      void qc.invalidateQueries({ queryKey: ['contatos-resumo'] })
    },
  })
}

export function useEditarContato() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...campos }: { id: number } & Partial<NovoContatoInput>) =>
      api.patch<{ ok: true; alterado: boolean; campos?: string[] }>(`/contatos/${id}`, campos),
    onSuccess: (_r, v) => {
      void qc.invalidateQueries({ queryKey: ['contatos'] })
      // O nome também aparece no cabeçalho da conversa e no painel do lead.
      void qc.invalidateQueries({ queryKey: ['ticket-info', v.id] })
      void qc.invalidateQueries({ queryKey: ['tickets'] })
    },
  })
}

export function useApagarContato() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<{ ok: true; mensagensApagadas: number }>(`/contatos/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['contatos'] })
      void qc.invalidateQueries({ queryKey: ['contatos-resumo'] })
      void qc.invalidateQueries({ queryKey: ['tickets'] })
    },
  })
}
