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
import { createLeadFromForm, moveLeadStage, buildCustomFieldValues, scaleRange, scaleValues, scaleValueLabel } from './formFlow.js'
import { acharLeadDoContato, canalDaMensagem } from './contactIdentity.js'
import { escolherOperadorDaRota } from './teamRouting.js'
import { parseAnswer, evaluateQualification, resolveStageMove, nextStep } from './journey/journeyEngine.js'
import { interpretSelectAnswer } from './journey/interpret.js'
import { interpretSupportTurn } from './journey/supportIntent.js'
import { getActiveMeetingType, getMeetingTypeSlots, createBooking } from './schedulingService.js'
import { interpolate } from '../lib/interpolate.js'
import { buildChoices, choicesToText, splitChoiceLabel, type Choice } from '../lib/waInteractive.js'
import { buildFlowSendPayload, ingestFlowResponse, flowInputFields } from './whatsappFlows.js'
import { emitOutboundMessage } from './outboundEvents.js'
import { registrarNome, ehNomePlaceholder } from './leadDisplayName.js'
// Fluxo de ATENDIMENTO (opt-in por Chatbot.scriptedConfig.supportFlow) e coleta de
// currículo (scriptedConfig.hrIntake). Sem a configuração, getSupportCfg → null e
// todo o código abaixo marcado "fluxo de atendimento" fica de fora.
import {
  getSupportCfg, matchGlobalCommand, enterWaitingAgent, handleCsatReply,
  sanitizeFirstName, extractPersonName, isMeaningfulName, firstName, supportMsg, tidyInterpolated,
  pareceComandoDeControle,
} from './scriptedSupportFlow.js'
import {
  getHrIntakeCfg, enterHrIntake, handleHrTriageReply, handleHrIntakeAnswer, handleHrResumeText,
  handleHrResumeMedia,
} from './hrResumeIntake.js'
import { modeloCruEmMemoria } from './modelosDoSistema.js'

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

// Mensagens do runner. Ordem: texto do próprio chatbot (Chatbot.scriptedMessages)
// → modelo do sistema `chatbot_roteiro_<chave>` (Modelos). Modelo desligado e
// chatbot sem texto = a mensagem não sai. Nenhum texto mora aqui.
export const CHAVES_DO_ROTEIRO = [
  'invalidSelect', 'invalidAnswer', 'noMeetingType', 'noSlots', 'slotPrompt', 'invalidSlot', 'invalidSlotList',
  'slotTaken', 'slotTakenList', 'slotTakenErro', 'bookingUnavailable', 'bookingConfirmed', 'disqualifiedFallback',
  'qualifiedDone', 'handoffAfterFallback', 'flowIntro', 'flowNudge', 'flowCta', 'slotTitulo',
] as const

/**
 * Carrega os textos do roteiro para este chatbot (uma vez por mensagem) e os
 * deixa no próprio objeto — `msg()` é chamado em callbacks síncronos.
 */
export async function prepararMensagensDoRoteiro(chatbot: any): Promise<void> {
  if (!chatbot || typeof chatbot !== 'object') return
  const { modeloCru } = await import('./modelosDoSistema.js')
  const { getBranding } = await import('../lib/branding.js')
  const overrides = (chatbot.scriptedMessages as Record<string, string> | null) || {}
  const mapa: Record<string, string> = {}
  for (const k of CHAVES_DO_ROTEIRO) {
    const proprio = overrides[k] && String(overrides[k]).trim()
    mapa[k] = proprio || (await modeloCru(`chatbot_roteiro_${k}`)) || ''
  }
  chatbot.__mensagensRoteiro = mapa
  chatbot.__marca = (await getBranding().catch(() => null))?.brandName || ''
}

// Resolve a mensagem de uma chave e interpola variáveis ('' = não enviar).
// Chave que não é do roteiro (fluxo de atendimento, RH) cai no modelo do módulo
// (`chatbot_atendimento_<chave>` / `chatbot_rh_<chave>`) — só registrados onde
// o fluxo está ligado (services/modelosOpcionais.ts).
export function msg(chatbot: any, key: string, vars: Record<string, any> = {}): string {
  const mapa = chatbot?.__mensagensRoteiro as Record<string, string> | undefined
  const overrides = (chatbot?.scriptedMessages as Record<string, string> | null) || {}
  const proprio = (overrides[key] && String(overrides[key]).trim()) || ''
  const tpl = mapa?.[key] ?? (proprio
    || modeloCruEmMemoria(`chatbot_atendimento_${key}`)
    || modeloCruEmMemoria(`chatbot_rh_${key}`)
    || '')
  return interpolate(tpl, { marca: chatbot?.__marca || '', ...vars })
}

