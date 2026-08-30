import { useEffect, useState } from 'preact/hooks'
import {
  GanttChart, RefreshCw, Pause, Play, Trash2, X as XIcon,
  AlertTriangle, CheckCircle, Send, Mail, MessageSquare, Webhook, Clock,
  TrendingUp, ShoppingBag, DollarSign, Target, HelpCircle,
} from '@/components/ui/icon-set'
import { HowItWorksModal } from '@/components/ui/HowItWorksModal'
import {
  useQueues,
  useQueueJobs,
  useQueueJob,
  useQueueStats,
  useSends,
  useSendDetail,
  useRetryAllFailed,
  useRetryJob,
  useDeleteJob,
  usePauseQueue,
  useResumeQueue,
  useCleanQueue,
  type JobStatus,
  type QueueStats,
  type OutboundSend,
  type SendStatus,
  type SendChannel,
  type SendsFilters,
} from '@/hooks/useQueues'
import {
  useSales,
  useSalesDashboard,
  useConfirmSale,
  useRejectSale,
  type DetectedSale,
} from '@/hooks/useSales'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { KpiCard } from '@/components/ui/KpiCard'
import { Input, Select } from '@/components/ui/Input'
import { cn } from '@/lib/cn'
import { toast } from '@/lib/toast'

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const intf = new Intl.NumberFormat('pt-BR')

const QUEUE_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  email: 'Email',
  sms: 'SMS',
  webhook: 'Webhook',
  'internal-task': 'Tarefas',
  'workflow-step': 'Workflow Steps',
  enrichment: 'Enriquecimento',
  'document-review': 'Revisão Doc.',
  'essay-correction': 'Correção Redação',
  'cadence-scheduler': 'Cadências',
  'priority-score': 'Priority Score',
}

const QUEUE_COLORS: Record<string, string> = {
  whatsapp: '#25d366',
  email: '#1a73e8',
  sms: '#ff6d00',
  webhook: '#8e24aa',
  'internal-task': '#f9ab00',
  'workflow-step': '#e37400',
  enrichment: '#00897b',
  'document-review': '#5e35b1',
  'essay-correction': '#c62828',
  'cadence-scheduler': '#0277bd',
  'priority-score': '#6d4c41',
}

const CHANNEL_ICONS: Record<SendChannel, any> = {
  whatsapp: MessageSquare,
  email: Mail,
  sms: Send,
  webhook: Webhook,
}

const STATUS_TABS: { value: JobStatus; label: string }[] = [
  { value: 'waiting', label: 'Aguardando' },
  { value: 'active', label: 'Ativo' },
  { value: 'delayed', label: 'Atrasado' },
  { value: 'completed', label: 'Concluído' },
  { value: 'failed', label: 'Falhou' },
]

function counterColor(value: number, kind: 'waiting' | 'active' | 'delayed' | 'completed' | 'failed') {
  if (kind === 'failed' && value > 0) return 'text-danger'
  if (kind === 'active' && value > 0) return 'text-info'
  if (kind === 'delayed' && value > 0) return 'text-warning'
  if (kind === 'completed') return 'text-success'
  return 'text-fg-muted'
}

type Tab = 'overview' | 'sends' | 'sales' | 'jobs'

