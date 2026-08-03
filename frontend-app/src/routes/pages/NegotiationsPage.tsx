// Tela do módulo Negociações: todas as propostas da operação num lugar só.
//
// Duas visões do MESMO recorte de filtros: tabela (analisar, comparar, exportar)
// e pipeline por status (operar — arrastar a proposta de Enviada para Em
// negociação). Os KPIs no topo separam recorrência de pagamento único, pela
// mesma razão da Visão Geral: venda avulsa não é crescimento de MRR.
//
// A proposta abre num modal com o editor da aba do lead (`NegotiationEditor`) —
// é a mesma proposta, mudou só de onde se chega nela.

import { useEffect, useMemo, useState } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import {
  DndContext, DragOverlay, PointerSensor, closestCenter, useSensor, useSensors,
  useDraggable, useDroppable, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { Handshake, Table2, Columns3, Download, RefreshCw, ExternalLink, HelpCircle } from 'lucide-preact'
import {
  useNegotiationsOverview, useSetNegotiationStatus, negotiationsOverviewQuery,
  type NegotiationRow, type NegotiationsOverviewParams,
} from '@/hooks/useNegotiations'
import { NegotiationEditor } from '@/components/LeadNegotiationTab'
import { useFunnels } from '@/hooks/useFunnels'
import { useUsers } from '@/hooks/useUsers'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Input'
import { KpiCard } from '@/components/ui/KpiCard'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { SearchInput } from '@/components/ui/SearchInput'
import { HowItWorksModal } from '@/components/ui/HowItWorksModal'
import { downloadFile } from '@/lib/download'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/cn'

type Tone = 'info' | 'success' | 'danger' | 'warning' | 'neutral'
const STATUS: Record<string, { label: string; tone: Tone }> = {
  rascunho: { label: 'Rascunho', tone: 'neutral' },
  enviada: { label: 'Enviada', tone: 'info' },
  em_negociacao: { label: 'Em negociação', tone: 'warning' },
  aceita: { label: 'Aceita', tone: 'success' },
  recusada: { label: 'Recusada', tone: 'danger' },
  expirada: { label: 'Expirada', tone: 'neutral' },
}
const PIPELINE_ORDER = ['rascunho', 'enviada', 'em_negociacao', 'aceita', 'recusada', 'expirada']

const money = (v: unknown) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return isFinite(n) ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }) : 'R$ 0'
}
const moneyExact = (v: unknown) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return isFinite(n) ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'R$ 0,00'
}
const numOf = (v: unknown) => { const n = parseFloat(String(v ?? '')); return isFinite(n) ? n : 0 }
const leadLabel = (r: NegotiationRow) => r.lead?.nome || r.lead?.whatsapp || r.lead?.email || `Lead #${r.leadId}`

/** Rótulo de valor da proposta: mensalidade nunca fica escondida dentro de um
 * total único, senão contrato de recorrência parece venda avulsa. */
function ValorCell({ n }: { n: NegotiationRow }) {
  const mrr = numOf(n.valorRecorrente)
  const unico = numOf(n.valorUnico)
  return (
    <div class="text-right tabular-nums">
      <div class="text-sm text-fg">{unico > 0 ? moneyExact(unico) : '—'}</div>
      {mrr > 0 ? <div class="text-xs text-accent">+ {moneyExact(mrr)}/mês</div> : null}
    </div>
  )
}

function statusOf(n: NegotiationRow) {
  if (n.resultado === 'won') return { label: 'Ganha', tone: 'success' as Tone }
  if (n.resultado === 'lost') return { label: 'Perdida', tone: 'danger' as Tone }
  return STATUS[n.status] ?? STATUS.rascunho
}

// ── Pipeline ──────────────────────────────────────────────────────────────

