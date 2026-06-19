import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface Pessoa { papel: string; nome: string; documento: string | null; ra?: string | null; email: string | null; alunoId?: number; refId: number; ativo?: boolean; extra?: string | null }
export interface FichaAluno {
  id: number; ra: string | null; cpf: string | null; dataNascimento: string | null; sexo: string | null; nomeSocial: string | null; ativo: boolean
  rg: string | null; rgOrgaoEmissor: string | null; racaCor: string | null; nacionalidade: string | null; naturalidade: string | null
  estadoCivil: string | null; religiao: string | null; nomePai: string | null; nomeMae: string | null; codigoInep: string | null; emancipado: boolean
  documentosJson: any; socioEconomicoJson: any; enderecoJson: any
  lead: { nome: string; email: string; whatsapp: string }
  responsaveis: Array<{ id: number; nome: string; parentesco: string | null; tipo: string }>
  matriculas: Array<{ id: number; status: string }>
}

export const PAPEL_LABEL: Record<string, { label: string; tone: 'success' | 'accent' | 'info' | 'warning' }> = {
  ALUNO: { label: 'Aluno', tone: 'success' }, PROFESSOR: { label: 'Professor', tone: 'accent' },
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
