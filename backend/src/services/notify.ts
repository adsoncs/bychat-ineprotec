import { Resend } from 'resend'
import nodemailer from 'nodemailer'
import { prisma } from '../lib/prisma.js'
import { getBranding } from '../lib/branding.js'
import { renderSystemEmail, nowVars, renderString, SYSTEM_EMAIL_TEMPLATES } from './systemEmailTemplates.js'
import { linhaDoLink } from '../lib/appUrl.js'
import { trackedSend } from './outboundSendTracking.js'
import { motivoDeBloqueio, extrasDoEnvio } from './emailEventos.js'

const INV_LABELS = [
  'Sem orçamento definido','Até R$1.000/mês','R$1.000–2.500/mês',
  'R$2.500–5.000/mês','R$5.000–10.000/mês',
  'R$10.000–20.000/mês','Acima de R$20.000/mês'
]

// ── Email provider abstraction ──

export async function getEmailConfig(): Promise<Record<string, string>> {
  const keys = ['email.provider', 'smtp.host', 'smtp.port', 'smtp.secure', 'smtp.user', 'smtp.pass', 'smtp.from_name', 'smtp.from_email',
    'notification.resend_api_key', 'notification.email_domain', 'notification.sender_name',
    'notification.email_local', 'notification.reply_to']
  const rows = await prisma.setting.findMany({ where: { key: { in: keys } } })
  const cfg: Record<string, string> = {}
  rows.forEach(r => { cfg[r.key] = typeof r.value === 'string' ? r.value : String(r.value) })
  return cfg
}

// ── Destinos de notificação interna (novo lead, agendamento, LGPD) ──
// Fonte única configurável em Configurações › Empresa › Dados de Notificações.
// Listas de e-mails e WhatsApps (múltiplos). Fallback para as env vars antigas
// (NOTIFY_EMAIL_TO/CC, NOTIF_WHATSAPP_NUMBER) quando o banco ainda está vazio,
// para não quebrar instalações que ainda não preencheram a tela.
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

export async function getNotificationTargets(): Promise<NotificationTargets> {
  const keys = ['company.notify_emails', 'company.notify_whatsapps', 'company.notify_cc_agents']
  const rows = await prisma.setting.findMany({ where: { key: { in: keys } } })
  const byKey = new Map(rows.map((r) => [r.key, r.value]))

  let emails = parseList(byKey.get('company.notify_emails'))
  let whatsapps = parseList(byKey.get('company.notify_whatsapps'))

  // Fallback para as variáveis de ambiente legadas.
  if (emails.length === 0) emails = parseList(process.env.NOTIFY_EMAIL_TO)
  if (whatsapps.length === 0) whatsapps = parseList(process.env.NOTIF_WHATSAPP_NUMBER)

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

export function getFromAddress(cfg: Record<string, string>, prefix: string): string {
  const provider = cfg['email.provider'] || 'resend'
  if (provider === 'smtp') {
    const name = cfg['smtp.from_name'] || 'BeyondHub'
    const email = cfg['smtp.from_email'] || cfg['smtp.user'] || ''
    return `${name} <${email}>`
  }
  const name = cfg['notification.sender_name'] || 'BeyondHub'
  const domain = cfg['notification.email_domain'] || process.env.EMAIL_DOMAIN || 'beyondhub.com.br'
  // Domínio compartilhado entre clientes (attrae.com.br): cada um tem a sua
  // caixa fixa ("fabad@attrae.com.br"), e o prefixo não entra no nome.
  const caixa = (cfg['notification.email_local'] || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '')
  if (caixa) return `${name} <${caixa}@${domain}>`
  // A caixa local sai do prefixo, e prefixo em português tem acento: "Notificações"
  // virava `notificações@…`, que o Resend recusa ("non-ASCII characters") — o
  // e-mail simplesmente não saía. O nome de exibição continua acentuado; só o
  // endereço é normalizado.
  const local = prefix
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // tira acentos
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '') || 'nao-responda'
  return `${name} ${prefix} <${local}@${domain}>`
}

