// src/lib/whatsappErrors.ts
//
// Tradutor de erros de envio de WhatsApp para linguagem de quem atende.
//
// O operador via coisas assim na tela:
//   {"jid":"5511981235748@s.whatsapp.net","exists":false,"number":"5511981235748"}
//   Cloud API 401: {"error":{"message":"No approved call permission...","code":138006}}
//   C                                    ← "Connection Closed" truncado num bug
//
// Nada disso diz o que houve nem o que fazer. Cada regra abaixo devolve as duas
// coisas numa frase só: o que aconteceu e qual é o próximo passo. Quando o erro
// não é reconhecido, o texto original é preservado (melhor um técnico do que
// esconder a causa).

/**
 * De onde veio o erro. O mesmo código da Meta significa coisas diferentes em
 * cada tela: 100 num envio é "número do contato errado"; 100 ao salvar o perfil
 * da empresa é "campo do perfil recusado". Sem isso o operador lê uma instrução
 * que não tem nada a ver com o que ele estava fazendo.
 */
export type WhatsAppErrorContext = 'send' | 'profile' | 'automation' | 'account'

interface Rule {
  /** código numérico da Meta (error.code) */
  code?: number
  /** trecho procurado no texto do erro, minúsculo */
  match?: RegExp
  message: (ctx: { number?: string }) => string
}

/**
 * Regras da API Oficial (Meta). Os códigos são os da documentação de Cloud API;
 * o que interessa aqui é a tradução, não a taxonomia.
 */
const CLOUD_RULES: Rule[] = [
  {
    code: 131047,
    message: () => 'O cliente não te manda mensagem há mais de 24 horas. Pelas regras do WhatsApp, fora dessa janela só é possível enviar um modelo aprovado. Envie um modelo ou espere ele responder.',
  },
  {
    code: 131026,
    message: ({ number }) => `O WhatsApp não conseguiu entregar${number ? ` para ${number}` : ''}. Em geral é número sem WhatsApp, desativado ou que bloqueou a empresa.`,
  },
  {
    code: 133010,
    message: () => 'O número da empresa ainda não está registrado na API Oficial. Conclua o registro em Configurações › WhatsApp antes de enviar.',
  },
  {
    code: 131009,
    message: ({ number }) => `O WhatsApp recusou o número do destinatário${number ? ` (${number})` : ''} por formato inválido. Confira DDI, DDD e a quantidade de dígitos no cadastro do contato.`,
  },
  {
    code: 190,
    message: () => 'A conexão com a Meta expirou (token inválido). Reconecte a conta em Configurações › WhatsApp.',
  },
  {
    code: 131042,
    message: () => 'A conta do WhatsApp Business está com pendência de pagamento na Meta. Regularize a forma de pagamento no Gerenciador de Negócios.',
  },
  {
    code: 131031,
    message: () => 'A conta do WhatsApp Business foi restringida ou bloqueada pela Meta. Verifique a qualidade do número no Gerenciador de Negócios.',
  },
  {
    code: 368,
    message: () => 'A conta está temporariamente bloqueada pela Meta por violação das políticas. Verifique o status no Gerenciador de Negócios.',
  },
  {
    code: 130429,
    message: () => 'Muitas mensagens em pouco tempo — o WhatsApp aplicou um limite temporário. Aguarde alguns minutos e tente de novo.',
  },
  {
    code: 131056,
    message: () => 'Muitas mensagens seguidas para este mesmo contato. Aguarde alguns minutos antes de tentar de novo.',
  },
  {
    code: 138006,
    message: () => 'O cliente não autorizou receber chamadas pelo WhatsApp. Só é possível ligar depois que ele aceitar.',
  },
  {
    code: 131051,
    message: () => 'Esse tipo de mensagem não é aceito pelo WhatsApp neste envio. Tente enviar como texto ou outro formato de arquivo.',
  },
  {
    code: 132000,
    message: () => 'O modelo de mensagem foi enviado com número de campos diferente do aprovado. Revise as variáveis do modelo.',
  },
  {
    code: 132001,
    message: () => 'O modelo de mensagem não existe ou não está aprovado para este idioma. Verifique em Configurações › Modelos.',
  },
  {
    code: 132015,
    message: () => 'O modelo de mensagem está pausado pela Meta por baixa qualidade. Use outro modelo ou aguarde a liberação.',
  },
  {
    code: 100,
    message: () => 'O WhatsApp recusou os dados do envio (parâmetro inválido). Confira o número do contato e o conteúdo da mensagem.',
  },
]

