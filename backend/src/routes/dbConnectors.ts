// Conectores de Banco de Dados externo — CRUD + test connection + preview
// + run now + histórico de runs. Padrão das rotas admin.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'
import {
  encryptPassword, decryptPassword,
  getAdapter, assertSelectOnly,
  type ConnectorMapping, type DbType,
} from '../services/dbConnectors/index.js'
import { runConnector } from '../services/dbConnectors/runner.js'

const PUBLIC_FIELDS = {
  id: true, name: true, description: true,
  dbType: true, host: true, port: true, dbName: true, dbUser: true, useTLS: true,
  query: true, mapping: true,
  deltaStrategy: true, deltaColumn: true, lastSyncCursor: true,
  intervalMinutes: true, active: true,
  lastRunAt: true, lastRunStatus: true, lastError: true, totalImported: true,
  defaultTeamId: true, defaultFunnelId: true, defaultStageKey: true,
  createdAt: true, updatedAt: true,
} as const

export async function dbConnectorsRoutes(app: FastifyInstance) {

  // ── LIST ──────────────────────────────────────────────
  app.get('/api/admin/db-connectors', { preHandler: authMiddleware }, async () => {
    const items = await prisma.dbConnector.findMany({
      select: PUBLIC_FIELDS,
      orderBy: { id: 'asc' },
    })
    return { items }
  })

  // ── GET ONE ──────────────────────────────────────────
  app.get('/api/admin/db-connectors/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const id = parseInt((req.params as any).id, 10)
    const item = await prisma.dbConnector.findUnique({ where: { id }, select: PUBLIC_FIELDS })
    if (!item) return reply.code(404).send({ error: 'Conector não encontrado' })
    return { item }
  })

  // ── CREATE ───────────────────────────────────────────
  app.post('/api/admin/db-connectors', { preHandler: authMiddleware }, async (req, reply) => {
    const body = req.body as any
    const required = ['name', 'dbType', 'host', 'port', 'dbName', 'dbUser', 'password', 'query', 'mapping']
    for (const k of required) {
      if (body[k] === undefined || body[k] === null || body[k] === '') {
        return reply.code(400).send({ error: `Campo obrigatório: ${k}` })
      }
    }
    if (!['mysql', 'postgres'].includes(body.dbType)) {
      return reply.code(400).send({ error: 'dbType deve ser mysql ou postgres' })
    }
    try { assertSelectOnly(body.query) } catch (e: any) {
      return reply.code(400).send({ error: e.message })
    }

    const created = await prisma.dbConnector.create({
      data: {
        name: body.name,
        description: body.description || null,
        dbType: body.dbType,
        host: body.host,
        port: parseInt(body.port, 10),
        dbName: body.dbName,
        dbUser: body.dbUser,
        passwordEnc: encryptPassword(body.password),
        useTLS: !!body.useTLS,
        caCert: body.caCert || null,
        query: body.query,
        mapping: body.mapping as ConnectorMapping,
        deltaStrategy: body.deltaStrategy || 'id',
        deltaColumn: body.deltaColumn || null,
        lastSyncCursor: body.lastSyncCursor ?? null,
        intervalMinutes: parseInt(body.intervalMinutes ?? '5', 10),
        active: body.active !== false,
        defaultTeamId: body.defaultTeamId ?? null,
        defaultFunnelId: body.defaultFunnelId ?? null,
        defaultStageKey: body.defaultStageKey || 'NOVO',
      },
      select: PUBLIC_FIELDS,
    })
    return { item: created }
  })

  // ── UPDATE ───────────────────────────────────────────
  app.patch('/api/admin/db-connectors/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const id = parseInt((req.params as any).id, 10)
    const body = req.body as any
    const exists = await prisma.dbConnector.findUnique({ where: { id }, select: { id: true } })
    if (!exists) return reply.code(404).send({ error: 'Conector não encontrado' })

    if (body.query) {
      try { assertSelectOnly(body.query) } catch (e: any) {
        return reply.code(400).send({ error: e.message })
      }
    }

    const data: any = {}
    const editable = ['name','description','dbType','host','dbName','dbUser','useTLS','caCert','query','mapping','deltaStrategy','deltaColumn','intervalMinutes','active','defaultTeamId','defaultFunnelId','defaultStageKey','lastSyncCursor']
    for (const k of editable) if (body[k] !== undefined) data[k] = body[k]
    if (body.port !== undefined) data.port = parseInt(body.port, 10)
    if (body.intervalMinutes !== undefined) data.intervalMinutes = parseInt(body.intervalMinutes, 10)
    if (body.password) data.passwordEnc = encryptPassword(body.password)

    const updated = await prisma.dbConnector.update({ where: { id }, data, select: PUBLIC_FIELDS })
    return { item: updated }
  })

  // ── DELETE ───────────────────────────────────────────
  app.delete('/api/admin/db-connectors/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const id = parseInt((req.params as any).id, 10)
    try {
      await prisma.dbConnector.delete({ where: { id } })
      return { ok: true }
    } catch {
      return reply.code(404).send({ error: 'Conector não encontrado' })
    }
  })

  // ── TEST CONNECTION ──────────────────────────────────
  // Body: { dbType, host, port, dbName, dbUser, password|connectorId, useTLS, caCert }
  // Se vier connectorId, decripta a senha salva; senão usa password do body.
  app.post('/api/admin/db-connectors/test-connection', { preHandler: authMiddleware }, async (req, reply) => {
    const body = req.body as any
    let password = body.password
    if (!password && body.connectorId) {
      const c = await prisma.dbConnector.findUnique({ where: { id: parseInt(body.connectorId, 10) } })
      if (!c) return reply.code(404).send({ ok: false, error: 'Conector não encontrado' })
      password = decryptPassword(c.passwordEnc)
    }
    // SSRF: bloqueia testar conexão contra host interno/metadata.
    const { assertHostIsPublic } = await import('../lib/urlSafety.js')
    const hostCheck = await assertHostIsPublic(body.host)
    if (!hostCheck.ok) {
      return reply.code(400).send({ ok: false, error: `Host bloqueado por segurança: ${hostCheck.reason}` })
    }
    const adapter = getAdapter(body.dbType as DbType)
    const result = await adapter.testConnection({
      dbType: body.dbType, host: body.host, port: parseInt(body.port, 10),
      dbName: body.dbName, dbUser: body.dbUser, password,
      useTLS: !!body.useTLS, caCert: body.caCert || null,
    })
    return result
  })

  // ── PREVIEW QUERY ────────────────────────────────────
  // Executa a query do conector em modo dry-run (não cria leads), devolve até 5 rows.
  app.post('/api/admin/db-connectors/:id/preview', { preHandler: authMiddleware }, async (req, reply) => {
    const id = parseInt((req.params as any).id, 10)
    try {
      const r = await runConnector(id, { triggeredBy: 'test', dryRun: true, dryRunLimit: 5 })
      return { ok: true, rowsRead: r.rowsRead, preview: r.preview || [], cursorBefore: r.cursorBefore }
    } catch (err: any) {
      return reply.code(400).send({ ok: false, error: err.message })
    }
  })

  // ── RUN NOW ──────────────────────────────────────────
  app.post('/api/admin/db-connectors/:id/run-now', { preHandler: authMiddleware }, async (req, reply) => {
    const id = parseInt((req.params as any).id, 10)
    const user = (req as any).user
    try {
      const r = await runConnector(id, { triggeredBy: 'manual', triggeredByUserId: user?.userId ?? null })
      return { ok: true, ...r }
    } catch (err: any) {
      return reply.code(400).send({ ok: false, error: err.message })
    }
  })

  // ── RUNS HISTORY ─────────────────────────────────────
  app.get('/api/admin/db-connectors/:id/runs', { preHandler: authMiddleware }, async (req) => {
    const id = parseInt((req.params as any).id, 10)
    const limit = Math.min(parseInt(((req.query as any)?.limit) ?? '50', 10), 200)
    const runs = await prisma.dbConnectorRun.findMany({
      where: { connectorId: id },
      orderBy: { id: 'desc' },
      take: limit,
    })
    return { items: runs }
  })
}
