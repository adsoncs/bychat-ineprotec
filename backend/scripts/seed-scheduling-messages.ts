// scripts/seed-scheduling-messages.ts
// Cria (idempotente) os modelos de mensagem do agendamento e os workflows de
// "novo lead → avisar operador" (Faculdades e Escolas). Os modelos têm uma CHAVE
// estável (`key`) usada pelo código + um NOME de exibição em português (editável).
// Idempotente por `key` (não sobrescreve textos/nome já editados). Form por NOME.
//
// Uso: npx tsx scripts/seed-scheduling-messages.ts

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

type Tpl = { key: string; name: string; channel: 'whatsapp' | 'email'; category: string; subject?: string; body: string; bodyHtml?: string }

// ── Modelos de notificação de reunião ──
const BOOKING_TEMPLATES: Tpl[] = [
  { key: 'agendamento_confirmado_wa', name: 'Agendamento confirmado (WhatsApp)', channel: 'whatsapp', category: 'reminder',
    body: '{{saudacao}}\n\n✅ *Reunião confirmada: {{reuniao}}*\n📅 {{quando}}{{link}}' },
  { key: 'agendamento_lembrete_wa', name: 'Agendamento lembrete (WhatsApp)', channel: 'whatsapp', category: 'reminder',
    body: '{{saudacao}}\n\n⏰ *Lembrete: {{reuniao}}*\n📅 {{quando}}{{link}}' },
  { key: 'agendamento_cancelado_wa', name: 'Agendamento cancelado (WhatsApp)', channel: 'whatsapp', category: 'reminder',
    body: 'Seu agendamento de *{{reuniao}}* ({{quando}}) foi *cancelado*.' },
  { key: 'agendamento_confirmado_email', name: 'Agendamento confirmado (E-mail)', channel: 'email', category: 'reminder',
    subject: '{{titulo}}: {{reuniao}} — {{quando}}',
    body: '{{titulo}}: {{reuniao}} — {{quando}}',
    bodyHtml: '<div style="font-family:system-ui;max-width:560px;margin:0 auto"><h2 style="color:#1a73e8">{{titulo}}: {{reuniao}}</h2><p>{{saudacao}}</p><p>📅 <b>{{quando}}</b></p>{{linkHtml}}<p style="margin-top:20px;font-size:13px;color:#5f6368">Para remarcar ou cancelar, fale com a nossa equipe.</p></div>' },
  { key: 'agendamento_lembrete_email', name: 'Agendamento lembrete (E-mail)', channel: 'email', category: 'reminder',
    subject: '{{titulo}}: {{reuniao}} — {{quando}}',
    body: '{{titulo}}: {{reuniao}} — {{quando}}',
    bodyHtml: '<div style="font-family:system-ui;max-width:560px;margin:0 auto"><h2 style="color:#1a73e8">{{titulo}}: {{reuniao}}</h2><p>{{saudacao}}</p><p>📅 <b>{{quando}}</b></p>{{linkHtml}}<p style="margin-top:20px;font-size:13px;color:#5f6368">Para remarcar ou cancelar, fale com a nossa equipe.</p></div>' },
  // Aviso ao OPERADOR/dono da agenda. Vars: {{operador}} {{nome}} {{telefone}} {{emailLead}} {{reuniao}} {{quando}} {{link}}/{{linkHtml}}
  { key: 'agendamento_operador_wa', name: 'Agendamento — aviso ao operador (WhatsApp)', channel: 'whatsapp', category: 'reminder',
    body: '🗓️ *Novo agendamento: {{reuniao}}*\n👤 {{nome}}{{telefone}}\n📅 {{quando}}{{link}}' },
  { key: 'agendamento_operador_email', name: 'Agendamento — aviso ao operador (E-mail)', channel: 'email', category: 'reminder',
    subject: 'Novo agendamento: {{nome}} — {{quando}}',
    body: 'Novo agendamento: {{nome}} — {{quando}}',
    bodyHtml: '<div style="font-family:system-ui;max-width:560px;margin:0 auto"><h3>🗓️ Novo agendamento: {{reuniao}}</h3><p>Com: <b>{{nome}}</b> · {{telefone}} · {{emailLead}}</p><p>📅 {{quando}}</p>{{linkHtml}}</div>' },
]

