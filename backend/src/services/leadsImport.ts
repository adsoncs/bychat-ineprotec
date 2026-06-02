// src/services/leadsImport.ts
// Módulo de importação de leads via planilha (CSV/Excel).
//
// Fluxo:
//   1. parseFile(buffer, fileName) → ParsedSheet { headers, rows, sheets }
//   2. buildPreview(parsed, mapping, options) → ImportPlan
//        - resolve dedup (whatsapp 8 dígitos → email)
//        - classifica cada linha: new | update | skip | invalid
//        - cria custom fields automaticamente se mapping marcar (createMissing)
//        - calcula diff de campos por linha
//   3. executeImport(plan, acceptedIndices) → Result
//        - cria/atualiza em chunks de 50, transação por linha
//        - merge com customFields existente sem sobrescrever
//
// Política central: NUNCA sobrescreve campo já preenchido a menos que
// options.overrideFilled=true.

import { read, utils } from 'xlsx'
import { prisma } from '../lib/prisma.js'
import { findDuplicate, generateUid, phoneDigits } from './dedup.js'
import { resolveDefaultTeamId } from './teamRouting.js'
import { logEvent, EVENT_TYPES } from './leadHistory.js'

export const MAX_ROWS = 5000

// ─── Tipos ────────────────────────────────────────────────────────────

export interface ParsedSheet {
  headers: string[]
  rows: Record<string, string>[]
  sheetNames: string[]
  selectedSheet: string
}

export type TargetField =
  | 'empresa' | 'nome' | 'whatsapp' | 'email' | 'cidade' | 'segmento'
  | 'funnelName' | 'stageName' | 'status' | 'lossReasonName' | 'ownerEmail'
  | 'tags'
  | 'utmSource' | 'utmMedium' | 'utmCampaign' | 'utmContent' | 'utmTerm' | 'sourceId'
  | { kind: 'customField'; key: string; label: string; type: 'text' | 'number' | 'select' }
  | { kind: 'ignore' }

export interface MappingEntry {
  source: string  // nome da coluna na planilha
  target: TargetField
}

export interface ImportOptions {
  matchBy: 'whatsapp_first' | 'email_first' | 'whatsapp_only'
  overrideFilled: boolean
  createMissingFields: boolean  // se true, custom fields no mapping serão criados
  // Reforma FImp.7: modo migração de histórico de outro CRM. Quando true em
  // UPDATE, libera campos protegidos por default:
  //   - status (etapa do funil)
  //   - outcome (won/lost) + lostReasonId + outcomeAt
  //   - assignedUserId/teamId APENAS se lead atual estiver sem responsável
  //   - tags: sempre MERGE (adiciona; nunca remove tags existentes)
  // Em CREATE não tem efeito (todos os campos já são gravados).
  migrationMode: boolean
}

export interface PreviewRow {
  lineIndex: number  // 0-based, sem contar header
  action: 'create' | 'update' | 'skip' | 'invalid'
  existingLeadId: number | null
  matchReason: string | null
  rawValues: Record<string, string>
  parsedFields: Record<string, unknown>
  diff: Array<{ field: string; oldValue: unknown; newValue: unknown; action: 'fill' | 'skip-already-set' | 'override' }>
  errors: string[]
}

export interface ImportPlan {
  summary: {
    total: number
    new: number
    update: number
    skip: number
    invalid: number
  }
  rows: PreviewRow[]
  newCustomFields: Array<{ key: string; label: string; type: string }>
}

// ─── Parser dual CSV/Excel via xlsx (xlsx reads CSV nativamente) ──────

export function parseFile(buffer: Buffer, fileName: string): ParsedSheet {
  // xlsx.read aceita CSV, XLSX, ODS, etc. Detecta automaticamente.
  const workbook = read(buffer, { type: 'buffer', cellDates: false })
  const sheetNames = workbook.SheetNames
  if (sheetNames.length === 0) throw new Error('Planilha vazia ou ilegível')
  const selectedSheet = sheetNames[0]!
  const sheet = workbook.Sheets[selectedSheet]
  if (!sheet) throw new Error('Não foi possível ler a primeira aba')

  // Converte tudo pra string preservando linhas vazias como undefined.
  const rows = utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: '',
    raw: false,
  })

  if (rows.length === 0) {
    return { headers: [], rows: [], sheetNames, selectedSheet }
  }

  // Headers: chaves da primeira linha (json_to_sheet usa nomes das colunas).
  const headersSet = new Set<string>()
  for (const r of rows) for (const k of Object.keys(r)) headersSet.add(k)
  const headers = Array.from(headersSet)

  // Normaliza valores pra string trim.
  const normalized: Record<string, string>[] = rows.map((r) => {
    const out: Record<string, string> = {}
    for (const h of headers) {
      const v = r[h]
      out[h] = v == null ? '' : String(v).trim()
    }
    return out
  })

  return { headers, rows: normalized, sheetNames, selectedSheet, fileName: fileName as any } as any
}

