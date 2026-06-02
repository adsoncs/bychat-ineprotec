import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface FunnelConversionStage {
  key: string
  name: string
  color: string
  position: number
  terminalKind: string | null
  entriesInPeriod: number
  currentCount: number
  avgTimeInStageSec: number | null
  samples: number
}

export interface FunnelConversionPair {
  fromKey: string
  toKey: string
  fromName: string
  toName: string
  count: number
  rate: number          // 0..1
  bottleneck: boolean
}

export interface FunnelConversionReport {
  funnel: { id: number; name: string }
  range: { from: string; to: string }
  stages: FunnelConversionStage[]
  conversions: FunnelConversionPair[]
  kpis: {
    totalEntered: number
    wonCount: number
    lostCount: number
    conversionRate: number  // 0..1
    bottleneckCount: number
  }
  sources: Array<{ source: string; count: number }>
}

export interface FunnelConversionFilters {
  dateFrom?: string
  dateTo?: string
  source?: string
}

export function useFunnelConversionReport(funnelId: number | null, filters: FunnelConversionFilters = {}) {
  const p = new URLSearchParams()
  if (filters.dateFrom) p.set('dateFrom', filters.dateFrom)
  if (filters.dateTo) p.set('dateTo', filters.dateTo)
  if (filters.source) p.set('source', filters.source)
  const qs = p.toString() ? `?${p.toString()}` : ''
  return useQuery({
    queryKey: ['funnel-conversion', funnelId, filters],
    queryFn: () => api.get<FunnelConversionReport>(`/admin/funnels/${funnelId}/conversion-report${qs}`),
    enabled: funnelId !== null,
    staleTime: 30_000,
  })
}
