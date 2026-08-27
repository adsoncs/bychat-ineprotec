import { useLocation } from 'wouter-preact'
import { AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, Clock, Info, Trophy, Users } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { WidgetRenderer } from '@/components/widgets/WidgetRenderer'
import { findWidget } from '@/components/widgets/WidgetCatalog'
import { useMyHomeScreen, useMyDay, useLeaderboard, type HomeBlock, type HomeLink } from '@/hooks/useHomeScreen'
import { OverviewPage } from './OverviewPage'
import { PainelEducacionalHome } from './PainelEducacionalHome'
import type { Widget } from '@/hooks/useWidgets'
import { cn } from '@/lib/cn'

const fmtDate = (d: Date) => d.toISOString().split('T')[0] ?? ''
const fmtHora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
const fmtMoeda = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

/** Janela do bloco de KPIs: N dias até hoje. */
function periodRange(days: number) {
  const to = new Date()
  const from = new Date(to.getTime() - (days - 1) * 86400_000)
  return { dateFrom: fmtDate(from), dateTo: fmtDate(to) }
}

function LinkList({ links, variant }: { links: HomeLink[]; variant: 'inline' | 'cards' }) {
  const [, navigate] = useLocation()
  if (links.length === 0) return null
  if (variant === 'inline') {
    return (
      <div class="flex flex-wrap gap-2 mt-3">
        {links.map((l) => (
          <button
            key={l.path}
            onClick={() => navigate(l.path)}
            class="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-fg hover:bg-surface transition-colors"
          >
            {l.label}
            <ArrowRight size={12} />
          </button>
        ))}
      </div>
    )
  }
  return (
    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {links.map((l) => (
        <button
          key={l.path}
          onClick={() => navigate(l.path)}
          class="group flex items-center justify-between gap-2 rounded-lg border border-border bg-surface-2 p-4 text-left hover:border-accent hover:shadow-sm transition-all"
        >
          <span class="text-sm font-medium text-fg">{l.label}</span>
          <ArrowRight size={16} class="text-fg-muted group-hover:text-accent transition-colors" />
        </button>
      ))}
    </div>
  )
}

function NoticeBlock({ block }: { block: HomeBlock }) {
  const variant = block.config.variant || 'info'
  const tone = {
    info: { box: 'border-accent/30 bg-accent/5', icon: <Info size={18} class="text-accent" /> },
    warning: { box: 'border-warning/40 bg-warning/5', icon: <AlertTriangle size={18} class="text-warning" /> },
    success: { box: 'border-success/40 bg-success/5', icon: <CheckCircle2 size={18} class="text-success" /> },
  }[variant]

  return (
    <div class={cn('rounded-lg border p-4', tone.box)}>
      <div class="flex items-start gap-3">
        <div class="mt-0.5 shrink-0">{tone.icon}</div>
        <div class="min-w-0 flex-1">
          {block.config.title && <div class="text-sm font-semibold text-fg mb-1">{block.config.title}</div>}
          {block.config.text && <p class="text-sm text-fg-muted whitespace-pre-wrap">{block.config.text}</p>}
          <LinkList links={block.config.links || []} variant="inline" />
        </div>
      </div>
    </div>
  )
}

function ShortcutsBlock({ block }: { block: HomeBlock }) {
  return (
    <div>
      {block.config.title && <div class="text-sm font-semibold text-fg mb-3">{block.config.title}</div>}
      <LinkList links={block.config.items || []} variant="cards" />
    </div>
  )
}

/**
 * KPIs reaproveitam o WidgetRenderer de "Meus Painéis". `scoped: true` faz o
 * backend recortar o número pelo que este usuário pode ver — o mesmo bloco
 * mostra ao agente só a carteira dele e ao admin a empresa inteira.
 */
function KpisBlock({ block }: { block: HomeBlock }) {
  const metrics = block.config.metrics || []
  const range = periodRange(block.config.period || 30)
  if (metrics.length === 0) return null

  return (
    <div>
      {block.config.title && <div class="text-sm font-semibold text-fg mb-3">{block.config.title}</div>}
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {metrics.map((metric) => {
          const meta = findWidget(metric)
          const widget: Widget = {
            id: `${block.id}-${metric}`,
            metric,
            title: meta?.title || metric,
            type: meta?.defaultType || 'kpi',
            config: {
              ...range,
              scoped: true,
              ...(block.config.funnelId ? { funnelId: block.config.funnelId } : {}),
            },
          }
          return <WidgetRenderer key={widget.id} widget={widget} />
        })}
      </div>
      <p class="mt-2 text-[11px] text-fg-muted">
        Números do período de {block.config.period || 30} dias, limitados ao que o seu acesso permite ver.
      </p>
    </div>
  )
}

