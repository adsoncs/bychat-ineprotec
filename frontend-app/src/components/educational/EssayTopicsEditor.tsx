import { useState } from 'preact/hooks'
import { Plus, Pencil, Trash2, Sparkles, Eye, EyeOff, Hand, FileText } from '@/components/ui/icon-set'
import {
  useEssayTopics,
  useCreateEssayTopic,
  useUpdateEssayTopic,
  useDeleteEssayTopic,
  useReorderEssayTopics,
  useEnemEssayCatalog,
  useGenerateAiEssayTopic,
  type EssayTopic,
  type EssayTopicInput,
  type EssayTopicSource,
  type AiGeneratedTopic,
} from '@/hooks/useEducational'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Skeleton } from '@/components/ui/Skeleton'
import { Badge } from '@/components/ui/Badge'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { SortableList } from '@/components/ui/SortableList'
import { toast } from '@/lib/toast'

interface FormPrefill {
  title?: string | null
  prompt: string
  supportTexts?: string | null
  active?: boolean
  ordem?: number
  source?: EssayTopicSource
  sourceMeta?: Record<string, unknown> | null
}

// Badge de origem do tema (ai/enem/manual). Clicável: abre dropdown que
// permite reclassificar quando a etiqueta automática estiver errada (ex:
// backfill da migração marcou tudo como manual antes de existir o campo).
function SourceBadge({
  source,
  onChange,
}: {
  source: EssayTopicSource
  onChange?: (next: EssayTopicSource) => void
}) {
  const [open, setOpen] = useState(false)

  const variants: Record<EssayTopicSource, { label: string; cls: string; Icon: any }> = {
    ai: {
      label: 'Criado com IA',
      cls: 'bg-info/15 text-info border-info/30',
      Icon: Sparkles,
    },
    enem: {
      label: 'Importado do INEP',
      cls: 'bg-success/15 text-success border-success/30',
      Icon: FileText,
    },
    manual: {
      label: 'Criado manual',
      cls: 'bg-fg-muted/15 text-fg-muted border-fg-muted/30',
      Icon: Hand,
    },
  }
  const cur = variants[source]
  const CurIcon = cur.Icon

  if (!onChange) {
    return (
      <span class={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-3xs font-medium border ${cur.cls}`}>
        <CurIcon size={10} /> {cur.label}
      </span>
    )
  }

  return (
    <span class="relative inline-block">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}
        class={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-3xs font-medium border hover:opacity-80 ${cur.cls}`}
        title="Clique para alterar a origem"
      >
        <CurIcon size={10} /> {cur.label}
      </button>
      {open && (
        <>
          <div class="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div class="absolute left-0 top-full mt-1 z-40 w-44 rounded-md border border-border bg-surface shadow-lg py-1 text-xs">
            {(['ai', 'enem', 'manual'] as EssayTopicSource[]).map((s) => {
              const v = variants[s]
              const Icon = v.Icon
              const active = s === source
              return (
                <button
                  key={s}
                  type="button"
                  class={`w-full text-left px-2 py-1.5 hover:bg-surface-3 inline-flex items-center gap-1.5 ${active ? 'text-fg font-semibold' : 'text-fg-muted'}`}
                  onClick={(e) => { e.stopPropagation(); setOpen(false); if (!active) onChange(s) }}
                >
                  <Icon size={11} /> {v.label}
                  {active && <span class="ml-auto text-3xs text-fg-muted">atual</span>}
                </button>
              )
            })}
          </div>
        </>
      )}
    </span>
  )
}

export function EssayTopicsEditor({ selectionProcessId }: { selectionProcessId: number }) {
  const { data, isLoading } = useEssayTopics(selectionProcessId)
  const update = useUpdateEssayTopic(selectionProcessId)
  const del = useDeleteEssayTopic(selectionProcessId)
  const reorder = useReorderEssayTopics(selectionProcessId)
  const [editing, setEditing] = useState<EssayTopic | null>(null)
  const [creating, setCreating] = useState(false)
  const [prefill, setPrefill] = useState<FormPrefill | null>(null)
  const [deleting, setDeleting] = useState<EssayTopic | null>(null)
  const [importing, setImporting] = useState(false)
  const [generatingAi, setGeneratingAi] = useState(false)

  const topics = data?.topics ?? []
  const activeCount = topics.filter((t) => t.active).length

  function handleReorder(newOrder: EssayTopic[]) {
    reorder.mutate(
      newOrder.map((t, idx) => ({ id: t.id, position: idx })),
      { onError: (e: unknown) => toast((e as Error).message, 'danger') },
    )
  }

  function openNewWithPrefill(p: FormPrefill) {
    setPrefill(p)
    setCreating(true)
  }

  function closeForm() {
    setCreating(false)
    setEditing(null)
    setPrefill(null)
  }

  function handleToggleActive(t: EssayTopic) {
    update.mutate({ topicId: t.id, active: !t.active }, {
      onSuccess: () => toast(t.active ? 'Tema desativado' : 'Tema ativado', 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <div class="space-y-3">
      <div class="flex items-center justify-between gap-2 flex-wrap">
        <div class="text-xs text-fg-muted">
          O sistema sorteia um tema ativo a cada nova tentativa do candidato.{' '}
          <span class="text-fg-muted">{activeCount}/{topics.length} ativos</span>
        </div>
        <div class="flex gap-2 flex-wrap">
          <Button size="sm" variant="secondary" onClick={() => setGeneratingAi(true)}>
            <Sparkles size={14} /> Gerar com IA
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setImporting(true)}>
            Importar do ENEM
          </Button>
          <Button size="sm" variant="primary" onClick={() => { setPrefill(null); setCreating(true) }}>
            <Plus size={14} /> Novo tema
          </Button>
        </div>
      </div>

      {isLoading && <Skeleton class="h-24 w-full" />}

      {!isLoading && topics.length === 0 && (
        <Card>
          <div class="text-sm text-fg-muted text-center py-4">
            Nenhum tema cadastrado. Sem temas, o sistema usa o `essayPrompt` único do processo (legado).
          </div>
        </Card>
      )}

      {topics.length > 0 && (
        <div class="rounded-md border border-border bg-surface p-2">
          <SortableList
            items={topics}
            onReorder={handleReorder}
            renderItem={(t) => (
              <div class="px-2 py-2 flex items-start gap-3 group">
                <span class="text-xs text-fg-muted tabular-nums w-6 mt-0.5">{t.ordem}</span>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="text-sm font-medium text-fg truncate">{t.title ?? 'Sem título'}</span>
                    {t.active
                      ? <Badge tone="success">Ativo</Badge>
                      : <Badge tone="warning">Inativo</Badge>}
                    <SourceBadge
                      source={t.source ?? 'manual'}
                      onChange={(next) => {
                        update.mutate({ topicId: t.id, source: next }, {
                          onSuccess: () => toast('Origem atualizada', 'success'),
                          onError: (e: unknown) => toast((e as Error).message, 'danger'),
                        })
                      }}
                    />
                  </div>
                  <div class="text-xs text-fg-muted mt-0.5 line-clamp-2">{t.prompt}</div>
                  {t.supportTexts && (
                    <div class="text-2xs text-fg-muted mt-0.5">+ textos motivadores</div>
                  )}
                </div>
                <div class="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <button
                    type="button"
                    class="size-7 rounded grid place-items-center text-fg-muted hover:text-fg hover:bg-surface-3"
                    onClick={() => handleToggleActive(t)}
                    aria-label={t.active ? 'Desativar' : 'Ativar'}
                    title={t.active ? 'Desativar' : 'Ativar'}
                  >
                    {t.active ? <EyeOff size={11} /> : <Eye size={11} />}
                  </button>
                  <button
                    type="button"
                    class="size-7 rounded grid place-items-center text-fg-muted hover:text-fg hover:bg-surface-3"
                    onClick={() => setEditing(t)}
                    aria-label="Editar"
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    type="button"
                    class="size-7 rounded grid place-items-center text-fg-muted hover:text-danger hover:bg-surface-3"
                    onClick={() => setDeleting(t)}
                    aria-label="Excluir"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            )}
          />
        </div>
      )}

      {(creating || editing) && (
        <TopicFormModal
          selectionProcessId={selectionProcessId}
          topic={editing}
          prefill={prefill}
          onClose={closeForm}
        />
      )}

      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(o) => { if (!o) setDeleting(null) }}
          title={`Excluir "${deleting.title ?? 'tema'}"?`}
          description="Tema removido permanentemente. Não afeta tentativas em andamento (que já têm prompt snapshotado)."
          destructive
          confirmLabel="Excluir"
          loading={del.isPending}
          onConfirm={() => del.mutate(deleting.id, {
            onSuccess: () => { toast('Tema excluído', 'success'); setDeleting(null) },
            onError: (e: unknown) => toast((e as Error).message, 'danger'),
          })}
        />
      )}

      {importing && (
        <ImportEnemModal
          selectionProcessId={selectionProcessId}
          existingTitles={new Set(topics.map((t) => t.title?.toLowerCase()).filter(Boolean) as string[])}
          onClose={() => setImporting(false)}
        />
      )}

      {generatingAi && (
        <AiGenerateModal
          onClose={() => setGeneratingAi(false)}
          onUseTopic={(t, params) => {
            setGeneratingAi(false)
            openNewWithPrefill({
              title: t.title,
              prompt: t.prompt,
              supportTexts: t.supportTexts,
              active: true,
              ordem: 0,
              source: 'ai',
              sourceMeta: { generatedAt: new Date().toISOString(), ...params },
            })
          }}
        />
      )}
    </div>
  )
}

