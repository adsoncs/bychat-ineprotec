// Relatório de uma Pesquisa / NPS.
//
// A leitura é de cima para baixo, na ordem em que a pergunta aparece na cabeça de
// quem abre: qual é o índice (número herói), quanta gente respondeu, como as notas
// se dividem, qual pergunta puxou para baixo e, por fim, o que as pessoas
// escreveram — o comentário sempre ao lado da nota de quem o escreveu, porque ler
// crítica sem saber se veio de um detrator ou de um promotor não decide nada.
//
// Nenhum número é calculado aqui: tudo vem de computeSurveyResults. Cor nunca é a
// única codificação — toda marca tem rótulo e existe a visão em tabela.

import { useMemo, useState } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import { ArrowLeft, RefreshCw, Table2, BarChart3, MessageSquareQuote, Users } from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { useSurveyResults, CATEGORY_LABEL, type NpsCategory, type SurveyResults } from '@/hooks/useSurveys'
import { cn } from '@/lib/cn'

// Faixas do NPS → token de cor do gráfico. É codificação de ESTADO (bom/neutro/
// ruim), não de identidade: por isso vem de tokens próprios e anda sempre com
// rótulo.
const CAT_VAR: Record<NpsCategory, string> = {
  promoter: 'var(--chart-promoter)',
  passive: 'var(--chart-passive)',
  detractor: 'var(--chart-detractor)',
}
// Texto sobre a marca: branco no verde e no vermelho (≈5:1), escuro no âmbar —
// branco sobre âmbar fica em 3:1, abaixo do mínimo para texto pequeno.
const CAT_INK: Record<NpsCategory, string> = {
  promoter: '#ffffff',
  passive: '#1a1400',
  detractor: '#ffffff',
}
const catOf = (n: number): NpsCategory => (n >= 9 ? 'promoter' : n >= 7 ? 'passive' : 'detractor')

const pct = (part: number, total: number) => (total ? Math.round((part / total) * 100) : 0)

export function SurveyResultsPage({ params }: { params: { id: string } }) {
  const [, navigate] = useLocation()
  const id = params?.id ? Number(params.id) : null
  const { data, isLoading, isFetching, refetch } = useSurveyResults(id)
  const [asTable, setAsTable] = useState(false)

  if (isLoading) {
    return (
      <Page title="Pesquisa">
        <div class="grid gap-4 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} class="h-24 rounded-lg" />)}
        </div>
        <Skeleton class="h-64 rounded-lg" />
      </Page>
    )
  }

  if (!data) {
    return (
      <Page title="Pesquisa">
        <EmptyState title="Pesquisa não encontrada" description="Ela pode ter sido apagada." />
      </Page>
    )
  }

  return (
    <Page
      title={data.survey.name}
      description={data.survey.description ?? 'Resultados da pesquisa'}
      actions={
        <>
          <Button variant="ghost" size="sm" onClick={() => navigate('/app/surveys')}>
            <ArrowLeft size={14} /> Pesquisas
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setAsTable((v) => !v)}>
            {asTable ? <BarChart3 size={14} /> : <Table2 size={14} />} {asTable ? 'Ver gráficos' : 'Ver tabela'}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw size={14} class={isFetching ? 'animate-spin' : ''} /> Atualizar
          </Button>
        </>
      }
    >
      {/* Refetch nunca volta ao esqueleto: segura o render anterior esmaecido. */}
      <div class={cn('space-y-6 transition-opacity', isFetching && 'opacity-60')}>
        <HeadlineRow r={data} />
        {data.totals.responses === 0 ? (
          <EmptyState
            title="Nenhuma resposta ainda"
            description={data.totals.invites
              ? `${data.totals.invites} convite(s) enviado(s). Os resultados aparecem aqui conforme as pessoas respondem.`
              : 'Dispare a pesquisa para começar a receber respostas.'}
          />
        ) : asTable ? (
          <TableView r={data} />
        ) : (
          <>
            <SplitBar r={data} />
            <Distribution r={data} />
            <QuestionAverages r={data} />
            <Comments r={data} />
          </>
        )}
      </div>
    </Page>
  )
}

// ── Número herói + estatísticas ──────────────────────────────────────────────

