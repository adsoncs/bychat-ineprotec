import { useState, useMemo, useRef } from 'preact/hooks'
import { lazy, Suspense } from 'preact/compat'
import { useLocation } from 'wouter-preact'
import { Filter as FilterIcon, Download } from 'lucide-preact'
import { useUpdateDashboard, useWidgetData, type Widget } from '@/hooks/useWidgets'
import { useFunnels } from '@/hooks/useFunnels'
import { Card } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { leadSourceLabel } from '@/lib/leadSourceLabels'
import { FUNNEL_AWARE_METRICS } from './WidgetCatalog'

const LazyLeadDetailModal = lazy(() =>
  import('@/routes/pages/LeadsPage').then((m) => ({ default: m.LeadDetailModal })),
)

interface WidgetRendererProps {
  widget: Widget
  filters?: { dateFrom?: string | undefined; dateTo?: string | undefined; funnelId?: number | undefined } | undefined
  /** ações no canto superior direito (ex.: editar/mover/remover) */
  actions?: preact.ComponentChildren
  /** dashboard ativo — usado para persistir mudanças inline (selector funil em leads_by_funnel) */
  dashboardId?: number | undefined
  allWidgets?: Widget[] | undefined
}

const PALETTE = [
  '#1a73e8', '#34a853', '#9334e6', '#f9ab00', '#ea4335', '#e91e63',
  '#00bcd4', '#ff9800', '#4caf50', '#673ab7', '#795548', '#607d8b',
]

export function WidgetRenderer({ widget, filters, actions, dashboardId, allWidgets }: WidgetRendererProps) {
  const config = { ...filters, ...(widget.config ?? {}) }
  const { data, isLoading, error } = useWidgetData({ metric: widget.metric, config })

  return (
    <Card>
      <div class="flex items-start justify-between gap-2 mb-2">
        <div class="text-sm font-medium text-fg truncate">{widget.title}</div>
        {actions}
      </div>

      {isLoading && <Skeleton class="h-20 w-full" />}
      {error && <div class="text-xs text-danger">Falha: {(error).message}</div>}
      {!isLoading && !error && data !== undefined && (
        <WidgetBody widget={widget} data={data} dashboardId={dashboardId} allWidgets={allWidgets} />
      )}
      {/* Métrica sem histórico datado (só contador acumulado): avisa em vez de
          deixar o número parado sem explicação quando o período muda. */}
      {!isLoading && !error && (data as any)?.periodScoped === false && (filters?.dateFrom || filters?.dateTo) && (
        <div class="mt-2 text-[10px] text-fg-subtle">Total acumulado — esta métrica não tem histórico por data.</div>
      )}
    </Card>
  )
}

