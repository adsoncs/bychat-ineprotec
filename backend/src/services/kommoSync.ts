// src/services/kommoSync.ts
//
// Importador/sincronizador da Kommo CRM → bychat. Orquestrado pela fila
// wf-kommo-sync (ver kommoWorker.ts) em fases encadeadas, com self-continuation
// por página (resiliente a jobs longos):
//
//   metadata → contacts(páginas) → leads(páginas) → notes(páginas) → tasks(páginas) → fim
//
// Idempotência: todo vínculo Kommo↔bychat passa por KommoMapping (upsert).
// Modo incremental usa filter[updated_at][from] = last_sync_at.
//
// Decisões (ver memória project-bychat-kommo-integration):
//  - 6 pipelines → Funnels; status → Stages (key=kommo_<id>, Lead.status=key).
//  - contato principal do lead fornece whatsapp/email (Lead exige ambos).
//  - dono (responsible_user_id) → custom field 'kommo_responsavel' (NÃO cria User).
//  - tags/notas/tarefas/custom fields importados.

import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { prisma } from '../lib/prisma.js'
import { getKommoConfig, kommoFetch, kommoPaginate, type KommoConfig } from '../lib/kommoClient.js'
import { generateUid } from './dedup.js'
import { displayPhone } from '../lib/phone.js'
import { logEvent, EVENT_TYPES } from './leadHistory.js'

// ─────────────────────────────────────────────────────────────
// Origem (canal) do lead a partir do `source_id` da Kommo.
//
// A conta da Kommo não expõe a entidade Sources (pertence a outros apps
// instalados), então o nome do canal não vem pela API — só o id numérico.
// De-para levantado junto ao cliente (ineprotec): estes 3 ids são o
// formulário do site; TODO o resto (inclusive o import em massa de 19/04)
// é WhatsApp. `Lead.source` recebe a chave canônica ('web_form'/'whatsapp')
// para casar com o taxonômico nativo (leadSourceLabel) e entrar em
// filtros/relatórios como qualquer lead. A proveniência Kommo continua em
// formData.source='kommo' e qualificationSource='kommo_import'.
const KOMMO_FORM_SOURCE_IDS = new Set(['23057764', '23058034', '23063755'])

export function kommoSourceToChannel(sourceId: unknown): string {
  return KOMMO_FORM_SOURCE_IDS.has(String(sourceId)) ? 'web_form' : 'whatsapp'
}

/**
 * Garante um User do bychat para um usuário da Kommo (idempotente por email).
 * Criado como AGENT ativo, mas SEM login: passwordHash aleatório que ninguém
 * conhece — o operador define a senha depois via recuperação. Retorna o id local.
 */
async function ensureUserForKommo(u: any): Promise<number> {
  const rawEmail = u?.email && String(u.email).trim() ? String(u.email).trim().toLowerCase() : ''
  const email = rawEmail || `kommo-user-${u.id}@kommo.local`
  const name = String(u?.name || email).substring(0, 191)
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } })
  if (existing) return existing.id
  const passwordHash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10)
  const created = await prisma.user.create({
    data: { email, name, role: 'AGENT', active: true, passwordHash, isAgent: true },
  })
  return created.id
}

// ─────────────────────────────────────────────────────────────
// Mapping helpers (KommoMapping)
// ─────────────────────────────────────────────────────────────

type EntityType = 'lead' | 'contact' | 'pipeline' | 'status' | 'tag' | 'note' | 'task' | 'custom_field' | 'user' | 'chat_template' | 'catalog' | 'catalog_element'

async function setMapping(entityType: EntityType, kommoId: string | number, localId: number, meta?: any): Promise<void> {
  const kid = String(kommoId)
  await prisma.kommoMapping.upsert({
    where: { entityType_kommoId: { entityType, kommoId: kid } },
    create: { entityType, kommoId: kid, localId, meta: meta ?? undefined },
    update: { localId, meta: meta ?? undefined },
  })
}

async function loadMappingDict(entityType: EntityType): Promise<Map<string, { localId: number; meta: any }>> {
  const rows = await prisma.kommoMapping.findMany({ where: { entityType }, select: { kommoId: true, localId: true, meta: true } })
  return new Map(rows.map((r) => [r.kommoId, { localId: r.localId, meta: r.meta as any }]))
}

// ─────────────────────────────────────────────────────────────
// Utilitários
// ─────────────────────────────────────────────────────────────

/** Nome da empresa derivado do prefixo do pipeline (INEP→INEPROTEC, MAT→MatriculaEAD). */
function empresaFromPipeline(pipelineName: string): string {
  const n = (pipelineName || '').toUpperCase()
  if (n.startsWith('INEP')) return 'INEPROTEC'
  if (n.startsWith('MAT')) return 'MatriculaEAD'
  return pipelineName || 'Kommo'
}

/** Mapeia o tipo de custom field da Kommo → tipo do CustomField do bychat. */
function mapFieldType(kommoType: string): string {
  switch (kommoType) {
    case 'numeric': return 'number'
    case 'select': return 'select'
    case 'multiselect': return 'multiselect'
    case 'date':
    case 'date_time':
    case 'birthday': return 'date'
    case 'url': return 'url'
    case 'checkbox': return 'checkbox'
    case 'textarea': return 'textarea'
    case 'multitext':
    case 'text':
    case 'tracking_data':
    case 'chained_list':
    default: return 'text'
  }
}

/** Dicionário de elementos de catálogo (id Kommo → meta) usado para resolver
 * campos `chained_list`. Ver `importCatalogs`. */
type CatalogDict = Map<string, { localId: number; meta: any }>

