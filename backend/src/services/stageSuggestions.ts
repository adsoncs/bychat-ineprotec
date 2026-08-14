// src/services/stageSuggestions.ts
//
// Ciclo de vida das sugestões da Jornada Automática por IA.
//
// O problema que este módulo resolve: uma sugestão nasce retratando o lead num
// instante ("mova de Novo contato para Em atendimento") e depois o mundo anda —
// o chatbot roteia, o operador arrasta no kanban, um fluxo move a etapa. Antes,
// só uma nova análise do MESMO lead marcava as pendentes como `superseded`;
// se o lead parava de escrever, a sugestão vencida ficava na tela para sempre,
// dizendo ao operador para fazer o que já estava feito.
//
// Aqui ficam as duas metades da correção:
//   - `supersedePendingSuggestions` — chamada de todo ponto que move um lead;
//   - `pruneStaleSuggestions` — varredura periódica, rede de segurança para
//     qualquer caminho que escreva `lead.status` sem passar pelos anteriores.

import { prisma } from '../lib/prisma.js'

/** Sugestão pendente vira lixo depois disso, mesmo que nada tenha mudado. */
export const SUGGESTION_MAX_AGE_DAYS = 7

export type StaleReason =
  | 'lead_moved'        // o lead saiu da etapa que a sugestão retratava
  | 'already_there'     // o lead já está na etapa sugerida
  | 'backwards'         // sugere etapa anterior à atual
  | 'funnel_changed'    // o lead mudou de funil
  | 'lead_closed'       // o lead chegou a uma etapa terminal (ganho/perdido)
  | 'stage_gone'        // a etapa sugerida não existe mais ou foi desativada
  | 'expired'           // velha demais para ainda descrever a conversa

const REASON_LABEL: Record<StaleReason, string> = {
  lead_moved: 'o lead mudou de etapa depois desta análise',
  already_there: 'o lead já está na etapa sugerida',
  backwards: 'sugeria uma etapa anterior à atual',
  funnel_changed: 'o lead mudou de funil',
  lead_closed: 'o lead foi encerrado (ganho/perdido)',
  stage_gone: 'a etapa sugerida não existe mais neste funil',
  expired: `sem decisão por mais de ${SUGGESTION_MAX_AGE_DAYS} dias`,
}

/**
 * Invalida as sugestões pendentes de um lead. Chamada por quem move o lead —
 * o movimento torna qualquer sugestão anterior uma fotografia velha.
 *
 * Não lança: invalidar sugestão nunca pode derrubar a movimentação em si.
 */
export async function supersedePendingSuggestions(
  leadId: number,
  reason: StaleReason = 'lead_moved',
): Promise<number> {
  try {
    const { count } = await prisma.leadStageSuggestion.updateMany({
      where: { leadId, status: 'pending' },
      data: {
        status: 'superseded',
        decisionNote: `[auto] Invalidada: ${REASON_LABEL[reason]}.`,
        decidedAt: new Date(),
      },
    })
    return count
  } catch {
    return 0
  }
}

interface StageInfo { key: string; position: number; active: boolean; terminalKind: string | null }

/**
 * Decide se uma sugestão pendente ainda faz sentido diante do estado ATUAL do
 * lead. `null` = continua válida.
 *
 * Sobre `backwards`: tratamos regressão como inválida por princípio — o funil é
 * monotônico neste produto (`moveLeadStage` tem `forwardOnly` justamente por
 * isso). Quem precisa devolver um lead a uma etapa anterior faz isso à mão, com
 * intenção; não é decisão que a IA deva tomar a partir de um histórico que ela
 * leu fora de ordem.
 */
export function staleReasonFor(
  suggestion: { suggestedStageKey: string | null; kind: string; funnelId: number; createdAt: Date },
  lead: { status: string | null; funnelId: number | null },
  stagesByKey: Map<string, StageInfo>,
): StaleReason | null {
  const ageDays = (Date.now() - suggestion.createdAt.getTime()) / 86_400_000
  if (ageDays > SUGGESTION_MAX_AGE_DAYS) return 'expired'
  if (lead.funnelId !== suggestion.funnelId) return 'funnel_changed'

  const current = lead.status ? stagesByKey.get(lead.status) : undefined
  if (current?.terminalKind) return 'lead_closed'

  // 'not_in_funnel' não aponta etapa: só envelhece, muda de funil ou fecha.
  if (suggestion.kind === 'not_in_funnel' || !suggestion.suggestedStageKey) return null

  if (suggestion.suggestedStageKey === lead.status) return 'already_there'

  const target = stagesByKey.get(suggestion.suggestedStageKey)
  if (!target || !target.active) return 'stage_gone'
  if (current && target.position < current.position) return 'backwards'

  return null
}

/**
 * Varre as pendentes e invalida as que não descrevem mais o lead. Roda no tick
 * da Jornada IA e é idempotente — o que já está `superseded` não é revisitado.
 *
 * Devolve a contagem por motivo, que é o que o log mostra.
 */
export async function pruneStaleSuggestions(): Promise<Record<string, number>> {
  const pending = await prisma.leadStageSuggestion.findMany({
    where: { status: 'pending' },
    select: {
      id: true, leadId: true, funnelId: true, suggestedStageKey: true, kind: true, createdAt: true,
      lead: { select: { status: true, funnelId: true } },
    },
  })
  if (!pending.length) return {}

  // Etapas de todos os funis envolvidos, num só SELECT.
  const funnelIds = [...new Set(pending.map(s => s.funnelId))]
  const stages = await prisma.stage.findMany({
    where: { funnelId: { in: funnelIds } },
    select: { funnelId: true, key: true, position: true, active: true, terminalKind: true },
  })
  const byFunnel = new Map<number, Map<string, StageInfo>>()
  for (const s of stages) {
    if (!byFunnel.has(s.funnelId)) byFunnel.set(s.funnelId, new Map())
    byFunnel.get(s.funnelId)!.set(s.key, { key: s.key, position: s.position, active: s.active, terminalKind: s.terminalKind })
  }

  const byReason = new Map<StaleReason, number[]>()
  for (const s of pending) {
    if (!s.lead) continue
    const reason = staleReasonFor(s, s.lead, byFunnel.get(s.funnelId) ?? new Map())
    if (!reason) continue
    if (!byReason.has(reason)) byReason.set(reason, [])
    byReason.get(reason)!.push(s.id)
  }

  const counts: Record<string, number> = {}
  for (const [reason, ids] of byReason) {
    const { count } = await prisma.leadStageSuggestion.updateMany({
      where: { id: { in: ids } },
      data: {
        status: 'superseded',
        decisionNote: `[auto] Invalidada: ${REASON_LABEL[reason]}.`,
        decidedAt: new Date(),
      },
    })
    counts[reason] = count
  }
  return counts
}
