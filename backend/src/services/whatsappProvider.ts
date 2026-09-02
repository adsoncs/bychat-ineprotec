// src/services/whatsappProvider.ts
// Abstração de provider WhatsApp: Evolution API vs Cloud API Oficial

import { prisma } from '../lib/prisma.js'
import { Prisma } from '@prisma/client'
import { channelForUserTeams, userTeamIds } from './channelTeams.js'
import { titularesDeGrupos } from './whatsappGroups.js'
import { humanizeWhatsAppError } from '../lib/whatsappErrors.js'
import {
  sendTextMessage,
  sendMediaMessage,
  sendTemplateMessage,
  sendInteractiveMessage,
  sendReactionMessage,
  decryptToken,
  normalizePhone,
} from './cloudApi.js'

// Se o identificador já for um JID completo (ex.: "273228723392569@lid"), preserva.
// Caso contrário, normaliza como telefone (só dígitos), que o Evolution trata como @s.whatsapp.net.
//
// Importante: leads frequentemente têm `whatsapp` salvo SEM o DDI 55 (ex.: "62991138484"
// pra um número de Goiânia). O Evolution rejeita com `exists: false` quando o número
// chega sem DDI internacional. ensureBrazilDdi() detecta números brasileiros (10 ou 11
// dígitos) e prefixa "55"; números que já vêm com 12-13 dígitos começando em 55, ou com
// outro DDI, passam direto.
function ensureBrazilDdi(digits: string): string {
  // Número BR sem DDI (10 = fixo DDD+8d, 11 = celular DDD+9d)
  if (digits.length === 10 || digits.length === 11) return `55${digits}`
  return digits
}

function toEvoNumber(identifier: string): string {
  if (!identifier) return ''
  if (identifier.includes('@')) return identifier   // JID completo: @lid, @s.whatsapp.net, @g.us
  return ensureBrazilDdi(normalizePhone(identifier))
}

// ─── Interface ──────────────────────────────────────────

export interface WhatsAppSendResult {
  messageId: string | null
  provider: 'evolution' | 'cloud_api'
}

export interface WhatsAppSendOptions {
  /** externalId (key.id) da mensagem citada — Evolution usa `quoted.key.id`. */
  quotedExternalId?: string
}

/** Identifica UMA mensagem já enviada no WhatsApp. Editar, apagar e reagir
 *  precisam da chave inteira — só o id não basta em grupo, onde o WhatsApp
 *  exige também quem enviou. */
export interface WhatsAppMessageRef {
  /** `key.id` da mensagem (o que guardamos em `Message.externalId`). */
  externalId: string
  /** Conversa onde ela está: telefone, JID de grupo (@g.us) ou @lid. */
  chat: string
  /** Mensagem nossa. O WhatsApp só deixa editar/apagar-para-todos as nossas. */
  fromMe: boolean
  /** Em grupo, o JID de quem enviou. Ignorado em conversa individual. */
  participant?: string | undefined
}

export interface WhatsAppProvider {
  readonly providerName: 'evolution' | 'cloud_api'
  sendText(phone: string, text: string, options?: WhatsAppSendOptions): Promise<WhatsAppSendResult>
  sendMedia(phone: string, mediaUrl: string, mediaType: string, caption?: string, fileName?: string): Promise<WhatsAppSendResult>
  sendTemplate(phone: string, templateName: string, language: string, components?: any[]): Promise<WhatsAppSendResult>
  sendInteractive(phone: string, interactive: any): Promise<WhatsAppSendResult>
  sendAudio(phone: string, audioUrl: string): Promise<WhatsAppSendResult>

  // ── Ações sobre mensagem já enviada ──
  // Opcionais na interface porque a API Oficial da Meta simplesmente não tem
  // as três primeiras: quem usa Cloud API recebe um erro explicando isso, em
  // vez de um botão que finge funcionar.
  /** Reescreve o texto de uma mensagem nossa (WhatsApp: até 15 min). */
  editText?(ref: WhatsAppMessageRef, newText: string): Promise<void>
  /** Apaga para todos (revoke) — some também no aparelho do contato. */
  deleteForEveryone?(ref: WhatsAppMessageRef): Promise<void>
  /** Marca a conversa como NÃO lida no aparelho/WhatsApp Web. */
  markChatUnread?(ref: WhatsAppMessageRef): Promise<void>
  /** Reage com emoji; string vazia remove a reação. */
  react?(ref: WhatsAppMessageRef, emoji: string): Promise<void>
}

// ─── Evolution API Provider ─────────────────────────────

export class EvolutionProvider implements WhatsAppProvider {
  readonly providerName = 'evolution' as const

  private url: string
  private apiKey: string
  readonly instanceName: string

  constructor(url: string, apiKey: string, instanceName: string) {
    this.url = url
    this.apiKey = apiKey
    this.instanceName = instanceName
  }

  private async evoFetch(path: string, method = 'GET', body?: any): Promise<any> {
    const opts: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json', apikey: this.apiKey },
    }
    if (body) opts.body = JSON.stringify(body)
    const res = await fetch(`${this.url}${path}`, opts)
    const text = await res.text()
    let parsed: any
    try { parsed = JSON.parse(text) } catch { parsed = text }

    if (!res.ok) {
      // Erro cru da Evolution vira frase de operador (lib/whatsappErrors).
      const erro = new Error(humanizeWhatsAppError(parsed, res.status))
      // A recusa por "número não existe" fica MARCADA, e não só traduzida: quem
      // envia precisa distinguir esse caso para conferir de novo antes de dar o
      // veredito ao operador (ver `comRetryDeJid`).
      if (/"exists"\s*:\s*false/.test(typeof parsed === 'string' ? parsed : JSON.stringify(parsed))) {
        ;(erro as any).waNumberNotFound = true
      }
      throw erro
    }

