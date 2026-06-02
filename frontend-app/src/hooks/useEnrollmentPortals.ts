import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export type PortalFormMode = 'full' | 'interest'

export type FontFamily = 'inter' | 'roboto' | 'poppins' | 'system'
export type RadiusScale = 'sharp' | 'medium' | 'rounded'
export type CaptchaType = 'recaptcha' | 'hcaptcha' | null
export type PaymentProvider = 'asaas' | 'pagarme' | null
// 'link'        — paymentlinks hospedado pelo provedor (redirect)
// 'transparent' — checkout PIX/boleto/cartão renderiza no portal
export type PaymentMode = 'link' | 'transparent'

export interface EnrollmentPortal {
  id: number
  slug: string
  nome: string
  unitId: number
  unit?: { id: number; nome: string }
  team?: { id: number; name: string; color: string | null } | null
  selectionProcessIds: number[]
  formMode: PortalFormMode
  continuationPortalId: number | null
  magicLinkTtlDays: number
  alwaysCreateNew: boolean
  codePrefix: string
  active: boolean
  publishedAt: string | null

  ctaBehavior: 'message' | 'redirect'
  ctaTarget: string | null
  ctaMessage: string | null

  // Pagamento
  requirePayment: boolean
  paymentProvider: PaymentProvider
  paymentDeadlineHours: number
  paymentConnectionId: number | null
  paymentMode: PaymentMode

  // Captcha
  captchaType: CaptchaType
  captchaSiteKey: string | null
  // captchaSecret intencionalmente NÃO exposto (write-only)

  // Filtros (JSON arrays no backend)
  allowedLevelIds: number[] | null
  allowedCourseIds: number[] | null
  allowedCampusIds: number[] | null
  allowedModalityIds: number[] | null

  // Funil/CRM
  teamId: number | null
  funnelId: number | null
  stageKey: string | null
  docsCompleteStageKey: string | null
  finalApprovalStageKey: string | null

  // SEO + domínio
  metaTitle: string | null
  metaDescription: string | null
  ogImageUrl: string | null
  customDomain: string | null
  sslStatus: string | null

  // Branding
  brandLogoUrl: string | null
  brandLogoLink: string | null
  brandFaviconUrl: string | null
  brandPrimaryColor: string | null
  brandHeroEnabled: boolean
  brandHeroUrl: string | null
  brandHeroTitle: string | null
  brandHeroSubtitle: string | null
  brandHeroOverlayOpacity: number | null
  brandFooterText: string | null
  brandFontFamily: FontFamily | null
  brandRadiusScale: RadiusScale | null

  // Custom code
  customCss: string | null
  customHeadJs: string | null
  customBodyJs: string | null

  // Pixels / tracking
  pixelConfig: PixelConfig | null

  // Form (steps + fields)
  formConfig: PortalFormConfig | null

  createdAt: string
  updatedAt: string
  _count?: { registrations: number }
}

export interface PixelConfig {
  ga4Id?: string | null
  gtmId?: string | null
  metaPixelId?: string | null
  tiktokPixelId?: string | null
  linkedinPartnerId?: string | null
}

export type PortalFieldType =
  | 'text' | 'email' | 'phone' | 'cpf' | 'cep' | 'date'
  | 'select' | 'textarea' | 'offering-picker' | 'rg' | 'number'

export interface PortalField {
  type: PortalFieldType
  name: string
  label: string
  required?: boolean
  options?: string[]
  placeholder?: string
  helpText?: string
  visibleWhen?: { entryMode?: string[] }
}

export interface PortalStep {
  id: string
  name: string
  fields: PortalField[]
}

export interface PortalFormConfig {
  steps: PortalStep[]
}

