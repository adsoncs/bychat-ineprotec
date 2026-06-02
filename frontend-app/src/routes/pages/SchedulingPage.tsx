// Módulo de Agendamento — Fase 1: CRUD de Tipos de Reunião.
import { useState } from 'preact/hooks'
import { Plus, Pencil, Trash2, CalendarRange, Clock, MapPin, User } from 'lucide-preact'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { AvailabilityModal } from '@/components/scheduling/AvailabilityModal'
import { toast } from '@/lib/toast'
import { useFunnels, useStages } from '@/hooks/useFunnels'
import { useAgents } from '@/hooks/useRouting'
import {
  useMeetingTypes, useSaveMeetingType, useDeleteMeetingType, useGoogleConnectedOperators,
  LOCATION_LABELS, type MeetingType, type MeetingTypeInput,
} from '@/hooks/useScheduling'
import { CalendarPanel } from './SchedulingCalendarPage'

const emptyForm: MeetingTypeInput = {
  name: '', description: '', color: '#1a73e8', active: true,
  durationMin: 30, slotIncrementMin: 30, bufferBeforeMin: 0, bufferAfterMin: 0,
  minNoticeMin: 240, bookingWindowDays: 60, maxPerDay: null, visibleSlotsPerDay: null,
  timezone: 'America/Sao_Paulo', locationType: 'google_meet', locationDetail: '',
  ownerUserId: null, funnelId: null, stageKey: null,
}

// Casca da Agenda: um único item de menu com abas internas (Calendário | Tipos de reunião).
export function SchedulingPage() {
  const [tab, setTab] = useState<'calendar' | 'types'>('calendar')
  return (
    <div class="p-6 space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h1 class="text-xl font-semibold flex items-center gap-2"><CalendarRange size={20} /> Agenda</h1>
        <div class="inline-flex rounded-lg border border-border overflow-hidden">
          <button onClick={() => setTab('calendar')} class={`px-3 py-1.5 text-sm ${tab === 'calendar' ? 'bg-accent text-white' : 'bg-surface text-fg-muted hover:bg-surface-2'}`}>Calendário</button>
          <button onClick={() => setTab('types')} class={`px-3 py-1.5 text-sm ${tab === 'types' ? 'bg-accent text-white' : 'bg-surface text-fg-muted hover:bg-surface-2'}`}>Tipos de reunião</button>
        </div>
      </div>
      {tab === 'calendar' ? <CalendarPanel /> : <MeetingTypesPanel />}
    </div>
  )
}

