import { useEffect, useState } from 'preact/hooks'
import {
  Activity, AlertCircle, AlertTriangle, CheckCircle2, Info, RefreshCw,
  Wifi, WifiOff, Webhook as WebhookIcon, ExternalLink,
} from 'lucide-preact'
import {
  useEvolutionHealth,
  useEvolutionVersion,
  useEvolutionUpgradeStatus,
  useForceEvolutionCheck,
  useFixEvolutionIssue,
  useStartEvolutionUpgrade,
  type EvolutionIssue,
  type EvolutionInstance,
} from '@/hooks/useEvolutionMonitor'
import { useAuth } from '@/hooks/useAuth'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/cn'

export function EvolutionApiSettings() {
  const { data: health, isLoading, error, refetch } = useEvolutionHealth()
  const force = useForceEvolutionCheck()
  const [upgradeOpen, setUpgradeOpen] = useState<string | null>(null) // targetTag
  const [logsOpen, setLogsOpen] = useState(false)

  function handleForceCheck() {
    force.mutate(undefined, {
      onSuccess: () => toast('Verificação concluída', 'success'),
      onError: (e: unknown) => toast((e as Error).message || 'Erro ao verificar', 'danger'),
    })
  }

  if (isLoading) {
    return (
      <div class="space-y-3">
        <Skeleton class="h-32 w-full" />
        <Skeleton class="h-32 w-full" />
        <Skeleton class="h-48 w-full" />
      </div>
    )
  }

  if (error || !health) {
    return (
      <Card>
        <div class="flex items-start gap-2 p-3 text-sm text-fg">
          <AlertCircle size={16} class="mt-0.5 shrink-0 text-danger" />
          <div class="flex-1">
            <div class="font-medium">Erro ao carregar monitor</div>
            <div class="text-xs text-fg-muted mt-0.5">{(error as Error)?.message ?? 'Falha de conexão'}</div>
          </div>
          <Button size="sm" variant="secondary" onClick={() => refetch()}>
            <RefreshCw size={12} /> Tentar de novo
          </Button>
        </div>
      </Card>
    )
  }

  return (
    <div class="space-y-4">
      {/* Status cards */}
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
        <ApiStatusCard health={health} />
        <WebhookStatusCard health={health} />
        <MonitorCard
          lastCheck={health.lastCheck}
          onForce={handleForceCheck}
          forcing={force.isPending}
        />
      </div>

      {/* Versão + Upgrade */}
      <VersionCard onOpenUpgrade={(tag) => setUpgradeOpen(tag)} onOpenLogs={() => setLogsOpen(true)} />

      {/* Instâncias */}
      <InstancesTable instances={health.instances} />

      {/* Issues */}
      {health.issues.length > 0 ? (
        <IssuesCard issues={health.issues} />
      ) : (
        <Card>
          <div class="flex flex-col items-center text-center gap-2 py-6">
            <CheckCircle2 size={28} class="text-accent" />
            <div class="text-sm font-medium text-fg">Tudo funcionando</div>
            <div class="text-xs text-fg-muted">Nenhum problema detectado na Evolution API</div>
          </div>
        </Card>
      )}

      {/* Modais */}
      {upgradeOpen && (
        <UpgradeConfirmModal
          targetTag={upgradeOpen}
          onClose={() => setUpgradeOpen(null)}
          onStarted={() => { setUpgradeOpen(null); setLogsOpen(true) }}
        />
      )}
      {logsOpen && <UpgradeLogsModal onClose={() => setLogsOpen(false)} />}
    </div>
  )
}

// ─── Status cards ──────────────────────────────────────────

function ApiStatusCard({ health }: { health: NonNullable<ReturnType<typeof useEvolutionHealth>['data']> }) {
  const s = health.api.status
  const tone: 'accent' | 'warning' | 'danger' = s === 'online' ? 'accent' : s === 'error' ? 'warning' : 'danger'
  const label = s === 'online' ? 'Online' : s === 'error' ? 'Erro' : 'Offline'
  const Icon = s === 'online' ? Wifi : s === 'error' ? AlertTriangle : WifiOff
  const latencyTone =
    health.api.responseTimeMs > 3000 ? 'text-danger' :
    health.api.responseTimeMs > 1000 ? 'text-warning' :
    'text-fg'

  return (
    <Card>
      <div class="text-[0.625rem] uppercase tracking-wider text-fg-subtle font-medium mb-2">Evolution API</div>
      <div class="flex items-center gap-2 mb-2">
        <Icon size={18} class={cn(
          tone === 'accent' && 'text-accent',
          tone === 'warning' && 'text-warning',
          tone === 'danger' && 'text-danger',
        )} />
        <Badge tone={tone} solid>{label}</Badge>
      </div>
      <div class="text-xs text-fg-muted">Latência: <strong class={cn('tabular-nums', latencyTone)}>{health.api.responseTimeMs}ms</strong></div>
      {health.api.version && (
        <div class="text-xs text-fg-muted mt-0.5">Versão: <strong class="text-fg">{health.api.version}</strong></div>
      )}
      <div class="text-[0.6875rem] text-fg-subtle mt-1 break-all font-mono">{health.api.url}</div>
      {health.api.error && (
        <div class="text-[0.6875rem] text-danger mt-1">{health.api.error}</div>
      )}
    </Card>
  )
}

