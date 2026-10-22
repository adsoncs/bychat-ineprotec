// Educacional › Comercial (Fase 3 da integração Negociações × Educacional).
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface FiltroComercial { mes: string; portalId?: number | null; courseId?: number | null; campusId?: number | null; vendedorId?: number | null }
export interface LinhaResumo { id: number | string | null; nome: string; quantidade: number; valor: number }
export interface PainelComercial {
  mes: string
  kpis: { vendas: number; valorVendas: number; ticket: number; abertas: number; valorAberto: number; perdidas: number; conversao: number | null; comissao: number; inscricoes: number; inscricoesComProposta: number }
  metaPortal: { valor: number | null; quantidade: number | null; atingimentoValor: number | null; atingimentoQuantidade: number | null } | null
  porVendedor: Array<{ userId: number | null; nome: string; quantidade: number; valor: number; comissao: number; meta: { valor: number | null; quantidade: number | null }; atingimento: number | null }>
  porCurso: LinhaResumo[]; porPortal: LinhaResumo[]; porPolo: LinhaResumo[]
  vendasDoMes: Array<{ negotiationId: number; leadId: number | null; nome: string; codigo: string; curso: string; portal: string; polo: string | null; vendedor: string | null; valor: number; fechadaEm: string; comissao: number | null; comissaoStatus: string | null }>
}

export function usePainelComercial(f: FiltroComercial) {
  return useQuery({
    queryKey: ['edu-comercial', f],
    queryFn: () => {
      const qs = new URLSearchParams({ mes: f.mes })
      for (const k of ['portalId', 'courseId', 'campusId', 'vendedorId'] as const) if (f[k]) qs.set(k, String(f[k]))
      return api.get<PainelComercial>(`/admin/educacional/comercial/painel?${qs}`)
    },
    staleTime: 30_000,
  })
}

export function useSalvarMetaPortal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (b: { portalId: number; mes: string; valor: number | null; quantidade: number | null }) => api.put('/admin/educacional/comercial/metas', b),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['edu-comercial'] }) },
  })
}

export interface ComercialDaInscricao {
  vendedor: string | null
  proposta: { id: number; leadId: number; titulo: string; status: string; resultado: string | null; valorFinal: number; fechadaEm: string | null; responsavel: string | null; origem: string | null } | null
  comissao: { valor: number; status: string; competencia: string } | null
}
export function useComercialDaInscricao(id: number) {
  return useQuery({ queryKey: ['inscricao-comercial', id], queryFn: () => api.get<ComercialDaInscricao>(`/admin/enrollment-registrations/${id}/comercial`), staleTime: 30_000 })
}
