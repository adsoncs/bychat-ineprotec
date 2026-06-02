import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export type EnrichmentStatus = 'done' | 'partial' | 'pending' | 'running' | null

export type LgpdConsentSource = 'titular' | 'operator_override' | 'legacy' | null

export interface IntelLead {
  id: number
  uid: string | null
  nome: string | null
  empresa: string | null
  whatsapp: string | null
  email: string | null
  lgpdConsent: boolean
  lgpdConsentAt: string | null
  lgpdConsentSource?: LgpdConsentSource
  lgpdConsentBy?: number | null
  enrichmentStatus: EnrichmentStatus
  enrichmentScore: number | null
  enrichedAt: string | null
  createdAt: string
  updatedAt?: string
  status?: string
  funnelId?: number | null
  conversationOpenedAt?: string | null
  conversationClosedAt?: string | null
  totalFacts: number
  opportunity?: number
}

export interface IntelOverviewStats {
  totalLeads: number
  consentedLeads: number
  enrichedLeads: number
  totalFactsGlobal: number
  avgScore: number | null
}

export interface IntelFilterCounts {
  all: number
  enriched: number
  not_enriched: number
  consented: number
  no_lgpd: number
}

export type IntelStatusFilter =
  | 'all' | 'enriched' | 'not_enriched' | 'consented' | 'no_lgpd'
  | 'pending' | 'done' | 'partial' | 'running'

export type IntelOrderBy = 'recent' | 'opportunity' | 'score'

export interface IntelFilters {
  page?: number | undefined
  limit?: number | undefined
  status?: IntelStatusFilter | undefined
  lgpd?: 'true' | 'false' | undefined
  search?: string | undefined
  orderBy?: IntelOrderBy | undefined
}

export interface IntelOverviewResponse {
  leads: IntelLead[]
  pagination: { page: number; limit: number; total: number; totalPages: number }
  stats: IntelOverviewStats
  filterCounts: IntelFilterCounts
}

function buildQs(f: IntelFilters): string {
  const p = new URLSearchParams()
  if (f.page) p.set('page', String(f.page))
  if (f.limit) p.set('limit', String(f.limit))
  if (f.status && f.status !== 'all') p.set('status', f.status)
  if (f.lgpd) p.set('lgpd', f.lgpd)
  if (f.search) p.set('search', f.search)
  if (f.orderBy && f.orderBy !== 'recent') p.set('orderBy', f.orderBy)
  const qs = p.toString()
  return qs ? `?${qs}` : ''
}

export function useIntelOverview(filters: IntelFilters = {}) {
  return useQuery({
    queryKey: ['intel-overview', filters],
    queryFn: () => api.get<IntelOverviewResponse>(`/bychat/enrichment/overview${buildQs(filters)}`),
    staleTime: 30_000,
    refetchInterval: (q) => {
      // Quando há ao menos 1 lead com status 'running', faz refetch a cada 3s
      // até o status mudar — só toca o servidor enquanto há trabalho em andamento.
      const data = q.state.data
      const running = (data?.leads ?? []).some((l) => l.enrichmentStatus === 'running')
      return running ? 3000 : false
    },
  })
}

export interface IntelFact {
  id: number
  field: string
  value: string
  confidence: number | null
  fetchedAt: string
  status?: 'active' | 'disputed' | 'merged' | 'rejected' | 'stale'
}

export interface IntelLeadDetail {
  lead: {
    id: number
    nome: string | null
    empresa: string | null
    email: string | null
    whatsapp: string | null
    lgpdConsent: boolean
    lgpdConsentAt: string | null
    lgpdConsentSource?: LgpdConsentSource
    lgpdConsentBy?: number | null
    enrichmentStatus: EnrichmentStatus
    enrichmentScore: number | null
    enrichedAt: string | null
  }
  facts: IntelFact[]
  bySource: Record<string, IntelFact[]>
  totalFacts: number
}

export function useIntelLead(leadId: number | null, opts: { includeDisputed?: boolean } = {}) {
  return useQuery({
    queryKey: ['intel-lead', leadId, opts.includeDisputed ? 'with-disputed' : 'active-only'],
    queryFn: () => api.get<IntelLeadDetail>(`/bychat/leads/${leadId}/enrichment${opts.includeDisputed ? '?includeDisputed=1' : ''}`),
    enabled: leadId !== null,
    staleTime: 30_000,
    refetchInterval: (q) => {
      const data = q.state.data
      return data?.lead.enrichmentStatus === 'running' ? 2000 : false
    },
  })
}

