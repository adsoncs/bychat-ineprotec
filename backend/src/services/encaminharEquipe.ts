// src/services/encaminharEquipe.ts
//
// Manda um lead para uma equipe. Equipe e funil andam juntos: sem funil
// explícito, o lead vai para o funil da equipe (Team.funnelId), na primeira
// etapa. Usado pelos encaminhamentos automáticos — setor escolhido na Jornada
// IA, destino provisório (fallback) e transferência por falta de resposta.
//
// Responsável: se a equipe muda, o rodízio da equipe nova escolhe a pessoa
// (sem ninguém elegível, o lead fica na fila do setor). Na mesma equipe, quem
// já é dono continua — salvo quando a rota aponta responsáveis (`userIds`) e o
// dono atual não está entre eles.

import { prisma } from '../lib/prisma.js'
import { comoEncaminhamentoDeEquipe } from '../lib/donoDoLead.js'
import { escolherOperadorDaRota } from './teamRouting.js'
import { moveLeadStage } from './formFlow.js'

export interface DestinoDeEquipe {
  teamId: number
  funnelId?: number | null
  stageKey?: string | null
  userIds?: unknown
}

export interface ResultadoDoEnvio {
  teamId: number
  funnelId: number | null
  userId: number | null
  trocouEquipe: boolean
}

async function primeiraEtapa(funnelId: number): Promise<string | null> {
  const st = await prisma.stage.findFirst({ where: { funnelId, active: true }, orderBy: { position: 'asc' }, select: { key: true } })
  return st?.key ?? null
}

export async function enviarParaEquipe(leadId: number, destino: DestinoDeEquipe, origem = 'chatbot'): Promise<ResultadoDoEnvio | null> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { teamId: true, assignedUserId: true, funnelId: true } })
  if (!lead) return null
  const team = await prisma.team.findUnique({ where: { id: destino.teamId }, select: { id: true, active: true, funnelId: true } })
  if (!team?.active) return null

  // Funil: o da rota; senão o da equipe. Etapa: a da rota; senão a primeira do
  // funil — mas só quando o lead troca de funil (no mesmo funil, sem etapa
  // pedida, ele fica onde está).
  const funnelId = destino.funnelId ?? team.funnelId ?? null
  if (funnelId != null) {
    const stageKey = destino.stageKey || (lead.funnelId !== funnelId ? await primeiraEtapa(funnelId) : null)
    if (stageKey) await moveLeadStage(leadId, funnelId, stageKey, origem, { forwardOnly: false }).catch(() => {})
  }

  const trocouEquipe = lead.teamId !== team.id
  const responsaveis = Array.isArray(destino.userIds) ? destino.userIds.map(Number).filter((n) => Number.isInteger(n) && n > 0) : []
  const donoForaDaRota = responsaveis.length > 0 && !responsaveis.includes(lead.assignedUserId ?? -1)
  let userId = lead.assignedUserId ?? null

  if (trocouEquipe || donoForaDaRota || userId == null) {
    userId = await escolherOperadorDaRota(team.id, destino.userIds).catch(() => null)
    const data = { teamId: team.id, assignedUserId: userId, assignedAt: new Date() }
    const gravar = () => prisma.lead.update({ where: { id: leadId }, data })
    // Mudou de setor: a troca de responsável é do próprio encaminhamento.
    if (trocouEquipe || donoForaDaRota) await comoEncaminhamentoDeEquipe(gravar).catch(() => {})
    else await gravar().catch(() => {})
  }

  return { teamId: team.id, funnelId, userId, trocouEquipe }
}
