import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/lib/apiClient'

/**
 * Detecta o 409 do guard de inscrições no portal de matrículas (delete individual
 * ou em lote). Retorna a contagem de inscrições que ficariam órfãs, ou null se o
 * erro for outro. Use para escalar a confirmação para o modo "apagar mesmo assim"
 * (que reenvia o delete com `force`).
 */
export function getRegistrationConflict(e: unknown): { count: number; leadIds?: number[] | undefined } | null {
  if (e instanceof ApiError && e.status === 409) {
    const p = e.payload as { error?: string; registrationCount?: number; leadIds?: number[] } | null
    if (p && (p.error === 'lead_has_registrations' || p.error === 'leads_have_registrations')) {
      return { count: p.registrationCount ?? 0, leadIds: p.leadIds }
    }
  }
  return null
}

export interface LeadTag {
  tag: { id: number; name: string; color: string }
}

export interface AiScoreReason {
  phase: 'provisional' | 'definitive' | 'manual'
  probability: number
  positives: string[]
  risks: string[]
  confidence: number
  summary: string
  resumoRespostas?: string
  provider: string
  model: string
  costUsd: number
  at: string
}

export interface LeadListItem {
  id: number
  uid: string | null
  empresa: string | null
  nome: string | null
  whatsapp: string | null
  email: string | null
  segmento: string | null
  cidade: string | null
  scores: Record<string, number> | null
  aiScore: number | null
  aiScoreLabel: string | null
  aiScoreReason: AiScoreReason | null
  aiScoredAt: string | null
  status: string | null
  // Rótulo humano da etapa (Stage.name) resolvido no backend por (funnelId, status).
  // Sempre preferir statusLabel na UI; status é a chave técnica (ex.: "kommo_143").
  statusLabel?: string | null
  source: string | null
  funnelId: number | null
  createdAt: string
  qualifiedAt: string | null
  qualificationSource: string | null
  funnel?: { id: number; name: string } | null
  tags?: LeadTag[]
  outcome?: 'won' | 'lost' | null
  outcomeAt?: string | null
  // Lead Routing F6: responsável e setor
  assignedUserId?: number | null
  assignedAt?: string | null
  assignedUser?: { id: number; name: string; email?: string } | null
  teamId?: number | null
  team?: { id: number; name: string; color?: string } | null
}

export interface LeadDetail extends LeadListItem {
  formData: Record<string, unknown> | null
  analysis: unknown
  annotation: string | null
  // Agendamento vigente do lead (módulo de Agendamento) — sincroniza automático.
  agendamento?: { startAt: string; endAt: string; status: string; timezone: string } | null
  metaFormId: string | null
  customFields: Record<string, unknown> | null
  updatedAt: string
  // Tracking / atribuição (Meta Ads, UTMs, etc)
  campaignId?: string | null
  campaignName?: string | null
  adsetId?: string | null
  adsetName?: string | null
  adId?: string | null
  adName?: string | null
  utmSource?: string | null
  utmMedium?: string | null
  utmCampaign?: string | null
  utmContent?: string | null
  utmTerm?: string | null
  metaPageId?: string | null
  metaPageName?: string | null
  trackingVisitorId?: string | null
  trackableLinkId?: number | null
  fbclid?: string | null
  gclid?: string | null
  ctwaClid?: string | null
  // Google Ads (ValueTrack + enriquecimento por gclid)
  googleCampaignId?: string | null
  googleCampaignName?: string | null
  googleAdGroupId?: string | null
  googleAdGroupName?: string | null
  googleAdId?: string | null
  googleKeyword?: string | null
  googleMatchType?: string | null
  googleNetwork?: string | null
  googleDevice?: string | null
  googleEnrichedAt?: string | null
  // Intelligence / LGPD
  lgpdConsent?: boolean
  lgpdConsentAt?: string | null
  enrichmentStatus?: string | null
  enrichmentScore?: number | null
  enrichedAt?: string | null
  // Vendas
  saleDetected?: boolean
  saleValue?: number | null
  saleDetectedAt?: string | null
  // Outcome (Fase 23)
  outcome?: 'won' | 'lost' | null
  outcomeAt?: string | null
  outcomeBy?: number | null
  outcomeNote?: string | null
  lostReasonId?: number | null
  lostReason?: { id: number; name: string; color: string | null } | null
  // Educational fields
  studentName?: string | null
  studentCpf?: string | null
  studentEmail?: string | null
}

