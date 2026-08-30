import { useEffect, useMemo, useState } from 'preact/hooks'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  Calendar, AlertCircle, ListChecks, Check, X as XIcon, Trash2, Plus,
  Send, Paperclip, Sparkles, MessageSquare, Mail, Phone, Bell, MoreHorizontal, Lock, HelpCircle, Pencil,
  ArrowDownLeft, ArrowUpRight, ChevronDown, User as UserIcon,
} from '@/components/ui/icon-set'
import { HowItWorksModal } from '@/components/ui/HowItWorksModal'
import {
  useActivities,
  useUpdateActivity,
  useDeleteActivity,
  useCreateActivity,
  useExecuteActivity,
  type Activity,
  type ActivityStatus,
  type ActivityType,
  type ActivityInput,
} from '@/hooks/useActivities'
import { useLeads } from '@/hooks/useLeads'
import { useTemplates } from '@/hooks/useTemplates'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Input, Textarea, Select } from '@/components/ui/Input'
import { SearchInput } from '@/components/ui/SearchInput'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { cn } from '@/lib/cn'
import { formatDateTime, formatRelative } from '@/lib/format'
import { toast } from '@/lib/toast'
import { ActivityAttachments, PendingAttachmentsPicker } from '@/components/activities/ActivityAttachments'
import { useUploadActivityAttachment } from '@/hooks/useLeadAttachments'
import { useUserStore } from '@/stores/user'
import { useModuleAccess } from '@/hooks/usePermissions'
import { useAgents } from '@/hooks/useRouting'
import { useTeams } from '@/hooks/useTeams'

type View = 'overdue' | 'today' | 'upcoming' | 'completed' | 'all'

const TYPE_META: Record<ActivityType, { label: string; icon: typeof Calendar; color: string; bg: string }> = {
  whatsapp:  { label: 'WhatsApp',  icon: MessageSquare, color: '#25d366', bg: '#e7faf0' },
  email:     { label: 'E-mail',    icon: Mail,          color: '#ea4335', bg: '#fce8e6' },
  sms:       { label: 'SMS',       icon: MessageSquare, color: '#fbbc04', bg: '#fef7e0' },
  call:      { label: 'Ligação',   icon: Phone,         color: '#1a73e8', bg: '#e8f0fe' },
  meeting:   { label: 'Reunião',   icon: Calendar,      color: '#9334e6', bg: '#f3e8fd' },
  task:      { label: 'Tarefa',    icon: ListChecks,    color: '#5f6368', bg: '#f1f3f4' },
  note:      { label: 'Nota',      icon: ListChecks,    color: '#80868b', bg: '#f1f3f4' },
  follow_up: { label: 'Follow-up', icon: Bell,          color: '#e8710a', bg: '#fef3e6' },
}

const KPI_VIEWS: { id: View; label: string; color: string; bg: string; icon: typeof Calendar }[] = [
  { id: 'overdue',   label: 'Atrasadas',  color: '#ea4335', bg: '#fce8e6', icon: AlertCircle },
  { id: 'today',     label: 'Hoje',       color: '#1a73e8', bg: '#e8f0fe', icon: Calendar },
  { id: 'upcoming',  label: 'Próximas',   color: '#fa7b17', bg: '#feefe3', icon: Calendar },
  { id: 'completed', label: 'Concluídas', color: '#34a853', bg: '#e6f4ea', icon: Check },
  { id: 'all',       label: 'Total',      color: '#9334e6', bg: '#f3e8fd', icon: ListChecks },
]

const EXECUTABLE_TYPES: ActivityType[] = ['whatsapp', 'email', 'sms']

const STATUS_TONE: Record<ActivityStatus, 'info' | 'success' | 'neutral' | 'danger' | 'warning'> = {
  pending: 'info',
  completed: 'success',
  cancelled: 'neutral',
  overdue: 'danger',
  sent: 'success',
  failed: 'danger',
}

const STATUS_LABEL: Record<ActivityStatus, string> = {
  pending: 'Pendente',
  completed: 'Concluída',
  cancelled: 'Cancelada',
  overdue: 'Atrasada',
  sent: 'Enviada',
  failed: 'Falhou',
}