export function MeetingTypesPanel() {
  const { data, isLoading } = useMeetingTypes()
  const save = useSaveMeetingType()
  const del = useDeleteMeetingType()
  const items = data?.items ?? []

  const [editing, setEditing] = useState<MeetingTypeInput | null>(null)
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [availFor, setAvailFor] = useState<MeetingType | null>(null)
  const [myAvailOpen, setMyAvailOpen] = useState(false)

  function openNew() { setEditing({ ...emptyForm }) }
  function openEdit(m: MeetingType) { setEditing({ ...m }) }

  function handleSave() {
    if (!editing?.name?.trim()) { toast('Dê um nome ao tipo de reunião', 'danger'); return }
    save.mutate(editing, {
      onSuccess: () => { toast('Tipo de reunião salvo', 'success'); setEditing(null) },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function confirmDelete() {
    if (deleteId == null) return
    del.mutate(deleteId, {
      onSuccess: () => { toast('Tipo excluído', 'success'); setDeleteId(null) },
      onError: (e: unknown) => { toast((e as Error).message, 'danger'); setDeleteId(null) },
    })
  }

  return (
    <div class="space-y-4">
      <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p class="text-sm text-fg-muted">Tipos de reunião e regras de disponibilidade.</p>
        <div class="flex items-center gap-2">
          <Button variant="secondary" class="flex-1 whitespace-nowrap sm:flex-none" onClick={() => setMyAvailOpen(true)}><Clock size={14} /> Minha disponibilidade</Button>
          <Button class="flex-1 whitespace-nowrap sm:flex-none" onClick={openNew}><Plus size={14} /> Novo tipo</Button>
        </div>
      </div>

      {isLoading ? (
        <Card class="p-6 text-sm text-fg-muted">Carregando…</Card>
      ) : items.length === 0 ? (
        <Card class="p-8 text-center text-sm text-fg-muted">
          Nenhum tipo de reunião ainda. Crie o primeiro pra começar a receber agendamentos.
        </Card>
      ) : (
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((m) => (
            <Card key={m.id} class="p-4">
              <div class="flex items-start justify-between gap-2">
                <div class="flex items-center gap-2 min-w-0">
                  <span class="size-3 rounded-full shrink-0" style={{ background: m.color || '#1a73e8' }} />
                  <div class="min-w-0">
                    <div class="font-semibold truncate">{m.name}</div>
                    <div class="text-[0.6875rem] text-fg-subtle truncate">/agendar/{m.slug}</div>
                  </div>
                </div>
                <div class="flex items-center gap-1 shrink-0">
                  {!m.active && <span class="text-[0.625rem] px-1.5 py-0.5 rounded-full bg-surface-3 text-fg-muted">inativo</span>}
                  <button class="p-1 text-fg-muted hover:text-accent" title="Disponibilidade" onClick={() => setAvailFor(m)}><Clock size={14} /></button>
                  <button class="p-1 text-fg-muted hover:text-fg" title="Editar" onClick={() => openEdit(m)}><Pencil size={14} /></button>
                  <button class="p-1 text-fg-muted hover:text-danger" title="Excluir" onClick={() => setDeleteId(m.id)}><Trash2 size={14} /></button>
                </div>
              </div>
              <div class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
                <span class="inline-flex items-center gap-1"><Clock size={12} /> {m.durationMin} min</span>
                <span class="inline-flex items-center gap-1"><MapPin size={12} /> {LOCATION_LABELS[m.locationType] ?? m.locationType}</span>
                <span class="inline-flex items-center gap-1"><User size={12} /> {m.ownerUserId ? 'dono definido' : 'sem dono'}</span>
                <span>{m.totalBookings} reserva(s)</span>
              </div>
            </Card>
          ))}
        </div>
      )}

      {editing && (
        <MeetingTypeEditor
          form={editing}
          onChange={setEditing}
          onClose={() => setEditing(null)}
          onSave={handleSave}
          saving={save.isPending}
        />
      )}

      {availFor && (
        <AvailabilityModal meetingTypeId={availFor.id} meetingTypeName={availFor.name} onClose={() => setAvailFor(null)} />
      )}
      {myAvailOpen && (
        <AvailabilityModal mine onClose={() => setMyAvailOpen(false)} />
      )}

      <ConfirmDialog
        open={deleteId != null}
        onOpenChange={(o) => { if (!o) setDeleteId(null) }}
        title="Excluir tipo de reunião?"
        description="Essa ação não pode ser desfeita. Tipos com reservas não podem ser excluídos (desative)."
        confirmLabel="Excluir"
        destructive
        onConfirm={confirmDelete}
      />
    </div>
  )
}

function MeetingTypeEditor({ form, onChange, onClose, onSave, saving }: {
  form: MeetingTypeInput
  onChange: (f: MeetingTypeInput) => void
  onClose: () => void
  onSave: () => void
  saving: boolean
}) {
  const { data: funnelsData } = useFunnels()
  const { data: stagesData } = useStages(form.funnelId ?? null)
  const { data: agentsData } = useAgents()
  const { data: googleOpsData } = useGoogleConnectedOperators()
  const set = (patch: Partial<MeetingTypeInput>) => onChange({ ...form, ...patch })
  // Aviso de sincronização: o dono precisa ter o Google Calendar conectado, senão
  // os agendamentos não vão pro Google nem bloqueiam pela agenda dele.
  const connectedOps = googleOpsData?.connectedUserIds ?? []
  const ownerMissingGoogle = form.ownerUserId != null && googleOpsData != null && !connectedOps.includes(form.ownerUserId)
  const ownerUnset = form.ownerUserId == null
  const numInput = (v: string): number | null => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null }

  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose() }} size="lg"
      title={form.id ? 'Editar tipo de reunião' : 'Novo tipo de reunião'}
      footer={
        <div class="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={onSave} disabled={saving}>{saving ? 'Salvando…' : 'Salvar'}</Button>
        </div>
      }
    >
      <div class="space-y-4">
        <div class="grid gap-3 sm:grid-cols-2">
          <Input label="Nome" value={form.name ?? ''} onInput={(e) => set({ name: (e.target as HTMLInputElement).value })} placeholder="Ex.: Reunião de diagnóstico" />
          <div class="flex items-end gap-2">
            <Input label="Cor" type="color" value={form.color ?? '#1a73e8'} onInput={(e) => set({ color: (e.target as HTMLInputElement).value })} class="w-20" />
            <label class="flex items-center gap-2 text-sm pb-2 cursor-pointer">
              <input type="checkbox" checked={!!form.active} onChange={(e) => set({ active: (e.target as HTMLInputElement).checked })} /> Ativo
            </label>
          </div>
        </div>
        <Textarea label="Descrição" value={form.description ?? ''} onInput={(e) => set({ description: (e.target as HTMLTextAreaElement).value })} placeholder="Aparece na página pública de agendamento" />

        {/* Regras de tempo */}
        <div class="pt-2 border-t border-border">
          <div class="text-[0.6875rem] font-semibold text-fg-muted uppercase tracking-wider mb-2">Duração & slots</div>
          <div class="grid gap-3 sm:grid-cols-3">
            <Input label="Duração (min)" type="number" value={String(form.durationMin ?? 30)} onInput={(e) => set({ durationMin: numInput((e.target as HTMLInputElement).value) ?? 30 })} />
            <Input label="Intervalo entre slots (min)" type="number" value={String(form.slotIncrementMin ?? 30)} onInput={(e) => set({ slotIncrementMin: numInput((e.target as HTMLInputElement).value) ?? 30 })} />
            <Input label="Fuso horário" value={form.timezone ?? 'America/Sao_Paulo'} onInput={(e) => set({ timezone: (e.target as HTMLInputElement).value })} />
            <Input label="Buffer antes (min)" type="number" value={String(form.bufferBeforeMin ?? 0)} onInput={(e) => set({ bufferBeforeMin: numInput((e.target as HTMLInputElement).value) ?? 0 })} />
            <Input label="Buffer depois (min)" type="number" value={String(form.bufferAfterMin ?? 0)} onInput={(e) => set({ bufferAfterMin: numInput((e.target as HTMLInputElement).value) ?? 0 })} />
          </div>
        </div>

        {/* Regras de reserva */}
        <div class="pt-2 border-t border-border">
          <div class="text-[0.6875rem] font-semibold text-fg-muted uppercase tracking-wider mb-2">Regras de reserva</div>
          <div class="grid gap-3 sm:grid-cols-2">
            <Input label="Antecedência mínima (horas)" type="number" value={String(Math.round((form.minNoticeMin ?? 240) / 60))} onInput={(e) => set({ minNoticeMin: (numInput((e.target as HTMLInputElement).value) ?? 4) * 60 })} hint="Quanto antes do horário o lead ainda pode reservar" />
            <Input label="Janela de reserva (dias)" type="number" value={String(form.bookingWindowDays ?? 60)} onInput={(e) => set({ bookingWindowDays: numInput((e.target as HTMLInputElement).value) ?? 60 })} hint="Até quantos dias à frente pode agendar" />
            <Input label="Máx. de reservas por dia" type="number" value={form.maxPerDay == null ? '' : String(form.maxPerDay)} onInput={(e) => set({ maxPerDay: numInput((e.target as HTMLInputElement).value) })} placeholder="sem limite" />
            <Input label="Slots visíveis por dia" type="number" value={form.visibleSlotsPerDay == null ? '' : String(form.visibleSlotsPerDay)} onInput={(e) => set({ visibleSlotsPerDay: numInput((e.target as HTMLInputElement).value) })} placeholder="todos" />
          </div>
        </div>

        {/* Local + dono */}
        <div class="pt-2 border-t border-border">
          <div class="text-[0.6875rem] font-semibold text-fg-muted uppercase tracking-wider mb-2">Local & responsável</div>
          <div class="grid gap-3 sm:grid-cols-2">
            <Select label="Local" value={form.locationType ?? 'google_meet'} onChange={(e) => set({ locationType: (e.target as HTMLSelectElement).value })}>
              {Object.entries(LOCATION_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
            {(form.locationType === 'in_person' || form.locationType === 'custom') && (
              <Input label={form.locationType === 'in_person' ? 'Endereço' : 'Link'} value={form.locationDetail ?? ''} onInput={(e) => set({ locationDetail: (e.target as HTMLInputElement).value })} />
            )}
            <Select label="Dono (operador)" value={form.ownerUserId == null ? '' : String(form.ownerUserId)} onChange={(e) => set({ ownerUserId: numInput((e.target as HTMLSelectElement).value) })}>
              <option value="">— selecione —</option>
              {(agentsData?.agents ?? []).filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name || a.email}</option>)}
            </Select>
          </div>
          {(ownerMissingGoogle || ownerUnset) && (
            <div class="mt-2 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
              <span aria-hidden>⚠️</span>
              <span>
                {ownerUnset
                  ? 'Sem dono definido: os agendamentos não terão agenda Google para sincronizar (não criam evento nem bloqueiam horários).'
                  : 'Este operador ainda não conectou o Google Calendar. Os agendamentos deste tipo não vão para o Google nem bloqueiam horários pela agenda dele até ele conectar em Agenda → Conectar Google (ou Configurações › conta Google).'}
              </span>
            </div>
          )}
        </div>

        {/* CRM: funil + etapa */}
        <div class="pt-2 border-t border-border">
          <div class="text-[0.6875rem] font-semibold text-fg-muted uppercase tracking-wider mb-2">Integração com o funil (ao agendar)</div>
          <div class="grid gap-3 sm:grid-cols-2">
            <Select label="Funil" value={form.funnelId == null ? '' : String(form.funnelId)} onChange={(e) => set({ funnelId: numInput((e.target as HTMLSelectElement).value), stageKey: null })}>
              <option value="">— nenhum —</option>
              {(funnelsData?.funnels ?? []).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </Select>
            <Select label="Etapa ao agendar" value={form.stageKey ?? ''} onChange={(e) => set({ stageKey: (e.target as HTMLSelectElement).value || null })} disabled={!form.funnelId}>
              <option value="">— manter etapa —</option>
              {(stagesData?.stages ?? []).filter((s) => s.active).map((s) => <option key={s.id} value={s.key}>{s.name}</option>)}
            </Select>
          </div>
        </div>

        {form.id && (
          <p class="text-[0.6875rem] text-fg-subtle">URL pública (Fase 3): <code>/agendar/{(form as MeetingType).slug}</code></p>
        )}
      </div>
    </Modal>
  )
}
