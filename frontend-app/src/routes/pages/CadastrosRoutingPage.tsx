import { useState, useMemo, useEffect } from 'preact/hooks'
import {
  Settings as SettingsIcon, Users as UsersIcon, AlertTriangle,
  Power, Calendar, Pencil, GitBranch, Plus, Trash2, GripVertical, Zap,
  FlaskConical, ScrollText, Clock, ArrowRightLeft,
} from 'lucide-preact'
import { Input } from '@/components/ui/Input'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { toast } from '@/lib/toast'
import { ApiError } from '@/lib/apiClient'
import {
  useAgents, useUpdateAgent,
  useRoutingFeatureFlag, useToggleRoutingFeatureFlag,
  useOutOfHoursTeam, useSetOutOfHoursTeam,
  useRoutingTeams,
  useRoutingRules, useToggleRoutingRule, useDeleteRoutingRule, useReorderRoutingRules,
  useEscalationConfig, useUpdateEscalationConfig,
  useShiftConfig, useUpdateShiftConfig,
  useTransferTimeout, useSetTransferTimeout,
  type RoutingAgent, type RoutingRule,
} from '@/hooks/useRouting'
import { AgentEditDrawer } from '@/components/routing/AgentEditDrawer'
import { RuleEditModal } from '@/components/routing/RuleEditModal'
import { SimulatorTab } from '@/components/routing/SimulatorTab'
import { LogsTab } from '@/components/routing/LogsTab'

type Tab = 'policy' | 'agents' | 'rules' | 'simulator' | 'logs'

export function CadastrosRoutingPage() {
  const [tab, setTab] = useState<Tab>('policy')
  const [editingUserId, setEditingUserId] = useState<number | null>(null)
  const [editingRule, setEditingRule] = useState<RoutingRule | null | 'new'>(null)

  return (
    <Page
      title="Roteamento de Leads"
      description="Configure quem recebe novos leads. Defina agentes, horários de trabalho, regras condicionais e plantão fora de expediente."
    >
      <div class="flex gap-2 border-b border-border mb-4 -mt-2">
        <TabButton active={tab === 'policy'} onClick={() => setTab('policy')} icon={<SettingsIcon class="w-4 h-4" />}>
          Política
        </TabButton>
        <TabButton active={tab === 'agents'} onClick={() => setTab('agents')} icon={<UsersIcon class="w-4 h-4" />}>
          Agentes
        </TabButton>
        <TabButton active={tab === 'rules'} onClick={() => setTab('rules')} icon={<GitBranch class="w-4 h-4" />}>
          Regras
        </TabButton>
        <TabButton active={tab === 'simulator'} onClick={() => setTab('simulator')} icon={<FlaskConical class="w-4 h-4" />}>
          Simulador
        </TabButton>
        <TabButton active={tab === 'logs'} onClick={() => setTab('logs')} icon={<ScrollText class="w-4 h-4" />}>
          Logs
        </TabButton>
      </div>

      {tab === 'policy' && <PolicyTab />}
      {tab === 'agents' && (
        <AgentsTab onEdit={(id) => setEditingUserId(id)} />
      )}
      {tab === 'rules' && (
        <RulesTab
          onCreate={() => setEditingRule('new')}
          onEdit={(rule) => setEditingRule(rule)}
        />
      )}
      {tab === 'simulator' && <SimulatorTab />}
      {tab === 'logs' && <LogsTab />}

      {editingUserId != null && (
        <AgentEditDrawer
          userId={editingUserId}
          onClose={() => setEditingUserId(null)}
        />
      )}

      {editingRule != null && (
        <RuleEditModal
          rule={editingRule === 'new' ? null : editingRule}
          onClose={() => setEditingRule(null)}
        />
      )}
    </Page>
  )
}

// ────────────────────────────────────────────────────────────────────
// Tab nav
// ────────────────────────────────────────────────────────────────────

