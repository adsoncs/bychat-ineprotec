/**
 * Glossário de erros HTTP em linguagem de quem usa o sistema.
 *
 * Antes, toda resposta sem `{ error }` em JSON virava "HTTP 413", "HTTP 502"…
 * — o código cru, que nem especialista decifra sem abrir o console. Isso
 * acontece justamente nas falhas que NÃO passam pelo nosso backend: o nginx
 * barrando arquivo grande (página HTML de 413), o servidor reiniciando (502),
 * a internet caindo (fetch nem chega a ter status). E o fastify, quando o erro
 * é dele, devolve `error: "Payload Too Large"` — inglês genérico, igualmente
 * inútil.
 *
 * Regra: mensagem escrita pelo nosso backend ganha sempre (ela sabe o motivo
 * exato). O glossário só entra quando a resposta não diz nada útil, e termina
 * com o código entre parênteses para o suporte continuar achando no log.
 */

const POR_STATUS: Record<number, string> = {
  400: 'O sistema não aceitou os dados enviados. Confira os campos e tente de novo.',
  401: 'Sua sessão expirou. Entre de novo para continuar.',
  403: 'Seu usuário não tem permissão para esta ação. Peça a um administrador para liberar.',
  404: 'Não encontramos o que você pediu — pode ter sido apagado ou movido.',
  408: 'O servidor demorou demais para receber os dados. Verifique a internet e tente de novo.',
  409: 'Outra pessoa alterou isto ao mesmo tempo. Atualize a tela e tente de novo.',
  413: 'Arquivo grande demais para enviar (máximo 25 MB). Envie um arquivo menor ou um áudio mais curto.',
  415: 'Formato de arquivo não aceito.',
  422: 'Alguns dados estão inválidos. Confira os campos e tente de novo.',
  429: 'Muitas tentativas em pouco tempo. Aguarde alguns segundos e tente de novo.',
  500: 'Erro interno no servidor. Tente de novo; se continuar, avise o suporte.',
  502: 'O servidor está reiniciando ou fora do ar. Aguarde alguns segundos e tente de novo.',
  503: 'O servidor está sobrecarregado ou em manutenção. Aguarde alguns segundos e tente de novo.',
  504: 'O servidor demorou demais para responder. Tente de novo em instantes.',
}

/** Frases-padrão em inglês (fastify, nginx, proxies) que não explicam nada. */
const GENERICAS = new Set([
  'bad request', 'unauthorized', 'forbidden', 'not found', 'request timeout',
  'conflict', 'payload too large', 'request entity too large', 'unsupported media type',
  'unprocessable entity', 'too many requests', 'internal server error', 'bad gateway',
  'service unavailable', 'gateway timeout',
])

export function mensagemPorStatus(status: number): string {
  const base =
    POR_STATUS[status] ??
    (status >= 500 ? POR_STATUS[500] : 'Não foi possível concluir a ação. Tente de novo.')
  return `${base} (código ${status})`
}

/** Escolhe a melhor mensagem para uma resposta de erro já lida. */
export function mensagemDeErro(status: number, data: unknown): string {
  if (data && typeof data === 'object' && 'error' in data) {
    const texto = (data as { error: unknown }).error
    const codigo = (data as { code?: unknown }).code
    const doFastify = typeof codigo === 'string' && codigo.startsWith('FST_')
    if (typeof texto === 'string' && texto.trim() && !doFastify && !GENERICAS.has(texto.trim().toLowerCase())) {
      return texto
    }
  }
  return mensagemPorStatus(status)
}

/** Falha antes de existir resposta: sem internet, DNS, conexão cortada. */
export const MENSAGEM_SEM_CONEXAO =
  'Sem conexão com o servidor. Verifique a internet e tente de novo.'