function WebhookStatusCard({ health }: { health: NonNullable<ReturnType<typeof useEvolutionHealth>['data']> }) {
  const s = health.webhook.status
  const tone: 'accent' | 'warning' | 'danger' = s === 'ok' ? 'accent' : s === 'misconfigured' ? 'warning' : 'danger'
  const label =
    s === 'ok' ? 'Configurado' :
    s === 'misconfigured' ? 'URL incorreta' :
    s === 'missing' ? 'Não configurado' :
    'Erro'

  return (
    <Card>
      <div class="text-[0.625rem] uppercase tracking-wider text-fg-subtle font-medium mb-2">Webhook</div>
      <div class="flex items-center gap-2 mb-2">
        <WebhookIcon size={18} class={cn(
          tone === 'accent' && 'text-accent',
          tone === 'warning' && 'text-warning',
          tone === 'danger' && 'text-danger',
        )} />
        <Badge tone={tone} solid>{label}</Badge>
      </div>
      <div class="text-[0.6875rem] text-fg-muted mt-1">
        Esperado: <code class="font-mono bg-surface-3 px-1.5 py-0.5 rounded text-[0.625rem] break-all">{health.webhook.expected}</code>
      </div>
      {health.webhook.current && health.webhook.current !== health.webhook.expected && (
        <div class="text-[0.6875rem] text-danger mt-1">
          Atual: <code class="font-mono bg-danger/10 px-1.5 py-0.5 rounded text-[0.625rem] break-all">{health.webhook.current}</code>
        </div>
      )}
      {health.webhook.events.length > 0 && (
        <div class="text-[0.6875rem] text-fg-subtle mt-1">Eventos: {health.webhook.events.join(', ')}</div>
      )}
    </Card>
  )
}

function MonitorCard({ lastCheck, onForce, forcing }: { lastCheck: string; onForce: () => void; forcing: boolean }) {
  return (
    <Card>
      <div class="text-[0.625rem] uppercase tracking-wider text-fg-subtle font-medium mb-2">Monitor</div>
      <div class="flex items-center gap-2 mb-2">
        <Activity size={18} class="text-fg-muted" />
        <span class="text-sm text-fg font-medium">Última verificação</span>
      </div>
      <div class="text-xs text-fg">{new Date(lastCheck).toLocaleString('pt-BR')}</div>
      <div class="text-[0.6875rem] text-fg-subtle mt-1">Verifica automaticamente a cada 2 minutos</div>
      <Button variant="secondary" size="sm" class="mt-3" onClick={onForce} disabled={forcing}>
        <RefreshCw size={12} class={forcing ? 'animate-spin' : ''} />
        {forcing ? 'Verificando…' : 'Verificar agora'}
      </Button>
    </Card>
  )
}

// ─── Versão & Upgrade ───────────────────────────────────────

