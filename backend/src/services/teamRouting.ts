// src/services/teamRouting.ts
// Roteamento de leads para setor (Team), com hierarquia em cascata.
//
// Ordem de resolução (mais específico → mais genérico):
//   1. chatbot.defaultTeamId                       — quando o lead vem de um chatbot
//   2. whatsAppInstance.defaultTeamId              — quando vem de uma instância WhatsApp sem chatbot
//   3. whatsAppInstance.chatbot.defaultTeamId      — instância tem chatbot e o chatbot tem setor
//   4. setting global "default_team_id"            — fallback catch-all (configurado em Configurações)
//
// Retorna null apenas se NENHUMA das regras se aplicar (lead vai para fila órfã).
// O setting global garante que isso só aconteça se o admin não tiver configurado nada.

import { prisma } from '../lib/prisma.js'
import { isAgentWithinWorkingHours, isTeamOpen } from './routing/workingHours.js'
import { evaluateRoutingRules, type RoutingContext, type RoutingDecision } from './routing/policyEngine.js'

interface ResolveOpts {
  chatbotId?: number | null
  instanceName?: string | null
}

// Cache simples (60s) do setting global, evita 1 query por lead em alto volume.
let _globalCache: { teamId: number | null; expiresAt: number } | null = null
let _v2Cache: { enabled: boolean; expiresAt: number } | null = null
let _escalationCache: { config: EscalationConfig; expiresAt: number } | null = null
const CACHE_TTL_MS = 60_000

export function invalidateRoutingCache() {
  _globalCache = null
  _v2Cache = null
  _oohCache = null
  _escalationCache = null
}

// Lead Routing F8: configuração da escalação automática.
// Lê 3 Settings (routing.escalation.*) com cache curto. Defaults seguros para
// quando o admin ainda não tocou — operação inerte (enabled=false).
export interface EscalationConfig {
  enabled: boolean
  minutes: number              // tempo sem resposta antes de devolver à fila
  reassignOnOffline: boolean   // libera leads de agentes offline há > 30min
}

function readBoolSetting(value: unknown, fallback: boolean): boolean {
  if (value == null) return fallback
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value.toLowerCase() === 'true'
  if (typeof value === 'number') return value !== 0
  return fallback
}

function readNumberSetting(value: unknown, fallback: number): number {
  if (value == null) return fallback
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const n = parseInt(value)
    if (Number.isFinite(n)) return n
  }
  return fallback
}

// Reforma F5: configuração do hand-off de turno.
export interface ShiftConfig {
  enabled: boolean
  toleranceMinutes: number
}
let _shiftCache: { config: ShiftConfig; expiresAt: number } | null = null

export async function getShiftConfig(): Promise<ShiftConfig> {
  if (_shiftCache && _shiftCache.expiresAt > Date.now()) return _shiftCache.config
  const rows = await prisma.setting.findMany({
    where: { key: { in: ['routing.shift.enabled', 'routing.shift.toleranceMinutes'] } },
    select: { key: true, value: true },
  })
  const byKey = new Map(rows.map((r) => [r.key, r.value]))
  const readBool = (v: unknown, fb: boolean): boolean => {
    if (v == null) return fb
    if (typeof v === 'boolean') return v
    if (typeof v === 'string') return v.toLowerCase() === 'true'
    if (typeof v === 'number') return v !== 0
    return fb
  }
  const readNum = (v: unknown, fb: number): number => {
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string') { const n = parseInt(v); if (Number.isFinite(n)) return n }
    return fb
  }
  const config: ShiftConfig = {
    enabled: readBool(byKey.get('routing.shift.enabled'), false),
    toleranceMinutes: Math.max(0, Math.min(240, readNum(byKey.get('routing.shift.toleranceMinutes'), 30))),
  }
  _shiftCache = { config, expiresAt: Date.now() + CACHE_TTL_MS }
  return config
}

export function invalidateShiftCache() {
  _shiftCache = null
}

