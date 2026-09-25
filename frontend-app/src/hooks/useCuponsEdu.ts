import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { qsDe } from './usePortalFinanceiro'

export type SituacaoCupom = 'ativo' | 'inativo' | 'agendado' | 'expirado' | 'esgotado' | 'arquivado'
export type MeioCupom = 'pix' | 'boleto' | 'credit_card'

export interface CupomEdu {
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
  courseIds: number[] | null
  offeringIds: number[] | null
  processIds: number[] | null
  levelIds: number[] | null
  modalityIds: number[] | null
  paymentMethods: MeioCupom[] | null
  scope: 'taxa' | 'curso' | null
  allowedCpfs: string[] | null
  emailDomains: string[] | null
  stackWithPix: boolean
  maxInstallments: number | null
  campaign: string | null
  batch: string | null
  notes: string | null
  validFrom: string | null
  validUntil: string | null
  active: boolean
  archivedAt: string | null
  situacao: SituacaoCupom
  createdAt: string
  numeros?: { resgates: number; desconto: number; receita: number; reservados: number } | null
}

export type CupomInput = Partial<Omit<CupomEdu, 'id' | 'usageCount' | 'situacao' | 'createdAt' | 'archivedAt' | 'numeros' | 'batch' | 'allowedCpfs' | 'emailDomains'>> & {
  allowedCpfs?: string[] | string | null
  emailDomains?: string[] | string | null
}

export interface FiltrosCupom { situacao?: string | undefined; campaign?: string | undefined; batch?: string | undefined; search?: string | undefined; limit?: number | undefined; offset?: number | undefined }

const KEY = ['cupons-edu']

export function useCuponsEdu(f: FiltrosCupom) {
  return useQuery({ queryKey: [...KEY, 'lista', f], queryFn: () => api.get<{ items: CupomEdu[]; total: number }>(`/admin/coupons?${qsDe(f)}`), staleTime: 15_000 })
}
export function useResumoCupons() {
  return useQuery({
    queryKey: [...KEY, 'resumo'],
    queryFn: () => api.get<{ total: number; porSituacao: Record<string, number>; resgates: number; descontoConcedido: number; receitaComCupom: number; resgates30d: number; desconto30d: number; campanhas: Array<{ nome: string; cupons: number }>; lotes: Array<{ nome: string; cupons: number }> }>('/admin/coupons/resumo'),
    staleTime: 15_000,
  })
}
export interface DetalheCupom {
  coupon: CupomEdu
  numeros: { resgates: number; desconto: number; receita: number; reservados: number } | null
  porCurso: Array<{ curso: string; usos: number; desconto: number }>
  redemptions: Array<{ id: number; registrationId: number; candidateCode: string | null; nome: string | null; leadId: number | null; portal: string | null; curso: string | null; oferta: string | null; meio: string | null; amountBefore: number; discountValue: number; amountAfter: number; redeemedAt: string }>
  reservas: Array<{ id: number; candidateCode: string; nome: string | null; expiraEm: string | null }>
}
export function useDetalheCupom(id: number | null) {
  return useQuery({ queryKey: [...KEY, 'detalhe', id], queryFn: () => api.get<DetalheCupom>(`/admin/coupons/${id}`), enabled: !!id })
}
function useM<T, R = unknown>(fn: (v: T) => Promise<R>) {
  const qc = useQueryClient()
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: KEY }) })
}
export const useCriarCupom = () => useM((v: CupomInput) => api.post<{ coupon: CupomEdu }>('/admin/coupons', v))
export const useEditarCupom = () => useM((v: { id: number } & CupomInput) => api.put<{ coupon: CupomEdu }>(`/admin/coupons/${v.id}`, v))
export const useExcluirCupom = () => useM((id: number) => api.delete(`/admin/coupons/${id}`))
export const useDuplicarCupom = () => useM((v: { id: number; code?: string }) => api.post<{ coupon: CupomEdu }>(`/admin/coupons/${v.id}/duplicar`, v))
export const useArquivarCupom = () => useM((v: { id: number; arquivar: boolean }) => api.post(`/admin/coupons/${v.id}/${v.arquivar ? 'arquivar' : 'desarquivar'}`))
export const useGerarLote = () => useM((v: CupomInput & { quantidade: number; prefixo: string; lote?: string }) => api.post<{ lote: string; criados: number; codigos: string[] }>('/admin/coupons/lote', v))
export const useSimularCupom = () => useMutation({
  mutationFn: (v: { id: number; candidateCode: string; metodo?: string }) =>
    api.post<{ cobranca: { valor: number; rotulo: string; escopo: string } | null; resultado: any }>(`/admin/coupons/${v.id}/simular`, v),
})
