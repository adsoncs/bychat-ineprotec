// src/services/emailEventos.ts
//
// O que acontece com o e-mail DEPOIS que a Resend aceita: entregue, aberto,
// clicado, devolvido (bounce) ou marcado como spam.
//
// A conta Resend é uma só para vários clientes, então o webhook dela chega na
// loja central, que descobre de quem é o e-mail pela tag `instalacao` (posta
// aqui no envio) e repassa o evento para cá pela ponte HMAC.
//
// O domínio de envio (attrae.com.br) é COMPARTILHADO: quem devolveu ou
// reclamou entra em EmailSupressao e não recebe mais — insistir derruba a
// reputação do domínio e a entrega de TODOS os clientes, não só deste.

import { prisma } from '../lib/prisma.js'
import { logEvent, EVENT_TYPES } from './leadHistory.js'
import { getOrCreateOptOutToken } from './preferencesToken.js'
import { appUrl } from '../lib/appUrl.js'

/** Identifica esta instalação nos e-mails (tag da Resend: só letras, números, _ e -). */
export function instalacaoTag(): string {
  try {
    return new URL(process.env.APP_URL || '').host.replace(/[^A-Za-z0-9_-]/g, '_') || 'desconhecida'
  } catch {
    return 'desconhecida'
  }
}

const normalizar = (email: string) => String(email || '').trim().toLowerCase()

/** Primeiro endereço de uma lista "a@x, b@y" — é o que conta para bloqueio e evento. */
export function enderecoPrincipal(to: string): string {
  const m = String(to || '').match(/[^\s<>,;"']+@[^\s<>,;"']+/)
  return m ? normalizar(m[0]) : ''
}

/**
 * Este envio pode sair? Bounce bloqueia tudo (o endereço não existe). Spam
 * bloqueia só o automático para lead (`paraLead`): quem reclamou ainda pode
 * pedir a senha ou receber um e-mail escrito por alguém da equipe.
 */
export async function motivoDeBloqueio(to: string, paraLead: boolean): Promise<string | null> {
  const email = enderecoPrincipal(to)
  if (!email) return null
  const s = await prisma.emailSupressao.findUnique({ where: { email } })
  if (!s) return null
  if (s.motivo === 'spam' && !paraLead) return null
  return s.motivo === 'bounce' ? 'endereço inexistente (bounce)'
    : s.motivo === 'spam' ? 'destinatário marcou como spam'
    : 'bloqueado manualmente'
}

/**
 * Cabeçalhos e tags que todo envio pela Resend leva. Com `leadId`, inclui o
 * descadastro de um clique (RFC 8058) — Gmail e Yahoo exigem em volume, e sem
 * ele o próximo passo do destinatário é o botão "spam".
 */
export async function extrasDoEnvio(leadId?: number | null): Promise<{ headers: Record<string, string>; tags: Array<{ name: string; value: string }> }> {
  const headers: Record<string, string> = {}
  const tags = [{ name: 'instalacao', value: instalacaoTag() }]
  const base = appUrl()
  if (leadId && base) {
    try {
      const token = await getOrCreateOptOutToken(leadId)
      headers['List-Unsubscribe'] = `<${base}/api/preferencias/${token}/descadastro>`
      headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click'
    } catch { /* lead apagado: segue sem o cabeçalho */ }
  }
  return { headers, tags }
}

/** Descadastra o lead do canal e-mail (link de um clique ou spam). */
export async function descadastrarEmail(leadId: number, origem: string): Promise<void> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { optOutChannels: true } })
  if (!lead) return
  const atual = Array.isArray(lead.optOutChannels) ? (lead.optOutChannels as string[]) : []
  if (atual.includes('email')) return
  await prisma.lead.update({ where: { id: leadId }, data: { optOutChannels: [...atual, 'email'] } })
  logEvent({
    leadId, type: EVENT_TYPES.EMAIL_UNSUBSCRIBED, category: 'communication', channel: 'email', source: origem,
    title: 'Descadastrou-se dos e-mails', actorType: 'lead',
  })
}

interface EventoResend {
  type: string
  created_at?: string
  data?: {
    email_id?: string
    to?: string[] | string
    subject?: string
    bounce?: { type?: string; subType?: string; message?: string }
    click?: { link?: string }
  }
}

/** Ordem do "melhor estado" — um `delivered` atrasado não desfaz um `opened`. */
const ORDEM: Record<string, number> = { queued: 0, processing: 1, sent: 2, delivered: 3, opened: 4, clicked: 5 }