export interface LeadsListResponse {
  leads: LeadListItem[]
  total: number
  limit: number
  offset: number
}

export type AiScoreLabel = 'hot' | 'warm' | 'cold'

export interface LeadsListFilters {
  search?: string | undefined
  status?: string | undefined
  funnelId?: number | undefined
  tagIds?: number[] | undefined
  // scoreMin/Max (do diagnóstico scores.geral) — DEPRECATED na UI nova; ainda
  // aceito pra back-compat de chamadas diretas via URL/API.
  scoreMin?: number | undefined
  scoreMax?: number | undefined
  // Filtro novo: Lead Score por IA (faixa qualitativa hot/warm/cold).
  aiScoreLabel?: AiScoreLabel | undefined
  dateFrom?: string | undefined
  dateTo?: string | undefined
  segmento?: string | undefined
  // Origem: single legado OU multi via sources[]
  source?: string | undefined
  sources?: string[] | undefined
  completed?: 'true' | 'false' | undefined
  stageKey?: string | undefined
  stageEnteredFrom?: string | undefined
  stageEnteredTo?: string | undefined
  limit?: number | undefined
  offset?: number | undefined
  includeUnqualified?: boolean | undefined
  onlyUnqualified?: boolean | undefined
  outcome?: 'open' | 'won' | 'lost' | 'classified' | undefined
  sortBy?: 'createdAt' | 'empresa' | 'nome' | 'status' | undefined
  sortDir?: 'asc' | 'desc' | undefined
  // Responsável: single legado OU multi via assignedUserIds[]
  assignedUserId?: number | 'me' | undefined
  assignedUserIds?: number[] | undefined
  onlyUnassigned?: boolean | undefined
}

function buildQuery(f: LeadsListFilters): string {
  const p = new URLSearchParams()
  if (f.search) p.set('search', f.search)
  if (f.status) p.set('status', f.status)
  if (f.funnelId !== undefined) p.set('funnelId', String(f.funnelId))
  if (f.tagIds && f.tagIds.length > 0) p.set('tagIds', f.tagIds.join(','))
  if (f.scoreMin !== undefined) p.set('scoreMin', String(f.scoreMin))
  if (f.scoreMax !== undefined) p.set('scoreMax', String(f.scoreMax))
  if (f.aiScoreLabel) p.set('aiScoreLabel', f.aiScoreLabel)
  if (f.dateFrom) p.set('dateFrom', f.dateFrom)
  if (f.dateTo) p.set('dateTo', f.dateTo)
  if (f.segmento) p.set('segmento', f.segmento)
  // sources (multi) tem precedência sobre source (legado single)
  if (f.sources && f.sources.length > 0) p.set('sources', f.sources.join(','))
  else if (f.source) p.set('source', f.source)
  if (f.completed) p.set('completed', f.completed)
  if (f.stageKey) p.set('stageKey', f.stageKey)
  if (f.stageEnteredFrom) p.set('stageEnteredFrom', f.stageEnteredFrom)
  if (f.stageEnteredTo) p.set('stageEnteredTo', f.stageEnteredTo)
  if (f.limit !== undefined) p.set('limit', String(f.limit))
  if (f.offset !== undefined) p.set('offset', String(f.offset))
  if (f.includeUnqualified) p.set('includeUnqualified', '1')
  if (f.onlyUnqualified) p.set('onlyUnqualified', '1')
  if (f.outcome) p.set('outcome', f.outcome)
  if (f.sortBy) p.set('sortBy', f.sortBy)
  if (f.sortDir) p.set('sortDir', f.sortDir)
  // assignedUserIds (multi) tem precedência sobre assignedUserId (legado/atalho 'me')
  if (f.assignedUserIds && f.assignedUserIds.length > 0) p.set('assignedUserIds', f.assignedUserIds.join(','))
  else if (f.assignedUserId !== undefined) p.set('assignedUserId', String(f.assignedUserId))
  if (f.onlyUnassigned) p.set('onlyUnassigned', '1')
  const qs = p.toString()
  return qs ? `?${qs}` : ''
}

