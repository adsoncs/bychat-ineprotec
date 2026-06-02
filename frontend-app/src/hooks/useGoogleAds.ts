import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface GoogleAdsConfig {
  id: number
  connectionId: number
  customerId: string
  developerToken: string
  conversionAction: string | null
  autoSendConversions: boolean
  active: boolean
  totalSent: number
  totalFailed: number
  lastSentAt: string | null
  createdAt: string
  updatedAt: string
}

export interface GoogleAdsLead {
  id: number
  nome: string | null
  empresa: string | null
  whatsapp: string | null
  email: string | null
  gclid: string | null
  saleDetected: boolean
  saleValue: number | null
  status: string | null
  source: string | null
  createdAt: string
}

export interface GoogleAdsConfigInput {
  connectionId: number
  customerId: string
  /** Aceita resource name "customers/X/conversionActions/Y" ou só o ID. */
  conversionAction?: string | null | undefined
  autoSendConversions?: boolean | undefined
}

// Auto-discovery (Fase 25): leigo escolhe contas e ações via dropdown.

export interface AccessibleCustomer {
  id: string
  resourceName: string
  descriptiveName: string | null
  currencyCode: string | null
  isManager: boolean
}

export interface ConversionActionItem {
  id: string
  name: string
  category: string
  type: string
  status: string
  resourceName: string
  defaultValue: string | null
  defaultCurrency: string | null
}

export function useGoogleAdsDevTokenStatus() {
  return useQuery({
    queryKey: ['google-ads-dev-token-status'],
    queryFn: () => api.get<{ configured: boolean; length: number }>('/admin/google/ads/dev-token-status'),
    staleTime: 30_000,
  })
}

export function useListAccessibleCustomers(connectionId: number | null) {
  return useQuery({
    queryKey: ['google-ads-accessible-customers', connectionId],
    queryFn: () => api.get<{ data: AccessibleCustomer[] }>(`/admin/google/ads/list-accessible-customers?connectionId=${connectionId}`),
    enabled: !!connectionId,
    staleTime: 60_000,
    retry: false,
  })
}

export function useListConversionActions(connectionId: number | null, customerId: string | null) {
  return useQuery({
    queryKey: ['google-ads-conversion-actions', connectionId, customerId],
    queryFn: () => api.get<{ data: ConversionActionItem[] }>(`/admin/google/ads/list-conversion-actions?connectionId=${connectionId}&customerId=${customerId}`),
    enabled: !!connectionId && !!customerId,
    staleTime: 60_000,
    retry: false,
  })
}

export function useGoogleAdsConfig() {
  return useQuery({
    queryKey: ['google-ads-config'],
    queryFn: () => api.get<{ data: GoogleAdsConfig[] }>('/admin/google/ads/config'),
    staleTime: 60_000,
  })
}

export function useCreateGoogleAdsConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: GoogleAdsConfigInput) =>
      api.post<{ data: GoogleAdsConfig }>('/admin/google/ads/config', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['google-ads-config'] }),
  })
}

export function useGoogleAdsLeads(onlySales = false) {
  return useQuery({
    queryKey: ['google-ads-leads', onlySales],
    queryFn: () => api.get<{ data: GoogleAdsLead[]; total: number }>(`/admin/google/ads/leads-with-gclid${onlySales ? '?onlySales=true' : ''}`),
    staleTime: 30_000,
  })
}

export function useSendGoogleAdsConversion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ leadId, value }: { leadId: number; value?: number | undefined }) =>
      api.post<{ success: true; result: unknown }>('/admin/google/ads/send-conversion', { leadId, value }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['google-ads-leads'] })
      void qc.invalidateQueries({ queryKey: ['google-ads-config'] })
    },
  })
}

export function useDeleteGoogleAdsConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<{ ok: true }>(`/admin/google/ads/config/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['google-ads-config'] }),
  })
}

// ── Login Customer ID (MCC) ──

export function useGoogleAdsLoginCustomerId() {
  return useQuery({
    queryKey: ['google-ads-login-customer-id'],
    queryFn: () => api.get<{ loginCustomerId: string | null }>('/admin/google/ads/login-customer-id'),
    staleTime: 60_000,
  })
}

export function useUpdateGoogleAdsLoginCustomerId() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (loginCustomerId: string) =>
      api.put<{ ok: true; loginCustomerId: string | null }>('/admin/google/ads/login-customer-id', { loginCustomerId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['google-ads-login-customer-id'] })
    },
  })
}

// ── Conversion Map (mapping trigger → Conversion Action) ──

export type GoogleAdsTrigger = 'lead.won' | 'lead_qualified' | 'enrollment.payment_confirmed' | 'diagnosis.completed'
export type ValueSource = 'zero' | 'sale_value' | 'fixed'

export interface ConversionMapItem {
  id?: number
  trigger: GoogleAdsTrigger
  conversionAction: string
  valueSource: ValueSource
  fixedValue?: number | null
  isPrimary?: boolean
  enabled?: boolean
  totalSent?: number
  totalFailed?: number
  lastSentAt?: string | null
}

export interface ConversionMapResponse {
  configId: number | null
  supportedTriggers: GoogleAdsTrigger[]
  items: ConversionMapItem[]
}

export function useGoogleAdsConversionMap() {
  return useQuery({
    queryKey: ['google-ads-conversion-map'],
    queryFn: () => api.get<ConversionMapResponse>('/admin/google/ads/conversion-map'),
    staleTime: 30_000,
  })
}

export function useUpdateGoogleAdsConversionMap() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (items: ConversionMapItem[]) =>
      api.put<{ ok: true; count: number }>('/admin/google/ads/conversion-map', { items }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['google-ads-conversion-map'] })
      void qc.invalidateQueries({ queryKey: ['google-ads-config'] })
    },
  })
}