export async function aplicarEventoResend(evt: EventoResend): Promise<{ ok: true; envioId: number | null; acao: string }> {
  const quando = evt.created_at ? new Date(evt.created_at) : new Date()
  const id = evt.data?.email_id
  const para = enderecoPrincipal(Array.isArray(evt.data?.to) ? evt.data!.to.join(',') : String(evt.data?.to ?? ''))
  const envio = id ? await prisma.outboundSend.findFirst({ where: { externalId: id, channel: 'email' } }) : null
  const subir = (status: string) => (envio && (ORDEM[status] ?? 0) > (ORDEM[envio.status] ?? -1) ? { status } : {})

  switch (evt.type) {
    case 'email.delivered':
      if (envio) await prisma.outboundSend.update({ where: { id: envio.id }, data: { ...subir('delivered'), deliveredAt: envio.deliveredAt ?? quando } })
      return { ok: true, envioId: envio?.id ?? null, acao: 'entregue' }

    case 'email.opened':
      if (envio) {
        await prisma.outboundSend.update({ where: { id: envio.id }, data: { ...subir('opened'), opens: { increment: 1 }, openedAt: envio.openedAt ?? quando } })
        if (envio.leadId && !envio.openedAt) logEvent({ leadId: envio.leadId, type: EVENT_TYPES.EMAIL_OPENED, category: 'communication', channel: 'email', source: 'resend', title: `Abriu o e-mail: ${envio.subject ?? ''}`.trim(), metadata: { envioId: envio.id } })
      }
      return { ok: true, envioId: envio?.id ?? null, acao: 'aberto' }

    case 'email.clicked': {
      const link = evt.data?.click?.link ?? null
      if (envio) {
        await prisma.outboundSend.update({ where: { id: envio.id }, data: { ...subir('clicked'), clicks: { increment: 1 }, clickedAt: envio.clickedAt ?? quando, openedAt: envio.openedAt ?? quando } })
        if (envio.leadId) logEvent({ leadId: envio.leadId, type: EVENT_TYPES.EMAIL_CLICKED, category: 'communication', channel: 'email', source: 'resend', title: `Clicou no e-mail: ${envio.subject ?? ''}`.trim(), description: link ?? undefined, metadata: { envioId: envio.id, link } })
      }
      return { ok: true, envioId: envio?.id ?? null, acao: 'clicado' }
    }

    case 'email.bounced': {
      const b = evt.data?.bounce ?? {}
      const permanente = !b.type || b.type === 'Permanent'
      if (envio) await prisma.outboundSend.update({ where: { id: envio.id }, data: { status: 'bounced', failedAt: quando, error: `Bounce ${b.type ?? ''} ${b.subType ?? ''}: ${b.message ?? ''}`.trim().slice(0, 1000) } })
      if (permanente && para) {
        await prisma.emailSupressao.upsert({
          where: { email: para }, update: {},
          create: { email: para, motivo: 'bounce', detalhe: (b.message ?? '').slice(0, 500) || null, envioId: envio?.id ?? null, criadoPor: 'resend' },
        })
      }
      if (envio?.leadId) logEvent({ leadId: envio.leadId, type: EVENT_TYPES.EMAIL_BOUNCED, category: 'communication', channel: 'email', source: 'resend', title: permanente ? 'E-mail devolvido: endereço inexistente' : 'E-mail devolvido temporariamente', description: b.message ?? undefined, metadata: { envioId: envio.id, bounce: b } })
      return { ok: true, envioId: envio?.id ?? null, acao: permanente ? 'bounce (bloqueado)' : 'bounce temporário' }
    }

    case 'email.complained':
      if (envio) await prisma.outboundSend.update({ where: { id: envio.id }, data: { status: 'complained', complainedAt: quando } })
      if (para) {
        await prisma.emailSupressao.upsert({
          where: { email: para }, update: { motivo: 'spam' },
          create: { email: para, motivo: 'spam', envioId: envio?.id ?? null, criadoPor: 'resend' },
        })
      }
      if (envio?.leadId) {
        logEvent({ leadId: envio.leadId, type: EVENT_TYPES.EMAIL_COMPLAINED, category: 'communication', channel: 'email', source: 'resend', title: 'Marcou o e-mail como spam', metadata: { envioId: envio.id } })
        await descadastrarEmail(envio.leadId, 'spam')
      }
      return { ok: true, envioId: envio?.id ?? null, acao: 'spam (bloqueado)' }

    case 'email.failed':
      if (envio) await prisma.outboundSend.update({ where: { id: envio.id }, data: { status: 'failed', failedAt: quando } })
      return { ok: true, envioId: envio?.id ?? null, acao: 'falhou' }

    default:
      // sent / delivery_delayed / scheduled: nada muda no que mostramos.
      return { ok: true, envioId: envio?.id ?? null, acao: 'ignorado' }
  }
}
