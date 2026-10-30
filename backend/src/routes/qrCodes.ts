// src/routes/qrCodes.ts
// QR Codes dinâmicos — Ferramentas › QR Code.
//
// Cada QR salvo ganha dois endereços curtos que passam por aqui antes do destino:
//   /q/<slug>  é o que vai DENTRO do QR (conta como leitura)
//   /c/<slug>  é o link para colar em bio, post, e-mail (conta como clique)
// Assim o relatório separa "escanearam o panfleto" de "clicaram no link", e o
// destino pode ser trocado depois sem reimprimir nada.
//
// Os redirecionamentos públicos NÃO dependem do módulo Ferramentas estar ligado:
// QR impresso não pode quebrar porque alguém desligou um interruptor. Só
// `active=false` (ou a validade vencida) tira um QR do ar.

import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import crypto from 'crypto'
import { prisma } from '../lib/prisma.js'
import { authMiddleware, adminOnly } from '../lib/auth.js'
import { appUrl } from '../lib/appUrl.js'
import { renderQrSvg, sanitizeQrStyle } from '../lib/qrRender.js'
import { parseUA, isBotUA } from './trackableLinks.js'

const KINDS = ['url', 'whatsapp', 'text', 'vcard', 'email', 'sms', 'tel', 'wifi'] as const
type Kind = typeof KINDS[number]

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

function slugify(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 64)
}

function randomSlug(len = 7): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789'
  const bytes = crypto.randomBytes(len)
  let out = ''
  for (let i = 0; i < len; i++) out += chars[bytes[i]! % chars.length]
  return out
}

function baseUrl(req: FastifyRequest): string {
  return appUrl() || `${req.protocol}://${req.headers.host}`
}

const str = (v: unknown, max = 500) => (v == null ? '' : String(v).trim().slice(0, max))
const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '')

// ── Conteúdo por tipo ─────────────────────────────────────────

