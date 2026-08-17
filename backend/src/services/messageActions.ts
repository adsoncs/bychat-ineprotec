// src/services/messageActions.ts
//
// O que dá para fazer com uma mensagem DEPOIS de enviada: editar, apagar (só
// para mim ou para todos), encaminhar e reagir — mais o "marcar conversa como
// não lida", que é da conversa e não da mensagem, mas nasce do mesmo lugar na
// tela (o operador abriu sem querer e quer desfazer).
//
// Três coisas valem para o módulo inteiro:
//
//  1. **Apagar para mim é local, e é assim no WhatsApp também.** Esse apagar
//     nunca sai do aparelho: o contato continua com a mensagem. Aqui ele só
//     esconde a bolha (`isDeleted`), e a UI diz isso com todas as letras — para
//     ninguém achar que "sumiu para o cliente".
//  2. **A API Oficial da Meta não edita nem apaga.** Quem está numa conexão
//     Cloud API recebe o motivo em vez de um botão que finge funcionar; ver
//     `CloudApiProvider.editText`.
//  3. **A janela de 15 minutos é do WhatsApp, não nossa.** Passou disso, o
//     próprio WhatsApp recusa a edição — então barramos antes de gastar a
//     chamada e mostramos quanto tempo faltava.

import { prisma } from '../lib/prisma.js'
import { logEvent, EVENT_TYPES } from './leadHistory.js'
import { broadcastRealtimeEvent } from '../routes/realtime.js'
import {
  createEvolutionProviderFor,
  getProviderForChannel,
  type WhatsAppProvider,
  type WhatsAppMessageRef,
} from './whatsappProvider.js'

/** O WhatsApp aceita editar até 15 minutos depois do envio. */
export const EDIT_WINDOW_MINUTES = 15

export interface ActionActor {
  userId: number
  name?: string | null
  email?: string | null
}

export class MessageActionError extends Error {
  status: number
  code: string
  constructor(message: string, status = 400, code = 'MESSAGE_ACTION') {
    super(message)
    this.status = status
    this.code = code
  }
}

type MessageRow = NonNullable<Awaited<ReturnType<typeof carregarMensagem>>>

async function carregarMensagem(messageId: number, leadId: number) {
  return prisma.message.findFirst({
    where: { id: messageId, leadId },
    include: {
      lead: {
        select: {
          id: true, nome: true, whatsapp: true, waLid: true,
          isGroup: true, groupJid: true, unreadMessages: true,
        },
      },
    },
  })
}

/** Conversa onde a mensagem vive, no formato que o WhatsApp entende. Grupo tem
 *  JID próprio; contato que só apareceu por LID é endereçado pelo LID. */
function chatDaMensagem(msg: MessageRow): string {
  const lead = msg.lead
  if (lead.isGroup && lead.groupJid) return lead.groupJid
  if (lead.whatsapp) return lead.whatsapp
  if (lead.waLid) return lead.waLid
  throw new MessageActionError('Esta conversa não tem número nem grupo — não dá para agir no WhatsApp.', 409, 'NO_CHAT')
}

/** Provider do canal por onde a mensagem SAIU. Editar/apagar exigem a mesma
 *  conexão que enviou: outra instância não conhece aquela mensagem. */
async function providerDaMensagem(msg: MessageRow): Promise<WhatsAppProvider> {
  if (msg.provider === 'cloud_api' && msg.cloudApiConnectionId) {
    const { provider } = await getProviderForChannel(`cloud:${msg.cloudApiConnectionId}`)
    return provider
  }
  if (msg.evolutionInstance) return createEvolutionProviderFor(msg.evolutionInstance)
  throw new MessageActionError(
    'Não dá para saber por qual número esta mensagem foi enviada (registro antigo). Só é possível apagar da sua tela.',
    409, 'NO_CHANNEL',
  )
}

