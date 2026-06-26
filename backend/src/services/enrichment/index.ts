// Orchestrator de enriquecimento — executa providers em sequência,
// persiste fatos e consolida score final no Lead.

import { prisma } from '../../lib/prisma.js'
import { logEvent } from '../leadHistory.js'
import { broadcastRealtimeEvent } from '../../routes/realtime.js'
import { eventBus } from '../../lib/eventBus.js'
import type { LeadSeed, Provider, EnrichmentFact } from './types.js'

import { gravatarProvider } from './providers/gravatar.js'
import { brasilApiProvider } from './providers/brasilApi.js'
import { viacepProvider } from './providers/viacep.js'
import { phoneProvider } from './providers/phone.js'
import { hunterProvider } from './providers/hunter.js'
import { githubProvider } from './providers/github.js'
import { googleProvider } from './providers/google.js'
import { googleCseProvider } from './providers/googleCse.js'
import { socialProvider } from './providers/social.js'
import { phoneIdentityProvider } from './providers/phoneIdentity.js'

interface ProviderEntry { name: string; fn: Provider; tier: 1 | 2 | 3 }

// Tier 1 = APIs estáveis. Tier 2 = APIs free-tier + scraping leve. Tier 3 = scraping pesado (redes sociais).
const REGISTRY: ProviderEntry[] = [
  { name: 'gravatar',  fn: gravatarProvider,  tier: 1 },
  { name: 'brasilapi', fn: brasilApiProvider, tier: 1 },
  { name: 'viacep',    fn: viacepProvider,    tier: 1 },
  { name: 'phone',     fn: phoneProvider,     tier: 1 },
  { name: 'google_cse', fn: googleCseProvider, tier: 2 },  // prioritário (API estável)
  // Identidade do telefone (DICT/PSP) — toggle por Setting; no-op se desativado
  { name: 'phone_identity', fn: phoneIdentityProvider, tier: 2 },
  { name: 'hunter',    fn: hunterProvider,    tier: 2 },
  { name: 'github',    fn: githubProvider,    tier: 2 },
  { name: 'google',    fn: googleProvider,    tier: 2 },   // fallback (scraping DDG/Bing)
  // Tier 3: depende das URLs já descobertas por google/github/gravatar
  { name: 'social',    fn: socialProvider,    tier: 3 },
]

export function registerProvider(entry: ProviderEntry) {
  if (!REGISTRY.find(p => p.name === entry.name)) REGISTRY.push(entry)
}

export interface EnrichOptions {
  maxTier?: 1 | 2 | 3        // limita profundidade (Tier 1 = só APIs estáveis)
  force?: boolean            // ignora cache recente
}

