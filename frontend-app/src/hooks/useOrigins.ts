import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

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

export function useOriginsStats(days = 30) {
  return useQuery({
    queryKey: ['origins-stats', days],
    queryFn: () => api.get<OriginsStatsResponse>(`/admin/origins/stats?days=${days}`),
    staleTime: 60_000,
  })
}
