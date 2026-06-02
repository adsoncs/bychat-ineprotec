// Validações de SQL pra conectores externos. Conectores só fazem SELECT —
// admin pode escrever query custom mas não pode mutar o banco origem.

export function assertSelectOnly(sql: string): void {
  const stripped = sql
    .replace(/--.*$/gm, '')              // remove single-line comments
    .replace(/\/\*[\s\S]*?\*\//g, '')   // remove block comments
    .trim()
  const first = stripped.match(/^(\w+)/)
  if (!first || !/^(SELECT|WITH)$/i.test(first[1]!)) {
    throw new Error(`Apenas SELECT/WITH são permitidos. Comando detectado: ${first?.[1] ?? '?'}`)
  }
  // Bloqueia statements adicionais via ; (defesa contra injection no template)
  // Permite ; só no final. mysql2/pg desabilitam multi-statement por default,
  // mas reforçamos aqui.
  const withoutTrailing = stripped.replace(/;\s*$/, '')
  if (/;/.test(withoutTrailing)) {
    throw new Error('Múltiplos comandos não são permitidos (use apenas um SELECT)')
  }
  // Palavras-chave proibidas (anywhere)
  const forbidden = /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|CREATE|ALTER|GRANT|REVOKE|EXEC|EXECUTE|CALL|LOAD_FILE|INTO\s+OUTFILE|INTO\s+DUMPFILE)\b/i
  if (forbidden.test(stripped)) {
    throw new Error('Query contém comando proibido (apenas leitura é permitida)')
  }
}

/**
 * Substitui o placeholder :cursor pelo valor real do cursor, já quoted
 * pelo dialeto. Se cursor for null, troca por NULL — caller pode usar
 * `WHERE col > COALESCE(:cursor, 0)` pra trazer tudo na primeira rodada.
 */
export function substituteCursor(sql: string, cursor: string | null, dialect: 'mysql' | 'postgres'): string {
  if (!sql.includes(':cursor')) return sql
  if (cursor === null) return sql.replace(/:cursor\b/g, 'NULL')

  // Detecta se é número puro — não precisa de aspas
  if (/^-?\d+(\.\d+)?$/.test(cursor)) {
    return sql.replace(/:cursor\b/g, cursor)
  }
  // String/timestamp: escapa aspas simples (defense in depth — admin define a query)
  const escaped = cursor.replace(/'/g, "''")
  return sql.replace(/:cursor\b/g, `'${escaped}'`)
}
