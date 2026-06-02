import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface MetaForm {
  id: number
  formId: string
  formName: string
  status: string
  funnelId: number | null
  stageKey: string | null
  defaultTeamId: number | null
  leadsReceived: number
  lastLeadAt: string | null
}

export interface MetaIntegration {
  id: number
  pageId: string
  pageName: string
  active: boolean
  tokenStatus: 'valid' | 'expired' | 'unknown'
  tokenError?: string
  tokenType: string
  leadsReceived: number
  createdAt: string
  forms: MetaForm[]
}

export interface MetaStatusResponse {
  integrations: MetaIntegration[]
  pollerActive: boolean
}

export function useMetaStatus() {
  return useQuery({
    queryKey: ['meta-status'],
    queryFn: () => api.get<MetaStatusResponse>('/meta/status'),
    staleTime: 60_000,
  })
}

export interface MetaConfig {
  appId: string | null
  configId: string | null
  hasSecret: boolean
}

export function useMetaConfig() {
  return useQuery({
    queryKey: ['meta-config'],
    queryFn: () => api.get<MetaConfig>('/meta/config'),
    staleTime: 5 * 60_000,
  })
}

export interface MetaPage {
  id: string
  name: string
  accessToken: string
  category: string
}

interface ConnectResponse {
  ok: true
  pages: MetaPage[]
  tokenType?: string
}

export function useConnectMetaWithToken() {
  return useMutation({
    mutationFn: (userAccessToken: string) =>
      api.post<ConnectResponse>('/meta/connect-with-token', { userAccessToken }),
  })
}

export function useConnectMetaBisu() {
  return useMutation({
    mutationFn: ({ code, redirectUri }: { code: string; redirectUri: string }) =>
      api.post<ConnectResponse>('/meta/connect-bisu', { code, redirectUri }),
  })
}

interface SelectPageResponse {
  ok: true
  integration: { id: number; pageId: string; pageName: string }
  webhookSubscribed: boolean
  formsSync: number
  tokenType: string
}

export function useSelectMetaPage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (pageId: string) => api.post<SelectPageResponse>('/meta/select-page', { pageId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meta-status'] }),
  })
}

export function useToggleMetaIntegration() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.post<{ ok: true; active: boolean }>(`/meta/integrations/${id}/toggle`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meta-status'] }),
  })
}

export function useDeleteMetaIntegration() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<{ ok: true }>(`/meta/integrations/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meta-status'] }),
  })
}

export function useSyncMetaForms() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      api.post<{ ok: true; total: number; forms: MetaForm[] }>(`/meta/integrations/${id}/sync-forms`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meta-status'] }),
  })
}

// ── Forms (config + mapping + pull/reprocess) ──────────────────────────

export interface MetaFormUpdateInput {
  funnelId?: number | null | undefined
  stageKey?: string | null | undefined
  defaultTeamId?: number | null | undefined
  fieldMapping?: Record<string, string> | undefined
  autoComplete?: boolean | undefined
  status?: string | undefined
}

export function useUpdateMetaForm() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: { id: number } & MetaFormUpdateInput) =>
      api.put<{ ok: true; form: MetaForm }>(`/meta/forms/${id}`, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['meta-status'] })
      void qc.invalidateQueries({ queryKey: ['meta-form-fields'] })
    },
  })
}

export function useToggleMetaForm() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      api.post<{ ok: true; status: string }>(`/meta/forms/${id}/toggle`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meta-status'] }),
  })
}

export function usePullMetaLeads() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      api.post<{ ok: true; total: number; created: number; skipped: number; failed: number }>(
        `/meta/forms/${id}/pull-leads`,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['meta-status'] })
      void qc.invalidateQueries({ queryKey: ['meta-logs'] })
    },
  })
}

export function useReprocessMetaLeads() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      api.post<{ ok: true; total: number; updated: number; skipped: number }>(
        `/meta/forms/${id}/reprocess`,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['meta-logs'] })
    },
  })
}

// Preenche só os campos personalizados (cf_*) dos leads já importados, a
// partir do mapeamento atual. Não toca em campos núcleo; idempotente.
export function useUpdateMetaCustomFields() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      api.post<{ ok: true; total: number; updated: number; skipped: number; message?: string }>(
        `/meta/forms/${id}/update-custom-fields`,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['meta-logs'] })
      void qc.invalidateQueries({ queryKey: ['leads'] })
    },
  })
}

export interface MetaFormFieldsResponse {
  metaFields: { key: string; label: string; type: string }[]
  leadFields: { key: string; label: string }[]
  currentMapping: Record<string, string>
  autoSuggest: Record<string, string>
}

export function useMetaFormFields(id: number | null) {
  return useQuery({
    queryKey: ['meta-form-fields', id],
    queryFn: () => api.get<MetaFormFieldsResponse>(`/meta/forms/${id}/fields`),
    enabled: id !== null,
    staleTime: 60_000,
  })
}

export interface MetaLeadLog {
  id: number
  metaLeadId: string
  metaFormId: string
  metaPageId: string
  status: string
  leadId: number | null
  errorMessage: string | null
  rawData: Record<string, unknown> | null
  campaignData: Record<string, unknown> | null
  createdAt: string
  processedAt: string | null
}

export interface MetaLogsFilters {
  status?: string | undefined
  formId?: string | undefined
  limit?: number | undefined
  offset?: number | undefined
}

export function useMetaLogs(filters: MetaLogsFilters = {}) {
  const qs = new URLSearchParams()
  if (filters.status) qs.set('status', filters.status)
  if (filters.formId) qs.set('formId', filters.formId)
  if (filters.limit) qs.set('limit', String(filters.limit))
  if (filters.offset) qs.set('offset', String(filters.offset))
  const qsStr = qs.toString()
  return useQuery({
    queryKey: ['meta-logs', filters],
    queryFn: () =>
      api.get<{ logs: MetaLeadLog[]; total: number }>(
        `/meta/logs${qsStr ? `?${qsStr}` : ''}`,
      ),
    staleTime: 10_000,
  })
}
