// SupervisionPage — painel gerencial do Conversas.
//
// A tela responde, em ordem: como está a operação AGORA (baldes + KPIs), onde
// a carga está concentrada (distribuições) e o que fazer a respeito (lista com
// ações). Os dados são os mesmos leads da inbox — a diferença é que aqui não há
// recorte por operador.
//
// Atualização: o WebSocket invalida ['supervision'] (ver lib/realtime.ts); o
// refetchInterval dos hooks é só a rede de segurança para telão parado.

import type { ComponentChildren, JSX } from 'preact'
import { useMemo, useState } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import { cn } from '@/lib/cn'
import { leadSourceLabel } from '@/lib/leadSourceLabels'
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
import {
  SerieDeResposta, CoberturaPorHora, TabelaDeOperadores, fmtUteis,
} from '@/components/supervision/SupervisionCharts'
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

/**
 * Cabeçalho de coluna que ordena a lista.
 *
 * Setor, funil e responsável saíram da barra de filtros (foram para o painel
 * "Filtros") — quem perde o menu precisa de outro jeito de juntar o que é
 * parecido, e o cabeçalho clicável é o gesto que já se espera de uma tabela.
 * Um clique ordena; outro inverte.
 */
function ColunaOrdenavel({
  campo, sortAlt, sort, onSort, children,
}: {
  campo: string
  /** Par do campo quando os dois sentidos têm nome próprio no backend (espera). */
  sortAlt?: string | undefined
  sort: string
  onSort: (s: string) => void
  children: ComponentChildren
}) {
  const desc = sortAlt ?? `${campo}-desc`
  const ativa = sort === campo || sort === desc
  const proxima = sort === campo ? desc : campo
  return (
    <button
      type="button"
      class={cn('inline-flex items-center gap-1 max-w-full', ativa ? 'text-fg font-medium' : 'hover:text-fg')}
      onClick={() => onSort(proxima)}
      title={`Ordenar por ${String(children)}`}
    >
      <span class="truncate">{children}</span>
      <span class="text-2xs opacity-70">{!ativa ? '↕' : sort === campo ? '↑' : '↓'}</span>
    </button>
  )
}

/**
 * Pílula de filtro com o número dentro.
 *
 * Substitui os menus suspensos pelo mesmo idioma da lista de Conversas: o
 * gestor lê a operação inteira ANTES de clicar em qualquer coisa, e o clique
 * que ele der já é o filtro. Menu escondia o número e cobrava dois gestos —
 * abrir e escolher — para uma pergunta que se faz dez vezes por dia.
 */
function Pilula({
  rotulo, total, ativa, tom = 'neutro', onClick, title,
}: {
  rotulo: string
  total?: number | undefined
  ativa: boolean
  tom?: 'neutro' | 'alerta' | undefined
  onClick: () => void
  title?: string | undefined
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={ativa}
      class={cn(
        'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border text-xs whitespace-nowrap transition-colors',
        ativa
          ? 'bg-accent border-accent text-fg-on-brand font-semibold'
          : tom === 'alerta'
            ? 'border-warning/50 bg-warning/10 text-warning font-medium hover:bg-warning/20'
            : 'border-border bg-surface text-fg hover:bg-surface-3',
      )}
    >
      {rotulo}
      {total !== undefined && (
        <span class={cn('tabular-nums text-2xs', ativa ? 'opacity-90' : 'text-fg-muted')}>{total}</span>
      )}
    </button>
  )
}

/** Divisória entre grupos de pílulas — o mesmo recurso do cabeçalho do Conversas. */
function DivisoriaPilulas() {
  return <span class="hidden sm:inline-block h-5 w-px bg-border mx-1" aria-hidden />
}

/**
 * Cartão de contagem que abre o microdado ali mesmo.
 *
 * O número que interessa ao gestor é o nome: "11 esperando" só vira ação
 * depois de saber QUEM. Antes isso custava rolar até a lista, filtrar e ler
 * linha a linha; as primeiras linhas agora vêm junto do resumo, na mesma
 * resposta, e a gaveta abre fechada para a tela caber inteira.
 */
