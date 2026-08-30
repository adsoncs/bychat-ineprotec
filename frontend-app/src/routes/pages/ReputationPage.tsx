import { useState } from 'preact/hooks'
import { Radar, RefreshCw, TrendingUp, TrendingDown, Building2, Flame, ExternalLink, Search, Globe, Swords, AlertTriangle, GraduationCap } from '@/components/ui/icon-set'
import {
  useReputationCompanies, useReputationCompany, useReputationSegments, useReputationImports,
  useUpdateReputationCompany, useRunReputationImport,
  useWebStackScans, useRunStackScan, useCompetitors, useApifyCredits, useDiscoverCompetitors,
  useSchools, useSchoolUfs, useSchoolImports, useRunSchoolImport,
  type ReputationCompany, type ReputationSnapshot, type WebStackScan, type CompetitorAgency, type School,
} from '@/hooks/useReputation'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { SearchInput } from '@/components/ui/SearchInput'
import { toast } from '@/lib/toast'

// ── formatação ───────────────────────────────────────────────────────────────

const pct = (v: number | null, digits = 0) => (v === null ? '—' : `${(v * 100).toFixed(digits)}%`)
const num = (v: number) => v.toLocaleString('pt-BR')
const monthLabel = (period: string) => {
  const [y, m] = period.split('-')
  return `${['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][Number(m) - 1]}/${y.slice(2)}`
}

/** Faixas do score de oportunidade — quanto maior, mais a empresa "dói" hoje. */
function scoreTone(score: number): 'danger' | 'warning' | 'info' | 'neutral' {
  if (score >= 75) return 'danger'
  if (score >= 55) return 'warning'
  if (score >= 35) return 'info'
  return 'neutral'
}

const STATUS_LABEL: Record<string, string> = {
  new: 'Novo', prospecting: 'Em prospecção', converted: 'Virou lead', ignored: 'Descartado',
}
const STATUS_TONE: Record<string, 'neutral' | 'info' | 'success'> = {
  new: 'neutral', prospecting: 'info', converted: 'success', ignored: 'neutral',
}

// ── série mensal ─────────────────────────────────────────────────────────────

/**
 * Volume mensal de reclamações, com a parcela não respondida destacada.
 * Duas séries só (respondidas / sem resposta), então legenda sempre presente —
 * identidade nunca fica por conta da cor sozinha. Sem lib de chart: são divs.
 */
function MonthlyBars({ snapshots }: { snapshots: ReputationSnapshot[] }) {
  const series = snapshots.slice(-12)
  if (series.length === 0) return <p class="text-sm text-fg-muted">Sem histórico ainda.</p>
  const max = Math.max(...series.map((s) => s.complaints), 1)

  return (
    <div>
      <div class="flex items-end gap-1.5 h-32">
        {series.map((s) => {
          const h = Math.max(2, Math.round((s.complaints / max) * 100))
          const unansweredH = s.complaints > 0 ? Math.round((s.unanswered / s.complaints) * h) : 0
          return (
            <div key={s.period} class="flex-1 flex flex-col items-center gap-1 min-w-0">
              <span class="text-3xs tabular-nums text-fg-muted">{num(s.complaints)}</span>
              <div
                class="w-full flex flex-col justify-end rounded-t"
                style={{ height: `${h}%` }}
                title={`${monthLabel(s.period)}: ${num(s.complaints)} reclamações, ${num(s.unanswered)} sem resposta`}
              >
                {unansweredH > 0 && (
                  <div class="w-full bg-danger rounded-t" style={{ height: `${unansweredH}%`, marginBottom: '2px' }} />
                )}
                <div class="w-full bg-accent/70 rounded-t flex-1" />
              </div>
            </div>
          )
        })}
      </div>
      <div class="flex gap-1.5 mt-1">
        {series.map((s) => (
          <span key={s.period} class="flex-1 text-center text-3xs text-fg-muted truncate">{monthLabel(s.period)}</span>
        ))}
      </div>
      <div class="flex items-center gap-4 mt-3 text-2xs text-fg-muted">
        <span class="flex items-center gap-1.5"><i class="w-2.5 h-2.5 rounded-sm bg-danger inline-block" /> Sem resposta</span>
        <span class="flex items-center gap-1.5"><i class="w-2.5 h-2.5 rounded-sm bg-accent/70 inline-block" /> Respondidas</span>
      </div>
    </div>
  )
}

// ── dossiê ───────────────────────────────────────────────────────────────────

