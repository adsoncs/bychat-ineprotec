import { useState, useMemo } from 'preact/hooks'
import { Plus, Trash2, Pencil, Check, X, ArrowUp, ArrowDown, Layers, AlignLeft, Mail, Phone, Hash, ListChecks, ListPlus, Calendar, MapPin, IdCard, Building2 } from 'lucide-preact'
import {
  useChatQuestions,
  useCreateChatQuestion,
  useUpdateChatQuestion,
  useDeleteChatQuestion,
  useReorderChatQuestions,
  type ChatQuestion,
  type ChatQuestionInput,
  type ChatQuestionType,
} from '@/hooks/useChatbots'
import { Button } from '@/components/ui/Button'
import { Input, Textarea, Select } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { SortableList } from '@/components/ui/SortableList'
import { toast } from '@/lib/toast'

const TYPES: { value: ChatQuestionType; label: string; icon: preact.JSX.Element }[] = [
  { value: 'text',         label: 'Texto livre',     icon: <AlignLeft size={11} /> },
  { value: 'email',        label: 'E-mail',          icon: <Mail size={11} /> },
  { value: 'phone',        label: 'Telefone',        icon: <Phone size={11} /> },
  { value: 'number',       label: 'Número',          icon: <Hash size={11} /> },
  { value: 'select',       label: 'Lista (1 opção)', icon: <ListChecks size={11} /> },
  { value: 'multi_select', label: 'Lista (várias)',  icon: <ListPlus size={11} /> },
  { value: 'date',         label: 'Data',            icon: <Calendar size={11} /> },
  { value: 'cep',          label: 'CEP',             icon: <MapPin size={11} /> },
  { value: 'cpf',          label: 'CPF',             icon: <IdCard size={11} /> },
  { value: 'cnpj',         label: 'CNPJ',            icon: <Building2 size={11} /> },
]

function typeLabel(t: string) {
  return TYPES.find((x) => x.value === t)?.label ?? t
}

interface Props {
  chatbotId: number
}

interface StageGroup {
  stage: number
  items: ChatQuestion[]
}

function groupByStage(questions: ChatQuestion[]): StageGroup[] {
  const map = new Map<number, ChatQuestion[]>()
  for (const q of questions) {
    const arr = map.get(q.stage) ?? []
    arr.push(q)
    map.set(q.stage, arr)
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a - b)
    .map(([stage, items]) => ({
      stage,
      items: items.sort((a, b) => a.position - b.position),
    }))
}

