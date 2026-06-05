import { useEffect, useMemo, useState } from 'preact/hooks'
import {
  TrendingUp, Check, X as XIcon, DollarSign, Save, Settings, RotateCcw, Receipt, HelpCircle,
} from 'lucide-preact'
import {
  useSales,
  useSalesDashboard,
  useConfirmSale,
  useRejectSale,
  useSalesSettings,
  useSaveSalesSettings,
  type DetectedSale,
  type SalesSettingsRaw,
} from '@/hooks/useSales'
import { useFunnels, useStages, type FunnelStage } from '@/hooks/useFunnels'
import { Page } from '@/components/ui/Page'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { KpiCard } from '@/components/ui/KpiCard'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { Input, Textarea } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { formatDateShort, formatDateTime } from '@/lib/format'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/cn'

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

const ORIGIN_LABELS: Record<string, string> = {
  trackable_link: 'Link Rastreável',
  meta_ctwa: 'Meta Ads (CTWA)',
  google_ads: 'Google Ads',
  meta_lead_ads: 'Meta Lead Ads',
  organic: 'Orgânico',
  web_form: 'Formulário Web',
  scheduling: 'Agendamento',
  manual: 'Manual',
  whatsapp: 'WhatsApp Direto',
}

const ORIGIN_COLORS: Record<string, string> = {
  trackable_link: '#ff9800',
  meta_ctwa: '#1877f2',
  google_ads: '#34a853',
  meta_lead_ads: '#e91e63',
  organic: '#9e9e9e',
  web_form: '#00bcd4',
  scheduling: '#0ea5e9',
  manual: '#795548',
  whatsapp: '#25d366',
}

const PERIOD_OPTIONS = [7, 15, 30, 60, 90]

type Tab = 'dashboard' | 'queue' | 'settings'
type QueueStatus = 'detected' | 'confirmed' | 'rejected'