export async function getEscalationConfig(): Promise<EscalationConfig> {
  if (_escalationCache && _escalationCache.expiresAt > Date.now()) return _escalationCache.config
  const rows = await prisma.setting.findMany({
    where: {
      key: { in: ['routing.escalation.enabled', 'routing.escalation.minutes', 'routing.escalation.reassignOnOffline'] },
    },
    select: { key: true, value: true },
  })
  const byKey = new Map(rows.map((r) => [r.key, r.value]))
  const config: EscalationConfig = {
    enabled: readBoolSetting(byKey.get('routing.escalation.enabled'), false),
    minutes: Math.max(5, readNumberSetting(byKey.get('routing.escalation.minutes'), 60)),
    reassignOnOffline: readBoolSetting(byKey.get('routing.escalation.reassignOnOffline'), true),
  }
  _escalationCache = { config, expiresAt: Date.now() + CACHE_TTL_MS }
  return config
}

// Feature flag do motor de roteamento V2.
// Quando false (default), o picker mantém comportamento legado (qualquer User
// ativo em workStatus=available recebe). Quando true, exige role∈{AGENT,MANAGER,ADMIN,SUPERADMIN}.
// Usado pelo módulo de Lead Routing para rollout gradual.
export async function isRoutingV2Enabled(): Promise<boolean> {
  if (_v2Cache && _v2Cache.expiresAt > Date.now()) return _v2Cache.enabled
  const setting = await prisma.setting.findUnique({ where: { key: 'routing.v2.enabled' } })
  let enabled = false
  if (setting?.value != null) {
    const raw = setting.value as any
    if (typeof raw === 'boolean') enabled = raw
    else if (typeof raw === 'string') enabled = raw.toLowerCase() === 'true'
    else if (typeof raw === 'number') enabled = raw !== 0
  }
  _v2Cache = { enabled, expiresAt: Date.now() + CACHE_TTL_MS }
  return enabled
}

async function getGlobalDefaultTeamId(): Promise<number | null> {
  if (_globalCache && _globalCache.expiresAt > Date.now()) return _globalCache.teamId
  const setting = await prisma.setting.findUnique({ where: { key: 'default_team_id' } })
  let teamId: number | null = null
  if (setting?.value != null) {
    const raw = setting.value as any
    if (typeof raw === 'number') teamId = raw
    else if (typeof raw === 'string' && /^\d+$/.test(raw)) teamId = parseInt(raw)
    else if (typeof raw === 'object' && typeof raw.id === 'number') teamId = raw.id
  }
  // Valida que o setor ainda existe e está ativo (proteção contra setor deletado)
  if (teamId) {
    const team = await prisma.team.findUnique({ where: { id: teamId }, select: { id: true, active: true } })
    if (!team || !team.active) teamId = null
  }
  _globalCache = { teamId, expiresAt: Date.now() + CACHE_TTL_MS }
  return teamId
}

export async function resolveDefaultTeamId(opts: ResolveOpts = {}): Promise<number | null> {
  const { chatbotId, instanceName } = opts

  // 1. Chatbot direto
  if (chatbotId) {
    const cb = await prisma.chatbot.findUnique({
      where: { id: chatbotId },
      select: { defaultTeamId: true },
    })
    if (cb?.defaultTeamId) return cb.defaultTeamId
  }

  // 2 e 3. Instância WhatsApp (defaultTeamId direto, senão chatbot vinculado à instância)
  if (instanceName) {
    const inst = await prisma.whatsAppInstance.findFirst({
      where: { instanceName },
      select: { defaultTeamId: true, chatbotId: true },
    })
    if (inst?.defaultTeamId) return inst.defaultTeamId
    if (inst?.chatbotId) {
      const cb = await prisma.chatbot.findUnique({
        where: { id: inst.chatbotId },
        select: { defaultTeamId: true },
      })
      if (cb?.defaultTeamId) return cb.defaultTeamId
    }
  }

  // 4. Fallback global
  return await getGlobalDefaultTeamId()
}

