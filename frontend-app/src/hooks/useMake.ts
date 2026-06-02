import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

/** Resposta de /api/admin/make/app-definition (JSON consolidado para colar no Make Developer Hub) */
export interface MakeAppDefinition {
  app: unknown
  base: unknown
  connection: unknown
  triggers: Record<string, unknown>
  actions: Record<string, unknown>
  searches: Record<string, unknown>
}

export function useMakeAppDefinition(enabled: boolean) {
  return useQuery({
    queryKey: ['make-app-definition'],
    queryFn: () => api.get<MakeAppDefinition>('/admin/make/app-definition'),
    enabled,
    staleTime: 5 * 60_000,
  })
}
