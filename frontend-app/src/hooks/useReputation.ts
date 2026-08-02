import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface ReputationCompany {
  id: number
  slug: string
  name: string
  segment: string | null
  area: string | null
  lastPeriod: string | null
  complaints: number
  unansweredRate: number | null
  unresolvedRate: number | null
  ratedShare: number | null
  avgScore: number | null
  avgResponseDays: number | null
  topProblem: string | null
  topUf: string | null
  complaintsDelta: number | null
  opportunityScore: number
  status: 'new' | 'prospecting' | 'converted' | 'ignored'
  leadId: number | null
  notes: string | null
}

export interface ReputationSnapshot {
  id: number
  period: string
  complaints: number
  unanswered: number
  rated: number
  unresolved: number
  avgScore: number | null
  avgResponseDays: number | null
  breakdown: {
    problems?: Record<string, number>
    ufs?: Record<string, number>
    channels?: Record<string, number>
  } | null
}

export interface ReputationImport {
  id: number
  period: string
  status: 'running' | 'done' | 'failed'
  rows: number
  companies: number
  durationMs: number | null
  fileName: string | null
  error: string | null
  createdAt: string
}

export interface CompanyFilters {
  q: string
  segment: string
  status: string
  minComplaints: number
  orderBy: string
  limit: number
  offset: number
}

export function useReputationCompanies(f: CompanyFilters) {
  const qs = new URLSearchParams({
    q: f.q,
    segment: f.segment,
    status: f.status,
    minComplaints: String(f.minComplaints),
    orderBy: f.orderBy,
    limit: String(f.limit),
    offset: String(f.offset),
  })
  return useQuery({
    queryKey: ['reputation-companies', f],
    queryFn: () => api.get<{ companies: ReputationCompany[]; total: number }>(`/admin/reputation/companies?${qs}`),
    staleTime: 30_000,
  })
}

export function useReputationCompany(id: number | null) {
  return useQuery({
    queryKey: ['reputation-company', id],
    queryFn: () => api.get<{ company: ReputationCompany & { snapshots: ReputationSnapshot[] } }>(`/admin/reputation/companies/${id}`),
    enabled: id !== null,
  })
}

export function useReputationSegments() {
  return useQuery({
    queryKey: ['reputation-segments'],
    queryFn: () => api.get<{ segments: { segment: string; companies: number; complaints: number; avgOpportunity: number }[] }>('/admin/reputation/segments'),
    staleTime: 5 * 60_000,
  })
}

export function useReputationImports() {
  return useQuery({
    queryKey: ['reputation-imports'],
    queryFn: () => api.get<{
      imports: ReputationImport[]
      available: { period: string; publishedAt: string }[]
      sourceError: string | null
    }>('/admin/reputation/imports'),
    staleTime: 60_000,
  })
}

export function useUpdateReputationCompany() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number; status?: string; notes?: string; leadId?: number | null }) =>
      api.patch(`/admin/reputation/companies/${id}`, body),
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ['reputation-companies'] })
      qc.invalidateQueries({ queryKey: ['reputation-company', v.id] })
    },
  })
}

// ── Detector de stack (sites dos prospects) ──────────────────────────────────

export interface WebStackScan {
  id: number
  domain: string
  finalUrl: string | null
  httpStatus: number | null
  title: string | null
  tlsValid: boolean
  error: string | null
  hasMetaPixel: boolean
  hasGoogleAds: boolean
  hasGa4: boolean
  hasGtm: boolean
  hasOtherPixel: boolean
  hasChat: boolean
  hasCrm: boolean
  cms: string | null
  detected: { name: string; group: string }[] | null
  gapScore: number
  scannedAt: string
}

export function useWebStackScans(q: string, onlyGaps: boolean) {
  return useQuery({
    queryKey: ['web-stack-scans', q, onlyGaps],
    queryFn: () => api.get<{ scans: WebStackScan[]; total: number }>(
      `/admin/reputation/stack?q=${encodeURIComponent(q)}&onlyGaps=${onlyGaps}&limit=200`,
    ),
    staleTime: 30_000,
  })
}

export function useRunStackScan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { domains?: string[]; fromLeads?: boolean; limit?: number }) =>
      api.post<{ scanned: number; gaps: number; blocked: number }>('/admin/reputation/stack', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['web-stack-scans'] }),
  })
}

// ── Radar de concorrentes (agências) ─────────────────────────────────────────

