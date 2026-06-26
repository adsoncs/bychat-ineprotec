// src/services/scriptedChatbotFlow.ts
//
// Runner de chatbot DETERMINÍSTICO para WhatsApp. Conduz, por mensagens, EXATAMENTE
// a mesma jornada do formulário conversacional vinculado (Chatbot.formId): mesmas
// perguntas na mesma ordem, mesma validação, MESMA qualificação ("negativo vence",
// positiveValues, qualifyNegative/Positive via resolveQualification) e mesmas etapas
// do funil, terminando no agendamento (createBooking → REUNIAO).
//
// A fidelidade vem de reusar formFlow.ts (mesmas funções da rota de form) e o form
// é lido on-the-fly — se o editor de forms mudar, o chatbot acompanha.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import type { SendFn, SendInteractiveFn, ProviderType } from './chatbotFlow.js'
import type { OriginData } from './originDetection.js'
import { logEvent, EVENT_TYPES } from './leadHistory.js'
import { createLeadFromForm, moveLeadStage, buildCustomFieldValues } from './formFlow.js'
import { pickOperatorForTeam } from './teamRouting.js'
import { parseAnswer, evaluateQualification, resolveStageMove, nextStep } from './journey/journeyEngine.js'
import { interpretSelectAnswer } from './journey/interpret.js'
import { getActiveMeetingType, getMeetingTypeSlots, createBooking } from './schedulingService.js'
import { interpolate } from '../lib/interpolate.js'
import { buildChoices, choicesToText, type Choice } from '../lib/waInteractive.js'
import { buildFlowSendPayload, ingestFlowResponse, flowInputFields } from './whatsappFlows.js'

// Envia um conjunto de opções como botões/lista (Cloud API) ou texto numerado
// (fallback). textRender permite um texto de log/fallback customizado (ex.: slots).
type SendChoicesFn = (
  leadId: number,
  body: string,
  choices: Choice[],
  textRender?: (c: Choice[]) => string,
  listOpts?: { button?: string; sectionTitle?: string },
) => Promise<void>

const WD = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const MAX_SLOTS = 10

// Mensagens interativas do runner. Editáveis por chatbot em Chatbot.scriptedMessages
// (override por chave); estes são os defaults usados quando a chave não foi ajustada.
// Variáveis disponíveis por chave estão indicadas nos comentários.
const DEFAULT_SCRIPTED_MESSAGES: Record<string, string> = {
  invalidSelect: 'Não entendi. 🙂 Por favor, responda com o *número* da opção.',
  invalidAnswer: '{{erro}}. Vamos tentar de novo:', // {{erro}}
  noMeetingType: 'Perfeito! Em breve entraremos em contato para agendar. 😊',
  noSlots: 'No momento não há horários disponíveis. Nossa equipe vai entrar em contato para combinar o melhor horário com você. 😊',
  slotPrompt: '{{titulo}}:\n\n{{horarios}}\n\n_Responda com o número do horário._', // {{titulo}} {{horarios}}
  invalidSlot: 'Não entendi o horário. Responda com o número:\n\n{{horarios}}', // {{horarios}}
  slotTaken: '{{erro}}. Escolha outro:\n\n{{horarios}}', // {{erro}} {{horarios}}
  bookingUnavailable: 'Agendamento indisponível no momento. Nossa equipe entrará em contato.',
  bookingConfirmed: '✅ Reunião agendada para *{{horario}}*!\n\nVocê vai receber os detalhes por aqui. Até lá! 🚀', // {{horario}} {{nome}}
  disqualifiedFallback: 'Obrigado pelas respostas! Em breve entraremos em contato. 😊',
  qualifiedDone: 'Obrigado! Em breve entraremos em contato. 😊',
}

// Resolve a mensagem de uma chave: override do chatbot → default; interpola variáveis.
function msg(chatbot: any, key: keyof typeof DEFAULT_SCRIPTED_MESSAGES | string, vars: Record<string, any> = {}): string {
  const overrides = (chatbot?.scriptedMessages as Record<string, string> | null) || {}
  const tpl = (overrides[key] && String(overrides[key]).trim()) || DEFAULT_SCRIPTED_MESSAGES[key] || ''
  return interpolate(tpl, vars)
}

