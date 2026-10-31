// src/services/hrResumeIntake.ts
//
// Coleta de currículo com encaminhamento a um número fixo (intake de RH).
//
// Opt-in por chatbot em `scriptedConfig.hrIntake`. Quando o contato escolhe o
// setor configurado (ex.: "rh") e confirma que o assunto é vaga/currículo, este
// módulo assume o turno: faz as perguntas configuradas, recebe o arquivo,
// encaminha tudo para o WhatsApp do responsável e encerra agradecendo — sem
// passar pela fila de atendimento humano.
//
// Por que um número fixo e não a fila: o RH da empresa recebe currículo no
// próprio WhatsApp; o painel continua com o registro (nota + anexo na conversa).
//
// IMPORTANTE — o encaminhamento sai pela Evolution, nunca pela Cloud API: a API
// oficial recusa mensagem livre para quem não falou com a empresa nas últimas
// 24h, e o responsável pelo RH normalmente está fora dessa janela.
//
// Nada aqui roda para chatbots sem `hrIntake.enabled` (getHrIntakeCfg → null).

import { prisma } from '../lib/prisma.js'
import { logEvent, EVENT_TYPES } from './leadHistory.js'
import { interpolate } from '../lib/interpolate.js'
import { tidyInterpolated, firstName } from './scriptedSupportFlow.js'
import { registrarModelosPadrao, modeloCruEmMemoria } from './modelosDoSistema.js'

// ── Configuração ────────────────────────────────────────────────────────────

export interface HrIntakeQuestion {
  key: string
  prompt: string
  label?: string
  /** Grava também no lead: 'nome' | 'email' | 'cidade' */
  mapTo?: 'nome' | 'email' | 'cidade' | null
}

export interface HrIntakeCfg {
  enabled: boolean
  /** Chave do setor no menu que aciona este fluxo (ex.: 'rh'). */
  deptKey: string
  /** WhatsApp do responsável, só dígitos com DDI (ex.: 556492730149). */
  forwardTo: string
  /** Instância Evolution usada no encaminhamento. Vazio = instância padrão. */
  forwardInstance?: string | null
  /** Extensões aceitas para o currículo. */
  acceptedExt: string[]
  /** Quantas vezes insistir no arquivo antes de encaminhar sem ele. */
  maxFileAsks: number
  /** Pergunta "é vaga/currículo ou outro assunto?" antes de iniciar a coleta. */
  triage: boolean
  questions: HrIntakeQuestion[]
}

const HR_DEFAULTS: Omit<HrIntakeCfg, 'enabled' | 'forwardTo'> = {
  deptKey: 'rh',
  forwardInstance: null,
  // Currículo chega como texto, imagem ou apresentação (portfólio/proposta).
  acceptedExt: ['pdf', 'doc', 'docx', 'odt', 'rtf', 'txt', 'ppt', 'pptx', 'xls', 'xlsx', 'png', 'jpg', 'jpeg', 'webp'],
  maxFileAsks: 2,
  triage: true,
  questions: [],
}

export function getHrIntakeCfg(chatbot: any): HrIntakeCfg | null {
  const raw = (chatbot?.scriptedConfig as any)?.hrIntake
  if (!raw || typeof raw !== 'object' || !raw.enabled) return null
  const forwardTo = String(raw.forwardTo || '').replace(/\D/g, '')
  if (!forwardTo) return null
  const cfg: HrIntakeCfg = { ...HR_DEFAULTS, ...raw, enabled: true, forwardTo }
  if (!Array.isArray(cfg.questions) || cfg.questions.length === 0) return null
  cfg.acceptedExt = (cfg.acceptedExt || []).map((e) => String(e).toLowerCase().replace(/^\./, ''))
  return cfg
}

// ── Mensagens (editáveis por chatbot em scriptedMessages) ───────────────────

