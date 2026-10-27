import { prisma } from './prisma.js'

export interface BrandingConfig {
  brandName: string
  brandAccent: string
  emailFooter: string
}

const BRANDING_KEYS = [
  'appearance.admin_brand_name',
  'appearance.admin_brand_accent',
  'legal.company_name',
]

let cache: { data: BrandingConfig; ts: number } | null = null
const CACHE_TTL = 60_000 // 1 min

export async function getBranding(): Promise<BrandingConfig> {
  if (cache && Date.now() - cache.ts < CACHE_TTL) return cache.data

  const rows = await prisma.setting.findMany({ where: { key: { in: BRANDING_KEYS } } })
  const cfg: Record<string, string> = {}
  rows.forEach(r => {
    const val = typeof r.value === 'string' ? r.value : String(r.value)
    cfg[r.key] = val.replace(/^"|"$/g, '')
  })

  // Nome do dono da instalação: marca (Aparência) → razão social (Empresa).
  // Sem nenhum dos dois, fica vazio — nunca um nome de outra empresa.
  // trim: espaço salvo no início do nome aparecia em todo assunto de e-mail.
  const brandName = (cfg['appearance.admin_brand_name'] || '').trim() || (cfg['legal.company_name'] || '').trim()
  const brandAccent = cfg['appearance.admin_brand_accent'] || ''

  const data: BrandingConfig = {
    brandName,
    brandAccent,
    emailFooter: [brandName, new Date().toLocaleDateString('pt-BR')].filter(Boolean).join(' · '),
  }

  cache = { data, ts: Date.now() }
  return data
}

/** Invalida o cache (chamar ao salvar appearance) */
export function invalidateBrandingCache(): void {
  cache = null
}
