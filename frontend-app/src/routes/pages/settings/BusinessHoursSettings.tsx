import { useEffect, useState } from 'preact/hooks'
import { Save } from '@/components/ui/icon-set'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { toast } from '@/lib/toast'

interface Slot { start: string; end: string }
interface BusinessHoursConfig {
  enabled: boolean
  timezone: string
  schedule: Record<string, Slot[] | null>
  message: string
  throttleHours: number
}

const DAYS: { idx: string; label: string }[] = [
  { idx: '1', label: 'Segunda' },
  { idx: '2', label: 'Terça' },
  { idx: '3', label: 'Quarta' },
  { idx: '4', label: 'Quinta' },
  { idx: '5', label: 'Sexta' },
  { idx: '6', label: 'Sábado' },
  { idx: '0', label: 'Domingo' },
]

const TIMEZONES = [
  'America/Sao_Paulo',
  'America/Manaus',
  'America/Cuiaba',
  'America/Belem',
  'America/Fortaleza',
  'America/Recife',
  'America/Bahia',
  'America/Maceio',
  'America/Rio_Branco',
  'America/Noronha',
]

interface DayState { enabled: boolean; start: string; end: string }

function useBusinessHours() {
  return useQuery({
    queryKey: ['business-hours'],
    queryFn: () => api.get<{ config: BusinessHoursConfig }>('/admin/business-hours'),
    staleTime: 60_000,
  })
}

function useSaveBusinessHours() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (config: BusinessHoursConfig) =>
      api.put<{ ok: true }>('/admin/business-hours', config),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['business-hours'] }) },
  })
}

