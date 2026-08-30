import { useMemo, useState } from 'preact/hooks'
import { Tag, Users, ArrowRight, Flame, Snowflake, Thermometer } from '@/components/ui/icon-set'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { KpiCard } from '@/components/ui/KpiCard'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input, Select } from '@/components/ui/Input'
import { useFunnels } from '@/hooks/useFunnels'
import { useStatusSummaryReport, type SummaryReportRow } from '@/hooks/useStatusSummaries'

const intf = new Intl.NumberFormat('pt-BR')
const pctf = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 })

function today(): string { return new Date().toISOString().slice(0, 10) }
function daysAgo(n: number): string {
  const d = new Date(); d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

function TemperatureIcon({ t }: { t: SummaryReportRow['temperature'] }) {
  if (t === 'quente') return <Flame size={12} class="text-danger" />
  if (t === 'morno') return <Thermometer size={12} class="text-warning" />
  if (t === 'frio') return <Snowflake size={12} class="text-accent" />
  return null
}

export function StatusSummaryReportPage() {
  const [funnelId, setFunnelId] = useState<number | null>(null)
  const [filters, setFilters] = useState({ from: daysAgo(30), to: today() })

  const { data: funnelsData } = useFunnels()
  const funnels = funnelsData?.funnels ?? []
  useMemo(() => {
    if (funnelId === null && funnels[0]) setFunnelId(funnels[0].id)
  }, [funnels, funnelId])

  const report = useStatusSummaryReport(funnelId, filters)
  const rows = report.data?.data ?? []
  // Só interessa o que teve movimento: catálogo tem dezenas de resumos e a
  // maioria fica zerada em qualquer recorte.
  const active = rows.filter((r) => r.applied > 0 || r.currentLeads > 0)

  const totals = useMemo(() => {
    const applied = active.reduce((s, r) => s + r.applied, 0)
    const parked = active.reduce((s, r) => s + r.currentLeads, 0)
    const bySector = new Map<string, number>()
    for (const r of active) {
      const k = r.sector || '—'
      bySector.set(k, (bySector.get(k) ?? 0) + r.applied)
    }
    return { applied, parked, sectors: bySector.size }
  }, [active])

  const maxApplied = Math.max(1, ...active.map((r) => Math.max(r.applied, r.currentLeads)))

  return (
    <Page
      title="Relatório por Resumo"
      description="Quantas vezes cada situação foi registrada, quantos leads estão parados nela e para onde eles foram em seguida. É o que mostra onde o funil trava — por situação, não só por etapa."
    >
      <Card class="p-3">
        <div class="flex flex-wrap items-end gap-2">
          <Select
            label="Funil"
            value={funnelId ?? ''}
            onChange={(e) => setFunnelId(parseInt((e.target as HTMLSelectElement).value) || null)}
          >
            {funnels.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </Select>
          <Input
            label="De"
            type="date"
            value={filters.from}
            onInput={(e) => setFilters((f) => ({ ...f, from: (e.target as HTMLInputElement).value }))}
          />
          <Input
            label="Até"
            type="date"
            value={filters.to}
            onInput={(e) => setFilters((f) => ({ ...f, to: (e.target as HTMLInputElement).value }))}
          />
        </div>
      </Card>

      {report.isLoading && (
        <div class="space-y-3 mt-3">
          <Skeleton class="h-20 w-full" />
          <Skeleton class="h-64 w-full" />
        </div>
      )}

      {!report.isLoading && active.length === 0 && (
        <div class="mt-3">
          <EmptyState
            icon={<Tag size={20} />}
            title="Nenhum resumo registrado no período"
            description="Assim que o time começar a registrar as situações no lead, os números aparecem aqui."
          />
        </div>
      )}

      {!report.isLoading && active.length > 0 && (
        <>
          <section class="grid gap-3 grid-cols-2 lg:grid-cols-3 mt-3">
            <KpiCard
              label="Registros no período"
              value={intf.format(totals.applied)}
              icon={<Tag size={16} />}
              hint="Total de vezes que um resumo foi aplicado a um lead"
            />
            <KpiCard
              label="Leads parados"
              value={intf.format(totals.parked)}
              icon={<Users size={16} />}
              hint="Leads cujo resumo atual é um destes — independe do período"
            />
            <KpiCard
              label="Setores envolvidos"
              value={intf.format(totals.sectors)}
              icon={<ArrowRight size={16} />}
              hint="Quantos setores registraram situação no período"
            />
          </section>

          <Card class="mt-3 overflow-x-auto">
            <table class="w-full text-sm min-w-[720px]">
              <thead>
                <tr class="text-left text-xs text-fg-muted border-b border-border">
                  <th class="py-2 pr-3 font-medium">Resumo</th>
                  <th class="py-2 px-3 font-medium text-right">Aplicado</th>
                  <th class="py-2 px-3 font-medium text-right">Parados hoje</th>
                  <th class="py-2 px-3 font-medium text-right">Ainda no resumo</th>
                  <th class="py-2 pl-3 font-medium">Seguiram para</th>
                </tr>
              </thead>
              <tbody>
                {active.map((r) => {
                  const left = r.nextSummaries.reduce((s, n) => s + n.count, 0)
                  return (
                    <tr key={r.id} class="border-b border-border/60 last:border-0 align-top">
                      <td class="py-2.5 pr-3">
                        <div class="flex items-center gap-2 flex-wrap">
                          <span class="size-2.5 rounded-full shrink-0" style={{ background: r.color || '#94a3b8' }} />
                          <code class="text-xs font-mono px-1.5 py-0.5 rounded bg-surface-2 text-fg">{r.code}</code>
                          <span class="text-fg">{r.name}</span>
                          <TemperatureIcon t={r.temperature} />
                          {r.sector && <Badge tone="neutral">{r.sector}</Badge>}
                        </div>
                        <div class="mt-1.5 h-1.5 rounded-full bg-surface-2 overflow-hidden max-w-xs">
                          <div
                            class="h-full rounded-full"
                            style={{
                              width: `${Math.round((r.applied / maxApplied) * 100)}%`,
                              background: r.color || '#94a3b8',
                            }}
                          />
                        </div>
                      </td>
                      <td class="py-2.5 px-3 text-right tabular-nums text-fg">{intf.format(r.applied)}</td>
                      <td class="py-2.5 px-3 text-right tabular-nums text-fg">{intf.format(r.currentLeads)}</td>
                      <td class="py-2.5 px-3 text-right tabular-nums text-fg-muted">{intf.format(r.stillHere)}</td>
                      <td class="py-2.5 pl-3">
                        {r.nextSummaries.length === 0 ? (
                          <span class="text-xs text-fg-muted">—</span>
                        ) : (
                          <div class="flex flex-wrap gap-1.5">
                            {r.nextSummaries.slice(0, 5).map((n) => (
                              <span
                                key={n.code}
                                class="inline-flex items-center gap-1 text-xs rounded px-1.5 py-0.5 bg-surface-2 text-fg-muted"
                                title={`${n.count} de ${left} saídas`}
                              >
                                <code class="font-mono">{n.code}</code>
                                <span class="text-fg-muted">{pctf.format(n.count / left)}</span>
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Card>

          <p class="text-xs text-fg-muted mt-2">
            "Ainda no resumo" é o que foi aplicado no período menos o que já saiu. Leads que
            entraram antes do recorte contam em "Parados hoje", mas não em "Aplicado".
          </p>
        </>
      )}
    </Page>
  )
}
