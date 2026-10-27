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
interface WfDef { key: string; name: string; description: string; triggerEvent: string; emailTplKey?: string; waTplKey?: string; active?: boolean; notifyTeam?: boolean }

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

  // ── Análise acadêmica (ex.: transferência) — parecer emitido ──
  {
    key: 'enrollment_analise_email',
    name: 'Parecer da análise acadêmica (email)',
    channel: 'email',
    subject: 'Resultado da sua análise acadêmica — {{candidateCode}}',
    body: 'Sua análise acadêmica foi {{analiseResultado}}. Período: {{analisePeriodo}}. Aproveitamento: {{analiseAproveitamento}}. {{analiseObservacao}} Veja e responda em {{candidateUrl}}.',
    bodyHtml: `<div style="font-family:system-ui,sans-serif;background:#f6f7fb;padding:24px"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:28px">
<h1 style="color:#202124;font-size:20px;margin:0 0 12px">Resultado da sua análise acadêmica</h1>
<p>Olá <strong>{{nome}}</strong>, a análise dos seus documentos para <strong>{{courseName}}</strong> ({{portalNome}}) foi <strong>{{analiseResultado}}</strong>.</p>
<div style="background:#f1f3f4;border-radius:10px;padding:16px;margin:18px 0;font-size:14px;line-height:1.6;color:#3c4043">
  <div><strong>Período de ingresso:</strong> {{analisePeriodo}}</div>
  <div style="margin-top:8px"><strong>Aproveitamento de estudos:</strong> {{analiseAproveitamento}}</div>
  <div style="margin-top:8px"><strong>Observações:</strong> {{analiseObservacao}}</div>
</div>
<p>Acesse seu portal para ler o parecer completo e dizer se deseja continuar com a matrícula.</p>
<div style="text-align:center;margin:20px 0"><a href="{{candidateUrl}}" style="display:inline-block;background:#1a73e8;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Ver o parecer</a></div>
<p style="font-size:11px;color:#9aa0a6">Código: <strong>{{candidateCode}}</strong></p>
</div></div>`,
  },
  {
    key: 'enrollment_analise_wa',
    name: 'Parecer da análise acadêmica (WhatsApp)',
    channel: 'whatsapp',
    body: `📋 *Resultado da sua análise acadêmica*

Olá {{nome}}, a análise para *{{courseName}}* foi *{{analiseResultado}}*.

🗓 *Período de ingresso:* {{analisePeriodo}}
📚 *Aproveitamento:* {{analiseAproveitamento}}
📝 *Observações:* {{analiseObservacao}}

Leia o parecer e diga se deseja continuar:
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

  // ── Aviso à equipe: lead captado (usados por wf_lead_captured_team) ──
  {
    key: 'lead_captured_team_email',
    name: 'Aviso à equipe — Novo lead captado (e-mail)',
    channel: 'email',
    subject: 'Novo lead: {{nome}} — {{origem}}',
    bodyHtml: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e0e3e7">
  <div style="background:#1a73e8;padding:22px 28px;color:#fff">
    <h1 style="margin:0;font-size:20px;font-weight:600">Novo lead{{#marca}} — {{marca}}{{/marca}}</h1>
    <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:13px">{{data_hoje}}</p>
  </div>
  <div style="padding:22px 28px;color:#202124;font-size:14px">
    <table style="width:100%;border-collapse:collapse">
      <tr><td style="padding:6px 0;color:#5f6368">Nome</td><td style="padding:6px 0;text-align:right"><strong>{{nome}}</strong></td></tr>
      {{#whatsapp}}<tr><td style="padding:6px 0;color:#5f6368">WhatsApp</td><td style="padding:6px 0;text-align:right">{{whatsapp}}</td></tr>{{/whatsapp}}
      {{#email}}<tr><td style="padding:6px 0;color:#5f6368">E-mail</td><td style="padding:6px 0;text-align:right">{{email}}</td></tr>{{/email}}
      {{#origem}}<tr><td style="padding:6px 0;color:#5f6368">Origem</td><td style="padding:6px 0;text-align:right">{{origem}}</td></tr>{{/origem}}
      {{#funil}}<tr><td style="padding:6px 0;color:#5f6368">Funil / etapa</td><td style="padding:6px 0;text-align:right">{{funil}}{{#etapa_nome}} · {{etapa_nome}}{{/etapa_nome}}</td></tr>{{/funil}}
    </table>
    {{#link_lead}}<div style="margin-top:22px;text-align:center">
      <a href="{{link_lead}}" style="background:#1a73e8;color:#fff;padding:12px 26px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">Abrir no painel</a>
    </div>{{/link_lead}}
  </div>
</div>`,
    body: 'Novo lead: {{nome}} — {{whatsapp}} — {{origem}}. {{link_lead}}',
  },
  {
    key: 'lead_captured_team_wa',
    name: 'Aviso à equipe — Novo lead captado (WhatsApp)',
    channel: 'whatsapp',
    body: `*Novo lead{{#marca}} — {{marca}}{{/marca}}*

*Nome:* {{nome}}{{#whatsapp}}
*WhatsApp:* {{whatsapp}}{{/whatsapp}}{{#email}}
*E-mail:* {{email}}{{/email}}{{#origem}}
*Origem:* {{origem}}{{/origem}}{{#funil}}
*Funil:* {{funil}}{{#etapa_nome}} · {{etapa_nome}}{{/etapa_nome}}{{/funil}}{{#link_lead}}

{{link_lead}}{{/link_lead}}`,
  },
]

