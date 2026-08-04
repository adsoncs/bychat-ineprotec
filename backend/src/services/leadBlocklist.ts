// src/services/leadBlocklist.ts
//
// Lista de bloqueio na ENTRADA de leads. O caso que a originou: um contato que
// se inscrevia toda semana e nunca respondia — a única saída era apagar o lead
// de novo e de novo, e a base seguia suja.
//
// Regras do desenho, decididas com o Adson:
//
//   • Uma regra casa por QUALQUER critério (e-mail, domínio, WhatsApp, IP).
//     Quem abusa troca um dado e mantém o outro; exigir todos os critérios
//     juntos deixaria passar.
//   • O bloqueio é SILENCIOSO: o formulário responde "enviado com sucesso" e o
//     lead simplesmente não é criado. Recusar com erro avisaria a pessoa, que
//     trocaria de e-mail e voltaria.
//   • Vale só para entradas AUTOMÁTICAS (formulário, landing page, Lead Ads,
//     API pública, webhooks de entrada, chat do site). Mensagem recebida no
//     WhatsApp/Instagram/Telegram continua criando lead — cliente real que
//     caísse numa regra sumiria do atendimento sem ninguém perceber. Cadastro
//     manual pelo operador também passa (o painel só avisa).
//
// As regras ficam em cache de memória porque isto roda em todo formulário
// enviado; qualquer escrita invalida o cache (ver routes/leadBlocklist.ts).

import { prisma } from '../lib/prisma.js'
import { phoneKey } from '../lib/phone.js'
import { logSecurityEvent } from './security.js'

export type BlockCriterion = 'email' | 'domain' | 'whatsapp' | 'ip'

export interface LeadBlockCandidate {
  email?: string | null
  whatsapp?: string | null
  ip?: string | null
}

export interface LeadBlockMatch {
  ruleId: number
  label: string | null
  criterion: BlockCriterion
  reason: string | null
}

interface CachedRule {
  id: number
  label: string | null
  emailKey: string | null
  emailDomain: string | null
  phoneKey: string | null
  ip: string | null
  reason: string | null
}

const CACHE_TTL_MS = 30_000
let cache: { rules: CachedRule[]; at: number } | null = null

/** Chamado por toda escrita de regra — sem isto, desligar um bloqueio levaria
 *  até 30s para valer, e quem testa acha que não funcionou. */
export function invalidateBlocklistCache(): void {
  cache = null
}

async function activeRules(): Promise<CachedRule[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.rules
  const rules = await prisma.leadBlockRule.findMany({
    where: { active: true },
    select: { id: true, label: true, emailKey: true, emailDomain: true, phoneKey: true, ip: true, reason: true },
  }).catch(() => [] as CachedRule[])
  cache = { rules, at: Date.now() }
  return rules
}

export function normalizeEmail(v: unknown): string | null {
  const s = String(v ?? '').trim().toLowerCase()
  return s.includes('@') ? s : null
}

/** "@lixo.com", "lixo.com" ou "alguem@lixo.com" → "lixo.com". */
export function normalizeDomain(v: unknown): string | null {
  const s = String(v ?? '').trim().toLowerCase().replace(/^@/, '')
  const dom = s.includes('@') ? s.split('@').pop() ?? '' : s
  return dom.includes('.') ? dom : null
}

/** Telefone canônico — mesma chave usada na deduplicação de contato. */
export function normalizePhone(v: unknown): string | null {
  const k = phoneKey(String(v ?? ''))
  return k || null
}

/**
 * Qual regra barra este candidato — ou null se pode entrar.
 * Não escreve nada: quem registra o hit é `rejectLeadEntry`.
 */
export async function findLeadBlock(c: LeadBlockCandidate): Promise<LeadBlockMatch | null> {
  const rules = await activeRules()
  if (rules.length === 0) return null

  const email = normalizeEmail(c.email)
  const domain = email ? normalizeDomain(email) : null
  const phone = normalizePhone(c.whatsapp)
  const ip = String(c.ip ?? '').trim() || null

  for (const r of rules) {
    let criterion: BlockCriterion | null = null
    if (r.emailKey && email && r.emailKey === email) criterion = 'email'
    else if (r.emailDomain && domain && r.emailDomain === domain) criterion = 'domain'
    else if (r.phoneKey && phone && r.phoneKey === phone) criterion = 'whatsapp'
    else if (r.ip && ip && r.ip === ip) criterion = 'ip'
    if (criterion) return { ruleId: r.id, label: r.label, criterion, reason: r.reason }
  }
  return null
}

const CRITERION_LABEL: Record<BlockCriterion, string> = {
  email: 'e-mail', domain: 'domínio do e-mail', whatsapp: 'WhatsApp', ip: 'IP',
}

/**
 * Verifica e, se bloquear, registra a tentativa (contador na regra + evento no
 * log de Segurança) devolvendo `true` para o chamador responder normalmente sem
 * criar o lead.
 *
 * `canal` aparece no log ("formulário", "lead ads", "api pública"…) — é o que
 * permite descobrir por onde a pessoa está insistindo.
 */
export async function rejectLeadEntry(c: LeadBlockCandidate, canal: string): Promise<LeadBlockMatch | null> {
  const match = await findLeadBlock(c).catch(() => null)
  if (!match) return null

  // Contador e log são best-effort: bloquear é o essencial, contabilizar não
  // pode derrubar a requisição de quem está do outro lado.
  prisma.leadBlockRule.update({
    where: { id: match.ruleId },
    data: { hits: { increment: 1 }, lastHitAt: new Date() },
  }).catch(() => { /* ignore */ })

  const quem = [c.email, c.whatsapp].filter(Boolean).join(' · ') || 'sem identificação'
  logSecurityEvent({
    ip: c.ip || '0.0.0.0',
    type: 'lead_blocked',
    severity: 'low',
    email: c.email || undefined,
    details: `Entrada de lead bloqueada em ${canal} por ${CRITERION_LABEL[match.criterion]}`
      + `${match.label ? ` — regra "${match.label}"` : ''} (${quem})`,
  }).catch(() => { /* ignore */ })

  return match
}

/**
 * Extrai o candidato a partir de uma submissão de formulário: os campos do form
 * são dinâmicos, e é o `mapTo` de cada um que diz qual vira e-mail/WhatsApp.
 */
export function candidateFromForm(fields: any[], data: Record<string, any>, ip?: string | null): LeadBlockCandidate {
  const mapped: Record<string, string> = {}
  for (const f of Array.isArray(fields) ? fields : []) {
    if (f?.mapTo && data?.[f.key]) mapped[f.mapTo] = String(data[f.key])
  }
  return {
    email: mapped.email ?? null,
    whatsapp: mapped.whatsapp ?? mapped.phone ?? mapped.telefone ?? null,
    ip: ip ?? null,
  }
}
