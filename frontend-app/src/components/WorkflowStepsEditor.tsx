import { useEffect, useState, useMemo } from 'preact/hooks'
import { List, Network } from '@/components/ui/icon-set'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input, Textarea, Select } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import {
  useWorkflow,
  useCreateWorkflowStep,
  useUpdateWorkflowStep,
  useDeleteWorkflowStep,
  type WorkflowStep,
} from '@/hooks/useWorkflows'
import { useStages } from '@/hooks/useFunnels'
import { useTags } from '@/hooks/useTags'
import { useModules } from '@/hooks/useModules'
import { useTemplates } from '@/hooks/useTemplates'
import { useCloudApiTemplates } from '@/hooks/useCloudApi'
import { useCustomFields } from '@/hooks/useCustomFields'
import { useLossReasons } from '@/hooks/useLeadOutcome'
import { useTeams } from '@/hooks/useTeams'
import { useUsers } from '@/hooks/useUsers'
import { WorkflowCanvasView } from '@/components/WorkflowCanvasView'
import { cn } from '@/lib/cn'
import { toast } from '@/lib/toast'

// ─────────────────────────────────────────────────────────────────────────────
// Constantes (espelham o legado em modules/workflows.js)

// TRIGGER_EVENTS vem agora do catálogo central em '@/lib/triggerEvents'.
import { TRIGGER_EVENT_CATALOG as TRIGGER_EVENTS, filterAvailableTriggers, CATEGORY_LABELS, type TriggerEvent } from '@/lib/triggerEvents'

interface StepTypeMeta {
  value: string
  label: string
  color: string
  icon: string
}

const STEP_TYPES: StepTypeMeta[] = [
  { value: 'trigger', label: 'Gatilho', color: '#1a73e8', icon: '⚡' },
  { value: 'wait', label: 'Esperar', color: '#f9ab00', icon: '⏳' },
  { value: 'condition', label: 'Condição', color: '#8e24aa', icon: '🔀' },
  { value: 'action', label: 'Ação', color: '#2e7d32', icon: '▶' },
  { value: 'branch', label: 'Ramificação', color: '#e37400', icon: '🌿' },
  { value: 'goal', label: 'Meta', color: '#ea4335', icon: '🎯' },
]

const ACTION_TYPES = [
  { value: 'send_whatsapp', label: 'Enviar WhatsApp' },
  { value: 'send_email', label: 'Enviar e-mail' },
  { value: 'send_sms', label: 'Enviar SMS' },
  { value: 'change_stage', label: 'Mudar etapa' },
  { value: 'add_tag', label: 'Adicionar etiqueta' },
  { value: 'remove_tag', label: 'Remover etiqueta' },
  { value: 'create_task', label: 'Criar tarefa' },
  { value: 'webhook', label: 'Chamar webhook' },
  { value: 'assign_to_team', label: 'Atribuir a equipe' },
  { value: 'assign_to_user', label: 'Atribuir a operador' },
  { value: 'transfer_to_team', label: 'Transferir para equipe' },
  { value: 'set_summary', label: 'Aplicar resumo' },
  { value: 'notify_operator', label: 'Avisar equipe (Config › Notificações)' },
  { value: 'qualify_lead', label: 'Qualificar lead' },
  { value: 'set_campaign', label: 'Definir campanha' },
]

const DUE_MODE_OPTIONS = [
  { value: 'immediate', label: 'Imediato' },
  { value: 'hours', label: 'Em N horas' },
  { value: 'days', label: 'Em N dias corridos' },
  { value: 'business_days', label: 'Em N dias úteis' },
]

const ASSIGNEE_MODE_OPTIONS = [
  { value: 'lead_owner', label: 'Responsável pelo lead' },
  { value: 'team', label: 'Fila do setor' },
  { value: 'round_robin', label: 'Rodízio no setor' },
  { value: 'user', label: 'Pessoa fixa' },
]

const WAIT_UNITS = [
  { value: 'seconds', label: 'Segundos', short: 'seg' },
  { value: 'minutes', label: 'Minutos', short: 'min' },
  { value: 'hours', label: 'Horas', short: 'horas' },
  { value: 'days', label: 'Dias', short: 'dias' },
]

const CONDITION_TYPES = [
  { value: 'field', label: 'Um campo do lead tem determinado valor' },
  { value: 'has_tag', label: 'O lead possui uma etiqueta específica' },
  { value: 'not_has_tag', label: 'O lead NÃO possui uma etiqueta específica' },
  { value: 'time_since', label: 'Tempo desde última atividade' },
  { value: 'contato_recente', label: 'O lead é recente ou respondeu nos últimos dias' },
  { value: 'stage_is', label: 'O lead está em uma etapa específica' },
  { value: 'source_is', label: 'A origem do lead é' },
  { value: 'message_contains', label: 'A mensagem recebida contém' },
  { value: 'message_not_contains', label: 'A mensagem recebida NÃO contém' },
  { value: 'funnel_is', label: 'O lead está em um funil específico' },
  { value: 'lost_reason_in', label: 'Lead perdido por uma destas objeções' },
  { value: 'lost_reason_not_in', label: 'Lead NÃO perdido por estas objeções' },
  { value: 'has_booking', label: 'O lead tem reunião agendada' },
  { value: 'not_has_booking', label: 'O lead NÃO tem reunião agendada' },
  { value: 'not_has_outcome', label: 'O lead ainda está em andamento (nem Ganho, nem Perdido)' },
  { value: 'has_outcome', label: 'O lead já foi classificado (Ganho ou Perdido)' },
  { value: 'never_contacted', label: 'Ninguém falou com este lead ainda' },
  { value: 'no_outbound_yet', label: 'Nunca enviamos mensagem a este lead' },
  { value: 'no_inbound_yet', label: 'O lead nunca respondeu' },
  { value: 'ab_split', label: 'Rodízio A/B — sorteia entre os dois caminhos' },
]

// Condições sem nenhum campo a preencher — a pergunta já é a regra inteira.
const CONDITION_HINTS: Record<string, string> = {
  has_booking: 'Segue se houver uma reunião agendada (reserva cancelada não conta)',
  not_has_booking: 'Segue se o lead não tiver nenhuma reunião agendada',
  never_contacted: 'Segue só se não houver NENHUMA mensagem na conversa — nem nossa, nem dele. É a trava de uma primeira abordagem automática: campo personalizado preenchido não significa que já falamos com a pessoa',
  no_outbound_yet: 'Segue se nunca enviamos mensagem a este lead (anotação interna não conta)',
  no_inbound_yet: 'Segue se o lead nunca respondeu, mesmo que já tenhamos escrito',
  not_has_outcome: 'Segue só enquanto o lead está em aberto. Ganho já é cliente e Perdido já disse não — abordar ou movimentar qualquer um dos dois é pior que não fazer nada',
  has_outcome: 'Segue apenas se o lead já foi classificado como Ganho ou Perdido',
}

const OPERATORS: { value: string; label: string }[] = [
  { value: 'equals', label: 'Igual a' },
  { value: 'not_equals', label: 'Diferente de' },
  { value: 'contains', label: 'Contém' },
  { value: 'gt', label: 'Maior que' },
  { value: 'lt', label: 'Menor que' },
  { value: 'gte', label: 'Maior ou igual' },
  { value: 'lte', label: 'Menor ou igual' },
  { value: 'in', label: 'Está em (lista)' },
]

const TIME_SINCE_FIELDS = [
  { value: 'lastMessageAt', label: 'Última mensagem' },
  { value: 'lastActivityAt', label: 'Última atividade' },
  { value: 'createdAt', label: 'Criação do lead' },
]

const TIME_SINCE_OPERATORS = [
  { value: 'gt', label: 'Mais de' },
  { value: 'lt', label: 'Menos de' },
  { value: 'gte', label: 'Pelo menos' },
  { value: 'lte', label: 'No máximo' },
]

