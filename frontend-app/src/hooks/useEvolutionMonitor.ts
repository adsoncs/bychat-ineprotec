import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

// Espelha a interface do backend (services/evolutionMonitor.ts)
export interface EvolutionInstance {
  name: string
  instanceName: string
  dbActive: boolean
  connectionState: string
  phone: string | null
  profileName: string | null
  chatbotLinked: boolean
  chatbotName: string | null
  error: string | null
}

export interface EvolutionIssue {
  severity: 'critical' | 'warning' | 'info'
  message: string
  action: string | null
}

export interface EvolutionHealth {
  lastCheck: string
  api: {
    status: 'online' | 'offline' | 'error'
    url: string
    responseTimeMs: number
    version: string | null
    error: string | null
  }
  instances: EvolutionInstance[]
  webhook: {
    status: 'ok' | 'misconfigured' | 'missing' | 'error'
    expected: string
    current: string | null
    events: string[]
    error: string | null
  }
  issues: EvolutionIssue[]
}

export interface EvolutionUpgradeJob {
  id: string
  startedAt: string
  finishedAt: string | null
  targetTag: string
  status: 'running' | 'success' | 'failed' | 'rolled_back'
  triggeredBy: { userId: number; email: string }
  backupPath: string | null
  error: string | null
  logCount: number
  logs?: string[]
}

export interface EvolutionVersion {
  installed: string | null
  latest: string | null
  upToDate: boolean
  latestPublished: string | null
  releaseUrl: string | null
  canUpgrade: boolean
  waitSeconds: number
  guardReason: string | null
  activeJob: EvolutionUpgradeJob | null
  lastJob: EvolutionUpgradeJob | null
}

export interface EvolutionUpgradeStatus {
  active: boolean
  job: EvolutionUpgradeJob | null
}

export function useEvolutionHealth() {
  return useQuery({
    queryKey: ['evolution', 'health'],
    queryFn: () => api.get<EvolutionHealth>('/admin/evolution-monitor'),
    refetchInterval: 30_000,
  })
}

export function useEvolutionVersion(opts?: { activePolling?: boolean }) {
  return useQuery({
    queryKey: ['evolution', 'version'],
    queryFn: () => api.get<EvolutionVersion>('/admin/evolution/version'),
    refetchInterval: opts?.activePolling ? 5_000 : 60_000,
  })
}

/** Modal de logs em tempo real — polling 2s enquanto job ativo ou modal aberto. */
export function useEvolutionUpgradeStatus(enabled: boolean) {
  return useQuery({
    queryKey: ['evolution', 'upgrade-status'],
    queryFn: () => api.get<EvolutionUpgradeStatus>('/admin/evolution/upgrade/status'),
    enabled,
    refetchInterval: enabled ? 2_000 : false,
  })
}

export function useForceEvolutionCheck() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<EvolutionHealth>('/admin/evolution-monitor/check'),
    onSuccess: (data) => {
      qc.setQueryData(['evolution', 'health'], data)
    },
  })
}

export function useFixEvolutionIssue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (action: string) => api.post<{ ok: boolean; message?: string }>('/admin/evolution-monitor/fix', { action }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['evolution', 'health'] })
    },
  })
}

export function useStartEvolutionUpgrade() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { targetTag: string; password: string }) =>
      api.post<{ ok: boolean; job: EvolutionUpgradeJob }>('/admin/evolution/upgrade', vars),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['evolution', 'version'] })
      qc.invalidateQueries({ queryKey: ['evolution', 'upgrade-status'] })
    },
  })
}
