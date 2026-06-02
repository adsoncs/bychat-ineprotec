import { useState } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import {
  Cloud, Trash2, RefreshCw, Send, Plug, AlertCircle, CheckCircle,
  Copy, Webhook, AlertTriangle, HelpCircle, FileText, BarChart3,
} from 'lucide-preact'
import { HowItWorksModal } from '@/components/ui/HowItWorksModal'
import {
  useCloudApiConnections,
  useCloudApiConfig,
  useDeleteCloudApiConnection,
  useTestCloudApiConnection,
  useSyncCloudApiTemplates,
  useUpdateCloudApiConnection,
  type CloudApiConnection,
} from '@/hooks/useCloudApi'
import { useChatbots } from '@/hooks/useChatbots'
import { useTeams } from '@/hooks/useTeams'
import { useUsers } from '@/hooks/useUsers'
import { Page } from '@/components/ui/Page'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Input, Select } from '@/components/ui/Input'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EmbeddedSignupModal } from '@/components/EmbeddedSignupModal'
import { cloudApiQualityLabel } from '@/lib/statusLabels'
import { toast } from '@/lib/toast'

function buildWebhookUrl(): string {
  if (typeof window === 'undefined') return ''
  return `${window.location.origin}/api/cloud-api/webhook`
}

export function CloudApiPage() {
  const { data: conns, isLoading } = useCloudApiConnections()
  const { data: config } = useCloudApiConfig()
  const { data: chatbots } = useChatbots()
  const { data: teams } = useTeams()
  const { data: usersData } = useUsers()
  const [, navigate] = useLocation()
  const eligibleAgents = (usersData?.users ?? []).filter(
    (u) => u.active && (u.role === 'AGENT' || u.role === 'MANAGER' || u.role === 'ADMIN' || u.role === 'SUPERADMIN'),
  )
  const [deleting, setDeleting] = useState<CloudApiConnection | null>(null)
  const [testing, setTesting] = useState<CloudApiConnection | null>(null)
  const [signupOpen, setSignupOpen] = useState(false)
  const [showHowItWorks, setShowHowItWorks] = useState(false)
  const del = useDeleteCloudApiConnection()
  const sync = useSyncCloudApiTemplates()

  const missingConfig = !!config && (!config.appId || !config.configId)
  const webhookUrl = buildWebhookUrl()

  function handleSync(wabaId: string) {
    sync.mutate({ wabaId }, {
      onSuccess: (r) => toast(`${r.synced} modelos sincronizados`, 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function handleCopyWebhook() {
    if (!webhookUrl) return
    void navigator.clipboard.writeText(webhookUrl)
    toast('URL copiada', 'success', 1_500)
  }

  return (
    <Page
      title="WhatsApp API"
      description="Conexões oficiais com a API da Meta (WABA) via Embedded Signup."
      actions={
        <div class="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setShowHowItWorks(true)}>
            <HelpCircle size={14} /> Como funciona?
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setSignupOpen(true)}
            disabled={missingConfig}
            title={missingConfig ? 'Integração não configurada pelo administrador da plataforma' : undefined}
          >
            <Plug size={14} /> Conectar conta
          </Button>
        </div>
      }
    >
      {missingConfig && (
        <Card class="mb-3 border-warning/40 bg-warning/10">
          <div class="flex items-start gap-2">
            <AlertTriangle size={16} class="text-warning shrink-0 mt-0.5" />
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium text-fg">Integração WhatsApp Oficial indisponível</div>
              <div class="text-xs text-fg-muted mt-1">
                A conexão precisa ser habilitada pelo administrador da plataforma (App ID + Config ID do Meta).
                Sem isso, novas contas não podem ser conectadas via Embedded Signup. Entre em contato com o suporte.
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Webhook URL — sempre visível para fácil cópia ao configurar no app Meta */}
      <Card class="mb-3">
        <div class="flex items-start gap-2">
          <Webhook size={16} class="text-fg-subtle shrink-0 mt-0.5" />
          <div class="flex-1 min-w-0">
            <div class="text-xs uppercase tracking-wider text-fg-subtle">URL do webhook</div>
            <div class="text-[0.6875rem] text-fg-muted mb-2">
              Configure esta URL no app Meta → WhatsApp → Configuration → Webhook.
              Verify token: gerado no signup.
            </div>
            <div class="flex gap-2 items-center">
              <code class="flex-1 px-2 py-1.5 rounded-md bg-surface border border-border text-[0.6875rem] font-mono text-fg break-all">
                {webhookUrl}
              </code>
              <Button size="sm" variant="secondary" onClick={handleCopyWebhook}>
                <Copy size={12} /> Copiar
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {isLoading && (
        <div class="flex flex-col gap-3">
          {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} class="h-24 w-full" />)}
        </div>
      )}
      {!isLoading && conns?.connections.length === 0 && (
        <EmptyState
          icon={<Cloud size={24} />}
          title="Nenhuma conta WABA conectada"
          description="Conecte um número WhatsApp Business via Embedded Signup para enviar mensagens com a API oficial."
          action={
            <Button variant="primary" size="sm" onClick={() => setSignupOpen(true)} disabled={missingConfig}>
              <Plug size={14} /> Iniciar conexão
            </Button>
          }
        />
      )}
      {!isLoading && conns?.connections.map((c) => (
        <ConnectionCard
          key={c.id}
          connection={c}
          chatbots={chatbots?.chatbots ?? []}
          teams={teams?.teams ?? []}
          agents={eligibleAgents}
          syncing={sync.isPending}
          onSync={() => handleSync(c.wabaId)}
          onTest={() => setTesting(c)}
          onDelete={() => setDeleting(c)}
        />
      ))}

      {/* Modelos migraram para tela dedicada — atalho a partir daqui */}
      {(conns?.connections.length ?? 0) > 0 && (
        <Card class="mb-3">
          <div class="flex items-center gap-3">
            <div class="size-9 rounded-md bg-accent/10 grid place-items-center text-accent shrink-0">
              <FileText size={18} />
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium text-fg">Modelos de Mensagem</div>
              <div class="text-xs text-fg-muted">Criar, editar e enviar os modelos HSM aprovados pela Meta.</div>
            </div>
            <Button variant="secondary" size="sm" onClick={() => navigate('/whatsapp-templates')}>
              Abrir modelos
            </Button>
          </div>
        </Card>
      )}

      {/* Disparos & Custos migraram para tela dedicada — atalho a partir daqui */}
      {(conns?.connections.length ?? 0) > 0 && (
        <Card class="mb-3">
          <div class="flex items-center gap-3">
            <div class="size-9 rounded-md bg-accent/10 grid place-items-center text-accent shrink-0">
              <BarChart3 size={18} />
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium text-fg">Disparos & Custos</div>
              <div class="text-xs text-fg-muted">Status, categorias e custo estimado da Meta — com separação por número.</div>
            </div>
            <Button variant="secondary" size="sm" onClick={() => navigate('/whatsapp-dispatch')}>
              Abrir relatório
            </Button>
          </div>
        </Card>
      )}

      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(o) => { if (!o) setDeleting(null) }}
          title={`Remover "${deleting.displayName ?? deleting.displayPhone}"`}
          description="A conexão será desfeita. Para reconectar, será necessário passar pelo Embedded Signup novamente."
          destructive
          confirmLabel="Remover"
          loading={del.isPending}
          onConfirm={() => del.mutate(deleting.id, {
            onSuccess: () => { toast('Conexão removida', 'success'); setDeleting(null) },
            onError: (e: unknown) => toast((e as Error).message, 'danger'),
          })}
        />
      )}

      {testing && <TestMessageModal connection={testing} onClose={() => setTesting(null)} />}

      <EmbeddedSignupModal open={signupOpen} onOpenChange={setSignupOpen} />

      <HowItWorksModal
        open={showHowItWorks}
        onClose={() => setShowHowItWorks(false)}
        title="Como funciona o WhatsApp API?"
        problem={<>
          Esta é a integração <strong>oficial da Meta</strong> com o WhatsApp Business (WABA). É
          diferente do WhatsApp comum: <strong>envio em massa</strong>, modelos aprovados, botões
          interativos, sem risco de bloqueio. Pra escala e operação séria, esta é a via.
        </>}
        steps={[
          {
            title: '🔌 Conectar conta WABA',
            body: <>Botão <strong>Conectar conta</strong> abre o <em>Embedded Signup da Meta</em>. Você loga no Facebook, escolhe sua empresa (ou cria uma), seleciona o número de WhatsApp Business e autoriza o ByChat. Em ~5 minutos a conta está conectada.</>,
          },
          {
            title: '📝 Modelos aprovados pela Meta',
            body: <>Diferente do WhatsApp comum, no WhatsApp API toda mensagem inicial precisa ser <strong>modelo aprovado</strong> (Meta revisa o texto). Gerencie os modelos na tela <strong>Modelos de Mensagem</strong>.</>,
          },
          {
            title: '💬 Envio em massa via cadência/fluxo',
            body: <>Pode disparar modelo aprovado pra centenas de leads sem risco de bloqueio. Cadências e fluxos enviam pelo WhatsApp API se a conexão tiver modelo configurado.</>,
          },
          {
            title: '🪝 Webhook automático',
            body: <>Cada conexão tem URL de webhook que o sistema configura sozinho. Mensagens recebidas chegam em tempo real em <strong>Conversas</strong>, junto com as do WhatsApp comum.</>,
          },
          {
            title: '🎯 Categorias de modelo',
            body: <>Marketing (promoção), Utilitário (transacional, ex.: confirmação de pedido), Autenticação (códigos de verificação). A categoria determina preço por mensagem — utilitário custa menos que marketing.</>,
          },
        ]}
        tip={{
          tone: 'info',
          title: '💡 Quando usar WhatsApp API vs WhatsApp comum',
          body: <><strong>WhatsApp API</strong>: você precisa enviar pra muitos (lista de inscritos), quer modelos com botão "Confirmar", quer selo verde de Business verificado. <strong>WhatsApp comum (Evolution)</strong>: atendimento 1-pra-1, suporte, conversa contínua, números pessoais.</>,
        }}
      />
    </Page>
  )
}

