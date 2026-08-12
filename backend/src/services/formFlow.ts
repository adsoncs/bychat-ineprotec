// src/services/formFlow.ts
//
// Lógica pura/compartilhada do pipeline formulário→lead: qualificação ("negativo
// vence"), criação de lead, movimentação de etapa, tracking e validação de campo.
//
// Extraído de routes/forms.ts para que TANTO a rota de formulário (/submit,
// /progress) QUANTO o runner de chatbot determinístico no WhatsApp
// (scriptedChatbotFlow.ts) chamem EXATAMENTE o mesmo código — garantindo que as
// condicionais de qualificação e as etapas do funil sejam idênticas nos dois canais.

import { prisma } from '../lib/prisma.js'
import { logEvent, EVENT_TYPES } from '../services/leadHistory.js'
import { generateUid, flagDuplicate } from '../services/dedup.js'
import { pickOperatorForTeam, resolveRoutingFromContext } from '../services/teamRouting.js'
import type { RoutingContext } from '../services/routing/policyEngine.js'
import { deriveLeadOrigin } from '../lib/leadOrigin.js'

// ── Campos personalizados ─────────────────────────────────────────────────────
// Mapeia respostas do form → valores de campos personalizados (lead.customFields).
// Regras: mapTo "cf_x" → x; field.key que casa com um CustomField ativo (sem mapTo);
// ou mapTo que casa com um CustomField ativo. Usado na criação e na finalização.
export async function buildCustomFieldValues(fields: any[], data: any): Promise<Record<string, any>> {
  const defs = await prisma.customField.findMany({ where: { active: true }, select: { key: true } })
  const cfKeys = new Set(defs.map((cf) => cf.key))
  const out: Record<string, any> = {}
  for (const field of fields) {
    const v = data[field.key]
    if (v === undefined || v === null || v === '') continue
    if (field.mapTo?.startsWith('cf_')) out[field.mapTo.replace('cf_', '')] = v
    else if (cfKeys.has(field.key) && !field.mapTo) out[field.key] = v
    else if (field.mapTo && cfKeys.has(field.mapTo)) out[field.mapTo] = v
  }
  return out
}

// ── Tracking (UTMs / click-ids) ───────────────────────────────────────────────
// Parâmetros de campanha com coluna dedicada no lead → nome do parâmetro na URL.
type TrackKey =
  | 'utmSource' | 'utmMedium' | 'utmCampaign' | 'utmContent' | 'utmTerm' | 'utmId' | 'fbclid' | 'gclid'
  // Google Ads ValueTrack (o cliente configura o tracking template com estes params na URL final).
  | 'googleCampaignId' | 'googleAdGroupId' | 'googleAdId' | 'googleKeyword' | 'googleMatchType' | 'googleNetwork' | 'googleDevice'
const TRACK_PARAM: Record<TrackKey, string> = {
  utmSource: 'utm_source', utmMedium: 'utm_medium', utmCampaign: 'utm_campaign',
  utmContent: 'utm_content', utmTerm: 'utm_term', utmId: 'utm_id', fbclid: 'fbclid', gclid: 'gclid',
  googleCampaignId: 'gad_campaignid', googleAdGroupId: 'gad_adgroupid', googleAdId: 'gad_creative',
  googleKeyword: 'gad_keyword', googleMatchType: 'gad_matchtype', googleNetwork: 'gad_network', googleDevice: 'gad_device',
}
const TRACK_KEYS = Object.keys(TRACK_PARAM) as TrackKey[]
// Limite de cada coluna (VarChar) — trunca por segurança.
const TRACK_MAXLEN: Partial<Record<TrackKey, number>> = {
  utmSource: 100, utmMedium: 100, fbclid: 255,
  googleCampaignId: 191, googleAdGroupId: 191, googleAdId: 191,
  googleKeyword: 255, googleMatchType: 30, googleNetwork: 30, googleDevice: 30,
}

