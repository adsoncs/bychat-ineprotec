// src/services/surveys.ts
//
// Motor de Pesquisas / NPS. Diferente do CSAT (nota única ao fim de um atendimento,
// ver scriptedSupportFlow), aqui a pesquisa tem várias perguntas, é DISPARADA por
// iniciativa da empresa e tem relatório próprio.
//
// Entrega por WhatsApp Flow nativo: o convite leva um flow_token único por
// destinatário; quando a pessoa conclui o formulário, o webhook devolve esse token
// dentro do response_json e é ele que liga a resposta à sessão (a Meta NÃO manda o
// id do Flow de volta). Por isso a sessão é criada ANTES do envio.
//
// A pesquisa NÃO grava em lead.formData nem nos campos personalizados — as respostas
// vivem em SurveyResponse. Só a nota vira evento e tag, para o time agir sobre um
// detrator sem precisar abrir o relatório.

import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { logEvent } from './leadHistory.js'
import { resolveLeadForContact } from './contactIdentity.js'
import { decryptToken, normalizePhone, sendTemplateMessage, sendInteractiveMessage } from './cloudApi.js'
import { buildFlowJson, buildFlowSendPayload, createAndPublishFlow, ingestFlowResponse } from './whatsappFlows.js'

// Faixas canônicas do NPS. Detrator vai até 6 — é a definição do índice, não um
// limiar configurável.
export type NpsCategory = 'promoter' | 'passive' | 'detractor'
export function npsCategoryFor(score: number): NpsCategory {
  if (score >= 9) return 'promoter'
  if (score >= 7) return 'passive'
  return 'detractor'
}

/** As perguntas da pesquisa no shape de `fields` de um Form — é o que os geradores
 *  de Flow e o runner scripted já sabem ler. */
export function surveyAsForm(survey: any): { id: number; name: string; fields: any[] } {
  return { id: 0, name: survey.name, fields: Array.isArray(survey.questions) ? survey.questions : [] }
}

/** Chave da pergunta que calcula o NPS: a explícita, senão a primeira marcada. */
export function resolveNpsKey(survey: any): string | null {
  const explicit = String(survey?.npsQuestionKey || '').trim()
  if (explicit) return explicit
  const qs: any[] = Array.isArray(survey?.questions) ? survey.questions : []
  return qs.find((q) => q?.isNps)?.key ?? null
}

const DEFAULT_MESSAGES: Record<string, string> = {
  intro: 'Sua opinião é muito importante para nós. Leva menos de 3 minutos.',
  cta: 'Responder pesquisa',
  thanks: 'Obrigado por participar! 💚\n\nSua resposta foi registrada — cada opinião nos ajuda a melhorar os próximos encontros.',
  alreadyAnswered: 'Já recebemos a sua resposta desta pesquisa. Obrigado pela participação! 💚',
}
export function surveyMsg(survey: any, key: string): string {
  const over = (survey?.messages as Record<string, string> | null) || {}
  return (over[key] && String(over[key]).trim()) || DEFAULT_MESSAGES[key] || ''
}

// ─── Publicação do Flow ───────────────────────────────────────────────────────

/** Gera o Flow multi-tela da pesquisa e publica na Meta. Idempotente: republica no
 *  mesmo Flow quando já existe um. */
export async function publishSurveyFlow(surveyId: number, connectionId: number): Promise<{ metaFlowId: string; screenId: string; flowRowId: number }> {
  const survey = await prisma.survey.findUnique({ where: { id: surveyId } })
  if (!survey) throw new Error('Pesquisa não encontrada')
  const conn = await prisma.cloudApiConnection.findUnique({ where: { id: connectionId } })
  if (!conn?.active) throw new Error('Conexão Cloud API inativa ou inexistente')

  const form = surveyAsForm(survey)
  if (!form.fields.length) throw new Error('A pesquisa não tem perguntas')

  const { json, screenId } = buildFlowJson(form, {
    multiScreen: true,
    title: survey.name,
    cta: surveyMsg(survey, 'submitLabel') || 'Enviar respostas',
    navLabel: 'Continuar',
  })

  // formId fica NULO de propósito: o editor de Flows do painel busca por formId e
  // republicaria este Flow em versão de tela única, achatando a pesquisa.
  const existing = survey.flowId ? await prisma.cloudApiFlow.findUnique({ where: { id: survey.flowId } }) : null
  const { metaFlowId } = await createAndPublishFlow(conn, `Pesquisa · ${survey.name}`, json, existing?.metaFlowId ?? null)

  const row = existing
    ? await prisma.cloudApiFlow.update({ where: { id: existing.id }, data: { flowJson: json, screenId, metaFlowId, status: 'published', lastError: null } })
    : await prisma.cloudApiFlow.create({ data: {
        connectionId, formId: null, name: `Pesquisa · ${survey.name}`,
        flowJson: json, screenId, metaFlowId, status: 'published',
      } })

  if (survey.flowId !== row.id) await prisma.survey.update({ where: { id: surveyId }, data: { flowId: row.id } })
  return { metaFlowId, screenId, flowRowId: row.id }
}

