import type { ComponentChildren } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import {
  MessageSquare,
  Send,
  Inbox,
  CheckCircle,
  Hand,
  X as XIcon,
  Phone,
  Mail,
  Paperclip,
  Mic,
  FileText,
  Loader2,
  Info,
  Trash2,
  ArrowRightLeft,
  UserMinus,
  Bell,
  BellOff,
  Building2,
  MapPin,
  Pencil,
  Plus,
  Target,
  PlayCircle,
  History,
  StickyNote,
  User as UserIcon,
  Star,
  CheckSquare,
  Square,
  Search,
  Reply,
  Clock,
  AlarmClockOff,
  HelpCircle,
  Cloud,
  Smartphone,
  MessageCircle,
  ChevronDown,
  Check,
  Users,
} from 'lucide-preact'
import { HowItWorksModal } from '@/components/ui/HowItWorksModal'
import {
  useTickets,
  useTicketMessages,
  useSendMessage,
  useSenderChannels,
  type SenderChannel,
  useMarkAsRead,
  useClaimTicket,
  useReleaseTicket,
  useDeleteTicket,
  useAssignTicket,
  useSnoozeTicket,
  useUnsnoozeTicket,
  useTicketInfo,
  useTypingState,
  useUploadChatMedia,
  useSenderNumbers,
  inferMediaType,
  type Bucket,
  type Scope,
  type Ticket,
  type ChatMessage,
  type TicketLeadInfo,
} from '@/hooks/useChat'
import { useTeams, useTeamMembers } from '@/hooks/useTeams'
import {
  useUpdateLeadContact,
  useUnqualifyLead,
  useOpenConversation,
  useCloseConversation,
  useLeadTransferHistory,
  useAddLeadTags,
  useRemoveLeadTag,
} from '@/hooks/useLeads'
import { PromoteLeadDialog } from '@/components/PromoteLeadDialog'
import { useTags } from '@/hooks/useTags'
import { useFunnels } from '@/hooks/useFunnels'
import { useTemplates, type MessageTemplateItem } from '@/hooks/useTemplates'
import { api } from '@/lib/apiClient'
import { useUserStore } from '@/stores/user'
import { AudioRecorder } from '@/components/AudioRecorder'
import { EmojiPicker } from '@/components/EmojiPicker'
import { ScoreByPillar } from '@/components/ScoreByPillar'
import { Page } from '@/components/ui/Page'
import { SearchInput } from '@/components/ui/SearchInput'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { cn } from '@/lib/cn'
import { formatRelative } from '@/lib/format'
import { toast } from '@/lib/toast'
import { leadSourceLabel } from '@/lib/leadSourceLabels'

const bucketMeta: { id: Bucket; label: string; shortLabel: string; counterKey: keyof TicketCountersShape; Icon: typeof MessageSquare }[] = [
  { id: 'inbox', label: 'Atendimento', shortLabel: 'Atend.', counterKey: 'inbox', Icon: MessageSquare },
  { id: 'raw', label: 'Caixa', shortLabel: 'Caixa', counterKey: 'raw', Icon: Inbox },
  { id: 'snoozed', label: 'Aguardando', shortLabel: 'Aguard.', counterKey: 'snoozed', Icon: Clock },
  { id: 'resolved', label: 'Resolvidos', shortLabel: 'Resolv.', counterKey: 'resolved', Icon: CheckCircle },
]

const scopeMeta: { id: Scope; label: string; shortLabel: string; counterKey: keyof TicketCountersShape | null }[] = [
  { id: 'mine', label: 'Meus', shortLabel: 'Meus', counterKey: 'mine' },
  { id: 'team', label: 'Setor', shortLabel: 'Setor', counterKey: 'teamQueue' },
  { id: 'all', label: 'Todos', shortLabel: 'Todos', counterKey: null },
]

interface TicketCountersShape {
  inbox: number
  raw: number
  resolved: number
  snoozed: number
  mine: number
  teamQueue: number
  waiting: number
  attending: number
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
    case 'meta_lead_ads':
      return (
        <svg {...common} fill="#1877F2" aria-label={title}>
          <title>{title}</title>
          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
        </svg>
      )
    case 'web_chat':
      return (
        <svg {...common} fill="#1a73e8" aria-label={title}>
          <title>{title}</title>
          <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z" />
        </svg>
      )
    case 'web_form':
      return (
        <svg {...common} fill="#7c4dff" aria-label={title}>
          <title>{title}</title>
          <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zM6 20V4h7v5h5v11H6zm2-6h8v2H8v-2zm0-3h8v2H8v-2z" />
        </svg>
      )
    case 'scheduling':
      return (
        <svg {...common} fill="#0ea5e9" aria-label={title}>
          <title>{title}</title>
          <path d="M19 3h-1V1h-2v2H8V1H6v2H5a2 2 0 00-2 2v16a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2zm0 18H5V9h14v12zm0-14H5V5h14v2zM7 11h5v5H7v-5z" />
        </svg>
      )
    case 'enrollment_portal':
      return (
        <svg {...common} fill="#0d9488" aria-label={title}>
          <title>{title}</title>
          <path d="M12 3L1 9l11 6 9-4.91V17h2V9L12 3zm-6.82 9.97L12 16.72l6.82-3.75L20 13.61v3.5c-2.08 1.78-4.93 2.89-8 2.89s-5.92-1.11-8-2.89v-3.5l1.18-.64z" />
        </svg>
      )
    case 'manual':
      return (
        <svg {...common} fill="currentColor" class="text-fg-subtle" aria-label={title}>
          <title>{title}</title>
          <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
        </svg>
      )
    case 'api':
      return (
        <svg {...common} fill="#ff6d00" aria-label={title}>
          <title>{title}</title>
          <path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z" />
        </svg>
      )
    default:
      return null
  }
}

function loadNotifEnabled(): boolean {
  try { return localStorage.getItem('bh_atd_notif') !== '0' } catch { return true }
}

function playTone(tones: number[]) {
  try {
    const Ctx = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
    if (!Ctx) return
    const ctx = new Ctx()
    tones.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.value = 0.06
      osc.connect(gain).connect(ctx.destination)
      osc.start(ctx.currentTime + i * 0.12)
      osc.stop(ctx.currentTime + i * 0.12 + 0.1)
    })
    setTimeout(() => { void ctx.close() }, 1000)
  } catch { /* ignore */ }
}
function playBeep() { playTone([880, 660]) } // notificação de mensagem nova
function playToggleOn() { playTone([523, 659, 784]) } // C–E–G ascendente
function playToggleOff() { playTone([784, 523]) } // descendente

function formatSnoozeLabel(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  if (sameDay) return `hoje às ${time}`
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1)
  if (d.toDateString() === tomorrow.toDateString()) return `amanhã às ${time}`
  return `${d.toLocaleDateString('pt-BR')} às ${time}`
}

function operatorPresence(lastSeenAt: string | null | undefined): { label: string; color: string } | null {
  if (!lastSeenAt) return null
  const ms = Date.now() - new Date(lastSeenAt).getTime()
  if (Number.isNaN(ms)) return null
  if (ms < 5 * 60_000) return { label: 'Online', color: 'var(--color-success)' }
  if (ms < 30 * 60_000) return { label: 'Ausente', color: 'var(--color-warning)' }
  return { label: 'Offline', color: 'var(--color-fg-subtle)' }
}

