import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface ModuleUsage {
  total: number
  items: { label: string; count: number }[]
}

export interface SystemModule {
  id: string
  name: string
  icon: string
  category: string
  description: string
  pages: string[]
  routePrefixes: string[]
  actions: string[]
  core?: boolean
  defaultEnabled?: boolean
  enabled: boolean
  usage: ModuleUsage
}

export function useModules() {
  return useQuery({
    queryKey: ['modules'],
    queryFn: () => api.get<{ modules: SystemModule[] }>('/admin/modules'),
    staleTime: 60_000,
  })
}

export function useModuleUsage(moduleId: string | null) {
  return useQuery({
    queryKey: ['module-usage', moduleId],
    queryFn: () => api.get<{ moduleId: string; usage: ModuleUsage }>(`/admin/modules/${moduleId}/usage`),
    enabled: moduleId !== null,
    staleTime: 15_000,
  })
}

export function useToggleModule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, enabled, confirmName }: { id: string; enabled: boolean; confirmName?: string | undefined }) =>
      api.post<{ ok: true; moduleId: string; enabled: boolean }>(
        `/admin/modules/${id}/toggle`,
        { enabled, confirmName },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['modules'] })
      void qc.invalidateQueries({ queryKey: ['my-permissions'] })
    },
  })
}
