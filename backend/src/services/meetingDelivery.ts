// src/services/meetingDelivery.ts
// Entrega do resumo + análise da reunião por E-MAIL e/ou WHATSAPP, conforme as
// Configurações do módulo (destinos escolhidos pelo admin). Idempotente via
// MeetingRecording.notifiedAt.

import { prisma } from '../lib/prisma.js'
import { getMeetingsSettings } from '../lib/meetingsConfig.js'
import { sendEmailGeneric, getEmailConfig, getFromAddress } from './notify.js'
import { getDefaultProvider } from './whatsappProvider.js'

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// (6) Mascaramento de dados sensíveis (LGPD) antes de enviar o resumo.
function redact(text: string): string {
  return text
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '***.***.***-**')      // CPF
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '**.***.***/****-**') // CNPJ
    .replace(/\b(?:\d[ .-]?){13,16}\b/g, '**** **** **** ****')          // cartão
}

interface RecForDelivery {
  id: number
  userId: number | null
  leadId: number | null
  platform: string
  createdAt: Date
  analysis: any
}

function buildSubject(): string {
  return 'Resumo da reunião — ByChat'
}

function section(title: string, items: string[]): string {
  if (!items?.length) return ''
  return `\n${title}:\n` + items.map(i => `• ${i}`).join('\n')
}

function buildText(rec: RecForDelivery, leadName: string | null): string {
  const a = rec.analysis || {}
  let t = `*Resumo da reunião*${leadName ? ` — ${leadName}` : ''}\n`
  if (a.resumo) t += `\n${a.resumo}\n`
  t += section('Próximos passos', a.proximosPassos)
  t += section('Action items', a.acaoItems)
  t += section('Objeções', a.objecoes)
  if (a.playbook) {
    t += `\n\n*Coaching (Playbook) — aderência ${a.playbook.aderencia}/100*`
    t += section('A melhorar', a.playbook.pontosMelhoria)
    t += section('Direcionamento', a.playbook.direcionamento)
  }
  return t.trim()
}

