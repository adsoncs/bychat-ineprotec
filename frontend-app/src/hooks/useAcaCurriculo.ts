import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface GradeComponente { componenteId: number; fase: number; obrigatoria: boolean; disciplina: string; codigo: string | null; cargaHoraria: number; status: string; media: number | null }
export interface Grade { matriculaId: number; turma: string; matrizId: number | null; componentes: GradeComponente[]; resumo: Record<string, number>; semMatriz: boolean }
export interface ComponenteRef { id: number; matrizId: number; fase: number; nome: string; codigo: string | null; cargaHoraria: number }
export interface Equivalencia { id: number; componenteId: number; componenteEquivalenteId: number; bidirecional: boolean; observacao: string | null; componenteNome: string; equivalenteNome: string }
export interface Aproveitamento {
  id: number; matriculaId: number; alunoId: number; componenteId: number; origem: string; instituicaoOrigem: string | null
  disciplinaOrigem: string | null; cargaHorariaAproveitada: number; nota: number | null; status: string; parecer: string | null
  decididoEm: string | null; createdAt: string; alunoNome: string; ra: string | null; componenteNome: string
}
export interface Dependencia { id: number; matriculaId: number; componenteId: number; tipo: string; turmaId: number | null; situacao: string; observacao: string | null; componenteNome: string }

export const GRADE_STATUS: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'accent' }> = {
  APROVADO: { label: 'Aprovado', tone: 'success' }, CURSANDO: { label: 'Cursando', tone: 'info' },
  APROVEITADO: { label: 'Aproveitado', tone: 'accent' }, DEPENDENCIA: { label: 'Dependência', tone: 'warning' },
  REPROVADO: { label: 'Reprovado', tone: 'danger' }, PENDENTE: { label: 'Pendente', tone: 'neutral' },
}
export const AP_STATUS_LABEL: Record<string, string> = { SOLICITADO: 'Solicitado', DEFERIDO: 'Deferido', INDEFERIDO: 'Indeferido' }

export const useGrade = (matriculaId: number | null) =>
  useQuery({ queryKey: ['aca-grade', matriculaId], queryFn: () => api.get<Grade>(`/admin/aca/curriculo/grade/${matriculaId}`), enabled: matriculaId !== null })

export const useComponentes = (matrizId: number | null) =>
  useQuery({ queryKey: ['aca-comp', matrizId], queryFn: () => api.get<{ componentes: ComponenteRef[] }>(`/admin/aca/curriculo/componentes?matrizId=${matrizId}`), enabled: matrizId !== null, staleTime: 30_000 })

export const useEquivalencias = (componenteId?: number) =>
  useQuery({ queryKey: ['aca-equiv', componenteId ?? 'all'], queryFn: () => api.get<{ equivalencias: Equivalencia[] }>(`/admin/aca/curriculo/equivalencias${componenteId ? `?componenteId=${componenteId}` : ''}`), staleTime: 10_000 })

export const useAproveitamentos = (status = '', matriculaId?: number) => {
  const qs = new URLSearchParams()
  if (status) qs.set('status', status); if (matriculaId) qs.set('matriculaId', String(matriculaId))
  const s = qs.toString()
  return useQuery({ queryKey: ['aca-aprov', status, matriculaId], queryFn: () => api.get<{ aproveitamentos: Aproveitamento[]; counts: Record<string, number> }>(`/admin/aca/curriculo/aproveitamentos${s ? `?${s}` : ''}`), staleTime: 3_000 })
}

export const useDependencias = (matriculaId: number | null) =>
  useQuery({ queryKey: ['aca-dep', matriculaId], queryFn: () => api.get<{ dependencias: Dependencia[] }>(`/admin/aca/curriculo/dependencias?matriculaId=${matriculaId}`), enabled: matriculaId !== null, staleTime: 3_000 })

export function useCurriculoMut() {
  const qc = useQueryClient()
  const inval = () => {
    for (const k of ['aca-grade', 'aca-equiv', 'aca-aprov', 'aca-dep']) void qc.invalidateQueries({ queryKey: [k] })
  }
  return {
    criarEquivalencia: useMutation({ mutationFn: (b: { componenteId: number; componenteEquivalenteId: number; observacao?: string }) => api.post('/admin/aca/curriculo/equivalencias', b), onSuccess: inval }),
    excluirEquivalencia: useMutation({ mutationFn: (id: number) => api.delete(`/admin/aca/curriculo/equivalencias/${id}`), onSuccess: inval }),
    criarAproveitamento: useMutation({ mutationFn: (b: any) => api.post('/admin/aca/curriculo/aproveitamentos', b), onSuccess: inval }),
    decidirAproveitamento: useMutation({ mutationFn: ({ id, ...b }: { id: number; status: string; parecer?: string }) => api.put(`/admin/aca/curriculo/aproveitamentos/${id}`, b), onSuccess: inval }),
    criarDependencia: useMutation({ mutationFn: (b: any) => api.post('/admin/aca/curriculo/dependencias', b), onSuccess: inval }),
    atualizarDependencia: useMutation({ mutationFn: ({ id, ...b }: { id: number; situacao?: string }) => api.put(`/admin/aca/curriculo/dependencias/${id}`, b), onSuccess: inval }),
  }
}
