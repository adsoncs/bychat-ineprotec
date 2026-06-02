// Tipos compartilhados entre adapters e runner.

export type DbType = 'mysql' | 'postgres'
export type DeltaStrategy = 'id' | 'timestamp' | 'none'

export interface ConnectorConfig {
  dbType: DbType
  host: string
  port: number
  dbName: string
  dbUser: string
  password: string // já decryptada
  useTLS: boolean
  caCert?: string | null
}

export interface QueryResult {
  rows: Record<string, unknown>[]
  rowCount: number
}

export interface DbAdapter {
  testConnection(cfg: ConnectorConfig): Promise<{ ok: true } | { ok: false; error: string }>
  /**
   * Executa a query do conector com o cursor substituído. Hard-coded a
   * SELECT-only (rejeita qualquer outro comando).
   */
  executeQuery(cfg: ConnectorConfig, sql: string, cursor: string | null): Promise<QueryResult>
}

// Mapping: { sourceColumn: targetField }
// targetField pode ser:
//   - campo padrão do Lead: nome | email | whatsapp | empresa | cidade | segmento
//   - customField: 'cf:slug'
//   - meta: 'utm:source' | 'utm:medium' | 'utm:campaign' | 'meta:page_url' | 'meta:ip'
//   - 'meta:source_id' (id do registro externo, vai pra Lead.sourceId)
//   - 'meta:created_at' (timestamp do registro externo, vai pra Lead.createdAt)
//   - special concat: 'concat:nome' (várias colunas com este target viram nome juntas)
export type LeadFieldTarget =
  | 'nome' | 'email' | 'whatsapp' | 'empresa' | 'cidade' | 'segmento'
  | `cf:${string}`
  | `utm:${'source' | 'medium' | 'campaign' | 'content' | 'term'}`
  | 'meta:page_url' | 'meta:ip' | 'meta:source_id' | 'meta:created_at'
  | 'concat:nome'
  | 'ignore'

export type ConnectorMapping = Record<string, LeadFieldTarget>