function HeadlineRow({ r }: { r: SurveyResults }) {
  const { nps, totals } = r
  return (
    <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <Card class="flex flex-col justify-center items-start gap-1 p-5">
        <span class="text-xs uppercase tracking-wider text-fg-subtle font-medium">NPS</span>
        {/* Figura herói: mesma fonte de tudo, algarismos proporcionais. */}
        <span class="text-5xl font-semibold leading-none text-fg">
          {nps.score == null ? '—' : nps.score}
        </span>
        <span class="text-xs text-fg-muted">
          {nps.score == null
            ? 'Sem pergunta de recomendação respondida'
            : `de −100 a 100 · ${nps.answered} resposta(s)`}
        </span>
      </Card>
      <div class="grid gap-4 sm:grid-cols-3">
        <Stat label="Respostas" value={totals.responses} hint={`${totals.invites} convite(s)`} />
        <Stat
          label="Taxa de resposta"
          value={totals.responseRate == null ? '—' : `${totals.responseRate}%`}
          hint={totals.pending ? `${totals.pending} sem responder` : 'todos responderam'}
        />
        <Stat label="Convites expirados" value={totals.expired} hint="passaram da janela" />
      </div>
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div class="rounded-lg border border-border bg-surface-2 p-4 flex flex-col gap-1">
      <span class="text-xs uppercase tracking-wider text-fg-subtle font-medium">{label}</span>
      <span class="text-2xl font-semibold text-fg">{value}</span>
      {hint && <span class="text-xs text-fg-muted">{hint}</span>}
    </div>
  )
}

// ── Divisão promotores / neutros / detratores ────────────────────────────────
// Parte-do-todo de UM total → uma barra empilhada, com 2px de superfície entre os
// segmentos (respiro, não borda) e legenda sempre presente.

function SplitBar({ r }: { r: SurveyResults }) {
  const { promoters, passives, detractors, answered } = r.nps
  const segs: { cat: NpsCategory; n: number }[] = [
    { cat: 'promoter', n: promoters },
    { cat: 'passive', n: passives },
    { cat: 'detractor', n: detractors },
  ]
  if (!answered) return null
  return (
    <Card class="p-5 space-y-3">
      <h2 class="text-sm font-semibold text-fg">Divisão das notas de recomendação</h2>
      <div class="flex gap-[2px] h-8 rounded-md overflow-hidden">
        {segs.filter((s) => s.n > 0).map((s) => {
          const p = pct(s.n, answered)
          return (
            <div
              key={s.cat}
              class="flex items-center justify-center min-w-0 first:rounded-l-md last:rounded-r-md"
              style={{ background: CAT_VAR[s.cat], width: `${p}%` }}
              title={`${CATEGORY_LABEL[s.cat]}: ${s.n} (${p}%)`}
            >
              {/* Rótulo dentro só quando cabe; senão fica na legenda e na tabela. */}
              {p >= 12 && <span class="text-xs font-semibold px-1 truncate" style={{ color: CAT_INK[s.cat] }}>{p}%</span>}
            </div>
          )
        })}
      </div>
      <ul class="flex flex-wrap gap-x-5 gap-y-1">
        {segs.map((s) => (
          <li key={s.cat} class="flex items-center gap-2 text-xs text-fg-muted">
            <span class="size-2.5 rounded-sm shrink-0" style={{ background: CAT_VAR[s.cat] }} aria-hidden="true" />
            <span>
              <span class="text-fg font-medium">{CATEGORY_LABEL[s.cat]}</span>{' '}
              {s.n} ({pct(s.n, answered)}%)
            </span>
          </li>
        ))}
      </ul>
      <p class="text-xs text-fg-subtle">
        Promotores dão 9 ou 10, neutros 7 ou 8, detratores de 0 a 6. O índice é a
        porcentagem de promotores menos a de detratores — os neutros não entram na conta.
      </p>
    </Card>
  )
}

// ── Distribuição 0–10 ────────────────────────────────────────────────────────
// Categorias ORDENADAS (nota 0…10) → barras verticais, coloridas pela faixa a que
// a nota pertence. Rótulo direto só na maior barra; o resto vem no hover e na
// tabela, para não virar um número em cima de cada barra.