// ─── Disparo ──────────────────────────────────────────────────────────────────

export interface DispatchTarget { phone: string; nome?: string | null }
export interface DispatchResult { sent: number; skipped: number; failed: number; errors: string[] }

/** Uma sessão aberta por destinatário. O flowToken é o que casa a resposta de volta. */
async function openSession(surveyId: number, phone: string, leadId: number | null, expiresAfterHours: number) {
  return prisma.surveySession.create({ data: {
    surveyId, phone, leadId,
    flowToken: randomUUID(),
    expiresAt: new Date(Date.now() + expiresAfterHours * 3600_000),
  } })
}

/**
 * Dispara a pesquisa. `templateName` envia o convite como template aprovado (com
 * botão FLOW) — obrigatório fora da janela de 24h, que é o caso normal de uma
 * pesquisa pós-evento. Sem template, manda a mensagem interativa de Flow direto,
 * o que só funciona para quem falou com a empresa nas últimas 24h.
 */
export async function dispatchSurvey(
  surveyId: number,
  targets: DispatchTarget[],
  opts: { templateName?: string | null; templateLanguage?: string; buttonIndex?: number; app?: FastifyInstance },
): Promise<DispatchResult> {
  const survey = await prisma.survey.findUnique({ where: { id: surveyId } })
  if (!survey) throw new Error('Pesquisa não encontrada')
  if (!survey.active) throw new Error('Pesquisa inativa')
  if (!survey.flowId) throw new Error('Publique o Flow da pesquisa antes de disparar')

  const flowRow = await prisma.cloudApiFlow.findUnique({ where: { id: survey.flowId } })
  if (!flowRow?.metaFlowId) throw new Error('Flow da pesquisa não está publicado')
  const conn = await prisma.cloudApiConnection.findUnique({ where: { id: flowRow.connectionId } })
  if (!conn?.active) throw new Error('Conexão Cloud API inativa')
  const token = decryptToken(conn.systemUserToken)

  const res: DispatchResult = { sent: 0, skipped: 0, failed: 0, errors: [] }
  const optedOut = await optedOutSet()
  const seen = new Set<string>()

  for (const t of targets) {
    const phone = normalizePhone(t.phone || '')
    if (!phone || phone.length < 10) { res.skipped++; continue }
    if (seen.has(phone)) { res.skipped++; continue } // mesma pessoa duas vezes na lista
    seen.add(phone)
    if (optedOut.has(phone.slice(-8))) { res.skipped++; continue }

    // Já respondeu ou já tem convite em aberto → não insiste.
    const already = await prisma.surveySession.findFirst({
      where: { surveyId, phone, status: { in: ['pending', 'answered'] } },
      select: { id: true },
    })
    if (already) { res.skipped++; continue }

    const resolved = await resolveLeadForContact({ phone, pushName: t.nome ?? null }).catch(() => null)
    const leadId = resolved?.lead?.id ?? null
    const session = await openSession(surveyId, phone, leadId, survey.expiresAfterHours)

    try {
      if (opts.templateName) {
        // Botão FLOW do template: o flow_token vai como parâmetro de ação, um por
        // destinatário — é assim que a resposta volta identificada.
        await sendTemplateMessage(conn.phoneNumberId, token, phone, opts.templateName, opts.templateLanguage || 'pt_BR', [{
          type: 'button', sub_type: 'flow', index: String(opts.buttonIndex ?? 0),
          parameters: [{ type: 'action', action: { flow_token: session.flowToken } }],
        }])
      } else {
        await sendInteractiveMessage(conn.phoneNumberId, token, phone, buildFlowSendPayload(
          flowRow.metaFlowId, flowRow.screenId,
          { bodyText: surveyMsg(survey, 'intro'), cta: surveyMsg(survey, 'cta'), flowToken: session.flowToken! },
        ))
      }
      res.sent++
      if (leadId) {
        logEvent({
          leadId, type: 'survey_sent' as any, category: 'system',
          title: `Pesquisa enviada: ${survey.name}`, channel: 'whatsapp', source: 'survey', actorType: 'system',
          metadata: { surveyId, sessionId: session.id },
        })
      }
    } catch (e: any) {
      res.failed++
      const m = String(e?.message || e).slice(0, 200)
      if (res.errors.length < 10) res.errors.push(`${phone}: ${m}`)
      await prisma.surveySession.update({ where: { id: session.id }, data: { status: 'expired' } }).catch(() => {})
      opts.app?.log.warn(`[surveys] falha ao enviar para ${phone}: ${m}`)
    }
  }
  return res
}

