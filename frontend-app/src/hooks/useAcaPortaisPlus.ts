import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface ResponsavelRef { id: number; nome: string; parentesco: string | null; tipo: string }
export interface AlunoPortal { id: number; ra: string | null; nome: string; concluido: boolean; responsaveis: ResponsavelRef[] }
export interface LinkGerado { url: string; token: string; expiraEm: string }

export function useAlunosPortal(q: string) {
  return useQuery({
    queryKey: ['aca-pp-alunos', q],
    queryFn: () => api.get<{ alunos: AlunoPortal[] }>(`/admin/aca/portal-plus/alunos${q ? `?q=${encodeURIComponent(q)}` : ''}`),
    staleTime: 5_000,
  })
}

export function useGerarLinkPlus() {
  return useMutation({
    mutationFn: (b: { tipo: 'responsavel' | 'exaluno'; id: number; dias?: number }) => api.post<LinkGerado>('/admin/aca/portal-plus/link', b),
  })
}
