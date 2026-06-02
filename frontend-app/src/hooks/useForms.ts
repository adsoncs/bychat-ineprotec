import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { env } from '@/lib/env'

export interface FormItem {
  id: number
  name: string
  slug?: string | null
  active: boolean
  submissions: number
  funnelId: number | null
  stageKey: string | null
  defaultTeamId?: number | null
  createdAt: string
  updatedAt: string
}

export interface FormInput {
  name: string
  slug?: string | null | undefined
  fields?: FormField[] | undefined
  funnelId?: number | null | undefined
  stageKey?: string | null | undefined
  defaultTeamId?: number | null | undefined
  active?: boolean | undefined
  notifyEmails?: string | null | undefined
  webhookUrl?: string | null | undefined
  settings?: FormSettings | null | undefined
  styling?: FormStyling | null | undefined
}

// Tokens visuais do formulário. Mantenha em sincronia com `getDefaultFormStyling`
// no backend (`backend/src/routes/forms.ts`) e com o `FormPreview` — qualquer
// chave nova precisa estar nos três lugares.
export interface FormStyling {
  primaryColor?:        string
  primaryHoverColor?:   string
  buttonTextColor?:     string
  backgroundColor?:     string
  labelColor?:          string
  labelSize?:           string
  labelWeight?:         string
  fieldBgColor?:        string
  fieldBorderColor?:    string
  fieldTextColor?:      string
  fieldPlaceholderColor?: string
  fieldFontSize?:       string
  fieldPadding?:        string
  borderRadius?:        string
  buttonRadius?:        string
  buttonPadding?:       string
  buttonFontSize?:      string
  buttonFontWeight?:    string
  fontFamily?:          string
  fontSize?:            string
  maxWidth?:            string
  fieldSpacing?:        string
  successTitleColor?:   string
  successTextColor?:    string
  successTitleSize?:    string
  errorBorderColor?:    string
  // ── Tokens exclusivos do modo conversacional (página hospedada full-screen) ──
  pageBgColor?:         string
  questionSize?:        string
  questionWeight?:      string
  questionColor?:       string
}

export const DEFAULT_FORM_STYLING: Required<FormStyling> = {
  primaryColor:          '#1a73e8',
  primaryHoverColor:     '#1557b0',
  buttonTextColor:       '#ffffff',
  backgroundColor:       'transparent',
  labelColor:            '#202124',
  labelSize:             '13px',
  labelWeight:           '600',
  fieldBgColor:          '#ffffff',
  fieldBorderColor:      '#dadce0',
  fieldTextColor:        '#202124',
  fieldPlaceholderColor: '#9aa0a6',
  fieldFontSize:         '14px',
  fieldPadding:          '11px 14px',
  borderRadius:          '8px',
  buttonRadius:          '8px',
  buttonPadding:         '13px',
  buttonFontSize:        '15px',
  buttonFontWeight:      '600',
  fontFamily:            "'Inter', system-ui, sans-serif",
  fontSize:              '14px',
  maxWidth:              '480px',
  fieldSpacing:          '16px',
  successTitleColor:     '#34a853',
  successTextColor:      '#5f6368',
  successTitleSize:      '20px',
  errorBorderColor:      '#c5221f',
  pageBgColor:           '#ffffff',
  questionSize:          '26px',
  questionWeight:        '600',
  questionColor:         '#202124',
}

/** Mescla styling parcial com defaults — devolve sempre todos os tokens preenchidos. */
export function resolveFormStyling(input: unknown): Required<FormStyling> {
  const raw = (input ?? {}) as FormStyling
  return { ...DEFAULT_FORM_STYLING, ...raw }
}

export function useForms() {
  return useQuery({
    queryKey: ['forms'],
    queryFn: () => api.get<{ forms: FormItem[] }>('/forms'),
    staleTime: 60_000,
  })
}

export function useCreateForm() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: FormInput) => api.post<{ ok: true; form: FormItem }>('/forms', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['forms'] }),
  })
}

