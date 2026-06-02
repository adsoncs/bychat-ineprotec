// src/services/notificationSeed.ts
// Seed idempotente: cria templates (email + WhatsApp) e workflows padrão para
// os eventos de inscrição/documento. Chamado no startup do servidor.
//
// Os templates usam variáveis {{nome}}, {{candidateCode}}, {{courseName}},
// {{paymentUrl}}, {{paymentAmount}}, {{paymentDeadline}}, {{candidateUrl}},
// {{portalNome}}, {{docName}}, {{reviewNote}} — todas resolvidas pelo
// workflowActions.resolveVariables a partir do payload do evento.
//
// O admin pode editar livremente os templates e os workflows na UI; o seed
// só cria o que ainda não existe (chave: name único do template; trigger do
// workflow). Não sobrescreve customizações.

import { prisma } from '../lib/prisma.js'

interface TplDef { key: string; name: string; channel: 'whatsapp' | 'email'; subject?: string; body: string; bodyHtml?: string }
interface WfDef { key: string; name: string; description: string; triggerEvent: string; emailTplKey?: string; waTplKey?: string; active?: boolean }

const TEMPLATES: TplDef[] = [
  // ── Inscrição recebida ──
  {
    key: 'enrollment_submitted_email',
    name: 'Inscrição recebida (email)',
    channel: 'email',
    subject: 'Inscrição recebida — {{portalNome}} ({{candidateCode}})',
    body: 'Olá {{nome}}, sua inscrição em {{portalNome}} foi recebida. Código: {{candidateCode}}. Acompanhe em {{candidateUrl}}.',
    bodyHtml: `<div style="font-family:system-ui,sans-serif;background:#f6f7fb;padding:24px"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:28px">
<h1 style="color:#1a73e8;font-size:22px;margin:0 0 16px">Inscrição recebida! 🎓</h1>
<p>Olá <strong>{{nome}}</strong>, recebemos sua inscrição em <strong>{{portalNome}}</strong>.</p>
<p>Curso: <strong>{{courseName}}</strong></p>
<div style="background:#f0f7ff;border:1px solid #d2e3fc;border-radius:10px;padding:16px;text-align:center;margin:18px 0">
  <div style="font-size:11px;color:#5f6368;text-transform:uppercase">Código de candidato</div>
  <div style="font-size:22px;font-weight:700;color:#1a73e8;font-family:ui-monospace,monospace">{{candidateCode}}</div>
</div>
<p style="font-size:13px;color:#5f6368">Guarde este código para acompanhar sua inscrição.</p>
<div style="text-align:center;margin:18px 0"><a href="{{candidateUrl}}" style="display:inline-block;background:#1a73e8;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none">Acompanhar inscrição</a></div>
</div></div>`,
  },
  {
    key: 'enrollment_submitted_wa',
    name: 'Inscrição recebida (WhatsApp)',
    channel: 'whatsapp',
    body: `🎓 *Inscrição recebida — {{portalNome}}*

Olá {{nome}}!

📚 Curso: *{{courseName}}*
🪪 Código: *{{candidateCode}}*

{{ctaMessage}}

🔗 Acompanhe: {{candidateUrl}}`,
  },

  // ── Pagamento confirmado ──
  {
    key: 'enrollment_payment_confirmed_email',
    name: 'Pagamento confirmado (email)',
    channel: 'email',
    subject: 'Pagamento confirmado — {{candidateCode}}',
    body: 'Olá {{nome}}, confirmamos o pagamento em {{portalNome}}. Valor: {{paymentAmount}}. Acompanhe em {{candidateUrl}}.',
    bodyHtml: `<div style="font-family:system-ui,sans-serif;background:#f6f7fb;padding:24px"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:28px">
<h1 style="color:#137333;font-size:22px;margin:0 0 16px">Pagamento confirmado ✅</h1>
<p>Olá <strong>{{nome}}</strong>, confirmamos o pagamento da taxa de inscrição em <strong>{{portalNome}}</strong>.</p>
<p>Curso: <strong>{{courseName}}</strong></p>
<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:16px;text-align:center;margin:18px 0">
  <div style="font-size:11px;color:#5f6368;text-transform:uppercase">Código</div>
  <div style="font-size:20px;font-weight:700;color:#137333;font-family:ui-monospace,monospace">{{candidateCode}}</div>
  <div style="margin-top:8px;font-size:13px;color:#5f6368">Valor pago: <strong>{{paymentAmount}}</strong></div>
</div>
<p>Acompanhe sua inscrição: <a href="{{candidateUrl}}" style="color:#1a73e8">{{candidateUrl}}</a></p>
</div></div>`,
  },
  {
    key: 'enrollment_payment_confirmed_wa',
    name: 'Pagamento confirmado (WhatsApp)',
    channel: 'whatsapp',
    body: `✅ *Pagamento confirmado!*

Inscrição: *{{candidateCode}}*
📚 Curso: {{courseName}}
💰 Valor: {{paymentAmount}}

Sua inscrição está confirmada.
🔗 Acompanhe: {{candidateUrl}}`,
  },

  // ── Lembrete de pagamento ──
  {
    key: 'enrollment_payment_reminder_email',
    name: 'Lembrete de pagamento (email)',
    channel: 'email',
    subject: '⏰ Lembrete: inscrição {{candidateCode}} vence em breve',
    body: 'Sua inscrição {{candidateCode}} em {{portalNome}} vence em {{paymentDeadline}}. Pague em {{paymentUrl}}.',
    bodyHtml: `<div style="font-family:system-ui,sans-serif;background:#f6f7fb;padding:24px"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:28px">
<h1 style="color:#b06000;font-size:20px;margin:0 0 12px">⏰ Sua inscrição vence em breve</h1>
<p>Olá {{nome}}, sua inscrição <strong>{{candidateCode}}</strong> em <strong>{{portalNome}}</strong> expira em <strong>{{paymentDeadline}}</strong>.</p>
<p>Valor da taxa: <strong>{{paymentAmount}}</strong></p>
<div style="text-align:center;margin:20px 0"><a href="{{paymentUrl}}" style="display:inline-block;background:#1a73e8;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Pagar agora →</a></div>
<p style="font-size:11px;color:#9aa0a6">Se já pagou, ignore este lembrete.</p>
</div></div>`,
  },
  {
    key: 'enrollment_payment_reminder_wa',
    name: 'Lembrete de pagamento (WhatsApp)',
    channel: 'whatsapp',
    body: `⏰ *Lembrete — {{portalNome}}*

Olá {{nome}}, sua inscrição *{{candidateCode}}* vence em *{{paymentDeadline}}*.
💳 Valor: {{paymentAmount}}

Pague agora: {{paymentUrl}}
🔗 Acompanhe: {{candidateUrl}}`,
  },

  // ── Documento aprovado ──
  {
    key: 'enrollment_doc_approved_email',
    name: 'Documento aprovado (email)',
    channel: 'email',
    subject: 'Documento "{{docName}}" aprovado — {{candidateCode}}',
    body: 'Seu documento {{docName}} foi aprovado. Continue sua inscrição em {{candidateUrl}}.',
    bodyHtml: `<div style="font-family:system-ui,sans-serif;background:#f6f7fb;padding:24px"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:28px">
<h1 style="color:#137333;font-size:20px;margin:0 0 12px">✅ Documento aprovado</h1>
<p>Olá {{nome}}, seu documento <strong>{{docName}}</strong> referente à inscrição em <strong>{{portalNome}}</strong> foi aprovado pela equipe acadêmica.</p>
<div style="text-align:center;margin:20px 0"><a href="{{candidateUrl}}" style="display:inline-block;background:#1a73e8;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none">Acompanhar inscrição</a></div>
<p style="font-size:11px;color:#9aa0a6">Código: <strong>{{candidateCode}}</strong></p>
</div></div>`,
  },
  {
    key: 'enrollment_doc_approved_wa',
    name: 'Documento aprovado (WhatsApp)',
    channel: 'whatsapp',
    body: `✅ *Documento aprovado*

Olá {{nome}}, seu documento *{{docName}}* foi aprovado.

🔗 Acompanhe: {{candidateUrl}}
Código: *{{candidateCode}}*`,
  },

  // ── Documento rejeitado ──
  {
    key: 'enrollment_doc_rejected_email',
    name: 'Documento rejeitado (email)',
    channel: 'email',
    subject: 'Documento "{{docName}}" precisa de ajuste — {{candidateCode}}',
    body: 'Seu documento {{docName}} não foi aprovado. Motivo: {{reviewNote}}. Reenvie em {{candidateUrl}}.',
    bodyHtml: `<div style="font-family:system-ui,sans-serif;background:#f6f7fb;padding:24px"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:28px">
<h1 style="color:#c5221f;font-size:20px;margin:0 0 12px">⚠ Documento precisa de ajuste</h1>
<p>Olá <strong>{{nome}}</strong>, recebemos seu documento <strong>{{docName}}</strong> referente à inscrição em <strong>{{portalNome}}</strong>, mas ele não foi aprovado.</p>
<div style="background:#fef2f2;border:1px solid #fad2cf;border-radius:10px;padding:16px;margin:18px 0">
  <div style="font-size:11px;color:#c5221f;text-transform:uppercase;font-weight:600;margin-bottom:6px">Motivo</div>
  <div style="color:#3c4043;font-size:14px;line-height:1.6">{{reviewNote}}</div>
</div>
<p>Acesse seu portal para reenviar o documento corrigido. A análise é refeita assim que recebermos.</p>
<div style="text-align:center;margin:20px 0"><a href="{{candidateUrl}}" style="display:inline-block;background:#1a73e8;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Reenviar documento</a></div>
<p style="font-size:11px;color:#9aa0a6">Código: <strong>{{candidateCode}}</strong></p>
</div></div>`,
  },
  {
    key: 'enrollment_doc_rejected_wa',
    name: 'Documento rejeitado (WhatsApp)',
    channel: 'whatsapp',
    body: `⚠ *Documento precisa de ajuste*

Olá {{nome}}, seu documento *{{docName}}* não foi aprovado.

📝 *Motivo:* {{reviewNote}}

Reenvie pelo portal:
{{candidateUrl}}

Código: *{{candidateCode}}*`,
  },

  // ── ENEM — boletim aprovado ──
  {
    key: 'enrollment_enem_approved_email',
    name: 'ENEM aprovado (email)',
    channel: 'email',
    subject: 'Nota do ENEM aprovada — {{candidateCode}}',
    body: 'Olá {{nome}}, sua nota do ENEM foi validada e atende aos requisitos. Acompanhe em {{candidateUrl}}.',
    bodyHtml: `<div style="font-family:system-ui,sans-serif;background:#f6f7fb;padding:24px"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:28px">
<h1 style="color:#137333;font-size:22px;margin:0 0 16px">Nota do ENEM aprovada ✅</h1>
<p>Olá <strong>{{nome}}</strong>, sua nota do ENEM foi validada e atende aos requisitos do curso.</p>
<p>Curso: <strong>{{courseName}}</strong></p>
<p>Média: <strong>{{mediaSimples}}</strong></p>
<div style="text-align:center;margin:18px 0"><a href="{{candidateUrl}}" style="display:inline-block;background:#137333;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none">Acompanhar inscrição</a></div>
</div></div>`,
  },
  {
    key: 'enrollment_enem_approved_wa',
    name: 'ENEM aprovado (WhatsApp)',
    channel: 'whatsapp',
    body: `✅ *Nota do ENEM aprovada!*

Olá {{nome}}, sua nota do ENEM foi validada — atende aos requisitos.

📚 Curso: *{{courseName}}*
📝 Média: *{{mediaSimples}}*

Acompanhe: {{candidateUrl}}
Código: *{{candidateCode}}*`,
  },

  // ── ENEM — boletim rejeitado ──
  {
    key: 'enrollment_enem_rejected_email',
    name: 'ENEM rejeitado (email)',
    channel: 'email',
    subject: 'Análise da nota do ENEM — {{candidateCode}}',
    body: 'Olá {{nome}}, sua nota do ENEM não atingiu o corte de {{courseName}}. {{validationNote}}',
    bodyHtml: `<div style="font-family:system-ui,sans-serif;background:#f6f7fb;padding:24px"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:28px">
<h1 style="color:#c5221f;font-size:22px;margin:0 0 16px">Resultado da análise ENEM</h1>
<p>Olá <strong>{{nome}}</strong>, infelizmente sua nota do ENEM não atingiu o corte para o curso <strong>{{courseName}}</strong>.</p>
<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:14px;margin:18px 0;font-size:13px;color:#991b1b">
  <strong>Observação:</strong> {{validationNote}}
</div>
<p style="font-size:13px;color:#5f6368">Você pode entrar em contato com a coordenação para mais opções ou se inscrever em outro curso.</p>
</div></div>`,
  },
  {
    key: 'enrollment_enem_rejected_wa',
    name: 'ENEM rejeitado (WhatsApp)',
    channel: 'whatsapp',
    body: `📋 *Resultado da análise ENEM*

Olá {{nome}}, sua nota do ENEM não atingiu o corte para *{{courseName}}*.

📝 {{validationNote}}

Entre em contato pelo portal:
{{candidateUrl}}`,
  },

  // ── Presencial — agendado ──
  {
    key: 'enrollment_presencial_scheduled_email',
    name: 'Vestibular Presencial agendado (email)',
    channel: 'email',
    subject: 'Sua prova foi agendada — {{candidateCode}}',
    body: 'Olá {{nome}}, sua prova presencial foi agendada para {{scheduledAt}} em {{location}}.',
    bodyHtml: `<div style="font-family:system-ui,sans-serif;background:#f6f7fb;padding:24px"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:28px">
<h1 style="color:#1a73e8;font-size:22px;margin:0 0 16px">Sua prova foi agendada 🏫</h1>
<p>Olá <strong>{{nome}}</strong>, sua prova presencial foi agendada.</p>
<div style="background:#f0f7ff;border:1px solid #d2e3fc;border-radius:10px;padding:16px;margin:18px 0">
  <div style="font-size:12px;color:#5f6368;text-transform:uppercase">Data e horário</div>
  <div style="font-size:18px;font-weight:600;color:#1a73e8;margin-bottom:10px">{{scheduledAt}}</div>
  <div style="font-size:12px;color:#5f6368;text-transform:uppercase">Local</div>
  <div style="font-size:14px;font-weight:500">{{location}}</div>
</div>
<p style="font-size:13px;color:#5f6368">Compareça com 30 minutos de antecedência levando documento de identidade com foto.</p>
<p style="font-size:11px;color:#9aa0a6">Código: <strong>{{candidateCode}}</strong></p>
</div></div>`,
  },
  {
    key: 'enrollment_presencial_scheduled_wa',
    name: 'Vestibular Presencial agendado (WhatsApp)',
    channel: 'whatsapp',
    body: `🏫 *Prova presencial agendada*

Olá {{nome}}!

📅 *Data:* {{scheduledAt}}
📍 *Local:* {{location}}

Compareça com 30 min de antecedência com documento com foto.

Código: *{{candidateCode}}*`,
  },

  // ── Presencial — aprovado ──
  {
    key: 'enrollment_presencial_approved_email',
    name: 'Vestibular Presencial aprovado (email)',
    channel: 'email',
    subject: 'Aprovado no Vestibular! — {{candidateCode}}',
    body: 'Parabéns, {{nome}}! Você foi aprovado no Vestibular Presencial de {{courseName}}.',
    bodyHtml: `<div style="font-family:system-ui,sans-serif;background:#f6f7fb;padding:24px"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:28px">
<h1 style="color:#137333;font-size:22px;margin:0 0 16px">Parabéns! Você foi aprovado 🎉</h1>
<p>Olá <strong>{{nome}}</strong>, você foi aprovado no Vestibular Presencial de <strong>{{courseName}}</strong>.</p>
<p>Nota: <strong>{{score}}</strong></p>
<div style="text-align:center;margin:22px 0"><a href="{{candidateUrl}}" style="display:inline-block;background:#137333;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600">Ver próximos passos</a></div>
</div></div>`,
  },
  {
    key: 'enrollment_presencial_approved_wa',
    name: 'Vestibular Presencial aprovado (WhatsApp)',
    channel: 'whatsapp',
    body: `🎉 *Parabéns, {{nome}}!*

Você foi *aprovado* no Vestibular Presencial.

📚 Curso: *{{courseName}}*
📝 Nota: *{{score}}*

Próximos passos: {{candidateUrl}}
Código: *{{candidateCode}}*`,
  },

  // ── Presencial — rejeitado ──
  {
    key: 'enrollment_presencial_rejected_email',
    name: 'Vestibular Presencial — resultado (email)',
    channel: 'email',
    subject: 'Resultado do Vestibular Presencial — {{candidateCode}}',
    body: 'Olá {{nome}}, infelizmente você não atingiu o corte para {{courseName}}. {{verdictReason}}',
    bodyHtml: `<div style="font-family:system-ui,sans-serif;background:#f6f7fb;padding:24px"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:28px">
<h1 style="color:#5f6368;font-size:22px;margin:0 0 16px">Resultado do Vestibular Presencial</h1>
<p>Olá <strong>{{nome}}</strong>, agradecemos sua participação no Vestibular Presencial de <strong>{{courseName}}</strong>.</p>
<p>Infelizmente, sua nota não atingiu o corte para a vaga.</p>
<p style="font-size:13px;color:#5f6368">{{verdictReason}}</p>
<p style="font-size:13px;color:#5f6368">Entre em contato com a coordenação para conhecer outras opções.</p>
</div></div>`,
  },
  {
    key: 'enrollment_presencial_rejected_wa',
    name: 'Vestibular Presencial — resultado (WhatsApp)',
    channel: 'whatsapp',
    body: `📋 *Resultado do Vestibular Presencial*

Olá {{nome}}, agradecemos sua participação.

Infelizmente sua nota não atingiu o corte para *{{courseName}}*.

{{verdictReason}}

Entre em contato pelo portal:
{{candidateUrl}}`,
  },

  // ── Interesse capturado (form simples /interest) — magic link de continuação ──
  {
    key: 'enrollment_interest_email',
    name: 'Interesse capturado — link para completar matrícula (email)',
    channel: 'email',
    subject: 'Continue sua inscrição em {{continuationPortalNome}}',
    body: 'Olá {{nome}}, recebemos seu interesse. Para finalizar sua inscrição, acesse: {{continueUrl}}',
    bodyHtml: `<div style="font-family:system-ui,sans-serif;background:#f6f7fb;padding:24px"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px">
<h1 style="color:#1a73e8;font-size:24px;margin:0 0 12px">Falta pouco, {{nome}}! 🎓</h1>
<p style="font-size:15px;color:#3c4043">Recebemos seu interesse em <strong>{{portalNome}}</strong>{{courseName}} — falta só finalizar sua inscrição.</p>
<p style="font-size:14px;color:#5f6368;line-height:1.6">Clique no botão abaixo para abrir um formulário rápido com seus dados já preenchidos. Você só precisa completar com algumas informações finais (CPF, endereço, etc).</p>
<div style="text-align:center;margin:24px 0">
  <a href="{{continueUrl}}" style="display:inline-block;background:#1a73e8;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">Completar minha inscrição →</a>
</div>
<div style="background:#f0f7ff;border:1px solid #d2e3fc;border-radius:8px;padding:14px;font-size:12px;color:#5f6368;margin-top:18px">
  ⏰ <strong>Este link expira em {{ttlDays}} dias.</strong> Se ele perder a validade, você pode pedir um novo na mesma página de inscrição.
</div>
<p style="font-size:11px;color:#9aa0a6;margin-top:20px">Se você não solicitou esta inscrição, pode ignorar este e-mail.</p>
</div></div>`,
  },
  {
    key: 'enrollment_interest_wa',
    name: 'Interesse capturado — link para completar (WhatsApp)',
    channel: 'whatsapp',
    body: `🎓 Olá *{{nome}}*!

Recebemos seu interesse em *{{portalNome}}*{{courseName}}.

Para *finalizar sua inscrição*, abra o link abaixo (já com seus dados preenchidos):

👉 {{continueUrl}}

⏰ O link expira em {{ttlDays}} dias.`,
  },

  // ── Redação — recebida (confirmação ao candidato) ──
  {
    key: 'enrollment_essay_submitted_email',
    name: 'Redação recebida (email)',
    channel: 'email',
    subject: 'Recebemos sua redação — {{candidateCode}}',
    body: 'Olá {{nome}}, recebemos sua redação ({{wordCount}} palavras). O resultado será divulgado em breve.',
    bodyHtml: `<div style="font-family:system-ui,sans-serif;background:#f6f7fb;padding:24px"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:28px">
<h1 style="color:#1a73e8;font-size:22px;margin:0 0 16px">Redação recebida ✍</h1>
<p>Olá <strong>{{nome}}</strong>, sua redação foi enviada com sucesso e está em avaliação.</p>
<p>Curso: <strong>{{courseName}}</strong></p>
<p>Total de palavras: <strong>{{wordCount}}</strong></p>
<p style="font-size:13px;color:#5f6368">Você será notificado assim que o resultado estiver disponível. Não é necessário fazer nada agora.</p>
<div style="text-align:center;margin:18px 0"><a href="{{candidateUrl}}" style="display:inline-block;background:#1a73e8;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none">Acompanhar inscrição</a></div>
</div></div>`,
  },
  {
    key: 'enrollment_essay_submitted_wa',
    name: 'Redação recebida (WhatsApp)',
    channel: 'whatsapp',
    body: `✍ *Redação recebida!*

Olá {{nome}}, recebemos sua redação para *{{courseName}}*.

📝 Total de palavras: *{{wordCount}}*

Você será avisado assim que o resultado estiver disponível.

Acompanhe: {{candidateUrl}}
Código: *{{candidateCode}}*`,
  },

  // ── Redação — aprovada ──
  {
    key: 'enrollment_essay_approved_email',
    name: 'Redação aprovada (email)',
    channel: 'email',
    subject: 'Sua redação foi aprovada — {{candidateCode}}',
    body: 'Olá {{nome}}, sua redação foi aprovada. Nota: {{finalScore}}.',
    bodyHtml: `<div style="font-family:system-ui,sans-serif;background:#f6f7fb;padding:24px"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:28px">
<h1 style="color:#137333;font-size:22px;margin:0 0 16px">Redação aprovada ✍✅</h1>
<p>Olá <strong>{{nome}}</strong>, sua redação foi avaliada e <strong>aprovada</strong>.</p>
<p>Curso: <strong>{{courseName}}</strong></p>
<p>Nota: <strong>{{finalScore}}</strong></p>
<div style="text-align:center;margin:18px 0"><a href="{{candidateUrl}}" style="display:inline-block;background:#137333;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none">Ver inscrição</a></div>
</div></div>`,
  },
  {
    key: 'enrollment_essay_approved_wa',
    name: 'Redação aprovada (WhatsApp)',
    channel: 'whatsapp',
    body: `✍ *Redação aprovada!*

Olá {{nome}}!

📚 Curso: *{{courseName}}*
📝 Nota: *{{finalScore}}*

Acompanhe: {{candidateUrl}}
Código: *{{candidateCode}}*`,
  },

  // ── Redação — rejeitada ──
  {
    key: 'enrollment_essay_rejected_email',
    name: 'Redação — resultado (email)',
    channel: 'email',
    subject: 'Resultado da sua redação — {{candidateCode}}',
    body: 'Olá {{nome}}, sua redação não atingiu a nota mínima. {{humanNote}}',
    bodyHtml: `<div style="font-family:system-ui,sans-serif;background:#f6f7fb;padding:24px"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:28px">
<h1 style="color:#c5221f;font-size:22px;margin:0 0 16px">Resultado da redação</h1>
<p>Olá <strong>{{nome}}</strong>, sua redação foi avaliada e não atingiu a nota mínima para o curso <strong>{{courseName}}</strong>.</p>
<p>Nota final: <strong>{{finalScore}}</strong></p>
<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:14px;margin:18px 0;font-size:13px;color:#991b1b">
  <strong>Observação:</strong> {{humanNote}}
</div>
<p style="font-size:13px;color:#5f6368">Você pode acessar o portal para mais informações.</p>
</div></div>`,
  },
  {
    key: 'enrollment_essay_rejected_wa',
    name: 'Redação — resultado (WhatsApp)',
    channel: 'whatsapp',
    body: `📋 *Resultado da redação*

Olá {{nome}}, sua redação não atingiu a nota mínima para *{{courseName}}*.

📝 Nota: *{{finalScore}}*
💬 {{humanNote}}

Mais detalhes: {{candidateUrl}}`,
  },

  // ── Lead lifecycle (usados por wf_lead_created_notify e wf_diagnosis_report_to_lead) ──
  {
    key: 'lead_created_admin_email',
    name: 'Novo lead — notificação à equipe (Fluxo)',
    channel: 'email',
    subject: '🎯 Novo lead: {{lead.nome}} ({{lead.empresa}})',
    bodyHtml: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e0e3e7">
  <div style="background:#1a73e8;padding:24px 28px;color:#fff">
    <h1 style="margin:0;font-size:20px;font-weight:600">🎯 Novo lead</h1>
  </div>
  <div style="padding:24px 28px;color:#202124;font-size:14px">
    <p><strong>Empresa:</strong> {{lead.empresa}}</p>
    <p><strong>Contato:</strong> {{lead.nome}}</p>
    <p><strong>WhatsApp:</strong> {{lead.whatsapp}}</p>
    <p><strong>E-mail:</strong> {{lead.email}}</p>
    <p><strong>Score Geral:</strong> {{lead.scores.geral}}/100</p>
    <p><strong>Solução indicada:</strong> {{lead.solucaoNome}}</p>
  </div>
</div>`,
    body: 'Novo lead: {{lead.nome}} ({{lead.empresa}}) — Score {{lead.scores.geral}}/100',
  },
  {
    key: 'lead_diagnostic_email',
    name: 'Diagnóstico ao lead (Fluxo)',
    channel: 'email',
    subject: '🎯 Seu Raio-X de Growth está pronto — {{lead.empresa}}',
    bodyHtml: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e0e3e7">
  <div style="background:#1a73e8;padding:28px;text-align:center;color:#fff">
    <h1 style="margin:0;font-size:22px;font-weight:600">Seu Raio-X de Growth</h1>
  </div>
  <div style="padding:28px;color:#202124">
    <p>Olá <strong>{{lead.nome}}</strong>,</p>
    <p style="color:#5f6368">Aqui está o resultado da análise da sua operação.</p>
    <div style="background:#e8f0fe;border-left:3px solid #1a73e8;border-radius:8px;padding:18px;margin:22px 0;text-align:center">
      <div style="font-size:11px;color:#5f6368;text-transform:uppercase">Score Geral</div>
      <div style="font-size:42px;font-weight:700;color:#1a73e8;line-height:1">{{lead.scores.geral}}</div>
      <div style="font-size:13px;color:#5f6368">Maturidade: <strong>{{lead.maturidade}}</strong></div>
    </div>
    <p><strong>Solução recomendada:</strong> {{lead.solucaoNome}}</p>
  </div>
</div>`,
    body: 'Seu diagnóstico está pronto. Score: {{lead.scores.geral}}/100. Solução: {{lead.solucaoNome}}',
  },
]

