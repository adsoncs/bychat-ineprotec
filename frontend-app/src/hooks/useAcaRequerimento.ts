import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface Requerimento {
  id: number; protocolo: string; alunoId: number; ra: string | null; alunoNome: string; tipoNome: string
  assunto: string; descricao: string | null; status: string; resposta: string | null; documentoId: number | null
  custoParcelaId: number | null; prazoEm: string | null; respondidoEm: string | null; createdAt: string; email?: string; whatsapp?: string
}
export interface ReqTipo {
  id: number; nome: string; descricao: string | null; slaDias: number; geraDocumento: string | null; ativo: boolean; ordem: number
  categoriaId: number | null; custoCentavos: number; deferimentoAutomatico: boolean
}
export interface ReqCategoria { id: number; nome: string; ordem: number; ativo: boolean }
export interface ReqTramite { id: number; requerimentoId: number; deNome: string | null; paraNome: string | null; estado: string | null; comentario: string | null; createdAt: string }
export interface ReqDetail { requerimento: Requerimento; tipo: ReqTipo | null; tramites: ReqTramite[] }

export const REQ_STATUS_LABEL: Record<string, string> = { ABERTO: 'Aberto', EM_ANALISE: 'Em análise', DEFERIDO: 'Deferido', INDEFERIDO: 'Indeferido', CONCLUIDO: 'Concluído', CANCELADO: 'Cancelado' }
export function reqTone(s: string): 'success' | 'warning' | 'danger' | 'neutral' {
  if (s === 'DEFERIDO' || s === 'CONCLUIDO') return 'success'
  if (s === 'INDEFERIDO' || s === 'CANCELADO') return 'danger'
  if (s === 'EM_ANALISE') return 'warning'
  return 'neutral'
}

export function useRequerimentos(status: string | null) {
  return useQuery({
    queryKey: ['aca-reqs', status],
    queryFn: () => api.get<{ itens: Requerimento[]; counts: Record<string, number> }>(`/admin/aca/requerimentos${status ? `?status=${status}` : ''}`),
    staleTime: 3_000,
  })
}
export function useRequerimento(id: number | null) {
  return useQuery({ queryKey: ['aca-req', id], queryFn: () => api.get<ReqDetail>(`/admin/aca/requerimentos/${id}`), enabled: id !== null })
}
export function useRequerimentoMut() {
  const qc = useQueryClient()
  const inval = () => { void qc.invalidateQueries({ queryKey: ['aca-reqs'] }); void qc.invalidateQueries({ queryKey: ['aca-req'] }) }
  return useMutation({ mutationFn: ({ id, ...b }: { id: number; status?: string; resposta?: string }) => api.put(`/admin/aca/requerimentos/${id}`, b), onSuccess: inval })
}
export function useTramitarMut() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...b }: { id: number; comentario?: string; estado?: string; paraUserId?: number }) => api.post(`/admin/aca/requerimentos/${id}/tramitar`, b),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['aca-req'] }); void qc.invalidateQueries({ queryKey: ['aca-reqs'] }) },
  })
}

export function useReqTipos() {
  return useQuery({ queryKey: ['aca-req-tipos'], queryFn: () => api.get<{ tipos: ReqTipo[] }>('/admin/aca/requerimento-tipos'), staleTime: 30_000 })
}
export function useReqTipoMut() {
  const qc = useQueryClient()
  const inval = () => void qc.invalidateQueries({ queryKey: ['aca-req-tipos'] })
  return {
    criar: useMutation({ mutationFn: (b: Partial<ReqTipo>) => api.post('/admin/aca/requerimento-tipos', b), onSuccess: inval }),
    atualizar: useMutation({ mutationFn: ({ id, ...b }: Partial<ReqTipo> & { id: number }) => api.put(`/admin/aca/requerimento-tipos/${id}`, b), onSuccess: inval }),
  }
}
export function useReqCategorias() {
  return useQuery({ queryKey: ['aca-req-categorias'], queryFn: () => api.get<{ categorias: ReqCategoria[] }>('/admin/aca/requerimento-categorias'), staleTime: 30_000 })
}
export function useReqCategoriaMut() {
  const qc = useQueryClient()
  const inval = () => void qc.invalidateQueries({ queryKey: ['aca-req-categorias'] })
  return {
    criar: useMutation({ mutationFn: (b: { nome: string; ordem?: number }) => api.post('/admin/aca/requerimento-categorias', b), onSuccess: inval }),
    atualizar: useMutation({ mutationFn: ({ id, ...b }: { id: number; nome?: string; ordem?: number; ativo?: boolean }) => api.put(`/admin/aca/requerimento-categorias/${id}`, b), onSuccess: inval }),
  }
}
