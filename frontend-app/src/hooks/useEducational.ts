import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/lib/apiClient'

// ── Níveis de ensino ───────────────────────────────────────────

export interface EducationalLevel {
  id: number
  nome: string
  codigo: string | null
  descricao: string | null
  ordem: number
  active: boolean
  createdAt: string
  updatedAt: string
  _count?: { courses: number; offerings: number; selectionProcesses: number }
}

export interface EducationalLevelInput {
  nome: string
  codigo?: string | null | undefined
  descricao?: string | null | undefined
  ordem?: number | undefined
  active?: boolean | undefined
}

export function useEducationalLevels() {
  return useQuery({
    queryKey: ['edu', 'levels'],
    queryFn: () => api.get<{ levels: EducationalLevel[] }>('/admin/educacional/levels'),
    staleTime: 60_000,
  })
}

export function useCreateEducationalLevel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: EducationalLevelInput) =>
      api.post<{ ok: true; level: EducationalLevel }>('/admin/educacional/levels', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['edu', 'levels'] }),
  })
}

export function useUpdateEducationalLevel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: { id: number } & Partial<EducationalLevelInput>) =>
      api.put<{ ok: true; level: EducationalLevel }>(`/admin/educacional/levels/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['edu', 'levels'] }),
  })
}

export function useDeleteEducationalLevel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<{ ok: true; movedToTrash: true }>(`/admin/educacional/levels/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['edu', 'levels'] }),
  })
}

export function useReorderEducationalLevels() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (items: { id: number; position: number }[]) =>
      api.put<{ ok: true }>('/admin/educacional/levels/reorder', { items }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['edu', 'levels'] }),
  })
}

// ── Modalidades ────────────────────────────────────────────────

export interface Modality {
  id: number
  nome: string
  codigo: string | null
  descricao: string | null
  ordem: number
  active: boolean
  createdAt: string
  updatedAt: string
  _count?: { offerings: number }
}

export interface ModalityInput {
  nome: string
  codigo?: string | null | undefined
  descricao?: string | null | undefined
  ordem?: number | undefined
  active?: boolean | undefined
}

export function useModalities() {
  return useQuery({
    queryKey: ['edu', 'modalities'],
    queryFn: () => api.get<{ modalities: Modality[] }>('/admin/educacional/modalities'),
    staleTime: 60_000,
  })
}

export function useCreateModality() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: ModalityInput) =>
      api.post<{ ok: true; modality: Modality }>('/admin/educacional/modalities', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['edu', 'modalities'] }),
  })
}

export function useUpdateModality() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: { id: number } & Partial<ModalityInput>) =>
      api.put<{ ok: true; modality: Modality }>(`/admin/educacional/modalities/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['edu', 'modalities'] }),
  })
}

export function useDeleteModality() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<{ ok: true; movedToTrash: true }>(`/admin/educacional/modalities/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['edu', 'modalities'] }),
  })
}

export function useReorderModalities() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (items: { id: number; position: number }[]) =>
      api.put<{ ok: true }>('/admin/educacional/modalities/reorder', { items }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['edu', 'modalities'] }),
  })
}

// ── Unidades ───────────────────────────────────────────────────

export interface EducationalUnit {
  id: number
  nome: string
  codigo: string | null
  descricao: string | null
  active: boolean
  createdAt: string
  updatedAt: string
  _count?: { campuses: number; courses: number; offerings: number }
}

export interface EducationalUnitInput {
  nome: string
  codigo?: string | null | undefined
  descricao?: string | null | undefined
  active?: boolean | undefined
}

export function useEducationalUnits() {
  return useQuery({
    queryKey: ['edu', 'units'],
    queryFn: () => api.get<{ units: EducationalUnit[] }>('/admin/educacional/units'),
    staleTime: 60_000,
  })
}

export function useCreateEducationalUnit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: EducationalUnitInput) =>
      api.post<{ ok: true; unit: EducationalUnit }>('/admin/educacional/units', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['edu', 'units'] }),
  })
}

