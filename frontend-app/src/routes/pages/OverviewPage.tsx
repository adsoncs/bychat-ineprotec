import { useState } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import { ArrowRight, GraduationCap, HelpCircle } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { HowItWorksModal } from '@/components/ui/HowItWorksModal'
import { WidgetRenderer } from '@/components/widgets/WidgetRenderer'
import { useCan, useIsModuleActive } from '@/hooks/usePermissions'
import type { Widget } from '@/hooks/useWidgets'
import { cn } from '@/lib/cn'

type RangePreset = '7d' | '30d' | '90d'

function presetRange(preset: RangePreset): { dateFrom: string; dateTo: string } {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const days = preset === '7d' ? 7 : preset === '30d' ? 30 : 90
  const fmt = (d: Date) => d.toISOString().split('T')[0] ?? ''
  return { dateFrom: fmt(new Date(today.getTime() - days * 86400_000)), dateTo: fmt(today) }
}

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
  W({ metric: 'tracking_visitors',     type: 'kpi', title: 'Visitantes no site', size: 'sm' }),
]

const CHART_LEADS_BY_DAY = W({ metric: 'leads_by_date',   type: 'line',  title: 'Leads por dia',    size: 'lg', config: { groupBy: 'day' } })
const CHART_BY_SOURCE    = W({ metric: 'leads_by_source', type: 'donut', title: 'Origem dos leads', size: 'md' })
const CHART_PIPELINE     = W({ metric: 'leads_by_status', type: 'funnel', title: 'Pipeline por etapa',  size: 'lg' })
const CHART_LOSS_REASONS = W({ metric: 'leads_loss_reasons', type: 'donut', title: 'Motivos de perda', size: 'md' })

// KPIs do módulo Negociação — só aparecem com o módulo ativo.
// "Em negociação" é estoque (agora); os outros dois seguem o período.
const NEGOTIATION_KPIS: Widget[] = [
  W({ metric: 'negotiations_open',        type: 'kpi', title: 'Em negociação',              size: 'sm' }),
  W({ metric: 'negotiations_won_revenue', type: 'kpi', title: 'Fechado em negociações',     size: 'sm' }),
  W({ metric: 'negotiations_win_rate',    type: 'kpi', title: 'Aproveitamento',             size: 'sm' }),
]

// Estoque de pendências — sempre "agora", não muda com o seletor de período.
const ATTENTION: Widget[] = [
  W({ metric: 'leads_uncontacted',        type: 'kpi', title: 'Leads sem contato',    size: 'sm' }),
  W({ metric: 'activities_summary',       type: 'kpi', title: 'Atividades atrasadas', size: 'sm', config: { highlight: 'overdue' } }),
  W({ metric: 'leads_duplicates_pending', type: 'kpi', title: 'Duplicados pendentes', size: 'sm' }),
]

export function OverviewPage() {
  const [, navigate] = useLocation()
  const [preset, setPreset] = useState<RangePreset>('30d')
  const [showHowItWorks, setShowHowItWorks] = useState(false)
  const canSeeEducational = useCan('educacional', 'view') && useIsModuleActive('educacional') === true
  const canSeeNegotiations = useIsModuleActive('negotiations') === true
  const range = presetRange(preset)
  const filters = { dateFrom: range.dateFrom, dateTo: range.dateTo }

  return (
    <Page
      title="Visão Geral"
      description="Panorama executivo: aquisição, conversão e receita do período — sem precisar montar nada."
      actions={
        <div class="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setShowHowItWorks(true)}>
            <HelpCircle size={14} /> Como funciona?
          </Button>
          <div class="flex items-center gap-1 p-0.5 rounded-md bg-surface-3">
            {(['7d', '30d', '90d'] as RangePreset[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPreset(p)}
                class={cn(
                  'h-7 px-3 rounded text-xs font-medium transition-colors',
                  preset === p
                    ? 'bg-surface text-fg shadow-sm'
                    : 'text-fg-muted hover:text-fg',
                )}
              >
                {p === '7d' ? '7 dias' : p === '30d' ? '30 dias' : '90 dias'}
              </button>
            ))}
          </div>
        </div>
      }
    >
      {/* KPIs principais — funil de negócio com Δ% vs período anterior */}
      <section aria-label="Indicadores principais" class="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
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
          <div class="mb-2">
            <h2 class="text-sm font-semibold text-fg">Negociações</h2>
            <p class="text-[11px] text-fg-subtle">"Em negociação" é o valor na mesa agora; os demais seguem o período selecionado.</p>
          </div>
          <div class="grid gap-3 grid-cols-1 sm:grid-cols-3">
            {NEGOTIATION_KPIS.map((w) => (
              <WidgetRenderer key={w.id} widget={w} filters={filters} />
            ))}
          </div>
        </section>
      )}

      {/* Pipeline + motivos de perda */}
      <section aria-label="Pipeline e perdas" class="grid gap-3 grid-cols-1 lg:grid-cols-3">
        <div class="lg:col-span-2">
          <WidgetRenderer widget={CHART_PIPELINE} filters={filters} />
        </div>
        <div>
          <WidgetRenderer widget={CHART_LOSS_REASONS} filters={filters} />
        </div>
      </section>

      {/* Precisa de atenção — estoque atual, independe do período selecionado */}
      <section aria-label="Precisa de atenção">
        <div class="flex items-center justify-between mb-2">
          <div>
            <h2 class="text-sm font-semibold text-fg">Precisa de atenção</h2>
            <p class="text-[11px] text-fg-subtle">Pendências de agora — não mudam com o seletor de período.</p>
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
            <WidgetRenderer key={w.id} widget={w} />
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
            body: <>O funil de negócio do período: novos leads, negócios ganhos, receita ganha, perdidos (com a maior objeção), taxa de conversão e visitantes do site. Cada card compara com o <strong>período anterior de mesma duração</strong> (▲/▼).</>,
          },
          {
            title: '📈 Gráficos',
            body: <>Linha de leads por dia (vê crescimento), donut de origens (de onde estão vindo), pipeline por etapa (onde os leads do período estão parados) e motivos de perda (por que você está perdendo).</>,
          },
          {
            title: '⚠️ Bloco "Atenção"',
            body: <>Leads sem contato, atividades atrasadas, duplicados pendentes. É o <strong>estoque de pendências de agora</strong> — não muda com o seletor de período. Se um número desses está alto, vai resolver hoje.</>,
          },
          {
            title: '⏱️ Trocar o período',
            body: <>Botões 7/30/90 dias. Tudo recalcula no clique. Use 7d pra ver o que tá acontecendo agora, 30d pra ver o mês, 90d pra ver tendência.</>,
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
