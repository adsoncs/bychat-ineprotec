// src/services/systemEmailTemplates.ts
//
// Templates de email do sistema editáveis pelo painel
// Configurações > Emails do Sistema (superadmin).
//
// O code chama `renderSystemEmail('lead_diagnostic_report', { lead })` que
// devolve `{ subject, html }` com placeholders substituídos. Se o template
// estiver disabled ou ausente no banco, usa o fallback hardcoded.
//
// Sintaxe: `{{ campo.subcampo }}` (espaços são opcionais).
// Exemplo: `{{ lead.nome }}` busca em `vars.lead.nome`. Caminhos faltantes
// renderizam string vazia (não quebram o template).

import { prisma } from '../lib/prisma.js'

export interface TemplateVariable {
  name: string
  description: string
}

export interface SystemEmailTemplateSeed {
  key: string
  name: string
  description: string
  subject: string
  htmlBody: string
  variables: TemplateVariable[]
  category: 'system' | 'lifecycle' | 'auth' | 'manual'
}

// ─── Seeds (defaults aplicados na primeira execução) ─────

export const SYSTEM_EMAIL_TEMPLATES: SystemEmailTemplateSeed[] = [
  {
    key: 'notify_new_lead_admin',
    name: 'Novo lead — notificação ao time',
    description: 'Email enviado pra equipe (NOTIFY_EMAIL_TO/CC) quando um lead novo entra no funil.',
    category: 'lifecycle',
    subject: '🎯 Novo lead: {{lead.nome}} ({{lead.empresa}}) — Score {{scores.geral}}/100 · {{lead.solucaoNome}}',
    htmlBody: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e0e3e7">
  <div style="background:#1a73e8;padding:24px 28px;color:#fff">
    <h1 style="margin:0;font-size:20px;font-weight:600">🎯 Novo lead — {{brand.brandName}}</h1>
    <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:13px">{{now.full}}</p>
  </div>
  <div style="padding:24px 28px;color:#202124">
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr><td style="padding:6px 0;color:#5f6368">Empresa</td><td style="padding:6px 0;text-align:right"><strong>{{lead.empresa}}</strong></td></tr>
      <tr><td style="padding:6px 0;color:#5f6368">Contato</td><td style="padding:6px 0;text-align:right">{{lead.nome}}</td></tr>
      <tr><td style="padding:6px 0;color:#5f6368">WhatsApp</td><td style="padding:6px 0;text-align:right"><a href="https://wa.me/55{{lead.whatsappDigits}}" style="color:#1a73e8;text-decoration:none">{{lead.whatsapp}}</a></td></tr>
      <tr><td style="padding:6px 0;color:#5f6368">E-mail</td><td style="padding:6px 0;text-align:right">{{lead.email}}</td></tr>
      <tr><td style="padding:6px 0;color:#5f6368">Segmento</td><td style="padding:6px 0;text-align:right">{{lead.segmento}}</td></tr>
      <tr><td style="padding:6px 0;color:#5f6368">Cidade</td><td style="padding:6px 0;text-align:right">{{lead.cidade}}</td></tr>
    </table>
    <div style="background:#e8f0fe;border-left:3px solid #1a73e8;border-radius:6px;padding:14px 16px;margin:18px 0">
      <div style="display:flex;gap:18px;flex-wrap:wrap">
        <div><div style="font-size:11px;color:#5f6368">Score Geral</div><div style="font-size:22px;font-weight:700;color:#1a73e8">{{scores.geral}}</div></div>
        <div><div style="font-size:11px;color:#5f6368">Marketing</div><div style="font-size:18px;font-weight:600;color:#1a73e8">{{scores.mkt}}</div></div>
        <div><div style="font-size:11px;color:#5f6368">Vendas</div><div style="font-size:18px;font-weight:600;color:#1a73e8">{{scores.vnd}}</div></div>
        <div><div style="font-size:11px;color:#5f6368">Oferta</div><div style="font-size:18px;font-weight:600;color:#1a73e8">{{scores.oferta}}</div></div>
      </div>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr><td style="padding:6px 0;color:#5f6368">Maturidade</td><td style="padding:6px 0;text-align:right">{{lead.maturidade}}</td></tr>
      <tr><td style="padding:6px 0;color:#5f6368">Solução indicada</td><td style="padding:6px 0;text-align:right"><strong style="color:#1a73e8">{{lead.solucaoNome}}</strong></td></tr>
      <tr><td style="padding:6px 0;color:#5f6368">Investimento</td><td style="padding:6px 0;text-align:right">{{investmentLabel}}</td></tr>
    </table>
    <div style="margin-top:22px;text-align:center">
      <a href="https://wa.me/55{{lead.whatsappDigits}}" style="background:#1a73e8;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;display:inline-block">Contatar via WhatsApp →</a>
    </div>
  </div>
  <div style="background:#f8f9fa;padding:14px 28px;text-align:center;font-size:11px;color:#80868b;border-top:1px solid #e8eaed">
    {{brand.brandName}} · Sistema interno
  </div>
</div>`,
    variables: [
      { name: 'lead.nome', description: 'Nome do lead' },
      { name: 'lead.empresa', description: 'Empresa do lead' },
      { name: 'lead.whatsapp', description: 'WhatsApp formatado' },
      { name: 'lead.whatsappDigits', description: 'WhatsApp só dígitos (pra link wa.me)' },
      { name: 'lead.email', description: 'E-mail do lead' },
      { name: 'lead.segmento', description: 'Segmento de mercado' },
      { name: 'lead.cidade', description: 'Cidade' },
      { name: 'lead.maturidade', description: 'Maturidade comercial' },
      { name: 'lead.solucaoNome', description: 'Solução recomendada' },
      { name: 'scores.geral', description: 'Score geral 0-100' },
      { name: 'scores.mkt', description: 'Score de marketing' },
      { name: 'scores.vnd', description: 'Score de vendas' },
      { name: 'scores.oferta', description: 'Score de oferta' },
      { name: 'investmentLabel', description: 'Faixa de investimento (label)' },
      { name: 'brand.brandName', description: 'Nome da marca' },
      { name: 'now.full', description: 'Data/hora atual (pt-BR)' },
    ],
  },
  {
    key: 'lead_diagnostic_report',
    name: 'Diagnóstico — envio ao lead',
    description: 'Email de diagnóstico/raio-x enviado ao próprio lead após completar o formulário.',
    category: 'lifecycle',
    subject: '🎯 Seu Raio-X de Growth está pronto — Score {{scores.geral}}/100 · {{lead.empresa}}',
    htmlBody: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e0e3e7">
  <div style="background:#1a73e8;padding:28px;text-align:center;color:#fff">
    <h1 style="margin:0;font-size:22px;font-weight:600">Seu Raio-X de Growth</h1>
    <p style="margin:8px 0 0;font-size:13px;color:rgba(255,255,255,0.85)">{{lead.empresa}}</p>
  </div>
  <div style="padding:28px;color:#202124">
    <p style="font-size:14px;line-height:1.6">Olá <strong>{{lead.nome}}</strong>,</p>
    <p style="font-size:14px;line-height:1.6;color:#5f6368">Aqui está o resultado da análise da {{brand.brandName}} sobre a sua operação. Use isso pra priorizar onde investir nas próximas semanas.</p>
    <div style="background:#e8f0fe;border-left:3px solid #1a73e8;border-radius:8px;padding:18px;margin:22px 0;text-align:center">
      <div style="font-size:11px;color:#5f6368;text-transform:uppercase;letter-spacing:0.05em">Score Geral</div>
      <div style="font-size:42px;font-weight:700;color:#1a73e8;line-height:1">{{scores.geral}}</div>
      <div style="font-size:13px;color:#5f6368;margin-top:4px">Maturidade: <strong style="color:#202124">{{lead.maturidade}}</strong></div>
    </div>
    <h3 style="font-size:14px;color:#1a73e8;margin:18px 0 8px">🚀 Solução Recomendada</h3>
    <div style="background:#f8f9fa;border:1px solid #e0e3e7;border-radius:8px;padding:16px">
      <div style="font-size:18px;font-weight:700;color:#202124">{{lead.solucaoNome}}</div>
    </div>
    <div style="margin-top:24px;text-align:center">
      <a href="https://wa.me/55{{lead.whatsappDigits}}" style="background:#1a73e8;color:#fff;padding:14px 30px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;display:inline-block">Falar com a {{brand.brandName}} →</a>
      <p style="margin-top:10px;font-size:12px;color:#80868b">Clique pra agendar uma conversa sobre seu diagnóstico</p>
    </div>
  </div>
  <div style="background:#f8f9fa;padding:14px 28px;text-align:center;font-size:11px;color:#80868b;border-top:1px solid #e8eaed">
    {{brand.brandName}} · {{now.date}}
  </div>
</div>`,
    variables: [
      { name: 'lead.nome', description: 'Nome do lead' },
      { name: 'lead.empresa', description: 'Empresa do lead' },
      { name: 'lead.email', description: 'E-mail do lead' },
      { name: 'lead.whatsappDigits', description: 'WhatsApp só dígitos' },
      { name: 'lead.maturidade', description: 'Maturidade comercial' },
      { name: 'lead.solucaoNome', description: 'Solução recomendada' },
      { name: 'scores.geral', description: 'Score geral 0-100' },
      { name: 'brand.brandName', description: 'Nome da marca' },
      { name: 'now.date', description: 'Data atual (pt-BR)' },
    ],
  },
  {
    key: 'password_reset',
    name: 'Reset de senha',
    description: 'Email transacional de recuperação de senha (link único por 30 min).',
    category: 'auth',
    subject: 'Redefinição de senha — {{brand.brandName}}',
    htmlBody: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e0e3e7">
  <div style="background:#1a73e8;padding:28px;text-align:center">
    <h1 style="margin:0;font-size:20px;color:#fff;font-weight:500">Redefinição de Senha</h1>
  </div>
  <div style="padding:32px">
    <p style="font-size:14px;color:#202124;line-height:1.6;margin:0 0 16px">Olá <strong>{{user.name}}</strong>,</p>
    <p style="font-size:14px;color:#5f6368;line-height:1.6;margin:0 0 24px">Recebemos uma solicitação para redefinir a senha da sua conta no {{brand.brandName}}. Clique no botão abaixo para criar uma nova senha:</p>
    <div style="text-align:center;margin:28px 0">
      <a href="{{resetLink}}" style="background:#1a73e8;color:#fff;padding:12px 32px;border-radius:4px;text-decoration:none;font-weight:500;font-size:14px;display:inline-block">Redefinir minha senha</a>
    </div>
    <p style="font-size:12px;color:#5f6368;line-height:1.6;margin:0 0 8px">Este link expira em <strong>30 minutos</strong>.</p>
    <p style="font-size:12px;color:#5f6368;line-height:1.6;margin:0">Se você não solicitou essa alteração, ignore este email.</p>
    <hr style="border:none;border-top:1px solid #e0e0e0;margin:24px 0">
    <p style="font-size:11px;color:#9aa0a6;margin:0;text-align:center">{{brand.brandName}}</p>
  </div>
</div>`,
    variables: [
      { name: 'user.name', description: 'Nome do usuário' },
      { name: 'user.email', description: 'E-mail do usuário' },
      { name: 'resetLink', description: 'Link único de reset (expira em 30 min)' },
      { name: 'brand.brandName', description: 'Nome da marca' },
    ],
  },
  {
    key: 'email_test',
    name: 'Teste de email (Configurações)',
    description: 'Email enviado pelo botão "Enviar email de teste" em Configurações > Email.',
    category: 'system',
    subject: '[teste] {{brand.brandName}} — Email funcionando',
    htmlBody: `<div style="font-family:system-ui,sans-serif;padding:24px;max-width:520px;margin:0 auto">
  <div style="border:1px solid #e0e3e7;border-radius:8px;padding:24px;background:#fff">
    <h2 style="margin:0 0 12px;color:#1a73e8;font-size:18px">✓ Email de teste enviado com sucesso</h2>
    <p style="font-size:14px;color:#5f6368;margin:0">Se você está vendo esta mensagem, o provedor de email do {{brand.brandName}} está corretamente configurado.</p>
    <p style="color:#9aa0a6;font-size:13px;margin-top:16px">Enviado em: {{now.full}}</p>
  </div>
</div>`,
    variables: [
      { name: 'brand.brandName', description: 'Nome da marca' },
      { name: 'now.full', description: 'Data/hora atual (pt-BR)' },
    ],
  },
  {
    key: 'activity_email_default',
    name: 'Activity tipo Email — defaults',
    description: 'Subject e corpo padrão sugeridos quando o operador cria uma Activity de tipo "Email" sem preencher o conteúdo.',
    category: 'manual',
    subject: '{{lead.nome}}, {{activity.title}}',
    htmlBody: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#202124">
  <p>Olá <strong>{{lead.nome}}</strong>,</p>
  <p>{{activity.body}}</p>
  <p style="margin-top:24px;color:#5f6368;font-size:13px">{{user.name}} · {{brand.brandName}}</p>
</div>`,
    variables: [
      { name: 'lead.nome', description: 'Nome do lead' },
      { name: 'lead.empresa', description: 'Empresa do lead' },
      { name: 'activity.title', description: 'Título da atividade' },
      { name: 'activity.body', description: 'Corpo da atividade preenchido pelo operador' },
      { name: 'user.name', description: 'Nome do operador' },
      { name: 'brand.brandName', description: 'Nome da marca' },
    ],
  },
]

