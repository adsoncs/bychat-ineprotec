// services/googleCalendarSync.ts
// Sync activities to Google Calendar — roteamento Híbrido B:
//   - Activity criada por operador com Google conectado → calendário do operador
//   - Sem conexão de operador → fallback para integração da empresa (kind=COMPANY)

import { prisma } from '../lib/prisma.js'
import { createCalendarEvent, updateCalendarEvent, deleteCalendarEvent } from '../lib/google.js'

type CachedCalInt = {
  id: number
  connectionId: number
  connectionUserId: number | null
  connectionKind: string
  calendarId: string
  activityTypes: string[]
  autoMeetLink: boolean
  notifyLead: boolean
}

let cached: CachedCalInt[] = []
let cacheAt = 0
const CACHE_TTL = 60_000

async function getActiveIntegrations(): Promise<CachedCalInt[]> {
  if (Date.now() - cacheAt < CACHE_TTL && cached.length > 0) return cached
  const rows = await prisma.googleCalendarIntegration.findMany({
    where: { active: true, connection: { active: true } },
    select: {
      id: true, connectionId: true, calendarId: true,
      activityTypes: true, autoMeetLink: true, notifyLead: true,
      connection: { select: { userId: true, kind: true } },
    },
  })
  cached = rows.map(r => ({
    id: r.id,
    connectionId: r.connectionId,
    connectionUserId: r.connection.userId,
    connectionKind: r.connection.kind,
    calendarId: r.calendarId,
    activityTypes: r.activityTypes as string[],
    autoMeetLink: r.autoMeetLink,
    notifyLead: r.notifyLead,
  }))
  cacheAt = Date.now()
  return cached
}

export function invalidateCalendarCache() {
  cacheAt = 0
}

// Escolhe integrações relevantes para esta activity. A agenda da EMPRESA (COMPANY)
// é a principal — recebe TODOS os agendamentos (visão central). A do OPERADOR dono
// é a secundária/backup. Quando o operador tem conta conectada, grava nas DUAS;
// senão, só na empresa. Sem empresa cadastrada, cai no comportamento antigo
// (só operador). O loop em syncActivityToCalendar já grava em todas as retornadas.
function chooseIntegrationsForUser(all: CachedCalInt[], userId: number | null): CachedCalInt[] {
  const company = all.filter(i => i.connectionKind === 'COMPANY')
  if (userId) {
    const ofUser = all.filter(i => i.connectionUserId === userId && i.connectionKind === 'OPERATOR')
    if (ofUser.length > 0) return [...company, ...ofUser]
  }
  // Sem operador conectado: empresa (se houver); senão nada a sincronizar.
  return company
}

