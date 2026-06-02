import { useState } from 'preact/hooks'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  Server, Plus, Play, Square, RefreshCw, FileText, ExternalLink, Trash2, Lock, Copy, Check, MoreHorizontal,
} from 'lucide-preact'
import {
  useInstallations,
  useProvisionInstallation,
  useInstallationAction,
  useGenerateSSL,
  useInstallationLogs,
  useDeleteInstallation,
  type Installation,
  type ProvisionInput,
  type ProvisionResult,
  type InstAction,
} from '@/hooks/useInstallations'
import { useAuth } from '@/hooks/useAuth'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/cn'

export function InstallationsPage() {
  const { user } = useAuth()
  if (user?.role !== 'SUPERADMIN') {
    return (
      <Page title="Instalações">
        <EmptyState
          icon={<Server size={24} />}
          title="Acesso restrito"
          description="Apenas Super Administradores podem gerenciar instalações."
        />
      </Page>
    )
  }
  return <InstallationsContent />
}

function InstallationsContent() {
  const { data, isLoading } = useInstallations()
  const [creating, setCreating] = useState(false)
  const [logsOf, setLogsOf] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Installation | null>(null)
  const [provisionResult, setProvisionResult] = useState<ProvisionResult | null>(null)

  const items = data?.installations ?? []

  return (
    <Page
      title="Instalações"
      description="Provisionar, gerenciar e remover instalações cliente em subdomínios .bychat.ia.br."
      actions={
        <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
          <Plus size={14} /> Nova instalação
        </Button>
      }
    >
      {isLoading && (
        <div class="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} class="h-24 w-full" />)}
        </div>
      )}
      {!isLoading && items.length === 0 && (
        <EmptyState
          icon={<Server size={24} />}
          title="Nenhuma instalação encontrada"
          description="Crie a primeira para um cliente."
          action={<Button variant="primary" size="sm" onClick={() => setCreating(true)}><Plus size={14} /> Nova instalação</Button>}
        />
      )}
      {!isLoading && items.length > 0 && (
        <div class="grid gap-3 grid-cols-1">
          {items.map((i) => (
            <InstallationCard
              key={i.subdomain}
              inst={i}
              onLogs={() => setLogsOf(i.subdomain)}
              onDelete={() => setDeleting(i)}
            />
          ))}
        </div>
      )}

      {creating && (
        <NewInstallationModal
          onClose={() => setCreating(false)}
          onSuccess={(r) => { setCreating(false); setProvisionResult(r) }}
        />
      )}
      {provisionResult && (
        <ProvisionResultModal result={provisionResult} onClose={() => setProvisionResult(null)} />
      )}
      {logsOf && <LogsModal subdomain={logsOf} onClose={() => setLogsOf(null)} />}
      {deleting && <DeleteInstallationModal inst={deleting} onClose={() => setDeleting(null)} />}
    </Page>
  )
}

