import { useState } from 'preact/hooks'
import { Plus, Info, Pencil, Send, ScrollText, Trash2, MoreHorizontal, AlertTriangle, Copy, Check } from '@/components/ui/icon-set'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  useWebhooks,
  useWebhookEvents,
  useCreateWebhook,
  useUpdateWebhook,
  useDeleteWebhook,
  useTestWebhook,
  useWebhookLogs,
  type Webhook,
  type WebhookInput,
  type WebhookLog,
} from '@/hooks/useWebhooks'
import { Skeleton } from '@/components/ui/Skeleton'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { toast } from '@/lib/toast'

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

export function WebhooksSettings() {
  const { data, isLoading } = useWebhooks()
  const [editing, setEditing] = useState<Webhook | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<Webhook | null>(null)
  const [viewingLogs, setViewingLogs] = useState<Webhook | null>(null)
  const [createdSecret, setCreatedSecret] = useState<{ secret: string; webhook: Webhook } | null>(null)
  const test = useTestWebhook()

  function handleTest(w: Webhook) {
    toast('Enviando teste...', 'info')
    test.mutate(w.id, {
      onSuccess: (r) => {
        if (r.success) {
          toast(`Teste OK — HTTP ${r.statusCode ?? '—'} (${r.duration ?? '?'}ms)`, 'success')
        } else {
          toast(`Teste falhou: ${r.error ?? `HTTP ${r.statusCode ?? 'erro'}`}`, 'danger')
        }
      },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  const webhooks = data?.data ?? []

  return (
    <div class="space-y-4">
      {/* Banner azul informativo */}
      <div class="rounded-lg border border-accent/30 bg-accent/10 px-4 py-3.5 flex items-start gap-2.5 text-sm text-accent">
        <Info size={16} class="shrink-0 mt-0.5" />
        <span>
          Webhooks enviam notificações HTTP (POST) para URLs externas quando eventos acontecem no CRM.
          Ideal para integrar com <strong>Zapier, Make, n8n</strong> ou sistemas próprios.
          Cada payload inclui assinatura <strong>HMAC-SHA256</strong> para validação.
        </span>
      </div>

      <div class="flex items-center justify-between">
        <div class="text-sm font-semibold text-fg">
          Webhooks · <span class="text-fg-muted font-normal">{webhooks.length} registros</span>
        </div>
        <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
          <Plus size={14} /> Novo webhook
        </Button>
      </div>

      {isLoading && <Skeleton class="h-32 w-full" />}

      {!isLoading && webhooks.length === 0 && (
        <div class="rounded-lg border border-border bg-surface-2 p-10 text-center text-sm text-fg-muted">
          Nenhum webhook configurado.
        </div>
      )}

      {!isLoading && webhooks.length > 0 && (
        <div class="rounded-lg border border-border bg-surface-2 overflow-hidden">
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="bg-surface text-fg-muted text-xs">
                <tr>
                  <th class="text-left px-4 py-2.5 font-semibold">Nome</th>
                  <th class="text-left px-4 py-2.5 font-semibold">URL</th>
                  <th class="text-left px-4 py-2.5 font-semibold">Eventos</th>
                  <th class="text-left px-4 py-2.5 font-semibold">Status</th>
                  <th class="text-left px-4 py-2.5 font-semibold">Entregas</th>
                  <th class="text-left px-4 py-2.5 font-semibold">Último envio</th>
                  <th class="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-border">
                {webhooks.map((w) => {
                  const evts = w.events ?? []
                  const evtLabel = evts.includes('*') ? 'Todos' : `${evts.length} evento${evts.length > 1 ? 's' : ''}`
                  const failRate = w.totalSent > 0 ? Math.round((w.totalFailed / w.totalSent) * 100) : 0
                  return (
                    <tr key={w.id} class="hover:bg-surface">
                      <td class="px-4 py-2.5 font-medium text-fg">{w.name}</td>
                      <td class="px-4 py-2.5 max-w-[12.5rem] truncate" title={w.url}>
                        <code class="px-1.5 py-0.5 rounded bg-surface text-xs text-fg-muted">{w.url}</code>
                      </td>
                      <td class="px-4 py-2.5 text-xs text-fg-muted">{evtLabel}</td>
                      <td class="px-4 py-2.5">
                        <span class="inline-flex items-center gap-1.5 text-xs">
                          <span class={`size-2 rounded-full ${w.active ? 'bg-success' : 'bg-danger'}`} />
                          {w.active ? 'Ativo' : 'Inativo'}
                        </span>
                      </td>
                      <td class="px-4 py-2.5 text-xs">
                        {w.totalSent.toLocaleString('pt-BR')}{' '}
                        <span class="text-fg-muted">({failRate}% falha)</span>
                      </td>
                      <td class="px-4 py-2.5 text-xs text-fg-muted whitespace-nowrap">
                        {formatBrDateTime(w.lastSentAt)}
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
                                onSelect={() => setEditing(w)}
                              >
                                <Pencil size={12} /> Editar
                              </DropdownMenu.Item>
                              <DropdownMenu.Item
                                class="px-3 py-1.5 flex items-center gap-2 text-fg hover:bg-surface-3 cursor-pointer outline-none"
                                onSelect={() => handleTest(w)}
                              >
                                <Send size={12} /> Enviar teste
                              </DropdownMenu.Item>
                              <DropdownMenu.Item
                                class="px-3 py-1.5 flex items-center gap-2 text-fg hover:bg-surface-3 cursor-pointer outline-none"
                                onSelect={() => setViewingLogs(w)}
                              >
                                <ScrollText size={12} /> Logs
                              </DropdownMenu.Item>
                              <DropdownMenu.Separator class="my-1 border-t border-border" />
                              <DropdownMenu.Item
                                class="px-3 py-1.5 flex items-center gap-2 text-danger hover:bg-surface-3 cursor-pointer outline-none"
                                onSelect={() => setDeleting(w)}
                              >
                                <Trash2 size={12} /> Excluir
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

      {(creating || editing) && (
        <WebhookFormModal
          webhook={editing}
          onClose={() => { setCreating(false); setEditing(null) }}
          onCreated={(secret, webhook) => {
            setCreating(false)
            setCreatedSecret({ secret, webhook })
          }}
        />
      )}
      {deleting && (
        <DeleteWebhookDialog webhook={deleting} onClose={() => setDeleting(null)} />
      )}
      {viewingLogs && (
        <WebhookLogsModal webhook={viewingLogs} onClose={() => setViewingLogs(null)} />
      )}
      {createdSecret && (
        <CreatedWebhookModal
          secret={createdSecret.secret}
          webhook={createdSecret.webhook}
          onClose={() => setCreatedSecret(null)}
        />
      )}
    </div>
  )
}

function WebhookFormModal({
  webhook, onClose, onCreated,
}: {
  webhook: Webhook | null
  onClose: () => void
  onCreated: (secret: string, webhook: Webhook) => void
}) {
  const isEdit = !!webhook
  const [name, setName] = useState(webhook?.name ?? '')
  const [url, setUrl] = useState(webhook?.url ?? '')
  const [events, setEvents] = useState<string[]>(webhook?.events ?? ['*'])
  const [active, setActive] = useState(webhook?.active ?? true)
  const [maxRetries, setMaxRetries] = useState(String(webhook?.maxRetries ?? 5))
  const [timeoutMs, setTimeoutMs] = useState(String(webhook?.timeoutMs ?? 30000))
  const [error, setError] = useState<string | null>(null)
  const { data: eventList } = useWebhookEvents()
  const create = useCreateWebhook()
  const update = useUpdateWebhook()
  const loading = create.isPending || update.isPending

  function toggleEvent(ev: string) {
    setEvents((es) => es.includes(ev) ? es.filter((x) => x !== ev) : [...es, ev])
  }

  function selectAll() {
    setEvents([...(eventList?.data ?? [])])
  }

  function selectNone() {
    setEvents([])
  }

  function handleSubmit() {
    setError(null)
    if (!name.trim()) { setError('Informe um nome.'); return }
    if (!url.trim()?.startsWith('http')) { setError('URL inválida. Deve começar com https://'); return }
    if (events.length === 0) { setError('Selecione pelo menos um evento.'); return }

    const retries = Math.max(0, Math.min(10, Number(maxRetries) || 0))
    const timeout = Math.max(5000, Math.min(60000, Number(timeoutMs) || 30000))

    const payload: WebhookInput = {
      name: name.trim(),
      url: url.trim(),
      events,
      active,
      maxRetries: retries,
      timeoutMs: timeout,
    }

    if (isEdit) {
      update.mutate({ id: webhook.id, ...payload }, {
        onSuccess: () => { toast('Webhook atualizado', 'success'); onClose() },
        onError: (e: unknown) => setError((e as Error).message || 'Erro ao salvar'),
      })
    } else {
      create.mutate(payload, {
        onSuccess: (r) => onCreated(r.data.secret, r.data),
        onError: (e: unknown) => setError((e as Error).message || 'Erro de conexão'),
      })
    }
  }

  const eventKeys = eventList?.data ?? []
  const eventLabels = eventList?.labels ?? {}

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={isEdit ? 'Editar Webhook' : 'Novo Webhook'}
      size="lg"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={loading}>
            {loading ? 'Salvando…' : (isEdit ? 'Salvar' : 'Criar Webhook')}
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
            placeholder="Ex: Zapier - Novos leads"
            class="w-full h-9 px-3 rounded-md bg-surface border border-border text-sm text-fg focus:outline-none focus:border-accent"
          />
        </div>
        <div>
          <label class="text-xs font-medium text-fg-muted block mb-1">URL de destino</label>
          <input
            type="url"
            value={url}
            onInput={(e) => setUrl((e.target as HTMLInputElement).value)}
            placeholder="https://hooks.zapier.com/..."
            class="w-full h-9 px-3 rounded-md bg-surface border border-border text-sm text-fg focus:outline-none focus:border-accent"
          />
        </div>

        <div class={`grid gap-3 ${isEdit ? 'grid-cols-3' : 'grid-cols-2'}`}>
          {isEdit && (
            <div>
              <label class="text-xs font-medium text-fg-muted block mb-1">Status</label>
              <select
                value={active ? 'true' : 'false'}
                onChange={(e) => setActive((e.target as HTMLSelectElement).value === 'true')}
                class="w-full h-9 px-3 rounded-md bg-surface border border-border text-sm text-fg focus:outline-none focus:border-accent"
              >
                <option value="true">Ativo</option>
                <option value="false">Inativo</option>
              </select>
            </div>
          )}
          <div>
            <label class="text-xs font-medium text-fg-muted block mb-1">Retentativas</label>
            <input
              type="number"
              min={0}
              max={10}
              value={maxRetries}
              onInput={(e) => setMaxRetries((e.target as HTMLInputElement).value)}
              class="w-full h-9 px-3 rounded-md bg-surface border border-border text-sm text-fg focus:outline-none focus:border-accent"
            />
          </div>
          <div>
            <label class="text-xs font-medium text-fg-muted block mb-1">Timeout (ms)</label>
            <input
              type="number"
              min={5000}
              max={60000}
              step={1000}
              value={timeoutMs}
              onInput={(e) => setTimeoutMs((e.target as HTMLInputElement).value)}
              class="w-full h-9 px-3 rounded-md bg-surface border border-border text-sm text-fg focus:outline-none focus:border-accent"
            />
          </div>
        </div>

        <div>
          <label class="text-xs font-medium text-fg-muted block mb-1.5">
            {isEdit ? 'Eventos' : 'Eventos que disparam o webhook'}
          </label>
          <div class="flex gap-1 mb-2">
            <button
              type="button"
              onClick={selectAll}
              class="px-2.5 py-1 rounded border border-border bg-transparent text-2xs text-accent cursor-pointer"
            >
              Todos
            </button>
            <button
              type="button"
              onClick={selectNone}
              class="px-2.5 py-1 rounded border border-border bg-transparent text-2xs text-fg-muted cursor-pointer"
            >
              Nenhum
            </button>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5 bg-surface border border-border rounded-md p-2.5 max-h-52 overflow-y-auto">
            {eventKeys.map((ev) => (
              <label key={ev} class="flex items-center gap-2 text-xs cursor-pointer py-0.5 text-fg">
                <input
                  type="checkbox"
                  checked={events.includes(ev)}
                  onChange={() => toggleEvent(ev)}
                />
                <span class="flex-1 truncate">{eventLabels[ev] ?? ev}</span>
                <span class="text-3xs text-fg-muted font-mono">{ev}</span>
              </label>
            ))}
          </div>
        </div>

        {error && <div class="text-xs text-danger">{error}</div>}
      </div>
    </Modal>
  )
}

function DeleteWebhookDialog({ webhook, onClose }: { webhook: Webhook; onClose: () => void }) {
  const del = useDeleteWebhook()
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Excluir "${webhook.name}"?`}
      description="Excluir este webhook? Todos os logs de entrega também serão removidos."
      destructive
      confirmLabel="Excluir"
      loading={del.isPending}
      onConfirm={() => del.mutate(webhook.id, {
        onSuccess: () => { toast('Webhook excluído', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })}
    />
  )
}

function WebhookLogsModal({ webhook, onClose }: { webhook: Webhook; onClose: () => void }) {
  const { data, isLoading } = useWebhookLogs(webhook.id, 100)
  const logs = data?.data ?? []
  const total = data?.total ?? 0

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Logs — ${webhook.name}`}
      size="lg"
      footer={<Button variant="secondary" size="sm" onClick={onClose}>Fechar</Button>}
    >
      {isLoading && <Skeleton class="h-32 w-full" />}
      {!isLoading && logs.length === 0 && (
        <div class="text-center py-7 text-sm text-fg-muted">Nenhum log registrado.</div>
      )}
      {!isLoading && logs.length > 0 && (
        <>
          <div class="max-h-[25rem] overflow-y-auto rounded-md border border-border">
            <table class="w-full text-xs">
              <thead class="bg-surface text-fg-muted">
                <tr>
                  <th class="text-left px-2.5 py-2 font-semibold">Evento</th>
                  <th class="text-left px-2.5 py-2 font-semibold">Status</th>
                  <th class="text-left px-2.5 py-2 font-semibold">Duração</th>
                  <th class="text-left px-2.5 py-2 font-semibold">Tentativa</th>
                  <th class="text-left px-2.5 py-2 font-semibold">Data</th>
                  <th class="text-left px-2.5 py-2 font-semibold">Erro</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-border">
                {logs.map((l) => <LogRow key={l.id} log={l} />)}
              </tbody>
            </table>
          </div>
          <div class="text-center text-2xs text-fg-muted mt-2.5">
            {logs.length} de {total} registros
          </div>
        </>
      )}
    </Modal>
  )
}

function LogRow({ log }: { log: WebhookLog }) {
  const sc = log.statusCode
  const statusText = log.success ? `✓ ${sc ?? ''}` : `✗ ${sc ?? 'ERR'}`
  return (
    <tr>
      <td class="px-2.5 py-2">
        <code class="px-1.5 py-0.5 rounded bg-surface text-2xs text-fg">{log.event}</code>
      </td>
      <td class={`px-2.5 py-2 font-semibold ${log.success ? 'text-success' : 'text-danger'}`}>
        {statusText}
      </td>
      <td class="px-2.5 py-2 text-fg-muted">
        {log.duration !== null ? `${log.duration}ms` : '—'}
      </td>
      <td class="px-2.5 py-2 text-fg-muted">#{log.attempt}</td>
      <td class="px-2.5 py-2 text-fg-muted whitespace-nowrap">{formatLogDateTime(log.createdAt)}</td>
      <td
        class="px-2.5 py-2 text-danger max-w-[12.5rem] overflow-hidden text-ellipsis whitespace-nowrap"
        title={log.error ?? undefined}
      >
        {log.error ?? '—'}
      </td>
    </tr>
  )
}

function CreatedWebhookModal({
  secret, webhook, onClose,
}: {
  secret: string
  webhook: Webhook
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)

  function copy() {
    void navigator.clipboard.writeText(secret).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Webhook criado"
      footer={<Button variant="secondary" size="sm" onClick={onClose}>Fechar</Button>}
    >
      <div class="space-y-3.5">
        <div class="rounded-lg border border-warning/40 bg-warning/10 px-3.5 py-3 flex items-start gap-2.5 text-sm text-warning">
          <AlertTriangle size={18} class="shrink-0 mt-0.5" />
          <span>
            Copie o <strong>secret</strong> abaixo. Use-o para validar a assinatura{' '}
            <code class="font-mono">X-Webhook-Signature</code> dos payloads recebidos.
          </span>
        </div>

        <div>
          <div class="text-xs font-medium text-fg-muted mb-1">Secret (HMAC-SHA256)</div>
          <div class="flex items-center gap-2">
            <input
              readOnly
              value={secret}
              class="flex-1 h-10 px-3 rounded-md bg-surface border border-border text-xs text-fg font-mono"
              onFocus={(e) => (e.target as HTMLInputElement).select()}
            />
            <Button variant="primary" size="md" onClick={copy}>
              {copied ? <><Check size={14} /> Copiado!</> : <><Copy size={14} /> Copiar</>}
            </Button>
          </div>
        </div>

        <div class="text-xs text-fg-muted space-y-0.5">
          <div><strong class="text-fg">Nome:</strong> {webhook.name}</div>
          <div class="break-all"><strong class="text-fg">URL:</strong> {webhook.url}</div>
          <div><strong class="text-fg">Eventos:</strong> {(webhook.events ?? []).length}</div>
        </div>
      </div>
    </Modal>
  )
}
