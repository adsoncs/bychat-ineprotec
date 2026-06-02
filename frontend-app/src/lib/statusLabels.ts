/**
 * Mapas pt-BR para enums de status que vêm do backend ou de APIs externas.
 *
 * Use `<helper>(value)` para obter o rótulo amigável; quando o valor não
 * estiver mapeado, devolve o original (assim labels personalizados pelo
 * usuário não viram "—" ou string vazia).
 */

export const PAGE_STATUS_LABELS: Record<string, string> = {
  PUBLISHED: 'Publicada',
  DRAFT: 'Rascunho',
  ARCHIVED: 'Arquivada',
}

export const ENRICHMENT_STATUS_LABELS: Record<string, string> = {
  done: 'Concluído',
  partial: 'Parcial',
  running: 'Executando',
  pending: 'Pendente',
  pendente: 'Pendente',
  failed: 'Falhou',
}

export const CLOUD_API_TEMPLATE_STATUS_LABELS: Record<string, string> = {
  APPROVED: 'Aprovado',
  PENDING: 'Pendente',
  REJECTED: 'Rejeitado',
  PAUSED: 'Pausado',
  DISABLED: 'Desativado',
  IN_APPEAL: 'Em recurso',
  PENDING_DELETION: 'Exclusão pendente',
  DELETED: 'Excluído',
  FLAGGED: 'Sinalizado',
  LIMIT_EXCEEDED: 'Limite excedido',
}

// Motivos de reprovação/pausa da Meta → texto acionável em PT.
export const CLOUD_API_TEMPLATE_REASON_LABELS: Record<string, string> = {
  ABUSIVE_CONTENT: 'Conteúdo abusivo ou que viola as políticas',
  INVALID_FORMAT: 'Formato inválido (variáveis, parâmetros ou estrutura)',
  PROMOTIONAL: 'Conteúdo promocional fora da categoria declarada',
  TAG_CONTENT_MISMATCH: 'Categoria não corresponde ao conteúdo',
  SCAM: 'Suspeita de golpe/phishing',
  INCORRECT_CATEGORY: 'Categoria incorreta',
  NONE: '—',
}

export const CLOUD_API_TEMPLATE_CATEGORY_LABELS: Record<string, string> = {
  MARKETING: 'Marketing',
  UTILITY: 'Utilitário',
  AUTHENTICATION: 'Autenticação',
}

// Qualidade do número na Meta (semáforo) → texto PT.
export const CLOUD_API_QUALITY_LABELS: Record<string, string> = {
  GREEN: 'Alta',
  YELLOW: 'Média',
  RED: 'Baixa',
  UNKNOWN: 'Sem dados',
}

// Status de entrega de uma mensagem (relatório de disparos) → texto PT.
export const CLOUD_API_MESSAGE_STATUS_LABELS: Record<string, string> = {
  sent: 'Enviada',
  delivered: 'Entregue',
  read: 'Lida',
  failed: 'Falhou',
  pending: 'Pendente',
  accepted: 'Aceita',
}

export const META_FORM_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Ativo',
  active: 'Ativo',
  PAUSED: 'Pausado',
  paused: 'Pausado',
  ARCHIVED: 'Arquivado',
  archived: 'Arquivado',
}

export const META_LOG_STATUS_LABELS: Record<string, string> = {
  received: 'Recebido',
  processed: 'Processado',
  failed: 'Falhou',
  retried: 'Reprocessado',
  ignored: 'Ignorado',
}

export const ACTIVITY_STATUS_LABELS: Record<string, string> = {
  pending: 'Pendente',
  overdue: 'Atrasada',
  completed: 'Concluída',
  cancelled: 'Cancelada',
  canceled: 'Cancelada',
}

export const QUEUE_JOB_STATUS_LABELS: Record<string, string> = {
  waiting: 'Em espera',
  active: 'Ativo',
  delayed: 'Atrasado',
  completed: 'Concluído',
  failed: 'Falhou',
  paused: 'Pausado',
}

function makeLabeler(map: Record<string, string>) {
  return (value: string | null | undefined): string => {
    if (!value) return '—'
    return map[value] ?? value
  }
}

export const pageStatusLabel = makeLabeler(PAGE_STATUS_LABELS)
export const enrichmentStatusLabel = makeLabeler(ENRICHMENT_STATUS_LABELS)
export const cloudApiTemplateStatusLabel = makeLabeler(CLOUD_API_TEMPLATE_STATUS_LABELS)
export const cloudApiTemplateCategoryLabel = makeLabeler(CLOUD_API_TEMPLATE_CATEGORY_LABELS)
export const cloudApiTemplateReasonLabel = makeLabeler(CLOUD_API_TEMPLATE_REASON_LABELS)
export const cloudApiQualityLabel = makeLabeler(CLOUD_API_QUALITY_LABELS)
export const cloudApiMessageStatusLabel = makeLabeler(CLOUD_API_MESSAGE_STATUS_LABELS)
export const metaFormStatusLabel = makeLabeler(META_FORM_STATUS_LABELS)
export const metaLogStatusLabel = makeLabeler(META_LOG_STATUS_LABELS)
export const activityStatusLabel = makeLabeler(ACTIVITY_STATUS_LABELS)
export const queueJobStatusLabel = makeLabeler(QUEUE_JOB_STATUS_LABELS)
