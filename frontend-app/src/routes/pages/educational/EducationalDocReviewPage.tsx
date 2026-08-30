import { useEffect, useMemo, useState } from 'preact/hooks'
import {
  FileCheck2, Sparkles, AlertTriangle, ExternalLink, Check, X as XIcon, Clock, RefreshCw, FileText,
} from '@/components/ui/icon-set'
import {
  useDocReviews,
  useDocReviewDetail,
  useBulkApproveAi,
  useDocItems,
  useReviewDocItem,
  useReanalyzeDoc,
  type DocReviewStatus,
  type DocReviewItem,
  type DocItem,
  type DocItemStatus,
  type AiSuggestionFilter,
} from '@/hooks/useEducationalReview'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import { KpiCard } from '@/components/ui/KpiCard'
import { Select, Textarea } from '@/components/ui/Input'
import { SearchInput } from '@/components/ui/SearchInput'
import { formatRelative, formatDateTime } from '@/lib/format'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/cn'

type Mode = 'registration' | 'document'

const MODE_KEY = 'eduDocMode'

export function EducationalDocReviewPage() {
  const [mode, setMode] = useState<Mode>(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(MODE_KEY) : null
    return saved === 'document' ? 'document' : 'registration'
  })

  function setModeAndPersist(m: Mode) {
    setMode(m)
    try { localStorage.setItem(MODE_KEY, m) } catch { /* ignore */ }
  }

  return (
    <Page
      title="Análise de Documentos"
      description={
        mode === 'registration'
          ? 'Inscrições agrupadas por candidato — revisar todos os documentos em conjunto.'
          : 'Fila plana — 1 documento por linha (FIFO). Útil para revisões especializadas.'
      }
    >
      <ModeToggle mode={mode} onChange={setModeAndPersist} />

      {mode === 'registration' ? <RegistrationMode /> : <DocumentMode />}
    </Page>
  )
}

function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const btn = (key: Mode, label: string) => (
    <button
      type="button"
      onClick={() => onChange(key)}
      class={cn(
        'px-3 h-8 rounded-md text-xs font-medium transition-colors',
        mode === key ? 'bg-accent text-fg-on-brand' : 'text-fg-muted hover:text-fg',
      )}
    >
      {label}
    </button>
  )
  return (
    <div class="inline-flex gap-1 p-1 rounded-lg bg-surface-3 self-start">
      {btn('registration', '🎓 Por inscrição')}
      {btn('document',     '📋 Por documento')}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Modo "Por inscrição" (mantido — agrupa por candidato)

function RegistrationMode() {
  const [status, setStatus] = useState<DocReviewStatus>('pending')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [detailId, setDetailId] = useState<number | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 350)
    return () => clearTimeout(t)
  }, [searchInput])

  const { data, isLoading } = useDocReviews({ status, q: search || undefined })
  const items = data?.items ?? []
  const kpi = data?.kpi

  return (
    <>
      <div class="grid gap-3 grid-cols-2 sm:grid-cols-3">
        <KpiCard label="Pendentes" value={kpi?.pending ?? '—'} loading={isLoading} icon={<Clock size={16} />} />
        <KpiCard label="Rejeitados" value={kpi?.rejected ?? '—'} loading={isLoading} icon={<XIcon size={16} />} />
        <KpiCard label="Completos" value={kpi?.complete ?? '—'} loading={isLoading} icon={<Check size={16} />} />
      </div>

      <Card class="p-3">
        <div class="flex flex-wrap items-center gap-3">
          <Select value={status} onChange={(e) => setStatus((e.target as HTMLSelectElement).value as DocReviewStatus)}>
            <option value="pending">Pendentes</option>
            <option value="rejected">Rejeitados</option>
            <option value="complete">Completos</option>
            <option value="all">Todos</option>
          </Select>
          <SearchInput
            value={searchInput}
            onChange={setSearchInput}
            placeholder="Buscar por candidato (nome, email, código)…"
            class="flex-1 min-w-48"
          />
        </div>
      </Card>

      <Card class="p-0 overflow-hidden">
        {isLoading && <div class="p-4 space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} class="h-16 w-full" />)}</div>}
        {!isLoading && items.length === 0 && (
          <div class="p-8"><EmptyState icon={<FileCheck2 size={24} />} title="Sem inscrições" description={status === 'pending' ? 'Sem candidatos com documentos pendentes.' : 'Tente outros filtros.'} /></div>
        )}
        {!isLoading && items.length > 0 && (
          <ul class="divide-y divide-border">
            {items.map((it) => (
              <DocReviewRow key={it.registrationId} item={it} onOpen={() => setDetailId(it.registrationId)} />
            ))}
          </ul>
        )}
      </Card>

      {detailId !== null && <DocReviewDetailModal registrationId={detailId} onClose={() => setDetailId(null)} />}
    </>
  )
}

