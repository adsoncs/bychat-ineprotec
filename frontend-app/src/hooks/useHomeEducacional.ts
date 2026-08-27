// Dados do painel educacional servido como Tela Inicial.
//
// Uma chamada só, por uma rota que não passa pelo gate do módulo 'dashboard' —
// a Tela Inicial nativa é atribuída a papéis que não têm esse módulo, e cada
// KPI buscando por conta própria em /admin/widget-data devolveria 403.

import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface PanoramaAcademico {
  totalCourses: number
  totalOfferings: number
  totalProcesses: number
  totalRegistrations: number
  matriculados: number
  conversionRate: number
}

export interface PainelEducacional {
  panorama: PanoramaAcademico
  kpis: {
    inscricoes: unknown
    pagas: unknown
    receita: unknown
    conversao: unknown
  }
  graficos: {
    porDia: { label: string; value: number; paid: number }[]
    porPortal: { label: string; value: number; key: string }[]
  }
}

export function useHomeEducacional(periodo: { dateFrom?: string; dateTo?: string }) {
  const busca = new URLSearchParams()
  if (periodo.dateFrom) busca.set('dateFrom', periodo.dateFrom)
  if (periodo.dateTo) busca.set('dateTo', periodo.dateTo)
  const qs = busca.toString()

  return useQuery({
    queryKey: ['home-screen', 'educacional', periodo.dateFrom, periodo.dateTo],
    queryFn: () => api.get<PainelEducacional>(`/home-screen/educacional${qs ? `?${qs}` : ''}`),
    staleTime: 60_000,
  })
}