export function ActivitiesPage() {
  const [view, setView] = useState<View>('today')
  const [typeFilter, setTypeFilter] = useState<ActivityType | ''>('')
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<Activity | null>(null)
  const [editing, setEditing] = useState<Activity | null>(null)
  const [showHowItWorks, setShowHowItWorks] = useState(false)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [dateField, setDateField] = useState<'scheduledAt' | 'createdAt'>('scheduledAt')
  // Fila por responsável (módulo Resumo): 'all' | 'mine' | 'unassigned' | userId
  const [ownerFilter, setOwnerFilter] = useState<string>('all')
  const [teamFilter, setTeamFilter] = useState<number | ''>('')
  const currentUserId = useUserStore((st) => st.user?.id ?? null)
  const summaryActive = useModuleAccess('status_summary').status === 'allowed'
  const { data: agentsData } = useAgents()
  const { data: teamsData } = useTeams()

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim().toLowerCase()), 250)
    return () => clearTimeout(t)
  }, [searchInput])

  // Views de período fixo (today/upcoming) ignoram from/to no backend; desabilita o picker.
  const dateRangeDisabled = view === 'today' || view === 'upcoming'

  const filters = useMemo(() => {
    const f: { view?: View extends 'all' ? never : View; type?: ActivityType; limit: number; from?: string; to?: string; dateField?: 'scheduledAt' | 'createdAt' } = { limit: 200 } as any
    if (view !== 'all') (f as any).view = view
    if (typeFilter) f.type = typeFilter
    if (!dateRangeDisabled) {
      if (dateFrom) f.from = dateFrom
      if (dateTo) f.to = dateTo
      if ((dateFrom || dateTo) && dateField !== 'scheduledAt') f.dateField = dateField
    }
    if (ownerFilter === 'mine' && currentUserId) (f as any).assignedUserId = currentUserId
    else if (ownerFilter === 'unassigned') (f as any).unassigned = true
    else if (ownerFilter !== 'all') (f as any).assignedUserId = Number(ownerFilter)
    if (teamFilter !== '') (f as any).assignedTeamId = teamFilter
    return f
  }, [view, typeFilter, dateFrom, dateTo, dateField, dateRangeDisabled, ownerFilter, teamFilter, currentUserId])

  const { data, isLoading } = useActivities(filters as any)
  const todayQ = useActivities({ view: 'today', limit: 1 })
  const upcomingQ = useActivities({ view: 'upcoming', limit: 1 })
  const overdueQ = useActivities({ view: 'overdue', limit: 1 })
  const completedQ = useActivities({ view: 'completed', limit: 1 })
  const allQ = useActivities({ limit: 1 })

  const filteredActivities = useMemo(() => {
    const list = data?.activities ?? []
    if (!search) return list
    return list.filter((a) =>
      [a.title, a.description, a.lead?.empresa, a.lead?.nome, a.lead?.whatsapp, a.lead?.email]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(search))
    )
  }, [data, search])

  return (
    <Page
      title="Atividades"
      description="Atividades agendadas com leads — execute mensagens, envie WhatsApp/email/SMS, agende reuniões."
      actions={
        <div class="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setShowHowItWorks(true)}>
            <HelpCircle size={14} /> Como funciona?
          </Button>
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            <Plus size={14} /> Nova
          </Button>
        </div>
      }
    >
      <section class="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
        {KPI_VIEWS.map((kpi) => {
          const totalsByView: Record<View, number | undefined> = {
            overdue: overdueQ.data?.total,
            today: todayQ.data?.total,
            upcoming: upcomingQ.data?.total,
            completed: completedQ.data?.total,
            all: allQ.data?.total,
          }
          const loadingByView: Record<View, boolean> = {
            overdue: overdueQ.isLoading,
            today: todayQ.isLoading,
            upcoming: upcomingQ.isLoading,
            completed: completedQ.isLoading,
            all: allQ.isLoading,
          }
          return (
            <KpiButton
              key={kpi.id}
              label={kpi.label}
              value={totalsByView[kpi.id] ?? '—'}
              loading={loadingByView[kpi.id]}
              color={kpi.color}
              icon={<kpi.icon size={14} />}
              active={view === kpi.id}
              onClick={() => setView(kpi.id)}
            />
          )
        })}
      </section>

      <Card class="p-3">
        <div class="flex flex-col gap-3">
          <div class="flex flex-wrap items-center gap-3">
            <SearchInput
              value={searchInput}
              onChange={setSearchInput}
              placeholder="Buscar por título, descrição ou lead…"
              class="flex-1 min-w-48"
            />
          </div>
          <div
            class={cn(
              'flex flex-wrap items-end gap-2 text-xs',
              dateRangeDisabled && 'opacity-50 pointer-events-none',
            )}
            aria-disabled={dateRangeDisabled}
          >
            <div class="flex flex-col gap-1">
              <label class="text-2xs font-medium text-fg-muted">Filtrar por</label>
              <select
                value={dateField}
                onChange={(e) => setDateField((e.target as HTMLSelectElement).value as 'scheduledAt' | 'createdAt')}
                class="h-8 rounded-md border border-border bg-surface px-2 text-xs text-fg focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="scheduledAt">Data agendada</option>
                <option value="createdAt">Data de criação</option>
              </select>
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-2xs font-medium text-fg-muted">De</label>
              <input
                type="date"
                value={dateFrom}
                max={dateTo || undefined}
                onInput={(e) => setDateFrom((e.target as HTMLInputElement).value)}
                class="h-8 rounded-md border border-border bg-surface px-2 text-xs text-fg focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-2xs font-medium text-fg-muted">Até</label>
              <input
                type="date"
                value={dateTo}
                min={dateFrom || undefined}
                onInput={(e) => setDateTo((e.target as HTMLInputElement).value)}
                class="h-8 rounded-md border border-border bg-surface px-2 text-xs text-fg focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
            {(dateFrom || dateTo) && (
              <button
                type="button"
                onClick={() => { setDateFrom(''); setDateTo('') }}
                class="h-8 inline-flex items-center gap-1 px-2 rounded-md border border-border bg-surface text-fg-muted hover:text-fg hover:bg-surface-3"
                aria-label="Limpar período"
              >
                <XIcon size={12} /> Limpar
              </button>
            )}
            {dateRangeDisabled && (
              <span class="text-2xs text-fg-muted self-center">
                Período fixo nesta aba — selecione Atrasadas, Concluídas ou Total para filtrar por data.
              </span>
            )}
          </div>
          {summaryActive && (
            <div class="flex flex-wrap items-end gap-2 text-xs">
              <div class="flex flex-col gap-1">
                <label class="text-2xs font-medium text-fg-muted">Responsável</label>
                <select
                  value={ownerFilter}
                  onChange={(e) => setOwnerFilter((e.target as HTMLSelectElement).value)}
                  class="h-8 rounded-md border border-border bg-surface px-2 text-xs text-fg focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  <option value="all">Todos</option>
                  <option value="mine">Minhas atividades</option>
                  <option value="unassigned">Sem responsável (fila)</option>
                  {(agentsData?.agents ?? []).map((a) => (
                    <option key={a.id} value={String(a.id)}>{a.name || a.email}</option>
                  ))}
                </select>
              </div>
              <div class="flex flex-col gap-1">
                <label class="text-2xs font-medium text-fg-muted">Setor</label>
                <select
                  value={teamFilter === '' ? '' : String(teamFilter)}
                  onChange={(e) => {
                    const v = (e.target as HTMLSelectElement).value
                    setTeamFilter(v === '' ? '' : Number(v))
                  }}
                  class="h-8 rounded-md border border-border bg-surface px-2 text-xs text-fg focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  <option value="">Todos os setores</option>
                  {(teamsData?.teams ?? []).map((t) => (
                    <option key={t.id} value={String(t.id)}>{t.name}</option>
                  ))}
                </select>
              </div>
              {(ownerFilter !== 'all' || teamFilter !== '') && (
                <button
                  type="button"
                  onClick={() => { setOwnerFilter('all'); setTeamFilter('') }}
                  class="h-8 inline-flex items-center gap-1 px-2 rounded-md border border-border bg-surface text-fg-muted hover:text-fg hover:bg-surface-3"
                >
                  <XIcon size={12} /> Limpar fila
                </button>
              )}
            </div>
          )}
          <div class="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setTypeFilter('')}
              class={cn(
                'h-7 px-2.5 rounded-full border text-xs font-medium transition-colors',
                typeFilter === '' ? 'bg-accent/15 text-accent border-accent' : 'bg-surface text-fg-muted border-border hover:text-fg',
              )}
            >Todos os tipos</button>
            {(Object.keys(TYPE_META) as ActivityType[]).map((t) => {
              const meta = TYPE_META[t]
              const Icon = meta.icon
              const active = typeFilter === t
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTypeFilter(t)}
                  class={cn(
                    'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border text-xs font-medium transition-colors',
                    !active && 'bg-surface text-fg-muted border-border hover:text-fg',
                  )}
                  style={active ? { background: meta.bg, color: meta.color, borderColor: meta.color } : undefined}
                >
                  <Icon size={10} /> {meta.label}
                </button>
              )
            })}
          </div>
        </div>
      </Card>

      <Card class="p-0 overflow-hidden">
        {isLoading && (
          <div class="p-4 flex flex-col gap-2">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} class="h-14 w-full" />)}
          </div>
        )}
        {!isLoading && filteredActivities.length === 0 && (
          <EmptyState
            title="Nenhuma atividade"
            description={search ? 'Tente outra busca.' : 'Tudo limpo neste filtro. Crie uma nova atividade.'}
          />
        )}
        {!isLoading && filteredActivities.length > 0 && (
          <ul class="divide-y divide-border">
            {filteredActivities.map((a) => <ActivityRow key={a.id} activity={a} onEdit={() => setEditing(a)} onDelete={() => setDeleting(a)} />)}
          </ul>
        )}
      </Card>

      {creating && <CreateActivityModal onClose={() => setCreating(false)} />}
      {editing && <EditActivityModal activity={editing} onClose={() => setEditing(null)} />}
      {deleting && <DeleteActivityDialog activity={deleting} onClose={() => setDeleting(null)} />}

      <HowItWorksModal
        open={showHowItWorks}
        onClose={() => setShowHowItWorks(false)}
        title="Como funcionam as Atividades?"
        problem={<>
          "Ligar pro João sexta-feira", "Mandar proposta pra Maria", "Lembrar da reunião com Pedro" —
          tudo isso some no meio do dia. Atividade é uma <strong>tarefa agendada vinculada a um lead</strong>,
          com data, tipo e dono. Ela aparece no painel <em>Hoje</em> e no detalhe do lead, e dispara
          notificação na hora certa.
        </>}
        steps={[
          {
            title: '➕ Crie a atividade',
            body: <>Botão <strong>Nova</strong>: escolhe o lead, o tipo (mensagem, ligação, reunião, lembrete, e-mail, SMS), a data/hora e o operador responsável. Pode escrever uma anotação ou anexar um arquivo.</>,
          },
          {
            title: '⏰ Acompanhe pelos filtros',
            body: <>As abas no topo (<strong>Atrasadas, Hoje, Próximas, Concluídas, Total</strong>) reorganizam a lista. <strong>Atrasadas</strong> é a aba mais importante — são as tarefas que passaram do prazo e ninguém fez.</>,
          },
          {
            title: '🚀 Execute direto da tela',
            body: <>Algumas atividades têm ação rápida: enviar WhatsApp, e-mail ou SMS sem sair da página. Outras (reunião, ligação) você só marca como concluída depois de fazer.</>,
          },
          {
            title: '🤖 Atividades automáticas',
            body: <>Fluxos e Cadências criam atividades sozinhas (ex.: passo "ligar pro lead" da cadência vira tarefa em Hoje). Detecções de IA também podem virar lembrete ("lead pediu retorno amanhã").</>,
          },
          {
            title: '✅ Marcar como concluída',
            body: <>Após executar, clique no check. A atividade some das listas ativas mas continua no histórico do lead. Cadências aguardam essa confirmação pra avançar pro próximo passo.</>,
          },
        ]}
        tip={{
          tone: 'info',
          title: '💡 Painel "Hoje"',
          body: <>O atalho <strong>Início › Hoje</strong> mostra um resumo só das atividades do dia + leads recém-contactados. É a "lista de afazeres" diária do vendedor.</>,
        }}
      />
    </Page>
  )
}

