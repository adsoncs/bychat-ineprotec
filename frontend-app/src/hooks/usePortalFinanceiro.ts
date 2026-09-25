import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export type SituacaoFin = 'pago' | 'pendente' | 'vencido' | 'falhou' | 'estornado' | 'cancelado' | 'sem_cobranca'
export type MeioFin = 'pix' | 'boleto' | 'cartao' | 'link' | 'manual' | null

export interface LinhaFinanceiro {
  id: number
  candidateCode: string
  nome: string | null
  leadId: number | null
  email: string | null
  whatsapp: string | null
  cpf: string | null
  portal: { id: number; nome: string } | null
  curso: { id: number; nome: string } | null
  oferta: { id: number; nome: string } | null
  processo: { id: number; nome: string } | null
  escopo: 'taxa' | 'curso'
  rotulo: string
  valorTabela: number | null
  descontoCupom: number
  descontoAVista: number
  cupom: string | null
  acrescimo: number
  valorCobrado: number | null
  parcelas: number
  meio: MeioFin
  gateway: string | null
  situacao: SituacaoFin
  paymentStatus: string | null
  inscricaoStatus: string | null
  pagoEm: string | null
  venceEm: string | null
  criadoEm: string
  tentativas: number
  temLink: boolean
}

export interface IndicadoresFin {
  inscricoes: number
  comCobranca: number
  pagos: number
  conversao: number
  recebido: number
  pendente: number
  vencido: number
  ticketMedio: number
  descontos: number
  comCupom: number
  porSituacao: Record<SituacaoFin, number>
  porMeio: Record<string, { quantidade: number; valor: number }>
  porCurso: Array<{ curso: string; inscritos: number; pagos: number; recebido: number }>
  porDia: Array<{ dia: string; valor: number }>
}

export interface FiltrosFin {
  de?: string | undefined
  ate?: string | undefined
  portalId?: string | undefined
  courseId?: string | undefined
  offeringId?: string | undefined
  processId?: string | undefined
  situacao?: string | undefined
  meio?: string | undefined
  gateway?: string | undefined
  escopo?: string | undefined
  cupom?: string | undefined
  search?: string | undefined
  ordenar?: string | undefined
  limit?: number | undefined
  offset?: number | undefined
}

export const qsDe = (f: object) => {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== '' && v !== null) qs.set(k, String(v))
  return qs.toString()
}

const BASE = '/admin/educational/portal-financeiro'

export function usePortalFinanceiro(f: FiltrosFin) {
  return useQuery({
    queryKey: ['portal-financeiro', f],
    queryFn: () => api.get<{ indicadores: IndicadoresFin; total: number; limit: number; offset: number; items: LinhaFinanceiro[] }>(`${BASE}?${qsDe(f)}`),
    staleTime: 15_000,
  })
}

export interface DetalheFin {
  linha: LinhaFinanceiro
  plano: Record<string, any> | null
  paymentUrl: string | null
  tentativas: Array<{ id: number; provider: string; method: string; status: string; amount: number | null; externalId: string | null; createdAt: string; paidAt: string | null; expiresAt: string | null; boletoLine: string | null; boletoPdfUrl: string | null; qrCode: string | null; cardBrand: string | null; cardLastDigits: string | null; lastErrorMessage: string | null }>
  avisos: Array<{ id: number; provider: string; eventType: string; status: string; receivedAt: string; errorMessage: string | null }>
  cupom: { id: number; code: string; description: string | null; desconto: number; em: string } | null
  eventos: Array<{ id: number; type: string; title: string; description: string | null; createdAt: string; userName: string | null }>
}

export function useDetalheFinanceiro(id: number | null) {
  return useQuery({
    queryKey: ['portal-financeiro', 'detalhe', id],
    queryFn: () => api.get<DetalheFin>(`${BASE}/${id}`),
    enabled: !!id,
  })
}

function useAcao<T, R = unknown>(fn: (v: T) => Promise<R>) {
  const qc = useQueryClient()
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: ['portal-financeiro'] }) })
}

export const useBaixaManual = () => useAcao((v: { id: number; valor: number; forma: string; observacao?: string; pagoEm?: string }) => api.post(`${BASE}/${v.id}/baixa-manual`, v))
export const useCancelarCobranca = () => useAcao((id: number) => api.post<{ ok: boolean; canceladas: number; avisos: string[] }>(`${BASE}/${id}/cancelar-cobranca`))
export const useEstornar = () => useAcao((v: { id: number; valor?: number; motivo?: string }) => api.post(`${BASE}/${v.id}/estornar`, v))
export const useSincronizarPagamento = () => useAcao((id: number) => api.post<{ ok: boolean; transitionedToPaid: boolean }>(`/admin/enrollment-registrations/${id}/sync-payment`))
export const useReenviarLink = () => useAcao((id: number) => api.post(`/admin/enrollment-registrations/${id}/resend-link`, {}))
