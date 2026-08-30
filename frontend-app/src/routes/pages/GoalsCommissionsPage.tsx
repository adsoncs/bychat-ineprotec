// Tela do módulo Metas e Comissões.
//
// Quatro leituras do mesmo mês, na ordem em que a operação usa: onde cada agente
// está contra a meta (Painel), qual é o alvo (Metas), qual a regra que paga
// (Regras) e quanto virou comissão em cada venda (Lançamentos).
//
// Os números não são calculados aqui: vêm do motor que também grava o lançamento,
// e a base é sempre a proposta ganha do módulo Negociações. É isso que garante que
// "receita ganha" nesta tela e na de Negociações seja o mesmo número.

import { useEffect, useMemo, useState } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import {
  Target, HelpCircle, RefreshCw, Download, Plus, Pencil, Trash2,
  ExternalLink, ShieldCheck, AlertTriangle, Check,
} from '@/components/ui/icon-set'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Select } from '@/components/ui/Input'
import { KpiCard } from '@/components/ui/KpiCard'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { HowItWorksModal } from '@/components/ui/HowItWorksModal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { CommissionRuleEditor } from '@/components/CommissionRuleEditor'
import { useFunnels } from '@/hooks/useFunnels'
import { useUsers } from '@/hooks/useUsers'
import { useAuth } from '@/hooks/useAuth'
import {
  METRICS, METRIC_LABEL, METRIC_UNIT,
  useCommissionPanel, useGoals, useSaveGoals, useCopyGoals,
  useCommissionRules, useDeleteCommissionRule,
  useCommissionEntries, usePayCommission, usePayCommissionBatch,
  useRecalcCommissions, useCommissionReconcile,
  type CommissionRule, type GoalInput, type GoalMetric, type MetricProgress, type RateType,
} from '@/hooks/useGoalsCommissions'
import { downloadFile } from '@/lib/download'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/cn'

// ── Formatação ────────────────────────────────────────────────────────────

