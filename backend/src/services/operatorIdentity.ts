// src/services/operatorIdentity.ts
//
// Identificação do operador para o CONTATO: quem está falando com ele.
// Muita empresa atende por um número único e genérico ("Atendimento"), então do
// lado de lá todas as mensagens parecem vir da mesma pessoa — inclusive depois
// de uma transferência.
//
// Duas peças, ligadas/desligadas em Configurações › Conversas:
//   1. prefixo com nome + setor no início da mensagem
//   2. aviso ao contato quando a conversa muda de responsável
//
// O WhatsApp não tem cabeçalho de remetente dentro da conversa: "acima da
// mensagem" é, na prática, a primeira linha do corpo. Por isso áudio e figurinha
// ficam de fora — não têm legenda onde escrever.

import { prisma } from '../lib/prisma.js'
import { EVENT_TYPES } from './leadHistory.js'

export interface ConversationIdentityConfig {
  /** Prefixar mensagens com o nome de quem está falando. */
  identificarOperador: boolean
  /** 'sempre' = toda mensagem · 'ao_mudar' = só quando troca quem responde. */
  identificarModo: 'sempre' | 'ao_mudar'
  /** Incluir o setor junto do nome. */
  incluirSetor: boolean
  /** Avisar o contato quando a conversa passa para outra pessoa/setor. */
  avisarTransferencia: boolean
  /**
   * O que o contato vê na transferência: só a pessoa, a pessoa com a equipe, ou
   * só a equipe. Empresa que não quer expor o nome de quem atende usa 'setor';
   * consultório onde a relação é com a pessoa usa 'agente'.
   */
  avisarTransferenciaModo: 'agente' | 'agente_setor' | 'setor'
  /** Texto do aviso. Variáveis: {quem} (resolve pelo modo), {agente}, {setor}. */
  avisarTransferenciaTexto: string
}

const PADRAO: ConversationIdentityConfig = {
  identificarOperador: false,
  identificarModo: 'ao_mudar',
  incluirSetor: true,
  // Desligado de fábrica: aviso ao contato é decisão de cada operação, não algo
  // que deva começar a sair sozinho numa atualização.
  avisarTransferencia: false,
  // Neutro de propósito: serve a clínica, escola, loja, escritório e B2B sem
  // soar deslocado. E diz que o histórico foi repassado — a dor de quem é
  // transferido é ter de explicar tudo de novo.
  avisarTransferenciaModo: 'agente_setor',
  avisarTransferenciaTexto: '{quem} vai continuar o seu atendimento a partir de agora. Todo o histórico da conversa já foi repassado.',
}

const CACHE_TTL_MS = 60_000
let _cache: { cfg: ConversationIdentityConfig; expiresAt: number } | null = null

export function invalidateIdentityCache(): void {
  _cache = null
}

export async function getIdentityConfig(): Promise<ConversationIdentityConfig> {
  if (_cache && _cache.expiresAt > Date.now()) return _cache.cfg
  const row = await prisma.setting.findUnique({ where: { key: 'conversation_identity' } }).catch(() => null)
  const cfg = row?.value && typeof row.value === 'object'
    ? { ...PADRAO, ...(row.value as any) }
    : PADRAO
  _cache = { cfg, expiresAt: Date.now() + CACHE_TTL_MS }
  return cfg
}

/** Nome curto do operador: displayName → primeiro nome do cadastro → e-mail. */
export function nomeExibicao(user: { displayName?: string | null; name?: string | null; email?: string | null }): string {
  const d = user.displayName?.trim()
  if (d) return d
  const n = user.name?.trim()
  if (n) return n.split(/\s+/)[0] || n
  return (user.email || 'Atendimento').split('@')[0] || 'Atendimento'
}

/**
 * Setor do operador. O usuário não tem `teamId`: a relação é N:N via TeamMember,
 * então alguém pode estar em mais de uma equipe. Nesse caso vale o setor da
 * CONVERSA (é dele que o contato está sendo atendido); só sem isso caímos na
 * primeira equipe do operador.
 */
async function setorDoOperador(userId: number, teamIdDaConversa?: number | null): Promise<string | null> {
  if (teamIdDaConversa) {
    const t = await prisma.team.findUnique({ where: { id: teamIdDaConversa }, select: { name: true } })
    if (t?.name) return t.name
  }
  const m = await prisma.teamMember.findFirst({
    where: { userId },
    orderBy: [{ isLeader: 'desc' }, { id: 'asc' }],
    select: { team: { select: { name: true } } },
  })
  return m?.team?.name ?? null
}

