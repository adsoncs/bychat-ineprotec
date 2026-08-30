import type { JSX } from 'preact'
import { cn } from '@/lib/cn'

/* Campo é POÇO, não placa: fundo rebaixado (`surface-inset`) + sombra interna
 * vinda de cima (`.surface-inset`). É a contrapartida do `.surface-raised` dos
 * cards — junto, os dois é que constroem a profundidade da pele. Antes o fundo
 * era `bg-surface`, que na pele nova virou o fundo QUASE PRETO da janela: dentro
 * de um card o campo ficava mais escuro que o painel inteiro. */
const fieldBase =
  'rounded-md bg-surface-inset surface-inset text-sm text-fg placeholder:text-fg-muted ' +
  'focus:outline-none focus:border-accent'

type InputProps = JSX.IntrinsicElements['input'] & {
  label?: string
  hint?: string
  error?: string
}

export function Input({ label, hint, error, class: className, id, ...rest }: InputProps) {
  const inputId = id ?? `in-${Math.random().toString(36).slice(2, 9)}`
  return (
    <label class="flex flex-col gap-1" for={inputId}>
      {label && <span class="text-xs font-semibold text-fg-muted">{label}</span>}
      <input
        id={inputId}
        class={cn('h-9 px-3', fieldBase, error && 'border-danger', className)}
        {...rest}
      />
      {hint && !error && <span class="text-2xs text-fg-muted">{hint}</span>}
      {error && <span class="text-2xs text-danger">{error}</span>}
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
      {label && <span class="text-xs font-semibold text-fg-muted">{label}</span>}
      <textarea
        id={inputId}
        class={cn('min-h-[5rem] px-3 py-2 resize-y', fieldBase, error && 'border-danger', className)}
        {...rest}
      />
      {hint && !error && <span class="text-2xs text-fg-muted">{hint}</span>}
      {error && <span class="text-2xs text-danger">{error}</span>}
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
      {label && <span class="text-xs font-semibold text-fg-muted">{label}</span>}
      <select
        id={inputId}
        class={cn('h-9 px-2', fieldBase, className)}
        {...rest}
      >
        {children}
      </select>
      {hint && <span class="text-2xs text-fg-muted">{hint}</span>}
    </label>
  )
}

type CheckboxProps = Omit<JSX.IntrinsicElements['input'], 'type' | 'size'> & {
  label?: string
  /** Linha de apoio abaixo do rótulo — para explicar o que a opção faz. */
  hint?: string
  /** Estado parcial (nem tudo, nem nada), como no cabeçalho de uma lista. */
  indeterminate?: boolean
}

/**
 * Caixa de marcação com rótulo clicável.
 *
 * A aparência do quadrado NÃO está aqui: mora no `global.css`, aplicada a todo
 * `input[type=checkbox]` do sistema. Assim os 94 arquivos que ainda usam a tag
 * crua já têm o desenho novo, e este componente entra só onde há rótulo e
 * descrição para alinhar — que é o trabalho que a tag sozinha não faz.
 */
export function Checkbox({ label, hint, indeterminate, class: className, id, ...rest }: CheckboxProps) {
  const inputId = id ?? `cb-${Math.random().toString(36).slice(2, 9)}`
  return (
    <label class="flex items-start gap-2 cursor-pointer select-none" for={inputId}>
      <input
        id={inputId}
        type="checkbox"
        class={cn('mt-0.5', className)}
        ref={(el) => { if (el) el.indeterminate = !!indeterminate }}
        {...rest}
      />
      {(label || hint) && (
        <span class="flex flex-col gap-0.5 min-w-0">
          {label && <span class="text-sm text-fg leading-tight">{label}</span>}
          {hint && <span class="text-2xs text-fg-muted leading-snug">{hint}</span>}
        </span>
      )}
    </label>
  )
}

type SwitchProps = {
  checked: boolean
  onChange: (v: boolean) => void
  label?: string
  hint?: string
  disabled?: boolean
  /** Rótulo para leitor de tela quando não há `label` visível. */
  ariaLabel?: string
  class?: string
}

/**
 * Chave liga/desliga.
 *
 * Existe porque "ligado/desligado" vinha sendo escrito como checkbox, e os dois
 * não dizem a mesma coisa: a caixa marca uma escolha que só vale quando o
 * formulário é enviado; a chave aplica o efeito na hora. Onde a ação é imediata
 * — e no painel quase sempre é — a chave é a forma honesta.
 *
 * É um <button role="switch">, não um input escondido: assim o estado vai para
 * a árvore de acessibilidade por `aria-checked`, e a tecla Espaço já funciona
 * sem interceptar nada.
 */
export function Switch({ checked, onChange, label, hint, disabled, ariaLabel, class: className }: SwitchProps) {
  const chave = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label ? undefined : ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      class={cn(
        'relative h-5 w-9 shrink-0 rounded-full border transition-colors duration-150',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        checked
          ? 'bg-accent border-accent'
          : 'bg-surface-inset border-border-strong',
        disabled && 'opacity-50 cursor-not-allowed',
        className,
      )}
    >
      {/* O polegar anda por `translate`, não por `left`: só transform e opacity
        * são animadas fora do fio de layout. */}
      <span
        class={cn(
          'absolute top-1/2 left-0.5 size-4 -translate-y-1/2 rounded-full transition-transform duration-150',
          checked ? 'translate-x-4 bg-fg-on-brand' : 'bg-fg-muted',
        )}
      />
    </button>
  )

  if (!label && !hint) return chave

  return (
    <label class="flex items-start gap-2.5 cursor-pointer select-none">
      {chave}
      <span class="flex flex-col gap-0.5 min-w-0">
        {label && <span class="text-sm text-fg leading-tight">{label}</span>}
        {hint && <span class="text-2xs text-fg-muted leading-snug">{hint}</span>}
      </span>
    </label>
  )
}
