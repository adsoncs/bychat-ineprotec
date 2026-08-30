import { lazy, Suspense } from 'preact/compat'
import { useEffect, useMemo, useState, useRef } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Copy as CopyIcon,
  Eye,
  GitFork,
  HelpCircle,
  LayoutGrid,
  ListChecks,
  List as ListIcon,
  Mail,
  MoreHorizontal,
  Phone,
  Plus,
  ShieldCheck,
  Sparkles,
  StickyNote,
  Trophy,
  Users as UsersIcon,
  XCircle,
} from '@/components/ui/icon-set'
import { MarkWonModal, MarkLostModal, OutcomeBadge } from '@/components/LeadOutcomeControls'
import { StatusSummaryBadge } from '@/components/LeadStatusSummaryControl'
import {
  useKanbanBoard,
  useMoveLeadStage,
  useKanbanFunnelsSummary,
  useKanbanPermissions,
  useSaveKanbanPermissions,
  type KanbanLead,
  type KanbanStage,
  type KanbanFunnelSummary,
  type KanbanPermissionRow,
  type KanbanRole,
  type KanbanBoardFilters,
} from '@/hooks/useKanban'
import { useAppliedFilter, useSetAppliedFilter, useResetAppliedFilter } from '@/hooks/useSavedFilters'
import { useUserStore } from '@/stores/user'
import { SavedFiltersBar } from '@/components/leads/SavedFiltersBar'
import { KanbanFiltersPanel } from '@/components/leads/KanbanFiltersPanel'
import { useDuplicateLead, useSendLeadsToKanban } from '@/hooks/useLeads'
import { useCustomFields } from '@/hooks/useCustomFields'
import { useFunnel } from '@/hooks/useFunnels'
import { useAuth } from '@/hooks/useAuth'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Input'
import { SearchInput } from '@/components/ui/SearchInput'
import { cn } from '@/lib/cn'
import { toast } from '@/lib/toast'
import { leadSourceLabel } from '@/lib/leadSourceLabels'
import { SendWhatsAppButton } from '@/components/WhatsappSend'

const LazyCreateActivityModal = lazy(() =>
  import('@/routes/pages/ActivitiesPage').then((m) => ({ default: m.CreateActivityModal })),
)

type SortKey = 'recent' | 'oldest' | 'score' | 'name'
const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'recent', label: 'Mais recente' },
  { value: 'oldest', label: 'Mais antigo' },
  { value: 'score', label: 'Maior score' },
  { value: 'name', label: 'Nome A→Z' },
]

const STALE_DAYS = 5
const WIP_DEFAULT = 20

type ViewMode = 'kanban' | 'list'

function loadCompact(): boolean {
  try { return localStorage.getItem('bh_kanban_compact') === '1' } catch { return false }
}
function loadView(): ViewMode {
  try { return localStorage.getItem('bh_kanban_view') === 'list' ? 'list' : 'kanban' } catch { return 'kanban' }
}
// Ocultar perdidos: LIGADO por padrão (só fica desligado se o user explicitamente desligar).
function loadHideLost(): boolean {
  try { return localStorage.getItem('bh_kanban_hide_lost') !== '0' } catch { return true }
}

function ChannelIcon({ source, size = 12 }: { source: string | null; size?: number }) {
  if (!source) return null
  const title = leadSourceLabel(source)
  const common = { width: size, height: size, viewBox: '0 0 24 24' }
  switch (source) {
    case 'whatsapp':
      return (
        <svg {...common} fill="#25D366" aria-label={title}>
          <title>{title}</title>
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
          <path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.832-1.438A9.955 9.955 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2z" />
        </svg>
      )
    case 'instagram':
      return (
        <svg {...common} fill="#E4405F" aria-label={title}>
          <title>{title}</title>
          <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919C8.416 2.175 8.796 2.163 12 2.163zm0-2.163C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
        </svg>
      )
    case 'telegram':
      return (
        <svg {...common} fill="#229ED9" aria-label={title}>
          <title>{title}</title>
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 7.06l-1.55 7.32c-.12.52-.42.65-.85.4l-2.35-1.73-1.13 1.09c-.13.13-.23.23-.46.23l.16-2.32 4.21-3.81c.18-.16-.04-.25-.28-.09L9.18 13.5l-2.24-.7c-.49-.15-.5-.49.1-.72l8.76-3.38c.41-.15.77.1.64.66z" />
        </svg>
      )
    case 'meta_lead_ads':
      return (
        <svg {...common} fill="#1877F2" aria-label={title}>
          <title>{title}</title>
          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
        </svg>
      )
    case 'web_chat':
    case 'portal_chat':
      return (
        <svg {...common} fill="#1a73e8" aria-label={title}>
          <title>{title}</title>
          <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z" />
        </svg>
      )
    case 'web_form':
    case 'form':
      return (
        <svg {...common} fill="#7c4dff" aria-label={title}>
          <title>{title}</title>
          <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zM6 20V4h7v5h5v11H6zm2-6h8v2H8v-2zm0-3h8v2H8v-2z" />
        </svg>
      )
    case 'enrollment_portal':
    case 'enrollment_portal_interest':
      return (
        <svg {...common} fill="#0d9488" aria-label={title}>
          <title>{title}</title>
          <path d="M12 3L1 9l11 6 9-4.91V17h2V9L12 3zm-6.82 9.97L12 16.72l6.82-3.75L20 13.61v3.5c-2.08 1.78-4.93 2.89-8 2.89s-5.92-1.11-8-2.89v-3.5l1.18-.64z" />
        </svg>
      )
    case 'landing_page':
      return (
        <svg {...common} fill="#f59e0b" aria-label={title}>
          <title>{title}</title>
          <path d="M3 3h18a1 1 0 011 1v16a1 1 0 01-1 1H3a1 1 0 01-1-1V4a1 1 0 011-1zm1 6v10h16V9H4zm0-2h16V5H4v2zm3 4h6v2H7v-2zm0 4h10v2H7v-2z" />
        </svg>
      )
    case 'scheduling':
      return (
        <svg {...common} fill="#0ea5e9" aria-label={title}>
          <title>{title}</title>
          <path d="M19 3h-1V1h-2v2H8V1H6v2H5a2 2 0 00-2 2v16a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2zm0 18H5V9h14v12zm0-14H5V5h14v2zM7 11h5v5H7v-5z" />
        </svg>
      )
    case 'chatbot':
      return (
        <svg {...common} fill="#8b5cf6" aria-label={title}>
          <title>{title}</title>
          <path d="M12 2a2 2 0 012 2v1h4a3 3 0 013 3v9a3 3 0 01-3 3H6a3 3 0 01-3-3V8a3 3 0 013-3h4V4a2 2 0 012-2zM8.5 11a1.5 1.5 0 100 3 1.5 1.5 0 000-3zm7 0a1.5 1.5 0 100 3 1.5 1.5 0 000-3zM2 12a1 1 0 011 1v3a1 1 0 11-2 0v-3a1 1 0 011-1zm20 0a1 1 0 011 1v3a1 1 0 11-2 0v-3a1 1 0 011-1z" />
        </svg>
      )
    case 'api':
      return (
        <svg {...common} fill="#475569" aria-label={title}>
          <title>{title}</title>
          <path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z" />
        </svg>
      )
    case 'manual':
      return (
        <svg {...common} fill="#6b7280" aria-label={title}>
          <title>{title}</title>
          <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
        </svg>
      )
    case 'direto':
      return (
        <svg {...common} fill="#64748b" aria-label={title}>
          <title>{title}</title>
          <path d="M12 2L2 12h3v8h6v-6h2v6h6v-8h3L12 2z" />
        </svg>
      )
    default:
      return (
        <svg {...common} fill="currentColor" class="text-fg-muted" aria-label={title}>
          <title>{title}</title>
          <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
        </svg>
      )
  }
}

