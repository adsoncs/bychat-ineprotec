import { Resend } from 'resend'
import nodemailer from 'nodemailer'
import { prisma } from '../lib/prisma.js'
import { getBranding } from '../lib/branding.js'
import { renderSystemEmail, nowVars } from './systemEmailTemplates.js'
import { linhaDoLink } from '../lib/appUrl.js'

const INV_LABELS = [
  'Sem orçamento definido','Até R$1.000/mês','R$1.000–2.500/mês',
  'R$2.500–5.000/mês','R$5.000–10.000/mês',
  'R$10.000–20.000/mês','Acima de R$20.000/mês'
]

// ── Email provider abstraction ──

export async function getEmailConfig(): Promise<Record<string, string>> {
  const keys = ['email.provider', 'smtp.host', 'smtp.port', 'smtp.secure', 'smtp.user', 'smtp.pass', 'smtp.from_name', 'smtp.from_email',
    'notification.resend_api_key', 'notification.email_domain', 'notification.sender_name']
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

export async function sendEmailGeneric(opts: { from: string, to: string, cc?: string, subject: string, html: string }): Promise<void> {
  const cfg = await getEmailConfig()
  const provider = cfg['email.provider'] || 'resend'

  if (provider === 'smtp') {
    const host = cfg['smtp.host']
    const port = parseInt(cfg['smtp.port'] || '587')
    const secure = cfg['smtp.secure'] === 'true'
    const user = cfg['smtp.user']
    const pass = cfg['smtp.pass']

    if (!host || !user || !pass) {
      console.warn('SMTP: configuração incompleta, pulando envio.')
      return
    }

    const transporter = nodemailer.createTransport({ host, port, secure, auth: { user, pass } })
    await transporter.sendMail({
      from: opts.from,
      to: opts.to,
      ...(opts.cc ? { cc: opts.cc } : {}),
      subject: opts.subject,
      html: opts.html
    })
  } else {
    // Resend
    const apiKey = cfg['notification.resend_api_key'] || process.env.RESEND_API_KEY
    if (!apiKey) {
      console.warn('Resend: API key não configurada, pulando envio.')
      return
    }
    const resend = new Resend(apiKey)
    const result = await resend.emails.send({
      from: opts.from,
      to: opts.to,
      ...(opts.cc ? { cc: opts.cc } : {}),
      subject: opts.subject,
      html: opts.html
    })
    // SDK do Resend não lança exceção em falha — devolve error no objeto.
    if (result?.error) {
      const msg = (result.error as any).message || JSON.stringify(result.error)
      throw new Error(`Resend: ${msg}`)
    }
  }
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

export async function sendPasswordResetEmail(email: string, name: string, resetLink: string): Promise<void> {
  const cfg = await getEmailConfig()
  const brand = await getBranding()

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e0e0e0">
      <div style="background:#1a73e8;padding:28px;text-align:center">
        <h1 style="margin:0;font-size:20px;color:#fff;font-weight:500">Redefinição de Senha</h1>
      </div>
      <div style="padding:32px">
        <p style="font-size:14px;color:#202124;line-height:1.6;margin:0 0 16px">Olá <strong>${name}</strong>,</p>
        <p style="font-size:14px;color:#5f6368;line-height:1.6;margin:0 0 24px">Recebemos uma solicitação para redefinir a senha da sua conta no ${brand.brandName}. Clique no botão abaixo para criar uma nova senha:</p>
        <div style="text-align:center;margin:28px 0">
          <a href="${resetLink}" style="background:#1a73e8;color:#fff;padding:12px 32px;border-radius:4px;text-decoration:none;font-weight:500;font-size:14px;display:inline-block">Redefinir minha senha</a>
        </div>
        <p style="font-size:12px;color:#5f6368;line-height:1.6;margin:0 0 8px">Este link expira em <strong>30 minutos</strong>.</p>
        <p style="font-size:12px;color:#5f6368;line-height:1.6;margin:0">Se você não solicitou essa alteração, ignore este email.</p>
        <hr style="border:none;border-top:1px solid #e0e0e0;margin:24px 0">
        <p style="font-size:11px;color:#9aa0a6;margin:0;text-align:center">${brand.brandName}</p>
      </div>
    </div>`

  // Reset de senha é transacional crítico — sempre dispara, mesmo se admin
  // tentar desativar o template (ignora o flag enabled).
  const renderedReset = await renderSystemEmail('password_reset', {
    user: { name, email },
    resetLink,
    brand,
    ...nowVars(),
  })
  const finalResetSubject = renderedReset?.subject || `Redefinição de senha — ${brand.brandName}`
  const finalResetHtml    = renderedReset?.html    || html

  await sendEmailGeneric({
    from: getFromAddress(cfg, 'Sistema'),
    to: email,
    subject: finalResetSubject,
    html: finalResetHtml,
  })
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
