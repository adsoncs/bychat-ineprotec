import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface CloudApiConnection {
  id: number
  wabaId: string
  phoneNumberId: string
  displayPhone: string
  displayName: string | null
  qualityRating: string | null
  messagingLimit: string | null
  chatbotId: number | null
  defaultTeamId: number | null
  ownerUserId: number | null
  funnelId: number | null
  stageKey: string | null
  active: boolean
  tokenStatus: 'valid' | 'expired' | 'unknown'
  tokenError?: string
  tokenType: string
  businessProfile: { about?: string; address?: string; description?: string; email?: string; profile_picture_url?: string } | null
  createdAt: string
  updatedAt: string
}

export interface CloudApiTemplate {
  id: number
  name: string
  language: string
  category: string
  status: string
  statusReason?: string | null
  qualityScore?: string | null
  statusUpdatedAt?: string | null
  components: unknown
  wabaId: string
  lastSyncAt?: string
  createdAt: string
  updatedAt: string
}

export interface CloudApiConfig {
  appId: string | null
  configId: string | null
}

export function useCloudApiConfig() {
  return useQuery({
    queryKey: ['cloud-api-config'],
    queryFn: () => api.get<CloudApiConfig>('/cloud-api/config'),
    staleTime: 5 * 60_000,
  })
}

export interface SignupResponse {
  ok: true
  connection: {
    id: number
    wabaId: string
    phoneNumberId: string
    displayPhone: string | null
    displayName: string | null
  }
  tokenType: string
  webhookUrl: string
  webhookSubscribed: boolean
  templatesSynced: number
}

export interface SignupPayload {
  wabaId: string
  phoneNumberId: string
  code?: string | undefined
  accessToken?: string | undefined
}

export function useCloudApiSignup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: SignupPayload) =>
      api.post<SignupResponse>('/cloud-api/embedded-signup', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cloud-api-connections'] })
      void qc.invalidateQueries({ queryKey: ['cloud-api-templates'] })
    },
  })
}

export function useCloudApiConnections() {
  return useQuery({
    queryKey: ['cloud-api-connections'],
    queryFn: () => api.get<{ connections: CloudApiConnection[] }>('/cloud-api/connection'),
    staleTime: 60_000,
  })
}

export function useCloudApiTemplates() {
  return useQuery({
    queryKey: ['cloud-api-templates'],
    queryFn: () => api.get<{ templates: CloudApiTemplate[] }>('/cloud-api/templates'),
    staleTime: 60_000,
  })
}

export interface DispatchReport {
  period: { from: string; to: string }
  totals: { sent: number; delivered: number; read: number; failed: number; billable: number; estimatedCostUsd: number }
  byCategory: Array<{ category: string; count: number; billable: number; estimatedCostUsd: number }>
  byConnection: Array<{ connectionId: number | null; count: number; sent: number; delivered: number; read: number; failed: number; billable: number; estimatedCostUsd: number }>
  recent: Array<{ wamid: string; status: string; category: string | null; billable: boolean; templateName: string | null; leadId: number | null; createdAt: string }>
}
export interface DispatchReportResponse {
  report: DispatchReport
  pricing: Record<string, number>
  connections: Array<{ id: number; displayPhone: string | null; displayName: string | null; qualityRating: string | null; messagingLimit: string | null }>
}

export function useCloudApiDispatchReport(connectionId?: number | null, enabled = true) {
  const qs = connectionId ? `?connectionId=${connectionId}` : ''
  return useQuery({
    queryKey: ['cloud-api-dispatch-report', connectionId ?? 'all'],
    queryFn: () => api.get<DispatchReportResponse>(`/cloud-api/dispatch-report${qs}`),
    enabled,
    staleTime: 30_000,
  })
}

