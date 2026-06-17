// src/services/helpdeskAi.ts
// IA do Helpdesk (F12): triagem (prioridade/tipo/sentimento), sugestão de
// resposta e resumo — reusa chatWithAI (Anthropic→OpenAI, chaves em Settings).

import { prisma } from '../lib/prisma.js'
import { chatWithAI } from './chatbotFlow.js'
import { getAnthropicKey, getOpenAiKey } from '../lib/aiKeys.js'
import { TICKET_PRIORITIES, TICKET_TYPES } from './helpdesk.js'

export async function aiConfigured(): Promise<boolean> {
  return !!((await getAnthropicKey()) || (await getOpenAiKey()))
}

async function loadThread(ticketId: number): Promise<{ subject: string; text: string; requesterName: string | null } | null> {
  const ticket = await prisma.helpdeskTicket.findUnique({ where: { id: ticketId }, select: { subject: true, requesterName: true } })
  if (!ticket) return null
  const comments = await prisma.helpdeskComment.findMany({ where: { ticketId }, orderBy: { createdAt: 'asc' }, take: 40, select: { authorType: true, authorName: true, visibility: true, body: true } })
  const text = comments.map((c) => {
    const who = c.authorType === 'requester' ? 'Solicitante' : c.authorType === 'system' ? 'Sistema' : `Agente (${c.authorName || ''})`
    const vis = c.visibility === 'internal' ? ' [nota interna]' : ''
    return `${who}${vis}: ${c.body}`
  }).join('\n')
  return { subject: ticket.subject, text, requesterName: ticket.requesterName }
}

function extractJson(s: string): any {
  const m = s.match(/\{[\s\S]*\}/)
  if (!m) return null
  try { return JSON.parse(m[0]) } catch { return null }
}

/** Triagem: classifica prioridade, tipo e sentimento + resumo de 1 frase. */
export async function aiTriage(ticketId: number) {
  const t = await loadThread(ticketId)
  if (!t) throw new Error('Chamado não encontrado')
  const system = 'Você é um classificador de chamados de suporte ao cliente. Responda APENAS com um objeto JSON válido, sem texto extra, sem code fences.'
  const user = `Classifique o chamado abaixo.\n\nAssunto: ${t.subject}\n\nConversa:\n${t.text || '(sem mensagens)'}\n\nResponda no formato exato:\n{"priority":"low|normal|high|urgent","type":"question|incident|problem|task","sentiment":"positivo|neutro|negativo","summary":"resumo em uma frase"}`
  const raw = await chatWithAI(system, [{ role: 'user', content: user }])
  const j = extractJson(raw) || {}
  const priority = TICKET_PRIORITIES.includes(j.priority) ? j.priority : 'normal'
  const type = TICKET_TYPES.includes(j.type) ? j.type : 'question'
  const sentiment = ['positivo', 'neutro', 'negativo'].includes(j.sentiment) ? j.sentiment : 'neutro'
  return { priority, type, sentiment, summary: String(j.summary || '').slice(0, 300) }
}

/** Sugere uma resposta cordial ao solicitante, usando a conversa + artigos da KB. */
export async function aiSuggestReply(ticketId: number) {
  const t = await loadThread(ticketId)
  if (!t) throw new Error('Chamado não encontrado')
  // Deflection: artigos relacionados como contexto.
  const term = t.subject
  const kb = await prisma.kbArticle.findMany({
    where: { status: 'published', OR: [{ title: { contains: term } }, { keywords: { contains: term } }] },
    take: 3, select: { title: true, excerpt: true },
  }).catch(() => [])
  const kbText = kb.length ? `\n\nArtigos da base de conhecimento que podem ajudar:\n${kb.map((a) => `- ${a.title}: ${a.excerpt || ''}`).join('\n')}` : ''
  const system = 'Você é um agente de suporte ao cliente experiente. Escreva uma resposta cordial, objetiva e em português do Brasil para o SOLICITANTE, com base na conversa. Não invente informações nem prometa prazos. Não inclua saudações genéricas excessivas. Retorne apenas o texto da resposta.'
  const user = `Assunto: ${t.subject}\nSolicitante: ${t.requesterName || 'cliente'}\n\nConversa até agora:\n${t.text || '(sem mensagens)'}${kbText}\n\nEscreva a próxima resposta do agente ao solicitante.`
  const reply = await chatWithAI(system, [{ role: 'user', content: user }])
  return { reply: reply.trim() }
}

/**
 * QA automático (F19): audita a qualidade do atendimento do AGENTE no chamado.
 * Mesmo provider de IA dos demais recursos (`chatWithAI`).
 */
export async function aiQaTicket(ticketId: number): Promise<{ score: number | null; tone: string | null; strengths: string[]; weaknesses: string[]; summary: string }> {
  const t = await loadThread(ticketId)
  if (!t) throw new Error('Chamado não encontrado')
  const system = 'Você é um auditor sênior de qualidade de atendimento ao cliente. Avalie o desempenho do AGENTE no chamado abaixo (clareza, cordialidade, resolução, aderência). Responda APENAS com JSON válido: {"score": <0-100>, "tone": "cordial|neutro|frio|agressivo|inconsistente", "strengths": ["..."], "weaknesses": ["..."], "summary": "1-2 frases"}.'
  const user = `Assunto: ${t.subject}\n\nConversa (agente × solicitante):\n${t.text || '(sem mensagens)'}`
  const raw = await chatWithAI(system, [{ role: 'user', content: user }])
  const j = extractJson(raw) || {}
  const score = typeof j.score === 'number' ? Math.max(0, Math.min(100, Math.round(j.score))) : null
  const tone = ['cordial', 'neutro', 'frio', 'agressivo', 'inconsistente'].includes(j.tone) ? j.tone : null
  const arr = (v: any) => Array.isArray(v) ? v.map((x) => String(x).slice(0, 200)).slice(0, 6) : []
  return { score, tone, strengths: arr(j.strengths), weaknesses: arr(j.weaknesses), summary: String(j.summary || '').slice(0, 400) }
}

