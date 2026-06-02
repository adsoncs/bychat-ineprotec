// src/routes/workflows.ts
// CRUD de workflows, steps e execuções

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { adminOnly, type JwtPayload } from '../lib/auth.js'
import { moveToTrash, snapshotEntity } from '../services/trash.js'
import { resumeExecution, cancelExecution } from '../services/workflowEngine.js'

export async function workflowRoutes(app: FastifyInstance) {

  // ══════════════════════════════════════════════
  // WORKFLOWS CRUD
  // ══════════════════════════════════════════════

  // GET /api/admin/workflows — List all
  app.get('/api/admin/workflows', { preHandler: adminOnly }, async (req) => {
    const { active } = req.query as any
    const where: any = {}
    if (active !== undefined) where.active = active === 'true'

    const workflows = await prisma.workflow.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { steps: true, executions: true } },
      }
    })
    return { workflows }
  })

  // GET /api/admin/workflows/:id — Get with steps
  app.get('/api/admin/workflows/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const workflow = await prisma.workflow.findUnique({
      where: { id: Number(id) },
      include: {
        steps: { orderBy: { position: 'asc' } },
        _count: { select: { executions: true } },
      }
    })
    if (!workflow) return reply.code(404).send({ error: 'Workflow não encontrado' })
    return workflow
  })

  // POST /api/admin/workflows — Create
  app.post('/api/admin/workflows', { preHandler: adminOnly }, async (req) => {
    const body = req.body as any
    const workflow = await prisma.workflow.create({
      data: {
        name: body.name || 'Novo Workflow',
        description: body.description || null,
        triggerEvent: body.triggerEvent || 'lead.stage_changed',
        triggerConfig: body.triggerConfig || null,
        active: false,
        reentryPolicy: body.reentryPolicy || 'never',
        pauseOnReply: body.pauseOnReply ?? true,
        goalEvent: body.goalEvent || null,
        goalConfig: body.goalConfig || null,
        funnelId: body.funnelId || null,
        chatbotId: body.chatbotId || null,
        priority: body.priority || 0,
        createdBy: (req as any).user?.userId || null,
      }
    })
    return workflow
  })

  // PUT /api/admin/workflows/:id — Update
  app.put('/api/admin/workflows/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const body = req.body as any
    const data: any = {}
    for (const k of ['name', 'description', 'triggerEvent', 'triggerConfig', 'active', 'reentryPolicy', 'pauseOnReply', 'goalEvent', 'goalConfig', 'funnelId', 'chatbotId', 'priority']) {
      if (body[k] !== undefined) data[k] = body[k]
    }
    const workflow = await prisma.workflow.update({ where: { id: Number(id) }, data })
    return workflow
  })

  // DELETE /api/admin/workflows/:id (move para lixeira)
  app.delete('/api/admin/workflows/:id', { preHandler: adminOnly }, async (req) => {
    const { id } = req.params as any
    const user = (req as any).user as JwtPayload
    const snapshot = await snapshotEntity('workflow', Number(id))
    if (snapshot) {
      await moveToTrash({
        entityType: 'workflow',
        entityId: Number(id),
        entityLabel: (snapshot as any).name,
        snapshot,
        deletedBy: user.userId,
        deletedByName: user.name || user.email,
      })
    }
    await prisma.workflow.delete({ where: { id: Number(id) } })
    return { ok: true }
  })

  // PUT /api/admin/workflows/:id/toggle — Activate/deactivate
  app.put('/api/admin/workflows/:id/toggle', { preHandler: adminOnly }, async (req) => {
    const { id } = req.params as any
    const workflow = await prisma.workflow.findUnique({ where: { id: Number(id) } })
    if (!workflow) return { error: 'Não encontrado' }
    const updated = await prisma.workflow.update({
      where: { id: Number(id) },
      data: { active: !workflow.active }
    })
    return updated
  })

  // POST /api/admin/workflows/:id/duplicate — Clone
  app.post('/api/admin/workflows/:id/duplicate', { preHandler: adminOnly }, async (req) => {
    const { id } = req.params as any
    const original = await prisma.workflow.findUnique({
      where: { id: Number(id) },
      include: { steps: { orderBy: { position: 'asc' } } }
    })
    if (!original) return { error: 'Não encontrado' }

    const clone = await prisma.workflow.create({
      data: {
        name: `${original.name} (cópia)`,
        description: original.description,
        triggerEvent: original.triggerEvent,
        triggerConfig: original.triggerConfig || undefined,
        active: false,
        reentryPolicy: original.reentryPolicy,
        pauseOnReply: original.pauseOnReply,
        goalEvent: original.goalEvent,
        goalConfig: original.goalConfig || undefined,
        funnelId: original.funnelId,
        chatbotId: original.chatbotId,
        priority: original.priority,
        createdBy: (req as any).user?.userId || null,
      }
    })

    // Clone steps with ID mapping for nextStepId/altStepId
    const idMap: Record<number, number> = {}
    for (const step of original.steps) {
      const newStep = await prisma.workflowStep.create({
        data: {
          workflowId: clone.id,
          type: step.type,
          name: step.name,
          config: step.config as any,
          position: step.position,
          positionX: step.positionX,
          positionY: step.positionY,
          // nextStepId and altStepId will be updated after all steps are created
        }
      })
      idMap[step.id] = newStep.id
    }

    // Update nextStepId and altStepId references
    for (const step of original.steps) {
      const updates: any = {}
      if (step.nextStepId && idMap[step.nextStepId]) updates.nextStepId = idMap[step.nextStepId]
      if (step.altStepId && idMap[step.altStepId]) updates.altStepId = idMap[step.altStepId]
      if (Object.keys(updates).length > 0) {
        await prisma.workflowStep.update({ where: { id: idMap[step.id] }, data: updates })
      }
    }

    return clone
  })

  // ══════════════════════════════════════════════
  // STEPS CRUD
  // ══════════════════════════════════════════════

  // POST /api/admin/workflows/:id/steps — Add step
  app.post('/api/admin/workflows/:id/steps', { preHandler: adminOnly }, async (req) => {
    const { id } = req.params as any
    const body = req.body as any

    // Auto-position: append at end
    const maxPos = await prisma.workflowStep.aggregate({
      where: { workflowId: Number(id) },
      _max: { position: true }
    })

    const step = await prisma.workflowStep.create({
      data: {
        workflowId: Number(id),
        type: body.type || 'action',
        name: body.name || 'Novo Step',
        config: body.config || {},
        position: body.position ?? ((maxPos._max.position ?? -1) + 1),
        positionX: body.positionX || 0,
        positionY: body.positionY || 0,
        nextStepId: body.nextStepId || null,
        altStepId: body.altStepId || null,
      }
    })
    return step
  })

  // PUT /api/admin/workflows/:id/steps/:stepId — Update step
  app.put('/api/admin/workflows/:id/steps/:stepId', { preHandler: adminOnly }, async (req) => {
    const { stepId } = req.params as any
    const body = req.body as any
    const data: any = {}
    for (const k of ['type', 'name', 'config', 'position', 'positionX', 'positionY', 'nextStepId', 'altStepId']) {
      if (body[k] !== undefined) data[k] = body[k]
    }
    const step = await prisma.workflowStep.update({ where: { id: Number(stepId) }, data })
    return step
  })

  // DELETE /api/admin/workflows/:id/steps/:stepId
  app.delete('/api/admin/workflows/:id/steps/:stepId', { preHandler: adminOnly }, async (req) => {
    const { stepId } = req.params as any
    await prisma.workflowStep.delete({ where: { id: Number(stepId) } })
    return { ok: true }
  })

  // POST /api/admin/workflows/:id/canvas-save — Persiste o estado completo
  // do canvas em UMA transação. Builder Visual (Fase 26) usa esse endpoint
  // pra trocar o auto-save por um buffer local com botão "Salvar".
  //
  // Payload:
  //   - steps: lista completa do que deve existir após salvar. IDs negativos
  //     identificam novos (gera ID real e mantém idMap). IDs positivos são
  //     existentes; campos enviados sobrescrevem o atual.
  //   - deletedStepIds: IDs (positivos) marcados pra remoção no buffer local.
  //
  // Order de execução:
  //   1. Zera nextStepId/altStepId que apontem pra IDs em deletedStepIds.
  //   2. Deleta esses IDs.
  //   3. Cria os steps com ID negativo, preenchendo idMap.
  //   4. Atualiza todos os steps (existentes + recém-criados), resolvendo
  //      nextStepId/altStepId via idMap quando o destino for um ID negativo.
  app.post('/api/admin/workflows/:id/canvas-save', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const workflowId = Number(id)
    if (!Number.isFinite(workflowId)) return reply.code(400).send({ error: 'id inválido' })

    const body = req.body as {
      steps?: Array<{
        id: number
        type?: string
        name?: string
        config?: unknown
        position?: number
        positionX?: number
        positionY?: number
        nextStepId?: number | null
        altStepId?: number | null
      }>
      deletedStepIds?: number[]
    }

    const incomingSteps = Array.isArray(body?.steps) ? body!.steps! : []
    const deletedIds = (Array.isArray(body?.deletedStepIds) ? body!.deletedStepIds! : [])
      .map(Number)
      .filter((n) => Number.isFinite(n) && n > 0)

    try {
      const result = await prisma.$transaction(async (tx) => {
        // 1) Limpa refs pra IDs deletados (evita FK lógica órfã).
        if (deletedIds.length > 0) {
          await tx.workflowStep.updateMany({
            where: { workflowId, nextStepId: { in: deletedIds } },
            data: { nextStepId: null },
          })
          await tx.workflowStep.updateMany({
            where: { workflowId, altStepId: { in: deletedIds } },
            data: { altStepId: null },
          })
          // 2) Deleta.
          await tx.workflowStep.deleteMany({
            where: { workflowId, id: { in: deletedIds } },
          })
        }

        // 3) Cria os novos (id negativo) primeiro, sem refs (resolvidas no PUT).
        const idMap = new Map<number, number>()
        const toCreate = incomingSteps.filter((s) => s.id < 0)
        for (const s of toCreate) {
          const created = await tx.workflowStep.create({
            data: {
              workflowId,
              type:       s.type || 'action',
              name:       s.name || 'Novo Step',
              config:     (s.config as any) ?? {},
              position:   s.position ?? 0,
              positionX:  s.positionX ?? 0,
              positionY:  s.positionY ?? 0,
              // Refs ainda não resolvidas — passadas no PUT abaixo.
            },
          })
          idMap.set(s.id, created.id)
        }

        // Helper pra resolver ref de step (positivo = existente, negativo = via idMap).
        function resolveRef(ref: number | null | undefined): number | null {
          if (ref === null || ref === undefined) return null
          if (ref > 0) return ref
          return idMap.get(ref) ?? null
        }

        // 4) Atualiza tudo (existentes + recém-criados) com refs resolvidas.
        for (const s of incomingSteps) {
          const realId = s.id > 0 ? s.id : idMap.get(s.id)
          if (!realId) continue
          const data: Record<string, unknown> = {}
          if (s.type !== undefined) data.type = s.type
          if (s.name !== undefined) data.name = s.name
          if (s.config !== undefined) data.config = s.config
          if (s.position !== undefined) data.position = s.position
          if (s.positionX !== undefined) data.positionX = s.positionX
          if (s.positionY !== undefined) data.positionY = s.positionY
          if (s.nextStepId !== undefined) data.nextStepId = resolveRef(s.nextStepId)
          if (s.altStepId !== undefined) data.altStepId = resolveRef(s.altStepId)
          if (Object.keys(data).length > 0) {
            await tx.workflowStep.update({ where: { id: realId }, data })
          }
        }

        const finalSteps = await tx.workflowStep.findMany({
          where: { workflowId },
          orderBy: { position: 'asc' },
        })
        return { steps: finalSteps, idMap: Object.fromEntries(idMap) }
      })
      return result
    } catch (err: any) {
      return reply.code(500).send({ error: err?.message ?? 'Falha ao salvar canvas' })
    }
  })

  // PUT /api/admin/workflows/:id/steps/reorder — Bulk update positions
  app.put('/api/admin/workflows/:id/steps/reorder', { preHandler: adminOnly }, async (req) => {
    const { order } = req.body as any
    if (!Array.isArray(order)) return { error: 'Formato inválido' }
    for (const item of order) {
      const data: any = { position: item.position }
      if (item.nextStepId !== undefined) data.nextStepId = item.nextStepId
      if (item.altStepId !== undefined) data.altStepId = item.altStepId
      await prisma.workflowStep.update({ where: { id: item.id }, data })
    }
    return { ok: true }
  })

  // ══════════════════════════════════════════════
  // EXECUTIONS
  // ══════════════════════════════════════════════

  // GET /api/admin/workflows/:id/execution-stats — Estatísticas pro canvas
  // (modo Execução). Retorna por step: leadsHere (running com currentStepId)
  // e totalPassed (stepExecutions completas). Por edge: count de transições
  // consecutivas, inferido pelos pares ordenados por completedAt.
  app.get('/api/admin/workflows/:id/execution-stats', { preHandler: adminOnly }, async (req) => {
    const { id } = req.params as any
    const workflowId = Number(id)
    if (!Number.isFinite(workflowId)) return { error: 'ID inválido' }

    const [steps, leadsHereGroup, passedGroup, allCompleted, statusGroup] = await Promise.all([
      prisma.workflowStep.findMany({
        where: { workflowId },
        select: { id: true, nextStepId: true, altStepId: true },
      }),
      prisma.workflowExecution.groupBy({
        by: ['currentStepId'],
        where: { workflowId, status: 'running' },
        _count: { _all: true },
      }),
      prisma.workflowStepExecution.groupBy({
        by: ['stepId'],
        where: { execution: { workflowId }, status: 'completed' },
        _count: { _all: true },
      }),
      prisma.workflowStepExecution.findMany({
        where: { execution: { workflowId }, status: 'completed' },
        orderBy: [{ executionId: 'asc' }, { completedAt: 'asc' }],
        select: { executionId: true, stepId: true },
      }),
      prisma.workflowExecution.groupBy({
        by: ['status'],
        where: { workflowId },
        _count: { _all: true },
      }),
    ])

    const leadsHereMap = new Map<number, number>()
    for (const r of leadsHereGroup) {
      if (r.currentStepId !== null) leadsHereMap.set(r.currentStepId, r._count._all)
    }
    const passedMap = new Map<number, number>()
    for (const r of passedGroup) passedMap.set(r.stepId, r._count._all)

    // Edge counts via pares consecutivos por execution.
    const pairCounts = new Map<string, number>()
    let prevExecId = -1
    let prevStepId = -1
    for (const r of allCompleted) {
      if (r.executionId !== prevExecId) {
        prevExecId = r.executionId
        prevStepId = r.stepId
        continue
      }
      const key = `${prevStepId}-${r.stepId}`
      pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1)
      prevStepId = r.stepId
    }

    const edgeStats: { fromStepId: number; toStepId: number; kind: 'next' | 'alt'; count: number }[] = []
    for (const s of steps) {
      if (s.nextStepId) {
        edgeStats.push({
          fromStepId: s.id,
          toStepId: s.nextStepId,
          kind: 'next',
          count: pairCounts.get(`${s.id}-${s.nextStepId}`) ?? 0,
        })
      }
      if (s.altStepId) {
        edgeStats.push({
          fromStepId: s.id,
          toStepId: s.altStepId,
          kind: 'alt',
          count: pairCounts.get(`${s.id}-${s.altStepId}`) ?? 0,
        })
      }
    }

    const summary: Record<string, number> = {}
    for (const r of statusGroup) summary[r.status] = r._count._all

    return {
      stepStats: steps.map((s) => ({
        stepId: s.id,
        leadsHere: leadsHereMap.get(s.id) ?? 0,
        totalPassed: passedMap.get(s.id) ?? 0,
      })),
      edgeStats,
      summary,
    }
  })

  // GET /api/admin/workflows/:id/executions — List executions for workflow
  app.get('/api/admin/workflows/:id/executions', { preHandler: adminOnly }, async (req) => {
    const { id } = req.params as any
    const { status, limit = '50', offset = '0' } = req.query as any
    const where: any = { workflowId: Number(id) }
    if (status) where.status = status

    const [executions, total] = await Promise.all([
      prisma.workflowExecution.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: parseInt(limit),
        skip: parseInt(offset),
        include: { stepExecutions: { orderBy: { createdAt: 'asc' } } }
      }),
      prisma.workflowExecution.count({ where }),
    ])
    return { executions, total }
  })

  // GET /api/admin/workflow-executions/:id — Execution detail
  app.get('/api/admin/workflow-executions/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const execution = await prisma.workflowExecution.findUnique({
      where: { id: Number(id) },
      include: {
        workflow: { include: { steps: { orderBy: { position: 'asc' } } } },
        stepExecutions: {
          orderBy: { createdAt: 'asc' },
          include: { step: true }
        }
      }
    })
    if (!execution) return reply.code(404).send({ error: 'Execução não encontrada' })
    return execution
  })

  // POST /api/admin/workflow-executions/:id/cancel
  app.post('/api/admin/workflow-executions/:id/cancel', { preHandler: adminOnly }, async (req) => {
    const { id } = req.params as any
    await cancelExecution(Number(id))
    return { ok: true }
  })

  // POST /api/admin/workflow-executions/:id/resume
  app.post('/api/admin/workflow-executions/:id/resume', { preHandler: adminOnly }, async (req) => {
    const { id } = req.params as any
    await resumeExecution(Number(id))
    return { ok: true }
  })

  // GET /api/admin/leads/:id/workflow-executions — Lead's workflow journey
  app.get('/api/admin/leads/:id/workflow-executions', { preHandler: adminOnly }, async (req) => {
    const { id } = req.params as any
    const executions = await prisma.workflowExecution.findMany({
      where: { leadId: Number(id) },
      orderBy: { createdAt: 'desc' },
      include: {
        workflow: { select: { id: true, name: true, triggerEvent: true } },
        stepExecutions: { orderBy: { createdAt: 'asc' }, include: { step: { select: { id: true, name: true, type: true } } } }
      }
    })
    return { executions }
  })
}
