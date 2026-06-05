// src/routes/pages.ts
// Landing Pages — CRUD admin + serving público de páginas renderizadas

import { FastifyInstance } from 'fastify'
import { existsSync, mkdirSync, createWriteStream, unlinkSync } from 'fs'
import { extname, join } from 'path'
import { pipeline } from 'stream/promises'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { prisma } from '../lib/prisma.js'
import { authMiddleware, type JwtPayload } from '../lib/auth.js'
import { moveToTrash, snapshotEntity } from '../services/trash.js'
import { renderPage, render404 } from '../services/pageRenderer.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PAGE_UPLOADS_DIR = join(__dirname, '../../../uploads/pages')

export async function pagesRoutes(app: FastifyInstance) {

  // ══════════════════════════════════════════════
  // PUBLIC — Servir landing page publicada
  // ══════════════════════════════════════════════

  app.get('/p/:slug', async (req, reply) => {
    const { slug } = req.params as any
    // Evitar que paths com extensão sejam tratados como slugs
    if (slug.includes('.')) return reply.code(404).type('text/html').send(render404())

    const isPreview = (req.query as any).preview === 'true'

    const page = await prisma.landingPage.findUnique({ where: { slug } })
    if (!page) return reply.type('text/html').code(404).send(render404())
    if (page.status !== 'PUBLISHED' && !isPreview) return reply.type('text/html').code(404).send(render404())

    // Buscar formulário se vinculado
    let formFields: any[] = []
    let formSettings: any = {}

    // Procurar formId na página ou nas seções
    const sections: any[] = Array.isArray(page.sections) ? page.sections : []
    const formSection = sections.find((s: any) => s.type === 'form' && s.props?.formId)
    const formId = formSection?.props?.formId || page.formId

    if (formId) {
      const form = await prisma.form.findUnique({ where: { id: formId } })
      if (form) {
        formFields = Array.isArray(form.fields) ? form.fields as any[] : []
        formSettings = form.settings as any || {}
      }
    }

    const baseUrl = process.env.APP_URL || `https://${req.hostname}`
    const html = renderPage(page as any, { preview: isPreview, baseUrl }, formFields, formSettings)

    // Incrementar views (async)
    if (!isPreview) {
      prisma.landingPage.update({ where: { id: page.id }, data: { views: { increment: 1 } } }).catch(() => {})
    }

    reply
      .type('text/html')
      .header('Cache-Control', isPreview ? 'no-cache' : 'public, max-age=60, stale-while-revalidate=300')
      .send(html)
  })

  // ══════════════════════════════════════════════
  // ADMIN — CRUD de Landing Pages
  // ══════════════════════════════════════════════

  // ── GET /api/pages ─── Listar ──
  app.get('/api/pages', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const status = q.status || undefined
    const where: any = {}
    if (status) where.status = status

    const pages = await prisma.landingPage.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true, slug: true, title: true, status: true,
        views: true, submissions: true, templateId: true,
        publishedAt: true, createdAt: true, updatedAt: true,
      }
    })
    return { pages }
  })

  // ── GET /api/pages/templates ─── Templates pré-definidos (ANTES de :id!) ──
  app.get('/api/pages/templates', { preHandler: authMiddleware }, async () => {
    return { templates: PAGE_TEMPLATES }
  })

  // ── GET /api/pages/:id ─── Detalhes ──
  app.get('/api/pages/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const page = await prisma.landingPage.findUnique({ where: { id: parseInt(id) } })
    if (!page) return reply.code(404).send({ error: 'Página não encontrada' })
    return page
  })

  // ── POST /api/pages ─── Criar ──
  app.post('/api/pages', { preHandler: authMiddleware }, async (req, reply) => {
    const body = req.body as any
    const user = (req as any).user

    if (!body.title) return reply.code(400).send({ error: 'Título obrigatório' })

    // Gerar slug a partir do título
    let slug = body.slug || body.title
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // Remove acentos
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80)

    // Garantir slug único
    const existing = await prisma.landingPage.findUnique({ where: { slug } })
    if (existing) slug = slug + '-' + Date.now().toString(36)

    const page = await prisma.landingPage.create({
      data: {
        slug,
        title: body.title,
        metaTitle: body.metaTitle || body.title,
        metaDescription: body.metaDescription || null,
        ogImage: body.ogImage || null,
        sections: body.sections || getDefaultSections(),
        globalStyles: body.globalStyles || getDefaultStyles(),
        customCss: body.customCss || null,
        customHead: body.customHead || null,
        status: 'DRAFT',
        templateId: body.templateId || null,
        formId: body.formId || null,
        trackingEnabled: true,
        createdBy: user?.userId || null,
      }
    })

    return reply.code(201).send({ ok: true, page })
  })

  // ── PUT /api/pages/:id ─── Atualizar ──
  app.put('/api/pages/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const body = req.body as any

    const page = await prisma.landingPage.findUnique({ where: { id: parseInt(id) } })
    if (!page) return reply.code(404).send({ error: 'Página não encontrada' })

    const data: any = {}
    if (body.title !== undefined) data.title = body.title
    if (body.slug !== undefined) {
      const normalized = String(body.slug)
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // Remove acentos
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80)
      if (!normalized) return reply.code(400).send({ error: 'Slug inválido' })
      const existing = await prisma.landingPage.findUnique({ where: { slug: normalized } })
      if (existing && existing.id !== page.id) return reply.code(400).send({ error: 'Slug já existe' })
      data.slug = normalized
    }
    if (body.metaTitle !== undefined) data.metaTitle = body.metaTitle
    if (body.metaDescription !== undefined) data.metaDescription = body.metaDescription
    if (body.ogImage !== undefined) data.ogImage = body.ogImage
    if (body.favicon !== undefined) data.favicon = body.favicon
    if (body.sections !== undefined) data.sections = body.sections
    if (body.globalStyles !== undefined) data.globalStyles = body.globalStyles
    if (body.customCss !== undefined) data.customCss = body.customCss
    if (body.customHead !== undefined) data.customHead = body.customHead
    if (body.formId !== undefined) data.formId = body.formId
    if (body.trackingEnabled !== undefined) data.trackingEnabled = body.trackingEnabled
    if (body.conversionEvent !== undefined) data.conversionEvent = body.conversionEvent

    const updated = await prisma.landingPage.update({ where: { id: page.id }, data })
    return { ok: true, page: updated }
  })

  // ── POST /api/pages/:id/upload ─── Upload de imagem (logo/favicon/og/section bg) ──
  // Recebe multipart com `slot` em fieldname (ou query) e file. Retorna { ok, url }.
  // Não persiste a URL na página — o caller decide onde gravar (globalStyles.logoUrl,
  // page.favicon, page.ogImage, sections[i].style.backgroundImage etc.) via PUT.
  app.post('/api/pages/:id/upload', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const pageId = parseInt(id)
    if (!Number.isFinite(pageId)) return reply.code(400).send({ error: 'ID inválido' })

    const page = await prisma.landingPage.findUnique({ where: { id: pageId }, select: { id: true } })
    if (!page) return reply.code(404).send({ error: 'Página não encontrada' })

    const data = await req.file()
    if (!data) return reply.code(400).send({ error: 'Nenhum arquivo enviado' })

    const ext = extname(data.filename).toLowerCase()
    const allowed = ['.png', '.jpg', '.jpeg', '.svg', '.webp', '.gif', '.ico', '.avif']
    if (!allowed.includes(ext)) {
      return reply.code(400).send({ error: 'Formato não suportado. Use: PNG, JPG, SVG, WebP, GIF, ICO ou AVIF' })
    }

    const slot = String((data.fields?.slot as any)?.value || (req.query as any)?.slot || 'asset')
      .replace(/[^a-z0-9_-]/gi, '_')
      .slice(0, 32) || 'asset'

    const pageDir = join(PAGE_UPLOADS_DIR, String(pageId))
    if (!existsSync(pageDir)) mkdirSync(pageDir, { recursive: true })

    const fileName = `${slot}_${Date.now().toString(36)}${ext}`
    const filePath = join(pageDir, fileName)
    await pipeline(data.file, createWriteStream(filePath))

    const url = `/uploads/pages/${pageId}/${fileName}`
    return { ok: true, url }
  })

  // ── DELETE /api/pages/:id/upload ─── Remover imagem por URL ──
  app.delete('/api/pages/:id/upload', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const pageId = parseInt(id)
    const url = String((req.query as any)?.url || '')
    if (!Number.isFinite(pageId) || !url) return reply.code(400).send({ error: 'ID e url são obrigatórios' })

    // Aceita só URLs do próprio diretório dessa página (defensive)
    const expectedPrefix = `/uploads/pages/${pageId}/`
    if (!url.startsWith(expectedPrefix)) {
      return reply.code(400).send({ error: 'URL fora do escopo da página' })
    }
    const fileName = url.slice(expectedPrefix.length)
    if (!fileName || fileName.includes('/') || fileName.includes('\\')) {
      return reply.code(400).send({ error: 'Nome de arquivo inválido' })
    }
    const filePath = join(PAGE_UPLOADS_DIR, String(pageId), fileName)
    try { if (existsSync(filePath)) unlinkSync(filePath) } catch { /* ignore */ }
    return { ok: true }
  })

  // ── POST /api/pages/:id/preview-html ─── Renderiza HTML em memória com overrides ──
  // Usa overrides (globalStyles, customCss, customHead, sections, ogImage, favicon) em
  // memória para gerar o HTML — não persiste nada. Permite preview ao vivo na UI antes
  // de salvar.
  app.post('/api/pages/:id/preview-html', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const pageId = parseInt(id)
    if (!Number.isFinite(pageId)) return reply.code(400).send({ error: 'ID inválido' })

    const stored = await prisma.landingPage.findUnique({ where: { id: pageId } })
    if (!stored) return reply.code(404).send({ error: 'Página não encontrada' })

    const body = (req.body || {}) as any
    const merged: any = { ...stored }
    if (body.globalStyles !== undefined) merged.globalStyles = body.globalStyles
    if (body.customCss !== undefined) merged.customCss = body.customCss
    if (body.customHead !== undefined) merged.customHead = body.customHead
    if (body.sections !== undefined) merged.sections = body.sections
    if (body.ogImage !== undefined) merged.ogImage = body.ogImage
    if (body.favicon !== undefined) merged.favicon = body.favicon
    if (body.metaTitle !== undefined) merged.metaTitle = body.metaTitle
    if (body.metaDescription !== undefined) merged.metaDescription = body.metaDescription

    let formFields: any[] = []
    let formSettings: any = {}
    const sections: any[] = Array.isArray(merged.sections) ? merged.sections : []
    const formSection = sections.find((s: any) => s.type === 'form' && s.props?.formId)
    const formId = formSection?.props?.formId || merged.formId
    if (formId) {
      const form = await prisma.form.findUnique({ where: { id: formId } })
      if (form) {
        formFields = Array.isArray(form.fields) ? form.fields as any[] : []
        formSettings = form.settings as any || {}
      }
    }

    const baseUrl = process.env.APP_URL || `https://${req.hostname}`
    const html = renderPage(merged, { preview: true, edit: body.edit === true, baseUrl }, formFields, formSettings)
    reply
      .type('text/html')
      .header('Cache-Control', 'no-cache')
      .send(html)
  })

  // ── PUT /api/pages/:id/publish ─── Publicar/Despublicar ──
  app.put('/api/pages/:id/publish', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const body = req.body as any
    const status = body.status || 'PUBLISHED' // PUBLISHED, DRAFT, ARCHIVED

    const page = await prisma.landingPage.update({
      where: { id: parseInt(id) },
      data: {
        status,
        publishedAt: status === 'PUBLISHED' ? new Date() : undefined,
      }
    })
    return { ok: true, page }
  })

  // ── POST /api/pages/:id/duplicate ─── Duplicar ──
  app.post('/api/pages/:id/duplicate', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const original = await prisma.landingPage.findUnique({ where: { id: parseInt(id) } })
    if (!original) return reply.code(404).send({ error: 'Página não encontrada' })

    const slug = original.slug + '-copia-' + Date.now().toString(36)
    const copy = await prisma.landingPage.create({
      data: {
        slug,
        title: original.title + ' (Cópia)',
        metaTitle: original.metaTitle,
        metaDescription: original.metaDescription,
        ogImage: original.ogImage,
        sections: original.sections as any,
        globalStyles: original.globalStyles as any || undefined,
        customCss: original.customCss,
        customHead: original.customHead,
        status: 'DRAFT',
        templateId: original.templateId,
        formId: original.formId,
        trackingEnabled: original.trackingEnabled,
        createdBy: (req as any).user?.userId || null,
      }
    })

    return reply.code(201).send({ ok: true, page: copy })
  })

  // ── GET /api/pages/:id/conversions ─── Leads convertidos na LP ──
  app.get('/api/pages/:id/conversions', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const page = await prisma.landingPage.findUnique({ where: { id: parseInt(id) }, select: { slug: true } })
    if (!page) return reply.code(404).send({ error: 'Página não encontrada' })

    const q = req.query as any
    const limit = Math.min(100, parseInt(q.limit) || 50)

    const submissions = await prisma.formSubmission.findMany({
      where: { pageSlug: page.slug },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })

    const leadIds = submissions.filter(s => s.leadId).map(s => s.leadId as number)
    let leadsMap: Record<number, any> = {}
    if (leadIds.length > 0) {
      const leads = await prisma.lead.findMany({
        where: { id: { in: leadIds } },
        select: { id: true, nome: true, empresa: true, email: true, whatsapp: true, status: true, scores: true }
      })
      leadsMap = Object.fromEntries(leads.map(l => [l.id, l]))
    }

    return {
      conversions: submissions.map(s => ({
        id: s.id,
        data: s.data,
        leadId: s.leadId,
        lead: s.leadId ? leadsMap[s.leadId] || null : null,
        utmSource: s.utmSource,
        utmMedium: s.utmMedium,
        utmCampaign: s.utmCampaign,
        createdAt: s.createdAt,
      })),
      total: submissions.length,
    }
  })

  // ── DELETE /api/pages/:id ─── Excluir (move para lixeira) ──
  app.delete('/api/pages/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const user = (req as any).user as JwtPayload
    const snapshot = await snapshotEntity('page', parseInt(id))
    if (snapshot) {
      await moveToTrash({
        entityType: 'page',
        entityId: parseInt(id),
        entityLabel: (snapshot as any).title,
        snapshot,
        deletedBy: user.userId,
        deletedByName: user.name || user.email,
      })
    }
    await prisma.landingPage.delete({ where: { id: parseInt(id) } })
    return { ok: true }
  })

}