export function useUpdateEducationalUnit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: { id: number } & Partial<EducationalUnitInput>) =>
      api.put<{ ok: true; unit: EducationalUnit }>(`/admin/educacional/units/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['edu', 'units'] }),
  })
}

export function useDeleteEducationalUnit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<{ ok: true; movedToTrash: true }>(`/admin/educacional/units/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['edu', 'units'] }),
  })
}

// ── Campus ─────────────────────────────────────────────────────

export interface Campus {
  id: number
  unitId: number
  unit?: { id: number; nome: string }
  nome: string
  codigo: string | null
  descricao: string | null
  telefone: string | null
  email: string | null
  endereco: string | null
  numero: string | null
  bairro: string | null
  cep: string | null
  cidade: string | null
  estado: string | null
  latitude: number | null
  longitude: number | null
  active: boolean
  createdAt: string
  updatedAt: string
  _count?: { offerings: number }
}

export interface CampusInput {
  unitId: number
  nome: string
  codigo?: string | null | undefined
  descricao?: string | null | undefined
  telefone?: string | null | undefined
  email?: string | null | undefined
  endereco?: string | null | undefined
  numero?: string | null | undefined
  bairro?: string | null | undefined
  cep?: string | null | undefined
  cidade?: string | null | undefined
  estado?: string | null | undefined
  latitude?: number | null | undefined
  longitude?: number | null | undefined
  active?: boolean | undefined
}

export function useCampuses(unitId?: number) {
  return useQuery({
    queryKey: ['edu', 'campuses', unitId ?? 'all'],
    queryFn: () => {
      const qs = unitId ? `?unitId=${unitId}` : ''
      return api.get<{ campuses: Campus[] }>(`/admin/educacional/campuses${qs}`)
    },
    staleTime: 60_000,
  })
}

export function useCreateCampus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CampusInput) =>
      api.post<{ ok: true; campus: Campus }>('/admin/educacional/campuses', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['edu', 'campuses'] }),
  })
}

export function useUpdateCampus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: { id: number } & Partial<CampusInput>) =>
      api.put<{ ok: true; campus: Campus }>(`/admin/educacional/campuses/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['edu', 'campuses'] }),
  })
}

export function useDeleteCampus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<{ ok: true; movedToTrash: true }>(`/admin/educacional/campuses/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['edu', 'campuses'] }),
  })
}

// ── Cursos ─────────────────────────────────────────────────────

export interface Course {
  id: number
  unitId: number
  levelId: number | null
  unit?: { id: number; nome: string }
  level?: { id: number; nome: string } | null
  nome: string
  codigo: string | null
  descricao: string | null
  duracaoMeses: number | null
  cargaHoraria: number | null
  active: boolean
  createdAt: string
  updatedAt: string
  _count?: { offerings: number }
}

export interface CourseInput {
  unitId: number
  levelId?: number | null | undefined
  nome: string
  codigo?: string | null | undefined
  descricao?: string | null | undefined
  duracaoMeses?: number | null | undefined
  cargaHoraria?: number | null | undefined
  active?: boolean | undefined
}

export function useCourses(filters: { unitId?: number; levelId?: number; search?: string } = {}) {
  return useQuery({
    queryKey: ['edu', 'courses', filters],
    queryFn: () => {
      const qs = new URLSearchParams()
      if (filters.unitId) qs.set('unitId', String(filters.unitId))
      if (filters.levelId) qs.set('levelId', String(filters.levelId))
      if (filters.search) qs.set('search', filters.search)
      const url = qs.toString() ? `/admin/educacional/courses?${qs}` : '/admin/educacional/courses'
      return api.get<{ courses: Course[] }>(url)
    },
    staleTime: 60_000,
  })
}

export function useCreateCourse() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CourseInput) =>
      api.post<{ ok: true; course: Course }>('/admin/educacional/courses', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['edu', 'courses'] }),
  })
}

