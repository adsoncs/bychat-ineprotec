// src/services/routing/policyEngine.ts
// Lead Routing F4 — motor de regras condicionais em cascata.
//
// Recebe um RoutingContext (UTMs + source + IDs do ingresso) e percorre as
// RoutingRule[] enabled, ordenadas por `order` ASC. A PRIMEIRA cujas
// conditions todas casarem (AND) define o destino.
//
// Devolve { teamId?, userId?, ruleId?, ruleName? } — ou null se nenhuma casou.
// O caller decide o que fazer com isso (geralmente: sobrescreve resolveDefaultTeamId).
//
// O motor NÃO atribui. Quem atribui é o caller (forms/inbound/meta), usando
// pickOperatorForTeam quando só veio teamId.
//
// Cache em memória (60s) da lista enabled+ordered. Invalidado por CRUD.

import { prisma } from '../../lib/prisma.js'

export interface RoutingContext {
  source?: 'form' | 'inbound' | 'meta' | 'chatbot' | 'whatsapp' | 'api' | 'manual'
  utmSource?: string | null
  utmMedium?: string | null
  utmCampaign?: string | null
  utmContent?: string | null
  utmTerm?: string | null
  formId?: number | null
  chatbotId?: number | null
  instanceName?: string | null
  tag?: string | string[] | null
}

type ConditionOp = 'eq' | 'neq' | 'contains' | 'startsWith' | 'in' | 'notIn' | 'exists' | 'missing'

interface Condition {
  field: string
  op: ConditionOp
  value: unknown
}

interface ActionTeam { type: 'team'; teamId: number }
interface ActionUser { type: 'user'; userId: number }
// F5: skill-based matching — restringe ao team alvo (obrigatório) + skill exigida.
interface ActionSkill { type: 'skill'; skill: string; teamId: number }
export type RuleAction = ActionTeam | ActionUser | ActionSkill

interface CachedRule {
  id: number
  name: string
  conditions: Condition[]
  action: RuleAction
}

export interface RoutingDecision {
  teamId: number | null
  userId: number | null
  // F5: quando preenchido, caller usa skill-based matching dentro do team.
  skill: string | null
  ruleId: number | null
  ruleName: string | null
}

const CACHE_TTL_MS = 60_000
let _rulesCache: { entries: CachedRule[]; expiresAt: number } | null = null

export function invalidateRulesCache() {
  _rulesCache = null
}

async function loadRules(): Promise<CachedRule[]> {
  if (_rulesCache && _rulesCache.expiresAt > Date.now()) return _rulesCache.entries
  const rows = await prisma.routingRule.findMany({
    where: { enabled: true },
    orderBy: { order: 'asc' },
    select: { id: true, name: true, conditions: true, action: true },
  })
  const entries: CachedRule[] = []
  for (const r of rows) {
    // Defensive: regras inválidas no Json (admin pode ter editado fora) — skip.
    if (!Array.isArray(r.conditions)) continue
    if (typeof r.action !== 'object' || !r.action) continue
    entries.push({
      id: r.id,
      name: r.name,
      conditions: r.conditions as unknown as Condition[],
      action: r.action as unknown as RuleAction,
    })
  }
  _rulesCache = { entries, expiresAt: Date.now() + CACHE_TTL_MS }
  return entries
}

function getFieldValue(ctx: RoutingContext, field: string): unknown {
  switch (field) {
    case 'source': return ctx.source ?? null
    case 'utmSource': return ctx.utmSource ?? null
    case 'utmMedium': return ctx.utmMedium ?? null
    case 'utmCampaign': return ctx.utmCampaign ?? null
    case 'utmContent': return ctx.utmContent ?? null
    case 'utmTerm': return ctx.utmTerm ?? null
    case 'formId': return ctx.formId ?? null
    case 'chatbotId': return ctx.chatbotId ?? null
    case 'instanceName': return ctx.instanceName ?? null
    case 'tag': return ctx.tag ?? null
    default: return undefined
  }
}

function asString(v: unknown): string {
  if (v == null) return ''
  return typeof v === 'string' ? v : String(v)
}