// Espelha optedOutPhones do broadcast: quem pediu para não receber não recebe
// pesquisa também.
async function optedOutSet(): Promise<Set<string>> {
  const out = new Set<string>()
  const leads = await prisma.lead.findMany({
    where: { optOutChannels: { not: null as any } },
    select: { whatsapp: true, optOutChannels: true },
  })
  for (const l of leads) {
    const ch = Array.isArray(l.optOutChannels) ? (l.optOutChannels as string[]) : []
    if (ch.includes('whatsapp') && l.whatsapp) out.add(normalizePhone(l.whatsapp).slice(-8))
  }
  return out
}

// ─── Recebimento da resposta ──────────────────────────────────────────────────

/**
 * Trata o nfm_reply de uma pesquisa. Chamado pelo webhook ANTES do chatbot: sem
 * isto, a resposta chegaria sem estado de roteiro e o motor de atendimento a
 * descartaria, iniciando o menu de setores no lugar.
 * Retorna true quando a mensagem era de uma pesquisa (o webhook deve parar aí).
 */
export async function tryHandleSurveyFlowReply(
  phone: string,
  flowResponse: Record<string, any> | null,
  ctx: { app?: FastifyInstance; sendText?: (phone: string, text: string) => Promise<any> },
): Promise<boolean> {
  const flowToken = flowResponse ? String(flowResponse.flow_token || '').trim() : ''
  if (!flowToken) return false

  const session = await prisma.surveySession.findUnique({ where: { flowToken } })
  if (!session) return false // Flow de outro fluxo (intake do chatbot) — não é nosso

  const survey = await prisma.survey.findUnique({ where: { id: session.surveyId } })
  if (!survey) return true

  if (session.status === 'answered') {
    // Reenvio da mesma resposta (retry da Meta ou toque duplo): não duplica.
    if (ctx.sendText) await ctx.sendText(phone, surveyMsg(survey, 'alreadyAnswered')).catch(() => {})
    return true
  }

  const answers = ingestFlowResponse(surveyAsForm(survey), flowResponse || {})
  const npsKey = resolveNpsKey(survey)
  const rawScore = npsKey ? Number(answers[npsKey]) : NaN
  const npsScore = Number.isInteger(rawScore) && rawScore >= 0 && rawScore <= 10 ? rawScore : null

  const leadId = session.leadId ?? (await resolveLeadForContact({ phone }).catch(() => null))?.lead?.id ?? null

  await prisma.surveyResponse.create({ data: {
    surveyId: survey.id, leadId, phone: session.phone, answers,
    npsScore, npsCategory: npsScore == null ? null : npsCategoryFor(npsScore),
    channel: 'whatsapp_flow',
  } })
  await prisma.surveySession.update({ where: { id: session.id }, data: { status: 'answered', respondedAt: new Date(), leadId } })

  if (leadId) {
    const cat = npsScore == null ? null : npsCategoryFor(npsScore)
    logEvent({
      leadId, type: (cat === 'detractor' ? 'survey_detractor' : 'survey_answered') as any, category: 'system',
      title: npsScore == null ? `Pesquisa respondida: ${survey.name}` : `Pesquisa respondida: NPS ${npsScore}/10`,
      channel: 'whatsapp', source: 'survey', actorType: 'lead',
      metadata: { surveyId: survey.id, npsScore, npsCategory: cat },
    })
    if (cat === 'detractor') await tagLead(leadId, 'Detrator').catch(() => {})
  }

  if (ctx.sendText) await ctx.sendText(phone, surveyMsg(survey, 'thanks')).catch(() => {})
  ctx.app?.log.info(`[surveys] resposta registrada: pesquisa ${survey.id}, ${phone}, NPS ${npsScore ?? '-'}`)
  return true
}

