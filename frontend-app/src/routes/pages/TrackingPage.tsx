import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { Fragment } from 'preact'
import {
  Activity, Eye, Globe, Users, MousePointer, Smartphone, UserCheck, Zap,
  Copy, Check, ExternalLink, Code, AlertTriangle, X, Minus,
  FileText, MapPin, MousePointer2, ArrowDownWideNarrow, ClipboardCheck,
  CircleUser, Gauge, Link as LinkIcon, Monitor, Tablet, Compass, HelpCircle,
} from 'lucide-preact'
import { HowItWorksModal } from '@/components/ui/HowItWorksModal'
import {
  useTrackingStats,
  useTrackingVisitors,
  useTrackingVisitor,
  useTrackingTimeline,
  useTrackingSnippet,
  useValidateTrackingUrl,
  useValidateTrackingPages,
  useMonitoredUrls,
  useLinkVisitor,
  useRecentLeads,
  type TrackingVisitor,
  type TrackingEvent,
  type UrlValidationResult,
  type PageValidationResult,
  type RecentLeadItem,
} from '@/hooks/useTracking'
import { useLocation } from 'wouter-preact'
import { useOriginsStats, type OriginBreakdownItem } from '@/hooks/useOrigins'
import { Page } from '@/components/ui/Page'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { PeriodPicker, PeriodIncompleteHint, usePeriod, periodLabel, type PeriodRange } from '@/components/ui/PeriodPicker'
import { Button } from '@/components/ui/Button'
import { KpiCard } from '@/components/ui/KpiCard'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Input, Select } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { SearchInput } from '@/components/ui/SearchInput'
import { formatRelative, formatDateTime } from '@/lib/format'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/cn'

type Tab = 'overview' | 'origins' | 'visitors' | 'pages' | 'validate' | 'sites'

const VALID_TABS: readonly Tab[] = ['overview', 'origins', 'visitors', 'pages', 'validate', 'sites']

function readTabFromUrl(): Tab {
  if (typeof window === 'undefined') return 'overview'
  const t = new URLSearchParams(window.location.search).get('tab')
  return (VALID_TABS as readonly string[]).includes(t ?? '') ? (t as Tab) : 'overview'
}

export function TrackingPage() {
  const [tab, setTab] = useState<Tab>(() => readTabFromUrl())
  const period = usePeriod('tracking')
  const [installOpen, setInstallOpen] = useState(false)
  const [validateUrlSeed, setValidateUrlSeed] = useState<string | null>(null)
  const [showHowItWorks, setShowHowItWorks] = useState(false)

  // Sincroniza ?tab=… no URL ao trocar de aba (deep-link).
  useEffect(() => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    if (tab === 'overview') url.searchParams.delete('tab')
    else url.searchParams.set('tab', tab)
    window.history.replaceState(null, '', url.toString())
  }, [tab])

  function jumpToValidate(url: string) {
    setValidateUrlSeed(url)
    setTab('validate')
  }

  return (
    <Page
      title="Rastreamento"
      description="Origens dos leads, visitantes anônimos do site, sessões e páginas mais acessadas."
      actions={
        <Fragment>
          <Button variant="ghost" size="sm" onClick={() => setShowHowItWorks(true)}>
            <HelpCircle size={14} /> Como funciona?
          </Button>
          {(tab === 'overview' || tab === 'pages' || tab === 'origins') && (
            <PeriodPicker
              preset={period.preset}
              customFrom={period.customFrom}
              customTo={period.customTo}
              onPreset={period.setPreset}
              onCustom={period.setCustom}
            />
          )}
          <Button variant="primary" size="sm" onClick={() => setInstallOpen(true)}>
            <Code size={12} /> Código de Instalação
          </Button>
        </Fragment>
      }
    >
      <div class="flex gap-1 border-b border-border overflow-x-auto">
        <TabButton active={tab === 'overview'} onClick={() => setTab('overview')}>Visão Geral</TabButton>
        <TabButton active={tab === 'origins'} onClick={() => setTab('origins')}>Origens dos Leads</TabButton>
        <TabButton active={tab === 'visitors'} onClick={() => setTab('visitors')}>Visitantes</TabButton>
        <TabButton active={tab === 'pages'} onClick={() => setTab('pages')}>Páginas</TabButton>
        <TabButton active={tab === 'validate'} onClick={() => setTab('validate')}>Validar URL</TabButton>
        <TabButton active={tab === 'sites'} onClick={() => setTab('sites')}>Sites Monitorados</TabButton>
      </div>

      <PeriodIncompleteHint show={period.range.incomplete} />

      {tab === 'overview' && <OverviewTab period={period.range} />}
      {tab === 'origins' && <OriginsTab period={period.range} />}
      {tab === 'visitors' && <VisitorsTab />}
      {tab === 'pages' && <PagesTab period={period.range} />}
      {tab === 'validate' && <ValidateTab seedUrl={validateUrlSeed} clearSeed={() => setValidateUrlSeed(null)} />}
      {tab === 'sites' && <SitesTab onValidate={jumpToValidate} />}

      {installOpen && <InstallationModal onClose={() => setInstallOpen(false)} />}

      <HowItWorksModal
        open={showHowItWorks}
        onClose={() => setShowHowItWorks(false)}
        title="Como funciona o Rastreamento?"
        problem={<>
          Lead virou venda. Veio de onde? Instagram? Anúncio do Google? Tráfego direto? Sem rastreamento,
          você adivinha. Esta tela instala um <strong>pixel no seu site</strong> que segue o visitante
          anonimamente, registra cada página vista, e quando ele virar lead, <strong>amarra toda a
          jornada</strong> à origem real.
        </>}
        steps={[
          {
            title: '📦 Instale o pixel',
            body: <>Botão <strong>Código de Instalação</strong>: copie o snippet e cole no <code>&lt;head&gt;</code> do seu site/landing page. A partir daí, cada visitante recebe um cookie anônimo de 1 ano.</>,
          },
          {
            title: '👻 Visitantes anônimos viram identificados',
            body: <>Antes de virar lead, o visitante já é registrado (com device, UTMs, páginas vistas, tempo de sessão). Quando ele preenche formulário ou abre conversa, o cookie é <strong>vinculado</strong> ao lead — e a jornada toda passa a ter dono.</>,
          },
          {
            title: '🌐 Veja Origens',
            body: <>Aba <strong>Origens</strong>: gráfico de pizza com de onde vieram seus leads — Meta Ads, Google Ads, Instagram orgânico, link rastreável, direto, etc. Combine com período pra ver evolução mês a mês.</>,
          },
          {
            title: '🗺️ Páginas mais acessadas',
            body: <>Aba <strong>Páginas</strong>: ranking das URLs do seu site por visitas, tempo médio, conversão. Útil pra entender qual landing converte melhor e onde o cliente perde interesse.</>,
          },
          {
            title: '🧪 Validar a instalação',
            body: <>Aba <strong>Validar</strong>: digite uma URL do seu site, o sistema acessa e confere se o pixel está respondendo. Útil pra confirmar que ficou no ar depois de mudanças no site.</>,
          },
        ]}
        tip={{
          tone: 'warning',
          title: '⚠️ Antes que perguntem',
          body: <>Rastreamento <strong>não usa cookies de terceiros</strong> (que estão sendo bloqueados). Cookie é first-party (do seu domínio), funciona em Safari, iOS, ad blockers comuns. Mas precisa que o pixel esteja em <strong>todas</strong> as páginas pra não perder a sessão.</>,
        }}
      />
    </Page>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: preact.ComponentChildren }) {
  return (
    <button
      type="button"
      onClick={onClick}
      class={cn(
        'px-3 h-9 -mb-px border-b-2 text-sm font-medium whitespace-nowrap transition-colors',
        active ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:text-fg',
      )}
    >
      {children}
    </button>
  )
}

function deviceIcon(type: string | undefined) {
  if (type === 'mobile') return <Smartphone size={14} />
  if (type === 'tablet') return <Tablet size={14} />
  return <Monitor size={14} />
}

function metaGet(meta: Record<string, unknown> | null | undefined, k: string): string | undefined {
  const v = meta?.[k]
  return typeof v === 'string' || typeof v === 'number' ? String(v) : undefined
}

// ─────────────────────────────────────────────────────────────────────────────
// Overview tab

