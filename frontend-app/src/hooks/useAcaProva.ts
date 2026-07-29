import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

// Prova online do processo seletivo. O gabarito só existe no lado admin — o
// endpoint do candidato nunca o devolve, e nada aqui deve tentar exibi-lo em
// uma tela que o candidato acesse.

export interface Alternativa { id: string; texto: string }

export interface Questao {
  id: number
  area: string
  enunciado: string
  tipo: 'OBJETIVA' | 'DISSERTATIVA'
  alternativas: Alternativa[] | null
  gabarito: string | null
  peso: number
  dificuldade: string | null
  ativa: boolean
}

export interface Prova {
  id: number
  titulo: string
  instrucoes: string | null
  processoId: number | null
  duracaoMinutos: number
  notaMaxima: number
  inicioEm: string | null
  fimEm: string | null
  publicada: boolean
  _count?: { itens: number; aplicacoes: number }
}

export interface Aplicacao {
  id: number
  provaId: number
  token: string
  candidatoNome: string
  candidatoCpf: string | null
  status: 'PENDENTE' | 'EM_ANDAMENTO' | 'ENTREGUE' | 'CORRIGIDA' | 'EXPIRADA'
  iniciadoEm: string | null
  entregueEm: string | null
  notaObjetiva: number | null
  notaDissertativa: number | null
  notaFinal: number | null
  _count?: { respostas: number }
}

export interface ItemCorrecao {
  aplicacaoId: number
  candidato: string
  provaId: number
  prova: string
  questaoId: number
  enunciado: string
  resposta: string | null
  notaManual: number | null
}

export const APLICACAO_STATUS: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  PENDENTE: { label: 'Não iniciada', tone: 'neutral' },
  EM_ANDAMENTO: { label: 'Em andamento', tone: 'warning' },
  ENTREGUE: { label: 'Entregue — aguarda correção', tone: 'warning' },
  CORRIGIDA: { label: 'Corrigida', tone: 'success' },
  EXPIRADA: { label: 'Tempo esgotado', tone: 'danger' },
}

export const useQuestoes = (filtros: { area?: string; tipo?: string } = {}) => {
  const qs = new URLSearchParams()
  if (filtros.area) qs.set('area', filtros.area)
  if (filtros.tipo) qs.set('tipo', filtros.tipo)
  const suffix = qs.toString() ? `?${qs}` : ''
  return useQuery({
    queryKey: ['aca-questoes', filtros.area ?? '', filtros.tipo ?? ''],
    queryFn: () => api.get<{ questoes: Questao[] }>(`/admin/aca/questoes${suffix}`),
    staleTime: 5_000,
  })
}

export const useProvas = () =>
  useQuery({ queryKey: ['aca-provas'], queryFn: () => api.get<{ provas: Prova[] }>('/admin/aca/provas'), staleTime: 5_000 })

export const useAplicacoes = (provaId: number | null) =>
  useQuery({
    queryKey: ['aca-prova-aplicacoes', provaId],
    queryFn: () => api.get<{ aplicacoes: Aplicacao[] }>(`/admin/aca/provas/${provaId}/aplicacoes`),
    enabled: provaId !== null,
    staleTime: 3_000,
  })

export const useFilaCorrecao = () =>
  useQuery({
    queryKey: ['aca-prova-correcao'],
    queryFn: () => api.get<{ fila: ItemCorrecao[]; total: number }>('/admin/aca/provas/correcao/fila'),
    staleTime: 3_000,
  })

export function useProvaMut() {
  const qc = useQueryClient()
  const inval = () => {
    void qc.invalidateQueries({ queryKey: ['aca-provas'] })
    void qc.invalidateQueries({ queryKey: ['aca-prova-aplicacoes'] })
    void qc.invalidateQueries({ queryKey: ['aca-prova-correcao'] })
  }
  return {
    criarQuestao: useMutation({
      mutationFn: (b: Record<string, unknown>) => api.post<{ questao: Questao }>('/admin/aca/questoes', b),
      onSuccess: () => void qc.invalidateQueries({ queryKey: ['aca-questoes'] }),
    }),
    criarProva: useMutation({
      mutationFn: (b: Record<string, unknown>) => api.post<{ prova: Prova }>('/admin/aca/provas', b),
      onSuccess: inval,
    }),
    publicar: useMutation({
      mutationFn: (id: number) => api.post<{ prova: Prova }>(`/admin/aca/provas/${id}/publicar`, {}),
      onSuccess: inval,
    }),
    gerarAcesso: useMutation({
      mutationFn: ({ provaId, ...b }: { provaId: number; nome: string; cpf?: string }) =>
        api.post<{ aplicacao: Aplicacao; url: string }>(`/admin/aca/provas/${provaId}/candidatos`, b),
      onSuccess: inval,
    }),
    corrigir: useMutation({
      mutationFn: (b: { aplicacaoId: number; questaoId: number; nota: number; parecer?: string }) =>
        api.post<{ aplicacao: Aplicacao }>('/admin/aca/provas/correcao', b),
      onSuccess: inval,
    }),
  }
}

// ─────────── Importadores (dry-run) ───────────

export interface ErroLinha { linha: number; campo?: string; valor?: string; mensagem: string }

export interface ResultadoAnalise {
  tipo: string
  totalLinhas: number
  validas: number
  invalidas: number
  duplicadas: number
  erros: ErroLinha[]
  amostra: Record<string, unknown>[]
  simulacao: boolean
}

export const TIPOS_IMPORT = [
  { id: 'disciplinas', label: 'Disciplinas', ajuda: 'Catálogo de disciplinas do curso.' },
  { id: 'alunos', label: 'Alunos', ajuda: 'Cadastro básico + vínculo. Valida CPF e data de nascimento.' },
  { id: 'notas_historico', label: 'Notas do histórico', ajuda: 'Histórico do sistema legado, para o aluno não perder o que já cursou.' },
  { id: 'titulos', label: 'Títulos financeiros', ajuda: 'Parcelas em aberto na migração.' },
]

export function useImportacao() {
  return {
    analisar: useMutation({
      mutationFn: (b: { tipo: string; csv: string }) => api.post<ResultadoAnalise>('/admin/aca/importacao/analisar', b),
    }),
    executar: useMutation({
      mutationFn: (b: { tipo: string; csv: string }) =>
        api.post<ResultadoAnalise & { gravadas: number; puladas: number }>('/admin/aca/importacao/executar', { ...b, confirmado: true }),
    }),
  }
}
