import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

// Fase 4 — acervo com temporalidade (Port. MEC 315/2018) e regularidade ENADE
// (RN-1104). Duas telas com a mesma natureza: o que a instituição precisa
// provar quando o MEC pergunta.

export interface LinhaTemporalidade {
  tipo: string
  classificacao: string
  temporalidade: 'PERMANENTE' | 'TEMPORARIO'
  prazoGuardaAnos: number | null
}

export interface PanoramaAcervo {
  total: number
  classificados: number
  semClassificacao: number
  comHash: number
  semHash: number
  permanentes: number
  eliminados: number
  vencidos: number
}

export interface ArquivoElegivel {
  id: number
  nome: string
  tipo: string
  classificacao: string | null
  guardaAte: string | null
  alunoId: number | null
}

export interface TermoEliminacao {
  id: number
  numero: string
  dataTermo: string
  comissao: string
  responsavel: string | null
  observacao: string | null
  qtdItens: number
  createdAt: string
}

export const useTabelaTemporalidade = () =>
  useQuery({
    queryKey: ['aca-acervo-tabela'],
    queryFn: () => api.get<{ tabela: LinhaTemporalidade[] }>('/admin/aca/acervo/tabela-temporalidade'),
    staleTime: 300_000,
  })

export const usePanoramaAcervo = () =>
  useQuery({
    queryKey: ['aca-acervo-panorama'],
    queryFn: () => api.get<PanoramaAcervo>('/admin/aca/acervo/panorama'),
    staleTime: 5_000,
  })

export const useElegiveisEliminacao = () =>
  useQuery({
    queryKey: ['aca-acervo-elegiveis'],
    queryFn: () => api.get<{ arquivos: ArquivoElegivel[]; total: number }>('/admin/aca/acervo/elegiveis-eliminacao'),
    staleTime: 5_000,
  })

export const useTermosEliminacao = () =>
  useQuery({
    queryKey: ['aca-acervo-termos'],
    queryFn: () => api.get<{ termos: TermoEliminacao[] }>('/admin/aca/acervo/termos'),
    staleTime: 10_000,
  })

export function useAcervoMut() {
  const qc = useQueryClient()
  const inval = () => void qc.invalidateQueries({ queryKey: ['aca-acervo-'], predicate: (q) => String(q.queryKey[0]).startsWith('aca-acervo') })
  return {
    classificar: useMutation({
      mutationFn: (b: { arquivoIds?: number[] }) => api.post<{ classificados: number; erros: string[] }>('/admin/aca/acervo/classificar', b),
      onSuccess: inval,
    }),
    eliminar: useMutation({
      mutationFn: (b: { arquivoIds: number[]; comissao: string; responsavel?: string; observacao?: string }) =>
        api.post<{ termo: TermoEliminacao; eliminados: number }>('/admin/aca/acervo/eliminar', b),
      onSuccess: inval,
    }),
  }
}

// ─────────── ENADE ───────────

export interface LinhaEnade {
  vinculoId: number
  alunoId: number
  nome: string
  ra: string | null
  situacaoVinculo: string
  regular: boolean
  motivo: string
}

export interface VerificacaoEnade {
  regular: boolean
  motivo: string
  registros: { ano: number; condicao: string; situacao: string }[]
}

export const ENADE_SITUACAO: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  PENDENTE: { label: 'Pendente', tone: 'warning' },
  INSCRITO: { label: 'Inscrito', tone: 'neutral' },
  PARTICIPOU: { label: 'Participou', tone: 'success' },
  DISPENSADO: { label: 'Dispensado', tone: 'success' },
  IRREGULAR: { label: 'Irregular', tone: 'danger' },
}

export const usePainelEnade = () =>
  useQuery({
    queryKey: ['aca-enade-painel'],
    queryFn: () => api.get<{ linhas: LinhaEnade[]; irregulares: number; total: number }>('/admin/aca/enade/painel'),
    staleTime: 10_000,
  })

export const useRegularidadeAluno = (alunoId: number | null) =>
  useQuery({
    queryKey: ['aca-enade-aluno', alunoId],
    queryFn: () => api.get<VerificacaoEnade>(`/admin/aca/enade/aluno/${alunoId}`),
    enabled: alunoId !== null,
    staleTime: 10_000,
  })

export function useEnadeMut() {
  const qc = useQueryClient()
  return {
    registrar: useMutation({
      mutationFn: (b: { alunoId: number; ano: number; condicao: string; situacao: string; dispensaMotivo?: string; observacao?: string }) =>
        api.post('/admin/aca/enade/registrar', b),
      onSuccess: () => void qc.invalidateQueries({ queryKey: ['aca-enade-painel'] }),
    }),
  }
}
