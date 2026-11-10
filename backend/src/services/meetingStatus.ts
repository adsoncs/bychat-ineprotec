// src/services/meetingStatus.ts
//
// O que acontece DEPOIS que uma reunião muda de estado (confirmada, realizada,
// não compareceu, cancelada), venha a mudança de onde vier: botão da agenda,
// alerta de desfecho, gravação do bot, link público de cancelamento ou o
// "Confirmar presença" do contato.
//
// Duas coisas, ambas configuráveis na UX:
//   1. Etapa do funil — o tipo de reunião diz para onde o lead vai quando a
//      reunião é realizada (`stageOnCompleted`) ou quando o contato falta
//      (`stageOnNoShow`). Só move quem ainda está na etapa do agendamento ou
//      numa das etapas de desfecho: um lead que já avançou (proposta,
//      matriculado) nunca é puxado de volta por uma baixa atrasada.
//   2. Evento de domínio (`meeting.confirmed|completed|no_show|cancelled`) —
//      qualquer mensagem ao contato depois disso é decisão de um Workflow,
//      nunca deste código.
import { prisma } from '../lib/prisma.js'
import { eventBus } from '../lib/eventBus.js'
import { etapaExisteNoFunil } from '../lib/etapaDoFunil.js'

export type MeetingStatusChange = 'confirmed' | 'completed' | 'no_show' | 'cancelled'

export async function aoMudarStatusDaReuniao(bookingId: number, status: MeetingStatusChange, source = 'scheduling'): Promise<void> {
  try {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, leadId: true, meetingTypeId: true, startAt: true, operatorUserId: true },
    })
    if (!booking) return
    const mt = await prisma.meetingType.findUnique({
      where: { id: booking.meetingTypeId },
      select: { id: true, name: true, funnelId: true, stageKey: true, stageOnCompleted: true, stageOnNoShow: true },
    })
    if (!mt) return

    let movedTo: string | null = null
    const destino = status === 'completed' ? mt.stageOnCompleted : status === 'no_show' ? mt.stageOnNoShow : null
    if (booking.leadId && destino) {
      const lead = await prisma.lead.findUnique({ where: { id: booking.leadId }, select: { status: true, funnelId: true } })
      const etapasDaReuniao = [mt.stageKey, mt.stageOnCompleted, mt.stageOnNoShow].filter(Boolean)
      const mesmoFunil = !mt.funnelId || lead?.funnelId === mt.funnelId
      // Etapa de desfecho que o funil do lead não tem: não move (o lead sumiria do quadro).
      const destinoExiste = !!lead && (await etapaExisteNoFunil(lead.funnelId, destino))
      if (lead && !destinoExiste) console.warn(`[reuniao] etapa ${destino} não existe no funil ${lead.funnelId}; lead ${booking.leadId} fica onde está`)
      if (lead && destinoExiste && mesmoFunil && lead.status && etapasDaReuniao.includes(lead.status) && lead.status !== destino) {
        const { moveLeadStage } = await import('./leadStageMove.js')
        const r = await moveLeadStage({
          leadId: booking.leadId,
          toStageKey: destino,
          source,
          reason: status === 'completed' ? `${mt.name} realizada` : `${mt.name}: não compareceu`,
          metadata: { bookingId: booking.id },
        })
        if (r.moved) movedTo = destino
      }
    }

    if (booking.leadId) {
      eventBus.emitDomain({
        type: `meeting.${status}`,
        leadId: booking.leadId,
        ...(mt.funnelId ? { funnelId: mt.funnelId } : {}),
        payload: {
          bookingId: booking.id,
          meetingTypeId: mt.id,
          startAt: booking.startAt.toISOString(),
          operatorUserId: booking.operatorUserId,
          movedToStage: movedTo,
          metadata: { meetingTypeName: mt.name, source },
        },
        timestamp: new Date(),
      })
    }
  } catch (e: any) {
    console.warn(`[reuniao] pós-status ${status} da reserva ${bookingId} falhou: ${e?.message}`)
  }
}