// ─── Seed/upsert (executado no boot) ─────────────────────

export async function seedSystemEmailTemplates(): Promise<void> {
  for (const t of SYSTEM_EMAIL_TEMPLATES) {
    const exists = await prisma.systemEmailTemplate.findUnique({ where: { key: t.key }, select: { id: true } })
    if (exists) {
      // Não sobrescreve edições do usuário; só atualiza variáveis (que são informativas).
      await prisma.systemEmailTemplate.update({
        where: { key: t.key },
        data: { variables: t.variables as any, category: t.category, description: t.description },
      })
    } else {
      await prisma.systemEmailTemplate.create({
        data: {
          key: t.key,
          name: t.name,
          description: t.description,
          subject: t.subject,
          htmlBody: t.htmlBody,
          enabled: true,
          variables: t.variables as any,
          category: t.category,
        },
      })
    }
  }
}

// ─── Render: substitui {{ chave.subchave }} pelos valores ─

function getPath(obj: any, path: string): unknown {
  return path.split('.').reduce<any>((acc, k) => (acc == null ? acc : acc[k]), obj)
}

function renderString(tpl: string, vars: Record<string, unknown>): string {
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path) => {
    const v = getPath(vars, path)
    if (v === undefined || v === null) return ''
    return String(v)
  })
}

export interface RenderedEmail {
  subject: string
  html: string
  enabled: boolean
}

/**
 * Renderiza o template `key` substituindo variáveis. Se o template não existir
 * no banco (caso bizarro: alguém deletou), devolve `enabled=false` e os
 * fallbacks ficam por conta do código que chama.
 */
export async function renderSystemEmail(key: string, vars: Record<string, unknown>): Promise<RenderedEmail | null> {
  const tpl = await prisma.systemEmailTemplate.findUnique({ where: { key } })
  if (!tpl) return null
  if (!tpl.enabled) return { subject: '', html: '', enabled: false }
  return {
    subject: renderString(tpl.subject, vars),
    html: renderString(tpl.htmlBody, vars),
    enabled: true,
  }
}

// ─── Helpers de variáveis comuns ─────────────────────────

export function brandVars(brand: { brandName: string }) {
  return { brand }
}

export function nowVars() {
  const d = new Date()
  return {
    now: {
      full: d.toLocaleString('pt-BR'),
      date: d.toLocaleDateString('pt-BR'),
      time: d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      iso: d.toISOString(),
    },
  }
}