export function KanbanPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPERADMIN'

  const [funnelId, setFunnelId] = useState<number | undefined>(undefined)
  const [showSelector, setShowSelector] = useState(true)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')

  // Filtros do board (compartilhados com /app/leads via scope='leads'). Tudo
  // que vier do SavedFiltersBar/aplicado é mergeado aqui e enviado pra
  // /admin/kanban/board como query params.
  const [boardFilters, setBoardFilters] = useState<KanbanBoardFilters>({})
  const currentUser = useUserStore((s) => s.user)
  const currentUserId = currentUser?.id != null ? Number(currentUser.id) : undefined
  const appliedFilterQ = useAppliedFilter('leads')
  const setAppliedMut = useSetAppliedFilter()
  const resetAppliedMut = useResetAppliedFilter()
  const appliedHydratedRef = useRef(false)

  useEffect(() => {
    if (appliedHydratedRef.current) return
    if (appliedFilterQ.isLoading) return
    const persisted = appliedFilterQ.data?.filters as Partial<KanbanBoardFilters> | null | undefined
    if (persisted && typeof persisted === 'object') {
      setBoardFilters((curr) => ({ ...persisted, ...curr }))
    }
    appliedHydratedRef.current = true
  }, [appliedFilterQ.isLoading, appliedFilterQ.data])

  useEffect(() => {
    if (!appliedHydratedRef.current) return
    const handle = setTimeout(() => {
      // search e funnelId não persistem (cada tela controla local).
      const { search: _s, funnelId: _f, ...rest } = boardFilters
      setAppliedMut.mutate({ scope: 'leads', filters: rest as Record<string, unknown> })
    }, 400)
    return () => clearTimeout(handle)
  }, [boardFilters])

  function applyFromSaved(saved: Record<string, unknown>) {
    setBoardFilters((curr) => ({ ...(saved as KanbanBoardFilters), search: curr.search, funnelId: curr.funnelId }))
  }

  function resetAllBoardFilters() {
    setBoardFilters({ funnelId, search: searchInput })
    resetAppliedMut.mutate({ scope: 'leads' })
  }

  const hasActiveBoardFilters = Boolean(
    boardFilters.outcome || boardFilters.aiScoreLabel
    || (boardFilters.sources && boardFilters.sources.length > 0)
    || (boardFilters.assignedUserIds && boardFilters.assignedUserIds.length > 0)
    || (boardFilters.tagIds && boardFilters.tagIds.length > 0)
    || boardFilters.dateFrom || boardFilters.dateTo,
  )
  const [sort, setSort] = useState<SortKey>('recent')
  const [compact, setCompact] = useState<boolean>(loadCompact())
  const [view, setView] = useState<ViewMode>(loadView())
  const [hideLost, setHideLost] = useState<boolean>(loadHideLost())
  const [showFilters, setShowFilters] = useState<boolean>(false)
  const [draggingLead, setDraggingLead] = useState<KanbanLead | null>(null)
  const [duplicating, setDuplicating] = useState<KanbanLead | null>(null)
  const [moving, setMoving] = useState<KanbanLead | null>(null)
  const [, navigate] = useLocation()
  const [activityFor, setActivityFor] = useState<{ id: number; label: string; whatsapp?: string | null; email?: string | null } | null>(null)
  const [permissionsOpen, setPermissionsOpen] = useState(false)
  const [markWonFor, setMarkWonFor] = useState<number | null>(null)
  const [markLostFor, setMarkLostFor] = useState<number | null>(null)
  const [showHowItWorks, setShowHowItWorks] = useState(false)

  const kanbanQueryFilters: KanbanBoardFilters = { ...boardFilters, funnelId, search: search || undefined, hideLost: hideLost && !boardFilters.outcome ? true : undefined }
  const { data, isLoading, isFetching } = useKanbanBoard(kanbanQueryFilters)
  const move = useMoveLeadStage(funnelId)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim().toLowerCase()), 250)
    return () => clearTimeout(t)
  }, [searchInput])

  function toggleCompact() {
    setCompact((c) => {
      const next = !c
      try { localStorage.setItem('bh_kanban_compact', next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }
  function changeView(v: ViewMode) {
    setView(v)
    try { localStorage.setItem('bh_kanban_view', v) } catch { /* ignore */ }
  }
  function toggleHideLost() {
    setHideLost((h) => {
      const next = !h
      try { localStorage.setItem('bh_kanban_hide_lost', next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }
  function patchBoardFilters(p: Partial<KanbanBoardFilters>) {
    setBoardFilters((c) => ({ ...c, ...p }))
  }

  const filteredLeads = useMemo(() => {
    if (!data) return {}
    const out: Record<string, KanbanLead[]> = {}
    for (const [stageKey, list] of Object.entries(data.leads)) {
      let filtered = list
      if (search) {
        filtered = filtered.filter((l) => {
          return [l.nome, l.empresa, l.whatsapp, l.email]
            .filter(Boolean)
            .some((v) => v!.toLowerCase().includes(search))
        })
      }
      const sorted = filtered.slice()
      sorted.sort((a, b) => {
        if (sort === 'recent') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        if (sort === 'oldest') return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        if (sort === 'score') return (b.scores?.geral ?? 0) - (a.scores?.geral ?? 0)
        if (sort === 'name') {
          const an = (a.nome ?? a.empresa ?? '').toLowerCase()
          const bn = (b.nome ?? b.empresa ?? '').toLowerCase()
          return an.localeCompare(bn)
        }
        return 0
      })
      out[stageKey] = sorted
    }
    return out
  }, [data, search, sort])

  const totalLeads = useMemo(() => {
    if (!data) return 0
    return Object.values(data.leads).reduce((sum, list) => sum + list.length, 0)
  }, [data])

  function findLead(leadId: number): KanbanLead | undefined {
    if (!data) return undefined
    for (const list of Object.values(data.leads)) {
      const found = list.find((l) => l.id === leadId)
      if (found) return found
    }
    return undefined
  }

  function handleDragStart(e: DragStartEvent) {
    const id = Number(e.active.id)
    setDraggingLead(findLead(id) ?? null)
  }

  function handleDragEnd(e: DragEndEvent) {
    setDraggingLead(null)
    const leadId = Number(e.active.id)
    const targetStageKey = e.over?.id ? String(e.over.id) : null
    if (!targetStageKey || !data) return
    const lead = findLead(leadId)
    if (!lead) return

    if (lead.status === targetStageKey) return

    const stages = data.stages
    const fromIdx = stages.findIndex((s) => s.key === lead.status)
    const toIdx = stages.findIndex((s) => s.key === targetStageKey)
    if (toIdx > fromIdx && !data.permissions.canAdvance) {
      toast('Sem permissão para avançar leads', 'danger')
      return
    }
    if (toIdx < fromIdx && !data.permissions.canRetreat) {
      toast('Sem permissão para retroceder leads', 'danger')
      return
    }

    move.mutate({ leadId, status: targetStageKey }, {
      onError: (err: unknown) => toast((err as Error).message, 'danger'),
    })
  }

  function backToSelector() {
    setShowSelector(true)
    setFunnelId(undefined)
  }
  function pickFunnel(id: number) {
    setFunnelId(id)
    setShowSelector(false)
  }
  function leadLabel(l: KanbanLead): string {
    return l.nome ?? l.empresa ?? `Lead #${l.id}`
  }

  return (
    <Page
      title="Kanban"
      description={showSelector ? 'Escolha o funil para visualizar no quadro Kanban.' : 'Arraste cards entre etapas para mover leads no funil.'}
      actions={
        showSelector ? (
          <Button variant="ghost" size="sm" onClick={() => setShowHowItWorks(true)}>
            <HelpCircle size={14} /> Como funciona?
          </Button>
        ) : (
          <div class="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setShowHowItWorks(true)}>
              <HelpCircle size={14} /> Como funciona?
            </Button>
            <Button variant="secondary" size="sm" onClick={backToSelector}>
              <ArrowLeft size={12} /> Funis
            </Button>
            {data && data.funnels.length > 1 && (
              <Select
                value={String(funnelId ?? data.currentFunnelId ?? '')}
                onChange={(e) => setFunnelId(Number((e.target as HTMLSelectElement).value) || undefined)}
              >
                {data.funnels.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}{f.isDefault ? ' (padrão)' : ''}</option>
                ))}
              </Select>
            )}
            <Select value={sort} onChange={(e) => setSort((e.target as HTMLSelectElement).value as SortKey)}>
              {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
            <ViewToggle view={view} onChange={changeView} />
            <Button variant="secondary" size="sm" onClick={toggleCompact}>
              {compact ? 'Confortável' : 'Compacto'}
            </Button>
            <Button
              variant={hideLost && !boardFilters.outcome ? 'primary' : 'secondary'}
              size="sm"
              onClick={toggleHideLost}
              disabled={!!boardFilters.outcome}
              title={boardFilters.outcome
                ? 'Há um filtro de status ativo — ele tem prioridade sobre este botão'
                : (hideLost ? 'Leads perdidos ocultos — clique para mostrar' : 'Leads perdidos visíveis — clique para ocultar')}
            >
              {hideLost && !boardFilters.outcome ? 'Perdidos ocultos' : 'Perdidos visíveis'}
            </Button>
            <Button
              variant={showFilters || hasActiveBoardFilters ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setShowFilters((v) => !v)}
              title="Filtros (resultado, score IA, período, responsável, origem, etiquetas)"
            >
              Filtros{hasActiveBoardFilters ? ' •' : ''}
            </Button>
            {isAdmin && (
              <Button variant="secondary" size="sm" onClick={() => setPermissionsOpen(true)}>
                <ShieldCheck size={12} /> Permissões
              </Button>
            )}
          </div>
        )
      }
    >
      {showSelector ? (
        <FunnelSelector onPick={pickFunnel} />
      ) : (
        <>
          <Card class="p-3">
            <div class="flex flex-wrap items-center gap-3">
              <SearchInput
                value={searchInput}
                onChange={setSearchInput}
                placeholder="Buscar lead no kanban…"
                class="flex-1 min-w-48"
              />
              <SavedFiltersBar
                scope="leads"
                currentFilters={(({ search: _s, funnelId: _f, ...rest }) => rest as Record<string, unknown>)(boardFilters)}
                hasActiveFilters={hasActiveBoardFilters}
                onApply={applyFromSaved}
                onReset={resetAllBoardFilters}
                currentUserId={currentUserId}
              />
              <Badge tone="neutral">{totalLeads} {totalLeads === 1 ? 'lead' : 'leads'}</Badge>
              <span title="Atualiza a cada 30s" class="inline-flex">
                <Badge tone="success">
                  {isFetching && !isLoading ? 'Atualizando…' : 'Auto-refresh ON'}
                </Badge>
              </span>
            </div>
          </Card>

          {showFilters && (
            <KanbanFiltersPanel filters={boardFilters} onChange={patchBoardFilters} />
          )}

          {isLoading && (
            <div class="flex gap-3 overflow-x-auto pb-2">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} class="h-64 w-72 shrink-0" />)}
            </div>
          )}

          {!isLoading && data?.stages.length === 0 && (
            <EmptyState title="Nenhuma etapa configurada" description="Configure stages no funil ativo." />
          )}

          {!isLoading && data && data.stages.length > 0 && view === 'kanban' && (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              <div class="flex gap-3 overflow-x-auto pb-3">
                {data.stages.map((s) => (
                  <KanbanColumn
                    key={s.id}
                    stage={s}
                    cards={filteredLeads[s.key] ?? []}
                    totalAll={(data.leads[s.key] ?? []).length}
                    compact={compact}
                    onView={(lead) => navigate(`/leads/${lead.id}`)}
                    onActivity={(lead) => setActivityFor({ id: lead.id, label: leadLabel(lead), whatsapp: lead.whatsapp, email: lead.email })}
                    onDuplicate={(lead) => setDuplicating(lead)}
                    onMove={(lead) => setMoving(lead)}
                    onMarkWon={(lead) => setMarkWonFor(lead.id)}
                    onMarkLost={(lead) => setMarkLostFor(lead.id)}
                  />
                ))}
              </div>
              <DragOverlay>
                {draggingLead && <LeadCard lead={draggingLead} dragging compact={compact} />}
              </DragOverlay>
            </DndContext>
          )}

          {!isLoading && data && data.stages.length > 0 && view === 'list' && (
            <KanbanListView
              stages={data.stages}
              leadsByStage={filteredLeads}
              totalsByStage={data.leads}
              onView={(lead) => navigate(`/leads/${lead.id}`)}
              onActivity={(lead) => setActivityFor({ id: lead.id, label: leadLabel(lead), whatsapp: lead.whatsapp, email: lead.email })}
              onDuplicate={(lead) => setDuplicating(lead)}
              onMove={(lead) => setMoving(lead)}
            />
          )}
        </>
      )}

      {duplicating && data && (
        <DuplicateLeadModal
          lead={duplicating}
          funnels={data.funnels}
          currentFunnelId={data.currentFunnelId ?? funnelId}
          onClose={() => setDuplicating(null)}
        />
      )}
      {moving && data && (
        <MoveLeadFunnelModal
          lead={moving}
          funnels={data.funnels}
          currentFunnelId={data.currentFunnelId ?? funnelId}
          onClose={() => setMoving(null)}
        />
      )}
      {permissionsOpen && (
        <KanbanPermissionsModal onClose={() => setPermissionsOpen(false)} />
      )}
      {activityFor && (
        <Suspense fallback={null}>
          <LazyCreateActivityModal preselectedLead={activityFor} onClose={() => setActivityFor(null)} />
        </Suspense>
      )}
      {markWonFor !== null && (
        <MarkWonModal open onClose={() => setMarkWonFor(null)} leadId={markWonFor} />
      )}
      {markLostFor !== null && (
        <MarkLostModal open onClose={() => setMarkLostFor(null)} leadId={markLostFor} />
      )}
      {showHowItWorks && <HowItWorksModal onClose={() => setShowHowItWorks(false)} />}
    </Page>
  )
}

function ViewToggle({ view, onChange }: { view: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <div class="inline-flex rounded-md border border-border overflow-hidden">
      <button
        type="button"
        class={cn(
          'px-2 py-1 text-xs inline-flex items-center gap-1 transition-colors',
          view === 'kanban' ? 'bg-accent/15 text-accent' : 'bg-surface-2 text-fg-muted hover:text-fg',
        )}
        onClick={() => onChange('kanban')}
        title="Kanban"
        aria-pressed={view === 'kanban'}
      >
        <LayoutGrid size={12} /> Kanban
      </button>
      <button
        type="button"
        class={cn(
          'px-2 py-1 text-xs inline-flex items-center gap-1 border-l border-border transition-colors',
          view === 'list' ? 'bg-accent/15 text-accent' : 'bg-surface-2 text-fg-muted hover:text-fg',
        )}
        onClick={() => onChange('list')}
        title="Lista"
        aria-pressed={view === 'list'}
      >
        <ListIcon size={12} /> Lista
      </button>
    </div>
  )
}

function FunnelSelector({ onPick }: { onPick: (id: number) => void }) {
  const { data, isLoading } = useKanbanFunnelsSummary()

  if (isLoading) {
    return (
      <div class="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} class="h-48" />)}
      </div>
    )
  }

  const funnels = data?.funnels ?? []
  if (funnels.length === 0) {
    return <EmptyState title="Nenhum funil encontrado" description="Crie um funil em CRM > Funis." />
  }

  return (
    <div class="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
      {funnels.map((f) => <FunnelCard key={f.id} funnel={f} onPick={onPick} />)}
    </div>
  )
}

function FunnelCard({ funnel, onPick }: { funnel: KanbanFunnelSummary; onPick: (id: number) => void }) {
  const previewStages = funnel.stages.slice(0, 5)
  const moreStages = funnel.stages.length - previewStages.length
  return (
    <button
      type="button"
      class="group text-left rounded-lg border border-border bg-surface-2 p-4 hover:border-accent hover:bg-surface-3 hover:shadow-md transition-all flex flex-col gap-3"
      onClick={() => onPick(funnel.id)}
    >
      <div class="flex items-center gap-3">
        <span
          class={cn(
            'size-10 rounded-md grid place-items-center shrink-0',
            funnel.isDefault ? 'bg-accent/15 text-accent' : 'bg-surface-3 text-fg-muted',
          )}
        >
          <GitFork size={18} />
        </span>
        <div class="min-w-0 flex-1">
          <div class="text-sm font-medium text-fg truncate">{funnel.name}</div>
          {funnel.isDefault && <Badge tone="warning">Padrão</Badge>}
        </div>
      </div>
      <div class="flex items-center gap-4 text-xs text-fg-muted">
        <span class="inline-flex items-center gap-1">
          <UsersIcon size={12} />
          <strong class="text-fg tabular-nums">{funnel.leadCount}</strong> leads
        </span>
        <span class="inline-flex items-center gap-1">
          <ListIcon size={12} />
          <strong class="text-fg tabular-nums">{funnel.stageCount}</strong> etapas
        </span>
      </div>
      {previewStages.length > 0 && (
        <div class="border-t border-border pt-2 space-y-1">
          {previewStages.map((s) => (
            <div key={s.id} class="flex items-center justify-between text-xs">
              <span class="inline-flex items-center gap-2 min-w-0">
                <span class="size-2 rounded-full shrink-0" style={{ background: s.color || 'var(--color-accent)' }} />
                <span class="text-fg-muted truncate">{s.name}</span>
              </span>
              <span class="text-fg tabular-nums font-medium">{s.leadCount}</span>
            </div>
          ))}
          {moreStages > 0 && <div class="text-2xs text-fg-muted">+{moreStages} etapas</div>}
        </div>
      )}
    </button>
  )
}

function KanbanColumn({
  stage, cards, totalAll, compact, onView, onActivity, onDuplicate, onMove, onMarkWon, onMarkLost,
}: {
  stage: KanbanStage
  cards: KanbanLead[]
  totalAll: number
  compact: boolean
  onView: (l: KanbanLead) => void
  onActivity: (l: KanbanLead) => void
  onDuplicate: (l: KanbanLead) => void
  onMove: (l: KanbanLead) => void
  onMarkWon?: (l: KanbanLead) => void
  onMarkLost?: (l: KanbanLead) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.key })
  const overWip = totalAll > WIP_DEFAULT
  const wipPct = Math.min(100, Math.round((totalAll / WIP_DEFAULT) * 100))
  const wipColor = overWip ? 'var(--color-danger)' : wipPct > 75 ? 'var(--color-warning)' : 'var(--color-success)'

  return (
    <section
      ref={setNodeRef}
      class={cn(
        'w-72 shrink-0 rounded-lg border bg-surface-2 flex flex-col max-h-[calc(100dvh-14rem)] transition-colors',
        isOver ? 'border-accent ring-2 ring-accent/30' : 'border-border',
      )}
      data-stage={stage.key}
    >
      <header class="p-3 border-b border-border" style={{ borderBottomColor: stage.color || undefined }}>
        <div class="flex items-center justify-between gap-2">
          <span class="flex items-center gap-2 min-w-0">
            <span class="size-2 rounded-full shrink-0" style={{ background: stage.color || 'var(--color-accent)' }} />
            <span class="text-sm font-medium truncate" style={{ color: stage.color || 'var(--color-fg)' }}>{stage.name}</span>
            {overWip && <AlertTriangle size={12} class="text-danger shrink-0" aria-label="Acima do WIP" />}
          </span>
          <span
            class={cn(
              'text-xs tabular-nums px-1.5 py-0.5 rounded',
              overWip ? 'bg-danger/15 text-danger font-medium' : 'text-fg-muted',
            )}
          >
            {cards.length}{cards.length !== totalAll && <span class="text-fg-muted">/{totalAll}</span>}
          </span>
        </div>
        <div class="mt-2 h-1 rounded-full bg-surface-3 overflow-hidden">
          <div class="h-full transition-all" style={{ width: `${wipPct}%`, background: wipColor }} />
        </div>
      </header>
      <div class="flex-1 overflow-y-auto p-2 flex flex-col gap-2">
        {cards.length === 0 ? (
          <div class="text-xs text-fg-muted text-center py-4">
            {totalAll > 0 ? 'Nenhum lead nesta busca' : 'Nenhum lead nesta etapa'}
          </div>
        ) : (
          cards.map((c) => (
            <DraggableCard
              key={c.id}
              lead={c}
              compact={compact}
              onView={() => onView(c)}
              onActivity={() => onActivity(c)}
              onDuplicate={() => onDuplicate(c)}
              onMove={() => onMove(c)}
              onMarkWon={onMarkWon ? () => onMarkWon(c) : undefined}
              onMarkLost={onMarkLost ? () => onMarkLost(c) : undefined}
            />
          ))
        )}
      </div>
    </section>
  )
}

function DraggableCard({
  lead, compact, onView, onActivity, onDuplicate, onMove, onMarkWon, onMarkLost,
}: {
  lead: KanbanLead
  compact: boolean
  onView: () => void
  onActivity: () => void
  onDuplicate: () => void
  onMove: () => void
  onMarkWon?: (() => void) | undefined
  onMarkLost?: (() => void) | undefined
}) {
  const { attributes, listeners, setNodeRef, isDragging, transform } = useDraggable({ id: lead.id })
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, opacity: isDragging ? 0.4 : undefined }
    : { opacity: isDragging ? 0.4 : undefined }
  return (
    <div
      ref={setNodeRef}
      style={style}
      class="touch-none"
      {...(listeners as unknown as Record<string, unknown>)}
      {...(attributes as unknown as Record<string, unknown>)}
    >
      <LeadCard
        lead={lead}
        compact={compact}
        onView={onView}
        onActivity={onActivity}
        onDuplicate={onDuplicate}
        onMove={onMove}
        onMarkWon={onMarkWon}
        onMarkLost={onMarkLost}
      />
    </div>
  )
}

