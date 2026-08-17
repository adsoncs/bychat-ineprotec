// src/services/smartBroadcast/planner.ts
//
// Audiência e agenda.
//
// Diferente do disparo pela Cloud API, aqui a campanha não é "solta na fila e
// que a fila resolva": antes de qualquer envio o sistema calcula QUEM recebe, de
// QUAL número e em QUE HORÁRIO — e persiste isso. O operador vê a agenda inteira
// antes de autorizar ("começa segunda 09:14, termina quarta 16:20, 3 números,
// no máximo 20 por número por dia"), e o motor apenas executa o que foi
// planejado.
//
// Planejar antes também é o que permite o botão "Simular": roda tudo, mostra o
// resultado e não envia nada.

import { prisma } from '../../lib/prisma.js'
import { phoneKey, toWaNumber } from '../../lib/phone.js'
import { DEFAULT_PACING, DEFAULT_WINDOW, planSchedule, summarizeSchedule, type PacingConfig, type WindowConfig } from './pacing.js'
import { DEFAULT_WARMUP_CURVE } from './health.js'
import { resolvePool, distribute, type PoolEntry } from './senderPool.js'
import { checkNumbers } from './precheck.js'
import { primaryVariantIndex, contentDiversity, type MessageBlock } from './variants.js'
import { suppressedKeys } from './suppression.js'
import { preferredHours, orderByPreferredHour } from './preferredTime.js'
import { assessRisk, type RiskReport } from './risk.js'

export const MAX_RECIPIENTS = 20_000

// ─── Variáveis do destinatário ──────────────────────────
// Sem template HSM não há "mapeamento de variáveis": o operador escreve
// {{nome}} no texto e o sistema resolve contra o lead (ou contra as colunas da
// planilha). Menos passo no wizard, menos erro.

function firstName(full: string | null | undefined): string {
  return String(full ?? '').trim().split(/\s+/)[0] ?? ''
}

export function varsFromLead(lead: any): Record<string, string> {
  const vars: Record<string, string> = {
    nome: String(lead.nome ?? '').trim(),
    primeiro_nome: firstName(lead.nome),
    empresa: String(lead.empresa ?? '').trim(),
    email: String(lead.email ?? '').trim(),
    cidade: String(lead.cidade ?? '').trim(),
    segmento: String(lead.segmento ?? '').trim(),
  }
  const cf = (lead.customFields ?? {}) as Record<string, unknown>
  for (const [k, v] of Object.entries(cf)) {
    if (v == null || typeof v === 'object') continue
    vars[k.toLowerCase().replace(/[^a-z0-9_]/g, '_')] = String(v)
  }
  return vars
}

export function varsFromRow(row: Record<string, string>): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const [k, v] of Object.entries(row)) {
    vars[k.toLowerCase().trim().replace(/[^a-z0-9_]/g, '_')] = String(v ?? '')
  }
  if (vars.nome) vars.primeiro_nome = firstName(vars.nome)
  return vars
}

// ─── Opt-out em massa ───────────────────────────────────
// A checagem definitiva é por lead, no momento do envio (messageGovernance).
// Esta aqui é a peneira grossa, para o operador já ver na tela quantos saíram.

/**
 * Quem não pode receber, com o MOTIVO separado: opt-out do próprio lead e lista
 * de supressão global são coisas diferentes, e o operador precisa distinguir na
 * tela ("pediu para sair" ≠ "está na lista de bloqueio da empresa").
 */
async function blockedKeys(candidates: string[]): Promise<{ optOut: Set<string>; suppressed: Set<string> }> {
  const [optOut, suppressed] = await Promise.all([optedOutKeys(), suppressedKeys(candidates)])
  return { optOut, suppressed }
}

/** Motivo do bloqueio deste telefone, se houver. */
function blockReason(blocked: { optOut: Set<string>; suppressed: Set<string> }, key: string): string | null {
  if (blocked.suppressed.has(key)) return 'suppressed'
  if (blocked.optOut.has(key)) return 'opt_out'
  return null
}

