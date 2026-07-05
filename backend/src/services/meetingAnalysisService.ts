// src/services/meetingAnalysisService.ts
// F3 — Análise por IA da transcrição de reunião. Diferencial vs. notetakers
// genéricos: a reunião vira inteligência acionável ligada ao lead (resumo,
// tópicos, action items, objeções, próximos passos, sentimento).
// Padrão de chamada de LLM espelhado de aiLeadScoreService (fetch direto,
// Anthropic preferido com fallback OpenAI; chaves via lib/aiKeys).

import { prisma } from '../lib/prisma.js'
import {
  getAnthropicKey, getOpenAiKey, getPrimaryProvider,
  getAnthropicModel, getOpenAiModel,
} from '../lib/aiKeys.js'
import { getSalesPlaybook, getMeetingsSettings } from '../lib/meetingsConfig.js'
import { runPostAnalysisActions } from './meetingDelivery.js'

export interface PlaybookAssessment {
  aderencia: number // 0-100: aderência da conduta ao playbook
  pontosFortes: string[]
  pontosMelhoria: string[]
  direcionamento: string[] // coaching concreto p/ a próxima reunião
}

export interface MeetingAnalysis {
  resumo: string
  topicos: string[]
  acaoItems: string[]
  objecoes: string[]
  proximosPassos: string[]
  sentimento: 'positivo' | 'neutro' | 'negativo'
  playbook?: PlaybookAssessment | null // só quando o playbook está ativo
}

const MAX_TRANSCRIPT_CHARS = 14_000

const LANG_NAMES: Record<string, string> = {
  pt: 'português do Brasil', en: 'English', es: 'español', fr: 'français', it: 'italiano', de: 'Deutsch',
}

function buildSystem(opts: { playbookText?: string; language?: string; extra?: string }): string {
  const { playbookText, extra } = opts
  const lang = LANG_NAMES[opts.language || 'pt'] || opts.language || 'português do Brasil'
  const pbField = playbookText
    ? `,
  "playbook": {
    "aderencia": <número 0-100: quão bem o VENDEDOR seguiu o playbook>,
    "pontosFortes": ["o que o vendedor fez bem segundo o playbook"],
    "pontosMelhoria": ["o que ajustar na comunicação/condução segundo o playbook"],
    "direcionamento": ["orientação concreta de coaching para a próxima reunião"]
  }`
    : ''
  let base = `Você é um analista de reuniões comerciais/atendimento sênior. Recebe a
transcrição de uma reunião (com marcas de tempo e falantes) e devolve uma análise
OBJETIVA. Escreva TODO o conteúdo do JSON em ${lang}. Responda SOMENTE com um JSON válido, sem markdown,
no formato exato:
{
  "resumo": "2 a 4 frases resumindo o que foi tratado e o desfecho",
  "topicos": ["principais assuntos abordados"],
  "acaoItems": ["tarefas/compromissos concretos que surgiram, com responsável quando houver"],
  "objecoes": ["objeções, dúvidas ou preocupações levantadas pelo cliente"],
  "proximosPassos": ["o que deve acontecer a seguir"],
  "sentimento": "positivo | neutro | negativo"${pbField}
}
Use listas vazias quando não houver itens. Não invente informações que não estão na transcrição.`
  if (extra && extra.trim()) base += `\n\nInstruções adicionais do gestor (priorize estas orientações na análise): ${extra.trim()}`
  if (!playbookText) return base
  return base + `

AVALIE a conduta do VENDEDOR (nosso time) nesta reunião À LUZ do PLAYBOOK DE VENDAS
abaixo. O playbook é a referência do que deveria ter sido feito: aponte a aderência,
os acertos, o que ajustar na comunicação/condução e um direcionamento acionável para
a próxima reunião.

=== PLAYBOOK DE VENDAS ===
${playbookText}
=== FIM DO PLAYBOOK ===`
}

async function callAnthropic(system: string, user: string, key: string, model: string): Promise<string> {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1500,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: [{ type: 'text', text: user }] }],
    }),
  })
  if (!resp.ok) throw new Error(`Anthropic ${resp.status}: ${(await resp.text()).slice(0, 300)}`)
  const d: any = await resp.json()
  return d.content?.[0]?.text ?? ''
}

async function callOpenAi(system: string, user: string, key: string, model: string): Promise<string> {
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: 1500,
      temperature: 0.2,
    }),
  })
  if (!resp.ok) throw new Error(`OpenAI ${resp.status}: ${(await resp.text()).slice(0, 300)}`)
  const d: any = await resp.json()
  return d.choices?.[0]?.message?.content ?? ''
}

function parseJson(raw: string): MeetingAnalysis | null {
  if (!raw) return null
  const cleaned = raw.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end < 0) return null
  try {
    const o = JSON.parse(cleaned.slice(start, end + 1))
    const arr = (v: unknown): string[] => Array.isArray(v) ? v.map(String).filter(Boolean) : []
    const sent = String(o.sentimento || 'neutro').toLowerCase()
    const pb = o.playbook && typeof o.playbook === 'object' ? {
      aderencia: Math.max(0, Math.min(100, Math.round(Number(o.playbook.aderencia) || 0))),
      pontosFortes: arr(o.playbook.pontosFortes),
      pontosMelhoria: arr(o.playbook.pontosMelhoria),
      direcionamento: arr(o.playbook.direcionamento),
    } : null
    return {
      resumo: String(o.resumo || '').trim(),
      topicos: arr(o.topicos),
      acaoItems: arr(o.acaoItems),
      objecoes: arr(o.objecoes),
      proximosPassos: arr(o.proximosPassos),
      sentimento: (['positivo', 'neutro', 'negativo'].includes(sent) ? sent : 'neutro') as MeetingAnalysis['sentimento'],
      playbook: pb,
    }
  } catch {
    return null
  }
}