// Rede de segurança: quando o formulário não recebe todos os parâmetros na própria
// URL (mas o visitante foi rastreado), herda da URL de entrada gravada no tracking.
async function trackingParamsFromVisitor(visitorHash: string): Promise<Partial<Record<TrackKey, string>> | null> {
  try {
    const v = await prisma.trackingVisitor.findUnique({ where: { visitorId: visitorHash }, select: { id: true } })
    if (!v) return null
    const ev = await prisma.trackingEvent.findFirst({
      where: { visitorId: v.id, url: { contains: 'utm_' } },
      orderBy: { id: 'asc' }, select: { url: true },
    })
    if (!ev?.url) return null
    const sp = new URL(ev.url).searchParams
    const out: Partial<Record<TrackKey, string>> = {}
    for (const col of TRACK_KEYS) { const val = sp.get(TRACK_PARAM[col]); if (val) out[col] = val }
    return out
  } catch { return null }
}

// Resolve os parâmetros de campanha priorizando o envio e completando o que faltar
// pelo tracking (só consulta o tracking se algo faltar e houver visitorId).
export async function resolveTracking(body: any): Promise<Record<TrackKey, string | null>> {
  const out = {} as Record<TrackKey, string | null>
  for (const k of TRACK_KEYS) out[k] = body[k] || null
  if (body.bt_vid && TRACK_KEYS.some((k) => !out[k])) {
    const t = await trackingParamsFromVisitor(String(body.bt_vid))
    if (t) for (const k of TRACK_KEYS) if (!out[k] && t[k]) out[k] = t[k]!
  }
  for (const k of TRACK_KEYS) { const max = TRACK_MAXLEN[k]; if (max && out[k]) out[k] = out[k]!.slice(0, max) }
  return out
}

// ── Criação de lead a partir do formulário ────────────────────────────────────
// Reaproveitado pelo /submit, pela captura parcial (/progress) e pelo runner de
// chatbot no WhatsApp. stageOverride permite criar já na etapa inicial específica.
// NÃO notifica nem dispara conversão — isso fica a cargo do chamador.
//
// `ctx` adapta o canal sem duplicar a lógica: quando ausente → comportamento web
// idêntico ao original; quando preenchido (WhatsApp) → troca source/origin/canal
// e injeta o telefone do inbound (o lead nasce antes do campo `whatsapp` chegar).
export interface CreateLeadCtx {
  channel?: 'web_form' | 'scheduling' | 'whatsapp'
  leadSource?: string // override de Lead.source
  qualificationSource?: string // override de Lead.qualificationSource
  routing?: RoutingContext
  chatbotId?: number | null
  forceWhatsapp?: string // injeta o telefone do inbound (WhatsApp)
}

