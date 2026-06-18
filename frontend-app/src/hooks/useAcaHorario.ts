import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface Horario { id: number; turmaId: number; disciplinaId: number; disciplinaNome: string; professorUserId: number | null; professorNome: string | null; sala: string | null; diaSemana: number; horaInicio: string; horaFim: string }
export interface Conflito { id: number; turmaId: number; motivo: string; horario: string }
export const DIAS = ['', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo']

export function useHorarios(turmaId: number | null) {
  return useQuery({ queryKey: ['aca-horarios', turmaId], queryFn: () => api.get<{ horarios: Horario[] }>(`/admin/aca/turmas/${turmaId}/horarios`), enabled: turmaId !== null, staleTime: 3_000 })
}
export function useHorarioMut(turmaId: number) {
  const qc = useQueryClient()
  const inval = () => void qc.invalidateQueries({ queryKey: ['aca-horarios', turmaId] })
  return {
    criar: useMutation({ mutationFn: (b: any) => api.post<{ horario: Horario; conflitos: Conflito[] }>('/admin/aca/horarios', b), onSuccess: inval }),
    excluir: useMutation({ mutationFn: (id: number) => api.delete(`/admin/aca/horarios/${id}`), onSuccess: inval }),
  }
}