export function ConversationsPage() {
  const [bucket, setBucket] = useState<Bucket>('inbox')
  const [scope, setScope] = useState<Scope>('mine')
  const [search, setSearch] = useState('')
  // Filtros extras: número de envio (id do canal) e funil ('' = todos, 'none' = sem funil).
  const [senderChannel, setSenderChannel] = useState('')
  const [funnelFilter, setFunnelFilter] = useState('')
  // Tipo de conversa: '' = contatos e grupos juntos, 'contacts', 'groups'.
  const [kindFilter, setKindFilter] = useState('')
  const numbersQ = useSenderNumbers()
  const funnelsQ = useFunnels()
  const [selected, setSelected] = useState<number | null>(null)
  const [showInfo, setShowInfo] = useState(false)
  const [notifEnabled, setNotifEnabled] = useState<boolean>(loadNotifEnabled())
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [promoteSingle, setPromoteSingle] = useState<{ id: number; name?: string | null | undefined } | null>(null)
  const [promoteBulkOpen, setPromoteBulkOpen] = useState(false)
  const [showHowItWorks, setShowHowItWorks] = useState(false)
  const ticketsQ = useTickets({
    bucket, scope,
    search: search || undefined,
    senderChannel: senderChannel || undefined,
    funnelId: funnelFilter || undefined,
    kind: kindFilter || undefined,
  })

  // Auto-seleciona lead via ?leadId=X (vindo do kebab "WhatsApp" / "Abrir conversa"
  // em LeadsPage / LeadDetailPage). Passa por todos os buckets/scopes pra achar o
  // ticket; quando achado, marca como selected. Roda só uma vez (por leadId vindo
  // na URL); se o operador trocar de seleção depois, não voltamos a forçar.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const leadIdRaw = params.get('leadId')
    if (!leadIdRaw) return
    const leadId = parseInt(leadIdRaw)
    if (!Number.isFinite(leadId)) return
    setSelected(leadId)
    // Limpa o param da URL pra não re-selecionar em re-render / navegação interna
    params.delete('leadId')
    const newSearch = params.toString()
    const newUrl = window.location.pathname + (newSearch ? `?${newSearch}` : '') + window.location.hash
    window.history.replaceState({}, '', newUrl)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Limpa seleção ao trocar de bucket/scope (seleção é por aba)
  useEffect(() => {
    setSelectedIds(new Set())
  }, [bucket, scope])

  // Seleção só faz sentido na "Caixa de entrada" (raw) — leads que ainda não viraram Lead.
  const selectionEnabled = bucket === 'raw'
  const tickets = ticketsQ.data?.tickets ?? []
  const promotableTickets = tickets.filter((t) => !t.qualifiedAt)
  const allSelected = selectionEnabled && promotableTickets.length > 0 && promotableTickets.every((t) => selectedIds.has(t.id))

  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function toggleSelectAll() {
    setSelectedIds((prev) => {
      if (allSelected) return new Set()
      const next = new Set(prev)
      promotableTickets.forEach((t) => next.add(t.id))
      return next
    })
  }
  function clearSelection() { setSelectedIds(new Set()) }

  // Detect new tickets in inbox → ring + flash title
  const lastInboxCountRef = useRef<number | null>(null)
  const titleAlertRef = useRef<{ original: string; interval: number | null } | null>(null)

  useEffect(() => {
    const count = (ticketsQ.data?.tickets ?? []).length
    const prev = lastInboxCountRef.current
    if (prev !== null && count > prev && notifEnabled && document.hidden) {
      playBeep()
      // Title alert: alterna entre original e "(N) Nova mensagem!"
      const original = document.title
      if (!titleAlertRef.current) {
        titleAlertRef.current = { original, interval: null }
        const newCount = count - prev
        let toggle = false
        const interval = window.setInterval(() => {
          document.title = toggle ? original : `(${newCount}) Nova mensagem!`
          toggle = !toggle
        }, 1000)
        titleAlertRef.current.interval = interval
      }
    }
    lastInboxCountRef.current = count
  }, [ticketsQ.data, bucket, notifEnabled])

  // Reset title quando aba ganha foco
  useEffect(() => {
    function onFocus() {
      const ref = titleAlertRef.current
      if (ref?.interval) {
        clearInterval(ref.interval)
        document.title = ref.original
        titleAlertRef.current = null
      }
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', () => { if (!document.hidden) onFocus() })
    return () => {
      window.removeEventListener('focus', onFocus)
      const ref = titleAlertRef.current
      if (ref?.interval) clearInterval(ref.interval)
    }
  }, [])

  function toggleNotif() {
    setNotifEnabled((v) => {
      const next = !v
      try { localStorage.setItem('bh_atd_notif', next ? '1' : '0') } catch { /* ignore */ }
      // Feedback sonoro: confirma o toggle e ainda valida que o áudio do navegador
      // está autorizado (gesture-required policy aplica).
      if (next) playToggleOn(); else playToggleOff()
      return next
    })
  }

  // Esc fecha a conversa selecionada (mas não interfere se modal/dropdown nativo
  // estiver aberto — esses elementos chamam preventDefault).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (e.defaultPrevented) return
      const tgt = e.target as HTMLElement | null
      // Não interfere quando o usuário está digitando em campo de texto.
      if (tgt && (tgt.tagName === 'TEXTAREA' || tgt.tagName === 'INPUT' || tgt.isContentEditable)) return
      if (selected !== null) {
        setSelected(null)
        setShowInfo(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected])

  const counters = ticketsQ.data?.counters

  return (
    <Page
      title="Conversas"
      description="Atendimento ao vivo de leads via WhatsApp."
      actions={
        <Button variant="ghost" size="sm" onClick={() => setShowHowItWorks(true)}>
          <HelpCircle size={14} /> Como funciona?
        </Button>
      }
    >
      <div class="flex gap-3 h-[calc(100dvh-12rem)] min-h-[36rem]">
        {/* Lista de tickets */}
        <aside class={cn('w-full sm:w-80 lg:w-96 xl:w-[26rem] shrink-0 flex flex-col rounded-lg border border-border bg-surface-2', selected !== null && 'hidden sm:flex')}>
          <div class="p-3 space-y-2 border-b border-border">
            <div class="flex items-center gap-2">
              <div class="flex-1 min-w-0">
                <SearchInput value={search} onChange={setSearch} placeholder="Buscar por nome, empresa, telefone…" />
              </div>
              <button
                type="button"
                onClick={toggleNotif}
                class="size-9 shrink-0 rounded-md border border-border text-fg-muted hover:text-fg hover:bg-surface-3 grid place-items-center"
                title={notifEnabled ? 'Som de notificação ativo (clique para silenciar)' : 'Notificação silenciada (clique para ativar)'}
                aria-label={notifEnabled ? 'Silenciar notificações' : 'Ativar notificações'}
              >
                {notifEnabled ? <Bell size={16} /> : <BellOff size={16} />}
              </button>
            </div>
            <div class="flex gap-2 flex-wrap">
              <div class="flex-1 min-w-0">
                <Select
                  value={senderChannel}
                  onChange={(e) => setSenderChannel((e.target as HTMLSelectElement).value)}
                  aria-label="Filtrar por número de envio"
                >
                  <option value="">Todos os números</option>
                  {(numbersQ.data?.channels ?? [])
                    .filter((c) => c.provider === 'evolution' || c.provider === 'cloud_api')
                    .map((c) => <option key={c.id} value={c.id}>{c.number || c.label}</option>)}
                </Select>
              </div>
              <div class="flex-1 min-w-0">
                <Select
                  value={funnelFilter}
                  onChange={(e) => setFunnelFilter((e.target as HTMLSelectElement).value)}
                  aria-label="Filtrar por funil"
                >
                  <option value="">Todos os funis</option>
                  <option value="none">Sem funil</option>
                  {(funnelsQ.data?.funnels ?? []).map((f) => <option key={f.id} value={String(f.id)}>{f.name}</option>)}
                </Select>
              </div>
              {/* Tipo de conversa: só aparece se esta instalação recebe grupos
                  (toggle da conexão OFF por padrão) — filtro inútil não polui a
                  caixa de quem só atende contato individual. */}
              {(counters?.groups ?? 0) > 0 && (
                <div class="flex-1 min-w-0 basis-full">
                  <Select
                    value={kindFilter}
                    onChange={(e) => setKindFilter((e.target as HTMLSelectElement).value)}
                    aria-label="Filtrar contatos ou grupos"
                  >
                    <option value="">Contatos e grupos</option>
                    <option value="contacts">Só contatos</option>
                    <option value="groups">Só grupos ({counters?.groups})</option>
                  </Select>
                </div>
              )}
            </div>
            <nav class="flex gap-1 p-0.5 rounded-md bg-surface-3" aria-label="Escopo">
              {scopeMeta.map((s) => {
                const count = s.counterKey && counters ? counters[s.counterKey] : null
                const active = scope === s.id
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setScope(s.id)}
                    class={cn(
                      'flex-1 min-w-0 h-7 px-2 rounded text-[0.6875rem] font-medium transition-colors inline-flex items-center justify-center gap-1',
                      active ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg',
                    )}
                  >
                    <span class="truncate">{s.label}</span>
                    {count != null && count > 0 && (
                      <span class={cn(
                        'text-[0.625rem] px-1 rounded shrink-0',
                        active ? 'bg-accent/15 text-accent' : 'bg-surface-2 text-fg-muted',
                      )}>{count}</span>
                    )}
                  </button>
                )
              })}
            </nav>
            <nav class="grid grid-cols-4 gap-1" aria-label="Tipo">
              {bucketMeta.map((b) => {
                const count = counters ? counters[b.counterKey] : null
                const active = bucket === b.id
                const Icon = b.Icon
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setBucket(b.id)}
                    title={b.label}
                    class={cn(
                      'min-w-0 h-9 px-1.5 rounded-md text-[0.6875rem] font-medium transition-colors',
                      'inline-flex flex-col items-center justify-center gap-0.5',
                      'lg:flex-row lg:gap-1.5 lg:h-8',
                      active
                        ? 'bg-accent text-fg-on-brand'
                        : 'bg-surface-3 text-fg-muted hover:bg-surface hover:text-fg',
                    )}
                  >
                    <span class="inline-flex items-center gap-1 min-w-0">
                      <Icon size={12} class="shrink-0" />
                      <span class="truncate hidden lg:inline">{b.label}</span>
                      <span class="truncate lg:hidden">{b.shortLabel}</span>
                    </span>
                    {count != null && count > 0 && (
                      <span class={cn(
                        'text-[0.625rem] px-1 rounded shrink-0 leading-none py-px',
                        active ? 'bg-white/25 text-fg-on-brand' : 'bg-surface-2 text-fg-muted',
                      )}>{count}</span>
                    )}
                  </button>
                )
              })}
            </nav>
          </div>
          {selectionEnabled && promotableTickets.length > 0 && (
            <div class="px-3 py-1.5 border-b border-border flex items-center gap-2 text-[0.6875rem]">
              <button
                type="button"
                onClick={toggleSelectAll}
                class="inline-flex items-center gap-1 text-fg-muted hover:text-fg"
                title={allSelected ? 'Desmarcar todas' : 'Selecionar todas (não qualificadas)'}
              >
                {allSelected ? <CheckSquare size={13} class="text-accent" /> : <Square size={13} />}
                <span>{allSelected ? 'Desmarcar todas' : 'Selecionar todas'}</span>
              </button>
              <span class="text-fg-subtle">·</span>
              <span class="text-fg-muted">{promotableTickets.length} não qualificada{promotableTickets.length > 1 ? 's' : ''}</span>
            </div>
          )}
          {selectedIds.size > 0 && (
            <div class="px-3 py-2 border-b border-border bg-accent/5 flex items-center gap-2">
              <span class="text-xs text-fg flex-1">
                <strong>{selectedIds.size}</strong> selecionada{selectedIds.size > 1 ? 's' : ''}
              </span>
              <button
                type="button"
                onClick={clearSelection}
                class="text-[0.6875rem] text-fg-muted hover:text-fg"
              >
                Limpar
              </button>
              <button
                type="button"
                onClick={() => setPromoteBulkOpen(true)}
                class="inline-flex items-center gap-1 px-2 py-1 rounded bg-success text-white text-[0.6875rem] hover:opacity-90"
              >
                <Star size={11} /> Promover {selectedIds.size}
              </button>
            </div>
          )}
          <div class="flex-1 overflow-y-auto">
            {ticketsQ.isLoading && (
              <div class="p-3 flex flex-col gap-2">
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} class="h-14 w-full" />)}
              </div>
            )}
            {!ticketsQ.isLoading && ticketsQ.data?.tickets.length === 0 && (
              <EmptyState
                icon={<MessageSquare size={20} />}
                title="Nenhuma conversa encontrada"
                description={
                  bucket === 'inbox'
                    ? 'Sem conversas em atendimento.'
                    : bucket === 'raw'
                      ? 'Caixa vazia — nenhum lead aguardando ser assumido.'
                      : bucket === 'snoozed'
                        ? 'Nenhum lead aguardando — sem conversas adormecidas ou pendentes de primeiro contato.'
                        : 'Nenhuma conversa resolvida.'
                }
              />
            )}
            {!ticketsQ.isLoading && ticketsQ.data && ticketsQ.data.tickets.length > 0 && (
              <ul>
                {/* Grupo não vira lead: fica fora da promoção individual e da seleção em massa. */}
                {ticketsQ.data.tickets.map((t) => (
                  <TicketRow
                    key={t.id}
                    ticket={t}
                    active={selected === t.id}
                    onClick={() => setSelected(t.id)}
                    selectable={selectionEnabled && !t.qualifiedAt && !t.isGroup}
                    selected={selectedIds.has(t.id)}
                    onToggleSelect={() => toggleSelect(t.id)}
                    onPromote={!t.qualifiedAt && !t.isGroup ? () => setPromoteSingle({ id: t.id, name: t.nome ?? undefined }) : undefined}
                  />
                ))}
              </ul>
            )}
          </div>
        </aside>

        <PromoteLeadDialog
          open={!!promoteSingle}
          mode={promoteSingle ? { kind: 'single', leadId: promoteSingle.id, leadName: promoteSingle.name } : null}
          onOpenChange={(o) => { if (!o) setPromoteSingle(null) }}
        />
        <PromoteLeadDialog
          open={promoteBulkOpen}
          mode={promoteBulkOpen ? { kind: 'bulk', leadIds: Array.from(selectedIds) } : null}
          onOpenChange={(o) => { if (!o) setPromoteBulkOpen(false) }}
          onDone={() => clearSelection()}
        />

        {/* Painel de chat */}
        <section class={cn('flex-1 flex flex-col rounded-lg border border-border bg-surface-2 min-w-0', selected === null && 'hidden sm:flex')}>
          {selected === null ? (
            <div class="flex-1 grid place-items-center text-center p-6">
              <div>
                <MessageSquare size={48} class="text-fg-subtle mx-auto mb-3" />
                <p class="text-base font-medium text-fg">Atendimento</p>
                <p class="text-sm text-fg-muted">Selecione uma conversa para iniciar</p>
              </div>
            </div>
          ) : (
            <ChatPanel
              leadId={selected}
              bucket={bucket}
              onClose={() => setSelected(null)}
              showInfo={showInfo}
              onToggleInfo={() => setShowInfo((v) => !v)}
            />
          )}
        </section>

        {/* Painel info do lead (toggleable) */}
        {selected !== null && showInfo && (
          <aside class="hidden lg:flex w-80 shrink-0 flex-col rounded-lg border border-border bg-surface-2">
            <InfoPanel leadId={selected} onClose={() => setShowInfo(false)} />
          </aside>
        )}
      </div>

      <HowItWorksModal
        open={showHowItWorks}
        onClose={() => setShowHowItWorks(false)}
        title="Como funcionam as Conversas?"
        problem={<>
          É aqui que você <strong>atende as pessoas em tempo real</strong> no WhatsApp (e nos outros
          canais). A tela organiza tickets em caixas (Caixa, Atendimento, Aguardando, Resolvidos), com
          claim/release, ações em lote, painel de informações do lead e atalhos de produtividade.
        </>}
        steps={[
          {
            title: '📥 As 4 caixas (abas)',
            body: <><strong>Caixa</strong>: conversas sem dono — pegue uma e atenda. <strong>Atendimento</strong>: as suas, em curso. <strong>Aguardando</strong>: você respondeu e está esperando o cliente. <strong>Resolvidos</strong>: fechadas.</>,
          },
          {
            title: '👤 Pegar (claim) ou transferir',
            body: <>Clique em uma conversa da Caixa — vira sua automaticamente. Pra passar pra outro vendedor, use <strong>Transferir</strong>. Pra devolver à Caixa, use <strong>Liberar</strong>.</>,
          },
          {
            title: '💬 Responder',
            body: <>Janela de chat com histórico completo. Suporta texto, imagens, arquivos, áudios, modelos rápidos. Botão <strong>Reply</strong> em uma mensagem antiga marca como resposta. Use o ícone de templates pra inserir mensagens pré-formatadas.</>,
          },
          {
            title: '🎯 Promover para Lead',
            body: <>Algumas conversas são só atendimento (suporte, dúvida) e não viram lead. Se virar oportunidade, clique em <strong>Promover</strong> — entra no funil com a etapa que você escolher.</>,
          },
          {
            title: '📊 Painel lateral do lead',
            body: <>Ative o painel <strong>Info</strong> pra ver: etapa atual, tags, score, atividades pendentes, anotações, histórico. Mexa tudo do lead sem sair da conversa.</>,
          },
        ]}
        tip={{
          tone: 'info',
          title: '💡 Notificações + Snooze',
          body: <>Ative o sino pra tocar quando chegar mensagem. Use <strong>Snooze</strong> pra esconder a conversa até uma hora futura ("trazer de volta amanhã às 9h") — útil quando o cliente pede pra falar depois.</>,
        }}
      />
    </Page>
  )
}

