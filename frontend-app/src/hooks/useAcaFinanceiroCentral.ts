import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { env } from '@/lib/env'

export interface FinFiltros { situacao?: string; turmaId?: number; periodoLetivoId?: number; q?: string; vencidas?: boolean; tipo?: string; page?: number; limit?: number }
export interface ParcelaLinha {
  id: number; nroParcela: number; tipo: string; valor: number; valorPago: number; vencimento: string; pagoEm: string | null
  multa: number; juros: number; desconto: number; valorAtual: number
  situacao: string; atrasada: boolean; diasAtraso: number; temCobranca: boolean
  alunoId: number; ra: string | null; alunoNome: string; matriculaId: number; turmaId: number; turmaNome: string
}
export interface FinResumo { recebido: number; parcelasPagas: number; aReceberTotal: number; aVencer: number; vencidoTotal: number; encargosTotal: number; vencidoAtualizado: number; inadimplentes: number; aging: { d0_30: number; d31_60: number; d61_90: number; d90: number } }
export interface EncargosConfig { multaPct: number; jurosMesPct: number; carenciaDias: number; descontoPontualidadePct: number }
export interface BloqueioConfig { enabled: boolean; toleranciaDias: number; minParcelas: number }
export interface ContratoResumo { id: number; valorTotalCentavos: number; descontoCentavos: number; status: string; aceiteEm: string | null; aceiteNome: string | null }
export interface Extrato { aluno: { nome: string; ra: string | null }; contratos: ContratoResumo[]; parcelas: ParcelaLinha[]; totais: { total: number; pago: number; aberto: number; vencido: number } }

export const money = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

function qs(f: FinFiltros): string {
  const p = new URLSearchParams()
  if (f.situacao) p.set('situacao', f.situacao)
  if (f.turmaId) p.set('turmaId', String(f.turmaId))
  if (f.periodoLetivoId) p.set('periodoLetivoId', String(f.periodoLetivoId))
  if (f.q) p.set('q', f.q)
  if (f.vencidas) p.set('vencidas', 'true')
  if (f.tipo) p.set('tipo', f.tipo)
  if (f.page) p.set('page', String(f.page))
  if (f.limit) p.set('limit', String(f.limit))
  return p.toString()
}

export function useFinResumo(f: FinFiltros) {
  return useQuery({ queryKey: ['aca-fin-resumo', f], queryFn: () => api.get<FinResumo>(`/admin/aca/financeiro/resumo?${qs({ ...f, page: undefined, limit: undefined })}`), staleTime: 5_000 })
}
export function useFinParcelas(f: FinFiltros) {
  return useQuery({ queryKey: ['aca-fin-parcelas', f], queryFn: () => api.get<{ total: number; page: number; limit: number; itens: ParcelaLinha[] }>(`/admin/aca/financeiro/parcelas?${qs(f)}`), staleTime: 3_000 })
}
export function useEncargosConfig() {
  return useQuery({ queryKey: ['aca-fin-config'], queryFn: () => api.get<{ config: EncargosConfig; bloqueio: BloqueioConfig }>('/admin/aca/financeiro/config'), staleTime: 30_000 })
}
export function useEncargosConfigMut() {
  const qc = useQueryClient()
  const inval = () => { void qc.invalidateQueries({ queryKey: ['aca-fin-config'] }); void qc.invalidateQueries({ queryKey: ['aca-fin-parcelas'] }); void qc.invalidateQueries({ queryKey: ['aca-fin-resumo'] }) }
  return useMutation({ mutationFn: (b: Partial<EncargosConfig>) => api.put('/admin/aca/financeiro/config', b), onSuccess: inval })
}
export function useBloqueioConfigMut() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (b: Partial<BloqueioConfig>) => api.put('/admin/aca/financeiro/bloqueio-config', b), onSuccess: () => void qc.invalidateQueries({ queryKey: ['aca-fin-config'] }) })
}

export function useContratoTermo() {
  return useQuery({ queryKey: ['aca-contrato-termo'], queryFn: () => api.get<{ termo: string }>('/admin/aca/financeiro/contrato-termo'), staleTime: 60_000 })
}
export function useContratoTermoMut() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (termo: string) => api.put('/admin/aca/financeiro/contrato-termo', { termo }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['aca-contrato-termo'] }) })
}