export function ChatbotQuestionsEditor({ chatbotId }: Props) {
  const { data, isLoading } = useChatQuestions(chatbotId)
  const create = useCreateChatQuestion(chatbotId)
  const update = useUpdateChatQuestion(chatbotId)
  const reorder = useReorderChatQuestions(chatbotId)
  const del = useDeleteChatQuestion(chatbotId)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [creatingInStage, setCreatingInStage] = useState<number | null>(null)
  const [deleting, setDeleting] = useState<ChatQuestion | null>(null)

  const questions = useMemo(() => data?.questions ?? [], [data?.questions])
  const stages = useMemo(() => groupByStage(questions), [questions])
  const stageNumbers = stages.map((g) => g.stage)
  const nextStage = stageNumbers.length === 0 ? 1 : Math.max(...stageNumbers) + 1

  function handleCreate(stage: number, input: ChatQuestionInput) {
    const inStage = questions.filter((q) => q.stage === stage)
    const maxPos = inStage.reduce((acc, q) => Math.max(acc, q.position), -1)
    create.mutate({ ...input, stage, position: maxPos + 1 }, {
      onSuccess: () => { toast('Pergunta adicionada', 'success'); setCreatingInStage(null) },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function handleReorderInStage(stage: number, ordered: ChatQuestion[]) {
    // Outros stages permanecem como estão; só reescreve positions desta stage.
    const order = [
      ...questions.filter((q) => q.stage !== stage).map((q) => ({ id: q.id, stage: q.stage, position: q.position })),
      ...ordered.map((q, idx) => ({ id: q.id, stage, position: idx })),
    ]
    reorder.mutate(order, { onError: (e: unknown) => toast((e as Error).message, 'danger') })
  }

  function moveStage(question: ChatQuestion, direction: -1 | 1) {
    const idx = stageNumbers.indexOf(question.stage)
    let target: number
    if (direction === -1) {
      // Sobe uma etapa: se já estiver na primeira, cria nova stage 0 (ou stage anterior).
      if (idx <= 0) {
        target = question.stage - 1
      } else {
        target = stageNumbers[idx - 1]!
      }
    } else {
      // Desce: se for última, cria próxima.
      if (idx === -1 || idx === stageNumbers.length - 1) {
        target = question.stage + 1
      } else {
        target = stageNumbers[idx + 1]!
      }
    }
    update.mutate({ qid: question.id, stage: target }, {
      onSuccess: () => toast(`Movida para Etapa ${target + 1}`, 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <div class="space-y-3">
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <div class="text-xs text-fg-muted">
          O chatbot pergunta cada item em sequência, agrupando por <strong>etapa</strong>. Cada etapa pode representar
          uma fase do funil (qualificação inicial, detalhes, fechamento). Use as setas para mover perguntas entre etapas.
        </div>
        {questions.length > 0 && (
          <Button size="sm" variant="secondary" onClick={() => setCreatingInStage(nextStage - 1)}>
            <Layers size={12} /> Nova etapa
          </Button>
        )}
      </div>

      {isLoading && <Skeleton class="h-32 w-full" />}

      {!isLoading && questions.length === 0 && creatingInStage === null && (
        <div class="rounded-md border border-dashed border-border p-6 text-center">
          <div class="text-sm text-fg-muted">Nenhuma pergunta cadastrada.</div>
          <Button size="sm" variant="primary" onClick={() => setCreatingInStage(0)} class="mt-3">
            <Plus size={12} /> Criar primeira pergunta
          </Button>
        </div>
      )}

      {stages.map((group) => (
        <StageBlock
          key={group.stage}
          group={group}
          totalStages={stageNumbers.length}
          editingId={editingId}
          onStartEdit={setEditingId}
          onCancelEdit={() => setEditingId(null)}
          onAddInStage={() => setCreatingInStage(group.stage)}
          onDelete={setDeleting}
          onMoveStage={moveStage}
          onReorder={(ordered) => handleReorderInStage(group.stage, ordered)}
          chatbotId={chatbotId}
        />
      ))}

      {creatingInStage !== null && (
        <div class="rounded-md border border-accent bg-surface-2 p-3 space-y-2">
          <div class="text-xs font-medium text-fg-muted">
            Nova pergunta · Etapa {creatingInStage + 1}
          </div>
          <NewQuestionForm
            onCancel={() => setCreatingInStage(null)}
            onSubmit={(input) => handleCreate(creatingInStage, input)}
            saving={create.isPending}
          />
        </div>
      )}

      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(o) => { if (!o) setDeleting(null) }}
          title={`Excluir "${deleting.text}"?`}
          description="A pergunta é removida permanentemente. Conversas em andamento que já passaram desta pergunta não são afetadas."
          destructive
          confirmLabel="Excluir"
          loading={del.isPending}
          onConfirm={() => del.mutate(deleting.id, {
            onSuccess: () => { toast('Pergunta excluída', 'success'); setDeleting(null) },
            onError: (e: unknown) => toast((e as Error).message, 'danger'),
          })}
        />
      )}
    </div>
  )
}

function StageBlock({
  group, totalStages, editingId, onStartEdit, onCancelEdit, onAddInStage, onDelete, onMoveStage, onReorder, chatbotId,
}: {
  group: StageGroup
  totalStages: number
  editingId: number | null
  onStartEdit: (id: number) => void
  onCancelEdit: () => void
  onAddInStage: () => void
  onDelete: (q: ChatQuestion) => void
  onMoveStage: (q: ChatQuestion, direction: -1 | 1) => void
  onReorder: (ordered: ChatQuestion[]) => void
  chatbotId: number
}) {
  const { stage, items } = group
  return (
    <div class="rounded-md border border-border">
      <div class="flex items-center justify-between gap-2 px-3 py-2 bg-surface-2 border-b border-border">
        <div class="flex items-center gap-2">
          <Layers size={12} class="text-fg-muted" />
          <span class="text-sm font-medium text-fg">Etapa {stage + 1}</span>
          <span class="text-[0.6875rem] text-fg-subtle tabular-nums">· {items.length} pergunta{items.length === 1 ? '' : 's'}</span>
        </div>
        <Button size="sm" variant="ghost" onClick={onAddInStage}>
          <Plus size={11} /> Adicionar nesta etapa
        </Button>
      </div>
      <div class="bg-surface p-2">
        <SortableList
          items={items}
          onReorder={onReorder}
          renderItem={(q) => {
            const idxInStage = items.findIndex((x) => x.id === q.id)
            return editingId === q.id ? (
              <div class="bg-surface-2 rounded-md">
                <EditQuestionForm
                  chatbotId={chatbotId}
                  question={q}
                  onCancel={onCancelEdit}
                  onDone={onCancelEdit}
                />
              </div>
            ) : (
              <div class="px-2 py-2 flex items-start gap-2 group rounded hover:bg-surface-2 transition-colors">
                <span class="text-xs text-fg-subtle tabular-nums w-6 mt-0.5">{idxInStage + 1}.</span>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="text-sm text-fg truncate">{q.text}</span>
                    <code class="text-[0.625rem] text-fg-subtle">{q.fieldKey}</code>
                    <span class="text-[0.625rem] uppercase tracking-wider text-fg-subtle inline-flex items-center gap-1">
                      {TYPES.find((t) => t.value === q.type)?.icon}
                      {typeLabel(q.type)}
                    </span>
                    {q.required && <span class="text-[0.625rem] uppercase text-warning">obrigatória</span>}
                    {!q.active && <span class="text-[0.625rem] uppercase text-fg-subtle">inativa</span>}
                  </div>
                  {Array.isArray(q.options) && q.options.length > 0 && (
                    <div class="text-[0.6875rem] text-fg-subtle mt-0.5 truncate">
                      Opções: {(q.options as string[]).slice(0, 6).join(', ')}{(q.options as string[]).length > 6 ? '…' : ''}
                    </div>
                  )}
                </div>
                <div class="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <button
                    type="button"
                    class="size-7 rounded grid place-items-center text-fg-muted hover:text-fg hover:bg-surface-3 disabled:opacity-30 disabled:hover:bg-transparent"
                    onClick={() => onMoveStage(q, -1)}
                    disabled={stage === 0 && totalStages === 1}
                    aria-label="Mover para etapa anterior"
                    title="Mover para etapa anterior"
                  >
                    <ArrowUp size={11} />
                  </button>
                  <button
                    type="button"
                    class="size-7 rounded grid place-items-center text-fg-muted hover:text-fg hover:bg-surface-3"
                    onClick={() => onMoveStage(q, 1)}
                    aria-label="Mover para próxima etapa"
                    title="Mover para próxima etapa"
                  >
                    <ArrowDown size={11} />
                  </button>
                  <button
                    type="button"
                    class="size-7 rounded grid place-items-center text-fg-muted hover:text-fg hover:bg-surface-3"
                    onClick={() => onStartEdit(q.id)}
                    aria-label="Editar"
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    type="button"
                    class="size-7 rounded grid place-items-center text-fg-muted hover:text-danger hover:bg-surface-3"
                    onClick={() => onDelete(q)}
                    aria-label="Excluir"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            )
          }}
        />
      </div>
    </div>
  )
}

function NewQuestionForm({
  onSubmit, onCancel, saving,
}: {
  onSubmit: (input: ChatQuestionInput) => void
  onCancel: () => void
  saving: boolean
}) {
  return (
    <QuestionForm
      initial={{ fieldKey: '', text: '', type: 'text', required: true, active: true, options: null }}
      onCancel={onCancel}
      onSubmit={onSubmit}
      saving={saving}
      submitLabel="Adicionar"
    />
  )
}

function EditQuestionForm({
  chatbotId, question, onCancel, onDone,
}: {
  chatbotId: number
  question: ChatQuestion
  onCancel: () => void
  onDone: () => void
}) {
  const update = useUpdateChatQuestion(chatbotId)

  function handleSubmit(input: ChatQuestionInput) {
    update.mutate({ qid: question.id, ...input }, {
      onSuccess: () => { toast('Pergunta atualizada', 'success'); onDone() },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <QuestionForm
      initial={{
        fieldKey: question.fieldKey,
        text: question.text,
        type: question.type,
        required: question.required,
        active: question.active,
        options: question.options,
      }}
      onCancel={onCancel}
      onSubmit={handleSubmit}
      saving={update.isPending}
      submitLabel="Salvar"
    />
  )
}

function QuestionForm({
  initial, onSubmit, onCancel, saving, submitLabel,
}: {
  initial: ChatQuestionInput
  onSubmit: (input: ChatQuestionInput) => void
  onCancel: () => void
  saving: boolean
  submitLabel: string
}) {
  const [text, setText] = useState(initial.text ?? '')
  const [fieldKey, setFieldKey] = useState(initial.fieldKey ?? '')
  const [type, setType] = useState<ChatQuestionType>(initial.type ?? 'text')
  const [required, setRequired] = useState(initial.required ?? true)
  const [active, setActive] = useState(initial.active ?? true)
  const [optionsRaw, setOptionsRaw] = useState(
    Array.isArray(initial.options) ? (initial.options as string[]).join('\n') : '',
  )

  const showOptions = type === 'select' || type === 'multi_select'
  const options = useMemo(
    () => optionsRaw.split('\n').map((s) => s.trim()).filter(Boolean),
    [optionsRaw],
  )

  function handleSubmit() {
    if (!text.trim()) { toast('Texto da pergunta obrigatório', 'danger'); return }
    if (!fieldKey.trim()) { toast('fieldKey obrigatório', 'danger'); return }
    if (showOptions && options.length === 0) {
      toast('Adicione ao menos 1 opção', 'danger')
      return
    }
    onSubmit({
      text: text.trim(),
      fieldKey: fieldKey.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'),
      type,
      required,
      active,
      options: showOptions ? options : null,
    })
  }

  return (
    <div class="p-3 space-y-3 border-l-2 border-accent bg-surface-2">
      <div class="grid grid-cols-1 sm:grid-cols-[2fr_1fr] gap-3">
        <Textarea
          label="Texto da pergunta"
          value={text}
          onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
          rows={2}
          placeholder="Ex.: Qual seu nome completo?"
        />
        <div class="space-y-3">
          <Input
            label="fieldKey"
            value={fieldKey}
            onInput={(e) => setFieldKey((e.target as HTMLInputElement).value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
            placeholder="nome_completo"
            hint="Onde salva o valor no lead"
          />
          <Select label="Tipo" value={type} onChange={(e) => setType((e.target as HTMLSelectElement).value as ChatQuestionType)}>
            {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select>
        </div>
      </div>
      {showOptions && (
        <div>
          <div class="text-xs font-medium text-fg-muted mb-1">Opções (uma por linha)</div>
          <textarea
            class="w-full font-mono text-xs px-2 py-2 rounded-md bg-surface border border-border text-fg focus:outline-none focus:border-accent min-h-24"
            value={optionsRaw}
            onInput={(e) => setOptionsRaw((e.target as HTMLTextAreaElement).value)}
            placeholder={'Opção 1\nOpção 2\nOpção 3'}
            spellcheck={false}
          />
          <div class="text-[0.6875rem] text-fg-subtle mt-1">
            {options.length} opção(ões) detectada(s).
          </div>
        </div>
      )}
      <div class="flex items-center gap-4 flex-wrap">
        <label class="flex items-center gap-2 text-sm text-fg-muted">
          <input type="checkbox" checked={required} onChange={(e) => setRequired((e.target as HTMLInputElement).checked)} />
          Obrigatória
        </label>
        <label class="flex items-center gap-2 text-sm text-fg-muted">
          <input type="checkbox" checked={active} onChange={(e) => setActive((e.target as HTMLInputElement).checked)} />
          Ativa (entra no fluxo)
        </label>
        <div class="ml-auto flex gap-2">
          <button
            type="button"
            class="size-8 rounded grid place-items-center text-fg-muted hover:bg-surface-3"
            onClick={onCancel}
            aria-label="Cancelar"
          >
            <X size={14} />
          </button>
          <Button size="sm" variant="primary" onClick={handleSubmit} disabled={saving}>
            <Check size={12} /> {saving ? 'Salvando…' : submitLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
