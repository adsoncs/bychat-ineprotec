// services/dedup.ts — UID generation, duplicate detection, flagging & lead merge
import { prisma } from '../lib/prisma.js'
import { logEvent, EVENT_TYPES } from './leadHistory.js'

// Canais de origem da Categoria A (Captura) — sempre criam lead novo + flag.
// Usado por reporting/UI pra mostrar de onde veio cada inscrição duplicada.
export type CaptureChannel = 'forms' | 'metaLeadAds' | 'enrollmentPortal' | 'publicApi' | 'make' | 'csv_import' | 'inbound_webhook'

// ── Settings dedup.mode.* (Fase 24, F4) ─────────────────────
//
// Cada canal de captura pode ser configurado pelo admin:
//   'always_new'      — comportamento padrão (Categoria A pura): cria novo + flag
//   'update_existing' — comportamento legado: faz upsert por whatsapp/email (sem flag)
//
// Lê de Setting com chave dedup.mode.<channel>. Cache in-memory de 60s pra não
// bater no DB em todo lead criado.

export type DedupMode = 'always_new' | 'update_existing'

const DEDUP_MODE_CACHE: Map<string, { value: DedupMode; expiresAt: number }> = new Map()
const DEDUP_MODE_TTL_MS = 60_000

function settingKey(channel: CaptureChannel): string {
  return `dedup.mode.${channel}`
}

export async function getDedupMode(channel: CaptureChannel): Promise<DedupMode> {
  const key = settingKey(channel)
  const cached = DEDUP_MODE_CACHE.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  let value: DedupMode = 'always_new' // default Categoria A
  try {
    const row = await prisma.setting.findUnique({ where: { key }, select: { value: true } })
    if (row) {
      const v = (row.value as any)
      const raw = typeof v === 'string' ? v : (v?.mode || v?.value || '')
      if (raw === 'update_existing' || raw === 'always_new') value = raw
    }
  } catch {
    // ignore — usa default
  }
  DEDUP_MODE_CACHE.set(key, { value, expiresAt: Date.now() + DEDUP_MODE_TTL_MS })
  return value
}

export function invalidateDedupModeCache(channel?: CaptureChannel) {
  if (channel) DEDUP_MODE_CACHE.delete(settingKey(channel))
  else DEDUP_MODE_CACHE.clear()
}

// ── UID Generation ──────────────────────────────────────────

function randomChars(n: number): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // sem I/O/0/1 para evitar confusão
  let result = ''
  for (let i = 0; i < n; i++) result += chars[Math.floor(Math.random() * chars.length)]
  return result
}

export async function generateUid(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const uid = `LD-${randomChars(6)}`
    const exists = await prisma.lead.findUnique({ where: { uid } })
    if (!exists) return uid
  }
  // Fallback com timestamp
  return `LD-${Date.now().toString(36).toUpperCase().slice(-6)}${randomChars(2)}`
}

// Backfill UIDs para leads existentes sem uid
export async function backfillUids(): Promise<number> {
  const leads = await prisma.lead.findMany({
    where: { uid: null },
    select: { id: true },
  })
  let count = 0
  for (const lead of leads) {
    const uid = await generateUid()
    await prisma.lead.update({ where: { id: lead.id }, data: { uid } })
    count++
  }
  return count
}

// ── Phone normalization ─────────────────────────────────────

export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '')
}

export function phoneDigits(phone: string, last = 8): string {
  const clean = normalizePhone(phone)
  return clean.length >= last ? clean.slice(-last) : clean
}

// ── Duplicate Detection ─────────────────────────────────────

export interface DedupResult {
  lead: any | null
  matchType: 'whatsapp' | 'email' | null
}

/**
 * Busca lead duplicado por WhatsApp (prioridade) ou email (fallback).
 * WhatsApp é chave primária por ser sistema de conversação.
 */
