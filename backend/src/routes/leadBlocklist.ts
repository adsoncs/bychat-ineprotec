// src/routes/leadBlocklist.ts
// CRUD da lista de bloqueio de entrada de leads (Configurações › Segurança).
// A checagem em si vive em services/leadBlocklist.ts.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { adminOnly } from '../lib/auth.js'
import { logUserAudit, auditActor } from '../services/userAudit.js'
import {
  invalidateBlocklistCache, normalizeDomain, normalizeEmail, normalizePhone,
} from '../services/leadBlocklist.js'

/** Critérios normalizados do corpo da requisição. Ao menos um é obrigatório —
 *  regra vazia bloquearia todo mundo. */
function parseCriteria(b: any) {
  return {
    emailKey: normalizeEmail(b.email),
    emailDomain: normalizeDomain(b.emailDomain),
    phoneKey: normalizePhone(b.whatsapp),
    ip: String(b.ip ?? '').trim().slice(0, 45) || null,
  }
}

export async function leadBlocklistRoutes(app: FastifyInstance) {
  // ── Listagem ──
  app.get('/api/admin/security/lead-blocks', { preHandler: adminOnly }, async () => {
    const rules = await prisma.leadBlockRule.findMany({
      orderBy: [{ active: 'desc' }, { lastHitAt: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    })
    const totalHits = rules.reduce((s, r) => s + r.hits, 0)
    return { rules, totalHits }
  })

  // ── Criar ──
  app.post('/api/admin/security/lead-blocks', { preHandler: adminOnly }, async (req, reply) => {
    const b = (req.body as any) || {}
    const crit = parseCriteria(b)
    if (!crit.emailKey && !crit.emailDomain && !crit.phoneKey && !crit.ip) {
      return reply.code(400).send({ error: 'Informe ao menos um critério: e-mail, domínio, WhatsApp ou IP.' })
    }
    const actor = auditActor(req)
    const rule = await prisma.leadBlockRule.create({
      data: {
        ...crit,
        label: b.label ? String(b.label).slice(0, 191) : null,
        reason: b.reason ? String(b.reason).slice(0, 2000) : null,
        active: b.active !== false,
        createdBy: actor.actorName ?? null,
      },
    })
    invalidateBlocklistCache()
    void logUserAudit({
      action: 'lead_block.created', targetType: 'security',
      targetLabel: `Bloqueio de lead ${rule.label ?? rule.emailKey ?? rule.phoneKey ?? rule.ip ?? ''}`,
      changes: crit, ...actor,
    })
    return { rule }
  })

  // ── Atualizar (inclui ligar/desligar sem perder o histórico de acertos) ──
  app.put('/api/admin/security/lead-blocks/:id', { preHandler: adminOnly }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const b = (req.body as any) || {}
    const data: any = {}
    if (b.label !== undefined) data.label = b.label ? String(b.label).slice(0, 191) : null
    if (b.reason !== undefined) data.reason = b.reason ? String(b.reason).slice(0, 2000) : null
    if (b.active !== undefined) data.active = !!b.active
    if (b.email !== undefined || b.emailDomain !== undefined || b.whatsapp !== undefined || b.ip !== undefined) {
      const crit = parseCriteria(b)
      if (!crit.emailKey && !crit.emailDomain && !crit.phoneKey && !crit.ip) {
        return reply.code(400).send({ error: 'Informe ao menos um critério: e-mail, domínio, WhatsApp ou IP.' })
      }
      Object.assign(data, crit)
    }
    const rule = await prisma.leadBlockRule.update({ where: { id }, data }).catch(() => null)
    if (!rule) return reply.code(404).send({ error: 'Regra não encontrada' })
    invalidateBlocklistCache()
    void logUserAudit({
      action: 'lead_block.updated', targetType: 'security',
      targetLabel: `Bloqueio de lead #${id}`, changes: data, ...auditActor(req),
    })
    return { rule }
  })

  // ── Excluir ──
  app.delete('/api/admin/security/lead-blocks/:id', { preHandler: adminOnly }, async (req) => {
    const id = Number((req.params as any).id)
    await prisma.leadBlockRule.delete({ where: { id } }).catch(() => {})
    invalidateBlocklistCache()
    void logUserAudit({
      action: 'lead_block.deleted', targetType: 'security',
      targetLabel: `Bloqueio de lead #${id}`, ...auditActor(req),
    })
    return { ok: true }
  })

  // ── Bloquear a partir de um lead existente ──
  // É o caminho real: o operador vê o lead que insiste e bloqueia dali, sem
  // copiar e-mail e telefone à mão para a tela de Segurança.
  app.post('/api/admin/security/lead-blocks/from-lead/:leadId', { preHandler: adminOnly }, async (req, reply) => {
    const leadId = Number((req.params as any).leadId)
    const b = (req.body as any) || {}
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true, nome: true, email: true, whatsapp: true },
    })
    if (!lead) return reply.code(404).send({ error: 'Lead não encontrado' })

    const crit = {
      emailKey: b.useEmail === false ? null : normalizeEmail(lead.email),
      emailDomain: null as string | null,
      phoneKey: b.useWhatsapp === false ? null : normalizePhone(lead.whatsapp),
      ip: null as string | null,
    }
    if (!crit.emailKey && !crit.phoneKey) {
      return reply.code(400).send({ error: 'Este lead não tem e-mail nem WhatsApp para bloquear.' })
    }
    const actor = auditActor(req)
    const rule = await prisma.leadBlockRule.create({
      data: {
        ...crit,
        label: lead.nome || `Lead #${lead.id}`,
        reason: b.reason ? String(b.reason).slice(0, 2000) : 'Bloqueado a partir do lead',
        createdBy: actor.actorName ?? null,
      },
    })
    invalidateBlocklistCache()
    void logUserAudit({
      action: 'lead_block.created', targetType: 'lead',
      targetLabel: `Bloqueio de lead ${lead.nome ?? lead.id}`, changes: crit, ...actor,
    })
    return { rule }
  })
}