export async function createLeadFromForm(
  form: any, fields: any[], data: any, body: any, ip: string,
  submissionId: number | null,
  stageOverride?: { funnelId: number | null; stageKey: string | null },
  ctx?: CreateLeadCtx,
): Promise<{ leadId: number; targetStageKey: string; mapped: Record<string, string>; newLead: any } | null> {
  const mapped: Record<string, string> = {}
  for (const field of fields) if (field.mapTo && data[field.key]) mapped[field.mapTo] = String(data[field.key])

  const customFieldValues = await buildCustomFieldValues(fields, data)
  const trk = await resolveTracking(body)

  // Form com etapa de agendamento → a origem do lead é "agendamento", não
  // landing page. No WhatsApp o canal vence (ctx.leadSource = 'whatsapp').
  const isSchedulingForm = fields.some((f: any) => f?.type === 'scheduling')
  const leadSource = ctx?.leadSource ?? (isSchedulingForm ? 'scheduling' : 'landing_page')
  const isWhats = ctx?.channel === 'whatsapp'

  const nome = mapped.nome || mapped.name || ''
  const email = mapped.email || ''
  const whatsapp = ctx?.forceWhatsapp || mapped.whatsapp || mapped.phone || mapped.telefone || ''
  const empresa = mapped.empresa || mapped.company || ''
  if (!(nome || email || whatsapp)) return null

  let targetFunnelId = stageOverride?.funnelId ?? form.funnelId ?? null
  let targetStageKey = stageOverride?.stageKey ?? form.stageKey ?? 'NOVO'
  if (!targetFunnelId) {
    const df = await prisma.funnel.findFirst({ where: { isDefault: true, active: true } })
    if (df) targetFunnelId = df.id
  }
  if (targetFunnelId) {
    const se = await prisma.stage.findFirst({ where: { funnelId: targetFunnelId, key: targetStageKey, active: true } })
    if (!se) {
      const fs = await prisma.stage.findFirst({ where: { funnelId: targetFunnelId, active: true }, orderBy: { position: 'asc' } })
      if (fs) targetStageKey = fs.key
    }
  }

  let routedTeamId: number | null = form.defaultTeamId ?? null
  let routedUserId: number | null = null
  let routedRuleId: number | null = null
  if (routedTeamId) routedUserId = await pickOperatorForTeam(routedTeamId)
  else {
    const d = ctx?.routing
      ? await resolveRoutingFromContext(ctx.routing)
      : await resolveRoutingFromContext({ source: 'form', formId: form.id, utmSource: trk.utmSource, utmMedium: trk.utmMedium, utmCampaign: trk.utmCampaign })
    routedTeamId = d.teamId; routedUserId = d.userId; routedRuleId = d.ruleId
  }

  const originType = isWhats
    ? ((body?.originType as any) || deriveLeadOrigin({ source: 'whatsapp', channel: 'whatsapp', utmSource: trk.utmSource, gclid: trk.gclid, ctwaClid: body?.ctwaClid || null, trackableLinkId: null }))
    : deriveLeadOrigin({ source: leadSource, qualificationSource: isSchedulingForm ? 'scheduling' : 'form', utmSource: trk.utmSource, gclid: trk.gclid, ctwaClid: body.ctwaClid || null, trackableLinkId: null })

  const newLead = await prisma.lead.create({
    data: {
      uid: await generateUid(),
      nome: nome || 'Lead LP', email: email || '', whatsapp: whatsapp || '', empresa: empresa || '',
      // O contato se apresentou no formulário: nome mais forte que a agenda do
      // WhatsApp e que o pushName (ver services/leadDisplayName.ts).
      nomeOrigem: 'formulario',
      segmento: mapped.segmento || null, cidade: mapped.cidade || null,
      // _formId: lembra o formulário de origem (usado p/ filtrar notificações no
      // agendamento — ex.: avisar operador só de leads do form X que agendaram).
      formData: { ...data, _formId: form.id }, scores: {}, lastStep: 0, completed: false,
      status: targetStageKey, funnelId: targetFunnelId, teamId: routedTeamId,
      assignedUserId: routedUserId, assignedAt: routedUserId ? new Date() : null,
      source: leadSource,
      originType,
      ...(ctx?.chatbotId ? { chatbotId: ctx.chatbotId } : {}),
      trackingVisitorId: body.bt_vid || null,
      utmSource: trk.utmSource, utmMedium: trk.utmMedium, utmCampaign: trk.utmCampaign,
      utmContent: trk.utmContent, utmTerm: trk.utmTerm, utmId: trk.utmId,
      ...(trk.gclid ? { gclid: String(trk.gclid).slice(0, 191) } : {}),
      ...(trk.fbclid ? { fbclid: trk.fbclid } : {}),
      ...(body.ctwaClid ? { ctwaClid: String(body.ctwaClid).slice(0, 191) } : {}),
      // Google Ads ValueTrack (IDs + keyword da URL). Os NOMES vêm depois no
      // enriquecimento por gclid. googleKeyword cai p/ utm_term quando o template
      // usa só utm_term={keyword}.
      ...(trk.googleCampaignId ? { googleCampaignId: trk.googleCampaignId } : {}),
      ...(trk.googleAdGroupId ? { googleAdGroupId: trk.googleAdGroupId } : {}),
      ...(trk.googleAdId ? { googleAdId: trk.googleAdId } : {}),
      ...((trk.googleKeyword || (originType === 'google_ads' && trk.utmTerm)) ? { googleKeyword: String(trk.googleKeyword || trk.utmTerm).slice(0, 255) } : {}),
      ...(trk.googleMatchType ? { googleMatchType: trk.googleMatchType } : {}),
      ...(trk.googleNetwork ? { googleNetwork: trk.googleNetwork } : {}),
      ...(trk.googleDevice ? { googleDevice: trk.googleDevice } : {}),
      customFields: Object.keys(customFieldValues).length > 0 ? customFieldValues : undefined,
      qualifiedAt: new Date(), qualificationSource: ctx?.qualificationSource ?? 'form',
    },
  })
  const leadId = newLead.id

  // Google Ads: enriquece campanha/grupo/keyword a partir do gclid (imediato; o
  // sweep periódico é a rede de segurança). Fire-and-forget para não atrasar a resposta.
  if (originType === 'google_ads' && trk.gclid) {
    import('./googleAdsClickEnrich.js')
      .then(m => m.enrichLeadFromGclid(leadId))
      .catch(() => {})
  }

  logEvent({
    leadId, type: EVENT_TYPES.LEAD_CREATED, category: 'lifecycle',
    title: `Lead criado via ${isWhats ? 'chatbot (WhatsApp)' : 'formulário'}: ${form.name}`,
    channel: isWhats ? 'whatsapp' : (isSchedulingForm ? 'scheduling' : 'web_form'), source: leadSource, actorType: 'lead',
    description: `Lead "${nome || email || whatsapp}" criado via ${isWhats ? 'chatbot WhatsApp' : 'formulário'} "${form.name}"${body.pageSlug ? ` na página /p/${body.pageSlug}` : (isWhats ? '' : ' (embed externo)')}`,
    metadata: { formId: form.id, formName: form.name, pageSlug: body.pageSlug, submissionId, submittedData: data, ...(ctx?.chatbotId ? { chatbotId: ctx.chatbotId } : {}) }, ipAddress: ip,
  })
  if (routedRuleId) {
    logEvent({ leadId, type: EVENT_TYPES.ROUTING_RULE_MATCHED, category: 'lifecycle', title: `Regra de roteamento aplicada (#${routedRuleId})`, actorType: 'system', metadata: { ruleId: routedRuleId, teamId: routedTeamId, userId: routedUserId } })
  }
  flagDuplicate({ newLeadId: leadId, channel: isWhats ? 'inbound_webhook' : 'forms' }).catch((e) => console.error('[formFlow] flagDuplicate error:', (e as any).message))
  if (body.bt_vid) {
    prisma.trackingVisitor.updateMany({ where: { visitorId: body.bt_vid }, data: { leadId, identifiedEmail: email || undefined, identifiedPhone: whatsapp || undefined, identifiedName: nome || undefined } }).catch(() => {})
  }
  return { leadId, targetStageKey, mapped, newLead }
}

