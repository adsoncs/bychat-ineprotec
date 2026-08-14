import type { ComponentChildren } from 'preact'
import { cn } from '@/lib/cn'

/**
 * Controles de painel de preferências — usados pelo modal de Conversas e pelo
 * de conta. Ficam num módulo só para os dois painéis parecerem o mesmo produto:
 * duplicar levava a espaçamento e foco divergentes entre telas.
 */

export function Section({ title, hint, children }: { title: string; hint?: string; children: ComponentChildren }) {
  return (
    <section class="space-y-3">
      <div>
        <h3 class="text-xs font-semibold uppercase tracking-wider text-fg-muted">{title}</h3>
        {hint && <p class="text-[0.6875rem] text-fg-subtle mt-0.5">{hint}</p>}
      </div>
      {children}
    </section>
  )
}
export function Segmented({
  label, help, value, options, onChange,
}: {
  label: string
  help?: string
  value: string
  options: { id: string; label: string }[]
  onChange: (id: string) => void
}) {
  return (
    <div>
      <div class="text-sm text-fg mb-1">{label}</div>
      <div class="inline-flex gap-1 p-0.5 rounded-md bg-surface-3 flex-wrap" role="group" aria-label={label}>
        {options.map((o) => {
          const active = o.id === value
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => onChange(o.id)}
              aria-pressed={active}
              class={cn(
                'h-7 px-2.5 rounded text-xs font-medium transition-colors',
                active ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg',
              )}
            >
              {o.label}
            </button>
          )
        })}
      </div>
      {help && <p class="text-[0.6875rem] text-fg-subtle mt-1">{help}</p>}
    </div>
  )
}
export function Switch({
  checked, onChange, label, help, disabled = false,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  help?: string
  disabled?: boolean
}) {
  return (
    <label class={cn('flex items-start gap-2', disabled ? 'opacity-60' : 'cursor-pointer')}>
      <input
        type="checkbox"
        class="mt-1"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange((e.target as HTMLInputElement).checked)}
      />
      <span class="text-sm text-fg">
        {label}
        {help && <span class="block text-xs text-fg-muted">{help}</span>}
      </span>
    </label>
  )
}
