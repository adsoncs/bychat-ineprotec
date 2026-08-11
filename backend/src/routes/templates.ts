// src/routes/templates.ts
// CRUD de templates de mensagem para atividades

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware, type JwtPayload } from '../lib/auth.js'
import { moveToTrash, snapshotEntity } from '../services/trash.js'

// Variaveis disponiveis para substituicao
export const TEMPLATE_VARIABLES = [
  { key: 'nome', label: 'Nome do contato', example: 'Joao' },
  { key: 'empresa', label: 'Nome da empresa', example: 'Hub2you' },
  { key: 'email', label: 'E-mail do lead', example: 'joao@empresa.com' },
  { key: 'whatsapp', label: 'WhatsApp do lead', example: '5562999999999' },
  { key: 'segmento', label: 'Segmento', example: 'Tecnologia/SaaS' },
  { key: 'cidade', label: 'Cidade', example: 'Goiania/GO' },
  { key: 'score', label: 'Score geral', example: '72' },
  { key: 'maturidade', label: 'Nivel de maturidade', example: 'Em Crescimento' },
  { key: 'solucao', label: 'Solucao recomendada', example: 'Growth Marketing 2.0' },
  { key: 'status', label: 'Etapa no funil', example: 'CONTATADO' },
  { key: 'operador', label: 'Nome do operador', example: 'Maria' },
  { key: 'data_hoje', label: 'Data de hoje', example: '04/04/2026' },
]

// Substituir variaveis {{key}} no texto
export function replaceVariables(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] || `{{${key}}}`)
}

