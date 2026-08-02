// src/routes/salesCadences.ts
//
// Sales Engagement B6: CRUD admin de cadências (SalesCadence + CadenceStep)
// e inscrição manual de leads (CadenceEnrollment).
//
// Padrão: GET list, GET :id (cadência + steps + contagens), POST (cria com
// steps inline), PUT :id (meta da cadência), PUT :id/steps (substitui lista
// de steps), DELETE :id (cascade), POST :id/enrollments (inscreve lead).

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { moveToTrash, snapshotEntity } from '../services/trash.js'
import { authMiddleware, adminOnly, type JwtPayload } from '../lib/auth.js'
import { getCadenceMetrics } from '../services/cadenceMetrics.js'
import { generateCadence, type GenerateCadenceInput, type GeneratedCadence } from '../services/aiCadenceGenerator.js'

// ─── Selects reutilizáveis ───────────────────────────────────

const STEP_SELECT = {
  id: true,
  order: true,
  dayOffset: true,
  hourOffset: true,
  channel: true,
  templateId: true,
  isManual: true,
  isBreakUp: true,
  conditionJson: true,
  positionX: true,
  positionY: true,
  nextStepId: true,
  altStepId: true,
}

const CADENCE_LIST_SELECT = {
  id: true,
  name: true,
  description: true,
  status: true,
  triggerMode: true,
  pauseOnReply: true,
  exitOnConversion: true,
  exitOnStatuses: true,
  ownerId: true,
  teamId: true,
  team: { select: { id: true, name: true, slug: true, color: true } },
  createdAt: true,
  updatedAt: true,
  _count: { select: { steps: true, enrollments: true } },
}

// ─── Tipos de body ───────────────────────────────────────────

interface StepInput {
  order: number
  dayOffset?: number
  hourOffset?: number
  channel: string
  templateId?: number | null
  isManual?: boolean
  isBreakUp?: boolean
  conditionJson?: unknown
  positionX?: number
  positionY?: number
  nextStepId?: number | null
  altStepId?: number | null
}

interface CadenceCreateBody {
  name: string
  description?: string
  teamId?: number | null
  status?: string
  triggerMode?: string
  filterJson?: unknown
  pauseOnReply?: boolean
  exitOnConversion?: boolean
  exitOnStatuses?: string[]
  steps?: StepInput[]
}

interface CadenceUpdateBody extends Omit<CadenceCreateBody, 'name' | 'steps'> {
  name?: string
}

const VALID_STATUS = new Set(['draft', 'active', 'paused', 'archived'])
const VALID_TRIGGER = new Set(['manual', 'filter'])
const VALID_CHANNEL = new Set(['whatsapp', 'email', 'sms', 'call', 'manual', 'linkedin'])

function validateSteps(steps: StepInput[]): string | null {
  if (!Array.isArray(steps)) return 'steps deve ser array'
  const orders = new Set<number>()
  for (const s of steps) {
    if (typeof s.order !== 'number' || s.order < 0) return `step.order inválido (${s.order})`
    if (orders.has(s.order)) return `step.order duplicado: ${s.order}`
    orders.add(s.order)
    if (!VALID_CHANNEL.has(s.channel)) return `step.channel inválido: ${s.channel}`
    if (s.dayOffset !== undefined && (s.dayOffset < 0 || !Number.isFinite(s.dayOffset)))
      return `step.dayOffset inválido`
    if (s.hourOffset !== undefined && (s.hourOffset < 0 || !Number.isFinite(s.hourOffset)))
      return `step.hourOffset inválido`
  }
  return null
}

function validateCadence(body: CadenceCreateBody | CadenceUpdateBody, isCreate: boolean): string | null {
  if (isCreate && !body.name?.trim()) return 'name obrigatório'
  if (body.status && !VALID_STATUS.has(body.status)) return `status inválido: ${body.status}`
  if (body.triggerMode && !VALID_TRIGGER.has(body.triggerMode)) return `triggerMode inválido: ${body.triggerMode}`
  if (body.exitOnStatuses !== undefined && !Array.isArray(body.exitOnStatuses))
    return 'exitOnStatuses deve ser array de strings'
  return null
}