// Conteúdo INICIAL dos modelos `chatbot_rh_<chave>` (Modelos › Automático do sistema).
// Só cria o registro; o envio lê o banco — desligado, a mensagem não sai.
const TEXTOS_INICIAIS: Record<string, string> = {
  hrTriageAsk: 'Seu contato é sobre uma *vaga* ou envio de *currículo*?\n\n*1* - Sim, quero me candidatar\n*2* - Não, é outro assunto',
  hrIntro: 'Que bom ter você por aqui! 🌱\n\nVou anotar alguns dados e receber o seu currículo para encaminhar ao nosso RH.',
  hrAskResume: 'Agora envie o seu currículo como *arquivo* ({{formatos}}).\n\nSe não estiver com ele agora, responda *pular* que eu encaminho só os seus dados.',
  hrResumeInvalid: 'Não consegui abrir esse arquivo. 😕\n\nEnvie em um destes formatos: {{formatos}}.',
  hrResumeRetryText: 'Para seguir, envie o currículo como *arquivo* anexado ({{formatos}}) — ou responda *pular*.',
  hrSkipped: 'Sem problema! Encaminhei os seus dados ao RH mesmo sem o currículo.',
  hrSent: 'Prontinho, {{nome}}! Seu currículo foi encaminhado ao nosso RH. ✅\n\nEm breve você receberá um retorno por aqui.',
  hrThanks: 'Agradecemos o seu interesse em fazer parte do nosso time! 🌱',
  // Mensagem que vai ao responsável (não ao candidato).
  hrForward: '📄 *Novo currículo recebido*\n\n{{dados}}\n\n📱 WhatsApp do candidato: {{whatsapp}}',
}
const ROTULOS: Record<string, string> = {
  hrTriageAsk: 'pergunta se é vaga/currículo',
  hrIntro: 'introdução',
  hrAskResume: 'pedido do currículo',
  hrResumeInvalid: 'arquivo inválido',
  hrResumeRetryText: 'insistir no arquivo',
  hrSkipped: 'enviado sem currículo',
  hrSent: 'currículo enviado',
  hrThanks: 'agradecimento',
  hrForward: 'aviso ao responsável',
}
// Sob demanda (services/modelosOpcionais.ts): só quem tem `scriptedConfig.hrIntake`
// ligado ganha os modelos `chatbot_rh_*` em Modelos. Idempotente.
export function registrarModelosDoRh(): void {
  registrarModelosPadrao(Object.entries(TEXTOS_INICIAIS).map(([k, body]) => ({
    key: `chatbot_rh_${k}`, name: ` — ${ROTULOS[k] || k}`, channel: 'whatsapp' as const, body,
  })))
}

export function hrMsg(chatbot: any, key: string, vars: Record<string, any> = {}): string {
  const overrides = (chatbot?.scriptedMessages as Record<string, string> | null) || {}
  const tpl = (overrides[key] && String(overrides[key]).trim()) || modeloCruEmMemoria(`chatbot_rh_${key}`) || ''
  return tidyInterpolated(interpolate(tpl, vars))
}

// ── Estado ──────────────────────────────────────────────────────────────────

interface HrState {
  step: number
  answers: Record<string, string>
  fileAsks: number
}

function hrState(state: any): HrState {
  if (!state.hr || typeof state.hr !== 'object') state.hr = { step: 0, answers: {}, fileAsks: 0 }
  return state.hr as HrState
}

type SendFn = (leadId: number, body: string) => Promise<void>
type PersistFn = (leadId: number, state: any, completed?: boolean) => Promise<void>

interface Ctx {
  leadId: number
  state: any
  chatbot: any
  hr: HrIntakeCfg
  send: SendFn
  persist: PersistFn
}

function formatosLegiveis(hr: HrIntakeCfg): string {
  return hr.acceptedExt.map((e) => e.toUpperCase()).join(', ')
}

function extOf(name: string): string {
  const m = String(name || '').toLowerCase().match(/\.([a-z0-9]{1,5})(?:\?|$)/)
  return m ? m[1] : ''
}

// ── Entrada do fluxo ────────────────────────────────────────────────────────

/** Contato escolheu o setor de RH: pergunta se é vaga/currículo ou vai direto. */
export async function enterHrIntake(ctx: Ctx): Promise<void> {
  const { leadId, state, chatbot, hr, send, persist } = ctx
  state.hr = { step: 0, answers: {}, fileAsks: 0 }
  if (hr.triage) {
    state.phase = 'hr_triage'
    await persist(leadId, state)
    await send(leadId, hrMsg(chatbot, 'hrTriageAsk'))
    return
  }
  await startQuestions(ctx)
}

/** Resposta da triagem: 1 = currículo (entra), 2 = outro assunto (devolve ao fluxo). */
export async function handleHrTriageReply(ctx: Ctx & { text: string }): Promise<'intake' | 'other'> {
  const { text, chatbot, leadId, send } = ctx
  const t = String(text || '').trim().toLowerCase()
  const querCurriculo = /^1\b/.test(t) || /(curr[ií]culo|vaga|candidat|emprego|trabalh)/.test(t)
  const outro = /^2\b/.test(t) || /^(n[ãa]o|outro)/.test(t)
  if (querCurriculo && !outro) {
    await startQuestions(ctx)
    return 'intake'
  }
  if (outro) return 'other'
  // Não deu para decidir: repete a pergunta e continua na triagem.
  await send(leadId, hrMsg(chatbot, 'hrTriageAsk'))
  return 'intake'
}

