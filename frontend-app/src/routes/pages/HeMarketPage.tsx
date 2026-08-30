import { useState } from 'preact/hooks'
import {
  GraduationCap, Building2, Users, TrendingDown, Target, Swords, Settings2, RefreshCw, AlertTriangle, Check,
} from '@/components/ui/icon-set'
import {
  useHeOverview, useHeAreas, useHeCities, useHeUfs, useHeCompetitors, useHeOpportunities,
  useHeMyIes, useHeSettings, useHeInstitutionSearch, useSaveHeSettings, useHeImports, useRunHeImport,
  type HeFilters, type HeRatios,
} from '@/hooks/useHeMarket'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { SearchInput } from '@/components/ui/SearchInput'
import { toast } from '@/lib/toast'

// ── formatação ───────────────────────────────────────────────────────────────

const num = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toLocaleString('pt-BR'))
/** Percentual; `null` vira "—" em vez de 0% — a distinção importa (ver EAD). */
const pct = (v: number | null | undefined, digits = 1) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(digits)}%`)
const dec = (v: number | null | undefined, digits = 1) => (v === null || v === undefined ? '—' : v.toFixed(digits))

const MODALITY: Record<number, string> = { 1: 'Presencial', 2: 'EAD' }
const DEGREE: Record<number, string> = { 1: 'Bacharelado', 2: 'Licenciatura', 3: 'Tecnológico', 4: 'Sequencial' }

/** Ocupação: quanto menor, mais vaga sobrando. */
function occTone(v: number | null): 'danger' | 'warning' | 'success' | 'neutral' {
  if (v === null) return 'neutral'
  if (v < 0.4) return 'danger'
  if (v < 0.7) return 'warning'
  return 'success'
}

function Kpi({ label, value, hint, icon, tone, delta, deltaGoodWhen = 'up' }: {
  label: string; value: string; hint?: string; icon?: preact.JSX.Element
  tone?: 'danger' | 'warning' | 'success'
  /** Variação relativa vs. ano anterior (0.12 = +12%). */
  delta?: number | null
  deltaGoodWhen?: 'up' | 'down'
}) {
  const toneClass = tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : tone === 'success' ? 'text-success' : 'text-fg'
  const good = delta === null || delta === undefined ? null : (deltaGoodWhen === 'up' ? delta >= 0 : delta <= 0)
  return (
    <Card>
      <div class="flex items-center gap-2 text-fg-muted text-xs">{icon}{label}</div>
      <div class="flex items-baseline gap-2 mt-1">
        <span class={`text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</span>
        {delta !== null && delta !== undefined && isFinite(delta) && (
          <span class={`text-xs tabular-nums ${good ? 'text-success' : 'text-danger'}`}>
            {delta >= 0 ? '+' : ''}{(delta * 100).toFixed(1)}%
          </span>
        )}
      </div>
      {hint && <div class="text-2xs text-fg-muted mt-0.5">{hint}</div>}
    </Card>
  )
}

/** Barra horizontal simples — uma série só, sem lib de chart. */
function Bar({ value, max, tone = 'accent' }: { value: number; max: number; tone?: 'accent' | 'danger' }) {
  const w = max > 0 ? Math.max(1, Math.round((value / max) * 100)) : 0
  return (
    <div class="h-1.5 bg-surface-3 rounded-full overflow-hidden">
      <div class={`h-full rounded-full ${tone === 'danger' ? 'bg-danger/70' : 'bg-accent/70'}`} style={{ width: `${w}%` }} />
    </div>
  )
}

/** Aviso recorrente: sem ele o usuário lê "—" como bug. */
function EadNote() {
  return (
    <p class="text-2xs text-fg-muted flex items-start gap-1.5 mt-3">
      <AlertTriangle size={12} class="mt-0.5 shrink-0" />
      <span>
        Ocupação, vagas ociosas e candidatos por vaga consideram <b>apenas cursos presenciais</b>:
        no EAD as vagas são declaradas na sede, não em cada polo, então esses indicadores não existem
        para a modalidade a distância — aparecem como “—”.
      </span>
    </p>
  )
}

// ── aba: panorama ────────────────────────────────────────────────────────────

