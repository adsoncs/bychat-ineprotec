import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { env } from '@/lib/env'

export interface LandingPageItem {
  id: number
  slug: string
  title: string
  status: string
  views: number
  submissions: number
  templateId: string | null
  publishedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface PageInput {
  title: string
  slug?: string | undefined
  metaTitle?: string | null | undefined
  metaDescription?: string | null | undefined
  customCss?: string | null | undefined
  customHead?: string | null | undefined
  globalStyles?: LandingPageStyles | null | undefined
  ogImage?: string | null | undefined
  favicon?: string | null | undefined
  trackingEnabled?: boolean | undefined
  conversionEvent?: string | null | undefined
  formId?: number | null | undefined
}

// Tokens visuais da landing page. Mantenha em sincronia com `getDefaultStyles()`
// no backend (`backend/src/routes/pages.ts`) e com `generateCSS` no
// `pageRenderer.ts` — qualquer chave nova precisa estar nos três lugares.
export interface LandingPageStyles {
  // Marca
  logoUrl?:              string
  logoMaxHeight?:        string
  googleFonts?:          string

  // Camada FX (Fase 2): rolagem suave global (Lenis)
  smoothScroll?:         boolean

  // Cores principais
  primaryColor?:         string
  secondaryColor?:       string
  accentColor?:          string
  backgroundColor?:      string

  // Texto
  textColor?:            string
  textMuted?:            string
  headingColor?:         string
  linkColor?:            string
  linkHoverColor?:       string

  // Bordas / cards
  borderColor?:          string
  cardBgColor?:          string
  cardBorderColor?:      string

  // Botão
  buttonBgColor?:        string
  buttonTextColor?:      string
  buttonHoverBgColor?:   string
  buttonRadius?:         string
  buttonPadding?:        string
  buttonFontWeight?:     string
  buttonFontSize?:       string

  // Tipografia
  fontFamily?:           string
  headingFontFamily?:    string
  fontSizeBase?:         string
  fontSizeH1?:           string
  fontSizeH2?:           string
  fontSizeH3?:           string
  fontWeightHeading?:    string
  lineHeightBody?:       string
  lineHeightHeading?:    string

  // Bordas / formato
  borderRadius?:         string

  // Layout
  maxWidth?:             string
  sectionPaddingY?:      string
  containerPaddingX?:    string
  sectionPaddingMobile?: string
}

export const DEFAULT_LANDING_STYLES: Required<LandingPageStyles> = {
  logoUrl:               '',
  logoMaxHeight:         '40px',
  googleFonts:           '',
  smoothScroll:          false,
  primaryColor:          '#1a73e8',
  secondaryColor:        '#202124',
  accentColor:           '#34a853',
  backgroundColor:       '#ffffff',
  textColor:             '#202124',
  textMuted:             '#5f6368',
  headingColor:          '#0b1220',
  linkColor:             '#1a73e8',
  linkHoverColor:        '#1557b0',
  borderColor:           '#e5e7eb',
  cardBgColor:           '#ffffff',
  cardBorderColor:       '#e5e7eb',
  buttonBgColor:         '',
  buttonTextColor:       '#ffffff',
  buttonHoverBgColor:    '',
  buttonRadius:          '',
  buttonPadding:         '14px 32px',
  buttonFontWeight:      '600',
  buttonFontSize:        '16px',
  fontFamily:            "'Inter', 'Segoe UI', system-ui, sans-serif",
  headingFontFamily:     '',
  fontSizeBase:          '16px',
  fontSizeH1:            'clamp(28px, 5vw, 48px)',
  fontSizeH2:            'clamp(24px, 4vw, 36px)',
  fontSizeH3:            'clamp(20px, 3vw, 28px)',
  fontWeightHeading:     '800',
  lineHeightBody:        '1.6',
  lineHeightHeading:     '1.15',
  borderRadius:          '8px',
  maxWidth:              '1140px',
  sectionPaddingY:       '64px',
  containerPaddingX:     '24px',
  sectionPaddingMobile:  '40px',
}

export function resolveLandingStyles(input: unknown): Required<LandingPageStyles> {
  return { ...DEFAULT_LANDING_STYLES, ...((input ?? {}) as LandingPageStyles) }
}

export function usePages() {
  return useQuery({
    queryKey: ['pages'],
    queryFn: () => api.get<{ pages: LandingPageItem[] }>('/pages'),
    staleTime: 60_000,
  })
}

export function useCreatePage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: PageInput) => api.post<{ ok: true; page: LandingPageItem }>('/pages', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pages'] }),
  })
}