/** Tipos de mensagem que comportam o prefixo. Áudio e figurinha não têm legenda;
 *  template HSM tem corpo aprovado pela Meta e não aceita texto na frente. */
export function aceitaPrefixo(mediaType: string): boolean {
  return mediaType === 'text' || mediaType === 'image' || mediaType === 'video' || mediaType === 'document'
}

/**
 * Decide o prefixo desta mensagem. Devolve '' quando não deve identificar.
 *
 * No modo 'ao_mudar', compara com a última mensagem enviada ao contato: se foi
 * a mesma pessoa, não repete. Sem isso a conversa vira "*Rafael* oi / *Rafael*
 * tudo bem? / *Rafael* já verifico" — ruído que anula o propósito.
 */
export async function montarPrefixo(opts: {
  leadId: number
  mediaType: string
  actorUserId: number
}): Promise<string> {
  const cfg = await getIdentityConfig()
  if (!cfg.identificarOperador) return ''
  if (!aceitaPrefixo(opts.mediaType)) return ''

  const user = await prisma.user.findUnique({
    where: { id: opts.actorUserId },
    select: { id: true, name: true, email: true, displayName: true },
  })
  if (!user) return ''

  if (cfg.identificarModo === 'ao_mudar') {
    // Última mensagem que o contato recebeu de um humano. Nota interna não conta
    // (não chega nele) e mensagem do bot também não — o contato não viu nome ali.
    const ultima = await prisma.message.findFirst({
      where: { leadId: opts.leadId, fromMe: true, isInternal: false },
      orderBy: { timestamp: 'desc' },
      select: { senderName: true },
    })
    // Compara pelo MESMO valor que o envio grava em senderName (o nome de
    // cadastro), não pelo nome de exibição: são campos diferentes, e comparar
    // com o de exibição nunca casaria — o prefixo sairia em toda mensagem
    // mesmo no modo "só quando muda".
    const gravadoAgora = user.name || user.email || 'Agente'
    if (ultima?.senderName && ultima.senderName === gravadoAgora) return ''
  }

  const nome = nomeExibicao(user)
  if (!cfg.incluirSetor) return `*${nome}*\n`

  const lead = await prisma.lead.findUnique({ where: { id: opts.leadId }, select: { teamId: true } })
  const setor = await setorDoOperador(opts.actorUserId, lead?.teamId ?? null)
  return setor ? `*${nome} · ${setor}*\n` : `*${nome}*\n`
}

/**
 * Monta o texto do aviso.
 *
 * Operador sem setor é comum (empresa pequena, agente fora de equipe), e nesse
 * caso o trecho do setor precisa sumir INTEIRO — não só a variável. Trocar
 * apenas `{setor}` por vazio deixaria "Rafael, da equipe , vai continuar…".
 * Por isso a limpeza remove a preposição junto, em qualquer redação que o
 * cliente escreva ("do setor", "da equipe", "do time", "(setor)").
 */
export function montarTextoAviso(
  modelo: string,
  agente: string,
  setor: string | null,
  modo: 'agente' | 'agente_setor' | 'setor' = 'agente_setor',
): string {
  // {quem} resolve pelo modo escolhido — um texto só atende os três formatos,
  // em vez de obrigar a empresa a reescrever a frase para tirar o nome ou a
  // equipe. Quem quiser controle fino continua usando {agente} e {setor}.
  const quem = modo === 'setor'
    ? (setor ? `A equipe de ${setor}` : agente)
    : modo === 'agente' || !setor
      ? agente
      : `${agente}, da equipe ${setor},`
  let t = (modelo || '').replace(/\{quem\}/g, quem)

  // No modo 'setor' o nome não pode vazar por um {agente} escrito à mão.
  t = t.replace(/\{agente\}/g, modo === 'setor' ? (setor ? `a equipe de ${setor}` : agente) : agente)
  if (setor && modo !== 'agente') return t.replace(/\{setor\}/g, setor)

  t = t
    // Aposto entre vírgulas ("Rafael, da equipe X, vai…"): tira as DUAS, senão
    // sobra "Rafael, vai…".
    .replace(/,[^,]*\{setor\}[^,]*,/gi, ' ')
    .replace(/[,\s]*\(\s*\{setor\}\s*\)/gi, '')
    .replace(/[,\s]*\b(d[aoe]s?|no|na)\s+(equipe|setor|time|departamento|área|area)\s+\{setor\}/gi, '')
    .replace(/[,\s]*\b(equipe|setor|time|departamento)\s+\{setor\}/gi, '')
    .replace(/\{setor\}/g, '')
  return t
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;!?])/g, '$1')
    .replace(/,\s*,/g, ',')
    // Conector que ficou pendurado no fim ("… para Rafael —").
    .replace(/[\s,;:—–-]+$/g, '')
    .trim()
}

