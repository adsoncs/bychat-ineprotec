import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface Ocupacao { capacidade: number | null; inscritos: number; emEspera: number; vagasLivres: number | null; lotada: boolean }
export interface Inscricao {
  id: number; status: string; listaEspera: boolean; origem: string | null; dataMatricula: string
  aluno: { id: number; ra: string | null; lead: { nome: string; email: string; whatsapp: string } }
}

export function useInscricoes(turmaId: number | null) {
  return useQuery({
    queryKey: ['aca-inscricoes', turmaId],
    queryFn: () => api.get<{ inscricoes: Inscricao[]; ocupacao: Ocupacao }>(`/admin/aca/turmas/${turmaId}/inscricoes`),
    enabled: turmaId !== null,
    staleTime: 3_000,
  })
}

export function useInscricaoMut(turmaId: number) {
  const qc = useQueryClient()
  const inval = () => { void qc.invalidateQueries({ queryKey: ['aca-inscricoes', turmaId] }); void qc.invalidateQueries({ queryKey: ['aca-turmas'] }) }
  return {
    inscrever: useMutation({ mutationFn: (alunoId: number) => api.post(`/admin/aca/turmas/${turmaId}/inscricoes`, { alunoId }), onSuccess: inval }),
    promover: useMutation({ mutationFn: (mId: number) => api.post(`/admin/aca/inscricoes/${mId}/promover`, {}), onSuccess: inval }),
    cancelar: useMutation({ mutationFn: (mId: number) => api.delete(`/admin/aca/inscricoes/${mId}`), onSuccess: inval }),
  }
}
