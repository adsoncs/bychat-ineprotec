import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface QueueStats {
  name: string
  waiting: number
  active: number
  completed: number
  failed: number
  delayed: number
  paused: boolean
  isCommunication: boolean
}

export type JobStatus = 'waiting' | 'active' | 'completed' | 'failed' | 'delayed'
export type SendChannel = 'whatsapp' | 'email' | 'sms' | 'webhook'
export type SendStatus = 'queued' | 'processing' | 'sent' | 'delivered' | 'read' | 'failed' | 'bounced'

export interface QueueJob {
  id: string | number
  name: string
  data: unknown
  status: string
  attempts: number
  maxAttempts: number | null
  failedReason: string | null
  processedOn: number | null
  finishedOn: number | null
  delay: number | null
  timestamp: number
}

export interface QueueJobDetail extends QueueJob {
  opts: any
  progress: any
  returnvalue: any
  stacktrace: string[] | null
}

export interface OutboundSend {
  id: number
  channel: SendChannel
  queueName: string
  leadId: number | null
  lead: { id: number; nome: string | null; empresa: string | null; whatsapp: string | null; email: string | null } | null
  recipient: string
  subject: string | null
  bodyPreview: string | null
  jobId: string | null
  externalId: string | null
  status: SendStatus
  attempts: number
  maxAttempts: number | null
  latencyMs: number | null
  error: string | null
  metadata: any
  source: string | null
  sourceId: number | null
  createdAt: string
  processingAt: string | null
  sentAt: string | null
  deliveredAt: string | null
  readAt: string | null
  failedAt: string | null
}

export interface SendsListResponse {
  sends: OutboundSend[]
  total: number
  limit: number
  offset: number
}

export interface QueueStatsByChannel {
  sent: number
  delivered: number
  read: number
  failed: number
  queued: number
  processing: number
  total: number
  avgLatencyMs: number | null
}

export interface QueueAggregateStats {
  since: string
  hours: number
  byChannel: Record<SendChannel, QueueStatsByChannel>
  topErrors: { channel: string; error: string; total: number }[]
  series: { bucket: string; channel: string; status: string; total: number }[]
}

export interface SendsFilters {
  channel?: SendChannel | undefined
  status?: SendStatus | undefined
  leadId?: number | undefined
  search?: string | undefined
  sinceHours?: number | undefined
  limit?: number | undefined
  offset?: number | undefined
}

function buildQs(f: Record<string, any>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(f)) {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v))
  }
  const qs = p.toString()
  return qs ? `?${qs}` : ''
}

export function useQueues() {
  return useQuery({
    queryKey: ['queues'],
    queryFn: () => api.get<{ queues: QueueStats[] }>('/admin/queues'),
    staleTime: 5_000,
    refetchInterval: 10_000,
  })
}

export function useQueueStats(hours: number = 24) {
  return useQuery({
    queryKey: ['queue-stats', hours],
    queryFn: () => api.get<QueueAggregateStats>(`/admin/queues/stats?hours=${hours}`),
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}

export function useQueueJobs(name: string | null, status: JobStatus = 'failed') {
  return useQuery({
    queryKey: ['queue-jobs', name, status],
    queryFn: () => api.get<{ jobs: QueueJob[] }>(`/admin/queues/${name}/jobs?status=${status}&limit=30`),
    enabled: name !== null,
    staleTime: 5_000,
  })
}

export function useQueueJob(name: string | null, id: string | number | null) {
  return useQuery({
    queryKey: ['queue-job', name, id],
    queryFn: () => api.get<{ job: QueueJobDetail }>(`/admin/queues/${name}/jobs/${id}`),
    enabled: name !== null && id !== null,
    staleTime: 5_000,
  })
}

export function useSends(filters: SendsFilters = {}) {
  return useQuery({
    queryKey: ['outbound-sends', filters],
    queryFn: () => api.get<SendsListResponse>(`/admin/queues/sends${buildQs(filters)}`),
    staleTime: 5_000,
    refetchInterval: 15_000,
  })
}

export function useSendDetail(id: number | null) {
  return useQuery({
    queryKey: ['outbound-send', id],
    queryFn: () => api.get<{ send: OutboundSend }>(`/admin/queues/sends/${id}`),
    enabled: id !== null,
    staleTime: 5_000,
  })
}

export function useRetryAllFailed() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (queueName: string) => api.post<{ retried: number }>(`/admin/queues/${queueName}/retry-all`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['queues'] })
      void qc.invalidateQueries({ queryKey: ['queue-jobs'] })
    },
  })
}

export function useRetryJob() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ name, id }: { name: string; id: string | number }) =>
      api.post<{ ok: true }>(`/admin/queues/${name}/jobs/${id}/retry`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['queues'] })
      void qc.invalidateQueries({ queryKey: ['queue-jobs'] })
      void qc.invalidateQueries({ queryKey: ['queue-job'] })
    },
  })
}

export function useDeleteJob() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ name, id }: { name: string; id: string | number }) =>
      api.delete<{ ok: true }>(`/admin/queues/${name}/jobs/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['queues'] })
      void qc.invalidateQueries({ queryKey: ['queue-jobs'] })
    },
  })
}

export function usePauseQueue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => api.post<{ ok: true; paused: true }>(`/admin/queues/${name}/pause`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['queues'] }),
  })
}

export function useResumeQueue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => api.post<{ ok: true; paused: false }>(`/admin/queues/${name}/resume`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['queues'] }),
  })
}

export function useCleanQueue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ name, status }: { name: string; status: 'completed' | 'failed' }) =>
      api.delete<{ cleaned: number }>(`/admin/queues/${name}/clean?status=${status}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['queues'] })
      void qc.invalidateQueries({ queryKey: ['queue-jobs'] })
    },
  })
}