function Distribution({ r }: { r: SurveyResults }) {
  const d = r.nps.distribution
  const max = Math.max(...d.map((x) => x.count), 1)
  const total = r.nps.answered
  const [hover, setHover] = useState<number | null>(null)
  if (!total) return null
  return (
    <Card class="p-5 space-y-3">
      <h2 class="text-sm font-semibold text-fg">Distribuição das notas de recomendação</h2>
      <div class="flex items-end gap-[2px] h-40 pt-6">
        {d.map((x) => {
          const h = (x.count / max) * 100
          const on = hover === x.score
          return (
            <button
              key={x.score}
              type="button"
              // Alvo de clique cobre a coluna inteira, não só a barra.
              class="relative flex-1 h-full flex flex-col justify-end min-w-0 focus:outline-none"
              onMouseEnter={() => setHover(x.score)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(x.score)}
              onBlur={() => setHover(null)}
              aria-label={`Nota ${x.score}: ${x.count} resposta(s)`}
            >
              {(on || (x.count === max && x.count > 0)) && (
                <span class="absolute -top-5 inset-x-0 text-center text-xs font-medium text-fg">
                  {x.count}
                </span>
              )}
              <span
                class="w-full rounded-t transition-opacity"
                style={{
                  height: `${Math.max(h, x.count ? 3 : 0)}%`,
                  background: CAT_VAR[catOf(x.score)],
                  opacity: hover == null || on ? 1 : 0.55,
                }}
              />
            </button>
          )
        })}
      </div>
      {/* Eixo: régua sólida de um tom acima da superfície, sem tracejado. */}
      <div class="border-t border-border pt-1 flex gap-[2px]">
        {d.map((x) => (
          <span key={x.score} class="flex-1 text-center text-xs text-fg-subtle tabular-nums">{x.score}</span>
        ))}
      </div>
      {/* Faixas na MESMA proporção das colunas (7 · 2 · 2 de 11), senão o rótulo
          aponta para notas que não são as dele. */}
      <div class="flex gap-[2px] text-xs text-fg-subtle">
        <span class="text-center" style={{ flex: '7 1 0' }}>Detratores (0–6)</span>
        <span class="text-center" style={{ flex: '2 1 0' }}>Neutros</span>
        <span class="text-center" style={{ flex: '2 1 0' }}>Promotores</span>
      </div>
    </Card>
  )
}

// ── Média por pergunta ───────────────────────────────────────────────────────
// Uma série só → uma cor só, sem legenda (o título já diz o que é). Rótulos longos
// → barras horizontais. O valor fica na ponta de cada barra.