    return parsed
  }

  /**
   * Reenvia no JID canônico quando a Evolution recusa por "número não existe".
   *
   * A Evolution confere o destinatário (`onWhatsApp`) antes de cada envio, e a
   * consulta FALHA de vez em quando: devolve `exists:false` para número que
   * existe — dá para ver na resposta, que volta com o `jid` ecoando o número
   * consultado e sem `name`, em vez do JID canônico. O operador recebia
   * "O número X não tem WhatsApp. Confira o telefone no cadastro do contato."
   * no meio de uma conversa aberta e ativa.
   *
   * Kobogo, lead 5167 (26/08): duas tentativas recusadas às 08:53, e às 13:07 as
   * mensagens saindo normalmente para o MESMO número, sem ninguém tocar no
   * cadastro. Reproduzido depois na mão — a primeira consulta ao número "frio"
   * respondeu `exists:false` e as oito seguintes, `exists:true`.
   *
   * O que fica no meio do caminho é a resolução do 9º dígito: o cadastro guarda
   * `5547921255873` e o JID real é `554721255873@s.whatsapp.net` (732 dos 791
   * contatos da instância têm JID de 12 dígitos), então quase todo envio depende
   * dessa tradução no servidor. Ao repetir no JID canônico, ela deixa de existir.
   *
   * Só o "não existe" passa por aqui — qualquer outro erro sobe intacto, e uma
   * segunda recusa também.
   */
  private async comRetryDeJid<T>(destino: string, enviar: (destino: string) => Promise<T>): Promise<T> {
    try {
      return await enviar(destino)
    } catch (err: any) {
      // JID completo (@lid, @g.us, @s.whatsapp.net) não tem o que resolver.
      if (!err?.waNumberNotFound || destino.includes('@')) throw err
      const [r] = await this.checkNumbers([destino]).catch(() => [])
      if (!r?.exists || !r.jid) throw err
      console.log(`[Evolution] ${this.instanceName}: envio para ${destino} recusado como inexistente, mas a checagem devolveu ${r.jid} — repetindo no JID`)
      return await enviar(r.jid)
    }
  }

  async sendText(phone: string, text: string, options?: WhatsAppSendOptions): Promise<WhatsAppSendResult> {
    return this.comRetryDeJid(phone, async (destino) => {
      const body: any = { number: toEvoNumber(destino), text }
      if (options?.quotedExternalId) {
        // Evolution v2: passa o key.id da mensagem citada — o backend resolve fromMe/remoteJid.
        body.quoted = { key: { id: options.quotedExternalId } }
      }
      const result = await this.evoFetch(`/message/sendText/${this.instanceName}`, 'POST', body)
      return { messageId: result?.key?.id || null, provider: 'evolution' as const }
    })
  }

  async sendMedia(phone: string, mediaUrl: string, mediaType: string, caption?: string, fileName?: string): Promise<WhatsAppSendResult> {
    // Figurinha tem rota própria na Evolution. Mandá-la por /sendMedia com
    // mediatype 'sticker' é rejeitado (só image/video/document/audio são
    // aceitos) e a mensagem chegava como arquivo, não como figurinha.
    if (mediaType === 'sticker') return this.sendSticker(phone, mediaUrl)

    // GIF é MP4 sem áudio: vai como vídeo, com `gifPlayback` para o WhatsApp
    // tocar em loop no lugar de exibir um player.
    const isGif = mediaType === 'gif'
    return this.comRetryDeJid(phone, async (destino) => {
      const result = await this.evoFetch(`/message/sendMedia/${this.instanceName}`, 'POST', {
        number: toEvoNumber(destino),
        mediatype: isGif ? 'video' : mediaType === 'document' ? 'document' : mediaType,
        media: mediaUrl,
        fileName: fileName || undefined,
        caption: caption || undefined,
        ...(isGif ? { gifPlayback: true } : {}),
      })
      return { messageId: result?.key?.id || null, provider: 'evolution' as const }
    })
  }

  /** Figurinha (.webp) — rota dedicada da Evolution. */
  async sendSticker(phone: string, stickerUrl: string): Promise<WhatsAppSendResult> {
    return this.comRetryDeJid(phone, async (destino) => {
      const result = await this.evoFetch(`/message/sendSticker/${this.instanceName}`, 'POST', {
        number: toEvoNumber(destino),
        sticker: stickerUrl,
      })
      return { messageId: result?.key?.id || null, provider: 'evolution' as const }
    })
  }

  async sendAudio(phone: string, audioUrl: string): Promise<WhatsAppSendResult> {
    return this.comRetryDeJid(phone, async (destino) => {
      const result = await this.evoFetch(`/message/sendWhatsAppAudio/${this.instanceName}`, 'POST', {
        number: toEvoNumber(destino),
        audio: audioUrl,
      })
      return { messageId: result?.key?.id || null, provider: 'evolution' as const }
    })
  }

  // ── Ações sobre mensagem já enviada ──

  /** Monta a `key` do Baileys que a Evolution espera nessas rotas. Em grupo o
   *  `participant` é obrigatório: sem ele o WhatsApp não sabe qual mensagem
   *  daquele chat é para mexer. */
  private keyOf(ref: WhatsAppMessageRef) {
    const remoteJid = ref.chat.includes('@') ? ref.chat : `${toEvoNumber(ref.chat)}@s.whatsapp.net`
    const key: any = { id: ref.externalId, remoteJid, fromMe: ref.fromMe }
    if (remoteJid.endsWith('@g.us') && ref.participant) key.participant = ref.participant
    return key
  }

  /**
   * A `key` como a Evolution a guardou — não como deduzimos do telefone.
   *
   * Editar/apagar/reagir comparam o `remoteJid` do pedido com o da mensagem no
   * banco dela, e a comparação é literal. Boa parte dos chats vive sob o
   * identificador de privacidade (`<numero>@lid`), que NÃO é o telefone: montar
   * `5562…@s.whatsapp.net` a partir do lead devolvia
   * `400 RemoteJid does not match` e o operador via só "falha de comunicação".
   *
   * Uma consulta por `key.id` resolve o JID verdadeiro (e o `participant`, em
   * grupo). Se ela não responder, seguimos com a key deduzida — que é a certa
   * nos chats que não usam @lid.
   */
  private async resolverKey(ref: WhatsAppMessageRef): Promise<any> {
    const deduzida = this.keyOf(ref)
    if (!ref.externalId) return deduzida
    try {
      const data = await this.evoFetch(`/chat/findMessages/${this.instanceName}`, 'POST', {
        where: { key: { id: ref.externalId } },
      })
      const env = data?.messages ?? data
      const registro = (env?.records ?? (Array.isArray(env) ? env : []))[0]
      const k = registro?.key
      if (k?.id && k?.remoteJid) {
        const key: any = { id: String(k.id), remoteJid: String(k.remoteJid), fromMe: !!k.fromMe }
        const participant = k.participant ?? ref.participant
        if (String(k.remoteJid).endsWith('@g.us') && participant) key.participant = String(participant)
        return key
      }
    } catch {
      // Sem resposta da Evolution: melhor tentar com a key deduzida do que
      // falhar antes de tentar.
    }
    return deduzida
  }

  async editText(ref: WhatsAppMessageRef, newText: string): Promise<void> {
    const key = await this.resolverKey(ref)
    await this.evoFetch(`/chat/updateMessage/${this.instanceName}`, 'POST', {
      number: key.remoteJid,
      key,
      text: newText,
    })
  }

  async deleteForEveryone(ref: WhatsAppMessageRef): Promise<void> {
    const key = await this.resolverKey(ref)
    await this.evoFetch(`/chat/deleteMessageForEveryone/${this.instanceName}`, 'DELETE', {
      id: key.id,
      remoteJid: key.remoteJid,
      fromMe: key.fromMe,
      ...(key.participant ? { participant: key.participant } : {}),
    })
  }

  async markChatUnread(ref: WhatsAppMessageRef): Promise<void> {
    const key = await this.resolverKey(ref)
    await this.evoFetch(`/chat/markChatUnread/${this.instanceName}`, 'POST', {
      chat: key.remoteJid,
      lastMessage: { key },
    })
  }

  async react(ref: WhatsAppMessageRef, emoji: string): Promise<void> {
    await this.evoFetch(`/message/sendReaction/${this.instanceName}`, 'POST', {
      key: await this.resolverKey(ref),
      reaction: emoji,
    })
  }

  async sendTemplate(_phone: string, _templateName: string, _language: string, _components?: any[]): Promise<WhatsAppSendResult> {
    // Evolution API nao suporta templates HSM
    throw new Error('Evolution API nao suporta envio de templates HSM')
  }

  async sendInteractive(_phone: string, _interactive: any): Promise<WhatsAppSendResult> {
    // Evolution API nao suporta mensagens interativas oficiais
    throw new Error('Evolution API nao suporta mensagens interativas oficiais')
  }

  /**
   * Presença ("digitando…", "gravando áudio…"). Usado pelos Disparos
   * Inteligentes antes de cada mensagem: quem recebe vê o mesmo que veria de uma
   * pessoa escrevendo, e o número deixa de emitir mensagens que aparecem do nada.
   *
   * `delay` é quanto tempo a Evolution mantém a presença antes de encerrá-la.
   */
  async sendPresence(phone: string, presence: 'composing' | 'recording' | 'paused' | 'available', delayMs = 0): Promise<void> {
    await this.evoFetch(`/chat/sendPresence/${this.instanceName}`, 'POST', {
      number: toEvoNumber(phone),
      presence,
      delay: Math.max(0, Math.round(delayMs)),
    })
  }

  /**
   * Quais destes números existem no WhatsApp. Disparar para número inexistente é
   * um dos sinais que mais derrubam chip — vale a consulta antes de gastar envio.
   */
  async checkNumbers(phones: string[]): Promise<Array<{ number: string; exists: boolean; jid: string | null; name: string | null }>> {
    if (!phones.length) return []
    const data = await this.evoFetch(`/chat/whatsappNumbers/${this.instanceName}`, 'POST', {
      numbers: phones.map((p) => toEvoNumber(p)),
    })
    const arr = Array.isArray(data) ? data : (data?.data ?? [])
    return arr.map((r: any) => ({
      number: String(r?.number ?? ''),
      exists: !!(r?.exists ?? r?.numberExists),
      jid: r?.jid ? String(r.jid) : null,
      // `name` vem quando a instância CONHECE o contato. Junto de exists=false
      // é contradição — e a pista de que a conta está em modo @lid, onde o
      // telefone deixou de ser o identificador que a consulta resolve.
      name: r?.name ? String(r.name) : null,
    }))
  }

  /**
   * Conversas que a instância tem (as do aparelho pareado). Base da importação
   * de histórico — a Cloud API não tem equivalente, a Meta não expõe conversa
   * anterior à conexão.
   */
  async findChats(): Promise<any[]> {
    const data = await this.evoFetch(`/chat/findChats/${this.instanceName}`, 'POST', {})
    return Array.isArray(data) ? data : (data?.chats ?? data?.data ?? [])
  }

  /** Agenda de contatos da instância. */
  async findContacts(): Promise<any[]> {
    const data = await this.evoFetch(`/chat/findContacts/${this.instanceName}`, 'POST', {})
    return Array.isArray(data) ? data : (data?.contacts ?? data?.records ?? [])
  }

  /** Mensagens de uma conversa, paginadas (a Evolution devolve 50 por página). */
  async findMessages(remoteJid: string, page = 1): Promise<{ registros: any[]; total: number; paginas: number }> {
    const data = await this.evoFetch(`/chat/findMessages/${this.instanceName}`, 'POST', {
      where: { key: { remoteJid } },
      page,
    })
    const env = data?.messages ?? data
    return {
      registros: env?.records ?? (Array.isArray(env) ? env : []),
      total: Number(env?.total ?? 0),
      paginas: Number(env?.pages ?? 1),
    }
  }

  /** Estado da conexão da instância (`open`, `close`, `connecting`). */
  async connectionState(): Promise<string> {
    const data = await this.evoFetch(`/instance/connectionState/${this.instanceName}`)
    return String(data?.instance?.state ?? data?.state ?? 'unknown')
  }

  /**
   * Grupos de que o número conectado participa. Usado para escolher o destino
   * dos avisos internos pelo NOME em vez de colar o JID (`...@g.us`).
   *
   * `announce: true` = só admins publicam; nesse caso o aviso só sai se o
   * número conectado for admin do grupo — a UI sinaliza isso.
   */
  async listGroups(): Promise<Array<{ id: string; subject: string; size: number; announce: boolean }>> {
    const data = await this.evoFetch(`/group/fetchAllGroups/${this.instanceName}?getParticipants=false`)
    const arr = Array.isArray(data) ? data : (data?.data ?? [])
    return arr
      .filter((g: any) => typeof g?.id === 'string' && g.id.endsWith('@g.us'))
      .map((g: any) => ({
        id: g.id,
        subject: String(g.subject || '(sem nome)'),
        size: Number(g.size) || 0,
        announce: !!g.announce,
      }))
      .sort((a: any, b: any) => a.subject.localeCompare(b.subject, 'pt-BR'))
  }
}

