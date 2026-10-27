// src/services/systemEmailTemplates.ts
//
// Templates de email do sistema editáveis pelo painel
// Configurações > Emails do Sistema (superadmin).
//
// O código chama `renderSystemEmail('password_reset', { user })`, que devolve
// `{ subject, html }` com placeholders substituídos. Os textos abaixo são só o
// conteúdo inicial gravado no banco na primeira subida; daí em diante vale o
// que estiver editado na tela.
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
    key: 'password_reset',
    name: 'Reset de senha',
    description: 'Email transacional de recuperação de senha (link único por 30 min). Usado no "Esqueci minha senha" e no "Enviar link de redefinição" da tela de Usuários.',
    category: 'auth',
    subject: 'Redefinição de senha — {{brand.brandName}}',
    // Tabela + estilo inline: é o que Outlook e Gmail respeitam. O link também
    // vai em texto, porque há leitor que bloqueia botão ("não funcionou").
    htmlBody: `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Redefinição de senha</title></head>
<body style="margin:0;padding:0;background:#f4f5f7">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 12px">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;font-family:Arial,Helvetica,sans-serif">
      <tr><td align="center" style="padding:0 0 20px">{{brand.logoHtml}}</td></tr>
      <tr><td style="background:#ffffff;border:1px solid #e3e6ea;border-radius:12px;padding:36px 32px">
        <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#111827;font-weight:700">Redefinir sua senha</h1>
        <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#374151">Olá, <strong>{{user.name}}</strong>.</p>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#374151">Recebemos um pedido para redefinir a senha da sua conta em <strong>{{brand.brandName}}</strong> ({{user.email}}). Para criar uma nova senha, clique no botão abaixo:</p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 24px"><tr>
          <td align="center" bgcolor="{{brand.color}}" style="border-radius:8px">
            <a href="{{resetLink}}" target="_blank" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:700;color:{{brand.textOnColor}};text-decoration:none;border-radius:8px">Criar nova senha</a>
          </td>
        </tr></table>
        <p style="margin:0 0 20px;font-size:13px;line-height:1.6;color:#6b7280;text-align:center">O link vale por <strong>{{expiraMinutos}} minutos</strong> e só pode ser usado uma vez.</p>
        <p style="margin:0 0 6px;font-size:13px;line-height:1.6;color:#6b7280">Se o botão não funcionar, copie e cole este endereço no navegador:</p>
        <p style="margin:0 0 24px;font-size:12px;line-height:1.5;word-break:break-all"><a href="{{resetLink}}" target="_blank" style="color:{{brand.linkColor}}">{{resetLink}}</a></p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px solid #e5e7eb;padding-top:20px">
          <p style="margin:0;font-size:13px;line-height:1.6;color:#6b7280"><strong style="color:#374151">Não foi você?</strong> Ignore este e-mail: sua senha atual continua valendo. Nunca pedimos sua senha por e-mail, telefone ou WhatsApp.</p>
        </td></tr></table>
      </td></tr>
      <tr><td align="center" style="padding:20px 12px 0;font-size:12px;line-height:1.5;color:#9ca3af">{{brand.brandName}} · e-mail automático enviado em {{now.full}}</td></tr>
    </table>
  </td></tr>
</table>
</body></html>`,
    variables: [
      { name: 'user.name', description: 'Nome do usuário' },
      { name: 'user.email', description: 'E-mail do usuário' },
      { name: 'resetLink', description: 'Link único de reset (expira em 30 min)' },
      { name: 'expiraMinutos', description: 'Validade do link, em minutos' },
      { name: 'brand.brandName', description: 'Nome da marca' },
      { name: 'brand.color', description: 'Cor principal da marca (Aparência), em #hex' },
      { name: 'brand.textOnColor', description: 'Cor do texto sobre a cor da marca (escuro se a cor for clara)' },
      { name: 'brand.linkColor', description: 'Cor de link legível no fundo branco' },
      { name: 'brand.logoHtml', description: 'Logo da marca (imagem) ou, sem logo, o nome em texto' },
      { name: 'now.full', description: 'Data e hora do envio' },
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

// Modelos que deixaram de existir. O aviso de novo lead passou para o fluxo
// "Avisar equipe — Novo lead captado"; o relatório de diagnóstico foi removido.
// Só sai do banco o que ninguém editou (updatedById nulo) — editado fica, desligado.
const MODELOS_DESCONTINUADOS = ['notify_new_lead_admin', 'lead_diagnostic_report']

export async function seedSystemEmailTemplates(): Promise<void> {
  await prisma.systemEmailTemplate.deleteMany({ where: { key: { in: MODELOS_DESCONTINUADOS }, updatedById: null } }).catch(() => {})
  await prisma.systemEmailTemplate.updateMany({ where: { key: { in: MODELOS_DESCONTINUADOS } }, data: { enabled: false } }).catch(() => {})
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

export function renderString(tpl: string, vars: Record<string, unknown>): string {
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