/** Campos personalizados marcados "mostrar no Kanban" que o lead tem preenchidos.
 * Máximo de 3 linhas — o card é denso e precisa continuar legível. */
function useKanbanCardFields(lead: KanbanLead): Array<{ key: string; label: string; value: string }> {
  const { data } = useCustomFields()
  return useMemo(() => {
    const values = (lead.customFields ?? {}) as Record<string, unknown>
    const out: Array<{ key: string; label: string; value: string }> = []
    for (const f of data?.fields ?? []) {
      if (!f.active || !f.showInKanban) continue
      const v = values[f.key]
      if (v === null || v === undefined || v === '') continue
      const text = Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v)
      out.push({ key: f.key, label: f.label, value: text })
      if (out.length === 3) break
    }
    return out
  }, [data?.fields, lead.customFields])
}

function isStale(updatedAt: string): boolean {
  const ts = new Date(updatedAt).getTime()
  if (!Number.isFinite(ts)) return false
  return Date.now() - ts > STALE_DAYS * 86400000
}

function daysSince(updatedAt: string): number {
  const ts = new Date(updatedAt).getTime()
  if (!Number.isFinite(ts)) return 0
  return Math.floor((Date.now() - ts) / 86400000)
}

function timeAgo(dateStr: string): string {
  const ts = new Date(dateStr).getTime()
  if (!Number.isFinite(ts)) return ''
  const diff = Math.floor((Date.now() - ts) / 86400000)
  if (diff <= 0) return 'hoje'
  if (diff === 1) return 'ontem'
  return `${diff}d`
}