/**
 * Regras das telas de configuração (perfil da empresa, atalhos da conversa,
 * PIN, dados do número). Nada aqui fala em "envio" nem em "contato": quem está
 * na frente da tela está mexendo na conta, não mandando mensagem.
 *
 * Os dois primeiros casos são os que mais aparecem e a Meta não explica nenhum
 * deles — foram identificados testando campo a campo contra a Graph:
 *   • `about` (recado) em branco → 500 "(#131000) Something went wrong"
 *   • `vertical: UNDEFINED`      → 400 "(#100) Param vertical must be one of…"
 */
const CONFIG_RULES: Rule[] = [
  {
    code: 131000,
    message: () => 'A Meta recusou a alteração sem dizer o motivo. Quase sempre é um campo que ela não aceita em branco — o recado (status) precisa ter pelo menos um caractere e não pode ser apagado depois de preenchido.',
  },
  {
    match: /param vertical must be one of/i,
    message: () => 'O setor escolhido não está na lista que a Meta aceita. Escolha outro setor — depois de definido, o setor não volta para "Não informado" pela API.',
  },
  {
    code: 190,
    message: () => 'A conexão com a Meta expirou (token inválido). Reconecte a conta em Configurações › WhatsApp.',
  },
  {
    code: 10,
    message: () => 'O aplicativo da Meta não tem permissão para alterar esta conta. Falta o acesso "whatsapp_business_management" — refaça a conexão em Configurações › WhatsApp.',
  },
  {
    code: 200,
    message: () => 'O usuário da Meta ligado a esta conexão não tem permissão para alterar a conta do WhatsApp. Verifique o acesso dele no Gerenciador de Negócios.',
  },
  {
    code: 803,
    message: () => 'A Meta não encontrou este número/conta. Ele pode ter sido removido do Gerenciador de Negócios — reconecte em Configurações › WhatsApp.',
  },
  {
    code: 100,
    message: () => 'A Meta recusou um dos campos preenchidos. Revise os textos, o setor e os sites informados.',
  },
  {
    code: 368,
    message: () => 'A conta está temporariamente bloqueada pela Meta por violação das políticas. Verifique o status no Gerenciador de Negócios.',
  },
  {
    code: 131031,
    message: () => 'A conta do WhatsApp Business foi restringida ou bloqueada pela Meta. Não é possível alterar o perfil enquanto isso durar.',
  },
]

/** Regras da Evolution (WhatsApp não oficial, via aparelho conectado). */
const EVOLUTION_RULES: Rule[] = [
  {
    match: /connection closed|connection lost|not connected|"close"|desconect/i,
    message: () => 'A conexão de WhatsApp usada nesta conversa está desconectada. Reconecte o aparelho pelo QR Code em Configurações › WhatsApp.',
  },
  {
    match: /instance .*not found|does not exist|instancia nao encontrada/i,
    message: () => 'A conexão de WhatsApp configurada não existe mais. Verifique em Configurações › WhatsApp qual número está vinculado.',
  },
  {
    match: /unauthorized|invalid apikey|api key/i,
    message: () => 'As credenciais do servidor de WhatsApp foram recusadas. Avise o suporte técnico — não é algo que se resolva pela tela.',
  },
  {
    match: /rate.?limit|too many requests/i,
    message: () => 'Muitas mensagens em pouco tempo. Aguarde alguns minutos e tente de novo.',
  },
  {
    match: /fetch failed|econnrefused|enotfound|etimedout|socket hang up|network/i,
    message: () => 'O servidor de WhatsApp não respondeu. Tente de novo em instantes; se persistir, avise o suporte técnico.',
  },
  {
    match: /not-authorized|forbidden.*group|only admins/i,
    message: () => 'Só administradores podem publicar neste grupo. Peça para promoverem o número da empresa a administrador.',
  },
  // Ações sobre mensagem já enviada (editar/apagar/reagir). A Evolution compara
  // o JID do pedido com o que ela guardou, e responde em inglês e sem contexto.
  {
    match: /remotejid does not match/i,
    message: () => 'O WhatsApp não reconheceu esta conversa para a ação. Recarregue a conversa e tente de novo; se persistir, apague a mensagem e envie de novo.',
  },
  {
    match: /message not found/i,
    message: () => 'O WhatsApp não encontrou mais esta mensagem no aparelho — provavelmente ela é antiga demais ou já foi apagada por lá.',
  },
  {
    match: /message not compatible/i,
    message: () => 'O WhatsApp só permite editar mensagens de texto. Para mídia, apague para todos e envie de novo.',
  },
]

