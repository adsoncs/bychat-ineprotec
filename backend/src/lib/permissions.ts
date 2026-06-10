// src/lib/permissions.ts
// Sistema de permissões por módulo com cache in-memory

import { FastifyRequest, FastifyReply } from 'fastify'
import jwt from 'jsonwebtoken'
import { prisma } from './prisma.js'
import { type JwtPayload } from './auth.js'
import { getModuleForRoute, MODULE_REGISTRY } from './moduleRegistry.js'

const JWT_SECRET = process.env.JWT_SECRET || 'change-me'

type Action = 'view' | 'create' | 'edit' | 'delete'

interface ModulePerms {
  canView: boolean
  canCreate: boolean
  canEdit: boolean
  canDelete: boolean
}

export type PermScope = 'own' | 'team' | 'all'

export interface ResolvedPermEntry extends ModulePerms {
  scope: PermScope
}

export interface ResolvedPerms {
  [moduleId: string]: ResolvedPermEntry
}

// Cache com TTL de 60s
const permCache = new Map<string, { perms: ResolvedPerms; ts: number }>()
const CACHE_TTL = 60_000

// Cache de módulos ativos (TTL maior — muda raro). Invalidado quando admin
// toggla Module.active via endpoint dedicado.
let activeModulesCache: { ids: Set<string>; ts: number } | null = null
const MODULES_CACHE_TTL = 60_000

export async function getActiveModuleIds(): Promise<Set<string>> {
  if (activeModulesCache && Date.now() - activeModulesCache.ts < MODULES_CACHE_TTL) {
    return activeModulesCache.ids
  }
  const rows = await prisma.module.findMany({ where: { active: true }, select: { id: true } })
  const ids = new Set(rows.map((r) => r.id))
  activeModulesCache = { ids, ts: Date.now() }
  return ids
}

export function invalidateModulesCache() {
  activeModulesCache = null
  // Permissões também precisam ser re-resolvidas, pois o filtro de módulos
  // ativos é aplicado dentro de resolvePermissions.
  permCache.clear()
}

export async function resolvePermissions(userId: number, role: string): Promise<ResolvedPerms> {
  const cacheKey = `${userId}:${role}`
  const cached = permCache.get(cacheKey)
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.perms

  // Reforma F1: módulos com active=false somem do retorno para TODOS (inclusive SUPERADMIN).
  // Para reativar: endpoint /admin/modules/list-all (SUPERADMIN-only) lista TUDO.
  const activeIds = await getActiveModuleIds()

  // 1. Permissões default por role
  const rolePerms = await prisma.modulePermission.findMany({ where: { role: role as any } })
  const roleMap = new Map(rolePerms.map(p => [p.moduleId, p]))

  // 2. Overrides por usuário
  const userOverrides = await prisma.userModuleOverride.findMany({ where: { userId } })
  const overrideMap = new Map(userOverrides.map(o => [o.moduleId, o]))

  // 3. Merge: override não-null sobrescreve role default. Scope NÃO é override-able
  // (vem sempre do role — admin gerencia via /module-permissions).
  const result: ResolvedPerms = {}
  for (const mod of MODULE_REGISTRY) {
    if (!activeIds.has(mod.id)) continue   // módulo desligado → some
    const rp = roleMap.get(mod.id)
    const uo = overrideMap.get(mod.id)
    result[mod.id] = {
      canView:   uo?.canView   ?? rp?.canView   ?? false,
      canCreate: uo?.canCreate ?? rp?.canCreate ?? false,
      canEdit:   uo?.canEdit   ?? rp?.canEdit   ?? false,
      canDelete: uo?.canDelete ?? rp?.canDelete ?? false,
      scope:     (rp?.scope as PermScope | undefined) ?? defaultScopeForRole(role),
    }
  }

  permCache.set(cacheKey, { perms: result, ts: Date.now() })
  return result
}

// Default de scope quando admin não configurou explicitamente para a role.
// Casa com a decisão da Reforma de Roles (2026-05-21).
export function defaultScopeForRole(role: string): PermScope {
  if (role === 'SUPERADMIN' || role === 'ADMIN') return 'all'
  if (role === 'MANAGER') return 'team'
  if (role === 'AGENT') return 'own'
  return 'team' // VIEWER e fallback
}

export function invalidatePermCache(userId?: number) {
  if (userId) {
    for (const key of permCache.keys()) {
      if (key.startsWith(`${userId}:`)) permCache.delete(key)
    }
  } else {
    permCache.clear()
  }
}

