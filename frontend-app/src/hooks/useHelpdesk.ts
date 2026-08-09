import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { periodQuery, type PeriodRange } from '@/components/ui/PeriodPicker'

export type TicketStatus = 'new' | 'open' | 'pending' | 'on_hold' | 'solved' | 'closed'
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent'
export type TicketType = 'question' | 'incident' | 'problem' | 'task'
export type TicketChannel = 'email' | 'web' | 'whatsapp' | 'chat' | 'api' | 'phone' | 'manual'

export interface Ticket {
  id: number
  number: number
  subject: string
  status: TicketStatus
  priority: TicketPriority
  type: TicketType
  channel: TicketChannel
  assignedUserId: number | null
  teamId: number | null
  requesterLeadId: number | null
  requesterName: string | null
  requesterEmail: string | null
  requesterPhone: string | null
  firstResponseAt: string | null
  solvedAt: string | null
  closedAt: string | null
  reopenCount: number
  lastActivityAt: string
  createdAt: string
  updatedAt: string
  tags?: number[] | null
  customFields?: Record<string, unknown> | null
  slaPolicyId?: number | null
  targetFirstResponseAt?: string | null
  targetResolutionAt?: string | null
  slaFirstResponseStatus?: SlaStatus | null
  slaResolutionStatus?: SlaStatus | null
  targetNextResponseAt?: string | null
  slaNextResponseStatus?: SlaStatus | null
  slaPausedAt?: string | null
  organizationId?: number | null
  isSpam?: boolean
}

export interface Organization { id: number; name: string; domains: string[]; supportPlan: string | null; slaPolicyId: number | null; notes: string | null; active: boolean; openTickets?: number }
export function useOrganizations() {
  return useQuery({ queryKey: ['helpdesk-orgs'], queryFn: () => api.get<{ organizations: Organization[] }>('/admin/helpdesk/organizations'), staleTime: 30_000 })
}
export function useSaveOrganization() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: ({ id, ...b }: Partial<Organization> & { id?: number }) => id ? api.put(`/admin/helpdesk/organizations/${id}`, b) : api.post('/admin/helpdesk/organizations', b), onSuccess: () => void qc.invalidateQueries({ queryKey: ['helpdesk-orgs'] }) })
}
export function useDeleteOrganization() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (id: number) => api.delete(`/admin/helpdesk/organizations/${id}`), onSuccess: () => void qc.invalidateQueries({ queryKey: ['helpdesk-orgs'] }) })
}

export type SlaStatus = 'pending' | 'met' | 'at_risk' | 'breached'

export interface SlaPolicy {
  id: number
  name: string
  order: number
  active: boolean
  conditions: { priorities?: string[]; channels?: string[]; types?: string[]; teamIds?: number[] }
  firstResponseMins: Record<string, number>
  resolutionMins: Record<string, number>
  nextResponseMins?: Record<string, number> | null
  useBusinessHours: boolean
  calendarId: number | null
}

export interface BusinessCalendar {
  id: number
  name: string
  timezone: string
  weekdayHours: Record<string, Array<{ start: string; end: string }>>
  holidays: string[]
}

export interface TicketComment {
  id: number
  ticketId: number
  authorType: 'agent' | 'requester' | 'system'
  authorUserId: number | null
  authorName: string | null
  visibility: 'public' | 'internal'
  channel: string | null
  body: string
  createdAt: string
}

export interface TicketEvent {
  id: number
  ticketId: number
  type: string
  userId: number | null
  userName: string | null
  actorType: string
  title: string
  oldValue: string | null
  newValue: string | null
  createdAt: string
}

export interface TicketFollower {
  id: number
  ticketId: number
  userId: number | null
  email: string | null
  name: string | null
  createdAt: string
}

export interface TicketAttachment {
  id: number
  ticketId: number
  commentId: number | null
  fileName: string
  fileSize: number
  mimeType: string
  url: string
  uploadedByName: string | null
  createdAt: string
}

export interface HelpdeskAgent {
  id: number
  name: string | null
  email: string
  role: string
  isAgent: boolean
}

export interface HelpdeskTeam {
  id: number
  name: string
  color: string | null
  slug: string | null
}

export interface HelpdeskCustomField {
  id: number
  key: string
  label: string
  type: string
  placeholder: string | null
  options: Array<{ label: string; value: string }> | null
  required: boolean
  description: string | null
}

