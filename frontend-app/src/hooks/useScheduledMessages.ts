import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface ScheduledMessageItem {
  id: number
  leadId: number
  scheduledAt: string
  status: 'pending' | 'sent' | 'canceled' | 'failed' | 'skipped'
  kind: 'text' | 'template_hsm'
  templateId: number | null
  body: string | null
  cancelIfReplied: boolean
  createdByUserId: number | null
  sentAt: string | null
  errorMessage: string | null
  template?: { id: number; name: string; shortcut?: string | null } | null
  createdBy?: { id: number; name: string | null; email: string | null } | null
}

/** Agendamentos desta conversa. Só as pendentes importam para o operador no
 *  dia a dia, mas o histórico completo explica por que algo não chegou. */
export function useScheduledMessages(leadId: number | null, status?: string) {
  return useQuery({
    queryKey: ['scheduled-messages', leadId, status ?? 'all'],
    queryFn: () =>
      api.get<{ items: ScheduledMessageItem[] }>(
        `/atendimento/tickets/${leadId}/scheduled${status ? `?status=${status}` : ''}`,
      ),
    enabled: !!leadId,
  })
}

export interface CreateScheduledInput {
  scheduledAt: string
  body?: string
  templateId?: number
  kind?: 'text' | 'template_hsm'
  hsmPayload?: unknown
  channelId?: string
  cancelIfReplied?: boolean
}

export function useCreateScheduledMessage(leadId: number | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateScheduledInput) =>
      api.post<{ item: ScheduledMessageItem; aviso?: string }>(
        `/atendimento/tickets/${leadId}/scheduled`,
        input,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['scheduled-messages', leadId] })
      void qc.invalidateQueries({ queryKey: ['scheduled-messages-mine'] })
    },
  })
}

export function useCancelScheduledMessage(leadId: number | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<{ item: ScheduledMessageItem }>(`/atendimento/scheduled/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['scheduled-messages', leadId] })
      void qc.invalidateQueries({ queryKey: ['scheduled-messages-mine'] })
    },
  })
}

export function useRescheduleMessage(leadId: number | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number; scheduledAt?: string; body?: string; cancelIfReplied?: boolean }) =>
      api.put<{ item: ScheduledMessageItem }>(`/atendimento/scheduled/${id}`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['scheduled-messages', leadId] })
      void qc.invalidateQueries({ queryKey: ['scheduled-messages-mine'] })
    },
  })
}
