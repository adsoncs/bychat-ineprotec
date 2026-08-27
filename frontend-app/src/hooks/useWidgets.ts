import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { findWidget } from '@/components/widgets/WidgetCatalog'

export type WidgetType =
  | 'kpi'
  | 'bar'
  | 'hbar'
  | 'line'
  | 'area'
  | 'pie'
  | 'donut'
  | 'polar'
  | 'radar'
  | 'gauge'
  | 'stat_grid'
  | 'hbar_list'
  | 'funnel'
  | 'table'
  | 'progress'
  // legacy aliases (mantidos para dashboards já salvos)
  | 'chart'
  | 'list'
  | 'breakdown'

export type WidgetSize = 'sm' | 'md' | 'lg' | 'xl'

export interface Widget {
  id: string
  type: WidgetType
  metric: string
  title: string
  /** Tamanho no padrão do legado (sm=1/4, md=1/3, lg=1/2, xl=full) */
  size?: WidgetSize
  config?: Record<string, unknown>
}

const VALID_TYPES: WidgetType[] = [
  'kpi', 'bar', 'hbar', 'line', 'area', 'pie', 'donut', 'polar',
  'radar', 'gauge', 'stat_grid', 'hbar_list', 'funnel', 'table', 'progress',
  'chart', 'list', 'breakdown',
]

const VALID_SIZES: WidgetSize[] = ['sm', 'md', 'lg', 'xl']

// Conversão legacy span (1/2/3/4) → size (sm/md/lg/xl)
const SPAN_TO_SIZE: Record<number, WidgetSize> = {
  1: 'sm', 2: 'md', 3: 'lg', 4: 'xl',
}

function normalizeWidget(raw: unknown): Widget | null {
  if (!raw || typeof raw !== 'object') return null
  const w = raw as Record<string, unknown>
  const metric = typeof w.metric === 'string' ? (w.metric) : ''
  if (!metric) return null

  const fromCatalog = findWidget(metric)
  const savedType = w.type
  const type: WidgetType =
    (typeof savedType === 'string' && (VALID_TYPES as string[]).includes(savedType)
      ? (savedType as WidgetType)
      : (fromCatalog?.defaultType ?? 'kpi'))

  let size: WidgetSize
  const rawSize = w.size
  if (typeof rawSize === 'string' && (VALID_SIZES as string[]).includes(rawSize)) {
    size = rawSize as WidgetSize
  } else if (typeof w.span === 'number' && SPAN_TO_SIZE[w.span]) {
    size = SPAN_TO_SIZE[w.span]!
  } else {
    size = fromCatalog?.defaultSize ?? 'md'
  }

  return {
    id: typeof w.id === 'string' ? (w.id) : `w_${metric}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    metric,
    title: typeof w.title === 'string' ? (w.title) : (fromCatalog?.title ?? metric),
    size,
    ...(w.config && typeof w.config === 'object' ? { config: w.config as Record<string, unknown> } : {}),
  }
}

function normalizeWidgets(input: unknown): Widget[] {
  if (!Array.isArray(input)) return []
  return input.map(normalizeWidget).filter((w): w is Widget => w !== null)
}

export interface UserDashboard {
  id: number
  userId: number
  name: string
  type: string
  widgets: Widget[]
  isDefault: boolean
  isSystem: boolean
  position: number
  createdAt: string
  updatedAt: string
}

export interface DashboardInput {
  name: string
  type?: string | undefined
  widgets?: Widget[] | undefined
  isDefault?: boolean | undefined
}

export function useUserDashboards(type = 'dashboard') {
  return useQuery({
    queryKey: ['user-dashboards', type],
    queryFn: async () => {
      const res = await api.get<{ dashboards: UserDashboard[] }>(`/admin/user-dashboards?type=${type}`)
      // Dashboards salvos pelo legado podem ter widgets com types antigos
      // (gauge/donut/bar/funnel) e size sm/md/lg. Normalizamos para o esquema
      // novo (kpi/chart/list/breakdown + span 1-4) usando o catálogo como verdade.
      return {
        ...res,
        dashboards: res.dashboards.map((d) => ({
          ...d,
          widgets: normalizeWidgets(d.widgets),
        })),
      }
    },
    staleTime: 60_000,
  })
}

export function useCreateDashboard() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: DashboardInput) => api.post<UserDashboard>('/admin/user-dashboards', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['user-dashboards'] }),
  })
}

export function useUpdateDashboard() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: { id: number } & Partial<DashboardInput>) =>
      api.put<UserDashboard>(`/admin/user-dashboards/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['user-dashboards'] }),
  })
}

export function useDeleteDashboard() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/admin/user-dashboards/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['user-dashboards'] }),
  })
}

export interface WidgetDataParams {
  metric: string
  config?: Record<string, unknown> | undefined
}

export function useWidgetData(params: WidgetDataParams, enabled = true) {
  return useQuery({
    queryKey: ['widget-data', params],
    queryFn: () => api.post<unknown>('/admin/widget-data', params),
    staleTime: 60_000,
    // Desligado quando quem renderiza já tem o número em mãos — é o caso da
    // Tela Inicial nativa, que recebe tudo por uma rota só e não pode chamar
    // /admin/widget-data (gateado pelo módulo 'dashboard', que o papel dela
    // muitas vezes não tem).
    enabled,
  })
}
