import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface ResponsavelRef { id: number; nome: string; parentesco: string | null; tipo: string }
export interface AlunoPortal { id: number; ra: string | null; nome: string; concluido: boolean; responsaveis: ResponsavelRef[] }
export interface LinkGerado { url: string; token: string; expiraEm: string }
export interface CandidatoRow { id: number; candidateCode: string; status: string; nome: string | null; url: string }
export interface CursoRef { id: number; nome: string }
export interface Coordenador { id: number; courseId: number; nome: string; email: string | null; ativo: boolean; cursoNome: string }

export function useAlunosPortal(q: string) {
  return useQuery({
    queryKey: ['aca-pp-alunos', q],
    queryFn: () => api.get<{ alunos: AlunoPortal[] }>(`/admin/aca/portal-plus/alunos${q ? `?q=${encodeURIComponent(q)}` : ''}`),
    staleTime: 5_000,
  })
}
export function useCandidatosPortal(q: string) {
  return useQuery({
    queryKey: ['aca-pp-candidatos', q],
    queryFn: () => api.get<{ candidatos: CandidatoRow[] }>(`/admin/aca/portal-plus/candidatos${q ? `?q=${encodeURIComponent(q)}` : ''}`),
    staleTime: 5_000,
  })
}
export const useCursosPortal = () =>
  useQuery({ queryKey: ['aca-pp-cursos'], queryFn: () => api.get<{ cursos: CursoRef[] }>('/admin/aca/portal-plus/cursos'), staleTime: 60_000 })
export const useCoordenadores = () =>
  useQuery({ queryKey: ['aca-pp-coords'], queryFn: () => api.get<{ coordenadores: Coordenador[] }>('/admin/aca/portal-plus/coordenadores'), staleTime: 5_000 })

export function useCoordenadorMut() {
  const qc = useQueryClient()
  const inval = () => void qc.invalidateQueries({ queryKey: ['aca-pp-coords'] })
  return {
    criar: useMutation({ mutationFn: (b: { nome: string; email?: string; courseId: number }) => api.post('/admin/aca/portal-plus/coordenadores', b), onSuccess: inval }),
    atualizar: useMutation({ mutationFn: ({ id, ...b }: { id: number; nome?: string; email?: string; courseId?: number; ativo?: boolean }) => api.put(`/admin/aca/portal-plus/coordenadores/${id}`, b), onSuccess: inval }),
  }
}

export function useGerarLinkPlus() {
  return useMutation({
    mutationFn: (b: { tipo: 'responsavel' | 'exaluno' | 'coord'; id: number; dias?: number }) => api.post<LinkGerado>('/admin/aca/portal-plus/link', b),
  })
}
