// src/routes/meetings.ts
// Módulo Reuniões (F1) — disparo do bot Vexa numa reunião e leitura das gravações/
// transcrições. Rotas sob /api/admin/meetings → gated pelo módulo 'meetings'
// (moduleRegistry + modulePermissionHook). A decisão de gravar respeita o portão
// de consentimento: shouldRecordMeeting() (tenant ligado + opt-out por reunião).

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware, adminOnly } from '../lib/auth.js'
import { logUserAudit, auditActor } from '../services/userAudit.js'
import { shouldRecordMeeting, getSalesPlaybook, getMeetingsSettings, invalidateMeetingsConfigCache } from '../lib/meetingsConfig.js'
import { isUserBotEnabled, getUserBot, setUserBot, countActiveSeats } from '../lib/meetingBotSeat.js'
import { generateMeetingsReport } from '../services/meetingReports.js'
import {
  dispatchMeetingBot, stopMeetingBot, nativeMeetingIdFromUrl,
  type MeetingPlatform,
} from '../lib/vexaClient.js'

const PLATFORMS: MeetingPlatform[] = ['google_meet', 'teams', 'zoom']

export async function meetingsRoutes(app: FastifyInstance) {
  // POST /api/admin/meetings/dispatch — coloca o bot na reunião e registra a gravação.
  // Body: { activityId? , leadId?, meetUrl?, platform?, language? }
  app.post('/api/admin/meetings/dispatch', { preHandler: authMiddleware }, async (req, reply) => {
    const body = (req.body as any) || {}
    const platform: MeetingPlatform = PLATFORMS.includes(body.platform) ? body.platform : 'google_meet'
    const language = typeof body.language === 'string' && body.language.trim() ? body.language.trim() : 'pt'

    // Resolve a partir da Activity (se veio activityId): lead, booking e link do Meet.
    let activity: { id: number; leadId: number; userId: number | null; metadata: any } | null = null
    if (body.activityId) {
      const a = await prisma.activity.findUnique({
        where: { id: Number(body.activityId) },
        select: { id: true, leadId: true, userId: true, metadata: true },
      })
      if (!a) return reply.code(404).send({ error: 'Atividade não encontrada' })
      activity = a as any
    }

    const meta = (activity?.metadata as any) || {}
    const meetUrl: string = (typeof body.meetUrl === 'string' && body.meetUrl.trim())
      ? body.meetUrl.trim()
      : (meta.googleMeetLink || '')
    if (!meetUrl) {
      return reply.code(400).send({ error: 'Sem link da reunião (informe meetUrl ou uma atividade com Google Meet).' })
    }

    // Portão de consentimento (F0.2/F0.5): só grava se ligado no tenant e sem opt-out.
    const allowed = await shouldRecordMeeting(meta)
    if (!allowed) {
      return reply.send({
        recorded: false,
        reason: 'Gravação desativada no tenant ou recusada nesta reunião (opt-out).',
      })
    }

    const leadId: number | null = activity?.leadId ?? (body.leadId ? Number(body.leadId) : null)
    const bookingId: number | null = meta.bookingId ? Number(meta.bookingId) : (body.bookingId ? Number(body.bookingId) : null)
    const actor = auditActor(req)

    // Gate de COBRANÇA (seat): o bot só roda para reuniões cujo dono tem licença
    // ativa. Dono = responsável da atividade; na ausência, o próprio operador.
    const ownerUserId = activity?.userId ?? actor.actorId
    if (!(await isUserBotEnabled(ownerUserId))) {
      return reply.send({
        recorded: false,
        reason: 'Usuário responsável sem licença de bot ativa. Ative em Reuniões › Bots por usuário.',
      })
    }

    // Dispara o bot no Vexa.
    let dispatch
    try {
      dispatch = await dispatchMeetingBot({ meetUrl, platform, language })
    } catch (err: any) {
      // Registra a tentativa falha para rastreio.
      const rec = await prisma.meetingRecording.create({
        data: {
          leadId, activityId: activity?.id ?? null, bookingId,
          userId: ownerUserId, userName: actor.actorName,
          platform, nativeMeetingId: nativeMeetingIdFromUrl(meetUrl, platform),
          meetingUrl: meetUrl, language,
          status: 'failed', errorReason: String(err?.message || err).slice(0, 500),
        },
      })
      return reply.code(502).send({ error: 'Falha ao disparar o bot no Vexa', detail: rec.errorReason, recordingId: rec.id })
    }

    const rec = await prisma.meetingRecording.create({
      data: {
        leadId, activityId: activity?.id ?? null, bookingId,
        userId: actor.actorId, userName: actor.actorName,
        platform, nativeMeetingId: dispatch.nativeMeetingId,
        meetingUrl: meetUrl, language,
        status: dispatch.status || 'requested',
        botId: dispatch.id ?? null,
        botContainerId: dispatch.containerId ?? null,
      },
    })

    void logUserAudit({
      action: 'meetings.bot.dispatched',
      targetType: 'setting',
      targetLabel: `Reunião ${platform}/${dispatch.nativeMeetingId}`,
      changes: { recordingId: rec.id, leadId, activityId: activity?.id ?? null },
      ...actor,
    })

    return reply.send({ recorded: true, recording: rec })
  })

  // GET /api/admin/meetings/recordings?leadId= — lista gravações (mais recentes primeiro).
  app.get('/api/admin/meetings/recordings', { preHandler: authMiddleware }, async (req) => {
    const q = (req.query as any) || {}
    const where: any = {}
    if (q.leadId) where.leadId = Number(q.leadId)
    if (q.status) where.status = String(q.status)
    const rows = await prisma.meetingRecording.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(q.limit) || 50, 200),
    })
    return { recordings: rows }
  })

  // GET /api/admin/meetings/recordings/:id — uma gravação (com transcrição).
  app.get('/api/admin/meetings/recordings/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const rec = await prisma.meetingRecording.findUnique({ where: { id } })
    if (!rec) return reply.code(404).send({ error: 'Gravação não encontrada' })
    return { recording: rec }
  })

  // POST /api/admin/meetings/recordings/:id/stop — encerra o bot na reunião.
  app.post('/api/admin/meetings/recordings/:id/stop', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const rec = await prisma.meetingRecording.findUnique({ where: { id } })
    if (!rec) return reply.code(404).send({ error: 'Gravação não encontrada' })
    await stopMeetingBot(rec.platform as MeetingPlatform, rec.nativeMeetingId)
    const updated = await prisma.meetingRecording.update({
      where: { id },
      data: { status: 'stopped', endedAt: new Date() },
    })
    void logUserAudit({
      action: 'meetings.bot.stopped',
      targetType: 'setting',
      targetLabel: `Reunião ${rec.platform}/${rec.nativeMeetingId}`,
      changes: { recordingId: id },
      ...auditActor(req),
    })
    return { recording: updated }
  })

  // ── Seats (licença por usuário — COBRANÇA) ──────────────────────────────
  // GET /api/admin/meetings/seats — TODOS os usuários (todos os níveis, inclusive
  // SUPERADMIN) + status da licença. A licença é por usuário independente do papel.
  app.get('/api/admin/meetings/seats', { preHandler: adminOnly }, async () => {
    const users = await prisma.user.findMany({
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: 'asc' },
    })
    const seats = await prisma.userMeetingBot.findMany()
    const byUser = new Map(seats.map(s => [s.userId, s]))
    const rows = users.map(u => {
      const s = byUser.get(u.id)
      return {
        userId: u.id, name: u.name, email: u.email, role: u.role,
        enabled: s?.enabled ?? false,
        autoJoin: s?.autoJoin ?? true,
        language: s?.language ?? 'pt',
        botName: s?.botName ?? null,
        activatedAt: s?.activatedAt ?? null,
      }
    })
    return { seats: rows, activeCount: await countActiveSeats() }
  })

  // PUT /api/admin/meetings/seats/:userId — ativa/desativa/configura o seat.
  app.put('/api/admin/meetings/seats/:userId', { preHandler: adminOnly }, async (req, reply) => {
    const userId = Number((req.params as any).userId)
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, role: true } })
    if (!u) return reply.code(404).send({ error: 'Usuário não encontrado' })
    // Licença por usuário vale para TODOS os níveis (AGENT/MANAGER/ADMIN/SUPERADMIN).
    const body = (req.body as any) || {}
    const actor = auditActor(req)
    const rec = await setUserBot(userId, {
      enabled: body.enabled, autoJoin: body.autoJoin, language: body.language, botName: body.botName,
    }, actor.actorId)
    void logUserAudit({
      action: rec.enabled ? 'meetings.seat.enabled' : 'meetings.seat.disabled',
      targetType: 'user', targetUserId: userId, targetLabel: u.name || String(userId),
      changes: { enabled: rec.enabled, autoJoin: rec.autoJoin },
      ...actor,
    })
    return { seat: rec }
  })

  // GET /api/admin/meetings/my-bot — config do bot do próprio usuário logado.
  app.get('/api/admin/meetings/my-bot', { preHandler: authMiddleware }, async (req) => {
    const uid = Number((req as any).user?.userId)
    return { bot: await getUserBot(uid) }
  })

  // ── Playbook comercial (contexto da análise IA) ─────────────────────────
  // GET /api/admin/meetings/playbook — texto do playbook + se está ativo.
  app.get('/api/admin/meetings/playbook', { preHandler: adminOnly }, async () => {
    return getSalesPlaybook()
  })

  // PUT /api/admin/meetings/playbook — salva/liga o playbook. Quando ativo, a IA
  // avalia a conduta do time NA reunião à luz dele (aderência + direcionamento).
  app.put('/api/admin/meetings/playbook', { preHandler: adminOnly }, async (req, reply) => {
    const body = (req.body as any) || {}
    const enabled = !!body.enabled
    // Limite generoso: o playbook pode ser um guia extenso (funil, SPIN, scripts).
    // ~80k chars ≈ 20k tokens — cabe qualquer playbook real e mantém a análise viável.
    const text = typeof body.text === 'string' ? body.text.slice(0, 80000) : ''
    if (enabled && !text.trim()) {
      return reply.code(400).send({ error: 'Para ativar o playbook, informe o conteúdo dele.' })
    }
    await prisma.setting.upsert({
      where: { key: 'meetings.playbook.enabled' },
      create: { key: 'meetings.playbook.enabled', label: 'Reuniões — Playbook ativo', grp: 'meetings', fieldType: 'boolean', value: (enabled ? 'true' : 'false') as any },
      update: { value: (enabled ? 'true' : 'false') as any },
    })
    await prisma.setting.upsert({
      where: { key: 'meetings.playbook.text' },
      create: { key: 'meetings.playbook.text', label: 'Reuniões — Playbook (texto)', grp: 'meetings', fieldType: 'textarea', value: text as any },
      update: { value: text as any },
    })
    invalidateMeetingsConfigCache()
    void logUserAudit({
      action: 'meetings.playbook.updated',
      targetType: 'setting',
      targetLabel: 'Playbook comercial',
      changes: { enabled, length: text.length },
      ...auditActor(req),
    })
    return { ok: true }
  })

  // ── Configurações gerais do módulo ──────────────────────────────────────
  // GET /api/admin/meetings/settings — nome do bot, modo de transcrição, entregas.
  app.get('/api/admin/meetings/settings', { preHandler: adminOnly }, async () => {
    return getMeetingsSettings()
  })

  // PUT /api/admin/meetings/settings — salva as configurações gerais.
  app.put('/api/admin/meetings/settings', { preHandler: adminOnly }, async (req) => {
    const b = (req.body as any) || {}
    const up = (key: string, value: any, fieldType: string) => prisma.setting.upsert({
      where: { key },
      create: { key, label: key, grp: 'meetings', fieldType, value: value as any },
      update: { value: value as any },
    })
    const setStr = async (key: string, v: any, max = 500, ft = 'text') => { if (v !== undefined) await up(key, String(v ?? '').slice(0, max), ft) }
    const setBool = async (key: string, v: any) => { if (v !== undefined) await up(key, v ? 'true' : 'false', 'boolean') }

    await setStr('meetings.bot_name', b.botName, 100)
    if (b.transcriptMode !== undefined) await up('meetings.transcript_mode', b.transcriptMode === 'corrigida' ? 'corrigida' : 'fiel', 'select')
    await setBool('meetings.analysis_enabled', b.analysisEnabled)
    await setStr('meetings.join_announcement', b.joinAnnouncement, 1000, 'textarea')
    await setBool('meetings.notify.email_enabled', b.notifyEmailEnabled)
    await setStr('meetings.notify.email_to', b.notifyEmailTo)
    await setBool('meetings.notify.to_owner', b.notifyToOwner)
    await setBool('meetings.notify.whatsapp_enabled', b.notifyWhatsappEnabled)
    await setStr('meetings.notify.whatsapp_to', b.notifyWhatsappTo)

    // Extras (1-9)
    await setStr('meetings.language', b.language, 10)
    await setStr('meetings.analysis_extra', b.analysisExtra, 4000, 'textarea')
    if (b.joinAheadMinutes !== undefined) await up('meetings.join_ahead_minutes', String(Math.max(0, Math.min(30, parseInt(String(b.joinAheadMinutes), 10) || 3))), 'number')
    await setBool('meetings.save_audio', b.saveAudio)
    await setBool('meetings.save_video', b.saveVideo)
    await setStr('meetings.scorecard_criteria', b.scorecardCriteria, 2000, 'textarea')
    await setBool('meetings.redact_pii', b.redactPii)
    await setBool('meetings.attach_to_lead', b.attachToLead)
    await setStr('meetings.webhook_url', b.webhookUrl, 500)
    await setBool('meetings.alert_low_adherence', b.alertLowAdherence)
    if (b.alertThreshold !== undefined) await up('meetings.alert_threshold', String(Math.max(0, Math.min(100, parseInt(String(b.alertThreshold), 10) || 50))), 'number')
    await setStr('meetings.alert_email', b.alertEmail)

    invalidateMeetingsConfigCache()
    void logUserAudit({
      action: 'meetings.settings.updated',
      targetType: 'setting',
      targetLabel: 'Configurações de reuniões',
      changes: { botName: b.botName, transcriptMode: b.transcriptMode },
      ...auditActor(req),
    })
    return { ok: true }
  })

  // ── (#1) Relatório multi-reunião ────────────────────────────────────────
  app.post('/api/admin/meetings/report', { preHandler: adminOnly }, async (req) => {
    const b = (req.body as any) || {}
    const from = b.from ? new Date(b.from) : undefined
    const to = b.to ? new Date(b.to) : undefined
    const report = await generateMeetingsReport({
      from: from && !isNaN(from.getTime()) ? from : undefined,
      to: to && !isNaN(to.getTime()) ? to : undefined,
      leadId: b.leadId ? Number(b.leadId) : undefined,
      userId: b.userId ? Number(b.userId) : undefined,
    })
    return { report }
  })

  // ── (#4) Busca global em transcrições/resumos ───────────────────────────
  app.get('/api/admin/meetings/search', { preHandler: authMiddleware }, async (req) => {
    const q = String((req.query as any)?.q || '').trim()
    if (q.length < 2) return { results: [] }
    const rows = await prisma.meetingRecording.findMany({
      where: { transcriptText: { contains: q } },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { id: true, leadId: true, platform: true, nativeMeetingId: true, createdAt: true, transcriptText: true, analysis: true },
    })
    const results = rows.map(r => {
      const t = r.transcriptText || ''
      const idx = t.toLowerCase().indexOf(q.toLowerCase())
      const snippet = idx >= 0 ? ('…' + t.slice(Math.max(0, idx - 60), idx + 100).trim() + '…') : ((r.analysis as any)?.resumo || '').slice(0, 160)
      return { id: r.id, leadId: r.leadId, platform: r.platform, nativeMeetingId: r.nativeMeetingId, createdAt: r.createdAt, snippet }
    })
    return { results }
  })
}
