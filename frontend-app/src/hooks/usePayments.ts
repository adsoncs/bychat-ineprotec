import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export type PaymentProvider = 'asaas' | 'pagarme'
export type PaymentEnvironment = 'sandbox' | 'production'
export type PaymentBillingType = 'UNDEFINED' | 'PIX' | 'BOLETO' | 'CREDIT_CARD'
export type PaymentTestStatus = 'ok' | 'error' | null

export interface PaymentConnection {
  id: number
  name: string
  provider: PaymentProvider
  environment: PaymentEnvironment
  defaultBillingType: PaymentBillingType | null
  apiKeyMasked: string
  publicKeyMasked: string | null
  hasPublicKey: boolean
  webhookToken: string
  webhookSecret: string | null
  companyDocument: string | null
  pixKey: string | null
  accountHolder: string | null
  active: boolean
  lastTestedAt: string | null
  lastTestStatus: PaymentTestStatus
  lastTestMessage: string | null
  createdAt: string
  updatedAt: string
  _count?: { portals: number }
}

export interface PaymentConnectionInput {
  name: string
  provider: PaymentProvider
  environment: PaymentEnvironment
  /** só envia se preenchido — vazio mantém a key atual no edit */
  apiKey?: string | undefined
  /** Pagar.me public key (pk_…). Habilita tokenização de cartão no frontend (PCI SAQ A). */
  publicKey?: string | null | undefined
  defaultBillingType?: PaymentBillingType | null | undefined
  webhookSecret?: string | null | undefined
  companyDocument?: string | null | undefined
  pixKey?: string | null | undefined
  accountHolder?: string | null | undefined
  active?: boolean | undefined
}

const KEY = ['payment-providers'] as const

export function usePaymentConnections() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => api.get<{ connections: PaymentConnection[] }>('/admin/payment-providers'),
    staleTime: 30_000,
  })
}

export function useCreatePaymentConnection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: PaymentConnectionInput) =>
      api.post<{ ok: true; connection: PaymentConnection }>('/admin/payment-providers', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

export function useUpdatePaymentConnection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: { id: number } & Partial<PaymentConnectionInput>) =>
      api.put<{ ok: true; connection: PaymentConnection }>(`/admin/payment-providers/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

export function useDeletePaymentConnection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<{ ok: true }>(`/admin/payment-providers/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

export function useTestPaymentConnection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      api.post<{ ok: boolean; message: string }>(`/admin/payment-providers/${id}/test`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}
