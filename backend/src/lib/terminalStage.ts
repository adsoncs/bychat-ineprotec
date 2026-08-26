// src/lib/terminalStage.ts
//
// Etapa de desfecho do funil: `Stage.terminalKind` = 'won' | 'lost' | null.
//
// Vive aqui porque a etapa entra por DUAS portas — `POST /api/admin/stages` e
// `POST /api/admin/funnels/:id/stages` — e uma validação copiada nas duas é uma
// validação que um dia vai valer só numa.

import { prisma } from './prisma.js'

export type TerminalKind = 'won' | 'lost'

/** `undefined` = campo ausente no corpo (não mexer); `null` = limpar. */
export function normTerminalKind(v: unknown): TerminalKind | null | undefined {
  if (v === undefined) return undefined
  if (v === null || v === '') return null
  return v === 'won' || v === 'lost' ? v : undefined
}

/**
 * Só UMA etapa de cada tipo por funil, e a trava é aqui porque quem lê o campo
 * não tolera duas: `funnelConversion` faz `stages.find(s => s.terminalKind === 'won')`
 * e contaria só a primeira, subnotificando vendas em silêncio; o auto-move do
 * `leadOutcome` pega a de menor posição e mandaria o lead para uma etapa que
 * talvez não seja a que o admin tinha em mente.
 *
 * Devolve a mensagem do conflito, ou null quando está livre.
 */
export async function conflitoTerminalKind(
  funnelId: number,
  kind: TerminalKind,
  ignoreStageId?: number,
): Promise<string | null> {
  const existente = await prisma.stage.findFirst({
    where: { funnelId, terminalKind: kind, ...(ignoreStageId ? { id: { not: ignoreStageId } } : {}) },
    select: { name: true },
  })
  if (!existente) return null
  const rotulo = kind === 'won' ? 'Ganho' : 'Perdido'
  return `A etapa "${existente.name}" já é a de ${rotulo} neste funil. Desmarque-a antes.`
}