export interface CompetitorReview {
  id: number
  stars: number
  text: string
  publishedAt: string | null
  ownerReplied: boolean
}

export interface CompetitorAgency {
  id: number
  name: string
  categories: string | null
  address: string | null
  city: string | null
  uf: string | null
  website: string | null
  domain: string | null
  phone: string | null
  rating: number | null
  reviewsCount: number | null
  negativeWithText: number
  status: string
  reviews: CompetitorReview[]
  stack: WebStackScan | null
}

export function useCompetitors(city: string, onlyWithNegatives: boolean) {
  return useQuery({
    queryKey: ['competitors', city, onlyWithNegatives],
    queryFn: () => api.get<{ agencies: CompetitorAgency[]; total: number }>(
      `/admin/reputation/competitors?city=${encodeURIComponent(city)}&onlyWithNegatives=${onlyWithNegatives}&limit=200`,
    ),
    staleTime: 30_000,
  })
}

export function useApifyCredits() {
  return useQuery({
    queryKey: ['apify-credits'],
    queryFn: () => api.get<{ credits: { username: string; plan: string | null; monthlyCreditsUsd: number | null; currentSpendUsd: number | null; remainingUsd: number | null } }>('/admin/reputation/competitors/credits'),
    staleTime: 60_000,
    retry: false,
  })
}

export function useDiscoverCompetitors() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { location: string; term?: string; maxPlaces?: number; maxReviews?: number }) =>
      api.post<{ result: { found: number; created: number; negativeReviews: number; actualUsd: number | null; creditsRemainingUsd: number | null } }>('/admin/reputation/competitors', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['competitors'] })
      qc.invalidateQueries({ queryKey: ['apify-credits'] })
      qc.invalidateQueries({ queryKey: ['web-stack-scans'] })
    },
  })
}

// ── Radar educacional (Censo Escolar / INEP) ─────────────────────────────────

export interface School {
  id: number
  inepCode: string
  name: string
  uf: string | null
  city: string | null
  district: string | null
  address: string | null
  phone: string | null
  privateCategory: number | null
  lastYear: number | null
  classes: number
  classesInf: number
  classesFund: number
  classesMed: number
  classesDelta: number | null
  hasInternet: boolean
  hasInternetAdmin: boolean
  hasInternetLearn: boolean
  opportunityScore: number
  status: string
}

export interface SchoolFilters {
  q: string
  uf: string
  city: string
  minClasses: number
  onlyDropping: boolean
  onlyWithPhone: boolean
}

export function useSchools(f: SchoolFilters) {
  const qs = new URLSearchParams({
    q: f.q, uf: f.uf, city: f.city,
    minClasses: String(f.minClasses),
    onlyDropping: String(f.onlyDropping),
    onlyWithPhone: String(f.onlyWithPhone),
    limit: '200',
  })
  return useQuery({
    queryKey: ['schools', f],
    queryFn: () => api.get<{ schools: School[]; total: number }>(`/admin/reputation/schools?${qs}`),
    staleTime: 30_000,
  })
}

export function useSchoolUfs() {
  return useQuery({
    queryKey: ['school-ufs'],
    queryFn: () => api.get<{ ufs: { uf: string; schools: number }[] }>('/admin/reputation/schools/ufs'),
    staleTime: 5 * 60_000,
  })
}

export function useSchoolImports() {
  return useQuery({
    queryKey: ['school-imports'],
    queryFn: () => api.get<{
      imports: { id: number; year: number; status: string; schools: number; rowsRead: number; error: string | null }[]
      available: number[]
      sourceError: string | null
    }>('/admin/reputation/schools/imports'),
    // A ingestão roda em background e leva minutos — atualiza sozinho.
    refetchInterval: (q) => (q.state.data?.imports?.some((i) => i.status === 'running') ? 15_000 : false),
    staleTime: 10_000,
  })
}

export function useRunSchoolImport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { year?: number; force?: boolean }) =>
      api.post<{ started: boolean; year: number | string }>('/admin/reputation/schools/imports', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['school-imports'] }),
  })
}

/** Dispara a ingestão de um período (ou do mais recente que faltar). */
export function useRunReputationImport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { period?: string; force?: boolean }) =>
      api.post<{ result?: unknown; results?: unknown[] }>('/admin/reputation/imports', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reputation-imports'] })
      qc.invalidateQueries({ queryKey: ['reputation-companies'] })
      qc.invalidateQueries({ queryKey: ['reputation-segments'] })
    },
  })
}