function ConnectionCard({
  connection: c, chatbots, teams, agents, syncing,
  onSync, onTest, onDelete,
}: {
  connection: CloudApiConnection
  chatbots: { id: number; name: string }[]
  teams: { id: number; name: string }[]
  agents: { id: number; name: string | null; role: string }[]
  syncing: boolean
  onSync: () => void
  onTest: () => void
  onDelete: () => void
}) {
  const update = useUpdateCloudApiConnection()
  const [donoTipo, setDonoTipo] = useState<'team' | 'agent' | 'none'>(
    c.ownerUserId != null ? 'agent' : c.defaultTeamId != null ? 'team' : 'none',
  )

  function handleChatbotChange(value: string) {
    const chatbotId = value ? Number(value) : null
    update.mutate({ id: c.id, chatbotId }, {
      onSuccess: () => toast('Chatbot vinculado atualizado', 'success', 1_500),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function handleActiveToggle(active: boolean) {
    update.mutate({ id: c.id, active }, {
      onSuccess: () => toast(active ? 'Conexão ativada' : 'Conexão pausada', 'success', 1_500),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  // Roteamento por dono (setor OU agente — mutuamente exclusivos, igual à
  // instância Evolution). Salva ao escolher no select; "Sem dono" salva na hora.
  function saveDono(input: { defaultTeamId?: number | null; ownerUserId?: number | null }) {
    update.mutate({ id: c.id, ...input }, {
      onSuccess: () => toast('Roteamento da conexão atualizado', 'success', 1_500),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <Card class="group mb-3">
      <CardHeader>
        <CardTitle>
          <span class="inline-flex items-center gap-2">
            <Cloud size={16} class="text-fg-subtle" />
            {c.displayName ?? c.displayPhone}
          </span>
        </CardTitle>
        <div class="flex items-center gap-2">
          {c.tokenStatus === 'valid' ? (
            <Badge tone="success"><CheckCircle size={10} class="mr-0.5 inline" /> Token OK</Badge>
          ) : (
            <Badge tone="danger"><AlertCircle size={10} class="mr-0.5 inline" /> Token expirado</Badge>
          )}
          <Badge tone={c.active ? 'success' : 'neutral'}>{c.active ? 'Ativa' : 'Inativa'}</Badge>
        </div>
      </CardHeader>

      {c.tokenError && (
        <div class="text-xs text-danger mb-3 bg-danger/10 rounded-md px-2 py-1.5">{c.tokenError}</div>
      )}

      <div class="grid gap-2 grid-cols-1 sm:grid-cols-3 text-xs">
        <Field label="Phone Number ID" value={c.phoneNumberId} mono />
        <Field label="WABA ID" value={c.wabaId} mono />
        <Field label="Telefone" value={c.displayPhone} />
        <Field label="Tipo de token" value={c.tokenType} />
        {c.qualityRating && <Field label="Qualidade" value={cloudApiQualityLabel(c.qualityRating)} />}
        {c.messagingLimit && <Field label="Limite" value={c.messagingLimit} />}
      </div>

      {/* Inline edit: chatbot + ativa */}
      <div class="grid sm:grid-cols-2 gap-3 mt-3 pt-3 border-t border-border">
        <Select
          label="Chatbot vinculado"
          value={c.chatbotId != null ? String(c.chatbotId) : ''}
          onChange={(e) => handleChatbotChange((e.target as HTMLSelectElement).value)}
          disabled={update.isPending}
          hint="Se vinculado, leads passam pelo chatbot. Sem chatbot = atendimento humano."
        >
          <option value="">Nenhum (atendimento humano)</option>
          {chatbots.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </Select>
        <label class="flex items-center gap-2 text-sm text-fg-muted self-end h-9">
          <input
            type="checkbox"
            checked={c.active}
            disabled={update.isPending}
            onChange={(e) => handleActiveToggle((e.target as HTMLInputElement).checked)}
          />
          Conexão ativa (recebe mensagens e modelos)
        </label>
      </div>

      {/* Roteamento: setor padrão OU agente dedicado (paridade com instância Evolution) */}
      <div class="mt-3 pt-3 border-t border-border">
        <div class="text-sm font-medium text-fg mb-2">Para quem vão os leads desta conexão</div>
        <div class="flex gap-3 text-sm mb-2">
          <label class="flex items-center gap-1.5 cursor-pointer">
            <input type="radio" name={`dono-${c.id}`} checked={donoTipo === 'team'} disabled={update.isPending}
              onChange={() => setDonoTipo('team')} />
            Setor
          </label>
          <label class="flex items-center gap-1.5 cursor-pointer">
            <input type="radio" name={`dono-${c.id}`} checked={donoTipo === 'agent'} disabled={update.isPending}
              onChange={() => setDonoTipo('agent')} />
            Agente
          </label>
          <label class="flex items-center gap-1.5 cursor-pointer">
            <input type="radio" name={`dono-${c.id}`} checked={donoTipo === 'none'} disabled={update.isPending}
              onChange={() => { setDonoTipo('none'); saveDono({ defaultTeamId: null, ownerUserId: null }) }} />
            Sem dono
          </label>
        </div>
        {donoTipo === 'team' && (
          <Select
            value={c.defaultTeamId != null ? String(c.defaultTeamId) : ''}
            disabled={update.isPending}
            onChange={(e) => {
              const v = (e.target as HTMLSelectElement).value
              saveDono({ defaultTeamId: v ? Number(v) : null, ownerUserId: null })
            }}
          >
            <option value="">— Selecionar setor —</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        )}
        {donoTipo === 'agent' && (
          <Select
            value={c.ownerUserId != null ? String(c.ownerUserId) : ''}
            disabled={update.isPending}
            onChange={(e) => {
              const v = (e.target as HTMLSelectElement).value
              saveDono({ ownerUserId: v ? Number(v) : null, defaultTeamId: null })
            }}
          >
            <option value="">— Selecionar agente —</option>
            {agents.map((u) => <option key={u.id} value={u.id}>{u.name || `Usuário #${u.id}`} ({u.role})</option>)}
          </Select>
        )}
        <p class="text-xs text-fg-subtle mt-1">
          {donoTipo === 'agent'
            ? 'Leads que chegarem por este número são atribuídos direto ao agente.'
            : donoTipo === 'team'
            ? 'Leads são roteados ao setor (round-robin conforme a configuração da equipe).'
            : 'Sem amarração — leads caem na fila global do tenant (regras/fallback).'}
        </p>
      </div>

      <div class="flex gap-2 mt-4">
        <Button variant="secondary" size="sm" onClick={onTest}>
          <Send size={12} /> Enviar teste
        </Button>
        <Button variant="secondary" size="sm" onClick={onSync} disabled={syncing}>
          <RefreshCw size={12} class={syncing ? 'animate-spin' : ''} /> Sincronizar modelos
        </Button>
        <button
          type="button"
          class="size-8 rounded-md grid place-items-center text-fg-muted hover:text-danger hover:bg-surface-3 ml-auto"
          onClick={onDelete}
          aria-label="Remover"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </Card>
  )
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div class="text-[0.625rem] text-fg-subtle uppercase tracking-wider">{label}</div>
      <div class={`text-fg ${mono ? 'font-mono text-[0.6875rem]' : 'text-sm'} truncate`}>{value}</div>
    </div>
  )
}

function TestMessageModal({ connection, onClose }: { connection: CloudApiConnection; onClose: () => void }) {
  const [phone, setPhone] = useState('')
  const [message, setMessage] = useState('')
  const test = useTestCloudApiConnection()

  function handleSubmit() {
    if (!phone.trim()) { toast('Telefone obrigatório', 'danger'); return }
    test.mutate({ id: connection.id, phone: phone.trim(), message: message || undefined }, {
      onSuccess: (r) => { toast(`Mensagem enviada (id: ${r.messageId})`, 'success'); onClose() },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Enviar mensagem de teste"
      description={`Via ${connection.displayName ?? connection.displayPhone}`}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={test.isPending}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={test.isPending}>
            {test.isPending ? 'Enviando…' : 'Enviar'}
          </Button>
        </>
      }
    >
      <div class="space-y-3">
        <Input label="Telefone do destinatário" value={phone} onInput={(e) => setPhone((e.target as HTMLInputElement).value)} placeholder="5511999999999" />
        <Input label="Mensagem (opcional)" value={message} onInput={(e) => setMessage((e.target as HTMLInputElement).value)} placeholder="Deixe em branco para mensagem padrão" />
      </div>
    </Modal>
  )
}