function refDaMensagem(msg: MessageRow): WhatsAppMessageRef {
  if (!msg.externalId) {
    throw new MessageActionError(
      'Esta mensagem não tem identificador do WhatsApp (foi registrada só aqui). Só é possível apagar da sua tela.',
      409, 'NO_EXTERNAL_ID',
    )
  }
  return {
    externalId: msg.externalId,
    chat: chatDaMensagem(msg),
    fromMe: msg.fromMe,
    // Em grupo, quem enviou — o WhatsApp precisa disso para achar a mensagem
    // de outra pessoa. Na mensagem nossa e na conversa individual, não.
    participant: msg.lead.isGroup && !msg.fromMe ? (msg.senderJid ?? undefined) : undefined,
  }
}

/** Avisa as telas abertas. Sem isto, quem está com a conversa aberta em outra
 *  aba continua vendo o texto antigo até dar refresh. */
function avisarTelas(leadId: number, tipo: string, payload: Record<string, unknown>) {
  try {
    broadcastRealtimeEvent({ type: tipo, payload, scope: { leadId } })
  } catch { /* realtime é enfeite, não pode derrubar a ação */ }
}

function minutosDesde(d: Date): number {
  return (Date.now() - new Date(d).getTime()) / 60_000
}

// ── Editar ────────────────────────────────────────────────

export async function editarMensagem(
  leadId: number, messageId: number, novoTexto: string, actor: ActionActor,
) {
  const msg = await carregarMensagem(messageId, leadId)
  if (!msg) throw new MessageActionError('Mensagem não encontrada nesta conversa.', 404, 'NOT_FOUND')
  if (!msg.fromMe) throw new MessageActionError('Só dá para editar mensagem enviada por você.', 403, 'NOT_MINE')
  if (msg.deletedForAll || msg.isDeleted) throw new MessageActionError('Esta mensagem foi apagada.', 409, 'DELETED')
  if (msg.mediaType && msg.mediaType !== 'text') {
    throw new MessageActionError('O WhatsApp só deixa editar mensagem de texto. Para mídia, apague e envie de novo.', 400, 'NOT_TEXT')
  }
  const texto = String(novoTexto ?? '').trim()
  if (!texto) throw new MessageActionError('O texto não pode ficar vazio. Para tirar a mensagem, use Apagar.', 400, 'EMPTY')
  if (texto === (msg.body ?? '')) return { ok: true as const, unchanged: true as const }

  const passados = minutosDesde(msg.timestamp)
  if (passados > EDIT_WINDOW_MINUTES) {
    throw new MessageActionError(
      `O WhatsApp só permite editar até ${EDIT_WINDOW_MINUTES} minutos depois do envio, e esta mensagem tem ${Math.floor(passados)}. Apague para todos e envie de novo.`,
      409, 'EDIT_WINDOW',
    )
  }

  // A nota interna nunca foi para o WhatsApp: editar é só no banco.
  if (!msg.isInternal) {
    const provider = await providerDaMensagem(msg)
    if (!provider.editText) {
      throw new MessageActionError('Este canal não permite editar mensagens.', 409, 'UNSUPPORTED')
    }
    await provider.editText(refDaMensagem(msg), texto)
  }

  const atualizada = await prisma.message.update({
    where: { id: msg.id },
    data: {
      body: texto,
      editedAt: new Date(),
      // Só a PRIMEIRA edição guarda o original: é o que o operador escreveu de
      // fato para o cliente, e é isso que uma auditoria quer ver.
      ...(msg.originalBody ? {} : { originalBody: msg.body }),
    },
  })

  logEvent({
    leadId, type: EVENT_TYPES.MESSAGE_SENT, category: 'operator',
    title: 'Mensagem editada',
    description: `De "${(msg.body ?? '').slice(0, 120)}" para "${texto.slice(0, 120)}"`,
    source: 'panel', channel: 'whatsapp',
    userId: actor.userId, userName: actor.name || actor.email || undefined,
  })
  avisarTelas(leadId, 'message.edited', { id: msg.id, body: texto, editedAt: atualizada.editedAt })
  return { ok: true as const, message: atualizada }
}

// ── Apagar ────────────────────────────────────────────────

export type DeleteScope = 'me' | 'all'

