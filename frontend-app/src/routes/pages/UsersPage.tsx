import { useState } from 'preact/hooks'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Plus, Pencil, Trash2, History, Users as UsersIcon, UserPlus, Crown, X as XIcon, ChevronDown, ArrowRight, HelpCircle } from 'lucide-preact'
import { HowItWorksModal } from '@/components/ui/HowItWorksModal'
import {
  useUsers, useUserAudit, useCreateUser, useUpdateUser, useDeleteUser,
  ROLE_LABELS, ROLE_TONES,
  type AdminUser, type UserRole, type UserAuditEntry,
} from '@/hooks/useUsers'
import {
  useTeams, useTeamMembers, useAddTeamMember, useUpdateTeamMember, useRemoveTeamMember,
  type Team,
} from '@/hooks/useTeams'
import { useAuth } from '@/hooks/useAuth'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Input, Select } from '@/components/ui/Input'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { toast } from '@/lib/toast'

const ALL_ROLES: UserRole[] = ['SUPERADMIN', 'ADMIN', 'MANAGER', 'AGENT', 'VIEWER']

// Reforma F1: papéis com tooltip de scope para ajudar admin escolher.
// (export para reuso futuro em outras telas que mostram a hint inline.)
export const ROLE_HINTS: Record<UserRole, string> = {
  SUPERADMIN: 'Acesso completo + gestão de outros admins',
  ADMIN: 'Acesso completo ao tenant. Vê tudo.',
  MANAGER: 'Líder de setor. Vê tudo do(s) setor(es) dele.',
  AGENT: 'Atendente operacional. Vê apenas os próprios leads.',
  VIEWER: 'Somente leitura, sem atender leads.',
}

const dateOnly = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
const dateTimeShort = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
})

function formatDateOnly(d: string | null | undefined): string {
  if (!d) return '—'
  const date = new Date(d)
  if (Number.isNaN(date.getTime())) return '—'
  return dateOnly.format(date)
}

function formatLastLogin(d: string | null | undefined): string {
  if (!d) return 'Nunca'
  const date = new Date(d)
  if (Number.isNaN(date.getTime())) return 'Nunca'
  return dateTimeShort.format(date)
}

function PresenceDot({ lastSeenAt }: { lastSeenAt: string | null }) {
  if (!lastSeenAt) return null
  const date = new Date(lastSeenAt)
  if (Number.isNaN(date.getTime())) return null
  const minutes = (Date.now() - date.getTime()) / 60_000
  const online = minutes < 5
  return (
    <span
      class="inline-block size-2 rounded-full mr-1.5 align-middle"
      style={{ background: online ? 'var(--color-success)' : 'var(--color-fg-subtle)' }}
      title={online ? 'Online' : 'Offline'}
      aria-label={online ? 'Online' : 'Offline'}
    />
  )
}

