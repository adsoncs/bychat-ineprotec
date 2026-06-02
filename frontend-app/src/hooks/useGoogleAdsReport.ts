import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface GoogleAdsReportFilters {
  dateFrom?: string | undefined
  dateTo?: string | undefined
  customerId?: string | undefined
  campaignId?: string | undefined
}

export interface GoogleAdsKpis {
  totalSpend: number
  totalClicks: number
  totalImpressions: number
  totalConversions: number
  totalLeads: number
  totalSales: number
  totalRevenue: number
  roas: number
  roi: number
  cpl: number
  cpc: number
}

export interface GoogleAdsBreakdownRow {
  key: string
  campaignId: string
  campaignName: string
  adGroupId?: string | null
  adGroupName?: string | null
  adId?: string | null
  adName?: string | null
  spend: number
  impressions: number
  clicks: number
  conversions: number
  conversionValue: number
  days: number
}

export interface GoogleAdsDailyPoint {
  date: string
  spend: number
  clicks: number
  impressions: number
  conversions: number
}

export interface GoogleAdsDashboardResponse {
  dateRange: { from: string; to: string }
  kpis: GoogleAdsKpis
  campaigns: GoogleAdsBreakdownRow[]
  adGroups: GoogleAdsBreakdownRow[]
  ads: GoogleAdsBreakdownRow[]
  daily: GoogleAdsDailyPoint[]
}

function buildQs(f: GoogleAdsReportFilters): string {
  const p = new URLSearchParams()
  if (f.dateFrom) p.set('dateFrom', f.dateFrom)
  if (f.dateTo) p.set('dateTo', f.dateTo)
  if (f.customerId) p.set('customerId', f.customerId)
  if (f.campaignId) p.set('campaignId', f.campaignId)
  const s = p.toString()
  return s ? `?${s}` : ''
}

export function useGoogleAdsReportDashboard(filters: GoogleAdsReportFilters) {
  return useQuery({
    queryKey: ['google-ads-report', filters],
    queryFn: () => api.get<GoogleAdsDashboardResponse>(`/admin/google-ads-report/dashboard${buildQs(filters)}`),
    staleTime: 30_000,
  })
}

export interface GoogleAdsCampaignRow {
  campaignId: string
  campaignName: string
  customerId: string
}

export function useGoogleAdsReportCampaigns() {
  return useQuery({
    queryKey: ['google-ads-report-campaigns'],
    queryFn: () => api.get<{ data: GoogleAdsCampaignRow[] }>('/admin/google-ads-report/campaigns'),
    staleTime: 5 * 60_000,
  })
}

export interface SyncInput {
  customerId: string
  dateFrom?: string | undefined
  dateTo?: string | undefined
}

export interface SyncSummary {
  customerId: string
  dateRange: { from: string; to: string }
  totalUpserted: number
  results: Array<{ level: string; rowsUpserted: number; rowsFromApi: number; errors: string[] }>
  startedAt: string
  finishedAt: string
}

export function useSyncGoogleAdsInsights() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: SyncInput) =>
      api.post<{ ok: true; summary: SyncSummary }>('/admin/google-ads-report/sync', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['google-ads-report'] })
      void qc.invalidateQueries({ queryKey: ['google-ads-report-campaigns'] })
    },
  })
}
