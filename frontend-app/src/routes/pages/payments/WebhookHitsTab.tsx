import { useState } from 'preact/hooks'
import { Webhook, Eye } from 'lucide-preact'
import { Card } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { Badge } from '@/components/ui/Badge'
import { Select } from '@/components/ui/Input'
import { Pagination } from '@/components/ui/Pagination'
import { Modal } from '@/components/ui/Modal'
import { useWebhookHits, useWebhookHit, type WebhookHitRow } from '@/hooks/usePaymentsDashboard'
import { formatRelative } from '@/lib/format'

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'info'> = {
  processed: 'success',
  ignored: 'info',
  received: 'warning',
  notFound: 'warning',
  error: 'danger',
}

const STATUS_LABEL: Record<string, string> = {
  processed: 'Processado',
  ignored: 'Ignorado',
  received: 'Recebido',
  notFound: 'Sem inscrição',
  error: 'Erro',
}

export function WebhookHitsTab() {
  const [filters, setFilters] = useState({ days: 7, limit: 50, offset: 0, provider: '', status: '' })
  const { data, isLoading } = useWebhookHits({
    days: filters.days,
    limit: filters.limit,
    offset: filters.offset,
    ...(filters.provider ? { provider: filters.provider } : {}),
    ...(filters.status ? { status: filters.status } : {}),
  })
  const [detail, setDetail] = useState<number | null>(null)

  function update<K extends keyof typeof filters>(key: K, value: typeof filters[K]) {
    setFilters((s) => ({ ...s, [key]: value, offset: 0 }))
  }

  return (
    <div class="space-y-3">
      <Card>
        <div class="flex items-center justify-between gap-3 flex-wrap mb-3">
          <div class="flex items-center gap-2 flex-wrap">
            <Select value={String(filters.days)} onChange={(e) => update('days', parseInt((e.target as HTMLSelectElement).value) || 7)}>
              <option value="1">Hoje</option>
              <option value="7">Últimos 7 dias</option>
              <option value="30">Últimos 30 dias</option>
            </Select>
            <Select value={filters.provider} onChange={(e) => update('provider', (e.target as HTMLSelectElement).value)}>
              <option value="">Todos provedores</option>
              <option value="pagarme">Pagar.me</option>
              <option value="asaas">Asaas</option>
            </Select>
            <Select value={filters.status} onChange={(e) => update('status', (e.target as HTMLSelectElement).value)}>
              <option value="">Todos status</option>
              <option value="processed">Processado</option>
              <option value="ignored">Ignorado</option>
              <option value="notFound">Sem inscrição</option>
              <option value="error">Erro</option>
            </Select>
          </div>
          {data?.statusCounts && (
            <div class="text-xs text-fg-subtle inline-flex items-center gap-3">
              {Object.entries(data.statusCounts).map(([s, n]) => (
                <span key={s} class="inline-flex items-center gap-1">
                  <Badge tone={STATUS_TONE[s] || 'info'}>{STATUS_LABEL[s] || s}</Badge>
                  <span class="tabular-nums">{n}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        {isLoading ? (
          <Skeleton class="h-40 w-full" />
        ) : (
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="text-left text-xs text-fg-subtle border-b border-border">
                  <th class="py-2 pr-3">Recebido</th>
                  <th class="py-2 pr-3">Provedor</th>
                  <th class="py-2 pr-3">Evento</th>
                  <th class="py-2 pr-3">Charge/Payment</th>
                  <th class="py-2 pr-3">Status</th>
                  <th class="py-2 pr-3">IP</th>
                  <th class="py-2 pr-3"></th>
                </tr>
              </thead>
              <tbody>
                {(data?.items ?? []).map((h) => <HitRow key={h.id} h={h} onView={() => setDetail(h.id)} />)}
                {(data?.items ?? []).length === 0 && (
                  <tr>
                    <td colspan={7} class="py-8 text-center text-xs text-fg-subtle">
                      <Webhook size={24} class="mx-auto mb-2 opacity-40" />
                      Nenhum webhook recebido no período.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {data && data.total > filters.limit && (
          <div class="mt-3">
            <Pagination
              total={data.total}
              limit={filters.limit}
              offset={filters.offset}
              onChange={(offset) => setFilters((s) => ({ ...s, offset }))}
            />
          </div>
        )}
      </Card>

      {detail && <HitDetailModal id={detail} onClose={() => setDetail(null)} />}
    </div>
  )
}

function HitRow({ h, onView }: { h: WebhookHitRow; onView: () => void }) {
  return (
    <tr class="border-b border-border/40 hover:bg-surface-2 cursor-pointer" onClick={onView}>
      <td class="py-2 pr-3 text-xs text-fg-subtle whitespace-nowrap">{formatRelative(h.receivedAt)}</td>
      <td class="py-2 pr-3">
        <span class="text-xs text-fg">{h.provider === 'pagarme' ? 'Pagar.me' : 'Asaas'}</span>
        {h.connection && (
          <div class="text-[0.6875rem] text-fg-subtle truncate max-w-[150px]" title={h.connection.name}>
            {h.connection.name}
          </div>
        )}
      </td>
      <td class="py-2 pr-3"><code class="text-xs text-fg-muted">{h.eventType}</code></td>
      <td class="py-2 pr-3">
        {h.externalId && <code class="text-[0.6875rem] text-fg-muted font-mono">{h.externalId}</code>}
      </td>
      <td class="py-2 pr-3">
        <Badge tone={STATUS_TONE[h.status] || 'info'}>{STATUS_LABEL[h.status] || h.status}</Badge>
        {h.errorMessage && (
          <div class="text-[0.6875rem] text-danger mt-0.5 truncate max-w-[200px]" title={h.errorMessage}>
            {h.errorMessage}
          </div>
        )}
      </td>
      <td class="py-2 pr-3 text-[0.6875rem] text-fg-subtle font-mono">{h.remoteIp}</td>
      <td class="py-2 pr-3"><Eye size={12} class="text-fg-subtle" /></td>
    </tr>
  )
}

function HitDetailModal({ id, onClose }: { id: number; onClose: () => void }) {
  const { data, isLoading } = useWebhookHit(id)
  const h = data?.hit

  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose() }} title="Detalhe do webhook" size="lg">
      {isLoading || !h ? (
        <Skeleton class="h-40" />
      ) : (
        <div class="space-y-3 text-sm">
          <div class="grid grid-cols-2 gap-3">
            <div>
              <div class="text-xs text-fg-subtle">Provedor</div>
              <div class="text-fg">{h.provider}</div>
            </div>
            <div>
              <div class="text-xs text-fg-subtle">Status</div>
              <Badge tone={STATUS_TONE[h.status] || 'info'}>{STATUS_LABEL[h.status] || h.status}</Badge>
            </div>
            <div>
              <div class="text-xs text-fg-subtle">Evento</div>
              <code class="text-xs">{h.eventType}</code>
            </div>
            <div>
              <div class="text-xs text-fg-subtle">Charge/Payment ID</div>
              <code class="text-xs">{h.externalId ?? '—'}</code>
            </div>
            <div>
              <div class="text-xs text-fg-subtle">IP</div>
              <code class="text-xs">{h.remoteIp ?? '—'}</code>
            </div>
            <div>
              <div class="text-xs text-fg-subtle">User-Agent</div>
              <code class="text-xs truncate" title={h.userAgent ?? ''}>{h.userAgent ?? '—'}</code>
            </div>
          </div>
          {h.errorMessage && (
            <div class="rounded-md bg-danger/10 border border-danger/30 p-3">
              <div class="text-xs text-danger font-medium mb-1">Erro</div>
              <div class="text-xs text-fg">{h.errorMessage}</div>
            </div>
          )}
          <div>
            <div class="text-xs text-fg-subtle mb-1">Payload</div>
            <pre class="text-[0.6875rem] font-mono bg-surface-3 p-3 rounded-md overflow-auto max-h-80">{JSON.stringify(h.payload, null, 2)}</pre>
          </div>
        </div>
      )}
    </Modal>
  )
}