// ─────────────────────────────────────────────────────────────
// Tracking: campos `tracking_data` da Kommo → colunas nativas do Lead
//
// Os UTMs sempre foram importados, mas só como custom field opaco
// (`customFields.kommo_1110434`). A atribuição do bychat — relatórios de
// origem, enriquecimento por gclid, conversões do Google Ads — lê as COLUNAS
// (`Lead.utmSource`, `Lead.gclid`), então o dado existia e mesmo assim não
// aparecia em lugar nenhum.
//
// O de-para é pelo `field_code` da Kommo (UTM_SOURCE, GCLID…), não pelo id nem
// pelo nome: o code é padronizado pela própria Kommo e sobrevive à troca de
// conta, ao contrário de `kommo_1110434`.
// ─────────────────────────────────────────────────────────────

const TRACKING_BY_CODE: Record<string, { field: string; max: number }> = {
  UTM_SOURCE:   { field: 'utmSource',   max: 100 },
  UTM_MEDIUM:   { field: 'utmMedium',   max: 100 },
  UTM_CAMPAIGN: { field: 'utmCampaign', max: 191 },
  UTM_CONTENT:  { field: 'utmContent',  max: 191 },
  UTM_TERM:     { field: 'utmTerm',     max: 191 },
  GCLID:        { field: 'gclid',       max: 191 },
  FBCLID:       { field: 'fbclid',      max: 255 },
}

/** Colunas de tracking que o import pode preencher (usado também pelo backfill). */
export const TRACKING_FIELDS = Object.values(TRACKING_BY_CODE).map((t) => t.field)

/**
 * Extrai as colunas de tracking de um lead da Kommo. `cfMap` é o dicionário de
 * custom fields (field_id → meta com `code`).
 */
export function extractTrackingColumns(
  customFieldsValues: any[],
  cfMap: Map<string, { localId: number; meta: any }>,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const fv of customFieldsValues ?? []) {
    const code = String(fv?.field_code || cfMap.get(String(fv.field_id))?.meta?.code || '').toUpperCase()
    const target = TRACKING_BY_CODE[code]
    if (!target) continue
    const val = extractCfValue(fv.values)
    if (val == null) continue
    const s = String(Array.isArray(val) ? val[0] : val).trim()
    if (s) out[target.field] = s.substring(0, target.max)
  }
  return out
}

/**
 * Extrai um valor simples de um custom_fields_values[].values da Kommo.
 *
 * Campos do tipo `chained_list` (na conta ineprotec: "Curso de Interesse 1/2/3")
 * NÃO trazem `value` — trazem `{catalog_id, catalog_element_id}`, uma referência
 * ao catálogo de Produtos. Sem resolver o id contra o catálogo, o valor se perdia
 * silenciosamente (o filtro por `v.value` descartava tudo). `catalogs` é o
 * dicionário de elementos importado por `importCatalogs`; sem ele, guardamos ao
 * menos `#<id>` para não perder a informação.
 */
function extractCfValue(values: any[], catalogs?: CatalogDict): any {
  if (!Array.isArray(values) || values.length === 0) return null
  const out: any[] = []
  for (const v of values) {
    if (v == null) continue
    if (v.catalog_element_id != null) {
      const el = catalogs?.get(String(v.catalog_element_id))
      out.push(el?.meta?.name ?? `#${v.catalog_element_id}`)
      continue
    }
    const raw = v?.value
    if (raw === undefined || raw === null || raw === '') continue
    out.push(typeof raw === 'object' ? JSON.stringify(raw) : raw)
  }
  if (out.length === 0) return null
  return out.length === 1 ? out[0] : out
}

/** Primeiro `catalog_element_id` referenciado pelos custom fields de um lead.
 * Quando há mais de um (Curso 1/2/3), vence o campo de menor nome — "Curso de
 * Interesse 1" < "2" < "3" —, que é o curso principal do lead. */
function primaryCatalogElementId(customFieldsValues: any[]): number | null {
  const refs: Array<{ name: string; id: number }> = []
  for (const fv of customFieldsValues ?? []) {
    for (const v of fv?.values ?? []) {
      if (v?.catalog_element_id != null) refs.push({ name: String(fv.field_name || ''), id: Number(v.catalog_element_id) })
    }
  }
  if (refs.length === 0) return null
  refs.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  return refs[0].id
}

const unix = (sec?: number | null): Date | null => (sec ? new Date(sec * 1000) : null)

/** Converte variáveis de template da Kommo ({{lead.name}}) para o formato do
 * bychat ({{nome}}). Mantém as demais como estão (o operador ajusta). */
function convertKommoVars(s: string): string {
  return String(s || '')
    .replace(/\{\{\s*lead\.name\s*\}\}/gi, '{{nome}}')
    .replace(/\{\{\s*contact\.name\s*\}\}/gi, '{{nome}}')
    .replace(/\{\{\s*lead\.first_name\s*\}\}/gi, '{{nome}}')
}

/** Importa os templates de mensagem de chat da Kommo → MessageTemplate (canal
 * whatsapp). Os Salesbots/automações da Kommo NÃO são expostos pela API, então
 * os templates são o aproveitável. Idempotente via KommoMapping('chat_template'). */
export async function importTemplates(cfg?: KommoConfig): Promise<{ templates: number }> {
  const config = cfg ?? (await getKommoConfig(true))
  const tplMap = await loadMappingDict('chat_template')
  let templates = 0
  for await (const batch of kommoPaginate('chats/templates', '', config, 'chat_templates')) {
    for (const t of batch) {
      const body = convertKommoVars(String(t.content || ''))
      if (!body.trim()) continue
      const name = (t.name || `Template Kommo ${t.id}`).substring(0, 191)
      const existing = tplMap.get(String(t.id))
      if (existing) {
        await prisma.messageTemplate.update({ where: { id: existing.localId }, data: { name, body } }).catch(() => {})
      } else {
        const created = await prisma.messageTemplate.create({
          data: { name, channel: 'whatsapp', category: 'general', body, active: true },
        })
        await setMapping('chat_template', t.id, created.id, { name })
      }
      templates++
    }
  }
  return { templates }
}

