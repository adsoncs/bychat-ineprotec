// src/routes/personas.ts
// CRUD de Personas/ICPs + endpoint helper que devolve a persona ativa como
// "system context" pra IA (ler em chatbot, Sales AI, cadências).

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { adminOnly, authMiddleware, type JwtPayload } from '../lib/auth.js'

interface PersonaInput {
  name?: string
  description?: string | null
  ageRange?: string | null
  genderHint?: string | null
  location?: string | null
  occupation?: string | null
  income?: string | null
  painPoints?: string[] | null
  objections?: string[] | null
  triggers?: string[] | null
  channels?: string[] | null
  voiceTone?: string | null
  examplePhrases?: string[] | null
  goals?: string[] | null
  active?: boolean
  isDefault?: boolean
}

function s(v: any, max: number): string | null {
  if (v === null || v === undefined) return null
  const str = String(v).trim().substring(0, max)
  return str || null
}
function listOrNull(v: any, maxLen: number, maxStrLen: number): any {
  if (!Array.isArray(v)) return null
  const cleaned = v.map(item => String(item).trim().substring(0, maxStrLen)).filter(Boolean).slice(0, maxLen)
  return cleaned.length > 0 ? cleaned : null
}

function buildData(body: PersonaInput) {
  return {
    name: s(body.name, 191) || 'Sem nome',
    description: body.description ? s(body.description, 5_000) : null,
    ageRange: s(body.ageRange, 60),
    genderHint: s(body.genderHint, 40),
    location: s(body.location, 191),
    occupation: s(body.occupation, 191),
    income: s(body.income, 60),
    painPoints: listOrNull(body.painPoints, 20, 300),
    objections: listOrNull(body.objections, 20, 300),
    triggers: listOrNull(body.triggers, 20, 300),
    channels: listOrNull(body.channels, 20, 80),
    voiceTone: s(body.voiceTone, 2_000),
    examplePhrases: listOrNull(body.examplePhrases, 20, 300),
    goals: listOrNull(body.goals, 20, 300),
    active: body.active !== false,
    isDefault: !!body.isDefault,
  }
}

// Monta um system prompt curto e estruturado a partir da persona — útil pra
// integrar em chamadas de IA sem expor todo o JSON.
function personaToSystemPrompt(p: any): string {
  const parts: string[] = []
  parts.push(`# Persona-alvo: ${p.name}`)
  if (p.description) parts.push(p.description)
  const demographics = [
    p.occupation && `Ocupação: ${p.occupation}`,
    p.ageRange && `Faixa etária: ${p.ageRange}`,
    p.location && `Localização: ${p.location}`,
    p.income && `Renda: ${p.income}`,
  ].filter(Boolean)
  if (demographics.length > 0) parts.push(`## Demografia\n- ${demographics.join('\n- ')}`)
  if (Array.isArray(p.painPoints) && p.painPoints.length > 0) parts.push(`## Dores principais\n- ${p.painPoints.join('\n- ')}`)
  if (Array.isArray(p.objections) && p.objections.length > 0) parts.push(`## Objeções comuns\n- ${p.objections.join('\n- ')}`)
  if (Array.isArray(p.triggers) && p.triggers.length > 0) parts.push(`## Gatilhos de compra\n- ${p.triggers.join('\n- ')}`)
  if (Array.isArray(p.goals) && p.goals.length > 0) parts.push(`## Objetivos do cliente\n- ${p.goals.join('\n- ')}`)
  if (p.voiceTone) parts.push(`## Tom de voz ao falar com essa persona\n${p.voiceTone}`)
  if (Array.isArray(p.examplePhrases) && p.examplePhrases.length > 0) parts.push(`## Frases que ele usaria\n- ${p.examplePhrases.join('\n- ')}`)
  if (Array.isArray(p.channels) && p.channels.length > 0) parts.push(`## Canais preferidos\n- ${p.channels.join('\n- ')}`)
  return parts.join('\n\n')
}

export async function personasRoutes(app: FastifyInstance) {

  app.get('/api/admin/personas', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const archived = q?.archived === 'true' || q?.archived === '1'
    const where: any = { active: !archived }
    const data = await prisma.persona.findMany({
      where,
      orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
      take: 200,
    })
    return { data }
  })

  app.get('/api/admin/personas/default', { preHandler: authMiddleware }, async () => {
    const p = await prisma.persona.findFirst({ where: { active: true, isDefault: true } })
    if (!p) return { data: null, systemPrompt: null }
    return { data: p, systemPrompt: personaToSystemPrompt(p) }
  })

  app.get('/api/admin/personas/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const p = await prisma.persona.findUnique({ where: { id: parseInt(id) } })
    if (!p) return reply.code(404).send({ error: 'Persona não encontrada' })
    return { data: p, systemPrompt: personaToSystemPrompt(p) }
  })

  app.post('/api/admin/personas', { preHandler: adminOnly }, async (req, reply) => {
    const body = (req.body as PersonaInput) || {}
    if (!body.name || !String(body.name).trim()) return reply.code(400).send({ error: 'Nome é obrigatório' })
    const user = (req as any).user as JwtPayload
    const data = buildData(body)
    // Se vier isDefault, desmarca as outras primeiro (uma só pode ser default)
    if (data.isDefault) {
      await prisma.persona.updateMany({ where: { isDefault: true }, data: { isDefault: false } })
    }
    const p = await prisma.persona.create({
      data: { ...data, createdById: user?.userId ?? null } as any,
    })
    return reply.code(201).send({ data: p })
  })

  app.put('/api/admin/personas/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const body = (req.body as PersonaInput) || {}
    if (!body.name || !String(body.name).trim()) return reply.code(400).send({ error: 'Nome é obrigatório' })
    const idNum = parseInt(id)
    const data = buildData(body)
    if (data.isDefault) {
      await prisma.persona.updateMany({ where: { isDefault: true, NOT: { id: idNum } }, data: { isDefault: false } })
    }
    try {
      const p = await prisma.persona.update({ where: { id: idNum }, data: data as any })
      return { data: p }
    } catch (e: any) {
      return reply.code(404).send({ error: e.message })
    }
  })

  app.patch('/api/admin/personas/:id/default', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const idNum = parseInt(id)
    await prisma.persona.updateMany({ where: { isDefault: true, NOT: { id: idNum } }, data: { isDefault: false } })
    try {
      const p = await prisma.persona.update({ where: { id: idNum }, data: { isDefault: true, active: true } })
      return { data: p }
    } catch (e: any) {
      return reply.code(404).send({ error: e.message })
    }
  })

  app.patch('/api/admin/personas/:id/archive', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const body = (req.body as any) || {}
    try {
      const p = await prisma.persona.update({
        where: { id: parseInt(id) },
        data: { active: !body.archived, ...(body.archived ? { isDefault: false } : {}) },
      })
      return { data: p }
    } catch (e: any) {
      return reply.code(404).send({ error: e.message })
    }
  })

  app.delete('/api/admin/personas/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    try {
      await prisma.persona.delete({ where: { id: parseInt(id) } })
      return { ok: true }
    } catch (e: any) {
      return reply.code(404).send({ error: e.message })
    }
  })
}

// Exportado para uso por serviços de IA (chatbot, salesAi, cadências) — devolve
// o system prompt da persona ativa, ou null se nenhuma definida.
export async function getActivePersonaSystemPrompt(): Promise<string | null> {
  const p = await prisma.persona.findFirst({ where: { active: true, isDefault: true } }).catch(() => null)
  return p ? personaToSystemPrompt(p as any) : null
}
