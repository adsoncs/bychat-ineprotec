import { useEffect, useState } from 'preact/hooks'
import { X as XIcon } from 'lucide-preact'
import { type WorkflowStep } from '@/hooks/useWorkflows'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { StepConfigFields } from '@/components/WorkflowStepsEditor'

/**
 * Painel direito de edição de passo — usado pelo `WorkflowCanvasView` quando
 * um node é selecionado. Reaproveita o `StepConfigFields` exportado do
 * editor de lista pra manter os formulários idênticos.
 *
 * Builder Visual (Fase 26): aplica mudanças via callback `onPatch` no buffer
 * local do canvas em vez de chamar mutation imediata. A persistência só
 * acontece quando o operador clica "Salvar" no canvas.
 */

const STEP_TYPE_META: Record<string, { label: string; color: string; icon: string }> = {
  trigger:   { label: 'Gatilho',     color: '#1a73e8', icon: '⚡' },
  wait:      { label: 'Esperar',     color: '#f9ab00', icon: '⏳' },
  condition: { label: 'Condição',    color: '#8e24aa', icon: '🔀' },
  action:    { label: 'Ação',        color: '#2e7d32', icon: '▶' },
  branch:    { label: 'Ramificação', color: '#e37400', icon: '🌿' },
  goal:      { label: 'Meta',        color: '#ea4335', icon: '🎯' },
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

interface Props {
  workflowId: number
  step: WorkflowStep
  steps: WorkflowStep[]
  /** Aplica patch no buffer local do canvas (não persiste — Save do canvas faz isso). */
  onPatch: (patch: Partial<WorkflowStep>) => void
  onClose: () => void
}

export function WorkflowStepEditPanel({ step, steps, onPatch, onClose }: Props) {
  const meta = STEP_TYPE_META[step.type] ?? { label: step.type, color: '#5f6368', icon: '?' }

  const [name, setName] = useState(step.name)
  const [config, setConfig] = useState<Record<string, unknown>>(asRecord(step.config))
  const [nextStepId, setNextStepId] = useState<number | null>(step.nextStepId)
  const [altStepId, setAltStepId] = useState<number | null>(step.altStepId)

  // Reset interno quando muda o step selecionado (clica em outro node).
  useEffect(() => {
    setName(step.name)
    setConfig(asRecord(step.config))
    setNextStepId(step.nextStepId)
    setAltStepId(step.altStepId)
  }, [step.id])

  function patchConfig(partial: Record<string, unknown>) {
    setConfig((c) => ({ ...c, ...partial }))
  }

  function replaceConfig(next: Record<string, unknown>) {
    setConfig(next)
  }

  function handleApply() {
    onPatch({ name, config, nextStepId, altStepId })
    onClose()
  }

  const otherSteps = steps.filter((s) => s.id !== step.id)
  const isCondition = step.type === 'condition' || step.type === 'branch'

  return (
    <div
      class="border-l border-border bg-surface-2 flex flex-col"
      style={{ width: '360px', minWidth: '360px' }}
    >
      {/* Cabeçalho */}
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
            <div class="text-xs text-fg-muted truncate">Editar passo</div>
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

      {/* Conteúdo scrollável */}
      <div class="flex-1 overflow-y-auto p-3 space-y-4">
        <Input
          label="Nome do passo"
          value={name}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
        />

        <StepConfigFields
          type={step.type}
          config={config}
          onPatch={patchConfig}
          onReplace={replaceConfig}
        />

        <div class="space-y-3 pt-1">
          <div>
            <label class="text-xs font-medium text-fg-muted mb-1.5 block" for="panel-step-next">
              Próximo passo (→)
            </label>
            <select
              id="panel-step-next"
              value={nextStepId === null ? '' : String(nextStepId)}
              onChange={(e) => {
                const v = (e.target as HTMLSelectElement).value
                setNextStepId(v ? Number(v) : null)
              }}
              class="h-9 px-3 rounded-md bg-surface border border-border text-sm text-fg w-full focus:outline-none focus:border-accent"
            >
              <option value="">Nenhum (fim do fluxo)</option>
              {otherSteps.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <p class="text-[0.6875rem] text-fg-subtle mt-1">Para onde ir após este passo</p>
          </div>

          {isCondition && (
            <div>
              <label class="text-xs font-medium text-fg-muted mb-1.5 block" for="panel-step-alt">
                Se NÃO atender (Senão →)
              </label>
              <select
                id="panel-step-alt"
                value={altStepId === null ? '' : String(altStepId)}
                onChange={(e) => {
                  const v = (e.target as HTMLSelectElement).value
                  setAltStepId(v ? Number(v) : null)
                }}
                class="h-9 px-3 rounded-md bg-surface border border-border text-sm text-fg w-full focus:outline-none focus:border-accent"
              >
                <option value="">Nenhum (fim do fluxo)</option>
                {otherSteps.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <p class="text-[0.6875rem] text-fg-subtle mt-1">
                Caminho alternativo quando a condição não é atendida
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
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
          title="Aplica no buffer local — clique Salvar no canvas pra persistir"
        >
          Aplicar
        </Button>
      </div>
    </div>
  )
}
