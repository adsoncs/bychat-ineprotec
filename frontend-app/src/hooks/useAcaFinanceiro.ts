import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface Parcela {
  id: number; nroParcela: number; tipo: string; valorBrutoCentavos: number; valorPagoCentavos: number
  dataVencimento: string; situacao: string; pagoEm: string | null
  asaasChargeId: string | null; linhaDigitavel: string | null; pixCopiaCola: string | null
}
export interface Contrato {
  id: number; status: string; valorTotalCentavos: number; descontoCentavos: number; asaasCustomerId: string | null
  parcelas: Parcela[]
}

export function useFinanceiro(matriculaId: number | null) {
  return useQuery({
    queryKey: ['aca-financeiro', matriculaId],
    queryFn: () => api.get<{ contrato: Contrato | null }>(`/admin/aca/matriculas/${matriculaId}/financeiro`),
    enabled: matriculaId !== null,
    staleTime: 3_000,
  })
}

export function useFinanceiroMut(matriculaId: number) {
  const qc = useQueryClient()
  const inval = () => { void qc.invalidateQueries({ queryKey: ['aca-financeiro', matriculaId] }); void qc.invalidateQueries({ queryKey: ['aca-matricula', matriculaId] }) }
  return {
    gerar: useMutation({ mutationFn: () => api.post(`/admin/aca/matriculas/${matriculaId}/financeiro/gerar`, {}), onSuccess: inval }),
    cobranca: useMutation({ mutationFn: (parcelaId: number) => api.post(`/admin/aca/parcelas/${parcelaId}/cobranca`, {}), onSuccess: inval }),
    baixa: useMutation({ mutationFn: (parcelaId: number) => api.post(`/admin/aca/parcelas/${parcelaId}/baixa`, {}), onSuccess: inval }),
  }
}