async function startQuestions(ctx: Ctx): Promise<void> {
  const { leadId, state, chatbot, hr, send, persist } = ctx
  const st = hrState(state)
  st.step = 0
  state.phase = 'hr_intake'
  await persist(leadId, state)
  const intro = hrMsg(chatbot, 'hrIntro')
  if (intro) await send(leadId, intro)
  await send(leadId, hr.questions[0].prompt)
}

// ── Perguntas ───────────────────────────────────────────────────────────────

export async function handleHrIntakeAnswer(ctx: Ctx & { text: string }): Promise<void> {
  const { leadId, state, chatbot, hr, text, send, persist } = ctx
  const st = hrState(state)
  const q = hr.questions[st.step]
  if (!q) { await askResume(ctx); return }

  st.answers[q.key] = String(text || '').trim()
  await applyToLead(leadId, q, st.answers[q.key])
  st.step += 1

  const next = hr.questions[st.step]
  if (next) {
    await persist(leadId, state)
    await send(leadId, next.prompt)
    return
  }
  await askResume(ctx)
}

async function askResume(ctx: Ctx): Promise<void> {
  const { leadId, state, chatbot, hr, send, persist } = ctx
  state.phase = 'hr_resume'
  await persist(leadId, state)
  await send(leadId, hrMsg(chatbot, 'hrAskResume', { formatos: formatosLegiveis(hr) }))
}

async function applyToLead(leadId: number, q: HrIntakeQuestion, value: string): Promise<void> {
  if (!q.mapTo || !value) return
  const data: any = {}
  if (q.mapTo === 'email') data.email = value
  else if (q.mapTo === 'cidade') data.cidade = value
  else if (q.mapTo === 'nome') {
    // Nome dito pela própria pessoa vale mais que o do perfil (hierarquia de origem).
    const { registrarNome } = await import('./leadDisplayName.js')
    await registrarNome({ leadId, nome: value, origem: 'formulario' }).catch(() => {})
    return
  }
  if (Object.keys(data).length) await prisma.lead.update({ where: { id: leadId }, data }).catch(() => {})
}

// ── Currículo ───────────────────────────────────────────────────────────────

/** Texto enquanto se espera o arquivo: "pular" encerra sem anexo; resto reinsiste. */
export async function handleHrResumeText(ctx: Ctx & { text: string }): Promise<void> {
  const { leadId, state, chatbot, hr, text, send } = ctx
  const st = hrState(state)
  const t = String(text || '').trim().toLowerCase()
  if (/^(pular|nao tenho|não tenho|depois|skip|sem curr)/.test(t)) {
    await finishHrIntake({ ...ctx, media: null, skipped: true })
    return
  }
  st.fileAsks += 1
  if (st.fileAsks >= hr.maxFileAsks) {
    await finishHrIntake({ ...ctx, media: null, skipped: true })
    return
  }
  await send(leadId, hrMsg(chatbot, 'hrResumeRetryText', { formatos: formatosLegiveis(hr) }))
}

export interface HrMedia { mediaType: string; mediaUrl: string; mediaName?: string | null }

/** Arquivo recebido na fase hr_resume. Retorna false se o formato não serve. */
export async function handleHrResumeMedia(ctx: Ctx & { media: HrMedia }): Promise<boolean> {
  const { leadId, state, chatbot, hr, media, send, persist } = ctx
  const st = hrState(state)
  const ext = extOf(media.mediaName || '') || extOf(media.mediaUrl || '')
  const tipoOk = ['document', 'image'].includes(media.mediaType)
  if (!tipoOk || (ext && !hr.acceptedExt.includes(ext))) {
    st.fileAsks += 1
    if (st.fileAsks >= hr.maxFileAsks) {
      await finishHrIntake({ ...ctx, media: null, skipped: true })
      return true
    }
    await persist(leadId, state)
    await send(leadId, hrMsg(chatbot, 'hrResumeInvalid', { formatos: formatosLegiveis(hr) }))
    return false
  }
  await finishHrIntake({ ...ctx, media, skipped: false })
  return true
}

// ── Encaminhamento + encerramento ───────────────────────────────────────────

