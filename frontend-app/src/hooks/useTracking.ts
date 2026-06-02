import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

// ─────────────────────────────────────────────────────────────────────────────
// Tipos

export interface TrackingOverview {
  totalVisitors: number
  identifiedVisitors: number
  linkedLeads: number
  totalSessions: number
  totalPageviews: number
  totalEvents: number
}

export interface TrackingVisitor {
  id: number
  visitorId: string
  identifiedName: string | null
  identifiedEmail: string | null
  identifiedPhone: string | null
  leadId: number | null
  totalPageviews: number
  totalSessions: number
  totalEvents?: number
  lastSeenAt: string
  firstSeenAt: string
  metadata: Record<string, unknown> | null
}

export interface TrackingSession {
  id: number
  sessionId: string
  visitorId: number
  entryUrl: string | null
  exitUrl: string | null
  referrer: string | null
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
  ip: string | null
  userAgent: string | null
  deviceType: string | null
  browser: string | null
  os: string | null
  pageviews: number
  events: number
  duration: number | null
  startedAt: string
  endedAt: string | null
}

export interface TrackingEvent {
  id: number
  visitorId: number
  sessionId: number | null
  type: string
  url: string | null
  title: string | null
  referrer: string | null
  data: Record<string, unknown> | null
  timestamp: string
  session?: { sessionId: string; ip: string | null; referrer: string | null } | null
}

export interface TrackingTopPage { url: string; views: number; visitors: number; lastSeen: string }
export interface TrackingTopReferrer { referrer: string; count: number }
export interface TrackingDeviceBreakdown { type: string; count: number }

export interface TrackingStatsResponse {
  period: { days: number; since: string }
  overview: TrackingOverview
  recentVisitors: TrackingVisitor[]
  topPages: TrackingTopPage[]
  topReferrers: TrackingTopReferrer[]
  deviceBreakdown: TrackingDeviceBreakdown[]
}

export interface TrackingVisitorsFilters {
  page?: number | undefined
  limit?: number | undefined
  search?: string | undefined
  identified?: 'true' | 'false' | undefined
  hasLead?: 'true' | 'false' | undefined
}

export interface VisitorDetail extends TrackingVisitor {
  sessions: TrackingSession[]
}

export interface MonitoredUrl {
  domain: string
  pageviews: number
  visitors: number
  lastSeen: string
}

export interface UrlValidationResult {
  url: string
  valid: boolean
  hasTrackingScript: boolean
  hasSnippetLoader: boolean
  hasBTObject: boolean
  scriptSrc: string | null
  errors: string[]
  warnings: string[]
  timestamp: string
  recentPageviews24h?: number
  totalSessions?: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Hooks

export function useTrackingStats(days = 30) {
  return useQuery({
    queryKey: ['tracking-stats', days],
    queryFn: () => api.get<TrackingStatsResponse>(`/tracking/stats?days=${days}`),
    staleTime: 60_000,
  })
}

// ─── Recent leads (Lead "puro" — não depende do pixel bt.js) ─────────

export interface RecentLeadItem {
  id: number
  nome: string
  email: string | null
  whatsapp: string | null
  status: string
  originType: string | null
  qualificationSource: string | null
  hasTrackedSession: boolean
  createdAt: string
  assignedUser: { id: number; name: string | null; email: string } | null
  team: { id: number; name: string } | null
  funnel: { id: number; name: string } | null
}

export interface RecentLeadsResponse {
  period: { days: number; since: string }
  coverage: { totalLeads: number; leadsWithTrackedSession: number; rate: number }
  leads: RecentLeadItem[]
}

export function useRecentLeads(days = 30, limit = 10) {
  return useQuery({
    queryKey: ['tracking-recent-leads', days, limit],
    queryFn: () => api.get<RecentLeadsResponse>(`/tracking/recent-leads?days=${days}&limit=${limit}`),
    staleTime: 60_000,
  })
}

export function useTrackingVisitors(filters: TrackingVisitorsFilters = {}) {
  const p = new URLSearchParams()
  if (filters.page) p.set('page', String(filters.page))
  if (filters.limit) p.set('limit', String(filters.limit))
  if (filters.search) p.set('search', filters.search)
  if (filters.identified) p.set('identified', filters.identified)
  if (filters.hasLead) p.set('hasLead', filters.hasLead)
  const qs = p.toString()
  return useQuery({
    queryKey: ['tracking-visitors', filters],
    queryFn: () =>
      api.get<{ visitors: TrackingVisitor[]; total: number; page: number; limit: number }>(
        `/tracking/visitors${qs ? `?${qs}` : ''}`,
      ),
    staleTime: 30_000,
  })
}

export function useTrackingVisitor(id: number | null) {
  return useQuery({
    queryKey: ['tracking-visitor', id],
    queryFn: () => api.get<VisitorDetail>(`/tracking/visitors/${id}`),
    enabled: id !== null,
    staleTime: 30_000,
  })
}

export function useTrackingTimeline(visitorId: number | null, limit = 100) {
  return useQuery({
    queryKey: ['tracking-timeline', visitorId, limit],
    queryFn: () =>
      api.get<{ events: TrackingEvent[] }>(`/tracking/visitors/${visitorId}/timeline?limit=${limit}`),
    enabled: visitorId !== null,
    staleTime: 30_000,
  })
}

export function useLinkVisitor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ visitorId, leadId }: { visitorId: number; leadId: number }) =>
      api.post<{ ok: true }>(`/tracking/visitors/${visitorId}/link`, { leadId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tracking-visitors'] })
      void qc.invalidateQueries({ queryKey: ['tracking-visitor'] })
    },
  })
}

export function useTrackingSnippet() {
  return useQuery({
    queryKey: ['tracking-snippet'],
    queryFn: () => api.get<{ snippet: string; baseUrl: string }>('/tracking/snippet'),
    staleTime: 5 * 60_000,
  })
}

export function useValidateTrackingUrl() {
  return useMutation({
    mutationFn: (url: string) =>
      api.post<UrlValidationResult>('/tracking/validate-url', { url }),
  })
}

export function useMonitoredUrls() {
  return useQuery({
    queryKey: ['tracking-monitored-urls'],
    queryFn: () => api.get<{ urls: MonitoredUrl[] }>('/tracking/monitored-urls'),
    staleTime: 5 * 60_000,
  })
}

export interface PageValidationResult {
  hasTracking: boolean
  hasTrackingScript?: boolean
  hasSnippetLoader?: boolean
  hasBTObject?: boolean
  scriptSrc?: string
  recentPageviews24h?: number
  totalSessions?: number
  error?: string
}

export function useValidateTrackingPages() {
  return useMutation({
    mutationFn: (urls: string[]) =>
      api.post<{ results: Record<string, PageValidationResult> }>('/tracking/validate-pages', { urls }),
  })
}
