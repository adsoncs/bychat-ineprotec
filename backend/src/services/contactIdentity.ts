// src/services/contactIdentity.ts
//
// Resolvedor ÚNICO de identidade de contato para mensagens recebidas (inbound),
// usado por Cloud API e Evolution. Substitui as 3 lógicas divergentes que
// fragmentavam o mesmo contato em vários leads.
//
// Ordem de resolução (forte → fraca):
//   1) waLid exato        — identidade forte do WhatsApp (quando veio @lid)
//   2) phoneKey canônico  — match EXATO do telefone normalizado (lib/phone.ts)
//   3) pushName (1º nome) — SÓ quando não há telefone (contato puro-LID), janela
//                           recente e lead ainda sem LID. Ponte best-effort.
// NÃO cria lead — apenas resolve. O caller decide criar (com os dados corretos).

import { prisma } from '../lib/prisma.js'
import { phoneKey, isLikelyLid } from '../lib/phone.js'

export interface InboundContact {
  phone?: string | null      // número bruto, qualquer formato
  waLid?: string | null      // JID @lid, se a mensagem veio assim
  pushName?: string | null
}

export interface ResolvedContact {
  lead: { id: number; whatsapp: string; waLid: string | null; phoneKey: string | null } | null
  matchedBy: 'walid' | 'phoneKey' | 'pushName' | null
  phoneKey: string | null    // chave canônica do telefone (ou null se puro-LID)
}

const SELECT = { id: true, whatsapp: true, waLid: true, phoneKey: true } as const

export async function resolveLeadForContact(c: InboundContact): Promise<ResolvedContact> {
  const pk = phoneKey(c.phone)
  const lid = c.waLid && isLikelyLid(c.waLid) ? c.waLid : null

  // 1) waLid exato
  if (lid) {
    const byLid = await prisma.lead.findFirst({ where: { waLid: lid }, orderBy: { createdAt: 'desc' }, select: SELECT })
    if (byLid) return { lead: byLid, matchedBy: 'walid', phoneKey: pk }
  }

  // 2) phoneKey canônico exato
  if (pk) {
    const byKey = await prisma.lead.findFirst({ where: { phoneKey: pk }, orderBy: { createdAt: 'desc' }, select: SELECT })
    if (byKey) return { lead: byKey, matchedBy: 'phoneKey', phoneKey: pk }
  }

  // 3) pushName — apenas para contato puro-LID (sem telefone resolvido)
  if (!pk && lid && c.pushName) {
    const first = c.pushName.trim().split(/\s+/)[0]
    if (first && first.length >= 3) {
      const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000)
      const byName = await prisma.lead.findFirst({
        where: { nome: { startsWith: first }, waLid: null, createdAt: { gte: cutoff } },
        orderBy: { createdAt: 'desc' },
        select: SELECT,
      })
      if (byName) return { lead: byName, matchedBy: 'pushName', phoneKey: pk }
    }
  }

  return { lead: null, matchedBy: null, phoneKey: pk }
}

// Após casar um lead, garante que ele carregue a identidade canônica (backfill
// preguiçoso de leads legados + grava o LID recém-descoberto). Idempotente.
export async function reconcileLeadIdentity(
  leadId: number,
  current: { whatsapp: string; waLid: string | null; phoneKey: string | null },
  incoming: { phone?: string | null; waLid?: string | null },
): Promise<void> {
  const data: Record<string, unknown> = {}
  const pk = phoneKey(incoming.phone) ?? phoneKey(current.whatsapp)
  if (pk && pk !== current.phoneKey) data.phoneKey = pk
  // Grava o LID se o lead ainda não tem e a mensagem trouxe um.
  if (incoming.waLid && isLikelyLid(incoming.waLid) && !current.waLid) data.waLid = incoming.waLid
  // Se o lead estava SEM telefone (puro-LID) e agora chegou um número real, adota.
  if ((!current.whatsapp || isLikelyLid(current.whatsapp)) && incoming.phone && phoneKey(incoming.phone)) {
    data.whatsapp = phoneKey(incoming.phone)
  }
  if (Object.keys(data).length > 0) {
    await prisma.lead.update({ where: { id: leadId }, data }).catch(() => {})
  }

  // O contato que entrou só com LID ficou na lista como "Contato do WhatsApp",
  // porque não havia número para mostrar. Agora há: o nome de espera cede ao
  // telefone formatado. A hierarquia de `registrarNome` cuida do resto — se
  // alguém já digitou um nome à mão, ou a agenda trouxe um, nada muda aqui.
  if (typeof data.whatsapp === 'string' && data.whatsapp) {
    const { registrarNome, telefoneComoNome } = await import('./leadDisplayName.js')
    await registrarNome({
      leadId,
      nome: telefoneComoNome(data.whatsapp),
      origem: 'telefone',
    }).catch(() => {})
  }
}

