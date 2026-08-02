// src/routes/meetings.ts
// Módulo Reuniões (F1) — disparo do bot Vexa numa reunião e leitura das gravações/
// transcrições. Rotas sob /api/admin/meetings → gated pelo módulo 'meetings'
// (moduleRegistry + modulePermissionHook). A decisão de gravar respeita o portão
// de consentimento: shouldRecordMeeting() (tenant ligado + opt-out por reunião).

import { FastifyInstance } from 'fastify'
import { promises as fs } from 'node:fs'
import { join, extname } from 'node:path'
import crypto from 'node:crypto'
import { prisma } from '../lib/prisma.js'
import { authMiddleware, adminOnly } from '../lib/auth.js'
import { extensionOrJwtAuth, generateExtensionToken } from '../lib/meetingExtensionAuth.js'
import { logUserAudit, auditActor } from '../services/userAudit.js'
import { shouldRecordMeeting, getSalesPlaybook, getMeetingsSettings, invalidateMeetingsConfigCache } from '../lib/meetingsConfig.js'
import { isUserBotEnabled, getUserBot, setUserBot, countActiveSeats } from '../lib/meetingBotSeat.js'
import { resolvePermissions } from '../lib/permissions.js'
import { generateMeetingsReport } from '../services/meetingReports.js'
import { transcribeUploadRecording } from '../services/meetingUploadTranscribe.js'
import {
  dispatchMeetingBot, stopMeetingBot, nativeMeetingIdFromUrl,
  type MeetingPlatform,
} from '../lib/vexaClient.js'

const PLATFORMS: MeetingPlatform[] = ['google_meet', 'teams', 'zoom']
const MAX_AUDIO_BYTES = 200 * 1024 * 1024 // 200MB (~3h de webm/opus)

function meetingFileUrl(storagePath: string): string {
  const base = process.env.APP_URL || `http://localhost:${process.env.PORT || 3005}`
  return `${base}/uploads/${storagePath}`
}