export function useUpdateCloudApiConnection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: { id: number; chatbotId?: number | null; active?: boolean; defaultTeamId?: number | null; ownerUserId?: number | null; funnelId?: number | null; stageKey?: string | null }) =>
      api.put<{ ok: true }>(`/cloud-api/connection/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cloud-api-connections'] }),
  })
}

export function useDeleteCloudApiConnection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/cloud-api/connection/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cloud-api-connections'] }),
  })
}

export function useTestCloudApiConnection() {
  return useMutation({
    mutationFn: ({ id, phone, message }: { id: number; phone: string; message?: string | undefined }) =>
      api.post<{ ok: true; messageId: string }>(`/cloud-api/connection/${id}/test`, { phone, message }),
  })
}

export function useSyncCloudApiTemplates() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ wabaId }: { wabaId: string }) =>
      api.post<{ synced: number }>('/cloud-api/templates/sync', { wabaId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cloud-api-templates'] }),
  })
}

export interface SendTemplateInput {
  phone: string
  templateId: number
  components?: unknown
}

export function useSendCloudApiTemplate() {
  return useMutation({
    mutationFn: (input: SendTemplateInput) =>
      api.post<{ ok: true; messageId: string }>('/cloud-api/send-template', input),
  })
}

/** Upload de mídia para o header de um template (IMAGE/VIDEO/DOCUMENT).
 * Retorna o `handle` que a Meta exige na criação do template. */
export async function uploadCloudApiTemplateMedia(file: File): Promise<string> {
  const fd = new FormData()
  fd.append('file', file)
  const res = await api.post<{ ok: true; handle: string }>('/cloud-api/templates/upload-media', fd)
  return res.handle
}

// CRUD de templates Cloud API (componentes Meta — header/body/footer/buttons)

export type TemplateButtonType = 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER' | 'COPY_CODE'

export interface TemplateButton {
  type: TemplateButtonType
  text?: string | undefined
  url?: string | undefined
  urlExample?: string | undefined
  phoneNumber?: string | undefined
  codeExample?: string | undefined
}

export type HeaderFormat = 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'NONE'

export interface CreateCloudApiTemplateInput {
  name: string
  language: string
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION'
  wabaId: string
  header?: { format: HeaderFormat; text?: string; example?: string; handle?: string } | undefined
  bodyText: string
  bodyExamples?: string[] | undefined
  footer?: string | undefined
  buttons?: TemplateButton[] | undefined
}

export function useCreateCloudApiTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateCloudApiTemplateInput) =>
      api.post<{ ok: true; template: CloudApiTemplate }>('/cloud-api/templates', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cloud-api-templates'] }),
  })
}

export function useUpdateCloudApiTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: { id: number } & Partial<CreateCloudApiTemplateInput>) =>
      api.put<{ ok: true; template: CloudApiTemplate }>(`/cloud-api/templates/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cloud-api-templates'] }),
  })
}

export function useDeleteCloudApiTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<{ ok: true }>(`/cloud-api/templates/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cloud-api-templates'] }),
  })
}

// Helpers de leitura dos `components` da Meta (que vêm como JSON unknown)

export interface ParsedTemplate {
  header: { format: HeaderFormat; text?: string } | null
  body: string
  footer: string | null
  buttons: TemplateButton[]
  variables: string[] // ex.: ['{{1}}', '{{2}}']
}

export function parseTemplateComponents(components: unknown): ParsedTemplate {
  const result: ParsedTemplate = { header: null, body: '', footer: null, buttons: [], variables: [] }
  if (!Array.isArray(components)) return result
  for (const c of components as Record<string, unknown>[]) {
    const type = (typeof c.type === 'string' ? c.type : '').toUpperCase()
    if (type === 'HEADER') {
      const fmt = (typeof c.format === 'string' ? c.format : 'TEXT').toUpperCase() as HeaderFormat
      const text = typeof c.text === 'string' ? c.text : undefined
      result.header = text !== undefined ? { format: fmt, text } : { format: fmt }
    } else if (type === 'BODY') {
      result.body = typeof c.text === 'string' ? c.text : ''
    } else if (type === 'FOOTER') {
      result.footer = typeof c.text === 'string' ? c.text : null
    } else if (type === 'BUTTONS') {
      const arr = Array.isArray(c.buttons) ? (c.buttons as Record<string, unknown>[]) : []
      for (const b of arr) {
        const btype = (typeof b.type === 'string' ? b.type : '').toUpperCase() as TemplateButtonType
        result.buttons.push({
          type: btype,
          text: typeof b.text === 'string' ? b.text : undefined,
          url: typeof b.url === 'string' ? b.url : undefined,
          phoneNumber: typeof b.phone_number === 'string' ? b.phone_number : undefined,
        })
      }
    }
  }
  // extrai variáveis do body ({{1}}, {{2}})
  const matches = result.body.match(/\{\{\d+\}\}/g)
  if (matches) result.variables = Array.from(new Set(matches)).sort()
  return result
}

// ── Editor visual do WhatsApp Flow ─────────────────────────────
export interface FlowFieldConfigItem {
  key: string
  type: string
  formLabel: string
  label: string
  include: boolean
  required: boolean
  hasOptions: boolean
}
export interface FlowConfig {
  formId: number
  formName: string
  metaFlowId: string | null
  status: string | null
  lastError: string | null
  cta: string
  bodyText: string
  screenTitle: string
  fields: FlowFieldConfigItem[]
}

export function useFlowConfig(formId: number | null) {
  return useQuery({
    queryKey: ['flow-config', formId],
    queryFn: () => api.get<FlowConfig>(`/cloud-api/flows/by-form/${formId}`),
    enabled: !!formId,
    staleTime: 0,
  })
}

export function useSaveFlowConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ formId, ...body }: { formId: number; cta: string; bodyText: string; screenTitle: string; fieldConfig: { key: string; label: string; include: boolean; required: boolean }[] }) =>
      api.put<{ ok: true; id: number }>(`/cloud-api/flows/by-form/${formId}`, body),
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['flow-config', v.formId] }),
  })
}

export function usePublishFlow() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ formId }: { formId: number }) =>
      api.post<{ ok: true; metaFlowId: string }>(`/cloud-api/flows/by-form/${formId}/publish`, {}),
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['flow-config', v.formId] }),
  })
}
