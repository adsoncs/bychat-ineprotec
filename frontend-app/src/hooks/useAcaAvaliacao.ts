import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

// Esquemas de avaliação (M08): o regimento da IES como dado configurável.

export type EsquemaEscopo = 'INSTITUCIONAL' | 'CURSO' | 'MATRIZ' | 'DISCIPLINA'

export interface EsquemaComponente {
  id?: number
  sigla: string
  nome: string
  peso: number
  ordem?: number
  obrigatorio?: boolean
}

export interface Esquema {
  id: number
  escopo: EsquemaEscopo
  escopoId: number | null
  nome: string
  descricao?: string | null
  escala: string
  /// Mapa conceito→nota mínima, usado quando escala = CONCEITO.
  mapaConceitos?: Record<string, number> | null
  casasDecimais: number
  arredondamento: 'MATEMATICO' | 'CIMA' | 'BAIXO'
  formulaMedia?: string | null
  mediaAprovacao: number
  notaEliminatoria?: number | null
  exameHabilitado: boolean
  exameMinimo?: number | null
  formulaFinal?: string | null
  mediaFinalAprovacao?: number | null
  segundaChamadaHabilitada: boolean
  frequenciaMinima: number
  limiteDependencias?: number | null
  ativo: boolean
  componentes: EsquemaComponente[]
}

export interface ResultadoSimulacao {
  media: number | null
  mediaFinal: number | null
  situacao: string
  explicacao: string
  faltamNotas: string[]
  /** Preenchidos só quando o esquema adota escala conceitual. */
  conceito?: string | null
  conceitoFinal?: string | null
  /** Componentes sem nota que ainda cabem em segunda chamada. */
  cabeSegundaChamada?: string[]
}

export function useEsquemas() {
  return useQuery({
    queryKey: ['aca', 'esquemas'],
    queryFn: () => api.get<{ esquemas: Esquema[] }>('/admin/aca/esquemas'),
  })
}

export function useEsquema(id: number | null) {
  return useQuery({
    queryKey: ['aca', 'esquema', id],
    queryFn: () => api.get<{ esquema: Esquema }>(`/admin/aca/esquemas/${id}`),
    enabled: !!id,
  })
}

export function useSaveEsquema() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<Esquema> & { id?: number }) =>
      id
        ? api.put<{ esquema: Esquema }>(`/admin/aca/esquemas/${id}`, body)
        : api.post<{ esquema: Esquema }>('/admin/aca/esquemas', body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['aca'] }) },
  })
}

export function useInativarEsquema() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<{ ok: true }>(`/admin/aca/esquemas/${id}`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['aca'] }) },
  })
}

export function useSimularEsquema() {
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number; notas: Record<string, number | null>; frequencia: number; notaExame?: number | null }) =>
      api.post<{ resultado: ResultadoSimulacao }>(`/admin/aca/esquemas/${id}/simular`, body),
  })
}

export const ESCOPO_LABEL: Record<EsquemaEscopo, string> = {
  INSTITUCIONAL: 'Institucional',
  CURSO: 'Curso',
  MATRIZ: 'Matriz',
  DISCIPLINA: 'Disciplina',
}

export const SITUACAO_SIM_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  APROVADO: 'success',
  EXAME: 'warning',
  REPROVADO_NOTA: 'danger',
  REPROVADO_FREQUENCIA: 'danger',
  REPROVADO_NOTA_FREQUENCIA: 'danger',
  EM_ANDAMENTO: 'neutral',
}

export const SITUACAO_SIM_LABEL: Record<string, string> = {
  APROVADO: 'Aprovado',
  EXAME: 'Exame final',
  REPROVADO_NOTA: 'Reprovado por nota',
  REPROVADO_FREQUENCIA: 'Reprovado por falta',
  REPROVADO_NOTA_FREQUENCIA: 'Reprovado por nota e falta',
  EM_ANDAMENTO: 'Em andamento',
}
