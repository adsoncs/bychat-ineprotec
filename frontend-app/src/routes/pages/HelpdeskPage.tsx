import { useState } from 'preact/hooks'
import { Fragment } from 'preact'
import type { ComponentChildren } from 'preact'
import { LifeBuoy, Plus, Hash, ArrowLeft, Paperclip, UserPlus, X, Link2, Trash2, Search, Settings2, Copy, Clock, Timer, Zap, BookOpen, Eye, Star, Smile, Building2, BarChart3, Download, Sparkles, List, Columns } from 'lucide-preact'
import { env } from '@/lib/env'
import { useLocation } from 'wouter-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { useCan } from '@/hooks/usePermissions'
import { useUserStore } from '@/stores/user'
import { Modal } from '@/components/ui/Modal'
import { Input, Textarea, Select } from '@/components/ui/Input'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'
import { SearchInput } from '@/components/ui/SearchInput'
import {
  useTickets, useTicket, useCreateTicket, useUpdateTicket, useAddComment,
  useAgents, useTeams, useTagsCatalog, useTicketActions, useBulkAction, usePresence, searchLeads,
  useHelpdeskSettings, useSaveHelpdeskSettings,
  useSlaPolicies, useCalendars, useSavePolicy, useDeletePolicy, useCreateCalendar,
  useMacros, useApplyMacro, useSaveMacro, useDeleteMacro,
  useTriggers, useSaveTrigger, useDeleteTrigger, useAutomations, useSaveAutomation, useDeleteAutomation,
  useKbCategories, useSaveKbCategory, useDeleteKbCategory, useKbArticles, useSaveKbArticle, useDeleteKbArticle, useKbSuggest,
  useCsatStats, useOrganizations, useSaveOrganization, useDeleteOrganization, useReports,
  useAiStatus, useTicketAi, useQaStats, useHelpdeskCustomFields,
  useImportUpload, useImportRemote, type ImportResult,
  useSideConversations, useSideConversationActions, type SideConversation,
  type Ticket, type TicketStatus, type TicketPriority, type LeadSearchResult, type BulkAction, type SlaStatus, type SlaPolicy,
  type Macro, type Trigger, type Automation, type KbCategory, type KbArticle, type Organization,
} from '@/hooks/useHelpdesk'

const CHANNEL_LABEL: Record<string, string> = {
  email: 'E-mail', web: 'Web', whatsapp: 'WhatsApp', chat: 'Chat', api: 'API', phone: 'Telefone', manual: 'Manual',
}

function fmtDuration(ms: number): string {
  const abs = Math.abs(ms)
  const h = Math.floor(abs / 3_600_000)
  const m = Math.floor((abs % 3_600_000) / 60_000)
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`
  if (h >= 1) return `${h}h ${m}m`
  return `${m}m`
}

/** Rótulo + tom do relógio de SLA a partir do status e da meta. */
function slaInfo(status: SlaStatus | null | undefined, target: string | null | undefined): { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' } | null {
  if (!status) return null
  if (status === 'met') return { label: 'No prazo', tone: 'success' }
  if (status === 'breached') {
    const over = target ? fmtDuration(Date.now() - new Date(target).getTime()) : ''
    return { label: over ? `Atrasado ${over}` : 'Atrasado', tone: 'danger' }
  }
  const remaining = target ? new Date(target).getTime() - Date.now() : 0
  if (status === 'at_risk') return { label: `Vence em ${fmtDuration(remaining)}`, tone: 'warning' }
  return { label: target ? `${fmtDuration(remaining)} restante` : 'SLA', tone: 'neutral' }
}

function SlaBadge({ status, target, icon }: { status: SlaStatus | null | undefined; target: string | null | undefined; icon?: boolean }) {
  const info = slaInfo(status, target)
  if (!info) return null
  return <Badge tone={info.tone}>{icon && <Timer size={11} />}{info.label}</Badge>
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

const STATUS_LABEL: Record<TicketStatus, string> = {
  new: 'Novo', open: 'Aberto', pending: 'Pendente', on_hold: 'Em espera', solved: 'Resolvido', closed: 'Fechado',
}
const STATUS_TONE: Record<TicketStatus, 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info'> = {
  new: 'info', open: 'accent', pending: 'warning', on_hold: 'warning', solved: 'success', closed: 'neutral',
}
const PRIORITY_LABEL: Record<TicketPriority, string> = { low: 'Baixa', normal: 'Normal', high: 'Alta', urgent: 'Urgente' }
const PRIORITY_TONE: Record<TicketPriority, 'neutral' | 'warning' | 'danger' | 'info'> = {
  low: 'neutral', normal: 'info', high: 'warning', urgent: 'danger',
}
const STATUSES: TicketStatus[] = ['new', 'open', 'pending', 'on_hold', 'solved', 'closed']
const PRIORITIES: TicketPriority[] = ['low', 'normal', 'high', 'urgent']

// Máquina de estados (espelha STATUS_TRANSITIONS do backend) — define quais
// colunas do kanban aceitam um cartão arrastado de cada status.
const STATUS_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  new: ['open', 'pending', 'on_hold', 'solved', 'closed'],
  open: ['pending', 'on_hold', 'solved', 'closed'],
  pending: ['open', 'on_hold', 'solved', 'closed'],
  on_hold: ['open', 'pending', 'solved', 'closed'],
  solved: ['open', 'closed'],
  closed: ['open'],
}
const COLUMN_CAP = 50 // cartões renderizados por coluna (o total real vem dos counters)

function fmt(d: string | null): string {
  if (!d) return '—'
  try { return new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) } catch { return d }
}

const HD_TABS: Array<{ key: string; label: string; path: string }> = [
  { key: 'tickets', label: 'Chamados', path: '/helpdesk' },
  { key: 'sla', label: 'SLA', path: '/helpdesk/sla' },
  { key: 'automation', label: 'Automação', path: '/helpdesk/automation' },
  { key: 'kb', label: 'Base de Conhecimento', path: '/helpdesk/kb' },
  { key: 'csat', label: 'CSAT', path: '/helpdesk/csat' },
  { key: 'orgs', label: 'Organizações', path: '/helpdesk/organizations' },
  { key: 'reports', label: 'Relatórios', path: '/helpdesk/reports' },
  { key: 'channels', label: 'Canais', path: '/helpdesk/channels' },
  { key: 'import', label: 'Importar', path: '/helpdesk/import' },
]

export function HelpdeskTabs({ active }: { active: string }) {
  const [, navigate] = useLocation()
  return (
    <div class="flex flex-wrap gap-1 border-b border-border">
      {HD_TABS.map((t) => (
        <button
          key={t.key}
          class={`text-sm px-3 py-2 -mb-px border-b-2 transition-colors ${active === t.key ? 'border-accent text-fg font-medium' : 'border-transparent text-fg-muted hover:text-fg'}`}
          onClick={() => navigate(t.path)}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

export function HelpdeskPage() {
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [view, setView] = useState<'list' | 'kanban'>(() => (localStorage.getItem('helpdesk_view') === 'kanban' ? 'kanban' : 'list'))
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [assigneeFilter, setAssigneeFilter] = useState<string>('') // '' | 'me' | 'null'
  const [priorityFilter, setPriorityFilter] = useState<string>('')
  const [teamFilter, setTeamFilter] = useState<string>('')
  const [search, setSearch] = useState('')
  const [spamView, setSpamView] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const kanban = view === 'kanban'
  function changeView(v: 'list' | 'kanban') { setView(v); localStorage.setItem('helpdesk_view', v) }

  const agents = useAgents()
  const teams = useTeams()
  const update = useUpdateTicket()
  const list = useTickets({
    // No kanban as colunas SÃO os status → ignora o filtro de status e busca um lote maior.
    status: kanban ? undefined : (statusFilter || undefined),
    assignedUserId: assigneeFilter || undefined,
    priority: priorityFilter || undefined,
    ...(teamFilter ? { teamId: teamFilter } as any : {}),
    q: search || undefined,
    spam: spamView || undefined,
    ...(kanban ? { limit: 200 } : {}),
  })

  if (selectedId !== null) {
    return <TicketDetail id={selectedId} onBack={() => setSelectedId(null)} />
  }

  const tickets = list.data?.tickets ?? []
  const counters = list.data?.counters ?? {}

  function toggleSel(id: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  const allSelected = tickets.length > 0 && tickets.every((t) => selected.has(t.id))
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(tickets.map((t) => t.id)))
  }

  return (
    <Page
      title="Chamados"
      description="Central de chamados de suporte."
      actions={<Button variant="primary" size="sm" onClick={() => setCreating(true)}><Plus size={14} /> Novo chamado</Button>}
    >
      <HelpdeskTabs active="tickets" />
      {/* Linha 1: views por status (só na lista) + alternador Lista/Kanban */}
      <div class="flex flex-wrap items-center gap-2">
        {!kanban && (
          <>
            <button
              class={`text-xs px-3 py-1.5 rounded-md border ${statusFilter === '' ? 'bg-surface-2 border-border text-fg' : 'border-transparent text-fg-muted hover:bg-surface-2'}`}
              onClick={() => setStatusFilter('')}
            >
              Todos {counters.open_total != null ? `(${counters.open_total} abertos)` : ''}
            </button>
            {STATUSES.map((s) => (
              <button
                key={s}
                class={`text-xs px-3 py-1.5 rounded-md border ${statusFilter === s ? 'bg-surface-2 border-border text-fg' : 'border-transparent text-fg-muted hover:bg-surface-2'}`}
                onClick={() => setStatusFilter(s)}
              >
                {STATUS_LABEL[s]}{counters[s] ? ` (${counters[s]})` : ''}
              </button>
            ))}
          </>
        )}
        {kanban && <span class="text-xs text-fg-muted">Arraste os cartões para mudar o status (apenas transições válidas).</span>}
        <div class="ml-auto inline-flex rounded-md border border-border overflow-hidden">
          <button class={`text-xs px-3 py-1.5 inline-flex items-center gap-1 ${!kanban ? 'bg-surface-2 text-fg' : 'text-fg-muted hover:bg-surface-2'}`} onClick={() => changeView('list')}><List size={13} /> Lista</button>
          <button class={`text-xs px-3 py-1.5 inline-flex items-center gap-1 border-l border-border ${kanban ? 'bg-surface-2 text-fg' : 'text-fg-muted hover:bg-surface-2'}`} onClick={() => changeView('kanban')}><Columns size={13} /> Kanban</button>
        </div>
      </div>

      {/* Linha 2: filtros + busca */}
      <div class="flex flex-wrap items-center gap-2">
        <select class="text-xs rounded-md border border-border bg-surface px-2 py-1.5 text-fg" value={assigneeFilter} onChange={(e) => setAssigneeFilter((e.target as HTMLSelectElement).value)}>
          <option value="">Qualquer responsável</option>
          <option value="me">Meus</option>
          <option value="null">Não atribuídos</option>
        </select>
        <select class="text-xs rounded-md border border-border bg-surface px-2 py-1.5 text-fg" value={priorityFilter} onChange={(e) => setPriorityFilter((e.target as HTMLSelectElement).value)}>
          <option value="">Qualquer prioridade</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
        </select>
        <select class="text-xs rounded-md border border-border bg-surface px-2 py-1.5 text-fg" value={teamFilter} onChange={(e) => setTeamFilter((e.target as HTMLSelectElement).value)}>
          <option value="">Qualquer setor</option>
          {(teams.data?.teams ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <button class={`text-xs px-3 py-1.5 rounded-md border ${spamView ? 'bg-danger/10 border-danger/30 text-danger' : 'border-border text-fg-muted hover:bg-surface-2'}`} onClick={() => setSpamView((v) => !v)}>Spam</button>
        <div class="ml-auto w-56">
          <SearchInput value={search} onChange={setSearch} placeholder="Buscar nº, assunto, solicitante…" />
        </div>
      </div>

      {/* Barra de ações em massa (só na lista) */}
      {!kanban && selected.size > 0 && (
        <BulkBar
          ids={[...selected]}
          agents={agents.data?.agents ?? []}
          onDone={() => setSelected(new Set())}
        />
      )}

      {kanban ? (
        <KanbanBoard
          tickets={tickets}
          counters={counters}
          loading={list.isLoading}
          agents={agents.data?.agents ?? []}
          onOpen={(id) => setSelectedId(id)}
          onMove={(id, status) => update.mutate({ id, status })}
        />
      ) : list.isLoading ? (
        <div class="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} class="h-14 w-full" />)}</div>
      ) : tickets.length === 0 ? (
        <EmptyState
          icon={<LifeBuoy size={28} />}
          title="Nenhum chamado"
          description="Nenhum chamado com os filtros atuais."
          action={<Button variant="primary" size="sm" onClick={() => setCreating(true)}><Plus size={14} /> Novo chamado</Button>}
        />
      ) : (
        <Card class="divide-y divide-border p-0 overflow-hidden">
          <div class="flex items-center gap-3 px-4 py-2 bg-surface-2 text-xs text-fg-muted">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Selecionar todos" />
            <span>{selected.size > 0 ? `${selected.size} selecionado(s)` : `${list.data?.total ?? tickets.length} chamado(s)`}</span>
          </div>
          {tickets.map((t) => (
            <div key={t.id} class={`px-4 py-3 flex items-center gap-3 hover:bg-surface-2 ${selected.has(t.id) ? 'bg-accent/5' : ''}`}>
              <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggleSel(t.id)} aria-label={`Selecionar #${t.number}`} />
              <button class="flex-1 min-w-0 text-left flex items-center gap-3" onClick={() => setSelectedId(t.id)}>
                <span class="text-fg-muted text-xs font-mono inline-flex items-center gap-0.5 w-16 shrink-0">
                  <Hash size={11} />{t.number}
                </span>
                <span class="flex-1 min-w-0">
                  <span class="block truncate text-sm font-medium text-fg">{t.subject}</span>
                  <span class="block truncate text-xs text-fg-muted">
                    {t.requesterName || t.requesterEmail || 'Sem solicitante'} · {CHANNEL_LABEL[t.channel] || t.channel} · {fmt(t.lastActivityAt)}
                  </span>
                </span>
                <SlaBadge status={t.slaResolutionStatus} target={t.targetResolutionAt} />
                <Badge tone={PRIORITY_TONE[t.priority]}>{PRIORITY_LABEL[t.priority]}</Badge>
                <Badge tone={STATUS_TONE[t.status]} solid>{STATUS_LABEL[t.status]}</Badge>
              </button>
            </div>
          ))}
        </Card>
      )}

      <CreateTicketModal open={creating} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setSelectedId(id) }} />
    </Page>
  )
}