export function useUpdatePage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: { id: number } & Partial<PageInput>) =>
      api.put<{ ok: true; page: LandingPageItem }>(`/pages/${id}`, input),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['pages'] })
      void qc.invalidateQueries({ queryKey: ['page', vars.id] })
    },
  })
}

export function usePublishPage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: 'PUBLISHED' | 'DRAFT' | 'ARCHIVED' }) =>
      api.put<{ ok: true; page: LandingPageItem }>(`/pages/${id}/publish`, { status }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['pages'] })
      void qc.invalidateQueries({ queryKey: ['page', vars.id] })
    },
  })
}

export function useDuplicatePage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.post<{ ok: true; page: LandingPageItem }>(`/pages/${id}/duplicate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pages'] }),
  })
}

// Estilo por seção (override visual). Mantenha em sincronia com a função de
// renderização em `backend/src/services/pageRenderer.ts` (renderPage → s.style).
// Campos opcionais aceitam explicitamente `undefined` para suportar
// `exactOptionalPropertyTypes` do TS — facilita "limpar" um override.
export interface PageSectionStyle {
  // Background: solid OU gradient OU image (avaliado em ordem)
  backgroundColor?:    string | undefined
  backgroundImage?:    string | undefined
  gradient?:           boolean | undefined
  gradientFrom?:       string | undefined
  gradientTo?:         string | undefined
  gradientDirection?:  string | undefined  // ex: "135deg" ou "to right"
  overlayColor?:       string | undefined  // só vale com backgroundImage (ex: rgba(0,0,0,.5))

  // Tipografia
  textColor?:          string | undefined
  textAlign?:          'left' | 'center' | 'right' | undefined

  // Spacing/Layout
  padding?:            string | undefined  // ex: "80px 0"
  paddingTop?:         string | undefined
  paddingBottom?:      string | undefined
  maxWidth?:           string | undefined  // centra ao definir
  borderRadius?:       string | undefined
  borderTop?:          string | undefined
  borderBottom?:       string | undefined
  boxShadow?:          string | undefined
  opacity?:            string | number | undefined
  overflow?:           string | undefined

  // Camada FX (Fase 2): animação de entrada + efeito por seção
  animation?:          string | undefined  // fade-up | fade | fade-down | slide-left | slide-right | zoom-in | blur-in
  animDelay?:          string | undefined  // segundos, ex: "0.15"
  effect?:             string | undefined  // none | parallax
}

export interface PageSection {
  id: string
  type: string
  visible: boolean
  props: Record<string, unknown>
  style?: PageSectionStyle
}

export interface LandingPageDetail extends LandingPageItem {
  metaTitle: string | null
  metaDescription: string | null
  customHead: string | null
  customCss: string | null
  ogImage: string | null
  favicon: string | null
  sections: unknown
  globalStyles: LandingPageStyles | null
  formId: number | null
  trackingEnabled: boolean
  conversionEvent: string | null
}

// Hook de preview ao vivo: o backend renderiza HTML em memória usando os
// overrides (sem persistir). O frontend joga o HTML retornado num iframe srcdoc.
export function useLandingPagePreview() {
  return useMutation({
    mutationFn: async (input: { id: number; globalStyles?: LandingPageStyles; customCss?: string | null; customHead?: string | null; sections?: PageSection[]; edit?: boolean }) => {
      const { id, ...overrides } = input
      // O endpoint devolve HTML cru — fetch direto em vez de api.post (que faria JSON.parse).
      const token = (() => { try { return localStorage.getItem(env.authTokenKey) } catch { return null } })()
      const res = await fetch(`${env.apiBase}/pages/${id}/preview-html`, {
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

export function usePage(id: number | null) {
  return useQuery({
    queryKey: ['page', id],
    queryFn: () => api.get<LandingPageDetail>(`/pages/${id}`),
    enabled: id !== null,
    staleTime: 30_000,
  })
}

export function useUpdatePageSections() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, sections }: { id: number; sections: PageSection[] }) =>
      api.put<{ ok: true }>(`/pages/${id}`, { sections }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['page', vars.id] })
      void qc.invalidateQueries({ queryKey: ['pages'] })
    },
  })
}

export function useDeletePage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/pages/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pages'] }),
  })
}

// ── Templates de Landing Page ──────────────────────────────────

export interface PageTemplate {
  id: string
  name: string
  description: string | null
  thumbnailUrl: string | null
  category: string | null
  /** sections que serão clonadas ao criar a partir do template */
  sections: unknown
  globalStyles?: unknown
}

export function usePageTemplates() {
  return useQuery({
    queryKey: ['page-templates'],
    queryFn: () => api.get<{ templates: PageTemplate[] }>('/pages/templates'),
    staleTime: 30 * 60_000,
  })
}

// ── Conversões da página ──────────────────────────────────────

export interface PageConversion {
  id: number
  data: Record<string, unknown>
  leadId: number | null
  lead: {
    id: number
    nome: string | null
    empresa: string | null
    email: string | null
    whatsapp: string | null
    status: string | null
    scores: unknown
  } | null
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
  createdAt: string
}

export function usePageConversions(id: number | null, limit = 50) {
  return useQuery({
    queryKey: ['page-conversions', id, limit],
    queryFn: () => api.get<{ conversions: PageConversion[]; total: number }>(`/pages/${id}/conversions?limit=${limit}`),
    enabled: id !== null,
    staleTime: 30_000,
  })
}

// ── Upload de imagens da página ───────────────────────────────
// O backend salva em /uploads/pages/<id>/<slot>_<ts>.<ext> e devolve a URL.
// O caller decide onde gravar (page.favicon, page.ogImage, globalStyles.logoUrl,
// section.style.backgroundImage…) via PUT /pages/:id ou PUT sections.

export type PageAssetSlot = 'logo' | 'favicon' | 'og' | 'section_bg' | 'image' | 'asset'

export function useUploadPageAsset() {
  return useMutation({
    mutationFn: async ({ id, file, slot = 'asset' }: { id: number; file: File; slot?: PageAssetSlot }) => {
      const fd = new FormData()
      fd.append('slot', slot)
      fd.append('file', file)
      const token = (() => { try { return localStorage.getItem(env.authTokenKey) } catch { return null } })()
      const res = await fetch(`${env.apiBase}/pages/${id}/upload`, {
        method: 'POST',
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: fd,
      })
      const json = await res.json().catch(() => ({})) as { ok?: boolean; url?: string; error?: string }
      if (!res.ok || !json.url) throw new Error(json.error ?? `HTTP ${res.status}`)
      return { url: json.url }
    },
  })
}

export function useDeletePageAsset() {
  return useMutation({
    mutationFn: async ({ id, url }: { id: number; url: string }) => {
      const token = (() => { try { return localStorage.getItem(env.authTokenKey) } catch { return null } })()
      const res = await fetch(`${env.apiBase}/pages/${id}/upload?url=${encodeURIComponent(url)}`, {
        method: 'DELETE',
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || `HTTP ${res.status}`)
      }
      return { ok: true }
    },
  })
}
