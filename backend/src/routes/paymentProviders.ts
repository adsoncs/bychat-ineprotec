// src/routes/paymentProviders.ts
// Gateway de pagamento como integração separada — CRUD de conexões reutilizáveis por N portais.

import { FastifyInstance } from 'fastify'
import crypto from 'crypto'
import { prisma } from '../lib/prisma.js'
import { adminOnly, type JwtPayload } from '../lib/auth.js'
import { encryptToken, decryptToken } from '../services/cloudApi.js'
import { pingPagarme, detectPagarmeEnvironment } from '../services/paymentPagarme.js'

const SUPPORTED_PROVIDERS = ['asaas', 'pagarme'] as const
type ProviderKind = typeof SUPPORTED_PROVIDERS[number]

function isSupported(p: any): p is ProviderKind {
  return typeof p === 'string' && (SUPPORTED_PROVIDERS as readonly string[]).includes(p)
}

function mask(apiKey: string): string {
  if (!apiKey) return ''
  const plain = safeDecrypt(apiKey)
  if (!plain) return '•••'
  if (plain.length <= 8) return '•'.repeat(plain.length)
  return `${plain.slice(0, 6)}…${plain.slice(-4)}`
}

function safeDecrypt(cipher: string): string {
  try { return decryptToken(cipher) } catch { return '' }
}

function summarize(c: any) {
  return {
    id: c.id,
    name: c.name,
    provider: c.provider,
    environment: c.environment,
    defaultBillingType: c.defaultBillingType,
    apiKeyMasked: mask(c.apiKey),
    publicKeyMasked: c.publicKey ? mask(c.publicKey) : null,
    hasPublicKey: !!c.publicKey,
    webhookToken: c.webhookToken,
    webhookSecret: c.webhookSecret ? '•••' : null,
    companyDocument: c.companyDocument,
    pixKey: c.pixKey,
    accountHolder: c.accountHolder,
    active: c.active,
    lastTestedAt: c.lastTestedAt,
    lastTestStatus: c.lastTestStatus,
    lastTestMessage: c.lastTestMessage,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    _count: c._count,
  }
}

// Testa a conexão com o provedor. Para Asaas: GET /myAccount.
async function testProviderConnection(provider: ProviderKind, apiKeyPlain: string, environment: string)
  : Promise<{ ok: boolean; message: string }> {
  if (provider === 'asaas') {
    const base = environment === 'production' ? 'https://api.asaas.com/v3' : 'https://api-sandbox.asaas.com/v3'
    try {
      const r = await fetch(`${base}/myAccount`, {
        headers: { 'access_token': apiKeyPlain, 'Content-Type': 'application/json' },
      })
      if (!r.ok) {
        const body = await r.text().catch(() => '')
        return { ok: false, message: `HTTP ${r.status}: ${body.substring(0, 200) || r.statusText}` }
      }
      const d = await r.json().catch(() => ({})) as any
      const name = d?.name || d?.companyName || 'conta válida'
      return { ok: true, message: `Conectado: ${name}` }
    } catch (e: any) {
      return { ok: false, message: `Falha de rede: ${e.message}` }
    }
  }
  if (provider === 'pagarme') {
    return pingPagarme(apiKeyPlain)
  }
  return { ok: false, message: `Provedor "${provider}" ainda não suportado` }
}

