import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface PlanoEnsino { id: number; diarioId: number; ementa: string | null; objetivos: string | null; conteudo: string | null; metodologia: string | null; bibliografia: string | null; criterios: string | null }
export interface Material { id: number; diarioId: number; titulo: string; tipo: string; url: string; descricao: string | null; createdAt: string }

export function usePlanoMateriais(diarioId: number | null) {
  return useQuery({ queryKey: ['aca-plano', diarioId], queryFn: () => api.get<{ plano: PlanoEnsino | null; materiais: Material[] }>(`/admin/aca/diarios/${diarioId}/plano`), enabled: diarioId !== null, staleTime: 3_000 })
}
export function usePlanoMut(diarioId: number) {
  const qc = useQueryClient()
  const inval = () => void qc.invalidateQueries({ queryKey: ['aca-plano', diarioId] })
  return {
    salvarPlano: useMutation({ mutationFn: (b: Partial<PlanoEnsino>) => api.put(`/admin/aca/diarios/${diarioId}/plano`, b), onSuccess: inval }),
    addMaterial: useMutation({ mutationFn: (b: { titulo: string; url: string; tipo?: string; descricao?: string }) => api.post(`/admin/aca/diarios/${diarioId}/materiais`, b), onSuccess: inval }),
    delMaterial: useMutation({ mutationFn: (id: number) => api.delete(`/admin/aca/materiais/${id}`), onSuccess: inval }),
  }
}
