// src/services/whatsappChatImport.ts
//
// Importar conversas que já existem no celular conectado (Evolution/QR).
//
// O time comercial atende há meses pelo aparelho; o painel só enxerga o que
// chegou depois de conectar. Aqui listamos o que a instância tem para que o
// operador escolha o que trazer.
//
// Só Evolution: a Cloud API não expõe histórico anterior à conexão — a Meta
// simplesmente não entrega conversa antiga.

import { prisma } from '../lib/prisma.js'
import { phoneKey, onlyDigits } from '../lib/phone.js'

export interface ChatDoAparelho {
  remoteJid: string
  /** Telefone em dígitos; null em grupo e em @lid. */
  telefone: string | null
  nome: string | null
  fotoUrl: string | null
  isGroup: boolean
  naoLidas: number
  ultimaMensagemEm: string | null
  previa: string | null
  /** Lead já existente no painel com este telefone. */
  leadId: number | null
  leadNome: string | null
  /** Quantas mensagens deste contato já estão no painel. */
  mensagensNoPainel: number
  /** Falso em grupo e em @lid sem telefone conhecido. */
  importavel: boolean
}

/**
 * Telefone real do chat.
 *
 * 41% dos chats do beyond chegam como "<numero>@lid" — o identificador de
 * privacidade do WhatsApp, que NÃO é telefone. Tratá-lo como número gera lead
 * com "75063445454910" no lugar do celular. O telefone verdadeiro vem em
 * `lastMessage.key.remoteJidAlt`; sem ele, o chat não é importável.
 */
function telefoneDoChat(c: any): string | null {
  const jid = String(c?.remoteJid || '')
  if (jid.endsWith('@g.us')) return null
  if (!jid.includes('@lid')) return onlyDigits(jid.split('@')[0]) || null
  const alt = c?.lastMessage?.key?.remoteJidAlt
  if (alt && !String(alt).includes('@lid')) return onlyDigits(String(alt).split('@')[0]) || null
  return null
}

/** Texto legível da última mensagem, seja qual for o tipo. */
function previaDe(lastMessage: any): string | null {
  if (!lastMessage || typeof lastMessage !== 'object') return null
  const m = lastMessage.message || {}
  if (m.conversation) return String(m.conversation).slice(0, 120)
  if (m.extendedTextMessage?.text) return String(m.extendedTextMessage.text).slice(0, 120)
  const tipo = lastMessage.messageType || Object.keys(m)[0] || ''
  const rotulo: Record<string, string> = {
    imageMessage: '📷 Imagem',
    videoMessage: '🎥 Vídeo',
    audioMessage: '🎤 Áudio',
    stickerMessage: '💟 Figurinha',
    documentMessage: '📎 Documento',
    locationMessage: '📍 Localização',
    contactMessage: '👤 Contato',
  }
  return rotulo[tipo] || (tipo ? `(${tipo})` : null)
}

/**
 * Lista os chats da instância, já cruzados com a base.
 *
 * O cruzamento é o que dá valor à tela: sem ele o operador não sabe o que já
 * tem no painel e acabaria reimportando (ou duplicando) o que já existe.
 */