function OverviewTab({ period }: { period: PeriodRange }) {
  const { data, isLoading } = useTrackingStats(period)
  const { data: recentLeadsData, isLoading: leadsLoading } = useRecentLeads(period, 10)
  const [detailId, setDetailId] = useState<number | null>(null)

  return (
    <>
      <section class="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="Visitantes" value={data?.overview.totalVisitors ?? '—'} loading={isLoading} icon={<Users size={16} />} hint="Sessões captadas pelo pixel bt.js" />
        <KpiCard label="Identificados" value={data?.overview.identifiedVisitors ?? '—'} loading={isLoading} icon={<Eye size={16} />} hint="Visitantes com email/telefone" />
        <KpiCard label="Vinculados a Lead" value={data?.overview.linkedLeads ?? '—'} loading={isLoading} icon={<UserCheck size={16} />} hint="Visitantes pixel↔Lead" />
        <KpiCard label="Sessões" value={data?.overview.totalSessions ?? '—'} loading={isLoading} icon={<Activity size={16} />} />
        <KpiCard label="Pageviews" value={data?.overview.totalPageviews ?? '—'} loading={isLoading} icon={<MousePointer size={16} />} />
        <KpiCard label="Eventos" value={data?.overview.totalEvents ?? '—'} loading={isLoading} icon={<Zap size={16} />} />
      </section>

      <section class="grid gap-3 grid-cols-1 lg:grid-cols-2">
        <DevicesCard isLoading={isLoading} devices={data?.deviceBreakdown ?? []} />
        <ReferrersCard isLoading={isLoading} refs={data?.topReferrers ?? []} />
      </section>

      <RecentLeadsCard
        isLoading={leadsLoading}
        leads={recentLeadsData?.leads ?? []}
        coverage={recentLeadsData?.coverage ?? null}
        period={period}
      />

      <RecentVisitorsCard
        isLoading={isLoading}
        visitors={data?.recentVisitors ?? []}
        coverage={recentLeadsData?.coverage ?? null}
        onView={setDetailId}
      />

      {detailId !== null && <VisitorDetailModal id={detailId} onClose={() => setDetailId(null)} />}
    </>
  )
}

// ─── Origens dos Leads (consolidado de /app/sources) ──────────────────
// Diferente das outras abas (que medem visitantes/sessões via pixel bt.js),
// aqui agregamos por `Lead.originType`: meta_ctwa, google_ads, web_form,
// trackable_link, etc. Granularidade: 1 lead = 1 origem.

const ORIGIN_LABELS: Record<string, string> = {
  trackable_link: 'Link Rastreável',
  db_connector: 'Banco de Dados',
  meta_ctwa: 'Meta Ads (CTWA)',
  google_ads: 'Google Ads',
  meta_lead_ads: 'Meta Lead Ads',
  organic: 'Orgânico',
  web_form: 'Formulário Web',
  scheduling: 'Agendamento',
  web_chat: 'Chat do Site',
  chat: 'Chat',
  api: 'API',
  import: 'Importação',
  manual: 'Manual',
  whatsapp: 'WhatsApp Direto',
  instagram: 'Instagram Direto',
  telegram: 'Telegram',
  enrollment_portal: 'Portal de Matrículas',
  make: 'Make.com',
  direct: 'Direto',
}
const ORIGIN_COLORS: Record<string, string> = {
  meta_ctwa: '#1877f2',
  google_ads: '#34a853',
  trackable_link: '#ff9800',
  organic: '#9e9e9e',
  meta_lead_ads: '#e91e63',
  web_form: '#00bcd4',
  scheduling: '#0ea5e9',
  web_chat: '#0097a7',
  chat: '#0097a7',
  api: '#6d49f9',
  import: '#8d6e63',
  manual: '#795548',
  whatsapp: '#25d366',
  instagram: '#e4405f',
  telegram: '#26a5e4',
  enrollment_portal: '#7c3aed',
  make: '#6366f1',
  direct: '#5f6368',
}
const ORIGIN_FALLBACK_COLOR = '#9e9e9e'

function fmtOriginNum(n: number) { return (n || 0).toLocaleString('pt-BR') }