export type ScanMode = 'quick' | 'full'

function tierForMode(mode?: ScanMode): 1 | 3 {
  return mode === 'quick' ? 1 : 3
}

export function useRunEnrichment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, sync, mode, force }: { id: number; sync?: boolean; mode?: ScanMode; force?: boolean }) => {
      const params = new URLSearchParams()
      if (sync) params.set('sync', '1')
      if (mode) params.set('maxTier', String(tierForMode(mode)))
      if (force) params.set('force', '1')
      const qs = params.toString()
      return api.post<{ ok: true; queued?: boolean }>(`/bychat/leads/${id}/enrichment/run${qs ? `?${qs}` : ''}`, {})
    },
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: ['intel-overview'] })
      void qc.invalidateQueries({ queryKey: ['intel-lead', vars.id] })
    },
  })
}

export function useBulkRunEnrichment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { leadIds: number[]; mode?: ScanMode; force?: boolean }) =>
      api.post<{ ok: true; enqueued: number; skipped: number }>('/bychat/leads/enrichment/bulk-run', {
        leadIds: input.leadIds,
        maxTier: tierForMode(input.mode),
        force: input.force ?? false,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['intel-overview'] })
    },
  })
}

export function useGrantLgpd() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, consent }: { id: number; consent: boolean }) =>
      api.post<{ ok: true }>(`/bychat/leads/${id}/lgpd`, { consent }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['intel-overview'] })
      void qc.invalidateQueries({ queryKey: ['intel-lead'] })
    },
  })
}

export function useBulkLgpd() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { leadIds: number[]; consent: boolean; runEnrichment?: boolean }) =>
      api.post<{ ok: true; updated: number; enqueued: number }>('/bychat/leads/lgpd/bulk', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['intel-overview'] })
    },
  })
}

export function useDeleteFact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ leadId, factId }: { leadId: number; factId: number }) =>
      api.delete<{ ok: true }>(`/bychat/leads/${leadId}/enrichment/${factId}`),
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: ['intel-lead', vars.leadId] })
      void qc.invalidateQueries({ queryKey: ['intel-overview'] })
    },
  })
}

export function useDisputeFact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ leadId, factId, reason, restore }: { leadId: number; factId: number; reason?: string; restore?: boolean }) =>
      api.post<{ ok: true; status: string }>(`/bychat/leads/${leadId}/enrichment/${factId}/dispute`, { reason, restore }),
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: ['intel-lead', vars.leadId] })
      void qc.invalidateQueries({ queryKey: ['intel-dossier', vars.leadId] })
      void qc.invalidateQueries({ queryKey: ['intel-overview'] })
    },
  })
}

export interface DossierIdentity {
  name?: string
  photo_url?: string
  bio?: string
  location?: string
  position?: string
}

export interface DossierSocial {
  platform: string
  url: string
  title?: string
  bio?: string
  confidence: number
}

export interface DossierCompany {
  name?: string
  legal_name?: string
  trade_name?: string
  cnpj?: string
  sector?: string
  website?: string
  city?: string
  state?: string
  industry?: string
  partners?: string[]
}

export interface DossierContactPhone {
  value: string
  type?: string
  region?: string
}

export interface DossierContact {
  phones: DossierContactPhone[]
  emails: string[]
  addresses: string[]
}

export interface DossierResponse {
  lead: {
    id: number
    nome: string | null
    empresa: string | null
    email: string | null
    whatsapp: string | null
    cidade: string | null
    segmento: string | null
    enrichmentScore: number | null
    enrichmentStatus: EnrichmentStatus
    enrichedAt: string | null
  }
  identity: DossierIdentity
  socials: DossierSocial[]
  company: DossierCompany
  contact: DossierContact
  iceBreakers: string[]
  approachMissingContext: string[]
  approachGeneratedAt: string | null
  approachReason?: string
  sources: { source: string; fieldsCount: number }[]
  totalFacts: number
}

export interface ApproachSuggestionsResponse {
  suggestions: string[]
  missingContext: string[]
  generatedAt: string | null
  provider?: string
  model?: string
  costUsd?: number
  reason?: string
}

export interface PromotionEntry {
  field: 'email' | 'empresa' | 'cidade'
  oldValue: string | null
  newValue: string
  source: string
  confidence: number
  revertedAt?: string
}

