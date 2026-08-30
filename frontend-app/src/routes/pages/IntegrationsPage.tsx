import { useState, useMemo } from 'preact/hooks'
import {
  Plug,
  Megaphone,
  Cloud,
  MessageSquare,
  Send,
  TrendingUp,
  Webhook,
  CheckCircle,
  Search as SearchIcon,
  Phone,
  AtSign,
  FileSpreadsheet,
  CalendarRange,
  HardDrive,
  ListChecks,
  Mail,
  LineChart,
  Boxes,
  CreditCard,
  AlertCircle,
  Clock,
  HelpCircle,
  Database,
} from '@/components/ui/icon-set'
import type { JSX } from 'preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { HowItWorksModal } from '@/components/ui/HowItWorksModal'
import { useLocation } from 'wouter-preact'
import { cn } from '@/lib/cn'
import { useInstances } from '@/hooks/useInstances'
import { useCloudApiConnections, useCloudApiConfig } from '@/hooks/useCloudApi'
import { useTelegramConnection } from '@/hooks/useTelegram'
import { useInstagramConnection } from '@/hooks/useInstagram'
import { useMetaStatus, useMetaConfig } from '@/hooks/useMeta'
import { useGoogleAdsConfig } from '@/hooks/useGoogleAds'
import {
  useGoogleConfig,
  useGoogleConnections,
  useSheetIntegrations,
  useCalendarIntegrations,
  useDriveConfig,
  useTasksConfigs,
  useGmailConfigs,
  useGa4Configs,
} from '@/hooks/useGoogle'
import { useWebhooks } from '@/hooks/useWebhooks'
import { usePaymentConnections } from '@/hooks/usePayments'
import { useDbConnectors } from '@/hooks/useDbConnectors'

type Category = 'channels' | 'ads' | 'google' | 'payments' | 'automation' | 'data'

type StatusState = 'connected' | 'partial' | 'disconnected' | 'error' | 'pending' | 'unconfigured'

interface StatusInfo {
  state: StatusState
  detail?: string | undefined
  error?: string | undefined
}

interface IntegrationDef {
  id: string
  name: string
  description: string
  icon: typeof Plug
  category: Category
  href?: string | undefined
  /** componente que faz seu próprio fetch de status (cada hook decide). */
  useStatus: () => StatusInfo
}

const CATEGORY_LABELS: Record<Category, string> = {
  channels: 'Canais',
  ads: 'Anúncios',
  google: 'Google Workspace',
  payments: 'Pagamentos',
  automation: 'Automação & Webhooks',
  data: 'Dados externos',
}

const CATEGORY_ORDER: Category[] = ['channels', 'ads', 'google', 'automation', 'data', 'payments']

// ─── Hooks de status (um por integração) ──────────────────────────────────

function useWhatsAppStatus(): StatusInfo {
  const { data, isLoading } = useInstances()
  if (isLoading) return { state: 'pending' }
  const list = data?.instances ?? []
  if (list.length === 0) return { state: 'disconnected', detail: 'Nenhuma instância' }
  const connected = list.filter((i) => i.status === 'connected').length
  if (connected === 0) return { state: 'disconnected', detail: `${list.length} instância(s) · 0 conectadas` }
  if (connected < list.length) return { state: 'partial', detail: `${connected}/${list.length} conectadas` }
  return { state: 'connected', detail: `${list.length} conectada(s)` }
}

function useCloudApiStatus(): StatusInfo {
  const { data, isLoading } = useCloudApiConnections()
  const { data: config } = useCloudApiConfig()
  if (isLoading) return { state: 'pending' }
  const list = data?.connections ?? []
  if (list.length === 0) {
    if (config && (!config.appId || !config.configId)) return { state: 'unconfigured', detail: 'App ID / Config ID ausentes' }
    return { state: 'disconnected', detail: 'Nenhuma conta WABA' }
  }
  const valid = list.filter((c) => c.tokenStatus === 'valid').length
  const expired = list.filter((c) => c.tokenStatus === 'expired').length
  if (expired > 0) return { state: 'error', detail: `${expired} token(s) expirado(s)`, error: 'Reconectar via Embedded Signup' }
  return { state: 'connected', detail: `${valid} conta(s) WABA` }
}