function DocReviewRow({ item, onOpen }: { item: DocReviewItem; onOpen: () => void }) {
  const tone = item.completion === 'complete' ? 'success' : item.completion === 'rejected' ? 'danger' : 'warning'
  const label = item.completion === 'complete' ? 'Completo' : item.completion === 'rejected' ? 'Rejeitado' : 'Pendente'

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        class="w-full text-left p-4 hover:bg-surface-3 transition-colors flex flex-wrap items-center gap-3"
      >
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-sm font-medium text-fg">{item.candidate.name || '—'}</span>
            <code class="text-2xs text-fg-muted font-mono">{item.candidateCode}</code>
            <Badge tone={tone} solid>{label}</Badge>
            {item.siblingCount > 0 && <Badge tone="info" solid>+{item.siblingCount} inscrição(ões)</Badge>}
          </div>
          <div class="text-xs text-fg-muted mt-0.5 truncate">
            {item.portal?.nome ?? '—'} · {item.course || '—'}
          </div>
          <div class="text-2xs text-fg-muted mt-0.5">
            {item.approvedCount}/{item.requiredTotal} aprovados · {item.pendingCount} pendentes · {item.rejectedCount} rejeitados · {item.missingCount} faltando
            {item.aiSummary.length > 0 && (
              <span class="ml-2 font-mono text-fg-muted">[{item.aiSummary.join(' ')}]</span>
            )}
          </div>
        </div>
        <div class="text-xs text-fg-muted whitespace-nowrap shrink-0">
          {item.oldestPendingAt
            ? `Há ${formatRelative(item.oldestPendingAt)}`
            : item.lastUploadAt ? formatRelative(item.lastUploadAt) : '—'}
        </div>
      </button>
    </li>
  )
}