// ─── Auto-mapping (sugestão inicial) ──────────────────────────────────

const FIELD_HINTS: Record<string, TargetField> = {
  'titulo': 'empresa',
  'título': 'empresa',
  'title': 'empresa',
  'empresa': 'empresa',
  'company': 'empresa',
  'nome': 'nome',
  'name': 'nome',
  'whatsapp': 'whatsapp',
  'wpp': 'whatsapp',
  'telefone celular': 'whatsapp',
  'telefone - celular': 'whatsapp',
  'celular': 'whatsapp',
  'phone': 'whatsapp',
  'email': 'email',
  'e-mail': 'email',
  'cidade': 'cidade',
  'city': 'cidade',
  'segmento': 'segmento',
  'segment': 'segmento',
  // 'instagram' removido — não é coluna direta de Lead, vira custom field via fallback.
  'funil': 'funnelName',
  'pipeline': 'funnelName',
  'etapa': 'stageName',
  'stage': 'stageName',
  'status': 'status',
  'motivo da perda': 'lossReasonName',
  'lost reason': 'lossReasonName',
  'proprietário': 'ownerEmail',
  'proprietario': 'ownerEmail',
  'owner': 'ownerEmail',
  'responsável': 'ownerEmail',
  'utm_source': 'utmSource',
  'utm source': 'utmSource',
  'utm_medium': 'utmMedium',
  'utm medium': 'utmMedium',
  'utm_campaign': 'utmCampaign',
  'utm campaign': 'utmCampaign',
  'utm_content': 'utmContent',
  'utm content': 'utmContent',
  'utm_term': 'utmTerm',
  'utm term': 'utmTerm',
  'source_id': 'sourceId',
  'tags': 'tags',
  'tag': 'tags',
  'etiquetas': 'tags',
  'etiqueta': 'tags',
  'labels': 'tags',
}

// Tags vêm como string com separadores variados na planilha. Aceita:
// "tag1, tag2; tag3 | tag4" → ['tag1', 'tag2', 'tag3', 'tag4']
// Normaliza para lowercase + trim. Filtra vazios.
function parseTagsValue(raw: string): string[] {
  if (!raw) return []
  return raw
    .split(/[,;|]/g)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

function stripPrefix(h: string): string {
  // "Negócio - Whatsapp" → "whatsapp"; "Pessoa - E-mail - Trabalho" → "e-mail trabalho"
  return h.toLowerCase()
    .replace(/^(negócio|negocio|deal|pessoa|person)\s*-\s*/i, '')
    .replace(/\s+/g, ' ')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .trim()
}

export function suggestMapping(headers: string[]): MappingEntry[] {
  return headers.map((src) => {
    const norm = stripPrefix(src)
    // Match direto
    for (const [hint, field] of Object.entries(FIELD_HINTS)) {
      const hintNorm = stripPrefix(hint)
      if (norm === hintNorm) return { source: src, target: field as TargetField }
    }
    // Contém (mais permissivo para colunas tipo "telefone - celular")
    for (const [hint, field] of Object.entries(FIELD_HINTS)) {
      const hintNorm = stripPrefix(hint)
      if (norm.includes(hintNorm) || hintNorm.includes(norm)) {
        return { source: src, target: field as TargetField }
      }
    }
    // Sem match — default: pode virar custom field. Sugere kind=customField
    // com key derivada do nome (admin confirma).
    const slug = norm
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 50)
    return {
      source: src,
      target: { kind: 'customField', key: slug || `col_${src.toLowerCase()}`, label: src.replace(/^(negócio|negocio|pessoa)\s*-\s*/i, ''), type: 'text' },
    }
  })
}

// ─── Build preview ────────────────────────────────────────────────────

