// src/services/meetingReminderJob.ts
//
// Gatilho de Workflow "Lembrete de reunião" (`meeting.reminder`): X horas antes
// do início de cada reunião agendada ou confirmada.
//
// Este job NÃO envia nada. Ele só emite o evento de domínio; quem decide se, o
// que e por onde mandar é o Workflow configurado na UX (regra: nenhum aviso ao
// contato mora no código). Sem Workflow ativo com esse gatilho, não faz nada.
//
// Os intervalos vêm dos próprios Workflows (`triggerConfig.hoursBefore`), então
// "1 dia antes" e "2 horas antes" são dois fluxos, cada um com o seu modelo.
//
// Uma vez por (intervalo, horário da reunião): o controle fica em
// `booking.remindersSent`, com a chave `<horas>h@<startAt>`. Remarcar muda o
// startAt e o lembrete volta a valer para o horário novo. Reunião criada já
// dentro do intervalo (ex.: marcada 1h antes) não recebe o lembrete daquele
// intervalo — a confirmação do agendamento acabou de chegar.
import { prisma } from '../lib/prisma.js'
import { eventBus } from '../lib/eventBus.js'

const TICK_MS = 5 * 60 * 1000
/** Atraso máximo aceito para emitir (servidor parado, deploy): além disso, pula. */
const TOLERANCIA_MS = 30 * 60 * 1000
let _timer: NodeJS.Timeout | null = null

function horasDoGatilho(cfg: unknown): number | null {
  const c = (typeof cfg === 'string' ? (() => { try { return JSON.parse(cfg) } catch { return null } })() : cfg) as any
  const h = Number(c?.hoursBefore)
  return Number.isFinite(h) && h > 0 && h <= 24 * 14 ? h : null
}

function fmt(d: Date, tz: string, o: Intl.DateTimeFormatOptions): string {
  try { return new Intl.DateTimeFormat('pt-BR', { timeZone: tz, ...o }).format(d) } catch { return d.toISOString() }
}

export async function varrerLembretesDeReuniao(): Promise<number> {
  const workflows = await prisma.workflow.findMany({
    where: { active: true, triggerEvent: 'meeting.reminder' },
    select: { triggerConfig: true },
  })
  const intervalos = [...new Set(workflows.map((w) => horasDoGatilho(w.triggerConfig)).filter((h): h is number => h != null))]
  if (!intervalos.length) return 0

  const agora = Date.now()
  const base = (process.env.APP_URL || '').replace(/\/$/, '')
  let emitidos = 0
  for (const horas of intervalos) {
    const ms = horas * 3600_000
    // Reuniões cujo momento do lembrete (início − X horas) já chegou, com folga.
    const reservas = await prisma.booking.findMany({
      where: {
        status: { in: ['scheduled', 'confirmed'] },
        leadId: { not: null },
        startAt: { gt: new Date(agora), lte: new Date(agora + ms), gte: new Date(agora + ms - TOLERANCIA_MS) },
      },
      take: 200,
    })
    for (const b of reservas) {
      if (b.createdAt.getTime() > b.startAt.getTime() - ms) continue // marcada já dentro do intervalo
      const chave = `${horas}h@${b.startAt.toISOString()}`
      const enviados = ((b.remindersSent as Record<string, string> | null) ?? {})
      if (enviados[chave]) continue
      // Marca antes de emitir: se dois processos rodarem juntos, só um passa.
      const marcou = await prisma.booking.updateMany({
        where: { id: b.id, updatedAt: b.updatedAt },
        data: {
          remindersSent: { ...enviados, [chave]: new Date().toISOString() },
          // O lembrete pede confirmação ("Confirmar presença"): sem isto a
          // resposta do contato não confirma a reserva.
          ...(b.confirmRequestedAt ? {} : { confirmRequestedAt: new Date() }),
        },
      })
      if (marcou.count === 0) continue

      const mt = await prisma.meetingType.findUnique({ where: { id: b.meetingTypeId }, select: { name: true, funnelId: true, locationDetail: true } })
      const atendente = b.operatorUserId
        ? await prisma.user.findUnique({ where: { id: b.operatorUserId }, select: { name: true } }).catch(() => null)
        : null
      const tz = b.timezone || 'America/Sao_Paulo'
      eventBus.emitDomain({
        type: 'meeting.reminder',
        leadId: b.leadId!,
        ...(mt?.funnelId ? { funnelId: mt.funnelId } : {}),
        payload: {
          hoursBefore: horas,
          bookingId: b.id,
          meetingTypeId: b.meetingTypeId,
          meetingTypeName: mt?.name ?? '',
          startAt: b.startAt.toISOString(),
          status: b.status,
          // Variáveis prontas para modelos e mensagens: {{data_reuniao}} etc.
          data_reuniao: fmt(b.startAt, tz, { day: '2-digit', month: '2-digit' }),
          dia_semana: fmt(b.startAt, tz, { weekday: 'long' }),
          hora_reuniao: fmt(b.startAt, tz, { hour: '2-digit', minute: '2-digit' }),
          quando: fmt(b.startAt, tz, { dateStyle: 'full', timeStyle: 'short' }),
          atendente: (atendente?.name || '').split(' ')[0] || '',
          local: mt?.locationDetail || '',
          token_reserva: b.token,
          link_remarcar: base ? `${base}/agendar/remarcar/${b.token}` : '',
          link_cancelar: base ? `${base}/agendar/cancelar/${b.token}` : '',
          metadata: { meetingTypeName: mt?.name ?? '' },
        },
        timestamp: new Date(),
      })
      emitidos++
    }
  }
  return emitidos
}

export function startMeetingReminderJob(): void {
  if (_timer) return
  const tick = async () => {
    try {
      const n = await varrerLembretesDeReuniao()
      if (n > 0) console.log(`[meeting-reminder] ${n} lembrete(s) emitido(s) para os fluxos`)
    } catch (e: any) {
      console.warn(`[meeting-reminder] varredura falhou: ${e?.message}`)
    }
  }
  setTimeout(tick, 60_000)
  _timer = setInterval(tick, TICK_MS)
}
