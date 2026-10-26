// src/services/oportunidadeAutomatica.ts
//
// Abertura automática de oportunidade em outro funil.
//
// O caso: o aluno foi GANHO no funil de vendas e volta a falar — com a
// Secretaria, o Financeiro. Ele precisa aparecer no funil de quem vai atendê-lo
// sem sair de "Venda ganha" no funil de vendas (é o histórico da venda) e sem
// virar outra ficha (que contaria como lead novo nos relatórios de marketing).
//
// A equipe que atende diz em qual funil/etapa esse card nasce
// (`Team.oportunidadeFunnelId/StageKey`, desligado = null). O gatilho é a TROCA
// DE EQUIPE do lead ganho, por qualquer caminho — transferência, menu do
// chatbot, workflow, jornada de IA, número da conexão. São 16 pontos no código
// que gravam `Lead.teamId`; em vez de instrumentar cada um, o middleware do
// Prisma (lib/prisma.ts) chama `aoTrocarDeEquipe` depois da gravação.

import { prisma } from '../lib/prisma.js'
import { adicionarAoFunil } from './leadFunnels.js'

export interface EquipeAntes {
  id: number
  teamId: number | null
}

/** Chamado depois que leads mudaram de equipe. Nunca lança: é efeito colateral. */
export async function aoTrocarDeEquipe(antes: EquipeAntes[]): Promise<void> {
  if (!antes.length) return
  try {
    const leads = await prisma.lead.findMany({
      where: { id: { in: antes.map((a) => a.id) }, outcome: 'won' },
      select: { id: true, teamId: true, assignedUserId: true, funnelId: true },
    })
    const anterior = new Map(antes.map((a) => [a.id, a.teamId]))
    const mudaram = leads.filter((l) => l.teamId && l.teamId !== anterior.get(l.id))
    if (!mudaram.length) return

    const equipes = await prisma.team.findMany({
      where: { id: { in: [...new Set(mudaram.map((l) => l.teamId!))] }, oportunidadeFunnelId: { not: null } },
      select: { id: true, name: true, oportunidadeFunnelId: true, oportunidadeStageKey: true },
    })
    const daEquipe = new Map(equipes.map((t) => [t.id, t]))

    for (const lead of mudaram) {
      const equipe = daEquipe.get(lead.teamId!)
      if (!equipe?.oportunidadeFunnelId) continue
      // Funil da equipe já é o principal (ex.: o lead foi MOVIDO para lá): nada a abrir.
      if (equipe.oportunidadeFunnelId === lead.funnelId) continue
      // Já tem card aberto nesse funil: só passa a ser desta equipe.
      const ativo = await prisma.leadFunnel.findFirst({
        where: { leadId: lead.id, funnelId: equipe.oportunidadeFunnelId, saiuEm: null },
        select: { id: true, outcome: true },
      })
      if (ativo && !ativo.outcome) {
        await prisma.leadFunnel.update({
          where: { id: ativo.id },
          data: { teamId: equipe.id, assignedUserId: lead.assignedUserId ?? null },
        })
        continue
      }
      // Card fechado (atendimento anterior já concluído): um novo atendimento
      // reabre o card na etapa de entrada.
      if (ativo) {
        await prisma.leadFunnel.update({ where: { id: ativo.id }, data: { saiuEm: new Date() } })
      }
      const r = await adicionarAoFunil({
        leadId: lead.id,
        funnelId: equipe.oportunidadeFunnelId,
        stageKey: equipe.oportunidadeStageKey,
        origem: 'auto_equipe',
        teamId: equipe.id,
        assignedUserId: lead.assignedUserId ?? null,
      })
      if (!r.ok) console.warn(`[oportunidade] lead ${lead.id} → equipe ${equipe.name}: ${r.erro}`)
    }
  } catch (e: any) {
    console.error('[oportunidade] abertura automática falhou:', e?.message || e)
  }
}