interface LookupCaches {
  funnelsByName: Map<string, number>
  stagesByName: Map<string, { key: string; funnelId: number }>
  lossReasonsByName: Map<string, number>
  usersByEmail: Map<string, number>
  // Fallback quando "Proprietário" vem como NOME (CRM antigo). Chave: nome sem acentos lowercase.
  usersByName: Map<string, number>
  customFieldsByKey: Map<string, { key: string; label: string; type: string }>
  tagsByName: Map<string, number>
}

// Remove acentos pra match user-friendly (Luiz Méndes ↔ luiz mendes).
// CRMs antigos costumam trazer "Proprietário" como nome inteiro — lookup
// por nome aceita variações com/sem acento.
function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

async function buildLookups(): Promise<LookupCaches> {
  const [funnels, stages, lossReasons, users, customFields, tags] = await Promise.all([
    prisma.funnel.findMany({ where: { active: true }, select: { id: true, name: true } }),
    prisma.stage.findMany({ where: { active: true }, select: { key: true, name: true, funnelId: true } }),
    prisma.lossReason.findMany({ where: { active: true }, select: { id: true, name: true } }),
    prisma.user.findMany({ where: { active: true }, select: { id: true, email: true, name: true } }),
    prisma.customField.findMany({ where: { active: true }, select: { key: true, label: true, type: true } }),
    prisma.tag.findMany({ select: { id: true, name: true } }),
  ])
  const funnelsByName = new Map<string, number>()
  for (const f of funnels) funnelsByName.set(f.name.toLowerCase().trim(), f.id)
  const stagesByName = new Map<string, { key: string; funnelId: number }>()
  for (const s of stages) {
    stagesByName.set(`${s.funnelId}::${s.name.toLowerCase().trim()}`, { key: s.key, funnelId: s.funnelId })
  }
  const lossReasonsByName = new Map<string, number>()
  for (const lr of lossReasons) lossReasonsByName.set(lr.name.toLowerCase().trim(), lr.id)
  const usersByEmail = new Map<string, number>()
  const usersByName = new Map<string, number>()
  for (const u of users) {
    usersByEmail.set(u.email.toLowerCase().trim(), u.id)
    if (u.name) usersByName.set(stripAccents(u.name), u.id)
  }
  const customFieldsByKey = new Map<string, { key: string; label: string; type: string }>()
  for (const cf of customFields) customFieldsByKey.set(cf.key, cf)
  const tagsByName = new Map<string, number>()
  for (const t of tags) tagsByName.set(t.name.toLowerCase().trim(), t.id)
  return { funnelsByName, stagesByName, lossReasonsByName, usersByEmail, usersByName, customFieldsByKey, tagsByName }
}

function getCellValue(row: Record<string, string>, sourceCol: string): string {
  return (row[sourceCol] || '').trim()
}

interface ParsedRow {
  parsedFields: Record<string, unknown>
  customFields: Record<string, unknown>
  ownerUserId: number | null
  funnelId: number | null
  stageKey: string | null
  lossReasonId: number | null
  tagIds: number[]            // IDs já resolvidos a partir do nome
  tagsRequested: string[]     // nomes originais (pra criar dinâmico se opção ligada)
  warnings: string[]
}

