import { useEffect, useMemo, useState } from 'preact/hooks'
import {
  Sparkles, ShieldCheck, Database, TrendingUp, Search, Download,
  RefreshCw, X as XIcon, AlertTriangle, Layers, Zap, HelpCircle,
} from 'lucide-preact'
import { HowItWorksModal } from '@/components/ui/HowItWorksModal'
import {
  useIntelOverview,
  useRunEnrichment,
  useGrantLgpd,
  useBulkLgpd,
  useBulkRunEnrichment,
  type IntelLead,
  type IntelStatusFilter,
  type IntelOrderBy,
  type ScanMode,
} from '@/hooks/useIntelligence'
import { ScanButton } from '@/components/intelligence/ScanButton'
import { SuggestedAction } from '@/components/intelligence/SuggestedAction'
import { LgpdBadge, lgpdSourceLabel } from '@/components/intelligence/LgpdBadge'
import { OperatorPanel } from '@/components/intelligence/OperatorPanel'
import { IntelLeadDetail } from '@/components/intelligence/IntelLeadDetail'
import { useUserStore } from '@/stores/user'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { KpiCard } from '@/components/ui/KpiCard'
import { SearchInput } from '@/components/ui/SearchInput'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { downloadFile } from '@/lib/download'
import { formatRelative } from '@/lib/format'
import { enrichmentStatusLabel } from '@/lib/statusLabels'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/cn'

const FILTERS: { id: IntelStatusFilter; label: string }[] = [
  { id: 'all', label: 'Todos' },
  { id: 'enriched', label: 'Enriquecidos' },
  { id: 'not_enriched', label: 'Não enriquecidos' },
  { id: 'consented', label: 'Com LGPD' },
  { id: 'no_lgpd', label: 'Sem LGPD' },
]