interface ScriptState {
  stepIndex: number
  answers: Record<string, any>
  leadId: number | null
  /** Respostas seguidas que não casaram no passo atual. Zera ao avançar. */
  falhas?: number
  // flow_pending: enviamos um WhatsApp Flow e aguardamos o nfm_reply (respostas).
  // waiting_agent/human_active/csat: fluxo de ATENDIMENTO (scriptedConfig.supportFlow)
  // — aguardando humano assumir / humano ativo (bot mudo) / pesquisa de satisfação.
  // fixing_name: o cliente pediu para corrigir o nome e a próxima mensagem é o nome.
  // hr_triage/hr_intake/hr_resume: setor com coleta própria (scriptedConfig.hrIntake)
  // — confirma o assunto, faz as perguntas e recebe o arquivo do currículo.
  phase: 'asking' | 'scheduling' | 'done' | 'disqualified' | 'flow_pending' | 'waiting_agent' | 'human_active' | 'csat' | 'fixing_name' | 'hr_triage' | 'hr_intake' | 'hr_resume'
  slots?: Array<{ startAt: string; text: string }>
  // Campos do fluxo de atendimento (só usados quando supportFlow está ligado):
  fallbackCount?: number // respostas inválidas seguidas no menu (maxFallbacks → handoff)
  dept?: string // value da opção do menu escolhida (chave em cfg.departments)
  deptTeamId?: number | null
  handoffAt?: string // ISO — quando entrou em waiting_agent
  queueWarnedAt?: string // aviso de fila enviado (1x por handoff)
  csatAskedAt?: string
  csatAgentUserId?: number | null
  csatInvalidWarned?: boolean
  lgpdSentAt?: string
  demandaInicial?: string // veio no lugar do nome — assunto do contato, vira nota
  hr?: { step: number; answers: Record<string, string>; fileAsks: number } // coleta de currículo
}

// Mídia da mensagem recebida do lead, para persistir a msg com o anexo certo
// (ex.: áudio transcrito → player em Conversas + texto para o roteiro).
export interface IncomingMedia { mediaType: string; mediaUrl: string; mediaName?: string | null }

/** Dados extras da mensagem recebida (opcionais; quem não passa fica como antes). */
export interface ScriptedInboundExtras {
  /** Nome do perfil do WhatsApp (profile.name na Cloud API, pushName na Evolution). */
  pushName?: string | null
  /** Anexo da mensagem (só o fluxo de atendimento usa — currículo, mediaAck). */
  media?: IncomingMedia | null
}

// Lock leve por telefone: serializa o processamento por número para evitar que
// duas mensagens em rajada pulem/repitam passos (single-process tsx).
const locks = new Map<string, Promise<void>>()

export function stripTags(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#0?39;/g, "'").replace(/&quot;/g, '"')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function fieldKeyByMap(fields: any[], mapTo: string): string | null {
  const f = fields.find((x) => x?.mapTo === mapTo)
  return f?.key ?? null
}