function WidgetBody({
  widget, data, dashboardId, allWidgets,
}: {
  widget: Widget
  data: unknown
  dashboardId?: number | undefined
  allWidgets?: Widget[] | undefined
}) {
  // Normalização para chart-types em métricas que retornam objetos não-array
  const normalizedData = normalizeWidgetData(widget, data)

  switch (widget.type) {
    case 'kpi': return <KpiBody metric={widget.metric} data={normalizedData} config={widget.config} />
    case 'bar': return <BarChartBody data={normalizedData} chartType="bar" widget={widget} />
    case 'hbar': return <BarChartBody data={normalizedData} chartType="hbar" widget={widget} />
    case 'line': return <LineAreaBody data={normalizedData} chartType="line" widget={widget} />
    case 'area': return <LineAreaBody data={normalizedData} chartType="area" widget={widget} />
    case 'pie': return <PieChartBody data={normalizedData} chartType="pie" widget={widget} />
    case 'donut': return <PieChartBody data={normalizedData} chartType="donut" widget={widget} />
    case 'polar': return <PieChartBody data={normalizedData} chartType="polar" widget={widget} />
    case 'radar': return <RadarBody data={normalizedData} />
    case 'gauge': return <GaugeBody metric={widget.metric} data={normalizedData} />
    case 'stat_grid': return <StatGridBody metric={widget.metric} data={normalizedData} />
    case 'hbar_list': return <HBarListBody data={normalizedData} />
    case 'funnel': return (
      <FunnelBody
        widget={widget}
        data={normalizedData}
        dashboardId={dashboardId}
        allWidgets={allWidgets}
      />
    )
    case 'progress': return <ProgressBody data={normalizedData} />
    case 'table': return <TableBody metric={widget.metric} data={normalizedData} />
    // Legacy aliases (dashboards salvos) — caem em comportamento equivalente
    case 'chart': return <LineAreaBody data={normalizedData} chartType="line" widget={widget} />
    case 'list': return <ListBody metric={widget.metric} data={normalizedData} />
    case 'breakdown': return <BreakdownBody data={normalizedData} />
    default: return <pre class="text-xs text-fg-subtle">{JSON.stringify(data, null, 2)}</pre>
  }
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

/** Minutos → texto legível (ex.: 90 → "1h30", 45 → "45min", 2880 → "2d"). */
function fmtMins(v: unknown): string {
  const m = Number(v ?? 0)
  if (!v || Number.isNaN(m) || m <= 0) return '—'
  if (m < 60) return `${Math.round(m)}min`
  if (m < 1440) { const h = Math.floor(m / 60), mm = Math.round(m % 60); return mm ? `${h}h${mm}` : `${h}h` }
  const dd = Math.floor(m / 1440), hh = Math.round((m % 1440) / 60); return hh ? `${dd}d${hh}h` : `${dd}d`
}

function pillarLabel(k: string): string {
  const map: Record<string, string> = {
    geral: 'Geral', mkt: 'Marketing', vendas: 'Vendas', vnd: 'Vendas',
    oferta: 'Oferta', dados: 'Dados', proc: 'Processos', pessoas: 'Pessoas',
    produto: 'Produto', operacao: 'Operação', financ: 'Financeiro', ia: 'IA',
  }
  return map[k] ?? k
}

interface DataPoint {
  label?: string
  name?: string
  key?: string
  value?: number
  count?: number
  color?: string
  sent?: number
  received?: number
}

// ───────────────────────────────────────────────
// Normalização de dados (espelhando wbRenderSingleWidget do legado)
// ───────────────────────────────────────────────

function normalizeWidgetData(widget: Widget, data: unknown): unknown {
  if (data === null || typeof data !== 'object') return data
  const d = data as Record<string, unknown>
  const chartTypes = ['bar', 'hbar', 'line', 'area', 'pie', 'donut', 'polar', 'hbar_list']

  if (chartTypes.includes(widget.type) && !Array.isArray(d.data)) {
    if (widget.metric === 'activities_summary') {
      d.data = [
        { label: 'Pendentes', value: Number(d.pending ?? 0), color: '#f9ab00' },
        { label: 'Atrasadas', value: Number(d.overdue ?? 0), color: '#ea4335' },
        { label: 'Concluídas', value: Number(d.completed ?? 0), color: '#34a853' },
      ]
    } else if (widget.metric === 'meta_leads') {
      d.data = [
        { label: 'Processados', value: Number(d.processed ?? 0), color: '#34a853' },
        { label: 'Falhas', value: Number(d.failed ?? 0), color: '#ea4335' },
      ]
    }
  }

  // Normaliza pages_performance / forms_performance / templates_usage para barras
  if ((widget.type === 'bar' || widget.type === 'hbar') && Array.isArray(d.data)) {
    const arr = d.data as Record<string, unknown>[]
    if (widget.metric === 'pages_performance' && arr[0]?.title !== undefined) {
      d.data = arr.map((p) => ({
        label: (p.title as string) || (p.slug as string),
        value: Number(p.views ?? 0),
        color: '#1a73e8',
      }))
    } else if (widget.metric === 'forms_performance' && arr[0]?.name !== undefined) {
      d.data = arr.map((f) => ({
        label: (f.name as string),
        value: Number(f.submissions ?? 0),
        color: '#34a853',
      }))
    } else if (widget.metric === 'templates_usage' && arr[0]?.name !== undefined) {
      d.data = arr.map((t) => ({
        label: (t.name as string),
        value: Number(t.usageCount ?? 0),
        color: '#9334e6',
      }))
    } else if (widget.metric === 'leads_by_funnel') {
      d.data = arr.map((f) => ({
        label: (f.label as string),
        value: Number(f.value ?? 0),
        color: '#1a73e8',
      }))
    }
  }

  return d
}

// ───────────────────────────────────────────────
// KPI
// ───────────────────────────────────────────────

/**
 * Variação % vs período anterior. `invert` inverte a semântica de cor
 * (ex.: perdidos subindo é ruim → vermelho).
 */
function DeltaBadge({ curr, prev, invert = false }: { curr: number; prev: unknown; invert?: boolean }) {
  const p = Number(prev)
  if (prev === null || prev === undefined || !Number.isFinite(p)) return null
  if (p === 0 && curr === 0) return <span class="text-fg-subtle">sem movimento nos 2 períodos</span>
  if (p === 0) {
    return <span class={invert ? 'text-danger' : 'text-success'}>▲ anterior era 0</span>
  }
  const pct = Math.round(((curr - p) / p) * 100)
  if (pct === 0) return <span class="text-fg-subtle">= período anterior</span>
  const up = pct > 0
  const good = invert ? !up : up
  return (
    <span class={good ? 'text-success' : 'text-danger'}>
      {up ? '▲' : '▼'} {Math.abs(pct)}% vs anterior
    </span>
  )
}

function KpiBody({ metric, data, config }: { metric: string; data: unknown; config?: Record<string, unknown> | undefined }) {
  if (data === null || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  const num = (v: unknown) => Number(v ?? 0)

  let val: preact.ComponentChildren = ''
  let sub: preact.ComponentChildren = ''

  switch (metric) {
    case 'leads_total':
      val = num(d.value)
      sub = d.prev !== undefined
        ? <DeltaBadge curr={num(d.value)} prev={d.prev} />
        : 'leads cadastrados'
      break
    case 'leads_won':
      val = num(d.value)
      sub = d.prev !== undefined ? <DeltaBadge curr={num(d.value)} prev={d.prev} /> : 'leads do período que fecharam'
      break
    case 'leads_won_revenue':
      val = brl.format(num(d.value))
      sub = d.prev !== undefined ? <DeltaBadge curr={num(d.value)} prev={d.prev} /> : `${num(d.count)} negócios ganhos`
      break
    case 'leads_lost':
      val = num(d.value)
      sub = (
        <>
          {d.prev !== undefined && <DeltaBadge curr={num(d.value)} prev={d.prev} invert />}
          {d.topReason ? <span class="block truncate" title={String(d.topReason)}>maior objeção: {String(d.topReason)}</span> : null}
          {d.prev === undefined && !d.topReason ? 'perdidos no período' : null}
        </>
      )
      break
    case 'leads_conversion_rate':
      // Amostra abaixo do piso: o percentual mente com cara de resultado ("100%"
      // de uma única negociação). Mostra a contagem crua e nenhum número grande.
      if (d.insufficient) {
        val = <em class="text-base text-fg-muted">—</em>
        sub = `${num(d.won)} de ${num(d.negotiated)} — amostra pequena para uma taxa`
        break
      }
      val = <>{num(d.value)}<em class="text-base text-fg-muted ml-1">%</em></>
      // Dois denominadores possíveis: quem negociou (padrão) ou, em cliente que
      // não usa o módulo Negociação, os encerrados. `basis` diz qual veio.
      sub = d.basis === 'outcome'
        ? (num(d.closed) > 0 ? `${num(d.won)} ganhos de ${num(d.closed)} encerrados` : 'nenhum negócio encerrado no período')
        : num(d.negotiated) > 0
          ? <>
              {d.prev !== undefined && <DeltaBadge curr={num(d.value)} prev={d.prev} />}
              <span class="block">{num(d.won)} ganhos de {num(d.negotiated)} que negociaram</span>
            </>
          : 'nenhuma negociação aberta no período'
      break
    case 'leads_new':
      val = num(d.today)
      sub = `${num(d.week)} esta semana`
      break
    case 'leads_uncontacted':
      val = num(d.value)
      sub = 'sem atividade executada'
      break
    case 'leads_submissions':
      val = num(d.value)
      sub = 'eventos de aquisição (cada submit)'
      break
    case 'leads_unique':
      val = num(d.value)
      sub = num(d.duplicatesPending) > 0
        ? `${num(d.duplicatesPending)} aguardando revisão`
        : 'inscrições - duplicados pendentes'
      break
    case 'leads_duplicates_pending':
      val = num(d.value)
      sub = num(d.value) > 0 ? 'aguardando revisão humana' : 'nenhum pendente'
      break
    case 'leads_avg_score':
      // Deixa explícito quantos leads sustentam a média — sem isso o card engana.
      if (d.count !== undefined && num(d.count) === 0) {
        val = <span class="text-fg-muted">—</span>
        sub = 'nenhum lead com score IA no período'
      } else {
        val = <>{num(d.value)}<em class="text-base text-fg-muted ml-1">/100</em></>
        sub = d.count !== undefined
          ? `média de ${num(d.count)} lead${num(d.count) === 1 ? '' : 's'} com score IA`
          : 'score médio geral'
      }
      break
    case 'leads_conversion':
      val = <>{num(d.value)}<em class="text-base text-fg-muted ml-1">%</em></>
      sub = `${num(d.count)} leads analisados`
      break
    case 'activities_summary':
      // config.highlight='overdue' → o card destaca as atrasadas (bloco "Atenção").
      if (config?.highlight === 'overdue') {
        val = <span class={num(d.overdue) > 0 ? 'text-danger' : undefined}>{num(d.overdue)}</span>
        sub = `${num(d.pending)} pendentes no total`
      } else {
        val = num(d.pending)
        sub = `${num(d.overdue)} atrasadas · ${num(d.completed)} concluídas`
      }
      break
    case 'tracking_visitors':
      val = num(d.total)
      sub = `${num(d.sessions)} sessões · ${num(d.pageviews)} pageviews`
      break
    case 'meta_leads':
      val = num(d.total)
      sub = `${num(d.processed)} processados · ${num(d.failed)} falhas`
      break
    case 'chatbots_summary': {
      val = num(d.total)
      const items = (d.data ?? []) as { label: string; value: number }[]
      sub = items.map((c) => `${c.label}: ${c.value}`).join(' · ')
      break
    }
    case 'pages_performance':
      val = num(d.total)
      sub = `${num(d.published)} publicadas · ${num(d.totalViews)} views · ${num(d.totalConversions)} conversões`
      break
    case 'forms_performance':
      val = num(d.total)
      sub = `${num(d.active)} ativos · ${num(d.totalSubmissions)} submissões`
      break
    case 'messages_volume':
      val = num(d.total)
      sub = `${num(d.sent)} enviadas · ${num(d.received)} recebidas`
      break
    case 'portals_total':
      val = num(d.active)
      sub = `${num(d.total)} no total${num(d.inactive) ? ` · ${num(d.inactive)} inativos` : ''}`
      break
    case 'registrations_total':
      val = num(d.value)
      sub = d.prev !== undefined ? <DeltaBadge curr={num(d.value)} prev={d.prev} /> : 'inscrições no período'
      break
    case 'registrations_paid':
      val = num(d.paid)
      sub = d.prev !== undefined
        ? <><DeltaBadge curr={num(d.paid)} prev={d.prev} /> · {num(d.total)} inscrições</>
        : `${num(d.total)} inscrições totais`
      break
    case 'registrations_revenue':
      val = brl.format(num(d.value))
      sub = d.prev !== undefined ? <DeltaBadge curr={num(d.value)} prev={d.prev} /> : 'receita total'
      break
    case 'registrations_conversion_rate':
      val = <>{num(d.value)}<em class="text-base text-fg-muted ml-1">%</em></>
      sub = `${num(d.paid)} de ${num(d.total)} pagas`
      break
    case 'negotiations_open':
    case 'negotiations_onetime_open':
      val = brl.format(num(d.value))
      sub = `${num(d.count)} negociaç${num(d.count) === 1 ? 'ão' : 'ões'} em aberto`
      break
    case 'negotiations_mrr_open':
      val = <>{brl.format(num(d.value))}<em class="text-base text-fg-muted ml-1">/mês</em></>
      sub = `${num(d.count)} negociaç${num(d.count) === 1 ? 'ão' : 'ões'} com mensalidade`
      break
    case 'negotiations_won_revenue':
    case 'negotiations_onetime_won':
      val = brl.format(num(d.value))
      sub = d.prev !== undefined ? <DeltaBadge curr={num(d.value)} prev={d.prev} /> : `${num(d.count)} negociações ganhas`
      break
    case 'negotiations_mrr_won':
      val = <>{brl.format(num(d.value))}<em class="text-base text-fg-muted ml-1">/mês</em></>
      sub = d.prev !== undefined ? <DeltaBadge curr={num(d.value)} prev={d.prev} /> : `${num(d.count)} contrato(s) com mensalidade`
      break
    case 'negotiations_avg_ticket':
    case 'negotiations_onetime_avg_ticket':
      val = brl.format(num(d.value))
      sub = num(d.count) > 0
        ? `média de ${num(d.count)} negociaç${num(d.count) === 1 ? 'ão ganha' : 'ões ganhas'}`
        : 'nenhuma negociação ganha no período'
      break
    case 'negotiations_mrr_avg_ticket':
      val = <>{brl.format(num(d.value))}<em class="text-base text-fg-muted ml-1">/mês</em></>
      sub = num(d.count) > 0
        ? `média de ${num(d.count)} contrato${num(d.count) === 1 ? '' : 's'} com mensalidade`
        : 'nenhuma mensalidade fechada no período'
      break
    case 'helpdesk_volume':
      val = num(d.created)
      sub = `${num(d.solved)} resolvidos · ${num(d.backlog)} em aberto`
      break
    case 'helpdesk_csat':
      val = <>{num(d.avg)}<em class="text-base text-fg-muted ml-1">/5</em></>
      sub = `${num(d.responded)} de ${num(d.sent)} respondidas`
      break
    default:
      val = num(d.value ?? d.total ?? 0)
  }

  // Nem todo card conta pela mesma data: ganhos, receita e perdidos contam pelo
  // clique no botão Ganho/Perdido, a taxa de conversão é coorte pela abertura da
  // negociação, e novos leads pela entrada. Sem dizer qual é qual, os números
  // parecem não fechar entre si.
  const basis = d.basis === 'created' ? 'por data de entrada do lead'
    : d.basis === 'outcome' ? 'por data do Ganho/Perdido'
    : d.basis === 'negotiation' ? 'por data de abertura da negociação'
    : null

  return (
    <div>
      <div class="text-3xl font-light text-fg tabular-nums leading-tight">{val}</div>
      <div class="text-xs text-fg-muted mt-1">{sub}</div>
      {basis && <div class="text-[10px] text-fg-subtle mt-0.5">{basis}</div>}
    </div>
  )
}

// ───────────────────────────────────────────────
// Stat Grid (cards numéricos com cor lateral)
// ───────────────────────────────────────────────

interface StatGridItem { label: string; value: number | string; color: string; suffix?: string }

function StatGridBody({ metric, data }: { metric: string; data: unknown }) {
  if (data === null || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  const num = (v: unknown) => Number(v ?? 0)
  const items: StatGridItem[] = (() => {
    switch (metric) {
      case 'leads_total': return [{ label: 'Total', value: num(d.value), color: '#1a73e8' }]
      case 'leads_new': return [
        { label: 'Hoje', value: num(d.today), color: '#34a853' },
        { label: 'Semana', value: num(d.week), color: '#1a73e8' },
      ]
      case 'leads_avg_score': return [{ label: 'Score', value: num(d.value), color: '#f9ab00', suffix: '/100' }]
      case 'activities_summary': return [
        { label: 'Pendentes', value: num(d.pending), color: '#f9ab00' },
        { label: 'Atrasadas', value: num(d.overdue), color: '#ea4335' },
        { label: 'Concluídas', value: num(d.completed), color: '#34a853' },
        { label: 'Total', value: num(d.total), color: '#1a73e8' },
      ]
      case 'tracking_visitors': return [
        { label: 'Visitantes', value: num(d.total), color: '#1a73e8' },
        { label: 'Sessões', value: num(d.sessions), color: '#9334e6' },
        { label: 'Pageviews', value: num(d.pageviews), color: '#34a853' },
      ]
      case 'messages_volume': return [
        { label: 'Total', value: num(d.total), color: '#1a73e8' },
        { label: 'Enviadas', value: num(d.sent), color: '#34a853' },
        { label: 'Recebidas', value: num(d.received), color: '#9334e6' },
      ]
      case 'meta_leads': return [
        { label: 'Recebidos', value: num(d.total), color: '#1a73e8' },
        { label: 'Processados', value: num(d.processed), color: '#34a853' },
        { label: 'Falhas', value: num(d.failed), color: '#ea4335' },
      ]
      case 'pages_performance': return [
        { label: 'Páginas', value: num(d.total), color: '#1a73e8' },
        { label: 'Publicadas', value: num(d.published), color: '#34a853' },
        { label: 'Views', value: num(d.totalViews), color: '#9334e6' },
        { label: 'Conversões', value: num(d.totalConversions), color: '#f9ab00' },
      ]
      case 'forms_performance': return [
        { label: 'Forms', value: num(d.total), color: '#1a73e8' },
        { label: 'Ativos', value: num(d.active), color: '#34a853' },
        { label: 'Submissões', value: num(d.totalSubmissions), color: '#9334e6' },
      ]
      case 'portals_total': return [
        { label: 'Ativos', value: num(d.active), color: '#34a853' },
        { label: 'Inativos', value: num(d.inactive), color: '#6b7280' },
        { label: 'Total', value: num(d.total), color: '#1a73e8' },
      ]
      case 'registrations_total': return [{ label: 'Inscrições', value: num(d.value), color: '#1a73e8' }]
      case 'registrations_paid': return [
        { label: 'Pagas', value: num(d.paid), color: '#34a853' },
        { label: 'Total', value: num(d.total), color: '#1a73e8' },
      ]
      case 'registrations_revenue': return [{ label: 'Receita', value: brl.format(num(d.value)), color: '#f9ab00' }]
      case 'registrations_conversion_rate': return [
        { label: 'Conversão', value: num(d.value), color: '#34a853', suffix: '%' },
        { label: 'Pagas', value: num(d.paid), color: '#1a73e8' },
        { label: 'Total', value: num(d.total), color: '#9334e6' },
      ]
      case 'helpdesk_volume': return [
        { label: 'Criados', value: num(d.created), color: '#1a73e8' },
        { label: 'Resolvidos', value: num(d.solved), color: '#34a853' },
        { label: 'Em aberto', value: num(d.backlog), color: '#f9ab00' },
        { label: 'Reaberturas', value: num(d.reopened), color: '#ea4335' },
      ]
      case 'helpdesk_sla': return [
        { label: '1ª resposta', value: num(d.frPct), color: '#34a853', suffix: '%' },
        { label: 'Resolução', value: num(d.resPct), color: '#1a73e8', suffix: '%' },
      ]
      case 'helpdesk_times': return [
        { label: 'TMA (1ª resp.)', value: fmtMins(d.avgFirstResponseMins), color: '#9334e6' },
        { label: 'TMR (resolução)', value: fmtMins(d.avgResolutionMins), color: '#1a73e8' },
      ]
      case 'helpdesk_csat': return [
        { label: 'Nota', value: num(d.avg), color: '#f9ab00', suffix: '/5' },
        { label: 'Respostas', value: num(d.responded), color: '#34a853' },
        { label: 'Enviadas', value: num(d.sent), color: '#1a73e8' },
      ]
      default: return [{ label: 'Valor', value: num(d.value ?? d.total ?? 0), color: '#1a73e8' }]
    }
  })()
  const cols = Math.min(items.length, 4)
  return (
    <div class="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {items.map((it, i) => (
        <div key={i} class="text-center px-2 py-2.5 rounded-lg bg-surface-2" style={{ borderLeft: `3px solid ${it.color}` }}>
          <div class="text-xl font-light text-fg tabular-nums">{it.value}{it.suffix ?? ''}</div>
          <div class="text-[10px] text-fg-subtle font-medium mt-0.5">{it.label}</div>
        </div>
      ))}
    </div>
  )
}