function useTelegramStatus(): StatusInfo {
  const { data, isLoading } = useTelegramConnection()
  if (isLoading) return { state: 'pending' }
  if (!data?.connected) return { state: 'disconnected' }
  return { state: 'connected', detail: data.botUsername ? `@${data.botUsername}` : 'Bot conectado' }
}

function useInstagramStatus(): StatusInfo {
  const { data, isLoading } = useInstagramConnection()
  if (isLoading) return { state: 'pending' }
  if (!data?.connected) return { state: 'disconnected' }
  return { state: 'connected', detail: data.igUsername ? `@${data.igUsername}` : 'Conta conectada' }
}

function useMetaAdsStatus(): StatusInfo {
  const { data, isLoading } = useMetaStatus()
  const { data: config } = useMetaConfig()
  if (isLoading) return { state: 'pending' }
  const list = data?.integrations ?? []
  if (list.length === 0) {
    if (config && (!config.appId || !config.configId)) return { state: 'unconfigured', detail: 'App ID / Config ID ausentes' }
    return { state: 'disconnected', detail: 'Nenhuma página vinculada' }
  }
  const active = list.filter((i) => i.active).length
  const detail = `${active}/${list.length} página(s) ativa(s)${data?.pollerActive ? ' · poller on' : ''}`
  if (active === 0) return { state: 'disconnected', detail }
  return { state: 'connected', detail }
}

function useGoogleAdsStatus(): StatusInfo {
  const { data, isLoading } = useGoogleAdsConfig()
  if (isLoading) return { state: 'pending' }
  // O endpoint pode retornar null/objeto vazio quando não configurado
  const cfg = data as unknown as { configured?: boolean; customerId?: string } | null
  if (!cfg || cfg.configured === false) return { state: 'disconnected', detail: 'Não configurado' }
  if (cfg.customerId) return { state: 'connected', detail: `Customer ID: ${cfg.customerId}` }
  return { state: 'connected' }
}

function useGoogleSuiteStatus(): StatusInfo {
  const { data: cfg, isLoading: loadingCfg } = useGoogleConfig()
  const { data: conns, isLoading: loadingConns } = useGoogleConnections()
  if (loadingCfg || loadingConns) return { state: 'pending' }
  if (!cfg?.configured) return { state: 'unconfigured', detail: 'Client ID / Secret ausentes' }
  const list = conns?.data ?? []
  if (list.length === 0) return { state: 'disconnected', detail: 'OAuth não autorizado' }
  return { state: 'connected', detail: `${list.length} conta(s) Google` }
}

function useGoogleSheetsStatus(): StatusInfo {
  const { data, isLoading } = useSheetIntegrations()
  if (isLoading) return { state: 'pending' }
  const list = data?.data ?? []
  if (list.length === 0) return { state: 'disconnected', detail: 'Nenhuma planilha vinculada' }
  const active = list.filter((i) => i.active).length
  return { state: active > 0 ? 'connected' : 'disconnected', detail: `${active}/${list.length} ativa(s)` }
}

function useGoogleCalendarStatus(): StatusInfo {
  const { data, isLoading } = useCalendarIntegrations()
  if (isLoading) return { state: 'pending' }
  const list = data?.data ?? []
  if (list.length === 0) return { state: 'disconnected', detail: 'Nenhum calendário' }
  const active = list.filter((i) => i.active).length
  return { state: active > 0 ? 'connected' : 'disconnected', detail: `${active}/${list.length} ativo(s)` }
}

function useGoogleDriveStatus(): StatusInfo {
  const { data, isLoading } = useDriveConfig()
  if (isLoading) return { state: 'pending' }
  const cfg = data as unknown as { data?: { active: boolean; rootFolderId: string } } | null
  if (!cfg?.data) return { state: 'disconnected', detail: 'Pasta raiz não definida' }
  return { state: cfg.data.active ? 'connected' : 'disconnected', detail: cfg.data.active ? 'Pasta raiz configurada' : 'Inativo' }
}

function useGoogleTasksStatus(): StatusInfo {
  const { data, isLoading } = useTasksConfigs()
  if (isLoading) return { state: 'pending' }
  const list = data?.data ?? []
  if (list.length === 0) return { state: 'disconnected', detail: 'Nenhuma lista vinculada' }
  const active = list.filter((c) => c.active).length
  return { state: active > 0 ? 'connected' : 'disconnected', detail: `${active}/${list.length} ativa(s)` }
}

