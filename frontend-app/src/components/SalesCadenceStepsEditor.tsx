import { useEffect, useState } from 'preact/hooks'
import { Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-preact'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import {
  useSalesCadence,
  useReplaceSalesCadenceSteps,
  type CadenceStep,
} from '@/hooks/useSalesCadences'
import { useTemplates } from '@/hooks/useTemplates'
import { toast } from '@/lib/toast'

const CHANNELS = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'email', label: 'E-mail' },
  { value: 'sms', label: 'SMS' },
  { value: 'call', label: 'Ligação (manual)' },
  { value: 'linkedin', label: 'LinkedIn (manual)' },
  { value: 'manual', label: 'Tarefa manual' },
] as const

type DraftStep = Omit<CadenceStep, 'id'>

function emptyStep(order: number): DraftStep {
  return {
    order,
    dayOffset: 0,
    hourOffset: 0,
    channel: 'whatsapp',
    templateId: null,
    isManual: false,
    isBreakUp: false,
    conditionJson: null,
  }
}

interface Props {
  cadenceId: number | null
  cadenceName?: string | undefined
  onOpenChange: (open: boolean) => void
}

export function SalesCadenceStepsEditor({ cadenceId, cadenceName, onOpenChange }: Props) {
  const open = cadenceId !== null
  const detailQuery = useSalesCadence(cadenceId)
  const templatesQuery = useTemplates()
  const replace = useReplaceSalesCadenceSteps(cadenceId ?? 0)

  const [steps, setSteps] = useState<DraftStep[]>([])

  // Carrega steps do server quando o modal abre.
  useEffect(() => {
    if (!open) return
    if (detailQuery.data) {
      setSteps(
        detailQuery.data.steps
          .slice()
          .sort((a, b) => a.order - b.order)
          .map(({ id: _id, ...rest }) => rest),
      )
    }
  }, [open, detailQuery.data])

  function update(idx: number, patch: Partial<DraftStep>) {
    setSteps((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)))
  }

  function move(idx: number, dir: -1 | 1) {
    const target = idx + dir
    if (target < 0 || target >= steps.length) return
    setSteps((prev) => {
      const copy = prev.slice()
      const tmp = copy[idx]!
      copy[idx] = copy[target]!
      copy[target] = tmp
      return reorderSequential(copy)
    })
  }

  function remove(idx: number) {
    setSteps((prev) => reorderSequential(prev.filter((_, i) => i !== idx)))
  }

  function add() {
    setSteps((prev) => [...prev, emptyStep(prev.length)])
  }

  function handleSave() {
    replace.mutate(reorderSequential(steps), {
      onSuccess: () => {
        toast('Passos salvos', 'success')
        onOpenChange(false)
      },
      onError: (e) => toast((e as Error).message, 'danger'),
    })
  }

  const templates = templatesQuery.data?.templates ?? []
  const isLoading = detailQuery.isLoading

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={cadenceName ? `Passos — ${cadenceName}` : 'Passos da cadência'}
      description="Cada passo é um contato com o lead. O sistema executa em ordem, respeitando os intervalos que você definir."
      size="xl"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)} disabled={replace.isPending}>
            Cancelar
          </Button>
          <Button variant="primary" size="sm" onClick={handleSave} disabled={replace.isPending}>
            {replace.isPending ? 'Salvando…' : 'Salvar passos'}
          </Button>
        </>
      }
    >
      {isLoading && (
        <div class="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} class="h-20 w-full" />)}
        </div>
      )}

      {!isLoading && (
        <div class="flex flex-col gap-3">
          {steps.length === 0 && (
            <div class="text-center py-6 max-w-lg mx-auto">
              <p class="text-sm text-fg mb-2">Nenhum passo ainda</p>
              <p class="text-xs text-fg-muted mb-3">
                Comece adicionando o primeiro contato. O "Dias após anterior" do primeiro passo conta a partir do momento em que o lead é inscrito na cadência.
              </p>
              <div class="text-left bg-surface-3/40 rounded p-3 text-[0.6875rem] text-fg-muted">
                <span class="font-semibold text-fg">Dica:</span> não use intervalos curtos demais (1 hora entre WhatsApps soa como spam). Padrão recomendado: 2-3 dias entre toques no mesmo canal.
              </div>
            </div>
          )}

          {steps.map((s, idx) => (
            <div
              key={idx}
              class="border border-border rounded-md p-3 flex flex-col gap-2 bg-surface"
            >
              <div class="flex items-center justify-between">
                <span class="text-xs font-medium text-fg-muted">Passo #{s.order + 1}</span>
                <div class="flex gap-1">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => move(idx, -1)}
                    disabled={idx === 0}
                    title="Mover para cima"
                  >
                    <ArrowUp size={12} />
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => move(idx, 1)}
                    disabled={idx === steps.length - 1}
                    title="Mover para baixo"
                  >
                    <ArrowDown size={12} />
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => remove(idx)} title="Remover passo">
                    <Trash2 size={12} />
                  </Button>
                </div>
              </div>

              <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div>
                  <label class="text-[0.6875rem] font-medium text-fg" title="Por onde o contato será feito">Canal</label>
                  <Select
                    value={s.channel}
                    onChange={(e: any) => update(idx, { channel: e.currentTarget.value })}
                  >
                    {CHANNELS.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label class="text-[0.6875rem] font-medium text-fg" title="Quantos dias esperar antes de executar">Esperar (dias)</label>
                  <Input
                    type="number"
                    min={0}
                    value={String(s.dayOffset)}
                    onInput={(e: any) =>
                      update(idx, { dayOffset: Number(e.currentTarget.value) || 0 })
                    }
                  />
                </div>
                <div>
                  <label class="text-[0.6875rem] font-medium text-fg" title="Horas adicionais ao tempo de espera">+ horas</label>
                  <Input
                    type="number"
                    min={0}
                    value={String(s.hourOffset)}
                    onInput={(e: any) =>
                      update(idx, { hourOffset: Number(e.currentTarget.value) || 0 })
                    }
                  />
                </div>
                <div>
                  <label class="text-[0.6875rem] font-medium text-fg" title="Modelo de mensagem pronto, com variáveis tipo {{nome}}">Mensagem</label>
                  <Select
                    value={s.templateId == null ? '' : String(s.templateId)}
                    onChange={(e: any) =>
                      update(idx, {
                        templateId: e.currentTarget.value ? Number(e.currentTarget.value) : null,
                      })
                    }
                  >
                    <option value="">— Escolher template —</option>
                    {templates
                      .filter((t) => !s.channel || matchesChannel(t, s.channel))
                      .map((t) => (
                        <option key={t.id} value={String(t.id)}>{t.name}</option>
                      ))}
                  </Select>
                </div>
              </div>

              <div class="flex flex-col md:flex-row md:flex-wrap gap-2 md:gap-4 pt-1">
                <label class="flex items-start gap-2 text-xs text-fg">
                  <input
                    type="checkbox"
                    class="mt-0.5"
                    checked={s.isManual}
                    onChange={(e: any) => update(idx, { isManual: e.currentTarget.checked })}
                  />
                  <span>
                    <span class="font-medium">Tarefa manual</span>
                    <span class="block text-fg-muted text-[0.6875rem]">Em vez de enviar sozinho, cria uma tarefa pra você executar (aparece em "Hoje").</span>
                  </span>
                </label>
                <label class="flex items-start gap-2 text-xs text-fg">
                  <input
                    type="checkbox"
                    class="mt-0.5"
                    checked={s.isBreakUp}
                    onChange={(e: any) => update(idx, { isBreakUp: e.currentTarget.checked })}
                  />
                  <span>
                    <span class="font-medium">Mensagem final (despedida)</span>
                    <span class="block text-fg-muted text-[0.6875rem]">Marca este como o último step. Depois de enviado, a cadência encerra e o lead sai dela.</span>
                  </span>
                </label>
              </div>
            </div>
          ))}

          <div>
            <Button variant="secondary" size="sm" onClick={add}>
              <Plus size={12} /> Adicionar passo
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

function reorderSequential(arr: DraftStep[]): DraftStep[] {
  return arr.map((s, i) => ({ ...s, order: i }))
}

function matchesChannel(tpl: { channel?: string | null }, channel: string): boolean {
  // Sem channel definido no template → permite em qualquer; senão bate exato.
  return !tpl.channel || tpl.channel === channel
}