export interface LeadSearchResult {
  id: number
  nome: string
  email: string
  whatsapp: string
  empresa: string
}

export interface TicketsListResponse {
  tickets: Ticket[]
  total: number
  counters: Record<string, number>
}

export interface TicketSurvey { rating: number | null; comment: string | null; respondedAt: string | null }
export interface TicketLink { id: number; type: string; number: number; subject: string; status: string }

export interface ConversationMessage {
  id: number
  fromMe: boolean
  body: string | null
  mediaType: string
  mediaUrl: string | null
  senderName: string | null
  ack: number
  timestamp: string
}

export interface TicketCall {
  id: number
  direction: string
  phone: string
  status: string
  durationSec: number | null
  recordingUrl: string | null
  userName: string | null
  startedAt: string
}

export interface TicketQa { score: number | null; tone: string | null; strengths: string[] | null; weaknesses: string[] | null; summary: string | null }

export interface TicketDetailResponse {
  ticket: Ticket
  comments: TicketComment[]
  events: TicketEvent[]
  followers: TicketFollower[]
  attachments: TicketAttachment[]
  survey?: TicketSurvey | null
  qa?: TicketQa | null
  links?: TicketLink[]
  conversation?: ConversationMessage[]
  calls?: TicketCall[]
}

export interface QaStats { range: string; reviewed: number; avg: number | null; byAgent: Array<{ agentUserId: number; name: string; avg: number; count: number }> }
export function useQaStats(period: PeriodRange) {
  const q = periodQuery(period)
  return useQuery({ queryKey: ['helpdesk-qa', q], queryFn: () => api.get<QaStats>(`/admin/helpdesk/qa/stats?${q}`), staleTime: 60_000 })
}

export interface CsatStats {
  range: string
  sent: number
  responded: number
  responseRate: number
  avg: number | null
  csatPct: number | null
  distribution: Array<{ rating: number; count: number }>
  byAgent: Array<{ agentUserId: number | null; name: string; avg: number | null; count: number }>
  recentComments: Array<{ rating: number | null; comment: string | null; respondedAt: string | null; ticketId: number }>
}
export interface ReportData {
  range: string
  volume: { created: number; solved: number; backlog: number; reopened: number; capped: boolean }
  byStatus: Array<{ key: string; count: number }>
  byPriority: Array<{ key: string; count: number }>
  byChannel: Array<{ key: string; count: number }>
  byType: Array<{ key: string; count: number }>
  sla: { frMet: number; frBreached: number; frPct: number | null; resMet: number; resBreached: number; resPct: number | null }
  times: { avgFirstResponseMins: number | null; avgResolutionMins: number | null }
  byAgent: Array<{ agentUserId: number; name: string; assigned: number; solved: number; avgResolutionMins: number | null; reopened: number; csatAvg: number | null }>
  trend: Array<{ date: string; created: number; solved: number }>
}
export function useReports(period: PeriodRange) {
  const q = periodQuery(period)
  return useQuery({ queryKey: ['helpdesk-reports', q], queryFn: () => api.get<ReportData>(`/admin/helpdesk/reports?${q}`), staleTime: 60_000 })
}

export function useCsatStats(period: PeriodRange) {
  const q = periodQuery(period)
  return useQuery({ queryKey: ['helpdesk-csat', q], queryFn: () => api.get<CsatStats>(`/admin/helpdesk/csat/stats?${q}`), staleTime: 60_000 })
}

export interface TicketFilters {
  status?: string | undefined
  priority?: string | undefined
  assignedUserId?: string | undefined
  q?: string | undefined
  spam?: boolean | undefined
  limit?: number | undefined
  offset?: number | undefined
}

function buildQuery(f: TicketFilters): string {
  const p = new URLSearchParams()
  if (f.status) p.set('status', f.status)
  if (f.priority) p.set('priority', f.priority)
  if (f.assignedUserId) p.set('assignedUserId', f.assignedUserId)
  if (f.q) p.set('q', f.q)
  if (f.spam) p.set('spam', '1')
  if (f.limit !== undefined) p.set('limit', String(f.limit))
  if (f.offset !== undefined) p.set('offset', String(f.offset))
  const qs = p.toString()
  return qs ? `?${qs}` : ''
}

