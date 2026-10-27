import { Resend } from 'resend'
import nodemailer from 'nodemailer'
import { prisma } from '../lib/prisma.js'
import { getBranding } from '../lib/branding.js'
import { renderSystemEmail, nowVars, renderString, SYSTEM_EMAIL_TEMPLATES } from './systemEmailTemplates.js'
import { trackedSend } from './outboundSendTracking.js'
import { motivoDeBloqueio, extrasDoEnvio } from './emailEventos.js'

// ── Email provider abstraction ──

export async function getEmailConfig(): Promise<Record<string, string>> {
  const keys = ['email.provider', 'smtp.host', 'smtp.port', 'smtp.secure', 'smtp.user', 'smtp.pass', 'smtp.from_name', 'smtp.from_email',
    'notification.resend_api_key', 'notification.email_domain', 'notification.sender_name',
    'notification.email_local', 'notification.reply_to', 'appearance.admin_brand_name', 'legal.company_name']
  const rows = await prisma.setting.findMany({ where: { key: { in: keys } } })
  const cfg: Record<string, string> = {}
  rows.forEach(r => { cfg[r.key] = typeof r.value === 'string' ? r.value : String(r.value) })
  return cfg
}

// ── Destinos de notificação interna (novo lead, agendamento, LGPD) ──
// Fonte única: Configurações › Empresa › Dados de Notificações. Sem fallback
// no .env — o que a tela mostra é exatamente para onde vai.
export interface NotificationTargets {
  emails: string[]
  whatsapps: string[]
  ccAgents: boolean
}

function parseList(raw: any): string[] {
  let arr: any[] = []
  if (Array.isArray(raw)) arr = raw
  else if (typeof raw === 'string') {
    const s = raw.trim()
    if (!s) return []
    try {
      const parsed = JSON.parse(s)
      arr = Array.isArray(parsed) ? parsed : [s]
    } catch {
      arr = s.split(/[,;\n]/)
    }
  }
  return Array.from(new Set(arr.map((v) => String(v).trim()).filter(Boolean)))
}

/**
 * Uma vez por instalação: o destino que morava no .env (NOTIFY_EMAIL_TO/CC,
 * NOTIF_WHATSAPP_NUMBER) vai para a tela Empresa › Dados de Notificações, que
 * passa a ser a única fonte. Só preenche lista VAZIA — nunca sobrescreve.
 */
export async function migrarDestinosDoEnv(): Promise<void> {
  const pares: Array<[string, string[], string]> = [
    ['company.notify_emails', parseList([process.env.NOTIFY_EMAIL_TO, process.env.NOTIFY_EMAIL_CC].filter(Boolean).join(',')), 'Empresa — E-mails que recebem notificações'],
    ['company.notify_whatsapps', parseList(process.env.NOTIF_WHATSAPP_NUMBER), 'Empresa — WhatsApps que recebem notificações'],
  ]
  for (const [key, valores, label] of pares) {
    if (!valores.length) continue
    const atual = await prisma.setting.findUnique({ where: { key } })
    if (atual && parseList(atual.value).length) continue
    await prisma.setting.upsert({
      where: { key },
      create: { key, label, grp: 'company', fieldType: 'json', value: valores as any },
      update: { value: valores as any },
    })
    console.log(`[notify] ${key} veio do .env para a tela Empresa: ${valores.join(', ')}`)
  }
  // O aviso de lead novo saía do código SEM cópia aos agentes. Agora ele é o
  // fluxo "Avisar equipe", que copia quando a opção está sem valor (padrão
  // ligado). Para não mudar quem recebe, a opção vazia passa a ser "não copiar".
  const cc = await prisma.setting.findUnique({ where: { key: 'company.notify_cc_agents' } })
  if (!cc) {
    await prisma.setting.create({
      data: { key: 'company.notify_cc_agents', label: 'Empresa — Copiar agentes ativos nos avisos por e-mail', grp: 'company', fieldType: 'boolean', value: false as any },
    })
    console.log('[notify] company.notify_cc_agents estava vazio → gravado "não copiar" (mesmo comportamento do aviso antigo)')
  }
}

