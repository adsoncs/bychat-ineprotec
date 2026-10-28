// src/lib/activityStatus.ts
// Regras únicas de "atividade em aberto", "atrasada" e "de quem é".
//
// O scheduler de atividades troca pending → overdue 30 min depois do horário.
// Toda consulta que olhava só `status: 'pending'` passava a ignorar as
// atrasadas de verdade: a aba Atrasadas mostrava só a janela de 30 min, o
// Ganho/Perdido não cancelava as vencidas e a escada do Resumo não subia.
// Qualquer consulta de atividade em aberto deve usar estas regras.

import type { Prisma } from '@prisma/client'

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
export function whereActivityOwnedBy(userId: number): Prisma.ActivityWhereInput {
  return {
    OR: [
      { assignedUserId: userId },
      { assignedUserId: null, assignedTeamId: null, userId },
      { assignedUserId: null, assignedTeamId: null, userId: null, lead: { assignedUserId: userId } },
    ],
  }
}

/** Fila sem dono: designada a um setor sem pessoa, ou sem ninguém em lugar nenhum. */
export const whereActivityUnowned: Prisma.ActivityWhereInput = {
  assignedUserId: null,
  OR: [
    { assignedTeamId: { not: null } },
    { userId: null, lead: { assignedUserId: null } },
  ],
}
