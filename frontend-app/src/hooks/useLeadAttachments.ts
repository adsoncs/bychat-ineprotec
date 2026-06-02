import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface LeadAttachment {
  id: number
  leadId: number
  activityId: number
  fileName: string
  fileSize: number
  mimeType: string
  url: string
  uploadedById: number | null
  uploadedByName: string | null
  description: string | null
  createdAt: string
}

/** Todos os anexos do lead (todas as atividades). */
export function useLeadAttachments(leadId: number | null) {
  return useQuery({
    queryKey: ['lead-attachments', leadId],
    queryFn: () => api.get<{ attachments: LeadAttachment[] }>(`/leads/${leadId}/attachments`),
    enabled: leadId !== null,
    staleTime: 15_000,
  })
}

/** Anexos de uma atividade específica. */
export function useActivityAttachments(activityId: number | null) {
  return useQuery({
    queryKey: ['activity-attachments', activityId],
    queryFn: () => api.get<{ attachments: LeadAttachment[] }>(`/activities/${activityId}/attachments`),
    enabled: activityId !== null,
    staleTime: 15_000,
  })
}

/** Upload de 1 arquivo vinculado a uma atividade. */
export function useUploadActivityAttachment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ activityId, file, description }: { activityId: number; file: File; description?: string }) => {
      const fd = new FormData()
      fd.append('file', file)
      if (description) fd.append('description', description)
      return api.post<{ attachment: LeadAttachment }>(`/activities/${activityId}/attachments`, fd)
    },
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['activity-attachments', res.attachment.activityId] })
      void qc.invalidateQueries({ queryKey: ['lead-attachments', res.attachment.leadId] })
      void qc.invalidateQueries({ queryKey: ['lead-activities', res.attachment.leadId] })
      void qc.invalidateQueries({ queryKey: ['activities'] })
      void qc.invalidateQueries({ queryKey: ['lead-history', res.attachment.leadId] })
    },
  })
}

export function useDeleteActivityAttachment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ activityId, attachmentId }: { activityId: number; attachmentId: number; leadId?: number }) =>
      api.delete<{ ok: true }>(`/activities/${activityId}/attachments/${attachmentId}`),
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: ['activity-attachments', vars.activityId] })
      if (vars.leadId) {
        void qc.invalidateQueries({ queryKey: ['lead-attachments', vars.leadId] })
        void qc.invalidateQueries({ queryKey: ['lead-activities', vars.leadId] })
        void qc.invalidateQueries({ queryKey: ['lead-history', vars.leadId] })
      }
      void qc.invalidateQueries({ queryKey: ['activities'] })
    },
  })
}