export function SalesAiPage() {
  const [tab, setTab] = useState<Tab>('dashboard')
  const [days, setDays] = useState(30)
  const [showHowItWorks, setShowHowItWorks] = useState(false)
  const { data: dashboard, isLoading: dashLoading } = useSalesDashboard(days)

  return (
    <Page
      title="Vendas IA"
      description="A IA lê suas conversas, identifica vendas fechadas e te avisa pra confirmar. Você só revisa e clica em Confirmar ou Rejeitar."
      actions={
        <Button variant="ghost" size="sm" onClick={() => setShowHowItWorks(true)}>
          <HelpCircle size={14} /> Como funciona?
        </Button>
      }
    >
      <section class="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Vendas Detectadas"
          value={dashboard?.totalSales ?? '—'}
          loading={dashLoading}
          icon={<TrendingUp size={16} />}
        />
        <KpiCard
          label="Valor Total"
          value={dashboard ? brl.format(dashboard.totalValue) : '—'}
          loading={dashLoading}
          icon={<DollarSign size={16} />}
        />
        <KpiCard
          label="Ticket Médio"
          value={dashboard ? brl.format(dashboard.avgTicket) : '—'}
          loading={dashLoading}
          icon={<Receipt size={16} />}
        />
        <KpiCard
          label="Confirmadas"
          value={dashboard?.confirmedSales ?? '—'}
          loading={dashLoading}
          icon={<Check size={16} />}
        />
      </section>

      <div class="flex gap-1 border-b border-border overflow-x-auto">
        <TabButton active={tab === 'dashboard'} onClick={() => setTab('dashboard')}>Painel</TabButton>
        <TabButton active={tab === 'queue'} onClick={() => setTab('queue')}>Fila de Revisão</TabButton>
        <TabButton active={tab === 'settings'} onClick={() => setTab('settings')}>Configurações</TabButton>
      </div>

      {tab === 'dashboard' && (
        <DashboardTab
          days={days}
          onDays={setDays}
          dashboard={dashboard}
          loading={dashLoading}
        />
      )}
      {tab === 'queue' && <QueueTab />}
      {tab === 'settings' && <SettingsTab />}

      {showHowItWorks && (
        <HowItWorksModal
          onClose={() => setShowHowItWorks(false)}
          onGoQueue={() => { setShowHowItWorks(false); setTab('queue') }}
          onGoSettings={() => { setShowHowItWorks(false); setTab('settings') }}
        />
      )}
    </Page>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: preact.ComponentChildren }) {
  return (
    <button
      type="button"
      onClick={onClick}
      class={cn(
        'px-3 h-9 -mb-px border-b-2 text-sm font-medium whitespace-nowrap transition-colors',
        active ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:text-fg',
      )}
    >
      {children}
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard tab

interface DashboardData {
  totalSales: number
  confirmedSales: number
  totalValue: number
  avgTicket: number
  salesByOrigin: { originType: string; count: number; totalValue: number }[]
  salesByDay: { date: string; count: number; totalValue: number }[]
  salesByCampaign: { campaignName: string; campaignId: string; count: number; totalValue: number }[]
}

function DashboardTab({
  days,
  onDays,
  dashboard,
  loading,
}: {
  days: number
  onDays: (d: number) => void
  dashboard: DashboardData | undefined
  loading: boolean
}) {
  return (
    <>
      <div class="flex flex-wrap gap-2">
        {PERIOD_OPTIONS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onDays(p)}
            class={cn(
              'px-4 h-8 rounded-md border text-xs font-medium transition-colors',
              days === p
                ? 'border-accent bg-accent/15 text-accent'
                : 'border-border bg-surface text-fg-muted hover:text-fg',
            )}
          >
            {p}d
          </button>
        ))}
      </div>

      <section class="grid gap-3 grid-cols-1 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Vendas por Dia</CardTitle>
            <span class="text-xs text-fg-subtle">{dashboard?.salesByDay.length ?? 0} dias</span>
          </CardHeader>
          {loading ? (
            <Skeleton class="h-44 w-full" />
          ) : !dashboard || dashboard.salesByDay.length === 0 ? (
            <EmptyState description="Sem dados no período" />
          ) : (
            <SalesByDayChart data={dashboard.salesByDay} />
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Vendas por Origem</CardTitle>
            <span class="text-xs text-fg-subtle">{dashboard?.salesByOrigin.length ?? 0} origens</span>
          </CardHeader>
          {loading ? (
            <Skeleton class="h-44 w-full" />
          ) : !dashboard || dashboard.salesByOrigin.length === 0 ? (
            <EmptyState description="Sem dados no período" />
          ) : (
            <SalesByOriginChart data={dashboard.salesByOrigin} />
          )}
        </Card>
      </section>

      <Card class="p-0 overflow-hidden">
        <div class="px-4 pt-4 pb-3 flex items-center justify-between gap-3">
          <CardTitle>Vendas por Campanha</CardTitle>
          <span class="text-xs text-fg-subtle">{dashboard?.salesByCampaign.length ?? 0} campanha(s)</span>
        </div>
        {loading && <div class="px-4 pb-4"><Skeleton class="h-32 w-full" /></div>}
        {!loading && (!dashboard || dashboard.salesByCampaign.length === 0) && (
          <div class="p-8"><EmptyState description="Sem dados no período" /></div>
        )}
        {!loading && dashboard && dashboard.salesByCampaign.length > 0 && (
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="text-[0.6875rem] uppercase tracking-wider text-fg-subtle border-b border-border">
                  <th class="text-left px-3 py-2 font-medium">Campanha</th>
                  <th class="text-center px-3 py-2 font-medium">Vendas</th>
                  <th class="text-right px-3 py-2 font-medium">Valor Total</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-border">
                {dashboard.salesByCampaign.map((c, i) => (
                  <tr key={`${c.campaignId ?? 'none'}-${i}`}>
                    <td class="px-3 py-2 text-fg font-medium break-words">{c.campaignName ?? 'Sem campanha'}</td>
                    <td class="px-3 py-2 text-center tabular-nums font-semibold">{c.count.toLocaleString('pt-BR')}</td>
                    <td class="px-3 py-2 text-right tabular-nums font-semibold text-success">
                      {brl.format(Number(c.totalValue))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}

function SalesByDayChart({ data }: { data: { date: string; count: number; totalValue: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count))
  return (
    <div>
      <div class="flex items-end gap-1 h-40">
        {data.map((d) => {
          const pct = (d.count / max) * 100
          const fmt = formatDateShort(d.date)
          return (
            <div key={d.date} class="flex-1 flex flex-col items-center min-w-0" title={`${fmt}: ${d.count} vendas · ${brl.format(Number(d.totalValue))}`}>
              <div class="w-full flex flex-col justify-end h-full">
                <div
                  class="w-full bg-accent rounded-t-sm min-h-px"
                  style={{ height: `${pct}%` }}
                />
              </div>
              <div class="text-[0.5625rem] text-fg-subtle mt-1 truncate w-full text-center">{fmt}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function SalesByOriginChart({ data }: { data: { originType: string; count: number; totalValue: number }[] }) {
  const total = data.reduce((a, b) => a + b.count, 0)
  return (
    <ul class="space-y-2">
      {data.map((o) => {
        const label = ORIGIN_LABELS[o.originType] ?? o.originType ?? 'Outro'
        const color = ORIGIN_COLORS[o.originType] ?? 'var(--color-accent)'
        const pct = total > 0 ? Math.round((o.count / total) * 100) : 0
        return (
          <li key={o.originType ?? 'none'} class="flex items-center gap-3">
            <span class="size-3 rounded-full shrink-0" style={{ background: color }} />
            <span class="text-xs text-fg-muted flex-1 truncate" title={label}>{label}</span>
            <span class="text-xs text-fg tabular-nums w-10 text-right">{o.count}</span>
            <span class="text-[0.6875rem] text-fg-subtle tabular-nums w-10 text-right">{pct}%</span>
            <span class="text-xs text-fg-muted tabular-nums w-24 text-right truncate" title={brl.format(Number(o.totalValue))}>
              {brl.format(Number(o.totalValue))}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Queue tab

const CONFIDENCE_META: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  high: { label: 'Alta', tone: 'success' },
  medium: { label: 'Média', tone: 'warning' },
  low: { label: 'Baixa', tone: 'danger' },
}

const QUEUE_STATUS_LABELS: Record<QueueStatus, string> = {
  detected: 'Pendentes',
  confirmed: 'Confirmadas',
  rejected: 'Rejeitadas',
}

function QueueTab() {
  const [status, setStatus] = useState<QueueStatus>('detected')
  const [confirming, setConfirming] = useState<DetectedSale | null>(null)
  const [rejecting, setRejecting] = useState<DetectedSale | null>(null)

  const { data, isLoading } = useSales({ status, limit: 50 })
  const reject = useRejectSale()

  function doReject() {
    if (!rejecting) return
    reject.mutate(rejecting.id, {
      onSuccess: () => { toast('Venda rejeitada', 'success'); setRejecting(null) },
      onError: (e: unknown) => { toast((e as Error).message, 'danger'); setRejecting(null) },
    })
  }

  const sales = data?.sales ?? []
  const total = data?.total ?? 0

  return (
    <>
      <div class="flex flex-wrap gap-2">
        {(Object.keys(QUEUE_STATUS_LABELS) as QueueStatus[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            class={cn(
              'px-4 h-8 rounded-md border text-xs font-medium transition-colors',
              status === s
                ? 'border-accent bg-accent/15 text-accent'
                : 'border-border bg-surface text-fg-muted hover:text-fg',
            )}
          >
            {QUEUE_STATUS_LABELS[s]}
          </button>
        ))}
        <span class="text-xs text-fg-muted ml-auto self-center">{total} venda{total !== 1 ? 's' : ''}</span>
      </div>

      <Card class="p-0 overflow-hidden">
        {isLoading && (
          <div class="p-4 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} class="h-12 w-full" />)}
          </div>
        )}
        {!isLoading && sales.length === 0 && (
          <div class="p-8"><EmptyState title="Nenhuma venda nesta categoria" /></div>
        )}
        {!isLoading && sales.length > 0 && (
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="text-[0.6875rem] uppercase tracking-wider text-fg-subtle border-b border-border">
                  <th class="text-left px-3 py-2 font-medium">Lead</th>
                  <th class="text-right px-3 py-2 font-medium">Valor</th>
                  <th class="text-left px-3 py-2 font-medium">Produto</th>
                  <th class="text-center px-3 py-2 font-medium">Confiança</th>
                  <th class="text-left px-3 py-2 font-medium">Trecho</th>
                  <th class="text-left px-3 py-2 font-medium">Data</th>
                  {status === 'detected' && <th class="text-center px-3 py-2 font-medium">Ações</th>}
                </tr>
              </thead>
              <tbody class="divide-y divide-border">
                {sales.map((s) => {
                  const lead = s.lead
                  const leadName = lead?.nome ?? `Lead #${s.leadId}`
                  const empresa = lead?.empresa ?? ''
                  const conf = CONFIDENCE_META[s.confidence] ?? CONFIDENCE_META.low!
                  const snippet = s.conversationSnippet ?? ''
                  const snippetShort = snippet.length > 80 ? `${snippet.slice(0, 80)}…` : snippet
                  return (
                    <tr key={s.id}>
                      <td class="px-3 py-2 min-w-0">
                        <div class="text-fg font-medium break-words">{leadName}</div>
                        {empresa && <div class="text-[0.6875rem] text-fg-subtle break-words">{empresa}</div>}
                      </td>
                      <td class="px-3 py-2 text-right tabular-nums font-semibold text-success whitespace-nowrap">
                        {s.value !== null ? brl.format(s.value) : '—'}
                      </td>
                      <td class="px-3 py-2 text-fg-muted text-xs break-words max-w-40">{s.productService ?? '—'}</td>
                      <td class="px-3 py-2 text-center">
                        <Badge tone={conf.tone}>{conf.label}</Badge>
                      </td>
                      <td class="px-3 py-2 text-fg-muted text-xs break-words max-w-72" title={snippet}>
                        {snippetShort || '—'}
                      </td>
                      <td class="px-3 py-2 text-fg-muted text-xs whitespace-nowrap">
                        {formatDateTime(s.detectedAt)}
                      </td>
                      {status === 'detected' && (
                        <td class="px-3 py-2">
                          <div class="flex items-center justify-center gap-1.5 flex-wrap">
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={() => setConfirming(s)}
                            >
                              <Check size={12} /> Confirmar
                            </Button>
                            <Button
                              variant="danger"
                              size="sm"
                              onClick={() => setRejecting(s)}
                            >
                              <XIcon size={12} /> Rejeitar
                            </Button>
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {confirming && <ConfirmSaleModal sale={confirming} onClose={() => setConfirming(null)} />}
      {rejecting && (
        <ConfirmDialog
          open
          onOpenChange={(o) => { if (!o) setRejecting(null) }}
          title="Rejeitar venda?"
          description="Esta venda será marcada como falso positivo e não entra nos relatórios."
          confirmLabel="Rejeitar"
          destructive
          loading={reject.isPending}
          onConfirm={doReject}
        />
      )}
    </>
  )
}

function ConfirmSaleModal({ sale, onClose }: { sale: DetectedSale; onClose: () => void }) {
  const [valueInput, setValueInput] = useState(sale.value !== null ? String(sale.value) : '')
  const confirm = useConfirmSale()

  function handleConfirm() {
    const trimmed = valueInput.trim()
    const v = trimmed === '' ? undefined : Number(trimmed.replace(',', '.'))
    if (trimmed !== '' && (v === undefined || !Number.isFinite(v))) {
      toast('Valor inválido', 'danger')
      return
    }
    confirm.mutate({ id: sale.id, value: v }, {
      onSuccess: () => { toast('Venda confirmada', 'success'); onClose() },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  const leadName = sale.lead?.nome ?? `Lead #${sale.leadId}`

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Confirmar venda — ${leadName}`}
      description="Confirme o valor antes de marcar como venda fechada."
      size="md"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={confirm.isPending}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleConfirm} disabled={confirm.isPending}>
            <Check size={12} /> {confirm.isPending ? 'Confirmando…' : 'Confirmar'}
          </Button>
        </>
      }
    >
      <div class="space-y-3">
        <Input
          label="Valor da venda (R$)"
          type="number"
          step="0.01"
          value={valueInput}
          onInput={(e) => setValueInput((e.target as HTMLInputElement).value)}
          placeholder={sale.value !== null ? String(sale.value) : 'Ex.: 1500.00'}
          hint="Vazio mantém o valor sugerido pela IA"
        />
        {sale.productService && (
          <p class="text-xs text-fg-muted">
            Produto/serviço: <strong class="text-fg">{sale.productService}</strong>
          </p>
        )}
        {sale.conversationSnippet && (
          <div class="rounded-md border border-info/30 bg-info/10 p-3 text-xs text-info">
            <strong>Trecho da conversa:</strong>
            <p class="mt-1 italic">"{sale.conversationSnippet}"</p>
          </div>
        )}
        {sale.campaignName && (
          <p class="text-xs text-fg-muted">
            Campanha: <strong class="text-fg">{sale.campaignName}</strong>
          </p>
        )}
      </div>
    </Modal>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings tab

const DEFAULT_PROMPT = `Você é um analista de vendas especializado. Analise a conversa de WhatsApp abaixo entre um atendente e um cliente/lead.

Seu objetivo é determinar se uma VENDA foi CONCRETIZADA nesta conversa.

CRITÉRIOS PARA CONSIDERAR UMA VENDA:
- Cliente confirmou a compra explicitamente ("quero fechar", "vamos fechar", "pode fazer", "aceito", "fechado")
- Pagamento foi mencionado como realizado ("já paguei", "pix enviado", "boleto pago", "passou no cartão")
- Pedido foi confirmado ("pedido feito", "já encomendei")
- Contrato/proposta aceita ("assinei o contrato", "proposta aceita", "aprovado")
- Link de pagamento foi enviado E cliente confirmou pagamento
- Cliente forneceu dados de pagamento (cartão, pix, etc.)

NÃO É VENDA (falso positivo):
- Apenas pedir orçamento ou proposta
- Dizer que "vai pensar" ou "vou analisar"
- Perguntar preço sem confirmar compra
- Atendente enviar proposta mas sem confirmação do cliente
- Conversa ainda em negociação/dúvidas
- Cliente pedindo desconto sem fechar
- Agendamento de reunião ou demonstração
- Interesse sem compromisso ("achei interessante", "gostei")

SOBRE O VALOR:
- Extraia o valor EXATO mencionado na conversa (em reais)
- Se houver múltiplos valores, use o valor FINAL acordado
- Se o valor não foi mencionado, retorne null
- Converta para número decimal (ex: "2 mil" = 2000, "1.500" = 1500)

SOBRE CONFIANÇA:
- "high": confirmação clara de pagamento ou aceite explícito
- "medium": forte indicação de fechamento mas sem confirmação 100% clara
- "low": possível venda mas com ambiguidade

Responda APENAS em JSON válido (sem markdown, sem backticks, sem explicação fora do JSON):
{"sale": true, "value": 1500.00, "product": "Plano Premium mensal", "confidence": "high", "explanation": "Cliente confirmou o pagamento via PIX do plano premium no valor de R$ 1.500", "snippet": "as 2-3 mensagens mais relevantes que comprovam a venda"}

Se NÃO houve venda:
{"sale": false, "value": null, "product": null, "confidence": "high", "explanation": "Conversa ainda em fase de negociação, sem confirmação de compra", "snippet": ""}`

function SettingsTab() {
  const { data, isLoading } = useSalesSettings()
  const save = useSaveSalesSettings()
  const { data: funnelsData } = useFunnels()
  const { data: stagesData } = useStages()

  const [enabled, setEnabled] = useState(true)
  const [prompt, setPrompt] = useState('')
  const [targetStage, setTargetStage] = useState('')
  const [interval, setInterval] = useState('600')
  const [resetOpen, setResetOpen] = useState(false)

  useEffect(() => {
    if (!data) return
    const s = data.settings
    setEnabled(s['sale_detection.enabled'] !== 'false')
    setPrompt(s['sale_detection.prompt'] ?? '')
    setTargetStage(s['sale_detection.target_stage'] ?? '')
    setInterval(s['sale_detection.interval'] ?? '600')
  }, [data])

  const stagesByFunnel = useMemo(() => {
    const map = new Map<number, FunnelStage[]>()
    for (const st of stagesData?.stages ?? []) {
      if (!st.active) continue
      const arr = map.get(st.funnelId) ?? []
      arr.push(st)
      map.set(st.funnelId, arr)
    }
    return map
  }, [stagesData])

  const funnels = funnelsData?.funnels ?? []
  const promptIsCustom = prompt.trim().length > 0

  function handleSave() {
    const intNum = Number(interval)
    if (!Number.isFinite(intNum) || intNum < 60) {
      toast('Intervalo deve ser ≥ 60 segundos', 'danger')
      return
    }
    const payload: SalesSettingsRaw = {
      'sale_detection.enabled': enabled ? 'true' : 'false',
      'sale_detection.prompt': prompt.trim(),
      'sale_detection.target_stage': targetStage.trim(),
      'sale_detection.interval': String(Math.floor(intNum)),
    }
    save.mutate(payload, {
      onSuccess: () => toast('Configurações salvas com sucesso!', 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function doResetPrompt() {
    setPrompt('')
    setResetOpen(false)
    toast('Prompt resetado. Clique em Salvar para aplicar.', 'success')
  }

  if (isLoading) {
    return (
      <Card>
        <Skeleton class="h-64 w-full" />
      </Card>
    )
  }

  return (
    <>
      <Card class="max-w-3xl">
        <div class="flex items-center gap-2 mb-5">
          <Settings size={18} class="text-accent" />
          <h3 class="text-base font-semibold text-fg">Configurações da Detecção de Vendas</h3>
        </div>

        <div class="space-y-5">
          <div>
            <div class="text-xs font-medium text-fg-muted mb-1.5">Detecção automática</div>
            <button
              type="button"
              onClick={() => setEnabled((v) => !v)}
              class={cn(
                'inline-flex items-center gap-2 px-4 h-8 rounded-md border text-xs font-medium transition-colors',
                enabled
                  ? 'border-success/40 bg-success/15 text-success'
                  : 'border-danger/40 bg-danger/15 text-danger',
              )}
            >
              <span class={cn('size-2 rounded-full', enabled ? 'bg-success' : 'bg-danger')} />
              {enabled ? 'Ativada' : 'Desativada'}
            </button>
            <p class="text-[0.6875rem] text-fg-subtle mt-1.5">
              Quando ativada, a IA analisa conversas automaticamente a cada intervalo configurado.
            </p>
          </div>

          <div class="max-w-xs">
            <Input
              label="Intervalo de análise (segundos)"
              type="number"
              min={60}
              max={86400}
              step={60}
              value={interval}
              onInput={(e) => setInterval((e.target as HTMLInputElement).value)}
              hint={(() => {
                const s = Number(interval)
                if (!Number.isFinite(s) || s < 60) return 'Mín 60s'
                const min = Math.round(s / 60)
                return `≈ ${min} min · padrão 600 (10 min)`
              })()}
            />
          </div>

          <div class="max-w-md">
            <label class="text-xs font-medium text-fg-muted mb-1.5 block" for="sd-target-stage">
              Mover lead para etapa ao detectar venda
            </label>
            <select
              id="sd-target-stage"
              value={targetStage}
              onChange={(e) => setTargetStage((e.target as HTMLSelectElement).value)}
              class="h-9 px-3 rounded-md bg-surface border border-border text-sm text-fg w-full focus:outline-none focus:border-accent"
            >
              <option value="">Não mover (apenas registrar)</option>
              {funnels.map((f) => {
                const stages = stagesByFunnel.get(f.id) ?? []
                if (stages.length === 0) return null
                return (
                  <optgroup key={f.id} label={`${f.name}${f.isDefault ? ' (padrão)' : ''}`}>
                    {stages.map((st) => (
                      <option key={st.id} value={`${f.id}:${st.key}`}>
                        {st.name}
                      </option>
                    ))}
                  </optgroup>
                )
              })}
            </select>
            <p class="text-[0.6875rem] text-fg-subtle mt-1.5">
              Quando a IA detectar uma venda, o lead será movido automaticamente para esta etapa do funil.
            </p>
          </div>

          <div>
            <div class="flex items-center justify-between gap-3 mb-1.5 flex-wrap">
              <label class="text-xs font-medium text-fg-muted" for="sd-prompt">
                Prompt de detecção de vendas
              </label>
              <Badge tone={promptIsCustom ? 'info' : 'success'}>
                {promptIsCustom ? 'Prompt customizado ativo' : 'Usando prompt padrão do sistema'}
              </Badge>
            </div>
            <Textarea
              id="sd-prompt"
              value={prompt}
              onInput={(e) => setPrompt((e.target as HTMLTextAreaElement).value)}
              rows={20}
              placeholder={DEFAULT_PROMPT}
              class="font-mono text-xs leading-relaxed"
            />
            <p class="text-[0.6875rem] text-fg-subtle mt-1.5">
              Instruções enviadas para a IA analisar as conversas. Edite livremente para adaptar ao seu nicho. O prompt deve instruir a IA a responder em JSON com os campos:{' '}
              <code class="font-mono">sale</code>, <code class="font-mono">value</code>, <code class="font-mono">product</code>,{' '}
              <code class="font-mono">confidence</code>, <code class="font-mono">explanation</code>, <code class="font-mono">snippet</code>.
            </p>
          </div>

          <div class="flex flex-wrap gap-2 pt-2">
            <Button variant="primary" size="sm" onClick={handleSave} disabled={save.isPending}>
              <Save size={14} /> {save.isPending ? 'Salvando…' : 'Salvar Configurações'}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setResetOpen(true)} disabled={save.isPending}>
              <RotateCcw size={14} /> Restaurar Prompt Padrão
            </Button>
          </div>
        </div>
      </Card>

      {resetOpen && (
        <ConfirmDialog
          open
          onOpenChange={(o) => { if (!o) setResetOpen(false) }}
          title="Restaurar prompt padrão?"
          description="O campo será limpo e o sistema usará o prompt padrão. Você ainda precisa salvar para aplicar."
          confirmLabel="Restaurar"
          onConfirm={doResetPrompt}
        />
      )}
    </>
  )
}

function HowItWorksModal({
  onClose,
  onGoQueue,
  onGoSettings,
}: {
  onClose: () => void
  onGoQueue: () => void
  onGoSettings: () => void
}) {
  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Como funciona a detecção de vendas pela IA?"
      size="lg"
      footer={<Button variant="secondary" size="sm" onClick={onClose}>Fechar</Button>}
    >
      <div class="space-y-4 text-sm">
        <div class="rounded-lg p-4 bg-accent/10 border border-accent/30">
          <div class="font-semibold text-fg mb-1">O problema que ele resolve</div>
          <div class="text-xs text-fg-muted leading-relaxed">
            Vendedores fecham vendas no WhatsApp e <strong>esquecem de registrar</strong>. No fim do mês ninguém sabe
            quanto vendeu de verdade. Esta tela usa IA pra ler todas as conversas e detectar automaticamente
            quando uma venda foi fechada — você só revisa e confirma.
          </div>
        </div>

        <div class="space-y-3">
          <Step n={1} title="🤖 A IA lê as conversas a cada X minutos">
            De tempo em tempo (padrão: 10 minutos), o sistema pega as conversas ativas e manda pra IA analisar.
            A IA procura sinais de venda fechada: "pode fazer", "já paguei", "pix enviado", "fechado".
          </Step>
          <Step n={2} title="📋 Vendas detectadas vão pra Fila de Revisão">
            Cada venda aparece com: nome do lead, <strong>valor sugerido pela IA</strong>, produto, trecho da conversa
            que comprovou, e nível de <strong>confiança</strong> (Alta / Média / Baixa).
          </Step>
          <Step n={3} title="✅ Você confirma ou rejeita">
            Na aba <strong>Fila de Revisão</strong>, cada linha tem dois botões. Confirmar valida a venda (entra nos
            relatórios). Rejeitar marca como falso positivo (a IA aprende a não detectar de novo casos parecidos).
          </Step>
          <Step n={4} title="🎯 Lead vai pra etapa de venda no funil">
            Se você configurou em <strong>"Mover lead para etapa ao detectar venda"</strong>, ele é movido automaticamente
            (ex: pra "Fechado" no kanban) — sem ninguém precisar arrastar.
          </Step>
          <Step n={5} title="📊 Painel mostra o resultado">
            A aba <strong>Painel</strong> consolida tudo: total de vendas, valor total, ticket médio, vendas por dia,
            por origem (Meta Ads, Google Ads, orgânico) e por campanha. Vira o seu relatório de fechamento.
          </Step>
        </div>

        <div class="rounded-lg p-4 bg-warning/10 border border-warning/30">
          <div class="font-semibold text-fg mb-1">⚙️ Pra funcionar, configure antes</div>
          <ul class="text-xs text-fg-muted leading-relaxed space-y-1 list-disc list-inside">
            <li><strong>Detecção ativada</strong> na aba Configurações</li>
            <li><strong>Chave de IA</strong> (Anthropic ou OpenAI) em Configurações › APIs</li>
            <li><strong>Intervalo de análise</strong> (padrão 10 min) — quanto menor, mais rápido detecta, mais consome IA</li>
            <li><strong>Prompt customizado</strong> (opcional) — pra adaptar ao seu nicho (curso, imóvel, serviço, etc.)</li>
          </ul>
        </div>

        <div class="flex flex-wrap gap-2 justify-end pt-2">
          <Button variant="secondary" size="sm" onClick={onGoSettings}>
            <Settings size={14} /> Ir para Configurações
          </Button>
          <Button variant="primary" size="sm" onClick={onGoQueue}>
            Ver Fila de Revisão →
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: preact.ComponentChildren }) {
  return (
    <div class="flex gap-3">
      <div class="shrink-0 size-9 rounded-full bg-accent text-fg-on-brand grid place-items-center text-sm font-bold">
        {n}
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-sm font-semibold text-fg mb-0.5">{title}</div>
        <div class="text-xs text-fg-muted leading-relaxed">{children}</div>
      </div>
    </div>
  )
}