function VersionCard({ onOpenUpgrade, onOpenLogs }: { onOpenUpgrade: (tag: string) => void; onOpenLogs: () => void }) {
  const { user } = useAuth()
  const isSuperadmin = user?.role === 'SUPERADMIN'
  const { data, isLoading } = useEvolutionVersion({ activePolling: false })
  const hasActive = !!data?.activeJob
  // Re-roda com polling 5s quando job ativo (re-monta o hook abaixo)
  const live = useEvolutionVersion({ activePolling: hasActive })
  const v = live.data ?? data

  if (isLoading || !v) {
    return <Skeleton class="h-32 w-full" />
  }

  const installed = v.installed || 'desconhecida'
  const latest = v.latest || '—'
  const active = v.activeJob
  const last = v.lastJob

  let statusBadge: preact.JSX.Element
  if (v.upToDate) {
    statusBadge = <Badge tone="accent" solid><CheckCircle2 size={10} class="inline mr-0.5" /> Atualizado</Badge>
  } else if (v.installed && v.latest) {
    statusBadge = <Badge tone="warning" solid><AlertTriangle size={10} class="inline mr-0.5" /> Atualização disponível</Badge>
  } else {
    statusBadge = <Badge tone="neutral">Verificando…</Badge>
  }

  const canUpgrade = !v.upToDate && v.latest && v.canUpgrade && isSuperadmin && !active

  return (
    <Card>
      <CardHeader>
        <CardTitle>Versão da Evolution API</CardTitle>
        {statusBadge}
      </CardHeader>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 items-start">
        <div>
          <div class="text-[0.625rem] uppercase tracking-wider text-fg-subtle font-medium mb-1">Instalada</div>
          <div class="text-base font-semibold text-fg tabular-nums">v{installed}</div>
        </div>
        <div>
          <div class="text-[0.625rem] uppercase tracking-wider text-fg-subtle font-medium mb-1">Última disponível</div>
          <div class="text-base font-semibold text-fg tabular-nums">{latest}</div>
          {v.latestPublished && (
            <div class="text-[0.6875rem] text-fg-subtle">publicada {new Date(v.latestPublished).toLocaleDateString('pt-BR')}</div>
          )}
        </div>
        <div class="flex flex-col items-start gap-2">
          {canUpgrade && (
            <Button variant="primary" size="sm" onClick={() => onOpenUpgrade(v.latest!)}>
              Atualizar para {v.latest}
            </Button>
          )}
          {v.releaseUrl && (
            <a
              href={v.releaseUrl}
              target="_blank"
              rel="noreferrer"
              class="text-xs text-accent hover:underline inline-flex items-center gap-1"
            >
              Ver changelog no GitHub <ExternalLink size={10} />
            </a>
          )}
        </div>
      </div>

      {!v.upToDate && !isSuperadmin && (
        <div class="mt-3 text-[0.6875rem] text-fg-muted">Apenas SUPERADMIN pode atualizar.</div>
      )}
      {v.guardReason && (
        <div class="mt-3 text-[0.6875rem] text-warning">
          {v.guardReason}{v.waitSeconds ? ` (aguarde ${Math.ceil(v.waitSeconds / 60)}min)` : ''}
        </div>
      )}

      {active && (
        <div class="mt-3 rounded-md border border-accent/30 bg-accent/10 p-3 text-xs">
          <div class="font-medium text-fg flex items-center gap-1.5 mb-1">
            <RefreshCw size={12} class="text-accent animate-spin" /> Upgrade em andamento: {active.targetTag}
          </div>
          <div class="text-[0.6875rem] text-fg-muted">
            Iniciado por {active.triggeredBy.email} em {new Date(active.startedAt).toLocaleTimeString('pt-BR')}
          </div>
          <Button variant="secondary" size="sm" class="mt-2" onClick={onOpenLogs}>
            Ver logs em tempo real
          </Button>
        </div>
      )}

      {!active && last && (
        <div class={cn(
          'mt-3 rounded-md border p-3 text-xs',
          last.status === 'success' && 'border-success/40 bg-success/5',
          last.status === 'rolled_back' && 'border-warning/40 bg-warning/10',
          (last.status === 'failed') && 'border-danger/40 bg-danger/10',
        )}>
          <div class={cn(
            'font-medium flex items-center gap-1.5',
            last.status === 'success' && 'text-success',
            last.status === 'rolled_back' && 'text-warning',
            last.status === 'failed' && 'text-danger',
          )}>
            {last.status === 'success' && <CheckCircle2 size={12} />}
            {last.status === 'rolled_back' && <AlertTriangle size={12} />}
            {last.status === 'failed' && <AlertCircle size={12} />}
            Último upgrade: {last.targetTag} — {last.status === 'success' ? 'sucesso' : last.status === 'rolled_back' ? 'rollback automático' : 'falha'}
          </div>
          <div class="text-[0.6875rem] text-fg-muted mt-1">
            {new Date(last.startedAt).toLocaleString('pt-BR')} — por {last.triggeredBy.email}
          </div>
          {last.error && <div class="text-[0.6875rem] text-danger mt-1">{last.error}</div>}
          <Button variant="secondary" size="sm" class="mt-2" onClick={onOpenLogs}>Ver logs</Button>
        </div>
      )}
    </Card>
  )
}

// ─── Instâncias ─────────────────────────────────────────────

