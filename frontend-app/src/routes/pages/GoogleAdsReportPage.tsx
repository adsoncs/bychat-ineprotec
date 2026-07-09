import { useMemo, useState } from 'preact/hooks'
import {
  DollarSign, Users, MousePointerClick, RefreshCw, Eye, Target,
  Coins, ShoppingBag, Percent, TrendingUp, AlertCircle, HelpCircle,
} from 'lucide-preact'
import { HowItWorksModal } from '@/components/ui/HowItWorksModal'
import {
  useGoogleAdsReportDashboard,
  useGoogleAdsReportCampaigns,
  useSyncGoogleAdsInsights,
  type GoogleAdsReportFilters,
} from '@/hooks/useGoogleAdsReport'
import { useGoogleAdsConfig } from '@/hooks/useGoogleAds'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { KpiCard } from '@/components/ui/KpiCard'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input, Select } from '@/components/ui/Input'
import { toast } from '@/lib/toast'

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const intf = new Intl.NumberFormat('pt-BR')

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

const PRESETS: Array<{ label: string; range: () => { from: string; to: string } }> = [
  { label: '7 dias', range: () => ({ from: daysAgo(7), to: daysAgo(1) }) },
  { label: '30 dias', range: () => ({ from: daysAgo(30), to: daysAgo(1) }) },
  { label: '90 dias', range: () => ({ from: daysAgo(90), to: daysAgo(1) }) },
]

