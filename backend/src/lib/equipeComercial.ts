// src/lib/equipeComercial.ts
//
// Quem é da EQUIPE COMERCIAL (Team.equipeComercial): as vendas contam para
// ela. Usado no Ganho para escolher o vendedor e na troca de dono para a
// proposta aberta não sair da Vendas quando o lead vai para Financeiro,
// Secretaria etc. ainda em negociação.
//
// Nenhuma equipe marcada = regra antiga (vendedor é quem está com o lead no
// Ganho; a proposta acompanha o dono do lead).

let cache: { ids: Set<number> | null; ts: number } | null = null
const TTL = 60_000

/** Usuários em equipe comercial ativa; null quando nenhuma equipe está marcada. */
export async function usuariosComerciais(): Promise<Set<number> | null> {
  if (cache && Date.now() - cache.ts < TTL) return cache.ids
  // Import tardio: lib/prisma.ts usa este módulo dentro do próprio middleware.
  const { prisma } = await import('./prisma.js')
  const equipes = await prisma.team.findMany({ where: { active: true, equipeComercial: true }, select: { id: true } }).catch(() => null)
  if (!equipes) return cache?.ids ?? null
  let ids: Set<number> | null = null
  if (equipes.length) {
    const membros = await prisma.teamMember.findMany({ where: { teamId: { in: equipes.map((e) => e.id) } }, select: { userId: true } })
    ids = new Set(membros.map((m) => m.userId))
  }
  cache = { ids, ts: Date.now() }
  return ids
}

export function invalidarEquipeComercial(): void {
  cache = null
}