function CartaoComGaveta({
  label, value, hint, icon, tone, loading, itens, aoVerTodos, vazio, trend, menorEhMelhor,
}: {
  label: string
  value: string | number
  hint: string
  icon: JSX.Element
  tone?: 'neutral' | 'warning' | 'danger' | undefined
  loading?: boolean | undefined
  itens: Array<{ id: number; titulo: string; detalhe: string; direita: string }>
  aoVerTodos?: (() => void) | undefined
  vazio: string
  trend?: { value: number; label?: string } | undefined
  menorEhMelhor?: boolean | undefined
}) {
  const [aberta, setAberta] = useState(false)
  const [, navigate] = useLocation()

  return (
    <div class="flex flex-col">
      <button
        type="button"
        class="text-left"
        onClick={() => setAberta((v) => !v)}
        aria-expanded={aberta}
        title={aberta ? 'Fechar detalhes' : 'Ver quem está nesta conta'}
      >
        <KpiCard
          label={label}
          value={value}
          hint={`${hint} · ${aberta ? 'ocultar' : 'ver quem'}`}
          icon={icon}
          tone={tone}
          loading={loading}
          trend={trend}
          menorEhMelhor={menorEhMelhor}
        />
      </button>
      {aberta && (
        <div class="border border-t-0 border-border rounded-b-lg bg-surface-2 -mt-1 pt-1">
          {itens.length === 0 ? (
            <div class="px-3 py-2.5 text-2xs text-fg-muted">{vazio}</div>
          ) : (
            <>
              {itens.map((i) => (
                <button
                  key={i.id}
                  type="button"
                  class="w-full text-left px-3 py-2 border-b border-border last:border-b-0 hover:bg-surface-3"
                  onClick={() => navigate(`/conversations?leadId=${i.id}`)}
                  title="Abrir esta conversa"
                >
                  <div class="flex items-baseline justify-between gap-2">
                    <span class="text-xs font-medium text-fg truncate">{i.titulo}</span>
                    <span class="text-2xs tabular-nums text-warning shrink-0">{i.direita}</span>
                  </div>
                  <div class="text-2xs text-fg-muted truncate">{i.detalhe}</div>
                </button>
              ))}
              {aoVerTodos && (
                <button
                  type="button"
                  class="w-full text-left px-3 py-2 text-2xs text-accent hover:bg-surface-3"
                  onClick={aoVerTodos}
                >
                  ver todas na lista →
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Uma faixa de KPIs com nome e procedência.
 *
 * O cartão sozinho não diz se responde ao seletor de período — e essa dúvida
 * era metade da confusão do painel antigo, onde "Sem responsável" (foto) e
 * "Resolução média" (período) dividiam a mesma grade sem nenhuma marca. A
 * etiqueta ao lado do nome responde antes de alguém perguntar.
 */
function FaixaKpi({
  titulo, etiqueta, detalhe, children,
}: {
  titulo: string
  etiqueta: string
  detalhe?: string | undefined
  children: ComponentChildren
}) {
  return (
    <section class="space-y-2">
      <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 class="text-sm font-semibold text-fg">{titulo}</h2>
        <span class="inline-flex items-center rounded px-1.5 py-0.5 text-2xs font-medium uppercase tracking-wider text-accent bg-accent/10">
          {etiqueta}
        </span>
        {detalhe && <span class="text-2xs text-fg-muted">{detalhe}</span>}
      </div>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3">{children}</div>
    </section>
  )
}

/**
 * A dica do cartão — ou o aviso de que a amostra não sustenta um número.
 *
 * É a regra que faltava: o "78d 17h" que chegou como reclamação do cliente era
 * a média de UMA conversa. Abaixo do piso o cartão mostra "—" e diz por quê,
 * em vez de publicar um número que descreve um caso isolado como se fosse o
 * comportamento da equipe.
 */
/**
 * A variação contra o período anterior, no formato que o KpiCard entende.
 *
 * Devolve `undefined` quando não há com o que comparar — período anterior sem
 * amostra publicável não vira seta, porque uma seta tirada de duas conversas
 * seria o mesmo erro que tirou o painel do ar.
 */
function variacao(
  atual: number | null | undefined,
  anterior: number | null | undefined,
  opts: { emPontos?: boolean } = {},
): { value: number; label?: string } | undefined {
  if (atual === null || atual === undefined || anterior === null || anterior === undefined) return undefined
  if (atual === anterior) return undefined
  if (opts.emPontos) return { value: atual - anterior, label: 'pp' }
  if (anterior === 0) return undefined
  return { value: Math.round(((atual - anterior) / Math.abs(anterior)) * 100) }
}

function amostraHint(insuficiente: boolean | undefined, amostra: number | undefined, dica: string): string {
  if (insuficiente) return `Amostra insuficiente (${amostra ?? 0}) — poucos casos para publicar um número`
  return `${dica} · ${amostra ?? 0} no período`
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
  // Só as conversas em que a bola está com a operação. Vem dos cartões
  // "Esperando resposta" e "Sem resposta": número que não vira lista é número
  // que ninguém usa na segunda-feira.
  const [waiting, setWaiting] = useState(false)
  // O painel do "Filtros": só o que muda de semana em semana mora aqui.
  const [filtrosAbertos, setFiltrosAbertos] = useState(false)
  const [, navigate] = useLocation()
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
    ...(waiting ? { waiting: '1' } : {}),
    ...(stale ? { stale } : {}),
    sort,
    limit,
    offset: page * limit,
  }), [bucket, search, userId, teamId, funnelId, channel, showGroups, onlyUnread, waiting, stale, sort, page])

  // Overview ignora o balde (é a visão do todo) mas respeita os demais filtros
  // — e leva o período, que só ele usa (a lista não é recortada por data).
  const overviewFilters: SupervisionFilters = useMemo(() => {
    // `waiting` fica de fora: ele é o recorte da LISTA. Se entrasse aqui, clicar
    // em "Esperando resposta" reescreveria o próprio cartão que foi clicado.
    const { bucket: _b, limit: _l, offset: _o, sort: _s, waiting: _w, ...rest } = filters
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
    setShowGroups(true); setOnlyUnread(false); setWaiting(false); setStale(''); setPage(0)
  }
  const hasFilters = !!(search || userId || teamId || funnelId || channel || !showGroups || onlyUnread || waiting || stale)
  // A bolinha do botão conta só o que está ESCONDIDO atrás dele. Busca,
  // operador, pressa e estado estão à vista em pílula — contá-los faria o
  // número dizer "há filtros ativos" para algo que o gestor está enxergando.
  const filtrosAvancados = [teamId, funnelId, channel, stale, !showGroups ? 'g' : ''].filter(Boolean).length

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
  const agora = kpi?.agora
  const ritmo = kpi?.ritmo
  const resultado = kpi?.resultado
  const anterior = kpi?.anterior
  // Tamanho do dia de expediente: é ele que traduz minuto útil em "dia útil"
  // sem virar dia de calendário. Vem da jornada cadastrada.
  const minPorDia = ritmo?.relogio.minutosPorDiaUtil ?? 600

  // Todos os operadores viram pílula, como você pediu — inclusive quem está com
  // fila zerada, porque fila vazia também é informação de gestão. A fila sai do
  // mesmo `byUser` que alimenta a distribuição, então pílula e gráfico contam a
  // mesma coisa.
  const pilulasDeOperador = useMemo(() => {
    const fila = new Map<string, number>()
    for (const r of ov?.byUser ?? []) fila.set(r.id === null ? 'none' : String(r.id), r.total)
    const lista = (opts?.users ?? []).map((u) => ({
      valor: String(u.id),
      nome: u.name,
      fila: fila.get(String(u.id)) ?? 0,
    }))
    lista.sort((a, b) => b.fila - a.fila || a.nome.localeCompare(b.nome))
    const semDono = fila.get('none') ?? 0
    return [...lista, { valor: 'none', nome: 'Sem responsável', fila: semDono }]
  }, [opts?.users, ov?.byUser])

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

      {/* ── KPIs, em três faixas ────────────────────────────────────────
        *
        * Antes eram oito cartões numa grade só, e nenhum dizia se respondia ao
        * seletor de período — dois deles ("1ª resposta" e "Resolução") mediam
        * cliques do operador e chegavam a anunciar médias de 54 e 78 DIAS numa
        * operação que responde em minutos. Agora a tela separa o que precisa de
        * mão AGORA do RITMO do time e do RESULTADO do período, cada faixa
        * dizendo de onde vem o número. Ver services/responseTime.ts.
        */}
      <FaixaKpi
        titulo="Agora"
        etiqueta="foto do momento"
        detalhe="Não muda com o período escolhido"
      >
        <CartaoComGaveta
          label="Esperando resposta"
          value={agora?.esperandoResposta ?? '—'}
          hint="A última mensagem é do contato"
          icon={<MessageSquare size={15} />}
          tone={agora && agora.esperandoResposta > 0 ? 'warning' : 'neutral'}
          loading={ovLoading}
          itens={(ov?.amostras.esperando ?? []).map((e) => ({
            id: e.id,
            titulo: e.dono ? `${e.nome} · ${e.dono}` : `${e.nome} · sem dono`,
            detalhe: e.trecho || 'sem texto na última mensagem',
            direita: fmtDuration(e.esperaMin),
          }))}
          aoVerTodos={() => { setWaiting(true); setBucket('active'); setPage(0) }}
          vazio="Ninguém aguardando resposta agora."
        />
        {/* Sem gaveta de propósito: a lista das que esperam há mais tempo é a
          * mesma do cartão ao lado, e repetir seria só ocupar espaço. Aqui o
          * gesto útil é ir direto à conversa que está esperando há mais tempo. */}
        <button
          type="button"
          class="text-left"
          disabled={!agora?.esperaMaisAntigaLead}
          onClick={() => {
            const id = agora?.esperaMaisAntigaLead?.id
            if (id) navigate(`/conversations?leadId=${id}`)
          }}
          title={agora?.esperaMaisAntigaLead ? 'Abrir esta conversa' : 'Ninguém aguardando'}
        >
          <KpiCard
            label="Espera mais antiga"
            value={fmtDuration(agora?.esperaMaisAntigaMin ?? null)}
            hint={agora?.esperaMaisAntigaLead?.nome
              ? `${agora.esperaMaisAntigaLead.nome} aguarda desde então — abrir`
              : 'Ninguém aguardando resposta'}
            icon={<Clock size={15} />}
            tone={(agora?.esperaMaisAntigaMin ?? 0) > 60 ? 'danger' : 'neutral'}
            loading={ovLoading}
          />
        </button>
        <CartaoComGaveta
          label="Sem responsável"
          value={agora?.unassigned ?? '—'}
          hint="Conversas ativas que ninguém assumiu"
          icon={<AlertTriangle size={15} />}
          tone={agora && agora.unassigned > 0 ? 'warning' : 'neutral'}
          loading={ovLoading}
          itens={(ov?.amostras.semResponsavel ?? []).map((l) => ({
            id: l.id,
            titulo: l.nome,
            detalhe: l.setor ? `setor ${l.setor}` : 'sem setor',
            direita: fmtDuration(l.paradoDesdeMin),
          }))}
          aoVerTodos={() => { setUserId('none'); setBucket('active'); setPage(0) }}
          vazio="Toda conversa ativa tem responsável."
        />
        <CartaoComGaveta
          label="Sem ninguém"
          value={agora?.semNinguem ?? '—'}
          hint={`${agora?.comHumano ?? 0} com humano · ${agora?.comBot ?? 0} com bot`}
          icon={<Bot size={15} />}
          tone={agora && agora.semNinguem > 0 ? 'warning' : 'neutral'}
          loading={ovLoading}
          itens={(ov?.amostras.semNinguem ?? []).map((l) => ({
            id: l.id,
            titulo: l.nome,
            detalhe: l.origem ? `entrou por ${leadSourceLabel(l.origem)}` : 'origem não registrada',
            direita: fmtDuration(l.paradoDesdeMin),
          }))}
          aoVerTodos={() => { setUserId('none'); setBucket('active'); setPage(0) }}
          vazio="Toda conversa ativa tem operador ou bot."
        />
      </FaixaKpi>

      <FaixaKpi
        titulo="Ritmo"
        etiqueta={`${periodLabel(period.range)} · relógio comercial`}
        detalhe={ritmo ? `Medido pelas mensagens · ${ritmo.relogio.label}` : undefined}
      >
        <KpiCard
          label="1ª resposta (mediana)"
          value={ritmo?.insuficiente ? '—' : fmtUteis(ritmo?.respostaMedianaMin, minPorDia)}
          hint={amostraHint(ritmo?.insuficiente, ritmo?.amostra, 'Metade dos contatos é respondida em até isso')}
          trend={ritmo?.insuficiente ? undefined : variacao(ritmo?.respostaMedianaMin, anterior?.respostaMedianaMin)}
          menorEhMelhor
          icon={<Clock size={15} />}
          tone="accent"
          loading={ovLoading}
        />
        <KpiCard
          label="1ª resposta (p90)"
          value={ritmo?.insuficiente ? '—' : fmtUteis(ritmo?.respostaP90Min, minPorDia)}
          hint={amostraHint(ritmo?.insuficiente, ritmo?.amostra, '9 de cada 10 dentro disso — é aqui que mora o problema')}
          trend={ritmo?.insuficiente ? undefined : variacao(ritmo?.respostaP90Min, anterior?.respostaP90Min)}
          menorEhMelhor
          icon={<Clock size={15} />}
          loading={ovLoading}
        />
        <KpiCard
          label="Dentro da meta"
          value={ritmo?.insuficiente || ritmo?.dentroDaMetaPct === null || ritmo?.dentroDaMetaPct === undefined
            ? '—'
            : `${ritmo.dentroDaMetaPct}%`}
          hint={amostraHint(
            ritmo?.insuficiente,
            ritmo?.amostra,
            `Respondidas em até ${ritmo?.metaMin ?? 15}min úteis · ${ritmo?.dentroDaMeta ?? 0} de ${ritmo?.amostra ?? 0}`,
          )}
          trend={ritmo?.insuficiente ? undefined : variacao(ritmo?.dentroDaMetaPct, anterior?.dentroDaMetaPct, { emPontos: true })}
          icon={<CheckCircle2 size={15} />}
          tone={(ritmo?.dentroDaMetaPct ?? 0) >= 80 ? 'success' : 'warning'}
          loading={ovLoading}
        />
        <CartaoComGaveta
          label="Sem resposta"
          value={ritmo?.semResposta ?? '—'}
          hint={`De ${ritmo?.turnos ?? 0} mensagens do contato no período`}
          trend={variacao(ritmo?.semResposta, anterior?.semResposta)}
          menorEhMelhor
          icon={<AlertTriangle size={15} />}
          tone={ritmo && ritmo.semResposta > 0 ? 'danger' : 'neutral'}
          loading={ovLoading}
          itens={(ov?.amostras.semResposta ?? []).map((l) => ({
            id: l.id,
            titulo: l.dono ? `${l.nome} · ${l.dono}` : `${l.nome} · sem dono`,
            detalhe: 'falou e não teve resposta',
            direita: fmtDuration(l.desdeMin),
          }))}
          aoVerTodos={() => { setWaiting(true); setBucket('active'); setPage(0) }}
          vazio="Todo mundo que falou foi respondido."
        />
      </FaixaKpi>

      <FaixaKpi
        titulo="Resultado"
        etiqueta={periodLabel(period.range)}
        detalhe="Encerramento em lote fica fora das médias"
      >
        <KpiCard
          label="Conversas atendidas"
          value={resultado?.atendidas ?? '—'}
          hint="Tiveram ao menos uma resposta nossa"
          trend={variacao(resultado?.atendidas, anterior?.atendidas)}
          icon={<MessageSquare size={15} />}
          loading={ovLoading}
        />
        <KpiCard
          label="Encerradas"
          value={resultado?.encerradasPeriodo ?? '—'}
          hint={`${resultado?.encerradasHoje ?? 0} hoje · ${resultado?.encerradasEmLote ?? 0} em lote`}
          trend={variacao(resultado?.encerradasPeriodo, anterior?.encerradas)}
          icon={<CheckCircle2 size={15} />}
          loading={ovLoading}
        />
        <KpiCard
          label="Duração do atendimento"
          value={resultado?.duracaoInsuficiente ? '—' : fmtUteis(resultado?.duracaoMedianaMin, minPorDia)}
          hint={amostraHint(
            resultado?.duracaoInsuficiente,
            resultado?.duracaoAmostra,
            `Mediana dos encerrados um a um · p90 ${fmtUteis(resultado?.duracaoP90Min, minPorDia)}`,
          )}
          trend={resultado?.duracaoInsuficiente ? undefined : variacao(resultado?.duracaoMedianaMin, anterior?.duracaoMedianaMin)}
          menorEhMelhor
          icon={<Clock size={15} />}
          loading={ovLoading}
        />
        <KpiCard
          label="Reabertas"
          value={resultado?.reabertas ?? '—'}
          hint="Contato voltou depois de resolvido"
          icon={<AlertTriangle size={15} />}
          tone={resultado && resultado.reabertas > 0 ? 'warning' : 'neutral'}
          loading={ovLoading}
        />
      </FaixaKpi>

      {/* ── Gráficos ────────────────────────────────────────────────────
        *
        * Os três respondem o que a tela não respondia: como o ritmo variou dia
        * a dia (o agregado do período engolia o dia ruim), em que HORA o
        * cliente fala contra a hora em que a gente responde, e carga contra
        * desempenho por pessoa. Todos saem do MESMO conjunto de pares
        * mensagem→resposta já medido no backend — uma varredura, três leituras.
        */}
      <div class="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <SerieDeResposta pontos={ov?.serie.porDia ?? []} minPorDia={minPorDia} />
        <CoberturaPorHora horas={ov?.serie.porHora ?? []} expediente={ov?.serie.expediente ?? []} />
      </div>

      {/* A barra "por operador" virou tabela: contagem sozinha não distingue
        * quem está lento de quem está sobrecarregado. Clicar no nome filtra a
        * tela inteira por ele. */}
      <TabelaDeOperadores
        linhas={ov?.porOperador ?? []}
        minPorDia={minPorDia}
        metaMin={ritmo?.metaMin ?? 15}
        onSelecionar={(id) => { setUserId(id === null ? 'none' : String(id)); setPage(0) }}
      />

      {/* Distribuições */}
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
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

      {/* ── Barra de comando ────────────────────────────────────────────
        *
        * Eram 6 menus suspensos, 2 caixas e 1 chave: ver "as conversas do
        * fulano paradas há mais de 1 hora" custava cinco gestos. Agora o que
        * se usa toda hora é pílula com o número dentro — o gestor lê a
        * operação inteira antes de clicar, e o clique já é o filtro. O que
        * muda uma vez por semana (setor, funil, canal, grupos, ordenação)
        * ficou atrás de "Filtros", com a bolinha de quantos estão ativos.
        * Mesmo idioma do cabeçalho da lista de Conversas.
        */}
      <Card>
        <div class="flex flex-wrap items-center gap-2">
          <Input
            class="flex-1 min-w-[180px]"
            placeholder="Buscar nome, telefone, e-mail…"
            value={search}
            onInput={(e) => { setSearch((e.target as HTMLInputElement).value); setPage(0) }}
          />
          <Button
            variant={filtrosAbertos ? 'secondary' : 'ghost'}
            size="sm"
            class="relative"
            onClick={() => setFiltrosAbertos((v) => !v)}
            aria-expanded={filtrosAbertos}
          >
            <Filter size={14} class="mr-1" /> Filtros
            {filtrosAvancados > 0 && (
              <span class="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-fg-on-brand text-3xs tabular-nums">
                {filtrosAvancados}
              </span>
            )}
          </Button>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X size={13} class="mr-1" />Limpar
            </Button>
          )}
        </div>

        {/* Grupo 1 — quem atende. Todos os operadores da casa, com a fila de
            cada um; quem está sem conversa ativa também aparece, porque fila
            zerada é informação. */}
        <div class="flex flex-wrap items-center gap-1.5 mt-3">
          <Pilula rotulo="Todos" total={kpi?.agora.activeTotal} ativa={!userId}
            onClick={() => { setUserId(''); setPage(0) }} title="Sem filtro de operador" />
          {pilulasDeOperador.map((o) => (
            <Pilula
              key={o.valor}
              rotulo={o.nome}
              total={o.fila}
              ativa={userId === o.valor}
              onClick={() => { setUserId(userId === o.valor ? '' : o.valor); setPage(0) }}
              title={`Só as conversas de ${o.nome}`}
            />
          ))}
        </div>

        {/* Grupo 2 — o que pede mão agora · Grupo 3 — o estado da conversa. */}
        <div class="flex flex-wrap items-center gap-1.5 mt-2">
          <Pilula
            rotulo="Esperando resposta"
            total={kpi?.agora.esperandoResposta}
            ativa={waiting}
            tom="alerta"
            onClick={() => { setWaiting(!waiting); setPage(0) }}
            title="A última mensagem é do contato"
          />
          <Pilula
            rotulo="Não lidas"
            total={kpi?.agora.unread}
            ativa={onlyUnread}
            onClick={() => { setOnlyUnread(!onlyUnread); setPage(0) }}
            title="Com mensagem não lida no painel"
          />
          <Pilula
            rotulo="Paradas +1h"
            ativa={stale === '60'}
            onClick={() => { setStale(stale === '60' ? '' : '60'); setPage(0) }}
            title="Sem nenhuma mensagem há mais de uma hora"
          />
          <DivisoriaPilulas />
          {BUCKETS.map((b) => (
            <Pilula
              key={b.id}
              rotulo={b.label}
              total={ov?.buckets?.[b.id as keyof typeof ov.buckets]}
              ativa={bucket === b.id}
              onClick={() => { setBucket(bucket === b.id ? 'active' : b.id); setPage(0) }}
              title={`Só as conversas em ${b.label}`}
            />
          ))}
        </div>

        {filtrosAbertos && (
          <div class="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-2 mt-3 pt-3 border-t border-border">
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
            <select class={SELECT_CLS} value={sort} onChange={(e) => { setSort((e.target as HTMLSelectElement).value); setPage(0) }}>
              <option value="recent">Mais recentes</option>
              <option value="oldest">Mais antigas</option>
              <option value="unread">Mais não lidas</option>
              <option value="name">Contato (A→Z)</option>
              <option value="name-desc">Contato (Z→A)</option>
              <option value="owner">Responsável (A→Z)</option>
              <option value="owner-desc">Responsável (Z→A)</option>
              <option value="team">Setor (A→Z)</option>
              <option value="team-desc">Setor (Z→A)</option>
              <option value="funnel">Funil (A→Z)</option>
              <option value="funnel-desc">Funil (Z→A)</option>
            </select>
            <div class="md:col-span-3 xl:col-span-5">
              <Toggle
                label="Grupos"
                checked={showGroups}
                onChange={(v) => { setShowGroups(v); setPage(0) }}
                hint={showGroups
                  ? 'Grupos de WhatsApp entram nos números e na lista'
                  : 'Só conversas com contatos — grupos ficam de fora de tudo'}
              />
            </div>
          </div>
        )}
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
                  <th class="w-[20%]"><ColunaOrdenavel campo="name" sort={sort} onSort={setSort}>Contato</ColunaOrdenavel></th>
                  <th class="w-[9%]">Estado</th>
                  <th class="w-[5%]" title="Conduzido por: chatbot ou operador">Bot</th>
                  <th class="w-[13%]"><ColunaOrdenavel campo="owner" sort={sort} onSort={setSort}>Responsável</ColunaOrdenavel></th>
                  <th class="w-[11%]"><ColunaOrdenavel campo="team" sort={sort} onSort={setSort}>Setor</ColunaOrdenavel></th>
                  <th class="w-[12%]"><ColunaOrdenavel campo="funnel" sort={sort} onSort={setSort}>Funil</ColunaOrdenavel></th>
                  <th class="w-[9%]" title="Sem ordenação: o canal vem da última mensagem, não do cadastro da conversa">Canal</th>
                  <th class="w-[11%] whitespace-nowrap"><ColunaOrdenavel campo="oldest" sortAlt="recent" sort={sort} onSort={setSort}>Espera</ColunaOrdenavel></th>
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
                    </td>
                    {/* O setor era uma segunda linha embaixo do responsável e
                      * não dava para ordenar por ele. Como o menu de setor saiu
                      * da barra, virou coluna própria com cabeçalho clicável. */}
                    <td class="p-2 align-top">
                      <div class="text-fg truncate" title={c.team?.name ?? 'Sem setor'}>
                        {c.team?.name ?? <span class="text-fg-muted">Sem setor</span>}
                      </div>
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
