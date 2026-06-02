import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface TrackableLink {
  id: number
  slug: string
  name: string
  description: string | null
  whatsappPhone: string
  prefilledMessage: string | null
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
  utmContent: string | null
  utmTerm: string | null
  campaignId: string | null
  campaignName: string | null
  fbPixelId: string | null
  fbCapiAccessToken: string | null
  ga4MeasurementId: string | null
  redirectDelayMs: number
  active: boolean
  totalClicks: number
  uniqueClicks: number
  leadsGenerated: number
  totalSales: number
  totalRevenue: number
  createdAt: string
  updatedAt: string
}

export interface TrackableLinkClick {
  id: number
  linkId: number
  ip: string | null
  userAgent: string | null
  referer: string | null
  deviceType: string | null
  browser: string | null
  os: string | null
  fbclid: string | null
  gclid: string | null
  ctwaClid: string | null
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
  utmContent: string | null
  utmTerm: string | null
  capiSent: boolean
  createdAt: string
}

export interface TrackableLinkLead {
  id: number
  uid: string | null
  nome: string | null
  empresa: string | null
  whatsapp: string | null
  email: string | null
  status: string
  funnelId: number | null
  saleDetected: boolean
  saleValue: number | null
  saleDetectedAt: string | null
  source: string | null
  originType: string | null
  campaignName: string | null
  createdAt: string
  lastMessageAt: string | null
  funnel: { id: number; name: string } | null
  stageName: string
  stageColor: string | null
}

export interface TrackableLinksOverviewTopLink {
  id: number
  name: string
  slug: string
  totalClicks: number
  uniqueClicks: number
  leadsGenerated: number
  totalSales: number
  totalRevenue: number
  utmCampaign: string | null
}

export interface TrackableLinksOverview {
  totalLinks: number
  activeLinks: number
  totalClicks: number
  recentClicks: number
  topLinks: TrackableLinksOverviewTopLink[]
  totalSales: number
  totalRevenue: number
  totalLeadsGenerated: number
  clicksByDay: { date: string; clicks: number }[]
  deviceBreakdown: { deviceType: string; count: number }[]
}

export interface TrackableLinkInput {
  name: string
  whatsappPhone: string
  slug?: string | undefined
  description?: string | null | undefined
  prefilledMessage?: string | null | undefined
  utmSource?: string | null | undefined
  utmMedium?: string | null | undefined
  utmCampaign?: string | null | undefined
  utmContent?: string | null | undefined
  utmTerm?: string | null | undefined
  campaignId?: string | null | undefined
  campaignName?: string | null | undefined
  fbPixelId?: string | null | undefined
  fbCapiAccessToken?: string | null | undefined
  ga4MeasurementId?: string | null | undefined
  redirectDelayMs?: number | undefined
  active?: boolean | undefined
}

export function useTrackableLinks() {
  return useQuery({
    queryKey: ['trackable-links'],
    queryFn: () => api.get<{ links: TrackableLink[]; total: number; page: number; limit: number }>('/admin/trackable-links?limit=200'),
    staleTime: 60_000,
  })
}

export function useTrackableLink(id: number | null) {
  return useQuery({
    queryKey: ['trackable-link', id],
    queryFn: () => api.get<{ link: TrackableLink & { clicks: TrackableLinkClick[] } }>(`/admin/trackable-links/${id}`),
    enabled: id !== null,
    staleTime: 30_000,
  })
}

export function useTrackableLinkClicks(id: number | null, page = 1, limit = 50) {
  return useQuery({
    queryKey: ['trackable-link-clicks', id, page, limit],
    queryFn: () =>
      api.get<{ clicks: TrackableLinkClick[]; total: number; page: number; limit: number }>(
        `/admin/trackable-links/${id}/clicks?page=${page}&limit=${limit}`,
      ),
    enabled: id !== null,
    staleTime: 30_000,
  })
}

export function useTrackableLinkLeads(id: number | null) {
  return useQuery({
    queryKey: ['trackable-link-leads', id],
    queryFn: () =>
      api.get<{
        link: { id: number; slug: string; name: string; totalClicks: number; uniqueClicks: number; leadsGenerated: number; totalSales: number; totalRevenue: number } | null
        leads: TrackableLinkLead[]
        total: number
      }>(`/admin/trackable-links/${id}/leads?limit=100`),
    enabled: id !== null,
    staleTime: 30_000,
  })
}

export function useTrackableLinksOverview(days = 30) {
  return useQuery({
    queryKey: ['trackable-links-overview', days],
    queryFn: () => api.get<TrackableLinksOverview>(`/admin/trackable-links/stats/overview?days=${days}`),
    staleTime: 60_000,
  })
}

export function useCreateTrackableLink() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: TrackableLinkInput) => api.post<{ ok: true; link: TrackableLink }>('/admin/trackable-links', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trackable-links'] }),
  })
}

export function useUpdateTrackableLink() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: { id: number } & Partial<TrackableLinkInput>) =>
      api.put<{ ok: true; link: TrackableLink }>(`/admin/trackable-links/${id}`, input),
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: ['trackable-links'] })
      void qc.invalidateQueries({ queryKey: ['trackable-link', vars.id] })
    },
  })
}

export function useDeleteTrackableLink() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/admin/trackable-links/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trackable-links'] }),
  })
}