// ─── Cloud API Provider ─────────────────────────────────

export class CloudApiProvider implements WhatsAppProvider {
  readonly providerName = 'cloud_api' as const

  private phoneNumberId: string
  private token: string

  constructor(phoneNumberId: string, encryptedToken: string) {
    this.phoneNumberId = phoneNumberId
    this.token = decryptToken(encryptedToken)
  }

  async sendText(phone: string, text: string, _options?: WhatsAppSendOptions): Promise<WhatsAppSendResult> {
    // Cloud API: citação requer `context.message_id` — não suportado nesta camada ainda.
    const result = await sendTextMessage(this.phoneNumberId, this.token, ensureBrazilDdi(normalizePhone(phone)), text)
    return { ...result, provider: 'cloud_api' }
  }

  async sendMedia(phone: string, mediaUrl: string, mediaType: string, caption?: string, fileName?: string): Promise<WhatsAppSendResult> {
    // 'gif' vira vídeo: a Cloud API não tem tipo próprio para GIF e o arquivo
    // já é um MP4. 'sticker' tem tipo próprio e vai direto.
    const normalized = mediaType === 'gif' ? 'video' : mediaType
    const type = (['image', 'video', 'audio', 'document', 'sticker'].includes(normalized) ? normalized : 'document') as 'image' | 'video' | 'audio' | 'document' | 'sticker'
    const result = await sendMediaMessage(this.phoneNumberId, this.token, ensureBrazilDdi(normalizePhone(phone)), type, {
      link: mediaUrl,
      caption,
      filename: fileName,
    })
    return { ...result, provider: 'cloud_api' }
  }

  async sendAudio(phone: string, audioUrl: string): Promise<WhatsAppSendResult> {
    return this.sendMedia(phone, audioUrl, 'audio')
  }

  async sendTemplate(phone: string, templateName: string, language: string, components?: any[]): Promise<WhatsAppSendResult> {
    const result = await sendTemplateMessage(this.phoneNumberId, this.token, ensureBrazilDdi(normalizePhone(phone)), templateName, language, components)
    return { ...result, provider: 'cloud_api' }
  }

  async sendInteractive(phone: string, interactive: any): Promise<WhatsAppSendResult> {
    const result = await sendInteractiveMessage(this.phoneNumberId, this.token, ensureBrazilDdi(normalizePhone(phone)), interactive)
    return { ...result, provider: 'cloud_api' }
  }

  // ── Ações sobre mensagem já enviada ──
  // A API Oficial da Meta não tem editar nem apagar: uma vez entregue, a
  // mensagem fica. Falhar aqui com a explicação é melhor do que esconder o
  // botão, porque o operador que veio do WhatsApp Web vai procurar por ele.

  async editText(_ref: WhatsAppMessageRef, _newText: string): Promise<void> {
    throw new Error('A API Oficial da Meta não permite editar mensagem já enviada. Isso só funciona nos números conectados por QR Code.')
  }

  async deleteForEveryone(_ref: WhatsAppMessageRef): Promise<void> {
    throw new Error('A API Oficial da Meta não permite apagar mensagem para todos. Isso só funciona nos números conectados por QR Code — aqui dá para apagar só da sua tela.')
  }