// Chama o LLM (provider preferido + fallback) e devolve a análise estruturada.
async function runLlm(user: string, system: string): Promise<MeetingAnalysis | null> {
  const primary = await getPrimaryProvider()
  const anthropicKey = await getAnthropicKey()
  const openaiKey = await getOpenAiKey()
  const anthropicModel = await getAnthropicModel()
  const openaiModel = await getOpenAiModel()

  const providers: Array<() => Promise<string>> = []
  const wantAnthropicFirst = primary !== 'openai'
  const anthropicCall = anthropicKey ? () => callAnthropic(system, user, anthropicKey, anthropicModel) : null
  const openaiCall = openaiKey ? () => callOpenAi(system, user, openaiKey, openaiModel) : null
  if (wantAnthropicFirst) { if (anthropicCall) providers.push(anthropicCall); if (openaiCall) providers.push(openaiCall) }
  else { if (openaiCall) providers.push(openaiCall); if (anthropicCall) providers.push(anthropicCall) }

  if (providers.length === 0) throw new Error('Nenhuma chave de IA configurada (Anthropic/OpenAI)')

  let lastErr: unknown = null
  for (const call of providers) {
    try {
      const parsed = parseJson(await call())
      if (parsed) return parsed
    } catch (e) {
      lastErr = e
    }
  }
  if (lastErr) throw lastErr
  return null
}

/** Analisa UMA gravação (idempotente: pula se já analisada ou sem transcrição). */
export async function analyzeMeetingRecording(recId: number): Promise<MeetingAnalysis | null> {
  const rec = await prisma.meetingRecording.findUnique({
    where: { id: recId },
    select: { id: true, transcriptText: true, analyzedAt: true, leadId: true },
  })
  if (!rec || !rec.transcriptText || rec.transcriptText.trim().length < 20) return null
  if (rec.analyzedAt) return null

  const transcript = rec.transcriptText.slice(0, MAX_TRANSCRIPT_CHARS)
  const pb = await getSalesPlaybook()
  const ms = await getMeetingsSettings()
  const system = buildSystem({ playbookText: pb.enabled ? pb.text : undefined, language: ms.language, extra: ms.analysisExtra })
  const analysis = await runLlm(`Transcrição da reunião:\n\n${transcript}`, system)
  if (!analysis) return null

  await prisma.meetingRecording.update({
    where: { id: recId },
    data: { analysis: analysis as any, analyzedAt: new Date() },
  })
  console.log(`[MeetingAnalysis] #${recId} analisada (sentimento=${analysis.sentimento}, ${analysis.acaoItems.length} ação(ões))`)
  // (4/5/7) ações pós-análise: anexar ao lead, alerta, webhook — best-effort.
  void runPostAnalysisActions(recId).catch(() => {})
  return analysis
}

// Revisão da transcrição (modo "corrigida"): deixa a transcrição mais clara e
// profissional SEM alterar o sentido. Usa Anthropic (texto puro).
const POLISH_SYSTEM = `Você revisa transcrições de reunião para deixá-las mais claras e profissionais, SEM alterar o sentido nem inventar conteúdo. Corrija erros óbvios de transcrição, pontuação e gramática e remova vícios de fala (né, tipo, hum, éé). MANTENHA as marcações de tempo e os nomes dos falantes exatamente no mesmo formato "[mm:ss] Falante: texto". Responda APENAS com a transcrição revisada, sem comentários.`

export async function polishMeetingTranscript(recId: number): Promise<boolean> {
  const rec = await prisma.meetingRecording.findUnique({
    where: { id: recId },
    select: { transcriptText: true, transcriptPolished: true },
  })
  if (!rec?.transcriptText || rec.transcriptPolished) return false
  const key = await getAnthropicKey()
  if (!key) return false // revisão usa Anthropic (texto puro)
  const model = await getAnthropicModel()
  let polished = ''
  try {
    polished = (await callAnthropic(POLISH_SYSTEM, rec.transcriptText.slice(0, MAX_TRANSCRIPT_CHARS), key, model)).trim()
  } catch { return false }
  if (!polished) return false
  await prisma.meetingRecording.update({ where: { id: recId }, data: { transcriptPolished: polished } })
  console.log(`[MeetingAnalysis] #${recId} transcrição revisada (modo corrigida)`)
  return true
}

/** Revisa transcrições pendentes quando o modo é "corrigida" (chamado pelo poller). */
export async function polishPendingMeetings(limit = 3): Promise<number> {
  const ms = await getMeetingsSettings()
  if (ms.transcriptMode !== 'corrigida') return 0
  const pending = await prisma.meetingRecording.findMany({
    where: { status: 'completed', transcriptPolished: null, transcriptText: { not: null } },
    orderBy: { createdAt: 'asc' }, take: limit, select: { id: true },
  })
  let n = 0
  for (const p of pending) { try { if (await polishMeetingTranscript(p.id)) n++ } catch { /* segue */ } }
  return n
}

/** Varre gravações concluídas ainda sem análise e as processa (chamado pelo poller). */
export async function analyzePendingMeetings(limit = 5): Promise<number> {
  if (!(await getMeetingsSettings()).analysisEnabled) return 0
  const pending = await prisma.meetingRecording.findMany({
    where: { status: 'completed', analyzedAt: null, transcriptText: { not: null } },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { id: true },
  })
  let done = 0
  for (const p of pending) {
    try {
      const r = await analyzeMeetingRecording(p.id)
      if (r) done++
    } catch (e: any) {
      console.warn(`[MeetingAnalysis] #${p.id} falhou:`, e?.message)
    }
  }
  return done
}
