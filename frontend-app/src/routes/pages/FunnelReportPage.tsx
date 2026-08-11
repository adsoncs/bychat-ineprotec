// Relatório de Funil — view dedicada em Meus Painéis (grupo Relatórios).
// Estilo dark/OLED tecnológico (skill ui-ux-pro-max) + microinterações com
// Motion (count-up, reveal em stagger, draw de sparkline). Preact → usa a API
// vanilla `animate`/`inView` do Motion (sem dependência de React).
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { animate, inView } from 'motion'
import { useLocation } from 'wouter-preact'
import {
  Workflow, TrendingUp, TrendingDown, Minus, Wallet, Users, Target,
  CalendarCheck, Handshake, Trophy, DollarSign, RefreshCw, Settings2, AlertTriangle,
} from 'lucide-preact'
import { useAuth } from '@/hooks/useAuth'
import { presetRange, presetLabel, type RangePreset } from '@/components/ui/PeriodPicker'
import { useFunnelReport, type Kpi, type FunnelStage, type BreakdownRow, type DailyRow } from '@/hooks/useFunnelReport'

// ── formatação pt-BR ─────────────────────────────────────────────
const moneyFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const intFmt = new Intl.NumberFormat('pt-BR')
const fmtMoney = (n: number) => moneyFmt.format(n || 0)
const fmtInt = (n: number) => intFmt.format(Math.round(n || 0))
const fmtPct = (n: number | null) => (n === null ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(1)}%`)
const reduceMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

function today() { return new Date().toISOString().slice(0, 10) }
function isoAgo(days: number) { return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10) }
function monthStart(offset = 0) { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + offset); return d.toISOString().slice(0, 10) }
function monthEnd(offset = 0) { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + offset + 1); d.setDate(0); return d.toISOString().slice(0, 10) }

// ── count-up animado (Motion) ────────────────────────────────────
function useCountUp(target: number, deps: unknown[]) {
  const [val, setVal] = useState(target)
  useEffect(() => {
    if (reduceMotion()) { setVal(target); return }
    const controls = animate(0, target, { duration: 0.9, ease: [0.16, 1, 0.3, 1], onUpdate: (v) => setVal(v) })
    return () => controls.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return val
}

// reveal em stagger ao entrar na viewport
function useReveal() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const items = Array.from(el.querySelectorAll<HTMLElement>('[data-reveal]'))
    if (reduceMotion()) { items.forEach((i) => { i.style.opacity = '1'; i.style.transform = 'none' }); return }
    items.forEach((i) => { i.style.opacity = '0'; i.style.transform = 'translateY(12px)' })
    return inView(el, () => {
      items.forEach((i, idx) => animate(i, { opacity: 1, transform: 'translateY(0px)' }, { duration: 0.5, delay: idx * 0.05, ease: [0.16, 1, 0.3, 1] }))
    }, { amount: 0.1 })
  }, [])
  return ref
}

function DeltaBadge({ d }: { d: number | null }) {
  if (d === null) return <span class="text-[0.6875rem] font-medium text-fg-subtle">N/A</span>
  const up = d > 0, flat = d === 0
  const Icon = flat ? Minus : up ? TrendingUp : TrendingDown
  const cls = flat ? 'text-fg-subtle' : up ? 'text-success' : 'text-danger'
  return <span class={`inline-flex items-center gap-0.5 text-[0.6875rem] font-semibold tabular-nums ${cls}`}><Icon size={11} />{fmtPct(d)}</span>
}

const KPI_ICONS: Record<string, typeof Wallet> = { investimento: Wallet, mql: Users, sql: Target, ra: CalendarCheck, rr: Handshake, fechamento: Trophy, faturamento: DollarSign }

function KpiCard({ k, label, kpiKey }: { k: Kpi; label: string; kpiKey: string }) {
  // value null = KPI sem definição. Mostra "—" e o motivo, nunca 0: zero afirma
  // que não houve resultado, e o que existe é ausência de medição.
  const semDefinicao = k.value === null
  const v = useCountUp(k.value ?? 0, [k.value])
  const Icon = KPI_ICONS[kpiKey] ?? Target
  return (
    <div
      data-reveal
      class={`group relative overflow-hidden rounded-xl border p-4 transition-colors ${semDefinicao ? 'border-warning/40 bg-warning/5' : 'border-border bg-surface-2/60 hover:border-accent/50'}`}
      title={k.origem ?? undefined}
    >
      <div class="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/60 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
      <div class="flex items-center justify-between">
        <span class="text-[0.6875rem] font-medium uppercase tracking-wider text-fg-subtle">{label}</span>
        <Icon size={14} class={semDefinicao ? 'text-warning/70' : 'text-accent/70'} />
      </div>
      {semDefinicao ? (
        <>
          <div class="mt-2 font-mono text-2xl font-bold text-fg-subtle">—</div>
          <div class="mt-1 text-[0.625rem] leading-snug text-warning">não configurado</div>
        </>
      ) : (
        <>
          <div class="mt-2 font-mono text-2xl font-bold tabular-nums text-fg">{k.format === 'money' ? fmtMoney(v) : fmtInt(v)}</div>
          <div class="mt-1 flex items-center gap-2">
            <DeltaBadge d={k.deltaPct} />
          </div>
          {k.origem && (
            <div class="mt-1 truncate text-[0.625rem] text-fg-subtle" title={k.origem}>{k.origem}</div>
          )}
        </>
      )}
    </div>
  )
}

// ── sparkline SVG (com draw animado) ─────────────────────────────
function Sparkline({ data, accessor, color }: { data: DailyRow[]; accessor: (r: DailyRow) => number; color: string }) {
  const pathRef = useRef<SVGPathElement>(null)
  const W = 220, H = 56, P = 4
  const vals = data.map(accessor)
  const max = Math.max(1, ...vals), min = Math.min(0, ...vals)
  const span = max - min || 1
  const pts = vals.map((v, i) => {
    const x = P + (i / Math.max(1, vals.length - 1)) * (W - 2 * P)
    const y = H - P - ((v - min) / span) * (H - 2 * P)
    return [x, y] as const
  })
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
  const area = `${line} L${pts[pts.length - 1]?.[0].toFixed(1) ?? W - P},${H - P} L${P},${H - P} Z`
  useEffect(() => {
    const el = pathRef.current
    if (!el || reduceMotion()) return
    const len = el.getTotalLength()
    el.style.strokeDasharray = String(len); el.style.strokeDashoffset = String(len)
    const c = animate(len, 0, { duration: 1.1, ease: [0.16, 1, 0.3, 1], onUpdate: (v) => { el.style.strokeDashoffset = String(v) } })
    return () => c.stop()
  }, [line])
  const gid = useMemo(() => `sg-${Math.round(pts[0]?.[1] ?? 0)}-${color.replace(/[^a-z0-9]/gi, '')}`, [color])
  return (
    <svg viewBox={`0 0 ${W} ${H}`} class="h-14 w-full" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color={color} stop-opacity="0.28" />
          <stop offset="100%" stop-color={color} stop-opacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path ref={pathRef} d={line} fill="none" stroke={color} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
    </svg>
  )
}

// ── heatmap helper: alpha por intensidade ────────────────────────
function heat(v: number, max: number, rgb: string): string {
  if (!v || max <= 0) return 'transparent'
  const a = 0.1 + 0.55 * Math.min(1, v / max)
  return `rgba(${rgb}, ${a.toFixed(3)})`
}
const COL_RGB: Record<string, string> = { investimento: '37,99,235', cmql: '245,158,11', mql: '139,92,246', sql: '34,197,94', ra: '6,182,212', rr: '234,179,8', fechamento: '236,72,153', leads: '249,115,22' }

export function FunnelReportPage() {
  const [, navigate] = useLocation()
  const { user } = useAuth()
  const ehSuperadmin = user?.role === 'SUPERADMIN'
  const [from, setFrom] = useState(presetRange('m0').dateFrom)
  const [to, setTo] = useState(presetRange('m0').dateTo)
  const [funnelId, setFunnelId] = useState<number | undefined>(undefined)
  const { data, isLoading, isFetching, refetch } = useFunnelReport({ from, to, funnelId })
  const revealRef = useReveal()

  // Meses fechados, como no resto do sistema. Esta tela já tinha "Este mês" e
  // "Mês passado" à mão — agora a régua é a mesma de todas as outras.
  const presets = (['m0', 'm1', 'm2', 'm3', 'm4'] as RangePreset[]).map((p) => {
    const r = presetRange(p)
    return { label: presetLabel(p), from: r.dateFrom, to: r.dateTo }
  })

  const kpiOrder: { key: keyof NonNullable<typeof data>['kpis']; label: string }[] = [
    { key: 'investimento', label: 'Investimento' }, { key: 'mql', label: 'MQL' }, { key: 'sql', label: 'SQL' },
    { key: 'ra', label: 'RA' }, { key: 'rr', label: 'RR' }, { key: 'fechamento', label: 'Fechamento' }, { key: 'faturamento', label: 'Faturamento' },
  ]
  const sparkDefs: { key: keyof DailyRow; label: string; color: string }[] = [
    { key: 'investimento', label: 'Investimento', color: '#2563eb' }, { key: 'mql', label: 'MQL', color: '#8b5cf6' },
    { key: 'sql', label: 'SQL', color: '#22c55e' }, { key: 'ra', label: 'RA', color: '#06b6d4' },
    { key: 'rr', label: 'RR', color: '#eab308' }, { key: 'fechamento', label: 'Fechamento', color: '#ec4899' },
    { key: 'faturamento', label: 'Faturamento', color: '#34d399' },
  ]

  return (
    <div class="mx-auto max-w-[1400px] px-4 py-5 sm:px-6">
      {/* Header */}
      <div class="flex flex-col gap-4 border-b border-border pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div class="flex items-center gap-2 text-accent"><Workflow size={18} /><span class="text-[0.6875rem] font-semibold uppercase tracking-[0.2em] text-fg-subtle">Relatório</span></div>
          <h1 class="mt-1 font-mono text-2xl font-bold tracking-tight text-fg">Funil de Vendas</h1>
          {data && <p class="mt-1 text-sm text-fg-muted">{data.period.from.split('-').reverse().join('/')} — {data.period.to.split('-').reverse().join('/')} · vs. período anterior</p>}
        </div>
        <div class="flex flex-wrap items-end gap-2">
          <select
            value={funnelId ?? (data?.funnelId ?? '')}
            onChange={(e) => setFunnelId(parseInt((e.target as HTMLSelectElement).value) || undefined)}
            class="h-9 rounded-lg border border-border bg-surface-2 px-3 text-sm text-fg focus:border-accent focus:outline-none"
          >
            {(data?.funnels ?? []).map((f) => <option value={f.id}>{f.name}</option>)}
          </select>
          <input type="date" value={from} onInput={(e) => setFrom((e.target as HTMLInputElement).value)} class="h-9 rounded-lg border border-border bg-surface-2 px-2.5 text-sm text-fg [color-scheme:dark] focus:border-accent focus:outline-none" />
          <input type="date" value={to} onInput={(e) => setTo((e.target as HTMLInputElement).value)} class="h-9 rounded-lg border border-border bg-surface-2 px-2.5 text-sm text-fg [color-scheme:dark] focus:border-accent focus:outline-none" />
          <button type="button" onClick={() => refetch()} class="grid h-9 w-9 place-items-center rounded-lg border border-border bg-surface-2 text-fg-muted transition-colors hover:border-accent/50 hover:text-fg" title="Atualizar" aria-label="Atualizar">
            <RefreshCw size={15} class={isFetching ? 'animate-spin' : ''} />
          </button>
          {/* Só superadmin: define o que a instalação chama de MQL, SQL, RA, RR. */}
          {ehSuperadmin && (
            <button
              type="button"
              onClick={() => navigate('/funnel-report/config')}
              class="grid h-9 w-9 place-items-center rounded-lg border border-border bg-surface-2 text-fg-muted transition-colors hover:border-accent/50 hover:text-fg"
              title="Configurar o que define cada KPI"
              aria-label="Configurar"
            >
              <Settings2 size={15} />
            </button>
          )}
        </div>
      </div>

      {/* presets */}
      <div class="mt-3 flex flex-wrap gap-1.5">
        {presets.map((p) => {
          const active = p.from === from && p.to === to
          return <button key={p.label} type="button" onClick={() => { setFrom(p.from); setTo(p.to) }} class={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${active ? 'border-accent bg-accent/15 text-accent' : 'border-border text-fg-muted hover:text-fg'}`}>{p.label}</button>
        })}
      </div>

      {isLoading && <div class="mt-8 grid place-items-center py-20 text-sm text-fg-muted"><RefreshCw size={20} class="mb-2 animate-spin text-accent" />Carregando relatório…</div>}

      {data && (
        <div ref={revealRef} class="mt-6 space-y-8">
          {/* Como o relatório foi apurado. Sem isto o número é opaco: quem lê não
              sabe se "RR = 0" é ausência de reunião ou ausência de configuração. */}
          <div class="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-border bg-surface-2/40 px-3 py-2 text-[0.6875rem] text-fg-muted">
            <span>
              Leads: <strong class="text-fg">{data.apuracao.escopo === 'pago' ? 'só campanha paga' : 'todos (inclui orgânicos)'}</strong>
            </span>
            <span>
              Contagem: <strong class="text-fg">{data.apuracao.contagem === 'passou' ? 'quem alcançou a etapa' : 'situação atual'}</strong>
            </span>
            {data.apuracao.taxasAcimaDe100?.length > 0 && (
              <span class="flex items-center gap-1.5 text-warning" title="A etapa seguinte tem mais leads que a anterior — as fontes configuradas medem grupos independentes, não subconjuntos.">
                <AlertTriangle size={12} />
                taxa acima de 100% em {data.apuracao.taxasAcimaDe100.map((t) => t.etapa).join(', ')} — as fontes
                configuradas não formam um funil encaixado
              </span>
            )}
            {data.apuracao.naoConfigurados.length > 0 && (
              <span class="flex items-center gap-1.5 text-warning">
                <AlertTriangle size={12} />
                {data.apuracao.naoConfigurados.length} KPI(s) sem definição:{' '}
                {data.apuracao.naoConfigurados.map((n) => n.label.split(' — ')[0]).join(', ')}
                {ehSuperadmin && (
                  <button type="button" class="underline hover:text-fg" onClick={() => navigate('/funnel-report/config')}>
                    configurar
                  </button>
                )}
              </span>
            )}
          </div>

          {/* KPIs */}
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
            {kpiOrder.map(({ key, label }) => <KpiCard key={key} kpiKey={key as string} label={label} k={data.kpis[key]} />)}
          </div>

          {/* Sparklines */}
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {sparkDefs.map((s) => (
              <div data-reveal key={s.key as string} class="rounded-xl border border-border bg-surface-2/40 p-3">
                <div class="mb-1 flex items-center gap-1.5"><span class="size-2 rounded-full" style={{ background: s.color }} /><span class="text-[0.625rem] font-medium uppercase tracking-wider text-fg-subtle">{s.label}</span></div>
                <Sparkline data={data.daily} accessor={(r) => Number(r[s.key] ?? 0)} color={s.color} />
              </div>
            ))}
          </div>

          {/* Funil em cascata */}
          <section data-reveal>
            <h2 class="mb-4 font-mono text-sm font-semibold uppercase tracking-wider text-fg-muted">Funil detalhado</h2>
            <FunnelCascade stages={data.funnel} extra={data.extraMetrics} />
          </section>

          {/* Heatmaps: dia da semana + diária */}
          <div class="grid gap-6 lg:grid-cols-2">
            <section data-reveal>
              <h2 class="mb-3 font-mono text-sm font-semibold uppercase tracking-wider text-fg-muted">Por dia da semana</h2>
              <WeekdayTable rows={data.byWeekday} />
            </section>
            <section data-reveal>
              <h2 class="mb-3 font-mono text-sm font-semibold uppercase tracking-wider text-fg-muted">Análise diária</h2>
              <DailyTable rows={[...data.daily].reverse()} />
            </section>
          </div>

          {/* Quebras */}
          <section data-reveal>
            <h2 class="mb-3 font-mono text-sm font-semibold uppercase tracking-wider text-fg-muted">Campanhas</h2>
            <BreakdownTable rows={data.campaigns} dim="Campanha" />
          </section>
          <section data-reveal>
            <h2 class="mb-3 font-mono text-sm font-semibold uppercase tracking-wider text-fg-muted">Conjunto de anúncios</h2>
            <BreakdownTable rows={data.adsets} dim="Conjunto" />
          </section>
        </div>
      )}
    </div>
  )
}

