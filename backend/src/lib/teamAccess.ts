// src/lib/teamAccess.ts
// Helpers de controle de acesso a leads baseado em equipes/atribuição.
//
// Reforma F1 (2026-05-21): regras agora derivadas de ModulePermission.scope
// para o módulo 'leads'. Defaults por role (quando admin não configurou):
//   SUPERADMIN / ADMIN  → scope='all' (tudo)
//   MANAGER             → scope='team' (setores do user)
//   AGENT               → scope='own' (só os atribuídos a si)
//   VIEWER              → scope='team' (mas canView=false por default no módulo)

import { prisma } from './prisma.js'
import { resolvePermissions, defaultScopeForRole, type PermScope } from './permissions.js'

export type AccessRole = 'SUPERADMIN' | 'ADMIN' | 'MANAGER' | 'AGENT' | 'VIEWER' | string

export function isAdminRole(role: AccessRole): boolean {
  return role === 'SUPERADMIN' || role === 'ADMIN'
}

// Resolve scope efetivo do usuário no módulo 'leads'. Centraliza a lógica
// para que listagens (atendimento/tickets, bychat/leads, kanban) e checagens
// individuais (canUserAccessLead) usem a mesma fonte.
export async function getLeadScope(userId: number, role: AccessRole): Promise<PermScope> {
  // SUPERADMIN sempre 'all' — não passa por resolvePermissions.
  if (role === 'SUPERADMIN') return 'all'
  try {
    const perms = await resolvePermissions(userId, role)
    return perms['leads']?.scope ?? defaultScopeForRole(role)
  } catch {
    return defaultScopeForRole(role)
  }
}

/** IDs das equipes às quais o usuário pertence (apenas equipes ativas). */
export async function getUserTeamIds(userId: number): Promise<number[]> {
  const memberships = await prisma.teamMember.findMany({
    where: { userId, team: { active: true } },
    select: { teamId: true },
  })
  return memberships.map(m => m.teamId)
}

/** IDs das equipes em que o usuário é líder. */
export async function getUserLeaderTeamIds(userId: number): Promise<number[]> {
  const memberships = await prisma.teamMember.findMany({
    where: { userId, isLeader: true, team: { active: true } },
    select: { teamId: true },
  })
  return memberships.map(m => m.teamId)
}

/** True se o usuário é líder do setor informado. */
export async function isTeamLeader(userId: number, teamId: number): Promise<boolean> {
  const membership = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId } },
    select: { isLeader: true },
  })
  return !!membership?.isLeader
}

/**
 * Constrói cláusula `where` Prisma para listagem de leads conforme acesso do usuário.
 * Baseado em ModulePermission.scope do módulo 'leads' (Reforma F1):
 *   - scope='all'   → sem restrição (admin/superadmin)
 *   - scope='team'  → leads dos setores do user + leads atribuídos a si
 *                     (cobre o caso do manager que também atende)
 *   - scope='own'   → apenas leads.assignedUserId == userId
 *
 * Combine com outras cláusulas via Prisma `AND`.
 */
export async function buildLeadAccessWhere(userId: number, role: AccessRole): Promise<any> {
  const scope = await getLeadScope(userId, role)
  if (scope === 'all') return {}
  if (scope === 'own') return { assignedUserId: userId }
  // 'team': leads dos setores do user OU atribuídos a si (cobre líder que atende).
  const teamIds = await getUserTeamIds(userId)
  return {
    OR: [
      { assignedUserId: userId },
      ...(teamIds.length > 0 ? [{ teamId: { in: teamIds } }] : []),
    ],
  }
}

/**
 * Verifica se o usuário pode acessar/operar um lead específico.
 * Use antes de mutações sensíveis (enviar mensagem, transferir, encerrar).
 * Reforma F1: respeita ModulePermission.scope do módulo 'leads'.
 */
export async function canUserAccessLead(
  userId: number,
  role: AccessRole,
  leadId: number,
): Promise<boolean> {
  const scope = await getLeadScope(userId, role)
  if (scope === 'all') return true

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { assignedUserId: true, teamId: true },
  })
  if (!lead) return false

  // Sempre permite o dono do lead, independente de scope (cobre transferências
  // que migraram lead pra setor que o user não participa).
  if (lead.assignedUserId === userId) return true
  if (scope === 'own') return false

  // scope === 'team'
  if (lead.teamId == null) return false
  const teamIds = await getUserTeamIds(userId)
  return teamIds.includes(lead.teamId)
}
