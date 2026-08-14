// src/services/aiJourneyService.ts
//
// Jornada Automática por IA — analisa um lead com base nas mensagens trocadas
// e nas etapas do funil, sugere a próxima etapa apropriada. Conforme config
// do Funnel (aiStageAutoApply + aiStageThreshold), aplica automaticamente
// ou deixa pendente pra revisão humana.
//
// Fonte da verdade dos critérios = funnel.aiStagePrompt (livre, opcional).
// Quando vazio, sistema constrói prompt default a partir de `Stage.name`.

import { prisma } from '../lib/prisma.js'
import { getAnthropicKey, getOpenAiKey, getAnthropicModel, getOpenAiModel, getPrimaryProvider } from '../lib/aiKeys.js'
import { eventBus } from '../lib/eventBus.js'
import { queues } from '../lib/queues.js'

const MAX_MESSAGES = 30
const MAX_BODY_PER_MSG = 600

/** Não reanalisar o mesmo lead antes disso. Sem esta trava, o debounce de 60s
 *  do listener dispara a cada pausa da conversa e o mesmo lead era classificado
 *  2-3 vezes no dia, cada análise invalidando a anterior. */
export const ANALYSIS_COOLDOWN_MINUTES = 30

interface AiStageDecision {
  /** 'stage' = mover para stageKey · 'not_in_funnel' = não pertence a este funil
   *  · 'unknown' = evidências insuficientes (não vira sugestão) */
  verdict: 'stage' | 'not_in_funnel' | 'unknown'
  stageKey: string | null
  confidence: number
  reasoning: string
}

function buildSystemPrompt(
  funnelName: string,
  stages: Array<{ key: string; name: string; position: number }>,
  customPrompt: string | null,
  currentStageKey: string | null,
): string {
  const currentIdx = stages.findIndex(s => s.key === currentStageKey)
  const stagesList = stages.map((s, i) => {
    const marker = i === currentIdx ? '  ← ETAPA ATUAL DO LEAD' : ''
    return `${i + 1}. \`${s.key}\` — ${s.name}${marker}`
  }).join('\n')

  const critsBlock = customPrompt
    ? `\n## Critérios de classificação (definidos pelo gestor):\n${customPrompt}`
    : '\n## Critérios:\nUse o nome de cada etapa como guia. Etapas iniciais são para leads recém-chegados; etapas avançadas exigem evidências claras de interesse, qualificação ou negociação. Não avance se as mensagens não suportarem.'

  // A regra de não regredir existe porque a IA lê só a conversa, enquanto o
  // avanço de etapa costuma acontecer FORA dela (visita marcada no balcão,
  // proposta enviada por e-mail). Sem isso, ela "corrigia" leads adiantados
  // para trás com alta confiança, usando como prova uma mensagem antiga.
  const positionRule = currentIdx >= 0
    ? `\n## A etapa atual é um piso, não um palpite
O lead está HOJE em \`${currentStageKey}\` (posição ${currentIdx + 1} de ${stages.length}). Alguém colocou o lead aí por um motivo, e boa parte do que faz um lead avançar acontece fora do WhatsApp.
- Só responda com uma etapa ANTERIOR à atual se a conversa contiver evidência explícita de retrocesso — o lead desmarcou a visita, desistiu da proposta, pediu para recomeçar. Saudade de contexto não é evidência.
- Reencontrar no histórico o fato que justificou a etapa atual (ex.: "confirmou a visita") NÃO é motivo para voltar para a etapa daquele fato. Isso já foi contabilizado.
- Se o lead já está na etapa correta, responda com a própria etapa atual e confidence alta. Isso é uma resposta boa, não uma falha.`
    : ''

  return `Você é um especialista em CRM. Sua tarefa é classificar em qual etapa do funil "${funnelName}" um lead deveria estar AGORA, com base no histórico de mensagens.

## Etapas disponíveis (use o KEY exato):
${stagesList}
${critsBlock}
${positionRule}

## Quando o lead não é deste funil
Nem todo contato pertence a este funil. Se a conversa mostrar que a pessoa procura outro assunto — já é cliente e quer suporte, cobrança, um setor diferente, ou é fornecedor/spam/candidato a vaga — responda \`verdict: "not_in_funnel"\` com \`stageKey: null\` e explique no reasoning para onde ela parece pertencer. Não escolha uma etapa qualquer só para preencher o campo.

Devolva ESTRITAMENTE JSON válido (sem markdown), shape:
{
  "verdict": "stage" | "not_in_funnel" | "unknown",
  "stageKey": string (uma das keys acima, obrigatório quando verdict="stage") | null,
  "confidence": number (0-100, quanto você confia na classificação),
  "reasoning": string (até 400 chars, em português, explicando a decisão)
}

Regras:
- Sem evidência clara, use verdict "unknown" com confidence baixa em vez de chutar.
- Não suba o lead de etapa só por mensagens curtas como "ok" / "obrigado".
- Confidence ≥ 80 = decisão clara; entre 60-79 = razoável mas merece revisão humana; < 60 = chute.`.trim()
}