// ── Public API ──

export async function notifyNewLead(lead: any): Promise<void> {
  const sc   = lead.scores as any
  const inv  = INV_LABELS[parseInt((lead.formData as any)?.faixa_investimento || '0')] || '–'
  const brand = await getBranding()

  const msgLines = [
    `🎯 *Novo lead — ${brand.brandName}*`,
    ``,
    `*Empresa:* ${lead.empresa}`,
    `*Contato:* ${lead.nome}`,
    `*WhatsApp:* ${lead.whatsapp}`,
    `*E-mail:* ${lead.email || '–'}`,
    `*Segmento:* ${lead.segmento || '–'}`,
    `*Cidade:* ${lead.cidade || '–'}`,
    ``,
    `*Score Geral:* ${sc?.geral || 0}/100`,
    `*Maturidade:* ${lead.maturidade || '–'}`,
    `*Solução indicada:* ${lead.solucaoNome || '–'}`,
    `*Investimento:* ${inv}`,
    ``,
    linhaDoLink('🔗 Ver no painel:', '/painel'),
  ].filter((l) => l !== '')
  const msg = msgLines.join('\n')

  const results = await Promise.allSettled([
    sendWhatsApp(msg),
    sendEmail(lead, sc, inv)
  ])

  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.error(`Notify [${i === 0 ? 'WhatsApp' : 'Email'}] failed:`, r.reason)
    }
  })
}

async function sendWhatsApp(text: string): Promise<void> {
  const { whatsapps } = await getNotificationTargets()
  if (whatsapps.length === 0) {
    console.warn('WhatsApp notify: nenhum destino configurado (Empresa › Notificações), pulando.')
    return
  }

  // Aviso interno → Evolution (número conectado da instância). Cloud API não
  // entrega texto livre a número fora da janela 24h.
  const { createEvolutionProvider } = await import('./whatsappProvider.js')
  const provider = createEvolutionProvider()
  const { registrarSaidaParaGrupo } = await import('./groupOutboundLog.js')
  for (const num of whatsapps) {
    try {
      const r = await provider.sendText(num, text)
      await registrarSaidaParaGrupo({
        destino: num, texto: text, externalId: r?.messageId ?? null,
        instanceName: (provider as any).instanceName ?? null,
      })
    } catch (err: any) {
      console.error(`WhatsApp notify error (${num}): ${err.message}`)
    }
  }
}

async function sendEmail(lead: any, sc: any, inv: string): Promise<void> {
  const targets = await getNotificationTargets()
  const to = targets.emails.join(', ')
  const cc = process.env.NOTIFY_EMAIL_CC || ''

  if (!to) {
    console.warn('Email notify: nenhum e-mail configurado (Empresa › Notificações), pulando.')
    return
  }

  // Renderiza usando template editável em Configurações > Emails do Sistema.
  // Se o admin desativou o template (enabled=false), skip — Workflow assume.
  const brand = await getBranding()
  const rendered = await renderSystemEmail('notify_new_lead_admin', {
    lead: {
      ...lead,
      whatsappDigits: String(lead.whatsapp || '').replace(/\D/g, ''),
      email: lead.email || '–',
      segmento: lead.segmento || '–',
      cidade: lead.cidade || '–',
      maturidade: lead.maturidade || '–',
      solucaoNome: lead.solucaoNome || '–',
    },
    scores: {
      geral: sc?.geral || 0,
      mkt: sc?.mkt || 0,
      vnd: sc?.vnd || 0,
      oferta: sc?.oferta || 0,
    },
    investmentLabel: inv,
    brand,
    ...nowVars(),
  })
  if (!rendered) {
    console.warn('Email notify: template notify_new_lead_admin ausente, pulando.')
    return
  }
  if (!rendered.enabled) {
    // Template desativado pelo admin — Workflow toma conta agora.
    return
  }

  const cfg = await getEmailConfig()
  await sendEmailGeneric({
    from: getFromAddress(cfg, 'Sistema'),
    to,
    ...(cc ? { cc } : {}),
    subject: rendered.subject,
    html: rendered.html,
  })
}