export async function listarChatsDoAparelho(instanceName: string): Promise<ChatDoAparelho[]> {
  const { getProviderForChannel } = await import('./whatsappProvider.js')
  const { provider } = await getProviderForChannel(`evolution:${instanceName}`)
  if (provider.providerName !== 'evolution') {
    throw new Error('Importar conversas só funciona em número conectado por QR Code (Evolution).')
  }

  const brutos = await (provider as any).findChats()
  const lista: any[] = Array.isArray(brutos) ? brutos : (brutos?.chats ?? [])

  // Um SELECT por chat seria centenas de queries; resolve-se em duas.
  const chaves = new Map<string, string>()
  for (const c of lista) {
    const jid = String(c?.remoteJid || '')
    const tel = telefoneDoChat(c)
    if (!jid || !tel) continue
    const k = phoneKey(tel)
    if (k) chaves.set(jid, k)
  }

  const leads = chaves.size
    ? await prisma.lead.findMany({
        where: { phoneKey: { in: [...new Set(chaves.values())] } },
        select: { id: true, nome: true, phoneKey: true },
      })
    : []
  const porChave = new Map(leads.map((l) => [l.phoneKey!, l]))

  const contagens = leads.length
    ? await prisma.message.groupBy({
        by: ['leadId'],
        where: { leadId: { in: leads.map((l) => l.id) } },
        _count: { _all: true },
      })
    : []
  const porLead = new Map(contagens.map((c) => [c.leadId, c._count._all]))

  return lista.map((c): ChatDoAparelho => {
    const jid = String(c?.remoteJid || '')
    const isGroup = jid.endsWith('@g.us')
    const k = chaves.get(jid) || null
    const lead = k ? porChave.get(k) ?? null : null
    return {
      remoteJid: jid,
      telefone: telefoneDoChat(c),
      nome: c?.pushName || null,
      fotoUrl: c?.profilePicUrl || null,
      isGroup,
      naoLidas: Number(c?.unreadCount || 0),
      ultimaMensagemEm: c?.updatedAt ? new Date(c.updatedAt).toISOString() : null,
      previa: previaDe(c?.lastMessage),
      leadId: lead?.id ?? null,
      leadNome: lead?.nome ?? null,
      mensagensNoPainel: lead ? porLead.get(lead.id) ?? 0 : 0,
      // Grupo e chat sem telefone resolvível não têm como virar conversa de
      // atendimento — a UI mostra, mas não deixa selecionar.
      importavel: !isGroup && !!telefoneDoChat(c),
    }
  }).sort((a, b) => (b.ultimaMensagemEm || '').localeCompare(a.ultimaMensagemEm || ''))
}

// ── Agenda de contatos ─────────────────────────────────────────────────────

export interface ContatoDaAgenda {
  remoteJid: string
  telefone: string | null
  nome: string | null
  fotoUrl: string | null
  isGroup: boolean
  leadId: number | null
  importavel: boolean
}

/**
 * Agenda do aparelho.
 *
 * Atenção ao rendimento real: no beyond são 668 contatos, dos quais **540 são
 * `@lid`** — e aqui, diferente da lista de conversas, não há `lastMessage` de
 * onde tirar o `remoteJidAlt`. Ou seja, a maioria não tem telefone recuperável
 * e não pode virar lead. A tela precisa dizer isso, senão o operador acha que
 * vai importar 668 e recebe uma fração.
 */
export async function listarContatosDaAgenda(instanceName: string): Promise<ContatoDaAgenda[]> {
  const { getProviderForChannel } = await import('./whatsappProvider.js')
  const { provider } = await getProviderForChannel(`evolution:${instanceName}`)
  if (provider.providerName !== 'evolution') {
    throw new Error('A agenda só existe em número conectado por QR Code (Evolution).')
  }

  const lista: any[] = await (provider as any).findContacts()

  const chaves = new Map<string, string>()
  for (const c of lista) {
    const jid = String(c?.remoteJid || '')
    if (!jid || jid.endsWith('@g.us') || jid.includes('@lid')) continue
    const k = phoneKey(onlyDigits(jid.split('@')[0]))
    if (k) chaves.set(jid, k)
  }

  const leads = chaves.size
    ? await prisma.lead.findMany({
        where: { phoneKey: { in: [...new Set(chaves.values())] } },
        select: { id: true, phoneKey: true },
      })
    : []
  const porChave = new Map(leads.map((l) => [l.phoneKey!, l.id]))

  return lista.map((c): ContatoDaAgenda => {
    const jid = String(c?.remoteJid || '')
    const isGroup = jid.endsWith('@g.us') || !!c?.isGroup
    const k = chaves.get(jid) || null
    const tel = k ? onlyDigits(jid.split('@')[0]) : null
    return {
      remoteJid: jid,
      telefone: tel,
      nome: c?.pushName || null,
      fotoUrl: c?.profilePicUrl || null,
      isGroup,
      leadId: k ? porChave.get(k) ?? null : null,
      importavel: !isGroup && !!tel,
    }
  })
}
