import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export type InstallationStatus = 'online' | 'stopped' | 'errored' | 'not_found'

export interface Installation {
  subdomain: string
  domain: string
  dir: string
  appPort: number
  mysqlPort: number
  mysqlContainer: string
  pm2Name: string
  status: InstallationStatus
  health: boolean
  ssl: boolean
  createdAt?: string | undefined
}

export interface ProvisionInput {
  subdomain: string
  adminEmail?: string | undefined
  adminPass?: string | undefined
  evolutionUrl?: string | undefined
  evolutionKey?: string | undefined
  evolutionInstance?: string | undefined
  whatsappNumber?: string | undefined
  resendKey?: string | undefined
  anthropicKey?: string | undefined
  openaiKey?: string | undefined
}

export interface ProvisionCredentials {
  subdomain: string
  domain: string
  url: string
  adminEmail: string
  adminPass: string
  appPort: number
  mysqlPort: number
  mysqlContainer: string
  mysqlUser: string
  mysqlPass: string
  mysqlRootPass: string
  pm2Name: string
  dir: string
  ssl: boolean
  health: boolean
  dnsOk: boolean
  serverIp: string
}

export interface ProvisionResult {
  success: true
  credentials: ProvisionCredentials
  logs: string[]
}

export type InstAction = 'start' | 'stop' | 'restart'

const KEY = ['installations'] as const

export function useInstallations() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => api.get<{ installations: Installation[] }>('/admin/installations'),
    staleTime: 15_000,
    /** lista pode mudar por uso externo (PM2/docker), refetch ao focar */
    refetchOnWindowFocus: true,
  })
}

export function useProvisionInstallation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: ProvisionInput) =>
      api.post<ProvisionResult>('/admin/installations', input),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: KEY }) },
  })
}

export function useInstallationAction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ subdomain, action }: { subdomain: string; action: InstAction }) =>
      api.post<{ ok: boolean; output: string }>(`/admin/installations/${subdomain}/${action}`, {}),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: KEY }) },
  })
}

export function useGenerateSSL() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (subdomain: string) =>
      api.post<{ ok: boolean; output?: string; error?: string; detail?: string }>(
        `/admin/installations/${subdomain}/ssl`,
        {},
      ),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: KEY }) },
  })
}

export function useInstallationLogs(subdomain: string | null) {
  return useQuery({
    queryKey: ['installation-logs', subdomain],
    queryFn: () => api.get<{ logs: string }>(`/admin/installations/${subdomain}/logs`),
    enabled: subdomain !== null,
    staleTime: 0,
  })
}

export function useDeleteInstallation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (subdomain: string) =>
      api.delete<{ ok: true; steps: string[] }>(`/admin/installations/${subdomain}`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: KEY }) },
  })
}
