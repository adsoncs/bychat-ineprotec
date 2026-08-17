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
import { telefoneComoNome } from './leadDisplayName.js'

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
  /** Quando a última sincronização deste chat terminou com sucesso. */
  sincronizadoEm: string | null
  /** Situação da última sincronização (null = nunca sincronizado). */
  sincronizacaoStatus: 'pending' | 'running' | 'done' | 'failed' | 'canceled' | null
  /** Quantas mensagens a última sincronização trouxe. */
  ultimaImportacao: number
}

export interface ResumoChats {
  total: number
  importaveis: number
  novos: number
  jaNoPainel: number
  sincronizados: number
  naoSincronizados: number
  grupos: number
  semTelefone: number
  emFila: number
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

  // Histórico de sincronização por chat. É o que permite tirar da lista o que
  // já foi trazido: sem isso o operador reencontra as mesmas conversas todo dia
  // e não sabe quais já resolveu.
  const jids = lista.map((c) => String(c?.remoteJid || '')).filter(Boolean)
  const jobs = jids.length
    ? await prisma.chatImportJob.findMany({
        where: { instanceName, remoteJid: { in: [...new Set(jids)] } },
        select: { remoteJid: true, status: true, finishedAt: true, importadas: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      })
    : []
  // O primeiro de cada JID é o mais recente (a query já vem ordenada).
  const ultimoJob = new Map<string, (typeof jobs)[number]>()
  for (const j of jobs) if (!ultimoJob.has(j.remoteJid)) ultimoJob.set(j.remoteJid, j)

  return lista.map((c): ChatDoAparelho => {
    const jid = String(c?.remoteJid || '')
    const isGroup = jid.endsWith('@g.us')
    const k = chaves.get(jid) || null
    const lead = k ? porChave.get(k) ?? null : null
    const job = ultimoJob.get(jid) ?? null
    return {
      sincronizadoEm: job?.status === 'done' ? (job.finishedAt?.toISOString() ?? null) : null,
      sincronizacaoStatus: (job?.status as ChatDoAparelho['sincronizacaoStatus']) ?? null,
      ultimaImportacao: job?.importadas ?? 0,
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

/** Contagens da lista, para a tela abrir já dizendo o tamanho do trabalho. */
export function resumirChats(chats: ChatDoAparelho[]): ResumoChats {
  return {
    total: chats.length,
    importaveis: chats.filter((c) => c.importavel).length,
    novos: chats.filter((c) => c.importavel && !c.leadId).length,
    jaNoPainel: chats.filter((c) => c.leadId).length,
    sincronizados: chats.filter((c) => !!c.sincronizadoEm).length,
    naoSincronizados: chats.filter((c) => c.importavel && !c.sincronizadoEm).length,
    grupos: chats.filter((c) => c.isGroup).length,
    semTelefone: chats.filter((c) => !c.isGroup && !c.importavel).length,
    emFila: chats.filter((c) => c.sincronizacaoStatus === 'pending' || c.sincronizacaoStatus === 'running').length,
  }
}

/**
 * Acha, no aparelho, a conversa de um telefone.
 *
 * Usado pelo botão de sincronizar dentro da conversa: o painel guarda o
 * telefone do lead, mas o chat na Evolution pode estar sob um `@lid` — casar
 * por `phoneKey` é o único jeito confiável de reencontrá-lo.
 */
export async function encontrarChatDoLead(
  instanceName: string,
  chaveTelefone: string,
): Promise<{ remoteJid: string; nome: string | null; telefone: string; ultimaMensagemEm: string | null } | null> {
  const { getProviderForChannel } = await import('./whatsappProvider.js')
  const { provider } = await getProviderForChannel(`evolution:${instanceName}`)
  if (provider.providerName !== 'evolution') return null

  const brutos = await (provider as any).findChats()
  const lista: any[] = Array.isArray(brutos) ? brutos : (brutos?.chats ?? [])

  for (const c of lista) {
    const tel = telefoneDoChat(c)
    if (!tel) continue
    if (phoneKey(tel) !== chaveTelefone) continue
    return {
      remoteJid: String(c?.remoteJid || ''),
      nome: c?.pushName || null,
      telefone: tel,
      ultimaMensagemEm: c?.updatedAt ? new Date(c.updatedAt).toISOString() : null,
    }
  }
  return null
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
/**
 * Cria leads a partir da agenda, em lote.
 *
 * Antes era um `findFirst` + `create` por contato, e por isso a tela impunha um
 * teto de 500 por vez — quem tinha 3 mil contatos precisava repetir a seleção
 * manualmente. Aqui o de-para de telefones existentes sai em UMA consulta e a
 * escrita vai em `createMany`, o que torna "importar todos" viável.
 */
export async function importarContatosComoLeads(
  contatos: Array<{ telefone: string; nome?: string | null }>,
  origem = 'agenda_aparelho',
): Promise<{ criados: number; jaExistiam: number; ignorados: number }> {
  const { resolveDefaultTeamId } = await import('./teamRouting.js')
  const teamId = await resolveDefaultTeamId().catch(() => null)

  // Dedup dentro do próprio lote: a agenda repete o mesmo número em @lid e em
  // @s.whatsapp.net, e sem isto o createMany criaria dois leads iguais.
  const porChave = new Map<string, { telefone: string; nome: string | null }>()
  let ignorados = 0
  for (const c of contatos) {
    const chave = phoneKey(c.telefone)
    if (!chave) { ignorados++; continue }
    const atual = porChave.get(chave)
    // Entre dois registros do mesmo número, fica o que tem nome.
    if (!atual || (!atual.nome && c.nome)) porChave.set(chave, { telefone: c.telefone, nome: (c.nome || '').trim() || null })
  }

  const chaves = [...porChave.keys()]
  const existentes = new Set<string>()
  for (let i = 0; i < chaves.length; i += 1000) {
    const achados = await prisma.lead.findMany({
      where: { phoneKey: { in: chaves.slice(i, i + 1000) } },
      select: { phoneKey: true },
    })
    for (const l of achados) if (l.phoneKey) existentes.add(l.phoneKey)
  }

  const novos = chaves.filter((k) => !existentes.has(k))
  if (!novos.length) return { criados: 0, jaExistiam: chaves.length, ignorados }

  const uids = await gerarUids(novos.length)

  let criados = 0
  for (let i = 0; i < novos.length; i += 500) {
    const fatia = novos.slice(i, i + 500)
    const dados = fatia.map((chave, j) => {
      const c = porChave.get(chave)!
      return {
        uid: uids[i + j]!,
        nome: c.nome || telefoneComoNome(c.telefone),
        nomeOrigem: c.nome ? 'import' : 'telefone',
        nomeWhatsappAgenda: c.nome,
        whatsapp: onlyDigits(c.telefone),
        phoneKey: chave,
        email: '', empresa: '', scores: {},
        status: 'NOVO',
        source: 'whatsapp_contacts',
        teamId,
        formData: { origem },
      }
    })
    const r = await prisma.lead.createMany({ data: dados as any, skipDuplicates: true })
    criados += r.count
  }

  return { criados, jaExistiam: chaves.length - novos.length, ignorados }
}

/** N uids únicos com uma checagem de colisão só, em vez de uma por lead. */
async function gerarUids(quantos: number): Promise<string[]> {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const sorteia = () => 'LD-' + Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')

  const escolhidos = new Set<string>()
  for (let tentativa = 0; tentativa < 5 && escolhidos.size < quantos; tentativa++) {
    const candidatos = new Set<string>()
    while (candidatos.size < (quantos - escolhidos.size) * 2) candidatos.add(sorteia())
    const lista = [...candidatos]
    const usados = new Set<string>()
    for (let i = 0; i < lista.length; i += 1000) {
      const achados = await prisma.lead.findMany({
        where: { uid: { in: lista.slice(i, i + 1000) } },
        select: { uid: true },
      })
      for (const l of achados) if (l.uid) usados.add(l.uid)
    }
    for (const u of lista) {
      if (escolhidos.size >= quantos) break
      if (!usados.has(u) && !escolhidos.has(u)) escolhidos.add(u)
    }
  }
  // Sobra improvável: completa com carimbo de tempo, que não colide na prática.
  const saida = [...escolhidos]
  while (saida.length < quantos) saida.push(`LD-${Date.now().toString(36).toUpperCase().slice(-4)}${saida.length.toString(36).toUpperCase().padStart(2, '0')}`)
  return saida
}

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
