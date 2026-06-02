import pkg from 'pg'
import type { ConnectorConfig, DbAdapter, QueryResult } from './types.js'
import { assertSelectOnly, substituteCursor } from './sqlGuard.js'

const { Client } = pkg

export const postgresAdapter: DbAdapter = {
  async testConnection(cfg) {
    const client = new Client({
      host: cfg.host,
      port: cfg.port,
      user: cfg.dbUser,
      password: cfg.password,
      database: cfg.dbName,
      ssl: cfg.useTLS ? { rejectUnauthorized: !!cfg.caCert, ca: cfg.caCert ?? undefined } : undefined,
      connectionTimeoutMillis: 10_000,
      statement_timeout: 60_000,
    })
    try {
      await client.connect()
      await client.query('SELECT 1')
      return { ok: true as const }
    } catch (err: any) {
      return { ok: false as const, error: err?.message || 'Erro ao conectar' }
    } finally {
      await client.end().catch(() => {})
    }
  },

  async executeQuery(cfg, sql, cursor): Promise<QueryResult> {
    assertSelectOnly(sql)
    const finalSql = substituteCursor(sql, cursor, 'postgres')
    const client = new Client({
      host: cfg.host,
      port: cfg.port,
      user: cfg.dbUser,
      password: cfg.password,
      database: cfg.dbName,
      ssl: cfg.useTLS ? { rejectUnauthorized: !!cfg.caCert, ca: cfg.caCert ?? undefined } : undefined,
      connectionTimeoutMillis: 10_000,
      statement_timeout: 60_000,
    })
    try {
      await client.connect()
      const res = await client.query(finalSql)
      return { rows: res.rows as Record<string, unknown>[], rowCount: res.rowCount ?? res.rows.length }
    } finally {
      await client.end().catch(() => {})
    }
  },
}