export function useLeads(filters: LeadsListFilters = {}) {
  return useQuery({
    queryKey: ['leads', filters],
    queryFn: () => api.get<LeadsListResponse>(`/bychat/leads${buildQuery(filters)}`),
    staleTime: 15_000,
  })
}

export function useLead(id: number | null) {
  return useQuery({
    queryKey: ['lead', id],
    queryFn: () => api.get<LeadDetail>(`/bychat/leads/${id}`),
    enabled: id !== null,
    staleTime: 15_000,
  })
}

export interface LeadSourcesResponse {
  sources: { value: string | null; count: number }[]
}

export function useLeadSources() {
  return useQuery({
    queryKey: ['lead-sources'],
    queryFn: () => api.get<LeadSourcesResponse>('/bychat/leads/sources'),
    staleTime: 60_000,
  })
}

export interface ManualLeadInput {
  empresa?: string | undefined
  nome?: string | undefined
  whatsapp: string
  email?: string | undefined
  segmento?: string | undefined
  cidade?: string | undefined
  funnelId?: number | undefined
  status?: string | undefined
}

export function useCreateManualLead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: ManualLeadInput) =>
      api.post<{ ok: true; id: number }>('/bychat/leads/manual', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }),
  })
}

export function useUpdateLeadAnnotation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, annotation }: { id: number; annotation: string }) =>
      api.put<{ ok: true }>(`/bychat/leads/${id}/annotation`, { annotation }),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['leads'] })
      void qc.invalidateQueries({ queryKey: ['lead', vars.id] })
    },
  })
}

// Histórico de anotações (LeadNote). Substitui o single-value `lead.annotation`
// por uma lista append-only com autor + timestamp — todos os operadores veem
// tudo que foi registrado ao longo do tempo.
export interface LeadNote {
  id: number
  content: string
  createdAt: string
  userId: number | null
  userName: string | null
}

export function useLeadNotes(leadId: number | null) {
  return useQuery({
    queryKey: ['lead-notes', leadId],
    queryFn: () => api.get<{ notes: LeadNote[] }>(`/bychat/leads/${leadId}/notes`),
    enabled: leadId !== null,
    staleTime: 15_000,
  })
}

export function useCreateLeadNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, content }: { id: number; content: string }) =>
      api.post<{ note: LeadNote }>(`/bychat/leads/${id}/notes`, { content }),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['lead-notes', vars.id] })
      void qc.invalidateQueries({ queryKey: ['lead-history', vars.id] })
    },
  })
}

export function useDeleteLead() {
  const qc = useQueryClient()
  return useMutation({
    // Aceita id puro (uso legado) ou { id, force } — force ignora o guard de
    // inscrições no portal de matrículas (deixa-as órfãs).
    mutationFn: (input: number | { id: number; force?: boolean }) => {
      const id = typeof input === 'number' ? input : input.id
      const force = typeof input === 'number' ? false : !!input.force
      return api.delete(`/bychat/leads/${id}${force ? '?force=true' : ''}`)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }),
  })
}

export function useBulkUpdateLeadsStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ leadIds, status }: { leadIds: number[]; status: string }) =>
      api.put<{ ok: true; moved: number; total: number }>('/bychat/leads/bulk/status', { leadIds, status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }),
  })
}

export function useBulkDeleteLeads() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: number[] | { leadIds: number[]; force?: boolean }) => {
      const leadIds = Array.isArray(input) ? input : input.leadIds
      const force = Array.isArray(input) ? false : !!input.force
      return api.delete<{ ok: true; deleted: number }>(`/bychat/leads/bulk${force ? '?force=true' : ''}`, { body: { leadIds } })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }),
  })
}

export interface LeadHistoryEvent {
  id: number
  leadId: number
  type: string
  category: string
  title: string
  description: string | null
  channel: string | null
  actorType: string | null
  actorName: string | null
  oldValue: string | null
  newValue: string | null
  metadata: Record<string, unknown> | null
  createdAt: string
}

export interface LeadHistoryFilters {
  category?: string | undefined
  channel?: string | undefined
}

