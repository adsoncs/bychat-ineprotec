// src/routes/systemEmails.ts
//
// CRUD do painel "Configurações > Emails do Sistema" (apenas SUPERADMIN).
// Permite editar subject/html de emails que o sistema dispara automaticamente
// em pontos críticos (notificação de novo lead, diagnóstico, reset de senha,
// teste, defaults de Activity tipo email).
//
// Usuário NÃO consegue criar templates novos por aqui — só editar os seeds
// pré-cadastrados pelo backend (controlamos a `key` que o code referencia).

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { superadminOnly, type JwtPayload } from '../lib/auth.js'
import { renderSystemEmail, nowVars, SYSTEM_EMAIL_TEMPLATES } from '../services/systemEmailTemplates.js'
import { getBranding } from '../lib/branding.js'

export async function systemEmailsRoutes(app: FastifyInstance) {
  // GET /api/admin/system-emails — lista todos os templates
  app.get('/api/admin/system-emails', { preHandler: superadminOnly }, async () => {
    const rows = await prisma.systemEmailTemplate.findMany({ orderBy: [{ category: 'asc' }, { name: 'asc' }] })
    return rows
  })

  // GET /api/admin/system-emails/:key — um template específico
  app.get('/api/admin/system-emails/:key', { preHandler: superadminOnly }, async (req, reply) => {
    const { key } = req.params as any
    const tpl = await prisma.systemEmailTemplate.findUnique({ where: { key: String(key) } })
    if (!tpl) return reply.code(404).send({ error: 'Template não encontrado' })
    return tpl
  })

  // PUT /api/admin/system-emails/:key — edita subject/html/enabled
  app.put('/api/admin/system-emails/:key', { preHandler: superadminOnly }, async (req, reply) => {
    const { key } = req.params as any
    const body = req.body as any
    const data: Record<string, any> = {}
    if (typeof body.subject === 'string') data.subject = body.subject
    if (typeof body.htmlBody === 'string') data.htmlBody = body.htmlBody
    if (typeof body.enabled === 'boolean') data.enabled = body.enabled
    if (Object.keys(data).length === 0) return reply.code(400).send({ error: 'Nada pra atualizar' })
    const user = (req as any).user as JwtPayload
    data.updatedById = user?.userId ?? null
    try {
      const updated = await prisma.systemEmailTemplate.update({ where: { key: String(key) }, data })
      return updated
    } catch (e: any) {
      return reply.code(404).send({ error: 'Template não encontrado' })
    }
  })

  // POST /api/admin/system-emails/:key/reset — restaura para o seed original
  app.post('/api/admin/system-emails/:key/reset', { preHandler: superadminOnly }, async (req, reply) => {
    const { key } = req.params as any
    const seed = SYSTEM_EMAIL_TEMPLATES.find((t) => t.key === String(key))
    if (!seed) return reply.code(404).send({ error: 'Template não encontrado nos seeds' })
    const user = (req as any).user as JwtPayload
    const updated = await prisma.systemEmailTemplate.upsert({
      where: { key: seed.key },
      create: {
        key: seed.key,
        name: seed.name,
        description: seed.description,
        subject: seed.subject,
        htmlBody: seed.htmlBody,
        enabled: true,
        variables: seed.variables as any,
        category: seed.category,
        updatedById: user?.userId ?? null,
      },
      update: {
        subject: seed.subject,
        htmlBody: seed.htmlBody,
        variables: seed.variables as any,
        updatedById: user?.userId ?? null,
      },
    })
    return updated
  })

  // POST /api/admin/system-emails/:key/preview — renderiza com dados de exemplo
  app.post('/api/admin/system-emails/:key/preview', { preHandler: superadminOnly }, async (req, reply) => {
    const { key } = req.params as any
    const body = (req.body || {}) as any
    const sampleVars = body.vars && typeof body.vars === 'object' ? body.vars : await defaultPreviewVars(String(key))
    const rendered = await renderSystemEmail(String(key), sampleVars)
    if (!rendered) return reply.code(404).send({ error: 'Template não encontrado' })
    return rendered
  })

  // POST /api/admin/system-emails/:key/send-test — envia preview pro endereço informado
  app.post('/api/admin/system-emails/:key/send-test', { preHandler: superadminOnly }, async (req, reply) => {
    const { key } = req.params as any
    const body = req.body as any
    const to = String(body.to || '').trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return reply.code(400).send({ error: 'Email destinatário inválido' })

    const sampleVars = body.vars && typeof body.vars === 'object' ? body.vars : await defaultPreviewVars(String(key))
    const rendered = await renderSystemEmail(String(key), sampleVars)
    if (!rendered) return reply.code(404).send({ error: 'Template não encontrado' })
    if (!rendered.enabled) return reply.code(400).send({ error: 'Template está desativado' })

    const { sendEmailGeneric, getEmailConfig, getFromAddress } = await import('../services/notify.js')
    const cfg = await getEmailConfig()
    try {
      await sendEmailGeneric({
        from: getFromAddress(cfg, 'Teste'),
        to,
        subject: `[preview] ${rendered.subject}`,
        html: rendered.html,
      })
      return { ok: true }
    } catch (e: any) {
      return reply.code(500).send({ error: e.message || 'Falha ao enviar' })
    }
  })
}

// Variáveis de exemplo realistas pra preview/teste sem dados reais.
async function defaultPreviewVars(key: string): Promise<Record<string, unknown>> {
  const brand = await getBranding()
  const base = { brand, ...nowVars() }
  if (key === 'notify_new_lead_admin') {
    return {
      ...base,
      lead: {
        nome: 'Maria Silva',
        empresa: 'ACME Solutions',
        whatsapp: '+55 11 98765-4321',
        whatsappDigits: '11987654321',
        email: 'maria@acme.com.br',
        segmento: 'Educação',
        cidade: 'São Paulo',
        maturidade: 'Em crescimento',
        solucaoNome: 'Captação Ads + Funil de WhatsApp',
      },
      scores: { geral: 78, mkt: 82, vnd: 65, oferta: 87 },
      investmentLabel: 'R$5.000–10.000/mês',
    }
  }
  if (key === 'lead_diagnostic_report') {
    return {
      ...base,
      lead: {
        nome: 'Maria Silva',
        empresa: 'ACME Solutions',
        whatsappDigits: '11987654321',
        maturidade: 'Em crescimento',
        solucaoNome: 'Captação Ads + Funil de WhatsApp',
      },
      scores: { geral: 78 },
    }
  }
  if (key === 'password_reset') {
    return {
      ...base,
      user: { name: 'João Operador', email: 'joao@beyondhub.com.br' },
      resetLink: 'https://bychat.ia.br/reset-password?token=abcdef123456',
    }
  }
  if (key === 'activity_email_default') {
    return {
      ...base,
      lead: { nome: 'Maria Silva', empresa: 'ACME Solutions' },
      activity: { title: 'Apresentar proposta atualizada', body: 'Enviei a proposta com os ajustes que combinamos. Qualquer dúvida, me avise.' },
      user: { name: 'João Operador' },
    }
  }
  return base
}
