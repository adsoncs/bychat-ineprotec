import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface Avaliacao { id: number; diarioId: number; nome: string; peso: number; valorMaximo: number; data: string | null; ordem: number }
export interface LinhaNota { matriculaId: number; ra: string | null; nome: string; notas: Record<number, number | null>; media: number | null; completo: boolean }

export function useNotas(diarioId: number | null) {
  return useQuery({
    queryKey: ['aca-notas', diarioId],
    queryFn: () => api.get<{ avaliacoes: Avaliacao[]; linhas: LinhaNota[]; matriculados: number }>(`/admin/aca/diarios/${diarioId}/notas`),
    enabled: diarioId !== null, staleTime: 3_000,
  })
}

export function useNotaMut(diarioId: number) {
  const qc = useQueryClient()
  const inval = () => void qc.invalidateQueries({ queryKey: ['aca-notas', diarioId] })
  return {
    addAvaliacao: useMutation({ mutationFn: (b: { nome: string; peso: number; valorMaximo: number; data?: string }) => api.post(`/admin/aca/diarios/${diarioId}/avaliacoes`, b), onSuccess: inval }),
    delAvaliacao: useMutation({ mutationFn: (id: number) => api.delete(`/admin/aca/avaliacoes/${id}`), onSuccess: inval }),
    lancarNotas: useMutation({ mutationFn: ({ avaliacaoId, registros }: { avaliacaoId: number; registros: Array<{ matriculaId: number; valor: number | null }> }) => api.post(`/admin/aca/avaliacoes/${avaliacaoId}/notas`, { registros }), onSuccess: inval }),
  }
}