function wifiString(p: any): string {
  const e = (s: string) => s.replace(/([\\;,:"])/g, '\\$1')
  const auth = ['WPA', 'WEP', 'nopass'].includes(p?.auth) ? p.auth : 'WPA'
  return `WIFI:T:${auth};S:${e(str(p?.ssid, 64))};${auth === 'nopass' ? '' : `P:${e(str(p?.password, 64))};`}${p?.hidden ? 'H:true;' : ''};`
}

function vcardString(p: any): string {
  const e = (s: string) => s.replace(/([\\;,])/g, '\\$1').replace(/\r?\n/g, '\\n')
  const first = str(p?.firstName, 80), last = str(p?.lastName, 80)
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `N:${e(last)};${e(first)};;;`, `FN:${e([first, last].filter(Boolean).join(' ') || 'Contato')}`]
  if (p?.company) lines.push(`ORG:${e(str(p.company, 120))}`)
  if (p?.title) lines.push(`TITLE:${e(str(p.title, 120))}`)
  if (p?.phone) lines.push(`TEL;TYPE=CELL:${str(p.phone, 30)}`)
  if (p?.email) lines.push(`EMAIL:${str(p.email, 120)}`)
  if (p?.website) lines.push(`URL:${str(p.website, 300)}`)
  if (p?.address) lines.push(`ADR;TYPE=WORK:;;${e(str(p.address, 200))};;;;`)
  if (p?.note) lines.push(`NOTE:${e(str(p.note, 500))}`)
  lines.push('END:VCARD')
  return lines.join('\r\n')
}

/** Acrescenta as UTMs do QR à URL de destino sem sobrescrever as que já estão nela. */
function withUtms(url: string, qr: any, via: 'qr' | 'link'): string {
  let u: URL
  try { u = new URL(url) } catch { return url }
  const set = (k: string, v: string | null | undefined) => { if (v && !u.searchParams.has(k)) u.searchParams.set(k, v) }
  set('utm_source', qr.utmSource)
  set('utm_medium', qr.utmMedium || (via === 'qr' ? 'qrcode' : null))
  set('utm_campaign', qr.utmCampaign)
  set('utm_content', qr.utmContent)
  set('utm_term', qr.utmTerm)
  return u.toString()
}

/** Para onde o acesso vai. `null` = o tipo é servido como página/arquivo. */
function destinationFor(qr: any, via: 'qr' | 'link'): string | null {
  const p = qr.payload || {}
  switch (qr.kind as Kind) {
    case 'url': return qr.destinationUrl ? withUtms(qr.destinationUrl, qr, via) : null
    case 'whatsapp': {
      const msg = str(p.message, 1000)
      return `https://wa.me/${digits(p.phone)}${msg ? `?text=${encodeURIComponent(msg)}` : ''}`
    }
    case 'email': {
      const q = new URLSearchParams()
      if (p.subject) q.set('subject', str(p.subject, 200))
      if (p.body) q.set('body', str(p.body, 1000))
      const qs = q.toString().replace(/\+/g, '%20')
      return `mailto:${str(p.to, 200)}${qs ? `?${qs}` : ''}`
    }
    case 'sms': return `sms:${digits(p.phone) ? '+' + digits(p.phone) : ''}${p.message ? `?body=${encodeURIComponent(str(p.message, 500))}` : ''}`
    case 'tel': return `tel:+${digits(p.phone)}`
    default: return null
  }
}

/** O que vai codificado na imagem. Wi-Fi é estático; o resto passa pelo /q/. */
export function qrEncodedData(qr: { kind: string; slug: string; payload: any }, base: string): string {
  if (qr.kind === 'wifi') return wifiString(qr.payload || {})
  return `${base}/q/${qr.slug}`
}

function validate(kind: Kind, body: any): string | null {
  const p = body.payload || {}
  if (kind === 'url') {
    try {
      const u = new URL(str(body.destinationUrl, 2048))
      if (!['http:', 'https:'].includes(u.protocol)) return 'O destino precisa começar com http:// ou https://'
    } catch { return 'Informe uma URL de destino válida (https://...)' }
  }
  if ((kind === 'whatsapp' || kind === 'sms' || kind === 'tel') && digits(p.phone).length < 10) return 'Informe o telefone com DDD (e DDI, ex.: 55)'
  if (kind === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(str(p.to))) return 'Informe um e-mail válido'
  if (kind === 'text' && !str(p.text, 2000)) return 'Informe o texto'
  if (kind === 'vcard' && !str(p.firstName) && !str(p.company)) return 'Informe ao menos o nome ou a empresa'
  if (kind === 'wifi' && !str(p.ssid)) return 'Informe o nome da rede (SSID)'
  return null
}

function cleanPayload(kind: Kind, raw: any): any {
  const p = raw && typeof raw === 'object' ? raw : {}
  const pick = (keys: string[], max = 500) => Object.fromEntries(keys.map(k => [k, str(p[k], max)]).filter(([, v]) => v))
  switch (kind) {
    case 'whatsapp': return { phone: digits(p.phone), ...pick(['message'], 1000) }
    case 'email': return pick(['to', 'subject', 'body'], 1000)
    case 'sms': return { phone: digits(p.phone), ...pick(['message']) }
    case 'tel': return { phone: digits(p.phone) }
    case 'text': return pick(['text'], 2000)
    case 'vcard': return pick(['firstName', 'lastName', 'company', 'title', 'phone', 'email', 'website', 'address', 'note'])
    case 'wifi': return { ...pick(['ssid', 'password'], 64), auth: ['WPA', 'WEP', 'nopass'].includes(p.auth) ? p.auth : 'WPA', hidden: !!p.hidden }
    default: return null
  }
}

// Datas e horas dos gráficos no horário de Brasília (o banco grava em UTC).
function sanitizeRaw(rows: any[]): any[] {
  return rows.map(row => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v])))
}

// ── Registro do acesso ────────────────────────────────────────

