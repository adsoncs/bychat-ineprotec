import { Wand2, Undo2 } from '@/components/ui/icon-set'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { usePromotions, useRevertPromotion } from '@/hooks/useIntelligence'
import { toast } from '@/lib/toast'
import { formatRelative } from '@/lib/format'

const FIELD_LABELS: Record<string, string> = {
  email: 'E-mail',
  empresa: 'Empresa',
  cidade: 'Cidade',
}

export function PromotionsBanner({ leadId }: { leadId: number }) {
  const { data } = usePromotions(leadId)
  const revert = useRevertPromotion()
  if (!data || data.promotions.length === 0) return null

  const active = data.promotions.filter((p) => !p.revertedAt)
  if (active.length === 0) return null

  return (
    <Card class="p-3 border-success/40 bg-success/10">
      <div class="text-xs uppercase tracking-wider text-success font-semibold mb-2 flex items-center gap-1">
        <Wand2 size={11} /> Campos preenchidos automaticamente
        {data.at && <span class="text-fg-muted normal-case font-normal">· {formatRelative(data.at)}</span>}
      </div>
      <div class="space-y-1.5">
        {active.map((p) => (
          <div key={p.field} class="flex items-center gap-2 text-xs">
            <span class="text-fg-muted w-16 shrink-0">{FIELD_LABELS[p.field] ?? p.field}:</span>
            <span class="text-fg font-medium truncate flex-1">{p.newValue}</span>
            <Badge tone="info">{p.source}</Badge>
            <Badge tone={p.confidence >= 0.9 ? 'success' : 'warning'}>{Math.round(p.confidence * 100)}%</Badge>
            <button
              type="button"
              class="inline-flex items-center gap-1 h-6 px-2 rounded text-2xs font-medium border border-border bg-surface text-fg-muted hover:text-danger hover:border-danger/40 disabled:opacity-40"
              disabled={revert.isPending || data.eventId === null}
              onClick={() => {
                if (data.eventId === null) return
                revert.mutate({ leadId, eventId: data.eventId, field: p.field }, {
                  onSuccess: () => toast(`${FIELD_LABELS[p.field] ?? p.field} revertido`, 'success'),
                  onError: (e: unknown) => toast((e as Error).message, 'danger'),
                })
              }}
              title={p.oldValue ? `Reverter para "${p.oldValue}"` : 'Reverter para vazio'}
            >
              <Undo2 size={10} /> Reverter
            </button>
          </div>
        ))}
      </div>
    </Card>
  )
}