export function UsersPage() {
  const { data, isLoading } = useUsers()
  const { user: me } = useAuth()
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<AdminUser | null>(null)
  const [deleting, setDeleting] = useState<AdminUser | null>(null)
  const [auditing, setAuditing] = useState<AdminUser | null>(null)
  const [editingTeams, setEditingTeams] = useState<AdminUser | null>(null)
  const [showHowItWorks, setShowHowItWorks] = useState(false)

  const isSuperAdmin = me?.role === 'SUPERADMIN'
  const users = data?.users ?? []

  return (
    <Page
      title="Usuários"
      description="Operadores e administradores do sistema. Convide, ajuste perfis e revogue acessos."
      actions={
        <div class="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setShowHowItWorks(true)}>
            <HelpCircle size={14} /> Como funciona?
          </Button>
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            <Plus size={14} /> Novo usuário
          </Button>
        </div>
      }
    >
      {isLoading && (
        <div class="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} class="h-14 w-full" />)}
        </div>
      )}

      {!isLoading && users.length === 0 && (
        <EmptyState
          icon={<UsersIcon size={24} />}
          title="Nenhum usuário cadastrado"
          action={<Button size="sm" variant="primary" onClick={() => setCreating(true)}><Plus size={14} /> Criar primeiro</Button>}
        />
      )}

      {!isLoading && users.length > 0 && (
        <Card class="p-0 overflow-hidden">
          <div class="px-4 py-3 border-b border-border flex items-center gap-2">
            <span class="text-sm font-semibold text-fg">Todos os usuários</span>
            <span class="text-xs text-fg-subtle">·</span>
            <span class="text-xs text-fg-subtle">{users.length} registros</span>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="bg-surface-3 text-fg-subtle text-[0.6875rem] uppercase tracking-wider">
                <tr>
                  <th class="text-left px-4 py-2 font-medium">Usuário</th>
                  <th class="text-left px-4 py-2 font-medium">Perfil</th>
                  <th class="text-left px-4 py-2 font-medium">Status</th>
                  <th class="text-left px-4 py-2 font-medium">Último login</th>
                  <th class="text-left px-4 py-2 font-medium">Criado em</th>
                  <th class="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-border">
                {users.map((u) => (
                  <tr key={u.id} class="hover:bg-surface-3">
                    <td class="px-4 py-2">
                      <PresenceDot lastSeenAt={u.lastSeenAt} />
                      <strong class="text-fg font-semibold">{u.name ?? u.email}</strong>
                      {u.name && <span class="text-fg-subtle text-[0.6875rem] ml-1">· {u.email}</span>}
                    </td>
                    <td class="px-4 py-2">
                      <Badge tone={ROLE_TONES[u.role]}>{ROLE_LABELS[u.role]}</Badge>
                    </td>
                    <td class="px-4 py-2">
                      <span class="inline-flex items-center gap-1.5 text-xs">
                        <span
                          class="size-2 rounded-full"
                          style={{ background: u.active ? 'var(--color-success)' : 'var(--color-danger)' }}
                        />
                        {u.active ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td class="px-4 py-2 text-xs text-fg-muted whitespace-nowrap">
                      {formatLastLogin(u.lastLoginAt)}
                    </td>
                    <td class="px-4 py-2 text-xs text-fg-muted whitespace-nowrap">
                      {formatDateOnly(u.createdAt)}
                    </td>
                    <td class="px-4 py-2 text-right">
                      <UserActionsMenu
                        user={u}
                        canDelete={Number(me?.id) !== u.id}
                        onEdit={() => setEditing(u)}
                        onTeams={() => setEditingTeams(u)}
                        onAudit={() => setAuditing(u)}
                        onDelete={() => setDeleting(u)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {creating && (
        <UserFormModal
          user={null}
          isSuperAdmin={isSuperAdmin}
          onClose={() => setCreating(false)}
        />
      )}
      {editing && (
        <UserFormModal
          user={editing}
          isSuperAdmin={isSuperAdmin}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <DeleteUserDialog user={deleting} onClose={() => setDeleting(null)} />
      )}
      {auditing && (
        <UserAuditModal user={auditing} onClose={() => setAuditing(null)} />
      )}
      {editingTeams && (
        <UserTeamsModal user={editingTeams} onClose={() => setEditingTeams(null)} />
      )}

      <HowItWorksModal
        open={showHowItWorks}
        onClose={() => setShowHowItWorks(false)}
        title="Como funcionam os Usuários?"
        problem={<>
          Cada pessoa que usa o sistema é um <strong>usuário</strong>: vendedor, gerente, atendente,
          admin. Aqui você convida, define o papel (que controla o que ele vê e pode fazer), liga
          às equipes, e revoga acesso quando alguém sai. É o controle central de quem entra.
        </>}
        steps={[
          {
            title: '➕ Novo usuário',
            body: <>Botão <strong>Novo usuário</strong>: nome, e-mail, senha inicial, papel. O usuário recebe convite e pode trocar a senha no primeiro acesso (ou fluxo "esqueci senha").</>,
          },
          {
            title: '👔 Papéis (roles)',
            body: <><strong>SUPERADMIN</strong>: poder total, gerencia tudo. <strong>ADMIN</strong>: gerencia operação, sem mexer em config global. <strong>OPERADOR</strong>: trabalha leads/conversas. <strong>VIEWER</strong>: só lê, sem modificar. Permissões finas estão em "Permissões por Módulo".</>,
          },
          {
            title: '👥 Equipes',
            body: <>Atribua o usuário a uma ou mais <strong>equipes</strong> (ex.: Vendas SP, Pós-venda, Inbound). As equipes controlam roteamento de leads e filtros de "minhas conversas" vs "do time" vs "todas".</>,
          },
          {
            title: '📜 Auditoria',
            body: <>Ícone de histórico mostra <strong>tudo que o usuário fez</strong>: leads criados, mensagens enviadas, etapas movidas, deleções. Útil pra investigar incidentes ou treinar.</>,
          },
          {
            title: '🚫 Revogar acesso',
            body: <>Quando alguém sai da empresa, <strong>exclua</strong> ou desative. Atribuições ativas (leads, conversas, atividades) podem ser <strong>transferidas</strong> pra outro operador no momento da exclusão.</>,
          },
        ]}
        tip={{
          tone: 'warning',
          title: '⚠️ Cuidado com SUPERADMIN',
          body: <>SUPERADMIN tem acesso a TUDO — incluindo apagar dados, conectar integrações, configurar pagamento. Use só pro responsável técnico. Pra dia a dia (até gestor), ADMIN basta.</>,
        }}
      />
    </Page>
  )
}

function UserActionsMenu({
  user, canDelete, onEdit, onTeams, onAudit, onDelete,
}: {
  user: AdminUser
  canDelete: boolean
  onEdit: () => void
  onTeams: () => void
  onAudit: () => void
  onDelete: () => void
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          class="inline-flex items-center gap-1 h-7 px-2 rounded-md text-xs text-fg-muted border border-border hover:bg-surface-3 hover:text-fg"
          aria-label={`Opções de ${user.name ?? user.email}`}
        >
          Opções <ChevronDown size={12} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          class="min-w-[12rem] rounded-md bg-surface-2 border border-border shadow-lg p-1"
          style={{ zIndex: 'var(--z-popover)' }}
        >
          <DropdownMenu.Item
            class="flex items-center gap-2 h-8 px-2 rounded-sm text-sm cursor-pointer hover:bg-surface-3 outline-none"
            onSelect={onEdit}
          >
            <Pencil size={14} /> Editar usuário
          </DropdownMenu.Item>
          <DropdownMenu.Item
            class="flex items-center gap-2 h-8 px-2 rounded-sm text-sm cursor-pointer hover:bg-surface-3 outline-none"
            onSelect={onTeams}
          >
            <UsersIcon size={14} /> Equipes
          </DropdownMenu.Item>
          <DropdownMenu.Item
            class="flex items-center gap-2 h-8 px-2 rounded-sm text-sm cursor-pointer hover:bg-surface-3 outline-none"
            onSelect={onAudit}
          >
            <History size={14} /> Histórico
          </DropdownMenu.Item>
          {canDelete && (
            <>
              <DropdownMenu.Separator class="h-px bg-border my-1" />
              <DropdownMenu.Item
                class="flex items-center gap-2 h-8 px-2 rounded-sm text-sm cursor-pointer hover:bg-surface-3 text-danger outline-none"
                onSelect={onDelete}
              >
                <Trash2 size={14} /> Excluir usuário
              </DropdownMenu.Item>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function UserTeamsModal({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const { data: teamsData, isLoading: teamsLoading } = useTeams()
  const teams = teamsData?.teams ?? []

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Equipes — ${user.name ?? user.email}`}
      description="As alterações são salvas automaticamente."
      size="lg"
      footer={<Button variant="primary" size="sm" onClick={onClose}>Fechar</Button>}
    >
      {teamsLoading ? (
        <Skeleton class="h-48 w-full" />
      ) : teams.length === 0 ? (
        <EmptyState title="Nenhuma equipe cadastrada" description="Crie equipes em Configurações → Equipes." />
      ) : (
        <ul class="divide-y divide-border">
          {teams.map((t) => (
            <UserTeamRow key={t.id} team={t} userId={user.id} />
          ))}
        </ul>
      )}
    </Modal>
  )
}

function UserTeamRow({ team, userId }: { team: Team; userId: number }) {
  const { data: members } = useTeamMembers(team.id)
  const member = members?.members.find((m) => m.user.id === userId) ?? null
  const isMember = !!member
  const isLeader = member?.isLeader ?? false

  const add = useAddTeamMember(team.id)
  const update = useUpdateTeamMember(team.id)
  const remove = useRemoveTeamMember(team.id)

  function handleToggleMember() {
    if (isMember) {
      remove.mutate(userId, {
        onSuccess: () => toast(`Removido de "${team.name}"`, 'success'),
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    } else {
      add.mutate({ userId }, {
        onSuccess: () => toast(`Adicionado a "${team.name}"`, 'success'),
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    }
  }

  function handleToggleLeader() {
    if (!isMember) return
    update.mutate({ userId, isLeader: !isLeader }, {
      onSuccess: () => toast(isLeader ? 'Liderança removida' : 'Marcado como líder', 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  const busy = add.isPending || update.isPending || remove.isPending

  return (
    <li class="py-3 flex items-center gap-3">
      <span class="size-3 rounded-full shrink-0" style={{ background: team.color ?? 'var(--color-accent)' }} />
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-sm font-medium text-fg truncate">{team.name}</span>
          {!team.active && <Badge tone="neutral">Inativa</Badge>}
          {isMember && isLeader && <Badge tone="warning"><Crown size={10} /> Líder</Badge>}
          {isMember && !isLeader && <Badge tone="info">Membro</Badge>}
        </div>
        {team.description && <div class="text-xs text-fg-muted truncate mt-0.5">{team.description}</div>}
      </div>
      <div class="flex gap-1 shrink-0">
        {isMember && (
          <Button variant="secondary" size="sm" onClick={handleToggleLeader} disabled={busy}>
            <Crown size={12} /> {isLeader ? 'Remover liderança' : 'Tornar líder'}
          </Button>
        )}
        <Button variant={isMember ? 'secondary' : 'primary'} size="sm" onClick={handleToggleMember} disabled={busy}>
          {isMember ? <><XIcon size={12} /> Remover</> : <><UserPlus size={12} /> Adicionar</>}
        </Button>
      </div>
    </li>
  )
}

function UserFormModal({
  user, isSuperAdmin, onClose,
}: {
  user: AdminUser | null
  isSuperAdmin: boolean
  onClose: () => void
}) {
  const isEdit = !!user
  const [email, setEmail] = useState(user?.email ?? '')
  const [name, setName] = useState(user?.name ?? '')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<UserRole>(user?.role ?? 'VIEWER')
  const [active, setActive] = useState(user?.active ?? true)
  const [capacity, setCapacity] = useState<number>(user?.capacity ?? 5)
  const [notifyWhatsapp, setNotifyWhatsapp] = useState<string>(user?.notifyWhatsapp ?? '')
  const create = useCreateUser()
  const update = useUpdateUser()
  const loading = create.isPending || update.isPending

  const canPickSuperAdmin = isSuperAdmin

  function handleSubmit() {
    const trimmedEmail = email.trim()
    const trimmedName = name.trim()
    if (!trimmedName || !trimmedEmail || (!isEdit && !password)) {
      toast('Preencha todos os campos.', 'danger')
      return
    }
    if (password && password.length < 6) {
      toast('Senha deve ter pelo menos 6 caracteres.', 'danger')
      return
    }

    if (isEdit) {
      const payload: Parameters<typeof update.mutate>[0] = { id: user.id }
      if (trimmedEmail !== user.email) payload.email = trimmedEmail
      if (trimmedName !== (user.name ?? '')) payload.name = trimmedName
      if (role !== user.role) payload.role = role
      if (active !== user.active) payload.active = active
      if (password) payload.password = password
      if (capacity !== (user.capacity ?? 5)) payload.capacity = capacity
      if (notifyWhatsapp.trim() !== (user.notifyWhatsapp ?? '')) payload.notifyWhatsapp = notifyWhatsapp.trim() || null

      const hasChanges = Object.keys(payload).length > 1
      if (!hasChanges) {
        toast('Nenhuma alteração', 'info')
        onClose()
        return
      }

      update.mutate(payload, {
        onSuccess: () => { toast('Usuário atualizado', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    } else {
      create.mutate({
        email: trimmedEmail,
        name: trimmedName,
        password,
        role,
      }, {
        onSuccess: () => { toast('Usuário criado', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    }
  }

  // SUPERADMIN existente não pode ter o role rebaixado por quem não é SUPERADMIN
  const roleSelectDisabled = isEdit && user.role === 'SUPERADMIN' && !canPickSuperAdmin

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={isEdit ? 'Editar usuário' : 'Novo usuário'}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={loading}>
            {loading ? 'Salvando…' : (isEdit ? 'Salvar' : 'Criar usuário')}
          </Button>
        </>
      }
    >
      <div class="space-y-3.5">
        <Input
          label="Nome"
          value={name}
          placeholder="Nome completo"
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
        />
        <Input
          label="Email"
          type="email"
          value={email}
          placeholder="email@exemplo.com"
          onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
        />
        <Input
          label={isEdit ? 'Nova senha' : 'Senha'}
          type="password"
          value={password}
          placeholder={isEdit ? '(deixe vazio para manter)' : 'Mínimo 6 caracteres'}
          onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
        />
        {isEdit ? (
          <div class="grid grid-cols-2 gap-3.5">
            <Select
              label="Perfil"
              value={role}
              disabled={roleSelectDisabled}
              onChange={(e) => setRole((e.target as HTMLSelectElement).value as UserRole)}
            >
              {ALL_ROLES
                .filter((r) => r !== 'SUPERADMIN' || canPickSuperAdmin || user.role === 'SUPERADMIN')
                .map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </Select>
            <Select
              label="Status"
              value={active ? 'true' : 'false'}
              onChange={(e) => setActive((e.target as HTMLSelectElement).value === 'true')}
            >
              <option value="true">Ativo</option>
              <option value="false">Inativo</option>
            </Select>
            <Input
              label="Limite simultâneo (leads em aberto)"
              type="number"
              value={String(capacity)}
              onInput={(e) => {
                const v = parseInt((e.target as HTMLInputElement).value, 10)
                setCapacity(Number.isFinite(v) && v > 0 ? v : 1)
              }}
              hint="Máx. de leads em aberto que o operador pode carregar ao mesmo tempo. Usado pelo modo 'Menor carga' do roteamento e pelo cálculo de utilização."
            />
            <Input
              label="WhatsApp para avisos (opcional)"
              value={notifyWhatsapp}
              placeholder="5562999990000"
              onInput={(e) => setNotifyWhatsapp((e.target as HTMLInputElement).value)}
              hint="Número que recebe avisos internos (ex.: novo lead) quando este operador for o responsável. Sem ele, o aviso cai no número geral de notificação."
            />
          </div>
        ) : (
          <Select
            label="Perfil"
            value={role}
            onChange={(e) => setRole((e.target as HTMLSelectElement).value as UserRole)}
          >
            {ALL_ROLES
              .filter((r) => r !== 'SUPERADMIN' || canPickSuperAdmin)
              .map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </Select>
        )}
      </div>
    </Modal>
  )
}

function DeleteUserDialog({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const del = useDeleteUser()
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Tem certeza que deseja excluir este usuário?"
      description={`${user.name ?? user.email} perde o acesso imediatamente. Pode ser restaurado pela lixeira.`}
      destructive
      confirmLabel="Excluir"
      loading={del.isPending}
      onConfirm={() => del.mutate(user.id, {
        onSuccess: () => { toast('Usuário excluído', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })}
    />
  )
}

const AUDIT_ACTION_LABELS: Record<string, string> = {
  // Legado (entradas antigas sem namespace)
  created: 'Usuário criado',
  edited: 'Usuário editado',
  deleted: 'Usuário excluído',
  // Gestão de usuários + Auth
  'user.created': 'Usuário criado',
  'user.edited': 'Usuário editado',
  'user.deleted': 'Usuário excluído',
  'auth.login': 'Login',
  'auth.logout': 'Logout',
  'auth.password_reset': 'Senha redefinida',
  // Permissões e módulos
  'permission.role_changed': 'Permissões por perfil',
  'permission.user_override_changed': 'Permissões do usuário',
  'module.toggled': 'Módulo ativado/desativado',
  // Configurações e integrações
  'setting.changed': 'Configuração alterada',
  'cloudapi.connected': 'Cloud API conectada',
  'cloudapi.updated': 'Cloud API atualizada',
  'cloudapi.disconnected': 'Cloud API desconectada',
  'apikey.created': 'API key criada',
  'apikey.updated': 'API key atualizada',
  'apikey.revoked': 'API key revogada',
  // Exclusões de dados
  'lead.deleted': 'Lead excluído',
  'lead.bulk_deleted': 'Leads excluídos (em massa)',
  'chatbot.deleted': 'Chatbot excluído',
  'form.deleted': 'Formulário excluído',
  'portal.deleted': 'Portal excluído',
  'registration.deleted': 'Inscrição excluída',
  'routing_rule.created': 'Regra de roteamento criada',
  'routing_rule.updated': 'Regra de roteamento editada',
  'routing_rule.deleted': 'Regra de roteamento excluída',
}

function auditTone(action: string): { color: string; bg: string } {
  let c = 'var(--color-info)'
  if (/(deleted|disconnected|revoked|logout)/.test(action)) c = 'var(--color-danger)'
  else if (/(created|connected)/.test(action) || action === 'auth.login') c = 'var(--color-success)'
  else if (/(toggled|changed|password_reset)/.test(action)) c = 'var(--color-warning)'
  return { color: c, bg: `color-mix(in oklch, ${c} 12%, transparent)` }
}

const AUDIT_FIELD_LABELS: Record<string, string> = {
  name: 'Nome',
  email: 'Email',
  role: 'Perfil',
  active: 'Status',
  password: 'Senha',
  capacity: 'Capacidade',
  enabled: 'Ativo',
  keys: 'Chaves',
  modules: 'Módulos',
  roles: 'Perfis',
  fields: 'Campos',
  permissions: 'Permissões',
  leadIds: 'Leads',
  forced: 'Forçado',
}

function formatAuditValue(field: string, val: unknown): string {
  if (field === 'role' && typeof val === 'string') return ROLE_LABELS[val as UserRole] ?? val
  if (field === 'active') return val ? 'Ativo' : 'Inativo'
  if (field === 'password') return '••••••'
  if (val === null || val === undefined) return '∅'
  if (typeof val === 'string') return val
  if (typeof val === 'number' || typeof val === 'boolean') return String(val)
  return JSON.stringify(val)
}

function UserAuditModal({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const { data, isLoading } = useUserAudit(user.id)
  const audits = data?.data ?? []

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Histórico — ${user.name ?? user.email}`}
      size="lg"
      footer={<Button variant="secondary" size="sm" onClick={onClose}>Fechar</Button>}
    >
      {isLoading && <Skeleton class="h-32 w-full" />}
      {!isLoading && audits.length === 0 && (
        <div class="text-center py-10">
          <History size={48} class="mx-auto text-fg-subtle opacity-40 mb-3" />
          <div class="text-sm font-medium text-fg">Nenhum registro ainda</div>
          <div class="text-xs text-fg-muted mt-1">O histórico começa a ser registrado a partir de agora.</div>
        </div>
      )}
      {!isLoading && audits.length > 0 && (
        <>
          <div class="max-h-[450px] overflow-y-auto pr-1 space-y-2.5">
            {audits.map((a) => <AuditCard key={a.id} entry={a} />)}
          </div>
          <div class="text-center text-[0.6875rem] text-fg-subtle mt-2">
            {audits.length} registro{audits.length > 1 ? 's' : ''}
          </div>
        </>
      )}
    </Modal>
  )
}

function formatGenericValue(val: unknown): string {
  if (Array.isArray(val)) return val.map((v) => String(v)).join(', ') || '∅'
  if (val === null || val === undefined) return '∅'
  if (typeof val === 'boolean') return val ? 'Sim' : 'Não'
  if (typeof val === 'object') return JSON.stringify(val)
  return String(val)
}

function isDiff(v: unknown): v is { from: unknown; to: unknown } {
  return !!v && typeof v === 'object' && 'from' in (v as object) && 'to' in (v as object)
}

function AuditCard({ entry }: { entry: UserAuditEntry }) {
  const action = entry.action
  const label = AUDIT_ACTION_LABELS[action] ?? action
  const tone = auditTone(action)
  const date = formatLastLogin(entry.createdAt)
  const changes: Record<string, unknown> = entry.changes ?? {}
  const changeKeys = Object.keys(changes)
  const diffKeys = changeKeys.filter((k) => isDiff(changes[k]))
  const plainKeys = changeKeys.filter((k) => !isDiff(changes[k]))

  return (
    <div
      class="rounded-r-lg p-2.5 pl-3.5 bg-surface-3"
      style={{ borderLeft: `3px solid ${tone.color}` }}
    >
      <div class="flex items-center justify-between gap-2 flex-wrap">
        <div class="flex items-center gap-2 flex-wrap">
          <span
            class="px-2.5 py-0.5 rounded-full text-[0.6875rem] font-semibold"
            style={{ background: tone.bg, color: tone.color }}
          >
            {label}
          </span>
          <span class="text-[0.8125rem] font-medium text-fg">{entry.actorName ?? 'Sistema'}</span>
          {!entry.viewerIsActor && (
            <span class="text-[0.625rem] uppercase tracking-wider text-fg-subtle">recebida</span>
          )}
        </div>
        <span class="text-[0.6875rem] text-fg-subtle whitespace-nowrap">{date}</span>
      </div>

      {entry.targetLabel && (
        <div class="text-xs text-fg-muted mt-1">
          Alvo: <strong class="text-fg">{entry.targetLabel}</strong>
        </div>
      )}

      {/* Mudanças campo a campo (from → to) */}
      {diffKeys.length > 0 && (
        <div class="mt-1.5 flex flex-col gap-1">
          {diffKeys.map((k) => {
            const obj = changes[k] as { from: unknown; to: unknown }
            const fieldLabel = AUDIT_FIELD_LABELS[k] ?? k
            return (
              <div key={k} class="text-xs text-fg flex items-center gap-1.5 flex-wrap">
                <span class="text-fg-subtle min-w-[3.25rem]">{fieldLabel}:</span>
                <span
                  class="px-1.5 py-0.5 rounded text-[0.6875rem] line-through"
                  style={{ background: 'color-mix(in oklch, var(--color-danger) 14%, transparent)', color: 'var(--color-danger)' }}
                >
                  {formatAuditValue(k, obj.from)}
                </span>
                <ArrowRight size={12} class="text-fg-subtle" />
                <span
                  class="px-1.5 py-0.5 rounded text-[0.6875rem]"
                  style={{ background: 'color-mix(in oklch, var(--color-success) 14%, transparent)', color: 'var(--color-success)' }}
                >
                  {formatAuditValue(k, obj.to)}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* Detalhes simples (listas, contadores) */}
      {plainKeys.length > 0 && (
        <div class="mt-1.5 flex flex-col gap-0.5">
          {plainKeys.map((k) => (
            <div key={k} class="text-xs text-fg-muted">
              <span class="text-fg-subtle">{AUDIT_FIELD_LABELS[k] ?? k}:</span>{' '}
              <span class="text-fg">{formatGenericValue(changes[k])}</span>
            </div>
          ))}
        </div>
      )}

      {entry.ipAddress && (
        <div class="text-[0.625rem] text-fg-subtle mt-1.5">IP: {entry.ipAddress}</div>
      )}
    </div>
  )
}
