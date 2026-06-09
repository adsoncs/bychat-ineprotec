// src/services/enrollmentLeadBackfill.ts
//
// Garante um Lead vinculado a uma EnrollmentRegistration (inscrição do portal de
// matrículas). Usado para:
//   1. Backfill de inscrições órfãs (leadId nulo — ex.: lead apagado → onDelete:SetNull).
//   2. Botão "Criar/Vincular Lead" no módulo de Matrículas.
//
// Casa por whatsapp (últimos 8 dígitos) / email; se achar, RE-VINCULA ao lead
// existente; senão CRIA um novo (origem enrollment_portal, roteado pro funil/
// etapa/team do portal) — espelhando o lead criado pela submissão pública.

import { prisma } from '../lib/prisma.js'
import { resolveDefaultTeamId } from './teamRouting.js'
import { logEvent, EVENT_TYPES } from './leadHistory.js'

export interface EnsureLeadResult {
  leadId: number | null
  action: 'already' | 'linked' | 'created' | 'skipped'
  reason?: string
}

function pick(fd: Record<string, any>, ...keys: string[]): string {
  for (const k of keys) {
    const v = fd?.[k]
    if (v != null && String(v).trim() !== '') return String(v).trim()
  }
  return ''
}

function onlyDigits(s: string): string {
  return (s || '').replace(/\D+/g, '')
}

async function resolveEntryStageKey(funnelId: number | null, preferredKey: string | null): Promise<string | null> {
  if (!funnelId) return preferredKey
  if (preferredKey) {
    const exists = await prisma.stage.findFirst({ where: { funnelId, key: preferredKey, active: true }, select: { key: true } })
    if (exists) return exists.key
  }
  const first = await prisma.stage.findFirst({ where: { funnelId, active: true }, orderBy: { position: 'asc' }, select: { key: true } })
  return first?.key || preferredKey || null
}

/**
 * Garante o Lead da inscrição. Idempotente: se já tiver leadId, não faz nada.
 */
export async function ensureLeadForRegistration(registrationId: number): Promise<EnsureLeadResult> {
  const reg = await prisma.enrollmentRegistration.findUnique({
    where: { id: registrationId },
    include: { portal: { select: { id: true, slug: true, funnelId: true, stageKey: true, teamId: true } } },
  })
  if (!reg) return { leadId: null, action: 'skipped', reason: 'inscrição não encontrada' }
  if (reg.leadId) return { leadId: reg.leadId, action: 'already' }

  const fd = (reg.formData as Record<string, any>) || {}
  const nome = pick(fd, 'nome', 'name', 'nome_completo', 'fullName')
  const email = pick(fd, 'email', 'e_mail').toLowerCase()
  const whatsapp = pick(fd, 'whatsapp', 'telefone', 'phone', 'celular', 'telefone_celular', 'fone')
  const wppDigits = onlyDigits(whatsapp)
  const cpf = pick(fd, 'cpf')

  // 1) Tenta casar com lead existente (whatsapp últimos 8 ou email).
  let lead = null as any
  const last8 = wppDigits.slice(-8)
  if (last8.length >= 8 || email) {
    lead = await prisma.lead.findFirst({
      where: {
        OR: [
          last8.length >= 8 ? { whatsapp: { contains: last8 } } : undefined,
          email ? { email } : undefined,
        ].filter(Boolean) as any,
      },
      orderBy: { createdAt: 'desc' },
    })
  }

  if (lead) {
    await prisma.enrollmentRegistration.update({ where: { id: reg.id }, data: { leadId: lead.id } })
    logEvent({
      leadId: lead.id,
      type: EVENT_TYPES.LEAD_EDITED,
      category: 'lifecycle',
      title: `Inscrição vinculada ao lead: ${reg.candidateCode}`,
      channel: 'portal',
      source: 'enrollment_backfill',
      actorType: 'system',
      metadata: { registrationId: reg.id, portalId: reg.portalId, candidateCode: reg.candidateCode },
    })
    return { leadId: lead.id, action: 'linked' }
  }

  // 2) Cria um lead novo espelhando a submissão pública.
  const portal = reg.portal
  let funnelId: number | null = portal?.funnelId || null
  if (!funnelId) {
    const def = await prisma.funnel.findFirst({ where: { isDefault: true }, select: { id: true } })
    funnelId = def?.id || null
  }
  const stageKey = (await resolveEntryStageKey(funnelId, portal?.stageKey || null)) || 'NOVO'
  const teamId = portal?.teamId || (await resolveDefaultTeamId())

  const created = await prisma.lead.create({
    data: {
      nome: nome || `Inscrição ${reg.candidateCode}`,
      empresa: pick(fd, 'empresa') || '',
      whatsapp: whatsapp || '',
      email: email || '',
      cidade: pick(fd, 'cidade') || null,
      formData: { _source: 'enrollment_portal', _portalSlug: portal?.slug || null, _cpf: cpf || null, ...fd },
      scores: {},
      lastStep: 0,
      completed: false,
      status: stageKey,
      source: 'enrollment_portal',
      originType: 'enrollment_portal',
      teamId,
      funnelId,
      utmSource: reg.utmSource || pick(fd, 'utm_source') || null,
      utmMedium: reg.utmMedium || pick(fd, 'utm_medium') || null,
      utmCampaign: reg.utmCampaign || pick(fd, 'utm_campaign') || null,
      gclid: reg.gclid || pick(fd, 'gclid') || null,
      lastActivityAt: new Date(),
      qualifiedAt: new Date(),
      qualificationSource: 'enrollment_portal',
    },
  })

  await prisma.enrollmentRegistration.update({ where: { id: reg.id }, data: { leadId: created.id } })
  logEvent({
    leadId: created.id,
    type: EVENT_TYPES.LEAD_CREATED,
    category: 'lifecycle',
    title: `Lead recuperado da inscrição: ${reg.candidateCode}`,
    channel: 'portal',
    source: 'enrollment_backfill',
    actorType: 'system',
    metadata: { registrationId: reg.id, portalId: reg.portalId, candidateCode: reg.candidateCode, funnelId },
  })

  return { leadId: created.id, action: 'created' }
}

/** Backfill em lote de todas as inscrições órfãs (leadId nulo). */
export async function backfillOrphanRegistrations(opts?: { includeCancelled?: boolean }): Promise<{
  total: number
  created: number
  linked: number
  skipped: number
  results: Array<{ registrationId: number; status: string } & EnsureLeadResult>
}> {
  const where: any = { leadId: null }
  if (!opts?.includeCancelled) where.status = { not: 'cancelled' }

  const orphans = await prisma.enrollmentRegistration.findMany({ where, select: { id: true, status: true }, orderBy: { createdAt: 'asc' } })
  const results: Array<{ registrationId: number; status: string } & EnsureLeadResult> = []
  let created = 0, linked = 0, skipped = 0

  for (const o of orphans) {
    const r = await ensureLeadForRegistration(o.id).catch((e): EnsureLeadResult => ({ leadId: null, action: 'skipped', reason: e.message }))
    if (r.action === 'created') created++
    else if (r.action === 'linked') linked++
    else if (r.action === 'skipped') skipped++
    results.push({ registrationId: o.id, status: o.status, ...r })
  }

  return { total: orphans.length, created, linked, skipped, results }
}