function TopList({ title, data }: { title: string; data: Record<string, number> | undefined }) {
  const entries = Object.entries(data || {}).slice(0, 5)
  if (entries.length === 0) return null
  const max = Math.max(...entries.map(([, v]) => v), 1)
  return (
    <div>
      <div class="text-xs font-semibold text-fg-muted mb-2">{title}</div>
      <div class="space-y-1.5">
        {entries.map(([k, v]) => (
          <div key={k}>
            <div class="flex justify-between gap-2 text-xs text-fg">
              <span class="truncate" title={k}>{k}</span>
              <span class="tabular-nums text-fg-muted shrink-0">{num(v)}</span>
            </div>
            <div class="h-1 bg-surface-3 rounded-full mt-0.5 overflow-hidden">
              <div class="h-full bg-accent/60 rounded-full" style={{ width: `${(v / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function CompanyDossier({ id, onClose }: { id: number; onClose: () => void }) {
  const { data, isLoading } = useReputationCompany(id)
  const update = useUpdateReputationCompany()
  const c = data?.company

  function setStatus(status: string) {
    update.mutate({ id, status }, {
      onSuccess: () => toast(`Marcado como "${STATUS_LABEL[status]}"`, 'success'),
      onError: (e: unknown) => toast((e as Error).message || 'Falha ao atualizar', 'danger'),
    })
  }

  const last = c?.snapshots?.[c.snapshots.length - 1]

  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose() }} title={c?.name || 'Carregando…'} size="lg" unconstrained>
      {isLoading || !c ? (
        <div class="space-y-3"><Skeleton class="h-24" /><Skeleton class="h-32" /></div>
      ) : (
        <div class="space-y-5">
          <div class="flex items-center gap-2 flex-wrap">
            <Badge tone={scoreTone(c.opportunityScore)} solid>Score {c.opportunityScore}</Badge>
            {c.segment && <Badge tone="neutral">{c.segment}</Badge>}
            <Badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge>
            {c.lastPeriod && <span class="text-xs text-fg-muted">dados de {monthLabel(c.lastPeriod)}</span>}
          </div>

          <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Reclamações no mês', value: num(c.complaints) },
              { label: 'Sem resposta', value: pct(c.unansweredRate) },
              { label: 'Não resolvidas', value: pct(c.unresolvedRate), hint: 'entre as avaliadas' },
              { label: 'Nota do consumidor', value: c.avgScore ? c.avgScore.toFixed(2) : '—', hint: 'de 1 a 5' },
            ].map((k) => (
              <div key={k.label} class="rounded-lg bg-surface-2 p-3">
                <div class="text-2xs text-fg-muted">{k.label}</div>
                <div class="text-lg font-semibold text-fg tabular-nums mt-0.5">{k.value}</div>
                {k.hint && <div class="text-3xs text-fg-muted">{k.hint}</div>}
              </div>
            ))}
          </div>

          <Card>
            <div class="text-sm font-semibold text-fg mb-3">Volume mensal</div>
            <MonthlyBars snapshots={c.snapshots || []} />
          </Card>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <TopList title="Principais problemas" data={last?.breakdown?.problems} />
            <TopList title="Onde reclamam (UF)" data={last?.breakdown?.ufs} />
            <TopList title="Canal de compra" data={last?.breakdown?.channels} />
          </div>

          <div class="rounded-lg bg-surface-2 p-3 text-xs text-fg-muted">
            Tempo médio de resposta: <b class="text-fg">{c.avgResponseDays ? `${c.avgResponseDays.toFixed(1)} dias` : '—'}</b>
            {c.topProblem && <> · Problema mais citado: <b class="text-fg">{c.topProblem}</b></>}
            <div class="mt-1">
              Fonte: base aberta do Consumidor.gov.br (Senacon/MJ) — dados anonimizados, agregados por empresa.
            </div>
          </div>

          <div class="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div class="flex gap-2">
              <Button size="sm" variant={c.status === 'prospecting' ? 'primary' : 'secondary'} onClick={() => setStatus('prospecting')} disabled={update.isPending}>
                Em prospecção
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setStatus('ignored')} disabled={update.isPending}>
                Descartar
              </Button>
            </div>
            <a
              class="inline-flex items-center gap-1 text-xs text-accent hover:underline"
              href={`https://www.google.com/search?q=${encodeURIComponent(c.name)}`}
              target="_blank" rel="noopener noreferrer"
            >
              Pesquisar a empresa <ExternalLink size={12} />
            </a>
          </div>
        </div>
      )}
    </Modal>
  )
}

// ── ingestão ─────────────────────────────────────────────────────────────────

function IngestCard() {
  const { data, isLoading } = useReputationImports()
  const run = useRunReputationImport()
  const last = data?.imports?.find((i) => i.status === 'done')
  const pending = (data?.available || []).filter((a) => !data?.imports?.some((i) => i.period === a.period && i.status === 'done'))

  return (
    <Card>
      <div class="flex items-start justify-between gap-4 flex-wrap">
        <div class="min-w-0">
          <div class="text-sm font-semibold text-fg">Base do Consumidor.gov.br</div>
          {isLoading ? (
            <Skeleton class="h-4 w-56 mt-1" />
          ) : data?.sourceError ? (
            <p class="text-xs text-danger mt-1">Fonte indisponível: {data.sourceError}</p>
          ) : (
            <p class="text-xs text-fg-muted mt-1">
              {last
                ? <>Último período ingerido: <b class="text-fg">{monthLabel(last.period)}</b> — {num(last.rows)} reclamações, {num(last.companies)} empresas.</>
                : 'Nenhum período ingerido ainda.'}
              {pending.length > 0 && <> · <b class="text-fg">{pending.length}</b> período(s) disponível(is) para puxar.</>}
            </p>
          )}
        </div>
        <Button
          size="sm"
          variant={pending.length > 0 ? 'primary' : 'secondary'}
          disabled={run.isPending}
          onClick={() => run.mutate({}, {
            onSuccess: () => toast('Ingestão concluída', 'success'),
            onError: (e: unknown) => toast((e as Error).message || 'Falha na ingestão', 'danger'),
          })}
        >
          <RefreshCw size={14} class={run.isPending ? 'animate-spin' : ''} />
          {run.isPending ? 'Puxando…' : 'Puxar período novo'}
        </Button>
      </div>
    </Card>
  )
}

// ── aba: sites & stack ───────────────────────────────────────────────────────

/** Faixas da lacuna técnica. Alta = sem rastreamento nenhum = alvo. */
function gapTone(g: number): 'danger' | 'warning' | 'info' | 'neutral' {
  if (g >= 75) return 'danger'
  if (g >= 45) return 'warning'
  if (g > 0) return 'info'
  return 'neutral'
}

function StackTab() {
  const [q, setQ] = useState('')
  const [onlyGaps, setOnlyGaps] = useState(true)
  const [domains, setDomains] = useState('')
  const { data, isLoading } = useWebStackScans(q, onlyGaps)
  const run = useRunStackScan()
  const scans = data?.scans || []

  function scanTyped() {
    const list = domains.split(/[\s,;\n]+/).map((d) => d.trim()).filter(Boolean)
    if (list.length === 0) { toast('Informe ao menos um domínio', 'danger'); return }
    run.mutate({ domains: list }, {
      onSuccess: (r) => { toast(`${r.scanned} site(s) varrido(s) — ${r.gaps} com lacuna`, 'success'); setDomains('') },
      onError: (e: unknown) => toast((e as Error).message || 'Falha na varredura', 'danger'),
    })
  }

  return (
    <div class="space-y-4">
      <Card>
        <div class="text-sm font-semibold text-fg">Varrer sites</div>
        <p class="text-xs text-fg-muted mt-1 mb-3">
          Baixa a home e identifica pixels, analytics, tag manager, CRM e chat. A leitura é a <b>lacuna</b>:
          site vivo sem pixel de remarketing = empresa sem agência, ou com uma que não faz performance.
        </p>
        <div class="flex flex-wrap gap-2">
          <input
            class="flex-1 min-w-[240px] h-9 px-3 rounded-md bg-surface border border-border text-sm text-fg focus:outline-none focus:border-accent"
            placeholder="dominio1.com.br, dominio2.com.br…"
            value={domains}
            onInput={(e) => setDomains((e.target as HTMLInputElement).value)}
          />
          <Button size="sm" variant="primary" onClick={scanTyped} disabled={run.isPending}>
            <Search size={14} /> {run.isPending ? 'Varrendo…' : 'Varrer'}
          </Button>
          <Button
            size="sm" variant="secondary" disabled={run.isPending}
            onClick={() => run.mutate({ fromLeads: true, limit: 100 }, {
              onSuccess: (r) => toast(`${r.scanned} domínio(s) dos leads varrido(s) — ${r.gaps} com lacuna`, 'success'),
              onError: (e: unknown) => toast((e as Error).message || 'Falha', 'danger'),
            })}
          >
            Varrer domínios dos meus leads
          </Button>
        </div>
      </Card>

      <Card>
        <div class="flex flex-wrap items-center gap-2 mb-3">
          <SearchInput value={q} onChange={setQ} placeholder="Buscar domínio…" class="flex-1 min-w-[200px]" />
          <label class="flex items-center gap-2 text-xs text-fg-muted cursor-pointer select-none">
            <input type="checkbox" checked={onlyGaps} onChange={(e) => setOnlyGaps((e.target as HTMLInputElement).checked)} class="h-4 w-4" />
            Só com lacuna (esconde sites que bloquearam a leitura)
          </label>
        </div>

        {isLoading ? (
          <div class="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} class="h-10" />)}</div>
        ) : scans.length === 0 ? (
          <EmptyState title="Nenhum site varrido" description="Informe domínios acima ou varra os domínios dos seus leads." />
        ) : (
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="text-left text-xs text-fg-muted border-b border-border">
                  <th class="py-2 pr-3 font-medium">Lacuna</th>
                  <th class="py-2 pr-3 font-medium">Domínio</th>
                  <th class="py-2 pr-3 font-medium">Remarketing</th>
                  <th class="py-2 pr-3 font-medium">Medição</th>
                  <th class="py-2 pr-3 font-medium">Contato</th>
                  <th class="py-2 font-medium">Detectado</th>
                </tr>
              </thead>
              <tbody>
                {scans.map((s: WebStackScan) => (
                  <tr key={s.id} class="border-b border-border/50 last:border-0 hover:bg-surface-2">
                    <td class="py-2 pr-3"><Badge tone={gapTone(s.gapScore)} solid>{s.gapScore}</Badge></td>
                    <td class="py-2 pr-3">
                      <a href={s.finalUrl || `https://${s.domain}`} target="_blank" rel="noopener noreferrer" class="text-accent hover:underline">
                        {s.domain}
                      </a>
                      {!s.tlsValid && <span class="ml-1 text-3xs text-warning">TLS inválido</span>}
                      {s.error && <div class="text-3xs text-fg-muted">{s.error}</div>}
                    </td>
                    <td class="py-2 pr-3">
                      {s.hasMetaPixel || s.hasGoogleAds
                        ? <Badge tone="success">sim</Badge>
                        : <Badge tone="danger">não</Badge>}
                    </td>
                    <td class="py-2 pr-3">
                      {s.hasGa4 || s.hasGtm ? <Badge tone="success">sim</Badge> : <Badge tone="warning">não</Badge>}
                    </td>
                    <td class="py-2 pr-3">
                      {s.hasChat ? <Badge tone="success">sim</Badge> : <Badge tone="neutral">não</Badge>}
                    </td>
                    <td class="py-2 text-xs text-fg-muted">
                      {(s.detected || []).map((d) => d.name).join(', ') || '—'}
                    </td>
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

// ── aba: concorrentes ────────────────────────────────────────────────────────

function CompetitorsTab() {
  const [city, setCity] = useState('')
  const [onlyNeg, setOnlyNeg] = useState(false)
  const [location, setLocation] = useState('')
  const [term, setTerm] = useState('agência de marketing digital')
  const [maxPlaces, setMaxPlaces] = useState(15)
  const { data, isLoading } = useCompetitors(city, onlyNeg)
  const credits = useApifyCredits()
  const discover = useDiscoverCompetitors()
  const agencies = data?.agencies || []
  const c = credits.data?.credits

  const estimate = (maxPlaces * 0.009).toFixed(2)

  return (
    <div class="space-y-4">
      <Card>
        <div class="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div class="text-sm font-semibold text-fg">Mapear concorrentes numa praça</div>
            <p class="text-xs text-fg-muted mt-1">
              Busca agências no Google Maps e varre o stack do site de cada uma. O alvo não é a agência:
              é a carteira dela e as avaliações negativas <b>com texto</b>, onde o cliente insatisfeito se revela.
            </p>
          </div>
          {credits.isError ? (
            <Badge tone="danger">Apify não configurado</Badge>
          ) : c ? (
            <div class="text-right">
              <div class="text-2xs text-fg-muted">crédito Apify ({c.plan})</div>
              <div class="text-sm font-semibold text-fg tabular-nums">US$ {c.remainingUsd ?? '—'}</div>
            </div>
          ) : null}
        </div>

        <div class="flex flex-wrap gap-2 mt-3">
          <input
            class="flex-1 min-w-[180px] h-9 px-3 rounded-md bg-surface border border-border text-sm text-fg focus:outline-none focus:border-accent"
            placeholder='Cidade, UF — ex.: "Goiânia, GO"'
            value={location}
            onInput={(e) => setLocation((e.target as HTMLInputElement).value)}
          />
          <input
            class="flex-1 min-w-[180px] h-9 px-3 rounded-md bg-surface border border-border text-sm text-fg focus:outline-none focus:border-accent"
            placeholder="termo de busca"
            value={term}
            onInput={(e) => setTerm((e.target as HTMLInputElement).value)}
          />
          <Select value={String(maxPlaces)} onChange={(e) => setMaxPlaces(parseInt((e.target as HTMLSelectElement).value, 10))}>
            <option value="10">10 agências</option>
            <option value="15">15 agências</option>
            <option value="30">30 agências</option>
            <option value="60">60 agências</option>
          </Select>
          <Button
            size="sm" variant="primary" disabled={discover.isPending}
            onClick={() => {
              if (!location.trim()) { toast('Informe a cidade', 'danger'); return }
              discover.mutate({ location, term, maxPlaces }, {
                onSuccess: (r) => toast(`${r.result.found} agências · ${r.result.negativeReviews} avaliações negativas · US$ ${r.result.actualUsd ?? '?'}`, 'success'),
                onError: (e: unknown) => toast((e as Error).message || 'Falha na busca', 'danger'),
              })
            }}
          >
            {discover.isPending ? 'Buscando…' : `Buscar (~US$ ${estimate})`}
          </Button>
        </div>
      </Card>

      <Card>
        <div class="flex flex-wrap items-center gap-2 mb-3">
          <SearchInput value={city} onChange={setCity} placeholder="Filtrar por cidade…" class="flex-1 min-w-[200px]" />
          <label class="flex items-center gap-2 text-xs text-fg-muted cursor-pointer select-none">
            <input type="checkbox" checked={onlyNeg} onChange={(e) => setOnlyNeg((e.target as HTMLInputElement).checked)} class="h-4 w-4" />
            Só com cliente insatisfeito
          </label>
        </div>

        {isLoading ? (
          <div class="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} class="h-16" />)}</div>
        ) : agencies.length === 0 ? (
          <EmptyState title="Nenhuma agência mapeada" description="Informe uma cidade acima e rode a busca." />
        ) : (
          <div class="space-y-3">
            {agencies.map((a: CompetitorAgency) => (
              <div key={a.id} class="rounded-lg border border-border p-3">
                <div class="flex items-start justify-between gap-3 flex-wrap">
                  <div class="min-w-0">
                    <div class="font-medium text-fg">{a.name}</div>
                    <div class="text-xs text-fg-muted">
                      {a.city || '—'}{a.uf ? `/${a.uf}` : ''} · {a.rating ?? '—'}★ ({a.reviewsCount ?? 0} avaliações)
                      {a.phone && <> · {a.phone}</>}
                    </div>
                    {a.domain && (
                      <a href={`https://${a.domain}`} target="_blank" rel="noopener noreferrer" class="text-xs text-accent hover:underline">
                        {a.domain}
                      </a>
                    )}
                  </div>
                  <div class="flex items-center gap-2">
                    {a.negativeWithText > 0 && (
                      <Badge tone="danger" solid>{a.negativeWithText} insatisfeito(s)</Badge>
                    )}
                    {a.stack && (
                      <Badge tone={gapTone(a.stack.gapScore)} title="Lacuna no site da própria agência">
                        site {a.stack.gapScore}
                      </Badge>
                    )}
                  </div>
                </div>

                {a.stack && (
                  <div class="text-2xs text-fg-muted mt-2">
                    Stack do próprio site: {(a.stack.detected || []).map((d) => d.name).join(', ') || 'nada detectado'}
                  </div>
                )}

                {a.reviews.length > 0 && (
                  <div class="mt-3 space-y-2">
                    {a.reviews.map((r) => (
                      <div key={r.id} class="rounded bg-surface-2 p-2">
                        <div class="flex items-center gap-2 text-2xs text-fg-muted">
                          <span class="text-danger font-semibold">{r.stars}★</span>
                          {r.publishedAt && <span>{new Date(r.publishedAt).toLocaleDateString('pt-BR')}</span>}
                          {r.ownerReplied && <Badge tone="neutral">agência respondeu</Badge>}
                        </div>
                        <p class="text-xs text-fg mt-1">{r.text}</p>
                      </div>
                    ))}
                    <p class="text-3xs text-fg-muted flex items-center gap-1">
                      <AlertTriangle size={11} />
                      Use para escolher quem abordar — não cite a reclamação no primeiro contato.
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

// ── aba: escolas (INEP) ──────────────────────────────────────────────────────

const PRIVATE_CATEGORY: Record<number, string> = {
  1: 'Particular', 2: 'Comunitária', 3: 'Confessional', 4: 'Filantrópica',
}

function SchoolsTab() {
  const [q, setQ] = useState('')
  const [uf, setUf] = useState('')
  const [city, setCity] = useState('')
  const [minClasses, setMinClasses] = useState(3)
  const [onlyDropping, setOnlyDropping] = useState(false)
  const [onlyWithPhone, setOnlyWithPhone] = useState(true)

  const { data, isLoading } = useSchools({ q, uf, city, minClasses, onlyDropping, onlyWithPhone })
  const ufs = useSchoolUfs()
  const imports = useSchoolImports()
  const run = useRunSchoolImport()
  const schools = data?.schools || []

  const done = imports.data?.imports?.filter((i) => i.status === 'done') || []
  const running = imports.data?.imports?.find((i) => i.status === 'running')
  const failed = imports.data?.imports?.find((i) => i.status === 'failed')
  const pending = (imports.data?.available || []).filter((y) => !done.some((d) => d.year === y))

  return (
    <div class="space-y-4">
      <Card>
        <div class="flex items-start justify-between gap-4 flex-wrap">
          <div class="min-w-0">
            <div class="text-sm font-semibold text-fg">Censo Escolar (INEP/MEC)</div>
            <p class="text-xs text-fg-muted mt-1">
              {done.length > 0
                ? <>Anos ingeridos: <b class="text-fg">{done.map((d) => d.year).join(', ')}</b> — {num(done[0].schools)} escolas privadas em atividade.</>
                : 'Nenhum ano ingerido ainda.'}
              {pending.length > 0 && <> · Disponíveis: {pending.join(', ')}.</>}
              <br />
              Ingira <b>dois anos seguidos</b> para que a variação de turmas — o sinal de dor — seja calculada.
            </p>
            {running && (
              <p class="text-xs text-info mt-1">
                Ingestão de {running.year} em andamento… ({num(running.schools)} escolas até agora)
              </p>
            )}
            {failed && <p class="text-xs text-danger mt-1">Falha em {failed.year}: {failed.error}</p>}
          </div>
          <div class="flex gap-2">
            {pending.slice(0, 2).map((y) => (
              <Button
                key={y} size="sm" variant={y === pending[0] ? 'primary' : 'secondary'}
                disabled={run.isPending || !!running}
                onClick={() => run.mutate({ year: y }, {
                  onSuccess: () => toast(`Ingestão de ${y} iniciada — leva alguns minutos`, 'success'),
                  onError: (e: unknown) => toast((e as Error).message || 'Falha', 'danger'),
                })}
              >
                Ingerir {y}
              </Button>
            ))}
          </div>
        </div>
      </Card>

      <Card>
        <div class="flex flex-wrap items-center gap-2">
          <SearchInput value={q} onChange={setQ} placeholder="Buscar escola…" class="flex-1 min-w-[180px]" />
          <Select value={uf} onChange={(e) => setUf((e.target as HTMLSelectElement).value)}>
            <option value="">Todas as UFs</option>
            {(ufs.data?.ufs || []).map((u) => <option key={u.uf} value={u.uf}>{u.uf} ({num(u.schools)})</option>)}
          </Select>
          <SearchInput value={city} onChange={setCity} placeholder="Cidade…" class="min-w-[140px]" />
          <Select value={String(minClasses)} onChange={(e) => setMinClasses(parseInt((e.target as HTMLSelectElement).value, 10))}>
            <option value="0">Qualquer porte</option>
            <option value="3">3+ turmas</option>
            <option value="10">10+ turmas</option>
            <option value="25">25+ turmas</option>
          </Select>
          <label class="flex items-center gap-1.5 text-xs text-fg-muted cursor-pointer select-none">
            <input type="checkbox" checked={onlyDropping} onChange={(e) => setOnlyDropping((e.target as HTMLInputElement).checked)} class="h-4 w-4" />
            Perdendo turmas
          </label>
          <label class="flex items-center gap-1.5 text-xs text-fg-muted cursor-pointer select-none">
            <input type="checkbox" checked={onlyWithPhone} onChange={(e) => setOnlyWithPhone((e.target as HTMLInputElement).checked)} class="h-4 w-4" />
            Com telefone
          </label>
        </div>
      </Card>

      {isLoading ? (
        <Card><div class="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} class="h-10" />)}</div></Card>
      ) : schools.length === 0 ? (
        <EmptyState
          title="Nenhuma escola no radar"
          description={done.length === 0 ? 'Ingira um ano do Censo Escolar acima para popular a base.' : 'Ajuste os filtros.'}
        />
      ) : (
        <Card>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="text-left text-xs text-fg-muted border-b border-border">
                  <th class="py-2 pr-3 font-medium">Score</th>
                  <th class="py-2 pr-3 font-medium">Escola</th>
                  <th class="py-2 pr-3 font-medium text-right">Turmas</th>
                  <th class="py-2 pr-3 font-medium text-right">Variação</th>
                  <th class="py-2 pr-3 font-medium">Internet</th>
                  <th class="py-2 font-medium">Telefone</th>
                </tr>
              </thead>
              <tbody>
                {schools.map((s: School) => (
                  <tr key={s.id} class="border-b border-border/50 last:border-0 hover:bg-surface-2">
                    <td class="py-2 pr-3"><Badge tone={scoreTone(s.opportunityScore)} solid>{s.opportunityScore}</Badge></td>
                    <td class="py-2 pr-3 min-w-0">
                      <div class="font-medium text-fg truncate max-w-[280px]" title={s.name}>{s.name}</div>
                      <div class="text-2xs text-fg-muted truncate max-w-[280px]">
                        {s.city || '—'}/{s.uf || '—'}
                        {s.district && ` · ${s.district}`}
                        {s.privateCategory && ` · ${PRIVATE_CATEGORY[s.privateCategory] || ''}`}
                      </div>
                    </td>
                    <td class="py-2 pr-3 text-right tabular-nums text-fg">
                      {s.classes}
                      <div class="text-3xs text-fg-muted">
                        {[s.classesInf && `${s.classesInf} inf`, s.classesFund && `${s.classesFund} fund`, s.classesMed && `${s.classesMed} médio`]
                          .filter(Boolean).join(' · ') || '—'}
                      </div>
                    </td>
                    <td class="py-2 pr-3 text-right tabular-nums">
                      {s.classesDelta === null ? (
                        <span class="text-fg-muted">—</span>
                      ) : (
                        <span class={s.classesDelta < 0 ? 'text-danger' : 'text-success'}>
                          {s.classesDelta < 0 ? <TrendingDown size={11} class="inline" /> : <TrendingUp size={11} class="inline" />}
                          {' '}{s.classesDelta > 0 ? '+' : ''}{(s.classesDelta * 100).toFixed(0)}%
                        </span>
                      )}
                    </td>
                    <td class="py-2 pr-3">
                      {s.hasInternetAdmin && s.hasInternetLearn
                        ? <Badge tone="success">completa</Badge>
                        : s.hasInternet
                          ? <Badge tone="warning">parcial</Badge>
                          : <Badge tone="danger">sem</Badge>}
                    </td>
                    <td class="py-2 text-xs text-fg">{s.phone || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p class="text-2xs text-fg-muted mt-3">
            Mostrando {schools.length} de {num(data?.total ?? 0)} escolas. Score = queda de turmas × porte × lacuna digital declarada no censo.
          </p>
        </Card>
      )}
    </div>
  )
}

// ── página ───────────────────────────────────────────────────────────────────

const ORDER_OPTIONS = [
  { value: 'opportunityScore', label: 'Score de oportunidade' },
  { value: 'complaints', label: 'Volume de reclamações' },
  { value: 'unansweredRate', label: '% sem resposta' },
  { value: 'complaintsDelta', label: 'Piorou mais no mês' },
  { value: 'avgScore', label: 'Pior nota' },
]

type Tab = 'companies' | 'schools' | 'stack' | 'competitors'

const TABS: { id: Tab; label: string; icon: preact.JSX.Element }[] = [
  { id: 'companies', label: 'Empresas (reclamações)', icon: <Building2 size={14} /> },
  { id: 'schools', label: 'Escolas (INEP)', icon: <GraduationCap size={14} /> },
  { id: 'stack', label: 'Sites & lacunas', icon: <Globe size={14} /> },
  { id: 'competitors', label: 'Concorrentes', icon: <Swords size={14} /> },
]

export function ReputationPage() {
  const [tab, setTab] = useState<Tab>('companies')
  const [q, setQ] = useState('')
  const [segment, setSegment] = useState('')
  const [status, setStatus] = useState('')
  const [minComplaints, setMinComplaints] = useState(30)
  const [orderBy, setOrderBy] = useState('opportunityScore')
  const [openId, setOpenId] = useState<number | null>(null)

  const dir = orderBy === 'avgScore' ? 'asc' : 'desc'
  const { data, isLoading } = useReputationCompanies({ q, segment, status, minComplaints, orderBy, limit: 100, offset: 0 })
  // Total sem filtro de volume — o KPI precisa distinguir "no radar" de "no filtro atual".
  const all = useReputationCompanies({ q: '', segment: '', status: '', minComplaints: 0, orderBy: 'opportunityScore', limit: 1, offset: 0 })
  const segments = useReputationSegments()
  const companies = data?.companies || []
  const hot = companies.filter((c) => c.opportunityScore >= 75).length

  const tabs = (
    <div class="flex gap-1 border-b border-border">
      {TABS.map((t) => (
        <button
          key={t.id}
          onClick={() => setTab(t.id)}
          class={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${
            tab === t.id ? 'border-accent text-fg font-medium' : 'border-transparent text-fg-muted hover:text-fg'
          }`}
        >
          {t.icon}{t.label}
        </button>
      ))}
    </div>
  )

  if (tab !== 'companies') {
    return (
      <Page
        title="Radar de Reputação"
        description="Prospecção por sinal público: reclamações, lacunas técnicas no site e carteira dos concorrentes."
      >
        {tabs}
        {tab === 'schools' ? <SchoolsTab /> : tab === 'stack' ? <StackTab /> : <CompetitorsTab />}
      </Page>
    )
  }

  return (
    <Page
      title="Radar de Reputação"
      description="Empresas com dor de reputação hoje — ranqueadas pela base aberta oficial do Consumidor.gov.br. Quanto maior o score, mais evidente a dor que a agência resolve."
    >
      {tabs}
      <IngestCard />

      <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Empresas no radar', value: num(all.data?.total ?? 0), hint: `${num(data?.total ?? 0)} no filtro atual`, icon: <Building2 size={16} /> },
          { label: 'Alvos quentes (score 75+)', value: num(hot), icon: <Flame size={16} /> },
          { label: 'Reclamações no período', value: num(companies.reduce((s, c) => s + c.complaints, 0)), icon: <TrendingUp size={16} /> },
          { label: 'Segmentos mapeados', value: num(segments.data?.segments?.length ?? 0), icon: <Radar size={16} /> },
        ].map((k) => (
          <Card key={k.label}>
            <div class="flex items-center gap-2 text-fg-muted text-xs">{k.icon}{k.label}</div>
            <div class="text-2xl font-semibold text-fg tabular-nums mt-1">{k.value}</div>
            {'hint' in k && k.hint && <div class="text-3xs text-fg-muted">{k.hint}</div>}
          </Card>
        ))}
      </div>

      <Card>
        <div class="flex flex-wrap items-center gap-2">
          <SearchInput value={q} onChange={setQ} placeholder="Buscar empresa…" class="flex-1 min-w-[200px]" />
          <Select value={segment} onChange={(e) => setSegment((e.target as HTMLSelectElement).value)}>
            <option value="">Todos os segmentos</option>
            {(segments.data?.segments || []).map((s) => (
              <option key={s.segment} value={s.segment}>{s.segment} ({s.companies})</option>
            ))}
          </Select>
          <Select value={orderBy} onChange={(e) => setOrderBy((e.target as HTMLSelectElement).value)}>
            {ORDER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
          <Select value={String(minComplaints)} onChange={(e) => setMinComplaints(parseInt((e.target as HTMLSelectElement).value, 10))}>
            <option value="0">Qualquer volume</option>
            <option value="10">10+ reclamações</option>
            <option value="30">30+ reclamações</option>
            <option value="100">100+ reclamações</option>
          </Select>
          <Select value={status} onChange={(e) => setStatus((e.target as HTMLSelectElement).value)}>
            <option value="">Todos os status</option>
            <option value="new">Novos</option>
            <option value="prospecting">Em prospecção</option>
            <option value="converted">Viraram lead</option>
            <option value="ignored">Descartados</option>
          </Select>
        </div>
      </Card>

      {isLoading ? (
        <Card><div class="space-y-2">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} class="h-10" />)}</div></Card>
      ) : companies.length === 0 ? (
        <EmptyState
          title="Nenhuma empresa no radar"
          description="Ajuste os filtros ou puxe um período da base do Consumidor.gov.br."
        />
      ) : (
        <Card>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="text-left text-xs text-fg-muted border-b border-border">
                  <th class="py-2 pr-3 font-medium">Score</th>
                  <th class="py-2 pr-3 font-medium">Empresa</th>
                  <th class="py-2 pr-3 font-medium text-right">Reclamações</th>
                  <th class="py-2 pr-3 font-medium text-right">Sem resposta</th>
                  <th class="py-2 pr-3 font-medium text-right">Não resolvidas</th>
                  <th class="py-2 pr-3 font-medium text-right">Nota</th>
                  <th class="py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {companies.map((c: ReputationCompany) => (
                  <tr
                    key={c.id}
                    class="border-b border-border/50 last:border-0 hover:bg-surface-2 cursor-pointer"
                    onClick={() => setOpenId(c.id)}
                  >
                    <td class="py-2 pr-3"><Badge tone={scoreTone(c.opportunityScore)} solid>{c.opportunityScore}</Badge></td>
                    <td class="py-2 pr-3 min-w-0">
                      <div class="font-medium text-fg truncate max-w-[260px]" title={c.name}>{c.name}</div>
                      <div class="text-2xs text-fg-muted truncate max-w-[260px]">{c.segment || '—'}</div>
                    </td>
                    <td class="py-2 pr-3 text-right tabular-nums text-fg">
                      {num(c.complaints)}
                      {c.complaintsDelta !== null && (
                        <span class={`ml-1 text-2xs ${c.complaintsDelta > 0 ? 'text-danger' : 'text-success'}`}>
                          {c.complaintsDelta > 0 ? <TrendingUp size={11} class="inline" /> : <TrendingDown size={11} class="inline" />}
                          {' '}{c.complaintsDelta > 0 ? '+' : ''}{(c.complaintsDelta * 100).toFixed(0)}%
                        </span>
                      )}
                    </td>
                    <td class="py-2 pr-3 text-right tabular-nums text-fg">{pct(c.unansweredRate)}</td>
                    <td class="py-2 pr-3 text-right tabular-nums text-fg">{pct(c.unresolvedRate)}</td>
                    <td class="py-2 pr-3 text-right tabular-nums text-fg">{c.avgScore ? c.avgScore.toFixed(2) : '—'}</td>
                    <td class="py-2">
                      {c.status !== 'new' && <Badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p class="text-2xs text-fg-muted mt-3">
            Ordenado por {ORDER_OPTIONS.find((o) => o.value === orderBy)?.label.toLowerCase()} ({dir === 'asc' ? 'crescente' : 'decrescente'}).
            Mostrando até 100 empresas de {num(data?.total ?? 0)}.
          </p>
        </Card>
      )}

      {openId !== null && <CompanyDossier id={openId} onClose={() => setOpenId(null)} />}
    </Page>
  )
}
