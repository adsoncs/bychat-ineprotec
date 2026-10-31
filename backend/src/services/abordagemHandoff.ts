// src/services/abordagemHandoff.ts
//
// O que fazer quando o cliente responde a uma abordagem que PARTIU DAQUI.
//
// Regra de fundo: se fomos nós que puxamos assunto, tem que ter gente do outro
// lado. Nenhum caminho aqui devolve o contato ao menu de setores — ele nunca
// pediu triagem, respondeu à nossa pergunta. Todos terminam com um humano
// assumindo, exceto quando o cliente pede para não ser mais procurado.
//
// A IA só CLASSIFICA (ver journey/abordagemIntent.ts). As frases enviadas são
// determinísticas e editáveis por chatbot, como o resto do fluxo de atendimento.

import { prisma } from '../lib/prisma.js'
import { supportMsg, enterWaitingAgent, firstName, type SupportCfg } from './scriptedSupportFlow.js'
import { interpretarRespostaAbordagem, type AbordagemIntent } from './journey/abordagemIntent.js'
import { registrarPedidoDeSaida } from './messageGovernance.js'
import { logEvent, EVENT_TYPES } from './leadHistory.js'

/** Quantos turnos da conversa vão para a IA junto com a mensagem nova. */
const TURNOS_DE_CONTEXTO = 8

// Os textos são os modelos `chatbot_atendimento_abordagem*` (scriptedSupportFlow.ts), junto
// com os demais do fluxo de atendimento: é de lá que `supportMsg` os lê, é lá
// que o chatbot pode sobrescrevê-los, e é isso que garante a interpolação.

const MENSAGEM_POR_INTENT: Record<AbordagemIntent, string> = {
  quer_ligacao: 'abordagemLigacao',
  agendar_depois: 'abordagemDepois',
  prefere_texto: 'abordagemTexto',
  sem_interesse: 'abordagemSemInteresse',
  duvida: 'abordagemDuvida',
  indefinido: 'abordagemIndefinido',
}

/**
 * A conversa começou com uma mensagem NOSSA?
 *
 * Olha a primeira mensagem não-interna do lead: se ela é `fromMe`, o contato
 * nunca nos procurou — foi abordado. Também devolve o texto daquela abordagem,
 * que é o que dá sentido à resposta dele.
 */
async function abordagemQueAbriuAConversa(leadId: number): Promise<string | null> {
  const primeira = await prisma.message.findFirst({
    where: { leadId, isInternal: false },
    orderBy: { timestamp: 'asc' },
    select: { fromMe: true, body: true },
  })
  if (!primeira || !primeira.fromMe) return null
  return primeira.body || '(mensagem sem texto)'
}

/**
 * Últimos turnos da conversa, do mais antigo ao mais novo, com a mensagem que
 * acabou de chegar no fim.
 *
 * Ela precisa ser anexada à mão: neste ponto do fluxo o `saveIncoming` ainda não
 * rodou, então o banco termina na NOSSA abordagem. Um histórico terminando em
 * `assistant` é recusado pela Anthropic ("the conversation must end with a user
 * message"), o que derrubava a classificação para o fallback e, com a OpenAI sem
 * cota, para `indefinido` — todo mundo virava handoff genérico.
 */
async function historicoRecente(leadId: number, atual: string): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  const msgs = await prisma.message.findMany({
    where: { leadId, isInternal: false },
    orderBy: { timestamp: 'desc' },
    take: TURNOS_DE_CONTEXTO,
    select: { fromMe: true, body: true },
  })
  const turnos = msgs
    .reverse()
    .filter((m) => (m.body || '').trim())
    .map((m) => ({ role: m.fromMe ? ('assistant' as const) : ('user' as const), content: String(m.body).slice(0, 600) }))

  const texto = String(atual || '').trim()
  if (texto) turnos.push({ role: 'user', content: texto.slice(0, 600) })
  // Defesa de cinto e suspensório: sob qualquer caminho, nunca terminar em assistant.
  while (turnos.length && turnos[turnos.length - 1]!.role === 'assistant') turnos.pop()
  return turnos
}

