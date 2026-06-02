import { useMemo, useState } from 'preact/hooks'
import { CreditCard, Plus, Pencil, Trash2, Plug, Copy, Check, BarChart3, ListChecks, Webhook, Ticket, Plug as PlugIcon, HelpCircle } from 'lucide-preact'
import { HowItWorksModal } from '@/components/ui/HowItWorksModal'
import {
  usePaymentConnections,
  useCreatePaymentConnection,
  useUpdatePaymentConnection,
  useDeletePaymentConnection,
  useTestPaymentConnection,
  type PaymentConnection,
  type PaymentConnectionInput,
  type PaymentEnvironment,
  type PaymentBillingType,
  type PaymentProvider,
} from '@/hooks/usePayments'
import { Page } from '@/components/ui/Page'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Input, Select } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/cn'
import { PaymentsOverviewTab } from './payments/PaymentsOverviewTab'
import { PaymentMethodsTab } from './payments/PaymentMethodsTab'
import { WebhookHitsTab } from './payments/WebhookHitsTab'
import { CouponsTab } from './payments/CouponsTab'

type HubTab = 'overview' | 'methods' | 'connections' | 'webhooks' | 'coupons'

export function PaymentsPage() {
  const [tab, setTab] = useState<HubTab>('overview')
  const [showHowItWorks, setShowHowItWorks] = useState(false)

  return (
    <Page
      title="Pagamentos"
      description="Painel completo: visão geral, cobranças, conexões, webhooks e cupons."
      actions={
        <Button variant="ghost" size="sm" onClick={() => setShowHowItWorks(true)}>
          <HelpCircle size={14} /> Como funciona?
        </Button>
      }
    >
      <div class="flex border-b border-border overflow-x-auto">
        {([
          { id: 'overview',    label: 'Visão Geral',  Icon: BarChart3 },
          { id: 'methods',     label: 'Cobranças',    Icon: ListChecks },
          { id: 'connections', label: 'Conexões',     Icon: PlugIcon },
          { id: 'webhooks',    label: 'Webhooks',     Icon: Webhook },
          { id: 'coupons',     label: 'Cupons',       Icon: Ticket },
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
                  ? 'border-accent text-fg font-semibold'
                  : 'border-transparent text-fg-muted hover:text-fg',
              )}
            >
              <t.Icon size={14} />
              {t.label}
            </button>
          )
        })}
      </div>

      <div class="pt-4">
        {tab === 'overview'    && <PaymentsOverviewTab />}
        {tab === 'methods'     && <PaymentMethodsTab />}
        {tab === 'connections' && <PaymentConnectionsTab />}
        {tab === 'webhooks'    && <WebhookHitsTab />}
        {tab === 'coupons'     && <CouponsTab />}
      </div>

      <HowItWorksModal
        open={showHowItWorks}
        onClose={() => setShowHowItWorks(false)}
        title="Como funcionam os Pagamentos?"
        problem={<>
          Vendedor fechou venda — agora precisa enviar a cobrança. Sem integração, copia e cola link
          do Asaas/Pagar.me, e o sistema não sabe quando o cliente pagou. Aqui você <strong>conecta os
          provedores</strong>, gera links direto do CRM, e <strong>recebe a confirmação automática</strong>{' '}
          via webhook (marca como pago, dispara fluxos, atualiza venda).
        </>}
        steps={[
          {
            title: '📊 Visão Geral',
            body: <>KPIs do mês: receita confirmada, valor pendente, tickets pagos, taxa de conversão. Gráfico de tendência. Bate o olho aqui pra ver saúde financeira.</>,
          },
          {
            title: '💳 Cobranças',
            body: <>Lista de todas as cobranças geradas (pelo vendedor manualmente ou por automação). Status: pendente, pago, cancelado. Filtre por lead, provedor, período. Clique pra ver detalhe e link pra cobrança no provedor.</>,
          },
          {
            title: '🔌 Conexões',
            body: <>Conecte <strong>Asaas</strong> (PIX, boleto, cartão) e <strong>Pagar.me</strong> (cartão, boleto, PIX). Pode ter várias conexões (uma por unidade/empresa). Cada uma com seu token de API e modo (sandbox/produção).</>,
          },
          {
            title: '🪝 Webhooks',
            body: <>Lista dos eventos que os provedores enviaram. Quando cliente paga, vem webhook → sistema marca como pago → dispara fluxos vinculados (mover etapa, mandar agradecimento, gerar nota fiscal). Falhas aparecem aqui pra retry.</>,
          },
          {
            title: '🎟️ Cupons',
            body: <>Crie cupons de desconto (% ou valor fixo, com validade, limite de uso, restrição por produto). Use em links de cobrança e no portal de matrículas. Acompanhe quantos foram resgatados.</>,
          },
        ]}
        tip={{
          tone: 'warning',
          title: '⚠️ Configure o webhook no provedor',
          body: <>A integração não funciona se você só conectar a API. <strong>Vá no painel do Asaas/Pagar.me</strong> e cadastre a URL do webhook que aparece em Conexões. Sem isso, pagamentos chegam no provedor mas não são marcados no CRM.</>,
        }}
      />
    </Page>
  )
}

