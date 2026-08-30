import { Crown, Building2, Users, Sparkles, Clock, Snowflake, Link2, Lightbulb } from '@/components/ui/icon-set'
import { Card } from '@/components/ui/Card'
import { useInsights, type Insight } from '@/hooks/useIntelligence'

const ICONS: Record<Insight['icon'], typeof Crown> = {
  crown: Crown,
  building: Building2,
  users: Users,
  sparkles: Sparkles,
  clock: Clock,
  snowflake: Snowflake,
  link: Link2,
}

const TONE_CHIP: Record<Insight['tone'], string> = {
  success: 'bg-success/15 text-success border-success/30',
  info: 'bg-info/15 text-info border-info/30',
  warning: 'bg-warning/15 text-warning border-warning/30',
  neutral: 'bg-surface-3 text-fg-muted border-border',
}

const TONE_DOT: Record<Insight['tone'], string> = {
  success: 'text-success',
  info: 'text-info',
  warning: 'text-warning',
  neutral: 'text-fg-muted',
}

export function InsightsCard({ leadId }: { leadId: number }) {
  const { data, isLoading } = useInsights(leadId)
  if (isLoading || !data || data.insights.length === 0) return null

  return (
    <Card class="p-3">
      <div class="text-xs uppercase tracking-wider text-fg-muted font-semibold mb-2 flex items-center gap-1">
        <Lightbulb size={11} /> Sugestões
      </div>
      <ul class="space-y-2">
        {data.insights.map((ins) => {
          const Icon = ICONS[ins.icon] ?? Lightbulb
          return (
            <li key={ins.id} class="flex items-start gap-2">
              <span class={`inline-flex items-center gap-1 h-5 px-2 rounded-full text-2xs font-medium border shrink-0 ${TONE_CHIP[ins.tone]}`}>
                <Icon size={10} class={TONE_DOT[ins.tone]} />
                {ins.label}
              </span>
              <span class="text-xs text-fg-muted leading-relaxed">{ins.detail}</span>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
