// Rótulos amigáveis para o campo `source` do Lead (backend).
// Espelha frontend-app/src/lib/leadSourceLabels.ts, e resolve o prefixo
// dinâmico `db_connector:<id>` para o NOME do conector (DbConnector.name) —
// que é o "canal" amigável que aparece em funis/relatórios.

import { prisma } from './prisma.js'

const STATIC_SOURCE_LABELS: Record<string, string> = {
  direto: 'Direto',
  whatsapp: 'WhatsApp',
  instagram: 'Instagram Direct',
  telegram: 'Telegram',
  web_chat: 'Chat do Site',
  web_form: 'Formulário Web',
  form: 'Formulário',
  meta_lead_ads: 'Meta Ads',
  enrollment_portal: 'Portal de Matrícula',
  enrollment_portal_interest: 'Portal de Matrícula (Interesse)',
  portal_chat: 'Chat do Portal',
  landing_page: 'Landing Page',
  scheduling: 'Agendamento',
  manual: 'Manual',
  api: 'API',
  chatbot: 'Chatbot',
  db_connector: 'Banco de Dados',
}

const DB_CONNECTOR_RE = /^db_connector:(\d+)$/

/**
 * Constrói um resolvedor de rótulo a partir de uma lista de valores de `source`.
 * Faz UMA consulta aos DbConnector citados (db_connector:<id>) e devolve uma
 * função pura `(source) => label`. Use em agregadores de relatório.
 */
export async function buildSourceLabeler(
  sources: (string | null | undefined)[],
): Promise<(source: string | null | undefined) => string> {
  const ids = [
    ...new Set(
      sources
        .map((s) => (s ? DB_CONNECTOR_RE.exec(s)?.[1] : null))
        .filter((x): x is string => !!x)
        .map((x) => Number(x)),
    ),
  ]
  const names = new Map<number, string>()
  if (ids.length > 0) {
    const conns = await prisma.dbConnector.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    })
    for (const c of conns) names.set(c.id, c.name)
  }
  return (source: string | null | undefined): string => {
    if (!source) return 'Direto'
    const m = DB_CONNECTOR_RE.exec(source)
    if (m) return names.get(Number(m[1])) || 'Banco de Dados'
    return STATIC_SOURCE_LABELS[source] ?? source
  }
}