export function useUpdateCourse() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: { id: number } & Partial<CourseInput>) =>
      api.put<{ ok: true; course: Course }>(`/admin/educacional/courses/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['edu', 'courses'] }),
  })
}

export function useDeleteCourse() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<{ ok: true; movedToTrash: true }>(`/admin/educacional/courses/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['edu', 'courses'] }),
  })
}

// ── Ofertas de curso ───────────────────────────────────────────

export type OfferingStatus = 'active' | 'closed' | 'draft' | 'archived'

export interface CourseOffering {
  id: number
  courseId: number
  unitId: number
  modalityId: number
  levelId: number | null
  selectionProcessId: number | null
  course?: { id: number; nome: string }
  unit?: { id: number; nome: string }
  modality?: { id: number; nome: string }
  level?: { id: number; nome: string } | null
  selectionProcess?: { id: number; nome: string; periodoLetivo?: string | null } | null
  campuses?: { campus: { id: number; nome: string; cidade?: string | null; estado?: string | null } }[]
  nome: string
  complemento: string | null
  codigo: string | null
  turno: string | null
  valorMensalidade: number | null
  valorMatricula: number | null
  notaCorte: number | null
  vagasMinimas: number | null
  vagasMaximas: number | null
  inicioInscricao: string | null
  terminoInscricao: string | null
  inicioMatricula: string | null
  terminoMatricula: string | null
  inicioCurso: string | null
  terminoCurso: string | null
  status: string
  active: boolean
  createdAt: string
  updatedAt: string
  totalInscricoes?: number
  vagasOcupadas?: number
  _count?: { registrations: number }
}

export interface CourseOfferingInput {
  courseId: number
  unitId: number
  modalityId: number
  levelId?: number | null | undefined
  selectionProcessId?: number | null | undefined
  campusIds?: number[] | undefined
  nome: string
  complemento?: string | null | undefined
  codigo?: string | null | undefined
  turno?: string | null | undefined
  valorMensalidade?: number | null | undefined
  valorMatricula?: number | null | undefined
  notaCorte?: number | null | undefined
  vagasMinimas?: number | null | undefined
  vagasMaximas?: number | null | undefined
  inicioInscricao?: string | null | undefined
  terminoInscricao?: string | null | undefined
  inicioMatricula?: string | null | undefined
  terminoMatricula?: string | null | undefined
  inicioCurso?: string | null | undefined
  terminoCurso?: string | null | undefined
  status?: string | undefined
  active?: boolean | undefined
}

export interface OfferingFilters {
  courseId?: number
  unitId?: number
  modalityId?: number
  levelId?: number
  status?: string
  search?: string
}

export function useOfferings(filters: OfferingFilters = {}) {
  return useQuery({
    queryKey: ['edu', 'offerings', filters],
    queryFn: () => {
      const qs = new URLSearchParams()
      for (const [k, v] of Object.entries(filters)) {
        if (v !== undefined && v !== '' && v !== null) qs.set(k, String(v))
      }
      const url = qs.toString() ? `/admin/educacional/offerings?${qs}` : '/admin/educacional/offerings'
      return api.get<{ offerings: CourseOffering[] }>(url)
    },
    staleTime: 60_000,
  })
}

export function useCreateOffering() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CourseOfferingInput) =>
      api.post<{ ok: true; offering: CourseOffering }>('/admin/educacional/offerings', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['edu', 'offerings'] }),
  })
}

export function useUpdateOffering() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: { id: number } & Partial<CourseOfferingInput>) =>
      api.put<{ ok: true; offering: CourseOffering }>(`/admin/educacional/offerings/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['edu', 'offerings'] }),
  })
}

export function useDeleteOffering() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<{ ok: true; movedToTrash: true }>(`/admin/educacional/offerings/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['edu', 'offerings'] }),
  })
}

// ── Modos de ingresso ──────────────────────────────────────────

export type EvaluationType = 'none' | 'docs' | 'enem' | 'exam_online' | 'exam_presencial'

export interface EntryModeDocRequirement {
  id: number
  entryModeId: number
  documentTypeId: number
  required: boolean
  ordem: number
  helpText: string | null
  documentType?: { id: number; code: string; name: string; category: string }
}

