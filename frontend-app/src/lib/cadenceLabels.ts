/**
 * Rótulos em português pros enums de cadência (Sales Engagement).
 *
 * Centralizados aqui pra evitar divergência entre telas — cada lugar que
 * mostra `exitReason`, `pauseReason`, `lastReplyClass`, etc. importa daqui
 * em vez de redefinir o map inline.
 *
 * Os valores brutos vêm do backend (`backend/src/services/cadenceScheduler.ts`,
 * `cadenceReplyClassifier.ts`). Sempre que um novo motivo for criado lá,
 * adicione o label correspondente neste arquivo.
 */

export const CADENCE_STATUS_LABEL: Record<string, string> = {
  active:    'Ativa',
  paused:    'Pausada',
  completed: 'Concluída',
  exited:    'Encerrada',
}

export const CADENCE_EXIT_REASON_LABEL: Record<string, string> = {
  completed_all_steps:  'Concluiu todos os passos',
  break_up_sent:        'Mensagem de despedida enviada',
  status_exit:          'Status do lead removeu',
  converted:            'Conversão detectada',
  opted_out:            'Pediu para parar',
  opted_out_inferred:   'Pediu para parar (inferido por IA)',
  blacklisted:          'Lista de bloqueio',
  fora_fit:             'Fora do perfil',
  lead_invalid:         'Lead inválido',
}

export const CADENCE_PAUSE_REASON_LABEL: Record<string, string> = {
  reply_received:      'Resposta recebida',
  objection_received:  'Objeção recebida',
  governance_blocked:  'Bloqueado por governança',
  manual:              'Pausada manualmente',
}

export const CADENCE_REPLY_CLASS_LABEL: Record<string, string> = {
  positiva:     'Positiva',
  duvida:       'Dúvida',
  objecao:      'Objeção',
  desinteresse: 'Desinteresse',
  fora_fit:     'Fora de fit',
}

export const CADENCE_CHANNEL_LABEL: Record<string, string> = {
  whatsapp: 'WhatsApp',
  email:    'E-mail',
  sms:      'SMS',
  call:     'Ligação',
  linkedin: 'LinkedIn',
  manual:   'Tarefa manual',
}

/** Devolve o rótulo em pt-BR; se o motivo não for conhecido, devolve o próprio
 * valor bruto (em vez de mostrar nada) — assim novos motivos do backend ainda
 * aparecem na tela e o operador percebe que falta tradução. */
function lookup(map: Record<string, string>, raw: string | null | undefined): string {
  if (!raw) return '—'
  return map[raw] ?? raw
}

export const cadenceStatusLabel      = (s: string | null | undefined) => lookup(CADENCE_STATUS_LABEL, s)
export const cadenceExitReasonLabel  = (s: string | null | undefined) => lookup(CADENCE_EXIT_REASON_LABEL, s)
export const cadencePauseReasonLabel = (s: string | null | undefined) => lookup(CADENCE_PAUSE_REASON_LABEL, s)
export const cadenceReplyClassLabel  = (s: string | null | undefined) => lookup(CADENCE_REPLY_CLASS_LABEL, s)
export const cadenceChannelLabel     = (s: string | null | undefined) => lookup(CADENCE_CHANNEL_LABEL, s)
