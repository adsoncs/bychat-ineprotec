import { useState } from 'preact/hooks'
import {
  Plus, Info, ExternalLink, Pencil, ScrollText, Trash2, MoreHorizontal,
  AlertTriangle, Copy, Check,
} from '@/components/ui/icon-set'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  useApiKeys,
  useCreateApiKey,
  useUpdateApiKey,
  useDeleteApiKey,
  useApiKeyLogs,
  type ApiKey,
  type ApiKeyLog,
} from '@/hooks/useApiKeys'
import { Skeleton } from '@/components/ui/Skeleton'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { toast } from '@/lib/toast'

const PERM_LABELS: Record<string, string> = {
  'leads:read': 'Leads (leitura)',
  'leads:write': 'Leads (escrita)',
  'tags:read': 'Tags (leitura)',
  'tags:write': 'Tags (escrita)',
  'funnels:read': 'Funis (leitura)',
  'funnels:write': 'Funis (escrita)',
  'stages:read': 'Etapas (leitura)',
  'stages:write': 'Etapas (escrita)',
  'activities:read': 'Atividades (leitura)',
  'activities:write': 'Atividades (escrita)',
  'contacts:read': 'Contatos (leitura)',
  'contacts:write': 'Contatos (escrita)',
  'webhooks:manage': 'Webhooks (gerenciar)',
}
const ALL_PERMS = Object.keys(PERM_LABELS)

