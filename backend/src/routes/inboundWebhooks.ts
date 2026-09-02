// src/routes/inboundWebhooks.ts
// Webhooks de Entrada — endpoint público recebe payload arbitrário e aplica
// mapping configurado pelo admin (source JSONPath → target campo Lead/cf_*)
// pra criar Lead automaticamente. Pensado pra integrar com Make/n8n/Zapier
// e sistemas externos que mandam payload em formato próprio.
//
// Auth do endpoint público é só o token na URL (≥ 32 chars, gerado por crypto).
// Não há HMAC nem header obrigatório, igual webhook do Make.

import { FastifyInstance } from 'fastify'
import crypto from 'crypto'
import { prisma } from '../lib/prisma.js'
import { rejectLeadEntry } from '../services/leadBlocklist.js'
import { adminOnly } from '../lib/auth.js'
import { getIp, logEvent, EVENT_TYPES } from '../services/leadHistory.js'
import { generateUid, flagDuplicate } from '../services/dedup.js'
import { pickOperatorForTeam, resolveRoutingFromContext } from '../services/teamRouting.js'
import { deriveLeadOrigin } from '../lib/leadOrigin.js'
import { extrairTracking, ALVOS_TRACKING, COLUNAS_TRACKING, limitarTracking } from '../lib/trackingPayload.js'

// ── Mapping engine ─────────────────────────────────────
//
// Uma regra de mapping é:
//   { source: 'data.contact.phone', target: 'whatsapp' }
//   { source: '$.email', target: 'email' }
//   { source: 'fields[0].value', target: 'cf_curso_interesse' }
//
// `source` é um caminho JSON ponto/colchete; suporta:
//   - `a.b.c` ou `$.a.b.c` (com $ opcional)
//   - `arr[0].foo` (índice numérico em colchete)
//   - `["chave com espaço"]` (chave em colchete com aspas)
//
// `target` aceita os campos nativos do Lead listados em LEAD_NATIVE_FIELDS
// ou `cf_<key>` para um custom field existente.

interface MappingRule {
  source: string
  target: string
}

const LEAD_NATIVE_FIELDS = new Set([
  'nome', 'email', 'whatsapp', 'empresa', 'segmento', 'cidade',
  'annotation', 'status',
])

// Campos de origem (utm_source, gclid, fbclid…) também são alvo de mapeamento.
// Quem tem formulário próprio no site precisa entregar a campanha junto do
// lead; sem isto o lead entrava sem origem e a atribuição perdia a campanha
// que pagou por ele. Ver lib/trackingPayload.ts.
const LEAD_TRACKING_FIELDS = COLUNAS_TRACKING

function resolveJsonPath(path: string, payload: any): unknown {
  if (!path || typeof path !== 'string') return undefined
  let p = path.trim()
  if (p.startsWith('$.')) p = p.slice(2)
  else if (p.startsWith('$')) p = p.slice(1)
  if (!p) return payload

  // Chave literal: muitos plugins (Elementor Forms, WPForms variants) mandam
  // payload "flat" com chaves literais tipo `fields[name][value]` em vez de
  // árvore aninhada. Se o source existir como chave exata no top-level do
  // payload, retornar direto — senão cai na tokenização JSONPath normal.
  if (payload && typeof payload === 'object' && !Array.isArray(payload) && Object.prototype.hasOwnProperty.call(payload, p)) {
    return (payload as any)[p]
  }

  // Tokenize: separa por pontos e colchetes
  const tokens: string[] = []
  let i = 0
  let buf = ''
  while (i < p.length) {
    const ch = p[i]
    if (ch === '.') {
      if (buf) { tokens.push(buf); buf = '' }
      i++
    } else if (ch === '[') {
      if (buf) { tokens.push(buf); buf = '' }
      const end = p.indexOf(']', i)
      if (end === -1) return undefined
      let key = p.slice(i + 1, end).trim()
      if ((key.startsWith('"') && key.endsWith('"')) ||
          (key.startsWith("'") && key.endsWith("'"))) {
        key = key.slice(1, -1)
      }
      tokens.push(key)
      i = end + 1
    } else {
      buf += ch
      i++
    }
  }
  if (buf) tokens.push(buf)

  let cur: any = payload
  for (const t of tokens) {
    if (cur == null) return undefined
    // Índice numérico em array
    if (/^\d+$/.test(t) && Array.isArray(cur)) {
      cur = cur[Number(t)]
    } else if (typeof cur === 'object') {
      cur = cur[t]
    } else {
      return undefined
    }
  }
  return cur
}

