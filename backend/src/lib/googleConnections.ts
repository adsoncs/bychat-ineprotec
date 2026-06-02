// src/lib/googleConnections.ts
// Roteamento Google híbrido B:
//   - Recursos pessoais (Calendar, Tasks, Gmail) → conexão do operador
//   - Recursos da empresa (Drive, Sheets) → conexão kind=COMPANY
//   - Sem conexão do operador → fallback para a conexão da empresa

import { prisma } from './prisma.js'

export type ResolvedConnection = {
  connectionId: number
  email: string
  source: 'operator' | 'company'
}

export async function resolveOperatorConnection(userId: number | null | undefined): Promise<ResolvedConnection | null> {
  if (userId) {
    const op = await prisma.googleConnection.findFirst({
      where: { userId, active: true, kind: 'OPERATOR' },
      select: { id: true, email: true },
    })
    if (op) return { connectionId: op.id, email: op.email, source: 'operator' }
  }
  const co = await prisma.googleConnection.findFirst({
    where: { kind: 'COMPANY', active: true },
    select: { id: true, email: true },
  })
  if (co) return { connectionId: co.id, email: co.email, source: 'company' }
  return null
}

export async function resolveCompanyConnection(): Promise<ResolvedConnection | null> {
  const co = await prisma.googleConnection.findFirst({
    where: { kind: 'COMPANY', active: true },
    select: { id: true, email: true },
  })
  return co ? { connectionId: co.id, email: co.email, source: 'company' } : null
}
