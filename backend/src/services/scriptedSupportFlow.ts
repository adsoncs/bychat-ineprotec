// src/services/scriptedSupportFlow.ts
//
// Fluxo de ATENDIMENTO/triagem do chatbot scripted (opt-in por Chatbot.scriptedConfig).
// Complementa o runner (scriptedChatbotFlow.ts) com as fases pós-roteiro:
//
//   waiting_agent → contato foi encaminhado a um setor e aguarda humano assumir
//   human_active  → operador assumiu; o bot silencia TOTALMENTE
//   csat          → operador encerrou; pesquisa de satisfação 1–5
//
// Também concentra: comandos globais ("menu"/"atendente"), fallback com contador,
// horário comercial no handoff, sanitização de nome e envio fora do ciclo do
// webhook — este último pelo roteador (services/outboundRouter.ts), que mantém a
// conversa no número dela, seja instância Evolution ou conexão Cloud API.
//
// Nada aqui roda para chatbots sem scriptedConfig (getSupportCfg → null).

import { prisma } from '../lib/prisma.js'
import { logEvent, EVENT_TYPES } from './leadHistory.js'
import { interpolate } from '../lib/interpolate.js'
import { getBusinessHoursConfig, isWithinBusinessHours } from './businessHours.js'
import { openConversation } from './leadConversation.js'
import { registrarModelosPadrao, modeloCruEmMemoria } from './modelosDoSistema.js'

// ── Configuração (Chatbot.scriptedConfig) ──────────────────────────────────

export interface SupportDept {
  teamId?: number | null
  label?: string
  tempoMedio?: string
}

export interface SupportCfg {
  supportFlow: boolean
  globalCommands: { menu: string[]; attendant: string[] }
  maxFallbacks: number
  fallbackDept: string
  departments: Record<string, SupportDept>
  queueWarnMinutes: number
  csat: { enabled: boolean; timeoutMin: number }
  lgpdFooter?: string
  restartOnReturn: boolean
  mediaAck: boolean
  sanitizeName: boolean
  useBusinessHours: boolean
  /**
   * Conversa que a EMPRESA abriu (primeira mensagem é nossa): a resposta do
   * contato é classificada por IA e vai direto para uma pessoa, sem menu (ver
   * abordagemHandoff.ts). Padrão ligado — é como o fluxo nasceu; `false` faz a
   * resposta seguir o roteiro normal, sem chamada de IA.
   */
  respostaAbordagem: boolean
}

const CFG_DEFAULTS: Omit<SupportCfg, 'supportFlow'> = {
  globalCommands: { menu: ['menu'], attendant: ['atendente'] },
  maxFallbacks: 3,
  fallbackDept: 'comercial',
  departments: {},
  queueWarnMinutes: 5,
  csat: { enabled: true, timeoutMin: 10 },
  restartOnReturn: true,
  mediaAck: true,
  sanitizeName: true,
  useBusinessHours: true,
  respostaAbordagem: true,
}

// Parse/valida o scriptedConfig do chatbot. null = fluxo de atendimento desligado
// (chatbots scripted clássicos de captação continuam idênticos).
export function getSupportCfg(chatbot: any): SupportCfg | null {
  const raw = chatbot?.scriptedConfig
  if (!raw || typeof raw !== 'object' || !raw.supportFlow) return null
  return {
    ...CFG_DEFAULTS,
    ...raw,
    supportFlow: true,
    globalCommands: { ...CFG_DEFAULTS.globalCommands, ...(raw.globalCommands || {}) },
    csat: { ...CFG_DEFAULTS.csat, ...(raw.csat || {}) },
    departments: raw.departments && typeof raw.departments === 'object' ? raw.departments : {},
  }
}

// ── Mensagens padrão do fluxo de atendimento ────────────────────────────────
// Editáveis por chatbot em Chatbot.scriptedMessages (mesma mecânica do runner:
// o runner faz spread destas chaves nos seus defaults). Variáveis nos comentários.

