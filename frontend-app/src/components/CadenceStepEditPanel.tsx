import { useEffect, useState } from 'preact/hooks'
import { X as XIcon } from 'lucide-preact'
import { type CadenceStep } from '@/hooks/useSalesCadences'
import { useTemplates } from '@/hooks/useTemplates'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'

/**
 * Painel direito do builder visual de Cadências. Renderiza embedded numa
 * coluna lateral fixa de 360px ao lado do canvas e edita os campos do
 * `CadenceStep` selecionado.
 *
 * Builder Visual (Fase 26): aplica mudanças via callback `onPatch` no buffer
 * local — persistência só com Save no canvas.
 */

const CHANNEL_META: Record<string, { label: string; color: string; icon: string }> = {
  whatsapp: { label: 'WhatsApp', color: '#25D366', icon: '💬' },
  email:    { label: 'E-mail',   color: '#1a73e8', icon: '✉️' },
  sms:      { label: 'SMS',      color: '#f9ab00', icon: '📱' },
  call:     { label: 'Ligação',  color: '#8e24aa', icon: '📞' },
  linkedin: { label: 'LinkedIn', color: '#0a66c2', icon: '💼' },
  manual:   { label: 'Tarefa',   color: '#5f6368', icon: '📋' },
}

const CHANNELS = Object.keys(CHANNEL_META)

interface Props {
  cadenceId: number
  step: CadenceStep
  steps: CadenceStep[]
  /** Aplica patch no buffer local do canvas (não persiste imediatamente). */
  onPatch: (patch: Partial<CadenceStep>) => void
  onClose: () => void
}