// ─── Default sections for new page ───────────────
function getDefaultSections(): any[] {
  return [
    {
      id: 's_hero',
      type: 'hero',
      visible: true,
      props: {
        headline: 'Seu título principal aqui',
        subheadline: 'Uma descrição curta e convincente sobre sua oferta ou serviço.',
        ctaText: 'Começar agora',
        ctaLink: '#form',
        badge: '',
        alignment: 'center',
      }
    },
    {
      id: 's_features',
      type: 'features',
      visible: true,
      props: {
        heading: 'Por que nos escolher?',
        subheading: 'Conheça nossas vantagens',
        items: [
          { icon: '🚀', title: 'Rápido', description: 'Resultados em poucos dias.' },
          { icon: '🎯', title: 'Preciso', description: 'Estratégias baseadas em dados.' },
          { icon: '💡', title: 'Inteligente', description: 'Tecnologia de ponta a seu serviço.' },
        ]
      }
    },
    {
      id: 's_form',
      type: 'form',
      visible: true,
      props: {
        heading: 'Fale conosco',
        subheading: 'Preencha o formulário e entraremos em contato.',
        formId: null,
        layout: 'stacked',
      }
    },
    {
      id: 's_footer',
      type: 'footer',
      visible: true,
      props: {
        text: `© ${new Date().getFullYear()} Sua Empresa. Todos os direitos reservados.`,
      }
    }
  ]
}

