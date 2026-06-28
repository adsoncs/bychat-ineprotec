// src/services/enrollmentCode.ts
// Geração de candidateCode por portal, com transação p/ evitar colisão.
// Formato: {PREFIX}-{YY}-{SEQ6}-{RAND4}   ex: MAT-26-000147-K7QF
// O sufixo aleatório (≈20 bits) impede enumeração sequencial do código — o
// código de inscrição é metade do segredo de login do candidato (a outra é o CPF).

import crypto from 'crypto'
import { prisma } from '../lib/prisma.js'

// Alfabeto sem caracteres ambíguos (0/O, 1/I) para evitar erro de digitação.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
function randomSuffix(len = 4): string {
  let out = ''
  for (let i = 0; i < len; i++) {
    out += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]
  }
  return out
}

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
  return `${result.codePrefix || 'MAT'}-${year}-${seq}-${randomSuffix()}`
}
