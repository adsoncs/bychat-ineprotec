// src/services/groupOutboundLog.ts
//
// Registra na conversa do PAINEL as mensagens que o sistema manda para um GRUPO
// do WhatsApp.
//
// Aviso de novo lead, agendamento, chamado de helpdesk: tudo isso sai por
// `provider.sendText(<jid do grupo>, ...)` e aparecia só no WhatsApp. No painel,
// a conversa do grupo mostrava apenas o que os OUTROS falavam — como se o
// sistema nunca tivesse escrito ali.
//
// Isso não é só um buraco no histórico: quando alguém do grupo responde citando
// um desses avisos, a citação chega com o id de uma mensagem que o painel não
// tem, e a resposta aparece sem o trecho citado. Foi assim que o problema
// apareceu — "respondi no WhatsApp Web e no Conversas não veio marcado".

import { prisma } from '../lib/prisma.js'

/** Rótulo de quem falou, para a bolha não ficar anônima na conversa do grupo. */
const AUTOR_PADRAO = 'Aviso automático'

/**
 * Grava a mensagem enviada a um grupo. Silenciosa e best-effort: se o destino
 * não é grupo, ou o grupo não tem conversa no painel, não faz nada — e nunca
 * derruba o envio, que já aconteceu.
 */
export async function registrarSaidaParaGrupo(opts: {
  /** Destino usado no envio. Só JID de grupo (`...@g.us`) interessa aqui. */
  destino: string
  texto: string
  /** `key.id` devolvido pelo provedor — é o que liga citações futuras a esta. */
  externalId?: string | null
  instanceName?: string | null
  autor?: string
}): Promise<void> {
  try {
    const jid = String(opts.destino || '')
    if (!jid.endsWith('@g.us')) return
    const texto = String(opts.texto || '')
    if (!texto.trim()) return

    const lead = await prisma.lead.findFirst({
      where: { groupJid: jid },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    })
    // Grupo que ninguém acompanha pelo painel: não inventamos a conversa.
    if (!lead) return

    // Reentrega/retry não duplica a bolha.
    if (opts.externalId) {
      const jaTem = await prisma.message.findFirst({
        where: { externalId: opts.externalId },
        select: { id: true },
      })
      if (jaTem) return
    }

    await prisma.message.create({
      data: {
        leadId: lead.id,
        fromMe: true,
        body: texto,
        mediaType: 'text',
        isInternal: false,
        provider: 'evolution',
        evolutionInstance: opts.instanceName ?? null,
        senderName: opts.autor || AUTOR_PADRAO,
        externalId: opts.externalId ?? null,
        ack: 1,
        timestamp: new Date(),
      },
    })

    // Mensagem nossa move a conversa no tempo, mas NÃO cria não lida: ninguém
    // precisa "ler" o que o próprio sistema escreveu.
    await prisma.lead.update({
      where: { id: lead.id },
      data: { lastMessageAt: new Date(), lastActivityAt: new Date() },
    }).catch(() => {})
  } catch (e: any) {
    console.warn('[groupOutboundLog] não registrei a saída no grupo:', e?.message)
  }
}