export function useHelpdeskMeta() {
  return useQuery({
    queryKey: ['helpdesk-meta'],
    queryFn: () =>
      api.get<{ statuses: TicketStatus[]; priorities: TicketPriority[]; types: TicketType[]; channels: TicketChannel[] }>(
        '/helpdesk/meta',
      ),
    staleTime: 5 * 60_000,
  })
}

export function useTickets(filters: TicketFilters = {}) {
  return useQuery({
    queryKey: ['helpdesk-tickets', filters],
    queryFn: () => api.get<TicketsListResponse>(`/helpdesk/tickets${buildQuery(filters)}`),
    staleTime: 5_000,
    refetchInterval: 20_000,
  })
}

export function useTicket(id: number | null) {
  return useQuery({
    queryKey: ['helpdesk-ticket', id],
    queryFn: () => api.get<TicketDetailResponse>(`/helpdesk/tickets/${id}`),
    enabled: id !== null,
    staleTime: 3_000,
    refetchInterval: id !== null ? 15_000 : false,
  })
}

export function useAgents() {
  return useQuery({ queryKey: ['helpdesk-agents'], queryFn: () => api.get<{ agents: HelpdeskAgent[] }>('/helpdesk/agents'), staleTime: 5 * 60_000 })
}
export function useTeams() {
  return useQuery({ queryKey: ['helpdesk-teams'], queryFn: () => api.get<{ teams: HelpdeskTeam[] }>('/helpdesk/teams'), staleTime: 5 * 60_000 })
}
export function useHelpdeskCustomFields() {
  return useQuery({ queryKey: ['helpdesk-cfields'], queryFn: () => api.get<{ fields: HelpdeskCustomField[] }>('/helpdesk/custom-fields'), staleTime: 5 * 60_000 })
}
export interface HelpdeskTag { id: number; name: string; color: string }
export function useTagsCatalog() {
  return useQuery({ queryKey: ['helpdesk-tags-catalog'], queryFn: () => api.get<{ tags: HelpdeskTag[] }>('/helpdesk/tags-catalog'), staleTime: 5 * 60_000 })
}

export interface CreateTicketInput {
  subject: string
  description?: string
  priority?: TicketPriority
  type?: TicketType
  channel?: TicketChannel
  requesterName?: string
  requesterEmail?: string
  requesterPhone?: string
}

export function useCreateTicket() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateTicketInput) => api.post<{ ticket: Ticket }>('/helpdesk/tickets', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['helpdesk-tickets'] }),
  })
}

export function useUpdateTicket() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: number } & Partial<Ticket>) =>
      api.patch<{ ticket: Ticket }>(`/helpdesk/tickets/${id}`, patch),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['helpdesk-tickets'] })
      void qc.invalidateQueries({ queryKey: ['helpdesk-ticket', vars.id] })
    },
  })
}

export function useAddComment(ticketId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { body: string; visibility?: 'public' | 'internal' }) =>
      api.post<{ comment: TicketComment }>(`/helpdesk/tickets/${ticketId}/comments`, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['helpdesk-ticket', ticketId] })
      void qc.invalidateQueries({ queryKey: ['helpdesk-tickets'] })
    },
  })
}