function parseRow(
  row: Record<string, string>,
  mapping: MappingEntry[],
  lookups: LookupCaches,
): ParsedRow {
  const result: ParsedRow = {
    parsedFields: {},
    customFields: {},
    ownerUserId: null,
    funnelId: null,
    stageKey: null,
    lossReasonId: null,
    tagIds: [],
    tagsRequested: [],
    warnings: [],
  }

  // Primeiro passa: emails e telefones com múltiplas colunas. A planilha tem
  // 3 emails e 4 telefones; usamos a 1ª coluna não-vazia mapeada para o campo.
  let emailValue: string | null = null
  let whatsappValue: string | null = null

  for (const m of mapping) {
    const v = getCellValue(row, m.source)
    if (!v) continue

    const t = m.target
    if (typeof t === 'object') {
      if (t.kind === 'ignore') continue
      if (t.kind === 'customField') {
        result.customFields[t.key] = v
        continue
      }
    } else {
      switch (t) {
        case 'email':
          if (!emailValue) emailValue = v.toLowerCase().trim()
          break
        case 'whatsapp':
          if (!whatsappValue) whatsappValue = v
          break
        case 'empresa':
        case 'nome':
        case 'cidade':
        case 'segmento':
        case 'utmSource':
        case 'utmMedium':
        case 'utmCampaign':
        case 'utmContent':
        case 'utmTerm':
        case 'sourceId':
          result.parsedFields[t] = v
          break
        case 'funnelName': {
          const id = lookups.funnelsByName.get(v.toLowerCase().trim())
          if (id) result.funnelId = id
          else result.warnings.push(`Funil "${v}" não encontrado`)
          break
        }
        case 'stageName':
          // Resolve em segundo passo, precisa do funnelId
          result.parsedFields._stageName = v
          break
        case 'status': {
          const s = v.toLowerCase().trim()
          if (s === 'won' || s === 'ganho') result.parsedFields.outcome = 'won'
          else if (s === 'lost' || s === 'perdido' || s === 'perda') result.parsedFields.outcome = 'lost'
          else if (s === 'open' || s === 'aberto') result.parsedFields.outcome = null
          else result.parsedFields.status = v // tratado como stageKey
          break
        }
        case 'lossReasonName': {
          const id = lookups.lossReasonsByName.get(v.toLowerCase().trim())
          if (id) result.lossReasonId = id
          else result.warnings.push(`Motivo de perda "${v}" não encontrado`)
          break
        }
        case 'ownerEmail': {
          // Tenta email primeiro (formato canônico), depois nome como fallback.
          // Lookup por nome ignora acentos e case ("Luíz Méndes" === "luiz mendes").
          const vNorm = v.toLowerCase().trim()
          let uid = lookups.usersByEmail.get(vNorm)
          if (!uid) uid = lookups.usersByName.get(stripAccents(v))
          if (uid) result.ownerUserId = uid
          else result.warnings.push(`Proprietário "${v}" não existe — lead ficará sem responsável`)
          break
        }
        case 'tags': {
          const names = parseTagsValue(v)
          for (const tName of names) {
            result.tagsRequested.push(tName)
            const tId = lookups.tagsByName.get(tName)
            if (tId) result.tagIds.push(tId)
            // Tags ausentes ficam só em tagsRequested — processRow decide
            // se cria (com createMissingFields=true) ou ignora com warning.
          }
          break
        }
      }
    }
  }

  if (emailValue) result.parsedFields.email = emailValue
  if (whatsappValue) result.parsedFields.whatsapp = whatsappValue

  // Resolve stageName se temos funnelId
  if (result.parsedFields._stageName && result.funnelId) {
    const sName = String(result.parsedFields._stageName).toLowerCase().trim()
    const lookup = lookups.stagesByName.get(`${result.funnelId}::${sName}`)
    if (lookup) result.stageKey = lookup.key
    else result.warnings.push(`Etapa "${result.parsedFields._stageName}" não encontrada no funil`)
  }
  delete result.parsedFields._stageName

  return result
}