function MyDayBlock({ block }: { block: HomeBlock }) {
  const [, navigate] = useLocation()
  const { data, isLoading } = useMyDay(block.config.staleHours)

  if (isLoading) return <Skeleton class="h-40 w-full" />
  if (!data) return null

  const cards = [
    { label: 'Hoje', value: data.counts.today, icon: <CalendarClock size={16} class="text-accent" />, path: '/activities' },
    { label: 'Reuniões', value: data.counts.meetings, icon: <Users size={16} class="text-accent" />, path: '/scheduling' },
    { label: 'Atrasadas', value: data.counts.overdue, icon: <Clock size={16} class="text-danger" />, path: '/activities' },
    { label: `Parados +${data.staleHours}h`, value: data.counts.staleLeads, icon: <AlertTriangle size={16} class="text-warning" />, path: '/leads' },
  ]

  return (
    <Card>
      <div class="text-sm font-semibold text-fg mb-3">{block.config.title || 'Meu dia'}</div>
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((c) => (
          <button
            key={c.label}
            onClick={() => navigate(c.path)}
            class="rounded-lg border border-border p-3 text-left hover:border-accent transition-colors"
          >
            <div class="flex items-center gap-1.5 text-xs text-fg-muted">{c.icon}{c.label}</div>
            <div class="mt-1 text-2xl font-semibold text-fg">{c.value}</div>
          </button>
        ))}
      </div>

      {data.activities.length > 0 ? (
        <ul class="mt-4 divide-y divide-border">
          {data.activities.map((a) => (
            <li key={a.id} class="flex items-center justify-between gap-3 py-2">
              <div class="min-w-0">
                <div class="truncate text-sm text-fg">{a.title}</div>
                {a.leadName && <div class="truncate text-xs text-fg-muted">{a.leadName}</div>}
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <span class="text-xs tabular-nums text-fg-muted">{fmtHora(a.scheduledAt)}</span>
                <button onClick={() => navigate(`/leads/${a.leadId}`)} class="text-xs text-accent hover:underline">abrir</button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p class="mt-4 text-sm text-fg-muted">Nada agendado para hoje.</p>
      )}
    </Card>
  )
}

function LeaderboardBlock({ block }: { block: HomeBlock }) {
  const { data, isLoading } = useLeaderboard(block.config.days, block.config.limit)
  if (isLoading) return <Skeleton class="h-40 w-full" />
  if (!data) return null

  const porReceita = (block.config.metric || 'revenue') === 'revenue'
  const topo = data.entries[0]
  const maior = porReceita ? (topo?.revenue ?? 0) : (topo?.won ?? 0)

  return (
    <Card>
      <div class="flex items-center justify-between gap-2 mb-3">
        <div class="flex items-center gap-2 text-sm font-semibold text-fg">
          <Trophy size={16} class="text-warning" />
          {block.config.title || 'Placar da equipe'}
        </div>
        <span class="text-xs text-fg-muted">{data.days} dias</span>
      </div>

      {data.entries.length === 0 ? (
        <p class="text-sm text-fg-muted">Nenhum negócio ganho no período.</p>
      ) : (
        <ul class="space-y-2">
          {data.entries.map((e, i) => {
            const valor = porReceita ? e.revenue : e.won
            const pct = maior > 0 ? Math.round((valor / maior) * 100) : 0
            return (
              <li key={e.userId} class={cn('rounded-md px-2 py-1.5', e.isMe && 'bg-accent/5')}>
                <div class="flex items-center justify-between gap-2 text-sm">
                  <span class="truncate text-fg">
                    <span class="text-fg-muted tabular-nums mr-1.5">{i + 1}.</span>
                    {e.name}{e.isMe && <span class="ml-1 text-xs text-accent">(você)</span>}
                  </span>
                  <span class="shrink-0 tabular-nums text-fg">
                    {porReceita ? fmtMoeda(e.revenue) : `${e.won} ganhos`}
                  </span>
                </div>
                <div class="mt-1 h-1.5 w-full rounded-full bg-surface-3">
                  <div class="h-1.5 rounded-full bg-accent" style={{ width: `${pct}%` }} />
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

export function HomeBlockRenderer({ block }: { block: HomeBlock }) {
  switch (block.type) {
    case 'notice': return <NoticeBlock block={block} />
    case 'shortcuts': return <ShortcutsBlock block={block} />
    case 'kpis': return <KpisBlock block={block} />
    case 'my_day': return <MyDayBlock block={block} />
    case 'leaderboard': return <LeaderboardBlock block={block} />
    default: return null
  }
}

/**
 * Título da porta de entrada. É FIXO de propósito: o nome da tela ("6. Composta
 * — Tela do Agente") é rótulo de administração, serve para o admin achar a tela
 * na lista, e não faz sentido para quem só entra no sistema. Seja a tela
 * montada, seja a Visão Geral de fábrica, a entrada se chama sempre a mesma
 * coisa.
 */
const TITULO = 'Visão Geral'

/**
 * Porta de entrada do sistema. Sem tela atribuída ao papel (ou ao usuário),
 * cai na Visão Geral de fábrica — que é o comportamento de sempre e o que
 * garante que ninguém entre num app em branco.
 */
export function HomeScreenPage() {
  const { data, isLoading } = useMyHomeScreen()

  if (isLoading) {
    return (
      <Page title={TITULO}>
        <Skeleton class="h-24 w-full" />
        <Skeleton class="mt-3 h-40 w-full" />
      </Page>
    )
  }

  if (!data?.screen) return <OverviewPage />

  // Tela nativa: um painel pronto do produto no lugar da pilha de blocos. Não
  // passa por HomeBlockRenderer porque não há blocos — o conteúdo e os dados
  // são do próprio painel.
  if (data.screen.builtin === 'educacional') return <PainelEducacionalHome titulo={TITULO} />

  return (
    <Page title={TITULO} {...(data.screen.description ? { description: data.screen.description } : {})}>
      <div class="space-y-5">
        {data.screen.blocks.map((b) => (
          <HomeBlockRenderer key={b.id} block={b} />
        ))}
        {data.screen.blocks.length === 0 && (
          <p class="text-sm text-fg-muted">
            {(data.pruned ?? 0) > 0
              ? 'Esta tela existe, mas o seu nível de acesso não alcança nenhum dos blocos dela. Fale com um administrador.'
              : 'Esta tela ainda não tem blocos configurados.'}
          </p>
        )}
      </div>
    </Page>
  )
}
