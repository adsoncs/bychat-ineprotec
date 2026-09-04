import { useEffect, useState, useRef } from 'preact/hooks'
import {
  FileSpreadsheet, CalendarRange, HardDrive, ListChecks, Mail,
  Plug, Plus, Pencil, Trash2, RefreshCw, Send, AlertTriangle, Check,
  Folder, Upload, ExternalLink, FileText as FileIcon, X as XIcon,
  BarChart3, LineChart as LineChartIcon, Copy, ScrollText, CheckCircle2, XCircle,
  Sparkles, HelpCircle,
} from '@/components/ui/icon-set'
import { HowItWorksModal } from '@/components/ui/HowItWorksModal'
import {
  useGoogleConfig, useUpdateGoogleConfig, useResetGoogleCredentials,
  useGoogleAuthUrl, useGoogleConnections, useDeleteGoogleConnection,
  useGoogleSpreadsheets, useSheetTabs, useCreateSpreadsheet,
  useGoogleCalendars, useGoogleTaskLists,
  useSheetIntegrations, useCreateSheetIntegration, useUpdateSheetIntegration,
  useDeleteSheetIntegration, useTestSheetIntegration, useSetupSheetHeaders,
  useSheetEvents, useSheetFields, useSheetLogs,
  useCalendarIntegrations, useCreateCalendarIntegration, useUpdateCalendarIntegration, useDeleteCalendarIntegration,
  useDriveConfig, useCreateDriveConfig, useUpdateDriveConfig, useDeleteDriveConfig,
  useDriveLeadFolder, useDriveFiles, useUploadToDrive,
  useTasksConfigs, useCreateTasksConfig, useUpdateTasksConfig, useDeleteTasksConfig,
  useGmailConfigs, useCreateGmailConfig, useUpdateGmailConfig, useDeleteGmailConfig,
  useGmailProfile, useSendGmail, useGmailWatch, useGmailUnwatch, useGmailSyncNow,
  useGa4Configs, useCreateGa4Config, useDeleteGa4Config, useTestGa4Config,
  GOOGLE_ACTIVITY_TYPES,
  type GoogleSheetIntegration, type GoogleCalendarIntegration,
  type GoogleTasksConfig, type GmailConfig,
  type GoogleConnection, type SheetFieldMapping, type DriveFile,
  type Ga4Config,
} from '@/hooks/useGoogle'
import { useLeads } from '@/hooks/useLeads'
import { useAuth } from '@/hooks/useAuth'
import { Page } from '@/components/ui/Page'
import { GoogleAccountSettings } from './settings/GoogleAccountSettings'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/cn'

type Tab = 'account' | 'sheets' | 'calendar' | 'drive' | 'tasks' | 'gmail' | 'ga4' | 'looker'

const TABS: { id: Tab; label: string; icon: typeof FileSpreadsheet }[] = [
  { id: 'account', label: 'Minha conta', icon: Sparkles },
  { id: 'sheets', label: 'Sheets', icon: FileSpreadsheet },
  { id: 'calendar', label: 'Calendar', icon: CalendarRange },
  { id: 'drive', label: 'Drive', icon: HardDrive },
  { id: 'tasks', label: 'Tasks', icon: ListChecks },
  { id: 'gmail', label: 'Gmail', icon: Mail },
  { id: 'ga4', label: 'GA4', icon: BarChart3 },
  { id: 'looker', label: 'Looker Studio', icon: LineChartIcon },
]

/**
 * Aba pedida na URL (`?tab=gmail`), com queda para Sheets.
 *
 * Existe porque os alertas de integração Google apontam para cá: sem isto, o
 * aviso de "Gmail parou de receber" abria a tela em Sheets e a pessoa tinha de
 * adivinhar onde clicar.
 */
function abaDaUrl(): Tab {
  if (typeof window === 'undefined') return 'sheets'
  const v = new URLSearchParams(window.location.search).get('tab')
  return TABS.some((t) => t.id === v) ? (v as Tab) : 'sheets'
}

export function GoogleSuitePage() {
  const { user } = useAuth()
  const [tab, setTab] = useState<Tab>(abaDaUrl)
  const [showHowItWorks, setShowHowItWorks] = useState(false)

  if (user?.role !== 'SUPERADMIN' && user?.role !== 'ADMIN') {
    return (
      <Page title="Google Suite">
        <EmptyState title="Acesso restrito" description="Apenas administradores podem gerenciar integrações Google." />
      </Page>
    )
  }

  return (
    <Page
      title="Google Suite"
      description="Sheets, Calendar, Drive, Tasks e Gmail. Uma conexão Google compartilhada por todas as integrações."
      actions={
        <Button variant="ghost" size="sm" onClick={() => setShowHowItWorks(true)}>
          <HelpCircle size={14} /> Como funciona?
        </Button>
      }
    >
      <CredentialsCard />
      <ConnectionsCard />

      <div class="flex gap-1 border-b border-border overflow-x-auto">
        {TABS.map((t) => {
          const Icon = t.icon
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              class={cn(
                'inline-flex items-center gap-1.5 px-3 h-9 -mb-px border-b-2 text-sm font-medium whitespace-nowrap transition-colors',
                tab === t.id ? 'border-accent text-accent bg-accent/5' : 'border-transparent text-fg-muted hover:text-fg',
              )}
            >
              <Icon size={14} /> {t.label}
            </button>
          )
        })}
      </div>

      {tab === 'account' && <GoogleAccountSettings />}
      {tab === 'sheets' && <SheetsTab />}
      {tab === 'calendar' && <CalendarTab />}
      {tab === 'drive' && <DriveTab />}
      {tab === 'tasks' && <TasksTab />}
      {tab === 'gmail' && <GmailTab />}
      {tab === 'ga4' && <Ga4Tab />}
      {tab === 'looker' && <LookerTab />}

      <HowItWorksModal
        open={showHowItWorks}
        onClose={() => setShowHowItWorks(false)}
        title="Como funciona o Google Suite?"
        problem={<>
          O Google Workspace é onde sua empresa já trabalha: planilhas, calendário, e-mail, arquivos.
          Em vez de copiar dados manualmente entre o CRM e o Google, esta integração <strong>conecta uma vez
          e o resto rola sozinho</strong>: lead vai pra planilha, reunião vira evento no Calendar,
          documento sobe pro Drive, e-mail sai pelo Gmail do operador.
        </>}
        steps={[
          {
            title: '🔑 Configurar credencial (admin, uma vez)',
            body: <>Em <strong>Configurações OAuth</strong>: cole Client ID + Client Secret do projeto Google Cloud da sua empresa. É a base — sem isso, ninguém conecta nada.</>,
          },
          {
            title: '🔌 Conexões por operador ou empresa',
            body: <>Cada operador conecta a própria conta Google (pra Calendar/Tasks/Gmail). Drive/Sheets podem ser uma conta da empresa compartilhada (modelo híbrido). Aba <strong>Minha conta</strong>: você gerencia a sua.</>,
          },
          {
            title: '📊 Sheets — leads viram linha',
            body: <>Configure uma planilha de destino. Quando lead criado/atualizado, o sistema cria/atualiza linha automaticamente. Mapeie quais campos vão pra quais colunas.</>,
          },
          {
            title: '📅 Calendar / ✅ Tasks',
            body: <>Atividades agendadas no Attrae viram eventos no Calendar do operador. Tarefas viram items no Google Tasks. Conexão por operador — cada um vê só o seu calendário.</>,
          },
          {
            title: '💾 Drive / 📧 Gmail / 📈 GA4 / 📺 Looker',
            body: <>Drive: arquivos do lead sobem pra pasta dedicada. Gmail: dispara e-mail pelo Gmail do operador (e o cliente vê o e-mail real do vendedor). GA4: traz dados de tracking. Looker: links pros dashboards prontos.</>,
          },
        ]}
        tip={{
          tone: 'info',
          title: '💡 Modelo híbrido recomendado',
          body: <>Calendar / Tasks / Gmail: <strong>conta de cada operador</strong> (porque é trabalho dele). Sheets / Drive: <strong>conta única da empresa</strong> (pra ninguém perder acesso quando vendedor sair). Configure em cada aba qual conta usar.</>,
        }}
      />
    </Page>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// GA4 (Measurement Protocol)

function Ga4Tab() {
  const { data, isLoading } = useGa4Configs()
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<Ga4Config | null>(null)
  const [testing, setTesting] = useState<number | null>(null)
  const del = useDeleteGa4Config()
  const test = useTestGa4Config()

  function handleTest(id: number) {
    setTesting(id)
    test.mutate(id, {
      onSuccess: (r) => {
        setTesting(null)
        const ok = r.success && (!r.validationMessages || (Array.isArray(r.validationMessages) && r.validationMessages.length === 0))
        toast(ok ? 'Teste OK! Evento enviado ao GA4.' : `Teste retornou: ${JSON.stringify(r.validationMessages ?? r)}`, ok ? 'success' : 'warning')
      },
      onError: (e: unknown) => { setTesting(null); toast((e as Error).message, 'danger') },
    })
  }

  return (
    <div class="space-y-3 mt-4">
      <Card class="bg-info/10 border border-info/30">
        <div class="text-xs text-info leading-relaxed">
          <strong>Como funciona:</strong> eventos do CRM (lead criado, mudança de etapa, venda…) são enviados
          ao GA4 via <em>Measurement Protocol</em> — sem OAuth. Basta cadastrar o <strong>Measurement ID</strong> e
          o <strong>API Secret</strong> obtidos em <em>GA4 → Admin → Data Streams → Measurement Protocol API
          secrets</em>.
        </div>
      </Card>

      <div class="flex justify-end">
        <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
          <Plus size={14} /> Novo GA4
        </Button>
      </div>

      {isLoading && <Skeleton class="h-20 w-full" />}

      {!isLoading && (data?.data ?? []).length === 0 && (
        <EmptyState title="Sem GA4 configurado" description="Adicione um Measurement ID + API Secret para começar." />
      )}

      {(data?.data ?? []).map((c) => (
        <Card key={c.id}>
          <div class="flex items-center gap-3 flex-wrap">
            <span class={`size-2.5 rounded-full ${c.active ? 'bg-accent' : 'bg-danger'}`} />
            <div class="min-w-0 flex-1">
              <div class="font-mono text-sm text-fg">{c.measurementId}</div>
              <div class="text-2xs text-fg-muted">
                Enviados: <span class="text-fg tabular-nums">{c.totalSent}</span> ·{' '}
                Falhas: <span class={c.totalFailed > 0 ? 'text-danger tabular-nums' : 'text-fg-muted tabular-nums'}>{c.totalFailed}</span>
                {c.lastSentAt && <> · Último: {new Date(c.lastSentAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</>}
              </div>
            </div>
            <Button size="sm" variant="secondary" onClick={() => handleTest(c.id)} disabled={testing === c.id}>
              <Send size={12} /> {testing === c.id ? 'Testando…' : 'Testar'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDeleting(c)}>
              <Trash2 size={12} />
            </Button>
          </div>
        </Card>
      ))}

      {creating && <Ga4FormModal onClose={() => setCreating(false)} />}
      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(o) => { if (!o) setDeleting(null) }}
          title={`Remover GA4 "${deleting.measurementId}"?`}
          description="Eventos pararão de ser enviados ao GA4 para este Measurement ID."
          destructive
          confirmLabel="Remover"
          loading={del.isPending}
          onConfirm={() => del.mutate(deleting.id, {
            onSuccess: () => { toast('GA4 removido', 'success'); setDeleting(null) },
            onError: (e: unknown) => toast((e as Error).message, 'danger'),
          })}
        />
      )}
    </div>
  )
}

