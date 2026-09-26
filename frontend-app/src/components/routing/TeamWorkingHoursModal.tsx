import { useEffect, useState } from 'preact/hooks'
import { Trash2, Plus } from '@/components/ui/icon-set'
import { Modal } from '@/components/ui/Modal'
import { Input, Select } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { toast } from '@/lib/toast'
import { ApiError } from '@/lib/apiClient'
import {
  useTeamWorkingHours, useSaveTeamWorkingHours,
  type WorkingHourEntry,
} from '@/hooks/useRouting'

const WEEKDAYS = [
  { value: 0, label: 'Domingo' },
  { value: 1, label: 'Segunda' },
  { value: 2, label: 'Terça' },
  { value: 3, label: 'Quarta' },
  { value: 4, label: 'Quinta' },
  { value: 5, label: 'Sexta' },
  { value: 6, label: 'Sábado' },
]

const DEFAULT_TZ = 'America/Sao_Paulo'
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/

interface Props {
  teamId: number
  teamName: string
  onClose: () => void
}

export function TeamWorkingHoursModal({ teamId, teamName, onClose }: Props) {
  const whQuery = useTeamWorkingHours(teamId)
  const saveHours = useSaveTeamWorkingHours(teamId)

  const [enabled, setEnabled] = useState(false)
  const [hours, setHours] = useState<WorkingHourEntry[]>([])

  useEffect(() => {
    if (!whQuery.data) return
    setEnabled(whQuery.data.workingHoursEnabled)
    setHours(whQuery.data.workingHours)
  }, [whQuery.data])

  const addRow = () => {
    const used = new Set(hours.map((h) => h.weekday))
    const nextDay = WEEKDAYS.find((d) => !used.has(d.value))
    if (!nextDay) {
      toast('Todos os dias da semana já estão configurados', 'info')
      return
    }
    setHours([
      ...hours,
      { weekday: nextDay.value, startTime: '09:00', endTime: '18:00', timezone: DEFAULT_TZ },
    ])
  }

  const updateRow = (idx: number, patch: Partial<WorkingHourEntry>) => {
    setHours((prev) => prev.map((h, i) => (i === idx ? { ...h, ...patch } : h)))
  }

  const removeRow = (idx: number) => {
    setHours((prev) => prev.filter((_, i) => i !== idx))
  }

  const handleSave = async () => {
    const seen = new Set<number>()
    for (const h of hours) {
      if (seen.has(h.weekday)) {
        toast('Dois horários para o mesmo dia da semana — remova um.', 'danger')
        return
      }
      seen.add(h.weekday)
      if (!HHMM_RE.test(h.startTime) || !HHMM_RE.test(h.endTime)) {
        toast('Horário inválido. Use HH:MM em 24h.', 'danger')
        return
      }
    }
    if (enabled && hours.length === 0) {
      toast('Ative pelo menos um dia ou desligue o filtro de horário.', 'danger')
      return
    }

    try {
      await saveHours.mutateAsync({ workingHours: hours, workingHoursEnabled: enabled })
      toast('Horário de atendimento atualizado', 'success')
      onClose()
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Falha ao salvar'
      toast(msg, 'danger')
    }
  }

  return (
    <Modal
      open
      onOpenChange={(v) => { if (!v) onClose() }}
      title={`Horário de atendimento: ${teamName}`}
      description="Fora dessas janelas, o setor não recebe leads novos pelo roteamento automático — eles ficam para o próximo horário útil (ou para o setor de fora de horário, se configurado)."
      size="xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saveHours.isPending}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saveHours.isPending}>
            {saveHours.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </>
      }
    >
      <div class="space-y-4">
        <label class="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled((e.currentTarget as HTMLInputElement).checked)}
            class="size-4 accent-accent"
          />
          <span class="font-medium text-fg">Filtrar leads por horário deste setor</span>
        </label>
        <p class="text-xs text-fg-muted -mt-2">
          Desligado = o setor recebe leads a qualquer momento, mesmo com dias configurados abaixo.
        </p>

        <section>
          <div class="flex items-center justify-between mb-3">
            <h4 class="text-sm font-semibold">Dias e janelas de atendimento</h4>
            <Button variant="secondary" size="sm" onClick={addRow}>
              <Plus class="w-4 h-4 mr-1" /> Adicionar dia
            </Button>
          </div>

          {whQuery.isLoading ? (
            <Skeleton class="h-24 w-full" />
          ) : hours.length === 0 ? (
            <div class="text-sm text-fg-muted bg-surface-2 border border-border rounded p-3">
              Nenhum dia configurado.
            </div>
          ) : (
            <div class="space-y-2">
              {hours.map((h, idx) => {
                const firstLabel = (s: string) => (idx === 0 ? { label: s } : {})
                return (
                  <div key={idx} class="grid grid-cols-[1fr_auto_auto_1fr_auto] gap-2 items-end">
                    <Select
                      {...firstLabel('Dia')}
                      value={String(h.weekday)}
                      onChange={(e) =>
                        updateRow(idx, {
                          weekday: parseInt((e.currentTarget as HTMLSelectElement).value),
                        })
                      }
                    >
                      {WEEKDAYS.map((d) => (
                        <option key={d.value} value={String(d.value)}>{d.label}</option>
                      ))}
                    </Select>
                    <Input
                      {...firstLabel('Início')}
                      type="time"
                      value={h.startTime}
                      onInput={(e) => updateRow(idx, { startTime: (e.currentTarget as HTMLInputElement).value })}
                    />
                    <Input
                      {...firstLabel('Fim')}
                      type="time"
                      value={h.endTime}
                      onInput={(e) => updateRow(idx, { endTime: (e.currentTarget as HTMLInputElement).value })}
                    />
                    <Input
                      {...firstLabel('Fuso (IANA)')}
                      value={h.timezone}
                      onInput={(e) => updateRow(idx, { timezone: (e.currentTarget as HTMLInputElement).value })}
                      placeholder={DEFAULT_TZ}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeRow(idx)}
                      title="Remover dia"
                    >
                      <Trash2 class="w-4 h-4" />
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </Modal>
  )
}