export function JobsPage() {
  const [tab, setTab] = useState<Tab>('overview')
  const [drawerJob, setDrawerJob] = useState<{ name: string; id: string | number } | null>(null)
  const [drawerSend, setDrawerSend] = useState<number | null>(null)
  const [showHowItWorks, setShowHowItWorks] = useState(false)

  return (
    <Page
      title="Filas & Monitor"
      description="Filas, envios outbound, vendas detectadas e jobs avançados"
      actions={
        <Button variant="ghost" size="sm" onClick={() => setShowHowItWorks(true)}>
          <HelpCircle size={14} /> Como funciona?
        </Button>
      }
    >
      <div class="flex border-b border-border overflow-x-auto">
        {([
          { id: 'overview', label: 'Visão Geral', Icon: TrendingUp },
          { id: 'sends', label: 'Envios', Icon: Send },
          { id: 'sales', label: 'Vendas', Icon: ShoppingBag },
          { id: 'jobs', label: 'Jobs Avançado', Icon: GanttChart },
        ] as const).map((t) => {
          const active = tab === t.id
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              class={cn(
                'h-10 px-4 text-sm flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap',
                active
                  ? 'border-info text-info font-semibold'
                  : 'border-transparent text-fg-muted hover:text-fg',
              )}
            >
              <t.Icon size={14} />
              {t.label}
            </button>
          )
        })}
      </div>

      {tab === 'overview' && <OverviewTab />}
      {tab === 'sends' && <SendsTab onOpenSend={setDrawerSend} />}
      {tab === 'sales' && <SalesTab />}
      {tab === 'jobs' && <JobsAdvancedTab onOpenJob={(name, id) => setDrawerJob({ name, id })} />}

      {drawerJob && (
        <JobDetailDrawer queue={drawerJob.name} jobId={drawerJob.id} onClose={() => setDrawerJob(null)} />
      )}
      {drawerSend && (
        <SendDetailDrawer sendId={drawerSend} onClose={() => setDrawerSend(null)} />
      )}

      <HowItWorksModal
        open={showHowItWorks}
        onClose={() => setShowHowItWorks(false)}
        title="Como funcionam as Filas & Monitor?"
        problem={<>
          Por baixo do CRM rodam <strong>filas</strong> de tarefas (envio de WhatsApp, e-mail, SMS,
          webhook, retry, deteção de venda, sincronização de Meta Ads…). Quando algo falha ou
          atrasa, esta tela é onde você <strong>vê, depura e re-executa</strong>. É o "raio-X" técnico
          do sistema — útil pra admin/suporte.
        </>}
        steps={[
          {
            title: '📊 Visão Geral',
            body: <>KPIs e gráfico das filas: total de jobs ativos, pendentes, falhos, completos. Bate o olho aqui: se algum número de falhas tá subindo, tem alguma coisa errada.</>,
          },
          {
            title: '📤 Envios',
            body: <>Lista cada envio outbound (WhatsApp, e-mail, SMS, webhook) com status: enfileirado, processando, enviado, entregue, lido, falhou. Filtre por canal, lead, origem. Drill-down mostra payload + resposta do provedor.</>,
          },
          {
            title: '💰 Vendas',
            body: <>Vendas detectadas pela IA + vendas confirmadas. Liga a tela <strong>Vendas IA</strong> — é onde dá pra ver toda a fila de detecções (não só as pendentes de revisão).</>,
          },
          {
            title: '⚙️ Jobs (avançado)',
            body: <>Todas as filas (BullMQ) do sistema: cadência scheduler, retry de webhook, sync Meta Ads, etc. Pra cada uma, você vê jobs pendentes, ativos, completos, falhos. Pode <strong>retry, pausar, retomar</strong>.</>,
          },
          {
            title: '🔍 Drill em um job',
            body: <>Clique num job pra ver payload completo, tentativas, motivo da falha, stack trace. Útil pra diagnóstico. Botão <strong>Retry</strong> tenta de novo. <strong>Retry all failed</strong>: reseta tudo que tá vermelho na fila.</>,
          },
        ]}
        tip={{
          tone: 'warning',
          title: '⚠️ Use com cuidado',
          body: <>Esta tela é técnica. Pausar fila errada pode travar mensagens automáticas, retry em massa pode causar duplicidade. Antes de mexer, entenda o que tá fazendo — em dúvida, abra um chamado com o suporte em vez de tentar.</>,
        }}
      />
    </Page>
  )
}

// ── Visão Geral ─────────────────────────────────────────

