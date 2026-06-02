import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface UtmLink {
  id: number
  name: string
  baseUrl: string
  utmSource: string
  utmMedium: string
  utmCampaign: string
  utmTerm: string | null
  utmContent: string | null
  utmId: string | null
  fullUrl: string
  notes: string | null
  tags: string[] | null
  active: boolean
  archived: boolean
  createdById: number | null
  createdAt: string
  updatedAt: string
}

export interface UtmInput {
  name: string
  baseUrl: string
  utmSource: string
  utmMedium: string
  utmCampaign: string
  utmTerm?: string | null
  utmContent?: string | null
  utmId?: string | null
  notes?: string | null
  tags?: string[] | null
  active?: boolean
  archived?: boolean
}

export interface UtmsFilters {
  search?: string
  archived?: boolean
  active?: boolean
}

function buildQs(f: UtmsFilters): string {
  const p = new URLSearchParams()
  if (f.search) p.set('search', f.search)
  if (f.archived) p.set('archived', 'true')
  if (f.active) p.set('active', 'true')
  const s = p.toString()
  return s ? `?${s}` : ''
}

export function useUtms(filters: UtmsFilters = {}) {
  return useQuery({
    queryKey: ['utms', filters],
    queryFn: () => api.get<{ data: UtmLink[]; total: number }>(`/admin/utms${buildQs(filters)}`),
    staleTime: 30_000,
  })
}

export function useUtmSuggestions() {
  return useQuery({
    queryKey: ['utm-suggestions'],
    queryFn: () => api.get<{ sources: string[]; mediums: string[]; campaigns: string[] }>('/admin/utms/suggestions'),
    staleTime: 5 * 60_000,
  })
}

export function useCreateUtm() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: UtmInput) => api.post<{ data: UtmLink }>('/admin/utms', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['utms'] })
      void qc.invalidateQueries({ queryKey: ['utm-suggestions'] })
    },
  })
}

export function useUpdateUtm() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: UtmInput & { id: number }) =>
      api.put<{ data: UtmLink }>(`/admin/utms/${id}`, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['utms'] })
      void qc.invalidateQueries({ queryKey: ['utm-suggestions'] })
    },
  })
}

export function useArchiveUtm() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, archived }: { id: number; archived: boolean }) =>
      api.patch<{ data: UtmLink }>(`/admin/utms/${id}/archive`, { archived }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['utms'] }),
  })
}

export function useDeleteUtm() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<{ ok: true }>(`/admin/utms/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['utms'] }),
  })
}