export interface EnrollmentPortalInput {
  nome?: string | undefined
  unitId?: number | undefined
  slug?: string | null | undefined
  formMode?: PortalFormMode | undefined
  continuationPortalId?: number | null | undefined
  selectionProcessIds?: number[] | undefined
  codePrefix?: string | undefined
  magicLinkTtlDays?: number | undefined
  alwaysCreateNew?: boolean | undefined
  ctaBehavior?: 'message' | 'redirect' | undefined
  ctaMessage?: string | null | undefined
  ctaTarget?: string | null | undefined
  requirePayment?: boolean | undefined
  paymentProvider?: PaymentProvider | undefined
  paymentDeadlineHours?: number | undefined
  paymentConnectionId?: number | null | undefined
  paymentMode?: PaymentMode | undefined
  captchaType?: CaptchaType | undefined
  captchaSiteKey?: string | null | undefined
  captchaSecret?: string | null | undefined
  allowedLevelIds?: number[] | null | undefined
  allowedCourseIds?: number[] | null | undefined
  allowedCampusIds?: number[] | null | undefined
  allowedModalityIds?: number[] | null | undefined
  teamId?: number | null | undefined
  funnelId?: number | null | undefined
  stageKey?: string | null | undefined
  docsCompleteStageKey?: string | null | undefined
  finalApprovalStageKey?: string | null | undefined
  active?: boolean | undefined
  metaTitle?: string | null | undefined
  metaDescription?: string | null | undefined
  ogImageUrl?: string | null | undefined
  customDomain?: string | null | undefined
  customCss?: string | null | undefined
  customHeadJs?: string | null | undefined
  customBodyJs?: string | null | undefined
  pixelConfig?: PixelConfig | null | undefined
  publishedAt?: string | null | undefined
  formConfig?: PortalFormConfig | null | undefined
}

/** Subset apenas dos campos brand* — usado pelo endpoint /branding (mais leve). */
export interface BrandingInput {
  brandLogoUrl?: string | null | undefined
  brandLogoLink?: string | null | undefined
  brandFaviconUrl?: string | null | undefined
  brandPrimaryColor?: string | null | undefined
  brandHeroEnabled?: boolean | undefined
  brandHeroUrl?: string | null | undefined
  brandHeroTitle?: string | null | undefined
  brandHeroSubtitle?: string | null | undefined
  brandHeroOverlayOpacity?: number | null | undefined
  brandFooterText?: string | null | undefined
  brandFontFamily?: FontFamily | null | undefined
  brandRadiusScale?: RadiusScale | null | undefined
}

export function useEnrollmentPortals() {
  return useQuery({
    queryKey: ['enrollment-portals'],
    queryFn: () => api.get<{ portals: EnrollmentPortal[] }>('/admin/enrollment-portals'),
    staleTime: 60_000,
  })
}

export function useEnrollmentPortal(id: number | null | undefined) {
  return useQuery({
    queryKey: ['enrollment-portal', id],
    queryFn: () => api.get<{ portal: EnrollmentPortal }>(`/admin/enrollment-portals/${id}`),
    enabled: !!id,
    staleTime: 60_000,
  })
}

export function useCreateEnrollmentPortal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: EnrollmentPortalInput) =>
      api.post<{ ok: true; portal: EnrollmentPortal }>('/admin/enrollment-portals', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['enrollment-portals'] }),
  })
}

export function useUpdateEnrollmentPortal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: { id: number } & Partial<EnrollmentPortalInput>) =>
      api.put<{ ok: true; portal: EnrollmentPortal }>(`/admin/enrollment-portals/${id}`, input),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['enrollment-portals'] })
      void qc.invalidateQueries({ queryKey: ['enrollment-portal', vars.id] })
    },
  })
}

export function useDeleteEnrollmentPortal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<{ ok: true }>(`/admin/enrollment-portals/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['enrollment-portals'] }),
  })
}

export function useUpdatePortalBranding(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: BrandingInput) =>
      api.post<{ ok: true; portal: EnrollmentPortal | null }>(`/admin/enrollment-portals/${id}/branding`, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['enrollment-portals'] })
      void qc.invalidateQueries({ queryKey: ['enrollment-portal', id] })
    },
  })
}

export type PortalAssetKind = 'logo' | 'favicon' | 'hero'

export function useUploadPortalAsset(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ kind, file }: { kind: PortalAssetKind; file: File }) => {
      const fd = new FormData()
      fd.append('file', file)
      return api.post<{ ok: true; url: string; kind: PortalAssetKind; sizeBytes: number }>(
        `/admin/enrollment-portals/${id}/upload?kind=${kind}`,
        fd,
      )
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['enrollment-portals'] })
      void qc.invalidateQueries({ queryKey: ['enrollment-portal', id] })
    },
  })
}

export function useDeletePortalAsset(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (kind: PortalAssetKind) =>
      api.delete<{ ok: true }>(`/admin/enrollment-portals/${id}/upload?kind=${kind}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['enrollment-portals'] })
      void qc.invalidateQueries({ queryKey: ['enrollment-portal', id] })
    },
  })
}

// ── Analytics ──────────────────────────────────────────────────

