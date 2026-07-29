import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

// Regime de exercícios domiciliares. Só o status DEFERIDO altera o cálculo de
// frequência — a UI precisa deixar isso explícito para quem defere.

export interface RegimeEspecial {
  id: number
  alunoId: number
  vinculoId: number | null
  tipo: string
  status: string
  dataInicio: string
  dataFim: string
  amparoLegal: string | null
  atestadoUrl: string | null
  observacao: string | null
  planoAtividades: string | null
  deferidoEm: string | null
  vigente: boolean
  aluno?: { ra: string | null; lead?: { nome: string | null } | null } | null
}

export interface TipoRegime { id: string; label: string; amparo: string; ajuda: string }

export const REGIME_STATUS: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  SOLICITADO: { label: 'Aguardando análise', tone: 'warning' },
  DEFERIDO: { label: 'Deferido', tone: 'success' },
  INDEFERIDO: { label: 'Indeferido', tone: 'danger' },
  ENCERRADO: { label: 'Encerrado', tone: 'neutral' },
}

export const useRegimesEspeciais = (filtros: { alunoId?: number | null; status?: string } = {}) => {
  const qs = new URLSearchParams()
  if (filtros.alunoId) qs.set('alunoId', String(filtros.alunoId))
  if (filtros.status) qs.set('status', filtros.status)
  const suffix = qs.toString() ? `?${qs}` : ''
  return useQuery({
    queryKey: ['aca-regimes', filtros.alunoId ?? null, filtros.status ?? ''],
    queryFn: () => api.get<{ regimes: RegimeEspecial[] }>(`/admin/aca/regimes-especiais${suffix}`),
    staleTime: 3_000,
  })
}

export const useTiposRegime = () =>
  useQuery({
    queryKey: ['aca-regimes-tipos'],
    queryFn: () => api.get<{ tipos: TipoRegime[] }>('/admin/aca/regimes-especiais/tipos'),
    staleTime: 300_000,
  })

export function useRegimeMut() {
  const qc = useQueryClient()
  const inval = () => void qc.invalidateQueries({ queryKey: ['aca-regimes'] })
  return {
    criar: useMutation({
      mutationFn: (b: Record<string, unknown>) => api.post<{ regime: RegimeEspecial }>('/admin/aca/regimes-especiais', b),
      onSuccess: inval,
    }),
    status: useMutation({
      mutationFn: ({ id, ...b }: { id: number; status: string; observacao?: string }) =>
        api.post(`/admin/aca/regimes-especiais/${id}/status`, b),
      onSuccess: inval,
    }),
    editar: useMutation({
      mutationFn: ({ id, ...b }: { id: number } & Record<string, unknown>) =>
        api.put(`/admin/aca/regimes-especiais/${id}`, b),
      onSuccess: inval,
    }),
  }
}
