// Dossier: consolida fatos do LeadEnrichment em um payload pronto para o vendedor.
// Aplica merge/dedup (melhor confidence por field), agrupa por categoria e gera PDF.
//
// IMPORTANTE: as sugestões de abordagem (iceBreakers) NÃO são geradas aqui.
// Quem cuida disso é services/aiApproachSuggestions.ts (chamada à IA com
// Contexto do Negócio + persona + funil + customFields). Este arquivo só LÊ
// o resultado persistido em Lead.analysis.approachSuggestions e devolve junto
// com a flag de contexto faltante pra UI decidir o que mostrar.

import { prisma } from '../../lib/prisma.js'
import PDFDocument from 'pdfkit'
import { readApproachSuggestions } from '../aiApproachSuggestions.js'

export interface Dossier {
  lead: {
    id: number
    nome: string | null
    empresa: string | null
    email: string | null
    whatsapp: string | null
    cidade: string | null
    segmento: string | null
    enrichmentScore: number | null
    enrichmentStatus: string | null
    enrichedAt: Date | null
  }
  identity: {
    name?: string
    photo_url?: string
    bio?: string
    location?: string
    position?: string
  }
  socials: { platform: string; url: string; title?: string; bio?: string; confidence: number }[]
  // Perfis descobertos por NOME, sem âncora de identidade → "a verificar". Não são
  // tratados como verdade: o agente confirma ou descarta no painel.
  candidates: { id: number; platform: string; url: string; confidence: number; reason?: string; query?: string; title?: string; image?: string }[]
  company: {
    name?: string
    legal_name?: string
    trade_name?: string
    cnpj?: string
    sector?: string
    website?: string
    city?: string
    state?: string
    industry?: string
    partners?: string[]
  }
  contact: {
    phones: { value: string; type?: string; region?: string }[]
    emails: string[]
    addresses: string[]
  }
  iceBreakers: string[]            // sugestões de mensagem geradas por IA (vazio = ainda não gerou)
  approachMissingContext: string[] // se != [] → UI mostra "preencha contexto" em vez do botão Gerar
  approachGeneratedAt: string | null
  approachReason?: string          // ok | company_context_missing | no_api_key | ai_call_failed | ai_parse_failed
  sources: { source: string; fieldsCount: number }[]
  totalFacts: number
}

function pickBest<T>(items: T[], scoreFn: (t: T) => number): T | undefined {
  if (!items.length) return undefined
  return items.reduce((a, b) => scoreFn(a) >= scoreFn(b) ? a : b)
}