function methodToAction(method: string): Action {
  switch (method) {
    case 'POST': return 'create'
    case 'PUT': case 'PATCH': return 'edit'
    case 'DELETE': return 'delete'
    default: return 'view'
  }
}

// Rotas cuja ação derivada do método HTTP não reflete o impacto real.
// Gerenciar as TAGS de um lead (adicionar/remover, inclusive em massa) é
// EDITAR o lead — não criar nem EXCLUIR o lead. Sem este override, a rota
// resolve para o módulo 'leads' (prefixo /api/leads casa antes de /api/tags)
// e remover tag (DELETE) exigiria canDelete em 'leads', a mesma permissão
// que apaga o lead inteiro (DELETE /api/leads/:id). Ver routes/tags.ts.
const ACTION_OVERRIDES: { test: RegExp; action: Action }[] = [
  { test: /^\/api\/leads\/\d+\/tags(\/\d+)?$/, action: 'edit' },
  { test: /^\/api\/leads\/bulk\/tags$/, action: 'edit' },
]

function resolveAction(method: string, pathOnly: string): Action {
  const ov = ACTION_OVERRIDES.find(o => o.test.test(pathOnly))
  return ov ? ov.action : methodToAction(method)
}

function checkAction(perms: ModulePerms, action: Action): boolean {
  switch (action) {
    case 'view': return perms.canView
    case 'create': return perms.canCreate
    case 'edit': return perms.canEdit
    case 'delete': return perms.canDelete
    default: return false
  }
}

// Middleware factory para rotas específicas
export function requireModule(moduleId: string, action?: Action) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const user = (req as any).user as JwtPayload
    if (!user) return reply.code(401).send({ error: 'Autenticação necessária' })
    if (user.role === 'SUPERADMIN') return

    const perms = await resolvePermissions(user.userId, user.role)
    const modPerms = perms[moduleId]
    const act = action || methodToAction(req.method)

    if (!modPerms || !checkAction(modPerms, act)) {
      return reply.code(403).send({ error: 'Sem permissão para este módulo', module: moduleId, action: act })
    }
  }
}

// Modo de operação do gate global (`MODULE_GATE_MODE` no .env):
//
//   'warn'           → loga decisões mas NUNCA bloqueia (modo observação,
//                      padrão seguro pra deploy em produção)
//   'enforce-mapped' → bloqueia rotas mapeadas (active + permission), mas
//                      deixa rotas SEM mapping no MODULE_REGISTRY passarem
//                      (intermediário — pega o impacto das principais sem
//                      arriscar quebrar rotas que ainda não estão catalogadas)
//   'enforce-strict' → bloqueia tudo, inclusive rotas unmapped (modo final
//                      após validar cobertura do MODULE_REGISTRY)
//
// Por compat com o nome antigo, `enforcementEnabled=true` ainda existe
// (mantém comportamento "enforce" historicamente assumido, mas o gate
// só age quando o hook consegue resolver o user — vide modulePermissionHook).
export type GateMode = 'warn' | 'enforce-mapped' | 'enforce-strict'
const GATE_MODE: GateMode = (() => {
  const v = (process.env.MODULE_GATE_MODE || '').toLowerCase()
  if (v === 'enforce-strict') return 'enforce-strict'
  if (v === 'enforce-mapped') return 'enforce-mapped'
  return 'warn'  // default seguro
})()
let currentMode: GateMode = GATE_MODE

export function getGateMode(): GateMode { return currentMode }
export function setGateMode(m: GateMode) { currentMode = m }

// Legados pra back-compat com chamadas existentes
let enforcementEnabled = true
export function enableEnforcement() { enforcementEnabled = true }
export function isEnforcementEnabled() { return enforcementEnabled }

// Endpoints de gerenciamento de módulo que NÃO devem ser gateados pelo módulo em si
// (senão admin não consegue ativar/configurar um módulo que ainda não tem permissões).
// Esses endpoints têm sua própria proteção via authMiddleware/adminOnly.
const HOOK_BYPASS_PATHS = new Set<string>([
  '/api/admin/educacional/status',
  '/api/admin/educacional/toggle',
  '/api/admin/educacional/seed',
  '/api/admin/educacional/seed/funnel',
  '/api/admin/modules',
  // Auth + sistema (precisam funcionar para QUALQUER user autenticado, independente
  // de permissão em módulos — senão login quebra)
  '/api/admin/login',
  '/api/admin/logout',
  '/api/admin/refresh',
  '/api/admin/forgot-password',
  '/api/admin/reset-password',
  '/api/admin/me',
  '/api/admin/me/work-status',
  '/api/admin/heartbeat',
  '/api/admin/my-permissions',
  '/api/admin/module-permissions',
])