const WORKFLOWS: WfDef[] = [
  { key: 'wf_enrollment_submitted',          name: 'Notificar — Inscrição recebida',     description: 'Envia email + WhatsApp ao candidato após registrar inscrição',           triggerEvent: 'enrollment.submitted',                emailTplKey: 'enrollment_submitted_email',          waTplKey: 'enrollment_submitted_wa' },
  { key: 'wf_enrollment_payment_confirmed',  name: 'Notificar — Pagamento confirmado',    description: 'Envia email + WhatsApp quando pagamento é confirmado',                  triggerEvent: 'enrollment.payment_confirmed',        emailTplKey: 'enrollment_payment_confirmed_email',  waTplKey: 'enrollment_payment_confirmed_wa' },
  { key: 'wf_enrollment_payment_reminder',   name: 'Notificar — Lembrete de pagamento',   description: 'Lembrete 24h antes do vencimento (disparado pelo cron)',                triggerEvent: 'enrollment.payment_pending_reminder', emailTplKey: 'enrollment_payment_reminder_email',   waTplKey: 'enrollment_payment_reminder_wa' },
  { key: 'wf_enrollment_doc_approved',       name: 'Notificar — Documento aprovado',      description: 'Avisa o candidato quando um documento é aprovado pela equipe',          triggerEvent: 'enrollment.document_approved',        emailTplKey: 'enrollment_doc_approved_email',       waTplKey: 'enrollment_doc_approved_wa' },
  { key: 'wf_enrollment_doc_rejected',       name: 'Notificar — Documento rejeitado',     description: 'Avisa o candidato quando um documento é rejeitado, com motivo + link de reenvio', triggerEvent: 'enrollment.document_rejected', emailTplKey: 'enrollment_doc_rejected_email', waTplKey: 'enrollment_doc_rejected_wa' },

  // ── Lead lifecycle (alternativa a Configurações > Emails do Sistema) ──
  // Estes Workflows são criados INATIVOS. Quando o admin desativar o template
  // correspondente em Configurações > Emails do Sistema, basta ativar aqui pra
  // ter controle granular (filtros por funil, atrasos, condições, A/B).
  { key: 'wf_lead_created_notify',           name: 'Notificar — Novo lead (substitui notify_new_lead_admin)', description: 'Email pra equipe quando um lead novo entra. Inativo por padrão — ative depois de desativar o template "Novo lead — notificação ao time" em Configurações > Emails do Sistema.', triggerEvent: 'lead.created',          emailTplKey: 'lead_created_admin_email',          active: false },
  { key: 'wf_diagnosis_report_to_lead',      name: 'Notificar — Diagnóstico ao lead (substitui lead_diagnostic_report)', description: 'Email com diagnóstico pro próprio lead após completar o formulário. Inativo por padrão — ative depois de desativar o template "Diagnóstico — envio ao lead" em Configurações > Emails do Sistema.', triggerEvent: 'diagnosis.completed', emailTplKey: 'lead_diagnostic_email',             active: false },

  // ── ENEM ──
  { key: 'wf_enrollment_enem_approved',      name: 'Notificar — ENEM aprovado',           description: 'Avisa o candidato quando a nota do ENEM passa do corte e é validada',     triggerEvent: 'enrollment.enem_approved',            emailTplKey: 'enrollment_enem_approved_email',      waTplKey: 'enrollment_enem_approved_wa' },
  { key: 'wf_enrollment_enem_rejected',      name: 'Notificar — ENEM rejeitado',          description: 'Avisa o candidato quando a nota do ENEM não atinge o corte',             triggerEvent: 'enrollment.enem_rejected',            emailTplKey: 'enrollment_enem_rejected_email',      waTplKey: 'enrollment_enem_rejected_wa' },

  // ── Presencial ──
  { key: 'wf_enrollment_presencial_scheduled', name: 'Notificar — Prova presencial agendada', description: 'Avisa o candidato com data, horário e local da prova presencial',     triggerEvent: 'enrollment.presencial_scheduled',     emailTplKey: 'enrollment_presencial_scheduled_email', waTplKey: 'enrollment_presencial_scheduled_wa' },
  { key: 'wf_enrollment_presencial_approved',  name: 'Notificar — Aprovado no Presencial',     description: 'Comunica aprovação no Vestibular Presencial e próximos passos',       triggerEvent: 'enrollment.presencial_approved',      emailTplKey: 'enrollment_presencial_approved_email',  waTplKey: 'enrollment_presencial_approved_wa' },
  { key: 'wf_enrollment_presencial_rejected',  name: 'Notificar — Resultado do Presencial',    description: 'Comunica resultado quando o candidato não atinge o corte da prova',   triggerEvent: 'enrollment.presencial_rejected',      emailTplKey: 'enrollment_presencial_rejected_email',  waTplKey: 'enrollment_presencial_rejected_wa' },

  // ── Interesse capturado ──
  { key: 'wf_enrollment_interest',           name: 'Notificar — Interesse capturado (magic link)', description: 'Envia email + WhatsApp com link mágico para o lead completar a matrícula em um portal "full"', triggerEvent: 'enrollment.interest_submitted',     emailTplKey: 'enrollment_interest_email',           waTplKey: 'enrollment_interest_wa' },

  // ── Redação ──
  { key: 'wf_enrollment_essay_submitted',    name: 'Notificar — Redação recebida',        description: 'Confirma ao candidato que sua redação foi recebida e está em avaliação',  triggerEvent: 'enrollment.essay_submitted',          emailTplKey: 'enrollment_essay_submitted_email',    waTplKey: 'enrollment_essay_submitted_wa' },
  { key: 'wf_enrollment_essay_approved',     name: 'Notificar — Redação aprovada',        description: 'Avisa o candidato quando a redação é aprovada (acima do cutoff)',         triggerEvent: 'enrollment.essay_approved',           emailTplKey: 'enrollment_essay_approved_email',     waTplKey: 'enrollment_essay_approved_wa' },
  { key: 'wf_enrollment_essay_rejected',     name: 'Notificar — Redação rejeitada',       description: 'Avisa o candidato com a nota e o feedback quando a redação não atinge o cutoff', triggerEvent: 'enrollment.essay_rejected',     emailTplKey: 'enrollment_essay_rejected_email',     waTplKey: 'enrollment_essay_rejected_wa' },
]