// ───────────────────────────────────────────────
// Bar (vertical) e HBar (horizontal)
// ───────────────────────────────────────────────

function BarChartBody({
  data, chartType, widget,
}: {
  data: unknown
  chartType: 'bar' | 'hbar'
  widget: Widget
}) {
  if (data === null || typeof data !== 'object') return null
  const d = data as { data?: DataPoint[] }
  const items = d.data ?? []
  if (items.length === 0) return <NoData />

  // messages_volume com sent/received: 2 séries
  if (widget.metric === 'messages_volume' && items[0]?.sent !== undefined) {
    return <BarStackedSentReceived items={items} chartType={chartType} />
  }

  const max = Math.max(...items.map((it) => Number(it.value ?? it.count ?? 0)), 1)

  if (chartType === 'hbar') {
    return (
      <ul class="flex flex-col gap-2">
        {items.map((it, i) => {
          const label = formatLabel(it.label ?? it.name ?? '')
          const value = Number(it.value ?? it.count ?? 0)
          const color = it.color ?? PALETTE[i % PALETTE.length]
          const pct = value > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0
          return (
            <li key={i} class="flex items-center gap-2">
              <span class="text-[11px] text-fg-muted w-24 truncate text-right" title={label}>{label}</span>
              <div class="flex-1 h-5 rounded bg-surface-3 overflow-hidden">
                <div
                  class="h-full rounded flex items-center justify-end pr-1.5 text-[10px] font-medium text-white"
                  style={{ width: `${pct}%`, background: color }}
                >
                  {value > 0 && pct >= 12 ? value : ''}
                </div>
              </div>
              <span class="text-[11px] text-fg tabular-nums w-8 text-right">{value}</span>
            </li>
          )
        })}
      </ul>
    )
  }

  // Vertical bars
  return (
    <div class="flex flex-col">
      <div class="flex items-end gap-1 h-32">
        {items.map((it, i) => {
          const value = Number(it.value ?? it.count ?? 0)
          const color = it.color ?? PALETTE[i % PALETTE.length]
          const pct = value > 0 ? Math.max(3, Math.round((value / max) * 100)) : 0
          const label = formatLabel(it.label ?? it.name ?? '')
          return (
            <div key={i} class="flex-1 flex flex-col items-center justify-end gap-1 group min-w-0">
              <span class="text-[9px] text-fg-subtle tabular-nums opacity-0 group-hover:opacity-100 transition-opacity">{value}</span>
              <div
                class="w-full rounded-t transition-all"
                style={{ height: `${pct}%`, minHeight: value > 0 ? '4px' : '0', background: color }}
                title={`${label}: ${value}`}
              />
            </div>
          )
        })}
      </div>
      <div class="flex gap-1 mt-1.5 text-[9px] text-fg-subtle">
        {items.map((it, i) => (
          <div key={i} class="flex-1 text-center truncate" title={it.label ?? ''}>
            {formatLabel(it.label ?? it.name ?? '', 8)}
          </div>
        ))}
      </div>
    </div>
  )
}

function BarStackedSentReceived({
  items, chartType,
}: {
  items: DataPoint[]
  chartType: 'bar' | 'hbar'
}) {
  const max = Math.max(...items.map((it) => Math.max(Number(it.sent ?? 0), Number(it.received ?? 0))), 1)
  if (chartType === 'hbar') {
    return (
      <ul class="flex flex-col gap-1.5">
        {items.map((it, i) => (
          <li key={i} class="flex items-center gap-2">
            <span class="text-[11px] text-fg-muted w-16 truncate text-right">{formatLabel(it.label ?? '')}</span>
            <div class="flex-1 grid gap-0.5">
              <div class="h-2 rounded bg-surface-3 overflow-hidden">
                <div class="h-full bg-[#1a73e8]" style={{ width: `${(Number(it.sent ?? 0) / max) * 100}%` }} />
              </div>
              <div class="h-2 rounded bg-surface-3 overflow-hidden">
                <div class="h-full bg-[#34a853]" style={{ width: `${(Number(it.received ?? 0) / max) * 100}%` }} />
              </div>
            </div>
          </li>
        ))}
      </ul>
    )
  }
  return (
    <div>
      <div class="flex items-end gap-1 h-32">
        {items.map((it, i) => {
          const sent = Number(it.sent ?? 0)
          const received = Number(it.received ?? 0)
          return (
            <div key={i} class="flex-1 flex items-end gap-px h-full" title={`${it.label}: ${sent} env. / ${received} rec.`}>
              <div class="flex-1 bg-[#1a73e8] rounded-t" style={{ height: `${(sent / max) * 100}%` }} />
              <div class="flex-1 bg-[#34a853] rounded-t" style={{ height: `${(received / max) * 100}%` }} />
            </div>
          )
        })}
      </div>
      <div class="flex gap-1 mt-1.5 text-[9px] text-fg-subtle">
        {items.map((it, i) => (
          <div key={i} class="flex-1 text-center truncate">{formatLabel(it.label ?? '', 6)}</div>
        ))}
      </div>
      <div class="flex justify-center gap-3 mt-2 text-[10px] text-fg-muted">
        <span class="inline-flex items-center gap-1"><span class="size-2 rounded-full bg-[#1a73e8]" /> Enviadas</span>
        <span class="inline-flex items-center gap-1"><span class="size-2 rounded-full bg-[#34a853]" /> Recebidas</span>
      </div>
    </div>
  )
}

