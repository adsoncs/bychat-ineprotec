// src/lib/cloudApiErrosDeConta.ts
//
// Códigos de erro da Cloud API que travam a CONTA, não uma mensagem. Usados pelo
// vigia de erros (services/cloudApiErrorWatch.ts, onde existe) e pela barra de
// status das integrações (services/statusIntegracoes.ts) — uma tabela só, para
// os dois não discordarem sobre o que é "conta travada".

/**
 * Erros que travam a conta inteira. Cada um continua acontecendo até alguém
 * agir no WhatsApp Manager — por isso valem aviso, e os de mensagem não.
 */
export const ERROS_DE_CONTA: Record<string, string> = {
  '131042': 'Pendência de pagamento na conta WhatsApp Business — nenhum template é entregue até regularizar a forma de pagamento no WhatsApp Manager.',
  '131031': 'Conta WhatsApp Business bloqueada pela Meta.',
  '368': 'Conta temporariamente bloqueada por violação de política da Meta.',
  '131057': 'Conta em modo de manutenção na Meta.',
  '133010': 'Número não registrado na Cloud API.',
  '133004': 'Serviço da Meta indisponível para este número.',
}