export { CreateActivityModal, EditActivityModal, ActivityRow, DeleteActivityDialog, TYPE_META as ACTIVITY_TYPE_META, isOverdue as isActivityOverdue }

function isOverdue(activity: Activity): boolean {
  if (activity.status !== 'pending') return false
  return new Date(activity.scheduledAt).getTime() < Date.now()
}

// Converte o corpo do e-mail para texto legível. Inbound já é texto puro;
// outbound antigo pode conter HTML — removemos tags/entidades defensivamente.
function emailBodyText(raw: string): string {
  const norm = raw.replace(/\r\n?/g, '\n')
  if (/<[a-z][\s\S]*?>/i.test(norm)) {
    return norm
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6])>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }
  return norm.trim()
}

// Sanfona do e-mail: fechada mostra só o cabeçalho (chip + assunto);
// ao clicar, expande e revela o corpo. Evita poluir a timeline com textos longos.
function ActivityEmailBody({ activity }: { activity: Activity }) {
  const [open, setOpen] = useState(false)
  const raw = activity.messageBody ?? ''
  if (activity.type !== 'email' || (!raw.trim() && !activity.messageSubject)) return null
  const text = emailBodyText(raw)
  const inbound = activity.direction === 'inbound'
  const subject = activity.messageSubject || '(sem assunto)'
  return (
    <div class="pl-12 mt-2">
      <div class="rounded-md border border-border bg-surface-2 text-xs overflow-hidden">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          class="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-surface-3 transition-colors"
        >
          <span class={cn(
            'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-3xs font-semibold shrink-0',
            inbound ? 'bg-info/15 text-info' : 'bg-success/15 text-success',
          )}>
            {inbound ? <ArrowDownLeft size={10} /> : <ArrowUpRight size={10} />}
            {inbound ? 'Recebido' : 'Enviado'}
          </span>
          <span class="font-medium text-fg truncate flex-1 min-w-0">{subject}</span>
          <ChevronDown size={14} class={cn('text-fg-muted shrink-0 transition-transform', open && 'rotate-180')} />
        </button>
        {open && (
          <div class="px-3 pb-3 pt-1 border-t border-border">
            {activity.recipientEmail && (
              <div class="text-fg-muted mb-1.5 truncate">
                {inbound ? 'de/para' : 'para'} {activity.recipientEmail}
              </div>
            )}
            {text
              ? <div class="whitespace-pre-wrap break-words text-fg-muted leading-relaxed">{text}</div>
              : <div class="text-fg-muted italic">(sem conteúdo)</div>}
          </div>
        )}
      </div>
    </div>
  )
}