// ───────────────────────────────────────────────
// Line / Area (SVG)
// ───────────────────────────────────────────────

function LineAreaBody({
  data, chartType, widget,
}: {
  data: unknown
  chartType: 'line' | 'area'
  widget: Widget
}) {
  if (data === null || typeof data !== 'object') return null
  const d = data as { data?: DataPoint[] }
  const items = d.data ?? []
  if (items.length === 0) return <NoData />

  // helpdesk_trend: 2 séries (criados + resolvidos)
  if (widget.metric === 'helpdesk_trend' && (items[0] as any)?.created !== undefined) {
    const all = items.flatMap((it) => [Number((it as any).created ?? 0), Number((it as any).solved ?? 0)])
    const max = Math.max(...all, 1)
    return (
      <div>
        <Sparkline2 items={items.map((it) => ({
          label: it.label ?? '',
          a: Number((it as any).created ?? 0),
          b: Number((it as any).solved ?? 0),
        }))} max={max} chartType={chartType} colorA="#1a73e8" colorB="#34a853" />
        <div class="flex justify-center gap-3 mt-2 text-[10px] text-fg-muted">
          <span class="inline-flex items-center gap-1"><span class="size-2 rounded-full bg-[#1a73e8]" /> Criados</span>
          <span class="inline-flex items-center gap-1"><span class="size-2 rounded-full bg-[#34a853]" /> Resolvidos</span>
        </div>
      </div>
    )
  }

  // messages_volume: 2 séries (sent + received)
  if (widget.metric === 'messages_volume' && items[0]?.sent !== undefined) {
    const all = items.flatMap((it) => [Number(it.sent ?? 0), Number(it.received ?? 0)])
    const max = Math.max(...all, 1)
    return (
      <div>
        <Sparkline2 items={items.map((it) => ({
          label: it.label ?? '',
          a: Number(it.sent ?? 0),
          b: Number(it.received ?? 0),
        }))} max={max} chartType={chartType} colorA="#1a73e8" colorB="#34a853" />
        <div class="flex justify-center gap-3 mt-2 text-[10px] text-fg-muted">
          <span class="inline-flex items-center gap-1"><span class="size-2 rounded-full bg-[#1a73e8]" /> Enviadas</span>
          <span class="inline-flex items-center gap-1"><span class="size-2 rounded-full bg-[#34a853]" /> Recebidas</span>
        </div>
      </div>
    )
  }

  const values = items.map((it) => Number(it.value ?? 0))
  const max = Math.max(...values, 1)
  return <Sparkline values={values} labels={items.map((it) => it.label ?? '')} max={max} chartType={chartType} />
}