  async markChatUnread(_ref: WhatsAppMessageRef): Promise<void> {
    // Não existe na Cloud API: o "não lida" vale só no painel. Silencioso de
    // propósito — a marcação local já aconteceu e é o que o operador queria.
  }

  async react(ref: WhatsAppMessageRef, emoji: string): Promise<void> {
    const to = ref.chat.includes('@') ? ref.chat.split('@')[0] : ensureBrazilDdi(normalizePhone(ref.chat))
    await sendReactionMessage(this.phoneNumberId, this.token, to, ref.externalId, emoji)
  }
}

// ─── Factory Functions ──────────────────────────────────

/**
 * A conexão Cloud API que envia quando ninguém escolheu um número.
 *
 * Todo lugar que antes fazia `findFirst({ where: { active: true } })` passa por
 * aqui. Com um número só dava no mesmo; com dois ou mais, `findFirst` sem ordem
 * devolve o que o banco quiser — e a mensagem sai de um número imprevisível, sem
 * erro nenhum. A ordem é explícita: o número marcado como padrão na tela e,
 * quando não há nenhum marcado, o mais antigo ativo (que é o que o findFirst
 * costumava devolver na prática).
 */
export const ORDEM_CONEXAO_PADRAO = [
  { isDefault: 'desc' as const },
  { id: 'asc' as const },
]

export async function getDefaultCloudApiConnection() {
  return prisma.cloudApiConnection.findFirst({
    where: { active: true },
    orderBy: ORDEM_CONEXAO_PADRAO,
  })
}