// Texto da pergunta de um campo (label limpo + dica de placeholder/opções).
export function questionText(field: any): string {
  const label = stripTags(field.label) || field.key
  if (field.type === 'scale') {
    const { min, max } = scaleRange(field)
    const ends = [field.scaleMinLabel, field.scaleMaxLabel].filter(Boolean)
    const legend = ends.length === 2 ? `\n(${min} = ${field.scaleMinLabel} · ${max} = ${field.scaleMaxLabel})` : ''
    return `${label}\n\nResponda com um número de *${min} a ${max}*.${legend}`
  }
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
  // Conexão Cloud API por onde a mensagem entrou. A janela de 24h da Meta é
  // POR NÚMERO e quem consulta o estado dela filtra por esta coluna: gravar
  // `provider: 'cloud_api'` sem dizer QUAL conexão faz a janela parecer
  // fechada com o contato acabando de escrever.
  cloudApiConnectionId?: number | null,
  // Nome do perfil e anexo da mensagem — ver ScriptedInboundExtras.
  extras?: ScriptedInboundExtras | null,
): Promise<void> {
  const prev = locks.get(phone) ?? Promise.resolve()
  const run = prev.then(() =>
    _process(phone, text, app, messageId, sendFn, provider, originData, chatbotId, instanceName, chatbot, form, sendInteractiveFn, interactiveReplyId, flowResponse, promoteFunnelId, promoteStageKey, cloudApiConnectionId, extras?.pushName ?? null, extras?.media ?? null)
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
  cloudApiConnectionId?: number | null,
  pushName?: string | null,
  media?: IncomingMedia | null,
): Promise<void> {
  if (!form || !Array.isArray(form.fields)) { app.log.warn('[scriptedChatbot] form sem fields'); return }
  const fields: any[] = form.fields
  const settings: any = form.settings || {}
  await prepararMensagensDoRoteiro(chatbot)
  // Fluxo de atendimento/triagem (opt-in por chatbot). null = runner clássico.
  const cfg = getSupportCfg(chatbot)
  const attendantName = chatbot?.name || chatbot?.__marca || ''

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
        ...(provider === 'cloud_api' && cloudApiConnectionId ? { cloudApiConnectionId } : {}),
        senderName: attendantName, isInternal: false, externalId: extId, ack: extId ? 1 : 0, timestamp: new Date(),
      } })
      await prisma.lead.update({ where: { id: leadId }, data: { lastMessageAt: new Date() } })
    } catch (e) { app.log.warn(`[scriptedChatbot] save outgoing: ${e}`) }
    emitOutboundMessage({ leadId, source: 'chatbot', channel: 'whatsapp', chatbotId: chatbotId ?? null })
  }
  const saveIncoming = async (leadId: number, body: string) => {
    try {
      await prisma.message.create({ data: {
        leadId, fromMe: false, body, provider,
        // Com anexo (ex.: áudio transcrito), a mensagem do lead é gravada com o
        // tipo/arquivo dele — player em Conversas — e o texto vira o corpo.
        mediaType: media?.mediaType || 'text',
        ...(media?.mediaUrl ? { mediaUrl: media.mediaUrl } : {}),
        ...(media?.mediaName ? { mediaName: media.mediaName } : {}),
        ...(provider === 'evolution' && instanceName ? { evolutionInstance: instanceName } : {}),
        ...(provider === 'cloud_api' && cloudApiConnectionId ? { cloudApiConnectionId } : {}),
        senderName: body ? body.slice(0, 60) : phone, externalId: messageId || null, timestamp: new Date(),
      } })
      // Fluxo de atendimento: lastActivityAt alimenta o checker de inatividade
      // (inactivity.ts), que lá mede o silêncio do contato por este campo.
      await prisma.lead.update({ where: { id: leadId }, data: { unreadMessages: { increment: 1 }, lastMessageAt: new Date(), ...(cfg ? { lastActivityAt: new Date() } : {}) } }).catch(() => {})
    } catch (e) { app.log.warn(`[scriptedChatbot] save incoming: ${e}`) }
  }
  const send = async (leadId: number, body: string) => {
    if (!String(body ?? '').trim()) return // modelo desligado: nada sai
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
  // Pergunta um campo: select/escala → botões/lista; demais → texto.
  const askField = async (leadId: number, field: any) => {
    // Escala: as notas viram opções nativas quando cabem na lista (≤10). O NPS
    // (0–10 = 11 notas) estoura o limite da Meta e cai no texto de questionText().
    if (field?.type === 'scale') {
      const vals = scaleValues(field)
      if (vals.length <= 10) {
        const body = stripTags(field.label) || field.key
        const choices: Choice[] = vals.map((v) => ({ id: String(v), title: scaleValueLabel(field, v) }))
        await sendChoices(leadId, body, choices, () => questionText(field))
        return
      }
      await send(leadId, questionText(field))
      return
    }
    if (field?.type === 'select' && Array.isArray(field.options) && field.options.length) {
      const body = stripTags(field.label) || field.key
      const choices: Choice[] = field.options.map((o: any) => {
        // Separa "*Nome* — descrição" em título curto + descrição para não truncar
        // o nome no row da lista nativa (title ≤ 24). Sem separador → título inteiro.
        const { title, description } = splitChoiceLabel(stripTags(o.label))
        return { id: String(o.value), title, ...(description ? { description } : {}) }
      })
      // selectHint (opcional no JSON do campo): substitui a instrução padrão
      // "Responda com o número da opção." no fallback de texto numerado.
      const hint = typeof field.selectHint === 'string' && field.selectHint.trim() ? field.selectHint.trim() : null
      await sendChoices(leadId, body, choices, hint ? (cs) => choicesToText(body, cs, hint) : undefined)
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
      ? (editedBody || msg(chatbot, 'flowNudge'))
      : (editedBody || welcome || msg(chatbot, 'flowIntro'))
    const payload = buildFlowSendPayload(flowRow.metaFlowId, flowRow.screenId, {
      bodyText: body, cta: (flowRow.cta && flowRow.cta.trim()) || msg(chatbot, 'flowCta'), flowToken: `lead_${leadId}_${Date.now()}`,
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
  // Casa pela identidade canônica (phoneKey) — igualdade crua em `whatsapp` erra
  // quando o canal entrega o número sem o 9º dígito, e o roteiro recomeçava do
  // zero numa ficha nova. Ver services/contactIdentity.ts → acharLeadDoContato.
  // Só a conversa DESTE número da empresa — ver contactIdentity → CanalDoContato.
  const canal = canalDaMensagem(provider, instanceName, cloudApiConnectionId)
  const lead = await acharLeadDoContato(phone, { canal })
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
        forceWhatsapp: phone, qualificationSource: 'form', canal,
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
      // Fluxo de atendimento: vincula o chatbot ao lead pré-existente — os hooks do
      // atendimento humano (assumir/encerrar → aviso/CSAT), a inatividade e os
      // timers de fila resolvem a config via lead.chatbotId.
      if (cfg && chatbotId && lead!.chatbotId !== chatbotId) {
        await prisma.lead.update({ where: { id: leadId }, data: { chatbotId } }).catch(() => {})
      }
    }
    if (!leadId) { app.log.warn('[scriptedChatbot] não criou lead'); return }

    // ── Conversa que NÓS abrimos não é uma conversa de entrada ──────────────
    // O roteiro (saudação → menu → qualificação) pressupõe que o contato chegou
    // querendo algo. Quando o disparo parte daqui, ele está respondendo a uma
    // pergunta NOSSA, e o menu vira um não-sequitur: quem respondeu "tô ocupado"
    // ouviu "não consegui identificar essa opção" e o menu de novo. Aqui a
    // resposta é lida no contexto da abordagem e a conversa vai para gente.
    // Só no fluxo de atendimento, e desligável (scriptedConfig.respostaAbordagem).
    if (cfg?.respostaAbordagem) {
      const { tratarRespostaDeAbordagem } = await import('./abordagemHandoff.js')
      const tratou = await tratarRespostaDeAbordagem({
        leadId, text, chatbot, cfg, send, persist, app,
      })
      if (tratou) return
    }

    logEvent({ leadId, type: EVENT_TYPES.DIAGNOSIS_STARTED, category: 'lifecycle', title: `Chatbot iniciado: ${chatbot?.name || form.name}`, channel: 'whatsapp', source: 'chatbot', actorType: 'lead' })

    // Fluxo de atendimento: se o nome já é conhecido, o campo `nome` (skipIfKnown)
    // é pulado — nunca perguntamos o que o sistema já sabe.
    //
    // O WhatsApp entrega o nome do perfil do contato em TODA mensagem: `profile.name`
    // no webhook da Cloud API, `pushName` na Evolution. Perguntar "como posso te
    // chamar?" para quem o canal já identificou é fazer o cliente digitar o que já
    // está na tela do atendente — e era o passo onde a maioria abandonava.
    const nomeDoLead = cfg && lead && isMeaningfulName(lead.nome, phone) ? extractPersonName(lead.nome) : ''
    const nomeDoCanal = cfg ? extractPersonName(pushName) : ''
    const nomeConhecido = nomeDoLead || nomeDoCanal
    const knownName = !!nomeConhecido

    // Promove o nome do canal a nome do lead. `registrarNome` respeita a hierarquia
    // de origens (manual > formulário > agenda > pushname > telefone), então isso
    // NUNCA sobrescreve um nome cadastrado pela empresa — só preenche quem estava
    // como "Lead LP"/telefone. Também guarda o pushName bruto em coluna própria.
    if (nomeDoCanal && !nomeDoLead) {
      await registrarNome({ leadId, nome: nomeDoCanal, origem: 'pushname', pushName: pushName || null })
        .catch(() => {})
    }

    const first = nextStep(fields, 0, cfg ? { known: { nome: knownName } } : undefined)
    const newState: ScriptState = { stepIndex: first.index, answers: {}, leadId, phase: 'asking' }
    // Semeia a resposta do campo pulado: sem isso o `{{nome}}` das mensagens
    // seguintes (confirmação do setor, handoff, CSAT) sai vazio.
    if (knownName) {
      const nomeKey = fieldKeyByMap(fields, 'nome')
      if (nomeKey) newState.answers[nomeKey] = nomeConhecido
    }
    // F3: se o chatbot coleta via WhatsApp Flow, envia o formulário único (welcome
    // embutido no corpo do Flow) e aguarda o nfm_reply — sem perguntar campo a campo.
    if (chatbot?.useFlow && await tryStartFlow(leadId)) {
      newState.phase = 'flow_pending'
      await persist(leadId, newState)
      return
    }
    // Welcome + primeira pergunta (fluxo pergunta-a-pergunta).
    let welcome = (chatbot?.greetingMessage && chatbot.greetingMessage.trim())
      || [stripTags(settings?.conversational?.welcomeTitle), stripTags(settings?.conversational?.welcomeText)].filter(Boolean).join('\n\n')
    if (cfg && knownName) {
      // Contato com nome conhecido: saudação personalizada; se já teve atendimento
      // encerrado antes, variante de retorno ("que bom te ver de novo"). Vale também
      // para o lead recém-criado cujo nome veio do perfil do WhatsApp.
      welcome = supportMsg(chatbot, lead?.conversationClosedAt ? 'greetingReturning' : 'greetingKnown', { nome: nomeConhecido })
    } else if (cfg?.lgpdFooter && welcome) {
      // Contato novo: rodapé LGPD na primeira mensagem.
      welcome = `${welcome}\n\n${cfg.lgpdFooter}`
      newState.lgpdSentAt = new Date().toISOString()
    }
    if (welcome) await send(leadId, welcome)
    if (first.kind !== 'finish') await askField(leadId, first.field)
    await persist(leadId, newState)
    return
  }

  const leadId = state.leadId ?? lead.id

  // ── Pesquisa de satisfação (fase csat) — ANTES do guard de encerrado, porque
  // o encerramento pelo operador seta completed=true e a nota chega depois. ──
  if (cfg && state.phase === 'csat') {
    await saveIncoming(leadId, text)
    await handleCsatReply({ leadId, state, chatbot, cfg, text, send, persist })
    return
  }

  // Conversa encerrada → não reinicia o roteiro. Se o chatbot tem IA pós-atendimento
  // ligada, a IA assume com o contexto do desfecho; senão, só registra (atendimento humano).
  // Com supportFlow+restartOnReturn, o contato que volta recomeça no menu (fluxo recorrente).
  if (lead.completed || state.phase === 'done' || state.phase === 'disqualified') {
    await saveIncoming(leadId, text)
    if (cfg?.restartOnReturn) {
      const known = { nome: isMeaningfulName(lead.nome, phone) }
      const first = nextStep(fields, 0, { known })
      state = { stepIndex: first.index, answers: {}, leadId, phase: 'asking', fallbackCount: 0 }
      await prisma.lead.update({ where: { id: leadId }, data: { completed: false } }).catch(() => {})
      await send(leadId, supportMsg(chatbot, 'greetingReturning', { nome: firstName(lead.nome) }))
      if (first.kind !== 'finish') await askField(leadId, first.field)
      await persist(leadId, state)
      return
    }
    if (chatbot?.postChatAi) {
      const { postJourneyAiReply } = await import('./chatbotFlow.js')
      await postJourneyAiReply({ lead, text, phone, sendFn, provider, instanceName, chatbot, app, cloudApiConnectionId })
        .catch((e: any) => app.log.warn(`[scriptedChatbot] postChatAi: ${e?.message || e}`))
    }
    return
  }

  await saveIncoming(leadId, text)

  // Texto que o roteiro vai processar. A interpretação por IA pode substituí-lo
  // pelo `value` da opção quando o cliente diz o setor em palavras — daí para
  // baixo tudo segue determinístico, como se ele tivesse tocado no botão.
  let textoEfetivo = text
  let jaInterpretou = false

  // ── Fluxo de atendimento: fases pós-roteiro + comandos globais ──
  if (cfg) {
    // Humano ativo: o bot silencia TOTALMENTE (a mensagem já foi salva acima).
    if (state.phase === 'human_active') return
    // Comandos globais (qualquer fase exceto human_active), case/acento-insensitive.
    const gcmd = matchGlobalCommand(cfg, text)
    if (gcmd === 'menu') {
      const menuIdx = fields.findIndex((f) => f?.type === 'select' && Array.isArray(f.options) && f.options.length)
      if (menuIdx >= 0) {
        state.stepIndex = menuIdx
        state.phase = 'asking'
        state.fallbackCount = 0
        await persist(leadId, state)
        await askField(leadId, fields[menuIdx])
        return
      }
    }
    if (gcmd === 'attendant' && state.phase !== 'waiting_agent') {
      await enterWaitingAgent({ leadId, state, chatbot, cfg, deptKey: state.dept || cfg.fallbackDept, send, persist })
      return
    }

    // Correção de nome em curso: esta mensagem É o nome.
    if (state.phase === 'fixing_name') {
      const novo = extractPersonName(text)
      if (!novo) { await send(leadId, supportMsg(chatbot, 'nameFixAsk')); return }
      // Origem `formulario`: aqui a PESSOA se apresentou, então o nome vale mais do
      // que o apelido do perfil e não pode ser desfeito por um sync posterior.
      await registrarNome({ leadId, nome: novo, origem: 'formulario' }).catch(() => {})
      const kn = fieldKeyByMap(fields, 'nome')
      if (kn) state.answers[kn] = novo
      state.phase = 'asking'
      await persist(leadId, state)
      await send(leadId, supportMsg(chatbot, 'nameFixDone', { nome: novo }))
      const retomar = fields[state.stepIndex]
      if (retomar) await askField(leadId, retomar)
      return
    }

    // ── Coleta de currículo (setor com intake próprio) ──
    const hrCfg = getHrIntakeCfg(chatbot)
    if (hrCfg && ['hr_triage', 'hr_intake', 'hr_resume'].includes(state.phase || '')) {
      const hrCtx = { leadId, state, chatbot, hr: hrCfg, send, persist }
      if (state.phase === 'hr_triage') {
        const r = await handleHrTriageReply({ ...hrCtx, text })
        if (r === 'intake') return
        // "outro assunto": volta ao roteiro normal do setor (fila humana).
        state.phase = 'asking'
        state.hr = undefined
        await enterWaitingAgent({ leadId, state, chatbot, cfg, deptKey: state.dept || cfg.fallbackDept, send, persist })
        return
      }
      if (state.phase === 'hr_intake') { await handleHrIntakeAnswer({ ...hrCtx, text }); return }
      // Arquivo com legenda chega por aqui (sem legenda, o webhook chama direto).
      if (media?.mediaUrl) {
        await handleHrResumeMedia({ ...hrCtx, media: { mediaType: media.mediaType, mediaUrl: media.mediaUrl, mediaName: media.mediaName ?? null } })
        return
      }
      await handleHrResumeText({ ...hrCtx, text })
      return
    }

    // Aguardando atendente: o bot não responde (aviso de fila fica com o poller).
    if (state.phase === 'waiting_agent') return

    // ── Interpretação flexível (IA) ──────────────────────────────────────────
    // Roda SÓ quando o caminho determinístico não resolveu: no menu, quando a
    // resposta não é número/botão/label; fora dele, apenas quando a mensagem tem
    // cara de comando (pareceComandoDeControle) — senão toda resposta de
    // qualificação viraria uma chamada de modelo, cara e sem ganho.
    const campoAtual = fields[state.stepIndex]
    const ehMenu = campoAtual?.type === 'select' && Array.isArray(campoAtual.options) && campoAtual.options.length > 0
    const casouSozinho = ehMenu ? parseAnswer(campoAtual, text, interactiveReplyId).ok : false
    if (chatbot?.aiInterpret && state.phase === 'asking' && !casouSozinho
        && (ehMenu || pareceComandoDeControle(text))) {
      const menuField = fields.find((f) => f?.type === 'select' && Array.isArray(f.options) && f.options.some((o: any) => o?.route))
      const opcoes = (menuField?.options || []).map((o: any) => ({ value: String(o.value), label: stripTags(o.label) }))
      const turn = await interpretSupportTurn(text, opcoes, {
        faseLabel: ehMenu ? 'escolhendo o setor' : 'já escolheu o setor, respondendo à qualificação',
        perguntaAtual: campoAtual?.label ?? null,
        nomeAtual: (() => { const k = fieldKeyByMap(fields, 'nome'); return k ? String(state.answers[k] ?? '') || null : null })(),
        extra: chatbot?.interpretPrompt ?? null,
      })
      jaInterpretou = turn.intent !== 'indefinido' || ehMenu

      if (turn.intent === 'falar_atendente') {
        await enterWaitingAgent({ leadId, state, chatbot, cfg, deptKey: state.dept || cfg.fallbackDept, send, persist })
        return
      }
      if (turn.intent === 'corrigir_nome') {
        // A IA já extraiu o nome da própria frase ("na verdade me chamo Adson")?
        // Então corrige de uma vez, sem obrigar o cliente a repetir.
        const novo = extractPersonName(turn.nome)
        if (novo) {
          await registrarNome({ leadId, nome: novo, origem: 'formulario' }).catch(() => {})
          const kn = fieldKeyByMap(fields, 'nome')
          if (kn) state.answers[kn] = novo
          await persist(leadId, state)
          await send(leadId, supportMsg(chatbot, 'nameFixDone', { nome: novo }))
          const retomar = fields[state.stepIndex]
          if (retomar) await askField(leadId, retomar)
        } else {
          state.phase = 'fixing_name'
          await persist(leadId, state)
          await send(leadId, supportMsg(chatbot, 'nameFixAsk'))
        }
        return
      }
      if (turn.intent === 'voltar_menu' || turn.intent === 'duvida') {
        const menuIdx = fields.findIndex((f) => f?.type === 'select' && Array.isArray(f.options) && f.options.length)
        if (menuIdx >= 0) {
          state.stepIndex = menuIdx
          state.phase = 'asking'
          state.fallbackCount = 0
          await persist(leadId, state)
          if (turn.intent === 'duvida') await send(leadId, supportMsg(chatbot, 'duvidaRedirect'))
          await askField(leadId, fields[menuIdx])
          return
        }
      }
      if (turn.intent === 'escolher_setor' && turn.setor) {
        // Encaminha como se ele tivesse tocado na opção: o texto efetivo vira o
        // `value`, e todo o resto do roteiro (route, funil, equipe, qualificação)
        // segue determinístico e auditável.
        const menuIdx = fields.findIndex((f) => f?.type === 'select' && Array.isArray(f.options) && f.options.length)
        if (menuIdx >= 0) {
          const opt = (fields[menuIdx].options || []).find((o: any) => String(o.value) === turn.setor)
          state.stepIndex = menuIdx
          state.phase = 'asking'
          state.fallbackCount = 0
          textoEfetivo = turn.setor
          if (opt) await send(leadId, supportMsg(chatbot, 'intentRouted', { departamento: stripTags(opt.label).replace(/\s*—.*$/, '') }))
        }
      }
    }
  }

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
    if (cfg) { // fluxo de atendimento: em vez de encerrar, transfere ao setor
      await enterWaitingAgent({ leadId, state, chatbot, cfg, deptKey: state.dept || cfg.fallbackDept, send, persist })
      return
    }
    await finishQualifiedFlow(leadId, state, fields, settings, form, send, persist, chatbot, promoteFunnelId)
    return
  }

  // Validação / parse da resposta do campo atual (lógica única em journeyEngine:
  // select casa por id do botão → número/label/value; demais campos validam).
  const parsed = parseAnswer(field, textoEfetivo, interactiveReplyId)
  if (parsed.ok) {
    state.answers[field.key] = parsed.value
    // Fluxo de atendimento — nome: só aceita se a resposta PARECER um nome (ver
    // extractPersonName). Quem chega mandando a demanda no lugar do nome não vira
    // "Vcs" — a frase é guardada como demanda inicial e o nome cai no pushName.
    if (cfg?.sanitizeName && field.mapTo === 'nome') {
      const bruto = String(parsed.value ?? '').trim()
      const doTexto = extractPersonName(bruto)
      const nomeLimpo = doTexto || sanitizeFirstName(pushName)
      if (nomeLimpo) state.answers[field.key] = nomeLimpo
      else delete state.answers[field.key]
      // A frase que veio no lugar do nome é o assunto do contato — vai junto para
      // o especialista em vez de se perder no histórico.
      if (!doTexto && bruto) state.demandaInicial = bruto
    }
    if (cfg && state.fallbackCount) state.fallbackCount = 0 // resposta válida zera o contador
  } else if (parsed.kind === 'select' && chatbot?.aiInterpret && !jaInterpretou) {
    // Híbrido: o select não casou de forma determinística → a IA mapeia o texto
    // livre para uma opção existente (ou unclear → reask). A IA só escolhe o
    // value; a qualificação/roteamento abaixo continua determinístico sobre ele.
    // Pulado quando o classificador de intenção já rodou neste turno (supportFlow),
    // senão seria uma segunda chamada de modelo para a mesma mensagem.
    const ai = await interpretSelectAnswer(field, textoEfetivo, { instruction: chatbot?.interpretPrompt })
    if (ai.value) state.answers[field.key] = ai.value
    else if (cfg?.maxFallbacks) {
      // Fluxo de atendimento: mesmo escape do ramo determinístico logo abaixo —
      // sem ele, quem responde fora do menu e não é entendido pela IA ficava em laço.
      state.fallbackCount = (state.fallbackCount || 0) + 1
      if (state.fallbackCount >= cfg.maxFallbacks) {
        await enterWaitingAgent({ leadId, state, chatbot, cfg, deptKey: state.dept || cfg.fallbackDept, send, persist })
        return
      }
      await persist(leadId, state)
      await send(leadId, msg(chatbot, 'invalidSelect')); await askField(leadId, field); return
    }
    else if (await desistirDoPasso(leadId, state, chatbot, field, send)) return
    else { await send(leadId, msg(chatbot, 'invalidSelect')); await askField(leadId, field); return }
  } else if (parsed.kind === 'select') {
    // Fluxo de atendimento: fallback com contador — 1ª msg curta, 2ª reexibe o
    // menu, maxFallbacks transfere para atendimento humano (em vez do
    // desistirDoPasso, que encerraria o roteiro).
    if (cfg?.maxFallbacks) {
      state.fallbackCount = (state.fallbackCount || 0) + 1
      if (state.fallbackCount >= cfg.maxFallbacks) {
        await enterWaitingAgent({ leadId, state, chatbot, cfg, deptKey: state.dept || cfg.fallbackDept, send, persist })
        return
      }
      await persist(leadId, state)
      if (state.fallbackCount === 1) { await send(leadId, msg(chatbot, 'menuFallback1')); return }
      await send(leadId, msg(chatbot, 'invalidSelect'))
      await askField(leadId, field)
      return
    }
    if (await desistirDoPasso(leadId, state, chatbot, field, send)) return
    await send(leadId, msg(chatbot, 'invalidSelect')); await askField(leadId, field); return
  } else {
    // No fluxo de atendimento a resposta de texto inválida só repergunta: o
    // desistirDoPasso marcaria 'done' e, com restartOnReturn, a próxima mensagem
    // recomeçaria a conversa do zero.
    if (!cfg && await desistirDoPasso(leadId, state, chatbot, field, send)) return
    await send(leadId, `${msg(chatbot, 'invalidAnswer', { erro: parsed.error })}\n\n${questionText(field)}`); return
  }
  // Respondeu: o contador de teimosia do passo zera.
  state.falhas = 0

  // Persiste a resposta no lead (campos nativos via mapTo + customFields).
  await applyAnswerToLead(leadId, field, state.answers)

  // Fluxo de atendimento: a resposta livre à pergunta de qualificação do setor
  // (campo com promptFromRoute) vira nota interna — contexto pro atendente.
  if (cfg && field?.promptFromRoute) {
    const lbl = state.dept ? (cfg.departments[state.dept]?.label || state.dept) : ''
    // O contato que abriu a conversa com a demanda (no lugar do nome) já disse o
    // que queria antes do menu — anexar aqui evita o especialista ter que caçar
    // isso no histórico.
    const pre = state.demandaInicial ? `\nDisse na abertura: ${state.demandaInicial}` : ''
    await prisma.leadNote.create({ data: {
      leadId, userId: null, userName: chatbot?.name || 'Chatbot',
      content: `Qualificação${lbl ? ` (${lbl})` : ''}: ${state.answers[field.key]}${pre}`,
    } }).catch(() => {})
  }

  // Roteamento por opção de menu (select com `route`): encaminha o lead ao setor
  // escolhido — move funil/etapa e (re)atribui equipe/operador. No-op se a opção
  // não tem `route` (retrocompatível com forms sem menu de triagem).
  const nomeNaConversa = (() => {
    const k = fieldKeyByMap(fields, 'nome')
    return k ? String(state.answers[k] ?? '').trim() : ''
  })()
  const routePromptSent = await applyOptionRoute(leadId, field, state.answers[field.key], send, chatbot, app, nomeNaConversa)

  // Fluxo de atendimento: registra o setor escolhido no menu (usado no handoff).
  if (cfg && field?.type === 'select') {
    const chosen = String(state.answers[field.key])
    const opt = (field.options || []).find((o: any) => String(o.value) === chosen)
    if (opt?.route || cfg.departments[chosen]) {
      state.dept = chosen
      state.deptTeamId = opt?.route?.teamId ?? cfg.departments[chosen]?.teamId ?? null
    }
    // Setor com coleta própria (ex.: RH recebendo currículo): assume o turno aqui
    // — não segue para a pergunta de qualificação nem para a fila humana.
    const hrCfg = getHrIntakeCfg(chatbot)
    if (hrCfg && state.dept === hrCfg.deptKey) {
      await enterHrIntake({ leadId, state, chatbot, hr: hrCfg, send, persist })
      return
    }
  }

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
    if (cfg) { // fluxo de atendimento: em vez de encerrar, transfere ao setor
      await enterWaitingAgent({ leadId, state, chatbot, cfg, deptKey: state.dept || cfg.fallbackDept, send, persist })
      return
    }
    await finishQualifiedFlow(leadId, state, fields, settings, form, send, persist, chatbot, promoteFunnelId)
    return
  }
  if (ns.kind === 'scheduling') {
    await enterSchedulingPhase(leadId, state, fields, settings, form, ns.field, send, sendChoices, persist, app, chatbot, promoteFunnelId)
    return
  }
  // Fluxo de atendimento: a pergunta de qualificação do setor já foi enviada como
  // confirmText da opção do menu (applyOptionRoute) → não pergunta de novo, só
  // aguarda a resposta.
  if (cfg && ns.field?.promptFromRoute && routePromptSent) {
    await persist(leadId, state)
    return
  }
  await askField(leadId, ns.field)
  await persist(leadId, state)
}