// ─────────────────────────────────────────────────────────────
// Catálogos (listas de produtos/serviços da Kommo)
// ─────────────────────────────────────────────────────────────

/** Atributos úteis de um elemento de catálogo (preço, grupo, escola).
 * Os campos são livres por conta; identificamos por `field_code` e, na falta
 * dele (ESCOLA não tem code), pelo nome do campo. */
function catalogElementAttrs(el: any): { price: number | null; group: string | null; escola: string | null } {
  let price: number | null = null
  let group: string | null = null
  let escola: string | null = null
  for (const fv of el?.custom_fields_values ?? []) {
    const code = String(fv?.field_code || '').toUpperCase()
    const name = String(fv?.field_name || '').toUpperCase()
    const val = extractCfValue(fv?.values)
    if (val == null) continue
    const first = Array.isArray(val) ? val[0] : val
    if (price == null && (code === 'PRICE' || code === 'WHOLESALE_PRICE' || fv?.field_type === 'price')) {
      const n = Number(String(first).replace(/[^\d.,-]/g, '').replace(',', '.'))
      if (Number.isFinite(n)) price = n
    } else if (!group && (code === 'GROUP' || fv?.field_type === 'category')) {
      group = String(first).substring(0, 191)
    } else if (!escola && name.includes('ESCOLA')) {
      escola = String(first).substring(0, 191)
    }
  }
  return { price, group, escola }
}

/**
 * Importa os catálogos da Kommo e seus elementos para o KommoMapping. Os
 * elementos não viram entidade local (localId=0) — servem de dicionário para
 * traduzir os campos `chained_list` dos leads (ex: "Curso de Interesse") de
 * `catalog_element_id` para o nome do produto, mais preço/grupo/escola.
 */
export async function importCatalogs(cfg?: KommoConfig): Promise<{ catalogs: number; elements: number }> {
  const config = cfg ?? (await getKommoConfig(true))
  let catalogs = 0, elements = 0
  const data = await kommoFetch('/catalogs?limit=250', config)
  const list: any[] = data?._embedded?.catalogs ?? []
  for (const cat of list) {
    await setMapping('catalog', cat.id, 0, { name: cat.name, type: cat.type })
    catalogs++
    for await (const batch of kommoPaginate(`catalogs/${cat.id}/elements`, '', config, 'elements')) {
      for (const el of batch) {
        const attrs = catalogElementAttrs(el)
        await setMapping('catalog_element', el.id, 0, {
          name: String(el.name || `#${el.id}`).substring(0, 191),
          catalogId: cat.id,
          catalogName: cat.name,
          catalogType: cat.type, // 'products' vira Product local; 'regular' é só dicionário
          ...attrs,
        })
        elements++
      }
    }
  }
  return { catalogs, elements }
}

/**
 * Espelha os elementos do catálogo de produtos da Kommo no catálogo local
 * (Product), que é a fonte dos itens de uma Negociação. Idempotente por
 * `sku = kommo-<elementId>`: reimportar atualiza nome/preço em vez de duplicar.
 *
 * Só o catálogo de tipo `products` vira Product — os demais (listas auxiliares)
 * continuam servindo apenas de dicionário para os campos `chained_list`.
 */
export async function syncCatalogProducts(): Promise<{ created: number; updated: number }> {
  const rows = await prisma.kommoMapping.findMany({ where: { entityType: 'catalog_element' }, select: { kommoId: true, meta: true } })
  let created = 0, updated = 0
  for (const r of rows) {
    const m = r.meta as any
    if (!m?.name || m?.catalogType === 'regular') continue
    const sku = `kommo-${r.kommoId}`
    const data = {
      categoria: String(m.group || m.catalogName || 'Cursos').substring(0, 100),
      nome: String(m.name).substring(0, 191),
      preco: m.price != null ? m.price : null,
      marca: m.escola ? String(m.escola).substring(0, 100) : null,
      active: true,
      disponivel: true,
    }
    const existing = await prisma.product.findFirst({ where: { sku }, select: { id: true } })
    if (existing) {
      await prisma.product.update({ where: { id: existing.id }, data })
      updated++
    } else {
      await prisma.product.create({ data: { ...data, sku } })
      created++
    }
  }
  return { created, updated }
}

/**
 * CustomFields que não existem na Kommo — são derivados pelo import e precisam
 * existir para aparecer na aba "Campos" do lead. Os três de curso vêm do
 * elemento de catálogo do "Curso de Interesse 1": o campo da Kommo guarda só o
 * nome do curso, e valor/escola/grupo é o que permite segmentar a base.
 * Idempotente — chamado pelo importMetadata e pelo backfill.
 */
export async function ensureKommoAuxFields(): Promise<void> {
  for (const [key, label, type] of [
    ['kommo_responsavel', 'Responsável (Kommo)', 'text'],
    ['kommo_pipeline', 'Funil de origem (Kommo)', 'text'],
    ['kommo_curso_valor', 'Valor do curso (Kommo)', 'number'],
    ['kommo_curso_escola', 'Escola certificadora (Kommo)', 'text'],
    ['kommo_curso_grupo', 'Grupo do curso (Kommo)', 'text'],
  ] as const) {
    await prisma.customField.upsert({
      where: { key },
      create: { key, label, type, group: 'kommo', active: true, showInList: false, showInKanban: false, showInForm: false },
      update: {},
    })
  }
}

// ─────────────────────────────────────────────────────────────
// FASE 1 — Metadados (pipelines/stages, custom fields, tags, users)
// ─────────────────────────────────────────────────────────────