function OriginsTab({ period }: { period: PeriodRange }) {
  const { data, isLoading } = useOriginsStats(period)
  const breakdown = data?.originBreakdown ?? []
  const total = breakdown.reduce((a, b) => a + (b.count || 0), 0)

  return (
    <>
      <section class="grid gap-3 grid-cols-1 sm:grid-cols-3">
        <KpiCard
          label="Total Leads"
          value={data ? fmtOriginNum(data.totalLeads) : '—'}
          loading={isLoading}
          icon={<Users size={16} />}
        />
        <KpiCard
          label="Leads rastreados"
          value={data ? fmtOriginNum(data.trackedLeads) : '—'}
          loading={isLoading}
          hint="com origem identificada"
          icon={<UserCheck size={16} />}
        />
        <KpiCard
          label="Taxa de rastreamento"
          value={data ? `${data.trackingRate}%` : '—'}
          loading={isLoading}
          icon={<Gauge size={16} />}
        />
      </section>

      <section class="grid gap-3 grid-cols-1 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle><span class="inline-flex items-center gap-2"><Compass size={14} /> Distribuição por origem</span></CardTitle>
          </CardHeader>
          {isLoading && <Skeleton class="h-72 w-full" />}
          {!isLoading && breakdown.length === 0 && (
            <EmptyState icon={<Compass size={24} />} title="Sem leads no período" />
          )}
          {!isLoading && breakdown.length > 0 && <OriginsDonutChart breakdown={breakdown} total={total} />}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Detalhamento</CardTitle>
          </CardHeader>
          {isLoading && <Skeleton class="h-72 w-full" />}
          {!isLoading && breakdown.length === 0 && (
            <div class="text-center text-fg-subtle text-sm py-10">Sem dados no período</div>
          )}
          {!isLoading && breakdown.length > 0 && (
            <ul class="flex flex-col gap-2.5">
              {breakdown.map((item) => {
                const label = ORIGIN_LABELS[item.originType] ?? item.originType
                const color = ORIGIN_COLORS[item.originType] ?? ORIGIN_FALLBACK_COLOR
                const pct = total > 0 ? ((item.count / total) * 100).toFixed(1) : '0.0'
                return (
                  <li key={item.originType} class="flex items-center gap-3">
                    <span class="size-3 rounded-full shrink-0" style={{ background: color }} />
                    <span class="flex-1 text-sm text-fg truncate" title={label}>{label}</span>
                    <span class="text-sm text-fg tabular-nums w-14 text-right font-medium">{fmtOriginNum(item.count)}</span>
                    <span class="text-xs text-fg-muted tabular-nums w-12 text-right">{pct}%</span>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      </section>
    </>
  )
}

function OriginsDonutChart({ breakdown, total }: { breakdown: OriginBreakdownItem[]; total: number }) {
  // Padrão de tooltip alinhado ao WidgetRenderer (donut/pie/polar):
  //   - state `hover` com { index, x, y } relativo ao container
  //   - tooltip flutuante (div absolute) com bg-surface/border/shadow
  //   - dimming das fatias inativas + lift radial da fatia ativa
  //   - centro dinâmico: idle=Total; hover=label+valor+%
  const containerRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ index: number; x: number; y: number } | null>(null)

  const cx = 100, cy = 100, R = 80, rInner = 44

  const segments = useMemo(() => {
    if (total === 0) return [] as Array<{
      originType: string
      color: string
      label: string
      count: number
      startFrac: number
      endFrac: number
    }>
    let acc = 0
    return breakdown.map((item) => {
      const startFrac = acc / total
      acc += item.count
      const endFrac = acc / total
      return {
        originType: item.originType,
        color: ORIGIN_COLORS[item.originType] ?? ORIGIN_FALLBACK_COLOR,
        label: ORIGIN_LABELS[item.originType] ?? item.originType,
        count: item.count,
        startFrac,
        endFrac,
      }
    })
  }, [breakdown, total])

  function onSliceMove(i: number) {
    return (e: MouseEvent) => {
      const c = containerRef.current
      if (!c) return
      const rect = c.getBoundingClientRect()
      setHover({ index: i, x: e.clientX - rect.left, y: e.clientY - rect.top })
    }
  }
  function onSliceLeave() { setHover(null) }
  function onLegendEnter(i: number) { setHover({ index: i, x: -9999, y: -9999 }) }
  function onLegendLeave() { setHover(null) }

  const activeIndex = hover?.index ?? null

  // Lift radial — desloca a fatia ativa pra fora levemente (igual WidgetRenderer).
  function lift(i: number, startFrac: number, endFrac: number) {
    if (activeIndex !== i) return ''
    const midAngle = ((startFrac + endFrac) / 2) * Math.PI * 2 - Math.PI / 2
    const dx = 6 * Math.cos(midAngle)
    const dy = 6 * Math.sin(midAngle)
    return `translate(${dx} ${dy})`
  }

  // Centro do donut.
  let centerLabel = 'Total'
  let centerValue = fmtOriginNum(total)
  let centerSub = total === 1 ? 'lead' : 'leads'
  if (activeIndex !== null && segments[activeIndex]) {
    const seg = segments[activeIndex]!
    const pct = (seg.count / total) * 100
    centerLabel = seg.label
    centerValue = fmtOriginNum(seg.count)
    centerSub = pct >= 10 ? `${pct.toFixed(0)}%` : `${pct.toFixed(1)}%`
  }

  // Tooltip flutuante (só quando o mouse está sobre a fatia, não pela legenda).
  const showFloatingTooltip = hover && hover.x >= 0 && hover.y >= 0
  const hoverSeg = activeIndex !== null ? segments[activeIndex] : undefined
  const hoverPct = hoverSeg && total > 0 ? (hoverSeg.count / total) * 100 : 0

  return (
    <div ref={containerRef} class="relative flex flex-col items-center gap-3">
      <svg viewBox="0 0 200 200" class="w-full max-w-[240px] overflow-visible" role="img" aria-label="Gráfico de rosca de origens">
        {segments.map((s, i) => {
          const startAngle = s.startFrac * Math.PI * 2 - Math.PI / 2
          const endAngle = s.endFrac * Math.PI * 2 - Math.PI / 2
          const x1 = cx + R * Math.cos(startAngle)
          const y1 = cy + R * Math.sin(startAngle)
          const x2 = cx + R * Math.cos(endAngle)
          const y2 = cy + R * Math.sin(endAngle)
          const largeArc = s.endFrac - s.startFrac > 0.5 ? 1 : 0
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
          const isHover = activeIndex === i
          const isDimmed = activeIndex !== null && activeIndex !== i
          return (
            <path
              key={s.originType}
              d={dPath}
              fill={s.color}
              fill-opacity={isHover ? 1 : isDimmed ? 0.35 : 0.85}
              stroke={isHover ? s.color : 'transparent'}
              stroke-width={isHover ? 2 : 0}
              transform={lift(i, s.startFrac, s.endFrac)}
              style={{ transition: 'fill-opacity 140ms ease, transform 140ms ease' }}
              onMouseEnter={onSliceMove(i)}
              onMouseMove={onSliceMove(i)}
              onMouseLeave={onSliceLeave}
            />
          )
        })}
        <text x={cx} y={cy - 6} text-anchor="middle" dominant-baseline="central" fill="var(--color-fg-subtle)" font-size="9">
          {centerLabel.length > 18 ? centerLabel.slice(0, 17) + '…' : centerLabel}
        </text>
        <text x={cx} y={cy + 8} text-anchor="middle" dominant-baseline="central" fill="var(--color-fg)" font-size="18" font-weight="700">
          {centerValue}
        </text>
        <text x={cx} y={cy + 24} text-anchor="middle" dominant-baseline="central" fill="var(--color-fg-subtle)" font-size="9">
          {centerSub}
        </text>
      </svg>

      <ul class="flex flex-wrap justify-center gap-x-3 gap-y-1.5 max-w-full">
        {segments.map((s, i) => {
          const isActive = activeIndex === i
          const isDimmed = activeIndex !== null && activeIndex !== i
          return (
            <li
              key={s.originType}
              class={`inline-flex items-center gap-1.5 text-xs cursor-default rounded px-1 py-0.5 transition-colors ${isDimmed ? 'opacity-40' : ''} ${isActive ? 'bg-surface-3/60 text-fg' : 'text-fg-muted'}`}
              onMouseEnter={() => onLegendEnter(i)}
              onMouseLeave={onLegendLeave}
            >
              <span class="size-2.5 rounded-sm" style={{ background: s.color }} />
              <span>{s.label}</span>
            </li>
          )
        })}
      </ul>

      {showFloatingTooltip && hoverSeg && (
        <div
          class="pointer-events-none absolute z-50 rounded-md border border-border bg-surface shadow-lg px-2.5 py-1.5 text-[11px] whitespace-nowrap"
          style={{ left: `${hover!.x + 12}px`, top: `${hover!.y + 12}px` }}
        >
          <div class="flex items-center gap-2 mb-0.5">
            <span class="size-2 rounded-sm shrink-0" style={{ background: hoverSeg.color }} />
            <span class="font-medium text-fg">{hoverSeg.label}</span>
          </div>
          <div class="flex items-center gap-3 text-fg-muted">
            <span class="tabular-nums">{fmtOriginNum(hoverSeg.count)} {hoverSeg.count === 1 ? 'lead' : 'leads'}</span>
            <span class="tabular-nums">{hoverPct >= 10 ? hoverPct.toFixed(0) : hoverPct.toFixed(1)}%</span>
          </div>
        </div>
      )}
    </div>
  )
}

function DevicesCard({ isLoading, devices }: { isLoading: boolean; devices: { type: string; count: number }[] }) {
  const total = devices.reduce((a, b) => a + b.count, 0)
  return (
    <Card>
      <CardHeader>
        <CardTitle><span class="inline-flex items-center gap-2"><Smartphone size={14} /> Dispositivos</span></CardTitle>
      </CardHeader>
      {isLoading && <Skeleton class="h-24 w-full" />}
      {!isLoading && devices.length === 0 && <EmptyState description="Sem dados" />}
      {!isLoading && devices.length > 0 && (
        <ul class="space-y-3">
          {devices.map((d) => {
            const pct = total > 0 ? Math.round((d.count / total) * 100) : 0
            return (
              <li key={d.type} class="flex items-center gap-3">
                <span class="text-fg-muted shrink-0">{deviceIcon(d.type)}</span>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center justify-between text-xs mb-1">
                    <span class="text-fg font-medium capitalize">{d.type}</span>
                    <span class="text-fg-muted tabular-nums">{d.count.toLocaleString('pt-BR')} ({pct}%)</span>
                  </div>
                  <div class="h-1.5 rounded-full bg-surface-3 overflow-hidden">
                    <div class="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

function ReferrersCard({ isLoading, refs }: { isLoading: boolean; refs: { referrer: string; count: number }[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Origens (Referrers)</CardTitle>
      </CardHeader>
      {isLoading && <Skeleton class="h-32 w-full" />}
      {!isLoading && refs.length === 0 && <EmptyState description="Tráfego direto ou sem identificação." />}
      {!isLoading && refs.length > 0 && (
        <ul class="flex flex-col gap-2">
          {refs.map((r) => {
            const max = refs[0]?.count ?? 1
            const pct = Math.max(2, Math.round((r.count / max) * 100))
            let display = r.referrer
            try { display = new URL(r.referrer).hostname } catch { /* keep raw */ }
            return (
              <li key={r.referrer} class="flex items-center gap-3">
                <span class="text-xs text-fg-muted w-32 truncate" title={r.referrer}>{display}</span>
                <span class="flex-1 h-2 rounded-full bg-surface-3 overflow-hidden">
                  <span class="block h-full bg-accent" style={{ width: `${pct}%` }} />
                </span>
                <span class="text-xs text-fg w-8 text-right tabular-nums">{r.count}</span>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

// ─── Leads Recentes — alimentado por bychat_leads (não depende do pixel) ──

function RecentLeadsCard({
  isLoading, leads, coverage, period,
}: {
  isLoading: boolean
  leads: RecentLeadItem[]
  coverage: { totalLeads: number; leadsWithTrackedSession: number; rate: number } | null
  period: PeriodRange
}) {
  const [, navigate] = useLocation()
  return (
    <Card class="p-0 overflow-hidden">
      <div class="px-4 pt-4 pb-3 flex items-center justify-between gap-3 flex-wrap">
        <div class="min-w-0">
          <CardTitle>Leads Recentes</CardTitle>
          <p class="text-[0.6875rem] text-fg-subtle mt-0.5">
            Todos os leads criados {periodLabel(period)} — independente de origem (Meta Lead Ads, WhatsApp, formulário, API). Use o badge "rastreado" pra saber quais também passaram pelo pixel.
          </p>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          {coverage && (
            <span
              class="text-[0.6875rem] text-fg-muted px-2 py-0.5 rounded bg-surface-3"
              title="% dos leads do período com sessão de pixel vinculada"
            >
              Cobertura pixel: {coverage.rate}%
            </span>
          )}
          <span class="text-xs text-fg-subtle">{coverage?.totalLeads ?? leads.length} leads</span>
        </div>
      </div>
      {isLoading && <div class="px-4 pb-4"><Skeleton class="h-32 w-full" /></div>}
      {!isLoading && leads.length === 0 && (
        <div class="p-8">
          <EmptyState description={`Nenhum lead criado ${periodLabel(period)}.`} />
        </div>
      )}
      {!isLoading && leads.length > 0 && (
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-[0.6875rem] uppercase tracking-wider text-fg-subtle border-b border-border">
                <th class="text-left px-3 py-2 font-medium">Lead</th>
                <th class="text-left px-3 py-2 font-medium">Contato</th>
                <th class="text-left px-3 py-2 font-medium">Origem</th>
                <th class="text-left px-3 py-2 font-medium">Etapa</th>
                <th class="text-left px-3 py-2 font-medium">Atribuído</th>
                <th class="text-left px-3 py-2 font-medium">Criado</th>
                <th class="text-center px-3 py-2 font-medium">Pixel</th>
                <th class="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-border">
              {leads.map((l) => {
                const originLabel = l.originType
                  ? (ORIGIN_LABELS[l.originType] ?? l.originType)
                  : '—'
                const originColor = l.originType
                  ? (ORIGIN_COLORS[l.originType] ?? ORIGIN_FALLBACK_COLOR)
                  : '#9ca3af'
                const contact = l.whatsapp || l.email || '—'
                return (
                  <tr key={l.id} class="hover:bg-surface-2/30">
                    <td class="px-3 py-2 min-w-0">
                      <div class="font-medium text-fg truncate">{l.nome || `#${l.id}`}</div>
                      <div class="text-[0.625rem] text-fg-subtle">#{l.id}</div>
                    </td>
                    <td class="px-3 py-2 text-fg-muted text-xs break-words max-w-48">{contact}</td>
                    <td class="px-3 py-2">
                      <span class="inline-flex items-center gap-1.5 text-xs">
                        <span class="size-2 rounded-full shrink-0" style={{ background: originColor }} />
                        <span class="text-fg-muted truncate" title={originLabel}>{originLabel}</span>
                      </span>
                    </td>
                    <td class="px-3 py-2 text-xs text-fg-muted">
                      {l.status || '—'}
                      {l.funnel && <div class="text-[0.625rem] text-fg-subtle">{l.funnel.name}</div>}
                    </td>
                    <td class="px-3 py-2 text-xs text-fg-muted truncate max-w-32">
                      {l.assignedUser ? (l.assignedUser.name ?? l.assignedUser.email) : '—'}
                      {l.team && <div class="text-[0.625rem] text-fg-subtle">{l.team.name}</div>}
                    </td>
                    <td class="px-3 py-2 text-fg-muted text-xs whitespace-nowrap">{formatRelative(l.createdAt)}</td>
                    <td class="px-3 py-2 text-center">
                      {l.hasTrackedSession ? (
                        <Badge tone="success" title="Lead com sessão de pixel vinculada">rastreado</Badge>
                      ) : (
                        <span class="text-fg-subtle text-xs" title="Sem sessão de pixel — origem não passou pelo site">—</span>
                      )}
                    </td>
                    <td class="px-3 py-2 text-right">
                      <Button variant="secondary" size="sm" onClick={() => navigate(`/leads/${l.id}`)}>Abrir</Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

function RecentVisitorsCard({
  isLoading, visitors, onView, coverage,
}: {
  isLoading: boolean
  visitors: TrackingVisitor[]
  onView: (id: number) => void
  coverage: { totalLeads: number; leadsWithTrackedSession: number; rate: number } | null
}) {
  return (
    <Card class="p-0 overflow-hidden">
      <div class="px-4 pt-4 pb-3 flex items-center justify-between gap-3 flex-wrap">
        <div class="min-w-0">
          <CardTitle>Visitantes Recentes</CardTitle>
          <p class="text-[0.6875rem] text-fg-subtle mt-0.5">
            Captados pelo pixel <code class="px-1 py-0.5 rounded bg-surface-3 text-[0.625rem]">bt.js</code>. Leads que vêm de Meta Lead Ads, WhatsApp direto ou API <strong>não</strong> aparecem aqui — instale o pixel nas páginas pra capturar a navegação anônima.
          </p>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          {coverage && coverage.totalLeads > 0 && (
            <span
              class="text-[0.6875rem] text-fg-muted px-2 py-0.5 rounded bg-surface-3"
              title={`${coverage.leadsWithTrackedSession} de ${coverage.totalLeads} leads do período passaram pelo pixel antes de virar lead. ${coverage.rate}% de cobertura.`}
            >
              {coverage.leadsWithTrackedSession}/{coverage.totalLeads} leads rastreados
            </span>
          )}
          <span class="text-xs text-fg-subtle">{visitors.length} visitantes</span>
        </div>
      </div>
      {isLoading && <div class="px-4 pb-4"><Skeleton class="h-32 w-full" /></div>}
      {!isLoading && visitors.length === 0 && <div class="p-8"><EmptyState description="Nenhum visitante ainda" /></div>}
      {!isLoading && visitors.length > 0 && (
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-[0.6875rem] uppercase tracking-wider text-fg-subtle border-b border-border">
                <th class="text-left px-3 py-2 font-medium">Visitante</th>
                <th class="text-left px-3 py-2 font-medium">Contato</th>
                <th class="text-center px-3 py-2 font-medium">Sessões</th>
                <th class="text-center px-3 py-2 font-medium">Pageviews</th>
                <th class="text-left px-3 py-2 font-medium">Visto em</th>
                <th class="text-center px-3 py-2 font-medium">Lead</th>
                <th class="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-border">
              {visitors.map((v) => {
                const meta = v.metadata
                const browser = metaGet(meta, 'browser') ?? ''
                const os = metaGet(meta, 'os') ?? ''
                const name = v.identifiedName ?? v.identifiedEmail ?? `${v.visitorId.slice(0, 12)}…`
                const contact = v.identifiedEmail ?? v.identifiedPhone ?? '—'
                const isIdentified = !!(v.identifiedEmail ?? v.identifiedPhone)
                return (
                  <tr key={v.id}>
                    <td class="px-3 py-2 min-w-0">
                      <div class="flex min-w-0 flex-wrap items-center gap-2">
                        <div class={cn(
                          'size-7 rounded-full grid place-items-center shrink-0',
                          isIdentified ? 'bg-info/15 text-info' : 'bg-surface-3 text-fg-muted',
                        )}>
                          {deviceIcon(metaGet(meta, 'deviceType'))}
                        </div>
                        <div class="min-w-0 flex-1">
                          <div class="text-fg truncate font-medium">{name}</div>
                          <div class="text-[0.625rem] text-fg-subtle truncate">{[browser, os].filter(Boolean).join(' · ') || '—'}</div>
                        </div>
                      </div>
                    </td>
                    <td class="px-3 py-2 text-fg-muted text-xs break-words max-w-48">{contact}</td>
                    <td class="px-3 py-2 text-center tabular-nums font-medium text-fg">{v.totalSessions}</td>
                    <td class="px-3 py-2 text-center tabular-nums font-medium text-fg">{v.totalPageviews}</td>
                    <td class="px-3 py-2 text-fg-muted text-xs whitespace-nowrap">{formatRelative(v.lastSeenAt)}</td>
                    <td class="px-3 py-2 text-center">
                      {v.leadId ? <Badge tone="success">#{v.leadId}</Badge> : <span class="text-fg-subtle text-xs">—</span>}
                    </td>
                    <td class="px-3 py-2 text-right">
                      <Button variant="secondary" size="sm" onClick={() => onView(v.id)}>Ver</Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Visitors tab — tabela completa

function VisitorsTab() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [searchDebounced, setSearchDebounced] = useState('')
  const [identified, setIdentified] = useState<'' | 'true' | 'false'>('')
  const [hasLead, setHasLead] = useState<'' | 'true' | 'false'>('')
  const [detailId, setDetailId] = useState<number | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search), 400)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => { setPage(1) }, [searchDebounced, identified, hasLead])

  const { data, isLoading } = useTrackingVisitors({
    page,
    limit: 25,
    search: searchDebounced || undefined,
    identified: identified || undefined,
    hasLead: hasLead || undefined,
  })

  const visitors = data?.visitors ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / 25))

  return (
    <>
      <Card>
        <div class="flex flex-wrap items-center gap-3">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Buscar por email, telefone, nome..."
            class="flex-1 min-w-48"
          />
          <Select value={identified} onChange={(e) => setIdentified((e.target as HTMLSelectElement).value as typeof identified)}>
            <option value="">Todos</option>
            <option value="true">Identificados</option>
            <option value="false">Anônimos</option>
          </Select>
          <Select value={hasLead} onChange={(e) => setHasLead((e.target as HTMLSelectElement).value as typeof hasLead)}>
            <option value="">Todos</option>
            <option value="true">Com Lead</option>
            <option value="false">Sem Lead</option>
          </Select>
          <span class="text-xs text-fg-muted ml-auto">{total} visitante{total !== 1 ? 's' : ''}</span>
        </div>
      </Card>

      <Card class="p-0 overflow-hidden">
        {isLoading && <div class="p-4 space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} class="h-12 w-full" />)}</div>}
        {!isLoading && visitors.length === 0 && (
          <div class="p-8"><EmptyState icon={<Users size={24} />} title="Nenhum visitante encontrado" description={searchDebounced ? 'Tente outra busca.' : 'Quando alguém visitar uma página com bt.js instalado, aparece aqui.'} /></div>
        )}
        {!isLoading && visitors.length > 0 && (
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="text-[0.6875rem] uppercase tracking-wider text-fg-subtle border-b border-border">
                  <th class="text-left px-3 py-2 font-medium">Visitante</th>
                  <th class="text-left px-3 py-2 font-medium">Email</th>
                  <th class="text-left px-3 py-2 font-medium">Telefone</th>
                  <th class="text-center px-3 py-2 font-medium">Sessões</th>
                  <th class="text-center px-3 py-2 font-medium">Pageviews</th>
                  <th class="text-center px-3 py-2 font-medium">Eventos</th>
                  <th class="text-left px-3 py-2 font-medium">Primeiro acesso</th>
                  <th class="text-left px-3 py-2 font-medium">Último acesso</th>
                  <th class="text-center px-3 py-2 font-medium">Lead</th>
                  <th class="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-border">
                {visitors.map((v) => {
                  const meta = v.metadata
                  const isIdentified = !!(v.identifiedEmail ?? v.identifiedPhone)
                  const name = v.identifiedName ?? v.visitorId.slice(0, 16)
                  return (
                    <tr key={v.id}>
                      <td class="px-3 py-2 min-w-0">
                        <div class="flex min-w-0 flex-wrap items-center gap-2">
                          <span class={cn('size-2 rounded-full shrink-0', isIdentified ? 'bg-success' : 'bg-surface-3')} />
                          <div class="min-w-0">
                            <div class="text-fg font-medium truncate">{name}</div>
                            <div class="text-[0.625rem] text-fg-subtle truncate">
                              {[metaGet(meta, 'browser'), metaGet(meta, 'os'), metaGet(meta, 'deviceType')].filter(Boolean).join(' · ') || '—'}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td class="px-3 py-2 text-fg-muted text-xs break-words max-w-56">{v.identifiedEmail ?? '—'}</td>
                      <td class="px-3 py-2 text-fg-muted text-xs whitespace-nowrap">{v.identifiedPhone ?? '—'}</td>
                      <td class="px-3 py-2 text-center tabular-nums font-medium">{v.totalSessions}</td>
                      <td class="px-3 py-2 text-center tabular-nums font-medium">{v.totalPageviews}</td>
                      <td class="px-3 py-2 text-center tabular-nums font-medium">{v.totalEvents ?? 0}</td>
                      <td class="px-3 py-2 text-fg-muted text-xs whitespace-nowrap">
                        {new Date(v.firstSeenAt).toLocaleDateString('pt-BR')}{' '}
                        {new Date(v.firstSeenAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td class="px-3 py-2 text-fg-muted text-xs whitespace-nowrap">{formatRelative(v.lastSeenAt)}</td>
                      <td class="px-3 py-2 text-center">
                        {v.leadId ? <Badge tone="success">#{v.leadId}</Badge> : <span class="text-fg-subtle text-xs">—</span>}
                      </td>
                      <td class="px-3 py-2 text-right">
                        <Button variant="secondary" size="sm" onClick={() => setDetailId(v.id)}>Detalhes</Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {totalPages > 1 && (
        <div class="flex items-center justify-center gap-2 text-xs">
          <Button variant="secondary" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
            Anterior
          </Button>
          <span class="text-fg-muted">Página {page} de {totalPages}</span>
          <Button variant="secondary" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
            Próxima
          </Button>
        </div>
      )}

      {detailId !== null && <VisitorDetailModal id={detailId} onClose={() => setDetailId(null)} />}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Visitor detail modal

function VisitorDetailModal({ id, onClose }: { id: number; onClose: () => void }) {
  const { data: visitor, isLoading } = useTrackingVisitor(id)
  const { data: timelineData, isLoading: timelineLoading } = useTrackingTimeline(id, 200)
  const [linkOpen, setLinkOpen] = useState(false)

  const headerTitle = visitor
    ? (visitor.identifiedName ?? visitor.identifiedEmail ?? `Visitante ${visitor.visitorId.slice(0, 16)}…`)
    : 'Visitante'
  const headerDesc = visitor
    ? [visitor.identifiedEmail, visitor.identifiedPhone].filter(Boolean).join(' · ') || undefined
    : undefined

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={headerTitle}
      description={headerDesc}
      size="xl"
      footer={<Button variant="secondary" size="sm" onClick={onClose}>Fechar</Button>}
    >
      {isLoading && <Skeleton class="h-64 w-full" />}
      {visitor && (
        <div class="space-y-4">
          {visitor.leadId && (
            <div class="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-xs text-success flex items-center gap-2">
              <UserCheck size={14} /> Vinculado ao Lead <strong>#{visitor.leadId}</strong>
            </div>
          )}

          <VisitorStats visitor={visitor} />
          <DeviceInfo visitor={visitor} />

          {!visitor.leadId && (
            <div>
              <Button variant="primary" size="sm" onClick={() => setLinkOpen(true)}>
                <LinkIcon size={12} /> Vincular a um Lead
              </Button>
            </div>
          )}

          <SessionsList visitor={visitor} />
          <TimelineSection events={timelineData?.events ?? []} loading={timelineLoading} />
        </div>
      )}
      {linkOpen && visitor && (
        <LinkVisitorModal visitorId={visitor.id} onClose={() => setLinkOpen(false)} />
      )}
    </Modal>
  )
}

function VisitorStats({ visitor }: { visitor: TrackingVisitor }) {
  const stats = [
    { label: 'Sessões', value: String(visitor.totalSessions) },
    { label: 'Pageviews', value: String(visitor.totalPageviews) },
    { label: 'Eventos', value: String(visitor.totalEvents ?? 0) },
    { label: 'Primeiro acesso', value: new Date(visitor.firstSeenAt).toLocaleDateString('pt-BR') },
  ]
  return (
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {stats.map((s) => (
        <div key={s.label} class="bg-surface-3 rounded-md p-3 text-center">
          <div class="text-xl font-bold text-fg tabular-nums">{s.value}</div>
          <div class="text-[0.6875rem] text-fg-muted uppercase tracking-wider mt-0.5">{s.label}</div>
        </div>
      ))}
    </div>
  )
}

function DeviceInfo({ visitor }: { visitor: TrackingVisitor }) {
  const meta = visitor.metadata
  const browser = metaGet(meta, 'browser')
  const os = metaGet(meta, 'os')
  const device = metaGet(meta, 'deviceType') ?? 'desktop'
  const sw = metaGet(meta, 'screenWidth')
  const sh = metaGet(meta, 'screenHeight')
  const lang = metaGet(meta, 'language')
  const screen = sw && sh ? `${sw}x${sh}` : undefined

  return (
    <div class="rounded-md bg-surface-3 px-4 py-3 text-xs text-fg-muted">
      <strong class="text-fg">Dispositivo:</strong>{' '}
      {[browser ?? '?', os ?? '?', device, screen ?? '?', lang ?? '?'].filter(Boolean).join(' · ')}
      <div class="text-[0.625rem] text-fg-subtle mt-1 font-mono">Visitor ID: {visitor.visitorId}</div>
    </div>
  )
}

interface SessionRow {
  id: number
  sessionId: string
  entryUrl: string | null
  referrer: string | null
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
  pageviews: number
  events: number
  duration: number | null
  startedAt: string
  deviceType: string | null
  browser: string | null
}

function SessionsList({ visitor }: { visitor: TrackingVisitor & { sessions?: unknown[] } }) {
  const sessions = ((visitor.sessions ?? []) as SessionRow[]).slice(0, 20)
  if (sessions.length === 0) return null

  return (
    <div>
      <div class="text-xs uppercase tracking-wider text-fg-subtle font-medium mb-2">Sessões ({sessions.length})</div>
      <ul class="space-y-2">
        {sessions.map((s) => {
          const utm = [s.utmSource, s.utmMedium, s.utmCampaign].filter(Boolean).join(' / ')
          const duration = s.duration ? `${Math.round(s.duration / 60)}min` : '—'
          return (
            <li key={s.id} class="bg-surface border border-border rounded-md px-3 py-2 text-xs">
              <div class="flex items-center justify-between gap-3 mb-1.5 flex-wrap">
                <span class="font-medium text-fg">{formatDateTime(s.startedAt)}</span>
                <span class="text-fg-muted">
                  {duration} · {s.pageviews} pgs · {s.events} evts
                </span>
              </div>
              {s.entryUrl && (
                <div class="text-fg-muted truncate">
                  <span class="text-fg-subtle">Entrada:</span> {s.entryUrl}
                </div>
              )}
              {s.referrer && (
                <div class="text-fg-muted truncate">
                  <span class="text-fg-subtle">Referrer:</span> {s.referrer}
                </div>
              )}
              {utm && (
                <div class="text-info truncate">
                  <span class="text-fg-subtle">UTM:</span> {utm}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

const EVENT_META: Record<string, { tone: 'info' | 'success' | 'warning' | 'danger' | 'neutral'; icon: preact.ComponentChildren }> = {
  pageview: { tone: 'info', icon: <Eye size={12} /> },
  click: { tone: 'warning', icon: <MousePointer2 size={12} /> },
  scroll: { tone: 'neutral', icon: <ArrowDownWideNarrow size={12} /> },
  form_start: { tone: 'success', icon: <FileText size={12} /> },
  form_submit: { tone: 'success', icon: <ClipboardCheck size={12} /> },
  identify: { tone: 'danger', icon: <CircleUser size={12} /> },
  custom: { tone: 'neutral', icon: <Zap size={12} /> },
  web_vital: { tone: 'info', icon: <Gauge size={12} /> },
}

function eventDetail(e: TrackingEvent): string {
  const d = e.data ?? {}
  const get = (k: string) => (typeof d[k] === 'string' || typeof d[k] === 'number' ? String(d[k]) : undefined)
  if (e.type === 'pageview') return e.title ?? ''
  if (e.type === 'click') return get('text') ?? get('selector') ?? ''
  if (e.type === 'scroll') return `${get('scroll_depth') ?? '?'}%`
  if (e.type === 'web_vital') return `${get('metric') ?? '?'}: ${get('value') ?? '?'}`
  if (e.type === 'identify') return get('email') ?? get('phone') ?? ''
  if (e.type === 'custom') return get('eventName') ?? ''
  if (e.type === 'form_start' || e.type === 'form_submit') return get('id') ?? get('action') ?? ''
  try { return JSON.stringify(d).slice(0, 80) } catch { return '' }
}

function shortPath(url: string | null): string {
  if (!url) return ''
  try { return new URL(url).pathname } catch { return url }
}

function TimelineSection({ events, loading }: { events: TrackingEvent[]; loading: boolean }) {
  return (
    <div>
      <div class="text-xs uppercase tracking-wider text-fg-subtle font-medium mb-2">Timeline de Eventos ({events.length})</div>
      {loading ? (
        <Skeleton class="h-32 w-full" />
      ) : events.length === 0 ? (
        <div class="text-xs text-fg-muted py-3 text-center bg-surface border border-border rounded-md">Sem eventos.</div>
      ) : (
        <ul class="divide-y divide-border bg-surface rounded-md border border-border max-h-96 overflow-y-auto">
          {events.map((e) => {
            const meta = EVENT_META[e.type] ?? EVENT_META.custom!
            const detail = eventDetail(e)
            const path = shortPath(e.url)
            return (
              <li key={e.id} class="px-3 py-2 text-xs flex items-start gap-3">
                <span class={cn(
                  'inline-flex items-center justify-center size-6 rounded-full shrink-0 mt-0.5',
                  meta.tone === 'info' && 'bg-info/15 text-info',
                  meta.tone === 'success' && 'bg-success/15 text-success',
                  meta.tone === 'warning' && 'bg-warning/15 text-warning',
                  meta.tone === 'danger' && 'bg-danger/15 text-danger',
                  meta.tone === 'neutral' && 'bg-surface-3 text-fg-muted',
                )}>
                  {meta.icon}
                </span>
                <div class="flex-1 min-w-0">
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <span class="font-medium text-fg capitalize">{e.type.replace(/_/g, ' ')}</span>
                    <span class="text-[0.625rem] text-fg-subtle whitespace-nowrap">
                      {new Date(e.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                  </div>
                  {detail && <div class="text-fg-muted truncate mt-0.5">{detail}</div>}
                  {path && <div class="text-fg-subtle text-[0.625rem] truncate mt-0.5">{path}</div>}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function LinkVisitorModal({ visitorId, onClose }: { visitorId: number; onClose: () => void }) {
  const [leadIdRaw, setLeadIdRaw] = useState('')
  const link = useLinkVisitor()

  function handleSubmit() {
    const leadId = parseInt(leadIdRaw, 10)
    if (!leadId || isNaN(leadId)) {
      toast('Informe um ID de lead válido', 'danger')
      return
    }
    link.mutate({ visitorId, leadId }, {
      onSuccess: () => { toast('Visitante vinculado ao lead com sucesso!', 'success'); onClose() },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Vincular visitante a um Lead"
      description="A navegação anônima passa a aparecer no histórico do lead."
      size="md"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={link.isPending}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={link.isPending}>
            {link.isPending ? 'Vinculando…' : 'Vincular'}
          </Button>
        </>
      }
    >
      <Input
        type="number"
        label="ID do Lead"
        value={leadIdRaw}
        onInput={(e) => setLeadIdRaw((e.target as HTMLInputElement).value)}
        placeholder="Ex: 123"
      />
    </Modal>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Pages tab — lista das páginas mais acessadas + verificação de tracking ativo

function PagesTab({ period }: { period: PeriodRange }) {
  const { data, isLoading } = useTrackingStats(period)
  const validate = useValidateTrackingPages()
  const [results, setResults] = useState<Record<string, PageValidationResult> | null>(null)
  const pages = data?.topPages ?? []
  const maxViews = pages[0]?.views ?? 1

  function handleValidate() {
    const urls = pages
      .map((p) => p.url)
      .filter((u): u is string => {
        try { return new URL(u).protocol.startsWith('http') } catch { return false }
      })
    if (urls.length === 0) return
    validate.mutate(urls, {
      onSuccess: (r) => setResults(r.results),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  let activeCount = 0
  let inactiveCount = 0
  if (results) {
    for (const url of Object.keys(results)) {
      if (results[url]?.hasTracking) activeCount++
      else inactiveCount++
    }
  }

  return (
    <section class="mt-4">
      <Card>
        <div class="flex items-center justify-between gap-3 flex-wrap mb-3">
          <CardHeader class="p-0">
            <CardTitle>Páginas com tracking ({periodLabel(period)})</CardTitle>
          </CardHeader>
          <Button size="sm" variant="secondary" onClick={handleValidate} disabled={validate.isPending || pages.length === 0}>
            <Check size={12} /> {validate.isPending ? 'Verificando…' : 'Verificar tracking ativo'}
          </Button>
        </div>

        {results && inactiveCount > 0 && (
          <div class="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning mb-3">
            <strong>{inactiveCount} página(s) sem tracking ativo.</strong> O script <code>bt.js</code> não foi
            encontrado nessas páginas. Dados antigos ainda aparecem, mas novos acessos não serão registrados.
          </div>
        )}
        {results && inactiveCount === 0 && activeCount > 0 && (
          <div class="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-xs text-success mb-3">
            Todas as {activeCount} páginas possuem tracking ativo.
          </div>
        )}

        {isLoading && <Skeleton class="h-40 w-full" />}
        {!isLoading && pages.length === 0 && (
          <EmptyState
            icon={<FileText size={20} />}
            title="Sem pageviews"
            description="Instale o snippet bt.js nas suas páginas para coletar dados."
          />
        )}

        {!isLoading && pages.length > 0 && (
          <div class="overflow-x-auto -mx-2">
            <table class="w-full text-sm">
              <thead>
                <tr class="text-[0.6875rem] uppercase tracking-wider text-fg-subtle border-b border-border">
                  <th class="text-left px-2 py-2 font-medium">#</th>
                  <th class="text-left px-2 py-2 font-medium">Página</th>
                  <th class="text-right px-2 py-2 font-medium">Visualizações</th>
                  <th class="text-right px-2 py-2 font-medium">Visitantes</th>
                  <th class="text-left px-2 py-2 font-medium">Último acesso</th>
                  <th class="text-center px-2 py-2 font-medium">Rastreamento</th>
                  <th class="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-border">
                {pages.map((p, i) => {
                  const pct = Math.max(2, Math.round((p.views / maxViews) * 100))
                  let shortUrl = p.url
                  try { shortUrl = new URL(p.url).pathname || '/' } catch { /* keep raw */ }
                  const r = results?.[p.url]
                  const status: 'unknown' | 'active' | 'inactive' = r === undefined
                    ? 'unknown'
                    : r.hasTracking ? 'active' : 'inactive'
                  return (
                    <tr key={p.url} class={status === 'inactive' ? 'opacity-60' : ''}>
                      <td class="px-2 py-2 text-fg-subtle tabular-nums">{i + 1}</td>
                      <td class="px-2 py-2 min-w-0">
                        <a href={p.url} target="_blank" rel="noreferrer" class="text-accent hover:underline truncate block max-w-[20rem]">
                          {shortUrl}
                        </a>
                        <div class="text-[0.6875rem] text-fg-subtle truncate max-w-[20rem]">{p.url}</div>
                      </td>
                      <td class="px-2 py-2 text-right tabular-nums font-semibold">{p.views.toLocaleString('pt-BR')}</td>
                      <td class="px-2 py-2 text-right tabular-nums text-fg-muted">{(p.visitors ?? 0).toLocaleString('pt-BR')}</td>
                      <td class="px-2 py-2 text-fg-muted text-xs">
                        {p.lastSeen ? new Date(p.lastSeen).toLocaleDateString('pt-BR') : '—'}
                      </td>
                      <td class="px-2 py-2 text-center">
                        {status === 'unknown' && <span class="text-[0.6875rem] text-fg-subtle">—</span>}
                        {status === 'active' && <Badge tone="success">Ativo</Badge>}
                        {status === 'inactive' && <Badge tone="danger">Sem tracking</Badge>}
                      </td>
                      <td class="px-2 py-2 w-32">
                        <div class="h-1.5 rounded-full bg-surface-3 overflow-hidden">
                          <div class="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Validate tab — aba dedicada (espelha legado)

function ValidateTab({ seedUrl, clearSeed }: { seedUrl: string | null; clearSeed: () => void }) {
  const [url, setUrl] = useState(seedUrl ?? '')
  const [result, setResult] = useState<UrlValidationResult | null>(null)
  const validate = useValidateTrackingUrl()

  function handleValidate(target?: string) {
    const u = (target ?? url).trim()
    if (!u) { toast('Informe uma URL', 'danger'); return }
    setResult(null)
    validate.mutate(u, {
      onSuccess: (r) => setResult(r),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  useEffect(() => {
    if (seedUrl) {
      setUrl(seedUrl)
      handleValidate(seedUrl)
      clearSeed()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedUrl])

  const allGood = !!(result?.hasTrackingScript && result.errors.length === 0)
  const hasErrors = !!(result && result.errors.length > 0)
  const statusTone: 'success' | 'warning' | 'danger' = allGood ? 'success' : hasErrors ? 'danger' : 'warning'
  const statusTitle = allGood ? 'Tracking instalado corretamente!' : hasErrors ? 'Problemas encontrados' : 'Instalação parcial'
  const StatusIcon = allGood ? Check : hasErrors ? X : AlertTriangle

  return (
    <section class="mt-4 max-w-3xl">
      <Card>
        <div class="mb-4">
          <h3 class="text-base font-semibold text-fg">Validar Tracking em URL</h3>
          <p class="text-xs text-fg-muted mt-1">
            Insira a URL de uma página para verificar se o código de tracking Beyond (bt.js) está instalado corretamente.
          </p>
        </div>
        <div class="flex gap-2 items-stretch flex-wrap">
          <Input
            type="url"
            value={url}
            onInput={(e) => setUrl((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => { if ((e as KeyboardEvent).key === 'Enter') handleValidate() }}
            placeholder="https://seusite.com.br/pagina"
            class="flex-1 min-w-56"
          />
          <Button variant="primary" size="sm" onClick={() => handleValidate()} disabled={validate.isPending}>
            {validate.isPending ? 'Verificando…' : 'Validar'}
          </Button>
        </div>

        {validate.isPending && (
          <div class="mt-4">
            <Skeleton class="h-32 w-full" />
          </div>
        )}

        {result && (
          <div class="mt-4 space-y-4">
            <div class={cn(
              'rounded-md border p-4 flex items-center gap-3',
              statusTone === 'success' && 'border-success/40 bg-success/10',
              statusTone === 'warning' && 'border-warning/40 bg-warning/10',
              statusTone === 'danger' && 'border-danger/40 bg-danger/10',
            )}>
              <span class={cn(
                'inline-flex items-center justify-center size-10 rounded-full shrink-0',
                statusTone === 'success' && 'bg-success/20 text-success',
                statusTone === 'warning' && 'bg-warning/20 text-warning',
                statusTone === 'danger' && 'bg-danger/20 text-danger',
              )}>
                <StatusIcon size={20} />
              </span>
              <div class="min-w-0">
                <div class={cn(
                  'text-sm font-semibold',
                  statusTone === 'success' && 'text-success',
                  statusTone === 'warning' && 'text-warning',
                  statusTone === 'danger' && 'text-danger',
                )}>{statusTitle}</div>
                <div class="text-xs text-fg-muted truncate">{result.url}</div>
              </div>
            </div>

            <div class="rounded-md bg-surface-3 p-4">
              <div class="text-xs font-semibold text-fg uppercase tracking-wider mb-3">Checklist de verificação</div>
              <div class="divide-y divide-border">
                <ChecklistItem ok={result.valid} required label="Página acessível" />
                <ChecklistItem ok={result.hasTrackingScript} required label="Script bt.js encontrado no HTML" />
                <ChecklistItem ok={result.hasSnippetLoader} required={false} label="Snippet loader (sites externos)" />
                <ChecklistItem ok={result.hasBTObject} required={false} label="Objeto BT referenciado" />
              </div>
            </div>

            {result.scriptSrc && (
              <div class="rounded-md bg-surface-3 px-3 py-2 text-xs">
                <strong class="text-fg">Script src:</strong>{' '}
                <code class="font-mono bg-surface px-1.5 py-0.5 rounded text-fg-muted break-all">{result.scriptSrc}</code>
              </div>
            )}

            <div class="grid grid-cols-2 gap-3">
              <div class="rounded-md bg-surface-3 p-4 text-center">
                <div class="text-2xl font-bold text-accent tabular-nums">{result.recentPageviews24h ?? 0}</div>
                <div class="text-[0.6875rem] text-fg-muted mt-1">Pageviews últimas 24h</div>
              </div>
              <div class="rounded-md bg-surface-3 p-4 text-center">
                <div class="text-2xl font-bold text-success tabular-nums">{result.totalSessions ?? 0}</div>
                <div class="text-[0.6875rem] text-fg-muted mt-1">Sessões totais</div>
              </div>
            </div>

            {result.errors.length > 0 && (
              <div class="rounded-md border border-danger/30 bg-danger/10 p-3">
                <div class="text-xs font-semibold text-danger mb-1.5">Erros</div>
                <ul class="space-y-0.5">
                  {result.errors.map((e, i) => <li key={i} class="text-xs text-danger">• {e}</li>)}
                </ul>
              </div>
            )}

            {result.warnings.length > 0 && (
              <div class="rounded-md border border-warning/30 bg-warning/10 p-3">
                <div class="text-xs font-semibold text-warning mb-1.5">Avisos</div>
                <ul class="space-y-0.5">
                  {result.warnings.map((w, i) => <li key={i} class="text-xs text-warning">• {w}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </Card>
    </section>
  )
}

function ChecklistItem({ ok, required, label }: { ok: boolean; required: boolean; label: string }) {
  const tone: 'success' | 'danger' | 'neutral' = ok ? 'success' : required ? 'danger' : 'neutral'
  const Icon = ok ? Check : required ? X : Minus
  return (
    <div class="flex items-center gap-2 py-2">
      <span class={cn(
        'inline-flex items-center justify-center size-5 rounded-full shrink-0',
        tone === 'success' && 'bg-success/20 text-success',
        tone === 'danger' && 'bg-danger/20 text-danger',
        tone === 'neutral' && 'bg-surface text-fg-subtle',
      )}>
        <Icon size={12} />
      </span>
      <span class={cn(
        'text-xs',
        tone === 'success' && 'text-success font-medium',
        tone === 'danger' && 'text-danger font-medium',
        tone === 'neutral' && 'text-fg-subtle',
      )}>
        {label}
        {!ok && !required && <span class="text-fg-subtle font-normal ml-1">(opcional)</span>}
      </span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Sites monitored tab

function SitesTab({ onValidate }: { onValidate: (url: string) => void }) {
  const { data, isLoading } = useMonitoredUrls()
  const urls = data?.urls ?? []

  return (
    <section class="mt-4">
      <Card>
        <CardHeader>
          <CardTitle>Sites monitorados (últimos 30 dias)</CardTitle>
          <span class="text-xs text-fg-subtle">{urls.length} domínio{urls.length !== 1 ? 's' : ''}</span>
        </CardHeader>

        {isLoading && <Skeleton class="h-32 w-full" />}

        {!isLoading && urls.length === 0 && (
          <EmptyState
            icon={<MapPin size={20} />}
            title="Nenhum site monitorado ainda"
            description="Instale o código de tracking em seus sites e os dados aparecerão aqui."
          />
        )}

        {!isLoading && urls.length > 0 && (
          <div class="overflow-x-auto -mx-2">
            <table class="w-full text-sm">
              <thead>
                <tr class="text-[0.6875rem] uppercase tracking-wider text-fg-subtle border-b border-border">
                  <th class="text-left px-2 py-2 font-medium">Domínio</th>
                  <th class="text-right px-2 py-2 font-medium">Pageviews</th>
                  <th class="text-right px-2 py-2 font-medium">Visitantes</th>
                  <th class="text-left px-2 py-2 font-medium">Último acesso</th>
                  <th class="text-center px-2 py-2 font-medium">Ações</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-border">
                {urls.map((u) => (
                  <tr key={u.domain}>
                    <td class="px-2 py-2">
                      <span class="inline-flex items-center gap-2">
                        <span class="size-2 rounded-full bg-success" />
                        <strong class="text-fg break-words">{u.domain}</strong>
                      </span>
                    </td>
                    <td class="px-2 py-2 text-right tabular-nums font-semibold">{u.pageviews.toLocaleString('pt-BR')}</td>
                    <td class="px-2 py-2 text-right tabular-nums text-fg-muted">{u.visitors.toLocaleString('pt-BR')}</td>
                    <td class="px-2 py-2 text-fg-muted text-xs">{formatRelative(u.lastSeen)}</td>
                    <td class="px-2 py-2">
                      <div class="flex items-center justify-center gap-1.5">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => onValidate(`https://${u.domain}`)}
                        >
                          <Check size={12} /> Validar
                        </Button>
                        <a
                          href={`https://${u.domain}`}
                          target="_blank"
                          rel="noreferrer"
                          class="inline-flex items-center gap-1 px-2 h-8 text-xs text-accent hover:underline"
                        >
                          Abrir <ExternalLink size={10} />
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Installation modal — disparado pelo botão "Código de Instalação" no header

const COLLECTS_LIST: { label: string; desc: string }[] = [
  { label: 'Pageviews', desc: 'cada página visitada com título e URL' },
  { label: 'Cliques', desc: 'em links, botões e elementos interativos' },
  { label: 'Scroll depth', desc: 'até onde o visitante rolou (25%, 50%, 75%, 100%)' },
  { label: 'Formulários', desc: 'quando começou a preencher e quando submeteu' },
  { label: 'Web Vitals', desc: 'LCP, FID, CLS (métricas de performance)' },
  { label: 'Navegação SPA', desc: 'detecta mudanças de rota automaticamente' },
  { label: 'UTM params', desc: 'captura utm_source, utm_medium, utm_campaign, etc.' },
  { label: 'Device info', desc: 'browser, OS, resolução, tipo de dispositivo' },
  { label: 'Fingerprint', desc: 'identificação anônima via Canvas + WebGL' },
  { label: 'Tempo na página', desc: 'duração da sessão e tempo por página' },
]

const IDENTIFY_SNIPPET = `BT.identify({
  email: 'contato@empresa.com',
  phone: '62999999999',
  name: 'Nome do Contato'
});`

const TRACK_SNIPPET = `BT.track('cta_clicked', { button: 'Solicitar Orçamento', page: 'pricing' });`

function InstallationModal({ onClose }: { onClose: () => void }) {
  const { data, isLoading } = useTrackingSnippet()
  const [copied, setCopied] = useState(false)

  function copySnippet() {
    if (!data) return
    void navigator.clipboard.writeText(data.snippet).then(() => {
      setCopied(true)
      toast('Snippet copiado', 'success')
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => toast('Não foi possível copiar', 'danger'))
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Código de Instalação — Beyond Tracking"
      description="Adicione este código antes do </head> em todas as páginas que deseja monitorar."
      size="xl"
      footer={<Button variant="secondary" size="sm" onClick={onClose}>Fechar</Button>}
    >
      <div class="space-y-4">
        {isLoading ? (
          <Skeleton class="h-32 w-full" />
        ) : data ? (
          <div class="relative">
            <pre class="text-[0.6875rem] font-mono text-fg-muted bg-surface-3 border border-border rounded-md p-4 pr-24 overflow-auto whitespace-pre-wrap break-all max-h-72">
              {data.snippet}
            </pre>
            <Button
              variant="primary"
              size="sm"
              class="absolute top-2 right-2"
              onClick={copySnippet}
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? 'Copiado' : 'Copiar'}
            </Button>
          </div>
        ) : null}

        <div class="rounded-md border border-info/30 bg-info/10 p-4">
          <div class="text-sm font-semibold text-info mb-2 inline-flex items-center gap-2">
            <Activity size={14} /> O que o script coleta automaticamente
          </div>
          <ul class="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs text-fg leading-relaxed">
            {COLLECTS_LIST.map((c) => (
              <li key={c.label} class="flex gap-1.5">
                <span class="text-info shrink-0 mt-0.5">•</span>
                <span><strong>{c.label}</strong> — {c.desc}</span>
              </li>
            ))}
          </ul>
        </div>

        <div class="rounded-md bg-surface-3 p-4">
          <div class="text-sm font-semibold text-fg mb-2 inline-flex items-center gap-2">
            <CircleUser size={14} /> Identificar visitante (opcional)
          </div>
          <p class="text-xs text-fg-muted mb-2">
            Quando o visitante preencher um formulário ou se identificar, chame:
          </p>
          <pre class="text-[0.6875rem] font-mono text-fg-muted bg-surface border border-border rounded-md p-3 overflow-auto">{IDENTIFY_SNIPPET}</pre>
          <p class="text-[0.6875rem] text-fg-subtle mt-2">
            Isso vincula automaticamente o histórico anônimo ao lead quando ele entrar no sistema.
          </p>
        </div>

        <div class="rounded-md bg-surface-3 p-4">
          <div class="text-sm font-semibold text-fg mb-2 inline-flex items-center gap-2">
            <Zap size={14} /> Eventos customizados (opcional)
          </div>
          <p class="text-xs text-fg-muted mb-2">
            Dispare eventos custom em qualquer ponto do código:
          </p>
          <pre class="text-[0.6875rem] font-mono text-fg-muted bg-surface border border-border rounded-md p-3 overflow-auto">{TRACK_SNIPPET}</pre>
        </div>

        <div class="text-[0.6875rem] text-fg-subtle text-center">
          <Globe size={10} class="inline-block mr-1" /> Suporta sites externos via snippet loader.
        </div>
      </div>
    </Modal>
  )
}
