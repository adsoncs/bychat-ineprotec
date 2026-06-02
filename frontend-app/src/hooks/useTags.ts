import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface Tag {
  id: number
  name: string
  color: string
  description: string | null
  position: number
  active: boolean
  createdAt: string
  updatedAt: string
  _count?: { leads: number }
}

export interface TagInput {
  name: string
  color: string
  description?: string | null | undefined
  active?: boolean | undefined
}

export function useTags(includeInactive = false) {
  return useQuery({
    queryKey: ['tags', includeInactive ? 'all' : 'active'],
    queryFn: () => api.get<{ tags: Tag[] }>(includeInactive ? '/tags/all' : '/tags'),
    staleTime: 60_000,
  })
}

export function useCreateTag() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: TagInput) => api.post<{ ok: true; tag: Tag }>('/tags', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tags'] }),
  })
}

export function useUpdateTag() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: { id: number } & Partial<TagInput>) =>
      api.put<{ ok: true; tag: Tag }>(`/tags/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tags'] }),
  })
}

export function useDeleteTag() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/tags/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tags'] }),
  })
}

export function useReorderTags() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (items: { id: number; position: number }[]) =>
      api.put<{ ok: true }>('/tags/reorder', { items }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tags'] }),
  })
}