export function useLeadHistory(leadId: number | null, filters: LeadHistoryFilters = {}) {
  const qs = new URLSearchParams({ limit: '100' })
  if (filters.category) qs.set('category', filters.category)
  if (filters.channel) qs.set('channel', filters.channel)
  return useQuery({
    queryKey: ['lead-history', leadId, filters.category ?? null, filters.channel ?? null],
    queryFn: () => api.get<{ events: LeadHistoryEvent[]; total: number }>(`/leads/${leadId}/history?${qs.toString()}`),
    enabled: leadId !== null,
    staleTime: 15_000,
  })
}

export function useUpdateLeadStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      api.put<{ ok: true }>(`/bychat/leads/${id}/status`, { status }),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['leads'] })
      void qc.invalidateQueries({ queryKey: ['lead', vars.id] })
      void qc.invalidateQueries({ queryKey: ['lead-history', vars.id] })
    },
  })
}

export function useUpdateLeadCustomFields() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, fields }: { id: number; fields: Record<string, unknown> }) =>
      api.put<{ ok: true }>(`/leads/${id}/custom-fields`, fields),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['leads'] })
      void qc.invalidateQueries({ queryKey: ['lead', vars.id] })
    },
  })
}

// ── Duplicar (clone) lead ──────────────────────────────────────

export interface DuplicateLeadCopy {
  tags?: boolean
  annotation?: boolean
  formData?: boolean
  scores?: boolean
  analysis?: boolean
  customFields?: boolean
  activities?: boolean
  cadences?: boolean
}

export interface DuplicateLeadInput {
  id: number
  funnelId?: number | undefined
  stageKey?: string | undefined
  /** null = remover atribuição; undefined = herdar do original */
  assignedUserId?: number | null | undefined
  /** null = remover equipe; undefined = herdar do original */
  teamId?: number | null | undefined
  copy?: DuplicateLeadCopy | undefined
}

export function useDuplicateLead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: DuplicateLeadInput) =>
      api.post<{ ok: true; id: number }>(`/bychat/leads/${id}/duplicate`, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['leads'] })
      void qc.invalidateQueries({ queryKey: ['kanban'] })
    },
  })
}

// ── Send to kanban (single + bulk) ─────────────────────────────

export function useSendLeadsToKanban() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { leadIds: number[]; funnelId?: number | undefined; stageKey?: string | undefined }) =>
      api.put<{ ok: true; sent: number }>('/bychat/leads/send-to-kanban', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['leads'] })
      void qc.invalidateQueries({ queryKey: ['kanban'] })
    },
  })
}

// ── Tags por lead (single) ─────────────────────────────────────

export function useAddLeadTags() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ leadId, tagIds }: { leadId: number; tagIds: number[] }) =>
      api.post<{ ok: true; tags: { id: number; name: string; color: string }[] }>(`/leads/${leadId}/tags`, { tagIds }),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['leads'] })
      void qc.invalidateQueries({ queryKey: ['lead', vars.leadId] })
      void qc.invalidateQueries({ queryKey: ['ticket-info', vars.leadId] })
    },
  })
}

export function useRemoveLeadTag() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ leadId, tagId }: { leadId: number; tagId: number }) =>
      api.delete<{ ok: true }>(`/leads/${leadId}/tags/${tagId}`),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['leads'] })
      void qc.invalidateQueries({ queryKey: ['lead', vars.leadId] })
      void qc.invalidateQueries({ queryKey: ['ticket-info', vars.leadId] })
    },
  })
}

export function useBulkLeadTags() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { leadIds: number[]; tagIds: number[]; action: 'add' | 'remove' }) =>
      api.post<{ ok: true; affected: number }>('/leads/bulk/tags', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }),
  })
}

// ── Merge / duplicates ─────────────────────────────────────────

export interface DuplicateCandidate {
  id: number
  nome: string | null
  empresa: string | null
  whatsapp: string | null
  email: string | null
  status: string | null
  createdAt: string
  matchedBy: string[] // ['whatsapp','email',...]
}

export function useLeadDuplicates(leadId: number | null) {
  return useQuery({
    queryKey: ['lead-duplicates', leadId],
    queryFn: () =>
      api.get<{ duplicates: DuplicateCandidate[] }>(`/bychat/leads/${leadId}/duplicates`),
    enabled: leadId !== null,
    staleTime: 30_000,
  })
}

