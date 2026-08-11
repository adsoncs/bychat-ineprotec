import { useEffect, useMemo, useState } from 'preact/hooks'
import { Plus, Pencil, Check, X as XIcon, ChevronLeft, ChevronRight, Trash2, HelpCircle } from 'lucide-preact'
import { HowItWorksModal } from '@/components/ui/HowItWorksModal'
import {
  useUserDashboards,
  useCreateDashboard,
  useUpdateDashboard,
  useDeleteDashboard,
  type UserDashboard,
  type Widget,
  type WidgetSize,
} from '@/hooks/useWidgets'
import { useFunnels } from '@/hooks/useFunnels'
import { useMyPermissions } from '@/hooks/usePermissions'
import { useUserStore } from '@/stores/user'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { Button } from '@/components/ui/Button'
import { WidgetRenderer } from '@/components/widgets/WidgetRenderer'
import { AddWidgetModal } from '@/components/widgets/AddWidgetModal'
import { EditWidgetModal } from '@/components/widgets/EditWidgetModal'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/cn'
import { presetRange, presetLabel, hoje, type RangePreset } from '@/components/ui/PeriodPicker'

interface DashboardPageProps {
  pageType?: 'dashboard' | 'analytics'
  pageTitle?: string
  pageDescription?: string
  getDefaults?: () => Widget[]
  defaultName?: string
}

// `DashboardPage` é mantido só para compatibilidade de imports antigos.
// O `Router.tsx` aponta a rota /app/dashboard para `OverviewPage` (visão fixa).
// A rota /app/analytics aponta para `AnalyticsPage` (engine customizável renomeada
// para "Meus Painéis" — múltiplos dashboards salvos por usuário com 37 métricas).
export function DashboardPage() {
  return <DashboardPageInner />
}

export function AnalyticsPage() {
  const role = useUserStore((s) => s.user?.role ?? null)
  const { data: permsData } = useMyPermissions()
  const canViewEducational = role === 'SUPERADMIN'
    || !!permsData?.permissions['educacional']?.canView
  return (
    <DashboardPageInner
      pageType="analytics"
      pageTitle="Meus Painéis"
      pageDescription="Monte dashboards customizados — KPIs, gráficos, funil, comparações por período."
      defaultName="Meu painel"
      getDefaults={() => analyticsDefaults(canViewEducational)}
    />
  )
}