// Lead Routing F6: chip compacto do responsável no rodapé do card.
function AssigneeChip({ name }: { name: string | null }) {
  if (!name) {
    return (
      <span class="inline-flex items-center gap-1 text-fg-muted" title="Sem responsável">
        <span class="size-4 rounded-full border border-dashed border-border" />
        <span class="italic">Fila</span>
      </span>
    )
  }
  // Iniciais: primeira letra de cada palavra (até 2).
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
  const firstName = name.split(/\s+/)[0] ?? name
  return (
    <span class="inline-flex items-center gap-1" title={name}>
      <span class="size-4 rounded-full bg-accent/15 text-accent text-3xs font-bold flex items-center justify-center">
        {initials}
      </span>
      <span class="truncate max-w-[5rem]">{firstName}</span>
    </span>
  )
}

function LeadCard({
  lead, dragging = false, compact = false, onView, onActivity, onDuplicate, onMove, onMarkWon, onMarkLost,
}: {
  lead: KanbanLead
  dragging?: boolean | undefined
  compact?: boolean | undefined
  onView?: (() => void) | undefined
  onActivity?: (() => void) | undefined
  onDuplicate?: (() => void) | undefined
  onMove?: (() => void) | undefined
  onMarkWon?: (() => void) | undefined
  onMarkLost?: (() => void) | undefined
}) {
  const stale = isStale(lead.updatedAt)
  const score = typeof lead.scores?.geral === 'number' ? lead.scores.geral : null
  const kanbanFields = useKanbanCardFields(lead)
  const showActions = onView ?? onActivity ?? onDuplicate ?? onMove ?? onMarkWon ?? onMarkLost
  const outcomeBorder = lead.outcome === 'won'
    ? 'border-l-2 border-l-success'
    : lead.outcome === 'lost'
    ? 'border-l-2 border-l-danger'
    : stale
    ? 'border-l-2 border-l-danger'
    : 'border-border'

  return (
    <div
      class={cn(
        'relative block rounded-md bg-surface border p-2.5 select-none',
        dragging ? 'shadow-xl border-accent rotate-1 cursor-grabbing' : 'cursor-grab hover:border-accent transition-colors',
        outcomeBorder,
      )}
    >
      <div class="flex items-center justify-between gap-2">
        <span class="text-sm text-fg truncate flex-1 min-w-0 inline-flex items-center gap-1.5">
          <ChannelIcon source={lead.source} />
          <span class="truncate">{lead.nome ?? lead.empresa ?? '—'}</span>
          {/* Este lead está aqui como funil ADICIONAL: o processo principal
            * dele é outro. Sem dizer isso, o operador cobra neste quadro um
            * andamento que está sendo tocado em outro lugar. */}
          {lead._funilAdicional && (
            <span
              class="shrink-0 text-fg-muted"
              title="Também está em outro funil, que é o processo principal deste lead"
            >
              <GitFork size={11} />
            </span>
          )}
        </span>
        <div class="flex items-center gap-1 shrink-0">
          {score !== null && (
            <span class={cn(
              'text-3xs font-semibold tabular-nums px-1.5 py-0.5 rounded',
              score >= 70 ? 'bg-success/15 text-success' : score <= 39 ? 'bg-danger/15 text-danger' : 'bg-warning/15 text-warning',
            )}>{Math.round(score)}</span>
          )}
          {lead._activityCount > 0 && <Badge tone="warning">{lead._activityCount}</Badge>}
          <StatusSummaryBadge summary={lead.statusSummary} />
          {lead.outcome && <OutcomeBadge outcome={lead.outcome} />}
          {lead.whatsapp && (
            <SendWhatsAppButton leadId={lead.id} whatsapp={lead.whatsapp} compact class="!h-7 !w-7" />
          )}
          {showActions && (
            <CardActions
              onView={onView}
              onActivity={onActivity}
              onDuplicate={onDuplicate}
              onMove={onMove}
              onMarkWon={onMarkWon}
              onMarkLost={onMarkLost}
              hasOutcome={!!lead.outcome}
            />
          )}
        </div>
      </div>
      {!compact && (
        <>
          {lead.empresa && lead.nome && (
            <div class="text-xs text-fg-muted truncate mt-0.5">{lead.empresa}</div>
          )}
          <div class="flex items-center gap-2 mt-1.5 text-xs flex-wrap">
            {lead.whatsapp && (
              <span
                class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-3 text-fg-muted font-medium"
                title={lead.whatsapp}
              >
                <Phone size={10} /> {lead.whatsapp}
              </span>
            )}
            {lead.email && (
              <span
                class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-3 text-fg-muted max-w-[160px] truncate"
                title={lead.email}
              >
                <Mail size={10} /> <span class="truncate">{lead.email}</span>
              </span>
            )}
            {lead._metaFormName && (
              <span class="inline-flex items-center gap-1 truncate text-fg-muted" title={lead._metaFormName}>
                <Sparkles size={10} class="text-info" /> {lead._metaFormName}
              </span>
            )}
          </div>
          {lead.tags && lead.tags.length > 0 && (
            <div class="flex flex-wrap gap-1 mt-2">
              {lead.tags.slice(0, 3).map(({ tag }) => (
                <span
                  key={tag.id}
                  class="text-3xs px-1.5 py-0.5 rounded-full font-medium"
                  style={{ background: `${tag.color}22`, color: tag.color }}
                >
                  {tag.name}
                </span>
              ))}
              {lead.tags.length > 3 && (
                <span class="text-3xs px-1.5 py-0.5 rounded-full font-medium bg-surface-3 text-fg-muted">
                  +{lead.tags.length - 3}
                </span>
              )}
            </div>
          )}
          {kanbanFields.length > 0 && (
            <div class="mt-2 space-y-0.5">
              {kanbanFields.map((f) => (
                <div key={f.key} class="flex items-baseline gap-1.5 text-2xs leading-snug">
                  <span class="text-fg-muted shrink-0">{f.label}:</span>
                  <span class="text-fg-muted truncate" title={f.value}>{f.value}</span>
                </div>
              ))}
            </div>
          )}
          {lead.annotation && (
            <div
              class="mt-2 p-1.5 rounded border border-warning/40 bg-warning/10 text-2xs text-warning leading-snug line-clamp-2 inline-flex items-start gap-1"
              title={lead.annotation}
            >
              <StickyNote size={10} class="shrink-0 mt-0.5" />
              <span class="line-clamp-2">{lead.annotation}</span>
            </div>
          )}
          <div class="flex items-center justify-between mt-2 text-2xs text-fg-muted">
            <AssigneeChip name={lead.assignedUser?.name ?? null} />
            <span class={stale ? 'text-danger font-medium' : ''} title={new Date(lead.createdAt).toLocaleDateString('pt-BR')}>
              {timeAgo(lead.createdAt)}
            </span>
          </div>
        </>
      )}
      {stale && compact && (
        <div class="text-3xs text-danger mt-1 font-medium">
          {daysSince(lead.updatedAt)}d parado
        </div>
      )}
    </div>
  )
}