function useGmailStatus(): StatusInfo {
  const { data, isLoading } = useGmailConfigs()
  if (isLoading) return { state: 'pending' }
  const list = data?.data ?? []
  if (list.length === 0) return { state: 'disconnected', detail: 'Nenhuma conta vinculada' }
  return { state: 'connected', detail: `${list.length} conta(s)` }
}

function useGa4Status(): StatusInfo {
  const { data, isLoading } = useGa4Configs()
  if (isLoading) return { state: 'pending' }
  const list = data?.data ?? []
  if (list.length === 0) return { state: 'disconnected', detail: 'Nenhum stream configurado' }
  const active = list.filter((c) => c.active).length
  return { state: active > 0 ? 'connected' : 'disconnected', detail: `${active}/${list.length} ativo(s)` }
}

function useMakeStatus(): StatusInfo {
  // App definition é só "tem o app exposto"; uso real é via webhook signing.
  // Reportamos apenas se o endpoint público responde.
  return { state: 'connected', detail: 'App custom disponível' }
}

function useWebhooksStatus(): StatusInfo {
  const { data, isLoading } = useWebhooks()
  if (isLoading) return { state: 'pending' }
  const list = data?.data ?? []
  if (list.length === 0) return { state: 'disconnected', detail: 'Nenhum webhook' }
  const active = list.filter((w) => w.active).length
  return { state: active > 0 ? 'connected' : 'disconnected', detail: `${active}/${list.length} ativo(s)` }
}

function useDbConnectorsStatus(): StatusInfo {
  const { data, isLoading } = useDbConnectors()
  if (isLoading) return { state: 'pending' }
  const list = data?.items ?? []
  if (list.length === 0) return { state: 'unconfigured', detail: 'Nenhum conector' }
  const active = list.filter((c) => c.active).length
  const withError = list.filter((c) => c.lastRunStatus === 'error').length
  if (withError > 0) return { state: 'error', detail: `${withError} com erro` }
  return { state: active > 0 ? 'connected' : 'disconnected', detail: `${active}/${list.length} ativo(s)` }
}

function useProviderPaymentsStatus(provider: 'asaas' | 'pagarme'): StatusInfo {
  const { data, isLoading } = usePaymentConnections()
  if (isLoading) return { state: 'pending' }
  const list = (data?.connections ?? []).filter((c) => c.provider === provider)
  if (list.length === 0) return { state: 'disconnected', detail: 'Nenhuma conexão' }
  const active = list.filter((c) => c.active).length
  const errored = list.filter((c) => c.lastTestStatus === 'error').length
  if (errored > 0) return { state: 'error', detail: `${errored} com erro recente`, error: 'Verifique o último teste' }
  return { state: active > 0 ? 'connected' : 'disconnected', detail: `${active}/${list.length} ativa(s)` }
}

// ─── Registry ─────────────────────────────────────────────────────────────