export function CadenceStepEditPanel({ step, steps, onPatch, onClose }: Props) {
  const meta = CHANNEL_META[step.channel] ?? { label: step.channel, color: '#5f6368', icon: '?' }
  const templatesQuery = useTemplates()

  const [channel, setChannel] = useState(step.channel)
  const [dayOffset, setDayOffset] = useState(step.dayOffset)
  const [hourOffset, setHourOffset] = useState(step.hourOffset)
  const [templateId, setTemplateId] = useState<number | null>(step.templateId)
  const [isManual, setIsManual] = useState(step.isManual)
  const [isBreakUp, setIsBreakUp] = useState(step.isBreakUp)
  const [nextStepId, setNextStepId] = useState<number | null>(step.nextStepId ?? null)
  const [altStepId, setAltStepId] = useState<number | null>(step.altStepId ?? null)

  useEffect(() => {
    setChannel(step.channel)
    setDayOffset(step.dayOffset)
    setHourOffset(step.hourOffset)
    setTemplateId(step.templateId)
    setIsManual(step.isManual)
    setIsBreakUp(step.isBreakUp)
    setNextStepId(step.nextStepId ?? null)
    setAltStepId(step.altStepId ?? null)
  }, [step.id])

  function handleApply() {
    onPatch({
      channel,
      dayOffset: Math.max(0, dayOffset),
      hourOffset: Math.max(0, hourOffset),
      templateId,
      isManual,
      isBreakUp,
      nextStepId,
      altStepId,
    })
    onClose()
  }

  const otherSteps = steps.filter((s) => s.id !== step.id)
  const channelTemplates = (templatesQuery.data?.templates ?? []).filter((t) => t.channel === channel)
  const hasCondition = !!step.conditionJson

  return (
    <div
      class="border-l border-border bg-surface-2 flex flex-col"
      style={{ width: '360px', minWidth: '360px' }}
    >
      <div class="flex items-center justify-between px-3 py-2 border-b border-border">
        <div class="flex items-center gap-2 min-w-0">
          <span class="text-base">{meta.icon}</span>
          <div class="min-w-0">
            <div
              class="text-[0.6875rem] font-medium uppercase tracking-wide"
              style={{ color: meta.color }}
            >
              {meta.label}
            </div>
            <div class="text-xs text-fg-muted truncate">
              Step #{step.order + 1} {isBreakUp && '· Break-up'} {isManual && '· Manual'}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          class="size-7 grid place-items-center rounded text-fg-muted hover:text-fg hover:bg-surface-3"
          aria-label="Fechar painel"
          title="Fechar (Esc)"
        >
          <XIcon size={14} />
        </button>
      </div>

      <div class="flex-1 overflow-y-auto p-3 space-y-4">
        <Select
          label="Canal"
          value={channel}
          onChange={(e) => setChannel((e.target as HTMLSelectElement).value)}
        >
          {CHANNELS.map((c) => (
            <option key={c} value={c}>
              {CHANNEL_META[c]?.label ?? c}
            </option>
          ))}
        </Select>

        <div class="grid gap-3 grid-cols-2">
          <Input
            label="Dias após anterior"
            type="number"
            min={0}
            value={dayOffset}
            onInput={(e) => setDayOffset(Number((e.target as HTMLInputElement).value) || 0)}
          />
          <Input
            label="Horas adicionais"
            type="number"
            min={0}
            value={hourOffset}
            onInput={(e) => setHourOffset(Number((e.target as HTMLInputElement).value) || 0)}
          />
        </div>

        {channel !== 'call' && channel !== 'manual' && channel !== 'linkedin' && (
          <Select
            label="Template"
            value={templateId === null ? '' : String(templateId)}
            onChange={(e) => {
              const v = (e.target as HTMLSelectElement).value
              setTemplateId(v ? Number(v) : null)
            }}
            hint="Mensagem que será enviada automaticamente. Crie em Templates."
          >
            <option value="">— sem template (envio manual) —</option>
            {channelTemplates.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </Select>
        )}

        <div class="space-y-2">
          <label class="flex items-center gap-2 text-xs text-fg-muted cursor-pointer">
            <input
              type="checkbox"
              checked={isManual}
              onChange={(e) => setIsManual((e.target as HTMLInputElement).checked)}
            />
            <span>Tarefa manual (cria atividade pro operador em vez de enviar automático)</span>
          </label>
          <label class="flex items-center gap-2 text-xs text-fg-muted cursor-pointer">
            <input
              type="checkbox"
              checked={isBreakUp}
              onChange={(e) => setIsBreakUp((e.target as HTMLInputElement).checked)}
            />
            <span>Break-up (último step — encerra a cadência após o envio)</span>
          </label>
        </div>

        <div class="space-y-3 pt-1 border-t border-border">
          <div>
            <label class="text-xs font-medium text-fg-muted mb-1.5 block" for="cstep-next">
              Próximo step (→)
            </label>
            <select
              id="cstep-next"
              value={nextStepId === null ? '' : String(nextStepId)}
              onChange={(e) => {
                const v = (e.target as HTMLSelectElement).value
                setNextStepId(v ? Number(v) : null)
              }}
              class="h-9 px-3 rounded-md bg-surface border border-border text-sm text-fg w-full focus:outline-none focus:border-accent"
            >
              <option value="">Linear (próximo da ordem)</option>
              {otherSteps.map((s) => (
                <option key={s.id} value={s.id}>#{s.order + 1} {CHANNEL_META[s.channel]?.label ?? s.channel}</option>
              ))}
            </select>
            <p class="text-[0.6875rem] text-fg-subtle mt-1">
              Quando vazio, o scheduler usa a ordem linear histórica (modo legado).
            </p>
          </div>

          {hasCondition && (
            <div>
              <label class="text-xs font-medium text-fg-muted mb-1.5 block" for="cstep-alt">
                Caminho alternativo se condição falhar
              </label>
              <select
                id="cstep-alt"
                value={altStepId === null ? '' : String(altStepId)}
                onChange={(e) => {
                  const v = (e.target as HTMLSelectElement).value
                  setAltStepId(v ? Number(v) : null)
                }}
                class="h-9 px-3 rounded-md bg-surface border border-border text-sm text-fg w-full focus:outline-none focus:border-accent"
              >
                <option value="">Nenhum</option>
                {otherSteps.map((s) => (
                  <option key={s.id} value={s.id}>#{s.order + 1} {CHANNEL_META[s.channel]?.label ?? s.channel}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      <div class="flex items-center gap-2 px-3 py-2 border-t border-border bg-surface">
        <Button
          variant="secondary"
          size="sm"
          onClick={onClose}
        >
          Cancelar
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={handleApply}
          class="flex-1"
          title="Aplica no buffer — clique Salvar no canvas pra persistir"
        >
          Aplicar
        </Button>
      </div>
    </div>
  )
}
