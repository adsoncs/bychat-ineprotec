// Tipos compartilhados entre providers de enriquecimento

export interface EnrichmentFact {
  source: string           // gravatar, brasilapi, viacep, phone, google, hunter, github, instagram, facebook, linkedin
  field: string            // photo_url, linkedin_url, cnpj, company_name, address, phone_region, etc.
  value: string            // string normalizada (URLs, JSON stringified se estruturado)
  confidence: number       // 0.0 - 1.0
  rawData?: any            // payload bruto (auditoria)
  expiresInDays?: number   // TTL opcional
}

export interface LeadSeed {
  id: number
  nome?: string | null
  empresa?: string | null
  email?: string | null
  whatsapp?: string | null
  cidade?: string | null
  segmento?: string | null
  formData?: any
}

export interface ProviderResult {
  facts: EnrichmentFact[]
  errors?: string[]
}

export type Provider = (seed: LeadSeed) => Promise<ProviderResult>