export async function syncActivityToCalendar(activityId: number): Promise<void> {
  try {
    const integrations = await getActiveIntegrations()
    if (integrations.length === 0) return

    const activity = await prisma.activity.findUnique({
      where: { id: activityId },
      select: {
        id: true, type: true, title: true, description: true, userId: true,
        scheduledAt: true, status: true, recipientEmail: true,
        recipientPhone: true, leadId: true, metadata: true,
      },
    })
    if (!activity) return

    const candidates = chooseIntegrationsForUser(integrations, activity.userId ?? null)
    const matched = candidates.filter(i => i.activityTypes.includes(activity.type))
    if (matched.length === 0) return

    const lead = await prisma.lead.findUnique({
      where: { id: activity.leadId },
      select: { id: true, nome: true, empresa: true, email: true, whatsapp: true },
    })

    // Agendamentos (bookings): por configuração, a reunião é criada na agenda CENTRAL
    // (ex.: contato@agenciabeyond.com.br) com o operador dono como convidado — em vez de
    // cair só no calendário do dono. Setting: scheduling.central_calendar_email.
    let targetIntegrations = matched
    const extraAttendees: string[] = []
    const meta0 = (activity.metadata as any) || {}
    if (meta0.bookingId) {
      const setting = await prisma.setting.findUnique({ where: { key: 'scheduling.central_calendar_email' } }).catch(() => null)
      const centralEmail = setting ? String(setting.value).replace(/"/g, '').trim().toLowerCase() : ''
      if (centralEmail) {
        const central = integrations.find((i) => i.calendarId.toLowerCase() === centralEmail && i.activityTypes.includes(activity.type))
        if (central) {
          targetIntegrations = [central]
          if (activity.userId) {
            const owner = await prisma.user.findUnique({ where: { id: activity.userId }, select: { email: true } })
            if (owner?.email) extraAttendees.push(owner.email)
          }
        }
      }
    }

    for (const integration of targetIntegrations) {
      const startTime = Date.now()
      try {
        const start = activity.scheduledAt
        const end = new Date(start.getTime() + 30 * 60_000)

        const attendees: string[] = []
        if (lead?.email) attendees.push(lead.email)
        for (const a of extraAttendees) if (!attendees.includes(a)) attendees.push(a)

        const description = [
          activity.description || '',
          lead ? `\nLead: ${lead.nome || ''} ${lead.empresa ? '(' + lead.empresa + ')' : ''}` : '',
          lead?.whatsapp ? `WhatsApp: ${lead.whatsapp}` : '',
          `\nCriado via ByChat Beyond`,
        ].filter(Boolean).join('\n')

        const result = await createCalendarEvent(integration.connectionId, integration.calendarId, {
          summary: `${activity.title} — ${lead?.nome || 'Lead'}`,
          description,
          start,
          end,
          attendees: integration.notifyLead ? attendees : [],
          addMeetLink: integration.autoMeetLink,
          extendedPrivate: { bychatSource: 'activity', bychatActivityId: String(activityId) },
        })

        const duration = Date.now() - startTime

        const meta = (activity.metadata as any) || {}
        await prisma.activity.update({
          where: { id: activityId },
          data: {
            metadata: {
              ...meta,
              googleCalendarEventId: result.eventId,
              googleMeetLink: result.meetLink || undefined,
              googleCalendarLink: result.htmlLink || undefined,
              googleCalendarConnectionId: integration.connectionId,
            },
          },
        })

        await prisma.calendarSyncLog.create({
          data: {
            integrationId: integration.id,
            activityId: activityId,
            calendarEventId: result.eventId,
            action: 'created',
            success: true,
            duration,
          },
        })

        await prisma.googleCalendarIntegration.update({
          where: { id: integration.id },
          data: { totalSynced: { increment: 1 }, lastSyncAt: new Date(), lastError: null },
        })

        const scope = integration.connectionKind === 'OPERATOR' ? 'op' : 'co'
        console.log(`[Calendar:${scope}] Activity #${activityId} synced → event ${result.eventId} (${duration}ms)${result.meetLink ? ' + Meet link' : ''}`)

        // Para agendamentos (bookings) a confirmação por WhatsApp é feita por notifyBooking
        // (template HSM) — não disparar aqui pra não duplicar nem cair em texto livre.
        if (integration.notifyLead && result.meetLink && lead?.whatsapp && !meta0.bookingId) {
          try {
            // Notificação pelo número do dono do lead (não pelo default da env)
            // pra preservar identidade do operador no histórico do contato.
            const { getProviderForLeadOwner } = await import('./whatsappProvider.js')
            const { provider } = await getProviderForLeadOwner({ id: lead.id, whatsapp: lead.whatsapp })
            const dateStr = start.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
            await provider.sendText(lead.whatsapp, `Ola ${lead.nome || ''}! Uma reuniao foi agendada para *${dateStr}*.\n\nLink do Google Meet: ${result.meetLink}\n\nTe esperamos la!`)
          } catch (err) {
            console.warn('[Calendar] WhatsApp notification failed:', err)
          }
        }

      } catch (err: any) {
        const duration = Date.now() - startTime
        const error = err.message?.substring(0, 500) || 'Unknown error'

        await prisma.calendarSyncLog.create({
          data: {
            integrationId: integration.id,
            activityId: activityId,
            action: 'created',
            success: false,
            error,
            duration,
          },
        }).catch(() => {})

        await prisma.googleCalendarIntegration.update({
          where: { id: integration.id },
          data: { totalFailed: { increment: 1 }, lastError: error },
        }).catch(() => {})

        console.error(`[Calendar] Sync failed for activity #${activityId}:`, error)
      }
    }
  } catch (err) {
    console.error('[Calendar] syncActivityToCalendar error:', err)
  }
}

// Remoção: usa o connectionId persistido em metadata (caminho de quem criou)
export async function unsyncActivityFromCalendar(activityId: number): Promise<void> {
  try {
    const activity = await prisma.activity.findUnique({
      where: { id: activityId },
      select: { metadata: true },
    })
    if (!activity) return

    const meta = activity.metadata as any
    const eventId = meta?.googleCalendarEventId
    if (!eventId) return

    const integrations = await getActiveIntegrations()
    const persistedConnId: number | null = meta?.googleCalendarConnectionId ?? null

    // Tenta primeiro a conexão original; se falhar, varre as ativas
    const ordered = persistedConnId
      ? [
          ...integrations.filter(i => i.connectionId === persistedConnId),
          ...integrations.filter(i => i.connectionId !== persistedConnId),
        ]
      : integrations

    for (const integration of ordered) {
      try {
        await deleteCalendarEvent(integration.connectionId, integration.calendarId, eventId)
        await prisma.calendarSyncLog.create({
          data: { integrationId: integration.id, activityId, calendarEventId: eventId, action: 'deleted', success: true },
        })
        console.log(`[Calendar] Event ${eventId} deleted for activity #${activityId}`)
        return
      } catch {
        // Evento pode não existir nessa conexão — tenta a próxima
      }
    }
  } catch (err) {
    console.error('[Calendar] unsyncActivityFromCalendar error:', err)
  }
}
