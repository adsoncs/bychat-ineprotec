import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface DiarioItem { disciplinaId: number; nome: string; fase: number; cargaHoraria: number; diario: { id: number; disciplinaId: number; professorUserId: number | null } | null }
export interface AulaRow { id: number; data: string; conteudo: string; quantidadeAulas: number; _count?: { frequencias: number } }
export interface ResumoFreq { matriculaId: number; ra: string | null; nome: string; faltas: number; presencaPct: number }
export interface DiarioDetail {
  diario: { id: number; turmaId: number; disciplinaId: number; professorUserId: number | null; aulas: AulaRow[] }
  disciplina: { nome: string; cargaHoraria: number } | null
  turma: { nome: string } | null
  totalAulas: number; matriculados: number; resumo: ResumoFreq[]
}
export interface FreqRow { matriculaId: number; ra: string | null; nome: string; presente: boolean; justificada: boolean }

export function useTurmaDiarios(turmaId: number | null) {
  return useQuery({
    queryKey: ['aca-turma-diarios', turmaId],
    queryFn: () => api.get<{ turma: { nome: string }; itens: DiarioItem[]; matriculados: number }>(`/admin/aca/turmas/${turmaId}/diarios`),
    enabled: turmaId !== null, staleTime: 5_000,
  })
}

export function useDiario(diarioId: number | null) {
  return useQuery({
    queryKey: ['aca-diario', diarioId],
    queryFn: () => api.get<DiarioDetail>(`/admin/aca/diarios/${diarioId}`),
    enabled: diarioId !== null, staleTime: 3_000,
  })
}

export function useChamada(aulaId: number | null) {
  return useQuery({
    queryKey: ['aca-chamada', aulaId],
    queryFn: () => api.get<{ aula: { id: number; data: string; conteudo: string; quantidadeAulas: number }; lista: FreqRow[] }>(`/admin/aca/aulas/${aulaId}/frequencia`),
    enabled: aulaId !== null,
  })
}

export function useDiarioMut() {
  const qc = useQueryClient()
  return {
    abrir: useMutation({ mutationFn: (b: { turmaId: number; disciplinaId: number }) => api.post<{ diario: { id: number } }>('/admin/aca/diarios', b), onSuccess: (_d, v) => void qc.invalidateQueries({ queryKey: ['aca-turma-diarios', v.turmaId] }) }),
    addAula: useMutation({ mutationFn: ({ diarioId, ...b }: any) => api.post(`/admin/aca/diarios/${diarioId}/aulas`, b), onSuccess: (_d, v: any) => void qc.invalidateQueries({ queryKey: ['aca-diario', v.diarioId] }) }),
    delAula: useMutation({ mutationFn: ({ aulaId }: any) => api.delete(`/admin/aca/aulas/${aulaId}`), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['aca-diario'] }) } }),
    salvarChamada: useMutation({ mutationFn: ({ aulaId, registros }: any) => api.post(`/admin/aca/aulas/${aulaId}/frequencia`, { registros }), onSuccess: (_d, v: any) => { void qc.invalidateQueries({ queryKey: ['aca-chamada', v.aulaId] }); void qc.invalidateQueries({ queryKey: ['aca-diario'] }) } }),
  }
}
