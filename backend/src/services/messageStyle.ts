// src/services/messageStyle.ts
//
// Estilo de escrita das mensagens que a IA manda no WhatsApp.
//
// O modelo escreve como quem redige um e-mail: um parágrafo com três ideias,
// travessão para dar pausa, duas perguntas na mesma frase. Ninguém conversa
// assim no WhatsApp — e o roteiro de atendimento da operação proíbe
// explicitamente. Pedir isso no prompt não basta: o modelo obedece nas
// primeiras mensagens e volta ao vício depois.
//
// Então a regra vira código, na saída, onde não tem como escapar:
//   1. sem travessão (vira pausa de verdade: outra mensagem, ou vírgula)
//   2. sem emoji
//   3. cada ideia em uma mensagem própria
//   4. no máximo uma pergunta por mensagem
//
// O que NÃO é tocado: listas numeradas (as opções de horário precisam chegar
// juntas) e blocos curtos, que já estão no formato certo.

/** Tamanho a partir do qual um bloco com mais de uma frase é dividido. */
const LIMITE_BLOCO = 120

/**
 * Pergunta curta de cortesia ("Tudo bem?", "Combinado?") acompanha a frase
 * anterior. A regra de uma pergunta por mensagem existe para o lead não ter que
 * responder duas coisas de uma vez, e essas não pedem resposta de verdade.
 */
const CORTESIA_MAX = 18

/** Teto de mensagens por turno: acima disso vira metralhadora de notificação. */
const MAX_MENSAGENS = 6

const EMOJI = /(\p{Extended_Pictographic}|\p{Emoji_Presentation}|️|‍)/gu

/** Travessão/menos-longo em qualquer variante, incluindo o "--" digitado. */
const TRAVESSAO_ESPACADO = /\s+[—–―‒]+\s+|\s+--\s+/g
const TRAVESSAO_COLADO = /[—–―‒]/g

/**
 * Aplica as regras de estilo a um texto: tira emoji e resolve os travessões.
 * O travessão espaçado vira uma quebra forte (§) que o divisor transforma em
 * mensagem separada, que é a pausa que o autor queria dar. O colado (ex.: em
 * "9h—10h") vira vírgula, porque ali não existe pausa nenhuma.
 */
export function limparEstilo(texto: string): string {
  if (!texto) return ''
  return texto
    .replace(EMOJI, '')
    .replace(TRAVESSAO_ESPACADO, '\n\n')
    .replace(TRAVESSAO_COLADO, ', ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([,.!?])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Uma linha que faz parte de lista numerada/marcada não pode ser separada das irmãs. */
function ehItemDeLista(linha: string): boolean {
  return /^\s*(\d+[).]|[-*•])\s+/.test(linha)
}

/** Divide um bloco em frases, preservando o sinal de pontuação final. */
function frases(bloco: string): string[] {
  const partes = bloco.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g)
  return (partes || [bloco]).map((f) => f.trim()).filter(Boolean)
}

/**
 * Quebra o texto de UM turno da IA na sequência de mensagens que uma pessoa
 * mandaria. Devolve sempre ao menos um item (o texto original, se não houver o
 * que quebrar).
 */
export function quebrarEmMensagens(texto: string): string[] {
  const limpo = limparEstilo(texto)
  if (!limpo) return []

  // 1. Parágrafos são separadores naturais.
  const blocos: string[] = []
  for (const paragrafo of limpo.split(/\n{2,}/)) {
    const linhas = paragrafo.split('\n').map((l) => l.trim()).filter(Boolean)
    if (!linhas.length) continue

    // Lista (horários, opções): tudo junto numa mensagem só.
    if (linhas.some(ehItemDeLista)) {
      blocos.push(linhas.join('\n'))
      continue
    }
    // Linhas soltas dentro do mesmo parágrafo já são ideias separadas.
    for (const linha of linhas) blocos.push(linha)
  }

  // 2. Bloco com mais de uma frase: separa quando há pergunta (uma pergunta por
  //    mensagem) ou quando ficou longo demais para uma bolha só.
  const saida: string[] = []
  for (const bloco of blocos) {
    if (ehItemDeLista(bloco.split('\n')[0] ?? '')) { saida.push(bloco); continue }

    const fs = frases(bloco)
    const temPergunta = fs.some((f) => f.endsWith('?'))
    if (fs.length > 1 && (temPergunta || bloco.length > LIMITE_BLOCO)) {
      // Agrupa as afirmações curtas seguidas, mas toda pergunta fica sozinha.
      let buffer = ''
      for (const f of fs) {
        if (f.endsWith('?')) {
          // Cortesia curta cola na frase anterior; pergunta de verdade vai sozinha.
          if (buffer && f.length <= CORTESIA_MAX) {
            saida.push(`${buffer} ${f}`.trim())
            buffer = ''
            continue
          }
          if (buffer) { saida.push(buffer.trim()); buffer = '' }
          saida.push(f)
          continue
        }
        const candidato = buffer ? `${buffer} ${f}` : f
        if (candidato.length > LIMITE_BLOCO) {
          if (buffer) saida.push(buffer.trim())
          buffer = f
        } else {
          buffer = candidato
        }
      }
      if (buffer) saida.push(buffer.trim())
    } else {
      saida.push(bloco)
    }
  }

  // Quebrar no travessão deixa a continuação começando em minúscula ("a gente
  // cuida..."), que numa bolha própria parece frase cortada pela metade.
  const mensagens = saida
    .map((m) => m.trim())
    .filter(Boolean)
    .map((m) => (/^\p{Ll}/u.test(m) ? m.charAt(0).toUpperCase() + m.slice(1) : m))
  if (mensagens.length <= MAX_MENSAGENS) return mensagens

  // Acima do teto: mantém as primeiras e junta o resto na última bolha, para não
  // perder conteúdo nem disparar dez notificações seguidas.
  const cabeca = mensagens.slice(0, MAX_MENSAGENS - 1)
  const cauda = mensagens.slice(MAX_MENSAGENS - 1).join('\n\n')
  return [...cabeca, cauda]
}

/**
 * Intervalo entre duas mensagens da sequência: o tempo que alguém levaria para
 * digitar a próxima. Curto o bastante para não parecer travado, longo o
 * bastante para as bolhas não chegarem empilhadas no mesmo segundo.
 */
export function intervaloDigitacao(proxima: string): number {
  const ms = 400 + proxima.length * 25
  return Math.min(2500, Math.max(600, ms))
}