// Conteúdo INICIAL dos modelos `chatbot_atendimento_<chave>` (Modelos › Automático do sistema).
// Só cria o registro; o envio lê o banco — desligado, a mensagem não sai.
const TEXTOS_INICIAIS: Record<string, string> = {
  greetingKnown: 'Olá, {{nome}}! Que bom ter você por aqui. 🌱', // {{nome}}
  greetingReturning: 'Olá, {{nome}}! Que bom te ver de novo por aqui. 🌱\nComo podemos te ajudar hoje?', // {{nome}}
  menuFallback1: 'Hmm, não consegui identificar essa opção. 🤔\n\nPode digitar apenas o *número* correspondente à área desejada?\n\nSe preferir, digite *atendente* para falar diretamente com uma pessoa.',
  handoffInHours: 'Obrigado pelas informações, {{nome}}! ✅\n\nJá encaminhei tudo para o nosso time e um especialista vai assumir esta conversa em instantes.\n\n⏱️ Tempo médio de resposta: até {{tempo_medio}} em horário comercial.', // {{nome}} {{tempo_medio}} {{departamento}}
  handoffOffHours: '{{nome}}, no momento o nosso time não está online. 🌙\n\nMas pode deixar sua mensagem por aqui: ela ficará registrada e será uma das nossas prioridades assim que retornarmos.', // {{nome}} {{departamento}}
  queueWait: '{{nome}}, nosso time está finalizando outros atendimentos, mas já sabemos que você está aqui. Em breve um especialista assume a conversa — obrigado pela paciência! 🙏', // {{nome}}
  agentTakeover: '{{nome}}, o(a) especialista *{{nome_atendente}}* assumiu o seu atendimento e vai falar com você agora.', // {{nome}} {{nome_atendente}}
  csatAsk: '{{nome}}, foi um prazer falar com você!\n\nAntes de encerrarmos, sua opinião é muito importante para nós:\n\nDe *1 a 5*, como você avalia este atendimento?\n(1 = muito insatisfeito · 5 = muito satisfeito)', // {{nome}}
  csatInvalid: 'Para registrar sua avaliação, responda apenas com um número de *1 a 5*. 🙂',
  csatThanksHigh: 'Muito obrigado, {{nome}}! 💚\n\nAgradecemos a sua confiança. Sempre que precisar, estaremos por aqui — é só chamar.\n\nAté logo!', // {{nome}}
  csatThanksLow: 'Muito obrigado pelo retorno, {{nome}}. Sentimos não ter atendido plenamente às suas expectativas — sua avaliação já foi encaminhada à nossa coordenação e vamos trabalhar para melhorar.\n\nAgradecemos a sua confiança.', // {{nome}}
  csatTimeoutThanks: 'Muito obrigado, {{nome}}! 💚\n\nAgradecemos a sua confiança. Sempre que precisar, estaremos por aqui — é só chamar.\n\nAté logo!', // {{nome}}
  mediaAck: 'Recebi seu arquivo, obrigado! ✅',
  idleWarn: '{{nome}}, notei que você ficou um tempinho sem responder — ainda está por aí?\n\nSe preferir continuar depois, sem problemas: é só mandar uma mensagem a qualquer momento que retomamos de onde paramos.', // {{nome}}
  idleClosed: 'Como não tivemos retorno, vou encerrar este atendimento por enquanto — mas fique tranquilo(a), {{nome}}: sempre que precisar, é só mandar um "oi" que começamos de novo.\n\nAgradecemos o seu contato.', // {{nome}}
  // ── Interpretação flexível (IA) ──
  intentRouted: 'Entendi! Vou te encaminhar para o time de *{{departamento}}*. 🌱', // {{departamento}} {{nome}}
  nameFixAsk: 'Claro! Como você prefere que eu te chame?',
  nameFixDone: 'Combinado, {{nome}}! Corrigido aqui. 🌱', // {{nome}}
  duvidaRedirect: 'Boa pergunta! Quem responde isso melhor é o nosso time. Para eu te encaminhar certo, escolha a área:', // {{nome}}
  // ── Resposta a uma abordagem NOSSA (services/abordagemHandoff.ts) ──
  // Precisam morar aqui, e não no módulo que as usa: `supportMsg` só interpola o
  // que encontra neste mapa (ou no override do chatbot). Ficando de fora, saíam
  // com "{{nome}}" e "{{agente}}" crus na tela do cliente.
  abordagemLigacao: 'Perfeito, {{nome}}! Já avisei o time e {{agente}} te liga em instantes. 🌱', // {{nome}} {{agente}}
  abordagemDepois: 'Combinado, {{nome}}! Anotei aqui: *{{quando}}*. {{agente}} te procura nesse horário. 🌱', // {{nome}} {{agente}} {{quando}}
  abordagemTexto: 'Ótimo, {{nome}}! {{agente}} continua com você por aqui mesmo, é só um instante. 🌱', // {{nome}} {{agente}}
  abordagemDuvida: 'Boa pergunta, {{nome}}! Já passei para {{agente}}, que te responde por aqui. 🌱', // {{nome}} {{agente}}
  abordagemSemInteresse: 'Tudo bem, {{nome}}. Obrigado pelo retorno — não vamos mais te procurar. Se mudar de ideia, é só chamar. 🌱', // {{nome}}
  abordagemIndefinido: 'Obrigado pelo retorno, {{nome}}! {{agente}} assume a conversa com você por aqui. 🌱', // {{nome}} {{agente}}
}
const ROTULOS: Record<string, string> = {
  greetingKnown: 'saudação a contato conhecido',
  greetingReturning: 'saudação a quem volta',
  menuFallback1: 'opção do menu não reconhecida',
  handoffInHours: 'encaminhado à equipe (em horário)',
  handoffOffHours: 'encaminhado à equipe (fora do horário)',
  queueWait: 'aviso de espera na fila',
  agentTakeover: 'atendente assumiu',
  csatAsk: 'pedido de avaliação (1 a 5)',
  csatInvalid: 'avaliação inválida',
  csatThanksHigh: 'agradecimento (avaliação boa)',
  csatThanksLow: 'agradecimento (avaliação baixa)',
  csatTimeoutThanks: 'agradecimento (sem avaliação)',
  mediaAck: 'arquivo recebido',
  idleWarn: 'aviso de inatividade',
  idleClosed: 'encerramento por inatividade',
  intentRouted: 'encaminhado pela IA ao setor',
  nameFixAsk: 'pergunta como prefere ser chamado',
  nameFixDone: 'nome corrigido',
  duvidaRedirect: 'dúvida — escolher a área',
  abordagemLigacao: 'resposta à abordagem — ligação',
  abordagemDepois: 'resposta à abordagem — depois',
  abordagemTexto: 'resposta à abordagem — por texto',
  abordagemDuvida: 'resposta à abordagem — dúvida',
  abordagemSemInteresse: 'resposta à abordagem — sem interesse',
  abordagemIndefinido: 'resposta à abordagem — indefinida',
}
// Registro SOB DEMANDA, não na importação: este módulo agora vive no código comum,
// e registrar no import criaria os ~25 modelos `chatbot_atendimento_*` em Modelos
// de TODA instalação — inclusive nas que nunca ligaram o fluxo de atendimento.
// Quem chama é services/modelosOpcionais.ts, só quando algum chatbot tem
// `scriptedConfig.supportFlow`. Idempotente.
export function registrarModelosDoAtendimento(): void {
  registrarModelosPadrao(Object.entries(TEXTOS_INICIAIS).map(([k, body]) => ({
    key: `chatbot_atendimento_${k}`, name: ` — ${ROTULOS[k] || k}`, channel: 'whatsapp' as const, body,
  })))
}

