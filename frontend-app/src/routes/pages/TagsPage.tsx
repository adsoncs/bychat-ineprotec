import { useState } from 'preact/hooks'
import { Tag as TagIcon, Plus, Pencil, Trash2, HelpCircle } from 'lucide-preact'
import { HowItWorksModal } from '@/components/ui/HowItWorksModal'
import { useTags, useCreateTag, useUpdateTag, useDeleteTag, useReorderTags, type Tag, type TagInput } from '@/hooks/useTags'
import { SortableList } from '@/components/ui/SortableList'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Input, Textarea } from '@/components/ui/Input'
import { ColorPicker } from '@/components/ui/ColorPicker'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { toast } from '@/lib/toast'

export function TagsPage() {
  const { data, isLoading } = useTags(true)
  const [editing, setEditing] = useState<Tag | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<Tag | null>(null)
  const [showHowItWorks, setShowHowItWorks] = useState(false)

  return (
    <Page
      title="Etiquetas"
      description="Categorize seus leads com etiquetas coloridas."
      actions={
        <div class="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setShowHowItWorks(true)}>
            <HelpCircle size={14} /> Como funciona?
          </Button>
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            <Plus size={14} /> Nova etiqueta
          </Button>
        </div>
      }
    >
      {isLoading && (
        <div class="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} class="h-14 w-full" />)}
        </div>
      )}
      {!isLoading && data?.tags.length === 0 && (
        <EmptyState
          icon={<TagIcon size={24} />}
          title="Nenhuma etiqueta criada"
          action={<Button size="sm" variant="primary" onClick={() => setCreating(true)}><Plus size={14} /> Criar primeira etiqueta</Button>}
        />
      )}
      {!isLoading && data && data.tags.length > 0 && (
        <Card>
          <TagsSortableList tags={data.tags} onEdit={setEditing} onDelete={setDeleting} />
        </Card>
      )}

      {(creating || editing) && (
        <TagFormModal
          tag={editing}
          onClose={() => { setCreating(false); setEditing(null) }}
        />
      )}

      {deleting && (
        <DeleteTagDialog
          tag={deleting}
          onClose={() => setDeleting(null)}
        />
      )}

      <HowItWorksModal
        open={showHowItWorks}
        onClose={() => setShowHowItWorks(false)}
        title="Como funcionam as Etiquetas?"
        problem={<>
          Funil mostra <em>em qual etapa</em> o lead está. Etiquetas mostram <em>características</em> dele —
          interesse no curso X, cliente VIP, veio de campanha Y, prefere e-mail. Um lead pode ter várias
          etiquetas ao mesmo tempo. Servem pra <strong>filtrar, segmentar e disparar automações</strong>.
        </>}
        steps={[
          {
            title: '🎨 Crie etiquetas com cor',
            body: <>Nome curto (ex.: "VIP", "Curso X", "Inadimplente") e uma cor. A cor ajuda a bater o olho e identificar — não é só decoração.</>,
          },
          {
            title: '🏷️ Aplique no lead',
            body: <>Manualmente (no detalhe do lead) ou em lote (selecionando vários na lista). Chatbots, fluxos e formulários também podem adicionar etiquetas automaticamente conforme regras.</>,
          },
          {
            title: '🔎 Use em filtros e relatórios',
            body: <>Filtre leads por etiqueta na lista, no kanban, nos relatórios. <em>"Quantos leads VIP fecharam no mês?"</em> vira uma consulta simples.</>,
          },
          {
            title: '⚡ Dispare automações',
            body: <>Fluxos podem ter gatilho <strong>"etiqueta adicionada"</strong> — útil pra: quando adicionar "VIP", mover pra funil prioritário; quando adicionar "Inadimplente", mandar e-mail de cobrança.</>,
          },
          {
            title: '↕️ Ordene por importância',
            body: <>Arraste pra reordenar — a ordem aqui é a ordem que aparece nos seletores de etiqueta pelo sistema.</>,
          },
        ]}
        tip={{
          tone: 'info',
          title: '💡 Boas práticas',
          body: <>Use poucas etiquetas e mantenha-as enxutas — 10 a 20 é saudável, 50+ vira bagunça. Se virar lista enorme, considere se algumas não deveriam ser <strong>campos personalizados</strong> em vez de etiqueta.</>,
        }}
      />
    </Page>
  )
}

