import { useEffect, useMemo, useState } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import { ArrowLeft, Plus, Pencil, Trash2, Star, GitFork, MessageSquare, Brain, Save } from '@/components/ui/icon-set'
import {
  useFunnel,
  useCreateStage,
  useUpdateStage,
  useDeleteStage,
  useReorderStages,
  type FunnelStage,
  type StageInput,
} from '@/hooks/useFunnels'
import { useKanbanFunnelsSummary } from '@/hooks/useKanban'
import { useAiJourneyConfig, useUpdateAiJourneyConfig } from '@/hooks/useAiJourney'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Input, Textarea } from '@/components/ui/Input'
import { ColorPicker } from '@/components/ui/ColorPicker'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { SortableList } from '@/components/ui/SortableList'
import { toast } from '@/lib/toast'

interface Props { params: { id: string } }

export function FunnelDetailPage({ params }: Props) {
  const [, navigate] = useLocation()
  const funnelId = Number(params.id)
  const { data: funnel, isLoading } = useFunnel(funnelId)
  const { data: summary } = useKanbanFunnelsSummary()
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<FunnelStage | null>(null)
  const [deleting, setDeleting] = useState<FunnelStage | null>(null)

  const reorder = useReorderStages(funnelId)

  const leadCountByStageKey = useMemo(() => {
    const map: Record<string, number> = {}
    const f = summary?.funnels.find((x) => x.id === funnelId)
    if (!f) return map
    for (const s of f.stages) map[s.key] = s.leadCount
    return map
  }, [summary, funnelId])

  function handleReorder(next: FunnelStage[]) {
    const order = next.map((s, position) => ({ id: s.id, position }))
    reorder.mutate(order, {
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <Page
      title={funnel?.name ?? 'Funil'}
      description={funnel?.description ?? 'Gerencie as etapas do funil.'}
      actions={
        <div class="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => navigate('/funnels')}>
            <ArrowLeft size={14} /> Voltar
          </Button>
          <Button variant="primary" size="sm" onClick={() => setCreating(true)} disabled={!funnel}>
            <Plus size={14} /> Nova etapa
          </Button>
        </div>
      }
    >
      {isLoading && <Skeleton class="h-64 w-full" />}

      {!isLoading && funnel && (
        <>
          <Card>
            <div class="flex flex-wrap items-center gap-3">
              <GitFork size={16} class="text-fg-muted" />
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-sm font-medium text-fg truncate">{funnel.name}</span>
                  {funnel.isDefault && <Badge tone="warning"><Star size={10} /> Padrão</Badge>}
                  {!funnel.active && <Badge tone="neutral">Inativo</Badge>}
                </div>
                <div class="text-xs text-fg-muted mt-0.5">
                  {funnel.stages.length} etapa(s) · {funnel._count?.leads ?? 0} lead(s)
                </div>
              </div>
            </div>
          </Card>

          <AiJourneyConfigCard funnelId={funnelId} />

          {funnel.chatbots && funnel.chatbots.length > 0 && (
            <div class="flex items-center gap-2 flex-wrap text-xs text-fg-muted">
              <span>Chatbots vinculados:</span>
              {funnel.chatbots.map((c) => (
                <span key={c.id} class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/15 text-accent font-medium">
                  <MessageSquare size={10} /> {c.name}
                </span>
              ))}
            </div>
          )}

          <Card class="p-0 overflow-hidden">
            {funnel.stages.length === 0 && (
              <div class="p-8">
                <EmptyState title="Sem etapas" description="Crie a primeira etapa do funil." action={<Button variant="primary" size="sm" onClick={() => setCreating(true)}><Plus size={14} /> Nova etapa</Button>} />
              </div>
            )}
            {funnel.stages.length > 0 && (
              <SortableList
                items={funnel.stages}
                onReorder={handleReorder}
                renderItem={(s, i) => (
                  <StageRow
                    stage={s}
                    position={i + 1}
                    leadCount={leadCountByStageKey[s.key] ?? 0}
                    onEdit={() => setEditing(s)}
                    onDelete={() => setDeleting(s)}
                  />
                )}
              />
            )}
          </Card>

          <div class="rounded-md border border-border bg-surface-2 p-3 text-xs text-fg-muted leading-relaxed">
            <div class="text-sm font-medium text-fg mb-1">Como funciona</div>
            As etapas definem o funil de acompanhamento dos leads. A <strong class="text-fg">chave</strong> é o identificador interno (não pode ser alterada após a criação). A <strong class="text-fg">ordem</strong> define a sequência no funil e nos selects. Etapas com leads vinculados não podem ser excluídas — mova os leads antes. <strong class="text-fg">"Garante vaga"</strong> marca a etapa como ocupação real (consumesSlot) — útil para portais educacionais com limite por turma.
          </div>
        </>
      )}

      {creating && funnel && (
        <StageFormModal funnelId={funnelId} stage={null} onClose={() => setCreating(false)} />
      )}
      {editing && (
        <StageFormModal funnelId={funnelId} stage={editing} onClose={() => setEditing(null)} />
      )}
      {deleting && (
        <DeleteStageDialog funnelId={funnelId} stage={deleting} onClose={() => setDeleting(null)} />
      )}
    </Page>
  )
}

function StageRow({
  stage, position, leadCount, onEdit, onDelete,
}: {
  stage: FunnelStage
  position: number
  leadCount: number
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div class="flex items-center gap-3 p-3 group bg-surface">
      <span class="size-7 rounded-full bg-surface-3 grid place-items-center text-xs font-medium text-fg-muted tabular-nums shrink-0">
        {position}
      </span>
      <span class="size-3 rounded-full shrink-0" style={{ background: stage.color ?? 'transparent', border: stage.color ? '' : '1px solid var(--color-border)' }} />
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-sm font-medium text-fg truncate">{stage.name}</span>
          <code class="text-2xs text-fg-muted font-mono">{stage.key}</code>
          {!stage.active && <Badge tone="neutral">Inativa</Badge>}
          {stage.consumesSlot && (
            <span title="Leads aqui ocupam vaga das ofertas" class="inline-flex">
              <Badge tone="warning">Garante vaga</Badge>
            </span>
          )}
          {stage.terminalKind && (
            <span title="Entrar nesta etapa marca o lead como ganho/perdido" class="inline-flex">
              <Badge tone={stage.terminalKind === 'won' ? 'success' : 'danger'}>
                {stage.terminalKind === 'won' ? 'Ganho' : 'Perdido'}
              </Badge>
            </span>
          )}
        </div>
      </div>
      <span class="text-xs text-fg-muted tabular-nums shrink-0" title="Leads nesta etapa">
        <strong class="text-fg">{leadCount}</strong> {leadCount === 1 ? 'lead' : 'leads'}
      </span>
      <div class="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button type="button" class="size-7 rounded grid place-items-center text-fg-muted hover:text-fg hover:bg-surface-3" onClick={onEdit} aria-label="Editar"><Pencil size={12} /></button>
        <button type="button" class="size-7 rounded grid place-items-center text-fg-muted hover:text-danger hover:bg-surface-3" onClick={onDelete} aria-label="Excluir"><Trash2 size={12} /></button>
      </div>
    </div>
  )
}

function StageFormModal({ funnelId, stage, onClose }: { funnelId: number; stage: FunnelStage | null; onClose: () => void }) {
  const isEdit = !!stage
  const [name, setName] = useState(stage?.name ?? '')
  const [key, setKey] = useState(stage?.key ?? '')
  const [color, setColor] = useState(stage?.color ?? '#1a73e8')
  const [active, setActive] = useState(stage?.active ?? true)
  const [consumesSlot, setConsumesSlot] = useState(stage?.consumesSlot ?? false)
  const [terminalKind, setTerminalKind] = useState<'won' | 'lost' | ''>(stage?.terminalKind ?? '')

  const create = useCreateStage(funnelId)
  const update = useUpdateStage(funnelId)
  const loading = create.isPending || update.isPending

  function handleSubmit() {
    if (!name.trim()) { toast('Nome é obrigatório', 'danger'); return }
    if (!isEdit && !key.trim()) { toast('Key é obrigatória ao criar', 'danger'); return }
    if (!color) { toast('Cor é obrigatória', 'danger'); return }

    if (isEdit && stage) {
      const payload: Partial<StageInput> = { name: name.trim(), color, active, consumesSlot, terminalKind }
      update.mutate({ id: stage.id, ...payload }, {
        onSuccess: () => { toast('Etapa atualizada', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    } else {
      create.mutate({ key: key.trim(), name: name.trim(), color, active, consumesSlot, terminalKind }, {
        onSuccess: () => { toast('Etapa criada', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    }
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={isEdit ? `Editar "${stage.name}"` : 'Nova etapa'}
      size="md"
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
        <Input label="Nome *" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} placeholder="Ex.: Qualificado" />
        <Input
          label="Key *"
          value={key}
          onInput={(e) => {
            const raw = (e.target as HTMLInputElement).value
            setKey(raw.toUpperCase().replace(/[^A-Z0-9_]/g, ''))
          }}
          placeholder="QUALIFICADO"
          disabled={isEdit}
          hint={isEdit ? 'Key não pode ser alterada após criar' : 'Maiúsculas, números e _ apenas. Auto-formatado.'}
        />
        <ColorPicker value={color} onChange={setColor} />
        <label class="flex items-start gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={active} onChange={(e) => setActive((e.target as HTMLInputElement).checked)} class="mt-0.5" />
          <div>
            <div class="text-fg">Etapa ativa</div>
            <div class="text-xs text-fg-muted">Etapas inativas não aparecem no Kanban e não recebem novos leads.</div>
          </div>
        </label>
        <label class="flex items-start gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={consumesSlot} onChange={(e) => setConsumesSlot((e.target as HTMLInputElement).checked)} class="mt-0.5" />
          <div>
            <div class="text-fg">Garante vaga (consumesSlot)</div>
            <div class="text-xs text-fg-muted">Marca esta etapa como ocupação real de uma vaga (útil para portais educacionais com limite por turma).</div>
          </div>
        </label>
        <div>
          <label class="block text-sm text-fg mb-1" for="stage-terminal">Etapa de desfecho</label>
          <select
            id="stage-terminal"
            class="w-full h-9 px-2 rounded border border-border bg-surface text-sm text-fg cursor-pointer focus:outline-none focus:border-accent"
            value={terminalKind}
            onChange={(e) => setTerminalKind((e.target as HTMLSelectElement).value as 'won' | 'lost' | '')}
          >
            <option value="">Nenhuma — etapa comum</option>
            <option value="won">Ganho — quem chega aqui virou venda</option>
            <option value="lost">Perdido — quem chega aqui foi perdido</option>
          </select>
          <p class="text-xs text-fg-muted mt-1">
            Mover um lead para esta etapa marca Ganho/Perdido sozinho, e classificar
            um lead traz ele para cá. Só uma etapa de cada tipo por funil. Deixe em
            "Nenhuma" nos funis de atendimento — ali "Resolvido" não é venda ganha.
          </p>
        </div>
      </div>
    </Modal>
  )
}

function AiJourneyConfigCard({ funnelId }: { funnelId: number }) {
  const { data: resp, isLoading } = useAiJourneyConfig(funnelId)
  const update = useUpdateAiJourneyConfig()
  const cfg = resp?.data

  const [enabled, setEnabled] = useState(false)
  const [autoApply, setAutoApply] = useState(false)
  const [threshold, setThreshold] = useState(80)
  const [prompt, setPrompt] = useState('')

  useEffect(() => {
    if (!cfg) return
    setEnabled(cfg.aiStageEnabled)
    setAutoApply(cfg.aiStageAutoApply)
    setThreshold(cfg.aiStageThreshold)
    setPrompt(cfg.aiStagePrompt ?? '')
  }, [cfg])

  const dirty = useMemo(() => {
    if (!cfg) return false
    return (
      enabled !== cfg.aiStageEnabled ||
      autoApply !== cfg.aiStageAutoApply ||
      threshold !== cfg.aiStageThreshold ||
      (prompt || null) !== (cfg.aiStagePrompt ?? null)
    )
  }, [cfg, enabled, autoApply, threshold, prompt])

  function handleSave() {
    update.mutate(
      {
        funnelId,
        aiStageEnabled: enabled,
        aiStageAutoApply: autoApply,
        aiStageThreshold: threshold,
        aiStagePrompt: prompt.trim() ? prompt.trim() : null,
      },
      {
        onSuccess: () => toast('Configuração da Jornada IA salva.', 'success'),
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      },
    )
  }

  if (isLoading || !cfg) {
    return (
      <Card>
        <Skeleton class="h-32 w-full" />
      </Card>
    )
  }

  return (
    <Card>
      <div class="flex items-center gap-2 mb-3">
        <Brain size={16} class="text-accent" />
        <h3 class="text-sm font-semibold text-fg">Jornada Automática por IA</h3>
        {enabled && <Badge tone="success">Ativa</Badge>}
        {dirty && <Badge tone="warning">Não salvo</Badge>}
        <div class="ml-auto">
          <Button
            variant="primary"
            size="sm"
            onClick={handleSave}
            disabled={!dirty || update.isPending}
          >
            <Save size={14} /> {update.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </div>
      </div>

      <div class="space-y-4">
        <label class="flex items-start gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled((e.target as HTMLInputElement).checked)}
            class="mt-0.5"
          />
          <div>
            <div class="text-fg">Ativar Jornada IA neste funil</div>
            <div class="text-xs text-fg-muted">
              A IA analisa cada mensagem recebida do lead (debounce 60s) e sugere mudanças de etapa com base no contexto da conversa.
            </div>
          </div>
        </label>

        <label class={`flex items-start gap-2 text-sm ${enabled ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}>
          <input
            type="checkbox"
            checked={autoApply}
            disabled={!enabled}
            onChange={(e) => setAutoApply((e.target as HTMLInputElement).checked)}
            class="mt-0.5"
          />
          <div>
            <div class="text-fg">Auto-aplicar sugestões com alta confiança</div>
            <div class="text-xs text-fg-muted">
              Se ligado, sugestões acima do threshold mudam o lead automaticamente. Se desligado, ficam pendentes em <strong>Jornada IA</strong> para revisão humana.
            </div>
          </div>
        </label>

        <div class={enabled ? '' : 'opacity-50 pointer-events-none'}>
          <div class="flex items-center justify-between mb-1.5">
            <label class="text-sm text-fg" for={`threshold-${funnelId}`}>
              Threshold de confiança
            </label>
            <span class="text-sm font-semibold tabular-nums text-accent">{threshold}%</span>
          </div>
          <input
            id={`threshold-${funnelId}`}
            type="range"
            min={0}
            max={100}
            step={5}
            value={threshold}
            disabled={!enabled}
            onInput={(e) => setThreshold(Number((e.target as HTMLInputElement).value))}
            class="w-full"
          />
          <div class="text-xs text-fg-muted mt-1">
            Sugestões com confiança abaixo deste valor são descartadas. Recomendado: <strong>70–85%</strong>. Mais alto = menos falsos positivos, mais conservador.
          </div>
        </div>

        <div class={enabled ? '' : 'opacity-50 pointer-events-none'}>
          <Textarea
            label="Prompt customizado (opcional)"
            value={prompt}
            onInput={(e) => setPrompt((e.target as HTMLTextAreaElement).value)}
            disabled={!enabled}
            rows={5}
            placeholder="Deixe em branco para usar o prompt padrão da plataforma (baseado nas etapas ativas deste funil)."
            hint={`Máximo 6.000 caracteres. Use {{stages}} para listar as etapas, {{lead}} para o nome do lead, {{messages}} para as últimas mensagens.${prompt.length > 0 ? ` · ${prompt.length}/6000` : ''}`}
          />
        </div>
      </div>
    </Card>
  )
}

function DeleteStageDialog({ funnelId, stage, onClose }: { funnelId: number; stage: FunnelStage; onClose: () => void }) {
  const del = useDeleteStage(funnelId)
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Excluir "${stage.name}"`}
      description="A etapa será removida permanentemente. Não pode ser excluída se houver leads nela — mova-os antes."
      destructive
      confirmLabel="Excluir"
      loading={del.isPending}
      onConfirm={() => del.mutate(stage.id, {
        onSuccess: () => { toast('Etapa excluída', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })}
    />
  )
}
