// src/services/mentionResolver.ts
//
// Troca as menções cruas do WhatsApp por nomes legíveis.
//
// Em grupo, mencionar alguém grava no corpo da mensagem o identificador, não o
// nome: "@111123873398881 @63874837565527, conseguem um call às 14h?". Quem lê
// no painel não faz ideia de quem são — e esses números não são telefone, são
// LID (identificador de privacidade).
//
// A resolução acontece na LEITURA, não na gravação: o texto original fica
// intacto no banco (é o que o contato realmente recebeu), e mensagens antigas
// passam a aparecer corretas sem precisar de migração.

import { prisma } from '../lib/prisma.js'

/** LID/telefone → nome. Vive no processo; nomes mudam pouco. */
const cacheNome = new Map<string, string>()
const CACHE_MAX = 5000

/** Menção do WhatsApp: @ seguido de 8+ dígitos (LID ou telefone com DDI). */
const RE_MENCAO = /@(\d{8,})/g

function guardar(chave: string, nome: string) {
  if (cacheNome.size > CACHE_MAX) cacheNome.clear()
  cacheNome.set(chave, nome)
}

/**
 * Nome de quem foi mencionado.
 *
 * Procura em três lugares, do mais confiável ao menos: lead com aquele LID, lead
 * com aquele telefone, e o nome que o WhatsApp mandou em alguma mensagem dessa
 * pessoa (pushName gravado em senderName).
 */
async function nomeDe(id: string): Promise<string | null> {
  const cached = cacheNome.get(id)
  if (cached !== undefined) return cached || null

  // 1. LID conhecido
  const porLid = await prisma.lead.findFirst({
    where: { waLid: { contains: id } },
    select: { nome: true },
  }).catch(() => null)
  if (porLid?.nome) { guardar(id, porLid.nome); return porLid.nome }

  // 2. Telefone (a menção pode vir como número real em conversa antiga)
  const porFone = await prisma.lead.findFirst({
    where: { OR: [{ whatsapp: id }, { phoneKey: id }] },
    select: { nome: true },
  }).catch(() => null)
  if (porFone?.nome) { guardar(id, porFone.nome); return porFone.nome }

  // 3. Última cartada: o nome do perfil que veio junto de alguma mensagem dessa
  //    pessoa em grupo. Não é dado de cadastro, mas é melhor que um número.
  const porMensagem = await prisma.message.findFirst({
    where: { senderName: { not: null }, externalId: { not: null }, body: { contains: id } },
    select: { senderName: true },
    orderBy: { id: 'desc' },
  }).catch(() => null)
  if (porMensagem?.senderName && !/^\d+$/.test(porMensagem.senderName)) {
    guardar(id, porMensagem.senderName)
    return porMensagem.senderName
  }

  guardar(id, '')
  return null
}

/**
 * Resolve as menções de um texto.
 *
 * Sem nome conhecido, encurta o identificador em vez de deixar 15 dígitos na
 * tela: "@111123873398881" vira "@contato". Um número que não é telefone nem
 * ajuda a identificar ninguém só polui a leitura.
 */
export async function resolverMencoes(texto: string | null | undefined): Promise<string> {
  const t = texto || ''
  const ids = [...new Set([...t.matchAll(RE_MENCAO)].map((m) => m[1]!))]
  if (!ids.length) return t

  const nomes = new Map<string, string | null>()
  for (const id of ids) nomes.set(id, await nomeDe(id))

  return t.replace(RE_MENCAO, (_all, id: string) => {
    const nome = nomes.get(id)
    if (nome) return `@${nome}`
    // Telefone de verdade continua legível como telefone; LID não.
    return id.length <= 13 ? `@${id}` : '@contato'
  })
}

/** Aplica a resolução a uma lista de mensagens (uma passada, cache quente). */
export async function resolverMencoesEmLote<T extends { body: string | null }>(msgs: T[]): Promise<T[]> {
  const algumaMencao = msgs.some((m) => m.body && RE_MENCAO.test(m.body))
  RE_MENCAO.lastIndex = 0
  if (!algumaMencao) return msgs
  const out: T[] = []
  for (const m of msgs) out.push({ ...m, body: await resolverMencoes(m.body) })
  return out
}