// ── Persistência do estado em lead.formData._script (+ answers no topo) ──
/** Tentativas no MESMO passo antes de entregar a conversa para uma pessoa. */
const MAX_TENTATIVAS_NO_PASSO = 3

/**
 * O roteiro desiste — e entrega para gente.
 *
 * Sem isto o bot repergunta para sempre: quem responde "sei lá" a um menu ficava
 * num laço infinito, e no WhatsApp isso não termina em erro, termina em cliente
 * desistindo. Três tentativas no mesmo passo é o bastante para concluir que a
 * pergunta não vai ser respondida daquele jeito.
 *
 * Encerra o roteiro (`phase: 'done'`) e deixa a conversa aberta na fila, que é
 * o mesmo desfecho de quem completa — o operador assume com o que já foi dito.
 */
async function desistirDoPasso(
  leadId: number, state: ScriptState, chatbot: any, field: any,
  send: (leadId: number, texto: string) => Promise<void>,
): Promise<boolean> {
  state.falhas = (state.falhas ?? 0) + 1
  if (state.falhas < MAX_TENTATIVAS_NO_PASSO) return false
  console.warn(`[chatbot] lead ${leadId}: ${state.falhas} respostas sem casar em "${field?.key}" — roteiro encerrado e conversa entregue à equipe`)
  state.phase = 'done'
  state.falhas = 0
  await persist(leadId, state, false)
  await send(leadId, msg(chatbot, 'handoffAfterFallback'))
  return true
}

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
  // Campo sem resposta (a pessoa mandou outra coisa e o roteiro seguiu, ou o
  // passo foi pulado): não grava nada no campo nativo — `String(undefined)`
  // virava o texto "undefined" no nome do lead e na conversa ("Perfeito, undefined!").
  const vazio = v === undefined || v === null || String(v).trim() === ''
  if (vazio) { /* nada no campo nativo */ }
  else if (field.mapTo === 'nome') data.nome = String(v)
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
// Retorna true se enviou o confirmText (o fluxo de atendimento usa isso para não
// repetir a pergunta de qualificação do setor).
// Entre operadores candidatos, escolhe o que tem menos lead aberto atribuído
// (empate → o primeiro da lista). Serve à rota que distribui por PESSOA (lista
// `userIds` sem equipe), como o round-robin por usuário do Salesbot da Kommo.
async function pickLeastBusyUser(userIds: number[]): Promise<number | null> {
  const ids = userIds.filter((n) => Number.isFinite(n))
  if (ids.length === 0) return null
  if (ids.length === 1) return ids[0]!
  try {
    const counts = await prisma.lead.groupBy({
      by: ['assignedUserId'],
      where: { assignedUserId: { in: ids } },
      _count: { assignedUserId: true },
    })
    const byUser = new Map(counts.map((c) => [c.assignedUserId as number, c._count.assignedUserId ?? 0]))
    return ids.reduce((best, id) => ((byUser.get(id) ?? 0) < (byUser.get(best) ?? 0) ? id : best), ids[0]!)
  } catch {
    return ids[0]!
  }
}

