import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface BiData {
  periodoLetivoId: number | null
  academico: { alunosAtivos: number; matriculadosTotal: number; listaEspera: number; turmasAtivas: number; ocupacaoPct: number; vagas: { capacidade: number; ocupadas: number }; concluidos: number; evadidos: number }
  desempenho: { situacao: Record<string, number>; frequenciaMedia: number | null; totalAvaliados: number }
  financeiro: { aReceber: number; recebido: number; inadimplencia: { valor: number; count: number }; ticketMedio: number; contratosAtivos: number; porSituacao: Record<string, { count: number; valor: number }> }
}

export function useAcaBi(periodoLetivoId: number | null) {
  return useQuery({
    queryKey: ['aca-bi', periodoLetivoId],
    queryFn: () => api.get<BiData>(`/admin/aca/bi${periodoLetivoId ? `?periodoLetivoId=${periodoLetivoId}` : ''}`),
    staleTime: 10_000,
  })
}

export const money = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