// ── Modelos de aviso de novo lead ao operador (por vertical) ──
function newLeadTpls(slug: string, vertical: string): Tpl[] {
  return [
    { key: `novo_lead_${slug}_wa`, name: `Novo lead ${vertical} — operador (WhatsApp)`, channel: 'whatsapp', category: 'general',
      body: `🎯 *Novo lead — ${vertical}*\n\n👤 {{nome}}\n🏢 {{empresa}}\n📱 {{whatsapp}}\n✉️ {{email}}\n📍 Etapa: {{etapa}}\n\n_Atribuído a:_ {{operador}}` },
    { key: `novo_lead_${slug}_email`, name: `Novo lead ${vertical} — operador (E-mail)`, channel: 'email', category: 'general',
      subject: `Novo lead (${vertical}): {{nome}}`,
      body: `Novo lead (${vertical}): {{nome}} — {{whatsapp}}`,
      bodyHtml: `<div style="font-family:system-ui;max-width:560px;margin:0 auto"><h2 style="color:#1a73e8">🎯 Novo lead — ${vertical}</h2><p><b>{{nome}}</b></p><ul><li>Empresa: {{empresa}}</li><li>WhatsApp: {{whatsapp}}</li><li>E-mail: {{email}}</li><li>Etapa: {{etapa}}</li><li>Responsável: {{operador}}</li></ul></div>` },
  ]
}

async function upsertTemplate(t: Tpl): Promise<number> {
  const existing = await prisma.messageTemplate.findFirst({ where: { key: t.key } })
  if (existing) { console.log(`  = modelo [${t.key}] (#${existing.id}) já existe — preservado`); return existing.id }
  const created = await prisma.messageTemplate.create({ data: {
    key: t.key, name: t.name, channel: t.channel, category: t.category,
    ...(t.subject ? { subject: t.subject } : {}), body: t.body, ...(t.bodyHtml ? { bodyHtml: t.bodyHtml } : {}), active: true,
  } })
  console.log(`  + modelo [${t.key}] "${t.name}" (#${created.id}) criado`)
  return created.id
}

async function resolveForm(fragments: string[]): Promise<{ id: number; name: string } | null> {
  const forms = await prisma.form.findMany({ select: { id: true, name: true } })
  const norm = (s: string) => s.toLowerCase()
  return forms.find((f) => fragments.every((frag) => norm(f.name).includes(norm(frag)))) ?? null
}

async function upsertNewLeadWorkflow(wfName: string, formFragments: string[], waTemplateId: number, emailTemplateId: number) {
  const existing = await prisma.workflow.findFirst({ where: { name: wfName } })
  if (existing) { console.log(`  = workflow "${wfName}" (#${existing.id}) já existe — preservado`); return }
  const form = await resolveForm(formFragments)
  if (!form) { console.warn(`  ! form não encontrado p/ [${formFragments.join('+')}] — workflow "${wfName}" NÃO criado`); return }
  const wf = await prisma.workflow.create({ data: {
    name: wfName,
    description: 'Avisa o operador responsável (WhatsApp + e-mail) quando um novo lead é criado.',
    triggerEvent: 'lead.created',
    triggerConfig: { formId: form.id },
    active: true,
    reentryPolicy: 'after_completion',
  } })
  await prisma.workflowStep.create({ data: {
    workflowId: wf.id, type: 'action', name: 'Avisar operador',
    config: { actionType: 'notify_operator', waTemplateId, emailTemplateId },
    position: 0,
  } })
  console.log(`  + workflow "${wfName}" (#${wf.id}) criado → form #${form.id} "${form.name}"`)
}

async function main() {
  console.log('Modelos de reunião:')
  for (const t of BOOKING_TEMPLATES) await upsertTemplate(t)

  console.log('Modelos de novo lead (por vertical):')
  const facWa = await upsertTemplate(newLeadTpls('faculdades', 'Faculdades')[0]!)
  const facEm = await upsertTemplate(newLeadTpls('faculdades', 'Faculdades')[1]!)
  const escWa = await upsertTemplate(newLeadTpls('escolas', 'Escolas')[0]!)
  const escEm = await upsertTemplate(newLeadTpls('escolas', 'Escolas')[1]!)

  console.log('Workflows de aviso de novo lead:')
  await upsertNewLeadWorkflow('Novo lead — Faculdades (avisar operador)', ['tráfego', 'faculdade'], facWa, facEm)
  await upsertNewLeadWorkflow('Novo lead — Escolas (avisar operador)', ['tráfego', 'escola'], escWa, escEm)

  console.log('\nPronto. Edite os textos/nome em Modelos (a CHAVE interna não muda). Defina o WhatsApp de aviso de cada operador em Usuários.')
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