export async function enrichLead(leadId: number, opts: EnrichOptions = {}): Promise<{ factsAdded: number; errors: string[] }> {
  const maxTier = opts.maxTier ?? 3
  const lead = await prisma.lead.findUnique({ where: { id: leadId } })
  if (!lead) throw new Error(`Lead ${leadId} não encontrado`)

  if (!lead.lgpdConsent) {
    await prisma.lead.update({
      where: { id: leadId },
      data: { enrichmentStatus: 'blocked_lgpd', enrichedAt: new Date() },
    })
    return { factsAdded: 0, errors: ['Lead sem consentimento LGPD registrado'] }
  }

  await prisma.lead.update({ where: { id: leadId }, data: { enrichmentStatus: 'running' } })
  broadcastRealtimeEvent({ type: 'lead:enrichment_started', payload: { leadId } })

  const seed: LeadSeed = {
    id: lead.id,
    nome: lead.nome,
    empresa: lead.empresa,
    email: lead.email,
    whatsapp: lead.whatsapp,
    cidade: lead.cidade,
    segmento: lead.segmento,
    formData: lead.formData,
  }

  const allFacts: EnrichmentFact[] = []
  const errors: string[] = []
  const providers = REGISTRY.filter(p => p.tier <= maxTier)
  const totalProviders = providers.length
  let completed = 0

  function emitProgress(name: string) {
    completed++
    broadcastRealtimeEvent({
      type: 'lead:enrichment_progress',
      payload: {
        leadId,
        provider: name,
        index: completed,
        total: totalProviders,
        factsSoFar: allFacts.length,
      },
    })
  }

  // Tier 1 — APIs públicas independentes (Gravatar, BrasilAPI, ViaCEP, Phone).
  // Roda em paralelo: ~1s em vez dos ~5s sequenciais.
  const tier1 = providers.filter(p => p.tier === 1)
  const tier2plus = providers.filter(p => p.tier > 1)

  if (tier1.length > 0) {
    const results = await Promise.allSettled(tier1.map(p => p.fn(seed)))
    for (let i = 0; i < tier1.length; i++) {
      const provider = tier1[i]!
      const r = results[i]!
      if (r.status === 'fulfilled') {
        allFacts.push(...r.value.facts)
        if (r.value.errors) errors.push(...r.value.errors)
      } else {
        errors.push(`${provider.name}: ${(r.reason as Error)?.message ?? r.reason}`)
      }
      emitProgress(provider.name)
    }
  }

  // Tier 2+ — sequencial. Compartilham infraestrutura (Google search, IPs do servidor)
  // e têm mais chance de bater rate limit se chamados em paralelo.
  for (const provider of tier2plus) {
    try {
      const out = await provider.fn(seed)
      allFacts.push(...out.facts)
      if (out.errors) errors.push(...out.errors)
    } catch (err: any) {
      errors.push(`${provider.name}: ${err.message}`)
    }
    emitProgress(provider.name)
    // delay curto entre providers Tier 2+ para ser educado com rate limits públicos
    await new Promise(r => setTimeout(r, 300))
  }

  // Persistir fatos (dedup por leadId+source+field: atualizar se já existe)
  let factsAdded = 0
  for (const fact of allFacts) {
    const existing = await prisma.leadEnrichment.findFirst({
      where: { leadId, source: fact.source, field: fact.field },
    })
    // 'candidate' = descoberta por nome (social) sem âncora de identidade: fica num
    // balde "a verificar", FORA do dossiê/score/promoção (que só leem status 'active').
    const desiredStatus = fact.kind === 'candidate' ? 'candidate' : 'active'
    // Preserva a decisão manual do agente: não revive um fato contestado nem rebaixa
    // um candidato que o agente já confirmou (rawData.confirmed).
    const manual = existing && (existing.status === 'disputed' || (existing.rawData as any)?.confirmed === true)
    const status = manual ? existing!.status : desiredStatus
    const data = {
      value: fact.value.slice(0, 65000),
      confidence: fact.confidence,
      rawData: fact.rawData ?? undefined,
      status,
      fetchedAt: new Date(),
      expiresAt: fact.expiresInDays
        ? new Date(Date.now() + fact.expiresInDays * 24 * 60 * 60 * 1000)
        : null,
    }
    if (existing) {
      await prisma.leadEnrichment.update({ where: { id: existing.id }, data })
    } else {
      await prisma.leadEnrichment.create({ data: { leadId, source: fact.source, field: fact.field, ...data } })
      factsAdded++
    }
  }

  // Score consolidado = média ponderada das confidências dos fatos únicos por field
  const totalFacts = await prisma.leadEnrichment.findMany({ where: { leadId, status: 'active' } })
  const byField = new Map<string, number>()
  for (const f of totalFacts) {
    const prev = byField.get(f.field) ?? 0
    if (f.confidence > prev) byField.set(f.field, f.confidence)
  }
  const avgConf = byField.size ? [...byField.values()].reduce((a, b) => a + b, 0) / byField.size : 0
  const coverageBoost = Math.min(byField.size / 15, 1) // 15+ campos = cobertura plena
  const score = Math.round(((avgConf * 0.7) + (coverageBoost * 0.3)) * 100)

  const status = errors.length && allFacts.length === 0 ? 'failed'
    : errors.length ? 'partial'
    : 'done'

  // Promover campos descobertos para o Lead (só preenche vazios — não sobrescreve dado humano)
  const updateData: any = {
    enrichmentStatus: status,
    enrichmentScore: score,
    enrichedAt: new Date(),
  }
  interface Promotion { field: 'email' | 'empresa' | 'cidade'; oldValue: string | null; newValue: string; source: string; confidence: number }
  const promoted: Promotion[] = []

  if (!lead.email) {
    const emailFact = totalFacts
      .filter(f => f.field === 'email_discovered' && f.confidence >= 0.7)
      .sort((a, b) => b.confidence - a.confidence)[0]
    if (emailFact) {
      updateData.email = emailFact.value
      promoted.push({ field: 'email', oldValue: lead.email || null, newValue: emailFact.value, source: emailFact.source, confidence: emailFact.confidence })
    }
  }

  if (!lead.empresa || lead.empresa === 'Lead Meta' || lead.empresa === lead.nome) {
    const nameFact = totalFacts
      .filter(f => (f.field === 'company_trade_name' || f.field === 'company_legal_name') && f.confidence >= 0.9)
      .sort((a, b) => b.confidence - a.confidence)[0]
    if (nameFact) {
      updateData.empresa = nameFact.value
      promoted.push({ field: 'empresa', oldValue: lead.empresa || null, newValue: nameFact.value, source: nameFact.source, confidence: nameFact.confidence })
    }
  }

  if (!lead.cidade) {
    const cityFact = totalFacts.find(f => f.field === 'company_city' && f.confidence >= 0.9)
    if (cityFact) {
      updateData.cidade = cityFact.value
      promoted.push({ field: 'cidade', oldValue: lead.cidade || null, newValue: cityFact.value, source: cityFact.source, confidence: cityFact.confidence })
    }
  }

  await prisma.lead.update({ where: { id: leadId }, data: updateData })

  const promotedSummary = promoted.map(p => `${p.field}=${p.newValue}`).join(', ')
  logEvent({
    leadId,
    type: 'enrichment_completed',
    category: 'system',
    title: `Enriquecimento ${status} (${factsAdded} novos fatos, score ${score}${promoted.length ? `, promovidos: ${promotedSummary}` : ''})`,
    channel: 'system',
    source: 'enrichment',
    actorType: 'system',
    description: errors.length ? `Erros: ${errors.slice(0, 3).join('; ')}` : undefined,
    metadata: { factsAdded, totalFacts: totalFacts.length, score, errors, promoted },
  })

  broadcastRealtimeEvent({
    type: 'lead:enrichment_completed',
    payload: {
      leadId,
      status,
      score,
      factsAdded,
      totalFacts: totalFacts.length,
      promotedCount: promoted.length,
    },
  })

  // Webhook outbound: dispara dossier consolidado para integrações externas
  // (Make.com, n8n, CRMs). O dispatcher anexa snapshot do lead automaticamente
  // a partir do leadId, então só precisamos passar dados específicos do enrichment.
  try {
    const { buildDossier } = await import('./dossier.js')
    const dossier = await buildDossier(leadId)
    eventBus.emitDomain({
      type: status === 'failed' ? 'enrichment.failed' : 'enrichment.completed',
      leadId,
      payload: {
        status,
        score,
        factsAdded,
        totalFacts: totalFacts.length,
        promoted,
        dossier,
        errors: errors.length ? errors : undefined,
      },
      timestamp: new Date(),
    })
  } catch (err: any) {
    console.error('[enrichment] Falha ao emitir webhook outbound:', err.message)
  }

  return { factsAdded, errors }
}