function humanizeGap(from: Date | null, to: Date): string {
  if (!from) return 'desconhecido'
  const h = Math.round((to.getTime() - from.getTime()) / 3_600_000)
  if (h < 1) return 'menos de 1 hora'
  if (h < 48) return `${h} hora(s)`
  return `${Math.round(h / 24)} dia(s)`
}

function buildUserPrompt(lead: any, messages: Array<{ fromMe: boolean; body: string; timestamp: Date }>): string {
  // A IA precisa saber que dia é hoje. Antes ela via só os timestamps das
  // mensagens e não tinha como perceber que a conversa parou há duas semanas —
  // um lead esquecido parecia idêntico a um lead quente.
  const now = new Date()
  const last = messages.length ? messages[messages.length - 1].timestamp : null
  const leadInfo = [
    `Nome: ${lead?.nome || 'N/A'}`,
    `Etapa atual: ${lead?.status || 'N/A'}`,
    `Origem: ${lead?.origin || lead?.source || 'N/A'}`,
    `Tags: ${(lead?.tags || []).map((t: any) => t?.tag?.name).filter(Boolean).join(', ') || '—'}`,
  ].join(' · ')
  const lines = messages.map(m => {
    const who = m.fromMe ? 'ATENDENTE' : 'LEAD'
    const ts = m.timestamp.toISOString().slice(0, 16).replace('T', ' ')
    const body = (m.body || '').slice(0, MAX_BODY_PER_MSG)
    return `[${ts}] ${who}: ${body}`
  }).join('\n')
  const temporal = [
    `Agora: ${now.toISOString().slice(0, 16).replace('T', ' ')} (UTC)`,
    `Silêncio desde a última mensagem: ${humanizeGap(last, now)}`,
  ].join(' · ')
  return `Lead: ${leadInfo}\n${temporal}\n\nÚltimas ${messages.length} mensagens (cronológico):\n\n${lines}\n\nClassifique a etapa.`
}

async function callAnthropic(apiKey: string, model: string, systemPrompt: string, userPrompt: string): Promise<{ text: string; model: string }> {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 800, system: systemPrompt, messages: [{ role: 'user', content: userPrompt }] }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!resp.ok) {
    const t = await resp.text().catch(() => '')
    throw new Error(`Anthropic ${resp.status}: ${t.slice(0, 200)}`)
  }
  const d = await resp.json() as any
  return { text: d.content?.[0]?.text || '', model }
}

async function callOpenAi(apiKey: string, model: string, systemPrompt: string, userPrompt: string): Promise<{ text: string; model: string }> {
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      max_tokens: 800,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!resp.ok) {
    const t = await resp.text().catch(() => '')
    throw new Error(`OpenAI ${resp.status}: ${t.slice(0, 200)}`)
  }
  const d = await resp.json() as any
  return { text: d.choices?.[0]?.message?.content || '', model }
}

function safeParseJson(raw: string): any {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  try { return JSON.parse(cleaned) } catch { /* ignore */ }
  const match = cleaned.match(/\{[\s\S]*\}/)
  if (match) { try { return JSON.parse(match[0]) } catch { /* ignore */ } }
  return null
}

