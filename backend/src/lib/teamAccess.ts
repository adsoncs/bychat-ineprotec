// src/lib/teamAccess.ts
// Helpers de controle de acesso a leads baseado em equipes/atribuição.
//
// Reforma F1 (2026-05-21): regras agora derivadas de ModulePermission.scope
// para o módulo 'leads'. Defaults por role (quando admin não configurou):
//   SUPERADMIN / ADMIN  → scope='all' (tudo)
//   MANAGER             → scope='team' (setores do user)
//   AGENT               → scope='own' (só os atribuídos a si; o líder de um
//                         setor vê também os leads do setor — whereProprioOuLider)
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
  if (scope === 'own') return whereProprioOuLider(userId)
  // 'team': leads dos setores do user OU atribuídos a si (cobre líder que atende).
  return { OR: [{ assignedUserId: userId }, ...await ramosDoSetor(userId)] }
}

/**
 * Alcance 'own' ("só meus"): os leads atribuídos a si — e, para o LÍDER de um
 * setor, todos os leads desse setor. Regra pedida em 21/10/2026: "o líder vê
 * tudo, o membro vê só o seu". Quem não lidera setor nenhum fica como antes.
 */
export async function whereProprioOuLider(userId: number): Promise<any> {
  const lider = await getUserLeaderTeamIds(userId)
  return lider.length
    ? { OR: [{ assignedUserId: userId }, { teamId: { in: lider } }] }
    : { assignedUserId: userId }
}

/**
 * O que o alcance 'team' alcança nos setores do usuário — ramos de `OR` Prisma,
 * sem o "atribuído a si" (o chamador junta).
 *
 * Setor comum: todas as conversas dele. Setor com `conversasPrivadas`: só a
 * fila sem dono — a conversa de um colega não aparece, nem em lista, busca,
 * contador ou tempo real; chega a quem a recebe por transferência, porque aí
 * ele vira o dono. O líder do setor continua vendo tudo, como num setor comum:
 * é quem distribui e acompanha.
 *
 * Tudo que decide visibilidade por setor passa por aqui ou pela checagem
 * equivalente em `canUserAccessLead` — uma regra só para lista e conversa.
 */
export async function ramosDoSetor(userId: number): Promise<any[]> {
  const memberships = await prisma.teamMember.findMany({
    where: { userId, team: { active: true } },
    select: { teamId: true, isLeader: true, team: { select: { conversasPrivadas: true } } },
  })
  const abertos = memberships.filter((m) => !m.team.conversasPrivadas || m.isLeader).map((m) => m.teamId)
  const privados = memberships.filter((m) => m.team.conversasPrivadas && !m.isLeader).map((m) => m.teamId)
  return [
    ...(abertos.length ? [{ teamId: { in: abertos } }] : []),
    ...(privados.length ? [{ teamId: { in: privados }, assignedUserId: null }] : []),
  ]
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
  if (scope === 'own') {
    // Líder do setor do lead vê o setor inteiro, mesmo com alcance "só meus".
    if (lead.teamId == null) return false
    const membro = await prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: lead.teamId, userId } },
      select: { isLeader: true, team: { select: { active: true } } },
    })
    return !!membro?.isLeader && membro.team.active
  }

  // scope === 'team' — mesma régua de `ramosDoSetor`.
  if (lead.teamId == null) return false
  const membro = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId: lead.teamId, userId } },
    select: { isLeader: true, team: { select: { active: true, conversasPrivadas: true } } },
  })
  if (!membro || !membro.team.active) return false
  if (membro.team.conversasPrivadas && !membro.isLeader) return lead.assignedUserId == null
  return true
}