function formatBrDateTime(s: string | null): string {
  if (!s) return 'Nunca'
  const d = new Date(s)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
    + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function formatLogDateTime(s: string): string {
  const d = new Date(s)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
    + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function ApiKeysSettings() {
  const { data, isLoading } = useApiKeys()
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<ApiKey | null>(null)
  const [deleting, setDeleting] = useState<ApiKey | null>(null)
  const [viewingLogs, setViewingLogs] = useState<ApiKey | null>(null)
  const [createdKey, setCreatedKey] = useState<{ key: string; apiKey: ApiKey } | null>(null)

  const keys = data?.data ?? []

  return (
    <div class="space-y-4">
      {/* Banner azul informativo */}
      <div class="rounded-lg border border-accent/30 bg-accent/10 px-4 py-3.5 flex items-start gap-2.5 text-sm text-accent">
        <Info size={16} class="shrink-0 mt-0.5" />
        <span>
          As API keys permitem acesso externo via <strong>/api/v1/</strong>.
          A chave completa só é exibida na criação — armazene-a com segurança.
        </span>
      </div>

      <div class="flex items-center justify-between">
        <div class="text-sm font-semibold text-fg">
          API Keys · <span class="text-fg-muted font-normal">{keys.length} registros</span>
        </div>
        <div class="flex items-center gap-2">
          <a
            href="/api-docs.html"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1.5 px-3 h-8 rounded-md border border-border bg-surface text-xs text-accent hover:bg-surface-3"
          >
            <ExternalLink size={12} /> Guia da API
          </a>
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            <Plus size={14} /> Nova API Key
          </Button>
        </div>
      </div>

      {isLoading && <Skeleton class="h-32 w-full" />}

      {!isLoading && keys.length === 0 && (
        <div class="rounded-lg border border-border bg-surface-2 p-10 text-center text-sm text-fg-muted">
          Nenhuma API key criada.
        </div>
      )}

      {!isLoading && keys.length > 0 && (
        <div class="rounded-lg border border-border bg-surface-2 overflow-hidden">
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="bg-surface text-fg-muted text-xs">
                <tr>
                  <th class="text-left px-4 py-2.5 font-semibold">Nome</th>
                  <th class="text-left px-4 py-2.5 font-semibold">Prefixo</th>
                  <th class="text-left px-4 py-2.5 font-semibold">Permissões</th>
                  <th class="text-left px-4 py-2.5 font-semibold">Rate Limit</th>
                  <th class="text-left px-4 py-2.5 font-semibold">Status</th>
                  <th class="text-left px-4 py-2.5 font-semibold">Uso</th>
                  <th class="text-left px-4 py-2.5 font-semibold">Último uso</th>
                  <th class="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-border">
                {keys.map((k) => {
                  const expired = !!k.expiresAt && new Date(k.expiresAt) < new Date()
                  const dotColor = !k.active ? 'bg-danger' : expired ? 'bg-warning' : 'bg-accent'
                  const statusText = !k.active ? 'Inativa' : expired ? 'Expirada' : 'Ativa'
                  const permCount = k.permissions.length
                  return (
                    <tr key={k.id} class="hover:bg-surface">
                      <td class="px-4 py-2.5 font-medium text-fg">{k.name}</td>
                      <td class="px-4 py-2.5">
                        <code class="px-2 py-0.5 rounded bg-surface text-xs text-fg">{k.prefix}...</code>
                      </td>
                      <td class="px-4 py-2.5 text-xs text-fg-muted">
                        {permCount} permiss{permCount === 1 ? 'ão' : 'ões'}
                      </td>
                      <td class="px-4 py-2.5 text-xs">{k.rateLimit}/min</td>
                      <td class="px-4 py-2.5">
                        <span class="inline-flex items-center gap-1.5 text-xs">
                          <span class={`size-2 rounded-full ${dotColor}`} />
                          {statusText}
                        </span>
                      </td>
                      <td class="px-4 py-2.5 text-xs text-fg-muted">
                        {k.totalCalls.toLocaleString('pt-BR')} chamadas
                      </td>
                      <td class="px-4 py-2.5 text-xs text-fg-muted whitespace-nowrap">
                        {formatBrDateTime(k.lastUsedAt)}
                      </td>
                      <td class="px-4 py-2.5 text-right whitespace-nowrap">
                        <DropdownMenu.Root>
                          <DropdownMenu.Trigger asChild>
                            <button
                              type="button"
                              class="inline-flex items-center gap-1 px-3 h-8 rounded-md bg-surface border border-border text-xs text-fg hover:bg-surface-3 cursor-pointer"
                            >
                              Opções <MoreHorizontal size={12} />
                            </button>
                          </DropdownMenu.Trigger>
                          <DropdownMenu.Portal>
                            <DropdownMenu.Content
                              class="rounded-md border border-border bg-surface-2 shadow-xl py-1 min-w-44 text-sm"
                              sideOffset={4}
                              align="end"
                            >
                              <DropdownMenu.Item
                                class="px-3 py-1.5 flex items-center gap-2 text-fg hover:bg-surface-3 cursor-pointer outline-none"
                                onSelect={() => setEditing(k)}
                              >
                                <Pencil size={12} /> Editar
                              </DropdownMenu.Item>
                              <DropdownMenu.Item
                                class="px-3 py-1.5 flex items-center gap-2 text-fg hover:bg-surface-3 cursor-pointer outline-none"
                                onSelect={() => setViewingLogs(k)}
                              >
                                <ScrollText size={12} /> Ver logs
                              </DropdownMenu.Item>
                              <DropdownMenu.Separator class="my-1 border-t border-border" />
                              <DropdownMenu.Item
                                class="px-3 py-1.5 flex items-center gap-2 text-danger hover:bg-surface-3 cursor-pointer outline-none"
                                onSelect={() => setDeleting(k)}
                              >
                                <Trash2 size={12} /> Revogar
                              </DropdownMenu.Item>
                            </DropdownMenu.Content>
                          </DropdownMenu.Portal>
                        </DropdownMenu.Root>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {creating && (
        <ApiKeyFormModal
          mode="create"
          onClose={() => setCreating(false)}
          onCreated={(key, apiKey) => { setCreating(false); setCreatedKey({ key, apiKey }) }}
        />
      )}
      {editing && (
        <ApiKeyFormModal mode="edit" apiKey={editing} onClose={() => setEditing(null)} />
      )}
      {deleting && <DeleteApiKeyDialog apiKey={deleting} onClose={() => setDeleting(null)} />}
      {viewingLogs && <ApiKeyLogsModal apiKey={viewingLogs} onClose={() => setViewingLogs(null)} />}
      {createdKey && (
        <CreatedApiKeyModal
          token={createdKey.key}
          apiKey={createdKey.apiKey}
          onClose={() => setCreatedKey(null)}
        />
      )}
    </div>
  )
}

function PermissionsPicker({
  selected, onSelected, idPrefix,
}: {
  selected: string[]
  onSelected: (perms: string[]) => void
  idPrefix: string
}) {
  function toggle(p: string) {
    onSelected(selected.includes(p) ? selected.filter((x) => x !== p) : [...selected, p])
  }
  function all() { onSelected([...ALL_PERMS]) }
  function none() { onSelected([]) }
  function readOnly() { onSelected(ALL_PERMS.filter((p) => p.endsWith(':read'))) }

  return (
    <div>
      <div class="flex gap-1 mb-2">
        <button type="button" onClick={all} class="px-2.5 py-1 rounded border border-border bg-transparent text-2xs text-accent cursor-pointer">Todas</button>
        <button type="button" onClick={none} class="px-2.5 py-1 rounded border border-border bg-transparent text-2xs text-fg-muted cursor-pointer">Nenhuma</button>
        <button type="button" onClick={readOnly} class="px-2.5 py-1 rounded border border-border bg-transparent text-2xs text-fg-muted cursor-pointer">Somente leitura</button>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5 bg-surface border border-border rounded-md p-2.5">
        {ALL_PERMS.map((p) => (
          <label key={p} class="flex items-center gap-2 text-sm cursor-pointer py-1 text-fg" for={`${idPrefix}-${p}`}>
            <input
              id={`${idPrefix}-${p}`}
              type="checkbox"
              checked={selected.includes(p)}
              onChange={() => toggle(p)}
            />
            <span>{PERM_LABELS[p]}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

function ApiKeyFormModal(props: {
  mode: 'create'
  onClose: () => void
  onCreated: (key: string, apiKey: ApiKey) => void
} | {
  mode: 'edit'
  apiKey: ApiKey
  onClose: () => void
}) {
  const isEdit = props.mode === 'edit'
  const apiKey = isEdit ? props.apiKey : null

  const [name, setName] = useState(apiKey?.name ?? '')
  const [perms, setPerms] = useState<string[]>(apiKey?.permissions ?? [...ALL_PERMS])
  const [rateLimit, setRateLimit] = useState(String(apiKey?.rateLimit ?? 60))
  const [active, setActive] = useState(apiKey?.active ?? true)
  const [expiresAt, setExpiresAt] = useState(apiKey?.expiresAt ? apiKey.expiresAt.substring(0, 10) : '')
  const [error, setError] = useState<string | null>(null)
  const create = useCreateApiKey()
  const update = useUpdateApiKey()
  const loading = create.isPending || update.isPending

  function handleSubmit() {
    setError(null)
    if (!name.trim()) {
      setError(isEdit ? 'Nome é obrigatório.' : 'Informe um nome para a key.')
      return
    }
    if (perms.length === 0) {
      setError('Selecione pelo menos uma permissão.')
      return
    }
    const rate = Math.max(1, Math.min(1000, Number(rateLimit) || 60))
    const payload = {
      name: name.trim(),
      rateLimit: rate,
      expiresAt: expiresAt ? expiresAt : null,
      permissions: perms,
    }

    if (isEdit) {
      update.mutate({ id: apiKey!.id, ...payload, active }, {
        onSuccess: () => { toast('API key atualizada', 'success'); props.onClose() },
        onError: (e: unknown) => setError((e as Error).message || 'Erro de conexão.'),
      })
    } else {
      create.mutate(payload, {
        onSuccess: (r) => props.onCreated(r.data.key, r.data),
        onError: (e: unknown) => setError((e as Error).message || 'Erro de conexão.'),
      })
    }
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) props.onClose() }}
      title={isEdit ? 'Editar API Key' : 'Nova API Key'}
      size="lg"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={props.onClose} disabled={loading}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={loading}>
            {loading ? 'Salvando…' : (isEdit ? 'Salvar' : 'Gerar API Key')}
          </Button>
        </>
      }
    >
      <div class="grid gap-3.5">
        <div>
          <label class="text-xs font-medium text-fg-muted block mb-1">Nome</label>
          <input
            type="text"
            value={name}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
            placeholder={isEdit ? '' : 'Ex: Integração Zapier'}
            class="w-full h-9 px-3 rounded-md bg-surface border border-border text-sm text-fg focus:outline-none focus:border-accent"
          />
        </div>

        <div class={`grid gap-3 ${isEdit ? 'grid-cols-3' : 'grid-cols-2'}`}>
          <div>
            <label class="text-xs font-medium text-fg-muted block mb-1">Rate limit (req/min)</label>
            <input
              type="number"
              min={1}
              max={1000}
              value={rateLimit}
              onInput={(e) => setRateLimit((e.target as HTMLInputElement).value)}
              class="w-full h-9 px-3 rounded-md bg-surface border border-border text-sm text-fg focus:outline-none focus:border-accent"
            />
          </div>
          {isEdit && (
            <div>
              <label class="text-xs font-medium text-fg-muted block mb-1">Status</label>
              <select
                value={active ? 'true' : 'false'}
                onChange={(e) => setActive((e.target as HTMLSelectElement).value === 'true')}
                class="w-full h-9 px-3 rounded-md bg-surface border border-border text-sm text-fg focus:outline-none focus:border-accent"
              >
                <option value="true">Ativa</option>
                <option value="false">Inativa</option>
              </select>
            </div>
          )}
          <div>
            <label class="text-xs font-medium text-fg-muted block mb-1">
              Expiração <span class="font-normal text-fg-muted">(opcional)</span>
            </label>
            <input
              type="date"
              value={expiresAt}
              onInput={(e) => setExpiresAt((e.target as HTMLInputElement).value)}
              class="w-full h-9 px-3 rounded-md bg-surface border border-border text-sm text-fg focus:outline-none focus:border-accent"
            />
          </div>
        </div>

        <div>
          <label class="text-xs font-medium text-fg-muted block mb-1.5">Permissões</label>
          <PermissionsPicker selected={perms} onSelected={setPerms} idPrefix={isEdit ? 'ake' : 'akc'} />
        </div>

        {error && <div class="text-xs text-danger">{error}</div>}
      </div>
    </Modal>
  )
}

function DeleteApiKeyDialog({ apiKey, onClose }: { apiKey: ApiKey; onClose: () => void }) {
  const del = useDeleteApiKey()
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Revogar "${apiKey.name}"?`}
      description="Tem certeza que deseja revogar esta API key? Todas as integrações que a usam pararão de funcionar."
      destructive
      confirmLabel="Revogar"
      loading={del.isPending}
      onConfirm={() => del.mutate(apiKey.id, {
        onSuccess: () => { toast('API key revogada', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })}
    />
  )
}

function ApiKeyLogsModal({ apiKey, onClose }: { apiKey: ApiKey; onClose: () => void }) {
  const { data, isLoading } = useApiKeyLogs(apiKey.id, 100)
  const logs = data?.data ?? []
  const total = data?.total ?? 0

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Logs — ${apiKey.name}`}
      size="lg"
      footer={<Button variant="secondary" size="sm" onClick={onClose}>Fechar</Button>}
    >
      {isLoading && <Skeleton class="h-32 w-full" />}
      {!isLoading && logs.length === 0 && (
        <div class="text-center py-7 text-sm text-fg-muted">Nenhum log registrado ainda.</div>
      )}
      {!isLoading && logs.length > 0 && (
        <>
          <div class="max-h-[25rem] overflow-y-auto rounded-md border border-border">
            <table class="w-full text-xs">
              <thead class="bg-surface text-fg-muted">
                <tr>
                  <th class="text-left px-2.5 py-2 font-semibold">Método</th>
                  <th class="text-left px-2.5 py-2 font-semibold">Rota</th>
                  <th class="text-left px-2.5 py-2 font-semibold">Status</th>
                  <th class="text-left px-2.5 py-2 font-semibold">Duração</th>
                  <th class="text-left px-2.5 py-2 font-semibold">IP</th>
                  <th class="text-left px-2.5 py-2 font-semibold">Data</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-border">
                {logs.map((l) => <ApiKeyLogRow key={l.id} log={l} />)}
              </tbody>
            </table>
          </div>
          <div class="text-center text-2xs text-fg-muted mt-2.5">
            Exibindo {logs.length} de {total} registros
          </div>
        </>
      )}
    </Modal>
  )
}

function ApiKeyLogRow({ log }: { log: ApiKeyLog }) {
  const statusColor = log.statusCode < 300 ? 'text-success'
    : log.statusCode < 400 ? 'text-warning'
    : 'text-danger'
  return (
    <tr>
      <td class="px-2.5 py-2">
        <code class="px-1.5 py-0.5 rounded bg-surface text-2xs font-semibold text-fg">{log.method}</code>
      </td>
      <td class="px-2.5 py-2 text-fg-muted max-w-[12.5rem] overflow-hidden text-ellipsis whitespace-nowrap" title={log.path}>
        {log.path}
      </td>
      <td class={`px-2.5 py-2 font-semibold ${statusColor}`}>{log.statusCode}</td>
      <td class="px-2.5 py-2 text-fg-muted">{log.duration}ms</td>
      <td class="px-2.5 py-2 text-fg-muted text-2xs">{log.ip}</td>
      <td class="px-2.5 py-2 text-fg-muted whitespace-nowrap">{formatLogDateTime(log.createdAt)}</td>
    </tr>
  )
}

function CreatedApiKeyModal({
  token, apiKey, onClose,
}: {
  token: string
  apiKey: ApiKey
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)

  function copy() {
    void navigator.clipboard.writeText(token).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="API Key criada com sucesso"
      footer={<Button variant="secondary" size="sm" onClick={onClose}>Fechar</Button>}
    >
      <div class="space-y-3.5">
        <div class="rounded-lg border border-warning/40 bg-warning/10 px-3.5 py-3 flex items-start gap-2.5 text-sm text-fg">
          <AlertTriangle size={18} class="shrink-0 mt-0.5 text-warning" />
          <span>
            Copie e armazene esta chave agora. Ela <strong>não será exibida novamente</strong>.
          </span>
        </div>

        <div class="flex items-center gap-2">
          <input
            readOnly
            value={token}
            class="flex-1 h-10 px-3 rounded-md bg-surface border border-border text-xs text-fg font-mono"
            onFocus={(e) => (e.target as HTMLInputElement).select()}
          />
          <Button variant="primary" size="md" onClick={copy}>
            {copied ? <><Check size={14} /> Copiado!</> : <><Copy size={14} /> Copiar</>}
          </Button>
        </div>

        <div class="text-xs text-fg-muted space-y-0.5">
          <div><strong class="text-fg">Nome:</strong> {apiKey.name}</div>
          <div><strong class="text-fg">Permissões:</strong> {apiKey.permissions.length}</div>
          <div><strong class="text-fg">Rate limit:</strong> {apiKey.rateLimit} req/min</div>
          {apiKey.expiresAt && (
            <div>
              <strong class="text-fg">Expira em:</strong>{' '}
              {new Date(apiKey.expiresAt).toLocaleDateString('pt-BR')}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
