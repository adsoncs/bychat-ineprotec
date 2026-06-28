import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface Egresso { matriculaId: number; alunoId: number; ra: string | null; nome: string; turma: string; dataConclusao: string | null; certificado: { id: number; numero: string } | null }

export function useEgressos() {
  return useQuery({ queryKey: ['aca-egressos'], queryFn: () => api.get<{ itens: Egresso[] }>('/admin/aca/egressos'), staleTime: 5_000 })
}
export function useCertificarMut() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (matriculaId: number) => api.post<{ documento: { id: number; numero: string } }>(`/admin/aca/matriculas/${matriculaId}/certificado`, {}), onSuccess: () => void qc.invalidateQueries({ queryKey: ['aca-egressos'] }) })
}
