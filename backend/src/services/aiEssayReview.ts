// src/services/aiEssayReview.ts
// Correção automática de redação via Claude. Critérios e pesos vêm do
// SelectionProcess.essayAiCriteria (configurável pelo admin sem deploy).
// Resultado preenche aiScore, aiAnalysis, aiConfidence em EssaySubmission e
// avança status para 'needs_human' (sempre pede revisão humana — IA é apoio).

import { prisma } from '../lib/prisma.js'
import { eventBus } from '../lib/eventBus.js'
import { tryAutoAdvanceOnEvaluationComplete } from './enrollmentEvaluationGateway.js'

// Modelo resolvido em runtime via lib/aiKeys (Setting > env > default)
const MAX_TOKENS = 2000

const DEFAULT_CRITERIA = [
  { key: 'argumentacao', label: 'Argumentação',                      weight: 25 },
  { key: 'coesao',       label: 'Coesão e coerência',                weight: 20 },
  { key: 'gramatica',    label: 'Gramática e ortografia',            weight: 20 },
  { key: 'tema',         label: 'Aderência ao tema',                 weight: 20 },
  { key: 'proposta',     label: 'Conclusão / proposta de intervenção', weight: 15 },
]

// Resolve key via DB (Setting `ai.anthropic_api_key`) → env. Sem isso, key
// configurada pela UI Configurações > APIs era ignorada e o serviço falhava
// silenciosamente mesmo com configuração válida no banco.
import { getAnthropicKey as resolveAnthropicKey, getAnthropicModel } from '../lib/aiKeys.js'

function buildSystemPrompt(criteriaList: any[]): string {
  const lines = criteriaList.map(c => `- ${c.key} (${c.label}, peso ${c.weight}%)`).join('\n')
  return `Você é um corretor profissional de redações dissertativo-argumentativas no padrão de vestibulares brasileiros.

Avalie a redação de acordo com estes critérios e pesos:
${lines}

Para cada critério, atribua nota de 0 a 100 (inteira), justifique em 1 frase curta e aponte 1 sugestão construtiva.
Calcule a nota global como média ponderada das notas dos critérios pelos pesos informados.
Atribua um nível de confiança (0.0 a 1.0) sobre sua própria avaliação — quanto mais ambíguo o texto, menor.

Responda EXCLUSIVAMENTE em JSON válido (sem markdown), no formato:
{
  "criteria": [
    { "key": "<key>", "score": 0-100, "comment": "...", "suggestion": "..." }
  ],
  "overall": 0-100,
  "confidence": 0.0-1.0,
  "summary": "1-2 frases sobre a impressão geral",
  "redFlags": ["fuga ao tema" | "plágio suspeito" | "texto muito curto" | ...]
}

Importante: aprovação/rejeição final é decisão humana — você só fornece nota e parecer técnico.`
}

function buildUserPrompt(prompt: string, essayText: string, wordCount: number): string {
  return `## Tema/Proposta
${prompt}

## Redação do candidato (${wordCount} palavras)
${essayText}

Avalie conforme as instruções do system prompt e responda apenas com o JSON.`
}

async function callClaude(systemPrompt: string, userPrompt: string): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const apiKey = await resolveAnthropicKey()
  if (!apiKey) throw new Error('Configure a chave Anthropic em Configurações > APIs antes de corrigir redações com IA.')
  const model = await getAnthropicModel()

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages: [{ role: 'user', content: [{ type: 'text', text: userPrompt }] }],
    }),
  })
  if (!resp.ok) {
    const errText = await resp.text()
    throw new Error(`Anthropic ${resp.status}: ${errText.substring(0, 300)}`)
  }
  const data: any = await resp.json()
  const text = data.content?.[0]?.text || ''
  return {
    text,
    inputTokens: data.usage?.input_tokens || 0,
    outputTokens: data.usage?.output_tokens || 0,
  }
}

function tryParseJson(s: string): any | null {
  // Claude às vezes responde com markdown — tira fences.
  const cleaned = s.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
  try { return JSON.parse(cleaned) } catch {}
  // Fallback: captura primeiro objeto JSON
  const m = cleaned.match(/\{[\s\S]*\}/)
  if (m) { try { return JSON.parse(m[0]) } catch {} }
  return null
}

// Custo aproximado em USD para Claude Sonnet 4.6:
// input ~$3 / 1M tokens, output ~$15 / 1M tokens.
function estimateCost(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15
}

