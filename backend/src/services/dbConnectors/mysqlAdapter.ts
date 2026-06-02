import mysql from 'mysql2/promise'
import type { ConnectorConfig, DbAdapter, QueryResult } from './types.js'
import { assertSelectOnly, substituteCursor } from './sqlGuard.js'

export const mysqlAdapter: DbAdapter = {
  async testConnection(cfg) {
    let conn: mysql.Connection | null = null
    try {
      conn = await mysql.createConnection({
        host: cfg.host,
        port: cfg.port,
        user: cfg.dbUser,
        password: cfg.password,
        database: cfg.dbName,
        ssl: cfg.useTLS ? { rejectUnauthorized: !!cfg.caCert, ca: cfg.caCert ?? undefined } : undefined,
        connectTimeout: 10_000,
      })
      await conn.query('SELECT 1')
      return { ok: true }
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Erro ao conectar' }
    } finally {
      if (conn) await conn.end().catch(() => {})
    }
  },

  async executeQuery(cfg, sql, cursor): Promise<QueryResult> {
    assertSelectOnly(sql)
    const finalSql = substituteCursor(sql, cursor, 'mysql')
    let conn: mysql.Connection | null = null
    try {
      conn = await mysql.createConnection({
        host: cfg.host,
        port: cfg.port,
        user: cfg.dbUser,
        password: cfg.password,
        database: cfg.dbName,
        ssl: cfg.useTLS ? { rejectUnauthorized: !!cfg.caCert, ca: cfg.caCert ?? undefined } : undefined,
        connectTimeout: 10_000,
        // mysql2 não tem statement_timeout — query timeout é via opção 'timeout' em query()
      })
      const [rows] = await conn.query<mysql.RowDataPacket[]>({ sql: finalSql, timeout: 60_000 })
      return { rows: rows as Record<string, unknown>[], rowCount: rows.length }
    } finally {
      if (conn) await conn.end().catch(() => {})
    }
  },
}