// ── Movimentação de etapa ─────────────────────────────────────────────────────
// Retorna a etapa EFETIVA do lead após a operação. opts.forwardOnly evita
// regressão: quando o lead já está numa etapa mais avançada do MESMO funil, uma
// qualificação positiva não o puxa de volta. Desqualificações (finish) usam
// forwardOnly=false, então continuam podendo mover para qualquer etapa.
export async function moveLeadStage(leadId: number, funnelId: number | null, stageKey: string, source = 'form', opts?: { forwardOnly?: boolean }): Promise<string> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { funnelId: true, status: true } })
  if (!lead) return stageKey
  const toFunnel = funnelId ?? lead.funnelId
  if (lead.status === stageKey && lead.funnelId === toFunnel) return lead.status ?? stageKey
  if (toFunnel != null) {
    // Fail-safe: NUNCA gravar uma etapa que não existe no funil de destino. Uma
    // config de qualificação apontando para um stageKey de OUTRO funil (ex.: form
    // no funil 2 com qualifyPositive=QUALIFICACAO, que só existe no funil 5)
    // órfãnava o lead numa etapa inexistente E furava a proteção forwardOnly
    // (que exige achar as duas etapas p/ comparar posições) — regredindo um lead
    // que já tinha avançado (ex.: agendou → REUNIAO). Sem etapa válida, não mexe.
    const tgt = await prisma.stage.findFirst({ where: { funnelId: toFunnel, key: stageKey }, select: { position: true } })
    if (!tgt) {
      console.warn(`[moveLeadStage] etapa "${stageKey}" inexistente no funil ${toFunnel} (lead ${leadId}); movimentação ignorada`)
      return lead.status ?? stageKey
    }
    if (opts?.forwardOnly && lead.status && lead.funnelId === toFunnel) {
      const cur = await prisma.stage.findFirst({ where: { funnelId: toFunnel, key: lead.status }, select: { position: true } })
      if (cur && tgt.position <= cur.position) return lead.status // mantém a etapa mais avançada
    }
  }
  await prisma.lead.update({ where: { id: leadId }, data: { status: stageKey, funnelId: toFunnel } })
  await prisma.leadStageMovement.create({
    data: { leadId, fromFunnelId: lead.funnelId, toFunnelId: toFunnel, fromStageKey: lead.status ?? null, toStageKey: stageKey, source },
  }).catch(() => {})
  return stageKey
}