const num = (v: unknown) => { const n = typeof v === 'number' ? v : parseFloat(String(v ?? '')); return isFinite(n) ? n : 0 }
const money = (v: unknown) => num(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
const moneyExact = (v: unknown) => num(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/** Formata pelo que o indicador É: dinheiro, contagem ou percentual. */
function metricValue(metric: GoalMetric, v: number | null): string {
  if (v == null) return '—'
  if (METRIC_UNIT[metric] === 'currency') return money(v)
  if (METRIC_UNIT[metric] === 'percent') return `${num(v).toFixed(0)}%`
  return String(Math.round(v))
}

function currentPeriod(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
function shiftPeriod(period: string, delta: number): string {
  const [y, m] = period.split('-').map(Number)
  const d = new Date(Date.UTC(y, (m - 1) + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** Barra de atingimento — verde a partir da meta, âmbar perto, cinza longe. */
function GoalBar({ metric, p }: { metric: GoalMetric; p: MetricProgress }) {
  if (p.target == null) {
    return (
      <div class="text-xs">
        <div class="text-fg tabular-nums">{metricValue(metric, p.atual)}</div>
        <div class="text-3xs text-fg-muted">sem meta</div>
      </div>
    )
  }
  const pct = p.atingimento ?? 0
  const tone = pct >= 100 ? 'bg-success' : pct >= 80 ? 'bg-warning' : 'bg-accent'
  return (
    <div class="min-w-32">
      <div class="flex items-baseline justify-between gap-2 text-xs">
        <span class="text-fg tabular-nums">{metricValue(metric, p.atual)}</span>
        <span class="text-3xs text-fg-muted tabular-nums">/ {metricValue(metric, p.target)}</span>
      </div>
      <div class="mt-1 h-1.5 rounded-full bg-surface-3 overflow-hidden">
        <div class={cn('h-full rounded-full', tone)} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      </div>
      <div class={cn('text-3xs tabular-nums mt-0.5', pct >= 100 ? 'text-success' : 'text-fg-muted')}>{pct.toFixed(0)}%</div>
    </div>
  )
}

const rateLabel = (tipo: RateType | null, taxa: unknown, meses = 1) => {
  if (!tipo || tipo === 'none' || taxa == null || taxa === '') return '—'
  const base = tipo === 'percent' ? `${num(taxa).toLocaleString('pt-BR')}%` : moneyExact(taxa)
  return meses > 1 ? `${base} × ${meses}` : base
}

// ── Página ────────────────────────────────────────────────────────────────

type Tab = 'painel' | 'metas' | 'regras' | 'lancamentos'

export function GoalsCommissionsPage() {
  const [, navigate] = useLocation()
  const { user } = useAuth()
  const isManager = ['SUPERADMIN', 'ADMIN', 'MANAGER'].includes(String(user?.role))

  const [tab, setTab] = useState<Tab>('painel')
  const [period, setPeriod] = useState(currentPeriod())
  const [funnelId, setFunnelId] = useState<number | null>(null)
  const [showHow, setShowHow] = useState(false)

  const funnels = useFunnels()
  const users = useUsers()
  const funnelOptions = (funnels.data?.funnels ?? []).filter((f) => f.active)
  const userOptions = (users.data?.users ?? []).map((u) => ({ id: u.id, name: u.name }))

  const panel = useCommissionPanel(period, funnelId)
  const recalc = useRecalcCommissions()

  function runRecalc() {
    recalc.mutate({ period }, {
      onSuccess: (r) => toast(`Recalculado: ${r.negociacoes} venda(s), ${r.agentes} agente(s)`, 'success'),
      onError: () => toast('Falha ao recalcular', 'danger'),
    })
  }

  const abas: { id: Tab; label: string; adminOnly?: boolean }[] = [
    { id: 'painel', label: 'Painel' },
    { id: 'metas', label: 'Metas', adminOnly: true },
    { id: 'regras', label: 'Regras de comissão', adminOnly: true },
    { id: 'lancamentos', label: 'Lançamentos' },
  ]

  return (
    <Page
      title="Metas & Comissões"
      description="A meta de cada agente no funil e a comissão que cada venda gerou — tudo apurado das propostas ganhas em Negociações."
      actions={
        <div class="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setShowHow(true)}><HelpCircle size={14} /> Como funciona?</Button>
          {isManager ? (
            <Button variant="ghost" size="sm" onClick={runRecalc} disabled={recalc.isPending}>
              <RefreshCw size={14} class={recalc.isPending ? 'animate-spin' : ''} /> Recalcular mês
            </Button>
          ) : null}
        </div>
      }
    >
      {/* Recorte: mês e funil valem para todas as abas */}
      <Card class="!p-3">
        <div class="flex flex-wrap items-center gap-2">
          <div class="flex items-center gap-1">
            <button type="button" class="h-8 px-2 rounded-md border border-border bg-surface text-fg-muted hover:text-fg" onClick={() => setPeriod(shiftPeriod(period, -1))} aria-label="Mês anterior">‹</button>
            <input
              type="month" value={period}
              onInput={(e) => setPeriod((e.target as HTMLInputElement).value || currentPeriod())}
              class="h-8 px-2 rounded border border-border bg-surface text-xs text-fg focus:outline-none focus:border-accent"
              aria-label="Competência"
            />
            <button type="button" class="h-8 px-2 rounded-md border border-border bg-surface text-fg-muted hover:text-fg" onClick={() => setPeriod(shiftPeriod(period, 1))} aria-label="Próximo mês">›</button>
          </div>
          <Select value={funnelId ? String(funnelId) : ''} onChange={(e) => setFunnelId(Number((e.target as HTMLSelectElement).value) || null)} class="w-48">
            <option value="">Todos os funis</option>
            {funnelOptions.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </Select>
          {panel.data?.escopoProprio ? <Badge tone="info">Você vê apenas os seus números</Badge> : null}
        </div>
        <p class="text-2xs text-fg-muted mt-2">
          A venda pertence ao mês em que a proposta foi <strong>fechada como ganha</strong> — é a mesma data que o módulo Negociações usa.
        </p>
      </Card>

      {/* Abas */}
      <div class="flex items-center gap-1 border-b border-border">
        {abas.filter((a) => !a.adminOnly || isManager).map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setTab(a.id)}
            class={cn(
              'px-3 py-2 text-sm border-b-2 -mb-px',
              tab === a.id ? 'border-accent text-fg font-medium' : 'border-transparent text-fg-muted hover:text-fg',
            )}
          >{a.label}</button>
        ))}
      </div>

      {tab === 'painel' ? <PainelTab period={period} funnelId={funnelId} /> : null}
      {tab === 'metas' && isManager ? <MetasTab period={period} funnelId={funnelId} users={userOptions} /> : null}
      {tab === 'regras' && isManager ? <RegrasTab funnels={funnelOptions} users={userOptions} /> : null}
      {tab === 'lancamentos' ? <LancamentosTab period={period} funnelId={funnelId} users={userOptions} isManager={isManager} onOpenLead={(id) => navigate(`/leads/${id}`)} /> : null}

      <HowItWorksModal
        open={showHow}
        onClose={() => setShowHow(false)}
        title="Como funciona o módulo Metas & Comissões?"
        problem={<>
          A venda já existe no módulo <strong>Negociações</strong>. Aqui ela vira duas perguntas:
          o agente está no caminho da meta? e quanto essa venda paga de comissão? Nada é digitado de novo —
          se o valor da proposta mudar, a comissão muda junto.
        </>}
        steps={[
          {
            title: '🎯 Metas por funil e por agente',
            body: <>Para cada mês você define o alvo de <strong>receita ganha</strong>, <strong>nova mensalidade</strong>, <strong>nº de vendas</strong> e <strong>taxa de conversão</strong>. A meta pode ser de um agente num funil, do agente somando todos os funis ou da operação inteira (linha “Operação”). Sem meta cadastrada o painel mostra o realizado e não inventa percentual.</>,
          },
          {
            title: '💰 Regras de comissão',
            body: <>A regra diz quanto paga: <strong>percentual ou valor fixo</strong>, com taxa separada para o <strong>pagamento único</strong> e para a <strong>mensalidade</strong> (e quantas mensalidades entram). O escopo é o par funil + agentes: sem agente marcado vale para todos, e marcar alguém cria a exceção daquela pessoa, que passa na frente da regra geral.</>,
          },
          {
            title: '🚀 Acelerador',
            body: <>Opcional: faixas por atingimento (ex.: até 79% paga 3%, de 80% a 99% paga 5%, a partir de 100% paga 7%). A faixa alcançada vale para <strong>tudo o que o agente fechou no mês</strong> — por isso fechar uma venda nova recalcula o mês inteiro dele.</>,
          },
          {
            title: '🧾 Lançamentos',
            body: <>Cada proposta ganha gera um lançamento com a fotografia da taxa aplicada. Reabrir a proposta desfaz o lançamento; comissão já marcada como <strong>paga</strong> não é reescrita — vira “cancelada”, para o histórico não perder o que já saiu do caixa. Dá para marcar pagas em lote e exportar em CSV.</>,
          },
          {
            title: '🛡 Conferência',
            body: <>A aba Lançamentos tem a <strong>conferência do mês</strong>: venda ganha sem responsável, venda sem regra aplicável, valor lançado diferente do recalculado e lançamento de proposta que não está mais ganha. É a prova de que os dois módulos estão contando a mesma coisa.</>,
          },
        ]}
        tip={{
          tone: 'info',
          title: '💡 Comissão à vista do vendedor',
          body: <>Dentro da proposta (aba <strong>Negociação</strong> do lead) aparece a comissão estimada com a regra que se aplica àquele agente — ele vê na hora quanto um desconto custa no bolso dele.</>,
        }}
      />
    </Page>
  )
}

// ── Aba: Painel ───────────────────────────────────────────────────────────

function PainelTab({ period, funnelId }: { period: string; funnelId: number | null }) {
  const { data, isLoading } = useCommissionPanel(period, funnelId)
  const op = data?.operacao

  if (isLoading) {
    return <div class="space-y-2"><Skeleton class="h-24 w-full" /><Skeleton class="h-64 w-full" /></div>
  }

  return (
    <div class="space-y-3">
      <div class="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Receita ganha" value={money(op?.realizado.revenue ?? 0)} hint={`${op?.realizado.count ?? 0} venda(s) no mês`} />
        <KpiCard label="Nova mensalidade" value={`${money(op?.realizado.mrr ?? 0)}/mês`} hint="MRR fechado no período" />
        <KpiCard label="Comissão prevista" value={money(op?.comissao.prevista ?? 0)} hint={`${op?.comissao.lancamentos ?? 0} lançamento(s)`} />
        <KpiCard label="Comissão paga" value={money(op?.comissao.paga ?? 0)} hint="já quitada com os agentes" />
      </div>

      <Card class="!p-0 overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-2xs uppercase tracking-wide text-fg-muted border-b border-border">
                <th class="text-left font-medium px-3 py-2">Agente</th>
                <th class="text-left font-medium px-3 py-2">Regra</th>
                {METRICS.map((m) => <th key={m} class="text-left font-medium px-3 py-2">{METRIC_LABEL[m]}</th>)}
                <th class="text-right font-medium px-3 py-2">Comissão</th>
              </tr>
            </thead>
            <tbody>
              {(data?.agentes ?? []).map((a) => (
                <tr key={a.userId} class="border-b border-border/60 last:border-0">
                  <td class="px-3 py-2">
                    <div class="text-fg font-medium truncate max-w-44">{a.nome}</div>
                    {!a.active ? <Badge tone="warning">inativo</Badge> : null}
                  </td>
                  <td class="px-3 py-2">
                    {a.regra
                      ? <span class="text-xs text-fg-muted" title={a.regra.aceleradorAtivo ? 'Com acelerador por meta' : undefined}>
                          {a.regra.nome}{a.regra.aceleradorAtivo ? ' ⚡' : ''}
                        </span>
                      : <span class="text-xs text-fg-muted">sem regra</span>}
                  </td>
                  {METRICS.map((m) => (
                    <td key={m} class="px-3 py-2"><GoalBar metric={m} p={a.metas[m]} /></td>
                  ))}
                  <td class="px-3 py-2 text-right tabular-nums">
                    <div class="text-fg">{moneyExact(a.comissao.prevista)}</div>
                    {a.comissao.paga > 0 ? <div class="text-2xs text-success">{moneyExact(a.comissao.paga)} paga</div> : null}
                  </td>
                </tr>
              ))}
              {op ? (
                <tr class="bg-surface-2/50 font-medium">
                  <td class="px-3 py-2 text-fg">Operação</td>
                  <td class="px-3 py-2 text-xs text-fg-muted">meta da empresa</td>
                  {METRICS.map((m) => <td key={m} class="px-3 py-2"><GoalBar metric={m} p={op.metas[m]} /></td>)}
                  <td class="px-3 py-2 text-right tabular-nums text-fg">{moneyExact(op.comissao.prevista)}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>

      {(data?.agentes ?? []).length === 0 ? (
        <EmptyState icon={Target} title="Nenhum agente no recorte" description="Cadastre metas na aba Metas ou registre vendas no módulo Negociações." />
      ) : null}
    </div>
  )
}

// ── Aba: Metas ────────────────────────────────────────────────────────────

function MetasTab({ period, funnelId, users }: { period: string; funnelId: number | null; users: { id: number; name: string }[] }) {
  const { data, isLoading } = useGoals(period, funnelId)
  const save = useSaveGoals()
  const copy = useCopyGoals()
  // Chave da célula: agente (0 = operação) + indicador. O funil é o do recorte —
  // a grade edita sempre o funil que está selecionado no topo.
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [dirty, setDirty] = useState(false)

  const gravadas = useMemo(() => {
    const map: Record<string, string> = {}
    for (const g of data?.goals ?? []) {
      if ((g.funnelId ?? null) !== funnelId) continue
      map[`${g.userId ?? 0}:${g.metric}`] = String(num(g.target))
    }
    return map
  }, [data, funnelId])

  useEffect(() => { setDraft(gravadas); setDirty(false) }, [gravadas])

  const valueOf = (userId: number, metric: GoalMetric) => draft[`${userId}:${metric}`] ?? ''
  function setValue(userId: number, metric: GoalMetric, v: string) {
    setDraft((cur) => ({ ...cur, [`${userId}:${metric}`]: v }))
    setDirty(true)
  }

  function submit() {
    const goals: GoalInput[] = []
    for (const u of [{ id: 0, name: 'Operação' }, ...users]) {
      for (const m of METRICS) {
        const raw = valueOf(u.id, m)
        goals.push({
          userId: u.id === 0 ? null : u.id,
          funnelId,
          metric: m,
          target: raw === '' ? null : Number(raw),
        })
      }
    }
    save.mutate({ period, goals }, {
      onSuccess: (r) => { toast(`${r.gravadas} meta(s) salva(s)`, 'success'); setDirty(false) },
      onError: () => toast('Falha ao salvar as metas', 'danger'),
    })
  }

  function copiarMesAnterior() {
    copy.mutate({ from: shiftPeriod(period, -1), to: period }, {
      onSuccess: (r) => toast(`${r.copiadas} meta(s) copiada(s) do mês anterior`, 'success'),
      onError: () => toast('Falha ao copiar', 'danger'),
    })
  }

  if (isLoading) return <Skeleton class="h-64 w-full" />

  return (
    <div class="space-y-3">
      <Card class="!p-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <p class="text-xs text-fg-muted">
            Grade de <strong>{period}</strong>{funnelId ? ' neste funil' : ' somando todos os funis'}.
            Campo vazio = <strong>sem meta</strong> (o painel mostra o realizado e não calcula percentual).
          </p>
          <div class="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={copiarMesAnterior} disabled={copy.isPending}>Copiar do mês anterior</Button>
            <Button size="sm" onClick={submit} disabled={!dirty || save.isPending}>{save.isPending ? 'Salvando…' : 'Salvar metas'}</Button>
          </div>
        </div>
      </Card>

      <Card class="!p-0 overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-2xs uppercase tracking-wide text-fg-muted border-b border-border">
                <th class="text-left font-medium px-3 py-2">Agente</th>
                {METRICS.map((m) => (
                  <th key={m} class="text-left font-medium px-3 py-2">
                    {METRIC_LABEL[m]}
                    <span class="block normal-case text-3xs text-fg-muted">
                      {METRIC_UNIT[m] === 'currency' ? 'R$' : METRIC_UNIT[m] === 'percent' ? '%' : 'quantidade'}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[{ id: 0, name: 'Operação (meta da empresa)' }, ...users].map((u) => (
                <tr key={u.id} class={cn('border-b border-border/60 last:border-0', u.id === 0 ? 'bg-surface-2/50' : '')}>
                  <td class="px-3 py-2 text-fg truncate max-w-52">{u.name}</td>
                  {METRICS.map((m) => (
                    <td key={m} class="px-3 py-2">
                      <input
                        type="number" min="0" step={METRIC_UNIT[m] === 'count' ? '1' : '0.01'}
                        value={valueOf(u.id, m)}
                        onInput={(e) => setValue(u.id, m, (e.target as HTMLInputElement).value)}
                        placeholder="—"
                        class="h-8 w-28 px-2 rounded border border-border bg-surface text-xs text-fg tabular-nums focus:outline-none focus:border-accent"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

// ── Aba: Regras ───────────────────────────────────────────────────────────

function RegrasTab({ funnels, users }: { funnels: { id: number; name: string }[]; users: { id: number; name: string }[] }) {
  const { data, isLoading } = useCommissionRules()
  const del = useDeleteCommissionRule()
  const [editing, setEditing] = useState<CommissionRule | null>(null)
  const [creating, setCreating] = useState(false)
  const [confirmDel, setConfirmDel] = useState<CommissionRule | null>(null)

  if (isLoading) return <Skeleton class="h-64 w-full" />
  const rules = data?.rules ?? []

  return (
    <div class="space-y-3">
      <div class="flex justify-end">
        <Button size="sm" onClick={() => { setEditing(null); setCreating(true) }}><Plus size={14} /> Nova regra</Button>
      </div>

      {rules.length === 0 ? (
        <EmptyState
          icon={Target}
          title="Nenhuma regra de comissão"
          description="Sem regra, venda ganha não gera comissão. Crie uma regra geral (sem funil e sem agente) e depois as exceções."
        />
      ) : (
        <Card class="!p-0 overflow-hidden">
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="text-2xs uppercase tracking-wide text-fg-muted border-b border-border">
                  <th class="text-left font-medium px-3 py-2">Regra</th>
                  <th class="text-left font-medium px-3 py-2">Vale para</th>
                  <th class="text-left font-medium px-3 py-2">Pagamento único</th>
                  <th class="text-left font-medium px-3 py-2">Mensalidade</th>
                  <th class="text-left font-medium px-3 py-2">Acelerador</th>
                  <th class="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id} class="border-b border-border/60 last:border-0">
                    <td class="px-3 py-2">
                      <div class="text-fg font-medium">{r.nome}</div>
                      <div class="text-2xs text-fg-muted">
                        base {r.base === 'bruto' ? 'de tabela' : 'negociada'}
                        {r.prioridade ? ` · prioridade ${r.prioridade}` : ''}
                      </div>
                      {!r.active ? <Badge tone="warning">inativa</Badge> : null}
                    </td>
                    <td class="px-3 py-2 text-xs text-fg-muted">
                      <div>{r.funnelName ?? 'Qualquer funil'}</div>
                      <div class="text-fg-muted">
                        {r.agentNames.length ? r.agentNames.join(', ') : 'Todos os agentes'}
                      </div>
                    </td>
                    <td class="px-3 py-2 text-fg-muted tabular-nums">{rateLabel(r.tipoUnico, r.taxaUnico)}</td>
                    <td class="px-3 py-2 text-fg-muted tabular-nums">{rateLabel(r.tipoRecorrente, r.taxaRecorrente, r.mesesRecorrente)}</td>
                    <td class="px-3 py-2 text-xs">
                      {r.aceleradorAtivo && r.aceleradorMetrica
                        ? <span class="text-fg-muted">{METRIC_LABEL[r.aceleradorMetrica]} · {r.tiers.length} faixa(s)</span>
                        : <span class="text-fg-muted">—</span>}
                    </td>
                    <td class="px-3 py-2 text-right whitespace-nowrap">
                      <button type="button" class="text-fg-muted hover:text-fg mr-2" title="Editar" onClick={() => { setCreating(false); setEditing(r) }}><Pencil size={14} /></button>
                      <button type="button" class="text-fg-muted hover:text-danger" title="Excluir" onClick={() => setConfirmDel(r)}><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <CommissionRuleEditor
        open={creating || !!editing}
        rule={editing}
        funnels={funnels}
        users={users}
        onClose={() => { setCreating(false); setEditing(null) }}
      />

      <ConfirmDialog
        open={!!confirmDel}
        onOpenChange={(o) => { if (!o) setConfirmDel(null) }}
        title="Excluir regra de comissão?"
        description={`"${confirmDel?.nome ?? ''}" deixa de valer para novas vendas. Os lançamentos já calculados continuam existindo — comissão apurada é histórico.`}
        confirmLabel="Excluir"
        destructive
        loading={del.isPending}
        onConfirm={() => {
          if (!confirmDel) return
          del.mutate(confirmDel.id, {
            onSuccess: () => { toast('Regra excluída', 'success'); setConfirmDel(null) },
            onError: () => toast('Falha ao excluir', 'danger'),
          })
        }}
      />
    </div>
  )
}

// ── Aba: Lançamentos ──────────────────────────────────────────────────────

function LancamentosTab({ period, funnelId, users, isManager, onOpenLead }: {
  period: string
  funnelId: number | null
  users: { id: number; name: string }[]
  isManager: boolean
  onOpenLead: (leadId: number) => void
}) {
  const [status, setStatus] = useState('')
  const [userId, setUserId] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<number[]>([])
  const [showCheck, setShowCheck] = useState(false)

  useEffect(() => { setPage(1); setSelected([]) }, [period, funnelId, status, userId])

  const params = { period, funnelId, status: status || undefined, userId: userId || undefined, page, limit: 50 }
  const { data, isLoading } = useCommissionEntries(params)
  const pay = usePayCommission()
  const payBatch = usePayCommissionBatch()
  const check = useCommissionReconcile(period, showCheck && isManager)

  const rows = data?.entries ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / 50))

  function toggle(id: number) {
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
  }

  function exportCsv() {
    const qs = new URLSearchParams({ period, format: 'csv' })
    if (funnelId) qs.set('funnelId', String(funnelId))
    if (status) qs.set('status', status)
    if (userId) qs.set('userId', String(userId))
    downloadFile(`/admin/commissions/entries?${qs.toString()}`, `comissoes-${period}.csv`)
      .catch(() => toast('Falha ao exportar', 'danger'))
  }

  return (
    <div class="space-y-3">
      <div class="grid gap-3 grid-cols-2 lg:grid-cols-3">
        <KpiCard label="Previstas" value={money(data?.kpis.prevista.valor ?? 0)} hint={`${data?.kpis.prevista.count ?? 0} lançamento(s)`} loading={isLoading} />
        <KpiCard label="Pagas" value={money(data?.kpis.paga.valor ?? 0)} hint={`${data?.kpis.paga.count ?? 0} lançamento(s)`} loading={isLoading} />
        <KpiCard label="Canceladas" value={money(data?.kpis.cancelada.valor ?? 0)} hint="vendas desfeitas depois de pagas" loading={isLoading} />
      </div>

      <Card class="!p-3">
        <div class="flex flex-wrap items-center gap-2">
          <Select value={status} onChange={(e) => setStatus((e.target as HTMLSelectElement).value)} class="w-44">
            <option value="">Todos os status</option>
            <option value="prevista">Previstas</option>
            <option value="paga">Pagas</option>
            <option value="cancelada">Canceladas</option>
          </Select>
          {isManager ? (
            <Select value={userId} onChange={(e) => setUserId((e.target as HTMLSelectElement).value)} class="w-52">
              <option value="">Todos os agentes</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          ) : null}
          <Button variant="ghost" size="sm" onClick={exportCsv}><Download size={14} /> Exportar</Button>
          {isManager ? (
            <Button variant="ghost" size="sm" onClick={() => setShowCheck((v) => !v)}>
              <ShieldCheck size={14} /> {showCheck ? 'Ocultar conferência' : 'Conferir o mês'}
            </Button>
          ) : null}
          {isManager && selected.length ? (
            <Button size="sm" onClick={() => payBatch.mutate({ ids: selected, paga: true }, {
              onSuccess: (r) => { toast(`${r.count} comissão(ões) marcada(s) como paga(s)`, 'success'); setSelected([]) },
              onError: () => toast('Falha ao marcar', 'danger'),
            })} disabled={payBatch.isPending}>
              <Check size={14} /> Marcar {selected.length} como paga(s)
            </Button>
          ) : null}
        </div>
      </Card>

      {showCheck && isManager ? (
        <Card>
          <div class="flex items-center gap-2 mb-2">
            <ShieldCheck size={16} class="text-fg-muted" />
            <h3 class="text-sm font-medium text-fg">Conferência de {period}</h3>
          </div>
          {check.isLoading ? <Skeleton class="h-16 w-full" /> : (check.data?.total ?? 0) === 0 ? (
            <p class="text-xs text-success">Nenhuma divergência: toda venda ganha do mês tem lançamento e todo lançamento bate com o valor recalculado.</p>
          ) : (
            <ul class="space-y-1.5">
              {(check.data?.divergencias ?? []).map((d, i) => (
                <li key={i} class="flex items-start gap-2 text-xs">
                  <AlertTriangle size={14} class="text-warning shrink-0 mt-0.5" />
                  <span class="text-fg-muted">
                    <strong class="text-fg">{d.titulo ?? `Negociação #${d.negotiationId}`}</strong> — {d.detalhe}
                    {d.leadId ? (
                      <button type="button" class="ml-2 text-info hover:underline inline-flex items-center gap-1" onClick={() => onOpenLead(d.leadId!)}>
                        <ExternalLink size={11} /> abrir o lead
                      </button>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      {isLoading ? (
        <Skeleton class="h-64 w-full" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Target}
          title="Nenhuma comissão neste mês"
          description="Lançamentos aparecem quando uma proposta é fechada como Ganha e existe regra aplicável ao agente."
        />
      ) : (
        <Card class="!p-0 overflow-hidden">
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="text-2xs uppercase tracking-wide text-fg-muted border-b border-border">
                  {isManager ? <th class="px-3 py-2 w-8" /> : null}
                  <th class="text-left font-medium px-3 py-2">Fechada</th>
                  <th class="text-left font-medium px-3 py-2">Agente</th>
                  <th class="text-left font-medium px-3 py-2">Venda</th>
                  <th class="text-right font-medium px-3 py-2">Base</th>
                  <th class="text-left font-medium px-3 py-2">Taxa</th>
                  <th class="text-right font-medium px-3 py-2">Comissão</th>
                  <th class="text-left font-medium px-3 py-2">Status</th>
                  <th class="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id} class="border-b border-border/60 last:border-0">
                    {isManager ? (
                      <td class="px-3 py-2">
                        <input type="checkbox" checked={selected.includes(e.id)} onChange={() => toggle(e.id)} disabled={e.status !== 'prevista'} />
                      </td>
                    ) : null}
                    <td class="px-3 py-2 text-fg-muted whitespace-nowrap">{new Date(e.fechadaEm).toLocaleDateString('pt-BR')}</td>
                    <td class="px-3 py-2 text-fg truncate max-w-36">{e.agenteNome ?? '—'}</td>
                    <td class="px-3 py-2">
                      <div class="text-fg-muted truncate max-w-52">{e.negociacaoTitulo ?? `Negociação #${e.negotiationId}`}</div>
                      <div class="text-2xs text-fg-muted truncate max-w-52">{e.leadNome}</div>
                    </td>
                    <td class="px-3 py-2 text-right tabular-nums">
                      <div class="text-xs text-fg">{num(e.baseUnico) > 0 ? moneyExact(e.baseUnico) : '—'}</div>
                      {num(e.baseRecorrente) > 0 ? <div class="text-2xs text-accent">+ {moneyExact(e.baseRecorrente)}/mês</div> : null}
                    </td>
                    <td class="px-3 py-2 text-xs text-fg-muted whitespace-nowrap">
                      <div>{rateLabel(e.tipoUnico, e.taxaUnico)}</div>
                      {num(e.baseRecorrente) > 0 ? <div>{rateLabel(e.tipoRecorrente, e.taxaRecorrente, e.mesesRecorrente)}</div> : null}
                      {e.atingimento != null ? <div class="text-3xs text-fg-muted">faixa a {num(e.atingimento).toFixed(0)}% da meta</div> : null}
                    </td>
                    <td class="px-3 py-2 text-right tabular-nums text-fg font-medium">{moneyExact(e.valorTotal)}</td>
                    <td class="px-3 py-2">
                      <Badge tone={e.status === 'paga' ? 'success' : e.status === 'cancelada' ? 'danger' : 'neutral'}>
                        {e.status === 'paga' ? 'Paga' : e.status === 'cancelada' ? 'Cancelada' : 'Prevista'}
                      </Badge>
                    </td>
                    <td class="px-3 py-2 text-right whitespace-nowrap">
                      {isManager && e.status !== 'cancelada' ? (
                        <button
                          type="button"
                          class="text-xs text-info hover:underline mr-2"
                          onClick={() => pay.mutate({ id: e.id, paga: e.status !== 'paga' }, {
                            onSuccess: () => toast(e.status === 'paga' ? 'Comissão voltou para prevista' : 'Comissão marcada como paga', 'success'),
                            onError: () => toast('Falha ao atualizar', 'danger'),
                          })}
                        >{e.status === 'paga' ? 'Desfazer' : 'Marcar paga'}</button>
                      ) : null}
                      <button type="button" class="text-fg-muted hover:text-fg" title="Abrir o lead" onClick={() => onOpenLead(e.leadId)}>
                        <ExternalLink size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div class="flex items-center justify-between gap-2 px-3 py-2 border-t border-border text-xs">
            <span class="text-fg-muted">Mostrando {rows.length} de <span class="tabular-nums">{total}</span> lançamento(s)</span>
            <div class="flex items-center gap-1">
              <button type="button" class="h-7 px-2 rounded-md border border-border bg-surface text-fg-muted hover:text-fg disabled:opacity-40" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹</button>
              <span class="px-2 tabular-nums text-fg-muted">{page}/{totalPages}</span>
              <button type="button" class="h-7 px-2 rounded-md border border-border bg-surface text-fg-muted hover:text-fg disabled:opacity-40" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>›</button>
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}
