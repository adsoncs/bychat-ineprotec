import type { ComponentChildren } from 'preact'
import { cn } from '@/lib/cn'
import { Switch as SwitchBase } from '@/components/ui/Input'

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
        {hint && <p class="text-2xs text-fg-muted mt-0.5">{hint}</p>}
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
                active ? 'bg-surface-2 text-fg surface-raised' : 'text-fg-muted hover:text-fg',
              )}
            >
              {o.label}
            </button>
          )
        })}
      </div>
      {help && <p class="text-2xs text-fg-muted mt-1">{help}</p>}
    </div>
  )
}
/**
 * Chave liga/desliga das preferências.
 *
 * Chamava-se Switch e desenhava uma CAIXA DE MARCAÇÃO — e as duas não dizem a
 * mesma coisa: a caixa marca uma escolha que só vale quando o formulário é
 * enviado; aqui o efeito é imediato. A API local (`label`, `help`) fica de pé
 * para os dois modais que já usam; o desenho vem da primitiva.
 */
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
    <SwitchBase
      checked={checked}
      onChange={onChange}
      label={label}
      {...(help !== undefined ? { hint: help } : {})}
      disabled={disabled}
    />
  )
}
