// src/services/helpdeskImport.ts
// F26 — Importador Zendesk/Freshdesk. Migra tickets (com thread), organizações,
// Base de Conhecimento (categorias/artigos) e macros de uma exportação/API do
// Zendesk ou Freshdesk para os modelos NATIVOS do helpdesk.
//
// Fluxo: parse<Source>(raw) → Normalized → runImport(normalized, {dryRun}).
// Idempotente por (externalSource, externalId): re-import não duplica.

import { prisma } from '../lib/prisma.js'
import { nextTicketNumber } from './helpdesk.js'

export type ImportSource = 'zendesk' | 'freshdesk'

// ──────────────────────────── Forma normalizada (intermediária) ────────────────────────────

export interface NormalizedComment {
  authorType: 'agent' | 'requester'
  authorName?: string
  body: string
  visibility: 'public' | 'internal'
  createdAt?: string
}
export interface NormalizedTicket {
  externalId: string
  subject: string
  status: string
  priority: string
  type: string
  channel: string
  requesterName?: string
  requesterEmail?: string
  tags?: string[]
  orgExternalId?: string
  createdAt?: string
  solvedAt?: string
  comments: NormalizedComment[]
}
export interface NormalizedOrg { externalId: string; name: string; domains: string[]; notes?: string }
export interface NormalizedKbCategory { externalId: string; name: string; description?: string }
export interface NormalizedKbArticle { externalId: string; categoryExternalId?: string; title: string; body: string; published: boolean; createdAt?: string }
export interface NormalizedMacro { externalId: string; name: string; replyTemplate?: string }

export interface Normalized {
  source: ImportSource
  organizations: NormalizedOrg[]
  tickets: NormalizedTicket[]
  kbCategories: NormalizedKbCategory[]
  kbArticles: NormalizedKbArticle[]
  macros: NormalizedMacro[]
}

const TICKET_STATUSES = new Set(['new', 'open', 'pending', 'on_hold', 'solved', 'closed'])
const TICKET_PRIORITIES = new Set(['low', 'normal', 'high', 'urgent'])
const TICKET_TYPES = new Set(['question', 'incident', 'problem', 'task'])
const TICKET_CHANNELS = new Set(['email', 'web', 'whatsapp', 'chat', 'api', 'phone', 'manual'])

const str = (v: unknown): string => (v == null ? '' : String(v)).trim()
const arr = <T = any>(v: unknown): T[] => (Array.isArray(v) ? v : [])
function slugify(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 200) || 'item'
}
function stripHtml(html: string): string {
  // Decodifica entidades ANTES de remover tags — cobre HTML cru e o entity-encoded
  // que o sistema às vezes salva (&lt;p&gt;…). Senão o excerpt sairia com as tags.
  const decoded = html
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  return decoded.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ').trim()
}

// ──────────────────────────── Adapter: ZENDESK ────────────────────────────

const ZENDESK_STATUS: Record<string, string> = { new: 'new', open: 'open', pending: 'pending', hold: 'on_hold', solved: 'solved', closed: 'closed' }
const ZENDESK_CHANNEL: Record<string, string> = { email: 'email', web: 'web', chat: 'chat', api: 'api', phone_call_inbound: 'phone', phone_call_outbound: 'phone', voice: 'phone', whatsapp: 'whatsapp', sms: 'whatsapp' }

