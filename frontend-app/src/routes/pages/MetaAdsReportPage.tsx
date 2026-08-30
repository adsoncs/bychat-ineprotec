import { useState, useMemo, useRef } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import {
  TrendingUp, DollarSign, Users, MousePointerClick, RefreshCw,
  Eye, Megaphone, Radar, Activity, AlertCircle,
  Target, Coins, ShoppingBag, XCircle, Percent, Filter as FilterIcon,
  FileDown, HelpCircle, Settings2,
} from '@/components/ui/icon-set'
import { HowItWorksModal } from '@/components/ui/HowItWorksModal'
import {
  useMetaAdsReportDashboard,
  useMetaAdsReportCampaigns,
  useSyncMetaInsights,
  useMetaAdAccounts,
  useSaveMetaAdAccounts,
  type MetaAdAccountsIntegration,
  type MetaAdsReportFilters,
  type MetaAdsReportDaily,
  type MetaAdsReportWeekly,
  type MetaAdsReportCampaign,
  type MetaAdsReportAdsetFlat,
  type MetaAdsReportAdFlat,
  type MetaAdsReportFunnel,
  type MetaAdsReportFunnelStage,
} from '@/hooks/useMetaAdsReport'
import { useFunnels } from '@/hooks/useFunnels'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { KpiCard } from '@/components/ui/KpiCard'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input, Select } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/cn'

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const intf = new Intl.NumberFormat('pt-BR')

function today(): string { return new Date().toISOString().slice(0, 10) }
function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}
function startOfMonth(): string {
  const n = new Date()
  return new Date(n.getFullYear(), n.getMonth(), 1).toISOString().slice(0, 10)
}
function lastMonth(): { from: string; to: string } {
  const n = new Date()
  const from = new Date(n.getFullYear(), n.getMonth() - 1, 1)
  const to = new Date(n.getFullYear(), n.getMonth(), 0)
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }
}
function yearsAgo(n: number): string {
  const d = new Date()
  d.setFullYear(d.getFullYear() - n)
  return d.toISOString().slice(0, 10)
}

const PRESETS: { label: string; range: () => { from: string; to: string } }[] = [
  { label: 'Hoje', range: () => ({ from: today(), to: today() }) },
  { label: '7 dias', range: () => ({ from: daysAgo(7), to: daysAgo(1) }) },
  { label: '30 dias', range: () => ({ from: daysAgo(30), to: today() }) },
  { label: '90 dias', range: () => ({ from: daysAgo(90), to: today() }) },
  { label: 'Este mês', range: () => ({ from: startOfMonth(), to: today() }) },
  { label: 'Mês passado', range: lastMonth },
  { label: 'Todo período', range: () => ({ from: yearsAgo(2), to: today() }) },
]

const initialFilters: MetaAdsReportFilters = { dateFrom: daysAgo(180), dateTo: today() }

type BreakdownTab = 'campaigns' | 'adsets' | 'ads'
type BreakdownMode = 'performance' | 'stages'