export interface PortalAnalytics {
  views: number
  submissions: number
  conversions: number
  conversionRate: number
  period: { days: number; since: string }
  registrations: { total: number; paid: number; pending: number; expired: number }
  revenue: number
  byStatus: { status: string; count: number }[]
  byDay: { day: string; total: number; paid: number }[]
  bySource: { source: string; count: number }[]
}

export function usePortalAnalytics(id: number | null | undefined, days = 30) {
  return useQuery({
    queryKey: ['portal-analytics', id, days],
    queryFn: () => api.get<PortalAnalytics>(`/admin/enrollment-portals/${id}/analytics?days=${days}`),
    enabled: !!id,
    staleTime: 60_000,
  })
}

export interface PortalFunnel {
  funnel: Record<string, Record<number, Record<string, number>>>
}

export function usePortalFunnel(id: number | null | undefined) {
  return useQuery({
    queryKey: ['portal-funnel', id],
    queryFn: () => api.get<PortalFunnel>(`/admin/enrollment-portals/${id}/funnel`),
    enabled: !!id,
    staleTime: 60_000,
  })
}

/** Força sincronização do pagamento de uma inscrição com o provider (Pagar.me/Asaas).
 *  Use quando o webhook não chegou ou pra confirmar status manualmente. */
export function useSyncRegistrationPayment(registrationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () =>
      api.post<{ ok: true; transitionedToPaid: boolean; results: Array<{ externalId: string; paymentStatus?: string; transitionedToPaid?: boolean; error?: string }> }>(
        `/admin/enrollment-registrations/${registrationId}/sync-payment`,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['registration-full', registrationId] })
      void qc.invalidateQueries({ queryKey: ['registration-review', registrationId] })
    },
  })
}