const WORKFLOWS: WfDef[] = [
  { key: 'wf_enrollment_submitted',          name: 'Notificar — Inscrição recebida',     description: 'Envia email + WhatsApp ao candidato após registrar inscrição',           triggerEvent: 'enrollment.submitted',                emailTplKey: 'enrollment_submitted_email',          waTplKey: 'enrollment_submitted_wa' },
  { key: 'wf_enrollment_payment_confirmed',  name: 'Notificar — Pagamento confirmado',    description: 'Envia email + WhatsApp quando pagamento é confirmado',                  triggerEvent: 'enrollment.payment_confirmed',        emailTplKey: 'enrollment_payment_confirmed_email',  waTplKey: 'enrollment_payment_confirmed_wa' },
  { key: 'wf_enrollment_payment_reminder',   name: 'Notificar — Lembrete de pagamento',   description: 'Lembrete 24h antes do vencimento (disparado pelo cron)',                triggerEvent: 'enrollment.payment_pending_reminder', emailTplKey: 'enrollment_payment_reminder_email',   waTplKey: 'enrollment_payment_reminder_wa' },
  { key: 'wf_enrollment_doc_approved',       name: 'Notificar — Documento aprovado',      description: 'Avisa o candidato quando um documento é aprovado pela equipe',          triggerEvent: 'enrollment.document_approved',        emailTplKey: 'enrollment_doc_approved_email',       waTplKey: 'enrollment_doc_approved_wa' },
  { key: 'wf_enrollment_analise_emitida',    name: 'Notificar — Parecer da análise acadêmica', description: 'Avisa o candidato quando a análise acadêmica (ex.: transferência) tem parecer, com período, aproveitamento e link para responder', triggerEvent: 'enrollment.analise_emitida', emailTplKey: 'enrollment_analise_email', waTplKey: 'enrollment_analise_wa' },
  { key: 'wf_enrollment_doc_rejected',       name: 'Notificar — Documento rejeitado',     description: 'Avisa o candidato quando um documento é rejeitado, com motivo + link de reenvio', triggerEvent: 'enrollment.document_rejected', emailTplKey: 'enrollment_doc_rejected_email', waTplKey: 'enrollment_doc_rejected_wa' },

  // ── Aviso à equipe ──
  // Único caminho do aviso de novo lead (antes saía direto do código). Ligar,
  // desligar, filtrar por funil/origem e trocar o texto: tudo em Fluxos/Modelos.
  { key: 'wf_lead_captured_team', name: 'Avisar equipe — Novo lead captado', description: 'Avisa os destinos de Configurações › Empresa › Dados de Notificações (WhatsApp e e-mail) quando entra um lead por formulário, webhook, anúncio, chat do site ou chatbot.', triggerEvent: 'lead.captured', emailTplKey: 'lead_captured_team_email', waTplKey: 'lead_captured_team_wa', notifyTeam: true },

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

/** Já existe fluxo ATIVO (feito pela equipe) avisando de lead novo? */
async function jaTemAvisoDeLeadNovo(): Promise<boolean> {
  const fluxos = await prisma.workflow.findMany({
    where: { active: true, triggerEvent: { in: ['lead.created', 'lead.captured', 'lead.handoff'] } },
    select: { steps: { select: { config: true } } },
  })
  return fluxos.some((f) => f.steps.some((st) => (st.config as any)?.actionType === 'notify_operator'))
}

// Padrões antigos que saíram: o par "lead criado → e-mail à equipe" e
// "diagnóstico → e-mail ao lead" (Raio-X). Nasciam desligados; só sai do banco
// o que nunca rodou e ninguém ligou. Os modelos saem junto se nenhum fluxo usa.
const FLUXOS_DESCONTINUADOS = [
  'Notificar — Novo lead (substitui notify_new_lead_admin)',
  'Notificar — Diagnóstico ao lead (substitui lead_diagnostic_report)',
]
const MODELOS_DESCONTINUADOS = ['Novo lead — notificação à equipe (Fluxo)', 'Diagnóstico ao lead (Fluxo)']

async function limparPadroesDescontinuados() {
  const fluxos = await prisma.workflow.findMany({ where: { name: { in: FLUXOS_DESCONTINUADOS }, active: false }, select: { id: true } })
  for (const f of fluxos) {
    const rodou = await prisma.workflowExecution.count({ where: { workflowId: f.id } })
    if (!rodou) await prisma.workflow.delete({ where: { id: f.id } }).catch(() => {})
  }
  const modelos = await prisma.messageTemplate.findMany({ where: { name: { in: MODELOS_DESCONTINUADOS } }, select: { id: true } })
  if (!modelos.length) return
  const passos = await prisma.workflowStep.findMany({ select: { config: true } })
  const emUso = new Set<number>()
  for (const p of passos) {
    const c = p.config as any
    for (const k of ['templateId', 'waTemplateId', 'emailTemplateId']) if (typeof c?.[k] === 'number') emUso.add(c[k])
  }
  const livres = modelos.map((m) => m.id).filter((id) => !emUso.has(id))
  if (livres.length) await prisma.messageTemplate.deleteMany({ where: { id: { in: livres } } }).catch(() => {})
}

/**
 * Roda em TODA subida (server.ts). Só o que substituiu envio que antes saía
 * direto do código — o resto do catálogo continua opcional (instalação manual):
 *  - Modelos do Sistema (agendamento, links de acesso, avisos…);
 *  - fluxo "Avisar equipe — Novo lead captado";
 *  - destinos que moravam no .env → tela Empresa;
 *  - limpeza dos padrões antigos que nunca rodaram.
 */
export async function garantirEnviosDoSistema(): Promise<void> {
  const { garantirModelosDoSistema } = await import('./modelosDoSistema.js')
  await garantirModelosDoSistema().catch((e) => console.warn('[envios do sistema] modelos:', e?.message))
  await limparPadroesDescontinuados().catch((e) => console.warn('[envios do sistema] limpeza:', e?.message))
  await import('./notify.js').then((m) => m.migrarDestinosDoEnv()).catch((e) => console.warn('[envios do sistema] destinos do .env:', e?.message))
  await instalarUmaVez('wf_lead_captured_team').catch((e) => console.warn('[envios do sistema] aviso de lead:', e?.message))
}

/** Instala o fluxo padrão só na primeira vez: apagado depois, continua apagado. */
async function instalarUmaVez(chave: string): Promise<void> {
  const marca = `sistema.fluxo_instalado.${chave}`
  if (await prisma.setting.findUnique({ where: { key: marca } })) return
  await garantirWorkflowPadrao(chave)
  await prisma.setting.create({ data: { key: marca, value: true as any, label: `Fluxo padrão instalado (${chave})`, grp: 'sistema', fieldType: 'boolean' } })
}

export async function seedDefaultNotificationTemplatesAndWorkflows() {
  await ensureSmsSettings()
  await ensureA11ySettings()
  await garantirEnviosDoSistema()
  // Instalação completa: todos os modelos, inclusive os que nenhuma automação
  // padrão usa (o envio direto os busca pelo nome).
  await instalarWorkflows(WORKFLOWS, true)
}

/**
 * Instala UMA automação padrão (e os modelos de mensagem dela), sem mexer nas
 * outras. Ex.: 'wf_enrollment_interest' — o link de continuação da captura de
 * interesse, sem o qual quem preenche o formulário curto nunca recebe o link.
 * Idempotente: o que já existe (pelo nome) não é recriado nem sobrescrito.
 */
export async function garantirWorkflowPadrao(chave: string): Promise<{ criado: boolean; nome: string } | null> {
  const w = WORKFLOWS.find((x) => x.key === chave)
  if (!w) return null
  const antes = await prisma.workflow.findFirst({ where: { name: w.name }, select: { id: true } })
  await instalarWorkflows([w])
  return { criado: !antes, nome: w.name }
}

async function instalarWorkflows(lista: WfDef[], todosOsModelos = false) {
  const precisa = new Set(lista.flatMap((w) => [w.emailTplKey, w.waTplKey]).filter(Boolean) as string[])
  // ── Templates ──
  const tplIds = new Map<string, number>()
  for (const t of TEMPLATES) {
    if (!todosOsModelos && !precisa.has(t.key)) continue
    const existing = await prisma.messageTemplate.findFirst({ where: { name: t.name } })
    if (existing) {
      tplIds.set(t.key, existing.id)
      continue
    }
    const created = await prisma.messageTemplate.create({
      data: {
        name: t.name,
        key: t.key,
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
  for (const w of lista) {
    const existing = await prisma.workflow.findFirst({ where: { name: w.name } })
    if (existing) continue // não sobrescreve customizações do admin
    // Aviso à equipe: se a instalação já tem um fluxo próprio avisando a equipe
    // de lead novo, o padrão nasce DESLIGADO — senão o aviso chegaria em dobro.
    const jaAvisa = w.notifyTeam ? await jaTemAvisoDeLeadNovo() : false
    const wf = await prisma.workflow.create({
      data: {
        name: w.name,
        description: w.description,
        triggerEvent: w.triggerEvent,
        triggerConfig: {},
        active: w.active !== false && !jaAvisa, // default true; alguns seeds querem inativo (admin liga depois)
        reentryPolicy: 'after_completion',
      },
    })
    if (w.notifyTeam) {
      await prisma.workflowStep.create({
        data: {
          workflowId: wf.id,
          type: 'action',
          name: 'Avisar equipe',
          config: {
            actionType: 'notify_operator',
            ...(w.waTplKey && tplIds.has(w.waTplKey) ? { waTemplateId: tplIds.get(w.waTplKey) } : {}),
            ...(w.emailTplKey && tplIds.has(w.emailTplKey) ? { emailTemplateId: tplIds.get(w.emailTplKey) } : {}),
          },
          position: 0,
        },
      })
      continue
    }
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