export async function buildPreview(
  parsed: ParsedSheet,
  mapping: MappingEntry[],
  options: ImportOptions,
): Promise<ImportPlan> {
  if (parsed.rows.length > MAX_ROWS) {
    throw new Error(`Planilha tem ${parsed.rows.length} linhas (máximo ${MAX_ROWS}). Divida em partes.`)
  }

  const lookups = await buildLookups()
  const rows: PreviewRow[] = []
  let counts = { total: parsed.rows.length, new: 0, update: 0, skip: 0, invalid: 0 }

  // Identifica custom fields a serem criados (no mapping mas não no DB)
  const newCustomFieldsMap = new Map<string, { key: string; label: string; type: string }>()
  for (const m of mapping) {
    const t = m.target
    if (typeof t === 'object' && t.kind === 'customField') {
      if (!lookups.customFieldsByKey.has(t.key)) {
        newCustomFieldsMap.set(t.key, { key: t.key, label: t.label, type: t.type })
      }
    }
  }
  const newCustomFields = Array.from(newCustomFieldsMap.values())

  // Map pra dedup interno (linhas duplicadas dentro da planilha)
  const seenInPlanilha = new Map<string, number>() // key (phone8 ou email) → primeira lineIndex

  for (let i = 0; i < parsed.rows.length; i++) {
    const row = parsed.rows[i]!
    const parsedRow = parseRow(row, mapping, lookups)
    const wa = (parsedRow.parsedFields.whatsapp as string | undefined) || ''
    const em = (parsedRow.parsedFields.email as string | undefined) || ''

    const previewRow: PreviewRow = {
      lineIndex: i,
      action: 'create',
      existingLeadId: null,
      matchReason: null,
      rawValues: row,
      parsedFields: parsedRow.parsedFields,
      diff: [],
      errors: [],
    }

    // Validação: precisa ter pelo menos UM dos dois (WhatsApp OU email).
    // Modo whatsapp_only é o único que exige WhatsApp obrigatório (não usa email
    // nem como fallback). Os demais (whatsapp_first/email_first) aceitam qualquer
    // um — o matchBy só decide a PRIORIDADE no dedup, não a obrigatoriedade.
    if (options.matchBy === 'whatsapp_only' && !wa) {
      previewRow.action = 'invalid'
      previewRow.errors.push('WhatsApp ausente (modo "Apenas WhatsApp")')
      counts.invalid++
      rows.push(previewRow)
      continue
    }
    if (!wa && !em) {
      previewRow.action = 'invalid'
      previewRow.errors.push('WhatsApp e email ausentes — pelo menos um é obrigatório')
      counts.invalid++
      rows.push(previewRow)
      continue
    }
    if (!parsedRow.parsedFields.empresa && !parsedRow.parsedFields.nome) {
      previewRow.action = 'invalid'
      previewRow.errors.push('Empresa e nome ausentes — pelo menos um é obrigatório')
      counts.invalid++
      rows.push(previewRow)
      continue
    }

    // Dedup INTERNO da planilha — mesma planilha não pode criar 2x o mesmo lead.
    const internalKey = wa ? `w:${phoneDigits(wa, 8)}` : `e:${em}`
    if (seenInPlanilha.has(internalKey)) {
      previewRow.action = 'skip'
      previewRow.matchReason = `Duplicado na planilha (mesma chave da linha ${seenInPlanilha.get(internalKey)! + 1})`
      counts.skip++
      rows.push(previewRow)
      continue
    }
    seenInPlanilha.set(internalKey, i)

    // Dedup contra DB
    const matchWa = options.matchBy === 'email_first' ? undefined : wa
    const matchEm = options.matchBy === 'whatsapp_only' ? undefined : em
    const dup = await findDuplicate(matchWa, matchEm)

    if (dup.lead) {
      previewRow.action = 'update'
      previewRow.existingLeadId = dup.lead.id
      previewRow.matchReason = `Lead existente #${dup.lead.id} (match por ${dup.matchType})`
      counts.update++

      // Calcula diff: pra cada campo, se DB vazio → fill; senão skip-already-set (ou override)
      const existingLead = dup.lead as any
      const SENSITIVE_FIELDS = new Set(['status', 'outcome'])
      for (const [field, newVal] of Object.entries(parsedRow.parsedFields)) {
        // Campos sensíveis só são atualizados em migrationMode (modo histórico).
        const isSensitive = SENSITIVE_FIELDS.has(field)
        if (isSensitive && !options.migrationMode) continue
        const oldVal = existingLead[field]
        if (oldVal == null || oldVal === '') {
          previewRow.diff.push({ field, oldValue: oldVal, newValue: newVal, action: 'fill' })
        } else if (options.overrideFilled || (isSensitive && options.migrationMode)) {
          previewRow.diff.push({ field, oldValue: oldVal, newValue: newVal, action: 'override' })
        } else {
          previewRow.diff.push({ field, oldValue: oldVal, newValue: newVal, action: 'skip-already-set' })
        }
      }

      // Tags: sempre MERGE (adiciona; nunca remove). Mostra no diff.
      if (parsedRow.tagsRequested.length > 0) {
        const existingTagIds = new Set<number>(
          (existingLead.tags || []).map((t: any) => t.tag?.id).filter(Boolean),
        )
        const newTagsToAdd = parsedRow.tagIds.filter((id) => !existingTagIds.has(id))
        const missingTags = parsedRow.tagsRequested.filter((n) => !lookups.tagsByName.has(n))
        if (newTagsToAdd.length > 0) {
          previewRow.diff.push({
            field: 'tags',
            oldValue: `${existingTagIds.size} tag(s) existente(s)`,
            newValue: parsedRow.tagsRequested.join(', '),
            action: 'fill',
          })
        }
        if (missingTags.length > 0) {
          if (options.createMissingFields) {
            previewRow.diff.push({
              field: 'tags (criar)',
              oldValue: null,
              newValue: missingTags.join(', '),
              action: 'fill',
            })
          } else {
            previewRow.errors.push(`Tags ausentes (não serão criadas): ${missingTags.join(', ')}`)
          }
        }
      }

      // Owner: em migrationMode, atualiza se lead atual não tem owner. Senão preserva.
      if (parsedRow.ownerUserId && options.migrationMode) {
        if (existingLead.assignedUserId == null) {
          previewRow.diff.push({
            field: 'assignedUserId',
            oldValue: null,
            newValue: parsedRow.ownerUserId,
            action: 'fill',
          })
        }
      }

      // lostReasonId em migrationMode
      if (parsedRow.lossReasonId && options.migrationMode) {
        const old = existingLead.lostReasonId
        if (old == null) {
          previewRow.diff.push({
            field: 'lostReasonId',
            oldValue: old,
            newValue: parsedRow.lossReasonId,
            action: 'fill',
          })
        } else if (old !== parsedRow.lossReasonId) {
          previewRow.diff.push({
            field: 'lostReasonId',
            oldValue: old,
            newValue: parsedRow.lossReasonId,
            action: 'override',
          })
        }
      }

      // stageKey (etapa) em migrationMode
      if (parsedRow.stageKey && options.migrationMode) {
        const oldStatus = existingLead.status
        if (oldStatus !== parsedRow.stageKey) {
          previewRow.diff.push({
            field: 'status (etapa)',
            oldValue: oldStatus,
            newValue: parsedRow.stageKey,
            action: oldStatus ? 'override' : 'fill',
          })
        }
      }
      // Custom fields merge
      const existingCF = (existingLead.customFields || {}) as Record<string, unknown>
      for (const [k, v] of Object.entries(parsedRow.customFields)) {
        const old = existingCF[k]
        if (old == null || old === '') {
          previewRow.diff.push({ field: `cf:${k}`, oldValue: old, newValue: v, action: 'fill' })
        } else if (options.overrideFilled) {
          previewRow.diff.push({ field: `cf:${k}`, oldValue: old, newValue: v, action: 'override' })
        } else {
          previewRow.diff.push({ field: `cf:${k}`, oldValue: old, newValue: v, action: 'skip-already-set' })
        }
      }
    } else {
      counts.new++
      for (const [field, newVal] of Object.entries(parsedRow.parsedFields)) {
        previewRow.diff.push({ field, oldValue: null, newValue: newVal, action: 'fill' })
      }
      for (const [k, v] of Object.entries(parsedRow.customFields)) {
        previewRow.diff.push({ field: `cf:${k}`, oldValue: null, newValue: v, action: 'fill' })
      }
    }

    if (parsedRow.warnings.length > 0) previewRow.errors.push(...parsedRow.warnings)

    rows.push(previewRow)
  }

  return {
    summary: counts,
    rows,
    newCustomFields,
  }
}