interface ScriptState {
  stepIndex: number
  answers: Record<string, any>
  leadId: number | null
  // flow_pending: enviamos um WhatsApp Flow e aguardamos o nfm_reply (respostas).
  phase: 'asking' | 'scheduling' | 'done' | 'disqualified' | 'flow_pending'
  slots?: Array<{ startAt: string; text: string }>
}

// Lock leve por telefone: serializa o processamento por número para evitar que
// duas mensagens em rajada pulem/repitam passos (single-process tsx).
const locks = new Map<string, Promise<void>>()

function stripTags(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#0?39;/g, "'").replace(/&quot;/g, '"')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function fieldKeyByMap(fields: any[], mapTo: string): string | null {
  const f = fields.find((x) => x?.mapTo === mapTo)
  return f?.key ?? null
}

// Texto da pergunta de um campo (label limpo + dica de placeholder/opções).
function questionText(field: any): string {
  const label = stripTags(field.label) || field.key
  if (field.type === 'select' && Array.isArray(field.options) && field.options.length) {
    const opts = field.options.map((o: any, i: number) => `${i + 1}) ${stripTags(o.label)}`).join('\n')
    return `${label}\n\n${opts}\n\n_Responda com o número da opção._`
  }
  if (field.placeholder) return `${label}`
  return label
}

export async function processScriptedChatbotMessage(
  phone: string,
  text: string,
  app: FastifyInstance,
  messageId: string | undefined,
  sendFn: SendFn,
  provider: ProviderType,
  originData?: OriginData | null,
  chatbotId?: number | null,
  instanceName?: string | null,
  chatbot?: any,
  form?: any,
  sendInteractiveFn?: SendInteractiveFn | null,
  interactiveReplyId?: string | null,
  flowResponse?: Record<string, any> | null,
  promoteFunnelId?: number | null,
  promoteStageKey?: string | null,
): Promise<void> {
  const prev = locks.get(phone) ?? Promise.resolve()
  const run = prev.then(() =>
    _process(phone, text, app, messageId, sendFn, provider, originData, chatbotId, instanceName, chatbot, form, sendInteractiveFn, interactiveReplyId, flowResponse, promoteFunnelId, promoteStageKey)
      .catch((e) => { app.log.error(`[scriptedChatbot] erro: ${e?.stack || e}`) }),
  )
  locks.set(phone, run.then(() => undefined))
  await run
}

