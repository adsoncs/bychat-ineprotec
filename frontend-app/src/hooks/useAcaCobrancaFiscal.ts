import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

const base = '/admin/aca/cobranca-fiscal'

export interface CDA { id: number; numero: string; alunoId: number; alunoNome: string; ra: string | null; valorCentavos: number; qtdParcelas: number; status: string; bloqueioJudicial: boolean; inscritaEm: string; ajuizadaEm: string | null; quitadaEm: string | null; observacao: string | null }
export interface RegraContabil { id: number; evento: string; contaDebitoId: number | null; contaCreditoId: number | null; historico: string; ativo: boolean }
export interface Lancamento { id: number; data: string; historico: string; contaDebitoId: number | null; contaCreditoId: number | null; valorCentavos: number; origem: string; desfeito: boolean }
export interface NfseConfig { id: number; provedor: string | null; ambiente: string; cnpjPrestador: string | null; inscricaoMunicipal: string | null; codigoServico: string | null; aliquotaPct: number; ativo: boolean }

export const CDA_STATUS: Record<string, { label: string; tone: 'warning' | 'danger' | 'success' | 'neutral' }> = {
  INSCRITA: { label: 'Inscrita', tone: 'warning' }, AJUIZADA: { label: 'Ajuizada', tone: 'danger' },
  QUITADA: { label: 'Quitada', tone: 'success' }, CANCELADA: { label: 'Cancelada', tone: 'neutral' },
}

export const useCDAs = (status = '') =>
  useQuery({ queryKey: ['aca-cf-cda', status], queryFn: () => api.get<{ cdas: CDA[]; counts: Record<string, number>; totalCentavos: number }>(`${base}/cda${status ? `?status=${status}` : ''}`), staleTime: 3_000 })
export const useRegrasContabeis = () =>
  useQuery({ queryKey: ['aca-cf-regras'], queryFn: () => api.get<{ regras: RegraContabil[] }>(`${base}/regras`), staleTime: 10_000 })
export const useLancamentos = () =>
  useQuery({ queryKey: ['aca-cf-lanc'], queryFn: () => api.get<{ lancamentos: Lancamento[]; totalCentavos: number }>(`${base}/lancamentos`), staleTime: 3_000 })
export const useNfseConfig = () =>
  useQuery({ queryKey: ['aca-cf-nfse'], queryFn: () => api.get<{ config: NfseConfig | null }>(`${base}/nfse-config`), staleTime: 10_000 })

export function useCobrancaFiscalMut() {
  const qc = useQueryClient()
  const inval = (...k: string[]) => k.forEach((key) => void qc.invalidateQueries({ queryKey: [key] }))
  return {
    inscreverDA: useMutation({ mutationFn: (b: { diasMin: number; dryRun: boolean }) => api.post<{ dryRun: boolean; total: number; parcelas?: number; grupos?: any[] }>(`${base}/cda/inscrever`, b), onSuccess: () => inval('aca-cf-cda') }),
    atualizarCDA: useMutation({ mutationFn: ({ id, ...b }: any) => api.put(`${base}/cda/${id}`, b), onSuccess: () => inval('aca-cf-cda') }),
    criarRegra: useMutation({ mutationFn: (b: any) => api.post(`${base}/regras`, b), onSuccess: () => inval('aca-cf-regras') }),
    atualizarRegra: useMutation({ mutationFn: ({ id, ...b }: any) => api.put(`${base}/regras/${id}`, b), onSuccess: () => inval('aca-cf-regras') }),
    contabilizar: useMutation({ mutationFn: (b: { dryRun: boolean }) => api.post<{ dryRun: boolean; total: number; lancados?: number; erro?: string }>(`${base}/contabilizar`, b), onSuccess: () => inval('aca-cf-lanc') }),
    desfazer: useMutation({ mutationFn: (id: number) => api.post(`${base}/lancamentos/${id}/desfazer`, {}), onSuccess: () => inval('aca-cf-lanc') }),
    salvarNfseConfig: useMutation({ mutationFn: (b: any) => api.put(`${base}/nfse-config`, b), onSuccess: () => inval('aca-cf-nfse') }),
    gerarLoteNfse: useMutation({ mutationFn: (b: { dryRun: boolean }) => api.post<{ dryRun: boolean; total: number; gerados?: number; transmissao?: string }>(`${base}/nfse/gerar-lote`, b) }),
  }
}
