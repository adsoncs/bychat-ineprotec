import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export type ActivityType = 'whatsapp' | 'email' | 'sms' | 'call' | 'meeting' | 'task' | 'note' | 'follow_up'
export type ActivityStatus = 'pending' | 'completed' | 'cancelled' | 'overdue' | 'sent' | 'failed'

export interface Activity {
  id: number
  leadId: number
  userId: number | null
  userName: string | null
  type: ActivityType
  status: ActivityStatus
  title: string
  description: string | null
  scheduledAt: string
  reminderAt: string | null
  completedAt: string | null
  createdAt: string
  recipientPhone: string | null
  recipientEmail: string | null
  messageBody: string | null
  messageSubject: string | null
  direction: string | null
  templateId: number | null
  attachmentUrl: string | null
  attachmentName: string | null
  attachmentType: string | null
  metadata: Record<string, unknown> | null
  // Módulo Resumo: responsável pela execução e código da atividade padrão.
  assignedUserId?: number | null
  assignedTeamId?: number | null
  assignedUser?: { id: number; name: string | null; email: string } | null
  assignedTeam?: { id: number; name: string; color: string | null } | null
  templateCode?: string | null
  lead?: { id: number; empresa: string | null; nome: string | null; whatsapp: string | null; email: string | null; status: string | null }
}

export interface ActivityInput {
  leadId: number
  type: ActivityType
  title: string
  description?: string | null | undefined
  scheduledAt: string
  reminderAt?: string | null | undefined
  recipientPhone?: string | null | undefined
  recipientEmail?: string | null | undefined
  messageBody?: string | null | undefined
  messageSubject?: string | null | undefined
  templateId?: number | null | undefined
  attachmentUrl?: string | null | undefined
  attachmentName?: string | null | undefined
  attachmentType?: string | null | undefined
  /** Avisar o lead (convite Google Calendar + WhatsApp) — só p/ meeting/call. Default false. */
  notifyLead?: boolean | undefined
  /** Gravar/transcrever esta reunião — opt-OUT por reunião (F0.5). Só p/ meeting.
   *  Envie false para NÃO gravar; ausência = segue a policy do tenant. */
  recordMeeting?: boolean | undefined
}

export interface ActivitiesListResponse {
  activities: Activity[]
  total: number
  limit: number
  offset: number
}

export interface ActivitiesFilters {
  view?: 'today' | 'week' | 'overdue' | 'upcoming' | 'completed' | undefined
  status?: ActivityStatus | undefined
  type?: ActivityType | undefined
  limit?: number | undefined
  offset?: number | undefined
  from?: string | undefined
  to?: string | undefined
  dateField?: 'scheduledAt' | 'createdAt' | undefined
  // Módulo Resumo: filtra por quem EXECUTA (userId acima é quem criou).
  assignedUserId?: number | undefined
  assignedTeamId?: number | undefined
  /** Só as sem dono — a fila que ninguém puxou ainda. */
  unassigned?: boolean | undefined
  /** Código do ActivityTemplate, ex.: "AT-WP-06". */
  templateCode?: string | undefined
}

function buildQuery(f: ActivitiesFilters): string {
  const p = new URLSearchParams()
  if (f.view) p.set('view', f.view)
  if (f.status) p.set('status', f.status)
  if (f.type) p.set('type', f.type)
  if (f.limit !== undefined) p.set('limit', String(f.limit))
  if (f.offset !== undefined) p.set('offset', String(f.offset))
  if (f.from) p.set('from', f.from)
  if (f.to) p.set('to', f.to)
  if (f.dateField) p.set('dateField', f.dateField)
  if (f.assignedUserId !== undefined) p.set('assignedUserId', String(f.assignedUserId))
  if (f.assignedTeamId !== undefined) p.set('assignedTeamId', String(f.assignedTeamId))
  if (f.unassigned) p.set('unassigned', 'true')
  if (f.templateCode) p.set('templateCode', f.templateCode)
  const qs = p.toString()
  return qs ? `?${qs}` : ''
}

export function useActivities(filters: ActivitiesFilters = {}) {
  return useQuery({
    queryKey: ['activities', filters],
    queryFn: () => api.get<ActivitiesListResponse>(`/activities${buildQuery(filters)}`),
    staleTime: 15_000,
  })
}

// Invalida tanto a lista global (['activities']) quanto as listas por lead
// (['lead-activities', leadId]) — sem isso, criar/atualizar/excluir/executar
// uma atividade pela tela do lead não atualiza a aba de atividades do lead.
function invalidateActivityQueries(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({
    predicate: (q) => q.queryKey[0] === 'activities' || q.queryKey[0] === 'lead-activities',
  })
}

export function useCreateActivity() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: ActivityInput) => api.post<{ ok: true; activity: Activity }>('/activities', input),
    onSuccess: () => invalidateActivityQueries(qc),
  })
}

export function useUpdateActivity() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: {
      id: number
      status?: ActivityStatus
      type?: ActivityType
      title?: string
      description?: string | null
      scheduledAt?: string
      reminderAt?: string | null
      messageBody?: string | null
      messageSubject?: string | null
      recipientPhone?: string | null
      recipientEmail?: string | null
    }) =>
      api.put<{ ok: true; activity: Activity }>(`/activities/${id}`, input),
    onSuccess: () => invalidateActivityQueries(qc),
  })
}

export function useDeleteActivity() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/activities/${id}`),
    onSuccess: () => invalidateActivityQueries(qc),
  })
}

export function useExecuteActivity() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      api.post<{ ok: true; result: string }>(`/activities/${id}/execute`, {}),
    onSuccess: () => invalidateActivityQueries(qc),
  })
}

export function useLeadActivities(leadId: number | null) {
  return useQuery({
    queryKey: ['lead-activities', leadId],
    queryFn: () => api.get<{ activities: Activity[] }>(`/leads/${leadId}/activities`),
    enabled: leadId !== null,
    staleTime: 15_000,
  })
}