const SEED_KEY_FIELD = 'name' // usamos name como chave única lógica

// Garante que as 3 settings de SMS (Comtele) existam vazias para que o PUT
// bulk consiga atualizá-las (updateMany não cria registros).
async function ensureSmsSettings() {
  const defs = [
    { key: 'sms.provider',                value: 'comtele', label: 'Provedor de SMS',         grp: 'sms', fieldType: 'text' },
    { key: 'sms.comtele.api_key',         value: '',        label: 'Comtele — API Key',       grp: 'sms', fieldType: 'password' },
    { key: 'sms.comtele.default_sender',  value: '',        label: 'Comtele — Sender padrão', grp: 'sms', fieldType: 'text' },
  ]
  for (const d of defs) {
    const existing = await prisma.setting.findUnique({ where: { key: d.key } })
    if (!existing) {
      await prisma.setting.create({ data: d })
    }
  }
}

// Garante que a setting de acessibilidade exista para o PUT bulk funcionar.
async function ensureA11ySettings() {
  const existing = await prisma.setting.findUnique({ where: { key: 'a11y.size' } })
  if (!existing) {
    await prisma.setting.create({
      data: { key: 'a11y.size', value: 'confortavel', label: 'Tamanho de fonte (acessibilidade)', grp: 'appearance', fieldType: 'select' },
    })
  }
}

