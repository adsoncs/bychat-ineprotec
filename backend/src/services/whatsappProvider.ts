// src/services/whatsappProvider.ts
// Abstração de provider WhatsApp: Evolution API vs Cloud API Oficial

import { prisma } from '../lib/prisma.js'
import { channelForUserTeams, userTeamIds } from './channelTeams.js'
import { humanizeWhatsAppError } from '../lib/whatsappErrors.js'
import {
  sendTextMessage,
  sendMediaMessage,
  sendTemplateMessage,
  sendInteractiveMessage,
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

export interface WhatsAppProvider {
  readonly providerName: 'evolution' | 'cloud_api'
  sendText(phone: string, text: string, options?: WhatsAppSendOptions): Promise<WhatsAppSendResult>
  sendMedia(phone: string, mediaUrl: string, mediaType: string, caption?: string, fileName?: string): Promise<WhatsAppSendResult>
  sendTemplate(phone: string, templateName: string, language: string, components?: any[]): Promise<WhatsAppSendResult>
  sendInteractive(phone: string, interactive: any): Promise<WhatsAppSendResult>
  sendAudio(phone: string, audioUrl: string): Promise<WhatsAppSendResult>
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
      throw new Error(humanizeWhatsAppError(parsed, res.status))
    }

    return parsed
  }

  async sendText(phone: string, text: string, options?: WhatsAppSendOptions): Promise<WhatsAppSendResult> {
    const body: any = { number: toEvoNumber(phone), text }
    if (options?.quotedExternalId) {
      // Evolution v2: passa o key.id da mensagem citada — o backend resolve fromMe/remoteJid.
      body.quoted = { key: { id: options.quotedExternalId } }
    }
    const result = await this.evoFetch(`/message/sendText/${this.instanceName}`, 'POST', body)
    return { messageId: result?.key?.id || null, provider: 'evolution' }
  }

  async sendMedia(phone: string, mediaUrl: string, mediaType: string, caption?: string, fileName?: string): Promise<WhatsAppSendResult> {
    // Figurinha tem rota própria na Evolution. Mandá-la por /sendMedia com
    // mediatype 'sticker' é rejeitado (só image/video/document/audio são
    // aceitos) e a mensagem chegava como arquivo, não como figurinha.
    if (mediaType === 'sticker') return this.sendSticker(phone, mediaUrl)

    // GIF é MP4 sem áudio: vai como vídeo, com `gifPlayback` para o WhatsApp
    // tocar em loop no lugar de exibir um player.
    const isGif = mediaType === 'gif'
    const result = await this.evoFetch(`/message/sendMedia/${this.instanceName}`, 'POST', {
      number: toEvoNumber(phone),
      mediatype: isGif ? 'video' : mediaType === 'document' ? 'document' : mediaType,
      media: mediaUrl,
      fileName: fileName || undefined,
      caption: caption || undefined,
      ...(isGif ? { gifPlayback: true } : {}),
    })
    return { messageId: result?.key?.id || null, provider: 'evolution' }
  }

  /** Figurinha (.webp) — rota dedicada da Evolution. */
  async sendSticker(phone: string, stickerUrl: string): Promise<WhatsAppSendResult> {
    const result = await this.evoFetch(`/message/sendSticker/${this.instanceName}`, 'POST', {
      number: toEvoNumber(phone),
      sticker: stickerUrl,
    })
    return { messageId: result?.key?.id || null, provider: 'evolution' }
  }

  async sendAudio(phone: string, audioUrl: string): Promise<WhatsAppSendResult> {
    const result = await this.evoFetch(`/message/sendWhatsAppAudio/${this.instanceName}`, 'POST', {
      number: toEvoNumber(phone),
      audio: audioUrl,
    })
    return { messageId: result?.key?.id || null, provider: 'evolution' }
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
  async checkNumbers(phones: string[]): Promise<Array<{ number: string; exists: boolean; jid: string | null }>> {
    if (!phones.length) return []
    const data = await this.evoFetch(`/chat/whatsappNumbers/${this.instanceName}`, 'POST', {
      numbers: phones.map((p) => toEvoNumber(p)),
    })
    const arr = Array.isArray(data) ? data : (data?.data ?? [])
    return arr.map((r: any) => ({
      number: String(r?.number ?? ''),
      exists: !!(r?.exists ?? r?.numberExists),
      jid: r?.jid ? String(r.jid) : null,
    }))
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
}

// ─── Factory Functions ──────────────────────────────────

/** Retorna provider padrao baseado na configuracao do sistema */
export async function getDefaultProvider(): Promise<WhatsAppProvider> {
  // Verificar setting de preferencia
  const setting = await prisma.setting.findUnique({ where: { key: 'whatsapp.default_provider' } }).catch(() => null)
  const pref = setting ? String(setting.value).replace(/"/g, '') : 'auto'

  if (pref === 'cloud_api' || pref === 'auto') {
    const conn = await prisma.cloudApiConnection.findFirst({ where: { active: true } })
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
    const conn = await prisma.cloudApiConnection.findFirst({ where: { active: true } })
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
    const cloudConn = await prisma.cloudApiConnection.findFirst({ where: { active: true } })
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

/** channelId ("evolution:x" | "cloud:1") do canal dedicado de um usuário, ou null. */
async function dedicatedChannelIdForUser(userId: number): Promise<string | null> {
  const ownInstance = await prisma.whatsAppInstance.findFirst({
    where: { ownerUserId: userId, active: true },
    orderBy: { id: 'asc' },
    select: { instanceName: true },
  })
  if (ownInstance) return evoChannelId(ownInstance.instanceName)
  const ownCloud = await prisma.cloudApiConnection.findFirst({
    where: { ownerUserId: userId, active: true },
    orderBy: { id: 'asc' },
    select: { id: true },
  })
  if (ownCloud) return cloudChannelId(ownCloud.id)
  return null
}

/**
 * Retorna o provider WhatsApp para enviar uma mensagem ao lead. O número que
 * "possui" a conversa é o do DONO do lead (assignedUserId): os leads de um agente
 * falam SEMPRE pelo número dele, não importa quem clique em enviar — assim as
 * respostas voltam para a linha do dono e ele não perde a conversa. Ordem:
 *
 *   1. DONO do lead (assignedUserId) tem canal dedicado (instância Evolution ou
 *      conexão Cloud)? → SEMPRE usa ele. (Flavia é dona → sai pelo terram_n2,
 *      mesmo que o Adson/Luiz responda e mesmo que o lead tenha entrado por
 *      outro número.)
 *   2. Lead sem dono / dono sem número → canal dedicado do REMETENTE (quem está
 *      atendendo fala pela própria linha).
 *   2b. Ninguém com número pessoal → número do SETOR (o canal cujos setores
 *      donos incluem o setor do dono do lead ou, na falta, o do remetente).
 *   3. Ninguém com número dedicado → espelha o canal de ENTRADA do lead
 *      (responde pelo mesmo número pelo qual ele falou por último).
 *   4. AGENT sem nada → erro. Admin sem nada → provider padrão.
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
  // 1. DONO do lead com número dedicado → identidade da conversa. Tem prioridade
  //    sobre o remetente e sobre o espelhamento do canal de entrada.
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

  // 3. Ninguém com número dedicado → espelha o canal de ENTRADA do lead: a
  //    resposta sai pelo MESMO canal/número pela qual o lead falou por último
  //    (Cloud API ou Evolution). Olha a ÚLTIMA mensagem RECEBIDA (fromMe=false),
  //    e NÃO a mera existência de uma msg Cloud no histórico.
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
      ?? await prisma.cloudApiConnection.findFirst({ where: { active: true } })
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

  // 4. Admin sem instância dedicada → comportamento atual (instância padrão)
  const provider = await getProviderForLead(lead)
  const inst = provider instanceof EvolutionProvider
    ? provider.instanceName
    : (process.env.EVOLUTION_INSTANCE ?? null)
  return { provider, instanceName: inst }
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
  const [instances, connections, meusTimes] = await Promise.all([
    prisma.whatsAppInstance.findMany({ where: { active: true }, orderBy: { id: 'asc' }, include: { teams: { select: { teamId: true } } } }),
    prisma.cloudApiConnection.findMany({ where: { active: true }, orderBy: { id: 'asc' }, include: { teams: { select: { teamId: true } } } }),
    userTeamIds(sender.userId),
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
    number: i.phone ?? null,
    dedicated: i.ownerUserId === sender.userId,
  })
  const toCloud = (c: typeof connections[number]): SenderChannel => ({
    id: cloudChannelId(c.id),
    provider: 'cloud_api',
    label: c.displayName || c.displayPhone || `Cloud #${c.id}`,
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

/** Resolve o canal SUGERIDO de envio (espelha getProviderForSender, para o
 *  seletor do modal já abrir no número certo): (1) canal dedicado do DONO do
 *  lead; (2) canal dedicado do remetente; (3) canal de ENTRADA do lead. */
export async function suggestChannelForLead(
  leadId: number,
  sender?: { userId: number; role: string },
): Promise<string | null> {
  // 1. Número dedicado do DONO do lead tem prioridade (a conversa "pertence" a
  //    esse número, independente de quem está enviando).
  const leadRow = await prisma.lead.findUnique({ where: { id: leadId }, select: { assignedUserId: true } })
  if (leadRow?.assignedUserId) {
    const ownerCh = await dedicatedChannelIdForUser(leadRow.assignedUserId)
    if (ownerCh) return ownerCh
  }
  // 2. Senão, número dedicado do remetente.
  if (sender) {
    const senderCh = await dedicatedChannelIdForUser(sender.userId)
    if (senderCh) return senderCh
  }
  // 2b. Número do SETOR (do dono do lead e, na falta, do remetente) — espelha o
  //     degrau equivalente de getProviderForSender.
  for (const uid of [leadRow?.assignedUserId, sender?.userId]) {
    if (!uid) continue
    const teamCh = await channelForUserTeams(uid)
    if (teamCh?.kind === 'evolution' && teamCh.instanceName) return evoChannelId(teamCh.instanceName)
    if (teamCh?.kind === 'cloud') return cloudChannelId(teamCh.id)
  }
  // 3. Sugere o canal de ENTRADA do lead: a última mensagem RECEBIDA (fromMe=false)
  // define por onde ele falou por último. Só cai para a última mensagem qualquer
  // quando não há nenhuma recebida (ex.: primeiro contato 100% outbound). Usar a
  // última msg "qualquer" sozinha criava um ciclo: uma resposta enviada pela Cloud
  // passava a sugerir Cloud para sempre, mesmo após o lead voltar pela Evolution.
  const last =
    (await prisma.message.findFirst({
      where: { leadId, fromMe: false, isInternal: false },
      orderBy: { timestamp: 'desc' },
      select: { provider: true, evolutionInstance: true, cloudApiConnectionId: true },
    }))
    ?? (await prisma.message.findFirst({
      where: { leadId, isInternal: false },
      orderBy: { timestamp: 'desc' },
      select: { provider: true, evolutionInstance: true, cloudApiConnectionId: true },
    }))
  if (!last) return null
  if (last.provider === 'cloud_api' && last.cloudApiConnectionId) return cloudChannelId(last.cloudApiConnectionId)
  if (last.provider === 'evolution' && last.evolutionInstance) return evoChannelId(last.evolutionInstance)
  return null
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

export async function getCloudWindowState(leadId: number): Promise<WindowState> {
  const lastInbound = await prisma.message.findFirst({
    where: { leadId, fromMe: false },
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
  return prisma.cloudApiConnection.findFirst({ where: { active: true } })
}