// ──────────────────────────── Kanban (visão por status) ────────────────────────────

function KanbanBoard({ tickets, counters, loading, agents, onOpen, onMove }: {
  tickets: Ticket[]
  counters: Record<string, number>
  loading: boolean
  agents: Array<{ id: number; name: string | null; email: string }>
  onOpen: (id: number) => void
  onMove: (id: number, status: TicketStatus) => void
}) {
  const agentName = (id: number | null) => { if (id == null) return null; const a = agents.find((x) => x.id === id); return a ? (a.name || a.email) : `#${id}` }
  // status do cartão sendo arrastado (para destacar só as colunas válidas)
  const [dragging, setDragging] = useState<{ id: number; from: TicketStatus } | null>(null)
  const [overCol, setOverCol] = useState<TicketStatus | null>(null)

  const byStatus: Record<string, Ticket[]> = {}
  for (const s of STATUSES) byStatus[s] = []
  for (const t of tickets) (byStatus[t.status] ?? (byStatus[t.status] = [])).push(t)

  const canDropHere = (col: TicketStatus) => dragging != null && (dragging.from === col || STATUS_TRANSITIONS[dragging.from]?.includes(col))

  function handleDrop(col: TicketStatus) {
    const d = dragging
    setDragging(null); setOverCol(null)
    if (!d || d.from === col) return
    if (!STATUS_TRANSITIONS[d.from]?.includes(col)) return // transição inválida → ignora
    onMove(d.id, col)
  }

  if (loading) {
    return <div class="flex gap-3 overflow-x-auto pb-2">{STATUSES.map((s) => <Skeleton key={s} class="h-64 w-72 shrink-0" />)}</div>
  }

  return (
    <div class="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
      {STATUSES.map((s) => {
        const items = byStatus[s] ?? []
        const total = counters[s] ?? items.length
        const droppable = canDropHere(s)
        const isOver = overCol === s && droppable
        const dim = dragging != null && !droppable
        return (
          <div
            key={s}
            class={`shrink-0 w-72 rounded-lg border flex flex-col max-h-[calc(100vh-18rem)] transition-colors ${isOver ? 'border-accent bg-accent/5' : droppable ? 'border-dashed border-accent/50' : 'border-border'} ${dim ? 'opacity-40' : ''}`}
            onDragOver={(e) => { if (droppable) { e.preventDefault(); setOverCol(s) } }}
            onDragLeave={() => { if (overCol === s) setOverCol(null) }}
            onDrop={(e) => { e.preventDefault(); handleDrop(s) }}
          >
            <div class="flex items-center justify-between px-3 py-2 border-b border-border sticky top-0 bg-surface rounded-t-lg">
              <span class="text-sm font-medium text-fg inline-flex items-center gap-1.5">
                <span class={`size-2 rounded-full ${STATUS_DOT[s]}`} />{STATUS_LABEL[s]}
              </span>
              <span class="text-xs text-fg-muted tabular-nums">{total}</span>
            </div>
            <div class="flex-1 overflow-y-auto p-2 space-y-2">
              {items.length === 0 ? (
                <p class="text-xs text-fg-subtle text-center py-6">{dragging ? (droppable ? 'Solte aqui' : '—') : 'Vazio'}</p>
              ) : (
                <>
                  {items.slice(0, COLUMN_CAP).map((t) => (
                    <KanbanCard key={t.id} t={t} assignee={agentName(t.assignedUserId)} onOpen={onOpen} onDragStart={() => setDragging({ id: t.id, from: t.status })} onDragEnd={() => { setDragging(null); setOverCol(null) }} />
                  ))}
                  {total > Math.min(items.length, COLUMN_CAP) && (
                    <p class="text-[11px] text-fg-muted text-center py-1">+{total - Math.min(items.length, COLUMN_CAP)} a mais — refine os filtros para ver</p>
                  )}
                </>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

const STATUS_DOT: Record<TicketStatus, string> = {
  new: 'bg-info', open: 'bg-accent', pending: 'bg-warning', on_hold: 'bg-warning', solved: 'bg-success', closed: 'bg-fg-subtle',
}

function KanbanCard({ t, assignee, onOpen, onDragStart, onDragEnd }: { t: Ticket; assignee: string | null; onOpen: (id: number) => void; onDragStart: () => void; onDragEnd: () => void }) {
  return (
    <div
      draggable
      onDragStart={(e) => { (e as DragEvent).dataTransfer?.setData('text/plain', String(t.id)); onDragStart() }}
      onDragEnd={onDragEnd}
      onClick={() => onOpen(t.id)}
      class="rounded-md border border-border bg-surface p-2.5 cursor-grab active:cursor-grabbing hover:border-accent/60 hover:shadow-sm space-y-1.5"
    >
      <div class="flex items-center gap-1.5 text-[11px] text-fg-muted">
        <Hash size={10} />{t.number}
        <span class="ml-auto"><Badge tone={PRIORITY_TONE[t.priority]}>{PRIORITY_LABEL[t.priority]}</Badge></span>
      </div>
      <div class="text-sm text-fg font-medium line-clamp-2 leading-snug">{t.subject}</div>
      <div class="flex items-center gap-2 text-[11px] text-fg-muted">
        <span class="truncate flex-1">{t.requesterName || t.requesterEmail || 'Sem solicitante'}</span>
        <SlaBadge status={t.slaResolutionStatus} target={t.targetResolutionAt} />
      </div>
      <div class="flex items-center gap-1.5 text-[11px] text-fg-subtle">
        <span>{CHANNEL_LABEL[t.channel] || t.channel}</span>
        <span class="ml-auto truncate max-w-[8rem]">{assignee ? <span class="inline-flex items-center gap-1"><UserPlus size={10} /> {assignee}</span> : 'sem dono'}</span>
      </div>
    </div>
  )
}

function fmtMins(m: number | null): string {
  if (m == null) return '—'
  if (m < 60) return `${m}min`
  if (m < 1440) return `${(m / 60).toFixed(1)}h`
  return `${(m / 1440).toFixed(1)}d`
}

export function HelpdeskReportsPage() {
  const [range, setRange] = useState('30d')
  const reports = useReports(range)
  const qa = useQaStats(range)
  const d = reports.data

  async function downloadCsv() {
    const token = localStorage.getItem(env.authTokenKey)
    const res = await fetch(`${env.apiBase}/admin/helpdesk/reports/export?range=${range}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `helpdesk-${range}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const maxTrend = Math.max(1, ...(d?.trend ?? []).map((t) => Math.max(t.created, t.solved)))

  return (
    <Page title="Relatórios & Analytics">
    <HelpdeskTabs active="reports" />
      <div class="space-y-4">
        <div class="flex items-center gap-2">
          {['7d', '30d', '90d'].map((r) => (
            <button key={r} class={`text-xs px-3 py-1.5 rounded-md border ${range === r ? 'bg-surface-2 border-border text-fg' : 'border-transparent text-fg-muted hover:bg-surface-2'}`} onClick={() => setRange(r)}>{r}</button>
          ))}
          <Button class="ml-auto" variant="secondary" size="sm" onClick={downloadCsv}><Download size={14} /> Exportar CSV</Button>
        </div>
        {!d ? <p class="text-xs text-fg-muted">Carregando…</p> : (
          <>
            <div class="grid grid-cols-4 gap-2">
              <KpiBox label="Criados" value={String(d.volume.created)} />
              <KpiBox label="Resolvidos" value={String(d.volume.solved)} />
              <KpiBox label="Backlog aberto" value={String(d.volume.backlog)} />
              <KpiBox label="Reaberturas" value={String(d.volume.reopened)} />
            </div>
            <div class="grid grid-cols-4 gap-2">
              <KpiBox label="SLA 1ª resposta" value={d.sla.frPct != null ? `${d.sla.frPct}%` : '—'} />
              <KpiBox label="SLA resolução" value={d.sla.resPct != null ? `${d.sla.resPct}%` : '—'} />
              <KpiBox label="TMR (1ª resp.)" value={fmtMins(d.times.avgFirstResponseMins)} />
              <KpiBox label="TMA (resolução)" value={fmtMins(d.times.avgResolutionMins)} />
            </div>

            <div class="grid grid-cols-2 gap-4">
              <DistBlock title="Por prioridade" items={d.byPriority} />
              <DistBlock title="Por canal" items={d.byChannel} />
            </div>

            <div>
              <h3 class="text-xs font-semibold uppercase tracking-wide text-fg-muted mb-2">Tendência ({range})</h3>
              <div class="flex items-end gap-0.5 h-24">
                {d.trend.map((t) => (
                  <div key={t.date} class="flex-1 flex flex-col justify-end gap-0.5" title={`${t.date}: ${t.created} criados / ${t.solved} resolvidos`}>
                    <div class="bg-accent/40" style={`height:${(t.created / maxTrend) * 100}%`} />
                    <div class="bg-success/60" style={`height:${(t.solved / maxTrend) * 100}%`} />
                  </div>
                ))}
              </div>
              <div class="text-xs text-fg-muted mt-1 flex gap-3"><span class="inline-flex items-center gap-1"><span class="size-2 bg-accent/40" /> criados</span><span class="inline-flex items-center gap-1"><span class="size-2 bg-success/60" /> resolvidos</span></div>
            </div>

            {d.byAgent.length > 0 && (
              <div>
                <h3 class="text-xs font-semibold uppercase tracking-wide text-fg-muted mb-2">Por agente</h3>
                <table class="w-full text-xs">
                  <thead><tr class="text-fg-muted text-left"><th class="py-1">Agente</th><th>Atribuídos</th><th>Resolvidos</th><th>TMA</th><th>Reab.</th><th>CSAT</th></tr></thead>
                  <tbody>
                    {d.byAgent.map((a) => (
                      <tr key={a.agentUserId} class="border-t border-border">
                        <td class="py-1 text-fg">{a.name}</td><td>{a.assigned}</td><td>{a.solved}</td><td>{fmtMins(a.avgResolutionMins)}</td><td>{a.reopened}</td><td>{a.csatAvg != null ? `${a.csatAvg}★` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {(qa.data?.reviewed ?? 0) > 0 && (
              <div>
                <h3 class="text-xs font-semibold uppercase tracking-wide text-fg-muted mb-2">Qualidade (QA) — {qa.data!.reviewed} auditados · média {qa.data!.avg}/100</h3>
                <div class="space-y-1">
                  {(qa.data?.byAgent ?? []).map((a) => (
                    <div key={a.agentUserId} class="flex items-center justify-between text-xs">
                      <span class="text-fg">{a.name}</span>
                      <span class="text-fg-muted">{a.avg}/100 · {a.count} auditoria(s)</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {d.volume.capped && <p class="text-xs text-warning">Amostra limitada a 5000 chamados do período.</p>}
          </>
        )}
      </div>
    </Page>
  )
}

function DistBlock({ title, items }: { title: string; items: Array<{ key: string; count: number }> }) {
  const max = Math.max(1, ...items.map((i) => i.count))
  return (
    <div>
      <h3 class="text-xs font-semibold uppercase tracking-wide text-fg-muted mb-2">{title}</h3>
      <div class="space-y-1">
        {items.map((i) => (
          <div key={i.key} class="flex items-center gap-2 text-xs">
            <span class="w-20 text-fg-muted truncate">{i.key}</span>
            <div class="flex-1 h-3 rounded bg-surface-2 overflow-hidden"><div class="h-full bg-accent" style={`width:${(i.count / max) * 100}%`} /></div>
            <span class="w-8 text-right text-fg">{i.count}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function HelpdeskOrgsPage() {
  const orgs = useOrganizations()
  const policies = useSlaPolicies()
  const save = useSaveOrganization()
  const del = useDeleteOrganization()
  const [editing, setEditing] = useState<Partial<Organization> | null>(null)
  const [domainsText, setDomainsText] = useState('')

  function startNew() { setEditing({ name: '', supportPlan: '', active: true }); setDomainsText('') }
  function startEdit(o: Organization) { setEditing(o); setDomainsText((o.domains || []).join(', ')) }
  async function submit() {
    if (!editing?.name?.trim()) return
    const domains = domainsText.split(',').map((d) => d.trim().toLowerCase()).filter(Boolean)
    await save.mutateAsync({ id: editing.id, name: editing.name.trim(), domains, supportPlan: editing.supportPlan || null, slaPolicyId: editing.slaPolicyId ?? null, notes: editing.notes ?? null })
    setEditing(null)
  }

  return (
    <Page title="Organizações (B2B)">
    <HelpdeskTabs active="orgs" />
      {editing ? (
        <div class="space-y-3">
          <Input label="Nome" value={editing.name ?? ''} onInput={(e) => setEditing({ ...editing, name: (e.target as HTMLInputElement).value })} placeholder="Ex.: Acme Corp" />
          <Input label="Domínios de e-mail (separados por vírgula)" value={domainsText} onInput={(e) => setDomainsText((e.target as HTMLInputElement).value)} placeholder="acme.com, acme.com.br" />
          <p class="text-xs text-fg-muted">Chamados de e-mails desses domínios são vinculados automaticamente a esta organização.</p>
          <div class="grid grid-cols-2 gap-2">
            <Input label="Plano de suporte" value={editing.supportPlan ?? ''} onInput={(e) => setEditing({ ...editing, supportPlan: (e.target as HTMLInputElement).value })} placeholder="Premium" />
            <Select label="Política de SLA (override)" value={editing.slaPolicyId ?? ''} onChange={(e) => setEditing({ ...editing, slaPolicyId: (e.target as HTMLSelectElement).value ? Number((e.target as HTMLSelectElement).value) : null })}>
              <option value="">— usar padrão</option>
              {(policies.data?.policies ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </div>
          <Textarea label="Notas" value={editing.notes ?? ''} onInput={(e) => setEditing({ ...editing, notes: (e.target as HTMLTextAreaElement).value })} rows={2} />
          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button variant="primary" size="sm" onClick={submit} disabled={!editing.name?.trim() || save.isPending}>Salvar</Button>
          </div>
        </div>
      ) : (
        <div class="space-y-3">
          <div class="flex justify-end"><Button variant="secondary" size="sm" onClick={startNew}><Plus size={14} /> Nova organização</Button></div>
          {(orgs.data?.organizations ?? []).map((o: Organization) => (
            <div key={o.id} class="flex items-center gap-2 rounded-md border border-border px-3 py-2">
              <button class="flex-1 min-w-0 text-left" onClick={() => startEdit(o)}>
                <div class="text-sm text-fg flex items-center gap-2">{o.name} {o.supportPlan && <Badge tone="info">{o.supportPlan}</Badge>} {!o.active && <Badge tone="neutral">inativa</Badge>}</div>
                <div class="text-xs text-fg-muted truncate">{(o.domains || []).join(', ') || 'sem domínios'} · {o.openTickets ?? 0} aberto(s)</div>
              </button>
              <button class="text-fg-muted hover:text-danger" onClick={() => del.mutate(o.id)}><Trash2 size={14} /></button>
            </div>
          ))}
          {(orgs.data?.organizations?.length ?? 0) === 0 && <p class="text-xs text-fg-muted">Nenhuma organização. Crie a primeira para vincular chamados por domínio.</p>}
        </div>
      )}
    </Page>
  )
}

export function HelpdeskCsatPage() {
  const [range, setRange] = useState('30d')
  const stats = useCsatStats(range)
  const d = stats.data
  const maxDist = Math.max(1, ...(d?.distribution ?? []).map((x) => x.count))
  return (
    <Page title="Satisfação (CSAT)">
    <HelpdeskTabs active="csat" />
      <div class="space-y-4">
        <div class="flex gap-1">
          {['7d', '30d', '90d'].map((r) => (
            <button key={r} class={`text-xs px-3 py-1.5 rounded-md border ${range === r ? 'bg-surface-2 border-border text-fg' : 'border-transparent text-fg-muted hover:bg-surface-2'}`} onClick={() => setRange(r)}>{r}</button>
          ))}
        </div>
        {!d ? <p class="text-xs text-fg-muted">Carregando…</p> : (
          <>
            <div class="grid grid-cols-4 gap-2">
              <KpiBox label="CSAT" value={d.csatPct != null ? `${d.csatPct}%` : '—'} />
              <KpiBox label="Nota média" value={d.avg != null ? d.avg.toFixed(1) : '—'} />
              <KpiBox label="Respostas" value={String(d.responded)} />
              <KpiBox label="Taxa resposta" value={`${d.responseRate}%`} />
            </div>
            <div>
              <h3 class="text-xs font-semibold uppercase tracking-wide text-fg-muted mb-2">Distribuição</h3>
              <div class="space-y-1">
                {d.distribution.slice().reverse().map((x) => (
                  <div key={x.rating} class="flex items-center gap-2 text-xs">
                    <span class="w-10 text-fg-muted inline-flex items-center gap-0.5">{x.rating}<Star size={11} /></span>
                    <div class="flex-1 h-3 rounded bg-surface-2 overflow-hidden"><div class="h-full bg-accent" style={`width:${(x.count / maxDist) * 100}%`} /></div>
                    <span class="w-8 text-right text-fg">{x.count}</span>
                  </div>
                ))}
              </div>
            </div>
            {d.byAgent.length > 0 && (
              <div>
                <h3 class="text-xs font-semibold uppercase tracking-wide text-fg-muted mb-2">Por agente</h3>
                <div class="space-y-1">
                  {d.byAgent.map((a) => (
                    <div key={a.agentUserId} class="flex items-center justify-between text-xs">
                      <span class="text-fg">{a.name}</span>
                      <span class="text-fg-muted">{a.avg != null ? a.avg.toFixed(1) : '—'} ★ · {a.count} resp.</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {d.recentComments.length > 0 && (
              <div>
                <h3 class="text-xs font-semibold uppercase tracking-wide text-fg-muted mb-2">Comentários recentes</h3>
                <div class="space-y-1">
                  {d.recentComments.map((c, i) => (
                    <div key={i} class="text-xs rounded-md border border-border px-2 py-1.5">
                      <span class={c.rating && c.rating >= 4 ? 'text-success' : c.rating && c.rating <= 2 ? 'text-danger' : 'text-warning'}>{c.rating}★</span>
                      <span class="text-fg"> — {c.comment}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Page>
  )
}

function KpiBox({ label, value }: { label: string; value: string }) {
  return (
    <div class="rounded-md border border-border p-2 text-center">
      <div class="text-lg font-semibold text-fg">{value}</div>
      <div class="text-xs text-fg-muted">{label}</div>
    </div>
  )
}

export function HelpdeskKbPage() {
  const categories = useKbCategories()
  const saveCat = useSaveKbCategory()
  const delCat = useDeleteKbCategory()
  const articles = useKbArticles()
  const saveArt = useSaveKbArticle()
  const delArt = useDeleteKbArticle()
  const [editing, setEditing] = useState<Partial<KbArticle> | null>(null)
  const [newCat, setNewCat] = useState('')

  const cats = categories.data?.categories ?? []
  const arts = articles.data?.articles ?? []
  const catName = (id: number | null) => cats.find((c) => c.id === id)?.name ?? '—'

  async function saveArticle() {
    if (!editing?.title?.trim()) return
    await saveArt.mutateAsync({
      id: editing.id,
      title: editing.title.trim(),
      categoryId: editing.categoryId ?? null,
      excerpt: editing.excerpt ?? null,
      body: editing.body ?? '',
      keywords: editing.keywords ?? null,
      status: editing.status ?? 'draft',
      visibility: editing.visibility ?? 'public',
    })
    setEditing(null)
  }

  return (
    <Page title="Base de Conhecimento">
    <HelpdeskTabs active="kb" />
      {editing ? (
        <div class="space-y-3">
          <Input label="Título" value={editing.title ?? ''} onInput={(e) => setEditing({ ...editing, title: (e.target as HTMLInputElement).value })} placeholder="Ex.: Como redefinir a senha" />
          <div class="grid grid-cols-3 gap-2">
            <Select label="Categoria" value={editing.categoryId ?? ''} onChange={(e) => setEditing({ ...editing, categoryId: (e.target as HTMLSelectElement).value ? Number((e.target as HTMLSelectElement).value) : null })}>
              <option value="">— sem categoria</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            <Select label="Status" value={editing.status ?? 'draft'} onChange={(e) => setEditing({ ...editing, status: (e.target as HTMLSelectElement).value as 'draft' | 'published' })}>
              <option value="draft">Rascunho</option><option value="published">Publicado</option>
            </Select>
            <Select label="Visibilidade" value={editing.visibility ?? 'public'} onChange={(e) => setEditing({ ...editing, visibility: (e.target as HTMLSelectElement).value as 'public' | 'internal' })}>
              <option value="public">Pública</option><option value="internal">Interna (agentes)</option>
            </Select>
          </div>
          <Input label="Resumo (excerpt)" value={editing.excerpt ?? ''} onInput={(e) => setEditing({ ...editing, excerpt: (e.target as HTMLInputElement).value })} placeholder="Aparece na busca e nas sugestões" />
          <Textarea label="Conteúdo (HTML/markdown)" value={editing.body ?? ''} onInput={(e) => setEditing({ ...editing, body: (e.target as HTMLTextAreaElement).value })} rows={6} placeholder="Corpo do artigo…" />
          <Input label="Palavras-chave (busca)" value={editing.keywords ?? ''} onInput={(e) => setEditing({ ...editing, keywords: (e.target as HTMLInputElement).value })} placeholder="senha, login, acesso" />
          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button variant="primary" size="sm" onClick={saveArticle} disabled={!editing.title?.trim() || saveArt.isPending}>Salvar artigo</Button>
          </div>
        </div>
      ) : (
        <div class="space-y-4">
          {/* Categorias */}
          <div>
            <h3 class="text-xs font-semibold uppercase tracking-wide text-fg-muted mb-2">Categorias</h3>
            <div class="flex flex-wrap gap-1.5 mb-2">
              {cats.map((c: KbCategory) => (
                <span key={c.id} class="inline-flex items-center gap-1 text-xs rounded-full border border-border px-2 py-1 text-fg">
                  {c.name} <span class="text-fg-subtle">({c._count?.articles ?? 0})</span>
                  <button class="text-fg-muted hover:text-danger" onClick={() => delCat.mutate(c.id)}><X size={11} /></button>
                </span>
              ))}
            </div>
            <div class="flex gap-1">
              <Input value={newCat} onInput={(e) => setNewCat((e.target as HTMLInputElement).value)} placeholder="Nova categoria" onKeyDown={(e) => { if ((e as KeyboardEvent).key === 'Enter' && newCat.trim()) { saveCat.mutate({ name: newCat.trim() }); setNewCat('') } }} />
              <Button variant="secondary" size="sm" iconOnly onClick={() => { if (newCat.trim()) { saveCat.mutate({ name: newCat.trim() }); setNewCat('') } }}><Plus size={14} /></Button>
            </div>
          </div>

          {/* Artigos */}
          <div>
            <div class="flex items-center justify-between mb-2">
              <h3 class="text-xs font-semibold uppercase tracking-wide text-fg-muted">Artigos</h3>
              <Button variant="secondary" size="sm" onClick={() => setEditing({ status: 'draft', visibility: 'public' })}><Plus size={14} /> Novo artigo</Button>
            </div>
            <div class="space-y-1">
              {arts.map((a: KbArticle) => (
                <div key={a.id} class="flex items-center gap-2 rounded-md border border-border px-3 py-2">
                  <button class="flex-1 min-w-0 text-left" onClick={() => setEditing(a)}>
                    <div class="text-sm text-fg truncate">{a.title}</div>
                    <div class="text-xs text-fg-muted flex items-center gap-2">
                      <Badge tone={a.status === 'published' ? 'success' : 'neutral'}>{a.status === 'published' ? 'Publicado' : 'Rascunho'}</Badge>
                      {a.visibility === 'internal' && <Badge tone="warning">interno</Badge>}
                      <span>{catName(a.categoryId)}</span>
                      <span class="inline-flex items-center gap-0.5"><Eye size={11} />{a.viewCount}</span>
                    </div>
                  </button>
                  <button class="text-fg-muted hover:text-danger" onClick={() => delArt.mutate(a.id)}><Trash2 size={14} /></button>
                </div>
              ))}
              {arts.length === 0 && <p class="text-xs text-fg-muted">Nenhum artigo. Crie o primeiro.</p>}
            </div>
          </div>
        </div>
      )}
    </Page>
  )
}

const STATUS_OPTS = STATUSES.map((s) => ({ v: s, l: STATUS_LABEL[s] }))
const PRIO_OPTS = (['low', 'normal', 'high', 'urgent'] as TicketPriority[]).map((p) => ({ v: p, l: PRIORITY_LABEL[p] }))

function actionSummary(a: Record<string, unknown>): string {
  const parts: string[] = []
  if (a.setStatus) parts.push(`status→${STATUS_LABEL[a.setStatus as TicketStatus] || a.setStatus}`)
  if (a.setPriority) parts.push(`prioridade→${PRIORITY_LABEL[a.setPriority as TicketPriority] || a.setPriority}`)
  if (Array.isArray(a.addTagIds) && a.addTagIds.length) parts.push(`+${a.addTagIds.length} tag(s)`)
  return parts.join(' · ') || 'sem ações'
}

export function HelpdeskAutomationPage() {
  const [tab, setTab] = useState<'macros' | 'triggers' | 'automations'>('macros')
  return (
    <Page title="Automação">
    <HelpdeskTabs active="automation" />
      <div class="space-y-4">
        <div class="flex gap-1 border-b border-border">
          {(['macros', 'triggers', 'automations'] as const).map((t) => (
            <button key={t} class={`text-xs px-3 py-2 -mb-px border-b-2 ${tab === t ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:text-fg'}`} onClick={() => setTab(t)}>
              {t === 'macros' ? 'Macros' : t === 'triggers' ? 'Triggers' : 'Automations'}
            </button>
          ))}
        </div>
        {tab === 'macros' && <MacrosTab />}
        {tab === 'triggers' && <TriggersTab />}
        {tab === 'automations' && <AutomationsTab />}
      </div>
    </Page>
  )
}

function MacrosTab() {
  const macros = useMacros()
  const save = useSaveMacro()
  const del = useDeleteMacro()
  const [name, setName] = useState('')
  const [setStatus, setSt] = useState('')
  const [setPriority, setPr] = useState('')
  const [reply, setReply] = useState('')
  function create() {
    if (!name.trim()) return
    const actions: any = {}
    if (setStatus) actions.setStatus = setStatus
    if (setPriority) actions.setPriority = setPriority
    save.mutate({ name: name.trim(), actions, replyTemplate: reply.trim() || null }, { onSuccess: () => { setName(''); setSt(''); setPr(''); setReply('') } })
  }
  return (
    <div class="space-y-3">
      <p class="text-xs text-fg-muted">Aplicadas pelo agente com 1 clique no compositor. A resposta volta para revisão antes de enviar. Variáveis: <code class="text-fg">{'{{requester.name}}'}</code>, <code class="text-fg">{'{{ticket.number}}'}</code>.</p>
      {(macros.data?.macros ?? []).map((m: Macro) => (
        <div key={m.id} class="flex items-center gap-2 rounded-md border border-border px-3 py-2">
          <div class="flex-1 min-w-0">
            <div class="text-sm text-fg">{m.name} {!m.active && <Badge tone="neutral">inativa</Badge>}</div>
            <div class="text-xs text-fg-muted truncate">{actionSummary(m.actions)}{m.replyTemplate ? ' · com resposta' : ''} · usada {m.usageCount}×</div>
          </div>
          <button class="text-fg-muted hover:text-danger" onClick={() => del.mutate(m.id)}><Trash2 size={14} /></button>
        </div>
      ))}
      <Card class="space-y-2">
        <Input label="Nome da macro" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} placeholder="Ex.: Pedir mais informações" />
        <div class="grid grid-cols-2 gap-2">
          <Select label="Definir status" value={setStatus} onChange={(e) => setSt((e.target as HTMLSelectElement).value)}>
            <option value="">— manter</option>{STATUS_OPTS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
          </Select>
          <Select label="Definir prioridade" value={setPriority} onChange={(e) => setPr((e.target as HTMLSelectElement).value)}>
            <option value="">— manter</option>{PRIO_OPTS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
          </Select>
        </div>
        <Textarea label="Texto de resposta (opcional)" value={reply} onInput={(e) => setReply((e.target as HTMLTextAreaElement).value)} rows={2} placeholder="Olá {{requester.name}}, …" />
        <div class="flex justify-end"><Button variant="primary" size="sm" onClick={create} disabled={!name.trim() || save.isPending}>Criar macro</Button></div>
      </Card>
    </div>
  )
}

function TriggersTab() {
  const triggers = useTriggers()
  const save = useSaveTrigger()
  const del = useDeleteTrigger()
  const [name, setName] = useState('')
  const [event, setEvent] = useState('created')
  const [condPriority, setCondPriority] = useState('')
  const [setStatus, setSt] = useState('')
  const [setPriority, setPr] = useState('')
  function create() {
    if (!name.trim()) return
    const conditions: any = {}
    if (condPriority) conditions.priorities = [condPriority]
    const actions: any = {}
    if (setStatus) actions.setStatus = setStatus
    if (setPriority) actions.setPriority = setPriority
    save.mutate({ name: name.trim(), event, conditions, actions }, { onSuccess: () => { setName(''); setCondPriority(''); setSt(''); setPr('') } })
  }
  const EVENT_LABEL: Record<string, string> = { created: 'Ao criar', replied: 'Ao responder', status_changed: 'Ao mudar status' }
  return (
    <div class="space-y-3">
      <p class="text-xs text-fg-muted">Executam ações automaticamente quando um evento ocorre e as condições casam.</p>
      {(triggers.data?.triggers ?? []).map((t: Trigger) => (
        <div key={t.id} class="flex items-center gap-2 rounded-md border border-border px-3 py-2">
          <div class="flex-1 min-w-0">
            <div class="text-sm text-fg">{t.name} <Badge tone="info">{EVENT_LABEL[t.event] || t.event}</Badge> {!t.active && <Badge tone="neutral">inativo</Badge>}</div>
            <div class="text-xs text-fg-muted truncate">{actionSummary(t.actions)} · {t.runCount}× executado</div>
          </div>
          <button class="text-fg-muted hover:text-danger" onClick={() => del.mutate(t.id)}><Trash2 size={14} /></button>
        </div>
      ))}
      <Card class="space-y-2">
        <Input label="Nome" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} placeholder="Ex.: Urgente → equipe N2" />
        <div class="grid grid-cols-2 gap-2">
          <Select label="Quando" value={event} onChange={(e) => setEvent((e.target as HTMLSelectElement).value)}>
            <option value="created">Ao criar</option><option value="replied">Ao responder</option><option value="status_changed">Ao mudar status</option>
          </Select>
          <Select label="Se prioridade for" value={condPriority} onChange={(e) => setCondPriority((e.target as HTMLSelectElement).value)}>
            <option value="">— qualquer</option>{PRIO_OPTS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
          </Select>
          <Select label="Então status" value={setStatus} onChange={(e) => setSt((e.target as HTMLSelectElement).value)}>
            <option value="">— manter</option>{STATUS_OPTS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
          </Select>
          <Select label="Então prioridade" value={setPriority} onChange={(e) => setPr((e.target as HTMLSelectElement).value)}>
            <option value="">— manter</option>{PRIO_OPTS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
          </Select>
        </div>
        <div class="flex justify-end"><Button variant="primary" size="sm" onClick={create} disabled={!name.trim() || save.isPending}>Criar trigger</Button></div>
      </Card>
    </div>
  )
}

function AutomationsTab() {
  const autos = useAutomations()
  const save = useSaveAutomation()
  const del = useDeleteAutomation()
  const [name, setName] = useState('')
  const [condStatus, setCondStatus] = useState('')
  const [older, setOlder] = useState(1440)
  const [setStatus, setSt] = useState('solved')
  function create() {
    if (!name.trim()) return
    const conditions: any = {}
    if (condStatus) conditions.statuses = [condStatus]
    if (older > 0) conditions.olderThanMins = older
    const actions: any = {}
    if (setStatus) actions.setStatus = setStatus
    save.mutate({ name: name.trim(), conditions, actions }, { onSuccess: () => { setName(''); setCondStatus('') } })
  }
  return (
    <div class="space-y-3">
      <p class="text-xs text-fg-muted">Rodam por tempo (a cada 2 min). Ex.: "pendente sem atividade há 1 dia → fechar".</p>
      {(autos.data?.automations ?? []).map((a: Automation) => (
        <div key={a.id} class="flex items-center gap-2 rounded-md border border-border px-3 py-2">
          <div class="flex-1 min-w-0">
            <div class="text-sm text-fg">{a.name} {!a.active && <Badge tone="neutral">inativa</Badge>}</div>
            <div class="text-xs text-fg-muted truncate">{actionSummary(a.actions)} · {a.runCount}× aplicada</div>
          </div>
          <button class="text-fg-muted hover:text-danger" onClick={() => del.mutate(a.id)}><Trash2 size={14} /></button>
        </div>
      ))}
      <Card class="space-y-2">
        <Input label="Nome" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} placeholder="Ex.: Fechar resolvidos antigos" />
        <div class="grid grid-cols-3 gap-2 items-end">
          <Select label="Status atual" value={condStatus} onChange={(e) => setCondStatus((e.target as HTMLSelectElement).value)}>
            <option value="">— qualquer</option>{STATUS_OPTS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
          </Select>
          <div>
            <label class="text-xs text-fg-muted block mb-1">Sem atividade há (min)</label>
            <input type="number" min="0" class="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-fg text-sm" value={older} onInput={(e) => setOlder(Number((e.target as HTMLInputElement).value))} />
          </div>
          <Select label="Então status" value={setStatus} onChange={(e) => setSt((e.target as HTMLSelectElement).value)}>
            <option value="">— manter</option>{STATUS_OPTS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
          </Select>
        </div>
        <div class="flex justify-end"><Button variant="primary" size="sm" onClick={create} disabled={!name.trim() || save.isPending}>Criar automação</Button></div>
      </Card>
    </div>
  )
}

const PRIO_ORDER: TicketPriority[] = ['urgent', 'high', 'normal', 'low']
const DEFAULT_FR: Record<string, number> = { urgent: 15, high: 30, normal: 120, low: 240 }
const DEFAULT_RES: Record<string, number> = { urgent: 120, high: 480, normal: 1440, low: 2880 }

export function HelpdeskSlaPage() {
  const policies = useSlaPolicies()
  const calendars = useCalendars()
  const savePolicy = useSavePolicy()
  const delPolicy = useDeletePolicy()
  const createCal = useCreateCalendar()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [fr, setFr] = useState<Record<string, number>>({ ...DEFAULT_FR })
  const [res, setRes] = useState<Record<string, number>>({ ...DEFAULT_RES })
  const [next, setNext] = useState<Record<string, number>>({ urgent: 0, high: 0, normal: 0, low: 0 })
  const [useBH, setUseBH] = useState(false)
  const [calendarId, setCalendarId] = useState<string>('')

  function resetForm() { setName(''); setFr({ ...DEFAULT_FR }); setRes({ ...DEFAULT_RES }); setNext({ urgent: 0, high: 0, normal: 0, low: 0 }); setUseBH(false); setCalendarId(''); setCreating(false) }
  async function submit() {
    if (!name.trim()) return
    // só envia nextResponseMins se ao menos uma prioridade tiver meta > 0
    const nextResponseMins = Object.values(next).some((v) => v > 0) ? next : undefined
    await savePolicy.mutateAsync({ name: name.trim(), conditions: {}, firstResponseMins: fr, resolutionMins: res, nextResponseMins, useBusinessHours: useBH, calendarId: useBH && calendarId ? Number(calendarId) : null, active: true })
    resetForm()
  }
  async function makeDefaultCalendar() {
    const wh: Record<string, Array<{ start: string; end: string }>> = {}
    for (const d of ['1', '2', '3', '4', '5']) wh[d] = [{ start: '09:00', end: '18:00' }]
    await createCal.mutateAsync({ name: 'Comercial (Seg-Sex 9-18)', timezone: 'America/Sao_Paulo', weekdayHours: wh, holidays: [] })
  }

  const cals = calendars.data?.calendars ?? []

  return (
    <Page title="Políticas de SLA">
    <HelpdeskTabs active="sla" />
      <div class="space-y-4">
        <p class="text-xs text-fg-muted">Metas de 1ª resposta e resolução por prioridade. A primeira política ativa cujas condições casam é aplicada. Minutos; deixe 0 para não definir meta.</p>

        {/* lista */}
        <div class="space-y-2">
          {(policies.data?.policies ?? []).map((p: SlaPolicy) => (
            <div key={p.id} class="flex items-center gap-2 rounded-md border border-border px-3 py-2">
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium text-fg flex items-center gap-2">
                  {p.name}
                  {!p.active && <Badge tone="neutral">inativa</Badge>}
                  {p.useBusinessHours ? <Badge tone="info">horário comercial</Badge> : <Badge tone="neutral">24/7</Badge>}
                </div>
                <div class="text-xs text-fg-muted">
                  Resolução: {PRIO_ORDER.map((pr) => `${PRIORITY_LABEL[pr]} ${p.resolutionMins?.[pr] ?? '—'}m`).join(' · ')}
                </div>
              </div>
              <button class="text-fg-muted hover:text-danger" onClick={() => delPolicy.mutate(p.id)}><Trash2 size={14} /></button>
            </div>
          ))}
          {(policies.data?.policies?.length ?? 0) === 0 && <p class="text-xs text-fg-muted">Nenhuma política. Crie a primeira abaixo.</p>}
        </div>

        {!creating ? (
          <Button variant="secondary" size="sm" onClick={() => setCreating(true)}><Plus size={14} /> Nova política</Button>
        ) : (
          <Card class="space-y-3">
            <Input label="Nome" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} placeholder="Ex.: Padrão" />
            <div class="grid grid-cols-[1fr_auto_auto_auto] gap-2 items-center text-xs">
              <span class="text-fg-muted">Prioridade</span><span class="text-fg-muted text-center">1ª resp. (min)</span><span class="text-fg-muted text-center">Resolução (min)</span><span class="text-fg-muted text-center">Próx. resp. (min)</span>
              {PRIO_ORDER.map((pr) => (
                <Fragment key={pr}>
                  <span class="text-fg">{PRIORITY_LABEL[pr]}</span>
                  <input type="number" min="0" class="w-20 rounded-md border border-border bg-surface px-2 py-1 text-fg" value={fr[pr]} onInput={(e) => setFr({ ...fr, [pr]: Number((e.target as HTMLInputElement).value) })} />
                  <input type="number" min="0" class="w-20 rounded-md border border-border bg-surface px-2 py-1 text-fg" value={res[pr]} onInput={(e) => setRes({ ...res, [pr]: Number((e.target as HTMLInputElement).value) })} />
                  <input type="number" min="0" class="w-20 rounded-md border border-border bg-surface px-2 py-1 text-fg" value={next[pr]} onInput={(e) => setNext({ ...next, [pr]: Number((e.target as HTMLInputElement).value) })} />
                </Fragment>
              ))}
            </div>
            <p class="text-[11px] text-fg-subtle">"Próxima resposta": prazo para o agente responder após cada nova mensagem do cliente (0 = sem meta).</p>
            <label class="flex items-center gap-2 text-xs text-fg cursor-pointer">
              <input type="checkbox" checked={useBH} onChange={(e) => setUseBH((e.target as HTMLInputElement).checked)} />
              Respeitar horário comercial (calendário)
            </label>
            {useBH && (
              cals.length === 0 ? (
                <Button variant="secondary" size="sm" onClick={makeDefaultCalendar}>Criar calendário padrão (Seg-Sex 9-18)</Button>
              ) : (
                <Select value={calendarId} onChange={(e) => setCalendarId((e.target as HTMLSelectElement).value)}>
                  <option value="">— Selecione o calendário</option>
                  {cals.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              )
            )}
            <div class="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={resetForm}>Cancelar</Button>
              <Button variant="primary" size="sm" onClick={submit} disabled={!name.trim() || savePolicy.isPending}>Criar política</Button>
            </div>
          </Card>
        )}
      </div>
    </Page>
  )
}

export function HelpdeskChannelsPage() {
  const settings = useHelpdeskSettings()
  const save = useSaveHelpdeskSettings()
  const teams = useTeams()
  const [secret, setSecret] = useState<string | null>(null)
  const inboundUrl = secret ? `${window.location.origin}/api/v1/helpdesk/inbound-email?secret=${secret}` : null

  return (
    <Page title="Canais de entrada">
    <HelpdeskTabs active="channels" />
      <div class="space-y-4">
        <div>
          <label class="text-xs text-fg-muted block mb-1">Setor padrão (roteamento de entrada)</label>
          <Select
            value={settings.data?.defaultTeamId ?? ''}
            onChange={(e) => { const v = (e.target as HTMLSelectElement).value; save.mutate({ defaultTeamId: v ? Number(v) : null }) }}
          >
            <option value="">— Sem setor (fila geral)</option>
            {(teams.data?.teams ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
          <p class="text-xs text-fg-muted mt-1">Chamados que entram por e-mail, web ou API são direcionados a este setor.</p>
        </div>

        <div class="border-t border-border pt-3">
          <label class="flex items-center gap-2 text-sm text-fg cursor-pointer">
            <input type="checkbox" checked={settings.data?.autoAssign !== false} onChange={(e) => save.mutate({ autoAssign: (e.target as HTMLInputElement).checked })} />
            Atribuição automática
          </label>
          <p class="text-xs text-fg-muted mt-1">Distribui o chamado a um operador do setor pelo modo de roteamento configurado (round-robin / menor carga / aleatório), respeitando capacidade e horário.</p>
          <label class="flex items-center gap-2 text-sm text-fg cursor-pointer mt-3">
            <input type="checkbox" checked={settings.data?.notifyAgents !== false} onChange={(e) => save.mutate({ notifyAgents: (e.target as HTMLInputElement).checked })} />
            Notificar agentes
          </label>
          <p class="text-xs text-fg-muted mt-1">Avisa o agente responsável por e-mail e WhatsApp em: atribuição, SLA em risco/estouro e nova resposta do cliente.</p>
        </div>

        <div class="border-t border-border pt-3">
          <div class="flex items-center justify-between">
            <span class="text-sm font-medium text-fg">E-mail → Chamado</span>
            <Badge tone={settings.data?.inboundEmailConfigured || secret ? 'success' : 'neutral'}>
              {settings.data?.inboundEmailConfigured || secret ? 'Configurado' : 'Não configurado'}
            </Badge>
          </div>
          <p class="text-xs text-fg-muted mt-1">
            Gere um segredo e configure o webhook de <em>inbound parse</em> do seu provedor de e-mail (Mailgun, SendGrid, Postmark…) para a URL abaixo. Respostas com <code class="text-fg">#protocolo</code> no assunto entram na mesma thread.
          </p>
          <Button variant="secondary" size="sm" class="mt-2" onClick={async () => { const r = await save.mutateAsync({ regenerateInboundSecret: true }); if (r.inboundEmailSecret) setSecret(r.inboundEmailSecret) }} disabled={save.isPending}>
            {settings.data?.inboundEmailConfigured ? 'Gerar novo segredo' : 'Gerar segredo'}
          </Button>
          {inboundUrl && (
            <div class="mt-2 rounded-md bg-surface-2 p-2 text-xs break-all flex items-start gap-2">
              <span class="flex-1 font-mono text-fg">{inboundUrl}</span>
              <button class="text-fg-muted hover:text-fg shrink-0" onClick={() => navigator.clipboard?.writeText(inboundUrl)} title="Copiar"><Copy size={13} /></button>
            </div>
          )}
          {secret && <p class="text-xs text-warning mt-1">Copie agora — o segredo não será exibido novamente.</p>}
        </div>
      </div>
    </Page>
  )
}

function BulkBar({ ids, agents, onDone }: { ids: number[]; agents: Array<{ id: number; name: string | null; email: string }>; onDone: () => void }) {
  const bulk = useBulkAction()
  function run(action: BulkAction, value?: string | number | null) {
    bulk.mutate({ ids, action, value }, { onSuccess: onDone })
  }
  return (
    <Card class="flex flex-wrap items-center gap-2 p-2 bg-accent/5 border-accent/30">
      <span class="text-xs font-medium text-fg px-1">{ids.length} selecionado(s):</span>
      <select class="text-xs rounded-md border border-border bg-surface px-2 py-1.5 text-fg" onChange={(e) => { const v = (e.target as HTMLSelectElement).value; if (v) { run('status', v); (e.target as HTMLSelectElement).value = '' } }}>
        <option value="">Mudar status…</option>
        {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
      </select>
      <select class="text-xs rounded-md border border-border bg-surface px-2 py-1.5 text-fg" onChange={(e) => { const v = (e.target as HTMLSelectElement).value; if (v) { run('priority', v); (e.target as HTMLSelectElement).value = '' } }}>
        <option value="">Prioridade…</option>
        {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
      </select>
      <select class="text-xs rounded-md border border-border bg-surface px-2 py-1.5 text-fg" onChange={(e) => { const v = (e.target as HTMLSelectElement).value; run('assign', v === 'null' ? null : Number(v)); (e.target as HTMLSelectElement).value = '' }}>
        <option value="">Atribuir a…</option>
        <option value="null">Ninguém</option>
        {agents.map((a) => <option key={a.id} value={a.id}>{a.name || a.email}</option>)}
      </select>
      <Button variant="secondary" size="sm" onClick={() => run('spam', true)} disabled={bulk.isPending}>Spam</Button>
      <Button variant="danger" size="sm" onClick={() => { if (confirm(`Excluir ${ids.length} chamado(s)?`)) run('delete') }} disabled={bulk.isPending}>
        <Trash2 size={13} /> Excluir
      </Button>
      <button class="text-xs text-fg-muted hover:text-fg ml-auto" onClick={onDone}>Limpar seleção</button>
    </Card>
  )
}

function CreateTicketModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: number) => void }) {
  const create = useCreateTicket()
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<TicketPriority>('normal')
  const [requesterName, setRequesterName] = useState('')
  const [requesterEmail, setRequesterEmail] = useState('')
  const suggestions = useKbSuggest(subject)

  function reset() { setSubject(''); setDescription(''); setPriority('normal'); setRequesterName(''); setRequesterEmail('') }

  async function submit() {
    if (!subject.trim()) return
    const res = await create.mutateAsync({
      subject: subject.trim(),
      description: description.trim() || undefined,
      priority,
      requesterName: requesterName.trim() || undefined,
      requesterEmail: requesterEmail.trim() || undefined,
    })
    reset()
    onCreated(res.ticket.id)
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o) => { if (!o) { reset(); onClose() } }}
      title="Novo chamado"
      footer={
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => { reset(); onClose() }}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={submit} disabled={!subject.trim() || create.isPending}>
            {create.isPending ? 'Criando…' : 'Criar chamado'}
          </Button>
        </div>
      }
    >
      <div class="space-y-3">
        <Input label="Assunto *" value={subject} onInput={(e) => setSubject((e.target as HTMLInputElement).value)} placeholder="Resumo do problema" />
        {(suggestions.data?.articles?.length ?? 0) > 0 && (
          <div class="rounded-md bg-info/5 border border-info/20 p-2 space-y-1">
            <div class="text-xs text-fg-muted flex items-center gap-1"><BookOpen size={12} /> Artigos relacionados na base:</div>
            {(suggestions.data?.articles ?? []).map((s) => (
              <div key={s.id} class="text-xs text-fg truncate">• {s.title}</div>
            ))}
          </div>
        )}
        <Textarea label="Descrição" value={description} onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)} placeholder="Detalhes do chamado (vira a primeira mensagem da thread)" rows={4} />
        <Select label="Prioridade" value={priority} onChange={(e) => setPriority((e.target as HTMLSelectElement).value as TicketPriority)}>
          {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
        </Select>
        <div class="grid grid-cols-2 gap-3">
          <Input label="Solicitante" value={requesterName} onInput={(e) => setRequesterName((e.target as HTMLInputElement).value)} placeholder="Nome" />
          <Input label="E-mail" value={requesterEmail} onInput={(e) => setRequesterEmail((e.target as HTMLInputElement).value)} placeholder="email@exemplo.com" />
        </div>
      </div>
    </Modal>
  )
}

function TicketDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const detail = useTicket(id)
  const update = useUpdateTicket()
  const addComment = useAddComment(id)
  const actions = useTicketActions(id)
  const presence = usePresence(id)
  const macros = useMacros()
  const applyMacro = useApplyMacro(id)
  const aiStatus = useAiStatus()
  const ai = useTicketAi(id)
  const [reply, setReply] = useState('')
  const [internal, setInternal] = useState(false)
  const [aiBox, setAiBox] = useState<{ kind: 'summary' | 'triage' | 'error'; text?: string; triage?: { priority: string; type: string; sentiment: string; summary: string } } | null>(null)
  const viewers = presence.data?.viewers ?? []
  const links = detail.data?.links ?? []
  const aiOn = aiStatus.data?.configured

  async function runAi(kind: 'reply' | 'summary' | 'triage' | 'triage-apply' | 'macro') {
    try {
      if (kind === 'reply') { const r = await ai.suggestReply.mutateAsync(); setReply((p) => p ? `${p}\n${r.reply}` : r.reply); setAiBox(null) }
      else if (kind === 'summary') { const r = await ai.summarize.mutateAsync(); setAiBox({ kind: 'summary', text: r.summary }) }
      else if (kind === 'triage') { const r = await ai.triage.mutateAsync(); setAiBox({ kind: 'triage', triage: r }) }
      else if (kind === 'triage-apply') { const r = await ai.triageApply.mutateAsync(); setAiBox({ kind: 'summary', text: `Triagem aplicada: prioridade ${r.applied.priority}, tipo ${r.applied.type} (sentimento ${r.sentiment}).` }) }
      else if (kind === 'macro') {
        const r = await ai.suggestMacro.mutateAsync()
        if (r.macroId) { await onApplyMacro(r.macroId); setAiBox({ kind: 'summary', text: `Macro sugerida aplicada: ${r.name}. ${r.reason}` }) }
        else setAiBox({ kind: 'summary', text: r.reason || 'Nenhuma macro adequada.' })
      }
    } catch (e: any) {
      setAiBox({ kind: 'error', text: e?.message || 'Falha na IA' })
    }
  }
  async function runRewrite(mode: string) {
    if (!reply.trim()) return
    try { const r = await ai.rewrite.mutateAsync({ text: reply, mode }); if (r.text) setReply(r.text) }
    catch (e: any) { setAiBox({ kind: 'error', text: e?.message || 'Falha na IA' }) }
  }
  const aiBusy = ai.suggestReply.isPending || ai.summarize.isPending || ai.triage.isPending || ai.triageApply.isPending || ai.suggestMacro.isPending || ai.rewrite.isPending

  async function onApplyMacro(macroId: number) {
    const r = await applyMacro.mutateAsync(macroId)
    if (r.replyText) setReply((prev) => prev ? `${prev}\n${r.replyText}` : r.replyText)
  }

  const ticket = detail.data?.ticket
  const comments = detail.data?.comments ?? []
  const events = detail.data?.events ?? []
  const followers = detail.data?.followers ?? []
  const attachments = detail.data?.attachments ?? []

  // F25 — agente colaborador: só "Ver" no Helpdesk (sem editar). Pode comentar
  // internamente e seguir, mas não responder ao solicitante nem alterar o chamado.
  const canEdit = useCan('helpdesk', 'edit')
  const myId = useUserStore((s) => s.user?.id ?? null)
  const isFollowing = followers.some((f) => f.userId != null && f.userId === myId)
  // Colaborador é forçado a nota interna.
  const effectiveInternal = !canEdit ? true : internal

  async function send() {
    if (!reply.trim()) return
    await addComment.mutateAsync({ body: reply.trim(), visibility: effectiveInternal ? 'internal' : 'public' })
    setReply('')
  }

  return (
    <Page
      title={ticket ? `#${ticket.number} · ${ticket.subject}` : 'Chamado'}
      actions={<Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft size={14} /> Voltar</Button>}
    >
      {viewers.length > 0 && (
        <div class="flex items-center gap-2 rounded-md bg-warning/10 border border-warning/30 px-3 py-2 text-xs text-fg">
          <span class="size-2 rounded-full bg-warning animate-pulse" />
          {viewers.map((v) => v.name).join(', ')} {viewers.length === 1 ? 'também está vendo' : 'também estão vendo'} este chamado agora.
        </div>
      )}
      {!canEdit && ticket && (
        <div class="flex items-center gap-2 rounded-md bg-info/10 border border-info/30 px-3 py-2 text-xs text-fg mt-2">
          <Eye size={13} />
          <span><b>Modo colaborador.</b> Você pode visualizar, adicionar notas internas e seguir este chamado — mas não responder ao solicitante nem alterar o chamado.</span>
        </div>
      )}
      {detail.isLoading || !ticket ? (
        <div class="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} class="h-20 w-full" />)}</div>
      ) : (
        <div class="grid gap-4 lg:grid-cols-[1fr_300px]">
          {/* Thread + resposta */}
          <div class="space-y-4 min-w-0">
            {(detail.data?.conversation?.length ?? 0) > 0 && (
              <Card class="space-y-2">
                <div class="flex items-center justify-between">
                  <h3 class="text-xs font-semibold uppercase tracking-wide text-fg-muted">Conversa ({CHANNEL_LABEL[ticket.channel] || ticket.channel})</h3>
                  {ticket.requesterLeadId != null && (
                    <button class="text-xs text-accent hover:underline" onClick={() => { window.location.href = `${env.appBasePath}/conversations` }}>Abrir no Conversas →</button>
                  )}
                </div>
                {(detail.data?.conversation ?? []).map((m) => (
                  <div key={`conv-${m.id}`} class={`rounded-lg p-2.5 text-sm ${m.fromMe ? 'bg-accent/10' : 'bg-surface-2'}`}>
                    <div class="flex items-center gap-2 mb-0.5 text-xs text-fg-muted">
                      <span class="font-medium text-fg">{m.fromMe ? (m.senderName || 'Agente') : 'Cliente'}</span>
                      <span class="ml-auto">{fmt(m.timestamp)}</span>
                    </div>
                    <div class="whitespace-pre-wrap text-fg">{m.body || (m.mediaType !== 'text' ? `[${m.mediaType}]` : '')}</div>
                  </div>
                ))}
              </Card>
            )}
            <Card class="space-y-3">
              {comments.length === 0 ? (
                <p class="text-sm text-fg-muted">Nenhuma nota/resposta registrada no chamado.</p>
              ) : (
                comments.map((c) => (
                  <div key={c.id} class={`rounded-lg p-3 text-sm ${c.visibility === 'internal' ? 'bg-warning/10 border border-warning/30' : 'bg-surface-2'}`}>
                    <div class="flex items-center gap-2 mb-1 text-xs text-fg-muted">
                      <span class="font-medium text-fg">{c.authorName || 'Sistema'}</span>
                      {c.visibility === 'internal' && <Badge tone="warning">Nota interna</Badge>}
                      <span class="ml-auto">{fmt(c.createdAt)}</span>
                    </div>
                    <div class="whitespace-pre-wrap text-fg">{c.body}</div>
                  </div>
                ))
              )}
            </Card>

            <Card class="space-y-2">
              {canEdit && (macros.data?.macros?.length ?? 0) > 0 && (
                <select
                  class="text-xs rounded-md border border-border bg-surface px-2 py-1.5 text-fg-muted"
                  value=""
                  onChange={(e) => { const v = (e.target as HTMLSelectElement).value; if (v) { onApplyMacro(Number(v)); (e.target as HTMLSelectElement).value = '' } }}
                >
                  <option value="">⚡ Aplicar macro…</option>
                  {(macros.data?.macros ?? []).filter((m) => m.active).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              )}
              {canEdit && aiOn && (
                <div class="flex flex-wrap items-center gap-2">
                  <span class="text-xs text-fg-muted inline-flex items-center gap-1"><Sparkles size={12} /> IA:</span>
                  <button class="text-xs text-accent hover:underline disabled:opacity-50" disabled={aiBusy} onClick={() => runAi('reply')}>Sugerir resposta</button>
                  <button class="text-xs text-accent hover:underline disabled:opacity-50" disabled={aiBusy} onClick={() => runAi('macro')}>Sugerir macro</button>
                  <button class="text-xs text-accent hover:underline disabled:opacity-50" disabled={aiBusy} onClick={() => runAi('summary')}>Resumir</button>
                  <button class="text-xs text-accent hover:underline disabled:opacity-50" disabled={aiBusy} onClick={() => runAi('triage-apply')}>Triagem (aplicar)</button>
                  {reply.trim() && (
                    <select class="text-xs rounded border border-border bg-surface px-1 py-0.5 text-fg-muted" value="" disabled={aiBusy} onChange={(e) => { const v = (e.target as HTMLSelectElement).value; if (v) { runRewrite(v); (e.target as HTMLSelectElement).value = '' } }}>
                      <option value="">Reescrever…</option>
                      <option value="formal">Formal</option>
                      <option value="friendly">Amigável</option>
                      <option value="concise">Conciso</option>
                      <option value="translate:inglês">Traduzir → Inglês</option>
                      <option value="translate:espanhol">Traduzir → Espanhol</option>
                    </select>
                  )}
                  {aiBusy && <span class="text-xs text-fg-muted">pensando…</span>}
                </div>
              )}
              {aiBox && (
                <div class={`rounded-md p-2 text-xs ${aiBox.kind === 'error' ? 'bg-danger/10 border border-danger/30 text-danger' : 'bg-info/5 border border-info/20 text-fg'}`}>
                  {aiBox.kind === 'summary' && <><b>Resumo (IA):</b> {aiBox.text}</>}
                  {aiBox.kind === 'error' && <>{aiBox.text}</>}
                  {aiBox.kind === 'triage' && aiBox.triage && (
                    <div class="space-y-1">
                      <div><b>Triagem (IA):</b> prioridade <b>{PRIORITY_LABEL[aiBox.triage.priority as TicketPriority] || aiBox.triage.priority}</b> · tipo {aiBox.triage.type} · sentimento {aiBox.triage.sentiment}</div>
                      <div class="text-fg-muted">{aiBox.triage.summary}</div>
                      <button class="text-accent hover:underline" onClick={() => { update.mutate({ id, priority: aiBox.triage!.priority as TicketPriority }); setAiBox(null) }}>Aplicar prioridade sugerida</button>
                    </div>
                  )}
                </div>
              )}
              <Textarea
                label={effectiveInternal ? 'Nota interna (não vai ao solicitante)' : 'Responder ao solicitante'}
                value={reply}
                onInput={(e) => setReply((e.target as HTMLTextAreaElement).value)}
                rows={3}
                placeholder={canEdit ? 'Escreva sua mensagem…' : 'Escreva uma nota interna…'}
              />
              <div class="flex items-center gap-3">
                {canEdit ? (
                  <label class="flex items-center gap-2 text-xs text-fg-muted cursor-pointer">
                    <input type="checkbox" checked={internal} onChange={(e) => setInternal((e.target as HTMLInputElement).checked)} />
                    Nota interna
                  </label>
                ) : (
                  <span class="text-xs text-fg-muted inline-flex items-center gap-1"><Eye size={12} /> Nota interna (modo colaborador)</span>
                )}
                {canEdit && !effectiveInternal && ticket.requesterLeadId != null && (ticket.channel === 'whatsapp' || ticket.channel === 'chat') && (
                  <span class="text-xs text-success">↗ Envia por {CHANNEL_LABEL[ticket.channel] || ticket.channel}</span>
                )}
                {canEdit && !effectiveInternal && ticket.channel === 'email' && ticket.requesterEmail && (
                  <span class="text-xs text-success">↗ Envia por e-mail</span>
                )}
                <Button class="ml-auto" variant="primary" size="sm" onClick={send} disabled={!reply.trim() || addComment.isPending}>
                  {addComment.isPending ? 'Enviando…' : effectiveInternal ? 'Adicionar nota' : 'Enviar resposta'}
                </Button>
              </div>
            </Card>
          </div>

          {/* Painel lateral: propriedades + atribuição + solicitante + tags + seguidores + anexos + timeline */}
          <div class="space-y-4">
            <Card class="space-y-3">
              <Button
                variant={isFollowing ? 'secondary' : 'ghost'}
                size="sm"
                class="w-full"
                disabled={actions.follow.isPending || actions.unfollow.isPending}
                onClick={() => (isFollowing ? actions.unfollow.mutate() : actions.follow.mutate())}
              >
                <Eye size={14} /> {isFollowing ? 'Seguindo — deixar de seguir' : 'Seguir este chamado'}
              </Button>
              <div>
                <label class="text-xs text-fg-muted block mb-1">Status</label>
                {canEdit ? (
                  <Select value={ticket.status} onChange={(e) => update.mutate({ id, status: (e.target as HTMLSelectElement).value as TicketStatus })}>
                    {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                  </Select>
                ) : (
                  <div><Badge tone="info">{STATUS_LABEL[ticket.status]}</Badge></div>
                )}
              </div>
              <div>
                <label class="text-xs text-fg-muted block mb-1">Prioridade</label>
                {canEdit ? (
                  <Select value={ticket.priority} onChange={(e) => update.mutate({ id, priority: (e.target as HTMLSelectElement).value as TicketPriority })}>
                    {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
                  </Select>
                ) : (
                  <div><Badge>{PRIORITY_LABEL[ticket.priority]}</Badge></div>
                )}
              </div>
              <dl class="text-xs text-fg-muted space-y-1 pt-1">
                <PropRow label="Canal" value={ticket.channel} />
                <PropRow label="1ª resposta" value={fmt(ticket.firstResponseAt)} />
                <PropRow label="Reaberturas" value={String(ticket.reopenCount)} />
                <PropRow label="Criado" value={fmt(ticket.createdAt)} />
              </dl>
            </Card>

            {ticket.slaPolicyId != null && (
              <SectionCard title="SLA">
                <div class="flex items-center justify-between text-xs">
                  <span class="text-fg-muted inline-flex items-center gap-1"><Clock size={12} /> 1ª resposta</span>
                  {ticket.firstResponseAt ? <SlaBadge status={ticket.slaFirstResponseStatus} target={ticket.targetFirstResponseAt} /> : <SlaBadge status={ticket.slaFirstResponseStatus} target={ticket.targetFirstResponseAt} icon />}
                </div>
                <div class="flex items-center justify-between text-xs">
                  <span class="text-fg-muted inline-flex items-center gap-1"><Clock size={12} /> Resolução</span>
                  <SlaBadge status={ticket.slaResolutionStatus} target={ticket.targetResolutionAt} icon />
                </div>
                {ticket.slaNextResponseStatus && (
                  <div class="flex items-center justify-between text-xs">
                    <span class="text-fg-muted inline-flex items-center gap-1"><Clock size={12} /> Próxima resposta</span>
                    <SlaBadge status={ticket.slaNextResponseStatus} target={ticket.targetNextResponseAt} icon />
                  </div>
                )}
                {ticket.slaPausedAt && <p class="text-xs text-warning">Relógio de resolução pausado.</p>}
              </SectionCard>
            )}

            {detail.data?.survey?.respondedAt && (
              <SectionCard title="Satisfação (CSAT)">
                <div class="flex items-center gap-1 text-lg">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Star key={i} size={16} class={i <= (detail.data?.survey?.rating ?? 0) ? 'text-warning fill-warning' : 'text-fg-subtle'} />
                  ))}
                  <span class="text-sm text-fg-muted ml-1">{detail.data?.survey?.rating}/5</span>
                </div>
                {detail.data?.survey?.comment && <p class="text-xs text-fg italic">"{detail.data.survey.comment}"</p>}
              </SectionCard>
            )}

            {aiOn && (
              <SectionCard title="Qualidade (QA)">
                {detail.data?.qa?.score != null ? (
                  <div class="space-y-1">
                    <div class="text-sm text-fg font-semibold">{detail.data.qa.score}/100 {detail.data.qa.tone && <Badge tone={detail.data.qa.score >= 80 ? 'success' : detail.data.qa.score >= 50 ? 'warning' : 'danger'}>{detail.data.qa.tone}</Badge>}</div>
                    {detail.data.qa.summary && <p class="text-xs text-fg-muted">{detail.data.qa.summary}</p>}
                    {(detail.data.qa.weaknesses?.length ?? 0) > 0 && <p class="text-xs text-danger">A melhorar: {detail.data.qa.weaknesses!.join('; ')}</p>}
                  </div>
                ) : (
                  <p class="text-xs text-fg-muted">Sem auditoria de qualidade.</p>
                )}
                {canEdit && (
                  <button class="text-xs text-accent hover:underline disabled:opacity-50" disabled={ai.qa.isPending} onClick={() => ai.qa.mutateAsync().catch((e: any) => alert(e?.message || 'Falha na IA'))}>
                    {ai.qa.isPending ? 'Auditando…' : 'Auditar com IA'}
                  </button>
                )}
              </SectionCard>
            )}

            {canEdit && <AssignSection ticket={ticket} actions={actions} />}
            {canEdit && <RequesterSection ticket={ticket} actions={actions} />}
            {canEdit && <CallsSection ticket={ticket} calls={detail.data?.calls ?? []} actions={actions} />}
            {canEdit && <TagsSection ticket={ticket} actions={actions} />}
            {canEdit && <CustomFieldsSection ticket={ticket} actions={actions} />}
            {canEdit && <FollowersSection ticketId={id} followers={followers} actions={actions} />}
            <AttachmentsSection ticketId={id} attachments={attachments} actions={actions} />
            {canEdit && <LinksSection links={links} actions={actions} />}
            {canEdit && <SideConversationsSection ticketId={id} />}

            <Card>
              <h3 class="text-sm font-semibold text-fg mb-2">Histórico</h3>
              <ol class="space-y-2 max-h-72 overflow-auto">
                {events.slice().reverse().map((ev) => (
                  <li key={ev.id} class="text-xs text-fg-muted flex gap-2">
                    <span class="text-fg-subtle shrink-0">{fmt(ev.createdAt)}</span>
                    <span class="text-fg">{ev.title}</span>
                  </li>
                ))}
              </ol>
            </Card>
          </div>
        </div>
      )}
    </Page>
  )
}

type Actions = ReturnType<typeof useTicketActions>

function SectionCard({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <Card class="space-y-2">
      <h3 class="text-xs font-semibold uppercase tracking-wide text-fg-muted">{title}</h3>
      {children}
    </Card>
  )
}

function AssignSection({ ticket, actions }: { ticket: Ticket; actions: Actions }) {
  const agents = useAgents()
  const teams = useTeams()
  return (
    <SectionCard title="Atribuição">
      <Select
        value={ticket.assignedUserId ?? ''}
        onChange={(e) => {
          const v = (e.target as HTMLSelectElement).value
          actions.assign.mutate({ userId: v ? Number(v) : null })
        }}
      >
        <option value="">— Sem responsável</option>
        {(agents.data?.agents ?? []).map((a) => <option key={a.id} value={a.id}>{a.name || a.email}</option>)}
      </Select>
      <Select
        value={ticket.teamId ?? ''}
        onChange={(e) => {
          const v = (e.target as HTMLSelectElement).value
          actions.assign.mutate({ teamId: v ? Number(v) : null })
        }}
      >
        <option value="">— Sem setor</option>
        {(teams.data?.teams ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </Select>
      <div class="flex gap-2">
        <Button variant="secondary" size="sm" class="flex-1" onClick={() => actions.claim.mutate()}>Assumir</Button>
        {ticket.assignedUserId != null && (
          <Button variant="ghost" size="sm" class="flex-1" onClick={() => actions.release.mutate()}>Devolver à fila</Button>
        )}
      </div>
      <button class="text-xs text-fg-muted hover:text-danger" onClick={() => actions.markSpam.mutate(!ticket.isSpam)}>
        {ticket.isSpam ? 'Remover do spam' : 'Marcar como spam'}
      </button>
    </SectionCard>
  )
}

function RequesterSection({ ticket, actions }: { ticket: Ticket; actions: Actions }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<LeadSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const orgs = useOrganizations()
  const org = ticket.organizationId != null ? (orgs.data?.organizations ?? []).find((o) => o.id === ticket.organizationId) : null

  async function doSearch() {
    if (!q.trim()) return
    setSearching(true)
    try { setResults((await searchLeads(q.trim())).leads) } finally { setSearching(false) }
  }

  return (
    <SectionCard title="Solicitante">
      <div class="text-sm text-fg">{ticket.requesterName || ticket.requesterEmail || '— não informado'}</div>
      {(ticket.requesterEmail || ticket.requesterPhone) && (
        <div class="text-xs text-fg-muted">{[ticket.requesterEmail, ticket.requesterPhone].filter(Boolean).join(' · ')}</div>
      )}
      {org && (
        <div class="text-xs"><Badge tone="info"><Building2 size={11} /> {org.name}{org.supportPlan ? ` · ${org.supportPlan}` : ''}</Badge></div>
      )}
      {ticket.requesterLeadId != null ? (
        <div class="flex items-center gap-2 text-xs">
          <Badge tone="info"><Link2 size={11} /> Lead #{ticket.requesterLeadId}</Badge>
          <button class="text-fg-muted hover:text-danger" onClick={() => actions.unlinkLead.mutate()}>desvincular</button>
        </div>
      ) : (
        <div class="space-y-1">
          <div class="flex gap-1">
            <Input value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} placeholder="Buscar lead…" onKeyDown={(e) => { if ((e as KeyboardEvent).key === 'Enter') doSearch() }} />
            <Button variant="secondary" size="sm" iconOnly onClick={doSearch} disabled={searching}><Search size={14} /></Button>
          </div>
          {results.length > 0 && (
            <div class="border border-border rounded-md divide-y divide-border max-h-40 overflow-auto">
              {results.map((l) => (
                <button key={l.id} class="w-full text-left px-2 py-1.5 hover:bg-surface-2 text-xs" onClick={() => { actions.setRequester.mutate({ leadId: l.id }); setResults([]); setQ('') }}>
                  <span class="block text-fg truncate">{l.nome || l.email || l.whatsapp}</span>
                  <span class="block text-fg-muted truncate">{[l.email, l.whatsapp].filter(Boolean).join(' · ')}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </SectionCard>
  )
}

function TagsSection({ ticket, actions }: { ticket: Ticket; actions: Actions }) {
  const catalog = useTagsCatalog()
  const selected = new Set(ticket.tags ?? [])
  function toggle(tagId: number) {
    const next = new Set(selected)
    if (next.has(tagId)) next.delete(tagId); else next.add(tagId)
    actions.setTags.mutate([...next])
  }
  const tags = catalog.data?.tags ?? []
  return (
    <SectionCard title="Tags">
      {tags.length === 0 ? (
        <p class="text-xs text-fg-muted">Nenhuma tag cadastrada.</p>
      ) : (
        <div class="flex flex-wrap gap-1.5">
          {tags.map((t) => {
            const on = selected.has(t.id)
            return (
              <button
                key={t.id}
                onClick={() => toggle(t.id)}
                class={`text-xs px-2 py-1 rounded-full border ${on ? 'text-fg-on-brand border-transparent' : 'text-fg-muted border-border hover:bg-surface-2'}`}
                style={on ? `background:${t.color}` : undefined}
              >
                {t.name}
              </button>
            )
          })}
        </div>
      )}
    </SectionCard>
  )
}

function CustomFieldsSection({ ticket, actions }: { ticket: Ticket; actions: Actions }) {
  const catalog = useHelpdeskCustomFields()
  const fields = catalog.data?.fields ?? []
  const saved = (ticket.customFields ?? {}) as Record<string, unknown>
  const [draft, setDraft] = useState<Record<string, string>>({})
  if (catalog.isLoading) return null
  if (fields.length === 0) return null

  // valor exibido: rascunho local tem prioridade; senão o salvo
  const valueOf = (key: string) => (key in draft ? draft[key] : (saved[key] != null ? String(saved[key]) : ''))
  const set = (key: string, v: string) => setDraft((d) => ({ ...d, [key]: v }))
  const dirty = Object.keys(draft).some((k) => draft[k] !== (saved[k] != null ? String(saved[k]) : ''))

  function save() {
    const payload: Record<string, unknown> = {}
    for (const f of fields) {
      if (!(f.key in draft)) continue
      const v = draft[f.key]
      if (f.type === 'number' || f.type === 'currency') payload[f.key] = v === '' ? '' : Number(v)
      else if (f.type === 'checkbox') payload[f.key] = v === 'true'
      else payload[f.key] = v
    }
    actions.setCustomFields.mutate(payload, { onSuccess: () => setDraft({}) })
  }

  return (
    <SectionCard title="Campos personalizados">
      <div class="space-y-2">
        {fields.map((f) => (
          <label key={f.key} class="block">
            <span class="text-xs text-fg-muted">{f.label}{f.required && <span class="text-danger"> *</span>}</span>
            {f.type === 'select' ? (
              <Select value={valueOf(f.key)} onChange={(e) => set(f.key, (e.target as HTMLSelectElement).value)}>
                <option value="">— Selecione</option>
                {(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            ) : f.type === 'textarea' ? (
              <Textarea rows={2} value={valueOf(f.key)} placeholder={f.placeholder ?? ''} onInput={(e) => set(f.key, (e.target as HTMLTextAreaElement).value)} />
            ) : f.type === 'checkbox' ? (
              <Select value={valueOf(f.key) || 'false'} onChange={(e) => set(f.key, (e.target as HTMLSelectElement).value)}>
                <option value="false">Não</option>
                <option value="true">Sim</option>
              </Select>
            ) : (
              <Input
                type={f.type === 'number' || f.type === 'currency' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                value={valueOf(f.key)}
                placeholder={f.placeholder ?? ''}
                onInput={(e) => set(f.key, (e.target as HTMLInputElement).value)}
              />
            )}
          </label>
        ))}
      </div>
      {dirty && (
        <Button class="w-full mt-1" onClick={save} disabled={actions.setCustomFields.isPending}>
          {actions.setCustomFields.isPending ? 'Salvando…' : 'Salvar campos'}
        </Button>
      )}
      {actions.setCustomFields.isError && (
        <p class="text-xs text-danger">{(actions.setCustomFields.error as any)?.message || 'Erro ao salvar.'}</p>
      )}
    </SectionCard>
  )
}

function SideConversationsSection({ ticketId }: { ticketId: number }) {
  const list = useSideConversations(ticketId)
  const act = useSideConversationActions(ticketId)
  const [creating, setCreating] = useState(false)
  const [channel, setChannel] = useState<'email' | 'whatsapp'>('email')
  const [target, setTarget] = useState('')
  const [targetName, setTargetName] = useState('')
  const [body, setBody] = useState('')
  const convs = list.data?.conversations ?? []

  function submit() {
    if (!target.trim() || !body.trim()) return
    const payload: any = { channel, targetName: targetName.trim() || undefined, body: body.trim() }
    if (channel === 'email') payload.targetEmail = target.trim(); else payload.targetPhone = target.trim()
    act.create.mutate(payload, { onSuccess: () => { setCreating(false); setTarget(''); setTargetName(''); setBody('') } })
  }

  return (
    <SectionCard title="Conversas paralelas">
      <p class="text-[11px] text-fg-subtle">Thread com um terceiro (fornecedor, especialista) sem expor ao solicitante.</p>
      {convs.map((c) => <SideConvCard key={c.id} conv={c} act={act} />)}
      {!creating ? (
        <button class="text-xs text-accent hover:underline" onClick={() => setCreating(true)}>+ Nova conversa paralela</button>
      ) : (
        <div class="space-y-1.5 border-t border-border pt-2">
          <Select value={channel} onChange={(e) => setChannel((e.target as HTMLSelectElement).value as any)}>
            <option value="email">E-mail</option>
            <option value="whatsapp">WhatsApp</option>
          </Select>
          <Input value={targetName} onInput={(e) => setTargetName((e.target as HTMLInputElement).value)} placeholder="Nome (opcional)" />
          <Input value={target} onInput={(e) => setTarget((e.target as HTMLInputElement).value)} placeholder={channel === 'email' ? 'email@fornecedor.com' : 'WhatsApp (+55…)'} />
          <Textarea rows={2} value={body} onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)} placeholder="Mensagem…" />
          <div class="flex gap-1 justify-end">
            <Button variant="ghost" size="sm" onClick={() => setCreating(false)}>Cancelar</Button>
            <Button variant="primary" size="sm" disabled={!target.trim() || !body.trim() || act.create.isPending} onClick={submit}>Enviar</Button>
          </div>
          {act.create.isError && <p class="text-xs text-danger">{(act.create.error as any)?.message || 'Falha ao enviar.'}</p>}
        </div>
      )}
    </SectionCard>
  )
}

function SideConvCard({ conv, act }: { conv: SideConversation; act: ReturnType<typeof useSideConversationActions> }) {
  const [reply, setReply] = useState('')
  const [inbound, setInbound] = useState('')
  const target = conv.targetName || conv.targetEmail || conv.targetPhone || 'terceiro'
  return (
    <div class="rounded-md border border-border p-2 space-y-1.5">
      <div class="flex items-center gap-2 text-xs">
        <span class="font-medium text-fg truncate flex-1">{target}</span>
        <Badge tone={conv.channel === 'whatsapp' ? 'success' : 'info'}>{conv.channel === 'whatsapp' ? 'WhatsApp' : 'E-mail'}</Badge>
        <Badge tone={conv.status === 'open' ? 'neutral' : 'success'}>{conv.status === 'open' ? 'aberta' : 'encerrada'}</Badge>
      </div>
      <div class="space-y-1 max-h-40 overflow-auto">
        {conv.messages.map((m) => (
          <div key={m.id} class={`text-xs rounded p-1.5 ${m.direction === 'outbound' ? 'bg-accent/10' : 'bg-surface-2'}`}>
            <span class="text-fg-subtle">{m.direction === 'outbound' ? '→ ' : '← '}{m.authorName || ''}</span>
            <div class="text-fg whitespace-pre-wrap">{m.body}</div>
          </div>
        ))}
      </div>
      {conv.status === 'open' && (
        <div class="space-y-1">
          <div class="flex gap-1">
            <Input value={reply} onInput={(e) => setReply((e.target as HTMLInputElement).value)} placeholder="Responder…" onKeyDown={(e) => { if ((e as KeyboardEvent).key === 'Enter' && reply.trim()) { act.send.mutate({ scid: conv.id, body: reply.trim() }, { onSuccess: () => setReply('') }) } }} />
          </div>
          <div class="flex gap-1">
            <Input value={inbound} onInput={(e) => setInbound((e.target as HTMLInputElement).value)} placeholder="Registrar resposta recebida…" />
            <Button variant="ghost" size="sm" disabled={!inbound.trim()} onClick={() => act.inbound.mutate({ scid: conv.id, body: inbound.trim() }, { onSuccess: () => setInbound('') })}>+</Button>
          </div>
          <button class="text-[11px] text-fg-muted hover:text-danger" onClick={() => act.close.mutate(conv.id)}>Encerrar conversa</button>
        </div>
      )}
    </div>
  )
}

function FollowersSection({ ticketId: _ticketId, followers, actions }: { ticketId: number; followers: Array<{ id: number; name: string | null; email: string | null }>; actions: Actions }) {
  const [email, setEmail] = useState('')
  function add() {
    if (!email.trim()) return
    actions.addFollower.mutate({ email: email.trim() })
    setEmail('')
  }
  return (
    <SectionCard title="Seguidores (CC)">
      {followers.length > 0 && (
        <div class="space-y-1">
          {followers.map((f) => (
            <div key={f.id} class="flex items-center gap-2 text-xs">
              <span class="flex-1 truncate text-fg">{f.name || f.email}</span>
              <button class="text-fg-muted hover:text-danger" onClick={() => actions.removeFollower.mutate(f.id)}><X size={13} /></button>
            </div>
          ))}
        </div>
      )}
      <div class="flex gap-1">
        <Input value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} placeholder="email@exemplo.com" onKeyDown={(e) => { if ((e as KeyboardEvent).key === 'Enter') add() }} />
        <Button variant="secondary" size="sm" iconOnly onClick={add}><UserPlus size={14} /></Button>
      </div>
    </SectionCard>
  )
}

function AttachmentsSection({ ticketId: _ticketId, attachments, actions }: { ticketId: number; attachments: Array<{ id: number; fileName: string; fileSize: number; url: string }>; actions: Actions }) {
  function onPick(e: Event) {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    if (file) actions.uploadAttachment.mutate(file)
    input.value = ''
  }
  return (
    <SectionCard title="Anexos">
      {attachments.length > 0 && (
        <div class="space-y-1">
          {attachments.map((a) => (
            <div key={a.id} class="flex items-center gap-2 text-xs">
              <Paperclip size={12} class="text-fg-muted shrink-0" />
              <a href={a.url} target="_blank" rel="noreferrer" class="flex-1 truncate text-accent hover:underline">{a.fileName}</a>
              <span class="text-fg-subtle shrink-0">{fmtBytes(a.fileSize)}</span>
              <button class="text-fg-muted hover:text-danger" onClick={() => actions.deleteAttachment.mutate(a.id)}><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
      )}
      <label class="inline-flex items-center gap-1.5 text-xs text-accent cursor-pointer hover:underline">
        <Paperclip size={13} /> {actions.uploadAttachment.isPending ? 'Enviando…' : 'Anexar arquivo'}
        <input type="file" class="hidden" onChange={onPick} />
      </label>
    </SectionCard>
  )
}

const LINK_TYPE_LABEL: Record<string, string> = {
  related: 'Relacionado', duplicate: 'Duplicado', blocks: 'Bloqueia', blocked_by: 'Bloqueado por',
  parent: 'Pai', child: 'Filho', problem: 'Problema', incident: 'Incidente',
  follow_up: 'Follow-up de', follow_up_of: 'Tem follow-up', merged: 'Mesclado em', merged_from: 'Recebeu mescla',
}
const LINK_TYPE_OPTS = ['related', 'duplicate', 'blocks', 'parent', 'child', 'problem', 'incident']

function CallsSection({ ticket, calls, actions }: { ticket: Ticket; calls: Array<{ id: number; direction: string; phone: string; durationSec: number | null; recordingUrl: string | null; startedAt: string }>; actions: Actions }) {
  const canCall = !!(ticket.requesterPhone || ticket.requesterLeadId)
  if (!canCall && calls.length === 0) return null
  return (
    <SectionCard title="Telefone">
      {canCall && (
        <Button variant="secondary" size="sm" onClick={() => actions.call.mutate(undefined, { onError: (e: any) => alert(e?.message || 'Falha ao ligar') })} disabled={actions.call.isPending}>
          📞 {actions.call.isPending ? 'Chamando…' : 'Ligar para o solicitante'}
        </Button>
      )}
      {calls.length > 0 && (
        <div class="space-y-1">
          {calls.map((c) => (
            <div key={c.id} class="flex items-center gap-2 text-xs">
              <span class="text-fg-muted">{c.direction === 'inbound' ? '↘' : '↗'}</span>
              <span class="flex-1 truncate text-fg">{c.phone}{c.durationSec ? ` · ${Math.floor(c.durationSec / 60)}m${c.durationSec % 60}s` : ''}</span>
              {c.recordingUrl && <a href={c.recordingUrl} target="_blank" rel="noreferrer" class="text-accent hover:underline">gravação</a>}
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  )
}

function LinksSection({ links, actions }: { links: Array<{ id: number; type: string; number: number; subject: string; status: string }>; actions: Actions }) {
  const [num, setNum] = useState('')
  const [type, setType] = useState('related')
  const hasIncidents = links.some((l) => l.type === 'incident')
  function add() {
    const n = Number(num)
    if (!n) return
    actions.addLink.mutate({ targetNumber: n, type })
    setNum('')
  }
  return (
    <SectionCard title="Relacionados">
      {links.length > 0 && (
        <div class="space-y-1">
          {links.map((l) => (
            <div key={`${l.id}-${l.type}`} class="flex items-center gap-2 text-xs">
              <Badge tone="neutral">{LINK_TYPE_LABEL[l.type] || l.type}</Badge>
              <span class="flex-1 min-w-0 truncate text-fg">#{l.number} {l.subject}</span>
              <button class="text-fg-muted hover:text-danger" onClick={() => actions.removeLink.mutate(l.id)}><X size={12} /></button>
            </div>
          ))}
        </div>
      )}
      <div class="flex gap-1">
        <input type="number" class="w-20 rounded-md border border-border bg-surface px-2 py-1 text-fg text-xs" value={num} onInput={(e) => setNum((e.target as HTMLInputElement).value)} placeholder="nº" />
        <select class="flex-1 text-xs rounded-md border border-border bg-surface px-2 py-1 text-fg" value={type} onChange={(e) => setType((e.target as HTMLSelectElement).value)}>
          {LINK_TYPE_OPTS.map((t) => <option key={t} value={t}>{LINK_TYPE_LABEL[t]}</option>)}
        </select>
        <Button variant="secondary" size="sm" iconOnly onClick={add}><Plus size={14} /></Button>
      </div>
      <div class="flex flex-wrap gap-2 pt-1">
        {hasIncidents && (
          <button class="text-xs text-accent hover:underline" onClick={() => actions.resolveIncidents.mutate()}>Resolver incidentes</button>
        )}
        <button class="text-xs text-accent hover:underline" onClick={() => { const n = Number(prompt('Mesclar este chamado em qual nº?') || ''); if (n) actions.merge.mutate(n) }}>Mesclar em…</button>
        <button class="text-xs text-accent hover:underline" onClick={() => actions.followUp.mutate({})}>Criar follow-up</button>
      </div>
    </SectionCard>
  )
}

function PropRow({ label, value }: { label: string; value: string }) {
  return (
    <div class="flex justify-between gap-2">
      <dt>{label}</dt>
      <dd class="text-fg text-right truncate">{value}</dd>
    </div>
  )
}

// ──────────────────────────── Importador Zendesk/Freshdesk (F26) ────────────────────────────

export function HelpdeskImportPage() {
  const [source, setSource] = useState<'zendesk' | 'freshdesk'>('zendesk')
  const [mode, setMode] = useState<'upload' | 'remote'>('upload')
  const [json, setJson] = useState('')
  const [creds, setCreds] = useState<Record<string, string>>({})
  const [result, setResult] = useState<ImportResult | null>(null)
  const [err, setErr] = useState('')
  const upload = useImportUpload()
  const remote = useImportRemote()
  const busy = upload.isPending || remote.isPending

  async function run(dryRun: boolean) {
    setErr(''); setResult(null)
    try {
      if (mode === 'upload') {
        let data: unknown
        try { data = JSON.parse(json) } catch { setErr('O JSON colado é inválido.'); return }
        const r = await upload.mutateAsync({ source, data, dryRun })
        setResult(r)
      } else {
        const r = await remote.mutateAsync({ source, credentials: creds, dryRun })
        setResult(r)
      }
    } catch (e: any) {
      setErr(e?.message || 'Falha na importação.')
    }
  }

  const rep = result?.report
  const setCred = (k: string, v: string) => setCreds((c) => ({ ...c, [k]: v }))

  return (
    <Page title="Importar do Zendesk / Freshdesk">
      <HelpdeskTabs active="import" />
      <div class="space-y-4 max-w-3xl">
        <Card class="space-y-3">
          <p class="text-sm text-fg-muted">
            Migre <b>chamados</b> (com thread, status e datas), <b>organizações</b>, <b>Base de Conhecimento</b> e <b>macros</b>.
            A importação é <b>idempotente</b>: rodar de novo não duplica. Comece sempre com a <b>Pré-visualização</b>.
          </p>

          <div class="flex flex-wrap gap-4">
            <div>
              <label class="text-xs text-fg-muted block mb-1">Origem</label>
              <Select value={source} onChange={(e) => setSource((e.target as HTMLSelectElement).value as any)}>
                <option value="zendesk">Zendesk</option>
                <option value="freshdesk">Freshdesk</option>
              </Select>
            </div>
            <div>
              <label class="text-xs text-fg-muted block mb-1">Método</label>
              <Select value={mode} onChange={(e) => setMode((e.target as HTMLSelectElement).value as any)}>
                <option value="upload">Colar exportação (JSON)</option>
                <option value="remote">Conectar via API</option>
              </Select>
            </div>
          </div>

          {mode === 'upload' ? (
            <Textarea
              label="Exportação JSON"
              value={json}
              onInput={(e) => setJson((e.target as HTMLTextAreaElement).value)}
              rows={8}
              placeholder='{"tickets":[...], "users":[...], "organizations":[...], "articles":[...]}'
            />
          ) : source === 'zendesk' ? (
            <div class="grid sm:grid-cols-3 gap-2">
              <Input label="Subdomínio" placeholder="suaempresa" value={creds.subdomain ?? ''} onInput={(e) => setCred('subdomain', (e.target as HTMLInputElement).value)} />
              <Input label="E-mail (admin)" placeholder="voce@empresa.com" value={creds.email ?? ''} onInput={(e) => setCred('email', (e.target as HTMLInputElement).value)} />
              <Input label="API Token" type="password" value={creds.apiToken ?? ''} onInput={(e) => setCred('apiToken', (e.target as HTMLInputElement).value)} />
            </div>
          ) : (
            <div class="grid sm:grid-cols-2 gap-2">
              <Input label="Domínio" placeholder="suaempresa" value={creds.domain ?? ''} onInput={(e) => setCred('domain', (e.target as HTMLInputElement).value)} />
              <Input label="API Key" type="password" value={creds.apiKey ?? ''} onInput={(e) => setCred('apiKey', (e.target as HTMLInputElement).value)} />
            </div>
          )}

          <div class="flex items-center gap-2">
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => run(true)}>
              {busy ? 'Processando…' : 'Pré-visualizar'}
            </Button>
            {rep && rep.dryRun && (
              <Button variant="primary" size="sm" disabled={busy} onClick={() => { if (confirm('Confirmar importação? A operação cria os registros listados na pré-visualização.')) run(false) }}>
                Importar agora
              </Button>
            )}
            {err && <span class="text-xs text-danger">{err}</span>}
          </div>
        </Card>

        {result && (
          <Card class="space-y-3">
            <div class="flex items-center gap-2">
              <h3 class="text-sm font-semibold text-fg">{rep!.dryRun ? 'Pré-visualização' : 'Importação concluída'}</h3>
              <Badge tone={rep!.dryRun ? 'info' : 'success'}>{rep!.source}</Badge>
              {!rep!.dryRun && <Badge tone="success">✓ aplicado</Badge>}
            </div>
            <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <ImportStat label="Chamados" create={rep!.tickets.create} skip={rep!.tickets.skip} extra={`${rep!.tickets.comments} mensagens`} />
              <ImportStat label="Organizações" create={rep!.organizations.create} skip={rep!.organizations.skip} />
              <ImportStat label="Categorias KB" create={rep!.kbCategories.create} skip={rep!.kbCategories.skip} />
              <ImportStat label="Artigos KB" create={rep!.kbArticles.create} skip={rep!.kbArticles.skip} />
              <ImportStat label="Macros" create={rep!.macros.create} skip={rep!.macros.skip} />
            </div>
            <p class="text-xs text-fg-muted">
              {rep!.dryRun
                ? 'Nada foi gravado. "Criar" = novos; "ignorar" = já importados antes (idempotência). Clique em Importar agora para aplicar.'
                : 'Registros criados com sucesso. Os já existentes foram ignorados.'}
            </p>
            {rep!.errors.length > 0 && (
              <div class="rounded-md bg-danger/10 border border-danger/30 p-2 text-xs text-danger space-y-0.5">
                <b>{rep!.errors.length} aviso(s):</b>
                {rep!.errors.slice(0, 10).map((e, i) => <div key={i}>{e}</div>)}
              </div>
            )}
          </Card>
        )}
      </div>
    </Page>
  )
}

function ImportStat({ label, create, skip, extra }: { label: string; create: number; skip: number; extra?: string }) {
  return (
    <div class="rounded-lg bg-surface-2 px-3 py-2">
      <div class="text-xs text-fg-subtle">{label}</div>
      <div class="text-lg font-light text-fg tabular-nums">{create} <span class="text-xs text-success">criar</span></div>
      <div class="text-[11px] text-fg-muted">{skip} ignorar{extra ? ` · ${extra}` : ''}</div>
    </div>
  )
}
