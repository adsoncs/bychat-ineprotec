import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface MessageTemplateItem {
  id: number
  name: string
  channel: string
  category: string | null
  subject: string | null
  body: string
  bodyHtml: string | null
  active: boolean
  usageCount: number
  createdAt: string
  updatedAt: string
}

export interface TemplateInput {
  name: string
  channel: string
  category?: string | undefined
  subject?: string | null | undefined
  body: string
  bodyHtml?: string | null | undefined
  active?: boolean | undefined
}

export interface TemplateVariable {
  key: string
  label: string
  example: string
}

export interface TemplatesFilters {
  channel?: string | undefined
  category?: string | undefined
}

function buildQuery(f: TemplatesFilters): string {
  const p = new URLSearchParams()
  if (f.channel) p.set('channel', f.channel)
  if (f.category) p.set('category', f.category)
  const qs = p.toString()
  return qs ? `?${qs}` : ''
}

export function useTemplates(filters: TemplatesFilters = {}) {
  return useQuery({
    queryKey: ['templates', filters],
    queryFn: () => api.get<{ templates: MessageTemplateItem[] }>(`/templates${buildQuery(filters)}`),
    staleTime: 60_000,
  })
}

export function useTemplateVariables() {
  return useQuery({
    queryKey: ['templates', 'variables'],
    queryFn: () => api.get<{ variables: TemplateVariable[] }>('/templates/variables'),
    staleTime: 5 * 60_000,
  })
}

export function useCreateTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: TemplateInput) => api.post<{ ok: true; template: MessageTemplateItem }>('/templates', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  })
}

export function useUpdateTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: { id: number } & Partial<TemplateInput>) =>
      api.put<{ ok: true; template: MessageTemplateItem }>(`/templates/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  })
}

export function useDeleteTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/templates/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  })
}