function CardActions({
  onView, onActivity, onDuplicate, onMove, onMarkWon, onMarkLost, hasOutcome,
}: {
  onView?: (() => void) | undefined
  onActivity?: (() => void) | undefined
  onDuplicate?: (() => void) | undefined
  onMove?: (() => void) | undefined
  onMarkWon?: (() => void) | undefined
  onMarkLost?: (() => void) | undefined
  hasOutcome?: boolean
}) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    function close() { setOpen(false) }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [open])

  return (
    <div class="relative inline-block" onPointerDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        class="size-6 grid place-items-center rounded text-fg-muted hover:text-fg hover:bg-surface-3"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}
        aria-label="Ações"
      >
        <MoreHorizontal size={12} />
      </button>
      {open && (
        <div
          class="absolute right-0 top-full mt-1 w-44 rounded-md border border-border bg-surface-2 shadow-lg py-1 z-20"
          onClick={(e) => e.stopPropagation()}
        >
          {onView && (
            <button type="button" class="w-full text-left px-3 py-1.5 text-xs text-fg hover:bg-surface-3 inline-flex items-center gap-2" onClick={() => { setOpen(false); onView() }}>
              <Eye size={12} /> Ver detalhes
            </button>
          )}
          {onActivity && (
            <button type="button" class="w-full text-left px-3 py-1.5 text-xs text-fg hover:bg-surface-3 inline-flex items-center gap-2" onClick={() => { setOpen(false); onActivity() }}>
              <ListChecks size={12} /> Nova atividade
            </button>
          )}
          {(onMarkWon || onMarkLost) && !hasOutcome && <div class="my-1 border-t border-border" />}
          {onMarkWon && !hasOutcome && (
            <button type="button" class="w-full text-left px-3 py-1.5 text-xs text-success hover:bg-surface-3 inline-flex items-center gap-2" onClick={() => { setOpen(false); onMarkWon() }}>
              <Trophy size={12} /> Marcar como Ganho
            </button>
          )}
          {onMarkLost && !hasOutcome && (
            <button type="button" class="w-full text-left px-3 py-1.5 text-xs text-danger hover:bg-surface-3 inline-flex items-center gap-2" onClick={() => { setOpen(false); onMarkLost() }}>
              <XCircle size={12} /> Marcar como Perdido
            </button>
          )}
          {(onDuplicate ?? onMove) && <div class="my-1 border-t border-border" />}
          {onMove && (
            <button type="button" class="w-full text-left px-3 py-1.5 text-xs text-accent hover:bg-surface-3 inline-flex items-center gap-2" onClick={() => { setOpen(false); onMove() }}>
              <ArrowRight size={12} /> Mover para Funil
            </button>
          )}
          {onDuplicate && (
            <button type="button" class="w-full text-left px-3 py-1.5 text-xs text-success hover:bg-surface-3 inline-flex items-center gap-2" onClick={() => { setOpen(false); onDuplicate() }}>
              <CopyIcon size={12} /> Duplicar lead
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// View: Lista (seções colapsáveis)

function KanbanListView({
  stages, leadsByStage, totalsByStage, onView, onActivity, onDuplicate, onMove,
}: {
  stages: KanbanStage[]
  leadsByStage: Record<string, KanbanLead[]>
  totalsByStage: Record<string, KanbanLead[]>
  onView: (l: KanbanLead) => void
  onActivity: (l: KanbanLead) => void
  onDuplicate: (l: KanbanLead) => void
  onMove: (l: KanbanLead) => void
}) {
  return (
    <div class="space-y-3">
      {stages.map((s) => (
        <KanbanListSection
          key={s.id}
          stage={s}
          cards={leadsByStage[s.key] ?? []}
          totalAll={(totalsByStage[s.key] ?? []).length}
          onView={onView}
          onActivity={onActivity}
          onDuplicate={onDuplicate}
          onMove={onMove}
        />
      ))}
    </div>
  )
}

function KanbanListSection({
  stage, cards, totalAll, onView, onActivity, onDuplicate, onMove,
}: {
  stage: KanbanStage
  cards: KanbanLead[]
  totalAll: number
  onView: (l: KanbanLead) => void
  onActivity: (l: KanbanLead) => void
  onDuplicate: (l: KanbanLead) => void
  onMove: (l: KanbanLead) => void
}) {
  const [open, setOpen] = useState(true)
  const overWip = totalAll > WIP_DEFAULT
  return (
    <Card class="p-0 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        class="w-full flex items-center justify-between gap-2 p-3 text-left hover:bg-surface-3 transition-colors"
      >
        <span class="flex items-center gap-2 min-w-0">
          <span class="size-3 rounded shrink-0" style={{ background: stage.color || 'var(--color-accent)' }} />
          <span class="text-sm font-medium text-fg truncate">{stage.name}</span>
          <span class={cn(
            'text-xs tabular-nums px-1.5 py-0.5 rounded',
            overWip ? 'bg-danger/15 text-danger font-medium' : 'bg-surface-3 text-fg-muted',
          )}>
            {cards.length}{cards.length !== totalAll && <span class="text-fg-muted">/{totalAll}</span>}
            {overWip && ' ⚠'}
          </span>
        </span>
        {open ? <ChevronUp size={14} class="text-fg-muted" /> : <ChevronDown size={14} class="text-fg-muted" />}
      </button>
      {open && (
        <div class="border-t border-border">
          {cards.length === 0 ? (
            <div class="text-xs text-fg-muted text-center py-4">Nenhum lead nesta etapa</div>
          ) : (
            <ul class="divide-y divide-border">
              {cards.map((l) => (
                <KanbanListRow
                  key={l.id}
                  lead={l}
                  onView={() => onView(l)}
                  onActivity={() => onActivity(l)}
                  onDuplicate={() => onDuplicate(l)}
                  onMove={() => onMove(l)}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  )
}

function KanbanListRow({
  lead, onView, onActivity, onDuplicate, onMove,
}: {
  lead: KanbanLead
  onView: () => void
  onActivity: () => void
  onDuplicate: () => void
  onMove: () => void
}) {
  const stale = isStale(lead.updatedAt)
  return (
    <li class={cn(
      'px-3 py-2 flex items-center gap-3 hover:bg-surface-3',
      stale && 'border-l-2 border-l-danger',
    )}>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          <ChannelIcon source={lead.source} />
          <span class="text-sm text-fg truncate">{lead.nome ?? '—'}</span>
          {lead._activityCount > 0 && <Badge tone="warning">{lead._activityCount}</Badge>}
        </div>
        <div class="text-xs text-fg-muted truncate flex items-center gap-2 flex-wrap mt-0.5">
          <span>{lead.empresa ?? '—'}</span>
          {lead.whatsapp && (
            <span class="text-fg-muted inline-flex items-center gap-1" title={lead.whatsapp}>
              <Phone size={10} /> {lead.whatsapp}
            </span>
          )}
          {lead._metaFormName && (
            <span class="text-info inline-flex items-center gap-1 truncate max-w-[140px]" title={lead._metaFormName}>
              <Sparkles size={10} /> {lead._metaFormName}
            </span>
          )}
          <span class="text-3xs"><AssigneeChip name={lead.assignedUser?.name ?? null} /></span>
        </div>
      </div>
      <div class={cn('text-2xs whitespace-nowrap', stale ? 'text-danger font-medium' : 'text-fg-muted')} title={new Date(lead.createdAt).toLocaleDateString('pt-BR')}>
        {timeAgo(lead.createdAt)}
      </div>
      <div class="flex items-center gap-1 shrink-0">
        {lead.whatsapp && <SendWhatsAppButton leadId={lead.id} whatsapp={lead.whatsapp} compact />}
        <Button variant="secondary" size="sm" onClick={onView}>Ver</Button>
        <Button variant="secondary" size="sm" onClick={onActivity}><Plus size={12} />Ativ</Button>
        <Button variant="secondary" size="sm" onClick={onMove}><ArrowRight size={12} />Funil</Button>
        <Button variant="secondary" size="sm" onClick={onDuplicate}><CopyIcon size={12} />Duplic</Button>
      </div>
    </li>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Modais

function DuplicateLeadModal({
  lead, funnels, currentFunnelId, onClose,
}: {
  lead: KanbanLead
  funnels: { id: number; name: string; isDefault: boolean }[]
  currentFunnelId?: number | undefined
  onClose: () => void
}) {
  const [targetFunnelId, setTargetFunnelId] = useState<number>(currentFunnelId ?? funnels[0]?.id ?? 0)
  const [stageKey, setStageKey] = useState<string>('')
  const { data: funnel } = useFunnel(targetFunnelId || null)
  const dup = useDuplicateLead()

  function handleSubmit() {
    if (!targetFunnelId) { toast('Escolha um funil', 'danger'); return }
    dup.mutate({ id: lead.id, funnelId: targetFunnelId, stageKey: stageKey || undefined }, {
      onSuccess: (r) => { toast(`Lead duplicado (#${r.id})`, 'success'); onClose() },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Duplicar "${lead.nome ?? lead.empresa ?? `#${lead.id}`}"`}
      description="Cria uma cópia do lead com tags preservadas no funil/etapa escolhidos."
      size="md"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={dup.isPending}>
            <CopyIcon size={12} /> {dup.isPending ? 'Duplicando…' : 'Duplicar'}
          </Button>
        </>
      }
    >
      <div class="space-y-3">
        <Select label="Funil de destino" value={String(targetFunnelId)} onChange={(e) => { setTargetFunnelId(Number((e.target as HTMLSelectElement).value)); setStageKey('') }}>
          {funnels.map((f) => <option key={f.id} value={f.id}>{f.name}{f.isDefault ? ' (padrão)' : ''}</option>)}
        </Select>
        <Select label="Etapa (opcional)" value={stageKey} onChange={(e) => setStageKey((e.target as HTMLSelectElement).value)} hint="Vazio usa a primeira etapa do funil">
          <option value="">Primeira etapa do funil</option>
          {funnel?.stages.filter((s) => s.active).map((s) => (
            <option key={s.key} value={s.key}>{s.name}</option>
          ))}
        </Select>
      </div>
    </Modal>
  )
}

function MoveLeadFunnelModal({
  lead, funnels, currentFunnelId, onClose,
}: {
  lead: KanbanLead
  funnels: { id: number; name: string; isDefault: boolean }[]
  currentFunnelId?: number | undefined
  onClose: () => void
}) {
  const otherFunnels = funnels.filter((f) => f.id !== currentFunnelId)
  const [targetFunnelId, setTargetFunnelId] = useState<number>(otherFunnels[0]?.id ?? 0)
  const [stageKey, setStageKey] = useState<string>('')
  const { data: funnel } = useFunnel(targetFunnelId || null)
  const send = useSendLeadsToKanban()

  function handleSubmit() {
    if (!targetFunnelId) { toast('Escolha um funil', 'danger'); return }
    send.mutate(
      { leadIds: [lead.id], funnelId: targetFunnelId, stageKey: stageKey || undefined },
      {
        onSuccess: () => { toast('Lead movido para o novo funil', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      },
    )
  }

  if (otherFunnels.length === 0) {
    return (
      <Modal
        open
        onOpenChange={(o) => { if (!o) onClose() }}
        title="Mover entre funis"
        size="md"
        footer={<Button variant="primary" size="sm" onClick={onClose}>Fechar</Button>}
      >
        <p class="text-sm text-fg-muted">Não há outro funil disponível para mover este lead.</p>
      </Modal>
    )
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Mover "${lead.nome ?? lead.empresa ?? `#${lead.id}`}"`}
      description="O lead sai do funil atual e vai para a etapa escolhida do novo funil."
      size="md"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={send.isPending}>
            <ArrowRight size={12} /> {send.isPending ? 'Movendo…' : 'Mover'}
          </Button>
        </>
      }
    >
      <div class="space-y-3">
        <Select label="Funil de destino" value={String(targetFunnelId)} onChange={(e) => { setTargetFunnelId(Number((e.target as HTMLSelectElement).value)); setStageKey('') }}>
          {otherFunnels.map((f) => <option key={f.id} value={f.id}>{f.name}{f.isDefault ? ' (padrão)' : ''}</option>)}
        </Select>
        <Select label="Etapa (opcional)" value={stageKey} onChange={(e) => setStageKey((e.target as HTMLSelectElement).value)} hint="Vazio usa a primeira etapa do funil">
          <option value="">Primeira etapa do funil</option>
          {funnel?.stages.filter((s) => s.active).map((s) => (
            <option key={s.key} value={s.key}>{s.name}</option>
          ))}
        </Select>
      </div>
    </Modal>
  )
}

const ROLE_LABEL: Record<KanbanRole, string> = {
  ADMIN: 'Administrador',
  MANAGER: 'Gerente',
  AGENT: 'Agente',
  VIEWER: 'Visualizador',
}
const ROLES: KanbanRole[] = ['ADMIN', 'MANAGER', 'AGENT', 'VIEWER']

function KanbanPermissionsModal({ onClose }: { onClose: () => void }) {
  const { data, isLoading } = useKanbanPermissions()
  const save = useSaveKanbanPermissions()
  const [draft, setDraft] = useState<Record<KanbanRole, { canAdvance: boolean; canRetreat: boolean }>>({
    ADMIN: { canAdvance: true, canRetreat: true },
    MANAGER: { canAdvance: true, canRetreat: false },
    AGENT: { canAdvance: true, canRetreat: false },
    VIEWER: { canAdvance: false, canRetreat: false },
  })

  useEffect(() => {
    if (!data?.permissions) return
    setDraft((prev) => {
      const next = { ...prev }
      for (const p of data.permissions) {
        next[p.role] = { canAdvance: p.canAdvance, canRetreat: p.canRetreat }
      }
      return next
    })
  }, [data])

  function toggle(role: KanbanRole, key: 'canAdvance' | 'canRetreat') {
    setDraft((d) => ({ ...d, [role]: { ...d[role], [key]: !d[role][key] } }))
  }

  function handleSave() {
    const payload: KanbanPermissionRow[] = ROLES.map((role) => ({ role, ...draft[role] }))
    save.mutate(payload, {
      onSuccess: () => { toast('Permissões salvas', 'success'); onClose() },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Permissões do Kanban"
      description="Configure quem pode mover leads entre etapas no Kanban."
      size="md"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={save.isPending}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleSave} disabled={save.isPending || isLoading}>
            {save.isPending ? 'Salvando…' : 'Salvar permissões'}
          </Button>
        </>
      }
    >
      {isLoading ? (
        <div class="space-y-2">
          {ROLES.map((r) => <Skeleton key={r} class="h-16" />)}
        </div>
      ) : (
        <div class="space-y-3">
          {ROLES.map((role) => (
            <div key={role} class="rounded-md border border-border bg-surface-2 p-3">
              <div class="text-sm font-medium text-fg mb-2">{ROLE_LABEL[role]}</div>
              <div class="flex flex-wrap gap-4">
                <label class="inline-flex items-center gap-2 text-sm text-fg-muted cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft[role].canAdvance}
                    onChange={() => toggle(role, 'canAdvance')}
                    class="size-4 rounded accent-accent cursor-pointer"
                  />
                  Pode avançar
                </label>
                <label class="inline-flex items-center gap-2 text-sm text-fg-muted cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft[role].canRetreat}
                    onChange={() => toggle(role, 'canRetreat')}
                    class="size-4 rounded accent-accent cursor-pointer"
                  />
                  Pode retroceder
                </label>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}

function HowItWorksModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Como funciona o Kanban?"
      size="lg"
      footer={<Button variant="secondary" size="sm" onClick={onClose}>Fechar</Button>}
    >
      <div class="space-y-4 text-sm">
        <div class="rounded-lg p-4 bg-accent/10 border border-accent/30">
          <div class="font-semibold text-fg mb-1">O problema que ele resolve</div>
          <div class="text-xs text-fg-muted leading-relaxed">
            Lista de leads é boa pra ver detalhes, mas péssima pra entender <strong>"onde cada um está no
            processo de venda"</strong>. O Kanban transforma o funil em um quadro visual: cada coluna é uma
            etapa, cada cartão é um lead. Bate o olho e você sabe quem está negociando, quem precisa de
            follow-up e quem está prestes a fechar.
          </div>
        </div>

        <div class="space-y-3">
          <Step n={1} title="📂 Escolha o funil">
            Cada funil tem suas próprias etapas (ex: Novo, Qualificado, Proposta, Fechado). Selecione o funil
            que você quer visualizar. Times diferentes podem trabalhar em funis diferentes.
          </Step>
          <Step n={2} title="👀 Veja todos os leads como cartões">
            Cada coluna é uma etapa. Cada cartão mostra nome do lead, valor, tags, tempo na etapa, último
            contato. Use <strong>Compacto</strong> pra ver mais leads de uma vez ou <strong>Confortável</strong>{' '}
            pra mais detalhes.
          </Step>
          <Step n={3} title="🖱️ Arraste para mover de etapa">
            Pegou contato? Arrasta pra "Qualificado". Mandou proposta? Arrasta pra "Proposta". A movimentação
            fica registrada no histórico do lead e pode disparar fluxos automáticos (ex: "Ao chegar em Proposta,
            mande e-mail X").
          </Step>
          <Step n={4} title="🔍 Buscar, ordenar e filtrar">
            Use a barra de busca pra encontrar um lead específico. A ordenação muda como os cartões aparecem
            dentro da coluna (mais recente, valor, tempo parado, etc).
          </Step>
          <Step n={5} title="🏆 Marque Ganho ou Perdido">
            Quando o lead fecha (ou desiste), clique nos atalhos do cartão pra marcar como <strong>Ganho</strong>{' '}
            (registra valor da venda) ou <strong>Perdido</strong> (registra motivo). Esses dados alimentam os
            relatórios e a conversão de funil.
          </Step>
        </div>

        <div class="rounded-lg p-4 bg-info/10 border border-info/30">
          <div class="font-semibold text-fg mb-1">⚡ Atalhos úteis</div>
          <ul class="text-xs text-fg-muted leading-relaxed space-y-1 list-disc list-inside">
            <li><strong>Auto-refresh</strong>: o quadro atualiza sozinho a cada 30s</li>
            <li><strong>Permissões</strong>: admins controlam quem vê/edita o Kanban por etapa</li>
            <li><strong>Lista</strong>: alterne pra visualização tabular se preferir ver os leads em linha</li>
            <li><strong>Configure as etapas</strong> em CRM › Funis (cada funil tem seu conjunto de etapas)</li>
          </ul>
        </div>
      </div>
    </Modal>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: preact.ComponentChildren }) {
  return (
    <div class="flex gap-3">
      <div class="shrink-0 size-9 rounded-full bg-accent text-fg-on-brand grid place-items-center text-sm font-bold">
        {n}
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-sm font-semibold text-fg mb-0.5">{title}</div>
        <div class="text-xs text-fg-muted leading-relaxed">{children}</div>
      </div>
    </div>
  )
}