// ──────────────────────────────────────────────────────────────────────────
// S11 — Round-robin / load balancing
//
// `pickOperatorForTeam` decide quem na equipe recebe um lead novo, dado o
// modo de roteamento configurado no setor:
//   - manual      → null (lead vai pra fila do setor; operador faz claim)
//   - round_robin → membro com `assignedAt` mais antigo entre os leads em
//                   atendimento (quem está há mais tempo sem receber)
//   - least_loaded→ membro com menor número de leads ativos respeitando capacity
//   - random      → sorteio entre os elegíveis
//
// Operadores `away`/`busy`/`offline` são sempre excluídos. Capacity esgotada
// também exclui (no least_loaded é a regra primária).
// Retorna null se ninguém é elegível — lead cai na fila como no manual.

export type RoutingMode = 'manual' | 'round_robin' | 'least_loaded' | 'random'

interface CandidateMember {
  userId: number
  capacity: number
  activeLeadCount: number
  lastAssignedAt: Date | null
}

// Presença aceita no passe estrito (comportamento histórico) e no passe de
// fallback. `offline` fica de fora dos dois: quem deslogou não está no turno.
const STRICT_STATUSES = ['available']
const FALLBACK_STATUSES = ['available', 'away', 'busy']

async function getEligibleMembers(
  teamId: number,
  requireAgent: boolean,
  statuses: string[] = STRICT_STATUSES,
): Promise<CandidateMember[]> {
  // Membros ativos da equipe cujo workStatus está em `statuses`. Exclui locked,
  // inactive e (sempre) offline.
  // Quando requireAgent=true (Setting routing.v2.enabled):
  //   - exige role IN (AGENT, MANAGER, ADMIN, SUPERADMIN) — exclui VIEWER
  //     (Reforma F1: substituiu o filtro isAgent=true legado)
  //   - exige agentProfile.active != false (perfil pode estar pausado)
  //   - exige agentProfile.vacationUntil = null OU vacationUntil <= now
  //   - exige estar dentro do horário (AgentWorkingHour) — checado depois via batch
  // Quando false, mantém comportamento legado pra não quebrar tenants antes do rollout.
  const userFilter: Record<string, unknown> = {
    active: true,
    lockedAt: null,
    workStatus: { in: statuses },
  }
  if (requireAgent) {
    userFilter.role = { in: ['AGENT', 'MANAGER', 'ADMIN', 'SUPERADMIN'] }
    userFilter.agentProfile = {
      is: {
        active: true,
        OR: [{ vacationUntil: null }, { vacationUntil: { lte: new Date() } }],
      },
    }
  }

  const members = await prisma.teamMember.findMany({
    where: { teamId, user: userFilter as any },
    select: { userId: true, user: { select: { capacity: true } } },
  })
  if (members.length === 0) return []

  // Filtro de horário do agente (só quando v2 on). Agentes sem AgentWorkingHour
  // configurado são considerados 24/7 (helper já trata).
  let allowedUserIds: Set<number> | null = null
  if (requireAgent) {
    allowedUserIds = new Set<number>()
    const now = new Date()
    for (const m of members) {
      if (await isAgentWithinWorkingHours(m.userId, now)) allowedUserIds.add(m.userId)
    }
  }
  const filteredMembers = allowedUserIds
    ? members.filter((m) => allowedUserIds!.has(m.userId))
    : members
  if (filteredMembers.length === 0) return []

  const userIds = filteredMembers.map((m) => m.userId)
  // Conta leads ativos (atribuídos e não resolvidos) por operador.
  // lastAssignedAt = MAIS RECENTE atribuição: usado pelo round_robin pra
  // rotacionar (escolhe quem recebeu há mais tempo). _min daria o lead
  // "mais antigo preso" — não rotaciona quando agentes têm backlog.
  const counts = await prisma.lead.groupBy({
    by: ['assignedUserId'],
    where: {
      assignedUserId: { in: userIds },
      outcome: null,
    },
    _count: { _all: true },
    _max: { assignedAt: true },
  })
  const byUser = new Map<number, { count: number; lastAssignedAt: Date | null }>()
  for (const r of counts) {
    if (r.assignedUserId === null) continue
    byUser.set(r.assignedUserId, {
      count: r._count._all,
      lastAssignedAt: r._max.assignedAt ?? null,
    })
  }

  return filteredMembers.map((m) => {
    const stats = byUser.get(m.userId)
    return {
      userId: m.userId,
      capacity: m.user.capacity,
      activeLeadCount: stats?.count ?? 0,
      lastAssignedAt: stats?.lastAssignedAt ?? null,
    }
  })
}

