// src/lib/activityStatus.ts
// Regras únicas de "atividade em aberto", "atrasada" e "de quem é".
//
// O scheduler de atividades troca pending → overdue 30 min depois do horário.
// Toda consulta que olhava só `status: 'pending'` passava a ignorar as
// atrasadas de verdade: a aba Atrasadas mostrava só a janela de 30 min, o
// Ganho/Perdido não cancelava as vencidas e a escada do Resumo não subia.
// Qualquer consulta de atividade em aberto deve usar estas regras.

import type { Prisma } from '@prisma/client'
import { prisma } from './prisma.js'
import { isAdminRole, getUserLeaderTeamIds, type AccessRole } from './teamAccess.js'

/** Status de atividade que ainda pede ação. */
export const OPEN_ACTIVITY_STATUSES = ['pending', 'overdue']

export const whereActivityOpen: Prisma.ActivityWhereInput = { status: { in: OPEN_ACTIVITY_STATUSES } }

/** Atrasada = marcada como overdue OU pendente com horário já vencido (dentro da tolerância do scheduler). */
export function whereActivityOverdue(now: Date = new Date()): Prisma.ActivityWhereInput {
  return {
    OR: [
      { status: 'overdue' },
      { status: 'pending', scheduledAt: { lt: now } },
    ],
  }
}

/**
 * Atividades que cabem a `userId` executar.
 * Ordem: responsável designado → quem criou (sem designado e sem setor) →
 * dono do lead (atividade sem ninguém, ex.: importada do Kommo ou criada pela IA).
 */
export function whereActivityOwnedBy(userId: number | number[]): Prisma.ActivityWhereInput {
  const id = Array.isArray(userId) ? { in: userId } : userId
  return {
    OR: [
      { assignedUserId: id },
      { assignedUserId: null, assignedTeamId: null, userId: id },
      { assignedUserId: null, assignedTeamId: null, userId: null, lead: { assignedUserId: id } },
    ],
  }
}

/**
 * O que cada um enxerga em Atividades (regra pedida em 28/10/2026):
 * admin vê todas; líder vê as suas, as dos membros dos setores que lidera e a
 * fila desses setores; os demais (agente, gerente sem setor, visualizador) só
 * as suas. `null` = sem restrição.
 */
export async function whereActivityVisibleTo(userId: number, role: AccessRole): Promise<Prisma.ActivityWhereInput | null> {
  if (isAdminRole(role)) return null
  const lider = await getUserLeaderTeamIds(userId)
  if (!lider.length) return whereActivityOwnedBy(userId)
  const membros = await prisma.teamMember.findMany({ where: { teamId: { in: lider } }, select: { userId: true } })
  const ids = [...new Set([userId, ...membros.map((m) => m.userId)])]
  return { OR: [whereActivityOwnedBy(ids), { assignedTeamId: { in: lider } }] }
}

/** True se a atividade está dentro do que o usuário enxerga. */
export async function canUserSeeActivity(userId: number, role: AccessRole, activityId: number): Promise<boolean> {
  const vis = await whereActivityVisibleTo(userId, role)
  if (!vis) return true
  return (await prisma.activity.count({ where: { id: activityId, AND: [vis] } })) > 0
}

/** Fila sem dono: designada a um setor sem pessoa, ou sem ninguém em lugar nenhum. */
export const whereActivityUnowned: Prisma.ActivityWhereInput = {
  assignedUserId: null,
  OR: [
    { assignedTeamId: { not: null } },
    { userId: null, lead: { assignedUserId: null } },
  ],
}