async function nomeDoAgente(leadId: number): Promise<string> {
  const { resolveNomeDoAgente } = await import('./workflowActions.js')
  const lead = await prisma.lead.findUnique({ where: { id: leadId } })
  const nome = lead ? await resolveNomeDoAgente(lead).catch(() => '') : ''
  return nome || 'nosso time'
}

/**
 * Trata a resposta a uma abordagem nossa. Devolve `true` quando assumiu a
 * conversa — o roteiro não deve rodar. `false` = não era abordagem nossa, siga
 * o fluxo normal.
 */
export async function tratarRespostaDeAbordagem(opts: {
  leadId: number
  text: string
  chatbot: any
  cfg: SupportCfg
  send: (leadId: number, body: string) => Promise<void>
  persist: (leadId: number, state: any, completed?: boolean) => Promise<void>
  app?: { log?: { warn: (m: string) => void; info?: (m: string) => void } }
}): Promise<boolean> {
  const { leadId, text, chatbot, cfg, send, persist, app } = opts

  const abordagem = await abordagemQueAbriuAConversa(leadId)
  if (!abordagem) return false

  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { nome: true } })
  const nome = firstName(lead?.nome || '')

  const { intent, quando } = await interpretarRespostaAbordagem(
    abordagem,
    await historicoRecente(leadId, text),
    { extra: chatbot?.interpretPrompt ?? null },
  )
  app?.log?.info?.(`[abordagem] lead ${leadId}: ${intent}${quando ? ` (${quando})` : ''}`)

  const state: any = { leadId, phase: 'asking', answers: {}, fallbackCount: 0, abordagemAtiva: true }
  const vars = { nome, agente: await nomeDoAgente(leadId), quando: quando || 'no horário combinado' }
  const corpo = supportMsg(chatbot, MENSAGEM_POR_INTENT[intent], vars)

  // Pedido de saída: não encaminha para ninguém e não insiste.
  if (intent === 'sem_interesse') {
    if (corpo) await send(leadId, corpo)
    await registrarPedidoDeSaida(leadId).catch(() => {})
    await prisma.lead.update({
      where: { id: leadId },
      data: { outcome: 'lost', outcomeAt: new Date(), outcomeNote: 'Recusou a abordagem ativa pelo WhatsApp' },
    }).catch(() => {})
    await persist(leadId, { ...state, phase: 'done' }, true)
    logEvent({
      leadId, type: EVENT_TYPES.STATUS_CHANGED, category: 'lifecycle',
      title: 'Recusou a abordagem — não receberá novos contatos',
      channel: 'whatsapp', source: 'abordagem', actorType: 'lead',
      description: String(text).slice(0, 200),
    })
    return true
  }

  // Todo o resto vai para gente. Fomos nós que abrimos a conversa: devolver ao
  // menu seria pedir que o cliente se explique de novo, do zero.
  if (corpo) await send(leadId, corpo)

  if (quando) {
    // O horário que ele pediu não pode ficar só na bolha da conversa: é a
    // informação de que o atendente precisa para não ligar na hora errada.
    await prisma.leadNote.create({
      data: { leadId, userName: 'Atendimento automático', content: `Pediu contato: ${quando}` },
    }).catch(() => {})
  }

  logEvent({
    leadId, type: EVENT_TYPES.MESSAGE_RECEIVED, category: 'communication',
    title: `Respondeu à abordagem: ${intent}${quando ? ` (${quando})` : ''}`,
    channel: 'whatsapp', source: 'abordagem', actorType: 'lead',
    description: String(text).slice(0, 200),
  })

  await enterWaitingAgent({
    leadId, state, chatbot, cfg,
    deptKey: cfg.fallbackDept || 'comercial',
    send: async () => {},   // a frase de handoff já foi enviada acima
    persist,
  })
  return true
}
