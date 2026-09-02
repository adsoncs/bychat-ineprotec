import { useEffect, useMemo, useState } from 'preact/hooks'
import {
  Plus, Info, Pencil, ScrollText, Trash2, MoreHorizontal,
  Copy, Check, RefreshCw, X, Wand2,
} from '@/components/ui/icon-set'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  useInboundWebhooks,
  useInboundWebhookLeadFields,
  useInboundWebhookLastPayload,
  useInboundWebhookHits,
  useCreateInboundWebhook,
  useUpdateInboundWebhook,
  useDeleteInboundWebhook,
  useRegenerateInboundToken,
  type InboundWebhook,
  type InboundWebhookInput,
  type InboundMappingRule,
  type LeadFieldOption,
} from '@/hooks/useInboundWebhooks'
import { useFunnels, useStages } from '@/hooks/useFunnels'
import { useTeams } from '@/hooks/useTeams'
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

function buildUrl(token: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}/api/inbound/${token}`
}

// ── List ────────────────────────────────────────
export function InboundWebhooks() {
  const { data, isLoading } = useInboundWebhooks()
  const [editing, setEditing] = useState<InboundWebhook | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<InboundWebhook | null>(null)
  const [viewingHits, setViewingHits] = useState<InboundWebhook | null>(null)
  const [copiedId, setCopiedId] = useState<number | null>(null)
  const regenerate = useRegenerateInboundToken()

  const webhooks = data?.data ?? []

  function copyUrl(w: InboundWebhook) {
    const url = buildUrl(w.token)
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(w.id)
      toast('URL copiada', 'success')
      setTimeout(() => setCopiedId(null), 1800)
    })
  }

  function handleRegenerate(w: InboundWebhook) {
    if (!confirm(`Gerar novo token para "${w.name}"? A URL atual deixará de funcionar imediatamente.`)) return
    regenerate.mutate(w.id, {
      onSuccess: () => toast('Token regenerado', 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <div class="space-y-4">
      <div class="rounded-lg border border-accent/30 bg-accent/10 px-4 py-3.5 flex items-start gap-2.5 text-sm text-accent">
        <Info size={16} class="shrink-0 mt-0.5" />
        <span>
          Cada webhook tem uma URL única. Configure essa URL no <strong>Make, n8n, Zapier</strong> ou em qualquer sistema externo.
          Defina o mapeamento <strong>JSONPath → Campo do Lead</strong> pra transformar o payload recebido em um Lead novo automaticamente.
        </span>
      </div>

      <div class="flex items-center justify-between">
        <div class="text-sm font-semibold text-fg">
          Webhooks de Entrada · <span class="text-fg-muted font-normal">{webhooks.length} registros</span>
        </div>
        <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
          <Plus size={14} /> Novo webhook
        </Button>
      </div>

      {isLoading && <Skeleton class="h-32 w-full" />}

      {!isLoading && webhooks.length === 0 && (
        <div class="rounded-lg border border-border bg-surface-2 p-10 text-center text-sm text-fg-muted">
          Nenhum webhook de entrada configurado. Crie o primeiro pra começar a receber dados.
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
                  <th class="text-left px-4 py-2.5 font-semibold">Status</th>
                  <th class="text-left px-4 py-2.5 font-semibold">Mapeamento</th>
                  <th class="text-left px-4 py-2.5 font-semibold">Recebidos</th>
                  <th class="text-left px-4 py-2.5 font-semibold">Último</th>
                  <th class="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-border">
                {webhooks.map((w) => {
                  const url = buildUrl(w.token)
                  const mappingCount = Array.isArray(w.mapping) ? w.mapping.length : 0
                  return (
                    <tr key={w.id} class="hover:bg-surface">
                      <td class="px-4 py-2.5 font-medium text-fg">{w.name}</td>
                      <td class="px-4 py-2.5">
                        <button
                          type="button"
                          onClick={() => copyUrl(w)}
                          class="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-surface border border-border text-xs text-fg-muted hover:text-fg cursor-pointer max-w-[18rem]"
                          title={url}
                        >
                          {copiedId === w.id ? <Check size={12} class="text-success" /> : <Copy size={12} />}
                          <code class="truncate font-mono">{url}</code>
                        </button>
                      </td>
                      <td class="px-4 py-2.5">
                        <span class="inline-flex items-center gap-1.5 text-xs">
                          <span class={`size-2 rounded-full ${w.active ? 'bg-success' : 'bg-danger'}`} />
                          {w.active ? 'Ativo' : 'Inativo'}
                        </span>
                      </td>
                      <td class="px-4 py-2.5 text-xs text-fg-muted">
                        {mappingCount === 0
                          ? <span class="text-warning">Sem mapping</span>
                          : `${mappingCount} regra${mappingCount > 1 ? 's' : ''}`}
                      </td>
                      <td class="px-4 py-2.5 text-xs">
                        {w.totalReceived.toLocaleString('pt-BR')}
                        {w.totalErrors > 0 && (
                          <span class="text-danger ml-1">({w.totalErrors} erros)</span>
                        )}
                      </td>
                      <td class="px-4 py-2.5 text-xs text-fg-muted whitespace-nowrap">
                        {formatBrDateTime(w.lastReceivedAt)}
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
                                onSelect={() => setTimeout(() => setEditing(w), 0)}
                              >
                                <Pencil size={12} /> Editar / Mapeamento
                              </DropdownMenu.Item>
                              <DropdownMenu.Item
                                class="px-3 py-1.5 flex items-center gap-2 text-fg hover:bg-surface-3 cursor-pointer outline-none"
                                onSelect={() => setTimeout(() => setViewingHits(w), 0)}
                              >
                                <ScrollText size={12} /> Histórico de recebimentos
                              </DropdownMenu.Item>
                              <DropdownMenu.Item
                                class="px-3 py-1.5 flex items-center gap-2 text-fg hover:bg-surface-3 cursor-pointer outline-none"
                                onSelect={() => setTimeout(() => handleRegenerate(w), 0)}
                              >
                                <RefreshCw size={12} /> Regenerar token
                              </DropdownMenu.Item>
                              <DropdownMenu.Separator class="my-1 border-t border-border" />
                              <DropdownMenu.Item
                                class="px-3 py-1.5 flex items-center gap-2 text-danger hover:bg-surface-3 cursor-pointer outline-none"
                                onSelect={() => setTimeout(() => setDeleting(w), 0)}
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
        <InboundWebhookFormModal
          webhook={editing}
          onClose={() => { setCreating(false); setEditing(null) }}
        />
      )}
      {deleting && (
        <DeleteDialog webhook={deleting} onClose={() => setDeleting(null)} />
      )}
      {viewingHits && (
        <HitsModal webhook={viewingHits} onClose={() => setViewingHits(null)} />
      )}
    </div>
  )
}

// ── Form Modal ──────────────────────────────────
function InboundWebhookFormModal({
  webhook, onClose,
}: { webhook: InboundWebhook | null; onClose: () => void }) {
  const isEdit = !!webhook
  const [name, setName] = useState(webhook?.name ?? '')
  const [description, setDescription] = useState(webhook?.description ?? '')
  const [active, setActive] = useState(webhook?.active ?? true)
  const [defaultFunnelId, setDefaultFunnelId] = useState<string>(webhook?.defaultFunnelId ? String(webhook.defaultFunnelId) : '')
  const [defaultStageKey, setDefaultStageKey] = useState<string>(webhook?.defaultStageKey ?? '')
  const [defaultTeamId, setDefaultTeamId] = useState<string>(webhook?.defaultTeamId ? String(webhook.defaultTeamId) : '')
  const [defaultSource, setDefaultSource] = useState<string>(webhook?.defaultSource ?? '')
  const [mapping, setMapping] = useState<InboundMappingRule[]>(
    Array.isArray(webhook?.mapping) && webhook!.mapping.length > 0
      ? webhook!.mapping
      : [{ source: '', target: '' }],
  )
  const [error, setError] = useState<string | null>(null)

  const { data: funnels } = useFunnels()
  const { data: stagesData } = useStages(defaultFunnelId ? Number(defaultFunnelId) : null)
  const { data: teams } = useTeams()
  const { data: fields } = useInboundWebhookLeadFields()
  const lastPayload = useInboundWebhookLastPayload(webhook?.id ?? null)

  const create = useCreateInboundWebhook()
  const update = useUpdateInboundWebhook()
  const loading = create.isPending || update.isPending

  // Sugere chaves do último payload (flat-leaf) pra ajudar
  const suggestedKeys = useMemo(() => {
    const p = lastPayload.data?.payload
    if (!p || typeof p !== 'object') return [] as string[]
    const out: string[] = []
    const walk = (o: any, prefix = '') => {
      if (out.length > 80) return
      if (Array.isArray(o)) {
        if (o.length > 0) walk(o[0], `${prefix}[0]`)
      } else if (o && typeof o === 'object') {
        for (const k of Object.keys(o)) {
          const nk = prefix ? `${prefix}.${k}` : k
          const v = o[k]
          if (v && typeof v === 'object') walk(v, nk)
          else out.push(nk)
        }
      }
    }
    walk(p)
    return out
  }, [lastPayload.data])

  function updateRule(idx: number, patch: Partial<InboundMappingRule>) {
    setMapping((m) => m.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }
  function addRule() { setMapping((m) => [...m, { source: '', target: '' }]) }
  function removeRule(idx: number) { setMapping((m) => m.filter((_, i) => i !== idx)) }

  function autoSuggestMapping() {
    if (!suggestedKeys.length || !fields) {
      toast('Receba pelo menos um payload pra usar a sugestão automática', 'info')
      return
    }
    const guesses: InboundMappingRule[] = []
    // Delimitador `[\W_]` aceita `.`, `_`, `-`, `[`, `]` etc — pega tanto
    // `contact.email` quanto `fields[email][value]` (Elementor Forms).
    const ALIASES: Record<string, RegExp> = {
      nome:     /(^|[\W_])(name|nome|fullname|full[_-]?name|first[_-]?name)($|[\W_])/i,
      email:    /(^|[\W_])(email|e[_-]?mail)($|[\W_])/i,
      whatsapp: /(^|[\W_])(whatsapp|phone|telefone|mobile|celular|tel)($|[\W_])/i,
      empresa:  /(^|[\W_])(company|empresa|business)($|[\W_])/i,
      segmento: /(^|[\W_])(segment|segmento|niche)($|[\W_])/i,
      cidade:   /(^|[\W_])(city|cidade|town)($|[\W_])/i,
    }
    // Quando o nome aparece em várias chaves (ex.: Elementor manda
    // [title], [value], [raw_value], [id]…), priorizar [value].
    const pickBest = (matches: string[]): string | undefined => {
      if (matches.length === 0) return undefined
      return matches.find((k) => k.endsWith('[value]')) ?? matches[0]
    }
    for (const [target, re] of Object.entries(ALIASES)) {
      const matches = suggestedKeys.filter((k) => re.test(k))
      const hit = pickBest(matches)
      if (hit) guesses.push({ source: hit, target })
    }
    if (guesses.length === 0) {
      toast('Nada óbvio — configure manualmente', 'info')
      return
    }
    setMapping((m) => {
      const existingTargets = new Set(m.filter((r) => r.source && r.target).map((r) => r.target))
      const filtered = m.filter((r) => r.source || r.target)
      const additions = guesses.filter((g) => !existingTargets.has(g.target))
      return [...filtered, ...additions, { source: '', target: '' }]
    })
    toast(`${guesses.length} mapeamento(s) sugerido(s)`, 'success')
  }

  function handleSubmit() {
    setError(null)
    if (!name.trim()) { setError('Informe um nome.'); return }
    const cleanMapping = mapping.filter((r) => r.source.trim() && r.target.trim())

    const payload: InboundWebhookInput = {
      name: name.trim(),
      description: description?.trim() || null,
      active,
      defaultFunnelId: defaultFunnelId ? Number(defaultFunnelId) : null,
      defaultStageKey: defaultStageKey || null,
      defaultTeamId: defaultTeamId ? Number(defaultTeamId) : null,
      defaultSource: defaultSource?.trim() || null,
      mapping: cleanMapping,
    }

    if (isEdit) {
      update.mutate({ id: webhook!.id, ...payload }, {
        onSuccess: () => { toast('Webhook atualizado', 'success'); onClose() },
        onError: (e: unknown) => setError((e as Error).message || 'Erro ao salvar'),
      })
    } else {
      create.mutate(payload, {
        onSuccess: () => { toast('Webhook criado — copie a URL na listagem', 'success'); onClose() },
        onError: (e: unknown) => setError((e as Error).message || 'Erro ao salvar'),
      })
    }
  }

  const allFields: LeadFieldOption[] = [
    ...(fields?.native ?? []),
    ...(fields?.tracking ?? []),
    ...(fields?.customFields ?? []),
  ]

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={isEdit ? `Editar: ${webhook?.name}` : 'Novo webhook de entrada'}
      size="xl"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={loading}>
            {loading ? 'Salvando…' : (isEdit ? 'Salvar' : 'Criar')}
          </Button>
        </>
      }
    >
      <div class="grid gap-4">
        {isEdit && webhook && (
          <div class="rounded-md border border-border bg-surface px-3 py-2.5">
            <div class="text-2xs uppercase tracking-wide text-fg-muted mb-1">URL do webhook</div>
            <div class="flex items-center gap-2">
              <code class="flex-1 text-xs font-mono text-fg truncate" title={buildUrl(webhook.token)}>
                {buildUrl(webhook.token)}
              </code>
              <button
                type="button"
                onClick={() => { navigator.clipboard.writeText(buildUrl(webhook.token)); toast('URL copiada', 'success') }}
                class="inline-flex items-center gap-1 px-2 h-7 rounded bg-surface-2 border border-border text-xs text-fg-muted hover:text-fg cursor-pointer"
              >
                <Copy size={12} /> Copiar
              </button>
            </div>
          </div>
        )}

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="text-xs font-medium text-fg-muted block mb-1">Nome</label>
            <input
              type="text"
              value={name}
              onInput={(e) => setName((e.target as HTMLInputElement).value)}
              placeholder="Ex: Webhook do Make - Lead RD Station"
              class="w-full h-9 px-3 rounded-md bg-surface border border-border text-sm text-fg focus:outline-none focus:border-accent"
            />
          </div>
          <div>
            <label class="text-xs font-medium text-fg-muted block mb-1">Origem (source)</label>
            <input
              type="text"
              value={defaultSource}
              onInput={(e) => setDefaultSource((e.target as HTMLInputElement).value)}
              placeholder="inbound_webhook"
              class="w-full h-9 px-3 rounded-md bg-surface border border-border text-sm text-fg focus:outline-none focus:border-accent"
            />
          </div>
        </div>

        <div>
          <label class="text-xs font-medium text-fg-muted block mb-1">Descrição (opcional)</label>
          <textarea
            value={description}
            onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)}
            placeholder="O que esse webhook recebe e de onde vem"
            rows={2}
            class="w-full px-3 py-2 rounded-md bg-surface border border-border text-sm text-fg focus:outline-none focus:border-accent resize-y"
          />
        </div>

        <div class="grid grid-cols-3 gap-3">
          <div>
            <label class="text-xs font-medium text-fg-muted block mb-1">Funil padrão</label>
            <select
              value={defaultFunnelId}
              onChange={(e) => { setDefaultFunnelId((e.target as HTMLSelectElement).value); setDefaultStageKey('') }}
              class="w-full h-9 px-2 rounded-md bg-surface border border-border text-sm text-fg focus:outline-none focus:border-accent"
            >
              <option value="">— Funil padrão do sistema —</option>
              {(funnels?.funnels ?? []).map((f) => (
                <option key={f.id} value={String(f.id)}>{f.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label class="text-xs font-medium text-fg-muted block mb-1">Etapa inicial</label>
            <select
              value={defaultStageKey}
              onChange={(e) => setDefaultStageKey((e.target as HTMLSelectElement).value)}
              disabled={!defaultFunnelId}
              class="w-full h-9 px-2 rounded-md bg-surface border border-border text-sm text-fg focus:outline-none focus:border-accent disabled:opacity-50"
            >
              <option value="">— Primeira etapa do funil —</option>
              {(stagesData?.stages ?? []).map((s) => (
                <option key={s.id} value={s.key}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label class="text-xs font-medium text-fg-muted block mb-1">Setor</label>
            <select
              value={defaultTeamId}
              onChange={(e) => setDefaultTeamId((e.target as HTMLSelectElement).value)}
              class="w-full h-9 px-2 rounded-md bg-surface border border-border text-sm text-fg focus:outline-none focus:border-accent"
            >
              <option value="">— Setor padrão do sistema —</option>
              {(teams?.teams ?? []).map((t) => (
                <option key={t.id} value={String(t.id)}>{t.name}</option>
              ))}
            </select>
          </div>
        </div>

        {isEdit && (
          <div>
            <label class="text-xs font-medium text-fg-muted block mb-1">Status</label>
            <select
              value={active ? 'true' : 'false'}
              onChange={(e) => setActive((e.target as HTMLSelectElement).value === 'true')}
              class="h-9 px-3 rounded-md bg-surface border border-border text-sm text-fg focus:outline-none focus:border-accent"
            >
              <option value="true">Ativo (aceita requisições)</option>
              <option value="false">Inativo (rejeita 403)</option>
            </select>
          </div>
        )}

        {/* Mapeamento */}
        <div>
          <div class="flex items-center justify-between mb-1.5">
            <label class="text-xs font-medium text-fg-muted">
              Mapeamento <span class="text-fg-muted">(JSONPath do payload → Campo do Lead)</span>
            </label>
            <div class="flex gap-1.5">
              {isEdit && (
                <Button variant="ghost" size="sm" onClick={autoSuggestMapping} disabled={!suggestedKeys.length}>
                  <Wand2 size={12} /> Sugerir
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={addRule}>
                <Plus size={12} /> Regra
              </Button>
            </div>
          </div>

          <div class="space-y-2">
            {mapping.map((rule, idx) => (
              <div key={idx} class="grid grid-cols-[1fr_auto_1fr_auto] gap-2 items-center">
                <input
                  type="text"
                  value={rule.source}
                  onInput={(e) => updateRule(idx, { source: (e.target as HTMLInputElement).value })}
                  placeholder="data.contact.phone  ou  $.email  ou  fields[0].value"
                  list={`inbound-keys-${webhook?.id ?? 'new'}`}
                  class="h-9 px-3 rounded-md bg-surface border border-border text-xs font-mono text-fg focus:outline-none focus:border-accent"
                />
                <span class="text-fg-muted text-xs">→</span>
                <select
                  value={rule.target}
                  onChange={(e) => updateRule(idx, { target: (e.target as HTMLSelectElement).value })}
                  class="h-9 px-2 rounded-md bg-surface border border-border text-xs text-fg focus:outline-none focus:border-accent"
                >
                  <option value="">— escolha o campo —</option>
                  <optgroup label="Campos do Lead">
                    {(fields?.native ?? []).map((f) => (
                      <option key={f.target} value={f.target}>{f.label}</option>
                    ))}
                  </optgroup>
                  {fields?.tracking && fields.tracking.length > 0 && (
                    <optgroup label="Origem do lead (opcional — nomes padrão entram sozinhos)">
                      {fields.tracking.map((f) => (
                        <option key={f.target} value={f.target}>{f.label}</option>
                      ))}
                    </optgroup>
                  )}
                  {fields?.customFields && fields.customFields.length > 0 && (
                    <optgroup label="Campos personalizados">
                      {fields.customFields.map((f) => (
                        <option key={f.target} value={f.target}>{f.label}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <button
                  type="button"
                  onClick={() => removeRule(idx)}
                  class="size-9 inline-flex items-center justify-center rounded-md text-fg-muted hover:text-danger hover:bg-surface cursor-pointer"
                  title="Remover regra"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>

          {/* Datalist com chaves do último payload */}
          {suggestedKeys.length > 0 && (
            <datalist id={`inbound-keys-${webhook?.id ?? 'new'}`}>
              {suggestedKeys.map((k) => <option key={k} value={k} />)}
            </datalist>
          )}

          <p class="text-2xs text-fg-muted mt-2">
            Pelo menos um dos campos <strong>nome, email ou whatsapp</strong> precisa ser mapeado pra que o Lead seja criado.
            {allFields.length === 0 && ' (Carregando campos…)'}
          </p>
        </div>

        {/* Último payload (preview) */}
        {isEdit && (
          <LastPayloadPanel webhookId={webhook!.id} />
        )}

        {error && <div class="text-xs text-danger">{error}</div>}
      </div>
    </Modal>
  )
}

function LastPayloadPanel({ webhookId }: { webhookId: number }) {
  const { data, isLoading } = useInboundWebhookLastPayload(webhookId)
  const [expanded, setExpanded] = useState(false)
  const hasPayload = !!data?.payload

  return (
    <div class="rounded-md border border-border bg-surface">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        class="w-full flex items-center justify-between px-3 py-2 text-xs text-fg-muted hover:text-fg cursor-pointer"
      >
        <span>
          Último payload recebido
          {data?.receivedAt && (
            <span class="text-fg-muted ml-2">({formatBrDateTime(data.receivedAt)})</span>
          )}
        </span>
        <span class="text-3xs uppercase tracking-wide">{expanded ? 'Ocultar' : 'Mostrar'}</span>
      </button>
      {expanded && (
        <div class="border-t border-border p-3 max-h-72 overflow-auto">
          {isLoading && <Skeleton class="h-20 w-full" />}
          {!isLoading && !hasPayload && (
            <div class="text-xs text-fg-muted">
              Nenhum payload recebido ainda. Mande uma requisição POST pro endpoint pra ver o conteúdo aqui e configurar o mapeamento.
            </div>
          )}
          {!isLoading && hasPayload && (
            <pre class="text-2xs font-mono text-fg whitespace-pre-wrap break-all">
              {JSON.stringify(data!.payload, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

// ── Delete ──────────────────────────────────────
function DeleteDialog({ webhook, onClose }: { webhook: InboundWebhook; onClose: () => void }) {
  const del = useDeleteInboundWebhook()
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Excluir "${webhook.name}"?`}
      description="A URL deixará de funcionar imediatamente. O histórico de recebimentos também será apagado."
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

