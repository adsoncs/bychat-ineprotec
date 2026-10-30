import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { env } from '@/lib/env'

export type QrKind = 'url' | 'whatsapp' | 'text' | 'vcard' | 'email' | 'sms' | 'tel' | 'wifi'

export interface QrStyle {
  foreground: string
  background: string
  eyeColor: string
  dotStyle: 'square' | 'rounded' | 'dots'
  eyeStyle: 'square' | 'rounded' | 'circle'
  margin: number
  errorCorrection: 'L' | 'M' | 'Q' | 'H'
  logo: string | null
  logoSize: number
  frameText: string | null
  frameColor: string
  frameTextColor: string
}

export const DEFAULT_QR_STYLE: QrStyle = {
  foreground: '#000000',
  background: '#FFFFFF',
  eyeColor: '#000000',
  dotStyle: 'square',
  eyeStyle: 'square',
  margin: 2,
  errorCorrection: 'M',
  logo: null,
  logoSize: 0.22,
  frameText: null,
  frameColor: '#000000',
  frameTextColor: '#FFFFFF',
}

export interface QrCodeItem {
  id: number
  slug: string
  name: string
  description: string | null
  kind: QrKind
  destinationUrl: string | null
  payload: Record<string, any> | null
  style: Partial<QrStyle> | null
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
  utmContent: string | null
  utmTerm: string | null
  folder: string | null
  active: boolean
  expiresAt: string | null
  expiredUrl: string | null
  totalScans: number
  uniqueScans: number
  totalClicks: number
  uniqueClicks: number
  lastAccessAt: string | null
  createdAt: string
  /** Endereço que vai dentro do QR (conta leitura) */
  qrUrl: string
  /** Link curto para colar (conta clique) */
  shortUrl: string
  /** O que está codificado na imagem (Wi-Fi é o conteúdo direto) */
  encodedData: string
}

export interface QrCodeInput {
  name: string
  kind: QrKind
  slug?: string | undefined
  description?: string | null | undefined
  destinationUrl?: string | null | undefined
  payload?: Record<string, any> | null | undefined
  style?: Partial<QrStyle> | undefined
  utmSource?: string | null | undefined
  utmMedium?: string | null | undefined
  utmCampaign?: string | null | undefined
  utmContent?: string | null | undefined
  utmTerm?: string | null | undefined
  folder?: string | null | undefined
  active?: boolean | undefined
  expiresAt?: string | null | undefined
  expiredUrl?: string | null | undefined
}

export interface QrLabelCount { label: string; total: number }
export interface QrDayRow { date: string; via: 'qr' | 'link'; total: number }

export interface QrStats {
  days: number
  scans: number
  uniqueScans: number
  clicks: number
  uniqueClicks: number
  byDay: QrDayRow[]
  byHour: Array<{ hour: number; total: number }>
  byWeekday: Array<{ dow: number; total: number }>
  device: QrLabelCount[]
  os: QrLabelCount[]
  browser: QrLabelCount[]
  country: QrLabelCount[]
  language: QrLabelCount[]
  referer: QrLabelCount[]
}

export interface QrOverview {
  days: number
  totalQrCodes: number
  activeQrCodes: number
  scans: number
  uniqueScans: number
  clicks: number
  uniqueClicks: number
  byDay: QrDayRow[]
  top: Array<{ qrId: number; name: string; slug: string; total: number }>
}

export interface QrAccess {
  id: number
  via: 'qr' | 'link'
  isUnique: boolean
  deviceType: string | null
  browser: string | null
  os: string | null
  language: string | null
  country: string | null
  city: string | null
  referer: string | null
  utmSource: string | null
  utmCampaign: string | null
  createdAt: string
}

const BASE = '/admin/tools/qrcodes'

export function useQrCodes() {
  return useQuery({
    queryKey: ['qrcodes'],
    queryFn: () => api.get<{ qrcodes: QrCodeItem[]; folders: string[] }>(BASE),
    staleTime: 30_000,
  })
}

export function useQrOverview(days: number) {
  return useQuery({
    queryKey: ['qrcodes-overview', days],
    queryFn: () => api.get<QrOverview>(`${BASE}/overview?days=${days}`),
    staleTime: 30_000,
  })
}

export function useQrStats(id: number | null, days: number) {
  return useQuery({
    queryKey: ['qrcode-stats', id, days],
    queryFn: () => api.get<QrStats>(`${BASE}/${id}/stats?days=${days}`),
    enabled: id !== null,
    staleTime: 30_000,
  })
}

export function useQrAccesses(id: number | null, page: number, via: '' | 'qr' | 'link') {
  return useQuery({
    queryKey: ['qrcode-accesses', id, page, via],
    queryFn: () => api.get<{ accesses: QrAccess[]; total: number; page: number; limit: number }>(
      `${BASE}/${id}/accesses?page=${page}&limit=25${via ? `&via=${via}` : ''}`,
    ),
    enabled: id !== null,
    staleTime: 30_000,
  })
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ['qrcodes'] })
  void qc.invalidateQueries({ queryKey: ['qrcodes-overview'] })
}

export function useCreateQrCode() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: QrCodeInput) => api.post<{ ok: true; qrcode: QrCodeItem }>(BASE, input),
    onSuccess: () => invalidateAll(qc),
  })
}

export function useUpdateQrCode() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: { id: number } & Partial<QrCodeInput>) =>
      api.put<{ ok: true; qrcode: QrCodeItem }>(`${BASE}/${id}`, input),
    onSuccess: () => invalidateAll(qc),
  })
}

export function useDeleteQrCode() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`${BASE}/${id}`),
    onSuccess: () => invalidateAll(qc),
  })
}

/**
 * SVG do QR. Não passa pelo `api` porque a resposta é imagem, não JSON.
 * `data` gera de conteúdo livre; sem ele, gera do tipo + slug + payload.
 */
export async function renderQrSvg(body: {
  data?: string; kind?: QrKind; slug?: string; payload?: any; style?: Partial<QrStyle>; size?: number
}): Promise<string> {
  const token = localStorage.getItem(env.authTokenKey) || ''
  const res = await fetch(`${env.apiBase}${BASE}/render`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: token ? `Bearer ${token}` : '' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try { msg = JSON.parse(text).error || msg } catch { /* mantém */ }
    throw new Error(msg)
  }
  return text
}

/** Rasteriza o SVG em PNG no navegador (largura `width`, altura proporcional). */
export async function svgToPngBlob(svg: string, width: number): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    await new Promise<void>((ok, fail) => { img.onload = () => ok(); img.onerror = () => fail(new Error('Falha ao desenhar o QR')); img.src = url })
    const ratio = (img.naturalHeight || img.height) / (img.naturalWidth || img.width) || 1
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = Math.round(width * ratio)
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((ok, fail) => canvas.toBlob(b => (b ? ok(b) : fail(new Error('Falha ao gerar PNG'))), 'image/png'))
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function saveBlob(blob: Blob, filename: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  document.body.appendChild(a)
  a.click()
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 1000)
}

export const KIND_LABEL: Record<QrKind, string> = {
  url: 'Site / URL',
  whatsapp: 'WhatsApp',
  text: 'Texto',
  vcard: 'Cartão de contato',
  email: 'E-mail',
  sms: 'SMS',
  tel: 'Ligação',
  wifi: 'Wi-Fi',
}
