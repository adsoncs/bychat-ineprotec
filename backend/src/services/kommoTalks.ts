// src/services/kommoTalks.ts
//
// Importa o HISTÓRICO DE CONVERSAS da Kommo para `Message`, com o texto real do
// atendimento — o que estava faltando desde a importação de leads.
//
// Por que existe: `GET /api/v4/events` conta ~104 mil mensagens na conta do
// ineprotec, mas o evento traz só `{id, origin, talk_id}` — nada de texto. O
// conteúdo sai por `GET /api/v4/talks/{talk_id}/messages`, que devolve `text`,
// autor, direção e anexo. Ele exige o escopo `list_external_messages`; ver
// getKommoChatsConfig() em lib/kommoClient.ts.
//
// GOTCHA da varredura: `GET /talks` NÃO lista o histórico. Devolve só ~250
// conversas recentes/abertas e nem sequer manda `_links.next` — quem paginar
// por ali importa os últimos quatro dias e conclui que acabou. Já `/talks/{id}`
// responde para QUALQUER id (testado no talk 103, de abril). Por isso a
// varredura é sequencial por talk_id, de 1 até o topo, e não pela listagem.

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { prisma } from '../lib/prisma.js'
import { uploadsPath } from '../lib/uploadsDir.js'
import { phoneKey } from '../lib/phone.js'
import { getKommoChatsConfig, kommoFetch, type KommoConfig } from '../lib/kommoClient.js'

// Pelo helper, nunca por `process.cwd()`: o cwd muda entre pm2, tsx e script
// solto, e gravar em `backend/uploads` põe o arquivo onde nada é servido — a
// mensagem fica com mediaUrl válida e a URL devolve o HTML do SPA.
const MEDIA_DIR = uploadsPath('kommo-media')
/** Teto por arquivo. Um anexo pendurado não pode travar a varredura inteira. */
const TIMEOUT_MIDIA_MS = 20_000

/**
 * De-para dos tipos da Kommo para os do bychat.
 *
 * A bolha do Conversas só sabe renderizar os tipos da direita; um `picture` cru
 * cairia no ramo de texto e a imagem não apareceria. `location` e `contact` não
 * têm arquivo — viram texto, com o conteúdo descrito no corpo, senão a mensagem
 * fica como uma bolha vazia no meio da conversa.
 */
const TIPOS: Record<string, string> = {
  text: 'text',
  picture: 'image',
  video: 'video',
  voice: 'audio',
  audio: 'audio',
  file: 'document',
  sticker: 'sticker',
  location: 'text',
  contact: 'text',
}

export interface ResultadoTalk {
  talkId: number
  leadId: number | null
  mensagens: number
  novas: number
  midiasBaixadas: number
  /** Motivo de ter pulado, quando pulou. */
  pulou?: 'sem-talk' | 'sem-lead' | 'sem-mensagens'
}

export interface ProgressoImport {
  talksLidos: number
  talksPulados: number
  mensagensNovas: number
  midiasBaixadas: number
  midiasFalharam: number
  erros: number
}

function extDe(nome: string, tipo: string): string {
  const m = /\.([a-z0-9]{2,5})$/i.exec(nome || '')
  if (m) return m[1].toLowerCase()
  return tipo === 'image' ? 'jpg' : tipo === 'video' ? 'mp4' : tipo === 'audio' ? 'ogg' : tipo === 'sticker' ? 'webp' : 'bin'
}

/**
 * Baixa um anexo da Kommo para o disco e devolve a URL local.
 *
 * Os links de `drive-c.kommo.com` são públicos (baixam sem Authorization), mas
 * não são nossos: no dia em que o cliente sair da Kommo, ou se a plataforma
 * passar a expirá-los, o histórico inteiro fica com bolhas quebradas. Como o
 * áudio é 12% das mensagens desse atendimento — e é onde a negociação costuma
 * acontecer — o arquivo vem para cá.
 */