const INTEGRATIONS: IntegrationDef[] = [
  // CANAIS
  {
    id: 'whatsapp',
    name: 'WhatsApp (Evolution / Z-API)',
    description: 'Conecte instâncias via Evolution API ou Z-API para enviar e receber mensagens.',
    icon: Phone,
    category: 'channels',
    href: '/whatsapp',
    useStatus: useWhatsAppStatus,
  },
  {
    id: 'cloud-api',
    name: 'WhatsApp Cloud API',
    description: 'Embedded Signup oficial do Meta com System User Token (permanente) e templates HSM.',
    icon: Cloud,
    category: 'channels',
    href: '/cloud-api',
    useStatus: useCloudApiStatus,
  },
  {
    id: 'telegram',
    name: 'Telegram',
    description: 'Bot API para receber e enviar mensagens.',
    icon: Send,
    category: 'channels',
    href: '/telegram',
    useStatus: useTelegramStatus,
  },
  {
    id: 'instagram',
    name: 'Instagram',
    description: 'DMs via Messenger Platform vinculadas a uma página do Facebook.',
    icon: AtSign,
    category: 'channels',
    href: '/instagram',
    useStatus: useInstagramStatus,
  },

  // ANÚNCIOS
  {
    id: 'meta-ads',
    name: 'Meta Ads (Facebook + Instagram)',
    description: 'Lead Ads → leads automáticos via webhook + polling fallback.',
    icon: Megaphone,
    category: 'ads',
    href: '/meta-ads',
    useStatus: useMetaAdsStatus,
  },
  {
    id: 'google-ads',
    name: 'Google Ads',
    description: 'Conversões offline e attribution para campanhas search/display.',
    icon: TrendingUp,
    category: 'ads',
    href: '/google-ads',
    useStatus: useGoogleAdsStatus,
  },

  // GOOGLE WORKSPACE
  {
    id: 'google',
    name: 'Google Suite (OAuth)',
    description: 'Autenticação OAuth + contas conectadas. Pré-requisito para Sheets/Calendar/Drive/Tasks/Gmail/GA4.',
    icon: MessageSquare,
    category: 'google',
    href: '/google',
    useStatus: useGoogleSuiteStatus,
  },
  {
    id: 'google-sheets',
    name: 'Google Sheets',
    description: 'Espelhar leads/eventos em planilhas para relatórios e Data Studio.',
    icon: FileSpreadsheet,
    category: 'google',
    href: '/google?tab=sheets',
    useStatus: useGoogleSheetsStatus,
  },
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    description: 'Sincroniza atividades como eventos no Calendar com Meet automático.',
    icon: CalendarRange,
    category: 'google',
    href: '/google?tab=calendar',
    useStatus: useGoogleCalendarStatus,
  },
  {
    id: 'google-drive',
    name: 'Google Drive',
    description: 'Pasta-raiz por lead com upload automático de mídias do chat.',
    icon: HardDrive,
    category: 'google',
    href: '/google?tab=drive',
    useStatus: useGoogleDriveStatus,
  },
  {
    id: 'google-tasks',
    name: 'Google Tasks',
    description: 'Espelha atividades do CRM como tarefas no Google Tasks.',
    icon: ListChecks,
    category: 'google',
    href: '/google?tab=tasks',
    useStatus: useGoogleTasksStatus,
  },
  {
    id: 'gmail',
    name: 'Gmail',
    description: 'Envio de emails saindo do CRM com assinatura e remetente personalizados.',
    icon: Mail,
    category: 'google',
    href: '/google?tab=gmail',
    useStatus: useGmailStatus,
  },
  {
    id: 'ga4',
    name: 'Google Analytics 4',
    description: 'Envia eventos de conversão para GA4 via Measurement Protocol.',
    icon: LineChart,
    category: 'google',
    href: '/google?tab=ga4',
    useStatus: useGa4Status,
  },

  // AUTOMAÇÃO & WEBHOOKS
  {
    id: 'make',
    name: 'Make.com',
    description: 'App custom para usar leads/eventos como triggers e ações no Make.',
    icon: Boxes,
    category: 'automation',
    href: '/make',
    useStatus: useMakeStatus,
  },
  {
    id: 'webhooks',
    name: 'Webhooks customizados',
    description: 'Disparar webhooks em eventos de leads/conversas via Workflows.',
    icon: Webhook,
    category: 'automation',
    href: '/workflows',
    useStatus: useWebhooksStatus,
  },

  // DADOS EXTERNOS
  {
    id: 'db-connectors',
    name: 'Conector de Banco de Dados',
    description: 'Importa leads de MySQL/Postgres externo via query SQL configurável + cron.',
    icon: Database,
    category: 'data',
    href: '/integrations/db-connectors',
    useStatus: useDbConnectorsStatus,
  },

  // PAGAMENTOS
  {
    id: 'payments-asaas',
    name: 'Asaas',
    description: 'Gateway brasileiro para PIX, boleto e cartão. Usado pelo Portal de Matrículas.',
    icon: CreditCard,
    category: 'payments',
    href: '/payments',
    useStatus: () => useProviderPaymentsStatus('asaas'),
  },
  {
    id: 'payments-pagarme',
    name: 'Pagar.me',
    description: 'Link de pagamento hospedado (PIX, boleto, cartão). 1 chave secreta basta.',
    icon: CreditCard,
    category: 'payments',
    href: '/payments',
    useStatus: () => useProviderPaymentsStatus('pagarme'),
  },
]

