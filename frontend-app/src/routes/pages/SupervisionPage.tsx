// SupervisionPage — painel gerencial do Conversas.
//
// A tela responde, em ordem: como está a operação AGORA (baldes + KPIs), onde
// a carga está concentrada (distribuições) e o que fazer a respeito (lista com
// ações). Os dados são os mesmos leads da inbox — a diferença é que aqui não há
// recorte por operador.
//
// Atualização: o WebSocket invalida ['supervision'] (ver lib/realtime.ts); o
// refetchInterval dos hooks é só a rede de segurança para telão parado.

import { useMemo, useState } from 'preact/hooks'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  CornerUpLeft,
  Inbox, Headphones, Clock, CheckCircle2, Bot, User as UserIcon, AlertTriangle,
  RefreshCw, MessageSquare, ExternalLink, Users2, Filter, X, MoreHorizontal,
} from '@/components/ui/icon-set'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { PeriodPicker, PeriodIncompleteHint, usePeriod, periodLabel } from '@/components/ui/PeriodPicker'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { KpiCard } from '@/components/ui/KpiCard'
import { toast } from '@/lib/toast'
import {
  useSupervisionOverview, useSupervisionConversations, useSupervisionFilterOptions,
  useSupervisionClose, useSupervisionReopen, useSupervisionResumeBot,
  useSupervisionAssign, useSupervisionSnooze,
  type SupervisionConversation, type SupervisionFilters, type BotState,
} from '@/hooks/useSupervision'

// Selects seguem o mesmo desenho dos demais da base (LeadsPage/ActivitiesPage).
const SELECT_CLS = 'w-full h-9 rounded-md border border-border bg-surface px-2 text-sm text-fg'

const BUCKETS = [
  { id: 'active', label: 'Ativas', icon: Headphones },
  { id: 'raw', label: 'Caixa', icon: Inbox },
  { id: 'inbox', label: 'Atendimento', icon: MessageSquare },
  { id: 'snoozed', label: 'Aguardando', icon: Clock },
  { id: 'resolved', label: 'Resolvidos', icon: CheckCircle2 },
] as const

/** "2h 15min" / "3d 4h" — duração legível a partir de minutos. */
function fmtDuration(min: number | null | undefined): string {
  if (min === null || min === undefined) return '—'
  if (min < 1) return 'agora'
  if (min < 60) return `${min}min`
  const h = Math.floor(min / 60)
  if (h < 24) {
    const m = min % 60
    return m ? `${h}h ${m}min` : `${h}h`
  }
  const d = Math.floor(h / 24)
  const rh = h % 24
  return rh ? `${d}d ${rh}h` : `${d}d`
}

function fmtWhen(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  return sameDay
    ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) +
      ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

const BUCKET_LABEL: Record<string, { label: string; tone: 'neutral' | 'info' | 'warning' | 'success' }> = {
  raw: { label: 'Caixa', tone: 'warning' },
  inbox: { label: 'Atendimento', tone: 'info' },
  snoozed: { label: 'Aguardando', tone: 'neutral' },
  resolved: { label: 'Resolvido', tone: 'success' },
}

/** Rótulo do canal cru vindo do overview ("evolution:beyond-main"). */
function prettyChannel(raw: string): string {
  if (!raw || raw === 'sem mensagem') return 'Sem mensagem'
  const [provider, rest] = raw.split(':')
  if (provider === 'cloud_api') return rest ? `API Oficial #${rest}` : 'API Oficial'
  return rest || 'WhatsApp'
}

/** Quem conduz + em que ponto do chatbot. */
/**
 * Ações da linha num menu suspenso.
 *
 * Eram um link e um botão de texto ocupando ~110px em TODA linha — e é o que
 * empurrava a tabela para além da tela, obrigando a rolagem horizontal. Numa
 * lista de supervisão o operador escaneia estado e espera; a ação é o segundo
 * passo, e cabe atrás de um clique.
 */
