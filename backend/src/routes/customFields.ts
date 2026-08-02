// src/routes/customFields.ts
// Campos Personalizados — CRUD + endpoint público para forms

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { moveToTrash, snapshotEntity } from '../services/trash.js'
import { authMiddleware } from '../lib/auth.js'

export async function customFieldsRoutes(app: FastifyInstance) {

  // ── GET /api/custom-fields ─── Listar campos (admin) ──
  app.get('/api/custom-fields', { preHandler: authMiddleware }, async () => {
    const fields = await prisma.customField.findMany({
      where: { active: true },
      orderBy: [{ group: 'asc' }, { position: 'asc' }, { label: 'asc' }],
    })
    return { fields }
  })

  // ── GET /api/custom-fields/all ─── Todos incluindo inativos ──
  app.get('/api/custom-fields/all', { preHandler: authMiddleware }, async () => {
    const fields = await prisma.customField.findMany({
      orderBy: [{ group: 'asc' }, { position: 'asc' }],
    })
    return { fields }
  })

  // ── GET /api/custom-fields/public ─── Campos para forms (sem auth) ──
  app.get('/api/custom-fields/public', async () => {
    const fields = await prisma.customField.findMany({
      where: { active: true, showInForm: true },
      orderBy: [{ position: 'asc' }],
      select: { id: true, key: true, label: true, type: true, placeholder: true, options: true, defaultValue: true, required: true, group: true },
    })
    return { fields }
  })

  // ── POST /api/custom-fields ─── Criar campo ──
  app.post('/api/custom-fields', { preHandler: authMiddleware }, async (req, reply) => {
    const body = req.body as any
    if (!body.label) return reply.code(400).send({ error: 'Label obrigatório' })

    // Gerar key a partir do label (ou usar key fornecida)
    let key = (body.key || body.label)
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 100)

    if (!key) return reply.code(400).send({ error: 'Codigo de integracao invalido' })

    // Verificar se key ja existe
    const existing = await prisma.customField.findUnique({ where: { key } })
    if (existing) {
      if (body.key) {
        // Se o usuario definiu o key manualmente, retornar erro
        return reply.code(409).send({ error: `O codigo "${key}" ja esta em uso. Escolha outro codigo de integracao.` })
      }
      // Se foi auto-gerado, appendar sufixo
      key = key + '_' + Date.now().toString(36)
    }

    const field = await prisma.customField.create({
      data: {
        key,
        label: body.label,
        type: body.type || 'text',
        description: body.description || null,
        placeholder: body.placeholder || null,
        options: body.options || null,
        defaultValue: body.defaultValue || null,
        required: body.required || false,
        showInList: body.showInList || false,
        showInKanban: body.showInKanban || false,
        showInForm: body.showInForm !== false,
        group: body.group || 'custom',
        position: body.position || 0,
      }
    })

    return reply.code(201).send({ ok: true, field })
  })

  // ── PUT /api/custom-fields/:id ─── Atualizar campo ──
  app.put('/api/custom-fields/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const body = req.body as any

    const data: any = {}
    if (body.label !== undefined) data.label = body.label
    if (body.type !== undefined) data.type = body.type
    if (body.description !== undefined) data.description = body.description
    if (body.placeholder !== undefined) data.placeholder = body.placeholder
    if (body.options !== undefined) data.options = body.options
    if (body.defaultValue !== undefined) data.defaultValue = body.defaultValue
    if (body.required !== undefined) data.required = body.required
    if (body.showInList !== undefined) data.showInList = body.showInList
    if (body.showInKanban !== undefined) data.showInKanban = body.showInKanban
    if (body.showInForm !== undefined) data.showInForm = body.showInForm
    if (body.group !== undefined) data.group = body.group
    if (body.position !== undefined) data.position = body.position
    if (body.active !== undefined) data.active = body.active

    const field = await prisma.customField.update({ where: { id: parseInt(id) }, data })
    return { ok: true, field }
  })

  // ── DELETE /api/custom-fields/:id ─── Excluir campo ──
  app.delete('/api/custom-fields/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const user = (req as any).user
    // Campo personalizado apagado levava junto o que estava gravado nos leads,
    // sem chance de voltar atrás. Snapshot antes (restaurável por 90 dias).
    const snapshot = await snapshotEntity('custom_field', parseInt(id))
    if (snapshot) {
      await moveToTrash({
        entityType: 'custom_field', entityId: parseInt(id),
        entityLabel: (snapshot as any).label || (snapshot as any).key,
        snapshot, deletedBy: user?.userId, deletedByName: user?.name || user?.email,
      })
    }
    await prisma.customField.delete({ where: { id: parseInt(id) } })
    return { ok: true }
  })

  // ── PUT /api/custom-fields/reorder ─── Reordenar ──
  app.put('/api/custom-fields/reorder', { preHandler: authMiddleware }, async (req, reply) => {
    const { items } = req.body as any // [{id, position}]
    if (!Array.isArray(items)) return reply.code(400).send({ error: 'items obrigatório' })
    for (const item of items) {
      await prisma.customField.update({ where: { id: item.id }, data: { position: item.position } })
    }
    return { ok: true }
  })

  // ── PUT /api/leads/:id/custom-fields ─── Atualizar custom fields de um lead ──
  app.put('/api/leads/:id/custom-fields', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const body = req.body as any // { fieldKey: value, ... }

    const lead = await prisma.lead.findUnique({ where: { id: parseInt(id) }, select: { customFields: true } })
    if (!lead) return reply.code(404).send({ error: 'Lead não encontrado' })

    const current = (lead.customFields as any) || {}
    const merged = { ...current, ...body }

    // Remover chaves com valor null/undefined
    Object.keys(merged).forEach(k => { if (merged[k] === null || merged[k] === undefined || merged[k] === '') delete merged[k] })

    await prisma.lead.update({
      where: { id: parseInt(id) },
      data: { customFields: Object.keys(merged).length > 0 ? merged : undefined }
    })

    return { ok: true, customFields: merged }
  })
}
