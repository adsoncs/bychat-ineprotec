import { useState } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import {
  GraduationCap, Layers, Building2, MapPin, BookOpen, CalendarRange, FileCheck2,
  ClipboardList, Award, School, BarChart3, Lightbulb, ListTodo, HelpCircle,
} from 'lucide-preact'
import { HowItWorksModal } from '@/components/ui/HowItWorksModal'
import {
  useEducationalStatus, useCampuses, useEntryModes, useEducationalStats,
} from '@/hooks/useEducational'
import { useEnrollmentPortals } from '@/hooks/useEnrollmentPortals'
import { useFunnels } from '@/hooks/useFunnels'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { FunnelFormModal } from '@/components/FunnelFormModal'

interface Tile {
  label: string
  count: number
  href: string
  icon: preact.ComponentChildren
  comingSoon?: boolean
}

const STATUS_LABELS: Record<string, string> = {
  inscrito: 'Inscrito',
  pago_taxa: 'Pagou taxa',
  classificado: 'Classificado',
  convocado: 'Convocado',
  matriculado: 'Matriculado',
  desistente: 'Desistente',
  reprovado: 'Reprovado',
}

const STATUS_COLORS: Record<string, string> = {
  inscrito: '#1a73e8',
  pago_taxa: '#0097a7',
  classificado: '#8bc34a',
  convocado: '#cddc39',
  matriculado: '#137333',
  desistente: '#c5221f',
  reprovado: '#5f6368',
}