function Ga4FormModal({ onClose }: { onClose: () => void }) {
  const [measurementId, setMeasurementId] = useState('')
  const [apiSecret, setApiSecret] = useState('')
  const create = useCreateGa4Config()

  function submit() {
    const mid = measurementId.trim()
    const sec = apiSecret.trim()
    if (!mid || !sec) { toast('Preencha Measurement ID e API Secret', 'danger'); return }
    create.mutate({ measurementId: mid, apiSecret: sec }, {
      onSuccess: () => { toast('GA4 configurado!', 'success'); onClose() },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Configurar GA4"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={create.isPending}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={submit} disabled={create.isPending}>
            {create.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </>
      }
    >
      <div class="space-y-3">
        <Input
          label="Measurement ID"
          value={measurementId}
          onInput={(e) => setMeasurementId((e.target as HTMLInputElement).value)}
          placeholder="G-XXXXXXXXXX"
          hint="Encontrado em GA4 → Admin → Data Streams"
        />
        <Input
          label="API Secret"
          value={apiSecret}
          onInput={(e) => setApiSecret((e.target as HTMLInputElement).value)}
          placeholder="abc123…"
          hint="Em GA4 → Admin → Data Streams → Measurement Protocol API secrets → Criar"
        />
      </div>
    </Modal>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Looker Studio

function LookerTab() {
  const baseUrl = window.location.origin
  const endpoints = [
    { path: '/api/v1/looker/leads', name: 'Leads', desc: 'Todos os leads com campos, etapa, origem e vendas.', perm: 'leads:read' },
    { path: '/api/v1/looker/sales', name: 'Vendas', desc: 'Leads com venda detectada — valor, produto, confiança, GCLID.', perm: 'leads:read' },
    { path: '/api/v1/looker/funnel', name: 'Funil', desc: 'Etapas dos funis com contagem de leads e vendas.', perm: 'funnels:read' },
    { path: '/api/v1/looker/activities', name: 'Atividades', desc: 'Atividades por tipo, status, operador e lead.', perm: 'activities:read' },
  ]

  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  function copyUrl(idx: number, url: string) {
    void navigator.clipboard.writeText(url).then(() => {
      setCopiedIdx(idx)
      setTimeout(() => setCopiedIdx(null), 1800)
    })
  }

  return (
    <div class="space-y-3 mt-4 max-w-3xl">
      <Card class="bg-info/10 border border-info/30">
        <div class="text-xs text-info leading-relaxed">
          Use os endpoints abaixo como fonte de dados no <strong>Looker Studio</strong> (Google Data Studio).
          Autentique com uma <strong>API Key</strong> da seção <em>API Keys</em>. Os dados são retornados em
          formato tabular (schema + rows).
        </div>
      </Card>

      <div class="text-xs uppercase tracking-wider text-fg-muted font-medium">Endpoints disponíveis</div>

      {endpoints.map((ep, idx) => {
        const url = `${baseUrl}${ep.path}?days=90`
        return (
          <Card key={ep.path}>
            <div class="flex items-center gap-2 mb-1">
              <strong class="text-fg">{ep.name}</strong>
              <Badge tone="info">{ep.perm}</Badge>
            </div>
            <p class="text-xs text-fg-muted mb-2">{ep.desc}</p>
            <div class="flex items-center gap-2">
              <code class="flex-1 text-2xs bg-surface-2 border border-border rounded px-2 py-1.5 truncate">{url}</code>
              <Button size="sm" variant="secondary" onClick={() => copyUrl(idx, url)}>
                <Copy size={12} /> {copiedIdx === idx ? 'Copiado!' : 'Copiar'}
              </Button>
            </div>
          </Card>
        )
      })}

      <Card class="bg-warning/10 border border-warning/30">
        <div class="text-xs text-warning leading-relaxed">
          <strong>Como usar no Looker Studio:</strong>
          <ol class="mt-1.5 ml-4 list-decimal space-y-0.5">
            <li>Crie uma API Key em <strong>Configurações → API Keys</strong> com permissão de leitura</li>
            <li>No Looker Studio, adicione fonte de dados tipo <em>JSON/CSV by URL</em></li>
            <li>Cole a URL do endpoint + header <code class="text-2xs">X-API-Key: byc_sua_chave</code></li>
            <li>O parâmetro <code class="text-2xs">?days=90</code> controla o período (padrão 90 dias)</li>
          </ol>
        </div>
      </Card>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Credentials Card

function CredentialsCard() {
  const { data, isLoading } = useGoogleConfig()
  const [editing, setEditing] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const reset = useResetGoogleCredentials()

  if (isLoading) return <Card><Skeleton class="h-20 w-full" /></Card>
  if (!data) return null

  return (
    <Card>
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span class="text-sm font-semibold text-fg">Credenciais OAuth</span>
            {data.configured ? (
              <Badge tone="accent">Configurado</Badge>
            ) : (
              <Badge tone="warning" solid>Falta configurar</Badge>
            )}
          </div>
          <div class="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs text-fg-muted">
            <div><span class="text-fg-muted">Client ID:</span> <span class="font-mono text-fg">{data.clientId || '—'}</span></div>
            <div><span class="text-fg-muted">Client Secret:</span> {data.hasSecret ? <span class="text-fg">••••••</span> : <span>—</span>}</div>
            <div class="sm:col-span-2 truncate"><span class="text-fg-muted">Redirect URI:</span> <span class="font-mono text-fg">{data.redirectUri || '—'}</span></div>
          </div>
        </div>
        <div class="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
            <Pencil size={12} /> Editar
          </Button>
          {data.configured && (
            <Button variant="secondary" size="sm" onClick={() => setConfirmReset(true)}>
              Resetar tudo
            </Button>
          )}
        </div>
      </div>

      {editing && <CredentialsModal status={data} onClose={() => setEditing(false)} />}
      {confirmReset && (
        <ConfirmDialog
          open
          onOpenChange={(o) => { if (!o) setConfirmReset(false) }}
          title="Resetar credenciais e dados"
          description="Remove credenciais, conexões, integrações de Sheets/Calendar/Drive/Tasks/Gmail/Ads/GA4. Não pode ser desfeito."
          destructive
          confirmLabel="Resetar tudo"
          loading={reset.isPending}
          onConfirm={() => reset.mutate(undefined, {
            onSuccess: () => { toast('Credenciais e integrações apagadas', 'success'); setConfirmReset(false) },
            onError: (e: unknown) => toast((e as Error).message, 'danger'),
          })}
        />
      )}
    </Card>
  )
}

function CredentialsModal({ status, onClose }: { status: { redirectUri: string }; onClose: () => void }) {
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [redirectUri, setRedirectUri] = useState(status.redirectUri)
  const update = useUpdateGoogleConfig()

  function handleSubmit() {
    const payload: Record<string, string> = {}
    if (clientId.trim()) payload.clientId = clientId.trim()
    if (clientSecret.trim()) payload.clientSecret = clientSecret.trim()
    if (redirectUri.trim() !== status.redirectUri) payload.redirectUri = redirectUri.trim()
    if (Object.keys(payload).length === 0) { toast('Nenhuma alteração', 'info'); return }

    update.mutate(payload, {
      onSuccess: () => { toast('Credenciais atualizadas', 'success'); onClose() },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Credenciais OAuth do Google"
      size="lg"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={update.isPending}>
            {update.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </>
      }
    >
      <div class="space-y-3">
        <div class="rounded-md border border-info/30 bg-info/10 p-3 text-xs text-info">
          Crie um projeto em <strong>console.cloud.google.com</strong> → APIs & Services → OAuth consent screen.
          Em Credentials, gere um OAuth 2.0 Client ID do tipo "Web application" e adicione o Redirect URI abaixo.
        </div>
        <Input
          label="Client ID"
          value={clientId}
          onInput={(e) => setClientId((e.target as HTMLInputElement).value)}
          placeholder="123456789-abc.apps.googleusercontent.com"
        />
        <Input
          label="Client Secret"
          type="password"
          value={clientSecret}
          onInput={(e) => setClientSecret((e.target as HTMLInputElement).value)}
          placeholder="Deixe vazio para manter atual"
        />
        <Input
          label="Redirect URI"
          value={redirectUri}
          onInput={(e) => setRedirectUri((e.target as HTMLInputElement).value)}
          hint="Auto-preenchido a partir de APP_URL. Use tal qual no Google Cloud Console."
        />
      </div>
    </Modal>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Connections Card (OAuth flow via popup)

function ConnectionsCard() {
  const { data, isLoading } = useGoogleConnections()
  const auth = useGoogleAuthUrl()
  const del = useDeleteGoogleConnection()
  const [deleting, setDeleting] = useState<GoogleConnection | null>(null)

  function handleConnect() {
    auth.mutate(undefined, {
      onSuccess: ({ url }) => openOAuthPopup(url),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  const connections = data?.data ?? []
  const company = connections.filter((c) => c.kind === 'COMPANY' || !c.kind)
  const operators = connections.filter((c) => c.kind === 'OPERATOR')

  function renderRow(c: GoogleConnection) {
    return (
      <li key={c.id} class="flex items-center gap-3 py-2 text-sm">
        <Mail size={14} class="text-fg-muted" />
        <span class="text-fg flex-1 truncate">{c.email}</span>
        {c.active ? <Badge tone="accent">Ativa</Badge> : <Badge tone="neutral">Inativa</Badge>}
        <button
          type="button"
          class="size-7 rounded grid place-items-center text-fg-muted hover:text-danger hover:bg-surface-3"
          onClick={() => setDeleting(c)}
          aria-label="Desconectar"
        >
          <Trash2 size={14} />
        </button>
      </li>
    )
  }

  return (
    <Card>
      <div class="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div>
          <div class="text-sm font-semibold text-fg">Conexão da empresa</div>
          <div class="text-xs text-fg-muted mt-0.5">
            Conta usada para Drive (pasta "Attrae CRM"), planilhas centrais e como fallback de operadores sem Google conectado.
          </div>
        </div>
        <Button variant="primary" size="sm" onClick={handleConnect} disabled={auth.isPending}>
          <Plug size={14} /> {auth.isPending ? 'Abrindo…' : 'Conectar conta da empresa'}
        </Button>
      </div>
      {isLoading ? (
        <Skeleton class="h-12 w-full" />
      ) : company.length === 0 ? (
        <EmptyState description="Nenhuma conta da empresa conectada ainda." />
      ) : (
        <ul class="divide-y divide-border">{company.map(renderRow)}</ul>
      )}

      <div class="border-t border-border my-4" />

      <div class="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <div class="text-sm font-semibold text-fg">Conexões dos operadores</div>
          <div class="text-xs text-fg-muted mt-0.5">
            Cada operador conecta a própria conta em <span class="font-mono">Configurações → Minha conta Google</span>. Calendar, Tasks e Gmail roteiam para a conta dele.
          </div>
        </div>
      </div>
      {isLoading ? (
        <Skeleton class="h-8 w-full" />
      ) : operators.length === 0 ? (
        <EmptyState description="Nenhum operador conectou a própria conta ainda." />
      ) : (
        <ul class="divide-y divide-border">{operators.map(renderRow)}</ul>
      )}
      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(o) => { if (!o) setDeleting(null) }}
          title={`Desconectar ${deleting.email}`}
          description="Integrações que usam esta conta param de funcionar. Você pode reconectar a qualquer momento."
          destructive
          confirmLabel="Desconectar"
          loading={del.isPending}
          onConfirm={() => del.mutate(deleting.id, {
            onSuccess: () => { toast('Conta desconectada', 'success'); setDeleting(null) },
            onError: (e: unknown) => toast((e as Error).message, 'danger'),
          })}
        />
      )}
    </Card>
  )
}

function openOAuthPopup(url: string) {
  const popup = window.open(url, 'google-oauth', 'width=600,height=700')
  if (!popup) { toast('Pop-up bloqueado pelo navegador', 'danger'); return }

  function handler(ev: MessageEvent) {
    if (!ev.data || typeof ev.data !== 'object') return
    const d = ev.data as { type?: string; email?: string; error?: string }
    if (d.type === 'google-auth-success') {
      toast(`${d.email} conectado`, 'success')
      window.removeEventListener('message', handler)
    } else if (d.type === 'google-auth-error') {
      toast(`Erro OAuth: ${d.error ?? 'desconhecido'}`, 'danger')
      window.removeEventListener('message', handler)
    }
  }
  window.addEventListener('message', handler)
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers comuns

function ConnectionSelect({
  value, onChange, label = 'Conta Google', required = false,
}: {
  value: number | ''
  onChange: (v: number | '') => void
  label?: string
  required?: boolean
}) {
  const { data } = useGoogleConnections()
  const connections = data?.data ?? []
  return (
    <Select
      label={label + (required ? ' *' : '')}
      value={value === '' ? '' : String(value)}
      onChange={(e) => {
        const v = (e.target as HTMLSelectElement).value
        onChange(v ? Number(v) : '')
      }}
    >
      <option value="">Selecione…</option>
      {connections.filter((c) => c.active).map((c) => (
        <option key={c.id} value={c.id}>{c.email}</option>
      ))}
    </Select>
  )
}

function ActivityTypesPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  function toggle(t: string) {
    onChange(value.includes(t) ? value.filter((x) => x !== t) : [...value, t])
  }
  return (
    <div>
      <span class="text-xs font-medium text-fg-muted">Tipos de atividade que sincronizam</span>
      <div class="mt-1 flex flex-wrap gap-2">
        {GOOGLE_ACTIVITY_TYPES.map((t) => {
          const active = value.includes(t.value)
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => toggle(t.value)}
              class={cn(
                'h-7 px-3 rounded-full border text-xs font-medium transition-colors',
                active
                  ? 'bg-accent text-fg-on-brand border-accent'
                  : 'bg-surface text-fg-muted border-border hover:text-fg',
              )}
            >
              {t.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Sheets Tab

function SheetsTab() {
  const { data, isLoading } = useSheetIntegrations()
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<GoogleSheetIntegration | null>(null)
  const [deleting, setDeleting] = useState<GoogleSheetIntegration | null>(null)
  const [viewingLogs, setViewingLogs] = useState<GoogleSheetIntegration | null>(null)

  const integrations = data?.data ?? []
  const test = useTestSheetIntegration()
  const setup = useSetupSheetHeaders()
  const update = useUpdateSheetIntegration()
  const del = useDeleteSheetIntegration()

  function handleTest(i: GoogleSheetIntegration) {
    test.mutate(i.id, {
      onSuccess: (r) => toast(r.message ?? (r.ok ? 'Teste OK' : 'Falhou'), r.ok ? 'success' : 'danger'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function handleHeaders(i: GoogleSheetIntegration) {
    setup.mutate(i.id, {
      onSuccess: () => toast('Cabeçalhos escritos no Sheet', 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function toggleActive(i: GoogleSheetIntegration) {
    update.mutate({ id: i.id, active: !i.active }, {
      onSuccess: () => toast(i.active ? 'Pausada' : 'Ativada', 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <Card class="p-0 overflow-hidden">
      <div class="p-4 border-b border-border flex items-center justify-between">
        <div>
          <div class="text-sm font-semibold text-fg">Integrações Sheets</div>
          <div class="text-xs text-fg-muted mt-0.5">Eventos do CRM gravam em planilhas em tempo real.</div>
        </div>
        <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
          <Plus size={14} /> Nova integração
        </Button>
      </div>
      {isLoading && <div class="p-4"><Skeleton class="h-20 w-full" /></div>}
      {!isLoading && integrations.length === 0 && (
        <div class="p-8"><EmptyState icon={<FileSpreadsheet size={24} />} title="Sem integrações" description="Crie uma para começar a gravar eventos no Sheets." /></div>
      )}
      {!isLoading && integrations.length > 0 && (
        <ul class="divide-y divide-border">
          {integrations.map((i) => (
            <li key={i.id} class="p-4 flex flex-wrap items-center gap-3">
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-sm font-medium text-fg truncate">{i.name}</span>
                  <Badge tone={i.active ? 'accent' : 'neutral'}>{i.active ? 'Ativa' : 'Pausada'}</Badge>
                </div>
                <div class="text-xs text-fg-muted mt-0.5 truncate">
                  {i.spreadsheetName} · aba {i.sheetName} · {i.events.length} evento(s) · {i.fieldMapping.length} campo(s)
                </div>
                <div class="text-2xs text-fg-muted mt-0.5">
                  {i.totalSynced} sincronizada(s) · {i.totalFailed} falha(s) {i.connection?.email ? `· ${i.connection.email}` : ''}
                </div>
              </div>
              <div class="flex gap-1">
                <Button variant="secondary" size="sm" onClick={() => handleTest(i)} disabled={test.isPending}>
                  <RefreshCw size={12} /> Testar
                </Button>
                <Button variant="secondary" size="sm" onClick={() => handleHeaders(i)} disabled={setup.isPending}>
                  Cabeçalhos
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setViewingLogs(i)}>
                  <ScrollText size={12} /> Logs
                </Button>
                <Button variant="secondary" size="sm" onClick={() => toggleActive(i)}>
                  {i.active ? 'Pausar' : 'Ativar'}
                </Button>
                <button type="button" class="size-8 rounded-md grid place-items-center text-fg-muted hover:text-fg hover:bg-surface-3" onClick={() => setEditing(i)} aria-label="Editar"><Pencil size={12} /></button>
                <button type="button" class="size-8 rounded-md grid place-items-center text-fg-muted hover:text-danger hover:bg-surface-3" onClick={() => setDeleting(i)} aria-label="Excluir"><Trash2 size={12} /></button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {(creating || editing) && (
        <SheetIntegrationModal
          integration={editing}
          onClose={() => { setCreating(false); setEditing(null) }}
        />
      )}
      {viewingLogs && (
        <SheetLogsModal
          integration={viewingLogs}
          onClose={() => setViewingLogs(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(o) => { if (!o) setDeleting(null) }}
          title={`Excluir "${deleting.name}"`}
          description="A integração para de gravar dados no Sheets. A planilha em si não é apagada."
          destructive
          confirmLabel="Excluir"
          loading={del.isPending}
          onConfirm={() => del.mutate(deleting.id, {
            onSuccess: () => { toast('Integração excluída', 'success'); setDeleting(null) },
            onError: (e: unknown) => toast((e as Error).message, 'danger'),
          })}
        />
      )}
    </Card>
  )
}

function SheetLogsModal({ integration, onClose }: { integration: GoogleSheetIntegration; onClose: () => void }) {
  const { data, isLoading, refetch, isFetching } = useSheetLogs(integration.id, 100)
  const logs = data?.data ?? []

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Logs — ${integration.name}`}
      description={`Últimos ${logs.length} de ${data?.total ?? 0} envios`}
      size="xl"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw size={12} class={isFetching ? 'animate-spin' : ''} /> Recarregar
          </Button>
          <Button variant="primary" size="sm" onClick={onClose}>Fechar</Button>
        </>
      }
    >
      {isLoading && <Skeleton class="h-48 w-full" />}
      {!isLoading && logs.length === 0 && (
        <EmptyState icon={<ScrollText size={20} />} title="Nenhum log" description="Esta integração ainda não enviou linhas." />
      )}
      {!isLoading && logs.length > 0 && (
        <div class="overflow-x-auto">
          <table class="w-full text-xs">
            <thead class="bg-surface-3 text-fg-muted text-3xs uppercase tracking-wider">
              <tr>
                <th class="text-left px-3 py-2 font-medium">Evento</th>
                <th class="text-left px-3 py-2 font-medium">Status</th>
                <th class="text-right px-3 py-2 font-medium">Duração</th>
                <th class="text-left px-3 py-2 font-medium">Quando</th>
                <th class="text-left px-3 py-2 font-medium">Erro</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-border">
              {logs.map((l) => (
                <tr key={l.id} class="hover:bg-surface-3">
                  <td class="px-3 py-1.5">
                    <code class="font-mono text-2xs bg-surface-3 px-1.5 py-0.5 rounded">{l.event}</code>
                  </td>
                  <td class="px-3 py-1.5">
                    {l.success ? (
                      <span class="inline-flex items-center gap-1 text-success">
                        <CheckCircle2 size={11} /> OK
                      </span>
                    ) : (
                      <span class="inline-flex items-center gap-1 text-danger">
                        <XCircle size={11} /> Falha
                      </span>
                    )}
                  </td>
                  <td class="px-3 py-1.5 text-right tabular-nums text-fg-muted">
                    {l.duration ? `${l.duration} ms` : '—'}
                  </td>
                  <td class="px-3 py-1.5 text-fg-muted whitespace-nowrap">
                    {new Date(l.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' })}
                  </td>
                  <td class="px-3 py-1.5 text-danger truncate max-w-[18rem]" title={l.error ?? ''}>
                    {l.error ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  )
}

type SheetTab = 'general' | 'events' | 'mapping'

const DEFAULT_FIELD_MAPPING: SheetFieldMapping[] = [
  { header: 'Nome', source: 'lead.nome' },
  { header: 'Empresa', source: 'lead.empresa' },
  { header: 'WhatsApp', source: 'lead.whatsapp' },
  { header: 'Email', source: 'lead.email' },
  { header: 'Etapa', source: 'lead.status' },
  { header: 'Evento', source: 'event.type' },
]

function SheetIntegrationModal({ integration, onClose }: { integration: GoogleSheetIntegration | null; onClose: () => void }) {
  const isEdit = !!integration
  const [tab, setTab] = useState<SheetTab>('general')
  const [name, setName] = useState(integration?.name ?? '')
  const [connectionId, setConnectionId] = useState<number | ''>(integration?.connectionId ?? '')
  const [spreadsheetId, setSpreadsheetId] = useState(integration?.spreadsheetId ?? '')
  const [spreadsheetName, setSpreadsheetName] = useState(integration?.spreadsheetName ?? '')
  const [sheetName, setSheetName] = useState(integration?.sheetName ?? 'Sheet1')
  const [includeTimestamp, setIncludeTimestamp] = useState(integration?.includeTimestamp ?? true)
  const [events, setEvents] = useState<string[]>(integration?.events ?? ['*'])
  const [fieldMapping, setFieldMapping] = useState<SheetFieldMapping[]>(integration?.fieldMapping ?? DEFAULT_FIELD_MAPPING)

  const sheetsQ = useGoogleSpreadsheets(typeof connectionId === 'number' && !isEdit ? connectionId : null)
  const tabsQ = useSheetTabs(
    typeof connectionId === 'number' && !isEdit ? connectionId : null,
    !isEdit && spreadsheetId ? spreadsheetId : null,
  )
  const createSpreadsheet = useCreateSpreadsheet()
  const create = useCreateSheetIntegration()
  const update = useUpdateSheetIntegration()
  const loading = create.isPending || update.isPending
  const [showCreateSheet, setShowCreateSheet] = useState(false)
  const [newSheetTitle, setNewSheetTitle] = useState('')

  function pickSpreadsheet(id: string) {
    const sheet = sheetsQ.data?.data.find((s) => s.id === id)
    setSpreadsheetId(id)
    if (sheet) setSpreadsheetName(sheet.name)
    // Quando troca de planilha, deixa o sheetName para o useEffect ajustar
    setSheetName('')
  }

  // Auto-seleciona primeira aba quando carrega a lista de abas
  useEffect(() => {
    if (isEdit) return
    const tabs = tabsQ.data?.data
    if (!tabs || tabs.length === 0) return
    if (sheetName && tabs.some((t) => t.title === sheetName)) return
    const first = tabs[0]
    if (first) setSheetName(first.title)
  }, [tabsQ.data?.data, isEdit, sheetName])

  function handleCreateSpreadsheet() {
    if (!connectionId) { toast('Selecione uma conta Google primeiro', 'danger'); return }
    const title = newSheetTitle.trim()
    if (!title) { toast('Informe o nome da planilha', 'danger'); return }
    createSpreadsheet.mutate({ connectionId: Number(connectionId), title }, {
      onSuccess: (r) => {
        const sp = r.data
        toast(`Planilha "${sp.name}" criada`, 'success')
        setSpreadsheetId(sp.id)
        setSpreadsheetName(sp.name)
        setSheetName('')
        setNewSheetTitle('')
        setShowCreateSheet(false)
        // Refetch da lista para incluir a nova planilha no dropdown
        void sheetsQ.refetch()
      },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function handleSubmit() {
    if (!name.trim()) { toast('Nome é obrigatório', 'danger'); return }
    if (!connectionId) { toast('Selecione uma conta Google', 'danger'); return }
    if (!spreadsheetId.trim() || !spreadsheetName.trim()) { toast('Planilha é obrigatória', 'danger'); return }
    if (events.length === 0) { toast('Selecione ao menos um evento', 'danger'); return }
    if (fieldMapping.length === 0) { toast('Adicione ao menos uma coluna', 'danger'); return }
    if (fieldMapping.some((m) => !m.header.trim() || !m.source.trim())) {
      toast('Todas as colunas precisam de cabeçalho e source', 'danger'); return
    }

    if (isEdit && integration) {
      update.mutate({ id: integration.id, name: name.trim(), sheetName, includeTimestamp, events, fieldMapping }, {
        onSuccess: () => { toast('Integração atualizada', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    } else {
      create.mutate({
        name: name.trim(),
        connectionId: Number(connectionId),
        spreadsheetId: spreadsheetId.trim(),
        spreadsheetName: spreadsheetName.trim(),
        sheetName: sheetName.trim() || 'Sheet1',
        includeTimestamp,
        events,
        fieldMapping,
      }, {
        onSuccess: () => { toast('Integração criada', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    }
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={isEdit ? `Editar "${integration.name}"` : 'Nova integração Sheets'}
      size="xl"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={loading}>
            {loading ? 'Salvando…' : 'Salvar'}
          </Button>
        </>
      }
    >
      <nav class="flex gap-1 mb-4 border-b border-border">
        {[
          { id: 'general' as SheetTab, label: 'Geral' },
          { id: 'events' as SheetTab, label: `Eventos (${events.includes('*') ? 'todos' : events.length})` },
          { id: 'mapping' as SheetTab, label: `Mapeamento (${fieldMapping.length})` },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            class={cn(
              'px-3 h-9 text-sm font-medium border-b-2 transition-colors',
              tab === t.id ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:text-fg',
            )}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'general' && (
      <div class="space-y-3">
        <Input label="Nome *" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} placeholder="Ex.: Leads para CRM externo" />
        {!isEdit && (
          <>
            <ConnectionSelect value={connectionId} onChange={setConnectionId} required />
            {typeof connectionId === 'number' && (
              <div class="space-y-2">
                <div class="flex flex-col gap-1">
                  <span class="text-xs font-medium text-fg-muted">Planilha *</span>
                  <div class="flex gap-2 items-end">
                    <select
                      class="h-9 px-2 rounded-md bg-surface border border-border text-sm text-fg flex-1 focus:outline-none focus:border-accent"
                      value={spreadsheetId}
                      onChange={(e) => pickSpreadsheet((e.target as HTMLSelectElement).value)}
                    >
                      <option value="">Selecione…</option>
                      {sheetsQ.data?.data.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setShowCreateSheet((v) => !v)}
                      disabled={sheetsQ.isLoading}
                    >
                      <Plus size={12} /> Nova planilha
                    </Button>
                  </div>
                  {sheetsQ.isLoading && <span class="text-xs text-fg-muted">Buscando planilhas…</span>}
                </div>

                {showCreateSheet && (
                  <div class="rounded-md border border-accent/30 bg-accent/5 p-3 space-y-2">
                    <div class="text-xs text-fg-muted">Cria uma nova planilha no Drive da conta selecionada.</div>
                    <div class="flex gap-2 items-end">
                      <Input
                        label="Nome da nova planilha"
                        value={newSheetTitle}
                        onInput={(e) => setNewSheetTitle((e.target as HTMLInputElement).value)}
                        placeholder="Ex.: Leads CRM"
                        class="flex-1"
                      />
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={handleCreateSpreadsheet}
                        disabled={createSpreadsheet.isPending || !newSheetTitle.trim()}
                      >
                        {createSpreadsheet.isPending ? 'Criando…' : 'Criar'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => { setShowCreateSheet(false); setNewSheetTitle('') }}
                      >
                        <XIcon size={12} />
                      </Button>
                    </div>
                  </div>
                )}

                {spreadsheetId && (
                  <Select
                    label="Aba *"
                    value={sheetName}
                    onChange={(e) => setSheetName((e.target as HTMLSelectElement).value)}
                    {...(tabsQ.isLoading ? { hint: 'Carregando abas…' } : {})}
                  >
                    {tabsQ.data?.data.length === 0 && (
                      <option value="">Sem abas disponíveis</option>
                    )}
                    {tabsQ.data?.data.map((t) => (
                      <option key={t.sheetId} value={t.title}>{t.title}</option>
                    ))}
                    {!tabsQ.data && <option value="Sheet1">Sheet1</option>}
                  </Select>
                )}
              </div>
            )}
          </>
        )}
        <label class="flex items-center gap-2 text-sm text-fg-muted cursor-pointer">
          <input type="checkbox" checked={includeTimestamp} onChange={(e) => setIncludeTimestamp((e.target as HTMLInputElement).checked)} />
          Incluir coluna Data/Hora ao final
        </label>
      </div>
      )}

      {tab === 'events' && <SheetEventsPicker value={events} onChange={setEvents} />}
      {tab === 'mapping' && <SheetMappingEditor value={fieldMapping} onChange={setFieldMapping} />}
    </Modal>
  )
}

function SheetEventsPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const { data, isLoading } = useSheetEvents()
  const allEvents = data?.data ?? []
  const labels = data?.labels ?? {}
  const allSelected = value.includes('*')

  function toggleAll(on: boolean) {
    onChange(on ? ['*'] : [])
  }
  function toggle(ev: string) {
    const current = value.filter((v) => v !== '*')
    onChange(current.includes(ev) ? current.filter((x) => x !== ev) : [...current, ev])
  }

  if (isLoading) return <Skeleton class="h-32 w-full" />

  return (
    <div class="space-y-3">
      <p class="text-xs text-fg-muted">
        Selecione quais eventos do CRM gravam linhas no Sheet. Usar "Todos" mantém o sheet sempre atualizado.
      </p>
      <label class="flex items-center gap-2 text-sm text-fg cursor-pointer p-2 rounded-md border border-border bg-surface hover:bg-surface-3">
        <input type="checkbox" checked={allSelected} onChange={(e) => toggleAll((e.target as HTMLInputElement).checked)} />
        <span class="font-medium">Todos os eventos (recomendado)</span>
      </label>
      <div class={cn('space-y-1', allSelected && 'opacity-50 pointer-events-none')}>
        {allEvents.map((ev) => (
          <label key={ev} class="flex items-center gap-2 text-xs text-fg-muted cursor-pointer p-1.5 rounded hover:bg-surface-3">
            <input type="checkbox" checked={value.includes(ev)} onChange={() => toggle(ev)} disabled={allSelected} />
            <span class="text-fg">{labels[ev] ?? ev}</span>
            <code class="font-mono text-fg-muted ml-auto">{ev}</code>
          </label>
        ))}
      </div>
    </div>
  )
}

function SheetMappingEditor({ value, onChange }: { value: SheetFieldMapping[]; onChange: (v: SheetFieldMapping[]) => void }) {
  const { data, isLoading } = useSheetFields()
  const fields = data?.fields ?? []

  function update(idx: number, patch: Partial<SheetFieldMapping>) {
    onChange(value.map((m, i) => i === idx ? { ...m, ...patch } : m))
  }
  function remove(idx: number) {
    onChange(value.filter((_, i) => i !== idx))
  }
  function add() {
    onChange([...value, { header: '', source: 'lead.nome' }])
  }
  function move(from: number, to: number) {
    if (to < 0 || to >= value.length) return
    const next = value.slice()
    const [item] = next.splice(from, 1)
    if (item) next.splice(to, 0, item)
    onChange(next)
  }
  function resetDefault() {
    onChange(DEFAULT_FIELD_MAPPING.slice())
  }

  if (isLoading) return <Skeleton class="h-48 w-full" />

  return (
    <div class="space-y-3">
      <div class="flex items-center justify-between gap-2">
        <p class="text-xs text-fg-muted flex-1">
          Cada linha vira uma coluna no Sheet. Reordene para mudar a ordem das colunas.
        </p>
        <Button variant="secondary" size="sm" onClick={resetDefault}>Restaurar padrão</Button>
      </div>

      <ul class="space-y-1.5">
        {value.map((m, idx) => (
          <li key={idx} class="grid grid-cols-[auto_1fr_1fr_auto] items-center gap-2 p-2 rounded-md border border-border bg-surface">
            <div class="flex flex-col">
              <button type="button" class="size-5 grid place-items-center text-fg-muted hover:text-fg" onClick={() => move(idx, idx - 1)} aria-label="Subir">▲</button>
              <button type="button" class="size-5 grid place-items-center text-fg-muted hover:text-fg" onClick={() => move(idx, idx + 1)} aria-label="Descer">▼</button>
            </div>
            <Input
              value={m.header}
              onInput={(e) => update(idx, { header: (e.target as HTMLInputElement).value })}
              placeholder="Cabeçalho da coluna"
            />
            <Select
              value={m.source}
              onChange={(e) => update(idx, { source: (e.target as HTMLSelectElement).value })}
            >
              <optgroup label="Lead">
                {fields.filter((f) => f.group === 'lead').map((f) => (
                  <option key={f.key} value={f.key}>{f.label}</option>
                ))}
              </optgroup>
              <optgroup label="Evento">
                {fields.filter((f) => f.group === 'event').map((f) => (
                  <option key={f.key} value={f.key}>{f.label}</option>
                ))}
              </optgroup>
              {fields.some((f) => f.group === 'custom') && (
                <optgroup label="Campos personalizados">
                  {fields.filter((f) => f.group === 'custom').map((f) => (
                    <option key={f.key} value={f.key}>{f.label}</option>
                  ))}
                </optgroup>
              )}
            </Select>
            <button
              type="button"
              class="size-7 rounded grid place-items-center text-fg-muted hover:text-danger hover:bg-surface-3"
              onClick={() => remove(idx)}
              aria-label="Remover"
            >
              <Trash2 size={12} />
            </button>
          </li>
        ))}
      </ul>

      <Button variant="secondary" size="sm" onClick={add}>
        <Plus size={12} /> Adicionar coluna
      </Button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Calendar Tab

function CalendarTab() {
  const { data, isLoading } = useCalendarIntegrations()
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<GoogleCalendarIntegration | null>(null)
  const [deleting, setDeleting] = useState<GoogleCalendarIntegration | null>(null)
  const update = useUpdateCalendarIntegration()
  const del = useDeleteCalendarIntegration()

  const integrations = data?.data ?? []

  return (
    <Card class="p-0 overflow-hidden">
      <div class="p-4 border-b border-border flex items-center justify-between">
        <div>
          <div class="text-sm font-semibold text-fg">Integrações Calendar</div>
          <div class="text-xs text-fg-muted mt-0.5">Atividades do CRM viram eventos no Google Calendar com Meet automático.</div>
        </div>
        <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
          <Plus size={14} /> Nova integração
        </Button>
      </div>
      {isLoading && <div class="p-4"><Skeleton class="h-20 w-full" /></div>}
      {!isLoading && integrations.length === 0 && (
        <div class="p-8"><EmptyState icon={<CalendarRange size={24} />} title="Sem integrações" /></div>
      )}
      {!isLoading && integrations.length > 0 && (
        <ul class="divide-y divide-border">
          {integrations.map((i) => (
            <li key={i.id} class="p-4 flex flex-wrap items-center gap-3">
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-sm font-medium text-fg truncate">{i.name}</span>
                  <Badge tone={i.active ? 'accent' : 'neutral'}>{i.active ? 'Ativa' : 'Pausada'}</Badge>
                  {i.autoMeetLink && <Badge tone="info" solid>Meet auto</Badge>}
                  {i.notifyLead && <Badge tone="info" solid>Notifica lead</Badge>}
                </div>
                <div class="text-xs text-fg-muted mt-0.5">
                  Calendário: <code class="font-mono">{i.calendarId}</code> · {i.activityTypes.length} tipo(s) {i.connection?.email ? `· ${i.connection.email}` : ''}
                </div>
              </div>
              <div class="flex gap-1">
                <Button variant="secondary" size="sm" onClick={() => update.mutate({ id: i.id, active: !i.active }, {
                  onSuccess: () => toast(i.active ? 'Pausada' : 'Ativada', 'success'),
                  onError: (e: unknown) => toast((e as Error).message, 'danger'),
                })}>{i.active ? 'Pausar' : 'Ativar'}</Button>
                <button type="button" class="size-8 rounded-md grid place-items-center text-fg-muted hover:text-fg hover:bg-surface-3" onClick={() => setEditing(i)} aria-label="Editar"><Pencil size={12} /></button>
                <button type="button" class="size-8 rounded-md grid place-items-center text-fg-muted hover:text-danger hover:bg-surface-3" onClick={() => setDeleting(i)} aria-label="Excluir"><Trash2 size={12} /></button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {(creating || editing) && (
        <CalendarIntegrationModal integration={editing} onClose={() => { setCreating(false); setEditing(null) }} />
      )}
      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(o) => { if (!o) setDeleting(null) }}
          title={`Excluir "${deleting.name}"`}
          description="A integração para de criar eventos. Eventos já criados continuam no Calendar."
          destructive
          confirmLabel="Excluir"
          loading={del.isPending}
          onConfirm={() => del.mutate(deleting.id, {
            onSuccess: () => { toast('Integração excluída', 'success'); setDeleting(null) },
            onError: (e: unknown) => toast((e as Error).message, 'danger'),
          })}
        />
      )}
    </Card>
  )
}

function CalendarIntegrationModal({ integration, onClose }: { integration: GoogleCalendarIntegration | null; onClose: () => void }) {
  const isEdit = !!integration
  const [name, setName] = useState(integration?.name ?? '')
  const [connectionId, setConnectionId] = useState<number | ''>(integration?.connectionId ?? '')
  const [calendarId, setCalendarId] = useState(integration?.calendarId ?? 'primary')
  const [activityTypes, setActivityTypes] = useState<string[]>(integration?.activityTypes ?? ['meeting', 'call'])
  const [autoMeetLink, setAutoMeetLink] = useState(integration?.autoMeetLink ?? true)
  const [notifyLead, setNotifyLead] = useState(integration?.notifyLead ?? false)

  const calendarsQ = useGoogleCalendars(typeof connectionId === 'number' ? connectionId : null)
  const create = useCreateCalendarIntegration()
  const update = useUpdateCalendarIntegration()
  const loading = create.isPending || update.isPending

  function handleSubmit() {
    if (!name.trim()) { toast('Nome é obrigatório', 'danger'); return }
    if (!connectionId) { toast('Selecione uma conta Google', 'danger'); return }
    if (activityTypes.length === 0) { toast('Selecione ao menos um tipo de atividade', 'danger'); return }

    const payload = { name: name.trim(), calendarId, activityTypes, autoMeetLink, notifyLead }

    if (isEdit && integration) {
      update.mutate({ id: integration.id, ...payload }, {
        onSuccess: () => { toast('Integração atualizada', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    } else {
      create.mutate({ ...payload, connectionId: Number(connectionId) }, {
        onSuccess: () => { toast('Integração criada', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    }
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={isEdit ? `Editar "${integration.name}"` : 'Nova integração Calendar'}
      size="lg"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={loading}>
            {loading ? 'Salvando…' : 'Salvar'}
          </Button>
        </>
      }
    >
      <div class="space-y-3">
        <Input label="Nome *" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
        {!isEdit && <ConnectionSelect value={connectionId} onChange={setConnectionId} required />}
        {typeof connectionId === 'number' && (
          <Select label="Calendário" value={calendarId} onChange={(e) => setCalendarId((e.target as HTMLSelectElement).value)}>
            <option value="primary">Calendário principal</option>
            {calendarsQ.data?.data.map((c) => (
              <option key={c.id} value={c.id}>{c.summary}{c.primary ? ' (principal)' : ''}</option>
            ))}
          </Select>
        )}
        <ActivityTypesPicker value={activityTypes} onChange={setActivityTypes} />
        <label class="flex items-center gap-2 text-sm text-fg-muted cursor-pointer">
          <input type="checkbox" checked={autoMeetLink} onChange={(e) => setAutoMeetLink((e.target as HTMLInputElement).checked)} />
          Gerar Google Meet automático no evento
        </label>
        <label class="flex items-center gap-2 text-sm text-fg-muted cursor-pointer">
          <input type="checkbox" checked={notifyLead} onChange={(e) => setNotifyLead((e.target as HTMLInputElement).checked)} />
          Notificar o lead pelo email cadastrado
        </label>
      </div>
    </Modal>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Drive Tab (singleton)

function DriveTab() {
  const { data, isLoading } = useDriveConfig()
  const [creating, setCreating] = useState(false)
  const config = data?.data ?? null
  const update = useUpdateDriveConfig()
  const del = useDeleteDriveConfig()
  const [confirmDelete, setConfirmDelete] = useState(false)

  return (
    <>
    <Card>
      <div class="flex items-center justify-between mb-3">
        <div>
          <div class="text-sm font-semibold text-fg">Configuração do Drive</div>
          <div class="text-xs text-fg-muted mt-0.5">Pasta-raiz "Attrae CRM" criada automaticamente. Cada lead ganha sua subpasta.</div>
        </div>
        {!config && (
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            <Plus size={14} /> Configurar Drive
          </Button>
        )}
      </div>
      {isLoading && <Skeleton class="h-24 w-full" />}
      {!isLoading && !config && <EmptyState icon={<HardDrive size={24} />} title="Drive não configurado" description="Conecte uma conta Google primeiro, depois configure aqui." />}
      {!isLoading && config && (
        <div class="space-y-3">
          <div class="text-xs text-fg-muted">
            <span class="text-fg-muted">Pasta-raiz:</span>{' '}
            {config.rootFolderLink ? (
              <a href={config.rootFolderLink} target="_blank" rel="noreferrer" class="text-accent hover:underline font-mono">
                {config.rootFolderId}
              </a>
            ) : (
              <span class="font-mono">{config.rootFolderId}</span>
            )}
          </div>
          <label class="flex items-start gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={config.autoUploadChat}
              onChange={(e) => {
                const v = (e.target as HTMLInputElement).checked
                update.mutate({ id: config.id, autoUploadChat: v }, {
                  onSuccess: () => toast('Configuração salva', 'success'),
                  onError: (er: unknown) => toast((er as Error).message, 'danger'),
                })
              }}
              class="mt-0.5"
            />
            <div>
              <div class="text-fg">Upload automático de mídia do chat</div>
              <div class="text-xs text-fg-muted">Anexos enviados em conversas vão para a pasta do lead automaticamente.</div>
            </div>
          </label>
          <div class="flex gap-2 pt-2">
            <Button variant="secondary" size="sm" onClick={() => update.mutate({ id: config.id, active: !config.active }, {
              onSuccess: () => toast(config.active ? 'Pausada' : 'Ativada', 'success'),
              onError: (e: unknown) => toast((e as Error).message, 'danger'),
            })}>
              {config.active ? 'Pausar' : 'Ativar'}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(true)}>
              <Trash2 size={12} /> Remover configuração
            </Button>
          </div>
        </div>
      )}

      {creating && <DriveConfigModal onClose={() => setCreating(false)} />}
      {confirmDelete && config && (
        <ConfirmDialog
          open
          onOpenChange={(o) => { if (!o) setConfirmDelete(false) }}
          title="Remover configuração do Drive"
          description="A pasta no Drive não é apagada. O CRM para de criar/upload novos arquivos."
          destructive
          confirmLabel="Remover"
          loading={del.isPending}
          onConfirm={() => del.mutate(config.id, {
            onSuccess: () => { toast('Configuração removida', 'success'); setConfirmDelete(false) },
            onError: (e: unknown) => toast((e as Error).message, 'danger'),
          })}
        />
      )}
    </Card>
    {config && config.active && <DriveLeadFolderCard />}
    </>
  )
}

function DriveLeadFolderCard() {
  const [search, setSearch] = useState('')
  const [searchDebounced, setSearchDebounced] = useState('')
  const [selectedLead, setSelectedLead] = useState<{ id: number; label: string } | null>(null)
  const [folder, setFolder] = useState<{ leadId: number; folderId: string; link: string | null } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const leadsQ = useLeads({ search: searchDebounced || undefined, limit: 10 })
  const leadFolder = useDriveLeadFolder()
  const filesQ = useDriveFiles(folder?.folderId ?? null)
  const upload = useUploadToDrive()

  function pickLead(id: number, label: string) {
    setSelectedLead({ id, label })
    setSearch('')
    setFolder(null)
    leadFolder.mutate(id, {
      onSuccess: (r) => setFolder({ leadId: id, folderId: r.data.folderId, link: r.data.link }),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function handleUpload(file: File) {
    if (!folder) return
    upload.mutate({ folderId: folder.folderId, file }, {
      onSuccess: () => {
        toast(`"${file.name}" enviado`, 'success')
        void filesQ.refetch()
      },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function handleFilesPicked(e: Event) {
    const files = (e.target as HTMLInputElement).files
    if (!files || files.length === 0) return
    Array.from(files).forEach((f) => handleUpload(f))
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault()
    if (!folder) return
    const files = e.dataTransfer?.files
    if (!files || files.length === 0) return
    Array.from(files).forEach((f) => handleUpload(f))
  }

  return (
    <Card class="mt-4">
      <div class="text-sm font-semibold text-fg mb-1">Pasta por lead</div>
      <div class="text-xs text-fg-muted mb-3">
        Cria/abre uma subpasta no Drive para o lead selecionado e permite upload de arquivos manualmente.
      </div>

      <div class="space-y-3">
        <div class="relative">
          <Input
            label={selectedLead ? 'Lead selecionado' : 'Buscar lead'}
            value={selectedLead ? selectedLead.label : search}
            onInput={(e) => {
              if (selectedLead) {
                setSelectedLead(null)
                setFolder(null)
              }
              setSearch((e.target as HTMLInputElement).value)
            }}
            placeholder="Nome, empresa, email ou WhatsApp…"
          />
          {selectedLead && (
            <button
              type="button"
              class="absolute right-2 top-7 size-7 grid place-items-center text-fg-muted hover:text-fg"
              onClick={() => { setSelectedLead(null); setFolder(null); setSearch('') }}
              aria-label="Limpar"
            >
              <XIcon size={12} />
            </button>
          )}
          {!selectedLead && search && (leadsQ.data?.leads.length ?? 0) > 0 && (
            <ul class="absolute z-10 left-0 right-0 mt-1 rounded-md border border-border bg-surface-2 shadow-lg max-h-56 overflow-y-auto">
              {(leadsQ.data?.leads ?? []).map((l) => (
                <li key={l.id}>
                  <button
                    type="button"
                    class="w-full text-left px-3 py-2 text-xs text-fg hover:bg-surface-3"
                    onClick={() => pickLead(l.id, l.nome ?? l.empresa ?? l.whatsapp ?? `Lead #${l.id}`)}
                  >
                    <div class="font-medium">{l.nome ?? l.empresa ?? `Lead #${l.id}`}</div>
                    <div class="text-fg-muted">
                      {l.empresa ?? '—'} · {l.whatsapp ?? '—'} {l.email ? `· ${l.email}` : ''}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {leadFolder.isPending && <Skeleton class="h-12 w-full" />}

        {folder && (
          <div class="space-y-3">
            <div class="rounded-md border border-accent/30 bg-accent/10 p-3 text-xs flex items-start gap-2">
              <Folder size={14} class="mt-0.5 shrink-0 text-accent" />
              <div class="flex-1 min-w-0">
                <div class="text-fg font-medium">Pasta pronta</div>
                <code class="font-mono text-fg-muted break-all">{folder.folderId}</code>
              </div>
              {folder.link && (
                <a
                  href={folder.link}
                  target="_blank"
                  rel="noreferrer"
                  class="inline-flex items-center gap-1 text-xs text-accent hover:underline shrink-0"
                >
                  Abrir <ExternalLink size={10} />
                </a>
              )}
            </div>

            <div
              class="rounded-md border-2 border-dashed border-border bg-surface p-6 text-center"
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
            >
              <Upload size={24} class="mx-auto text-fg-muted mb-2" />
              <p class="text-xs text-fg-muted mb-3">Arraste arquivos aqui ou</p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handleFilesPicked}
                class="hidden"
                id="drive-file-input"
              />
              <Button variant="primary" size="sm" onClick={() => fileInputRef.current?.click()} disabled={upload.isPending}>
                <Upload size={12} /> {upload.isPending ? 'Enviando…' : 'Selecionar arquivos'}
              </Button>
            </div>

            <div>
              <div class="flex items-center justify-between mb-2">
                <div class="text-xs uppercase tracking-wider text-fg-muted font-medium">Arquivos na pasta</div>
                <Button variant="secondary" size="sm" onClick={() => void filesQ.refetch()} disabled={filesQ.isFetching}>
                  <RefreshCw size={10} class={filesQ.isFetching ? 'animate-spin' : ''} />
                </Button>
              </div>
              {filesQ.isLoading && <Skeleton class="h-24 w-full" />}
              {!filesQ.isLoading && (filesQ.data?.data.length ?? 0) === 0 && (
                <div class="text-xs text-fg-muted py-3 text-center">Pasta vazia.</div>
              )}
              {!filesQ.isLoading && filesQ.data && filesQ.data.data.length > 0 && (
                <ul class="divide-y divide-border bg-surface rounded-md border border-border">
                  {filesQ.data.data.map((f: DriveFile) => (
                    <li key={f.id} class="px-3 py-2 flex items-center gap-2 text-xs">
                      <FileIcon size={12} class="text-fg-muted shrink-0" />
                      <a
                        href={f.webViewLink ?? '#'}
                        target="_blank"
                        rel="noreferrer"
                        class="text-fg hover:text-accent truncate flex-1"
                      >
                        {f.name}
                      </a>
                      <span class="text-fg-muted whitespace-nowrap">{f.mimeType.replace('application/', '').slice(0, 24)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}

function DriveConfigModal({ onClose }: { onClose: () => void }) {
  const [connectionId, setConnectionId] = useState<number | ''>('')
  const [autoUploadChat, setAutoUploadChat] = useState(false)
  const create = useCreateDriveConfig()

  function handleSubmit() {
    if (!connectionId) { toast('Selecione uma conta Google', 'danger'); return }
    create.mutate({ connectionId: Number(connectionId), autoUploadChat }, {
      onSuccess: () => { toast('Drive configurado — pasta "Attrae CRM" criada', 'success'); onClose() },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Configurar Google Drive"
      size="lg"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={create.isPending}>
            {create.isPending ? 'Configurando…' : 'Configurar'}
          </Button>
        </>
      }
    >
      <div class="space-y-3">
        <ConnectionSelect value={connectionId} onChange={setConnectionId} required />
        <label class="flex items-start gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={autoUploadChat} onChange={(e) => setAutoUploadChat((e.target as HTMLInputElement).checked)} class="mt-0.5" />
          <div>
            <div class="text-fg">Upload automático de mídia do chat</div>
            <div class="text-xs text-fg-muted">Anexos vão para a pasta do lead correspondente.</div>
          </div>
        </label>
        <div class="rounded-md border border-warning/30 bg-warning/10 p-3 text-xs text-fg flex items-start gap-2">
          <AlertTriangle size={14} class="mt-0.5 shrink-0 text-warning" />
          <span>Vai criar (ou reaproveitar) a pasta "Attrae CRM" no Drive da conta selecionada.</span>
        </div>
      </div>
    </Modal>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Tasks Tab

function TasksTab() {
  const { data, isLoading } = useTasksConfigs()
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<GoogleTasksConfig | null>(null)
  const [deleting, setDeleting] = useState<GoogleTasksConfig | null>(null)
  const update = useUpdateTasksConfig()
  const del = useDeleteTasksConfig()
  const configs = data?.data ?? []

  return (
    <Card class="p-0 overflow-hidden">
      <div class="p-4 border-b border-border flex items-center justify-between">
        <div>
          <div class="text-sm font-semibold text-fg">Integrações Tasks</div>
          <div class="text-xs text-fg-muted mt-0.5">Atividades do CRM são criadas como tasks do Google Tasks.</div>
        </div>
        <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
          <Plus size={14} /> Nova integração
        </Button>
      </div>
      {isLoading && <div class="p-4"><Skeleton class="h-20 w-full" /></div>}
      {!isLoading && configs.length === 0 && (
        <div class="p-8"><EmptyState icon={<ListChecks size={24} />} title="Sem integrações" /></div>
      )}
      {!isLoading && configs.length > 0 && (
        <ul class="divide-y divide-border">
          {configs.map((c) => (
            <li key={c.id} class="p-4 flex flex-wrap items-center gap-3">
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-sm font-medium text-fg truncate">{c.taskListTitle}</span>
                  <Badge tone={c.active ? 'accent' : 'neutral'}>{c.active ? 'Ativa' : 'Pausada'}</Badge>
                </div>
                <div class="text-xs text-fg-muted mt-0.5">
                  {c.activityTypes.length} tipo(s) · {c.totalSynced} sincronizada(s) · {c.totalFailed} falha(s)
                </div>
              </div>
              <div class="flex gap-1">
                <Button variant="secondary" size="sm" onClick={() => update.mutate({ id: c.id, active: !c.active }, {
                  onSuccess: () => toast(c.active ? 'Pausada' : 'Ativada', 'success'),
                  onError: (e: unknown) => toast((e as Error).message, 'danger'),
                })}>{c.active ? 'Pausar' : 'Ativar'}</Button>
                <button type="button" class="size-8 rounded-md grid place-items-center text-fg-muted hover:text-fg hover:bg-surface-3" onClick={() => setEditing(c)} aria-label="Editar"><Pencil size={12} /></button>
                <button type="button" class="size-8 rounded-md grid place-items-center text-fg-muted hover:text-danger hover:bg-surface-3" onClick={() => setDeleting(c)} aria-label="Excluir"><Trash2 size={12} /></button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {(creating || editing) && (
        <TasksConfigModal config={editing} onClose={() => { setCreating(false); setEditing(null) }} />
      )}
      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(o) => { if (!o) setDeleting(null) }}
          title={`Excluir "${deleting.taskListTitle}"`}
          description="Tasks já criadas continuam no Google Tasks."
          destructive
          confirmLabel="Excluir"
          loading={del.isPending}
          onConfirm={() => del.mutate(deleting.id, {
            onSuccess: () => { toast('Integração excluída', 'success'); setDeleting(null) },
            onError: (e: unknown) => toast((e as Error).message, 'danger'),
          })}
        />
      )}
    </Card>
  )
}

function TasksConfigModal({ config, onClose }: { config: GoogleTasksConfig | null; onClose: () => void }) {
  const isEdit = !!config
  const [connectionId, setConnectionId] = useState<number | ''>(config?.connectionId ?? '')
  const [taskListId, setTaskListId] = useState(config?.taskListId ?? '')
  const [taskListTitle, setTaskListTitle] = useState(config?.taskListTitle ?? '')
  const [activityTypes, setActivityTypes] = useState<string[]>(config?.activityTypes ?? ['task', 'followup', 'meeting', 'call'])

  const listsQ = useGoogleTaskLists(typeof connectionId === 'number' && !isEdit ? connectionId : null)
  const create = useCreateTasksConfig()
  const update = useUpdateTasksConfig()
  const loading = create.isPending || update.isPending

  function pickList(id: string) {
    const l = listsQ.data?.data.find((x) => x.id === id)
    setTaskListId(id)
    if (l) setTaskListTitle(l.title)
  }

  function handleSubmit() {
    if (activityTypes.length === 0) { toast('Selecione ao menos um tipo', 'danger'); return }
    if (isEdit && config) {
      update.mutate({ id: config.id, activityTypes }, {
        onSuccess: () => { toast('Atualizada', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    } else {
      if (!connectionId || !taskListId || !taskListTitle) { toast('Conta e lista são obrigatórias', 'danger'); return }
      create.mutate({
        connectionId: Number(connectionId),
        taskListId,
        taskListTitle,
        activityTypes,
      }, {
        onSuccess: () => { toast('Integração criada', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    }
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={isEdit ? 'Editar integração Tasks' : 'Nova integração Tasks'}
      size="lg"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={loading}>
            {loading ? 'Salvando…' : 'Salvar'}
          </Button>
        </>
      }
    >
      <div class="space-y-3">
        {!isEdit && (
          <>
            <ConnectionSelect value={connectionId} onChange={setConnectionId} required />
            {typeof connectionId === 'number' && (
              <Select
                label="Lista de tarefas *"
                value={taskListId}
                onChange={(e) => pickList((e.target as HTMLSelectElement).value)}
              >
                <option value="">Selecione…</option>
                {listsQ.data?.data.map((l) => (
                  <option key={l.id} value={l.id}>{l.title}</option>
                ))}
              </Select>
            )}
          </>
        )}
        <ActivityTypesPicker value={activityTypes} onChange={setActivityTypes} />
      </div>
    </Modal>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Gmail Tab

function GmailTab() {
  const { data, isLoading } = useGmailConfigs()
  const configs = data?.data ?? []
  const activeConfig = configs.find((c) => c.active) ?? null
  const profile = useGmailProfile(!!activeConfig)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<GmailConfig | null>(null)
  const [deleting, setDeleting] = useState<GmailConfig | null>(null)
  const [sendingTest, setSendingTest] = useState(false)
  const update = useUpdateGmailConfig()
  const del = useDeleteGmailConfig()

  return (
    <>
      <Card class="p-0 overflow-hidden">
        <div class="p-4 border-b border-border flex items-center justify-between">
          <div>
            <div class="text-sm font-semibold text-fg">Configurações Gmail</div>
            <div class="text-xs text-fg-muted mt-0.5">A configuração ativa é usada para enviar emails do CRM.</div>
          </div>
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            <Plus size={14} /> Nova configuração
          </Button>
        </div>
        {profile.data && (
          <div class="px-4 py-2 border-b border-border bg-accent/10 text-xs text-fg flex items-center gap-2">
            <Check size={12} class="text-accent" /> Conta ativa: <strong>{profile.data.data.email}</strong>
          </div>
        )}
        {isLoading && <div class="p-4"><Skeleton class="h-20 w-full" /></div>}
        {!isLoading && configs.length === 0 && (
          <div class="p-8"><EmptyState icon={<Mail size={24} />} title="Sem configurações" /></div>
        )}
        {!isLoading && configs.length > 0 && (
          <ul class="divide-y divide-border">
            {configs.map((c) => (
              <li key={c.id} class="p-4 flex flex-wrap items-center gap-3">
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="text-sm font-medium text-fg truncate">{c.senderName || `Config #${c.id}`}</span>
                    <Badge tone={c.active ? 'accent' : 'neutral'}>{c.active ? 'Ativa' : 'Pausada'}</Badge>
                  </div>
                  <div class="text-xs text-fg-muted mt-0.5">
                    {c.totalSent} enviado(s) · {c.totalFailed} falha(s)
                    {c.syncReplies && <> · {c.totalReceived ?? 0} resposta(s) recebida(s)</>}
                  </div>
                  <div class="mt-1"><GmailReceiveControls config={c} /></div>
                </div>
                <div class="flex gap-1">
                  <Button variant="secondary" size="sm" onClick={() => update.mutate({ id: c.id, active: !c.active }, {
                    onSuccess: () => toast(c.active ? 'Pausada' : 'Ativada', 'success'),
                    onError: (e: unknown) => toast((e as Error).message, 'danger'),
                  })}>{c.active ? 'Pausar' : 'Ativar'}</Button>
                  <button type="button" class="size-8 rounded-md grid place-items-center text-fg-muted hover:text-fg hover:bg-surface-3" onClick={() => setEditing(c)} aria-label="Editar"><Pencil size={12} /></button>
                  <button type="button" class="size-8 rounded-md grid place-items-center text-fg-muted hover:text-danger hover:bg-surface-3" onClick={() => setDeleting(c)} aria-label="Excluir"><Trash2 size={12} /></button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {(creating || editing) && (
          <GmailConfigModal config={editing} onClose={() => { setCreating(false); setEditing(null) }} />
        )}
        {deleting && (
          <ConfirmDialog
            open
            onOpenChange={(o) => { if (!o) setDeleting(null) }}
            title="Excluir configuração Gmail"
            description="Sem configuração ativa, o CRM não consegue enviar emails."
            destructive
            confirmLabel="Excluir"
            loading={del.isPending}
            onConfirm={() => del.mutate(deleting.id, {
              onSuccess: () => { toast('Configuração excluída', 'success'); setDeleting(null) },
              onError: (e: unknown) => toast((e as Error).message, 'danger'),
            })}
          />
        )}
      </Card>

      {activeConfig && (
        <Card class="mt-4">
          <div class="text-sm font-semibold text-fg mb-2">Enviar email de teste</div>
          <Button variant="secondary" size="sm" onClick={() => setSendingTest(true)}>
            <Send size={12} /> Enviar teste
          </Button>
          {sendingTest && <SendTestModal onClose={() => setSendingTest(false)} />}
        </Card>
      )}
    </>
  )
}

function GmailReceiveControls({ config }: { config: GmailConfig }) {
  const watch = useGmailWatch()
  const unwatch = useGmailUnwatch()
  const sync = useGmailSyncNow()
  const busy = watch.isPending || unwatch.isPending || sync.isPending

  if (config.syncReplies) {
    return (
      <div class="flex items-center gap-2 flex-wrap text-2xs">
        <span class="inline-flex items-center gap-1 text-success font-medium"><Check size={11} /> Recebendo respostas</span>
        {config.lastSyncAt && <span class="text-fg-muted">últ. sync {new Date(config.lastSyncAt).toLocaleString('pt-BR')}</span>}
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => sync.mutate(config.id, {
          onSuccess: (r: any) => toast(`Sincronizado (${r?.ingested ?? 0} nova(s))`, 'success'),
          onError: (e: unknown) => toast((e as Error).message, 'danger'),
        })}>Sincronizar agora</Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => unwatch.mutate(config.id, {
          onSuccess: () => toast('Recebimento desativado', 'success'),
          onError: (e: unknown) => toast((e as Error).message, 'danger'),
        })}>Desativar</Button>
      </div>
    )
  }
  return (
    <Button variant="secondary" size="sm" disabled={busy} onClick={() => watch.mutate(config.id, {
      onSuccess: () => toast('Recebimento ativado — respostas dos clientes serão registradas nas atividades', 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })}>
      <Mail size={12} /> Ativar recebimento de respostas
    </Button>
  )
}

function GmailConfigModal({ config, onClose }: { config: GmailConfig | null; onClose: () => void }) {
  const isEdit = !!config
  const [connectionId, setConnectionId] = useState<number | ''>(config?.connectionId ?? '')
  const [senderName, setSenderName] = useState(config?.senderName ?? '')
  const [signature, setSignature] = useState(config?.signature ?? '')
  const create = useCreateGmailConfig()
  const update = useUpdateGmailConfig()
  const loading = create.isPending || update.isPending

  function handleSubmit() {
    if (isEdit && config) {
      update.mutate({ id: config.id, senderName, signature }, {
        onSuccess: () => { toast('Atualizada', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    } else {
      if (!connectionId) { toast('Selecione uma conta Google', 'danger'); return }
      create.mutate({ connectionId: Number(connectionId), senderName, signature }, {
        onSuccess: (r) => { toast(`Configurado para ${r.data.email ?? 'conta selecionada'}`, 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    }
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={isEdit ? 'Editar configuração Gmail' : 'Nova configuração Gmail'}
      size="lg"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={loading}>
            {loading ? 'Salvando…' : 'Salvar'}
          </Button>
        </>
      }
    >
      <div class="space-y-3">
        {!isEdit && <ConnectionSelect value={connectionId} onChange={setConnectionId} required />}
        <Input
          label="Nome do remetente"
          value={senderName}
          onInput={(e) => setSenderName((e.target as HTMLInputElement).value)}
          placeholder="Ex.: Equipe Beyond"
          hint="Aparece como 'Nome <email@dominio>' nos emails."
        />
        <Textarea
          label="Assinatura HTML (opcional)"
          value={signature}
          onInput={(e) => setSignature((e.target as HTMLTextAreaElement).value)}
          rows={6}
          placeholder="<p>Atenciosamente,<br>Equipe</p>"
        />
      </div>
    </Modal>
  )
}

function SendTestModal({ onClose }: { onClose: () => void }) {
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState('Teste — Attrae')
  const [body, setBody] = useState('Este é um email de teste enviado pelo Attrae.')
  const send = useSendGmail()

  function handleSubmit() {
    if (!to.trim() || !subject.trim() || !body.trim()) { toast('Preencha todos os campos', 'danger'); return }
    send.mutate({ to: to.trim(), subject: subject.trim(), body: body.trim() }, {
      onSuccess: (r) => { toast(`Enviado · messageId ${r.messageId}`, 'success'); onClose() },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Enviar email de teste"
      size="lg"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={send.isPending}>
            <Send size={12} /> {send.isPending ? 'Enviando…' : 'Enviar'}
          </Button>
        </>
      }
    >
      <div class="space-y-3">
        <Input label="Para" type="email" value={to} onInput={(e) => setTo((e.target as HTMLInputElement).value)} placeholder="destino@email.com" />
        <Input label="Assunto" value={subject} onInput={(e) => setSubject((e.target as HTMLInputElement).value)} />
        <Textarea label="Mensagem" value={body} onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)} rows={5} />
      </div>
    </Modal>
  )
}

