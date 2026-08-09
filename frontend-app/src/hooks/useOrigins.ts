import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { periodQuery, type PeriodRange } from '@/components/ui/PeriodPicker'

export interface OriginBreakdownItem {
  originType: string
  count: number
}

export interface OriginsStatsResponse {
  originBreakdown: OriginBreakdownItem[]
  originByDay: { date: string; originType: string; count: number }[]
  totalLeads: number
  trackedLeads: number
  trackingRate: number
}

export function useOriginsStats(period: PeriodRange) {
  const q = periodQuery(period)
  return useQuery({
    queryKey: ['origins-stats', q],
    queryFn: () => api.get<OriginsStatsResponse>(`/admin/origins/stats?${q}`),
    staleTime: 60_000,
  })
}
