import { useState, useEffect, useRef } from 'preact/hooks'
import { useQueryClient } from '@tanstack/react-query'
import {
  Phone, Plus, Trash2, RefreshCw, Power, Wifi, WifiOff, AlertCircle,
  Pencil, User, Image as ImageIcon, Upload, X as XIcon, RotateCcw, CheckCircle2, HelpCircle,
} from 'lucide-preact'
import { HowItWorksModal } from '@/components/ui/HowItWorksModal'
import {
  useInstances,
  useCreateInstance,
  useUpdateInstance,
  useDeleteInstance,
  useConnectInstance,
  useDisconnectInstance,
  useRestartInstance,
  useBusinessProfile,
  useUpdateProfileName,
  useUpdateProfileStatus,
  useUpdateProfilePicture,
  useRemoveProfilePicture,
  useInstanceStatus,
  useWhatsappConnectionStream,
  uploadProfilePicture,
  type WhatsAppInstance,
} from '@/hooks/useInstances'
import { useChatbots, type ChatbotItem } from '@/hooks/useChatbots'
import { useTeams } from '@/hooks/useTeams'
import { useUsers } from '@/hooks/useUsers'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { ConnectionFunnelPicker } from '@/components/ConnectionFunnelPicker'
import { Input, Textarea, Select } from '@/components/ui/Input'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { toast } from '@/lib/toast'

interface QrFlow {
  instanceId: number
  qrcode?: string
  pairingCode?: string
  startedAt: number
  status: 'loading' | 'ready' | 'expired' | 'connected'
}

const QR_TTL_MS = 3 * 60 * 1000

function formatPhone(jidOrPhone: string): string {
  const digits = String(jidOrPhone).replace(/@.+$/, '').replace(/\D/g, '')
  if (!digits) return ''
  if (digits.length === 13 && digits.startsWith('55')) {
    return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`
  }
  if (digits.length === 12 && digits.startsWith('55')) {
    return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`
  }
  return `+${digits}`
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('pt-BR')
  } catch {
    return ''
  }
}