export async function buildDossier(leadId: number): Promise<Dossier> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } })
  if (!lead) throw new Error('Lead não encontrado')

  const facts = await prisma.leadEnrichment.findMany({
    where: { leadId, status: 'active' },
    orderBy: { confidence: 'desc' },
  })

  // agrupar por field (pegar o de maior confidence)
  const byField = new Map<string, typeof facts>()
  for (const f of facts) {
    if (!byField.has(f.field)) byField.set(f.field, [])
    byField.get(f.field)!.push(f)
  }
  const best = (field: string) => pickBest(byField.get(field) || [], f => f.confidence)?.value

  // Socials consolidados
  const socialPlatforms = ['linkedin', 'instagram', 'facebook', 'twitter', 'youtube', 'tiktok', 'github', 'lattes']
  const socials: Dossier['socials'] = []
  for (const p of socialPlatforms) {
    const urlFact = pickBest(byField.get(`${p}_url`) || [], f => f.confidence)
    if (!urlFact) continue
    const title = best(`${p}_profile_title`) as string | undefined
    const bio = best(`${p}_profile_bio`) as string | undefined
    socials.push({ platform: p, url: urlFact.value, title, bio, confidence: urlFact.confidence })
  }

  // Candidatos a verificar (status 'candidate') — descobertas por nome com preview.
  const candFacts = await prisma.leadEnrichment.findMany({
    where: { leadId, status: 'candidate' },
    orderBy: { confidence: 'desc' },
  })
  const candByField = new Map<string, typeof candFacts>()
  for (const f of candFacts) {
    if (!candByField.has(f.field)) candByField.set(f.field, [])
    candByField.get(f.field)!.push(f)
  }
  const candidates: Dossier['candidates'] = []
  for (const p of socialPlatforms) {
    const urlFact = pickBest(candByField.get(`${p}_url`) || [], f => f.confidence)
    if (!urlFact) continue
    const raw = (urlFact.rawData ?? {}) as Record<string, any>
    const title = pickBest(candByField.get(`${p}_profile_title`) || [], f => f.confidence)?.value
    const image = pickBest(candByField.get(`${p}_profile_image`) || [], f => f.confidence)?.value
    candidates.push({
      id: urlFact.id, platform: p, url: urlFact.value, confidence: urlFact.confidence,
      reason: raw.corroboration, query: raw.query, title, image,
    })
  }

  // Company
  const partners = (byField.get('company_partner') || []).map(f => {
    try { const o = JSON.parse(f.value); return o.nome || f.value } catch { return f.value }
  })

  // Contact
  const phones: Dossier['contact']['phones'] = []
  const mainPhone = best('phone_e164') as string | undefined
  if (mainPhone) {
    phones.push({
      value: mainPhone,
      type: best('phone_type') as string | undefined,
      region: [best('phone_city_guess'), best('phone_state')].filter(Boolean).join(' / '),
    })
  }
  const companyPhone = best('company_phone') as string | undefined
  if (companyPhone) phones.push({ value: companyPhone, type: 'company' })

  const emails = Array.from(new Set([
    lead.email,
    ...(byField.get('related_email') || []).map(f => {
      try { const o = JSON.parse(f.value); return o.email } catch { return null }
    }).filter(Boolean) as string[],
  ].filter(Boolean) as string[]))

  const addresses: string[] = []
  const street = best('address_street') as string | undefined
  const district = best('address_district') as string | undefined
  const addrCity = best('address_city') as string | undefined
  const addrState = best('address_state') as string | undefined
  if (street || addrCity) {
    addresses.push([street, district, addrCity, addrState].filter(Boolean).join(', '))
  }

  // Posição (mantém pra `identity` abaixo)
  const position = best('position') as string | undefined

  // Sugestões de abordagem: lê o que o serviço aiApproachSuggestions persistiu.
  // Gerar é ação explícita do operador (botão na UI) — aqui só refletimos o estado.
  const approach = await readApproachSuggestions(leadId)

  // Fontes
  const sourcesCount = new Map<string, number>()
  for (const f of facts) sourcesCount.set(f.source, (sourcesCount.get(f.source) || 0) + 1)

  return {
    lead: {
      id: lead.id, nome: lead.nome, empresa: lead.empresa, email: lead.email,
      whatsapp: lead.whatsapp, cidade: lead.cidade, segmento: lead.segmento,
      enrichmentScore: lead.enrichmentScore,
      enrichmentStatus: lead.enrichmentStatus,
      enrichedAt: lead.enrichedAt,
    },
    identity: {
      name: (best('name') as string | undefined) || lead.nome || undefined,
      photo_url: best('photo_url') as string | undefined,
      bio: best('bio') as string | undefined,
      location: (best('location') || best('address_city') || lead.cidade || undefined) as string | undefined,
      position,
    },
    socials,
    candidates,
    company: {
      name: (best('company_name_verified') || best('company_name') || lead.empresa || undefined) as string | undefined,
      legal_name: best('company_legal_name') as string | undefined,
      trade_name: best('company_trade_name') as string | undefined,
      cnpj: best('cnpj') as string | undefined,
      sector: best('company_sector') as string | undefined,
      website: (best('website') || best('company_website_guess') || undefined) as string | undefined,
      city: best('company_city') as string | undefined,
      state: best('company_state') as string | undefined,
      industry: best('company_industry') as string | undefined,
      partners: partners.length ? partners : undefined,
    },
    contact: { phones, emails, addresses },
    iceBreakers: approach?.suggestions ?? [],
    approachMissingContext: approach?.missingContext ?? [],
    approachGeneratedAt: approach?.generatedAt ?? null,
    approachReason: approach?.reason,
    sources: [...sourcesCount.entries()].map(([source, fieldsCount]) => ({ source, fieldsCount })),
    totalFacts: facts.length,
  }
}

