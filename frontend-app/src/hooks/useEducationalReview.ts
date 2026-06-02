import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

// ─────────────────────────────────────────────────────────────────────────────
// DocReview

export type DocReviewStatus = 'pending' | 'rejected' | 'complete' | 'all'

export interface DocReviewItem {
  registrationId: number
  candidateCode: string
  candidate: { name: string; email: string; whatsapp: string }
  leadId: number | null
  portal: { id: number; nome: string; slug: string } | null
  course: string
  selectionProcess: { id: number; nome: string } | null
  completion: 'pending' | 'rejected' | 'complete'
  requiredTotal: number
  approvedCount: number
  pendingCount: number
  rejectedCount: number
  missingCount: number
  aiSummary: string[]
  lastUploadAt: string | null
  oldestPendingAt: string | null
  registrationStatus: string
  createdAt: string
  siblingCount: number
}

export interface DocReviewKpi { pending: number; rejected: number; complete: number }

export interface DocReviewFilters {
  status?: DocReviewStatus | undefined
  portalId?: number | undefined
  q?: string | undefined
  sort?: 'oldest' | 'newest' | undefined
  limit?: number | undefined
  offset?: number | undefined
}

function buildQs(f: object): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(f as Record<string, unknown>)) {
    if (v === undefined || v === null || v === '') continue
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      p.set(k, String(v))
    }
  }
  const qs = p.toString()
  return qs ? `?${qs}` : ''
}

export function useDocReviews(filters: DocReviewFilters = {}) {
  return useQuery({
    queryKey: ['edu-doc-reviews', filters],
    queryFn: () => api.get<{ items: DocReviewItem[]; total: number; kpi: DocReviewKpi }>(
      `/admin/enrollment-document-reviews${buildQs(filters)}`,
    ),
    staleTime: 30_000,
  })
}

export interface DocReviewDocument {
  id: number
  label: string | null
  typeCode: string | null
  fileUrl: string
  fileName: string
  mimeType: string | null
  sizeBytes: number | null
  status: 'pending' | 'approved' | 'rejected'
  uploadedAt: string
  reviewedAt: string | null
  reviewedBy: number | null
  reviewerName: string | null
  reviewNote: string | null
  aiStatus: 'pending' | 'processing' | 'done' | 'failed' | null
  aiSuggestion: 'approve' | 'reject' | 'review' | null
  aiConfidence: number | null
  aiAnalysis: unknown
  type: { id: number; code: string; name: string; category: string | null; aiAnalysisTemplate: string | null } | null
}

export interface DocReviewSlot {
  ordem: number
  required: boolean
  helpText: string | null
  documentType: { id: number; code: string; name: string; category: string | null; aiAnalysisTemplate: string | null }
  latestDoc: DocReviewDocument | null
}

export interface DocReviewDetail {
  registration: {
    id: number
    candidateCode: string
    status: string
    createdAt: string
    formData: Record<string, unknown> | null
  }
  lead: { id: number; nome: string | null; email: string | null; whatsapp: string | null; status: string | null } | null
  portal: { id: number; nome: string; slug: string; funnelId: number | null; docsCompleteStageKey: string | null } | null
  processRegistration: {
    id: number
    selectionProcess: {
      id: number; nome: string; codigo: string | null
      entryMode?: { code: string; name: string; icon: string | null } | null
    } | null
    offering: {
      nome: string | null
      turno: string | null
      course: { nome: string } | null
      campuses: { campus: { nome: string; cidade: string | null } }[]
    } | null
  } | null
  completion: 'pending' | 'rejected' | 'complete'
  slots: DocReviewSlot[]
  extras: DocReviewDocument[]
  autoAdvance:
    | { enabled: false }
    | { enabled: true; stageKey: string; stageName: string; funnelName: string | null }
}

export function useDocReviewDetail(registrationId: number | null) {
  return useQuery({
    queryKey: ['edu-doc-review-detail', registrationId],
    queryFn: () => api.get<DocReviewDetail>(`/admin/enrollment-registrations/${registrationId}/document-review`),
    enabled: registrationId !== null,
    staleTime: 15_000,
  })
}