export async function apagarMensagem(
  leadId: number, messageId: number, scope: DeleteScope, actor: ActionActor,
) {
  const msg = await carregarMensagem(messageId, leadId)
  if (!msg) throw new MessageActionError('Mensagem não encontrada nesta conversa.', 404, 'NOT_FOUND')

  if (scope === 'all') {
    if (!msg.fromMe) {
      throw new MessageActionError(
        'Só dá para apagar para todos as mensagens que você enviou. A do contato só some da sua tela.',
        403, 'NOT_MINE',
      )
    }
    if (!msg.isInternal) {
      const provider = await providerDaMensagem(msg)
      if (!provider.deleteForEveryone) {
        throw new MessageActionError('Este canal não permite apagar para todos.', 409, 'UNSUPPORTED')
      }
      await provider.deleteForEveryone(refDaMensagem(msg))
    }
  }

  const atualizada = await prisma.message.update({
    where: { id: msg.id },
    data: {
      isDeleted: true,
      deletedAt: new Date(),
      deletedByUserId: actor.userId,
      ...(scope === 'all' ? { deletedForAll: true } : {}),
    },
  })

  logEvent({
    leadId, type: EVENT_TYPES.MESSAGE_SENT, category: 'operator',
    title: scope === 'all' ? 'Mensagem apagada para todos' : 'Mensagem apagada da tela',
    description: (msg.body ?? `(${msg.mediaType})`).slice(0, 200),
    source: 'panel', channel: 'whatsapp',
    userId: actor.userId, userName: actor.name || actor.email || undefined,
  })
  avisarTelas(leadId, 'message.deleted', { id: msg.id, scope })
  return { ok: true as const, message: atualizada }
}

// ── Encaminhar ────────────────────────────────────────────

export interface ForwardTarget {
  /** Conversa de destino já existente no CRM. */
  leadId: number
}

/** Encaminha para outras conversas passando pelo MESMO caminho de envio do
 *  Conversas (`sendTicketMessage`): assim herda trava de canal, janela de 24h
 *  da Cloud API, bloqueio de grupo e reabertura do ticket. Reenvio de conteúdo,
 *  que é como o WhatsApp Web faz — não existe "forward" na Evolution. */
export async function encaminharMensagem(
  leadId: number, messageId: number, destinos: ForwardTarget[], actor: ActionActor & { role: string },
) {
  const msg = await carregarMensagem(messageId, leadId)
  if (!msg) throw new MessageActionError('Mensagem não encontrada nesta conversa.', 404, 'NOT_FOUND')
  if (msg.deletedForAll) throw new MessageActionError('Esta mensagem foi apagada.', 409, 'DELETED')
  if (!destinos.length) throw new MessageActionError('Escolha ao menos uma conversa de destino.', 400, 'NO_TARGET')
  if (destinos.length > 20) throw new MessageActionError('Dá para encaminhar para até 20 conversas de uma vez.', 400, 'TOO_MANY')

  const { sendTicketMessage } = await import('./ticketMessageSender.js')
  const resultados: Array<{ leadId: number; ok: boolean; erro?: string }> = []

  for (const destino of destinos) {
    try {
      const r = await sendTicketMessage({
        leadId: destino.leadId,
        body: msg.body,
        mediaType: msg.mediaType,
        mediaUrl: msg.mediaUrl,
        mediaName: msg.mediaName,
        // Encaminhada vai como veio: a identificação do operador entraria no
        // meio do conteúdo copiado e descaracterizaria a mensagem original.
        continuacao: true,
        actor: { userId: actor.userId, role: actor.role, name: actor.name ?? null, email: actor.email ?? null },
        origin: 'panel',
      })
      if (!r.ok) {
        // O sender recusa por regra de negócio (janela de 24h fechada, canal
        // travado, grupo na Cloud API) — isso é resposta, não exceção.
        resultados.push({ leadId: destino.leadId, ok: false, erro: r.error })
        continue
      }
      // Marca a cópia como encaminhada para a bolha exibir o selo.
      if (r.message?.id) {
        await prisma.message.update({ where: { id: r.message.id }, data: { isForwarded: true } }).catch(() => {})
      }
      resultados.push({ leadId: destino.leadId, ok: true })
    } catch (err: any) {
      resultados.push({ leadId: destino.leadId, ok: false, erro: err?.message || 'falha no envio' })
    }
  }

  const enviados = resultados.filter((r) => r.ok).length
  logEvent({
    leadId, type: EVENT_TYPES.MESSAGE_SENT, category: 'operator',
    title: `Mensagem encaminhada para ${enviados} conversa(s)`,
    description: (msg.body ?? `(${msg.mediaType})`).slice(0, 200),
    source: 'panel', channel: 'whatsapp',
    userId: actor.userId, userName: actor.name || actor.email || undefined,
  })
  return { ok: true as const, enviados, resultados }
}

