import type { JSX } from 'preact'
import { cn } from '@/lib/cn'

type InputProps = JSX.IntrinsicElements['input'] & {
  label?: string
  hint?: string
  error?: string
}

export function Input({ label, hint, error, class: className, id, ...rest }: InputProps) {
  const inputId = id ?? `in-${Math.random().toString(36).slice(2, 9)}`
  return (
    <label class="flex flex-col gap-1" for={inputId}>
      {label && <span class="text-xs font-medium text-fg-muted">{label}</span>}
      <input
        id={inputId}
        class={cn(
          'h-9 px-3 rounded-md bg-surface border border-border text-sm text-fg',
          'placeholder:text-fg-subtle focus:outline-none focus:border-accent',
          error && 'border-danger',
          className,
        )}
        {...rest}
      />
      {hint && !error && <span class="text-[0.6875rem] text-fg-subtle">{hint}</span>}
      {error && <span class="text-[0.6875rem] text-danger">{error}</span>}
    </label>
  )
}

type TextareaProps = JSX.IntrinsicElements['textarea'] & {
  label?: string
  hint?: string
  error?: string
}

export function Textarea({ label, hint, error, class: className, id, ...rest }: TextareaProps) {
  const inputId = id ?? `ta-${Math.random().toString(36).slice(2, 9)}`
  return (
    <label class="flex flex-col gap-1" for={inputId}>
      {label && <span class="text-xs font-medium text-fg-muted">{label}</span>}
      <textarea
        id={inputId}
        class={cn(
          'min-h-[5rem] px-3 py-2 rounded-md bg-surface border border-border text-sm text-fg',
          'placeholder:text-fg-subtle focus:outline-none focus:border-accent resize-y',
          error && 'border-danger',
          className,
        )}
        {...rest}
      />
      {hint && !error && <span class="text-[0.6875rem] text-fg-subtle">{hint}</span>}
      {error && <span class="text-[0.6875rem] text-danger">{error}</span>}
    </label>
  )
}

type SelectProps = JSX.IntrinsicElements['select'] & {
  label?: string
  hint?: string
}

export function Select({ label, hint, class: className, id, children, ...rest }: SelectProps) {
  const inputId = id ?? `sel-${Math.random().toString(36).slice(2, 9)}`
  return (
    <label class="flex flex-col gap-1" for={inputId}>
      {label && <span class="text-xs font-medium text-fg-muted">{label}</span>}
      <select
        id={inputId}
        class={cn(
          'h-9 px-2 rounded-md bg-surface border border-border text-sm text-fg',
          'focus:outline-none focus:border-accent',
          className,
        )}
        {...rest}
      >
        {children}
      </select>
      {hint && <span class="text-[0.6875rem] text-fg-subtle">{hint}</span>}
    </label>
  )
}
