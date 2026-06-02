import type { DbAdapter, DbType } from './types.js'
import { mysqlAdapter } from './mysqlAdapter.js'
import { postgresAdapter } from './postgresAdapter.js'

export function getAdapter(dbType: DbType): DbAdapter {
  switch (dbType) {
    case 'mysql':    return mysqlAdapter
    case 'postgres': return postgresAdapter
    default: throw new Error(`Tipo de banco não suportado: ${dbType}`)
  }
}

export * from './types.js'
export { encryptPassword, decryptPassword } from './crypto.js'
export { assertSelectOnly, substituteCursor } from './sqlGuard.js'
