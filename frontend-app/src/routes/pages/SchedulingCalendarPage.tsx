// Módulo de Agendamento — Agenda (visão calendário Mês/Semana/Dia).
// Mescla reuniões de clientes (Bookings, automático), atividades agendadas do CRM e
// bloqueios/compromissos manuais. Permite criar/editar bloqueios e agir sobre reservas.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import {
  CalendarDays, ChevronLeft, ChevronRight, Plus, X, Trash2, MapPin,
  Video, User as UserIcon, ExternalLink, Ban, Clock, BadgeCheck,
} from 'lucide-preact'
import { Button } from '@/components/ui/Button'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { toast } from '@/lib/toast'
import { useAgents } from '@/hooks/useRouting'
import { useMyGoogleStatus, useMyGoogleAuthUrl } from '@/hooks/useGoogle'
import {
  useCalendar, useSaveBlock, useDeleteBlock, useUpdateBookingStatus,
  type CalendarEvent, type BlockInput,
} from '@/hooks/useScheduling'

type View = 'month' | 'week' | 'day'

// ── Helpers de data (sem libs; hora local do navegador) ──
const MS_DAY = 86400000
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const startOfWeek = (d: Date) => addDays(startOfDay(d), -d.getDay()) // domingo
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1)
const endOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0)
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
const WD = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const WD_FULL = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
const moName = (i: number): string => MONTHS[i] ?? ''
const wdFull = (i: number): string => WD_FULL[i] ?? ''
const wdShort = (i: number): string => WD[i] ?? ''

const DAY_START_HOUR = 6 // início visível na grade de horas (scroll inicial)
const HOUR_PX = 52 // altura de 1h na grade

const STATUS_LABEL: Record<string, string> = {
  scheduled: 'Agendada', confirmed: 'Confirmada', completed: 'Concluída',
  no_show: 'Não compareceu', cancelled: 'Cancelada', pending: 'Pendente', overdue: 'Atrasada',
}
const KIND_LABEL: Record<string, string> = { booking: 'Reunião (cliente)', block: 'Bloqueio', activity: 'Atividade', google: 'Google Calendar' }
const LOC_ICON: Record<string, string> = { google_meet: 'Google Meet', phone: 'Telefone', whatsapp: 'WhatsApp', in_person: 'Presencial', custom: 'Link' }