function validateDecision(parsed: any, validKeys: string[]): AiStageDecision | null {
  if (!parsed || typeof parsed !== 'object') return null
  const confidence = typeof parsed.confidence === 'number' ? Math.max(0, Math.min(100, Math.round(parsed.confidence))) : null
  if (confidence === null) return null
  const stageKey = parsed.stageKey === null ? null : (typeof parsed.stageKey === 'string' && validKeys.includes(parsed.stageKey) ? parsed.stageKey : null)

  // `verdict` é campo novo: resposta sem ele (ou com valor estranho) é lida pelo
  // formato antigo — tem etapa válida, é 'stage'; não tem, é 'unknown'.
  const raw = typeof parsed.verdict === 'string' ? parsed.verdict.trim().toLowerCase() : ''
  let verdict: AiStageDecision['verdict'] = raw === 'not_in_funnel' ? 'not_in_funnel' : raw === 'unknown' ? 'unknown' : (stageKey ? 'stage' : 'unknown')
  // Coerência: 'stage' sem etapa válida não é decisão, é ruído.
  if (verdict === 'stage' && !stageKey) verdict = 'unknown'

  return {
    verdict,
    stageKey: verdict === 'stage' ? stageKey : null,
    confidence,
    reasoning: String(parsed.reasoning || '').slice(0, 600),
  }
}

interface RunResult {
  leadId: number
  suggestionId: number | null
  applied: boolean
  confidence: number
  reasoning: string
}

/**
 * Analisa um lead, gera sugestão e aplica se config permitir.
 *
 * `force` pula o cooldown e a exigência de mensagem nova — é o que o tick
 * periódico usa para reavaliar quem parou de escrever.
 */