export async function finishHrIntake(
  ctx: Ctx & { media: HrMedia | null; skipped: boolean },
): Promise<void> {
  const { leadId, state, chatbot, hr, media, skipped, send, persist } = ctx
  const st = hrState(state)

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { nome: true, whatsapp: true, funnelId: true },
  })

  // Bloco de dados legível, na ordem em que foi perguntado.
  const linhas = hr.questions
    .map((q) => {
      const v = st.answers[q.key]
      return v ? `*${q.label || q.key}:* ${v}` : ''
    })
    .filter(Boolean)
  if (!media && skipped) linhas.push('_Candidato não enviou o arquivo do currículo._')
  const dados = linhas.join('\n')
  const texto = hrMsg(chatbot, 'hrForward', { dados, whatsapp: lead?.whatsapp || '', nome: lead?.nome || '' })

  const enviado = await forwardToResponsavel(hr, texto, media)

  // Registro na própria conversa (mensagem interna): o encaminhamento sai para um
  // número de fora do CRM, então sem isto o operador abre Conversas e não vê que
  // o currículo foi enviado — só a nota, em outra aba.
  await prisma.message.create({
    data: {
      leadId,
      fromMe: true,
      isInternal: true,
      body: `📤 ${enviado ? 'Encaminhado' : 'FALHA ao encaminhar'} ao RH (${hr.forwardTo})\n\n${texto}`,
      mediaType: media ? media.mediaType : 'text',
      ...(media?.mediaUrl ? { mediaUrl: media.mediaUrl } : {}),
      ...(media?.mediaName ? { mediaName: media.mediaName } : {}),
      senderName: chatbot?.name || 'Chatbot',
      timestamp: new Date(),
    },
  }).catch(() => {})

  // Registro no painel: a conversa fica com o histórico e o RH tem a nota.
  await prisma.leadNote.create({
    data: {
      leadId,
      userId: null,
      userName: chatbot?.name || 'Chatbot',
      content: `Currículo${media ? '' : ' (sem arquivo)'} encaminhado ao RH (${hr.forwardTo})${enviado ? '' : ' — FALHA no envio'}\n${dados}${media ? `\nArquivo: ${absoluteUrl(media.mediaUrl)}` : ''}`,
    },
  }).catch(() => {})

  logEvent({
    leadId,
    type: EVENT_TYPES.CHATBOT_HANDOFF,
    category: 'lifecycle',
    title: `Chatbot: currículo encaminhado ao RH${media ? '' : ' (sem arquivo)'}${enviado ? '' : ' — falha no envio'}`,
    channel: 'whatsapp',
    source: 'chatbot',
    actorType: 'lead',
    metadata: { forwardTo: hr.forwardTo, comArquivo: !!media, enviado, funnelId: lead?.funnelId ?? null },
  })

  if (skipped) {
    const m = hrMsg(chatbot, 'hrSkipped')
    if (m) await send(leadId, m)
  }
  await send(leadId, hrMsg(chatbot, 'hrSent', { nome: firstName(lead?.nome) }))
  const thanks = hrMsg(chatbot, 'hrThanks')
  if (thanks) await send(leadId, thanks)

  // Encerra sem CSAT: o contato não passou por atendimento humano.
  state.phase = 'done'
  state.hr = undefined
  await persist(leadId, state, true)
}

function absoluteUrl(url: string): string {
  if (!url) return ''
  if (/^https?:\/\//i.test(url)) return url
  const base = String(process.env.APP_URL || '').replace(/\/+$/, '')
  return base ? `${base}${url.startsWith('/') ? '' : '/'}${url}` : url
}

async function forwardToResponsavel(hr: HrIntakeCfg, texto: string, media: HrMedia | null): Promise<boolean> {
  try {
    const wp = await import('./whatsappProvider.js')
    const provider = hr.forwardInstance
      ? wp.createEvolutionProviderFor(hr.forwardInstance)
      : wp.createEvolutionProvider()
    await provider.sendText(hr.forwardTo, texto)
    if (media?.mediaUrl) {
      const url = absoluteUrl(media.mediaUrl)
      const tipo = media.mediaType === 'image' ? 'image' : 'document'
      await provider.sendMedia(hr.forwardTo, url, tipo, undefined, media.mediaName || 'curriculo')
    }
    return true
  } catch (e: any) {
    console.error(`[hrIntake] falha ao encaminhar para ${hr.forwardTo}: ${e?.message || e}`)
    return false
  }
}
