import { useEffect, useState } from 'preact/hooks'
import {
  useSecurityStats,
  useSecurityEvents,
  useSecurityBlocks,
  useSecurityUsers,
  useSecurityMe,
  useBlockIp,
  useUnblockIp,
  useLockUser,
  useUnlockUser,
  useResetUserAttempts,
  type IpBlock,
  type SecurityEvent,
  type SecurityEventsFilters,
  type SecurityUser,
} from '@/hooks/useSecurity'
import { Skeleton } from '@/components/ui/Skeleton'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { toast } from '@/lib/toast'
import { TwoFactorSection } from './TwoFactorSection'

const SEV_COLOR: Record<string, string> = {
  low: 'text-success',
  medium: 'text-warning',
  high: 'text-warning',
  critical: 'text-danger',
}
const SEV_LABEL: Record<string, string> = {
  low: 'Baixo', medium: 'Médio', high: 'Alto', critical: 'Crítico',
}
const TYPE_LABEL: Record<string, string> = {
  login_fail: 'Login Falhado',
  login_fail_repeated: 'Senha esquecida?',
  login_email_rate_limited: 'Limite por e-mail',
  user_auto_locked: 'Conta travada',
  login_success: 'Login OK',
  brute_force: 'Força Bruta',
  rate_limit: 'Rate Limit',
  suspicious_ua: 'UA Suspeito',
  path_traversal: 'Path Traversal',
  sql_injection: 'SQL Injection',
  xss_attempt: 'XSS',
  blocked_request: 'Req. Bloqueada',
  manual_block: 'Bloqueio Manual',
  manual_unblock: 'Desbloqueio',
}
const REASON_LABEL: Record<string, string> = {
  brute_force: 'Força Bruta',
  rate_limit: 'Rate Limit',
  suspicious: 'Suspeito',
  manual: 'Manual',
  login_abuse: 'Abuso de Login',
}

