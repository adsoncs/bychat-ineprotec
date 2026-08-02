import { Activity, AlertTriangle, ShieldCheck, RefreshCw, Database, ServerCrash, Clock, Search } from 'lucide-preact'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { KpiCard } from '@/components/ui/KpiCard'
import { Skeleton } from '@/components/ui/Skeleton'
import { useAdminEnrichmentStats, useRerunStale, useSocialSearchSetting, useSetSocialSearch } from '@/hooks/useIntelligence'
import { toast } from '@/lib/toast'

export function OperatorPanel() {
  const { data, isLoading, refetch, isFetching } = useAdminEnrichmentStats()
  const rerun = useRerunStale()

  if (isLoading) {
    return (
      <div class="space-y-3">
        <Skeleton class="h-24 w-full" />
        <Skeleton class="h-40 w-full" />
        <Skeleton class="h-40 w-full" />
      </div>
    )
  }
  if (!data) return null

  const { providers, runsLast24h, topDisputedLeads, dailyRuns, lgpdAudit } = data
  const totalRuns24h = runsLast24h.done + runsLast24h.partial + runsLast24h.failed
  const successRate = totalRuns24h > 0 ? Math.round((runsLast24h.done / totalRuns24h) * 100) : 100

  return (
    <div class="space-y-3">
      {/* Toolbar */}
      <div class="flex items-center justify-between gap-2 flex-wrap">
        <div class="text-xs text-fg-muted flex items-center gap-1">
          <Activity size={12} /> Observabilidade do motor de enrichment
        </div>
        <div class="flex items-center gap-1.5">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => rerun.mutate(undefined, {
              onSuccess: (r) => toast(`${r.enqueued} leads enfileirados para reenriquecimento`, 'success'),
              onError: (e: unknown) => toast((e as Error).message, 'danger'),
            })}
            disabled={rerun.isPending}
          >
            <RefreshCw size={12} class={rerun.isPending ? 'animate-spin' : ''} /> Rodar sweep agora
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void refetch()}
            disabled={isFetching}
            aria-label="Atualizar"
          >
            <RefreshCw size={12} class={isFetching ? 'animate-spin' : ''} /> Atualizar
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <section class="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Runs (24h)" value={totalRuns24h} icon={<Activity size={16} />} />
        <KpiCard label="Taxa de sucesso" value={`${successRate}%`} icon={<ShieldCheck size={16} />} hint={`${runsLast24h.done} done · ${runsLast24h.partial} partial · ${runsLast24h.failed} failed`} />
        <KpiCard label="Erros (24h)" value={runsLast24h.totalErrors} icon={<ServerCrash size={16} />} />
        <KpiCard label="Providers ativos" value={providers.length} icon={<Database size={16} />} />
      </section>

      <SocialSearchToggle />


      {/* Auditoria LGPD */}
      <Card class="p-3">
        <div class="text-xs uppercase tracking-wider text-fg-subtle font-semibold mb-2 flex items-center gap-1">
          <ShieldCheck size={11} /> Origem dos consentimentos LGPD
        </div>
        <div class="grid gap-3 grid-cols-1 sm:grid-cols-3 text-xs">
          <div class="p-2 rounded-md bg-success/10 border border-success/30">
            <div class="text-success font-semibold tabular-nums text-base">{lgpdAudit.titular}</div>
            <div class="text-fg-muted">Titular consentiu</div>
          </div>
          <div class="p-2 rounded-md bg-warning/10 border border-warning/30">
            <div class="text-warning font-semibold tabular-nums text-base">{lgpdAudit.operatorOverride}</div>
            <div class="text-fg-muted">Operator override</div>
            <div class="text-fg-subtle text-[0.6875rem] mt-0.5">Operador assumiu base legal</div>
          </div>
          <div class="p-2 rounded-md bg-surface-3 border border-border">
            <div class="text-fg-muted font-semibold tabular-nums text-base">{lgpdAudit.legacy}</div>
            <div class="text-fg-muted">Legacy</div>
            <div class="text-fg-subtle text-[0.6875rem] mt-0.5">Origem desconhecida — revalidar se questionado</div>
          </div>
        </div>
      </Card>

      {/* Saúde dos providers */}
      <Card class="p-3">
        <div class="text-xs uppercase tracking-wider text-fg-subtle font-semibold mb-2 flex items-center gap-1">
          <Database size={11} /> Saúde dos providers
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-xs">
            <thead class="text-fg-muted">
              <tr>
                <th class="text-left py-1.5">Provider</th>
                <th class="text-right py-1.5">Fatos ativos</th>
                <th class="text-right py-1.5">Contestados</th>
                <th class="text-right py-1.5">Confiança média</th>
                <th class="text-right py-1.5">Confiabilidade</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-border">
              {providers.map(p => (
                <tr key={p.source}>
                  <td class="py-1.5 font-mono text-fg">{p.source}</td>
                  <td class="text-right tabular-nums text-fg">{p.activeFacts}</td>
                  <td class="text-right tabular-nums">
                    <span class={p.disputedFacts > 0 ? 'text-danger' : 'text-fg-subtle'}>{p.disputedFacts}</span>
                  </td>
                  <td class="text-right tabular-nums text-fg-muted">{p.avgConfidence !== null ? `${p.avgConfidence}%` : '—'}</td>
                  <td class="text-right">
                    <Badge tone={p.trustRate >= 95 ? 'success' : p.trustRate >= 80 ? 'warning' : 'danger'}>
                      {p.trustRate}%
                    </Badge>
                  </td>
                </tr>
              ))}
              {providers.length === 0 && (
                <tr><td colSpan={5} class="text-center py-4 text-fg-muted">Sem fatos coletados ainda.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Erros por provider (24h) */}
      {runsLast24h.errorsByProvider.length > 0 && (
        <Card class="p-3">
          <div class="text-xs uppercase tracking-wider text-fg-subtle font-semibold mb-2 flex items-center gap-1">
            <AlertTriangle size={11} /> Erros por provider (últimas 24h)
          </div>
          <div class="space-y-1.5">
            {runsLast24h.errorsByProvider.map(e => {
              const max = runsLast24h.errorsByProvider[0]?.count ?? 1
              const pct = (e.count / max) * 100
              return (
                <div key={e.provider} class="flex items-center gap-2 text-xs">
                  <span class="text-fg w-24 truncate font-mono">{e.provider}</span>
                  <div class="flex-1 h-3 bg-surface-3 rounded overflow-hidden">
                    <div class="h-full bg-danger/60" style={{ width: `${pct}%` }} />
                  </div>
                  <span class="tabular-nums text-fg-muted w-10 text-right">{e.count}</span>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {/* Daily runs */}
      <Card class="p-3">
        <div class="text-xs uppercase tracking-wider text-fg-subtle font-semibold mb-2 flex items-center gap-1">
          <Clock size={11} /> Runs por dia (últimos 7 dias)
        </div>
        <div class="flex items-end gap-1 h-24">
          {dailyRuns.length === 0 ? (
            <div class="text-xs text-fg-muted">Sem runs nos últimos 7 dias.</div>
          ) : dailyRuns.map(d => {
            const max = Math.max(...dailyRuns.map(x => x.count), 1)
            const pct = (d.count / max) * 100
            return (
              <div key={d.day} class="flex-1 flex flex-col items-center gap-1 min-w-0">
                <div class="text-[0.6875rem] text-fg-muted tabular-nums">{d.count}</div>
                <div class="w-full bg-surface-3 rounded-t" style={{ height: `${Math.max(4, pct)}%` }}>
                  <div class="h-full bg-info rounded-t" />
                </div>
                <div class="text-[0.6875rem] text-fg-subtle tabular-nums">{d.day.slice(5)}</div>
              </div>
            )
          })}
        </div>
      </Card>

      {/* Top leads contestados */}
      {topDisputedLeads.length > 0 && (
        <Card class="p-3">
          <div class="text-xs uppercase tracking-wider text-fg-subtle font-semibold mb-2 flex items-center gap-1">
            <AlertTriangle size={11} /> Leads com mais fatos contestados
          </div>
          <ul class="divide-y divide-border">
            {topDisputedLeads.map(l => (
              <li key={l.leadId} class="py-1.5 flex items-center gap-2 text-xs">
                <span class="text-fg-subtle">#{l.leadId}</span>
                <span class="text-fg flex-1 truncate">{l.nome ?? l.empresa ?? '—'}</span>
                <Badge tone="danger" solid>{l.disputedCount} contestado(s)</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}

function SocialSearchToggle() {
  const { data } = useSocialSearchSetting()
  const setIt = useSetSocialSearch()
  const enabled = data?.enabled ?? false
  return (
    <Card class="p-3">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="text-xs uppercase tracking-wider text-fg-subtle font-semibold mb-1 flex items-center gap-1">
            <Search size={11} /> Busca social por nome
          </div>
          <p class="text-[0.6875rem] text-fg-muted leading-relaxed">
            Procura LinkedIn/Instagram/etc pelo <strong>nome</strong> do lead. Como nome não identifica
            alguém com certeza, os achados entram como <strong>"candidatos a verificar"</strong> (fora do
            dossiê/score) para o agente confirmar. <strong>Desligado</strong> = sem descoberta social por
            nome (zero risco de perfil errado). O enriquecimento ancorado (CNPJ, telefone, e-mail) continua normal.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          disabled={setIt.isPending}
          onClick={() => setIt.mutate(!enabled, {
            onSuccess: (r) => toast(r.enabled ? 'Busca social ligada' : 'Busca social desligada', 'success'),
            onError: () => toast('Falha ao salvar', 'danger'),
          })}
          class={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${enabled ? 'bg-accent' : 'bg-surface-3'}`}
        >
          <span class={`inline-block size-4 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
      </div>
    </Card>
  )
}