export async function runAiJourneyForLead(leadId: number, opts?: { force?: boolean }): Promise<RunResult> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      funnel: {
        include: {
          stages: { where: { active: true }, orderBy: { position: 'asc' }, select: { key: true, name: true, position: true, terminalKind: true } },
        },
      },
      tags: { select: { tag: { select: { name: true } } } },
      messages: {
        where: { isDeleted: false, isInternal: false },
        orderBy: { timestamp: 'desc' },
        take: MAX_MESSAGES,
        select: { fromMe: true, body: true, timestamp: true },
      },
    },
  })
  if (!lead) throw new Error('Lead não encontrado')
  if (!lead.funnel) throw new Error('Lead sem funil atribuído')
  if (!lead.funnel.aiStageEnabled) {
    return { leadId, suggestionId: null, applied: false, confidence: 0, reasoning: 'Funil sem Jornada IA ativada' }
  }
  if (lead.messages.length < 3) {
    return { leadId, suggestionId: null, applied: false, confidence: 0, reasoning: 'Poucas mensagens para classificar' }
  }

  // Lead encerrado não se reclassifica. Sem este guard, um lead Matriculado ou
  // Perdido continuava entrando na fila e podia receber sugestão de voltar para
  // o meio do funil — gastando IA para propor um retrocesso.
  const currentStage = lead.status ? lead.funnel.stages.find(s => s.key === lead.status) : undefined
  if (currentStage?.terminalKind) {
    return { leadId, suggestionId: null, applied: false, confidence: 0, reasoning: 'Lead já encerrado (etapa terminal)' }
  }

  if (!opts?.force) {
    const lastRun = lead.aiStageAnalyzedAt
    if (lastRun) {
      const minsSince = (Date.now() - lastRun.getTime()) / 60_000
      if (minsSince < ANALYSIS_COOLDOWN_MINUTES) {
        return { leadId, suggestionId: null, applied: false, confidence: 0, reasoning: `Analisado há ${Math.round(minsSince)} min (cooldown)` }
      }
      // Nada novo desde a última análise: o veredito seria idêntico, e cada
      // repetição invalidava a sugestão anterior e criava uma cópia.
      if (lead.lastMessageAt && lead.lastMessageAt <= lastRun) {
        return { leadId, suggestionId: null, applied: false, confidence: 0, reasoning: 'Sem mensagem nova desde a última análise' }
      }
    }
  }

  const chronological = [...lead.messages].reverse()
  const stages = lead.funnel.stages
  const validKeys = stages.map(s => s.key)

  const systemPrompt = buildSystemPrompt(lead.funnel.name, stages, lead.funnel.aiStagePrompt ?? null, lead.status ?? null)
  const userPrompt = buildUserPrompt(lead, chronological)

  const primary = await getPrimaryProvider()
  const anthropicKey = await getAnthropicKey()
  const openaiKey = await getOpenAiKey()
  let aiResp: { text: string; model: string } | null = null
  let lastErr: Error | null = null

  const tryAnthropic = async () => {
    if (!anthropicKey) throw new Error('Anthropic key não configurada')
    aiResp = await callAnthropic(anthropicKey, await getAnthropicModel(), systemPrompt, userPrompt)
  }
  const tryOpenAi = async () => {
    if (!openaiKey) throw new Error('OpenAI key não configurada')
    aiResp = await callOpenAi(openaiKey, await getOpenAiModel(), systemPrompt, userPrompt)
  }

  if (primary === 'openai') {
    try { await tryOpenAi() } catch (e: any) { lastErr = e; try { await tryAnthropic() } catch (e2: any) { lastErr = e2 } }
  } else {
    try { await tryAnthropic() } catch (e: any) { lastErr = e; try { await tryOpenAi() } catch (e2: any) { lastErr = e2 } }
  }
  if (!aiResp) throw lastErr ?? new Error('Sem provedor de IA disponível')

  const decision = validateDecision(safeParseJson(aiResp.text), validKeys)
  if (!decision) throw new Error(`Resposta da IA inválida: ${aiResp.text.slice(0, 200)}`)

  // Análise concluída: carimba SEMPRE, inclusive nos vereditos que não geram
  // sugestão. É o carimbo que sustenta o cooldown — sem ele, um lead que a IA
  // considera "já na etapa certa" era reanalisado a cada pausa da conversa.
  const stampAnalyzed = () => prisma.lead.update({
    where: { id: leadId }, data: { aiStageAnalyzedAt: new Date() },
  }).catch(() => { /* carimbo é otimização, não pode derrubar a análise */ })

  if (decision.verdict === 'unknown') {
    await stampAnalyzed()
    return { leadId, suggestionId: null, applied: false, confidence: decision.confidence, reasoning: decision.reasoning || 'IA não conseguiu classificar' }
  }
  // Etapa igual à atual = a IA confirmou o lugar do lead. Não vira sugestão.
  if (decision.verdict === 'stage' && decision.stageKey === lead.status) {
    await stampAnalyzed()
    return { leadId, suggestionId: null, applied: false, confidence: decision.confidence, reasoning: 'Lead já está nesta etapa' }
  }
  // Regressão: a IA foi instruída a não propor, mas se propuser mesmo assim,
  // barramos aqui. O funil é monotônico — ver services/stageSuggestions.ts.
  if (decision.verdict === 'stage' && currentStage && decision.stageKey) {
    const target = stages.find(s => s.key === decision.stageKey)
    if (target && target.position < currentStage.position) {
      await stampAnalyzed()
      return { leadId, suggestionId: null, applied: false, confidence: decision.confidence, reasoning: `Descartada: sugeria regredir de ${lead.status} para ${decision.stageKey}` }
    }
  }

  // Marca sugestões pendentes anteriores deste lead como "superseded"
  await prisma.leadStageSuggestion.updateMany({
    where: { leadId, status: 'pending' },
    data: { status: 'superseded', decidedAt: new Date(), decisionNote: '[auto] Substituída por uma análise mais recente.' },
  })

  // 'not_in_funnel' nunca se auto-aplica: tirar o lead do funil é decisão de
  // quem conhece a operação, não movimento de etapa.
  const autoApply = decision.verdict === 'stage'
    && lead.funnel.aiStageAutoApply
    && decision.confidence >= (lead.funnel.aiStageThreshold ?? 80)

  const suggestion = await prisma.leadStageSuggestion.create({
    data: {
      leadId,
      funnelId: lead.funnel.id,
      fromStageKey: lead.status ?? null,
      suggestedStageKey: decision.stageKey,
      kind: decision.verdict === 'not_in_funnel' ? 'not_in_funnel' : 'stage',
      confidence: decision.confidence,
      reasoning: decision.reasoning,
      modelUsed: aiResp.model,
      status: autoApply ? 'applied' : 'pending',
      appliedAt: autoApply ? new Date() : null,
    },
  })
  await stampAnalyzed()

  if (autoApply && decision.stageKey) {
    const appliedStageKey = decision.stageKey
    const previousStatus = lead.status
    await prisma.lead.update({
      where: { id: leadId },
      data: { status: appliedStageKey },
    })
    // Log de movimentação + evento de domínio
    await prisma.leadStageMovement.create({
      data: {
        leadId,
        fromFunnelId: lead.funnel.id,
        toFunnelId: lead.funnel.id,
        fromStageKey: previousStatus ?? null,
        toStageKey: decision.stageKey,
        source: 'ai_journey',
        reason: `IA confidence ${decision.confidence}%`,
        metadata: { suggestionId: suggestion.id, modelUsed: aiResp.model } as any,
      },
    }).catch(() => { /* tabela pode não existir em todas as versões */ })

    eventBus.emitDomain({
      type: 'lead.stage_changed',
      leadId,
      funnelId: lead.funnel.id,
      payload: {
        fromStageKey: previousStatus ?? null,
        toStageKey: decision.stageKey,
        source: 'ai_journey',
        confidence: decision.confidence,
        suggestionId: suggestion.id,
      },
      timestamp: new Date(),
    })
  }

  return {
    leadId,
    suggestionId: suggestion.id,
    applied: autoApply,
    confidence: decision.confidence,
    reasoning: decision.reasoning,
  }
}