/** Hook agregador de ações sobre um ticket (atribuição, requester, followers, tags, anexos). */
export function useTicketActions(ticketId: number) {
  const qc = useQueryClient()
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['helpdesk-ticket', ticketId] })
    void qc.invalidateQueries({ queryKey: ['helpdesk-tickets'] })
  }
  return {
    claim: useMutation({ mutationFn: () => api.post(`/helpdesk/tickets/${ticketId}/claim`), onSuccess: invalidate }),
    release: useMutation({ mutationFn: () => api.post(`/helpdesk/tickets/${ticketId}/release`), onSuccess: invalidate }),
    assign: useMutation({
      mutationFn: (input: { userId?: number | null; teamId?: number | null }) =>
        api.post(`/helpdesk/tickets/${ticketId}/assign`, input),
      onSuccess: invalidate,
    }),
    setRequester: useMutation({
      mutationFn: (input: { leadId?: number; requesterName?: string; requesterEmail?: string; requesterPhone?: string }) =>
        api.post(`/helpdesk/tickets/${ticketId}/requester`, input),
      onSuccess: invalidate,
    }),
    unlinkLead: useMutation({ mutationFn: () => api.delete(`/helpdesk/tickets/${ticketId}/requester`), onSuccess: invalidate }),
    addFollower: useMutation({
      mutationFn: (input: { userId?: number; email?: string; name?: string }) =>
        api.post(`/helpdesk/tickets/${ticketId}/followers`, input),
      onSuccess: invalidate,
    }),
    removeFollower: useMutation({ mutationFn: (fid: number) => api.delete(`/helpdesk/tickets/${ticketId}/followers/${fid}`), onSuccess: invalidate }),
    // Self-follow (F25) — disponível ao agente colaborador (só 'view').
    follow: useMutation({ mutationFn: () => api.post(`/helpdesk/tickets/${ticketId}/follow`, {}), onSuccess: invalidate }),
    unfollow: useMutation({ mutationFn: () => api.delete(`/helpdesk/tickets/${ticketId}/follow`), onSuccess: invalidate }),
    setTags: useMutation({ mutationFn: (tagIds: number[]) => api.post(`/helpdesk/tickets/${ticketId}/tags`, { tagIds }), onSuccess: invalidate }),
    setCustomFields: useMutation({ mutationFn: (customFields: Record<string, unknown>) => api.patch(`/helpdesk/tickets/${ticketId}`, { customFields }), onSuccess: invalidate }),
    uploadAttachment: useMutation({
      mutationFn: (file: File) => {
        const fd = new FormData()
        fd.append('file', file)
        return api.post(`/helpdesk/tickets/${ticketId}/attachments`, fd)
      },
      onSuccess: invalidate,
    }),
    deleteAttachment: useMutation({ mutationFn: (aid: number) => api.delete(`/helpdesk/tickets/${ticketId}/attachments/${aid}`), onSuccess: invalidate }),
    addLink: useMutation({ mutationFn: (input: { targetNumber: number; type: string }) => api.post(`/helpdesk/tickets/${ticketId}/links`, input), onSuccess: invalidate }),
    removeLink: useMutation({ mutationFn: (linkId: number) => api.delete(`/helpdesk/tickets/${ticketId}/links/${linkId}`), onSuccess: invalidate }),
    merge: useMutation({ mutationFn: (intoNumber: number) => api.post(`/helpdesk/tickets/${ticketId}/merge`, { intoNumber }), onSuccess: invalidate }),
    followUp: useMutation({ mutationFn: (input: { subject?: string } = {}) => api.post<{ number: number; id: number }>(`/helpdesk/tickets/${ticketId}/follow-up`, input), onSuccess: invalidate }),
    resolveIncidents: useMutation({ mutationFn: () => api.post<{ resolved: number }>(`/helpdesk/tickets/${ticketId}/resolve-incidents`), onSuccess: invalidate }),
    markSpam: useMutation({ mutationFn: (value: boolean) => api.post(`/helpdesk/tickets/${ticketId}/spam`, { value }), onSuccess: invalidate }),
    call: useMutation({ mutationFn: () => api.post<{ ok: boolean }>(`/helpdesk/tickets/${ticketId}/call`), onSuccess: invalidate }),
  }
}

export function searchLeads(q: string) {
  return api.get<{ leads: LeadSearchResult[] }>(`/helpdesk/leads/search?q=${encodeURIComponent(q)}`)
}

export interface AiTriage { priority: string; type: string; sentiment: string; summary: string }
export function useAiStatus() {
  return useQuery({ queryKey: ['helpdesk-ai-status'], queryFn: () => api.get<{ configured: boolean }>('/helpdesk/ai/status'), staleTime: 5 * 60_000 })
}
export function useTicketAi(ticketId: number) {
  const qc = useQueryClient()
  const inval = () => { void qc.invalidateQueries({ queryKey: ['helpdesk-ticket', ticketId] }); void qc.invalidateQueries({ queryKey: ['helpdesk-tickets'] }) }
  return {
    triage: useMutation({ mutationFn: () => api.post<AiTriage>(`/helpdesk/tickets/${ticketId}/ai/triage`) }),
    suggestReply: useMutation({ mutationFn: () => api.post<{ reply: string }>(`/helpdesk/tickets/${ticketId}/ai/suggest-reply`) }),
    summarize: useMutation({ mutationFn: () => api.post<{ summary: string }>(`/helpdesk/tickets/${ticketId}/ai/summarize`) }),
    triageApply: useMutation({ mutationFn: () => api.post<{ applied: { priority: string; type: string }; sentiment: string; summary: string }>(`/helpdesk/tickets/${ticketId}/ai/triage-apply`), onSuccess: inval }),
    suggestMacro: useMutation({ mutationFn: () => api.post<{ macroId: number | null; name: string | null; reason: string }>(`/helpdesk/tickets/${ticketId}/ai/suggest-macro`) }),
    rewrite: useMutation({ mutationFn: (input: { text: string; mode: string }) => api.post<{ text: string }>(`/helpdesk/ai/rewrite`, input) }),
    qa: useMutation({ mutationFn: () => api.post<{ review: TicketQa }>(`/helpdesk/tickets/${ticketId}/qa`), onSuccess: inval }),
  }
}