async function baixarAnexo(link: string, fileName: string, tipo: string): Promise<string | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MIDIA_MS)
  try {
    const resp = await fetch(link, { signal: ctrl.signal })
    if (!resp.ok) return null
    const buf = Buffer.from(await resp.arrayBuffer())
    if (!buf.length) return null
    await mkdir(MEDIA_DIR, { recursive: true })
    const nome = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extDe(fileName, tipo)}`
    await writeFile(join(MEDIA_DIR, nome), buf)
    return `/uploads/kommo-media/${nome}`
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Corpo de uma mensagem que não é texto puro, para a bolha não ficar vazia. */
function corpoDescritivo(m: any): string {
  if (m.text) return m.text
  if (m.message_type === 'location') {
    const lat = m.location?.lat ?? m.location?.latitude
    const lon = m.location?.lon ?? m.location?.longitude
    return lat && lon ? `📍 Localização: ${lat}, ${lon}` : '📍 Localização'
  }
  if (m.message_type === 'contact') return `👤 Contato: ${m.contact?.name || 'sem nome'}`
  return ''
}

/**
 * Importa UMA conversa da Kommo.
 *
 * Idempotente por `externalId` (o uuid da mensagem na Kommo): rodar de novo não
 * duplica, e uma varredura interrompida pode ser repetida inteira sem limpeza.
 */
export async function importarTalk(
  talkId: number,
  opts: { baixarMidia?: boolean; cfg?: KommoConfig } = {},
): Promise<ResultadoTalk> {
  const cfg = opts.cfg ?? (await getKommoChatsConfig())
  const baixarMidia = opts.baixarMidia !== false
  const vazio: ResultadoTalk = { talkId, leadId: null, mensagens: 0, novas: 0, midiasBaixadas: 0 }

  const talk = await kommoFetch(`/talks/${talkId}`, cfg).catch(() => null)
  if (!talk?.talk_id) return { ...vazio, pulou: 'sem-talk' }

  // A conversa aponta para o lead pelo id da Kommo; o de-para para o id local
  // já existe desde a importação de leads.
  let leadId: number | null = null
  if (talk.entity_type === 'lead' && talk.entity_id) {
    const map = await prisma.kommoMapping.findFirst({
      where: { entityType: 'lead', kommoId: String(talk.entity_id) },
      select: { localId: true },
    })
    leadId = map?.localId ?? null
  }

  // Conversa ÓRFÃ: existe na Kommo, tem mensagens, mas `entity_id` é null — o
  // atendimento aconteceu sem que ninguém abrisse um lead. Exigir lead aqui
  // descartaria a conversa inteira em silêncio; o contato ainda é um caminho.
  if (!leadId && talk.contact_id) {
    const contato = await prisma.kommoMapping.findFirst({
      where: { entityType: 'contact', kommoId: String(talk.contact_id) },
      select: { localId: true, meta: true },
    })
    // `localId` 0 é o contato que nunca virou lead — não é id, é ausência.
    if (contato?.localId) leadId = contato.localId
    else {
      // Última tentativa pelo telefone guardado no de-para dos contatos: o
      // mesmo número costuma já existir como lead, criado por outro caminho.
      const tel = (contato?.meta as any)?.phone
      const chave = phoneKey(tel)
      if (chave) {
        const lead = await prisma.lead.findFirst({ where: { phoneKey: chave }, select: { id: true } })
        leadId = lead?.id ?? null
      }
    }
  }
  if (!leadId) return { ...vazio, pulou: 'sem-lead' }

  // Junta as páginas antes de gravar: a ordem de chegada da Kommo não é
  // cronológica, e a citação/ordenação da conversa depende do timestamp.
  const msgs: any[] = []
  for (let page = 1; ; page++) {
    const d = await kommoFetch(`/talks/${talkId}/messages?limit=250&page=${page}`, cfg)
    const lote = d?._embedded?.messages ?? []
    msgs.push(...lote)
    if (!d?._links?.next) break
  }
  if (!msgs.length) return { ...vazio, leadId, pulou: 'sem-mensagens' }

  let novas = 0
  let midiasBaixadas = 0
  for (const m of msgs) {
    const externalId = String(m.id)
    const jaTem = await prisma.message.findFirst({ where: { externalId }, select: { id: true } })
    if (jaTem) continue

    const mediaType = TIPOS[m.message_type] ?? 'text'
    let mediaUrl: string | null = null
    const anexo = m.attachment
    if (anexo?.link && mediaType !== 'text') {
      if (baixarMidia) {
        mediaUrl = await baixarAnexo(anexo.link, anexo.file_name || '', mediaType)
        if (mediaUrl) midiasBaixadas++
      }
      // Sem download (ou download falho) fica o link da Kommo: bolha quebrada é
      // pior do que bolha que depende de terceiro.
      if (!mediaUrl) mediaUrl = anexo.link
    }

    await prisma.message.create({
      data: {
        leadId,
        fromMe: m.type === 'outgoing',
        body: corpoDescritivo(m),
        mediaType,
        mediaUrl,
        mediaName: anexo?.file_name ?? null,
        // Quem falou: consultora, bot ou o próprio cliente. É o que faz o
        // histórico importado valer como registro de atendimento.
        senderName: m.author?.name ?? null,
        ack: m.delivery_status === 'read' ? 3 : m.delivery_status === 'delivered' ? 2 : 1,
        provider: 'kommo',
        externalId,
        timestamp: new Date(m.created_at * 1000),
      },
    })
    novas++
  }

  // ── Sem isto a conversa é importada e NÃO APARECE ──────────────────────────
  // As caixas do módulo Conversas não olham `Message`: filtram o LEAD por
  // `lastMessageAt`, `conversationOpenedAt` e `conversationClosedAt`. Com os
  // três em NULL a conversa não cai em caixa nenhuma — nem na aba "Todos", que
  // é a união das outras — e a lista fica vazia com as mensagens gravadas.
  //
  // O histórico entra como RESOLVIDO, mesmo o que a Kommo tem como `in_work`:
  // isto é registro do que já aconteceu lá, não atendimento em curso aqui.
  // Despejar 9 mil conversas na fila de quem atende seria mudar o trabalho do
  // time sem ninguém ter pedido.
  const ultima = msgs.reduce((max, m) => Math.max(max, Number(m.created_at) || 0), 0)
  const fim = new Date(ultima * 1000)
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { lastMessageAt: true, conversationOpenedAt: true, conversationClosedAt: true },
  })
  if (lead) {
    const data: Record<string, unknown> = {}
    // Nunca puxa a conversa para trás: um atendimento de hoje no WhatsApp vale
    // mais que a data do histórico importado.
    if (!lead.lastMessageAt || lead.lastMessageAt < fim) data.lastMessageAt = fim
    // Só fecha o que não tem atendimento vivo no bychat — fechar uma conversa
    // aberta tiraria da fila alguém que está sendo atendido agora.
    if (!lead.conversationOpenedAt && !lead.conversationClosedAt) data.conversationClosedAt = fim
    if (Object.keys(data).length) await prisma.lead.update({ where: { id: leadId }, data })
  }

  await prisma.kommoMapping.upsert({
    where: { entityType_kommoId: { entityType: 'talk', kommoId: String(talkId) } },
    create: {
      entityType: 'talk',
      kommoId: String(talkId),
      localId: leadId,
      meta: { chatId: talk.chat_id, origin: talk.origin, mensagens: msgs.length },
      syncedAt: new Date(),
    },
    update: { localId: leadId, meta: { chatId: talk.chat_id, origin: talk.origin, mensagens: msgs.length }, syncedAt: new Date() },
  })

  return { talkId, leadId, mensagens: msgs.length, novas, midiasBaixadas }
}

/**
 * Descobre o maior talk_id da conta.
 *
 * `/talks` só entrega os recentes — mas é justamente o recente que tem o maior
 * id, então serve como teto da varredura. A margem cobre conversas abertas
 * enquanto a importação roda.
 */
export async function descobrirTopoDeTalks(cfg?: KommoConfig): Promise<number> {
  const config = cfg ?? (await getKommoChatsConfig())
  const d = await kommoFetch('/talks?limit=250', config)
  const talks: any[] = d?._embedded?.talks ?? []
  const topo = talks.reduce((max, t) => Math.max(max, Number(t.talk_id) || 0), 0)
  return topo + 50
}

/**
 * Varre o histórico inteiro, de `de` até `ate` (inclusive).
 *
 * Sequencial de propósito: a Kommo trabalha em ~7 req/s por conta e a varredura
 * inteira já consome quase todo esse teto. Paralelizar aqui derrubaria junto a
 * sync incremental de leads, que roda de 15 em 15 minutos na mesma credencial.
 */
export async function importarTalks(opts: {
  de?: number
  ate?: number
  baixarMidia?: boolean
  onProgresso?: (p: ProgressoImport & { talkAtual: number }) => void
} = {}): Promise<ProgressoImport> {
  const cfg = await getKommoChatsConfig()
  const de = opts.de ?? 1
  const ate = opts.ate ?? (await descobrirTopoDeTalks(cfg))

  const p: ProgressoImport = { talksLidos: 0, talksPulados: 0, mensagensNovas: 0, midiasBaixadas: 0, midiasFalharam: 0, erros: 0 }
  for (let id = de; id <= ate; id++) {
    try {
      const r = await importarTalk(id, { baixarMidia: opts.baixarMidia, cfg })
      if (r.pulou) p.talksPulados++
      else {
        p.talksLidos++
        p.mensagensNovas += r.novas
        p.midiasBaixadas += r.midiasBaixadas
      }
    } catch {
      p.erros++
    }
    if (opts.onProgresso && id % 25 === 0) opts.onProgresso({ ...p, talkAtual: id })
  }
  return p
}