export async function sendReportToLead(lead: any): Promise<void> {
  const email = lead.email
  if (!email) {
    console.warn('sendReportToLead: e-mail do lead não fornecido.')
    return
  }

  const cfg = await getEmailConfig()
  const brand = await getBranding()
  const sc = lead.scores as any || {}
  const fd = lead.formData as any || {}
  const analysis = lead.analysis as any || {}
  const inv = INV_LABELS[parseInt(fd.faixa_investimento || '0')] || '–'

  const scoreBar = (label: string, val: number, color: string) => `
    <div style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;margin-bottom:4px">
        <span style="font-size:12px;color:#aaa">${label}</span>
        <span style="font-size:12px;font-weight:700;color:${color}">${val}/100</span>
      </div>
      <div style="height:6px;background:#222;border-radius:3px;overflow:hidden">
        <div style="width:${val}%;height:100%;background:${color};border-radius:3px"></div>
      </div>
    </div>`

  const listItems = (items: string[]) => items.map(i => `<li style="padding:4px 0;font-size:13px;color:#ccc;list-style:none">→ ${i}</li>`).join('')
  const stepItems = (steps: any[]) => steps.map((s, i) => `
    <div style="padding:12px;background:#1a1a1a;border-radius:8px;margin-bottom:8px">
      <div style="font-size:12px;font-weight:700;color:#d1ae60;margin-bottom:4px">${i + 1}. ${s.titulo}</div>
      <div style="font-size:13px;color:#aaa">${s.desc}</div>
    </div>`).join('')

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;background:#0a0a0a;color:#fff;border-radius:12px;overflow:hidden">
      <div style="background:#111;padding:28px;border-bottom:2px solid #d1ae60;text-align:center">
        <h1 style="margin:0;font-size:24px;color:#d1ae60">Raio-X de Growth</h1>
        <p style="margin:8px 0 0;color:#888;font-size:14px">${lead.empresa} — Diagnóstico Completo</p>
      </div>

      <div style="padding:28px;text-align:center">
        <div style="font-size:48px;font-weight:900;color:#d1ae60">${sc.geral || 0}<span style="font-size:20px;color:#888">/100</span></div>
        <div style="font-size:14px;color:#aaa;margin-top:4px">Score Geral de Growth</div>
        <div style="display:inline-block;background:rgba(209,174,96,0.12);border:1px solid rgba(209,174,96,0.3);border-radius:20px;padding:6px 16px;font-size:12px;font-weight:700;color:#d1ae60;margin-top:12px">${lead.maturidade || '–'}</div>
      </div>

      <div style="padding:0 28px 20px">
        ${scoreBar('Marketing', sc.mkt || 0, '#64b5f6')}
        ${scoreBar('Vendas', sc.vnd || 0, '#66bb6a')}
        ${scoreBar('Oferta', sc.oferta || 0, '#ce93d8')}
        ${scoreBar('Dados', sc.dados || 0, '#ffa726')}
        ${scoreBar('Processos', sc.proc || 0, '#ef5350')}
      </div>

      ${analysis.visaoGeral ? `
      <div style="padding:0 28px 20px">
        <h3 style="font-size:14px;color:#d1ae60;margin-bottom:8px">📋 Visão Geral</h3>
        <p style="font-size:13px;color:#ccc;line-height:1.7;background:#111;padding:16px;border-radius:8px;border-left:3px solid #d1ae60">${analysis.visaoGeral}</p>
      </div>` : ''}

      ${(analysis.pontosFortesItems || []).length ? `
      <div style="padding:0 28px 20px">
        <h3 style="font-size:14px;color:#66bb6a;margin-bottom:8px">✅ Pontos Fortes</h3>
        <ul style="padding:0;margin:0">${listItems(analysis.pontosFortesItems)}</ul>
      </div>` : ''}

      ${(analysis.pontosFrageisItems || []).length ? `
      <div style="padding:0 28px 20px">
        <h3 style="font-size:14px;color:#ef5350;margin-bottom:8px">⚠️ Pontos Frágeis</h3>
        <ul style="padding:0;margin:0">${listItems(analysis.pontosFrageisItems)}</ul>
      </div>` : ''}

      ${analysis.prioridade ? `
      <div style="padding:0 28px 20px">
        <h3 style="font-size:14px;color:#d1ae60;margin-bottom:8px">#1 Prioridade</h3>
        <p style="font-size:13px;color:#ccc;line-height:1.7;background:rgba(209,174,96,0.08);padding:16px;border-radius:8px;border:1px solid rgba(209,174,96,0.2)">${analysis.prioridade}</p>
      </div>` : ''}

      ${(analysis.proximosPassos || []).length ? `
      <div style="padding:0 28px 20px">
        <h3 style="font-size:14px;color:#d1ae60;margin-bottom:8px">🗺️ Próximos Passos</h3>
        ${stepItems(analysis.proximosPassos)}
      </div>` : ''}

      <div style="padding:0 28px 20px">
        <h3 style="font-size:14px;color:#d1ae60;margin-bottom:8px">🚀 Solução Recomendada</h3>
        <div style="background:rgba(209,174,96,0.08);border:1px solid rgba(209,174,96,0.3);border-radius:10px;padding:16px">
          <div style="font-size:18px;font-weight:900;color:#fff;margin-bottom:6px">${lead.solucaoNome || '–'}</div>
        </div>
      </div>

      <div style="padding:20px 28px;text-align:center">
        <a href="https://wa.me/55${(lead.whatsapp || '').replace(/\D/g, '')}" style="background:#d1ae60;color:#000;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block">Falar com a ${brand.brandName} →</a>
        <p style="margin-top:12px;font-size:12px;color:#555">Clique para agendar uma conversa sobre seu diagnóstico</p>
      </div>

      <div style="background:#0a0a0a;padding:16px 28px;text-align:center;font-size:11px;color:#444;border-top:1px solid #1a1a1a">
        ${brand.brandName} · ${new Date().toLocaleDateString('pt-BR')}
      </div>
    </div>`

  // Sobrescreve o html/subject quando o admin tem template editado em
  // Configurações > Emails do Sistema (`lead_diagnostic_report`). Se o
  // template estiver desativado, skip — Workflow toma conta.
  const rendered = await renderSystemEmail('lead_diagnostic_report', {
    lead: {
      ...lead,
      whatsappDigits: String(lead.whatsapp || '').replace(/\D/g, ''),
      maturidade: lead.maturidade || '–',
      solucaoNome: lead.solucaoNome || '–',
    },
    scores: { geral: sc.geral || 0 },
    brand,
    ...nowVars(),
  })
  if (rendered && !rendered.enabled) return // admin desligou — Workflow assume
  const finalSubject = rendered?.subject ?? `🎯 Seu Raio-X de Growth está pronto — Score ${sc.geral || 0}/100 · ${lead.empresa}`
  const finalHtml = rendered?.html ?? html

  await sendEmailGeneric({
    from: getFromAddress(cfg, 'Diagnóstico'),
    to: email,
    subject: finalSubject,
    html: finalHtml as string
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
    from: getFromAddress(cfg, 'Sistema'), to: email, subject, html,
    origem: 'redefinicao_senha', origemId: solicitacao?.usuarioAlvoId ?? null,
    ...(solicitacao ? { registro: { solicitacao } } : {}),
  })
  if (!id) throw new Error('O e-mail de redefinição não saiu (endereço bloqueado ou recusado)')
}

function row(label: string, value: string) {
  return `<tr><td style="padding:8px 0;color:#888;width:140px">${label}</td><td style="padding:8px 0;color:#fff">${value}</td></tr>`
}

function scoreBox(label: string, val: number, color: string) {
  return `<div style="text-align:center;min-width:80px">
    <div style="font-size:24px;font-weight:900;color:${color}">${val}</div>
    <div style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:.05em">${label}</div>
  </div>`
}