function OverviewTab() {
  const stats = useQueueStats(24)
  const queues = useQueues()
  const pause = usePauseQueue()
  const resume = useResumeQueue()

  return (
    <div class="space-y-4">
      <section class="grid gap-3 grid-cols-2 sm:grid-cols-4">
        {(['whatsapp', 'email', 'sms', 'webhook'] as SendChannel[]).map((ch) => {
          const data = stats.data?.byChannel?.[ch]
          const Icon = CHANNEL_ICONS[ch]
          return (
            <Card key={ch} class="p-3">
              <div class="flex items-center gap-2 mb-2">
                <Icon size={14} style={{ color: QUEUE_COLORS[ch] }} />
                <span class="text-xs font-semibold text-fg uppercase tracking-wider">{QUEUE_LABELS[ch]}</span>
              </div>
              {stats.isLoading ? (
                <Skeleton class="h-12 w-full" />
              ) : (
                <div class="grid grid-cols-3 gap-1 text-center">
                  <div>
                    <div class="text-lg font-semibold text-success tabular-nums">{intf.format(data?.sent ?? 0)}</div>
                    <div class="text-3xs text-fg-muted">Enviados</div>
                  </div>
                  <div>
                    <div class="text-lg font-semibold text-danger tabular-nums">{intf.format(data?.failed ?? 0)}</div>
                    <div class="text-3xs text-fg-muted">Falhas</div>
                  </div>
                  <div>
                    <div class="text-lg font-semibold text-fg-muted tabular-nums">
                      {data?.avgLatencyMs != null ? `${(data.avgLatencyMs / 1000).toFixed(1)}s` : '–'}
                    </div>
                    <div class="text-3xs text-fg-muted">Latência</div>
                  </div>
                </div>
              )}
            </Card>
          )
        })}
      </section>

      {stats.data && stats.data.topErrors.length > 0 && (
        <Card>
          <h4 class="text-sm font-semibold text-fg mb-2 flex items-center gap-1.5">
            <AlertTriangle size={14} class="text-warning" /> Erros mais frequentes (24h)
          </h4>
          <div class="space-y-1">
            {stats.data.topErrors.slice(0, 5).map((e, i) => (
              <div key={i} class="flex items-center gap-2 text-xs">
                <Badge tone="warning">{e.channel}</Badge>
                <span class="flex-1 truncate text-fg-muted" title={e.error}>{e.error}</span>
                <span class="text-fg font-mono tabular-nums">{e.total}×</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <h4 class="text-sm font-semibold text-fg mt-2">Filas BullMQ</h4>
      {queues.isLoading && (
        <div class="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          {Array.from({ length: 11 }).map((_, i) => <Skeleton key={i} class="h-32 w-full" />)}
        </div>
      )}

      {queues.data && (
        <div class="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          {queues.data.queues.map((q) => (
            <QueueCard
              key={q.name}
              q={q}
              onTogglePause={() => {
                const m = q.paused ? resume : pause
                m.mutate(q.name, {
                  onSuccess: () => toast(q.paused ? `Fila "${QUEUE_LABELS[q.name] ?? q.name}" retomada` : `Fila "${QUEUE_LABELS[q.name] ?? q.name}" pausada`, 'success'),
                  onError: (e: unknown) => toast((e as Error).message, 'danger'),
                })
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function QueueCard({ q, onTogglePause }: { q: QueueStats; onTogglePause: () => void }) {
  const label = QUEUE_LABELS[q.name] ?? q.name
  const color = QUEUE_COLORS[q.name] ?? 'var(--color-info)'
  const counters: { kind: 'waiting' | 'active' | 'delayed' | 'completed' | 'failed'; label: string; value: number }[] = [
    { kind: 'waiting', label: 'Aguard.', value: q.waiting },
    { kind: 'active', label: 'Ativo', value: q.active },
    { kind: 'delayed', label: 'Atrasado', value: q.delayed },
    { kind: 'completed', label: 'OK', value: q.completed },
    { kind: 'failed', label: 'Falhou', value: q.failed },
  ]
  return (
    <div
      class={cn(
        'rounded-lg border p-4 bg-surface',
        q.paused ? 'border-warning/40 bg-warning/5' : 'border-border',
      )}
    >
      <div class="flex items-center justify-between mb-3 gap-2">
        <div class="flex items-center gap-1.5 min-w-0">
          <span class="text-sm font-semibold truncate" style={{ color }}>{label}</span>
          {q.paused && <Badge tone="warning">pausado</Badge>}
        </div>
        <button
          type="button"
          onClick={onTogglePause}
          title={q.paused ? 'Retomar' : 'Pausar'}
          class="size-6 grid place-items-center rounded text-fg-muted hover:bg-surface-3 shrink-0"
        >
          {q.paused ? <Play size={12} /> : <Pause size={12} />}
        </button>
      </div>
      <div class="grid grid-cols-5 gap-1 text-center">
        {counters.map((c) => (
          <div key={c.kind}>
            <div class={cn('text-base font-semibold tabular-nums', counterColor(c.value, c.kind))}>{c.value}</div>
            <div class="text-3xs text-fg-muted mt-0.5">{c.label}</div>
          </div>
        ))}
      </div>
      <div class="text-3xs text-fg-muted font-mono mt-2 truncate">queue:{q.name}</div>
    </div>
  )
}

// ── Envios ──────────────────────────────────────────────

function SendsTab({ onOpenSend }: { onOpenSend: (id: number) => void }) {
  const [filters, setFilters] = useState<SendsFilters>({ sinceHours: 168, limit: 50, offset: 0 })
  const { data, isLoading } = useSends(filters)

  function update<K extends keyof SendsFilters>(k: K, v: SendsFilters[K]) {
    setFilters((f) => ({ ...f, [k]: v, offset: 0 }))
  }

  return (
    <div class="space-y-4">
      <Card>
        <div class="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
          <div class="flex flex-col gap-1">
            <span class="text-xs font-medium text-fg-muted">Canal</span>
            <Select value={filters.channel ?? ''} onChange={(e) => update('channel', ((e.target as HTMLSelectElement).value || undefined) as SendChannel | undefined)}>
              <option value="">Todos</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="email">Email</option>
              <option value="sms">SMS</option>
              <option value="webhook">Webhook</option>
            </Select>
          </div>
          <div class="flex flex-col gap-1">
            <span class="text-xs font-medium text-fg-muted">Status</span>
            <Select value={filters.status ?? ''} onChange={(e) => update('status', ((e.target as HTMLSelectElement).value || undefined) as SendStatus | undefined)}>
              <option value="">Todos</option>
              <option value="processing">Processando</option>
              <option value="sent">Enviado</option>
              <option value="delivered">Entregue</option>
              <option value="read">Lido</option>
              <option value="failed">Falhou</option>
            </Select>
          </div>
          <div class="flex flex-col gap-1">
            <span class="text-xs font-medium text-fg-muted">Período</span>
            <Select value={String(filters.sinceHours ?? 168)} onChange={(e) => update('sinceHours', parseInt((e.target as HTMLSelectElement).value))}>
              <option value="24">Últimas 24h</option>
              <option value="72">3 dias</option>
              <option value="168">7 dias</option>
              <option value="720">30 dias</option>
            </Select>
          </div>
          <Input
            label="Buscar (destinatário/erro)"
            value={filters.search ?? ''}
            onInput={(e) => update('search', (e.target as HTMLInputElement).value || undefined)}
          />
        </div>
      </Card>

      <Card class="p-0 overflow-hidden">
        {isLoading && (
          <div class="p-4 flex flex-col gap-2">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} class="h-10 w-full" />)}
          </div>
        )}
        {!isLoading && data && data.sends.length === 0 && (
          <EmptyState
            icon={<Send size={20} />}
            title="Nenhum envio no filtro selecionado"
            description={filters.sinceHours && filters.sinceHours > 24 ? 'Tente um período maior ou remover filtros.' : undefined}
          />
        )}
        {!isLoading && data && data.sends.length > 0 && (
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="bg-surface-3 text-fg-muted text-2xs uppercase tracking-wider">
                <tr>
                  <th class="text-left px-3 py-2 font-medium">Canal</th>
                  <th class="text-left px-3 py-2 font-medium">Destinatário</th>
                  <th class="text-left px-3 py-2 font-medium">Lead</th>
                  <th class="text-left px-3 py-2 font-medium">Conteúdo</th>
                  <th class="text-left px-3 py-2 font-medium w-28">Status</th>
                  <th class="text-right px-3 py-2 font-medium w-20">Latência</th>
                  <th class="text-right px-3 py-2 font-medium w-44">Quando</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-border">
                {data.sends.map((s) => <SendRow key={s.id} send={s} onClick={() => onOpenSend(s.id)} />)}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > data.sends.length && (
          <div class="p-3 text-xs text-fg-muted text-center">
            Mostrando {data.sends.length} de {data.total} —
            <button type="button" class="ml-1 text-info hover:underline" onClick={() => setFilters((f) => ({ ...f, limit: (f.limit ?? 50) + 50 }))}>
              carregar mais
            </button>
          </div>
        )}
      </Card>
    </div>
  )
}

function SendRow({ send, onClick }: { send: OutboundSend; onClick: () => void }) {
  const Icon = CHANNEL_ICONS[send.channel]
  const tone =
    send.status === 'failed' ? 'danger' :
    send.status === 'sent' || send.status === 'delivered' ? 'success' :
    send.status === 'read' ? 'info' :
    send.status === 'processing' ? 'warning' :
    'info'
  return (
    <tr class="hover:bg-surface-3 cursor-pointer" onClick={onClick}>
      <td class="px-3 py-2">
        <div class="flex items-center gap-1.5 text-xs" style={{ color: QUEUE_COLORS[send.channel] }}>
          <Icon size={12} />
          <span class="font-medium">{QUEUE_LABELS[send.channel] ?? send.channel}</span>
        </div>
      </td>
      <td class="px-3 py-2 text-xs text-fg max-w-[180px] truncate" title={send.recipient}>{send.recipient}</td>
      <td class="px-3 py-2 text-xs text-fg-muted max-w-[150px] truncate" title={send.lead?.nome ?? ''}>
        {send.lead?.nome ?? send.lead?.empresa ?? (send.leadId ? `#${send.leadId}` : '–')}
      </td>
      <td class="px-3 py-2 text-xs text-fg-muted max-w-[280px] truncate" title={send.bodyPreview ?? ''}>
        {send.subject || send.bodyPreview || '–'}
      </td>
      <td class="px-3 py-2"><Badge tone={tone as any}>{send.status}</Badge></td>
      <td class="px-3 py-2 text-xs text-fg-muted text-right tabular-nums">
        {send.latencyMs != null ? `${(send.latencyMs / 1000).toFixed(1)}s` : '–'}
      </td>
      <td class="px-3 py-2 text-xs text-fg-muted text-right">
        {new Date(send.createdAt).toLocaleString('pt-BR')}
      </td>
    </tr>
  )
}

// ── Vendas ──────────────────────────────────────────────

function SalesTab() {
  const [days, setDays] = useState(30)
  const [statusFilter, setStatusFilter] = useState<string>('')
  const dashboard = useSalesDashboard(days)
  const list = useSales({ ...(statusFilter ? { status: statusFilter } : {}), limit: 50 })

  return (
    <div class="space-y-4">
      <Card>
        <div class="flex flex-wrap items-end gap-3">
          <div class="flex flex-col gap-1">
            <span class="text-xs font-medium text-fg-muted">Período</span>
            <Select value={String(days)} onChange={(e) => setDays(parseInt((e.target as HTMLSelectElement).value))}>
              <option value="7">7 dias</option>
              <option value="30">30 dias</option>
              <option value="90">90 dias</option>
              <option value="180">180 dias</option>
            </Select>
          </div>
          <div class="flex flex-col gap-1">
            <span class="text-xs font-medium text-fg-muted">Status</span>
            <Select value={statusFilter} onChange={(e) => setStatusFilter((e.target as HTMLSelectElement).value)}>
              <option value="">Todos</option>
              <option value="detected">Detectada</option>
              <option value="confirmed">Confirmada</option>
              <option value="rejected">Rejeitada</option>
            </Select>
          </div>
        </div>
      </Card>

      <section class="grid gap-3 grid-cols-2 sm:grid-cols-4">
        <KpiCard
          label="Vendas detectadas"
          value={dashboard.data?.totalSales ?? '—'}
          loading={dashboard.isLoading}
          icon={<Target size={16} />}
        />
        <KpiCard
          label="Confirmadas"
          value={dashboard.data?.confirmedSales ?? '—'}
          loading={dashboard.isLoading}
          icon={<CheckCircle size={16} />}
        />
        <KpiCard
          label="Receita confirmada"
          value={dashboard.data ? brl.format(dashboard.data.totalValue) : '—'}
          loading={dashboard.isLoading}
          icon={<DollarSign size={16} />}
        />
        <KpiCard
          label="Ticket médio"
          value={dashboard.data && dashboard.data.avgTicket ? brl.format(dashboard.data.avgTicket) : '—'}
          loading={dashboard.isLoading}
          icon={<TrendingUp size={16} />}
        />
      </section>

      <Card class="p-0 overflow-hidden">
        <div class="p-3 border-b border-border">
          <h4 class="text-sm font-semibold text-fg">Vendas detectadas</h4>
        </div>
        {list.isLoading && (
          <div class="p-4 flex flex-col gap-2">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} class="h-10 w-full" />)}
          </div>
        )}
        {!list.isLoading && list.data && list.data.sales.length === 0 && (
          <EmptyState icon={<ShoppingBag size={20} />} title="Nenhuma venda no filtro" />
        )}
        {!list.isLoading && list.data && list.data.sales.length > 0 && (
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="bg-surface-3 text-fg-muted text-2xs uppercase tracking-wider">
                <tr>
                  <th class="text-left px-3 py-2 font-medium">Lead</th>
                  <th class="text-left px-3 py-2 font-medium">Produto</th>
                  <th class="text-right px-3 py-2 font-medium">Valor</th>
                  <th class="text-left px-3 py-2 font-medium">Origem</th>
                  <th class="text-left px-3 py-2 font-medium w-28">Status</th>
                  <th class="text-left px-3 py-2 font-medium w-44">Detectada em</th>
                  <th class="text-right px-3 py-2 font-medium w-32">Ações</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-border">
                {list.data.sales.map((sale) => <SaleRow key={sale.id} sale={sale} />)}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

function SaleRow({ sale }: { sale: DetectedSale }) {
  const confirm = useConfirmSale()
  const reject = useRejectSale()
  const tone =
    sale.status === 'confirmed' ? 'success' :
    sale.status === 'rejected' ? 'danger' :
    'warning'
  return (
    <tr class="hover:bg-surface-3">
      <td class="px-3 py-2 text-xs">
        <a href={`/app/leads/${sale.leadId}`} class="text-info hover:underline">
          {sale.lead?.nome ?? sale.lead?.empresa ?? `#${sale.leadId}`}
        </a>
      </td>
      <td class="px-3 py-2 text-xs text-fg-muted max-w-[200px] truncate" title={sale.productService ?? ''}>
        {sale.productService ?? '–'}
      </td>
      <td class="px-3 py-2 text-xs text-right tabular-nums font-medium text-fg">
        {sale.value != null ? brl.format(Number(sale.value)) : '–'}
      </td>
      <td class="px-3 py-2 text-xs text-fg-muted">{sale.originType ?? '–'}</td>
      <td class="px-3 py-2"><Badge tone={tone as any}>{sale.status}</Badge></td>
      <td class="px-3 py-2 text-xs text-fg-muted">{new Date(sale.detectedAt).toLocaleString('pt-BR')}</td>
      <td class="px-3 py-2 text-right">
        {sale.status === 'detected' && (
          <div class="inline-flex gap-1">
            <Button
              variant="success"
              size="sm"
              disabled={confirm.isPending}
              onClick={() => confirm.mutate({ id: sale.id }, {
                onSuccess: () => toast('Venda confirmada', 'success'),
                onError: (e: unknown) => toast((e as Error).message, 'danger'),
              })}
            >
              Confirmar
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={reject.isPending}
              onClick={() => reject.mutate(sale.id, {
                onSuccess: () => toast('Venda rejeitada', 'info'),
                onError: (e: unknown) => toast((e as Error).message, 'danger'),
              })}
            >
              Rejeitar
            </Button>
          </div>
        )}
      </td>
    </tr>
  )
}

// ── Jobs Avançado ───────────────────────────────────────

function JobsAdvancedTab({ onOpenJob }: { onOpenJob: (name: string, id: string | number) => void }) {
  const queues = useQueues()
  const [selected, setSelected] = useState<string | null>(null)
  const [status, setStatus] = useState<JobStatus>('failed')
  const [confirmRetry, setConfirmRetry] = useState(false)
  const retryAll = useRetryAllFailed()
  const cleanQueue = useCleanQueue()

  function handleRetryConfirmed() {
    if (!selected) return
    retryAll.mutate(selected, {
      onSuccess: (r) => {
        toast(`${r.retried} jobs re-enfileirados`, 'success')
        setConfirmRetry(false)
      },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <div class="space-y-4">
      {queues.isLoading && (
        <div class="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          {Array.from({ length: 11 }).map((_, i) => <Skeleton key={i} class="h-24 w-full" />)}
        </div>
      )}

      {queues.data && (
        <div class="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
          {queues.data.queues.map((q) => (
            <button
              key={q.name}
              type="button"
              onClick={() => setSelected(q.name)}
              class={cn(
                'text-left rounded-lg border p-3 transition-colors',
                selected === q.name ? 'border-info bg-info/5 ring-1 ring-info/40' : 'border-border bg-surface hover:bg-surface-2',
              )}
            >
              <div class="flex items-center justify-between mb-2">
                <span class="text-sm font-semibold" style={{ color: QUEUE_COLORS[q.name] }}>
                  {QUEUE_LABELS[q.name] ?? q.name}
                </span>
                {q.failed > 0 && <Badge tone="danger">{q.failed}</Badge>}
              </div>
              <div class="text-2xs text-fg-muted">
                {q.waiting} aguard · {q.active} ativo · {q.delayed} atrasado
              </div>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div class="rounded-lg border border-border bg-surface overflow-hidden">
          <div class="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-border">
            <h3 class="text-sm font-semibold text-fg flex-1 min-w-0">
              Jobs — <span class="font-mono">{selected}</span>
            </h3>
            <div class="flex items-center gap-1 flex-wrap">
              {STATUS_TABS.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  class={cn(
                    'h-7 px-2 text-xs rounded-md border transition-colors',
                    status === s.value
                      ? 'bg-info text-on-info border-info'
                      : 'bg-surface border-border text-fg-muted hover:bg-surface-3',
                  )}
                  onClick={() => setStatus(s.value)}
                >
                  {s.label}
                </button>
              ))}
              <Button
                variant="danger"
                size="sm"
                class="ml-2"
                onClick={() => setConfirmRetry(true)}
                disabled={retryAll.isPending}
              >
                <RefreshCw size={12} /> Retry todos falhados
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => cleanQueue.mutate({ name: selected, status: 'completed' }, {
                  onSuccess: (r) => toast(`${r.cleaned} jobs limpos`, 'success'),
                })}
              >
                <Trash2 size={12} /> Limpar concluídos
              </Button>
            </div>
          </div>
          <JobsTable queueName={selected} status={status} onOpenJob={onOpenJob} />
        </div>
      )}

      {confirmRetry && (
        <ConfirmDialog
          open
          onOpenChange={(o) => { if (!o) setConfirmRetry(false) }}
          title={`Retry todos os jobs falhados de "${selected}"?`}
          description="Os jobs com status failed serão re-enfileirados para nova tentativa."
          confirmLabel="Retry"
          loading={retryAll.isPending}
          onConfirm={handleRetryConfirmed}
        />
      )}
    </div>
  )
}

function JobsTable({ queueName, status, onOpenJob }: { queueName: string; status: JobStatus; onOpenJob: (name: string, id: string | number) => void }) {
  const { data, isLoading } = useQueueJobs(queueName, status)

  if (isLoading) {
    return (
      <div class="p-4 flex flex-col gap-2">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} class="h-10 w-full" />)}
      </div>
    )
  }

  if (!data || data.jobs.length === 0) {
    return <div class="p-8"><EmptyState title="Nenhuma tarefa neste status" /></div>
  }

  return (
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-surface-3 text-fg-muted text-2xs uppercase tracking-wider">
          <tr>
            <th class="text-left px-4 py-2 font-medium">ID</th>
            <th class="text-left px-3 py-2 font-medium">Dados</th>
            <th class="text-left px-3 py-2 font-medium w-28">Tentativas</th>
            <th class="text-left px-3 py-2 font-medium">Erro</th>
            <th class="text-left px-3 py-2 font-medium w-44">Timestamp</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border">
          {data.jobs.map((j) => (
            <tr key={String(j.id)} class="hover:bg-surface-3 cursor-pointer" onClick={() => onOpenJob(queueName, j.id)}>
              <td class="px-4 py-2 font-mono text-xs text-fg">{String(j.id)}</td>
              <td class="px-3 py-2 text-xs text-fg-muted max-w-[250px] truncate" title={JSON.stringify(j.data ?? {})}>
                {JSON.stringify(j.data ?? {}).substring(0, 100)}
              </td>
              <td class="px-3 py-2 text-xs text-fg-muted tabular-nums">{j.attempts ?? 0}/{j.maxAttempts ?? '-'}</td>
              <td class="px-3 py-2 text-xs text-danger max-w-[200px] truncate" title={j.failedReason ?? undefined}>
                {j.failedReason ?? '-'}
              </td>
              <td class="px-3 py-2 text-xs text-fg-muted">
                {j.timestamp ? new Date(j.timestamp).toLocaleString('pt-BR') : '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Drawer de detalhe de Job ────────────────────────────

function JobDetailDrawer({ queue, jobId, onClose }: { queue: string; jobId: string | number; onClose: () => void }) {
  const { data, isLoading } = useQueueJob(queue, jobId)
  const retry = useRetryJob()
  const del = useDeleteJob()

  useEffect(() => {
    function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onEsc)
    return () => document.removeEventListener('keydown', onEsc)
  }, [onClose])

  return (
    <div class="fixed inset-0 z-40">
      <div class="absolute inset-0 bg-black/50" onClick={onClose} />
      <div class="absolute right-0 top-0 bottom-0 w-full max-w-xl bg-surface-2 border-l border-border overflow-y-auto">
        <div class="sticky top-0 bg-surface-2 border-b border-border p-4 flex items-center gap-2 z-10">
          <h3 class="text-sm font-semibold text-fg flex-1">Tarefa — {queue} #{String(jobId)}</h3>
          <Button variant="ghost" size="sm" onClick={onClose}><XIcon size={14} /></Button>
        </div>
        <div class="p-4 space-y-4">
          {isLoading && <Skeleton class="h-32 w-full" />}
          {data && (
            <>
              <div class="flex flex-wrap gap-2 text-xs">
                <Badge tone="info">{data.job.attempts}/{data.job.maxAttempts ?? '–'} tentativas</Badge>
                {data.job.processedOn && <Badge tone="info">processado em {new Date(data.job.processedOn).toLocaleString('pt-BR')}</Badge>}
                {data.job.finishedOn && <Badge tone="success">finalizado em {new Date(data.job.finishedOn).toLocaleString('pt-BR')}</Badge>}
              </div>
              <div>
                <h4 class="text-xs font-semibold text-fg-muted uppercase mb-1">Dados</h4>
                <pre class="text-2xs bg-surface-3 p-2 rounded overflow-x-auto">{JSON.stringify(data.job.data, null, 2)}</pre>
              </div>
              {data.job.failedReason && (
                <div>
                  <h4 class="text-xs font-semibold text-danger uppercase mb-1">Erro</h4>
                  <pre class="text-2xs bg-danger/10 text-danger p-2 rounded overflow-x-auto whitespace-pre-wrap">{data.job.failedReason}</pre>
                </div>
              )}
              {data.job.stacktrace && data.job.stacktrace.length > 0 && (
                <div>
                  <h4 class="text-xs font-semibold text-fg-muted uppercase mb-1">Stack trace ({data.job.stacktrace.length})</h4>
                  <pre class="text-2xs bg-surface-3 p-2 rounded overflow-x-auto max-h-64">{data.job.stacktrace.join('\n\n')}</pre>
                </div>
              )}
              {data.job.returnvalue && (
                <div>
                  <h4 class="text-xs font-semibold text-success uppercase mb-1">Retorno</h4>
                  <pre class="text-2xs bg-surface-3 p-2 rounded overflow-x-auto">{JSON.stringify(data.job.returnvalue, null, 2)}</pre>
                </div>
              )}
              <div class="flex gap-2 pt-2 border-t border-border">
                <Button
                  variant="primary"
                  size="sm"
                  disabled={retry.isPending}
                  onClick={() => retry.mutate({ name: queue, id: jobId }, {
                    onSuccess: () => { toast('Job re-enfileirado', 'success'); onClose() },
                    onError: (e: unknown) => toast((e as Error).message, 'danger'),
                  })}
                >
                  <RefreshCw size={12} /> Retry
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={del.isPending}
                  onClick={() => del.mutate({ name: queue, id: jobId }, {
                    onSuccess: () => { toast('Job removido', 'success'); onClose() },
                    onError: (e: unknown) => toast((e as Error).message, 'danger'),
                  })}
                >
                  <Trash2 size={12} /> Remover
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Drawer de detalhe de Envio ──────────────────────────

function SendDetailDrawer({ sendId, onClose }: { sendId: number; onClose: () => void }) {
  const { data, isLoading } = useSendDetail(sendId)
  const send = data?.send

  useEffect(() => {
    function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onEsc)
    return () => document.removeEventListener('keydown', onEsc)
  }, [onClose])

  return (
    <div class="fixed inset-0 z-40">
      <div class="absolute inset-0 bg-black/50" onClick={onClose} />
      <div class="absolute right-0 top-0 bottom-0 w-full max-w-xl bg-surface-2 border-l border-border overflow-y-auto">
        <div class="sticky top-0 bg-surface-2 border-b border-border p-4 flex items-center gap-2 z-10">
          <h3 class="text-sm font-semibold text-fg flex-1">Envio #{sendId}</h3>
          <Button variant="ghost" size="sm" onClick={onClose}><XIcon size={14} /></Button>
        </div>
        <div class="p-4 space-y-4">
          {isLoading && <Skeleton class="h-32 w-full" />}
          {send && (
            <>
              <div class="flex flex-wrap gap-2 items-center">
                <Badge tone="info">{send.channel}</Badge>
                <Badge tone={send.status === 'failed' ? 'danger' : send.status === 'sent' || send.status === 'delivered' ? 'success' : 'warning'}>{send.status}</Badge>
                {send.latencyMs != null && <span class="text-xs text-fg-muted"><Clock size={10} class="inline" /> {(send.latencyMs / 1000).toFixed(2)}s</span>}
                <span class="text-xs text-fg-muted">{send.attempts}/{send.maxAttempts ?? '–'} tentativas</span>
              </div>
              <DetailRow label="Destinatário" value={send.recipient} />
              {send.lead && <DetailRow label="Lead" value={
                <a href={`/app/leads/${send.lead.id}`} class="text-info hover:underline">
                  {send.lead.nome ?? send.lead.empresa ?? `#${send.lead.id}`}
                </a>
              } />}
              {send.subject && <DetailRow label="Assunto" value={send.subject} />}
              {send.bodyPreview && (
                <div>
                  <h4 class="text-xs font-semibold text-fg-muted uppercase mb-1">Conteúdo (prévia)</h4>
                  <pre class="text-2xs bg-surface-3 p-2 rounded overflow-x-auto whitespace-pre-wrap">{send.bodyPreview}</pre>
                </div>
              )}
              <div>
                <h4 class="text-xs font-semibold text-fg-muted uppercase mb-2">Timeline</h4>
                <div class="space-y-1 text-xs">
                  <TimelineRow label="Criado" at={send.createdAt} />
                  <TimelineRow label="Processando" at={send.processingAt} />
                  <TimelineRow label="Enviado" at={send.sentAt} done={send.sentAt != null} />
                  <TimelineRow label="Entregue" at={send.deliveredAt} done={send.deliveredAt != null} />
                  <TimelineRow label="Lido" at={send.readAt} done={send.readAt != null} />
                  {send.failedAt && <TimelineRow label="Falhou" at={send.failedAt} fail />}
                </div>
              </div>
              {send.error && (
                <div>
                  <h4 class="text-xs font-semibold text-danger uppercase mb-1">Erro</h4>
                  <pre class="text-2xs bg-danger/10 text-danger p-2 rounded overflow-x-auto whitespace-pre-wrap">{send.error}</pre>
                </div>
              )}
              {send.externalId && <DetailRow label="ID externo" value={<code class="font-mono text-2xs">{send.externalId}</code>} />}
              {send.metadata && (
                <div>
                  <h4 class="text-xs font-semibold text-fg-muted uppercase mb-1">Metadata</h4>
                  <pre class="text-2xs bg-surface-3 p-2 rounded overflow-x-auto">{JSON.stringify(send.metadata, null, 2)}</pre>
                </div>
              )}
              <DetailRow label="Origem" value={send.source ? `${send.source}${send.sourceId ? ` #${send.sourceId}` : ''}` : '–'} />
              {send.jobId && <DetailRow label="Job ID" value={<code class="font-mono text-2xs">{send.jobId}</code>} />}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: any }) {
  return (
    <div class="flex items-center gap-2 text-xs">
      <span class="text-fg-muted w-24 shrink-0">{label}:</span>
      <span class="text-fg flex-1 break-words">{value}</span>
    </div>
  )
}

function TimelineRow({ label, at, done = false, fail = false }: { label: string; at: string | null; done?: boolean; fail?: boolean }) {
  return (
    <div class="flex items-center gap-2">
      <span class={cn(
        'size-1.5 rounded-full',
        fail ? 'bg-danger' : done ? 'bg-success' : at ? 'bg-info' : 'bg-fg-muted/30',
      )} />
      <span class={cn('w-24', at ? 'text-fg' : 'text-fg-muted')}>{label}</span>
      <span class="text-fg-muted">{at ? new Date(at).toLocaleString('pt-BR') : '—'}</span>
    </div>
  )
}