export interface EntryMode {
  id: number
  code: string
  name: string
  icon: string | null
  description: string | null
  evaluationType: EvaluationType
  requiresClassification: boolean
  /** Forma de ingresso do Censo que este modo declara. Null = não declarada. */
  censoForma: string | null
  criterioClassificacao: string | null
  defaultFormExtras: unknown
  ordem: number
  active: boolean
  createdAt: string
  updatedAt: string
  documentRequirements?: EntryModeDocRequirement[]
  _count?: { selectionProcesses: number }
}

/** Catálogo normativo servido pelo backend — não duplicar a lista aqui. */
export interface FormaIngressoCatalogo {
  codigo: string
  rotulo: string
  descricao: string
  criteriosSugeridos: string[]
  exigeCursoOrigem?: boolean
  exigeAmparo?: boolean
  restricao?: string
}

export interface CriterioCatalogo {
  codigo: string
  rotulo: string
  descricao: string
  classifica: boolean
  avaliacaoEsperada: EvaluationType
}

export interface EntryModeInput {
  code: string
  name: string
  icon?: string | null | undefined
  description?: string | null | undefined
  censoForma?: string | null | undefined
  criterioClassificacao?: string | null | undefined
  evaluationType: EvaluationType
  requiresClassification?: boolean | undefined
  defaultFormExtras?: unknown
  ordem?: number | undefined
  active?: boolean | undefined
}

export function useEntryModes(includeInactive = true) {
  return useQuery({
    queryKey: ['edu', 'entry-modes', includeInactive ? 'all' : 'active'],
    queryFn: () =>
      api.get<{
        modes: EntryMode[]
        catalogoCenso: { formas: FormaIngressoCatalogo[]; criterios: CriterioCatalogo[] }
        semFormaDeclarada: { id: number; name: string }[]
      }>(
        `/admin/educacional/entry-modes${includeInactive ? '?includeInactive=1' : ''}`,
      ),
    staleTime: 60_000,
  })
}

export function useCreateEntryMode() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: EntryModeInput) =>
      api.post<{ ok: true; mode: EntryMode }>('/admin/educacional/entry-modes', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['edu', 'entry-modes'] }),
  })
}

export function useUpdateEntryMode() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: { id: number } & Partial<EntryModeInput>) =>
      api.put<{ ok: true; mode: EntryMode }>(`/admin/educacional/entry-modes/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['edu', 'entry-modes'] }),
  })
}

export function useDeleteEntryMode() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<{ ok: true; movedToTrash: true }>(`/admin/educacional/entry-modes/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['edu', 'entry-modes'] }),
  })
}

export function useReorderEntryModes() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (items: { id: number; position: number }[]) =>
      api.put<{ ok: true }>('/admin/educacional/entry-modes/reorder', { items }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['edu', 'entry-modes'] }),
  })
}

// ── Tipos de documento (catálogo read-only) ────────────────────

export interface DocumentType {
  id: number
  code: string
  name: string
  description: string | null
  category: string
  ordem: number
  active: boolean
}

export function useDocumentTypes(category?: string) {
  return useQuery({
    queryKey: ['edu', 'document-types', category ?? 'all'],
    queryFn: () => {
      const qs = category ? `?category=${encodeURIComponent(category)}` : ''
      return api.get<{ types: DocumentType[] }>(`/admin/educacional/document-types${qs}`)
    },
    staleTime: 5 * 60_000,
  })
}

// ── Matriz de documentos (EntryMode e SelectionProcess) ────────

export interface DocumentRequirement {
  id: number
  documentTypeId: number
  required: boolean
  ordem: number
  helpText: string | null
  documentType?: { id: number; code: string; name: string; category: string }
}

export interface DocumentRequirementInput {
  documentTypeId: number
  required?: boolean | undefined
  ordem?: number | undefined
  helpText?: string | null | undefined
}

