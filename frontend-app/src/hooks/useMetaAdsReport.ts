import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface MetaAdsReportAd {
  name: string
  leads: number
  sales: number
  revenue: number
  won: number
  lost: number
}
export interface MetaAdsReportAdset {
  name: string
  leads: number
  sales: number
  revenue: number
  won: number
  lost: number
  ads: MetaAdsReportAd[]
}

export type MetaResultType = 'lead' | 'conversa' | 'pixel' | 'outro'

export interface MetaAdsReportCampaign {
  id: string
  name: string
  leads: number
  /** Leads do CRM por tipo: formulário da Meta, WhatsApp (anúncio de mensagem) e site/outros. */
  leadsForm: number
  leadsWhatsapp: number
  leadsSite: number
  /** Formulários que a Meta informa (sem o evento Lead do pixel). */
  metaLeads: number
  /** Conversas iniciadas que a Meta informa (anúncio de mensagem). */
  metaConversations: number
  /** Gasto ÷ conversas da Meta. */
  costPerConversation: number
  /** "Resultados" do Gerenciador: a ação que a campanha persegue (lead, conversa ou evento do site). */
  resultType: MetaResultType | null
  results: number
  /** Gasto ÷ resultados (o "custo por resultado" do Gerenciador). */
  costPerResult: number
  sales: number
  won: number
  lost: number
  revenue: number
  spend: number
  totalSpend: number
  impressions: number
  clicks: number
  /** Cliques no link/CTA — métrica que o Meta UI usa pra calcular o "CTR" exibido */
  linkClicks: number
  /** linkClicks / impressions × 100 — a "taxa de cliques no link" do Meta UI */
  linkCtr: number
  reach: number
  cpl: number
  cpc: number
  cpv: number
  roas: number
  roi: number
  conversionRate: number
  winRate: number
  adsets?: MetaAdsReportAdset[]
  /** Quantos leads desta campanha passaram por cada stage do funil selecionado. Vazio se sem funil. */
  stageCounts?: Record<string, number>
}

export interface MetaAdsReportAdsetFlat {
  id: string | null
  name: string
  campaignId: string
  campaignName: string
  leads: number
  /** Leads do CRM por tipo: formulário da Meta, WhatsApp (anúncio de mensagem) e site/outros. */
  leadsForm: number
  leadsWhatsapp: number
  leadsSite: number
  /** Formulários que a Meta informa (sem o evento Lead do pixel). */
  metaLeads: number
  /** Conversas iniciadas que a Meta informa (anúncio de mensagem). */
  metaConversations: number
  /** Gasto ÷ conversas da Meta. */
  costPerConversation: number
  /** "Resultados" do Gerenciador: a ação que a campanha persegue (lead, conversa ou evento do site). */
  resultType: MetaResultType | null
  results: number
  /** Gasto ÷ resultados (o "custo por resultado" do Gerenciador). */
  costPerResult: number
  sales: number
  revenue: number
  won: number
  lost: number
  spend: number
  /** 'real' = vindo de CampaignCost level=adset (Meta API). 'estimated' = proporcional ao share. 'none' = não há custo. */
  spendKind: 'real' | 'estimated' | 'none'
  impressions: number
  clicks: number
  cpl: number
  roas: number
  roi: number
  conversionRate: number
  /** Quantos leads deste conjunto passaram por cada stage do funil selecionado. Vazio se sem funil. */
  stageCounts?: Record<string, number>
}

export interface MetaAdsReportAdFlat extends MetaAdsReportAdsetFlat {
  adsetId: string | null
  adsetName: string
}

export interface MetaAdsReportSummary {
  totalLeads: number
  totalMetaLeads: number
  totalMetaConversations: number
  totalLeadsForm: number
  totalLeadsWhatsapp: number
  totalLeadsSite: number
  /** Formulários recebidos da Meta no período (null quando filtrado por campanha). */
  metaFormsReceived: number | null
  totalSales: number
  totalWon: number
  totalLost: number
  totalRevenue: number
  totalSpend: number
  avgCPL: number
  avgCPC: number
  roas: number
  roi: number
  conversionRate: number
  winRate: number
  totalCampaigns: number
  totalImpressions: number
  totalClicks: number
  /** Cliques no link/CTA (subset de totalClicks). */
  totalLinkClicks: number
  totalReach: number
  avgCTR: number
  /** CTR do link (paridade com Meta UI). */
  avgLinkCTR: number
  leadsDivergence: number
  /** Resultados da Meta no período (sem sobreposição de tipos de ação). */
  totalResults: number
  resultsByType: Record<MetaResultType, number>
  costPerResult: number
  objetivosAtualizadosEm: string | null
  /** Período anterior do mesmo tamanho. */
  previous: { from: string; to: string; spend: number; results: number; leads: number; costPerResult: number; impressions: number; linkClicks: number }
}

export interface MetaAdsReportDaily {
  date: string
  leads: number
  sales: number
  revenue: number
  won: number
  lost: number
  spend: number
  impressions: number
  clicks: number
  results?: number
}

export interface MetaAdsReportWeekly extends Omit<MetaAdsReportDaily, 'date'> {
  weekKey: string
  weekStart: string
  weekEnd: string
  // `date` não se aplica à visão semanal; usar weekStart/weekEnd
  date?: string
}

export interface MetaAdsReportFunnelStage {
  id: number
  key: string
  name: string
  color: string
  position: number
  terminalKind: 'won' | 'lost' | null
  count: number
  conversionFromTop: number
  conversionFromPrev: number
  ticketAvg: number
  revenue: number
  sales: number
}