/**
 * Ficha COMPLETA do contato para os motores de chatbot, casando pela identidade
 * canônica (phoneKey) ANTES de cair na igualdade crua em `whatsapp`.
 *
 * Os motores buscavam só `where: { whatsapp: phone }`. Não casa: a Cloud API
 * entrega o número BR SEM o 9º dígito ("557186799229") e o middleware do Prisma
 * (lib/prisma.ts → applyPhoneKey) grava o telefone já canônico, COM o 9
 * ("5571986799229"). A busca nunca encontrava, o motor abria uma ficha nova a
 * cada mensagem — e a ficha nova já nascia canônica, garantindo que a mensagem
 * seguinte também não achasse. O estado da jornada (`_aiJourney`/`_script`) e o
 * histórico do LLM vivem por leadId, então a IA se reapresentava a cada turno e
 * perdia tudo o que o lead tinha respondido.
 *
 * A busca crua CONTINUA aqui, como segundo passo: `phoneKey` devolve null para
 * o que não é telefone identificável (número estrangeiro fora do padrão, ficha
 * legada com dígito a mais). Nesses casos a igualdade crua é o único match que
 * existe — trocá-la pelo phoneKey teria recriado o mesmo bug do outro lado.
 *
 * E um terceiro passo pelo `waLid`, para quem chegou só com o LID: a ficha
 * dessa pessoa não tem telefone nenhum, então os dois primeiros passos passam
 * direto por ela. Esta função é, portanto, um SUPERCONJUNTO estrito do que os
 * motores faziam: acha tudo o que a busca antiga achava, mais o que ela
 * deixava passar.
 *
 * `somenteAbertos` reproduz o `completed: false` do motor 'ai' (chatbotFlow):
 * ficha já concluída não é retomada, abre-se uma conversa nova.
 * `reconciliar` (default true) faz o backfill preguiçoso de phoneKey/waLid do
 * lead que casou; desligado em caminhos de leitura pura (gates), que não devem
 * escrever.
 */
export interface OpcoesFichaDoContato {
  somenteAbertos?: boolean
  reconciliar?: boolean
}

export async function acharLeadDoContato(
  phone: string,
  opts: OpcoesFichaDoContato = {},
): Promise<Awaited<ReturnType<typeof prisma.lead.findUnique>>> {
  if (!phone) return null
  const filtro = opts.somenteAbertos ? { completed: false } : {}

  // 1) identidade canônica: colapsa com/sem 9º dígito, com/sem DDI, formatado.
  const pk = phoneKey(phone)
  // Desempate por id: duas fichas gravadas no mesmo instante (a corrida que a
  // trava anti-ficha-em-dobro cobre) deixariam a ordem indefinida, e o bot
  // responderia ora numa, ora noutra, entre mensagens da MESMA conversa.
  const ordem = [{ createdAt: 'desc' as const }, { id: 'desc' as const }]
  let lead = pk
    ? await prisma.lead.findFirst({ where: { phoneKey: pk, ...filtro }, orderBy: ordem })
    : null

  // 2) igualdade crua — o que os motores sempre fizeram. Cobre o número fora do
  //    padrão e a ficha legada sem phoneKey preenchido (o middleware só grava na
  //    próxima escrita).
  if (!lead) {
    lead = await prisma.lead.findFirst({ where: { whatsapp: phone, ...filtro }, orderBy: ordem })
  }

  // 3) waLid — a ÚNICA chave de quem chegou só com o LID. A ficha dessa pessoa
  //    não tem telefone (a coluna fica vazia de propósito: LID não é número),
  //    então nem o phoneKey nem a igualdade crua a encontram. Sem este passo o
  //    motor abriria uma ficha por mensagem, e a jornada — que vive por leadId —
  //    recomeçaria do zero a cada turno.
  if (!lead && isLikelyLid(phone)) {
    const lid = phone.includes('@') ? phone : `${phone}@lid`
    lead = await prisma.lead.findFirst({
      where: { waLid: { in: [lid, phone] }, ...filtro },
      orderBy: ordem,
    })
  }
  if (!lead) return null

  if (opts.reconciliar !== false) {
    await reconcileLeadIdentity(
      lead.id,
      { whatsapp: lead.whatsapp, waLid: lead.waLid, phoneKey: lead.phoneKey },
      { phone },
    ).catch(() => {})
  }
  return lead
}

// ── Trava contra a ficha em dobro ───────────────────────────────────────
//
// Duas mensagens do mesmo contato chegando quase juntas passavam as duas pela
// busca — nenhuma achava — e as duas criavam. Medido no kobogo: 8 dos 10 pares
// nasceram na MESMA instância com 57 a 491 MILISSEGUNDOS de diferença. Entre a
// busca e a criação o webhook ainda consulta chatbot, roteamento e agenda, o
// que alarga a janela.
//
// Cada instalação roda UM processo (pm2 `instances: 1`, `exec_mode: fork`),
// então as duas requisições disputam o mesmo event loop: serializar por chave
// aqui fecha o caso inteiro, sem migration e sem depender de índice no banco.
//
// O que fecha a corrida não é a fila, é REFAZER A BUSCA dentro dela: a segunda
// requisição procura depois que a primeira terminou, e então encontra.

const criacoesEmVoo = new Map<string, Promise<unknown>>()

/** Chave da trava: um contato por linha de WhatsApp, que é a regra de identidade. */
export function chaveDoContato(phone: string | null | undefined, instanceName: string | null | undefined): string {
  return `${phoneKey(phone) ?? phone ?? '?'}@${instanceName ?? '-'}`
}

/**
 * Executa `tarefa` com exclusividade para aquele contato.
 *
 * A tarefa DEVE começar procurando o lead de novo — é isso que faz a segunda
 * requisição aproveitar o que a primeira criou em vez de criar a segunda ficha.
 */
export async function semFichaEmDobro<T>(chave: string, tarefa: () => Promise<T>): Promise<T> {
  const anterior = criacoesEmVoo.get(chave)
  // Se a anterior falhou, tanto faz: o que importa é que terminou, e a busca
  // desta já enxerga o que aquela tiver gravado.
  if (anterior) await anterior.catch(() => {})

  const atual = tarefa()
  criacoesEmVoo.set(chave, atual)
  try {
    return await atual
  } finally {
    // Só limpa se ninguém entrou depois: senão apagaria a trava de quem está
    // esperando.
    if (criacoesEmVoo.get(chave) === atual) criacoesEmVoo.delete(chave)
  }
}
