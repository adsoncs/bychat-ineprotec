// src/services/ganhoComPendencia.ts
//
// Ganho só com a jornada concluída (chave routing.ganhoExigeJornada).
//
// Reclamação do time (fabad, 22/10): 14 de 29 leads marcados Ganho tinham
// inscrição com etapas pendentes — documentos em 13, contrato em 7 —, todos
// marcados à mão (botão Ganho ou arrasto para "Matriculado") logo depois do
// pagamento. O sistema só marca sozinho quando a jornada inteira acaba.
//
// Com a chave ligada, toda marcação HUMANA de Ganho (botão, lote, arrasto ou
// troca de etapa para a etapa de Ganho, proposta aceita) de um lead que tem
// inscrição aberta sem nenhuma concluída é recusada com 409 e a lista do que
// falta; com justificativa, passa — e a justificativa vai para o histórico do
// lead e para a auditoria de quem marcou. Lead sem inscrição não muda nada.

import { prisma } from '../lib/prisma.js'
import { getAjustesRoteamento } from './teamRouting.js'

/**
 * O que falta para o lead estar "matriculado": null quando pode marcar Ganho
 * (chave desligada, sem inscrição aberta, ou alguma inscrição concluída).
 */
export async function pendenciasDoGanho(leadId: number): Promise<string[] | null> {
  const ajustes = await getAjustesRoteamento()
  if (!ajustes.ganhoExigeJornada) return null
  const regs = await prisma.enrollmentRegistration.findMany({
    where: { leadId, mergedIntoId: null, status: { notIn: ['cancelled', 'rejected', 'merged', 'expired'] } },
    select: { id: true, candidateCode: true },
  })
  if (!regs.length) return null
  const { etapasDaInscricao } = await import('./portalJornada.js')
  const faltas: string[] = []
  for (const r of regs) {
    const j = await etapasDaInscricao(r.id, 'inscricao').catch(() => null)
    if (!j) continue
    const pend = j.etapas.filter((e: any) => e.situacao !== 'feito' && !e.liberada)
    if (!pend.length) return null // uma inscrição concluída basta
    faltas.push(`${r.candidateCode}: falta ${pend.map((e: any) => String(e.titulo || e.chave).toLowerCase()).join(', ')}`)
  }
  return faltas.length ? faltas : null
}

/** A etapa é a de Ganho do funil? */
export async function ehEtapaDeGanho(funnelId: number | null | undefined, stageKey: string | null | undefined): Promise<boolean> {
  if (!funnelId || !stageKey) return false
  const s = await prisma.stage.findFirst({ where: { funnelId, key: stageKey }, select: { terminalKind: true } })
  return s?.terminalKind === 'won'
}

export function respostaDePendencia(pendencias: string[]) {
  return {
    error: 'Este lead ainda não concluiu a jornada da inscrição. Para marcar Ganho mesmo assim, explique o motivo.',
    precisaJustificativa: true,
    titulo: 'Marcar Ganho com etapas pendentes?',
    motivo: pendencias.join(' | '),
  }
}

/** Ganho com pendência justificado: nota e evento no lead, auditoria de quem marcou. */
export async function registrarGanhoJustificado(leadId: number, quem: { userId?: number | null; nome?: string | null }, justificativa: string, pendencias: string[]): Promise<void> {
  const texto = `Ganho marcado com etapas pendentes (${pendencias.join('; ')}). Justificativa: ${justificativa}`
  await prisma.leadNote.create({ data: { leadId, userId: quem.userId ?? null, userName: quem.nome || 'Usuário', content: texto } }).catch(() => {})
  const { logEvent } = await import('./leadHistory.js')
  logEvent({ leadId, type: 'won_with_pending', category: 'lifecycle', title: 'Ganho com etapas pendentes (justificado)', description: texto, actorType: 'operator', userId: quem.userId ?? undefined, userName: quem.nome ?? undefined, metadata: { pendencias, justificativa } } as any)
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { nome: true } })
  const { logUserAudit } = await import('./userAudit.js')
  await logUserAudit({
    action: 'lead.ganho_com_pendencia', actorId: quem.userId ?? null, actorName: quem.nome ?? null,
    targetType: 'lead', targetLabel: `#${leadId} ${lead?.nome ?? ''}`.slice(0, 191),
    changes: { pendencias, justificativa },
  })
}

/** Justificativa válida vinda do corpo da requisição (mínimo de 10 caracteres). */
export function justificativaDoCorpo(body: unknown): string | null {
  const j = String((body as any)?.justificativa ?? '').trim()
  return j.length >= 10 ? j : null
}