export function useExtrato(alunoId: number | null) {
  return useQuery({ queryKey: ['aca-fin-extrato', alunoId], queryFn: () => api.get<Extrato>(`/admin/aca/financeiro/aluno/${alunoId}/extrato`), enabled: alunoId !== null, staleTime: 3_000 })
}
export function useFinAcoes() {
  const qc = useQueryClient()
  const inval = () => { void qc.invalidateQueries({ queryKey: ['aca-fin-parcelas'] }); void qc.invalidateQueries({ queryKey: ['aca-fin-resumo'] }); void qc.invalidateQueries({ queryKey: ['aca-fin-extrato'] }) }
  return {
    baixaLote: useMutation({ mutationFn: (parcelaIds: number[]) => api.post<{ ok: number; total: number }>('/admin/aca/financeiro/baixa-lote', { parcelaIds }), onSuccess: inval }),
    cobrancaLote: useMutation({ mutationFn: (parcelaIds: number[]) => api.post<{ ok: number; total: number; erros: string[] }>('/admin/aca/financeiro/cobranca-lote', { parcelaIds }), onSuccess: inval }),
  }
}

export interface SimulacaoReneg { qtd: number; valorOriginal: number; encargos: number; total: number }
export function useRenegociar() {
  const qc = useQueryClient()
  return {
    simular: useMutation({ mutationFn: (parcelaIds: number[]) => api.post<SimulacaoReneg>('/admin/aca/financeiro/renegociar/simular', { parcelaIds }) }),
    renegociar: useMutation({
      mutationFn: (b: { parcelaIds: number[]; entrada: number; numParcelas: number; primeiroVencimento: string; observacao?: string }) => api.post('/admin/aca/financeiro/renegociar', b),
      onSuccess: () => { void qc.invalidateQueries({ queryKey: ['aca-fin-parcelas'] }); void qc.invalidateQueries({ queryKey: ['aca-fin-resumo'] }); void qc.invalidateQueries({ queryKey: ['aca-fin-extrato'] }) },
    }),
  }
}

export interface NotaFiscal { id: number; alunoId: number; parcelaId: number | null; valorCentavos: number; status: string; numero: string | null; serie: string | null; link: string | null; observacao: string | null; emitidaEm: string | null }
export function useReciboMut() {
  return useMutation({ mutationFn: (parcelaId: number) => api.post<{ documento: { id: number; numero: string } }>(`/admin/aca/financeiro/parcelas/${parcelaId}/recibo`, {}) })
}
export function useNfse(parcelaId: number | null) {
  return useQuery({ queryKey: ['aca-nfse', parcelaId], queryFn: () => api.get<{ itens: NotaFiscal[] }>(`/admin/aca/financeiro/nfse?parcelaId=${parcelaId}`), enabled: parcelaId !== null })
}
export function useNfseMut(parcelaId: number) {
  const qc = useQueryClient()
  const inval = () => void qc.invalidateQueries({ queryKey: ['aca-nfse', parcelaId] })
  return {
    criar: useMutation({ mutationFn: () => api.post('/admin/aca/financeiro/nfse', { parcelaId }), onSuccess: inval }),
    registrar: useMutation({ mutationFn: ({ id, ...b }: { id: number; status?: string; numero?: string; serie?: string; link?: string }) => api.put(`/admin/aca/financeiro/nfse/${id}`, b), onSuccess: inval }),
    excluir: useMutation({ mutationFn: (id: number) => api.delete(`/admin/aca/financeiro/nfse/${id}`), onSuccess: inval }),
  }
}

/** Baixa o CSV (respeita filtros) com Authorization. */
export async function exportFinanceiroCsv(f: FinFiltros) {
  const token = (() => { try { return localStorage.getItem(env.authTokenKey) } catch { return null } })()
  const res = await fetch(`${env.apiBase}/admin/aca/financeiro/export.csv?${qs({ ...f, page: undefined, limit: undefined })}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  if (!res.ok) throw new Error('Falha ao exportar')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = 'financeiro.csv'; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