function InstallationCard({
  inst, onLogs, onDelete,
}: { inst: Installation; onLogs: () => void; onDelete: () => void }) {
  const action = useInstallationAction()
  const ssl = useGenerateSSL()

  const statusTone =
    inst.status === 'online' ? 'success' :
    inst.status === 'stopped' ? 'warning' : 'danger'
  const statusLabel =
    inst.status === 'online' ? 'Online' :
    inst.status === 'stopped' ? 'Parado' :
    inst.status === 'errored' ? 'Erro' : 'N/A'

  function handleAction(a: InstAction) {
    action.mutate({ subdomain: inst.subdomain, action: a }, {
      onSuccess: (r) => toast(r.ok ? `${a} OK` : (r.output || 'Erro'), r.ok ? 'success' : 'danger'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function handleSSL() {
    ssl.mutate(inst.subdomain, {
      onSuccess: (r) => {
        if (r.ok) toast('SSL ativado', 'success')
        else toast(`${r.error ?? 'Erro'}${r.detail ? ': ' + r.detail : ''}`, 'danger')
      },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function openSite() {
    window.open(`${inst.ssl ? 'https' : 'http'}://${inst.domain}`, '_blank', 'noreferrer')
  }

  return (
    <Card>
      <div class="flex flex-wrap items-start gap-3">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 flex-wrap mb-1">
            <span class={cn('inline-block size-2 rounded-full',
              inst.status === 'online' ? 'bg-success' :
              inst.status === 'stopped' ? 'bg-warning' : 'bg-danger')}
            />
            <span class="text-sm font-semibold text-fg truncate">{inst.domain}</span>
            <Badge tone={statusTone}>{statusLabel}</Badge>
            {inst.ssl ? <Badge tone="success">SSL</Badge> : (
              <button
                type="button"
                class="inline-flex items-center h-5 px-2 rounded-full text-[0.6875rem] font-medium bg-danger/15 text-danger hover:bg-danger/25"
                onClick={handleSSL}
                disabled={ssl.isPending}
              >
                <Lock size={10} /> Sem SSL
              </button>
            )}
            {inst.health ? <Badge tone="info">Health ✓</Badge> : <Badge tone="neutral">Health ✕</Badge>}
          </div>
          <div class="text-xs text-fg-muted flex flex-wrap gap-x-4 gap-y-0.5">
            <span>App: <code class="font-mono text-fg">{inst.appPort || '—'}</code></span>
            <span>MySQL: <code class="font-mono text-fg">{inst.mysqlPort || '—'}</code></span>
            <span class="truncate">PM2: <code class="font-mono text-fg">{inst.pm2Name}</code></span>
            {inst.createdAt && <span class="text-fg-subtle">Criado: {inst.createdAt}</span>}
          </div>
        </div>
        <div class="flex flex-wrap gap-1.5">
          {inst.status === 'online' ? (
            <Button variant="secondary" size="sm" onClick={() => handleAction('stop')} disabled={action.isPending}>
              <Square size={12} /> Parar
            </Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => handleAction('start')} disabled={action.isPending}>
              <Play size={12} /> Iniciar
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => handleAction('restart')} disabled={action.isPending}>
            <RefreshCw size={12} /> Restart
          </Button>
          <Button variant="secondary" size="sm" onClick={onLogs}>
            <FileText size={12} /> Logs
          </Button>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <Button variant="secondary" size="sm" iconOnly aria-label="Mais ações">
                <MoreHorizontal size={14} />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={6}
                class="min-w-[10rem] rounded-md bg-surface-2 border border-border shadow-lg p-1"
                style={{ zIndex: 'var(--z-popover)' }}
              >
                <DropdownMenu.Item
                  class="flex items-center gap-2 h-8 px-2 rounded-sm text-sm cursor-pointer hover:bg-surface-3 outline-none"
                  onSelect={openSite}
                >
                  <ExternalLink size={14} /> Abrir site
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  class="flex items-center gap-2 h-8 px-2 rounded-sm text-sm cursor-pointer hover:bg-surface-3 outline-none data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed"
                  onSelect={handleSSL}
                  disabled={ssl.isPending}
                >
                  <Lock size={14} /> Gerar SSL
                </DropdownMenu.Item>
                <DropdownMenu.Separator class="h-px bg-border my-1" />
                <DropdownMenu.Item
                  class="flex items-center gap-2 h-8 px-2 rounded-sm text-sm cursor-pointer hover:bg-surface-3 text-danger outline-none"
                  onSelect={onDelete}
                >
                  <Trash2 size={14} /> Desinstalar
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>
    </Card>
  )
}

function NewInstallationModal({
  onClose, onSuccess,
}: { onClose: () => void; onSuccess: (r: ProvisionResult) => void }) {
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [subdomain, setSubdomain] = useState('')
  const [adminEmail, setAdminEmail] = useState('')
  const [adminPass, setAdminPass] = useState('')
  const [evolutionUrl, setEvolutionUrl] = useState('')
  const [evolutionKey, setEvolutionKey] = useState('')
  const [evolutionInstance, setEvolutionInstance] = useState('')
  const [whatsappNumber, setWhatsappNumber] = useState('')
  const [resendKey, setResendKey] = useState('')
  const [anthropicKey, setAnthropicKey] = useState('')
  const [openaiKey, setOpenaiKey] = useState('')

  const provision = useProvisionInstallation()

  function handleSubmit() {
    const sub = subdomain.toLowerCase().replace(/[^a-z0-9-]/g, '')
    if (!sub || sub.length < 2) {
      toast('Subdomínio inválido (mínimo 2 caracteres, só letras/números/hífen)', 'danger')
      return
    }
    const input: ProvisionInput = { subdomain: sub }
    if (adminEmail.trim()) input.adminEmail = adminEmail.trim()
    if (adminPass.trim()) input.adminPass = adminPass.trim()
    if (evolutionUrl.trim()) input.evolutionUrl = evolutionUrl.trim()
    if (evolutionKey.trim()) input.evolutionKey = evolutionKey.trim()
    if (evolutionInstance.trim()) input.evolutionInstance = evolutionInstance.trim()
    if (whatsappNumber.trim()) input.whatsappNumber = whatsappNumber.trim()
    if (resendKey.trim()) input.resendKey = resendKey.trim()
    if (anthropicKey.trim()) input.anthropicKey = anthropicKey.trim()
    if (openaiKey.trim()) input.openaiKey = openaiKey.trim()

    provision.mutate(input, {
      onSuccess: (r) => onSuccess(r),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o && !provision.isPending) onClose() }}
      title="Nova instalação"
      description="Cria container MySQL, configura Nginx, PM2 e tenta gerar SSL. Leva ~1-2 min."
      size="lg"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={provision.isPending}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={provision.isPending}>
            {provision.isPending ? 'Provisionando…' : 'Criar instalação'}
          </Button>
        </>
      }
    >
      <div class="space-y-3">
        <div>
          <span class="text-xs font-medium text-fg-muted">Subdomínio *</span>
          <div class="flex items-stretch mt-1">
            <input
              type="text"
              value={subdomain}
              onInput={(e) => setSubdomain((e.target as HTMLInputElement).value)}
              placeholder="cliente1"
              class="flex-1 h-9 px-3 rounded-l-md bg-surface border border-border text-sm text-fg focus:outline-none focus:border-accent"
            />
            <span class="inline-flex items-center px-3 rounded-r-md bg-surface-3 border border-l-0 border-border text-sm text-fg-muted">
              .bychat.ia.br
            </span>
          </div>
          <span class="text-[0.6875rem] text-fg-subtle">Apenas letras, números e hífen.</span>
        </div>

        <button
          type="button"
          class="text-xs text-accent hover:underline"
          onClick={() => setShowAdvanced((v) => !v)}
        >
          {showAdvanced ? 'Ocultar opções avançadas' : 'Mostrar opções avançadas'}
        </button>

        {showAdvanced && (
          <div class="space-y-3 pt-2 border-t border-border">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="Email do admin"
                value={adminEmail}
                onInput={(e) => setAdminEmail((e.target as HTMLInputElement).value)}
                placeholder="admin@bychat.ia.br"
                hint="Default: admin@bychat.ia.br"
              />
              <Input
                label="Senha do admin"
                value={adminPass}
                onInput={(e) => setAdminPass((e.target as HTMLInputElement).value)}
                placeholder="auto-gerada se vazio"
                type="password"
              />
            </div>

            <details class="rounded-md border border-border p-3">
              <summary class="text-xs font-medium text-fg-muted cursor-pointer">Evolution API</summary>
              <div class="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input label="URL" value={evolutionUrl} onInput={(e) => setEvolutionUrl((e.target as HTMLInputElement).value)} placeholder="https://..." />
                <Input label="API Key" value={evolutionKey} onInput={(e) => setEvolutionKey((e.target as HTMLInputElement).value)} type="password" />
                <Input label="Instance" value={evolutionInstance} onInput={(e) => setEvolutionInstance((e.target as HTMLInputElement).value)} />
                <Input label="WhatsApp number" value={whatsappNumber} onInput={(e) => setWhatsappNumber((e.target as HTMLInputElement).value)} placeholder="5511..." />
              </div>
            </details>

            <details class="rounded-md border border-border p-3">
              <summary class="text-xs font-medium text-fg-muted cursor-pointer">APIs externas (opcional)</summary>
              <div class="mt-3 grid grid-cols-1 gap-3">
                <Input label="Resend API Key" value={resendKey} onInput={(e) => setResendKey((e.target as HTMLInputElement).value)} type="password" hint="Para envio de emails" />
                <Input label="Anthropic API Key" value={anthropicKey} onInput={(e) => setAnthropicKey((e.target as HTMLInputElement).value)} type="password" hint="Claude" />
                <Input label="OpenAI API Key" value={openaiKey} onInput={(e) => setOpenaiKey((e.target as HTMLInputElement).value)} type="password" />
              </div>
            </details>
          </div>
        )}

        {provision.isPending && (
          <div class="rounded-md border border-info/30 bg-info/10 p-3 text-xs text-info">
            Provisionando… isso pode levar 1-2 min. Não feche o modal.
          </div>
        )}
      </div>
    </Modal>
  )
}

function ProvisionResultModal({
  result, onClose,
}: { result: ProvisionResult; onClose: () => void }) {
  const c = result.credentials
  const [copiedField, setCopiedField] = useState<string | null>(null)

  function copy(field: string, val: string) {
    void navigator.clipboard.writeText(val).then(() => {
      setCopiedField(field)
      setTimeout(() => setCopiedField(null), 1500)
    })
  }

  function CopyRow({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
    return (
      <div class="grid grid-cols-3 gap-2 text-xs items-center">
        <span class="text-fg-muted">{label}</span>
        <code class="col-span-2 font-mono text-fg bg-surface-3 px-2 py-1 rounded flex items-center justify-between gap-2">
          <span class={cn('truncate', secret && copiedField !== label && 'select-none')}>
            {secret && copiedField !== label ? '••••••••' : value}
          </span>
          <button
            type="button"
            class="text-fg-muted hover:text-accent shrink-0"
            onClick={() => copy(label, value)}
            aria-label={`Copiar ${label}`}
          >
            {copiedField === label ? <Check size={12} /> : <Copy size={12} />}
          </button>
        </code>
      </div>
    )
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Instalação criada"
      description="Anote as credenciais — não serão mostradas de novo."
      size="lg"
      footer={
        <>
          <Button variant="primary" size="sm" onClick={onClose}>Fechar</Button>
        </>
      }
    >
      <div class="space-y-4">
        <div class="rounded-md border border-success/30 bg-success/10 p-3 text-xs text-success flex items-start gap-2">
          <Check size={14} class="mt-0.5 shrink-0" />
          <div class="flex-1">
            <strong>{c.subdomain}.bychat.ia.br</strong> está {c.health ? 'online e saudável' : 'configurado'}.
            <div class="mt-1">
              SSL: {c.ssl ? '✓ ativo' : '✕ ainda não emitido'}{!c.dnsOk && ' (DNS não resolve para este servidor)'}
            </div>
          </div>
        </div>

        <div class="space-y-1.5">
          <div class="text-xs uppercase tracking-wider text-fg-subtle font-medium">Acesso</div>
          <CopyRow label="URL" value={c.url} />
          <CopyRow label="Admin email" value={c.adminEmail} />
          <CopyRow label="Admin senha" value={c.adminPass} secret />
        </div>

        <div class="space-y-1.5">
          <div class="text-xs uppercase tracking-wider text-fg-subtle font-medium">Banco de dados</div>
          <CopyRow label="MySQL host" value="127.0.0.1" />
          <CopyRow label="MySQL porta" value={String(c.mysqlPort)} />
          <CopyRow label="MySQL user" value={c.mysqlUser} />
          <CopyRow label="MySQL senha" value={c.mysqlPass} secret />
          <CopyRow label="MySQL root" value={c.mysqlRootPass} secret />
        </div>

        <div class="space-y-1.5">
          <div class="text-xs uppercase tracking-wider text-fg-subtle font-medium">Infra</div>
          <CopyRow label="Diretório" value={c.dir} />
          <CopyRow label="App porta" value={String(c.appPort)} />
          <CopyRow label="PM2 name" value={c.pm2Name} />
          <CopyRow label="MySQL container" value={c.mysqlContainer} />
          <CopyRow label="Server IP" value={c.serverIp} />
        </div>

        {result.logs.length > 0 && (
          <details class="rounded-md border border-border bg-surface">
            <summary class="cursor-pointer px-3 py-2 text-xs font-medium text-fg-muted">Logs do provisionamento</summary>
            <pre class="text-[0.6875rem] font-mono text-fg-muted p-3 overflow-auto max-h-60 border-t border-border">
              {result.logs.join('\n')}
            </pre>
          </details>
        )}
      </div>
    </Modal>
  )
}

function LogsModal({ subdomain, onClose }: { subdomain: string; onClose: () => void }) {
  const { data, isLoading, refetch, isFetching } = useInstallationLogs(subdomain)

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Logs — bychat-${subdomain}`}
      size="xl"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>Fechar</Button>
          <Button variant="primary" size="sm" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw size={12} class={isFetching ? 'animate-spin' : ''} /> Atualizar
          </Button>
        </>
      }
    >
      {isLoading ? (
        <Skeleton class="h-64 w-full" />
      ) : (
        <pre class="text-[0.6875rem] font-mono text-fg-muted bg-surface border border-border rounded-md p-3 overflow-auto max-h-[60vh] whitespace-pre-wrap break-all">
          {data?.logs ?? 'Sem logs.'}
        </pre>
      )}
    </Modal>
  )
}

function DeleteInstallationModal({ inst, onClose }: { inst: Installation; onClose: () => void }) {
  const [confirmText, setConfirmText] = useState('')
  const [step, setStep] = useState<'warn' | 'confirm'>('warn')
  const del = useDeleteInstallation()

  const matches = confirmText.trim().toLowerCase() === inst.subdomain.toLowerCase()

  function handleDelete() {
    if (!matches) return
    del.mutate(inst.subdomain, {
      onSuccess: (r) => { toast(`Removida (${r.steps.length} etapas)`, 'success'); onClose() },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  if (step === 'warn') {
    return (
      <ConfirmDialog
        open
        onOpenChange={(o) => { if (!o) onClose() }}
        title={`Desinstalar ${inst.domain}`}
        description="Vai remover container MySQL (incluindo dados!), config Nginx, PM2, diretório e SSL. Esta ação NÃO pode ser desfeita."
        destructive
        confirmLabel="Tenho certeza, continuar"
        onConfirm={() => setStep('confirm')}
      />
    )
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Confirmação final"
      size="md"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={del.isPending}>Cancelar</Button>
          <Button variant="danger" size="sm" onClick={handleDelete} disabled={!matches || del.isPending}>
            {del.isPending ? 'Removendo…' : 'Desinstalar definitivamente'}
          </Button>
        </>
      }
    >
      <div class="space-y-3">
        <p class="text-sm text-fg">
          Para confirmar, digite o subdomínio <code class="font-mono text-fg-muted">{inst.subdomain}</code>:
        </p>
        <Input
          value={confirmText}
          onInput={(e) => setConfirmText((e.target as HTMLInputElement).value)}
          placeholder={inst.subdomain}
          autoFocus
        />
      </div>
    </Modal>
  )
}