export function BusinessHoursSettings() {
  const { data, isLoading, isError } = useBusinessHours()
  const save = useSaveBusinessHours()

  const [enabled, setEnabled] = useState(false)
  const [timezone, setTimezone] = useState('America/Sao_Paulo')
  const [days, setDays] = useState<Record<string, DayState>>({})
  const [message, setMessage] = useState('')
  const [throttleHours, setThrottleHours] = useState(12)
  const [saveMsg, setSaveMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => {
    if (!data) return
    const c = data.config
    setEnabled(!!c.enabled)
    setTimezone(c.timezone || 'America/Sao_Paulo')
    const next: Record<string, DayState> = {}
    for (const d of DAYS) {
      const slots = c.schedule?.[d.idx]
      const firstSlot = slots && slots.length > 0 ? slots[0] : null
      const slot = firstSlot ?? { start: '09:00', end: '18:00' }
      next[d.idx] = { enabled: !!firstSlot, start: slot.start, end: slot.end }
    }
    setDays(next)
    setMessage(c.message ?? '')
    setThrottleHours(typeof c.throttleHours === 'number' ? c.throttleHours : 12)
  }, [data])

  function patchDay(idx: string, patch: Partial<DayState>) {
    setDays((s) => ({ ...s, [idx]: { ...(s[idx] ?? { enabled: false, start: '09:00', end: '18:00' }), ...patch } }))
  }

  function handleSave() {
    setSaveMsg(null)
    const schedule: Record<string, Slot[] | null> = {}
    for (const d of DAYS) {
      const ds = days[d.idx]
      if (!ds?.enabled) {
        schedule[d.idx] = null
      } else {
        const start = ds.start || '09:00'
        const end = ds.end || '18:00'
        if (start >= end) {
          setSaveMsg({ kind: 'err', text: `${d.label}: hora final precisa ser depois da inicial` })
          return
        }
        schedule[d.idx] = [{ start, end }]
      }
    }

    setSaveMsg({ kind: 'ok', text: 'Salvando…' })
    save.mutate({
      enabled,
      timezone,
      schedule,
      message,
      throttleHours,
    }, {
      onSuccess: () => {
        setSaveMsg({ kind: 'ok', text: '✓ Salvo' })
        toast('Horário de atendimento salvo', 'success')
      },
      onError: (e: unknown) => {
        const text = (e as Error).message || 'Erro ao salvar'
        setSaveMsg({ kind: 'err', text })
        toast(text, 'danger')
      },
    })
  }

  if (isLoading) return <Skeleton class="h-96 w-full" />
  if (isError) return <div class="text-sm text-danger">Erro ao carregar configuração.</div>

  return (
    <div class="space-y-4">
      <div>
        <h2 class="text-base font-semibold text-fg">Horário de Atendimento</h2>
        <p class="text-xs text-fg-muted mt-0.5">
          Configure dias/horários de expediente e a mensagem automática enviada ao lead que escreve fora desse período.
        </p>
      </div>

      {/* ── Card 1: Geral ── */}
      <section class="rounded-lg border border-border bg-surface-2 overflow-hidden">
        <div class="px-4 py-2 border-b border-border bg-surface">
          <div class="text-sm font-semibold text-fg">Geral</div>
        </div>
        <div class="p-4 grid gap-3.5">
          <label class="flex items-center gap-2.5 cursor-pointer text-sm font-medium text-fg">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled((e.target as HTMLInputElement).checked)}
            />
            Ativar auto-resposta fora do horário
          </label>
          <div class="text-2xs text-fg-muted -mt-2 ml-6">
            Quando desativado, nenhuma mensagem automática é enviada — leads chegam normalmente em qualquer horário.
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            <div>
              <label class="text-2xs font-medium text-fg-muted block mb-1">Fuso horário</label>
              <select
                value={timezone}
                onChange={(e) => setTimezone((e.target as HTMLSelectElement).value)}
                class="w-full h-9 px-3 rounded-md bg-surface border border-border text-sm text-fg focus:outline-none focus:border-accent"
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>{tz.replace('America/', '')}</option>
                ))}
              </select>
            </div>
            <div>
              <label class="text-2xs font-medium text-fg-muted block mb-1">
                Não reenviar pra mesmo lead nas próximas (h)
              </label>
              <input
                type="number"
                min={0}
                max={168}
                value={String(throttleHours)}
                onInput={(e) => setThrottleHours(Number((e.target as HTMLInputElement).value))}
                class="w-full h-9 px-3 rounded-md bg-surface border border-border text-sm text-fg focus:outline-none focus:border-accent"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ── Card 2: Dias e horários do expediente ── */}
      <section class="rounded-lg border border-border bg-surface-2 overflow-hidden">
        <div class="px-4 py-2 border-b border-border bg-surface">
          <div class="text-sm font-semibold text-fg">Dias e horários do expediente</div>
        </div>
        <div class="p-4">
          <div class="grid grid-cols-[120px_80px_1fr_1fr] gap-3 text-2xs text-fg-muted font-medium uppercase tracking-wider pb-1.5 border-b border-border">
            <div>Dia</div>
            <div>Aberto?</div>
            <div>Início</div>
            <div>Fim</div>
          </div>
          {DAYS.map((d) => {
            const ds = days[d.idx] ?? { enabled: false, start: '09:00', end: '18:00' }
            return (
              <div key={d.idx} class="grid grid-cols-[120px_80px_1fr_1fr] gap-3 items-center py-2 border-b border-border last:border-0">
                <div class="text-sm font-medium text-fg">{d.label}</div>
                <label class="flex items-center gap-1.5 text-xs text-fg cursor-pointer">
                  <input
                    type="checkbox"
                    checked={ds.enabled}
                    onChange={(e) => patchDay(d.idx, { enabled: (e.target as HTMLInputElement).checked })}
                  />
                  Aberto
                </label>
                <input
                  type="time"
                  value={ds.start}
                  disabled={!ds.enabled}
                  onInput={(e) => patchDay(d.idx, { start: (e.target as HTMLInputElement).value })}
                  class="w-full h-9 px-3 rounded-md bg-surface border border-border text-sm text-fg disabled:opacity-50 focus:outline-none focus:border-accent"
                />
                <input
                  type="time"
                  value={ds.end}
                  disabled={!ds.enabled}
                  onInput={(e) => patchDay(d.idx, { end: (e.target as HTMLInputElement).value })}
                  class="w-full h-9 px-3 rounded-md bg-surface border border-border text-sm text-fg disabled:opacity-50 focus:outline-none focus:border-accent"
                />
              </div>
            )
          })}
        </div>
      </section>

      {/* ── Card 3: Mensagem automática ── */}
      <section class="rounded-lg border border-border bg-surface-2 overflow-hidden">
        <div class="px-4 py-2 border-b border-border bg-surface">
          <div class="text-sm font-semibold text-fg">Mensagem automática</div>
        </div>
        <div class="p-4">
          <div class="text-2xs text-fg-muted mb-1.5">
            Enviada via WhatsApp quando lead escreve fora do horário (e nenhum chatbot está vinculado à instância)
          </div>
          <textarea
            value={message}
            onInput={(e) => setMessage((e.target as HTMLTextAreaElement).value)}
            rows={4}
            class="w-full px-3 py-2 rounded-md bg-surface border border-border text-sm text-fg focus:outline-none focus:border-accent resize-y"
          />
        </div>
      </section>

      <div class="flex items-center gap-3">
        <Button variant="primary" size="md" onClick={handleSave} disabled={save.isPending}>
          <Save size={14} /> Salvar
        </Button>
        {saveMsg && (
          <span class={`text-xs ${saveMsg.kind === 'ok' ? 'text-accent' : 'text-danger'}`}>
            {saveMsg.text}
          </span>
        )}
      </div>
    </div>
  )
}
