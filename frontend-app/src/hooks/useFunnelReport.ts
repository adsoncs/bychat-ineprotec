import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

/**
 * `value: null` significa PAPEL NÃO CONFIGURADO — a tela mostra "—", nunca 0.
 * Zero é uma afirmação sobre o negócio; null, sobre a configuração.
 */
export interface Kpi {
  value: number | null
  prev: number | null
  deltaPct: number | null
  format: 'money' | 'int'
  /** De onde o número veio, em texto curto (ex.: "Agenda: completed"). */
  origem?: string | null
  configurado?: boolean
}
export interface FunnelStage {
  key: string
  label: string
  value: number | null
  prev: number | null
  deltaPct: number | null
  origem?: string | null
  rate?: { label: string; value: number | null; unit: '%' }
  cost?: { label: string; value: number | null; unit: 'money' }
}
export interface DailyRow {
  date: string
  investimento: number
  cmql: number
  mql: number
  sql: number
  ra: number
  rr: number
  fechamento: number
  faturamento: number
}
export interface WeekdayRow {
  weekday: number
  label: string
  investimento: number
  cmql: number
  mql: number
  sql: number
  ra: number
  rr: number
  fechamento: number
}
export interface BreakdownRow {
  id: string
  name: string
  investimento: number
  leads: number
  mql: number
  taxaMql: number
  sql: number
  ra: number
  rr: number
  fechamento: number
  perdido: number
}
export interface FunnelReport {
  funnels: { id: number; name: string }[]
  funnelId: number | null
  period: { from: string; to: string; prevFrom: string; prevTo: string }
  kpis: { investimento: Kpi; mql: Kpi; sql: Kpi; ra: Kpi; rr: Kpi; fechamento: Kpi; faturamento: Kpi }
  funnel: FunnelStage[]
  extraMetrics: { cpm: number; cpl: number | null; roas: number | null }
  daily: DailyRow[]
  byWeekday: WeekdayRow[]
  campaigns: BreakdownRow[]
  adsets: BreakdownRow[]
  /** Como o relatório foi apurado — necessário para interpretar os números. */
  apuracao: {
    escopo: 'todos' | 'pago'
    contagem: 'passou' | 'atual'
    naoConfigurados: { papel: string; label: string }[]
    /** Etapas cuja taxa passou de 100% — o funil configurado não é encaixado. */
    taxasAcimaDe100: { etapa: string; taxa: string; valor: number | null }[]
    origens: Record<string, string | null>
  }
}

export interface FunnelReportParams {
  from?: string | undefined
  to?: string | undefined
  funnelId?: number | undefined
}

export function useFunnelReport(params: FunnelReportParams) {
  return useQuery({
    queryKey: ['funnel-report', params.from, params.to, params.funnelId],
    queryFn: () => {
      const qs = new URLSearchParams()
      if (params.from) qs.set('from', params.from)
      if (params.to) qs.set('to', params.to)
      if (params.funnelId !== undefined) qs.set('funnelId', String(params.funnelId))
      return api.get<FunnelReport>(`/admin/funnel-report?${qs.toString()}`)
    },
    staleTime: 60_000,
  })
}

// ── Configuração do relatório (somente superadmin) ────────────────

export type DefKpi =
  | { tipo: 'nenhum' }
  | { tipo: 'etapa'; stageKeys: string[] }
  | { tipo: 'qualificacao'; fieldKeys: string[] }
  | { tipo: 'campo'; key: string; operador: 'igual' | 'preenchido' | 'diferente'; valores?: string[] }
  | { tipo: 'score'; campo: 'aiScore' | 'priorityScore'; min: number }
  | { tipo: 'score_label'; labels: string[] }
  | { tipo: 'tag'; tagIds: number[] }
  | { tipo: 'agendamento'; statuses: string[] }
  | { tipo: 'negociacao'; statuses?: string[]; resultado?: 'won' | 'lost' }
  | { tipo: 'outcome'; valor: 'won' | 'lost' }
  | { tipo: 'venda_ia' }
  | { tipo: 'valor_negociacao'; statuses?: string[]; resultado?: 'won' | 'lost' }
  | { tipo: 'valor_venda_ia' }
  | { tipo: 'valor_campo'; key: string }

export type PapelKey = 'mql' | 'sql' | 'ra' | 'rr' | 'fechamento' | 'faturamento'
export type ConfigFunil = Partial<Record<PapelKey, DefKpi>>

export interface FunnelReportConfig {
  porFunil: Record<string, ConfigFunil>
  escopo: 'todos' | 'pago'
  contagem: 'passou' | 'atual'
}

export interface FonteDescricao {
  tipo: DefKpi['tipo']
  rotulo: string
  descricao: string
  papeis: PapelKey[]
  parametros: string[]
}

export interface ConfigPayload {
  config: FunnelReportConfig
  fontes: FonteDescricao[]
  papeis: { key: PapelKey; label: string }[]
  funnels: { id: number; name: string; isDefault: boolean; stages: { key: string; name: string; position: number }[] }[]
  sugestoes: Record<string, Required<ConfigFunil>>
  catalogos: {
    tags: { id: number; name: string; color: string }[]
    customFields: { key: string; label: string; type: string; options: unknown }[]
    qualificadores: { key: string; label: string; positiveValues: string[]; forms: string[] }[]
    bookingStatuses: string[]
    negotiationStatuses: string[]
    scoreLabels: string[]
  }
}

export function useFunnelReportConfig() {
  return useQuery({
    queryKey: ['funnel-report', 'config'],
    queryFn: () => api.get<ConfigPayload>('/admin/funnel-report/config'),
    staleTime: 60_000,
  })
}

export function useSaveFunnelReportConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (config: FunnelReportConfig) =>
      api.put<{ ok: true; config: FunnelReportConfig }>('/admin/funnel-report/config', config),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['funnel-report'] }) },
  })
}
