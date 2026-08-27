// Visão Geral Educacional servida como Tela Inicial.
//
// É o painel de indicadores da tela do módulo Educacional, sem a parte de
// administração: aqui não há "Criar funil", "Como funciona?" nem a grade de
// cadastros. Porta de entrada informa; administrar é dentro do módulo.
//
// A diferença que não dá para ver de fora: os números NÃO vêm de
// /admin/widget-data (gateado pelo módulo 'dashboard'), e sim de uma chamada só
// a /home-screen/educacional, que abre para quem recebeu esta tela. Por isso os
// widgets são renderizados com `dadosProntos` — o mesmo renderizador de sempre,
// alimentado por fora.

import { WidgetRenderer } from '@/components/widgets/WidgetRenderer'
import { PeriodPicker, PeriodIncompleteHint, usePeriod } from '@/components/ui/PeriodPicker'
import type { Widget } from '@/hooks/useWidgets'
import { useHomeEducacional } from '@/hooks/useHomeEducacional'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'

const W = (w: Omit<Widget, 'id'> & { id?: string }): Widget => ({ id: w.id ?? w.metric, ...w } as Widget)

const KPI_INSCRICOES = W({ metric: 'registrations_total',           type: 'kpi', title: 'Inscrições',         size: 'sm' })
const KPI_PAGAS      = W({ metric: 'registrations_paid',            type: 'kpi', title: 'Matrículas pagas',   size: 'sm' })
const KPI_RECEITA    = W({ metric: 'registrations_revenue',         type: 'kpi', title: 'Receita do período', size: 'sm' })
const KPI_CONVERSAO  = W({ metric: 'registrations_conversion_rate', type: 'kpi', title: 'Taxa de conversão',  size: 'sm' })

const GRAFICO_POR_DIA    = W({ metric: 'registrations_by_day',    type: 'line',  title: 'Inscrições por dia',    size: 'lg', config: { groupBy: 'day' } })
const GRAFICO_POR_PORTAL = W({ metric: 'registrations_by_portal', type: 'donut', title: 'Inscrições por portal', size: 'md' })

function Destaque({ label, value, loading, color }: { label: string; value: number; loading: boolean; color: string }) {
  return (
    <div class="px-4 text-center">
      <div class="text-xl font-bold tabular-nums leading-none" style={{ color }}>
        {loading ? '—' : value}
      </div>
      <div class="text-[0.625rem] uppercase tracking-wider text-fg-subtle mt-1">{label}</div>
    </div>
  )
}

export function PainelEducacionalHome({ titulo }: { titulo?: string }) {
  const { range, preset, customFrom, customTo, setPreset, setCustom } = usePeriod('home-educacional')
  const { data, isLoading, error } = useHomeEducacional({
    dateFrom: range.dateFrom,
    dateTo: range.dateTo,
  })

  const p = data?.panorama

  return (
    <Page title={titulo || 'Visão Geral'}>
      {error && (
        <Card>
          <div class="text-xs text-danger">
            Não foi possível carregar os indicadores educacionais. Se isto persistir, peça a um
            administrador para conferir a tela inicial atribuída ao seu perfil.
          </div>
        </Card>
      )}

      <Card>
        <div class="flex items-center gap-4 flex-wrap">
          <div class="text-3xl">📊</div>
          <div class="flex-1 min-w-[180px]">
            <div class="text-sm font-semibold text-fg">Dashboard educacional</div>
            <div class="text-xs text-fg-muted">
              {isLoading ? (
                <Skeleton class="h-4 w-64" />
              ) : (
                <>
                  {p?.matriculados ?? 0} matrícula(s) · {p?.totalRegistrations ?? 0} inscrito(s) ·
                  {' '}conversão global {p?.conversionRate ?? 0}%
                </>
              )}
            </div>
          </div>
          <div class="flex items-stretch divide-x divide-border">
            <Destaque label="Cursos"   value={p?.totalCourses ?? 0}    loading={isLoading} color="#1a73e8" />
            <Destaque label="Ofertas"  value={p?.totalOfferings ?? 0}  loading={isLoading} color="#0d652d" />
            <Destaque label="Processos" value={p?.totalProcesses ?? 0} loading={isLoading} color="#b06000" />
          </div>
        </div>
      </Card>

      <section aria-label="Desempenho do período">
        <div class="flex items-center justify-between mb-2">
          <div>
            <h2 class="text-sm font-semibold text-fg">Desempenho do período</h2>
            <p class="text-[11px] text-fg-subtle">Cada card compara com o período anterior de mesma duração (▲/▼).</p>
          </div>
          <PeriodPicker
            preset={preset}
            customFrom={customFrom}
            customTo={customTo}
            onPreset={setPreset}
            onCustom={setCustom}
            label="Período do desempenho"
          />
        </div>
        <PeriodIncompleteHint show={range.incomplete} />

        {isLoading ? (
          <div class="grid gap-3 grid-cols-2 lg:grid-cols-4 mb-3">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} class="h-24 w-full" />)}
          </div>
        ) : (
          <div class="grid gap-3 grid-cols-2 lg:grid-cols-4 mb-3">
            <WidgetRenderer widget={KPI_INSCRICOES} dadosProntos={data?.kpis.inscricoes ?? null} />
            <WidgetRenderer widget={KPI_PAGAS}      dadosProntos={data?.kpis.pagas ?? null} />
            <WidgetRenderer widget={KPI_RECEITA}    dadosProntos={data?.kpis.receita ?? null} />
            <WidgetRenderer widget={KPI_CONVERSAO}  dadosProntos={data?.kpis.conversao ?? null} />
          </div>
        )}

        {isLoading ? (
          <Skeleton class="h-64 w-full" />
        ) : (
          <div class="grid gap-3 grid-cols-1 lg:grid-cols-3">
            <div class="lg:col-span-2">
              <WidgetRenderer widget={GRAFICO_POR_DIA} dadosProntos={{ data: data?.graficos.porDia ?? [] }} />
            </div>
            <div>
              <WidgetRenderer widget={GRAFICO_POR_PORTAL} dadosProntos={{ data: data?.graficos.porPortal ?? [] }} />
            </div>
          </div>
        )}
      </section>
    </Page>
  )
}