function InstagramLogo({ size = 9 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="shrink-0">
      <rect width="20" height="20" x="2" y="2" rx="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
    </svg>
  )
}

function ChannelTag({ channel, compact = false }: {
  channel: { provider: 'evolution' | 'cloud_api' | 'instagram' | 'messenger'; label: string; number: string | null; name: string | null } | null
  compact?: boolean
}) {
  if (!channel) return null
  const map: Record<string, { Icon: any; cls: string; text: string }> = {
    cloud_api: { Icon: Cloud, cls: 'bg-info/15 text-info', text: 'Cloud' },
    instagram: { Icon: InstagramLogo, cls: 'bg-[#E1306C]/15 text-[#E1306C]', text: 'Instagram' },
    messenger: { Icon: MessageCircle, cls: 'bg-[#0084FF]/15 text-[#0084FF]', text: 'Messenger' },
    evolution: { Icon: Smartphone, cls: 'bg-success/15 text-success', text: 'Evolution' },
  }
  const { Icon, cls, text } = map[channel.provider] || map.evolution
  const num = channel.number || channel.name
  return (
    <span
      class={cn('inline-flex items-center gap-0.5 text-[0.625rem] font-semibold px-1.5 py-px rounded-full', cls)}
      title={`Canal: ${channel.label}${num ? ' · ' + num : ''}`}
    >
      <Icon size={9} />
      {text}{!compact && num ? ` · ${num}` : ''}
    </span>
  )
}

function TicketRow({
  ticket,
  active,
  onClick,
  selectable = false,
  selected = false,
  onToggleSelect,
  onPromote,
}: {
  ticket: Ticket
  active: boolean
  onClick: () => void
  selectable?: boolean | undefined
  selected?: boolean | undefined
  onToggleSelect?: (() => void) | undefined
  onPromote?: (() => void) | undefined
}) {
  const name = ticket.nome ?? ticket.whatsapp ?? 'Sem nome'
  const initials = (name ?? '?').slice(0, 2).toUpperCase()
  const lastBody = ticket.lastMessage?.body ?? ticket.lastMessagePreview ?? ''
  const previewPrefix = ticket.lastMessage?.fromMe ? 'Você: ' : ''
  const preview = lastBody ? previewPrefix + lastBody : 'Sem mensagens'
  const isQualified = !!ticket.qualifiedAt
  const showStar = !isQualified && !!onPromote

  return (
    <li class="group relative">
      <button
        type="button"
        onClick={onClick}
        class={cn(
          'w-full text-left px-3 py-3 border-b border-border hover:bg-surface-3 transition-colors',
          active && 'bg-surface-3',
          selected && 'bg-accent/5',
        )}
      >
        <div class="flex items-start gap-2">
          {selectable && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onToggleSelect?.() }}
              class="mt-1 size-4 grid place-items-center text-fg-muted hover:text-fg shrink-0"
              aria-label={selected ? 'Desmarcar' : 'Marcar'}
              aria-pressed={selected}
            >
              {selected ? <CheckSquare size={14} class="text-accent" /> : <Square size={14} />}
            </button>
          )}
          <div class="size-9 rounded-full bg-surface-3 grid place-items-center text-fg-muted text-xs font-semibold shrink-0 overflow-hidden">
            {ticket.profilePicUrl
              ? <img src={ticket.profilePicUrl} alt="" class="w-full h-full object-cover" />
              : ticket.isGroup
              ? <Users size={16} />
              : initials}
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center justify-between gap-2">
              <span class="text-sm text-fg truncate inline-flex items-center gap-1.5 min-w-0">
                <ChannelIcon source={ticket.source} />
                <span class="truncate">
                  {name}
                  {ticket.empresa ? ` - ${ticket.empresa}` : ''}
                </span>
              </span>
              {ticket.lastMessageAt && (
                <span class="text-[0.625rem] text-fg-subtle whitespace-nowrap shrink-0">{formatRelative(ticket.lastMessageAt)}</span>
              )}
            </div>
            <div class="flex items-center flex-wrap gap-1 mt-0.5">
              <ChannelTag channel={ticket.channel} compact />
              {ticket.isGroup ? (
                // Grupo não é lead nem "conversa" a qualificar: badge próprio,
                // sem os rótulos Lead/Conversa que valem para contato individual.
                <span
                  class="inline-flex items-center gap-0.5 text-[0.625rem] font-semibold px-1.5 py-px rounded-full bg-accent/10 text-accent"
                  title="Grupo de WhatsApp — o chatbot não responde aqui"
                >
                  <Users size={9} /> Grupo
                </span>
              ) : isQualified ? (
                <span
                  class="inline-flex items-center gap-0.5 text-[0.625rem] font-semibold px-1.5 py-px rounded-full bg-success/10 text-success"
                  title="Lead qualificado"
                >
                  <Target size={9} /> Lead
                </span>
              ) : (
                <span
                  class="inline-flex items-center gap-0.5 text-[0.625rem] font-semibold px-1.5 py-px rounded-full bg-surface-3 text-fg-muted"
                  title="Apenas conversa — não conta em métricas"
                >
                  <MessageSquare size={9} /> Conversa
                </span>
              )}
              {ticket.team && (
                <span
                  class="inline-flex items-center text-[0.625rem] font-semibold px-1.5 py-px rounded-full"
                  style={{ background: `${ticket.team.color ?? '#6b7280'}22`, color: ticket.team.color ?? undefined }}
                >
                  {ticket.team.name}
                </span>
              )}
              {ticket.assignedUser ? (
                <span class="inline-flex items-center gap-0.5 text-[0.625rem] text-fg-muted">
                  <UserIcon size={9} />
                  {ticket.assignedUser.name ?? ticket.assignedUser.email}
                </span>
              ) : (
                <span class="text-[0.625rem] italic text-fg-subtle">na fila</span>
              )}
            </div>
            <div class="flex items-center gap-2 mt-0.5">
              <span class="text-xs text-fg-muted truncate flex-1">{preview}</span>
              {ticket.unreadMessages > 0 && (
                <span class="text-[0.625rem] font-semibold px-1.5 py-px rounded-full bg-accent text-fg-on-brand shrink-0">
                  {ticket.unreadMessages}
                </span>
              )}
            </div>
          </div>
        </div>
      </button>
      {showStar && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onPromote?.() }}
          class="absolute right-2 top-2 size-7 rounded-md grid place-items-center bg-surface-2 border border-border text-fg-muted opacity-0 group-hover:opacity-100 hover:bg-success hover:text-white hover:border-success transition-opacity focus:opacity-100"
          title="Promover a Lead"
          aria-label="Promover a Lead"
        >
          <Star size={13} />
        </button>
      )}
    </li>
  )
}