/**
 * Garante o PERFIL DE AGENTE de quem tem papel que recebe leads.
 *
 * Existe porque o motor V2 filtra por `agentProfile`, e havia três portas por
 * onde alguém entrava sem ele: criar usuário, promover VIEWER a um papel
 * operacional, e ligar o próprio motor com a equipe já montada. Quem passasse
 * por qualquer uma delas ficava invisível para o rodízio — e em silêncio, porque
 * a tela mostra a pessoa como agente (o `isAgent` do modelo antigo) e nada
 * denuncia a falta do perfil.
 *
 * Foi exatamente o que parou o roteamento do ineprotec por cinco dias: três
 * operadoras ativas, disponíveis, e nenhuma elegível.
 *
 * É idempotente (upsert) e não mexe em perfil que já exista — peso, férias e
 * limite diário de quem já está configurado ficam como estão.
 *
 * Devolve quantos perfis foram criados.
 */
export async function garantirPerfilDeAgente(userIds: number[]): Promise<number> {
  if (userIds.length === 0) return 0
  const alvos = await prisma.user.findMany({
    where: { id: { in: userIds }, active: true, role: { not: 'VIEWER' }, agentProfile: { is: null } },
    select: { id: true },
  })
  if (alvos.length === 0) return 0
  await prisma.agentProfile.createMany({
    data: alvos.map((u) => ({ userId: u.id })),
    skipDuplicates: true,
  })
  invalidateRoutingCache()
  return alvos.length
}

/** O mesmo, para todo mundo do tenant — usado ao LIGAR o motor V2. */
export async function garantirPerfilDeTodosOsAgentes(): Promise<number> {
  const todos = await prisma.user.findMany({
    where: { active: true, role: { not: 'VIEWER' } },
    select: { id: true },
  })
  return garantirPerfilDeAgente(todos.map((u) => u.id))
}

