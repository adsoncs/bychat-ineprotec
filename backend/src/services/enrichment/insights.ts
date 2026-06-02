// Insights heurísticos: lê fatos coletados + dados do Lead e produz chips
// contextuais para o vendedor. Sem IA — só regras e queries auxiliares.

import { prisma } from '../../lib/prisma.js'

export interface Insight {
  id: string
  tone: 'success' | 'info' | 'warning' | 'neutral'
  icon: 'crown' | 'building' | 'users' | 'sparkles' | 'clock' | 'snowflake' | 'link'
  label: string
  detail: string
}

const SENIOR_TITLES = [
  'ceo', 'cto', 'cfo', 'coo', 'cmo', 'cio',
  'sócio', 'socio', 'founder', 'fundador', 'co-founder',
  'diretor', 'diretora', 'director',
  'presidente', 'vice-presidente',
  'head of', 'head de', 'gerente geral',
]

function bestFact(facts: { field: string; value: string; confidence: number }[], field: string): string | undefined {
  const candidates = facts.filter(f => f.field === field)
  if (!candidates.length) return undefined
  return candidates.sort((a, b) => b.confidence - a.confidence)[0]!.value
}

export async function buildInsights(leadId: number): Promise<Insight[]> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true, nome: true, empresa: true, cidade: true, segmento: true,
      createdAt: true, enrichedAt: true, updatedAt: true,
      conversationOpenedAt: true,
    },
  })
  if (!lead) return []

  const facts = await prisma.leadEnrichment.findMany({
    where: { leadId, status: 'active' },
    select: { source: true, field: true, value: true, confidence: true },
  })

  const insights: Insight[] = []

  // 1. Tomador de decisão (cargo sênior detectado)
  const position = (bestFact(facts, 'position') || bestFact(facts, 'job_title') || '').toLowerCase()
  const matchedTitle = SENIOR_TITLES.find(t => position.includes(t))
  if (matchedTitle) {
    insights.push({
      id: 'decision-maker',
      tone: 'success',
      icon: 'crown',
      label: 'Tomador de decisão',
      detail: `Cargo detectado: "${position}". Vale priorizar e tratar como top.`,
    })
  }

  // 2. Empresa estabelecida (CNPJ válido + razão social)
  const cnpj = bestFact(facts, 'cnpj')
  const legalName = bestFact(facts, 'company_legal_name')
  if (cnpj && legalName) {
    insights.push({
      id: 'established-company',
      tone: 'info',
      icon: 'building',
      label: 'Empresa estabelecida',
      detail: `${legalName} · CNPJ ${cnpj}. Pode aplicar fluxo B2B (contrato, NF, faturamento).`,
    })
  }

  // 3. Múltiplos sócios → operação B2B com governança
  const partners = facts.filter(f => f.field === 'company_partner').length
  if (partners >= 2) {
    insights.push({
      id: 'multi-partners',
      tone: 'info',
      icon: 'users',
      label: `${partners} sócios identificados`,
      detail: 'Decisão pode envolver outros stakeholders. Mapeie quem aprova.',
    })
  }

  // 4. Lead muito novo (< 24h) → momento quente
  const ageHours = (Date.now() - new Date(lead.createdAt).getTime()) / 3_600_000
  if (ageHours < 24) {
    insights.push({
      id: 'fresh-lead',
      tone: 'success',
      icon: 'sparkles',
      label: 'Lead recente',
      detail: `Cadastrado há ${Math.round(ageHours)}h — janela ideal para primeiro contato.`,
    })
  }

  // 5. Lead esfriado (sem atividade > 30d, mas já enriquecido)
  const daysSinceActivity = (Date.now() - new Date(lead.updatedAt).getTime()) / 86_400_000
  if (daysSinceActivity > 30 && lead.enrichedAt && !lead.conversationOpenedAt) {
    insights.push({
      id: 'cold-lead',
      tone: 'warning',
      icon: 'snowflake',
      label: 'Lead esfriando',
      detail: `Sem interação há ${Math.round(daysSinceActivity)} dias. Vale uma reabordagem antes de perder.`,
    })
  }

  // 6. Outro lead na mesma empresa (mesmo CNPJ ou nome de empresa idêntico)
  if (cnpj || lead.empresa) {
    const sameCompanyFacts = cnpj
      ? await prisma.leadEnrichment.findMany({
          where: { field: 'cnpj', value: cnpj, status: 'active', leadId: { not: leadId } },
          select: { leadId: true },
          take: 5,
        })
      : []
    const sameCompanyByName = (!cnpj && lead.empresa)
      ? await prisma.lead.findMany({
          where: {
            id: { not: leadId },
            empresa: lead.empresa,
            // ignorar leads "Lead Meta" ou empresa = nome
            NOT: [{ empresa: 'Lead Meta' }, { empresa: lead.nome ?? '' }],
          },
          select: { id: true },
          take: 5,
        })
      : []
    const otherLeadIds = new Set([
      ...sameCompanyFacts.map(f => f.leadId),
      ...sameCompanyByName.map(l => l.id),
    ])
    if (otherLeadIds.size > 0) {
      insights.push({
        id: 'same-company-leads',
        tone: 'warning',
        icon: 'link',
        label: `${otherLeadIds.size} lead(s) na mesma empresa`,
        detail: 'Outros leads cadastrados com mesma empresa/CNPJ. Coordene com o time antes de abordar.',
      })
    }
  }

  return insights
}