function TabButton({
  active, onClick, icon, children,
}: {
  active: boolean
  onClick: () => void
  icon: preact.ComponentChildren
  children: preact.ComponentChildren
}) {
  return (
    <button
      onClick={onClick}
      class={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
        active
          ? 'border-accent text-accent'
          : 'border-transparent text-fg-muted hover:text-fg'
      }`}
    >
      {icon}
      {children}
    </button>
  )
}

// ────────────────────────────────────────────────────────────────────
// Aba: Política
// ────────────────────────────────────────────────────────────────────

function PolicyTab() {
  const flag = useRoutingFeatureFlag()
  const toggleFlag = useToggleRoutingFeatureFlag()
  const ooh = useOutOfHoursTeam()
  const setOoh = useSetOutOfHoursTeam()
  const teams = useRoutingTeams()
  const agents = useAgents()

  const agentStats = useMemo(() => {
    const list = agents.data?.agents ?? []
    const active = list.filter((a) => a.isAgent && a.active).length
    const onVacation = list.filter(
      (a) => a.isAgent && a.agentProfile?.vacationUntil && new Date(a.agentProfile.vacationUntil) > new Date(),
    ).length
    const totalOpen = list.reduce((sum, a) => sum + (a.isAgent ? a.openLeadCount : 0), 0)
    return { active, onVacation, totalOpen }
  }, [agents.data])

  const handleToggleFlag = async () => {
    const next = !(flag.data?.enabled ?? false)
    try {
      await toggleFlag.mutateAsync(next)
      toast(next ? 'Roteamento V2 ativado' : 'Roteamento V2 desativado', 'success')
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Falha ao atualizar'
      toast(msg, 'danger')
    }
  }

  const handleSetOoh = async (raw: string) => {
    const teamId = raw === '' ? null : parseInt(raw)
    try {
      await setOoh.mutateAsync(teamId)
      toast('Setor de plantão atualizado', 'success')
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Falha ao salvar'
      toast(msg, 'danger')
    }
  }

  if (flag.isLoading || ooh.isLoading || teams.isLoading) {
    return <Skeleton class="h-48 w-full" />
  }

  const enabled = flag.data?.enabled ?? false
  const oohTeamId = ooh.data?.teamId ?? null
  const teamList = teams.data?.teams ?? []

  return (
    <div class="space-y-4">
      {/* KPIs */}
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card>
          <div class="p-4">
            <div class="text-xs uppercase tracking-wide text-fg-muted">Agentes ativos</div>
            <div class="text-3xl font-semibold mt-1">{agentStats.active}</div>
            <div class="text-xs text-fg-muted mt-1">Usuários com flag de agente habilitada</div>
          </div>
        </Card>
        <Card>
          <div class="p-4">
            <div class="text-xs uppercase tracking-wide text-fg-muted">Em ausência</div>
            <div class="text-3xl font-semibold mt-1">{agentStats.onVacation}</div>
            <div class="text-xs text-fg-muted mt-1">Com data de retorno futura</div>
          </div>
        </Card>
        <Card>
          <div class="p-4">
            <div class="text-xs uppercase tracking-wide text-fg-muted">Leads abertos no time</div>
            <div class="text-3xl font-semibold mt-1">{agentStats.totalOpen}</div>
            <div class="text-xs text-fg-muted mt-1">Atribuídos a agentes, sem desfecho</div>
          </div>
        </Card>
      </div>

      {/* Feature flag */}
      <Card>
        <div class="p-4 flex items-start gap-4">
          <div class={`p-2 rounded-md ${enabled ? 'bg-success/10 text-success' : 'bg-surface-2 text-fg-muted'}`}>
            <Power class="w-5 h-5" />
          </div>
          <div class="flex-1">
            <div class="flex items-center gap-2">
              <h3 class="font-medium">Motor de roteamento V2</h3>
              <Badge tone={enabled ? 'success' : 'neutral'}>{enabled ? 'Ativo' : 'Inativo'}</Badge>
            </div>
            <p class="text-sm text-fg-muted mt-1">
              Quando ativo, o sistema só atribui leads automaticamente a usuários marcados como
              <strong> Agente</strong>, respeitando capacidade, ausência e horário de trabalho.
              Quando inativo, qualquer membro do setor disponível pode receber (comportamento legado).
            </p>
            {!enabled && agentStats.active === 0 && (
              <div class="mt-3 flex items-center gap-2 text-sm text-warning bg-warning/10 border border-warning/20 rounded p-2">
                <AlertTriangle class="w-4 h-4 flex-shrink-0" />
                <span>Marque ao menos um agente na aba <strong>Agentes</strong> antes de ativar.</span>
              </div>
            )}
          </div>
          <Button
            variant={enabled ? 'secondary' : 'primary'}
            onClick={handleToggleFlag}
            disabled={toggleFlag.isPending || (!enabled && agentStats.active === 0)}
          >
            {enabled ? 'Desativar' : 'Ativar'}
          </Button>
        </div>
      </Card>

      {/* OOH team */}
      <Card>
        <div class="p-4">
          <div class="flex items-start gap-4">
            <div class="p-2 rounded-md bg-surface-2 text-fg-muted">
              <Calendar class="w-5 h-5" />
            </div>
            <div class="flex-1">
              <h3 class="font-medium">Setor de plantão fora do horário</h3>
              <p class="text-sm text-fg-muted mt-1">
                Quando o setor original tem horário habilitado e está fechado, o lead pode ser
                redirecionado para este setor de plantão. Deixe em branco para manter na fila
                do setor original até o expediente.
              </p>
              <div class="mt-3 max-w-md">
                <Select
                  value={oohTeamId == null ? '' : String(oohTeamId)}
                  onChange={(e) => handleSetOoh((e.currentTarget as HTMLSelectElement).value)}
                  disabled={setOoh.isPending}
                >
                  <option value="">— Nenhum (manter na fila) —</option>
                  {teamList
                    .filter((t) => t.active)
                    .map((t) => (
                      <option key={t.id} value={String(t.id)}>{t.name}</option>
                    ))}
                </Select>
              </div>
            </div>
          </div>
        </div>
      </Card>

      <EscalationCard />
      <ShiftCard />
      <TransferTimeoutCard />
    </div>
  )
}

function EscalationCard() {
  const cfg = useEscalationConfig()
  const update = useUpdateEscalationConfig()
  const [draftMinutes, setDraftMinutes] = useState<string>('')

  useEffect(() => {
    if (cfg.data) setDraftMinutes(String(cfg.data.minutes))
  }, [cfg.data])

  if (cfg.isLoading || !cfg.data) return <Skeleton class="h-32 w-full" />
  const c = cfg.data

  const handle = async (patch: Partial<typeof c>) => {
    try {
      await update.mutateAsync(patch)
      toast('Configuração de escalação atualizada', 'success')
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Falha ao salvar'
      toast(msg, 'danger')
    }
  }

  const handleSaveMinutes = async () => {
    const n = parseInt(draftMinutes)
    if (!Number.isFinite(n) || n < 5 || n > 1440) {
      toast('Minutos deve estar entre 5 e 1440', 'danger')
      return
    }
    await handle({ minutes: n })
  }

  return (
    <Card>
      <div class="p-4 flex items-start gap-4">
        <div class={`p-2 rounded-md ${c.enabled ? 'bg-warning/10 text-warning' : 'bg-surface-2 text-fg-muted'}`}>
          <Zap class="w-5 h-5" />
        </div>
        <div class="flex-1">
          <div class="flex items-center gap-2">
            <h3 class="font-medium">Escalação automática</h3>
            <Badge tone={c.enabled ? 'warning' : 'neutral'}>{c.enabled ? 'Ativa' : 'Inativa'}</Badge>
          </div>
          <p class="text-sm text-fg-muted mt-1">
            Devolve à fila leads atribuídos a agentes em ausência, inativos ou sem resposta
            há muito tempo. Rodada a cada 5 min. Activities pendentes de cadência seguem o lead.
          </p>
          <div class="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <div class="text-xs text-fg-muted mb-1">Tempo sem resposta (minutos)</div>
              <div class="flex gap-2">
                <Input
                  type="number"
                  min={5}
                  max={1440}
                  value={draftMinutes}
                  onInput={(e) => setDraftMinutes((e.currentTarget as HTMLInputElement).value)}
                />
                <Button
                  variant="secondary"
                  onClick={handleSaveMinutes}
                  disabled={update.isPending || draftMinutes === String(c.minutes)}
                >
                  Salvar
                </Button>
              </div>
              <div class="text-xs text-fg-subtle mt-1">5–1440 min ({Math.round(c.minutes / 60 * 10) / 10}h hoje)</div>
            </div>
            <div>
              <div class="text-xs text-fg-muted mb-1">Devolver de agente offline</div>
              <label class="inline-flex items-center cursor-pointer mt-1">
                <input
                  type="checkbox"
                  checked={c.reassignOnOffline}
                  onChange={() => handle({ reassignOnOffline: !c.reassignOnOffline })}
                  disabled={update.isPending}
                  class="sr-only peer"
                />
                <div class="relative w-9 h-5 bg-surface-3 rounded-full peer peer-checked:bg-accent transition-colors">
                  <div class={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${c.reassignOnOffline ? 'translate-x-4' : ''}`} />
                </div>
                <span class="ml-2 text-sm">{c.reassignOnOffline ? 'Sim' : 'Não'}</span>
              </label>
              <div class="text-xs text-fg-subtle mt-1">Threshold: 30min offline</div>
            </div>
            <div class="flex items-end">
              <Button
                variant={c.enabled ? 'secondary' : 'primary'}
                onClick={() => handle({ enabled: !c.enabled })}
                disabled={update.isPending}
              >
                {c.enabled ? 'Desativar escalação' : 'Ativar escalação'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Card>
  )
}

