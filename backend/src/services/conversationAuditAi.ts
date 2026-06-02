// src/services/conversationAuditAi.ts
//
// Auditoria automática de conversas por IA. Lê as últimas mensagens do Lead,
// pede pra IA avaliar qualidade do atendimento e devolver JSON estruturado.
// Persistido em ConversationAudit.

import { prisma } from '../lib/prisma.js'
import { getAnthropicKey, getOpenAiKey, getAnthropicModel, getOpenAiModel, getPrimaryProvider } from '../lib/aiKeys.js'
import { getActivePersonaSystemPrompt } from '../routes/personas.js'

const MAX_MESSAGES = 60
const MAX_BODY_PER_MSG = 800

interface AiAuditResult {
  score: number               // 0-100
  tone: 'cordial' | 'neutro' | 'frio' | 'agressivo' | 'inconsistente'
  strengths: string[]
  weaknesses: string[]
  missedOpportunities: string[]
  scriptAdherence: number | null  // 0-100 ou null
  summary: string
}

// ── Stats de tempo de resposta (sem IA, calculado das mensagens) ──

function pickResponseTimeStats(messages: Array<{ fromMe: boolean; timestamp: Date }>): { avgSec: number | null; p95Sec: number | null } {
  // Mede tempo entre "mensagem do cliente" → "primeira resposta nossa".
  const deltas: number[] = []
  let lastClientAt: number | null = null
  for (const m of messages) {
    const ts = m.timestamp.getTime()
    if (!m.fromMe) {
      lastClientAt = ts
    } else if (lastClientAt !== null) {
      const delta = Math.max(0, Math.floor((ts - lastClientAt) / 1000))
      if (delta < 7 * 24 * 60 * 60) deltas.push(delta) // ignora gaps > 7d (provavelmente lead frio)
      lastClientAt = null
    }
  }
  if (deltas.length === 0) return { avgSec: null, p95Sec: null }
  const avg = Math.round(deltas.reduce((a, b) => a + b, 0) / deltas.length)
  const sorted = [...deltas].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))
  return { avgSec: avg, p95Sec: sorted[idx] }
}

// ── Construção do prompt ──

function buildSystemPrompt(personaContext: string | null): string {
  const personaBlock = personaContext ? `\n\nContexto da persona-alvo do negócio:\n${personaContext}` : ''
  return `Você é um auditor sênior de atendimento ao cliente. Avalia conversas comerciais (lead × atendente) com base em:
- Tom do atendente (cordial / neutro / frio / agressivo / inconsistente)
- Velocidade de resposta e proatividade
- Aderência ao roteiro de qualificação (se aplicável)
- Identificação de objeções não tratadas
- Oportunidades perdidas (próximos passos não oferecidos, perguntas-chave não feitas, propostas de valor não exploradas)
- Qualidade da redação (clareza, ortografia, profissionalismo)

Devolve estritamente JSON válido neste shape (sem markdown, sem texto antes/depois):
{
  "score": number (0-100),
  "tone": "cordial" | "neutro" | "frio" | "agressivo" | "inconsistente",
  "strengths": string[] (3-5 itens curtos),
  "weaknesses": string[] (até 5 itens curtos),
  "missedOpportunities": string[] (até 5 itens),
  "scriptAdherence": number (0-100) | null,
  "summary": string (até 600 caracteres, em português)
}
${personaBlock}`.trim()
}

function buildUserPrompt(lead: any, messages: Array<{ fromMe: boolean; body: string; timestamp: Date; senderName?: string | null }>): string {
  const leadInfo = [
    `Nome: ${lead?.nome || 'N/A'}`,
    `Status: ${lead?.status || 'N/A'}`,
    `Funil: ${lead?.funnel?.name || 'N/A'}`,
    `Origem: ${lead?.origin || lead?.source || 'N/A'}`,
  ].join(' · ')

  const lines = messages.map(m => {
    const who = m.fromMe ? `ATENDENTE${m.senderName ? `(${m.senderName})` : ''}` : 'LEAD'
    const ts = m.timestamp.toISOString().slice(0, 19).replace('T', ' ')
    const body = (m.body || '').slice(0, MAX_BODY_PER_MSG)
    return `[${ts}] ${who}: ${body}`
  }).join('\n')

  return `Lead em análise: ${leadInfo}\n\nÚltimas ${messages.length} mensagens (cronológico):\n\n${lines}\n\nAvalie a qualidade do atendimento do(s) atendente(s) e devolva o JSON.`
}

// ── Chamada IA com fallback Anthropic→OpenAI ──

async function callAnthropic(apiKey: string, model: string, systemPrompt: string, userPrompt: string): Promise<{ text: string; model: string }> {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
    signal: AbortSignal.timeout(45_000),
  })
  if (!resp.ok) {
    const t = await resp.text().catch(() => '')
    throw new Error(`Anthropic ${resp.status}: ${t.slice(0, 200)}`)
  }
  const data = await resp.json() as any
  const text = data.content?.[0]?.text || ''
  return { text, model }
}

async function callOpenAi(apiKey: string, model: string, systemPrompt: string, userPrompt: string): Promise<{ text: string; model: string }> {
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      max_tokens: 1500,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
    signal: AbortSignal.timeout(45_000),
  })
  if (!resp.ok) {
    const t = await resp.text().catch(() => '')
    throw new Error(`OpenAI ${resp.status}: ${t.slice(0, 200)}`)
  }
  const data = await resp.json() as any
  const text = data.choices?.[0]?.message?.content || ''
  return { text, model }
}

function safeParseJson(raw: string): any {
  // Modelos às vezes envelopam o JSON em markdown ```json ... ``` — extrai.
  const cleaned = raw.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  try { return JSON.parse(cleaned) } catch { /* tenta extrair primeiro { ... } */ }
  const match = cleaned.match(/\{[\s\S]*\}/)
  if (match) {
    try { return JSON.parse(match[0]) } catch { /* nada */ }
  }
  return null
}

