import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface Ref { id: number; nome: string }
export interface OfferingRef { id: number; nome: string; complemento: string | null; courseId: number }
export interface PeriodoRef { id: number; codigo: string }
export interface MatrizRef { id: number; courseId: number; versao: string }
export interface Periodo { id: number; codigo: string; descricao: string; anoLetivo: number | null; dataInicio: string | null; dataFim: string | null; ativo: boolean; _count?: { turmas: number } }
export interface Disciplina { id: number; courseId: number; nome: string; codigo: string | null; cargaHoraria: number; ementa: string | null; ativo: boolean }
export interface ComponenteFull { id: number; fase: number; obrigatoria: boolean; disciplinaId: number; disciplina: { nome: string; cargaHoraria: number; codigo: string | null } }
export interface Matriz { id: number; courseId: number; versao: string; vigenteDe: string | null; ativo: boolean; _count?: { componentes: number }; componentes: ComponenteFull[] }
export interface Turma { id: number; nome: string; courseOfferingId: number | null; periodoLetivoId: number; matrizId: number | null; faseAtual: number | null; turno: string | null; capacidade: number | null; ativo: boolean; matriculaAberta?: boolean; periodoLetivo: { codigo: string }; _count?: { matriculas: number } }

export function useAcaRefs() {
  return useQuery({ queryKey: ['aca-refs'], queryFn: () => api.get<{ courses: Ref[]; offerings: OfferingRef[]; periodos: PeriodoRef[]; matrizes: MatrizRef[] }>('/admin/aca/refs'), staleTime: 30_000 })
}

function crud<T>(key: string, path: string) {
  return {
    useList: (qs = '') => useQuery({ queryKey: [key, qs], queryFn: () => api.get<any>(`/admin/aca/${path}${qs}`), staleTime: 5_000 }),
  }
}

export const usePeriodos = () => useQuery({ queryKey: ['aca-periodos'], queryFn: () => api.get<{ periodos: Periodo[] }>('/admin/aca/periodos'), staleTime: 5_000 })
export const useDisciplinas = (courseId?: number) => useQuery({ queryKey: ['aca-disciplinas', courseId], queryFn: () => api.get<{ disciplinas: Disciplina[] }>(`/admin/aca/disciplinas${courseId ? `?courseId=${courseId}` : ''}`), staleTime: 5_000 })
export const useMatrizes = (courseId?: number) => useQuery({ queryKey: ['aca-matrizes', courseId], queryFn: () => api.get<{ matrizes: Matriz[] }>(`/admin/aca/matrizes${courseId ? `?courseId=${courseId}` : ''}`), staleTime: 5_000 })
export const useTurmas = () => useQuery({ queryKey: ['aca-turmas'], queryFn: () => api.get<{ turmas: Turma[] }>('/admin/aca/turmas'), staleTime: 5_000 })

export function useCatalogoMut() {
  const qc = useQueryClient()
  const inval = (...keys: string[]) => keys.forEach((k) => void qc.invalidateQueries({ queryKey: [k] }))
  return {
    createPeriodo: useMutation({ mutationFn: (b: any) => api.post('/admin/aca/periodos', b), onSuccess: () => inval('aca-periodos', 'aca-refs') }),
    delPeriodo: useMutation({ mutationFn: (id: number) => api.delete(`/admin/aca/periodos/${id}`), onSuccess: () => inval('aca-periodos', 'aca-refs') }),
    createDisciplina: useMutation({ mutationFn: (b: any) => api.post('/admin/aca/disciplinas', b), onSuccess: () => inval('aca-disciplinas') }),
    delDisciplina: useMutation({ mutationFn: (id: number) => api.delete(`/admin/aca/disciplinas/${id}`), onSuccess: () => inval('aca-disciplinas') }),
    createMatriz: useMutation({ mutationFn: (b: any) => api.post('/admin/aca/matrizes', b), onSuccess: () => inval('aca-matrizes', 'aca-refs') }),
    addComponente: useMutation({ mutationFn: ({ matrizId, ...b }: any) => api.post(`/admin/aca/matrizes/${matrizId}/componentes`, b), onSuccess: () => inval('aca-matrizes') }),
    delComponente: useMutation({ mutationFn: ({ matrizId, compId }: any) => api.delete(`/admin/aca/matrizes/${matrizId}/componentes/${compId}`), onSuccess: () => inval('aca-matrizes') }),
    createTurma: useMutation({ mutationFn: (b: any) => api.post('/admin/aca/turmas', b), onSuccess: () => inval('aca-turmas') }),
    updateTurma: useMutation({ mutationFn: ({ id, ...b }: any) => api.patch(`/admin/aca/turmas/${id}`, b), onSuccess: () => inval('aca-turmas') }),
    delTurma: useMutation({ mutationFn: (id: number) => api.delete(`/admin/aca/turmas/${id}`), onSuccess: () => inval('aca-turmas') }),
  }
}