// Remove artefatos de pontuação quando uma variável interpolou vazia
// ("Olá, {{nome}}!" sem nome → "Olá!"; "{{nome}}, o especialista…" → "O especialista…").
export function tidyInterpolated(s: string): string {
  return s
    .replace(/,\s*([,!?.:;])/g, '$1')
    .replace(/^[ \t]*,\s*/gm, '')
    .replace(/^([a-zà-ú])/, (c) => c.toLocaleUpperCase('pt-BR'))
}

// Resolve mensagem do fluxo de atendimento (override do chatbot → default daqui).
export function supportMsg(chatbot: any, key: string, vars: Record<string, any> = {}): string {
  const overrides = (chatbot?.scriptedMessages as Record<string, string> | null) || {}
  const tpl = (overrides[key] && String(overrides[key]).trim()) || modeloCruEmMemoria(`chatbot_atendimento_${key}`) || ''
  return tidyInterpolated(interpolate(tpl, vars))
}

// ── Normalização / nome ─────────────────────────────────────────────────────

// lowercase + remove acentos + tira pontuação das pontas ("Menú!" → "menu").
export function normalizeCommand(text: string): string {
  return String(text || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function matchGlobalCommand(cfg: SupportCfg, text: string): 'menu' | 'attendant' | null {
  const t = normalizeCommand(text)
  if (!t || t.length > 30) return null // frases longas nunca são comando
  if ((cfg.globalCommands.menu || []).some((k) => normalizeCommand(k) === t)) return 'menu'
  if ((cfg.globalCommands.attendant || []).some((k) => normalizeCommand(k) === t)) return 'attendant'
  return null
}

// Sinais de que a mensagem é sobre CONDUZIR a conversa (voltar, trocar de setor,
// falar com gente, corrigir o nome) e não a resposta à pergunta em curso.
//
// Serve de porteiro para o classificador de IA: sem ele, toda resposta de
// qualificação — que é texto livre e longo — viraria uma chamada de modelo. Erra
// para o lado barato: se não casar aqui, o roteiro determinístico segue como
// sempre seguiu.
const SINAIS_DE_CONTROLE = [
  'menu', 'voltar', 'volta', 'opcoes', 'opcao', 'errei', 'errado', 'errada', 'enganei', 'engano',
  'atendente', 'humano', 'pessoa', 'alguem', 'setor', 'departamento', 'area',
  'nome', 'chamo', 'chamar', 'sou o', 'sou a', 'na verdade', 'trocar', 'mudar', 'outro',
]

export function pareceComandoDeControle(text: string): boolean {
  const t = normalizeCommand(text)
  if (!t) return false
  if (t.length > 120) return false // desabafo longo é conteúdo, não comando
  return SINAIS_DE_CONTROLE.some((s) => new RegExp(`(^|\\s)${s}(\\s|$)`).test(t))
}

// Primeiro nome com inicial maiúscula ("maria clara silva" → "Maria").
export function sanitizeFirstName(raw: string | null | undefined): string {
  const cleaned = String(raw || '')
    .replace(/[^\p{L}\p{M}\s'-]/gu, ' ') // só letras (com acento), espaços, hífen, apóstrofo
    .replace(/\s+/g, ' ')
    .trim()
  const first = cleaned.split(' ')[0] || ''
  if (!first) return ''
  return first.charAt(0).toLocaleUpperCase('pt-BR') + first.slice(1).toLocaleLowerCase('pt-BR')
}

export function firstName(nome: string | null | undefined): string {
  return String(nome || '').trim().split(/\s+/)[0] || ''
}

// Saudação e apresentação que costumam vir grudadas na resposta do "como posso
// te chamar?" — precisam sair antes de recortar o primeiro nome, senão viram
// nome ("Oi, sou o Pedro" → "Oi").
const NAME_GREETING = /^(?:ol[áa]|oi|e a[íi]|bom dia|boa tarde|boa noite)[\s,.!-]*/iu
// O artigo é opcional mas tem que ser palavra inteira: sem o `\s+` depois de
// (o|a), "meu nome é Ana" perde o "A" e vira "Na".
const NAME_INTRO = /^(?:meu nome (?:é|e)|me chamo|pode (?:me )?chamar de|aqui (?:é|e)|eu sou|sou)\s+(?:(?:o|a)\s+)?/iu

/**
 * A resposta ao "como posso te chamar?" é mesmo um nome?
 *
 * Caso real (lead 4064, 12/08): o contato abriu a conversa já com a demanda —
 * "VCS TERIAM COMPRA P NOSSA FAZENDA DE CRÉDITO DE CARBONO NO AMAZONAS... TEMOS
 * 118 MIL HECTARES" — e como `sanitizeFirstName` só recorta a primeira palavra e
 * nunca reprova, o bot passou a tratá-lo por "Vcs" no resto do atendimento.
 *
 * Reprova frase longa, pergunta, número e excesso de palavras. Na dúvida reprova:
 * o custo de recusar um nome esquisito é usar o pushName; o de aceitar uma frase
 * é chamar o cliente pelo nome errado em todas as mensagens seguintes.
 */
// Nomes que o próprio sistema atribui quando não sabe quem é. "Lead LP" é o
// default de createLeadFromForm (formFlow.ts:160) e chegava a ser cumprimentado
// como se fosse gente ("Olá, Lead!").
const NAME_PLACEHOLDERS = new Set([
  'lead', 'lead lp', 'webchat', 'cliente', 'contato', 'desconhecido', 'whatsapp', 'usuario', 'usuário',
])

export function looksLikePersonName(raw: string | null | undefined): boolean {
  const s = String(raw || '').trim()
  if (!s || s.length > 40) return false
  if (NAME_PLACEHOLDERS.has(s.toLocaleLowerCase('pt-BR'))) return false
  if (/[?!]/.test(s)) return false          // pergunta ou exclamação → é demanda
  if (/\d/.test(s)) return false            // valor, quantidade, documento
  const palavras = s.split(/\s+/).filter(Boolean)
  if (palavras.length > 4) return false     // nome completo cabe em 4 palavras
  return palavras.every((p) => /^[\p{L}\p{M}'-]+$/u.test(p))
}

/**
 * Extrai o primeiro nome de uma resposta livre, ou '' se ela não for um nome.
 * '' é o sinal para o chamador cair no pushName (ou seguir sem nome).
 */
export function extractPersonName(raw: string | null | undefined): string {
  let s = String(raw || '').trim()
  s = s.replace(NAME_GREETING, '').trim()
  s = s.replace(NAME_INTRO, '').trim()
  if (!looksLikePersonName(s)) return ''
  return sanitizeFirstName(s)
}

// Nome "de verdade" (não placeholder/telefone) → dá pra pular o ASK_NAME.
export function isMeaningfulName(nome: string | null | undefined, phone: string): boolean {
  const n = String(nome || '').trim()
  if (n.length < 2) return false
  const lower = n.toLowerCase()
  if (['lead', 'cliente', 'contato', 'desconhecido'].includes(lower)) return false
  const digits = n.replace(/\D/g, '')
  if (digits.length >= 8) return false // parece telefone
  if (phone && digits && phone.includes(digits) && digits.length >= 4) return false
  return true
}

function deptLabel(cfg: SupportCfg, deptKey: string): string {
  const d = cfg.departments[deptKey]
  if (d?.label) return d.label
  return deptKey ? deptKey.charAt(0).toUpperCase() + deptKey.slice(1) : ''
}

// ── Envio fora do ciclo do webhook (instância vinculada ao chatbot) ─────────

// Envia texto pelo chatbot (fora do ciclo do webhook) E persiste em Message —
// o operador vê a mensagem no histórico da conversa.
export async function sendBotMessage(leadId: number, phone: string, text: string, chatbot: { id: number; name?: string | null }): Promise<boolean> {
  // Vai pelo roteador de saída, e não direto na Evolution: um chatbot pode estar
  // vinculado a uma conexão Cloud API em vez de a uma instância — é o caso do
  // terram, onde este envio NUNCA acontecia ("Chatbot #1 não tem instância
  // WhatsApp vinculada") e todo follow-up fora do ciclo do webhook morria aqui.
  // O roteador segue mandando pelo número da conversa; a diferença é que agora
  // ele reconhece o número oficial como um deles.
  let r: Awaited<ReturnType<typeof import('./outboundRouter.js').enviarAutomatico>>
  try {
    const { enviarAutomatico } = await import('./outboundRouter.js')
    r = await enviarAutomatico({ leadId, phone, texto: text })
  } catch (err: any) {
    console.error(`[supportFlow] falha ao enviar WhatsApp para ${phone}:`, err?.message ?? err)
    return false
  }
  try {
    await prisma.message.create({ data: {
      leadId, fromMe: true, body: r.textoEnviado, mediaType: 'text', provider: r.canal,
      ...(r.instanceName ? { evolutionInstance: r.instanceName } : {}),
      ...(r.cloudApiConnectionId ? { cloudApiConnectionId: r.cloudApiConnectionId } : {}),
      senderName: chatbot.name || 'Chatbot',
      isInternal: false, externalId: r.externalId, ack: r.externalId ? 1 : 0, timestamp: new Date(),
    } })
    await prisma.lead.update({ where: { id: leadId }, data: { lastMessageAt: new Date() } })
  } catch (e) { console.warn(`[supportFlow] save outgoing: ${e}`) }
  return true
}

// ── Estado (lead.formData._script) fora do ciclo do runner ─────────────────

async function loadLeadState(leadId: number): Promise<{ lead: any; state: any } | null> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } })
  if (!lead) return null
  const state = ((lead.formData as any) || {})._script || null
  return { lead, state }
}

export async function saveScriptState(leadId: number, state: any, opts: { completed?: boolean } = {}): Promise<void> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { formData: true } })
  const fd: any = (lead?.formData as any) || {}
  await prisma.lead.update({
    where: { id: leadId },
    data: { formData: { ...fd, _script: state }, ...(opts.completed !== undefined ? { completed: opts.completed } : {}) },
  })
}

