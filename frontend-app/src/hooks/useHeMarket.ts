import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

/**
 * Métricas de um recorte de mercado.
 *
 * `occupancy`, `idleSeats` e `applicantsPerSeat` vêm do backend calculados
 * SOMENTE sobre cursos presenciais e são `null` para EAD — cursos a distância
 * não declaram vaga por polo. A UI mostra "—" nesses casos em vez de inventar
 * um número.
 */
export interface HeRatios {
  seats: number
  seatsPres: number
  applicants: number
  entrants: number
  entrantsPres: number
  enrolled: number
  graduates: number
  dropped: number
  locked: number
  fies: number
  prouni: number
  institutions: number
  courses: number
  occupancy: number | null
  idleSeats: number | null
  applicantsPerSeat: number | null
  conversion: number | null
  dropoutRate: number | null
  lockedRate: number | null
}

export interface HeOverview {
  year: number | null
  /** Anos já ingeridos, do mais recente para o mais antigo. */
  years: number[]
  empty?: boolean
  total: HeRatios
  presential: HeRatios
  ead: HeRatios
  private: HeRatios
  /** Mesmo recorte no ano anterior; null quando esse ano não foi ingerido. */
  previous: { year: number; total: HeRatios; presential: HeRatios } | null
}

export interface HeFilters {
  year?: number | undefined
  uf: string
  cityCode: number | null
}

function qs(f: HeFilters, extra: Record<string, string> = {}) {
  const p = new URLSearchParams(extra)
  if (f.year) p.set('year', String(f.year))
  if (f.uf) p.set('uf', f.uf)
  if (f.cityCode) p.set('cityCode', String(f.cityCode))
  return p.toString()
}

export function useHeOverview(f: HeFilters) {
  return useQuery({
    queryKey: ['he-overview', f],
    queryFn: () => api.get<HeOverview>(`/admin/he-market/overview?${qs(f)}`),
    staleTime: 60_000,
  })
}

export function useHeAreas(f: HeFilters) {
  return useQuery({
    queryKey: ['he-areas', f],
    queryFn: () => api.get<{ areas: (HeRatios & { cineArea: string })[] }>(`/admin/he-market/areas?${qs(f)}`),
    staleTime: 60_000,
  })
}

export function useHeCities(f: HeFilters) {
  return useQuery({
    queryKey: ['he-cities', f.uf, f.year],
    queryFn: () => api.get<{ cities: (HeRatios & { cityCode: number; city: string; uf: string })[] }>(
      `/admin/he-market/cities?${qs({ ...f, cityCode: null })}`,
    ),
    staleTime: 60_000,
  })
}

export function useHeUfs(year?: number) {
  return useQuery({
    queryKey: ['he-ufs', year],
    queryFn: () => api.get<{ ufs: { uf: string; enrolled: number }[] }>(`/admin/he-market/ufs${year ? `?year=${year}` : ''}`),
    staleTime: 5 * 60_000,
  })
}

export function useHeCompetitors(f: HeFilters, cineArea: string) {
  return useQuery({
    queryKey: ['he-competitors', f, cineArea],
    queryFn: () => api.get<{ competitors: (HeRatios & {
      coIes: number; name: string; acronym: string | null; isPrivate: boolean; isMine: boolean; share: number | null
    })[] }>(`/admin/he-market/competitors?${qs(f, cineArea ? { cineArea } : {})}`),
    staleTime: 60_000,
  })
}

export function useHeOpportunities(f: HeFilters) {
  return useQuery({
    queryKey: ['he-opportunities', f],
    queryFn: () => api.get<{ opportunities: (HeRatios & { cineArea: string; modality: number })[] }>(
      `/admin/he-market/opportunities?${qs(f)}`,
    ),
    staleTime: 60_000,
  })
}

export interface HeMyIes {
  year: number | null
  myIes: number[]
  configured: boolean
  summary: HeRatios | null
  benchmark: HeRatios | null
  courses: (HeRatios & { name: string; cineArea: string | null; city: string | null; modality: number; degree: number })[]
}

export function useHeMyIes(year?: number) {
  return useQuery({
    queryKey: ['he-my-ies', year],
    queryFn: () => api.get<HeMyIes>(`/admin/he-market/my-ies${year ? `?year=${year}` : ''}`),
    staleTime: 60_000,
  })
}

export interface HeInstitution {
  id: number
  coIes: number
  name: string
  acronym: string | null
  uf: string | null
  city: string | null
  isPrivate: boolean
}

export function useHeSettings() {
  return useQuery({
    queryKey: ['he-settings'],
    queryFn: () => api.get<{ myIes: number[]; institutions: HeInstitution[] }>('/admin/he-market/settings'),
    staleTime: 60_000,
  })
}

export function useHeInstitutionSearch(q: string, uf: string) {
  return useQuery({
    queryKey: ['he-institutions', q, uf],
    queryFn: () => api.get<{ institutions: HeInstitution[] }>(
      `/admin/he-market/institutions?q=${encodeURIComponent(q)}&uf=${encodeURIComponent(uf)}`,
    ),
    enabled: q.trim().length >= 2,
    staleTime: 60_000,
  })
}

export function useSaveHeSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (myIes: number[]) => api.put<{ myIes: number[] }>('/admin/he-market/settings', { myIes }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['he-settings'] })
      qc.invalidateQueries({ queryKey: ['he-my-ies'] })
      qc.invalidateQueries({ queryKey: ['he-competitors'] })
    },
  })
}

export function useHeImports() {
  return useQuery({
    queryKey: ['he-imports'],
    queryFn: () => api.get<{
      imports: { id: number; year: number; status: string; courses: number; institutions: number; marketRows: number; error: string | null }[]
      available: number[]
      sourceError: string | null
    }>('/admin/he-market/imports'),
    refetchInterval: (q) => (q.state.data?.imports?.some((i) => i.status === 'running') ? 20_000 : false),
    staleTime: 30_000,
  })
}

export function useRunHeImport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { year?: number; force?: boolean }) =>
      api.post<{ started: boolean }>('/admin/he-market/imports', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['he-imports'] }),
  })
}