// ── Qualificação ("negativo vence") ───────────────────────────────────────────
// A PRIMEIRA pergunta qualificadora com resposta negativa E consequência
// configurada é decisiva (curto-circuita); se nenhuma for negativa, vale o ÚLTIMO
// resultado positivo com consequência. Cai no journey global quando a pergunta não
// tem config própria. Retorna o resultado decisivo ou null.
export interface QualifyResolved {
  funnelId: number | null
  stageKey: string | null
  finish: boolean
  finishAction: 'message' | 'redirect'
  redirectUrl: string | null
  message: string | null
}
export function normOutcome(o: any): QualifyResolved | null {
  if (!o || typeof o !== 'object') return null
  return {
    funnelId: o.funnelId ?? null,
    stageKey: o.stageKey ?? null,
    finish: !!o.finish,
    finishAction: o.finishAction === 'redirect' ? 'redirect' : 'message',
    redirectUrl: o.redirectUrl ?? null,
    message: typeof o.message === 'string' ? o.message : null,
  }
}
export function resolveQualification(fields: any[], answers: Record<string, any>, settings: any): QualifyResolved | null {
  const journey = settings?.journey || {}
  let lastPositive: QualifyResolved | null = null
  for (const f of fields) {
    if (!f || !f.isQualifier) continue
    const ans = answers[f.key]
    if (ans === undefined || ans === null || ans === '') continue // ainda não respondida
    const positives: string[] = Array.isArray(f.positiveValues) ? f.positiveValues : []
    const isPos = positives.length ? positives.includes(ans) : !!ans
    if (!isPos) {
      const neg = normOutcome(f.qualifyNegative) ?? normOutcome(journey.qualifyNegative)
      if (neg && (neg.stageKey || neg.finish)) return neg // negativo configurado vence
      // negativo sem consequência → ignora e segue procurando
    } else {
      const pos = normOutcome(f.qualifyPositive) ?? normOutcome(journey.qualifyPositive)
      if (pos && (pos.stageKey || pos.finish)) lastPositive = pos
    }
  }
  return lastPositive
}

