// src/services/routing/helpers.ts
// Utilitários compartilhados pelo módulo Lead Routing.

import { prisma } from '../../lib/prisma.js'

// Lead Routing F7: ao mudar o responsável do lead, propaga para as Activities
// pendentes geradas por cadência. Compartilhado entre /atendimento (assign/claim/
// release) e o cron de escalação (F8) — evita duplicação.
//
// Marker: userName='cadência' (hardcoded em cadenceScheduler.createActivityForManualStep).
// Só status pending/overdue — concluídas/canceladas/enviadas ficam no histórico.
export async function reassignPendingCadenceActivities(
  leadId: number,
  newUserId: number | null,
): Promise<number> {
  const result = await prisma.activity.updateMany({
    where: {
      leadId,
      status: { in: ['pending', 'overdue'] },
      userName: 'cadência',
    },
    data: { userId: newUserId },
  })
  return result.count
}

// Lead Routing F10: marca firstResponseAt na primeira ação efetiva do agente
// atribuído. Idempotente — só seta se ainda for null E o ator for o assignedUser
// (filtros aplicados via updateMany, sem race condition).
//
// "Ação efetiva" hoje = caller decide. Atualmente plugado em:
//   - PATCH /api/activities/:id quando status muda para completed.
// Pontos futuros: envio outbound (cloud-api / evolution) e operator viewed.
export async function markFirstResponseIfNeeded(
  leadId: number,
  operatorUserId: number,
): Promise<boolean> {
  const result = await prisma.lead.updateMany({
    where: {
      id: leadId,
      firstResponseAt: null,
      assignedUserId: operatorUserId,
    },
    data: { firstResponseAt: new Date() },
  })
  return result.count > 0
}