function LinhaAcoes({
  conversa, onEncerrar, onReabrir,
}: { conversa: SupervisionConversation; onEncerrar: () => void; onReabrir: () => void }) {
  const resolvida = conversa.bucket === 'resolved'
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          class="size-8 grid place-items-center rounded-md text-fg-muted hover:text-fg hover:bg-surface-3"
          aria-label={`Opções da conversa com ${conversa.nome || conversa.whatsapp}`}
          title="Opções"
        >
          <MoreHorizontal size={16} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          class="min-w-[12rem] rounded-md bg-surface-2 border border-border shadow-lg p-1 surface-raised"
          style={{ zIndex: 'var(--z-popover)' }}
        >
          <DropdownMenu.Item asChild>
            <a
              href={`/app/conversations?leadId=${conversa.id}`}
              class="flex items-center gap-2 h-8 px-2 rounded-sm text-sm cursor-pointer hover:bg-surface-3 outline-none text-fg"
            >
              <ExternalLink size={14} /> Abrir no Conversas
            </a>
          </DropdownMenu.Item>
          <DropdownMenu.Item
            class="flex items-center gap-2 h-8 px-2 rounded-sm text-sm cursor-pointer hover:bg-surface-3 outline-none"
            onSelect={() => (resolvida ? onReabrir() : onEncerrar())}
          >
            {resolvida ? <><RefreshCw size={14} /> Reabrir conversa</> : <><CheckCircle2 size={14} /> Encerrar conversa</>}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function BotCell({ bot }: { bot: BotState }) {
  if (bot.driver === 'human') {
    return (
      <div class="flex flex-col gap-0.5">
        <Badge tone="accent" title={bot.pausedBy ? `Assumido por ${bot.pausedBy}` : 'Bot pausado por atendimento humano'}>
          <UserIcon size={11} class="inline mr-1" />Humano
        </Badge>
        {bot.pausedBy && <span class="text-2xs text-fg-muted truncate">por {bot.pausedBy}</span>}
      </div>
    )
  }
  if (bot.driver === 'bot') {
    const detail = bot.engine === 'scripted'
      ? (bot.step ? `passo ${bot.step}` : bot.phase || 'em fluxo')
      : (bot.phase === 'active' ? 'jornada IA' : bot.phase || 'jornada IA')
    return (
      <div class="flex flex-col gap-0.5">
        <Badge tone="info"><Bot size={11} class="inline mr-1" />Chatbot</Badge>
        <span class="text-2xs text-fg-muted truncate">{detail}</span>
      </div>
    )
  }
  return <span class="text-xs text-fg-muted">—</span>
}

/**
 * Chave liga/desliga com estado escrito por extenso.
 *
 * O rótulo diz "ativo"/"desativado" em texto porque a diferença muda os
 * NÚMEROS do painel, não só a lista — vale ser explícito em vez de depender de
 * o operador interpretar a cor da chave.
 */
function Toggle({ label, checked, onChange, hint }: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  hint?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={hint}
      onClick={() => onChange(!checked)}
      class="inline-flex items-center gap-2 h-9 rounded-md border border-border bg-surface px-2.5 text-sm text-fg hover:bg-surface-3 transition-colors"
    >
      <span
        class={`relative inline-block h-4 w-7 rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-surface-3'}`}
        aria-hidden="true"
      >
        <span
          class={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${checked ? 'left-3.5' : 'left-0.5'}`}
        />
      </span>
      <span>{label}</span>
      <Badge tone={checked ? 'success' : 'neutral'}>{checked ? 'ativo' : 'desativado'}</Badge>
    </button>
  )
}

/** Barra proporcional para as distribuições (operador, setor, funil, canal). */
function DistBar({ rows, empty }: { rows: Array<{ key: string; label: string; total: number; color?: string | null }>; empty: string }) {
  const max = rows.reduce((m, r) => Math.max(m, r.total), 0)
  if (!rows.length) return <p class="text-xs text-fg-muted">{empty}</p>
  return (
    <div class="space-y-2">
      {rows.slice(0, 8).map((r) => (
        <div key={r.key}>
          <div class="flex items-baseline justify-between gap-2 text-xs">
            <span class="text-fg truncate">{r.label}</span>
            <span class="text-fg-muted tabular-nums shrink-0">{r.total}</span>
          </div>
          <div class="mt-1 h-1.5 rounded-full bg-surface-3 overflow-hidden">
            <div
              class="h-full rounded-full"
              style={{ width: `${max ? Math.round((r.total / max) * 100) : 0}%`, background: r.color || 'var(--color-accent, #6366f1)' }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

export function SupervisionPage() {
  const [bucket, setBucket] = useState<string>('active')
  const [search, setSearch] = useState('')
  const [userId, setUserId] = useState('')
  const [teamId, setTeamId] = useState('')
  const [funnelId, setFunnelId] = useState('')
  const [channel, setChannel] = useState('')
  // Grupos de WhatsApp entram no painel? Desligado vira kind=contacts no backend,
  // o que tira os grupos TAMBÉM dos KPIs — um grupo com 176 não lidas distorce a fila.
  const [showGroups, setShowGroups] = useState(true)
  const [onlyUnread, setOnlyUnread] = useState(false)
  const [stale, setStale] = useState('')
  const [sort, setSort] = useState('recent')
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<number[]>([])
  const [assignOpen, setAssignOpen] = useState(false)
  const [assignUser, setAssignUser] = useState('')
  const [assignTeam, setAssignTeam] = useState('')
  // Período dos indicadores de fluxo (resolvidas, 1ª resposta, tempo de
  // resolução). Antes eram 7 dias fixos, sem seletor na tela.
  const period = usePeriod('supervision', '7d')

  const limit = 50
  const filters: SupervisionFilters = useMemo(() => ({
    bucket,
    ...(search ? { search } : {}),
    ...(userId ? { userId } : {}),
    ...(teamId ? { teamId } : {}),
    ...(funnelId ? { funnelId } : {}),
    ...(channel ? { channel } : {}),
    ...(showGroups ? {} : { kind: 'contacts' }),
    ...(onlyUnread ? { unread: '1' } : {}),
    ...(stale ? { stale } : {}),
    sort,
    limit,
    offset: page * limit,
  }), [bucket, search, userId, teamId, funnelId, channel, showGroups, onlyUnread, stale, sort, page])

  // Overview ignora o balde (é a visão do todo) mas respeita os demais filtros
  // — e leva o período, que só ele usa (a lista não é recortada por data).
  const overviewFilters: SupervisionFilters = useMemo(() => {
    const { bucket: _b, limit: _l, offset: _o, sort: _s, ...rest } = filters
    return { ...rest, from: period.range.dateFrom, to: period.range.dateTo }
  }, [filters, period.range.dateFrom, period.range.dateTo])

  const { data: ov, isLoading: ovLoading, isFetching: ovFetching, refetch } = useSupervisionOverview(overviewFilters)
  const { data: list, isLoading: listLoading } = useSupervisionConversations(filters)
  const { data: opts } = useSupervisionFilterOptions()

  const close = useSupervisionClose()
  const reopen = useSupervisionReopen()
  const resumeBot = useSupervisionResumeBot()
  const assign = useSupervisionAssign()
  const snooze = useSupervisionSnooze()

  const conversations = list?.conversations ?? []
  const total = list?.total ?? 0
  const allSelected = conversations.length > 0 && selected.length === conversations.length

  function toggleAll() {
    setSelected(allSelected ? [] : conversations.map((c) => c.id))
  }
  function toggleOne(id: number) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  }
  function clearFilters() {
    setSearch(''); setUserId(''); setTeamId(''); setFunnelId(''); setChannel('')
    setShowGroups(true); setOnlyUnread(false); setStale(''); setPage(0)
  }
  const hasFilters = !!(search || userId || teamId || funnelId || channel || !showGroups || onlyUnread || stale)

  function runAction(
    fn: { mutate: (v: any, o: any) => void },
    ids: number[],
    extra: Record<string, unknown>,
    okMsg: (n: number) => string,
  ) {
    if (!ids.length) return
    fn.mutate({ leadIds: ids, ...extra }, {
      onSuccess: () => { toast(okMsg(ids.length), 'success'); setSelected([]) },
      onError: (e: unknown) => toast((e as Error).message || 'Não foi possível concluir', 'danger'),
    })
  }

  const kpi = ov?.kpis

  return (
    <Page
      title="Supervisão"
      description="Visão gerencial do Conversas: fila, atendimento humano ou chatbot, canal, funil e ação direta sobre as conversas."
      actions={
        <div class="flex items-center gap-2 flex-wrap">
          <PeriodPicker
            preset={period.preset}
            customFrom={period.customFrom}
            customTo={period.customTo}
            onPreset={period.setPreset}
            onCustom={period.setCustom}
            label="Período dos indicadores"
          />
          <Button variant="ghost" size="sm" onClick={() => void refetch()} disabled={ovFetching}>
            <RefreshCw size={14} class={ovFetching ? 'animate-spin mr-1' : 'mr-1'} />
            Atualizar
          </Button>
        </div>
      }
    >
      <PeriodIncompleteHint show={period.range.incomplete} />
      {/* Baldes — a foto do estado atual, e também o filtro da lista abaixo. */}
      <div class="grid grid-cols-2 md:grid-cols-5 gap-2">
        {BUCKETS.map((b) => {
          const count = !ov ? null
            : b.id === 'active' ? ov.buckets.active
            : b.id === 'raw' ? ov.buckets.raw
            : b.id === 'inbox' ? ov.buckets.inbox
            : b.id === 'snoozed' ? ov.buckets.snoozed
            : ov.buckets.resolved
          const active = bucket === b.id
          const Icon = b.icon
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => { setBucket(b.id); setPage(0); setSelected([]) }}
              class={`rounded-lg border p-3 text-left transition-colors ${
                active ? 'border-accent bg-accent/10' : 'border-border bg-surface-2 hover:bg-surface-3'
              }`}
            >
              <div class="flex items-center gap-2 text-xs text-fg-muted">
                <Icon size={14} />
                <span class="truncate">{b.label}</span>
              </div>
              <div class="mt-1 text-xl font-semibold text-fg tabular-nums">
                {count === null ? <span class="inline-block h-6 w-10 rounded bg-surface-3 animate-pulse" /> : count}
              </div>
            </button>
          )
        })}
      </div>

      {/* KPIs */}
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Sem responsável"
          value={kpi?.unassigned ?? '—'}
          hint="Conversas ativas que ninguém assumiu"
          icon={<AlertTriangle size={15} />}
          loading={ovLoading}
        />
        <KpiCard
          label="Não lidas"
          value={kpi?.unread ?? '—'}
          hint="Conversas com mensagem do lead pendente"
          icon={<MessageSquare size={15} />}
          loading={ovLoading}
        />
        <KpiCard
          label="Espera mais antiga"
          value={fmtDuration(kpi?.oldestWaitingMin ?? null)}
          hint="Há quanto tempo a conversa mais antiga da Caixa aguarda"
          icon={<Clock size={15} />}
          loading={ovLoading}
        />
        <KpiCard
          label="Resolvidas hoje"
          value={kpi?.resolvedToday ?? '—'}
          hint={`${kpi?.resolvedPeriod ?? 0} ${periodLabel(period.range)}`}
          icon={<CheckCircle2 size={15} />}
          loading={ovLoading}
        />
        <KpiCard
          label="Com chatbot"
          value={kpi?.botDriven ?? '—'}
          hint="Conversas ativas ainda conduzidas pelo bot"
          icon={<Bot size={15} />}
          loading={ovLoading}
        />
        <KpiCard
          label="Com humano"
          value={kpi?.humanDriven ?? '—'}
          hint="Bot pausado porque um operador assumiu"
          icon={<UserIcon size={15} />}
          loading={ovLoading}
        />
        <KpiCard
          label="1ª resposta (média)"
          value={fmtDuration(kpi?.avgFirstResponseMin ?? null)}
          hint={`Da atribuição à primeira ação — ${kpi?.sampleFirstResponse ?? 0} conversas no período`}
          icon={<Clock size={15} />}
          loading={ovLoading}
        />
        <KpiCard
          label="Resolução (média)"
          value={fmtDuration(kpi?.avgResolutionMin ?? null)}
          hint={`Da abertura ao encerramento — ${kpi?.sampleResolution ?? 0} conversas no período`}
          icon={<CheckCircle2 size={15} />}
          loading={ovLoading}
        />
      </div>

      {/* Distribuições */}
      <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        <Card>
          <div class="text-sm font-semibold text-fg mb-3">Por operador</div>
          <DistBar
            rows={(ov?.byUser ?? []).map((r) => ({ key: String(r.id ?? 'none'), label: r.name, total: r.total }))}
            empty="Sem conversas ativas."
          />
        </Card>
        <Card>
          <div class="text-sm font-semibold text-fg mb-3">Por setor</div>
          <DistBar
            rows={(ov?.byTeam ?? []).map((r) => ({ key: String(r.id ?? 'none'), label: r.name, total: r.total, color: r.color }))}
            empty="Sem conversas ativas."
          />
        </Card>
        <Card>
          <div class="text-sm font-semibold text-fg mb-3">Por funil e etapa</div>
          <DistBar
            rows={(ov?.byFunnel ?? []).map((r) => ({ key: String(r.id ?? 'none'), label: r.name, total: r.total }))}
            empty="Sem conversas ativas."
          />
          {!!ov?.byStage?.length && (
            <div class="mt-3 pt-3 border-t border-border flex flex-wrap gap-1">
              {ov.byStage.slice(0, 8).map((s) => (
                <Badge key={s.key} tone="neutral">{s.key} · {s.total}</Badge>
              ))}
            </div>
          )}
        </Card>
        <Card>
          <div class="text-sm font-semibold text-fg mb-3">Por canal</div>
          <DistBar
            rows={(ov?.byChannel ?? []).map((r) => ({ key: r.channel, label: prettyChannel(r.channel), total: r.total }))}
            empty="Sem conversas ativas."
          />
        </Card>
      </div>

      {/* Filtros */}
      <Card>
        <div class="flex items-center gap-2 mb-3">
          <Filter size={15} class="text-fg-muted" />
          <span class="text-sm font-medium text-fg">Filtros</span>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X size={13} class="mr-1" />Limpar
            </Button>
          )}
        </div>
        <div class="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-2">
          <Input
            placeholder="Buscar nome, telefone, e-mail…"
            value={search}
            onInput={(e) => { setSearch((e.target as HTMLInputElement).value); setPage(0) }}
          />
          <select class={SELECT_CLS} value={userId} onChange={(e) => { setUserId((e.target as HTMLSelectElement).value); setPage(0) }}>
            <option value="">Todos os operadores</option>
            <option value="none">Sem responsável</option>
            {(opts?.users ?? []).map((u) => <option key={u.id} value={String(u.id)}>{u.name}</option>)}
          </select>
          <select class={SELECT_CLS} value={teamId} onChange={(e) => { setTeamId((e.target as HTMLSelectElement).value); setPage(0) }}>
            <option value="">Todos os setores</option>
            <option value="none">Sem setor</option>
            {(opts?.teams ?? []).map((t) => <option key={t.id} value={String(t.id)}>{t.name}</option>)}
          </select>
          <select class={SELECT_CLS} value={funnelId} onChange={(e) => { setFunnelId((e.target as HTMLSelectElement).value); setPage(0) }}>
            <option value="">Todos os funis</option>
            <option value="none">Sem funil</option>
            {(opts?.funnels ?? []).map((f) => <option key={f.id} value={String(f.id)}>{f.name}</option>)}
          </select>
          <select class={SELECT_CLS} value={channel} onChange={(e) => { setChannel((e.target as HTMLSelectElement).value); setPage(0) }}>
            <option value="">Todos os canais</option>
            {(opts?.channels ?? []).map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <select class={SELECT_CLS} value={stale} onChange={(e) => { setStale((e.target as HTMLSelectElement).value); setPage(0) }}>
            <option value="">Qualquer tempo</option>
            <option value="30">Paradas há +30min</option>
            <option value="60">Paradas há +1h</option>
            <option value="240">Paradas há +4h</option>
            <option value="1440">Paradas há +24h</option>
          </select>
        </div>
        <div class="flex flex-wrap items-center gap-3 mt-3">
          <label class="flex items-center gap-2 text-sm text-fg cursor-pointer">
            <input type="checkbox" checked={onlyUnread} onChange={(e) => { setOnlyUnread((e.target as HTMLInputElement).checked); setPage(0) }} />
            Só não lidas
          </label>
          <Toggle
            label="Grupos"
            checked={showGroups}
            onChange={(v) => { setShowGroups(v); setPage(0) }}
            hint={showGroups
              ? 'Grupos de WhatsApp entram nos números e na lista'
              : 'Só conversas com contatos — grupos ficam de fora de tudo'}
          />
          <select class={SELECT_CLS + " max-w-[12rem]"} value={sort} onChange={(e) => setSort((e.target as HTMLSelectElement).value)}>
            <option value="recent">Mais recentes</option>
            <option value="oldest">Mais antigas</option>
            <option value="unread">Mais não lidas</option>
          </select>
        </div>
      </Card>

      {/* Ações em lote */}
      {selected.length > 0 && (
        <Card>
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-sm text-fg font-medium">{selected.length} selecionada(s)</span>
            <Button size="sm" onClick={() => runAction(close, selected, {}, (n) => `${n} conversa(s) encerrada(s)`)} disabled={close.isPending}>
              <CheckCircle2 size={14} class="mr-1" />Encerrar
            </Button>
            <Button variant="ghost" size="sm" onClick={() => runAction(reopen, selected, {}, (n) => `${n} conversa(s) reaberta(s)`)} disabled={reopen.isPending}>
              Reabrir
            </Button>
            <Button variant="ghost" size="sm" onClick={() => runAction(resumeBot, selected, {}, (n) => `${n} conversa(s) devolvida(s) ao bot`)} disabled={resumeBot.isPending}>
              <Bot size={14} class="mr-1" />Devolver ao bot
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setAssignOpen(true)}>
              <Users2 size={14} class="mr-1" />Transferir
            </Button>
            <Button
              variant="ghost" size="sm"
              onClick={() => runAction(snooze, selected, { until: new Date(Date.now() + 4 * 3600_000).toISOString() }, (n) => `${n} conversa(s) adormecida(s) por 4h`)}
              disabled={snooze.isPending}
            >
              <Clock size={14} class="mr-1" />Adormecer 4h
            </Button>
            <Button variant="ghost" size="sm" onClick={() => runAction(snooze, selected, { until: null }, (n) => `${n} conversa(s) acordada(s)`)}>
              Acordar
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelected([])}>Limpar seleção</Button>
          </div>
        </Card>
      )}

      {/* Lista */}
      <Card>
        <div class="flex items-center justify-between gap-2 mb-3">
          <span class="text-sm font-semibold text-fg">
            Conversas <span class="text-fg-muted font-normal">({total})</span>
          </span>
          {total > limit && (
            <div class="flex min-w-0 flex-wrap items-center gap-2">
              <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Anterior</Button>
              <span class="text-xs text-fg-muted">{page + 1} / {Math.ceil(total / limit)}</span>
              <Button variant="ghost" size="sm" disabled={(page + 1) * limit >= total} onClick={() => setPage((p) => p + 1)}>Próxima</Button>
            </div>
          )}
        </div>

        {listLoading ? (
          <Skeleton class="h-64 w-full" />
        ) : conversations.length === 0 ? (
          <EmptyState
            icon={<Inbox size={28} />}
            title="Nenhuma conversa aqui"
            description={hasFilters ? 'Nenhum resultado para os filtros aplicados.' : 'Não há conversas neste estado no momento.'}
          />
        ) : (
          <div class="overflow-x-auto">
            {/* Rótulos curtos de propósito: "Conduzido por" e "Funil / etapa"
              * sozinhos empurravam a tabela para além da largura útil em 1280px,
              * e o cabeçalho é justamente o texto que pode encolher sem custo —
              * quem lê a coluna já tem o dado embaixo. */}
            {/* `table-fixed` + larguras em %: com layout automático a tabela soma
              * a largura NATURAL de cada coluna e estoura a tela — foi o que
              * obrigava a rolagem. Em layout fixo as colunas repartem os 100%
              * disponíveis e o conteúdo trunca dentro delas, então não existe
              * largura de tela em que isto role. */}
            <table class="data-table w-full table-fixed text-sm">
              <thead>
                {/* `[&>th]:truncate`: sem isso o rótulo de uma coluna estreita
                  * transborda por cima da vizinha ("CONDUZIDORESPONSÁVEL"), que
                  * é como o cabeçalho quebra quando a tabela tem largura fixa. */}
                <tr class="text-left text-xs text-fg-muted border-b border-border [&>th]:truncate">
                  <th class="w-9"><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Selecionar todas" /></th>
                  {/* As larguras saíram da medição do cabeçalho renderizado, não
                    * de palpite: em versalete com tracking, "RESPONSÁVEL" ocupa
                    * ~85px e "ESPERA" ~55px. Coluna estreita demais faz o próprio
                    * rótulo truncar, que é pior que a rolagem que viemos tirar. */}
                  <th class="w-[23%]">Contato</th>
                  <th class="w-[10%]">Estado</th>
                  <th class="w-[6%]" title="Conduzido por: chatbot ou operador">Bot</th>
                  <th class="w-[14%]">Responsável</th>
                  <th class="w-[14%]">Funil</th>
                  <th class="w-[10%]">Canal</th>
                  <th class="w-[11%] whitespace-nowrap">Espera</th>
                  <th class="w-[10%] whitespace-nowrap">Última</th>
                  <th class="w-11"><span class="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {conversations.map((c: SupervisionConversation) => (
                  <tr key={c.id} class="border-b border-border/60 hover:bg-surface-3/50">
                    <td class="p-2 align-top">
                      <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggleOne(c.id)} aria-label={`Selecionar ${c.nome}`} />
                    </td>
                    <td class="p-2 align-top">
                      <div class="flex items-center gap-2 min-w-0">
                        <div class="min-w-0">
                          <div class="font-medium text-fg truncate" title={c.nome || c.whatsapp}>
                            {c.nome || c.whatsapp}
                            {c.isGroup && <Badge tone="neutral" class="ml-1">grupo</Badge>}
                            {/* Sem esta marca, o supervisor vê uma conversa
                              * ENCERRADA aparecendo entre as ativas e conclui
                              * que o quadro está errado. Ela está viva porque o
                              * contato voltou a falar — e é isso que precisa
                              * estar escrito, na mesma marca que a lista de
                              * Conversas já usa. */}
                            {c.conversationReopenedAt && (
                              <span
                                class="ml-1 inline-flex align-middle text-warning"
                                title="O contato voltou a falar depois de a conversa ter sido resolvida"
                              >
                                <CornerUpLeft size={11} />
                              </span>
                            )}
                          </div>
                          <div class="text-xs text-fg-muted truncate" title={c.empresa || c.whatsapp}>
                            {c.empresa || c.whatsapp}
                          </div>
                          {c.lastMessage && (
                            <div class="text-2xs text-fg-muted truncate mt-0.5">
                              {c.lastMessage.fromMe ? '↩ ' : '→ '}{c.lastMessage.body}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td class="p-2 align-top">
                      <Badge tone={BUCKET_LABEL[c.bucket]?.tone ?? 'neutral'}>{BUCKET_LABEL[c.bucket]?.label ?? c.bucket}</Badge>
                      {c.unreadMessages > 0 && (
                        <div class="mt-1"><Badge tone="danger" class="whitespace-nowrap">{c.unreadMessages} não lidas</Badge></div>
                      )}
                      {c.snoozedUntil && new Date(c.snoozedUntil) > new Date() && (
                        <div class="text-2xs text-fg-muted mt-0.5">até {fmtWhen(c.snoozedUntil)}</div>
                      )}
                    </td>
                    <td class="p-2 align-top"><BotCell bot={c.bot} /></td>
                    <td class="p-2 align-top">
                      <div class="text-fg truncate" title={c.assignedUser?.name ?? 'Sem responsável'}>{c.assignedUser?.name ?? <span class="text-warning">Sem responsável</span>}</div>
                      {c.team && <div class="text-xs text-fg-muted truncate" title={c.team.name}>{c.team.name}</div>}
                    </td>
                    <td class="p-2 align-top">
                      <div class="text-fg truncate" title={c.funnel?.name ?? 'Sem funil'}>{c.funnel?.name ?? <span class="text-fg-muted">Sem funil</span>}</div>
                      <div class="text-xs text-fg-muted truncate" title={c.stageName}>{c.stageName}</div>
                    </td>
                    <td class="p-2 align-top">
                      <div class="text-xs text-fg truncate" title={c.channel?.label ?? ''}>{c.channel?.label ?? '—'}</div>
                      {c.source && <div class="text-2xs text-fg-muted truncate">{c.source}</div>}
                    </td>
                    <td class="p-2 align-top whitespace-nowrap">
                      {c.waitingSinceMin === null
                        ? <span class="text-fg-muted text-xs">—</span>
                        : <span class={c.waitingSinceMin > 60 ? 'text-danger' : c.waitingSinceMin > 15 ? 'text-warning' : 'text-fg'}>
                            {fmtDuration(c.waitingSinceMin)}
                          </span>}
                    </td>
                    <td class="p-2 align-top whitespace-nowrap text-xs text-fg-muted">{fmtWhen(c.lastMessageAt)}</td>
                    <td class="align-top">
                      <LinhaAcoes
                        conversa={c}
                        onEncerrar={() => runAction(close, [c.id], {}, () => 'Conversa encerrada')}
                        onReabrir={() => runAction(reopen, [c.id], {}, () => 'Conversa reaberta')}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Transferir */}
      <Modal
        open={assignOpen}
        onOpenChange={setAssignOpen}
        title={`Transferir ${selected.length} conversa(s)`}
        description="Define o responsável e/ou o setor. Deixar em branco mantém o valor atual; 'Devolver à fila' remove o responsável."
        size="md"
        footer={
          <div class="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAssignOpen(false)}>Cancelar</Button>
            <Button
              onClick={() => {
                const extra: Record<string, unknown> = {}
                if (assignUser === 'none') extra.userId = null
                else if (assignUser) extra.userId = parseInt(assignUser)
                if (assignTeam === 'none') extra.teamId = null
                else if (assignTeam) extra.teamId = parseInt(assignTeam)
                if (!Object.keys(extra).length) { toast('Escolha um operador ou um setor', 'danger'); return }
                runAction(assign, selected, extra, (n) => `${n} conversa(s) transferida(s)`)
                setAssignOpen(false); setAssignUser(''); setAssignTeam('')
              }}
              disabled={assign.isPending}
            >
              Transferir
            </Button>
          </div>
        }
      >
        <div class="space-y-3">
          <div>
            <label class="text-sm text-fg block mb-1">Responsável</label>
            <select class={SELECT_CLS + " w-full"} value={assignUser} onChange={(e) => setAssignUser((e.target as HTMLSelectElement).value)}>
              <option value="">Manter o atual</option>
              <option value="none">Devolver à fila (sem responsável)</option>
              {(opts?.users ?? []).map((u) => <option key={u.id} value={String(u.id)}>{u.name}</option>)}
            </select>
          </div>
          <div>
            <label class="text-sm text-fg block mb-1">Setor</label>
            <select class={SELECT_CLS + " w-full"} value={assignTeam} onChange={(e) => setAssignTeam((e.target as HTMLSelectElement).value)}>
              <option value="">Manter o atual</option>
              <option value="none">Sem setor</option>
              {(opts?.teams ?? []).map((t) => <option key={t.id} value={String(t.id)}>{t.name}</option>)}
            </select>
          </div>
        </div>
      </Modal>
    </Page>
  )
}