function ActivityRow({ activity, onEdit, onDelete }: { activity: Activity; onEdit: () => void; onDelete: () => void }) {
  const update = useUpdateActivity()
  const exec = useExecuteActivity()
  const isPending = activity.status === 'pending' || activity.status === 'overdue'
  const overdue = isOverdue(activity)
  const meta = TYPE_META[activity.type] ?? TYPE_META.task
  const TypeIcon = meta.icon
  const canExecute = isPending && EXECUTABLE_TYPES.includes(activity.type) && (activity.messageBody ?? '').trim().length > 0

  function changeStatus(status: ActivityStatus) {
    update.mutate({ id: activity.id, status }, {
      onSuccess: () => toast(status === 'completed' ? 'Atividade concluída' : 'Atividade cancelada', 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function handleExecute() {
    exec.mutate(activity.id, {
      onSuccess: (r) => toast(r.result ?? 'Atividade executada', 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <li class={cn(
      'px-4 py-3 hover:bg-surface-3',
      overdue && 'border-l-2 border-l-danger',
    )}>
      <div class="flex items-center gap-3">
        <div
          class="size-9 rounded-full grid place-items-center shrink-0"
          style={{ background: meta.bg, color: meta.color }}
          aria-label={meta.label}
        >
          <TypeIcon size={14} />
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-sm font-medium text-fg truncate">{activity.title}</span>
            <Badge tone={STATUS_TONE[activity.status]}>{STATUS_LABEL[activity.status]}</Badge>
            <span
              class="text-3xs font-semibold px-2 py-0.5 rounded-full"
              style={{ background: meta.bg, color: meta.color }}
            >
              {meta.label}
            </span>
            {activity.templateId && <Sparkles size={10} class="text-fg-muted" aria-label="Usa modelo" />}
            {activity.userName && <span class="text-2xs text-fg-muted">por {activity.userName}</span>}
          </div>
          {/* Módulo Resumo: quem EXECUTA. Sem dono e com setor = fila do setor,
              esperando alguém puxar — é o estado que o gestor precisa enxergar. */}
          {(activity.assignedUser || activity.assignedTeam) && (
            <div class="flex items-center gap-1.5 mt-0.5 text-2xs flex-wrap">
              <UserIcon size={10} class="text-fg-muted" />
              {activity.assignedUser ? (
                <span class="text-fg-muted">
                  {activity.assignedUser.name || activity.assignedUser.email}
                </span>
              ) : (
                <span class="text-warning font-medium">na fila</span>
              )}
              {activity.assignedTeam && (
                <span
                  class="px-1.5 py-0.5 rounded"
                  style={{
                    background: `${activity.assignedTeam.color || '#6B7280'}22`,
                    color: activity.assignedTeam.color || '#6B7280',
                  }}
                >
                  {activity.assignedTeam.name}
                </span>
              )}
            </div>
          )}
          {activity.lead && (
            <div class="text-xs text-fg-muted truncate mt-0.5">
              Lead: {activity.lead.nome ?? activity.lead.empresa ?? `#${activity.lead.id}`}
              {activity.lead.empresa && activity.lead.nome && <span class="text-fg-muted"> · {activity.lead.empresa}</span>}
            </div>
          )}
          {activity.description && (
            <div class="text-2xs text-fg-muted truncate mt-0.5">{activity.description}</div>
          )}
        </div>
        <div class="text-xs whitespace-nowrap text-right shrink-0">
          <div class={cn('text-fg-muted', overdue && 'text-danger font-medium')}>
            {formatDateTime(activity.scheduledAt)}
          </div>
          {activity.reminderAt && (
            <div class="text-2xs text-fg-muted inline-flex items-center gap-1 justify-end">
              <Bell size={10} /> {formatRelative(activity.reminderAt)}
            </div>
          )}
        </div>
        <ActivityRowMenu
          canExecute={canExecute}
          isPending={isPending}
          executing={exec.isPending}
          onExecute={handleExecute}
          onComplete={() => changeStatus('completed')}
          onCancel={() => changeStatus('cancelled')}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      </div>

      {/* Gravação de ligação VoIP (quando a atividade tem áudio anexado) */}
      {(() => {
        const meta = (activity.metadata ?? {}) as Record<string, unknown>
        const recUrl = typeof meta.recordingUrl === 'string'
          ? meta.recordingUrl
          : (activity.attachmentType && activity.attachmentType.startsWith('audio') ? activity.attachmentUrl : null)
        if (!recUrl) return null
        return (
          <div class="pl-12 mt-2">
            <audio controls src={recUrl} class="h-8 w-full max-w-sm" />
          </div>
        )
      })()}

      {/* Corpo do e-mail (enviado ou recebido) */}
      <ActivityEmailBody activity={activity} />

      {/* Anexos da atividade (prints, documentos enviados etc.) */}
      <div class="pl-12">
        <ActivityAttachments activityId={activity.id} leadId={activity.leadId} />
      </div>
    </li>
  )
}

function ActivityRowMenu({
  canExecute, isPending, executing, onExecute, onComplete, onCancel, onEdit, onDelete,
}: {
  canExecute: boolean
  isPending: boolean
  executing: boolean
  onExecute: () => void
  onComplete: () => void
  onCancel: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  // Radix Portal renderiza o menu no <body>, escapando qualquer overflow:hidden
  // de containers pais (modal de lead, lista com border-radius, etc).
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          class="size-8 rounded-full border border-border bg-surface text-fg-muted grid place-items-center hover:bg-surface-3 hover:text-fg transition-colors shrink-0"
          aria-label="Ações"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal size={14} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          class="min-w-[12rem] rounded-md border border-border bg-surface-2 shadow-lg py-1"
          style={{ zIndex: 'var(--z-popover)' }}
        >
          {isPending ? (
            <>
              {canExecute && (
                <ActivityMenuItem icon={<Send size={12} />} tone="info" onSelect={onExecute} disabled={executing}>
                  Enviar
                </ActivityMenuItem>
              )}
              <ActivityMenuItem icon={<Check size={12} />} tone="success" onSelect={onComplete}>
                Concluir
              </ActivityMenuItem>
              <ActivityMenuItem icon={<XIcon size={12} />} tone="muted" onSelect={onCancel}>
                Cancelar
              </ActivityMenuItem>
              <DropdownMenu.Separator class="my-1 h-px bg-border" />
              <ActivityMenuItem icon={<Pencil size={12} />} tone="info" onSelect={onEdit}>
                Editar
              </ActivityMenuItem>
              <ActivityMenuItem icon={<Trash2 size={12} />} tone="danger" onSelect={onDelete}>
                Excluir
              </ActivityMenuItem>
            </>
          ) : (
            <>
              <div class="px-3 py-2 text-xs text-fg-muted inline-flex items-center gap-2">
                <Lock size={12} /> Atividade finalizada
              </div>
              <DropdownMenu.Separator class="my-1 h-px bg-border" />
              <ActivityMenuItem icon={<Pencil size={12} />} tone="info" onSelect={onEdit}>
                Editar
              </ActivityMenuItem>
              <ActivityMenuItem icon={<Trash2 size={12} />} tone="danger" onSelect={onDelete}>
                Excluir
              </ActivityMenuItem>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function ActivityMenuItem({
  icon, children, tone, onSelect, disabled,
}: {
  icon: preact.ComponentChildren
  children: preact.ComponentChildren
  tone: 'success' | 'danger' | 'info' | 'muted'
  onSelect: () => void
  disabled?: boolean
}) {
  const toneClass = tone === 'success'
    ? 'text-success'
    : tone === 'danger'
      ? 'text-danger'
      : tone === 'info'
        ? 'text-info'
        : 'text-fg-muted'
  return (
    <DropdownMenu.Item
      disabled={!!disabled}
      onSelect={(e) => {
        // setTimeout(0) evita race condition entre fechamento do menu e abertura
        // de modais de confirmação (Radix dropdown + dialog disputam focus trap).
        e.preventDefault()
        setTimeout(() => onSelect(), 0)
      }}
      class={cn(
        'w-full text-left px-3 py-1.5 text-xs cursor-pointer outline-none hover:bg-surface-3 inline-flex items-center gap-2',
        toneClass,
        disabled && 'opacity-50 cursor-not-allowed',
      )}
    >
      {icon}
      {children}
    </DropdownMenu.Item>
  )
}

function KpiButton({
  label, value, loading, color, icon, active, onClick,
}: {
  label: string
  value: string | number
  loading: boolean
  color: string
  icon: preact.ComponentChildren
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      class={cn(
        'rounded-lg border bg-surface-2 p-4 flex flex-col gap-2 text-left transition-all hover:border-fg-muted',
        active ? 'ring-2 ring-offset-1 ring-offset-surface' : 'border-border',
      )}
      style={active ? { borderColor: color, '--tw-ring-color': color } : undefined}
      aria-pressed={active}
    >
      <div class="flex items-center justify-between gap-2">
        <span class="text-xs uppercase tracking-wider font-medium" style={{ color: active ? color : 'var(--color-fg-muted)' }}>{label}</span>
        <span style={{ color }}>{icon}</span>
      </div>
      {loading
        ? <span class="h-7 w-20 rounded bg-surface-3 animate-pulse" />
        : <span class="text-2xl font-semibold tabular-nums" style={{ color }}>{value}</span>
      }
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Create modal

type FormTab = 'general' | 'message' | 'attachment'

function CreateActivityModal({ onClose, preselectedLead }: { onClose: () => void; preselectedLead?: { id: number; label: string; whatsapp?: string | null; email?: string | null } | undefined }) {
  const [tab, setTab] = useState<FormTab>('general')
  const [lead, setLead] = useState<{ id: number; label: string } | null>(preselectedLead ? { id: preselectedLead.id, label: preselectedLead.label } : null)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300)
    return () => clearTimeout(t)
  }, [searchInput])
  const leadsQ = useLeads({ search: search || undefined, limit: 8 })

  const [type, setType] = useState<ActivityType>('task')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [scheduledAt, setScheduledAt] = useState(() => {
    const d = new Date(Date.now() + 60 * 60 * 1000)
    d.setSeconds(0, 0)
    return d.toISOString().slice(0, 16)
  })
  const [reminderAt, setReminderAt] = useState('')
  // Avisar o lead (convite Google + WhatsApp). Default OFF — evita que registrar
  // um no-show como reunião dispare convite/WhatsApp ao cliente sem querer.
  const [notifyLead, setNotifyLead] = useState(false)
  // Gravar/transcrever esta reunião — opt-OUT (F0.5). Default marcado; desmarcar
  // registra a recusa (metadata.recordMeeting=false). Só tem efeito se a gravação
  // estiver ativada em Configurações › LGPD/Legal.
  const [recordMeeting, setRecordMeeting] = useState(true)

  const [templateId, setTemplateId] = useState<number | ''>('')
  const [messageSubject, setMessageSubject] = useState('')
  const [messageBody, setMessageBody] = useState('')
  const [recipientPhone, setRecipientPhone] = useState(preselectedLead?.whatsapp ?? '')
  const [recipientEmail, setRecipientEmail] = useState(preselectedLead?.email ?? '')

  const [pendingFiles, setPendingFiles] = useState<File[]>([])

  const channelForType = type === 'whatsapp' ? 'whatsapp' : type === 'email' ? 'email' : type === 'sms' ? 'sms' : null
  const templatesQ = useTemplates({ channel: channelForType ?? undefined })
  const create = useCreateActivity()
  const uploadAttachment = useUploadActivityAttachment()

  function pickTemplate(id: number) {
    setTemplateId(id)
    const tpl = templatesQ.data?.templates.find((t) => t.id === id)
    if (tpl) {
      if (tpl.subject && !messageSubject) setMessageSubject(tpl.subject)
      if (tpl.body && !messageBody) setMessageBody(tpl.body)
    }
  }

  function insertVar(v: string) {
    setMessageBody((prev) => `${prev}{{${v}}}`)
  }

  async function handleSubmit() {
    if (!lead) { toast('Selecione um lead', 'danger'); return }
    if (!title.trim()) { toast('Título é obrigatório', 'danger'); return }
    if (!scheduledAt) { toast('Data/hora é obrigatória', 'danger'); return }

    const payload: ActivityInput = {
      leadId: lead.id,
      type,
      title: title.trim(),
      description: description.trim() || null,
      scheduledAt: new Date(scheduledAt).toISOString(),
      reminderAt: reminderAt ? new Date(reminderAt).toISOString() : null,
      messageBody: messageBody.trim() || null,
      messageSubject: messageSubject.trim() || null,
      templateId: templateId === '' ? null : Number(templateId),
      recipientPhone: recipientPhone.trim() || null,
      recipientEmail: recipientEmail.trim() || null,
      notifyLead: (type === 'meeting' || type === 'call') ? notifyLead : undefined,
      recordMeeting: type === 'meeting' ? recordMeeting : undefined,
    }

    let createdActivity: Activity
    try {
      const res = await create.mutateAsync(payload)
      createdActivity = res.activity
    } catch (e: unknown) {
      toast((e as Error).message, 'danger')
      return
    }

    // Sobe os anexos pendentes vinculados à activity recém-criada.
    // Falhas individuais não revertem a atividade — operador vê toasts com nomes.
    if (pendingFiles.length > 0) {
      let ok = 0
      let fail = 0
      for (const file of pendingFiles) {
        try {
          await uploadAttachment.mutateAsync({ activityId: createdActivity.id, file })
          ok++
        } catch (err) {
          fail++
          const msg = err instanceof Error ? err.message : String(err)
          toast(`Falha em "${file.name}": ${msg}`, 'danger')
        }
      }
      if (ok > 0) toast(`Atividade criada com ${ok} anexo${ok === 1 ? '' : 's'}`, 'success')
      else if (fail > 0) toast('Atividade criada, mas anexos falharam', 'warning')
    } else {
      toast('Atividade criada', 'success')
    }

    onClose()
  }

  const showMessageTab = type === 'whatsapp' || type === 'email' || type === 'sms'

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Nova atividade"
      description="Selecione um lead e agende a interação."
      size="xl"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={create.isPending}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={create.isPending}>
            {create.isPending ? 'Salvando…' : 'Criar'}
          </Button>
        </>
      }
    >
      <nav class="flex gap-1 mb-4 border-b border-border">
        <TabButton active={tab === 'general'} onClick={() => setTab('general')}>Geral</TabButton>
        {showMessageTab && <TabButton active={tab === 'message'} onClick={() => setTab('message')}>Mensagem</TabButton>}
        <TabButton active={tab === 'attachment'} onClick={() => setTab('attachment')}>
          Anexos{pendingFiles.length > 0 && <span class="ml-1 text-fg-muted">({pendingFiles.length})</span>}
        </TabButton>
      </nav>

      {tab === 'general' && (
        <div class="space-y-3">
          <div class="relative">
            <Input
              label={lead ? 'Lead selecionado' : 'Buscar lead *'}
              value={lead ? lead.label : searchInput}
              onInput={(e) => {
                if (lead) {
                  setLead(null)
                  setRecipientPhone('')
                  setRecipientEmail('')
                }
                setSearchInput((e.target as HTMLInputElement).value)
              }}
              placeholder="Nome, empresa, email ou WhatsApp…"
            />
            {lead && (
              <button
                type="button"
                class="absolute right-2 top-7 size-7 grid place-items-center text-fg-muted hover:text-fg"
                onClick={() => { setLead(null); setSearchInput(''); setRecipientPhone(''); setRecipientEmail('') }}
                aria-label="Limpar"
              >
                <XIcon size={12} />
              </button>
            )}
            {!lead && search && (leadsQ.data?.leads.length ?? 0) > 0 && (
              <ul class="absolute z-10 left-0 right-0 mt-1 rounded-md border border-border bg-surface-2 shadow-lg max-h-56 overflow-y-auto">
                {(leadsQ.data?.leads ?? []).map((l) => (
                  <li key={l.id}>
                    <button
                      type="button"
                      class="w-full text-left px-3 py-2 text-xs text-fg hover:bg-surface-3"
                      onClick={() => {
                        setLead({ id: l.id, label: l.nome ?? l.empresa ?? l.whatsapp ?? `Lead #${l.id}` })
                        setSearchInput('')
                        if (l.whatsapp) setRecipientPhone(l.whatsapp)
                        if (l.email) setRecipientEmail(l.email)
                      }}
                    >
                      <div class="font-medium">{l.nome ?? l.empresa ?? `Lead #${l.id}`}</div>
                      <div class="text-fg-muted">{l.empresa ?? '—'} · {l.whatsapp ?? '—'} {l.email ? `· ${l.email}` : ''}</div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <label class="text-xs font-medium text-fg-muted block mb-1.5">Canal / Tipo *</label>
            <div class="flex flex-wrap gap-1.5">
              {(Object.keys(TYPE_META) as ActivityType[]).map((k) => {
                const meta = TYPE_META[k]
                const Icon = meta.icon
                const active = type === k
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => { setType(k); setTemplateId('') }}
                    class={cn(
                      'inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-xs font-medium transition-colors',
                      !active && 'bg-surface text-fg-muted border-border hover:text-fg',
                    )}
                    style={active ? { background: meta.bg, color: meta.color, borderColor: meta.color } : undefined}
                    aria-pressed={active}
                  >
                    <Icon size={12} /> {meta.label}
                  </button>
                )
              })}
            </div>
          </div>
          <Input label="Título *" value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} placeholder="Ex.: Enviar proposta" />
          <Textarea label="Descrição (opcional)" value={description} onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)} rows={2} />
          <div class="grid gap-3 grid-cols-1 sm:grid-cols-2">
            <Input label="Quando *" type="datetime-local" value={scheduledAt} onInput={(e) => setScheduledAt((e.target as HTMLInputElement).value)} />
            <Input
              label="Lembrete (opcional)"
              type="datetime-local"
              value={reminderAt}
              onInput={(e) => setReminderAt((e.target as HTMLInputElement).value)}
              hint="Notifica antes da execução"
            />
          </div>
          {(type === 'meeting' || type === 'call') && (
            <label class="flex items-start gap-2 rounded-lg border border-border bg-surface p-3 cursor-pointer">
              <input
                type="checkbox"
                class="mt-0.5"
                checked={notifyLead}
                onChange={(e) => setNotifyLead((e.target as HTMLInputElement).checked)}
              />
              <span class="text-xs text-fg-muted leading-snug">
                <span class="font-medium text-fg">Avisar o lead</span> — envia convite no Google Calendar e WhatsApp com o link do Meet.
                Deixe <strong>desmarcado</strong> para apenas registrar (ex.: marcar um no-show) sem notificar o cliente.
              </span>
            </label>
          )}
          {type === 'meeting' && (
            <label class="flex items-start gap-2 rounded-lg border border-border bg-surface p-3 cursor-pointer">
              <input
                type="checkbox"
                class="mt-0.5"
                checked={recordMeeting}
                onChange={(e) => setRecordMeeting((e.target as HTMLInputElement).checked)}
              />
              <span class="text-xs text-fg-muted leading-snug">
                <span class="font-medium text-fg">Gravar e transcrever esta reunião</span> — só tem efeito se a gravação estiver
                ativada em Configurações › LGPD/Legal. Deixe <strong>desmarcado</strong> para não gravar esta reunião específica.
              </span>
            </label>
          )}
        </div>
      )}

      {tab === 'message' && showMessageTab && (
        <div class="space-y-3">
          <Select
            label="Modelo (opcional)"
            value={templateId === '' ? '' : String(templateId)}
            onChange={(e) => {
              const v = (e.target as HTMLSelectElement).value
              if (v) pickTemplate(Number(v))
              else setTemplateId('')
            }}
            hint="Aplica ao salvar (variáveis substituídas com dados do lead)"
          >
            <option value="">— sem modelo —</option>
            {templatesQ.data?.templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name} ({t.channel})</option>
            ))}
          </Select>

          {(type === 'email') && (
            <Input label="Assunto" value={messageSubject} onInput={(e) => setMessageSubject((e.target as HTMLInputElement).value)} />
          )}

          <Textarea
            label="Mensagem"
            value={messageBody}
            onInput={(e) => setMessageBody((e.target as HTMLTextAreaElement).value)}
            rows={6}
            hint="Use {{nome}}, {{empresa}}, {{operador}}, {{data_hoje}} para variáveis"
          />

          <div class="flex flex-wrap gap-1.5">
            <span class="text-xs text-fg-muted self-center">Inserir:</span>
            {['nome', 'empresa', 'operador', 'data_hoje', 'whatsapp', 'email'].map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => insertVar(v)}
                class="h-6 px-2 rounded-full text-2xs font-mono bg-surface text-fg-muted border border-border hover:bg-surface-3 hover:text-fg"
              >
                {`{{${v}}}`}
              </button>
            ))}
          </div>

          <div class="grid gap-3 grid-cols-1 sm:grid-cols-2">
            <Input
              label={type === 'email' ? 'Email destino (opcional)' : 'WhatsApp/SMS destino (opcional)'}
              value={type === 'email' ? recipientEmail : recipientPhone}
              onInput={(e) => {
                const v = (e.target as HTMLInputElement).value
                if (type === 'email') setRecipientEmail(v)
                else setRecipientPhone(v)
              }}
              hint={type === 'email' ? 'Vazio usa email do lead' : 'Vazio usa WhatsApp do lead'}
            />
          </div>
        </div>
      )}

      {tab === 'attachment' && (
        <div class="space-y-3">
          <PendingAttachmentsPicker
            files={pendingFiles}
            onChange={setPendingFiles}
            disabled={create.isPending || uploadAttachment.isPending}
          />
          <div class="rounded-md border border-info/30 bg-info/10 p-3 text-xs text-info">
            <Paperclip size={12} class="inline mr-1" />
            Os arquivos são salvos junto com esta atividade e exibidos no histórico do lead. Imagens ganham miniatura clicável; outros formatos abrem em nova aba.
          </div>
        </div>
      )}
    </Modal>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: preact.ComponentChildren }) {
  return (
    <button
      type="button"
      onClick={onClick}
      class={cn(
        'px-3 h-9 -mb-px border-b-2 text-sm font-medium transition-colors',
        active ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:text-fg',
      )}
    >
      {children}
    </button>
  )
}

// Converte um ISO (UTC) para o valor do <input type="datetime-local"> no fuso local.
function toLocalInput(iso: string): string {
  const d = new Date(iso)
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

function EditActivityModal({ activity, onClose }: { activity: Activity; onClose: () => void }) {
  const [type, setType] = useState<ActivityType>(activity.type)
  const [title, setTitle] = useState(activity.title)
  const [description, setDescription] = useState(activity.description ?? '')
  const [scheduledAt, setScheduledAt] = useState(() => toLocalInput(activity.scheduledAt))
  const [reminderAt, setReminderAt] = useState(() => (activity.reminderAt ? toLocalInput(activity.reminderAt) : ''))
  const [messageSubject, setMessageSubject] = useState(activity.messageSubject ?? '')
  const [messageBody, setMessageBody] = useState(activity.messageBody ?? '')
  const [recipientPhone, setRecipientPhone] = useState(activity.recipientPhone ?? '')
  const [recipientEmail, setRecipientEmail] = useState(activity.recipientEmail ?? '')
  const update = useUpdateActivity()

  const showMessage = type === 'whatsapp' || type === 'email' || type === 'sms'
  const syncsGoogle = (type === 'meeting' || type === 'call') && !!(activity.metadata as Record<string, unknown> | null)?.googleCalendarEventId

  async function handleSave() {
    if (!title.trim()) { toast('Título é obrigatório', 'danger'); return }
    if (!scheduledAt) { toast('Data/hora é obrigatória', 'danger'); return }
    try {
      await update.mutateAsync({
        id: activity.id,
        type,
        title: title.trim(),
        description: description.trim() || null,
        scheduledAt: new Date(scheduledAt).toISOString(),
        reminderAt: reminderAt ? new Date(reminderAt).toISOString() : null,
        messageSubject: showMessage ? (messageSubject.trim() || null) : undefined,
        messageBody: showMessage ? (messageBody.trim() || null) : undefined,
        recipientPhone: showMessage ? (recipientPhone.trim() || null) : undefined,
        recipientEmail: showMessage ? (recipientEmail.trim() || null) : undefined,
      })
      toast('Atividade atualizada', 'success')
      onClose()
    } catch (e: unknown) {
      toast((e as Error).message, 'danger')
    }
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Editar atividade"
      description={activity.lead ? `Lead: ${activity.lead.nome ?? activity.lead.empresa ?? `#${activity.lead.id}`}` : undefined}
      size="lg"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={update.isPending}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleSave} disabled={update.isPending}>
            {update.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </>
      }
    >
      <div class="space-y-3">
        <Select label="Tipo" value={type} onChange={(e) => setType((e.target as HTMLSelectElement).value as ActivityType)}>
          {(Object.keys(TYPE_META) as ActivityType[]).map((k) => <option key={k} value={k}>{TYPE_META[k].label}</option>)}
        </Select>
        <Input label="Título *" value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} />
        <Textarea label="Descrição (opcional)" value={description} onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)} rows={2} />
        <div class="grid gap-3 grid-cols-1 sm:grid-cols-2">
          <Input label="Quando *" type="datetime-local" value={scheduledAt} onInput={(e) => setScheduledAt((e.target as HTMLInputElement).value)} />
          <Input label="Lembrete (opcional)" type="datetime-local" value={reminderAt} onInput={(e) => setReminderAt((e.target as HTMLInputElement).value)} />
        </div>
        {showMessage && (
          <>
            {type === 'email' && <Input label="Assunto" value={messageSubject} onInput={(e) => setMessageSubject((e.target as HTMLInputElement).value)} />}
            <Textarea label="Mensagem" value={messageBody} onInput={(e) => setMessageBody((e.target as HTMLTextAreaElement).value)} rows={4} />
            <div class="grid gap-3 grid-cols-1 sm:grid-cols-2">
              <Input label="Telefone" value={recipientPhone} onInput={(e) => setRecipientPhone((e.target as HTMLInputElement).value)} />
              <Input label="E-mail" value={recipientEmail} onInput={(e) => setRecipientEmail((e.target as HTMLInputElement).value)} />
            </div>
          </>
        )}
        {syncsGoogle && (
          <p class="text-2xs text-fg-muted">Alterar o título ou o horário também atualiza o evento no Google Calendar (não reenvia convite ao lead).</p>
        )}
      </div>
    </Modal>
  )
}

function DeleteActivityDialog({ activity, onClose }: { activity: Activity; onClose: () => void }) {
  const del = useDeleteActivity()
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Excluir "${activity.title}"`}
      description="A atividade será removida. Esta ação não pode ser desfeita."
      destructive
      confirmLabel="Excluir"
      loading={del.isPending}
      onConfirm={() => del.mutate(activity.id, {
        onSuccess: () => { toast('Atividade excluída', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })}
    />
  )
}
