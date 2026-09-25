import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export type EtapaFunil = 'inscrito' | 'documentos' | 'contrato' | 'pagamento' | 'matriculado' | 'cancelado'

export interface EtapaResumo {
  chave: EtapaFunil
  rotulo: string
  total: number
}

export interface ItemFunil {
  registrationId: number
  codigo: string
  candidato: string
  whatsapp: string | null
  portal: string | null
  oferta: string | null
  criadaEm: string
  etapa: EtapaFunil
  /** O que trava esta inscrição, em uma frase. */
  motivo: string
  diasParado: number
  alunoId: number | null
  matriculaId: number | null
}

export interface FiltrosFunil {
  etapa?: EtapaFunil | ''
  portalId?: number
  busca?: string
  limite?: number
}

function buildQs(f: object): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(f as Record<string, unknown>)) {
    if (v === undefined || v === null || v === '') continue
    p.set(k, String(v))
  }
  const qs = p.toString()
  return qs ? `?${qs}` : ''
}

export function useFunilMatriculas(filtros: FiltrosFunil = {}) {
  return useQuery({
    queryKey: ['aca-funil-matriculas', filtros],
    queryFn: () => api.get<{ etapas: EtapaResumo[]; itens: ItemFunil[] }>(
      `/admin/aca/funil-matriculas${buildQs(filtros)}`,
    ),
    staleTime: 20_000,
  })
}

export interface ResultadoLote {
  efetivadas: number
  falhas: Array<{ id: number; erro: string }>
  itens: Array<{ id: number; alunoId: number; ra: string | null; matriculaId: number; listaEspera: boolean }>
}

/** Efetiva várias inscrições de uma vez; devolve o que passou e o que não. */
export function useEfetivarEmLote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ids: number[]) =>
      api.post<ResultadoLote>('/admin/aca/inscricoes-portal/efetivar-lote', { ids }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['aca-funil-matriculas'] })
    },
  })
}

export interface LinhaConversao {
  chave: string
  rotulo: string
  inscricoes: number
  pagas: number
  matriculadas: number
  conversao: number
  /** Falso quando há poucas inscrições — a porcentagem não conclui nada. */
  amostraSuficiente: boolean
}

export interface RelatorioConversao {
  total: number
  matriculadas: number
  conversaoGeral: number
  amostraSuficiente: boolean
  minimoParaPercentual: number
  porCurso: LinhaConversao[]
  porFormaDeIngresso: LinhaConversao[]
  porOrigem: LinhaConversao[]
}

export function useConversaoMatriculas(filtros: { portalId?: number } = {}) {
  return useQuery({
    queryKey: ['aca-conversao-matriculas', filtros],
    queryFn: () => api.get<RelatorioConversao>(`/admin/aca/conversao-matriculas${buildQs(filtros)}`),
    staleTime: 60_000,
  })
}
