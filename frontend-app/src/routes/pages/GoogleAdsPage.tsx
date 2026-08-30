import { useState, useEffect } from 'preact/hooks'
import { Search, Send, Trash2, Plus, AlertCircle, ExternalLink, KeyRound, ChevronRight, Check, HelpCircle } from '@/components/ui/icon-set'
import { HowItWorksModal } from '@/components/ui/HowItWorksModal'
import {
  useGoogleAdsConfig,
  useGoogleAdsLeads,
  useSendGoogleAdsConversion,
  useDeleteGoogleAdsConfig,
  useCreateGoogleAdsConfig,
  useGoogleAdsDevTokenStatus,
  useListAccessibleCustomers,
  useListConversionActions,
  useUpdateGoogleAdsConversionMap,
  useGoogleAdsLoginCustomerId,
  useUpdateGoogleAdsLoginCustomerId,
  type GoogleAdsConfig,
  type GoogleAdsLead,
  type GoogleAdsTrigger,
  type ValueSource,
  type ConversionMapItem,
} from '@/hooks/useGoogleAds'
import { useGoogleConnections } from '@/hooks/useGoogle'
import { Page } from '@/components/ui/Page'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Input'
import { formatDateTime, formatRelative } from '@/lib/format'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/cn'

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

export function GoogleAdsPage() {
  const [onlySales, setOnlySales] = useState(false)
  const [deletingConfig, setDeletingConfig] = useState<GoogleAdsConfig | null>(null)
  const [creatingConfig, setCreatingConfig] = useState(false)
  const [showHowItWorks, setShowHowItWorks] = useState(false)
  const { data: configs, isLoading: configLoading } = useGoogleAdsConfig()
  const { data: leads, isLoading: leadsLoading } = useGoogleAdsLeads(onlySales)
  const { data: devTokenStatus } = useGoogleAdsDevTokenStatus()
  const sendConv = useSendGoogleAdsConversion()
  const delConfig = useDeleteGoogleAdsConfig()
  const tokenConfigured = !!devTokenStatus?.configured

  function handleSend(lead: GoogleAdsLead) {
    sendConv.mutate({ leadId: lead.id, value: lead.saleValue ?? undefined }, {
      onSuccess: () => toast('Conversão enviada ao Google Ads', 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <Page
      title="Google Ads"
      description="Conexões e envio de conversões offline para Google Ads."
      actions={
        <div class="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setShowHowItWorks(true)}>
            <HelpCircle size={14} /> Como funciona?
          </Button>
          <Button variant="primary" size="sm" onClick={() => setCreatingConfig(true)} disabled={!tokenConfigured}>
            <Plus size={14} /> Conectar conta Google Ads
          </Button>
        </div>
      }
    >
      {/* Banner: developer token global não configurado (admin precisa setar) */}
      {!tokenConfigured && (
        <Card class="border-warning/40 bg-warning/10">
          <div class="flex items-start gap-3">
            <KeyRound size={20} class="text-warning shrink-0 mt-0.5" />
            <div class="flex-1 min-w-0">
              <div class="text-sm font-semibold text-fg">Configurar Developer Token</div>
              <p class="text-xs text-fg-muted mt-1">
                Antes de qualquer conta ser conectada, o admin precisa cadastrar UMA VEZ o Developer Token do Google Ads em <strong>Configurações &gt; Integrações &gt; Google Ads</strong>. Esse token é da aplicação (Beyond), não do operador.
              </p>
              <Button variant="primary" size="sm" class="mt-2" onClick={() => window.location.assign('/app/settings?tab=integrations')}>
                Ir para Configurações
              </Button>
            </div>
          </div>
        </Card>
      )}

      <LoginCustomerIdCard />

      <Card>
        <CardHeader>
          <CardTitle>Contas configuradas</CardTitle>
        </CardHeader>
        {configLoading && <Skeleton class="h-16 w-full" />}
        {!configLoading && configs?.data.length === 0 && (
          <EmptyState
            icon={<Search size={20} />}
            title="Nenhuma conta Google Ads"
            description="Conecte uma conta para enviar conversões offline. Você só precisa fazer login com Google e escolher a conta — sem digitar IDs ou tokens."
            action={
              <Button variant="primary" size="sm" onClick={() => setCreatingConfig(true)} disabled={!tokenConfigured}>
                <Plus size={14} /> Conectar conta Google Ads
              </Button>
            }
          />
        )}
        {!configLoading && configs && configs.data.length > 0 && (
          <ul class="divide-y divide-border">
            {configs.data.map((c) => (
              <li key={c.id} class="py-2 flex items-center gap-3 group">
                <div class="flex-1 min-w-0">
                  <div class="text-sm text-fg font-mono">{c.customerId}</div>
                  <div class="text-xs text-fg-muted flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
                    <span>{c.conversionAction ? `Action: ${c.conversionAction}` : 'Sem action configurada'}</span>
                    <span class="tabular-nums">Enviadas: <strong class="text-fg">{c.totalSent}</strong></span>
                    {c.totalFailed > 0 && (
                      <span class="tabular-nums text-danger">Falhas: <strong>{c.totalFailed}</strong></span>
                    )}
                    {c.lastSentAt && <span>Último envio {formatRelative(c.lastSentAt)}</span>}
                    {c.autoSendConversions && <Badge tone="info">Auto-envio</Badge>}
                  </div>
                </div>
                <Badge tone={c.active ? 'success' : 'neutral'}>{c.active ? 'Ativa' : 'Inativa'}</Badge>
                <button
                  type="button"
                  class="size-7 rounded grid place-items-center text-fg-muted hover:text-danger hover:bg-surface-3 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => setDeletingConfig(c)}
                  aria-label="Excluir"
                  title="Excluir"
                >
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card class="p-0 overflow-hidden">
        <div class="p-4 border-b border-border flex items-center justify-between gap-2">
          <h3 class="text-sm font-semibold text-fg">Leads com GCLID</h3>
          <label class="flex items-center gap-2 text-xs text-fg-muted">
            <input type="checkbox" checked={onlySales} onChange={(e) => setOnlySales((e.target as HTMLInputElement).checked)} />
            Apenas com venda detectada
          </label>
        </div>
        {leadsLoading && (
          <div class="p-4 flex flex-col gap-2">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} class="h-12 w-full" />)}
          </div>
        )}
        {!leadsLoading && leads?.data.length === 0 && (
          <EmptyState title={onlySales ? 'Nenhuma venda com GCLID' : 'Nenhum lead com GCLID'} />
        )}
        {!leadsLoading && leads && leads.data.length > 0 && (
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="bg-surface-3 text-fg-muted text-2xs uppercase tracking-wider">
                <tr>
                  <th class="text-left px-4 py-2 font-medium">Lead</th>
                  <th class="text-left px-4 py-2 font-medium">GCLID</th>
                  <th class="text-left px-4 py-2 font-medium">Status</th>
                  <th class="text-right px-4 py-2 font-medium">Venda</th>
                  <th class="text-left px-4 py-2 font-medium">Criado</th>
                  <th class="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-border">
                {leads.data.map((l) => (
                  <tr key={l.id} class="hover:bg-surface-3">
                    <td class="px-4 py-2">
                      <div class="text-fg truncate max-w-[14rem]">{l.empresa ?? l.nome ?? '—'}</div>
                      <div class="text-xs text-fg-muted truncate">{l.email ?? l.whatsapp ?? ''}</div>
                    </td>
                    <td class="px-4 py-2 font-mono text-3xs text-fg-muted truncate max-w-[12rem]" title={l.gclid ?? ''}>{l.gclid?.slice(0, 20)}…</td>
                    <td class="px-4 py-2"><Badge tone="neutral">{l.status ?? '—'}</Badge></td>
                    <td class="px-4 py-2 text-right tabular-nums">
                      {l.saleDetected ? (
                        <span class="text-success">{l.saleValue !== null ? brl.format(l.saleValue) : '✓'}</span>
                      ) : (
                        <span class="text-fg-muted">—</span>
                      )}
                    </td>
                    <td class="px-4 py-2 text-xs text-fg-muted whitespace-nowrap">{formatDateTime(l.createdAt)}</td>
                    <td class="px-4 py-2">
                      <Button variant="secondary" size="sm" onClick={() => handleSend(l)} disabled={sendConv.isPending}>
                        <Send size={11} /> Enviar
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {creatingConfig && (
        <GoogleAdsConfigModal onClose={() => setCreatingConfig(false)} />
      )}

      {deletingConfig && (
        <ConfirmDialog
          open
          onOpenChange={(o) => { if (!o) setDeletingConfig(null) }}
          title="Excluir conta Google Ads"
          description={`Customer ${deletingConfig.customerId} será removido. Conversões já enviadas permanecem no Google.`}
          destructive
          confirmLabel="Excluir"
          loading={delConfig.isPending}
          onConfirm={() => delConfig.mutate(deletingConfig.id, {
            onSuccess: () => { toast('Conta removida', 'success'); setDeletingConfig(null) },
            onError: (e: unknown) => toast((e as Error).message, 'danger'),
          })}
        />
      )}

      <HowItWorksModal
        open={showHowItWorks}
        onClose={() => setShowHowItWorks(false)}
        title="Como funciona o Google Ads?"
        problem={<>
          Você roda anúncios no Google Ads e quer que o algoritmo aprenda quem é cliente bom de
          verdade. Sem mandar de volta pro Google quem virou venda, ele continua otimizando pra
          cliques — não pra lucro. Esta tela envia <strong>conversões offline</strong> pro Google e
          fecha o ciclo.
        </>}
        steps={[
          {
            title: '🗝️ Developer token (uma vez só)',
            body: <>Antes de tudo, o admin precisa colocar a <strong>developer token</strong> do Google Ads em Configurações. É a credencial global da agência/empresa. Sem isso, nada conecta.</>,
          },
          {
            title: '🔌 Conecte sua conta Google Ads',
            body: <>Botão <strong>Conectar conta</strong>: login no Google, escolhe a conta (Customer ID), escolhe a <strong>Conversion Action</strong> (ex.: "Lead qualificado", "Venda fechada") em um wizard de 3 passos.</>,
          },
          {
            title: '🎯 Múltiplos gatilhos por conta',
            body: <>Pra cada conta, você mapeia: lead.qualified → Conversion Action A; lead.won → Conversion Action B; venda confirmada → Conversion Action C. Cada evento do CRM vira sinal pro Google.</>,
          },
          {
            title: '📤 Envio automático ou manual',
            body: <>Quando o evento configurado acontece (lead vira venda, por exemplo), o sistema dispara <strong>sozinho</strong> a conversão pro Google com gclid + valor + moeda. Você também pode disparar manualmente em um lead específico.</>,
          },
          {
            title: '🔍 Filtre por "Só vendas"',
            body: <>Toggle <strong>Apenas vendas</strong> filtra a lista pra leads que viraram receita — fácil de revisar antes de enviar manualmente.</>,
          },
        ]}
        tip={{
          tone: 'info',
          title: '💡 Por que isso importa',
          body: <>O Google Ads precisa de pelo menos <strong>30 conversões em 30 dias</strong> pra otimizar bem. Sem mandar conversões offline, ele otimiza pra "lead que clicou" — não pra "lead que comprou". A diferença em ROAS pode ser de 2 a 5x.</>,
        }}
      />
    </Page>
  )
}

// ─────────────────────────────────────────────────────────────────────
// GoogleAdsConfigModal — Wizard simplificado (Fase 25)
// ─────────────────────────────────────────────────────────────────────
//
// Antes: leigo precisava colar Customer ID + Developer Token + nome da
// conversion action. Agora: 3 passos em dropdowns auto-preenchidos.
//
// Etapa 1 — Conta Google: dropdown das conexões OAuth já existentes
// Etapa 2 — Conta Google Ads: dropdown auto-fetch via listAccessibleCustomers
// Etapa 3 — Conversion Action: dropdown auto-fetch via search GAQL +
//           toggle de auto-envio + Salvar
//
// Pré-requisito: Developer Token global cadastrado pelo admin em Settings.

type WizardStep = 1 | 2 | 3

// Triggers internos mapeáveis para Conversion Actions. Mantém em sincronia
// com SUPPORTED_TRIGGERS em backend/src/routes/googleAds.ts.
const TRIGGER_ROWS: Array<{ key: GoogleAdsTrigger; label: string; defaultValueSource: ValueSource; hint: string }> = [
  { key: 'lead.won',                     label: 'Venda confirmada',           defaultValueSource: 'sale_value', hint: 'Dispara quando o lead é marcado como Ganho. Valor = saleValue real.' },
  { key: 'lead_qualified',               label: 'Lead qualificado',           defaultValueSource: 'zero',       hint: 'Dispara quando o lead atinge critérios de qualificação (priorityScore ≥ alvo).' },
  { key: 'enrollment.payment_confirmed', label: 'Pagamento confirmado',       defaultValueSource: 'sale_value', hint: 'Dispara quando o webhook do gateway confirma o pagamento da matrícula.' },
  { key: 'diagnosis.completed',          label: 'Diagnóstico/chatbot final',  defaultValueSource: 'zero',       hint: 'Dispara quando o lead conclui um fluxo de diagnóstico no chatbot.' },
]

type RowState = {
  enabled: boolean
  conversionAction: string
  valueSource: ValueSource
  fixedValue: string
}

function emptyRowState(defaultValueSource: ValueSource): RowState {
  return { enabled: false, conversionAction: '', valueSource: defaultValueSource, fixedValue: '' }
}

function GoogleAdsConfigModal({ onClose }: { onClose: () => void }) {
  const { data: connections, isLoading: loadingConn } = useGoogleConnections()
  const create = useCreateGoogleAdsConfig()
  const updateMap = useUpdateGoogleAdsConversionMap()
  const [step, setStep] = useState<WizardStep>(1)
  const [connectionId, setConnectionId] = useState<number | null>(null)
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [autoSend, setAutoSend] = useState(false)
  const [rows, setRows] = useState<Record<string, RowState>>(() => {
    const initial: Record<string, RowState> = {}
    for (const r of TRIGGER_ROWS) initial[r.key] = emptyRowState(r.defaultValueSource)
    return initial
  })

  const customersQ = useListAccessibleCustomers(connectionId)
  const actionsQ = useListConversionActions(connectionId, customerId)

  const noConnections = !loadingConn && (connections?.data.length ?? 0) === 0

  function pickConnection(id: number) {
    setConnectionId(id)
    setCustomerId(null)
    setStep(2)
  }
  function pickCustomer(cid: string) {
    setCustomerId(cid)
    setStep(3)
  }
  function updateRow(trigger: GoogleAdsTrigger, patch: Partial<RowState>) {
    setRows(prev => {
      const base = prev[trigger] ?? emptyRowState(
        TRIGGER_ROWS.find(r => r.key === trigger)?.defaultValueSource ?? 'zero',
      )
      return { ...prev, [trigger]: { ...base, ...patch } }
    })
  }

  const activeRows = TRIGGER_ROWS
    .map(r => ({ ...r, row: rows[r.key] }))
    .filter((r): r is typeof r & { row: RowState } => !!r.row?.enabled && !!r.row.conversionAction)
  const canSave = !!connectionId && !!customerId && activeRows.length > 0

  async function handleSave() {
    if (!canSave || !connectionId || !customerId) {
      toast('Selecione ao menos uma Conversion Action ativa', 'danger')
      return
    }
    // CA legada (compat) usa a do trigger 'lead.won' se mapeado; senão a primeira ativa
    const leadWon = rows['lead.won']
    const fallbackCA = activeRows[0] ? activeRows[0].row.conversionAction : ''
    const legacyCA = leadWon?.enabled && leadWon.conversionAction ? leadWon.conversionAction : fallbackCA
    try {
      await create.mutateAsync({
        connectionId,
        customerId,
        conversionAction: legacyCA,
        autoSendConversions: autoSend,
      })
      const items: ConversionMapItem[] = activeRows.map(r => ({
        trigger: r.key,
        conversionAction: r.row.conversionAction,
        valueSource: r.row.valueSource,
        fixedValue: r.row.valueSource === 'fixed' ? parseFloat(r.row.fixedValue) || 0 : null,
        isPrimary: r.key === 'lead.won',
        enabled: true,
      }))
      await updateMap.mutateAsync(items)
      toast('Conta Google Ads conectada com mapping de conversões', 'success')
      onClose()
    } catch (e: unknown) {
      toast((e as Error).message, 'danger')
    }
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Conectar Google Ads"
      description="3 passos: escolha a conta Google, a conta de Google Ads e a conversion action. Sem digitar IDs."
      size="lg"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={create.isPending}>Cancelar</Button>
          {step > 1 && (
            <Button variant="ghost" size="sm" onClick={() => setStep((step - 1) as WizardStep)} disabled={create.isPending}>
              Voltar
            </Button>
          )}
          {step === 3 && (
            <Button variant="primary" size="sm" onClick={handleSave} disabled={create.isPending || updateMap.isPending || !canSave}>
              {create.isPending || updateMap.isPending ? 'Conectando…' : <><Check size={14} /> Conectar</>}
            </Button>
          )}
        </>
      }
    >
      <WizardStepper step={step} />

      {loadingConn && <Skeleton class="h-32 w-full mt-4" />}

      {/* Sem conexão Google → joga pro Google Suite */}
      {noConnections && (
        <div class="space-y-3 mt-4">
          <div class="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-fg">
            <AlertCircle size={16} class="mt-0.5 shrink-0 text-warning" />
            <div>
              <p class="font-medium">Nenhuma conta Google conectada</p>
              <p class="mt-0.5 text-xs text-fg-muted">
                Conecte sua conta Google em <strong>Google Suite</strong> primeiro. Use o mesmo login que tem acesso à sua conta de Google Ads.
              </p>
            </div>
          </div>
          <Button variant="primary" size="sm" onClick={() => window.location.assign('/app/google')}>
            <ExternalLink size={14} /> Ir para Google Suite
          </Button>
        </div>
      )}

      {!loadingConn && !noConnections && (
        <div class="mt-4 space-y-3">
          {/* PASSO 1 — Conta Google */}
          {step === 1 && (
            <>
              <div class="text-xs text-fg-muted mb-2">Selecione a conta Google que tem acesso à sua conta Google Ads:</div>
              <div class="flex flex-col gap-2">
                {connections?.data.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    class={cn(
                      'w-full text-left rounded-md border p-3 transition-colors',
                      'flex items-center justify-between gap-3',
                      connectionId === c.id ? 'border-accent bg-accent/10' : 'border-border bg-surface hover:bg-surface-2',
                    )}
                    onClick={() => pickConnection(c.id)}
                  >
                    <div class="min-w-0">
                      <div class="text-sm font-medium text-fg truncate">{c.email}</div>
                      {!c.active && <div class="text-2xs text-warning">conexão inativa — reconecte</div>}
                    </div>
                    <ChevronRight size={14} class="text-fg-muted shrink-0" />
                  </button>
                ))}
              </div>
            </>
          )}

          {/* PASSO 2 — Conta Google Ads (auto-fetch) */}
          {step === 2 && connectionId && (
            <>
              <div class="text-xs text-fg-muted mb-2">Selecione a conta de Google Ads que essa conta Google tem acesso:</div>
              {customersQ.isLoading && (
                <div class="flex flex-col gap-2">
                  {[0, 1, 2].map((i) => <Skeleton key={i} class="h-14 w-full" />)}
                </div>
              )}
              {customersQ.error && (
                <ApiErrorBanner error={customersQ.error as any} />
              )}
              {!customersQ.isLoading && !customersQ.error && customersQ.data && customersQ.data.data.length === 0 && (
                <EmptyState
                  title="Nenhuma conta Google Ads acessível"
                  description="Esta conta Google não tem acesso a nenhuma conta do Google Ads. Verifique no Google Ads em Acesso e Segurança."
                />
              )}
              <div class="flex flex-col gap-2">
                {customersQ.data?.data.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    class={cn(
                      'w-full text-left rounded-md border p-3 transition-colors',
                      'flex items-center justify-between gap-3',
                      customerId === c.id ? 'border-accent bg-accent/10' : 'border-border bg-surface hover:bg-surface-2',
                      c.isManager && 'opacity-60',
                    )}
                    onClick={() => !c.isManager && pickCustomer(c.id)}
                    disabled={c.isManager}
                    title={c.isManager ? 'Contas Manager (MCC) não recebem conversões diretas' : undefined}
                  >
                    <div class="min-w-0 flex-1">
                      <div class="text-sm font-medium text-fg truncate">
                        {c.descriptiveName ?? `Conta ${c.id}`}
                        {c.isManager && <Badge tone="neutral" class="ml-2">MCC</Badge>}
                      </div>
                      <div class="text-2xs text-fg-muted font-mono truncate">
                        ID: {formatCustomerId(c.id)}{c.currencyCode ? ` · ${c.currencyCode}` : ''}
                      </div>
                    </div>
                    {!c.isManager && <ChevronRight size={14} class="text-fg-muted shrink-0" />}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* PASSO 3 — Mapping multi-trigger (1 CA por evento de funil) */}
          {step === 3 && connectionId && customerId && (
            <>
              <div class="text-xs text-fg-muted mb-3">
                Mapeie cada evento do funil a uma <strong>Conversion Action</strong> diferente do Google Ads. Marque só os triggers que você quer reportar — deixar mais de um ativo permite otimizar bid strategies por etapa (Lead Qualificado, Pagamento, Venda etc).
                <span class="block mt-1 text-2xs text-warning"><strong>Não</strong> mande o mesmo evento para várias CAs — isso gera double-counting no Google.</span>
              </div>
              {actionsQ.isLoading && (
                <div class="flex flex-col gap-2">
                  {[0, 1, 2].map((i) => <Skeleton key={i} class="h-14 w-full" />)}
                </div>
              )}
              {actionsQ.error && <ApiErrorBanner error={actionsQ.error as any} />}
              {!actionsQ.isLoading && !actionsQ.error && actionsQ.data && actionsQ.data.data.length === 0 && (
                <EmptyState
                  title="Nenhuma conversion action ativa"
                  description="Crie Conversion Actions no Google Ads (Ferramentas > Medição > Conversões) marcadas como 'Importar' antes de continuar."
                />
              )}
              {!actionsQ.isLoading && !actionsQ.error && (actionsQ.data?.data.length ?? 0) > 0 && (
                <div class="flex flex-col gap-2">
                  {TRIGGER_ROWS.map((trow) => {
                    const row = rows[trow.key] ?? emptyRowState(trow.defaultValueSource)
                    return (
                      <div key={trow.key} class={cn(
                        'rounded-md border p-3 space-y-2',
                        row.enabled ? 'border-accent bg-accent/5' : 'border-border bg-surface',
                      )}>
                        <label class="flex items-start gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            class="mt-0.5"
                            checked={row.enabled}
                            onChange={(e) => updateRow(trow.key, { enabled: (e.target as HTMLInputElement).checked })}
                          />
                          <div class="flex-1 min-w-0">
                            <div class="text-sm font-medium text-fg">{trow.label}</div>
                            <div class="text-2xs text-fg-muted">{trow.hint}</div>
                          </div>
                        </label>
                        {row.enabled && (
                          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 pl-6">
                            <Select
                              label="Conversion Action"
                              value={row.conversionAction}
                              onChange={(e) => updateRow(trow.key, { conversionAction: (e.target as HTMLSelectElement).value })}
                            >
                              <option value="">Selecione…</option>
                              {actionsQ.data?.data.map((a) => (
                                <option key={a.id} value={a.id}>{a.name} ({a.category})</option>
                              ))}
                            </Select>
                            <Select
                              label="Valor enviado"
                              value={row.valueSource}
                              onChange={(e) => updateRow(trow.key, { valueSource: (e.target as HTMLSelectElement).value as ValueSource })}
                            >
                              <option value="zero">Zero (R$ 0)</option>
                              <option value="sale_value">Valor real da venda (saleValue)</option>
                              <option value="fixed">Valor fixo (informe ao lado)</option>
                            </Select>
                            {row.valueSource === 'fixed' && (
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                placeholder="0.00"
                                value={row.fixedValue}
                                onInput={(e) => updateRow(trow.key, { fixedValue: (e.target as HTMLInputElement).value })}
                                class="sm:col-span-2 text-sm rounded-md border border-border bg-surface px-2 py-1.5 focus:outline-none focus:border-accent"
                              />
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              <label class="flex items-start gap-2 text-sm text-fg cursor-pointer rounded-md border border-border bg-surface-2 p-3 mt-3">
                <input
                  type="checkbox"
                  class="mt-0.5"
                  checked={autoSend}
                  onChange={(e) => setAutoSend((e.target as HTMLInputElement).checked)}
                />
                <div>
                  <div class="font-medium">Envio automático de conversões</div>
                  <div class="text-2xs text-fg-muted">
                    Master kill-switch: quando ligado, cada trigger ativo acima envia a conversão pro Google Ads no momento exato em que o evento acontece no sistema. Desligado = apenas envio manual continua funcionando.
                  </div>
                </div>
              </label>
            </>
          )}
        </div>
      )}
    </Modal>
  )
}

function WizardStepper({ step }: { step: WizardStep }) {
  const steps = [
    { n: 1, label: 'Conta Google' },
    { n: 2, label: 'Conta Google Ads' },
    { n: 3, label: 'Conversion Action' },
  ]
  return (
    <div class="flex items-center gap-1">
      {steps.map((s, i) => (
        <div key={s.n} class="flex items-center gap-1 flex-1">
          <div
            class={cn(
              'h-7 px-3 rounded-md flex items-center gap-2 text-xs font-medium flex-1 truncate',
              step === s.n
                ? 'bg-accent text-fg-on-brand'
                : step > s.n
                  ? 'bg-success/15 text-success border border-success/40'
                  : 'bg-surface-3 text-fg-muted',
            )}
          >
            <span class="size-4 rounded-full bg-white/30 grid place-items-center text-3xs font-bold shrink-0">
              {step > s.n ? '✓' : s.n}
            </span>
            <span class="truncate">{s.label}</span>
          </div>
          {i < steps.length - 1 && <ChevronRight size={12} class="text-fg-muted shrink-0" />}
        </div>
      ))}
    </div>
  )
}

function ApiErrorBanner({ error }: { error: { message?: string } }) {
  const message = error.message ?? 'Erro desconhecido'

  // Detecta o erro "API has not been used in project" e extrai o link do Cloud
  // Console pra renderizar como botão direto. Caso recorrente: a OAuth app do
  // Beyond fica num projeto Cloud, e a Google Ads API precisa estar habilitada
  // nesse mesmo projeto — coisa que o admin esquece de fazer.
  const apiNotEnabled = /PERMISSION_DENIED|has not been used in project|googleads\.googleapis\.com\/overview/i.test(message)
  const urlMatch = message.match(/https?:\/\/[^\s]+/i)
  const enableUrl = urlMatch ? urlMatch[0] : null

  // Heurística: se 404/HTML do Google ⇒ versão da API descontinuada (escopo backend).
  const versionDeprecated = /Versão da Google Ads API indisponível|404/.test(message)

  // Token Test-only: token cadastrado, mas só aprovado pra contas de teste.
  // Pra usar conta real, precisa aplicar pra Basic ou Standard Access no API Center.
  const testTokenOnly = /test accounts|apply for Basic|developer token is only approved/i.test(message)

  return (
    <div class="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-fg">
      <AlertCircle size={16} class="mt-0.5 shrink-0 text-danger" />
      <div class="min-w-0 flex-1">
        <p class="font-medium">Erro ao consultar Google Ads</p>
        <p class="mt-0.5 text-xs text-fg-muted break-words">{message}</p>

        {apiNotEnabled && enableUrl && (
          <div class="mt-2 rounded border border-danger/30 bg-surface p-2 text-xs">
            <p class="font-medium text-fg mb-1">Como resolver:</p>
            <ol class="list-decimal pl-4 space-y-0.5 text-fg-muted">
              <li>Abra o link abaixo no Google Cloud Console (logado na conta admin do projeto)</li>
              <li>Clique no botão <strong>ENABLE</strong></li>
              <li>Aguarde 1–2 minutos pra propagar e tente conectar de novo</li>
            </ol>
            <a
              href={enableUrl}
              target="_blank"
              rel="noopener noreferrer"
              class="mt-2 inline-flex items-center gap-1 px-2 h-7 rounded-md bg-info/15 border border-info/40 text-info text-xs font-medium hover:bg-info/25"
            >
              Habilitar Google Ads API ↗
            </a>
          </div>
        )}

        {testTokenOnly && (
          <div class="mt-2 rounded border border-danger/30 bg-surface p-2 text-xs">
            <p class="font-medium text-fg mb-1">Como resolver:</p>
            <p class="text-fg-muted mb-2">
              Seu Developer Token está aprovado apenas para <strong>contas de teste</strong>.
              Pra ler dados de contas reais, é preciso solicitar <strong>Basic Access</strong> (gratuito,
              aprovação em 1–3 dias úteis pelo Google).
            </p>
            <ol class="list-decimal pl-4 space-y-0.5 text-fg-muted">
              <li>Abra o <strong>Google Ads API Center</strong> logado na conta MCC dona do token</li>
              <li>Clique em <strong>Apply for Basic Access</strong> e preencha o formulário</li>
              <li>Aguarde a aprovação por email (1–3 dias úteis)</li>
              <li>Quando aprovado, tente conectar novamente — não precisa cadastrar o token de novo</li>
            </ol>
            <div class="mt-2 flex gap-1.5 flex-wrap">
              <a
                href="https://ads.google.com/aw/apicenter"
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex items-center gap-1 px-2 h-7 rounded-md bg-info/15 border border-info/40 text-info text-xs font-medium hover:bg-info/25"
              >
                Abrir API Center ↗
              </a>
              <a
                href="https://developers.google.com/google-ads/api/docs/access-levels"
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex items-center gap-1 px-2 h-7 rounded-md bg-surface-2 border border-border text-fg-muted text-xs font-medium hover:bg-surface-3 hover:text-fg"
              >
                Sobre níveis de acesso ↗
              </a>
            </div>
            <p class="mt-2 text-2xs text-fg-muted">
              Alternativa imediata para testes: criar uma <strong>conta de teste</strong> no MCC
              e usar o Customer ID dela durante o desenvolvimento.
            </p>
          </div>
        )}

        {versionDeprecated && (
          <p class="mt-2 text-2xs text-fg-muted">
            A versão da API configurada no servidor foi descontinuada pelo Google.
            Avise o admin pra atualizar <code class="px-1 py-0.5 rounded bg-surface-3">GOOGLE_ADS_API_VERSION</code>.
          </p>
        )}

        {!apiNotEnabled && !versionDeprecated && !testTokenOnly && (
          <p class="mt-1 text-2xs text-fg-muted">
            Causas comuns: Google Ads API não habilitada no projeto Cloud, Developer Token pendente de aprovação, ou conta Google sem permissão de leitura.
          </p>
        )}
      </div>
    </div>
  )
}

// Formata customer ID 10 dígitos como 123-456-7890 (visual Google Ads)
function formatCustomerId(id: string): string {
  const d = id.replace(/[^0-9]/g, '')
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`
  return d
}

function LoginCustomerIdCard() {
  const { data } = useGoogleAdsLoginCustomerId()
  const update = useUpdateGoogleAdsLoginCustomerId()
  const [value, setValue] = useState('')

  // Sincroniza valor inicial quando o dado carrega
  useEffect(() => {
    if (data) setValue(data.loginCustomerId ?? '')
  }, [data])

  function handleSave() {
    update.mutate(value, {
      onSuccess: (r) => toast(
        r.loginCustomerId
          ? `Login Customer ID salvo: ${formatCustomerId(r.loginCustomerId)}`
          : 'Login Customer ID removido',
        'success',
      ),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Login Customer ID (MCC)</CardTitle>
      </CardHeader>
      <div class="text-xs text-fg-muted mb-2">
        Quando o <strong>Developer Token</strong> vive em uma conta MCC (Manager) e as contas que você sincroniza são <strong>sub-contas</strong> dela, o Google exige enviar o ID da MCC no header <code class="font-mono">login-customer-id</code>. Sem isso o sync retorna vazio ou <code class="font-mono">PERMISSION_DENIED</code>. <span class="text-fg-muted">Deixe vazio se você só usa contas standalone (sem MCC).</span>
      </div>
      <div class="flex gap-2 items-end">
        <div class="flex-1">
          <label class="text-xs text-fg-muted block mb-1">ID da MCC (10 dígitos, sem traços)</label>
          <input
            type="text"
            inputMode="numeric"
            value={value}
            onInput={(e) => setValue((e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 10))}
            placeholder="ex.: 1234567890"
            class="w-full text-sm rounded-md border border-border bg-surface px-2 py-1.5 font-mono focus:outline-none focus:border-accent"
          />
        </div>
        <Button variant="primary" size="sm" onClick={handleSave} disabled={update.isPending}>
          {update.isPending ? 'Salvando…' : 'Salvar'}
        </Button>
      </div>
      <div class="text-2xs text-fg-muted mt-2">
        Atual: {data?.loginCustomerId ? <code class="font-mono">{formatCustomerId(data.loginCustomerId)}</code> : <em>não definido</em>}
      </div>
    </Card>
  )
}
