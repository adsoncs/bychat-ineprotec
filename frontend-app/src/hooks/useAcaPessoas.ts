import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface Pessoa { papel: string; nome: string; documento: string | null; ra?: string | null; email: string | null; alunoId?: number; refId: number; ativo?: boolean; extra?: string | null }
export interface FichaAluno {
  id: number; ra: string | null; cpf: string | null; dataNascimento: string | null; sexo: string | null; nomeSocial: string | null; ativo: boolean
  rg: string | null; rgOrgaoEmissor: string | null; racaCor: string | null; nacionalidade: string | null; naturalidade: string | null
  estadoCivil: string | null; religiao: string | null; nomePai: string | null; nomeMae: string | null; codigoInep: string | null; emancipado: boolean
  codigoGdae: string | null; enemAno: number | null; enemInscricao: string | null; enemNota: number | null; podeSairSozinho: boolean
  documentosJson: any; socioEconomicoJson: any; enderecoJson: any; pessoasAutorizadasJson: any
  lead: { nome: string; email: string; whatsapp: string }
  responsaveis: Array<{ id: number; nome: string; cpf: string | null; parentesco: string | null; tipo: string; telefone: string | null; email: string | null }>
  matriculas: Array<{ id: number; status: string }>
}
export interface FichaProfessor { id: number; userId: number; nome: string; email: string | null; titulacao: string | null; regime: string; valorHoraCentavos: number; ativo: boolean; orientador: boolean; observacao: string | null; dadosJson: any }

export const RESP_TIPOS: Array<{ key: string; label: string }> = [
  { key: 'CONTRATO', label: 'Contrato' }, { key: 'FINANCEIRO', label: 'Financeiro' }, { key: 'PEDAGOGICO', label: 'Pedagógico' }, { key: 'LEGAL', label: 'Legal' }, { key: 'FAMILIAR', label: 'Familiar' },
]

export const PAPEL_LABEL: Record<string, { label: string; tone: 'success' | 'accent' | 'info' | 'warning' | 'neutral' }> = {
  ALUNO: { label: 'Aluno', tone: 'success' }, PROFESSOR: { label: 'Professor', tone: 'accent' },
  ORIENTADOR: { label: 'Orientador', tone: 'neutral' },
  COORDENADOR: { label: 'Coordenador', tone: 'info' }, CANDIDATO: { label: 'Candidato', tone: 'warning' },
}

export const usePessoas = (papel: string, q: string) => {
  const qs = new URLSearchParams()
  if (papel) qs.set('papel', papel); if (q) qs.set('q', q)
  const s = qs.toString()
  return useQuery({ queryKey: ['aca-pessoas', papel, q], queryFn: () => api.get<{ pessoas: Pessoa[]; counts: Record<string, number> }>(`/admin/aca/pessoas${s ? `?${s}` : ''}`), staleTime: 3_000 })
}
export const useFichaAluno = (id: number | null) =>
  useQuery({ queryKey: ['aca-ficha', id], queryFn: () => api.get<{ aluno: FichaAluno }>(`/admin/aca/alunos/${id}`), enabled: id !== null })

export function useSalvarFicha(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (b: any) => api.patch(`/admin/aca/alunos/${id}`, b),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['aca-ficha', id] }); void qc.invalidateQueries({ queryKey: ['aca-pessoas'] }) },
  })
}

export function useResponsavelMut(alunoId: number) {
  const qc = useQueryClient()
  const inval = () => void qc.invalidateQueries({ queryKey: ['aca-ficha', alunoId] })
  return {
    criar: useMutation({ mutationFn: (b: any) => api.post(`/admin/aca/alunos/${alunoId}/responsaveis`, b), onSuccess: inval }),
    atualizar: useMutation({ mutationFn: ({ rid, ...b }: any) => api.put(`/admin/aca/alunos/${alunoId}/responsaveis/${rid}`, b), onSuccess: inval }),
    excluir: useMutation({ mutationFn: (rid: number) => api.delete(`/admin/aca/alunos/${alunoId}/responsaveis/${rid}`), onSuccess: inval }),
  }
}

export const useFichaProfessor = (id: number | null) =>
  useQuery({ queryKey: ['aca-ficha-prof', id], queryFn: () => api.get<{ docente: FichaProfessor }>(`/admin/aca/docente/docentes/${id}`), enabled: id !== null })

export function useSalvarProfessor(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (b: any) => api.put(`/admin/aca/docente/docentes/${id}`, b),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['aca-ficha-prof', id] }); void qc.invalidateQueries({ queryKey: ['aca-pessoas'] }) },
  })
}
