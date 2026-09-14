// Módulo Pesquisas / NPS — acesso à API.
//
// Nenhuma conta de NPS acontece aqui: o índice vem pronto do backend
// (computeSurveyResults). NPS não é média de notas, é %promotores − %detratores
// sobre quem respondeu a pergunta de recomendação — repetir essa fórmula no
// navegador é o caminho mais curto para a tela mostrar um número e o export outro.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export type NpsCategory = 'promoter' | 'passive' | 'detractor'

export const CATEGORY_LABEL: Record<NpsCategory, string> = {
  promoter: 'Promotor',
  passive: 'Neutro',
  detractor: 'Detrator',
}

export interface SurveyQuestion {
  id: string
  key: string
  type: 'scale' | 'text' | 'textarea' | 'select' | 'statement'
  label: string
  required: boolean
  helpText?: string
  options?: { value: string; label: string }[]
  scaleMin?: number
  scaleMax?: number
  scaleMinLabel?: string
  scaleMaxLabel?: string
  scaleLabels?: Record<string, string>
  isNps?: boolean
}

export interface Survey {
  id: number
  name: string
  description: string | null
  questions: SurveyQuestion[]
  npsQuestionKey: string | null
  messages: Record<string, string> | null
  flowId: number | null
  expiresAfterHours: number
  active: boolean
  createdAt: string
  updatedAt: string
  responses?: number
  invites?: number
}

export interface SurveyResults {
  survey: { id: number; name: string; description: string | null; npsQuestionKey: string | null }
  totals: { responses: number; invites: number; responseRate: number | null; pending: number; expired: number }
  nps: {
    score: number | null
    promoters: number
    passives: number
    detractors: number
    answered: number
    distribution: { score: number; count: number }[]
  }
  byQuestion: {
    key: string
    label: string
    isNps: boolean
    scaleMin: number
    scaleMax: number
    answered: number
    avg: number | null
    counts: Record<string, number>
  }[]
  comments: {
    key: string
    text: string
    responseId: number
    leadId: number | null
    nome: string | null
    npsScore: number | null
    npsCategory: NpsCategory | null
    respondedAt: string
  }[]
}

export function useSurveys() {
  return useQuery({
    queryKey: ['surveys'],
    queryFn: () => api.get<{ items: Survey[] }>('/surveys'),
    staleTime: 30_000,
  })
}

export function useSurvey(id: number | null) {
  return useQuery({
    queryKey: ['survey', id],
    queryFn: () => api.get<{ survey: Survey }>(`/surveys/${id}`),
    enabled: !!id,
  })
}

export function useSurveyResults(id: number | null) {
  return useQuery({
    queryKey: ['survey-results', id],
    queryFn: () => api.get<SurveyResults>(`/surveys/${id}/results`),
    enabled: !!id,
    staleTime: 15_000,
  })
}

export function useCreateSurvey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Partial<Survey>) => api.post<{ survey: Survey }>('/surveys', body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['surveys'] }) },
  })
}

export function useUpdateSurvey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<Survey> & { id: number }) =>
      api.put<{ survey: Survey; needsRepublish: boolean }>(`/surveys/${id}`, body),
    onSuccess: (_r, vars) => {
      void qc.invalidateQueries({ queryKey: ['surveys'] })
      void qc.invalidateQueries({ queryKey: ['survey', vars.id] })
    },
  })
}

export function useDeleteSurvey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<{ ok: true }>(`/surveys/${id}`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['surveys'] }) },
  })
}

/** Gera e publica o Flow multi-tela na Meta. Precisa rodar de novo a cada mudança
 *  nas perguntas — o Flow publicado é um retrato, não um espelho. */
export function usePublishSurveyFlow() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, connectionId }: { id: number; connectionId: number }) =>
      api.post<{ ok: true; metaFlowId: string; screenId: string; flowRowId: number }>(`/surveys/${id}/publish`, { connectionId }),
    onSuccess: (_r, vars) => {
      void qc.invalidateQueries({ queryKey: ['surveys'] })
      void qc.invalidateQueries({ queryKey: ['survey', vars.id] })
    },
  })
}

export interface DispatchBody {
  id: number
  targets: { phone: string; nome?: string | null }[]
  templateName?: string | null
  templateLanguage?: string
  buttonIndex?: number
}

export function useDispatchSurvey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: DispatchBody) =>
      api.post<{ ok: true; sent: number; skipped: number; failed: number; errors: string[] }>(`/surveys/${id}/dispatch`, body),
    onSuccess: (_r, vars) => {
      void qc.invalidateQueries({ queryKey: ['survey-results', vars.id] })
      void qc.invalidateQueries({ queryKey: ['surveys'] })
    },
  })
}