export async function pickOperatorForTeam(
  teamId: number,
  opts?: { onlyUserIds?: number[] },
): Promise<number | null> {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { id: true, name: true, active: true, routingMode: true, workingHoursEnabled: true },
  })
  if (!team || !team.active) return null
  const mode = (team.routingMode || 'manual') as RoutingMode
  if (mode === 'manual') return null

  const requireAgent = await isRoutingV2Enabled()
  // Team com horário habilitado fora do horário → fila do setor (null).
  // Caller pode redirecionar pro plantonista via routing.out_of_hours_team_id.
  if (requireAgent && team.workingHoursEnabled) {
    if (!(await isTeamOpen(teamId))) {
      console.warn(`[routing] setor ${teamId} (${team.name}) fechado por horário — lead sem responsável`)
      return null
    }
  }
  // Recorte opcional de candidatos: o Agendamento passa só quem está livre NO
  // HORÁRIO da reunião, para o rodízio não cair em quem não atende àquela hora.
  // Lista vazia = ninguém livre; devolve null e o caller manda para a fila.
  const restrict = opts?.onlyUserIds
  if (restrict && restrict.length === 0) return null
  const narrow = (list: CandidateMember[]) =>
    restrict ? list.filter((m) => restrict.includes(m.userId)) : list

  // Passe 1: só quem está "Disponível" (comportamento histórico).
  let members = narrow(await getEligibleMembers(teamId, requireAgent))
  // Passe 2 (fallback suave): ninguém disponível → aceita "Ausente"/"Em pausa".
  // Mesma filosofia do soft-limit de capacity logo abaixo: entregar a um
  // operador ausente é melhor que deixar o lead órfão numa fila que ninguém
  // olha. Setor em modo `manual` nunca chega aqui (early-return acima), então
  // quem quer fila de claim explícito continua tendo fila.
  // Motivador: setor com 1 membro que marcou "Ausente" parava o roteamento
  // inteiro sem nenhum rastro (severiano, Matrículas, 23/07/2026).
  let softFallback = false
  if (members.length === 0) {
    members = narrow(await getEligibleMembers(teamId, requireAgent, FALLBACK_STATUSES))
    softFallback = members.length > 0
  }
  if (members.length === 0) {
    console.warn(
      `[routing] setor ${teamId} (${team.name}) sem operador elegível ` +
      `(modo=${mode}, v2=${requireAgent}) — lead cai na fila sem responsável`,
    )
    return null
  }
  if (softFallback) {
    console.warn(
      `[routing] setor ${teamId} (${team.name}): nenhum operador "Disponível", ` +
      `usando fallback para ausente/em pausa`,
    )
  }

  // Capacity é soft-limit: preferimos quem ainda tem folga, mas se todos
  // estouraram ainda distribuímos — entregar a um operador sobrecarregado é
  // melhor que deixar lead órfão na fila sem responsável.
  const withCapacity = members.filter((m) => m.activeLeadCount < m.capacity)
  const pool = withCapacity.length > 0 ? withCapacity : members

  if (mode === 'random') {
    const idx = Math.floor(Math.random() * pool.length)
    return pool[idx]!.userId
  }
  if (mode === 'least_loaded') {
    // Menor activeLeadCount; empate → menor capacity:lead ratio (mais "folga relativa")
    pool.sort((a, b) => {
      if (a.activeLeadCount !== b.activeLeadCount) return a.activeLeadCount - b.activeLeadCount
      return (b.capacity - b.activeLeadCount) - (a.capacity - a.activeLeadCount)
    })
    return pool[0]!.userId
  }
  // round_robin: operador cujo ÚLTIMO recebimento foi há mais tempo. Membros
  // que nunca receberam (lastAssignedAt = null) entram primeiro. Garante rotação
  // real entre agentes mesmo quando todos têm backlog acumulado.
  pool.sort((a, b) => {
    if (a.lastAssignedAt === null && b.lastAssignedAt !== null) return -1
    if (b.lastAssignedAt === null && a.lastAssignedAt !== null) return 1
    if (a.lastAssignedAt === null && b.lastAssignedAt === null) {
      return a.activeLeadCount - b.activeLeadCount
    }
    return a.lastAssignedAt!.getTime() - b.lastAssignedAt!.getTime()
  })
  return pool[0]!.userId
}

/**
 * userIds de uma equipe que PODEM atender reuniões — base para o Agendamento
 * montar os horários ofertados.
 *
 * De propósito NÃO usa `getEligibleMembers`: aquele filtra por presença agora,
 * horário de trabalho agora e `isTeamOpen` agora, o que faz sentido para
 * distribuir um lead que acabou de entrar, mas não para ofertar horários da
 * semana que vem. Se a oferta dependesse disso, a página pública ficaria sem
 * nenhum horário à noite e no fim de semana, quando todo mundo está offline.
 *
 * Filtra o que é estável: usuário ativo e não bloqueado, papel operacional,
 * perfil de agente ativo e fora de férias.
 */