async function _process(
  phone: string, text: string, app: FastifyInstance, messageId: string | undefined,
  sendFn: SendFn, provider: ProviderType, originData: OriginData | null | undefined,
  chatbotId: number | null | undefined, instanceName: string | null | undefined,
  chatbot: any, form: any,
  sendInteractiveFn?: SendInteractiveFn | null, interactiveReplyId?: string | null,
  flowResponse?: Record<string, any> | null,
  promoteFunnelId?: number | null, promoteStageKey?: string | null,
): Promise<void> {
  if (!form || !Array.isArray(form.fields)) { app.log.warn('[scriptedChatbot] form sem fields'); return }
  const fields: any[] = form.fields
  const settings: any = form.settings || {}
  const attendantName = chatbot?.name || 'Atendimento'

  // Dedup de messageId (rajada / reentrega do webhook).
  if (messageId) {
    const dup = await prisma.message.findFirst({ where: { externalId: messageId, fromMe: false }, select: { id: true } })
    if (dup) return
  }

  // ── Helpers de envio/persistência (espelham chatbotFlow.ts) ──
  const saveOutgoing = async (leadId: number, body: string, extId: string | null) => {
    try {
      await prisma.message.create({ data: {
        leadId, fromMe: true, body, mediaType: 'text', provider,
        ...(provider === 'evolution' && instanceName ? { evolutionInstance: instanceName } : {}),
        senderName: attendantName, isInternal: false, externalId: extId, ack: extId ? 1 : 0, timestamp: new Date(),
      } })
      await prisma.lead.update({ where: { id: leadId }, data: { lastMessageAt: new Date() } })
    } catch (e) { app.log.warn(`[scriptedChatbot] save outgoing: ${e}`) }
  }
  const saveIncoming = async (leadId: number, body: string) => {
    try {
      await prisma.message.create({ data: {
        leadId, fromMe: false, body, mediaType: 'text', provider,
        ...(provider === 'evolution' && instanceName ? { evolutionInstance: instanceName } : {}),
        senderName: body ? body.slice(0, 60) : phone, externalId: messageId || null, timestamp: new Date(),
      } })
      await prisma.lead.update({ where: { id: leadId }, data: { unreadMessages: { increment: 1 }, lastMessageAt: new Date() } }).catch(() => {})
    } catch (e) { app.log.warn(`[scriptedChatbot] save incoming: ${e}`) }
  }
  const send = async (leadId: number, body: string) => {
    const r = await sendFn(phone, body)
    await saveOutgoing(leadId, body, r.messageId)
  }
  // Envia opções como botões/lista nativos (Cloud API) com fallback texto numerado.
  // O log/conversa sempre guarda a versão textual (operador vê o conteúdo igual).
  const sendChoices: SendChoicesFn = async (leadId, body, choices, textRender, listOpts) => {
    const logText = textRender ? textRender(choices) : choicesToText(body, choices)
    const interactive = (provider === 'cloud_api' && sendInteractiveFn) ? buildChoices(body, choices, listOpts) : null
    if (interactive) {
      try {
        const r = await sendInteractiveFn!(phone, interactive)
        await saveOutgoing(leadId, logText, r.messageId)
        return
      } catch (e: any) {
        // Falha no envio interativo (payload/janela 24h) → degrada para texto numerado.
        app.log.warn(`[scriptedChatbot] interactive falhou, fallback texto: ${e?.message || e}`)
      }
    }
    await send(leadId, logText)
  }
  // Pergunta um campo: select → botões/lista; demais → texto.
  const askField = async (leadId: number, field: any) => {
    if (field?.type === 'select' && Array.isArray(field.options) && field.options.length) {
      const body = stripTags(field.label) || field.key
      const choices: Choice[] = field.options.map((o: any) => ({ id: String(o.value), title: stripTags(o.label) }))
      await sendChoices(leadId, body, choices)
    } else {
      await send(leadId, questionText(field))
    }
  }
  // F3: tenta enviar o formulário como um WhatsApp Flow (tela única). Só Cloud API
  // e se houver um CloudApiFlow publicado para o form. Retorna true se enviou.
  const tryStartFlow = async (leadId: number, nudge = false): Promise<boolean> => {
    if (!(provider === 'cloud_api' && sendInteractiveFn)) return false
    const flowRow = await prisma.cloudApiFlow.findFirst({
      where: { formId: form.id, status: 'published', NOT: { metaFlowId: null } },
      orderBy: { id: 'desc' },
    }).catch(() => null)
    if (!flowRow?.metaFlowId) return false
    // Mensagem e CTA vêm do editor visual (CloudApiFlow.bodyText/cta); fallback aos
    // textos antigos. São do payload de envio → editar não exige republicar.
    const welcome = stripTags(form?.settings?.conversational?.welcomeText)
    const editedBody = (flowRow.bodyText && flowRow.bodyText.trim()) || ''
    const body = nudge
      ? (editedBody ? `${editedBody}` : 'Por favor, toque no botão abaixo e preencha o formulário. 🙂')
      : (editedBody || welcome || 'Para começar, toque no botão e preencha rapidamente:')
    const payload = buildFlowSendPayload(flowRow.metaFlowId, flowRow.screenId, {
      bodyText: body, cta: (flowRow.cta && flowRow.cta.trim()) || 'Preencher', flowToken: `lead_${leadId}_${Date.now()}`,
    })
    try {
      const r = await sendInteractiveFn!(phone, payload)
      await saveOutgoing(leadId, '[formulário enviado]', r.messageId)
      return true
    } catch (e: any) {
      app.log.warn(`[scriptedChatbot] flow falhou, fallback perguntas: ${e?.message || e}`)
      return false
    }
  }
  // F3: ingere as respostas do Flow (nfm_reply) de uma vez, qualifica e avança.
  const handleFlowResponse = async (leadId: number, state: ScriptState): Promise<void> => {
    const ingested = ingestFlowResponse(form, flowResponse || {})
    Object.assign(state.answers, ingested)
    for (const f of flowInputFields(form)) {
      if (f.key in state.answers) await applyAnswerToLead(leadId, f, state.answers)
    }
    const q = evaluateQualification(fields, state.answers, settings)
    if (q?.finish) {
      const mv = resolveStageMove(q, { promoteFunnelId, formFunnelId: form.funnelId ?? null, isFinish: true })
      if (mv) await moveLeadStage(leadId, mv.funnelId, mv.stageKey, 'chatbot', { forwardOnly: mv.forwardOnly })
      const finishMsg = q.finishAction === 'redirect' && q.redirectUrl
        ? `${stripTags(settings?.successMessage) || msg(chatbot, 'disqualifiedFallback')}\n\n${q.redirectUrl}`
        : (stripTags(q.message) || msg(chatbot, 'disqualifiedFallback'))
      await send(leadId, finishMsg)
      state.phase = 'disqualified'
      await persist(leadId, state, true)
      logEvent({ leadId, type: EVENT_TYPES.DIAGNOSIS_COMPLETED, category: 'lifecycle', title: 'Chatbot (Flow): lead desqualificado', channel: 'whatsapp', source: 'chatbot', actorType: 'lead' })
      return
    }
    const schedField = fields.find((f) => f?.type === 'scheduling')
    if (schedField) {
      await enterSchedulingPhase(leadId, state, fields, settings, form, schedField, send, sendChoices, persist, app, chatbot, promoteFunnelId)
      return
    }
    await finishQualifiedFlow(leadId, state, fields, settings, form, send, persist, chatbot, promoteFunnelId)
  }

  // ── Localiza lead + estado ──
  const lead = await prisma.lead.findFirst({ where: { whatsapp: phone }, orderBy: { createdAt: 'desc' } })
  const fd: any = (lead?.formData as any) || {}
  let state: ScriptState | null = fd._script || null

  // ── Início (sem lead ou sem estado de script) ──
  if (!lead || !state) {
    const body = { ctwaClid: originData?.ctwaClid ?? null, originType: originData?.originType ?? null, utmSource: originData?.utmSource ?? null, gclid: originData?.gclid ?? null }
    let leadId = lead?.id ?? null
    if (!leadId) {
      // Funil da conexão (promoteFunnelId) sobrepõe o funil do form — leads do
      // chatbot caem no funil escolhido na conexão. Sem ele → comportamento atual.
      const created = await createLeadFromForm(form, fields, {}, body, instanceName || '', null,
        promoteFunnelId ? { funnelId: promoteFunnelId, stageKey: promoteStageKey ?? null } : undefined, {
        channel: 'whatsapp', leadSource: 'whatsapp', chatbotId: chatbotId ?? null,
        routing: { source: 'whatsapp', chatbotId: chatbotId ?? null, instanceName: instanceName ?? null },
        forceWhatsapp: phone, qualificationSource: 'form',
      })
      leadId = created?.leadId ?? null
    } else {
      // Lead já existe (veio do site/agendamento, conversa anterior ou da rota de
      // atendimento humano) e ainda não tem estado de roteiro → createLeadFromForm
      // não roda e ele nunca seria promovido. Coloca-o no funil/etapa da conexão
      // (ou do form) já no início, para cair no Kanban mesmo que abandone antes de
      // qualificar/agendar. forwardOnly não regride um lead já avançado; só promove
      // quem está sem funil (caixa de entrada bruta) ou já no funil-alvo — evita
      // puxar para cá um lead que está em outro funil.
      const baseFunnel = promoteFunnelId ?? form.funnelId ?? null
      const baseStage = promoteStageKey ?? form.stageKey ?? 'NOVO'
      if (baseFunnel && (lead!.funnelId == null || lead!.funnelId === baseFunnel)) {
        await moveLeadStage(leadId, baseFunnel, baseStage, 'chatbot', { forwardOnly: true })
      }
    }
    if (!leadId) { app.log.warn('[scriptedChatbot] não criou lead'); return }
    logEvent({ leadId, type: EVENT_TYPES.DIAGNOSIS_STARTED, category: 'lifecycle', title: `Chatbot iniciado: ${chatbot?.name || form.name}`, channel: 'whatsapp', source: 'chatbot', actorType: 'lead' })

    const first = nextStep(fields, 0)
    const newState: ScriptState = { stepIndex: first.index, answers: {}, leadId, phase: 'asking' }
    // F3: se o chatbot coleta via WhatsApp Flow, envia o formulário único (welcome
    // embutido no corpo do Flow) e aguarda o nfm_reply — sem perguntar campo a campo.
    if (chatbot?.useFlow && await tryStartFlow(leadId)) {
      newState.phase = 'flow_pending'
      await persist(leadId, newState)
      return
    }
    // Welcome + primeira pergunta (fluxo pergunta-a-pergunta).
    const welcome = (chatbot?.greetingMessage && chatbot.greetingMessage.trim())
      || [stripTags(settings?.conversational?.welcomeTitle), stripTags(settings?.conversational?.welcomeText)].filter(Boolean).join('\n\n')
    if (welcome) await send(leadId, welcome)
    if (first.kind !== 'finish') await askField(leadId, first.field)
    await persist(leadId, newState)
    return
  }

  const leadId = state.leadId ?? lead.id

  // Conversa encerrada → não reinicia o roteiro. Se o chatbot tem IA pós-atendimento
  // ligada, a IA assume com o contexto do desfecho; senão, só registra (atendimento humano).
  if (lead.completed || state.phase === 'done' || state.phase === 'disqualified') {
    await saveIncoming(leadId, text)
    if (chatbot?.postChatAi) {
      const { postJourneyAiReply } = await import('./chatbotFlow.js')
      await postJourneyAiReply({ lead, text, phone, sendFn, provider, instanceName, chatbot, app })
        .catch((e: any) => app.log.warn(`[scriptedChatbot] postChatAi: ${e?.message || e}`))
    }
    return
  }

  await saveIncoming(leadId, text)

  // ── Aguardando o formulário (WhatsApp Flow) ──
  if (state.phase === 'flow_pending') {
    if (flowResponse) {
      await handleFlowResponse(leadId, state)
    } else if (!await tryStartFlow(leadId, true)) {
      // Não conseguiu reenviar o Flow → cai para o fluxo pergunta-a-pergunta.
      state.phase = 'asking'
      await persist(leadId, state)
      const f0 = fields[state.stepIndex]
      if (f0) await askField(leadId, f0)
    }
    return
  }

  // ── Fase de agendamento ──
  if (state.phase === 'scheduling') {
    await handleSchedulingReply(leadId, state, fields, text, send, sendChoices, persist, app, phone, chatbot, interactiveReplyId, promoteFunnelId)
    return
  }

  // ── Fase de perguntas ──
  const field = fields[state.stepIndex]
  if (!field) { // segurança: fora do range → finaliza
    await finishQualifiedFlow(leadId, state, fields, settings, form, send, persist, chatbot, promoteFunnelId)
    return
  }

  // Validação / parse da resposta do campo atual (lógica única em journeyEngine:
  // select casa por id do botão → número/label/value; demais campos validam).
  const parsed = parseAnswer(field, text, interactiveReplyId)
  if (parsed.ok) {
    state.answers[field.key] = parsed.value
  } else if (parsed.kind === 'select' && chatbot?.aiInterpret) {
    // Híbrido: o select não casou de forma determinística → a IA mapeia o texto
    // livre para uma opção existente (ou unclear → reask). A IA só escolhe o
    // value; a qualificação/roteamento abaixo continua determinístico sobre ele.
    const ai = await interpretSelectAnswer(field, text, { instruction: chatbot?.interpretPrompt })
    if (ai.value) state.answers[field.key] = ai.value
    else { await send(leadId, msg(chatbot, 'invalidSelect')); await askField(leadId, field); return }
  } else if (parsed.kind === 'select') {
    await send(leadId, msg(chatbot, 'invalidSelect')); await askField(leadId, field); return
  } else {
    await send(leadId, `${msg(chatbot, 'invalidAnswer', { erro: parsed.error })}\n\n${questionText(field)}`); return
  }

  // Persiste a resposta no lead (campos nativos via mapTo + customFields).
  await applyAnswerToLead(leadId, field, state.answers)

  // Roteamento por opção de menu (select com `route`): encaminha o lead ao setor
  // escolhido — move funil/etapa e (re)atribui equipe/operador. No-op se a opção
  // não tem `route` (retrocompatível com forms sem menu de triagem).
  await applyOptionRoute(leadId, field, state.answers[field.key], send, chatbot, app)

  // Qualificação após cada qualificador (negativo vence → desqualifica já).
  if (field.isQualifier) {
    const q = evaluateQualification(fields, state.answers, settings)
    if (q?.finish) {
      const mv = resolveStageMove(q, { promoteFunnelId, formFunnelId: form.funnelId ?? null, isFinish: true })
      if (mv) await moveLeadStage(leadId, mv.funnelId, mv.stageKey, 'chatbot', { forwardOnly: mv.forwardOnly })
      // Redirect/mensagem configurados no FORM (editáveis no editor de forms) têm
      // prioridade; senão cai na mensagem editável do chatbot (disqualifiedFallback).
      const finishMsg = q.finishAction === 'redirect' && q.redirectUrl
        ? `${stripTags(settings?.successMessage) || msg(chatbot, 'disqualifiedFallback')}\n\n${q.redirectUrl}`
        : (stripTags(q.message) || msg(chatbot, 'disqualifiedFallback'))
      await send(leadId, finishMsg)
      state.phase = 'disqualified'
      await persist(leadId, state, true)
      logEvent({ leadId, type: EVENT_TYPES.DIAGNOSIS_COMPLETED, category: 'lifecycle', title: 'Chatbot: lead desqualificado', channel: 'whatsapp', source: 'chatbot', actorType: 'lead' })
      return
    }
  }

  // Avança para o próximo campo (journeyEngine classifica: perguntar / agendar / finalizar).
  const ns = nextStep(fields, state.stepIndex + 1)
  state.stepIndex = ns.index
  if (ns.kind === 'finish') { // não há mais campos → finaliza qualificado (sem scheduling)
    await finishQualifiedFlow(leadId, state, fields, settings, form, send, persist, chatbot, promoteFunnelId)
    return
  }
  if (ns.kind === 'scheduling') {
    await enterSchedulingPhase(leadId, state, fields, settings, form, ns.field, send, sendChoices, persist, app, chatbot, promoteFunnelId)
    return
  }
  await askField(leadId, ns.field)
  await persist(leadId, state)
}