export type DocOwner =
  | { kind: 'entry-mode'; entryModeId: number }
  | { kind: 'selection-process'; selectionProcessId: number }

function docOwnerBaseUrl(o: DocOwner): string {
  return o.kind === 'entry-mode'
    ? `/admin/educacional/entry-modes/${o.entryModeId}/documents`
    : `/admin/educacional/selection-processes/${o.selectionProcessId}/documents`
}

function docOwnerInvalidationKey(o: DocOwner): readonly unknown[] {
  return o.kind === 'entry-mode'
    ? ['edu', 'entry-modes']
    : ['edu', 'selection-process', o.selectionProcessId]
}

export function useCreateDocRequirement(owner: DocOwner) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: DocumentRequirementInput) =>
      api.post<{ ok: true; requirement: DocumentRequirement }>(docOwnerBaseUrl(owner), input),
    onSuccess: () => qc.invalidateQueries({ queryKey: docOwnerInvalidationKey(owner) }),
  })
}

export function useUpdateDocRequirement(owner: DocOwner) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ reqId, ...input }: { reqId: number } & Partial<DocumentRequirementInput>) =>
      api.put<{ ok: true; requirement: DocumentRequirement }>(`${docOwnerBaseUrl(owner)}/${reqId}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: docOwnerInvalidationKey(owner) }),
  })
}

export function useDeleteDocRequirement(owner: DocOwner) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (reqId: number) => api.delete<{ ok: true }>(`${docOwnerBaseUrl(owner)}/${reqId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: docOwnerInvalidationKey(owner) }),
  })
}

export function useCloneSPDocsFromMode(selectionProcessId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () =>
      api.post<{ ok: true; cloned: number }>(
        `/admin/educacional/selection-processes/${selectionProcessId}/documents/clone-from-mode`,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['edu', 'selection-process', selectionProcessId] }),
  })
}

// ── Processos seletivos ────────────────────────────────────────

export interface SelectionProcess {
  id: number
  unitId: number
  levelId: number | null
  entryModeId: number | null
  unit?: { id: number; nome: string }
  level?: { id: number; nome: string } | null
  entryMode?: {
    id: number
    code: string
    name: string
    icon: string | null
    evaluationType: EvaluationType
    documentRequirements?: DocumentRequirement[]
  } | null

  nome: string
  codigo: string | null
  slug: string | null
  descricao: string | null
  editalUrl: string | null
  taxaInscricao: number | null
  notaCorte: number | null
  periodoLetivo: string | null

  inicioInscricao: string | null
  terminoInscricao: string | null
  inicioMatricula: string | null
  terminoMatricula: string | null

  status: string
  active: boolean
  useCustomDocuments: boolean

  // Configuração de Redação Online
  essayPrompt: string | null
  essayDurationMinutes: number | null
  essayMaxAttempts: number
  essayMinWords: number | null
  essayMaxWords: number | null
  essayPasteBlocked: boolean
  essayAiEnabled: boolean
  essayAiAutoApprove: boolean
  essayCutoff: number | null
  essayAiCriteria: unknown
  presencialCutoff: number | null

  documentRequirements?: DocumentRequirement[]
  createdAt: string
  updatedAt: string
  _count?: { offerings: number; registrations: number }
}

export interface SelectionProcessInput {
  unitId: number
  levelId?: number | null | undefined
  entryModeId: number
  nome: string
  codigo?: string | null | undefined
  slug?: string | null | undefined
  descricao?: string | null | undefined
  editalUrl?: string | null | undefined
  taxaInscricao?: number | null | undefined
  notaCorte?: number | null | undefined
  periodoLetivo?: string | null | undefined
  inicioInscricao?: string | null | undefined
  terminoInscricao?: string | null | undefined
  inicioMatricula?: string | null | undefined
  terminoMatricula?: string | null | undefined
  status?: string | undefined
  active?: boolean | undefined
  useCustomDocuments?: boolean | undefined
  essayPrompt?: string | null | undefined
  essayDurationMinutes?: number | null | undefined
  essayMaxAttempts?: number | undefined
  essayMinWords?: number | null | undefined
  essayMaxWords?: number | null | undefined
  essayPasteBlocked?: boolean | undefined
  essayAiEnabled?: boolean | undefined
  essayAiAutoApprove?: boolean | undefined
  essayCutoff?: number | null | undefined
  essayAiCriteria?: { key: string; label: string; weight: number }[] | null | undefined
  presencialCutoff?: number | null | undefined
}

