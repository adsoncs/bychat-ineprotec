// Editor de disponibilidade de um tipo de reunião: horários semanais + exceções,
// com preview dos próximos slots. Fase 2 do módulo de Agendamento.
import { useEffect, useState } from 'preact/hooks'
import { Plus, X, Trash2 } from '@/components/ui/icon-set'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { toast } from '@/lib/toast'
import {
  useAvailability, useSaveAvailability, useSlotsPreview,
  useMyAvailability, useSaveMyAvailability,
  useUserAvailability, useSaveUserAvailability,
  WEEKDAY_LABELS, type WeeklyRule, type AvailabilityException,
} from '@/hooks/useScheduling'

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] // Seg..Dom

// Três modos, mesmo formulário:
//   • `mine`        — a própria agenda do operador logado;
//   • `userId`      — a agenda de OUTRO operador (gerente/admin cuidando da equipe);
//   • `meetingTypeId` — a agenda específica de um tipo de reunião.
export function AvailabilityModal({ meetingTypeId, meetingTypeName, mine, userId, userName, onClose }: {
  meetingTypeId?: number
  meetingTypeName?: string
  mine?: boolean
  userId?: number
  userName?: string
  onClose: () => void
}) {
  const forUser = typeof userId === 'number' ? userId : null
  const isMine = !!mine && !forUser
  const isPersonal = isMine || !!forUser
  const typeAvail = useAvailability(isPersonal ? null : (meetingTypeId ?? null))
  const myAvail = useMyAvailability(isMine)
  const userAvail = useUserAvailability(forUser)
  const saveType = useSaveAvailability(meetingTypeId ?? 0)
  const saveMine = useSaveMyAvailability()
  const saveUser = useSaveUserAvailability(forUser)
  const data = forUser ? userAvail.data : isMine ? myAvail.data : typeAvail.data
  const isLoading = forUser ? userAvail.isLoading : isMine ? myAvail.isLoading : typeAvail.isLoading
  const save = forUser ? saveUser : isMine ? saveMine : saveType
  const targetLabel = userName || userAvail.data?.user?.name || userAvail.data?.user?.email || 'operador'
  const [rules, setRules] = useState<WeeklyRule[]>([])
  const [exceptions, setExceptions] = useState<AvailabilityException[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (data && !loaded) {
      setRules(data.rules || [])
      setExceptions(data.exceptions || [])
      setLoaded(true)
    }
  }, [data, loaded])

  const slots = useSlotsPreview(!isPersonal && loaded ? (meetingTypeId ?? null) : null)

  function addRange(weekday: number) { setRules((r) => [...r, { weekday, start: '09:00', end: '18:00' }]) }
  function updateRange(idx: number, patch: Partial<WeeklyRule>) { setRules((r) => r.map((x, i) => (i === idx ? { ...x, ...patch } : x))) }
  function removeRange(idx: number) { setRules((r) => r.filter((_, i) => i !== idx)) }

  function addException() {
    const today = new Date().toISOString().slice(0, 10)
    setExceptions((e) => [...e, { date: today, unavailable: true }])
  }
  function updateException(idx: number, patch: Partial<AvailabilityException>) { setExceptions((e) => e.map((x, i) => (i === idx ? { ...x, ...patch } : x))) }
  function removeException(idx: number) { setExceptions((e) => e.filter((_, i) => i !== idx)) }

  function handleSave() {
    const onDone = {
      onSuccess: () => toast('Disponibilidade salva', 'success'),
      onError: (err: unknown) => toast((err as Error).message, 'danger'),
    }
    const personalInput = { rules, exceptions, ...(data?.timezone ? { timezone: data.timezone } : {}) }
    if (forUser) saveUser.mutate(personalInput, onDone)
    else if (isMine) saveMine.mutate(personalInput, onDone)
    else saveType.mutate({ rules, exceptions }, onDone)
  }

  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose() }} size="lg"
      title={forUser ? `Disponibilidade — ${targetLabel}` : isMine ? 'Minha disponibilidade' : `Disponibilidade — ${meetingTypeName}`}
      description={
        forUser
          ? 'Horários em que este operador pode receber reuniões. É a mesma agenda que ele vê em "Minha disponibilidade" — a alteração fica registrada no histórico dele.'
          : isMine
            ? 'Seus horários de atendimento. Os tipos de reunião usam esta agenda por padrão.'
            : 'Horários específicos deste tipo (sobrepõem a sua agenda padrão).'
      }
      footer={
        <div class="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Fechar</Button>
          <Button onClick={handleSave} disabled={save.isPending}>{save.isPending ? 'Salvando…' : 'Salvar disponibilidade'}</Button>
        </div>
      }
    >
      {isLoading ? <div class="text-sm text-fg-muted">Carregando…</div> : (
        <div class="space-y-4">
          {/* Horários semanais */}
          <div>
            <div class="text-2xs font-semibold text-fg-muted uppercase tracking-wider mb-2">Horários da semana</div>
            <div class="space-y-2">
              {WEEK_ORDER.map((wd) => {
                const dayRules = rules.map((r, i) => ({ r, i })).filter((x) => x.r.weekday === wd)
                return (
                  <div key={wd} class="flex items-start gap-3">
                    <div class="w-10 text-sm font-medium text-fg pt-1.5">{WEEKDAY_LABELS[wd]}</div>
                    <div class="flex-1 space-y-1.5">
                      {dayRules.length === 0 && <div class="text-xs text-fg-muted pt-1.5">Indisponível</div>}
                      {dayRules.map(({ r, i }) => (
                        <div key={i} class="flex items-center gap-1.5">
                          <input type="time" value={r.start} onInput={(e) => updateRange(i, { start: (e.target as HTMLInputElement).value })}
                            class="h-8 px-2 rounded-md bg-surface border border-border text-xs text-fg" />
                          <span class="text-fg-muted text-xs">até</span>
                          <input type="time" value={r.end} onInput={(e) => updateRange(i, { end: (e.target as HTMLInputElement).value })}
                            class="h-8 px-2 rounded-md bg-surface border border-border text-xs text-fg" />
                          <button class="p-1 text-fg-muted hover:text-danger" onClick={() => removeRange(i)} title="Remover"><X size={14} /></button>
                        </div>
                      ))}
                    </div>
                    <button class="text-xs text-accent hover:underline pt-1.5 shrink-0" onClick={() => addRange(wd)}>+ horário</button>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Exceções */}
          <div class="pt-3 border-t border-border">
            <div class="flex items-center justify-between mb-2">
              <span class="text-2xs font-semibold text-fg-muted uppercase tracking-wider">Exceções (feriados / dias especiais)</span>
              <button class="text-xs text-accent hover:underline" onClick={addException}><Plus size={12} class="inline" /> adicionar</button>
            </div>
            {exceptions.length === 0 ? <div class="text-xs text-fg-muted">Nenhuma exceção.</div> : (
              <div class="space-y-1.5">
                {exceptions.map((ex, i) => (
                  <div key={i} class="flex items-center gap-2 flex-wrap">
                    <input type="date" value={ex.date} onInput={(e) => updateException(i, { date: (e.target as HTMLInputElement).value })}
                      class="h-8 px-2 rounded-md bg-surface border border-border text-xs text-fg" />
                    <label class="flex items-center gap-1 text-xs cursor-pointer">
                      <input type="checkbox" checked={ex.unavailable} onChange={(e) => updateException(i, { unavailable: (e.target as HTMLInputElement).checked })} /> Bloqueado
                    </label>
                    {!ex.unavailable && (
                      <>
                        <input type="time" value={ex.startTime || '09:00'} onInput={(e) => updateException(i, { startTime: (e.target as HTMLInputElement).value })} class="h-8 px-2 rounded-md bg-surface border border-border text-xs text-fg" />
                        <span class="text-fg-muted text-xs">até</span>
                        <input type="time" value={ex.endTime || '18:00'} onInput={(e) => updateException(i, { endTime: (e.target as HTMLInputElement).value })} class="h-8 px-2 rounded-md bg-surface border border-border text-xs text-fg" />
                      </>
                    )}
                    <button class="p-1 text-fg-muted hover:text-danger ml-auto" onClick={() => removeException(i)}><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Preview de slots (só no modo por-tipo) */}
          {!isPersonal && (
          <div class="pt-3 border-t border-border">
            <div class="text-2xs font-semibold text-fg-muted uppercase tracking-wider mb-2">Próximos horários disponíveis (preview)</div>
            {slots.isLoading ? <div class="text-xs text-fg-muted">Calculando…</div> : (slots.data?.days?.length ? (
              <div class="flex gap-3 overflow-x-auto pb-1">
                {slots.data.days.slice(0, 7).map((d) => (
                  <div key={d.date} class="shrink-0 w-28">
                    <div class="text-2xs font-medium text-fg-muted mb-1">{WEEKDAY_LABELS[d.weekday]} {d.date.slice(8, 10)}/{d.date.slice(5, 7)}</div>
                    <div class="flex flex-col gap-1">
                      {d.slots.slice(0, 6).map((s) => <span key={s.startAt} class="text-xs px-1.5 py-0.5 rounded bg-accent/10 text-accent text-center">{s.label}</span>)}
                      {d.slots.length > 6 && <span class="text-3xs text-fg-muted text-center">+{d.slots.length - 6}</span>}
                    </div>
                  </div>
                ))}
              </div>
            ) : <div class="text-xs text-fg-muted">Nenhum horário disponível com as regras atuais. Salve a disponibilidade e ajuste se necessário.</div>)}
            <p class="text-3xs text-fg-muted mt-1">O preview reflete a disponibilidade salva. Salve para atualizar.</p>
          </div>
          )}
        </div>
      )}
    </Modal>
  )
}