export type BulkAction = 'status' | 'priority' | 'assign' | 'team' | 'tag' | 'delete' | 'spam'
export function useBulkAction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { ids: number[]; action: BulkAction; value?: string | number | null }) =>
      api.post<{ updated: number; skipped: number[] }>('/helpdesk/tickets/bulk', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['helpdesk-tickets'] }),
  })
}

export interface HelpdeskSettings { defaultTeamId: number | null; inboundEmailConfigured: boolean; autoAssign?: boolean; notifyAgents?: boolean }
export function useHelpdeskSettings() {
  return useQuery({ queryKey: ['helpdesk-settings'], queryFn: () => api.get<HelpdeskSettings>('/admin/helpdesk/settings'), staleTime: 60_000 })
}
export function useSaveHelpdeskSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { defaultTeamId?: number | null; regenerateInboundSecret?: boolean; autoAssign?: boolean; notifyAgents?: boolean }) =>
      api.post<{ ok: boolean; inboundEmailSecret?: string }>('/admin/helpdesk/settings', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['helpdesk-settings'] }),
  })
}

export interface KbCategory { id: number; name: string; slug: string; description: string | null; position: number; active: boolean; _count?: { articles: number } }
export interface KbArticle {
  id: number; categoryId: number | null; title: string; slug: string; excerpt: string | null; body: string
  keywords: string | null; status: 'draft' | 'published'; visibility: 'public' | 'internal'; locale: string
  votesUp: number; votesDown: number; viewCount: number; publishedAt: string | null; updatedAt: string
}
export interface KbSuggestion { id: number; title: string; slug: string; excerpt: string | null }

export function useKbCategories() {
  return useQuery({ queryKey: ['kb-categories'], queryFn: () => api.get<{ categories: KbCategory[] }>('/admin/helpdesk/kb/categories'), staleTime: 30_000 })
}
export function useSaveKbCategory() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: ({ id, ...b }: Partial<KbCategory> & { id?: number }) => id ? api.put(`/admin/helpdesk/kb/categories/${id}`, b) : api.post('/admin/helpdesk/kb/categories', b), onSuccess: () => void qc.invalidateQueries({ queryKey: ['kb-categories'] }) })
}
export function useDeleteKbCategory() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (id: number) => api.delete(`/admin/helpdesk/kb/categories/${id}`), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['kb-categories'] }); void qc.invalidateQueries({ queryKey: ['kb-articles'] }) } })
}
export function useKbArticles(filters: { status?: string; q?: string } = {}) {
  return useQuery({
    queryKey: ['kb-articles', filters],
    queryFn: () => { const p = new URLSearchParams(); if (filters.status) p.set('status', filters.status); if (filters.q) p.set('q', filters.q); const qs = p.toString(); return api.get<{ articles: KbArticle[] }>(`/admin/helpdesk/kb/articles${qs ? `?${qs}` : ''}`) },
    staleTime: 15_000,
  })
}
export function useSaveKbArticle() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: ({ id, ...b }: Partial<KbArticle> & { id?: number }) => id ? api.put(`/admin/helpdesk/kb/articles/${id}`, b) : api.post('/admin/helpdesk/kb/articles', b), onSuccess: () => void qc.invalidateQueries({ queryKey: ['kb-articles'] }) })
}
export function useDeleteKbArticle() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (id: number) => api.delete(`/admin/helpdesk/kb/articles/${id}`), onSuccess: () => void qc.invalidateQueries({ queryKey: ['kb-articles'] }) })
}
export function useKbSuggest(term: string) {
  return useQuery({
    queryKey: ['kb-suggest', term],
    queryFn: () => api.get<{ articles: KbSuggestion[] }>(`/helpdesk/kb/suggest?q=${encodeURIComponent(term)}`),
    enabled: term.trim().length >= 3,
    staleTime: 10_000,
  })
}