export interface PromotionsResponse {
  eventId: number | null
  at: string | null
  promotions: PromotionEntry[]
}

export function usePromotions(leadId: number | null) {
  return useQuery({
    queryKey: ['intel-promotions', leadId],
    queryFn: () => api.get<PromotionsResponse>(`/bychat/leads/${leadId}/enrichment/promotions`),
    enabled: leadId !== null,
    staleTime: 30_000,
  })
}

export function useRevertPromotion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ leadId, eventId, field }: { leadId: number; eventId: number; field: string }) =>
      api.post<{ ok: true }>(`/bychat/leads/${leadId}/enrichment/revert-promotion`, { eventId, field }),
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: ['intel-promotions', vars.leadId] })
      void qc.invalidateQueries({ queryKey: ['intel-lead', vars.leadId] })
      void qc.invalidateQueries({ queryKey: ['intel-overview'] })
      void qc.invalidateQueries({ queryKey: ['leads'] })
    },
  })
}

export interface AdminEnrichmentStats {
  providers: {
    source: string
    activeFacts: number
    disputedFacts: number
    avgConfidence: number | null
    trustRate: number
  }[]
  runsLast24h: {
    done: number
    partial: number
    failed: number
    totalErrors: number
    errorsByProvider: { provider: string; count: number }[]
  }
  topDisputedLeads: {
    leadId: number
    disputedCount: number
    nome: string | null
    empresa: string | null
  }[]
  dailyRuns: { day: string; count: number }[]
  lgpdAudit: {
    titular: number
    operatorOverride: number
    legacy: number
  }
}

export function useAdminEnrichmentStats(enabled = true) {
  return useQuery({
    queryKey: ['intel-admin-stats'],
    queryFn: () => api.get<AdminEnrichmentStats>('/bychat/enrichment/admin/stats'),
    enabled,
    staleTime: 30_000,
  })
}

export function useRerunStale() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<{ ok: true; enqueued: number }>('/bychat/enrichment/rerun-stale', {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['intel-overview'] })
      void qc.invalidateQueries({ queryKey: ['intel-admin-stats'] })
    },
  })
}

export function useDossier(leadId: number | null) {
  return useQuery({
    queryKey: ['intel-dossier', leadId],
    queryFn: () => api.get<DossierResponse>(`/bychat/leads/${leadId}/dossier`),
    enabled: leadId !== null,
    staleTime: 60_000,
  })
}

/** Gera/regenera as sugestões de abordagem por IA (botão "Gerar" na UI). */
export function useGenerateApproach() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (leadId: number) =>
      api.post<ApproachSuggestionsResponse>(`/bychat/leads/${leadId}/approach-suggestions`, {}),
    onSuccess: (_, leadId) => {
      void qc.invalidateQueries({ queryKey: ['intel-dossier', leadId] })
    },
  })
}

export interface Insight {
  id: string
  tone: 'success' | 'info' | 'warning' | 'neutral'
  icon: 'crown' | 'building' | 'users' | 'sparkles' | 'clock' | 'snowflake' | 'link'
  label: string
  detail: string
}

export function useInsights(leadId: number | null) {
  return useQuery({
    queryKey: ['intel-insights', leadId],
    queryFn: () => api.get<{ insights: Insight[] }>(`/bychat/leads/${leadId}/insights`),
    enabled: leadId !== null,
    staleTime: 60_000,
  })
}

// ── Identidade do Telefone (PIX/DICT) ──

export type PhoneIdentityProvider = 'mock' | 'custom_http' | 'celcoin'

export interface PhoneIdentityConfig {
  enabled: boolean
  provider: PhoneIdentityProvider
  endpoint: string
  tokenConfigured: boolean
  tokenMasked: string
  purpose: string
}

export interface PhoneIdentityInput {
  enabled: boolean
  provider: PhoneIdentityProvider
  endpoint: string
  token?: string | undefined
  purpose: string
}

export function usePhoneIdentityConfig() {
  return useQuery({
    queryKey: ['admin-phone-identity'],
    queryFn: () => api.get<PhoneIdentityConfig>('/admin/enrichment/phone-identity'),
    staleTime: 30_000,
  })
}

export function useUpdatePhoneIdentityConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: PhoneIdentityInput) =>
      api.put<{ ok: true }>('/admin/enrichment/phone-identity', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-phone-identity'] })
      void qc.invalidateQueries({ queryKey: ['admin-enrichment-stats'] })
    },
  })
}
