// Módulo Metas e Comissões — acesso à API.
//
// Nada aqui calcula comissão: o número vem pronto do backend, do mesmo motor que
// grava o lançamento. Repetir a fórmula no navegador seria a forma mais rápida de
// a tela mostrar um valor e o relatório outro.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export type GoalMetric = 'revenue' | 'mrr' | 'count' | 'conversion'
export type RateType = 'percent' | 'valor' | 'none'

export const METRIC_LABEL: Record<GoalMetric, string> = {
  revenue: 'Receita ganha',
  mrr: 'Nova mensalidade (MRR)',
  count: 'Negociações ganhas',
  conversion: 'Taxa de conversão',
}
export const METRIC_UNIT: Record<GoalMetric, 'currency' | 'count' | 'percent'> = {
  revenue: 'currency', mrr: 'currency', count: 'count', conversion: 'percent',
}
export const METRICS: GoalMetric[] = ['revenue', 'mrr', 'count', 'conversion']

// ── Regras ────────────────────────────────────────────────────────────────

export interface CommissionTier {
  id?: number
  atingimentoMin: number
  tipoUnico: RateType
  taxaUnico: number | string | null
  tipoRecorrente: RateType
  taxaRecorrente: number | string | null
}

export interface CommissionRule {
  id: number
  nome: string
  active: boolean
  funnelId: number | null
  funnelName: string | null
  prioridade: number
  base: 'liquido' | 'bruto'
  tipoUnico: RateType
  taxaUnico: number | string | null
  tipoRecorrente: RateType
  taxaRecorrente: number | string | null
  mesesRecorrente: number
  aceleradorAtivo: boolean
  aceleradorMetrica: GoalMetric | null
  observacoes: string | null
  tiers: CommissionTier[]
  agentIds: number[]
  agentNames: string[]
}

export function useCommissionRules() {
  return useQuery({
    queryKey: ['commission-rules'],
    queryFn: () => api.get<{ rules: CommissionRule[] }>('/admin/commissions/rules'),
    staleTime: 30_000,
  })
}

export function useSaveCommissionRule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Partial<CommissionRule> & { id?: number }) =>
      body.id
        ? api.put<{ rule: CommissionRule }>(`/admin/commissions/rules/${body.id}`, body)
        : api.post<{ rule: CommissionRule }>('/admin/commissions/rules', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['commission-rules'] })
      qc.invalidateQueries({ queryKey: ['commission-panel'] })
    },
  })
}

export function useDeleteCommissionRule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/admin/commissions/rules/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['commission-rules'] }),
  })
}

// ── Metas ─────────────────────────────────────────────────────────────────

export interface Goal {
  id: number
  userId: number | null
  funnelId: number | null
  metric: GoalMetric
  periodStart: string
  periodEnd: string
  target: number | string
  active: boolean
  user: { id: number; name: string } | null
  funnel: { id: number; name: string } | null
}

export function useGoals(period: string, funnelId: number | null) {
  return useQuery({
    queryKey: ['goals', period, funnelId],
    queryFn: () => {
      const qs = new URLSearchParams({ period })
      if (funnelId) qs.set('funnelId', String(funnelId))
      return api.get<{ goals: Goal[] }>(`/admin/goals?${qs.toString()}`)
    },
    staleTime: 15_000,
  })
}

export interface GoalInput {
  userId: number | null
  funnelId: number | null
  metric: GoalMetric
  target: number | null
}

/** Grava a grade do mês inteira — alvo vazio apaga a meta. */
export function useSaveGoals() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ period, goals }: { period: string; goals: GoalInput[] }) =>
      api.post<{ ok: boolean; gravadas: number; apagadas: number }>('/admin/goals/bulk', { period, goals }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['goals'] })
      qc.invalidateQueries({ queryKey: ['commission-panel'] })
    },
  })
}

export function useCopyGoals() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ from, to }: { from: string; to: string }) =>
      api.post<{ ok: boolean; copiadas: number }>('/admin/goals/copy', { from, to }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  })
}

// ── Painel ────────────────────────────────────────────────────────────────

export interface MetricProgress {
  target: number | null
  atual: number | null
  atingimento: number | null
}

export interface PanelAgent {
  userId: number
  nome: string
  email: string
  active: boolean
  role: string
  realizado: { revenue: number; mrr: number; count: number; conversion: number | null; wonCount: number; lostCount: number }
  metas: Record<GoalMetric, MetricProgress>
  regra: { id: number; nome: string; aceleradorAtivo: boolean; aceleradorMetrica: GoalMetric | null } | null
  comissao: { prevista: number; paga: number; lancamentos: number }
}

export interface CommissionPanel {
  period: string
  funnelId: number | null
  escopoProprio: boolean
  agentes: PanelAgent[]
  operacao: {
    realizado: PanelAgent['realizado']
    metas: Record<GoalMetric, MetricProgress>
    comissao: PanelAgent['comissao']
  }
}