export function useBulkApproveAi(registrationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { minConfidence?: number; dryRun?: boolean }) =>
      api.post<{ ok: true; approved?: number; wouldApprove?: number; dryRun?: boolean; items: { id: number; name: string; confidence: number | null }[] }>(
        `/admin/enrollment-registrations/${registrationId}/bulk-approve-ai`,
        input,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['edu-doc-reviews'] })
      void qc.invalidateQueries({ queryKey: ['edu-doc-review-detail', registrationId] })
    },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// DocReview por documento (modo Document) — fila plana

export type DocItemStatus = 'pending' | 'approved' | 'rejected' | 'all'
export type AiSuggestionFilter = 'approve' | 'reject' | 'review' | 'all'

export interface DocItem {
  id: number
  label: string | null
  typeCode: string | null
  fileUrl: string
  fileName: string
  mimeType: string | null
  sizeBytes: number | null
  status: 'pending' | 'approved' | 'rejected'
  reviewNote: string | null
  reviewedAt: string | null
  reviewedBy: number | null
  aiStatus: 'pending' | 'processing' | 'done' | 'failed' | null
  aiSuggestion: 'approve' | 'reject' | 'review' | null
  aiConfidence: number | null
  aiAnalysis: unknown
  uploadedAt: string
  type: { code: string; name: string; category: string | null; aiAnalysisTemplate: string | null } | null
  registration: {
    id: number
    candidateCode: string
    status: string
    portal: { id: number; nome: string; slug: string } | null
    lead: { id: number; nome: string | null; email: string | null; whatsapp: string | null } | null
    processRegistration: {
      selectionProcess: { id: number; nome: string; slug: string } | null
      offering: { nome: string; course: { nome: string } | null } | null
    } | null
  } | null
}

export interface DocItemKpi { pending: number; approved: number; rejected: number }

export interface DocItemFilters {
  status?: DocItemStatus | undefined
  aiSuggestion?: AiSuggestionFilter | undefined
  portalId?: number | undefined
  q?: string | undefined
  sort?: 'oldest' | 'newest' | undefined
  limit?: number | undefined
  offset?: number | undefined
}

export function useDocItems(filters: DocItemFilters = {}) {
  return useQuery({
    queryKey: ['edu-doc-items', filters],
    queryFn: () => api.get<{ items: DocItem[]; total: number; kpi: DocItemKpi }>(
      `/admin/enrollment-documents${buildQs(filters)}`,
    ),
    staleTime: 30_000,
  })
}

export function useReviewDocItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status, reviewNote }: { id: number; status: 'approved' | 'rejected'; reviewNote?: string | null }) =>
      api.put<{ ok: true; document: { id: number; status: string } }>(
        `/admin/enrollment-documents/${id}/review`,
        { status, reviewNote: reviewNote ?? null },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['edu-doc-items'] })
      void qc.invalidateQueries({ queryKey: ['edu-doc-reviews'] })
      void qc.invalidateQueries({ queryKey: ['edu-doc-review-detail'] })
    },
  })
}

export function useReanalyzeDoc() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id }: { id: number }) =>
      api.post<{ ok: true; queued: true }>(`/admin/enrollment-documents/${id}/reanalyze`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['edu-doc-items'] })
    },
  })
}