function providerLabel(p: PaymentProvider): string {
  return p === 'pagarme' ? 'Pagar.me' : 'Asaas'
}

const TAB_ORDER: PaymentProvider[] = ['asaas', 'pagarme']

function PaymentConnectionsTab() {
  const { data, isLoading } = usePaymentConnections()
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<PaymentConnection | null>(null)
  const [deleting, setDeleting] = useState<PaymentConnection | null>(null)
  const [activeTab, setActiveTab] = useState<PaymentProvider>('asaas')

  const connections = data?.connections ?? []
  const counts = useMemo(() => {
    return TAB_ORDER.reduce<Record<PaymentProvider, number>>((acc, p) => {
      acc[p] = connections.filter((c) => c.provider === p).length
      return acc
    }, { asaas: 0, pagarme: 0 })
  }, [connections])

  const visible = connections.filter((c) => c.provider === activeTab)

  return (
    <div class="space-y-4">
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <div class="flex items-center gap-1.5 border-b border-border">
          {TAB_ORDER.map((p) => {
            const active = activeTab === p
            return (
              <button
                key={p}
                type="button"
                onClick={() => setActiveTab(p)}
                class={`relative -mb-px h-9 px-3 text-sm font-medium border-b-2 transition-colors ${
                  active
                    ? 'border-accent text-fg'
                    : 'border-transparent text-fg-muted hover:text-fg'
                }`}
              >
                {providerLabel(p)}
                <span class={`ml-1.5 inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full text-xs ${
                  active ? 'bg-accent text-white' : 'bg-surface-3 text-fg-muted'
                }`}>
                  {counts[p]}
                </span>
              </button>
            )
          })}
        </div>
        <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
          <Plus size={14} /> Nova conexão
        </Button>
      </div>

      {isLoading && (
        <div class="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} class="h-48 w-full" />)}
        </div>
      )}

      {!isLoading && visible.length === 0 && (
        <EmptyState
          icon={<CreditCard size={24} />}
          title={`Nenhuma conexão ${providerLabel(activeTab)}`}
          description={`Você ainda não cadastrou nenhuma conexão ${providerLabel(activeTab)}. Configure uma para receber pagamentos via PIX, boleto ou cartão — uma conexão pode ser reaproveitada por vários portais.`}
          action={
            <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
              <Plus size={14} /> Criar conexão {providerLabel(activeTab)}
            </Button>
          }
        />
      )}

      {!isLoading && visible.length > 0 && (
        <div class="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((c) => (
            <ConnectionCard
              key={c.id}
              connection={c}
              onEdit={() => setEditing(c)}
              onDelete={() => setDeleting(c)}
            />
          ))}
        </div>
      )}

      {(creating || editing) && (
        <ConnectionFormModal
          connection={editing}
          defaultProvider={activeTab}
          onClose={() => { setCreating(false); setEditing(null) }}
        />
      )}

      {deleting && (
        <DeleteConnectionDialog
          connection={deleting}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  )
}