export function parseZendesk(raw: any): Normalized {
  const data = raw || {}
  // Mapas de apoio (usuários e organizações por id).
  const users = new Map<string, any>()
  for (const u of arr(data.users)) users.set(str(u.id), u)

  const organizations: NormalizedOrg[] = arr(data.organizations).map((o: any) => ({
    externalId: str(o.id),
    name: str(o.name) || 'Organização',
    domains: arr<string>(o.domain_names).map(str).filter(Boolean),
    notes: str(o.notes) || undefined,
  }))

  // Comentários podem vir embutidos (ticket.comments) OU num array top-level com ticket_id.
  const commentsByTicket = new Map<string, any[]>()
  for (const c of arr(data.comments)) {
    const tid = str(c.ticket_id)
    if (!tid) continue
    if (!commentsByTicket.has(tid)) commentsByTicket.set(tid, [])
    commentsByTicket.get(tid)!.push(c)
  }

  const tickets: NormalizedTicket[] = arr(data.tickets).map((t: any) => {
    const reqId = str(t.requester_id)
    const requester = users.get(reqId)
    const rawComments = arr(t.comments).length ? arr(t.comments) : (commentsByTicket.get(str(t.id)) ?? [])
    const comments: NormalizedComment[] = rawComments.map((c: any) => {
      const author = users.get(str(c.author_id))
      const isAgent = author && ['agent', 'admin'].includes(str(author.role))
      const bodyText = str(c.body) || stripHtml(str(c.html_body))
      return {
        authorType: isAgent ? 'agent' : 'requester',
        authorName: author ? str(author.name) : undefined,
        body: bodyText,
        // Zendesk: public=false → comentário interno.
        visibility: c.public === false ? 'internal' : 'public',
        createdAt: str(c.created_at) || undefined,
      } as NormalizedComment
    }).filter((c) => c.body)

    // Descrição inicial: se não houver comentários, usa t.description como 1º.
    if (!comments.length && str(t.description)) {
      comments.push({ authorType: 'requester', authorName: requester ? str(requester.name) : undefined, body: str(t.description), visibility: 'public', createdAt: str(t.created_at) || undefined })
    }

    const via = str(t.via?.channel)
    return {
      externalId: str(t.id),
      subject: str(t.subject) || str(t.raw_subject) || '(sem assunto)',
      status: ZENDESK_STATUS[str(t.status)] || 'open',
      priority: TICKET_PRIORITIES.has(str(t.priority)) ? str(t.priority) : 'normal',
      type: TICKET_TYPES.has(str(t.type)) ? str(t.type) : 'question',
      channel: ZENDESK_CHANNEL[via] || 'email',
      requesterName: requester ? str(requester.name) : undefined,
      requesterEmail: requester ? str(requester.email) : (str(t.requester_email) || undefined),
      tags: arr<string>(t.tags).map(str).filter(Boolean),
      orgExternalId: str(t.organization_id) || undefined,
      createdAt: str(t.created_at) || undefined,
      solvedAt: str(t.solved_at) || undefined,
      comments,
    }
  })

  // Help Center: categories / sections / articles. Achamos categoria do artigo
  // via section → category (se houver sections), senão direto category_id.
  const sectionToCategory = new Map<string, string>()
  for (const s of arr(data.sections)) sectionToCategory.set(str(s.id), str(s.category_id))
  const kbCategories: NormalizedKbCategory[] = arr(data.categories).map((c: any) => ({
    externalId: str(c.id), name: str(c.name) || str(c.title) || 'Categoria', description: str(c.description) || undefined,
  }))
  const kbArticles: NormalizedKbArticle[] = arr(data.articles).map((a: any) => {
    let catExt = str(a.category_id)
    if (!catExt && a.section_id != null) catExt = sectionToCategory.get(str(a.section_id)) || ''
    return {
      externalId: str(a.id), categoryExternalId: catExt || undefined,
      title: str(a.title) || str(a.name) || 'Artigo', body: str(a.body) || '',
      published: a.draft === false || str(a.outdated) === 'false' || a.draft === undefined ? a.draft !== true : false,
      createdAt: str(a.created_at) || undefined,
    }
  })

  const macros: NormalizedMacro[] = arr(data.macros).map((m: any) => {
    // Tenta extrair um texto de resposta das ações do macro (comment/side_conversation).
    const commentAction = arr(m.actions).find((ac: any) => str(ac.field) === 'comment_value' || str(ac.field) === 'comment_value_html')
    const replyTemplate = commentAction ? stripHtml(Array.isArray(commentAction.value) ? str(commentAction.value[1]) : str(commentAction.value)) : undefined
    return { externalId: str(m.id), name: str(m.title) || 'Macro', replyTemplate: replyTemplate || undefined }
  })

  return { source: 'zendesk', organizations, tickets, kbCategories, kbArticles, macros }
}

// ──────────────────────────── Adapter: FRESHDESK ────────────────────────────

const FRESHDESK_STATUS: Record<string, string> = { '2': 'open', '3': 'pending', '4': 'solved', '5': 'closed', '6': 'on_hold', '7': 'on_hold' }
const FRESHDESK_PRIORITY: Record<string, string> = { '1': 'low', '2': 'normal', '3': 'high', '4': 'urgent' }
const FRESHDESK_SOURCE: Record<string, string> = { '1': 'email', '2': 'web', '3': 'phone', '7': 'chat', '9': 'chat', '10': 'whatsapp' }