async function getChatbotForLead(lead: any): Promise<any | null> {
  if (!lead?.chatbotId) return null
  return prisma.chatbot.findUnique({ where: { id: lead.chatbotId } })
}

// ── Handoff → waiting_agent ─────────────────────────────────────────────────

// Encaminha o contato ao setor e entra em waiting_agent. Chamado DENTRO do ciclo
// do runner (send/persist do próprio runner → mesma instância/persistência).
export async function enterWaitingAgent(opts: {
  leadId: number
  state: any
  chatbot: any
  cfg: SupportCfg
  deptKey: string
  send: (leadId: number, body: string) => Promise<void>
  persist: (leadId: number, state: any, completed?: boolean) => Promise<void>
  log?: (m: string) => void
}): Promise<void> {
  const { leadId, state, chatbot, cfg, deptKey, send, persist } = opts
  const dept = cfg.departments[deptKey] || {}

  // Garante o time do setor (o applyOptionRoute normalmente já fez; aqui cobre o
  // comando "atendente" e o handoff por fallback, que não passam pelo route).
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { nome: true, teamId: true, funnelId: true } })
  if (dept.teamId != null && lead && lead.teamId !== dept.teamId) {
    await prisma.lead.update({ where: { id: leadId }, data: { teamId: dept.teamId, assignedAt: new Date() } }).catch(() => {})
  }

  // Dentro/fora do horário comercial.
  let inHours = true
  if (cfg.useBusinessHours) {
    const bh = await getBusinessHoursConfig().catch(() => null)
    if (bh) inHours = isWithinBusinessHours(bh)
  }

  const vars = { nome: firstName(lead?.nome), tempo_medio: dept.tempoMedio || '5 minutos', departamento: deptLabel(cfg, deptKey) }
  await send(leadId, supportMsg(chatbot, inHours ? 'handoffInHours' : 'handoffOffHours', vars))

  // Abre o ticket em Conversas (senão fica na Caixa de entrada bruta).
  await openConversation(leadId, { reason: 'chatbot_escalation' }).catch(() => {})

  state.phase = 'waiting_agent'
  state.dept = deptKey
  state.deptTeamId = dept.teamId ?? state.deptTeamId ?? null
  state.handoffAt = new Date().toISOString()
  state.queueWarnedAt = undefined
  state.fallbackCount = 0
  await persist(leadId, state)

  logEvent({
    leadId, type: EVENT_TYPES.CHATBOT_HANDOFF, category: 'lifecycle',
    title: `Chatbot: encaminhado ao atendimento (${deptLabel(cfg, deptKey)})${inHours ? '' : ' — fora do horário'}`,
    channel: 'whatsapp', source: 'chatbot', actorType: 'lead',
    // funnelId no metadata → o workflow de aviso pode filtrar pelo funil de
    // atendimento (emitDomain expõe event.funnelId a partir daqui).
    metadata: { deptKey, departamento: deptLabel(cfg, deptKey), teamId: dept.teamId ?? null, funnelId: lead?.funnelId ?? null, inBusinessHours: inHours },
  })
}

