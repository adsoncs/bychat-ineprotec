import type { ComponentChildren } from 'preact'
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
import { GripVertical } from 'lucide-preact'
import { cn } from '@/lib/cn'

type SortableId = string | number

interface SortableListProps<T extends { id: SortableId }> {
  items: T[]
  onReorder: (items: T[]) => void
  renderItem: (item: T, index: number) => ComponentChildren
  /** se true, mostra handle separado em vez de tornar o item inteiro arrastável */
  withHandle?: boolean
}

/**
 * Lista reordenável vertical via @dnd-kit/sortable.
 * Disparara onReorder quando a ordem muda — chamador persiste via mutation.
 */
export function SortableList<T extends { id: SortableId }>({
  items, onReorder, renderItem, withHandle = true,
}: SortableListProps<T>) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIdx = items.findIndex((i) => String(i.id) === String(active.id))
    const newIdx = items.findIndex((i) => String(i.id) === String(over.id))
    if (oldIdx < 0 || newIdx < 0) return
    onReorder(arrayMove(items, oldIdx, newIdx))
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <div class="flex flex-col gap-1.5">
          {items.map((item, index) => (
            <SortableItem key={item.id} id={item.id} withHandle={withHandle}>
              {renderItem(item, index)}
            </SortableItem>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}

function SortableItem({
  id, children, withHandle,
}: { id: SortableId; children: ComponentChildren; withHandle: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  if (!withHandle) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        class={cn('cursor-grab touch-none', isDragging && 'cursor-grabbing')}
        {...(listeners as unknown as Record<string, unknown>)}
        {...(attributes as unknown as Record<string, unknown>)}
      >
        {children}
      </div>
    )
  }

  return (
    <div ref={setNodeRef} style={style} class="flex items-center gap-2">
      <button
        type="button"
        class="size-6 grid place-items-center rounded text-fg-subtle hover:text-fg cursor-grab touch-none shrink-0"
        {...(listeners as unknown as Record<string, unknown>)}
        {...(attributes as unknown as Record<string, unknown>)}
        aria-label="Arrastar"
      >
        <GripVertical size={14} />
      </button>
      <div class="flex-1 min-w-0">{children}</div>
    </div>
  )
}