export async function getNotificationTargets(): Promise<NotificationTargets> {
  const keys = ['company.notify_emails', 'company.notify_whatsapps', 'company.notify_cc_agents']
  const rows = await prisma.setting.findMany({ where: { key: { in: keys } } })
  const byKey = new Map(rows.map((r) => [r.key, r.value]))

  const emails = parseList(byKey.get('company.notify_emails'))
  const whatsapps = parseList(byKey.get('company.notify_whatsapps'))

  // ccAgents: default true (preserva o comportamento atual de copiar agentes ativos).
  const ccRaw = byKey.get('company.notify_cc_agents')
  const ccAgents = ccRaw === undefined || ccRaw === null ? true : (ccRaw === true || ccRaw === 'true' || ccRaw === 1)

  return { emails, whatsapps, ccAgents }
}

// Todo e-mail que sai passa por aqui e vira uma linha em OutboundSend (canal
// email): é essa contagem que a Volumetria mostra e que a loja cobra. Envio
// fora deste caminho some da conta — use sendEmailGeneric ou registrarEnvioDeEmail.
export async function sendEmailGeneric(opts: { from: string, to: string, cc?: string, subject: string, html: string, replyTo?: string, origem?: string, origemId?: number | null, leadId?: number | null, registro?: Record<string, unknown> }): Promise<string | null> {
  const cfg = await getEmailConfig()
  const provider = cfg['email.provider'] || 'resend'
  const replyTo = opts.replyTo || cfg['notification.reply_to'] || undefined

  if (provider === 'smtp') {
    const host = cfg['smtp.host']
    const port = parseInt(cfg['smtp.port'] || '587')
    const secure = cfg['smtp.secure'] === 'true'
    const user = cfg['smtp.user']
    const pass = cfg['smtp.pass']

    if (!host || !user || !pass) {
      console.warn('SMTP: configuração incompleta, pulando envio.')
      return null
    }

    const transporter = nodemailer.createTransport({ host, port, secure, auth: { user, pass } })
    return registrarEnvioDeEmail({ to: opts.to, subject: opts.subject, origem: opts.origem, origemId: opts.origemId, leadId: opts.leadId, registro: opts.registro, provider }, async ({ headers }) => {
      const info = await transporter.sendMail({
        from: opts.from,
        to: opts.to,
        ...(opts.cc ? { cc: opts.cc } : {}),
        ...(replyTo ? { replyTo } : {}),
        headers,
        subject: opts.subject,
        html: opts.html
      })
      return info?.messageId || null
    })
  } else {
    // Resend
    const apiKey = cfg['notification.resend_api_key'] || process.env.RESEND_API_KEY
    if (!apiKey) {
      console.warn('Resend: API key não configurada, pulando envio.')
      return null
    }
    const resend = new Resend(apiKey)
    return registrarEnvioDeEmail({ to: opts.to, subject: opts.subject, origem: opts.origem, origemId: opts.origemId, leadId: opts.leadId, registro: opts.registro, provider }, async ({ headers, tags }) => {
      const result = await resend.emails.send({
        from: opts.from,
        to: opts.to,
        ...(opts.cc ? { cc: opts.cc } : {}),
        ...(replyTo ? { reply_to: replyTo } : {}),
        headers, tags,
        subject: opts.subject,
        html: opts.html
      })
      // SDK do Resend não lança exceção em falha — devolve error no objeto.
      if (result?.error) {
        const msg = (result.error as any).message || JSON.stringify(result.error)
        throw new Error(`Resend: ${msg}`)
      }
      return result?.data?.id || null
    })
  }
}

/**
 * Grava o envio de e-mail (sucesso ou falha) para a Volumetria e o
 * acompanhamento. Endereço bloqueado (bounce/spam) não sai: fica registrado
 * como falha. `enviar` recebe os cabeçalhos/tags do envio e devolve o id do
 * provedor. Com `lancarSeBloqueado`, o bloqueio vira erro para quem chamou.
 */