export async function importMetadata(cfg?: KommoConfig): Promise<{ funnels: number; stages: number; customFields: number; tags: number; users: number; templates: number; catalogs: number; catalogElements: number }> {
  const config = cfg ?? (await getKommoConfig(true))
  let funnels = 0, stages = 0, customFields = 0, tags = 0, users = 0

  // ── Catálogos primeiro: os leads referenciam elementos por id ──
  const cat = await importCatalogs(config)
  // Cursos → catálogo local, para virarem item de Negociação.
  await syncCatalogProducts()

  // ── Pipelines → Funnels ; statuses → Stages ──
  const pipeMap = await loadMappingDict('pipeline')
  for await (const batch of kommoPaginate('leads/pipelines', '', config)) {
    for (const p of batch) {
      const existing = pipeMap.get(String(p.id))
      let funnelId: number
      if (existing) {
        funnelId = existing.localId
        await prisma.funnel.update({ where: { id: funnelId }, data: { name: p.name } }).catch(() => {})
      } else {
        const f = await prisma.funnel.create({ data: { name: p.name, description: `Importado da Kommo (pipeline ${p.id})`, active: true } })
        funnelId = f.id
        await setMapping('pipeline', p.id, funnelId, { name: p.name })
      }
      funnels++
      const statuses: any[] = p?._embedded?.statuses ?? []
      for (const s of statuses) {
        const key = `kommo_${s.id}`
        await prisma.stage.upsert({
          where: { funnelId_key: { funnelId, key } },
          create: { funnelId, key, name: s.name, color: typeof s.color === 'string' ? s.color.substring(0, 20) : '#6B7280', position: s.sort ?? 0, active: true },
          update: { name: s.name, position: s.sort ?? 0 },
        })
        await setMapping('status', s.id, funnelId, { key, pipelineId: p.id, name: s.name })
        stages++
      }
    }
  }

  // ── Custom fields (leads + contacts) → CustomField ──
  // Pula PHONE/EMAIL (vão direto pra Lead.whatsapp/email).
  for (const entity of ['leads', 'contacts'] as const) {
    for await (const batch of kommoPaginate(`${entity}/custom_fields`, '', config)) {
      for (const c of batch) {
        if (c.code === 'PHONE' || c.code === 'EMAIL') {
          await setMapping('custom_field', c.id, 0, { code: c.code, entity, name: c.name, special: true })
          continue
        }
        const key = `kommo_${c.id}`
        const enums: any[] = c?.enums ?? []
        const options = enums.length > 0 ? enums.map((e) => ({ label: e.value, value: e.value })) : undefined
        const cf = await prisma.customField.upsert({
          where: { key },
          create: {
            key, label: c.name?.substring(0, 191) || key, type: mapFieldType(c.type),
            group: 'kommo', active: true, showInList: false, showInKanban: false, showInForm: false,
            options: options as any,
          },
          update: { label: c.name?.substring(0, 191) || key, options: options as any },
        })
        await setMapping('custom_field', c.id, cf.id, { code: c.code, entity, name: c.name, key })
        customFields++
      }
    }
  }

  // ── Custom fields auxiliares (dono, funil e atributos do curso escolhido) ──
  await ensureKommoAuxFields()

  // ── Tags ──
  const tagMap = await loadMappingDict('tag')
  for await (const batch of kommoPaginate('leads/tags', '', config)) {
    for (const t of batch) {
      if (tagMap.has(String(t.id))) continue
      const tag = await prisma.tag.upsert({
        where: { name: String(t.name).substring(0, 191) },
        create: { name: String(t.name).substring(0, 191), color: typeof t.color === 'string' && t.color ? t.color.substring(0, 20) : '#6B7280', active: true },
        update: {},
      })
      await setMapping('tag', t.id, tag.id, { name: t.name })
      tags++
    }
  }

  // ── Users → cria User do bychat (AGENT, sem login) e mapeia localId p/
  // atribuir o responsável REAL (assignedUserId) aos leads. ──
  for await (const batch of kommoPaginate('users', '', config)) {
    for (const u of batch) {
      const localId = await ensureUserForKommo(u)
      await setMapping('user', u.id, localId, { name: u.name, email: u.email })
      users++
    }
  }

  // ── Templates de mensagem (chat) → MessageTemplate ──
  const { templates } = await importTemplates(config)

  return { funnels, stages, customFields, tags, users, templates, catalogs: cat.catalogs, catalogElements: cat.elements }
}

// ─────────────────────────────────────────────────────────────
// FASE 2a — Contatos (armazenados em KommoMapping.meta — bychat não tem
// entidade Contato; os dados enriquecem o Lead na fase de leads)
// ─────────────────────────────────────────────────────────────

export async function importContactsPage(page: number, since?: number, cfg?: KommoConfig): Promise<{ processed: number; hasNext: boolean }> {
  const config = cfg ?? (await getKommoConfig(true))
  const [cfMap, catalogMap] = await Promise.all([loadMappingDict('custom_field'), loadMappingDict('catalog_element')])
  // index field_id → {key, special, code}
  const cfById = cfMap
  const query = since ? `filter[updated_at][from]=${since}` : ''
  const data = await kommoFetch(`/contacts?limit=250&page=${page}${query ? '&' + query : ''}`, config)
  const items: any[] = data?._embedded?.contacts ?? []
  for (const c of items) {
    let phone = '', email = ''
    const cf: Record<string, any> = {}
    for (const fv of c.custom_fields_values ?? []) {
      const m = cfById.get(String(fv.field_id))
      const val = extractCfValue(fv.values, catalogMap)
      if (val == null) continue
      if (fv.field_code === 'PHONE' || m?.meta?.code === 'PHONE') { if (!phone) phone = String(Array.isArray(val) ? val[0] : val) }
      else if (fv.field_code === 'EMAIL' || m?.meta?.code === 'EMAIL') { if (!email) email = String(Array.isArray(val) ? val[0] : val) }
      else if (m && m.meta?.key) cf[m.meta.key] = val
    }
    await setMapping('contact', c.id, 0, {
      name: c.name || '', phone: phone ? displayPhone(phone) : '', email,
      firstName: c.first_name || '', lastName: c.last_name || '', cf,
    })
  }
  return { processed: items.length, hasNext: Boolean(data?._links?.next) }
}