/** Retorna provider padrao baseado na configuracao do sistema */
export async function getDefaultProvider(): Promise<WhatsAppProvider> {
  // Verificar setting de preferencia
  const setting = await prisma.setting.findUnique({ where: { key: 'whatsapp.default_provider' } }).catch(() => null)
  const pref = setting ? String(setting.value).replace(/"/g, '') : 'auto'

  if (pref === 'cloud_api' || pref === 'auto') {
    const conn = await getDefaultCloudApiConnection()
    if (conn) {
      return new CloudApiProvider(conn.phoneNumberId, conn.systemUserToken)
    }
    if (pref === 'cloud_api') {
      throw new Error('Cloud API configurada como padrao mas nenhuma conexao ativa encontrada')
    }
    // auto: fall through to Evolution
  }

  // Evolution API fallback
  return createEvolutionProvider()
}

/** Retorna provider baseado na origem das mensagens do lead */
export async function getProviderForLead(lead: { id: number; whatsapp: string }): Promise<WhatsAppProvider> {
  // Verificar se lead tem mensagens via cloud_api
  const cloudMsg = await prisma.message.findFirst({
    where: { leadId: lead.id, provider: 'cloud_api' },
    select: { id: true },
  })

  if (cloudMsg) {
    const conn = await getDefaultCloudApiConnection()
    if (conn) {
      return new CloudApiProvider(conn.phoneNumberId, conn.systemUserToken)
    }
  }

  // Verificar se lead tem mensagens via evolution
  const evoMsg = await prisma.message.findFirst({
    where: { leadId: lead.id, provider: 'evolution' },
    select: { id: true },
  })

  if (evoMsg) {
    return createEvolutionProvider()
  }

  // Lead sem mensagens — usar provider padrao
  return getDefaultProvider()
}

/** Cria EvolutionProvider a partir das env vars (instância padrão). */
export function createEvolutionProvider(): EvolutionProvider {
  const url = process.env.EVOLUTION_API_URL
  const key = process.env.EVOLUTION_API_KEY
  const inst = process.env.EVOLUTION_INSTANCE || 'beyond-main'

  if (!url || !key) {
    throw new Error('Evolution API nao configurada (EVOLUTION_API_URL / EVOLUTION_API_KEY)')
  }

  return new EvolutionProvider(url, key, inst)
}

/** Cria EvolutionProvider com um instanceName específico (sobrescreve env). */
export function createEvolutionProviderFor(instanceName: string): EvolutionProvider {
  const url = process.env.EVOLUTION_API_URL
  const key = process.env.EVOLUTION_API_KEY
  if (!url || !key) {
    throw new Error('Evolution API nao configurada (EVOLUTION_API_URL / EVOLUTION_API_KEY)')
  }
  return new EvolutionProvider(url, key, instanceName)
}

/**
 * Retorna o provider WhatsApp da instância do DONO do lead (assignedUserId).
 * Para casos onde o sistema envia em nome do dono — notificação de Calendar,
 * confirmação automática, integração Make.com, cadência agendada — preservando
 * a identidade do número do operador responsável.
 *
 * Se o lead não tem dono OU o dono não tem instância dedicada, cai no fallback
 * (provider lead-based / default).
 */
export async function getProviderForLeadOwner(lead: { id: number; whatsapp: string }): Promise<{ provider: WhatsAppProvider; instanceName: string | null }> {
  // A Cloud API só entrega TEXTO LIVRE dentro da janela de 24h (a partir da última
  // mensagem RECEBIDA do lead). Só mantemos a conversa na Cloud API se a janela
  // estiver aberta; senão o número é "frio" (ex.: lead de formulário/landing/
  // tráfego pago) e o texto livre seria rejeitado pela Meta (erro 131047/131026).
  // Nesse caso usamos a Evolution, que entrega texto livre a qualquer número.
  const openWindow = await prisma.message.findFirst({
    where: { leadId: lead.id, provider: 'cloud_api', fromMe: false, createdAt: { gt: new Date(Date.now() - 24 * 3600000) } },
    select: { id: true },
  })
  if (openWindow) {
    const cloudConn = await getDefaultCloudApiConnection()
    if (cloudConn) {
      return { provider: new CloudApiProvider(cloudConn.phoneNumberId, cloudConn.systemUserToken), instanceName: null }
    }
  }

  // Busca dono do lead → instância dedicada dele (Evolution)
  const leadInfo = await prisma.lead.findUnique({
    where: { id: lead.id },
    select: { assignedUserId: true },
  })
  if (leadInfo?.assignedUserId) {
    const ownInst = await prisma.whatsAppInstance.findFirst({
      where: { ownerUserId: leadInfo.assignedUserId, active: true },
      orderBy: { id: 'asc' },
      select: { instanceName: true },
    })
    if (ownInst) {
      return { provider: createEvolutionProviderFor(ownInst.instanceName), instanceName: ownInst.instanceName }
    }
  }

  // Sem janela Cloud aberta e sem instância dedicada do dono → Evolution padrão
  // (beyond-main), que entrega texto livre ao número frio. NÃO cai na Cloud API,
  // que rejeitaria o texto livre fora da janela de 24h.
  const provider = createEvolutionProvider()
  return { provider, instanceName: provider.instanceName }
}

/**
 * Resolve o canal dedicado (instância Evolution OU conexão Cloud) de um usuário,
 * já como provider pronto. Retorna null se o usuário não é dono de nenhum canal
 * ativo. Usado por getProviderForSender (dono do lead e remetente).
 */
async function resolveDedicatedProviderForUser(
  userId: number,
): Promise<{ provider: WhatsAppProvider; instanceName: string | null; cloudApiConnectionId: number | null } | null> {
  const ownInstance = await prisma.whatsAppInstance.findFirst({
    where: { ownerUserId: userId, active: true },
    orderBy: { id: 'asc' },
    select: { instanceName: true },
  })
  if (ownInstance) {
    return { provider: createEvolutionProviderFor(ownInstance.instanceName), instanceName: ownInstance.instanceName, cloudApiConnectionId: null }
  }
  const ownCloud = await prisma.cloudApiConnection.findFirst({
    where: { ownerUserId: userId, active: true },
    orderBy: { id: 'asc' },
    select: { id: true, phoneNumberId: true, systemUserToken: true },
  })
  if (ownCloud) {
    return { provider: new CloudApiProvider(ownCloud.phoneNumberId, ownCloud.systemUserToken), instanceName: null, cloudApiConnectionId: ownCloud.id }
  }
  return null
}

/**
 * Canal de ENTRADA da conversa: o número pelo qual o CONTATO falou por último.
 *
 * É a identidade da conversa do ponto de vista de quem está do outro lado: é o
 * número que ele viu, salvou na agenda e para o qual vai responder. Por isso ele
 * manda em qualquer regra de dono/remetente/setor — responder por outro número
 * abre um segundo fio no aparelho do contato, vindo de um desconhecido, e a
 * resposta dele cai numa linha que não é a da conversa.
 *
 * Prioriza a última mensagem RECEBIDA (fromMe=false); na falta dela usa a última
 * ENVIADA, porque uma conversa que nós abrimos também já expôs um número ao
 * contato e trocá-lo no meio tem o mesmo efeito. Retorna null só quando não há
 * conversa nenhuma (lead novo, primeira interação) ou quando aquele canal saiu
 * do ar (instância/conexão inativa ou removida) — aí a escolha do número volta
 * a ser do operador.
 */
export interface InboundChannel {
  /** channelId estável ("evolution:<instanceName>" | "cloud:<id>") */
  channelId: string
  kind: 'evolution' | 'cloud'
  instanceName: string | null
  cloudApiConnectionId: number | null
}

/**
 * Conversas que pertencem a um canal — a MESMA regra que decide por qual número
 * respondemos (`inboundChannelForLead`): vale a última mensagem RECEBIDA e, se
 * a conversa nunca recebeu nada, a última mensagem qualquer.
 *
 * O filtro da lista de Conversas casava "tem ALGUMA mensagem enviada por este
 * número, em qualquer época". Uma conversa atendida ontem pelo número A e hoje
 * pelo B aparecia nos dois filtros — e, como o rótulo mostra o canal atual, ela
 * surgia na lista do A carimbada como B: "filtrei uma instância e veio conversa
 * de outra". Aqui a conversa pertence a um canal só, o mesmo que a tela mostra.
 */
export async function leadsDoCanal(channelId: string): Promise<number[]> {
  const evo = channelId.startsWith('evolution:') ? channelId.slice('evolution:'.length) : null
  const cloudId = channelId.startsWith('cloud:') ? parseInt(channelId.slice('cloud:'.length)) : null
  // Histórico importado da Kommo: canal único, sem número, por isso sem sufixo.
  const kommo = channelId === 'kommo:historico'
  if (!evo && !kommo && !Number.isFinite(cloudId as number)) return []

  const condicao = evo
    ? Prisma.sql`m.provider = 'evolution' AND m.evolutionInstance = ${evo}`
    : kommo
      ? Prisma.sql`m.provider = 'kommo'`
      : Prisma.sql`m.provider = 'cloud_api' AND m.cloudApiConnectionId = ${cloudId}`

  // 1. Conversas cuja última mensagem RECEBIDA veio por este canal.
  const porEntrada = await prisma.$queryRaw<Array<{ leadId: number }>>(Prisma.sql`
    SELECT m.leadId
    FROM bychat_messages m
    INNER JOIN (
      SELECT leadId, MAX(timestamp) AS ts
      FROM bychat_messages
      WHERE isInternal = 0 AND fromMe = 0
      GROUP BY leadId
    ) u ON u.leadId = m.leadId AND u.ts = m.timestamp
    WHERE m.isInternal = 0 AND m.fromMe = 0 AND ${condicao}
  `)

  // 2. Conversas que NUNCA receberam nada (só nós falamos): vale a última
  //    mensagem, senão elas sumiriam de todos os filtros.
  const semEntrada = await prisma.$queryRaw<Array<{ leadId: number }>>(Prisma.sql`
    SELECT m.leadId
    FROM bychat_messages m
    INNER JOIN (
      SELECT leadId, MAX(timestamp) AS ts
      FROM bychat_messages
      WHERE isInternal = 0
      GROUP BY leadId
    ) u ON u.leadId = m.leadId AND u.ts = m.timestamp
    WHERE m.isInternal = 0 AND ${condicao}
      AND NOT EXISTS (
        SELECT 1 FROM bychat_messages r
        WHERE r.leadId = m.leadId AND r.isInternal = 0 AND r.fromMe = 0
      )
  `)

  const ids = new Set([...porEntrada, ...semEntrada].map((r) => Number(r.leadId)))

  // GRUPO não segue a regra da última mensagem: ele pertence ao número TITULAR
  // (ver services/whatsappGroups.ts). Com duas linhas nossas dentro do mesmo
  // grupo, a conversa aparecia no filtro das duas, alternando conforme quem
  // entregou a última mensagem. Entra no filtro do titular e sai do dos outros.
  const titulares = await titularesDeGrupos()
  for (const [leadId, titular] of titulares) {
    if (evo && titular === evo) ids.add(leadId)
    else ids.delete(leadId)
  }

  return [...ids]
}

/**
 * Canal efetivo de cada conversa, pela mesma regra — para a lista rotular o
 * número com o mesmo critério com que filtra e responde.
 */
export async function canalEfetivoDeLeads(
  leadIds: number[],
): Promise<Map<number, { provider: string; evolutionInstance: string | null; cloudApiConnectionId: number | null }>> {
  const saida = new Map<number, { provider: string; evolutionInstance: string | null; cloudApiConnectionId: number | null }>()
  if (!leadIds.length) return saida

  const linhas = await prisma.$queryRaw<Array<{
    leadId: number; provider: string; evolutionInstance: string | null; cloudApiConnectionId: number | null; recebida: number
  }>>(Prisma.sql`
    SELECT m.leadId, m.provider, m.evolutionInstance, m.cloudApiConnectionId, (1 - m.fromMe) AS recebida
    FROM bychat_messages m
    INNER JOIN (
      SELECT leadId, fromMe, MAX(timestamp) AS ts
      FROM bychat_messages
      WHERE isInternal = 0 AND leadId IN (${Prisma.join(leadIds)})
      GROUP BY leadId, fromMe
    ) u ON u.leadId = m.leadId AND u.fromMe = m.fromMe AND u.ts = m.timestamp
    WHERE m.isInternal = 0 AND m.leadId IN (${Prisma.join(leadIds)})
  `)

  // A recebida ganha da enviada; entre iguais, a mais recente já veio do join.
  for (const l of linhas) {
    const atual = saida.get(Number(l.leadId))
    if (atual && !l.recebida) continue
    saida.set(Number(l.leadId), {
      provider: l.provider,
      evolutionInstance: l.evolutionInstance,
      cloudApiConnectionId: l.cloudApiConnectionId === null ? null : Number(l.cloudApiConnectionId),
    })
  }

  // Grupo com titular ignora tudo acima: a conversa é do número a que o grupo
  // pertence, e não de quem entregou a última mensagem — que, com duas linhas
  // nossas no mesmo grupo, alterna entre elas a cada mensagem.
  for (const [leadId, titular] of await titularesDeGrupos(leadIds)) {
    saida.set(leadId, { provider: 'evolution', evolutionInstance: titular, cloudApiConnectionId: null })
  }

  return saida
}

export async function inboundChannelForLead(leadId: number): Promise<InboundChannel | null> {
  // Grupo: a resposta sai pelo número TITULAR. Sem isto ela saía pela linha que
  // entregou a última mensagem — e, com duas linhas nossas no grupo, a equipe
  // aparecia ora por um número ora por outro dentro da mesma conversa.
  const titular = (await titularesDeGrupos([leadId])).get(leadId)
  if (titular) {
    return { channelId: evoChannelId(titular), kind: 'evolution', instanceName: titular, cloudApiConnectionId: null }
  }

  const sel = { provider: true, evolutionInstance: true, cloudApiConnectionId: true } as const
  const last =
    (await prisma.message.findFirst({
      where: { leadId, fromMe: false, isInternal: false },
      orderBy: { timestamp: 'desc' },
      select: sel,
    }))
    ?? (await prisma.message.findFirst({
      where: { leadId, isInternal: false },
      orderBy: { timestamp: 'desc' },
      select: sel,
    }))
  if (!last) return null

  if (last.provider === 'cloud_api' && last.cloudApiConnectionId) {
    const conn = await prisma.cloudApiConnection.findFirst({
      where: { id: last.cloudApiConnectionId, active: true },
      select: { id: true },
    })
    if (!conn) return null
    return { channelId: cloudChannelId(conn.id), kind: 'cloud', instanceName: null, cloudApiConnectionId: conn.id }
  }
  if (last.provider === 'evolution' && last.evolutionInstance) {
    const inst = await prisma.whatsAppInstance.findFirst({
      where: { instanceName: last.evolutionInstance, active: true },
      select: { instanceName: true },
    })
    if (!inst) return null
    return { channelId: evoChannelId(inst.instanceName), kind: 'evolution', instanceName: inst.instanceName, cloudApiConnectionId: null }
  }
  return null
}

/**
 * Canal TRAVADO da conversa para um operador: o canal de entrada, desde que ele
 * tenha acesso a esse número. Se o lead veio por um número de outro setor e foi
 * transferido, travar ali deixaria o atendente sem conseguir responder (canSendVia
 * devolveria 403) — nesse caso destrava e a escolha cai nas regras de dono/setor.
 */
export async function lockedChannelForLead(
  leadId: number,
  sender: { userId: number; role: string },
): Promise<InboundChannel | null> {
  const inbound = await inboundChannelForLead(leadId)
  if (!inbound) return null
  const allowed = await resolveSenderChannels(sender)
  return allowed.some((c) => c.id === inbound.channelId) ? inbound : null
}

/**
 * Quem pode responder por um número DIFERENTE do da conversa: só o SUPERADMIN.
 *
 * A trava não muda para ele — o canal de entrada continua sendo o padrão em que
 * o seletor abre e o que `getProviderForSender` usa quando ninguém escolhe nada.
 * O que ele ganha é a saída manual, para os casos em que o número da conversa
 * não serve (instância caída, janela de 24h fechada na Cloud). ADMIN/MANAGER/
 * AGENT continuam presos ao número que o contato conhece.
 */
export function canOverrideConversationChannel(role: string): boolean {
  return role === 'SUPERADMIN'
}

/**
 * Retorna o provider WhatsApp para enviar uma mensagem ao lead. Quem "possui" a
 * conversa é o NÚMERO PELO QUAL O CONTATO FALOU: enquanto houver conversa, a
 * resposta sai por ele, não importa quem seja o dono do lead nem quem clique em
 * enviar. Só quando não existe conversa (primeira interação) é que a escolha do
 * número é livre e caem as regras de dono/remetente/setor. Ordem:
 *
 *   0. Canal de ENTRADA do lead (última mensagem do contato), se ainda ativo e
 *      acessível ao remetente → SEMPRE. Este é o caso normal de quem responde
 *      alguém no Conversas.
 *   1. Sem conversa → DONO do lead (assignedUserId) tem canal dedicado
 *      (instância Evolution ou conexão Cloud)? → usa ele.
 *   2. Lead sem dono / dono sem número → canal dedicado do REMETENTE (quem está
 *      atendendo fala pela própria linha).
 *   2b. Ninguém com número pessoal → número do SETOR (o canal cujos setores
 *      donos incluem o setor do dono do lead ou, na falta, o do remetente).
 *   3. AGENT sem nada → erro. Admin sem nada → provider padrão.
 *
 * O endpoint ainda valida via canSendVia (owner-only para AGENT; admin passa),
 * então um AGENT não envia pela instância dedicada de outro agente.
 *
 * Retorna { provider, instanceName } pra que callers possam logar/validar.
 */
export async function getProviderForSender(
  lead: { id: number; whatsapp: string },
  sender: { userId: number; role: string },
): Promise<{ provider: WhatsAppProvider; instanceName: string | null; cloudApiConnectionId?: number | null }> {
  // 0. Conversa em andamento → responde pelo MESMO número por onde o contato
  //    falou. Vem antes de dono/remetente/setor: o contato só conhece esse
  //    número. Vale também para automações e helpdesk, que chegam aqui sem
  //    channelId explícito.
  const locked = await lockedChannelForLead(lead.id, sender)
  if (locked) return getProviderForChannel(locked.channelId)

  // 1. Sem conversa: DONO do lead com número dedicado.
  const leadRow = await prisma.lead.findUnique({ where: { id: lead.id }, select: { assignedUserId: true } })
  if (leadRow?.assignedUserId) {
    const ownerCh = await resolveDedicatedProviderForUser(leadRow.assignedUserId)
    if (ownerCh) return ownerCh
  }

  // 2. Lead sem dono (ou dono sem número) → canal dedicado do REMETENTE.
  const senderCh = await resolveDedicatedProviderForUser(sender.userId)
  if (senderCh) return senderCh

  // 2b. Ninguém com número PESSOAL → número do SETOR. Um número pode ter vários
  //     setores donos (recepção do Comercial + Suporte): quem é de um deles fala
  //     por essa linha em vez de cair no número global do tenant. Primeiro o do
  //     dono do lead, para a conversa continuar saindo pelo mesmo número; depois
  //     o do remetente.
  for (const uid of [leadRow?.assignedUserId, sender.userId]) {
    if (!uid) continue
    const teamCh = await channelForUserTeams(uid)
    if (!teamCh) continue
    if (teamCh.kind === 'evolution' && teamCh.instanceName) {
      return {
        provider: createEvolutionProviderFor(teamCh.instanceName),
        instanceName: teamCh.instanceName,
        cloudApiConnectionId: null,
      }
    }
    if (teamCh.kind === 'cloud' && teamCh.phoneNumberId && teamCh.token) {
      return {
        provider: new CloudApiProvider(teamCh.phoneNumberId, teamCh.token),
        instanceName: null,
        cloudApiConnectionId: teamCh.id,
      }
    }
  }

  // 3. Rede de segurança do espelhamento: só chega aqui quando o degrau 0 não
  //    travou o canal de entrada (canal inativo/removido ou fora do alcance do
  //    remetente) E ninguém tem número dedicado. Espelha o canal de ENTRADA do
  //    lead olhando a ÚLTIMA mensagem RECEBIDA (fromMe=false), e NÃO a mera
  //    existência de uma msg Cloud no histórico.
  const lastInbound = await prisma.message.findFirst({
    where: { leadId: lead.id, fromMe: false, isInternal: false },
    orderBy: { timestamp: 'desc' },
    select: { provider: true, evolutionInstance: true, cloudApiConnectionId: true },
  })
  const channelMsg = lastInbound ?? await prisma.message.findFirst({
    where: { leadId: lead.id, isInternal: false },
    orderBy: { timestamp: 'desc' },
    select: { provider: true, evolutionInstance: true, cloudApiConnectionId: true },
  })
  if (channelMsg?.provider === 'cloud_api') {
    // Usa a conexão Cloud EXATA pela qual o lead falou (não a "primeira ativa").
    const cloudConn =
      (channelMsg.cloudApiConnectionId
        ? await prisma.cloudApiConnection.findFirst({ where: { id: channelMsg.cloudApiConnectionId, active: true } })
        : null)
      ?? await getDefaultCloudApiConnection()
    if (cloudConn) {
      return {
        provider: new CloudApiProvider(cloudConn.phoneNumberId, cloudConn.systemUserToken),
        instanceName: null,
        cloudApiConnectionId: cloudConn.id,
      }
    }
  } else if (channelMsg?.provider === 'evolution' && channelMsg.evolutionInstance) {
    // Responde pela MESMA instância Evolution pela qual o lead falou (espelha o
    // número de entrada). Só chega aqui quem NÃO tem número dedicado.
    const inst = await prisma.whatsAppInstance.findFirst({
      where: { instanceName: channelMsg.evolutionInstance, active: true },
      select: { instanceName: true },
    })
    const instanceName = inst?.instanceName ?? channelMsg.evolutionInstance
    return {
      provider: createEvolutionProviderFor(instanceName),
      instanceName,
      cloudApiConnectionId: null,
    }
  }

  // 3. AGENT sem canal dedicado e sem histórico de canal → bloqueia explicitamente
  if (sender.role === 'AGENT') {
    throw new Error(
      'Você não tem um número de WhatsApp vinculado. Peça ao administrador para configurar uma instância ou conexão.',
    )
  }

  // 4. Admin sem instância dedicada → comportamento atual (instância padrão).
  //    Para provider Cloud devolve a conexão usada e instanceName null: rotular
  //    uma mensagem Cloud com o nome de uma instância Evolution (o que o env
  //    EVOLUTION_INSTANCE fazia aqui) grava um canal de origem errado e o degrau
  //    0 não conseguiria travar a conversa nesse número depois.
  const provider = await getProviderForLead(lead)
  if (provider instanceof EvolutionProvider) {
    return { provider, instanceName: provider.instanceName, cloudApiConnectionId: null }
  }
  const cloudConn = await getDefaultCloudApiConnection()
  return { provider, instanceName: null, cloudApiConnectionId: cloudConn?.id ?? null }
}

// ─── Resolução de canais do remetente (multi-canal) ─────
// Um "canal" é um número que o operador pode usar para enviar: instância
// Evolution (não-oficial, texto livre) ou conexão Cloud API (oficial Meta, com
// janela de 24h e templates HSM). O frontend usa isto para mostrar o seletor de
// número e decidir quais modelos exibir (internos vs HSM).

export type ChannelProvider = 'evolution' | 'cloud_api'

export interface SenderChannel {
  /** id estável usado pelo frontend e por getProviderForChannel: "evolution:<instanceName>" | "cloud:<connectionId>" */
  id: string
  provider: ChannelProvider
  label: string
  /** Cor de identificação escolhida pelo cliente; null usa a do provedor. */
  color: string | null
  number: string | null
  /** true se o operador é dono exclusivo deste canal (ownerUserId) */
  dedicated: boolean
}

function evoChannelId(instanceName: string): string { return `evolution:${instanceName}` }
function cloudChannelId(connectionId: number): string { return `cloud:${connectionId}` }

/**
 * Lista os canais que um operador pode usar para enviar.
 *
 * Regra:
 *  - Se o operador é DONO de algum canal (instância/conexão com ownerUserId =
 *    ele), retorna SÓ os dedicados dele (não pode usar o número de um colega).
 *  - AGENT vê: o canal pessoal dele, os canais dos SETORES dele (um número pode
 *    ter vários setores donos) e os que não têm dono nenhum.
 *  - Admins (SUPERADMIN/ADMIN/MANAGER) veem todos os canais ativos.
 */
export async function resolveSenderChannels(sender: { userId: number; role: string }): Promise<SenderChannel[]> {
  const [todasInstances, todasConnections, meusTimes] = await Promise.all([
    prisma.whatsAppInstance.findMany({ where: { active: true }, orderBy: { id: 'asc' }, include: { teams: { select: { teamId: true } } } }),
    prisma.cloudApiConnection.findMany({ where: { active: true }, orderBy: { id: 'asc' }, include: { teams: { select: { teamId: true } } } }),
    userTeamIds(sender.userId),
  ])

  // Número RESERVADO sai daqui antes de qualquer política de papel, setor ou
  // matriz — e é isto que o cliente viu quebrado: a linha pessoal marcada como
  // reservada continuava listada no filtro de números do Conversas e no seletor
  // de envio para quem não é dono dela, porque a política abaixo trata
  // "admin-like vê tudo" e nunca consultou a reserva. Esconder a conversa e
  // deixar o número à mostra não esconde nada: o nome e o telefone estavam ali,
  // e dava para mandar mensagem por ele.
  const { podarCanaisReservados } = await import('./channelVisibility.js')
  const [instances, connections] = await Promise.all([
    podarCanaisReservados(todasInstances, sender.userId, sender.role, (i) => ({ instanceName: i.instanceName })),
    podarCanaisReservados(todasConnections, sender.userId, sender.role, (c) => ({ conexaoId: c.id })),
  ])
  // Um canal "do meu setor" é o que tem algum setor dono em comum comigo.
  const doMeuSetor = (teams: { teamId: number }[], defaultTeamId: number | null) => {
    const donos = new Set(teams.map((t) => t.teamId))
    if (defaultTeamId) donos.add(defaultTeamId)
    return donos.size > 0 && meusTimes.some((t) => donos.has(t))
  }
  // Sem dono nenhum: nem agente, nem setor. Só esses ficam no pool comum.
  const semDono = (teams: { teamId: number }[], ownerUserId: number | null, defaultTeamId: number | null) =>
    ownerUserId == null && teams.length === 0 && defaultTeamId == null

  const toEvo = (i: typeof instances[number]): SenderChannel => ({
    id: evoChannelId(i.instanceName),
    provider: 'evolution',
    label: i.name || i.instanceName,
    color: i.color ?? null,
    number: i.phone ?? null,
    dedicated: i.ownerUserId === sender.userId,
  })
  const toCloud = (c: typeof connections[number]): SenderChannel => ({
    id: cloudChannelId(c.id),
    provider: 'cloud_api',
    label: c.displayName || c.displayPhone || `Cloud #${c.id}`,
    color: c.color ?? null,
    number: c.displayPhone ?? null,
    dedicated: c.ownerUserId === sender.userId,
  })

  // Política de canais de envio:
  // - Admin-like (não-AGENT): vê TODOS os canais ativos (pode usar qualquer número).
  // - AGENT: vê os próprios canais dedicados + os COMPARTILHADOS (sem dono); nunca
  //   um número dedicado a OUTRO operador.
  //
  // Antes, ter QUALQUER canal dedicado fazia o operador ver SÓ os dedicados — então
  // quem tinha uma conexão Cloud dedicada perdia as instâncias Evolution
  // compartilhadas (e só conseguia enviar pela oficial). Agora os canais sem dono
  // (pool comum) sempre aparecem ao lado dos dedicados.
  // Gerenciador do Conversas: quando há matriz, ela decide por quais números
  // esta pessoa fala — antes de qualquer política por papel. Oferecer uma linha
  // que o envio vai recusar depois é pior que não oferecer: o operador escreve
  // a mensagem inteira para só então descobrir.
  const { mapaDeAcesso, canaisComAcao } = await import('./conversationAccess.js')
  const mapa = await mapaDeAcesso(sender.userId, sender.role)
  if (mapa.configurado) {
    const podem = canaisComAcao(mapa, 'create')
    if (podem.qualquer) return [...instances.map(toEvo), ...connections.map(toCloud)]
    return [
      ...instances.filter((i) => podem.instancias.has(i.id)).map(toEvo),
      ...connections.filter((c) => podem.conexoes.has(c.id)).map(toCloud),
    ]
  }

  if (sender.role !== 'AGENT') {
    return [...instances.map(toEvo), ...connections.map(toCloud)]
  }
  // AGENT: canal pessoal dele + canais dos setores dele + canais sem dono nenhum.
  // Número que pertence a OUTRO setor não aparece — antes ele aparecia como
  // "compartilhado" e o envio só falhava lá na frente, no canSendVia.
  return [
    ...instances.filter((i) =>
      i.ownerUserId === sender.userId
      || doMeuSetor(i.teams, i.defaultTeamId)
      || semDono(i.teams, i.ownerUserId, i.defaultTeamId)).map(toEvo),
    ...connections.filter((c) =>
      c.ownerUserId === sender.userId
      || doMeuSetor(c.teams, c.defaultTeamId)
      || semDono(c.teams, c.ownerUserId, c.defaultTeamId)).map(toCloud),
  ]
}

/**
 * Resolve o canal de envio para o SELETOR do frontend (espelha getProviderForSender).
 *
 * Com conversa em andamento, devolve o canal de ENTRADA e `locked: true` — o
 * seletor fica fixo nele e o operador não troca de número no meio do fio. Sem
 * conversa (primeira interação), devolve `null` de propósito: a escolha do
 * número passa a ser explícita do operador, em vez de um padrão silencioso que
 * ele não percebe.
 */
export async function suggestChannelForLead(
  leadId: number,
  sender?: { userId: number; role: string },
): Promise<{ channelId: string | null; locked: boolean }> {
  // Lead que chegou POR WhatsApp (instância ou Cloud): o número de entrada é o
  // número daquele lead, e segue sendo o padrão. É o que o contato conhece.
  const inbound = await inboundChannelForLead(leadId)
  if (inbound) return { channelId: inbound.channelId, locked: false }

  // Lead que veio de outro canal (formulário, importação, API) nunca teve
  // número: usa o padrão que o admin definiu. Sem esse padrão o operador
  // escolhia na mão a cada conversa.
  const padrao = await canalPadraoSemWhatsapp()
  return { channelId: padrao, locked: false }
}

/** Número padrão para leads que não entraram por WhatsApp.
 *  Definido por admin/superadmin em Configurações; nulo enquanto não escolherem
 *  (aí o operador escolhe na hora, como antes). */
export async function canalPadraoSemWhatsapp(): Promise<string | null> {
  const s = await prisma.setting.findUnique({ where: { key: 'conversations.default_channel_id' } }).catch(() => null)
  if (!s?.value) return null
  const id = typeof s.value === 'string' ? s.value.replace(/^"|"$/g, '') : String(s.value)
  if (!id) return null
  // some se o canal foi apagado/desativado depois de escolhido
  const canais = await resolveSenderChannels({ userId: 0, role: 'superadmin' }).catch(() => [])
  return canais.some((c: any) => c.id === id) ? id : null
}

// ─── Janela de atendimento de 24h (Cloud API) ──────────
// A Cloud API só permite mensagem de texto livre dentro de 24h da ÚLTIMA
// mensagem recebida do contato (Customer Service Window). Fora disso, apenas
// templates HSM aprovados. A Evolution (não-oficial) não tem essa restrição.
export interface WindowState {
  open: boolean
  lastInboundAt: string | null
  expiresAt: string | null
  minutesRemaining: number | null
}

const WINDOW_MS = 24 * 60 * 60 * 1000

export async function getCloudWindowState(leadId: number, connectionId?: number | null): Promise<WindowState> {
  // Só conta mensagem que chegou PELA CLOUD API. Quem abre a janela é a Meta,
  // e ela só sabe do que passou por ela: mensagem importada (Kommo, celular) ou
  // recebida pela Evolution não abre janela nenhuma. Sem este filtro, um
  // contato que responde no outro canal fazia a tela dizer "janela aberta", o
  // operador escrevia à vontade e a Meta recusava na hora do envio (131047) —
  // com o painel tendo prometido que dava.
  const lastInbound = await prisma.message.findFirst({
    where: {
      leadId,
      fromMe: false,
      provider: 'cloud_api',
      ...(connectionId ? { cloudApiConnectionId: connectionId } : {}),
    },
    orderBy: { timestamp: 'desc' },
    select: { timestamp: true },
  })
  if (!lastInbound) return { open: false, lastInboundAt: null, expiresAt: null, minutesRemaining: null }
  const last = lastInbound.timestamp.getTime()
  const expires = last + WINDOW_MS
  const remainingMs = expires - Date.now()
  return {
    open: remainingMs > 0,
    lastInboundAt: lastInbound.timestamp.toISOString(),
    expiresAt: new Date(expires).toISOString(),
    minutesRemaining: remainingMs > 0 ? Math.floor(remainingMs / 60000) : 0,
  }
}

/** Instancia o provider a partir de um channelId ("evolution:x" | "cloud:1"). */
export async function getProviderForChannel(channelId: string): Promise<{ provider: WhatsAppProvider; instanceName: string | null; cloudApiConnectionId: number | null }> {
  const [kind, ...rest] = channelId.split(':')
  const ref = rest.join(':')
  if (kind === 'evolution') {
    const inst = await prisma.whatsAppInstance.findFirst({ where: { instanceName: ref, active: true }, select: { instanceName: true } })
    if (!inst) throw new Error(`Instância Evolution "${ref}" não encontrada ou inativa`)
    return { provider: createEvolutionProviderFor(inst.instanceName), instanceName: inst.instanceName, cloudApiConnectionId: null }
  }
  if (kind === 'cloud') {
    const conn = await prisma.cloudApiConnection.findFirst({ where: { id: Number(ref), active: true }, select: { id: true, phoneNumberId: true, systemUserToken: true } })
    if (!conn) throw new Error(`Conexão Cloud API #${ref} não encontrada ou inativa`)
    return { provider: new CloudApiProvider(conn.phoneNumberId, conn.systemUserToken), instanceName: null, cloudApiConnectionId: conn.id }
  }
  throw new Error(`channelId inválido: ${channelId}`)
}

/** Retorna conexao Cloud API ativa (ou null) */
export async function getActiveCloudApiConnection() {
  return getDefaultCloudApiConnection()
}
