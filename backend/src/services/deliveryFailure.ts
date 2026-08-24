// src/services/deliveryFailure.ts
//
// Motivo de uma mensagem que SAIU e não foi entregue.
//
// É um caminho diferente do erro de envio: ali a chamada falha na hora e o
// operador vê a recusa na tela. Aqui a Meta aceita o envio, devolve o `wamid`
// e só segundos depois manda um webhook `status: failed`. A mensagem já está
// gravada e visível na conversa — o que faltava era dizer que ela não chegou.
//
// A tradução reaproveita `humanizeWhatsAppError`, que já cobre os códigos da
// Cloud API: aqui o código vira o mesmo JSON que aquele tradutor espera.

import { humanizeWhatsAppError } from '../lib/whatsappErrors.js'

export interface FalhaDeEntrega {
  /** código da Meta, quando o webhook trouxe (ex.: 131026) */
  code: number | null
  /** título original da Meta, em inglês — guardado para suporte técnico */
  title: string | null
  /** frase em português para quem está atendendo */
  message: string
}

/**
 * Casos que a Meta só reporta neste webhook (nunca na resposta do envio), por
 * isso não estão em `whatsappErrors.ts` — lá as regras são as do envio
 * síncrono. Sem eles a mensagem cairia no texto genérico.
 */
const REGRAS_ASSINCRONAS: Record<number, (n?: string) => string> = {
  131049: () => 'O WhatsApp segurou esta mensagem para preservar o engajamento da conta — acontece com envios de marketing para quem não conversa com a empresa. Prefira responder dentro da conversa ou usar um modelo de utilidade.',
  130472: () => 'Este contato faz parte de um experimento da Meta e não recebe mensagens de marketing no momento. Tente outro canal ou aguarde ele iniciar a conversa.',
  131052: () => 'O WhatsApp não conseguiu baixar o arquivo enviado. Reenvie a mídia — se repetir, tente outro formato ou um arquivo menor.',
  131053: () => 'O formato do arquivo não é aceito pelo WhatsApp neste tipo de envio. Converta a mídia e tente de novo.',
  131048: () => 'A conta atingiu o limite de qualidade da Meta e o envio foi bloqueado. Verifique a qualidade do número no Gerenciador de Negócios.',
}

/**
 * Traduz o par (código, título) que o webhook de status guardou no log da Cloud
 * API. Quando não veio código nenhum — falha registrada sem detalhe —, devolve
 * a frase genérica, que ainda é melhor que o relógio de "enviando".
 */
export function explicarFalhaDeEntrega(
  code: number | null | string,
  title: string | null,
  numeroDestino?: string,
): FalhaDeEntrega {
  const codigo = code === null || code === '' ? null : Number(code)

  if (codigo !== null && !Number.isNaN(codigo)) {
    const especifica = REGRAS_ASSINCRONAS[codigo]
    if (especifica) return { code: codigo, title: title ?? null, message: especifica(numeroDestino) }

    // Monta o mesmo envelope que o tradutor de envio lê ("code"/"number"), para
    // não duplicar aqui as regras que já existem lá.
    const envelope = JSON.stringify({
      error: { code: codigo, message: title ?? '' },
      number: numeroDestino ?? '',
    })
    return { code: codigo, title: title ?? null, message: humanizeWhatsAppError(envelope, undefined, 'send') }
  }

  return {
    code: null,
    title: title ?? null,
    message: title
      ? `O WhatsApp não entregou esta mensagem: ${title}`
      : 'O WhatsApp não entregou esta mensagem e não informou o motivo. Confira o número do contato e tente de novo.',
  }
}