function OverviewTab({ f }: { f: HeFilters }) {
  const { data, isLoading } = useHeOverview(f)
  const cities = useHeCities(f)

  if (isLoading) return <div class="grid grid-cols-2 md:grid-cols-4 gap-3">{[0,1,2,3,4,5,6,7].map((i) => <Skeleton key={i} class="h-24" />)}</div>
  if (!data || data.empty) return <EmptyState title="Nenhum censo ingerido" description="Ingira um ano do Censo da Educação Superior na aba Configuração." />

  const t = data.total, p = data.presential, e = data.ead
  const prev = data.previous
  // Variação relativa; null quando não há ano anterior ingerido ou o valor é nulo.
  const d = (now: number | null, before: number | null | undefined) =>
    now === null || before === null || before === undefined || before === 0 ? null : (now - before) / Math.abs(before)
  const yearHint = prev ? `vs ${prev.year}` : undefined

  return (
    <div class="space-y-4">
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Matrículas" value={num(t.enrolled)} hint={yearHint ?? `${num(t.institutions)} instituições`} icon={<Users size={16} />}
          delta={d(t.enrolled, prev?.total.enrolled)} />
        <Kpi
          label="Ocupação de vagas" value={pct(p.occupancy)} tone={occTone(p.occupancy)}
          hint={yearHint ? `presencial · ${yearHint}` : 'presencial'} icon={<Target size={16} />}
          delta={d(p.occupancy, prev?.presential.occupancy)}
        />
        <Kpi label="Vagas ociosas" value={num(p.idleSeats)} hint={`de ${num(p.seatsPres)} presenciais`} icon={<Building2 size={16} />}
          delta={d(p.idleSeats, prev?.presential.idleSeats)} deltaGoodWhen="down" />
        <Kpi label="Conversão inscrito→ingressante" value={pct(t.conversion)} hint={`${num(t.applicants)} inscritos`}
          delta={d(t.conversion, prev?.total.conversion)} />
        <Kpi label="Evasão" value={pct(t.dropoutRate)} tone={(t.dropoutRate ?? 0) > 0.3 ? 'danger' : undefined} hint="desvinculados / matrículas" icon={<TrendingDown size={16} />}
          delta={d(t.dropoutRate, prev?.total.dropoutRate)} deltaGoodWhen="down" />
        <Kpi label="Trancamentos" value={pct(t.lockedRate)} />
        <Kpi label="EAD" value={pct(t.enrolled > 0 ? e.enrolled / t.enrolled : null)} hint={`${num(e.enrolled)} matrículas`} />
        <Kpi label="FIES / PROUNI" value={`${pct(t.enrolled > 0 ? t.fies / t.enrolled : null, 1)} / ${pct(t.enrolled > 0 ? t.prouni / t.enrolled : null, 1)}`} hint="das matrículas" />
      </div>

      <Card>
        <div class="text-sm font-semibold text-fg mb-1">Presencial × EAD</div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
          <div class="rounded-lg bg-surface-2 p-3">
            <div class="text-xs font-semibold text-fg-muted mb-2">Presencial</div>
            <dl class="space-y-1 text-sm">
              <div class="flex justify-between"><dt class="text-fg-muted">Matrículas</dt><dd class="tabular-nums text-fg">{num(p.enrolled)}</dd></div>
              <div class="flex justify-between"><dt class="text-fg-muted">Vagas</dt><dd class="tabular-nums text-fg">{num(p.seatsPres)}</dd></div>
              <div class="flex justify-between"><dt class="text-fg-muted">Ocupação</dt><dd class="tabular-nums text-fg">{pct(p.occupancy)}</dd></div>
              <div class="flex justify-between"><dt class="text-fg-muted">Candidatos/vaga</dt><dd class="tabular-nums text-fg">{dec(p.applicantsPerSeat)}</dd></div>
            </dl>
          </div>
          <div class="rounded-lg bg-surface-2 p-3">
            <div class="text-xs font-semibold text-fg-muted mb-2">EAD</div>
            <dl class="space-y-1 text-sm">
              <div class="flex justify-between"><dt class="text-fg-muted">Matrículas</dt><dd class="tabular-nums text-fg">{num(e.enrolled)}</dd></div>
              <div class="flex justify-between"><dt class="text-fg-muted">Ingressantes</dt><dd class="tabular-nums text-fg">{num(e.entrants)}</dd></div>
              <div class="flex justify-between"><dt class="text-fg-muted">Ocupação</dt><dd class="tabular-nums text-fg-muted">—</dd></div>
              <div class="flex justify-between"><dt class="text-fg-muted">Evasão</dt><dd class="tabular-nums text-fg">{pct(e.dropoutRate)}</dd></div>
            </dl>
          </div>
        </div>
        <EadNote />
      </Card>

      <Card>
        <div class="text-sm font-semibold text-fg mb-3">Praças {f.uf ? `em ${f.uf}` : '(Brasil)'}</div>
        {cities.isLoading ? (
          <div class="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} class="h-8" />)}</div>
        ) : (
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="text-left text-xs text-fg-muted border-b border-border">
                  <th class="py-2 pr-3 font-medium">Município</th>
                  <th class="py-2 pr-3 font-medium text-right">Matrículas</th>
                  <th class="py-2 pr-3 font-medium text-right">Ocupação</th>
                  <th class="py-2 pr-3 font-medium text-right">Ociosas</th>
                  <th class="py-2 pr-3 font-medium text-right">Evasão</th>
                  <th class="py-2 font-medium text-right">IES</th>
                </tr>
              </thead>
              <tbody>
                {(cities.data?.cities || []).slice(0, 20).map((c) => (
                  <tr key={c.cityCode} class="border-b border-border/50 last:border-0 hover:bg-surface-2">
                    <td class="py-2 pr-3 text-fg">{c.city}<span class="text-fg-muted text-xs">/{c.uf}</span></td>
                    <td class="py-2 pr-3 text-right tabular-nums text-fg">{num(c.enrolled)}</td>
                    <td class="py-2 pr-3 text-right"><Badge tone={occTone(c.occupancy)}>{pct(c.occupancy, 0)}</Badge></td>
                    <td class="py-2 pr-3 text-right tabular-nums text-fg">{num(c.idleSeats)}</td>
                    <td class="py-2 pr-3 text-right tabular-nums text-fg">{pct(c.dropoutRate, 0)}</td>
                    <td class="py-2 text-right tabular-nums text-fg-muted">{num(c.institutions)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

// ── aba: áreas e oportunidades ───────────────────────────────────────────────

function AreasTab({ f }: { f: HeFilters }) {
  const areas = useHeAreas(f)
  const opps = useHeOpportunities(f)
  const list = areas.data?.areas || []
  const maxEnrolled = Math.max(...list.map((a) => a.enrolled), 1)

  return (
    <div class="space-y-4">
      <Card>
        <div class="text-sm font-semibold text-fg">Onde o mercado pede mais oferta</div>
        <p class="text-xs text-fg-muted mt-1 mb-3">
          Muitos candidatos por vaga com ocupação baixa significa demanda existente que não vira matrícula —
          problema de captação, não de mercado. Só cursos presenciais.
        </p>
        {opps.isLoading ? (
          <div class="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} class="h-8" />)}</div>
        ) : (opps.data?.opportunities || []).length === 0 ? (
          <p class="text-sm text-fg-muted">Sem dados para este recorte.</p>
        ) : (
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="text-left text-xs text-fg-muted border-b border-border">
                  <th class="py-2 pr-3 font-medium">Área</th>
                  <th class="py-2 pr-3 font-medium text-right">Candidatos/vaga</th>
                  <th class="py-2 pr-3 font-medium text-right">Ocupação</th>
                  <th class="py-2 pr-3 font-medium text-right">Vagas ociosas</th>
                  <th class="py-2 font-medium text-right">Matrículas</th>
                </tr>
              </thead>
              <tbody>
                {(opps.data?.opportunities || []).slice(0, 12).map((o, i) => (
                  <tr key={`${o.cineArea}-${i}`} class="border-b border-border/50 last:border-0 hover:bg-surface-2">
                    <td class="py-2 pr-3 text-fg">{o.cineArea}</td>
                    <td class="py-2 pr-3 text-right tabular-nums font-medium text-fg">{dec(o.applicantsPerSeat)}</td>
                    <td class="py-2 pr-3 text-right"><Badge tone={occTone(o.occupancy)}>{pct(o.occupancy, 0)}</Badge></td>
                    <td class="py-2 pr-3 text-right tabular-nums text-fg">{num(o.idleSeats)}</td>
                    <td class="py-2 text-right tabular-nums text-fg-muted">{num(o.enrolled)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <div class="text-sm font-semibold text-fg mb-3">Todas as áreas</div>
        {areas.isLoading ? (
          <div class="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} class="h-10" />)}</div>
        ) : (
          <div class="space-y-3">
            {list.map((a) => (
              <div key={a.cineArea}>
                <div class="flex items-baseline justify-between gap-3 flex-wrap">
                  <span class="text-sm text-fg">{a.cineArea}</span>
                  <span class="text-xs text-fg-muted tabular-nums">
                    {num(a.enrolled)} matrículas · ocupação {pct(a.occupancy, 0)} · {dec(a.applicantsPerSeat)} cand/vaga · evasão {pct(a.dropoutRate, 0)}
                  </span>
                </div>
                <div class="mt-1"><Bar value={a.enrolled} max={maxEnrolled} /></div>
              </div>
            ))}
          </div>
        )}
        <EadNote />
      </Card>
    </div>
  )
}

// ── aba: concorrentes ────────────────────────────────────────────────────────

function CompetitorsTab({ f }: { f: HeFilters }) {
  const [area, setArea] = useState('')
  const areas = useHeAreas(f)
  const { data, isLoading } = useHeCompetitors(f, area)
  const list = data?.competitors || []

  return (
    <Card>
      <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <div class="text-sm font-semibold text-fg">Quem disputa esta praça</div>
          <p class="text-xs text-fg-muted mt-1">Participação por matrícula. A sua instituição aparece destacada.</p>
        </div>
        <Select value={area} onChange={(e) => setArea((e.target as HTMLSelectElement).value)}>
          <option value="">Todas as áreas</option>
          {(areas.data?.areas || []).map((a) => <option key={a.cineArea} value={a.cineArea}>{a.cineArea}</option>)}
        </Select>
      </div>

      {isLoading ? (
        <div class="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} class="h-10" />)}</div>
      ) : list.length === 0 ? (
        <EmptyState title="Sem instituições neste recorte" description="Amplie o filtro de praça ou área." />
      ) : (
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-left text-xs text-fg-muted border-b border-border">
                <th class="py-2 pr-3 font-medium">Instituição</th>
                <th class="py-2 pr-3 font-medium text-right">Share</th>
                <th class="py-2 pr-3 font-medium text-right">Matrículas</th>
                <th class="py-2 pr-3 font-medium text-right">Ocupação</th>
                <th class="py-2 pr-3 font-medium text-right">Conversão</th>
                <th class="py-2 font-medium text-right">Evasão</th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.coIes} class={`border-b border-border/50 last:border-0 ${c.isMine ? 'bg-accent/10' : 'hover:bg-surface-2'}`}>
                  <td class="py-2 pr-3">
                    <div class="flex items-center gap-2 min-w-0">
                      <span class="text-fg truncate max-w-[320px]" title={c.name}>{c.name}</span>
                      {c.isMine && <Badge tone="accent" solid>minha IES</Badge>}
                      {!c.isPrivate && <Badge tone="neutral">pública</Badge>}
                    </div>
                  </td>
                  <td class="py-2 pr-3 text-right tabular-nums text-fg">{pct(c.share)}</td>
                  <td class="py-2 pr-3 text-right tabular-nums text-fg">{num(c.enrolled)}</td>
                  <td class="py-2 pr-3 text-right"><Badge tone={occTone(c.occupancy)}>{pct(c.occupancy, 0)}</Badge></td>
                  <td class="py-2 pr-3 text-right tabular-nums text-fg">{pct(c.conversion, 0)}</td>
                  <td class="py-2 text-right tabular-nums text-fg">{pct(c.dropoutRate, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <EadNote />
    </Card>
  )
}

// ── aba: minha IES ───────────────────────────────────────────────────────────

function Comparison({ label, mine, market, format, betterWhen }: {
  label: string
  mine: number | null
  market: number | null
  format: (v: number | null) => string
  betterWhen: 'higher' | 'lower'
}) {
  const has = mine !== null && market !== null
  const better = has ? (betterWhen === 'higher' ? mine! > market! : mine! < market!) : null
  const diff = has ? Math.abs(mine! - market!) : null

  return (
    <div class="rounded-lg bg-surface-2 p-3">
      <div class="text-2xs text-fg-muted">{label}</div>
      <div class="flex items-baseline gap-2 mt-1">
        <span class={`text-xl font-semibold tabular-nums ${better === null ? 'text-fg' : better ? 'text-success' : 'text-danger'}`}>
          {format(mine)}
        </span>
        <span class="text-xs text-fg-muted">vs {format(market)} do mercado</span>
      </div>
      {has && (
        <div class={`text-3xs mt-0.5 ${better ? 'text-success' : 'text-danger'}`}>
          {better ? 'melhor' : 'pior'} que a praça em {format(diff)}
        </div>
      )}
    </div>
  )
}

function MyIesTab({ f, onGoToSettings }: { f: HeFilters; onGoToSettings: () => void }) {
  const { data, isLoading } = useHeMyIes(f.year)

  if (isLoading) return <div class="space-y-3"><Skeleton class="h-24" /><Skeleton class="h-40" /></div>
  if (!data?.configured) {
    return (
      <EmptyState
        title="Nenhuma instituição vinculada"
        description="Escolha na aba Configuração qual instituição é a sua para comparar seu desempenho com o das concorrentes da mesma praça e área."
        action={<Button size="sm" variant="primary" onClick={onGoToSettings}>Ir para Configuração</Button>}
      />
    )
  }

  const m = data.summary!
  const b = data.benchmark!

  return (
    <div class="space-y-4">
      <Card>
        <div class="text-sm font-semibold text-fg">Seu desempenho vs. a praça</div>
        <p class="text-xs text-fg-muted mt-1 mb-3">
          O mercado aqui são as instituições que atuam nos <b>mesmos municípios e nas mesmas áreas</b> que você —
          comparar com o país inteiro não diria nada.
        </p>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <Comparison label="Ocupação de vagas" mine={m.occupancy} market={b.occupancy} format={(v) => pct(v)} betterWhen="higher" />
          <Comparison label="Conversão inscrito→ingressante" mine={m.conversion} market={b.conversion} format={(v) => pct(v)} betterWhen="higher" />
          <Comparison label="Evasão" mine={m.dropoutRate} market={b.dropoutRate} format={(v) => pct(v)} betterWhen="lower" />
          <Comparison label="Trancamento" mine={m.lockedRate} market={b.lockedRate} format={(v) => pct(v)} betterWhen="lower" />
        </div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
          <Kpi label="Matrículas" value={num(m.enrolled)} />
          <Kpi label="Cursos" value={num(m.courses)} />
          <Kpi label="Vagas ociosas" value={num(m.idleSeats)} hint="presencial" tone={(m.idleSeats ?? 0) > 0 ? 'warning' : undefined} />
          <Kpi label="Concluintes" value={num(m.graduates)} />
        </div>
        <EadNote />
      </Card>

      <Card>
        <div class="text-sm font-semibold text-fg mb-1">Onde a vaga está sobrando</div>
        <p class="text-xs text-fg-muted mb-3">
          Ordenado pelo número de vagas não preenchidas. Muitos inscritos e baixa ocupação = perde no fechamento
          da matrícula; poucos inscritos = falta gerar demanda.
        </p>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-left text-xs text-fg-muted border-b border-border">
                <th class="py-2 pr-3 font-medium">Curso</th>
                <th class="py-2 pr-3 font-medium">Praça</th>
                <th class="py-2 pr-3 font-medium text-right">Vagas</th>
                <th class="py-2 pr-3 font-medium text-right">Inscritos</th>
                <th class="py-2 pr-3 font-medium text-right">Ingressantes</th>
                <th class="py-2 pr-3 font-medium text-right">Ociosas</th>
                <th class="py-2 font-medium text-right">Ocupação</th>
              </tr>
            </thead>
            <tbody>
              {data.courses.map((c, i) => (
                <tr key={`${c.name}-${i}`} class="border-b border-border/50 last:border-0 hover:bg-surface-2">
                  <td class="py-2 pr-3">
                    <div class="text-fg truncate max-w-[280px]" title={c.name}>{c.name}</div>
                    <div class="text-3xs text-fg-muted">
                      {MODALITY[c.modality] || '—'}{c.degree ? ` · ${DEGREE[c.degree] || ''}` : ''}
                    </div>
                  </td>
                  <td class="py-2 pr-3 text-xs text-fg-muted">{c.city || '—'}</td>
                  <td class="py-2 pr-3 text-right tabular-nums text-fg">{num(c.seats)}</td>
                  <td class="py-2 pr-3 text-right tabular-nums text-fg">{num(c.applicants)}</td>
                  <td class="py-2 pr-3 text-right tabular-nums text-fg">{num(c.entrants)}</td>
                  <td class="py-2 pr-3 text-right tabular-nums text-fg">{num(c.idleSeats)}</td>
                  <td class="py-2 text-right"><Badge tone={occTone(c.occupancy)}>{pct(c.occupancy, 0)}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

// ── aba: configuração ────────────────────────────────────────────────────────

function SettingsTab() {
  const settings = useHeSettings()
  const imports = useHeImports()
  const save = useSaveHeSettings()
  const run = useRunHeImport()
  const [q, setQ] = useState('')
  const [uf, setUf] = useState('')
  const search = useHeInstitutionSearch(q, uf)

  const selected = settings.data?.institutions || []
  const myIes = settings.data?.myIes || []
  const done = imports.data?.imports?.filter((i) => i.status === 'done') || []
  const running = imports.data?.imports?.find((i) => i.status === 'running')
  const pending = (imports.data?.available || []).filter((y) => !done.some((d) => d.year === y))

  function toggle(coIes: number) {
    const next = myIes.includes(coIes) ? myIes.filter((c) => c !== coIes) : [...myIes, coIes]
    save.mutate(next, {
      onSuccess: () => toast('Instituições atualizadas', 'success'),
      onError: (e: unknown) => toast((e as Error).message || 'Falha ao salvar', 'danger'),
    })
  }

  return (
    <div class="space-y-4">
      <Card>
        <div class="text-sm font-semibold text-fg">Minha instituição</div>
        <p class="text-xs text-fg-muted mt-1 mb-3">
          Selecione a IES do cliente. É o que habilita a aba “Minha IES” e destaca a instituição na lista de concorrentes.
        </p>

        {selected.length > 0 && (
          <div class="flex flex-wrap gap-2 mb-3">
            {selected.map((i) => (
              <button
                key={i.coIes}
                onClick={() => toggle(i.coIes)}
                class="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-accent text-fg-on-brand text-xs"
                title="Remover"
              >
                <Check size={12} /> {i.acronym || i.name}
              </button>
            ))}
          </div>
        )}

        <div class="flex flex-wrap gap-2">
          <SearchInput value={q} onChange={setQ} placeholder="Buscar instituição pelo nome ou sigla…" class="flex-1 min-w-[220px]" />
          <Select value={uf} onChange={(e) => setUf((e.target as HTMLSelectElement).value)}>
            <option value="">Todas as UFs</option>
            {['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'].map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </Select>
        </div>

        {q.trim().length >= 2 && (
          <div class="mt-3 max-h-72 overflow-y-auto rounded-lg border border-border divide-y divide-border/60">
            {(search.data?.institutions || []).map((i) => {
              const on = myIes.includes(i.coIes)
              return (
                <button
                  key={i.coIes}
                  onClick={() => toggle(i.coIes)}
                  class={`w-full text-left px-3 py-2 hover:bg-surface-2 flex items-center justify-between gap-2 ${on ? 'bg-accent/10' : ''}`}
                >
                  <span class="min-w-0">
                    <span class="text-sm text-fg block truncate">{i.name}</span>
                    <span class="text-2xs text-fg-muted">
                      {i.acronym ? `${i.acronym} · ` : ''}{i.city || '—'}/{i.uf || '—'} · {i.isPrivate ? 'privada' : 'pública'} · CO_IES {i.coIes}
                    </span>
                  </span>
                  {on && <Check size={14} class="text-accent shrink-0" />}
                </button>
              )
            })}
            {search.data && search.data.institutions.length === 0 && (
              <p class="px-3 py-2 text-sm text-fg-muted">Nenhuma instituição encontrada.</p>
            )}
          </div>
        )}
      </Card>

      <Card>
        <div class="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div class="text-sm font-semibold text-fg">Censo da Educação Superior (INEP/MEC)</div>
            <p class="text-xs text-fg-muted mt-1">
              {done.length > 0
                ? <>Anos ingeridos: <b class="text-fg">{done.map((d) => d.year).join(', ')}</b> — {num(done[0].courses)} registros de curso.</>
                : 'Nenhum ano ingerido ainda.'}
              {pending.length > 0 && <> · Disponíveis: {pending.slice(0, 4).join(', ')}.</>}
              <br />
              O pacote tem ~457 MB e a carga leva alguns minutos. Os dados de um ano são publicados cerca de 18 meses depois —
              é base para estratégia, não para operação do dia a dia.
            </p>
            {running && <p class="text-xs text-info mt-1">Ingestão de {running.year} em andamento…</p>}
          </div>
          <div class="flex gap-2">
            {pending.slice(0, 2).map((y) => (
              <Button
                key={y} size="sm" variant={y === pending[0] ? 'primary' : 'secondary'}
                disabled={run.isPending || !!running}
                onClick={() => run.mutate({ year: y }, {
                  onSuccess: () => toast(`Ingestão de ${y} iniciada`, 'success'),
                  onError: (e: unknown) => toast((e as Error).message || 'Falha', 'danger'),
                })}
              >
                <RefreshCw size={14} /> Ingerir {y}
              </Button>
            ))}
          </div>
        </div>
      </Card>
    </div>
  )
}

// ── página ───────────────────────────────────────────────────────────────────

type Tab = 'overview' | 'areas' | 'competitors' | 'mine' | 'settings'

const TABS: { id: Tab; label: string; icon: preact.JSX.Element }[] = [
  { id: 'overview', label: 'Panorama', icon: <Building2 size={14} /> },
  { id: 'areas', label: 'Áreas & oportunidades', icon: <Target size={14} /> },
  { id: 'competitors', label: 'Concorrentes', icon: <Swords size={14} /> },
  { id: 'mine', label: 'Minha IES', icon: <GraduationCap size={14} /> },
  { id: 'settings', label: 'Configuração', icon: <Settings2 size={14} /> },
]

export function HeMarketPage() {
  const [tab, setTab] = useState<Tab>('overview')
  const [uf, setUf] = useState('')
  const [cityCode, setCityCode] = useState<number | null>(null)
  const [pickedYear, setPickedYear] = useState<number | null>(null)

  const imports = useHeImports()
  const doneYears = (imports.data?.imports || []).filter((i) => i.status === 'done').map((i) => i.year).sort((a, b) => b - a)
  // Sem escolha explícita, usa o censo mais recente já ingerido.
  const year = pickedYear ?? doneYears[0]
  const f: HeFilters = { year, uf, cityCode }

  const ufs = useHeUfs(year)
  const cities = useHeCities({ year, uf, cityCode: null })

  return (
    <Page
      title="Mercado — Ensino Superior"
      description="Censo da Educação Superior (INEP/MEC): ocupação de vagas, captação, evasão e concorrência na praça, para decidir onde investir."
    >
      <div class="flex gap-1 border-b border-border overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            class={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px whitespace-nowrap transition-colors ${
              tab === t.id ? 'border-accent text-fg font-medium' : 'border-transparent text-fg-muted hover:text-fg'
            }`}
          >
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {tab !== 'settings' && tab !== 'mine' && (
        <Card>
          <div class="flex flex-wrap items-center gap-2">
            <Select
              value={uf}
              onChange={(e) => { setUf((e.target as HTMLSelectElement).value); setCityCode(null) }}
            >
              <option value="">Brasil</option>
              {(ufs.data?.ufs || []).map((u) => <option key={u.uf} value={u.uf}>{u.uf}</option>)}
            </Select>
            <Select
              value={cityCode ? String(cityCode) : ''}
              onChange={(e) => {
                const v = (e.target as HTMLSelectElement).value
                setCityCode(v ? parseInt(v, 10) : null)
              }}
            >
              <option value="">Todas as praças</option>
              {(cities.data?.cities || []).slice(0, 100).map((c) => (
                <option key={c.cityCode} value={String(c.cityCode)}>{c.city}</option>
              ))}
            </Select>
            {doneYears.length > 1 ? (
              <Select
                value={year ? String(year) : ''}
                onChange={(e) => setPickedYear(parseInt((e.target as HTMLSelectElement).value, 10))}
              >
                {doneYears.map((y) => <option key={y} value={String(y)}>Censo {y}</option>)}
              </Select>
            ) : year ? (
              <span class="text-xs text-fg-muted">censo {year}</span>
            ) : null}
          </div>
        </Card>
      )}

      {tab === 'overview' && <OverviewTab f={f} />}
      {tab === 'areas' && <AreasTab f={f} />}
      {tab === 'competitors' && <CompetitorsTab f={f} />}
      {tab === 'mine' && <MyIesTab f={f} onGoToSettings={() => setTab('settings')} />}
      {tab === 'settings' && <SettingsTab />}
    </Page>
  )
}