// ── Reagir ────────────────────────────────────────────────

export interface Reacao { emoji: string; fromMe: boolean; senderName?: string | null; at: string }

export async function reagirMensagem(
  leadId: number, messageId: number, emoji: string, actor: ActionActor,
) {
  const msg = await carregarMensagem(messageId, leadId)
  if (!msg) throw new MessageActionError('Mensagem não encontrada nesta conversa.', 404, 'NOT_FOUND')
  if (msg.isInternal) throw new MessageActionError('Nota interna não vai para o WhatsApp, então não recebe reação.', 400, 'INTERNAL')

  const provider = await providerDaMensagem(msg)
  if (!provider.react) throw new MessageActionError('Este canal não permite reagir a mensagens.', 409, 'UNSUPPORTED')
  await provider.react(refDaMensagem(msg), emoji)

  // Estado local: uma reação NOSSA por mensagem, igual ao WhatsApp. Emoji
  // vazio é como o WhatsApp remove a reação.
  const atuais = (Array.isArray(msg.reactions) ? msg.reactions : []) as unknown as Reacao[]
  const semNossa = atuais.filter((r) => !r.fromMe)
  const novas = emoji
    ? [...semNossa, { emoji, fromMe: true, senderName: actor.name ?? null, at: new Date().toISOString() }]
    : semNossa

  const atualizada = await prisma.message.update({
    where: { id: msg.id },
    data: { reactions: novas as any },
  })
  avisarTelas(leadId, 'message.reacted', { id: msg.id, reactions: novas })
  return { ok: true as const, message: atualizada }
}

// ── Marcar conversa como não lida ─────────────────────────

/** Devolve a conversa ao estado "tem mensagem esperando". Serve para o caso
 *  clássico de abrir por engano e não querer perder o item da fila.
 *
 *  Também empurra a marcação para o WhatsApp quando o canal deixa (Evolution),
 *  senão a conversa continuaria lida no celular do operador. */
export async function marcarConversaNaoLida(leadId: number, actor: ActionActor) {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, unreadMessages: true, whatsapp: true, waLid: true, isGroup: true, groupJid: true },
  })
  if (!lead) throw new MessageActionError('Conversa não encontrada.', 404, 'NOT_FOUND')

  // Pelo menos 1 para o badge aparecer; se já havia não lidas, respeita.
  const total = Math.max(1, lead.unreadMessages ?? 0)
  await prisma.lead.update({ where: { id: leadId }, data: { unreadMessages: total } })

  // Espelha no WhatsApp usando a última mensagem RECEBIDA — é dela que o
  // WhatsApp precisa para saber a partir de onde a conversa está não lida.
  const ultima = await prisma.message.findFirst({
    where: { leadId, fromMe: false, externalId: { not: null } },
    orderBy: { timestamp: 'desc' },
    include: { lead: { select: { id: true, nome: true, whatsapp: true, waLid: true, isGroup: true, groupJid: true, unreadMessages: true } } },
  })
  let espelhado = false
  if (ultima) {
    try {
      const provider = await providerDaMensagem(ultima as MessageRow)
      if (provider.markChatUnread) {
        await provider.markChatUnread(refDaMensagem(ultima as MessageRow))
        espelhado = provider.providerName === 'evolution'
      }
    } catch { /* o que importa é o painel; o espelho é bônus */ }
  }

  logEvent({
    leadId, type: EVENT_TYPES.OPERATOR_MARKED_READ, category: 'operator',
    title: 'Conversa marcada como não lida',
    source: 'panel',
    userId: actor.userId, userName: actor.name || actor.email || undefined,
  })
  avisarTelas(leadId, 'ticket.unread', { leadId, unreadMessages: total })
  return { ok: true as const, unreadMessages: total, espelhadoNoWhatsapp: espelhado }
}
