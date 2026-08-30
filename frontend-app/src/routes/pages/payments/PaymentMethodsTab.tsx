import { useState } from 'preact/hooks'
import { RefreshCw, ExternalLink } from '@/components/ui/icon-set'
import { Card } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { Badge } from '@/components/ui/Badge'
import { Input, Select } from '@/components/ui/Input'
import { presetRange, presetLabel, type RangePreset } from '@/components/ui/PeriodPicker'
import { Button } from '@/components/ui/Button'
import { Pagination } from '@/components/ui/Pagination'
import { usePaymentMethods, type PaymentMethodsFilters, type PaymentMethodRow } from '@/hooks/usePaymentsDashboard'
import { useSyncRegistrationPayment } from '@/hooks/useEnrollmentPortals'
import { toast } from '@/lib/toast'
import { formatRelative } from '@/lib/format'
import { paymentStatusLabel, paymentStatusTone, paymentMethodLabel, paymentProviderLabel } from '@/lib/paymentLabels'

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export function PaymentMethodsTab() {
  const [filters, setFilters] = useState<PaymentMethodsFilters>({ days: 30, limit: 50, offset: 0 })
  // Período em meses fechados; o backend já aceita from/to (resolvePeriod).
  const [mesSelecionado, setMesSelecionado] = useState<RangePreset>('m0')
  const periodoMes = presetRange(mesSelecionado)
  const { data, isLoading } = usePaymentMethods({ ...filters, from: periodoMes.dateFrom, to: periodoMes.dateTo })

  function update<K extends keyof PaymentMethodsFilters>(key: K, value: PaymentMethodsFilters[K]) {
    setFilters((s) => ({ ...s, [key]: value, offset: 0 }))
  }

  return (
    <div class="space-y-3">
      <Card>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
          <Input
            label="Buscar"
            value={filters.search ?? ''}
            onInput={(e) => update('search', (e.target as HTMLInputElement).value)}
            placeholder="Código ou ID externo"
          />
          <Select label="Status" value={filters.status ?? ''} onChange={(e) => update('status', (e.target as HTMLSelectElement).value || undefined)}>
            <option value="">Todos</option>
            <option value="paid">Pagos</option>
            <option value="pending">Pendentes</option>
            <option value="failed">Falharam</option>
            <option value="overdue">Vencidos</option>
            <option value="refunded">Reembolsados</option>
          </Select>
          <Select label="Método" value={filters.method ?? ''} onChange={(e) => update('method', (e.target as HTMLSelectElement).value || undefined)}>
            <option value="">Todos</option>
            <option value="pix">PIX</option>
            <option value="boleto">Boleto</option>
            <option value="credit_card">Cartão</option>
          </Select>
          <Select label="Provedor" value={filters.provider ?? ''} onChange={(e) => update('provider', (e.target as HTMLSelectElement).value || undefined)}>
            <option value="">Todos</option>
            <option value="pagarme">Pagar.me</option>
            <option value="asaas">Asaas</option>
          </Select>
          <Select label="Período" value={mesSelecionado} onChange={(e) => setMesSelecionado((e.target as HTMLSelectElement).value as RangePreset)}>
            {(['m0','m1','m2','m3','m4'] as RangePreset[]).map((p) => (
              <option key={p} value={p}>{presetLabel(p)}</option>
            ))}
          </Select>
        </div>
      </Card>

      <Card>
        {isLoading ? (
          <Skeleton class="h-40 w-full" />
        ) : (
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="text-left text-xs text-fg-muted border-b border-border">
                  <th class="py-2 pr-3">Inscrição</th>
                  <th class="py-2 pr-3">Lead</th>
                  <th class="py-2 pr-3">Método</th>
                  <th class="py-2 pr-3 text-right">Valor</th>
                  <th class="py-2 pr-3">Status</th>
                  <th class="py-2 pr-3">Criado</th>
                  <th class="py-2 pr-3">Ações</th>
                </tr>
              </thead>
              <tbody>
                {(data?.items ?? []).map((m) => <MethodRow key={m.id} m={m} />)}
                {(data?.items ?? []).length === 0 && (
                  <tr><td colspan={7} class="py-6 text-center text-xs text-fg-muted">Nenhuma cobrança encontrada</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {data && data.total > (filters.limit ?? 50) && (
          <div class="mt-3">
            <Pagination
              total={data.total}
              limit={filters.limit ?? 50}
              offset={filters.offset ?? 0}
              onChange={(offset) => setFilters((s) => ({ ...s, offset }))}
            />
          </div>
        )}
      </Card>
    </div>
  )
}

function MethodRow({ m }: { m: PaymentMethodRow }) {
  const sync = useSyncRegistrationPayment(m.registration?.id ?? 0)
  const methodPrefix = m.method === 'pix' ? '📱' : m.method === 'boleto' ? '📄' : '💳'
  const methodFullLabel = `${methodPrefix} ${paymentMethodLabel(m.method)}`
  const providerName = paymentProviderLabel(m.provider)

  function handleSync() {
    if (!m.registration?.id) return
    sync.mutate(undefined, {
      onSuccess: (r) => {
        if (r.transitionedToPaid) toast('Pagamento confirmado!', 'success')
        else toast('Sincronizado — status mantido.', 'info')
      },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <tr class="border-b border-border/40">
      <td class="py-2 pr-3">
        {m.registration?.candidateCode && m.registration.portal?.id ? (
          <a
            href={`/app/enrollment-portals/${m.registration.portal.id}/registrations/${m.registration.id}`}
            class="text-accent hover:underline font-mono text-xs"
          >
            {m.registration.candidateCode}
          </a>
        ) : (
          <span class="text-fg-muted font-mono text-xs">{m.registration?.candidateCode ?? '—'}</span>
        )}
        {m.registration?.portal && (
          <div class="text-2xs text-fg-muted truncate max-w-[200px]" title={m.registration.portal.nome}>
            {m.registration.portal.nome}
          </div>
        )}
      </td>
      <td class="py-2 pr-3 text-xs">
        <div class="text-fg truncate max-w-[180px]">{m.registration?.lead?.nome ?? '—'}</div>
        <div class="text-fg-muted truncate max-w-[180px]">{m.registration?.lead?.email ?? '—'}</div>
      </td>
      <td class="py-2 pr-3">
        <div class="text-sm text-fg">{methodFullLabel}</div>
        <div class="text-2xs text-fg-muted">via {providerName}</div>
        {(m.cardBrand || m.cardLastDigits) && (
          <div class="text-2xs text-fg-muted mt-0.5">
            {m.cardBrand} •••• {m.cardLastDigits}
          </div>
        )}
      </td>
      <td class="py-2 pr-3 text-right text-sm tabular-nums text-fg">{fmt(m.amount)}</td>
      <td class="py-2 pr-3">
        <Badge tone={paymentStatusTone(m.status)}>{paymentStatusLabel(m.status)}</Badge>
        {m.lastErrorMessage && (
          <div class="text-2xs text-danger mt-1 italic max-w-[220px] truncate" title={m.lastErrorMessage}>
            {m.lastErrorMessage}
          </div>
        )}
      </td>
      <td class="py-2 pr-3 text-xs text-fg-muted">{formatRelative(m.createdAt)}</td>
      <td class="py-2 pr-3">
        <div class="flex items-center gap-1">
          {m.boletoPdfUrl && (
            <a
              href={m.boletoPdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              class="text-fg-muted hover:text-accent"
              title="Baixar boleto"
            >
              <ExternalLink size={12} />
            </a>
          )}
          {m.status !== 'paid' && m.registration?.id && (
            <Button variant="ghost" size="sm" onClick={handleSync} disabled={sync.isPending} title="Sincronizar com o provider">
              <RefreshCw size={11} class={sync.isPending ? 'animate-spin' : ''} />
            </Button>
          )}
        </div>
      </td>
    </tr>
  )
}
