import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface FunnelListItem {
  id: number
  name: string
  description: string | null
  isDefault: boolean
  active: boolean
  createdAt: string
  _count: { stages: number; leads: number; chatbots: number }
}

export interface FunnelInput {
  name: string
  description?: string | null | undefined
  active?: boolean | undefined
}

export function useFunnels() {
  return useQuery({
    queryKey: ['funnels'],
    queryFn: () => api.get<{ funnels: FunnelListItem[] }>('/admin/funnels'),
    staleTime: 60_000,
  })
}

export interface FunnelStage {
  id: number
  funnelId: number
  key: string
  name: string
  color: string | null
  position: number
  active: boolean
  consumesSlot: boolean
  /** Etapa de desfecho: entrar nela marca o lead como Ganho/Perdido. */
  terminalKind: 'won' | 'lost' | null
}

export interface FunnelDetail extends FunnelListItem {
  stages: FunnelStage[]
  chatbots?: { id: number; name: string; channel: string }[]
}

export interface StageInput {
  key: string
  name: string
  color: string
  consumesSlot?: boolean | undefined
  active?: boolean | undefined
  /** '' limpa a marcação; ausente não mexe. */
  terminalKind?: 'won' | 'lost' | '' | undefined
}

export function useFunnel(id: number | null | undefined) {
  return useQuery({
    queryKey: ['funnel', id],
    queryFn: () => api.get<FunnelDetail>(`/admin/funnels/${id}`),
    enabled: !!id,
    staleTime: 60_000,
  })
}

export function useStages(funnelId?: number | null) {
  return useQuery({
    queryKey: ['stages', funnelId ?? 'default'],
    queryFn: () =>
      api.get<{ stages: FunnelStage[] }>(
        funnelId ? `/admin/stages?funnelId=${funnelId}` : '/admin/stages',
      ),
    staleTime: 60_000,
  })
}

export function useCreateFunnel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: FunnelInput & { copyFromId?: number }) =>
      api.post<FunnelListItem>('/admin/funnels', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['funnels'] }),
  })
}

export function useUpdateFunnel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: { id: number } & Partial<FunnelInput>) =>
      api.put<FunnelListItem>(`/admin/funnels/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['funnels'] }),
  })
}

export function useDeleteFunnel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/admin/funnels/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['funnels'] }),
  })
}

/**
 * Elege o funil padrão — destino de todo lead que entra sem funil definido
 * (webhook, criação manual, importação, portais) e fallback do Kanban.
 * Invalida também ['kanban'] e ['leads'], que exibem/derivam do padrão.
 */
export function useSetDefaultFunnel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      api.patch<{ ok: true; changed: boolean; previous: { id: number; name: string } | null }>(
        `/admin/funnels/${id}/default`,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['funnels'] })
      void qc.invalidateQueries({ queryKey: ['funnel'] })
      void qc.invalidateQueries({ queryKey: ['kanban'] })
    },
  })
}

// ─── Stages ────────────────────────────────────────────────

export function useCreateStage(funnelId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: StageInput) =>
      api.post<FunnelStage>(`/admin/funnels/${funnelId}/stages`, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['funnel', funnelId] })
      void qc.invalidateQueries({ queryKey: ['funnels'] })
    },
  })
}

export function useUpdateStage(funnelId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: { id: number } & Partial<StageInput> & { position?: number }) =>
      api.put<FunnelStage>(`/admin/stages/${id}`, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['funnel', funnelId] })
    },
  })
}

export function useDeleteStage(funnelId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<{ ok: true }>(`/admin/stages/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['funnel', funnelId] })
      void qc.invalidateQueries({ queryKey: ['funnels'] })
    },
  })
}

export function useReorderStages(funnelId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (order: { id: number; position: number }[]) =>
      api.put<{ ok: true }>('/admin/stages/reorder', { order }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['funnel', funnelId] })
    },
  })
}