export function CalendarPanel() {
  const [view, setView] = useState<View>('week')
  const [cursor, setCursor] = useState<Date>(() => startOfDay(new Date()))
  const [operator, setOperator] = useState<number | null>(null)
  const [editingBlock, setEditingBlock] = useState<BlockInput | null>(null)
  const [detail, setDetail] = useState<CalendarEvent | null>(null)

  const { data: agentsData } = useAgents()
  const agents = (agentsData?.agents ?? []).filter((a) => a.active)
  const googleStatus = useMyGoogleStatus()
  const googleAuth = useMyGoogleAuthUrl()
  const googleConnected = !!googleStatus.data?.connection?.active

  function connectGoogle() {
    googleAuth.mutate(undefined, {
      onSuccess: ({ url }) => { const p = window.open(url, 'google-oauth', 'width=600,height=700'); if (!p) toast('Pop-up bloqueado pelo navegador', 'danger') },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  // Intervalo visível conforme a vista.
  const { rangeStart, rangeEnd, gridDays } = useMemo(() => {
    if (view === 'month') {
      const first = startOfMonth(cursor)
      const last = endOfMonth(cursor)
      const gridStart = startOfWeek(first)
      const gridEnd = addDays(startOfWeek(last), 7) // até sábado da última semana (exclusivo)
      const days: Date[] = []
      for (let d = gridStart; d < gridEnd; d = addDays(d, 1)) days.push(d)
      return { rangeStart: gridStart, rangeEnd: gridEnd, gridDays: days }
    }
    if (view === 'week') {
      const s = startOfWeek(cursor)
      const days = Array.from({ length: 7 }, (_, i) => addDays(s, i))
      return { rangeStart: s, rangeEnd: addDays(s, 7), gridDays: days }
    }
    const s = startOfDay(cursor)
    return { rangeStart: s, rangeEnd: addDays(s, 1), gridDays: [s] }
  }, [view, cursor])

  const calendar = useCalendar(rangeStart.toISOString(), rangeEnd.toISOString(), operator)
  const events = calendar.data?.events ?? []
  const canSeeAll = calendar.data?.canSeeAll ?? false

  function go(delta: number) {
    if (view === 'month') setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1))
    else if (view === 'week') setCursor((c) => addDays(c, delta * 7))
    else setCursor((c) => addDays(c, delta))
  }

  function openNewBlock(day?: Date, hour?: number) {
    const base = day ? new Date(day) : new Date()
    if (hour != null) base.setHours(hour, 0, 0, 0)
    else if (!day) base.setMinutes(Math.ceil(base.getMinutes() / 30) * 30, 0, 0)
    else base.setHours(9, 0, 0, 0)
    const end = new Date(base.getTime() + 30 * 60000)
    setEditingBlock({
      kind: 'busy', title: '', startAt: toLocalInput(base), endAt: toLocalInput(end), allDay: false,
      ...(canSeeAll && operator ? { operatorUserId: operator } : {}),
    })
  }

  const periodLabel = useMemo(() => {
    if (view === 'month') return `${moName(cursor.getMonth())} de ${cursor.getFullYear()}`
    if (view === 'day') return `${wdFull(cursor.getDay())}, ${cursor.getDate()} de ${moName(cursor.getMonth())} de ${cursor.getFullYear()}`
    const s = startOfWeek(cursor), e = addDays(s, 6)
    const sameMonth = s.getMonth() === e.getMonth()
    return sameMonth
      ? `${s.getDate()}–${e.getDate()} de ${moName(s.getMonth())} ${s.getFullYear()}`
      : `${s.getDate()} ${moName(s.getMonth()).slice(0, 3)} – ${e.getDate()} ${moName(e.getMonth()).slice(0, 3)} ${e.getFullYear()}`
  }, [view, cursor])

  return (
    <div class="space-y-4">
      {/* Barra de ferramentas da agenda (responsiva: empilha no mobile) */}
      <div class="space-y-3">
        {/* Navegação de período */}
        <div class="flex items-center gap-1">
          <Button variant="secondary" size="sm" iconOnly onClick={() => go(-1)} aria-label="Anterior"><ChevronLeft size={16} /></Button>
          <Button variant="secondary" size="sm" onClick={() => setCursor(startOfDay(new Date()))}>Hoje</Button>
          <Button variant="secondary" size="sm" iconOnly onClick={() => go(1)} aria-label="Próximo"><ChevronRight size={16} /></Button>
          <span class="ml-1.5 min-w-0 truncate text-sm font-medium capitalize">{periodLabel}</span>
        </div>

        {/* Seletor de vista + ações */}
        <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          {/* Segmentado de vista — full-width no mobile */}
          <div class="flex w-full overflow-hidden rounded-lg border border-border sm:w-auto">
            {(['month', 'week', 'day'] as View[]).map((v) => (
              <button key={v} onClick={() => setView(v)}
                class={`flex-1 px-3 py-1.5 text-sm sm:flex-none ${view === v ? 'bg-accent text-white' : 'bg-surface text-fg-muted hover:bg-surface-2'}`}>
                {v === 'month' ? 'Mês' : v === 'week' ? 'Semana' : 'Dia'}
              </button>
            ))}
          </div>
          {/* Operador + novo bloqueio */}
          <div class="flex items-center gap-2">
            {canSeeAll && (
              <div class="min-w-0 flex-1 sm:flex-none">
                <Select class="w-full sm:w-auto" value={operator == null ? '' : String(operator)} onChange={(e) => { const v = (e.target as HTMLSelectElement).value; setOperator(v ? Number(v) : null) }}>
                  <option value="">Todos os operadores</option>
                  {agents.map((a) => <option key={a.id} value={a.id}>{a.name || a.email}</option>)}
                </Select>
              </div>
            )}
            <Button class="shrink-0 whitespace-nowrap" onClick={() => openNewBlock()}><Plus size={16} /> <span class="sm:hidden">Novo</span><span class="hidden sm:inline">Novo bloqueio</span></Button>
          </div>
        </div>
      </div>

      {/* Banner de integração com o Google Calendar */}
      {googleStatus.isFetched && !googleConnected && (
        <div class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
          <span class="text-sm text-fg-muted flex items-center gap-2">
            <CalendarDays size={15} class="text-[#0b8043]" />
            Conecte sua conta Google para ver seus eventos do Google Calendar aqui e bloquear esses horários automaticamente.
          </span>
          <Button size="sm" variant="secondary" onClick={connectGoogle} disabled={googleAuth.isPending}>
            {googleAuth.isPending ? 'Abrindo…' : 'Conectar Google'}
          </Button>
        </div>
      )}

      {calendar.isLoading && <div class="text-sm text-fg-muted">Carregando agenda…</div>}

      {view === 'month'
        ? <MonthGrid days={gridDays} cursor={cursor} events={events} onPick={(d) => { setCursor(d); setView('day') }} onEvent={setDetail} onAdd={(d) => openNewBlock(d)} />
        : <TimeGrid days={gridDays} events={events} onEvent={setDetail} onAddAt={(d, h) => openNewBlock(d, h)} />}

      {/* Legenda */}
      <div class="flex flex-wrap gap-4 text-xs text-fg-muted pt-1">
        <span class="flex items-center gap-1.5"><span class="inline-block size-3 rounded" style="background:#1a73e8" /> Reunião de cliente</span>
        <span class="flex items-center gap-1.5"><span class="inline-block size-3 rounded" style="background:#0891b2" /> Atividade do CRM</span>
        <span class="flex items-center gap-1.5"><span class="inline-block size-3 rounded" style="background:#7c3aed" /> Compromisso manual</span>
        <span class="flex items-center gap-1.5"><span class="inline-block size-3 rounded" style="background:#94a3b8" /> Bloqueio (indisponível)</span>
        {googleConnected && <span class="flex items-center gap-1.5"><span class="inline-block size-3 rounded" style="background:#0b8043" /> Google Calendar</span>}
      </div>

      {editingBlock && (
        <BlockModal block={editingBlock} canSeeAll={canSeeAll} agents={agents}
          onClose={() => setEditingBlock(null)} />
      )}
      {detail && (
        <EventDetail event={detail}
          onClose={() => setDetail(null)}
          onEditBlock={(b) => { setDetail(null); setEditingBlock(b) }} />
      )}
    </div>
  )
}

// ───────────────────────── Vista MÊS ─────────────────────────
function MonthGrid({ days, cursor, events, onPick, onEvent, onAdd }: {
  days: Date[]; cursor: Date; events: CalendarEvent[]
  onPick: (d: Date) => void; onEvent: (e: CalendarEvent) => void; onAdd: (d: Date) => void
}) {
  const today = startOfDay(new Date())
  const byDay = useMemo(() => groupByDay(events, days), [events, days])
  return (
    <div class="rounded-lg border border-border overflow-hidden">
      <div class="grid grid-cols-7 bg-surface-2 border-b border-border">
        {WD.map((w) => <div key={w} class="px-2 py-1.5 text-[0.6875rem] font-semibold text-fg-muted uppercase text-center">{w}</div>)}
      </div>
      <div class="grid grid-cols-7">
        {days.map((d) => {
          const list = byDay.get(ymd(d)) ?? []
          const other = d.getMonth() !== cursor.getMonth()
          const isToday = sameDay(d, today)
          return (
            <div key={ymd(d)} class={`min-h-[104px] border-b border-r border-border p-1 ${other ? 'bg-surface-2/40' : 'bg-surface'} group relative`}>
              <div class="flex items-center justify-between px-0.5">
                <button onClick={() => onPick(d)}
                  class={`text-xs font-medium leading-5 w-6 h-6 rounded-full flex items-center justify-center ${isToday ? 'bg-accent text-white' : other ? 'text-fg-subtle' : 'text-fg'} hover:bg-surface-3`}>
                  {d.getDate()}
                </button>
                <button onClick={() => onAdd(d)} class="opacity-0 group-hover:opacity-100 text-fg-muted hover:text-accent" title="Adicionar"><Plus size={13} /></button>
              </div>
              <div class="mt-0.5 space-y-0.5">
                {list.slice(0, 3).map((ev) => (
                  <button key={ev.id} onClick={() => onEvent(ev)}
                    class="block w-full text-left truncate rounded px-1 py-0.5 text-[0.6875rem] text-white"
                    style={`background:${ev.color};${ev.status === 'cancelled' || ev.status === 'no_show' ? 'opacity:.5;text-decoration:line-through' : ''}`}>
                    {ev.allDay ? '' : hm(new Date(ev.startAt)) + ' '}{ev.title}
                  </button>
                ))}
                {list.length > 3 && <button onClick={() => onPick(d)} class="text-[0.625rem] text-accent hover:underline px-1">+{list.length - 3} mais</button>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ───────────────────────── Vista SEMANA / DIA (grade de horas) ─────────────────────────
function TimeGrid({ days, events, onEvent, onAddAt }: {
  days: Date[]; events: CalendarEvent[]
  onEvent: (e: CalendarEvent) => void; onAddAt: (d: Date, h: number) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const today = startOfDay(new Date())
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = DAY_START_HOUR * HOUR_PX }, [])

  const hours = Array.from({ length: 24 }, (_, h) => h)
  const allDayByDay = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>()
    for (const ev of events) if (ev.allDay) {
      const k = ymd(new Date(ev.startAt)); m.set(k, [...(m.get(k) ?? []), ev])
    }
    return m
  }, [events])
  const hasAllDay = allDayByDay.size > 0

  return (
    <div class="rounded-lg border border-border overflow-hidden bg-surface">
      {/* Cabeçalho de dias */}
      <div class="flex border-b border-border">
        <div class="w-14 shrink-0 border-r border-border" />
        {days.map((d) => {
          const isToday = sameDay(d, today)
          return (
            <div key={ymd(d)} class="flex-1 text-center py-2 border-r border-border last:border-r-0">
              <div class="text-[0.6875rem] text-fg-muted uppercase">{wdShort(d.getDay())}</div>
              <div class={`text-sm font-semibold inline-flex items-center justify-center w-7 h-7 rounded-full ${isToday ? 'bg-accent text-white' : 'text-fg'}`}>{d.getDate()}</div>
            </div>
          )
        })}
      </div>

      {/* Faixa "dia inteiro" */}
      {hasAllDay && (
        <div class="flex border-b border-border bg-surface-2/40">
          <div class="w-14 shrink-0 border-r border-border text-[0.625rem] text-fg-subtle px-1 py-1 text-right">dia todo</div>
          {days.map((d) => (
            <div key={ymd(d)} class="flex-1 border-r border-border last:border-r-0 p-1 space-y-0.5 min-h-[28px]">
              {(allDayByDay.get(ymd(d)) ?? []).map((ev) => (
                <button key={ev.id} onClick={() => onEvent(ev)} class="block w-full text-left truncate rounded px-1 py-0.5 text-[0.6875rem] text-white" style={`background:${ev.color}`}>{ev.title}</button>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Grade de horas */}
      <div ref={scrollRef} class="overflow-y-auto" style="max-height:62vh">
        <div class="flex relative" style={`height:${24 * HOUR_PX}px`}>
          {/* Coluna de horas */}
          <div class="w-14 shrink-0 border-r border-border relative">
            {hours.map((h) => (
              <div key={h} class="absolute right-1 -translate-y-1/2 text-[0.625rem] text-fg-subtle" style={`top:${h * HOUR_PX}px`}>{h === 0 ? '' : pad(h) + ':00'}</div>
            ))}
          </div>
          {/* Colunas de dias */}
          {days.map((d) => {
            const dayEvents = events.filter((ev) => !ev.allDay && sameDay(new Date(ev.startAt), d))
            const laid = layoutLanes(dayEvents)
            const now = new Date()
            const showNow = sameDay(d, now)
            return (
              <div key={ymd(d)} class="flex-1 relative border-r border-border last:border-r-0">
                {/* linhas de hora + clique pra adicionar */}
                {hours.map((h) => (
                  <div key={h} class="absolute left-0 right-0 border-t border-border/60 hover:bg-accent/5 cursor-pointer" style={`top:${h * HOUR_PX}px;height:${HOUR_PX}px`} onClick={() => onAddAt(d, h)} title="Adicionar aqui" />
                ))}
                {/* linha do "agora" */}
                {showNow && (
                  <div class="absolute left-0 right-0 z-10 pointer-events-none" style={`top:${(now.getHours() * 60 + now.getMinutes()) / 60 * HOUR_PX}px`}>
                    <div class="h-px bg-red-500" /><div class="absolute -left-1 -top-1 size-2 rounded-full bg-red-500" />
                  </div>
                )}
                {/* eventos */}
                {laid.map(({ ev, lane, lanes }) => {
                  const s = new Date(ev.startAt), e = new Date(ev.endAt)
                  const top = (s.getHours() * 60 + s.getMinutes()) / 60 * HOUR_PX
                  const dur = Math.max(18, (e.getTime() - s.getTime()) / 60000 / 60 * HOUR_PX)
                  const w = 100 / lanes
                  const struck = ev.status === 'cancelled' || ev.status === 'no_show'
                  return (
                    <button key={ev.id} onClick={() => onEvent(ev)}
                      class="absolute rounded-md px-1.5 py-0.5 text-left text-white overflow-hidden border border-white/20 shadow-sm"
                      style={`top:${top}px;height:${dur}px;left:calc(${lane * w}% + 1px);width:calc(${w}% - 2px);background:${ev.color};${struck ? 'opacity:.55' : ''}`}>
                      <div class={`flex items-center gap-1 text-[0.6875rem] font-medium leading-tight ${struck ? 'line-through' : ''}`}>
                        {ev.kind === 'booking' && (ev.status === 'confirmed' || ev.confirmedAt) && <BadgeCheck size={11} class="shrink-0" />}
                        {ev.kind === 'booking' && ev.status !== 'confirmed' && !ev.confirmedAt && ev.confirmRequestedAt && <Clock size={11} class="shrink-0 opacity-80" />}
                        <span class="truncate">{ev.title}</span>
                      </div>
                      <div class="text-[0.625rem] opacity-90 truncate">{hm(s)}–{hm(e)}</div>
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ───────────────────────── Modal de bloqueio/compromisso ─────────────────────────
function BlockModal({ block, canSeeAll, agents, onClose }: {
  block: BlockInput; canSeeAll: boolean
  agents: { id: number; name: string; email: string }[]
  onClose: () => void
}) {
  const save = useSaveBlock()
  const del = useDeleteBlock()
  const [form, setForm] = useState<BlockInput>(block)
  const [confirmDel, setConfirmDel] = useState(false)
  const set = (p: Partial<BlockInput>) => setForm((f) => ({ ...f, ...p }))

  function handleSave() {
    const start = fromLocalInput(form.startAt), end = fromLocalInput(form.endAt)
    if (!start || !end) { toast('Datas inválidas', 'danger'); return }
    if (end <= start && !form.allDay) { toast('Fim deve ser após o início', 'danger'); return }
    const payload: BlockInput = {
      ...(form.id ? { id: form.id } : {}),
      title: form.title ?? '',
      kind: form.kind ?? 'busy',
      startAt: start.toISOString(),
      endAt: (form.allDay ? new Date(startOfDay(end).getTime() + MS_DAY) : end).toISOString(),
      allDay: !!form.allDay,
      ...(form.note ? { note: form.note } : { note: null }),
      ...(canSeeAll && form.operatorUserId != null ? { operatorUserId: form.operatorUserId } : {}),
    }
    save.mutate(payload, {
      onSuccess: () => { toast('Salvo na agenda', 'success'); onClose() },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose() }} size="md"
      title={form.id ? 'Editar compromisso' : 'Novo bloqueio / compromisso'}
      description="Reserva tempo na sua agenda. Bloqueios também removem horários da página pública."
      footer={
        <div class="flex justify-between gap-2 w-full">
          {form.id ? <Button variant="danger" onClick={() => setConfirmDel(true)}><Trash2 size={14} /> Excluir</Button> : <span />}
          <div class="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button onClick={handleSave} disabled={save.isPending}>{save.isPending ? 'Salvando…' : 'Salvar'}</Button>
          </div>
        </div>
      }>
      <div class="space-y-3">
        <div class="grid grid-cols-2 gap-2">
          <Select label="Tipo" value={form.kind ?? 'busy'} onChange={(e) => set({ kind: (e.target as HTMLSelectElement).value as 'busy' | 'event' })}>
            <option value="busy">Bloqueio (indisponível)</option>
            <option value="event">Compromisso</option>
          </Select>
          {canSeeAll && (
            <Select label="Operador" value={form.operatorUserId == null ? '' : String(form.operatorUserId)} onChange={(e) => { const v = (e.target as HTMLSelectElement).value; set({ operatorUserId: v ? Number(v) : null }) }}>
              <option value="">Eu</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name || a.email}</option>)}
            </Select>
          )}
        </div>
        <Input label="Título" value={form.title ?? ''} onInput={(e) => set({ title: (e.target as HTMLInputElement).value })} placeholder={form.kind === 'event' ? 'Ex.: Reunião interna' : 'Ex.: Almoço, Folga'} />
        <label class="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={!!form.allDay} onChange={(e) => set({ allDay: (e.target as HTMLInputElement).checked })} /> Dia inteiro
        </label>
        <div class="grid grid-cols-2 gap-2">
          <Input label="Início" type={form.allDay ? 'date' : 'datetime-local'} value={form.allDay ? form.startAt.slice(0, 10) : form.startAt} onInput={(e) => set({ startAt: (e.target as HTMLInputElement).value + (form.allDay ? 'T00:00' : '') })} />
          {!form.allDay && <Input label="Fim" type="datetime-local" value={form.endAt} onInput={(e) => set({ endAt: (e.target as HTMLInputElement).value })} />}
        </div>
        <Textarea label="Observação (opcional)" rows={2} value={form.note ?? ''} onInput={(e) => set({ note: (e.target as HTMLTextAreaElement).value })} />
      </div>
      <ConfirmDialog open={confirmDel} onOpenChange={setConfirmDel} title="Excluir compromisso?" description="Esta ação não pode ser desfeita." confirmLabel="Excluir" destructive loading={del.isPending}
        onConfirm={() => { if (form.id) del.mutate(form.id, { onSuccess: () => { toast('Excluído', 'success'); onClose() }, onError: (e: unknown) => toast((e as Error).message, 'danger') }) }} />
    </Modal>
  )
}

// ───────────────────────── Detalhe do evento ─────────────────────────
function EventDetail({ event, onClose, onEditBlock }: {
  event: CalendarEvent; onClose: () => void; onEditBlock: (b: BlockInput) => void
}) {
  const upd = useUpdateBookingStatus()
  const s = new Date(event.startAt), e = new Date(event.endAt)
  const when = `${wdFull(s.getDay())}, ${s.getDate()} de ${moName(s.getMonth())} · ${event.allDay ? 'dia inteiro' : `${hm(s)}–${hm(e)}`}`

  function setStatus(status: string, reason?: string) {
    upd.mutate({ id: event.refId, status, ...(reason ? { reason } : {}) }, {
      onSuccess: () => { toast('Reserva atualizada', 'success'); onClose() },
      onError: (err: unknown) => toast((err as Error).message, 'danger'),
    })
  }

  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose() }} size="md"
      title={event.title}
      description={`${KIND_LABEL[event.kind] ?? event.kind} · ${STATUS_LABEL[event.status] ?? event.status}`}>
      <div class="space-y-3 text-sm">
        {event.kind === 'booking' && event.status !== 'cancelled' && event.status !== 'no_show' && (() => {
          const confirmed = event.status === 'confirmed' || !!event.confirmedAt
          if (confirmed) return (
            <div class="inline-flex items-center gap-1.5 rounded-full bg-success/15 text-success px-2.5 py-1 text-xs font-medium">
              <BadgeCheck size={14} /> Confirmada pelo lead
            </div>
          )
          if (event.confirmRequestedAt) return (
            <div class="inline-flex items-center gap-1.5 rounded-full bg-warning/15 text-warning px-2.5 py-1 text-xs font-medium">
              <Clock size={14} /> Aguardando confirmação
            </div>
          )
          return (
            <div class="inline-flex items-center gap-1.5 rounded-full bg-surface-2 text-fg-muted px-2.5 py-1 text-xs font-medium">
              Não confirmada
            </div>
          )
        })()}
        <div class="flex items-center gap-2 text-fg"><Clock size={15} class="text-fg-muted" /> <span class="capitalize">{when}</span></div>
        {event.operatorName && <div class="flex items-center gap-2"><UserIcon size={15} class="text-fg-muted" /> {event.operatorName}</div>}
        {event.meetingTypeName && <div class="flex items-center gap-2"><CalendarDays size={15} class="text-fg-muted" /> {event.meetingTypeName}</div>}
        {event.locationType && <div class="flex items-center gap-2"><MapPin size={15} class="text-fg-muted" /> {LOC_ICON[event.locationType] ?? event.locationType}</div>}
        {event.meetLink && <a href={event.meetLink} target="_blank" rel="noreferrer" class="flex items-center gap-2 text-accent hover:underline"><Video size={15} /> Entrar na reunião</a>}
        {event.kind === 'google' && <div class="text-xs text-fg-subtle">Evento do seu Google Calendar (somente leitura). Esse horário fica indisponível para novos agendamentos.</div>}
        {event.kind === 'google' && event.htmlLink && <a href={event.htmlLink} target="_blank" rel="noreferrer" class="flex items-center gap-2 text-accent hover:underline"><ExternalLink size={15} /> Abrir no Google Calendar</a>}
        {(event.inviteeName || event.inviteeEmail || event.inviteePhone) && (
          <div class="rounded-md bg-surface-2 p-2 space-y-0.5">
            {event.inviteeName && <div class="font-medium">{event.inviteeName}</div>}
            {event.inviteeEmail && <div class="text-fg-muted text-xs">{event.inviteeEmail}</div>}
            {event.inviteePhone && <div class="text-fg-muted text-xs">{event.inviteePhone}</div>}
          </div>
        )}
        {event.note && <div class="rounded-md bg-surface-2 p-2 text-fg-muted whitespace-pre-wrap">{event.note}</div>}

        <div class="flex flex-wrap gap-2 pt-2 border-t border-border">
          {event.leadId && <a href={`/app/leads/${event.leadId}`} class="inline-flex items-center gap-1.5 text-sm text-accent hover:underline"><ExternalLink size={14} /> Abrir lead</a>}
        </div>

        {event.kind === 'booking' && event.status !== 'cancelled' && (
          <div class="flex flex-wrap gap-2 pt-2">
            {event.status !== 'completed' && <Button size="sm" variant="success" class="flex-1 sm:flex-none" onClick={() => setStatus('completed')} disabled={upd.isPending}>Concluída</Button>}
            {event.status !== 'no_show' && <Button size="sm" variant="secondary" class="flex-1 sm:flex-none" onClick={() => setStatus('no_show')} disabled={upd.isPending}><Ban size={14} /> Não compareceu</Button>}
            <Button size="sm" variant="danger" class="flex-1 sm:flex-none" onClick={() => setStatus('cancelled')} disabled={upd.isPending}><X size={14} /> Cancelar</Button>
          </div>
        )}
        {event.kind === 'block' && (
          <div class="flex gap-2 pt-2">
            <Button size="sm" variant="secondary" class="flex-1 sm:flex-none" onClick={() => onEditBlock({
              id: event.refId, title: event.title, kind: event.blockKind ?? 'busy',
              startAt: event.allDay ? ymd(s) + 'T00:00' : toLocalInput(s), endAt: toLocalInput(e), allDay: event.allDay,
              ...(event.note ? { note: event.note } : {}),
              ...(event.operatorUserId != null ? { operatorUserId: event.operatorUserId } : {}),
            })}>Editar</Button>
          </div>
        )}
      </div>
    </Modal>
  )
}

// ───────────────────────── utils ─────────────────────────
// 'YYYY-MM-DDTHH:mm' em hora local (para inputs datetime-local).
function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function fromLocalInput(v: string): Date | null {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

function groupByDay(events: CalendarEvent[], days: Date[]): Map<string, CalendarEvent[]> {
  const m = new Map<string, CalendarEvent[]>()
  for (const d of days) m.set(ymd(d), [])
  for (const ev of events) {
    const k = ymd(new Date(ev.startAt))
    if (m.has(k)) m.get(k)!.push(ev)
  }
  for (const arr of m.values()) arr.sort((a, b) => (a.allDay ? -1 : 0) - (b.allDay ? -1 : 0) || a.startAt.localeCompare(b.startAt))
  return m
}

// Empacota eventos sobrepostos em "lanes" (colunas lado a lado).
function layoutLanes(events: CalendarEvent[]): { ev: CalendarEvent; lane: number; lanes: number }[] {
  const sorted = [...events].sort((a, b) => a.startAt.localeCompare(b.startAt))
  // agrupa em clusters de eventos que se sobrepõem em cadeia
  const out: { ev: CalendarEvent; lane: number; lanes: number }[] = []
  let cluster: CalendarEvent[] = []
  let clusterEnd = 0
  const flush = () => {
    if (!cluster.length) return
    const laneEnds: number[] = []
    const placed: { ev: CalendarEvent; lane: number }[] = []
    for (const ev of cluster) {
      const st = new Date(ev.startAt).getTime()
      let lane = laneEnds.findIndex((end) => end <= st)
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(0) }
      laneEnds[lane] = new Date(ev.endAt).getTime()
      placed.push({ ev, lane })
    }
    const lanes = laneEnds.length
    for (const p of placed) out.push({ ...p, lanes })
    cluster = []
  }
  for (const ev of sorted) {
    const st = new Date(ev.startAt).getTime()
    if (cluster.length && st >= clusterEnd) flush()
    cluster.push(ev)
    clusterEnd = Math.max(clusterEnd, new Date(ev.endAt).getTime())
    if (cluster.length === 1) clusterEnd = new Date(ev.endAt).getTime()
  }
  flush()
  return out
}
