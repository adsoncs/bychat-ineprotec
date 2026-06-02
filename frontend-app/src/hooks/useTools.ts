import { useMutation } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface UrlInspectResponse {
  ok: boolean
  error?: string
  targetUrl: string
  finalUrl: string
  finalStatus: number
  elapsedMs: number
  redirects: Array<{ from: string; to: string; status: number }>
  headers: {
    contentType: string | null
    cacheControl: string | null
    server: string | null
    strictTransport: boolean
  }
  query: Record<string, string>
  utms: Record<string, string | null>
  clickIds: Record<string, string | null>
  seo: {
    title: string | null
    description: string | null
    lang: string | null
    robots: string | null
    viewport: string | null
    canonical: string | null
    themeColor: string | null
  }
  og: {
    title: string | null
    description: string | null
    image: string | null
    type: string | null
    url: string | null
    siteName: string | null
  }
  twitter: {
    card: string | null
    title: string | null
    description: string | null
    image: string | null
  }
  trackers: Array<{ id: string; name: string; pattern: string; ids?: string[] }>
  jsonLd: any[]
}

export function useInspectUrl() {
  return useMutation({
    mutationFn: (url: string) => api.post<UrlInspectResponse>('/admin/tools/url-inspect', { url }),
  })
}