export function IntelligencePage() {
  const user = useUserStore((s) => s.user)
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPERADMIN'
  const [view, setView] = useState<'leads' | 'operator'>('leads')
  const [filter, setFilter] = useState<IntelStatusFilter>('all')
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(50)
  const [orderBy, setOrderBy] = useState<IntelOrderBy>('recent')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [confirmRevokeBulk, setConfirmRevokeBulk] = useState(false)
  const [detailLead, setDetailLead] = useState<IntelLead | null>(null)
  const [showHowItWorks, setShowHowItWorks] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 350)
    return () => clearTimeout(t)
  }, [searchInput])

  useEffect(() => { setPage(1); setSelectedIds(new Set()) }, [filter, search, limit, orderBy])

  const { data, isLoading, refetch, isFetching } = useIntelOverview({
    page,
    limit,
    status: filter,
    search: search || undefined,
    orderBy,
  })

  const bulk = useBulkLgpd()
  const grant = useGrantLgpd()
  const run = useRunEnrichment()
  const bulkRun = useBulkRunEnrichment()

  const leads = data?.leads ?? []
  const total = data?.pagination.total ?? 0
  const totalPages = data?.pagination.totalPages ?? 1
  const stats = data?.stats
  const counts = data?.filterCounts

  function toggleAll(checked: boolean) {
    setSelectedIds(checked ? new Set(leads.map((l) => l.id)) : new Set())
  }
  function toggleOne(id: number, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id); else next.delete(id)
      return next
    })
  }

  function handleBulkGrant(runEnrichment: boolean) {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    bulk.mutate({ leadIds: ids, consent: true, runEnrichment }, {
      onSuccess: (r) => {
        toast(`${r.updated} override(s) LGPD registrados${r.enqueued > 0 ? ` · ${r.enqueued} enriquecimento(s) na fila` : ''}`, 'success')
        setSelectedIds(new Set())
      },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function handleBulkRevoke() {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    bulk.mutate({ leadIds: ids, consent: false }, {
      onSuccess: (r) => {
        toast(`${r.updated} consentimento(s) revogados`, 'success')
        setSelectedIds(new Set())
        setConfirmRevokeBulk(false)
      },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function handleRunOne(lead: IntelLead, mode: ScanMode = 'full', force = false) {
    if (!lead.lgpdConsent) {
      toast('Lead sem LGPD — registre o consentimento primeiro', 'warning')
      return
    }
    run.mutate({ id: lead.id, mode, force }, {
      onSuccess: () => toast(`Scan ${mode === 'quick' ? 'rápido' : 'completo'} na fila`, 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function handleBulkRun(mode: ScanMode, force = false) {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    bulkRun.mutate({ leadIds: ids, mode, force }, {
      onSuccess: (r) => {
        const skipped = r.skipped > 0 ? ` · ${r.skipped} sem LGPD ignorados` : ''
        toast(`${r.enqueued} enriquecimento(s) na fila${skipped}`, 'success')
        setSelectedIds(new Set())
      },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function handleGrantOne(lead: IntelLead) {
    grant.mutate({ id: lead.id, consent: !lead.lgpdConsent }, {
      onSuccess: () => toast(lead.lgpdConsent ? 'Consentimento revogado' : 'Consentimento registrado', 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  const hasSelection = selectedIds.size > 0
  const allChecked = leads.length > 0 && leads.every((l) => selectedIds.has(l.id))

  return (
    <Page
      title="Inteligência"
      description="Enriquecimento de leads com fontes públicas e gestão de consentimento LGPD."
      actions={
        <Button variant="ghost" size="sm" onClick={() => setShowHowItWorks(true)}>
          <HelpCircle size={14} /> Como funciona?
        </Button>
      }
    >
      <div class="rounded-lg p-4 text-fg-on-brand bg-gradient-to-br from-accent to-info">
        <div class="flex items-center gap-3 mb-2">
          <Sparkles size={20} class="shrink-0" />
          <h2 class="text-lg font-semibold">Inteligência de Leads</h2>
        </div>
        <p class="text-xs leading-relaxed opacity-90">
          Consulta fontes públicas (Gravatar, BrasilAPI, ViaCEP, Google CSE, GitHub, redes sociais)
          e gera um dossiê com score de confiança para cada lead. Só roda após consentimento LGPD explícito.
        </p>
      </div>

      <div class="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-fg flex items-start gap-2">
        <AlertTriangle size={14} class="mt-0.5 shrink-0 text-warning" />
        <div class="leading-relaxed">
          <strong class="text-warning">Conformidade LGPD (art. 18):</strong> Leads sem consentimento registrado <strong>não</strong> podem ser enriquecidos.
          Você pode registrar consentimento por lead ou em lote, e remover fatos individuais a qualquer momento (direito à exclusão).
        </div>
      </div>

      {isAdmin && (
        <div class="flex items-center gap-1 border-b border-border">
          <button
            type="button"
            onClick={() => setView('leads')}
            class={cn(
              'h-9 px-3 -mb-px text-xs font-medium border-b-2 transition-colors',
              view === 'leads' ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:text-fg',
            )}
          >
            Leads
          </button>
          <button
            type="button"
            onClick={() => setView('operator')}
            class={cn(
              'h-9 px-3 -mb-px text-xs font-medium border-b-2 transition-colors',
              view === 'operator' ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:text-fg',
            )}
          >
            Operador
          </button>
        </div>
      )}

      {view === 'operator' && isAdmin && <OperatorPanel />}

      {view === 'leads' && (<>

      <section class="grid gap-3 grid-cols-2 lg:grid-cols-5">
        <KpiCard label="Leads totais" value={stats?.totalLeads ?? '—'} loading={isLoading} icon={<Database size={16} />} />
        <KpiCard label="Com LGPD" value={stats?.consentedLeads ?? '—'} loading={isLoading} icon={<ShieldCheck size={16} />} hint={stats && stats.totalLeads > 0 ? `${Math.round((stats.consentedLeads / stats.totalLeads) * 100)}%` : undefined} />
        <KpiCard label="Enriquecidos" value={stats?.enrichedLeads ?? '—'} loading={isLoading} icon={<Sparkles size={16} />} />
        <KpiCard label="Score médio" value={stats?.avgScore ?? '—'} loading={isLoading} icon={<TrendingUp size={16} />} />
        <KpiCard label="Fatos coletados" value={stats?.totalFactsGlobal ?? '—'} loading={isLoading} icon={<Layers size={16} />} />
      </section>

      <Card class="p-3">
        <div class="flex flex-col gap-3">
          <SearchInput
            value={searchInput}
            onChange={setSearchInput}
            placeholder="Buscar por nome, empresa, email, WhatsApp ou UID…"
            class="w-full"
          />
          <div class="flex flex-wrap items-center gap-1.5">
            {FILTERS.map((f) => {
              const c = counts ? counts[f.id as keyof typeof counts] : undefined
              const active = filter === f.id
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  class={cn(
                    'inline-flex items-center gap-1.5 h-7 px-3 rounded-full border text-xs font-medium',
                    active ? 'bg-accent text-fg-on-brand border-accent' : 'bg-surface text-fg-muted border-border hover:text-fg',
                  )}
                >
                  {f.label}
                  {c !== undefined && <span class="tabular-nums opacity-75">{c}</span>}
                </button>
              )
            })}
            <div class="flex-1" />
            <label class="text-xs text-fg-subtle">Ordenar por</label>
            <select
              class="h-7 px-2 rounded-md bg-surface border border-border text-fg text-xs cursor-pointer focus:outline-none focus:border-accent"
              value={orderBy}
              onChange={(e) => setOrderBy((e.target as HTMLSelectElement).value as IntelOrderBy)}
            >
              <option value="recent">Mais recentes</option>
              <option value="opportunity">Oportunidade ↓</option>
              <option value="score">Score ↓</option>
            </select>
          </div>
        </div>
      </Card>

      {hasSelection && (
        <Card class="p-3 border-accent">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-sm text-fg font-medium">{selectedIds.size} selecionado(s)</span>
            <div class="flex-1" />
            <ScanButton
              label="Enriquecer selecionados"
              onScan={(mode, force) => handleBulkRun(mode, force)}
              disabled={bulkRun.isPending}
            />
            <Button
              variant="primary"
              size="sm"
              onClick={() => handleBulkGrant(true)}
              disabled={bulk.isPending}
              title="Marca como operator_override — sua organização assume a base legal."
            >
              <ShieldCheck size={12} /> Override LGPD + enriquecer
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleBulkGrant(false)}
              disabled={bulk.isPending}
              title="Marca como operator_override — sua organização assume a base legal."
            >
              <ShieldCheck size={12} /> Apenas override LGPD
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setConfirmRevokeBulk(true)} disabled={bulk.isPending}>
              <XIcon size={12} /> Revogar LGPD
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setSelectedIds(new Set())}>Limpar</Button>
          </div>
        </Card>
      )}

      <Card class="p-0 overflow-hidden">
        <div class="flex items-center justify-between gap-2 px-3 py-2 border-b border-border bg-surface-3">
          <div class="text-xs text-fg-muted">
            {total === 0
              ? '0 resultados'
              : <>{((page - 1) * limit) + 1}–{Math.min(page * limit, total)} de <span class="text-fg tabular-nums">{total.toLocaleString('pt-BR')}</span></>}
          </div>
          <div class="flex items-center gap-1.5">
            <select
              class="h-7 px-2 rounded-md bg-surface border border-border text-fg text-xs cursor-pointer focus:outline-none focus:border-accent"
              value={limit}
              onChange={(e) => setLimit(Number((e.target as HTMLSelectElement).value))}
              aria-label="Itens por página"
            >
              {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n}/página</option>)}
            </select>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void refetch()}
              disabled={isFetching}
              aria-label="Atualizar"
            >
              <RefreshCw size={12} class={isFetching ? 'animate-spin' : ''} /> Atualizar
            </Button>
          </div>
        </div>

        {isLoading && <div class="p-4 space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} class="h-12 w-full" />)}</div>}
        {!isLoading && leads.length === 0 && (
          <div class="p-8"><EmptyState icon={<Sparkles size={24} />} title="Sem leads" description={search ? 'Tente outra busca.' : 'Não há leads com esse filtro.'} /></div>
        )}
        {!isLoading && leads.length > 0 && (
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="bg-surface-3">
                <tr>
                  <th class="w-10 text-center px-3 py-2">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      onChange={(e) => toggleAll((e.target as HTMLInputElement).checked)}
                      class="size-4 cursor-pointer accent-accent"
                      aria-label="Selecionar todos"
                    />
                  </th>
                  <th class="text-left px-3 py-2 text-xs font-semibold text-fg-muted">Lead</th>
                  <th class="text-left px-3 py-2 text-xs font-semibold text-fg-muted">LGPD</th>
                  <th class="text-left px-3 py-2 text-xs font-semibold text-fg-muted">Status</th>
                  <th class="text-right px-3 py-2 text-xs font-semibold text-fg-muted">Score</th>
                  {orderBy === 'opportunity' && (
                    <th class="text-right px-3 py-2 text-xs font-semibold text-fg-muted" title="Score + canais validados + recência + posição no funil">
                      Oport.
                    </th>
                  )}
                  <th class="text-right px-3 py-2 text-xs font-semibold text-fg-muted">Fatos</th>
                  <th class="text-left px-3 py-2 text-xs font-semibold text-fg-muted">Enriquecido</th>
                  <th class="text-left px-3 py-2 text-xs font-semibold text-fg-muted">Sugestão</th>
                  <th class="w-32 px-3 py-2"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-border">
                {leads.map((l) => (
                  <IntelRow
                    key={l.id}
                    lead={l}
                    selected={selectedIds.has(l.id)}
                    onToggle={(c) => toggleOne(l.id, c)}
                    onView={() => setDetailLead(l)}
                    onRun={(mode, force) => handleRunOne(l, mode, force)}
                    onGrant={() => handleGrantOne(l)}
                    busy={run.isPending || grant.isPending}
                    showOpportunity={orderBy === 'opportunity'}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {totalPages > 1 && (
        <PageNumbers page={page} totalPages={totalPages} onChange={setPage} />
      )}

      {confirmRevokeBulk && (
        <ConfirmDialog
          open
          onOpenChange={(o) => { if (!o) setConfirmRevokeBulk(false) }}
          title={`Revogar consentimento LGPD de ${selectedIds.size} lead(s)`}
          description="Sem consentimento, esses leads não poderão mais ser enriquecidos. Fatos já coletados permanecem (use o detalhe do lead para excluir individualmente)."
          destructive
          confirmLabel="Revogar"
          loading={bulk.isPending}
          onConfirm={handleBulkRevoke}
        />
      )}

      {detailLead && <IntelDetailModal lead={detailLead} onClose={() => setDetailLead(null)} />}
      </>)}

      <HowItWorksModal
        open={showHowItWorks}
        onClose={() => setShowHowItWorks(false)}
        title="Como funciona a Inteligência?"
        problem={<>
          Lead manda só o WhatsApp e o nome. Quem é essa pessoa? Empresa? Cargo? Telefone fixo?
          A Inteligência consulta <strong>fontes públicas</strong> (CPF/CNPJ, redes sociais, bases
          governamentais) e <strong>enriquece</strong> o lead com dados adicionais — tudo dentro da
          LGPD, com consentimento controlado.
        </>}
        steps={[
          {
            title: '✋ Consentimento LGPD primeiro',
            body: <>Por lei, você só pode buscar dados de quem deu consentimento. O ícone de escudo no lead indica se ele <strong>autorizou</strong>. Sem isso, o enriquecimento fica bloqueado.</>,
          },
          {
            title: '🔍 Rode o enriquecimento',
            body: <>Botão <strong>Enriquecer</strong> em um lead (ou em massa pra vários) consulta fontes externas. O sistema descobre: nome completo, empresa, cargo, redes sociais, telefones, e-mails alternativos.</>,
          },
          {
            title: '📂 Dados ficam no lead',
            body: <>Tudo que veio do enriquecimento aparece no detalhe do lead, com a fonte e a data. Você pode usar como argumento na hora de abordar ("oi João, vi que você é gerente na empresa X…").</>,
          },
          {
            title: '⚖️ Operator override (LGPD)',
            body: <>Se você é o operador e a base legal é da sua empresa (ex.: contrato firmado offline), pode marcar <strong>operator_override</strong> — sua organização assume a responsabilidade legal pelo uso dos dados.</>,
          },
          {
            title: '↩️ Revogar quando preciso',
            body: <>Lead pediu LGPD ("apaguem meus dados")? Revogue o consentimento e os dados enriquecidos somem. Pode revogar em massa pra limpar dados antigos.</>,
          },
        ]}
        tip={{
          tone: 'warning',
          title: '⚠️ Cuidados com LGPD',
          body: <>Use Inteligência <strong>com responsabilidade</strong>. Cada consulta gera registro auditável. Não enriqueça em massa sem motivo de negócio — pode ser interpretado como uso indevido de dados.</>,
        }}
      />
    </Page>
  )
}

function IntelRow({
  lead, selected, onToggle, onView, onRun, onGrant, busy, showOpportunity,
}: {
  lead: IntelLead
  selected: boolean
  onToggle: (c: boolean) => void
  onView: () => void
  onRun: (mode: ScanMode, force?: boolean) => void
  onGrant: () => void
  busy: boolean
  showOpportunity?: boolean
}) {
  function downloadPdf() {
    void downloadFile(`/bychat/leads/${lead.id}/dossier.pdf`, `dossie-${lead.id}.pdf`)
      .catch((e: unknown) => toast((e as Error).message, 'danger'))
  }
  const hasFacts = lead.totalFacts > 0
  const isPartial = lead.enrichmentStatus === 'partial'
  const statusTone: 'success' | 'info' | 'neutral' =
    lead.enrichmentStatus === 'done' ? 'success' :
    lead.enrichmentStatus === 'running' ? 'info' :
    'neutral'
  const statusSolid = statusTone !== 'neutral' || isPartial
  const statusLabel = enrichmentStatusLabel(lead.enrichmentStatus ?? 'pendente')
  const score = lead.enrichmentScore !== null ? Math.round(lead.enrichmentScore) : null

  return (
    <tr class={cn('hover:bg-surface-3', selected && 'bg-accent/5')}>
      <td class="text-center px-3 py-2">
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onToggle((e.target as HTMLInputElement).checked)}
          class="size-4 cursor-pointer accent-accent"
        />
      </td>
      <td class="px-3 py-2 max-w-[16rem]">
        <button type="button" class="text-left text-fg hover:text-accent truncate" onClick={onView}>
          {lead.nome ?? lead.empresa ?? `Lead #${lead.id}`}
        </button>
        <div class="text-[0.6875rem] text-fg-subtle truncate">
          {lead.empresa ? lead.empresa + ' · ' : ''}{lead.email ?? lead.whatsapp ?? '—'}
        </div>
      </td>
      <td class="px-3 py-2">
        <span title={lgpdSourceLabel(lead.lgpdConsentSource ?? null)}>
          <LgpdBadge consent={lead.lgpdConsent} source={lead.lgpdConsentSource ?? null} compact />
        </span>
      </td>
      <td class="px-3 py-2">
        <Badge
          tone={statusTone}
          solid={statusSolid}
          {...(isPartial ? { style: { background: '#f97316', color: '#fff' } } : {})}
        >
          {statusLabel}
        </Badge>
      </td>
      <td class="px-3 py-2 text-right tabular-nums text-fg">{score ?? '—'}</td>
      {showOpportunity && (
        <td class="px-3 py-2 text-right tabular-nums">
          {typeof lead.opportunity === 'number' ? (
            <span class={cn(
              'inline-flex items-center px-1.5 py-0.5 rounded text-[0.6875rem] font-semibold',
              lead.opportunity >= 100 ? 'bg-success/15 text-success'
                : lead.opportunity >= 70 ? 'bg-info/15 text-info'
                : lead.opportunity >= 40 ? 'bg-warning/15 text-warning'
                : 'bg-surface-3 text-fg-subtle',
            )}>{lead.opportunity}</span>
          ) : '—'}
        </td>
      )}
      <td class="px-3 py-2 text-right tabular-nums">
        <span class={lead.totalFacts > 0 ? 'text-info' : 'text-fg-subtle'}>{lead.totalFacts}</span>
      </td>
      <td class="px-3 py-2 text-xs text-fg-muted whitespace-nowrap">
        {lead.enrichedAt ? formatRelative(lead.enrichedAt) : '—'}
      </td>
      <td class="px-3 py-2">
        <SuggestedAction lead={lead} onRun={onRun} />
      </td>
      <td class="px-3 py-2">
        <div class="flex gap-0.5 justify-end">
          <button
            type="button"
            class={cn(
              'size-7 rounded grid place-items-center hover:bg-surface-3',
              lead.lgpdConsent ? 'text-success' : 'text-fg-muted hover:text-fg',
            )}
            onClick={onGrant}
            disabled={busy}
            title={lead.lgpdConsent ? 'Revogar LGPD' : 'Registrar LGPD'}
            aria-label={lead.lgpdConsent ? 'Revogar LGPD' : 'Registrar LGPD'}
          >
            <ShieldCheck size={12} />
          </button>
          <button
            type="button"
            class="size-7 rounded grid place-items-center text-fg-muted hover:text-warning hover:bg-surface-3 disabled:opacity-30 disabled:cursor-not-allowed"
            onClick={() => onRun('quick')}
            disabled={busy || !lead.lgpdConsent}
            title={lead.lgpdConsent ? 'Scan rápido (~2s)' : 'Precisa LGPD primeiro'}
            aria-label="Scan rápido"
          >
            <Zap size={12} />
          </button>
          <button
            type="button"
            class="size-7 rounded grid place-items-center text-fg-muted hover:text-fg hover:bg-surface-3 disabled:opacity-30 disabled:cursor-not-allowed"
            onClick={() => onRun('full')}
            disabled={busy || !lead.lgpdConsent}
            title={lead.lgpdConsent ? 'Scan completo (~15s)' : 'Precisa LGPD primeiro'}
            aria-label="Scan completo"
          >
            <RefreshCw size={12} />
          </button>
          <button
            type="button"
            class="size-7 rounded grid place-items-center text-fg-muted hover:text-fg hover:bg-surface-3"
            onClick={onView}
            title="Ver fatos"
            aria-label="Ver fatos"
          >
            <Search size={12} />
          </button>
          <button
            type="button"
            class="size-7 rounded grid place-items-center text-fg-muted hover:text-fg hover:bg-surface-3 disabled:opacity-30 disabled:cursor-not-allowed"
            onClick={downloadPdf}
            disabled={!hasFacts}
            title={hasFacts ? 'Baixar dossiê PDF' : 'Sem fatos coletados ainda'}
            aria-label="Baixar dossiê PDF"
          >
            <Download size={12} />
          </button>
        </div>
      </td>
    </tr>
  )
}

// ───────────────────────────────────────────────
// Pagination com números de página + elipses
// ───────────────────────────────────────────────

function PageNumbers({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (n: number) => void }) {
  const pages = useMemo(() => {
    const set = new Set<number>([1, totalPages, page, page - 1, page + 1, page - 2, page + 2])
    return [...set].filter((n) => n >= 1 && n <= totalPages).sort((a, b) => a - b)
  }, [page, totalPages])

  const items: ({ kind: 'page'; n: number } | { kind: 'gap' })[] = []
  let prev = 0
  for (const n of pages) {
    if (n - prev > 1) items.push({ kind: 'gap' })
    items.push({ kind: 'page', n })
    prev = n
  }

  return (
    <div class="flex items-center justify-between gap-2 text-xs flex-wrap">
      <span class="text-fg-muted">Página {page} de {totalPages}</span>
      <div class="flex items-center gap-1 flex-wrap">
        <button
          type="button"
          class="h-7 px-3 rounded-md border border-border bg-surface text-fg-muted hover:text-fg hover:bg-surface-3 disabled:opacity-40 disabled:hover:bg-surface"
          onClick={() => onChange(Math.max(1, page - 1))}
          disabled={page <= 1}
        >
          ← Anterior
        </button>
        {items.map((it, i) => it.kind === 'gap'
          ? <span key={`gap-${i}`} class="px-1 text-fg-subtle">…</span>
          : (
            <button
              key={`p-${it.n}`}
              type="button"
              class={cn(
                'h-7 min-w-[2rem] px-2 rounded-md border text-xs font-medium tabular-nums',
                it.n === page ? 'border-accent bg-accent text-fg-on-brand' : 'border-border bg-surface text-fg-muted hover:text-fg hover:bg-surface-3',
              )}
              onClick={() => onChange(it.n)}
            >
              {it.n}
            </button>
          ),
        )}
        <button
          type="button"
          class="h-7 px-3 rounded-md border border-border bg-surface text-fg-muted hover:text-fg hover:bg-surface-3 disabled:opacity-40 disabled:hover:bg-surface"
          onClick={() => onChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
        >
          Próxima →
        </button>
      </div>
    </div>
  )
}

function IntelDetailModal({ lead, onClose }: { lead: IntelLead; onClose: () => void }) {
  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Dossiê — ${lead.nome ?? lead.empresa ?? `Lead #${lead.id}`}`}
      description={lead.email ?? lead.whatsapp ?? undefined}
      size="xl"
      footer={
        <div class="flex justify-end w-full">
          <Button variant="primary" size="sm" onClick={onClose}>Fechar</Button>
        </div>
      }
    >
      <IntelLeadDetail leadId={lead.id} />
    </Modal>
  )
}

