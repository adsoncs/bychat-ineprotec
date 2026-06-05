import { useState, useMemo } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import { Workflow as WorkflowIcon, Plus, HelpCircle } from 'lucide-preact'
import {
  useWorkflows,
  useCreateWorkflow,
  useUpdateWorkflow,
  useToggleWorkflow,
  useDuplicateWorkflow,
  useDeleteWorkflow,
  type Workflow,
  type WorkflowInput,
  type WorkflowTriggerConfig,
} from '@/hooks/useWorkflows'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { Modal } from '@/components/ui/Modal'
import { Input, Textarea, Select } from '@/components/ui/Input'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useFunnels, useFunnel } from '@/hooks/useFunnels'
import { useTags } from '@/hooks/useTags'
import { useChatbots } from '@/hooks/useChatbots'
import { useLossReasons } from '@/hooks/useLeadOutcome'
import { useModules } from '@/hooks/useModules'
import { filterAvailableTriggers, triggerLabel, CATEGORY_LABELS, type TriggerEvent } from '@/lib/triggerEvents'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/cn'

// Catálogo central — vide `lib/triggerEvents.ts`. Mantido aqui só pro fallback
// "Novo Workflow" abaixo; a lista mostrada na UI vem filtrada por módulos
// ativos via filterAvailableTriggers().

const REENTRY_POLICIES = [
  { value: 'never', label: 'Nunca (1 vez por lead)' },
  { value: 'after_completion', label: 'Após conclusão' },
  { value: 'always', label: 'Sempre repetir' },
]

const MESSAGE_CHANNELS = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'web_chat', label: 'Chat Web' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'telegram', label: 'Telegram' },
  { value: 'api', label: 'API' },
]

const LEAD_SOURCES = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'meta_lead_ads', label: 'Meta Lead Ads' },
  { value: 'web_chat', label: 'Chat Web' },
  { value: 'web_form', label: 'Formulário Web' },
  { value: 'scheduling', label: 'Agendamento' },
  { value: 'manual', label: 'Manual' },
  { value: 'api', label: 'API' },
]

// triggerLabel é importado de '@/lib/triggerEvents' (resolve via catálogo central)

// Renderiza as <option> agrupadas por categoria. UX bem melhor que listão.
function renderTriggerOptions(events: TriggerEvent[]) {
  const groups = events.reduce<Record<string, TriggerEvent[]>>((acc, e) => {
    if (!acc[e.category]) acc[e.category] = []
    acc[e.category]!.push(e)
    return acc
  }, {})
  const order = ['lead', 'message', 'activity', 'sales', 'system', 'enrollment_portal', 'educational']
  return order
    .filter((k) => groups[k] && groups[k]!.length > 0)
    .map((k) => (
      <optgroup key={k} label={CATEGORY_LABELS[k as keyof typeof CATEGORY_LABELS]}>
        {groups[k]!.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}
      </optgroup>
    ))
}

