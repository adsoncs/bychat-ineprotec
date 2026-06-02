import type { JSX } from 'preact'
import { Search, X } from 'lucide-preact'
import { cn } from '@/lib/cn'

interface SearchInputProps {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  class?: string
}

export function SearchInput({ value, onChange, placeholder = 'Buscar…', class: className }: SearchInputProps) {
  return (
    <div class={cn('relative flex items-center', className)}>
      <Search size={14} class="absolute left-3 text-fg-subtle pointer-events-none" />
      <input
        type="search"
        value={value}
        onInput={(e: JSX.TargetedEvent<HTMLInputElement>) => onChange(e.currentTarget.value)}
        placeholder={placeholder}
        class="w-full h-9 pl-9 pr-9 rounded-md bg-surface-2 border border-border text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent"
      />
      {value && (
        <button
          type="button"
          class="absolute right-2 size-6 rounded grid place-items-center text-fg-subtle hover:text-fg hover:bg-surface-3"
          onClick={() => onChange('')}
          aria-label="Limpar busca"
        >
          <X size={12} />
        </button>
      )}
    </div>
  )
}