// ─── Execute import ───────────────────────────────────────────────────

export interface ExecuteResult {
  created: number
  updated: number
  skipped: number
  failed: Array<{ lineIndex: number; error: string }>
}

export async function executeImport(
  parsed: ParsedSheet,
  mapping: MappingEntry[],
  options: ImportOptions,
  acceptedLineIndices: Set<number>,
  importedByUserId: number,
): Promise<ExecuteResult> {
  const lookups = await buildLookups()

  // Cria custom fields novos primeiro (apenas se opção marcada)
  if (options.createMissingFields) {
    for (const m of mapping) {
      const t = m.target
      if (typeof t === 'object' && t.kind === 'customField') {
        if (!lookups.customFieldsByKey.has(t.key)) {
          await prisma.customField.upsert({
            where: { key: t.key },
            create: {
              key: t.key,
              label: t.label,
              type: t.type,
              group: 'custom',
              active: true,
              showInList: false,
              showInKanban: false,
              showInForm: false,
            },
            update: {},
          })
          lookups.customFieldsByKey.set(t.key, { key: t.key, label: t.label, type: t.type })
        }
      }
    }
  }

  const result: ExecuteResult = { created: 0, updated: 0, skipped: 0, failed: [] }

  // Processa em chunks de 50 (não paralelo — preserva ordem + evita race no dedup)
  const CHUNK = 50
  for (let chunkStart = 0; chunkStart < parsed.rows.length; chunkStart += CHUNK) {
    const chunkEnd = Math.min(chunkStart + CHUNK, parsed.rows.length)
    for (let i = chunkStart; i < chunkEnd; i++) {
      if (!acceptedLineIndices.has(i)) {
        result.skipped++
        continue
      }
      const row = parsed.rows[i]!
      try {
        await processRow(i, row, mapping, options, lookups, importedByUserId, result)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        result.failed.push({ lineIndex: i, error: msg })
      }
    }
  }

  return result
}