// ── Aviso de transferência ─────────────────────────────────────────────────

/** Não repete o aviso na mesma conversa dentro desta janela. Protege contra a
 *  reatribuição em massa (gestor move 20 conversas) e contra idas e vindas. */
const ANTI_REPETICAO_MIN = 10

/**
 * Avisa o CONTATO que a conversa passou para outra pessoa/setor.
 *
 * Guardas — o aviso só faz sentido num recorte estreito, e errar aqui significa
 * mandar "você está sendo atendido por Fulano" para quem nunca falou com
 * ninguém, ou às 3h da manhã:
 *   - conversa precisa estar ABERTA (não é atribuição de lead novo na fila)
 *   - o contato já precisa ter recebido alguma mensagem humana; sem isso não há
 *     transferência do ponto de vista dele, é só o primeiro atendimento
 *   - dentro do horário de atendimento
 *   - sem aviso repetido na mesma conversa em ANTI_REPETICAO_MIN minutos
 *
 * Nunca lança: um aviso que falha não pode derrubar a transferência em si.
 */
export async function notifyAssignmentChange(opts: {
  leadId: number
  novoUserId: number | null
  novoTeamId: number | null
  /** Quem operou a transferência — é em nome dele que a mensagem sai. */
  actorUserId: number
  actorRole: string
}): Promise<{ enviado: boolean; motivo?: string }> {
  try {
    const cfg = await getIdentityConfig()
    if (!cfg.avisarTransferencia) return { enviado: false, motivo: 'desligado' }
    if (!opts.novoUserId) return { enviado: false, motivo: 'sem responsável novo' }

    const lead = await prisma.lead.findUnique({
      where: { id: opts.leadId },
      select: { id: true, conversationOpenedAt: true, conversationClosedAt: true },
    })
    if (!lead?.conversationOpenedAt || lead.conversationClosedAt) {
      return { enviado: false, motivo: 'conversa não está aberta' }
    }

    const jaFalou = await prisma.message.findFirst({
      where: { leadId: opts.leadId, fromMe: true, isInternal: false },
      select: { id: true },
    })
    if (!jaFalou) return { enviado: false, motivo: 'contato ainda não recebeu mensagem humana' }

    const { getBusinessHoursConfig, isWithinBusinessHours } = await import('./businessHours.js')
    const bh = await getBusinessHoursConfig()
    if (bh.enabled && !isWithinBusinessHours(bh)) {
      return { enviado: false, motivo: 'fora do horário de atendimento' }
    }

    const recente = await prisma.leadEvent.findFirst({
      where: {
        leadId: opts.leadId,
        type: EVENT_TYPES.MESSAGE_SENT,
        title: { contains: 'Aviso de transferência' },
        createdAt: { gt: new Date(Date.now() - ANTI_REPETICAO_MIN * 60_000) },
      },
      select: { id: true },
    })
    if (recente) return { enviado: false, motivo: 'aviso recente já enviado' }

    const novo = await prisma.user.findUnique({
      where: { id: opts.novoUserId },
      select: { name: true, email: true, displayName: true },
    })
    if (!novo) return { enviado: false, motivo: 'responsável não encontrado' }

    const setor = await setorDoOperador(opts.novoUserId, opts.novoTeamId)

    const texto = montarTextoAviso(cfg.avisarTransferenciaTexto, nomeExibicao(novo), setor, cfg.avisarTransferenciaModo)

    const { sendTicketMessage } = await import('./ticketMessageSender.js')
    const r = await sendTicketMessage({
      leadId: opts.leadId,
      body: texto.trim(),
      mediaType: 'text',
      actor: { userId: opts.actorUserId, role: opts.actorRole },
      origin: 'panel',
    })
    if (!r.ok) return { enviado: false, motivo: r.error }

    await prisma.leadEvent.create({
      data: {
        leadId: opts.leadId,
        type: EVENT_TYPES.MESSAGE_SENT,
        category: 'communication',
        title: 'Aviso de transferência enviado ao contato',
        channel: 'whatsapp',
        source: 'panel',
        actorType: 'system',
        description: texto.slice(0, 200),
      },
    }).catch(() => {})

    return { enviado: true }
  } catch (e: any) {
    console.error('[operatorIdentity] aviso de transferência falhou:', e?.message)
    return { enviado: false, motivo: e?.message }
  }
}
