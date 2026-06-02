import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface Persona {
  id: number
  name: string
  description: string | null
  ageRange: string | null
  genderHint: string | null
  location: string | null
  occupation: string | null
  income: string | null
  painPoints: string[] | null
  objections: string[] | null
  triggers: string[] | null
  channels: string[] | null
  voiceTone: string | null
  examplePhrases: string[] | null
  goals: string[] | null
  active: boolean
  isDefault: boolean
  createdById: number | null
  createdAt: string
  updatedAt: string
}

export interface PersonaInput {
  name: string
  description?: string | null
  ageRange?: string | null
  genderHint?: string | null
  location?: string | null
  occupation?: string | null
  income?: string | null
  painPoints?: string[] | null
  objections?: string[] | null
  triggers?: string[] | null
  channels?: string[] | null
  voiceTone?: string | null
  examplePhrases?: string[] | null
  goals?: string[] | null
  active?: boolean
  isDefault?: boolean
}

export function usePersonas(includeArchived = false) {
  return useQuery({
    queryKey: ['personas', includeArchived],
    queryFn: () => api.get<{ data: Persona[] }>(`/admin/personas${includeArchived ? '?archived=true' : ''}`),
    staleTime: 30_000,
  })
}

export function useDefaultPersona() {
  return useQuery({
    queryKey: ['personas-default'],
    queryFn: () => api.get<{ data: Persona | null; systemPrompt: string | null }>('/admin/personas/default'),
    staleTime: 60_000,
  })
}

export function useCreatePersona() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: PersonaInput) => api.post<{ data: Persona }>('/admin/personas', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['personas'] })
      void qc.invalidateQueries({ queryKey: ['personas-default'] })
    },
  })
}

export function useUpdatePersona() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: PersonaInput & { id: number }) =>
      api.put<{ data: Persona }>(`/admin/personas/${id}`, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['personas'] })
      void qc.invalidateQueries({ queryKey: ['personas-default'] })
    },
  })
}

export function useSetDefaultPersona() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.patch<{ data: Persona }>(`/admin/personas/${id}/default`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['personas'] })
      void qc.invalidateQueries({ queryKey: ['personas-default'] })
    },
  })
}

export function useArchivePersona() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, archived }: { id: number; archived: boolean }) =>
      api.patch<{ data: Persona }>(`/admin/personas/${id}/archive`, { archived }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['personas'] }),
  })
}

export function useDeletePersona() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<{ ok: true }>(`/admin/personas/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['personas'] }),
  })
}