export async function seedDefaultNotificationTemplatesAndWorkflows() {
  await ensureSmsSettings()
  await ensureA11ySettings()
  // ── Templates ──
  const tplIds = new Map<string, number>()
  for (const t of TEMPLATES) {
    const existing = await prisma.messageTemplate.findFirst({ where: { name: t.name } })
    if (existing) {
      tplIds.set(t.key, existing.id)
      continue
    }
    const created = await prisma.messageTemplate.create({
      data: {
        name: t.name,
        channel: t.channel,
        category: 'transactional',
        subject: t.subject || null,
        body: t.body,
        bodyHtml: t.bodyHtml || null,
        active: true,
      },
    })
    tplIds.set(t.key, created.id)
  }

  // ── Workflows ──
  for (const w of WORKFLOWS) {
    const existing = await prisma.workflow.findFirst({ where: { name: w.name } })
    if (existing) continue // não sobrescreve customizações do admin
    const wf = await prisma.workflow.create({
      data: {
        name: w.name,
        description: w.description,
        triggerEvent: w.triggerEvent,
        triggerConfig: {},
        active: w.active !== false, // default true; alguns seeds querem inativo (admin liga depois)
        reentryPolicy: 'after_completion',
      },
    })
    // Cria 2 steps: send_email (position 0) e send_whatsapp (position 1).
    // O engine pega o de menor position como inicial; encadeamos via nextStepId.
    let prevStepId: number | null = null
    if (w.emailTplKey && tplIds.has(w.emailTplKey)) {
      const emailStep = await prisma.workflowStep.create({
        data: {
          workflowId: wf.id,
          type: 'action',
          name: 'Enviar e-mail',
          config: { actionType: 'send_email', templateId: tplIds.get(w.emailTplKey) },
          position: 0,
        },
      })
      prevStepId = emailStep.id
    }
    if (w.waTplKey && tplIds.has(w.waTplKey)) {
      const waStep = await prisma.workflowStep.create({
        data: {
          workflowId: wf.id,
          type: 'action',
          name: 'Enviar WhatsApp',
          config: { actionType: 'send_whatsapp', templateId: tplIds.get(w.waTplKey) },
          position: prevStepId ? 1 : 0,
        },
      })
      if (prevStepId) {
        await prisma.workflowStep.update({ where: { id: prevStepId }, data: { nextStepId: waStep.id } })
      }
    }
  }
}