// Prefixos liberados — qualquer rota que comece com algum desses passa direto.
// Inclui:
//   - rotas públicas (forms embedados, pixel, tracking público, formulários
//     servidos a anônimos)
//   - webhooks externos (Meta, WhatsApp Cloud, Evolution, payment providers)
//   - API pública v1 (autenticada por API Key, não JWT)
//   - WebSocket
//   - upload de chat/portal públicos
//   - prefixo do /api/admin/modules/ (gerenciamento de toggle, controle próprio)
const HOOK_BYPASS_PREFIXES = [
  '/api/admin/modules/',
  // Públicos / externos
  '/api/forms/submit/',
  '/api/forms/config/',
  '/api/forms/embed/',
  '/api/pixel/',
  '/api/t/',                                  // tracking público
  '/api/v1/',                                 // API pública v1 (autentica por API Key)
  '/api/ws',                                  // WebSocket upgrade
  '/api/whatsapp/webhook',                    // webhook Evolution
  '/api/cloud-api/webhook',                   // webhook Meta Cloud
  '/api/meta/webhook',                        // webhook Meta Ads
  '/api/webhooks/incoming/',                  // webhooks de entrada (inbound)
  '/api/inbound/',                            // payloads de provider externo
  '/api/payment-webhook/',                    // webhooks payment providers
  '/api/public/',                             // qualquer endpoint público
  '/api/chatbots/public/',                    // chatbot embedável
  '/api/chatbots/embed/',                     // mesmo
  '/api/bychat/chat/',                        // chat público do widget (lead anônimo)
  '/api/emergency-unblock',                   // bypass de emergência
  '/api/oauth/instagram/callback',            // OAuth Meta callback (sem JWT)
  '/api/meta/oauth/callback',                 // idem
  // Endpoint público de aparência (landing page)
  '/api/appearance',
  // Endpoint público de inbound webhook
  '/api/lead-import',                         // se houver alguma rota
  // Área do candidato (portal de matrículas público) — sessão própria, sem JWT do CRM
  '/api/candidate/',
  // Make.com — endpoints da integração, autenticados por token Make específico
  '/api/make/',
]

// Endpoints self-service de conexão Google do PRÓPRIO operador (status/conectar/
// desconectar a conta dele). Operam só sobre a conexão kind=OPERATOR do user, e são
// pré-requisito de vários módulos que consomem Google (Agenda/scheduling, Google).
// Pela rota eles caem no módulo `google`, então um agente com a Agenda liberada mas
// SEM o módulo `google` tomava 403 ao clicar em "Conectar Google". Liberamos quando o
// user tem acesso (canView) a QUALQUER um desses módulos.
const GOOGLE_SELF_CONNECT_PATHS = new Set<string>([
  '/api/integrations/google/me',
  '/api/integrations/google/auth-url',
  '/api/integrations/google/disconnect',
])
const GOOGLE_SELF_CONNECT_MODULES = ['google', 'scheduling']

// Leitura das DEFINIÇÕES de campos personalizados (GET) é usada pelo operador
// para ver/preencher os campos no lead. Resolve para o módulo administrativo
// 'settings' (prefixo /api/custom-fields), mas quem só trabalha leads não deve
// precisar de acesso a Configurações. Liberada a quem tem 'Ver' em Leads.
// Criar/editar/excluir definições (POST/PUT/DELETE) continua em 'settings'.
const CUSTOM_FIELDS_READ_PATHS = new Set<string>([
  '/api/custom-fields',
  '/api/custom-fields/all',
])
const CUSTOM_FIELDS_READ_MODULES = ['leads']

// Tenta resolver o user a partir do Bearer token DIRETAMENTE no hook global,
// sem depender do `authMiddleware` da rota (que é preHandler de ROTA — roda
// DEPOIS deste preHandler global e portanto deixaria `req.user` indefinido).
//
// Não interrompe se o token for inválido — deixa o `authMiddleware` da rota
// retornar 401 quando essa rota o exigir. Setamos `req.user` se token válido
// para evitar parse JWT duplicado downstream.
function resolveUserFromRequest(req: FastifyRequest): JwtPayload | null {
  const existing = (req as any).user as JwtPayload | undefined
  if (existing) return existing
  const auth = req.headers.authorization
  if (!auth || !auth.startsWith('Bearer ')) return null
  const token = auth.slice(7)
  try {
    const payload = jwt.verify(token, JWT_SECRET) as JwtPayload
    ;(req as any).user = payload  // cache no request pra rotas downstream
    return payload
  } catch {
    return null  // authMiddleware da rota lidará com isso
  }
}

