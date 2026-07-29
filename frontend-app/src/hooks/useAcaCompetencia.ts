import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

// Avaliação por competências (modelo SENAI). A decisão de aptidão vem do
// atendimento aos critérios CRÍTICOS — não da média.

export type ResultadoAfericao = 'ATENDE' | 'EM_DESENVOLVIMENTO' | 'NAO_ATENDE'

export const RESULTADO: Record<ResultadoAfericao, { label: string; curto: string; tone: 'success' | 'warning' | 'danger' }> = {
  ATENDE: { label: 'Atende', curto: 'A', tone: 'success' },
  EM_DESENVOLVIMENTO: { label: 'Em desenvolvimento', curto: 'D', tone: 'warning' },
  NAO_ATENDE: { label: 'Não atende', curto: 'N', tone: 'danger' },
}

export const CAPACIDADE_TIPO: Record<string, string> = {
  TECNICA: 'Técnica',
  SOCIAL: 'Social',
  ORGANIZATIVA: 'Organizativa',
  METODOLOGICA: 'Metodológica',
}

export interface Criterio {
  id: number
  capacidadeId: number
  descricao: string
  evidencia: string | null
  peso: 'CRITICO' | 'DESEJAVEL'
  ordem: number
}

export interface Capacidade {
  id: number
  componenteId: number
  tipo: string
  descricao: string
  ordem: number
  criterios: Criterio[]
}

export interface AlunoVerificacao {
  matriculaId: number
  nome: string
  ra: string | null
  apto: boolean
  nivel: 'A' | 'B' | 'C' | 'D' | null
  criticosAtendidos: number
  criticosTotal: number
  semAfericao: number
  resultados: Record<string, ResultadoAfericao | null>
}

export interface ListaVerificacao {
  componenteId: number | null
  capacidades: Capacidade[]
  alunos: AlunoVerificacao[]
  semComponente: boolean
}

export const useCapacidades = (componenteId: number | null) =>
  useQuery({
    queryKey: ['aca-capacidades', componenteId],
    queryFn: () => api.get<{ capacidades: Capacidade[]; criticos: number }>(`/admin/aca/componentes/${componenteId}/capacidades`),
    enabled: componenteId !== null,
    staleTime: 10_000,
  })

export const useListaVerificacao = (diarioId: number | null) =>
  useQuery({
    queryKey: ['aca-lista-verificacao', diarioId],
    queryFn: () => api.get<ListaVerificacao>(`/admin/aca/diarios/${diarioId}/lista-verificacao`),
    enabled: diarioId !== null,
    staleTime: 3_000,
  })

export interface Apuracao {
  componenteId: number
  matriculaId: number
  criticosTotal: number
  criticosAtendidos: number
  desejaveisTotal: number
  desejaveisAtendidos: number
  semAfericao: number
  nivel: 'A' | 'B' | 'C' | 'D' | null
  notaEquivalente: number | null
  apto: boolean
  explicacao: string
  aRetomar: string[]
}

export const useApuracao = (componenteId: number | null, matriculaId: number | null) =>
  useQuery({
    queryKey: ['aca-apuracao', componenteId, matriculaId],
    queryFn: () => api.get<Apuracao>(`/admin/aca/competencia/apurar?componenteId=${componenteId}&matriculaId=${matriculaId}`),
    enabled: componenteId !== null && matriculaId !== null,
    staleTime: 3_000,
  })

export function useCompetenciaMut() {
  const qc = useQueryClient()
  const inval = () => {
    void qc.invalidateQueries({ queryKey: ['aca-lista-verificacao'] })
    void qc.invalidateQueries({ queryKey: ['aca-apuracao'] })
    void qc.invalidateQueries({ queryKey: ['aca-capacidades'] })
  }
  return {
    criarCapacidade: useMutation({
      mutationFn: ({ componenteId, ...b }: { componenteId: number; tipo: string; descricao: string }) =>
        api.post<{ capacidade: Capacidade }>(`/admin/aca/componentes/${componenteId}/capacidades`, b),
      onSuccess: inval,
    }),
    excluirCapacidade: useMutation({
      mutationFn: (id: number) => api.delete(`/admin/aca/capacidades/${id}`),
      onSuccess: inval,
    }),
    criarCriterio: useMutation({
      mutationFn: ({ capacidadeId, ...b }: { capacidadeId: number; descricao: string; evidencia?: string; peso: string }) =>
        api.post<{ criterio: Criterio }>(`/admin/aca/capacidades/${capacidadeId}/criterios`, b),
      onSuccess: inval,
    }),
    excluirCriterio: useMutation({
      mutationFn: (id: number) => api.delete(`/admin/aca/criterios/${id}`),
      onSuccess: inval,
    }),
    aferir: useMutation({
      mutationFn: (b: { criterioId: number; matriculaId: number; resultado: ResultadoAfericao; observacao?: string }) =>
        api.post('/admin/aca/afericoes', b),
      onSuccess: inval,
    }),
    aferirLote: useMutation({
      mutationFn: (itens: Array<{ criterioId: number; matriculaId: number; resultado: ResultadoAfericao }>) =>
        api.post<{ registrados: number; erros: string[] }>('/admin/aca/afericoes/lote', { itens }),
      onSuccess: inval,
    }),
    copiarCapacidades: useMutation({
      mutationFn: ({ destinoId, origemComponenteId }: { destinoId: number; origemComponenteId: number }) =>
        api.post<{ capacidades: number; criterios: number }>(`/admin/aca/componentes/${destinoId}/copiar-capacidades`, { origemComponenteId }),
      onSuccess: inval,
    }),
  }
}