export async function registrarEnvioDeEmail(
  meta: { to: string, subject?: string | null, origem?: string, origemId?: number | null, leadId?: number | null, provider: string, lancarSeBloqueado?: boolean, registro?: Record<string, unknown> },
  enviar: (extras: { headers: Record<string, string>, tags: Array<{ name: string, value: string }> }) => Promise<string | null>,
): Promise<string | null> {
  const bloqueio = await motivoDeBloqueio(meta.to, !!meta.leadId)
  const extras = bloqueio ? { headers: {}, tags: [] } : await extrasDoEnvio(meta.leadId)
  try {
    const r = await trackedSend({
      channel: 'email', queueName: 'email-direto', jobId: null, leadId: meta.leadId ?? null,
      recipient: String(meta.to).slice(0, 191), subject: meta.subject ? String(meta.subject).slice(0, 191) : null,
      attempts: 1, source: meta.origem || 'system', sourceId: meta.origemId ?? null,
      metadata: { provider: meta.provider, ...(meta.registro ?? {}) },
    }, async () => {
      if (bloqueio) throw new Error(`E-mail não enviado: ${bloqueio}`)
      return { externalId: await enviar(extras), metadata: { provider: meta.provider } }
    })
    return r.externalId ?? null
  } catch (e) {
    if (bloqueio && !meta.lancarSeBloqueado) {
      console.warn(`[email] ${String(meta.to)}: ${bloqueio} — não enviado`)
      return null
    }
    throw e
  }
}

/** Endereço para resposta configurado em Configurações › E-mail (vazio = sem reply-to). */
export function getReplyTo(cfg: Record<string, string>): string | undefined {
  return cfg['notification.reply_to'] || undefined
}

/**
 * Remetente dos e-mails. O nome exibido é o configurado em Configurações ›
 * E-mail; sem ele, a marca da instalação. Nenhum nome fixo no código.
 */
export function getFromAddress(cfg: Record<string, string>): string {
  const limpar = (v?: string) => String(v ?? '').replace(/^"|"$/g, '').trim()
  const marca = limpar(cfg['appearance.admin_brand_name']) || limpar(cfg['legal.company_name'])
  const comNome = (nome: string, endereco: string) => (nome ? `${nome} <${endereco}>` : endereco)
  const provider = cfg['email.provider'] || 'resend'
  if (provider === 'smtp') {
    return comNome(limpar(cfg['smtp.from_name']) || marca, cfg['smtp.from_email'] || cfg['smtp.user'] || '')
  }
  const domain = limpar(cfg['notification.email_domain']) || process.env.EMAIL_DOMAIN || ''
  // Domínio compartilhado entre clientes (attrae.com.br): cada um tem a sua
  // caixa fixa ("fabad@attrae.com.br").
  const caixa = limpar(cfg['notification.email_local']).toLowerCase().replace(/[^a-z0-9._-]/g, '') || 'nao-responda'
  return comNome(limpar(cfg['notification.sender_name']) || marca, `${caixa}@${domain}`)
}

// ── Public API ──

/**
 * Lead captado (formulário, webhook, anúncio, cadastro manual/API, chatbot).
 * NÃO envia nada: só emite `lead.captured`. Quem avisa a equipe é o fluxo
 * "Avisar equipe — Novo lead captado" (Fluxos), com modelos de WhatsApp e
 * e-mail editáveis em Modelos — ligar/desligar é no próprio fluxo.
 *
 * Fica separado de `lead.created` de propósito: esse também dispara em
 * importação, sincronização e backfill, e um aviso por lead importado
 * inundaria a equipe.
 */
export async function emitirLeadCaptado(lead: any, origem?: string): Promise<void> {
  if (!lead?.id) return
  const { eventBus } = await import('../lib/eventBus.js')
  eventBus.emitDomain({
    type: 'lead.captured',
    leadId: lead.id,
    ...(lead.funnelId ? { funnelId: lead.funnelId } : {}),
    payload: {
      origem: origem || lead.source || lead.originType || '',
      source: lead.source || '',
      metadata: { source: lead.source || '', funnelId: lead.funnelId ?? null },
    },
    timestamp: new Date(),
  })
}

/** Validade do link de redefinição (routes/users.ts grava o mesmo prazo). */
export const RESET_EXPIRA_MINUTOS = 30

const escaparHtml = (t: string) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

/**
 * Logo e cor da marca para os e-mails do sistema (Configurações › Aparência).
 * Logo relativo vira URL absoluta pelo APP_URL — e-mail não resolve caminho.
 * Sem logo, o nome da marca em texto, na cor dela.
 */
