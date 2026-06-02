// Tradução centralizada de status / métodos / provedores de pagamento.
// Use estes helpers em qualquer UI que exiba status pra usuário final — assim
// novos status acrescentados em algum provider só precisam ser traduzidos aqui.

export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  paid: 'Pago',
  pending: 'Pendente',
  failed: 'Falhou',
  overdue: 'Vencido',
  expired: 'Expirado',
  refunded: 'Reembolsado',
  received: 'Recebido',
  cancelled: 'Cancelado',
  canceled: 'Cancelado',
  processing: 'Processando',
}

export type PaymentStatusTone = 'success' | 'warning' | 'danger' | 'info'

export const PAYMENT_STATUS_TONE: Record<string, PaymentStatusTone> = {
  paid: 'success',
  pending: 'warning',
  failed: 'danger',
  overdue: 'danger',
  expired: 'danger',
  refunded: 'info',
  cancelled: 'info',
  canceled: 'info',
  processing: 'info',
  received: 'warning',
}

export function paymentStatusLabel(s: string | null | undefined): string {
  if (!s) return '—'
  return PAYMENT_STATUS_LABEL[s] ?? s
}

export function paymentStatusTone(s: string | null | undefined): PaymentStatusTone {
  if (!s) return 'info'
  return PAYMENT_STATUS_TONE[s] ?? 'info'
}

export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  pix: 'PIX',
  boleto: 'Boleto',
  credit_card: 'Cartão',
  CREDIT_CARD: 'Cartão',
  PIX: 'PIX',
  BOLETO: 'Boleto',
  UNDEFINED: 'A escolher',
}

export function paymentMethodLabel(m: string | null | undefined): string {
  if (!m) return '—'
  return PAYMENT_METHOD_LABEL[m] ?? m
}

export const PAYMENT_PROVIDER_LABEL: Record<string, string> = {
  pagarme: 'Pagar.me',
  asaas: 'Asaas',
}

export function paymentProviderLabel(p: string | null | undefined): string {
  if (!p) return '—'
  return PAYMENT_PROVIDER_LABEL[p] ?? p
}