export function useMergeLeads() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { masterId: number; mergeIds: number[] }) =>
      api.post<{ ok: true; merged: number; masterId: number }>('/bychat/leads/merge', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['leads'] })
      void qc.invalidateQueries({ queryKey: ['lead-duplicates-groups'] })
      void qc.invalidateQueries({ queryKey: ['lead-duplicates-count'] })
    },
  })
}

// Fase 24: tela /app/leads/duplicates ───────────────────────────────────────

export interface DuplicateLeadSummary {
  id: number
  uid: string | null
  nome: string
  empresa: string
  whatsapp: string
  email: string
  status: string | null
  funnelId: number | null
  source: string | null
  originType: string | null
  campaignId: string | null
  campaignName: string | null
  utmSource: string | null
  utmCampaign: string | null
  createdAt: string
  duplicateFlaggedAt?: string | null
  duplicateMatchedBy?: 'whatsapp' | 'email' | null
  possibleDuplicateOfId?: number | null
  duplicateStatus?: string
  assignedUserId: number | null
  teamId: number | null
}

export interface DuplicateGroup {
  masterId: number
  master: DuplicateLeadSummary
  duplicates: DuplicateLeadSummary[]
  totalLeads: number
  latestFlaggedAt: string | null
}

export interface DuplicatesGroupsFilters {
  channel?: string | undefined
  matchedBy?: 'whatsapp' | 'email' | undefined
  funnelId?: number | undefined
}

export function useDuplicatesGroups(filters: DuplicatesGroupsFilters = {}) {
  const qs = new URLSearchParams()
  if (filters.channel) qs.set('channel', filters.channel)
  if (filters.matchedBy) qs.set('matchedBy', filters.matchedBy)
  if (filters.funnelId !== undefined) qs.set('funnelId', String(filters.funnelId))
  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  return useQuery({
    queryKey: ['lead-duplicates-groups', filters],
    queryFn: () => api.get<{ groups: DuplicateGroup[]; total: number }>(`/bychat/leads/duplicates/groups${suffix}`),
    staleTime: 30_000,
  })
}

export function useDuplicatesCount() {
  return useQuery({
    queryKey: ['lead-duplicates-count'],
    queryFn: () => api.get<{ count: number }>('/bychat/leads/duplicates/count'),
    staleTime: 60_000,
    refetchInterval: 60_000,
  })
}

export function useKeepDuplicatesSeparate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (masterId: number) =>
      api.post<{ ok: true; resolved: number }>(`/bychat/leads/duplicates/${masterId}/keep-separate`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['lead-duplicates-groups'] })
      void qc.invalidateQueries({ queryKey: ['lead-duplicates-count'] })
      void qc.invalidateQueries({ queryKey: ['leads'] })
    },
  })
}

// ── AI / actions ───────────────────────────────────────────────

export function useRunAiSentiment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      api.post<{ ok: true; sentiment: unknown }>(`/bychat/leads/${id}/ai-sentiment`),
    onSuccess: (_d, id) => {
      void qc.invalidateQueries({ queryKey: ['lead', id] })
      void qc.invalidateQueries({ queryKey: ['leads'] })
    },
  })
}

export function useResendLeadReport() {
  return useMutation({
    mutationFn: (id: number) =>
      api.post<{ ok: true }>(`/bychat/leads/${id}/send-report`),
  })
}

export interface AiScoreCalibration {
  scored: number
  buckets: { bucket: string; total: number; won: number; lost: number; open: number; winRate: number | null }[]
}

export function useAiScoreCalibration() {
  return useQuery({
    queryKey: ['ai-score-calibration'],
    queryFn: () => api.get<AiScoreCalibration>('/bychat/leads/ai-score/calibration'),
    staleTime: 5 * 60 * 1000,
  })
}

export function useRescoreLeadAi() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      api.post<{ ok: true; aiScore: number | null; aiScoreLabel: string | null; aiScoreReason: AiScoreReason | null; aiScoredAt: string | null }>(
        `/bychat/leads/${id}/ai-score`,
      ),
    onSuccess: (_d, id) => {
      void qc.invalidateQueries({ queryKey: ['lead', id] })
      void qc.invalidateQueries({ queryKey: ['leads'] })
    },
  })
}

export interface QualifyInput {
  id: number
  funnelId?: number
  stageKey?: string
}