// Normaliza o atalho: sem a "/" inicial, minúsculo, só [a-z0-9_-]. Vazio → null.
export function normalizeShortcut(raw: any): string | null {
  const s = String(raw ?? '').trim().replace(/^\//, '').toLowerCase().replace(/[^a-z0-9_-]/g, '')
  return s ? s.slice(0, 40) : null
}

// Montar variaveis a partir de um lead
export function buildLeadVars(lead: any, operatorName?: string): Record<string, string> {
  const sc = (lead.scores || {}) as any
  return {
    nome: lead.nome || '',
    empresa: lead.empresa || '',
    email: lead.email || '',
    whatsapp: lead.whatsapp || '',
    segmento: lead.segmento || '',
    cidade: lead.cidade || '',
    score: String(sc.geral || 0),
    maturidade: lead.maturidade || '',
    solucao: lead.solucaoNome || '',
    status: lead.status || '',
    operador: operatorName || '',
    data_hoje: new Date().toLocaleDateString('pt-BR'),
  }
}

export async function templatesRoutes(app: FastifyInstance) {

  // ── GET /api/templates — Listar templates ──
  app.get('/api/templates', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const where: any = { active: true }
    if (q.channel) where.channel = q.channel
    if (q.category) where.category = q.category

    const templates = await prisma.messageTemplate.findMany({
      where,
      orderBy: [{ usageCount: 'desc' }, { name: 'asc' }],
    })
    return { templates }
  })

  // ── GET /api/templates/variables — Lista de variaveis disponiveis ──
  app.get('/api/templates/variables', { preHandler: authMiddleware }, async () => {
    return { variables: TEMPLATE_VARIABLES }
  })

  // ── GET /api/templates/:id — Detalhe do template ──
  app.get('/api/templates/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const template = await prisma.messageTemplate.findUnique({ where: { id: parseInt(id) } })
    if (!template) return reply.code(404).send({ error: 'Template nao encontrado' })
    return { template }
  })

  // ── POST /api/templates — Criar template ──
  app.post('/api/templates', { preHandler: authMiddleware }, async (req, reply) => {
    const body = req.body as any
    if (!body.name || !body.channel || !body.body) {
      return reply.code(400).send({ error: 'name, channel e body sao obrigatorios' })
    }

    const template = await prisma.messageTemplate.create({
      data: {
        name: body.name,
        channel: body.channel,
        category: body.category || 'general',
        subject: body.subject || null,
        body: body.body,
        bodyHtml: body.bodyHtml || null,
        attachmentUrl: body.attachmentUrl || null,
        attachmentName: body.attachmentName || null,
        attachmentType: body.attachmentType || null,
        header: body.header || null,
        footer: body.footer || null,
        options: Array.isArray(body.options) && body.options.length ? body.options : undefined,
        shortcut: normalizeShortcut(body.shortcut),
        variables: body.variables || undefined,
      }
    })
    return reply.code(201).send({ ok: true, template })
  })

  // ── PUT /api/templates/:id — Atualizar template ──
  app.put('/api/templates/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const body = req.body as any
    const data: any = {}
    if (body.name !== undefined) data.name = body.name
    if (body.channel !== undefined) data.channel = body.channel
    if (body.category !== undefined) data.category = body.category
    if (body.subject !== undefined) data.subject = body.subject
    if (body.body !== undefined) data.body = body.body
    if (body.bodyHtml !== undefined) data.bodyHtml = body.bodyHtml
    if (body.attachmentUrl !== undefined) data.attachmentUrl = body.attachmentUrl
    if (body.attachmentName !== undefined) data.attachmentName = body.attachmentName
    if (body.attachmentType !== undefined) data.attachmentType = body.attachmentType
    if (body.header !== undefined) data.header = body.header || null
    if (body.footer !== undefined) data.footer = body.footer || null
    if (body.options !== undefined) data.options = Array.isArray(body.options) && body.options.length ? body.options : null
    if (body.shortcut !== undefined) data.shortcut = normalizeShortcut(body.shortcut)
    if (body.variables !== undefined) data.variables = body.variables
    if (body.active !== undefined) data.active = body.active

    const template = await prisma.messageTemplate.update({ where: { id: parseInt(id) }, data })
    return { ok: true, template }
  })

  // ── DELETE /api/templates/:id — Deletar template (move para lixeira) ──
  app.delete('/api/templates/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const user = (req as any).user as JwtPayload
    const snapshot = await snapshotEntity('template', parseInt(id))
    if (snapshot) {
      await moveToTrash({
        entityType: 'template',
        entityId: parseInt(id),
        entityLabel: (snapshot as any).name,
        snapshot,
        deletedBy: user.userId,
        deletedByName: user.name || user.email,
      })
    }
    await prisma.messageTemplate.delete({ where: { id: parseInt(id) } })
    return { ok: true }
  })

  // ── POST /api/templates/:id/preview — Preview com variaveis de um lead ──
  app.post('/api/templates/:id/preview', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const { leadId } = req.body as any

    const template = await prisma.messageTemplate.findUnique({ where: { id: parseInt(id) } })
    if (!template) return reply.code(404).send({ error: 'Template nao encontrado' })

    // Dados da NOSSA empresa (endereço, mapa, PIX). Ficam disponíveis mesmo sem
    // lead: um modelo de "onde ficamos" não depende de quem vai receber.
    const { buildCompanyVars } = await import('../services/companyIdentity.js')
    let vars: Record<string, string> = await buildCompanyVars().catch(() => ({}))
    if (leadId) {
      const lead = await prisma.lead.findUnique({ where: { id: parseInt(leadId) } })
      if (lead) {
        const user = (req as any).user
        vars = { ...vars, ...buildLeadVars(lead, user?.email) }
      }
    }

    // Uso real: o preview é o que o Conversas chama ao inserir um atalho. Antes
    // só `activities.ts` contava, então o ranking de "mais usado" ignorava o
    // canal onde o modelo mais é usado — o chat.
    prisma.messageTemplate.update({
      where: { id: template.id },
      data: { usageCount: { increment: 1 } },
    }).catch(() => {})

    // Monta a mensagem final: cabeçalho, corpo, rodapé e opções numeradas. É
    // esse texto que entra no compositor — a Evolution não envia botão, então a
    // lista numerada é a forma de oferecer escolhas fechadas fora da Cloud API.
    const partes: string[] = []
    if (template.header) partes.push(`*${replaceVariables(template.header, vars)}*`)
    partes.push(replaceVariables(template.body, vars))
    const opcoes = Array.isArray(template.options) ? (template.options as string[]) : []
    if (opcoes.length) {
      partes.push(opcoes.map((o, i) => `${i + 1}) ${replaceVariables(String(o), vars)}`).join('\n'))
    }
    if (template.footer) partes.push(`_${replaceVariables(template.footer, vars)}_`)
    const composto = partes.join('\n\n')

    return {
      subject: template.subject ? replaceVariables(template.subject, vars) : null,
      body: composto,
      // Corpo sem a composição, para quem precisa só do texto puro.
      rawBody: replaceVariables(template.body, vars),
      bodyHtml: template.bodyHtml ? replaceVariables(template.bodyHtml, vars) : null,
      variables: vars,
    }
  })
}