// ── Persistência do estado em lead.formData._script (+ answers no topo) ──
async function persist(leadId: number, state: ScriptState, completed = false): Promise<void> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { formData: true } })
  const fd: any = (lead?.formData as any) || {}
  const merged = { ...fd, ...state.answers, _source: 'whatsapp', _script: state }
  await prisma.lead.update({ where: { id: leadId }, data: { formData: merged, lastStep: state.stepIndex, ...(completed ? { completed: true } : {}) } })
}

// Grava a resposta de um campo nos campos nativos do lead (via mapTo) + customFields.
export async function applyAnswerToLead(leadId: number, field: any, answers: Record<string, any>): Promise<void> {
  const data: any = {}
  const v = answers[field.key]
  if (field.mapTo === 'nome') data.nome = String(v)
  else if (field.mapTo === 'email') data.email = String(v)
  // whatsapp coletado na conversa (canal web). No WhatsApp o número já nasce no
  // lead; só grava quando vier um valor não-vazio para não sobrescrever à toa.
  else if (field.mapTo === 'whatsapp') { const w = String(v).trim(); if (w) data.whatsapp = w }
  else if (field.mapTo === 'empresa') data.empresa = String(v)
  else if (field.mapTo === 'cidade') data.cidade = String(v)
  else if (field.mapTo === 'segmento') data.segmento = String(v)
  // customFields a partir das respostas acumuladas.
  const cfv = await buildCustomFieldValues([field], answers)
  if (Object.keys(cfv).length) {
    const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { customFields: true } })
    data.customFields = { ...((lead?.customFields as any) || {}), ...cfv }
  }
  if (Object.keys(data).length) await prisma.lead.update({ where: { id: leadId }, data }).catch(() => {})
}

