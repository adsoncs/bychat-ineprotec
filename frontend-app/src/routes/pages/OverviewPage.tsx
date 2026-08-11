import { useState, useEffect, useMemo } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import { ArrowRight, GraduationCap, HelpCircle } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { HowItWorksModal } from '@/components/ui/HowItWorksModal'
import { WidgetRenderer } from '@/components/widgets/WidgetRenderer'
import { PeriodPicker, PeriodIncompleteHint, usePeriod, previousRange } from '@/components/ui/PeriodPicker'
import { useCan, useIsModuleActive } from '@/hooks/usePermissions'
import { useFunnels } from '@/hooks/useFunnels'
import type { Widget } from '@/hooks/useWidgets'
import { cn } from '@/lib/cn'

const W = (w: Omit<Widget, 'id'> & { id?: string }): Widget => ({ id: w.id ?? w.metric, ...w } as Widget)

// KPIs do panorama executivo do CRM: o funil de negócio de ponta a ponta
// (aquisição → conversão → receita), cada um com Δ% vs período anterior.
// Métricas que existem em qualquer cliente, independente do módulo Educacional.
// KPIs específicos de matrículas/portais vivem em `EducationalDashboardPage`.
const KPIS: Widget[] = [
  W({ metric: 'leads_total',           type: 'kpi', title: 'Novos leads',        size: 'sm' }),
  W({ metric: 'leads_won',             type: 'kpi', title: 'Negócios ganhos',    size: 'sm' }),
  W({ metric: 'leads_won_revenue',     type: 'kpi', title: 'Receita ganha',      size: 'sm' }),
  W({ metric: 'leads_lost',            type: 'kpi', title: 'Negócios perdidos',  size: 'sm' }),
  W({ metric: 'leads_conversion_rate', type: 'kpi', title: 'Taxa de conversão',  size: 'sm' }),
]

const CHART_LEADS_BY_DAY = W({ metric: 'leads_by_date',   type: 'line',  title: 'Leads por dia',    size: 'lg', config: { groupBy: 'day' } })
const CHART_BY_SOURCE    = W({ metric: 'leads_by_source', type: 'donut', title: 'Origem dos leads', size: 'md' })
const CHART_PIPELINE     = W({ metric: 'leads_by_status', type: 'funnel', title: 'Pipeline por etapa',  size: 'lg' })
const CHART_LOSS_REASONS = W({ metric: 'leads_loss_reasons', type: 'donut', title: 'Motivos de perda', size: 'md' })

// KPIs do módulo Negociação — só aparecem com o módulo ativo.
// Recorrência e pagamento único em linhas separadas: somados, um mês com uma
// venda avulsa grande vira "crescimento" que não se repete no mês
// seguinte, e a queda seguinte parece perda de clientes.
// "Em negociação" = aberto no período (recorte pela data de abertura).
const NEGOTIATION_MRR_KPIS: Widget[] = [
  W({ metric: 'negotiations_mrr_open',       type: 'kpi', title: 'Mensalidade em negociação', size: 'sm' }),
  W({ metric: 'negotiations_mrr_won',        type: 'kpi', title: 'Mensalidade fechada',       size: 'sm' }),
  W({ metric: 'negotiations_mrr_avg_ticket', type: 'kpi', title: 'Ticket médio mensal',       size: 'sm' }),
]
const NEGOTIATION_ONETIME_KPIS: Widget[] = [
  W({ metric: 'negotiations_onetime_open',       type: 'kpi', title: 'Único em negociação', size: 'sm' }),
  W({ metric: 'negotiations_onetime_won',        type: 'kpi', title: 'Único fechado',       size: 'sm' }),
  W({ metric: 'negotiations_onetime_avg_ticket', type: 'kpi', title: 'Ticket médio único',  size: 'sm' }),
]

// Pendências do período selecionado: leads captados no período que ninguém
// contatou, atividades agendadas no período que venceram, duplicados a decidir.
const ATTENTION: Widget[] = [
  W({ metric: 'leads_uncontacted',        type: 'kpi', title: 'Leads sem contato',    size: 'sm' }),
  W({ metric: 'activities_summary',       type: 'kpi', title: 'Atividades atrasadas', size: 'sm', config: { highlight: 'overdue' } }),
  W({ metric: 'leads_duplicates_pending', type: 'kpi', title: 'Duplicados pendentes', size: 'sm' }),
]