function InstancesTable({ instances }: { instances: EvolutionInstance[] }) {
  return (
    <Card class="p-0 overflow-hidden">
      <div class="px-4 py-3 border-b border-border">
        <div class="text-sm font-semibold text-fg">Instâncias</div>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-surface-3 text-[0.625rem] uppercase tracking-wider text-fg-subtle">
            <tr>
              <th class="px-3 py-2 text-left font-medium">Nome</th>
              <th class="px-3 py-2 text-left font-medium">ID</th>
              <th class="px-3 py-2 text-left font-medium">Conexão</th>
              <th class="px-3 py-2 text-left font-medium">Telefone</th>
              <th class="px-3 py-2 text-left font-medium">Perfil</th>
              <th class="px-3 py-2 text-left font-medium">Chatbot</th>
              <th class="px-3 py-2 text-center font-medium">DB Ativa</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border">
            {instances.length === 0 && (
              <tr>
                <td colspan={7} class="px-3 py-6 text-center text-fg-muted">Nenhuma instância cadastrada</td>
              </tr>
            )}
            {instances.map((inst) => {
              const isOpen = inst.connectionState === 'open'
              const isClosed = inst.connectionState === 'close' || inst.connectionState === 'disconnected'
              const tone: 'accent' | 'danger' | 'warning' = isOpen ? 'accent' : isClosed ? 'danger' : 'warning'
              const label =
                isOpen ? 'Conectado' :
                inst.connectionState === 'close' ? 'Desconectado' :
                inst.connectionState === 'not_found' ? 'Não encontrada' :
                inst.connectionState
              return (
                <tr key={inst.instanceName}>
                  <td class="px-3 py-2 font-medium text-fg">{inst.name}</td>
                  <td class="px-3 py-2 font-mono text-[0.6875rem] text-fg-muted">{inst.instanceName}</td>
                  <td class="px-3 py-2"><Badge tone={tone} solid>{label}</Badge></td>
                  <td class="px-3 py-2 text-fg">{inst.phone ? `+${inst.phone}` : <span class="text-fg-subtle">—</span>}</td>
                  <td class="px-3 py-2 text-fg">{inst.profileName || <span class="text-fg-subtle">—</span>}</td>
                  <td class="px-3 py-2">
                    {inst.chatbotLinked ? <span class="text-accent font-medium">{inst.chatbotName}</span> : <span class="text-fg-subtle">Nenhum</span>}
                  </td>
                  <td class="px-3 py-2 text-center">
                    {inst.dbActive ? <span class="text-accent font-medium">Sim</span> : <span class="text-fg-subtle">Não</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

// ─── Issues ─────────────────────────────────────────────────

function IssuesCard({ issues }: { issues: EvolutionIssue[] }) {
  const fix = useFixEvolutionIssue()

  function handleFix(action: string) {
    fix.mutate(action, {
      onSuccess: (resp) => {
        toast(resp?.message || 'Correção aplicada', resp?.ok === false ? 'danger' : 'success')
      },
      onError: (e: unknown) => toast((e as Error).message || 'Erro ao corrigir', 'danger'),
    })
  }

  return (
    <Card class="p-0 overflow-hidden">
      <div class="px-4 py-3 border-b border-border">
        <div class="text-sm font-semibold text-fg">Problemas detectados ({issues.length})</div>
      </div>
      <div class="p-3 space-y-2">
        {issues.map((issue, idx) => {
          const sevTone =
            issue.severity === 'critical' ? 'danger' :
            issue.severity === 'warning' ? 'warning' : 'info'
          const Icon = issue.severity === 'critical' ? AlertCircle : issue.severity === 'warning' ? AlertTriangle : Info
          return (
            <div
              key={idx}
              class={cn(
                'flex items-center gap-3 p-3 rounded-md border',
                sevTone === 'danger' && 'border-danger/30 bg-danger/10',
                sevTone === 'warning' && 'border-warning/30 bg-warning/10',
                sevTone === 'info' && 'border-info/30 bg-info/10',
              )}
            >
              <Icon size={16} class={cn(
                'shrink-0',
                sevTone === 'danger' && 'text-danger',
                sevTone === 'warning' && 'text-warning',
                sevTone === 'info' && 'text-info',
              )} />
              <div class="flex-1 text-sm text-fg">{issue.message}</div>
              {issue.action && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleFix(issue.action!)}
                  disabled={fix.isPending}
                  aria-label="Corrigir problema"
                >
                  Corrigir
                </Button>
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}

// ─── Modal de upgrade ──────────────────────────────────────

function UpgradeConfirmModal({
  targetTag, onClose, onStarted,
}: {
  targetTag: string
  onClose: () => void
  onStarted: () => void
}) {
  const start = useStartEvolutionUpgrade()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  function handleConfirm() {
    setError(null)
    if (!password) {
      setError('Senha obrigatória')
      return
    }
    start.mutate({ targetTag, password }, {
      onSuccess: () => {
        toast('Upgrade iniciado — aguardando…', 'success')
        onStarted()
      },
      onError: (e: unknown) => {
        setError((e as Error).message || 'Erro ao iniciar upgrade')
      },
    })
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Atualizar Evolution API para ${targetTag}`}
      size="md"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={start.isPending}>Cancelar</Button>
          <Button variant="danger" size="sm" onClick={handleConfirm} disabled={start.isPending}>
            {start.isPending ? 'Iniciando…' : 'Atualizar agora'}
          </Button>
        </>
      }
    >
      <div class="space-y-3">
        <div class="rounded-md border border-warning/30 bg-warning/10 p-3 flex items-start gap-2">
          <AlertTriangle size={16} class="mt-0.5 shrink-0 text-warning" />
          <div class="text-xs text-fg space-y-1">
            <div class="font-medium text-fg">Atenção — operação delicada</div>
            <ul class="list-disc pl-4 space-y-0.5 text-fg-muted">
              <li>O container será recriado com a nova versão. Pode levar 30-90s.</li>
              <li>Backup automático do PostgreSQL + volume será feito antes.</li>
              <li>Em caso de falha no health check, rollback automático para a versão atual.</li>
              <li>Em casos raros, pode precisar reescanear o QR code depois.</li>
              <li>Rate limit: 1 upgrade por hora.</li>
            </ul>
          </div>
        </div>
        <div>
          <label class="text-xs font-medium text-fg-muted block mb-1">
            Confirme sua senha de SUPERADMIN
          </label>
          <Input
            type="password"
            value={password}
            onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
            placeholder="Senha atual"
          />
          {error && <div class="text-[0.6875rem] text-danger mt-1">{error}</div>}
        </div>
      </div>
    </Modal>
  )
}

// ─── Modal de logs ─────────────────────────────────────────

function UpgradeLogsModal({ onClose }: { onClose: () => void }) {
  const { data } = useEvolutionUpgradeStatus(true)
  const [accumulated, setAccumulated] = useState<string[]>([])
  const [logsSince, setLogsSince] = useState(0)

  useEffect(() => {
    if (!data?.job?.logs?.length) return
    setAccumulated((prev) => [...prev, ...(data.job?.logs ?? [])])
    setLogsSince(data.job?.logCount ?? logsSince + (data.job?.logs?.length ?? 0))
    // Re-fetch from `since` cursor (re-renders trigger refetch via key change)
    // The polling already handles fetching, but our `since` query param isn't currently
    // sent — the backend returns full logs since 0. Acceptable for short upgrades.
  }, [data?.job?.logCount])

  // Reset on open
  useEffect(() => {
    setAccumulated([])
    setLogsSince(0)
  }, [])

  const job = data?.job
  const statusLabel: Record<string, string> = {
    running: '⏳ Executando…',
    success: '✓ Sucesso',
    failed: '✗ Falhou',
    rolled_back: '⚠ Rollback executado',
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Logs do upgrade"
      size="xl"
      footer={<Button variant="secondary" size="sm" onClick={onClose}>Fechar</Button>}
    >
      {job ? (
        <>
          <div class="text-xs text-fg-muted mb-2 flex items-center gap-2 flex-wrap">
            <span class="font-medium text-fg">{statusLabel[job.status] ?? job.status}</span>
            {job.backupPath && (
              <span class="text-[0.6875rem]">
                · Backup: <code class="font-mono bg-surface-3 px-1.5 py-0.5 rounded text-[0.625rem]">{job.backupPath}</code>
              </span>
            )}
          </div>
          <pre class="bg-zinc-900 text-zinc-100 p-3 rounded-md text-[0.6875rem] font-mono leading-relaxed max-h-96 overflow-auto whitespace-pre-wrap break-all m-0">
            {(job.logs ?? accumulated).join('\n') || '(aguardando logs…)'}
          </pre>
        </>
      ) : (
        <div class="text-sm text-fg-muted text-center py-6">Nenhum upgrade em andamento.</div>
      )}
    </Modal>
  )
}
