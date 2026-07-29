import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

// Reconhecimento de saberes (LDB art. 41 + Res. CNE/CP 1/2021, art. 47).
// Nada roda sem PPCP autorizado e vigente — é a exigência do §2º.

export interface Ppcp {
  id: number
  courseId: number
  nome: string
  metodologia: string | null
  status: 'RASCUNHO' | 'AUTORIZADO' | 'SUSPENSO' | 'ENCERRADO'
  atoAutorizacao: string | null
  orgaoAutorizador: string | null
  autorizadoEm: string | null
  vigenciaAte: string | null
  observacao: string | null
  /** Autorizado E dentro da vigência — é o que permite abrir processo. */
  vigente: boolean
  vencido: boolean
  _count?: { processos: number }
}

export const PPCP_STATUS: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  RASCUNHO: { label: 'Rascunho', tone: 'neutral' },
  AUTORIZADO: { label: 'Autorizado', tone: 'success' },
  SUSPENSO: { label: 'Suspenso', tone: 'warning' },
  ENCERRADO: { label: 'Encerrado', tone: 'danger' },
}

export const PROCESSO_STATUS: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  ABERTO: { label: 'Aberto', tone: 'neutral' },
  EM_AVALIACAO: { label: 'Em avaliação', tone: 'warning' },
  DEFERIDO: { label: 'Deferido', tone: 'success' },
  INDEFERIDO: { label: 'Indeferido', tone: 'danger' },
  CANCELADO: { label: 'Cancelado', tone: 'danger' },
}

export interface ProcessoResumo {
  id: number
  protocolo: string
  status: string
  alunoId: number
  matriculaId: number | null
  itinerario: string | null
  banca: string | null
  parecerFinal: string | null
  createdAt: string
  decididoEm: string | null
  aluno: { nome: string; ra: string | null }
  ppcp: { nome: string; status: string }
  _count?: { avaliacoes: number }
}

export interface AvaliacaoComponente {
  id: number
  componenteId: number
  componente: string
  instrumento: string
  resultado: 'RECONHECIDO' | 'NAO_RECONHECIDO'
  parecer: string | null
  cargaHoraria: number
  aproveitamentoId: number | null
}

export interface ProcessoDetalhe {
  processo: ProcessoResumo & { ppcpId: number }
  ppcp: Ppcp
  reconhecidos: number
  naoReconhecidos: number
  cargaHorariaReconhecida: number
  avaliacoes: AvaliacaoComponente[]
  componentesDisponiveis: Array<{ id: number; nome: string; cargaHoraria: number }>
}

export const usePpcps = (courseId?: number | null) =>
  useQuery({
    queryKey: ['aca-ppcp', courseId ?? null],
    queryFn: () => api.get<{ ppcps: Ppcp[] }>(`/admin/aca/ppcp${courseId ? `?courseId=${courseId}` : ''}`),
    staleTime: 10_000,
  })

export const useProcessosReconhecimento = (status?: string) =>
  useQuery({
    queryKey: ['aca-reconhecimento-processos', status ?? ''],
    queryFn: () => api.get<{ processos: ProcessoResumo[] }>(
      `/admin/aca/reconhecimento/processos${status ? `?status=${status}` : ''}`,
    ),
    staleTime: 5_000,
  })

export const useProcessoReconhecimento = (id: number | null) =>
  useQuery({
    queryKey: ['aca-reconhecimento-processo', id],
    queryFn: () => api.get<ProcessoDetalhe>(`/admin/aca/reconhecimento/processos/${id}`),
    enabled: id !== null,
    staleTime: 3_000,
  })

export function useReconhecimentoMut() {
  const qc = useQueryClient()
  const inval = () => {
    void qc.invalidateQueries({ queryKey: ['aca-ppcp'] })
    void qc.invalidateQueries({ queryKey: ['aca-reconhecimento-processos'] })
    void qc.invalidateQueries({ queryKey: ['aca-reconhecimento-processo'] })
    // Reconhecer gera aproveitamento: a integralização muda.
    void qc.invalidateQueries({ queryKey: ['aca-integralizacao'] })
  }
  return {
    criarPpcp: useMutation({
      mutationFn: (b: { courseId: number; nome: string; metodologia?: string }) =>
        api.post<{ ppcp: Ppcp }>('/admin/aca/ppcp', b),
      onSuccess: inval,
    }),
    mudarStatusPpcp: useMutation({
      mutationFn: ({ id, ...b }: { id: number; status: string; atoAutorizacao?: string; orgaoAutorizador?: string; vigenciaAte?: string }) =>
        api.post<{ ppcp: Ppcp }>(`/admin/aca/ppcp/${id}/status`, b),
      onSuccess: inval,
    }),
    abrirProcesso: useMutation({
      mutationFn: (b: { ppcpId: number; alunoId: number; matriculaId?: number; itinerario?: string; banca?: string }) =>
        api.post<{ processo: ProcessoResumo }>('/admin/aca/reconhecimento/processos', b),
      onSuccess: inval,
    }),
    avaliar: useMutation({
      mutationFn: (b: { processoId: number; componenteId: number; instrumento: string; resultado: string; parecer?: string }) =>
        api.post<{ avaliacao: AvaliacaoComponente }>('/admin/aca/reconhecimento/avaliar', b),
      onSuccess: inval,
    }),
    decidir: useMutation({
      mutationFn: ({ id, ...b }: { id: number; status: string; parecerFinal?: string }) =>
        api.post<{ processo: ProcessoResumo }>(`/admin/aca/reconhecimento/processos/${id}/decidir`, b),
      onSuccess: inval,
    }),
  }
}