export function WhatsappPage() {
  const { data, isLoading, isFetching } = useInstances()
  const { data: chatbots } = useChatbots()
  const qc = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<WhatsAppInstance | null>(null)
  const [profileOf, setProfileOf] = useState<WhatsAppInstance | null>(null)
  const [deleting, setDeleting] = useState<WhatsAppInstance | null>(null)
  const [qrFlow, setQrFlow] = useState<QrFlow | null>(null)
  const [showHowItWorks, setShowHowItWorks] = useState(false)

  const connect = useConnectInstance()
  const disconnect = useDisconnectInstance()
  const restart = useRestartInstance()
  const del = useDeleteInstance()

  // SSE: invalida lista quando estado de conexão muda no backend.
  useWhatsappConnectionStream()

  // Polling do status enquanto o QR está visível — detecta conexão sem esperar o refetch geral.
  const polling = useInstanceStatus(
    qrFlow?.instanceId ?? null,
    !!qrFlow && qrFlow.status === 'ready',
    3_000,
  )

  useEffect(() => {
    if (qrFlow?.status !== 'ready') return
    const state = polling.data?.state ?? ''
    if (state === 'open' || state === 'connected') {
      setQrFlow({ ...qrFlow, status: 'connected' })
      toast('WhatsApp conectado com sucesso!', 'success')
      void qc.invalidateQueries({ queryKey: ['instances'] })
      // Auto-limpa após 2s para o usuário ver o feedback de sucesso.
      const t = window.setTimeout(() => setQrFlow((curr) => (curr?.instanceId === qrFlow.instanceId ? null : curr)), 2_000)
      return () => window.clearTimeout(t)
    }
    return undefined
  }, [polling.data?.state, qrFlow, qc])

  // Expiração do QR (3 min)
  useEffect(() => {
    if (qrFlow?.status !== 'ready') return
    const remaining = QR_TTL_MS - (Date.now() - qrFlow.startedAt)
    if (remaining <= 0) {
      setQrFlow({ ...qrFlow, status: 'expired' })
      return
    }
    const t = window.setTimeout(() => {
      setQrFlow((curr) => (curr?.instanceId === qrFlow.instanceId && curr.status === 'ready'
        ? { ...curr, status: 'expired' }
        : curr))
    }, remaining)
    return () => window.clearTimeout(t)
  }, [qrFlow])

  function handleConnect(inst: WhatsAppInstance) {
    setQrFlow({ instanceId: inst.id, startedAt: Date.now(), status: 'loading' })
    connect.mutate(inst.id, {
      onSuccess: (r) => {
        const qr = (r as { qrcode?: unknown; base64?: string; pairingCode?: string }).qrcode
        const qrStr = typeof qr === 'string'
          ? qr
          : (qr && typeof qr === 'object' && 'base64' in qr ? (qr as { base64?: string }).base64 : undefined)
            ?? (r as { base64?: string }).base64
        if (qrStr) {
          setQrFlow({ instanceId: inst.id, qrcode: qrStr, startedAt: Date.now(), status: 'ready' })
        } else if (r.pairingCode) {
          setQrFlow({ instanceId: inst.id, pairingCode: r.pairingCode, startedAt: Date.now(), status: 'ready' })
        } else {
          // Pode já estar conectado
          setQrFlow(null)
          toast('Instância já conectada', 'info')
          void qc.invalidateQueries({ queryKey: ['instances'] })
        }
      },
      onError: (e: unknown) => {
        setQrFlow(null)
        toast((e as Error).message, 'danger')
      },
    })
  }

  function handleDisconnect(inst: WhatsAppInstance) {
    disconnect.mutate(inst.id, {
      onSuccess: () => {
        toast('Desconectado', 'success')
        if (qrFlow?.instanceId === inst.id) setQrFlow(null)
      },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function handleRestart(inst: WhatsAppInstance) {
    restart.mutate(inst.id, {
      onSuccess: () => toast('Instância reiniciada', 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function handleRefreshStatus() {
    void qc.invalidateQueries({ queryKey: ['instances'] })
    toast('Atualizando status…', 'info', 1_500)
  }

  return (
    <Page
      title="WhatsApp"
      description="Instâncias da Evolution API conectadas aos números WhatsApp."
      actions={
        <div class="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setShowHowItWorks(true)}>
            <HelpCircle size={14} /> Como funciona?
          </Button>
          <Button variant="ghost" size="sm" onClick={handleRefreshStatus} disabled={isFetching}>
            <RotateCcw size={14} class={isFetching ? 'animate-spin' : ''} /> Atualizar
          </Button>
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            <Plus size={14} /> Nova instância
          </Button>
        </div>
      }
    >
      {isLoading && (
        <div class="grid gap-3 grid-cols-1 sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} class="h-32 w-full" />)}
        </div>
      )}
      {!isLoading && data?.instances.length === 0 && (
        <EmptyState
          icon={<Phone size={24} />}
          title="Nenhuma instância"
          description="Crie uma instância para conectar um número WhatsApp."
          action={<Button size="sm" variant="primary" onClick={() => setCreating(true)}><Plus size={14} /> Criar primeira</Button>}
        />
      )}
      {!isLoading && data && data.instances.length > 0 && (
        <div class="grid gap-3 grid-cols-1 sm:grid-cols-2">
          {data.instances.map((inst) => (
            <InstanceCard
              key={inst.id}
              instance={inst}
              chatbots={chatbots?.chatbots ?? []}
              qrFlow={qrFlow?.instanceId === inst.id ? qrFlow : null}
              isConnecting={connect.isPending && qrFlow?.instanceId === inst.id}
              isDisconnecting={disconnect.isPending}
              isRestarting={restart.isPending}
              onConnect={() => handleConnect(inst)}
              onDisconnect={() => handleDisconnect(inst)}
              onRestart={() => handleRestart(inst)}
              onRefresh={handleRefreshStatus}
              onEdit={() => setEditing(inst)}
              onProfile={() => setProfileOf(inst)}
              onDelete={() => setDeleting(inst)}
              onCancelQr={() => setQrFlow(null)}
              onRetryQr={() => handleConnect(inst)}
            />
          ))}
        </div>
      )}

      {creating && <CreateInstanceModal onClose={() => setCreating(false)} />}
      {editing && <EditInstanceModal instance={editing} onClose={() => setEditing(null)} />}
      {profileOf && <BusinessProfileModal instance={profileOf} onClose={() => setProfileOf(null)} />}
      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(o) => { if (!o) setDeleting(null) }}
          title={`Excluir "${deleting.name}"`}
          description="A instância será removida da Evolution API e do banco. Mensagens ficarão arquivadas no lead."
          destructive
          confirmLabel="Excluir"
          loading={del.isPending}
          onConfirm={() => del.mutate(deleting.id, {
            onSuccess: () => { toast('Instância excluída', 'success'); setDeleting(null) },
            onError: (e: unknown) => toast((e as Error).message, 'danger'),
          })}
        />
      )}

      <HowItWorksModal
        open={showHowItWorks}
        onClose={() => setShowHowItWorks(false)}
        title="Como funciona o canal WhatsApp?"
        problem={<>
          Esta é a sua <strong>conexão com o WhatsApp comum (não-business)</strong> via Evolution API.
          Cada <em>instância</em> equivale a um número de WhatsApp ligado ao sistema, lendo e enviando
          mensagens em tempo real, como se fosse um celular pareado.
        </>}
        steps={[
          {
            title: '➕ Crie uma instância',
            body: <>Botão <strong>Nova instância</strong>: dê um nome (ex.: "Comercial SP"), defina o nome técnico (sem espaços) e equipe responsável. A instância aparece como <strong>desconectada</strong> esperando pareamento.</>,
          },
          {
            title: '📷 Escaneie o QR Code',
            body: <>Clique em <strong>Conectar</strong> — abre o QR. No WhatsApp do celular, vá em <em>Configurações › Aparelhos conectados › Conectar aparelho</em> e escaneie. Pronto: a instância fica online (Wi-Fi verde).</>,
          },
          {
            title: '👤 Configure o perfil',
            body: <>Botão de perfil edita: foto, nome de exibição, status. O que mudar aqui altera o perfil real do WhatsApp ao vivo.</>,
          },
          {
            title: '💬 Conversas chegam em "Conversas"',
            body: <>Quando alguém mandar mensagem pro número conectado, vira ticket em <strong>Conversas</strong>. O vendedor responde por lá — toda interação vira histórico do lead.</>,
          },
          {
            title: '🔌 Múltiplos números',
            body: <>Conecte vários números (um por unidade/equipe/funil). Cada instância tem fluxo, chatbot e equipe próprios. Se um desconectar (celular sem internet), o status pisca vermelho.</>,
          },
        ]}
        tip={{
          tone: 'warning',
          title: '⚠️ Importante',
          body: <>Esta integração usa <strong>WhatsApp comum</strong> via celular pareado. Pra envio em massa, oficial, com botões interativos e templates aprovados pelo Meta, use o <strong>WhatsApp Cloud API</strong> em vez disso. Cada um tem seu caso de uso.</>,
        }}
      />
    </Page>
  )
}

interface InstanceCardProps {
  instance: WhatsAppInstance
  chatbots: ChatbotItem[]
  qrFlow: QrFlow | null
  isConnecting: boolean
  isDisconnecting: boolean
  isRestarting: boolean
  onConnect: () => void
  onDisconnect: () => void
  onRestart: () => void
  onRefresh: () => void
  onEdit: () => void
  onProfile: () => void
  onDelete: () => void
  onCancelQr: () => void
  onRetryQr: () => void
}

function InstanceCard({
  instance: inst, chatbots, qrFlow,
  isConnecting, isDisconnecting, isRestarting,
  onConnect, onDisconnect, onRestart, onRefresh, onEdit, onProfile, onDelete,
  onCancelQr, onRetryQr,
}: InstanceCardProps) {
  const chatbotName = inst.chatbotId != null
    ? (chatbots.find((b) => b.id === inst.chatbotId)?.name ?? '—')
    : 'Nenhum'
  const phone = inst.ownerJid ? formatPhone(inst.ownerJid) : ''

  return (
    <Card class="group">
      <div class="flex items-start justify-between gap-2 mb-2">
        <div class="min-w-0 flex-1">
          <div class="text-sm font-medium text-fg truncate">{inst.name}</div>
          <div class="text-xs text-fg-muted font-mono truncate">
            {inst.instanceName}
            {phone && <span class="text-fg-subtle"> · {phone}</span>}
          </div>
        </div>
        <div class="flex flex-col items-end gap-1 shrink-0">
          <StatusBadge status={inst.status} />
          <Badge tone={inst.active ? 'accent' : 'neutral'}>{inst.active ? 'Ativa' : 'Inativa'}</Badge>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-2 text-[0.6875rem] text-fg-subtle mt-2 mb-2">
        <div>
          <div class="uppercase tracking-wider">Chatbot</div>
          <div class="text-fg-muted truncate">{chatbotName}</div>
        </div>
        <div>
          <div class="uppercase tracking-wider">Criada em</div>
          <div class="text-fg-muted">{formatDate(inst.createdAt)}</div>
        </div>
      </div>

      {qrFlow && <QrInline qrFlow={qrFlow} onCancel={onCancelQr} onRetry={onRetryQr} />}

      <div class="flex flex-wrap gap-2 mt-3">
        {(inst.status === 'disconnected' || inst.status === 'unknown' || inst.status === 'error') && !qrFlow ? (
          <Button variant="primary" size="sm" onClick={onConnect} disabled={isConnecting}>
            <Power size={12} /> {isConnecting ? 'Conectando…' : 'Conectar'}
          </Button>
        ) : null}
        {inst.status === 'connected' && (
          <>
            <Button variant="secondary" size="sm" onClick={onDisconnect} disabled={isDisconnecting}>
              <Power size={12} /> Desconectar
            </Button>
            <Button variant="ghost" size="sm" onClick={onProfile}>
              <User size={12} /> Perfil
            </Button>
          </>
        )}
        <Button variant="ghost" size="sm" onClick={onRestart} disabled={isRestarting}>
          <RefreshCw size={12} /> Reiniciar
        </Button>
        <Button variant="ghost" size="sm" onClick={onRefresh}>
          <RotateCcw size={12} /> Status
        </Button>
        <Button variant="ghost" size="sm" onClick={onEdit}>
          <Pencil size={12} /> Editar
        </Button>
        <button
          type="button"
          class="size-8 rounded-md grid place-items-center text-fg-muted hover:text-danger hover:bg-surface-3 ml-auto"
          onClick={onDelete}
          aria-label="Excluir"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </Card>
  )
}

function QrInline({ qrFlow, onCancel, onRetry }: { qrFlow: QrFlow; onCancel: () => void; onRetry: () => void }) {
  if (qrFlow.status === 'loading') {
    return (
      <div class="rounded-md border border-border bg-surface p-3 my-2 text-center">
        <div class="text-xs text-fg-muted">Gerando QR Code…</div>
      </div>
    )
  }

  if (qrFlow.status === 'connected') {
    return (
      <div class="rounded-md border border-accent bg-accent p-3 my-2 flex items-center justify-center gap-2">
        <CheckCircle2 size={16} class="text-fg-on-brand" />
        <div class="text-xs text-fg-on-brand">WhatsApp conectado</div>
      </div>
    )
  }

  if (qrFlow.status === 'expired') {
    return (
      <div class="rounded-md border border-warning/40 bg-warning/10 p-3 my-2 text-center">
        <div class="text-xs text-fg mb-2">QR Code expirado</div>
        <div class="flex gap-2 justify-center">
          <Button size="sm" variant="primary" onClick={onRetry}>
            <RefreshCw size={12} /> Gerar novo
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            <XIcon size={12} /> Fechar
          </Button>
        </div>
      </div>
    )
  }

  // ready
  if (qrFlow.qrcode) {
    const src = qrFlow.qrcode.startsWith('data:') ? qrFlow.qrcode : `data:image/png;base64,${qrFlow.qrcode}`
    return (
      <div class="rounded-md border border-border bg-surface p-3 my-2 text-center">
        <div class="flex justify-center">
          <img src={src} alt="QR code" class="size-48 rounded-md bg-white p-2" />
        </div>
        <div class="text-xs text-fg-muted mt-2">
          Abra o WhatsApp → Aparelhos conectados → Conectar aparelho
        </div>
        <div class="text-[0.6875rem] text-fg-subtle mt-1">
          Aguardando leitura… <CountdownLabel startedAt={qrFlow.startedAt} />
        </div>
        <div class="flex gap-2 justify-center mt-2">
          <Button size="sm" variant="ghost" onClick={onRetry}>
            <RefreshCw size={12} /> Gerar novo
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            <XIcon size={12} /> Cancelar
          </Button>
        </div>
      </div>
    )
  }

  if (qrFlow.pairingCode) {
    return (
      <div class="rounded-md border border-border bg-surface p-3 my-2 text-center">
        <div class="text-xs text-fg-muted mb-2">Código de pareamento</div>
        <div class="font-mono text-2xl tracking-widest text-fg">{qrFlow.pairingCode}</div>
        <div class="text-[0.6875rem] text-fg-subtle mt-2">
          No WhatsApp → Aparelhos conectados → Conectar com código
        </div>
        <div class="flex gap-2 justify-center mt-2">
          <Button size="sm" variant="ghost" onClick={onCancel}>
            <XIcon size={12} /> Cancelar
          </Button>
        </div>
      </div>
    )
  }

  return null
}

function CountdownLabel({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])
  const remaining = Math.max(0, QR_TTL_MS - (now - startedAt))
  const m = Math.floor(remaining / 60_000)
  const s = Math.floor((remaining % 60_000) / 1000)
  return <span>expira em {m}:{String(s).padStart(2, '0')}</span>
}

function StatusBadge({ status }: { status: WhatsAppInstance['status'] }) {
  if (status === 'connected') return <Badge tone="accent"><Wifi size={10} class="mr-1 inline" /> Conectada</Badge>
  if (status === 'disconnected') return <Badge tone="neutral"><WifiOff size={10} class="mr-1 inline" /> Desconectada</Badge>
  if (status === 'error') return <Badge tone="danger" solid><AlertCircle size={10} class="mr-1 inline" /> Erro</Badge>
  return <Badge tone="warning" solid>Verificando…</Badge>
}

function CreateInstanceModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('')
  const [instanceName, setInstanceName] = useState('')
  const [chatbotId, setChatbotId] = useState('')
  const [defaultTeamId, setDefaultTeamId] = useState('')
  const create = useCreateInstance()
  const { data: chatbots } = useChatbots()
  const { data: teams } = useTeams()

  function handleSubmit() {
    if (!name.trim() || !instanceName.trim()) {
      toast('Nome e instance name obrigatórios', 'danger')
      return
    }
    create.mutate({
      name: name.trim(),
      instanceName: instanceName.trim().toLowerCase().replace(/[^a-z0-9_-]/g, ''),
      chatbotId: chatbotId ? Number(chatbotId) : null,
      defaultTeamId: defaultTeamId ? Number(defaultTeamId) : null,
    }, {
      onSuccess: () => { toast('Instância criada. Agora clique em Conectar.', 'success'); onClose() },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Nova instância"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={create.isPending}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={create.isPending}>
            {create.isPending ? 'Criando…' : 'Criar'}
          </Button>
        </>
      }
    >
      <div class="space-y-3">
        <Input
          label="Nome amigável"
          value={name}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
          placeholder="Ex.: Vendas Brasil"
        />
        <Input
          label="Instance name (Evolution)"
          value={instanceName}
          onInput={(e) => setInstanceName((e.target as HTMLInputElement).value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
          placeholder="vendas_br"
          hint="Apenas letras minúsculas, números, hífen e underline. Identificador único na Evolution API."
        />
        <Select
          label="Chatbot vinculado"
          value={chatbotId}
          onChange={(e) => setChatbotId((e.target as HTMLSelectElement).value)}
          hint="Se vinculado, leads passam pelo chatbot antes de virar atendimento humano."
        >
          <option value="">Nenhum (sem automação)</option>
          {chatbots?.chatbots.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </Select>
        <Select
          label="Setor padrão"
          value={defaultTeamId}
          onChange={(e) => setDefaultTeamId((e.target as HTMLSelectElement).value)}
          hint="Para onde leads desta instância vão. Se vazio, usa o fallback global."
        >
          <option value="">— Usar fallback global —</option>
          {teams?.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
      </div>
    </Modal>
  )
}

function EditInstanceModal({ instance, onClose }: { instance: WhatsAppInstance; onClose: () => void }) {
  const [name, setName] = useState(instance.name)
  const [chatbotId, setChatbotId] = useState(instance.chatbotId != null ? String(instance.chatbotId) : '')
  const [funnelId, setFunnelId] = useState(instance.funnelId != null ? String(instance.funnelId) : '')
  const [stageKey, setStageKey] = useState(instance.stageKey ?? '')
  // Reforma F2: dono = setor OU agente, mutuamente exclusivos.
  const initialDonoTipo: 'team' | 'agent' | 'none' =
    instance.ownerUserId != null ? 'agent'
    : instance.defaultTeamId != null ? 'team'
    : 'none'
  const [donoTipo, setDonoTipo] = useState<'team' | 'agent' | 'none'>(initialDonoTipo)
  const [defaultTeamId, setDefaultTeamId] = useState(instance.defaultTeamId != null ? String(instance.defaultTeamId) : '')
  const [ownerUserId, setOwnerUserId] = useState(instance.ownerUserId != null ? String(instance.ownerUserId) : '')
  const [active, setActive] = useState(instance.active)
  const update = useUpdateInstance()
  const { data: chatbots } = useChatbots()
  const { data: teams } = useTeams()
  const { data: usersData } = useUsers()
  const eligibleAgents = (usersData?.users ?? []).filter(
    (u) => u.active && (u.role === 'AGENT' || u.role === 'MANAGER' || u.role === 'ADMIN' || u.role === 'SUPERADMIN'),
  )

  function handleSubmit() {
    if (!name.trim()) {
      toast('Nome é obrigatório', 'danger')
      return
    }
    if (donoTipo === 'team' && !defaultTeamId) {
      toast('Selecione um setor', 'danger')
      return
    }
    if (donoTipo === 'agent' && !ownerUserId) {
      toast('Selecione um agente', 'danger')
      return
    }
    update.mutate({
      id: instance.id,
      name: name.trim(),
      chatbotId: chatbotId ? Number(chatbotId) : null,
      defaultTeamId: donoTipo === 'team' ? Number(defaultTeamId) : null,
      ownerUserId: donoTipo === 'agent' ? Number(ownerUserId) : null,
      // Funil dos leads do chatbot (sem chatbot → sempre limpo).
      funnelId: chatbotId && funnelId ? Number(funnelId) : null,
      stageKey: chatbotId && funnelId && stageKey ? stageKey : null,
      active,
    }, {
      onSuccess: () => { toast('Instância atualizada', 'success'); onClose() },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Editar "${instance.name}"`}
      description={`Instance: ${instance.instanceName}`}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={update.isPending}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={update.isPending}>
            {update.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </>
      }
    >
      <div class="space-y-3">
        <Input label="Nome amigável" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
        <Select label="Chatbot vinculado" value={chatbotId} onChange={(e) => setChatbotId((e.target as HTMLSelectElement).value)}>
          <option value="">Sem chatbot</option>
          {chatbots?.chatbots.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </Select>
        {chatbotId && (
          <ConnectionFunnelPicker
            funnelId={funnelId ? Number(funnelId) : null}
            stageKey={stageKey || null}
            onSave={({ funnelId: f, stageKey: s }) => { setFunnelId(f ? String(f) : ''); setStageKey(s ?? '') }}
          />
        )}

        <div>
          <div class="text-sm font-medium text-fg mb-2">Dono da instância</div>
          <div class="flex gap-3 text-sm mb-2">
            <label class="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" name="dono" checked={donoTipo === 'team'} onChange={() => setDonoTipo('team')} />
              Setor
            </label>
            <label class="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" name="dono" checked={donoTipo === 'agent'} onChange={() => setDonoTipo('agent')} />
              Agente
            </label>
            <label class="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" name="dono" checked={donoTipo === 'none'} onChange={() => setDonoTipo('none')} />
              Sem dono
            </label>
          </div>
          {donoTipo === 'team' && (
            <Select value={defaultTeamId} onChange={(e) => setDefaultTeamId((e.target as HTMLSelectElement).value)}>
              <option value="">— Selecionar setor —</option>
              {teams?.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          )}
          {donoTipo === 'agent' && (
            <Select value={ownerUserId} onChange={(e) => setOwnerUserId((e.target as HTMLSelectElement).value)}>
              <option value="">— Selecionar agente —</option>
              {eligibleAgents.map((u) => (
                <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
              ))}
            </Select>
          )}
          <p class="text-xs text-fg-muted mt-1">
            {donoTipo === 'agent'
              ? 'Leads que chegarem por esta instância serão atribuídos direto ao agente.'
              : donoTipo === 'team'
              ? 'Leads serão roteados ao setor (round-robin conforme configuração).'
              : 'Sem amarração — leads caem na fila global do tenant.'}
          </p>
        </div>

        <label class="flex items-center gap-2 text-sm text-fg-muted">
          <input type="checkbox" checked={active} onChange={(e) => setActive((e.target as HTMLInputElement).checked)} />
          Instância ativa (recebe mensagens)
        </label>
      </div>
    </Modal>
  )
}

function BusinessProfileModal({ instance, onClose }: { instance: WhatsAppInstance; onClose: () => void }) {
  const { data, isLoading, error } = useBusinessProfile(instance.instanceName)
  const updName = useUpdateProfileName(instance.instanceName)
  const updStatus = useUpdateProfileStatus(instance.instanceName)
  const updPic = useUpdateProfilePicture(instance.instanceName)
  const remPic = useRemoveProfilePicture(instance.instanceName)

  const [name, setName] = useState('')
  const [status, setStatus] = useState('')
  const [pictureUrl, setPictureUrl] = useState('')
  const [uploading, setUploading] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (data) {
      setName(data.name ?? '')
      setStatus(data.status ?? '')
    }
  }, [data])

  if (instance.status !== 'connected') {
    return (
      <Modal
        open
        onOpenChange={(o) => { if (!o) onClose() }}
        title="Perfil indisponível"
        description="A instância precisa estar conectada para editar o perfil."
        footer={<Button variant="secondary" size="sm" onClick={onClose}>Fechar</Button>}
      >
        <div class="text-sm text-fg-muted">Conecte a instância e tente novamente.</div>
      </Modal>
    )
  }

  function saveName() {
    if (!name.trim()) { toast('Nome obrigatório', 'danger'); return }
    if (name.length > 25) { toast('Nome excede 25 caracteres', 'danger'); return }
    updName.mutate(name.trim(), {
      onSuccess: () => toast('Nome atualizado no WhatsApp', 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function saveStatus() {
    if (!status.trim()) { toast('Recado não pode ficar vazio', 'danger'); return }
    if (status.length > 139) { toast('Recado excede 139 caracteres', 'danger'); return }
    updStatus.mutate(status.trim(), {
      onSuccess: () => toast('Recado atualizado', 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function savePicture() {
    if (!pictureUrl.trim()) { toast('Informe a URL da imagem', 'danger'); return }
    updPic.mutate(pictureUrl.trim(), {
      onSuccess: () => { toast('Foto atualizada', 'success'); setPictureUrl('') },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  async function handleFileChange(ev: Event) {
    const input = ev.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast('Selecione um arquivo de imagem', 'danger')
      return
    }
    setUploading(true)
    try {
      const url = await uploadProfilePicture(file)
      setPictureUrl(url)
      toast('Imagem carregada — clique em Aplicar para salvar', 'success')
    } catch (e: unknown) {
      toast((e as Error).message || 'Falha no upload', 'danger')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function removePicture() {
    setConfirmRemove(true)
  }

  function confirmRemovePicture() {
    remPic.mutate(undefined, {
      onSuccess: () => { toast('Foto removida', 'success'); setConfirmRemove(false) },
      onError: (e: unknown) => { toast((e as Error).message, 'danger'); setConfirmRemove(false) },
    })
  }

  const phone = data?.phone ? formatPhone(data.phone) : ''

  return (
    <>
      <Modal
        open
        onOpenChange={(o) => { if (!o) onClose() }}
        title="Perfil WhatsApp Business"
        description={`Instance: ${instance.instanceName}`}
        size="lg"
        footer={<Button variant="secondary" size="sm" onClick={onClose}>Fechar</Button>}
      >
        {isLoading && <Skeleton class="h-48 w-full" />}
        {error && <div class="text-sm text-danger">Erro: {(error).message}</div>}
        {data && (
          <div class="space-y-5">
            {/* Header: avatar + nome em destaque + telefone + status */}
            <div class="flex items-center gap-4">
              <div class="size-20 rounded-full bg-surface-3 overflow-hidden grid place-items-center shrink-0 border border-border">
                {data.profilePicUrl
                  ? <img src={data.profilePicUrl} alt="" class="w-full h-full object-cover" />
                  : <ImageIcon size={28} class="text-fg-subtle" />}
              </div>
              <div class="min-w-0 flex-1">
                <div class="text-base font-semibold text-fg truncate">{data.name ?? 'Sem nome'}</div>
                <div class="text-xs text-fg-muted font-mono">{phone || '—'}</div>
                <div class="text-xs text-fg-subtle italic mt-0.5 truncate">{data.status ?? 'Sem recado'}</div>
                <div class="text-[0.6875rem] text-fg-subtle mt-1">
                  Tipo: {data.isBusiness ? <span class="text-accent font-medium">Business</span> : <span class="text-fg">Pessoal</span>}
                </div>
              </div>
            </div>

            {/* Nome do perfil */}
            <section>
              <div class="text-xs uppercase tracking-wider text-fg-subtle mb-1">Nome do perfil</div>
              <div class="flex gap-2">
                <Input
                  value={name}
                  maxLength={25}
                  onInput={(e) => setName((e.target as HTMLInputElement).value)}
                  placeholder="Seu nome ou marca"
                  class="flex-1"
                  hint={`${name.length}/25 caracteres`}
                />
                <Button size="sm" variant="primary" onClick={saveName} disabled={updName.isPending || name === (data.name ?? '')}>
                  {updName.isPending ? 'Salvando…' : 'Salvar'}
                </Button>
              </div>
            </section>

            {/* Recado/status */}
            <section>
              <div class="text-xs uppercase tracking-wider text-fg-subtle mb-1">Recado (status)</div>
              <Textarea
                value={status}
                maxLength={139}
                onInput={(e) => setStatus((e.target as HTMLTextAreaElement).value)}
                rows={2}
                placeholder="Texto exibido no perfil"
                hint={`${status.length}/139 caracteres`}
              />
              <div class="flex justify-end mt-2">
                <Button size="sm" variant="primary" onClick={saveStatus} disabled={updStatus.isPending || status === (data.status ?? '')}>
                  {updStatus.isPending ? 'Salvando…' : 'Salvar recado'}
                </Button>
              </div>
            </section>

            {/* Foto */}
            <section>
              <div class="text-xs uppercase tracking-wider text-fg-subtle mb-1">Foto do perfil</div>

              {/* Upload de arquivo */}
              <div class="flex items-center gap-2 mb-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  class="hidden"
                  onChange={handleFileChange}
                  disabled={uploading}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                >
                  <Upload size={12} /> {uploading ? 'Enviando…' : 'Enviar arquivo'}
                </Button>
                <span class="text-[0.6875rem] text-fg-subtle">JPG, PNG ou WebP. Máx 25 MB.</span>
              </div>

              {/* URL alternativa */}
              <div class="flex gap-2">
                <Input
                  value={pictureUrl}
                  onInput={(e) => setPictureUrl((e.target as HTMLInputElement).value)}
                  placeholder="Ou cole uma URL pública (jpg/png)"
                  class="flex-1"
                />
                <Button size="sm" variant="primary" onClick={savePicture} disabled={updPic.isPending || !pictureUrl.trim()}>
                  {updPic.isPending ? 'Aplicando…' : 'Aplicar'}
                </Button>
              </div>

              {data.profilePicUrl && (
                <div class="mt-2">
                  <button
                    type="button"
                    class="text-[0.6875rem] text-danger hover:underline"
                    onClick={removePicture}
                    disabled={remPic.isPending}
                  >
                    {remPic.isPending ? 'Removendo…' : 'Remover foto atual'}
                  </button>
                </div>
              )}
            </section>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Remover foto do perfil"
        description="A foto atual será substituída por uma imagem em branco. Você pode aplicar uma nova depois."
        destructive
        confirmLabel="Remover"
        loading={remPic.isPending}
        onConfirm={confirmRemovePicture}
      />
    </>
  )
}