const FIELD_OPTIONS = [
  { value: 'lead.status', label: 'Etapa atual' },
  { value: 'lead.originType', label: 'Origem detalhada (campanha/canal)' },
  { value: 'lead.source', label: 'Origem (canal genérico)' },
  { value: 'lead.segmento', label: 'Segmento' },
  { value: 'lead.cidade', label: 'Cidade' },
  { value: 'lead.completed', label: 'Concluído' },
  { value: 'lead.empresa', label: 'Empresa' },
]

const BRANCH_FIELD_OPTIONS = [
  { value: 'lead.status', label: 'Etapa atual' },
  { value: 'lead.source', label: 'Origem' },
  { value: 'lead.channel', label: 'Canal' },
]

// Espelha ORIGIN_TYPES (backend/src/lib/leadOrigin.ts) — é contra `originType`
// (e, por retro-compatibilidade, `source`) que a condição `source_is` compara.
const SOURCE_OPTIONS = [
  { value: 'meta_ctwa', label: 'Meta Ads — Click to WhatsApp' },
  { value: 'meta_lead_ads', label: 'Meta Lead Ads' },
  { value: 'google_ads', label: 'Google Ads' },
  { value: 'trackable_link', label: 'Link rastreável' },
  { value: 'web_form', label: 'Formulário / Landing page' },
  { value: 'scheduling', label: 'Agendamento' },
  { value: 'enrollment_portal', label: 'Portal de matrículas' },
  { value: 'web_chat', label: 'Chat do site' },
  { value: 'whatsapp', label: 'WhatsApp direto' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'telegram', label: 'Telegram' },
  { value: 'api', label: 'API' },
  { value: 'make', label: 'Make' },
  { value: 'import', label: 'Importação' },
  { value: 'manual', label: 'Manual' },
  { value: 'organic', label: 'Orgânico' },
  { value: 'direct', label: 'Direto (sem origem)' },
]

const TASK_TYPE_OPTIONS = [
  { value: 'task', label: 'Tarefa' },
  { value: 'call', label: 'Ligação' },
  { value: 'meeting', label: 'Reunião' },
  { value: 'follow_up', label: 'Acompanhamento' },
  { value: 'note', label: 'Nota' },
]

const HTTP_METHODS = ['POST', 'PUT', 'GET', 'PATCH']

