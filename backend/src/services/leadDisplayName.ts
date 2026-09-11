// src/services/leadDisplayName.ts
//
// Quem manda no nome do contato.
//
// O nome exibido é sempre `Lead.nome` — todas as telas, exports e relatórios já
// leem esse campo. O que muda aqui é QUEM tem direito de escrevê-lo: antes o
// `pushName` (o nome que o contato escolheu no WhatsApp dele) virava a
// identidade do lead, e a empresa via na tela um apelido em vez do nome que ela
// mesma cadastrou ou salvou na agenda do aparelho.
//
// Ordem de força (do mais forte para o mais fraco):
//   manual      → alguém digitou no painel
//   formulario  → veio de formulário/agendamento/portal (o contato se apresentou)
//   import      → planilha/importação do celular
//   agenda      → nome que a EMPRESA salvou na agenda do WhatsApp conectado
//   grupo       → nome do grupo de WhatsApp (não é pessoa)
//   pushname    → legado: nome escolhido pelo contato (nunca é escrito de novo)
//   telefone    → sem nome confiável; mostra o número formatado
//   sem_numero  → nem nome nem número: contato que chegou só com LID
//
// Regra única: um nome só é substituído por outro de força MAIOR. É isso que
// impede o sync da agenda de passar por cima do que um humano digitou.

import { prisma } from '../lib/prisma.js'
import { formatarTelefone, isGroupJid, isLikelyLid } from '../lib/phone.js'

export type NomeOrigem =
  | 'manual'
  | 'formulario'
  | 'import'
  | 'agenda'
  | 'grupo'
  | 'pushname'
  | 'telefone'
  | 'sem_numero'

const FORCA: Record<NomeOrigem, number> = {
  manual: 100,
  formulario: 80,
  import: 70,
  agenda: 60,
  grupo: 60,
  pushname: 20,
  telefone: 10,
  // A mais fraca de todas, de propósito: é um rótulo de espera. Assim que o
  // número real aparecer, o nome por telefone (força 10) passa por cima dele
  // sozinho — sem isto o contato ficaria "Contato do WhatsApp" para sempre.
  sem_numero: 5,
}

export function forcaDaOrigem(origem: string | null | undefined): number {
  if (!origem) return 0
  return FORCA[origem as NomeOrigem] ?? 0
}

/** O nome novo vence o que já está gravado? Empate mantém o atual. */
export function podeSubstituir(origemAtual: string | null | undefined, origemNova: NomeOrigem): boolean {
  return FORCA[origemNova] > forcaDaOrigem(origemAtual)
}

/**
 * Rótulo de quem chegou sem nome e sem número que se possa discar.
 *
 * A alternativa seria deixar o campo em branco, e uma linha em branco na lista
 * de conversas parece defeito. Isto diz ao operador o que de fato aconteceu: o
 * contato existe, dá para responder, só não temos o telefone dele ainda.
 */
export const SEM_NUMERO = 'Contato do WhatsApp'

/**
 * Telefone em formato de leitura: `(62) 99871-6285`. É o que aparece quando não
 * há nome confiável — melhor que um apelido errado, e o operador reconhece o
 * número. Fora do Brasil sai com o DDI e a formatação do país: um contato dos
 * Estados Unidos aparece como `+1 (689) 206-4057`, não como um bloco de
 * dígitos que parece cadastro quebrado.
 */
export function telefoneComoNome(phone: string | null | undefined): string {
  const bruto = (phone ?? '').trim()
  // LID não é número: formatá-lo produz algo com cara de telefone — o severiano
  // via "+18 7303641276560" na lista — que o operador tenta discar e não existe.
  if (isLikelyLid(bruto) || isGroupJid(bruto)) return SEM_NUMERO
  const d = bruto.replace(/\D/g, '')
  if (!d) return 'Sem nome'
  return formatarTelefone(d) || `+${d}`
}

/** Nome inicial de um contato de WhatsApp: agenda da empresa, senão o número. */
export function nomeInicialWhatsapp(input: {
  nomeAgenda?: string | null
  phone?: string | null
}): { nome: string; origem: NomeOrigem } {
  const agenda = (input.nomeAgenda ?? '').trim()
  if (agenda) return { nome: agenda, origem: 'agenda' }
  const nome = telefoneComoNome(input.phone)
  return nome === SEM_NUMERO
    ? { nome, origem: 'sem_numero' }
    : { nome, origem: 'telefone' }
}

/**
 * Grava um nome respeitando a hierarquia. Devolve true quando o nome mudou.
 *
 * `pushName` nunca entra como nome: quando vem, é só guardado no campo próprio
 * (referência para o operador e para o resolvedor de identidade por nome).
 */
export async function registrarNome(input: {
  leadId: number
  nome?: string | null
  origem: NomeOrigem
  pushName?: string | null
  nomeAgenda?: string | null
}): Promise<boolean> {
  const lead = await prisma.lead.findUnique({
    where: { id: input.leadId },
    select: { id: true, nome: true, nomeOrigem: true, pushName: true, nomeWhatsappAgenda: true },
  })
  if (!lead) return false

  const data: Record<string, unknown> = {}
  const push = (input.pushName ?? '').trim()
  if (push && push !== lead.pushName) data.pushName = push.slice(0, 191)
  const agenda = (input.nomeAgenda ?? '').trim()
  if (agenda && agenda !== lead.nomeWhatsappAgenda) data.nomeWhatsappAgenda = agenda.slice(0, 191)

  const novo = (input.nome ?? '').trim()
  let mudou = false
  if (novo && podeSubstituir(lead.nomeOrigem, input.origem)) {
    data.nome = novo.slice(0, 191)
    data.nomeOrigem = input.origem
    mudou = novo !== lead.nome
  } else if (novo && !lead.nomeOrigem) {
    // Lead antigo sem marcação: assume a origem de quem está escrevendo agora
    // apenas se o nome atual for vazio — não reescrevemos histórico.
    if (!lead.nome?.trim()) {
      data.nome = novo.slice(0, 191)
      data.nomeOrigem = input.origem
      mudou = true
    }
  }

  if (Object.keys(data).length === 0) return false
  await prisma.lead.update({ where: { id: lead.id }, data })
  return mudou
}
