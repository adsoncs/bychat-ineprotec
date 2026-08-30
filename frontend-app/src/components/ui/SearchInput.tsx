import type { JSX } from 'preact'
import { Search, X } from '@/components/ui/icon-set'
import { cn } from '@/lib/cn'

interface SearchInputProps {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  class?: string
}

/**
 * Busca é controle de barra de ferramentas, não campo de formulário: ela FLUTUA
 * (`surface-raised`) em vez de afundar como o <Input>. A regra da pele é por
 * PAPEL, não por elemento — um <input> pode ser qualquer um dos dois.
 */
export function SearchInput({ value, onChange, placeholder = 'Buscar…', class: className }: SearchInputProps) {
  return (
    <div class={cn('relative flex items-center', className)}>
      <Search size={14} class="absolute left-3 text-fg-muted pointer-events-none" />
      <input
        type="search"
        value={value}
        onInput={(e: JSX.TargetedEvent<HTMLInputElement>) => onChange(e.currentTarget.value)}
        placeholder={placeholder}
        class="w-full h-9 pl-9 pr-9 rounded-md bg-surface-2 border border-border surface-raised text-sm text-fg placeholder:text-fg-muted focus:outline-none focus:border-accent"
      />
      {value && (
        <button
          type="button"
          class="absolute right-2 size-6 rounded grid place-items-center text-fg-muted hover:text-fg hover:bg-surface-3"
          onClick={() => onChange('')}
          aria-label="Limpar busca"
        >
          <X size={12} />
        </button>
      )}
    </div>
  )
}
