import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface DetectedSale {
  id: number
  leadId: number
  status: string
  value: number | null
  productService: string | null
  confidence: string
  conversationSnippet: string | null
  aiExplanation: string | null
  originType: string | null
  campaignName: string | null
  campaignId: string | null
  detectedAt: string
  confirmedAt: string | null
  lead?: { id: number; nome: string | null; empresa: string | null; whatsapp: string | null; status: string | null }
}

export interface SalesListResponse {
  sales: DetectedSale[]
  total: number
  page: number
  limit: number
}

export interface SalesFilters {
  status?: string | undefined
  originType?: string | undefined
  campaignId?: string | undefined
  dateFrom?: string | undefined
  dateTo?: string | undefined
  page?: number | undefined
  limit?: number | undefined
}

export interface SalesDashboardResponse {
  totalSales: number
  confirmedSales: number
  totalValue: number
  avgTicket: number
  salesByOrigin: { originType: string; count: number; totalValue: number }[]
  salesByDay: { date: string; count: number; totalValue: number }[]
  salesByCampaign: { campaignName: string; campaignId: string; count: number; totalValue: number }[]
}

function buildQuery(f: SalesFilters): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(f)) {
    if (v !== undefined && v !== '') p.set(k, String(v))
  }
  const qs = p.toString()
  return qs ? `?${qs}` : ''
}

export function useSales(filters: SalesFilters = {}) {
  return useQuery({
    queryKey: ['sales', filters],
    queryFn: () => api.get<SalesListResponse>(`/admin/sales${buildQuery(filters)}`),
    staleTime: 30_000,
  })
}

export function useSalesDashboard(days = 30) {
  return useQuery({
    queryKey: ['sales-dashboard', days],
    queryFn: () => api.get<SalesDashboardResponse>(`/admin/sales/dashboard?days=${days}`),
    staleTime: 60_000,
  })
}

export function useConfirmSale() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, value }: { id: number; value?: number | undefined }) =>
      api.put<{ ok: true }>(`/admin/sales/${id}/confirm`, { value }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sales'] })
      void qc.invalidateQueries({ queryKey: ['sales-dashboard'] })
    },
  })
}

export function useRejectSale() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.put<{ ok: true }>(`/admin/sales/${id}/reject`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sales'] })
      void qc.invalidateQueries({ queryKey: ['sales-dashboard'] })
    },
  })
}

/** Settings de detecção de vendas (chave-valor em prisma.setting). Backend retorna strings. */
export interface SalesSettingsRaw {
  'sale_detection.prompt'?: string
  'sale_detection.target_stage'?: string
  'sale_detection.enabled'?: string
  'sale_detection.interval'?: string
}

const SETTINGS_KEY = ['sales-settings'] as const

export function useSalesSettings() {
  return useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => api.get<{ settings: SalesSettingsRaw }>('/admin/sales/settings'),
    staleTime: 60_000,
  })
}

export function useSaveSalesSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (settings: SalesSettingsRaw) => api.put<{ ok: true }>('/admin/sales/settings', settings),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: SETTINGS_KEY }) },
  })
}
