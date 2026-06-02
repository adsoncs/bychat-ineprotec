import { useState } from 'preact/hooks'
import { Users, Plus, Pencil, Trash2, UserPlus, X as XIcon, Star, Crown } from 'lucide-preact'
import {
  useTeams,
  useCreateTeam,
  useUpdateTeam,
  useDeleteTeam,
  useReorderTeams,
  useTeamMembers,
  useEligibleTeamMembers,
  useAddTeamMember,
  useUpdateTeamMember,
  useRemoveTeamMember,
  type Team,
} from '@/hooks/useTeams'
import { SortableList } from '@/components/ui/SortableList'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Input, Textarea } from '@/components/ui/Input'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { DefaultTeamCard } from '@/components/DefaultTeamCard'
import { toast } from '@/lib/toast'

const TEAM_COLORS = [
  '#10B981', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899',
  '#14B8A6', '#F97316', '#6366F1', '#84CC16', '#06B6D4', '#6B7280',
]

export function TeamsSettings() {
  const { data, isLoading } = useTeams()
  const [editing, setEditing] = useState<Team | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<Team | null>(null)
  const [members, setMembers] = useState<Team | null>(null)

  const teams = data?.teams ?? []
  const totalCount = teams.length

  return (
    <div class="space-y-3">
      <div class="flex items-center justify-between gap-2">
        <div class="text-xs text-fg-subtle">
          {isLoading ? '…' : `${totalCount} equipe${totalCount === 1 ? '' : 's'}`}
        </div>
        <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
          <Plus size={14} /> Nova equipe
        </Button>
      </div>

      <DefaultTeamCard />

      {isLoading && <Skeleton class="h-32 w-full" />}
      {!isLoading && teams.length === 0 && (
        <EmptyState
          icon={<Users size={24} />}
          title="Nenhuma equipe cadastrada"
          description="Crie equipes (setores) para organizar o atendimento, distribuir leads e dar permissões de gerência."
          action={
            <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
              <Plus size={14} /> Criar primeira equipe
            </Button>
          }
        />
      )}
      {!isLoading && teams.length > 0 && (
        <Card>
          <TeamsSortable
            teams={teams}
            onEdit={setEditing}
            onDelete={setDeleting}
            onMembers={setMembers}
          />
        </Card>
      )}

      {(creating || editing) && (
        <TeamFormModal team={editing} onClose={() => { setCreating(false); setEditing(null) }} />
      )}
      {deleting && (
        <DeleteTeamDialog team={deleting} onClose={() => setDeleting(null)} />
      )}
      {members && (
        <TeamMembersModal team={members} onClose={() => setMembers(null)} />
      )}
    </div>
  )
}