// ─────────────────────────────────────────────────────────────
// FASE 2b — Leads → Lead
// ─────────────────────────────────────────────────────────────

export async function importLeadsPage(page: number, defaultTeamId: number | null, since?: number, cfg?: KommoConfig): Promise<{ processed: number; created: number; updated: number; hasNext: boolean }> {
  const config = cfg ?? (await getKommoConfig(true))
  const [cfMap, statusMap, pipeMap, userMap, contactMap, tagMap, leadMap, catalogMap] = await Promise.all([
    loadMappingDict('custom_field'), loadMappingDict('status'), loadMappingDict('pipeline'),
    loadMappingDict('user'), loadMappingDict('contact'), loadMappingDict('tag'), loadMappingDict('lead'),
    loadMappingDict('catalog_element'),
  ])

  const query = since ? `filter[updated_at][from]=${since}` : ''
  const data = await kommoFetch(`/leads?limit=250&with=contacts&page=${page}${query ? '&' + query : ''}`, config)
  const items: any[] = data?._embedded?.leads ?? []
  let created = 0, updated = 0

  for (const l of items) {
    try {
      // contato principal
      const embContacts: any[] = l?._embedded?.contacts ?? []
      const mainC = embContacts.find((x) => x.is_main) ?? embContacts[0]
      const contact = mainC ? contactMap.get(String(mainC.id))?.meta : null

      // funil + etapa
      const pipe = pipeMap.get(String(l.pipeline_id))
      const funnelId = pipe?.localId ?? null
      const st = statusMap.get(String(l.status_id))
      const stageKey = st?.meta?.key ?? 'NOVO'
      const pipelineName = pipe?.meta?.name ?? ''

      // custom fields do lead
      const cf: Record<string, any> = {}
      for (const fv of l.custom_fields_values ?? []) {
        const m = cfMap.get(String(fv.field_id))
        if (!m || !m.meta?.key) continue
        const val = extractCfValue(fv.values, catalogMap)
        if (val != null) cf[m.meta.key] = val
      }
      // atributos do curso principal (elemento de catálogo do "Curso de Interesse 1")
      const elId = primaryCatalogElementId(l.custom_fields_values ?? [])
      const el = elId != null ? catalogMap.get(String(elId))?.meta : null
      if (el?.price != null) cf['kommo_curso_valor'] = el.price
      if (el?.escola) cf['kommo_curso_escola'] = el.escola
      if (el?.group) cf['kommo_curso_grupo'] = el.group
      // custom fields herdados do contato (CPF/RG/etc)
      if (contact?.cf) for (const [k, v] of Object.entries(contact.cf)) if (cf[k] == null) cf[k] = v
      // tracking (UTM/gclid/fbclid) → colunas nativas, além do custom field
      const tracking = extractTrackingColumns(l.custom_fields_values ?? [], cfMap)
      // dono + pipeline origem
      const ownerEntry = userMap.get(String(l.responsible_user_id))
      const ownerLocalId = ownerEntry && ownerEntry.localId > 0 ? ownerEntry.localId : null
      if (ownerEntry?.meta?.name) cf['kommo_responsavel'] = ownerEntry.meta.name
      if (pipelineName) cf['kommo_pipeline'] = pipelineName

      const nome = (contact?.name || l.name || '').substring(0, 191)
      const whatsapp = (contact?.phone || '').substring(0, 30)
      const email = (contact?.email || '').substring(0, 191)
      const empresa = empresaFromPipeline(pipelineName).substring(0, 191)

      const existing = leadMap.get(String(l.id))
      if (existing) {
        // UPDATE idempotente — atualiza etapa, dono e mescla custom fields
        const cur = await prisma.lead.findUnique({
          where: { id: existing.localId },
          select: { customFields: true, utmSource: true, utmMedium: true, utmCampaign: true, utmContent: true, utmTerm: true, gclid: true, fbclid: true, originType: true },
        })
        const mergedCF = { ...((cur?.customFields as any) || {}), ...cf }
        // Tracking só preenche coluna VAZIA: um lead que já foi atribuído pelo
        // tracking nativo do bychat não pode ser sobrescrito pelo dado da Kommo.
        const trackingPatch: Record<string, string> = {}
        for (const [field, value] of Object.entries(tracking)) {
          if (!(cur as any)?.[field]) trackingPatch[field] = value
        }
        if (trackingPatch.gclid && !cur?.originType) trackingPatch.originType = 'google_ads'
        await prisma.lead.update({
          where: { id: existing.localId },
          data: {
            status: stageKey, funnelId: funnelId ?? undefined, customFields: mergedCF as any, empresa, nome: nome || undefined,
            ...trackingPatch,
            ...(ownerLocalId ? { assignedUserId: ownerLocalId, assignedAt: unix(l.created_at) ?? new Date() } : {}),
          },
        })
        updated++
      } else {
        // Lista de bloqueio: a sincronização roda sozinha, então é entrada
        // automática como qualquer outra — sem isto, o contato barrado no
        // formulário voltava pela integração.
        const { rejectLeadEntry } = await import('./leadBlocklist.js')
        if (await rejectLeadEntry({ email, whatsapp }, 'Kommo (sincronização)').catch(() => null)) {
          continue
        }
        const lead = await prisma.lead.create({
          data: {
            uid: await generateUid(),
            empresa: empresa || 'Kommo',
            nome,
            whatsapp,
            email,
            formData: { source: 'kommo', kommoLeadId: l.id, kommoUpdatedAt: l.updated_at },
            scores: {},
            lastStep: 0,
            completed: false,
            status: stageKey,
            funnelId: funnelId ?? undefined,
            teamId: defaultTeamId ?? undefined,
            source: kommoSourceToChannel(l.source_id),
            sourceId: String(l.id),
            // UTM/gclid nas colunas nativas — é o que a atribuição lê.
            ...tracking,
            ...(tracking.gclid ? { originType: 'google_ads' } : {}),
            customFields: Object.keys(cf).length > 0 ? (cf as any) : undefined,
            createdAt: unix(l.created_at) ?? undefined,
            // Leads vindos de um CRM são leads reais → já entram qualificados,
            // senão a listagem/kanban (que filtram qualifiedAt != null) os escondem.
            qualifiedAt: unix(l.created_at) ?? new Date(),
            qualificationSource: 'kommo_import',
            // Responsável real (operador da Kommo já criado como User AGENT).
            assignedUserId: ownerLocalId ?? undefined,
            assignedAt: ownerLocalId ? (unix(l.created_at) ?? new Date()) : undefined,
          },
        })
        await setMapping('lead', l.id, lead.id, { updatedAt: l.updated_at, pipelineId: l.pipeline_id })

        // tags do lead
        const embTags: any[] = l?._embedded?.tags ?? []
        for (const t of embTags) {
          const tm = tagMap.get(String(t.id))
          if (tm) await prisma.leadTag.upsert({ where: { leadId_tagId: { leadId: lead.id, tagId: tm.localId } }, create: { leadId: lead.id, tagId: tm.localId }, update: {} }).catch(() => {})
        }
        created++
      }
    } catch {
      // lead individual falhou — não derruba a página
    }
  }
  return { processed: items.length, created, updated, hasNext: Boolean(data?._links?.next) }
}