function PipelineCard({ n, onOpen, dragging }: { n: NegotiationRow; onOpen?: () => void; dragging?: boolean }) {
  const mrr = numOf(n.valorRecorrente)
  return (
    <div
      class={cn(
        'rounded-md border border-border bg-surface p-2 text-left w-full',
        dragging ? 'shadow-lg rotate-1' : 'hover:border-accent/50 cursor-grab active:cursor-grabbing',
      )}
      onClick={onOpen}
    >
      <div class="text-sm font-medium text-fg truncate">{leadLabel(n)}</div>
      <div class="text-xs text-fg-muted truncate">{n.titulo}</div>
      <div class="mt-1 flex items-baseline justify-between gap-2">
        <span class="text-sm text-fg tabular-nums">{money(n.valorUnico)}</span>
        {mrr > 0 ? <span class="text-xs text-accent tabular-nums">{money(mrr)}/mês</span> : null}
      </div>
      {n.responsavelNome ? <div class="text-[11px] text-fg-subtle mt-0.5 truncate">{n.responsavelNome}</div> : null}
    </div>
  )
}

function DraggableCard({ n, onOpen }: { n: NegotiationRow; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: n.id, disabled: !!n.resultado })
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} class={isDragging ? 'opacity-40' : ''}>
      <PipelineCard n={n} onOpen={onOpen} />
    </div>
  )
}

