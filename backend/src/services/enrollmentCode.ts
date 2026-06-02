// src/services/enrollmentCode.ts
// Geração de candidateCode sequencial por portal, com transação p/ evitar colisão.
// Formato: {PREFIX}-{YY}-{SEQ6}   ex: MAT-26-000147

import { prisma } from '../lib/prisma.js'

export async function generateCandidateCode(portalId: number): Promise<string> {
  // Transação com UPDATE + SELECT no mesmo row atualizando codeSequence
  const result = await prisma.$transaction(async (tx) => {
    const portal = await tx.enrollmentPortal.update({
      where: { id: portalId },
      data: { codeSequence: { increment: 1 } },
      select: { codePrefix: true, codeSequence: true },
    })
    return portal
  })
  const year = new Date().getFullYear().toString().slice(-2)
  const seq = String(result.codeSequence).padStart(6, '0')
  return `${result.codePrefix || 'MAT'}-${year}-${seq}`
}