// ─────────────────────────────────────────────────────────────
// FASE 3 — Notas → LeadNote ; Tarefas → Activity
// ─────────────────────────────────────────────────────────────

export async function importNotesPage(page: number, since?: number, cfg?: KommoConfig): Promise<{ processed: number; created: number; hasNext: boolean }> {
  const config = cfg ?? (await getKommoConfig(true))
  const leadMap = await loadMappingDict('lead')
  const query = since ? `filter[updated_at][from]=${since}` : ''
  const data = await kommoFetch(`/leads/notes?limit=250&page=${page}${query ? '&' + query : ''}`, config)
  const items: any[] = data?._embedded?.notes ?? []
  let created = 0
  for (const n of items) {
    const lead = leadMap.get(String(n.entity_id))
    if (!lead) continue
    const text = n?.params?.text ?? n?.params?.['text'] ?? (n.note_type === 'common' ? n?.params?.text : null)
    const body = typeof text === 'string' && text.trim() ? text.trim() : null
    if (!body) continue
    // idempotência: 1 LeadNote por nota Kommo
    if ((await prisma.kommoMapping.findUnique({ where: { entityType_kommoId: { entityType: 'note', kommoId: String(n.id) } } }))) continue
    const note = await prisma.leadNote.create({ data: { leadId: lead.localId, userName: 'Kommo', content: body.substring(0, 65000), createdAt: unix(n.created_at) ?? new Date() } })
    await setMapping('note', n.id, note.id)
    created++
  }
  return { processed: items.length, created, hasNext: Boolean(data?._links?.next) }
}

export async function importTasksPage(page: number, since?: number, cfg?: KommoConfig): Promise<{ processed: number; created: number; hasNext: boolean }> {
  const config = cfg ?? (await getKommoConfig(true))
  const leadMap = await loadMappingDict('lead')
  const taskMap = await loadMappingDict('task')
  const query = since ? `filter[updated_at][from]=${since}` : ''
  const data = await kommoFetch(`/tasks?limit=250&page=${page}${query ? '&' + query : ''}`, config)
  const items: any[] = data?._embedded?.tasks ?? []
  let created = 0
  for (const t of items) {
    if (t.entity_type !== 'leads') continue
    const lead = leadMap.get(String(t.entity_id))
    if (!lead) continue
    const title = (t.text || 'Tarefa Kommo').substring(0, 191)
    const completedAt = t.is_completed ? (unix(t.complete_till) ?? new Date()) : null
    const existing = taskMap.get(String(t.id))
    const payload = {
      type: 'task', title,
      status: t.is_completed ? 'completed' : 'pending',
      scheduledAt: unix(t.complete_till) ?? new Date(),
      completedAt,
      userName: 'Kommo',
    }
    if (existing) {
      await prisma.activity.update({ where: { id: existing.localId }, data: { status: payload.status, completedAt } }).catch(() => {})
    } else {
      const act = await prisma.activity.create({ data: { leadId: lead.localId, ...payload, createdAt: unix(t.created_at) ?? new Date() } as any })
      await setMapping('task', t.id, act.id)
      created++
    }
  }
  return { processed: items.length, created, hasNext: Boolean(data?._links?.next) }
}

// ─────────────────────────────────────────────────────────────
// FASE 4 — Timeline (/events) → LeadEvent + LeadStageMovement
//
// A Kommo guarda ~768 mil eventos com retenção desde a origem da conta. Nem
// tudo vira história útil: `entity_linked`, `name_field_changed` e
// `custom_field_value_changed` somam ~395 mil e são ruído estrutural (vínculo
// de contato, renomeação, campo alterado) que encheria a timeline sem contar
// nada ao operador. Importamos o conjunto curado abaixo (~223 mil) e as
// mensagens de chat (~76 mil).
//
// Mensagem de chat entra SEM TEXTO: a API v4 devolve só `{id, origin, talk_id}`
// no evento — o conteúdo mora na API amojo, acessível apenas ao app dono do
// canal. Registra-se que houve contato, quando e em que direção.
//
// Idempotência: LeadEvent não tem chave natural para 300 mil linhas, então o
// controle é por marca d'água (`kommo.events_synced_until`). Um full posterior
// não reimporta o que já veio.
// ─────────────────────────────────────────────────────────────

