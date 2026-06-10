// src/routes/modules.ts
// Endpoints genéricos para gerenciar ativação de módulos do sistema.
// Substitui o antigo /api/admin/educacional/toggle (que continua funcionando como wrapper).

import { FastifyInstance } from 'fastify'
import { authMiddleware, adminOnly } from '../lib/auth.js'
import { listModulesWithStatus, setModuleEnabled, getModuleDefinition } from '../lib/moduleManager.js'
import { getAllModuleUsage, getModuleUsage } from '../services/moduleUsage.js'
import { prisma } from '../lib/prisma.js'
import { logUserAudit, auditActor } from '../services/userAudit.js'

export async function modulesRoutes(app: FastifyInstance) {
  // Lista todos os módulos do sistema com seu status atual + uso real (counts).
  // O `usage.total` é usado pela UI para decidir entre confirm simples e modal
  // type-to-confirm na desativação.
  app.get('/api/admin/modules', { preHandler: authMiddleware }, async () => {
    const modules = await listModulesWithStatus()
    const usage = await getAllModuleUsage(modules.map(m => m.id))
    return {
      modules: modules.map(m => ({ ...m, usage: usage[m.id] || { total: 0, items: [] } })),
    }
  })

  // Endpoint dedicado para refrescar usage de um módulo (usado pela UI ao abrir
  // o modal de confirmação — garante contagem em tempo real).
  app.get('/api/admin/modules/:id/usage', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const def = getModuleDefinition(id)
    if (!def) return reply.code(404).send({ error: `Módulo ${id} não encontrado` })
    const usage = await getModuleUsage(id)
    return { moduleId: id, usage }
  })

  // Ativa/desativa um módulo pelo id. Recusa core modules.
  // Quando há uso (`usage.total > 0`) E está sendo desativado, exige `confirmName`
  // batendo exatamente o nome do módulo (type-to-confirm). Registra log de
  // auditoria com snapshot do uso no momento.
  app.post('/api/admin/modules/:id/toggle', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const body = req.body as { enabled: boolean; confirmName?: string }
    if (typeof body?.enabled !== 'boolean') {
      return reply.code(400).send({ error: 'enabled obrigatório (boolean)' })
    }
    const def = getModuleDefinition(id)
    if (!def) return reply.code(404).send({ error: `Módulo ${id} não encontrado` })
    if (def.core) {
      return reply.code(400).send({ error: `Módulo "${def.name}" é essencial e não pode ser desativado` })
    }

    // Type-to-confirm na desativação de módulo com uso ativo.
    if (!body.enabled) {
      const usage = await getModuleUsage(id)
      if (usage.total > 0) {
        const provided = (body.confirmName || '').trim()
        if (provided !== def.name) {
          return reply.code(400).send({
            error: `Para desativar "${def.name}" com dados em uso, envie confirmName igual ao nome do módulo`,
            requiresConfirmation: true,
            usage,
            expectedConfirmName: def.name,
          })
        }
      }
    }

    try {
      await setModuleEnabled(id, body.enabled)
      // Auditoria: registra quem mexeu, quando, e snapshot do uso (no caso de
      // desativação) — útil para rastrear "alguém desativou Educacional sem querer".
      const user = (req as any).user || {}
      const logSnapshot = !body.enabled ? await getModuleUsage(id) : null
      const auditValue: any = {
        at: new Date().toISOString(),
        enabled: body.enabled,
        by: { id: user.userId || null, name: user.name || user.email || null },
        snapshot: logSnapshot,
      }
      await prisma.setting.upsert({
        where: { key: `module_audit.${id}.last_change` },
        create: {
          key: `module_audit.${id}.last_change`,
          value: auditValue,
          label: `Última alteração do módulo ${def.name}`,
          grp: 'audit',
          fieldType: 'json',
        },
        update: { value: auditValue },
      })
      void logUserAudit({
        action: 'module.toggled',
        targetType: 'module',
        targetLabel: def.name,
        changes: { enabled: { from: !body.enabled, to: body.enabled } },
        ...auditActor(req),
      })
      return { ok: true, moduleId: id, enabled: body.enabled }
    } catch (err: any) {
      return reply.code(400).send({ error: err.message })
    }
  })
}
