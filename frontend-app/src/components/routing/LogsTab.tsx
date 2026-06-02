import { useState } from 'preact/hooks'
import { ScrollText } from 'lucide-preact'
import { Card } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { useRoutingLogs, type RoutingLogEntry } from '@/hooks/useRouting'

type Filter = 'all' | 'rule' | 'escalation'

export function LogsTab() {
  const [filter, setFilter] = useState<Filter>('all')
  const logs = useRoutingLogs(filter, 100)

  if (logs.isLoading) return <Skeleton class="h-64 w-full" />

  const list = logs.data?.logs ?? []

  return (
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <div>
          <h3 class="text-sm font-semibold">Histórico de roteamento</h3>
          <p class="text-xs text-fg-muted">
            Últimos 100 eventos. Cada vez que uma regra dispara ou a escalação devolve um lead,
            uma linha aparece aqui.
          </p>
        </div>
        <div class="flex gap-1 bg-surface-2 border border-border rounded p-0.5">
          {(['all', 'rule', 'escalation'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              class={`px-3 py-1 text-xs rounded transition-colors ${
                filter === f
                  ? 'bg-accent text-fg-on-brand'
                  : 'text-fg-muted hover:text-fg'
              }`}
            >
              {f === 'all' ? 'Todos' : f === 'rule' ? 'Regras' : 'Escalação'}
            </button>
          ))}
        </div>
      </div>

      {list.length === 0 ? (
        <EmptyState
          icon={<ScrollText class="w-8 h-8" />}
          title="Sem eventos ainda"
          description="Quando uma regra dispara ou a escalação devolve um lead, ele aparece aqui."
        />
      ) : (
        <Card>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="text-left text-xs uppercase tracking-wide text-fg-muted border-b border-border">
                <tr>
                  <th class="px-3 py-3">Quando</th>
                  <th class="px-3 py-3">Tipo</th>
                  <th class="px-3 py-3">Lead</th>
                  <th class="px-3 py-3">Detalhe</th>
                </tr>
              </thead>
              <tbody>
                {list.map((log) => <LogRow key={log.id} log={log} />)}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}

function LogRow({ log }: { log: RoutingLogEntry }) {
  const date = new Date(log.createdAt)
  const isRule = log.type === 'routing_rule_matched'
  const isEscalation = log.type === 'agent_reassigned_escalation'

  const metadata = log.metadata ?? {}
  const ruleId = (metadata as any).ruleId as number | undefined
  const reason = (metadata as any).reason as string | undefined

  return (
    <tr class="border-b border-border last:border-0 hover:bg-surface-2">
      <td class="px-3 py-3 text-xs text-fg-muted whitespace-nowrap" title={date.toISOString()}>
        {date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
      </td>
      <td class="px-3 py-3">
        {isRule && <Badge tone="info">Regra</Badge>}
        {isEscalation && <Badge tone="warning">Escalação</Badge>}
      </td>
      <td class="px-3 py-3">
        {log.lead ? (
          <a href={`/app/leads/${log.lead.id}`} class="text-accent hover:underline">
            {log.lead.empresa || log.lead.nome || `Lead #${log.lead.id}`}
          </a>
        ) : (
          <span class="text-fg-subtle">#{log.leadId}</span>
        )}
      </td>
      <td class="px-3 py-3 text-xs">
        <div class="text-fg">{log.title}</div>
        {isRule && ruleId != null && (
          <div class="text-fg-muted mt-0.5">Regra #{ruleId}</div>
        )}
        {isEscalation && reason && (
          <div class="text-fg-muted mt-0.5">Motivo: <code>{reason}</code></div>
        )}
      </td>
    </tr>
  )
}