export async function paymentProvidersRoutes(app: FastifyInstance) {

  // GET /api/admin/payment-providers — listar conexões
  app.get('/api/admin/payment-providers', { preHandler: adminOnly }, async () => {
    const rows = await prisma.paymentProviderConnection.findMany({
      orderBy: [{ active: 'desc' }, { createdAt: 'desc' }],
      include: { _count: { select: { portals: true } } },
    })
    return { connections: rows.map(summarize) }
  })

  // GET /api/admin/payment-providers/:id
  app.get('/api/admin/payment-providers/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const c = await prisma.paymentProviderConnection.findUnique({
      where: { id: parseInt(id) },
      include: { _count: { select: { portals: true } } },
    })
    if (!c) return reply.code(404).send({ error: 'Conexão não encontrada' })
    return { connection: summarize(c) }
  })

  // POST /api/admin/payment-providers — criar
  app.post('/api/admin/payment-providers', { preHandler: adminOnly }, async (req, reply) => {
    const body = (req.body as any) || {}
    const user = (req as any).user as JwtPayload

    if (!body.name || !body.provider || !body.apiKey) {
      return reply.code(400).send({ error: 'Nome, provedor e API key são obrigatórios' })
    }
    if (!isSupported(body.provider)) {
      return reply.code(400).send({ error: `Provedor não suportado: ${body.provider}` })
    }

    const apiKeyEnc = encryptToken(String(body.apiKey))
    const webhookToken = crypto.randomBytes(24).toString('hex')

    // Pagar.me: ambiente é derivado do prefixo da chave (sk_test_ vs sk_)
    const environment = body.provider === 'pagarme'
      ? detectPagarmeEnvironment(String(body.apiKey))
      : (body.environment === 'production' ? 'production' : 'sandbox')

    const publicKeyEnc = typeof body.publicKey === 'string' && body.publicKey.trim()
      ? encryptToken(body.publicKey.trim())
      : null

    const conn = await prisma.paymentProviderConnection.create({
      data: {
        name: String(body.name).trim().substring(0, 191),
        provider: body.provider,
        environment,
        apiKey: apiKeyEnc,
        publicKey: publicKeyEnc,
        defaultBillingType: body.defaultBillingType || null,
        webhookToken,
        webhookSecret: body.webhookSecret || null,
        companyDocument: body.companyDocument || null,
        pixKey: body.pixKey || null,
        accountHolder: body.accountHolder || null,
        active: body.active !== false,
        createdBy: user.userId,
      },
      include: { _count: { select: { portals: true } } },
    })
    return reply.code(201).send({ ok: true, connection: summarize(conn) })
  })

  // PUT /api/admin/payment-providers/:id — atualizar
  app.put('/api/admin/payment-providers/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const body = (req.body as any) || {}
    const data: any = {}

    if (body.name !== undefined) data.name = String(body.name).trim().substring(0, 191)
    if (body.provider !== undefined) {
      if (!isSupported(body.provider)) return reply.code(400).send({ error: 'Provedor não suportado' })
      data.provider = body.provider
    }
    if (body.environment !== undefined) data.environment = body.environment === 'production' ? 'production' : 'sandbox'
    // apiKey: só atualiza se vier explicitamente preenchida (não sobrescrever com máscara)
    if (typeof body.apiKey === 'string' && body.apiKey && !body.apiKey.includes('•') && !body.apiKey.includes('…')) {
      data.apiKey = encryptToken(body.apiKey)
      // Pagar.me: ao trocar a chave, recalcula o ambiente pelo prefixo
      const provider = data.provider
        || (await prisma.paymentProviderConnection.findUnique({ where: { id: parseInt(id) }, select: { provider: true } }))?.provider
      if (provider === 'pagarme') {
        data.environment = detectPagarmeEnvironment(body.apiKey)
      }
    }
    // publicKey: só atualiza se vier explicitamente preenchida (não sobrescrever com máscara)
    if (typeof body.publicKey === 'string' && body.publicKey && !body.publicKey.includes('•') && !body.publicKey.includes('…')) {
      data.publicKey = encryptToken(body.publicKey)
    } else if (body.publicKey === '' || body.publicKey === null) {
      data.publicKey = null
    }
    if (body.defaultBillingType !== undefined) data.defaultBillingType = body.defaultBillingType || null
    if (body.webhookSecret !== undefined) data.webhookSecret = body.webhookSecret || null
    if (body.companyDocument !== undefined) data.companyDocument = body.companyDocument || null
    if (body.pixKey !== undefined) data.pixKey = body.pixKey || null
    if (body.accountHolder !== undefined) data.accountHolder = body.accountHolder || null
    if (body.active !== undefined) data.active = !!body.active

    try {
      const conn = await prisma.paymentProviderConnection.update({
        where: { id: parseInt(id) },
        data,
        include: { _count: { select: { portals: true } } },
      })
      return { ok: true, connection: summarize(conn) }
    } catch (e: any) {
      return reply.code(404).send({ error: e.message })
    }
  })

  // POST /api/admin/payment-providers/:id/test — ping do provedor
  app.post('/api/admin/payment-providers/:id/test', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const c = await prisma.paymentProviderConnection.findUnique({ where: { id: parseInt(id) } })
    if (!c) return reply.code(404).send({ error: 'Conexão não encontrada' })

    const apiKeyPlain = safeDecrypt(c.apiKey)
    if (!apiKeyPlain) return reply.code(400).send({ error: 'API key inválida ou inacessível' })

    const result = await testProviderConnection(c.provider as ProviderKind, apiKeyPlain, c.environment)
    await prisma.paymentProviderConnection.update({
      where: { id: c.id },
      data: {
        lastTestedAt: new Date(),
        lastTestStatus: result.ok ? 'ok' : 'error',
        lastTestMessage: result.message,
      },
    })
    return { ok: result.ok, message: result.message }
  })

  // DELETE /api/admin/payment-providers/:id
  app.delete('/api/admin/payment-providers/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const usedBy = await prisma.enrollmentPortal.count({ where: { paymentConnectionId: parseInt(id) } })
    if (usedBy > 0) {
      return reply.code(400).send({ error: `Conexão em uso por ${usedBy} portal(is). Desvincule antes de excluir.` })
    }
    try {
      await prisma.paymentProviderConnection.delete({ where: { id: parseInt(id) } })
      return { ok: true }
    } catch (e: any) {
      return reply.code(404).send({ error: e.message })
    }
  })
}

// Exportado para uso em outros módulos: retorna apiKey DESCRIPTOGRAFADA
export async function getConnectionApiKey(connectionId: number): Promise<string | null> {
  const c = await prisma.paymentProviderConnection.findUnique({
    where: { id: connectionId },
    select: { apiKey: true, active: true },
  })
  if (!c || !c.active) return null
  try { return decryptToken(c.apiKey) } catch { return null }
}

// publicKey é exposta para o frontend público (portal de inscrição/candidato) que
// vai usá-la no tokenizecard.js. Retornar texto claro — não é segredo, mas
// guardamos criptografada por simetria.
export async function getConnectionPublicKey(connectionId: number): Promise<string | null> {
  const c = await prisma.paymentProviderConnection.findUnique({
    where: { id: connectionId },
    select: { publicKey: true, active: true },
  })
  if (!c || !c.active || !c.publicKey) return null
  try { return decryptToken(c.publicKey) } catch { return null }
}