export function parseFreshdesk(raw: any): Normalized {
  const data = raw || {}
  const contacts = new Map<string, any>()
  for (const c of arr(data.contacts)) contacts.set(str(c.id), c)
  const agents = new Map<string, any>()
  for (const a of arr(data.agents)) agents.set(str(a.id), a.contact ? a.contact : a)

  const organizations: NormalizedOrg[] = arr(data.companies).map((c: any) => ({
    externalId: str(c.id), name: str(c.name) || 'Empresa',
    domains: arr<string>(c.domains).map(str).filter(Boolean),
    notes: str(c.note) || undefined,
  }))

  const tickets: NormalizedTicket[] = arr(data.tickets).map((t: any) => {
    const requester = contacts.get(str(t.requester_id))
    const conv = arr(t.conversations)
    const comments: NormalizedComment[] = conv.map((c: any) => {
      const isAgent = c.incoming === false || (c.user_id != null && agents.has(str(c.user_id)))
      const author = agents.get(str(c.user_id)) || contacts.get(str(c.user_id))
      const bodyText = str(c.body_text) || stripHtml(str(c.body))
      return {
        authorType: isAgent ? 'agent' : 'requester',
        authorName: author ? str(author.name) : undefined,
        body: bodyText,
        visibility: c.private === true ? 'internal' : 'public',
        createdAt: str(c.created_at) || undefined,
      } as NormalizedComment
    }).filter((c) => c.body)

    const desc = str(t.description_text) || stripHtml(str(t.description))
    if (desc) {
      comments.unshift({ authorType: 'requester', authorName: requester ? str(requester.name) : undefined, body: desc, visibility: 'public', createdAt: str(t.created_at) || undefined })
    }

    return {
      externalId: str(t.id),
      subject: str(t.subject) || '(sem assunto)',
      status: FRESHDESK_STATUS[str(t.status)] || 'open',
      priority: FRESHDESK_PRIORITY[str(t.priority)] || 'normal',
      type: TICKET_TYPES.has(str(t.type).toLowerCase()) ? str(t.type).toLowerCase() : 'question',
      channel: FRESHDESK_SOURCE[str(t.source)] || 'email',
      requesterName: requester ? str(requester.name) : undefined,
      requesterEmail: requester ? str(requester.email) : (str(t.email) || undefined),
      tags: arr<string>(t.tags).map(str).filter(Boolean),
      orgExternalId: str(t.company_id) || undefined,
      createdAt: str(t.created_at) || undefined,
      solvedAt: ['solved', 'closed'].includes(FRESHDESK_STATUS[str(t.status)] || '') ? (str(t.updated_at) || undefined) : undefined,
      comments,
    }
  })

  // Solution: categories → folders → articles.
  const folderToCategory = new Map<string, string>()
  for (const f of arr(data.folders)) folderToCategory.set(str(f.id), str(f.category_id))
  const kbCategories: NormalizedKbCategory[] = arr(data.categories).map((c: any) => ({
    externalId: str(c.id), name: str(c.name) || 'Categoria', description: str(c.description) || undefined,
  }))
  const kbArticles: NormalizedKbArticle[] = arr(data.articles).map((a: any) => {
    let catExt = str(a.category_id)
    if (!catExt && a.folder_id != null) catExt = folderToCategory.get(str(a.folder_id)) || ''
    return {
      externalId: str(a.id), categoryExternalId: catExt || undefined,
      title: str(a.title) || 'Artigo', body: str(a.description) || stripHtml(str(a.description_text)) || '',
      published: str(a.status) === '2', createdAt: str(a.created_at) || undefined,
    }
  })

  return { source: 'freshdesk', organizations, tickets, kbCategories, kbArticles, macros: [] }
}

export function parseExport(source: ImportSource, raw: any): Normalized {
  return source === 'freshdesk' ? parseFreshdesk(raw) : parseZendesk(raw)
}

/** Contagem do que foi detectado na exportação (p/ a UI exibir antes do import). */
export function importCounts(n: Normalized) {
  return {
    organizations: n.organizations.length,
    tickets: n.tickets.length,
    comments: n.tickets.reduce((s, t) => s + t.comments.length, 0),
    kbCategories: n.kbCategories.length,
    kbArticles: n.kbArticles.length,
    macros: n.macros.length,
  }
}

// ──────────────────────────── Engine de import ────────────────────────────

export interface ImportReport {
  source: ImportSource
  dryRun: boolean
  organizations: { create: number; skip: number }
  kbCategories: { create: number; skip: number }
  kbArticles: { create: number; skip: number }
  macros: { create: number; skip: number }
  tickets: { create: number; skip: number; comments: number }
  errors: string[]
}

