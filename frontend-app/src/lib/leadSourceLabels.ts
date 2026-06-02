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
  manual: 'Manual',
  api: 'API',
  chatbot: 'Chatbot',
  direto: 'Direto',
}

export function leadSourceLabel(value: string | null | undefined): string {
  if (!value) return 'Direto'
  return LEAD_SOURCE_LABELS[value] ?? value
}