export function useUpdateForm() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: { id: number } & Partial<FormInput>) =>
      api.put<{ ok: true; form: FormItem }>(`/forms/${id}`, input),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['forms'] })
      void qc.invalidateQueries({ queryKey: ['form', vars.id] })
    },
  })
}

export type FormFieldType =
  | 'text'
  | 'email'
  | 'phone'
  | 'textarea'
  | 'select'
  | 'hidden'
  | 'number'
  | 'url'
  | 'statement'  // bloco de conteúdo (headline+copy+ícone/imagem/HTML) — não coleta dado
  | 'scheduling' // etapa de agendamento inline (escolhe data/hora de um tipo de reunião)

export interface FormFieldOption {
  value: string
  label: string
}

/** Resultado de uma pergunta de qualificação (positivo OU negativo). Define para
 *  onde o lead vai no funil e se o formulário continua ou finaliza ali. */
export interface QualifyOutcome {
  funnelId?: number | null | undefined
  stageKey?: string | null | undefined
  finish?: boolean | undefined                         // finaliza o form ao atingir este resultado
  finishAction?: 'message' | 'redirect' | undefined    // o que fazer ao finalizar
  redirectUrl?: string | null | undefined              // se finishAction='redirect'
  message?: string | null | undefined                  // HTML; vazio → mensagem de sucesso padrão do form
}

export interface FormField {
  id: string
  type: FormFieldType
  key: string
  label: string
  placeholder?: string
  required: boolean
  mapTo?: string | undefined
  options?: FormFieldOption[] | undefined
  defaultValue?: string | undefined
  /** Subtítulo/ajuda exibido abaixo da pergunta (usado sobretudo no modo conversacional). */
  helpText?: string | undefined
  // ── Conteúdo (para type='statement' e enriquecimento de qualquer pergunta) ──
  icon?: string | undefined       // emoji ou caractere (ex.: "👋", "🚀")
  imageUrl?: string | undefined   // URL de imagem exibida no bloco/pergunta
  html?: string | undefined       // HTML livre (admin) renderizado no bloco
  align?: 'left' | 'center' | 'right' | undefined // alinhamento do bloco de conteúdo
  // ── Qualificação (select): marca a pergunta como qualificadora e quais
  //    valores de opção são "positivos" (vão pra etapa A; demais pra etapa B). ──
  isQualifier?: boolean | undefined
  positiveValues?: string[] | undefined
  // Resultados por pergunta: para onde mandar no funil + se finaliza o form.
  // Sem isto, cai no settings.journey.qualifyPositive/Negative global (compat).
  qualifyPositive?: QualifyOutcome | undefined
  qualifyNegative?: QualifyOutcome | undefined
  // ── Campo de agendamento (type='scheduling') ──
  meetingSlug?: string | undefined // slug do MeetingType a embutir
}

/** Modo de exibição do formulário. `classic` = todos os campos numa tela (embed atual);
 *  `conversational` = uma pergunta por vez, tela cheia (estilo Typeform, página hospedada). */
export type FormDisplayMode = 'classic' | 'conversational'

/** IDs de pixel client-side por formulário (separados da config global de Conversões).
 *  Usados apenas na página conversacional hospedada, que é standalone. */
export interface FormPixels {
  metaPixelId?: string | undefined
  metaEventName?: string | undefined        // default "Lead"
  googleConversionId?: string | undefined   // ex.: "AW-123456789"
  googleConversionLabel?: string | undefined
}

/** Opções específicas do modo conversacional. */
export interface FormConversationalSettings {
  showProgress?: boolean | undefined
  welcomeEnabled?: boolean | undefined
  welcomeTitle?: string | undefined
  welcomeText?: string | undefined
  welcomeIcon?: string | undefined          // emoji da capa
  welcomeImageUrl?: string | undefined      // imagem da capa
  startButtonText?: string | undefined      // default "Começar" — CTA da capa
  navButtonText?: string | undefined        // default "OK"
}

