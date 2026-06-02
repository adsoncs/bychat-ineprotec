import { useState } from 'preact/hooks'
import { Modal } from '@/components/ui/Modal'
import { Input, Select } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { useFunnels } from '@/hooks/useFunnels'
import {
  findWidget,
  TYPE_LABELS,
  SIZE_LABELS,
  FUNNEL_AWARE_METRICS,
  GROUPABLE_METRICS,
  LIMITABLE_METRICS,
  type WidgetSize,
} from './WidgetCatalog'
import type { Widget, WidgetType } from '@/hooks/useWidgets'

interface EditWidgetModalProps {
  widget: Widget
  onClose: () => void
  onSave: (next: Widget) => void
}

export function EditWidgetModal({ widget, onClose, onSave }: EditWidgetModalProps) {
  const meta = findWidget(widget.metric)
  const types: WidgetType[] = meta?.availableTypes ?? [widget.type]
  const cfg = widget.config ?? {}

  const [title, setTitle] = useState(widget.title)
  const [type, setType] = useState<WidgetType>(widget.type)
  const [size, setSize] = useState<WidgetSize>(widget.size ?? 'md')
  const [groupBy, setGroupBy] = useState<'day' | 'week' | 'month'>(
    (cfg.groupBy as 'day' | 'week' | 'month' | undefined) ?? 'day',
  )
  const [limit, setLimit] = useState<number>(Number(cfg.limit ?? 10))
  const [funnelId, setFunnelId] = useState<string>(
    typeof cfg.funnelId === 'number' ? String(cfg.funnelId) : '',
  )

  const { data: funnelsData } = useFunnels()
  const funnels = funnelsData?.funnels ?? []

  function submit() {
    const config: Record<string, unknown> = { ...(widget.config ?? {}) }
    if (GROUPABLE_METRICS.includes(widget.metric)) config.groupBy = groupBy
    if (LIMITABLE_METRICS.includes(widget.metric)) config.limit = limit
    if (FUNNEL_AWARE_METRICS.includes(widget.metric)) {
      if (funnelId) config.funnelId = Number(funnelId)
      else delete config.funnelId
    }
    onSave({
      ...widget,
      title: title.trim() || (meta?.title ?? widget.metric),
      type,
      size,
      ...(Object.keys(config).length > 0 ? { config } : {}),
    })
    onClose()
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Editar Widget"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={submit}>Salvar</Button>
        </>
      }
    >
      <div class="grid gap-3 grid-cols-1 sm:grid-cols-2">
        <Input
          label="Título"
          value={title}
          onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
        />
        <Select
          label="Visualização"
          value={type}
          onChange={(e) => setType((e.target as HTMLSelectElement).value as WidgetType)}
        >
          {types.map((t) => (
            <option key={t} value={t}>{TYPE_LABELS[t]}</option>
          ))}
        </Select>
        <Select
          label="Tamanho"
          value={size}
          onChange={(e) => setSize((e.target as HTMLSelectElement).value as WidgetSize)}
        >
          <option value="sm">{SIZE_LABELS.sm}</option>
          <option value="md">{SIZE_LABELS.md}</option>
          <option value="lg">{SIZE_LABELS.lg}</option>
          <option value="xl">{SIZE_LABELS.xl}</option>
        </Select>
        {GROUPABLE_METRICS.includes(widget.metric) && (
          <Select
            label="Agrupar por"
            value={groupBy}
            onChange={(e) => setGroupBy((e.target as HTMLSelectElement).value as 'day' | 'week' | 'month')}
          >
            <option value="day">Dia</option>
            <option value="week">Semana</option>
            <option value="month">Mês</option>
          </Select>
        )}
        {LIMITABLE_METRICS.includes(widget.metric) && (
          <Select
            label="Limite de itens"
            value={String(limit)}
            onChange={(e) => setLimit(Number((e.target as HTMLSelectElement).value))}
          >
            <option value="5">5</option>
            <option value="10">10</option>
            <option value="15">15</option>
            <option value="25">25</option>
          </Select>
        )}
        {FUNNEL_AWARE_METRICS.includes(widget.metric) && (
          <Select
            label="Funil específico"
            value={funnelId}
            onChange={(e) => setFunnelId((e.target as HTMLSelectElement).value)}
          >
            <option value="">Todos os funis (usa filtro global)</option>
            {funnels.filter((f) => f.active !== false).map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}{f.isDefault ? ' (padrão)' : ''}
              </option>
            ))}
          </Select>
        )}
      </div>
    </Modal>
  )
}