// ── Funil em cascata ─────────────────────────────────────────────
function FunnelCascade({ stages, extra }: { stages: FunnelStage[]; extra: { cpm: number; cpl: number | null; roas: number | null } }) {
  // Etapa não configurada não entra no cálculo da barra: um null virando 0
  // faria a maior etapa parecer menor do que é.
  const max = Math.max(1, ...stages.map((s) => s.value ?? 0))
  return (
    <div class="overflow-hidden rounded-xl border border-border bg-surface-2/40">
      {stages.map((s, i) => {
        const semDefinicao = s.value === null
        const pct = semDefinicao ? 0 : Math.max(2, ((s.value ?? 0) / max) * 100)
        return (
          <div key={s.key} class={`grid grid-cols-1 gap-2 px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-center ${i > 0 ? 'border-t border-border/60' : ''}`}>
            <div class="min-w-0">
              <div class="flex items-baseline justify-between gap-3">
                <span class="text-[0.6875rem] font-semibold uppercase tracking-wider text-fg-subtle" title={s.origem ?? undefined}>
                  {s.label}
                  {s.origem && <span class="ml-2 normal-case tracking-normal text-fg-subtle/70">· {s.origem}</span>}
                </span>
                <span class={`font-mono text-lg font-bold tabular-nums ${semDefinicao ? 'text-fg-subtle' : 'text-fg'}`}>
                  {semDefinicao ? '—' : fmtInt(s.value ?? 0)}
                </span>
              </div>
              <div class="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-3">
                <div class="h-full rounded-full bg-gradient-to-r from-accent to-info transition-[width] duration-700" style={{ width: `${pct}%` }} />
              </div>
            </div>
            <div class="flex items-center gap-4 sm:pl-6">
              {s.rate && <div class="text-right"><div class="text-[0.625rem] uppercase tracking-wider text-fg-subtle">{s.rate.label}</div><div class="font-mono text-sm font-semibold tabular-nums text-info">{s.rate.value === null ? '—' : `${s.rate.value.toFixed(2)}%`}</div></div>}
              {s.cost && <div class="text-right"><div class="text-[0.625rem] uppercase tracking-wider text-fg-subtle">{s.cost.label}</div><div class="font-mono text-sm font-semibold tabular-nums text-warning">{s.cost.value === null ? '—' : fmtMoney(s.cost.value)}</div></div>}
              <DeltaBadge d={s.deltaPct} />
            </div>
          </div>
        )
      })}
      <div class="flex flex-wrap gap-x-8 gap-y-2 border-t border-border bg-surface-3/30 px-4 py-3 text-sm">
        <span class="text-fg-muted">CPM <span class="ml-1 font-mono font-semibold text-fg">{fmtMoney(extra.cpm)}</span></span>
        <span class="text-fg-muted">CPL <span class="ml-1 font-mono font-semibold text-fg">{extra.cpl === null ? '—' : fmtMoney(extra.cpl)}</span></span>
        {/* ROAS depende do faturamento: sem fonte configurada, não há como
            calcular retorno — e 0,00x pareceria campanha sem retorno. */}
        <span class="text-fg-muted">ROAS <span class="ml-1 font-mono font-semibold text-fg">{extra.roas === null ? '—' : `${extra.roas.toFixed(2)}x`}</span></span>
      </div>
    </div>
  )
}