export function GoogleAdsReportPage() {
  const [filters, setFilters] = useState<GoogleAdsReportFilters>({
    dateFrom: daysAgo(30),
    dateTo: daysAgo(1),
  })
  const [view, setView] = useState<'campaigns' | 'adGroups' | 'ads' | 'keywords'>('campaigns')

  const { data: configs } = useGoogleAdsConfig()
  const dashboardQ = useGoogleAdsReportDashboard(filters)
  const campaignsQ = useGoogleAdsReportCampaigns()
  const sync = useSyncGoogleAdsInsights()
  const [lastSyncError, setLastSyncError] = useState<string | null>(null)
  const [showHowItWorks, setShowHowItWorks] = useState(false)

  const accounts = configs?.data ?? []
  const selectedCustomerId = filters.customerId
    || (accounts.length === 1 ? (accounts[0]?.customerId ?? '') : '')

  function setRange(range: { from: string; to: string }) {
    setFilters(f => ({ ...f, dateFrom: range.from, dateTo: range.to }))
  }

  function handleSync() {
    const cid = selectedCustomerId
    if (!cid) {
      toast('Selecione uma conta Google Ads primeiro', 'danger')
      return
    }
    sync.mutate(
      { customerId: cid, dateFrom: filters.dateFrom, dateTo: filters.dateTo },
      {
        onSuccess: (r) => {
          const allErrors = r.summary.results.flatMap(x => x.errors)
          const totalApiRows = r.summary.results.reduce((s, x) => s + x.rowsFromApi, 0)
          if (r.summary.totalUpserted > 0) {
            setLastSyncError(null)
            toast(`Sincronizado: ${r.summary.totalUpserted} linhas (${totalApiRows} do Google)`, 'success')
          } else if (allErrors.length > 0) {
            const first = allErrors[0] ?? 'Erro desconhecido'
            setLastSyncError(first)
            toast(`Sync falhou: ${first.substring(0, 120)}`, 'danger')
          } else {
            setLastSyncError(null)
            toast('Sync ok, mas não veio nenhum dado do Google no período (sem gastos / sem campanhas ativas?)', 'warning' as any)
          }
        },
        onError: (e: unknown) => {
          const msg = (e as Error).message
          setLastSyncError(msg)
          toast(msg, 'danger')
        },
      },
    )
  }

  function syncErrorIsDevTokenNotApproved(msg: string): boolean {
    return /DEVELOPER_TOKEN_NOT_APPROVED|test accounts.+apply for Basic/i.test(msg)
  }
  function syncErrorIsCustomerNotEnabled(msg: string): boolean {
    return /CUSTOMER_NOT_ENABLED|not yet enabled|deactivated/i.test(msg)
  }

  const kpis = dashboardQ.data?.kpis
  const breakdown = useMemo(() => {
    if (!dashboardQ.data) return []
    if (view === 'campaigns') return dashboardQ.data.campaigns
    if (view === 'adGroups') return dashboardQ.data.adGroups
    if (view === 'ads') return dashboardQ.data.ads
    return []
  }, [dashboardQ.data, view])
  const keywords = dashboardQ.data?.keywords ?? []

  return (
    <Page
      title="Relatórios Google Ads"
      description="Custo, cliques, leads e ROAS plugados com leads que chegaram via GCLID. Sincronizado da API do Google Ads."
      actions={
        <div class="flex items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={() => setShowHowItWorks(true)}>
            <HelpCircle size={14} /> Como funciona?
          </Button>
          <Button variant="secondary" size="sm" onClick={handleSync} disabled={sync.isPending || !selectedCustomerId}>
            <RefreshCw size={12} class={sync.isPending ? 'animate-spin' : ''} />
            {sync.isPending ? 'Sincronizando…' : 'Sincronizar agora'}
          </Button>
        </div>
      }
    >
      {accounts.length === 0 && (
        <Card class="border-warning/40 bg-warning/10">
          <div class="flex items-start gap-3">
            <AlertCircle size={18} class="text-warning shrink-0 mt-0.5" />
            <div class="flex-1">
              <div class="text-sm font-semibold text-fg">Nenhuma conta Google Ads conectada</div>
              <p class="text-xs text-fg-muted mt-1">
                Conecte uma conta em <strong>Google Ads</strong> (no menu) antes de poder sincronizar relatórios aqui.
              </p>
              <Button variant="primary" size="sm" class="mt-2" onClick={() => window.location.assign('/app/google-ads')}>
                Ir para Google Ads
              </Button>
            </div>
          </div>
        </Card>
      )}

      {lastSyncError && syncErrorIsDevTokenNotApproved(lastSyncError) && (
        <Card class="border-danger/40 bg-danger/10 mb-3">
          <div class="flex items-start gap-3">
            <AlertCircle size={18} class="text-danger shrink-0 mt-0.5" />
            <div class="flex-1 text-sm">
              <div class="font-semibold text-fg">Developer Token em modo Teste</div>
              <p class="text-xs text-fg-muted mt-1">
                O Google rejeitou a sincronização porque o seu <strong>Developer Token</strong> ainda não tem acesso a contas de produção
                (ele responde <code class="font-mono text-[0.6875rem]">DEVELOPER_TOKEN_NOT_APPROVED</code>).
                Para usar com contas reais é preciso solicitar promoção para <strong>Basic access</strong> dentro do Google Ads:
              </p>
              <ol class="text-xs text-fg-muted mt-2 ml-4 list-decimal space-y-1">
                <li>Acesse ads.google.com com a conta MCC dona do token</li>
                <li>Ferramentas e Configurações → Configuração → <strong>Central de API</strong></li>
                <li>Na linha do Developer Token, clique em <strong>"Solicitar acesso básico"</strong></li>
                <li>Preencha o formulário (uso pretendido, volume, descrição) — aprovação demora 1–3 dias</li>
                <li>Depois de aprovado, o mesmo token aqui passa a funcionar. Não precisa reconectar nada.</li>
              </ol>
              <p class="text-[0.6875rem] text-fg-subtle mt-2">
                Para testar enquanto a aprovação não sai, crie uma <strong>conta de teste</strong> no Google Ads (Conta → Criar conta de teste) e conecte ela.
              </p>
            </div>
          </div>
        </Card>
      )}

      {lastSyncError && syncErrorIsCustomerNotEnabled(lastSyncError) && !syncErrorIsDevTokenNotApproved(lastSyncError) && (
        <Card class="border-warning/40 bg-warning/10 mb-3">
          <div class="flex items-start gap-3">
            <AlertCircle size={18} class="text-warning shrink-0 mt-0.5" />
            <div class="flex-1 text-sm">
              <div class="font-semibold text-fg">Conta Google Ads não habilitada</div>
              <p class="text-xs text-fg-muted mt-1">
                O Google retornou <code class="font-mono text-[0.6875rem]">CUSTOMER_NOT_ENABLED</code> para o customer ID selecionado —
                a conta está pausada, sem método de pagamento configurado, ou ainda em criação.
                Acesse o Google Ads, conclua a configuração da conta (incluindo billing) e tente novamente.
              </p>
            </div>
          </div>
        </Card>
      )}

      {lastSyncError && !syncErrorIsDevTokenNotApproved(lastSyncError) && !syncErrorIsCustomerNotEnabled(lastSyncError) && (
        <Card class="border-danger/40 bg-danger/10 mb-3">
          <div class="flex items-start gap-3">
            <AlertCircle size={18} class="text-danger shrink-0 mt-0.5" />
            <div class="flex-1 text-sm">
              <div class="font-semibold text-fg">Falha na última sincronização</div>
              <p class="text-xs text-fg-muted mt-1 font-mono break-words">{lastSyncError}</p>
            </div>
          </div>
        </Card>
      )}

      {/* Filtros */}
      <Card class="p-3">
        <div class="flex flex-wrap items-end gap-2">
          {accounts.length > 1 && (
            <Select
              label="Conta"
              value={filters.customerId ?? ''}
              onChange={(e) => setFilters(f => ({ ...f, customerId: (e.target as HTMLSelectElement).value || undefined }))}
            >
              <option value="">Todas</option>
              {accounts.map(a => <option key={a.id} value={a.customerId}>{a.customerId}</option>)}
            </Select>
          )}
          <Input
            label="De"
            type="date"
            value={filters.dateFrom ?? ''}
            onInput={(e) => setFilters(f => ({ ...f, dateFrom: (e.target as HTMLInputElement).value }))}
          />
          <Input
            label="Até"
            type="date"
            value={filters.dateTo ?? ''}
            onInput={(e) => setFilters(f => ({ ...f, dateTo: (e.target as HTMLInputElement).value }))}
          />
          {!campaignsQ.isLoading && campaignsQ.data && campaignsQ.data.data.length > 0 && (
            <Select
              label="Campanha"
              value={filters.campaignId ?? ''}
              onChange={(e) => setFilters(f => ({ ...f, campaignId: (e.target as HTMLSelectElement).value || undefined }))}
            >
              <option value="">Todas</option>
              {campaignsQ.data.data.map(c => (
                <option key={c.campaignId} value={c.campaignId}>{c.campaignName}</option>
              ))}
            </Select>
          )}
          <div class="flex items-center gap-1 ml-auto">
            {PRESETS.map(p => (
              <Button key={p.label} variant="ghost" size="sm" onClick={() => setRange(p.range())}>
                {p.label}
              </Button>
            ))}
          </div>
        </div>
      </Card>

      {/* KPIs */}
      <section class="grid gap-3 grid-cols-2 lg:grid-cols-4 mt-3">
        {dashboardQ.isLoading || !kpis ? (
          Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} class="h-20 w-full" />)
        ) : (
          <>
            <KpiCard label="Investido" value={brl.format(kpis.totalSpend)} icon={<DollarSign size={16} />} />
            <KpiCard label="Impressões" value={intf.format(kpis.totalImpressions)} icon={<Eye size={16} />} />
            <KpiCard label="Cliques" value={intf.format(kpis.totalClicks)} icon={<MousePointerClick size={16} />} hint={kpis.cpc > 0 ? `CPC ${brl.format(kpis.cpc)}` : ''} />
            <KpiCard label="Conversões (Google)" value={intf.format(Math.round(kpis.totalConversions))} icon={<Target size={16} />} />
            <KpiCard label="Leads (GCLID)" value={intf.format(kpis.totalLeads)} icon={<Users size={16} />} hint={kpis.cpl > 0 ? `CPL ${brl.format(kpis.cpl)}` : ''} />
            <KpiCard label="Vendas" value={intf.format(kpis.totalSales)} icon={<ShoppingBag size={16} />} />
            <KpiCard label="Receita" value={brl.format(kpis.totalRevenue)} icon={<Coins size={16} />} />
            <KpiCard
              label="ROAS / ROI"
              value={`${kpis.roas.toFixed(2)}x`}
              icon={<TrendingUp size={16} />}
              hint={`ROI ${(kpis.roi * 100).toFixed(1)}%`}
            />
          </>
        )}
      </section>

      {/* Breakdown selector */}
      <div class="flex items-center gap-1 mt-4 border-b border-border">
        {(['campaigns', 'adGroups', 'keywords', 'ads'] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            class={`h-9 px-3 -mb-px text-xs font-medium border-b-2 transition-colors ${
              view === v ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:text-fg'
            }`}
          >
            {v === 'campaigns' ? 'Campanhas' : v === 'adGroups' ? 'Grupos de anúncios' : v === 'keywords' ? 'Palavras-chave' : 'Anúncios'}
            <span class="ml-1 text-fg-subtle">({dashboardQ.data ? (v === 'campaigns' ? dashboardQ.data.campaigns.length : v === 'adGroups' ? dashboardQ.data.adGroups.length : v === 'keywords' ? dashboardQ.data.keywords.length : dashboardQ.data.ads.length) : 0})</span>
          </button>
        ))}
      </div>

      <Card class="p-0 overflow-hidden mt-3">
        {dashboardQ.isLoading ? (
          <Skeleton class="h-48 w-full" />
        ) : (view === 'keywords' ? keywords.length === 0 : breakdown.length === 0) ? (
          <EmptyState
            icon={<Percent size={20} />}
            title="Sem dados no período"
            description={view === 'keywords'
              ? 'Nenhum lead com palavra-chave no período. Configure o ValueTrack no Google Ads e/ou sincronize (o enriquecimento por gclid resolve as keywords automaticamente).'
              : 'Sincronize com a API do Google Ads (botão acima) ou ajuste o período do filtro.'}
          />
        ) : view === 'keywords' ? (
          <div class="overflow-x-auto">
            <table class="w-full text-xs">
              <thead class="text-fg-muted bg-surface-2">
                <tr>
                  <th class="text-left px-3 py-2">Palavra-chave</th>
                  <th class="text-left px-3 py-2">Campanha</th>
                  <th class="text-right px-3 py-2">Cliques</th>
                  <th class="text-right px-3 py-2">Investido</th>
                  <th class="text-right px-3 py-2">Leads</th>
                  <th class="text-right px-3 py-2">Vendas</th>
                  <th class="text-right px-3 py-2">Receita</th>
                  <th class="text-right px-3 py-2">ROAS</th>
                  <th class="text-right px-3 py-2">CPL</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-border">
                {keywords.map((r, i) => (
                  <tr key={`${r.keyword}-${i}`} class="hover:bg-surface-2">
                    <td class="px-3 py-2 text-fg font-medium truncate max-w-[18rem]" title={r.keyword}>{r.keyword}</td>
                    <td class="px-3 py-2 text-fg-muted truncate max-w-[14rem]" title={r.campaignName || ''}>{r.campaignName || '—'}</td>
                    <td class="px-3 py-2 text-right tabular-nums text-fg-muted">{intf.format(r.clicks)}</td>
                    <td class="px-3 py-2 text-right tabular-nums text-fg">{brl.format(r.spend)}</td>
                    <td class="px-3 py-2 text-right tabular-nums text-fg">{intf.format(r.leads)}</td>
                    <td class="px-3 py-2 text-right tabular-nums text-fg-muted">{intf.format(r.sales)}</td>
                    <td class="px-3 py-2 text-right tabular-nums text-fg">{brl.format(r.revenue)}</td>
                    <td class="px-3 py-2 text-right tabular-nums">
                      <span class={r.roas >= 1 ? 'text-success' : 'text-fg-muted'}>{r.spend > 0 ? `${r.roas.toFixed(2)}x` : '—'}</span>
                    </td>
                    <td class="px-3 py-2 text-right tabular-nums text-fg-muted">{r.cpl > 0 ? brl.format(r.cpl) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div class="overflow-x-auto">
            <table class="w-full text-xs">
              <thead class="text-fg-muted bg-surface-2">
                <tr>
                  <th class="text-left px-3 py-2">Nome</th>
                  <th class="text-right px-3 py-2">Cliques</th>
                  <th class="text-right px-3 py-2">Investido</th>
                  <th class="text-right px-3 py-2">Leads</th>
                  <th class="text-right px-3 py-2">Vendas</th>
                  <th class="text-right px-3 py-2">Receita</th>
                  <th class="text-right px-3 py-2">ROAS</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-border">
                {breakdown.map(r => {
                  const label = view === 'campaigns'
                    ? r.campaignName
                    : view === 'adGroups'
                      ? `${r.adGroupName || r.adGroupId} · ${r.campaignName}`
                      : `${r.adName || r.adId} · ${r.adGroupName || r.adGroupId}`
                  const roas = r.roas ?? 0
                  return (
                    <tr key={r.key} class="hover:bg-surface-2">
                      <td class="px-3 py-2 text-fg truncate max-w-[24rem]" title={label}>{label}</td>
                      <td class="px-3 py-2 text-right tabular-nums text-fg-muted">{intf.format(r.clicks)}</td>
                      <td class="px-3 py-2 text-right tabular-nums text-fg">{brl.format(r.spend)}</td>
                      <td class="px-3 py-2 text-right tabular-nums text-fg">{intf.format(r.leads ?? 0)}</td>
                      <td class="px-3 py-2 text-right tabular-nums text-fg-muted">{intf.format(r.sales ?? 0)}</td>
                      <td class="px-3 py-2 text-right tabular-nums text-fg">{brl.format(r.revenue ?? 0)}</td>
                      <td class="px-3 py-2 text-right tabular-nums">
                        <span class={roas >= 1 ? 'text-success' : 'text-fg-muted'}>{r.spend > 0 ? `${roas.toFixed(2)}x` : '—'}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Daily breakdown como barras simples */}
      {dashboardQ.data && dashboardQ.data.daily.length > 0 && (
        <Card class="p-3 mt-3">
          <div class="text-xs uppercase tracking-wider text-fg-subtle font-semibold mb-2">
            Investimento por dia
          </div>
          <div class="flex items-end gap-1 h-32">
            {dashboardQ.data.daily.map(d => {
              const max = Math.max(...dashboardQ.data!.daily.map(x => x.spend), 1)
              const pct = (d.spend / max) * 100
              return (
                <div key={d.date} class="flex-1 flex flex-col items-center gap-1 min-w-0" title={`${d.date}: ${brl.format(d.spend)}`}>
                  <div class="w-full bg-surface-3 rounded-t" style={{ height: `${Math.max(4, pct)}%` }}>
                    <div class="h-full bg-info rounded-t" />
                  </div>
                  <div class="text-[0.625rem] text-fg-subtle tabular-nums">{d.date.slice(5)}</div>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      <HowItWorksModal
        open={showHowItWorks}
        onClose={() => setShowHowItWorks(false)}
        title="Como funciona o Relatório Google Ads?"
        problem={<>
          O Google Ads mostra cliques e conversões, mas pra ele "conversão" pode ser só preencher
          formulário — não venda real. Este relatório <strong>cruza os dados do Google com leads que
          viraram receita</strong> no seu CRM, e mostra <strong>ROAS verdadeiro</strong> por campanha.
        </>}
        steps={[
          {
            title: '🔄 Sincronize com o Google',
            body: <>Botão <strong>Sincronizar agora</strong> roda uma query <strong>GAQL</strong> no Google Ads pra trazer impressões, cliques, custo e conversões da conta no período escolhido.</>,
          },
          {
            title: '🔗 Cruza por GCLID',
            body: <>O sistema casa cada clique (gclid) com leads do CRM que vieram com aquele identificador. Lead virou venda? O ROAS daquela campanha sobe.</>,
          },
          {
            title: '📊 KPIs principais',
            body: <>Custo total, cliques, CPC, leads, custo por lead (CPL), vendas, receita, ROAS, ROI. Todos calculados em tempo real, sem precisar abrir o Google.</>,
          },
          {
            title: '🔍 Drill por campanha/grupo/anúncio',
            body: <>Alterne entre <strong>Campanhas / Grupos de anúncios / Anúncios</strong>. Cada nível mostra performance pra você identificar o que escalar e o que pausar.</>,
          },
          {
            title: '📈 Tendência diária',
            body: <>Gráfico de barras por dia: investimento vs. receita gerada. Vê de cara qual dia foi rentável e qual foi prejuízo.</>,
          },
        ]}
        tip={{
          tone: 'info',
          title: '💡 Pré-requisito',
          body: <>Pra dados aparecerem, você precisa: (1) ter <strong>conta Google Ads conectada</strong> em Integrações, (2) ter <strong>conversões offline</strong> sendo enviadas, (3) selecionar a Customer ID correta no filtro.</>,
        }}
      />
    </Page>
  )
}