export function MetaAdsReportPage() {
  const [filters, setFilters] = useState<MetaAdsReportFilters>(initialFilters)
  const [breakdownTab, setBreakdownTab] = useState<BreakdownTab>('campaigns')
  const [breakdownMode, setBreakdownMode] = useState<BreakdownMode>('performance')
  const [showHowItWorks, setShowHowItWorks] = useState(false)
  const [showAdAccounts, setShowAdAccounts] = useState(false)

  const { data, isLoading } = useMetaAdsReportDashboard(filters)
  const { data: campaignsData } = useMetaAdsReportCampaigns()
  const { data: funnelsData } = useFunnels()
  const sync = useSyncMetaInsights()

  const campaigns = campaignsData?.campaigns ?? []
  const funnels = funnelsData?.funnels ?? []

  function applyPreset(preset: { from: string; to: string }) {
    setFilters((f) => ({ ...f, dateFrom: preset.from, dateTo: preset.to }))
  }

  function handleSync() {
    sync.mutate(undefined, {
      onSuccess: (r) => {
        const errPart = r.errors && r.errors.length > 0 ? ` · ${r.errors.length} erro(s)` : ''
        toast(`${r.synced} dia(s) sincronizado(s) em ${r.campaigns} campanha(s)${errPart}`, 'success')
      },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  async function handleExportPdf() {
    const params = new URLSearchParams()
    if (filters.dateFrom) params.set('dateFrom', filters.dateFrom)
    if (filters.dateTo) params.set('dateTo', filters.dateTo)
    if (filters.funnelId !== undefined) params.set('funnelId', String(filters.funnelId))
    const url = `/api/admin/reports/meta-ads-report-pdf?${params.toString()}`
    const token = localStorage.getItem('bh_token') || localStorage.getItem('auth_token') || ''
    try {
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const blob = await resp.blob()
      const objectUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = objectUrl
      a.download = `relatorio-meta-ads-${filters.dateFrom || 'inicio'}-${filters.dateTo || 'fim'}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(objectUrl)
      toast('PDF gerado', 'success')
    } catch (e) {
      toast((e as Error).message, 'danger')
    }
  }

  const summary = data?.summary
  const isEmpty = summary?.totalSpend === 0 && summary?.totalLeads === 0
  const hasFunnel = !!(data?.funnel && data.funnel.stages.length > 0)
  const effectiveMode: BreakdownMode = hasFunnel ? breakdownMode : 'performance'

  // Séries diárias por métrica para sparklines nos KPIs (6 métricas-chave)
  const sparklines = useMemo(() => {
    const d = data?.daily ?? []
    return {
      spend:   d.map((x) => x.spend),
      leads:   d.map((x) => x.leads),
      sales:   d.map((x) => x.sales),
      revenue: d.map((x) => x.revenue),
      roas:    d.map((x) => (x.spend > 0 ? x.revenue / x.spend : 0)),
      roi:     d.map((x) => (x.spend > 0 ? ((x.revenue - x.spend) / x.spend) * 100 : 0)),
    }
  }, [data?.daily])

  return (
    <Page
      title="Relatório Meta Ads"
      description="Investimento, leads, vendas, ROI e funil por campanha."
      actions={
        <div class="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setShowHowItWorks(true)}>
            <HelpCircle size={14} /> Como funciona?
          </Button>
          <Button variant="ghost" size="sm" onClick={handleExportPdf}>
            <FileDown size={14} /> Exportar PDF
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setShowAdAccounts(true)}>
            <Settings2 size={14} /> Conta de anúncio
          </Button>
          <Button variant="primary" size="sm" onClick={handleSync} disabled={sync.isPending}>
            <RefreshCw size={14} class={sync.isPending ? 'animate-spin' : ''} />
            {sync.isPending ? 'Sincronizando…' : 'Sincronizar Meta'}
          </Button>
        </div>
      }
    >
      <Card>
        <div class="flex flex-col gap-3">
          <div class="flex flex-wrap items-end gap-3">
            <Input
              label="De"
              type="date"
              value={filters.dateFrom ?? ''}
              onInput={(e) => setFilters((f) => ({ ...f, dateFrom: (e.target as HTMLInputElement).value || undefined }))}
            />
            <Input
              label="Até"
              type="date"
              value={filters.dateTo ?? ''}
              onInput={(e) => setFilters((f) => ({ ...f, dateTo: (e.target as HTMLInputElement).value || undefined }))}
            />
            <div class="flex flex-col gap-1 flex-1 min-w-48">
              <span class="text-xs font-medium text-fg-muted">Campanha</span>
              <Select
                value={filters.campaignId ?? ''}
                onChange={(e) => setFilters((f) => ({ ...f, campaignId: (e.target as HTMLSelectElement).value || undefined }))}
              >
                <option value="">Todas as campanhas</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} ({c.leads})</option>
                ))}
              </Select>
            </div>
            <div class="flex flex-col gap-1 min-w-48">
              <span class="text-xs font-medium text-fg-muted">Funil</span>
              <Select
                value={filters.funnelId !== undefined ? String(filters.funnelId) : ''}
                onChange={(e) => {
                  const v = (e.target as HTMLSelectElement).value
                  setFilters((f) => ({ ...f, funnelId: v ? parseInt(v, 10) : undefined }))
                }}
              >
                <option value="">Sem funil (sem etapas)</option>
                {funnels.filter(f => f.active).map((f) => (
                  <option key={f.id} value={f.id}>{f.name}{f.isDefault ? ' (padrão)' : ''}</option>
                ))}
              </Select>
            </div>
          </div>
          <div class="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                class="h-7 px-2.5 rounded-md border border-border bg-surface text-xs text-fg-muted hover:bg-surface-3 hover:text-fg"
                onClick={() => applyPreset(p.range())}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* KPIs */}
      <section class="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
        <KpiCard
          label="Investimento"
          value={summary ? brl.format(summary.totalSpend) : '—'}
          loading={isLoading}
          icon={<DollarSign size={16} />}
          sparkline={sparklines.spend}
          sparklineColor="#f59e0b"
        />
        <KpiCard
          label="Leads"
          value={summary?.totalLeads ?? '—'}
          loading={isLoading}
          icon={<Users size={16} />}
          hint={summary && summary.leadsDivergence > 0 ? `Meta reporta +${intf.format(summary.leadsDivergence)} (verifique webhook)` : undefined}
          sparkline={sparklines.leads}
          sparklineColor="#3b82f6"
        />
        <KpiCard
          label="Vendas"
          value={summary?.totalSales ?? '—'}
          loading={isLoading}
          icon={<ShoppingBag size={16} />}
          hint={summary && summary.totalLeads > 0 ? `${summary.conversionRate.toFixed(1)}% de conversão` : undefined}
          sparkline={sparklines.sales}
          sparklineColor="#10b981"
        />
        <KpiCard
          label="Faturamento"
          value={summary ? brl.format(summary.totalRevenue) : '—'}
          loading={isLoading}
          icon={<Coins size={16} />}
          sparkline={sparklines.revenue}
          sparklineColor="#22c55e"
        />
        <KpiCard
          label="ROI"
          value={summary && summary.totalSpend > 0 ? `${summary.roi.toFixed(0)}%` : '—'}
          loading={isLoading}
          icon={<Percent size={16} />}
          hint="(receita − investim.) ÷ investim."
          sparkline={sparklines.roi}
          sparklineColor="#ec4899"
        />
        <KpiCard
          label="ROAS"
          value={summary && summary.roas > 0 ? `${summary.roas.toFixed(2)}x` : '—'}
          loading={isLoading}
          icon={<Target size={16} />}
          hint="receita ÷ investimento"
          sparkline={sparklines.roas}
          sparklineColor="#a855f7"
        />
        <KpiCard
          label="CPL"
          value={summary && summary.avgCPL > 0 ? brl.format(summary.avgCPL) : '—'}
          loading={isLoading}
          icon={<TrendingUp size={16} />}
          hint="custo por lead"
        />
        <KpiCard
          label="Perdas"
          value={summary?.totalLost ?? '—'}
          loading={isLoading}
          icon={<XCircle size={16} />}
          hint={summary && (summary.totalWon + summary.totalLost) > 0 ? `${summary.winRate.toFixed(1)}% win-rate` : undefined}
        />
        <KpiCard
          label="CPC"
          value={summary && summary.avgCPC > 0 ? brl.format(summary.avgCPC) : '—'}
          loading={isLoading}
          icon={<MousePointerClick size={16} />}
          hint="custo por clique"
        />
        <KpiCard
          label="CTR (link)"
          value={summary ? `${summary.avgLinkCTR.toFixed(2)}%` : '—'}
          loading={isLoading}
          icon={<Activity size={16} />}
          hint="cliques no link ÷ impressões (paridade Meta UI)"
        />
        <KpiCard
          label="Impressões"
          value={summary ? intf.format(summary.totalImpressions) : '—'}
          loading={isLoading}
          icon={<Eye size={16} />}
        />
        <KpiCard
          label="Cliques"
          value={summary ? intf.format(summary.totalClicks) : '—'}
          loading={isLoading}
          icon={<MousePointerClick size={16} />}
          hint={summary ? `${intf.format(summary.totalLinkClicks)} no link · ${summary.avgCTR.toFixed(2)}% CTR total` : undefined}
        />
        <KpiCard
          label="Alcance"
          value={summary ? intf.format(summary.totalReach) : '—'}
          loading={isLoading}
          icon={<Radar size={16} />}
          hint="pessoas únicas na janela (Meta API)"
        />
        <KpiCard
          label="Campanhas"
          value={summary?.totalCampaigns ?? '—'}
          loading={isLoading}
          icon={<Megaphone size={16} />}
        />
      </section>

      {/* Tendência temporal */}
      {data && data.daily.length > 1 && (
        <TrendChart daily={data.daily} />
      )}

      {/* Funil Detalhado */}
      {data?.funnel && data.funnel.stages.length > 0 && (
        <FunnelDetailed funnel={data.funnel} />
      )}
      {!data?.funnel && filters.funnelId === undefined && !isLoading && (
        <Card class="border-info/40 bg-info/10">
          <div class="flex items-start gap-3">
            <FilterIcon size={18} class="text-info shrink-0 mt-0.5" />
            <div class="text-xs text-fg">
              Selecione um <strong>funil</strong> no filtro acima para ver o funil detalhado por etapa, com conversão entre etapas e ticket médio.
            </div>
          </div>
        </Card>
      )}

      {/* Análise Diária / Semanal */}
      {data && (data.daily.length > 0 || data.weekly.length > 0) && (
        <Card class="p-0 overflow-hidden">
          <div class="p-4 border-b border-border flex items-center justify-between">
            <h3 class="text-sm font-semibold text-fg">Análise temporal</h3>
            <span class="text-2xs text-fg-muted">heatmap por valor da coluna</span>
          </div>
          <div class="grid lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-border">
            <div class="p-4">
              <h4 class="text-xs font-semibold text-fg-muted uppercase tracking-wide mb-2">Diária</h4>
              <DailyHeatmapTable daily={data.daily} />
            </div>
            <div class="p-4">
              <h4 class="text-xs font-semibold text-fg-muted uppercase tracking-wide mb-2">Semanal</h4>
              <WeeklyHeatmapTable weekly={data.weekly} />
            </div>
          </div>
        </Card>
      )}

      {/* Tabelas Campanhas / Adsets / Anúncios */}
      <Card class="p-0 overflow-hidden">
        <div class="p-3 border-b border-border flex items-center justify-between gap-2 flex-wrap">
          <div class="flex items-center gap-1 bg-surface-3 rounded-md p-0.5">
            <TabBtn active={breakdownTab === 'campaigns'} onClick={() => setBreakdownTab('campaigns')}>
              Campanhas {data ? <Pill>{data.campaigns.length}</Pill> : null}
            </TabBtn>
            <TabBtn active={breakdownTab === 'adsets'} onClick={() => setBreakdownTab('adsets')}>
              Conjuntos {data ? <Pill>{data.adsets.length}</Pill> : null}
            </TabBtn>
            <TabBtn active={breakdownTab === 'ads'} onClick={() => setBreakdownTab('ads')}>
              Anúncios {data ? <Pill>{data.ads.length}</Pill> : null}
            </TabBtn>
          </div>
          {hasFunnel && (
            <div class="flex items-center gap-1 bg-surface-3 rounded-md p-0.5">
              <TabBtn small active={effectiveMode === 'performance'} onClick={() => setBreakdownMode('performance')}>
                Performance
              </TabBtn>
              <TabBtn small active={effectiveMode === 'stages'} onClick={() => setBreakdownMode('stages')}>
                Por etapa do funil
              </TabBtn>
            </div>
          )}
        </div>
        {isLoading && (
          <div class="p-4 flex flex-col gap-2">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} class="h-12 w-full" />)}
          </div>
        )}
        {!isLoading && data && effectiveMode === 'performance' && (
          <>
            {breakdownTab === 'campaigns' && <CampaignsTable rows={data.campaigns} />}
            {breakdownTab === 'adsets' && <AdsetsTable rows={data.adsets} />}
            {breakdownTab === 'ads' && <AdsTable rows={data.ads} />}
          </>
        )}
        {!isLoading && data && effectiveMode === 'stages' && data.funnel && (
          <StagesBreakdownTable
            kind={breakdownTab}
            stages={data.funnel.stages}
            campaigns={data.campaigns}
            adsets={data.adsets}
            ads={data.ads}
          />
        )}
      </Card>

      {!isLoading && isEmpty && (
        <Card class="border-warning/40 bg-warning/10">
          <div class="flex items-start gap-3">
            <AlertCircle size={20} class="text-warning shrink-0 mt-0.5" />
            <div class="text-xs text-fg">
              Clique em <strong>"Sincronizar Meta"</strong> para importar os dados das suas campanhas do Meta Ads.
            </div>
          </div>
        </Card>
      )}

      <HowItWorksModal
        open={showHowItWorks}
        onClose={() => setShowHowItWorks(false)}
        title="Como funciona o Relatório Meta Ads?"
        problem={<>
          O Gerenciador de Anúncios do Meta mostra <em>cliques e investimento</em>, mas não sabe se virou
          <strong> venda</strong>. Este relatório <strong>cruza os dois</strong>: dados do Meta (gasto, alcance,
          cliques) + dados do CRM (lead virou venda? valor da venda?). O resultado é <strong>ROAS real</strong>.
        </>}
        steps={[
          {
            title: '🔄 Sincronize com o Meta',
            body: <>Botão <strong>Sincronizar Meta</strong> puxa os dados das suas campanhas (investimento, impressões, cliques, leads do Meta Ads). Faz por dia, no período escolhido nos filtros.</>,
          },
          {
            title: '💰 ROAS, ROI e Vendas reais',
            body: <>O sistema cruza o <strong>gclid/fbclid</strong> dos cliques com leads que viraram venda no CRM. Calcula: <strong>ROAS</strong> (receita ÷ gasto), <strong>ROI</strong> (lucro %), <strong>CPL</strong> (custo por lead), <strong>CPA</strong> (custo por venda).</>,
          },
          {
            title: '📈 Tendências por métrica',
            body: <>Gráfico de tendência com sparklines por métrica: clique no KPI pra ver evolução diária. Útil pra ver se a campanha tá <strong>melhorando ou piorando</strong> ao longo do tempo.</>,
          },
          {
            title: '🔍 Drill: campanhas → adsets → ads',
            body: <>Abra as abas <strong>Campanhas / Conjuntos / Anúncios</strong>: cada uma mostra performance individual. Identifica o que tá dando ROAS positivo e o que tá queimando dinheiro.</>,
          },
          {
            title: '🎯 Funil de conversão por campanha',
            body: <>Aba <strong>Funil</strong>: cada campanha tem sua jornada (lead → qualificado → proposta → fechado). Vê onde os leads de cada campanha estão perdendo gás.</>,
          },
        ]}
        tip={{
          tone: 'info',
          title: '💡 Dica',
          body: <>Pra ROAS aparecer correto, o lead precisa ter <strong>fbclid</strong> (vem da campanha) E ter virado venda no CRM. Use Links Rastreáveis e o Pixel pra garantir que toda a jornada está sendo tracked.</>,
        }}
      />

      {showAdAccounts && <AdAccountConfigModal onClose={() => setShowAdAccounts(false)} />}
    </Page>
  )
}

// ───────────────────────── Trend Chart ─────────────────────────

type TrendMetric = 'spend' | 'leads' | 'sales' | 'revenue' | 'roas' | 'roi'
const TREND_METRICS: { key: TrendMetric; label: string; color: string; format: 'int' | 'brl' | 'pct' | 'mult' }[] = [
  { key: 'spend',   label: 'Investimento', color: '#f59e0b', format: 'brl' },
  { key: 'leads',   label: 'Leads',        color: '#3b82f6', format: 'int' },
  { key: 'sales',   label: 'Vendas',       color: '#10b981', format: 'int' },
  { key: 'revenue', label: 'Receita',      color: '#22c55e', format: 'brl' },
  { key: 'roas',    label: 'ROAS',         color: '#a855f7', format: 'mult' },
  { key: 'roi',     label: 'ROI %',        color: '#ec4899', format: 'pct' },
]

function fmtTrend(v: number, f: 'int' | 'brl' | 'pct' | 'mult'): string {
  if (f === 'brl') return brl.format(v)
  if (f === 'pct') return `${v.toFixed(0)}%`
  if (f === 'mult') return `${v.toFixed(2)}x`
  return intf.format(v)
}

function dailyMetric(d: MetaAdsReportDaily, m: TrendMetric): number {
  if (m === 'roas') return d.spend > 0 ? d.revenue / d.spend : 0
  if (m === 'roi') return d.spend > 0 ? ((d.revenue - d.spend) / d.spend) * 100 : 0
  return d[m]
}

function TrendChart({ daily }: { daily: MetaAdsReportDaily[] }) {
  const [metric, setMetric] = useState<TrendMetric>('spend')
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [, navigate] = useLocation()
  const cfg = TREND_METRICS.find(m => m.key === metric)!
  const series = useMemo(() => daily.map(d => ({ date: d.date, value: dailyMetric(d, metric) })), [daily, metric])
  const min = Math.min(0, ...series.map(p => p.value))
  const max = Math.max(0, ...series.map(p => p.value))

  // Layout SVG
  const W = 800, H = 180, padL = 56, padR = 16, padT = 14, padB = 28
  const innerW = W - padL - padR
  const innerH = H - padT - padB
  const xStep = series.length > 1 ? innerW / (series.length - 1) : 0
  const range = max - min || 1
  const yOf = (v: number) => padT + innerH - ((v - min) / range) * innerH

  const path = series.map((p, i) => `${i === 0 ? 'M' : 'L'} ${padL + i * xStep} ${yOf(p.value)}`).join(' ')
  const area = series.length > 0
    ? `${path} L ${padL + (series.length - 1) * xStep} ${padT + innerH} L ${padL} ${padT + innerH} Z`
    : ''

  // Eixo Y: 4 ticks
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(t => ({ y: padT + innerH - t * innerH, val: min + t * range }))

  // Eixo X: até 8 labels equidistantes
  const maxXLabels = 8
  const xLabelEvery = Math.max(1, Math.ceil(series.length / maxXLabels))

  function handleMove(e: MouseEvent) {
    const svg = svgRef.current
    if (!svg || series.length === 0) return
    const rect = svg.getBoundingClientRect()
    const scaleX = rect.width / W
    const xInView = (e.clientX - rect.left) / scaleX
    if (xStep === 0) {
      setHoverIdx(0)
      return
    }
    const i = Math.round((xInView - padL) / xStep)
    const clamped = Math.max(0, Math.min(series.length - 1, i))
    setHoverIdx(clamped)
  }
  function handleLeave() { setHoverIdx(null) }
  function handleClick() {
    if (hoverIdx === null) return
    const p = series[hoverIdx]
    if (!p) return
    navigate(`/leads?dateFrom=${encodeURIComponent(p.date)}&dateTo=${encodeURIComponent(p.date)}`)
  }

  const hovered = hoverIdx !== null ? series[hoverIdx] : null
  const hoveredDay = hoverIdx !== null ? daily[hoverIdx] : null
  const hoverX = hovered ? padL + hoverIdx! * xStep : 0
  const hoverY = hovered ? yOf(hovered.value) : 0

  return (
    <Card class="p-0 overflow-hidden">
      <div class="p-4 border-b border-border flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h3 class="text-sm font-semibold text-fg">Tendência temporal</h3>
          <p class="text-2xs text-fg-muted">{cfg.label} por dia · {series.length} pontos · clique em um ponto para ver os leads do dia</p>
        </div>
        <div class="flex items-center gap-1 bg-surface-3 rounded-md p-0.5 flex-wrap">
          {TREND_METRICS.map(m => (
            <TabBtn small key={m.key} active={metric === m.key} onClick={() => setMetric(m.key)}>
              {m.label}
            </TabBtn>
          ))}
        </div>
      </div>
      <div ref={containerRef} class="relative p-3 overflow-x-auto">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          class="w-full h-auto"
          style={{ minWidth: '500px', cursor: hoveredDay ? 'pointer' : 'default' }}
          onMouseMove={handleMove}
          onMouseLeave={handleLeave}
          onClick={handleClick}
        >
          {/* Grid horizontal */}
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={padL} y1={t.y} x2={W - padR} y2={t.y} stroke="currentColor" stroke-opacity="0.1" />
              <text x={padL - 6} y={t.y + 3} text-anchor="end" font-size="9" fill="currentColor" fill-opacity="0.6">
                {fmtTrend(t.val, cfg.format)}
              </text>
            </g>
          ))}
          {/* Eixo X labels */}
          {series.map((p, i) => i % xLabelEvery === 0 && (
            <text
              key={p.date}
              x={padL + i * xStep}
              y={H - padB + 14}
              text-anchor="middle"
              font-size="9"
              fill="currentColor"
              fill-opacity="0.6"
            >
              {new Date(p.date + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
            </text>
          ))}
          {/* Área + linha */}
          {area && <path d={area} fill={cfg.color} fill-opacity="0.12" />}
          {path && <path d={path} fill="none" stroke={cfg.color} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />}
          {/* Crosshair vertical no hover */}
          {hovered && (
            <line
              x1={hoverX} x2={hoverX}
              y1={padT} y2={padT + innerH}
              stroke={cfg.color}
              stroke-opacity="0.35"
              stroke-width="1"
              stroke-dasharray="3 3"
              style={{ pointerEvents: 'none' }}
            />
          )}
          {/* Pontos */}
          {series.map((p, i) => {
            const isHover = hoverIdx === i
            return (
              <circle
                key={p.date}
                cx={padL + i * xStep}
                cy={yOf(p.value)}
                r={isHover ? 4.5 : (p.value === 0 ? 1.5 : 2.5)}
                fill={cfg.color}
                style={{ pointerEvents: 'none', transition: 'r 120ms ease' }}
              />
            )
          })}
          {/* Anel externo no ponto hovered */}
          {hovered && (
            <circle
              cx={hoverX} cy={hoverY} r="8"
              fill="none"
              stroke={cfg.color}
              stroke-width="1.5"
              stroke-opacity="0.45"
              style={{ pointerEvents: 'none' }}
            />
          )}
        </svg>
        {hoveredDay && (
          <TrendTooltip
            day={hoveredDay}
            activeMetric={metric}
            anchorXPct={hoverX / W}
            container={containerRef.current}
          />
        )}
      </div>
    </Card>
  )
}

function TrendTooltip({
  day, activeMetric, anchorXPct, container,
}: {
  day: MetaAdsReportDaily
  activeMetric: TrendMetric
  anchorXPct: number
  container: HTMLDivElement | null
}) {
  const dt = new Date(day.date + 'T12:00:00')
  const dateLabel = dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', weekday: 'short' })
  // Posicionamento HTML acompanhando o ponto. Flipa pra esquerda quando perto da borda direita.
  const cw = container?.clientWidth ?? 800
  const px = anchorXPct * cw
  const flip = px > cw - 220
  const left = flip ? Math.max(8, px - 220) : Math.min(cw - 220, px + 16)
  return (
    <div
      class="pointer-events-none absolute z-30 top-3 rounded-md border border-border bg-surface shadow-lg p-2.5 text-2xs w-[200px]"
      style={{ left: `${left}px` }}
    >
      <div class="text-fg-muted text-3xs uppercase tracking-wide mb-1">{dateLabel}</div>
      <ul class="flex flex-col gap-0.5">
        {TREND_METRICS.map(m => {
          const v = dailyMetric(day, m.key)
          const isActive = activeMetric === m.key
          return (
            <li
              key={m.key}
              class={`flex items-center justify-between gap-2 rounded px-1 py-0.5 -mx-1 ${isActive ? 'bg-surface-3/60' : ''}`}
            >
              <span class="flex items-center gap-1.5 min-w-0">
                <span class="size-1.5 rounded-full shrink-0" style={{ background: m.color }} />
                <span class={`truncate ${isActive ? 'text-fg font-medium' : 'text-fg-muted'}`}>{m.label}</span>
              </span>
              <span class={`tabular-nums ${isActive ? 'text-fg font-semibold' : 'text-fg'}`}>
                {fmtTrend(v, m.format)}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ───────────────────────── Funnel Detailed ─────────────────────────

type FunnelView = 'visual' | 'bars'

function FunnelDetailed({ funnel }: { funnel: MetaAdsReportFunnel }) {
  const [mode, setMode] = useState<'top' | 'prev'>('top')
  const [view, setView] = useState<FunnelView>('visual')
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const [, navigate] = useLocation()
  const top = funnel.top

  const drillTo = (stage: MetaAdsReportFunnelStage) => {
    navigate(`/leads?funnelId=${funnel.id}&stageKey=${encodeURIComponent(stage.key)}`)
  }

  return (
    <Card class="p-0 overflow-hidden">
      <div class="p-4 border-b border-border flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h3 class="text-sm font-semibold text-fg">Funil detalhado · {funnel.name}</h3>
          <p class="text-2xs text-fg-muted">{intf.format(top)} leads no topo do funil · clique em uma etapa para ver os leads</p>
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          <div class="flex items-center gap-1 bg-surface-3 rounded-md p-0.5">
            <TabBtn small active={view === 'visual'} onClick={() => setView('visual')}>Visual</TabBtn>
            <TabBtn small active={view === 'bars'} onClick={() => setView('bars')}>Barras</TabBtn>
          </div>
          <div class="flex items-center gap-1 bg-surface-3 rounded-md p-0.5">
            <TabBtn small active={mode === 'top'} onClick={() => setMode('top')}>% topo</TabBtn>
            <TabBtn small active={mode === 'prev'} onClick={() => setMode('prev')}>% etapa anterior</TabBtn>
          </div>
        </div>
      </div>
      <div class="relative p-4">
        {view === 'visual' ? (
          <FunnelVisual
            funnel={funnel}
            mode={mode}
            hoverIdx={hoverIdx}
            onHover={setHoverIdx}
            onLeave={() => setHoverIdx(null)}
            onClickStage={drillTo}
          />
        ) : (
          <div class="flex flex-col gap-1.5">
            {funnel.stages.map((s, i) => (
              <FunnelStageRow
                key={s.id}
                stage={s}
                top={top}
                mode={mode}
                isFirst={i === 0}
                isHover={hoverIdx === i}
                isDimmed={hoverIdx !== null && hoverIdx !== i}
                onEnter={() => setHoverIdx(i)}
                onLeave={() => setHoverIdx(null)}
                onClick={() => drillTo(s)}
              />
            ))}
            {hoverIdx !== null && funnel.stages[hoverIdx] && (
              <FunnelStageTooltip
                stage={funnel.stages[hoverIdx]}
                top={top}
                mode={mode}
                isFirst={hoverIdx === 0}
              />
            )}
          </div>
        )}
      </div>
    </Card>
  )
}

// Funil VISUAL — faixas trapezoidais centralizadas que estreitam de cima
// pra baixo, com count + receita dentro e conversão lateral. Paridade com
// template Pipedrive+Meta (TERRAM).
function FunnelVisual({
  funnel, mode, hoverIdx, onHover, onLeave, onClickStage,
}: {
  funnel: MetaAdsReportFunnel
  mode: 'top' | 'prev'
  hoverIdx: number | null
  onHover: (i: number) => void
  onLeave: () => void
  onClickStage: (s: MetaAdsReportFunnelStage) => void
}) {
  const top = funnel.top
  const stages = funnel.stages
  // Largura mínima visível para faixas com count baixo (mas > 0)
  const MIN_W = 18
  const hoveredStage = hoverIdx !== null ? stages[hoverIdx] : null
  return (
    <div class="relative flex flex-col gap-1">
      {stages.map((s, i) => {
        const widthPct = top > 0 && s.count > 0
          ? Math.max(MIN_W, Math.min(100, (s.count / top) * 100))
          : MIN_W
        const conv = mode === 'top' ? s.conversionFromTop : s.conversionFromPrev
        const convLabel = (i === 0 && mode === 'prev') ? '—' : `${conv.toFixed(2)}%`
        const tone = s.terminalKind === 'won' ? 'success'
                   : s.terminalKind === 'lost' ? 'danger'
                   : null
        const bg = s.color || (tone === 'success' ? '#16a34a' : tone === 'danger' ? '#dc2626' : '#4f46e5')
        const isHover = hoverIdx === i
        const isDimmed = hoverIdx !== null && hoverIdx !== i
        const rowOpacity = isDimmed ? 0.4 : 1
        return (
          <div
            key={s.id}
            class="grid items-stretch gap-3 cursor-pointer rounded-md transition-opacity"
            style={{ gridTemplateColumns: '7rem minmax(0,1fr) 9rem', opacity: rowOpacity }}
            onMouseEnter={() => onHover(i)}
            onMouseLeave={onLeave}
            onClick={() => onClickStage(s)}
          >
            {/* Esquerda: count + conversão */}
            <div class="flex flex-col items-end justify-center text-right">
              <span class={cn(
                'text-lg font-bold tabular-nums leading-none',
                tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : 'text-fg',
              )}>
                {intf.format(s.count)}
              </span>
              <span class={cn(
                'text-2xs font-semibold tabular-nums mt-0.5',
                conv >= 50 ? 'text-success' : conv >= 20 ? 'text-fg-muted' : 'text-warning',
              )}>
                {convLabel}
              </span>
              <span class="text-3xs text-fg-muted">{mode === 'top' ? 'do topo' : 'da anterior'}</span>
            </div>
            {/* Centro: faixa centralizada */}
            <div class="flex justify-center items-center">
              <div
                class="h-14 rounded-md flex items-center justify-center px-3 shadow-sm"
                style={{
                  width: `${widthPct}%`,
                  minWidth: '90px',
                  background: bg,
                  opacity: isHover ? 1 : 0.92,
                  transform: isHover ? 'scale(1.02)' : 'scale(1)',
                  transition: 'transform 140ms ease, opacity 140ms ease, box-shadow 140ms ease',
                  boxShadow: isHover ? `0 4px 14px ${bg}55` : undefined,
                }}
              >
                <span class="text-xs sm:text-sm font-semibold text-white text-center truncate drop-shadow">
                  {s.name}
                </span>
              </div>
            </div>
            {/* Direita: receita / ticket */}
            <div class="flex flex-col justify-center text-left min-w-0">
              {s.revenue > 0 ? (
                <span class="text-sm font-bold text-success tabular-nums truncate">
                  {brl.format(s.revenue)}
                </span>
              ) : (
                <span class="text-xs text-fg-muted">—</span>
              )}
              {s.ticketAvg > 0 && (
                <span class="text-3xs text-fg-muted tabular-nums">
                  ticket {brl.format(s.ticketAvg)}
                </span>
              )}
              {s.sales > 0 && (
                <span class="text-3xs text-fg-muted tabular-nums">
                  {intf.format(s.sales)} venda{s.sales === 1 ? '' : 's'}
                </span>
              )}
            </div>
          </div>
        )
      })}
      {hoveredStage && (
        <FunnelStageTooltip
          stage={hoveredStage}
          top={top}
          mode={mode}
          isFirst={hoverIdx === 0}
        />
      )}
    </div>
  )
}

function FunnelStageTooltip({
  stage, top, mode, isFirst,
}: {
  stage: MetaAdsReportFunnelStage
  top: number
  mode: 'top' | 'prev'
  isFirst: boolean
}) {
  const convTop = stage.conversionFromTop
  const convPrev = stage.conversionFromPrev
  const tone = stage.terminalKind === 'won' ? 'text-success'
             : stage.terminalKind === 'lost' ? 'text-danger'
             : 'text-fg'
  return (
    <div
      class="pointer-events-none absolute right-2 top-2 z-30 rounded-md border border-border bg-surface shadow-lg p-3 text-2xs w-[220px]"
    >
      <div class="flex items-center gap-2 mb-1.5">
        <span class="size-2.5 rounded-sm shrink-0" style={{ background: stage.color || '#4f46e5' }} />
        <span class={cn('font-semibold truncate', tone)}>{stage.name}</span>
      </div>
      <ul class="flex flex-col gap-0.5">
        <li class="flex items-center justify-between gap-2">
          <span class="text-fg-muted">Leads</span>
          <span class="text-fg font-semibold tabular-nums">{intf.format(stage.count)}</span>
        </li>
        <li class="flex items-center justify-between gap-2">
          <span class="text-fg-muted">% do topo</span>
          <span class="text-fg tabular-nums">{convTop.toFixed(2)}% <span class="text-fg-muted">de {intf.format(top)}</span></span>
        </li>
        <li class="flex items-center justify-between gap-2">
          <span class="text-fg-muted">% etapa anterior</span>
          <span class="text-fg tabular-nums">{isFirst && mode === 'prev' ? '—' : `${convPrev.toFixed(2)}%`}</span>
        </li>
        {stage.sales > 0 && (
          <li class="flex items-center justify-between gap-2">
            <span class="text-fg-muted">Vendas</span>
            <span class="text-fg tabular-nums">{intf.format(stage.sales)}</span>
          </li>
        )}
        {stage.revenue > 0 && (
          <li class="flex items-center justify-between gap-2">
            <span class="text-fg-muted">Receita</span>
            <span class="text-success tabular-nums font-medium">{brl.format(stage.revenue)}</span>
          </li>
        )}
        {stage.ticketAvg > 0 && (
          <li class="flex items-center justify-between gap-2">
            <span class="text-fg-muted">Ticket médio</span>
            <span class="text-fg tabular-nums">{brl.format(stage.ticketAvg)}</span>
          </li>
        )}
      </ul>
      <div class="mt-2 pt-2 border-t border-border text-3xs text-fg-muted">
        Clique para ver os leads desta etapa
      </div>
    </div>
  )
}

function FunnelStageRow({
  stage, top, mode, isFirst, isHover, isDimmed, onEnter, onLeave, onClick,
}: {
  stage: MetaAdsReportFunnelStage
  top: number
  mode: 'top' | 'prev'
  isFirst: boolean
  isHover: boolean
  isDimmed: boolean
  onEnter: () => void
  onLeave: () => void
  onClick: () => void
}) {
  const widthPct = top > 0 ? Math.max(2, (stage.count / top) * 100) : 0
  const conv = mode === 'top' ? stage.conversionFromTop : stage.conversionFromPrev
  const convLabel = isFirst && mode === 'prev' ? '—' : `${conv.toFixed(1)}%`
  const tone = stage.terminalKind === 'won' ? 'text-success' : stage.terminalKind === 'lost' ? 'text-danger' : 'text-fg'
  const stageColor = stage.color || '#4f46e5'
  return (
    <div
      class="flex items-center gap-3 cursor-pointer rounded-md px-1 -mx-1 transition-opacity"
      style={{ opacity: isDimmed ? 0.4 : 1 }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onClick={onClick}
    >
      <div class="w-44 shrink-0 flex items-center gap-2 min-w-0">
        <span class="size-2.5 rounded-full shrink-0" style={{ background: stageColor }} />
        <span class={cn('text-sm font-medium truncate', isHover ? 'text-fg' : 'text-fg')} title={stage.name}>{stage.name}</span>
      </div>
      <div class="flex-1 relative h-7 bg-surface-3 rounded-md overflow-hidden">
        <div
          class="h-full rounded-md"
          style={{
            width: `${widthPct}%`,
            background: stageColor,
            opacity: isHover ? 1 : 0.85,
            boxShadow: isHover ? `inset 0 0 0 1px ${stageColor}` : undefined,
            transition: 'opacity 140ms ease, box-shadow 140ms ease',
          }}
        />
        <div class="absolute inset-0 flex items-center px-2 text-xs font-semibold tabular-nums" style={{ color: 'var(--fg)' }}>
          <span class={cn('font-bold', tone)}>{intf.format(stage.count)}</span>
          {stage.ticketAvg > 0 && (
            <span class="ml-2 text-fg-muted text-2xs">
              ticket {brl.format(stage.ticketAvg)}
            </span>
          )}
          {stage.revenue > 0 && (
            <span class="ml-2 text-success text-2xs font-medium">
              {brl.format(stage.revenue)}
            </span>
          )}
        </div>
      </div>
      <div class="w-20 shrink-0 text-right tabular-nums">
        <div class={cn('text-sm font-semibold', conv >= 50 ? 'text-success' : conv >= 20 ? 'text-fg' : 'text-warning')}>
          {convLabel}
        </div>
        <div class="text-3xs text-fg-muted">{mode === 'top' ? 'do topo' : 'da anterior'}</div>
      </div>
    </div>
  )
}

// ───────────────────────── Heatmap helpers ─────────────────────────

function heatmapCell(value: number, max: number, tone: 'spend' | 'lead' | 'sale' | 'rev' | 'lost' | 'roi'): string {
  if (max <= 0 || value <= 0) return ''
  const intensity = Math.min(1, value / max)
  const pct = Math.round(intensity * 100) / 100
  // hsla por tonalidade — escala suave que mantém legibilidade
  const hues: Record<typeof tone, number> = {
    spend: 38,   // amarelo/âmbar
    lead: 210,   // azul
    sale: 145,   // verde
    rev: 145,    // verde
    lost: 0,     // vermelho
    roi: 280,    // roxo
  }
  return `hsla(${hues[tone]}, 70%, 50%, ${0.08 + pct * 0.32})`
}

function HeatCell({ value, max, tone, format = 'int', emphasize = false }: {
  value: number
  max: number
  tone: 'spend' | 'lead' | 'sale' | 'rev' | 'lost' | 'roi'
  format?: 'int' | 'brl' | 'pct'
  emphasize?: boolean
}) {
  const bg = heatmapCell(value, max, tone)
  const display = value === 0 && tone !== 'roi'
    ? '–'
    : format === 'brl' ? brl.format(value)
    : format === 'pct' ? `${value.toFixed(0)}%`
    : intf.format(value)
  return (
    <td
      class={cn('px-2 py-1 text-right tabular-nums text-2xs', emphasize && 'font-semibold')}
      style={{ background: bg }}
    >
      {display}
    </td>
  )
}

function DailyHeatmapTable({ daily }: { daily: MetaAdsReportDaily[] }) {
  const max = useMemo(() => ({
    spend: Math.max(...daily.map(d => d.spend), 0),
    leads: Math.max(...daily.map(d => d.leads), 0),
    sales: Math.max(...daily.map(d => d.sales), 0),
    revenue: Math.max(...daily.map(d => d.revenue), 0),
    lost: Math.max(...daily.map(d => d.lost), 0),
  }), [daily])

  if (daily.length === 0) return <p class="text-xs text-fg-muted">Sem dados no período.</p>

  return (
    <div class="overflow-auto max-h-96 border border-border rounded-md">
      <table class="w-full text-xs">
        <thead class="bg-surface-3 text-fg-muted text-3xs uppercase tracking-wider sticky top-0">
          <tr>
            <th class="text-left px-2 py-1.5 font-medium">Data</th>
            <th class="text-right px-2 py-1.5 font-medium">Invest.</th>
            <th class="text-right px-2 py-1.5 font-medium">Leads</th>
            <th class="text-right px-2 py-1.5 font-medium">Vendas</th>
            <th class="text-right px-2 py-1.5 font-medium">Fatur.</th>
            <th class="text-right px-2 py-1.5 font-medium">Perdas</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border">
          {[...daily].reverse().map((d) => {
            const dt = new Date(d.date + 'T12:00:00')
            const label = dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
            return (
              <tr key={d.date} class="hover:bg-surface-3/40">
                <td class="px-2 py-1 text-fg-muted text-2xs">{label}</td>
                <HeatCell value={d.spend} max={max.spend} tone="spend" format="brl" />
                <HeatCell value={d.leads} max={max.leads} tone="lead" emphasize />
                <HeatCell value={d.sales} max={max.sales} tone="sale" />
                <HeatCell value={d.revenue} max={max.revenue} tone="rev" format="brl" />
                <HeatCell value={d.lost} max={max.lost} tone="lost" />
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function WeeklyHeatmapTable({ weekly }: { weekly: MetaAdsReportWeekly[] }) {
  const max = useMemo(() => ({
    spend: Math.max(...weekly.map(w => w.spend), 0),
    leads: Math.max(...weekly.map(w => w.leads), 0),
    sales: Math.max(...weekly.map(w => w.sales), 0),
    revenue: Math.max(...weekly.map(w => w.revenue), 0),
    lost: Math.max(...weekly.map(w => w.lost), 0),
  }), [weekly])

  if (weekly.length === 0) return <p class="text-xs text-fg-muted">Sem dados no período.</p>

  function fmtRange(start: string, end: string): string {
    const s = new Date(start + 'T12:00:00')
    const e = new Date(end + 'T12:00:00')
    return `${s.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} – ${e.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`
  }

  return (
    <div class="overflow-auto max-h-96 border border-border rounded-md">
      <table class="w-full text-xs">
        <thead class="bg-surface-3 text-fg-muted text-3xs uppercase tracking-wider sticky top-0">
          <tr>
            <th class="text-left px-2 py-1.5 font-medium">Semana</th>
            <th class="text-right px-2 py-1.5 font-medium">Invest.</th>
            <th class="text-right px-2 py-1.5 font-medium">Leads</th>
            <th class="text-right px-2 py-1.5 font-medium">Vendas</th>
            <th class="text-right px-2 py-1.5 font-medium">Fatur.</th>
            <th class="text-right px-2 py-1.5 font-medium">Perdas</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border">
          {[...weekly].reverse().map((w) => (
            <tr key={w.weekKey} class="hover:bg-surface-3/40">
              <td class="px-2 py-1 text-fg-muted text-2xs">
                <div class="text-fg font-medium">{w.weekKey}</div>
                <div class="text-fg-muted text-3xs">{fmtRange(w.weekStart, w.weekEnd)}</div>
              </td>
              <HeatCell value={w.spend} max={max.spend} tone="spend" format="brl" />
              <HeatCell value={w.leads} max={max.leads} tone="lead" emphasize />
              <HeatCell value={w.sales} max={max.sales} tone="sale" />
              <HeatCell value={w.revenue} max={max.revenue} tone="rev" format="brl" />
              <HeatCell value={w.lost} max={max.lost} tone="lost" />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ───────────────────────── Tabelas Camp/Adset/Ad ─────────────────────────

function CampaignsTable({ rows }: { rows: MetaAdsReportCampaign[] }) {
  if (rows.length === 0) return <EmptyState title="Nenhuma campanha no período selecionado" />
  const totals = useMemo(() => {
    const t = rows.reduce((acc, r) => ({
      spend: acc.spend + r.spend,
      leads: acc.leads + r.leads,
      sales: acc.sales + r.sales,
      revenue: acc.revenue + r.revenue,
      lost: acc.lost + r.lost,
      clicks: acc.clicks + r.clicks,
      impressions: acc.impressions + r.impressions,
    }), { spend: 0, leads: 0, sales: 0, revenue: 0, lost: 0, clicks: 0, impressions: 0 })
    const roi = t.spend > 0 ? ((t.revenue - t.spend) / t.spend) * 100 : 0
    const roas = t.spend > 0 ? t.revenue / t.spend : 0
    const cpl = t.leads > 0 && t.spend > 0 ? t.spend / t.leads : 0
    const ctr = t.impressions > 0 ? (t.clicks / t.impressions) * 100 : 0
    return { ...t, roi, roas, cpl, ctr }
  }, [rows])
  return (
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-surface-3 text-fg-muted text-2xs uppercase tracking-wider">
          <tr>
            <th class="text-left px-3 py-2 font-medium">Campanha</th>
            <th class="text-right px-3 py-2 font-medium">Invest.</th>
            <th class="text-center px-3 py-2 font-medium">Leads</th>
            <th class="text-center px-3 py-2 font-medium">Vendas</th>
            <th class="text-right px-3 py-2 font-medium">Receita</th>
            <th class="text-right px-3 py-2 font-medium">ROI</th>
            <th class="text-right px-3 py-2 font-medium">ROAS</th>
            <th class="text-right px-3 py-2 font-medium">CPL</th>
            <th class="text-right px-3 py-2 font-medium">CTR</th>
            <th class="text-center px-3 py-2 font-medium">Perdas</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border">
          {rows.map((c) => {
            const ctr = c.impressions > 0 && c.clicks > 0 ? `${((c.clicks / c.impressions) * 100).toFixed(2)}%` : '–'
            return (
              <tr key={c.id} class="hover:bg-surface-3/40">
                <td class="px-3 py-2 max-w-[20rem]">
                  <div class="text-fg font-medium truncate" title={c.name}>{c.name}</div>
                  <div class="text-3xs text-fg-muted font-mono truncate">
                    {c.id.length > 18 ? c.id.slice(0, 18) + '…' : c.id}
                  </div>
                </td>
                <td class="px-3 py-2 text-right tabular-nums font-medium text-fg">
                  {c.spend > 0 ? brl.format(c.spend) : '–'}
                </td>
                <td class="px-3 py-2 text-center tabular-nums">
                  <span class="text-info text-base font-bold">{c.leads}</span>
                  {c.metaLeads > c.leads && (
                    <div class="text-3xs text-fg-muted" title={`Meta reporta ${c.metaLeads} leads`}>
                      {c.metaLeads} Meta
                    </div>
                  )}
                </td>
                <td class="px-3 py-2 text-center tabular-nums">
                  {c.sales > 0 ? <span class="text-success font-semibold">{c.sales}</span> : <span class="text-fg-muted">–</span>}
                  {c.conversionRate > 0 && (
                    <div class="text-3xs text-fg-muted">{c.conversionRate.toFixed(1)}%</div>
                  )}
                </td>
                <td class="px-3 py-2 text-right tabular-nums">
                  {c.revenue > 0 ? <span class="text-success font-medium">{brl.format(c.revenue)}</span> : <span class="text-fg-muted">–</span>}
                </td>
                <td class="px-3 py-2 text-right tabular-nums">
                  {c.spend > 0 ? (
                    <span class={cn('font-semibold', c.roi >= 0 ? 'text-success' : 'text-warning')}>
                      {c.roi >= 0 ? '+' : ''}{c.roi.toFixed(0)}%
                    </span>
                  ) : '–'}
                </td>
                <td class="px-3 py-2 text-right tabular-nums">
                  {c.roas > 0 ? (
                    <span class={cn('font-semibold', c.roas >= 1 ? 'text-success' : 'text-warning')}>
                      {c.roas.toFixed(2)}x
                    </span>
                  ) : '–'}
                </td>
                <td class="px-3 py-2 text-right tabular-nums">
                  {c.cpl > 0 ? <span class="text-warning font-semibold">{brl.format(c.cpl)}</span> : '–'}
                </td>
                <td class="px-3 py-2 text-right tabular-nums text-fg-muted">{ctr}</td>
                <td class="px-3 py-2 text-center tabular-nums">
                  {c.lost > 0 ? <span class="text-danger font-medium">{c.lost}</span> : <span class="text-fg-muted">–</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot class="bg-surface-3 border-t-2 border-border">
          <tr class="font-semibold text-fg">
            <td class="px-3 py-2">Total geral</td>
            <td class="px-3 py-2 text-right tabular-nums">{totals.spend > 0 ? brl.format(totals.spend) : '–'}</td>
            <td class="px-3 py-2 text-center tabular-nums text-info">{intf.format(totals.leads)}</td>
            <td class="px-3 py-2 text-center tabular-nums text-success">{intf.format(totals.sales)}</td>
            <td class="px-3 py-2 text-right tabular-nums text-success">{totals.revenue > 0 ? brl.format(totals.revenue) : '–'}</td>
            <td class="px-3 py-2 text-right tabular-nums">
              {totals.spend > 0 ? (
                <span class={cn(totals.roi >= 0 ? 'text-success' : 'text-warning')}>
                  {totals.roi >= 0 ? '+' : ''}{totals.roi.toFixed(0)}%
                </span>
              ) : '–'}
            </td>
            <td class="px-3 py-2 text-right tabular-nums">
              {totals.roas > 0 ? <span class={cn(totals.roas >= 1 ? 'text-success' : 'text-warning')}>{totals.roas.toFixed(2)}x</span> : '–'}
            </td>
            <td class="px-3 py-2 text-right tabular-nums">{totals.cpl > 0 ? brl.format(totals.cpl) : '–'}</td>
            <td class="px-3 py-2 text-right tabular-nums text-fg-muted">{totals.ctr > 0 ? `${totals.ctr.toFixed(2)}%` : '–'}</td>
            <td class="px-3 py-2 text-center tabular-nums text-danger">{totals.lost > 0 ? intf.format(totals.lost) : '–'}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function AdsetsTable({ rows }: { rows: MetaAdsReportAdsetFlat[] }) {
  const totals = useMemo(() => rows.reduce((acc, r) => ({
    leads: acc.leads + r.leads,
    sales: acc.sales + r.sales,
    revenue: acc.revenue + r.revenue,
    lost: acc.lost + r.lost,
    spend: acc.spend + (r.spendKind === 'real' ? r.spend : 0),
  }), { leads: 0, sales: 0, revenue: 0, lost: 0, spend: 0 }), [rows])
  const conv = totals.leads > 0 ? (totals.sales / totals.leads) * 100 : 0
  const totalRoi = totals.spend > 0 ? ((totals.revenue - totals.spend) / totals.spend) * 100 : 0
  const totalCpl = totals.spend > 0 && totals.leads > 0 ? totals.spend / totals.leads : 0
  if (rows.length === 0) return <EmptyState title="Nenhum conjunto de anúncios no período" />
  return (
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-surface-3 text-fg-muted text-2xs uppercase tracking-wider">
          <tr>
            <th class="text-left px-3 py-2 font-medium">Conjunto</th>
            <th class="text-left px-3 py-2 font-medium">Campanha</th>
            <th class="text-right px-3 py-2 font-medium">Invest.</th>
            <th class="text-center px-3 py-2 font-medium">Leads</th>
            <th class="text-center px-3 py-2 font-medium">Vendas</th>
            <th class="text-right px-3 py-2 font-medium">Receita</th>
            <th class="text-right px-3 py-2 font-medium">ROI</th>
            <th class="text-right px-3 py-2 font-medium">CPL</th>
            <th class="text-right px-3 py-2 font-medium">Conv.</th>
            <th class="text-center px-3 py-2 font-medium">Perdas</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border">
          {rows.map((a, i) => (
            <tr key={`${a.campaignId}-${a.id ?? '_'}-${i}`} class="hover:bg-surface-3/40">
              <td class="px-3 py-2 max-w-[18rem]">
                <div class="text-fg font-medium truncate" title={a.name}>{a.name}</div>
                {a.id && <div class="text-3xs text-fg-muted font-mono truncate">{a.id}</div>}
              </td>
              <td class="px-3 py-2 text-fg-muted truncate max-w-[14rem]" title={a.campaignName}>{a.campaignName}</td>
              <td class="px-3 py-2 text-right tabular-nums">
                {a.spend > 0 ? (
                  <span class={cn(a.spendKind === 'real' ? 'text-fg' : 'text-fg-muted italic')} title={a.spendKind === 'estimated' ? 'estimativa proporcional ao share de leads na campanha (sync level=adset não disponível)' : a.spendKind === 'real' ? 'gasto real do conjunto (sync Meta level=adset)' : ''}>
                    {brl.format(a.spend)}
                    {a.spendKind === 'estimated' && <span class="text-3xs ml-1 opacity-60">est.</span>}
                  </span>
                ) : <span class="text-fg-muted">–</span>}
              </td>
              <td class="px-3 py-2 text-center tabular-nums">
                <span class="text-info font-semibold">{a.leads}</span>
              </td>
              <td class="px-3 py-2 text-center tabular-nums">
                {a.sales > 0 ? <span class="text-success font-semibold">{a.sales}</span> : <span class="text-fg-muted">–</span>}
              </td>
              <td class="px-3 py-2 text-right tabular-nums">
                {a.revenue > 0 ? <span class="text-success font-medium">{brl.format(a.revenue)}</span> : <span class="text-fg-muted">–</span>}
              </td>
              <td class="px-3 py-2 text-right tabular-nums">
                {a.spend > 0 ? (
                  <span class={cn('font-semibold', a.roi >= 0 ? 'text-success' : 'text-warning')}>
                    {a.roi >= 0 ? '+' : ''}{a.roi.toFixed(0)}%
                  </span>
                ) : '–'}
              </td>
              <td class="px-3 py-2 text-right tabular-nums text-fg-muted">
                {a.cpl > 0 ? brl.format(a.cpl) : '–'}
              </td>
              <td class="px-3 py-2 text-right tabular-nums text-fg-muted">
                {a.conversionRate > 0 ? `${a.conversionRate.toFixed(1)}%` : '–'}
              </td>
              <td class="px-3 py-2 text-center tabular-nums">
                {a.lost > 0 ? <span class="text-danger font-medium">{a.lost}</span> : <span class="text-fg-muted">–</span>}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot class="bg-surface-3 border-t-2 border-border">
          <tr class="font-semibold text-fg">
            <td class="px-3 py-2" colSpan={2}>Total geral</td>
            <td class="px-3 py-2 text-right tabular-nums">{totals.spend > 0 ? brl.format(totals.spend) : '–'}</td>
            <td class="px-3 py-2 text-center tabular-nums text-info">{intf.format(totals.leads)}</td>
            <td class="px-3 py-2 text-center tabular-nums text-success">{intf.format(totals.sales)}</td>
            <td class="px-3 py-2 text-right tabular-nums text-success">{totals.revenue > 0 ? brl.format(totals.revenue) : '–'}</td>
            <td class="px-3 py-2 text-right tabular-nums">
              {totals.spend > 0 ? <span class={cn(totalRoi >= 0 ? 'text-success' : 'text-warning')}>{totalRoi >= 0 ? '+' : ''}{totalRoi.toFixed(0)}%</span> : '–'}
            </td>
            <td class="px-3 py-2 text-right tabular-nums">{totalCpl > 0 ? brl.format(totalCpl) : '–'}</td>
            <td class="px-3 py-2 text-right tabular-nums">{conv > 0 ? `${conv.toFixed(1)}%` : '–'}</td>
            <td class="px-3 py-2 text-center tabular-nums text-danger">{totals.lost > 0 ? intf.format(totals.lost) : '–'}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function AdsTable({ rows }: { rows: MetaAdsReportAdFlat[] }) {
  const totals = useMemo(() => rows.reduce((acc, r) => ({
    leads: acc.leads + r.leads,
    sales: acc.sales + r.sales,
    revenue: acc.revenue + r.revenue,
    lost: acc.lost + r.lost,
    spend: acc.spend + (r.spendKind === 'real' ? r.spend : 0),
  }), { leads: 0, sales: 0, revenue: 0, lost: 0, spend: 0 }), [rows])
  const conv = totals.leads > 0 ? (totals.sales / totals.leads) * 100 : 0
  const totalRoi = totals.spend > 0 ? ((totals.revenue - totals.spend) / totals.spend) * 100 : 0
  const totalCpl = totals.spend > 0 && totals.leads > 0 ? totals.spend / totals.leads : 0
  if (rows.length === 0) return <EmptyState title="Nenhum anúncio no período" />
  return (
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-surface-3 text-fg-muted text-2xs uppercase tracking-wider">
          <tr>
            <th class="text-left px-3 py-2 font-medium">Anúncio</th>
            <th class="text-left px-3 py-2 font-medium">Conjunto</th>
            <th class="text-left px-3 py-2 font-medium">Campanha</th>
            <th class="text-right px-3 py-2 font-medium">Invest.</th>
            <th class="text-center px-3 py-2 font-medium">Leads</th>
            <th class="text-center px-3 py-2 font-medium">Vendas</th>
            <th class="text-right px-3 py-2 font-medium">Receita</th>
            <th class="text-right px-3 py-2 font-medium">ROI</th>
            <th class="text-right px-3 py-2 font-medium">CPL</th>
            <th class="text-right px-3 py-2 font-medium">Conv.</th>
            <th class="text-center px-3 py-2 font-medium">Perdas</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border">
          {rows.map((a, i) => (
            <tr key={`${a.campaignId}-${a.adsetId ?? '_'}-${a.id ?? '_'}-${i}`} class="hover:bg-surface-3/40">
              <td class="px-3 py-2 max-w-[16rem]">
                <div class="text-fg font-medium truncate" title={a.name}>{a.name}</div>
                {a.id && <div class="text-3xs text-fg-muted font-mono truncate">{a.id}</div>}
              </td>
              <td class="px-3 py-2 text-fg-muted truncate max-w-[12rem]" title={a.adsetName}>{a.adsetName}</td>
              <td class="px-3 py-2 text-fg-muted truncate max-w-[12rem]" title={a.campaignName}>{a.campaignName}</td>
              <td class="px-3 py-2 text-right tabular-nums">
                {a.spend > 0 ? (
                  <span class={cn(a.spendKind === 'real' ? 'text-fg' : 'text-fg-muted italic')} title={a.spendKind === 'estimated' ? 'estimativa proporcional ao share de leads' : a.spendKind === 'real' ? 'gasto real do anúncio (sync Meta level=ad)' : ''}>
                    {brl.format(a.spend)}
                    {a.spendKind === 'estimated' && <span class="text-3xs ml-1 opacity-60">est.</span>}
                  </span>
                ) : <span class="text-fg-muted">–</span>}
              </td>
              <td class="px-3 py-2 text-center tabular-nums">
                <span class="text-info font-semibold">{a.leads}</span>
              </td>
              <td class="px-3 py-2 text-center tabular-nums">
                {a.sales > 0 ? <span class="text-success font-semibold">{a.sales}</span> : <span class="text-fg-muted">–</span>}
              </td>
              <td class="px-3 py-2 text-right tabular-nums">
                {a.revenue > 0 ? <span class="text-success font-medium">{brl.format(a.revenue)}</span> : <span class="text-fg-muted">–</span>}
              </td>
              <td class="px-3 py-2 text-right tabular-nums">
                {a.spend > 0 ? (
                  <span class={cn('font-semibold', a.roi >= 0 ? 'text-success' : 'text-warning')}>
                    {a.roi >= 0 ? '+' : ''}{a.roi.toFixed(0)}%
                  </span>
                ) : '–'}
              </td>
              <td class="px-3 py-2 text-right tabular-nums text-fg-muted">
                {a.cpl > 0 ? brl.format(a.cpl) : '–'}
              </td>
              <td class="px-3 py-2 text-right tabular-nums text-fg-muted">
                {a.conversionRate > 0 ? `${a.conversionRate.toFixed(1)}%` : '–'}
              </td>
              <td class="px-3 py-2 text-center tabular-nums">
                {a.lost > 0 ? <span class="text-danger font-medium">{a.lost}</span> : <span class="text-fg-muted">–</span>}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot class="bg-surface-3 border-t-2 border-border">
          <tr class="font-semibold text-fg">
            <td class="px-3 py-2" colSpan={3}>Total geral</td>
            <td class="px-3 py-2 text-right tabular-nums">{totals.spend > 0 ? brl.format(totals.spend) : '–'}</td>
            <td class="px-3 py-2 text-center tabular-nums text-info">{intf.format(totals.leads)}</td>
            <td class="px-3 py-2 text-center tabular-nums text-success">{intf.format(totals.sales)}</td>
            <td class="px-3 py-2 text-right tabular-nums text-success">{totals.revenue > 0 ? brl.format(totals.revenue) : '–'}</td>
            <td class="px-3 py-2 text-right tabular-nums">
              {totals.spend > 0 ? <span class={cn(totalRoi >= 0 ? 'text-success' : 'text-warning')}>{totalRoi >= 0 ? '+' : ''}{totalRoi.toFixed(0)}%</span> : '–'}
            </td>
            <td class="px-3 py-2 text-right tabular-nums">{totalCpl > 0 ? brl.format(totalCpl) : '–'}</td>
            <td class="px-3 py-2 text-right tabular-nums">{conv > 0 ? `${conv.toFixed(1)}%` : '–'}</td>
            <td class="px-3 py-2 text-center tabular-nums text-danger">{totals.lost > 0 ? intf.format(totals.lost) : '–'}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

// ───────────────────────── Stages Breakdown Table ─────────────────────────

// Tabela "Por etapa do funil": cada linha mostra nome | invest | <stages> | perdas.
// Stages são as colunas dinâmicas do funil selecionado. Paridade com template
// Pipedrive+Meta (TERRAM) — visões Campanha/Conjunto/Anúncio compartilham o mesmo
// componente, alternando metadados (campaignName/adsetName) conforme o tipo.
function StagesBreakdownTable({
  kind, stages, campaigns, adsets, ads,
}: {
  kind: BreakdownTab
  stages: MetaAdsReportFunnelStage[]
  campaigns: MetaAdsReportCampaign[]
  adsets: MetaAdsReportAdsetFlat[]
  ads: MetaAdsReportAdFlat[]
}) {
  type Row = {
    key: string
    name: string
    id: string | null
    campaignName?: string
    adsetName?: string
    spend: number
    spendKind: 'real' | 'estimated' | 'none'
    lost: number
    leads: number
    revenue: number
    stageCounts: Record<string, number>
  }

  const rows: Row[] = useMemo(() => {
    if (kind === 'campaigns') {
      return campaigns.map((c, i) => ({
        key: `${c.id}-${i}`,
        name: c.name,
        id: c.id,
        spend: c.spend,
        spendKind: 'real' as const,
        lost: c.lost,
        leads: c.leads,
        revenue: c.revenue,
        stageCounts: c.stageCounts || {},
      }))
    }
    if (kind === 'adsets') {
      return adsets.map((a, i) => ({
        key: `${a.campaignId}-${a.id ?? '_'}-${i}`,
        name: a.name,
        id: a.id,
        campaignName: a.campaignName,
        spend: a.spend,
        spendKind: a.spendKind,
        lost: a.lost,
        leads: a.leads,
        revenue: a.revenue,
        stageCounts: a.stageCounts || {},
      }))
    }
    return ads.map((a, i) => ({
      key: `${a.campaignId}-${a.adsetId ?? '_'}-${a.id ?? '_'}-${i}`,
      name: a.name,
      id: a.id,
      campaignName: a.campaignName,
      adsetName: a.adsetName,
      spend: a.spend,
      spendKind: a.spendKind,
      lost: a.lost,
      leads: a.leads,
      revenue: a.revenue,
      stageCounts: a.stageCounts || {},
    }))
  }, [kind, campaigns, adsets, ads])

  if (rows.length === 0) {
    return <EmptyState title={kind === 'campaigns' ? 'Nenhuma campanha no período' : kind === 'adsets' ? 'Nenhum conjunto no período' : 'Nenhum anúncio no período'} />
  }

  const stageMaxCount: Record<string, number> = {}
  for (const s of stages) {
    stageMaxCount[s.key] = rows.reduce((m, r) => Math.max(m, r.stageCounts[s.key] || 0), 0)
  }

  // Totais — só somar spend "real" pra evitar dupla contagem em adset/ad estimado
  const totals = rows.reduce(
    (acc, r) => {
      acc.spend += r.spendKind === 'real' || kind === 'campaigns' ? r.spend : 0
      acc.lost += r.lost
      acc.leads += r.leads
      acc.revenue += r.revenue
      for (const s of stages) {
        acc.stageCounts[s.key] = (acc.stageCounts[s.key] || 0) + (r.stageCounts[s.key] || 0)
      }
      return acc
    },
    { spend: 0, lost: 0, leads: 0, revenue: 0, stageCounts: {} as Record<string, number> },
  )

  const colSpanFooter = kind === 'ads' ? 3 : kind === 'adsets' ? 2 : 1

  return (
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-surface-3 text-fg-muted text-2xs uppercase tracking-wider">
          <tr>
            <th class="text-left px-3 py-2 font-medium">
              {kind === 'campaigns' ? 'Campanha' : kind === 'adsets' ? 'Conjunto' : 'Anúncio'}
            </th>
            {kind === 'ads' && <th class="text-left px-3 py-2 font-medium">Conjunto</th>}
            {kind !== 'campaigns' && <th class="text-left px-3 py-2 font-medium">Campanha</th>}
            <th class="text-right px-3 py-2 font-medium">Invest.</th>
            {stages.map(s => (
              <th
                key={s.key}
                class="text-center px-2 py-2 font-medium"
                title={s.name}
                style={{ borderBottom: `2px solid ${s.color || 'transparent'}` }}
              >
                <span class="inline-block max-w-[8rem] truncate align-middle">{s.name}</span>
              </th>
            ))}
            <th class="text-center px-3 py-2 font-medium">Perdas</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border">
          {rows.map(r => (
            <tr key={r.key} class="hover:bg-surface-3/40">
              <td class="px-3 py-2 max-w-[18rem]">
                <div class="text-fg font-medium truncate" title={r.name}>{r.name}</div>
                {r.id && <div class="text-3xs text-fg-muted font-mono truncate">{r.id.length > 18 ? r.id.slice(0, 18) + '…' : r.id}</div>}
              </td>
              {kind === 'ads' && (
                <td class="px-3 py-2 text-fg-muted truncate max-w-[10rem]" title={r.adsetName}>{r.adsetName ?? '–'}</td>
              )}
              {kind !== 'campaigns' && (
                <td class="px-3 py-2 text-fg-muted truncate max-w-[12rem]" title={r.campaignName}>{r.campaignName ?? '–'}</td>
              )}
              <td class="px-3 py-2 text-right tabular-nums">
                {r.spend > 0 ? (
                  <span class={cn(r.spendKind === 'real' || kind === 'campaigns' ? 'text-fg' : 'text-fg-muted italic')}
                        title={r.spendKind === 'estimated' ? 'estimativa proporcional ao share de leads' : ''}>
                    {brl.format(r.spend)}
                    {r.spendKind === 'estimated' && <span class="text-3xs ml-1 opacity-60">est.</span>}
                  </span>
                ) : <span class="text-fg-muted">–</span>}
              </td>
              {stages.map(s => {
                const v = r.stageCounts[s.key] || 0
                const max = stageMaxCount[s.key] || 0
                const intensity = max > 0 ? v / max : 0
                const tone: 'sale' | 'lost' | 'lead' = s.terminalKind === 'won' ? 'sale' : s.terminalKind === 'lost' ? 'lost' : 'lead'
                const bg = v > 0 ? heatmapCell(v, max, tone) : ''
                const txt = s.terminalKind === 'won' ? 'text-success' : s.terminalKind === 'lost' ? 'text-danger' : 'text-fg'
                return (
                  <td
                    key={s.key}
                    class={cn('px-2 py-2 text-center tabular-nums', v > 0 && 'font-semibold', txt)}
                    style={{ background: bg }}
                    title={`${s.name}: ${v} lead${v === 1 ? '' : 's'}${intensity > 0 ? ` (${(intensity * 100).toFixed(0)}% do máx.)` : ''}`}
                  >
                    {v > 0 ? intf.format(v) : <span class="text-fg-muted font-normal">–</span>}
                  </td>
                )
              })}
              <td class="px-3 py-2 text-center tabular-nums">
                {r.lost > 0 ? <span class="text-danger font-semibold">{intf.format(r.lost)}</span> : <span class="text-fg-muted">–</span>}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot class="bg-surface-3 border-t-2 border-border">
          <tr class="font-semibold text-fg">
            <td class="px-3 py-2" colSpan={colSpanFooter}>Total geral</td>
            <td class="px-3 py-2 text-right tabular-nums">{totals.spend > 0 ? brl.format(totals.spend) : '–'}</td>
            {stages.map(s => {
              const v = totals.stageCounts[s.key] || 0
              const txt = s.terminalKind === 'won' ? 'text-success' : s.terminalKind === 'lost' ? 'text-danger' : 'text-fg'
              return (
                <td key={s.key} class={cn('px-2 py-2 text-center tabular-nums', txt)}>
                  {v > 0 ? intf.format(v) : '–'}
                </td>
              )
            })}
            <td class="px-3 py-2 text-center tabular-nums text-danger">{totals.lost > 0 ? intf.format(totals.lost) : '–'}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

// ───────────────────────── small UI helpers ─────────────────────────

function TabBtn({ active, onClick, small, children }: {
  active: boolean
  onClick: () => void
  small?: boolean
  children: any
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      class={cn(
        'rounded-md font-medium transition-colors',
        small ? 'px-2 py-1 text-2xs' : 'px-3 py-1.5 text-xs',
        active ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg',
      )}
    >
      {children}
    </button>
  )
}

function Pill({ children }: { children: any }) {
  return (
    <span class="ml-1 inline-flex items-center px-1.5 py-0 rounded-sm bg-surface-3 text-fg-muted text-3xs font-mono">
      {children}
    </span>
  )
}

// Configura quais contas de anúncio o sync deve puxar por integração.
// Resolve o caso em que a descoberta automática (business da página) falha
// com "(#200) Requires business_management permission" e o relatório fica
// sem investimento. Após salvar, clicar em "Sincronizar Meta".
function AdAccountConfigModal({ onClose }: { onClose: () => void }) {
  const { data, isLoading, isError } = useMetaAdAccounts()
  const save = useSaveMetaAdAccounts()
  const [sel, setSel] = useState<Record<number, Set<string>>>({})
  const [hydrated, setHydrated] = useState(false)

  if (data && !hydrated) {
    const init: Record<number, Set<string>> = {}
    for (const it of data.integrations) init[it.integrationId] = new Set(it.selected || [])
    setSel(init)
    setHydrated(true)
  }

  function toggle(integId: number, actId: string) {
    setSel((s) => {
      const next = new Set(s[integId] ?? [])
      if (next.has(actId)) next.delete(actId)
      else next.add(actId)
      return { ...s, [integId]: next }
    })
  }

  function handleSave(it: MetaAdAccountsIntegration) {
    save.mutate(
      { integrationId: it.integrationId, adAccountIds: [...(sel[it.integrationId] ?? [])] },
      {
        onSuccess: (r) =>
          toast(
            `Salvo (${r.adAccountIds.length} conta(s)). Agora clique em "Sincronizar Meta".`,
            'success',
          ),
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      },
    )
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Contas de anúncio do relatório"
      description="Escolha qual conta de anúncio cada integração deve puxar. Use quando o investimento não aparece (a descoberta automática pela página não funciona em contas de agência/múltiplos negócios)."
      size="lg"
      footer={<Button variant="secondary" size="sm" onClick={onClose}>Fechar</Button>}
    >
      {isLoading && <Skeleton class="h-40 w-full" />}
      {isError && <div class="text-sm text-danger">Erro ao carregar contas de anúncio.</div>}
      {!isLoading && data && data.integrations.length === 0 && (
        <div class="text-sm text-fg-muted text-center py-6">Nenhuma integração Meta ativa.</div>
      )}
      {!isLoading && data && data.integrations.map((it) => (
        <section key={it.integrationId} class="rounded-lg border border-border bg-surface-2 overflow-hidden mb-3">
          <div class="px-4 py-2 border-b border-border bg-surface flex items-center justify-between">
            <div class="text-sm font-semibold text-fg">{it.pageName}</div>
            <Button
              variant="primary"
              size="sm"
              onClick={() => handleSave(it)}
              disabled={save.isPending}
            >
              {save.isPending ? 'Salvando…' : 'Salvar'}
            </Button>
          </div>
          <div class="p-4">
            {it.error && (
              <div class="text-xs text-warning bg-warning/10 px-2 py-1.5 rounded-md mb-2">
                Não foi possível listar as contas desta integração: {it.error}
              </div>
            )}
            {it.accounts.length === 0 && !it.error && (
              <div class="text-xs text-fg-muted">Nenhuma conta de anúncio acessível por este token.</div>
            )}
            {it.accounts.length > 0 && (
              <div class="max-h-72 overflow-y-auto divide-y divide-border">
                {it.accounts.map((a) => {
                  const checked = (sel[it.integrationId] ?? new Set()).has(a.id)
                  return (
                    <label key={a.id} class="flex items-center gap-2.5 py-1.5 cursor-pointer text-sm text-fg">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(it.integrationId, a.id)}
                      />
                      <span class="flex-1 min-w-0 truncate">{a.name}</span>
                      <span class="font-mono text-3xs text-fg-muted shrink-0">{a.id}</span>
                      <span
                        class={cn(
                          'text-3xs px-1.5 rounded shrink-0',
                          a.status === 1 ? 'bg-success/15 text-success' : 'bg-surface-3 text-fg-muted',
                        )}
                      >
                        {a.status === 1 ? 'ativa' : `st${a.status}`}
                      </span>
                    </label>
                  )
                })}
              </div>
            )}
          </div>
        </section>
      ))}
    </Modal>
  )
}
