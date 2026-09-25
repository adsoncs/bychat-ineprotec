import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

// Classificação do processo seletivo — Fase 4 da consolidação ERP × Portal.
// As mesmas ações existiam em /admin/aca/vestibular, com régua própria e sem
// histórico. Aqui o corte é o do tipo de avaliação (redação, ENEM ou prova) com
// ajuste por oferta, e toda mudança de situação vira log no candidato.

export interface CandidatoClassificacao {
  id: number
  status: string
  notaClassificacao: number | null
  posicaoClassificacao: number | null
  corteAplicavel: number | null
  inscritoEm: string
  classificadoEm: string | null
  convocadoEm: string | null
  lead: { id: number; nome: string; email: string | null }
  offering: { id: number; nome: string } | null
}

export interface Classificacao {
  process: {
    id: number
    nome: string
    evaluationType: string | null
    corte: number | null
    criterioCorte: string
  }
  registrations: CandidatoClassificacao[]
  resumo: { total: number; semNota: number; porStatus: Record<string, number> }
}

export interface ResultadoClassificacao {
  total: number
  classificados: number
  reprovados: number
  preservados: number
  semNota: number
  corte: number | null
  criterioCorte: string
}

export const useClassificacao = (processId: number | null) =>
  useQuery({
    queryKey: ['edu', 'classification', processId],
    queryFn: () => api.get<Classificacao>(`/admin/educacional/selection-processes/${processId}/classification`),
    enabled: !!processId,
  })

export function useClassificacaoMut(processId: number | null) {
  const qc = useQueryClient()
  const invalidar = () => qc.invalidateQueries({ queryKey: ['edu', 'classification', processId] })
  return {
    classificar: useMutation({
      mutationFn: (b: { criterio?: string }) =>
        api.post<ResultadoClassificacao>(`/admin/educacional/selection-processes/${processId}/classify`, b),
      onSuccess: invalidar,
    }),
    convocar: useMutation({
      mutationFn: (b: { qtdVagas: number }) =>
        api.post<{ convocados: number; vagasOciosas: number }>(`/admin/educacional/selection-processes/${processId}/convoke`, b),
      onSuccess: invalidar,
    }),
  }
}
