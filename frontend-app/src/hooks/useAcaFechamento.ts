import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface Regras { mediaAprovacao: number; frequenciaMinima: number; recuperacaoHabilitada: boolean; recuperacaoMin: number; mediaAprovacaoRecuperacao: number }
export interface FechamentoLinha { matriculaId: number; ra: string | null; nome: string; media: number | null; completo: boolean; faltas: number; freqPct: number; situacao: string; observacao: string | null; fechadoEm: string | null }
export interface ConselhoCell { resultadoId: number; situacao: string; media: number | null; freqPct: number; observacao: string | null }
export interface ConselhoLinha { matriculaId: number; ra: string | null; nome: string; cells: Record<number, ConselhoCell>; situacaoGeral: string; reprovadas: number; recuperacoes: number }

export const SITUACAO_LABEL: Record<string, string> = {
  APROVADO: 'Aprovado', RECUPERACAO: 'Recuperação', REPROVADO_NOTA: 'Reprovado (nota)',
  REPROVADO_FREQUENCIA: 'Reprovado (frequência)', REPROVADO: 'Reprovado', EM_ANDAMENTO: 'Em andamento',
}
export function situacaoTone(s: string): 'success' | 'warning' | 'danger' | 'neutral' {
  if (s === 'APROVADO') return 'success'
  if (s === 'RECUPERACAO') return 'warning'
  if (s.startsWith('REPROVADO')) return 'danger'
  return 'neutral'
}

export function useAcaConfig() {
  return useQuery({ queryKey: ['aca-config'], queryFn: () => api.get<{ regras: Regras }>('/admin/aca/config'), staleTime: 30_000 })
}
export function useAcaConfigMut() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (b: Partial<Regras>) => api.put('/admin/aca/config', b), onSuccess: () => void qc.invalidateQueries({ queryKey: ['aca-config'] }) })
}

export function useFechamento(diarioId: number | null) {
  return useQuery({
    queryKey: ['aca-fechamento', diarioId],
    queryFn: () => api.get<{ regras: Regras; disciplina: { nome: string } | null; linhas: FechamentoLinha[]; fechado: boolean }>(`/admin/aca/diarios/${diarioId}/fechamento`),
    enabled: diarioId !== null, staleTime: 3_000,
  })
}
export function useFecharDiario(diarioId: number) {
  const qc = useQueryClient()
  return useMutation({ mutationFn: () => api.post(`/admin/aca/diarios/${diarioId}/fechar`, {}), onSuccess: () => void qc.invalidateQueries({ queryKey: ['aca-fechamento', diarioId] }) })
}

export function useConselho(turmaId: number | null) {
  return useQuery({
    queryKey: ['aca-conselho', turmaId],
    queryFn: () => api.get<{ turma: { nome: string }; disciplinas: { id: number; nome: string }[]; linhas: ConselhoLinha[]; ata: string | null; fechadoEm: string | null }>(`/admin/aca/turmas/${turmaId}/conselho`),
    enabled: turmaId !== null, staleTime: 3_000,
  })
}
export function useConselhoMut(turmaId: number) {
  const qc = useQueryClient()
  const inval = () => void qc.invalidateQueries({ queryKey: ['aca-conselho', turmaId] })
  return {
    salvarAta: useMutation({ mutationFn: (b: { ata: string; fechar?: boolean }) => api.put(`/admin/aca/turmas/${turmaId}/conselho`, b), onSuccess: inval }),
    ajustarResultado: useMutation({ mutationFn: ({ id, ...b }: { id: number; situacao?: string; observacao?: string }) => api.patch(`/admin/aca/resultados/${id}`, b), onSuccess: inval }),
  }
}