function evalCondition(ctx: RoutingContext, cond: Condition): boolean {
  const fieldValue = getFieldValue(ctx, cond.field)
  switch (cond.op) {
    case 'exists':
      return fieldValue !== null && fieldValue !== undefined && fieldValue !== ''
    case 'missing':
      return fieldValue === null || fieldValue === undefined || fieldValue === ''
    case 'eq':
      // Comparação por valor JSON simples; números vs string coercion via String()
      if (Array.isArray(fieldValue)) return fieldValue.includes(cond.value as string)
      return asString(fieldValue) === asString(cond.value)
    case 'neq':
      if (Array.isArray(fieldValue)) return !fieldValue.includes(cond.value as string)
      return asString(fieldValue) !== asString(cond.value)
    case 'contains':
      if (Array.isArray(fieldValue)) return fieldValue.some((v) => asString(v).toLowerCase().includes(asString(cond.value).toLowerCase()))
      return asString(fieldValue).toLowerCase().includes(asString(cond.value).toLowerCase())
    case 'startsWith':
      return asString(fieldValue).toLowerCase().startsWith(asString(cond.value).toLowerCase())
    case 'in': {
      if (!Array.isArray(cond.value)) return false
      const list = cond.value.map(asString)
      if (Array.isArray(fieldValue)) return fieldValue.some((v) => list.includes(asString(v)))
      return list.includes(asString(fieldValue))
    }
    case 'notIn': {
      if (!Array.isArray(cond.value)) return true
      const list = cond.value.map(asString)
      if (Array.isArray(fieldValue)) return !fieldValue.some((v) => list.includes(asString(v)))
      return !list.includes(asString(fieldValue))
    }
    default:
      return false
  }
}

function ruleMatches(rule: CachedRule, ctx: RoutingContext): boolean {
  if (rule.conditions.length === 0) return true // regra "catch-all"
  return rule.conditions.every((c) => evalCondition(ctx, c))
}

// Avalia regras em cascade. Retorna a primeira que casa OU null.
// Caller é responsável por checar a feature flag (isRoutingV2Enabled) antes
// de chamar — quando flag off, regras não rodam.
export async function evaluateRoutingRules(ctx: RoutingContext): Promise<RoutingDecision | null> {
  const rules = await loadRules()
  if (rules.length === 0) return null

  for (const rule of rules) {
    if (!ruleMatches(rule, ctx)) continue
    const action = rule.action
    // Conta match (fire-and-forget) — métrica do simulador/diagnóstico futuro.
    // Não bloqueia caller se falhar (ex: rule deletada race).
    prisma.routingRule
      .update({
        where: { id: rule.id },
        data: { matchedCount: { increment: 1 }, lastMatchedAt: new Date() },
      })
      .catch(() => { /* ignore */ })

    if (action.type === 'team' && typeof action.teamId === 'number') {
      return { teamId: action.teamId, userId: null, skill: null, ruleId: rule.id, ruleName: rule.name }
    }
    if (action.type === 'user' && typeof action.userId === 'number') {
      return { teamId: null, userId: action.userId, skill: null, ruleId: rule.id, ruleName: rule.name }
    }
    if (action.type === 'skill' && typeof action.skill === 'string' && typeof action.teamId === 'number') {
      return { teamId: action.teamId, userId: null, skill: action.skill, ruleId: rule.id, ruleName: rule.name }
    }
    // Action inválida: pula regra (não para a cascade, segue avaliando).
  }
  return null
}

// Validação compartilhada com o endpoint POST/PATCH.
const VALID_FIELDS = new Set([
  'source', 'utmSource', 'utmMedium', 'utmCampaign', 'utmContent', 'utmTerm',
  'formId', 'chatbotId', 'instanceName', 'tag',
])
const VALID_OPS = new Set<ConditionOp>([
  'eq', 'neq', 'contains', 'startsWith', 'in', 'notIn', 'exists', 'missing',
])