interface EventMap { type: string; category: 'lifecycle' | 'communication' | 'operator' | 'system' | 'integration'; title: string; actorType: 'lead' | 'operator' | 'system' | 'ai' | 'integration' }

const KOMMO_EVENT_MAP: Record<string, EventMap> = {
  lead_added:                  { type: EVENT_TYPES.LEAD_CREATED,      category: 'lifecycle',     title: 'Lead criado na Kommo',        actorType: 'integration' },
  lead_status_changed:         { type: EVENT_TYPES.STATUS_CHANGED,    category: 'lifecycle',     title: 'Etapa alterada',              actorType: 'operator' },
  entity_responsible_changed:  { type: EVENT_TYPES.OPERATOR_ASSIGNED, category: 'operator',      title: 'Responsável alterado',        actorType: 'operator' },
  entity_tag_added:            { type: EVENT_TYPES.TAG_ADDED,         category: 'operator',      title: 'Tag adicionada',              actorType: 'operator' },
  entity_tag_deleted:          { type: EVENT_TYPES.TAG_REMOVED,       category: 'operator',      title: 'Tag removida',                actorType: 'operator' },
  sale_field_changed:          { type: EVENT_TYPES.SALE_DETECTED,     category: 'lifecycle',     title: 'Valor da venda alterado',     actorType: 'operator' },
  incoming_chat_message:       { type: EVENT_TYPES.MESSAGE_RECEIVED,  category: 'communication', title: 'Mensagem recebida',           actorType: 'lead' },
  outgoing_chat_message:       { type: EVENT_TYPES.MESSAGE_SENT,      category: 'communication', title: 'Mensagem enviada',            actorType: 'operator' },
}

export const KOMMO_EVENT_TYPES = Object.keys(KOMMO_EVENT_MAP)

/** Query string com um filter[type][] por tipo curado. */
function eventTypeFilter(): string {
  return KOMMO_EVENT_TYPES.map((t) => `filter[type][]=${encodeURIComponent(t)}`).join('&')
}

/** Rótulo humano de uma etapa (Stage.name) por (funnelId, key). */
async function loadStageNames(): Promise<Map<string, string>> {
  const rows = await prisma.stage.findMany({ select: { funnelId: true, key: true, name: true } })
  return new Map(rows.map((s) => [`${s.funnelId}::${s.key}`, s.name]))
}

/**
 * Importa uma página de eventos.
 *
 * `since` (unix) → só eventos a partir dessa data; é a marca d'água no sync
 * incremental. `until` (unix) → só eventos até essa data, usado pela carga
 * histórica para retomar de onde parou: a Kommo pagina do mais recente para o
 * mais antigo, então retomar é pedir "tudo anterior ao mais antigo que já
 * importei" e voltar à página 1.
 */