function buildHtml(rec: RecForDelivery, leadName: string | null): string {
  const a = rec.analysis || {}
  const list = (title: string, items: string[]) =>
    items?.length ? `<p><strong>${esc(title)}:</strong></p><ul>${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : ''
  let h = `<h2>Resumo da reunião${leadName ? ` — ${esc(leadName)}` : ''}</h2>`
  if (a.resumo) h += `<p>${esc(a.resumo)}</p>`
  h += list('Próximos passos', a.proximosPassos)
  h += list('Action items', a.acaoItems)
  h += list('Objeções', a.objecoes)
  if (a.playbook) {
    h += `<hr><h3>Coaching · Playbook — aderência ${esc(String(a.playbook.aderencia))}/100</h3>`
    h += list('Pontos fortes', a.playbook.pontosFortes)
    h += list('A melhorar', a.playbook.pontosMelhoria)
    h += list('Direcionamento', a.playbook.direcionamento)
  }
  return h
}

export async function deliverMeetingSummary(recId: number): Promise<boolean> {
  const ms = await getMeetingsSettings()
  if (!ms.notifyEmailEnabled && !ms.notifyWhatsappEnabled) return false

  const rec = await prisma.meetingRecording.findUnique({
    where: { id: recId },
    select: { id: true, userId: true, leadId: true, platform: true, createdAt: true, analysis: true, notifiedAt: true },
  })
  if (!rec || rec.notifiedAt || !rec.analysis) return false

  const lead = rec.leadId ? await prisma.lead.findUnique({ where: { id: rec.leadId }, select: { nome: true } }) : null
  const leadName = lead?.nome ?? null
  let sent = false

  // E-mail
  if (ms.notifyEmailEnabled) {
    const recipients = new Set<string>()
    for (const e of (ms.notifyEmailTo || '').split(/[,;\s]+/)) { const t = e.trim(); if (t.includes('@')) recipients.add(t) }
    if (ms.notifyToOwner && rec.userId) {
      const u = await prisma.user.findUnique({ where: { id: rec.userId }, select: { email: true } })
      if (u?.email) recipients.add(u.email)
    }
    if (recipients.size) {
      try {
        const cfg = await getEmailConfig()
        const rawHtml = buildHtml(rec as any, leadName)
        const html = ms.redactPii ? redact(rawHtml) : rawHtml
        for (const to of recipients) {
          await sendEmailGeneric({ from: getFromAddress(cfg, 'Reuniões ByChat'), to, subject: buildSubject(), html })
          sent = true
        }
      } catch (e: any) { console.warn('[MeetingDelivery] e-mail falhou:', e?.message) }
    }
  }

  // WhatsApp
  if (ms.notifyWhatsappEnabled && ms.notifyWhatsappTo.trim()) {
    try {
      const provider = await getDefaultProvider()
      const number = ms.notifyWhatsappTo.replace(/\D/g, '')
      const raw = buildText(rec as any, leadName)
      if (number) { await provider.sendText(number, ms.redactPii ? redact(raw) : raw); sent = true }
    } catch (e: any) { console.warn('[MeetingDelivery] WhatsApp falhou:', e?.message) }
  }

  await prisma.meetingRecording.update({ where: { id: recId }, data: { notifiedAt: new Date() } })
  return sent
}

/** Entrega resumos pendentes (analisados e ainda não enviados). Chamado pelo poller. */
export async function deliverPendingMeetings(limit = 5): Promise<number> {
  const ms = await getMeetingsSettings()
  if (!ms.notifyEmailEnabled && !ms.notifyWhatsappEnabled) return 0
  const pending = await prisma.meetingRecording.findMany({
    where: { status: 'completed', analyzedAt: { not: null }, notifiedAt: null },
    orderBy: { createdAt: 'asc' }, take: limit, select: { id: true },
  })
  let n = 0
  for (const p of pending) { try { if (await deliverMeetingSummary(p.id)) n++ } catch { /* segue */ } }
  return n
}

// Ações pós-análise (rodam UMA vez, logo após a análise ser gerada):
// (5) anexar resumo ao lead, (4) alerta por baixa aderência, (7) webhook.
export async function runPostAnalysisActions(recId: number): Promise<void> {
  const ms = await getMeetingsSettings()
  if (!ms.attachToLead && !ms.alertLowAdherence && !ms.webhookUrl) return
  const rec = await prisma.meetingRecording.findUnique({
    where: { id: recId },
    select: { id: true, leadId: true, userId: true, platform: true, nativeMeetingId: true, analysis: true },
  })
  if (!rec || !rec.analysis) return
  const a: any = rec.analysis
  const leadName = rec.leadId ? (await prisma.lead.findUnique({ where: { id: rec.leadId }, select: { nome: true } }))?.nome ?? null : null

  // (5) Anexar resumo como atividade no lead.
  if (ms.attachToLead && rec.leadId) {
    try {
      await prisma.activity.create({
        data: {
          leadId: rec.leadId, type: 'note', title: 'Resumo da reunião (IA)',
          description: buildText(rec as any, leadName).slice(0, 5000),
          ...(rec.userId ? { userId: rec.userId } : {}),
          scheduledAt: new Date(), status: 'completed', completedAt: new Date(),
          metadata: { meetingRecordingId: rec.id } as any,
        },
      })
    } catch (e: any) { console.warn('[MeetingPost] anexar ao lead falhou:', e?.message) }
  }

  // (4) Alerta ao gestor por baixa aderência ao playbook.
  if (ms.alertLowAdherence && a.playbook && typeof a.playbook.aderencia === 'number' && a.playbook.aderencia < ms.alertThreshold && ms.alertEmail.trim()) {
    try {
      const cfg = await getEmailConfig()
      const html = `<p><strong>⚠️ Reunião com baixa aderência ao playbook: ${a.playbook.aderencia}/100</strong></p>` + buildHtml(rec as any, leadName)
      for (const to of ms.alertEmail.split(/[,;\s]+/).filter(x => x.includes('@'))) {
        await sendEmailGeneric({ from: getFromAddress(cfg, 'Reuniões ByChat'), to, subject: `⚠️ Baixa aderência (${a.playbook.aderencia}/100) — reunião`, html })
      }
    } catch (e: any) { console.warn('[MeetingPost] alerta falhou:', e?.message) }
  }

  // (7) Webhook "reunião analisada".
  if (ms.webhookUrl.trim()) {
    try {
      await fetch(ms.webhookUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'meeting.analyzed', recordingId: rec.id, leadId: rec.leadId, platform: rec.platform, nativeMeetingId: rec.nativeMeetingId, analysis: a }),
      })
    } catch (e: any) { console.warn('[MeetingPost] webhook falhou:', e?.message) }
  }
}