// ── Hooks do atendimento humano (chamados pelas rotas) ──────────────────────

// Operador assumiu (claim/assign): avisa o contato e silencia o bot.
export async function notifyAgentTakeover(leadId: number, agent: { userId: number; name?: string | null }): Promise<void> {
  const ls = await loadLeadState(leadId)
  if (!ls?.state || ls.state.phase !== 'waiting_agent') return
  const chatbot = await getChatbotForLead(ls.lead)
  const cfg = getSupportCfg(chatbot)
  if (!cfg) return

  ls.state.phase = 'human_active'
  await saveScriptState(leadId, ls.state)

  if (ls.lead.whatsapp) {
    const body = supportMsg(chatbot, 'agentTakeover', { nome: firstName(ls.lead.nome), nome_atendente: firstName(agent.name) || 'nosso especialista' })
    if (body) await sendBotMessage(leadId, ls.lead.whatsapp, body, chatbot)
  }
  logEvent({
    leadId, type: 'agent_takeover' as any, category: 'lifecycle',
    title: `Atendimento assumido — bot silenciado`, channel: 'whatsapp', source: 'chatbot',
    actorType: 'operator', userId: agent.userId, userName: agent.name || undefined,
  })
}

// Operador respondeu manualmente sem "Assumir": silencia o bot sem mensagem.
export async function markHumanActive(leadId: number): Promise<void> {
  const ls = await loadLeadState(leadId)
  if (!ls?.state || ls.state.phase !== 'waiting_agent') return
  const cfg = getSupportCfg(await getChatbotForLead(ls.lead))
  if (!cfg) return
  ls.state.phase = 'human_active'
  await saveScriptState(leadId, ls.state)
}

