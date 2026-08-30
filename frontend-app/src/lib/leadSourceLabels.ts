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

/**
 * Cor da origem do lead.
 *
 * A cor é a da PLATAFORMA, não do nosso tema: verde do WhatsApp, o rosa do
 * Instagram, o azul do Telegram. Isso é deliberado — numa lista, o operador
 * identifica de onde veio o contato pela cor que ele já conhece de fora do
 * painel, sem ler o rótulo. É o oposto da regra dos tokens, e vale porque a
 * cor aqui não é decisão nossa: é a marca de outra empresa.
 *
 * Não confunda com `lib/channelColors.ts`, que colore QUAL DOS NOSSOS NÚMEROS
 * de WhatsApp atendeu — outra pergunta, outro mapa.
 *
 * Origem sem cor conhecida cai no cinza do tema, que é a resposta honesta para
 * "não sei de onde veio".
 */
const LEAD_SOURCE_COLORS: Record<string, string> = {
  whatsapp: '#25D366',
  instagram: '#E1306C',
  telegram: '#229ED9',
  meta_lead_ads: '#0866FF',
  web_chat: 'var(--color-info)',
  portal_chat: 'var(--color-info)',
  web_form: 'var(--color-violet)',
  form: 'var(--color-violet)',
  landing_page: 'var(--color-violet)',
  scheduling: 'var(--color-orange)',
  enrollment_portal: 'var(--color-orange)',
  enrollment_portal_interest: 'var(--color-orange)',
  chatbot: 'var(--color-accent)',
  api: 'var(--color-fg-muted)',
  manual: 'var(--color-fg-muted)',
  direto: 'var(--color-fg-muted)',
  db_connector: 'var(--color-fg-muted)',
  kommo_import: '#3E7BFA',
}

export function leadSourceColor(value: string | null | undefined): string {
  if (!value) return 'var(--color-fg-muted)'
  const m = DB_CONNECTOR_RE.exec(value)
  if (m) return 'var(--color-fg-muted)'
  return LEAD_SOURCE_COLORS[value] ?? 'var(--color-fg-muted)'
}

export function leadSourceLabel(value: string | null | undefined): string {
  if (!value) return 'Direto'
  const m = DB_CONNECTOR_RE.exec(value)
  if (m) return dbConnectorNames[Number(m[1])] ?? 'Banco de Dados'
  return LEAD_SOURCE_LABELS[value] ?? value
}