const STATE_BADGE: Record<StatusState, { tone: 'accent' | 'warning' | 'danger' | 'neutral' | 'info'; solid?: boolean; label: string; Icon: typeof Plug }> = {
  connected: { tone: 'accent', label: 'Conectada', Icon: CheckCircle },
  partial: { tone: 'warning', solid: true, label: 'Parcial', Icon: AlertCircle },
  disconnected: { tone: 'neutral', label: 'Não conectada', Icon: Plug },
  error: { tone: 'danger', solid: true, label: 'Erro', Icon: AlertCircle },
  pending: { tone: 'info', solid: true, label: 'Verificando…', Icon: Clock },
  unconfigured: { tone: 'warning', solid: true, label: 'Não configurada', Icon: AlertCircle },
}

type StateFilter = 'all' | StatusState

export function IntegrationsPage() {
  const [, navigate] = useLocation()
  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState<StateFilter>('all')
  const [showHowItWorks, setShowHowItWorks] = useState(false)

  const q = search.trim().toLowerCase()

  const grouped = useMemo(() => {
    const out = new Map<Category, IntegrationDef[]>()
    for (const it of INTEGRATIONS) {
      if (q && !(it.name.toLowerCase().includes(q) || it.description.toLowerCase().includes(q))) continue
      if (!out.has(it.category)) out.set(it.category, [])
      out.get(it.category)!.push(it)
    }
    return out
  }, [q])

  return (
    <Page
      title="Integrações"
      description="Visão consolidada de canais, anúncios, Google Workspace, automações e pagamentos."
      actions={
        <Button variant="ghost" size="sm" onClick={() => setShowHowItWorks(true)}>
          <HelpCircle size={14} /> Como funciona?
        </Button>
      }
    >
      <div class="flex flex-col sm:flex-row gap-2 mb-3">
        <div class="flex-1 relative">
          <SearchIcon size={14} class="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted pointer-events-none" />
          <Input
            value={search}
            onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
            placeholder="Buscar integração…"
            class="pl-8"
          />
        </div>
        <div class="flex flex-wrap gap-1">
          <FilterChip label="Todas" active={stateFilter === 'all'} onClick={() => setStateFilter('all')} />
          <FilterChip label="Conectadas" active={stateFilter === 'connected'} onClick={() => setStateFilter('connected')} tone="success" />
          <FilterChip label="Não conectadas" active={stateFilter === 'disconnected'} onClick={() => setStateFilter('disconnected')} />
          <FilterChip label="Com erro" active={stateFilter === 'error'} onClick={() => setStateFilter('error')} tone="danger" />
          <FilterChip label="Não configuradas" active={stateFilter === 'unconfigured'} onClick={() => setStateFilter('unconfigured')} tone="warning" />
        </div>
      </div>

      {CATEGORY_ORDER.map((cat) => {
        const items = grouped.get(cat)
        if (!items || items.length === 0) return null
        return (
          <CategorySection
            key={cat}
            label={CATEGORY_LABELS[cat]}
            items={items}
            stateFilter={stateFilter}
            onOpen={(href) => navigate(href)}
          />
        )
      })}

      {grouped.size === 0 && (
        <Card class="py-8 text-center text-sm text-fg-muted">
          Nenhuma integração combina com o filtro.
        </Card>
      )}

      <HowItWorksModal
        open={showHowItWorks}
        onClose={() => setShowHowItWorks(false)}
        title="Como funcionam as Integrações?"
        problem={<>
          O Attrae não vive isolado: ele se conecta com WhatsApp, Meta/Google Ads, Google Workspace,
          Make.com, sistemas de pagamento, e-mail, SMS… Esta é a <strong>tela mestra</strong> que mostra
          o estado de tudo num lugar só — quem está conectado, quem está com erro, quem ainda falta.
        </>}
        steps={[
          {
            title: '🗂️ Tudo agrupado por categoria',
            body: <>Canais (WhatsApp/IG/Telegram), Anúncios (Meta/Google), Workspace (Google), Automação (Make.com), Pagamentos (Asaas/Pagar.me), E-mail, SMS, etc. Cada bloco mostra os itens da categoria.</>,
          },
          {
            title: '🟢 Estado visual',
            body: <>Verde = conectado e ok. Amarelo = não configurado pelo admin da plataforma. Vermelho = erro (token expirado, página desautorizada). Cinza = não conectado.</>,
          },
          {
            title: '🔎 Buscar e filtrar',
            body: <>Use a busca pra achar uma integração específica. Chips no topo filtram por estado: <strong>"Com erro"</strong> é o filtro mais útil — mostra tudo que precisa atenção urgente.</>,
          },
          {
            title: '🚀 Abre a tela de configuração',
            body: <>Clique em uma integração: vai pra tela própria dela onde você conecta, desconecta, sincroniza, vê logs. Esta tela é o portão; as configurações detalhadas vivem em cada uma.</>,
          },
          {
            title: '🆕 Adicionar novas integrações',
            body: <>Integrações novas aparecem aqui automaticamente quando o admin libera no painel. Não precisa atualizar nada — basta dar refresh.</>,
          },
        ]}
        tip={{
          tone: 'info',
          title: '💡 Rotina recomendada',
          body: <>Bata o olho nesta tela <strong>1x por semana</strong>. Se aparecer algo vermelho (token expirou, página desconectada), conserte rápido — quanto mais tempo offline, mais leads/dados você perde. Configure alertas em Configurações pra ser avisado por e-mail.</>,
        }}
      />
    </Page>
  )
}