// ── CSAT ────────────────────────────────────────────────────────────────────

// Operador encerrou o atendimento → dispara a pesquisa (se aplicável).
export async function maybeStartCsat(leadId: number, byUserId?: number): Promise<void> {
  const ls = await loadLeadState(leadId)
  if (!ls?.state || !['human_active', 'waiting_agent'].includes(ls.state.phase)) return
  const chatbot = await getChatbotForLead(ls.lead)
  const cfg = getSupportCfg(chatbot)
  if (!cfg?.csat.enabled || !ls.lead.whatsapp) {
    // Sem CSAT: encerra o ciclo do bot direto (próximo contato recomeça).
    if (cfg) { ls.state.phase = 'done'; await saveScriptState(leadId, ls.state, { completed: true }) }
    return
  }

  const sent = await sendBotMessage(leadId, ls.lead.whatsapp, supportMsg(chatbot, 'csatAsk', { nome: firstName(ls.lead.nome) }), chatbot)
  if (!sent) { ls.state.phase = 'done'; await saveScriptState(leadId, ls.state, { completed: true }); return }

  await prisma.chatbotCsat.create({ data: {
    leadId, chatbotId: chatbot.id, teamId: ls.lead.teamId ?? null,
    agentUserId: ls.lead.assignedUserId ?? byUserId ?? null,
  } })

  ls.state.phase = 'csat'
  ls.state.csatAskedAt = new Date().toISOString()
  ls.state.csatAgentUserId = ls.lead.assignedUserId ?? byUserId ?? null
  ls.state.csatInvalidWarned = false
  await saveScriptState(leadId, ls.state) // completed fica como a rota de encerramento deixou

  logEvent({
    leadId, type: 'csat_asked' as any, category: 'system',
    title: 'Pesquisa de satisfação enviada', channel: 'whatsapp', source: 'chatbot', actorType: 'system',
    metadata: { agentUserId: ls.state.csatAgentUserId },
  })
}

