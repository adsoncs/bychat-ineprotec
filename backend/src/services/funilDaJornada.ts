// src/services/funilDaJornada.ts
//
// De-para entre as etapas da jornada do portal e as etapas do funil do lead
// (Portais › Etapas › "No funil"). Cada etapa da jornada aponta para uma etapa
// do funil: é onde o lead fica ENQUANTO o candidato está nela; quando todas
// terminam, vale a de "concluído".
//
// Regras:
//   · só mexe em lead que está no funil do portal (movido para outro funil à
//     mão, ninguém puxa de volta);
//   · lead numa etapa do próprio de-para acompanha a jornada (mesmo que a
//     próxima etapa fique antes no funil); lead que a equipe moveu para fora
//     do de-para só anda para a frente; da etapa de concluído não volta;
//   · passa pelo moveLeadStage: histórico, LeadStageMovement e o gatilho
//     lead.stage_changed, como uma mudança feita no kanban.

import { prisma } from '../lib/prisma.js'
import { eventBus } from '../lib/eventBus.js'
import { moveLeadStage } from './leadStageMove.js'
import { etapasDaInscricao, lerJornada, ROTULO, type ChaveEtapa } from './portalJornada.js'

export async function sincronizarFunilDaInscricao(
  registrationId: number,
  opts: { simular?: boolean; mapa?: Record<string, string>; /** Só na simulação: etapa atual hipotética do lead. */ statusDoLead?: string } = {},
): Promise<{ moved: boolean; para?: string; motivo?: string }> {
  const reg = await prisma.enrollmentRegistration.findUnique({
    where: { id: registrationId },
    select: {
      id: true, candidateCode: true, leadId: true, mergedIntoId: true,
      portal: { select: { id: true, nome: true, funnelId: true, jornadaEtapas: true } },
      lead: { select: { status: true, funnelId: true } },
    },
  })
  if (!reg?.leadId || !reg.lead || !reg.portal || reg.mergedIntoId) return { moved: false, motivo: 'sem lead/portal' }
  const mapa: Record<string, string | undefined> = opts.mapa ?? lerJornada(reg.portal.jornadaEtapas).funil ?? {}
  if (!Object.keys(mapa).length) return { moved: false, motivo: 'portal sem de-para' }

  const funnelId = reg.portal.funnelId ?? reg.lead.funnelId
  if (!funnelId || reg.lead.funnelId !== funnelId) return { moved: false, motivo: 'lead fora do funil do portal' }

  const j = await etapasDaInscricao(registrationId, 'inscricao')
  if (!j) return { moved: false, motivo: 'sem etapas' }
  // Onde o candidato está: a primeira etapa ainda não concluída (na ordem do portal).
  const atual = j.etapas.find((e) => e.situacao !== 'feito')
  const chave: ChaveEtapa | 'concluido' = atual ? atual.chave : 'concluido'
  const destino = mapa[chave]
  if (!destino) return { moved: false, motivo: `etapa "${chave}" sem etapa do funil` }

  const stages = await prisma.stage.findMany({ where: { funnelId, active: true }, select: { key: true, name: true, position: true } })
  const alvo = stages.find((s) => s.key === destino)
  if (!alvo) return { moved: false, motivo: `etapa do funil "${destino}" não existe no funil` }
  const agora = stages.find((s) => s.key === (opts.simular && opts.statusDoLead ? opts.statusDoLead : reg.lead!.status))
  if (agora?.key === alvo.key) return { moved: false, motivo: 'lead já está nessa etapa' }
  // Lead numa etapa do próprio de-para: acompanha a jornada, mesmo que a etapa
  // seguinte fique antes no funil (ex.: análise → "Documentos", depois
  // pagamento → "Pagamento"). Da etapa de concluído ele não volta. Fora do
  // de-para (a equipe moveu à mão), só anda para a frente.
  const doDePara = new Set(Object.values(mapa).filter(Boolean) as string[])
  const final = mapa.concluido
  if (agora) {
    if (agora.key === final) return { moved: false, motivo: 'lead já na etapa de concluído' }
    if (!doDePara.has(agora.key) && agora.position >= alvo.position) return { moved: false, motivo: 'lead movido à mão para etapa à frente' }
  }

  const titulo = atual ? (atual.titulo || ROTULO[atual.chave]) : 'todas as etapas concluídas'
  if (opts.simular) return { moved: false, para: alvo.name, motivo: `simulação: iria de "${agora?.name ?? reg.lead.status}" para "${alvo.name}" (etapa atual: ${titulo})` }
  const r = await moveLeadStage({
    leadId: reg.leadId,
    toStageKey: alvo.key,
    source: 'portal_jornada',
    reason: atual
      ? `Inscrição ${reg.candidateCode} na etapa "${titulo}" (portal ${reg.portal.nome})`
      : `Inscrição ${reg.candidateCode}: todas as etapas concluídas (portal ${reg.portal.nome})`,
    metadata: { registrationId: reg.id, candidateCode: reg.candidateCode, portalId: reg.portal.id, etapa: chave },
  })
  return { moved: r.moved, para: alvo.name }
}

/** Dispara sem esperar e sem derrubar quem chamou. */
export function sincronizarFunil(registrationId: number | null | undefined): void {
  if (!registrationId) return
  sincronizarFunilDaInscricao(registrationId).catch((e) => console.warn('[funilDaJornada] falhou:', e?.message || e))
}

/**
 * Eventos de inscrição (pagamento confirmado, documento aprovado/recusado,
 * parecer emitido, redação enviada, avaliação completa...) recalculam a etapa.
 * Os pontos sem evento chamam `sincronizarFunil` direto.
 */
let ligado = false
export function ligarFunilDaJornada(): void {
  if (ligado) return
  ligado = true
  eventBus.on('*', async (event: any) => {
    if (typeof event?.type !== 'string' || !event.type.startsWith('enrollment.')) return
    const code = event.payload?.candidateCode
    const id = Number(event.payload?.registrationId) || null
    try {
      const reg = id ? { id } : code ? await prisma.enrollmentRegistration.findUnique({ where: { candidateCode: String(code) }, select: { id: true } }) : null
      if (reg) await sincronizarFunilDaInscricao(reg.id)
    } catch (e: any) {
      console.warn('[funilDaJornada] evento', event.type, 'falhou:', e?.message || e)
    }
  })
}

/** Aplica o de-para a todas as inscrições ativas do portal (botão no painel). */
export async function sincronizarFunilDoPortal(portalId: number): Promise<{ total: number; movidos: number }> {
  const regs = await prisma.enrollmentRegistration.findMany({
    where: { portalId, mergedIntoId: null, leadId: { not: null }, status: { notIn: ['cancelled', 'rejected'] } },
    select: { id: true },
    take: 2000,
  })
  let movidos = 0
  for (const r of regs) {
    const x = await sincronizarFunilDaInscricao(r.id).catch(() => ({ moved: false }))
    if (x.moved) movidos++
  }
  return { total: regs.length, movidos }
}
