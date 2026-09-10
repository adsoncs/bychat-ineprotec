// src/lib/telefone.ts
//
// Telefone em formato de leitura, no painel.
//
// A regra que importa aqui é negativa: NÃO inventar "+55". A versão anterior
// (que morava dentro do ConversationsPage) colava "+55" na frente de qualquer
// número, então o +1 (689) 206-4057 da Marcia — mãe de aluna do severiano —
// aparecia na tela como "+55 16 89206-4057". O operador lia um contato de
// Ribeirão Preto, tentava falar, e o envio batia num número inexistente.
//
// Quem sabe de que país é o número é o backend (`lib/countryCodes.ts`, com os
// planos de numeração). O painel recebe isso pronto em `telefonePais` e usa as
// funções daqui só para desenhar. Sem esse dado, o fallback é honesto: número
// que casa com a estrutura brasileira sai como brasileiro, e o resto sai com o
// "+" e os dígitos que tem, sem afirmar país nenhum.

/** DDDs em uso no Brasil. Mesma lista fechada do backend. */
const DDD_BR = new Set([
  '11', '12', '13', '14', '15', '16', '17', '18', '19',
  '21', '22', '24', '27', '28',
  '31', '32', '33', '34', '35', '37', '38',
  '41', '42', '43', '44', '45', '46', '47', '48', '49',
  '51', '53', '54', '55',
  '61', '62', '63', '64', '65', '66', '67', '68', '69',
  '71', '73', '74', '75', '77', '79',
  '81', '82', '83', '84', '85', '86', '87', '88', '89',
  '91', '92', '93', '94', '95', '96', '97', '98', '99',
])

/** "55" + DDD válido + celular com o 9, ou fixo de 8 dígitos. */
function ehBrasileiro(digitos: string): boolean {
  if (!digitos.startsWith('55')) return false
  const nsn = digitos.slice(2)
  if (nsn.length !== 10 && nsn.length !== 11) return false
  if (!DDD_BR.has(nsn.slice(0, 2))) return false
  const resto = nsn.slice(2)
  return resto.length === 9 ? resto.startsWith('9') : /^[2-9]/.test(resto)
}

/**
 * Telefone legível.
 *   BR completo  → "+55 62 99111-4444"   ·  curto → "(62) 99111-4444"
 *   de fora      → "+1 689 206 4057"     ·  curto → o mesmo, sem o agrupamento
 */
export function formatarTelefone(bruto: string, forma: 'completo' | 'curto' = 'completo'): string {
  const d = String(bruto || '').replace(/@.+$/, '').replace(/\D/g, '')
  if (!d) return ''

  // Cadastro antigo sem DDI: se o bloco tem cara de brasileiro, mostra como tal.
  const comDdi = ehBrasileiro(d) ? d : ehBrasileiro('55' + d) ? '55' + d : d

  if (ehBrasileiro(comDdi)) {
    const nsn = comDdi.slice(2)
    const ddd = nsn.slice(0, 2)
    const resto = nsn.length === 11
      ? `${nsn.slice(2, 7)}-${nsn.slice(7)}`
      : `${nsn.slice(2, 6)}-${nsn.slice(6)}`
    return forma === 'curto' ? `(${ddd}) ${resto}` : `+55 ${ddd} ${resto}`
  }

  // De fora: não dá para separar DDI de número sem a tabela do backend, então
  // agrupa em blocos de 3 da direita para a esquerda — legível e sem mentir.
  const blocos: string[] = []
  let resto = d
  while (resto.length > 3) {
    blocos.unshift(resto.slice(-3))
    resto = resto.slice(0, -3)
  }
  if (resto) blocos.unshift(resto)
  return `+${blocos.join(' ')}`
}

/**
 * Máscara de digitação. Enquanto o operador não escreve "+", assume Brasil (é o
 * caso de quase todo cadastro); com "+" na frente, para de mascarar e deixa o
 * número internacional em paz — é o "+" que o backend lê como país declarado.
 */
export function mascaraTelefone(v: string): string {
  const bruto = String(v || '')
  if (bruto.trim().startsWith('+')) {
    const d = bruto.replace(/\D/g, '').slice(0, 15)
    return '+' + d
  }
  const d = bruto.replace(/\D/g, '').slice(0, 13)
  if (d.length <= 2) return d
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7, 11)}`
}
