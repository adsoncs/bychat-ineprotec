import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface AlunoLead { id: number; uid: string | null; nome: string; email: string; whatsapp: string }
export interface Responsavel { id: number; nome: string; cpf: string | null; parentesco: string | null; tipo: string; telefone: string | null; email: string | null }
export interface Aluno {
  id: number; leadId: number; ra: string | null; cpf: string | null; dataNascimento: string | null
  sexo: string | null; nomeSocial: string | null; fotoUrl: string | null; ativo: boolean; createdAt: string
  lead: AlunoLead
  responsaveis?: Responsavel[]
  matriculas?: Array<{ id: number; status: string; turmaId: number; dataMatricula: string }>
}

export function useAcaMeta() {
  return useQuery({ queryKey: ['aca-meta'], queryFn: () => api.get<{ alunos: number; turmas: number }>('/admin/aca/meta'), staleTime: 30_000 })
}

export function useAlunos(q: string) {
  return useQuery({
    queryKey: ['aca-alunos', q],
    queryFn: () => api.get<{ alunos: Aluno[]; total: number }>(`/admin/aca/alunos${q ? `?q=${encodeURIComponent(q)}` : ''}`),
    staleTime: 5_000,
  })
}

export function useAluno(id: number | null) {
  return useQuery({
    queryKey: ['aca-aluno', id],
    queryFn: () => api.get<{ aluno: Aluno }>(`/admin/aca/alunos/${id}`),
    enabled: id !== null,
  })
}

export function useLeadSearch(q: string) {
  return useQuery({
    queryKey: ['aca-lead-search', q],
    queryFn: () => api.get<{ leads: AlunoLead[] }>(`/admin/aca/leads/search?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length >= 2,
    staleTime: 2_000,
  })
}

export function usePromoteLead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (b: { leadId: number; cpf?: string; sexo?: string; dataNascimento?: string }) =>
      api.post<{ aluno: Aluno }>('/admin/aca/alunos', b),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['aca-alunos'] }); void qc.invalidateQueries({ queryKey: ['aca-meta'] }) },
  })
}

export function useUpdateAluno(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (b: Partial<Aluno>) => api.patch<{ aluno: Aluno }>(`/admin/aca/alunos/${id}`, b),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['aca-aluno', id] }); void qc.invalidateQueries({ queryKey: ['aca-alunos'] }) },
  })
}

export function useResponsavelActions(alunoId: number) {
  const qc = useQueryClient()
  const inval = () => void qc.invalidateQueries({ queryKey: ['aca-aluno', alunoId] })
  return {
    add: useMutation({ mutationFn: (b: { nome: string; tipo?: string; parentesco?: string; telefone?: string; email?: string; cpf?: string }) => api.post(`/admin/aca/alunos/${alunoId}/responsaveis`, b), onSuccess: inval }),
    remove: useMutation({ mutationFn: (rid: number) => api.delete(`/admin/aca/alunos/${alunoId}/responsaveis/${rid}`), onSuccess: inval }),
  }
}