export async function listSchedulableOperators(teamId: number, at?: Date): Promise<number[]> {
  const team = await prisma.team.findUnique({ where: { id: teamId }, select: { id: true, active: true } })
  if (!team || !team.active) return []
  const requireAgent = await isRoutingV2Enabled()
  const userFilter: Record<string, unknown> = { active: true, lockedAt: null }
  if (requireAgent) {
    userFilter.role = { in: ['AGENT', 'MANAGER', 'ADMIN', 'SUPERADMIN'] }
    // Ausência é medida contra a DATA DA REUNIÃO quando ela é conhecida, não
    // contra agora: quem volta de férias na quinta continua elegível para uma
    // reunião na sexta. Sem `at` (montagem da grade inteira) mantém o corte por
    // agora e a checagem por dia acontece slot a slot em `operatorsFreeAt`.
    const ref = at ?? new Date()
    userFilter.agentProfile = {
      is: { active: true, OR: [{ vacationUntil: null }, { vacationUntil: { lte: ref } }] },
    }
  }
  const members = await prisma.teamMember.findMany({
    where: { teamId, user: userFilter as any },
    select: { userId: true },
  })
  return members.map((m) => m.userId)
}

/** Operadores de férias na data indicada (ausência cobre o instante `at`). */
export async function operatorsOnVacationAt(userIds: number[], at: Date): Promise<Set<number>> {
  if (userIds.length === 0) return new Set()
  const profiles = await prisma.agentProfile.findMany({
    where: { userId: { in: userIds }, vacationUntil: { gt: at } },
    select: { userId: true },
  })
  return new Set(profiles.map((p) => p.userId))
}

/** Menor carga entre um conjunto de operadores (desempate por menor id). Usado
 *  pelo Agendamento quando o rodízio normal não devolve ninguém por causa de
 *  presença — a reunião é futura, não faz sentido deixá-la órfã por isso. */
export async function leastLoadedAmong(userIds: number[]): Promise<number | null> {
  if (userIds.length === 0) return null
  const counts = await prisma.lead.groupBy({
    by: ['assignedUserId'],
    where: { assignedUserId: { in: userIds }, outcome: null },
    _count: { _all: true },
  })
  const by = new Map<number, number>(userIds.map((id) => [id, 0]))
  for (const c of counts) if (c.assignedUserId !== null) by.set(c.assignedUserId, c._count._all)
  return [...by.entries()].sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]))[0]![0]
}

// F5 — Picker filtrado por skill.
// Usado quando RoutingRule action=skill dispara. Restringe membros do team
// aos que possuem a skill exigida; o resto da pipeline (capacity/workingHours/
// vacation) já roda dentro de getEligibleMembers (com requireAgent=true).
// Retorna null se ninguém com a skill atende — caller cai pra cascata legada.
export async function pickOperatorBySkill(teamId: number, skill: string): Promise<number | null> {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { id: true, active: true, routingMode: true, workingHoursEnabled: true },
  })
  if (!team || !team.active) return null
  // V2 é pré-requisito pra skill-based; chamada chega só quando flag on, mas
  // checamos defensivamente. Se setor exige horário e está fechado, fila.
  if (team.workingHoursEnabled && !(await isTeamOpen(teamId))) return null

  // Carrega membros elegíveis (já filtra agente/working hours/vacation/profile).
  // Mesmo fallback suave do pickOperatorForTeam: ninguém "Disponível" → aceita
  // ausente/em pausa antes de devolver null.
  let members = await getEligibleMembers(teamId, true)
  if (members.length === 0) members = await getEligibleMembers(teamId, true, FALLBACK_STATUSES)
  if (members.length === 0) return null

  // Filtra pelos que têm a skill.
  const userIds = members.map((m) => m.userId)
  const withSkill = await prisma.agentSkill.findMany({
    where: { userId: { in: userIds }, skill: skill.toLowerCase() },
    select: { userId: true, level: true },
  })
  if (withSkill.length === 0) return null
  const skillByUser = new Map(withSkill.map((s) => [s.userId, s.level]))
  const candidates = members.filter((m) => skillByUser.has(m.userId))
  if (candidates.length === 0) return null

  // Capacity é soft-limit (vide pickOperatorForTeam): se todos com skill
  // estouraram, distribui mesmo assim em vez de devolver null.
  const withCapacity = candidates.filter((m) => m.activeLeadCount < m.capacity)
  const pool = withCapacity.length > 0 ? withCapacity : candidates

  // Ordena: level desc, depois menor carga, depois mais tempo sem receber.
  pool.sort((a, b) => {
    const la = skillByUser.get(a.userId) ?? 1
    const lb = skillByUser.get(b.userId) ?? 1
    if (la !== lb) return lb - la
    if (a.activeLeadCount !== b.activeLeadCount) return a.activeLeadCount - b.activeLeadCount
    const at = a.lastAssignedAt?.getTime() ?? 0
    const bt = b.lastAssignedAt?.getTime() ?? 0
    return at - bt
  })
  return pool[0]!.userId
}