function PipelineColumn({ status, rows, totals, onOpen }: {
  status: string
  rows: NegotiationRow[]
  totals: { count: number; valorUnico: number; valorRecorrente: number } | undefined
  onOpen: (n: NegotiationRow) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  const meta = STATUS[status] ?? STATUS.rascunho
  return (
    <div
      ref={setNodeRef}
      class={cn(
        'w-72 shrink-0 rounded-lg border p-2 space-y-2 bg-surface-2/40',
        isOver ? 'border-accent bg-accent/5' : 'border-border',
      )}
    >
      <div class="flex items-center justify-between gap-2 px-0.5">
        <Badge tone={meta.tone}>{meta.label}</Badge>
        <span class="text-xs text-fg-subtle tabular-nums">{totals?.count ?? rows.length}</span>
      </div>
      <div class="px-0.5 text-[11px] text-fg-muted tabular-nums">
        {money(totals?.valorUnico ?? 0)}
        {(totals?.valorRecorrente ?? 0) > 0 ? <> · {money(totals?.valorRecorrente ?? 0)}/mês</> : null}
      </div>
      <div class="space-y-1.5 max-h-[60vh] overflow-y-auto">
        {rows.length === 0
          ? <p class="text-[11px] text-fg-subtle px-0.5 py-2">Nada aqui.</p>
          : rows.map((n) => <DraggableCard key={n.id} n={n} onOpen={() => onOpen(n)} />)}
      </div>
    </div>
  )
}

// ── Página ────────────────────────────────────────────────────────────────

type View = 'table' | 'pipeline'

export function NegotiationsPage() {
  const [, navigate] = useLocation()
  const [view, setView] = useState<View>(() => (localStorage.getItem('negotiations.view') === 'pipeline' ? 'pipeline' : 'table'))
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [resultado, setResultado] = useState('')
  const [funnelId, setFunnelId] = useState<number | null>(null)
  const [responsavelUserId, setResponsavelUserId] = useState<number | null>(null)
  const [cobranca, setCobranca] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [orderBy, setOrderBy] = useState('recent')
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<NegotiationRow | null>(null)
  const [showHowItWorks, setShowHowItWorks] = useState(false)
  const [dragging, setDragging] = useState<NegotiationRow | null>(null)

  const funnels = useFunnels()
  const users = useUsers()
  const setStatus = useSetNegotiationStatus()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300)
    return () => clearTimeout(t)
  }, [searchInput])
  useEffect(() => { setPage(1) }, [search, resultado, funnelId, responsavelUserId, cobranca, dateFrom, dateTo, orderBy])

  function changeView(v: View) {
    setView(v)
    try { localStorage.setItem('negotiations.view', v) } catch { /* ignore */ }
  }

  // O pipeline precisa das colunas inteiras; a tabela pagina. Um parâmetro só
  // muda entre as duas visões — o resto do recorte é idêntico.
  const params: NegotiationsOverviewParams = {
    page: view === 'pipeline' ? 1 : page,
    limit: view === 'pipeline' ? 200 : 50,
    q: search || undefined,
    resultado: resultado || undefined,
    funnelId: funnelId ?? undefined,
    responsavelUserId: responsavelUserId ?? undefined,
    cobranca: cobranca || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    orderBy,
  }
  const { data, isLoading, isFetching, refetch } = useNegotiationsOverview(params)
  const rows = data?.negotiations ?? []
  const kpis = data?.kpis
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1

  const byStatus = useMemo(() => {
    const map = new Map<string, NegotiationRow[]>()
    for (const s of PIPELINE_ORDER) map.set(s, [])
    for (const n of rows) {
      const key = PIPELINE_ORDER.includes(n.status) ? n.status : 'rascunho'
      map.get(key)!.push(n)
    }
    return map
  }, [rows])
  const totalsByStatus = useMemo(() => {
    const m = new Map<string, { count: number; valorUnico: number; valorRecorrente: number }>()
    for (const g of data?.byStatus ?? []) m.set(g.status, { count: g.count, valorUnico: g.valorUnico, valorRecorrente: g.valorRecorrente })
    return m
  }, [data?.byStatus])

  function handleDragStart(e: DragStartEvent) {
    setDragging(rows.find((n) => n.id === Number(e.active.id)) ?? null)
  }
  function handleDragEnd(e: DragEndEvent) {
    setDragging(null)
    const id = Number(e.active.id)
    const target = e.over?.id ? String(e.over.id) : null
    const n = rows.find((r) => r.id === id)
    if (!target || !n || n.status === target) return
    if (n.resultado) { toast('Negociação fechada — reabra antes de mudar o status', 'warning'); return }
    if (target === 'aceita' || target === 'recusada') {
      // Ganho/perdido mexe no desfecho do LEAD e exige motivo da perda: tem que
      // passar pelo fluxo de fechamento, não por um arrasto.
      toast('Para dar como ganha ou perdida, abra a proposta e use "Fechar negociação"', 'warning')
      return
    }
    setStatus.mutate({ id, status: target }, {
      onSuccess: () => toast(`Movida para ${STATUS[target]?.label ?? target}`, 'success'),
      onError: (err: unknown) => toast((err as Error).message || 'Não foi possível mover', 'danger'),
    })
  }

  function exportCsv() {
    const qs = negotiationsOverviewQuery({ ...params, page: 1, limit: 200 })
    downloadFile(`/admin/negotiations/overview?${qs}&format=csv`, 'negociacoes.csv')
      .catch(() => toast('Falha ao exportar', 'danger'))
  }

  const filtroAtivo = !!(search || resultado || funnelId || responsavelUserId || cobranca || dateFrom || dateTo)

  return (
    <Page
      title="Negociações"
      description="Todas as propostas da operação: o que está na mesa, o que fechou e quanto disso é recorrente."
      actions={
        <div class="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setShowHowItWorks(true)}><HelpCircle size={14} /> Como funciona?</Button>
          <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw size={14} class={isFetching ? 'animate-spin' : ''} /> Atualizar
          </Button>
          <Button variant="ghost" size="sm" onClick={exportCsv}><Download size={14} /> Exportar</Button>
          <div class="flex items-center gap-1 p-0.5 rounded-md bg-surface-3">
            <button
              type="button"
              onClick={() => changeView('table')}
              class={cn('h-7 px-3 rounded text-xs font-medium inline-flex items-center gap-1 transition-colors',
                view === 'table' ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg')}
            >
              <Table2 size={13} /> Tabela
            </button>
            <button
              type="button"
              onClick={() => changeView('pipeline')}
              class={cn('h-7 px-3 rounded text-xs font-medium inline-flex items-center gap-1 transition-colors',
                view === 'pipeline' ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg')}
            >
              <Columns3 size={13} /> Pipeline
            </button>
          </div>
        </div>
      }
    >
      {/* KPIs — recorrência e pagamento único lado a lado, nunca somados */}
      <div class="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Na mesa (único)"
          value={money(kpis?.openUnico ?? 0)}
          hint={`${kpis?.openCount ?? 0} proposta(s) em aberto`}
          loading={isLoading}
        />
        <KpiCard
          label="Na mesa (mensal)"
          value={`${money(kpis?.openMrr ?? 0)}/mês`}
          hint="MRR das propostas em aberto"
          loading={isLoading}
        />
        <KpiCard
          label="Fechado (único)"
          value={money(kpis?.wonUnico ?? 0)}
          hint={`${kpis?.wonCount ?? 0} proposta(s) ganha(s)`}
          loading={isLoading}
        />
        <KpiCard
          label="Fechado (mensal)"
          value={`${money(kpis?.wonMrr ?? 0)}/mês`}
          hint="novo MRR no período"
          loading={isLoading}
        />
      </div>

      {/* Contexto do fechamento: fora dos cards porque é leitura de apoio, não
          indicador de topo — e o ticket médio é do 1º ciclo, não do MRR. */}
      {!isLoading && kpis ? (
        <p class="text-xs text-fg-subtle -mt-1">
          {kpis.winRate != null
            ? <>Aproveitamento de <strong class="text-fg-muted">{kpis.winRate}%</strong> ({kpis.wonCount} ganha(s) · {kpis.lostCount} perdida(s))</>
            : <>Nenhuma proposta fechada neste recorte</>}
          {kpis.avgTicket ? <> · ticket médio de <strong class="text-fg-muted">{money(kpis.avgTicket)}</strong> no 1º ciclo (único + 1 mensalidade)</> : null}
        </p>
      ) : null}

      {/* Filtros — valem para as duas visões */}
      <Card class="!p-3">
        <div class="flex flex-wrap items-center gap-2">
          <SearchInput value={searchInput} onChange={setSearchInput} placeholder="Lead ou título da proposta…" class="w-56" />
          <Select value={resultado} onChange={(e) => setResultado((e.target as HTMLSelectElement).value)} class="w-48">
            <option value="">Abertas e fechadas</option>
            <option value="open">Só em aberto</option>
            <option value="won">Só ganhas</option>
            <option value="lost">Só perdidas</option>
          </Select>
          <Select value={cobranca} onChange={(e) => setCobranca((e.target as HTMLSelectElement).value)} class="w-48">
            <option value="">Qualquer cobrança</option>
            <option value="recorrente">Com mensalidade</option>
            <option value="unico">Com pagamento único</option>
          </Select>
          <Select value={funnelId ? String(funnelId) : ''} onChange={(e) => setFunnelId(Number((e.target as HTMLSelectElement).value) || null)} class="w-40">
            <option value="">Todos os funis</option>
            {(funnels.data?.funnels ?? []).filter((f) => f.active).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </Select>
          <Select value={responsavelUserId ? String(responsavelUserId) : ''} onChange={(e) => setResponsavelUserId(Number((e.target as HTMLSelectElement).value) || null)} class="w-52">
            <option value="">Todos os responsáveis</option>
            {(users.data?.users ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
          <div class="flex items-center gap-1">
            <input type="date" value={dateFrom} max={dateTo || undefined} onInput={(e) => setDateFrom((e.target as HTMLInputElement).value)}
              class="h-8 px-2 rounded border border-border bg-surface text-xs text-fg focus:outline-none focus:border-accent" aria-label="Data inicial" />
            <span class="text-xs text-fg-subtle">até</span>
            <input type="date" value={dateTo} min={dateFrom || undefined} onInput={(e) => setDateTo((e.target as HTMLInputElement).value)}
              class="h-8 px-2 rounded border border-border bg-surface text-xs text-fg focus:outline-none focus:border-accent" aria-label="Data final" />
          </div>
          {view === 'table' ? (
            <Select value={orderBy} onChange={(e) => setOrderBy((e.target as HTMLSelectElement).value)} class="w-40">
              <option value="recent">Mais recentes</option>
              <option value="oldest">Mais antigas</option>
              <option value="value">Maior valor</option>
              <option value="mrr">Maior mensalidade</option>
            </Select>
          ) : null}
          {filtroAtivo ? (
            <Button variant="ghost" size="sm" onClick={() => {
              setSearchInput(''); setSearch(''); setResultado(''); setFunnelId(null)
              setResponsavelUserId(null); setCobranca(''); setDateFrom(''); setDateTo('')
            }}>Limpar filtros</Button>
          ) : null}
        </div>
        <p class="text-[11px] text-fg-subtle mt-2">
          O período considera a data de <strong>fechamento</strong> nas propostas fechadas e a de <strong>criação</strong> nas que seguem em aberto.
        </p>
      </Card>

      {isLoading ? (
        <div class="space-y-2"><Skeleton class="h-12 w-full" /><Skeleton class="h-12 w-full" /><Skeleton class="h-12 w-full" /></div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Handshake}
          title={filtroAtivo ? 'Nenhuma negociação neste recorte' : 'Nenhuma negociação ainda'}
          description={filtroAtivo
            ? 'Ajuste os filtros acima — o período talvez esteja cortando o que você procura.'
            : 'As propostas criadas na aba Negociação de cada lead aparecem aqui.'}
        />
      ) : view === 'pipeline' ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div class="flex gap-3 overflow-x-auto pb-3">
            {PIPELINE_ORDER.map((s) => (
              <PipelineColumn key={s} status={s} rows={byStatus.get(s) ?? []} totals={totalsByStatus.get(s)} onOpen={setEditing} />
            ))}
          </div>
          <DragOverlay>{dragging ? <div class="w-72"><PipelineCard n={dragging} dragging /></div> : null}</DragOverlay>
        </DndContext>
      ) : (
        <Card class="!p-0 overflow-hidden">
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="text-[11px] uppercase tracking-wide text-fg-subtle border-b border-border">
                  <th class="text-left font-medium px-3 py-2">Lead</th>
                  <th class="text-left font-medium px-3 py-2">Proposta</th>
                  <th class="text-left font-medium px-3 py-2">Status</th>
                  <th class="text-right font-medium px-3 py-2">Valores</th>
                  <th class="text-left font-medium px-3 py-2">Responsável</th>
                  <th class="text-left font-medium px-3 py-2">Data</th>
                  <th class="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((n) => {
                  const st = statusOf(n)
                  return (
                    <tr key={n.id} class="border-b border-border/60 last:border-0 hover:bg-surface-2/50 cursor-pointer" onClick={() => setEditing(n)}>
                      <td class="px-3 py-2">
                        <div class="text-fg font-medium truncate max-w-48">{leadLabel(n)}</div>
                        {n.lead?.whatsapp ? <div class="text-[11px] text-fg-subtle">{n.lead.whatsapp}</div> : null}
                      </td>
                      <td class="px-3 py-2">
                        <div class="text-fg-muted truncate max-w-56">{n.titulo}</div>
                        <div class="text-[11px] text-fg-subtle">
                          {n._count?.items ?? 0} item(ns){n._count?.attachments ? ` · ${n._count.attachments} anexo(s)` : ''}
                        </div>
                      </td>
                      <td class="px-3 py-2"><Badge tone={st.tone}>{st.label}</Badge></td>
                      <td class="px-3 py-2"><ValorCell n={n} /></td>
                      <td class="px-3 py-2 text-fg-muted truncate max-w-36">{n.responsavelNome ?? '—'}</td>
                      <td class="px-3 py-2 text-fg-muted whitespace-nowrap">
                        {n.fechadaEm
                          ? <>fechada {new Date(n.fechadaEm).toLocaleDateString('pt-BR')}</>
                          : <>criada {new Date(n.createdAt).toLocaleDateString('pt-BR')}</>}
                      </td>
                      <td class="px-3 py-2 text-right">
                        <button
                          type="button"
                          class="text-fg-subtle hover:text-fg"
                          title="Abrir o lead"
                          onClick={(e) => { e.stopPropagation(); navigate(`/leads/${n.leadId}`) }}
                        >
                          <ExternalLink size={14} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {totalPages > 1 ? (
            <div class="flex items-center justify-between gap-2 px-3 py-2 border-t border-border">
              <span class="text-xs text-fg-subtle">{data?.total} negociações · página {page} de {totalPages}</span>
              <div class="flex gap-1">
                <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Anterior</Button>
                <Button size="sm" variant="ghost" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Próxima</Button>
              </div>
            </div>
          ) : null}
        </Card>
      )}

      {/* A proposta abre aqui — mesmo editor da aba do lead */}
      <Modal
        open={!!editing}
        onOpenChange={(o) => { if (!o) setEditing(null) }}
        title={editing ? `${editing.titulo} — ${leadLabel(editing)}` : ''}
        size="full"
        unconstrained
      >
        {editing ? (
          <div class="space-y-3">
            <button
              type="button"
              class="text-xs text-info hover:underline inline-flex items-center gap-1"
              onClick={() => { const id = editing.leadId; setEditing(null); navigate(`/leads/${id}`) }}
            >
              <ExternalLink size={12} /> Abrir o lead
            </button>
            <NegotiationEditor leadId={editing.leadId} id={editing.id} hideBack onBack={() => { setEditing(null); refetch() }} />
          </div>
        ) : null}
      </Modal>

      <HowItWorksModal
        open={showHowItWorks}
        onClose={() => setShowHowItWorks(false)}
        title="Como funciona o módulo Negociações?"
        problem={<>
          Cada proposta nasce na aba <strong>Negociação</strong> do lead. Esta tela junta todas elas —
          para responder "quanto tem na mesa?", "o que fechou no mês?" e "quanto disso se repete todo mês?"
          sem abrir lead por lead.
        </>}
        steps={[
          {
            title: '💵 Recorrência x pagamento único',
            body: <>Cada item da proposta é marcado como <strong>mensalidade</strong> ou <strong>pagamento único</strong>. Os KPIs nunca somam os dois: uma venda avulsa grande é caixa do mês, não crescimento de receita recorrente.</>,
          },
          {
            title: '📋 Tabela',
            body: <>Todas as propostas do recorte, com valor único e mensalidade em colunas separadas. Ordene por maior valor ou maior mensalidade e exporte em CSV (abre no Excel).</>,
          },
          {
            title: '🗂️ Pipeline',
            body: <>O mesmo recorte em colunas por status. Arraste o card para mover a proposta entre Rascunho, Enviada e Em negociação. <strong>Ganha e perdida não se arrastam</strong>: mexem no desfecho do lead e exigem o motivo da perda, então passam pelo botão "Fechar negociação" dentro da proposta.</>,
          },
          {
            title: '🔎 Filtros e período',
            body: <>Valem para as duas visões. O período usa a data de <strong>fechamento</strong> das propostas fechadas e a de <strong>criação</strong> das abertas — assim o que foi proposto em março e fechado em abril conta em abril.</>,
          },
        ]}
        tip={{
          tone: 'info',
          title: '💡 Onde mais isso aparece',
          body: <>Os mesmos números alimentam a seção <strong>Negociações</strong> da Visão Geral e ficam disponíveis como widgets em <strong>Relatórios › Meus Painéis</strong>.</>,
        }}
      />
    </Page>
  )
}
