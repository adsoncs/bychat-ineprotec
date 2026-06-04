import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface Setting {
  id: number
  key: string
  value: unknown
  label: string | null
  grp: string
  fieldType: string | null
  options: unknown
  helpText: string | null
}

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<{ settings: Setting[]; grouped: Record<string, Setting[]> }>('/admin/settings'),
    staleTime: 60_000,
  })
}

export function useUpdateSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (updates: Record<string, unknown>) =>
      api.put<{ ok: true }>('/admin/settings', updates),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  })
}

// ── LGPD / Legal ───────────────────────────────────────────────
export interface LegalConfig {
  companyName: string
  cnpj: string
  dpoEmail: string
  version: string
  privacyHtml: string
  termsHtml: string
  cookiesHtml: string
}

export function useLegalSettings() {
  return useQuery({
    queryKey: ['legal-settings'],
    queryFn: () => api.get<LegalConfig>('/admin/legal'),
    staleTime: 60_000,
  })
}

export function useUpdateLegalSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (updates: Partial<LegalConfig>) =>
      api.put<{ ok: true }>('/admin/legal', updates),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['legal-settings'] }),
  })
}

// ── Requisições de titulares (LGPD art. 18) ────────────────────
export interface DsarRequest {
  id: number
  leadId: number | null
  email: string | null
  whatsapp: string | null
  name: string | null
  type: 'access' | 'correction' | 'deletion' | 'portability' | 'revocation'
  status: 'pending' | 'in_progress' | 'done' | 'rejected'
  details: { message?: string } | null
  response: string | null
  dueAt: string
  handledAt: string | null
  createdAt: string
}

export interface DsarList {
  requests: DsarRequest[]
  counts: { pending: number; overdue: number; total: number }
}

export function useDsarRequests(status: string) {
  return useQuery({
    queryKey: ['dsar', status],
    queryFn: () => api.get<DsarList>(`/admin/dsar${status ? `?status=${encodeURIComponent(status)}` : ''}`),
    staleTime: 15_000,
  })
}

export function useUpdateDsar() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status, response }: { id: number; status?: string; response?: string }) =>
      api.post<{ ok: true }>(`/admin/dsar/${id}`, { status, response }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dsar'] }),
  })
}

export function useDeleteDsarLead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason?: string }) =>
      api.post<{ ok: true }>(`/admin/dsar/${id}/delete-lead`, { reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dsar'] })
      qc.invalidateQueries({ queryKey: ['leads'] })
    },
  })
}

export interface AppearanceConfig {
  appearance: Record<string, string>
  defaults: Record<string, string>
  // true só na instalação principal (serve a landing/home pública). Filhas
  // (subdomínio) não veem os controles de landing.
  landingAdmin?: boolean
}

export function useAppearance() {
  return useQuery({
    queryKey: ['appearance'],
    queryFn: () => api.get<AppearanceConfig>('/admin/appearance'),
    staleTime: 60_000,
  })
}

/** Configuração de aparência via rota pública (sem auth) — usado em
 * componentes de shell e na tela de login para renderizar branding dinâmico. */
export function usePublicAppearance() {
  return useQuery({
    queryKey: ['appearance', 'public'],
    queryFn: () =>
      api.get<{ appearance: Record<string, string> }>('/appearance', { anonymous: true }),
    staleTime: 60_000,
  })
}

export function useUpdateAppearance() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (updates: Record<string, string>) =>
      api.put<{ ok: true }>('/admin/appearance', updates),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['appearance'] })
      qc.invalidateQueries({ queryKey: ['appearance', 'public'] })
    },
  })
}

export type LogoSlot = 'admin_logo' | 'lp_logo' | 'favicon' | 'login_image'

export function useUploadLogo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ slot, file }: { slot: LogoSlot; file: File }) => {
      const fd = new FormData()
      fd.append(slot, file, file.name)
      return api.post<{ ok: true; url: string }>('/admin/appearance/logo', fd)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['appearance'] })
      qc.invalidateQueries({ queryKey: ['appearance', 'public'] })
    },
  })
}

export function useDeleteLogo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (slot: LogoSlot) =>
      api.delete<{ ok: true }>(`/admin/appearance/logo?type=${encodeURIComponent(slot)}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['appearance'] })
      qc.invalidateQueries({ queryKey: ['appearance', 'public'] })
    },
  })
}

// ── Testers ────────────────────────────────────────────────────

export function useTestAi() {
  return useMutation({
    mutationFn: (provider: 'anthropic' | 'openai') =>
      api.post<{ ok: true; provider: string }>('/admin/settings/ai-test', { provider }),
  })
}

export function useTestSmtp() {
  return useMutation({
    mutationFn: () => api.post<{ ok: true }>('/admin/settings/smtp-test'),
  })
}

export function useTestEmail() {
  return useMutation({
    mutationFn: (to: string) =>
      api.post<{ ok: true }>('/admin/settings/email-test', { to }),
  })
}

export function useTestSms() {
  return useMutation({
    mutationFn: (input: { to: string; message?: string | undefined }) =>
      api.post<{ ok: true; providerId?: string; message?: string }>('/admin/sms/test', input),
  })
}

// ── DNS records ────────────────────────────────────────────────

export interface DnsRecord {
  /** Tudo é guardado em Setting.value (JSON) — shape livre. */
  type?: string
  name?: string
  ttl?: number | string
  content?: string
  [key: string]: unknown
}

export interface DnsInput {
  key: string
  label: string
  value: DnsRecord
}

export function useCreateDns() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: DnsInput) => api.post<{ ok: true }>('/admin/settings/dns', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  })
}

export function useUpdateDns() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: DnsInput) => api.put<{ ok: true }>('/admin/settings/dns', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  })
}

export function useDeleteDns() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (key: string) =>
      api.delete<{ ok: true }>(`/admin/settings/dns/${encodeURIComponent(key)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  })
}