function Sparkline({
  values, labels, max, chartType,
}: {
  values: number[]
  labels: string[]
  max: number
  chartType: 'line' | 'area'
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  if (values.length === 0) return <NoData />

  // Layout (mesmo padrão do TrendChart de Meta Ads — eixos com labels, hover crosshair, tooltip HTML)
  const W = 800, H = 180, padL = 56, padR = 16, padT = 14, padB = 28
  const innerW = W - padL - padR
  const innerH = H - padT - padB
  const xStep = values.length > 1 ? innerW / (values.length - 1) : 0
  const yMax = Math.max(max, 1)
  const yOf = (v: number) => padT + innerH - (v / yMax) * innerH

  const path = values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${padL + i * xStep} ${yOf(v)}`).join(' ')
  const area = values.length > 0
    ? `${path} L ${padL + (values.length - 1) * xStep} ${padT + innerH} L ${padL} ${padT + innerH} Z`
    : ''

  // 5 ticks no eixo Y
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({ y: padT + innerH - t * innerH, val: t * yMax }))
  // Até 8 labels equidistantes no eixo X
  const xLabelEvery = Math.max(1, Math.ceil(values.length / 8))

  function handleMove(e: MouseEvent) {
    const svg = svgRef.current
    if (!svg || values.length === 0) return
    const rect = svg.getBoundingClientRect()
    const scaleX = rect.width / W
    const xInView = (e.clientX - rect.left) / scaleX
    if (xStep === 0) { setHoverIdx(0); return }
    const i = Math.round((xInView - padL) / xStep)
    setHoverIdx(Math.max(0, Math.min(values.length - 1, i)))
  }
  function handleLeave() { setHoverIdx(null) }

  const hoveredVal = hoverIdx !== null ? values[hoverIdx] : null
  const hoverX = hoverIdx !== null ? padL + hoverIdx * xStep : 0
  const hoverY = hoveredVal !== null && hoveredVal !== undefined ? yOf(hoveredVal) : 0

  return (
    <div ref={containerRef} class="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        class="w-full h-auto"
        style={{ minWidth: '500px' }}
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
      >
        {/* Grid horizontal + labels Y */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} y1={t.y} x2={W - padR} y2={t.y} stroke="currentColor" stroke-opacity="0.1" />
            <text x={padL - 6} y={t.y + 3} text-anchor="end" font-size="9" fill="currentColor" fill-opacity="0.6">
              {Math.round(t.val).toLocaleString('pt-BR')}
            </text>
          </g>
        ))}
        {/* Eixo X labels */}
        {labels.map((l, i) => i % xLabelEvery === 0 && (
          <text
            key={i}
            x={padL + i * xStep}
            y={H - padB + 14}
            text-anchor="middle"
            font-size="9"
            fill="currentColor"
            fill-opacity="0.6"
          >
            {formatLabel(l, 8)}
          </text>
        ))}
        {/* Área + linha */}
        {chartType === 'area' && area && <path d={area} fill="#1a73e8" fill-opacity="0.12" />}
        {path && <path d={path} fill="none" stroke="#1a73e8" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />}
        {/* Crosshair vertical no hover */}
        {hoveredVal !== null && (
          <line
            x1={hoverX} x2={hoverX}
            y1={padT} y2={padT + innerH}
            stroke="#1a73e8"
            stroke-opacity="0.35"
            stroke-width="1"
            stroke-dasharray="3 3"
            style={{ pointerEvents: 'none' }}
          />
        )}
        {/* Pontos */}
        {values.map((v, i) => {
          const isHover = hoverIdx === i
          return (
            <circle
              key={i}
              cx={padL + i * xStep}
              cy={yOf(v)}
              r={isHover ? 4.5 : (v === 0 ? 1.5 : 2.5)}
              fill="#1a73e8"
              style={{ pointerEvents: 'none', transition: 'r 120ms ease' }}
            />
          )
        })}
        {/* Anel externo no ponto hovered */}
        {hoveredVal !== null && (
          <circle
            cx={hoverX} cy={hoverY} r="8"
            fill="none"
            stroke="#1a73e8"
            stroke-width="1.5"
            stroke-opacity="0.45"
            style={{ pointerEvents: 'none' }}
          />
        )}
      </svg>
      {hoverIdx !== null && hoveredVal !== null && hoveredVal !== undefined && (
        <SparkTooltip
          label={labels[hoverIdx] ?? ''}
          value={hoveredVal}
          anchorXPct={hoverX / W}
          container={containerRef.current}
        />
      )}
    </div>
  )
}

function SparkTooltip({
  label, value, anchorXPct, container,
}: {
  label: string
  value: number
  anchorXPct: number
  container: HTMLDivElement | null
}) {
  // Se for data YYYY-MM-DD, mostra com dia da semana
  let dateLabel = label
  if (/^\d{4}-\d{2}-\d{2}$/.test(label)) {
    const dt = new Date(label + 'T12:00:00')
    dateLabel = dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', weekday: 'short' })
  }
  const cw = container?.clientWidth ?? 800
  const px = anchorXPct * cw
  const flip = px > cw - 180
  const left = flip ? Math.max(8, px - 180) : Math.min(cw - 180, px + 16)
  return (
    <div
      class="pointer-events-none absolute z-30 top-3 rounded-md border border-border bg-surface shadow-lg p-2.5 text-[11px] w-[160px]"
      style={{ left: `${left}px` }}
    >
      <div class="text-fg-muted text-[10px] uppercase tracking-wide mb-1">{dateLabel}</div>
      <div class="flex items-center justify-between gap-2">
        <span class="flex items-center gap-1.5">
          <span class="size-1.5 rounded-full shrink-0" style={{ background: '#1a73e8' }} />
          <span class="text-fg">Total</span>
        </span>
        <span class="tabular-nums text-fg font-semibold">{value.toLocaleString('pt-BR')}</span>
      </div>
    </div>
  )
}

function Sparkline2({
  items, max, chartType, colorA, colorB,
}: {
  items: { label: string; a: number; b: number }[]
  max: number
  chartType: 'line' | 'area'
  colorA: string
  colorB: string
}) {
  if (items.length === 0) return <NoData />
  const W = 600
  const H = 140
  const PAD = 18
  const xStep = items.length > 1 ? (W - PAD * 2) / (items.length - 1) : 0
  function buildPath(getter: (it: typeof items[number]) => number) {
    return items.map((it, i) => {
      const x = PAD + i * xStep
      const y = H - PAD - (getter(it) / max) * (H - PAD * 2)
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
    }).join(' ')
  }
  const pathA = buildPath((it) => it.a)
  const pathB = buildPath((it) => it.b)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} class="w-full h-32" preserveAspectRatio="none">
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1={PAD} x2={W - PAD} y1={PAD + f * (H - PAD * 2)} y2={PAD + f * (H - PAD * 2)} stroke="var(--color-border)" stroke-width="0.5" stroke-dasharray="2 3" />
      ))}
      {chartType === 'area' && (
        <>
          <path d={`${pathA} L ${W - PAD} ${H - PAD} L ${PAD} ${H - PAD} Z`} fill={colorA} fill-opacity="0.15" />
          <path d={`${pathB} L ${W - PAD} ${H - PAD} L ${PAD} ${H - PAD} Z`} fill={colorB} fill-opacity="0.15" />
        </>
      )}
      <path d={pathA} fill="none" stroke={colorA} stroke-width="2" stroke-linejoin="round" />
      <path d={pathB} fill="none" stroke={colorB} stroke-width="2" stroke-linejoin="round" />
    </svg>
  )
}

// ───────────────────────────────────────────────
// Pie / Donut / Polar (SVG arc paths)
// ───────────────────────────────────────────────

function PieChartBody({
  data, chartType, widget,
}: {
  data: unknown
  chartType: 'pie' | 'donut' | 'polar'
  widget: Widget
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ index: number; x: number; y: number } | null>(null)
  const [, navigate] = useLocation()

  if (data === null || typeof data !== 'object') return null
  const d = data as { data?: DataPoint[] }
  const items = d.data ?? []
  if (items.length === 0) return <NoData />

  const values = items.map((it) => Number(it.value ?? it.count ?? 0))
  const total = values.reduce((a, b) => a + b, 0)
  if (total === 0) return <NoData />

  const colors = items.map((it, i) => it.color ?? PALETTE[i % PALETTE.length] ?? '#1a73e8')
  const cx = 100, cy = 100, R = 80
  const rInner = chartType === 'donut' ? 44 : 0

  const isClickable = widget.metric === 'leads_by_source'
  const handleSliceClick = (i: number) => {
    if (!isClickable) return
    const key = items[i]?.key
    if (!key) return
    navigate(`/leads?source=${encodeURIComponent(String(key))}`)
  }

  const onSliceMove = (i: number) => (e: MouseEvent) => {
    const c = containerRef.current
    if (!c) return
    const rect = c.getBoundingClientRect()
    setHover({ index: i, x: e.clientX - rect.left, y: e.clientY - rect.top })
  }
  const onSliceLeave = () => setHover(null)
  const onLegendEnter = (i: number) => setHover({ index: i, x: -9999, y: -9999 })
  const onLegendLeave = () => setHover(null)

  const activeIndex = hover?.index ?? null
  // Tooltip flutuante fica só em pie/polar; donut usa o centro como display.
  const showFloatingTooltip = chartType !== 'donut' && hover && hover.x >= 0 && hover.y >= 0
  const tooltip = showFloatingTooltip ? renderSliceTooltip({
    item: items[hover.index],
    value: values[hover.index] ?? 0,
    total,
    color: colors[hover.index] ?? '#1a73e8',
    x: hover.x,
    y: hover.y,
  }) : null

  // Cálculo de "lift" (deslocamento radial) para a fatia em hover — só em pie/donut.
  const lift = (i: number, startFrac: number, endFrac: number) => {
    if (activeIndex !== i) return ''
    const midAngle = ((startFrac + endFrac) / 2) * Math.PI * 2 - Math.PI / 2
    const dx = 6 * Math.cos(midAngle)
    const dy = 6 * Math.sin(midAngle)
    return `translate(${dx} ${dy})`
  }

  const legendNode = (
    <PieLegend
      items={items}
      colors={colors}
      total={total}
      activeIndex={activeIndex}
      clickable={isClickable}
      onItemEnter={onLegendEnter}
      onItemLeave={onLegendLeave}
      onItemClick={handleSliceClick}
    />
  )

  if (chartType === 'polar') {
    const max = Math.max(...values, 1)
    const sliceAngle = (Math.PI * 2) / values.length
    return (
      <div ref={containerRef} class="relative flex items-center justify-center">
        <svg viewBox="0 0 200 200" class="w-full max-w-[200px] overflow-visible">
          {[0.25, 0.5, 0.75, 1].map((f) => (
            <circle key={f} cx={cx} cy={cy} r={R * f} fill="none" stroke="var(--color-border)" stroke-width="0.5" />
          ))}
          {values.map((v, i) => {
            const r = (v / max) * R
            const startAngle = sliceAngle * i - Math.PI / 2
            const endAngle = startAngle + sliceAngle
            const x1 = cx + r * Math.cos(startAngle)
            const y1 = cy + r * Math.sin(startAngle)
            const x2 = cx + r * Math.cos(endAngle)
            const y2 = cy + r * Math.sin(endAngle)
            const largeArc = sliceAngle > Math.PI ? 1 : 0
            const isHover = activeIndex === i
            const isDimmed = activeIndex !== null && activeIndex !== i
            return (
              <path
                key={i}
                d={`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`}
                fill={colors[i]}
                fill-opacity={isHover ? 1 : isDimmed ? 0.3 : 0.8}
                stroke={colors[i]}
                stroke-width={isHover ? 2 : 1}
                style={{ cursor: isClickable ? 'pointer' : 'default', transition: 'fill-opacity 140ms ease' }}
                onMouseEnter={onSliceMove(i)}
                onMouseMove={onSliceMove(i)}
                onMouseLeave={onSliceLeave}
                onClick={() => handleSliceClick(i)}
              />
            )
          })}
        </svg>
        {legendNode}
        {tooltip}
      </div>
    )
  }

  // pie / donut
  let acc = 0
  const sliceFracs: { start: number; end: number }[] = []
  for (const v of values) {
    const start = acc / total
    acc += v
    sliceFracs.push({ start, end: acc / total })
  }

  // Texto central (donut): idle = total; hover = label + valor + %
  let centerLabel = ''
  let centerValue = ''
  let centerPct = ''
  if (chartType === 'donut') {
    if (activeIndex !== null && items[activeIndex]) {
      const v = values[activeIndex] ?? 0
      const pct = total > 0 ? (v / total) * 100 : 0
      centerLabel = items[activeIndex].label ?? '—'
      centerValue = v.toLocaleString('pt-BR')
      centerPct = pct >= 10 ? `${pct.toFixed(0)}%` : `${pct.toFixed(1)}%`
    } else {
      centerLabel = 'Total'
      centerValue = total.toLocaleString('pt-BR')
      centerPct = total === 1 ? 'lead' : 'leads'
    }
  }

  return (
    <div ref={containerRef} class="relative flex items-center gap-3">
      <svg viewBox="0 0 200 200" class="w-full max-w-[160px] shrink-0 overflow-visible">
        {sliceFracs.map(({ start: startFrac, end: endFrac }, i) => {
          const startAngle = startFrac * Math.PI * 2 - Math.PI / 2
          const endAngle = endFrac * Math.PI * 2 - Math.PI / 2
          const x1 = cx + R * Math.cos(startAngle)
          const y1 = cy + R * Math.sin(startAngle)
          const x2 = cx + R * Math.cos(endAngle)
          const y2 = cy + R * Math.sin(endAngle)
          const largeArc = endFrac - startFrac > 0.5 ? 1 : 0
          const isHover = activeIndex === i
          const isDimmed = activeIndex !== null && activeIndex !== i
          const sliceProps = {
            fill: colors[i],
            'fill-opacity': isHover ? 1 : isDimmed ? 0.35 : 0.85,
            stroke: isHover ? colors[i] : 'transparent',
            'stroke-width': isHover ? 2 : 0,
            transform: lift(i, startFrac, endFrac),
            style: {
              cursor: isClickable ? 'pointer' : 'default',
              transition: 'fill-opacity 140ms ease, transform 140ms ease',
            },
            onMouseEnter: onSliceMove(i),
            onMouseMove: onSliceMove(i),
            onMouseLeave: onSliceLeave,
            onClick: () => handleSliceClick(i),
          }
          if (rInner > 0) {
            const ix1 = cx + rInner * Math.cos(endAngle)
            const iy1 = cy + rInner * Math.sin(endAngle)
            const ix2 = cx + rInner * Math.cos(startAngle)
            const iy2 = cy + rInner * Math.sin(startAngle)
            const dPath = [
              `M ${x1} ${y1}`,
              `A ${R} ${R} 0 ${largeArc} 1 ${x2} ${y2}`,
              `L ${ix1} ${iy1}`,
              `A ${rInner} ${rInner} 0 ${largeArc} 0 ${ix2} ${iy2}`,
              'Z',
            ].join(' ')
            return <path key={i} d={dPath} {...sliceProps} />
          }
          const dPath = `M ${cx} ${cy} L ${x1} ${y1} A ${R} ${R} 0 ${largeArc} 1 ${x2} ${y2} Z`
          return <path key={i} d={dPath} {...sliceProps} />
        })}
        {chartType === 'donut' && (
          <g style={{ pointerEvents: 'none' }}>
            <text
              x={cx} y={cy - 10} text-anchor="middle"
              style={{ fill: 'var(--color-fg-muted)', fontSize: '9px', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em' }}
            >
              {truncateMiddle(centerLabel, 14)}
            </text>
            <text
              x={cx} y={cy + 6} text-anchor="middle"
              style={{ fill: 'var(--color-fg)', fontSize: '18px', fontWeight: 600 }}
              class="tabular-nums"
            >
              {centerValue}
            </text>
            <text
              x={cx} y={cy + 20} text-anchor="middle"
              style={{ fill: 'var(--color-fg-subtle)', fontSize: '10px' }}
              class="tabular-nums"
            >
              {centerPct}
            </text>
          </g>
        )}
      </svg>
      {legendNode}
      {tooltip}
    </div>
  )
}

function truncateMiddle(s: string, max: number): string {
  if (s.length <= max) return s
  const half = Math.floor((max - 1) / 2)
  return s.slice(0, half) + '…' + s.slice(s.length - (max - half - 1))
}

function renderSliceTooltip({
  item, value, total, color, x, y,
}: {
  item: DataPoint | undefined
  value: number
  total: number
  color: string
  x: number
  y: number
}) {
  if (!item) return null
  const pct = total > 0 ? (value / total) * 100 : 0
  const pctStr = pct >= 10 ? pct.toFixed(0) : pct.toFixed(1)
  const valueStr = value.toLocaleString('pt-BR')
  return (
    <div
      class="pointer-events-none absolute z-50 rounded-md border border-border bg-surface shadow-lg px-2.5 py-1.5 text-[11px] whitespace-nowrap"
      style={{ left: `${x + 12}px`, top: `${y + 12}px` }}
    >
      <div class="flex items-center gap-2 mb-0.5">
        <span class="size-2 rounded-sm shrink-0" style={{ background: color }} />
        <span class="font-medium text-fg">{item.label ?? '—'}</span>
      </div>
      <div class="flex items-center gap-3 text-fg-muted">
        <span class="tabular-nums">{valueStr} {value === 1 ? 'lead' : 'leads'}</span>
        <span class="tabular-nums">{pctStr}%</span>
      </div>
    </div>
  )
}

function PieLegend({
  items, colors, total, activeIndex, clickable, onItemEnter, onItemLeave, onItemClick,
}: {
  items: DataPoint[]
  colors: string[]
  total: number
  activeIndex: number | null
  clickable: boolean
  onItemEnter: (i: number) => void
  onItemLeave: () => void
  onItemClick: (i: number) => void
}) {
  return (
    <ul class="flex-1 min-w-0 flex flex-col gap-0.5 text-[11px]">
      {items.slice(0, 8).map((it, i) => {
        const v = Number(it.value ?? it.count ?? 0)
        const pct = total > 0 ? Math.round((v / total) * 100) : 0
        const isActive = activeIndex === i
        const isDimmed = activeIndex !== null && activeIndex !== i
        const cls = [
          'flex items-center gap-2 rounded px-1 py-0.5 -mx-1 transition-colors',
          isDimmed ? 'opacity-40' : '',
          isActive ? 'bg-surface-3/60' : '',
          clickable ? 'cursor-pointer hover:bg-surface-3/60' : '',
        ].filter(Boolean).join(' ')
        return (
          <li
            key={i}
            class={cls}
            onMouseEnter={() => onItemEnter(i)}
            onMouseLeave={onItemLeave}
            onClick={() => onItemClick(i)}
          >
            <span class="size-2.5 rounded-sm shrink-0" style={{ background: colors[i] }} />
            <span class="text-fg-muted truncate flex-1" title={it.label ?? ''}>{it.label ?? '—'}</span>
            <span class={`tabular-nums ${isActive ? 'text-fg font-medium' : 'text-fg'}`}>{v}</span>
            <span class="text-fg-subtle tabular-nums w-9 text-right">{pct}%</span>
          </li>
        )
      })}
    </ul>
  )
}

// ───────────────────────────────────────────────
// Funil — com select inline para leads_by_funnel
// ───────────────────────────────────────────────

function FunnelBody({
  widget, data, dashboardId, allWidgets,
}: {
  widget: Widget
  data: unknown
  dashboardId?: number | undefined
  allWidgets?: Widget[] | undefined
}) {
  if (data === null || typeof data !== 'object') return null
  const d = data as { data?: unknown }

  if (widget.metric === 'leads_by_funnel') {
    return <FunnelByFunnelBody widget={widget} data={d} dashboardId={dashboardId} allWidgets={allWidgets} />
  }

  // Standard funnel (leads_by_status)
  const items = (d.data ?? []) as DataPoint[]
  if (items.length === 0) return <NoData />
  const max = Math.max(...items.map((it) => Number(it.value ?? it.count ?? 0)), 1)
  return (
    <div class="flex flex-col gap-1.5">
      {items.map((it, i) => {
        const value = Number(it.value ?? it.count ?? 0)
        const color = it.color ?? PALETTE[i % PALETTE.length]
        const pct = value > 0 ? Math.max(3, Math.round((value / max) * 100)) : 0
        return (
          <div key={i} class="flex items-center gap-2 text-xs">
            <span class="text-fg-muted w-24 truncate text-right" title={it.label ?? ''}>{it.label ?? '—'}</span>
            <div class="flex-1 h-7 rounded bg-surface-3 overflow-hidden">
              <div
                class="h-full flex items-center px-2 text-[11px] font-medium text-white"
                style={{ width: `${pct}%`, background: color }}
              >
                {value > 0 && pct >= 12 ? value : ''}
              </div>
            </div>
            <span class="text-fg tabular-nums w-10 text-right">{value}</span>
          </div>
        )
      })}
    </div>
  )
}

interface FunnelByFunnelItem {
  label: string
  value: number
  isDefault?: boolean
  stages?: { name: string; count: number; color: string }[]
}

function FunnelByFunnelBody({
  widget, data, dashboardId, allWidgets,
}: {
  widget: Widget
  data: { data?: unknown }
  dashboardId?: number | undefined
  allWidgets?: Widget[] | undefined
}) {
  const items = (data.data ?? []) as FunnelByFunnelItem[]
  const { data: funnelsData } = useFunnels()
  const update = useUpdateDashboard()
  const funnels = funnelsData?.funnels ?? []
  const currentFid = (widget.config?.funnelId as number | undefined) ?? ''

  function handleChange(value: string) {
    if (!dashboardId || !allWidgets) return
    const nextWidgets = allWidgets.map((w) => {
      if (w.id !== widget.id) return w
      const config = { ...(w.config ?? {}) }
      if (value) config.funnelId = Number(value)
      else delete config.funnelId
      return { ...w, config }
    })
    update.mutate({ id: dashboardId, widgets: nextWidgets })
  }

  return (
    <>
      <div class="flex items-center gap-2 mb-3">
        <select
          class="h-7 px-2 rounded border border-border bg-surface text-xs text-fg cursor-pointer focus:outline-none focus:border-accent"
          value={String(currentFid)}
          onChange={(e) => handleChange((e.target as HTMLSelectElement).value)}
        >
          <option value="">Todos os funis</option>
          {funnels.filter((f) => f.active !== false).map((f) => (
            <option key={f.id} value={f.id}>{f.name}{f.isDefault ? ' (padrão)' : ''}</option>
          ))}
        </select>
        <span class="text-[10px] text-fg-subtle">{items.length} funil(is)</span>
      </div>
      {items.length === 0 && <NoData />}
      <div class="flex flex-col gap-3">
        {items.map((f, idx) => {
          const totalF = (f.stages ?? []).reduce((a, s) => a + s.count, 0)
          return (
            <div key={idx} class="rounded-lg bg-surface-2 p-3">
              <div class="text-[13px] font-medium text-fg mb-2">
                {f.label}
                {f.isDefault && <span class="ml-1.5 inline-block px-1.5 py-0.5 rounded bg-accent/15 text-accent text-[10px] font-medium">Padrão</span>}
                <span class="ml-2 text-fg-muted text-xs font-normal">· {totalF} leads</span>
              </div>
              {totalF > 0 && (
                <div class="flex h-2 rounded overflow-hidden mb-2 bg-surface-3">
                  {(f.stages ?? []).map((s, i) => (
                    s.count > 0
                      ? <div key={i} style={{ background: s.color, width: `${(s.count / totalF) * 100}%` }} title={`${s.name}: ${s.count}`} />
                      : null
                  ))}
                </div>
              )}
              <div class="flex flex-wrap gap-1.5">
                {(f.stages ?? []).map((s, i) => (
                  <span key={i} class="inline-flex items-center gap-1 text-[11px] text-fg-muted">
                    <span class="size-2 rounded-full" style={{ background: s.color }} />
                    {s.name}: <strong class="text-fg">{s.count}</strong>
                  </span>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

// ───────────────────────────────────────────────
// Radar / Gauge / Progress / HBarList (mantidos, ajustados levemente)
// ───────────────────────────────────────────────

function RadarBody({ data }: { data: unknown }) {
  if (data === null || typeof data !== 'object') return null
  const d = data as { data?: DataPoint[] }
  const items = (d.data ?? []).slice(0, 8)
  if (items.length === 0) return <NoData />

  const cx = 100, cy = 100, radius = 80
  const N = items.length
  const angle = (i: number) => (Math.PI * 2 * i) / N - Math.PI / 2
  const point = (val: number, i: number) => {
    const r = (Math.max(0, Math.min(100, val)) / 100) * radius
    return [cx + r * Math.cos(angle(i)), cy + r * Math.sin(angle(i))] as const
  }
  const ringPath = (frac: number) => {
    const r = radius * frac
    return Array.from({ length: N }, (_, i) => {
      const x = cx + r * Math.cos(angle(i))
      const y = cy + r * Math.sin(angle(i))
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
    }).join(' ') + ' Z'
  }
  const dataPath = items.map((it, i) => {
    const [x, y] = point(Number(it.value ?? 0), i)
    return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
  }).join(' ') + ' Z'

  return (
    <svg viewBox="0 0 200 200" class="w-full max-w-[260px] mx-auto block">
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <path key={f} d={ringPath(f)} fill="none" stroke="var(--color-border)" stroke-width="0.7" />
      ))}
      {Array.from({ length: N }, (_, i) => {
        const x = cx + radius * Math.cos(angle(i))
        const y = cy + radius * Math.sin(angle(i))
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--color-border)" stroke-width="0.7" />
      })}
      <path d={dataPath} fill="rgba(26,115,232,0.18)" stroke="#1a73e8" stroke-width="2" />
      {items.map((it, i) => {
        const [x, y] = point(Number(it.value ?? 0), i)
        return <circle key={i} cx={x} cy={y} r="3" fill="#1a73e8" stroke="var(--color-surface)" stroke-width="1.5" />
      })}
      {items.map((it, i) => {
        const [x, y] = point(110, i)
        return (
          <text
            key={`l-${i}`}
            x={x}
            y={y}
            text-anchor="middle"
            dominant-baseline="middle"
            class="fill-fg-muted"
            style={{ fontSize: '9px' }}
          >
            {pillarLabel(it.label ?? it.name ?? '—')}
          </text>
        )
      })}
    </svg>
  )
}

function GaugeBody({ metric, data }: { metric: string; data: unknown }) {
  if (data === null || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  let value = 0, maxVal = 100, label = ''
  switch (metric) {
    case 'leads_avg_score': value = Number(d.value ?? 0); label = '/100'; break
    case 'leads_conversion': value = Number(d.value ?? 0); label = '%'; break
    case 'leads_total': value = Number(d.value ?? 0); maxVal = Math.max(value * 1.5, 100); label = 'leads'; break
    case 'registrations_conversion_rate': value = Number(d.value ?? 0); label = '% conversão'; break
    case 'helpdesk_sla': value = Number(d.resPct ?? d.value ?? 0); maxVal = 100; label = '% SLA resolução'; break
    default: value = Number(d.value ?? d.total ?? 0); maxVal = Math.max(value * 1.5, 100)
  }
  const pct = Math.min((value / maxVal) * 100, 100)
  const color = pct >= 65 ? '#34a853' : pct >= 40 ? '#f9ab00' : '#ea4335'
  const C = Math.PI * 80
  const offset = C * (1 - pct / 100)
  return (
    <div class="flex items-center justify-center py-2">
      <svg viewBox="0 0 200 120" class="w-full max-w-[240px]">
        <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="var(--color-surface-3)" stroke-width="14" stroke-linecap="round" />
        <path
          d="M 20 100 A 80 80 0 0 1 180 100"
          fill="none"
          stroke={color}
          stroke-width="14"
          stroke-linecap="round"
          stroke-dasharray={C}
          stroke-dashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
        <text x="100" y="92" text-anchor="middle" class="fill-fg" style={{ fontSize: '28px', fontWeight: 500 }}>
          {value}
        </text>
        <text x="100" y="110" text-anchor="middle" class="fill-fg-subtle" style={{ fontSize: '11px' }}>
          {label}
        </text>
      </svg>
    </div>
  )
}

function HBarListBody({ data }: { data: unknown }) {
  if (data === null || typeof data !== 'object') return null
  const d = data as { data?: DataPoint[] }
  const items = d.data ?? []
  if (items.length === 0) return <NoData />
  const max = Math.max(...items.map((i) => Number(i.value ?? i.count ?? 0)), 1)
  return (
    <ul class="flex flex-col gap-2">
      {items.slice(0, 10).map((it, i) => {
        const label = it.label ?? it.name ?? '—'
        const value = Number(it.value ?? it.count ?? 0)
        const color = it.color ?? PALETTE[i % PALETTE.length]
        const pct = Math.max(value > 0 ? 2 : 0, Math.round((value / max) * 100))
        return (
          <li key={i}>
            <div class="flex items-center justify-between text-xs mb-1">
              <span class="inline-flex items-center gap-1.5 truncate">
                <span class="size-2 rounded-full shrink-0" style={{ background: color }} />
                <span class="text-fg-muted truncate" title={label}>{label}</span>
              </span>
              <strong class="text-fg tabular-nums">{value}</strong>
            </div>
            <div class="h-1.5 rounded-full bg-surface-3 overflow-hidden">
              <div class="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function ProgressBody({ data }: { data: unknown }) {
  if (data === null || typeof data !== 'object') return null
  const d = data as { data?: DataPoint[] }
  const items = d.data ?? []
  if (items.length === 0) return <NoData />
  return (
    <div class="flex flex-col gap-2.5">
      {items.map((it, i) => {
        const v = Number(it.value ?? 0)
        const color = v >= 65 ? '#34a853' : v >= 45 ? '#f9ab00' : '#ea4335'
        return (
          <div key={i}>
            <div class="flex items-center justify-between text-xs mb-1">
              <span class="text-fg-muted">{pillarLabel(it.label ?? it.name ?? '—')}</span>
              <strong class="tabular-nums" style={{ color }}>{v}</strong>
            </div>
            <div class="h-2 rounded-full bg-surface-3 overflow-hidden">
              <div class="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, v))}%`, background: color }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ───────────────────────────────────────────────
// Tabela
// ───────────────────────────────────────────────

interface TableItem { id?: number | string; [k: string]: unknown }

// Tabela especializada de Leads (com filtros status/segmento, export CSV e modal in-place)
function LeadsRecentTable({ items }: { items: TableItem[] }) {
  const [statusFilter, setStatusFilter] = useState('')
  const [segmentFilter, setSegmentFilter] = useState('')
  const [openLeadId, setOpenLeadId] = useState<number | null>(null)

  const statusOptions = useMemo(() => {
    const seen = new Set<string>()
    items.forEach((l) => { const s = (l.status as string | undefined); if (s) seen.add(s) })
    return Array.from(seen).sort()
  }, [items])

  const segmentOptions = useMemo(() => {
    const seen = new Set<string>()
    items.forEach((l) => { const s = (l.segmento as string | undefined); if (s) seen.add(s) })
    return Array.from(seen).sort()
  }, [items])

  const filtered = useMemo(() => {
    return items.filter((l) => {
      if (statusFilter && l.status !== statusFilter) return false
      if (segmentFilter && l.segmento !== segmentFilter) return false
      return true
    })
  }, [items, statusFilter, segmentFilter])

  function exportCsv() {
    const rows: string[][] = [[
      'Empresa', 'Nome', 'WhatsApp', 'Email', 'Segmento', 'Cidade',
      'Score', 'Status', 'Origem', 'Data',
    ]]
    const str = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? String(v) : '')
    filtered.forEach((l) => {
      const sc = (l.scores as { geral?: number } | undefined)?.geral ?? 0
      rows.push([
        str(l.empresa), str(l.nome), str(l.whatsapp), str(l.email),
        str(l.segmento), str(l.cidade), String(sc),
        str(l.status), leadSourceLabel(l.source as string | null | undefined),
        l.createdAt ? new Date(l.createdAt as string).toLocaleDateString('pt-BR') : '',
      ])
    })
    const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `leads_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <div class="flex items-center gap-2 flex-wrap mb-2 text-xs">
        <FilterIcon size={12} class="text-fg-subtle" />
        <select
          class="h-7 px-2 rounded-md bg-surface border border-border text-fg cursor-pointer focus:outline-none focus:border-accent"
          value={statusFilter}
          onChange={(e) => setStatusFilter((e.target as HTMLSelectElement).value)}
          aria-label="Filtrar por etapa"
        >
          <option value="">Todas as etapas</option>
          {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          class="h-7 px-2 rounded-md bg-surface border border-border text-fg cursor-pointer focus:outline-none focus:border-accent"
          value={segmentFilter}
          onChange={(e) => setSegmentFilter((e.target as HTMLSelectElement).value)}
          aria-label="Filtrar por segmento"
        >
          <option value="">Todos os segmentos</option>
          {segmentOptions.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <span class="text-fg-subtle">{filtered.length} de {items.length}</span>
        <button
          type="button"
          class="ml-auto h-7 px-2 rounded-md text-xs font-medium border border-border text-accent hover:bg-accent/10 inline-flex items-center gap-1"
          onClick={exportCsv}
        >
          <Download size={12} /> Exportar CSV
        </button>
      </div>

      <div class="overflow-x-auto -mx-2">
        <table class="w-full text-xs">
          <thead class="text-fg-subtle text-[10px] uppercase tracking-wider border-b border-border">
            <tr>
              <th class="text-left p-1.5 font-medium">Nome</th>
              <th class="text-left p-1.5 font-medium">Empresa</th>
              <th class="text-left p-1.5 font-medium">Segmento</th>
              <th class="text-right p-1.5 font-medium">Score</th>
              <th class="text-left p-1.5 font-medium">Etapa</th>
              <th class="text-left p-1.5 font-medium">Origem</th>
              <th class="text-right p-1.5 font-medium">Data</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border">
            {filtered.slice(0, 50).map((l, i) => {
              const score = Number((l.scores as { geral?: number } | undefined)?.geral ?? 0)
              const tone = score >= 65 ? 'text-success' : score >= 45 ? 'text-warning' : 'text-danger'
              const src = leadSourceLabel(l.source as string | null | undefined)
              const created = l.createdAt ? new Date(l.createdAt as string).toLocaleDateString('pt-BR') : '—'
              return (
                <tr
                  key={l.id ?? i}
                  class="hover:bg-surface-2 cursor-pointer"
                  onClick={() => typeof l.id === 'number' && setOpenLeadId(l.id)}
                >
                  <td class="p-1.5 font-medium text-fg truncate max-w-[8rem]">{(l.nome as string) ?? '—'}</td>
                  <td class="p-1.5 text-fg-muted truncate max-w-[8rem]">{(l.empresa as string) ?? '—'}</td>
                  <td class="p-1.5 text-fg-subtle truncate max-w-[8rem]">{(l.segmento as string) ?? '—'}</td>
                  <td class={`p-1.5 text-right tabular-nums font-semibold ${tone}`}>{score}</td>
                  <td class="p-1.5 text-fg-muted">{(l.status as string) ?? '—'}</td>
                  <td class="p-1.5 text-fg-subtle">{src}</td>
                  <td class="p-1.5 text-right text-fg-subtle">{created}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {openLeadId !== null && (
        <Suspense fallback={null}>
          <LazyLeadDetailModal id={openLeadId} onClose={() => setOpenLeadId(null)} />
        </Suspense>
      )}
    </>
  )
}

function TableBody({ metric, data }: { metric: string; data: unknown }) {
  if (data === null || typeof data !== 'object') return null
  const d = data as { data?: TableItem[]; leads?: TableItem[]; pages?: TableItem[]; forms?: TableItem[] }
  const items = d.data ?? d.leads ?? d.pages ?? d.forms ?? []
  if (items.length === 0) return <NoData />

  if (metric === 'leads_recent') {
    return <LeadsRecentTable items={items} />
  }

  if (metric === 'pages_performance') {
    return (
      <div class="overflow-x-auto -mx-2">
        <table class="w-full text-xs">
          <thead class="text-fg-subtle text-[10px] uppercase tracking-wider border-b border-border">
            <tr>
              <th class="text-left p-1.5 font-medium">Página</th>
              <th class="text-left p-1.5 font-medium">Status</th>
              <th class="text-right p-1.5 font-medium">Views</th>
              <th class="text-right p-1.5 font-medium">Conversões</th>
              <th class="text-right p-1.5 font-medium">Taxa</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border">
            {items.slice(0, 12).map((p, i) => {
              const views = Number(p.views ?? 0)
              const subs = Number(p.submissions ?? 0)
              const rate = views > 0 ? ((subs / views) * 100).toFixed(1) : '0.0'
              return (
                <tr key={p.id ?? i} class="hover:bg-surface-2">
                  <td class="p-1.5 font-medium text-fg truncate max-w-[10rem]">{(p.title as string) ?? (p.slug as string) ?? '—'}</td>
                  <td class="p-1.5 text-fg-subtle">{p.status === 'PUBLISHED' ? 'Publicada' : 'Rascunho'}</td>
                  <td class="p-1.5 text-right tabular-nums">{views}</td>
                  <td class="p-1.5 text-right tabular-nums">{subs}</td>
                  <td class="p-1.5 text-right tabular-nums text-fg-muted">{rate}%</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  if (metric === 'forms_performance') {
    return (
      <div class="overflow-x-auto -mx-2">
        <table class="w-full text-xs">
          <thead class="text-fg-subtle text-[10px] uppercase tracking-wider border-b border-border">
            <tr>
              <th class="text-left p-1.5 font-medium">Formulário</th>
              <th class="text-left p-1.5 font-medium">Status</th>
              <th class="text-right p-1.5 font-medium">Submissões</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border">
            {items.slice(0, 12).map((f, i) => (
              <tr key={f.id ?? i} class="hover:bg-surface-2">
                <td class="p-1.5 font-medium text-fg truncate max-w-[12rem]">{(f.name as string) ?? '—'}</td>
                <td class="p-1.5 text-fg-subtle">{f.active ? 'Ativo' : 'Inativo'}</td>
                <td class="p-1.5 text-right tabular-nums">{Number(f.submissions ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  if (metric === 'templates_usage') {
    return (
      <div class="overflow-x-auto -mx-2">
        <table class="w-full text-xs">
          <thead class="text-fg-subtle text-[10px] uppercase tracking-wider border-b border-border">
            <tr>
              <th class="text-left p-1.5 font-medium">Modelo</th>
              <th class="text-left p-1.5 font-medium">Canal</th>
              <th class="text-right p-1.5 font-medium">Usos</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border">
            {items.slice(0, 12).map((t, i) => (
              <tr key={t.id ?? i} class="hover:bg-surface-2">
                <td class="p-1.5 font-medium text-fg truncate max-w-[12rem]">{(t.name as string) ?? '—'}</td>
                <td class="p-1.5"><span class="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-accent/15 text-accent">{(t.channel as string) ?? '—'}</span></td>
                <td class="p-1.5 text-right tabular-nums">{Number(t.usageCount ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  if (metric === 'leads_by_funnel') {
    return (
      <div class="overflow-x-auto -mx-2">
        <table class="w-full text-xs">
          <thead class="text-fg-subtle text-[10px] uppercase tracking-wider border-b border-border">
            <tr>
              <th class="text-left p-1.5 font-medium">Funil</th>
              <th class="text-right p-1.5 font-medium">Leads</th>
              <th class="text-left p-1.5 font-medium">Etapas</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border">
            {(items as unknown as { label: string; value: number; isDefault?: boolean; stages?: { name: string; count: number; color: string }[] }[]).map((f, i) => (
              <tr key={i} class="hover:bg-surface-2">
                <td class="p-1.5 font-medium text-fg">
                  {f.label}
                  {f.isDefault && <span class="ml-1.5 inline-block px-1.5 py-0.5 rounded bg-accent/15 text-accent text-[10px]">Padrão</span>}
                </td>
                <td class="p-1.5 text-right tabular-nums">{f.value}</td>
                <td class="p-1.5 text-[11px] text-fg-muted">
                  {(f.stages ?? []).map((s, si) => (
                    <span key={si} style={{ color: s.color }}>{s.name}: {s.count}{si < (f.stages ?? []).length - 1 ? ' · ' : ''}</span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  if (metric === 'registrations_recent') {
    const statusNames: Record<string, string> = {
      pending: 'Pendente', paid: 'Pago', docs_uploaded: 'Docs enviados', docs_reviewing: 'Em análise',
      docs_approved: 'Docs aprov.', docs_rejected: 'Docs rej.', approved: 'Aprovado', rejected: 'Rejeitado',
      enrolled: 'Matriculado', cancelled: 'Cancelado', expired: 'Expirado',
    }
    return (
      <div class="overflow-x-auto -mx-2">
        <table class="w-full text-xs">
          <thead class="text-fg-subtle text-[10px] uppercase tracking-wider border-b border-border">
            <tr>
              <th class="text-left p-1.5 font-medium">Código</th>
              <th class="text-left p-1.5 font-medium">Candidato</th>
              <th class="text-left p-1.5 font-medium">Portal</th>
              <th class="text-left p-1.5 font-medium">Status</th>
              <th class="text-left p-1.5 font-medium">Pagamento</th>
              <th class="text-right p-1.5 font-medium">Valor</th>
              <th class="text-right p-1.5 font-medium">Data</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border">
            {items.slice(0, 12).map((r, i) => {
              const val = r.paymentAmount != null ? brl.format(Number(r.paymentAmount)) : '–'
              const payStatus = typeof r.paymentStatus === 'string' ? r.paymentStatus : ''
              const payTone = payStatus === 'paid' ? 'bg-success/15 text-success' : payStatus === 'pending' ? 'bg-warning/15 text-warning' : ''
              const payLabel = payStatus === 'paid' ? 'Pago' : payStatus === 'pending' ? 'Pendente' : payStatus
              return (
                <tr key={r.id ?? i} class="hover:bg-surface-2">
                  <td class="p-1.5 font-mono text-[11px]">{(r.candidateCode as string) ?? '–'}</td>
                  <td class="p-1.5 font-medium text-fg">{(r.nome as string) ?? '–'}</td>
                  <td class="p-1.5 text-fg-muted">{(r.portal as string) ?? '–'}</td>
                  <td class="p-1.5 text-fg">{statusNames[r.status as string] ?? (r.status as string) ?? '–'}</td>
                  <td class="p-1.5">
                    {payStatus
                      ? <span class={`inline-block px-1.5 py-0.5 rounded text-[10px] ${payTone}`}>{payLabel}</span>
                      : '–'}
                  </td>
                  <td class="p-1.5 text-right tabular-nums text-[11px]">{val}</td>
                  <td class="p-1.5 text-right text-fg-subtle">
                    {r.createdAt ? new Date(r.createdAt as string).toLocaleDateString('pt-BR') : '–'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  if (metric === 'helpdesk_by_agent') {
    return (
      <div class="overflow-x-auto -mx-2">
        <table class="w-full text-xs">
          <thead class="text-fg-subtle text-[10px] uppercase tracking-wider border-b border-border">
            <tr>
              <th class="text-left p-1.5 font-medium">Agente</th>
              <th class="text-right p-1.5 font-medium">Atribuídos</th>
              <th class="text-right p-1.5 font-medium">Resolvidos</th>
              <th class="text-right p-1.5 font-medium">TMR</th>
              <th class="text-right p-1.5 font-medium">Reaberturas</th>
              <th class="text-right p-1.5 font-medium">CSAT</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border">
            {items.slice(0, 15).map((a, i) => (
              <tr key={(a.agentUserId as number) ?? i} class="hover:bg-surface-2">
                <td class="p-1.5 font-medium text-fg truncate max-w-[12rem]">{(a.name as string) ?? '—'}</td>
                <td class="p-1.5 text-right tabular-nums">{Number(a.assigned ?? 0)}</td>
                <td class="p-1.5 text-right tabular-nums">{Number(a.solved ?? 0)}</td>
                <td class="p-1.5 text-right tabular-nums text-fg-muted">{fmtMins(a.avgResolutionMins)}</td>
                <td class="p-1.5 text-right tabular-nums text-fg-muted">{Number(a.reopened ?? 0)}</td>
                <td class="p-1.5 text-right tabular-nums">{a.csatAvg != null ? `${a.csatAvg}/5` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  // Generic fallback
  const sample = items[0] ?? {}
  const keys = Object.keys(sample).filter((k) => k !== 'id' && k !== 'stages' && k !== 'isDefault').slice(0, 6)
  return (
    <div class="overflow-x-auto -mx-2">
      <table class="w-full text-xs">
        <thead class="text-fg-subtle text-[10px] uppercase tracking-wider border-b border-border">
          <tr>{keys.map((k) => <th key={k} class="text-left p-1.5 font-medium">{k}</th>)}</tr>
        </thead>
        <tbody class="divide-y divide-border">
          {items.slice(0, 10).map((row, i) => (
            <tr key={row.id ?? i} class="hover:bg-surface-2">
              {keys.map((k) => {
                const v = (row as Record<string, unknown>)[k]
                let display: string
                if (v === null || v === undefined) display = '—'
                else if (typeof v === 'object') display = JSON.stringify(v)
                else if (typeof v === 'number' || typeof v === 'boolean') display = String(v)
                else if (typeof v === 'string') display = v
                else display = ''
                return <td key={k} class="p-1.5 text-fg-muted truncate max-w-[10rem]">{display}</td>
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ───────────────────────────────────────────────
// Compat: list / breakdown (dashboards salvos)
// ───────────────────────────────────────────────

function ListBody({ metric, data }: { metric: string; data: unknown }) {
  return <TableBody metric={metric} data={data} />
}

function BreakdownBody({ data }: { data: unknown }) {
  return <HBarListBody data={data} />
}

// ───────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────

function NoData() {
  return <div class="text-xs text-fg-subtle text-center py-4">Sem dados</div>
}

function formatLabel(s: string, max = 15): string {
  // Datas no formato YYYY-MM-DD viram DD/MM
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const p = s.split('-')
    return `${p[2]}/${p[1]}`
  }
  if (/^\d{4}-\d{2}$/.test(s)) {
    const p = s.split('-')
    return `${p[1]}/${p[0]?.slice(2)}`
  }
  return s.length > max ? s.substring(0, max) + '…' : s
}

// silence unused import warning if FUNNEL_AWARE_METRICS isn't referenced here
void FUNNEL_AWARE_METRICS
void useState