export async function findDuplicate(whatsapp?: string, email?: string): Promise<DedupResult> {
  // 1. WhatsApp — chave principal
  if (whatsapp) {
    const digits = phoneDigits(whatsapp)
    if (digits.length >= 8) {
      const lead = await prisma.lead.findFirst({
        where: { whatsapp: { contains: digits } },
        orderBy: { createdAt: 'desc' },
      })
      if (lead) return { lead, matchType: 'whatsapp' }
    }
  }

  // 2. Email — fallback para canais sem whatsapp
  if (email && email.includes('@')) {
    const lead = await prisma.lead.findFirst({
      where: { email: email.toLowerCase().trim() },
      orderBy: { createdAt: 'desc' },
    })
    if (lead) return { lead, matchType: 'email' }
  }

  return { lead: null, matchType: null }
}

/**
 * Busca TODOS os possíveis duplicados de um lead (para sugestão de merge).
 */
export async function findAllDuplicates(leadId: number): Promise<any[]> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } })
  if (!lead) return []

  const duplicates: any[] = []
  const seenIds = new Set([leadId])

  // Por WhatsApp
  if (lead.whatsapp) {
    const digits = phoneDigits(lead.whatsapp)
    if (digits.length >= 8) {
      const matches = await prisma.lead.findMany({
        where: { whatsapp: { contains: digits }, id: { not: leadId } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      })
      matches.forEach(m => { if (!seenIds.has(m.id)) { seenIds.add(m.id); duplicates.push({ ...m, matchType: 'whatsapp' }) } })
    }
  }

  // Por Email
  if (lead.email && lead.email.includes('@')) {
    const matches = await prisma.lead.findMany({
      where: { email: lead.email.toLowerCase().trim(), id: { not: leadId } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    })
    matches.forEach(m => { if (!seenIds.has(m.id)) { seenIds.add(m.id); duplicates.push({ ...m, matchType: 'email' }) } })
  }

  return duplicates
}

// ── Flag Duplicate (Fase 24, Categoria A) ───────────────────
//
// Pipeline de captura:
//   1. Cria lead novo sempre (forms.ts/meta.ts/enrollmentPortals.ts/publicApi.ts/make.ts).
//   2. Chama flagDuplicate(newLeadId, channel) → busca master, sinaliza, herda dono,
//      cria LeadNote em ambos, dispara evento.
//
// O lead novo segue normalmente pelo funil: cadência roda, automação dispara, etc.
// (decisão do usuário 2026-05-06: duplicado recebe tudo, só fica observação).
// Operador resolve depois em /app/leads/duplicates: Mesclar (mergeLeads) ou Manter.

export interface FlagDuplicateInput {
  newLeadId: number
  channel: CaptureChannel
  /** Permite forçar a busca a usar dados específicos (ex: telefone vindo do payload
   *  bruto, antes da normalização final). Se omitido, lê do próprio lead. */
  whatsapp?: string
  email?: string
}

export interface FlagDuplicateResult {
  flagged: boolean
  masterId?: number
  matchType?: 'whatsapp' | 'email'
}

/**
 * Marca o lead novo como possível duplicado quando há match com lead anterior.
 * Side-effects (executados em ordem; falhas em LeadNote/event não revertem o flag):
 *   - Lead.{possibleDuplicateOfId, duplicateStatus='pending_review', duplicateMatchedBy, duplicateFlaggedAt}
 *   - Herda assignedUserId/teamId do master se o novo não tiver dono ainda
 *   - Cria LeadNote nos 2 leads (autoria 'system') com link cruzado
 *   - Dispara LeadEvent DUPLICATE_DETECTED em ambos
 */
export async function flagDuplicate(input: FlagDuplicateInput): Promise<FlagDuplicateResult> {
  // Setting dedup.mode.<channel> controla se flagging está ativo.
  // 'always_new'      — flag normal (default Categoria A)
  // 'update_existing' — admin desativou: não sinaliza nada (lead novo passa silencioso)
  const mode = await getDedupMode(input.channel)
  if (mode === 'update_existing') return { flagged: false }

  const newLead = await prisma.lead.findUnique({
    where: { id: input.newLeadId },
    select: {
      id: true, uid: true, nome: true, whatsapp: true, email: true,
      assignedUserId: true, teamId: true,
    },
  })
  if (!newLead) return { flagged: false }

  const wa = input.whatsapp ?? newLead.whatsapp ?? ''
  const em = (input.email ?? newLead.email ?? '').toLowerCase().trim()
  if (!wa && !em) return { flagged: false }

  // Busca master entre OUTROS leads (excluindo o próprio novo). findDuplicate
  // não filtra por id, então fazemos o filtro aqui pra cobrir o caso do
  // lead novo já estar persistido.
  const candidates: Array<{ id: number; uid: string | null; nome: string; assignedUserId: number | null; teamId: number | null; matchType: 'whatsapp' | 'email' }> = []

  if (wa) {
    const digits = phoneDigits(wa)
    if (digits.length >= 8) {
      const m = await prisma.lead.findFirst({
        where: {
          whatsapp: { contains: digits },
          id: { not: newLead.id },
        },
        select: { id: true, uid: true, nome: true, assignedUserId: true, teamId: true },
        orderBy: { createdAt: 'desc' },
      })
      if (m) candidates.push({ ...m, matchType: 'whatsapp' })
    }
  }
  if (candidates.length === 0 && em && em.includes('@')) {
    const m = await prisma.lead.findFirst({
      where: {
        email: em,
        id: { not: newLead.id },
      },
      select: { id: true, uid: true, nome: true, assignedUserId: true, teamId: true },
      orderBy: { createdAt: 'desc' },
    })
    if (m) candidates.push({ ...m, matchType: 'email' })
  }

  const master = candidates[0]
  if (!master) return { flagged: false }

  const now = new Date()

  // Se o master já está marcado como pending_review apontando pro pai dele,
  // herda o pai como master raiz — evita cadeias longas de duplicados.
  let masterId = master.id
  let masterRoot = await prisma.lead.findUnique({
    where: { id: master.id },
    select: { possibleDuplicateOfId: true, duplicateStatus: true, assignedUserId: true, teamId: true, uid: true, nome: true },
  })
  if (masterRoot?.possibleDuplicateOfId && masterRoot.duplicateStatus === 'pending_review') {
    const root = await prisma.lead.findUnique({
      where: { id: masterRoot.possibleDuplicateOfId },
      select: { id: true, uid: true, nome: true, assignedUserId: true, teamId: true },
    })
    if (root) {
      masterId = root.id
      masterRoot = { ...root, possibleDuplicateOfId: null, duplicateStatus: 'none' }
    }
  }

  // 1. Atualiza o lead novo
  const inheritAssigned = !newLead.assignedUserId && masterRoot?.assignedUserId ? masterRoot.assignedUserId : undefined
  const inheritTeam = !newLead.teamId && masterRoot?.teamId ? masterRoot.teamId : undefined
  await prisma.lead.update({
    where: { id: newLead.id },
    data: {
      possibleDuplicateOfId: masterId,
      duplicateStatus: 'pending_review',
      duplicateMatchedBy: master.matchType,
      duplicateFlaggedAt: now,
      ...(inheritAssigned !== undefined ? { assignedUserId: inheritAssigned, assignedAt: now } : {}),
      ...(inheritTeam !== undefined ? { teamId: inheritTeam } : {}),
    },
  })

  // 2. LeadNote nos dois lados (rastro humano-legível dentro do lead)
  const channelPt: Record<CaptureChannel, string> = {
    forms: 'Form/Landing Page',
    metaLeadAds: 'Meta Lead Ads',
    enrollmentPortal: 'Portal de Matrículas',
    publicApi: 'API Pública',
    make: 'Make.com',
    csv_import: 'Importação CSV',
    inbound_webhook: 'Webhook de Entrada',
  }
  const matchPt = master.matchType === 'whatsapp' ? 'WhatsApp' : 'e-mail'
  const newLeadLabel = newLead.uid ? `#${newLead.id} (${newLead.uid})` : `#${newLead.id}`
  const masterLabel = masterRoot?.uid ? `#${masterId} (${masterRoot.uid})` : `#${masterId}`
  try {
    await prisma.leadNote.createMany({
      data: [
        {
          leadId: newLead.id,
          userId: null,
          userName: 'Sistema',
          content: `Possível duplicado de ${masterLabel}${masterRoot?.nome ? ' — ' + masterRoot.nome : ''}. Match por ${matchPt}, captura via ${channelPt[input.channel]}. Pendente de revisão.`,
        },
        {
          leadId: masterId,
          userId: null,
          userName: 'Sistema',
          content: `Nova inscrição duplicada criada: ${newLeadLabel}${newLead.nome ? ' — ' + newLead.nome : ''}. Match por ${matchPt}, captura via ${channelPt[input.channel]}. Pendente de revisão.`,
        },
      ],
    })
  } catch {
    // best-effort — não revertemos o flag se a nota falhar
  }

  // 3. Eventos (audit log + domain events pra workflow/CAPI)
  logEvent({
    leadId: newLead.id,
    type: EVENT_TYPES.DUPLICATE_DETECTED,
    category: 'lifecycle',
    title: `Possível duplicado de ${masterLabel}`,
    source: input.channel,
    actorType: 'system',
    description: `Match por ${matchPt} via ${channelPt[input.channel]}. Decisão pendente em /app/leads/duplicates.`,
    metadata: {
      role: 'duplicate',
      masterLeadId: masterId,
      matchType: master.matchType,
      channel: input.channel,
    },
  })
  logEvent({
    leadId: masterId,
    type: EVENT_TYPES.DUPLICATE_DETECTED,
    category: 'lifecycle',
    title: `Nova inscrição duplicada: ${newLeadLabel}`,
    source: input.channel,
    actorType: 'system',
    description: `Lead novo criado por ${channelPt[input.channel]} casou com este por ${matchPt}.`,
    metadata: {
      role: 'master',
      duplicateLeadId: newLead.id,
      matchType: master.matchType,
      channel: input.channel,
    },
  })

  return { flagged: true, masterId, matchType: master.matchType }
}

// ── Lead Merge ──────────────────────────────────────────────

interface MergeOptions {
  keepId: number     // ID do lead que será mantido (principal)
  mergeId: number    // ID do lead que será mesclado (secundário)
  operatorName?: string
  operatorId?: number
}

/**
 * Mescla dois leads: mantém o principal, absorve dados do secundário,
 * move mensagens/eventos/atividades, e exclui o secundário.
 */
export async function mergeLeads(opts: MergeOptions) {
  const { keepId, mergeId } = opts

  const [keep, merge] = await Promise.all([
    prisma.lead.findUnique({ where: { id: keepId } }),
    prisma.lead.findUnique({ where: { id: mergeId } }),
  ])

  if (!keep || !merge) throw new Error('Lead não encontrado')
  if (keepId === mergeId) throw new Error('Não é possível mesclar um lead consigo mesmo')

  // 1. Mesclar dados: preencher campos vazios do principal com dados do secundário
  const updateData: any = {}
  if (!keep.nome && merge.nome) updateData.nome = merge.nome
  if (!keep.empresa && merge.empresa) updateData.empresa = merge.empresa
  if (!keep.email && merge.email) updateData.email = merge.email
  if (!keep.whatsapp && merge.whatsapp) updateData.whatsapp = merge.whatsapp
  if (!keep.segmento && merge.segmento) updateData.segmento = merge.segmento
  if (!keep.cidade && merge.cidade) updateData.cidade = merge.cidade
  if (!keep.solucaoNome && merge.solucaoNome) updateData.solucaoNome = merge.solucaoNome
  if (!keep.maturidade && merge.maturidade) updateData.maturidade = merge.maturidade
  if (!keep.source && merge.source) updateData.source = merge.source

  // Mesclar scores: se o principal não tem score, usar do secundário
  const keepScores = (keep.scores as any) || {}
  const mergeScores = (merge.scores as any) || {}
  if (!keepScores.geral && mergeScores.geral) {
    updateData.scores = { ...mergeScores, ...keepScores }
  }

  // Mesclar customFields
  const keepCF = (keep.customFields as any) || {}
  const mergeCF = (merge.customFields as any) || {}
  if (Object.keys(mergeCF).length > 0) {
    const merged: Record<string, any> = { ...mergeCF, ...keepCF } // principal tem prioridade
    updateData.customFields = Object.keys(merged).length > 0 ? merged : undefined
  }

  // Mesclar campaign data
  if (!keep.campaignId && merge.campaignId) updateData.campaignId = merge.campaignId
  if (!keep.campaignName && merge.campaignName) updateData.campaignName = merge.campaignName
  if (!keep.utmSource && merge.utmSource) updateData.utmSource = merge.utmSource
  if (!keep.utmMedium && merge.utmMedium) updateData.utmMedium = merge.utmMedium
  if (!keep.utmCampaign && merge.utmCampaign) updateData.utmCampaign = merge.utmCampaign

  // Mesclar formData: guardar dados do merge como _mergedFormData
  const keepFD = (keep.formData as any) || {}
  const mergeFD = (merge.formData as any) || {}
  if (Object.keys(mergeFD).length > 0 && !keepFD._mergedFrom) {
    updateData.formData = {
      ...keepFD,
      _mergedFrom: { leadId: mergeId, uid: merge.uid, data: mergeFD, mergedAt: new Date().toISOString() }
    }
  }

  // 2. Mover relacionamentos: mensagens, eventos, atividades
  await Promise.all([
    prisma.message.updateMany({ where: { leadId: mergeId }, data: { leadId: keepId } }),
    prisma.leadEvent.updateMany({ where: { leadId: mergeId }, data: { leadId: keepId } }),
    prisma.activity.updateMany({ where: { leadId: mergeId }, data: { leadId: keepId } }),
  ])

  // 3. Atualizar contadores
  const msgCount = await prisma.message.count({ where: { leadId: keepId } })
  const lastMsg = await prisma.message.findFirst({ where: { leadId: keepId }, orderBy: { timestamp: 'desc' } })
  if (lastMsg) {
    updateData.lastMessageAt = lastMsg.timestamp
    updateData.unreadMessages = await prisma.message.count({ where: { leadId: keepId, fromMe: false, ack: { lt: 3 } } })
  }

  // 4. Atualizar lead principal — sempre limpar flag de duplicado se estava pendente
  //    apontando pro lead absorvido (corrige cadeias após merge)
  updateData.duplicateStatus = 'none'
  updateData.possibleDuplicateOfId = null
  updateData.duplicateMatchedBy = null
  updateData.duplicateResolvedAt = new Date()
  await prisma.lead.update({ where: { id: keepId }, data: updateData })

  // 4b. Outros leads que apontavam pro mergeId como master agora apontam pro keepId
  await prisma.lead.updateMany({
    where: { possibleDuplicateOfId: mergeId },
    data: { possibleDuplicateOfId: keepId },
  })

  // 5. Log do merge
  logEvent({
    leadId: keepId,
    type: 'leads_merged',
    category: 'lifecycle',
    title: `Leads mesclados: #${mergeId} (${merge.uid || ''}) absorvido`,
    channel: 'system',
    source: 'panel',
    actorType: 'operator',
    userId: opts.operatorId,
    userName: opts.operatorName,
    description: `Lead ${merge.uid || '#' + mergeId} (${merge.nome || merge.empresa || merge.whatsapp}) foi mesclado neste lead. Mensagens, eventos e atividades foram transferidos.`,
    oldValue: JSON.stringify({ id: mergeId, uid: merge.uid, nome: merge.nome, whatsapp: merge.whatsapp, email: merge.email }),
    metadata: { mergedLeadId: mergeId, mergedUid: merge.uid },
  })

  // 6. Excluir lead secundário
  await prisma.lead.delete({ where: { id: mergeId } })

  // Retornar lead atualizado
  return prisma.lead.findUnique({ where: { id: keepId } })
}