// Orquestrador único — caller passa o contexto que tem disponível, função
// decide se aplica regras (F4) ou cai na cascata legada.
//
// Fluxo:
//   1. Se motor V2 ligado: avalia RoutingRule[]. Casou? Resolve teamId/userId.
//      - Action team: chama pickOperatorForTeam(team) pra obter operador.
//      - Action user: usa o user direto, teamId herdado dos teams do user (ou null).
//   2. Senão, fallback cascata: resolveDefaultTeamId(ctx) → pickOperatorForTeam(team).
//
// Retorna { teamId, userId, ruleId?, ruleName? }. ruleId não-nulo = regra explícita.
export interface ResolvedRouting {
  teamId: number | null
  userId: number | null
  ruleId: number | null
  ruleName: string | null
}

export async function resolveRoutingFromContext(ctx: RoutingContext): Promise<ResolvedRouting> {
  const v2 = await isRoutingV2Enabled()

  // 0. Reforma F2: instância dedicada a um agente. Quando a instância tem
  // ownerUserId, lead é atribuído direto sem passar por regras nem cascata.
  // Owner é o "dono" do número — não faria sentido sobrescrever via outras regras.
  // Pre-requisito: motor V2 ligado (modelo agente-isolado).
  if (v2 && ctx.instanceName) {
    const inst = await prisma.whatsAppInstance.findFirst({
      where: { instanceName: ctx.instanceName, active: true },
      select: {
        ownerUserId: true,
        owner: { select: { active: true, role: true } },
      },
    })
    if (inst?.ownerUserId && inst.owner?.active && inst.owner.role !== 'VIEWER') {
      const tm = await prisma.teamMember.findFirst({
        where: { userId: inst.ownerUserId, team: { active: true } },
        select: { teamId: true },
        orderBy: { id: 'asc' },
      })
      return {
        teamId: tm?.teamId ?? null,
        userId: inst.ownerUserId,
        ruleId: null,
        ruleName: 'Instância dedicada (owner)',
      }
    }
  }

  // 1. Regras condicionais (só quando v2 on).
  if (v2) {
    const decision: RoutingDecision | null = await evaluateRoutingRules(ctx)
    if (decision) {
      let teamId = decision.teamId
      let userId = decision.userId
      // Action skill (F5) → escolhe agente que tem a skill dentro do team.
      if (decision.skill && teamId && !userId) {
        userId = await pickOperatorBySkill(teamId, decision.skill)
      }
      // Action user → herda teamId do user (pega o 1º TeamMember).
      if (userId && !teamId) {
        const tm = await prisma.teamMember.findFirst({
          where: { userId, team: { active: true } },
          select: { teamId: true },
          orderBy: { id: 'asc' },
        })
        teamId = tm?.teamId ?? null
      }
      // Action team → resolve operador via picker (mesmas regras de horário/capacidade).
      if (teamId && !userId) {
        userId = await pickOperatorForTeam(teamId)
      }
      return {
        teamId,
        userId,
        ruleId: decision.ruleId,
        ruleName: decision.ruleName,
      }
    }
  }

  // 2. Fallback cascata legada.
  const teamId = await resolveDefaultTeamId({
    chatbotId: ctx.chatbotId ?? null,
    instanceName: ctx.instanceName ?? null,
  })
  const userId = teamId ? await pickOperatorForTeam(teamId) : null
  return { teamId, userId, ruleId: null, ruleName: null }
}

