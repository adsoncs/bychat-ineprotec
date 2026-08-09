import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { periodQuery, type PeriodRange } from '@/components/ui/PeriodPicker'

// ── Overview / KPIs ──────────────────────────────────────
export interface PaymentsOverview {
  period: { from: string; to: string; days: number }
  byStatus: Record<string, { count: number; total: number }>
  totals: { all: number; paid: number; pending: number; failed: number; refunded: number }
  revenue: { total: number; pending: number; prev: number; growthPct: number | null }
  ticketMedio: number
  conversionRate: number
  webhookCount: number
}

export function usePaymentsOverview(period: PeriodRange) {
  const q = periodQuery(period)
  return useQuery({
    queryKey: ['payments-overview', q],
    queryFn: () => api.get<PaymentsOverview>(`/admin/payments/overview?${q}`),
    staleTime: 60_000,
  })
}

// ── Timeseries ───────────────────────────────────────────
export interface PaymentsTimeseriesPoint {
  day: string
  paid: number
  pending: number
  failed: number
  revenue: number
}

export function usePaymentsTimeseries(period: PeriodRange) {
  const q = periodQuery(period)
  return useQuery({
    queryKey: ['payments-timeseries', q],
    queryFn: () => api.get<{ days: number; series: PaymentsTimeseriesPoint[] }>(`/admin/payments/timeseries?${q}`),
    staleTime: 60_000,
  })
}

// ── Breakdown ────────────────────────────────────────────
export interface PaymentBreakdownRow {
  name: string
  paid: number
  pending: number
  failed: number
  total: number
}

export interface PaymentBreakdown {
  byMethod: PaymentBreakdownRow[]
  byProvider: PaymentBreakdownRow[]
  byPortal: { id: number; name: string; count: number; paidCount: number; paidTotal: number; total: number }[]
}

export function usePaymentsBreakdown(period: PeriodRange) {
  const q = periodQuery(period)
  return useQuery({
    queryKey: ['payments-breakdown', q],
    queryFn: () => api.get<PaymentBreakdown>(`/admin/payments/breakdown?${q}`),
    staleTime: 60_000,
  })
}

// ── Lista de cobranças ───────────────────────────────────
export interface PaymentMethodRow {
  id: number
  method: 'pix' | 'boleto' | 'credit_card'
  provider: 'asaas' | 'pagarme'
  status: string
  amount: number
  externalId: string | null
  expiresAt: string | null
  paidAt: string | null
  cardBrand: string | null
  cardLastDigits: string | null
  boletoLine: string | null
  boletoPdfUrl: string | null
  lastErrorMessage: string | null
  createdAt: string
  registration: {
    id: number
    candidateCode: string
    paymentStatus: string | null
    lead: { id: number; nome: string | null; email: string | null } | null
    portal: { id: number; nome: string } | null
  } | null
}

export interface PaymentMethodsFilters {
  status?: string
  provider?: string
  method?: string
  portalId?: number
  search?: string
  days?: number
  limit?: number
  offset?: number
}

export function usePaymentMethods(filters: PaymentMethodsFilters = {}) {
  return useQuery({
    queryKey: ['payment-methods-list', filters],
    queryFn: () => {
      const qs = new URLSearchParams()
      for (const [k, v] of Object.entries(filters)) {
        if (v !== undefined && v !== '' && v !== null) qs.set(k, String(v))
      }
      return api.get<{ items: PaymentMethodRow[]; total: number; limit: number; offset: number }>(
        `/admin/payments/methods?${qs.toString()}`,
      )
    },
    staleTime: 30_000,
  })
}

// ── Webhook hits ─────────────────────────────────────────
export interface WebhookHitRow {
  id: number
  provider: string
  eventType: string
  externalId: string | null
  status: string
  registrationId: number | null
  errorMessage: string | null
  signatureValid: boolean
  remoteIp: string | null
  userAgent: string | null
  receivedAt: string
  connection: { id: number; name: string; provider: string } | null
}

export function useWebhookHits(filters: { provider?: string; status?: string; eventType?: string; days?: number; limit?: number; offset?: number } = {}) {
  return useQuery({
    queryKey: ['webhook-hits-list', filters],
    queryFn: () => {
      const qs = new URLSearchParams()
      for (const [k, v] of Object.entries(filters)) {
        if (v !== undefined && v !== '' && v !== null) qs.set(k, String(v))
      }
      return api.get<{ items: WebhookHitRow[]; total: number; limit: number; offset: number; statusCounts: Record<string, number> }>(
        `/admin/payments/webhook-hits?${qs.toString()}`,
      )
    },
    staleTime: 15_000,
  })
}

export function useWebhookHit(id: number | null) {
  return useQuery({
    queryKey: ['webhook-hit', id],
    queryFn: () => api.get<{ hit: WebhookHitRow & { payload: any } }>(`/admin/payments/webhook-hits/${id}`),
    enabled: !!id,
    staleTime: 60_000,
  })
}

// ── Cupons ───────────────────────────────────────────────
export interface Coupon {
  id: number
  code: string
  description: string | null
  type: 'percent' | 'fixed'
  value: number
  minAmount: number | null
  maxDiscount: number | null
  usageLimit: number | null
  usageCount: number
  perUserLimit: number
  portalIds: number[] | null
  validFrom: string | null
  validUntil: string | null
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface CouponInput {
  code: string
  description?: string | null
  type: 'percent' | 'fixed'
  value: number
  minAmount?: number | null
  maxDiscount?: number | null
  usageLimit?: number | null
  perUserLimit?: number
  portalIds?: number[] | null
  validFrom?: string | null
  validUntil?: string | null
  active?: boolean
}

const COUPONS_KEY = ['coupons'] as const

export function useCoupons(filters: { active?: 'true' | 'false'; search?: string } = {}) {
  return useQuery({
    queryKey: [...COUPONS_KEY, filters],
    queryFn: () => {
      const qs = new URLSearchParams()
      for (const [k, v] of Object.entries(filters)) if (v) qs.set(k, String(v))
      return api.get<{ items: Coupon[]; total: number }>(`/admin/coupons?${qs.toString()}`)
    },
    staleTime: 30_000,
  })
}

export function useCreateCoupon() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CouponInput) =>
      api.post<{ ok: true; coupon: Coupon }>(`/admin/coupons`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: COUPONS_KEY }),
  })
}

export function useUpdateCoupon() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: { id: number } & Partial<CouponInput>) =>
      api.put<{ ok: true; coupon: Coupon }>(`/admin/coupons/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: COUPONS_KEY }),
  })
}

export function useDeleteCoupon() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<{ ok: true }>(`/admin/coupons/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: COUPONS_KEY }),
  })
}