function coerceToString(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  try { return JSON.stringify(v) } catch { return '' }
}

function applyMapping(
  rules: MappingRule[],
  payload: any,
): { fields: Record<string, string>; customFields: Record<string, any>; tracking: Record<string, string> } {
  const fields: Record<string, string> = {}
  const customFields: Record<string, any> = {}
  const tracking: Record<string, string> = {}
  for (const rule of rules) {
    if (!rule || !rule.source || !rule.target) continue
    const value = resolveJsonPath(rule.source, payload)
    if (value === undefined || value === null || value === '') continue
    const target = rule.target.trim()
    if (target.startsWith('cf_')) {
      customFields[target.slice(3)] = value
    } else if (LEAD_NATIVE_FIELDS.has(target)) {
      fields[target] = coerceToString(value)
    } else if (LEAD_TRACKING_FIELDS.has(target)) {
      const v = limitarTracking(target, value)
      if (v) tracking[target] = v
    }
  }
  return { fields, customFields, tracking }
}

// ── Routes ─────────────────────────────────────────────

export async function inboundWebhooksRoutes(app: FastifyInstance) {

  // Aceita form-urlencoded além de JSON (plugins WP, Zapier, Make webhook genérico
  // mandam x-www-form-urlencoded por padrão). Registra no escopo do plugin pra
  // não impactar o resto do app.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    try {
      const params = new URLSearchParams(body as string)
      const obj: Record<string, string> = {}
      for (const [k, v] of params) obj[k] = v
      done(null, obj)
    } catch (err) {
      done(err as Error, undefined)
    }
  })

  // ══════════════════════════════════════════════
  // PUBLIC — recebe payload e cria Lead
  // ══════════════════════════════════════════════
  app.post('/api/inbound/:token', async (req, reply) => {
    const { token } = req.params as any
    if (!token || typeof token !== 'string' || token.length < 16) {
      return reply.code(404).send({ ok: false, error: 'Token inválido' })
    }

    const webhook = await prisma.inboundWebhook.findUnique({ where: { token } })
    if (!webhook) return reply.code(404).send({ ok: false, error: 'Webhook não encontrado' })
    if (!webhook.active) return reply.code(403).send({ ok: false, error: 'Webhook inativo' })

    // Multipart: @fastify/multipart está registrado globalmente e NÃO popula req.body
    // automaticamente — precisa consumir as parts manualmente.
    let payload: any
    if (typeof (req as any).isMultipart === 'function' && (req as any).isMultipart()) {
      const obj: Record<string, any> = {}
      try {
        const parts = (req as any).parts()
        for await (const part of parts) {
          if (part.type === 'field') {
            obj[part.fieldname] = part.value
          }
          // Ignora arquivos por enquanto — webhook só extrai campos
        }
      } catch (e) {
        return reply.code(400).send({ ok: false, error: `Erro ao parsear multipart: ${(e as Error).message}` })
      }
      payload = obj
    } else {
      payload = (req.body ?? {}) as any
    }

    const ip = getIp(req)
    const userAgent = String(req.headers['user-agent'] || '').slice(0, 500)

    // Sempre guarda o último payload bruto pra ajudar admin a montar mapping
    prisma.inboundWebhook.update({
      where: { id: webhook.id },
      data: { lastPayload: payload, lastReceivedAt: new Date() },
    }).catch(() => {})

    const rules: MappingRule[] = Array.isArray(webhook.mapping) ? webhook.mapping as any : []
    const { fields, customFields, tracking: trackingMapeado } = applyMapping(rules, payload)

    // Além do mapeamento explícito, lê os nomes canônicos direto do payload
    // (utm_source, gclid, fbclid, visitor_id…). Um formulário de site manda
    // esses campos com o nome de sempre, e obrigar o cliente a criar uma regra
    // para cada um seria burocracia sem ganho. O mapeamento vence quando os dois
    // existem — quem escreveu a regra sabe o que quer.
    const tracking: Record<string, string> = { ...extrairTracking(payload), ...trackingMapeado }

    // Precisa ter pelo menos um identificador para criar Lead
    const nome = fields.nome || ''
    const email = fields.email || ''
    const whatsapp = fields.whatsapp || ''
    const empresa = fields.empresa || ''

    if (!nome && !email && !whatsapp) {
      const errMsg = 'Mapping não produziu nome, email ou whatsapp — Lead não criado.'
      await prisma.inboundWebhookHit.create({
        data: {
          webhookId: webhook.id,
          ip, userAgent, payload,
          mappedData: { fields, customFields, tracking },
          success: false, error: errMsg,
        },
      })
      await prisma.inboundWebhook.update({
        where: { id: webhook.id },
        data: { totalErrors: { increment: 1 }, lastError: errMsg },
      })
      return reply.code(422).send({ ok: false, error: errMsg })
    }

    // Resolver funil/etapa default
    let targetFunnelId: number | null = webhook.defaultFunnelId ?? null
    let targetStageKey: string = webhook.defaultStageKey || 'NOVO'
    if (!targetFunnelId) {
      const def = await prisma.funnel.findFirst({ where: { isDefault: true, active: true } })
      if (def) targetFunnelId = def.id
    }
    if (targetFunnelId) {
      const exists = await prisma.stage.findFirst({
        where: { funnelId: targetFunnelId, key: targetStageKey, active: true },
      })
      if (!exists) {
        const first = await prisma.stage.findFirst({
          where: { funnelId: targetFunnelId, active: true },
          orderBy: { position: 'asc' },
        })
        if (first) targetStageKey = first.key
      }
    }

    // Roteamento: webhook.defaultTeamId (rota explícita) > RoutingRule cascade >
    //   resolveDefaultTeamId (cascata legada). Operador via picker.
    let routedTeamId: number | null = webhook.defaultTeamId ?? null
    let routedUserId: number | null = null
    let routedRuleId: number | null = null
    if (routedTeamId) {
      routedUserId = await pickOperatorForTeam(routedTeamId)
    } else {
      // As UTMs vêm de `tracking`. Antes este bloco lia `fields.utmSource`, que
      // NUNCA existia (o mapeamento descartava alvo fora dos 8 campos nativos) —
      // ou seja, regra de roteamento por campanha jamais disparou por aqui.
      const decision = await resolveRoutingFromContext({
        source: 'inbound',
        utmSource: tracking.utmSource || null,
        utmMedium: tracking.utmMedium || null,
        utmCampaign: tracking.utmCampaign || null,
      })
      routedTeamId = decision.teamId
      routedUserId = decision.userId
      routedRuleId = decision.ruleId
    }
    const source = tracking.source || webhook.defaultSource || 'inbound_webhook'

    // Lista de bloqueio: responde ok (o provedor do outro lado não deve
    // retentar) e não cria o lead.
    if (await rejectLeadEntry({ email, whatsapp, ip }, `webhook ${webhook.name ?? webhook.id}`)) {
      return reply.send({ ok: true, ignored: 'blocked' })
    }

    let leadId: number | null = null
    let success = false
    let errMsg: string | null = null

    try {
      const lead = await prisma.lead.create({
        data: {
          uid: await generateUid(),
          nome: nome || 'Lead via webhook',
          email,
          whatsapp,
          empresa,
          segmento: fields.segmento || null,
          cidade: fields.cidade || null,
          annotation: fields.annotation || null,
          formData: payload,
          scores: {},
          lastStep: 0,
          completed: false,
          status: fields.status || targetStageKey,
          funnelId: targetFunnelId,
          teamId: routedTeamId,
          assignedUserId: routedUserId,
          assignedAt: routedUserId ? new Date() : null,
          source,
          // Campos de origem que a integração mandou (utm_*, gclid, fbclid,
          // visitor_id, ids de campanha). `source` já foi consumido acima.
          ...(() => { const { source: _s, ...colunas } = tracking; return colunas })(),
          originType: deriveLeadOrigin({
            source,
            qualificationSource: 'inbound_webhook',
            utmSource: tracking.utmSource || null,
            gclid: tracking.gclid || null,
            ctwaClid: tracking.ctwaClid || null,
            trackableLinkId: null,
          }),
          customFields: Object.keys(customFields).length > 0 ? customFields : undefined,
          qualifiedAt: new Date(),
          qualificationSource: 'inbound_webhook',
        },
      })
      leadId = lead.id
      success = true

      logEvent({
        leadId,
        type: EVENT_TYPES.WEBHOOK_RECEIVED,
        category: 'lifecycle',
        title: `Lead criado via webhook de entrada: ${webhook.name}`,
        channel: 'webhook',
        source,
        actorType: 'lead',
        description: `Lead recebido via Inbound Webhook "${webhook.name}"`,
        metadata: { webhookId: webhook.id, webhookName: webhook.name, mappedFields: fields, customFields },
        ipAddress: ip,
      })

      if (routedRuleId) {
        logEvent({
          leadId,
          type: EVENT_TYPES.ROUTING_RULE_MATCHED,
          category: 'lifecycle',
          title: `Regra de roteamento aplicada (#${routedRuleId})`,
          actorType: 'system',
          metadata: { ruleId: routedRuleId, teamId: routedTeamId, userId: routedUserId },
        })
      }

      flagDuplicate({ newLeadId: leadId, channel: 'inbound_webhook' }).catch((e) => {
        console.error('[InboundWebhook] flagDuplicate error:', (e as Error).message)
      })

      try {
        const { notifyNewLead } = await import('../services/notify.js')
        notifyNewLead(lead).catch(() => {})
      } catch {}
    } catch (e) {
      errMsg = (e as Error).message || 'Erro ao criar lead'
      console.error('[InboundWebhook] create lead error:', errMsg)
    }

    await prisma.inboundWebhookHit.create({
      data: {
        webhookId: webhook.id,
        ip, userAgent, payload,
        mappedData: { fields, customFields },
        success, leadId, error: errMsg,
      },
    })
    await prisma.inboundWebhook.update({
      where: { id: webhook.id },
      data: success
        ? { totalReceived: { increment: 1 }, lastError: null }
        : { totalErrors: { increment: 1 }, lastError: errMsg },
    })

    if (!success) return reply.code(500).send({ ok: false, error: errMsg })
    // 200 (não 201): Elementor Forms / WPForms / outros plugins de webhook
    // do WordPress consideram QUALQUER status ≠ 200 como falha e exibem
    // "Webhook error" no front, mesmo com o lead já tendo sido criado aqui.
    return reply.code(200).send({ ok: true, leadId })
  })

  // ══════════════════════════════════════════════
  // ADMIN — CRUD
  // ══════════════════════════════════════════════

  // GET — lista
  app.get('/api/admin/inbound-webhooks', { preHandler: adminOnly }, async () => {
    const rows = await prisma.inboundWebhook.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, token: true, name: true, description: true, active: true,
        defaultFunnelId: true, defaultStageKey: true, defaultTeamId: true, defaultSource: true,
        mapping: true,
        totalReceived: true, totalErrors: true, lastReceivedAt: true, lastError: true,
        createdAt: true, updatedAt: true,
      },
    })
    return { data: rows }
  })

  // GET — fields disponíveis pro mapping (nativos + custom fields)
  app.get('/api/admin/inbound-webhooks/lead-fields', { preHandler: adminOnly }, async () => {
    const cfs = await prisma.customField.findMany({
      where: { active: true },
      orderBy: { label: 'asc' },
      select: { key: true, label: true, type: true },
    })
    return {
      native: [
        { target: 'nome',       label: 'Nome' },
        { target: 'email',      label: 'E-mail' },
        { target: 'whatsapp',   label: 'WhatsApp / Telefone' },
        { target: 'empresa',    label: 'Empresa' },
        { target: 'segmento',   label: 'Segmento' },
        { target: 'cidade',     label: 'Cidade' },
        { target: 'annotation', label: 'Anotação' },
        { target: 'status',     label: 'Status (etapa)' },
      ],
      customFields: cfs.map(cf => ({
        target: `cf_${cf.key}`, label: cf.label, type: cf.type,
      })),
      // Campos de origem. Mapear é opcional: quando o payload traz os nomes
      // canônicos (utm_source, gclid, fbclid…), eles entram sozinhos.
      tracking: ALVOS_TRACKING,
    }
  })

  // POST — criar
  app.post('/api/admin/inbound-webhooks', { preHandler: adminOnly }, async (req, reply) => {
    const body = req.body as any
    if (!body.name || !String(body.name).trim()) {
      return reply.code(400).send({ error: 'Nome é obrigatório' })
    }

    const mapping: MappingRule[] = Array.isArray(body.mapping)
      ? body.mapping.filter((r: any) => r && r.source && r.target)
      : []

    const user = (req as any).user
    const token = crypto.randomBytes(24).toString('hex')

    const created = await prisma.inboundWebhook.create({
      data: {
        token,
        name: String(body.name).trim(),
        description: body.description ? String(body.description) : null,
        active: body.active !== false,
        defaultFunnelId: body.defaultFunnelId ? Number(body.defaultFunnelId) : null,
        defaultStageKey: body.defaultStageKey ? String(body.defaultStageKey) : null,
        defaultTeamId: body.defaultTeamId ? Number(body.defaultTeamId) : null,
        defaultSource: body.defaultSource ? String(body.defaultSource) : null,
        mapping: mapping as any,
        createdBy: user?.userId || null,
      },
    })
    return reply.code(201).send({ data: created })
  })

  // PUT — editar
  app.put('/api/admin/inbound-webhooks/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const body = req.body as any
    const existing = await prisma.inboundWebhook.findUnique({ where: { id: Number(id) } })
    if (!existing) return reply.code(404).send({ error: 'Webhook não encontrado' })

    const data: any = {}
    if (body.name !== undefined) data.name = String(body.name).trim()
    if (body.description !== undefined) data.description = body.description ? String(body.description) : null
    if (body.active !== undefined) data.active = !!body.active
    if (body.defaultFunnelId !== undefined) data.defaultFunnelId = body.defaultFunnelId ? Number(body.defaultFunnelId) : null
    if (body.defaultStageKey !== undefined) data.defaultStageKey = body.defaultStageKey ? String(body.defaultStageKey) : null
    if (body.defaultTeamId !== undefined) data.defaultTeamId = body.defaultTeamId ? Number(body.defaultTeamId) : null
    if (body.defaultSource !== undefined) data.defaultSource = body.defaultSource ? String(body.defaultSource) : null
    if (body.mapping !== undefined) {
      data.mapping = (Array.isArray(body.mapping)
        ? body.mapping.filter((r: any) => r && r.source && r.target)
        : []) as any
    }

    const updated = await prisma.inboundWebhook.update({
      where: { id: Number(id) },
      data,
    })
    return { data: updated }
  })

  // DELETE
  app.delete('/api/admin/inbound-webhooks/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const existing = await prisma.inboundWebhook.findUnique({ where: { id: Number(id) } })
    if (!existing) return reply.code(404).send({ error: 'Webhook não encontrado' })
    await prisma.inboundWebhook.delete({ where: { id: Number(id) } })
    return { ok: true }
  })

  // POST — regenera token (revoga URL antiga)
  app.post('/api/admin/inbound-webhooks/:id/regenerate-token', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const existing = await prisma.inboundWebhook.findUnique({ where: { id: Number(id) } })
    if (!existing) return reply.code(404).send({ error: 'Webhook não encontrado' })
    const token = crypto.randomBytes(24).toString('hex')
    const updated = await prisma.inboundWebhook.update({
      where: { id: Number(id) }, data: { token },
    })
    return { data: updated }
  })

  // GET — último payload recebido (pra ajudar a montar mapping)
  app.get('/api/admin/inbound-webhooks/:id/last-payload', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const row = await prisma.inboundWebhook.findUnique({
      where: { id: Number(id) },
      select: { lastPayload: true, lastReceivedAt: true },
    })
    if (!row) return reply.code(404).send({ error: 'Webhook não encontrado' })
    return { payload: row.lastPayload, receivedAt: row.lastReceivedAt }
  })

  // GET — histórico de hits (logs)
  app.get('/api/admin/inbound-webhooks/:id/hits', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const q = req.query as any
    const limit = Math.min(parseInt(q.limit) || 50, 200)
    const offset = parseInt(q.offset) || 0

    const existing = await prisma.inboundWebhook.findUnique({ where: { id: Number(id) } })
    if (!existing) return reply.code(404).send({ error: 'Webhook não encontrado' })

    const [data, total] = await Promise.all([
      prisma.inboundWebhookHit.findMany({
        where: { webhookId: Number(id) },
        orderBy: { receivedAt: 'desc' },
        skip: offset, take: limit,
      }),
      prisma.inboundWebhookHit.count({ where: { webhookId: Number(id) } }),
    ])
    return { data, total, limit, offset }
  })
}
