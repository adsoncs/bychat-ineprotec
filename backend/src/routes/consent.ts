import { FastifyInstance } from 'fastify'
import { readFileSync } from 'fs'
import path from 'path'
import { prisma } from '../lib/prisma.js'

/**
 * Consentimento (LGPD): serve o cliente de consentimento (cc.js) e registra a
 * escolha do titular (ConsentLog). Endpoints públicos, sem auth.
 */

function loadCc(): string {
  const candidates = [
    path.resolve(process.cwd(), '../frontend/cc.js'),
    path.resolve(process.cwd(), 'frontend/cc.js'),
    '/var/www/bychat-beyond/frontend/cc.js',
  ]
  for (const p of candidates) {
    try { return readFileSync(p, 'utf8') } catch (e) { /* tenta o próximo */ }
  }
  return '/* cc.js not found */'
}

let CC_CACHE: string | null = null

function getIp(req: any): string {
  const xff = (req.headers['x-forwarded-for'] || '') as string
  return (xff.split(',')[0] || req.ip || '').trim().slice(0, 64)
}

/**
 * Registra o consentimento de um titular (lead) vinculado a um envio de
 * formulário / portal — prova formal (art. 8, §1º LGPD). A versão da política
 * é resolvida no servidor (Setting legal.version) para não depender do client.
 * Best-effort: nunca lança (não pode quebrar o fluxo de captura do lead).
 */
export async function logTitularConsent(opts: {
  req: any
  leadId?: number | null
  visitorId?: string | null
  action: string
  source?: string | null
  url?: string | null
  categories?: Record<string, boolean>
}): Promise<void> {
  try {
    const verRow = await prisma.setting.findFirst({ where: { key: 'legal.version' }, select: { value: true } })
    const policyVersion = (verRow?.value ? String(verRow.value) : '1.0').slice(0, 20)
    await prisma.consentLog.create({
      data: {
        leadId: typeof opts.leadId === 'number' ? opts.leadId : null,
        visitorId: opts.visitorId ? String(opts.visitorId).slice(0, 64) : null,
        categories: opts.categories || { titular: true },
        policyVersion,
        action: String(opts.action || 'titular').slice(0, 20),
        source: opts.source ? String(opts.source).slice(0, 60) : null,
        url: opts.url ? String(opts.url).slice(0, 2000) : null,
        ip: getIp(opts.req),
        userAgent: (opts.req?.headers?.['user-agent'] || '').toString().slice(0, 1000) || null,
      },
    })
  } catch (e: any) {
    opts.req?.log?.warn?.({ err: e?.message }, '[consent] logTitularConsent falhou')
  }
}

export async function consentRoutes(app: FastifyInstance) {
  // ── GET /api/consent/cc.js — serve o cliente de consentimento ──
  app.get('/api/consent/cc.js', async (_req, reply) => {
    if (CC_CACHE === null || process.env.NODE_ENV !== 'production') CC_CACHE = loadCc()
    reply
      .type('application/javascript')
      .header('Cache-Control', 'public, max-age=3600')
      .send(CC_CACHE)
  })

  // ── POST /api/public/consent — registra a escolha do titular ──
  app.post('/api/public/consent', async (req, reply) => {
    try {
      const b = (req.body || {}) as any
      const cats = b.categories && typeof b.categories === 'object' ? b.categories : {}
      const visitorId = ((req as any).cookies?.bt_vid || b.visitorId || null) as string | null
      await prisma.consentLog.create({
        data: {
          visitorId: visitorId ? String(visitorId).slice(0, 64) : null,
          leadId: typeof b.leadId === 'number' ? b.leadId : null,
          categories: { analytics: !!cats.analytics, marketing: !!cats.marketing },
          policyVersion: String(b.policyVersion || '1.0').slice(0, 20),
          action: String(b.action || 'custom').slice(0, 20),
          source: b.source ? String(b.source).slice(0, 60) : null,
          url: b.url ? String(b.url).slice(0, 2000) : null,
          ip: getIp(req),
          userAgent: (req.headers['user-agent'] || '').toString().slice(0, 1000) || null,
        },
      })
      reply.send({ ok: true })
    } catch (e: any) {
      req.log?.warn?.({ err: e?.message }, '[consent] falha ao registrar')
      reply.code(200).send({ ok: false })
    }
  })
}