function ChatPanel({
  leadId, bucket, onClose, showInfo, onToggleInfo,
}: {
  leadId: number
  bucket: Bucket
  onClose: () => void
  showInfo: boolean
  onToggleInfo: () => void
}) {
  const { data, isLoading } = useTicketMessages(leadId)
  const { data: ticketsList } = useTickets({ bucket })
  const { data: infoData } = useTicketInfo(leadId)
  const ticket = ticketsList?.tickets.find((t) => t.id === leadId)
  const lead = infoData?.lead
  const currentUserId = useUserStore((s) => s.user?.id)
  const send = useSendMessage(leadId)
  // Canais de envio (multi-canal: Evolution + Cloud API). O operador escolhe por
  // qual número responder; pré-seleciona o canal de ENTRADA do lead. Sem isso o
  // backend resolvia sozinho e caía sempre na Cloud API.
  const { data: senderChannels } = useSenderChannels(leadId)
  const channels = senderChannels?.channels ?? []
  const [channelId, setChannelId] = useState<string | null>(null)
  const upload = useUploadChatMedia()
  const markRead = useMarkAsRead()
  const closeConv = useCloseConversation()
  const openConv = useOpenConversation()
  const claim = useClaimTicket()
  const release = useReleaseTicket()
  const snooze = useSnoozeTicket()
  const unsnooze = useUnsnoozeTicket()
  const typing = useTypingState(leadId)
  const [draft, setDraft] = useState('')
  const [recording, setRecording] = useState(false)
  const [transferOpen, setTransferOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [isInternalNote, setIsInternalNote] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [pendingPreviewUrl, setPendingPreviewUrl] = useState<string | null>(null)
  // Anexo já hospedado (vindo de um template com anexo) — enviado sem re-upload.
  const [pendingTplAttachment, setPendingTplAttachment] = useState<{ mediaType: string; mediaUrl: string; mediaName: string } | null>(null)
  // Autocomplete de atalhos "/": índice destacado + dispensa por Escape.
  const [slashIndex, setSlashIndex] = useState(0)
  const [slashDismissed, setSlashDismissed] = useState(false)
  const [chatSearch, setChatSearch] = useState<string | null>(null)
  const [quotedMsg, setQuotedMsg] = useState<ChatMessage | null>(null)
  const [snoozeMenuOpen, setSnoozeMenuOpen] = useState(false)
  // Menu de troca de número de envio (mantém visível só o número padrão/atual;
  // os demais ficam neste dropdown — evita o rodapé poluído com muitos números).
  const [numMenuOpen, setNumMenuOpen] = useState(false)
  // Modal de promoção pós-Assumir: aberto após claim quando o lead ainda não
  // está qualificado (qualifiedAt == null) — convida o operador a colocar
  // o contato em um funil/etapa. Se já é lead qualificado, modal não aparece.
  const [promoteAfterClaimOpen, setPromoteAfterClaimOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Cleanup preview URL when file changes/unmounts.
  useEffect(() => {
    if (pendingPreviewUrl) {
      const url = pendingPreviewUrl
      return () => { URL.revokeObjectURL(url) }
    }
    return undefined
  }, [pendingPreviewUrl])

  // Reset busca/citação ao trocar de conversa.
  useEffect(() => {
    setChatSearch(null)
    setQuotedMsg(null)
    setChannelId(null)
    setNumMenuOpen(false)
    setPendingTplAttachment(null)
    setSlashDismissed(false)
  }, [leadId])

  // Pré-seleciona o canal sugerido (de entrada do lead) quando os canais chegam.
  useEffect(() => {
    if (channelId) return
    const suggested = senderChannels?.suggestedChannelId
    if (suggested && channels.some((c) => c.id === suggested)) setChannelId(suggested)
  }, [senderChannels])

  // Marcar como lida ao abrir, ao chegar mensagem nova com a aba focada, e ao
  // voltar foco para a aba com ticket já aberto. Cobre cenários:
  // (a) operador abre ticket pela 1ª vez → lê o que estava pendente
  // (b) ticket já aberto, cliente envia msg → contador cai sem ação manual
  // (c) operador volta da aba em background → contador zera ao focar
  const unread = ticket?.unreadMessages ?? 0
  const messageCount = data?.messages.length ?? 0
  useEffect(() => {
    if (unread > 0 && !document.hidden) {
      markRead.mutate(leadId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, unread, messageCount])

  useEffect(() => {
    function onFocus() {
      if ((ticket?.unreadMessages ?? 0) > 0) markRead.mutate(leadId)
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, ticket?.unreadMessages])

  // Scroll para o fim quando mensagens chegarem (incluso quando o painel info
  // está aberto — antes o scroll só ocorria no re-render do painel principal).
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messageCount, showInfo])

  // ── Atalhos "/": templates de WhatsApp com atalho salvo ──
  const tplQ = useTemplates({ channel: 'whatsapp' })
  const shortcutTemplates = (tplQ.data?.templates ?? []).filter((t) => t.shortcut && t.active)
  const slashQuery = (!isInternalNote && draft.startsWith('/') && !/\s/.test(draft)) ? draft.slice(1).toLowerCase() : null
  const slashMatches = (slashQuery !== null && !slashDismissed)
    ? shortcutTemplates.filter((t) => (t.shortcut || '').startsWith(slashQuery)).slice(0, 6)
    : []
  const slashOpen = slashMatches.length > 0

  useEffect(() => { setSlashIndex(0) }, [slashQuery])
  useEffect(() => { if (slashQuery === null) setSlashDismissed(false) }, [slashQuery])

  // Escolhe um atalho: resolve as variáveis (preview) e insere no compositor para
  // o operador revisar; anexo do template fica em espera para enviar sem re-upload.
  async function selectShortcut(tpl: MessageTemplateItem) {
    setSlashDismissed(true)
    let resolved = tpl.body
    try {
      const r = await api.post<{ body: string }>(`/templates/${tpl.id}/preview`, { leadId })
      if (r?.body) resolved = r.body
    } catch { /* usa o body cru se o preview falhar */ }
    setDraft(resolved)
    if (tpl.attachmentUrl) {
      const nm = (tpl.attachmentName || tpl.attachmentUrl).toLowerCase()
      const mt = /\.(png|jpe?g|webp|gif)$/.test(nm) ? 'image'
        : /\.(mp4|mov|3gp|webm)$/.test(nm) ? 'video'
        : /\.(mp3|ogg|opus|m4a|wav|aac)$/.test(nm) ? 'audio'
        : 'document'
      setPendingTplAttachment({ mediaType: mt, mediaUrl: tpl.attachmentUrl, mediaName: tpl.attachmentName || 'arquivo' })
    }
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  function handleSend() {
    const body = draft.trim()
    if (!body && !pendingFile && !pendingTplAttachment) return
    // Citação só faz sentido em msg não interna; backend resolve externalId pra Evolution.
    const quotedId = !isInternalNote && quotedMsg ? quotedMsg.id : undefined
    const sendText = (mediaPayload?: { mediaType: string; mediaUrl: string; mediaName: string }) => {
      send.mutate(
        {
          body: body || undefined,
          isInternal: isInternalNote || undefined,
          quotedMsgId: quotedId,
          channelId: !isInternalNote && channelId ? channelId : undefined,
          ...(mediaPayload ?? {}),
        },
        {
          onSuccess: () => {
            setDraft('')
            setIsInternalNote(false)
            setPendingFile(null)
            setPendingPreviewUrl(null)
            setPendingTplAttachment(null)
            setQuotedMsg(null)
          },
          onError: (e: unknown) => toast((e as Error).message, 'danger'),
        },
      )
    }
    if (pendingTplAttachment) {
      // Anexo de template já hospedado → envia direto (sem novo upload).
      sendText(pendingTplAttachment)
    } else if (pendingFile) {
      const file = pendingFile
      upload.mutate(file, {
        onSuccess: (resp) => sendText({
          mediaType: inferMediaType(resp.mimetype || file.type || ''),
          mediaUrl: resp.url,
          mediaName: resp.filename,
        }),
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    } else {
      sendText()
    }
  }

  function handleEmoji(emoji: string) {
    const ta = textareaRef.current
    if (!ta) {
      setDraft((d) => d + emoji)
      return
    }
    const start = ta.selectionStart ?? draft.length
    const end = ta.selectionEnd ?? draft.length
    const next = draft.slice(0, start) + emoji + draft.slice(end)
    setDraft(next)
    requestAnimationFrame(() => {
      ta.focus()
      const pos = start + emoji.length
      ta.setSelectionRange(pos, pos)
    })
  }

  function handleFileInput(e: Event) {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    setPendingFile(file)
    if (file.type.startsWith('image/')) {
      setPendingPreviewUrl(URL.createObjectURL(file))
    } else {
      setPendingPreviewUrl(null)
    }
  }

  function clearPendingFile() {
    setPendingFile(null)
    setPendingPreviewUrl(null)
  }

  function handleAudio(file: File) {
    setRecording(false)
    // Áudio é envio direto (sem confirmação): faz upload e envia em sequência.
    upload.mutate(file, {
      onSuccess: (resp) => {
        send.mutate(
          {
            mediaType: 'audio',
            mediaUrl: resp.url,
            mediaName: resp.filename,
            channelId: channelId ?? undefined,
          },
          {
            onError: (e: unknown) => toast((e as Error).message, 'danger'),
          },
        )
      },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  // Estado da conversa: priorizar `lead` (useTicketInfo, sempre por leadId) sobre
  // `ticket` (useTickets filtrado por bucket). Após claim, o lead muda de bucket
  // e some de `ticketsList`, mas `lead` continua atualizado — sem isso, o botão
  // "Assumir" reaparece porque ticket vira undefined.
  // Grupo de WhatsApp: muda o cabeçalho (nome do grupo, sem telefone) e tira o
  // que só vale para pessoa. `lead` cobre o caso do ticket fora do bucket atual.
  const isGroupChat = (lead?.isGroup ?? ticket?.isGroup) === true
  const convOpenedAt = lead?.conversationOpenedAt ?? ticket?.conversationOpenedAt ?? null
  const convClosedAt = lead?.conversationClosedAt ?? ticket?.conversationClosedAt ?? null
  const isResolved = !!convClosedAt
  const isRaw = !convOpenedAt && !convClosedAt
  const isAssigned = lead?.assignedUserId != null
  const snoozedUntil = lead?.snoozedUntil ?? ticket?.snoozedUntil ?? null
  const isSnoozed = snoozedUntil ? new Date(snoozedUntil).getTime() > Date.now() : false
  const assignedToMe =
    lead?.assignedUserId != null
    && currentUserId != null
    && Number(lead.assignedUserId) === Number(currentUserId)

  function snoozeUntilDate(date: Date) {
    snooze.mutate({ leadId, until: date.toISOString() }, {
      onSuccess: () => { setSnoozeMenuOpen(false); toast(`Adormecido até ${formatSnoozeLabel(date.toISOString())}`, 'success') },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }
  function snoozeRelative(hours: number) {
    const d = new Date(Date.now() + hours * 3600_000)
    snoozeUntilDate(d)
  }
  function snoozeTomorrowAt9h() {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    d.setHours(9, 0, 0, 0)
    snoozeUntilDate(d)
  }
  function snoozeNextMonday() {
    const d = new Date()
    const daysUntilMonday = (1 + 7 - d.getDay()) % 7 || 7
    d.setDate(d.getDate() + daysUntilMonday)
    d.setHours(9, 0, 0, 0)
    snoozeUntilDate(d)
  }

  return (
    <>
      {/* Header */}
      <header class="flex items-start gap-3 p-3 border-b border-border">
        <button type="button" class="sm:hidden size-8 rounded grid place-items-center text-fg-muted hover:bg-surface-3" onClick={onClose} aria-label="Voltar">
          <XIcon size={16} />
        </button>
        <div class="size-9 rounded-full bg-surface-3 grid place-items-center text-fg-muted text-sm font-semibold shrink-0 overflow-hidden">
          {lead?.profilePicUrl
            ? <img src={lead.profilePicUrl} alt="" class="w-full h-full object-cover" />
            : isGroupChat
            ? <Users size={16} />
            : (ticket?.nome ?? ticket?.empresa ?? '?')[0]?.toUpperCase()}
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium text-fg truncate">{ticket?.nome ?? ticket?.empresa ?? `Lead #${leadId}`}</div>
          {typing && (
            <div class="text-[0.6875rem] text-accent flex items-center gap-1 mt-0.5">
              <span class="inline-flex gap-0.5" aria-hidden>
                <span class="size-1 rounded-full bg-current animate-pulse" style={{ animationDelay: '0ms' }} />
                <span class="size-1 rounded-full bg-current animate-pulse" style={{ animationDelay: '150ms' }} />
                <span class="size-1 rounded-full bg-current animate-pulse" style={{ animationDelay: '300ms' }} />
              </span>
              {typing.kind === 'audio' ? 'gravando áudio…' : 'digitando…'}
            </div>
          )}
          <div class="flex items-center gap-2 mt-0.5 text-xs text-fg-muted flex-wrap">
            {/* Grupo: o "telefone" é o id do JID, não serve para ninguém — troca
                pelo selo de grupo, que também avisa que o bot não atua aqui. */}
            {isGroupChat ? (
              <span class="inline-flex items-center gap-1 text-accent" title="Grupo de WhatsApp — o chatbot não responde aqui">
                <Users size={10} /> Grupo
              </span>
            ) : ticket?.whatsapp ? (
              <span class="inline-flex items-center gap-1"><Phone size={10} />{ticket.whatsapp}</span>
            ) : null}
            {ticket?.channel && <ChannelTag channel={ticket.channel} />}
            {ticket?.empresa && <span class="text-fg-subtle">| {ticket.empresa}</span>}
            {lead?.team && (
              <span class="text-fg-subtle">
                · setor: <span style={{ color: lead.team.color ?? undefined }}>{lead.team.name}</span>
              </span>
            )}
            <span class="text-fg-subtle inline-flex items-center gap-1">
              · {lead?.assignedUser ? (
                <>
                  {(() => {
                    const p = operatorPresence(lead.assignedUser.lastSeenAt)
                    return p ? (
                      <span
                        class="inline-block size-2 rounded-full"
                        style={{ background: p.color }}
                        title={`${lead.assignedUser.name ?? lead.assignedUser.email} · ${p.label}`}
                        aria-label={p.label}
                      />
                    ) : null
                  })()}
                  {lead.assignedUser.name ?? lead.assignedUser.email}
                </>
              ) : 'sem operador'}
            </span>
          </div>
        </div>
        <div class="flex items-center gap-1 flex-wrap justify-end">
          <button
            type="button"
            class={cn(
              'size-8 rounded grid place-items-center text-fg-muted hover:text-fg hover:bg-surface-3 shrink-0',
              chatSearch !== null && 'bg-surface-3 text-fg',
            )}
            onClick={() => {
              setChatSearch((v) => (v === null ? '' : null))
              requestAnimationFrame(() => searchInputRef.current?.focus())
            }}
            aria-label="Buscar nesta conversa"
            title="Buscar nesta conversa (Ctrl+F)"
          >
            <Search size={14} />
          </button>
          <Button
            variant={showInfo ? 'secondary' : 'ghost'}
            size="sm"
            onClick={onToggleInfo}
            title="Painel de informações do lead"
            aria-pressed={showInfo}
          >
            <Info size={12} /> <span class="hidden md:inline">Informações</span><span class="md:hidden">Info</span>
          </Button>
          {isRaw && !isAssigned && (
            <Button
              variant="primary"
              size="sm"
              disabled={claim.isPending}
              onClick={() => claim.mutate(leadId, {
                onSuccess: () => {
                  toast('Lead assumido — atendimento iniciado', 'success')
                  // Contato ainda não é Lead em funil → oferece promoção (funil + etapa).
                  // Já qualificado: não interrompe o operador.
                  const alreadyQualified = !!(lead?.qualifiedAt ?? ticket?.qualifiedAt)
                  if (!alreadyQualified) setPromoteAfterClaimOpen(true)
                },
                onError: (e: unknown) => toast((e as Error).message, 'danger'),
              })}
            >
              <Hand size={12} /> {claim.isPending ? 'Assumindo…' : 'Assumir'}
            </Button>
          )}
          {assignedToMe && !isResolved && !isRaw && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => release.mutate(leadId, {
                onSuccess: () => toast('Lead devolvido à fila', 'success'),
                onError: (e: unknown) => toast((e as Error).message, 'danger'),
              })}
              disabled={release.isPending}
              title="Devolver lead à fila"
              aria-label="Devolver lead à fila"
            >
              <UserMinus size={12} /> <span class="hidden lg:inline">Devolver</span>
            </Button>
          )}
          {!isResolved && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setTransferOpen(true)}
              title="Transferir para operador / equipe"
              aria-label="Transferir lead"
            >
              <ArrowRightLeft size={12} /> <span class="hidden lg:inline">Transferir</span>
            </Button>
          )}
          {!isResolved && !isRaw && !isSnoozed && (
            <div class="relative">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSnoozeMenuOpen((v) => !v)}
                title="Adormecer atendimento (volta automaticamente)"
                aria-label="Adormecer atendimento"
                aria-expanded={snoozeMenuOpen}
              >
                <Clock size={12} /> <span class="hidden lg:inline">Adormecer</span>
              </Button>
              {snoozeMenuOpen && (
                <>
                  <div class="fixed inset-0 z-30" onClick={() => setSnoozeMenuOpen(false)} />
                  <div class="absolute right-0 top-full mt-1 z-40 w-56 rounded-md border border-border bg-surface shadow-lg py-1 text-xs">
                    <button type="button" class="w-full text-left px-3 py-1.5 hover:bg-surface-3 text-fg" onClick={() => snoozeRelative(1)}>Por 1 hora</button>
                    <button type="button" class="w-full text-left px-3 py-1.5 hover:bg-surface-3 text-fg" onClick={() => snoozeRelative(4)}>Por 4 horas</button>
                    <button type="button" class="w-full text-left px-3 py-1.5 hover:bg-surface-3 text-fg" onClick={snoozeTomorrowAt9h}>Amanhã 9h</button>
                    <button type="button" class="w-full text-left px-3 py-1.5 hover:bg-surface-3 text-fg" onClick={snoozeNextMonday}>Próxima segunda 9h</button>
                    <div class="border-t border-border my-1" />
                    <label class="block px-3 py-1.5 text-fg-muted text-[0.6875rem] uppercase tracking-wider">Personalizado</label>
                    <div class="px-3 pb-2">
                      <input
                        type="datetime-local"
                        class="w-full px-2 py-1 rounded border border-border bg-surface-2 text-xs text-fg focus:outline-none focus:border-accent"
                        onChange={(e) => {
                          const v = (e.target as HTMLInputElement).value
                          if (!v) return
                          const d = new Date(v)
                          if (Number.isNaN(d.getTime()) || d.getTime() <= Date.now()) {
                            toast('Data deve ser no futuro', 'warning'); return
                          }
                          snoozeUntilDate(d)
                        }}
                      />
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
          {!isResolved && (
            <Button
              variant="secondary"
              size="sm"
              disabled={closeConv.isPending}
              onClick={() => closeConv.mutate(leadId, {
                onSuccess: () => toast(isRaw ? 'Lead descartado da Caixa' : 'Atendimento encerrado — movido para Resolvidos', 'success'),
                onError: (e: unknown) => toast((e as Error).message, 'danger'),
              })}
              title={isRaw ? 'Descartar lead da Caixa (sem assumir)' : 'Encerrar atendimento'}
            >
              <CheckCircle size={12} /> Resolver
            </Button>
          )}
          {isResolved && (
            <Button
              variant="secondary"
              size="sm"
              disabled={openConv.isPending}
              onClick={() => openConv.mutate(leadId, {
                onSuccess: () => toast('Atendimento reaberto', 'success'),
                onError: (e: unknown) => toast((e as Error).message, 'danger'),
              })}
            >
              <Inbox size={12} /> Reabrir
            </Button>
          )}
          <button
            type="button"
            class="size-8 rounded grid place-items-center text-fg-muted hover:text-danger hover:bg-surface-3 shrink-0"
            onClick={() => setDeleteOpen(true)}
            aria-label="Excluir conversa"
            title="Excluir conversa"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </header>

      {isSnoozed && snoozedUntil && (
        <div class="px-3 py-2 border-b border-border bg-warning/10 text-warning flex items-center gap-2 text-xs">
          <Clock size={12} class="shrink-0" />
          <span class="flex-1">Adormecido até {formatSnoozeLabel(snoozedUntil)} · não aparece em Atendimento até lá.</span>
          <button
            type="button"
            class="px-2 py-0.5 rounded border border-current hover:bg-warning/20 inline-flex items-center gap-1"
            disabled={unsnooze.isPending}
            onClick={() => unsnooze.mutate(leadId, {
              onSuccess: () => toast('Lead acordado', 'success'),
              onError: (e: unknown) => toast((e as Error).message, 'danger'),
            })}
          >
            <AlarmClockOff size={11} /> Acordar
          </button>
        </div>
      )}

      {chatSearch !== null && (
        <div class="px-3 py-2 border-b border-border bg-surface-2 flex items-center gap-2">
          <Search size={12} class="text-fg-subtle shrink-0" />
          <input
            ref={searchInputRef}
            type="text"
            value={chatSearch}
            onInput={(e) => setChatSearch((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setChatSearch(null) } }}
            placeholder="Buscar nesta conversa…"
            class="flex-1 bg-transparent border-0 outline-none text-xs text-fg placeholder:text-fg-subtle"
          />
          <button
            type="button"
            class="size-6 rounded grid place-items-center text-fg-muted hover:text-fg hover:bg-surface-3"
            onClick={() => setChatSearch(null)}
            aria-label="Fechar busca"
            title="Fechar busca (Esc)"
          >
            <XIcon size={12} />
          </button>
        </div>
      )}

      {transferOpen && (
        <TransferModal
          leadId={leadId}
          currentTeamId={lead?.teamId ?? null}
          currentUserId={lead?.assignedUserId ?? null}
          onClose={() => setTransferOpen(false)}
        />
      )}

      {deleteOpen && (
        <DeleteTicketDialog
          leadId={leadId}
          leadName={ticket?.nome ?? ticket?.empresa ?? `Lead #${leadId}`}
          onClose={() => setDeleteOpen(false)}
          onDeleted={() => { setDeleteOpen(false); onClose() }}
        />
      )}

      {/* Mensagens */}
      <div ref={scrollRef} class="flex-1 overflow-y-auto p-4 space-y-2 bg-surface">
        {isLoading && (
          <div class="flex flex-col gap-2">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} class="h-12 w-2/3" />)}
          </div>
        )}
        {!isLoading && data?.messages.length === 0 && (
          <div class="text-center text-xs text-fg-subtle py-8">Nenhuma mensagem ainda. Envie a primeira!</div>
        )}
        {(() => {
          if (isLoading || !data) return null
          const q = chatSearch?.trim().toLowerCase() ?? ''
          const filtered = q
            ? data.messages.filter((m) => (m.body ?? '').toLowerCase().includes(q) || (m.senderName ?? '').toLowerCase().includes(q))
            : data.messages
          if (q && filtered.length === 0) {
            return <div class="text-center text-xs text-fg-subtle py-8">Nenhuma mensagem encontrada para "{chatSearch}".</div>
          }
          // Lookup por id interno (quotedMsgId é FK ao Message.id local).
          const byId = new Map<number, ChatMessage>()
          for (const m of data.messages) byId.set(m.id, m)
          return filtered.map((m, idx) => {
            const prev = idx > 0 ? filtered[idx - 1] : undefined
            const showDivider = !prev || dayKey(m.timestamp) !== dayKey(prev.timestamp)
            const quoted = m.quotedMsgId != null ? byId.get(m.quotedMsgId) ?? null : null
            return (
              <div key={m.id}>
                {showDivider && (
                  <div class="flex items-center justify-center my-2">
                    <span class="text-[0.625rem] uppercase tracking-wider px-2 py-0.5 rounded bg-surface-2 text-fg-subtle border border-border">
                      {formatDayLabel(m.timestamp)}
                    </span>
                  </div>
                )}
                <MessageBubble msg={m} quoted={quoted} highlight={q} onReply={() => setQuotedMsg(m)} />
              </div>
            )
          })
        })()}
      </div>

      {/* Composer */}
      {!isResolved ? (
        <div class="border-t border-border">
          {quotedMsg && (
            <div class="px-3 pt-2">
              <div class="flex items-stretch gap-2 p-2 rounded-md bg-surface-3 border-l-2 border-accent">
                <div class="flex-1 min-w-0">
                  <div class="text-[0.625rem] font-medium text-accent">
                    Respondendo {quotedMsg.fromMe ? 'sua mensagem' : (quotedMsg.senderName ?? 'mensagem')}
                  </div>
                  <div class="text-xs text-fg-muted truncate">
                    {quotedMsg.body || (quotedMsg.mediaType && quotedMsg.mediaType !== 'text' ? `(${quotedMsg.mediaType})` : '(sem texto)')}
                  </div>
                </div>
                <button
                  type="button"
                  class="size-7 shrink-0 rounded grid place-items-center text-fg-muted hover:text-danger hover:bg-surface-2"
                  onClick={() => setQuotedMsg(null)}
                  aria-label="Cancelar citação"
                  title="Cancelar citação"
                >
                  <XIcon size={14} />
                </button>
              </div>
            </div>
          )}
          {pendingFile && (
            <div class="px-3 pt-2">
              <div class="flex items-center gap-2 p-2 rounded-md bg-surface-3 border border-border">
                {pendingPreviewUrl ? (
                  <img src={pendingPreviewUrl} alt="" class="size-10 rounded object-cover shrink-0" />
                ) : (
                  <div class="size-10 rounded bg-surface-2 grid place-items-center text-fg-muted shrink-0">
                    <FileText size={18} />
                  </div>
                )}
                <div class="flex-1 min-w-0">
                  <div class="text-xs text-fg truncate">{pendingFile.name}</div>
                  <div class="text-[0.625rem] text-fg-subtle">{formatFileSize(pendingFile.size)}</div>
                </div>
                <button
                  type="button"
                  class="size-7 shrink-0 rounded grid place-items-center text-fg-muted hover:text-danger hover:bg-surface-2"
                  onClick={clearPendingFile}
                  aria-label="Remover anexo"
                  title="Remover anexo"
                >
                  <XIcon size={14} />
                </button>
              </div>
            </div>
          )}
          {pendingTplAttachment && (
            <div class="px-3 pt-2">
              <div class="flex items-center gap-2 p-2 rounded-md bg-surface-3 border border-border">
                <div class="size-10 rounded bg-surface-2 grid place-items-center text-fg-muted shrink-0">
                  <FileText size={18} />
                </div>
                <div class="flex-1 min-w-0">
                  <div class="text-xs text-fg truncate">{pendingTplAttachment.mediaName}</div>
                  <div class="text-[0.625rem] text-fg-subtle">Anexo do modelo</div>
                </div>
                <button
                  type="button"
                  class="size-7 shrink-0 rounded grid place-items-center text-fg-muted hover:text-danger hover:bg-surface-2"
                  onClick={() => setPendingTplAttachment(null)}
                  aria-label="Remover anexo"
                  title="Remover anexo"
                >
                  <XIcon size={14} />
                </button>
              </div>
            </div>
          )}
          <div class="p-3">
            {!isInternalNote && channels.length >= 2 && (() => {
              // Mantém VISÍVEL apenas o número selecionado (padrão = canal de entrada
              // do lead). Os demais ficam no menu "Trocar" — assim o rodapé não fica
              // poluído quando há muitos números.
              const selected = channels.find((c) => c.id === channelId) ?? null
              const suggestedId = senderChannels?.suggestedChannelId ?? null
              const chanLabel = (c: SenderChannel) => `${c.provider === 'cloud_api' ? 'Cloud API' : 'Evolution'}${(c.number || c.label) ? ` · ${c.number || c.label}` : ''}`
              const SelIcon = selected?.provider === 'cloud_api' ? Cloud : Smartphone
              const selCloud = selected?.provider === 'cloud_api'
              return (
                <div class="mb-2 flex flex-wrap items-center gap-1.5">
                  <span class="text-[0.625rem] font-medium text-fg-subtle">Enviar por:</span>
                  {selected && (
                    <span
                      class={cn(
                        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.6875rem] font-semibold',
                        selCloud ? 'border-info/40 bg-info/15 text-info' : 'border-success/40 bg-success/15 text-success',
                      )}
                      title={`Número atual: ${chanLabel(selected)}`}
                    >
                      <SelIcon size={11} />
                      {chanLabel(selected)}
                      {selected.id === suggestedId && (
                        <span class="ml-0.5 rounded-full bg-black/10 px-1 text-[0.5625rem] font-medium uppercase tracking-wide">padrão</span>
                      )}
                    </span>
                  )}
                  <div class="relative">
                    <button
                      type="button"
                      onClick={() => setNumMenuOpen((v) => !v)}
                      class="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[0.6875rem] font-medium text-fg-muted hover:bg-surface-2 hover:text-fg transition-colors"
                      aria-expanded={numMenuOpen}
                      aria-haspopup="listbox"
                      title="Trocar número de envio"
                    >
                      <ChevronDown size={11} />
                      {selected ? 'Trocar' : 'Escolher número'}
                    </button>
                    {numMenuOpen && (
                      <>
                        <div class="fixed inset-0 z-30" onClick={() => setNumMenuOpen(false)} />
                        <div
                          role="listbox"
                          class="absolute left-0 bottom-full mb-1 z-40 w-64 max-h-64 overflow-auto rounded-md border border-border bg-surface shadow-lg py-1 text-xs"
                        >
                          <div class="px-3 py-1 text-[0.5625rem] uppercase tracking-wider text-fg-subtle">Números disponíveis</div>
                          {channels.map((c) => {
                            const active = c.id === channelId
                            const isCloud = c.provider === 'cloud_api'
                            const Icon = isCloud ? Cloud : Smartphone
                            return (
                              <button
                                type="button"
                                role="option"
                                aria-selected={active}
                                key={c.id}
                                onClick={() => { setChannelId(c.id); setNumMenuOpen(false) }}
                                class={cn(
                                  'w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-3',
                                  active ? 'text-fg font-semibold' : 'text-fg-muted',
                                )}
                              >
                                <Icon size={12} class={isCloud ? 'text-info' : 'text-success'} />
                                <span class="flex-1 truncate">{chanLabel(c)}</span>
                                {c.id === suggestedId && (
                                  <span class="rounded-full bg-surface-3 px-1.5 py-0.5 text-[0.5625rem] uppercase tracking-wide text-fg-subtle">padrão</span>
                                )}
                                {active && <Check size={12} class="text-accent shrink-0" />}
                              </button>
                            )
                          })}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )
            })()}
            {recording ? (
              <AudioRecorder onComplete={handleAudio} onCancel={() => setRecording(false)} />
            ) : (
              <div class="relative flex items-end gap-2">
                {slashOpen && (
                  <div role="listbox" class="absolute left-0 right-0 bottom-full mb-1 z-40 max-h-60 overflow-auto rounded-md border border-border bg-surface shadow-lg py-1 text-xs">
                    <div class="px-3 py-1 text-[0.5625rem] uppercase tracking-wider text-fg-subtle">Atalhos — Enter para inserir</div>
                    {slashMatches.map((t, i) => (
                      <button
                        type="button"
                        role="option"
                        aria-selected={i === slashIndex}
                        key={t.id}
                        onMouseEnter={() => setSlashIndex(i)}
                        onClick={() => void selectShortcut(t)}
                        class={cn(
                          'w-full flex items-center gap-2 px-3 py-1.5 text-left',
                          i === slashIndex ? 'bg-surface-3 text-fg' : 'text-fg-muted hover:bg-surface-3',
                        )}
                      >
                        <span class="font-semibold text-accent shrink-0">/{t.shortcut}</span>
                        <span class="flex-1 min-w-0 truncate">{t.name}</span>
                        {t.attachmentUrl && <Paperclip size={12} class="shrink-0 text-fg-subtle" />}
                      </button>
                    ))}
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  class="hidden"
                  accept="image/*,audio/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip,.rar"
                  onChange={handleFileInput}
                />
                <button
                  type="button"
                  class="size-9 shrink-0 rounded-md text-fg-muted hover:bg-surface-3 hover:text-fg grid place-items-center disabled:opacity-50"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={send.isPending || upload.isPending}
                  aria-label="Anexar arquivo"
                  title="Anexar arquivo"
                >
                  {upload.isPending ? <Loader2 size={16} class="animate-spin" /> : <Paperclip size={16} />}
                </button>
                <EmojiPicker onSelect={handleEmoji} />
                <textarea
                  ref={textareaRef}
                  class={cn(
                    'flex-1 min-h-[2.25rem] max-h-[8rem] px-3 py-2 rounded-md border text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent resize-none',
                    isInternalNote
                      ? 'bg-warning/10 border-warning/40'
                      : 'bg-surface border-border',
                  )}
                  placeholder={isInternalNote ? 'Nota interna (não enviada ao cliente)…' : 'Digite uma mensagem…'}
                  value={draft}
                  onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
                  onKeyDown={(e) => {
                    if (slashOpen) {
                      const n = slashMatches.length
                      if (e.key === 'ArrowDown') { e.preventDefault(); setSlashIndex((i) => (i + 1) % n); return }
                      if (e.key === 'ArrowUp') { e.preventDefault(); setSlashIndex((i) => (i - 1 + n) % n); return }
                      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); void selectShortcut(slashMatches[Math.min(slashIndex, n - 1)]); return }
                      if (e.key === 'Escape') { e.preventDefault(); setSlashDismissed(true); return }
                    }
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleSend()
                    }
                  }}
                  disabled={send.isPending}
                  rows={1}
                />
                <button
                  type="button"
                  class={cn(
                    'size-9 shrink-0 rounded-md grid place-items-center disabled:opacity-50',
                    isInternalNote
                      ? 'bg-warning text-fg-on-brand'
                      : 'text-fg-muted hover:bg-surface-3 hover:text-fg',
                  )}
                  onClick={() => setIsInternalNote((v) => !v)}
                  disabled={send.isPending}
                  aria-label={isInternalNote ? 'Voltar a mensagem normal' : 'Alternar para nota interna'}
                  aria-pressed={isInternalNote}
                  title={isInternalNote ? 'Voltar a mensagem normal' : 'Nota interna (não enviada ao cliente)'}
                >
                  <StickyNote size={16} />
                </button>
                {draft.trim() || pendingFile || pendingTplAttachment ? (
                  <Button
                    variant="primary"
                    size="md"
                    onClick={handleSend}
                    disabled={send.isPending || upload.isPending}
                  >
                    <Send size={14} />
                  </Button>
                ) : (
                  <button
                    type="button"
                    class="size-9 shrink-0 rounded-md text-fg-muted hover:bg-surface-3 hover:text-fg grid place-items-center disabled:opacity-50"
                    onClick={() => setRecording(true)}
                    disabled={send.isPending || upload.isPending}
                    aria-label="Gravar áudio"
                    title="Gravar áudio"
                  >
                    <Mic size={16} />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div class="p-3 border-t border-border text-center text-xs text-fg-muted bg-surface-3">
          Conversa resolvida. Reabra para enviar mensagens.
        </div>
      )}

      <PromoteLeadDialog
        open={promoteAfterClaimOpen}
        mode={{ kind: 'single', leadId, leadName: ticket?.nome ?? lead?.nome ?? null }}
        onOpenChange={setPromoteAfterClaimOpen}
      />
    </>
  )
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

function MediaContent({
  type,
  url,
  name,
}: {
  type: string
  url: string
  name: string | null
}) {
  if (type === 'image') {
    return (
      <a href={url} target="_blank" rel="noreferrer" class="mb-1 block">
        <img src={url} alt={name ?? 'Imagem'} class="max-w-full rounded" />
      </a>
    )
  }
  if (type === 'audio') {
    return (
      <audio controls preload="metadata" src={url} class="mb-1 w-full max-w-[16rem]">
        Áudio
      </audio>
    )
  }
  if (type === 'video') {
    return (
      <video controls preload="metadata" src={url} class="mb-1 w-full max-w-[20rem] rounded">
        Vídeo
      </video>
    )
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      class="mb-1 inline-flex items-center gap-2 rounded-md bg-surface-3 px-2 py-1.5 text-xs text-fg hover:underline"
    >
      <FileText size={14} />
      <span class="max-w-[14rem] truncate">{name ?? 'Anexo'}</span>
    </a>
  )
}

function InfoPanel({ leadId, onClose }: { leadId: number; onClose: () => void }) {
  const { data, isLoading } = useTicketInfo(leadId)
  const unqualify = useUnqualifyLead()
  const openConv = useOpenConversation()
  const closeConv = useCloseConversation()
  const lead = data?.lead

  const [editOpen, setEditOpen] = useState(false)
  const [editFocus, setEditFocus] = useState<'nome' | 'annotation'>('nome')
  const [promoteOpen, setPromoteOpen] = useState(false)

  if (isLoading) {
    return (
      <div class="p-3 space-y-3">
        <Skeleton class="h-20 w-full" />
        <Skeleton class="h-32 w-full" />
        <Skeleton class="h-24 w-full" />
      </div>
    )
  }
  if (!lead) {
    return (
      <div class="p-3 text-xs text-fg-subtle">Sem dados.</div>
    )
  }

  const isQualified = !!lead.qualifiedAt
  const convOpen = !!lead.conversationOpenedAt && !lead.conversationClosedAt
  const convClosed = !!lead.conversationClosedAt
  const convNever = !lead.conversationOpenedAt && !lead.conversationClosedAt
  const scores = (lead.scores as Record<string, number> | null) ?? null

  return (
    <>
      <header class="flex items-center justify-between p-3 border-b border-border">
        <span class="text-sm font-medium text-fg">Informações</span>
        <button
          type="button"
          class="size-7 rounded grid place-items-center text-fg-muted hover:text-fg hover:bg-surface-3"
          onClick={onClose}
          aria-label="Fechar"
        >
          <XIcon size={14} />
        </button>
      </header>

      <div class="flex-1 overflow-y-auto">
        {/* Banner qualificação */}
        <div
          class={cn(
            'flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 px-3 py-2 border-b border-border text-[0.6875rem]',
            isQualified ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning',
          )}
        >
          <span class="inline-flex items-start gap-1.5 min-w-0 flex-1">
            {isQualified ? (
              <><Target size={11} class="shrink-0 mt-px" /> <span class="break-words">Lead qualificado{lead.qualificationSource ? ` · ${lead.qualificationSource}` : ''}</span></>
            ) : (
              <><MessageSquare size={11} class="shrink-0 mt-px" /> <span class="break-words">Apenas conversa — não conta em métricas</span></>
            )}
          </span>
          {isQualified ? (
            <button
              type="button"
              class="shrink-0 px-2 py-0.5 rounded border border-current bg-surface-2 text-[0.6875rem] hover:bg-surface-3"
              disabled={unqualify.isPending}
              onClick={() => {
                unqualify.mutate(leadId, {
                  onSuccess: () => toast('Lead revertido para conversa', 'info'),
                  onError: (e) => toast(e.message, 'danger'),
                })
              }}
            >
              Reverter
            </button>
          ) : (
            <button
              type="button"
              class="shrink-0 px-2 py-0.5 rounded bg-success text-white text-[0.6875rem] hover:opacity-90"
              onClick={() => setPromoteOpen(true)}
            >
              Promover a Lead
            </button>
          )}
        </div>
        <PromoteLeadDialog
          open={promoteOpen}
          mode={{ kind: 'single', leadId, leadName: lead.nome }}
          onOpenChange={setPromoteOpen}
        />

        {/* Banner atendimento */}
        <div
          class={cn(
            'flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 px-3 py-2 border-b border-border text-[0.6875rem]',
            convOpen && 'bg-accent/10 text-accent',
            convClosed && 'bg-surface-3 text-fg-muted',
            convNever && 'bg-surface-3 text-fg-muted',
          )}
        >
          <span class="inline-flex items-start gap-1.5 min-w-0 flex-1">
            {convOpen && <><MessageSquare size={11} class="shrink-0 mt-px" /> <span class="break-words">Atendimento ativo</span></>}
            {convClosed && <><CheckCircle size={11} class="shrink-0 mt-px" /> <span class="break-words">Atendimento encerrado</span></>}
            {convNever && <><Inbox size={11} class="shrink-0 mt-px" /> <span class="break-words">Sem atendimento aberto</span></>}
          </span>
          {convOpen ? (
            <button
              type="button"
              class="shrink-0 px-2 py-0.5 rounded border border-current bg-surface-2 text-[0.6875rem] hover:bg-surface-3"
              disabled={closeConv.isPending}
              onClick={() => {
                closeConv.mutate(leadId, {
                  onSuccess: () => toast('Atendimento encerrado', 'success'),
                  onError: (e) => toast(e.message, 'danger'),
                })
              }}
            >
              Encerrar
            </button>
          ) : (
            <button
              type="button"
              class="shrink-0 px-2 py-0.5 rounded bg-accent text-white text-[0.6875rem] hover:opacity-90 inline-flex items-center gap-1"
              disabled={openConv.isPending}
              onClick={() => {
                openConv.mutate(leadId, {
                  onSuccess: () => toast(convClosed ? 'Atendimento reaberto' : 'Atendimento iniciado', 'success'),
                  onError: (e) => toast(e.message, 'danger'),
                })
              }}
            >
              <PlayCircle size={11} />
              {convClosed ? 'Reabrir' : 'Iniciar'}
            </button>
          )}
        </div>

        <div class="p-3 space-y-4">
          {/* Bloco identidade */}
          <section class="space-y-1.5">
            <div class="flex items-start gap-2">
              <span class="size-9 rounded-full bg-surface-3 grid place-items-center text-fg-muted text-sm font-semibold overflow-hidden shrink-0">
                {lead.profilePicUrl
                  ? <img src={lead.profilePicUrl} alt="" class="w-full h-full object-cover" />
                  : (lead.nome ?? lead.empresa ?? '?')[0]?.toUpperCase()}
              </span>
              <div class="min-w-0 flex-1">
                <div class="text-sm font-medium text-fg truncate">{lead.nome ?? 'Sem nome'}</div>
                {lead.empresa && (
                  <div class="text-xs text-fg-muted truncate inline-flex items-center gap-1">
                    <Building2 size={10} />{lead.empresa}
                  </div>
                )}
              </div>
              <button
                type="button"
                class="px-2 py-1 rounded border border-border text-[0.6875rem] text-fg-muted hover:text-fg hover:bg-surface-3 inline-flex items-center gap-1"
                onClick={() => { setEditFocus('nome'); setEditOpen(true) }}
                aria-label="Editar dados do contato"
                title="Editar dados do contato"
              >
                <Pencil size={10} /> Editar
              </button>
            </div>
          </section>

          {/* Contato */}
          <section>
            <div class="text-[0.6875rem] uppercase tracking-wider text-fg-subtle mb-1">Contato</div>
            <dl class="text-xs space-y-1">
              <InfoRow label="WhatsApp" value={lead.whatsapp} icon={<Phone size={10} />} />
              <InfoRow label="Email" value={lead.email} icon={<Mail size={10} />} />
              <InfoRow label="Segmento" value={lead.segmento} />
              <InfoRow label="Cidade" value={lead.cidade} icon={<MapPin size={10} />} />
            </dl>
          </section>

          {/* Status */}
          <section>
            <div class="text-[0.6875rem] uppercase tracking-wider text-fg-subtle mb-1">Status</div>
            <dl class="text-xs space-y-1">
              <InfoRow label="Status" value={lead.completed ? 'Resolvido' : 'Aberto'} />
              <InfoRow label="Etapa" value={lead.status} />
              <InfoRow label="Maturidade" value={lead.maturidade} />
              <InfoRow label="Solução" value={lead.solucaoNome} />
              <InfoRow
                label="Origem"
                valueNode={
                  lead.source ? (
                    <span class="inline-flex items-center gap-1">
                      <ChannelIcon source={lead.source} />
                      {leadSourceLabel(lead.source)}
                    </span>
                  ) : null
                }
              />
              <InfoRow label="Criado em" value={formatDayLabel(lead.createdAt)} />
            </dl>
          </section>

          {/* Anotação interna */}
          <section>
            <div class="flex items-center justify-between mb-1">
              <div class="text-[0.6875rem] uppercase tracking-wider text-fg-subtle">Anotação interna</div>
              <button
                type="button"
                class="text-[0.6875rem] px-2 py-0.5 rounded border border-accent bg-accent/10 text-accent hover:bg-accent/20"
                onClick={() => { setEditFocus('annotation'); setEditOpen(true) }}
              >
                Editar
              </button>
            </div>
            <div
              class={cn(
                'text-xs whitespace-pre-wrap break-words',
                lead.annotation ? 'text-fg' : 'italic text-fg-subtle',
              )}
            >
              {lead.annotation ?? 'Sem anotações — clique em Editar para adicionar'}
            </div>
          </section>

          {/* Tags */}
          <TagsSection leadId={leadId} tags={lead.tags} />

          {/* Scores por pilar */}
          {scores && (
            <section>
              <div class="text-[0.6875rem] uppercase tracking-wider text-fg-subtle mb-2">Scores</div>
              <ScoreByPillar scores={scores} compact />
            </section>
          )}

          {/* Histórico de atribuições */}
          <TransferHistorySection leadId={leadId} />
        </div>
      </div>

      {editOpen && (
        <EditContactModal
          leadId={leadId}
          lead={lead}
          autoFocus={editFocus}
          onClose={() => setEditOpen(false)}
        />
      )}
    </>
  )
}

function InfoRow({
  label, value, valueNode, icon,
}: {
  label: string
  value?: string | null
  valueNode?: ComponentChildren
  icon?: ComponentChildren
}) {
  const hasValue = valueNode != null || (value != null && value !== '')
  return (
    <div class="flex items-baseline justify-between gap-2">
      <dt class="text-fg-subtle inline-flex items-center gap-1 shrink-0">
        {icon}
        {label}
      </dt>
      <dd class={cn('text-right truncate', hasValue ? 'text-fg' : 'text-fg-subtle')}>
        {valueNode ?? value ?? '-'}
      </dd>
    </div>
  )
}

function TagsSection({ leadId, tags }: { leadId: number; tags: TicketLeadInfo['tags'] }) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const { data: allTagsData } = useTags()
  const addTag = useAddLeadTags()
  const removeTag = useRemoveLeadTag()
  const all = allTagsData?.tags ?? []
  const existingIds = new Set(tags.map((t) => t.tag.id))
  const available = all.filter((t) => !existingIds.has(t.id))

  return (
    <section>
      <div class="flex items-center justify-between mb-1">
        <div class="text-[0.6875rem] uppercase tracking-wider text-fg-subtle">Etiquetas</div>
        {available.length > 0 && (
          <button
            type="button"
            class="text-[0.6875rem] text-accent hover:underline inline-flex items-center gap-1"
            onClick={() => setPickerOpen(true)}
          >
            <Plus size={10} /> Tag
          </button>
        )}
      </div>
      {tags.length === 0 ? (
        <div class="text-xs text-fg-subtle">Sem tags.</div>
      ) : (
        <div class="flex flex-wrap gap-1">
          {tags.map(({ tag }) => (
            <span
              key={tag.id}
              class="text-[0.6875rem] px-1.5 py-0.5 rounded inline-flex items-center gap-1 group"
              style={{ background: `${tag.color ?? '#6b7280'}22`, color: tag.color ?? undefined }}
            >
              {tag.name}
              <button
                type="button"
                class="opacity-0 group-hover:opacity-100 size-3 rounded-full grid place-items-center hover:bg-surface-3"
                onClick={() => {
                  removeTag.mutate({ leadId, tagId: tag.id }, {
                    onError: (e) => toast(e.message, 'danger'),
                  })
                }}
                aria-label={`Remover tag ${tag.name}`}
              >
                <XIcon size={8} />
              </button>
            </span>
          ))}
        </div>
      )}

      {pickerOpen && (
        <Modal
          open
          onOpenChange={(o) => { if (!o) setPickerOpen(false) }}
          title="Adicionar tag"
          size="sm"
        >
          <div class="space-y-1 max-h-72 overflow-y-auto">
            {available.length === 0 ? (
              <div class="text-xs text-fg-subtle">Todas as tags já aplicadas.</div>
            ) : available.map((t) => (
              <button
                key={t.id}
                type="button"
                class="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-surface-3 inline-flex items-center gap-2"
                onClick={() => {
                  addTag.mutate({ leadId, tagIds: [t.id] }, {
                    onSuccess: () => { toast('Tag adicionada', 'success'); setPickerOpen(false) },
                    onError: (e) => toast(e.message, 'danger'),
                  })
                }}
              >
                <span class="size-2.5 rounded-full" style={{ background: t.color }} />
                {t.name}
              </button>
            ))}
          </div>
        </Modal>
      )}
    </section>
  )
}

function TransferHistorySection({ leadId }: { leadId: number }) {
  const { data, isLoading } = useLeadTransferHistory(leadId)
  const events = data?.events ?? []

  return (
    <section>
      <div class="text-[0.6875rem] uppercase tracking-wider text-fg-subtle mb-1 inline-flex items-center gap-1">
        <History size={10} /> Histórico de atribuições
      </div>
      {isLoading ? (
        <div class="text-[0.6875rem] text-fg-subtle">Carregando…</div>
      ) : events.length === 0 ? (
        <div class="text-[0.6875rem] text-fg-subtle">Sem transferências registradas.</div>
      ) : (
        <ul class="space-y-1.5">
          {events.map((e) => (
            <li
              key={e.id}
              class="border-l-2 border-accent pl-2 py-1 bg-surface-3/40 rounded-r"
            >
              <div class="text-[0.6875rem] text-fg font-medium">{e.title || 'Atribuição alterada'}</div>
              {(e.oldValue ?? e.newValue) && (
                <div class="text-[0.625rem] mt-0.5 inline-flex flex-wrap items-center gap-1">
                  {e.oldValue && (
                    <span class="px-1 py-0.5 rounded bg-danger/15 text-danger">{e.oldValue}</span>
                  )}
                  {e.oldValue && e.newValue && <span class="text-fg-subtle">→</span>}
                  {e.newValue && (
                    <span class="px-1 py-0.5 rounded bg-success/15 text-success">{e.newValue}</span>
                  )}
                </div>
              )}
              <div class="text-[0.625rem] text-fg-subtle mt-0.5">
                por {e.actorName ?? 'Sistema'} · {formatRelative(e.createdAt)}
              </div>
              {e.description && (
                <div class="text-[0.625rem] text-fg-subtle italic mt-0.5">"{e.description}"</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function EditContactModal({
  leadId, lead, autoFocus, onClose,
}: {
  leadId: number
  lead: TicketLeadInfo
  autoFocus: 'nome' | 'annotation'
  onClose: () => void
}) {
  const update = useUpdateLeadContact()
  const [form, setForm] = useState({
    nome: lead.nome ?? '',
    empresa: lead.empresa ?? '',
    whatsapp: lead.whatsapp ?? '',
    email: lead.email ?? '',
    segmento: lead.segmento ?? '',
    cidade: lead.cidade ?? '',
    maturidade: lead.maturidade ?? '',
    solucaoNome: lead.solucaoNome ?? '',
    annotation: lead.annotation ?? '',
  })
  const [error, setError] = useState<string | null>(null)
  const nomeRef = useRef<HTMLInputElement | null>(null)
  const annotationRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    setTimeout(() => {
      if (autoFocus === 'annotation') annotationRef.current?.focus()
      else nomeRef.current?.focus()
    }, 50)
  }, [autoFocus])

  function update_(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function save() {
    setError(null)
    if (!form.whatsapp.trim() && !form.email.trim()) {
      setError('Informe pelo menos WhatsApp ou e-mail')
      return
    }
    update.mutate(
      {
        id: leadId,
        nome: form.nome.trim() || null,
        empresa: form.empresa.trim() || null,
        whatsapp: form.whatsapp.trim() || null,
        email: form.email.trim() || null,
        segmento: form.segmento.trim() || null,
        cidade: form.cidade.trim() || null,
        maturidade: form.maturidade.trim() || null,
        solucaoNome: form.solucaoNome.trim() || null,
        annotation: form.annotation || null,
      },
      {
        onSuccess: () => { toast('Dados atualizados', 'success'); onClose() },
        onError: (e) => setError(e.message || 'Erro ao salvar'),
      },
    )
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Editar dados do contato"
      size="md"
    >
      <div class="space-y-3">
        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="text-[0.6875rem] text-fg-subtle block mb-1">Nome</label>
            <Input
              ref={nomeRef}
              value={form.nome}
              onInput={(e) => update_('nome', (e.target as HTMLInputElement).value)}
            />
          </div>
          <div>
            <label class="text-[0.6875rem] text-fg-subtle block mb-1">Empresa</label>
            <Input
              value={form.empresa}
              onInput={(e) => update_('empresa', (e.target as HTMLInputElement).value)}
            />
          </div>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="text-[0.6875rem] text-fg-subtle block mb-1">WhatsApp</label>
            <Input
              value={form.whatsapp}
              onInput={(e) => update_('whatsapp', (e.target as HTMLInputElement).value)}
            />
          </div>
          <div>
            <label class="text-[0.6875rem] text-fg-subtle block mb-1">Email</label>
            <Input
              type="email"
              value={form.email}
              onInput={(e) => update_('email', (e.target as HTMLInputElement).value)}
            />
          </div>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="text-[0.6875rem] text-fg-subtle block mb-1">Segmento</label>
            <Input
              value={form.segmento}
              onInput={(e) => update_('segmento', (e.target as HTMLInputElement).value)}
            />
          </div>
          <div>
            <label class="text-[0.6875rem] text-fg-subtle block mb-1">Cidade</label>
            <Input
              value={form.cidade}
              onInput={(e) => update_('cidade', (e.target as HTMLInputElement).value)}
            />
          </div>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="text-[0.6875rem] text-fg-subtle block mb-1">Maturidade</label>
            <Input
              value={form.maturidade}
              onInput={(e) => update_('maturidade', (e.target as HTMLInputElement).value)}
            />
          </div>
          <div>
            <label class="text-[0.6875rem] text-fg-subtle block mb-1">Solução</label>
            <Input
              value={form.solucaoNome}
              onInput={(e) => update_('solucaoNome', (e.target as HTMLInputElement).value)}
            />
          </div>
        </div>
        <div>
          <label class="text-[0.6875rem] text-fg-subtle block mb-1">
            Anotação interna (visível apenas à equipe)
          </label>
          <Textarea
            ref={annotationRef}
            rows={3}
            value={form.annotation}
            onInput={(e) => update_('annotation', (e.target as HTMLTextAreaElement).value)}
            placeholder="Notas, contexto, observações…"
          />
        </div>
        {error && <div class="text-xs text-danger">{error}</div>}
        <div class="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={update.isPending}>
            {update.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function TransferModal({
  leadId, currentTeamId, currentUserId, onClose,
}: {
  leadId: number
  currentTeamId: number | null
  currentUserId: number | null
  onClose: () => void
}) {
  const { data: teamsData } = useTeams()
  const [teamId, setTeamId] = useState<number | ''>(currentTeamId ?? '')
  const [userId, setUserId] = useState<number | ''>(currentUserId ?? '')
  const [reason, setReason] = useState('')

  const { data: membersData } = useTeamMembers(typeof teamId === 'number' ? teamId : null)
  const assign = useAssignTicket()
  const teams = teamsData?.teams ?? []
  const members = membersData?.members ?? []

  // Quando muda team, limpa user se ele não pertence à nova team.
  useEffect(() => {
    if (typeof userId === 'number' && members.length > 0) {
      const stillMember = members.some((m) => m.user.id === userId)
      if (!stillMember) setUserId('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, members.length])

  function handleSubmit() {
    assign.mutate({
      leadId,
      teamId: teamId === '' ? null : teamId,
      userId: userId === '' ? null : userId,
      reason: reason.trim() || undefined,
    }, {
      onSuccess: () => { toast('Lead transferido', 'success'); onClose() },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Transferir lead"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={assign.isPending}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={assign.isPending}>
            {assign.isPending ? 'Transferindo…' : 'Transferir'}
          </Button>
        </>
      }
    >
      <div class="space-y-3">
        <Select
          label="Equipe destino"
          value={teamId === '' ? '' : String(teamId)}
          onChange={(e) => {
            const v = (e.target as HTMLSelectElement).value
            setTeamId(v ? Number(v) : '')
          }}
        >
          <option value="">Sem equipe (fila geral)</option>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
        <Select
          label="Operador destino"
          value={userId === '' ? '' : String(userId)}
          onChange={(e) => {
            const v = (e.target as HTMLSelectElement).value
            setUserId(v ? Number(v) : '')
          }}
          disabled={typeof teamId !== 'number'}
          hint={typeof teamId !== 'number' ? 'Selecione uma equipe primeiro' : 'Operador deve pertencer à equipe'}
        >
          <option value="">Deixar em fila (sem operador específico)</option>
          {members.map((m) => (
            <option key={m.user.id} value={m.user.id}>
              {m.user.name ?? m.user.email}{m.isLeader ? ' (líder)' : ''}
            </option>
          ))}
        </Select>
        <Textarea
          label="Motivo (opcional, fica no histórico)"
          value={reason}
          onInput={(e) => setReason((e.target as HTMLTextAreaElement).value)}
          rows={2}
        />
      </div>
    </Modal>
  )
}

function DeleteTicketDialog({
  leadId, leadName, onClose, onDeleted,
}: { leadId: number; leadName: string; onClose: () => void; onDeleted: () => void }) {
  const del = useDeleteTicket()
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Excluir "${leadName}"`}
      description="O lead vai para a lixeira (todas as conversas e mensagens permanecem associadas ao histórico)."
      destructive
      confirmLabel="Excluir"
      loading={del.isPending}
      onConfirm={() => del.mutate(leadId, {
        onSuccess: () => { toast('Lead excluído', 'success'); onDeleted() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })}
    />
  )
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

/** Replica formatação do WhatsApp: *bold*, _italic_, ~strike~, ```code```, URLs auto-link. */
function formatWhatsappBody(s: string): string {
  let out = escapeHtml(s)
  // ```code``` → <code> (multilinha)
  out = out.replace(/```([\s\S]+?)```/g, '<code class="font-mono bg-black/10 px-1 rounded">$1</code>')
  // *bold*
  out = out.replace(/(^|[\s>])\*([^*\n]+)\*(?=[\s<.,!?]|$)/g, '$1<strong>$2</strong>')
  // _italic_
  out = out.replace(/(^|[\s>])_([^_\n]+)_(?=[\s<.,!?]|$)/g, '$1<em>$2</em>')
  // ~strike~
  out = out.replace(/(^|[\s>])~([^~\n]+)~(?=[\s<.,!?]|$)/g, '$1<s>$2</s>')
  // URLs (http(s):// ou www.)
  out = out.replace(/(\bhttps?:\/\/[^\s<]+|\bwww\.[^\s<]+)/g, (m) => {
    const href = m.startsWith('www.') ? `https://${m}` : m
    return `<a href="${href}" target="_blank" rel="noreferrer" class="underline opacity-90 hover:opacity-100">${m}</a>`
  })
  return out
}

function dayKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function formatDayLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Hoje'
  if (d.toDateString() === yesterday.toDateString()) return 'Ontem'
  return d.toLocaleDateString('pt-BR')
}

function formatHourMinute(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function AckIcon({ ack }: { ack: number | null }) {
  if (ack === null) return null
  if (ack <= 0) {
    // Pending — clock
    return (
      <svg viewBox="0 0 12 12" width={12} height={12} fill="currentColor" class="inline-block align-middle text-fg-subtle ml-1">
        <path d="M6 0a6 6 0 1 0 6 6 6 6 0 0 0-6-6zm2.8 8.3L5.5 6.6V3h1v3.1l2.8 1.4z" />
      </svg>
    )
  }
  if (ack === 1) {
    // Single tick
    return (
      <svg viewBox="0 0 16 11" width={14} height={11} fill="currentColor" class="inline-block align-middle text-fg-subtle ml-1">
        <path d="M11.071.653a.457.457 0 0 0-.304-.102.493.493 0 0 0-.381.178l-6.19 7.636-2.011-2.095a.434.434 0 0 0-.329-.156.47.47 0 0 0-.354.153.441.441 0 0 0-.123.332.466.466 0 0 0 .148.33l2.35 2.45a.462.462 0 0 0 .334.15.464.464 0 0 0 .348-.164l6.55-8.076a.477.477 0 0 0 .107-.312.467.467 0 0 0-.145-.324z" />
      </svg>
    )
  }
  // Double tick — read (>=3) is blue, delivered (==2) is grey
  const isRead = ack >= 3
  return (
    <svg viewBox="0 0 16 11" width={14} height={11} fill="currentColor" class={cn('inline-block align-middle ml-1', isRead ? 'text-info' : 'text-fg-subtle')}>
      <path d="M11.071.653a.457.457 0 0 0-.304-.102.493.493 0 0 0-.381.178l-6.19 7.636-2.011-2.095a.434.434 0 0 0-.329-.156.47.47 0 0 0-.354.153.441.441 0 0 0-.123.332.466.466 0 0 0 .148.33l2.35 2.45a.462.462 0 0 0 .334.15.464.464 0 0 0 .348-.164l6.55-8.076a.477.477 0 0 0 .107-.312.467.467 0 0 0-.145-.324z" />
      <path d="M15.071.653a.457.457 0 0 0-.304-.102.493.493 0 0 0-.381.178l-6.19 7.636-1.2-1.25-.758.94 1.62 1.69a.462.462 0 0 0 .334.15.464.464 0 0 0 .348-.164l6.55-8.076a.477.477 0 0 0 .107-.312.467.467 0 0 0-.126-.69z" />
    </svg>
  )
}

function highlightHtml(body: string, term: string): string {
  const formatted = formatWhatsappBody(body)
  if (!term) return formatted
  // Escape regex specials no termo de busca.
  const safe = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return formatted.replace(new RegExp(`(${safe})`, 'gi'), '<mark class="bg-warning/40 text-fg rounded px-0.5">$1</mark>')
}

function MessageBubble({ msg, quoted, highlight, onReply }: {
  msg: ChatMessage
  quoted?: ChatMessage | null
  highlight?: string
  onReply?: () => void
}) {
  return (
    <div class={cn('group flex items-end gap-1', msg.fromMe ? 'justify-end' : 'justify-start')}>
      {msg.fromMe && onReply && !msg.isInternal && (
        <button
          type="button"
          class="size-6 rounded grid place-items-center text-fg-muted hover:text-fg hover:bg-surface-3 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={onReply}
          aria-label="Responder"
          title="Responder"
        >
          <Reply size={12} />
        </button>
      )}
      <div
        class={cn(
          'max-w-[75%] rounded-lg px-3 py-2 text-sm',
          msg.fromMe
            ? 'bg-accent text-fg-on-brand rounded-br-sm'
            : 'bg-surface-2 text-fg border border-border rounded-bl-sm',
          msg.isInternal && 'border-warning/40 bg-warning/10 text-fg',
        )}
      >
        {msg.isInternal && (
          <div class="text-[0.625rem] font-semibold uppercase tracking-wider text-warning mb-0.5">
            Nota interna{msg.senderName ? ` · ${msg.senderName}` : ''}
          </div>
        )}
        {msg.senderName && !msg.fromMe && !msg.isInternal && (
          <div class="text-[0.625rem] font-medium text-fg-muted mb-0.5">{msg.senderName}</div>
        )}
        {quoted && (
          <div class={cn(
            'mb-1 px-2 py-1 rounded border-l-2 text-[0.6875rem] truncate',
            msg.fromMe ? 'bg-black/15 border-white/60' : 'bg-surface-3 border-accent',
          )}>
            <div class="font-medium opacity-80">
              {quoted.fromMe ? 'Você' : (quoted.senderName ?? 'Mensagem')}
            </div>
            <div class="opacity-90 truncate">
              {quoted.body || (quoted.mediaType && quoted.mediaType !== 'text' ? `(${quoted.mediaType})` : '')}
            </div>
          </div>
        )}
        {msg.mediaType && msg.mediaType !== 'text' && msg.mediaUrl && (
          <MediaContent type={msg.mediaType} url={msg.mediaUrl} name={msg.mediaName} />
        )}
        {msg.body && <div class="whitespace-pre-wrap break-words" dangerouslySetInnerHTML={{ __html: highlightHtml(msg.body, highlight ?? '') }} />}
        <div class={cn('text-[0.625rem] mt-1', msg.fromMe ? 'opacity-80' : 'text-fg-subtle')}>
          {formatHourMinute(msg.timestamp)}
          {msg.fromMe && !msg.isInternal && <AckIcon ack={msg.ack} />}
        </div>
      </div>
      {!msg.fromMe && onReply && (
        <button
          type="button"
          class="size-6 rounded grid place-items-center text-fg-muted hover:text-fg hover:bg-surface-3 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={onReply}
          aria-label="Responder"
          title="Responder"
        >
          <Reply size={12} />
        </button>
      )}
    </div>
  )
}