export function useDuplicatePortal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      api.post<{ ok: true; portal: EnrollmentPortal }>(`/admin/enrollment-portals/${id}/duplicate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['enrollment-portals'] }),
  })
}

// ── Inscrições do portal ───────────────────────────────────────

export type RegistrationStatus =
  | 'draft' | 'pending' | 'submitted' | 'paid'
  | 'docs_uploaded' | 'docs_reviewing' | 'docs_approved' | 'docs_rejected'
  | 'reviewing' | 'approved' | 'enrolled'
  | 'rejected' | 'cancelled' | 'expired'

export interface EnrollmentRegistration {
  id: number
  portalId: number
  candidateCode: string
  status: RegistrationStatus
  paymentStatus: string | null
  paymentAmount: string | number | null
  paymentPaidAt: string | null
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
  formData: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
  lead?: {
    id: number
    nome: string | null
    email: string | null
    whatsapp: string | null
    status: string | null
    funnelId: number | null
  } | null
  processRegistration?: {
    id: number
    status: string
    offering?: { nome: string } | null
  } | null
  _count?: { documents: number }
}

export interface RegistrationsKpis {
  total: number
  today: number
  week: number
  conversions: number
}

export interface RegistrationsResponse {
  items: EnrollmentRegistration[]
  total: number
  portal: {
    id: number
    nome: string
    slug: string
    requirePayment: boolean
    funnel?: {
      id: number
      name: string
      stages: { key: string; name: string; color: string | null; position: number }[]
    } | null
  } | null
  kpis: RegistrationsKpis
}

export interface RegistrationFilters {
  status?: RegistrationStatus | ''
  paymentStatus?: string
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  dateFrom?: string
  dateTo?: string
  search?: string
  limit?: number
  offset?: number
}

// ── Detalhe de inscrição (document-review) ─────────────────────

export type DocumentStatus = 'pending' | 'approved' | 'rejected'
export type AiSuggestion = 'approve' | 'review' | 'reject' | null
export type AiStatus = 'pending' | 'analyzing' | 'completed' | 'failed' | null
export type CompletionStatus = 'pending' | 'rejected' | 'complete'

export interface EnrollmentDocument {
  id: number
  typeCode: string | null
  label: string | null
  fileUrl: string | null
  fileName: string | null
  mimeType: string | null
  sizeBytes: number | null
  status: DocumentStatus
  reviewNote: string | null
  reviewedAt: string | null
  reviewedBy: number | null
  reviewerName?: string | null
  aiStatus: AiStatus
  aiSuggestion: AiSuggestion
  aiConfidence: number | null
  aiAnalysis: unknown
  uploadedAt: string
  type?: { id: number; code: string; name: string; category: string; aiAnalysisTemplate: string | null }
}

export interface DocumentSlot {
  ordem: number
  required: boolean
  helpText: string | null
  documentType?: { id: number; code: string; name: string; category: string; aiAnalysisTemplate: string | null }
  latestDoc: EnrollmentDocument | null
}

export type EssayStatus = 'not-required' | 'pending' | 'submitted' | 'reviewing' | 'approved' | 'rejected'

export interface RegistrationReview {
  registration: {
    id: number
    candidateCode: string
    status: RegistrationStatus
    createdAt: string
    formData: Record<string, unknown> | null
    paymentStatus?: string | null
    paymentMethod?: string | null
    paymentAmount?: string | number | null
    paymentPaidAt?: string | null
  }
  lead: { id: number; nome: string | null; email: string | null; whatsapp: string | null; status: string | null } | null
  portal: {
    id: number
    nome: string
    slug: string
    funnelId: number | null
    docsCompleteStageKey: string | null
    funnel?: {
      id: number
      name: string
      stages: { key: string; name: string; color: string | null; position: number }[]
    } | null
  } | null
  processRegistration: {
    id: number
    selectionProcess?: {
      id: number
      nome: string
      codigo: string | null
      useCustomDocuments: boolean
      entryMode?: { code: string; name: string; icon: string | null; evaluationType?: string | null } | null
    }
    offering?: {
      nome: string
      turno: string | null
      course?: { nome: string }
      campuses?: { campus: { nome: string; cidade: string | null } }[]
    }
  } | null
  completion: CompletionStatus
  essay?: { status: EssayStatus; score: number | null; required: boolean }
  slots: DocumentSlot[]
  extras: EnrollmentDocument[]
  autoAdvance:
    | { enabled: false }
    | { enabled: true; stageKey: string; stageName: string; funnelName: string | null }
}

export function useRegistrationReview(id: number | null | undefined) {
  return useQuery({
    queryKey: ['registration-review', id],
    queryFn: () =>
      api.get<RegistrationReview>(`/admin/enrollment-registrations/${id}/document-review`),
    enabled: !!id,
    staleTime: 30_000,
  })
}

export function useReviewDocument(registrationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { docId: number; status: 'approved' | 'rejected'; reviewNote?: string | null }) =>
      api.put<{ ok: true; document: EnrollmentDocument }>(
        `/admin/enrollment-documents/${input.docId}/review`,
        { status: input.status, reviewNote: input.reviewNote ?? null },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['registration-review', registrationId] })
      void qc.invalidateQueries({ queryKey: ['portal-registrations'] })
    },
  })
}

export function useRenotifyDocument(registrationId: number) {
  return useMutation({
    mutationFn: (docId: number) =>
      api.post<{ ok: true }>(`/admin/enrollment-documents/${docId}/renotify`),
    onSuccess: () => {
      // Sem refetch: status do doc não muda. Apenas reemite evento.
      void registrationId
    },
  })
}

export function useReanalyzeDocument(registrationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (docId: number) =>
      api.post<{ ok: true }>(`/admin/enrollment-documents/${docId}/reanalyze`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['registration-review', registrationId] }),
  })
}

// ── ENEM imports por inscrição ─────────────────────────────────

export interface EnemImportFull {
  id: number
  registrationId: number
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
  validatedAt: string | null
  validatedBy: number | null
  validationNote: string | null
  createdAt: string
}

export interface EnrollmentPaymentMethodAdmin {
  id: number
  method: 'pix' | 'boleto' | 'credit_card'
  provider: 'asaas' | 'pagarme'
  status: string
  amount: string | number | null
  externalId: string | null
  expiresAt: string | null
  qrCode: string | null
  qrCodeUrl: string | null
  boletoLine: string | null
  boletoPdfUrl: string | null
  boletoDueAt: string | null
  cardLastDigits: string | null
  cardBrand: string | null
  lastErrorMessage: string | null
  paidAt: string | null
  createdAt: string
}

/** Detalhe da inscrição com enemScoreImports — usado no RegistrationDetail. */
export interface RegistrationFull {
  registration: {
    id: number
    candidateCode: string
    status: RegistrationStatus
    paymentStatus: string | null
    paymentAmount: string | number | null
    paymentUrl: string | null
    formData: Record<string, unknown> | null
    createdAt: string
    enemScoreImports?: EnemImportFull[]
    documents?: EnrollmentDocument[]
    paymentMethods?: EnrollmentPaymentMethodAdmin[]
    portal?: {
      slug: string
      requirePayment: boolean
      funnel?: { id: number; name: string; stages: { key: string; name: string; color: string | null }[] } | null
    }
    lead?: { id: number; nome: string | null; email: string | null; whatsapp: string | null; status: string | null } | null
    processRegistration?: { offering?: { nome: string | null; course?: { nome: string } | null } } | null
  }
}

export function useRegistrationFull(id: number | null | undefined) {
  return useQuery({
    queryKey: ['registration-full', id],
    queryFn: () => api.get<RegistrationFull>(`/admin/enrollment-registrations/${id}`),
    enabled: !!id,
    staleTime: 30_000,
  })
}

export interface EnemUpdateInput {
  cienciasHumanas?: number | null
  cienciasNatureza?: number | null
  linguagens?: number | null
  matematica?: number | null
  redacao?: number | null
  passed?: boolean | null
  validationNote?: string | null
}

export function useUpdateEnemImport(registrationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ importId, ...input }: { importId: number } & EnemUpdateInput) =>
      api.put<{ ok: true; import: EnemImportFull }>(`/admin/enem-imports/${importId}`, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['registration-full', registrationId] })
      void qc.invalidateQueries({ queryKey: ['registration-review', registrationId] })
      void qc.invalidateQueries({ queryKey: ['edu-enem-imports'] })
    },
  })
}

// ── Magic link / continuation / enrollment-link by lead ────────

export function useResendMagicLink(slug: string) {
  return useMutation({
    mutationFn: (input: { email?: string; whatsapp?: string }) =>
      api.post<{ ok: true; sent?: boolean }>(`/public/portals/${slug}/resend-link`, input),
  })
}

export interface EnrollmentLinkByLead {
  url: string
  candidateCode: string | null
  portalSlug: string
  registrationId: number | null
}

export function useEnrollmentLinkByLead() {
  return useMutation({
    mutationFn: (leadId: number) =>
      api.get<EnrollmentLinkByLead>(`/admin/leads/${leadId}/enrollment-link`),
  })
}

export function useBulkApproveAi(registrationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { minConfidence?: number; dryRun?: boolean } = {}) =>
      api.post<{ ok: true; approved: number; skipped: number; details?: unknown[] }>(
        `/admin/enrollment-registrations/${registrationId}/bulk-approve-ai`,
        { minConfidence: input.minConfidence ?? 0.85, dryRun: input.dryRun ?? false },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['registration-review', registrationId] }),
  })
}

export function usePortalRegistrations(portalId: number | null | undefined, filters: RegistrationFilters = {}) {
  return useQuery({
    queryKey: ['portal-registrations', portalId, filters],
    queryFn: () => {
      const qs = new URLSearchParams()
      for (const [k, v] of Object.entries(filters)) {
        if (v !== undefined && v !== '' && v !== null) qs.set(k, String(v))
      }
      const url = qs.toString()
        ? `/admin/enrollment-portals/${portalId}/registrations?${qs}`
        : `/admin/enrollment-portals/${portalId}/registrations`
      return api.get<RegistrationsResponse>(url)
    },
    enabled: !!portalId,
    staleTime: 30_000,
  })
}

// ── Ações em uma inscrição (admin) ─────────────────────────────

export function useCancelRegistration(portalId: number | null | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason?: string }) =>
      api.post<{ ok: true; registration: EnrollmentRegistration }>(
        `/admin/enrollment-registrations/${id}/cancel`,
        { reason: reason ?? null },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['portal-registrations', portalId] })
      void qc.invalidateQueries({ queryKey: ['registration-full'] })
    },
  })
}

export function useResendRegistrationLink() {
  return useMutation({
    mutationFn: (id: number) =>
      api.post<{ ok: true; sent: boolean; url: string }>(
        `/admin/enrollment-registrations/${id}/resend-link`,
      ),
  })
}

// ── Check de disponibilidade de slug ───────────────────────────

export interface CheckSlugResult {
  available: boolean
  reason?: 'empty' | 'too-short' | 'taken'
  normalized?: string
  suggestion?: string
}

export function checkPortalSlug(slug: string, excludeId?: number | null): Promise<CheckSlugResult> {
  const qs = new URLSearchParams({ slug })
  if (excludeId) qs.set('excludeId', String(excludeId))
  return api.get<CheckSlugResult>(`/admin/enrollment-portals/check-slug?${qs}`)
}