export interface TicketActions {
  setStatus?: string
  setPriority?: string
  setType?: string
  assignUserId?: number | null
  teamId?: number | null
  addTagIds?: number[]
}
export interface Macro { id: number; name: string; actions: TicketActions; replyTemplate: string | null; active: boolean; usageCount: number }
export interface Trigger { id: number; name: string; event: string; conditions: Record<string, unknown>; actions: TicketActions; active: boolean; order: number; runCount: number }
export interface Automation { id: number; name: string; conditions: Record<string, unknown>; actions: TicketActions; active: boolean; runCount: number }

export function useMacros() {
  return useQuery({ queryKey: ['helpdesk-macros'], queryFn: () => api.get<{ macros: Macro[] }>('/admin/helpdesk/macros'), staleTime: 30_000 })
}
export function useSaveMacro() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: ({ id, ...b }: Partial<Macro> & { id?: number }) => id ? api.put(`/admin/helpdesk/macros/${id}`, b) : api.post('/admin/helpdesk/macros', b), onSuccess: () => void qc.invalidateQueries({ queryKey: ['helpdesk-macros'] }) })
}
export function useDeleteMacro() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (id: number) => api.delete(`/admin/helpdesk/macros/${id}`), onSuccess: () => void qc.invalidateQueries({ queryKey: ['helpdesk-macros'] }) })
}
export function useApplyMacro(ticketId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (macroId: number) => api.post<{ replyText: string }>(`/helpdesk/tickets/${ticketId}/apply-macro`, { macroId }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['helpdesk-ticket', ticketId] }); void qc.invalidateQueries({ queryKey: ['helpdesk-tickets'] }) },
  })
}

export function useTriggers() {
  return useQuery({ queryKey: ['helpdesk-triggers'], queryFn: () => api.get<{ triggers: Trigger[] }>('/admin/helpdesk/triggers'), staleTime: 30_000 })
}
export function useSaveTrigger() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: ({ id, ...b }: Partial<Trigger> & { id?: number }) => id ? api.put(`/admin/helpdesk/triggers/${id}`, b) : api.post('/admin/helpdesk/triggers', b), onSuccess: () => void qc.invalidateQueries({ queryKey: ['helpdesk-triggers'] }) })
}
export function useDeleteTrigger() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (id: number) => api.delete(`/admin/helpdesk/triggers/${id}`), onSuccess: () => void qc.invalidateQueries({ queryKey: ['helpdesk-triggers'] }) })
}

export function useAutomations() {
  return useQuery({ queryKey: ['helpdesk-automations'], queryFn: () => api.get<{ automations: Automation[] }>('/admin/helpdesk/automations'), staleTime: 30_000 })
}
export function useSaveAutomation() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: ({ id, ...b }: Partial<Automation> & { id?: number }) => id ? api.put(`/admin/helpdesk/automations/${id}`, b) : api.post('/admin/helpdesk/automations', b), onSuccess: () => void qc.invalidateQueries({ queryKey: ['helpdesk-automations'] }) })
}
export function useDeleteAutomation() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (id: number) => api.delete(`/admin/helpdesk/automations/${id}`), onSuccess: () => void qc.invalidateQueries({ queryKey: ['helpdesk-automations'] }) })
}

export function useSlaPolicies() {
  return useQuery({ queryKey: ['helpdesk-sla-policies'], queryFn: () => api.get<{ policies: SlaPolicy[] }>('/admin/helpdesk/sla-policies'), staleTime: 30_000 })
}
export function useCalendars() {
  return useQuery({ queryKey: ['helpdesk-calendars'], queryFn: () => api.get<{ calendars: BusinessCalendar[] }>('/admin/helpdesk/calendars'), staleTime: 30_000 })
}
export function useSavePolicy() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<SlaPolicy> & { id?: number }) =>
      id ? api.put(`/admin/helpdesk/sla-policies/${id}`, body) : api.post('/admin/helpdesk/sla-policies', body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['helpdesk-sla-policies'] }),
  })
}
export function useDeletePolicy() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (id: number) => api.delete(`/admin/helpdesk/sla-policies/${id}`), onSuccess: () => void qc.invalidateQueries({ queryKey: ['helpdesk-sla-policies'] }) })
}
export function useCreateCalendar() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (body: Partial<BusinessCalendar>) => api.post('/admin/helpdesk/calendars', body), onSuccess: () => void qc.invalidateQueries({ queryKey: ['helpdesk-calendars'] }) })
}

