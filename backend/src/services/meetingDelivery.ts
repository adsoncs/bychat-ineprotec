// src/services/meetingDelivery.ts
// Entrega do resumo + análise da reunião por E-MAIL e/ou WHATSAPP, conforme as
// Configurações do módulo (destinos escolhidos pelo admin). Idempotente via
// MeetingRecording.notifiedAt.

import { prisma } from '../lib/prisma.js'
import { getMeetingsSettings } from '../lib/meetingsConfig.js'
import { sendEmailGeneric, getEmailConfig, getFromAddress } from './notify.js'
import { getDefaultProvider } from './whatsappProvider.js'
import { renderizarModelo, textoDoSistema } from './modelosDoSistema.js'

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

/** Variáveis dos modelos reuniao_* a partir da análise da IA. */
function variaveisDaReuniao(rec: RecForDelivery, leadName: string | null, escapar = false): Record<string, any> {
  const a = rec.analysis || {}
  const e = (t: any) => (escapar ? esc(String(t ?? '')) : String(t ?? ''))
  const lista = (x: any) => (Array.isArray(x) ? x.map((i) => e(i)).filter(Boolean) : [])
  return {
    lead: e(leadName || ''),
    resumo: e(a.resumo || ''),
    proximos_passos: lista(a.proximosPassos),
    acoes: lista(a.acaoItems),
    objecoes: lista(a.objecoes),
    tem_playbook: a.playbook ? 'sim' : '',
    aderencia: a.playbook ? e(a.playbook.aderencia) : '',
    pontos_fortes: lista(a.playbook?.pontosFortes),
    a_melhorar: lista(a.playbook?.pontosMelhoria),
    direcionamento: lista(a.playbook?.direcionamento),
  }
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
        const em = await renderizarModelo('reuniao_resumo_email', variaveisDaReuniao(rec as any, leadName, true))
        if (em?.body.trim()) {
          const cfg = await getEmailConfig()
          const html = ms.redactPii ? redact(em.body) : em.body
          for (const to of recipients) {
            await sendEmailGeneric({ from: getFromAddress(cfg), to, subject: em.subject, html })
            sent = true
          }
        }
      } catch (e: any) { console.warn('[MeetingDelivery] e-mail falhou:', e?.message) }
    }
  }

  // WhatsApp
  if (ms.notifyWhatsappEnabled && ms.notifyWhatsappTo.trim()) {
    try {
      const provider = await getDefaultProvider()
      const number = ms.notifyWhatsappTo.replace(/\D/g, '')
      const raw = await textoDoSistema('reuniao_resumo_wa', variaveisDaReuniao(rec as any, leadName))
      if (number && raw) { await provider.sendText(number, ms.redactPii ? redact(raw) : raw); sent = true }
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
          leadId: rec.leadId, type: 'note', title: (await textoDoSistema('reuniao_nota_lead_titulo')) || '—',
          description: (await textoDoSistema('reuniao_nota_lead', variaveisDaReuniao(rec as any, leadName))).slice(0, 5000),
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
      const em = await renderizarModelo('reuniao_baixa_aderencia_email', variaveisDaReuniao(rec as any, leadName, true))
      if (em?.body.trim()) {
        const cfg = await getEmailConfig()
        for (const to of ms.alertEmail.split(/[,;\s]+/).filter(x => x.includes('@'))) {
          await sendEmailGeneric({ from: getFromAddress(cfg), to, subject: em.subject, html: em.body })
        }
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
