import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface CustomField {
  id: number
  key: string
  label: string
  type: string
  group: string
  required: boolean
  description?: string | null | undefined
  placeholder?: string | null
  defaultValue?: string | null
  options: unknown
  showInList?: boolean
  showInKanban?: boolean
  showInForm?: boolean
  /** Aparece (e é editável) no painel Informações da conversa. */
  showInConversation?: boolean
  position: number
  active: boolean
  createdAt: string
}

export interface CustomFieldInput {
  key: string
  label: string
  type: string
  group?: string | undefined
  required?: boolean | undefined
  description?: string | null | undefined
  placeholder?: string | null | undefined
  defaultValue?: string | null | undefined
  options?: unknown
  showInList?: boolean | undefined
  showInKanban?: boolean | undefined
  showInForm?: boolean | undefined
  showInConversation?: boolean | undefined
  active?: boolean | undefined
}

export function useCustomFields(includeInactive = false) {
  return useQuery({
    queryKey: ['custom-fields', includeInactive],
    queryFn: () => api.get<{ fields: CustomField[] }>(includeInactive ? '/custom-fields/all' : '/custom-fields'),
    staleTime: 60_000,
  })
}

/**
 * Grava os valores dos campos personalizados de UM lead (merge no servidor).
 * Usado pelo painel Informações da conversa, onde o atendente edita sem
 * abrir a ficha completa.
 */
export function useSaveLeadCustomFields(leadId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (valores: Record<string, unknown>) =>
      api.put<{ ok: true; customFields: Record<string, unknown> }>(`/leads/${leadId}/custom-fields`, valores),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ticket-info', leadId] })
      void qc.invalidateQueries({ queryKey: ['lead', leadId] })
    },
  })
}

export function useCreateCustomField() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CustomFieldInput) => api.post<{ field: CustomField }>('/custom-fields', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['custom-fields'] }),
  })
}

export function useUpdateCustomField() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: { id: number } & Partial<CustomFieldInput>) =>
      api.put<{ field: CustomField }>(`/custom-fields/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['custom-fields'] }),
  })
}

export function useDeleteCustomField() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/custom-fields/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['custom-fields'] }),
  })
}

export function useReorderCustomFields() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (items: { id: number; position: number }[]) =>
      api.put<{ ok: true }>('/custom-fields/reorder', { items }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['custom-fields'] }),
  })
}