/** Marca com uma tag (cria a tag se ainda não existir). */
async function tagLead(leadId: number, name: string): Promise<void> {
  const tag = await prisma.tag.upsert({
    where: { name },
    update: {},
    create: { name, color: '#ef4444', description: 'Respondeu 0–6 numa pesquisa de NPS' },
  })
  await prisma.leadTag.upsert({
    where: { leadId_tagId: { leadId, tagId: tag.id } },
    update: {},
    create: { leadId, tagId: tag.id },
  })
}

// ─── Apuração ─────────────────────────────────────────────────────────────────

/**
 * Números da pesquisa. O NPS é %promotores − %detratores sobre quem respondeu A
 * PERGUNTA DE NPS — não sobre o total de respostas, e não é média de notas. Fica
 * num lugar só para nenhuma tela inventar a sua própria conta.
 */
export async function computeSurveyResults(surveyId: number) {
  const survey = await prisma.survey.findUnique({ where: { id: surveyId } })
  if (!survey) return null

  const [responses, sessions] = await Promise.all([
    prisma.surveyResponse.findMany({ where: { surveyId }, orderBy: { respondedAt: 'desc' } }),
    prisma.surveySession.groupBy({ by: ['status'], where: { surveyId }, _count: true }),
  ])

  const leadIds = [...new Set(responses.map((r) => r.leadId).filter((x): x is number => x != null))]
  const leads = leadIds.length
    ? await prisma.lead.findMany({ where: { id: { in: leadIds } }, select: { id: true, nome: true } })
    : []
  const leadName = new Map(leads.map((l) => [l.id, l.nome]))

  const questions: any[] = Array.isArray(survey.questions) ? (survey.questions as any[]) : []
  const npsKey = resolveNpsKey(survey)

  const scored = responses.filter((r) => r.npsScore != null)
  const promoters = scored.filter((r) => r.npsCategory === 'promoter').length
  const passives = scored.filter((r) => r.npsCategory === 'passive').length
  const detractors = scored.filter((r) => r.npsCategory === 'detractor').length
  const nps = scored.length ? Math.round(((promoters - detractors) / scored.length) * 100) : null

  const distribution = Array.from({ length: 11 }, (_, n) => ({
    score: n, count: scored.filter((r) => r.npsScore === n).length,
  }))

  // Média e distribuição de cada pergunta de nota.
  const byQuestion = questions.filter((q) => q.type === 'scale').map((q) => {
    const vals = responses.map((r) => Number((r.answers as any)?.[q.key])).filter((v) => Number.isFinite(v))
    const avg = vals.length ? Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2)) : null
    const counts: Record<string, number> = {}
    for (const v of vals) counts[String(v)] = (counts[String(v)] || 0) + 1
    return {
      key: q.key, label: q.label, isNps: q.key === npsKey,
      scaleMin: q.scaleMin ?? 1, scaleMax: q.scaleMax ?? 5,
      answered: vals.length, avg, counts,
    }
  })

  // Respostas abertas, com quem escreveu e a nota que deu — é onde o detrator
  // explica o porquê, e ler isso separado da nota perde o sentido.
  const openKeys = questions.filter((q) => q.type === 'textarea' || q.type === 'text').map((q) => q.key)
  const comments = responses.flatMap((r) => openKeys
    .map((k) => ({ key: k, text: String((r.answers as any)?.[k] ?? '').trim() }))
    .filter((c) => c.text)
    .map((c) => ({
      ...c, responseId: r.id, leadId: r.leadId,
      nome: r.leadId ? (leadName.get(r.leadId) ?? null) : null,
      npsScore: r.npsScore, npsCategory: r.npsCategory, respondedAt: r.respondedAt,
    })))

  const invites = Object.fromEntries(sessions.map((s) => [s.status, s._count])) as Record<string, number>
  const sent = (invites.pending ?? 0) + (invites.answered ?? 0) + (invites.expired ?? 0)

  return {
    survey: { id: survey.id, name: survey.name, description: survey.description, npsQuestionKey: npsKey },
    totals: {
      responses: responses.length,
      invites: sent,
      responseRate: sent ? Math.round((responses.length / sent) * 100) : null,
      pending: invites.pending ?? 0,
      expired: invites.expired ?? 0,
    },
    nps: { score: nps, promoters, passives, detractors, answered: scored.length, distribution },
    byQuestion,
    comments,
  }
}

/** Fecha convites que passaram da janela. Chamado pelo worker periódico. */
export async function expireSurveySessions(): Promise<number> {
  const r = await prisma.surveySession.updateMany({
    where: { status: 'pending', expiresAt: { lt: new Date() } },
    data: { status: 'expired' },
  })
  return r.count
}
