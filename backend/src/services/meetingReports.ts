// src/services/meetingReports.ts
// (#1) Relatório multi-reunião — agrega as análises de várias reuniões de um
// período/lead/operador e devolve tendências (objeções comuns, temas, aderência
// média, recomendações). Reusa o pattern de LLM (Anthropic preferido).

import { prisma } from '../lib/prisma.js'
import {
  getAnthropicKey, getOpenAiKey, getPrimaryProvider, getAnthropicModel, getOpenAiModel,
} from '../lib/aiKeys.js'

export interface MeetingsReport {
  meetingCount: number
  periodo: { from: string | null; to: string | null }
  aderenciaMedia: number | null
  resumo: string
  objecoesComuns: string[]
  temas: string[]
  recomendacoes: string[]
}

const arr = (v: unknown): string[] => Array.isArray(v) ? v.map(String).filter(Boolean) : []

async function anthropic(system: string, user: string, key: string, model: string): Promise<string> {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 1500, messages: [{ role: 'user', content: `${system}\n\n${user}` }] }),
  })
  if (!r.ok) throw new Error(`Anthropic ${r.status}`)
  const d: any = await r.json()
  return d.content?.[0]?.text ?? ''
}
async function openai(system: string, user: string, key: string, model: string): Promise<string> {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, response_format: { type: 'json_object' }, max_tokens: 1500, temperature: 0.2, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
  })
  if (!r.ok) throw new Error(`OpenAI ${r.status}`)
  const d: any = await r.json()
  return d.choices?.[0]?.message?.content ?? ''
}
function parse(raw: string): any | null {
  if (!raw) return null
  const c = raw.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  const s = c.indexOf('{'), e = c.lastIndexOf('}')
  if (s < 0 || e < 0) return null
  try { return JSON.parse(c.slice(s, e + 1)) } catch { return null }
}
async function llmJson(system: string, user: string): Promise<any | null> {
  const primary = await getPrimaryProvider()
  const aK = await getAnthropicKey(), oK = await getOpenAiKey()
  const aM = await getAnthropicModel(), oM = await getOpenAiModel()
  const calls: Array<() => Promise<string>> = []
  if (primary !== 'openai') { if (aK) calls.push(() => anthropic(system, user, aK, aM)); if (oK) calls.push(() => openai(system, user, oK, oM)) }
  else { if (oK) calls.push(() => openai(system, user, oK, oM)); if (aK) calls.push(() => anthropic(system, user, aK, aM)) }
  for (const c of calls) { try { const p = parse(await c()); if (p) return p } catch { /* próximo */ } }
  return null
}

const REPORT_SYSTEM = `Você é um analista de vendas/CS sênior. Recebe RESUMOS de várias reuniões e
devolve um RELATÓRIO AGREGADO em português do Brasil. Responda SOMENTE com um JSON válido:
{
  "resumo": "panorama do período em 3-5 frases",
  "objecoesComuns": ["as objeções/dúvidas mais recorrentes entre as reuniões"],
  "temas": ["temas e padrões que se repetem"],
  "recomendacoes": ["recomendações acionáveis para o time com base nas tendências"]
}`

export async function generateMeetingsReport(opts: { from?: Date; to?: Date; leadId?: number; userId?: number }): Promise<MeetingsReport> {
  const where: any = { status: 'completed', analyzedAt: { not: null } }
  if (opts.from || opts.to) where.createdAt = { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lte: opts.to } : {}) }
  if (opts.leadId) where.leadId = opts.leadId
  if (opts.userId) where.userId = opts.userId

  const recs = await prisma.meetingRecording.findMany({
    where, orderBy: { createdAt: 'desc' }, take: 100,
    select: { analysis: true, createdAt: true },
  })
  const analyses = recs.map(r => r.analysis).filter(Boolean) as any[]
  const periodo = {
    from: opts.from?.toISOString() ?? (recs.length ? recs[recs.length - 1].createdAt.toISOString() : null),
    to: opts.to?.toISOString() ?? (recs.length ? recs[0].createdAt.toISOString() : null),
  }
  const adher = analyses.map(a => a?.playbook?.aderencia).filter((n: any) => typeof n === 'number')
  const aderenciaMedia = adher.length ? Math.round(adher.reduce((s: number, n: number) => s + n, 0) / adher.length) : null

  if (analyses.length === 0) {
    return { meetingCount: 0, periodo, aderenciaMedia: null, resumo: 'Nenhuma reunião analisada no período.', objecoesComuns: [], temas: [], recomendacoes: [] }
  }

  const digest = analyses.slice(0, 60).map((a, i) =>
    `Reunião ${i + 1}: ${a.resumo || ''} | Objeções: ${(a.objecoes || []).join('; ')} | Tópicos: ${(a.topicos || []).join('; ')}`,
  ).join('\n').slice(0, 12000)

  const out = await llmJson(REPORT_SYSTEM, `São ${analyses.length} reuniões. Aderência média ao playbook: ${aderenciaMedia ?? 'n/d'}.\n\n${digest}`)
  return {
    meetingCount: analyses.length,
    periodo,
    aderenciaMedia,
    resumo: String(out?.resumo || '').trim(),
    objecoesComuns: arr(out?.objecoesComuns),
    temas: arr(out?.temas),
    recomendacoes: arr(out?.recomendacoes),
  }
}