// ── Hits modal (logs de recebimento) ────────────
function HitsModal({ webhook, onClose }: { webhook: InboundWebhook; onClose: () => void }) {
  const { data, isLoading, refetch } = useInboundWebhookHits(webhook.id, 100)
  const [selected, setSelected] = useState<number | null>(null)
  const hits = data?.data ?? []
  const total = data?.total ?? 0
  const selectedHit = hits.find((h) => h.id === selected) || null

  useEffect(() => {
    const t = setInterval(() => refetch(), 5000)
    return () => clearInterval(t)
  }, [refetch])

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Histórico — ${webhook.name}`}
      size="xl"
      footer={<Button variant="secondary" size="sm" onClick={onClose}>Fechar</Button>}
    >
      <div class="grid grid-cols-[1fr_1.2fr] gap-3 min-h-[24rem]">
        <div class="border border-border rounded-md overflow-hidden bg-surface">
          <div class="bg-surface-2 border-b border-border px-3 py-2 text-xs text-fg-muted flex justify-between">
            <span>Recebimentos</span>
            <span>{total.toLocaleString('pt-BR')} total</span>
          </div>
          <div class="overflow-y-auto max-h-[28rem]">
            {isLoading && <div class="p-4"><Skeleton class="h-20 w-full" /></div>}
            {!isLoading && hits.length === 0 && (
              <div class="p-6 text-center text-xs text-fg-muted">
                Sem recebimentos ainda. Quando algum payload chegar, aparece aqui.
              </div>
            )}
            {!isLoading && hits.map((h) => (
              <button
                key={h.id}
                type="button"
                onClick={() => setSelected(h.id)}
                class={`w-full text-left px-3 py-2 border-b border-border text-xs hover:bg-surface-2 cursor-pointer ${
                  selected === h.id ? 'bg-surface-2' : ''
                }`}
              >
                <div class="flex items-center justify-between mb-0.5">
                  <span class={`inline-flex items-center gap-1.5 ${h.success ? 'text-success' : 'text-danger'}`}>
                    <span class={`size-1.5 rounded-full ${h.success ? 'bg-success' : 'bg-danger'}`} />
                    {h.success ? 'OK' : 'Erro'}
                    {h.leadId && <span class="text-fg-muted">· Lead #{h.leadId}</span>}
                  </span>
                  <span class="text-fg-muted text-3xs">{formatBrDateTime(h.receivedAt)}</span>
                </div>
                {h.error && <div class="text-danger text-3xs truncate">{h.error}</div>}
                {!h.error && h.ip && <div class="text-fg-muted text-3xs">{h.ip}</div>}
              </button>
            ))}
          </div>
        </div>

        <div class="border border-border rounded-md overflow-hidden bg-surface">
          <div class="bg-surface-2 border-b border-border px-3 py-2 text-xs text-fg-muted">
            Detalhes
          </div>
          <div class="p-3 overflow-y-auto max-h-[28rem] space-y-3 text-xs">
            {!selectedHit && (
              <div class="text-fg-muted text-center p-6">
                Selecione um recebimento à esquerda pra ver o payload e o resultado do mapping.
              </div>
            )}
            {selectedHit && (
              <>
                <div>
                  <div class="text-3xs uppercase tracking-wide text-fg-muted mb-1">Resultado</div>
                  {selectedHit.success ? (
                    <div class="text-success">Lead #{selectedHit.leadId} criado</div>
                  ) : (
                    <div class="text-danger">{selectedHit.error || 'Falha'}</div>
                  )}
                </div>
                <div>
                  <div class="text-3xs uppercase tracking-wide text-fg-muted mb-1">Campos mapeados</div>
                  <pre class="bg-surface-2 border border-border rounded p-2 text-2xs font-mono whitespace-pre-wrap break-all">
                    {JSON.stringify(selectedHit.mappedData ?? {}, null, 2)}
                  </pre>
                </div>
                <div>
                  <div class="text-3xs uppercase tracking-wide text-fg-muted mb-1">Payload bruto</div>
                  <pre class="bg-surface-2 border border-border rounded p-2 text-2xs font-mono whitespace-pre-wrap break-all max-h-64 overflow-auto">
                    {JSON.stringify(selectedHit.payload, null, 2)}
                  </pre>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}