export function useQualifyLead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: number | QualifyInput) => {
      const id = typeof input === 'number' ? input : input.id
      const body = typeof input === 'number' ? {} : { funnelId: input.funnelId, stageKey: input.stageKey }
      return api.post<{ ok: true; qualified: boolean; assignedToFunnel: boolean }>(`/bychat/leads/${id}/qualify`, body)
    },
    onSuccess: (_d, input) => {
      const id = typeof input === 'number' ? input : input.id
      void qc.invalidateQueries({ queryKey: ['lead', id] })
      void qc.invalidateQueries({ queryKey: ['leads'] })
      void qc.invalidateQueries({ queryKey: ['ticket-info', id] })
      void qc.invalidateQueries({ queryKey: ['tickets'] })
      void qc.invalidateQueries({ queryKey: ['kanban'] })
    },
  })
}

export interface BulkQualifyInput {
  leadIds: number[]
  funnelId?: number
  stageKey?: string
}

export interface BulkQualifyResult {
  ok: true
  qualified: number
  alreadyQualified: number
  failed: number
  total: number
}

export function useBulkQualifyLeads() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: BulkQualifyInput) =>
      api.post<BulkQualifyResult>('/bychat/leads/qualify-bulk', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['leads'] })
      void qc.invalidateQueries({ queryKey: ['tickets'] })
      void qc.invalidateQueries({ queryKey: ['kanban'] })
    },
  })
}

export function useUnqualifyLead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      api.post<{ ok: true }>(`/bychat/leads/${id}/unqualify`),
    onSuccess: (_d, id) => {
      void qc.invalidateQueries({ queryKey: ['lead', id] })
      void qc.invalidateQueries({ queryKey: ['leads'] })
      void qc.invalidateQueries({ queryKey: ['ticket-info', id] })
      void qc.invalidateQueries({ queryKey: ['tickets'] })
      void qc.invalidateQueries({ queryKey: ['kanban'] })
    },
  })
}

// ── Conversa: abrir / encerrar (atendimento ativo) ─────────────

export function useOpenConversation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      api.post<{ ok: true }>(`/bychat/leads/${id}/open-conversation`),
    onSuccess: (_d, id) => {
      void qc.invalidateQueries({ queryKey: ['lead', id] })
      void qc.invalidateQueries({ queryKey: ['leads'] })
      void qc.invalidateQueries({ queryKey: ['ticket-info', id] })
      void qc.invalidateQueries({ queryKey: ['tickets'] })
    },
  })
}

export function useCloseConversation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      api.post<{ ok: true }>(`/bychat/leads/${id}/close-conversation`),
    onSuccess: (_d, id) => {
      void qc.invalidateQueries({ queryKey: ['lead', id] })
      void qc.invalidateQueries({ queryKey: ['leads'] })
      void qc.invalidateQueries({ queryKey: ['ticket-info', id] })
      void qc.invalidateQueries({ queryKey: ['tickets'] })
    },
  })
}

// ── Editar dados do contato (PUT genérico /bychat/leads/:id) ───

export interface LeadContactInput {
  nome?: string | null | undefined
  empresa?: string | null | undefined
  whatsapp?: string | null | undefined
  email?: string | null | undefined
  segmento?: string | null | undefined
  cidade?: string | null | undefined
  maturidade?: string | null | undefined
  solucaoNome?: string | null | undefined
  annotation?: string | null | undefined
}

export function useUpdateLeadContact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...payload }: { id: number } & LeadContactInput) =>
      api.put<{ ok: true; lead: unknown }>(`/bychat/leads/${id}`, payload),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['lead', vars.id] })
      void qc.invalidateQueries({ queryKey: ['leads'] })
      void qc.invalidateQueries({ queryKey: ['ticket-info', vars.id] })
      void qc.invalidateQueries({ queryKey: ['tickets'] })
      void qc.invalidateQueries({ queryKey: ['lead-history', vars.id] })
    },
  })
}

// ── Histórico de atribuições (operator_assigned) ───────────────

export function useLeadTransferHistory(leadId: number | null) {
  return useQuery({
    queryKey: ['lead-transfer-history', leadId],
    queryFn: () =>
      api.get<{ events: LeadHistoryEvent[]; total: number }>(
        `/leads/${leadId}/history?type=operator_assigned&limit=20`,
      ),
    enabled: leadId !== null,
    staleTime: 30_000,
  })
}