export function EducationalDashboardPage() {
  const { data, isLoading } = useEducationalStatus()
  const { data: campusesData } = useCampuses()
  const { data: entryModesData } = useEntryModes(true)
  const { data: portalsData } = useEnrollmentPortals()
  const { data: stats, isLoading: statsLoading } = useEducationalStats()
  const { data: funnelsData } = useFunnels()
  const [, navigate] = useLocation()
  const [creatingFunnel, setCreatingFunnel] = useState(false)
  const [showHowItWorks, setShowHowItWorks] = useState(false)
  const counts = data?.counts
  const campusCount = campusesData?.campuses.length ?? 0
  const entryModesCount = entryModesData?.modes.length ?? 0
  const portalsCount = portalsData?.portals.length ?? 0

  const tiles: Tile[] = [
    { label: 'Níveis de ensino', count: counts?.levels ?? 0, href: '/educational/levels', icon: <GraduationCap size={18} /> },
    { label: 'Modalidades', count: counts?.modalities ?? 0, href: '/educational/modalities', icon: <Layers size={18} /> },
    { label: 'Unidades', count: counts?.units ?? 0, href: '/educational/units', icon: <Building2 size={18} /> },
    { label: 'Campus', count: campusCount, href: '/educational/campuses', icon: <MapPin size={18} /> },
    { label: 'Cursos', count: counts?.courses ?? 0, href: '/educational/courses', icon: <BookOpen size={18} /> },
    { label: 'Ofertas', count: counts?.offerings ?? 0, href: '/educational/offerings', icon: <CalendarRange size={18} /> },
    { label: 'Modos de ingresso', count: entryModesCount, href: '/educational/entry-modes', icon: <Award size={18} /> },
    { label: 'Processos seletivos', count: counts?.processes ?? 0, href: '/educational/selection-processes', icon: <FileCheck2 size={18} /> },
    { label: 'Portais de matrícula', count: portalsCount, href: '/enrollment-portals', icon: <School size={18} /> },
    { label: 'Inscrições', count: counts?.registrations ?? 0, href: '/enrollment-portals', icon: <ClipboardList size={18} /> },
  ]

  const totalFunnel = (stats?.byStatus ?? []).reduce((a, b) => a + Number(b.count || 0), 0) || 1

  return (
    <Page
      title="Educacional"
      description="Gestão acadêmica: níveis, modalidades, unidades, campus, cursos, ofertas e processos seletivos."
      actions={
        <div class="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setShowHowItWorks(true)}>
            <HelpCircle size={14} /> Como funciona?
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setCreatingFunnel(true)}>
            <ListTodo size={14} /> Criar funil
          </Button>
        </div>
      }
    >
      {!data?.enabled && data?.isSuperadmin && (
        <Card>
          <div class="text-xs text-fg-muted">
            O módulo está <span class="text-warning font-medium">desativado</span> globalmente.
            Você está visualizando como SUPERADMIN. Ative em Configurações → Módulos para que outros usuários enxerguem.
          </div>
        </Card>
      )}

      {/* Hero — visão geral */}
      <Card>
        <div class="flex items-center gap-4 flex-wrap">
          <div class="text-3xl">📊</div>
          <div class="flex-1 min-w-[180px]">
            <div class="text-sm font-semibold text-fg">Dashboard educacional</div>
            <div class="text-xs text-fg-muted">
              {statsLoading ? (
                <Skeleton class="h-4 w-64" />
              ) : (
                <>
                  {stats?.matriculados ?? 0} matrícula(s) · {stats?.totalRegistrations ?? 0} inscrito(s) · conversão global {stats?.conversionRate ?? 0}%
                </>
              )}
            </div>
          </div>
          <div class="flex items-stretch divide-x divide-border">
            <HeroStat label="Cursos" value={stats?.totalCourses ?? 0} loading={statsLoading} color="#1a73e8" />
            <HeroStat label="Ofertas" value={stats?.totalOfferings ?? 0} loading={statsLoading} color="#0d652d" />
            <HeroStat label="Processos" value={stats?.totalProcesses ?? 0} loading={statsLoading} color="#b06000" />
          </div>
        </div>
      </Card>

      {/* KPI cards */}
      <div class="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Cursos ativos" value={stats?.totalCourses ?? 0} loading={statsLoading} tone="accent" />
        <KpiCard label="Ofertas ativas" value={stats?.totalOfferings ?? 0} loading={statsLoading} tone="violet" />
        <KpiCard label="Processos seletivos" value={stats?.totalProcesses ?? 0} loading={statsLoading} tone="orange" />
        <KpiCard
          label="Conversão global"
          value={`${stats?.conversionRate ?? 0}%`}
          sub={`${stats?.matriculados ?? 0} matrículas / ${stats?.totalRegistrations ?? 0} inscritos`}
          loading={statsLoading}
          tone="success"
        />
      </div>

      {/* Funil + Top ofertas */}
      <div class="grid gap-3 lg:grid-cols-2">
        <Card>
          <div class="flex items-center gap-2 mb-3">
            <BarChart3 size={14} class="text-fg-muted" />
            <h3 class="text-sm font-semibold text-fg">Funil de inscrições</h3>
          </div>
          {statsLoading ? (
            <Skeleton class="h-32 w-full" />
          ) : (stats?.byStatus ?? []).length === 0 ? (
            <div class="text-xs text-fg-subtle text-center py-8">Sem inscrições ainda</div>
          ) : (
            <div class="space-y-2.5">
              {(stats?.byStatus ?? []).map((s) => {
                const pct = ((Number(s.count) / totalFunnel) * 100)
                const color = STATUS_COLORS[s.status] ?? '#5f6368'
                return (
                  <div key={s.status}>
                    <div class="flex justify-between text-xs text-fg-muted mb-1">
                      <span class="font-medium text-fg">{STATUS_LABELS[s.status] ?? s.status}</span>
                      <span><strong class="text-fg">{s.count}</strong> · {pct.toFixed(1)}%</span>
                    </div>
                    <div class="h-2 rounded-full bg-surface-3 overflow-hidden">
                      <div
                        class="h-full rounded-full transition-all"
                        style={{ width: `${pct}%`, background: color }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>

        <Card>
          <div class="flex items-center gap-2 mb-3">
            <Award size={14} class="text-fg-muted" />
            <h3 class="text-sm font-semibold text-fg">Top 10 ofertas</h3>
          </div>
          {statsLoading ? (
            <Skeleton class="h-32 w-full" />
          ) : (stats?.topOfferings ?? []).length === 0 ? (
            <div class="text-xs text-fg-subtle text-center py-8">Sem ofertas com inscrições</div>
          ) : (
            <div class="overflow-x-auto -mx-1">
              <table class="w-full text-xs">
                <thead class="text-fg-subtle text-[0.6875rem] uppercase tracking-wider border-b border-border">
                  <tr>
                    <th class="text-left px-2 py-2 font-medium">Oferta</th>
                    <th class="text-right px-2 py-2 font-medium">Inscritos</th>
                    <th class="text-right px-2 py-2 font-medium">Matric.</th>
                    <th class="text-right px-2 py-2 font-medium">Conv.</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-border">
                  {(stats?.topOfferings ?? []).map((o) => {
                    const reg = Number(o.registrations) || 0
                    const mat = Number(o.matriculated) || 0
                    const conv = reg > 0 ? Math.round((mat / reg) * 100) : 0
                    return (
                      <tr key={o.id} class="hover:bg-surface-3">
                        <td class="px-2 py-2 text-fg truncate max-w-[16rem]" title={o.nome}>{o.nome}</td>
                        <td class="px-2 py-2 text-right tabular-nums font-semibold text-accent">{reg}</td>
                        <td class="px-2 py-2 text-right tabular-nums font-semibold text-success">{mat}</td>
                        <td class="px-2 py-2 text-right tabular-nums text-fg-muted">{conv}%</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* Dica */}
      <Card class="border-warning/30 bg-warning/5">
        <div class="flex items-start gap-2 text-xs text-fg-muted">
          <Lightbulb size={14} class="mt-0.5 shrink-0 text-warning" />
          <span>
            <strong class="text-fg">Dica:</strong> quando um candidato é marcado como <strong>matriculado</strong> (na aba
            Educacional do lead), a venda é automaticamente detectada e o valor é calculado por{' '}
            <em>mensalidade × duração + matrícula</em>. Isso alimenta ROI, Google Ads Conversions e Meta CAPI.
          </span>
        </div>
      </Card>

      {/* Tiles de navegação */}
      <div>
        <div class="text-xs uppercase tracking-wider text-fg-subtle font-medium mb-2">Catálogo</div>
        <div class="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
          {tiles.map((t) => (
            <button
              key={t.href}
              type="button"
              class="text-left rounded-lg border border-border bg-surface-2 p-3 hover:border-accent hover:bg-surface-3 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={t.comingSoon}
              onClick={() => navigate(t.href)}
              aria-label={t.label}
            >
              <div class="flex items-center justify-between">
                <span class="size-8 rounded-md bg-surface grid place-items-center text-fg-muted">
                  {t.icon}
                </span>
                {t.comingSoon && (
                  <span class="text-[0.625rem] uppercase tracking-wider text-fg-subtle">em breve</span>
                )}
              </div>
              <div class="mt-2 text-[0.6875rem] uppercase tracking-wider text-fg-subtle">{t.label}</div>
              <div class="mt-0.5 text-xl font-semibold text-fg tabular-nums">
                {isLoading ? <Skeleton class="h-6 w-10" /> : t.count}
              </div>
            </button>
          ))}
        </div>
      </div>

      {creatingFunnel && (
        <FunnelFormModal
          funnel={null}
          funnels={funnelsData?.funnels ?? []}
          namePlaceholder="Ex: Funil Vestibular"
          onClose={() => setCreatingFunnel(false)}
          onCreated={() => navigate('/funnels')}
        />
      )}

      <HowItWorksModal
        open={showHowItWorks}
        onClose={() => setShowHowItWorks(false)}
        title="Como funciona o módulo Educacional?"
        problem={<>
          Faculdade, curso técnico, escola, treinamento — operações de educação têm complexidades
          que CRM padrão não cobre: <strong>níveis, modalidades, unidades, campus, cursos, ofertas,
          processos seletivos, matrículas, avaliações, revisão de documentos</strong>. O módulo
          adiciona essa camada inteira em cima do CRM.
        </>}
        steps={[
          {
            title: '🏛️ Estruture a instituição',
            body: <>Comece definindo: <strong>Níveis</strong> (Graduação, Pós, Técnico…), <strong>Modalidades</strong> (Presencial, EAD, Híbrido), <strong>Unidades</strong> (filiais), <strong>Campus</strong> (endereços físicos). É a hierarquia base.</>,
          },
          {
            title: '📚 Cadastre cursos e ofertas',
            body: <>Cada <strong>Curso</strong> (ex.: Direito) tem uma ou várias <strong>Ofertas</strong> (semestre 2026.1, campus X, modalidade EAD). A oferta é o que o aluno se inscreve, com vagas, preço, datas.</>,
          },
          {
            title: '🎯 Processos seletivos e modos de ingresso',
            body: <>Vestibular, ENEM, transferência, segunda graduação — cada um vira <strong>Modo de Ingresso</strong> vinculado a um <strong>Processo Seletivo</strong>. Define regras (peso da prova, aproveitamento, descontos).</>,
          },
          {
            title: '🌐 Portal de Matrículas',
            body: <>É a porta de entrada pro candidato: ele preenche dados, escolhe oferta, paga e vira inscrição. Você desenha o portal (campos, branding, fluxo). Aparece em <strong>/app/enrollment-portals</strong>.</>,
          },
          {
            title: '📝 Revisão de docs + Avaliações',
            body: <>Após inscrição, candidato envia documentos (RG, histórico, comprovante). Você revisa (aprovar/reprovar). Se for vestibular, avalia provas/redações. Tudo integrado ao funil de matrícula.</>,
          },
        ]}
        tip={{
          tone: 'info',
          title: '💡 Não precisa usar tudo',
          body: <>Pra cursinho/curso livre, basta <strong>Cursos + Ofertas + Portal</strong>. Pra faculdade completa, todo o módulo faz sentido. Comece pequeno e vai habilitando conforme cresce. Cada sub-tela tem seu próprio CRUD com lixeira pra recuperação.</>,
        }}
      />
    </Page>
  )
}

function HeroStat({ label, value, loading, color }: { label: string; value: number; loading: boolean; color: string }) {
  return (
    <div class="px-4 text-center">
      <div class="text-xl font-bold tabular-nums leading-none" style={{ color }}>
        {loading ? '—' : value}
      </div>
      <div class="text-[0.625rem] uppercase tracking-wider text-fg-subtle mt-1">{label}</div>
    </div>
  )
}

function KpiCard({
  label, value, sub, loading, tone,
}: {
  label: string
  value: number | string
  sub?: string
  loading: boolean
  tone: 'accent' | 'violet' | 'orange' | 'success'
}) {
  const colors: Record<string, string> = {
    accent: '#1a73e8',
    violet: '#6d49f9',
    orange: '#e8710a',
    success: '#137333',
  }
  return (
    <Card>
      <div class="text-[0.6875rem] uppercase tracking-wider text-fg-subtle">{label}</div>
      <div
        class="text-2xl font-bold tabular-nums mt-1"
        style={{ color: colors[tone] }}
      >
        {loading ? '—' : value}
      </div>
      {sub && <div class="text-[0.6875rem] text-fg-muted mt-0.5">{sub}</div>}
    </Card>
  )
}