// Roteamento por opção de menu. Quando a opção de um campo `select` escolhida traz
// um objeto `route` ({ funnelId, stageKey, teamId, confirmText }), o lead é
// encaminhado ao setor correspondente: move de funil/etapa (forwardOnly:false, é
// uma escolha explícita do cliente) e (re)atribui a equipe + operador disponível
// (mesma lógica de pickOperatorForTeam usada na criação do lead). `confirmText`,
// se presente, é enviado como confirmação ({{opcao}} = rótulo escolhido). É um
// no-op quando a opção não tem `route` — não afeta forms/chatbots existentes.
async function applyOptionRoute(
  leadId: number,
  field: any,
  value: any,
  send: (leadId: number, body: string) => Promise<void>,
  chatbot: any,
  app: FastifyInstance,
): Promise<void> {
  if (field?.type !== 'select' || !Array.isArray(field.options)) return
  const opt = field.options.find((o: any) => String(o.value) === String(value))
  const route = opt?.route
  if (!route) return
  try {
    if (route.funnelId != null && route.stageKey) {
      await moveLeadStage(leadId, route.funnelId, route.stageKey, 'chatbot', { forwardOnly: false })
    }
    if (route.teamId != null) {
      const userId = await pickOperatorForTeam(route.teamId).catch(() => null)
      await prisma.lead.update({
        where: { id: leadId },
        data: { teamId: route.teamId, assignedUserId: userId, assignedAt: new Date() },
      }).catch(() => {})
      logEvent({
        leadId, type: EVENT_TYPES.ROUTING_RULE_MATCHED, category: 'lifecycle',
        title: `Menu do chatbot: encaminhado para ${stripTags(opt.label) || route.stageKey}`,
        channel: 'whatsapp', source: 'chatbot', actorType: 'lead',
        metadata: { teamId: route.teamId, userId, funnelId: route.funnelId, stageKey: route.stageKey },
      })
    }
    if (route.confirmText) await send(leadId, interpolate(String(route.confirmText), { opcao: stripTags(opt.label) }))
  } catch (e: any) {
    app.log.warn(`[scriptedChatbot] applyOptionRoute: ${e?.message || e}`)
  }
}