async function optedOutKeys(): Promise<Set<string>> {
  const blocked = new Set<string>()
  const leads = await prisma.lead.findMany({
    where: { optOutChannels: { not: null as any } },
    select: { whatsapp: true, optOutChannels: true },
  })
  for (const l of leads) {
    const ch = Array.isArray(l.optOutChannels) ? (l.optOutChannels as string[]) : []
    if (!ch.includes('whatsapp') || !l.whatsapp) continue
    const k = phoneKey(l.whatsapp)
    if (k) blocked.add(k)
  }
  return blocked
}

// ─── Construção da audiência ────────────────────────────

interface PreparedRecipient {
  leadId: number | null
  phone: string
  phoneKey: string
  name: string | null
  variables: Record<string, string>
  skipReason?: string
}

async function persist(campaignId: number, prepared: PreparedRecipient[], blocks: MessageBlock[]): Promise<{ created: number; skipped: number }> {
  await prisma.smartCampaignRecipient.deleteMany({ where: { campaignId } })
  const limited = prepared.slice(0, MAX_RECIPIENTS)
  let created = 0
  let skipped = 0
  for (let i = 0; i < limited.length; i += 500) {
    const chunk = limited.slice(i, i + 500)
    await prisma.smartCampaignRecipient.createMany({
      data: chunk.map((r) => ({
        campaignId,
        leadId: r.leadId,
        phone: r.phone,
        phoneKey: r.phoneKey,
        name: r.name,
        variables: r.variables,
        variantIndex: primaryVariantIndex(blocks, r.phoneKey),
        status: r.skipReason ? 'skipped' : 'pending',
        skipReason: r.skipReason ?? null,
      })),
    })
    for (const r of chunk) r.skipReason ? skipped++ : created++
  }
  await prisma.smartCampaign.update({
    where: { id: campaignId },
    data: { totalRecipients: created, skippedCount: skipped },
  })
  return { created, skipped }
}

export async function buildRecipientsFromLeads(campaign: any, leads: any[]): Promise<{ created: number; skipped: number }> {
  const blocks = (campaign.messageBlocks ?? []) as MessageBlock[]
  const blocked = await blockedKeys(leads.map((l: any) => phoneKey(l.whatsapp ?? '') ?? '').filter(Boolean))
  const seen = new Set<string>()
  const prepared: PreparedRecipient[] = []

  for (const lead of leads) {
    const key = phoneKey(lead.whatsapp ?? '')
    const wa = toWaNumber(lead.whatsapp ?? '')
    if (!key || !wa) {
      prepared.push({ leadId: lead.id, phone: String(lead.whatsapp ?? '(vazio)').slice(0, 30), phoneKey: '', name: lead.nome ?? null, variables: {}, skipReason: 'invalid_phone' })
      continue
    }
    if (seen.has(key)) {
      prepared.push({ leadId: lead.id, phone: wa, phoneKey: key, name: lead.nome ?? null, variables: {}, skipReason: 'duplicate' })
      continue
    }
    seen.add(key)
    prepared.push({
      leadId: lead.id, phone: wa, phoneKey: key, name: lead.nome ?? null,
      variables: varsFromLead(lead),
      ...((r) => (r ? { skipReason: r } : {}))(blockReason(blocked, key)),
    })
  }
  return persist(campaign.id, prepared, blocks)
}