export interface EssayAiCriterion { key: string; label: string; weight: number }

export const DEFAULT_ESSAY_AI_CRITERIA: EssayAiCriterion[] = [
  { key: 'argumentacao', label: 'Argumentação',                         weight: 25 },
  { key: 'coesao',       label: 'Coesão e coerência',                   weight: 20 },
  { key: 'gramatica',    label: 'Gramática e ortografia',               weight: 20 },
  { key: 'tema',         label: 'Aderência ao tema',                    weight: 20 },
  { key: 'proposta',     label: 'Conclusão / proposta de intervenção',  weight: 15 },
]

export interface SelectionProcessFilters {
  unitId?: number
  levelId?: number
  entryModeId?: number
  status?: string
}

export function useSelectionProcesses(filters: SelectionProcessFilters = {}) {
  return useQuery({
    queryKey: ['edu', 'selection-processes', filters],
    queryFn: () => {
      const qs = new URLSearchParams()
      for (const [k, v] of Object.entries(filters)) {
        if (v !== undefined && v !== '' && v !== null) qs.set(k, String(v))
      }
      const url = qs.toString()
        ? `/admin/educacional/selection-processes?${qs}`
        : '/admin/educacional/selection-processes'
      return api.get<{ processes: SelectionProcess[] }>(url)
    },
    staleTime: 60_000,
  })
}

export function useSelectionProcess(id: number | null | undefined) {
  return useQuery({
    queryKey: ['edu', 'selection-process', id],
    queryFn: () =>
      api.get<{ process: SelectionProcess }>(`/admin/educacional/selection-processes/${id}`),
    enabled: !!id,
    staleTime: 60_000,
  })
}

export function useCreateSelectionProcess() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: SelectionProcessInput) =>
      api.post<{ ok: true; process: SelectionProcess }>('/admin/educacional/selection-processes', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['edu', 'selection-processes'] }),
  })
}

export function useUpdateSelectionProcess() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: { id: number } & Partial<SelectionProcessInput>) =>
      api.put<{ ok: true; process: SelectionProcess }>(
        `/admin/educacional/selection-processes/${id}`,
        input,
      ),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['edu', 'selection-processes'] })
      void qc.invalidateQueries({ queryKey: ['edu', 'selection-process', vars.id] })
    },
  })
}

export function useDeleteSelectionProcess() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      api.delete<{ ok: true; movedToTrash: true }>(`/admin/educacional/selection-processes/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['edu', 'selection-processes'] }),
  })
}

// ── Temas de redação ───────────────────────────────────────────

export type EssayTopicSource = 'ai' | 'enem' | 'manual'

export interface EssayTopic {
  id: number
  selectionProcessId: number
  title: string | null
  prompt: string
  supportTexts: string | null
  active: boolean
  ordem: number
  source: EssayTopicSource
  sourceMeta: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
}

export interface EssayTopicInput {
  title?: string | null | undefined
  prompt: string
  supportTexts?: string | null | undefined
  active?: boolean | undefined
  ordem?: number | undefined
  source?: EssayTopicSource | undefined
  sourceMeta?: Record<string, unknown> | null | undefined
}

export function useEssayTopics(selectionProcessId: number | null | undefined) {
  return useQuery({
    queryKey: ['edu', 'essay-topics', selectionProcessId],
    queryFn: () =>
      api.get<{ topics: EssayTopic[] }>(
        `/admin/educacional/selection-processes/${selectionProcessId}/essay-topics`,
      ),
    enabled: !!selectionProcessId,
    staleTime: 60_000,
  })
}

export function useCreateEssayTopic(selectionProcessId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: EssayTopicInput) =>
      api.post<{ ok: true; topic: EssayTopic }>(
        `/admin/educacional/selection-processes/${selectionProcessId}/essay-topics`,
        input,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['edu', 'essay-topics', selectionProcessId] }),
  })
}

export function useUpdateEssayTopic(selectionProcessId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ topicId, ...input }: { topicId: number } & Partial<EssayTopicInput>) =>
      api.put<{ ok: true; topic: EssayTopic }>(
        `/admin/educacional/essay-topics/${topicId}`,
        input,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['edu', 'essay-topics', selectionProcessId] }),
  })
}

export function useDeleteEssayTopic(selectionProcessId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (topicId: number) =>
      api.delete<{ ok: true }>(`/admin/educacional/essay-topics/${topicId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['edu', 'essay-topics', selectionProcessId] }),
  })
}

