import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export type FilterVisibility = 'public' | 'private'

export interface SavedFilter {
  id: number
  scope: string
  name: string
  filters: Record<string, unknown>
  visibility: FilterVisibility
  createdById: number
  createdByName: string | null
  createdAt: string
  updatedAt: string
}

export interface AppliedFilterResponse {
  filters: Record<string, unknown> | null
  updatedAt: string | null
}

// ── Saved filters (catálogo nomeado) ─────────────────────

export function useSavedFilters(scope: string) {
  return useQuery({
    queryKey: ['saved-filters', scope],
    queryFn: () => api.get<{ filters: SavedFilter[] }>(`/saved-filters?scope=${encodeURIComponent(scope)}`),
    enabled: !!scope,
    staleTime: 30_000,
  })
}

export function useCreateSavedFilter() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { scope: string; name: string; filters: Record<string, unknown>; visibility: FilterVisibility }) =>
      api.post<{ filter: SavedFilter }>('/saved-filters', input),
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: ['saved-filters', vars.scope] })
    },
  })
}

export function useUpdateSavedFilter() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: number; scope: string; name?: string; filters?: Record<string, unknown>; visibility?: FilterVisibility }) =>
      api.put<{ filter: SavedFilter }>(`/saved-filters/${id}`, patch),
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: ['saved-filters', vars.scope] })
    },
  })
}

export function useDeleteSavedFilter() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id }: { id: number; scope: string }) =>
      api.delete<{ ok: true }>(`/saved-filters/${id}`),
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: ['saved-filters', vars.scope] })
    },
  })
}

// ── Applied filter (estado corrente por usuário+scope) ───

/** Filtro CORRENTE do usuário num scope — fica fixo entre logins. */
export function useAppliedFilter(scope: string) {
  return useQuery({
    queryKey: ['applied-filter', scope],
    queryFn: () => api.get<AppliedFilterResponse>(`/applied-filter?scope=${encodeURIComponent(scope)}`),
    enabled: !!scope,
    staleTime: 60_000,
  })
}

export function useSetAppliedFilter() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { scope: string; filters: Record<string, unknown> }) =>
      api.put<{ ok: true }>('/applied-filter', input),
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: ['applied-filter', vars.scope] })
    },
  })
}

export function useResetAppliedFilter() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ scope }: { scope: string }) =>
      api.delete<{ ok: true }>(`/applied-filter?scope=${encodeURIComponent(scope)}`),
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: ['applied-filter', vars.scope] })
    },
  })
}