function TopicFormModal({
  selectionProcessId, topic, prefill, onClose,
}: { selectionProcessId: number; topic: EssayTopic | null; prefill: FormPrefill | null; onClose: () => void }) {
  const [title, setTitle] = useState(topic?.title ?? prefill?.title ?? '')
  const [prompt, setPrompt] = useState(topic?.prompt ?? prefill?.prompt ?? '')
  const [supportTexts, setSupportTexts] = useState(topic?.supportTexts ?? prefill?.supportTexts ?? '')
  const [ordem, setOrdem] = useState(String(topic?.ordem ?? prefill?.ordem ?? 0))
  const [active, setActive] = useState(topic?.active ?? prefill?.active ?? true)
  const create = useCreateEssayTopic(selectionProcessId)
  const update = useUpdateEssayTopic(selectionProcessId)
  const isEdit = !!topic
  const loading = create.isPending || update.isPending

  function handleSubmit() {
    if (!prompt.trim()) { toast('O enunciado é obrigatório', 'danger'); return }
    const payload: EssayTopicInput = {
      title: title.trim() || null,
      prompt: prompt.trim(),
      supportTexts: supportTexts.trim() || null,
      ordem: parseInt(ordem) || 0,
      active,
    }
    if (isEdit) {
      update.mutate({ topicId: topic.id, ...payload }, {
        onSuccess: () => { toast('Tema atualizado', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    } else {
      // Criação nova: herda origem do prefill (IA/INEP) ou cai pra 'manual'
      // (o backend já default-eia, mas explicitar deixa o intent claro).
      const sourcePayload: EssayTopicInput = {
        ...payload,
        source: prefill?.source ?? 'manual',
        ...(prefill?.sourceMeta ? { sourceMeta: prefill.sourceMeta } : {}),
      }
      create.mutate(sourcePayload, {
        onSuccess: () => { toast('Tema criado', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    }
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={isEdit ? 'Editar tema' : 'Novo tema'}
      size="lg"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={loading}>
            {loading ? 'Salvando…' : 'Salvar'}
          </Button>
        </>
      }
    >
      <div class="space-y-3">
        <div class="grid grid-cols-1 sm:grid-cols-[1fr_5rem] gap-3">
          <Input
            label="Título (opcional)"
            value={title ?? ''}
            onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
            placeholder="Ex.: Inclusão digital"
          />
          <Input
            label="Ordem"
            type="number"
            value={ordem}
            onInput={(e) => setOrdem((e.target as HTMLInputElement).value)}
          />
        </div>
        <Textarea
          label="Enunciado da proposta"
          value={prompt}
          onInput={(e) => setPrompt((e.target as HTMLTextAreaElement).value)}
          rows={6}
        />
        <Textarea
          label="Textos motivadores (opcional)"
          value={supportTexts ?? ''}
          onInput={(e) => setSupportTexts((e.target as HTMLTextAreaElement).value)}
          rows={4}
        />
        <label class="flex items-center gap-2 text-sm text-fg-muted">
          <input type="checkbox" checked={active} onChange={(e) => setActive((e.target as HTMLInputElement).checked)} />
          Ativo (entra no sorteio)
        </label>
      </div>
    </Modal>
  )
}

function ImportEnemModal({
  selectionProcessId, existingTitles, onClose,
}: {
  selectionProcessId: number
  existingTitles: Set<string>
  onClose: () => void
}) {
  const { data, isLoading } = useEnemEssayCatalog(true)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const create = useCreateEssayTopic(selectionProcessId)

  const themes = data?.themes ?? []

  function toggle(year: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(year)) next.delete(year)
      else next.add(year)
      return next
    })
  }

  async function handleImport() {
    const chosen = themes.filter((t) => selected.has(t.year))
    if (chosen.length === 0) return
    let imported = 0
    for (const t of chosen) {
      try {
        await create.mutateAsync({
          title: t.title.slice(0, 150),
          prompt: t.prompt,
          supportTexts: t.supportTexts || null,
          ordem: imported,
          active: true,
          source: 'enem',
          sourceMeta: { year: t.year, importedAt: new Date().toISOString() },
        })
        imported++
      } catch (e) {
        toast(`Falha ao importar ${t.title}: ${(e as Error).message}`, 'danger')
      }
    }
    if (imported > 0) toast(`${imported} tema(s) importado(s)`, 'success')
    onClose()
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Importar do catálogo ENEM"
      description="Últimas 10 redações oficiais (fonte: INEP). Marque as que quer importar."
      size="lg"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>Cancelar</Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleImport}
            disabled={selected.size === 0 || create.isPending}
          >
            {create.isPending ? 'Importando…' : `Importar ${selected.size}`}
          </Button>
        </>
      }
    >
      <div class="space-y-2">
        {isLoading && <Skeleton class="h-32 w-full" />}
        {!isLoading && themes.length === 0 && (
          <div class="text-sm text-fg-muted text-center py-4">Catálogo indisponível.</div>
        )}
        {themes.map((t) => {
          const dup = existingTitles.has(t.title.toLowerCase())
          return (
            <label
              key={t.year}
              class={`flex items-start gap-3 p-2 rounded border border-border cursor-pointer hover:bg-surface-3 ${dup ? 'opacity-60' : ''}`}
            >
              <input
                type="checkbox"
                class="mt-1"
                checked={selected.has(t.year)}
                onChange={() => toggle(t.year)}
                disabled={dup}
              />
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <Badge tone="info">ENEM {t.year}</Badge>
                  <span class="text-sm text-fg truncate">{t.title}</span>
                  {dup && <span class="text-3xs uppercase text-fg-muted">já adicionado</span>}
                </div>
                <div class="text-xs text-fg-muted line-clamp-2 mt-1">{t.prompt}</div>
              </div>
            </label>
          )
        })}
      </div>
    </Modal>
  )
}

function AiGenerateModal({
  onClose, onUseTopic,
}: { onClose: () => void; onUseTopic: (t: AiGeneratedTopic, params: { context?: string; audience?: string; area?: string }) => void }) {
  const [context, setContext] = useState('')
  const [audience, setAudience] = useState('')
  const [area, setArea] = useState('')
  const [includeSupportTexts, setIncludeSupportTexts] = useState(true)
  const [result, setResult] = useState<{
    topic: AiGeneratedTopic
    costUsd: number | null
  } | null>(null)
  const generate = useGenerateAiEssayTopic()

  function handleGenerate() {
    generate.mutate(
      {
        context: context.trim() || undefined,
        audience: audience || undefined,
        area: area || undefined,
        includeSupportTexts,
      },
      {
        onSuccess: (r) => setResult({ topic: r.topic, costUsd: r.usage.costUsd }),
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      },
    )
  }

  function handleUse() {
    if (!result) return
    onUseTopic(result.topic, {
      ...(context.trim() ? { context: context.trim() } : {}),
      ...(audience ? { audience } : {}),
      ...(area ? { area } : {}),
    })
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Gerar tema com IA"
      description="A IA gera título, enunciado e textos motivadores no padrão ENEM. Você revisa antes de salvar."
      size="lg"
      footer={
        result ? (
          <>
            <Button variant="secondary" size="sm" onClick={() => setResult(null)} disabled={generate.isPending}>
              Gerar outro
            </Button>
            <Button variant="primary" size="sm" onClick={handleUse}>
              Usar este tema →
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" size="sm" onClick={onClose} disabled={generate.isPending}>
              Cancelar
            </Button>
            <Button variant="primary" size="sm" onClick={handleGenerate} disabled={generate.isPending}>
              <Sparkles size={12} /> {generate.isPending ? 'Gerando…' : 'Gerar tema'}
            </Button>
          </>
        )
      }
    >
      {!result ? (
        <div class="space-y-3">
          <Textarea
            label="Contexto / orientação (opcional)"
            value={context}
            onInput={(e) => setContext((e.target as HTMLTextAreaElement).value)}
            rows={3}
            placeholder="Ex.: tema relacionado a sustentabilidade urbana, voltado para vestibular de Engenharia…"
          />
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select label="Público-alvo" value={audience} onChange={(e) => setAudience((e.target as HTMLSelectElement).value)}>
              <option value="">— qualquer —</option>
              <option value="ensino médio / vestibular">Ensino médio / vestibular</option>
              <option value="ENEM">ENEM</option>
              <option value="graduação">Graduação</option>
              <option value="concurso público">Concurso público</option>
            </Select>
            <Select label="Área" value={area} onChange={(e) => setArea((e.target as HTMLSelectElement).value)}>
              <option value="">— qualquer —</option>
              <option value="ciências humanas e sociais">Ciências humanas e sociais</option>
              <option value="meio ambiente e sustentabilidade">Meio ambiente e sustentabilidade</option>
              <option value="tecnologia e sociedade">Tecnologia e sociedade</option>
              <option value="saúde pública">Saúde pública</option>
              <option value="educação">Educação</option>
              <option value="cidadania e direitos">Cidadania e direitos</option>
              <option value="cultura">Cultura</option>
            </Select>
          </div>
          <label class="flex items-center gap-2 text-sm text-fg-muted">
            <input
              type="checkbox"
              checked={includeSupportTexts}
              onChange={(e) => setIncludeSupportTexts((e.target as HTMLInputElement).checked)}
            />
            Incluir textos motivadores (3–4 textos com dados, lei e citações)
          </label>
        </div>
      ) : (
        <div class="space-y-3">
          <div class="rounded-md border border-success/30 bg-success/10 p-2 text-xs text-success">
            ✓ Tema gerado{result.costUsd !== null ? ` · custo aprox.: $${result.costUsd.toFixed(4)}` : ''}
          </div>
          <div class="rounded-md border border-border bg-surface p-3 space-y-3 max-h-[55vh] overflow-y-auto">
            <div>
              <div class="text-3xs uppercase tracking-wider font-semibold text-fg-muted mb-1">Título</div>
              <div class="text-sm font-semibold text-fg">{result.topic.title ?? '—'}</div>
            </div>
            <div>
              <div class="text-3xs uppercase tracking-wider font-semibold text-fg-muted mb-1">Enunciado</div>
              <div class="text-sm text-fg whitespace-pre-wrap font-serif border-l-2 border-accent bg-surface-3 px-3 py-2 rounded">
                {result.topic.prompt}
              </div>
            </div>
            {result.topic.supportTexts && (
              <div>
                <div class="text-3xs uppercase tracking-wider font-semibold text-fg-muted mb-1">Textos motivadores</div>
                <div class="text-xs text-fg whitespace-pre-wrap border-l-2 border-warning bg-surface-3 px-3 py-2 rounded">
                  {result.topic.supportTexts}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
