import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface Estagio { id: number; alunoId: number; empresa: string; supervisor: string | null; cargaHorariaH: number; dataInicio: string | null; dataFim: string | null; status: string; descricao: string | null }
export interface Atividade { id: number; alunoId: number; titulo: string; categoria: string | null; horas: number; data: string | null; comprovanteUrl: string | null; status: string; observacao: string | null }
export interface ResumoHoras { estagio: { horas: number; meta: number; cumprido: boolean }; atividades: { horas: number; meta: number; cumprido: boolean; pendentes: number } }
export interface EstagioPainel { estagios: Estagio[]; atividades: Atividade[]; resumo: ResumoHoras }

export function useEstagioPainel(alunoId: number | null) {
  return useQuery({ queryKey: ['aca-estagio', alunoId], queryFn: () => api.get<EstagioPainel>(`/admin/aca/alunos/${alunoId}/estagio`), enabled: alunoId !== null, staleTime: 3_000 })
}
export function useEstagioMut(alunoId: number) {
  const qc = useQueryClient()
  const inval = () => void qc.invalidateQueries({ queryKey: ['aca-estagio', alunoId] })
  return {
    addEstagio: useMutation({ mutationFn: (b: Partial<Estagio>) => api.post('/admin/aca/estagios', { alunoId, ...b }), onSuccess: inval }),
    upEstagio: useMutation({ mutationFn: ({ id, ...b }: { id: number } & Partial<Estagio>) => api.put(`/admin/aca/estagios/${id}`, b), onSuccess: inval }),
    delEstagio: useMutation({ mutationFn: (id: number) => api.delete(`/admin/aca/estagios/${id}`), onSuccess: inval }),
    addAtividade: useMutation({ mutationFn: (b: Partial<Atividade>) => api.post('/admin/aca/atividades', { alunoId, ...b }), onSuccess: inval }),
    upAtividade: useMutation({ mutationFn: ({ id, ...b }: { id: number } & Partial<Atividade>) => api.put(`/admin/aca/atividades/${id}`, b), onSuccess: inval }),
    delAtividade: useMutation({ mutationFn: (id: number) => api.delete(`/admin/aca/atividades/${id}`), onSuccess: inval }),
  }
}
