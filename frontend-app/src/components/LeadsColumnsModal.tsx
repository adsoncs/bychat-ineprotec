import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Eye, EyeOff, RotateCcw } from 'lucide-preact'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import {
  useLeadsColumnsStore,
  ALL_LEAD_COLUMNS,
  leadColumnLabel,
  type LeadColumnKey,
} from '@/stores/leadsColumns'
import { useCustomFields } from '@/hooks/useCustomFields'

interface LeadsColumnsModalProps {
  open: boolean
  onClose: () => void
}

export function LeadsColumnsModal({ open, onClose }: LeadsColumnsModalProps) {
  const visible = useLeadsColumnsStore((s) => s.visible)
  const setVisible = useLeadsColumnsStore((s) => s.setVisible)
  const toggle = useLeadsColumnsStore((s) => s.toggle)
  const reset = useLeadsColumnsStore((s) => s.reset)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  // Campos personalizados marcados "mostrar na lista" entram como colunas
  // `cf:<key>` — assim o operador escolhe exibi-los como qualquer coluna nativa.
  const { data: cfData } = useCustomFields()
  const cfFields = (cfData?.fields ?? []).filter((f) => f.active && f.showInList)
  const cfLabels = Object.fromEntries((cfData?.fields ?? []).map((f) => [f.key, f.label]))
  const allColumns: LeadColumnKey[] = [...ALL_LEAD_COLUMNS, ...cfFields.map((f) => `cf:${f.key}` as const)]

  const inactive = allColumns.filter((c) => !visible.includes(c))

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIdx = visible.indexOf(active.id as LeadColumnKey)
    const newIdx = visible.indexOf(over.id as LeadColumnKey)
    if (oldIdx < 0 || newIdx < 0) return
    setVisible(arrayMove(visible, oldIdx, newIdx))
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Colunas da tabela"
      description="Arraste para reordenar. Clique no olho para ocultar/mostrar."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => reset()}>
            <RotateCcw size={14} /> Restaurar padrão
          </Button>
          <Button variant="primary" size="sm" onClick={onClose}>Concluir</Button>
        </>
      }
    >
      <div class="space-y-4">
        <div>
          <div class="text-xs font-semibold text-fg-muted mb-1.5 uppercase tracking-wider">
            Visíveis ({visible.length})
          </div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={visible} strategy={verticalListSortingStrategy}>
              <ul class="space-y-1">
                {visible.map((col) => (
                  <SortableColumn key={col} col={col} label={leadColumnLabel(col, cfLabels)} onToggle={() => toggle(col)} />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
          {visible.length === 0 && (
            <p class="text-xs text-fg-subtle text-center py-3">Nenhuma coluna visível.</p>
          )}
        </div>

        {inactive.length > 0 && (
          <div>
            <div class="text-xs font-semibold text-fg-muted mb-1.5 uppercase tracking-wider">
              Disponíveis ({inactive.length})
            </div>
            <ul class="space-y-1">
              {inactive.map((col) => (
                <li
                  key={col}
                  class="flex items-center gap-2 px-3 h-9 rounded-md text-sm text-fg-muted hover:bg-surface-3"
                >
                  <span class="size-4" />
                  <span class="flex-1">{leadColumnLabel(col, cfLabels)}</span>
                  <button
                    type="button"
                    class="size-6 rounded grid place-items-center text-fg-subtle hover:text-fg"
                    onClick={() => toggle(col)}
                    aria-label="Mostrar"
                  >
                    <EyeOff size={12} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  )
}

function SortableColumn({ col, label, onToggle }: { col: LeadColumnKey; label: string; onToggle: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: col })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      class="flex items-center gap-2 px-3 h-9 rounded-md text-sm text-fg bg-surface-3"
    >
      <button
        type="button"
        class="size-4 grid place-items-center text-fg-subtle hover:text-fg cursor-grab touch-none"
        {...(listeners as unknown as Record<string, unknown>)}
        {...(attributes as unknown as Record<string, unknown>)}
        aria-label="Arrastar"
      >
        <GripVertical size={12} />
      </button>
      <span class="flex-1">{label}</span>
      <button
        type="button"
        class="size-6 rounded grid place-items-center text-fg-subtle hover:text-fg"
        onClick={onToggle}
        aria-label="Ocultar"
      >
        <Eye size={12} />
      </button>
    </li>
  )
}
