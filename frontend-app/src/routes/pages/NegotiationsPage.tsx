// Tela do módulo Negociações: todas as propostas da operação num lugar só.
//
// Uma tabela — analisar, comparar, exportar. A coluna de situação mostra a ETAPA
// do funil em que o lead está (mais o selo Ganho/Perdido quando há desfecho); o
// quadro por status da proposta foi removido justamente porque duas noções de
// "etapa" na mesma tela confundiam quem lê. Os KPIs no topo separam recorrência
// de pagamento único, pela mesma razão da Visão Geral: venda avulsa não é
// crescimento de MRR.
//
// A proposta abre num modal com o editor da aba do lead (`NegotiationEditor`) —
// é a mesma proposta, mudou só de onde se chega nela.

import { useEffect, useMemo, useState } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import { Handshake, Download, RefreshCw, ExternalLink, HelpCircle } from 'lucide-preact'
import {
  useNegotiationsOverview, negotiationsOverviewQuery,
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

/** Opções de itens por página — a escolha fica salva por navegador. */
const PAGE_SIZES = [25, 50, 100, 200]
const DEFAULT_PAGE_SIZE = 50

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

/** Desfecho a exibir: o desta proposta manda; na proposta ainda aberta vale o
 * do LEAD (fechado por outra proposta ou pelos botões Ganho/Perdido do lead). */
function outcomeOf(n: NegotiationRow): 'won' | 'lost' | null {
  return n.resultado ?? n.lead?.outcome ?? null
}

/**
 * Situação do lead: a ETAPA do funil em que ele está (nome e cor configurados
 * no funil) e, quando existe desfecho, o selo Ganho/Perdido ao lado.
 *
 * A etapa vem do lead, não da proposta: quem olha a lista quer saber onde o
 * negócio está na operação, e o status interno da proposta (rascunho/enviada)
 * não é um segundo funil — ele mora dentro do editor da proposta.
 */
function StageCell({ n }: { n: NegotiationRow }) {
  const stage = n.lead?.stageName || n.lead?.status || null
  const outcome = outcomeOf(n)
  return (
    <div class="flex items-center gap-1.5 flex-wrap">
      {stage ? (
        <span class="inline-flex items-center gap-1.5 max-w-40" title={stage}>
          <span class="size-2 rounded-full shrink-0" style={{ background: n.lead?.stageColor || 'var(--color-accent)' }} />
          <span class="text-xs text-fg-muted truncate">{stage}</span>
        </span>
      ) : <span class="text-xs text-fg-subtle">—</span>}
      {outcome ? <Badge tone={outcome === 'won' ? 'success' : 'danger'}>{outcome === 'won' ? 'Ganho' : 'Perdido'}</Badge> : null}
    </div>
  )
}

// ── Paginação ─────────────────────────────────────────────────────────────

/**
 * Rodapé da tabela: quantas linhas estão à vista, atalho para qualquer página e
 * o tamanho da página.
 *
 * Com muita proposta, "Anterior/Próxima" obriga a clicar dezenas de vezes para
 * chegar ao fim — então os números aparecem com reticências (1 … 7 8 9 … 42) e
 * há salto direto para a primeira e a última. Mesmo padrão do rodapé de Leads.
 */
function TableFooter({ total, limit, page, onChangePage, onChangeLimit }: {
  total: number
  limit: number
  page: number
  onChangePage: (p: number) => void
  onChangeLimit: (n: number) => void
}) {
  const totalPages = Math.max(1, Math.ceil(total / limit))
  const from = total === 0 ? 0 : (page - 1) * limit + 1
  const to = Math.min(page * limit, total)

  // Sempre a primeira, a última e a vizinhança da atual — o resto vira "…".
  const items = useMemo(() => {
    const set = new Set<number>([1, totalPages, page, page - 1, page + 1, page - 2, page + 2])
    const visible = [...set].filter((n) => n >= 1 && n <= totalPages).sort((a, b) => a - b)
    const out: ({ kind: 'page'; n: number } | { kind: 'gap' })[] = []
    let prev = 0
    for (const n of visible) {
      if (n - prev > 1) out.push({ kind: 'gap' })
      out.push({ kind: 'page', n })
      prev = n
    }
    return out
  }, [page, totalPages])

  const navBtn = 'h-7 px-2 rounded-md border border-border bg-surface text-fg-muted hover:text-fg hover:bg-surface-3 disabled:opacity-40 disabled:hover:bg-surface'

  return (
    <div class="flex items-center justify-between gap-2 px-3 py-2 border-t border-border text-xs flex-wrap">
      <span class="text-fg-muted">
        Mostrando <span class="text-fg tabular-nums">{from}</span>–<span class="text-fg tabular-nums">{to}</span> de <span class="text-fg tabular-nums">{total}</span> negociação(ões)
      </span>
      <div class="flex items-center gap-1 flex-wrap">
        <button type="button" class={navBtn} onClick={() => onChangePage(1)} disabled={page <= 1} aria-label="Primeira página">«</button>
        <button type="button" class={navBtn} onClick={() => onChangePage(page - 1)} disabled={page <= 1} aria-label="Página anterior">‹</button>
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
              onClick={() => onChangePage(it.n)}
              aria-current={it.n === page ? 'page' : undefined}
            >{it.n}</button>
          ),
        )}
        <button type="button" class={navBtn} onClick={() => onChangePage(page + 1)} disabled={page >= totalPages} aria-label="Próxima página">›</button>
        <button type="button" class={navBtn} onClick={() => onChangePage(totalPages)} disabled={page >= totalPages} aria-label="Última página">»</button>
        <select
          class="h-7 ml-2 px-2 rounded-md border border-border bg-surface text-xs text-fg cursor-pointer focus:outline-none focus:border-accent"
          value={limit}
          onChange={(e) => onChangeLimit(Number((e.target as HTMLSelectElement).value))}
          aria-label="Itens por página"
        >
          {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}/pág</option>)}
        </select>
      </div>
    </div>
  )
}