// Move o lead para a etapa de qualificação positiva e abre a fase de agendamento.
async function enterSchedulingPhase(
  leadId: number, state: ScriptState, fields: any[], settings: any, form: any, schedField: any,
  send: (leadId: number, body: string) => Promise<void>, sendChoices: SendChoicesFn, persistFn: typeof persist, app: FastifyInstance, chatbot: any,
  promoteFunnelId: number | null | undefined,
): Promise<void> {
  const q = evaluateQualification(fields, state.answers, settings)
  const mv = resolveStageMove(q, { promoteFunnelId, formFunnelId: form.funnelId ?? null, isFinish: false })
  if (mv) await moveLeadStage(leadId, mv.funnelId, mv.stageKey, 'chatbot', { forwardOnly: mv.forwardOnly })

  const mt = schedField.meetingSlug ? await getActiveMeetingType(schedField.meetingSlug) : null
  if (!mt) {
    await send(leadId, msg(chatbot, 'noMeetingType'))
    state.phase = 'done'
    await persistFn(leadId, state, true)
    return
  }
  const days = await getMeetingTypeSlots(mt, {}).catch((e) => { app.log.warn(`[scriptedChatbot] slots: ${e}`); return [] as any[] })
  const flat: Array<{ startAt: string; text: string }> = []
  for (const day of (days as any[])) {
    for (const sl of (day.slots || [])) {
      if (flat.length >= MAX_SLOTS) break
      const dd = String(day.date).slice(8, 10) + '/' + String(day.date).slice(5, 7)
      flat.push({ startAt: sl.startAt, text: `${WD[day.weekday] || ''} ${dd} ${sl.label}`.trim() })
    }
    if (flat.length >= MAX_SLOTS) break
  }
  if (!flat.length) {
    await send(leadId, msg(chatbot, 'noSlots'))
    state.phase = 'done'
    await persistFn(leadId, state, true)
    return
  }
  // Mensagem de boas-vindas ao iniciar o agendamento (configurável, com o tema do negócio).
  if (chatbot?.schedulingIntro && String(chatbot.schedulingIntro).trim()) {
    const ld = await prisma.lead.findUnique({ where: { id: leadId }, select: { nome: true } })
    await send(leadId, interpolate(String(chatbot.schedulingIntro), { nome: ld?.nome || state.answers?.nome || '', reuniao: mt.name }))
  }
  const label = stripTags(schedField.label) && stripTags(schedField.label) !== 'Agendamento' ? stripTags(schedField.label) : 'Escolha o melhor horário para a nossa conversa'
  const choices: Choice[] = flat.map((s, i) => ({ id: `slot_${i}`, title: s.text }))
  await sendChoices(
    leadId, label, choices,
    (cs) => msg(chatbot, 'slotPrompt', { titulo: label, horarios: cs.map((c, i) => `${i + 1}) ${c.title}`).join('\n') }),
    { button: 'Ver horários', sectionTitle: 'Horários' },
  )
  state.slots = flat
  state.phase = 'scheduling'
  await persistFn(leadId, state)
}

