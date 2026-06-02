// Vagas ocupadas (CourseOffering) — derivadas do funil.
// Uma ProcessRegistration ocupa vaga sse o Lead vinculado está numa Stage
// com consumesSlot=true. Inscrição em si não consome; só Pagou Taxa em diante.
// Mover lead para Desistente devolve a vaga.

import { prisma } from '../lib/prisma.js'
import { Prisma } from '@prisma/client'

export type OfferingSlotCount = { totalInscricoes: number; vagasOcupadas: number }

export async function getOfferingSlotCounts(offeringIds: number[]): Promise<Map<number, OfferingSlotCount>> {
  const out = new Map<number, OfferingSlotCount>()
  if (offeringIds.length === 0) return out
  const rows = await prisma.$queryRaw<Array<{ offeringId: number; totalInscricoes: bigint; vagasOcupadas: bigint }>>`
    SELECT
      r.offeringId AS offeringId,
      COUNT(*) AS totalInscricoes,
      SUM(CASE WHEN s.consumesSlot = 1 THEN 1 ELSE 0 END) AS vagasOcupadas
    FROM bychat_edu_process_registrations r
    LEFT JOIN bychat_leads l ON l.id = r.leadId
    LEFT JOIN bychat_stages s ON s.funnelId = l.funnelId AND s.\`key\` = l.status
    WHERE r.offeringId IN (${Prisma.join(offeringIds)})
    GROUP BY r.offeringId
  `
  for (const r of rows) {
    out.set(Number(r.offeringId), {
      totalInscricoes: Number(r.totalInscricoes ?? 0),
      vagasOcupadas: Number(r.vagasOcupadas ?? 0),
    })
  }
  return out
}

// Valida que mover o lead para uma Stage que consome vaga não estoura o limite
// das ofertas em que ele está inscrito. Só checa quando a etapa atual NÃO
// consumia (ou seja, é uma transição de "não ocupa" → "ocupa"). Retorna a
// mensagem de erro se faltar vaga em alguma oferta, ou null se ok.
export async function validateLeadAcquiresSlot(leadId: number): Promise<string | null> {
  const regs = await prisma.processRegistration.findMany({
    where: { leadId },
    select: {
      offering: { select: { id: true, nome: true, vagasMaximas: true } },
    },
  })
  const limited = regs.filter(r => r.offering?.vagasMaximas && r.offering.vagasMaximas > 0)
  if (limited.length === 0) return null

  const counts = await getOfferingSlotCounts(limited.map(r => r.offering!.id))
  for (const r of limited) {
    const o = r.offering!
    const ocupadas = counts.get(o.id)?.vagasOcupadas ?? 0
    if (ocupadas + 1 > (o.vagasMaximas ?? 0)) {
      return `Sem vagas: a oferta "${o.nome}" tem ${o.vagasMaximas} vagas, todas ocupadas.`
    }
  }
  return null
}
