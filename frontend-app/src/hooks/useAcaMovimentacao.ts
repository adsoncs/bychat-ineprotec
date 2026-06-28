import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface Movimentacao {
  id: number
  matriculaId: number
  alunoId: number
  tipo: string
  tipoLabel: string
  statusDe: string | null
  statusPara: string | null
  turmaDestinoId: number | null
  matriculaDestinoId: number | null
  instituicaoDestino: string | null
  motivo: string | null
  dataEfeito: string
  dataRetornoPrevista: string | null
  createdAt: string
  aluno: { id: number; ra: string | null; lead: { nome: string } } | null
  turmaDestino: { id: number; nome: string } | null
}

export interface SemRematricula {
  id: number
  status: string
  alunoId: number
  aluno: { ra: string | null; lead: { nome: string } }
  turma: { id: number; nome: string; periodoLetivo: { codigo: string; dataFim: string | null } }
}

export function useMovimentacoes(tipo = '') {
  const qs = tipo ? `?tipo=${tipo}` : ''
  return useQuery({
    queryKey: ['aca-movimentacoes', tipo],
    queryFn: () => api.get<{ movimentacoes: Movimentacao[]; counters: Record<string, number> }>(`/admin/aca/movimentacoes${qs}`),
    staleTime: 3_000,
  })
}

export function useSemRematricula(enabled = true) {
  return useQuery({
    queryKey: ['aca-sem-rematricula'],
    queryFn: () => api.get<{ total: number; alunos: SemRematricula[] }>(`/admin/aca/movimentacoes/sem-rematricula`),
    enabled,
    staleTime: 10_000,
  })
}

export function useTurmasDestino(enabled = true) {
  return useQuery({
    queryKey: ['aca-turmas-destino'],
    queryFn: () => api.get<{ turmas: Array<{ id: number; nome: string; periodoLetivo: { codigo: string } }> }>(`/admin/aca/movimentacoes/turmas-destino`),
    enabled,
    staleTime: 30_000,
  })
}

export function useMovimentacaoMut() {
  const qc = useQueryClient()
  const inval = () => {
    void qc.invalidateQueries({ queryKey: ['aca-movimentacoes'] })
    void qc.invalidateQueries({ queryKey: ['aca-matriculas'] })
    void qc.invalidateQueries({ queryKey: ['aca-matricula'] })
    void qc.invalidateQueries({ queryKey: ['aca-sem-rematricula'] })
  }
  const M = <B,>(path: string) => useMutation({ mutationFn: (b: B) => api.post(`/admin/aca/movimentacoes/${path}`, b as any), onSuccess: inval })
  return {
    trancamento: M<{ matriculaId: number; motivo?: string; dataRetornoPrevista?: string }>('trancamento'),
    reingresso: M<{ matriculaId: number; motivo?: string }>('reingresso'),
    afastamento: M<{ matriculaId: number; motivo?: string; dataRetornoPrevista?: string }>('afastamento'),
    cancelamento: M<{ matriculaId: number; motivo?: string }>('cancelamento'),
    evasao: M<{ matriculaId: number; motivo?: string }>('evasao'),
    transferenciaExterna: M<{ matriculaId: number; instituicaoDestino: string; motivo?: string }>('transferencia-externa'),
    transferenciaInterna: M<{ matriculaId: number; turmaDestinoId: number; motivo?: string; remanejamento?: boolean }>('transferencia-interna'),
    atualizaSituacoes: useMutation({
      mutationFn: (b: { dryRun: boolean; matriculaIds?: number[] }) => api.post<{ dryRun: boolean; total: number; aplicadas?: number }>(`/admin/aca/movimentacoes/atualiza-situacoes`, b),
      onSuccess: inval,
    }),
  }
}