async function recordAccess(req: FastifyRequest, qr: { id: number }, via: 'qr' | 'link') {
  const ua = String(req.headers['user-agent'] || '')
  // HEAD e prévia de link (WhatsApp, Telegram, Facebook...) não são pessoas.
  if (req.method !== 'GET' || isBotUA(ua) || /whatsapp\//i.test(ua)) return
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip
  const visitorHash = crypto.createHash('sha256').update(`${ip}|${ua}`).digest('hex')
  const { deviceType, browser, os } = parseUA(ua)
  const q = (req.query || {}) as Record<string, any>
  const g = (k: string, max: number) => (q[k] ? String(q[k]).slice(0, max) : null)
  const lang = String(req.headers['accept-language'] || '').split(',')[0]?.trim().slice(0, 20) || null
  const country = String(req.headers['cf-ipcountry'] || '').slice(0, 8) || null
  const city = req.headers['cf-ipcity'] ? decodeURIComponent(String(req.headers['cf-ipcity'])).slice(0, 100) : null

  try {
    await prisma.$transaction(async (tx) => {
      const seen = await tx.qrCodeAccess.count({ where: { qrId: qr.id, visitorHash, via } })
      const isUnique = seen === 0
      await tx.qrCodeAccess.create({
        data: {
          qrId: qr.id, via, visitorHash, isUnique, ip, userAgent: ua.slice(0, 1000),
          referer: String(req.headers['referer'] || '').slice(0, 1000) || null,
          deviceType, browser, os, language: lang, country, city,
          utmSource: g('utm_source', 100), utmMedium: g('utm_medium', 100), utmCampaign: g('utm_campaign', 191),
          utmContent: g('utm_content', 191), utmTerm: g('utm_term', 191),
          queryParams: Object.keys(q).length ? q : undefined,
        },
      })
      const inc = via === 'qr'
        ? { totalScans: { increment: 1 }, ...(isUnique ? { uniqueScans: { increment: 1 } } : {}) }
        : { totalClicks: { increment: 1 }, ...(isUnique ? { uniqueClicks: { increment: 1 } } : {}) }
      await tx.qrCode.update({ where: { id: qr.id }, data: { ...inc, lastAccessAt: new Date() } })
    })
  } catch (err) {
    console.error('[qr] falha ao registrar acesso:', err)
  }
}

function infoPage(title: string, body: string): string {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title>
<style>body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f5f7;color:#1f2328;min-height:100vh;display:flex;align-items:center;justify-content:center}
.card{background:#fff;border-radius:16px;padding:32px 28px;max-width:480px;margin:16px;box-shadow:0 4px 24px rgba(0,0,0,.06)}h1{font-size:20px;margin:0 0 12px}p{font-size:15px;line-height:1.6;margin:0;white-space:pre-wrap;word-break:break-word}</style>
</head><body><div class="card">${body}</div></body></html>`
}

async function serveAccess(req: FastifyRequest, reply: FastifyReply, via: 'qr' | 'link') {
  const { slug } = req.params as { slug: string }
  const qr = await prisma.qrCode.findUnique({ where: { slug: String(slug).toLowerCase() } })
  reply.header('Cache-Control', 'no-store')
  if (!qr || !qr.active) {
    return reply.code(404).type('text/html').send(infoPage('QR Code indisponível', '<h1>Este QR Code não está mais ativo</h1><p>O conteúdo foi desativado por quem o criou.</p>'))
  }
  if (qr.expiresAt && qr.expiresAt.getTime() < Date.now()) {
    if (qr.expiredUrl) return reply.redirect(qr.expiredUrl, 302)
    return reply.code(410).type('text/html').send(infoPage('QR Code expirado', '<h1>Este QR Code expirou</h1><p>A campanha ou o conteúdo deste código já foi encerrado.</p>'))
  }

  recordAccess(req, qr, via).catch(() => {})

  const p: any = qr.payload || {}
  if (qr.kind === 'vcard') {
    const fname = slugify([p.firstName, p.lastName].filter(Boolean).join(' ') || p.company || 'contato') || 'contato'
    return reply.type('text/vcard; charset=utf-8').header('Content-Disposition', `inline; filename="${fname}.vcf"`).send(vcardString(p))
  }
  if (qr.kind === 'text') {
    return reply.type('text/html').send(infoPage(qr.name, `<h1>${esc(qr.name)}</h1><p>${esc(str(p.text, 2000))}</p>`))
  }
  if (qr.kind === 'wifi') {
    // Wi-Fi vai direto no QR; se alguém abrir o link curto, mostra os dados.
    return reply.type('text/html').send(infoPage(qr.name, `<h1>Rede Wi-Fi</h1><p>Rede: <b>${esc(str(p.ssid))}</b>${p.password ? `\nSenha: <b>${esc(str(p.password))}</b>` : ''}</p>`))
  }
  const dest = destinationFor(qr, via)
  if (!dest) return reply.code(404).type('text/html').send(infoPage('QR Code sem destino', '<h1>QR Code sem destino configurado</h1>'))
  return reply.redirect(dest, 302)
}

export async function qrCodesRoutes(app: FastifyInstance) {

  // ═══════ PÚBLICO ═══════
  app.get('/q/:slug', (req, reply) => serveAccess(req, reply, 'qr'))
  app.get('/c/:slug', (req, reply) => serveAccess(req, reply, 'link'))

  // ═══════ ADMIN ═══════
  // Tudo sob /api/admin/tools/ — entra no liga/desliga do módulo Ferramentas.

  // Preview/geração avulsa: SVG a partir de conteúdo livre ou de um QR salvo.
  app.post('/api/admin/tools/qrcodes/render', { preHandler: authMiddleware }, async (req, reply) => {
    const body = (req.body as any) || {}
    let data = str(body.data, 2048)
    if (!data && body.kind) {
      const kind = (KINDS as readonly string[]).includes(body.kind) ? body.kind as Kind : 'url'
      const slug = slugify(str(body.slug, 64)) || 'previa'
      data = qrEncodedData({ kind, slug, payload: cleanPayload(kind, body.payload) }, baseUrl(req))
    }
    if (!data) return reply.code(400).send({ error: 'Nada para codificar' })
    try {
      const size = Math.min(4096, Math.max(64, Number(body.size) || 512))
      return reply.type('image/svg+xml; charset=utf-8').header('Cache-Control', 'no-store').send(renderQrSvg(data, body.style, size))
    } catch (e: any) {
      return reply.code(400).send({ error: `Não foi possível gerar o QR: ${e?.message || 'conteúdo grande demais'}` })
    }
  })

  // Lista
  app.get('/api/admin/tools/qrcodes', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const where: any = {}
    if (q.status === 'active') where.active = true
    if (q.status === 'inactive') where.active = false
    if (q.folder) where.folder = String(q.folder)
    if (q.search) where.OR = [{ name: { contains: String(q.search) } }, { slug: { contains: String(q.search) } }, { utmCampaign: { contains: String(q.search) } }]
    const [qrcodes, folders] = await Promise.all([
      prisma.qrCode.findMany({ where, orderBy: { createdAt: 'desc' }, take: 500 }),
      prisma.qrCode.findMany({ where: { folder: { not: null } }, distinct: ['folder'], select: { folder: true } }),
    ])
    const base = baseUrl(req)
    return {
      qrcodes: qrcodes.map(x => ({ ...x, qrUrl: `${base}/q/${x.slug}`, shortUrl: `${base}/c/${x.slug}`, encodedData: qrEncodedData(x, base) })),
      folders: folders.map(f => f.folder).filter(Boolean).sort(),
    }
  })

  // Visão geral de todos os QR no período
  app.get('/api/admin/tools/qrcodes/overview', { preHandler: authMiddleware }, async (req) => {
    const days = Math.min(365, Math.max(1, parseInt((req.query as any).days) || 30))
    const since = new Date(Date.now() - days * 86400_000)
    const [total, active, byVia, byDay, top] = await Promise.all([
      prisma.qrCode.count(),
      prisma.qrCode.count({ where: { active: true } }),
      prisma.$queryRaw`SELECT via, COUNT(*) AS total, SUM(isUnique) AS uniques FROM bychat_qr_code_accesses WHERE createdAt >= ${since} GROUP BY via`,
      prisma.$queryRaw`SELECT DATE(CONVERT_TZ(createdAt, '+00:00', '-03:00')) AS date, via, COUNT(*) AS total FROM bychat_qr_code_accesses WHERE createdAt >= ${since} GROUP BY DATE(CONVERT_TZ(createdAt, '+00:00', '-03:00')), via ORDER BY date ASC`,
      prisma.$queryRaw`SELECT a.qrId, q.name, q.slug, COUNT(*) AS total FROM bychat_qr_code_accesses a JOIN bychat_qr_codes q ON q.id = a.qrId WHERE a.createdAt >= ${since} GROUP BY a.qrId, q.name, q.slug ORDER BY total DESC LIMIT 5`,
    ])
    const v = sanitizeRaw(byVia as any[])
    const get = (via: string, k: 'total' | 'uniques') => Number(v.find(r => r.via === via)?.[k] || 0)
    return {
      days, totalQrCodes: total, activeQrCodes: active,
      scans: get('qr', 'total'), uniqueScans: get('qr', 'uniques'),
      clicks: get('link', 'total'), uniqueClicks: get('link', 'uniques'),
      byDay: sanitizeRaw(byDay as any[]), top: sanitizeRaw(top as any[]),
    }
  })

  // Detalhe
  app.get('/api/admin/tools/qrcodes/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const qr = await prisma.qrCode.findUnique({ where: { id: parseInt((req.params as any).id) } })
    if (!qr) return reply.code(404).send({ error: 'QR Code não encontrado' })
    const base = baseUrl(req)
    return { qrcode: { ...qr, qrUrl: `${base}/q/${qr.slug}`, shortUrl: `${base}/c/${qr.slug}`, encodedData: qrEncodedData(qr, base) } }
  })

  // Estatísticas de um QR no período
  app.get('/api/admin/tools/qrcodes/:id/stats', { preHandler: authMiddleware }, async (req, reply) => {
    const id = parseInt((req.params as any).id)
    const days = Math.min(365, Math.max(1, parseInt((req.query as any).days) || 30))
    const since = new Date(Date.now() - days * 86400_000)
    const qr = await prisma.qrCode.findUnique({ where: { id }, select: { id: true } })
    if (!qr) return reply.code(404).send({ error: 'QR Code não encontrado' })

    const by = (col: string) => prisma.$queryRawUnsafe(
      `SELECT COALESCE(${col}, 'desconhecido') AS label, COUNT(*) AS total FROM bychat_qr_code_accesses WHERE qrId = ? AND createdAt >= ? GROUP BY label ORDER BY total DESC LIMIT 10`,
      id, since,
    )
    const [byVia, byDay, byHour, byWeekday, device, os, browser, country, language, referer] = await Promise.all([
      prisma.$queryRaw`SELECT via, COUNT(*) AS total, SUM(isUnique) AS uniques FROM bychat_qr_code_accesses WHERE qrId = ${id} AND createdAt >= ${since} GROUP BY via`,
      prisma.$queryRaw`SELECT DATE(CONVERT_TZ(createdAt, '+00:00', '-03:00')) AS date, via, COUNT(*) AS total FROM bychat_qr_code_accesses WHERE qrId = ${id} AND createdAt >= ${since} GROUP BY DATE(CONVERT_TZ(createdAt, '+00:00', '-03:00')), via ORDER BY date ASC`,
      prisma.$queryRaw`SELECT HOUR(CONVERT_TZ(createdAt, '+00:00', '-03:00')) AS hour, COUNT(*) AS total FROM bychat_qr_code_accesses WHERE qrId = ${id} AND createdAt >= ${since} GROUP BY HOUR(CONVERT_TZ(createdAt, '+00:00', '-03:00'))`,
      prisma.$queryRaw`SELECT DAYOFWEEK(CONVERT_TZ(createdAt, '+00:00', '-03:00')) AS dow, COUNT(*) AS total FROM bychat_qr_code_accesses WHERE qrId = ${id} AND createdAt >= ${since} GROUP BY DAYOFWEEK(CONVERT_TZ(createdAt, '+00:00', '-03:00'))`,
      by('deviceType'), by('os'), by('browser'), by('country'), by('language'),
      prisma.$queryRawUnsafe(
        `SELECT SUBSTRING_INDEX(SUBSTRING_INDEX(referer, '/', 3), '//', -1) AS label, COUNT(*) AS total FROM bychat_qr_code_accesses WHERE qrId = ? AND createdAt >= ? AND referer IS NOT NULL AND referer <> '' GROUP BY label ORDER BY total DESC LIMIT 10`,
        id, since,
      ),
    ])
    const v = sanitizeRaw(byVia as any[])
    const get = (via: string, k: 'total' | 'uniques') => Number(v.find(r => r.via === via)?.[k] || 0)
    return {
      days,
      scans: get('qr', 'total'), uniqueScans: get('qr', 'uniques'),
      clicks: get('link', 'total'), uniqueClicks: get('link', 'uniques'),
      byDay: sanitizeRaw(byDay as any[]), byHour: sanitizeRaw(byHour as any[]), byWeekday: sanitizeRaw(byWeekday as any[]),
      device: sanitizeRaw(device as any[]), os: sanitizeRaw(os as any[]), browser: sanitizeRaw(browser as any[]),
      country: sanitizeRaw(country as any[]), language: sanitizeRaw(language as any[]), referer: sanitizeRaw(referer as any[]),
    }
  })

  // Acessos (log)
  app.get('/api/admin/tools/qrcodes/:id/accesses', { preHandler: authMiddleware }, async (req) => {
    const id = parseInt((req.params as any).id)
    const q = req.query as any
    const page = Math.max(1, parseInt(q.page) || 1)
    const limit = Math.min(200, parseInt(q.limit) || 50)
    const where: any = { qrId: id }
    if (q.via === 'qr' || q.via === 'link') where.via = q.via
    const [accesses, total] = await Promise.all([
      prisma.qrCodeAccess.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit,
        select: { id: true, via: true, isUnique: true, deviceType: true, browser: true, os: true, language: true, country: true, city: true, referer: true, utmSource: true, utmCampaign: true, createdAt: true },
      }),
      prisma.qrCodeAccess.count({ where }),
    ])
    return { accesses, total, page, limit }
  })

  // Exportação CSV
  app.get('/api/admin/tools/qrcodes/:id/accesses.csv', { preHandler: authMiddleware }, async (req, reply) => {
    const qr = await prisma.qrCode.findUnique({ where: { id: parseInt((req.params as any).id) } })
    if (!qr) return reply.code(404).send({ error: 'QR Code não encontrado' })
    const rows = await prisma.qrCodeAccess.findMany({ where: { qrId: qr.id }, orderBy: { createdAt: 'desc' }, take: 50_000 })
    const cols = ['createdAt', 'via', 'isUnique', 'deviceType', 'os', 'browser', 'language', 'country', 'city', 'referer', 'utmSource', 'utmMedium', 'utmCampaign', 'utmContent', 'utmTerm', 'ip', 'userAgent'] as const
    const cell = (v: any) => {
      if (v == null) return ''
      const s = (v instanceof Date ? v.toISOString() : String(v)).replace(/"/g, '""').replace(/\r?\n/g, ' ')
      return /[",;]/.test(s) ? `"${s}"` : s
    }
    const csv = '﻿' + [cols.join(','), ...rows.map(r => cols.map(c => cell((r as any)[c])).join(','))].join('\n')
    return reply.type('text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="qr-${qr.slug}-acessos.csv"`).send(csv)
  })

  // Criar
  app.post('/api/admin/tools/qrcodes', { preHandler: adminOnly }, async (req, reply) => {
    const body = (req.body as any) || {}
    const kind = (KINDS as readonly string[]).includes(body.kind) ? body.kind as Kind : 'url'
    const name = str(body.name, 191)
    if (!name) return reply.code(400).send({ error: 'Dê um nome ao QR Code' })
    const err = validate(kind, body)
    if (err) return reply.code(400).send({ error: err })

    let slug = slugify(str(body.slug, 64))
    if (slug) {
      if (await prisma.qrCode.findUnique({ where: { slug } })) return reply.code(409).send({ error: 'Esse endereço curto já está em uso. Escolha outro.' })
    } else {
      do { slug = randomSlug() } while (await prisma.qrCode.findUnique({ where: { slug } }))
    }

    const qr = await prisma.qrCode.create({ data: { ...commonData(kind, body), name, slug, kind, createdBy: (req as any).user?.id ?? null } })
    return { ok: true, qrcode: qr }
  })

  // Editar — o slug não muda: ele já pode estar impresso.
  app.put('/api/admin/tools/qrcodes/:id', { preHandler: adminOnly }, async (req, reply) => {
    const id = parseInt((req.params as any).id)
    const cur = await prisma.qrCode.findUnique({ where: { id } })
    if (!cur) return reply.code(404).send({ error: 'QR Code não encontrado' })
    const body = (req.body as any) || {}
    if (body.active !== undefined && Object.keys(body).length === 1) {
      const qr = await prisma.qrCode.update({ where: { id }, data: { active: !!body.active } })
      return { ok: true, qrcode: qr }
    }
    const kind = (KINDS as readonly string[]).includes(body.kind) ? body.kind as Kind : cur.kind as Kind
    // Wi-Fi não passa pelo servidor: trocar de/para Wi-Fi muda o desenho do QR.
    if ((kind === 'wifi') !== (cur.kind === 'wifi')) return reply.code(400).send({ error: 'Não é possível trocar de/para Wi-Fi depois de criado — o QR impresso mudaria. Crie um novo.' })
    const name = str(body.name ?? cur.name, 191)
    if (!name) return reply.code(400).send({ error: 'Dê um nome ao QR Code' })
    const err = validate(kind, body)
    if (err) return reply.code(400).send({ error: err })
    const qr = await prisma.qrCode.update({ where: { id }, data: { ...commonData(kind, body), name, kind } })
    return { ok: true, qrcode: qr }
  })

  // Excluir (apaga também o histórico de acessos)
  app.delete('/api/admin/tools/qrcodes/:id', { preHandler: adminOnly }, async (req) => {
    await prisma.qrCode.delete({ where: { id: parseInt((req.params as any).id) } }).catch(() => null)
    return { ok: true }
  })
}

function commonData(kind: Kind, body: any) {
  const opt = (v: unknown, max: number) => str(v, max) || null
  let expiresAt: Date | null = null
  if (body.expiresAt) { const d = new Date(body.expiresAt); if (!isNaN(d.getTime())) expiresAt = d }
  let expiredUrl: string | null = null
  if (body.expiredUrl) { try { const u = new URL(str(body.expiredUrl, 2048)); if (['http:', 'https:'].includes(u.protocol)) expiredUrl = u.toString() } catch { /* ignora */ } }
  return {
    description: opt(body.description, 2000),
    destinationUrl: kind === 'url' ? str(body.destinationUrl, 2048) : null,
    payload: cleanPayload(kind, body.payload) ?? undefined,
    style: sanitizeQrStyle(body.style) as any,
    utmSource: opt(body.utmSource, 100), utmMedium: opt(body.utmMedium, 100), utmCampaign: opt(body.utmCampaign, 191),
    utmContent: opt(body.utmContent, 191), utmTerm: opt(body.utmTerm, 191),
    folder: opt(body.folder, 100),
    active: body.active !== false,
    expiresAt, expiredUrl,
  }
}