export function useCommissionPanel(period: string, funnelId: number | null) {
  return useQuery({
    queryKey: ['commission-panel', period, funnelId],
    queryFn: () => {
      const qs = new URLSearchParams({ period })
      if (funnelId) qs.set('funnelId', String(funnelId))
      return api.get<CommissionPanel>(`/admin/commissions/panel?${qs.toString()}`)
    },
    staleTime: 15_000,
  })
}

// ── Lançamentos ───────────────────────────────────────────────────────────

export interface CommissionEntry {
  id: number
  negotiationId: number
  leadId: number
  userId: number | null
  funnelId: number | null
  ruleId: number | null
  competencia: string
  fechadaEm: string
  baseUnico: number | string
  baseRecorrente: number | string
  tipoUnico: RateType | null
  taxaUnico: number | string | null
  tipoRecorrente: RateType | null
  taxaRecorrente: number | string | null
  mesesRecorrente: number
  valorUnico: number | string
  valorRecorrente: number | string
  valorTotal: number | string
  atingimento: number | string | null
  status: 'prevista' | 'paga' | 'cancelada'
  pagaEm: string | null
  observacoes: string | null
  leadNome: string
  agenteNome: string | null
  negociacaoTitulo: string | null
  negociacaoValor: number | string | null
  regraNome: string | null
}

export interface EntriesParams {
  period: string
  userId?: number | string | null
  funnelId?: number | null
  status?: string
  page?: number
  limit?: number
}

export function entriesQuery(p: EntriesParams): string {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined || v === null || v === '') continue
    qs.set(k, String(v))
  }
  return qs.toString()
}

export function useCommissionEntries(p: EntriesParams) {
  return useQuery({
    queryKey: ['commission-entries', p],
    queryFn: () => api.get<{
      entries: CommissionEntry[]
      total: number
      page: number
      limit: number
      kpis: Record<'prevista' | 'paga' | 'cancelada', { valor: number; count: number }>
    }>(`/admin/commissions/entries?${entriesQuery(p)}`),
    staleTime: 15_000,
  })
}

export function usePayCommission() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, paga }: { id: number; paga: boolean }) =>
      api.post(`/admin/commissions/entries/${id}/pay`, { paga }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['commission-entries'] })
      qc.invalidateQueries({ queryKey: ['commission-panel'] })
    },
  })
}

export function usePayCommissionBatch() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ ids, paga }: { ids: number[]; paga: boolean }) =>
      api.post<{ count: number }>('/admin/commissions/entries/pay-batch', { ids, paga }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['commission-entries'] })
      qc.invalidateQueries({ queryKey: ['commission-panel'] })
    },
  })
}

export function useRecalcCommissions() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ period, userId }: { period: string; userId?: number | null }) =>
      api.post<{ negociacoes: number; agentes: number }>('/admin/commissions/recalc', { period, userId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['commission-entries'] })
      qc.invalidateQueries({ queryKey: ['commission-panel'] })
      qc.invalidateQueries({ queryKey: ['commission-reconcile'] })
    },
  })
}

export interface Divergencia {
  tipo: 'sem_responsavel' | 'sem_regra' | 'valor_divergente' | 'orfa'
  negotiationId: number | null
  leadId: number | null
  titulo: string | null
  detalhe: string
}

export function useCommissionReconcile(period: string, enabled: boolean) {
  return useQuery({
    queryKey: ['commission-reconcile', period],
    queryFn: () => api.get<{ divergencias: Divergencia[]; total: number }>(`/admin/commissions/reconcile?period=${period}`),
    enabled,
    staleTime: 30_000,
  })
}

// ── Estimativa dentro da proposta ─────────────────────────────────────────

export interface CommissionPreview {
  aplicavel: boolean
  motivo: string | null
  userId: number | null
  rule: { id: number; nome: string } | null
  tierLabel: string | null
  atingimento: number | null
  baseUnico: number
  baseRecorrente: number
  tipoUnico: RateType
  taxaUnico: number | null
  tipoRecorrente: RateType
  taxaRecorrente: number | null
  mesesRecorrente: number
  valorUnico: number
  valorRecorrente: number
  valorTotal: number
}

/**
 * Comissão estimada da proposta aberta no editor. Best-effort: módulo desligado
 * ou sem permissão devolve nulo e a seção some — a proposta continua funcionando.
 */
export function useCommissionPreview(negotiationId: number | null, enabled: boolean) {
  return useQuery({
    queryKey: ['commission-preview', negotiationId],
    queryFn: () => api
      .get<{ preview: CommissionPreview; entry: CommissionEntry | null }>(`/admin/commissions/preview/${negotiationId}`)
      .catch(() => null),
    enabled: !!negotiationId && enabled,
    staleTime: 10_000,
  })
}