// Defaults completos da Landing Page. Mantenha em sincronia com o painel
// `frontend-app/src/components/LandingAppearancePanel.tsx` e com `generateCSS`
// em `backend/src/services/pageRenderer.ts` — qualquer chave nova precisa
// estar nos três lugares.
export function getDefaultStyles(): any {
  return {
    // Marca
    logoUrl:              '',
    logoMaxHeight:        '40px',
    googleFonts:          '',  // ex.: "Inter:400,600,800|Poppins:400,700"

    // Cores principais
    primaryColor:         '#1a73e8',
    secondaryColor:       '#202124',
    accentColor:          '#34a853',
    backgroundColor:      '#ffffff',

    // Texto
    textColor:            '#202124',
    textMuted:            '#5f6368',
    headingColor:         '#0b1220',
    linkColor:            '#1a73e8',
    linkHoverColor:       '#1557b0',

    // Bordas / cards
    borderColor:          '#e5e7eb',
    cardBgColor:          '#ffffff',
    cardBorderColor:      '#e5e7eb',

    // Botão (override do .btn--primary; vazios usam primaryColor)
    buttonBgColor:        '',
    buttonTextColor:      '#ffffff',
    buttonHoverBgColor:   '',
    buttonRadius:         '',
    buttonPadding:        '14px 32px',
    buttonFontWeight:     '600',
    buttonFontSize:       '16px',

    // Tipografia
    fontFamily:           "'Inter', 'Segoe UI', system-ui, sans-serif",
    headingFontFamily:    '',  // vazio = usa fontFamily
    fontSizeBase:         '16px',
    fontSizeH1:           'clamp(28px, 5vw, 48px)',
    fontSizeH2:           'clamp(24px, 4vw, 36px)',
    fontSizeH3:           'clamp(20px, 3vw, 28px)',
    fontWeightHeading:    '800',
    lineHeightBody:       '1.6',
    lineHeightHeading:    '1.15',

    // Bordas / formato
    borderRadius:         '8px',

    // Layout
    maxWidth:             '1140px',
    sectionPaddingY:      '64px',
    containerPaddingX:    '24px',
    sectionPaddingMobile: '40px',
  }
}

