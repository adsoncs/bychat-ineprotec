// src/services/stageOutcome.ts
//
// Mover o lead para a etapa de desfecho marca Ganho/Perdido sozinho.
//
// `Stage.terminalKind` existia funcionando numa direção só: classificar o lead
// movia ele para a etapa. O caminho de volta — que é o que o time faz o dia
// inteiro, arrastar o card para "Matriculado" — não marcava nada. Resultado no
// severiano, medido em 26/08: 54 leads numa etapa terminal sem outcome, sendo
// 46 perdas. O Relatório de Funil conta pela ETAPA e os dashboards contam pelo
// OUTCOME, então os dois discordavam em silêncio, cada um convincente sozinho.
//
// É chamada EXPLICITAMENTE em cada ponto que escreve etapa, e não pendurada no
// evento `lead.stage_changed`, apesar de o listener ser mais bonito. Dois
// motivos concretos: `formFlow.moveLeadStage` (formulário, chatbot roteirizado,
// Jornada IA) não emite evento nenhum, e ficaria de fora sem ninguém notar; e
// `leadStageMove.moveLeadStage` emite DUAS vezes (via `logEvent` e via
// `emitDomain`), então um listener rodaria em dobro. Chamada explícita é uma
// linha a mais em cada lugar e nenhuma surpresa.
//
// Vale para qualquer origem — painel, lote, fluxo, chatbot. A etapa terminal é
// uma declaração do admin sobre o que aquela etapa SIGNIFICA; se o bot mandou o
// lead para "Perdido", o lead está perdido. Quem não quer isso não marca a
// etapa como terminal.

import { prisma } from '../lib/prisma.js'
import { markLeadWon, markLeadLost } from './leadOutcome.js'

export interface ApplyStageOutcomeInput {
  leadId: number
  /** Etapa de destino. Null/vazio = nada a fazer. */
  toStageKey?: string | null
  /** Funil de destino; quando omitido, lê o do lead. */
  funnelId?: number | null
  /** De onde veio o movimento — entra na nota do desfecho. */
  origem?: string
  userId?: number | null
  userName?: string
}

/**
 * Devolve o desfecho aplicado, ou null quando não havia o que aplicar (etapa
 * comum, etapa sem `terminalKind`, ou lead já classificado assim).
 */
export async function applyStageOutcome(input: ApplyStageOutcomeInput): Promise<'won' | 'lost' | null> {
  const { leadId, toStageKey, origem = 'panel', userId, userName } = input
  if (!toStageKey) return null

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, funnelId: true, outcome: true },
  })
  if (!lead) return null

  const funnelId = input.funnelId ?? lead.funnelId
  if (funnelId == null) return null

  const stage = await prisma.stage.findFirst({
    where: { funnelId, key: toStageKey },
    select: { terminalKind: true, name: true },
  })
  const kind = stage?.terminalKind
  if (kind !== 'won' && kind !== 'lost') return null

  // Já classificado assim: não refaz. Sem esta guarda, `markLeadWon` — que por
  // sua vez move o lead para a etapa terminal — reentraria aqui, e cada volta
  // redispara o feedback de qualidade para a Meta e o evento de conversão.
  if (lead.outcome === kind) return null

  const nota = `Automático: entrou na etapa "${stage?.name ?? toStageKey}" (${origem})`
  if (kind === 'won') {
    await markLeadWon({ leadId, note: nota, userId: userId ?? undefined, userName })
  } else {
    // Sem motivo de perda: no automático não há quem escolha, e chutar uma
    // objeção contamina a única estatística de perda que o cliente tem. Fica
    // em branco de propósito — o relatório mostra "sem motivo", que é a verdade.
    await markLeadLost({ leadId, note: nota, userId: userId ?? undefined, userName })
  }
  return kind
}