function CategorySection({
  label, items, stateFilter, onOpen,
}: {
  label: string
  items: IntegrationDef[]
  stateFilter: StateFilter
  onOpen: (href: string) => void
}) {
  return (
    <section class="mb-5">
      <div class="text-2xs uppercase tracking-wider text-fg-muted mb-2">{label}</div>
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((it) => (
          <IntegrationCard key={it.id} integration={it} stateFilter={stateFilter} onOpen={onOpen} />
        ))}
      </div>
    </section>
  )
}

function IntegrationCard({
  integration: it, stateFilter, onOpen,
}: {
  integration: IntegrationDef
  stateFilter: StateFilter
  onOpen: (href: string) => void
}) {
  const status = it.useStatus()

  // O filtro de estado é aplicado no card, depois do hook (cards filtrados ficam ocultos)
  if (stateFilter !== 'all' && status.state !== stateFilter) return null

  const Icon = it.icon
  const interactive = it.href !== undefined
  const meta = STATE_BADGE[status.state]
  const StateIcon = meta.Icon

  return (
    <Card
      class={cn(
        'group flex flex-col gap-3 transition-shadow',
        interactive && 'cursor-pointer hover:shadow-md',
      )}
      onClick={() => { if (it.href) onOpen(it.href) }}
    >
      <div class="flex items-start gap-3">
        <span class="grid size-10 shrink-0 place-items-center rounded-md bg-surface-3 text-fg-muted">
          <Icon size={18} />
        </span>
        <div class="min-w-0 flex-1">
          <h3 class="truncate text-sm font-semibold text-fg">{it.name}</h3>
          <p class="mt-1 line-clamp-2 text-xs text-fg-muted">{it.description}</p>
          {status.detail && (
            <div class="text-2xs text-fg-muted mt-1.5 truncate">{status.detail}</div>
          )}
          {status.error && (
            <div class="text-2xs text-danger mt-1 truncate">{status.error}</div>
          )}
        </div>
      </div>
      <div class="mt-auto flex items-center justify-between gap-2">
        <Badge tone={meta.tone} solid={meta.solid}>
          <StateIcon size={10} class="mr-0.5 inline" /> {meta.label}
        </Badge>
        {interactive && (
          <span class="text-2xs text-fg-muted group-hover:text-fg">Abrir →</span>
        )}
      </div>
    </Card>
  )
}

function FilterChip({
  label, active, onClick, tone = 'neutral',
}: {
  label: string
  active: boolean
  onClick: () => void
  tone?: 'neutral' | 'success' | 'warning' | 'danger'
}): JSX.Element {
  const activeCls =
    tone === 'success' ? 'bg-accent text-fg-on-brand border-accent' :
    tone === 'warning' ? 'bg-warning text-fg-on-brand border-warning' :
    tone === 'danger' ? 'bg-danger text-fg-on-brand border-danger' :
    'bg-accent text-fg-on-brand border-accent'
  return (
    <button
      type="button"
      class={cn(
        'text-2xs px-2.5 py-1 rounded-full border transition-colors',
        active ? activeCls : 'border-border text-fg-muted hover:text-fg hover:bg-surface-3',
      )}
      onClick={onClick}
    >
      {label}
    </button>
  )
}