// ── Página ────────────────────────────────────────────────────────────────

export function NegotiationsPage() {
  const [, navigate] = useLocation()
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [resultado, setResultado] = useState('')
  const [funnelId, setFunnelId] = useState<number | null>(null)
  // '' = todos · 'none' = leads sem dono · id = um responsável.
  // O responsável é sempre o do LEAD (o backend resolve; ver routes/negotiations).
  const [responsavel, setResponsavel] = useState('')
  const [cobranca, setCobranca] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [orderBy, setOrderBy] = useState('recent')
  const [page, setPage] = useState(1)
  // Tamanho da página é preferência de quem opera (tela grande aguenta 100+),
  // então fica no navegador — recarregar não devolve para o padrão.
  const [limit, setLimit] = useState<number>(() => {
    const saved = Number(localStorage.getItem('negotiations.pageSize'))
    return PAGE_SIZES.includes(saved) ? saved : DEFAULT_PAGE_SIZE
  })
  const [editing, setEditing] = useState<NegotiationRow | null>(null)
  const [showHowItWorks, setShowHowItWorks] = useState(false)

  const funnels = useFunnels()
  const users = useUsers()

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300)
    return () => clearTimeout(t)
  }, [searchInput])
  // Trocar o recorte invalida a página atual: a 7 do filtro anterior pode nem
  // existir no novo.
  useEffect(() => { setPage(1) }, [search, resultado, funnelId, responsavel, cobranca, dateFrom, dateTo, orderBy])

  function changeLimit(n: number) {
    // Volta para a 1 no MESMO render — deixar isso para um efeito faria a tela
    // buscar a página antiga com o tamanho novo antes de se corrigir.
    setLimit(n)
    setPage(1)
    try { localStorage.setItem('negotiations.pageSize', String(n)) } catch { /* ignore */ }
  }

  const params: NegotiationsOverviewParams = {
    page,
    limit,
    q: search || undefined,
    resultado: resultado || undefined,
    funnelId: funnelId ?? undefined,
    responsavelUserId: responsavel || undefined,
    cobranca: cobranca || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    orderBy,
  }
  const { data, isLoading, isFetching, refetch } = useNegotiationsOverview(params)
  const rows = data?.negotiations ?? []
  const kpis = data?.kpis
  const total = data?.total ?? 0

  // Página órfã: fechar/apagar propostas (ou um recorte que encolheu) pode deixar
  // a página atual além do fim. Aí a lista vem vazia e a tela cairia no "nenhuma
  // negociação" — com o rodapé fora da tela, sem caminho de volta. Volta sozinha
  // para a última página que existe.
  useEffect(() => {
    if (!data) return
    const lastPage = Math.max(1, Math.ceil(total / limit))
    if (page > lastPage) setPage(lastPage)
  }, [data, total, limit, page])

  function exportCsv() {
    const qs = negotiationsOverviewQuery({ ...params, page: 1, limit: 200 })
    downloadFile(`/admin/negotiations/overview?${qs}&format=csv`, 'negociacoes.csv')
      .catch(() => toast('Falha ao exportar', 'danger'))
  }

  const filtroAtivo = !!(search || resultado || funnelId || responsavel || cobranca || dateFrom || dateTo)

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

      {/* Filtros */}
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
          <Select value={responsavel} onChange={(e) => setResponsavel((e.target as HTMLSelectElement).value)} class="w-52">
            <option value="">Todos os responsáveis</option>
            <option value="none">Sem responsável</option>
            {(users.data?.users ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
          <div class="flex items-center gap-1">
            <input type="date" value={dateFrom} max={dateTo || undefined} onInput={(e) => setDateFrom((e.target as HTMLInputElement).value)}
              class="h-8 px-2 rounded border border-border bg-surface text-xs text-fg focus:outline-none focus:border-accent" aria-label="Data inicial" />
            <span class="text-xs text-fg-subtle">até</span>
            <input type="date" value={dateTo} min={dateFrom || undefined} onInput={(e) => setDateTo((e.target as HTMLInputElement).value)}
              class="h-8 px-2 rounded border border-border bg-surface text-xs text-fg focus:outline-none focus:border-accent" aria-label="Data final" />
          </div>
          <Select value={orderBy} onChange={(e) => setOrderBy((e.target as HTMLSelectElement).value)} class="w-40">
            <option value="recent">Mais recentes</option>
            <option value="oldest">Mais antigas</option>
            <option value="value">Maior valor</option>
            <option value="mrr">Maior mensalidade</option>
          </Select>
          {filtroAtivo ? (
            <Button variant="ghost" size="sm" onClick={() => {
              setSearchInput(''); setSearch(''); setResultado(''); setFunnelId(null)
              setResponsavel(''); setCobranca(''); setDateFrom(''); setDateTo('')
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
      ) : (
        <Card class="!p-0 overflow-hidden">
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="text-[11px] uppercase tracking-wide text-fg-subtle border-b border-border">
                  <th class="text-left font-medium px-3 py-2">Lead</th>
                  <th class="text-left font-medium px-3 py-2">Proposta</th>
                  <th class="text-left font-medium px-3 py-2">Etapa do funil</th>
                  <th class="text-right font-medium px-3 py-2">Valores</th>
                  <th class="text-left font-medium px-3 py-2">Responsável</th>
                  <th class="text-left font-medium px-3 py-2">Data</th>
                  <th class="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((n) => (
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
                      <td class="px-3 py-2"><StageCell n={n} /></td>
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
                ))}
              </tbody>
            </table>
          </div>
          {/* O rodapé fica mesmo com uma página só: é onde se troca o tamanho
              da página e onde se lê quantas propostas o recorte tem. */}
          <TableFooter total={total} limit={limit} page={page} onChangePage={setPage} onChangeLimit={changeLimit} />
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
            <NegotiationEditor leadId={editing.leadId} id={editing.id} hideBack onBack={() => { setEditing(null); void refetch() }} />
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
            body: <>Todas as propostas do recorte, com valor único e mensalidade em colunas separadas. A coluna <strong>Etapa do funil</strong> mostra onde o lead está agora — e o selo <strong>Ganho</strong>/<strong>Perdido</strong> aparece quando já existe desfecho. Ordene por maior valor ou maior mensalidade e exporte em CSV (abre no Excel).</>,
          },
          {
            title: '🔎 Filtros e período',
            body: <>O período usa a data de <strong>fechamento</strong> das propostas fechadas e a de <strong>criação</strong> das abertas — assim o que foi proposto em março e fechado em abril conta em abril.</>,
          },
          {
            title: '📄 Paginação',
            body: <>O rodapé mostra quantas propostas o recorte tem e leva direto a qualquer página (inclusive a primeira e a última). O seletor <strong>25/50/100/200 por página</strong> fica guardado neste navegador. Para ganhar/perder uma proposta, abra-a e use "Fechar negociação" — é lá que se registra o motivo da perda.</>,
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