function DashboardPageInner(props: DashboardPageProps = {}) {
  const pageType = props.pageType ?? 'dashboard'
  const pageTitle = props.pageTitle ?? 'Dashboard'
  const pageDescription = props.pageDescription ?? 'Resumo executivo dos seus leads e atividade do produto.'
  const getDefaults = props.getDefaults ?? dashboardDefaults
  const defaultName = props.defaultName ?? 'Meu Dashboard'

  const [filters, setFilters] = useState<{ dateFrom: string; dateTo: string; funnelId: string }>({
    dateFrom: '', dateTo: '', funnelId: '',
  })
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [editingWidget, setEditingWidget] = useState<Widget | null>(null)
  const [showHowItWorks, setShowHowItWorks] = useState(false)

  const { data: list, isLoading } = useUserDashboards(pageType)
  const create = useCreateDashboard()
  const update = useUpdateDashboard()
  const del = useDeleteDashboard()

  const dashboards = useMemo(() => list?.dashboards ?? [], [list?.dashboards])
  const [activeId, setActiveId] = useState<number | null>(null)
  const active = useMemo(() => {
    return dashboards.find((d) => d.id === activeId) ?? dashboards.find((d) => d.isDefault) ?? dashboards[0] ?? null
  }, [dashboards, activeId])

  // Cria default automaticamente se não houver nenhum
  useEffect(() => {
    if (!isLoading && dashboards.length === 0 && !create.isPending) {
      create.mutate({ name: defaultName, type: pageType, widgets: getDefaults() })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, dashboards.length])

  function handleCreateNewDashboard() {
    const name = window.prompt('Nome do novo dashboard:')
    if (!name) return
    create.mutate({ name, type: pageType, widgets: [] }, {
      onSuccess: (created) => {
        setActiveId(created.id)
        setEditing(true)
      },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function handleDeleteDashboard() {
    if (!active) return
    if (!window.confirm(`Excluir "${active.name}"?`)) return
    del.mutate(active.id, {
      onSuccess: () => {
        toast('Dashboard excluído', 'success')
        setActiveId(null)
        setEditing(false)
      },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function persistWidgets(nextWidgets: Widget[]) {
    if (!active) return
    update.mutate({ id: active.id, widgets: nextWidgets }, {
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function moveWidget(idx: number, dir: -1 | 1) {
    if (!active) return
    const widgets = active.widgets.slice()
    const newIdx = idx + dir
    if (newIdx < 0 || newIdx >= widgets.length) return
    const a = widgets[idx]
    const b = widgets[newIdx]
    if (!a || !b) return
    widgets[idx] = b
    widgets[newIdx] = a
    persistWidgets(widgets)
  }

  function removeWidget(id: string) {
    if (!active) return
    if (!window.confirm('Remover este widget?')) return
    persistWidgets(active.widgets.filter((w) => w.id !== id))
  }

  function addWidget(w: Widget) {
    if (!active) return
    persistWidgets([...active.widgets, w])
  }

  function updateWidget(next: Widget) {
    if (!active) return
    persistWidgets(active.widgets.map((w) => (w.id === next.id ? next : w)))
  }

  const widgets = active?.widgets ?? []

  return (
    <Page
      title={pageTitle}
      description={pageDescription}
      actions={
        <Button variant="ghost" size="sm" onClick={() => setShowHowItWorks(true)}>
          <HelpCircle size={14} /> Como funciona?
        </Button>
      }
    >
      {/* Toolbar 1 — tabs de dashboards + ações */}
      {active && dashboards.length > 0 && (
        <Card class="!p-2">
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <DashboardTabs
              dashboards={dashboards}
              active={active}
              onSelect={(d) => { setActiveId(d.id); setEditing(false) }}
              onCreate={handleCreateNewDashboard}
            />
            <div class="flex items-center gap-1.5">
              <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
                <Plus size={14} /> Widget
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setEditing((e) => !e)}
              >
                {editing ? <><Check size={14} /> Concluir</> : <><Pencil size={14} /> Editar</>}
              </Button>
              {dashboards.length > 1 && !active.isSystem && (
                <button
                  type="button"
                  class="size-8 rounded-md grid place-items-center text-fg-muted hover:text-danger hover:bg-surface-3"
                  onClick={handleDeleteDashboard}
                  aria-label="Excluir painel"
                  title="Excluir painel"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Toolbar 2 — filtros */}
      <Card class="!py-2 !px-3">
        <FiltersBar filters={filters} onChange={setFilters} />
      </Card>

      {/* Loading */}
      {isLoading && (
        <div class="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} class="h-32 w-full" />)}
        </div>
      )}

      {/* Empty */}
      {!isLoading && active && widgets.length === 0 && (
        <Card class="text-center py-10">
          <div class="text-4xl mb-2 opacity-50">📊</div>
          <div class="text-sm font-medium text-fg mb-1">Dashboard vazio</div>
          <div class="text-xs text-fg-muted mb-4 max-w-md mx-auto">
            Clique em "+ Widget" para adicionar gráficos, KPIs, tabelas e mais ao seu dashboard personalizado.
          </div>
          <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
            <Plus size={14} /> Adicionar primeiro widget
          </Button>
        </Card>
      )}

      {/* Grid de widgets */}
      {!isLoading && active && widgets.length > 0 && (
        <div class="grid gap-3 grid-cols-1 sm:grid-cols-12">
          {widgets.map((w, idx) => (
            <div
              key={w.id}
              class={cn(sizeToColSpan(w.size ?? 'md'))}
            >
              <WidgetRenderer
                widget={w}
                filters={{
                  dateFrom: filters.dateFrom || undefined,
                  dateTo: filters.dateTo || undefined,
                  funnelId: filters.funnelId ? Number(filters.funnelId) : undefined,
                }}
                dashboardId={active.id}
                allWidgets={widgets}
                actions={editing && (
                  <div class="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      class="size-6 rounded grid place-items-center text-fg-subtle hover:text-accent hover:bg-surface-3"
                      onClick={() => setEditingWidget(w)}
                      aria-label="Editar"
                      title="Editar"
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      type="button"
                      class="size-6 rounded grid place-items-center text-fg-subtle hover:text-fg hover:bg-surface-3 disabled:opacity-30"
                      onClick={() => moveWidget(idx, -1)}
                      disabled={idx === 0}
                      aria-label="Mover esquerda"
                      title="Mover esquerda"
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <button
                      type="button"
                      class="size-6 rounded grid place-items-center text-fg-subtle hover:text-fg hover:bg-surface-3 disabled:opacity-30"
                      onClick={() => moveWidget(idx, 1)}
                      disabled={idx === widgets.length - 1}
                      aria-label="Mover direita"
                      title="Mover direita"
                    >
                      <ChevronRight size={14} />
                    </button>
                    <button
                      type="button"
                      class="size-6 rounded grid place-items-center text-fg-subtle hover:text-danger hover:bg-surface-3"
                      onClick={() => removeWidget(w.id)}
                      aria-label="Remover"
                      title="Remover"
                    >
                      <XIcon size={14} />
                    </button>
                  </div>
                )}
              />
            </div>
          ))}
        </div>
      )}

      {adding && (
        <AddWidgetModal
          open
          onClose={() => setAdding(false)}
          onAdd={addWidget}
        />
      )}

      {editingWidget && (
        <EditWidgetModal
          widget={editingWidget}
          onClose={() => setEditingWidget(null)}
          onSave={updateWidget}
        />
      )}

      <HowItWorksModal
        open={showHowItWorks}
        onClose={() => setShowHowItWorks(false)}
        title="Como funciona a Visão Geral?"
        problem={<>
          Esta é a sua <strong>tela inicial</strong>. Em vez de relatórios fixos, você monta seus
          próprios painéis com os indicadores que importam pra você: leads novos, vendas, conversão por
          canal, atividades atrasadas, etc.
        </>}
        steps={[
          {
            title: '📊 Cada aba é um painel',
            body: <>No topo aparecem as abas de painel (Vendas, Marketing, etc.). Você pode <strong>criar quantos quiser</strong> — um pra cada perspectiva. O painel padrão vem com indicadores típicos.</>,
          },
          {
            title: '➕ Adicione widgets',
            body: <>Clique em <strong>+ Widget</strong> pra escolher o tipo: KPI numérico, gráfico de linha/barra, tabela, ranking de leads, funil de conversão, etc. Cada widget é configurável (período, funil, etapa).</>,
          },
          {
            title: '✏️ Editar e reorganizar',
            body: <>Botão <strong>Editar</strong> habilita arrastar, mover e redimensionar widgets. Cada um pode ser pequeno, médio ou grande dentro da grid. Concluído? Clique em <strong>Concluir</strong> e o layout fica salvo.</>,
          },
          {
            title: '🎯 Filtros globais',
            body: <>A barra de filtros aplica em <strong>todos os widgets do painel</strong> de uma vez: período (últimos 7/30/90 dias), funil específico, etc. Útil pra comparar mês a mês ou ver só um funil.</>,
          },
          {
            title: '🗑️ Painel pessoal vs sistema',
            body: <>Painéis criados por você podem ser editados e excluídos. Os painéis marcados como <strong>do sistema</strong> são compartilhados (vêm da configuração) e não podem ser apagados.</>,
          },
        ]}
        tip={{
          tone: 'info',
          title: '💡 Boa prática',
          body: <>Crie painéis por <strong>papel</strong>: um pro CEO (KPIs gerais), um pro Marketing (campanhas, CPL), um pro Vendas (cadências, conversão). Cada um vê o que precisa, sem ruído.</>,
        }}
      />
    </Page>
  )
}

// ───────────────────────────────────────────────
// Tabs de dashboards (com botão "+" tracejado)
// ───────────────────────────────────────────────

function DashboardTabs({
  dashboards, active, onSelect, onCreate,
}: {
  dashboards: UserDashboard[]
  active: UserDashboard
  onSelect: (d: UserDashboard) => void
  onCreate: () => void
}) {
  return (
    <div class="flex items-center gap-1 flex-wrap">
      {dashboards.map((d) => {
        const isActive = d.id === active.id
        return (
          <button
            key={d.id}
            type="button"
            onClick={() => onSelect(d)}
            class={cn(
              'h-8 px-3 rounded-md text-sm font-medium transition-colors',
              isActive
                ? 'bg-accent text-fg-on-brand'
                : 'text-fg-muted hover:bg-surface-3 hover:text-fg',
            )}
          >
            {d.name}{d.isDefault ? ' (padrão)' : ''}
          </button>
        )
      })}
      <button
        type="button"
        onClick={onCreate}
        class="h-8 px-2.5 rounded-md text-sm font-medium border border-dashed border-accent text-accent hover:bg-accent/10"
        title="Novo painel"
      >
        +
      </button>
    </div>
  )
}

// ───────────────────────────────────────────────
// Barra de filtros (datas + funil + presets em pílulas)
// ───────────────────────────────────────────────

function FiltersBar({
  filters, onChange,
}: {
  filters: { dateFrom: string; dateTo: string; funnelId: string }
  onChange: (next: { dateFrom: string; dateTo: string; funnelId: string }) => void
}) {
  const { data: funnelsData } = useFunnels()
  const funnels = (funnelsData?.funnels ?? []).filter((f) => f.active !== false)

  function fmt(d: Date) { return d.toISOString().split('T')[0] ?? '' }

  // Meses fechados, como no resto do sistema. "Hoje" continua porque este painel
  // é usado para acompanhar o dia corrente, não só para fechar mês.
  function setPreset(preset: 'today' | RangePreset) {
    if (preset === 'today') {
      const hj = hoje()
      onChange({ ...filters, dateFrom: hj, dateTo: hj })
      return
    }
    const r = presetRange(preset)
    onChange({ ...filters, dateFrom: r.dateFrom, dateTo: r.dateTo })
  }

  function clear() { onChange({ dateFrom: '', dateTo: '', funnelId: '' }) }

  function isPresetActive(preset: 'today' | RangePreset): boolean {
    if (!filters.dateFrom || !filters.dateTo) return false
    if (preset === 'today') { const hj = hoje(); return filters.dateFrom === hj && filters.dateTo === hj }
    const r = presetRange(preset)
    return filters.dateFrom === r.dateFrom && filters.dateTo === r.dateTo
  }

  const presetBtnClass = (active: boolean) =>
    cn(
      'h-8 px-3 rounded-md text-xs font-medium transition-colors',
      active ? 'bg-accent/15 text-accent' : 'text-fg-muted hover:bg-surface-3 hover:text-fg',
    )

  return (
    <div class="flex items-center gap-2 flex-wrap text-xs">
      <label class="inline-flex items-center gap-1.5">
        <span class="text-fg-muted">De:</span>
        <input
          type="date"
          class="h-8 px-2 rounded-md bg-surface border border-border text-fg focus:outline-none focus:border-accent"
          value={filters.dateFrom}
          onChange={(e) => onChange({ ...filters, dateFrom: (e.target as HTMLInputElement).value })}
        />
      </label>
      <label class="inline-flex items-center gap-1.5">
        <span class="text-fg-muted">Até:</span>
        <input
          type="date"
          class="h-8 px-2 rounded-md bg-surface border border-border text-fg focus:outline-none focus:border-accent"
          value={filters.dateTo}
          onChange={(e) => onChange({ ...filters, dateTo: (e.target as HTMLInputElement).value })}
        />
      </label>
      <label class="inline-flex items-center gap-1.5">
        <span class="text-fg-muted">Funil:</span>
        <select
          class="h-8 px-2 rounded-md bg-surface border border-border text-fg cursor-pointer focus:outline-none focus:border-accent"
          value={filters.funnelId}
          onChange={(e) => onChange({ ...filters, funnelId: (e.target as HTMLSelectElement).value })}
        >
          <option value="">Todos</option>
          {funnels.map((f) => (
            <option key={f.id} value={f.id}>{f.name}{f.isDefault ? ' (padrão)' : ''}</option>
          ))}
        </select>
      </label>

      <span class="h-4 w-px bg-border mx-1" />

      <button type="button" class={presetBtnClass(isPresetActive('today'))} onClick={() => setPreset('today')}>Hoje</button>
      {(['m4', 'm3', 'm2', 'm1', 'm0'] as RangePreset[]).map((mp) => (
        <button key={mp} type="button" class={presetBtnClass(isPresetActive(mp))} onClick={() => setPreset(mp)}>
          {presetLabel(mp, mp !== 'm0')}
        </button>
      ))}
      <button type="button" class="h-8 px-3 rounded-md text-xs font-medium text-danger hover:bg-danger/10" onClick={clear}>
        Limpar
      </button>
    </div>
  )
}

// ───────────────────────────────────────────────
// Map de tamanho legacy (sm/md/lg/xl) → Tailwind col-span (12 colunas)
// sm=3 (1/4) · md=4 (1/3) · lg=6 (1/2) · xl=12 (full)
// ───────────────────────────────────────────────

function sizeToColSpan(size: WidgetSize): string {
  switch (size) {
    case 'sm': return 'sm:col-span-6 lg:col-span-3'
    case 'md': return 'sm:col-span-6 lg:col-span-4'
    case 'lg': return 'sm:col-span-12 lg:col-span-6'
    case 'xl': return 'sm:col-span-12 lg:col-span-12'
  }
}

// ───────────────────────────────────────────────
// Defaults — replicando wbDefaultDashboard / wbDefaultAnalytics do legado
// ───────────────────────────────────────────────

let _defaultIdCounter = 0
function defaultId(): string {
  _defaultIdCounter++
  return `w_${Date.now().toString(36)}_${_defaultIdCounter.toString(36)}`
}

function dashboardDefaults(): Widget[] {
  return [
    { id: defaultId(), metric: 'leads_total', type: 'kpi', title: 'Total de Leads', size: 'sm' },
    { id: defaultId(), metric: 'leads_new', type: 'kpi', title: 'Leads Novos', size: 'sm' },
    { id: defaultId(), metric: 'leads_avg_score', type: 'kpi', title: 'Score Médio', size: 'sm' },
    { id: defaultId(), metric: 'activities_summary', type: 'kpi', title: 'Atividades', size: 'sm' },
    { id: defaultId(), metric: 'registrations_total', type: 'kpi', title: 'Inscrições', size: 'sm' },
    { id: defaultId(), metric: 'registrations_revenue', type: 'kpi', title: 'Receita de Matrículas', size: 'sm' },
    { id: defaultId(), metric: 'leads_by_date', type: 'bar', title: 'Leads por Dia', size: 'lg', config: { groupBy: 'day' } },
    { id: defaultId(), metric: 'leads_by_status', type: 'bar', title: 'Leads por Etapa', size: 'lg' },
    { id: defaultId(), metric: 'leads_by_funnel', type: 'funnel', title: 'Funis', size: 'xl' },
    { id: defaultId(), metric: 'leads_by_source', type: 'donut', title: 'Origem dos Leads', size: 'md' },
    { id: defaultId(), metric: 'leads_by_pillar', type: 'progress', title: 'Score por Pilar', size: 'md' },
    { id: defaultId(), metric: 'pages_performance', type: 'table', title: 'Landing Pages', size: 'lg' },
    { id: defaultId(), metric: 'leads_recent', type: 'table', title: 'Últimos Leads', size: 'xl', config: { limit: 8 } },
  ]
}

function analyticsDefaults(includeEducational: boolean): Widget[] {
  const general: Widget[] = [
    { id: defaultId(), metric: 'leads_total', type: 'kpi', title: 'Total de Leads', size: 'sm' },
    { id: defaultId(), metric: 'leads_uncontacted', type: 'kpi', title: 'Sem Contato', size: 'sm' },
    { id: defaultId(), metric: 'leads_avg_score', type: 'kpi', title: 'Score Médio', size: 'sm' },
    { id: defaultId(), metric: 'tracking_visitors', type: 'kpi', title: 'Visitantes', size: 'sm' },
    { id: defaultId(), metric: 'meta_leads', type: 'kpi', title: 'Meta Ads', size: 'sm' },
    { id: defaultId(), metric: 'leads_by_date', type: 'line', title: 'Leads por Semana', size: 'lg', config: { groupBy: 'week' } },
    { id: defaultId(), metric: 'leads_maturidade', type: 'donut', title: 'Maturidade', size: 'md' },
    { id: defaultId(), metric: 'leads_by_segment', type: 'bar', title: 'Top Segmentos', size: 'md', config: { limit: 8 } },
    { id: defaultId(), metric: 'leads_by_pillar', type: 'progress', title: 'Score por Pilar', size: 'md' },
    { id: defaultId(), metric: 'leads_by_status', type: 'funnel', title: 'Funil de Etapas', size: 'xl' },
    { id: defaultId(), metric: 'messages_volume', type: 'bar', title: 'Mensagens', size: 'lg' },
    { id: defaultId(), metric: 'tracking_by_device', type: 'donut', title: 'Dispositivos', size: 'md' },
    { id: defaultId(), metric: 'activities_by_type', type: 'bar', title: 'Atividades por Tipo', size: 'md' },
    { id: defaultId(), metric: 'leads_recent', type: 'table', title: 'Todos os Leads', size: 'xl', config: { limit: 15 } },
  ]
  // Widgets do domínio Educacional só entram para clientes que têm o módulo.
  // Quem não usa Educacional não recebe KPIs/inscrições zerados no painel default.
  if (!includeEducational) return general
  const educational: Widget[] = [
    { id: defaultId(), metric: 'registrations_total', type: 'kpi', title: 'Inscrições', size: 'sm' },
    { id: defaultId(), metric: 'registrations_paid', type: 'kpi', title: 'Matrículas Pagas', size: 'sm' },
    { id: defaultId(), metric: 'registrations_revenue', type: 'kpi', title: 'Receita de Matrículas', size: 'sm' },
    { id: defaultId(), metric: 'registrations_conversion_rate', type: 'gauge', title: 'Conversão de Matrículas', size: 'sm' },
    { id: defaultId(), metric: 'registrations_by_day', type: 'area', title: 'Inscrições por Dia', size: 'lg', config: { groupBy: 'day' } },
    { id: defaultId(), metric: 'registrations_by_portal', type: 'bar', title: 'Inscrições por Portal', size: 'md', config: { limit: 8 } },
    { id: defaultId(), metric: 'registrations_by_status', type: 'donut', title: 'Status das Matrículas', size: 'md' },
    { id: defaultId(), metric: 'registrations_by_source', type: 'hbar', title: 'Fontes de Matrículas', size: 'md', config: { limit: 8 } },
    { id: defaultId(), metric: 'registrations_recent', type: 'table', title: 'Últimas Inscrições', size: 'xl', config: { limit: 10 } },
  ]
  return [...general, ...educational]
}
