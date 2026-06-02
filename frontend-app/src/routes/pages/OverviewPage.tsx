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

// KPIs do panorama executivo do CRM. Métricas que existem em qualquer cliente,
// independente do módulo Educacional. KPIs específicos de matrículas/portais
// vivem em `EducationalDashboardPage` (Educacional > Visão geral).
const KPIS: Widget[] = [
  W({ metric: 'leads_total',        type: 'kpi', title: 'Leads no total',       size: 'sm' }),
  W({ metric: 'leads_submissions',  type: 'kpi', title: 'Inscrições no período', size: 'sm' }),
  W({ metric: 'leads_unique',       type: 'kpi', title: 'Leads únicos',         size: 'sm' }),
  W({ metric: 'leads_avg_score',    type: 'kpi', title: 'Score médio',          size: 'sm' }),
  W({ metric: 'activities_summary', type: 'kpi', title: 'Atividades',           size: 'sm' }),
  W({ metric: 'tracking_visitors',  type: 'kpi', title: 'Visitantes',           size: 'sm' }),
]

const CHARTS: Widget[] = [
  W({ metric: 'leads_by_date',   type: 'line',  title: 'Leads por dia',  size: 'lg', config: { groupBy: 'day' } }),
  W({ metric: 'leads_by_source', type: 'donut', title: 'Origem dos leads', size: 'md' }),
]

const ATTENTION: Widget[] = [
  W({ metric: 'leads_uncontacted',         type: 'kpi', title: 'Sem contato',           size: 'sm' }),
  W({ metric: 'activities_summary',        type: 'kpi', title: 'Atividades atrasadas',  size: 'sm', config: { highlight: 'overdue' } }),
  W({ metric: 'leads_duplicates_pending',  type: 'kpi', title: 'Duplicados pendentes', size: 'sm' }),
]

export function OverviewPage() {
  const [, navigate] = useLocation()
  const [preset, setPreset] = useState<RangePreset>('30d')
  const [showHowItWorks, setShowHowItWorks] = useState(false)
  const canSeeEducational = useCan('educacional', 'view') && useIsModuleActive('educacional') === true
  const range = presetRange(preset)
  const filters = { dateFrom: range.dateFrom, dateTo: range.dateTo }

  return (
    <Page
      title="Visão Geral"
      description="Panorama executivo: como está o sistema agora — sem precisar montar nada."
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
      {/* KPIs principais */}
      <section aria-label="Indicadores principais" class="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        {KPIS.map((w) => (
          <WidgetRenderer key={w.id} widget={w} filters={filters} />
        ))}
      </section>

      {/* Gráficos macro */}
      <section aria-label="Tendências" class="grid gap-3 grid-cols-1 lg:grid-cols-3">
        <div class="lg:col-span-2">
          <WidgetRenderer widget={CHARTS[0]!} filters={filters} />
        </div>
        <div>
          <WidgetRenderer widget={CHARTS[1]!} filters={filters} />
        </div>
      </section>

      {/* Precisa de atenção */}
      <section aria-label="Precisa de atenção">
        <div class="flex items-center justify-between mb-2">
          <h2 class="text-sm font-semibold text-fg">Precisa de atenção</h2>
          <button
            type="button"
            onClick={() => navigate('/app/activities')}
            class="text-xs text-accent hover:underline inline-flex items-center gap-1"
          >
            Ver atividades <ArrowRight size={12} />
          </button>
        </div>
        <div class="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
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
              onClick={() => navigate('/app/analytics')}
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
                onClick={() => navigate('/app/educational')}
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
            body: <>Total de leads, novas inscrições no período, leads únicos, score médio, atividades, visitantes do site. Cada card mostra valor + variação comparado ao período anterior.</>,
          },
          {
            title: '📈 Gráficos',
            body: <>Linha de leads por dia (vê crescimento), donut de origens (de onde estão vindo). É a tela que mostra de cara se sua aquisição tá saudável.</>,
          },
          {
            title: '⚠️ Bloco "Atenção"',
            body: <>Leads sem contato, atividades atrasadas, duplicados pendentes. Tudo que <strong>não pode esperar</strong>. Se um número desses está alto, vai resolver hoje.</>,
          },
          {
            title: '⏱️ Trocar o período',
            body: <>Botões 7/30/90 dias. Tudo recalcula no clique. Use 7d pra ver o que tá acontecendo agora, 30d pra ver o mês, 90d pra ver tendência.</>,
          },
          {
            title: '🎓 Bloco Educacional',
            body: <>Se você tem o módulo Educacional ativo, aparece aqui um atalho pra a Visão Geral de Matrículas (com KPIs específicos: inscrições, conversão por unidade, etc).</>,
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