function QuestionAverages({ r }: { r: SurveyResults }) {
  const qs = r.byQuestion.filter((q) => !q.isNps)
  const ordered = useMemo(() => [...qs].sort((a, b) => (a.avg ?? 0) - (b.avg ?? 0)), [qs])
  if (!ordered.length) return null
  return (
    <Card class="p-5 space-y-3">
      <h2 class="text-sm font-semibold text-fg">Média por pergunta</h2>
      <p class="text-xs text-fg-subtle">Da nota mais baixa para a mais alta — o que precisa de atenção aparece primeiro.</p>
      <ul class="space-y-3">
        {ordered.map((q) => {
          const span = Math.max(q.scaleMax - q.scaleMin, 1)
          const w = q.avg == null ? 0 : ((q.avg - q.scaleMin) / span) * 100
          return (
            <li key={q.key} class="space-y-1">
              <div class="flex items-baseline justify-between gap-3">
                <span class="text-xs text-fg-muted min-w-0">{q.label}</span>
                <span class="text-sm font-semibold text-fg tabular-nums shrink-0">
                  {q.avg == null ? '—' : q.avg.toFixed(1).replace('.', ',')}
                </span>
              </div>
              <div class="h-2 rounded-full bg-surface-3 overflow-hidden">
                <div class="h-full rounded-full bg-accent" style={{ width: `${w}%` }} />
              </div>
              <div class="flex justify-between text-[0.6875rem] text-fg-subtle tabular-nums">
                <span>{q.scaleMin}</span>
                <span>{q.answered} resposta(s)</span>
                <span>{q.scaleMax}</span>
              </div>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

// ── Comentários ──────────────────────────────────────────────────────────────

function Comments({ r }: { r: SurveyResults }) {
  const [filter, setFilter] = useState<NpsCategory | 'all'>('all')
  const list = r.comments.filter((c) => filter === 'all' || c.npsCategory === filter)
  if (!r.comments.length) return null
  return (
    <Card class="p-5 space-y-3">
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <h2 class="text-sm font-semibold text-fg flex items-center gap-2">
          <MessageSquareQuote size={14} class="text-fg-subtle" /> O que escreveram
        </h2>
        <div class="flex gap-1">
          {([['all', 'Todos'], ['detractor', CATEGORY_LABEL.detractor], ['passive', CATEGORY_LABEL.passive], ['promoter', CATEGORY_LABEL.promoter]] as const).map(([v, label]) => (
            <Button key={v} size="sm" variant={filter === v ? 'secondary' : 'ghost'} onClick={() => setFilter(v as any)}>
              {label}
            </Button>
          ))}
        </div>
      </div>
      {!list.length && <p class="text-xs text-fg-subtle">Nenhum comentário nesta faixa.</p>}
      <ul class="space-y-3">
        {list.map((c) => (
          <li key={`${c.responseId}-${c.key}`} class="rounded-md border border-border bg-surface-2 p-3 space-y-1.5">
            <div class="flex items-center gap-2 flex-wrap">
              {c.npsCategory && (
                <span class="inline-flex items-center gap-1.5 text-xs font-medium text-fg">
                  <span class="size-2.5 rounded-sm" style={{ background: CAT_VAR[c.npsCategory] }} aria-hidden="true" />
                  {CATEGORY_LABEL[c.npsCategory]} · nota {c.npsScore}
                </span>
              )}
              <Badge tone="neutral">{c.key}</Badge>
              <span class="text-xs text-fg-subtle inline-flex items-center gap-1">
                <Users size={11} /> {c.nome || 'Não identificado'}
              </span>
            </div>
            <p class="text-sm text-fg whitespace-pre-wrap">{c.text}</p>
          </li>
        ))}
      </ul>
    </Card>
  )
}

// ── Visão em tabela ──────────────────────────────────────────────────────────
// O gêmeo sem cor de tudo que está nos gráficos: é o que garante que nada dependa
// só de cor para ser lido.

function TableView({ r }: { r: SurveyResults }) {
  const total = r.nps.answered
  return (
    <div class="space-y-6">
      <Card class="p-5 space-y-3">
        <h2 class="text-sm font-semibold text-fg">Notas de recomendação</h2>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-left text-xs uppercase tracking-wider text-fg-subtle">
                <th class="py-2 pr-4 font-medium">Faixa</th>
                <th class="py-2 pr-4 font-medium text-right">Respostas</th>
                <th class="py-2 font-medium text-right">%</th>
              </tr>
            </thead>
            <tbody class="text-fg">
              {(['promoter', 'passive', 'detractor'] as NpsCategory[]).map((cat) => {
                const n = cat === 'promoter' ? r.nps.promoters : cat === 'passive' ? r.nps.passives : r.nps.detractors
                return (
                  <tr key={cat} class="border-t border-border">
                    <td class="py-2 pr-4">{CATEGORY_LABEL[cat]}</td>
                    <td class="py-2 pr-4 text-right tabular-nums">{n}</td>
                    <td class="py-2 text-right tabular-nums">{pct(n, total)}%</td>
                  </tr>
                )
              })}
              <tr class="border-t border-border font-semibold">
                <td class="py-2 pr-4">NPS</td>
                <td class="py-2 pr-4 text-right tabular-nums" colSpan={2}>{r.nps.score ?? '—'}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <Card class="p-5 space-y-3">
        <h2 class="text-sm font-semibold text-fg">Distribuição das notas</h2>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-left text-xs uppercase tracking-wider text-fg-subtle">
                <th class="py-2 pr-4 font-medium">Nota</th>
                <th class="py-2 pr-4 font-medium">Faixa</th>
                <th class="py-2 font-medium text-right">Respostas</th>
              </tr>
            </thead>
            <tbody class="text-fg">
              {r.nps.distribution.map((d) => (
                <tr key={d.score} class="border-t border-border">
                  <td class="py-2 pr-4 tabular-nums">{d.score}</td>
                  <td class="py-2 pr-4">{CATEGORY_LABEL[catOf(d.score)]}</td>
                  <td class="py-2 text-right tabular-nums">{d.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card class="p-5 space-y-3">
        <h2 class="text-sm font-semibold text-fg">Média por pergunta</h2>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-left text-xs uppercase tracking-wider text-fg-subtle">
                <th class="py-2 pr-4 font-medium">Pergunta</th>
                <th class="py-2 pr-4 font-medium">Escala</th>
                <th class="py-2 pr-4 font-medium text-right">Respostas</th>
                <th class="py-2 font-medium text-right">Média</th>
              </tr>
            </thead>
            <tbody class="text-fg">
              {r.byQuestion.map((q) => (
                <tr key={q.key} class="border-t border-border">
                  <td class="py-2 pr-4">{q.label}</td>
                  <td class="py-2 pr-4 tabular-nums text-fg-muted">{q.scaleMin}–{q.scaleMax}</td>
                  <td class="py-2 pr-4 text-right tabular-nums">{q.answered}</td>
                  <td class="py-2 text-right tabular-nums font-medium">
                    {q.avg == null ? '—' : q.avg.toFixed(2).replace('.', ',')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