function formatTimeAgo(when: string | Date): string {
  const date = when instanceof Date ? when : new Date(when)
  const diff = date.getTime() - Date.now()
  if (diff <= 0) return 'Expirado'
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function formatDateTime(s: string): string {
  return new Date(s).toLocaleString('pt-BR')
}

export function SecuritySettings() {
  return (
    <div class="space-y-6">
      <TwoFactorSection />
      <KpiSection />
      <TopIpsAndManualBlock />
      <ActiveBlocksSection />
      <EventsSection />
      <UsersSection />
    </div>
  )
}

// ─── KPIs ───────────────────────────────────────
function KpiSection() {
  const { data: stats, isLoading } = useSecurityStats()
  if (isLoading) return <Skeleton class="h-24 w-full" />
  return (
    <section class="grid gap-4 grid-cols-2 lg:grid-cols-4">
      <Kpi label="Eventos (24h)" value={stats?.totalEvents24h ?? 0} tone="default" />
      <Kpi label="Críticos (24h)" value={stats?.criticalEvents24h ?? 0} tone="danger" />
      <Kpi label="Logins Falhados" value={stats?.loginFails24h ?? 0} tone="warning" />
      <Kpi label="IPs Bloqueados" value={stats?.activeBlocks ?? 0} tone="violet" />
    </section>
  )
}

function Kpi({ label, value, tone }: { label: string; value: number | string; tone: 'default' | 'danger' | 'warning' | 'violet' }) {
  const colorClass = tone === 'danger' ? 'text-danger'
    : tone === 'warning' ? 'text-warning'
    : tone === 'violet' ? 'text-[#9334e6]'
    : 'text-fg'
  return (
    <div class="rounded-xl border border-border bg-surface-2 p-5">
      <div class="text-[0.6875rem] uppercase tracking-wider text-fg-muted mb-1.5">{label}</div>
      <div class={`text-2xl font-bold tabular-nums ${colorClass}`}>{value}</div>
    </div>
  )
}

// ─── Top IPs + Bloquear IP Manualmente ──────────
function TopIpsAndManualBlock() {
  const { data: stats } = useSecurityStats()
  const { data: me } = useSecurityMe()
  const block = useBlockIp()
  const topIps = stats?.topIps ?? []
  const myIp = me?.ip

  const [quickIp, setQuickIp] = useState<string | null>(null)
  const [ip, setIp] = useState('')
  const [reason, setReason] = useState('manual')
  const [duration, setDuration] = useState('1440')
  const [details, setDetails] = useState('')

  const isSelfIp = !!myIp && ip.trim() === myIp

  function submit() {
    if (!ip.trim()) { toast('Informe o IP para bloquear', 'danger'); return }
    if (isSelfIp) { toast('Você não pode bloquear o próprio IP.', 'danger'); return }
    block.mutate({
      ip: ip.trim(),
      reason,
      duration: duration ? Number(duration) : undefined,
      details: details || undefined,
    }, {
      onSuccess: () => {
        toast('IP bloqueado', 'success')
        setIp(''); setDetails(''); setDuration('1440'); setReason('manual')
      },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <section class="grid gap-4 grid-cols-1 lg:grid-cols-2">
      {/* Top IPs */}
      <div class="rounded-xl border border-border bg-surface-2 p-5">
        <div class="text-sm font-semibold text-fg mb-3">Top IPs Suspeitos (24h)</div>
        {topIps.length === 0 ? (
          <div class="text-sm text-fg-muted">Nenhum IP registrado</div>
        ) : (
          <div class="flex flex-col gap-1.5">
            {topIps.map((t) => {
              const isSelf = t.ip === myIp
              return (
                <div key={t.ip} class="flex items-center justify-between px-3 py-2 rounded-lg bg-surface">
                  <div class="flex items-center gap-2">
                    <code class="text-sm text-fg font-mono">{t.ip}</code>
                    {isSelf && <span class="text-[0.625rem] uppercase tracking-wider text-accent font-semibold px-1.5 py-0.5 rounded bg-accent/10">você</span>}
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="text-xs text-fg-muted">{t.count} eventos</span>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => setQuickIp(t.ip)}
                      disabled={isSelf}
                      title={isSelf ? 'Você não pode bloquear o próprio IP' : undefined}
                    >
                      Bloquear
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Bloquear IP Manualmente */}
      <div class="rounded-xl border border-border bg-surface-2 p-5">
        <div class="text-sm font-semibold text-fg mb-3">Bloquear IP Manualmente</div>
        <div class="flex flex-col gap-2.5">
          <input
            type="text"
            value={ip}
            onInput={(e) => setIp((e.target as HTMLInputElement).value)}
            placeholder={myIp ? `Ex: 192.168.1.100  (seu IP: ${myIp})` : 'Ex: 192.168.1.100'}
            class={`h-10 px-3 rounded-lg bg-surface border text-sm text-fg focus:outline-none ${isSelfIp ? 'border-danger focus:border-danger' : 'border-border focus:border-accent'}`}
          />
          {isSelfIp && (
            <div class="text-xs text-danger -mt-1">Esse é o seu IP — você não pode bloqueá-lo.</div>
          )}
          <select
            value={reason}
            onChange={(e) => setReason((e.target as HTMLSelectElement).value)}
            class="h-10 px-3 rounded-lg bg-surface border border-border text-sm text-fg focus:outline-none focus:border-accent"
          >
            <option value="manual">Bloqueio Manual</option>
            <option value="suspicious">Atividade Suspeita</option>
            <option value="brute_force">Força Bruta</option>
            <option value="rate_limit">Rate Limit</option>
          </select>
          <select
            value={duration}
            onChange={(e) => setDuration((e.target as HTMLSelectElement).value)}
            class="h-10 px-3 rounded-lg bg-surface border border-border text-sm text-fg focus:outline-none focus:border-accent"
          >
            <option value="30">30 minutos</option>
            <option value="60">1 hora</option>
            <option value="360">6 horas</option>
            <option value="1440">24 horas</option>
            <option value="10080">7 dias</option>
            <option value="">Permanente</option>
          </select>
          <textarea
            value={details}
            onInput={(e) => setDetails((e.target as HTMLTextAreaElement).value)}
            placeholder="Motivo (opcional)"
            rows={2}
            class="px-3 py-2 rounded-lg bg-surface border border-border text-sm text-fg focus:outline-none focus:border-accent resize-y"
          />
          <button
            type="button"
            onClick={submit}
            disabled={block.isPending || isSelfIp}
            class="h-10 rounded-lg bg-accent text-fg-on-brand text-sm font-semibold cursor-pointer disabled:opacity-60"
          >
            {block.isPending ? 'Bloqueando…' : 'Bloquear IP'}
          </button>
        </div>
      </div>

      {quickIp && (
        <ConfirmDialog
          open
          onOpenChange={(o) => { if (!o) setQuickIp(null) }}
          title={`Bloquear ${quickIp}?`}
          description={`O IP ${quickIp} será bloqueado por 24 horas (motivo: suspeito).`}
          confirmLabel="Bloquear"
          loading={block.isPending}
          onConfirm={() => block.mutate({
            ip: quickIp,
            reason: 'suspicious',
            duration: 1440,
            details: 'Bloqueio rápido via painel de segurança',
          }, {
            onSuccess: () => { toast('IP bloqueado', 'success'); setQuickIp(null) },
            onError: (e: unknown) => toast((e as Error).message, 'danger'),
          })}
        />
      )}
    </section>
  )
}

// ─── IPs Bloqueados Ativos ──────────────────────
function ActiveBlocksSection() {
  const { data, isLoading } = useSecurityBlocks()
  const { data: me } = useSecurityMe()
  const unblock = useUnblockIp()
  const [target, setTarget] = useState<IpBlock | null>(null)
  const blocks = data?.blocks ?? []
  const myIp = me?.ip

  return (
    <section class="rounded-xl border border-border bg-surface-2 p-5">
      <div class="flex items-center justify-between mb-3">
        <div class="text-sm font-semibold text-fg">IPs Bloqueados Ativos</div>
        <span class="text-xs text-fg-muted">{data?.total ?? 0} bloqueios</span>
      </div>
      {isLoading && <Skeleton class="h-24 w-full" />}
      {!isLoading && blocks.length === 0 && (
        <div class="text-sm text-fg-muted text-center py-5">Nenhum IP bloqueado no momento</div>
      )}
      {!isLoading && blocks.length > 0 && (
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b-2 border-border text-left text-fg-muted text-xs">
                <th class="px-3 py-2.5 font-semibold">IP</th>
                <th class="px-3 py-2.5 font-semibold">Motivo</th>
                <th class="px-3 py-2.5 font-semibold">Tipo</th>
                <th class="px-3 py-2.5 font-semibold">Expira em</th>
                <th class="px-3 py-2.5 font-semibold">Criado por</th>
                <th class="px-3 py-2.5 font-semibold">Data</th>
                <th class="px-3 py-2.5 font-semibold">Ação</th>
              </tr>
            </thead>
            <tbody>
              {blocks.map((b) => {
                const expires = b.expiresAt ? new Date(b.expiresAt) : null
                const expired = expires && expires < new Date()
                return (
                  <tr key={b.id} class="border-b border-border">
                    <td class="px-3 py-2.5">
                      <div class="flex items-center gap-2">
                        <code class="px-2 py-0.5 rounded bg-surface text-fg text-xs">{b.ip}</code>
                        {b.ip === myIp && <span class="text-[0.625rem] uppercase tracking-wider text-accent font-semibold px-1.5 py-0.5 rounded bg-accent/10">você</span>}
                      </div>
                    </td>
                    <td class="px-3 py-2.5 text-fg">{REASON_LABEL[b.reason] ?? b.reason}</td>
                    <td class="px-3 py-2.5">
                      <span class={`inline-block px-2 py-0.5 rounded-full text-[0.6875rem] font-semibold ${b.auto ? 'bg-warning/15 text-warning' : 'bg-accent/15 text-accent'}`}>
                        {b.auto ? 'Auto' : 'Manual'}
                      </span>
                    </td>
                    <td class="px-3 py-2.5">
                      {!expires ? <span class="text-danger font-semibold">Permanente</span>
                        : expired ? <span class="text-success">Expirado</span>
                        : <span class="text-fg">{formatTimeAgo(expires)}</span>}
                    </td>
                    <td class="px-3 py-2.5 text-xs text-fg-muted">{b.createdBy ?? 'Sistema'}</td>
                    <td class="px-3 py-2.5 text-xs text-fg-muted">{formatDateTime(b.createdAt)}</td>
                    <td class="px-3 py-2.5">
                      <button
                        type="button"
                        onClick={() => setTarget(b)}
                        class="px-3 py-1 rounded bg-success text-white text-[0.6875rem] font-semibold cursor-pointer"
                      >
                        Desbloquear
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {target && (
        <ConfirmDialog
          open
          onOpenChange={(o) => { if (!o) setTarget(null) }}
          title={`Desbloquear ${target.ip}?`}
          description="O IP voltará a poder acessar o sistema imediatamente."
          confirmLabel="Desbloquear"
          loading={unblock.isPending}
          onConfirm={() => unblock.mutate(target.id, {
            onSuccess: () => { toast('IP desbloqueado', 'success'); setTarget(null) },
            onError: (e: unknown) => toast((e as Error).message, 'danger'),
          })}
        />
      )}
    </section>
  )
}

// ─── Log de Eventos ─────────────────────────────
function EventsSection() {
  const [filters, setFilters] = useState<SecurityEventsFilters>({ limit: 50 })
  const [accumulated, setAccumulated] = useState<SecurityEvent[] | null>(null)
  const { data, isLoading, refetch } = useSecurityEvents(filters)
  const loadMore = useSecurityEvents({ ...filters, offset: accumulated?.length ?? 50 })

  // Reset accumulated quando filtros mudam
  useEffect(() => { setAccumulated(null) }, [filters.type, filters.severity])

  const events = accumulated ?? data?.events ?? []
  const total = data?.total ?? 0
  const canLoadMore = total > events.length

  function patch(p: Partial<SecurityEventsFilters>) {
    setFilters((f) => ({ ...f, ...p }))
  }

  function handleLoadMore() {
    void loadMore.refetch().then((r) => {
      const newEvents = r.data?.events
      if (newEvents && newEvents.length > 0) {
        setAccumulated((prev) => [...(prev ?? data?.events ?? []), ...newEvents])
      }
    })
  }

  return (
    <section class="rounded-xl border border-border bg-surface-2 p-5">
      <div class="flex items-center justify-between mb-3.5 flex-wrap gap-2.5">
        <div class="text-sm font-semibold text-fg">Log de Eventos de Segurança</div>
        <div class="flex gap-2 flex-wrap">
          <select
            value={filters.type ?? ''}
            onChange={(e) => patch({ type: (e.target as HTMLSelectElement).value || undefined })}
            class="h-8 px-2.5 rounded-md bg-surface border border-border text-xs text-fg focus:outline-none focus:border-accent"
          >
            <option value="">Todos os tipos</option>
            <option value="login_fail">Login Falhado</option>
            <option value="login_success">Login OK</option>
            <option value="brute_force">Força Bruta</option>
            <option value="rate_limit">Rate Limit</option>
            <option value="path_traversal">Path Traversal</option>
            <option value="sql_injection">SQL Injection</option>
            <option value="xss_attempt">XSS</option>
            <option value="blocked_request">Req. Bloqueada</option>
          </select>
          <select
            value={filters.severity ?? ''}
            onChange={(e) => patch({ severity: (e.target as HTMLSelectElement).value || undefined })}
            class="h-8 px-2.5 rounded-md bg-surface border border-border text-xs text-fg focus:outline-none focus:border-accent"
          >
            <option value="">Todas severidades</option>
            <option value="critical">Crítico</option>
            <option value="high">Alto</option>
            <option value="medium">Médio</option>
            <option value="low">Baixo</option>
          </select>
          <button
            type="button"
            onClick={() => { setAccumulated(null); void refetch() }}
            class="h-8 px-3 rounded-md bg-surface border border-border text-xs text-fg cursor-pointer"
          >
            Atualizar
          </button>
        </div>
      </div>

      {isLoading && <Skeleton class="h-32 w-full" />}
      {!isLoading && events.length === 0 && (
        <div class="text-sm text-fg-muted text-center py-5">Nenhum evento encontrado</div>
      )}
      {!isLoading && events.length > 0 && (
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b-2 border-border text-left text-fg-muted text-xs">
                <th class="px-2.5 py-2 font-semibold">Data</th>
                <th class="px-2.5 py-2 font-semibold">Severidade</th>
                <th class="px-2.5 py-2 font-semibold">Tipo</th>
                <th class="px-2.5 py-2 font-semibold">IP</th>
                <th class="px-2.5 py-2 font-semibold">Email</th>
                <th class="px-2.5 py-2 font-semibold">Detalhes</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} class="border-b border-border">
                  <td class="px-2.5 py-2 text-xs text-fg-muted whitespace-nowrap">{formatDateTime(e.createdAt)}</td>
                  <td class="px-2.5 py-2">
                    <span class={`inline-block px-2 py-0.5 rounded-full text-[0.6875rem] font-semibold bg-surface ${SEV_COLOR[e.severity] ?? 'text-fg-muted'}`}>
                      {SEV_LABEL[e.severity] ?? e.severity}
                    </span>
                  </td>
                  <td class="px-2.5 py-2 font-medium text-fg">{TYPE_LABEL[e.type] ?? e.type}</td>
                  <td class="px-2.5 py-2">
                    {e.ip ? <code class="px-1.5 py-0.5 rounded bg-surface text-xs text-fg">{e.ip}</code> : <span class="text-fg-subtle">-</span>}
                  </td>
                  <td class="px-2.5 py-2 text-xs text-fg-muted">{e.email ?? '-'}</td>
                  <td class="px-2.5 py-2 text-xs text-fg-muted max-w-[18.75rem] overflow-hidden text-ellipsis whitespace-nowrap" title={e.details ?? undefined}>
                    {e.details ?? '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canLoadMore && (
        <div class="text-center pt-3">
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={loadMore.isFetching}
            class="px-5 py-2 rounded-lg bg-surface border border-border text-sm text-fg cursor-pointer disabled:opacity-60"
          >
            {loadMore.isFetching ? 'Carregando…' : `Carregar mais (${total} total)`}
          </button>
        </div>
      )}
    </section>
  )
}

// ─── Usuários do Sistema ────────────────────────
function UsersSection() {
  const { data, isLoading } = useSecurityUsers()
  const [locking, setLocking] = useState<SecurityUser | null>(null)
  const [unlocking, setUnlocking] = useState<SecurityUser | null>(null)
  const lock = useLockUser()
  const unlock = useUnlockUser()
  const reset = useResetUserAttempts()
  const users = data?.users ?? []

  function handleReset(u: SecurityUser) {
    reset.mutate(u.id, {
      onSuccess: () => toast('Tentativas zeradas', 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <section class="rounded-xl border border-border bg-surface-2 p-5">
      <div class="text-sm font-semibold text-fg mb-4">Usuários do sistema</div>
      {isLoading && <Skeleton class="h-32 w-full" />}
      {!isLoading && users.length > 0 && (
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-border text-fg-muted text-[0.6875rem]">
                <th class="text-left px-3 py-2 font-medium">Usuário</th>
                <th class="text-left px-3 py-2 font-medium">Role</th>
                <th class="text-center px-3 py-2 font-medium">Tentativas</th>
                <th class="text-left px-3 py-2 font-medium">Último login</th>
                <th class="text-center px-3 py-2 font-medium">Status</th>
                <th class="text-right px-3 py-2 font-medium">Ação</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isLocked = !!u.lockedAt
                const isInactive = !u.active && !isLocked
                const lastLogin = u.lastLoginAt
                  ? `${new Date(u.lastLoginAt).toLocaleDateString('pt-BR')} ${new Date(u.lastLoginAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
                  : '–'
                return (
                  <tr key={u.id} class="border-b border-border last:border-0">
                    <td class="px-3 py-2.5">
                      <div class="text-fg font-medium">{u.name ?? u.email}</div>
                      {u.name && <div class="text-xs text-fg-muted">{u.email}</div>}
                      {isLocked && u.lockReason && (
                        <div class="text-[0.6875rem] text-danger mt-0.5">{u.lockReason}</div>
                      )}
                    </td>
                    <td class="px-3 py-2.5 text-xs text-fg-muted">{u.role}</td>
                    <td class={`px-3 py-2.5 text-center font-semibold ${u.loginAttempts >= 5 ? 'text-danger' : 'text-fg-muted'}`}>
                      {u.loginAttempts ?? 0}
                    </td>
                    <td class="px-3 py-2.5 text-xs text-fg-muted">{lastLogin}</td>
                    <td class="px-3 py-2.5 text-center">
                      {isLocked ? (
                        <span class="inline-block px-2.5 py-1 rounded-full text-[0.625rem] font-semibold bg-danger/15 text-danger">Bloqueado</span>
                      ) : isInactive ? (
                        <span class="inline-block px-2.5 py-1 rounded-full text-[0.625rem] font-semibold bg-surface text-fg-muted">Inativo</span>
                      ) : (
                        <span class="inline-block px-2.5 py-1 rounded-full text-[0.625rem] font-semibold bg-success/15 text-success">Ativo</span>
                      )}
                    </td>
                    <td class="px-3 py-2.5 text-right whitespace-nowrap">
                      {(isLocked || isInactive) ? (
                        <button
                          type="button"
                          onClick={() => setUnlocking(u)}
                          class="px-3 py-1 rounded border border-success bg-success/10 text-success text-[0.6875rem] font-medium cursor-pointer"
                        >
                          Desbloquear
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setLocking(u)}
                          class="px-3 py-1 rounded border border-danger bg-danger/10 text-danger text-[0.6875rem] font-medium cursor-pointer"
                        >
                          Bloquear
                        </button>
                      )}
                      {(u.loginAttempts ?? 0) > 0 && !isLocked && (
                        <button
                          type="button"
                          onClick={() => handleReset(u)}
                          disabled={reset.isPending}
                          class="ml-1 px-3 py-1 rounded border border-border bg-surface text-fg-muted text-[0.6875rem] cursor-pointer disabled:opacity-60"
                          title="Zerar tentativas"
                        >
                          Resetar
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {locking && (
        <LockUserModal
          user={locking}
          onClose={() => setLocking(null)}
          onConfirm={(reason) => lock.mutate({ id: locking.id, reason }, {
            onSuccess: () => { toast(`${locking.email} bloqueado`, 'success'); setLocking(null) },
            onError: (e: unknown) => toast((e as Error).message, 'danger'),
          })}
          loading={lock.isPending}
        />
      )}
      {unlocking && (
        <ConfirmDialog
          open
          onOpenChange={(o) => { if (!o) setUnlocking(null) }}
          title={`Desbloquear ${unlocking.email}?`}
          description="O usuário voltará a poder fazer login imediatamente."
          confirmLabel="Desbloquear"
          loading={unlock.isPending}
          onConfirm={() => unlock.mutate(unlocking.id, {
            onSuccess: () => { toast('Usuário desbloqueado', 'success'); setUnlocking(null) },
            onError: (e: unknown) => toast((e as Error).message, 'danger'),
          })}
        />
      )}
    </section>
  )
}

function LockUserModal({
  user, onClose, onConfirm, loading,
}: {
  user: SecurityUser
  onClose: () => void
  onConfirm: (reason: string) => void
  loading: boolean
}) {
  const [reason, setReason] = useState('')
  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Bloquear ${user.name ?? user.email}`}
      description="O usuário não conseguirá fazer login até ser desbloqueado."
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button variant="danger" size="sm" onClick={() => onConfirm(reason)} disabled={loading}>
            {loading ? 'Bloqueando…' : 'Bloquear'}
          </Button>
        </>
      }
    >
      <Input
        label="Motivo (opcional)"
        value={reason}
        onInput={(e) => setReason((e.target as HTMLInputElement).value)}
        placeholder="Ex.: Comportamento suspeito"
      />
    </Modal>
  )
}