export interface MetaAdsReportFunnel {
  id: number
  name: string
  top: number
  stages: MetaAdsReportFunnelStage[]
}

export interface MetaAdsReportDashboardResponse {
  summary: MetaAdsReportSummary
  campaigns: MetaAdsReportCampaign[]
  adsets: MetaAdsReportAdsetFlat[]
  ads: MetaAdsReportAdFlat[]
  daily: MetaAdsReportDaily[]
  weekly: MetaAdsReportWeekly[]
  funnel: MetaAdsReportFunnel | null
  statusBreakdown: Record<string, number>
  dateRange: { from: string; to: string; ateOntem?: boolean }
}

export interface MetaAdsReportFilters {
  dateFrom?: string | undefined
  dateTo?: string | undefined
  campaignId?: string | undefined
  funnelId?: number | undefined
}

export interface MetaAdsReportCampaignBrief {
  id: string
  name: string
  leads: number
  spend: number
}

export interface CostInput {
  campaignId: string
  campaignName?: string | undefined
  date: string
  spend: number
  impressions?: number | null | undefined
  clicks?: number | null | undefined
  notes?: string | null | undefined
}

export interface BulkCostInput {
  campaignId: string
  campaignName?: string | undefined
  dateFrom: string
  dateTo: string
  /** se null, usa totalSpend / dias */
  dailySpend?: number | null | undefined
  totalSpend?: number | null | undefined
  impressions?: number | null | undefined
  clicks?: number | null | undefined
  notes?: string | null | undefined
}

const DASHBOARD_KEY = 'meta-ads-report-dashboard'
const CAMPAIGNS_KEY = ['meta-ads-report-campaigns'] as const

function buildQs(filters: MetaAdsReportFilters): string {
  const p = new URLSearchParams()
  if (filters.dateFrom) p.set('dateFrom', filters.dateFrom)
  if (filters.dateTo) p.set('dateTo', filters.dateTo)
  if (filters.campaignId) p.set('campaignId', filters.campaignId)
  if (filters.funnelId !== undefined) p.set('funnelId', String(filters.funnelId))
  const qs = p.toString()
  return qs ? `?${qs}` : ''
}

export function useMetaAdsReportDashboard(filters: MetaAdsReportFilters = {}) {
  return useQuery({
    queryKey: [DASHBOARD_KEY, filters],
    queryFn: () => api.get<MetaAdsReportDashboardResponse>(`/admin/meta-ads-report/dashboard${buildQs(filters)}`),
    staleTime: 60_000,
  })
}

export function useMetaAdsReportCampaigns() {
  return useQuery({
    queryKey: CAMPAIGNS_KEY,
    queryFn: () => api.get<{ campaigns: MetaAdsReportCampaignBrief[] }>('/admin/meta-ads-report/campaigns'),
    staleTime: 5 * 60_000,
  })
}

function invalidateMetaAdsReport(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: [DASHBOARD_KEY] })
  void qc.invalidateQueries({ queryKey: CAMPAIGNS_KEY })
}

export function useSyncMetaInsights() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () =>
      api.post<{ ok: true; synced: number; campaigns: number; errors?: string[] }>(
        '/admin/meta-ads-report/sync-meta',
        {},
      ),
    onSuccess: () => invalidateMetaAdsReport(qc),
  })
}

export interface MetaAdAccount {
  id: string
  name: string
  status: number
}
export interface MetaAdAccountsIntegration {
  integrationId: number
  pageId: string
  pageName: string
  selected: string[]
  accounts: MetaAdAccount[]
  error: string | null
}

export function useMetaAdAccounts() {
  return useQuery({
    queryKey: ['meta-ad-accounts'],
    queryFn: () =>
      api.get<{ integrations: MetaAdAccountsIntegration[] }>(
        '/admin/meta-ads-report/ad-accounts',
      ),
    staleTime: 5 * 60_000,
  })
}

export function useSaveMetaAdAccounts() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { integrationId: number; adAccountIds: string[] }) =>
      api.put<{ ok: true; integrationId: number; adAccountIds: string[] }>(
        '/admin/meta-ads-report/ad-accounts',
        input,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['meta-ad-accounts'] })
    },
  })
}

export function useUpsertCost() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CostInput) =>
      api.post<{ ok: true; cost: { id: number } }>('/admin/meta-ads-report/costs', input),
    onSuccess: () => invalidateMetaAdsReport(qc),
  })
}

export function useBulkCosts() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: BulkCostInput) =>
      api.post<{ ok: true; days: number; perDay: number }>('/admin/meta-ads-report/costs/bulk', input),
    onSuccess: () => invalidateMetaAdsReport(qc),
  })
}

export interface MetaAdsSaldoConta {
  id: string
  nome: string
  moeda: string
  status: number
  prePaga: boolean
  formaPagamento: string | null
  saldoDisponivel: number | null
  /** Conta no cartão/boleto: o que já acumulou para a próxima cobrança. */
  aCobrar: number | null
  limiteDeGastos: number | null
  gastoTotal: number
}

export function useMetaAdsSaldo() {
  return useQuery({
    queryKey: ['meta-ads-saldo'],
    queryFn: () => api.get<{ contas: MetaAdsSaldoConta[]; erros?: string[]; consultadoEm: string }>('/admin/meta-ads-report/saldo'),
    staleTime: 5 * 60_000,
    retry: false,
  })
}