export async function salesCadencesRoutes(app: FastifyInstance) {
  // ── GET /api/admin/sales-cadences ── lista
  app.get(
    '/api/admin/sales-cadences',
    { preHandler: [authMiddleware, adminOnly] },
    async () => {
      const items = await prisma.salesCadence.findMany({
        orderBy: [{ status: 'asc' }, { name: 'asc' }],
        select: CADENCE_LIST_SELECT,
      })
      return { items }
    },
  )

  // ── GET /api/admin/sales-cadences/:id ── detalhe + steps + métricas
  app.get<{ Params: { id: string } }>(
    '/api/admin/sales-cadences/:id',
    { preHandler: [authMiddleware, adminOnly] },
    async (req, reply) => {
      const id = Number(req.params.id)
      if (!Number.isFinite(id)) return reply.code(400).send({ error: 'id inválido' })
      const cadence = await prisma.salesCadence.findUnique({
        where: { id },
        include: {
          steps: { orderBy: { order: 'asc' }, select: STEP_SELECT },
          team: { select: { id: true, name: true, slug: true, color: true } },
          _count: { select: { enrollments: true } },
        },
      })
      if (!cadence) return reply.code(404).send({ error: 'não encontrada' })
      return cadence
    },
  )

  // ── POST /api/admin/sales-cadences/ai-generate ── preview da cadência gerada por IA
  // Não persiste nada — apenas devolve a sugestão (cadence + steps + reasoning)
  // pra que o operador revise antes de salvar via /ai-generate/commit ou edite manualmente.
  app.post<{ Body: GenerateCadenceInput }>(
    '/api/admin/sales-cadences/ai-generate',
    { preHandler: [authMiddleware, adminOnly] },
    async (req, reply) => {
      try {
        const result = await generateCadence(req.body)
        return reply.send(result)
      } catch (err: any) {
        const msg = err?.message ?? 'Falha ao gerar cadência com IA.'
        const status = /chave de IA|API key/i.test(msg) ? 400 : 502
        return reply.code(status).send({ error: msg })
      }
    },
  )

  // ── POST /api/admin/sales-cadences/ai-generate/commit ── persiste cadência gerada
  // Recebe a `GeneratedCadence` (já revisada pelo operador), cria os MessageTemplates
  // necessários para cada step e a SalesCadence + CadenceStep[] em transação única.
  app.post<{ Body: { generated: GeneratedCadence; status?: 'draft' | 'active'; teamId?: number | null } }>(
    '/api/admin/sales-cadences/ai-generate/commit',
    { preHandler: [authMiddleware, adminOnly] },
    async (req, reply) => {
      const { generated, status, teamId } = req.body ?? ({} as any)
      if (!generated?.cadence?.name)        return reply.code(400).send({ error: 'cadence.name obrigatório' })
      if (!Array.isArray(generated.steps) || generated.steps.length === 0) {
        return reply.code(400).send({ error: 'steps obrigatório (>=1)' })
      }

      const user = (req as any).user as JwtPayload

      try {
        const created = await prisma.$transaction(async (tx) => {
          // 1) Cria templates pra cada step (ou reusa o `templateId` se já existir).
          //    Templates ficam acessíveis também na tela de Templates após criar.
          const stepTemplates: number[] = []
          for (const s of generated.steps) {
            // Não cria template para canal=manual sem mensagem; outros canais sempre têm body.
            if (!s.template?.body) {
              stepTemplates.push(0)
              continue
            }
            const t = await tx.messageTemplate.create({
              data: {
                name:    s.template.name?.slice(0, 100) || `${generated.cadence.name} — Step ${s.order + 1}`,
                channel: s.channel,
                category: 'general',
                subject: s.channel === 'email' ? (s.template.subject ?? null) : null,
                body:    s.template.body,
                variables: (s.template.variables ?? []) as any,
              },
            })
            stepTemplates.push(t.id)
          }

          // 2) Cria a cadência + steps numa só transação.
          //    Builder Visual (Fase 26): já preenche `positionX` com layout
          //    horizontal (280px de gap) e encadeia `nextStepId` entre steps
          //    consecutivos numa 2ª passada (precisa dos IDs gerados). Assim
          //    a cadência cai no canvas com layout salvo e edges sólidas
          //    (não pontilhadas como o fallback linear do scheduler).
          const cad = await tx.salesCadence.create({
            data: {
              name:             generated.cadence.name.slice(0, 80),
              description:      generated.cadence.description?.slice(0, 500) || null,
              status:           status ?? 'draft',
              triggerMode:      'manual',
              pauseOnReply:     generated.cadence.pauseOnReply !== false,
              exitOnConversion: generated.cadence.exitOnConversion !== false,
              exitOnStatuses:   (generated.cadence.exitOnStatuses ?? []) as any,
              ownerId:          user.userId,
              teamId:           teamId ?? null,
              steps: {
                create: generated.steps.map((s, i) => ({
                  order:        i,
                  dayOffset:    Math.max(0, Math.floor(s.dayOffset)),
                  hourOffset:   Math.max(0, Math.floor(s.hourOffset)),
                  channel:      s.channel,
                  templateId:   stepTemplates[i] || null,
                  isManual:     !!s.isManual,
                  isBreakUp:    !!s.isBreakUp,
                  conditionJson: undefined,
                  positionX:    i * 280,
                  positionY:    0,
                })),
              },
            },
            include: { steps: { orderBy: { order: 'asc' }, select: STEP_SELECT } },
          })

          // 2.1) Encadeia nextStepId entre steps consecutivos. Break-up nunca
          // aponta pra um próximo (é terminal). Usa updateMany numa só ida ao
          // banco por step.
          for (let i = 0; i < cad.steps.length - 1; i++) {
            const current = cad.steps[i]!
            const next = cad.steps[i + 1]!
            if (current.isBreakUp) continue
            await tx.cadenceStep.update({
              where: { id: current.id },
              data: { nextStepId: next.id },
            })
          }

          // Recarrega com nextStepId já gravado pra retornar consistente.
          return tx.salesCadence.findUniqueOrThrow({
            where: { id: cad.id },
            include: { steps: { orderBy: { order: 'asc' }, select: STEP_SELECT } },
          })
        })
        return reply.code(201).send(created)
      } catch (err: any) {
        return reply.code(500).send({ error: err?.message ?? 'Falha ao salvar cadência.' })
      }
    },
  )

  // ── POST /api/admin/sales-cadences ── cria cadência (+ steps opcionais inline)
  app.post<{ Body: CadenceCreateBody }>(
    '/api/admin/sales-cadences',
    { preHandler: [authMiddleware, adminOnly] },
    async (req, reply) => {
      const err = validateCadence(req.body, true)
      if (err) return reply.code(400).send({ error: err })
      if (req.body.steps) {
        const stepErr = validateSteps(req.body.steps)
        if (stepErr) return reply.code(400).send({ error: stepErr })
      }

      const user = (req as any).user as JwtPayload
      const cadence = await prisma.salesCadence.create({
        data: {
          name: req.body.name.trim(),
          description: req.body.description ?? null,
          teamId: req.body.teamId ?? null,
          ownerId: user.userId,
          status: req.body.status ?? 'draft',
          triggerMode: req.body.triggerMode ?? 'manual',
          filterJson: (req.body.filterJson as any) ?? undefined,
          pauseOnReply: req.body.pauseOnReply ?? true,
          exitOnConversion: req.body.exitOnConversion ?? true,
          exitOnStatuses: (req.body.exitOnStatuses as any) ?? undefined,
          steps: req.body.steps && req.body.steps.length > 0
            ? {
                create: req.body.steps.map((s) => ({
                  order: s.order,
                  dayOffset: s.dayOffset ?? 0,
                  hourOffset: s.hourOffset ?? 0,
                  channel: s.channel,
                  templateId: s.templateId ?? null,
                  isManual: s.isManual ?? false,
                  isBreakUp: s.isBreakUp ?? false,
                  conditionJson: (s.conditionJson as any) ?? undefined,
                  positionX: s.positionX ?? 0,
                  positionY: s.positionY ?? 0,
                  // nextStepId/altStepId são references entre steps — só
                  // podem ser resolvidos depois que todos os steps existem.
                  // O canvas usa o endpoint individual PUT /steps/:stepId
                  // para gravá-los.
                })),
              }
            : undefined,
        },
        include: { steps: { orderBy: { order: 'asc' }, select: STEP_SELECT } },
      })
      return reply.code(201).send(cadence)
    },
  )

  // ── PUT /api/admin/sales-cadences/:id ── meta da cadência
  app.put<{ Params: { id: string }; Body: CadenceUpdateBody }>(
    '/api/admin/sales-cadences/:id',
    { preHandler: [authMiddleware, adminOnly] },
    async (req, reply) => {
      const id = Number(req.params.id)
      if (!Number.isFinite(id)) return reply.code(400).send({ error: 'id inválido' })

      const err = validateCadence(req.body, false)
      if (err) return reply.code(400).send({ error: err })

      const data: Record<string, unknown> = {}
      if (req.body.name !== undefined) data.name = req.body.name.trim()
      if (req.body.description !== undefined) data.description = req.body.description
      if (req.body.teamId !== undefined) data.teamId = req.body.teamId
      if (req.body.status !== undefined) data.status = req.body.status
      if (req.body.triggerMode !== undefined) data.triggerMode = req.body.triggerMode
      if (req.body.filterJson !== undefined) data.filterJson = req.body.filterJson
      if (req.body.pauseOnReply !== undefined) data.pauseOnReply = req.body.pauseOnReply
      if (req.body.exitOnConversion !== undefined) data.exitOnConversion = req.body.exitOnConversion
      if (req.body.exitOnStatuses !== undefined) data.exitOnStatuses = req.body.exitOnStatuses

      try {
        const updated = await prisma.salesCadence.update({
          where: { id },
          data,
          include: { steps: { orderBy: { order: 'asc' }, select: STEP_SELECT } },
        })
        return updated
      } catch {
        return reply.code(404).send({ error: 'não encontrada' })
      }
    },
  )

  // ── PUT /api/admin/sales-cadences/:id/steps ── substitui lista de steps
  // (delete-all + create-all dentro de uma transação).
  app.put<{ Params: { id: string }; Body: { steps: StepInput[] } }>(
    '/api/admin/sales-cadences/:id/steps',
    { preHandler: [authMiddleware, adminOnly] },
    async (req, reply) => {
      const id = Number(req.params.id)
      if (!Number.isFinite(id)) return reply.code(400).send({ error: 'id inválido' })

      const steps = req.body?.steps
      const stepErr = validateSteps(steps)
      if (stepErr) return reply.code(400).send({ error: stepErr })

      const cadence = await prisma.salesCadence.findUnique({ where: { id }, select: { id: true } })
      if (!cadence) return reply.code(404).send({ error: 'não encontrada' })

      // PUT /steps substitui todos os steps. Em modo lista (linear) o
      // canvas usa POST/PUT individuais — esse endpoint continua sendo o
      // caminho usado pelo editor de Lista do `SalesCadenceStepsEditor`,
      // por isso o replace zera positionX/Y/nextStepId/altStepId (o builder
      // visual reconstrói o layout). Em modo Canvas, prefira os endpoints
      // individuais para preservar a topologia.
      await prisma.$transaction([
        prisma.cadenceStep.deleteMany({ where: { cadenceId: id } }),
        prisma.cadenceStep.createMany({
          data: steps.map((s) => ({
            cadenceId: id,
            order: s.order,
            dayOffset: s.dayOffset ?? 0,
            hourOffset: s.hourOffset ?? 0,
            channel: s.channel,
            templateId: s.templateId ?? null,
            isManual: s.isManual ?? false,
            isBreakUp: s.isBreakUp ?? false,
            conditionJson: (s.conditionJson as any) ?? undefined,
            positionX: s.positionX ?? 0,
            positionY: s.positionY ?? 0,
          })),
        }),
      ])

      const result = await prisma.cadenceStep.findMany({
        where: { cadenceId: id },
        orderBy: { order: 'asc' },
        select: STEP_SELECT,
      })
      return { steps: result }
    },
  )

  // ── DELETE /api/admin/sales-cadences/:id ── remove (cascade em steps + enrollments)
  app.delete<{ Params: { id: string } }>(
    '/api/admin/sales-cadences/:id',
    { preHandler: [authMiddleware, adminOnly] },
    async (req, reply) => {
      const id = Number(req.params.id)
      if (!Number.isFinite(id)) return reply.code(400).send({ error: 'id inválido' })
      try {
        const user = (req as any).user as JwtPayload
        const snapshot = await snapshotEntity('cadence', id)
        if (snapshot) {
          await moveToTrash({
            entityType: 'cadence', entityId: id, entityLabel: (snapshot as any).name,
            snapshot, deletedBy: user?.userId, deletedByName: user?.name || user?.email,
          })
        }
        await prisma.salesCadence.delete({ where: { id } })
        return reply.code(204).send()
      } catch {
        return reply.code(404).send({ error: 'não encontrada' })
      }
    },
  )

  // ── GET /api/admin/sales-cadences/:id/metrics ── E1: dashboard data
  app.get<{ Params: { id: string } }>(
    '/api/admin/sales-cadences/:id/metrics',
    { preHandler: [authMiddleware, adminOnly] },
    async (req, reply) => {
      const id = Number(req.params.id)
      if (!Number.isFinite(id)) return reply.code(400).send({ error: 'id inválido' })
      const cadence = await prisma.salesCadence.findUnique({ where: { id }, select: { id: true } })
      if (!cadence) return reply.code(404).send({ error: 'cadência não encontrada' })
      const metrics = await getCadenceMetrics(id)
      return metrics
    },
  )

  // ── GET /api/admin/leads/:leadId/cadence-enrollments ── enrollments do lead
  // Usado pelo detalhe do lead (D4) pra mostrar aba "Cadências".
  app.get<{ Params: { leadId: string } }>(
    '/api/admin/leads/:leadId/cadence-enrollments',
    { preHandler: [authMiddleware, adminOnly] },
    async (req, reply) => {
      const leadId = Number(req.params.leadId)
      if (!Number.isFinite(leadId)) return reply.code(400).send({ error: 'leadId inválido' })
      const items = await prisma.cadenceEnrollment.findMany({
        where: { leadId },
        orderBy: { enrolledAt: 'desc' },
        include: {
          cadence: { select: { id: true, name: true, status: true } },
        },
      })
      return { items }
    },
  )

  // ── POST /api/admin/sales-cadences/:id/enrollments ── inscreve lead manualmente
  // Body: { leadId: number }. Cria enrollment com nextActionAt baseado no
  // primeiro step (offset zero = imediato).
  app.post<{ Params: { id: string }; Body: { leadId: number } }>(
    '/api/admin/sales-cadences/:id/enrollments',
    { preHandler: [authMiddleware, adminOnly] },
    async (req, reply) => {
      const id = Number(req.params.id)
      if (!Number.isFinite(id)) return reply.code(400).send({ error: 'id inválido' })
      const leadId = Number(req.body?.leadId)
      if (!Number.isFinite(leadId)) return reply.code(400).send({ error: 'leadId obrigatório' })

      const [cadence, lead] = await Promise.all([
        prisma.salesCadence.findUnique({
          where: { id },
          include: { steps: { orderBy: { order: 'asc' }, take: 1, select: { dayOffset: true, hourOffset: true } } },
        }),
        prisma.lead.findUnique({ where: { id: leadId }, select: { id: true } }),
      ])
      if (!cadence) return reply.code(404).send({ error: 'cadência não encontrada' })
      if (!lead) return reply.code(404).send({ error: 'lead não encontrado' })
      if (cadence.steps.length === 0) return reply.code(400).send({ error: 'cadência sem steps' })

      const first = cadence.steps[0]!
      const nextAt = new Date(Date.now() + (first.dayOffset * 24 + first.hourOffset) * 60 * 60 * 1000)

      // Schema tem @@unique([cadenceId, leadId]). Se já existe enrollment em
      // estado terminal (completed/exited), permitimos reinscrever — apaga o
      // antigo e cria um novo. Bloqueia se estiver active/paused (operador
      // precisa pausar/encerrar antes pra evitar duplicidade de execução).
      const existing = await prisma.cadenceEnrollment.findUnique({
        where: { cadenceId_leadId: { cadenceId: id, leadId } },
        select: { id: true, status: true },
      })

      if (existing && (existing.status === 'active' || existing.status === 'paused')) {
        return reply.code(409).send({
          error: `Lead já está inscrito nesta cadência (status: ${existing.status}). Encerre o enrollment atual antes de reinscrever.`,
        })
      }

      const enrollment = await prisma.$transaction(async (tx) => {
        if (existing) {
          await tx.cadenceEnrollment.delete({ where: { id: existing.id } })
        }
        return tx.cadenceEnrollment.create({
          data: {
            cadenceId: id,
            leadId,
            currentStep: 0,
            nextActionAt: nextAt,
            status: 'active',
          },
        })
      })

      return reply.code(201).send({ ...enrollment, reenrolled: !!existing })
    },
  )

  // ── Endpoints individuais de step (Builder Visual / Fase 26) ───────────
  // Diferente do PUT /steps (que substitui a lista inteira), estes endpoints
  // permitem mutações pontuais — usadas pelo canvas pra arrastar/conectar/
  // criar/deletar nodes sem reconstruir tudo.

  // ── POST /api/admin/sales-cadences/:id/steps ── adiciona um step
  app.post<{ Params: { id: string }; Body: StepInput }>(
    '/api/admin/sales-cadences/:id/steps',
    { preHandler: [authMiddleware, adminOnly] },
    async (req, reply) => {
      const id = Number(req.params.id)
      if (!Number.isFinite(id)) return reply.code(400).send({ error: 'id inválido' })

      const cadence = await prisma.salesCadence.findUnique({ where: { id }, select: { id: true } })
      if (!cadence) return reply.code(404).send({ error: 'cadência não encontrada' })

      const body = req.body
      if (!VALID_CHANNEL.has(body.channel)) {
        return reply.code(400).send({ error: `channel inválido: ${body.channel}` })
      }

      // Auto-`order`: append ao fim. Se body.order vier, respeita; senão
      // usa max+1 (necessário pra unique [cadenceId, order]).
      let order = body.order
      if (typeof order !== 'number' || order < 0) {
        const max = await prisma.cadenceStep.aggregate({
          where: { cadenceId: id },
          _max: { order: true },
        })
        order = (max._max.order ?? -1) + 1
      }

      const step = await prisma.cadenceStep.create({
        data: {
          cadenceId: id,
          order,
          dayOffset: body.dayOffset ?? 0,
          hourOffset: body.hourOffset ?? 0,
          channel: body.channel,
          templateId: body.templateId ?? null,
          isManual: body.isManual ?? false,
          isBreakUp: body.isBreakUp ?? false,
          conditionJson: (body.conditionJson as any) ?? undefined,
          positionX: body.positionX ?? 0,
          positionY: body.positionY ?? 0,
          nextStepId: body.nextStepId ?? null,
          altStepId: body.altStepId ?? null,
        },
        select: STEP_SELECT,
      })
      return reply.code(201).send(step)
    },
  )

  // ── PUT /api/admin/sales-cadences/:id/steps/:stepId ── atualiza um step
  app.put<{ Params: { id: string; stepId: string }; Body: Partial<StepInput> }>(
    '/api/admin/sales-cadences/:id/steps/:stepId',
    { preHandler: [authMiddleware, adminOnly] },
    async (req, reply) => {
      const id = Number(req.params.id)
      const stepId = Number(req.params.stepId)
      if (!Number.isFinite(id) || !Number.isFinite(stepId)) {
        return reply.code(400).send({ error: 'id/stepId inválido' })
      }

      const body = req.body ?? {}
      const data: Record<string, unknown> = {}

      if (body.channel !== undefined) {
        if (!VALID_CHANNEL.has(body.channel)) {
          return reply.code(400).send({ error: `channel inválido: ${body.channel}` })
        }
        data.channel = body.channel
      }
      for (const k of ['order', 'dayOffset', 'hourOffset', 'templateId', 'isManual', 'isBreakUp', 'conditionJson', 'positionX', 'positionY', 'nextStepId', 'altStepId'] as const) {
        if (body[k] !== undefined) data[k] = body[k]
      }

      try {
        const step = await prisma.cadenceStep.update({
          where: { id: stepId },
          data,
          select: STEP_SELECT,
        })
        return step
      } catch {
        return reply.code(404).send({ error: 'step não encontrado' })
      }
    },
  )

  // ── DELETE /api/admin/sales-cadences/:id/steps/:stepId ── remove um step
  // Antes de deletar, zera nextStepId/altStepId em qualquer step que aponte
  // pra ele — evita FK órfã (mesmo sem FK física, deixa o grafo consistente).
  app.delete<{ Params: { id: string; stepId: string } }>(
    '/api/admin/sales-cadences/:id/steps/:stepId',
    { preHandler: [authMiddleware, adminOnly] },
    async (req, reply) => {
      const id = Number(req.params.id)
      const stepId = Number(req.params.stepId)
      if (!Number.isFinite(id) || !Number.isFinite(stepId)) {
        return reply.code(400).send({ error: 'id/stepId inválido' })
      }

      try {
        await prisma.$transaction([
          prisma.cadenceStep.updateMany({
            where: { cadenceId: id, nextStepId: stepId },
            data: { nextStepId: null },
          }),
          prisma.cadenceStep.updateMany({
            where: { cadenceId: id, altStepId: stepId },
            data: { altStepId: null },
          }),
          prisma.cadenceStep.delete({ where: { id: stepId } }),
        ])
        return reply.code(204).send()
      } catch {
        return reply.code(404).send({ error: 'step não encontrado' })
      }
    },
  )

  // ── POST /api/admin/sales-cadences/:id/canvas-save ── persiste o estado
  // completo do canvas em UMA transação. Builder Visual (Fase 26) usa esse
  // endpoint pra trocar o auto-save do canvas por um buffer local com Save/
  // Discard. IDs negativos identificam novos (gera ID real + idMap p/ refs).
  app.post<{
    Params: { id: string }
    Body: {
      steps?: Array<{
        id: number
        order?: number
        dayOffset?: number
        hourOffset?: number
        channel?: string
        templateId?: number | null
        isManual?: boolean
        isBreakUp?: boolean
        conditionJson?: unknown
        positionX?: number
        positionY?: number
        nextStepId?: number | null
        altStepId?: number | null
      }>
      deletedStepIds?: number[]
    }
  }>(
    '/api/admin/sales-cadences/:id/canvas-save',
    { preHandler: [authMiddleware, adminOnly] },
    async (req, reply) => {
      const cadenceId = Number(req.params.id)
      if (!Number.isFinite(cadenceId)) return reply.code(400).send({ error: 'id inválido' })

      const incomingSteps = Array.isArray(req.body?.steps) ? req.body!.steps! : []
      const deletedIds = (Array.isArray(req.body?.deletedStepIds) ? req.body!.deletedStepIds! : [])
        .map(Number)
        .filter((n) => Number.isFinite(n) && n > 0)

      // Validação de canal antes de abrir transação.
      for (const s of incomingSteps) {
        if (s.channel !== undefined && !VALID_CHANNEL.has(s.channel)) {
          return reply.code(400).send({ error: `channel inválido: ${s.channel}` })
        }
      }

      const cadence = await prisma.salesCadence.findUnique({ where: { id: cadenceId }, select: { id: true } })
      if (!cadence) return reply.code(404).send({ error: 'cadência não encontrada' })

      try {
        const result = await prisma.$transaction(async (tx) => {
          // 1) Zera refs pra IDs deletados.
          if (deletedIds.length > 0) {
            await tx.cadenceStep.updateMany({
              where: { cadenceId, nextStepId: { in: deletedIds } },
              data: { nextStepId: null },
            })
            await tx.cadenceStep.updateMany({
              where: { cadenceId, altStepId: { in: deletedIds } },
              data: { altStepId: null },
            })
            // 2) Deleta.
            await tx.cadenceStep.deleteMany({
              where: { cadenceId, id: { in: deletedIds } },
            })
          }

          // 2.5) `order` é UNIQUE por cadência. Pra evitar colisão durante o
          // re-ordenamento, primeiro empurra todos os existentes pra um
          // intervalo "fora" (10000+) e depois grava as ordens finais.
          const existingIds = incomingSteps.filter((s) => s.id > 0).map((s) => s.id)
          if (existingIds.length > 0) {
            // Atribui orders temporários únicos baseados no id (ID é único).
            for (const sid of existingIds) {
              await tx.cadenceStep.update({
                where: { id: sid },
                data: { order: 10000 + sid },
              })
            }
          }

          // 3) Cria os novos (id negativo).
          const idMap = new Map<number, number>()
          const toCreate = incomingSteps.filter((s) => s.id < 0)
          for (const s of toCreate) {
            if (!s.channel || !VALID_CHANNEL.has(s.channel)) {
              throw new Error(`step novo sem channel válido (tempId=${s.id})`)
            }
            // Order final + offset alto pra não colidir até a última passada.
            const created = await tx.cadenceStep.create({
              data: {
                cadenceId,
                order:        20000 - s.id, // único, fora do intervalo final
                dayOffset:    s.dayOffset ?? 0,
                hourOffset:   s.hourOffset ?? 0,
                channel:      s.channel,
                templateId:   s.templateId ?? null,
                isManual:     s.isManual ?? false,
                isBreakUp:    s.isBreakUp ?? false,
                conditionJson: (s.conditionJson as any) ?? undefined,
                positionX:    s.positionX ?? 0,
                positionY:    s.positionY ?? 0,
              },
            })
            idMap.set(s.id, created.id)
          }

          function resolveRef(ref: number | null | undefined): number | null {
            if (ref === null || ref === undefined) return null
            if (ref > 0) return ref
            return idMap.get(ref) ?? null
          }

          // 4) Atualiza tudo com order final + refs resolvidas.
          for (const s of incomingSteps) {
            const realId = s.id > 0 ? s.id : idMap.get(s.id)
            if (!realId) continue
            const data: Record<string, unknown> = {}
            if (s.order !== undefined) data.order = s.order
            if (s.dayOffset !== undefined) data.dayOffset = s.dayOffset
            if (s.hourOffset !== undefined) data.hourOffset = s.hourOffset
            if (s.channel !== undefined) data.channel = s.channel
            if (s.templateId !== undefined) data.templateId = s.templateId
            if (s.isManual !== undefined) data.isManual = s.isManual
            if (s.isBreakUp !== undefined) data.isBreakUp = s.isBreakUp
            if (s.conditionJson !== undefined) data.conditionJson = s.conditionJson
            if (s.positionX !== undefined) data.positionX = s.positionX
            if (s.positionY !== undefined) data.positionY = s.positionY
            if (s.nextStepId !== undefined) data.nextStepId = resolveRef(s.nextStepId)
            if (s.altStepId !== undefined) data.altStepId = resolveRef(s.altStepId)
            if (Object.keys(data).length > 0) {
              await tx.cadenceStep.update({ where: { id: realId }, data })
            }
          }

          const finalSteps = await tx.cadenceStep.findMany({
            where: { cadenceId },
            orderBy: { order: 'asc' },
            select: STEP_SELECT,
          })
          return { steps: finalSteps, idMap: Object.fromEntries(idMap) }
        })
        return result
      } catch (err: any) {
        return reply.code(500).send({ error: err?.message ?? 'Falha ao salvar canvas' })
      }
    },
  )

  // ── GET /api/admin/sales-cadences/:id/execution-stats ── stats pro canvas
  // (modo Execução). Retorna por step: leadsHere (active+nextActionAt no step)
  // e totalPassed (CadenceStepExecution executadas com status terminal). Por
  // edge: count de transições consecutivas inferido pelas execuções ordenadas.
  app.get<{ Params: { id: string } }>(
    '/api/admin/sales-cadences/:id/execution-stats',
    { preHandler: [authMiddleware, adminOnly] },
    async (req, reply) => {
      const cadenceId = Number(req.params.id)
      if (!Number.isFinite(cadenceId)) return reply.code(400).send({ error: 'id inválido' })

      const [steps, leadsHereGroup, passedGroup, allCompleted, statusGroup] = await Promise.all([
        prisma.cadenceStep.findMany({
          where: { cadenceId },
          select: { id: true, order: true, nextStepId: true, altStepId: true },
        }),
        // Enrollments ativos: o `currentStep` aponta pro `order` do próximo
        // step a executar — ou seja, ele "está parado naquele step".
        prisma.cadenceEnrollment.groupBy({
          by: ['currentStep'],
          where: { cadenceId, status: 'active' },
          _count: { _all: true },
        }),
        prisma.cadenceStepExecution.groupBy({
          by: ['stepId'],
          where: { enrollment: { cadenceId } },
          _count: { _all: true },
        }),
        prisma.cadenceStepExecution.findMany({
          where: { enrollment: { cadenceId } },
          orderBy: [{ enrollmentId: 'asc' }, { executedAt: 'asc' }],
          select: { enrollmentId: true, stepId: true },
        }),
        prisma.cadenceEnrollment.groupBy({
          by: ['status'],
          where: { cadenceId },
          _count: { _all: true },
        }),
      ])

      const orderToStepId = new Map<number, number>()
      for (const s of steps) orderToStepId.set(s.order, s.id)

      const leadsHereMap = new Map<number, number>()
      for (const r of leadsHereGroup) {
        const sid = orderToStepId.get(r.currentStep)
        if (sid !== undefined) leadsHereMap.set(sid, r._count._all)
      }
      const passedMap = new Map<number, number>()
      for (const r of passedGroup) passedMap.set(r.stepId, r._count._all)

      const pairCounts = new Map<string, number>()
      let prevEnrollment = -1
      let prevStepId = -1
      for (const r of allCompleted) {
        if (r.enrollmentId !== prevEnrollment) {
          prevEnrollment = r.enrollmentId
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
    },
  )
}