function ConnectionCard({
  connection,
  onEdit,
  onDelete,
}: {
  connection: PaymentConnection
  onEdit: () => void
  onDelete: () => void
}) {
  const test = useTestPaymentConnection()
  const portalsCount = connection._count?.portals ?? 0
  const inUse = portalsCount > 0

  function handleTest() {
    test.mutate(connection.id, {
      onSuccess: (r) => toast(r.message, r.ok ? 'success' : 'danger'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <div class="flex flex-col rounded-lg border border-border bg-surface-2 overflow-hidden">
      <div class="p-4 border-b border-border">
        <div class="flex items-start justify-between gap-2 mb-2">
          <div class="min-w-0 flex-1">
            <div class="text-sm font-semibold text-fg truncate" title={connection.name}>{connection.name}</div>
            <div class="flex items-center gap-2 mt-1">
              <span class="text-xs text-fg-muted">{providerLabel(connection.provider)}</span>
              <Badge tone={connection.environment === 'production' ? 'success' : 'danger'} solid>
                {connection.environment === 'production' ? 'PRODUÇÃO' : 'TESTE'}
              </Badge>
            </div>
          </div>
          <Badge tone={connection.active ? 'success' : 'danger'}>
            {connection.active ? 'Ativo' : 'Inativo'}
          </Badge>
        </div>
        <div class="text-xs text-fg-muted font-mono">API key: {connection.apiKeyMasked || '—'}</div>
        {portalsCount > 0 && (
          <div class="text-xs text-info mt-1">{portalsCount} portal(is) usando esta conexão</div>
        )}
      </div>

      <div class="px-4 py-2 border-b border-border">
        <TestStatus connection={connection} />
      </div>

      <div class="p-3 flex gap-2 mt-auto">
        <Button variant="secondary" size="sm" onClick={handleTest} disabled={test.isPending} class="flex-1">
          <Plug size={12} /> {test.isPending ? 'Testando…' : 'Testar'}
        </Button>
        <Button variant="secondary" size="sm" onClick={onEdit} class="flex-1">
          <Pencil size={12} /> Editar
        </Button>
        <button
          type="button"
          class="size-8 rounded-md grid place-items-center text-fg-muted hover:text-danger hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={onDelete}
          disabled={inUse}
          title={inUse ? 'Desvincule dos portais primeiro' : 'Excluir'}
          aria-label="Excluir"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  )
}

function TestStatus({ connection }: { connection: PaymentConnection }) {
  if (!connection.lastTestStatus) {
    return <div class="text-xs text-fg-subtle">○ Nunca testado</div>
  }
  const ok = connection.lastTestStatus === 'ok'
  const tone = ok ? 'text-accent' : 'text-danger'
  const label = connection.lastTestMessage ?? (ok ? 'Conectado' : 'Falhou')
  const when = connection.lastTestedAt ? new Date(connection.lastTestedAt).toLocaleString('pt-BR') : null
  return (
    <div class={`text-xs ${tone}`}>
      <span>{ok ? '✓' : '✕'} </span>
      <span class="break-words">{label}</span>
      {when && <div class="text-fg-subtle mt-0.5">{when}</div>}
    </div>
  )
}

function ConnectionFormModal({
  connection,
  defaultProvider,
  onClose,
}: {
  connection: PaymentConnection | null
  defaultProvider?: PaymentProvider
  onClose: () => void
}) {
  const isEdit = !!connection
  const [name, setName] = useState(connection?.name ?? '')
  const [provider, setProvider] = useState<PaymentProvider>(connection?.provider ?? defaultProvider ?? 'asaas')
  const [environment, setEnvironment] = useState<PaymentEnvironment>(connection?.environment ?? 'sandbox')
  const [apiKey, setApiKey] = useState('')
  const [publicKey, setPublicKey] = useState('')
  const [billingType, setBillingType] = useState<PaymentBillingType>(
    (connection?.defaultBillingType as PaymentBillingType | null) ?? 'UNDEFINED',
  )
  const [companyDocument, setCompanyDocument] = useState(connection?.companyDocument ?? '')
  const [accountHolder, setAccountHolder] = useState(connection?.accountHolder ?? '')
  const [active, setActive] = useState(connection?.active ?? true)

  const isPagarme = provider === 'pagarme'
  // Pagar.me: ambiente derivado do prefixo da chave (sk_test_ vs sk_) — exibe automático
  const detectedPagarmeEnv: PaymentEnvironment = apiKey.trim().startsWith('sk_test_')
    ? 'sandbox'
    : (apiKey.trim().startsWith('sk_') ? 'production' : environment)

  const create = useCreatePaymentConnection()
  const update = useUpdatePaymentConnection()
  const test = useTestPaymentConnection()
  const loading = create.isPending || update.isPending

  function handleSubmit() {
    if (!name.trim()) {
      toast('Nome é obrigatório', 'danger')
      return
    }
    if (!isEdit && !apiKey.trim()) {
      toast('Informe a API key do provedor', 'danger')
      return
    }
    const payload: PaymentConnectionInput = {
      name: name.trim(),
      provider,
      // Pagar.me: backend ignora e deriva do prefixo da chave
      environment: isPagarme ? detectedPagarmeEnv : environment,
      // Pagar.me sempre aceita PIX/cartão/boleto no link — billing type não se aplica
      defaultBillingType: isPagarme ? null : billingType,
      companyDocument: companyDocument.trim() || null,
      accountHolder: accountHolder.trim() || null,
      active,
    }
    if (apiKey.trim()) payload.apiKey = apiKey.trim()
    if (publicKey.trim()) payload.publicKey = publicKey.trim()

    if (isEdit && connection) {
      update.mutate({ id: connection.id, ...payload }, {
        onSuccess: () => { toast('Conexão atualizada', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    } else {
      create.mutate(payload, {
        onSuccess: () => { toast('Conexão criada', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    }
  }

  function handleTest() {
    if (!connection) return
    test.mutate(connection.id, {
      onSuccess: (r) => toast(r.message, r.ok ? 'success' : 'danger'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  const webhookUrl = connection?.webhookToken
    ? `${location.origin}/api/public/payment-webhook/${connection.provider}/${connection.webhookToken}`
    : ''

  const apiKeyHint = isPagarme
    ? 'Painel Pagar.me → Configurações → Chaves de API → use a Secret Key (sk_test_… para teste, sk_… para produção). Valor é criptografado antes de gravar.'
    : 'Painel Asaas → Integrações → API key. Valor é criptografado antes de gravar.'

  const apiKeyPlaceholder = isPagarme ? 'sk_test_… ou sk_…' : 'aact_YWxz…'

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={isEdit ? 'Editar conexão de pagamento' : 'Nova conexão de pagamento'}
      size="lg"
      footer={
        <div class="flex items-center justify-between w-full gap-2">
          <div>
            {isEdit && (
              <Button variant="secondary" size="sm" onClick={handleTest} disabled={test.isPending}>
                <Plug size={12} /> {test.isPending ? 'Testando…' : 'Testar conexão'}
              </Button>
            )}
          </div>
          <div class="flex gap-2">
            <Button variant="secondary" size="sm" onClick={onClose} disabled={loading}>Cancelar</Button>
            <Button variant="primary" size="sm" onClick={handleSubmit} disabled={loading}>
              {loading ? 'Salvando…' : 'Salvar'}
            </Button>
          </div>
        </div>
      }
    >
      <div class="space-y-3">
        <Input
          label="Nome da conexão *"
          value={name}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
          placeholder="Ex.: Asaas Produção Beyond"
        />
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Select
            label="Provedor *"
            value={provider}
            onChange={(e) => setProvider((e.target as HTMLSelectElement).value as PaymentProvider)}
            disabled={isEdit}
            hint={isEdit ? 'Não é possível trocar o provedor de uma conexão existente' : ''}
          >
            <option value="asaas">Asaas (PIX, boleto, cartão)</option>
            <option value="pagarme">Pagar.me (PIX, boleto, cartão)</option>
          </Select>
          {isPagarme ? (
            <Input
              label="Ambiente"
              value={detectedPagarmeEnv === 'production' ? 'Produção' : 'Sandbox (teste)'}
              disabled
              hint="Detectado pelo prefixo da chave (sk_test_ = teste, sk_ = produção)"
            />
          ) : (
            <Select
              label="Ambiente *"
              value={environment}
              onChange={(e) => setEnvironment((e.target as HTMLSelectElement).value as PaymentEnvironment)}
            >
              <option value="sandbox">Sandbox (teste)</option>
              <option value="production">Produção</option>
            </Select>
          )}
        </div>
        <Input
          label={isEdit ? 'API key (deixe vazio para manter atual)' : 'API key *'}
          type="password"
          value={apiKey}
          onInput={(e) => setApiKey((e.target as HTMLInputElement).value)}
          placeholder={isEdit ? (connection?.apiKeyMasked || 'Deixe vazio para manter') : apiKeyPlaceholder}
          hint={apiKeyHint}
        />
        {isPagarme && (
          <Input
            label="Public key (opcional, libera cartão no checkout transparente)"
            type="password"
            value={publicKey}
            onInput={(e) => setPublicKey((e.target as HTMLInputElement).value)}
            placeholder={isEdit && connection?.hasPublicKey
              ? (connection.publicKeyMasked || 'Deixe vazio para manter')
              : 'pk_…'}
            hint="Pagar.me → Configurações → Chaves de API → Public Key. Permite tokenizar cartão no navegador (PCI SAQ A) quando o portal usa checkout transparente. PIX e boleto não precisam dela."
          />
        )}
        {!isPagarme && (
          <Select
            label="Forma de pagamento padrão"
            value={billingType}
            onChange={(e) => setBillingType((e.target as HTMLSelectElement).value as PaymentBillingType)}
          >
            <option value="UNDEFINED">Cliente escolhe (PIX/boleto/cartão)</option>
            <option value="PIX">Somente PIX</option>
            <option value="BOLETO">Somente Boleto</option>
            <option value="CREDIT_CARD">Somente Cartão</option>
          </Select>
        )}
        {isPagarme && (
          <div class="text-xs text-fg-muted bg-surface-3 rounded-md p-2.5">
            O link de pagamento do Pagar.me sempre aceita <strong>PIX, cartão e boleto</strong> — o candidato escolhe na hora.
          </div>
        )}
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="CNPJ da conta (opcional)"
            value={companyDocument}
            onInput={(e) => setCompanyDocument((e.target as HTMLInputElement).value)}
            placeholder="00.000.000/0000-00"
          />
          <Input
            label="Titular (opcional)"
            value={accountHolder}
            onInput={(e) => setAccountHolder((e.target as HTMLInputElement).value)}
            placeholder="Nome da empresa"
          />
        </div>
        <label class="flex items-center gap-2 text-sm text-fg-muted cursor-pointer">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive((e.target as HTMLInputElement).checked)}
          />
          <div>
            <div class="text-sm text-fg">Conexão ativa</div>
            <div class="text-xs text-fg-muted">Portais vinculados não conseguem processar cobrança se inativa</div>
          </div>
        </label>

        {webhookUrl ? (
          <WebhookUrlBox url={webhookUrl} provider={connection!.provider} />
        ) : (
          <div class="rounded-md border border-warning/30 bg-warning/10 p-3 text-xs text-fg">
            Salve a conexão primeiro para gerar a URL única do webhook.
          </div>
        )}
      </div>
    </Modal>
  )
}

function WebhookUrlBox({ url, provider }: { url: string; provider: PaymentProvider }) {
  const [copied, setCopied] = useState(false)

  function copy() {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      toast('URL copiada', 'success')
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => toast('Não foi possível copiar', 'danger'))
  }

  return (
    <div class="rounded-md border border-accent/30 bg-accent/10 p-3">
      <div class="text-xs font-medium text-fg mb-1 flex items-center gap-1.5">
        <Check size={12} class="text-accent" /> URL única do webhook
      </div>
      <div class="flex gap-2 items-center">
        <code class="flex-1 text-xs font-mono bg-surface px-2 py-1.5 rounded break-all">{url}</code>
        <Button variant="secondary" size="sm" onClick={copy}>
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copiado' : 'Copiar'}
        </Button>
      </div>
      <div class="text-xs text-fg-muted mt-2">
        {provider === 'pagarme' ? (
          <>
            Configure no Pagar.me em <strong>Configurações → Webhooks</strong>, eventos:
            {' '}<code class="font-mono">order.paid, charge.paid, charge.refunded, charge.payment_failed</code>.
            Cole a URL acima no campo de endpoint.
          </>
        ) : (
          <>
            Configure no Asaas em <strong>Integrações → Webhooks</strong>, eventos:
            {' '}<code class="font-mono">PAYMENT_CONFIRMED, PAYMENT_RECEIVED, PAYMENT_OVERDUE, PAYMENT_REFUNDED</code>.
          </>
        )}
      </div>
    </div>
  )
}

function DeleteConnectionDialog({
  connection,
  onClose,
}: {
  connection: PaymentConnection
  onClose: () => void
}) {
  const del = useDeletePaymentConnection()
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Excluir "${connection.name}"`}
      description="Esta ação não pode ser desfeita. Portais vinculados perdem o gateway de pagamento."
      destructive
      confirmLabel="Excluir"
      loading={del.isPending}
      onConfirm={() => del.mutate(connection.id, {
        onSuccess: () => { toast('Conexão excluída', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })}
    />
  )
}
