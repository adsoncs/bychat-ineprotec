import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { env } from '@/lib/env'

export interface BroadcastCampaign {
  id: number
  name: string
  cloudApiConnectionId: number
  templateId: number
  templateName: string
  templateLanguage: string
  templateCategory: string
  variableMapping: Record<string, { type: 'lead_field' | 'column' | 'fixed'; value: string }>
  audienceType: 'leads' | 'import'
  status: 'draft' | 'scheduled' | 'running' | 'paused' | 'completed' | 'canceled' | 'failed'
  scheduledAt: string | null
  startedAt: string | null
  completedAt: string | null
  totalRecipients: number
  sentCount: number
  failedCount: number
  skippedCount: number
  createdAt: string
  cloudApiConnection?: { displayPhone: string | null; displayName: string | null }
}

export interface CampaignMetrics {
  counts: Record<string, number>
  total: number
  progress: number
  estimatedCostUsd: number
}

export interface BroadcastRecipient {
  id: number; phone: string; name: string | null; status: string; skipReason: string | null
  wamid: string | null; error: string | null; variables: Record<string, string>
}

export function useBroadcastCampaigns() {
  return useQuery({
    queryKey: ['broadcast-campaigns'],
    queryFn: () => api.get<{ campaigns: BroadcastCampaign[] }>('/admin/broadcast/campaigns'),
    staleTime: 15_000,
  })
}

export function useBroadcastCampaign(id: number | null, pollMs = 0) {
  return useQuery({
    queryKey: ['broadcast-campaign', id],
    queryFn: () => api.get<{ campaign: BroadcastCampaign; metrics: CampaignMetrics; recipients: BroadcastRecipient[] }>(`/admin/broadcast/campaigns/${id}`),
    enabled: id !== null,
    refetchInterval: pollMs || false,
  })
}

export function useTemplateVariables(templateId: number | null) {
  return useQuery({
    queryKey: ['broadcast-template-vars', templateId],
    queryFn: () => api.get<{ keys: string[]; named: boolean }>(`/admin/broadcast/template-variables?templateId=${templateId}`),
    enabled: templateId !== null,
  })
}

export function useCreateBroadcastCampaign() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { name: string; cloudApiConnectionId: number; templateId: number; audienceType: 'leads' | 'import'; variableMapping?: any }) =>
      api.post<{ campaign: BroadcastCampaign }>('/admin/broadcast/campaigns', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['broadcast-campaigns'] }),
  })
}

export function useUpdateBroadcastCampaign() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: { id: number; name?: string; variableMapping?: any; scheduledAt?: string | null }) =>
      api.put<{ campaign: BroadcastCampaign }>(`/admin/broadcast/campaigns/${id}`, input),
    onSuccess: (_d, v) => { qc.invalidateQueries({ queryKey: ['broadcast-campaigns'] }); qc.invalidateQueries({ queryKey: ['broadcast-campaign', v.id] }) },
  })
}

export function useDeleteBroadcastCampaign() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<{ ok: true }>(`/admin/broadcast/campaigns/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['broadcast-campaigns'] }),
  })
}

export function useSetAudienceLeads() {
  return useMutation({
    mutationFn: ({ id, leadIds }: { id: number; leadIds: number[] }) =>
      api.post<{ ok: true; created: number; skipped: number }>(`/admin/broadcast/campaigns/${id}/audience/leads`, { leadIds }),
  })
}

export function useParseSheet() {
  return useMutation({
    mutationFn: ({ id, file }: { id: number; file: File }) => {
      const fd = new FormData(); fd.append('file', file)
      return api.post<{ headers: string[]; sampleRows: Record<string, string>[]; totalRows: number }>(`/admin/broadcast/campaigns/${id}/audience/parse`, fd)
    },
  })
}

export function useImportCommit() {
  return useMutation({
    mutationFn: ({ id, phoneColumn, nameColumn }: { id: number; phoneColumn: string; nameColumn?: string | undefined }) =>
      api.post<{ ok: true; created: number; skipped: number }>(`/admin/broadcast/campaigns/${id}/audience/import-commit`, { phoneColumn, nameColumn }),
  })
}

export function useStartCampaign() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, scheduledAt }: { id: number; scheduledAt?: string | null }) =>
      api.post<{ ok: true; status: string }>(`/admin/broadcast/campaigns/${id}/start`, { scheduledAt }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['broadcast-campaigns'] }),
  })
}

export function useCampaignAction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, action }: { id: number; action: 'pause' | 'resume' | 'cancel' }) =>
      api.post<{ ok: true }>(`/admin/broadcast/campaigns/${id}/${action}`),
    onSuccess: (_d, v) => { qc.invalidateQueries({ queryKey: ['broadcast-campaigns'] }); qc.invalidateQueries({ queryKey: ['broadcast-campaign', v.id] }) },
  })
}

/** Baixa o modelo de planilha (XLSX) — fetch autenticado + download via blob. */
export async function downloadAudienceTemplate(templateId: number | null): Promise<void> {
  const token = localStorage.getItem(env.authTokenKey)
  const url = `${env.apiBase}/admin/broadcast/audience-template${templateId ? `?templateId=${templateId}` : ''}`
  const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {}, credentials: 'include' })
  if (!res.ok) throw new Error('Falha ao baixar modelo')
  const blob = await res.blob()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'modelo_disparo.xlsx'
  document.body.appendChild(a); a.click(); a.remove()
  URL.revokeObjectURL(a.href)
}