export interface FormSettings {
  submitText?: string
  successTitle?: string
  successMessage?: string
  /** Ação ao enviar: 'message' = exibe agradecimento; 'redirect' = vai pra URL. */
  successMode?: 'message' | 'redirect' | undefined
  /** Conteúdo HTML livre da tela de agradecimento (modo 'message'). */
  successHtml?: string | undefined
  redirectUrl?: string | null
  redirectEnabled?: boolean
  /** Layout de renderização. Ausente = 'classic' (compat com forms existentes). */
  displayMode?: FormDisplayMode | undefined
  /** Dispara conversões server-side (Meta CAPI + Google Ads) ao criar o lead.
   *  Ausente = compat: tratado como ligado apenas para forms criados como conversacionais. */
  fireConversions?: boolean | undefined
  pixels?: FormPixels | undefined
  conversational?: FormConversationalSettings | undefined
  journey?: FormJourneySettings | undefined
}

/** Jornada de funil dirigida pelo formulário. Etapa inicial = funnelId/stageKey do
 *  form; etapa ao agendar = do MeetingType. Aqui ficam os destinos da qualificação. */
export interface FormJourneySettings {
  /** Captura parcial: cria o lead ao preencher nome+telefone (default true). */
  partialCapture?: boolean | undefined
  qualifyPositive?: { funnelId?: number | null; stageKey?: string | null } | undefined
  qualifyNegative?: { funnelId?: number | null; stageKey?: string | null } | undefined
}

export interface FormDetail extends FormItem {
  fields: unknown
  settings: FormSettings | null
  styling: FormStyling | null
  notifyEmails: string | null
  webhookUrl: string | null
  defaultTeamId: number | null
}


export function useForm(id: number | null) {
  return useQuery({
    queryKey: ['form', id],
    queryFn: () => api.get<FormDetail>(`/forms/${id}`),
    enabled: id !== null,
    staleTime: 30_000,
  })
}

export function useUpdateFormFields() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, fields }: { id: number; fields: FormField[] }) =>
      api.put<{ ok: true }>(`/forms/${id}`, { fields }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['form', vars.id] })
      void qc.invalidateQueries({ queryKey: ['forms'] })
    },
  })
}

export function useDeleteForm() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/forms/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['forms'] }),
  })
}

// Preview ao vivo do canvas do builder: backend renderiza o HTML (modo edit) com
// os overrides sem persistir; o editor joga o retorno num <iframe srcdoc>.
// Espelha useLandingPagePreview (usePages.ts). Endpoint devolve HTML cru → fetch direto.
export function useFormPreview() {
  return useMutation({
    mutationFn: async (input: { id: number; fields?: FormField[]; settings?: FormSettings; styling?: FormStyling; edit?: boolean }) => {
      const { id, ...overrides } = input
      const token = (() => { try { return localStorage.getItem(env.authTokenKey) } catch { return null } })()
      const res = await fetch(`${env.apiBase}/forms/${id}/preview-html`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(overrides),
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || `HTTP ${res.status}`)
      }
      return res.text()
    },
  })
}

export function useDuplicateForm() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.post<{ ok: true; form: FormItem }>(`/forms/${id}/duplicate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['forms'] }),
  })
}

export function useFormEmbedCode(id: number | null) {
  return useQuery({
    queryKey: ['form-embed', id],
    queryFn: () => api.get<{
      snippet: string
      baseUrl: string
      displayMode: 'classic' | 'conversational'
      hostedUrl: string
      iframeSnippet: string
    }>(`/forms/${id}/embed-code`),
    enabled: id !== null,
    staleTime: 5 * 60_000,
  })
}

export interface FormSubmission {
  id: number
  formId: number
  data: Record<string, unknown>
  leadId: number | null
  pageSlug: string | null
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
  createdAt: string
  lead?: {
    id: number
    nome: string | null
    empresa: string | null
    email: string | null
    whatsapp: string | null
  } | null
}

export function useFormSubmissions(id: number | null, limit = 50) {
  return useQuery({
    queryKey: ['form-submissions', id, limit],
    queryFn: () => api.get<{ submissions: FormSubmission[]; total: number }>(`/forms/${id}/submissions?limit=${limit}`),
    enabled: id !== null,
    staleTime: 30_000,
  })
}