const MAX_TICKETS = 5000

function toDate(s?: string): Date | undefined {
  if (!s) return undefined
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? undefined : d
}

/**
 * Executa (ou simula, com dryRun) a importação. Idempotente por
 * (externalSource, externalId). Em dryRun nada é escrito — só conta o que
 * seria criado vs. já existente.
 */
export async function runImport(n: Normalized, opts: { dryRun: boolean }): Promise<ImportReport> {
  const source = n.source
  const dryRun = opts.dryRun
  const report: ImportReport = {
    source, dryRun,
    organizations: { create: 0, skip: 0 },
    kbCategories: { create: 0, skip: 0 },
    kbArticles: { create: 0, skip: 0 },
    macros: { create: 0, skip: 0 },
    tickets: { create: 0, skip: 0, comments: 0 },
    errors: [],
  }

  // Conjunto de externalIds já presentes (idempotência), por entidade.
  const existing = async (table: 'helpdeskTicket' | 'helpdeskOrganization' | 'kbCategory' | 'kbArticle', ids: string[]) => {
    if (!ids.length) return new Set<string>()
    const rows = await (prisma as any)[table].findMany({ where: { externalSource: source, externalId: { in: ids } }, select: { externalId: true } })
    return new Set<string>(rows.map((r: any) => r.externalId))
  }

  // Mapa externalId→dbId p/ vincular filhos (org→ticket, categoria→artigo).
  const orgIdMap = new Map<string, number>()
  const catIdMap = new Map<string, number>()

  // ─── Organizações ───
  {
    const ids = n.organizations.map((o) => o.externalId)
    const have = await existing('helpdeskOrganization', ids)
    // pré-carrega ids já existentes no mapa
    if (have.size) {
      const rows = await prisma.helpdeskOrganization.findMany({ where: { externalSource: source, externalId: { in: [...have] } }, select: { id: true, externalId: true } })
      for (const r of rows) if (r.externalId) orgIdMap.set(r.externalId, r.id)
    }
    for (const o of n.organizations) {
      if (have.has(o.externalId)) { report.organizations.skip++; continue }
      report.organizations.create++
      if (dryRun) continue
      try {
        const created = await prisma.helpdeskOrganization.create({ data: { name: o.name.slice(0, 150), domains: o.domains as any, notes: o.notes ?? null, externalSource: source, externalId: o.externalId } })
        orgIdMap.set(o.externalId, created.id)
      } catch (e) { report.errors.push(`org ${o.externalId}: ${(e as Error).message}`) }
    }
  }

  // ─── KB categorias ───
  {
    const ids = n.kbCategories.map((c) => c.externalId)
    const have = await existing('kbCategory', ids)
    if (have.size) {
      const rows = await prisma.kbCategory.findMany({ where: { externalSource: source, externalId: { in: [...have] } }, select: { id: true, externalId: true } })
      for (const r of rows) if (r.externalId) catIdMap.set(r.externalId, r.id)
    }
    for (const c of n.kbCategories) {
      if (have.has(c.externalId)) { report.kbCategories.skip++; continue }
      report.kbCategories.create++
      if (dryRun) continue
      try {
        const slug = await uniqueSlug('kbCategory', slugify(c.name))
        const created = await prisma.kbCategory.create({ data: { name: c.name.slice(0, 150), slug, description: c.description?.slice(0, 500) ?? null, externalSource: source, externalId: c.externalId } })
        catIdMap.set(c.externalId, created.id)
      } catch (e) { report.errors.push(`kbcat ${c.externalId}: ${(e as Error).message}`) }
    }
  }

  // ─── KB artigos ───
  {
    const ids = n.kbArticles.map((a) => a.externalId)
    const have = await existing('kbArticle', ids)
    for (const a of n.kbArticles) {
      if (have.has(a.externalId)) { report.kbArticles.skip++; continue }
      report.kbArticles.create++
      if (dryRun) continue
      try {
        const slug = await uniqueSlug('kbArticle', slugify(a.title))
        const categoryId = a.categoryExternalId ? (catIdMap.get(a.categoryExternalId) ?? null) : null
        await prisma.kbArticle.create({ data: {
          title: a.title.slice(0, 255), slug, body: a.body || '', categoryId,
          status: a.published ? 'published' : 'draft', publishedAt: a.published ? (toDate(a.createdAt) ?? new Date()) : null,
          excerpt: stripHtml(a.body).slice(0, 300) || null,
          externalSource: source, externalId: a.externalId,
        } })
      } catch (e) { report.errors.push(`kbart ${a.externalId}: ${(e as Error).message}`) }
    }
  }

  // ─── Macros (idempotência por NOME — modelo não tem campos external) ───
  {
    const names = n.macros.map((m) => m.name.slice(0, 120))
    const existRows = names.length ? await prisma.helpdeskMacro.findMany({ where: { name: { in: names } }, select: { name: true } }) : []
    const have = new Set(existRows.map((r) => r.name))
    for (const m of n.macros) {
      const name = m.name.slice(0, 120)
      if (have.has(name)) { report.macros.skip++; continue }
      have.add(name) // evita duplicar dentro do mesmo lote
      report.macros.create++
      if (dryRun) continue
      try {
        await prisma.helpdeskMacro.create({ data: { name, actions: [] as any, replyTemplate: m.replyTemplate ?? null } })
      } catch (e) { report.errors.push(`macro ${m.externalId}: ${(e as Error).message}`) }
    }
  }

  // ─── Tickets (+ thread) ───
  {
    const ticketsToDo = n.tickets.slice(0, MAX_TICKETS)
    if (n.tickets.length > MAX_TICKETS) report.errors.push(`Limite de ${MAX_TICKETS} tickets por importação — ${n.tickets.length - MAX_TICKETS} ignorados.`)
    const ids = ticketsToDo.map((t) => t.externalId)
    const have = await existing('helpdeskTicket', ids)
    for (const t of ticketsToDo) {
      if (have.has(t.externalId)) { report.tickets.skip++; continue }
      report.tickets.create++
      report.tickets.comments += t.comments.length
      if (dryRun) continue
      try {
        const number = await nextTicketNumber()
        const createdAt = toDate(t.createdAt) ?? new Date()
        const organizationId = t.orgExternalId ? (orgIdMap.get(t.orgExternalId) ?? null) : null
        const status = TICKET_STATUSES.has(t.status) ? t.status : 'open'
        const ticket = await prisma.helpdeskTicket.create({ data: {
          number, subject: t.subject.slice(0, 255),
          status, priority: TICKET_PRIORITIES.has(t.priority) ? t.priority : 'normal',
          type: TICKET_TYPES.has(t.type) ? t.type : 'question',
          channel: TICKET_CHANNELS.has(t.channel) ? t.channel : 'email',
          organizationId,
          requesterName: t.requesterName ?? null, requesterEmail: t.requesterEmail ?? null,
          tags: t.tags && t.tags.length ? (t.tags as any) : undefined,
          solvedAt: toDate(t.solvedAt) ?? (['solved', 'closed'].includes(status) ? createdAt : null),
          closedAt: status === 'closed' ? (toDate(t.solvedAt) ?? createdAt) : null,
          firstResponseAt: t.comments.find((c) => c.authorType === 'agent' && c.visibility === 'public') ? createdAt : null,
          lastActivityAt: createdAt,
          createdAt,
          externalSource: source, externalId: t.externalId,
        } })
        if (t.comments.length) {
          await prisma.helpdeskComment.createMany({ data: t.comments.map((c) => ({
            ticketId: ticket.id,
            authorType: c.authorType,
            authorName: c.authorName?.slice(0, 100) ?? null,
            visibility: c.visibility,
            channel: t.channel,
            body: c.body,
            createdAt: toDate(c.createdAt) ?? createdAt,
          })) })
        }
        // Evento de timeline marcando a origem migrada.
        await prisma.helpdeskTicketEvent.create({ data: { ticketId: ticket.id, type: 'imported', title: `Importado do ${source} (#${t.externalId})`, actorType: 'system' } }).catch(() => {})
      } catch (e) { report.errors.push(`ticket ${t.externalId}: ${(e as Error).message}`) }
    }
  }

  return report
}