export function OverviewPage() {
  const [, navigate] = useLocation()
  // Período: presets + intervalo livre. A escolha persiste, como a do funil —
  // quem trabalha um mês fechado não quer reconfigurar a cada visita.
  const { range, preset, customFrom, customTo, setPreset, setCustom } = usePeriod('overview')
  const [showHowItWorks, setShowHowItWorks] = useState(false)
  const canSeeEducational = useCan('educacional', 'view') && useIsModuleActive('educacional') === true
  const canSeeNegotiations = useIsModuleActive('negotiations') === true
  // prevFrom/prevTo: o Δ% compara com o MESMO trecho do mês anterior (1–11/jul
  // contra 1–11/ago). Sem isso o backend usaria os 11 dias imediatamente
  // anteriores — fim de julho contra início de agosto, movimentos diferentes.
  const anterior = previousRange(range)
  const filters = {
    dateFrom: range.dateFrom,
    dateTo: range.dateTo,
    prevFrom: anterior.dateFrom,
    prevTo: anterior.dateTo,
  }

  // Pipeline: escopado a UM funil (mistura de funis confunde). Padrão = funil
  // isDefault (senão o 1º); a escolha do usuário persiste em localStorage.
  const { data: funnelsData } = useFunnels()
  const funnels = useMemo(() => (funnelsData?.funnels ?? []).filter((f) => f.active), [funnelsData])
  const [pipelineFunnelId, setPipelineFunnelId] = useState<number | null>(null)
  useEffect(() => {
    if (pipelineFunnelId != null || funnels.length === 0) return
    const stored = Number(localStorage.getItem('overview.pipelineFunnelId') || '')
    if (stored && funnels.some((f) => f.id === stored)) { setPipelineFunnelId(stored); return }
    const def = funnels.find((f) => f.isDefault) ?? funnels[0]
    if (def) setPipelineFunnelId(def.id)
  }, [funnels, pipelineFunnelId])
  function changePipelineFunnel(id: number) {
    setPipelineFunnelId(id)
    try { localStorage.setItem('overview.pipelineFunnelId', String(id)) } catch { /* ignore */ }
  }
  const pipelineWidget: Widget = {
    ...CHART_PIPELINE,
    config: { ...(CHART_PIPELINE.config ?? {}), ...(pipelineFunnelId ? { funnelId: pipelineFunnelId } : {}) },
  }

  // Negociações: recorte por funil da seção inteira (os 3 KPIs juntos). Aqui
  // "todos os funis" é opção válida — ao contrário do pipeline, somar funis não
  // distorce um valor em reais. A escolha persiste como a do pipeline.
  const [negFunnelId, setNegFunnelId] = useState<number | null>(() => {
    const stored = Number(localStorage.getItem('overview.negotiationsFunnelId') || '')
    return stored > 0 ? stored : null
  })
  function changeNegFunnel(id: number) {
    const next = id > 0 ? id : null
    setNegFunnelId(next)
    try { localStorage.setItem('overview.negotiationsFunnelId', next ? String(next) : '') } catch { /* ignore */ }
  }
  const negotiationFilters = { ...filters, ...(negFunnelId ? { funnelId: negFunnelId } : {}) }
  const negFunnelName = negFunnelId ? funnels.find((f) => f.id === negFunnelId)?.name ?? null : null

  return (
    <Page
      title="Visão Geral"
      description="Panorama executivo: aquisição, conversão e receita do período — sem precisar montar nada."
      actions={
        <div class="flex min-w-0 flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setShowHowItWorks(true)}>
            <HelpCircle size={14} /> Como funciona?
          </Button>
          <PeriodPicker
            preset={preset}
            customFrom={customFrom}
            customTo={customTo}
            onPreset={setPreset}
            onCustom={setCustom}
          />
        </div>
      }
    >
      {/* KPIs principais — funil de negócio com Δ% vs período anterior */}
      {/* Intervalo ainda pela metade: a tela segue mostrando os últimos 30 dias
          em vez de esvaziar enquanto a segunda data não é escolhida. */}
      <PeriodIncompleteHint show={range.incomplete} />

      {/* 5 KPIs em 5 colunas: com a grade de 6 sobrava uma coluna vazia à direita. */}
      <section aria-label="Indicadores principais" class="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
        {KPIS.map((w) => (
          <WidgetRenderer key={w.id} widget={w} filters={filters} />
        ))}
      </section>

      {/* Tendência + origem */}
      <section aria-label="Tendências" class="grid gap-3 grid-cols-1 lg:grid-cols-3">
        <div class="lg:col-span-2">
          <WidgetRenderer widget={CHART_LEADS_BY_DAY} filters={filters} />
        </div>
        <div>
          <WidgetRenderer widget={CHART_BY_SOURCE} filters={filters} />
        </div>
      </section>

      {/* Negociações — só com o módulo ativo */}
      {canSeeNegotiations && (
        <section aria-label="Negociações">
          <div class="mb-2 flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h2 class="text-sm font-semibold text-fg">Negociações</h2>
              <p class="text-[11px] text-fg-subtle">
                Mensalidade e pagamento único separados — venda avulsa não vira "crescimento de recorrência".
                "Em negociação" é o que foi aberto no período e ainda não teve desfecho; os demais
                contam pela data de fechamento.
                {negFunnelName ? <> Exibindo apenas <strong class="text-fg-muted">{negFunnelName}</strong>.</> : null}
              </p>
            </div>
            <select
              class="h-7 px-2 rounded border border-border bg-surface text-xs text-fg cursor-pointer focus:outline-none focus:border-accent max-w-[200px] shrink-0"
              value={negFunnelId ? String(negFunnelId) : ''}
              onChange={(e) => changeNegFunnel(Number((e.target as HTMLSelectElement).value))}
              title="Funil dos indicadores de negociação"
            >
              <option value="">Todos os funis</option>
              {funnels.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>
          <div class="space-y-3">
            <div>
              <div class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle mb-1.5">Recorrência (mensal)</div>
              <div class="grid gap-3 grid-cols-1 sm:grid-cols-3">
                {NEGOTIATION_MRR_KPIS.map((w) => (
                  <WidgetRenderer key={w.id} widget={w} filters={negotiationFilters} />
                ))}
              </div>
            </div>
            <div>
              <div class="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle mb-1.5">Pagamento único</div>
              <div class="grid gap-3 grid-cols-1 sm:grid-cols-3">
                {NEGOTIATION_ONETIME_KPIS.map((w) => (
                  <WidgetRenderer key={w.id} widget={w} filters={negotiationFilters} />
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Pipeline + motivos de perda */}
      <section aria-label="Pipeline e perdas" class="grid gap-3 grid-cols-1 lg:grid-cols-3">
        <div class="lg:col-span-2">
          <WidgetRenderer
            widget={pipelineWidget}
            filters={filters}
            actions={funnels.length > 1 ? (
              <select
                class="h-7 px-2 rounded border border-border bg-surface text-xs text-fg cursor-pointer focus:outline-none focus:border-accent max-w-[160px] shrink-0"
                value={pipelineFunnelId ? String(pipelineFunnelId) : ''}
                onChange={(e) => changePipelineFunnel(Number((e.target as HTMLSelectElement).value))}
                title="Funil exibido no pipeline"
              >
                {funnels.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}{f.isDefault ? ' (padrão)' : ''}</option>
                ))}
              </select>
            ) : undefined}
          />
        </div>
        <div>
          <WidgetRenderer widget={CHART_LOSS_REASONS} filters={filters} />
        </div>
      </section>

      {/* Precisa de atenção — pendências dentro do período selecionado */}
      <section aria-label="Precisa de atenção">
        <div class="flex items-center justify-between mb-2">
          <div>
            <h2 class="text-sm font-semibold text-fg">Precisa de atenção</h2>
            <p class="text-[11px] text-fg-subtle">
              Pendências dentro do período selecionado — leads sem contato, atividades
              já vencidas e duplicados aguardando decisão.
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/activities')}
            class="text-xs text-accent hover:underline inline-flex items-center gap-1"
          >
            Ver atividades <ArrowRight size={12} />
          </button>
        </div>
        <div class="grid gap-3 grid-cols-1 sm:grid-cols-3">
          {ATTENTION.map((w) => (
            <WidgetRenderer key={w.id} widget={w} filters={filters} />
          ))}
        </div>
      </section>

      {/* Atalhos */}
      <div class={cn('grid gap-3', canSeeEducational ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1')}>
        <Card class="!p-4 bg-surface-2/50">
          <div class="flex items-start gap-3">
            <div class="flex-1">
              <div class="text-sm font-medium text-fg mb-0.5">Quer mais detalhe?</div>
              <div class="text-xs text-fg-muted">
                Em <strong>Meus Painéis</strong> você monta dashboards customizados com KPIs, gráficos, funil consolidado e drill-down.
              </div>
            </div>
            <button
              type="button"
              onClick={() => navigate('/analytics')}
              class="shrink-0 inline-flex items-center gap-1 h-8 px-3 rounded-md bg-accent text-fg-on-brand text-xs font-medium hover:opacity-90"
            >
              Abrir Meus Painéis <ArrowRight size={12} />
            </button>
          </div>
        </Card>
        {canSeeEducational && (
          <Card class="!p-4 bg-surface-2/50">
            <div class="flex items-start gap-3">
              <GraduationCap size={20} class="text-accent shrink-0 mt-0.5" />
              <div class="flex-1">
                <div class="text-sm font-medium text-fg mb-0.5">Visão Geral Educacional</div>
                <div class="text-xs text-fg-muted">
                  Matrículas, portais, processos seletivos, doc review e avaliações — em uma tela só.
                </div>
              </div>
              <button
                type="button"
                onClick={() => navigate('/educational')}
                class="shrink-0 inline-flex items-center gap-1 h-8 px-3 rounded-md border border-accent text-accent text-xs font-medium hover:bg-accent/10"
              >
                Abrir <ArrowRight size={12} />
              </button>
            </div>
          </Card>
        )}
      </div>

      <HowItWorksModal
        open={showHowItWorks}
        onClose={() => setShowHowItWorks(false)}
        title="Como funciona a Visão Geral?"
        problem={<>
          A Visão Geral é o seu <strong>panorama executivo</strong> do CRM: indicadores prontos sem
          precisar montar nada. Lê em 5 segundos o estado da operação. Bom pra começar o dia ou
          mostrar pra liderança numa reunião.
        </>}
        steps={[
          {
            title: '📊 KPIs no topo',
            body: <>O funil de negócio do período: novos leads, negócios ganhos, receita ganha, perdidos (com a maior objeção) e taxa de conversão. Cada card compara com o <strong>período anterior de mesma duração</strong> (▲/▼).</>,
          },
          {
            title: '🗓️ Qual data cada card conta',
            body: <>Não é a mesma para todos, e cada card diz a sua embaixo do número. <strong>Novos leads</strong> conta pela entrada do lead. <strong>Negócios ganhos, receita ganha e negócios perdidos</strong> contam pelo <strong>clique no botão Ganho/Perdido</strong> — é o que foi fechado dentro do período, não importa quando o lead entrou. A <strong>taxa de conversão</strong> é coorte: conta pela <strong>abertura da negociação</strong>.</>,
          },
          {
            title: '🎯 Taxa de conversão',
            body: <>Mede o fim do funil: dos leads que <strong>chegaram à negociação com valor lançado</strong> no período, quantos viraram venda. O denominador inclui as propostas <strong>ainda em aberto</strong> de propósito — a taxa do período sobe conforme elas fecham. Ficar de fora quem nunca chegou a negociar é o ponto: um lead descartado na triagem não diz nada sobre a sua capacidade de fechar proposta.</>,
          },
          {
            title: '📈 Gráficos',
            body: <>Linha de leads por dia (vê crescimento), donut de origens (de onde estão vindo), pipeline por etapa (onde os leads do período estão parados) e motivos de perda (por que você está perdendo).</>,
          },
          {
            title: '🤝 Bloco Negociações',
            body: <>Com o módulo Negociação ativo, os valores vêm em duas linhas: <strong>recorrência</strong> (mensalidades, o MRR) e <strong>pagamento único</strong> (o que o cliente paga uma vez só). Cada item da proposta é marcado como mensalidade ou pagamento único, e cada bloco tem o seu desconto — assim uma venda avulsa grande não vira "crescimento de recorrência" no mês seguinte.</>,
          },
          {
            title: '⚠️ Bloco "Atenção"',
            body: <>Leads sem contato, atividades vencidas, duplicados pendentes — <strong>dentro do período selecionado</strong>. Se um número desses está alto, vai resolver hoje.</>,
          },
          {
            title: '⏱️ Trocar o período',
            body: <>Botões 7/30/90 dias ou <strong>Personalizado</strong> (intervalo livre entre duas datas). <strong>Toda a tela</strong> recalcula no clique — KPIs, gráficos, negociações e o bloco de atenção. Use 7d pra ver o que tá acontecendo agora, 30d pra ver o mês, 90d pra ver tendência.</>,
          },
          {
            title: '🎓 Bloco Educacional',
            body: <>Se você tem o módulo Educacional ativo, os indicadores de matrículas ficam numa tela própria — o atalho "Visão Geral Educacional" aparece no fim desta página.</>,
          },
        ]}
        tip={{
          tone: 'info',
          title: '💡 Quer mais detalhes?',
          body: <>Esta é a visão "pronta de fábrica". Pra montar painéis personalizados, vá em <strong>Relatórios › Meus Painéis</strong> — você arrasta widgets, cria comparações, salva por papel (CEO, marketing, vendas).</>,
        }}
      />
    </Page>
  )
}
