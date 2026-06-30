import { useMemo, useState } from 'preact/hooks'
import { useParams } from 'wouter-preact'
import {
  TrendingDown, Users, Trophy, AlertTriangle, Clock, Filter as FilterIcon,
  Percent, ChevronRight, ChevronDown, HelpCircle,
} from 'lucide-preact'
import { Button } from '@/components/ui/Button'
import { HowItWorksModal } from '@/components/ui/HowItWorksModal'
import { leadSourceLabel } from '@/lib/leadSourceLabels'
import { useFunnels } from '@/hooks/useFunnels'
import { useFunnelConversionReport } from '@/hooks/useFunnelConversion'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { KpiCard } from '@/components/ui/KpiCard'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input, Select } from '@/components/ui/Input'

const intf = new Intl.NumberFormat('pt-BR')
const pctf = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 })

function today(): string { return new Date().toISOString().slice(0, 10) }
function daysAgo(n: number): string {
  const d = new Date(); d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}
function formatDuration(sec: number | null): string {
  if (sec === null) return '—'
  if (sec < 3600) return `${Math.round(sec / 60)}min`
  if (sec < 86400) return `${(sec / 3600).toFixed(1)}h`
  return `${(sec / 86400).toFixed(1)}d`
}

export function FunnelConversionPage() {
  const params = useParams<{ id?: string }>()
  const urlFunnelId = params?.id ? parseInt(params.id) : null
  const [funnelId, setFunnelId] = useState<number | null>(urlFunnelId)
  const [filters, setFilters] = useState({ dateFrom: daysAgo(30), dateTo: today() })
  const [showHowItWorks, setShowHowItWorks] = useState(false)

  const { data: funnelsData } = useFunnels()
  const report = useFunnelConversionReport(funnelId, filters)

  const funnels = funnelsData?.funnels ?? []
  // Auto-seleciona o primeiro funil se não houver na URL
  useMemo(() => {
    if (funnelId === null && funnels[0]) setFunnelId(funnels[0].id)
  }, [funnels, funnelId])

  const stages = report.data?.stages ?? []
  const maxEntries = Math.max(1, ...stages.map(s => Math.max(s.entriesInPeriod, s.currentCount)))

  return (
    <Page
      title="Funil de Conversão"
      description="Visualização de leads por etapa, taxas de conversão entre etapas, tempo médio em cada uma e identificação automática de gargalos. Baseado nas movimentações reais do período."
      actions={
        <Button variant="ghost" size="sm" onClick={() => setShowHowItWorks(true)}>
          <HelpCircle size={14} /> Como funciona?
        </Button>
      }
    >
      <Card class="p-3">
        <div class="flex flex-wrap items-end gap-2">
          <Select
            label="Funil"
            value={funnelId ?? ''}
            onChange={(e) => setFunnelId(parseInt((e.target as HTMLSelectElement).value) || null)}
          >
            {funnels.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </Select>
          <Input
            label="De"
            type="date"
            value={filters.dateFrom}
            onInput={(e) => setFilters(f => ({ ...f, dateFrom: (e.target as HTMLInputElement).value }))}
          />
          <Input
            label="Até"
            type="date"
            value={filters.dateTo}
            onInput={(e) => setFilters(f => ({ ...f, dateTo: (e.target as HTMLInputElement).value }))}
          />
        </div>
      </Card>

      {report.isLoading && (
        <div class="space-y-3 mt-3">
          <Skeleton class="h-20 w-full" />
          <Skeleton class="h-64 w-full" />
        </div>
      )}

      {!report.isLoading && !report.data && (
        <EmptyState
          icon={<TrendingDown size={20} />}
          title="Selecione um funil"
          description="Escolha um funil acima para visualizar a análise de conversão."
        />
      )}

      {report.data && (
        <>
          <section class="grid gap-3 grid-cols-2 lg:grid-cols-4 mt-3">
            <KpiCard
              label="Leads entraram no período"
              value={intf.format(report.data.kpis.totalEntered)}
              icon={<Users size={16} />}
              hint="Criados no funil entre as datas selecionadas"
            />
            <KpiCard
              label="Ganhos"
              value={intf.format(report.data.kpis.wonCount)}
              icon={<Trophy size={16} />}
              hint="Movimentações para etapa terminal 'won'"
            />
            <KpiCard
              label="Taxa de conversão"
              value={pctf.format(report.data.kpis.conversionRate)}
              icon={<Percent size={16} />}
              hint={report.data.kpis.conversionRate >= 0.1 ? 'Saudável' : report.data.kpis.conversionRate > 0 ? 'Baixa' : 'Sem ganho no período'}
            />
            <KpiCard
              label="Gargalos detectados"
              value={intf.format(report.data.kpis.bottleneckCount)}
              icon={<AlertTriangle size={16} />}
              hint={report.data.kpis.bottleneckCount > 0 ? 'Etapas com queda > 50% vs melhor' : 'Sem gargalos críticos'}
            />
          </section>

          {/* Funil visual */}
          <Card class="p-3 mt-3">
            <div class="text-xs uppercase tracking-wider text-fg-subtle font-semibold mb-3 flex items-center gap-1">
              <TrendingDown size={11} /> Funil — leads e tempo por etapa
            </div>
            {stages.length === 0 && (
              <div class="text-sm text-fg-muted py-4">Funil sem etapas ativas.</div>
            )}
            <div class="space-y-2">
              {stages.map((s, i) => {
                const width = (Math.max(s.entriesInPeriod, s.currentCount) / maxEntries) * 100
                const isTerminal = !!s.terminalKind
                const widthCss = `${Math.max(width, 4)}%`
                return (
                  <div key={s.key}>
                    <div class="flex items-center justify-between gap-2 mb-1 text-xs">
                      <div class="flex items-center gap-2">
                        <span class="text-fg-subtle tabular-nums">#{i + 1}</span>
                        <span class="font-medium text-fg">{s.name}</span>
                        {isTerminal && <Badge tone={s.terminalKind === 'won' ? 'success' : 'danger'}>{s.terminalKind === 'won' ? 'GANHO' : 'PERDIDO'}</Badge>}
                      </div>
                      <div class="flex items-center gap-3 text-fg-muted">
                        <span title="Leads atualmente nesta etapa">
                          {intf.format(s.currentCount)} <span class="text-fg-subtle">agora</span>
                        </span>
                        <span title="Entradas durante o período">
                          {intf.format(s.entriesInPeriod)} <span class="text-fg-subtle">no período</span>
                        </span>
                        <span title="Tempo médio que leads ficam nesta etapa" class="flex items-center gap-0.5">
                          <Clock size={10} /> {formatDuration(s.avgTimeInStageSec)}
                        </span>
                      </div>
                    </div>
                    <div class="h-7 bg-surface-2 rounded-md overflow-hidden">
                      <div
                        class="h-full rounded-md flex items-center justify-end pr-2 text-xs font-semibold text-white"
                        style={{ width: widthCss, backgroundColor: s.color || '#1a73e8' }}
                      >
                        {width > 10 && intf.format(s.entriesInPeriod)}
                      </div>
                    </div>
                    {/* Conversão para próxima etapa */}
                    {i < stages.length - 1 && (() => {
                      const conv = report.data!.conversions.find(c => c.fromKey === s.key)
                      if (!conv) return null
                      return (
                        <div class={`flex items-center gap-2 pl-6 mt-1 mb-1 text-[0.6875rem] ${conv.bottleneck ? 'text-danger' : 'text-fg-subtle'}`}>
                          <ChevronDown size={11} />
                          <span>{intf.format(conv.count)} avançaram para "{conv.toName}"</span>
                          <Badge tone={conv.bottleneck ? 'danger' : conv.rate >= 0.5 ? 'success' : conv.rate >= 0.2 ? 'warning' : 'neutral'}>
                            {pctf.format(conv.rate)}
                          </Badge>
                          {conv.bottleneck && <span class="font-semibold flex items-center gap-1"><AlertTriangle size={10} /> gargalo</span>}
                        </div>
                      )
                    })()}
                  </div>
                )
              })}
            </div>
          </Card>

          {/* Tabela de conversões pares */}
          {report.data.conversions.length > 0 && (
            <Card class="p-3 mt-3">
              <div class="text-xs uppercase tracking-wider text-fg-subtle font-semibold mb-2 flex items-center gap-1">
                <ChevronRight size={11} /> Taxa de conversão entre etapas
              </div>
              <div class="overflow-x-auto">
                <table class="w-full text-xs">
                  <thead class="text-fg-muted">
                    <tr>
                      <th class="text-left py-1.5">De</th>
                      <th class="text-left py-1.5"></th>
                      <th class="text-left py-1.5">Para</th>
                      <th class="text-right py-1.5">Avançaram</th>
                      <th class="text-right py-1.5">Taxa</th>
                      <th class="text-right py-1.5">Status</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-border">
                    {report.data.conversions.map(p => (
                      <tr key={`${p.fromKey}::${p.toKey}`}>
                        <td class="py-1.5 text-fg">{p.fromName}</td>
                        <td class="py-1.5 text-fg-subtle"><ChevronRight size={11} /></td>
                        <td class="py-1.5 text-fg">{p.toName}</td>
                        <td class="py-1.5 text-right tabular-nums text-fg-muted">{intf.format(p.count)}</td>
                        <td class="py-1.5 text-right tabular-nums">
                          <Badge tone={p.bottleneck ? 'danger' : p.rate >= 0.5 ? 'success' : p.rate >= 0.2 ? 'warning' : 'neutral'} solid={p.bottleneck}>
                            {pctf.format(p.rate)}
                          </Badge>
                        </td>
                        <td class="py-1.5 text-right">
                          {p.bottleneck ? <span class="text-danger">⚠ gargalo</span> : <span class="text-fg-subtle">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Origens dos leads */}
          {report.data.sources.length > 0 && (
            <Card class="p-3 mt-3">
              <div class="text-xs uppercase tracking-wider text-fg-subtle font-semibold mb-2 flex items-center gap-1">
                <FilterIcon size={11} /> Origens dos leads do período
              </div>
              <div class="space-y-1.5">
                {report.data.sources.slice(0, 10).map(s => {
                  const max = report.data!.sources[0]?.count ?? 1
                  const pct = (s.count / max) * 100
                  return (
                    <div key={s.source} class="flex items-center gap-2 text-xs">
                      <span class="text-fg w-32 truncate" title={s.source}>{leadSourceLabel(s.source)}</span>
                      <div class="flex-1 h-3 bg-surface-3 rounded overflow-hidden">
                        <div class="h-full bg-info/60" style={{ width: `${pct}%` }} />
                      </div>
                      <span class="tabular-nums text-fg-muted w-12 text-right">{intf.format(s.count)}</span>
                    </div>
                  )
                })}
              </div>
            </Card>
          )}
        </>
      )}

      <HowItWorksModal
        open={showHowItWorks}
        onClose={() => setShowHowItWorks(false)}
        title="Como funciona o Funil de Conversão?"
        problem={<>
          O Kanban mostra <em>onde os leads estão agora</em>. Este relatório mostra <strong>como eles
          se moveram</strong>: quantos entraram, quantos avançaram, quantos travaram. Identifica o
          <strong> ponto de fuga</strong>: a etapa onde você perde mais gente.
        </>}
        steps={[
          {
            title: '📊 Visualização do funil',
            body: <>Cada etapa vira uma barra com 2 números: leads que <strong>estão agora</strong> nela + leads que <strong>entraram</strong> no período. A largura da barra mostra volume.</>,
          },
          {
            title: '📉 Taxa de conversão entre etapas',
            body: <>Entre uma etapa e a próxima, um percentual: <em>"de 100 leads que chegaram em Contato, 60% avançaram pra Qualificado"</em>. Quanto menor o número, maior o gargalo.</>,
          },
          {
            title: '⏱️ Tempo médio por etapa',
            body: <>Quanto tempo o lead <strong>tipicamente passa</strong> em cada etapa. Útil pra: detectar etapas que travam (lead fica 30 dias em "Proposta"?) e ajustar follow-up.</>,
          },
          {
            title: '⚠️ Gargalo automático',
            body: <>O sistema sinaliza a etapa com a <strong>pior taxa de saída</strong>. É a etapa onde você deve focar pra melhorar conversão geral (Pareto: melhorar 1 etapa pode subir 30% no fechamento).</>,
          },
          {
            title: '🗓️ Compare períodos',
            body: <>Mude o intervalo de datas pra ver se o funil melhorou ou piorou comparando mês a mês. Boa pra avaliar o impacto de mudanças (novo script, treinamento, nova oferta).</>,
          },
        ]}
        tip={{
          tone: 'info',
          title: '💡 Análise prática',
          body: <>Se o gargalo é <strong>"Qualificado → Proposta"</strong>, talvez você precise melhorar o pitch de proposta. Se é <strong>"Proposta → Fechado"</strong>, talvez o problema seja preço ou prazo. O relatório mostra <em>onde</em>; você descobre <em>o porquê</em> olhando os motivos de perda.</>,
        }}
      />
    </Page>
  )
}