function TeamsSortable({
  teams, onEdit, onDelete, onMembers,
}: {
  teams: Team[]
  onEdit: (t: Team) => void
  onDelete: (t: Team) => void
  onMembers: (t: Team) => void
}) {
  const reorder = useReorderTeams()
  function handleReorder(next: Team[]) {
    reorder.mutate(next.map((t, position) => ({ id: t.id, position })), {
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }
  return (
    <SortableList
      items={teams}
      onReorder={handleReorder}
      renderItem={(t) => {
        const memberCount = t.memberCount ?? t._count?.members ?? 0
        const leadCount = t.leadCount ?? 0
        const chatbotCount = t.chatbotCount ?? 0
        return (
          <div class="flex items-center gap-3 rounded-md border border-border p-3 group bg-surface">
            <span class="size-7 rounded-md shrink-0 grid place-items-center text-fg-on-brand text-[0.6875rem] font-bold" style={{ background: t.color ?? 'var(--color-accent)' }}>
              {(t.name?.[0] ?? '?').toUpperCase()}
            </span>
            <div class="min-w-0 flex-1">
              <div class="text-sm font-medium text-fg flex items-center gap-2 flex-wrap">
                {t.name}
                <Badge tone={t.active ? 'accent' : 'neutral'}>{t.active ? 'Ativa' : 'Inativa'}</Badge>
              </div>
              {t.description && <div class="text-xs text-fg-muted truncate">{t.description}</div>}
              <div class="text-[0.6875rem] text-fg-subtle mt-0.5 flex items-center gap-2 flex-wrap">
                {t.slug && (
                  <code class="font-mono rounded bg-surface-2 px-1 py-0.5 text-[0.625rem]">{t.slug}</code>
                )}
                <button
                  type="button"
                  class="inline-flex items-center gap-1 text-accent hover:underline"
                  onClick={() => onMembers(t)}
                >
                  <Users size={11} /> {memberCount} membro{memberCount === 1 ? '' : 's'}
                </button>
                <span>·</span>
                <span>{leadCount} lead{leadCount === 1 ? '' : 's'}</span>
                <span>·</span>
                <span>{chatbotCount} chatbot{chatbotCount === 1 ? '' : 's'}</span>
              </div>
            </div>
            <div class="flex gap-1.5 shrink-0 flex-wrap">
              <Button variant="secondary" size="sm" onClick={() => onMembers(t)} aria-label="Gerenciar membros" title="Gerenciar membros">
                <Users size={12} /> Membros
              </Button>
              <Button variant="secondary" size="sm" onClick={() => onEdit(t)} aria-label="Editar equipe" title="Editar">
                <Pencil size={12} /> Editar
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onDelete(t)}
                aria-label="Excluir equipe"
                title="Excluir"
                class="!text-danger border-danger/30 hover:bg-danger/10"
              >
                <Trash2 size={12} /> Excluir
              </Button>
            </div>
          </div>
        )
      }}
    />
  )
}

const ROUTING_MODE_OPTIONS: { value: 'manual' | 'round_robin' | 'least_loaded' | 'random'; label: string; hint: string }[] = [
  { value: 'manual',       label: 'Manual (fila do setor)',       hint: 'Lead chega na fila; o operador faz "Assumir" para puxar.' },
  { value: 'round_robin',  label: 'Round-robin (rodízio)',         hint: 'Distribui em rodízio para quem está há mais tempo sem receber lead novo.' },
  { value: 'least_loaded', label: 'Menor carga',                    hint: 'Atribui ao operador com menor número de leads ativos (respeitando o limite simultâneo).' },
  { value: 'random',       label: 'Aleatório',                      hint: 'Sorteia um operador disponível.' },
]

function TeamFormModal({ team, onClose }: { team: Team | null; onClose: () => void }) {
  const isEdit = !!team
  const [name, setName] = useState(team?.name ?? '')
  const [slug, setSlug] = useState(team?.slug ?? '')
  const [description, setDescription] = useState(team?.description ?? '')
  const [color, setColor] = useState(team?.color ?? TEAM_COLORS[0]!)
  const [active, setActive] = useState(team?.active ?? true)
  const [routingMode, setRoutingMode] = useState<'manual' | 'round_robin' | 'least_loaded' | 'random'>(
    (team?.routingMode as any) ?? 'manual',
  )
  const create = useCreateTeam()
  const update = useUpdateTeam()
  const loading = create.isPending || update.isPending

  function handleSubmit() {
    if (!name.trim()) { toast('Nome é obrigatório', 'danger'); return }
    const trimmedDesc = (description ?? '').trim()
    const payload = {
      name: name.trim(),
      description: trimmedDesc !== '' ? trimmedDesc : null,
      color,
      active,
      routingMode,
    }
    if (isEdit) {
      const slugPatch = slug.trim() !== '' ? { slug: slug.trim() } : {}
      update.mutate({ id: team.id, ...payload, ...slugPatch }, {
        onSuccess: () => { toast('Equipe atualizada', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    } else {
      create.mutate(payload, {
        onSuccess: () => { toast('Equipe criada', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    }
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={isEdit ? `Editar "${team.name}"` : 'Nova equipe'}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={loading}>
            {loading ? 'Salvando…' : (isEdit ? 'Salvar' : 'Criar equipe')}
          </Button>
        </>
      }
    >
      <div class="space-y-3">
        <div>
          <div class="text-xs font-medium text-fg-muted mb-1">
            Nome <span class="text-danger" aria-label="obrigatório">*</span>
          </div>
          <input
            type="text"
            value={name}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
            placeholder="Ex: Comercial"
            class="w-full h-9 px-3 rounded-md bg-surface border border-border text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent"
          />
        </div>

        {isEdit && (
          <Input
            label="Slug"
            value={slug}
            onInput={(e) => setSlug((e.target as HTMLInputElement).value.toLowerCase().replace(/[^a-z0-9_-]/g, '-'))}
            placeholder="comercial"
            hint="Identificador URL-friendly. Auto-gerado a partir do nome se vazio."
            class="font-mono"
          />
        )}

        <div>
          <div class="text-xs font-medium text-fg-muted mb-1">
            Cor <span class="text-danger" aria-label="obrigatório">*</span>
          </div>
          <div class="flex items-center gap-1.5 flex-wrap">
            {TEAM_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                class="size-7 rounded-md border border-border transition-all"
                style={{
                  background: c,
                  outline: c === color ? '2px solid var(--color-fg)' : 'none',
                  outlineOffset: '1px',
                }}
                onClick={() => setColor(c)}
                aria-label={`Cor ${c}`}
              />
            ))}
          </div>
          <input
            type="text"
            value={color}
            onInput={(e) => setColor((e.target as HTMLInputElement).value)}
            placeholder="#1a73e8"
            class="mt-2 w-full h-8 px-3 rounded-md bg-surface border border-border text-xs text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent font-mono"
          />
        </div>

        <Textarea
          label="Descrição (opcional)"
          value={description ?? ''}
          onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)}
          placeholder="O que esta equipe atende?"
          rows={2}
        />

        <div>
          <div class="text-xs font-medium text-fg-muted mb-1">Distribuição de novos leads</div>
          <select
            value={routingMode}
            onChange={(e) => setRoutingMode((e.target as HTMLSelectElement).value as typeof routingMode)}
            class="w-full h-9 px-3 rounded-md bg-surface border border-border text-sm text-fg focus:outline-none focus:border-accent"
          >
            {ROUTING_MODE_OPTIONS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
          <p class="text-[0.6875rem] text-fg-subtle mt-1">
            {ROUTING_MODE_OPTIONS.find((m) => m.value === routingMode)?.hint}
            {' Operadores fora de "Disponível" são pulados. O limite simultâneo é configurado por operador em '}
            <em>Usuários</em>{'.'}
          </p>
        </div>

        <label class="flex items-center gap-2 text-sm text-fg-muted cursor-pointer">
          <input type="checkbox" checked={active} onChange={(e) => setActive((e.target as HTMLInputElement).checked)} />
          Equipe ativa
        </label>
      </div>
    </Modal>
  )
}

function DeleteTeamDialog({ team, onClose }: { team: Team; onClose: () => void }) {
  const del = useDeleteTeam()
  const memberCount = team.memberCount ?? team._count?.members ?? 0
  const leadCount = team.leadCount ?? 0
  const description = memberCount > 0
    ? `Esta equipe tem ${memberCount} membro(s). Mova-os para outra equipe antes de excluir.`
    : leadCount > 0
      ? `Leads (${leadCount}) e chatbots vinculados ficam sem setor — não são apagados, mas precisam ser reroteados.`
      : 'A equipe será removida.'
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Excluir "${team.name}"`}
      description={description}
      destructive
      confirmLabel="Excluir"
      loading={del.isPending}
      onConfirm={() => del.mutate(team.id, {
        onSuccess: () => { toast('Equipe excluída', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })}
    />
  )
}

function TeamMembersModal({ team, onClose }: { team: Team; onClose: () => void }) {
  const { data, isLoading } = useTeamMembers(team.id)
  const { data: eligibleData } = useEligibleTeamMembers(team.id)
  const add = useAddTeamMember(team.id)
  const updateMember = useUpdateTeamMember(team.id)
  const remove = useRemoveTeamMember(team.id)

  const [selectedUserId, setSelectedUserId] = useState('')
  const [addLeader, setAddLeader] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState<{ userId: number; userName: string } | null>(null)

  const members = data?.members ?? []
  const candidates = eligibleData?.candidates ?? []

  function handleAdd() {
    const userId = Number(selectedUserId)
    if (!userId) { toast('Selecione um usuário', 'danger'); return }
    add.mutate({ userId, isLeader: addLeader }, {
      onSuccess: () => {
        toast('Membro adicionado', 'success')
        setSelectedUserId('')
        setAddLeader(false)
      },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function handleToggleLeader(userId: number, isLeader: boolean) {
    updateMember.mutate({ userId, isLeader }, {
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function handleRemove(userId: number) {
    remove.mutate(userId, {
      onSuccess: () => { toast('Membro removido', 'success'); setConfirmRemove(null) },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <>
      <Modal
        open
        onOpenChange={(o) => { if (!o) onClose() }}
        title={`Membros — ${team.name}`}
        size="lg"
        footer={
          <Button variant="secondary" size="sm" onClick={onClose}>Fechar</Button>
        }
      >
        <div class="space-y-4">
          {/* Adicionar membro */}
          <div class="rounded-md border border-border p-3 bg-surface-2">
            <div class="text-xs font-semibold text-fg mb-2 flex items-center gap-1.5">
              <UserPlus size={12} /> Adicionar membro
            </div>
            <div class="flex flex-wrap items-stretch gap-2">
              <select
                value={selectedUserId}
                onChange={(e) => setSelectedUserId((e.target as HTMLSelectElement).value)}
                class="flex-1 min-w-[14rem] h-9 px-3 rounded-md bg-surface border border-border text-sm text-fg focus:outline-none focus:border-accent"
                disabled={candidates.length === 0}
              >
                <option value="">
                  {candidates.length === 0 ? 'Nenhum usuário elegível disponível' : 'Selecione um usuário…'}
                </option>
                {candidates.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name ?? u.email} ({u.email}) — {u.role}
                  </option>
                ))}
              </select>
              <label class="flex items-center gap-1.5 text-xs text-fg-muted cursor-pointer px-2">
                <input
                  type="checkbox"
                  checked={addLeader}
                  onChange={(e) => setAddLeader((e.target as HTMLInputElement).checked)}
                />
                <Crown size={11} /> Líder
              </label>
              <Button
                variant="primary"
                size="sm"
                onClick={handleAdd}
                disabled={add.isPending || !selectedUserId}
              >
                {add.isPending ? 'Adicionando…' : 'Adicionar'}
              </Button>
            </div>
          </div>

          {/* Lista de membros */}
          <div>
            <div class="text-xs font-semibold text-fg-muted mb-2">
              Membros atuais ({members.length})
            </div>

            {isLoading && <Skeleton class="h-24 w-full" />}

            {!isLoading && members.length === 0 && (
              <div class="rounded-md border border-border bg-surface-2 p-4 text-center text-xs text-fg-subtle">
                Nenhum membro nesta equipe ainda.
              </div>
            )}

            {!isLoading && members.length > 0 && (
              <div class="rounded-md border border-border divide-y divide-border overflow-hidden">
                {members.map((m) => {
                  const presence = userPresenceLabel(m.user.lastSeenAt)
                  return (
                    <div key={m.id} class="flex items-center gap-3 px-3 py-2 bg-surface">
                      <span
                        class="size-2 rounded-full shrink-0"
                        style={{ background: presence.color }}
                        title={presence.label}
                      />
                      <div class="min-w-0 flex-1">
                        <div class="text-sm font-medium text-fg flex items-center gap-2 flex-wrap">
                          {m.user.name ?? m.user.email}
                          {m.isLeader && (
                            <Badge tone="warning" solid><Star size={10} class="inline mr-0.5" />Líder</Badge>
                          )}
                        </div>
                        <div class="text-[0.6875rem] text-fg-subtle truncate">
                          {m.user.email} · {m.user.role}
                        </div>
                      </div>
                      <span class="text-[0.6875rem]" style={{ color: presence.color }}>
                        {presence.label}
                      </span>
                      <label class="flex items-center gap-1 text-xs text-fg-muted cursor-pointer">
                        <input
                          type="checkbox"
                          checked={m.isLeader}
                          onChange={(e) => handleToggleLeader(m.user.id, (e.target as HTMLInputElement).checked)}
                        />
                        Líder
                      </label>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setConfirmRemove({ userId: m.user.id, userName: m.user.name ?? m.user.email })}
                        aria-label="Remover da equipe"
                        title="Remover da equipe"
                        class="!text-danger border-danger/30 hover:bg-danger/10"
                      >
                        <XIcon size={12} /> Remover
                      </Button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </Modal>

      {confirmRemove && (
        <ConfirmDialog
          open
          onOpenChange={(o) => { if (!o) setConfirmRemove(null) }}
          title={`Remover "${confirmRemove.userName}"`}
          description="O usuário deixa de ser membro desta equipe (a conta dele continua existindo)."
          destructive
          confirmLabel="Remover"
          loading={remove.isPending}
          onConfirm={() => handleRemove(confirmRemove.userId)}
        />
      )}
    </>
  )
}

function userPresenceLabel(lastSeenAt: string | null): { label: string; color: string } {
  if (!lastSeenAt) return { label: 'Nunca', color: 'var(--color-fg-subtle)' }
  const ms = Date.now() - new Date(lastSeenAt).getTime()
  if (ms < 5 * 60_000) return { label: 'Online', color: 'var(--color-success)' }
  if (ms < 30 * 60_000) return { label: 'Ausente', color: 'var(--color-warning)' }
  if (ms < 24 * 3600_000) {
    const min = Math.floor(ms / 60_000)
    if (min < 60) return { label: `há ${min}min`, color: 'var(--color-fg-muted)' }
    return { label: `há ${Math.floor(min / 60)}h`, color: 'var(--color-fg-muted)' }
  }
  return { label: `há ${Math.floor(ms / (24 * 3600_000))}d`, color: 'var(--color-fg-subtle)' }
}