// ─── Page Templates ──────────────────────────────

const PAGE_TEMPLATES = [
  {
    id: 'lead_gen',
    name: 'Captação de Leads',
    description: 'Navbar + hero gradiente + benefícios + números + depoimentos + CTA + formulário. Ideal para tráfego pago.',
    thumbnailUrl: null,
    category: 'Aquisição',
    sections: [
      { id: 't0', type: 'navbar', visible: true, props: { brandText: 'Sua Marca', sticky: true, links: [{ label: 'Como funciona', href: '#features' }], ctaText: 'Quero começar', ctaLink: '#form' } },
      { id: 't1', type: 'hero', visible: true, props: { variant: 'gradient', headline: 'Transforme visitantes em clientes', subheadline: 'Descubra como nossa solução pode acelerar o crescimento do seu negócio — sem complicação.', ctaText: 'Quero saber mais', ctaLink: '#form', secondaryCtaText: 'Ver como funciona', secondaryCtaLink: '#features', badge: '✨ Diagnóstico gratuito', alignment: 'center', gradientFrom: '#1a73e8', gradientTo: '#22d3ee' } },
      { id: 't2', type: 'features', visible: true, style: { animation: 'fade-up' }, props: { anchorId: 'features', heading: 'Como funciona', subheading: 'Simples, rápido e eficiente', items: [
        { icon: '1️⃣', title: 'Preencha o formulário', description: 'Leva menos de 1 minuto.' },
        { icon: '2️⃣', title: 'Receba o diagnóstico', description: 'Análise completa do seu negócio.' },
        { icon: '3️⃣', title: 'Implemente as melhorias', description: 'Com nosso suporte especializado.' },
      ] } },
      { id: 't3', type: 'stats', visible: true, style: { animation: 'fade-up' }, props: { background: '#1a73e8', items: [
        { number: '+500', label: 'Clientes atendidos' },
        { number: '98%', label: 'Satisfação' },
        { number: '3x', label: 'Mais leads qualificados' },
        { number: '24h', label: 'Tempo de resposta' },
      ] } },
      { id: 't4', type: 'testimonials', visible: true, props: { heading: 'O que dizem nossos clientes', subheading: 'Resultados reais de quem já passou por aqui', items: [
        { name: 'Maria Silva', role: 'CEO, Empresa X', text: 'Resultado incrível! Dobramos nossas vendas em 3 meses.' },
        { name: 'João Santos', role: 'Diretor, Empresa Y', text: 'A melhor decisão que tomamos. Recomendo para todos.' },
        { name: 'Paula Costa', role: 'Gestora, Empresa Z', text: 'Processo simples e suporte excelente do início ao fim.' },
      ] } },
      { id: 't5', type: 'cta', visible: true, props: { heading: 'Pronto para crescer?', subheading: 'Solicite seu diagnóstico gratuito e descubra oportunidades escondidas no seu negócio.', ctaText: 'Quero meu diagnóstico', ctaLink: '#form', bgColor: '#0b1220' } },
      { id: 't6', type: 'form', visible: true, props: { heading: 'Solicite seu diagnóstico gratuito', subheading: 'Preencha e receba em instantes.', formId: null } },
      { id: 't7', type: 'footer', visible: true, props: { text: '© 2026 Sua Marca. Todos os direitos reservados.' } },
    ],
    globalStyles: { primaryColor: '#1a73e8', smoothScroll: true },
  },
  {
    id: 'webinar',
    name: 'Inscrição Webinar',
    description: 'Navbar + hero gradiente + números do evento + agenda + vídeo + countdown + inscrição.',
    thumbnailUrl: null,
    category: 'Eventos',
    sections: [
      { id: 'w0', type: 'navbar', visible: true, props: { brandText: 'Evento Online', sticky: true, links: [{ label: 'O que você vai aprender', href: '#features' }], ctaText: 'Garantir vaga', ctaLink: '#form' } },
      { id: 'w1', type: 'hero', visible: true, props: { variant: 'gradient', headline: 'Webinar Exclusivo: [Tema]', subheadline: 'Dia XX/XX às XXh. 100% online e gratuito. Vagas limitadas.', ctaText: 'Garantir minha vaga', ctaLink: '#form', badge: '🔴 AO VIVO', alignment: 'center', gradientFrom: '#7b1fa2', gradientTo: '#c2185b' } },
      { id: 'w2', type: 'stats', visible: true, style: { animation: 'fade-up' }, props: { items: [
        { number: 'XX/XX', label: 'Data' },
        { number: 'XXh', label: 'Horário' },
        { number: '90min', label: 'Duração' },
        { number: 'Grátis', label: 'Investimento' },
      ] } },
      { id: 'w3', type: 'features', visible: true, style: { animation: 'fade-up' }, props: { anchorId: 'features', heading: 'O que você vai aprender', items: [
        { icon: '📊', title: 'Estratégias comprovadas', description: 'Técnicas que funcionam na prática.' },
        { icon: '🔑', title: 'Segredos do mercado', description: 'Insights exclusivos de especialistas.' },
        { icon: '🎁', title: 'Material bônus', description: 'Planilhas e templates gratuitos.' },
      ] } },
      { id: 'w4', type: 'video', visible: true, props: { heading: 'Assista ao convite', url: '' } },
      { id: 'w5', type: 'countdown', visible: true, props: { heading: 'Falta pouco para começar', targetDate: '', ctaText: 'Quero participar', ctaLink: '#form' } },
      { id: 'w6', type: 'form', visible: true, props: { heading: 'Inscreva-se agora', subheading: 'Vagas limitadas — garanta a sua!', formId: null } },
      { id: 'w7', type: 'footer', visible: true, props: { text: '© 2026 Evento Online.' } },
    ],
    globalStyles: { primaryColor: '#7b1fa2', smoothScroll: true },
  },
  {
    id: 'product',
    name: 'Lançamento de Produto',
    description: 'Navbar + hero gradiente + features + números + planos + depoimentos + CTA. Para lançar produtos ou serviços.',
    thumbnailUrl: null,
    category: 'Vendas',
    sections: [
      { id: 'p0', type: 'navbar', visible: true, props: { brandText: '[Produto]', sticky: true, links: [{ label: 'Recursos', href: '#features' }, { label: 'Planos', href: '#pricing' }], ctaText: 'Ver planos', ctaLink: '#pricing' } },
      { id: 'p1', type: 'hero', visible: true, props: { variant: 'gradient', headline: 'Apresentamos [Produto]', subheadline: 'A solução definitiva para [problema]. Simples, rápido e feito para escalar.', ctaText: 'Começar agora', ctaLink: '#form', secondaryCtaText: 'Ver planos', secondaryCtaLink: '#pricing', badge: '🚀 Novo', alignment: 'center', gradientFrom: '#0d47a1', gradientTo: '#1976d2' } },
      { id: 'p2', type: 'features', visible: true, style: { animation: 'fade-up' }, props: { anchorId: 'features', heading: 'Funcionalidades', subheading: 'Tudo o que você precisa em um só lugar', items: [
        { icon: '⚡', title: 'Ultra rápido', description: 'Performance otimizada.' },
        { icon: '🔒', title: 'Seguro', description: 'Seus dados protegidos.' },
        { icon: '📱', title: 'Multiplataforma', description: 'Funciona em qualquer dispositivo.' },
        { icon: '🤝', title: 'Suporte dedicado', description: 'Time pronto para ajudar.' },
      ] } },
      { id: 'p3', type: 'stats', visible: true, style: { animation: 'fade-up' }, props: { background: '#0d47a1', items: [
        { number: '+10.000', label: 'Usuários ativos' },
        { number: '4.9/5', label: 'Avaliação média' },
        { number: '99.9%', label: 'Disponibilidade' },
      ] } },
      { id: 'p4', type: 'pricing', visible: true, props: { heading: 'Planos', subheading: 'Escolha o ideal para você', anchorId: 'pricing', items: [
        { name: 'Básico', price: 'R$ 97', period: 'mês', features: ['Feature 1', 'Feature 2', 'Suporte por email'], ctaText: 'Começar', ctaLink: '#form' },
        { name: 'Pro', price: 'R$ 197', period: 'mês', featured: true, badge: 'Popular', features: ['Tudo do Básico', 'Feature 3', 'Feature 4', 'Suporte prioritário'], ctaText: 'Começar', ctaLink: '#form' },
        { name: 'Enterprise', price: 'Sob consulta', features: ['Tudo do Pro', 'Feature 5', 'Atendimento dedicado'], ctaText: 'Falar com vendas', ctaLink: '#form' },
      ] } },
      { id: 'p5', type: 'testimonials', visible: true, props: { heading: 'Quem usa, aprova', items: [
        { name: 'Rafael L.', role: 'CTO', text: 'Implementação rápida e resultado imediato.' },
        { name: 'Bianca M.', role: 'Head de Growth', text: 'Aumentou nossa produtividade de forma absurda.' },
      ] } },
      { id: 'p6', type: 'cta', visible: true, props: { heading: 'Pronto para começar?', subheading: 'Junte-se a milhares de empresas que já transformaram seus resultados.', ctaText: 'Quero testar agora', ctaLink: '#form', bgColor: '#0b1220' } },
      { id: 'p7', type: 'form', visible: true, props: { heading: 'Interessado?', subheading: 'Fale com nosso time.', formId: null } },
      { id: 'p8', type: 'footer', visible: true, props: { text: '© 2026 [Produto].' } },
    ],
    globalStyles: { primaryColor: '#0d47a1', smoothScroll: true },
  },
  {
    id: 'diagnostico',
    name: 'Diagnóstico / Raio-X',
    description: 'Raio-X de Growth — hero gradiente + 5 pilares + números + FAQ + CTA + formulário de diagnóstico.',
    thumbnailUrl: null,
    category: 'Diagnóstico',
    sections: [
      { id: 'd0', type: 'navbar', visible: true, props: { brandText: 'Raio-X de Growth', sticky: true, links: [{ label: 'O que descobre', href: '#features' }], ctaText: 'Fazer diagnóstico', ctaLink: '#form' } },
      { id: 'd1', type: 'hero', visible: true, props: { variant: 'gradient', headline: 'Raio-X de Growth: descubra o que trava seu crescimento', subheadline: 'Diagnóstico gratuito com IA. Receba um relatório completo em minutos.', ctaText: 'Fazer meu diagnóstico', ctaLink: '#form', secondaryCtaText: 'Ver o que analisamos', secondaryCtaLink: '#features', badge: '100% Gratuito', alignment: 'center', gradientFrom: '#d1ae60', gradientTo: '#1a1a2e' } },
      { id: 'd2', type: 'features', visible: true, style: { animation: 'fade-up' }, props: { anchorId: 'features', heading: 'O que você vai descobrir', subheading: 'Análise completa em 5 pilares estratégicos', items: [
        { icon: '📈', title: 'Marketing Digital', description: 'Como está sua presença e estratégia de aquisição.' },
        { icon: '💰', title: 'Vendas', description: 'Eficiência do funil comercial e taxa de conversão.' },
        { icon: '🎯', title: 'Oferta', description: 'Posicionamento e competitividade no mercado.' },
        { icon: '📊', title: 'Dados', description: 'Maturidade analítica e uso de métricas.' },
        { icon: '⚙️', title: 'Processos', description: 'Operação, automações e gargalos.' },
      ] } },
      { id: 'd3', type: 'stats', visible: true, style: { animation: 'fade-up' }, props: { background: '#1a1a2e', items: [
        { number: '+1.200', label: 'Diagnósticos feitos' },
        { number: '5', label: 'Pilares analisados' },
        { number: '3min', label: 'Para preencher' },
        { number: 'Imediato', label: 'Resultado' },
      ] } },
      { id: 'd4', type: 'faq', visible: true, props: { heading: 'Dúvidas frequentes', items: [
        { question: 'Quanto custa?', answer: 'O diagnóstico Raio-X de Growth é 100% gratuito e sem compromisso.' },
        { question: 'Quanto tempo leva?', answer: 'O formulário leva cerca de 3 minutos. O relatório é gerado instantaneamente.' },
        { question: 'Para quem é indicado?', answer: 'Empresas de todos os portes que querem entender onde estão e como crescer.' },
      ] } },
      { id: 'd5', type: 'cta', visible: true, props: { heading: 'Pronto para crescer?', subheading: 'Faça seu diagnóstico agora e descubra oportunidades escondidas.', ctaText: 'Começar diagnóstico', ctaLink: '#form', bgColor: '#1a1a2e' } },
      { id: 'd6', type: 'form', visible: true, props: { heading: 'Preencha para receber seu Raio-X', subheading: 'Dados seguros. Resultado imediato.', formId: null } },
      { id: 'd7', type: 'footer', visible: true, props: { text: '© 2026 Raio-X de Growth.' } },
    ],
    globalStyles: { primaryColor: '#d1ae60', secondaryColor: '#1a1a2e', smoothScroll: true },
  },
  {
    id: 'saas_modern',
    name: 'SaaS Moderno',
    description: 'Navbar fixa, hero gradiente, prova social em marquee, bento, números animados, planos com destaque e CTA fixa. Mostra todos os recursos novos.',
    thumbnailUrl: null,
    category: 'Vendas',
    sections: [
      { id: 'sm0', type: 'navbar', visible: true, props: { brandText: 'Sua Marca', sticky: true, links: [{ label: 'Recursos', href: '#features' }, { label: 'Planos', href: '#pricing' }], ctaText: 'Começar grátis', ctaLink: '#form' } },
      { id: 'sm1', type: 'hero', visible: true, props: { variant: 'gradient', headline: 'A plataforma que faz seu negócio crescer', subheadline: 'Tudo o que você precisa para vender mais, em um só lugar.', ctaText: 'Começar agora', ctaLink: '#form', secondaryCtaText: 'Ver planos', secondaryCtaLink: '#pricing', badge: '✨ Novo', alignment: 'center', gradientFrom: '#6366f1', gradientTo: '#22d3ee' } },
      { id: 'sm2', type: 'logos', visible: true, props: { heading: 'Usado por times de alto desempenho', variant: 'marquee', items: [{ url: '', alt: 'Cliente 1' }, { url: '', alt: 'Cliente 2' }, { url: '', alt: 'Cliente 3' }, { url: '', alt: 'Cliente 4' }, { url: '', alt: 'Cliente 5' }] } },
      { id: 'sm3', type: 'bento', visible: true, style: { animation: 'fade-up' }, props: { heading: 'Feito para escalar', subheading: 'Recursos que crescem com você', anchorId: 'features', items: [
        { icon: '⚡', title: 'Rápido', text: 'Resultados em minutos, não meses.', span: '2' },
        { icon: '🔒', title: 'Seguro', text: 'Criptografia de ponta a ponta.', span: '1' },
        { icon: '🤖', title: 'Automação', text: 'A IA faz o trabalho repetitivo.', span: '1' },
        { icon: '📈', title: 'Analytics', text: 'Decisões guiadas por dados em tempo real.', span: '2' },
      ] } },
      { id: 'sm4', type: 'stats', visible: true, style: { animation: 'fade-up' }, props: { heading: 'Resultados que falam', items: [
        { number: '+12000', label: 'Clientes ativos' }, { number: '98%', label: 'Satisfação' }, { number: '+2500000', label: 'Leads gerados' }, { number: '24/7', label: 'Suporte' },
      ] } },
      { id: 'sm5', type: 'pricing', visible: true, style: { animation: 'fade-up' }, props: { heading: 'Planos simples e transparentes', subheading: 'Cancele quando quiser', anchorId: 'pricing', items: [
        { name: 'Starter', price: 'R$ 49', period: 'mês', features: ['Até 1.000 contatos', '1 usuário', 'Suporte por email'], ctaText: 'Começar', ctaLink: '#form' },
        { name: 'Pro', price: 'R$ 149', period: 'mês', featured: true, badge: 'Mais popular', features: ['Até 25.000 contatos', '5 usuários', 'Automações ilimitadas', 'Suporte prioritário'], ctaText: 'Assinar Pro', ctaLink: '#form' },
        { name: 'Scale', price: 'R$ 399', period: 'mês', features: ['Contatos ilimitados', 'Usuários ilimitados', 'Gerente de conta'], ctaText: 'Falar com vendas', ctaLink: '#form' },
      ] } },
      { id: 'sm6', type: 'faq', visible: true, props: { heading: 'Perguntas frequentes', items: [
        { question: 'Preciso de cartão de crédito?', answer: 'Não. Você começa grátis e só paga quando decidir evoluir.' },
        { question: 'Posso cancelar quando quiser?', answer: 'Sim, a qualquer momento, sem multa.' },
      ] } },
      { id: 'sm7', type: 'form', visible: true, props: { heading: 'Crie sua conta grátis', subheading: 'Leva menos de 1 minuto.', formId: null } },
      { id: 'sm8', type: 'sticky_cta', visible: true, props: { text: 'Comece grátis hoje — sem cartão.', ctaText: 'Quero começar', ctaLink: '#form', position: 'bottom' } },
      { id: 'sm9', type: 'footer', visible: true, props: { text: '' } },
    ],
    globalStyles: { primaryColor: '#6366f1', secondaryColor: '#0f172a', accentColor: '#22d3ee', smoothScroll: true },
  },
  {
    id: 'infoproduct',
    name: 'Infoproduto / Lançamento',
    description: 'Hero dividido, comparativo antes/depois, depoimentos, contagem regressiva e oferta. Para cursos e produtos digitais.',
    thumbnailUrl: null,
    category: 'Vendas',
    sections: [
      { id: 'ip0', type: 'navbar', visible: true, props: { brandText: 'Método X', sticky: true, links: [{ label: 'A oferta', href: '#pricing' }], ctaText: 'Quero entrar', ctaLink: '#form' } },
      { id: 'ip1', type: 'hero', visible: true, props: { variant: 'split', headline: 'Domine [habilidade] em 30 dias', subheadline: 'O passo a passo que já transformou milhares de alunos — mesmo começando do zero.', ctaText: 'Garantir minha vaga', ctaLink: '#form', badge: '🔥 Turma aberta', image: '', imageAlt: 'Mockup do produto', alignment: 'left' } },
      { id: 'ip2', type: 'features', visible: true, style: { animation: 'fade-up' }, props: { heading: 'O que você vai conquistar', items: [
        { icon: '🎯', title: 'Resultados reais', description: 'Aplicação prática desde a primeira aula.' },
        { icon: '📚', title: 'Material completo', description: 'Aulas, planilhas e comunidade.' },
        { icon: '🏆', title: 'Certificado', description: 'Comprove sua nova habilidade.' },
      ] } },
      { id: 'ip3', type: 'before_after', visible: true, style: { animation: 'fade-up' }, props: { heading: 'Veja a transformação', beforeUrl: '', afterUrl: '', beforeLabel: 'Antes', afterLabel: 'Depois' } },
      { id: 'ip4', type: 'testimonials', visible: true, props: { heading: 'Quem já fez, recomenda', items: [
        { name: 'Ana P.', role: 'Aluna', text: 'Mudou minha forma de trabalhar. Valeu cada centavo!' },
        { name: 'Carlos M.', role: 'Aluno', text: 'Didática impecável e suporte de verdade.' },
      ] } },
      { id: 'ip5', type: 'countdown', visible: true, props: { heading: 'As inscrições encerram em breve', targetDate: '', ctaText: 'Quero entrar agora', ctaLink: '#form' } },
      { id: 'ip6', type: 'pricing', visible: true, props: { heading: 'Escolha seu acesso', anchorId: 'pricing', items: [
        { name: 'Essencial', price: 'R$ 297', features: ['Todas as aulas', 'Comunidade', 'Certificado'], ctaText: 'Quero o Essencial', ctaLink: '#form' },
        { name: 'Premium', price: 'R$ 497', featured: true, badge: 'Recomendado', features: ['Tudo do Essencial', 'Mentorias ao vivo', 'Bônus exclusivos'], ctaText: 'Quero o Premium', ctaLink: '#form' },
      ] } },
      { id: 'ip7', type: 'form', visible: true, props: { heading: 'Garanta sua vaga', subheading: 'Vagas limitadas por turma.', formId: null } },
      { id: 'ip8', type: 'footer', visible: true, props: { text: '' } },
    ],
    globalStyles: { primaryColor: '#e11d48', secondaryColor: '#18181b', accentColor: '#fb7185', smoothScroll: true },
  },
  {
    id: 'webinar_premium',
    name: 'Webinar Premium',
    description: 'Hero gradiente, números de autoridade, agenda do evento, contagem regressiva e inscrição. Para eventos online.',
    thumbnailUrl: null,
    category: 'Eventos',
    sections: [
      { id: 'wp0', type: 'navbar', visible: true, props: { brandText: 'Evento Online', sticky: true, links: [{ label: 'Agenda', href: '#features' }], ctaText: 'Inscrever', ctaLink: '#form' } },
      { id: 'wp1', type: 'hero', visible: true, props: { variant: 'gradient', headline: 'Masterclass ao vivo: [Tema]', subheadline: 'Dia XX/XX às XXh. 100% online e gratuito.', ctaText: 'Garantir minha vaga', ctaLink: '#form', badge: '🔴 AO VIVO', alignment: 'center', gradientFrom: '#0ea5e9', gradientTo: '#0c4a6e' } },
      { id: 'wp2', type: 'stats', visible: true, style: { animation: 'fade-up' }, props: { heading: '', items: [
        { number: '+5000', label: 'Inscritos' }, { number: '4.9', label: 'Nota média' }, { number: '90', label: 'Minutos de conteúdo' },
      ] } },
      { id: 'wp3', type: 'features', visible: true, style: { animation: 'fade-up' }, props: { heading: 'O que você vai aprender', anchorId: 'features', items: [
        { icon: '📊', title: 'Estratégias comprovadas', description: 'Técnicas que funcionam na prática.' },
        { icon: '🔑', title: 'Segredos do mercado', description: 'Insights de quem já fez acontecer.' },
        { icon: '🎁', title: 'Material bônus', description: 'Liberado só para inscritos.' },
      ] } },
      { id: 'wp4', type: 'countdown', visible: true, props: { heading: 'Falta pouco para começar', targetDate: '', ctaText: 'Quero participar', ctaLink: '#form' } },
      { id: 'wp5', type: 'form', visible: true, props: { heading: 'Inscreva-se agora', subheading: 'Vagas limitadas — garanta a sua!', formId: null } },
      { id: 'wp6', type: 'footer', visible: true, props: { text: '' } },
    ],
    globalStyles: { primaryColor: '#0ea5e9', secondaryColor: '#0c4a6e', accentColor: '#38bdf8', smoothScroll: true },
  },
]