async function applyOptionRoute(
  leadId: number,
  field: any,
  value: any,
  send: (leadId: number, body: string) => Promise<void>,
  chatbot: any,
  app: FastifyInstance,
  /** Nome já usado na conversa (estado do roteiro) — vence o do lead em {{nome}}. */
  nomeNaConversa?: string,
): Promise<boolean> {
  if (field?.type !== 'select' || !Array.isArray(field.options)) return false
  const opt = field.options.find((o: any) => String(o.value) === String(value))
  const route = opt?.route
  if (!route) return false
  try {
    if (route.funnelId != null && route.stageKey) {
      await moveLeadStage(leadId, route.funnelId, route.stageKey, 'chatbot', { forwardOnly: false })
    }
    // Destino: equipe (rodízio da equipe) OU uma lista explícita de operadores
    // sem equipe — aí vai para quem tem menos lead aberto; com um, é direto.
    if (route.teamId != null || (Array.isArray(route.userIds) && route.userIds.length > 0)) {
      const userId = route.teamId != null
        ? await escolherOperadorDaRota(route.teamId, route.userIds).catch(() => null)
        : await pickLeastBusyUser(route.userIds as number[])
      await prisma.lead.update({
        where: { id: leadId },
        data: {
          ...(route.teamId != null ? { teamId: route.teamId } : {}),
          assignedUserId: userId,
          assignedAt: userId ? new Date() : null,
        },
      }).catch(() => {})
      logEvent({
        leadId, type: EVENT_TYPES.ROUTING_RULE_MATCHED, category: 'lifecycle',
        title: `Menu do chatbot: encaminhado para ${stripTags(opt.label) || route.stageKey}`,
        channel: 'whatsapp', source: 'chatbot', actorType: 'lead',
        metadata: { teamId: route.teamId ?? null, userId, funnelId: route.funnelId, stageKey: route.stageKey },
      })
    }
    if (route.confirmText) {
      const tpl = String(route.confirmText)
      let texto = interpolate(tpl, { opcao: stripTags(opt.label) })
      if (/\{\{\s*nome\s*\}\}/.test(tpl)) {
        // {{nome}} na confirmação: o nome vem do ESTADO da conversa primeiro, e só
        // depois do lead — o lead pode estar com o placeholder "Lead LP" (default de
        // createLeadFromForm) enquanto a conversa já cumprimentou a pessoa pelo nome
        // do perfil. Ler só o banco produzia "Perfeito, Lead!" logo depois de
        // "Olá, Adson!". tidyInterpolated limpa a pontuação quando o nome falta.
        const ld = await prisma.lead.findUnique({ where: { id: leadId }, select: { nome: true } }).catch(() => null)
        const doLead = ehNomePlaceholder(ld?.nome) ? '' : firstName(ld?.nome)
        texto = tidyInterpolated(interpolate(tpl, { opcao: stripTags(opt.label), nome: nomeNaConversa || doLead }))
      }
      await send(leadId, texto)
      return true
    }
  } catch (e: any) {
    app.log.warn(`[scriptedChatbot] applyOptionRoute: ${e?.message || e}`)
  }
  return false
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
  const label = stripTags(schedField.label) && stripTags(schedField.label) !== 'Agendamento' ? stripTags(schedField.label) : msg(chatbot, 'slotTitulo')
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
      leadId, msg(chatbot, 'invalidSlotList'), choices,
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
      leadId, msg(chatbot, 'slotTakenList'), choices,
      (cs) => msg(chatbot, 'slotTaken', { erro: result.error || msg(chatbot, 'slotTakenErro'), horarios: cs.map((c, i) => `${i + 1}) ${c.title}`).join('\n') }),
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