function TagsSortableList({
  tags, onEdit, onDelete,
}: { tags: Tag[]; onEdit: (t: Tag) => void; onDelete: (t: Tag) => void }) {
  const reorder = useReorderTags()

  function handleReorder(next: Tag[]) {
    const items = next.map((t, position) => ({ id: t.id, position }))
    reorder.mutate(items, {
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <SortableList
      items={tags}
      onReorder={handleReorder}
      renderItem={(t) => (
        <div class="flex items-center gap-3 rounded-md border border-border p-3 bg-surface">
          <span
            class="size-7 rounded-md shrink-0 border border-border/40"
            style={{ background: t.color }}
            title={t.color}
          />
          <div class="min-w-0 flex-1">
            <div class="text-sm font-medium text-fg truncate">{t.name}</div>
            {t.description && <div class="text-xs text-fg-subtle truncate mt-0.5">{t.description}</div>}
          </div>
          <Badge tone={t.active ? 'success' : 'neutral'}>{t.active ? 'Ativo' : 'Inativo'}</Badge>
          {t._count && (
            <span class="text-xs text-fg-muted tabular-nums shrink-0" title="Leads com esta etiqueta">
              <strong class="text-fg">{t._count.leads}</strong> {t._count.leads === 1 ? 'lead' : 'leads'}
            </span>
          )}
          <div class="flex gap-1.5 shrink-0">
            <Button variant="secondary" size="sm" onClick={() => onEdit(t)} aria-label="Editar etiqueta">
              <Pencil size={12} /> Editar
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onDelete(t)}
              aria-label="Excluir etiqueta"
              class="!text-danger border-danger/30 hover:bg-danger/10"
            >
              <Trash2 size={12} /> Excluir
            </Button>
          </div>
        </div>
      )}
    />
  )
}

function TagFormModal({ tag, onClose }: { tag: Tag | null; onClose: () => void }) {
  const [name, setName] = useState(tag?.name ?? '')
  const [color, setColor] = useState(tag?.color ?? '#1a73e8')
  const [description, setDescription] = useState(tag?.description ?? '')
  const [active, setActive] = useState(tag?.active ?? true)
  const create = useCreateTag()
  const update = useUpdateTag()
  const isEdit = !!tag
  const loading = create.isPending || update.isPending

  function handleSubmit() {
    if (!name.trim()) {
      toast('Nome é obrigatório', 'danger')
      return
    }
    const payload: TagInput = { name: name.trim(), color, description: description || null, active }
    if (isEdit) {
      update.mutate({ id: tag.id, ...payload }, {
        onSuccess: () => { toast('Etiqueta atualizada', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    } else {
      create.mutate(payload, {
        onSuccess: () => { toast('Etiqueta criada', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    }
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={isEdit ? 'Editar etiqueta' : 'Nova etiqueta'}
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
        <Input label="Nome" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} placeholder="Ex.: VIP" />
        <ColorPicker value={color} onChange={setColor} />
        <Textarea label="Descrição (opcional)" value={description ?? ''} onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)} />
        {isEdit && (
          <label class="flex items-center gap-2 text-sm text-fg-muted">
            <input type="checkbox" checked={active} onChange={(e) => setActive((e.target as HTMLInputElement).checked)} />
            Etiqueta ativa
          </label>
        )}
      </div>
    </Modal>
  )
}

function DeleteTagDialog({ tag, onClose }: { tag: Tag; onClose: () => void }) {
  const del = useDeleteTag()
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Excluir "${tag.name}"`}
      description="A etiqueta vai para a lixeira e pode ser restaurada. Leads associados perdem a etiqueta."
      destructive
      confirmLabel="Excluir"
      loading={del.isPending}
      onConfirm={() => del.mutate(tag.id, {
        onSuccess: () => { toast('Etiqueta movida para a lixeira', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })}
    />
  )
}