export async function importEventsPage(
  page: number,
  since?: number,
  cfg?: KommoConfig,
  until?: number,
): Promise<{ processed: number; created: number; movements: number; hasNext: boolean; newestAt: number; oldestAt: number }> {
  const config = cfg ?? (await getKommoConfig(true))
  const [leadMap, userMap, statusMap, pipeMap, stageNames] = await Promise.all([
    loadMappingDict('lead'), loadMappingDict('user'), loadMappingDict('status'), loadMappingDict('pipeline'), loadStageNames(),
  ])

  const filt = eventTypeFilter()
  // A Kommo rejeita `created_at[to]` sozinho (400 "Invalid params passed to
  // filter") — o range precisa dos dois lados. Quando só há `until`, ancoramos
  // o início em 1 (época), que a API aceita.
  let dateQ = ''
  if (since && until) dateQ = `&filter[created_at][from]=${since}&filter[created_at][to]=${until}`
  else if (until) dateQ = `&filter[created_at][from]=1&filter[created_at][to]=${until}`
  else if (since) dateQ = `&filter[created_at][from]=${since}`
  const data = await kommoFetch(`/events?limit=250&page=${page}&${filt}${dateQ}`, config)
  const items: any[] = data?._embedded?.events ?? []
  if (items.length === 0) return { processed: 0, created: 0, movements: 0, hasNext: false, newestAt: 0, oldestAt: 0 }

  const events: any[] = []
  const movements: any[] = []
  let newestAt = 0
  let oldestAt = Number.MAX_SAFE_INTEGER

  for (const e of items) {
    if (e.entity_type !== 'lead') continue
    const map = KOMMO_EVENT_MAP[e.type]
    if (!map) continue
    const lead = leadMap.get(String(e.entity_id))
    if (!lead) continue
    const createdAt = new Date((e.created_at ?? 0) * 1000)
    if (e.created_at > newestAt) newestAt = e.created_at
    if (e.created_at > 0 && e.created_at < oldestAt) oldestAt = e.created_at

    const actor = e.created_by ? userMap.get(String(e.created_by)) : null
    const before = Array.isArray(e.value_before) ? e.value_before[0] : null
    const after = Array.isArray(e.value_after) ? e.value_after[0] : null

    let oldValue: string | null = null
    let newValue: string | null = null

    if (e.type === 'lead_status_changed') {
      // A etapa vem como id; o rótulo humano sai de Stage por (funnelId, key) —
      // a mesma chave (142/143) tem nome diferente em cada funil.
      const fromId = before?.lead_status?.id, toId = after?.lead_status?.id
      const fromPipe = before?.lead_status?.pipeline_id, toPipe = after?.lead_status?.pipeline_id
      const fromFunnel = fromPipe ? pipeMap.get(String(fromPipe))?.localId ?? null : null
      const toFunnel = toPipe ? pipeMap.get(String(toPipe))?.localId ?? null : null
      const fromKey = fromId ? `kommo_${fromId}` : null
      const toKey = toId ? `kommo_${toId}` : null
      oldValue = fromKey ? stageNames.get(`${fromFunnel}::${fromKey}`) ?? fromKey : null
      newValue = toKey ? stageNames.get(`${toFunnel}::${toKey}`) ?? toKey : null
      if (toKey) {
        movements.push({
          leadId: lead.localId,
          fromFunnelId: fromFunnel, toFunnelId: toFunnel,
          fromStageKey: fromKey, toStageKey: toKey,
          movedAt: createdAt,
          movedByUserId: actor && actor.localId > 0 ? actor.localId : null,
          source: 'kommo',
          createdAt,
        })
      }
    } else if (e.type === 'entity_responsible_changed') {
      const from = before?.responsible_user?.id, to = after?.responsible_user?.id
      oldValue = from ? userMap.get(String(from))?.meta?.name ?? String(from) : null
      newValue = to ? userMap.get(String(to))?.meta?.name ?? String(to) : null
    } else if (e.type === 'entity_tag_added' || e.type === 'entity_tag_deleted') {
      newValue = after?.tag?.name ?? before?.tag?.name ?? null
    } else if (e.type === 'sale_field_changed') {
      oldValue = before?.sale_field_value?.sale != null ? String(before.sale_field_value.sale) : null
      newValue = after?.sale_field_value?.sale != null ? String(after.sale_field_value.sale) : null
    }

    events.push({
      leadId: lead.localId,
      type: map.type,
      category: map.category,
      channel: e.type.endsWith('_chat_message') ? 'whatsapp' : null,
      source: 'kommo',
      userId: actor && actor.localId > 0 ? actor.localId : null,
      // Mensagem recebida é do lead: creditar "Kommo" como autor confundiria a
      // leitura da timeline. Sem operador identificado, o autor fica em branco.
      userName: actor?.meta?.name
        ? String(actor.meta.name).substring(0, 100)
        : (map.actorType === 'lead' ? null : 'Kommo'),
      actorType: map.actorType,
      title: map.title.substring(0, 191),
      oldValue: oldValue ? String(oldValue).substring(0, 500) : null,
      newValue: newValue ? String(newValue).substring(0, 500) : null,
      metadata: { kommoEventId: e.id, kommoType: e.type, ...(after?.message?.origin ? { origin: after.message.origin } : {}) },
      createdAt,
    })
  }

  if (events.length > 0) await prisma.leadEvent.createMany({ data: events })
  if (movements.length > 0) await prisma.leadStageMovement.createMany({ data: movements })

  return {
    processed: items.length, created: events.length, movements: movements.length,
    hasNext: Boolean(data?._links?.next), newestAt,
    oldestAt: oldestAt === Number.MAX_SAFE_INTEGER ? 0 : oldestAt,
  }
}

/** Ponto mais antigo já trazido pela carga histórica (para retomada). */
export async function getBackfillOldest(): Promise<number | null> {
  const row = await prisma.setting.findUnique({ where: { key: 'kommo.events_backfill_oldest' } })
  const n = row?.value ? parseInt(String(row.value).replace(/"/g, ''), 10) : NaN
  return Number.isFinite(n) ? n : null
}

export async function setBackfillOldest(unixSec: number): Promise<void> {
  await prisma.setting.upsert({
    where: { key: 'kommo.events_backfill_oldest' },
    create: { key: 'kommo.events_backfill_oldest', value: String(unixSec), label: 'Carga histórica da timeline chegou até (unix)', grp: 'kommo', fieldType: 'text' },
    update: { value: String(unixSec) },
  })
}

/** Marca d'água da timeline (unix do evento mais recente já importado). */
export async function getEventsWatermark(): Promise<number | null> {
  const row = await prisma.setting.findUnique({ where: { key: 'kommo.events_synced_until' } })
  const n = row?.value ? parseInt(String(row.value).replace(/"/g, ''), 10) : NaN
  return Number.isFinite(n) ? n : null
}

export async function setEventsWatermark(unixSec: number): Promise<void> {
  await prisma.setting.upsert({
    where: { key: 'kommo.events_synced_until' },
    create: { key: 'kommo.events_synced_until', value: String(unixSec), label: 'Timeline Kommo importada até (unix)', grp: 'kommo', fieldType: 'text' },
    update: { value: String(unixSec) },
  })
}

// ─────────────────────────────────────────────────────────────
// Estado / status do sync (Settings)
// ─────────────────────────────────────────────────────────────

export async function setSyncState(state: Record<string, any>): Promise<void> {
  await prisma.setting.upsert({
    where: { key: 'kommo.sync_state' },
    create: { key: 'kommo.sync_state', value: state as any, label: 'Estado do sync Kommo', grp: 'kommo', fieldType: 'json' },
    update: { value: state as any },
  })
}

export async function getSyncState(): Promise<any> {
  const row = await prisma.setting.findUnique({ where: { key: 'kommo.sync_state' } })
  return (row?.value as any) ?? null
}

export async function setLastSyncAt(unixSec: number): Promise<void> {
  await prisma.setting.upsert({
    where: { key: 'kommo.last_sync_at' },
    create: { key: 'kommo.last_sync_at', value: String(unixSec), label: 'Último sync Kommo (unix)', grp: 'kommo', fieldType: 'text' },
    update: { value: String(unixSec) },
  })
}

export async function getLastSyncAt(): Promise<number | null> {
  const row = await prisma.setting.findUnique({ where: { key: 'kommo.last_sync_at' } })
  const v = row?.value
  const n = v ? parseInt(String(v).replace(/"/g, ''), 10) : NaN
  return Number.isFinite(n) ? n : null
}
