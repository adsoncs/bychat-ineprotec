// services/googleCalendarSync.ts
// Sync activities to Google Calendar — roteamento Híbrido B:
//   - Activity criada por operador com Google conectado → calendário do operador
//   - Sem conexão de operador → fallback para integração da empresa (kind=COMPANY)

import { prisma } from '../lib/prisma.js'
import { createCalendarEvent, updateCalendarEvent, deleteCalendarEvent } from '../lib/google.js'
import { getMeetingRecordingNotice } from '../lib/meetingsConfig.js'

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
// entra só como fallback, quando a empresa não cobre o tipo da atividade.
// O loop em syncActivityToCalendar grava em todas as retornadas.
function chooseIntegrationsForUser(all: CachedCalInt[], userId: number | null): CachedCalInt[] {
  const company = all.filter(i => i.connectionKind === 'COMPANY')
  if (userId) {
    const ofUser = all.filter(i => i.connectionUserId === userId && i.connectionKind === 'OPERATOR')
    if (ofUser.length > 0) return [...company, ...ofUser]
  }
  // Sem operador conectado: empresa (se houver); senão nada a sincronizar.
  return company
}

// Campo `location` do evento Google, por tipo de local do MeetingType. O Meet
// preenche o próprio local, então só os outros tipos escrevem aqui. Sem detalhe
// cadastrado, telefone/WhatsApp caem no contato do lead — é o que o agente precisa
// ter à mão na hora do compromisso.
function buildEventLocation(type: string, detail: string | null, leadPhone: string | null): string {
  switch (type) {
    case 'in_person': return detail || 'Presencial'
    case 'phone': return (detail || leadPhone) ? `Telefone: ${detail || leadPhone}` : 'Por telefone'
    case 'whatsapp': return (detail || leadPhone) ? `WhatsApp: ${detail || leadPhone}` : 'Por WhatsApp'
    case 'custom': return detail || ''
    default: return ''
  }
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

    // Tipo de reunião do booking: define o LOCAL do evento e se cabe link de vídeo.
    // Sem meetingType (atividade avulsa) mantemos o comportamento antigo.
    const meta0 = (activity.metadata as any) || {}
    const meetingType = meta0.meetingTypeId
      ? await prisma.meetingType.findUnique({
          where: { id: Number(meta0.meetingTypeId) },
          select: { locationType: true, locationDetail: true, durationMin: true },
        }).catch(() => null)
      : null
    const locationType = String(meta0.locationType || meetingType?.locationType || '')
    // Presencial, telefone, WhatsApp e link próprio (Zoom etc.) NÃO ganham Meet —
    // o encontro tem outro lugar; criar uma sala de vídeo junto confunde o cliente.
    const wantsMeet = locationType ? locationType === 'google_meet' : true
    const eventLocation = buildEventLocation(locationType, meetingType?.locationDetail || null, lead?.whatsapp || null)
    const durationMin = Number(meetingType?.durationMin) > 0 ? Number(meetingType!.durationMin) : 30

    // UM agendamento = UM evento. A agenda da EMPRESA é a oficial: quando ela cobre o
    // tipo da atividade, o evento nasce só nela e o operador dono entra como CONVIDADO
    // (o convite já faz o evento aparecer na agenda pessoal dele, com o mesmo Meet).
    // Antes gravávamos na empresa E na agenda do operador → dois eventos com links de
    // Meet diferentes: um com o cliente (empresa) e outro só com o operador.
    // Setting scheduling.central_calendar_email refina qual agenda central usar em bookings.
    const companyMatched = matched.filter(i => i.connectionKind === 'COMPANY')
    let targetIntegrations = companyMatched.length > 0 ? companyMatched : matched

    // E-mail do operador dono da atividade — convidado sempre que o evento é criado
    // numa agenda que não é a dele (empresa/central).
    let ownerEmail = ''
    if (activity.userId) {
      const owner = await prisma.user.findUnique({ where: { id: activity.userId }, select: { email: true } })
      ownerEmail = (owner?.email || '').trim().toLowerCase()
    }
    // Aviso ao LEAD (convite no Google + WhatsApp) é OPT-IN por atividade: só
    // dispara se o operador marcou "avisar o lead" (metadata.notifyLead) ao criar.
    // Bookings (lead pediu via /agendar/chatbot) sempre convidam o lead. Sem isso,
    // registrar um no-show como atividade de reunião disparava convite/WhatsApp ao
    // cliente sem ninguém pedir.
    const leadOptIn = meta0.notifyLead === true
    const inviteLead = !!meta0.bookingId || leadOptIn
    if (meta0.bookingId) {
      const setting = await prisma.setting.findUnique({ where: { key: 'scheduling.central_calendar_email' } }).catch(() => null)
      const centralEmail = setting ? String(setting.value).replace(/"/g, '').trim().toLowerCase() : ''
      if (centralEmail) {
        const central = integrations.find((i) => i.calendarId.toLowerCase() === centralEmail && i.activityTypes.includes(activity.type))
        if (central) targetIntegrations = [central]
      }
    }

    // Aviso de gravação (F0.3): quando a gravação de reuniões está ligada, o
    // convite precisa dar transparência/consentimento aos participantes.
    const recordingNotice = await getMeetingRecordingNotice()

    for (const integration of targetIntegrations) {
      const startTime = Date.now()
      try {
        const start = activity.scheduledAt
        // Duração real do tipo de reunião (era sempre 30min, o que encurtava na
        // agenda um encontro de 1h e liberava slot ainda ocupado).
        const end = new Date(start.getTime() + durationMin * 60_000)

        // Convidados: o LEAD só entra com opt-in (notifyLead) ou em booking; o
        // operador dono entra SEMPRE que o evento não está na agenda dele — sem isso
        // a reunião era criada na empresa sem quem a marcou.
        const attendees: string[] = []
        if (integration.notifyLead && inviteLead && lead?.email) attendees.push(lead.email)
        const isOwnCalendar = integration.connectionKind === 'OPERATOR'
          && integration.connectionUserId === activity.userId
        if (ownerEmail && !isOwnCalendar && integration.calendarId.toLowerCase() !== ownerEmail) {
          attendees.push(ownerEmail)
        }

        const description = [
          activity.description || '',
          lead ? `\nLead: ${lead.nome || ''} ${lead.empresa ? '(' + lead.empresa + ')' : ''}` : '',
          lead?.whatsapp ? `WhatsApp: ${lead.whatsapp}` : '',
          recordingNotice ? `\n⚠️ ${recordingNotice}` : '',
          `\nCriado via ByChat Beyond`,
        ].filter(Boolean).join('\n')

        const result = await createCalendarEvent(integration.connectionId, integration.calendarId, {
          summary: `${activity.title} — ${lead?.nome || 'Lead'}`,
          description,
          start,
          end,
          attendees,
          addMeetLink: integration.autoMeetLink && wantsMeet,
          location: eventLocation || undefined,
          // O agente conduz a reunião: mesmo com o evento na agenda da empresa,
          // ele edita e convida outros participantes (sócio, técnico, o chefe do lead).
          guestsCanModify: true,
          guestsCanInviteOthers: true,
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
        if (integration.notifyLead && leadOptIn && result.meetLink && lead?.whatsapp && !meta0.bookingId) {
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
/** Atualiza o evento Google JÁ criado desta activity (título/horário), quando
 *  ela é editada. No-op se não há evento sincronizado. NÃO altera convidados —
 *  não reenvia convite ao lead (o opt-in de notificação vale só na criação). */
export async function updateActivityInCalendar(activityId: number): Promise<void> {
  try {
    const activity = await prisma.activity.findUnique({
      where: { id: activityId },
      select: { id: true, title: true, scheduledAt: true, leadId: true, metadata: true },
    })
    if (!activity) return
    const meta = (activity.metadata as any) || {}
    const eventId = meta.googleCalendarEventId as string | undefined
    const connectionId = meta.googleCalendarConnectionId as number | undefined
    if (!eventId || !connectionId) return

    const integ = await prisma.googleCalendarIntegration.findFirst({
      where: { connectionId },
      select: { calendarId: true },
    })
    if (!integ) return

    const lead = activity.leadId
      ? await prisma.lead.findUnique({ where: { id: activity.leadId }, select: { nome: true } })
      : null

    const start = activity.scheduledAt
    const end = new Date(start.getTime() + 30 * 60_000)
    await updateCalendarEvent(connectionId, integ.calendarId, eventId, {
      summary: `${activity.title} — ${lead?.nome || 'Lead'}`,
      start,
      end,
    })
  } catch (err) {
    console.warn('[Calendar] updateActivityInCalendar falhou:', err)
  }
}

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