// ──────────────────────────── Fetch ao vivo (API) ────────────────────────────

export interface ZendeskCreds { subdomain: string; email: string; apiToken: string }
export interface FreshdeskCreds { domain: string; apiKey: string }

const PAGE_CAP = 60 // teto de páginas por recurso (evita varredura infinita)

async function getJson(url: string, auth: string): Promise<any> {
  const res = await fetch(url, { headers: { Authorization: auth, Accept: 'application/json' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url.replace(/\/\/.*@/, '//')}`)
  return res.json()
}

/** Busca uma exportação do Zendesk via API v2 (cursor/offset pagination). */
export async function fetchZendesk(creds: ZendeskCreds): Promise<any> {
  const base = `https://${creds.subdomain}.zendesk.com/api/v2`
  const auth = 'Basic ' + Buffer.from(`${creds.email}/token:${creds.apiToken}`).toString('base64')
  const out: any = { tickets: [], comments: [], users: [], organizations: [], categories: [], sections: [], articles: [], macros: [] }

  // Recursos paginados por offset clássico (?page=).
  const pull = async (path: string, key: string, into: string) => {
    let url: string | null = `${base}/${path}`
    for (let i = 0; i < PAGE_CAP && url; i++) {
      const j: any = await getJson(url, auth)
      for (const it of arr(j[key])) out[into].push(it)
      url = j.next_page || null
    }
  }
  await pull('tickets.json?per_page=100', 'tickets', 'tickets')
  await pull('users.json?per_page=100', 'users', 'users')
  await pull('organizations.json?per_page=100', 'organizations', 'organizations')
  await pull('help_center/categories.json?per_page=100', 'categories', 'categories')
  await pull('help_center/sections.json?per_page=100', 'sections', 'sections')
  await pull('help_center/articles.json?per_page=100', 'articles', 'articles')
  await pull('macros.json?per_page=100', 'macros', 'macros')

  // Comentários: 1 chamada por ticket (cap nos primeiros MAX_TICKETS).
  for (const t of out.tickets.slice(0, MAX_TICKETS)) {
    try {
      const j: any = await getJson(`${base}/tickets/${t.id}/comments.json`, auth)
      for (const c of arr(j.comments)) out.comments.push({ ...c, ticket_id: t.id })
    } catch { /* ignora ticket sem acesso */ }
  }
  return out
}

/** Busca uma exportação do Freshdesk via API v2. */
export async function fetchFreshdesk(creds: FreshdeskCreds): Promise<any> {
  const base = `https://${creds.domain}.freshdesk.com/api/v2`
  const auth = 'Basic ' + Buffer.from(`${creds.apiKey}:X`).toString('base64')
  const out: any = { tickets: [], contacts: [], companies: [], categories: [], folders: [], articles: [], agents: [] }

  const pullPaged = async (path: string, into: string) => {
    for (let page = 1; page <= PAGE_CAP; page++) {
      const sep = path.includes('?') ? '&' : '?'
      const j: any = await getJson(`${base}/${path}${sep}per_page=100&page=${page}`, auth)
      const items = arr(j)
      for (const it of items) out[into].push(it)
      if (items.length < 100) break
    }
  }
  await pullPaged('tickets', 'tickets')
  await pullPaged('contacts', 'contacts')
  await pullPaged('companies', 'companies')
  await pullPaged('agents', 'agents')
  // Conversas por ticket.
  for (const t of out.tickets.slice(0, MAX_TICKETS)) {
    try {
      const conv: any = await getJson(`${base}/tickets/${t.id}/conversations`, auth)
      t.conversations = arr(conv)
    } catch { /* ignora */ }
  }
  // Solutions: categories → folders → articles.
  try {
    const cats: any = await getJson(`${base}/solutions/categories`, auth)
    for (const c of arr(cats)) {
      out.categories.push(c)
      try {
        const folders: any = await getJson(`${base}/solutions/categories/${c.id}/folders`, auth)
        for (const f of arr(folders)) {
          out.folders.push(f)
          try {
            const articles: any = await getJson(`${base}/solutions/folders/${f.id}/articles`, auth)
            for (const a of arr(articles)) out.articles.push(a)
          } catch { /* */ }
        }
      } catch { /* */ }
    }
  } catch { /* KB indisponível */ }
  return out
}

export async function fetchRemote(source: ImportSource, creds: any): Promise<any> {
  return source === 'freshdesk' ? fetchFreshdesk(creds) : fetchZendesk(creds)
}

// Gera slug único acrescentando sufixo numérico quando colide.
async function uniqueSlug(table: 'kbCategory' | 'kbArticle', base: string): Promise<string> {
  let slug = base
  for (let i = 0; i < 50; i++) {
    const hit = await (prisma as any)[table].findUnique({ where: { slug }, select: { id: true } })
    if (!hit) return slug
    slug = `${base}-${i + 2}`
  }
  return `${base}-${Date.now()}`
}