// ── tabela por dia da semana (heatmap) ───────────────────────────
const HEAT_COLS: { key: string; label: string; fmt: (n: number) => string }[] = [
  { key: 'investimento', label: 'Investimento', fmt: fmtMoney },
  { key: 'cmql', label: 'CMQL', fmt: fmtMoney },
  { key: 'mql', label: 'MQL', fmt: fmtInt },
  { key: 'sql', label: 'SQL', fmt: fmtInt },
  { key: 'ra', label: 'RA', fmt: fmtInt },
  { key: 'rr', label: 'RR', fmt: fmtInt },
  { key: 'fechamento', label: 'Fech.', fmt: fmtInt },
]
function heatMaxes(rows: any[]) {
  const m: Record<string, number> = {}
  for (const c of HEAT_COLS) m[c.key] = Math.max(0, ...rows.map((r) => Number(r[c.key] ?? 0)))
  return m
}
function WeekdayTable({ rows }: { rows: any[] }) {
  const maxes = heatMaxes(rows)
  return (
    <div class="overflow-x-auto rounded-xl border border-border">
      <table class="w-full border-collapse text-sm">
        <thead><tr class="bg-surface-3/40 text-left text-[0.625rem] uppercase tracking-wider text-fg-subtle">
          <th class="px-3 py-2 font-medium">Dia</th>{HEAT_COLS.map((c) => <th class="px-3 py-2 text-right font-medium">{c.label}</th>)}
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} class="border-t border-border/50">
              <td class="whitespace-nowrap px-3 py-2 text-fg-muted">{r.label}</td>
              {HEAT_COLS.map((c) => <td class="px-3 py-2 text-right font-mono tabular-nums text-fg" style={{ background: heat(Number(r[c.key] ?? 0), maxes[c.key]!, COL_RGB[c.key] ?? '148,163,184') }}>{c.fmt(Number(r[c.key] ?? 0))}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
function DailyTable({ rows }: { rows: DailyRow[] }) {
  const maxes = heatMaxes(rows)
  return (
    <div class="max-h-[420px] overflow-auto rounded-xl border border-border">
      <table class="w-full border-collapse text-sm">
        <thead class="sticky top-0 z-10"><tr class="bg-surface-3 text-left text-[0.625rem] uppercase tracking-wider text-fg-subtle">
          <th class="px-3 py-2 font-medium">Data</th>{HEAT_COLS.map((c) => <th class="px-3 py-2 text-right font-medium">{c.label}</th>)}
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.date} class="border-t border-border/50">
              <td class="whitespace-nowrap px-3 py-2 font-mono text-xs text-fg-muted">{r.date.split('-').reverse().join('/')}</td>
              {HEAT_COLS.map((c) => <td class="px-3 py-2 text-right font-mono tabular-nums text-fg" style={{ background: heat(Number((r as any)[c.key] ?? 0), maxes[c.key]!, COL_RGB[c.key] ?? '148,163,184') }}>{c.fmt(Number((r as any)[c.key] ?? 0))}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── tabela de quebra (campanha/adset) ────────────────────────────
const BD_COLS: { key: keyof BreakdownRow; label: string; fmt: (n: number) => string; heatKey?: string }[] = [
  { key: 'investimento', label: 'Investimento', fmt: fmtMoney, heatKey: 'investimento' },
  { key: 'leads', label: 'Leads', fmt: fmtInt, heatKey: 'leads' },
  { key: 'mql', label: 'MQL', fmt: fmtInt, heatKey: 'mql' },
  { key: 'taxaMql', label: 'Taxa MQL', fmt: (n) => `${n.toFixed(1)}%` },
  { key: 'sql', label: 'SQL', fmt: fmtInt, heatKey: 'sql' },
  { key: 'ra', label: 'RA', fmt: fmtInt, heatKey: 'ra' },
  { key: 'fechamento', label: 'Fech.', fmt: fmtInt, heatKey: 'fechamento' },
  { key: 'perdido', label: 'Perdido', fmt: fmtInt },
]
function BreakdownTable({ rows, dim }: { rows: BreakdownRow[]; dim: string }) {
  const maxes: Record<string, number> = {}
  for (const c of BD_COLS) if (c.heatKey) maxes[c.heatKey] = Math.max(0, ...rows.map((r) => Number(r[c.key] ?? 0)))
  if (!rows.length) return <div class="rounded-xl border border-border bg-surface-2/40 px-4 py-6 text-center text-sm text-fg-subtle">Sem dados no período.</div>
  return (
    <div class="max-h-[460px] overflow-auto rounded-xl border border-border">
      <table class="w-full border-collapse text-sm">
        <thead class="sticky top-0 z-10"><tr class="bg-surface-3 text-left text-[0.625rem] uppercase tracking-wider text-fg-subtle">
          <th class="px-3 py-2 font-medium">{dim}</th>{BD_COLS.map((c) => <th class="px-3 py-2 text-right font-medium">{c.label}</th>)}
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} class="border-t border-border/50 hover:bg-surface-2/40">
              <td class="max-w-[260px] truncate px-3 py-2 text-fg" title={r.name}>{r.name}</td>
              {BD_COLS.map((c) => {
                const v = Number(r[c.key] ?? 0)
                const bg = c.heatKey ? heat(v, maxes[c.heatKey]!, COL_RGB[c.heatKey] ?? '148,163,184') : 'transparent'
                return <td class="px-3 py-2 text-right font-mono tabular-nums text-fg" style={{ background: bg }}>{c.fmt(v)}</td>
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