export async function buildRecipientsFromRows(
  campaign: any,
  rows: Record<string, string>[],
  phoneColumn: string,
  nameColumn?: string,
): Promise<{ created: number; skipped: number }> {
  const blocks = (campaign.messageBlocks ?? []) as MessageBlock[]
  const blocked = await blockedKeys(rows.map((r) => phoneKey(r[phoneColumn] ?? '') ?? '').filter(Boolean))
  const seen = new Set<string>()
  const prepared: PreparedRecipient[] = []

  for (const row of rows) {
    const raw = row[phoneColumn] ?? ''
    const key = phoneKey(raw)
    const wa = toWaNumber(raw)
    const name = nameColumn ? (row[nameColumn] ?? null) : null
    if (!key || !wa) {
      prepared.push({ leadId: null, phone: String(raw || '(vazio)').slice(0, 30), phoneKey: '', name, variables: {}, skipReason: 'invalid_phone' })
      continue
    }
    if (seen.has(key)) {
      prepared.push({ leadId: null, phone: wa, phoneKey: key, name, variables: {}, skipReason: 'duplicate' })
      continue
    }
    seen.add(key)
    prepared.push({
      leadId: null, phone: wa, phoneKey: key, name,
      variables: varsFromRow(row),
      ...((r) => (r ? { skipReason: r } : {}))(blockReason(blocked, key)),
    })
  }
  return persist(campaign.id, prepared, blocks)
}

// ─── Plano de envio ─────────────────────────────────────

export interface PlanSummary {
  totalPlanned: number
  notOnWhatsApp: number
  byAffinity: number
  /** Quantas mensagens realmente distintas a lista vai produzir (amostra). */
  diversity: { sampled: number; distinct: number; ratio: number; topRepeated: number }
  firstAt: string | null
  lastAt: string | null
  perSender: Array<{ instanceName: string; count: number; warmupDay: number; dailyCap: number; state: string }>
  perDay: Array<{ day: string; count: number }>
  warnings: string[]
  /** Nota consolidada de risco do disparo (0-100) com os fatores que pesaram. */
  risk: RiskReport
}

export interface PlanOptions {
  /** Só calcula e devolve o resumo — não grava plannedAt nem marca ninguém. */
  dryRun?: boolean
  /** Não começar antes disto (padrão: agora). */
  startFrom?: Date
  /** Pula a consulta de existência no WhatsApp (usada na simulação rápida). */
  skipNumberCheck?: boolean
}

/**
 * Calcula (e normalmente grava) a agenda da campanha: número responsável e
 * horário de cada destinatário.
 */
