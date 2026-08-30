import { ChevronLeft, ChevronRight } from '@/components/ui/icon-set'

interface PaginationProps {
  total: number
  limit: number
  offset: number
  onChange: (offset: number) => void
}

export function Pagination({ total, limit, offset, onChange }: PaginationProps) {
  const page = Math.floor(offset / limit) + 1
  const totalPages = Math.max(1, Math.ceil(total / limit))
  const from = total === 0 ? 0 : offset + 1
  const to = Math.min(offset + limit, total)

  return (
    <div class="flex items-center justify-between gap-3 text-xs text-fg-muted">
      {/* A faixa inteira é tabular: sem isso o "12–24" muda de largura ao virar
          para "13–25" e o bloco todo se desloca a cada página. */}
      <span class="tabular-nums">
        {from}–{to} de <span class="font-semibold text-fg">{total}</span>
      </span>
      <div class="flex items-center gap-1">
        <button
          type="button"
          class="size-7 rounded-md hover:bg-surface-3 grid place-items-center disabled:opacity-40 disabled:hover:bg-transparent"
          disabled={offset === 0}
          onClick={() => onChange(Math.max(0, offset - limit))}
          aria-label="Página anterior"
        >
          <ChevronLeft size={14} />
        </button>
        <span class="px-2 tabular-nums text-fg">
          {page}/{totalPages}
        </span>
        <button
          type="button"
          class="size-7 rounded-md hover:bg-surface-3 grid place-items-center disabled:opacity-40 disabled:hover:bg-transparent"
          disabled={offset + limit >= total}
          onClick={() => onChange(offset + limit)}
          aria-label="Próxima página"
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  )
}
