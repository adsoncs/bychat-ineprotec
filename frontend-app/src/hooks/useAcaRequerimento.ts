import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface Requerimento {
  id: number; protocolo: string; alunoId: number; ra: string | null; alunoNome: string; tipoNome: string
  assunto: string; descricao: string | null; status: string; resposta: string | null; documentoId: number | null
  prazoEm: string | null; respondidoEm: string | null; createdAt: string; email?: string; whatsapp?: string
}
export interface ReqTipo { id: number; nome: string; descricao: string | null; slaDias: number; geraDocumento: string | null; ativo: boolean; ordem: number }

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
  return useQuery({ queryKey: ['aca-req', id], queryFn: () => api.get<{ requerimento: Requerimento }>(`/admin/aca/requerimentos/${id}`), enabled: id !== null })
}
export function useRequerimentoMut() {
  const qc = useQueryClient()
  const inval = () => { void qc.invalidateQueries({ queryKey: ['aca-reqs'] }); void qc.invalidateQueries({ queryKey: ['aca-req'] }) }
  return useMutation({ mutationFn: ({ id, ...b }: { id: number; status?: string; resposta?: string }) => api.put(`/admin/aca/requerimentos/${id}`, b), onSuccess: inval })
}
export function useReqTipos() {
  return useQuery({ queryKey: ['aca-req-tipos'], queryFn: () => api.get<{ tipos: ReqTipo[] }>('/admin/aca/requerimento-tipos'), staleTime: 30_000 })
}
