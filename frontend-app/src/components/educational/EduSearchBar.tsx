import { Search } from '@/components/ui/icon-set'

export function EduSearchBar({
  value, onChange, placeholder, total, filteredCount, itemNoun = 'item(ns)',
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  total: number
  filteredCount: number
  itemNoun?: string
}) {
  const trimmed = value.trim()
  return (
    <div class="flex items-center gap-3">
      <div class="relative flex-1">
        <Search size={14} class="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted pointer-events-none" />
        <input
          type="search"
          value={value}
          onInput={(e) => onChange((e.target as HTMLInputElement).value)}
          placeholder={placeholder}
          class="w-full h-9 pl-9 pr-3 rounded-md bg-surface border border-border text-sm text-fg placeholder:text-fg-muted focus:outline-none focus:border-accent"
          autoComplete="off"
        />
      </div>
      <span class="text-xs text-fg-muted whitespace-nowrap tabular-nums">
        {trimmed ? `${filteredCount} de ${total}` : `${total} ${itemNoun}`}
      </span>
    </div>
  )
}