// Setor de plantão fora de horário. Lido sob demanda (cache 60s).
// Caller (forms/inbound/meta) usa quando pickOperatorForTeam retorna null E
// quer redirecionar o lead pra outro setor que cuida do plantão.
let _oohCache: { teamId: number | null; expiresAt: number } | null = null
export async function getOutOfHoursTeamId(): Promise<number | null> {
  if (_oohCache && _oohCache.expiresAt > Date.now()) return _oohCache.teamId
  const setting = await prisma.setting.findUnique({ where: { key: 'routing.out_of_hours_team_id' } })
  let teamId: number | null = null
  if (setting?.value != null) {
    const raw = setting.value as any
    if (typeof raw === 'number') teamId = raw
    else if (typeof raw === 'string' && /^\d+$/.test(raw)) teamId = parseInt(raw)
    else if (typeof raw === 'object' && typeof raw.id === 'number') teamId = raw.id
  }
  // Valida que ainda existe e está ativo (proteção contra setor deletado)
  if (teamId) {
    const team = await prisma.team.findUnique({ where: { id: teamId }, select: { id: true, active: true } })
    if (!team || !team.active) teamId = null
  }
  _oohCache = { teamId, expiresAt: Date.now() + CACHE_TTL_MS }
  return teamId
}

// Reforma F2: validação cruzada user × instance × lead.
// Caller (envio de mensagem) chama com (userId, role, leadId) e a instância
// que o provider escolheu. Retorna { ok: true } se autorizado ou
// { ok: false, reason } com motivo legível.
//
// Regras:
//   - SUPERADMIN/ADMIN: sempre passa (assumimos override gerencial).
//   - Se instância tem ownerUserId: só esse user OU admin podem enviar por ela.
//   - Se instância tem setores donos (um ou vários): user deve ser membro de
//     algum deles OU ser o assignedUser do lead.
//   - Se instância não tem amarração: sem restrição extra (cobertura por team scope já feita).
export interface CanSendViaResult {
  ok: boolean
  reason?: string
}

export async function canSendVia(
  userId: number,
  role: string,
  leadId: number,
  instanceName: string,
): Promise<CanSendViaResult> {
  if (role === 'SUPERADMIN' || role === 'ADMIN') return { ok: true }

  const [inst, lead] = await Promise.all([
    prisma.whatsAppInstance.findFirst({
      where: { instanceName, active: true },
      select: { id: true, ownerUserId: true, defaultTeamId: true },
    }),
    prisma.lead.findUnique({ where: { id: leadId }, select: { assignedUserId: true, teamId: true } }),
  ])
  if (!inst) return { ok: false, reason: 'Instância não encontrada' }
  const instTeams = await prisma.whatsAppInstanceTeam.findMany({
    where: { instanceId: inst.id }, select: { teamId: true },
  })
  if (!lead) return { ok: false, reason: 'Lead não encontrado' }

  // Instância pessoal: só owner.
  if (inst.ownerUserId) {
    if (inst.ownerUserId !== userId) {
      return { ok: false, reason: 'Esta instância pertence a outro agente' }
    }
    return { ok: true }
  }

  // Instância de setor: precisa ser membro de ALGUM dos setores donos OU ter o
  // lead atribuído. A lista cobre o número compartilhado por vários setores; o
  // `defaultTeamId` entra junto para instância antiga que ainda não migrou.
  if (lead.assignedUserId === userId) return { ok: true }
  const donos = new Set<number>(instTeams.map((t) => t.teamId))
  if (inst.defaultTeamId) donos.add(inst.defaultTeamId)
  if (donos.size > 0) {
    const member = await prisma.teamMember.findFirst({
      where: { userId, teamId: { in: Array.from(donos) }, team: { active: true } },
      select: { id: true },
    })
    if (member) return { ok: true }
    return { ok: false, reason: donos.size > 1 ? 'Você não pertence a nenhum setor deste número' : 'Você não pertence ao setor desta instância' }
  }

  // Sem amarração: sem restrição extra (instância "comum" do tenant).
  return { ok: true }
}
