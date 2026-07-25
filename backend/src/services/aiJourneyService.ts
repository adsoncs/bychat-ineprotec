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

interface AiStageDecision {
  stageKey: string | null
  confidence: number
  reasoning: string
}

function buildSystemPrompt(funnelName: string, stages: Array<{ key: string; name: string }>, customPrompt: string | null): string {
  const stagesList = stages.map((s, i) => `${i + 1}. \`${s.key}\` — ${s.name}`).join('\n')
  const critsBlock = customPrompt
    ? `\n## Critérios de classificação (definidos pelo gestor):\n${customPrompt}`
    : '\n## Critérios:\nUse o nome de cada etapa como guia. Etapas iniciais são para leads recém-chegados; etapas avançadas exigem evidências claras de interesse, qualificação ou negociação. Não avance se as mensagens não suportarem.'

  return `Você é um especialista em CRM. Sua tarefa é classificar em qual etapa do funil "${funnelName}" um lead deveria estar AGORA, com base no histórico de mensagens.

## Etapas disponíveis (use o KEY exato):
${stagesList}
${critsBlock}

Devolva ESTRITAMENTE JSON válido (sem markdown), shape:
{
  "stageKey": string (uma das keys acima) | null (se evidências insuficientes),
  "confidence": number (0-100, quanto a IA confia na classificação),
  "reasoning": string (até 400 chars, em português, explicando a decisão)
}

Regras:
- Se as mensagens não fornecerem evidência clara, prefira null com confidence baixa em vez de chutar.
- Não suba o lead de etapa só por mensagens curtas como "ok" / "obrigado".
- Confidence ≥ 80 = decisão clara; entre 60-79 = razoável mas merece revisão humana; < 60 = chute.`.trim()
}

function buildUserPrompt(lead: any, messages: Array<{ fromMe: boolean; body: string; timestamp: Date }>): string {
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
  return `Lead: ${leadInfo}\n\nÚltimas ${messages.length} mensagens (cronológico):\n\n${lines}\n\nClassifique a etapa.`
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
  return {
    stageKey,
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
 */
export async function runAiJourneyForLead(leadId: number): Promise<RunResult> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      funnel: {
        include: {
          stages: { where: { active: true }, orderBy: { position: 'asc' }, select: { key: true, name: true, position: true } },
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

  const chronological = [...lead.messages].reverse()
  const stages = lead.funnel.stages
  const validKeys = stages.map(s => s.key)

  const systemPrompt = buildSystemPrompt(lead.funnel.name, stages, lead.funnel.aiStagePrompt ?? null)
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

  // Sem stage clara — não registra sugestão (evita lixo de "null" no histórico)
  if (!decision.stageKey) {
    return { leadId, suggestionId: null, applied: false, confidence: decision.confidence, reasoning: decision.reasoning || 'IA não conseguiu classificar' }
  }
  // Se a sugestão é a mesma etapa atual, é um no-op
  if (decision.stageKey === lead.status) {
    return { leadId, suggestionId: null, applied: false, confidence: decision.confidence, reasoning: 'Lead já está nesta etapa' }
  }

  // Marca sugestões pendentes anteriores deste lead como "superseded"
  await prisma.leadStageSuggestion.updateMany({
    where: { leadId, status: 'pending' },
    data: { status: 'superseded' },
  })

  // Decide se aplica automaticamente
  const autoApply = lead.funnel.aiStageAutoApply && decision.confidence >= (lead.funnel.aiStageThreshold ?? 80)

  const suggestion = await prisma.leadStageSuggestion.create({
    data: {
      leadId,
      funnelId: lead.funnel.id,
      fromStageKey: lead.status ?? null,
      suggestedStageKey: decision.stageKey,
      confidence: decision.confidence,
      reasoning: decision.reasoning,
      modelUsed: aiResp.model,
      status: autoApply ? 'applied' : 'pending',
      appliedAt: autoApply ? new Date() : null,
    },
  })

  if (autoApply) {
    const previousStatus = lead.status
    await prisma.lead.update({
      where: { id: leadId },
      data: { status: decision.stageKey },
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
          select: { isGroup: true, funnel: { select: { aiStageEnabled: true } } },
        })
        // Conversa de grupo não entra na Jornada IA: não há um lead a qualificar
        // e cada mensagem de participante dispararia análise (custo sem retorno).
        if (lead?.isGroup) return
        if (!lead?.funnel?.aiStageEnabled) return
        await queues.aiJourney.add('analyze', { leadId }, { attempts: 2, backoff: { type: 'exponential', delay: 30_000 } })
      } catch (err: any) {
        console.warn('[aiJourney] enqueue após mensagem falhou:', err?.message || err)
      }
    }, DEBOUNCE_MS)
    debounceMap.set(leadId, t)
  })

  console.log('[aiJourney] listener iniciado — analisa lead automaticamente após receber mensagens (debounce 60s)')
}
