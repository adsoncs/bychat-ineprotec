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

type EntityType = 'lead' | 'contact' | 'pipeline' | 'status' | 'tag' | 'note' | 'task' | 'custom_field' | 'user' | 'chat_template'

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

/** Extrai um valor simples de um custom_fields_values[].values da Kommo. */
function extractCfValue(values: any[]): any {
  if (!Array.isArray(values) || values.length === 0) return null
  const vals = values.map((v) => v?.value).filter((v) => v !== undefined && v !== null && v !== '')
  if (vals.length === 0) return null
  return vals.length === 1 ? vals[0] : vals
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
// FASE 1 — Metadados (pipelines/stages, custom fields, tags, users)
// ─────────────────────────────────────────────────────────────

export async function importMetadata(cfg?: KommoConfig): Promise<{ funnels: number; stages: number; customFields: number; tags: number; users: number; templates: number }> {
  const config = cfg ?? (await getKommoConfig(true))
  let funnels = 0, stages = 0, customFields = 0, tags = 0, users = 0

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

  // ── Custom fields auxiliares (dono e id Kommo) ──
  for (const [key, label] of [['kommo_responsavel', 'Responsável (Kommo)'], ['kommo_pipeline', 'Funil de origem (Kommo)']] as const) {
    await prisma.customField.upsert({
      where: { key },
      create: { key, label, type: 'text', group: 'kommo', active: true, showInList: false, showInKanban: false, showInForm: false },
      update: {},
    })
  }

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

  return { funnels, stages, customFields, tags, users, templates }
}

// ─────────────────────────────────────────────────────────────
// FASE 2a — Contatos (armazenados em KommoMapping.meta — bychat não tem
// entidade Contato; os dados enriquecem o Lead na fase de leads)
// ─────────────────────────────────────────────────────────────

export async function importContactsPage(page: number, since?: number, cfg?: KommoConfig): Promise<{ processed: number; hasNext: boolean }> {
  const config = cfg ?? (await getKommoConfig(true))
  const cfMap = await loadMappingDict('custom_field')
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
      const val = extractCfValue(fv.values)
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
  const [cfMap, statusMap, pipeMap, userMap, contactMap, tagMap, leadMap] = await Promise.all([
    loadMappingDict('custom_field'), loadMappingDict('status'), loadMappingDict('pipeline'),
    loadMappingDict('user'), loadMappingDict('contact'), loadMappingDict('tag'), loadMappingDict('lead'),
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
        const val = extractCfValue(fv.values)
        if (val != null) cf[m.meta.key] = val
      }
      // custom fields herdados do contato (CPF/RG/etc)
      if (contact?.cf) for (const [k, v] of Object.entries(contact.cf)) if (cf[k] == null) cf[k] = v
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
        const cur = await prisma.lead.findUnique({ where: { id: existing.localId }, select: { customFields: true } })
        const mergedCF = { ...((cur?.customFields as any) || {}), ...cf }
        await prisma.lead.update({
          where: { id: existing.localId },
          data: {
            status: stageKey, funnelId: funnelId ?? undefined, customFields: mergedCF as any, empresa, nome: nome || undefined,
            ...(ownerLocalId ? { assignedUserId: ownerLocalId, assignedAt: unix(l.created_at) ?? new Date() } : {}),
          },
        })
        updated++
      } else {
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
