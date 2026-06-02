export const PILLAR_META: Record<string, { label: string; color: string }> = {
  geral: { label: 'Geral', color: '#1a73e8' },
  mkt: { label: 'Marketing', color: '#9334e6' },
  marketing: { label: 'Marketing', color: '#9334e6' },
  vnd: { label: 'Vendas', color: '#34a853' },
  vendas: { label: 'Vendas', color: '#34a853' },
  oferta: { label: 'Oferta', color: '#f9ab00' },
  dados: { label: 'Dados', color: '#00bcd4' },
  proc: { label: 'Processos', color: '#ad1457' },
  processos: { label: 'Processos', color: '#ad1457' },
  pessoas: { label: 'Pessoas', color: '#ea4335' },
  produto: { label: 'Produto', color: '#5e35b1' },
}

export function ScoreByPillar({
  scores,
  compact = false,
}: {
  scores: Record<string, number> | null | undefined
  compact?: boolean
}) {
  if (!scores || Object.keys(scores).length === 0) return null
  const entries = Object.entries(scores).filter(([, v]) => typeof v === 'number' && v > 0)
  if (entries.length === 0) return null
  entries.sort((a, b) => {
    if (a[0] === 'geral') return -1
    if (b[0] === 'geral') return 1
    return b[1] - a[1]
  })

  return (
    <div>
      {!compact && (
        <span class="text-xs font-medium text-fg-muted block mb-2">Scores por pilar</span>
      )}
      <div class="space-y-1.5">
        {entries.map(([key, value]) => {
          const meta = PILLAR_META[key] ?? { label: key, color: '#5f6368' }
          const pct = Math.max(2, Math.min(100, Math.round(value)))
          return (
            <div key={key} class="flex items-center gap-3">
              <span
                class={compact ? 'text-[0.6875rem] text-fg w-20 truncate' : 'text-xs text-fg w-24 truncate'}
                title={meta.label}
              >
                {meta.label}
              </span>
              <span class="flex-1 h-2 rounded-full bg-surface-3 overflow-hidden">
                <span
                  class="block h-full rounded-full"
                  style={{ width: `${pct}%`, background: meta.color }}
                />
              </span>
              <span
                class={
                  compact
                    ? 'text-[0.6875rem] text-fg w-8 text-right tabular-nums font-semibold'
                    : 'text-xs text-fg w-10 text-right tabular-nums font-semibold'
                }
              >
                {Math.round(value)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