export async function planCampaign(campaignId: number, opts: PlanOptions = {}): Promise<PlanSummary> {
  const campaign = await prisma.smartCampaign.findUnique({ where: { id: campaignId } })
  if (!campaign) throw new Error('Campanha não encontrada')

  const pacing: PacingConfig = { ...DEFAULT_PACING, ...((campaign.pacingConfig ?? {}) as Partial<PacingConfig>) }
  const window: WindowConfig = { ...DEFAULT_WINDOW, ...((campaign.windowConfig ?? {}) as Partial<WindowConfig>) }
  const warnings: string[] = []

  const pool = await resolvePool(campaign.senderInstances)
  if (!pool.length) throw new Error('Nenhum número disponível: verifique se as conexões escolhidas estão ativas')

  const blocked = pool.filter((p) => p.health.state === 'blocked')
  for (const b of blocked) warnings.push(`Número ${b.instanceName} está bloqueado e não vai enviar`)
  const usable = pool.filter((p) => p.health.state !== 'blocked')
  if (!usable.length) {
    throw new Error(`Todos os números escolhidos estão bloqueados (${blocked.map((b) => b.instanceName).join(', ')}). Reconecte o número pelo QR ou escolha outra conexão.`)
  }

  const recipients = await prisma.smartCampaignRecipient.findMany({
    where: { campaignId, status: { in: ['pending', 'scheduled'] } },
    select: { id: true, leadId: true, phone: true, phoneKey: true },
    orderBy: { id: 'asc' },
  })
  if (!recipients.length) throw new Error('Nenhum destinatário pendente para planejar')

  // ── Pré-checagem: quem não existe no WhatsApp sai antes de custar envio ──
  let notOnWhatsApp = 0
  let eligible = recipients
  // A checagem protege o remetente, mas é a etapa mais lenta do planejamento e
  // depende da Evolution estar respondendo. Em lista já conhecida o operador
  // pode dispensá-la na própria campanha.
  const skipCheck = opts.skipNumberCheck || campaign.skipNumberCheck === true
  if (!skipCheck) {
    const { map } = await checkNumbers(usable[0]!.instanceName, recipients.map((r) => r.phone))
    const missing = recipients.filter((r) => map.get(r.phoneKey) === false)
    notOnWhatsApp = missing.length
    if (missing.length && !opts.dryRun) {
      await prisma.smartCampaignRecipient.updateMany({
        where: { id: { in: missing.map((m) => m.id) } },
        data: { status: 'skipped', skipReason: 'not_on_whatsapp' },
      })
    }
    const missingIds = new Set(missing.map((m) => m.id))
    eligible = recipients.filter((r) => !missingIds.has(r.id))
    if (notOnWhatsApp / Math.max(1, recipients.length) > 0.2) {
      warnings.push(`${Math.round((notOnWhatsApp / recipients.length) * 100)}% dos números não existem no WhatsApp — sinal de lista desatualizada`)
    }
  }
  if (!eligible.length) {
    // Sem esta saída o operador ficava sem entender: a lista existe, mas a
    // checagem devolveu "não existe" para todo mundo — o que quase sempre é a
    // Evolution respondendo mal, não uma lista 100% inválida.
    throw new Error(
      `Nenhum dos ${recipients.length} números passou na checagem do WhatsApp. `
      + 'Se a lista é boa, marque "não verificar números" no passo de ritmo e planeje de novo.',
    )
  }

  // ── Quem fala com quem ──
  const assignments = await distribute(eligible, usable)
  const byAffinity = assignments.filter((a) => a.byAffinity).length

  // ── Agenda por número (cada um com sua escada de aquecimento) ──
  const startFrom = opts.startFrom ?? (campaign.scheduledAt && campaign.scheduledAt > new Date() ? campaign.scheduledAt : new Date())
  const bySender = new Map<number, typeof assignments>()
  for (const a of assignments) {
    const list = bySender.get(a.instanceId) ?? []
    list.push(a)
    bySender.set(a.instanceId, list)
  }

  // Escada de aquecimento do PERFIL de ritmo escolhido (o campo já existia no
  // modelo e nunca era lido — todo mundo usava a curva embutida). Quem quiser
  // aquecer mais rápido cria um perfil próprio em vez de pedir código novo.
  const profile = campaign.pacingProfileId
    ? await prisma.smartPacingProfile.findUnique({ where: { id: campaign.pacingProfileId } }).catch(() => null)
    : null
  const profileCurve = Array.isArray(profile?.warmupCurve) ? (profile!.warmupCurve as number[]) : null
  const warmupCurve = profileCurve?.length ? profileCurve.filter((n) => Number(n) > 0) : DEFAULT_WARMUP_CURVE

  const allDates: Date[] = []
  const capAboveCurve: string[] = []
  const perSender: PlanSummary['perSender'] = []
  const updates: Array<{ id: number; instanceId: number; instanceName: string; plannedAt: Date }> = []

  // Melhor horário por contato: reordena a fila de cada número para que quem
  // responde cedo pegue os primeiros horários do dia.
  const leadIdByRecipient = new Map<number, number | null>(eligible.map((r) => [r.id, r.leadId]))
  const hours = campaign.usePreferredTime
    ? await preferredHours(eligible.map((r) => r.leadId).filter((n): n is number => typeof n === 'number'))
    : new Map<number, number>()

  for (const entry of usable) {
    const list = campaign.usePreferredTime
      ? orderByPreferredHour(bySender.get(entry.instanceId) ?? [], leadIdByRecipient, hours)
      : (bySender.get(entry.instanceId) ?? [])
    if (!list.length) continue
    // Escada a partir do degrau atual do número: quem já está aquecido não volta
    // para 20/dia só porque a campanha é nova.
    const curve = warmupCurve.slice(Math.max(0, entry.health.warmupDay - 1))
    // O teto informado pelo operador MANDA. Antes ele só podia reduzir (o
    // `Math.min` com a escada), então quem tinha um número antigo e queria
    // 300/dia continuava preso em 20 sem entender por quê. A escada segue como
    // padrão de quem não mexe no campo.
    const requested = Number(campaign.dailyCapPerNumber) || 0
    const cap = requested > 0 ? requested : (curve[0] ?? 20)
    const dailyCap = requested > 0
      ? requested
      : [cap, ...curve.slice(1)]
    if (requested > 0 && requested > (curve[0] ?? 20)) {
      capAboveCurve.push(`${entry.instanceName} (${requested}/dia contra ${curve[0] ?? 20} da escada)`)
    }

    const dates = planSchedule({ count: list.length, startFrom, pacing, window, dailyCap })
    for (let i = 0; i < list.length; i++) {
      const at = dates[i]
      if (!at) continue
      allDates.push(at)
      updates.push({ id: list[i]!.recipientId, instanceId: entry.instanceId, instanceName: entry.instanceName, plannedAt: at })
    }
    perSender.push({
      instanceName: entry.instanceName,
      count: list.length,
      warmupDay: entry.health.warmupDay,
      dailyCap: cap,
      state: entry.health.state,
    })
  }

  allDates.sort((a, b) => a.getTime() - b.getTime())
  const summary = summarizeSchedule(allDates, window.timezone)

  if (!opts.dryRun) {
    // Grava em lotes; cada destinatário tem horário e número próprios.
    for (const u of updates) {
      await prisma.smartCampaignRecipient.update({
        where: { id: u.id },
        data: {
          assignedInstanceId: u.instanceId,
          assignedInstance: u.instanceName,
          plannedAt: u.plannedAt,
          status: 'scheduled',
          scheduledAt: new Date(),
        },
      })
    }
  }

  if (perSender.length === 1 && updates.length > 200) {
    warnings.push('Um único número para toda a campanha: considere distribuir entre 2 ou 3 conexões')
  }
  if (capAboveCurve.length) {
    warnings.push(`Teto acima da escada de aquecimento em ${capAboveCurve.join(', ')} — vale só para número antigo, com histórico de conversa`)
  }

  // ── Diversidade real do conteúdo ──
  const sample = await prisma.smartCampaignRecipient.findMany({
    where: { campaignId, status: { in: ['pending', 'scheduled'] } },
    select: { phoneKey: true, phone: true, variables: true },
    take: 300,
  })
  const blocks = ((campaign.messageBlocks ?? []) as unknown) as MessageBlock[]
  const diversity = contentDiversity(
    blocks,
    sample.map((s) => ({ phoneKey: s.phoneKey || s.phone, variables: (s.variables ?? {}) as Record<string, string> })),
    { optOutFooter: campaign.optOutFooter },
  )
  if (diversity.sampled >= 20 && diversity.ratio < 0.5) {
    warnings.push(`Só ${Math.round(diversity.ratio * 100)}% das mensagens serão diferentes entre si — acrescente variações ou use mais variáveis no texto`)
  }
  if (!campaign.optOutFooter) {
    warnings.push('Sem rodapé de saída: uma linha com "responda SAIR" reduz denúncia, que é o sinal mais caro para o número')
  }

  const risk = await assessRisk({
    campaignId,
    diversityRatio: diversity.ratio,
    notOnWhatsAppRatio: recipients.length ? notOnWhatsApp / recipients.length : 0,
    byAffinityRatio: assignments.length ? byAffinity / assignments.length : 0,
  })

  return {
    totalPlanned: updates.length,
    notOnWhatsApp,
    byAffinity,
    diversity,
    risk,
    firstAt: summary.first ? summary.first.toISOString() : null,
    lastAt: summary.last ? summary.last.toISOString() : null,
    perSender,
    perDay: summary.perDay,
    warnings,
  }
}

/** Números aptos hoje — usado pela tela para mostrar o painel de saúde. */
export async function poolStatus(senderInstances: unknown): Promise<PoolEntry[]> {
  return resolvePool(senderInstances)
}