// ── Validação de campo (espelho server-side do validador do embed) ────────────
// MESMAS regras/mensagens do widget conversacional (generateConversationalPage):
// statement/scheduling sempre válidos; required vazio; e-mail e telefone por regex.
// Garante que o chatbot aceite exatamente o que o formulário aceita.
export function validateFieldValue(field: any, value: string): string | null {
  if (!field || field.type === 'statement' || field.type === 'scheduling') return null
  const v = (value ?? '').trim()
  if (field.required && !v) return 'Campo obrigatório'
  if (v && field.type === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return 'E-mail inválido'
  if (v && field.type === 'phone' && v.replace(/\D/g, '').length < 8) return 'Telefone inválido'
  return null
}

// ── Parse de escolha de select no canal texto (WhatsApp) ──────────────────────
// Aceita o número (índice 1-based da lista) OU o texto casando value/label
// (case-insensitive, trim). Retorna sempre o `value` da opção — CRÍTICO: a
// qualificação compara answers[key] com positiveValues (que são `value`s).
export function matchSelectChoice(field: any, raw: string): { value: string; label: string } | null {
  const opts: Array<{ value: string; label: string }> = Array.isArray(field?.options) ? field.options : []
  if (!opts.length) return null
  const v = (raw ?? '').trim()
  if (!v) return null
  // número (1-based)
  if (/^\d+$/.test(v)) {
    const idx = parseInt(v, 10) - 1
    if (idx >= 0 && idx < opts.length) return { value: opts[idx]!.value, label: opts[idx]!.label }
  }
  const low = v.toLowerCase()
  const byValue = opts.find((o) => String(o.value).toLowerCase().trim() === low)
  if (byValue) return { value: byValue.value, label: byValue.label }
  const byLabel = opts.find((o) => String(o.label).toLowerCase().trim() === low)
  if (byLabel) return { value: byLabel.value, label: byLabel.label }
  return null
}

/**
 * Registra a conversão do formulário quando o lead AGENDA.
 *
 * No formulário conversacional o envio final (que grava a FormSubmission e
 * incrementa o contador) só roda depois da tela de consentimento — que vem
 * DEPOIS do agendamento. Quem marcava a reunião e fechava a aba nessa tela
 * gerava reunião real e conversão zero: o form "Tráfego Pago para Instituições"
 * tinha 1 lead com reunião agendada e 0 conversões.
 *
 * A reserva é o resultado que importa, e ela acontece no servidor — então é
 * aqui que a conversão é registrada, sem depender do navegador continuar vivo.
 *
 * Idempotente: se o envio final acontecer depois (ou já tiver acontecido), a
 * submissão existente é reaproveitada e o contador não é incrementado de novo.
 */
export async function recordFormConversionFromBooking(
  formId: number,
  leadId: number,
  extra?: { visitorId?: string | null; utmSource?: string | null; utmMedium?: string | null; utmCampaign?: string | null },
): Promise<{ created: boolean; submissionId: number | null }> {
  try {
    const existing = await prisma.formSubmission.findFirst({
      where: { formId, leadId },
      select: { id: true },
    })
    if (existing) return { created: false, submissionId: existing.id }

    const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { formData: true } })
    const data = (lead?.formData as any) || {}

    const submission = await prisma.formSubmission.create({
      data: {
        formId,
        leadId,
        data,
        visitorId: extra?.visitorId ?? null,
        utmSource: extra?.utmSource ?? null,
        utmMedium: extra?.utmMedium ?? null,
        utmCampaign: extra?.utmCampaign ?? null,
      },
      select: { id: true },
    })
    await prisma.form.update({ where: { id: formId }, data: { submissions: { increment: 1 } } }).catch(() => {})
    // Marca o lead como concluído: ele fez o que o formulário pedia.
    await prisma.lead.update({ where: { id: leadId }, data: { completed: true } }).catch(() => {})
    return { created: true, submissionId: submission.id }
  } catch (err: any) {
    console.warn('[formFlow] conversão por agendamento falhou:', err?.message)
    return { created: false, submissionId: null }
  }
}