export function useRenotifyDoc() {
  return useMutation({
    mutationFn: ({ id }: { id: number }) =>
      api.post<{ ok: true; reemitted: string }>(`/admin/enrollment-documents/${id}/renotify`, {}),
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// ENEM imports

export type EnemStatus = 'pending' | 'approved' | 'rejected' | 'all'

export interface EnemImport {
  id: number
  nome: string | null
  inscricao: string | null
  ano: number | null
  treineiro: boolean
  cienciasHumanas: number | null
  cienciasNatureza: number | null
  linguagens: number | null
  matematica: number | null
  redacao: number | null
  mediaSimples: number | null
  cutoffScore: number | null
  passed: boolean | null
  source: string | null
  aiConfidence: number | null
  nomeBateComForm: boolean | null
  inscricaoBateComForm: boolean | null
  anoBateComForm: boolean | null
  validatedAt: string | null
  validatedBy: number | null
  validationNote: string | null
  createdAt: string
  registration: {
    id: number
    candidateCode: string
    portal: { id: number; nome: string; slug: string } | null
    lead: { id: number; nome: string | null; email: string | null; whatsapp: string | null } | null
    processRegistration: {
      selectionProcess?: { id: number; nome: string; notaCorte?: number | null; entryMode?: { code: string; name: string } | null } | null
      offering: { nome: string; course: { nome: string } | null; notaCorte: number | null } | null
    } | null
  } | null
}

/** Detalhe completo (com fileUrl do documento e processo seletivo). */
export interface EnemImportDetail extends EnemImport {
  document?: { id: number; fileUrl: string; fileName: string; mimeType: string | null; sizeBytes: number | null } | null
}

export function useEnemImport(id: number | null) {
  return useQuery({
    queryKey: ['edu-enem-import', id],
    queryFn: () => api.get<{ item: EnemImportDetail }>(`/admin/enem-imports/${id}`),
    enabled: id !== null,
    staleTime: 15_000,
  })
}

export interface EnemKpi { pending: number; approved: number; rejected: number }

export interface EnemFilters {
  status?: EnemStatus | undefined
  portalId?: number | undefined
  q?: string | undefined
  sort?: 'oldest' | 'newest' | undefined
  limit?: number | undefined
  offset?: number | undefined
}

export function useEnemImports(filters: EnemFilters = {}) {
  return useQuery({
    queryKey: ['edu-enem-imports', filters],
    queryFn: () => api.get<{ items: EnemImport[]; total: number; kpi: EnemKpi }>(
      `/admin/enem-imports${buildQs(filters)}`,
    ),
    staleTime: 30_000,
  })
}

export function useValidateEnem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: {
      id: number
      acceptAi?: boolean | undefined
      scores?: { cienciasHumanas?: number | undefined; cienciasNatureza?: number | undefined; linguagens?: number | undefined; matematica?: number | undefined; redacao?: number | undefined } | undefined
      passed?: boolean | undefined
      validationNote?: string | undefined
    }) => api.post<{ ok: true; import: EnemImport }>(`/admin/enem-imports/${id}/validate`, input),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['edu-enem-imports'] }) },
  })
}

export function useRejectEnem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      api.post<{ ok: true }>(`/admin/enem-imports/${id}/reject`, { reason }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['edu-enem-imports'] }) },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Presencial exams

export type PresencialStatus = 'pending' | 'approved' | 'rejected' | 'scheduled' | 'absent' | 'all'

export interface PresencialExam {
  id: number
  scheduledAt: string | null
  location: string | null
  room: string | null
  seatNumber: string | null
  attendanceStatus: 'scheduled' | 'present' | 'absent' | null
  score: number | null
  maxScore: number | null
  examNote: string | null
  verdict: 'pending' | 'approved' | 'rejected'
  verdictBy: number | null
  verdictAt: string | null
  verdictReason: string | null
  passed: boolean | null
  cutoffApplied: number | null
  createdAt: string
  registration: {
    id: number
    candidateCode: string
    portal: { id: number; nome: string } | null
    lead: { id: number; nome: string | null; email: string | null; whatsapp: string | null } | null
    processRegistration: {
      selectionProcess: { id: number; nome: string; presencialCutoff: number | null } | null
      offering: { nome: string; presencialCutoff: number | null; course: { nome: string } | null } | null
    } | null
  } | null
}

export interface PresencialKpi {
  pending: number; approved: number; rejected: number; scheduled: number; absent: number
}

export interface PresencialFilters {
  status?: PresencialStatus | undefined
  portalId?: number | undefined
  q?: string | undefined
  sort?: 'oldest' | 'newest' | undefined
}