function stepTypeMeta(t: string): StepTypeMeta {
  return STEP_TYPES.find((s) => s.value === t) ?? { value: t, label: t, color: '#5f6368', icon: '?' }
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function getStr(c: Record<string, unknown>, k: string): string {
  const v = c[k]
  return typeof v === 'string' || typeof v === 'number' ? String(v) : ''
}

function getNum(c: Record<string, unknown>, k: string, def = 0): number {
  const v = c[k]
  if (typeof v === 'number') return v
  if (typeof v === 'string' && v !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : def
  }
  return def
}

function stepSummary(s: WorkflowStep): string {
  const cfg = asRecord(s.config)
  if (s.type === 'wait') {
    const u = WAIT_UNITS.find((x) => x.value === getStr(cfg, 'unit'))
    return `Aguardar ${getStr(cfg, 'duration') || '?'} ${u?.short ?? getStr(cfg, 'unit') ?? 'min'}`
  }
  if (s.type === 'action') {
    const at = ACTION_TYPES.find((a) => a.value === getStr(cfg, 'actionType'))
    return at?.label ?? getStr(cfg, 'actionType')
  }
  if (s.type === 'condition') {
    const ct = getStr(cfg, 'type')
    if (ct === 'has_tag') return `Tem etiqueta "${getStr(cfg, 'tagName')}"`
    if (ct === 'not_has_tag') return `Sem etiqueta "${getStr(cfg, 'tagName')}"`
    if (ct === 'message_contains' || ct === 'message_not_contains') {
      const v = cfg.value
      const lista = (Array.isArray(v) ? v.map(String) : String(v ?? '').split('\n')).map((x) => x.trim()).filter(Boolean)
      return `Mensagem ${ct === 'message_contains' ? 'contém' : 'NÃO contém'} "${lista[0] ?? '?'}"${lista.length > 1 ? ` (+${lista.length - 1})` : ''}`
    }
    if (ct === 'contato_recente') return `Recente ou respondeu em ${getStr(cfg, 'value') || 30} dias`
    if (ct === 'time_since') return `${getStr(cfg, 'value')}h desde ${getStr(cfg, 'field') || 'última mensagem'}`
    if (ct === 'lost_reason_in') {
      const ids = (cfg.reasonIds as number[] | undefined) ?? []
      return `Perdido por ${ids.length} objeção(ões)`
    }
    if (ct === 'lost_reason_not_in') {
      const ids = (cfg.reasonIds as number[] | undefined) ?? []
      return `Perdido NÃO por ${ids.length} objeção(ões)`
    }
    if (ct === 'stage_is') return `Está na etapa "${getStr(cfg, 'value')}"`
    if (ct === 'source_is') return `Veio de "${getStr(cfg, 'value')}"`
    if (ct === 'ab_split') return `Rodízio A/B — ${getNum(cfg, 'value', 50)}% pelo caminho "Sim"`
    if (ct === 'funnel_is') return `Está no funil ${getStr(cfg, 'value')}`
    if (ct === 'never_contacted') return 'Ninguém falou com o lead ainda'
    if (ct === 'no_outbound_yet') return 'Nunca enviamos mensagem'
    if (ct === 'no_inbound_yet') return 'O lead nunca respondeu'
    const semCampo = CONDITION_TYPES.find((c) => c.value === ct && CONDITION_HINTS[ct])
    if (semCampo) return semCampo.label
    return `${getStr(cfg, 'field') || '?'} ${getStr(cfg, 'operator') || ''} ${getStr(cfg, 'value') || ''}`.trim()
  }
  if (s.type === 'trigger' || s.type === 'goal') {
    const ev = TRIGGER_EVENTS.find((t) => t.value === getStr(cfg, 'event'))
    return ev?.label ?? getStr(cfg, 'event')
  }
  if (s.type === 'branch') {
    const f = FIELD_OPTIONS.find((x) => x.value === getStr(cfg, 'field')) ?? BRANCH_FIELD_OPTIONS.find((x) => x.value === getStr(cfg, 'field'))
    return f?.label ?? getStr(cfg, 'field')
  }
  return ''
}

function defaultConfig(type: string): Record<string, unknown> {
  if (type === 'wait') return { duration: 30, unit: 'minutes' }
  if (type === 'action') return { actionType: 'send_whatsapp', message: '' }
  if (type === 'condition') return { field: 'lead.status', operator: 'equals', value: '' }
  return {}
}

// ─────────────────────────────────────────────────────────────────────────────
// Componente principal — Lista de steps em tela vertical (modal XL)

interface Props {
  workflowId: number
  workflowName: string
  onClose: () => void
}

type ViewMode = 'list' | 'canvas'

interface BodyProps {
  workflowId: number
  /** View inicial. Default: 'canvas' (tela dedicada começa no builder visual). */
  defaultView?: ViewMode
  /** Altura do canvas. Pode ser uma string CSS qualquer (ex: '500px', 'calc(100vh - 160px)'). */
  canvasHeight?: string
}

/**
 * Conteúdo do editor de passos: toggle Lista/Canvas + lista editável + canvas.
 * Sem chrome de modal — pode ser embutido em qualquer container (tela cheia,
 * modal, etc). Reusa modal interno só pra edição/confirmação de step.
 */
export function WorkflowStepsBody({ workflowId, defaultView = 'canvas', canvasHeight = '500px' }: BodyProps) {
  const { data, isLoading } = useWorkflow(workflowId)
  const createStep = useCreateWorkflowStep(workflowId)
  const deleteStep = useDeleteWorkflowStep(workflowId)

  const [viewMode, setViewMode] = useState<ViewMode>(defaultView)
  const [editingStepId, setEditingStepId] = useState<number | null>(null)
  const [deletingStepId, setDeletingStepId] = useState<number | null>(null)

  const steps = data?.steps ?? []
  const editingStep = steps.find((s) => s.id === editingStepId) ?? null

  function handleAdd(type: string, label: string) {
    createStep.mutate(
      { type, name: label, config: defaultConfig(type) },
      {
        onSuccess: () => toast('Passo adicionado', 'success'),
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      },
    )
  }

  function doDeleteStep() {
    if (deletingStepId === null) return
    deleteStep.mutate(deletingStepId, {
      onSuccess: () => { toast('Passo excluído', 'success'); setDeletingStepId(null) },
      onError: (e: unknown) => { toast((e as Error).message, 'danger'); setDeletingStepId(null) },
    })
  }

  if (isLoading) return <Skeleton class="h-64 w-full" />

  return (
    <div class="flex flex-col gap-4 h-full">
      {/* Toggle Lista / Canvas */}
      <div class="flex items-center justify-between flex-wrap gap-2">
        <div class="inline-flex items-center rounded-md border border-border bg-surface-2 p-0.5">
          <button
            type="button"
            onClick={() => setViewMode('list')}
            class={cn(
              'inline-flex items-center gap-1.5 px-3 h-7 rounded text-xs font-medium transition-colors',
              viewMode === 'list'
                ? 'bg-surface text-fg shadow-sm'
                : 'text-fg-muted hover:text-fg',
            )}
            aria-pressed={viewMode === 'list'}
          >
            <List size={12} /> Lista
          </button>
          <button
            type="button"
            onClick={() => setViewMode('canvas')}
            class={cn(
              'inline-flex items-center gap-1.5 px-3 h-7 rounded text-xs font-medium transition-colors',
              viewMode === 'canvas'
                ? 'bg-surface text-fg shadow-sm'
                : 'text-fg-muted hover:text-fg',
            )}
            aria-pressed={viewMode === 'canvas'}
            title="Builder visual — arrasta da paleta, conecta handles, edita clicando no nó"
          >
            <Network size={12} /> Canvas
          </button>
        </div>
        {viewMode === 'canvas' && (
          <span class="text-2xs text-fg-muted">
            Arraste da paleta · Conecte handles · Clique no nó para editar
          </span>
        )}
      </div>

      {viewMode === 'list' ? (
        <>
          {/* Botões de adicionar (6, um por tipo) */}
          <div class="flex flex-wrap gap-2">
            {STEP_TYPES.map((st) => (
              <button
                key={st.value}
                type="button"
                onClick={() => handleAdd(st.value, st.label)}
                disabled={createStep.isPending}
                class="inline-flex items-center gap-1.5 px-3 h-8 rounded-md border text-xs font-medium transition-opacity hover:opacity-80 disabled:opacity-50"
                style={{
                  background: `${st.color}15`,
                  color: st.color,
                  borderColor: `${st.color}40`,
                }}
              >
                <span>{st.icon}</span> + {st.label}
              </button>
            ))}
          </div>

          {/* Lista de steps */}
          {steps.length === 0 ? (
            <div class="rounded-md border border-dashed border-border p-8 text-center">
              <p class="text-sm text-fg-muted">Nenhum passo criado. Adicione passos usando os botões acima.</p>
            </div>
          ) : (
            <div class="space-y-2">
              {steps.map((s, i) => (
                <StepRow
                  key={s.id}
                  step={s}
                  index={i}
                  steps={steps}
                  onEdit={() => setEditingStepId(s.id)}
                  onDelete={() => setDeletingStepId(s.id)}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        <div class="flex-1 min-h-0">
          <WorkflowCanvasView
            steps={steps}
            workflowId={workflowId}
            editable
            height={canvasHeight}
          />
        </div>
      )}

      {editingStep && (
        <StepEditModal
          workflowId={workflowId}
          step={editingStep}
          steps={steps}
          onClose={() => setEditingStepId(null)}
        />
      )}

      {deletingStepId !== null && (
        <ConfirmDialog
          open
          onOpenChange={(o) => { if (!o) setDeletingStepId(null) }}
          title="Excluir passo?"
          description="O passo será removido e não pode ser desfeito."
          confirmLabel="Excluir"
          destructive
          loading={deleteStep.isPending}
          onConfirm={doDeleteStep}
        />
      )}
    </div>
  )
}

/**
 * Wrapper modal — mantido pra compatibilidade com chamadas legadas.
 * Para a tela dedicada, prefira WorkflowStepsBody direto.
 */
export function WorkflowStepsEditor({ workflowId, workflowName, onClose }: Props) {
  const { data } = useWorkflow(workflowId)
  const stepsCount = data?.steps?.length ?? 0
  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={workflowName}
      description={`${stepsCount} passo${stepsCount !== 1 ? 's' : ''}`}
      size="xl"
      footer={<Button variant="primary" size="sm" onClick={onClose}>Fechar</Button>}
    >
      <WorkflowStepsBody workflowId={workflowId} defaultView="list" canvasHeight="500px" />
    </Modal>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Card horizontal de step (com border-left colorido + summary inline)

function StepRow({
  step, index, steps, onEdit, onDelete,
}: {
  step: WorkflowStep
  index: number
  steps: WorkflowStep[]
  onEdit: () => void
  onDelete: () => void
}) {
  const meta = stepTypeMeta(step.type)
  const next = step.nextStepId ? steps.find((x) => x.id === step.nextStepId) : null
  const alt = step.altStepId ? steps.find((x) => x.id === step.altStepId) : null
  const summary = stepSummary(step)

  return (
    <div
      class="rounded-md border border-border bg-surface-2 overflow-hidden"
      style={{ borderLeft: `4px solid ${meta.color}` }}
    >
      <div class="px-4 py-3 flex items-center gap-3 flex-wrap">
        <span class="text-2xs text-fg-muted font-semibold min-w-6">#{index + 1}</span>
        <span class="text-lg shrink-0">{meta.icon}</span>
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium text-fg break-words">{step.name}</div>
          <div class="text-2xs text-fg-muted break-words mt-0.5">
            <span
              class="inline-block px-1.5 py-0.5 rounded-full font-medium mr-1"
              style={{ background: `${meta.color}15`, color: meta.color }}
            >
              {meta.label}
            </span>
            {summary && <> — {summary}</>}
            {next && <> → <span class="text-info">{next.name}</span></>}
            {alt && <> | Senão → <span class="text-warning">{alt.name}</span></>}
          </div>
        </div>
        <div class="flex gap-1.5 shrink-0">
          <Button variant="secondary" size="sm" onClick={onEdit}>Editar</Button>
          <Button variant="danger" size="sm" onClick={onDelete}>×</Button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal aninhado — Editar step

function StepEditModal({
  workflowId, step, steps, onClose,
}: {
  workflowId: number
  step: WorkflowStep
  steps: WorkflowStep[]
  onClose: () => void
}) {
  const meta = stepTypeMeta(step.type)
  const update = useUpdateWorkflowStep(workflowId)

  const [name, setName] = useState(step.name)
  const [config, setConfig] = useState<Record<string, unknown>>(asRecord(step.config))
  const [nextStepId, setNextStepId] = useState<number | null>(step.nextStepId)
  const [altStepId, setAltStepId] = useState<number | null>(step.altStepId)

  function patchConfig(partial: Record<string, unknown>) {
    setConfig((c) => ({ ...c, ...partial }))
  }

  function replaceConfig(next: Record<string, unknown>) {
    setConfig(next)
  }

  function handleSave() {
    update.mutate(
      // Ramificação não tem "próximo passo": cada condição aponta o seu destino e
      // quem não casa nenhuma sai pelo "senão". Gravar null evita que um destino
      // pendurado volte a virar caminho padrão de quem foi filtrado fora.
      { stepId: step.id, name, config, nextStepId: isBranch ? null : nextStepId, altStepId },
      {
        onSuccess: () => { toast('Passo salvo', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      },
    )
  }

  const otherSteps = steps.filter((s) => s.id !== step.id)
  const isBranch = step.type === 'branch'
  const isCondition = step.type === 'condition' || isBranch

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Editar passo — ${meta.icon} ${meta.label}`}
      size="lg"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={update.isPending}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleSave} disabled={update.isPending}>
            {update.isPending ? 'Salvando…' : 'Salvar passo'}
          </Button>
        </>
      }
    >
      <div class="space-y-4">
        <Input
          label="Nome do passo"
          value={name}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
        />

        <StepConfigFields
          type={step.type}
          config={config}
          onPatch={patchConfig}
          onReplace={replaceConfig}
        />

        <div class="grid gap-3 grid-cols-1 sm:grid-cols-2">
          {isBranch ? (
            <div class="text-2xs text-fg-muted self-center">
              Cada condição acima aponta o próprio destino. Quem não casar nenhuma
              condição sai pelo caminho "senão" ao lado — se ele estiver vazio, o
              fluxo termina sem executar mais nada.
            </div>
          ) : (
          <div>
            <label class="text-xs font-medium text-fg-muted mb-1.5 block" for="step-next">Próximo passo (→)</label>
            <select
              id="step-next"
              value={nextStepId === null ? '' : String(nextStepId)}
              onChange={(e) => {
                const v = (e.target as HTMLSelectElement).value
                setNextStepId(v ? Number(v) : null)
              }}
              class="h-9 px-3 rounded-md bg-surface border border-border text-sm text-fg w-full focus:outline-none focus:border-accent"
            >
              <option value="">Nenhum (fim do fluxo)</option>
              {otherSteps.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <p class="text-2xs text-fg-muted mt-1">Para onde ir após este passo</p>
          </div>
          )}
          {isCondition ? (
            <div>
              <label class="text-xs font-medium text-fg-muted mb-1.5 block" for="step-alt">
                {isBranch ? 'Se nenhuma condição casar (Senão →)' : 'Se NÃO atender (Senão →)'}
              </label>
              <select
                id="step-alt"
                value={altStepId === null ? '' : String(altStepId)}
                onChange={(e) => {
                  const v = (e.target as HTMLSelectElement).value
                  setAltStepId(v ? Number(v) : null)
                }}
                class="h-9 px-3 rounded-md bg-surface border border-border text-sm text-fg w-full focus:outline-none focus:border-accent"
              >
                <option value="">Nenhum (fim do fluxo)</option>
                {otherSteps.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <p class="text-2xs text-fg-muted mt-1">Caminho alternativo quando a condição não é atendida</p>
            </div>
          ) : <div />}
        </div>
      </div>
    </Modal>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Campos de configuração por tipo de step

export function StepConfigFields({
  type, config, onPatch, onReplace,
}: {
  type: string
  config: Record<string, unknown>
  onPatch: (p: Record<string, unknown>) => void
  onReplace: (next: Record<string, unknown>) => void
}) {
  if (type === 'wait') return <WaitFields config={config} onPatch={onPatch} />
  if (type === 'condition') return <ConditionFields config={config} onPatch={onPatch} onReplace={onReplace} />
  if (type === 'action') return <ActionFields config={config} onPatch={onPatch} onReplace={onReplace} />
  if (type === 'trigger') return <EventSelectField label="Evento que inicia" hint="O evento que dispara este fluxo (geralmente configurado no fluxo, não no passo)" config={config} onPatch={onPatch} />
  if (type === 'goal') return <EventSelectField label="Meta atingida quando" hint="Quando este evento ocorrer, o fluxo é encerrado com sucesso" config={config} onPatch={onPatch} />
  if (type === 'branch') return <BranchFields config={config} onPatch={onPatch} />
  return null
}

// ─── WAIT ─────────────────────────────────────────────────────────────────────

function WaitFields({ config, onPatch }: { config: Record<string, unknown>; onPatch: (p: Record<string, unknown>) => void }) {
  return (
    <div class="grid gap-3 grid-cols-1 sm:grid-cols-2">
      <Input
        label="Aguardar"
        type="number"
        min={1}
        value={getNum(config, 'duration', 30)}
        onInput={(e) => onPatch({ duration: Number((e.target as HTMLInputElement).value) || 1 })}
        hint="Tempo que o fluxo vai esperar antes de continuar"
      />
      <Select
        label="Unidade de tempo"
        value={getStr(config, 'unit') || 'minutes'}
        onChange={(e) => onPatch({ unit: (e.target as HTMLSelectElement).value })}
      >
        {WAIT_UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
      </Select>
    </div>
  )
}

// ─── EVENT SELECT (trigger / goal) ────────────────────────────────────────────

function EventSelectField({ label, hint, config, onPatch }: { label: string; hint: string; config: Record<string, unknown>; onPatch: (p: Record<string, unknown>) => void }) {
  const { data: modulesData } = useModules()
  const enabledModules = useMemo(
    () => new Set((modulesData?.modules ?? []).filter((m) => m.enabled).map((m) => m.id)),
    [modulesData],
  )
  const events = useMemo(() => filterAvailableTriggers(enabledModules), [enabledModules])
  const groups = useMemo(() => {
    const out: Record<string, TriggerEvent[]> = {}
    for (const e of events) { if (!out[e.category]) out[e.category] = []; out[e.category]!.push(e) }
    return out
  }, [events])
  const order = ['lead', 'message', 'activity', 'sales', 'system', 'enrollment_portal', 'educational']
  return (
    <Select
      label={label}
      value={getStr(config, 'event')}
      onChange={(e) => onPatch({ event: (e.target as HTMLSelectElement).value })}
      hint={hint}
    >
      <option value="">— selecione um evento —</option>
      {order.filter((k) => groups[k] && groups[k]!.length > 0).map((k) => (
        <optgroup key={k} label={CATEGORY_LABELS[k as keyof typeof CATEGORY_LABELS]}>
          {groups[k]!.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </optgroup>
      ))}
    </Select>
  )
}

// ─── BRANCH ───────────────────────────────────────────────────────────────────

function BranchFields({ config, onPatch }: { config: Record<string, unknown>; onPatch: (p: Record<string, unknown>) => void }) {
  return (
    <Select
      label="Verificar campo do lead"
      value={getStr(config, 'field') || 'lead.status'}
      onChange={(e) => onPatch({ field: (e.target as HTMLSelectElement).value })}
      hint='O campo que será avaliado para decidir qual caminho seguir. Configure os caminhos usando "Próximo passo" e "Passo alternativo".'
    >
      {BRANCH_FIELD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </Select>
  )
}

// ─── CONDITION ────────────────────────────────────────────────────────────────

function ConditionFields({
  config, onPatch, onReplace,
}: {
  config: Record<string, unknown>
  onPatch: (p: Record<string, unknown>) => void
  onReplace: (next: Record<string, unknown>) => void
}) {
  const condType = getStr(config, 'type') || 'field'

  function changeType(next: string) {
    // Reset config quando trocar de tipo (mesma lógica do legado)
    onReplace(next === 'field' ? {} : next === 'contato_recente' ? { type: next, value: 30 } : { type: next })
  }

  return (
    <div class="space-y-3">
      <Select
        label="Verificar se..."
        value={condType}
        hint={CONDITION_HINTS[condType] ?? ''}
        onChange={(e) => changeType((e.target as HTMLSelectElement).value)}
      >
        {CONDITION_TYPES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
      </Select>

      {(condType === 'has_tag' || condType === 'not_has_tag') && (
        <TagSelectField
          label="Etiqueta"
          hint={condType === 'has_tag' ? 'Segue se o lead tiver esta etiqueta' : 'Segue se o lead NÃO tiver esta etiqueta'}
          value={getStr(config, 'tagName')}
          onChange={(v) => onPatch({ tagName: v })}
        />
      )}

      {(condType === 'lost_reason_in' || condType === 'lost_reason_not_in') && (
        <LossReasonsConditionField
          hint={condType === 'lost_reason_in'
            ? 'Segue se o lead foi marcado como Perdido com uma destas objeções'
            : 'Segue se o lead NÃO foi marcado como Perdido com estas objeções (inclui leads em andamento e ganhos)'}
          value={(config.reasonIds as number[] | undefined) ?? []}
          onChange={(ids) => onPatch({ reasonIds: ids })}
        />
      )}

      {condType === 'ab_split' && (
        <Input
          label="% que segue pelo caminho “Sim”"
          type="number"
          min={0}
          max={100}
          value={getNum(config, 'value', 50)}
          onInput={(e) => onPatch({ value: Math.min(100, Math.max(0, Number((e.target as HTMLInputElement).value) || 0)) })}
          hint="Divide os leads entre os dois caminhos para comparar duas mensagens. O sorteio é fixo por lead: o mesmo lead cai sempre do mesmo lado, então reprocessar o fluxo não troca a variante nem estraga a medição. Ligue o caminho “Sim” numa variante e o “Se NÃO atender” na outra"
        />
      )}

      {condType === 'stage_is' && (
        <StageSelectField
          label="Etapa"
          hint="Segue se o lead estiver nesta etapa do funil"
          value={getStr(config, 'value')}
          onChange={(v) => onPatch({ value: v })}
        />
      )}

      {(condType === 'message_contains' || condType === 'message_not_contains') && (
        <Textarea
          label="Trechos da mensagem"
          rows={4}
          value={Array.isArray(config.value) ? (config.value as unknown[]).map(String).join('\n') : getStr(config, 'value')}
          onInput={(e) => onPatch({ value: (e.target as HTMLTextAreaElement).value.split('\n') })}
          hint={condType === 'message_contains'
            ? 'Um trecho por linha — segue se a mensagem que disparou o fluxo tiver QUALQUER um. Ignora maiúsculas e acentos. Só funciona com o gatilho "Mensagem recebida".'
            : 'Um trecho por linha — segue se a mensagem NÃO tiver nenhum deles. Só funciona com o gatilho "Mensagem recebida".'}
        />
      )}

      {condType === 'source_is' && (
        <SourcesConditionField
          value={config.value}
          onChange={(next) => onPatch({ value: next })}
        />
      )}

      {condType === 'contato_recente' && (
        <Input
          label="Dias"
          type="number"
          min={1}
          value={getNum(config, 'value', 30)}
          onInput={(e) => onPatch({ value: Number((e.target as HTMLInputElement).value) || 30 })}
          hint="Segue se o lead entrou nesse período ou escreveu para nós nele. Quem não fala com a gente há mais tempo não recebe o follow-up — envio automático para base fria é o que leva número QR Code a ser bloqueado."
        />
      )}

      {condType === 'contato_recente' && (
        <Input
          label="Dias"
          type="number"
          min={1}
          value={getNum(config, 'value', 30)}
          onInput={(e) => onPatch({ value: Number((e.target as HTMLInputElement).value) || 30 })}
          hint="Segue se o lead entrou nesse período ou escreveu para nós nele. Quem não fala com a gente há mais tempo não recebe o follow-up — envio automático para base fria é o que leva número QR Code a ser bloqueado."
        />
      )}

      {condType === 'contato_recente' && (
        <Input
          label="Dias"
          type="number"
          min={1}
          value={getNum(config, 'value', 30)}
          onInput={(e) => onPatch({ value: Number((e.target as HTMLInputElement).value) || 30 })}
          hint="Segue se o lead entrou nesse período ou escreveu para nós nele. Quem não fala com a gente há mais tempo não recebe o follow-up — envio automático para base fria é o que leva número QR Code a ser bloqueado."
        />
      )}

      {condType === 'contato_recente' && (
        <Input
          label="Dias"
          type="number"
          min={1}
          value={getNum(config, 'value', 30)}
          onInput={(e) => onPatch({ value: Number((e.target as HTMLInputElement).value) || 30 })}
          hint="Segue se o lead entrou nesse período ou escreveu para nós nele. Quem não fala com a gente há mais tempo não recebe o follow-up — envio automático para base fria é o que leva número QR Code a ser bloqueado."
        />
      )}

      {condType === 'time_since' && (
        <div class="grid gap-3 grid-cols-1 sm:grid-cols-3">
          <Select
            label="Tempo desde"
            value={getStr(config, 'field')}
            onChange={(e) => onPatch({ field: (e.target as HTMLSelectElement).value })}
          >
            {TIME_SINCE_FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </Select>
          <Select
            label="Comparação"
            value={getStr(config, 'operator')}
            onChange={(e) => onPatch({ operator: (e.target as HTMLSelectElement).value })}
          >
            {TIME_SINCE_OPERATORS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
          <Input
            label="Horas"
            type="number"
            min={1}
            value={getNum(config, 'value', 24)}
            onInput={(e) => onPatch({ value: Number((e.target as HTMLInputElement).value) || 1 })}
            hint="Quantidade de horas"
          />
        </div>
      )}

      {condType === 'field' && (
        <div class="grid gap-3 grid-cols-1 sm:grid-cols-3">
          <Select
            label="Campo do lead"
            value={getStr(config, 'field') || 'lead.status'}
            onChange={(e) => onPatch({ field: (e.target as HTMLSelectElement).value })}
          >
            {FIELD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
          <Select
            label="Comparação"
            value={getStr(config, 'operator') || 'equals'}
            onChange={(e) => onPatch({ operator: (e.target as HTMLSelectElement).value })}
          >
            {OPERATORS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
          <Input
            label="Valor"
            value={getStr(config, 'value')}
            onInput={(e) => onPatch({ value: (e.target as HTMLInputElement).value })}
            hint="O valor esperado para a condição ser verdadeira"
          />
        </div>
      )}
    </div>
  )
}

// ─── ACTION ───────────────────────────────────────────────────────────────────

function ActionFields({
  config, onPatch, onReplace,
}: {
  config: Record<string, unknown>
  onPatch: (p: Record<string, unknown>) => void
  onReplace: (next: Record<string, unknown>) => void
}) {
  const actionType = getStr(config, 'actionType') || 'send_whatsapp'

  function changeAction(next: string) {
    onReplace({ actionType: next })
  }

  return (
    <div class="space-y-3">
      <Select
        label="O que fazer"
        value={actionType}
        onChange={(e) => changeAction((e.target as HTMLSelectElement).value)}
      >
        {ACTION_TYPES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
      </Select>

      {actionType === 'send_whatsapp' && (
        <SendMessageFields
          channel="whatsapp"
          config={config}
          onPatch={onPatch}
          messageHint="Variáveis: {{nome}}, {{empresa}}, {{whatsapp}}, {{email}}, {{candidateCode}}, {{courseName}}, {{paymentUrl}}, {{candidateUrl}}, {{reviewNote}}, {{docName}}..."
          messageRows={4}
          messageLabel="Mensagem inline (opcional, fallback)"
        />
      )}

      {actionType === 'send_sms' && (
        <SendMessageFields
          channel="sms"
          config={config}
          onPatch={onPatch}
          messageHint="Envio via Comtele. Configure a API key em Configurações → SMS. Variáveis: {{nome}}, {{candidateCode}}, {{paymentUrl}}..."
          messageRows={3}
          messageLabel="Mensagem SMS inline (opcional)"
        />
      )}

      {actionType === 'send_email' && (
        <SendEmailFields config={config} onPatch={onPatch} />
      )}

      {actionType === 'change_stage' && (
        <StageSelectField
          label="Mover para etapa"
          hint="O lead será movido automaticamente para esta etapa do funil"
          value={getStr(config, 'stageKey')}
          onChange={(v) => onPatch({ stageKey: v })}
        />
      )}

      {actionType === 'add_tag' && <AddTagFields config={config} onPatch={onPatch} />}
      {actionType === 'remove_tag' && (
        <TagSelectField
          label="Remover etiqueta"
          hint="A etiqueta será removida do lead"
          value={getStr(config, 'tagName')}
          onChange={(v) => onPatch({ tagName: v })}
        />
      )}

      {actionType === 'create_task' && <CreateTaskFields config={config} onPatch={onPatch} />}
      {actionType === 'set_summary' && <SetSummaryFields config={config} onPatch={onPatch} />}
      {actionType === 'webhook' && <WebhookFields config={config} onPatch={onPatch} />}

      {actionType === 'assign_to_team' && (
        <TeamSelectField
          label="Atribuir ao setor"
          hint="O lead será movido para este setor. Se houver operador atribuído que não pertença a ele, será liberado."
          value={getNum(config, 'teamId')}
          onChange={(v) => onPatch({ teamId: v })}
        />
      )}
      {actionType === 'assign_to_user' && (
        <UserSelectField
          label="Atribuir ao operador"
          hint="O lead será atribuído a este operador. Se necessário, o setor será ajustado automaticamente."
          value={getNum(config, 'userId')}
          onChange={(v) => onPatch({ userId: v })}
        />
      )}
      {actionType === 'transfer_to_team' && (
        <>
          <TeamSelectField
            label="Transferir para o setor"
            hint="Lead volta para a fila do setor escolhido (operador atribuído é liberado)."
            value={getNum(config, 'teamId')}
            onChange={(v) => onPatch({ teamId: v })}
          />
          <Textarea
            label="Motivo (opcional)"
            value={getStr(config, 'reason')}
            onInput={(e) => onPatch({ reason: (e.target as HTMLTextAreaElement).value })}
            rows={2}
            placeholder="Ex.: Cliente pediu suporte financeiro. Variáveis: {{nome}}, {{empresa}}…"
            hint="Vai aparecer na timeline do lead. Suporta {{nome}}, {{empresa}}, etc."
          />
        </>
      )}

      {actionType === 'notify_operator' && <NotifyOperatorFields config={config} onPatch={onPatch} />}
      {actionType === 'set_campaign' && (
        <Input
          label="Nome da campanha"
          value={getStr(config, 'campaignName')}
          onInput={(e) => onPatch({ campaignName: (e.target as HTMLInputElement).value })}
          hint='Preenche o campo "Campanha" do lead (aba Rastreamento). Útil quando a origem (ex.: WhatsApp Ads) não manda um nome de campanha amigável.'
        />
      )}
    </div>
  )
}

// ─── notify_operator ──────────────────────────────────────────────────────────
// Avisa a EQUIPE (não o lead). Destinatários = Configurações › Empresa ›
// Notificações (WhatsApp por Evolution + e-mail). Cada canal usa seu template;
// deixar um template vazio desliga aquele canal. Variáveis extras: {{etapa}}
// (nome da etapa), {{operador}}, {{origem}}.
function NotifyOperatorFields({ config, onPatch }: { config: Record<string, unknown>; onPatch: (p: Record<string, unknown>) => void }) {
  const waRaw = config.waTemplateId
  const waId = typeof waRaw === 'number' ? waRaw : (typeof waRaw === 'string' && waRaw !== '' ? Number(waRaw) : undefined)
  const emRaw = config.emailTemplateId
  const emId = typeof emRaw === 'number' ? emRaw : (typeof emRaw === 'string' && emRaw !== '' ? Number(emRaw) : undefined)
  return (
    <>
      <p class="text-xs text-slate-500">
        Envia para os contatos de <b>Configurações › Empresa › Notificações</b>. Variáveis:{' '}
        {'{{nome}}, {{whatsapp}}, {{email}}, {{empresa}}, {{cidade}}, {{etapa}}, {{origem}}'}
      </p>
      <div class="space-y-1">
        <span class="text-xs font-semibold text-fg">📱 WhatsApp (deixe vazio para não enviar)</span>
        <TemplateSelector
          channel="whatsapp"
          value={waId}
          onChange={(v) => onPatch({ waTemplateId: v })}
        />
      </div>
      <div class="space-y-1">
        <span class="text-xs font-semibold text-fg">✉️ E-mail (deixe vazio para não enviar)</span>
        <TemplateSelector
          channel="email"
          value={emId}
          onChange={(v) => onPatch({ emailTemplateId: v })}
        />
      </div>
    </>
  )
}

// ─── Helpers — selects de tag/stage/template ──────────────────────────────────

function TeamSelectField({ label, hint, value, onChange }: { label: string; hint?: string | undefined; value: number; onChange: (v: number | null) => void }) {
  const { data, isLoading } = useTeams()
  const teams = (data?.teams ?? []).filter((t) => t.active)
  return (
    <Select
      label={label}
      value={value > 0 ? String(value) : ''}
      onChange={(e) => {
        const v = (e.target as HTMLSelectElement).value
        onChange(v ? Number(v) : null)
      }}
      hint={hint ?? ''}
    >
      <option value="">{isLoading ? 'Carregando equipes…' : 'Selecione uma equipe'}</option>
      {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
    </Select>
  )
}

function UserSelectField({ label, hint, value, onChange }: { label: string; hint?: string | undefined; value: number; onChange: (v: number | null) => void }) {
  const { data, isLoading } = useUsers()
  const users = (data?.users ?? []).filter((u) => u.active)
  return (
    <Select
      label={label}
      value={value > 0 ? String(value) : ''}
      onChange={(e) => {
        const v = (e.target as HTMLSelectElement).value
        onChange(v ? Number(v) : null)
      }}
      hint={hint ?? ''}
    >
      <option value="">{isLoading ? 'Carregando operadores…' : 'Selecione um operador'}</option>
      {users.map((u) => (
        <option key={u.id} value={u.id}>{u.name || u.email}</option>
      ))}
    </Select>
  )
}

function TagSelectField({ label, hint, value, onChange }: { label: string; hint?: string | undefined; value: string; onChange: (v: string) => void }) {
  const { data } = useTags()
  return (
    <Select
      label={label}
      value={value}
      onChange={(e) => onChange((e.target as HTMLSelectElement).value)}
      hint={hint ?? ''}
    >
      <option value="">Selecione uma etiqueta</option>
      {data?.tags.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
    </Select>
  )
}

function StageSelectField({ label, hint, value, onChange }: { label: string; hint?: string | undefined; value: string; onChange: (v: string) => void }) {
  const { data } = useStages()
  return (
    <Select
      label={label}
      value={value}
      onChange={(e) => onChange((e.target as HTMLSelectElement).value)}
      hint={hint ?? ''}
    >
      <option value="">Selecione a etapa</option>
      {data?.stages.map((s) => <option key={s.id} value={s.key}>{s.name}</option>)}
    </Select>
  )
}

/** Origens do lead na condição "A origem do lead é".
 *
 *  Era um Select de uma origem só, e cobrir "veio de campanha paga" (seis
 *  origens diferentes) exigia seis condições encadeadas. O motor já compara
 *  lista, então aqui a seleção é múltipla — vale como "qualquer uma destas". */
function SourcesConditionField({
  value, onChange,
}: {
  value: unknown
  onChange: (next: string[]) => void
}) {
  const selecionadas = Array.isArray(value)
    ? value.map(String)
    : typeof value === 'string' && value
      ? value.split(',').map((v) => v.trim()).filter(Boolean)
      : []
  const selected = new Set(selecionadas)

  function toggle(v: string) {
    const next = new Set(selected)
    if (next.has(v)) next.delete(v)
    else next.add(v)
    onChange(Array.from(next))
  }

  return (
    <div>
      <label class="text-xs font-medium text-fg block mb-1.5">Origens</label>
      <p class="text-[0.6875rem] text-fg-subtle mb-2">
        Segue se o lead veio de QUALQUER uma das origens marcadas. Sem nenhuma marcada a condição nunca é atendida.
      </p>
      <div class="flex flex-wrap gap-1.5">
        {SOURCE_OPTIONS.map((s) => {
          const on = selected.has(s.value)
          return (
            <button
              key={s.value}
              type="button"
              class={cn(
                'inline-flex items-center gap-1 px-2 h-7 rounded-md border text-xs transition-colors',
                on ? 'border-transparent bg-accent text-fg-on-brand' : 'border-border bg-surface-2 text-fg-muted hover:bg-surface-3',
              )}
              onClick={() => toggle(s.value)}
            >
              {s.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function LossReasonsConditionField({
  hint, value, onChange,
}: {
  hint?: string | undefined
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
        <label class="text-xs font-medium text-fg">Objeções</label>
        <a
          href="/app/settings"
          target="_blank"
          rel="noreferrer"
          class="text-2xs text-accent hover:underline"
          title="Cadastrar objeções"
        >
          Gerenciar
        </a>
      </div>
      {hint && <p class="text-2xs text-fg-muted mb-2">{hint}</p>}
      {isLoading ? (
        <div class="text-xs text-fg-muted">Carregando…</div>
      ) : items.length === 0 ? (
        <div class="text-xs text-fg-muted">Nenhuma objeção cadastrada.</div>
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

function TemplateSelector({ channel, value, onChange }: { channel: string; value: number | undefined; onChange: (v: number | undefined) => void }) {
  const { data } = useTemplates({ channel })
  const items = (data?.templates ?? []).filter((t) => t.active !== false)
  return (
    <div class="rounded-md border border-info/30 bg-info/10 p-3 space-y-1.5">
      <label class="text-xs font-medium text-info block" for={`tpl-${channel}`}>
        Modelo (recomendado)
      </label>
      <select
        id={`tpl-${channel}`}
        value={value === undefined ? '' : String(value)}
        onChange={(e) => {
          const v = (e.target as HTMLSelectElement).value
          onChange(v ? Number(v) : undefined)
        }}
        class="h-9 px-3 rounded-md bg-surface border border-border text-sm text-fg w-full focus:outline-none focus:border-accent"
      >
        <option value="">— sem modelo (usar texto inline abaixo) —</option>
        {items.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      <p class="text-2xs text-fg-muted">
        Selecione um modelo salvo. Editáveis em <strong>Captação → Modelos</strong>. Se vazio, usa o texto manual.
      </p>
    </div>
  )
}

// ─── send_whatsapp / send_sms ─────────────────────────────────────────────────

function SendMessageFields({
  channel, config, onPatch, messageHint, messageRows, messageLabel,
}: {
  channel: string
  config: Record<string, unknown>
  onPatch: (p: Record<string, unknown>) => void
  messageHint: string
  messageRows: number
  messageLabel: string
}) {
  const tplRaw = config.templateId
  const tplId = typeof tplRaw === 'number' ? tplRaw : (typeof tplRaw === 'string' && tplRaw !== '' ? Number(tplRaw) : undefined)
  return (
    <>
      {/* API Oficial (Cloud API): quando há conexão ativa, o disparo p/ lead frio
          exige um template HSM aprovado. Só faz sentido no canal WhatsApp. */}
      {channel === 'whatsapp' && <CloudTemplateFields config={config} onPatch={onPatch} />}
      <TemplateSelector
        channel={channel}
        value={tplId}
        onChange={(v) => onPatch({ templateId: v })}
      />
      <Textarea
        label={messageLabel}
        rows={messageRows}
        value={getStr(config, 'message')}
        onInput={(e) => onPatch({ message: (e.target as HTMLTextAreaElement).value })}
        hint={messageHint}
      />
    </>
  )
}

type TemplateParam = { type: 'lead_field' | 'custom_field' | 'fixed'; value: string; fallback?: string }

/** Conta as variáveis posicionais {{1}}..{{n}} num template HSM (header TEXT + body). */
function countTemplateVars(components: unknown): number {
  let max = 0
  if (Array.isArray(components)) {
    for (const c of components as any[]) {
      const t = String(c?.type || '').toUpperCase()
      const text = (t === 'BODY' || (t === 'HEADER' && c?.format === 'TEXT')) ? String(c?.text || '') : ''
      for (const m of text.matchAll(/\{\{(\d+)\}\}/g)) max = Math.max(max, Number(m[1]))
    }
  }
  return max
}

const LEAD_FIELDS = [
  { value: 'nome', label: 'Nome do lead' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'email', label: 'E-mail' },
  { value: 'empresa', label: 'Empresa' },
]

function CloudTemplateFields({ config, onPatch }: { config: Record<string, unknown>; onPatch: (p: Record<string, unknown>) => void }) {
  const { data } = useCloudApiTemplates()
  const { data: cfData } = useCustomFields()
  const approved = (data?.templates ?? []).filter((t) => t.status === 'APPROVED')

  const rawId = config.cloudTemplateId
  const cloudTemplateId = typeof rawId === 'number' ? rawId : (typeof rawId === 'string' && rawId !== '' ? Number(rawId) : undefined)
  const selected = approved.find((t) => t.id === cloudTemplateId)
  const varCount = selected ? countTemplateVars(selected.components) : 0
  const params = (Array.isArray(config.templateParams) ? config.templateParams : []) as TemplateParam[]

  function setTemplate(id: number | undefined) {
    if (id === undefined) { onPatch({ cloudTemplateId: undefined, templateParams: [] }); return }
    const tpl = approved.find((t) => t.id === id)
    const n = tpl ? countTemplateVars(tpl.components) : 0
    // Preserva mapeamentos já feitos; completa/apara para n variáveis.
    const next: TemplateParam[] = Array.from({ length: n }, (_, i) => params[i] ?? { type: 'lead_field', value: 'nome' })
    onPatch({ cloudTemplateId: id, templateParams: next })
  }

  function setParam(i: number, patch: Partial<TemplateParam>) {
    const next = params.slice()
    next[i] = { ...(next[i] ?? { type: 'lead_field', value: '' }), ...patch }
    onPatch({ templateParams: next })
  }

  return (
    <div class="rounded-md border border-success/30 bg-success/10 p-3 space-y-2">
      <label class="text-xs font-medium text-success block" for="cloud-hsm">
        API Oficial — Template aprovado (Cloud API)
      </label>
      <select
        id="cloud-hsm"
        value={cloudTemplateId === undefined ? '' : String(cloudTemplateId)}
        onChange={(e) => { const v = (e.target as HTMLSelectElement).value; setTemplate(v ? Number(v) : undefined) }}
        class="h-9 px-3 rounded-md bg-surface border border-border text-sm text-fg w-full focus:outline-none focus:border-accent"
      >
        <option value="">— não usar API Oficial (envio por texto via QR Code) —</option>
        {approved.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.language})</option>)}
      </select>
      {approved.length === 0 && (
        <p class="text-[0.6875rem] text-warning">
          Nenhum template aprovado. Crie e aprove em <strong>WhatsApp → Templates</strong>.
        </p>
      )}

      {selected && varCount > 0 && (
        <div class="space-y-2 pt-1">
          <p class="text-[0.6875rem] text-fg-muted">
            Preencha cada variável do template com um campo do lead, campo personalizado ou valor fixo:
          </p>
          {Array.from({ length: varCount }, (_, i) => {
            const p = params[i] ?? { type: 'lead_field', value: '' }
            return (
              <div key={i} class="space-y-1">
              <div class="flex items-center gap-1.5">
                <span class="text-xs font-mono text-fg-muted w-9 shrink-0">{`{{${i + 1}}}`}</span>
                <select
                  value={p.type}
                  onChange={(e) => setParam(i, { type: (e.target as HTMLSelectElement).value as TemplateParam['type'], value: '' })}
                  class="h-8 px-2 rounded-md bg-surface border border-border text-xs text-fg shrink-0 focus:outline-none focus:border-accent"
                >
                  <option value="lead_field">Campo do lead</option>
                  <option value="custom_field">Campo personalizado</option>
                  <option value="fixed">Valor fixo</option>
                </select>
                {p.type === 'fixed' ? (
                  <input
                    value={p.value}
                    onInput={(e) => setParam(i, { value: (e.target as HTMLInputElement).value })}
                    placeholder="Texto fixo"
                    class="h-8 px-2 rounded-md bg-surface border border-border text-xs text-fg w-full focus:outline-none focus:border-accent"
                  />
                ) : (
                  <select
                    value={p.value}
                    onChange={(e) => setParam(i, { value: (e.target as HTMLSelectElement).value })}
                    class="h-8 px-2 rounded-md bg-surface border border-border text-xs text-fg w-full focus:outline-none focus:border-accent"
                  >
                    <option value="">Selecione…</option>
                    {(p.type === 'lead_field' ? LEAD_FIELDS : (cfData?.fields ?? []).map((f) => ({ value: f.key, label: f.label }))).map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                )}
              </div>
              {/* A Meta recusa o disparo inteiro quando uma variável chega vazia.
                  Este texto substitui o campo em branco e salva a mensagem. */}
              {p.type !== 'fixed' && (
                <div class="flex items-center gap-1.5 pl-[2.625rem]">
                  <span class="text-[0.6875rem] text-fg-subtle shrink-0">Se vazio, usar:</span>
                  <input
                    value={p.fallback ?? ''}
                    onInput={(e) => setParam(i, { fallback: (e.target as HTMLInputElement).value })}
                    placeholder="ex.: candidato(a)"
                    class="h-7 px-2 rounded-md bg-surface border border-border text-xs text-fg w-full focus:outline-none focus:border-accent"
                  />
                </div>
              )}
              </div>
            )
          })}
        </div>
      )}
      <p class="text-[0.6875rem] text-fg-subtle">
        Com um template selecionado, este passo envia pela <strong>API Oficial</strong>. Vazio = envio por texto livre (QR Code).
      </p>
    </div>
  )
}

// ─── send_email ───────────────────────────────────────────────────────────────

function SendEmailFields({ config, onPatch }: { config: Record<string, unknown>; onPatch: (p: Record<string, unknown>) => void }) {
  const tplRaw = config.templateId
  const tplId = typeof tplRaw === 'number' ? tplRaw : (typeof tplRaw === 'string' && tplRaw !== '' ? Number(tplRaw) : undefined)
  return (
    <>
      <TemplateSelector
        channel="email"
        value={tplId}
        onChange={(v) => onPatch({ templateId: v })}
      />
      <Input
        label="Assunto inline (opcional, fallback)"
        value={getStr(config, 'subject')}
        onInput={(e) => onPatch({ subject: (e.target as HTMLInputElement).value })}
        hint="Variáveis: {{nome}}, {{candidateCode}}, {{docName}}..."
      />
      <Textarea
        label="Corpo inline (HTML, opcional)"
        rows={5}
        value={getStr(config, 'body')}
        onInput={(e) => onPatch({ body: (e.target as HTMLTextAreaElement).value })}
        hint="Usado se nenhum modelo selecionado."
      />
    </>
  )
}

// ─── add_tag ──────────────────────────────────────────────────────────────────

function AddTagFields({ config, onPatch }: { config: Record<string, unknown>; onPatch: (p: Record<string, unknown>) => void }) {
  const { data } = useTags()
  // No legado, "tagNameCustom" prevalece se preenchido. Trato como se sempre escrevemos no `tagName`.
  // Se o usuário digita texto livre, vai parar em `tagName` direto.
  const [customTag, setCustomTag] = useState('')

  useEffect(() => {
    if (customTag.trim() !== '') {
      onPatch({ tagName: customTag.trim() })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customTag])

  return (
    <>
      <Select
        label="Adicionar etiqueta"
        value={getStr(config, 'tagName')}
        onChange={(e) => { setCustomTag(''); onPatch({ tagName: (e.target as HTMLSelectElement).value }) }}
        hint="A etiqueta será adicionada ao lead. Se não existir, será criada automaticamente."
      >
        <option value="">Selecione ou digite</option>
        {data?.tags.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
      </Select>
      <Input
        label="Ou digite uma nova etiqueta"
        value={customTag}
        onInput={(e) => setCustomTag((e.target as HTMLInputElement).value)}
        placeholder="Nome da nova etiqueta"
        hint="Se preencher aqui, será usado no lugar do menu acima"
      />
    </>
  )
}

// ─── create_task ──────────────────────────────────────────────────────────────

function CreateTaskFields({ config, onPatch }: { config: Record<string, unknown>; onPatch: (p: Record<string, unknown>) => void }) {
  return (
    <>
      <div class="grid gap-3 grid-cols-1 sm:grid-cols-2">
        <Input
          label="Título da tarefa"
          value={getStr(config, 'title')}
          onInput={(e) => onPatch({ title: (e.target as HTMLInputElement).value })}
          hint="Variáveis: {{nome}}, {{empresa}}"
        />
        <Select
          label="Tipo"
          value={getStr(config, 'taskType') || 'task'}
          onChange={(e) => onPatch({ taskType: (e.target as HTMLSelectElement).value })}
        >
          {TASK_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      </div>
      <Textarea
        label="Descrição (opcional)"
        rows={2}
        value={getStr(config, 'description')}
        onInput={(e) => onPatch({ description: (e.target as HTMLTextAreaElement).value })}
      />
      <div class="grid gap-3 grid-cols-1 sm:grid-cols-2">
        <Select
          label="Prazo"
          value={getStr(config, 'dueMode') || 'immediate'}
          onChange={(e) => onPatch({ dueMode: (e.target as HTMLSelectElement).value })}
        >
          {DUE_MODE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
        <Input
          label="Valor (N)"
          type="number"
          value={getStr(config, 'dueValue')}
          onInput={(e) => onPatch({ dueValue: Number((e.target as HTMLInputElement).value) })}
          hint="Ignorado quando o prazo é imediato"
        />
      </div>
      <div class="grid gap-3 grid-cols-1 sm:grid-cols-2">
        <Select
          label="Responsável"
          value={getStr(config, 'assigneeMode') || 'lead_owner'}
          onChange={(e) => onPatch({ assigneeMode: (e.target as HTMLSelectElement).value })}
        >
          {ASSIGNEE_MODE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
        <Input
          label="ID do setor / operador"
          type="number"
          value={getStr(config, 'assigneeTeamId') || getStr(config, 'assigneeUserId')}
          onInput={(e) => {
            const v = Number((e.target as HTMLInputElement).value) || null
            const mode = getStr(config, 'assigneeMode') || 'lead_owner'
            onPatch(mode === 'user' ? { assigneeUserId: v } : { assigneeTeamId: v })
          }}
          hint="Necessário para fila do setor, rodízio ou pessoa fixa"
        />
      </div>
    </>
  )
}

// ─── set_summary ──────────────────────────────────────────────────────────────

function SetSummaryFields({ config, onPatch }: { config: Record<string, unknown>; onPatch: (p: Record<string, unknown>) => void }) {
  return (
    <>
      <Input
        label="Código do resumo"
        value={getStr(config, 'code')}
        onInput={(e) => onPatch({ code: (e.target as HTMLInputElement).value.toUpperCase() })}
        placeholder="AT-021"
        hint="O motor move a etapa, cria as atividades e classifica ganho/perdido conforme o resumo configurado em Cadastros › Resumos"
      />
      <Textarea
        label="Observação (opcional)"
        rows={2}
        value={getStr(config, 'note')}
        onInput={(e) => onPatch({ note: (e.target as HTMLTextAreaElement).value })}
      />
    </>
  )
}

// ─── webhook ──────────────────────────────────────────────────────────────────

function WebhookFields({ config, onPatch }: { config: Record<string, unknown>; onPatch: (p: Record<string, unknown>) => void }) {
  return (
    <>
      <Input
        label="URL do webhook"
        type="url"
        value={getStr(config, 'url')}
        onInput={(e) => onPatch({ url: (e.target as HTMLInputElement).value })}
        placeholder="https://exemplo.com/webhook"
        hint="Os dados do lead serão enviados como JSON no body da requisição"
      />
      <Select
        label="Método HTTP"
        value={getStr(config, 'method') || 'POST'}
        onChange={(e) => onPatch({ method: (e.target as HTMLSelectElement).value })}
      >
        {HTTP_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
      </Select>
    </>
  )
}