function stripHtml(s: string): string {
  return (s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Answer-bot generativo (F17): responde à pergunta do cliente APENAS com base
 * nos artigos publicados da KB. Reusa `chatWithAI`. Retorna a resposta, os
 * artigos citados e `answered` (false quando a KB não cobre).
 */
export async function aiAnswerFromKb(question: string): Promise<{ answer: string; articles: Array<{ title: string; slug: string }>; answered: boolean }> {
  const term = (question || '').trim()
  if (term.length < 3) return { answer: '', articles: [], answered: false }
  const words = Array.from(new Set(term.toLowerCase().split(/\s+/).filter((w) => w.length >= 3)))
  const or = (words.length ? words : [term]).flatMap((w) => [{ title: { contains: w } }, { keywords: { contains: w } }, { excerpt: { contains: w } }])
  const articles = await prisma.kbArticle.findMany({
    where: { status: 'published', visibility: 'public', OR: or },
    orderBy: { viewCount: 'desc' }, take: 4,
    select: { title: true, slug: true, body: true },
  })
  if (!articles.length) return { answer: '', articles: [], answered: false }
  const context = articles.map((a) => `# ${a.title}\n${stripHtml(a.body).slice(0, 1500)}`).join('\n\n')
  const system = 'Você é um assistente de suporte ao cliente. Responda à pergunta APENAS com base nos artigos fornecidos, em português do Brasil, de forma objetiva e cordial. Se os artigos NÃO cobrirem a pergunta, responda exatamente a palavra NAO_ENCONTRADO e nada mais.'
  const user = `Artigos da base de conhecimento:\n${context}\n\nPergunta do cliente: ${question}\n\nResposta:`
  const raw = (await chatWithAI(system, [{ role: 'user', content: user }])).trim()
  const answered = !/NAO_ENCONTRADO/i.test(raw)
  return { answer: answered ? raw : '', articles: articles.map((a) => ({ title: a.title, slug: a.slug })), answered }
}

/** Sugere a macro mais adequada ao chamado (entre as ativas do catálogo). */
export async function aiSuggestMacro(ticketId: number): Promise<{ macroId: number | null; name: string | null; reason: string }> {
  const t = await loadThread(ticketId)
  if (!t) throw new Error('Chamado não encontrado')
  const macros = await prisma.helpdeskMacro.findMany({ where: { active: true }, select: { id: true, name: true, replyTemplate: true } })
  if (!macros.length) return { macroId: null, name: null, reason: 'Nenhuma macro cadastrada' }
  const list = macros.map((m) => `${m.id}: ${m.name}${m.replyTemplate ? ` — ${m.replyTemplate.slice(0, 80)}` : ''}`).join('\n')
  const system = 'Você escolhe a macro mais adequada para um chamado de suporte. Responda APENAS com JSON {"macroId": <id ou null>, "reason": "motivo curto"}.'
  const user = `Macros disponíveis (id: nome):\n${list}\n\nChamado:\nAssunto: ${t.subject}\nConversa:\n${t.text || '(sem mensagens)'}\n\nQual macro aplicar?`
  const raw = await chatWithAI(system, [{ role: 'user', content: user }])
  const j = extractJson(raw) || {}
  const macroId = macros.some((m) => m.id === Number(j.macroId)) ? Number(j.macroId) : null
  return { macroId, name: macroId ? macros.find((m) => m.id === macroId)!.name : null, reason: String(j.reason || '').slice(0, 200) }
}

/** Reescreve/traduz um rascunho de resposta. mode: formal|friendly|concise|expand|translate:<idioma>. */
export async function aiRewrite(text: string, mode: string): Promise<{ text: string }> {
  const body = (text || '').trim()
  if (!body) return { text: '' }
  let system: string
  if (mode?.startsWith('translate:')) {
    const lang = mode.slice('translate:'.length) || 'inglês'
    system = `Traduza o texto a seguir para ${lang}, mantendo o tom e o sentido. Retorne apenas o texto traduzido, sem comentários.`
  } else {
    const tones: Record<string, string> = {
      formal: 'em tom formal e profissional',
      friendly: 'em tom cordial e amigável',
      concise: 'de forma mais concisa e objetiva',
      expand: 'com mais detalhes e cordialidade',
    }
    system = `Reescreva o texto a seguir ${tones[mode] || tones.friendly}, em português do Brasil, mantendo o sentido. Retorne apenas o texto reescrito, sem comentários.`
  }
  const out = await chatWithAI(system, [{ role: 'user', content: body }])
  return { text: out.trim() }
}

/** Resume o chamado em até 3 frases para handoff. */
export async function aiSummarize(ticketId: number) {
  const t = await loadThread(ticketId)
  if (!t) throw new Error('Chamado não encontrado')
  const system = 'Você resume chamados de suporte para repasse entre agentes. Responda em português do Brasil, em até 3 frases curtas, factual.'
  const user = `Assunto: ${t.subject}\n\nConversa:\n${t.text || '(sem mensagens)'}\n\nResuma o estado atual do chamado.`
  const summary = await chatWithAI(system, [{ role: 'user', content: user }])
  return { summary: summary.trim() }
}