/** Presença/colisão: heartbeat a cada 12s, retorna outros agentes vendo o ticket. */
export function usePresence(id: number | null) {
  return useQuery({
    queryKey: ['helpdesk-presence', id],
    queryFn: () => api.post<{ viewers: Array<{ userId: number; name: string }> }>(`/helpdesk/tickets/${id}/presence`),
    enabled: id !== null,
    refetchInterval: id !== null ? 12_000 : false,
    staleTime: 0,
    gcTime: 0,
  })
}

// ──────────────────────────── Conversas paralelas / Side conversations (F27) ────────────────────────────

export interface SideMessage { id: number; direction: 'outbound' | 'inbound'; authorName: string | null; body: string; createdAt: string }
export interface SideConversation {
  id: number; ticketId: number; channel: 'email' | 'whatsapp'
  targetName: string | null; targetEmail: string | null; targetPhone: string | null
  subject: string | null; status: 'open' | 'closed'; createdByName: string | null; lastActivityAt: string
  messages: SideMessage[]
}

export function useSideConversations(ticketId: number) {
  return useQuery({
    queryKey: ['helpdesk-side', ticketId],
    queryFn: () => api.get<{ conversations: SideConversation[] }>(`/helpdesk/tickets/${ticketId}/side-conversations`),
    staleTime: 5_000,
  })
}

export function useSideConversationActions(ticketId: number) {
  const qc = useQueryClient()
  const invalidate = () => { void qc.invalidateQueries({ queryKey: ['helpdesk-side', ticketId] }); void qc.invalidateQueries({ queryKey: ['helpdesk-ticket', ticketId] }) }
  return {
    create: useMutation({ mutationFn: (b: { channel: string; targetName?: string; targetEmail?: string; targetPhone?: string; subject?: string; body: string }) => api.post(`/helpdesk/tickets/${ticketId}/side-conversations`, b), onSuccess: invalidate }),
    send: useMutation({ mutationFn: ({ scid, body }: { scid: number; body: string }) => api.post(`/helpdesk/tickets/${ticketId}/side-conversations/${scid}/messages`, { body }), onSuccess: invalidate }),
    inbound: useMutation({ mutationFn: ({ scid, body }: { scid: number; body: string }) => api.post(`/helpdesk/tickets/${ticketId}/side-conversations/${scid}/inbound`, { body }), onSuccess: invalidate }),
    close: useMutation({ mutationFn: (scid: number) => api.post(`/helpdesk/tickets/${ticketId}/side-conversations/${scid}/close`, {}), onSuccess: invalidate }),
  }
}

// ──────────────────────────── Importador Zendesk/Freshdesk (F26) ────────────────────────────

export interface ImportCounts { organizations: number; tickets: number; comments: number; kbCategories: number; kbArticles: number; macros: number }
export interface ImportReport {
  source: string; dryRun: boolean
  organizations: { create: number; skip: number }
  kbCategories: { create: number; skip: number }
  kbArticles: { create: number; skip: number }
  macros: { create: number; skip: number }
  tickets: { create: number; skip: number; comments: number }
  errors: string[]
}
export interface ImportResult { report: ImportReport; counts: ImportCounts }

export function useImportUpload() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { source: 'zendesk' | 'freshdesk'; data: unknown; dryRun: boolean }) =>
      api.post<ImportResult>('/admin/helpdesk/import/upload', input),
    onSuccess: (r) => { if (!r.report.dryRun) { void qc.invalidateQueries({ queryKey: ['helpdesk-tickets'] }); void qc.invalidateQueries({ queryKey: ['helpdesk-orgs'] }) } },
  })
}

export function useImportRemote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { source: 'zendesk' | 'freshdesk'; credentials: Record<string, string>; dryRun: boolean }) =>
      api.post<ImportResult>('/admin/helpdesk/import/remote', input),
    onSuccess: (r) => { if (!r.report.dryRun) { void qc.invalidateQueries({ queryKey: ['helpdesk-tickets'] }); void qc.invalidateQueries({ queryKey: ['helpdesk-orgs'] }) } },
  })
}