export async function correctEssayById(submissionId: number): Promise<void> {
  const sub = await prisma.essaySubmission.findUnique({
    where: { id: submissionId },
    include: {
      registration: {
        select: {
          id: true, candidateCode: true,
          lead: { select: { id: true, nome: true, email: true, whatsapp: true } },
          portal: { select: { id: true, nome: true } },
          processRegistration: {
            select: {
              selectionProcess: {
                select: {
                  essayAiCriteria: true,
                  essayAiAutoApprove: true,
                  essayCutoff: true,
                },
              },
              offering: { select: { essayCutoff: true, nome: true, course: { select: { nome: true } } } },
            },
          },
        },
      },
    },
  })
  if (!sub) throw new Error(`Submission ${submissionId} não encontrada`)
  if (!sub.essayText || sub.essayText.trim().length < 30) {
    // Texto curto demais — pula IA, manda direto pra revisão humana
    await prisma.essaySubmission.update({
      where: { id: sub.id },
      data: {
        status: 'needs_human',
        aiAnalysis: { skipped: true, reason: 'Texto muito curto para correção automática' } as any,
        aiProcessedAt: new Date(),
      },
    })
    return
  }

  const criteriaList = (sub.registration?.processRegistration?.selectionProcess?.essayAiCriteria as any[] | null)
    || DEFAULT_CRITERIA

  const systemPrompt = buildSystemPrompt(criteriaList)
  const userPrompt = buildUserPrompt(sub.prompt || '', sub.essayText, sub.wordCount)

  let raw: { text: string; inputTokens: number; outputTokens: number }
  try {
    raw = await callClaude(systemPrompt, userPrompt)
  } catch (err: any) {
    await prisma.essaySubmission.update({
      where: { id: sub.id },
      data: {
        status: 'needs_human',
        aiAnalysis: { error: err.message?.substring(0, 500) } as any,
        aiProcessedAt: new Date(),
      },
    })
    throw err
  }

  const parsed = tryParseJson(raw.text)
  if (!parsed || typeof parsed !== 'object') {
    await prisma.essaySubmission.update({
      where: { id: sub.id },
      data: {
        status: 'needs_human',
        aiAnalysis: { parseError: true, raw: raw.text.substring(0, 1000) } as any,
        aiProcessedAt: new Date(),
        aiCostUsd: estimateCost(raw.inputTokens, raw.outputTokens),
      },
    })
    return
  }

  const aiScore = typeof parsed.overall === 'number' ? Math.max(0, Math.min(100, parsed.overall)) : null
  const aiConfidence = typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : null

  // Decide veredito final ou revisão humana com base no toggle essayAiAutoApprove.
  // Auto-approve só é seguro quando: flag ligada + cutoff definido + aiScore válido.
  const sp = sub.registration?.processRegistration?.selectionProcess
  const cutoff = sub.registration?.processRegistration?.offering?.essayCutoff ?? sp?.essayCutoff ?? null
  const canAutoDecide = sp?.essayAiAutoApprove === true && cutoff != null && aiScore != null

  let nextStatus: 'approved' | 'rejected' | 'needs_human' = 'needs_human'
  let passed: boolean | null = null
  let finalScore: number | null = null
  let cutoffApplied: number | null = null
  if (canAutoDecide) {
    passed = aiScore >= cutoff
    nextStatus = passed ? 'approved' : 'rejected'
    finalScore = aiScore
    cutoffApplied = cutoff
  }

  await prisma.essaySubmission.update({
    where: { id: sub.id },
    data: {
      status: nextStatus,
      aiScore,
      aiConfidence,
      aiAnalysis: parsed,
      aiProcessedAt: new Date(),
      aiCostUsd: estimateCost(raw.inputTokens, raw.outputTokens),
      ...(canAutoDecide ? { passed, finalScore, cutoffApplied } : {}),
    },
  })

  // Quando o auto-veredito da IA decide aprovado/rejeitado, dispara o mesmo
  // evento de domínio que a revisão manual emite — garante que o candidato
  // receba a notificação (workflow wf_enrollment_essay_approved/rejected).
  if (canAutoDecide && sub.registration?.lead) {
    const lead = sub.registration.lead
    const appUrl = process.env.APP_URL || 'http://localhost:3005'
    const courseName = sub.registration.processRegistration?.offering?.course?.nome
      || sub.registration.processRegistration?.offering?.nome
      || ''
    eventBus.emitDomain({
      type: nextStatus === 'approved' ? 'enrollment.essay_approved' : 'enrollment.essay_rejected',
      leadId: lead.id,
      payload: {
        nome: lead.nome,
        email: lead.email,
        whatsapp: lead.whatsapp,
        candidateCode: sub.registration.candidateCode,
        portalNome: sub.registration.portal?.nome || '',
        courseName,
        candidateUrl: `${appUrl}/candidato/${sub.registration.candidateCode}`,
        finalScore,
        passed,
        humanNote: parsed?.summary || '',
        decidedBy: 'ai',
      },
      timestamp: new Date(),
    })

    // Aprovado pela IA → roda gateway final igual ao fluxo manual (move lead
    // para finalApprovalStageKey se docs também estiverem completos).
    // actorUserId=null porque a decisão foi do sistema, não de um usuário.
    if (nextStatus === 'approved' && sub.registration.id) {
      tryAutoAdvanceOnEvaluationComplete(sub.registration.id, null).catch(() => {
        // Não propaga: notificação ao candidato já foi emitida; auto-advance é
        // best-effort. Falhas aqui não devem reverter o veredito da redação.
      })
    }
  }
}