function sanitizeAudioExt(name: string): string {
  const raw = (extname(name).slice(1) || 'webm').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10)
  return raw || 'webm'
}

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

  // POST /api/admin/meetings/upload — MODO PRESENCIAL: recebe o áudio da reunião
  // física (gravado no navegador/celular ou upload de arquivo), SEM bot Vexa.
  // multipart/form-data: field "file" (áudio, obrigatório) + fields opcionais
  // leadId, activityId, language, consent (obrigatório="true"). Salva o áudio,
  // cria a gravação em "transcribing" e dispara a transcrição soberana (whisper
  // CPU) — ao concluir vira "completed" e o pipeline (análise/entrega) assume.
  app.post('/api/admin/meetings/upload', { preHandler: extensionOrJwtAuth }, async (req, reply) => {
    const actor = auditActor(req)

    // Gate de módulo/presencial ligado no tenant.
    const ms = await getMeetingsSettings()
    if (!ms.presencialEnabled) {
      return reply.send({ recorded: false, reason: 'Reunião presencial desativada nas Configurações do módulo.' })
    }

    // Gate de COBRANÇA (seat): quem envia precisa de licença ativa.
    if (!(await isUserBotEnabled(actor.actorId))) {
      return reply.send({ recorded: false, reason: 'Você não tem licença de Reuniões ativa. Ative em Reuniões › Bots por usuário.' })
    }

    const file = await (req as any).file?.({ limits: { fileSize: MAX_AUDIO_BYTES } })
    if (!file) return reply.code(400).send({ error: 'Nenhum áudio enviado' })

    // Grava o áudio em uploads/meeting-recordings/ (mesma pasta do modo online → retenção F0.6 cobre).
    const ext = sanitizeAudioExt(file.filename || '')
    const uploadsDir = join(process.cwd(), '..', 'uploads', 'meeting-recordings')
    await fs.mkdir(uploadsDir, { recursive: true })
    const savedName = `presencial-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`
    const filePath = join(uploadsDir, savedName)

    const chunks: Buffer[] = []
    let total = 0
    for await (const c of file.file) {
      total += c.length
      if (total > MAX_AUDIO_BYTES) return reply.code(413).send({ error: 'Áudio muito grande (máx 200MB)' })
      chunks.push(c)
    }
    if (total === 0) return reply.code(400).send({ error: 'Áudio vazio' })
    await fs.writeFile(filePath, Buffer.concat(chunks))

    // Fields (disponíveis após drenar o stream do arquivo).
    const fields = file.fields || {}
    const fv = (k: string): string => String(fields?.[k]?.value ?? '').trim()
    // PORTÃO DE CONSENTIMENTO (F0-presencial): sem confirmação, não grava.
    const consent = fv('consent').toLowerCase()
    if (!(consent === 'true' || consent === '1' || consent === 'sim')) {
      await fs.unlink(filePath).catch(() => {})
      return reply.code(400).send({ error: 'Consentimento obrigatório para gravar a reunião presencial', code: 'CONSENT_REQUIRED' })
    }

    let leadId: number | null = fv('leadId') ? Number(fv('leadId')) : null
    let activityId: number | null = fv('activityId') ? Number(fv('activityId')) : null
    const language = fv('language') || ms.language || 'pt'
    const title = fv('title').slice(0, 200) || null
    // Origem: 'extension' (captura local via extensão Chrome) ou 'presencial' (upload/gravação avulsa).
    const source = fv('source') === 'extension' ? 'extension' : 'presencial'

    // Se veio activityId e não veio leadId, resolve o lead a partir da atividade.
    if (activityId && !leadId) {
      const a = await prisma.activity.findUnique({ where: { id: activityId }, select: { leadId: true } })
      leadId = a?.leadId ?? null
    }

    const storagePath = `meeting-recordings/${savedName}`
    const rec = await prisma.meetingRecording.create({
      data: {
        title, leadId, activityId, userId: actor.actorId, userName: actor.actorName,
        platform: 'presencial', source,
        nativeMeetingId: `${source}-${crypto.randomUUID()}`,
        meetingUrl: '', language,
        status: 'transcribing',
        audioPath: storagePath, audioUrl: meetingFileUrl(storagePath),
        consentAt: new Date(), consentBy: actor.actorId,
      },
    })

    void logUserAudit({
      action: 'meetings.presencial.uploaded',
      targetType: 'setting',
      targetLabel: `Reunião presencial #${rec.id}`,
      changes: { recordingId: rec.id, leadId, activityId, bytes: total },
      ...actor,
    })

    // Transcrição soberana em background (não bloqueia a resposta). A rede de
    // segurança do poller reprocessa se o servidor cair no meio.
    void transcribeUploadRecording(rec.id).catch((e) => console.warn('[MeetingUpload] disparo #' + rec.id + ' falhou:', e?.message))

    return reply.send({ recorded: true, recording: rec })
  })

  // GET /api/admin/meetings/lead-search?q= — busca leads por nome/e-mail/WhatsApp/empresa
  // para vincular a uma reunião presencial (o operador nem sempre sabe o ID do lead).
  app.get('/api/admin/meetings/lead-search', { preHandler: authMiddleware }, async (req) => {
    const q = String((req.query as any)?.q || '').trim()
    if (q.length < 2) return { leads: [] }
    const leads = await prisma.lead.findMany({
      where: { OR: [{ nome: { contains: q } }, { email: { contains: q } }, { whatsapp: { contains: q } }, { empresa: { contains: q } }] },
      select: { id: true, nome: true, email: true, whatsapp: true, empresa: true },
      take: 8,
      orderBy: { updatedAt: 'desc' },
    })
    return { leads }
  })

  // ── Extensão Chrome de captura local (paridade Read.ai) ───────────────────
  // GET /api/admin/meetings/extension/config — a extensão consulta o estado (seat,
  // presencial ligado, texto de consentimento). Aceita o token da extensão OU JWT.
  app.get('/api/admin/meetings/extension/config', { preHandler: extensionOrJwtAuth }, async (req) => {
    const actor = auditActor(req)
    const ms = await getMeetingsSettings()
    const { getMeetingRecordingNotice } = await import('../lib/meetingsConfig.js')
    return {
      ok: true,
      user: { id: actor.actorId, name: actor.actorName },
      presencialEnabled: ms.presencialEnabled,
      seatEnabled: await isUserBotEnabled(actor.actorId),
      language: ms.language,
      consentNotice: await getMeetingRecordingNotice(),
    }
  })

  // POST /api/admin/meetings/extension/token — gera um token novo (mostrado 1x) p/
  // o usuário logado colar na extensão. Body: { label? }.
  app.post('/api/admin/meetings/extension/token', { preHandler: authMiddleware }, async (req, reply) => {
    const actor = auditActor(req)
    if (actor.actorId == null) return reply.code(401).send({ error: 'Usuário não identificado' })
    const label = String((req.body as any)?.label || '').trim() || 'Extensão Chrome'
    const token = await generateExtensionToken(actor.actorId, label)
    void logUserAudit({ action: 'meetings.extension.token.created', targetType: 'setting', targetLabel: label, ...actor })
    return reply.send({ token, label })
  })

  // GET /api/admin/meetings/extension/token — lista os tokens do usuário (mascarados).
  app.get('/api/admin/meetings/extension/token', { preHandler: authMiddleware }, async (req) => {
    const actor = auditActor(req)
    if (actor.actorId == null) return { tokens: [] }
    const rows = await prisma.meetingExtensionToken.findMany({
      where: { userId: actor.actorId, revokedAt: null },
      select: { id: true, label: true, lastUsedAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    })
    return { tokens: rows }
  })

  // DELETE /api/admin/meetings/extension/token/:id — revoga um token do usuário.
  app.delete('/api/admin/meetings/extension/token/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const actor = auditActor(req)
    if (actor.actorId == null) return reply.code(401).send({ error: 'Usuário não identificado' })
    const id = Number((req.params as any)?.id)
    const row = await prisma.meetingExtensionToken.findFirst({ where: { id, userId: actor.actorId } })
    if (!row) return reply.code(404).send({ error: 'Token não encontrado' })
    await prisma.meetingExtensionToken.update({ where: { id }, data: { revokedAt: new Date() } })
    void logUserAudit({ action: 'meetings.extension.token.revoked', targetType: 'setting', targetLabel: row.label || String(id), ...actor })
    return reply.send({ ok: true })
  })

  // GET /api/admin/meetings/recordings?leadId= — lista gravações (mais recentes primeiro).
  app.get('/api/admin/meetings/recordings', { preHandler: authMiddleware }, async (req) => {
    const q = (req.query as any) || {}
    const where: any = {}
    if (q.leadId) where.leadId = Number(q.leadId)
    if (q.status) where.status = String(q.status)
    // Escopo: quem tem scope 'own' (ex.: AGENT) vê só as PRÓPRIAS gravações — as
    // reuniões da sua agenda/leads (userId = ele). MANAGER/ADMIN/SUPERADMIN veem todas.
    const u = (req as any).user || {}
    const perms = await resolvePermissions(u.userId, u.role || '')
    if ((perms['meetings']?.scope || 'own') === 'own') where.userId = u.userId
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
    const u = (req as any).user || {}
    const perms = await resolvePermissions(u.userId, u.role || '')
    if ((perms['meetings']?.scope || 'own') === 'own' && rec.userId !== u.userId) {
      return reply.code(403).send({ error: 'Sem acesso a esta gravação' })
    }
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

    // Modo reunião presencial (upload de áudio, sem bot).
    await setBool('meetings.presencial.enabled', b.presencialEnabled)
    await setBool('meetings.presencial.diarize', b.presencialDiarize)

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