export async function renderDossierPdf(dossier: Dossier): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `Dossie ${dossier.lead.nome || dossier.lead.id}`, Author: 'ByChat Beyond' } })
    const chunks: Buffer[] = []
    doc.on('data', c => chunks.push(c as Buffer))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    // Cabeçalho
    doc.fontSize(20).fillColor('#1a73e8').text('Dossie de Lead', { align: 'left' })
    doc.fontSize(10).fillColor('#5f6368').text(`Gerado em ${new Date().toLocaleString('pt-BR')} | Fonte: ByChat Beyond`, { align: 'left' })
    doc.moveDown()

    // Score
    doc.fontSize(14).fillColor('#202124').text(`${dossier.identity.name || dossier.lead.nome || 'Lead ' + dossier.lead.id}`, { continued: false })
    doc.fontSize(10).fillColor('#5f6368').text(`Score de enriquecimento: ${dossier.lead.enrichmentScore ?? '--'}/100 | ${dossier.totalFacts} fatos coletados`)
    doc.moveDown()

    const section = (title: string) => {
      doc.moveDown(0.5)
      doc.fontSize(12).fillColor('#1a73e8').text(title.toUpperCase())
      doc.moveTo(doc.x, doc.y).lineTo(555, doc.y).strokeColor('#d2e3fc').stroke()
      doc.moveDown(0.3)
      doc.fontSize(10).fillColor('#202124')
    }
    const kv = (k: string, v?: string) => {
      if (!v) return
      doc.fontSize(9).fillColor('#5f6368').text(k, { continued: true })
      doc.fillColor('#202124').text('   ' + v)
    }

    section('Identidade')
    kv('Nome', dossier.identity.name)
    kv('Cargo', dossier.identity.position)
    kv('Localizacao', dossier.identity.location)
    if (dossier.identity.bio) {
      doc.fontSize(9).fillColor('#5f6368').text('Bio')
      doc.fontSize(9).fillColor('#202124').text(dossier.identity.bio, { indent: 0 })
    }

    section('Contato')
    dossier.contact.phones.forEach(p => kv('Telefone', `${p.value}${p.type ? ' (' + p.type + ')' : ''}${p.region ? ' - ' + p.region : ''}`))
    dossier.contact.emails.forEach(e => kv('E-mail', e))
    dossier.contact.addresses.forEach(a => kv('Endereco', a))

    section('Empresa')
    kv('Nome', dossier.company.name)
    kv('Razao social', dossier.company.legal_name)
    kv('Nome fantasia', dossier.company.trade_name)
    kv('CNPJ', dossier.company.cnpj)
    kv('Setor / CNAE', dossier.company.sector)
    kv('Industria', dossier.company.industry)
    kv('Site', dossier.company.website)
    kv('Cidade/UF', [dossier.company.city, dossier.company.state].filter(Boolean).join(' / '))
    if (dossier.company.partners?.length) {
      doc.fontSize(9).fillColor('#5f6368').text('Socios')
      dossier.company.partners.forEach(p => doc.fontSize(9).fillColor('#202124').text('  - ' + p))
    }

    if (dossier.socials.length) {
      section('Presenca digital')
      dossier.socials.forEach(s => {
        doc.fontSize(10).fillColor('#1a73e8').text(s.platform.toUpperCase(), { link: s.url, underline: true })
        doc.fontSize(9).fillColor('#202124').text(s.url, { link: s.url })
        if (s.title) doc.fontSize(9).fillColor('#5f6368').text(s.title)
        if (s.bio) doc.fontSize(9).fillColor('#202124').text(s.bio)
        doc.moveDown(0.3)
      })
    }

    if (dossier.iceBreakers.length) {
      section('Sugestoes de abordagem (ice-breakers)')
      dossier.iceBreakers.forEach((ib, i) => {
        doc.fontSize(9).fillColor('#202124').text(`${i + 1}. ${ib}`, { paragraphGap: 4 })
      })
    }

    section('Fontes consultadas')
    dossier.sources.forEach(s => kv(s.source, `${s.fieldsCount} fatos`))

    doc.moveDown()
    doc.fontSize(8).fillColor('#9aa0a6').text(
      'Dados obtidos exclusivamente de fontes publicas com consentimento do titular (LGPD art. 7 IX). ' +
      'Este dossie tem finalidade comercial interna e nao deve ser compartilhado fora da equipe autorizada.',
      { align: 'center' }
    )

    doc.end()
  })
}