function DocReviewDetailModal({ registrationId, onClose }: { registrationId: number; onClose: () => void }) {
  const { data, isLoading, error } = useDocReviewDetail(registrationId)
  const bulkApprove = useBulkApproveAi(registrationId)
  const [openDocId, setOpenDocId] = useState<number | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)

  function handleBulkApprove(minConfidence: number) {
    bulkApprove.mutate({ minConfidence }, {
      onSuccess: (r) => {
        toast(`${r.approved ?? 0} documento(s) aprovado(s) por IA (≥${Math.round(minConfidence * 100)}%)`, 'success')
        setBulkOpen(false)
      },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  const slots = data?.slots ?? []
  const extras = data?.extras ?? []
  const allDocs = [
    ...slots.map((s) => s.latestDoc).filter((d): d is NonNullable<typeof d> => d !== null),
    ...extras,
  ]
  const pendingInSlots = slots.filter((s) => s.latestDoc?.status === 'pending').length

  return (
    <>
      <Modal
        open
        onOpenChange={(o) => { if (!o) onClose() }}
        title={data ? `Inscrição ${data.registration.candidateCode}` : 'Carregando…'}
        description={data?.lead?.nome ?? ''}
        size="xl"
        footer={
          <div class="flex items-center justify-between w-full gap-2">
            <Button variant="secondary" size="sm" onClick={() => setBulkOpen(true)} disabled={!data || bulkApprove.isPending}>
              <Sparkles size={12} /> Aprovar pendentes por IA…
            </Button>
            <Button variant="primary" size="sm" onClick={onClose}>Fechar</Button>
          </div>
        }
      >
        {isLoading && <Skeleton class="h-64 w-full" />}
        {error && !isLoading && (
          <div class="rounded-md border border-danger/30 bg-danger/10 p-3 text-xs text-fg flex items-start gap-2">
            <AlertTriangle size={14} class="mt-0.5 shrink-0 text-danger" />
            <span>Erro ao carregar inscrição: {error.message}</span>
          </div>
        )}
        {data && (
          <div class="space-y-4">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <Row label="Candidato" value={data.lead?.nome ?? '—'} />
              <Row label="Código" value={data.registration.candidateCode} />
              <Row label="Email" value={data.lead?.email ?? '—'} />
              <Row label="WhatsApp" value={data.lead?.whatsapp ?? '—'} />
              <Row label="Portal" value={data.portal?.nome ?? '—'} />
              <Row label="Curso" value={data.processRegistration?.offering?.course?.nome ?? data.processRegistration?.offering?.nome ?? '—'} />
              {data.processRegistration?.selectionProcess?.nome && (
                <Row label="Processo" value={data.processRegistration.selectionProcess.nome} />
              )}
              {data.processRegistration?.offering?.turno && (
                <Row label="Turno" value={data.processRegistration.offering.turno} />
              )}
            </div>

            <div>
              <div class="text-xs uppercase tracking-wider text-fg-muted font-medium mb-2">
                Documentos esperados {slots.length > 0 && <span class="text-fg-muted normal-case">({slots.length})</span>}
              </div>
              {slots.length === 0 ? (
                <div class="text-xs text-fg-muted italic p-3 rounded-md border border-border bg-surface">
                  Este processo não tem requisitos documentais configurados.
                </div>
              ) : (
                <ul class="space-y-1.5">
                  {slots.map((slot, idx) => {
                    const doc = slot.latestDoc
                    const tone = !doc ? 'warning' : doc.status === 'approved' ? 'success' : doc.status === 'rejected' ? 'danger' : 'info'
                    const label = !doc ? 'Faltando' : doc.status === 'approved' ? 'Aprovado' : doc.status === 'rejected' ? 'Rejeitado' : 'Pendente'
                    return (
                      <li key={idx} class="flex items-center gap-2 p-2 rounded-md border border-border bg-surface text-xs">
                        <Badge tone={tone} solid>{label}</Badge>
                        <span class="text-fg flex-1 truncate">
                          {slot.documentType.name}
                          {slot.required && <span class="text-danger ml-1">*</span>}
                        </span>
                        {doc?.aiSuggestion && (
                          <span class={cn(
                            'text-2xs',
                            doc.aiSuggestion === 'approve' ? 'text-success'
                              : doc.aiSuggestion === 'reject' ? 'text-danger'
                              : 'text-warning',
                          )}>
                            IA: {doc.aiSuggestion === 'approve' ? '✓' : doc.aiSuggestion === 'reject' ? '✕' : '⚠'}
                            {doc.aiConfidence !== null ? ` ${Math.round(doc.aiConfidence * 100)}%` : ''}
                          </span>
                        )}
                        {doc && (
                          <button
                            type="button"
                            onClick={() => setOpenDocId(doc.id)}
                            class="text-accent hover:underline text-2xs inline-flex items-center gap-1"
                          >
                            Revisar <ExternalLink size={10} />
                          </button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            {extras.length > 0 && (
              <div>
                <div class="text-xs uppercase tracking-wider text-fg-muted font-medium mb-2">
                  Outros arquivos enviados <span class="text-fg-muted normal-case">({extras.length})</span>
                </div>
                <ul class="space-y-1.5">
                  {extras.map((d) => (
                    <li key={d.id} class="flex items-center gap-2 p-2 rounded-md border border-border bg-surface text-xs">
                      <Badge tone={d.status === 'approved' ? 'success' : d.status === 'rejected' ? 'danger' : 'info'} solid>
                        {d.status === 'approved' ? 'Aprovado' : d.status === 'rejected' ? 'Rejeitado' : 'Pendente'}
                      </Badge>
                      <span class="text-fg truncate flex-1">{d.type?.name ?? d.label ?? d.fileName}</span>
                      <button
                        type="button"
                        onClick={() => setOpenDocId(d.id)}
                        class="inline-flex items-center gap-1 text-accent hover:underline"
                      >
                        Revisar <ExternalLink size={10} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {allDocs.length === 0 && slots.length > 0 && (
              <div class="rounded-md border border-warning/30 bg-warning/10 p-3 text-xs text-fg flex items-start gap-2">
                <AlertTriangle size={14} class="mt-0.5 shrink-0 text-warning" />
                <div>O candidato ainda não enviou nenhum documento.</div>
              </div>
            )}

            <div class="rounded-md border border-info/30 bg-info/10 p-3 text-xs text-info flex items-start gap-2">
              <AlertTriangle size={14} class="mt-0.5 shrink-0" />
              <div>
                Aprove ou rejeite documentos individualmente clicando em "Revisar". Para aprovar em lote os que a IA classificou com alta confiança, use o botão abaixo.
              </div>
            </div>
          </div>
        )}
      </Modal>

      {openDocId !== null && <DocItemDetailModal docId={openDocId} onClose={() => setOpenDocId(null)} />}

      {bulkOpen && (
        <BulkApproveModal
          pendingCount={pendingInSlots}
          loading={bulkApprove.isPending}
          onApprove={handleBulkApprove}
          onClose={() => setBulkOpen(false)}
        />
      )}
    </>
  )
}

function BulkApproveModal({
  pendingCount, loading, onApprove, onClose,
}: {
  pendingCount: number
  loading: boolean
  onApprove: (minConfidence: number) => void
  onClose: () => void
}) {
  const [confidence, setConfidence] = useState(85)
  const min = confidence / 100

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Aprovar pendentes por IA"
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button variant="primary" onClick={() => onApprove(min)} disabled={loading}>
            <Sparkles size={12} /> {loading ? 'Aprovando…' : `Aprovar com confiança ≥${confidence}%`}
          </Button>
        </>
      }
    >
      <div class="space-y-4">
        <p class="text-xs text-fg-muted">
          Aprova automaticamente todos os documentos pendentes desta inscrição em que a IA
          sugeriu <strong>aprovar</strong> com confiança igual ou superior ao limite escolhido.
          Esta inscrição tem <strong>{pendingCount}</strong> documento(s) pendente(s).
        </p>

        <div>
          <div class="flex items-baseline justify-between mb-2">
            <label class="text-xs font-medium text-fg-muted" for="bulk-conf">
              Confiança mínima
            </label>
            <span class="text-2xl font-bold tabular-nums text-success">{confidence}%</span>
          </div>
          <input
            id="bulk-conf"
            type="range"
            min={50}
            max={100}
            step={5}
            value={confidence}
            onInput={(e) => setConfidence(Number((e.target as HTMLInputElement).value))}
            class="w-full accent-success"
          />
          <div class="flex justify-between text-2xs text-fg-muted mt-1">
            <span>50% (ousado)</span>
            <span>75%</span>
            <span>100% (conservador)</span>
          </div>
        </div>

        <div class="rounded-md border border-info/30 bg-info/10 p-3 text-2xs text-fg-muted flex items-start gap-2">
          <AlertTriangle size={12} class="mt-0.5 shrink-0 text-info" />
          <span>
            Recomendado: <strong>85%</strong>. Documentos rejeitados pela IA <em>nunca</em> são
            aprovados em lote — eles continuam exigindo revisão manual mesmo se você baixar o limite.
          </span>
        </div>
      </div>
    </Modal>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span class="text-fg-muted">{label}:</span>{' '}
      <span class="text-fg">{value}</span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Modo "Por documento" (fila plana FIFO)

function DocumentMode() {
  const [status, setStatus] = useState<DocItemStatus>('pending')
  const [aiFilter, setAiFilter] = useState<AiSuggestionFilter>('all')
  const [sort, setSort] = useState<'oldest' | 'newest'>('oldest')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [openDocId, setOpenDocId] = useState<number | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 350)
    return () => clearTimeout(t)
  }, [searchInput])

  const { data, isLoading } = useDocItems({
    status,
    aiSuggestion: aiFilter === 'all' ? undefined : aiFilter,
    q: search || undefined,
    sort,
    limit: 200,
  })
  const items = data?.items ?? []
  const kpi = data?.kpi

  return (
    <>
      <div class="grid gap-3 grid-cols-3">
        <KpiCard label="Pendentes" value={kpi?.pending ?? '—'} loading={isLoading} icon={<Clock size={16} />} />
        <KpiCard label="Aprovados" value={kpi?.approved ?? '—'} loading={isLoading} icon={<Check size={16} />} />
        <KpiCard label="Rejeitados" value={kpi?.rejected ?? '—'} loading={isLoading} icon={<XIcon size={16} />} />
      </div>

      <Card class="p-3">
        <div class="flex flex-wrap items-center gap-2 mb-3">
          <StatusPill active={status === 'pending'}  tone="warning" count={kpi?.pending}  onClick={() => setStatus('pending')}>⏳ Pendentes</StatusPill>
          <StatusPill active={status === 'approved'} tone="success" count={kpi?.approved} onClick={() => setStatus('approved')}>✓ Aprovados</StatusPill>
          <StatusPill active={status === 'rejected'} tone="danger"  count={kpi?.rejected} onClick={() => setStatus('rejected')}>✕ Rejeitados</StatusPill>
          <StatusPill active={status === 'all'}      tone="neutral" onClick={() => setStatus('all')}>📋 Todos</StatusPill>
        </div>

        <div class="flex flex-wrap items-center gap-3">
          <SearchInput
            value={searchInput}
            onChange={setSearchInput}
            placeholder="Buscar por candidato, código, email…"
            class="flex-1 min-w-48"
          />
          <Select value={aiFilter} onChange={(e) => setAiFilter((e.target as HTMLSelectElement).value as AiSuggestionFilter)}>
            <option value="all">Todas as sugestões IA</option>
            <option value="approve">🤖 IA sugeriu aprovar</option>
            <option value="review">🤖 IA marcou para revisão</option>
            <option value="reject">🤖 IA sugeriu rejeitar</option>
          </Select>
          <Select value={sort} onChange={(e) => setSort((e.target as HTMLSelectElement).value as 'oldest' | 'newest')}>
            <option value="oldest">Mais antigos primeiro</option>
            <option value="newest">Mais recentes primeiro</option>
          </Select>
        </div>
      </Card>

      <Card class="p-0 overflow-hidden">
        {isLoading && <div class="p-4 space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} class="h-14 w-full" />)}</div>}
        {!isLoading && items.length === 0 && (
          <div class="p-8">
            <EmptyState
              icon={<FileText size={24} />}
              title={status === 'pending' ? 'Fila zerada — nada pendente!' : 'Nenhum documento encontrado'}
              description={status === 'pending' ? 'Bom trabalho. Volte quando candidatos enviarem novos documentos.' : 'Tente ajustar os filtros.'}
            />
          </div>
        )}
        {!isLoading && items.length > 0 && (
          <ul class="divide-y divide-border">
            {items.map((d) => (
              <DocItemRow key={d.id} item={d} onOpen={() => setOpenDocId(d.id)} />
            ))}
          </ul>
        )}
      </Card>

      {openDocId !== null && <DocItemDetailModal docId={openDocId} onClose={() => setOpenDocId(null)} />}
    </>
  )
}

function StatusPill({
  active, tone, count, onClick, children,
}: {
  active: boolean
  tone: 'success' | 'danger' | 'warning' | 'neutral'
  count?: number | undefined
  onClick: () => void
  children: preact.ComponentChildren
}) {
  const toneCls = {
    success: 'border-success bg-success text-fg-on-brand',
    danger:  'border-danger bg-danger text-fg-on-brand',
    warning: 'border-warning bg-warning text-fg-on-brand',
    neutral: 'border-fg-muted bg-fg-muted text-fg-on-brand',
  }[tone]
  return (
    <button
      type="button"
      onClick={onClick}
      class={cn(
        'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors inline-flex items-center gap-1.5',
        active ? toneCls : 'border-border bg-surface text-fg-muted hover:text-fg',
      )}
    >
      {children}
      {count !== undefined && (
        <span class={cn('px-1.5 rounded-full text-3xs font-bold', active ? 'bg-fg-on-brand/25' : 'bg-surface-3 text-fg-muted')}>{count}</span>
      )}
    </button>
  )
}

function DocItemRow({ item, onOpen }: { item: DocItem; onOpen: () => void }) {
  const reg = item.registration
  const lead = reg?.lead
  const off = reg?.processRegistration?.offering
  const sp = reg?.processRegistration?.selectionProcess

  const ageDays = Math.floor((Date.now() - new Date(item.uploadedAt).getTime()) / 86400000)
  const ageColor = ageDays >= 3 ? 'text-danger' : ageDays >= 1 ? 'text-warning' : 'text-fg-muted'

  const docLabel = item.type?.name ?? item.label ?? item.typeCode ?? 'Documento'

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        class="w-full text-left p-3 hover:bg-surface-3 transition-colors grid grid-cols-12 gap-3 items-center"
      >
        <div class="col-span-4 sm:col-span-3 min-w-0">
          <div class="text-sm font-medium text-fg truncate">{lead?.nome ?? '—'}</div>
          <code class="text-3xs text-fg-muted font-mono">{reg?.candidateCode ?? ''}</code>
        </div>
        <div class="col-span-4 sm:col-span-3 min-w-0">
          <div class="text-sm text-fg truncate">{docLabel}</div>
          {item.type?.category && <div class="text-2xs text-fg-muted truncate">{item.type.category}</div>}
        </div>
        <div class="hidden sm:block col-span-2 min-w-0 text-xs text-fg-muted">
          <div class="truncate">{off?.course?.nome ?? off?.nome ?? '—'}</div>
          {sp?.nome && <div class="truncate text-fg-muted">{sp.nome}</div>}
        </div>
        <div class="col-span-2 sm:col-span-2 text-center">
          <AiChip suggestion={item.aiSuggestion} status={item.aiStatus} confidence={item.aiConfidence} />
        </div>
        <div class={cn('col-span-2 sm:col-span-1 text-right text-xs whitespace-nowrap', ageColor)}>
          <div>{formatRelative(item.uploadedAt)}</div>
          <StatusBadge status={item.status} />
        </div>
      </button>
    </li>
  )
}

function AiChip({
  suggestion, status, confidence,
}: { suggestion: DocItem['aiSuggestion']; status: DocItem['aiStatus']; confidence: number | null }) {
  if (status === 'pending' || status === 'processing') {
    return <Badge tone="info" solid>⌛ Analisando</Badge>
  }
  const conf = confidence !== null ? ` · ${Math.round(confidence * 100)}%` : ''
  if (suggestion === 'approve') return <Badge tone="success" solid>🤖 Aprovar{conf}</Badge>
  if (suggestion === 'reject')  return <Badge tone="danger" solid>🤖 Rejeitar{conf}</Badge>
  if (suggestion === 'review')  return <Badge tone="warning" solid>🤖 Revisar{conf}</Badge>
  return <span class="text-2xs text-fg-muted italic">—</span>
}

function StatusBadge({ status }: { status: 'pending' | 'approved' | 'rejected' }) {
  if (status === 'approved') return <Badge tone="success" solid>✓ Aprovado</Badge>
  if (status === 'rejected') return <Badge tone="danger" solid>✕ Rejeitado</Badge>
  return <Badge tone="warning" solid>⏳ Pendente</Badge>
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal de detalhe de UM documento — preview + IA + ações

function DocItemDetailModal({ docId, onClose }: { docId: number; onClose: () => void }) {
  const { data, isLoading } = useDocItems({ status: 'all', limit: 200 })
  const review = useReviewDocItem()
  const reanalyze = useReanalyzeDoc()
  const [reviewNote, setReviewNote] = useState('')
  const [aiOpen, setAiOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const doc = useMemo(() => data?.items.find((i) => i.id === docId) ?? null, [data, docId])

  useEffect(() => {
    setReviewNote(doc?.reviewNote ?? '')
  }, [doc?.id, doc?.reviewNote])

  if (isLoading || !doc) {
    return (
      <Modal open onOpenChange={(o) => { if (!o) onClose() }} title="Carregando documento…" size="xl">
        <Skeleton class="h-64 w-full" />
      </Modal>
    )
  }

  const reg = doc.registration
  const lead = reg?.lead
  const off = reg?.processRegistration?.offering
  const sp = reg?.processRegistration?.selectionProcess
  const portal = reg?.portal

  const isImage = (doc.mimeType ?? '').startsWith('image/')
  const isPdf = (doc.mimeType ?? '') === 'application/pdf'

  function handleReview(status: 'approved' | 'rejected') {
    setError(null)
    if (status === 'rejected' && !reviewNote.trim()) {
      setError('Motivo é obrigatório ao rejeitar (será enviado ao candidato).')
      return
    }
    review.mutate({ id: doc!.id, status, reviewNote: reviewNote.trim() || null }, {
      onSuccess: () => {
        toast(
          status === 'approved' ? 'Documento aprovado' : 'Documento rejeitado — candidato notificado',
          'success',
        )
        onClose()
      },
      onError: (e: unknown) => setError((e as Error).message),
    })
  }

  function handleReanalyze() {
    reanalyze.mutate({ id: doc!.id }, {
      onSuccess: () => toast('Reanálise da IA enfileirada', 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  const aiAnalysisStr = doc.aiAnalysis
    ? (typeof doc.aiAnalysis === 'string' ? doc.aiAnalysis : JSON.stringify(doc.aiAnalysis, null, 2))
    : null
  const docName = doc.type?.name ?? doc.label ?? doc.typeCode ?? 'Documento'

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={docName}
      description={`${lead?.nome ?? '—'} · ${reg?.candidateCode ?? ''}`}
      size="xl"
      footer={
        <div class="flex items-center justify-between w-full gap-2 flex-wrap">
          {doc.type?.aiAnalysisTemplate ? (
            <Button variant="secondary" size="sm" onClick={handleReanalyze} disabled={reanalyze.isPending}>
              <RefreshCw size={12} /> {reanalyze.isPending ? 'Enfileirando…' : 'Reanalisar IA'}
            </Button>
          ) : <div />}
          <div class="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleReview('rejected')}
              disabled={review.isPending}
              class="border-danger text-danger hover:bg-danger/10"
            >
              ✗ Rejeitar
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => handleReview('approved')}
              disabled={review.isPending}
              class="bg-success hover:bg-success/90"
            >
              ✓ Aprovar
            </Button>
          </div>
        </div>
      }
    >
      <div class="space-y-4">
        <AiBlock
          status={doc.aiStatus}
          suggestion={doc.aiSuggestion}
          confidence={doc.aiConfidence}
          analysisStr={aiAnalysisStr}
          open={aiOpen}
          onToggle={() => setAiOpen((v) => !v)}
        />

        <div class="rounded-md border border-border bg-surface p-3 text-xs grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Row label="Status" value={doc.status === 'approved' ? 'Aprovado' : doc.status === 'rejected' ? 'Rejeitado' : 'Pendente'} />
          <Row label="Enviado em" value={formatDateTime(doc.uploadedAt)} />
          {off?.course?.nome || off?.nome ? <Row label="Curso" value={off.course?.nome ?? off.nome ?? '—'} /> : null}
          {sp?.nome ? <Row label="Processo" value={sp.nome} /> : null}
          {portal?.nome ? <Row label="Portal" value={portal.nome} /> : null}
          {lead?.email ? <Row label="E-mail" value={lead.email} /> : null}
          {lead?.whatsapp ? <Row label="WhatsApp" value={lead.whatsapp} /> : null}
        </div>

        <div class="rounded-md border border-border bg-surface overflow-hidden">
          <div class="flex items-center justify-between gap-2 px-3 py-2 border-b border-border bg-surface-2 text-xs">
            <span class="text-fg-muted truncate">
              {doc.fileName ?? 'arquivo'}
              {doc.sizeBytes != null && <span class="ml-1 text-fg-muted">· {(doc.sizeBytes / 1024).toFixed(0)} KB</span>}
            </span>
            <a href={doc.fileUrl} target="_blank" rel="noreferrer" class="inline-flex items-center gap-1 text-accent hover:underline">
              Abrir em nova aba <ExternalLink size={10} />
            </a>
          </div>
          <div class="bg-[oklch(0.15_0_0)] flex items-center justify-center min-h-[280px]">
            {isImage ? (
              <img src={doc.fileUrl} alt={doc.fileName ?? ''} class="max-w-full max-h-[55vh] object-contain" />
            ) : isPdf ? (
              <iframe src={doc.fileUrl} class="w-full h-[55vh] bg-white border-0" title={doc.fileName ?? 'PDF'} />
            ) : (
              <div class="text-fg-on-brand/80 p-8 text-center text-xs">
                Tipo de arquivo não pré-visualizável.
                <br />
                <a href={doc.fileUrl} target="_blank" rel="noreferrer" class="text-accent hover:underline">Abrir em nova aba ↗</a>
              </div>
            )}
          </div>
        </div>

        {doc.status === 'rejected' && doc.reviewNote && (
          <div class="rounded-md border border-danger/30 bg-danger/10 p-3 text-xs">
            <div class="text-3xs uppercase tracking-wider font-semibold text-danger mb-1">Motivo da rejeição (já enviado)</div>
            <div class="text-fg whitespace-pre-line">{doc.reviewNote}</div>
          </div>
        )}

        <div class="rounded-md border border-border bg-surface p-3 space-y-2">
          <div class="text-3xs uppercase tracking-wider font-semibold text-fg-muted">Veredito</div>
          <Textarea
            value={reviewNote}
            onInput={(e) => setReviewNote((e.target as HTMLTextAreaElement).value)}
            rows={3}
            placeholder="Mensagem para o candidato (obrigatório se rejeitar). Será enviada por e-mail e WhatsApp."
          />
          {error && <div class="text-xs text-danger">{error}</div>}
        </div>
      </div>
    </Modal>
  )
}

function AiBlock({
  status, suggestion, confidence, analysisStr, open, onToggle,
}: {
  status: DocItem['aiStatus']
  suggestion: DocItem['aiSuggestion']
  confidence: number | null
  analysisStr: string | null
  open: boolean
  onToggle: () => void
}) {
  if (status === 'pending' || status === 'processing') {
    return (
      <div class="rounded-md border border-info/30 bg-info/10 p-3 text-xs text-info flex items-center gap-2">
        <Clock size={14} /> A análise da IA ainda está em andamento.
      </div>
    )
  }
  if (status === 'failed') {
    return (
      <div class="rounded-md border border-danger/30 bg-danger/10 p-3 text-xs text-fg flex items-center gap-2">
        <AlertTriangle size={14} class="text-danger shrink-0" /> A análise da IA falhou. Você ainda pode revisar manualmente.
      </div>
    )
  }
  if (!suggestion) return null

  const palette = {
    approve: { tone: 'success' as const, emoji: '✅', label: 'Aprovar' },
    reject:  { tone: 'danger'  as const, emoji: '❌', label: 'Rejeitar' },
    review:  { tone: 'warning' as const, emoji: '⚠',  label: 'Revisar manualmente' },
  }[suggestion]

  const toneCls = {
    success: 'border-success bg-success text-fg-on-brand',
    danger:  'border-danger bg-danger text-fg-on-brand',
    warning: 'border-warning bg-warning text-fg-on-brand',
  }[palette.tone]

  return (
    <div class={cn('rounded-md border p-3 space-y-2', toneCls)}>
      <div class="flex items-baseline gap-3 flex-wrap">
        <Sparkles size={14} class="shrink-0" />
        <span class="text-3xs uppercase tracking-wider font-semibold">Sugestão da IA</span>
        <span class="text-base font-semibold">{palette.emoji} {palette.label}</span>
        {confidence !== null && (
          <span class="text-xs">Confiança: <strong>{Math.round(confidence * 100)}%</strong></span>
        )}
      </div>
      {analysisStr && (
        <button
          type="button"
          onClick={onToggle}
          class="text-2xs underline hover:no-underline"
        >
          {open ? 'Ocultar dados extraídos' : 'Ver dados extraídos'}
        </button>
      )}
      {open && analysisStr && (
        <pre class="bg-surface text-fg p-2 rounded text-3xs overflow-x-auto max-h-48">{analysisStr}</pre>
      )}
    </div>
  )
}
