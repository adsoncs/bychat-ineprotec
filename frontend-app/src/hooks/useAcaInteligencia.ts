import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

// Fase 5 — evasão explicável, produção docente e BI por persona.

export interface FatorRisco { fator: string; pontos: number; detalhe: string }

export interface RiscoEvasao {
  vinculoId: number
  alunoId: number
  nome: string
  ra: string | null
  score: number
  faixa: 'BAIXO' | 'MEDIO' | 'ALTO' | 'CRITICO'
  fatores: FatorRisco[]
  acaoSugerida: string
}

export const FAIXA: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral'; barra: string }> = {
  BAIXO: { label: 'Baixo', tone: 'success', barra: 'bg-success' },
  MEDIO: { label: 'Médio', tone: 'warning', barra: 'bg-warning' },
  ALTO: { label: 'Alto', tone: 'danger', barra: 'bg-danger/70' },
  CRITICO: { label: 'Crítico', tone: 'danger', barra: 'bg-danger' },
}

export const FATOR_LABEL: Record<string, string> = {
  frequencia: 'Frequência',
  desempenho: 'Desempenho',
  financeiro: 'Financeiro',
  engajamento: 'Engajamento no WhatsApp',
  portal: 'Acesso ao portal',
}

export const usePainelEvasao = (filtros: { courseId?: number | null; scoreMinimo?: number } = {}) => {
  const qs = new URLSearchParams()
  if (filtros.courseId) qs.set('courseId', String(filtros.courseId))
  if (filtros.scoreMinimo != null) qs.set('scoreMinimo', String(filtros.scoreMinimo))
  const suffix = qs.toString() ? `?${qs}` : ''
  return useQuery({
    queryKey: ['aca-evasao', filtros.courseId ?? null, filtros.scoreMinimo ?? 0],
    // O painel recalcula aluno a aluno; vale um staleTime maior.
    queryFn: () => api.get<{ linhas: RiscoEvasao[]; total: number; porFaixa: Record<string, number> }>(`/admin/aca/evasao/painel${suffix}`),
    staleTime: 60_000,
  })
}

export const useRiscoVinculo = (vinculoId: number | null) =>
  useQuery({
    queryKey: ['aca-evasao-vinculo', vinculoId],
    queryFn: () => api.get<RiscoEvasao>(`/admin/aca/evasao/vinculo/${vinculoId}`),
    enabled: vinculoId !== null,
    staleTime: 30_000,
  })

// ─────────── Produção docente ───────────

export interface LinhaProducao {
  docenteId: number
  userId: number
  nome: string
  titulacao: string | null
  regime: string
  aulasMinistradas: number
  horasAula: number
  horasAtividades: number
  horasTotal: number
  valorAtividadesCentavos: number
  valorHoraCentavos: number
  valorAulasCentavos: number
  valorTotalCentavos: number
  turmas: string[]
}

export const useProducaoDocente = (competencia: string) =>
  useQuery({
    queryKey: ['aca-producao-docente', competencia],
    queryFn: () => api.get<{ competencia: string; linhas: LinhaProducao[]; totalHoras: number; totalCentavos: number }>(
      `/admin/aca/producao-docente?competencia=${encodeURIComponent(competencia)}`,
    ),
    enabled: /^\d{4}-\d{2}$/.test(competencia),
    staleTime: 15_000,
  })

// ─────────── BI por persona ───────────

export interface BiDirecao {
  alunos: { ativos: number; formados: number; evadidos: number; trancados: number; total: number }
  risco: { emRisco: number; porFaixa: Record<string, number>; prioridade: RiscoEvasao[] }
  financeiro: { recebidoCentavos: number; aVencerCentavos: number; vencidoCentavos: number; inadimplenciaPct: number }
  geradoEm: string
}

export interface BiCoordenacao {
  disciplinas: { disciplinaId: number; nome: string; alunos: number; reprovacaoPct: number; mediaTurma: number | null; frequenciaMedia: number }[]
  alunosEmRisco: RiscoEvasao[]
  porFaixa: Record<string, number>
}

export interface BiSecretaria {
  requerimentos: { abertos: number; atrasados: number; total: number }
  diarios: { total: number; fechados: number; pendentes: number }
  documentos: { aConferir: number; acervoSemClassificacao: number }
  regimesEspeciais: { aguardandoAnalise: number }
}

export const useBiDirecao = (enabled = true) =>
  useQuery({ queryKey: ['aca-bi-direcao'], queryFn: () => api.get<BiDirecao>('/admin/aca/bi/direcao'), enabled, staleTime: 60_000 })

export const useBiCoordenacao = (courseId: number | null, enabled = true) =>
  useQuery({
    queryKey: ['aca-bi-coordenacao', courseId],
    queryFn: () => api.get<BiCoordenacao>(`/admin/aca/bi/coordenacao${courseId ? `?courseId=${courseId}` : ''}`),
    enabled,
    staleTime: 60_000,
  })

export const useBiSecretaria = (enabled = true) =>
  useQuery({ queryKey: ['aca-bi-secretaria'], queryFn: () => api.get<BiSecretaria>('/admin/aca/bi/secretaria'), enabled, staleTime: 30_000 })