function validateAndClamp(parsed: any): AiAuditResult | null {
  if (!parsed || typeof parsed !== 'object') return null
  const score = typeof parsed.score === 'number' ? Math.max(0, Math.min(100, Math.round(parsed.score))) : null
  if (score === null) return null
  const validTones = ['cordial', 'neutro', 'frio', 'agressivo', 'inconsistente']
  const tone = validTones.includes(parsed.tone) ? parsed.tone : 'neutro'
  const arr = (v: any): string[] => Array.isArray(v) ? v.slice(0, 8).map(x => String(x).slice(0, 250)) : []
  const scriptAdherence = typeof parsed.scriptAdherence === 'number'
    ? Math.max(0, Math.min(100, Math.round(parsed.scriptAdherence)))
    : null
  return {
    score,
    tone,
    strengths: arr(parsed.strengths),
    weaknesses: arr(parsed.weaknesses),
    missedOpportunities: arr(parsed.missedOpportunities),
    scriptAdherence,
    summary: String(parsed.summary || '').slice(0, 1000),
  }
}

// ── Função principal ──

export async function auditLeadConversation(leadId: number, opts: { triggeredBy?: string; triggeredById?: number | null } = {}): Promise<number> {
  // Cria registro pending pra refletir progresso na UI
  const pending = await prisma.conversationAudit.create({
    data: {
      leadId,
      status: 'running',
      triggeredBy: opts.triggeredBy || 'manual',
      triggeredById: opts.triggeredById ?? null,
    },
  })

  try {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        funnel: { select: { name: true } },
        messages: {
          where: { isDeleted: false, isInternal: false },
          orderBy: { timestamp: 'desc' },
          take: MAX_MESSAGES,
          select: { fromMe: true, body: true, timestamp: true, senderName: true },
        },
      },
    })
    if (!lead) throw new Error('Lead não encontrado')
    if (lead.messages.length < 4) {
      await prisma.conversationAudit.update({
        where: { id: pending.id },
        data: { status: 'failed', errorMessage: 'Lead não tem mensagens suficientes para auditar (mínimo 4)', messageCount: lead.messages.length },
      })
      return pending.id
    }

    // Reordena cronológico (foram pegas DESC pra take ficar nas mais recentes)
    const chronological = [...lead.messages].reverse()
    const periodFrom = chronological[0].timestamp
    const periodTo = chronological[chronological.length - 1].timestamp
    const { avgSec, p95Sec } = pickResponseTimeStats(chronological)

    // Snapshot do operador "principal" (último que enviou ou assigned do lead)
    let operatorId: number | null = (lead as any).assignedUserId ?? null
    let operatorName: string | null = null
    if (!operatorId) {
      const lastFromMe = [...chronological].reverse().find(m => m.fromMe && m.senderName)
      operatorName = lastFromMe?.senderName ?? null
    } else {
      const u = await prisma.user.findUnique({ where: { id: operatorId }, select: { name: true } }).catch(() => null)
      operatorName = u?.name ?? null
    }

    // Chamada IA
    const personaContext = await getActivePersonaSystemPrompt()
    const systemPrompt = buildSystemPrompt(personaContext)
    const userPrompt = buildUserPrompt(lead, chronological)

    const primary = await getPrimaryProvider()
    const anthropicKey = await getAnthropicKey()
    const openaiKey = await getOpenAiKey()
    let aiResp: { text: string; model: string } | null = null
    let lastErr: Error | null = null

    const tryAnthropic = async () => {
      if (!anthropicKey) throw new Error('Anthropic key não configurada')
      const model = await getAnthropicModel()
      aiResp = await callAnthropic(anthropicKey, model, systemPrompt, userPrompt)
    }
    const tryOpenAi = async () => {
      if (!openaiKey) throw new Error('OpenAI key não configurada')
      const model = await getOpenAiModel()
      aiResp = await callOpenAi(openaiKey, model, systemPrompt, userPrompt)
    }

    if (primary === 'openai') {
      try { await tryOpenAi() } catch (e: any) { lastErr = e; try { await tryAnthropic() } catch (e2: any) { lastErr = e2 } }
    } else {
      try { await tryAnthropic() } catch (e: any) { lastErr = e; try { await tryOpenAi() } catch (e2: any) { lastErr = e2 } }
    }
    if (!aiResp) throw lastErr ?? new Error('Sem provedor de IA disponível')

    const parsed = safeParseJson(aiResp.text)
    const result = validateAndClamp(parsed)
    if (!result) {
      throw new Error(`Resposta da IA inválida: ${aiResp.text.slice(0, 200)}`)
    }

    await prisma.conversationAudit.update({
      where: { id: pending.id },
      data: {
        operatorId,
        operatorName,
        periodFrom,
        periodTo,
        messageCount: chronological.length,
        score: result.score,
        tone: result.tone,
        responseTimeAvgSec: avgSec,
        responseTimeP95Sec: p95Sec,
        strengths: result.strengths as any,
        weaknesses: result.weaknesses as any,
        missedOpportunities: result.missedOpportunities as any,
        scriptAdherence: result.scriptAdherence,
        summary: result.summary,
        modelUsed: aiResp.model,
        status: 'done',
      },
    })
    return pending.id
  } catch (err: any) {
    await prisma.conversationAudit.update({
      where: { id: pending.id },
      data: { status: 'failed', errorMessage: (err?.message || 'erro desconhecido').slice(0, 1000) },
    }).catch(() => { /* ignore */ })
    console.warn(`[conversationAudit] FAIL leadId=${leadId}:`, err?.message || err)
    throw err
  }
}
