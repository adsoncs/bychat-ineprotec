import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface Kpi { value: number; prev: number; deltaPct: number | null; format: 'money' | 'int' }
export interface FunnelStage {
  key: string
  label: string
  value: number
  prev: number
  deltaPct: number | null
  rate?: { label: string; value: number; unit: '%' }
  cost?: { label: string; value: number; unit: 'money' }
}
export interface DailyRow {
  date: string
  investimento: number
  cmql: number
  mql: number
  sql: number
  ra: number
  rr: number
  fechamento: number
  faturamento: number
}
export interface WeekdayRow {
  weekday: number
  label: string
  investimento: number
  cmql: number
  mql: number
  sql: number
  ra: number
  rr: number
  fechamento: number
}
export interface BreakdownRow {
  id: string
  name: string
  investimento: number
  leads: number
  mql: number
  taxaMql: number
  sql: number
  ra: number
  rr: number
  fechamento: number
  perdido: number
}
export interface FunnelReport {
  funnels: { id: number; name: string }[]
  funnelId: number | null
  period: { from: string; to: string; prevFrom: string; prevTo: string }
  kpis: { investimento: Kpi; mql: Kpi; sql: Kpi; ra: Kpi; rr: Kpi; fechamento: Kpi; faturamento: Kpi }
  funnel: FunnelStage[]
  extraMetrics: { cpm: number; cpl: number; roas: number }
  daily: DailyRow[]
  byWeekday: WeekdayRow[]
  campaigns: BreakdownRow[]
  adsets: BreakdownRow[]
}

export interface FunnelReportParams {
  from?: string | undefined
  to?: string | undefined
  funnelId?: number | undefined
}

export function useFunnelReport(params: FunnelReportParams) {
  return useQuery({
    queryKey: ['funnel-report', params.from, params.to, params.funnelId],
    queryFn: () => {
      const qs = new URLSearchParams()
      if (params.from) qs.set('from', params.from)
      if (params.to) qs.set('to', params.to)
      if (params.funnelId !== undefined) qs.set('funnelId', String(params.funnelId))
      return api.get<FunnelReport>(`/admin/funnel-report?${qs.toString()}`)
    },
    staleTime: 60_000,
  })
}
