// src/services/chatbotPreview.ts
//
// Harness de PREVIEW/TESTE do chatbot — roda o MESMO roteiro do WhatsApp, porém
// 100% EM MEMÓRIA: não cria lead, não move funil, não atribui operador, não cria
// reserva de agenda, não envia nada por WhatsApp. Reusa as funções PURAS de decisão
// do motor real (journeyEngine: parseAnswer/evaluateQualification/nextStep) e a
// config/mensagens do fluxo de atendimento (scriptedSupportFlow), de modo que a
// conversa simulada acompanhe a lógica de qualificação/validação de produção.
//
// Efeitos de ESCRITA do motor real são substituídos por simulação:
//   - createLeadFromForm/persist/applyAnswerToLead → estado só em memória
//   - moveLeadStage/applyOptionRoute(routing)      → no-op (só o confirmText é exibido)
//   - createBooking                                → confirmação simulada (sem reserva)
//   - enterWaitingAgent(handoff)/CSAT              → só a transição de fase + mensagem
// Leituras seguras (getActiveMeetingType/getMeetingTypeSlots/businessHours) são reais.

import { prisma } from '../lib/prisma.js'
import { parseAnswer, evaluateQualification, nextStep } from './journey/journeyEngine.js'
import { interpretSelectAnswer } from './journey/interpret.js'
import { getActiveMeetingType, getMeetingTypeSlots } from './schedulingService.js'
import { getBusinessHoursConfig, isWithinBusinessHours } from './businessHours.js'
import { interpolate } from '../lib/interpolate.js'
import { msg, questionText, stripTags } from './scriptedChatbotFlow.js'
import {
  buildSystemPrompt as aiBuildSystemPrompt, llmTurn as aiLlmTurn,
  extractOptions as aiExtractOptions, getCatalogSummary as aiGetCatalogSummary,
  mapSelectValue as aiMapSelectValue,
  type AiState, type LlmMsg,
} from './aiJourneyEngine.js'

// O fluxo de atendimento/triagem (supportFlow) existe apenas em alguns tenants
// (ex.: terram). Carregamos o módulo DINAMICAMENTE: onde ele não existe, o preview
// roda o roteiro scripted "clássico" (cfg = null), sem menu global/handoff/CSAT.
interface SupportMod {
  getSupportCfg: (c: any) => any
  matchGlobalCommand: (cfg: any, t: string) => 'menu' | 'attendant' | null
  supportMsg: (c: any, k: string, v: Record<string, any>) => string
  sanitizeFirstName: (s: any) => string
}
let supCache: SupportMod | null | undefined // undefined = ainda não tentou; null = ausente
async function getSupport(): Promise<SupportMod | null> {
  if (supCache !== undefined) return supCache
  try { supCache = (await import('./scriptedSupportFlow.js')) as any }
  catch { supCache = null }
  return supCache
}
const localFirstName = (n: any): string => String(n ?? '').trim().split(/\s+/)[0] || ''

const WD = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const MAX_SLOTS = 10
const TTL_MS = 60 * 60 * 1000 // sessões de preview expiram em 1h

interface PreviewState {
  stepIndex: number
  answers: Record<string, any>
  phase: 'asking' | 'scheduling' | 'done' | 'disqualified' | 'waiting_agent' | 'csat'
  fallbackCount: number
  dept?: string
  slots?: Array<{ startAt: string; text: string }>
  lgpdSentAt?: string
  csatInvalidWarned?: boolean
}
interface PreviewSession {
  chatbotId: number
  chatbot: any
  form: any
  kind: 'scripted' | 'ai'
  state: PreviewState
  // Estado do modo ai_journey (só quando kind === 'ai').
  aiState?: AiState
  aiMessages?: LlmMsg[]
  createdAt: number
}

const sessions = new Map<string, PreviewSession>()

