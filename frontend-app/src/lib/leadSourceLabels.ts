/**
 * Rótulos amigáveis (pt-BR) para o campo `source` do Lead.
 *
 * O campo é um `String` aberto no schema, então valores não mapeados são
 * devolvidos como vieram (preserva customizações futuras sem quebrar a UI).
 *
 * Use sempre `leadSourceLabel(value)` em vez de redefinir mapas locais — a
 * lista vive aqui para que Dashboard, Leads, Kanban, Conversas e exports
 * mostrem a mesma legenda para o mesmo valor bruto.
 */

export const LEAD_SOURCE_LABELS: Record<string, string> = {
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
  direto: 'Direto',
  db_connector: 'Banco de Dados',
  kommo_import: 'Kommo',
}

// Registro id→nome dos Conectores de Banco de Dados. O `source` de um lead
// importado por conector é `db_connector:<id>` (id variável), então o nome
// amigável ("canal") só pode ser resolvido com este mapa. É populado uma vez
// pelo AppShell via useDbConnectorNames(); fica vazio até lá (fallback abaixo).
let dbConnectorNames: Record<number, string> = {}
export function setDbConnectorNames(map: Record<number, string>): void {
  dbConnectorNames = map
}

const DB_CONNECTOR_RE = /^db_connector:(\d+)$/

export function leadSourceLabel(value: string | null | undefined): string {
  if (!value) return 'Direto'
  const m = DB_CONNECTOR_RE.exec(value)
  if (m) return dbConnectorNames[Number(m[1])] ?? 'Banco de Dados'
  return LEAD_SOURCE_LABELS[value] ?? value
}