// Trata a escolha do horário e cria a reserva (createBooking move REUNIAO/notifica/CAPI).
async function handleSchedulingReply(
  leadId: number, state: ScriptState, fields: any[], text: string,
  send: (leadId: number, body: string) => Promise<void>, sendChoices: SendChoicesFn, persistFn: typeof persist, app: FastifyInstance, phone: string, chatbot: any,
  interactiveReplyId?: string | null, promoteFunnelId?: number | null,
): Promise<void> {
  const slots = state.slots || []
  const v = text.trim()
  // Casa pelo id do botão/linha (slot_N) ou pelo número digitado.
  let idx = -1
  const m = interactiveReplyId && /^slot_(\d+)$/.exec(interactiveReplyId)
  if (m) idx = parseInt(m[1]!, 10)
  else if (/^\d+$/.test(v)) idx = parseInt(v, 10) - 1
  const chosen = idx >= 0 && idx < slots.length ? slots[idx] : null
  if (!chosen) {
    const choices: Choice[] = slots.map((s, i) => ({ id: `slot_${i}`, title: s.text }))
    await sendChoices(
      leadId, 'Não entendi o horário. Escolha um:', choices,
      (cs) => msg(chatbot, 'invalidSlot', { horarios: cs.map((c, i) => `${i + 1}) ${c.title}`).join('\n') }),
      { button: 'Ver horários', sectionTitle: 'Horários' },
    )
    return
  }
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { nome: true, email: true } })
  const schedField = fields.find((f) => f?.type === 'scheduling')
  const mt = schedField?.meetingSlug ? await getActiveMeetingType(schedField.meetingSlug) : null
  if (!mt) { await send(leadId, msg(chatbot, 'bookingUnavailable')); state.phase = 'done'; await persistFn(leadId, state, true); return }

  const result = await createBooking(mt, {
    name: lead?.nome || 'Lead', email: lead?.email || null, phone, startAt: chosen.startAt,
    answers: state.answers, timezone: mt.timezone, visitorId: null, utm: null,
    funnelOverride: promoteFunnelId ?? null,
  } as any).catch((e) => { app.log.error(`[scriptedChatbot] booking: ${e}`); return { ok: false, error: 'Erro ao agendar' } as any })

  if (!result.ok) {
    // Horário ficou indisponível → recarrega e reapresenta.
    const days = await getMeetingTypeSlots(mt, {}).catch(() => [] as any[])
    const flat: Array<{ startAt: string; text: string }> = []
    for (const day of (days as any[])) {
      for (const sl of (day.slots || [])) {
        if (flat.length >= MAX_SLOTS) break
        const dd = String(day.date).slice(8, 10) + '/' + String(day.date).slice(5, 7)
        flat.push({ startAt: sl.startAt, text: `${WD[day.weekday] || ''} ${dd} ${sl.label}`.trim() })
      }
      if (flat.length >= MAX_SLOTS) break
    }
    if (!flat.length) { await send(leadId, msg(chatbot, 'noSlots')); state.phase = 'done'; await persistFn(leadId, state, true); return }
    state.slots = flat
    const choices: Choice[] = flat.map((s, i) => ({ id: `slot_${i}`, title: s.text }))
    await sendChoices(
      leadId, 'Esse horário ficou indisponível. Escolha outro:', choices,
      (cs) => msg(chatbot, 'slotTaken', { erro: result.error || 'Horário indisponível', horarios: cs.map((c, i) => `${i + 1}) ${c.title}`).join('\n') }),
      { button: 'Ver horários', sectionTitle: 'Horários' },
    )
    await persistFn(leadId, state)
    return
  }

  await send(leadId, msg(chatbot, 'bookingConfirmed', { horario: chosen.text, nome: lead?.nome || '' }))
  state.phase = 'done'
  await persistFn(leadId, state, true)
}

// Qualificado mas sem etapa de agendamento (form sem campo scheduling): aplica a
// qualificação positiva e encerra com a mensagem de sucesso.
async function finishQualifiedFlow(
  leadId: number, state: ScriptState, fields: any[], settings: any, form: any,
  send: (leadId: number, body: string) => Promise<void>, persistFn: typeof persist, chatbot: any,
  promoteFunnelId?: number | null,
): Promise<void> {
  const q = evaluateQualification(fields, state.answers, settings)
  const mv = resolveStageMove(q, { promoteFunnelId, formFunnelId: form.funnelId ?? null, isFinish: false })
  if (mv) await moveLeadStage(leadId, mv.funnelId, mv.stageKey, 'chatbot', { forwardOnly: mv.forwardOnly })
  const ld = await prisma.lead.findUnique({ where: { id: leadId }, select: { nome: true } })
  await send(leadId, msg(chatbot, 'qualifiedDone', { nome: ld?.nome || state.answers?.nome || '' }))
  state.phase = 'done'
  await persistFn(leadId, state, true)
}