/** Luminância relativa (WCAG) de um #hex — para decidir texto claro ou escuro sobre a cor. */
function luminancia(hex: string): number {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

export async function marcaParaEmail(): Promise<{ brandName: string; color: string; textOnColor: string; linkColor: string; logoHtml: string }> {
  const brand = await getBranding()
  const rows = await prisma.setting.findMany({ where: { key: { in: ['appearance.primary_color', 'appearance.admin_logo_url'] } } })
  const val = (k: string) => String(rows.find((r) => r.key === k)?.value ?? '').replace(/^"|"$/g, '').trim()
  const cor = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(val('appearance.primary_color')) ? val('appearance.primary_color') : '#1a73e8'
  let logo = val('appearance.admin_logo_url')
  if (logo && logo.startsWith('/')) logo = process.env.APP_URL ? `${process.env.APP_URL.replace(/\/$/, '')}${logo}` : ''
  const nome = escaparHtml(brand.brandName)
  const logoHtml = /^https?:\/\//.test(logo)
    ? `<img src="${escaparHtml(logo)}" alt="${nome}" height="40" style="display:block;height:40px;max-width:220px;border:0;outline:none;font-size:20px;font-weight:700;color:${cor}">`
    : `<span style="font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:700;color:${cor}">${nome}</span>`
  // Cor clara (ex.: verde-limão) com texto branco não se lê: contraste < 4,5.
  const lum = luminancia(cor)
  const textOnColor = (lum + 0.05) / 0.05 > 1.05 / (lum + 0.05) ? '#111827' : '#ffffff'
  const linkColor = 1.05 / (lum + 0.05) >= 4.5 ? cor : '#1f2937'
  return { brandName: brand.brandName, color: cor, textOnColor, linkColor, logoHtml }
}

/**
 * E-mail de redefinição de senha. Lança erro quando não sai (e-mail não
 * configurado ou endereço bloqueado): quem chama precisa saber — dizer "enviado"
 * para quem está trancado do lado de fora é o pior caso.
 */
/** Quem pediu a redefinição — fica no registro do envio (Filas & Monitor) por segurança. */
export interface SolicitacaoDeSenha {
  modo: 'proprio_usuario' | 'administrador'
  ip: string | null
  navegador: string | null
  porUsuarioId?: number | null
  porNome?: string | null
  porEmail?: string | null
  usuarioAlvoId: number
}

export async function sendPasswordResetEmail(email: string, name: string, resetLink: string, solicitacao?: SolicitacaoDeSenha): Promise<void> {
  const cfg = await getEmailConfig()
  const marca = await marcaParaEmail()
  const vars = {
    user: { name: escaparHtml(name || email), email: escaparHtml(email) },
    resetLink, expiraMinutos: RESET_EXPIRA_MINUTOS,
    brand: { brandName: escaparHtml(marca.brandName), color: marca.color, textOnColor: marca.textOnColor, linkColor: marca.linkColor, logoHtml: marca.logoHtml },
    ...nowVars(),
  }
  // Reset de senha é transacional crítico — sempre dispara, mesmo se admin
  // tentar desativar o template (ignora o flag enabled).
  const salvo = await renderSystemEmail('password_reset', vars)
  const padrao = SYSTEM_EMAIL_TEMPLATES.find((t) => t.key === 'password_reset')!
  const subject = salvo?.subject || renderString(padrao.subject, { ...vars, brand: { ...vars.brand, brandName: marca.brandName } })
  const html = salvo?.html || renderString(padrao.htmlBody, vars)

  const configurado = cfg['email.provider'] === 'smtp' ? !!cfg['smtp.host'] : !!(cfg['notification.resend_api_key'] || process.env.RESEND_API_KEY)
  if (!configurado) throw new Error('Envio de e-mail não configurado (Configurações › E-mail)')
  const id = await sendEmailGeneric({
    from: getFromAddress(cfg), to: email, subject, html,
    origem: 'redefinicao_senha', origemId: solicitacao?.usuarioAlvoId ?? null,
    ...(solicitacao ? { registro: { solicitacao } } : {}),
  })
  if (!id) throw new Error('O e-mail de redefinição não saiu (endereço bloqueado ou recusado)')
}