async function processRow(
  lineIndex: number,
  row: Record<string, string>,
  mapping: MappingEntry[],
  options: ImportOptions,
  lookups: LookupCaches,
  importedByUserId: number,
  result: ExecuteResult,
): Promise<void> {
  const parsedRow = parseRow(row, mapping, lookups)
  const wa = (parsedRow.parsedFields.whatsapp as string | undefined) || ''
  const em = (parsedRow.parsedFields.email as string | undefined) || ''
  if (!wa && !em) {
    result.skipped++
    return
  }
  if (!parsedRow.parsedFields.empresa && !parsedRow.parsedFields.nome) {
    result.skipped++
    return
  }

  const matchWa = options.matchBy === 'email_first' ? undefined : wa
  const matchEm = options.matchBy === 'whatsapp_only' ? undefined : em
  const dup = await findDuplicate(matchWa, matchEm)

  if (dup.lead) {
    // UPDATE — só preenche vazios (a menos que override ou migrationMode pra campos sensíveis)
    const existingLead = dup.lead as any
    const updateData: any = {}
    const SENSITIVE_FIELDS = new Set(['status', 'outcome'])
    for (const [field, newVal] of Object.entries(parsedRow.parsedFields)) {
      const isSensitive = SENSITIVE_FIELDS.has(field)
      if (isSensitive && !options.migrationMode) continue
      const oldVal = existingLead[field]
      if (oldVal == null || oldVal === '') {
        updateData[field] = newVal
      } else if (options.overrideFilled || (isSensitive && options.migrationMode)) {
        updateData[field] = newVal
      }
    }
    // outcomeAt automático quando outcome mudou
    if (updateData.outcome != null && updateData.outcome !== existingLead.outcome) {
      updateData.outcomeAt = new Date()
    }
    // customFields merge
    const existingCF = (existingLead.customFields || {}) as Record<string, unknown>
    const mergedCF: Record<string, unknown> = { ...existingCF }
    let cfChanged = false
    for (const [k, v] of Object.entries(parsedRow.customFields)) {
      const old = existingCF[k]
      if (old == null || old === '') {
        mergedCF[k] = v
        cfChanged = true
      } else if (options.overrideFilled) {
        mergedCF[k] = v
        cfChanged = true
      }
    }
    if (cfChanged) updateData.customFields = mergedCF

    // Reforma FImp.7: migrationMode atualiza campos extras de histórico
    if (options.migrationMode) {
      // Owner: só se lead atual estiver SEM owner (não rouba atendimento)
      if (parsedRow.ownerUserId && existingLead.assignedUserId == null) {
        updateData.assignedUserId = parsedRow.ownerUserId
        updateData.assignedAt = new Date()
        // teamId: herda do 1º team do owner se ainda não tem
        if (existingLead.teamId == null) {
          const tm = await prisma.teamMember.findFirst({
            where: { userId: parsedRow.ownerUserId, team: { active: true } },
            select: { teamId: true },
            orderBy: { id: 'asc' },
          })
          if (tm?.teamId) updateData.teamId = tm.teamId
        }
      }
      // lossReason: grava se mudou (já cobre o caso vazio→preenchido)
      if (parsedRow.lossReasonId && existingLead.lostReasonId !== parsedRow.lossReasonId) {
        updateData.lostReasonId = parsedRow.lossReasonId
      }
      // stageKey (etapa do funil): grava se mudou
      if (parsedRow.stageKey && existingLead.status !== parsedRow.stageKey) {
        updateData.status = parsedRow.stageKey
        // se funil também mudou, atualiza
        if (parsedRow.funnelId && existingLead.funnelId !== parsedRow.funnelId) {
          updateData.funnelId = parsedRow.funnelId
        }
      }
    }

    if (Object.keys(updateData).length > 0) {
      await prisma.lead.update({ where: { id: existingLead.id }, data: updateData })
    }

    // Tags: sempre MERGE (adiciona; nunca remove). Pode rodar sozinho se updateData vazio.
    if (parsedRow.tagsRequested.length > 0) {
      // Cria tags ausentes se opção ligada
      const finalTagIds: number[] = [...parsedRow.tagIds]
      for (const tName of parsedRow.tagsRequested) {
        if (!lookups.tagsByName.has(tName)) {
          if (options.createMissingFields) {
            const created = await prisma.tag.upsert({
              where: { name: tName },
              create: { name: tName, color: '#6B7280', active: true },
              update: {},
            })
            lookups.tagsByName.set(tName, created.id)
            finalTagIds.push(created.id)
          }
        }
      }
      // Merge: cria LeadTag para os IDs que ainda não existem (upsert via unique)
      for (const tId of [...new Set(finalTagIds)]) {
        await prisma.leadTag.upsert({
          where: { leadId_tagId: { leadId: existingLead.id, tagId: tId } },
          create: { leadId: existingLead.id, tagId: tId },
          update: {},
        })
      }
    }

    if (Object.keys(updateData).length > 0 || parsedRow.tagsRequested.length > 0) {
      logEvent({
        leadId: existingLead.id,
        type: EVENT_TYPES.LEAD_EDITED,
        category: 'lifecycle',
        title: `Lead atualizado via importação (linha ${lineIndex + 1})`,
        source: 'csv_import',
        actorType: 'system',
        metadata: { importedByUserId, fields: Object.keys(updateData), tags: parsedRow.tagsRequested },
      })
    }
    result.updated++
    return
  }

  // CREATE — resolve team padrão se não veio
  let teamId: number | null = null
  if (parsedRow.ownerUserId) {
    // Pega 1º team do owner
    const tm = await prisma.teamMember.findFirst({
      where: { userId: parsedRow.ownerUserId, team: { active: true } },
      select: { teamId: true },
      orderBy: { id: 'asc' },
    })
    teamId = tm?.teamId ?? null
  }
  if (!teamId) {
    teamId = await resolveDefaultTeamId({})
  }

  const created = await prisma.lead.create({
    data: {
      uid: await generateUid(),
      empresa: (parsedRow.parsedFields.empresa as string) || (parsedRow.parsedFields.nome as string) || 'Lead importado',
      nome: (parsedRow.parsedFields.nome as string) || '',
      whatsapp: wa || '',
      email: em || '',
      segmento: (parsedRow.parsedFields.segmento as string) || null,
      cidade: (parsedRow.parsedFields.cidade as string) || null,
      formData: {},
      scores: {},
      lastStep: 0,
      completed: false,
      status: (parsedRow.stageKey as string) || 'NOVO',
      funnelId: parsedRow.funnelId,
      teamId,
      assignedUserId: parsedRow.ownerUserId,
      assignedAt: parsedRow.ownerUserId ? new Date() : null,
      source: 'csv_import',
      customFields: Object.keys(parsedRow.customFields).length > 0 ? (parsedRow.customFields as any) : undefined,
      qualifiedAt: new Date(),
      qualificationSource: 'manual',
      lostReasonId: parsedRow.lossReasonId,
      outcome: (parsedRow.parsedFields.outcome as 'won' | 'lost') || null,
      outcomeAt: parsedRow.parsedFields.outcome ? new Date() : null,
    },
  })

  // Tags no CREATE (mesma lógica de auto-criar)
  if (parsedRow.tagsRequested.length > 0) {
    const finalTagIds: number[] = [...parsedRow.tagIds]
    for (const tName of parsedRow.tagsRequested) {
      if (!lookups.tagsByName.has(tName)) {
        if (options.createMissingFields) {
          const createdTag = await prisma.tag.upsert({
            where: { name: tName },
            create: { name: tName, color: '#6B7280', active: true },
            update: {},
          })
          lookups.tagsByName.set(tName, createdTag.id)
          finalTagIds.push(createdTag.id)
        }
      }
    }
    for (const tId of [...new Set(finalTagIds)]) {
      await prisma.leadTag.upsert({
        where: { leadId_tagId: { leadId: created.id, tagId: tId } },
        create: { leadId: created.id, tagId: tId },
        update: {},
      })
    }
  }

  logEvent({
    leadId: created.id,
    type: EVENT_TYPES.LEAD_CREATED,
    category: 'lifecycle',
    title: `Lead criado via importação (linha ${lineIndex + 1})`,
    source: 'csv_import',
    actorType: 'system',
    metadata: { importedByUserId, fileName: 'planilha', tags: parsedRow.tagsRequested },
  })
  result.created++
}