export function usePresencialExams(filters: PresencialFilters = {}) {
  return useQuery({
    queryKey: ['edu-presencial', filters],
    queryFn: () => api.get<{ items: PresencialExam[]; total: number; kpi: PresencialKpi }>(
      `/admin/presencial-exams${buildQs(filters)}`,
    ),
    staleTime: 30_000,
  })
}

export interface PresencialExamInput {
  scheduledAt?: string | null | undefined
  location?: string | null | undefined
  room?: string | null | undefined
  seatNumber?: string | null | undefined
  score?: number | null | undefined
  maxScore?: number | null | undefined
  examNote?: string | null | undefined
  attendanceStatus?: 'scheduled' | 'present' | 'absent' | undefined
  verdict?: 'pending' | 'approved' | 'rejected' | undefined
  verdictReason?: string | null | undefined
}

export function useUpsertPresencialExam() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ registrationId, ...input }: { registrationId: number } & PresencialExamInput) =>
      api.post<{ ok: true }>(`/admin/registrations/${registrationId}/presencial-exam`, input),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['edu-presencial'] }) },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Essay submissions (Redação)

/** Filtro de listagem (alinhado com backend). */
export type EssayStatus = 'pending' | 'approved' | 'rejected' | 'all'

/** Estado real da redação (alinhado com schema Prisma). */
export type EssayDbStatus =
  | 'draft' | 'submitted' | 'ai_reviewing' | 'needs_human'
  | 'approved' | 'rejected' | 'expired'

export interface EssayAiCriterionResult {
  key: string
  label: string
  score: number
  comment?: string
}
export interface EssayAiAnalysis {
  criteria?: EssayAiCriterionResult[]
  overall?: string
  suggestions?: string[]
  [k: string]: unknown
}

export interface EssaySubmission {
  id: number
  status: EssayDbStatus
  attemptNumber: number
  wordCount: number
  startedAt: string | null
  expiresAt: string | null
  submittedAt: string | null
  // IA
  aiScore: number | null
  aiConfidence: number | null
  aiProcessedAt: string | null
  // Humano
  humanScore: number | null
  reviewedBy: number | null
  reviewedAt: string | null
  // Final
  finalScore: number | null
  passed: boolean | null
  cutoffApplied: number | null
  // Anti-fraude
  pasteAttempts: number
  visibilityChanges: number
  registration: {
    id: number
    candidateCode: string
    portal: { id: number; nome: string } | null
    lead: { id: number; nome: string | null; email: string | null } | null
    processRegistration: {
      selectionProcess: { id: number; nome: string; essayCutoff: number | null; essayMaxWords: number | null } | null
      offering: { nome: string; essayCutoff: number | null; course: { nome: string } | null } | null
    } | null
  } | null
}

export interface EssayKpi { pending: number; approved: number; rejected: number }

export interface EssayFilters {
  status?: EssayStatus | undefined
  portalId?: number | undefined
  q?: string | undefined
}

export function useEssaySubmissions(filters: EssayFilters = {}) {
  return useQuery({
    queryKey: ['edu-essays', filters],
    queryFn: () => api.get<{ items: EssaySubmission[]; total: number; kpi: EssayKpi }>(
      `/admin/essay-submissions${buildQs(filters)}`,
    ),
    staleTime: 30_000,
  })
}

export interface EssayDetail extends EssaySubmission {
  prompt: string | null
  essayText: string | null
  aiAnalysis: EssayAiAnalysis | null
  aiCostUsd: number | null
  humanNote: string | null
}

export function useEssaySubmission(id: number | null) {
  return useQuery({
    queryKey: ['edu-essay', id],
    queryFn: () => api.get<{ item: EssayDetail }>(`/admin/essay-submissions/${id}`),
    enabled: id !== null,
    staleTime: 30_000,
  })
}

export function useReviewEssay() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: {
      id: number
      status: 'approved' | 'rejected'
      humanScore?: number | null | undefined
      humanNote?: string | null | undefined
      forceOverride?: boolean | undefined
    }) => api.post<{ ok: true }>(`/admin/essay-submissions/${id}/review`, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['edu-essays'] })
      void qc.invalidateQueries({ queryKey: ['edu-essay'] })
    },
  })
}