export function useReorderEssayTopics(selectionProcessId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (items: { id: number; position: number }[]) =>
      api.put<{ ok: true }>(
        `/admin/educacional/selection-processes/${selectionProcessId}/essay-topics/reorder`,
        { items },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['edu', 'essay-topics', selectionProcessId] }),
  })
}

export interface EnemEssayTheme {
  year: number
  title: string
  prompt: string
  supportTexts: string
}

export function useEnemEssayCatalog(enabled = false) {
  return useQuery({
    queryKey: ['edu', 'essay-topics', 'enem-catalog'],
    queryFn: () =>
      api.get<{ themes: EnemEssayTheme[] }>('/admin/educacional/essay-topics/enem-catalog'),
    enabled,
    staleTime: 24 * 60 * 60_000,
  })
}

export interface AiGeneratedTopic {
  title: string | null
  prompt: string
  supportTexts: string | null
}

export interface AiGenerateInput {
  context?: string | undefined
  audience?: string | undefined
  area?: string | undefined
  includeSupportTexts?: boolean | undefined
}

export function useGenerateAiEssayTopic() {
  return useMutation({
    mutationFn: (input: AiGenerateInput) =>
      api.post<{
        ok: true
        topic: AiGeneratedTopic
        usage: { inputTokens: number; outputTokens: number; costUsd: number | null }
      }>('/admin/educacional/essay-topics/ai-generate', input),
  })
}

// ── Status do módulo (Dashboard educacional) ───────────────────

export interface EducationalStatus {
  enabled: boolean
  visible: boolean
  isSuperadmin: boolean
  counts: {
    levels: number
    modalities: number
    units: number
    courses: number
    offerings: number
    processes: number
    registrations: number
  }
  defaults?: {
    levels: number
    modalities: number
    customFields: number
    funnelStages: number
  }
}

const EMPTY_STATUS: EducationalStatus = {
  enabled: false,
  visible: false,
  isSuperadmin: false,
  counts: { levels: 0, modalities: 0, units: 0, courses: 0, offerings: 0, processes: 0, registrations: 0 },
}

export function useEducationalStatus() {
  return useQuery({
    queryKey: ['edu', 'status'],
    queryFn: async () => {
      try {
        return await api.get<EducationalStatus>('/admin/educacional/status')
      } catch (err) {
        // Endpoint pode retornar 403 se módulo desativado pra este usuário.
        if (err instanceof ApiError && err.status === 403) return EMPTY_STATUS
        throw err
      }
    },
    staleTime: 60_000,
  })
}

export interface EducationalStats {
  totalCourses: number
  totalOfferings: number
  totalProcesses: number
  totalRegistrations: number
  matriculados: number
  inscritos: number
  conversionRate: number
  byStatus: { status: string; count: number }[]
  topOfferings: { id: number; nome: string; registrations: number; matriculated: number }[]
}

export function useEducationalStats() {
  return useQuery({
    queryKey: ['edu', 'stats'],
    queryFn: () => api.get<EducationalStats>('/admin/educacional/stats'),
    staleTime: 30_000,
  })
}