/** Extrai o primeiro código de erro numérico da Meta presente no texto. */
function extractMetaCode(text: string): number | null {
  const m = text.match(/"code"\s*:\s*(\d+)/)
  if (m) return Number(m[1])
  return null
}

/** Extrai o número de destino quando o erro o traz (ajuda a apontar o culpado). */
function extractNumber(raw: unknown, text: string): string | undefined {
  if (raw && typeof raw === 'object') {
    const anyRaw = raw as any
    const n = anyRaw.number || anyRaw?.response?.message?.[0]?.number
    if (n) return String(n)
  }
  const m = text.match(/(\d{10,15})@s\.whatsapp\.net/) || text.match(/"number"\s*:\s*"(\d{10,15})"/)
  return m ? m[1] : undefined
}

/** Explicação que a Meta às vezes manda pronta para o usuário final. É melhor
 *  que o `message` técnico quando existe. */
function extractUserMessage(text: string): string | null {
  const title = text.match(/"error_user_title"\s*:\s*"([^"]+)"/)
  const msg = text.match(/"error_user_msg"\s*:\s*"([^"]+)"/)
  if (msg) return title ? `${title[1]}: ${msg[1]}` : msg[1]
  return null
}

/**
 * Converte qualquer erro do WhatsApp (objeto da Evolution, JSON da Meta ou
 * Error já lançado) numa frase que um leigo entende. Retorna o texto original
 * quando não reconhece o caso — nunca engole a informação.
 *
 * `context` diz qual tela pediu a operação: sem isso um erro de "salvar perfil"
 * saía mandando o operador conferir o número do contato.
 */
export function humanizeWhatsAppError(
  raw: unknown,
  status?: number,
  context: WhatsAppErrorContext = 'send',
): string {
  const text = raw instanceof Error
    ? raw.message
    : typeof raw === 'string'
      ? raw
      : (() => { try { return JSON.stringify(raw) } catch { return String(raw) } })()

  const number = extractNumber(raw, text)
  const isSend = context === 'send'

  // Número sem WhatsApp — a Evolution devolve a checagem crua no corpo do erro.
  if (/"exists"\s*:\s*false/.test(text)) {
    return `O número ${number ?? 'informado'} não tem WhatsApp. Confira o telefone no cadastro do contato.`
  }

  const code = extractMetaCode(text)
  const rules = isSend ? CLOUD_RULES : CONFIG_RULES

  // Fora do envio, um trecho reconhecido no texto vale mais que o código: a Meta
  // usa o mesmo 100 para "setor inválido" e para qualquer outro campo recusado.
  if (!isSend) {
    for (const rule of rules) {
      if (rule.match && rule.match.test(text)) return rule.message({ number: number ?? '' })
    }
  }

  if (code !== null) {
    const rule = rules.find((r) => r.code === code)
    if (rule) return rule.message({ number: number ?? '' })
  }

  for (const rule of EVOLUTION_RULES) {
    if (rule.match && rule.match.test(text)) return rule.message({ number: number ?? '' })
  }

  // Não reconhecido: devolve o texto mais legível que der, sem inventar causa.
  const userMsg = extractUserMessage(text)
  if (userMsg) return userMsg
  const metaMsg = text.match(/"message"\s*:\s*"([^"]+)"/)
  if (metaMsg) {
    return isSend
      ? `O WhatsApp recusou o envio: ${metaMsg[1]}`
      : `A Meta recusou a alteração: ${metaMsg[1]}`
  }
  if (status) {
    return isSend
      ? `Falha de comunicação com o WhatsApp (código ${status}). Tente de novo; se persistir, avise o suporte técnico.`
      : `A Meta não respondeu como esperado (código ${status}). Tente de novo; se persistir, avise o suporte técnico.`
  }
  return text
}
