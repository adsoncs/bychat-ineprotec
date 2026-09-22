// Rótulos amigáveis para o campo `source` do Lead (backend).
// Espelha frontend-app/src/lib/leadSourceLabels.ts, e resolve os prefixos
// dinâmicos para o "canal" amigável que aparece em funis/relatórios:
//   `db_connector:<id>` → nome do conector (DbConnector.channelLabel || name)
//   `form:<id>`         → "Nome da origem" do formulário (Form.settings.sourceLabel)

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
  kommo_import: 'Kommo',
}

const DB_CONNECTOR_RE = /^db_connector:(\d+)$/
const FORM_RE = /^form:(\d+)$/

/** Form apagado ou que perdeu o nome da origem cai no rótulo genérico. */
const FORM_FALLBACK = 'Formulário'

async function formSourceLabels(ids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>()
  if (ids.length === 0) return out
  const forms = await prisma.form.findMany({ where: { id: { in: ids } }, select: { id: true, settings: true } })
  for (const f of forms) {
    const label = (f.settings as any)?.sourceLabel
    if (typeof label === 'string' && label.trim()) out.set(f.id, label.trim())
  }
  return out
}

/**
 * Devolve uma cópia do lead com `source` já traduzido quando ele é `form:<id>`.
 * Para quem entrega o valor para fora (prompt de IA, planilha): "form:3" não
 * diz nada a ninguém. Demais valores seguem crus, como sempre foram.
 */
export async function withSourceLabel<T extends { source?: string | null }>(lead: T): Promise<T> {
  const m = lead?.source ? FORM_RE.exec(lead.source) : null
  if (!m) return lead
  const names = await formSourceLabels([Number(m[1])]).catch(() => new Map<number, string>())
  return { ...lead, source: names.get(Number(m[1])) || FORM_FALLBACK }
}

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
  const formIds = [
    ...new Set(
      sources
        .map((s) => (s ? FORM_RE.exec(s)?.[1] : null))
        .filter((x): x is string => !!x)
        .map((x) => Number(x)),
    ),
  ]
  const formNames = await formSourceLabels(formIds)
  const names = new Map<number, string>()
  if (ids.length > 0) {
    const conns = await prisma.dbConnector.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, channelLabel: true },
    })
    for (const c of conns) names.set(c.id, c.channelLabel || c.name)
  }
  return (source: string | null | undefined): string => {
    if (!source) return 'Direto'
    const m = DB_CONNECTOR_RE.exec(source)
    if (m) return names.get(Number(m[1])) || 'Banco de Dados'
    const f = FORM_RE.exec(source)
    if (f) return formNames.get(Number(f[1])) || FORM_FALLBACK
    return STATIC_SOURCE_LABELS[source] ?? source
  }
}