export function validateConditions(raw: unknown): { ok: true; value: Condition[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: 'conditions deve ser array' }
  const out: Condition[] = []
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i] as Record<string, unknown> | null
    if (!c || typeof c !== 'object') return { ok: false, error: `condição ${i} inválida` }
    if (typeof c.field !== 'string' || !VALID_FIELDS.has(c.field)) {
      return { ok: false, error: `field "${c.field}" desconhecido` }
    }
    if (typeof c.op !== 'string' || !VALID_OPS.has(c.op as ConditionOp)) {
      return { ok: false, error: `operador "${c.op}" inválido` }
    }
    // value pode ser null pra exists/missing.
    if (c.op !== 'exists' && c.op !== 'missing' && c.value === undefined) {
      return { ok: false, error: `value obrigatório para operador "${c.op}"` }
    }
    if ((c.op === 'in' || c.op === 'notIn') && !Array.isArray(c.value)) {
      return { ok: false, error: `value de "${c.op}" deve ser array` }
    }
    out.push({ field: c.field, op: c.op as ConditionOp, value: c.value })
  }
  return { ok: true, value: out }
}

// ─── Simulador (F9) ──────────────────────────────────────────────────
// Versão "explicada" de evaluateRoutingRules: avalia TODAS as regras (mesmo
// desabilitadas) e devolve a inspeção de cada uma — incluindo o fieldValue
// resolvido a partir do contexto e o resultado por condition.
//
// Não incrementa matchedCount — é dry-run.

export interface SimulationConditionResult {
  field: string
  op: ConditionOp
  expected: unknown
  fieldValue: unknown
  matched: boolean
}

export interface SimulationRuleResult {
  ruleId: number
  order: number
  name: string
  enabled: boolean
  matched: boolean
  skipped: 'disabled' | 'invalid' | null
  action: RuleAction | null
  conditions: SimulationConditionResult[]
}

export interface SimulationResult {
  context: RoutingContext
  rules: SimulationRuleResult[]
  winnerRuleId: number | null
}

export async function simulateRouting(ctx: RoutingContext): Promise<SimulationResult> {
  const rows = await prisma.routingRule.findMany({
    orderBy: { order: 'asc' },
    select: { id: true, order: true, name: true, enabled: true, conditions: true, action: true },
  })

  const results: SimulationRuleResult[] = []
  let winnerRuleId: number | null = null

  for (const r of rows) {
    const conds = Array.isArray(r.conditions) ? (r.conditions as unknown as Condition[]) : null
    const action = (r.action && typeof r.action === 'object') ? (r.action as unknown as RuleAction) : null

    if (!conds || !action) {
      results.push({
        ruleId: r.id, order: r.order, name: r.name, enabled: r.enabled,
        matched: false, skipped: 'invalid', action: null, conditions: [],
      })
      continue
    }

    // Avalia condições independente de enabled (vista de diagnóstico).
    const condResults: SimulationConditionResult[] = conds.map((c) => ({
      field: c.field,
      op: c.op,
      expected: c.value,
      fieldValue: getFieldValue(ctx, c.field),
      matched: evalCondition(ctx, c),
    }))
    const allMatched = condResults.length === 0 || condResults.every((cr) => cr.matched)

    let matched = false
    let skipped: SimulationRuleResult['skipped'] = null
    if (!r.enabled) {
      skipped = 'disabled'
    } else if (allMatched && winnerRuleId === null) {
      matched = true
      winnerRuleId = r.id
    }

    results.push({
      ruleId: r.id, order: r.order, name: r.name, enabled: r.enabled,
      matched, skipped, action, conditions: condResults,
    })
  }

  return { context: ctx, rules: results, winnerRuleId }
}

export function validateAction(raw: unknown): { ok: true; value: RuleAction } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'action inválida' }
  const a = raw as Record<string, unknown>
  if (a.type === 'team') {
    if (typeof a.teamId !== 'number') return { ok: false, error: 'teamId obrigatório quando type=team' }
    return { ok: true, value: { type: 'team', teamId: a.teamId } }
  }
  if (a.type === 'user') {
    if (typeof a.userId !== 'number') return { ok: false, error: 'userId obrigatório quando type=user' }
    return { ok: true, value: { type: 'user', userId: a.userId } }
  }
  if (a.type === 'skill') {
    if (typeof a.skill !== 'string' || !a.skill.trim()) return { ok: false, error: 'skill obrigatória quando type=skill' }
    if (typeof a.teamId !== 'number') return { ok: false, error: 'teamId obrigatório quando type=skill (restringe ao setor)' }
    return { ok: true, value: { type: 'skill', skill: a.skill.trim().toLowerCase().slice(0, 64), teamId: a.teamId } }
  }
  return { ok: false, error: `action.type "${a.type}" não suportado (use team, user ou skill)` }
}
