// src/services/negotiationOutcomeSync.ts
//
// Classificar o lead fecha a proposta dele.
//
// O caminho existia só numa direção: fechar a negociação (`POST /negotiations/
// :id/close`) marcava o lead. Marcar o lead — pelo botão Ganho, pelo Resumo, ou
// agora por arrastar o card para a etapa de desfecho — não tocava na proposta.
// Resultado: aluno matriculado, negociação eternamente "em negociação", KPIs de
// receita fechada em R$ 0,00 e comissão sem base. No severiano eram 20 assim.
//
// ── A regra assimétrica, e por que ────────────────────────────────────────────
//
// PERDA fecha todas as propostas abertas do lead: nenhuma soma receita, então
// não há risco em fechar demais.
//
// GANHO fecha automaticamente APENAS quando há uma única proposta aberta. Com
// duas ou mais, o sistema não tem como saber quais foram aceitas — e no
// severiano essas duplas não são versões da mesma proposta, são coisas
// diferentes debaixo do mesmo responsável: "Proposta LORENZO" e "Proposta
// BERNARDO" (dois filhos), "1º ano" e "2º ano 2027" (dois períodos). A mãe pode
// ter matriculado os dois ou só um. Fechar as duas inventa receita que ninguém
// vendeu; escolher uma no chute erra metade das vezes. Então o lead é marcado
// como ganho e as propostas ficam para o operador — a sonda de funil acusa como
// "negociação em aberto de lead já fechado" no dia seguinte, que é o lugar
// certo para um humano decidir.

import { prisma } from '../lib/prisma.js'
import { logEvent, EVENT_TYPES } from './leadHistory.js'

export interface SyncResult {
  fechadas: number
  /** Propostas deixadas em aberto por ambiguidade (ganho com 2+). */
  ambiguas: number
}

export async function syncNegotiationsWithLeadOutcome(
  leadId: number,
  outcome: 'won' | 'lost',
  opts: { userId?: number | null; lostReasonId?: number | null; nota?: string } = {},
): Promise<SyncResult> {
  const abertas = await prisma.negotiation.findMany({
    where: { leadId, resultado: null },
    select: { id: true, titulo: true, valorFinal: true, valorRecorrente: true, valorUnico: true },
    orderBy: { id: 'asc' },
  }).catch(() => [])
  if (abertas.length === 0) return { fechadas: 0, ambiguas: 0 }

  if (outcome === 'won' && abertas.length > 1) {
    // Não decide no lugar do operador — mas deixa o rastro, senão a escolha
    // pendente só existiria na cabeça de quem viu a sonda.
    logEvent({
      leadId,
      type: EVENT_TYPES.STATUS_CHANGED,
      category: 'lifecycle',
      title: `${abertas.length} propostas em aberto — nenhuma foi fechada automaticamente`,
      source: 'system',
      actorType: 'system',
      description: 'O lead foi marcado como Ganho, mas há mais de uma proposta aberta '
        + '(alunos ou períodos diferentes). Abra a aba Negociação e feche a que foi aceita.',
      metadata: { negotiationIds: abertas.map((n) => n.id), motivo: 'ambiguidade' },
    })
    return { fechadas: 0, ambiguas: abertas.length }
  }

  const agora = new Date()
  let fechadas = 0
  for (const n of abertas) {
    await prisma.negotiation.update({
      where: { id: n.id },
      data: {
        resultado: outcome,
        status: outcome === 'won' ? 'aceita' : 'recusada',
        fechadaEm: agora,
        fechadaPor: opts.userId ?? null,
        ...(outcome === 'lost' && opts.lostReasonId ? { lostReasonId: opts.lostReasonId } : {}),
      },
    })
    fechadas++

    // Lança (ou desfaz) a comissão desta venda. Mesmo passo da rota /close — sem
    // ele a negociação fecha e o mês do agente não fica sabendo.
    const { onNegotiationChanged } = await import('./commissions.js')
    await onNegotiationChanged(n.id).catch((e) =>
      console.warn(`[negotiationSync] comissão da negociação ${n.id}:`, (e as Error).message))
  }

  // Ganho com proposta única: o valor dela é o valor da venda. É o que faz a
  // "Receita ganha" aparecer sem ninguém digitar nada — mesma regra da rota
  // /close. Só preenche se ainda estiver vazio, para não sobrescrever um valor
  // que alguém informou na mão.
  if (outcome === 'won' && fechadas === 1) {
    const valor = abertas[0]!.valorFinal
    if (valor != null) {
      await prisma.lead.updateMany({
        where: { id: leadId, saleValue: null },
        data: { saleValue: valor, saleDetected: true },
      })
    }
  }

  if (fechadas > 0) {
    logEvent({
      leadId,
      type: outcome === 'won' ? EVENT_TYPES.LEAD_WON : EVENT_TYPES.LEAD_LOST,
      category: 'lifecycle',
      title: fechadas === 1
        ? `Proposta "${abertas[0]!.titulo}" fechada como ${outcome === 'won' ? 'ganha' : 'perdida'}`
        : `${fechadas} propostas fechadas como ${outcome === 'won' ? 'ganhas' : 'perdidas'}`,
      source: 'system',
      actorType: opts.userId ? 'operator' : 'system',
      userId: opts.userId ?? undefined,
      description: opts.nota,
      metadata: { negotiationIds: abertas.map((n) => n.id), viaLeadOutcome: true },
    })
  }

  return { fechadas, ambiguas: 0 }
}