// Resposta do contato durante a fase csat (chamada pelo runner). Retorna true
// quando tratou a mensagem (o runner deve dar return).
export async function handleCsatReply(opts: {
  leadId: number
  state: any
  chatbot: any
  cfg: SupportCfg
  text: string
  send: (leadId: number, body: string) => Promise<void>
  persist: (leadId: number, state: any, completed?: boolean) => Promise<void>
}): Promise<boolean> {
  const { leadId, state, chatbot, cfg, text, send, persist } = opts
  const m = String(text || '').match(/[1-5]/)
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { nome: true, assignedUserId: true, teamId: true } })
  const nome = firstName(lead?.nome)

  if (!m) {
    // Reask leve, uma única vez — depois silencia (o timeout encerra).
    if (!state.csatInvalidWarned) {
      state.csatInvalidWarned = true
      await persist(leadId, state)
      await send(leadId, supportMsg(chatbot, 'csatInvalid', { nome }))
    }
    return true
  }

  const rating = parseInt(m[0], 10)
  const lowScore = rating <= 3
  const open = await prisma.chatbotCsat.findFirst({ where: { leadId, rating: null, respondedAt: null }, orderBy: { id: 'desc' } })
  if (open) {
    await prisma.chatbotCsat.update({ where: { id: open.id }, data: { rating, lowScore, respondedAt: new Date() } })
  }
  logEvent({
    leadId, type: (lowScore ? 'csat_low' : 'csat_answered') as any, category: 'system',
    title: `CSAT: nota ${rating}/5${lowScore ? ' — encaminhada à coordenação' : ''}`,
    channel: 'whatsapp', source: 'chatbot', actorType: 'lead',
    metadata: { rating, lowScore, agentUserId: state.csatAgentUserId ?? lead?.assignedUserId ?? null, teamId: lead?.teamId ?? null },
  })

  await send(leadId, supportMsg(chatbot, lowScore ? 'csatThanksLow' : 'csatThanksHigh', { nome }))
  state.phase = 'done'
  await persist(leadId, state, true)
  return true
}

// Timeout da pesquisa (chamado pelo poller): agradece e encerra sem nota.
export async function closeCsatTimeout(lead: any, chatbot: any, state: any): Promise<void> {
  const open = await prisma.chatbotCsat.findFirst({ where: { leadId: lead.id, rating: null, respondedAt: null }, orderBy: { id: 'desc' } })
  if (open) await prisma.chatbotCsat.update({ where: { id: open.id }, data: { respondedAt: new Date() } })
  if (lead.whatsapp) {
    await sendBotMessage(lead.id, lead.whatsapp, supportMsg(chatbot, 'csatTimeoutThanks', { nome: firstName(lead.nome) }), chatbot)
  }
  state.phase = 'done'
  await saveScriptState(lead.id, state, { completed: true })
  logEvent({
    leadId: lead.id, type: 'csat_timeout' as any, category: 'system',
    title: 'CSAT: sem resposta (timeout) — atendimento encerrado',
    channel: 'whatsapp', source: 'chatbot', actorType: 'system',
  })
}
