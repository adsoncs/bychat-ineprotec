import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface ConversationAudit {
  id: number
  leadId: number
  operatorId: number | null
  operatorName: string | null
  periodFrom: string | null
  periodTo: string | null
  messageCount: number
  score: number | null
  tone: 'cordial' | 'neutro' | 'frio' | 'agressivo' | 'inconsistente' | null
  responseTimeAvgSec: number | null
  responseTimeP95Sec: number | null
  strengths: string[] | null
  weaknesses: string[] | null
  missedOpportunities: string[] | null
  scriptAdherence: number | null
  summary: string | null
  modelUsed: string | null
  status: 'pending' | 'running' | 'done' | 'failed'
  errorMessage: string | null
  triggeredBy: string | null
  createdAt: string
  lead?: { id: number; nome: string | null; whatsapp: string | null; email: string | null; funnel?: { name: string } | null }
}

export interface AuditFilters {
  dateFrom?: string
  dateTo?: string
  operatorId?: number
  minScore?: number
  maxScore?: number
  tone?: string
  status?: string
  limit?: number
}

function buildQs(f: AuditFilters): string {
  const p = new URLSearchParams()
  if (f.dateFrom) p.set('dateFrom', f.dateFrom)
  if (f.dateTo) p.set('dateTo', f.dateTo)
  if (f.operatorId) p.set('operatorId', String(f.operatorId))
  if (f.minScore !== undefined) p.set('minScore', String(f.minScore))
  if (f.maxScore !== undefined) p.set('maxScore', String(f.maxScore))
  if (f.tone) p.set('tone', f.tone)
  if (f.status) p.set('status', f.status)
  if (f.limit) p.set('limit', String(f.limit))
  const s = p.toString()
  return s ? `?${s}` : ''
}

export function useConversationAudits(filters: AuditFilters = {}) {
  return useQuery({
    queryKey: ['conversation-audits', filters],
    queryFn: () => api.get<{ data: ConversationAudit[]; total: number }>(`/admin/conversation-audits${buildQs(filters)}`),
    staleTime: 30_000,
  })
}

export interface AuditOverview {
  range: { from: string; to: string }
  totals: { total: number; done: number; failed: number; lowScore: number }
  averages: { score: number | null; responseTimeSec: number | null }
  toneBreakdown: Array<{ tone: string; count: number }>
}

export function useAuditOverview(filters: Pick<AuditFilters, 'dateFrom' | 'dateTo'> = {}) {
  return useQuery({
    queryKey: ['audit-overview', filters],
    queryFn: () => api.get<AuditOverview>(`/admin/conversation-audits/agg/overview${buildQs(filters)}`),
    staleTime: 30_000,
  })
}

export interface OperatorAuditRow {
  operatorId: number
  operatorName: string | null
  audits: number
  avgScore: number | null
  minScore: number | null
  maxScore: number | null
  avgResponseTimeSec: number | null
  avgScriptAdherence: number | null
  dominantTone: string | null
}

export function useOperatorAuditRanking(filters: Pick<AuditFilters, 'dateFrom' | 'dateTo'> = {}) {
  return useQuery({
    queryKey: ['audit-ranking', filters],
    queryFn: () => api.get<{ data: OperatorAuditRow[]; range: { from: string; to: string } }>(`/admin/conversation-audits/agg/by-operator${buildQs(filters)}`),
    staleTime: 30_000,
  })
}

export function useLeadAudits(leadId: number | null) {
  return useQuery({
    queryKey: ['lead-audits', leadId],
    queryFn: () => api.get<{ data: ConversationAudit[] }>(`/admin/conversation-audits/by-lead/${leadId}`),
    enabled: leadId !== null,
    staleTime: 15_000,
  })
}

export function useRunAudit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (leadId: number) => api.post<{ ok: true; queued: boolean }>(`/admin/conversation-audits/run/${leadId}`, {}),
    onSuccess: (_r, leadId) => {
      void qc.invalidateQueries({ queryKey: ['lead-audits', leadId] })
      void qc.invalidateQueries({ queryKey: ['conversation-audits'] })
      void qc.invalidateQueries({ queryKey: ['audit-overview'] })
    },
  })
}

export function useDeleteAudit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<{ ok: true }>(`/admin/conversation-audits/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['conversation-audits'] })
      void qc.invalidateQueries({ queryKey: ['lead-audits'] })
    },
  })
}