// ── Listener: debounce de message.received para análise automática ──
//
// Quando o lead recebe uma mensagem nova, enfileira análise da Jornada IA
// (se o funil estiver com aiStageEnabled). Debounce em memória de 60s
// por lead pra não rodar IA a cada mensagem (custo).
const debounceMap = new Map<number, NodeJS.Timeout>()
const DEBOUNCE_MS = 60_000
let started = false

export function startAiJourneyListener(): void {
  if (started) return
  started = true

  eventBus.on('message.received', (e: any) => {
    const leadId = e?.leadId
    if (!leadId) return
    // Debounce: cada nova mensagem reseta o timer; quando estabilizar 60s, enfileira.
    const existing = debounceMap.get(leadId)
    if (existing) clearTimeout(existing)
    const t = setTimeout(async () => {
      debounceMap.delete(leadId)
      try {
        const lead = await prisma.lead.findUnique({
          where: { id: leadId },
          select: { isGroup: true, aiStageAnalyzedAt: true, funnel: { select: { aiStageEnabled: true } } },
        })
        // Conversa de grupo não entra na Jornada IA: não há um lead a qualificar
        // e cada mensagem de participante dispararia análise (custo sem retorno).
        if (lead?.isGroup) return
        if (!lead?.funnel?.aiStageEnabled) return
        // Cooldown checado ANTES de enfileirar. O guard definitivo vive em
        // runAiJourneyForLead; aqui é só para não encher a fila de jobs que
        // nasceriam para retornar cedo. Quem for barrado aqui é recuperado pelo
        // tick (aiJourneyScheduler), que enxerga "mensagem posterior à análise".
        if (lead.aiStageAnalyzedAt && (Date.now() - lead.aiStageAnalyzedAt.getTime()) / 60_000 < ANALYSIS_COOLDOWN_MINUTES) return
        await queues.aiJourney.add('analyze', { leadId }, { attempts: 2, backoff: { type: 'exponential', delay: 30_000 } })
      } catch (err: any) {
        console.warn('[aiJourney] enqueue após mensagem falhou:', err?.message || err)
      }
    }, DEBOUNCE_MS)
    debounceMap.set(leadId, t)
  })

  console.log('[aiJourney] listener iniciado — analisa lead automaticamente após receber mensagens (debounce 60s)')
}