export function WorkflowsPage() {
  const { data, isLoading } = useWorkflows()
  const [, navigate] = useLocation()
  const [editing, setEditing] = useState<Workflow | null>(null)
  const [deleting, setDeleting] = useState<Workflow | null>(null)
  const [creating, setCreating] = useState(false)
  const [showHowItWorks, setShowHowItWorks] = useState(false)
  const toggle = useToggleWorkflow()
  const duplicate = useDuplicateWorkflow()

  function openBuilder(w: Workflow) {
    navigate(`/workflows/${w.id}/builder`)
  }

  function handleNew() {
    setCreating(true)
  }

  function handleToggle(w: Workflow) {
    toggle.mutate(w.id, {
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function handleDuplicate(w: Workflow) {
    duplicate.mutate(w.id, {
      onSuccess: () => toast('Fluxo duplicado', 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <Page
      title="Fluxos"
      description="Sequências automáticas que disparam quando algo acontece com um lead — você define o gatilho, os passos, as condições e as ações."
      actions={
        <div class="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setShowHowItWorks(true)}>
            <HelpCircle size={14} /> Como funciona?
          </Button>
          <Button variant="primary" size="sm" onClick={handleNew}>
            <Plus size={14} /> Novo fluxo
          </Button>
        </div>
      }
    >
      {isLoading && (
        <div class="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} class="h-12 w-full" />)}
        </div>
      )}

      {!isLoading && data?.workflows.length === 0 && (
        <Card>
          <div class="text-center py-6">
            <WorkflowIcon size={28} class="mx-auto text-fg-subtle mb-3" />
            <p class="text-sm text-fg mb-1">Nenhum fluxo criado</p>
            <p class="text-xs text-fg-muted mb-4 max-w-md mx-auto">
              Os fluxos automatizam ações com base em eventos do CRM — envio de mensagens, mudança de etapa, etiquetas e mais.
            </p>
            <Button variant="primary" size="sm" onClick={handleNew}>
              Criar primeiro fluxo
            </Button>
          </div>
        </Card>
      )}

      {!isLoading && data && data.workflows.length > 0 && (
        <Card class="p-0 overflow-hidden">
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="text-[0.6875rem] uppercase tracking-wider text-fg-subtle border-b border-border">
                  <th class="text-left px-3 py-2 font-medium">Nome</th>
                  <th class="text-left px-3 py-2 font-medium">Gatilho</th>
                  <th class="text-center px-3 py-2 font-medium">Passos</th>
                  <th class="text-center px-3 py-2 font-medium">Execuções</th>
                  <th class="text-center px-3 py-2 font-medium">Pausar ao responder</th>
                  <th class="text-center px-3 py-2 font-medium">Status</th>
                  <th class="text-left px-3 py-2 font-medium" style={{ width: '12rem' }}>Ações</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-border">
                {data.workflows.map((w) => (
                  <tr key={w.id}>
                    <td class="px-3 py-2 font-medium text-fg break-words">{w.name}</td>
                    <td class="px-3 py-2">
                      <span class="inline-flex items-center px-2 py-0.5 rounded-full bg-info text-white text-[0.6875rem] font-medium">
                        {triggerLabel(w.triggerEvent)}
                      </span>
                    </td>
                    <td class="px-3 py-2 text-center tabular-nums">{w._count.steps}</td>
                    <td class="px-3 py-2 text-center tabular-nums">{w._count.executions}</td>
                    <td class="px-3 py-2 text-center">
                      {w.pauseOnReply
                        ? <span class="text-accent font-medium">Sim</span>
                        : <span class="text-fg-subtle">Não</span>}
                    </td>
                    <td class="px-3 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => handleToggle(w)}
                        disabled={toggle.isPending}
                        class={cn(
                          'inline-flex items-center px-3 h-7 rounded-md border text-xs font-medium transition-colors',
                          w.active
                            ? 'border-accent bg-accent text-fg-on-brand hover:bg-accent-hover'
                            : 'border-border bg-surface text-fg-muted hover:bg-surface-3',
                        )}
                      >
                        {w.active ? 'Ativo' : 'Inativo'}
                      </button>
                    </td>
                    <td class="px-3 py-2">
                      <div class="flex flex-wrap gap-1">
                        <Button variant="secondary" size="sm" onClick={() => setEditing(w)}>Editar</Button>
                        <Button variant="primary" size="sm" onClick={() => openBuilder(w)}>Abrir builder</Button>
                        <Button variant="secondary" size="sm" onClick={() => handleDuplicate(w)} disabled={duplicate.isPending}>Duplicar</Button>
                        <Button variant="danger" size="sm" onClick={() => setDeleting(w)}>Excluir</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {creating && (
        <WorkflowCreateModal
          onClose={() => setCreating(false)}
          onCreated={(w, action) => {
            setCreating(false)
            if (action === 'builder') openBuilder(w)
            else setEditing(w)
          }}
        />
      )}
      {editing && (
        <WorkflowFormModal
          workflow={editing}
          onClose={() => setEditing(null)}
          onOpenSteps={() => { const w = editing; setEditing(null); openBuilder(w) }}
        />
      )}
      {deleting && <DeleteWorkflowDialog workflow={deleting} onClose={() => setDeleting(null)} />}
      {showHowItWorks && (
        <HowItWorksModal
          onClose={() => setShowHowItWorks(false)}
          onCreate={() => { setShowHowItWorks(false); handleNew() }}
        />
      )}
    </Page>
  )
}

// Modal de criação de Fluxo: pede dados mínimos antes de persistir.
// Substitui o comportamento antigo de "criar com defaults e abrir editor".
function WorkflowCreateModal({
  onClose, onCreated,
}: {
  onClose: () => void
  onCreated: (workflow: Workflow, action: 'edit' | 'builder') => void
}) {
  const create = useCreateWorkflow()
  const { data: modulesData } = useModules()
  const enabledModules = useMemo(
    () => new Set((modulesData?.modules ?? []).filter((m) => m.enabled).map((m) => m.id)),
    [modulesData],
  )
  const availableTriggers = useMemo(() => filterAvailableTriggers(enabledModules), [enabledModules])

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [triggerEvent, setTriggerEvent] = useState('')
  const [error, setError] = useState<string | null>(null)

  const canSubmit = name.trim().length > 0 && triggerEvent.length > 0
  const loading = create.isPending

  function submit(action: 'edit' | 'builder') {
    setError(null)
    if (!name.trim()) { setError('Informe um nome'); return }
    if (!triggerEvent) { setError('Escolha o evento gatilho'); return }
    create.mutate(
      { name: name.trim(), description: description.trim() || null, triggerEvent },
      {
        onSuccess: (w) => {
          toast('Fluxo criado', 'success')
          onCreated(w, action)
        },
        onError: (e: unknown) => setError((e as Error).message || 'Erro ao criar'),
      },
    )
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o && !loading) onClose() }}
      title="Novo fluxo"
      description="Defina nome e evento gatilho. Os passos do fluxo são montados depois."
      size="md"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button variant="secondary" size="sm" onClick={() => submit('edit')} disabled={!canSubmit || loading}>
            {loading ? 'Criando…' : 'Criar e configurar'}
          </Button>
          <Button variant="primary" size="sm" onClick={() => submit('builder')} disabled={!canSubmit || loading}>
            {loading ? 'Criando…' : 'Criar e abrir builder →'}
          </Button>
        </>
      }
    >
      <div class="space-y-3">
        <Input
          label="Nome *"
          value={name}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
          placeholder="Ex: Notificar equipe sobre novo lead VIP"
          autoFocus
        />
        <Select
          label="Evento gatilho *"
          value={triggerEvent}
          onChange={(e) => setTriggerEvent((e.target as HTMLSelectElement).value)}
          hint="Quando este fluxo deve disparar?"
        >
          <option value="">— selecione um evento —</option>
          {renderTriggerOptions(availableTriggers)}
        </Select>
        <Textarea
          label="Descrição (opcional)"
          value={description}
          onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)}
          rows={2}
          placeholder="O que este fluxo faz e quando você espera que dispare?"
        />
        {error && <div class="text-xs text-danger">{error}</div>}
      </div>
    </Modal>
  )
}

function WorkflowFormModal({
  workflow, onClose, onOpenSteps,
}: {
  workflow: Workflow
  onClose: () => void
  onOpenSteps: () => void
}) {
  const [form, setForm] = useState({
    name: workflow.name,
    description: workflow.description ?? '',
    triggerEvent: workflow.triggerEvent,
    reentryPolicy: workflow.reentryPolicy,
    pauseOnReply: workflow.pauseOnReply,
    funnelId: workflow.funnelId,
    goalEvent: workflow.goalEvent ?? '',
  })
  const [triggerConfig, setTriggerConfig] = useState<WorkflowTriggerConfig>(workflow.triggerConfig ?? {})

  const update = useUpdateWorkflow()
  const loading = update.isPending

  // Filtra triggers educacional/portal_matriculas se módulo estiver desativado
  const { data: modulesData } = useModules()
  const enabledModules = useMemo(
    () => new Set((modulesData?.modules ?? []).filter((m) => m.enabled).map((m) => m.id)),
    [modulesData],
  )
  const availableTriggers = useMemo(() => filterAvailableTriggers(enabledModules), [enabledModules])

  function patch<K extends keyof typeof form>(k: K, v: typeof form[K]) {
    setForm((f) => ({ ...f, [k]: v }))
  }

  function handleSubmit() {
    if (!form.name.trim()) { toast('Nome é obrigatório', 'danger'); return }
    const cfg = stripEmpty(triggerConfig)
    const payload: WorkflowInput = {
      name: form.name.trim(),
      description: form.description || null,
      triggerEvent: form.triggerEvent,
      triggerConfig: Object.keys(cfg).length > 0 ? cfg : null,
      reentryPolicy: form.reentryPolicy,
      pauseOnReply: form.pauseOnReply,
      funnelId: form.funnelId,
      goalEvent: form.goalEvent.trim() || null,
    }
    update.mutate({ id: workflow.id, ...payload }, {
      onSuccess: () => { toast('Fluxo salvo', 'success'); onClose() },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Configuração do fluxo"
      size="xl"
      footer={
        <>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={loading}>
            {loading ? 'Salvando…' : 'Salvar'}
          </Button>
          <Button variant="secondary" size="sm" onClick={onOpenSteps} disabled={loading}>
            Editar Passos →
          </Button>
        </>
      }
    >
      <div class="space-y-4">
        <div class="grid gap-3 grid-cols-1 sm:grid-cols-2">
          <Input label="Nome" value={form.name} onInput={(e) => patch('name', (e.target as HTMLInputElement).value)} />
          <Select
            label="Evento Gatilho"
            value={form.triggerEvent}
            onChange={(e) => { patch('triggerEvent', (e.target as HTMLSelectElement).value); setTriggerConfig({}) }}
            hint="Evento que inicia este fluxo"
          >
            {renderTriggerOptions(availableTriggers)}
          </Select>
        </div>

        <div class="rounded-md border border-border bg-surface-3 p-3 space-y-2">
          <div>
            <span class="text-xs font-semibold text-info">Filtros do gatilho</span>
            <span class="text-[0.6875rem] text-fg-subtle ml-2">Quando exatamente este fluxo deve disparar?</span>
          </div>
          <TriggerFiltersEditor
            triggerEvent={form.triggerEvent}
            value={triggerConfig}
            onChange={setTriggerConfig}
            funnelId={form.funnelId}
          />
        </div>

        <Textarea label="Descrição" value={form.description} onInput={(e) => patch('description', (e.target as HTMLTextAreaElement).value)} rows={2} />

        <div class="grid gap-3 grid-cols-1 sm:grid-cols-3">
          <Select
            label="Política de Re-entrada"
            value={form.reentryPolicy}
            onChange={(e) => patch('reentryPolicy', (e.target as HTMLSelectElement).value)}
            hint="Se o mesmo lead pode entrar neste fluxo mais de uma vez"
          >
            {REENTRY_POLICIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </Select>
          <Select
            label="Pausar ao receber resposta"
            value={form.pauseOnReply ? 'true' : 'false'}
            onChange={(e) => patch('pauseOnReply', (e.target as HTMLSelectElement).value === 'true')}
            hint="Pausa o fluxo quando o lead responde via WhatsApp"
          >
            <option value="true">Sim — pausar fluxo</option>
            <option value="false">Não — continuar mesmo se responder</option>
          </Select>
          <FunnelScopeSelect value={form.funnelId} onChange={(v) => patch('funnelId', v)} />
        </div>

        <Select
          label="Evento de meta (opcional)"
          value={form.goalEvent}
          onChange={(e) => patch('goalEvent', (e.target as HTMLSelectElement).value)}
          hint="Se este evento ocorrer enquanto o fluxo está rodando, ele encerra automaticamente com sucesso"
        >
          <option value="">Sem meta — fluxo termina no último passo</option>
          {renderTriggerOptions(availableTriggers)}
        </Select>
      </div>
    </Modal>
  )
}

function stripEmpty(cfg: WorkflowTriggerConfig): WorkflowTriggerConfig {
  const out: WorkflowTriggerConfig = {}
  for (const [k, v] of Object.entries(cfg)) {
    if (v === undefined || v === null || v === '') continue
    if (Array.isArray(v) && v.length === 0) continue
    ;(out as Record<string, unknown>)[k] = v
  }
  return out
}

function FunnelScopeSelect({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const { data } = useFunnels()
  return (
    <Select
      label="Funil (escopo)"
      value={value === null ? '' : String(value)}
      onChange={(e) => {
        const v = (e.target as HTMLSelectElement).value
        onChange(v ? Number(v) : null)
      }}
      hint="Limitar fluxo a leads de um funil específico"
    >
      <option value="">Todos os funis</option>
      {data?.funnels.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
    </Select>
  )
}

function TriggerFiltersEditor({
  triggerEvent, value, onChange, funnelId,
}: {
  triggerEvent: string
  value: WorkflowTriggerConfig
  onChange: (v: WorkflowTriggerConfig) => void
  funnelId: number | null
}) {
  const { data: tagsData } = useTags()
  const { data: chatbotsData } = useChatbots()
  const { data: funnelDetail } = useFunnel(funnelId)
  const stages = funnelDetail?.stages ?? []

  function patch(k: keyof WorkflowTriggerConfig, v: string | number | undefined) {
    const next = { ...value }
    if (v === undefined || v === '' || v === 0) delete next[k]
    else (next as Record<string, unknown>)[k] = v
    onChange(next)
  }

  if (triggerEvent === 'lead.stage_changed') {
    return (
      <div class="grid gap-3 grid-cols-1 sm:grid-cols-2">
        <div>
          {funnelId !== null && stages.length > 0 ? (
            <Select label="Quando mover para a etapa" value={value.stageKey ?? value.newValue ?? ''} onChange={(e) => patch('stageKey', (e.target as HTMLSelectElement).value || undefined)} hint="Dispara quando o lead entra nesta etapa">
              <option value="">Qualquer etapa</option>
              {stages.map((s) => <option key={s.key} value={s.key}>{s.name} ({s.key})</option>)}
            </Select>
          ) : (
            <Input label="Etapa de destino (key)" value={value.stageKey ?? value.newValue ?? ''} onInput={(e) => patch('stageKey', (e.target as HTMLInputElement).value || undefined)} placeholder="ex.: qualificado" hint="Selecione um funil acima para listar etapas, ou digite a key" />
          )}
        </div>
        <div>
          {funnelId !== null && stages.length > 0 ? (
            <Select label="Vindo da etapa (opcional)" value={value.oldValue ?? ''} onChange={(e) => patch('oldValue', (e.target as HTMLSelectElement).value || undefined)} hint="Só dispara se o lead veio desta etapa">
              <option value="">Qualquer etapa anterior</option>
              {stages.map((s) => <option key={s.key} value={s.key}>{s.name} ({s.key})</option>)}
            </Select>
          ) : (
            <Input label="Vindo da etapa (key, opcional)" value={value.oldValue ?? ''} onInput={(e) => patch('oldValue', (e.target as HTMLInputElement).value || undefined)} placeholder="ex.: novo" />
          )}
        </div>
      </div>
    )
  }

  if (triggerEvent === 'lead.tag_added' || triggerEvent === 'lead.tag_removed') {
    const verb = triggerEvent === 'lead.tag_added' ? 'adicionada' : 'removida'
    return (
      <Select label="Etiqueta específica" value={value.tagName ?? ''} onChange={(e) => patch('tagName', (e.target as HTMLSelectElement).value || undefined)} hint={`Dispara apenas quando esta etiqueta for ${verb}`}>
        <option value="">Qualquer etiqueta</option>
        {tagsData?.tags.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
      </Select>
    )
  }

  if (triggerEvent === 'message.received' || triggerEvent === 'message.sent') {
    const verb = triggerEvent === 'message.received' ? 'recebimento' : 'envio'
    return (
      <Select label="Canal da mensagem" value={value.channel ?? ''} onChange={(e) => patch('channel', (e.target as HTMLSelectElement).value || undefined)} hint={`Filtrar por canal de ${verb}`}>
        <option value="">Qualquer canal</option>
        {MESSAGE_CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
      </Select>
    )
  }

  if (triggerEvent === 'lead.created') {
    return (
      <div class="grid gap-3 grid-cols-1 sm:grid-cols-2">
        <Select label="Origem do lead" value={value.source ?? ''} onChange={(e) => patch('source', (e.target as HTMLSelectElement).value || undefined)}>
          <option value="">Qualquer origem</option>
          {LEAD_SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </Select>
        <Select label="Chatbot específico" value={value.chatbotId ? String(value.chatbotId) : ''} onChange={(e) => patch('chatbotId', (e.target as HTMLSelectElement).value ? Number((e.target as HTMLSelectElement).value) : undefined)}>
          <option value="">Qualquer chatbot</option>
          {chatbotsData?.chatbots.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </div>
    )
  }

  if (triggerEvent === 'diagnosis.completed') {
    return (
      <Select label="Chatbot do diagnóstico" value={value.chatbotId ? String(value.chatbotId) : ''} onChange={(e) => patch('chatbotId', (e.target as HTMLSelectElement).value ? Number((e.target as HTMLSelectElement).value) : undefined)} hint="Disparar apenas quando o diagnóstico deste chatbot for concluído">
        <option value="">Qualquer chatbot</option>
        {chatbotsData?.chatbots.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </Select>
    )
  }

  if (triggerEvent === 'lead.lost') {
    return (
      <LossReasonsTriggerEditor
        value={value.reasonIds ?? []}
        onChange={(ids) => onChange(ids.length > 0 ? { ...value, reasonIds: ids } : { ...value, reasonIds: undefined })}
      />
    )
  }

  return (
    <div class="text-xs text-fg-subtle">
      Nenhum filtro adicional disponível para este gatilho.
    </div>
  )
}

function LossReasonsTriggerEditor({
  value, onChange,
}: {
  value: number[]
  onChange: (ids: number[]) => void
}) {
  const { data, isLoading } = useLossReasons()
  const items = data?.data ?? []
  const selected = new Set(value)

  function toggle(id: number) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(Array.from(next))
  }

  return (
    <div>
      <div class="flex items-center justify-between mb-1.5">
        <label class="text-xs font-medium text-fg">Filtrar por objeção (opcional)</label>
        <a
          href="/app/settings"
          target="_blank"
          rel="noreferrer"
          class="text-[0.6875rem] text-accent hover:underline"
          title="Cadastrar/gerenciar objeções"
        >
          Gerenciar objeções
        </a>
      </div>
      <p class="text-[0.6875rem] text-fg-subtle mb-2">
        Sem seleção = dispara para qualquer objeção. Com seleção = dispara só para as marcadas.
      </p>
      {isLoading ? (
        <div class="text-xs text-fg-subtle">Carregando…</div>
      ) : items.length === 0 ? (
        <div class="text-xs text-fg-subtle">Nenhuma objeção cadastrada.</div>
      ) : (
        <div class="flex flex-wrap gap-1.5">
          {items.map((r) => {
            const on = selected.has(r.id)
            return (
              <button
                key={r.id}
                type="button"
                class={cn(
                  'inline-flex items-center gap-1 px-2 h-7 rounded-md border text-xs transition-colors',
                  on ? 'border-transparent text-fg-on-brand' : 'border-border bg-surface-2 text-fg-muted hover:bg-surface-3',
                )}
                style={on ? { background: r.color || '#0ea5e9' } : undefined}
                onClick={() => toggle(r.id)}
              >
                <span class="size-2 rounded-full" style={{ background: on ? 'rgba(255,255,255,0.7)' : (r.color || '#94a3b8') }} />
                {r.name}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function DeleteWorkflowDialog({ workflow, onClose }: { workflow: Workflow; onClose: () => void }) {
  const del = useDeleteWorkflow()
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Excluir "${workflow.name}"`}
      description={
        workflow._count.executions > 0
          ? `Esse fluxo tem ${workflow._count.executions} execuções no histórico. A exclusão remove o fluxo mas preserva o histórico.`
          : 'O fluxo será removido permanentemente.'
      }
      destructive
      confirmLabel="Excluir"
      loading={del.isPending}
      onConfirm={() => del.mutate(workflow.id, {
        onSuccess: () => { toast('Fluxo excluído', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })}
    />
  )
}

function HowItWorksModal({ onClose, onCreate }: { onClose: () => void; onCreate: () => void }) {
  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Como funcionam os Fluxos?"
      size="lg"
      footer={<Button variant="secondary" size="sm" onClick={onClose}>Fechar</Button>}
    >
      <div class="space-y-4 text-sm">
        <div class="rounded-lg p-4 bg-accent/10 border border-accent/30">
          <div class="font-semibold text-fg mb-1">O problema que ele resolve</div>
          <div class="text-xs text-fg-muted leading-relaxed">
            Toda hora algo precisa ser feito quando um lead chega, muda de etapa, é etiquetado ou marcado como
            ganho. Mandar mensagem de boas-vindas, mover pra outro funil, avisar o vendedor, adicionar etiqueta…
            Um <strong>fluxo</strong> é uma receita do tipo <em>"Quando X acontecer, faça Y"</em> — e o sistema
            executa sozinho.
          </div>
        </div>

        <div class="space-y-3">
          <Step n={1} title="⚡ Você escolhe o gatilho (o quando)">
            Exemplos: lead criado, lead mudou de etapa, etiqueta foi adicionada, lead foi marcado como Ganho,
            chatbot foi finalizado, mensagem recebida. Cada gatilho dispara o fluxo automaticamente.
          </Step>
          <Step n={2} title="🧱 Monta os passos no builder visual">
            Cada passo é uma ação: enviar WhatsApp, enviar e-mail, mover pra etapa, adicionar tag, criar tarefa,
            esperar X dias, chamar webhook, executar IA. Você arrasta blocos no canvas e conecta com setas.
          </Step>
          <Step n={3} title="🔀 Adiciona condições (opcional)">
            Bloco de condição abre dois caminhos (sim/não): <em>"Se o lead veio do Instagram, mande mensagem A;
            se não, mande B"</em>. Útil pra personalizar por origem, valor, etapa, etc.
          </Step>
          <Step n={4} title="🚦 Ativa o fluxo">
            Ele só roda quando você marca como <strong>Ativo</strong>. Em rascunho, fica congelado pra você ajustar
            sem disparar errado em produção.
          </Step>
          <Step n={5} title="🛑 Pausa quando o lead responde">
            Se ativar <strong>"Pausar ao responder"</strong>, no momento em que o lead manda mensagem o fluxo para —
            evita continuar mandando mensagem automática em cima de quem já tá conversando.
          </Step>
        </div>

        <div class="rounded-lg p-4 bg-info/10 border border-info/30">
          <div class="font-semibold text-fg mb-1">🆚 Fluxos vs Cadências — qual usar?</div>
          <div class="text-xs text-fg-muted leading-relaxed">
            <strong>Fluxos</strong> reagem a eventos (lead mudou de etapa, foi etiquetado, etc.) e podem ter
            condições e ramos. Bom pra automatizar regras do CRM.<br />
            <strong>Cadências</strong> são sequências de prospecção (dia 1, dia 3, dia 5…) com pausa ao responder
            e classificação de resposta. Bom pra follow-up de vendas.
          </div>
        </div>

        <div class="flex flex-wrap gap-2 justify-end pt-2">
          <Button variant="primary" size="sm" onClick={onCreate}>
            <Plus size={14} /> Criar meu primeiro fluxo
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: preact.ComponentChildren }) {
  return (
    <div class="flex gap-3">
      <div class="shrink-0 size-9 rounded-full bg-accent text-fg-on-brand grid place-items-center text-sm font-bold">
        {n}
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-sm font-semibold text-fg mb-0.5">{title}</div>
        <div class="text-xs text-fg-muted leading-relaxed">{children}</div>
      </div>
    </div>
  )
}