export async function modulePermissionHook(req: FastifyRequest, reply: FastifyReply) {
  // Cobre TODAS as rotas /api/* (não só admin/bychat) — descoberto que
  // 161 endpoints estavam fora do escopo antigo (/api/atendimento, /api/tags,
  // /api/templates, /api/loss-reasons, /api/forms, /api/leads/:id/attachments,
  // /api/activities, /api/saved-filters, /api/applied-filter, /api/cloud-api,
  // /api/whatsapp, /api/instagram, /api/telegram, /api/meta, /api/pages,
  // /api/tracking, /api/integrations, /api/oauth, /api/custom-fields,
  // /api/teams, /api/chatbots etc).
  if (!req.url.startsWith('/api/')) return

  // Strip query string para comparar com a whitelist
  const pathOnly = req.url.split('?')[0]
  if (HOOK_BYPASS_PATHS.has(pathOnly)) return
  if (HOOK_BYPASS_PREFIXES.some(p => pathOnly.startsWith(p))) return

  // Resolve user (do req.user existente, ou direto do JWT)
  const user = resolveUserFromRequest(req)
  if (!user) return  // rota pública ou auth inválida — não é nossa responsabilidade

  const mode = getGateMode()
  const mod = getModuleForRoute(req.url)

  // CHECK 1: módulo ativo? (em warn, só loga; em enforce-*, bloqueia)
  if (mod) {
    try {
      const activeIds = await getActiveModuleIds()
      if (!activeIds.has(mod.id)) {
        const msg = `[gate] inactive-module ${user.email} (${user.role}) ${req.method} ${req.url} → module=${mod.id}`
        if (mode === 'warn') {
          console.log(msg + ' [WARN-ONLY, request continued]')
        } else {
          console.warn(msg + ' [BLOCKED 404]')
          return reply.code(404).send({ error: 'Módulo não disponível', module: mod.id })
        }
      }
    } catch (err) {
      // Erro lendo DB de módulos — fail-open só pra esse check (a checagem de
      // permissão abaixo ainda roda e pode bloquear)
      console.error('[gate] Failed to check module active state:', (err as Error).message)
    }
  }

  if (user.role === 'SUPERADMIN') return

  // CHECK 2: rota mapeada? Se não, comportamento depende do modo.
  if (!mod) {
    const msg = `[gate] unmapped-route ${user.email} (${user.role}) ${req.method} ${req.url}`
    if (mode === 'enforce-strict') {
      console.warn(msg + ' [BLOCKED 403]')
      return reply.code(403).send({ error: 'Sem permissão' })
    } else {
      // warn ou enforce-mapped: deixa passar (rota não catalogada NÃO é tratada
      // como "deny by default" — só `enforce-strict` faz isso, após cobertura
      // do MODULE_REGISTRY estar madura)
      console.log(msg + ' [WARN-ONLY, request continued]')
      return
    }
  }

  // CHECK 3: permissão do user no módulo
  try {
    const perms = await resolvePermissions(user.userId, user.role)
    const modPerms = perms[mod.id]
    const act = resolveAction(req.method, pathOnly)

    // Self-service de conexão Google: basta ter acesso a um módulo que usa Google
    // (Agenda ou Google). Conecta/desconecta só a conta do próprio operador.
    if (GOOGLE_SELF_CONNECT_PATHS.has(pathOnly) && GOOGLE_SELF_CONNECT_MODULES.some(m => perms[m]?.canView)) {
      return
    }

    // Leitura de campos personalizados: basta 'Ver' em Leads (não exige Configurações).
    if (req.method === 'GET' && CUSTOM_FIELDS_READ_PATHS.has(pathOnly) && CUSTOM_FIELDS_READ_MODULES.some(m => perms[m]?.canView)) {
      return
    }

    if (!modPerms || !checkAction(modPerms, act)) {
      const msg = `[gate] denied ${user.email} (${user.role}) ${req.method} ${req.url} → module=${mod.id} action=${act}`
      if (mode === 'warn') {
        console.log(msg + ' [WARN-ONLY, request continued]')
      } else {
        console.warn(msg + ' [BLOCKED 403]')
        return reply.code(403).send({ error: 'Sem permissão', module: mod.id, action: act })
      }
    }
  } catch (err) {
    // Fail-closed: se Redis/DB falhar, nega acesso
    console.error('[gate] Permission check failed — denying access:', (err as Error).message)
    return reply.code(503).send({ error: 'Serviço temporariamente indisponível' })
  }
}
