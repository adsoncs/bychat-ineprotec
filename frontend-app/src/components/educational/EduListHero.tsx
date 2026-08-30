import { Card } from '@/components/ui/Card'

export interface EduKpi {
  value: number
  label: string
  tone: 'accent' | 'success' | 'warning' | 'violet' | 'danger'
}

const TONE_COLOR: Record<EduKpi['tone'], string> = {
  accent: 'var(--color-accent)',
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  violet: '#6d49f9',
  danger: 'var(--color-danger)',
}

export function EduListHero({
  icon, title, summary, kpis,
}: {
  icon: preact.ComponentChildren
  title: string
  summary: string
  kpis: EduKpi[]
}) {
  return (
    <Card class="!p-5 bg-gradient-to-br from-accent/8 to-transparent">
      <div class="flex items-center gap-4 flex-wrap">
        <div class="size-12 rounded-lg bg-accent/15 text-accent grid place-items-center shrink-0">
          {icon}
        </div>
        <div class="flex-1 min-w-[180px]">
          <div class="text-sm font-semibold text-fg">{title}</div>
          <div class="text-xs text-fg-muted mt-0.5">{summary}</div>
        </div>
        <div class="flex items-stretch divide-x divide-border">
          {kpis.map((k) => (
            <div key={k.label} class="px-4 text-center">
              <div
                class="text-xl font-bold tabular-nums leading-none"
                style={{ color: TONE_COLOR[k.tone] }}
              >
                {k.value}
              </div>
              <div class="text-3xs uppercase tracking-wider text-fg-muted mt-1">
                {k.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  )
}

export function EduCountPill({ label, n }: { label: string; n: number }) {
  return (
    <div class="flex flex-col items-end">
      <span class="text-fg-muted text-3xs uppercase tracking-wider">{label}</span>
      <span class="text-fg-muted">{n}</span>
    </div>
  )
}