function gc() {
  const now = Date.now()
  for (const [id, s] of sessions) if (now - s.createdAt > TTL_MS) sessions.delete(id)
}
function genId(): string {
  return `pv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

// Rótulo humano de um departamento (espelha deptLabel do scriptedSupportFlow).
function deptLabel(cfg: any, key: string): string {
  const d = cfg?.departments?.[key]
  if (d?.label) return String(d.label)
  return key ? key.charAt(0).toUpperCase() + key.slice(1) : ''
}
// Nome coletado até agora (campo com mapTo === 'nome'), para interpolar mensagens.
function collectedName(form: any, state: PreviewState): string {
  const nk = (form?.fields || []).find((f: any) => f?.mapTo === 'nome')?.key
  return nk ? localFirstName(state.answers[nk]) : ''
}

// ── Simulações dos efeitos de escrita (só produzem a MENSAGEM que o usuário veria) ──

// Roteamento por opção de menu: no preview só exibimos o confirmText (a movimentação
// de funil/atribuição de operador é omitida). Retorna true se enviou o confirmText.
function simOptionRoute(field: any, value: any, out: string[], nome: string): boolean {
  if (field?.type !== 'select' || !Array.isArray(field.options)) return false
  const opt = field.options.find((o: any) => String(o.value) === String(value))
  const route = opt?.route
  if (!route?.confirmText) return false
  out.push(interpolate(String(route.confirmText), { opcao: stripTags(opt.label), nome }))
  return true
}

// Handoff para atendimento humano: transição de fase + mensagem (sem abrir ticket).
async function simEnterWaitingAgent(sup: SupportMod, cfg: any, chatbot: any, form: any, state: PreviewState, deptKey: string, out: string[]) {
  const dept = cfg?.departments?.[deptKey] || {}
  let inHours = true
  if (cfg?.useBusinessHours) {
    try { const bh = await getBusinessHoursConfig(); if (bh) inHours = isWithinBusinessHours(bh) } catch { /* default inHours */ }
  }
  const vars = { nome: collectedName(form, state) || '', tempo_medio: dept.tempoMedio || '5 minutos', departamento: deptLabel(cfg, deptKey) }
  out.push(sup.supportMsg(chatbot, inHours ? 'handoffInHours' : 'handoffOffHours', vars))
  state.phase = 'waiting_agent'
  state.dept = deptKey
  state.fallbackCount = 0
}

// Fase de agendamento: lê meeting type + slots REAIS (read-only), monta a lista.
async function simEnterScheduling(chatbot: any, form: any, schedField: any, state: PreviewState, out: string[]) {
  const mt = schedField?.meetingSlug ? await getActiveMeetingType(schedField.meetingSlug) : null
  if (!mt) { out.push(msg(chatbot, 'noMeetingType')); state.phase = 'done'; return }
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
  if (!flat.length) { out.push(msg(chatbot, 'noSlots')); state.phase = 'done'; return }
  if (chatbot?.schedulingIntro && String(chatbot.schedulingIntro).trim()) {
    out.push(interpolate(String(chatbot.schedulingIntro), { nome: collectedName(form, state), reuniao: mt.name }))
  }
  const label = stripTags(schedField.label) && stripTags(schedField.label) !== 'Agendamento'
    ? stripTags(schedField.label) : 'Escolha o melhor horário para a nossa conversa'
  out.push(msg(chatbot, 'slotPrompt', { titulo: label, horarios: flat.map((s, i) => `${i + 1}) ${s.text}`).join('\n') }))
  state.slots = flat
  state.phase = 'scheduling'
}

// Escolha do horário: valida e CONFIRMA de forma simulada (nenhuma reserva é criada).
function simSchedulingReply(chatbot: any, form: any, state: PreviewState, text: string, out: string[]) {
  const slots = state.slots || []
  const v = text.trim()
  const idx = /^\d+$/.test(v) ? parseInt(v, 10) - 1 : -1
  const chosen = idx >= 0 && idx < slots.length ? slots[idx] : null
  if (!chosen) {
    out.push(msg(chatbot, 'invalidSlot', { horarios: slots.map((s, i) => `${i + 1}) ${s.text}`).join('\n') }))
    return
  }
  out.push(msg(chatbot, 'bookingConfirmed', { horario: chosen.text, nome: collectedName(form, state) }))
  state.phase = 'done'
}

// Qualificado sem agendamento.
function simFinishQualified(chatbot: any, form: any, state: PreviewState, out: string[]) {
  out.push(msg(chatbot, 'qualifiedDone', { nome: collectedName(form, state) }))
  state.phase = 'done'
}

// Resposta da pesquisa de satisfação (CSAT) — simulada.
function simCsatReply(sup: SupportMod, chatbot: any, form: any, state: PreviewState, text: string, out: string[]) {
  const m = text.match(/[1-5]/)
  if (!m) {
    if (!state.csatInvalidWarned) { state.csatInvalidWarned = true; out.push(sup.supportMsg(chatbot, 'csatInvalid', {})) }
    return
  }
  const low = parseInt(m[0], 10) <= 3
  out.push(sup.supportMsg(chatbot, low ? 'csatThanksLow' : 'csatThanksHigh', { nome: collectedName(form, state) }))
  state.phase = 'done'
}

// Monta a pergunta de um campo (para select, questionText já numera as opções).
function askField(out: string[], field: any) { out.push(questionText(field)) }

// ── Modo ai_journey: roda o MESMO loop de IA do motor real, porém em memória ────
// Reusa buildSystemPrompt + llmTurn + extractOptions do aiJourneyEngine e um
// executeTool SIMULADO (sem createLead / moveLeadStage / createBooking / routing).

const AI_MAX_ITERS = 6
const CONTACT_MAPTOS = ['nome', 'whatsapp', 'email', 'cidade']
const CONTACT_LABEL: Record<string, string> = { nome: 'nome', whatsapp: 'WhatsApp', email: 'e-mail', cidade: 'cidade' }

function fmtWhen(iso: string, tz: string): string {
  try { return new Intl.DateTimeFormat('pt-BR', { timeZone: tz, dateStyle: 'full', timeStyle: 'short' }).format(new Date(iso)) }
  catch { return iso }
}

// Dados de contato ainda não coletados (checa em memória, não no banco).
function missingContactPreview(form: any, answers: Record<string, any>): string[] {
  const fields: any[] = form?.fields || []
  const seen = new Set<string>()
  return fields
    .filter((f: any) => CONTACT_MAPTOS.includes(f?.mapTo) && !seen.has(f.mapTo) && seen.add(f.mapTo))
    .filter((f: any) => !String(answers[f.key] ?? '').trim())
    .map((f: any) => CONTACT_LABEL[f.mapTo] || f.mapTo)
}

// Executor de ferramentas SIMULADO: mesmas respostas do motor real, sem efeitos.
async function executeToolPreview(name: string, input: any, form: any, state: AiState): Promise<string> {
  const fields: any[] = form?.fields || []
  const settings: any = form?.settings || {}
  try {
    if (name === 'salvar_dados') {
      const campos: Array<{ chave: string; valor: string }> = Array.isArray(input?.campos) ? input.campos : []
      const salvos: string[] = []
      for (const c of campos) {
        const field = fields.find((f) => f?.key === c.chave)
        if (!field) continue
        state.answers[c.chave] = aiMapSelectValue(field, c.valor)
        salvos.push(c.chave)
      }
      return JSON.stringify({ ok: true, salvos })
    }
    if (name === 'rotear_setor') {
      const missing = missingContactPreview(form, state.answers)
      if (missing.length) return JSON.stringify({ ok: false, erro: 'Dados de contato incompletos', instrucao: `Antes de encaminhar, peça e salve (salvar_dados): ${missing.join(', ')}. Uma pergunta por vez.` })
      const routeField = fields.find((f: any) => f?.type === 'select' && Array.isArray(f.options) && f.options.some((o: any) => o?.route))
      if (!routeField) return JSON.stringify({ ok: false, erro: 'Sem roteamento por setor.' })
      const value = aiMapSelectValue(routeField, String(input?.setor || ''))
      const opt = routeField.options.find((o: any) => String(o.value) === String(value))
      if (!opt?.route) return JSON.stringify({ ok: false, erro: 'Setor não reconhecido.', instrucao: 'Tente identificar melhor o que o lead procura.' })
      state.answers[routeField.key] = opt.value
      return JSON.stringify({ ok: true, setor: stripTags(opt.label), instrucao: 'Lead encaminhado nos bastidores. NÃO mencione "setor"/"encaminhamento"; siga ajudando com naturalidade.' })
    }
    if (name === 'avaliar_qualificacao') {
      const q = evaluateQualification(fields, state.answers, settings)
      if (q?.finish) { state.phase = 'disqualified'; return JSON.stringify({ qualificado: false, motivo: stripTags(q.message) || 'não atende aos critérios', instrucao: 'Agradeça cordialmente e encerre. NÃO ofereça agendamento. Depois chame encerrar(qualificado=false).' }) }
      const hasSched = fields.some((f) => f?.type === 'scheduling')
      return JSON.stringify({ qualificado: true, instrucao: hasSched ? 'Lead qualificado. Ofereça agendar: chame listar_horarios e proponha um horário.' : 'Lead qualificado. Agradeça e finalize com encerrar(qualificado=true).' })
    }
    if (name === 'listar_horarios') {
      const schedField = fields.find((f) => f?.type === 'scheduling')
      const slug = schedField?.meetingSlug
      if (!slug) return JSON.stringify({ ok: false, erro: 'Agendamento não configurado.' })
      const mt = await getActiveMeetingType(slug)
      if (!mt) return JSON.stringify({ ok: false, erro: 'Tipo de reunião indisponível.' })
      const days = await getMeetingTypeSlots(mt, {}).catch(() => [] as any[])
      const list: Array<{ startAt: string; label: string }> = []
      for (const day of (days as any[])) {
        for (const sl of (day.slots || [])) {
          if (list.length >= 12) break
          const dd = String(day.date).slice(8, 10) + '/' + String(day.date).slice(5, 7)
          list.push({ startAt: sl.startAt, label: `${WD[day.weekday] || ''} ${dd} ${sl.label}`.trim() })
        }
        if (list.length >= 12) break
      }
      if (!list.length) return JSON.stringify({ ok: false, erro: 'Sem horários disponíveis no momento.' })
      return JSON.stringify({ ok: true, horarios: list })
    }
    if (name === 'agendar') {
      // Preview: NÃO cria reserva real — confirma de forma simulada.
      const schedField = fields.find((f) => f?.type === 'scheduling')
      const mt = schedField?.meetingSlug ? await getActiveMeetingType(schedField.meetingSlug) : null
      const startAt = String(input?.startAt || '')
      if (!startAt) return JSON.stringify({ ok: false, erro: 'Horário inválido.', instrucao: 'Chame listar_horarios e ofereça outro.' })
      state.phase = 'done'
      const quando = mt ? fmtWhen(startAt, mt.timezone) : startAt
      return JSON.stringify({ ok: true, quando, instrucao: 'Horário reservado (SIMULAÇÃO de preview). Confirme ao lead, de forma calorosa e curta, que o horário foi reservado. Não inclua links.' })
    }
    if (name === 'encerrar') { state.phase = input?.qualificado === false ? 'disqualified' : 'done'; return JSON.stringify({ ok: true }) }
    if (name === 'transferir_humano') {
      const missing = missingContactPreview(form, state.answers)
      if (missing.length) return JSON.stringify({ ok: false, erro: 'Dados de contato incompletos', instrucao: `Antes de transferir, peça e salve (salvar_dados): ${missing.join(', ')}. Uma pergunta por vez.` })
      state.phase = 'done'
      return JSON.stringify({ ok: true, instrucao: 'Avise que vai chamar um atendente e finalize.' })
    }
    if (name === 'consultar_catalogo') {
      const busca = String(input?.busca || '').trim()
      const categoria = String(input?.categoria || '').trim()
      const where: any = { active: true }
      if (categoria) where.categoria = { contains: categoria }
      if (busca) where.OR = [{ nome: { contains: busca } }, { descricao: { contains: busca } }, { marca: { contains: busca } }, { categoria: { contains: busca } }]
      const rows = await prisma.product.findMany({ where, orderBy: [{ disponivel: 'desc' }, { nome: 'asc' }], take: 15 }).catch(() => [] as any[])
      const produtos = (rows as any[]).map((p) => ({ nome: p.nome, categoria: p.categoria, marca: p.marca || undefined, preco: p.preco != null ? Number(p.preco) : undefined, disponivel: p.disponivel, estoque: p.estoque ?? undefined, descricao: p.descricao || undefined }))
      return JSON.stringify({ ok: true, total: produtos.length, produtos, instrucao: produtos.length ? 'Ofereça SOMENTE estes produtos, com nome/preço/disponibilidade EXATOS.' : 'Nada encontrado. Diga que não temos ESSE item; não invente modelos.' })
    }
    return JSON.stringify({ ok: false, erro: 'ferramenta desconhecida' })
  } catch { return JSON.stringify({ ok: false, erro: 'falha ao executar a ação' }) }
}

// Roda o loop de orquestração da IA (LLM → ferramentas → LLM) até uma resposta de texto.
async function runAiLoop(sess: PreviewSession, out: string[]): Promise<void> {
  const { chatbot, form } = sess
  const state = sess.aiState!
  const messages = sess.aiMessages!
  const catalogSummary = await aiGetCatalogSummary().catch(() => '')
  // lead "web novo": sem nome/whats reais → a IA coleta o contato (como no canal web).
  const lead = { nome: '', whatsapp: '', email: '', cidade: '' }
  const system = aiBuildSystemPrompt(chatbot, form, lead, state, catalogSummary)
  let replied = false
  for (let i = 0; i < AI_MAX_ITERS; i++) {
    let turn
    try { turn = await aiLlmTurn(system, messages) }
    catch {
      out.push('⚠️ Não consegui falar com a IA no preview. Verifique se a chave de IA está configurada (Configurações › APIs).')
      return
    }
    if (turn.kind === 'text') {
      const { text: t, options } = aiExtractOptions(turn.text)
      const body = options.length ? `${t}\n\n${options.map((o, idx) => `${idx + 1}) ${o}`).join('\n')}` : t
      if (body) { out.push(body); messages.push({ role: 'assistant', content: turn.text }); replied = true }
      break
    }
    // Texto escrito JUNTO da chamada de ferramenta: mostra antes de executar as
    // ferramentas, igual ao loop de produção em aiJourneyEngine. Sem isso o preview
    // engolia a resposta e caía no "deixa eu verificar" — fazendo parecer erro de
    // prompt o que era só o simulador descartando o que a IA tinha escrito.
    if (turn.text.trim()) {
      const { text: pre, options: preOpts } = aiExtractOptions(turn.text)
      const body = preOpts.length ? `${pre}\n\n${preOpts.map((o: string, idx: number) => `${idx + 1}) ${o}`).join('\n')}` : pre
      if (body) { out.push(body); replied = true }
    }

    messages.push({ role: 'assistant', content: turn.assistant })
    const results: any[] = []
    for (const call of turn.calls) {
      const r = await executeToolPreview(call.name, call.input, form, state)
      results.push({ type: 'tool_result', tool_use_id: call.id, content: r })
    }
    messages.push({ role: 'user', content: results })
  }
  if (!replied) out.push('Deixa eu verificar isso e já te respondo. 🙂')
}

// ── API pública ──────────────────────────────────────────────────────────────

export interface PreviewResult { sessionId: string; messages: string[]; phase: string; ended: boolean }

export async function startPreview(chatbotId: number): Promise<PreviewResult | { error: string }> {
  gc()
  const chatbot = await prisma.chatbot.findUnique({ where: { id: chatbotId } })
  // Chatbot INATIVO pode ser testado: testar antes de ativar é justamente o uso do
  // simulador. Antes a guarda exigia `active` e devolvia "Chatbot não encontrado" —
  // mensagem que mentia sobre a causa e deixava o botão Testar inútil no único
  // momento em que ele mais serve.
  if (!chatbot) return { error: 'Chatbot não encontrado' }

  const out: string[] = []
  const greet = (chatbot.greetingMessage || '').trim()

  // Modo ai_journey: roda o motor de IA REAL em memória (a IA abre com a saudação).
  if (chatbot.mode === 'ai_journey' && chatbot.formId) {
    const aform = await prisma.form.findUnique({ where: { id: chatbot.formId } })
    if (!aform || !Array.isArray((aform as any).fields)) return { error: 'Formulário do chatbot não encontrado' }
    const aiState: AiState = { leadId: null, phase: 'active', answers: {} }
    const aiMessages: LlmMsg[] = [{ role: 'user', content: 'Olá' }]
    const sess: PreviewSession = { chatbotId, chatbot, form: aform, kind: 'ai', state: { stepIndex: 0, answers: {}, phase: 'asking', fallbackCount: 0 }, aiState, aiMessages, createdAt: Date.now() }
    await runAiLoop(sess, out)
    const sid = genId()
    sessions.set(sid, sess)
    return { sessionId: sid, messages: out, phase: aiState.phase, ended: aiState.phase !== 'active' }
  }

  // Modos sem roteiro scripted (ex.: ai legado sem form): só a saudação configurada.
  if (chatbot.mode !== 'scripted' || !chatbot.formId) {
    if (greet) out.push(greet)
    const sid = genId()
    sessions.set(sid, { chatbotId, chatbot, form: null, kind: 'scripted', state: { stepIndex: 0, answers: {}, phase: 'done', fallbackCount: 0 }, createdAt: Date.now() })
    return { sessionId: sid, messages: out, phase: 'ai_unsupported', ended: true }
  }

  const form = await prisma.form.findUnique({ where: { id: chatbot.formId } })
  if (!form || !Array.isArray((form as any).fields)) return { error: 'Formulário do chatbot não encontrado' }
  const fields: any[] = (form as any).fields
  const settings: any = (form as any).settings || {}
  const sup = await getSupport()
  const cfg = sup ? sup.getSupportCfg(chatbot) : null

  // No preview não há contato conhecido: nome nunca é pulado.
  const first = nextStep(fields, 0, cfg ? { known: { nome: false } } : undefined)
  const state: PreviewState = { stepIndex: first.index, answers: {}, phase: 'asking', fallbackCount: 0 }

  let welcome = greet
    || [stripTags(settings?.conversational?.welcomeTitle), stripTags(settings?.conversational?.welcomeText)].filter(Boolean).join('\n\n')
  if (cfg?.lgpdFooter && welcome) { welcome = `${welcome}\n\n${cfg.lgpdFooter}`; state.lgpdSentAt = new Date().toISOString() }
  if (welcome) out.push(welcome)
  if (first.kind !== 'finish') askField(out, first.field)

  const sid = genId()
  sessions.set(sid, { chatbotId, chatbot, form, kind: 'scripted', state, createdAt: Date.now() })
  return { sessionId: sid, messages: out, phase: state.phase, ended: false }
}

export async function messagePreview(sessionId: string, text: string): Promise<PreviewResult | { error: string }> {
  gc()
  const sess = sessions.get(sessionId)
  if (!sess) return { error: 'Sessão de preview expirada. Recarregue o preview.' }
  const { chatbot, form } = sess
  const state = sess.state
  const out: string[] = []

  // Modo ai_journey: continua o loop de IA em memória.
  if (sess.kind === 'ai') {
    if (!sess.aiState || !sess.aiMessages) return { sessionId, messages: [], phase: 'done', ended: true }
    sess.aiMessages.push({ role: 'user', content: text })
    await runAiLoop(sess, out)
    return { sessionId, messages: out, phase: sess.aiState.phase, ended: sess.aiState.phase !== 'active' }
  }

  if (!form) return { sessionId, messages: [], phase: 'ai_unsupported', ended: true }
  const fields: any[] = form.fields
  const settings: any = form.settings || {}
  const sup = await getSupport()
  const cfg = sup ? sup.getSupportCfg(chatbot) : null

  // ── CSAT ──
  if (cfg && state.phase === 'csat') { simCsatReply(sup!, chatbot, form, state, text, out); return done(sessionId, out, state) }

  // ── Conversa encerrada → reinício (restartOnReturn) ──
  if (state.phase === 'done' || state.phase === 'disqualified') {
    if (cfg?.restartOnReturn) {
      const first = nextStep(fields, 0, { known: { nome: false } })
      state.stepIndex = first.index; state.answers = {}; state.phase = 'asking'; state.fallbackCount = 0; state.dept = undefined; state.slots = undefined
      out.push(sup!.supportMsg(chatbot, 'greetingReturning', { nome: '' }))
      if (first.kind !== 'finish') askField(out, first.field)
    }
    return done(sessionId, out, state)
  }

  // ── Fluxo de atendimento: comandos globais + fases ──
  if (cfg) {
    const gcmd = sup!.matchGlobalCommand(cfg, text)
    if (gcmd === 'menu') {
      const menuIdx = fields.findIndex((f) => f?.type === 'select' && Array.isArray(f.options) && f.options.length)
      if (menuIdx >= 0) {
        state.stepIndex = menuIdx; state.phase = 'asking'; state.fallbackCount = 0
        askField(out, fields[menuIdx])
        return done(sessionId, out, state)
      }
    }
    if (gcmd === 'attendant' && state.phase !== 'waiting_agent') {
      await simEnterWaitingAgent(sup!, cfg, chatbot, form, state, state.dept || cfg.fallbackDept, out)
      return done(sessionId, out, state)
    }
    if (state.phase === 'waiting_agent') return done(sessionId, out, state) // bot mudo
  }

  // ── Agendamento ──
  if (state.phase === 'scheduling') { simSchedulingReply(chatbot, form, state, text, out); return done(sessionId, out, state) }

  // ── Perguntas ──
  const field = fields[state.stepIndex]
  if (!field) {
    if (cfg) { await simEnterWaitingAgent(sup!, cfg, chatbot, form, state, state.dept || cfg.fallbackDept, out) }
    else simFinishQualified(chatbot, form, state, out)
    return done(sessionId, out, state)
  }

  const parsed = parseAnswer(field, text, null)
  if (parsed.ok) {
    state.answers[field.key] = parsed.value
    if (cfg?.sanitizeName && field.mapTo === 'nome') {
      const s = sup!.sanitizeFirstName(parsed.value)
      if (s) state.answers[field.key] = s
    }
    if (cfg && state.fallbackCount) state.fallbackCount = 0
  } else if (parsed.kind === 'select' && chatbot?.aiInterpret) {
    const ai = await interpretSelectAnswer(field, text, { instruction: chatbot?.interpretPrompt }).catch(() => ({ value: null } as any))
    if (ai.value) state.answers[field.key] = ai.value
    else { out.push(msg(chatbot, 'invalidSelect')); askField(out, field); return done(sessionId, out, state) }
  } else if (parsed.kind === 'select') {
    if (cfg?.maxFallbacks) {
      state.fallbackCount = (state.fallbackCount || 0) + 1
      if (state.fallbackCount >= cfg.maxFallbacks) {
        await simEnterWaitingAgent(sup!, cfg, chatbot, form, state, state.dept || cfg.fallbackDept, out)
        return done(sessionId, out, state)
      }
      if (state.fallbackCount === 1) { out.push(msg(chatbot, 'menuFallback1')); return done(sessionId, out, state) }
      out.push(msg(chatbot, 'invalidSelect')); askField(out, field)
      return done(sessionId, out, state)
    }
    out.push(msg(chatbot, 'invalidSelect')); askField(out, field)
    return done(sessionId, out, state)
  } else {
    out.push(`${msg(chatbot, 'invalidAnswer', { erro: parsed.error })}\n\n${questionText(field)}`)
    return done(sessionId, out, state)
  }

  // Roteamento por opção de menu (só exibe o confirmText no preview).
  const nome = collectedName(form, state)
  const routePromptSent = simOptionRoute(field, state.answers[field.key], out, nome)

  // Registra o setor escolhido (usado no handoff).
  if (cfg && field?.type === 'select') {
    const chosen = String(state.answers[field.key])
    const opt = (field.options || []).find((o: any) => String(o.value) === chosen)
    if (opt?.route || cfg.departments[chosen]) state.dept = chosen
  }

  // Qualificação (negativo vence → desqualifica já).
  if (field.isQualifier) {
    const q = evaluateQualification(fields, state.answers, settings)
    if (q?.finish) {
      const finishMsg = q.finishAction === 'redirect' && q.redirectUrl
        ? `${stripTags(settings?.successMessage) || msg(chatbot, 'disqualifiedFallback')}\n\n${q.redirectUrl}`
        : (stripTags(q.message) || msg(chatbot, 'disqualifiedFallback'))
      out.push(finishMsg)
      state.phase = 'disqualified'
      return done(sessionId, out, state)
    }
  }

  // Avança.
  const ns = nextStep(fields, state.stepIndex + 1)
  state.stepIndex = ns.index
  if (ns.kind === 'finish') {
    if (cfg) await simEnterWaitingAgent(cfg, chatbot, form, state, state.dept || cfg.fallbackDept, out)
    else simFinishQualified(chatbot, form, state, out)
    return done(sessionId, out, state)
  }
  if (ns.kind === 'scheduling') { await simEnterScheduling(chatbot, form, ns.field, state, out); return done(sessionId, out, state) }
  if (cfg && ns.field?.promptFromRoute && routePromptSent) return done(sessionId, out, state)
  askField(out, ns.field)
  return done(sessionId, out, state)
}

function done(sessionId: string, out: string[], state: PreviewState): PreviewResult {
  const ended = state.phase === 'done' || state.phase === 'disqualified' || state.phase === 'waiting_agent'
  return { sessionId, messages: out, phase: state.phase, ended }
}