function ShiftCard() {
  const cfg = useShiftConfig()
  const update = useUpdateShiftConfig()
  const [draft, setDraft] = useState('')

  useEffect(() => { if (cfg.data) setDraft(String(cfg.data.toleranceMinutes)) }, [cfg.data])

  if (cfg.isLoading || !cfg.data) return <Skeleton class="h-32 w-full" />
  const c = cfg.data

  const handle = async (patch: Partial<typeof c>) => {
    try {
      await update.mutateAsync(patch)
      toast('Hand-off atualizado', 'success')
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Falha ao salvar', 'danger')
    }
  }

  const handleSaveTolerance = async () => {
    const n = parseInt(draft)
    if (!Number.isFinite(n) || n < 0 || n > 240) {
      toast('Tolerância deve estar entre 0 e 240', 'danger')
      return
    }
    await handle({ toleranceMinutes: n })
  }

  return (
    <Card>
      <div class="p-4 flex items-start gap-4">
        <div class={`p-2 rounded-md ${c.enabled ? 'bg-info/10 text-info' : 'bg-surface-2 text-fg-muted'}`}>
          <Clock class="w-5 h-5" />
        </div>
        <div class="flex-1">
          <div class="flex items-center gap-2">
            <h3 class="font-medium">Hand-off no fim do turno</h3>
            <Badge tone={c.enabled ? 'info' : 'neutral'}>{c.enabled ? 'Ativo' : 'Inativo'}</Badge>
          </div>
          <p class="text-sm text-fg-muted mt-1">
            Quando o turno de um agente termina (conforme horários configurados em <strong>Agentes</strong>),
            seus leads abertos são devolvidos à fila do setor. Activities pendentes da cadência seguem o lead.
          </p>
          <div class="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <div class="text-xs text-fg-muted mb-1">Tolerância após fim do turno (minutos)</div>
              <div class="flex gap-2">
                <Input
                  type="number"
                  min={0}
                  max={240}
                  value={draft}
                  onInput={(e) => setDraft((e.currentTarget as HTMLInputElement).value)}
                />
                <Button
                  variant="secondary"
                  onClick={handleSaveTolerance}
                  disabled={update.isPending || draft === String(c.toleranceMinutes)}
                >
                  Salvar
                </Button>
              </div>
              <div class="text-xs text-fg-subtle mt-1">0–240 min (0 = libera imediato; 30 = padrão)</div>
            </div>
            <div class="flex items-end">
              <Button
                variant={c.enabled ? 'secondary' : 'primary'}
                onClick={() => handle({ enabled: !c.enabled })}
                disabled={update.isPending}
              >
                {c.enabled ? 'Desativar hand-off' : 'Ativar hand-off'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Card>
  )
}

function TransferTimeoutCard() {
  const cfg = useTransferTimeout()
  const update = useSetTransferTimeout()
  const [draft, setDraft] = useState('')

  useEffect(() => { if (cfg.data) setDraft(String(cfg.data.hours)) }, [cfg.data])

  if (cfg.isLoading || !cfg.data) return <Skeleton class="h-24 w-full" />

  const handleSave = async () => {
    const n = parseInt(draft)
    if (!Number.isFinite(n) || n < 1 || n > 168) {
      toast('Horas deve estar entre 1 e 168 (7 dias)', 'danger')
      return
    }
    try {
      await update.mutateAsync(n)
      toast('Timeout atualizado', 'success')
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Falha ao salvar', 'danger')
    }
  }

  return (
    <Card>
      <div class="p-4 flex items-start gap-4">
        <div class="p-2 rounded-md bg-surface-2 text-fg-muted">
          <ArrowRightLeft class="w-5 h-5" />
        </div>
        <div class="flex-1">
          <h3 class="font-medium">Transferência consensual — timeout</h3>
          <p class="text-sm text-fg-muted mt-1">
            Pedidos de transferência não respondidos são cancelados automaticamente após esse tempo.
            Lead volta a ficar com quem solicitou.
          </p>
          <div class="mt-3 flex items-end gap-2 max-w-md">
            <Input
              label="Horas"
              type="number"
              min={1}
              max={168}
              value={draft}
              onInput={(e) => setDraft((e.currentTarget as HTMLInputElement).value)}
            />
            <Button
              variant="secondary"
              onClick={handleSave}
              disabled={update.isPending || draft === String(cfg.data.hours)}
            >
              Salvar
            </Button>
          </div>
          <div class="text-xs text-fg-subtle mt-1">1–168 horas (24 = padrão)</div>
        </div>
      </div>
    </Card>
  )
}

// ────────────────────────────────────────────────────────────────────
// Aba: Agentes
// ────────────────────────────────────────────────────────────────────

function AgentsTab({ onEdit }: { onEdit: (userId: number) => void }) {
  const agents = useAgents()

  if (agents.isLoading) return <Skeleton class="h-64 w-full" />
  if (agents.isError) {
    return (
      <Card><div class="p-6 text-sm text-danger">Erro ao carregar agentes.</div></Card>
    )
  }

  const list = agents.data?.agents ?? []
  if (list.length === 0) {
    return (
      <EmptyState
        icon={<UsersIcon class="w-8 h-8" />}
        title="Sem usuários disponíveis"
        description="Crie usuários em Configurações > Usuários para liberar como agentes."
      />
    )
  }

  return (
    <Card>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="text-left text-xs uppercase tracking-wide text-fg-muted border-b border-border">
            <tr>
              <th class="px-4 py-3">Usuário</th>
              <th class="px-4 py-3">Papel</th>
              <th class="px-4 py-3">Status</th>
              <th class="px-4 py-3 text-right">Leads abertos</th>
              <th class="px-4 py-3 text-right">Setores</th>
              <th class="px-4 py-3 text-right">Capacidade</th>
              <th class="px-4 py-3">Peso</th>
              <th class="px-4 py-3">Agente</th>
              <th class="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {list.map((a) => <AgentRow key={a.id} agent={a} onEdit={onEdit} />)}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function AgentRow({ agent, onEdit }: { agent: RoutingAgent; onEdit: (id: number) => void }) {
  const update = useUpdateAgent(agent.id)

  const handleToggle = async (e: Event) => {
    const next = (e.currentTarget as HTMLInputElement).checked
    try {
      await update.mutateAsync({ isAgent: next })
      toast(next ? `${agent.name} agora é agente` : `${agent.name} não recebe mais leads`, 'success')
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Falha ao atualizar'
      toast(msg, 'danger')
    }
  }

  const isOnVacation = agent.agentProfile?.vacationUntil &&
    new Date(agent.agentProfile.vacationUntil) > new Date()

  return (
    <tr class="border-b border-border last:border-0 hover:bg-surface-2">
      <td class="px-4 py-3">
        <div class="font-medium">{agent.name}</div>
        <div class="text-xs text-fg-muted">{agent.email}</div>
      </td>
      <td class="px-4 py-3 text-fg-muted">{agent.role}</td>
      <td class="px-4 py-3">
        <Badge tone={agent.workStatus === 'available' ? 'success' : 'neutral'}>
          {workStatusLabel(agent.workStatus)}
        </Badge>
        {isOnVacation && (
          <Badge tone="warning" class="ml-1">Ausente</Badge>
        )}
      </td>
      <td class="px-4 py-3 text-right tabular-nums">{agent.openLeadCount}</td>
      <td class="px-4 py-3 text-right tabular-nums">{agent.teamCount}</td>
      <td class="px-4 py-3 text-right tabular-nums">{agent.capacity}</td>
      <td class="px-4 py-3 tabular-nums">{agent.agentProfile?.weight ?? '—'}</td>
      <td class="px-4 py-3">
        <label class="inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={agent.isAgent}
            onChange={handleToggle}
            disabled={update.isPending}
            class="sr-only peer"
          />
          <div class="relative w-9 h-5 bg-surface-3 rounded-full peer peer-checked:bg-accent transition-colors">
            <div class={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${agent.isAgent ? 'translate-x-4' : ''}`} />
          </div>
        </label>
      </td>
      <td class="px-4 py-3 text-right">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onEdit(agent.id)}
          title="Editar agente"
        >
          <Pencil class="w-4 h-4" />
        </Button>
      </td>
    </tr>
  )
}

function workStatusLabel(s: string): string {
  switch (s) {
    case 'available': return 'Disponível'
    case 'away': return 'Ausente'
    case 'busy': return 'Ocupado'
    case 'offline': return 'Offline'
    default: return s
  }
}

// ────────────────────────────────────────────────────────────────────
// Aba: Regras
// ────────────────────────────────────────────────────────────────────

function RulesTab({
  onCreate, onEdit,
}: {
  onCreate: () => void
  onEdit: (rule: RoutingRule) => void
}) {
  const rules = useRoutingRules()
  const teams = useRoutingTeams()
  const agents = useAgents()
  const delMutation = useDeleteRoutingRule()
  const reorder = useReorderRoutingRules()
  const toggleRule = useToggleRoutingRule()
  const flag = useRoutingFeatureFlag()

  const handleToggleEnabled = async (rule: RoutingRule) => {
    try {
      await toggleRule.mutateAsync({ ruleId: rule.id, enabled: !rule.enabled })
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Falha ao alternar'
      toast(msg, 'danger')
    }
  }

  const handleDelete = async (rule: RoutingRule) => {
    if (!confirm(`Excluir regra "${rule.name}"?`)) return
    try {
      await delMutation.mutateAsync(rule.id)
      toast('Regra excluída', 'success')
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Falha ao excluir'
      toast(msg, 'danger')
    }
  }

  const handleMove = async (rule: RoutingRule, direction: -1 | 1) => {
    const list = rules.data?.rules ?? []
    const idx = list.findIndex((r) => r.id === rule.id)
    const swap = idx + direction
    if (idx < 0 || swap < 0 || swap >= list.length) return
    const reordered = [...list]
    const tmp = reordered[idx]!
    reordered[idx] = reordered[swap]!
    reordered[swap] = tmp
    try {
      await reorder.mutateAsync(reordered.map((r) => r.id))
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Falha ao reordenar'
      toast(msg, 'danger')
    }
  }

  if (rules.isLoading) return <Skeleton class="h-64 w-full" />

  const list = rules.data?.rules ?? []
  const v2Off = flag.data && !flag.data.enabled
  const teamName = (id: number) =>
    teams.data?.teams.find((t) => t.id === id)?.name ?? `#${id}`
  const agentName = (id: number) =>
    agents.data?.agents.find((a) => a.id === id)?.name ?? `#${id}`

  return (
    <div class="space-y-3">
      {v2Off && (
        <div class="flex items-center gap-2 text-sm text-warning bg-warning/10 border border-warning/20 rounded p-3">
          <AlertTriangle class="w-4 h-4 flex-shrink-0" />
          <span>
            Motor V2 está <strong>desativado</strong>. Regras estão salvas, mas não são avaliadas
            até que você ligue na aba Política.
          </span>
        </div>
      )}

      <div class="flex items-center justify-between">
        <div>
          <h3 class="text-sm font-semibold">Regras em cascata</h3>
          <p class="text-xs text-fg-muted">
            Avaliadas em ordem (de cima pra baixo). A primeira regra cujas condições todas casam
            define o destino. Se nenhuma casar, usa a cascata padrão (form → chatbot → instância → setor global).
          </p>
        </div>
        <Button onClick={onCreate}>
          <Plus class="w-4 h-4 mr-1" /> Nova regra
        </Button>
      </div>

      {list.length === 0 ? (
        <EmptyState
          icon={<GitBranch class="w-8 h-8" />}
          title="Nenhuma regra cadastrada"
          description='Clique em "Nova regra" para definir o seu primeiro critério condicional.'
        />
      ) : (
        <Card>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="text-left text-xs uppercase tracking-wide text-fg-muted border-b border-border">
                <tr>
                  <th class="px-3 py-3"></th>
                  <th class="px-3 py-3">#</th>
                  <th class="px-3 py-3">Regra</th>
                  <th class="px-3 py-3">Condições</th>
                  <th class="px-3 py-3">Destino</th>
                  <th class="px-3 py-3 text-right">Matches</th>
                  <th class="px-3 py-3">Ativa</th>
                  <th class="px-3 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {list.map((rule, idx) => (
                  <tr key={rule.id} class="border-b border-border last:border-0 hover:bg-surface-2">
                    <td class="px-3 py-3">
                      <div class="flex flex-col gap-0.5">
                        <button
                          onClick={() => handleMove(rule, -1)}
                          disabled={idx === 0 || reorder.isPending}
                          class="text-fg-muted hover:text-fg disabled:opacity-30"
                          title="Mover pra cima"
                        >
                          <GripVertical class="w-3 h-3 rotate-180" />
                        </button>
                        <button
                          onClick={() => handleMove(rule, 1)}
                          disabled={idx === list.length - 1 || reorder.isPending}
                          class="text-fg-muted hover:text-fg disabled:opacity-30"
                          title="Mover pra baixo"
                        >
                          <GripVertical class="w-3 h-3" />
                        </button>
                      </div>
                    </td>
                    <td class="px-3 py-3 text-fg-muted tabular-nums">{idx + 1}</td>
                    <td class="px-3 py-3">
                      <div class="font-medium">{rule.name}</div>
                      {rule.description && (
                        <div class="text-xs text-fg-muted">{rule.description}</div>
                      )}
                    </td>
                    <td class="px-3 py-3 text-xs text-fg-muted">
                      {rule.conditions.length === 0 ? (
                        <span class="italic">sempre casa</span>
                      ) : (
                        <div class="flex flex-wrap gap-1">
                          {rule.conditions.slice(0, 3).map((c, i) => (
                            <Badge tone="neutral" key={i}>
                              {c.field} {c.op}{' '}
                              {Array.isArray(c.value)
                                ? `[${c.value.join(', ')}]`
                                : String(c.value ?? '')}
                            </Badge>
                          ))}
                          {rule.conditions.length > 3 && (
                            <span class="text-fg-muted">+{rule.conditions.length - 3}</span>
                          )}
                        </div>
                      )}
                    </td>
                    <td class="px-3 py-3 text-xs">
                      {rule.action.type === 'team' && `Setor: ${teamName(rule.action.teamId)}`}
                      {rule.action.type === 'user' && `Agente: ${agentName(rule.action.userId)}`}
                      {rule.action.type === 'skill' && (
                        <>
                          Skill <strong>{rule.action.skill}</strong> em {teamName(rule.action.teamId)}
                        </>
                      )}
                    </td>
                    <td class="px-3 py-3 text-right tabular-nums">
                      {rule.matchedCount}
                    </td>
                    <td class="px-3 py-3">
                      <label class="inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={rule.enabled}
                          onChange={() => handleToggleEnabled(rule)}
                          class="sr-only peer"
                        />
                        <div class="relative w-9 h-5 bg-surface-3 rounded-full peer peer-checked:bg-accent transition-colors">
                          <div class={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${rule.enabled ? 'translate-x-4' : ''}`} />
                        </div>
                      </label>
                    </td>
                    <td class="px-3 py-3 text-right">
                      <div class="flex gap-1 justify-end">
                        <Button variant="ghost" size="sm" onClick={() => onEdit(rule)} title="Editar">
                          <Pencil class="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => handleDelete(rule)} title="Excluir">
                          <Trash2 class="w-4 h-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
