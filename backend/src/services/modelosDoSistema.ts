// src/services/modelosDoSistema.ts
//
// Toda mensagem automática do sistema (agendamento, links de acesso, avisos à
// equipe, respostas fixas do chatbot…) sai de um MessageTemplate com `key`
// estável, editável em Modelos. O que está aqui é SÓ o conteúdo inicial: ele
// é gravado no banco na primeira subida e daí em diante vale o que estiver na
// tela. Não existe texto reserva — modelo DESLIGADO (active=false) quer dizer
// "não enviar", e quem chama precisa respeitar o `null`.
//
// Variáveis: {{chave}}. Todo modelo recebe também {{marca}} (nome do dono da
// instalação, Configurações › Aparência) e {{data_hoje}}.

import { prisma } from '../lib/prisma.js'
import { interpolate, decodeHtmlIfEscaped } from '../lib/interpolate.js'
import { getBranding } from '../lib/branding.js'

/** `texto`: não é mensagem — é um texto que o sistema usa (título de convite, valor reserva…). */
export type CanalModelo = 'whatsapp' | 'email' | 'sms' | 'texto'

export interface ModeloPadrao {
  key: string
  name: string
  channel: CanalModelo
  /** Assunto (e-mail). */
  subject?: string
  /** Texto (WhatsApp/SMS) ou versão texto do e-mail. */
  body: string
  /** Corpo HTML (e-mail). */
  bodyHtml?: string
  /** Nasce desligado (o envio só acontece depois que alguém ligar). */
  desligado?: boolean
}

/** Categoria dos modelos do sistema na tela Modelos. */
export const CATEGORIA_SISTEMA = 'system'

const caixa = (titulo: string, corpo: string) => `<div style="font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1f2937">
<h2 style="font-size:20px;margin:0 0 14px">${titulo}</h2>
${corpo}
</div>`

export const MODELOS_PADRAO: ModeloPadrao[] = [
  // ── Agendamento ────────────────────────────────────────────────
  // Variáveis: {{nome}} {{reuniao}} {{quando}} {{link}} (reunião online)
  // {{local}} (endereço/local) {{presencial}} (preenchida quando é visita)
  // {{aviso_gravacao}} {{telefone}} {{email_contato}} {{operador}}
  {
    key: 'agendamento_confirmado_wa', name: 'Agendamento — confirmação ao contato (WhatsApp)', channel: 'whatsapp',
    body: '{{#nome}}Olá, {{nome}}!{{/nome}}{{^nome}}Olá!{{/nome}}\n\n✅ *Reunião confirmada: {{reuniao}}*\n📅 {{quando}}{{#link}}\nLink: {{link}}{{/link}}{{^link}}{{#local}}\nLocal: {{local}}{{/local}}{{/link}}',
  },
  {
    key: 'agendamento_lembrete_wa', name: 'Agendamento — lembrete ao contato (WhatsApp)', channel: 'whatsapp',
    body: '{{#nome}}Olá, {{nome}}!{{/nome}}{{^nome}}Olá!{{/nome}}\n\n⏰ *Lembrete: {{reuniao}}*\n📅 {{quando}}{{#link}}\nLink: {{link}}{{/link}}{{^link}}{{#local}}\nLocal: {{local}}{{/local}}{{/link}}',
  },
  {
    key: 'agendamento_confirmado_janela_wa', name: 'Agendamento — confirmação com a conversa aberta (WhatsApp oficial)', channel: 'whatsapp',
    body: '✅ *{{#presencial}}Visita agendada{{/presencial}}{{^presencial}}Reunião agendada{{/presencial}}!*\n📅 {{quando}}{{#presencial}}{{#local}}\n\n📍 Endereço: {{local}}{{/local}}{{/presencial}}{{^presencial}}{{#link}}\n\n📍 Link da reunião: {{link}}{{/link}}{{#aviso_gravacao}}\n\nℹ️ {{aviso_gravacao}}{{/aviso_gravacao}}{{/presencial}}',
  },
  {
    key: 'agendamento_presenca_confirmada_wa', name: 'Agendamento — resposta "presença confirmada" (WhatsApp)', channel: 'whatsapp',
    body: '✅ Presença confirmada! Nos vemos em breve. 🙌',
  },
  {
    key: 'agendamento_cancelado_wa', name: 'Agendamento — cancelamento ao contato (WhatsApp)', channel: 'whatsapp',
    body: 'Seu agendamento de *{{reuniao}}* ({{quando}}) foi *cancelado*.',
  },
  {
    key: 'agendamento_confirmado_email', name: 'Agendamento — confirmação ao contato (e-mail)', channel: 'email',
    subject: 'Reunião confirmada: {{reuniao}} — {{quando}}',
    body: 'Reunião confirmada: {{reuniao}} — {{quando}}',
    bodyHtml: caixa('Reunião confirmada: {{reuniao}}', `<p>{{#nome}}Olá, {{nome}}!{{/nome}}{{^nome}}Olá!{{/nome}}</p>
<p>📅 <b>{{quando}}</b></p>
{{#link}}<p>Link da reunião: <a href="{{link}}">{{link}}</a></p>{{/link}}{{^link}}{{#local}}<p>Local: {{local}}</p>{{/local}}{{/link}}
<p style="margin-top:20px;font-size:13px;color:#5f6368">Para remarcar ou cancelar, fale com a equipe {{marca}}.</p>`),
  },
  {
    key: 'agendamento_lembrete_email', name: 'Agendamento — lembrete ao contato (e-mail)', channel: 'email',
    subject: 'Lembrete de reunião: {{reuniao}} — {{quando}}',
    body: 'Lembrete de reunião: {{reuniao}} — {{quando}}',
    bodyHtml: caixa('Lembrete de reunião: {{reuniao}}', `<p>{{#nome}}Olá, {{nome}}!{{/nome}}{{^nome}}Olá!{{/nome}}</p>
<p>📅 <b>{{quando}}</b></p>
{{#link}}<p>Link da reunião: <a href="{{link}}">{{link}}</a></p>{{/link}}{{^link}}{{#local}}<p>Local: {{local}}</p>{{/local}}{{/link}}
<p style="margin-top:20px;font-size:13px;color:#5f6368">Para remarcar ou cancelar, fale com a equipe {{marca}}.</p>`),
  },
  {
    key: 'agendamento_operador_wa', name: 'Agendamento — aviso ao responsável (WhatsApp)', channel: 'whatsapp',
    body: '🗓️ *Novo agendamento: {{reuniao}}*\n👤 {{nome}}{{#telefone}}\n📱 {{telefone}}{{/telefone}}\n📅 {{quando}}{{#link}}\nLink: {{link}}{{/link}}{{^link}}{{#local}}\nLocal: {{local}}{{/local}}{{/link}}',
  },
  {
    key: 'agendamento_operador_email', name: 'Agendamento — aviso ao responsável (e-mail)', channel: 'email',
    subject: 'Novo agendamento: {{nome}} — {{quando}}',
    body: 'Novo agendamento: {{nome}} — {{quando}}',
    bodyHtml: caixa('🗓️ Novo agendamento: {{reuniao}}', '<p>Com: <b>{{nome}}</b>{{#telefone}} · {{telefone}}{{/telefone}}{{#email_contato}} · {{email_contato}}{{/email_contato}}</p><p>📅 {{quando}}</p>{{#link}}<p>Link: <a href="{{link}}">{{link}}</a></p>{{/link}}{{^link}}{{#local}}<p>Local: {{local}}</p>{{/local}}{{/link}}'),
  },
  // Valores que entram nos modelos aprovados na Meta (HSM) quando o dado falta.
  {
    key: 'agendamento_hsm_sem_link', name: 'Agendamento — texto do modelo da Meta quando não há link/local', channel: 'texto',
    body: 'a combinar com nossa equipe',
  },
  {
    key: 'agendamento_hsm_sem_nome', name: 'Agendamento — texto do modelo da Meta quando não há nome', channel: 'texto',
    body: 'tudo bem',
  },
  {
    key: 'agendamento_hsm_sem_aluno', name: 'Agendamento — texto do modelo da Meta quando não há nome do aluno', channel: 'texto',
    body: 'seu filho(a)',
  },

  // ── Links de acesso (resposta a um pedido da própria pessoa) ──
  // Variáveis: {{nome}} {{link}} {{validade}}
  {
    key: 'portal_acesso_wa', name: 'Portal de matrícula — link para criar a senha (WhatsApp)', channel: 'whatsapp',
    body: 'Olá, {{#nome}}{{nome}}{{/nome}}{{^nome}}tudo bem{{/nome}}! Use o link abaixo para entrar no portal e criar sua senha:\n\n{{link}}\n\nO link vale por {{validade}} horas, serve uma vez só e é de uso pessoal.',
  },
  {
    key: 'portal_acesso_email', name: 'Portal de matrícula — link para criar a senha (e-mail)', channel: 'email',
    subject: 'Acesso ao portal — {{marca}}',
    body: 'Use o link para entrar no portal: {{link}}',
    bodyHtml: caixa('Acesso ao portal', '<p>Olá, {{#nome}}{{nome}}{{/nome}}{{^nome}}tudo bem{{/nome}}! Use o link abaixo para entrar no portal e criar sua senha:</p><p><a href="{{link}}">{{link}}</a></p><p style="font-size:13px;color:#5f6368">O link vale por {{validade}} horas, serve uma vez só e é de uso pessoal.</p>'),
  },
  {
    key: 'portal_recuperacao_wa', name: 'Portal de matrícula — link para nova senha (WhatsApp)', channel: 'whatsapp',
    body: 'Olá, {{#nome}}{{nome}}{{/nome}}{{^nome}}tudo bem{{/nome}}! Use o link abaixo para criar uma nova senha:\n\n{{link}}\n\nO link vale por {{validade}} horas, serve uma vez só e é de uso pessoal.',
  },
  {
    key: 'portal_recuperacao_email', name: 'Portal de matrícula — link para nova senha (e-mail)', channel: 'email',
    subject: 'Nova senha do portal — {{marca}}',
    body: 'Use o link para criar uma nova senha: {{link}}',
    bodyHtml: caixa('Nova senha do portal', '<p>Olá, {{#nome}}{{nome}}{{/nome}}{{^nome}}tudo bem{{/nome}}! Use o link abaixo para criar uma nova senha:</p><p><a href="{{link}}">{{link}}</a></p><p style="font-size:13px;color:#5f6368">O link vale por {{validade}} horas, serve uma vez só e é de uso pessoal.</p>'),
  },
  {
    key: 'aluno_acesso_wa', name: 'Portal do aluno — link para criar a senha (WhatsApp)', channel: 'whatsapp',
    body: 'Olá, {{#nome}}{{nome}}{{/nome}}{{^nome}}tudo bem{{/nome}}! Use o link abaixo para entrar no portal e criar sua senha:\n\n{{link}}\n\nO link vale por {{validade}} horas e é de uso pessoal.',
  },
  {
    key: 'aluno_acesso_email', name: 'Portal do aluno — link para criar a senha (e-mail)', channel: 'email',
    subject: 'Acesso ao portal do aluno — {{marca}}',
    body: 'Use o link para entrar no portal do aluno: {{link}}',
    bodyHtml: caixa('Acesso ao portal do aluno', '<p>Olá, {{#nome}}{{nome}}{{/nome}}{{^nome}}tudo bem{{/nome}}! Use o link abaixo para entrar no portal e criar sua senha:</p><p><a href="{{link}}">{{link}}</a></p><p style="font-size:13px;color:#5f6368">O link vale por {{validade}} horas e é de uso pessoal.</p>'),
  },
  {
    key: 'suporte_acesso_email', name: 'Portal de suporte — link de acesso (e-mail)', channel: 'email',
    subject: 'Acesso ao portal de suporte — {{marca}}',
    body: 'Acesse seus chamados: {{link}}',
    bodyHtml: caixa('Portal de suporte', '<p>Olá,</p><p>Clique no link abaixo para acessar seus chamados (válido por {{validade}} minutos):</p><p><a href="{{link}}">Acessar portal de suporte</a></p><p style="font-size:13px;color:#5f6368">Se você não solicitou, ignore este e-mail.</p>'),
  },

  // ── LGPD ──
  // Link ao titular. Variáveis: {{nome}} {{link}}
  {
    key: 'lgpd_link_titular_email', name: 'LGPD — link de acesso aos dados ao titular (e-mail)', channel: 'email',
    subject: 'Acesso aos seus dados (LGPD) — {{marca}}',
    body: 'Acesse seus dados: {{link}}',
    bodyHtml: caixa('Acesso aos seus dados', '<p>Olá{{#nome}} {{nome}}{{/nome}},</p><p>Recebemos um pedido de acesso aos seus dados (LGPD). Clique no botão abaixo (válido por 48 horas):</p><p><a href="{{link}}" style="display:inline-block;padding:12px 18px;background:#1a73e8;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Acessar meus dados</a></p><p style="color:#6b7280;font-size:13px">Se não foi você, ignore esta mensagem.</p>'),
  },
  {
    key: 'lgpd_link_titular_wa', name: 'LGPD — link de acesso aos dados ao titular (WhatsApp)', channel: 'whatsapp',
    body: 'Recebemos um pedido de acesso aos seus dados (LGPD). Use o link a seguir (válido por 48h) para ver, exportar, corrigir ou solicitar a eliminação dos seus dados:\n\n{{link}}\n\nSe não foi você, ignore esta mensagem.',
  },
  // Aviso ao encarregado. Variáveis: {{lead_id}} {{nome}} {{email}} {{whatsapp}}
  // {{requisicao_id}} {{eliminacao}} (preenchida quando é pedido de eliminação)
  // {{mensagem}} {{prazo}}
  {
    key: 'lgpd_consentimento_revogado_wa', name: 'LGPD — aviso à equipe: consentimento revogado (WhatsApp)', channel: 'whatsapp',
    body: '🔐 *LGPD — Consentimento revogado pelo titular*\n\nLead #{{lead_id}} — {{#nome}}{{nome}}{{/nome}}{{^nome}}(sem nome){{/nome}}\nE-mail: {{#email}}{{email}}{{/email}}{{^email}}—{{/email}} · WhatsApp: {{#whatsapp}}{{whatsapp}}{{/whatsapp}}{{^whatsapp}}—{{/whatsapp}}\nAção: revogação de consentimento + opt-out total (imediato).',
  },
  {
    key: 'lgpd_consentimento_revogado_email', name: 'LGPD — aviso à equipe: consentimento revogado (e-mail)', channel: 'email',
    subject: '[LGPD] Consentimento revogado pelo titular',
    body: 'Consentimento revogado — lead #{{lead_id}}',
    bodyHtml: '<p>Lead #{{lead_id}} — {{#nome}}{{nome}}{{/nome}}{{^nome}}(sem nome){{/nome}}<br>E-mail: {{#email}}{{email}}{{/email}}{{^email}}—{{/email}} · WhatsApp: {{#whatsapp}}{{whatsapp}}{{/whatsapp}}{{^whatsapp}}—{{/whatsapp}}<br>Ação: revogação de consentimento + opt-out total (imediato).</p>',
  },
  {
    key: 'lgpd_requisicao_wa', name: 'LGPD — aviso à equipe: nova requisição do titular (WhatsApp)', channel: 'whatsapp',
    body: '🔐 *LGPD — Nova requisição de titular: {{#eliminacao}}ELIMINAÇÃO{{/eliminacao}}{{^eliminacao}}correção{{/eliminacao}}*\n\nRequisição #{{requisicao_id}} — Lead #{{lead_id}} — {{#nome}}{{nome}}{{/nome}}{{^nome}}(sem nome){{/nome}}\nE-mail: {{#email}}{{email}}{{/email}}{{^email}}—{{/email}} · WhatsApp: {{#whatsapp}}{{whatsapp}}{{/whatsapp}}{{^whatsapp}}—{{/whatsapp}}\nMensagem: {{#mensagem}}{{mensagem}}{{/mensagem}}{{^mensagem}}(sem detalhes){{/mensagem}}\nPrazo de atendimento: {{prazo}} (15 dias).',
  },
  {
    key: 'lgpd_requisicao_email', name: 'LGPD — aviso à equipe: nova requisição do titular (e-mail)', channel: 'email',
    subject: '[LGPD] Nova requisição de titular: {{#eliminacao}}ELIMINAÇÃO{{/eliminacao}}{{^eliminacao}}correção{{/eliminacao}}',
    body: 'Nova requisição LGPD #{{requisicao_id}}',
    bodyHtml: '<p>Requisição #{{requisicao_id}} — Lead #{{lead_id}} — {{#nome}}{{nome}}{{/nome}}{{^nome}}(sem nome){{/nome}}<br>E-mail: {{#email}}{{email}}{{/email}}{{^email}}—{{/email}} · WhatsApp: {{#whatsapp}}{{whatsapp}}{{/whatsapp}}{{^whatsapp}}—{{/whatsapp}}<br>Mensagem: {{#mensagem}}{{mensagem}}{{/mensagem}}{{^mensagem}}(sem detalhes){{/mensagem}}<br>Prazo de atendimento: {{prazo}} (15 dias).</p>',
  },

  // ── Google Agenda / Tarefas (vai no convite que o contato recebe) ──
  // Variáveis: {{atividade}} {{descricao}} {{nome}} {{empresa}} {{whatsapp}}
  // {{aviso_gravacao}} {{tipo}} {{quando}} {{link}} {{reuniao}}
  {
    key: 'agenda_evento_titulo', name: 'Google Agenda — título do evento', channel: 'texto',
    body: '{{atividade}} — {{#nome}}{{nome}}{{/nome}}{{^nome}}Lead{{/nome}}',
  },
  {
    key: 'agenda_evento_descricao', name: 'Google Agenda — descrição do evento', channel: 'texto',
    body: '{{descricao}}{{#nome}}\n\nLead: {{nome}}{{#empresa}} ({{empresa}}){{/empresa}}{{/nome}}{{#whatsapp}}\nWhatsApp: {{whatsapp}}{{/whatsapp}}{{#aviso_gravacao}}\n\n⚠️ {{aviso_gravacao}}{{/aviso_gravacao}}{{#marca}}\n\nCriado via {{marca}}{{/marca}}',
  },
  {
    key: 'agenda_reuniao_lead_wa', name: 'Google Agenda — aviso de reunião ao contato (WhatsApp)', channel: 'whatsapp',
    body: 'Olá{{#nome}} {{nome}}{{/nome}}! Uma reunião foi agendada para *{{quando}}*.\n\nLink do Google Meet: {{link}}\n\nTe esperamos lá!',
  },
  {
    key: 'agenda_reuniao_instantanea_titulo', name: 'Google Agenda — título da reunião instantânea', channel: 'texto',
    body: 'Reunião{{#marca}} {{marca}}{{/marca}}',
  },
  {
    key: 'tarefa_google_titulo', name: 'Google Tarefas — título da tarefa', channel: 'texto',
    body: '{{atividade}} — {{#nome}}{{nome}}{{/nome}}{{^nome}}Lead{{/nome}}',
  },
  {
    key: 'tarefa_google_notas', name: 'Google Tarefas — notas da tarefa', channel: 'texto',
    body: '{{descricao}}{{#empresa}}\nEmpresa: {{empresa}}{{/empresa}}\nTipo: {{tipo}}{{#marca}}\n\nCriado via {{marca}}{{/marca}}',
  },
  {
    key: 'agendamento_atividade_titulo', name: 'Agendamento — título da atividade criada', channel: 'texto',
    body: 'Reunião: {{reuniao}}',
  },
  {
    key: 'agendamento_atividade_descricao', name: 'Agendamento — descrição da atividade criada', channel: 'texto',
    body: 'Agendada via página pública de agendamento.',
  },

  // ── Avisos à equipe (Configurações › Empresa › Dados de Notificações) ──
  // Meta Ads — token com problema. {{#integracoes}}: {{pagina}} {{id}} {{status}} {{problemas}}; {{painel}}
  {
    key: 'meta_ads_token_problema_wa', name: 'Aviso à equipe — Meta Ads com token com problema (WhatsApp)', channel: 'whatsapp',
    body: '⚠️ *Meta Ads — token com problema*\n\n{{#integracoes}}• *{{pagina}}* (#{{id}}): {{status}} — {{problemas}}\n{{/integracoes}}\nReconecte em Configurações › Meta Ads{{#painel}} ({{painel}}){{/painel}}. O relatório de investimento fica defasado até resolver.',
  },
  {
    key: 'meta_ads_token_problema_email', name: 'Aviso à equipe — Meta Ads com token com problema (e-mail)', channel: 'email',
    subject: '⚠️ Meta Ads: token com problema',
    body: 'Meta Ads — token com problema',
    bodyHtml: '<h2>Meta Ads — token com problema</h2><ul>{{#integracoes}}<li><b>{{pagina}}</b> (#{{id}}): <b>{{status}}</b> — {{problemas}}</li>{{/integracoes}}</ul><p>Reconecte em Configurações › Meta Ads. O relatório de investimento fica defasado até resolver.</p>',
  },
  // Resumo diário de pendências. {{#criticos}}: {{titulo}} {{dias}} {{plural}}; {{criticos_total}} {{criticos_restantes}}; {{#tipos}}: {{tipo}} {{quantidade}}
  {
    key: 'alertas_resumo_diario_wa', name: 'Aviso à equipe — resumo diário de pendências (WhatsApp)', channel: 'whatsapp',
    body: '*Pendências do dia*\n\n{{#criticos_total}}🔴 *{{criticos_total}} crítico(s)* — precisam de alguém hoje:\n{{#criticos}}• {{titulo}}{{#dias}} _(há {{dias}} dia{{#plural}}s{{/plural}})_{{/dias}}\n{{/criticos}}{{#criticos_restantes}}• …e mais {{criticos_restantes}}\n{{/criticos_restantes}}\n{{/criticos_total}}*Em aberto por tipo:*\n{{#tipos}}• {{tipo}}: {{quantidade}}\n{{/tipos}}\n_Detalhes e ações no sino do painel._',
  },
  {
    key: 'alertas_resumo_diario_email', name: 'Aviso à equipe — resumo diário de pendências (e-mail)', channel: 'email',
    subject: 'Pendências do dia{{#marca}} — {{marca}}{{/marca}}',
    body: 'Pendências do dia',
    bodyHtml: caixa('Pendências do dia', '{{#criticos_total}}<p>🔴 <b>{{criticos_total}} crítico(s)</b> — precisam de alguém hoje:</p><ul>{{#criticos}}<li>{{titulo}}{{#dias}} <i>(há {{dias}} dia{{#plural}}s{{/plural}})</i>{{/dias}}</li>{{/criticos}}{{#criticos_restantes}}<li>…e mais {{criticos_restantes}}</li>{{/criticos_restantes}}</ul>{{/criticos_total}}<p><b>Em aberto por tipo:</b></p><ul>{{#tipos}}<li>{{tipo}}: {{quantidade}}</li>{{/tipos}}</ul><p style="font-size:13px;color:#5f6368">Detalhes e ações no sino do painel.</p>'),
  },
  // Escalonamento de alerta. {{titulo}} {{detalhe}} {{reforco}} {{dias}} {{horas}}
  {
    key: 'alerta_escalonado_wa', name: 'Aviso à equipe — alerta sem resposta (WhatsApp)', channel: 'whatsapp',
    body: '🔴 *{{titulo}}*{{#reforco}} *(segundo aviso)*{{/reforco}}{{#detalhe}}\n{{detalhe}}{{/detalhe}}\n\nAberto há {{#dias}}{{dias}} dia(s){{/dias}}{{^dias}}{{horas}}h{{/dias}} e ninguém abriu o alerta no painel.',
  },
  {
    key: 'alerta_escalonado_email', name: 'Aviso à equipe — alerta sem resposta (e-mail)', channel: 'email',
    subject: '🔴 {{titulo}}',
    body: '{{titulo}}',
    bodyHtml: caixa('🔴 {{titulo}}{{#reforco}} (segundo aviso){{/reforco}}', '{{#detalhe}}<p style="white-space:pre-wrap">{{detalhe}}</p>{{/detalhe}}<p>Aberto há {{#dias}}{{dias}} dia(s){{/dias}}{{^dias}}{{horas}}h{{/dias}} e ninguém abriu o alerta no painel.</p>'),
  },
  // WhatsApp Oficial recusando envios. {{codigo}} {{descricao}} {{janela_horas}} {{na_janela}} {{total}} {{desde}} {{ultimo}} {{reaviso_horas}}
  {
    key: 'cloud_api_recusando_wa', name: 'Aviso à equipe — WhatsApp Oficial recusando envios (WhatsApp)', channel: 'whatsapp',
    body: '⚠️ *WhatsApp Oficial recusando envios*\n\n{{descricao}}\n\nCódigo da Meta: *{{codigo}}*\nRecusas nas últimas {{janela_horas}}h: {{na_janela}}\nTotal acumulado: *{{total}}*\nDesde: {{desde}}\n\nCada recusa é uma mensagem que não chegou. Resolver depende de ação no WhatsApp Manager.',
  },
  {
    key: 'cloud_api_recusando_email', name: 'Aviso à equipe — WhatsApp Oficial recusando envios (e-mail)', channel: 'email',
    subject: 'WhatsApp Oficial recusando envios (erro {{codigo}})',
    body: 'WhatsApp Oficial recusando envios (erro {{codigo}})',
    bodyHtml: '<p><strong>O WhatsApp Oficial está recusando envios.</strong></p><p>{{descricao}}</p><table cellpadding="6" style="border-collapse:collapse"><tr><td>Código da Meta</td><td><strong>{{codigo}}</strong></td></tr><tr><td>Recusas nas últimas {{janela_horas}}h</td><td>{{na_janela}}</td></tr><tr><td>Total acumulado</td><td><strong>{{total}}</strong></td></tr><tr><td>Primeira ocorrência</td><td>{{desde}}</td></tr><tr><td>Mais recente</td><td>{{ultimo}}</td></tr></table><p>Cada recusa é uma mensagem que <strong>não chegou</strong> ao destinatário. Resolver depende de ação no WhatsApp Manager da Meta — o sistema não consegue contornar por conta própria.</p><p style="color:#666;font-size:12px">Este aviso sai no máximo uma vez a cada {{reaviso_horas}}h por código de erro.</p>',
  },

  // ── Helpdesk — aviso ao agente responsável. {{numero}} {{assunto}} {{agente}} {{link}}
  {
    key: 'helpdesk_atribuido_wa', name: 'Helpdesk — chamado atribuído (WhatsApp ao agente)', channel: 'whatsapp',
    body: '🎫 Chamado #{{numero}} atribuído a você: {{assunto}}',
  },
  {
    key: 'helpdesk_atribuido_email', name: 'Helpdesk — chamado atribuído (e-mail ao agente)', channel: 'email',
    subject: 'Helpdesk — chamado #{{numero}}',
    body: '🎫 Chamado #{{numero}} atribuído a você: {{assunto}}',
    bodyHtml: '<div style="font-family:system-ui,sans-serif"><p>🎫 Chamado #{{numero}} atribuído a você: {{assunto}}</p>{{#link}}<p><a href="{{link}}">Abrir Helpdesk</a></p>{{/link}}</div>',
  },
  {
    key: 'helpdesk_sla_risco_wa', name: 'Helpdesk — SLA perto do prazo (WhatsApp ao agente)', channel: 'whatsapp',
    body: '⏳ SLA do chamado #{{numero}} perto do prazo: {{assunto}}',
  },
  {
    key: 'helpdesk_sla_risco_email', name: 'Helpdesk — SLA perto do prazo (e-mail ao agente)', channel: 'email',
    subject: 'Helpdesk — chamado #{{numero}}',
    body: '⏳ SLA do chamado #{{numero}} perto do prazo: {{assunto}}',
    bodyHtml: '<div style="font-family:system-ui,sans-serif"><p>⏳ SLA do chamado #{{numero}} perto do prazo: {{assunto}}</p>{{#link}}<p><a href="{{link}}">Abrir Helpdesk</a></p>{{/link}}</div>',
  },
  {
    key: 'helpdesk_sla_estourou_wa', name: 'Helpdesk — SLA estourado (WhatsApp ao agente)', channel: 'whatsapp',
    body: '🔴 SLA do chamado #{{numero}} ESTOUROU: {{assunto}}',
  },
  {
    key: 'helpdesk_sla_estourou_email', name: 'Helpdesk — SLA estourado (e-mail ao agente)', channel: 'email',
    subject: 'Helpdesk — chamado #{{numero}}',
    body: '🔴 SLA do chamado #{{numero}} ESTOUROU: {{assunto}}',
    bodyHtml: '<div style="font-family:system-ui,sans-serif"><p>🔴 SLA do chamado #{{numero}} ESTOUROU: {{assunto}}</p>{{#link}}<p><a href="{{link}}">Abrir Helpdesk</a></p>{{/link}}</div>',
  },
  {
    key: 'helpdesk_resposta_cliente_wa', name: 'Helpdesk — nova resposta do cliente (WhatsApp ao agente)', channel: 'whatsapp',
    body: '💬 Nova resposta do cliente no chamado #{{numero}}: {{assunto}}',
  },
  {
    key: 'helpdesk_resposta_cliente_email', name: 'Helpdesk — nova resposta do cliente (e-mail ao agente)', channel: 'email',
    subject: 'Helpdesk — chamado #{{numero}}',
    body: '💬 Nova resposta do cliente no chamado #{{numero}}: {{assunto}}',
    bodyHtml: '<div style="font-family:system-ui,sans-serif"><p>💬 Nova resposta do cliente no chamado #{{numero}}: {{assunto}}</p>{{#link}}<p><a href="{{link}}">Abrir Helpdesk</a></p>{{/link}}</div>',
  },

  // ── Reuniões gravadas — resumo e coaching (IA). Listas: {{#proximos_passos}}
  // {{#acoes}} {{#objecoes}} {{#pontos_fortes}} {{#a_melhorar}} {{#direcionamento}}
  // (cada item em {{item}}); {{lead}} {{resumo}} {{tem_playbook}} {{aderencia}}
  {
    key: 'reuniao_resumo_wa', name: 'Reuniões — resumo da reunião (WhatsApp)', channel: 'whatsapp',
    body: '*Resumo da reunião*{{#lead}} — {{lead}}{{/lead}}\n{{#resumo}}\n{{resumo}}\n{{/resumo}}{{#proximos_passos}}{{#primeiro}}\nPróximos passos:\n{{/primeiro}}• {{item}}\n{{/proximos_passos}}{{#acoes}}{{#primeiro}}\nAction items:\n{{/primeiro}}• {{item}}\n{{/acoes}}{{#objecoes}}{{#primeiro}}\nObjeções:\n{{/primeiro}}• {{item}}\n{{/objecoes}}{{#tem_playbook}}\n*Coaching (Playbook) — aderência {{aderencia}}/100*\n{{#a_melhorar}}{{#primeiro}}\nA melhorar:\n{{/primeiro}}• {{item}}\n{{/a_melhorar}}{{#direcionamento}}{{#primeiro}}\nDirecionamento:\n{{/primeiro}}• {{item}}\n{{/direcionamento}}{{/tem_playbook}}',
  },
  {
    key: 'reuniao_resumo_email', name: 'Reuniões — resumo da reunião (e-mail)', channel: 'email',
    subject: 'Resumo da reunião{{#lead}} — {{lead}}{{/lead}}{{^lead}}{{#marca}} — {{marca}}{{/marca}}{{/lead}}',
    body: 'Resumo da reunião',
    bodyHtml: '<h2>Resumo da reunião{{#lead}} — {{lead}}{{/lead}}</h2>{{#resumo}}<p>{{resumo}}</p>{{/resumo}}{{#proximos_passos}}{{#primeiro}}<p><strong>Próximos passos:</strong></p><ul>{{/primeiro}}<li>{{item}}</li>{{#ultimo}}</ul>{{/ultimo}}{{/proximos_passos}}{{#acoes}}{{#primeiro}}<p><strong>Action items:</strong></p><ul>{{/primeiro}}<li>{{item}}</li>{{#ultimo}}</ul>{{/ultimo}}{{/acoes}}{{#objecoes}}{{#primeiro}}<p><strong>Objeções:</strong></p><ul>{{/primeiro}}<li>{{item}}</li>{{#ultimo}}</ul>{{/ultimo}}{{/objecoes}}{{#tem_playbook}}<hr><h3>Coaching · Playbook — aderência {{aderencia}}/100</h3>{{#pontos_fortes}}{{#primeiro}}<p><strong>Pontos fortes:</strong></p><ul>{{/primeiro}}<li>{{item}}</li>{{#ultimo}}</ul>{{/ultimo}}{{/pontos_fortes}}{{#a_melhorar}}{{#primeiro}}<p><strong>A melhorar:</strong></p><ul>{{/primeiro}}<li>{{item}}</li>{{#ultimo}}</ul>{{/ultimo}}{{/a_melhorar}}{{#direcionamento}}{{#primeiro}}<p><strong>Direcionamento:</strong></p><ul>{{/primeiro}}<li>{{item}}</li>{{#ultimo}}</ul>{{/ultimo}}{{/direcionamento}}{{/tem_playbook}}',
  },
  {
    key: 'reuniao_nota_lead', name: 'Reuniões — resumo anexado ao lead (texto)', channel: 'texto',
    body: '*Resumo da reunião*{{#lead}} — {{lead}}{{/lead}}\n{{#resumo}}\n{{resumo}}\n{{/resumo}}{{#proximos_passos}}{{#primeiro}}\nPróximos passos:\n{{/primeiro}}• {{item}}\n{{/proximos_passos}}{{#acoes}}{{#primeiro}}\nAction items:\n{{/primeiro}}• {{item}}\n{{/acoes}}{{#objecoes}}{{#primeiro}}\nObjeções:\n{{/primeiro}}• {{item}}\n{{/objecoes}}',
  },
  {
    key: 'reuniao_nota_lead_titulo', name: 'Reuniões — título da nota anexada ao lead', channel: 'texto',
    body: 'Resumo da reunião (IA)',
  },
  {
    key: 'reuniao_baixa_aderencia_email', name: 'Reuniões — alerta de baixa aderência ao playbook (e-mail ao gestor)', channel: 'email',
    subject: '⚠️ Baixa aderência ({{aderencia}}/100) — reunião',
    body: 'Reunião com baixa aderência ao playbook: {{aderencia}}/100',
    bodyHtml: '<p><strong>⚠️ Reunião com baixa aderência ao playbook: {{aderencia}}/100</strong></p><h2>Resumo da reunião{{#lead}} — {{lead}}{{/lead}}</h2>{{#resumo}}<p>{{resumo}}</p>{{/resumo}}{{#a_melhorar}}{{#primeiro}}<p><strong>A melhorar:</strong></p><ul>{{/primeiro}}<li>{{item}}</li>{{#ultimo}}</ul>{{/ultimo}}{{/a_melhorar}}{{#direcionamento}}{{#primeiro}}<p><strong>Direcionamento:</strong></p><ul>{{/primeiro}}<li>{{item}}</li>{{#ultimo}}</ul>{{/ultimo}}{{/direcionamento}}',
  },

  // ── Chatbot (modo Roteiro) — texto padrão. Cada chatbot pode trocar em
  // Chatbots › Mensagens da conversa; vazio lá = vale este.
  {
    key: 'chatbot_roteiro_invalidSelect', name: 'Chatbot (roteiro) — opção não reconhecida', channel: 'whatsapp',
    body: 'Não entendi. 🙂 Por favor, responda com o *número* da opção.',
  },
  {
    key: 'chatbot_roteiro_invalidAnswer', name: 'Chatbot (roteiro) — resposta inválida ({{erro}})', channel: 'whatsapp',
    body: '{{erro}}. Vamos tentar de novo:',
  },
  {
    key: 'chatbot_roteiro_noMeetingType', name: 'Chatbot (roteiro) — agendamento não configurado', channel: 'whatsapp',
    body: 'Perfeito! Em breve entraremos em contato para agendar. 😊',
  },
  {
    key: 'chatbot_roteiro_noSlots', name: 'Chatbot (roteiro) — sem horários disponíveis', channel: 'whatsapp',
    body: 'No momento não há horários disponíveis. Nossa equipe vai entrar em contato para combinar o melhor horário com você. 😊',
  },
  {
    key: 'chatbot_roteiro_slotPrompt', name: 'Chatbot (roteiro) — pedir horário ({{titulo}} {{horarios}})', channel: 'whatsapp',
    body: '{{titulo}}:\n\n{{horarios}}\n\n_Responda com o número do horário._',
  },
  {
    key: 'chatbot_roteiro_invalidSlot', name: 'Chatbot (roteiro) — horário não reconhecido ({{horarios}})', channel: 'whatsapp',
    body: 'Não entendi o horário. Responda com o número:\n\n{{horarios}}',
  },
  {
    key: 'chatbot_roteiro_invalidSlotList', name: 'Chatbot (roteiro) — horário não reconhecido — título da lista de botões', channel: 'whatsapp',
    body: 'Não entendi o horário. Escolha um:',
  },
  {
    key: 'chatbot_roteiro_slotTaken', name: 'Chatbot (roteiro) — horário indisponível ({{erro}} {{horarios}})', channel: 'whatsapp',
    body: '{{erro}}. Escolha outro:\n\n{{horarios}}',
  },
  {
    key: 'chatbot_roteiro_slotTakenList', name: 'Chatbot (roteiro) — horário indisponível — título da lista de botões', channel: 'whatsapp',
    body: 'Esse horário ficou indisponível. Escolha outro:',
  },
  {
    key: 'chatbot_roteiro_slotTakenErro', name: 'Chatbot (roteiro) — horário indisponível — motivo quando o sistema não informa', channel: 'texto',
    body: 'Horário indisponível',
  },
  {
    key: 'chatbot_roteiro_bookingUnavailable', name: 'Chatbot (roteiro) — agendamento indisponível', channel: 'whatsapp',
    body: 'Agendamento indisponível no momento. Nossa equipe entrará em contato.',
  },
  {
    key: 'chatbot_roteiro_bookingConfirmed', name: 'Chatbot (roteiro) — reunião confirmada ({{horario}} {{nome}})', channel: 'whatsapp',
    body: '✅ Reunião agendada para *{{horario}}*!\n\nVocê vai receber os detalhes por aqui. Até lá! 🚀',
  },
  {
    key: 'chatbot_roteiro_disqualifiedFallback', name: 'Chatbot (roteiro) — encerramento (desqualificado, sem redirecionamento)', channel: 'whatsapp',
    body: 'Obrigado pelas respostas! Em breve entraremos em contato. 😊',
  },
  {
    key: 'chatbot_roteiro_qualifiedDone', name: 'Chatbot (roteiro) — encerramento (qualificado, sem agenda)', channel: 'whatsapp',
    body: 'Obrigado! Em breve entraremos em contato. 😊',
  },
  {
    key: 'chatbot_roteiro_handoffAfterFallback', name: 'Chatbot (roteiro) — passar para uma pessoa da equipe', channel: 'whatsapp',
    body: 'Sem problema! Vou te passar para uma pessoa da equipe continuar daqui. 😊',
  },
  {
    key: 'chatbot_roteiro_flowIntro', name: 'Chatbot (roteiro) — convite para preencher o formulário do WhatsApp', channel: 'whatsapp',
    body: 'Para começar, toque no botão e preencha rapidamente:',
  },
  {
    key: 'chatbot_roteiro_flowNudge', name: 'Chatbot (roteiro) — lembrete para preencher o formulário do WhatsApp', channel: 'whatsapp',
    body: 'Por favor, toque no botão abaixo e preencha o formulário. 🙂',
  },
  {
    key: 'chatbot_roteiro_flowCta', name: 'Chatbot (roteiro) — texto do botão do formulário do WhatsApp', channel: 'texto',
    body: 'Preencher',
  },
  {
    key: 'chatbot_roteiro_slotTitulo', name: 'Chatbot (roteiro) — título da escolha de horário (campo sem rótulo)', channel: 'texto',
    body: 'Escolha o melhor horário para a nossa conversa',
  },

  // ── Chatbot (Jornada IA / IA livre) — mensagens de segurança ──
  {
    key: 'chatbot_ia_desqualificado', name: 'Chatbot IA — encerramento quando o lead não segue (sem resposta da IA)', channel: 'whatsapp',
    body: 'Obrigado pelas suas respostas! No momento não seguimos com o agendamento, mas qualquer novidade a nossa equipe entra em contato. 😊',
  },
  {
    key: 'chatbot_ia_instabilidade', name: 'Chatbot IA — falha momentânea (pede para repetir)', channel: 'whatsapp',
    body: 'Tive uma instabilidade aqui 😕 Pode repetir a sua última mensagem, por favor?',
  },
  {
    key: 'chatbot_ia_verificando', name: 'Chatbot IA — sem resposta final ("já te respondo")', channel: 'whatsapp',
    body: 'Deixa eu verificar isso e já te respondo. 🙂',
  },
  {
    key: 'chatbot_ia_resposta_vazia', name: 'Chatbot IA — resposta quando a IA não devolve texto', channel: 'whatsapp',
    body: 'Certo! Como posso ajudar?',
  },
  {
    key: 'chatbot_saudacao_padrao', name: 'Chatbot — saudação quando o chatbot não tem saudação própria', channel: 'whatsapp',
    body: 'Olá! 👋 Aqui é do atendimento{{#marca}} da {{marca}}{{/marca}}. Como posso te ajudar?',
  },

  // ── Pesquisas (Flow do WhatsApp). Cada pesquisa pode trocar o texto; vazio = este.
  { key: 'pesquisa_intro', name: 'Pesquisa — convite para responder', channel: 'whatsapp', body: 'Sua opinião é muito importante para nós. Leva menos de 3 minutos.' },
  { key: 'pesquisa_cta', name: 'Pesquisa — texto do botão para abrir', channel: 'texto', body: 'Responder pesquisa' },
  { key: 'pesquisa_submitLabel', name: 'Pesquisa — texto do botão de enviar', channel: 'texto', body: 'Enviar respostas' },
  { key: 'pesquisa_navLabel', name: 'Pesquisa — texto do botão de avançar', channel: 'texto', body: 'Continuar' },
  { key: 'pesquisa_thanks', name: 'Pesquisa — agradecimento depois de responder', channel: 'whatsapp', body: 'Obrigado por participar! 💚\n\nSua resposta foi registrada — cada opinião nos ajuda a melhorar os próximos encontros.' },
  { key: 'pesquisa_alreadyAnswered', name: 'Pesquisa — aviso de que já respondeu', channel: 'whatsapp', body: 'Já recebemos a sua resposta desta pesquisa. Obrigado pela participação! 💚' },

  // ── Fora do horário de atendimento (resposta automática; liga em Configurações › Horário)
  { key: 'horario_fora_do_expediente', name: 'Horário de atendimento — resposta fora do expediente (padrão)', channel: 'whatsapp', body: 'Olá! Nosso horário de atendimento é de segunda a sexta, das 9h às 18h. Sua mensagem foi recebida e responderemos no próximo expediente.' },

  // ── Chamada de voz pelo WhatsApp — pedido de permissão (texto padrão)
  { key: 'chamada_pedido_permissao', name: 'Chamada pelo WhatsApp — pedido de permissão para ligar', channel: 'whatsapp', body: 'Podemos te ligar pelo WhatsApp para falar sobre seu atendimento?' },

  // ── Rodapé de descadastro (e-mails de fluxo, cadência e campanha). {{link}}
  {
    key: 'rodape_preferencias_email', name: 'Rodapé — link de preferências (e-mail)', channel: 'email',
    subject: '',
    body: 'Não quer mais receber estes e-mails? Atualize suas preferências: {{link}}',
    bodyHtml: '<hr style="margin:24px 0;border:0;border-top:1px solid #e5e7eb"/><p data-pref-link style="font-size:12px;color:#6b7280;text-align:center">Não quer mais receber estes e-mails? <a href="{{link}}" style="color:#6b7280;text-decoration:underline">Atualize suas preferências</a>.</p>',
  },
  { key: 'rodape_preferencias_texto', name: 'Rodapé — link de preferências (WhatsApp/SMS)', channel: 'texto', body: '---\nNão quer mais receber? Atualize suas preferências em {{link}}' },

  // ── Testes disparados pelo admin
  { key: 'teste_sms', name: 'Teste — SMS de teste (Configurações › SMS)', channel: 'sms', body: 'Teste de SMS{{#marca}} — {{marca}}{{/marca}}.' },

  // ── Acadêmico — comunicação com o aluno. Os textos usam {nome} {curso}
  // {parcela} {valor} {vencimento} {atraso} {link} (chave simples, como na tela
  // Acadêmico › Comunicação, que pode substituir cada um).
  { key: 'aca_vencimento_texto', name: 'Acadêmico — lembrete de vencimento (texto padrão)', channel: 'whatsapp', body: 'Olá {nome}! Sua parcela {parcela} do curso {curso} vence em {vencimento}, no valor de {valor}. Acesse seu portal para a 2ª via: {link}' },
  { key: 'aca_vencimento_assunto', name: 'Acadêmico — assunto do e-mail de vencimento', channel: 'texto', body: 'Lembrete de vencimento' },
  { key: 'aca_cobranca_texto', name: 'Acadêmico — cobrança de parcela vencida (texto padrão)', channel: 'whatsapp', body: 'Olá {nome}! Identificamos a parcela {parcela} do curso {curso} vencida em {vencimento} ({atraso} dia(s) de atraso), valor atualizado {valor}. Regularize pelo portal: {link}' },
  { key: 'aca_cobranca_assunto', name: 'Acadêmico — assunto do e-mail de cobrança', channel: 'texto', body: 'Cobrança de parcela vencida' },
  { key: 'aca_notas_texto', name: 'Acadêmico — notas publicadas (texto padrão)', channel: 'whatsapp', body: 'Olá {nome}! Suas notas do curso {curso} foram publicadas. Confira seu boletim no portal: {link}' },
  { key: 'aca_notas_assunto', name: 'Acadêmico — assunto do e-mail de notas', channel: 'texto', body: 'Notas publicadas' },
  { key: 'aca_sem_nome', name: 'Acadêmico — como chamar o aluno sem nome', channel: 'texto', body: 'aluno(a)' },
  { key: 'aca_sem_curso', name: 'Acadêmico — como citar o curso quando não há nome', channel: 'texto', body: 'seu curso' },
  { key: 'aca_parcela_rotulo', name: 'Acadêmico — como a parcela aparece ({{numero}} {{tipo}})', channel: 'texto', body: '{{numero}}ª ({{tipo}})' },

  // ── Rotinas desligadas no servidor (só saem se alguém religar a rotina) ──
  // Contrato esperando assinatura. {{nome}} {{contrato}} {{dias}} {{link}}
  {
    key: 'contrato_lembrete_wa', name: 'Contrato — lembrete de assinatura pendente (WhatsApp)', channel: 'whatsapp',
    body: 'Olá, {{nome}}! O contrato "{{contrato}}" está esperando sua assinatura há {{dias}} dia(s).{{#link}}\n\nAssine por aqui: {{link}}{{/link}}{{^link}}\n\nProcure a secretaria para receber o link de assinatura.{{/link}}\n\nSe já assinou, pode ignorar esta mensagem.',
  },
  {
    key: 'contrato_lembrete_email', name: 'Contrato — lembrete de assinatura pendente (e-mail)', channel: 'email',
    subject: 'Falta sua assinatura — {{contrato}}',
    body: 'Falta sua assinatura — {{contrato}}',
    bodyHtml: caixa('Falta sua assinatura', '<p>Olá, {{nome}}! O contrato "{{contrato}}" está esperando sua assinatura há {{dias}} dia(s).</p>{{#link}}<p>Assine por aqui: <a href="{{link}}">{{link}}</a></p>{{/link}}{{^link}}<p>Procure a secretaria para receber o link de assinatura.</p>{{/link}}<p style="font-size:13px;color:#5f6368">Se já assinou, pode ignorar esta mensagem.</p>'),
  },
  // Inscrição começada e não terminada. {{nome}} {{portal}} {{link}}
  {
    key: 'inscricao_retomada_wa', name: 'Inscrição — convite para terminar a inscrição (WhatsApp)', channel: 'whatsapp',
    body: 'Olá, {{#nome}}{{nome}}{{/nome}}{{^nome}}tudo bem{{/nome}}! Vi que você começou a inscrição em {{#portal}}{{portal}}{{/portal}}{{^portal}}nosso portal{{/portal}} e não terminou.\n\nSeus dados estão salvos — é só voltar e continuar de onde parou: {{link}}\n\nSe precisar de ajuda para escolher o curso, é só responder por aqui.',
  },
  {
    key: 'inscricao_retomada_email', name: 'Inscrição — convite para terminar a inscrição (e-mail)', channel: 'email',
    subject: 'Sua inscrição está salva — falta pouco',
    body: 'Sua inscrição está salva: {{link}}',
    bodyHtml: caixa('Sua inscrição está salva', '<p>Olá, {{#nome}}{{nome}}{{/nome}}{{^nome}}tudo bem{{/nome}}! Vi que você começou a inscrição em {{#portal}}{{portal}}{{/portal}}{{^portal}}nosso portal{{/portal}} e não terminou.</p><p>Seus dados estão salvos — é só voltar e continuar de onde parou: <a href="{{link}}">{{link}}</a></p>'),
  },
  { key: 'teste_cloud_api', name: 'Teste — mensagem de teste do WhatsApp Oficial', channel: 'whatsapp', body: 'Teste de conexão do WhatsApp Oficial{{#marca}} — {{marca}}{{/marca}}' },
  { key: 'teste_instagram', name: 'Teste — mensagem de teste do Instagram', channel: 'texto', body: 'Teste de conexão do Instagram{{#marca}} — {{marca}}{{/marca}}' },
  { key: 'teste_prefixo', name: 'Teste — marcação no começo de envios de teste ({{texto}})', channel: 'texto', body: '[teste] {{texto}}' },
  { key: 'teste_sem_assunto', name: 'Teste — assunto quando o modelo não tem assunto', channel: 'texto', body: 'Sem assunto' },
  { key: 'helpdesk_resposta_assunto', name: 'Helpdesk — assunto do e-mail de resposta ao cliente ({{assunto}} {{numero}})', channel: 'texto', body: 'Re: {{assunto}} [#{{numero}}]' },
  { key: 'teste_prefixo_ab', name: 'Teste — marcação de teste A/B de campanha ({{versao}} {{texto}})', channel: 'texto', body: '[teste {{versao}}] {{texto}}' },

  // ── Chatbot IA livre com pontuação configurada no chatbot (Score por pilares).
  // {{geral}} {{classificacao}} {{#pilares}}{{nome}} {{nota}}{{/pilares}} {{visao_geral}} {{prioridade}} {{link}}
  {
    key: 'chatbot_ia_resultado_pontuacao', name: 'Chatbot IA — resultado da pontuação ao contato', channel: 'whatsapp',
    body: '📊 *Resultado da sua análise*\n\n*Score Geral:* {{geral}}/100\n*Classificação:* {{classificacao}}\n\n📈 *Scores por pilar:*\n{{#pilares}}• {{nome}}: {{nota}}/100\n{{/pilares}}{{#visao_geral}}\n📋 *Visão Geral:*\n{{visao_geral}}\n{{/visao_geral}}{{#prioridade}}\n🎯 *Prioridade #1:*\n{{prioridade}}\n{{/prioridade}}\n---\nQuer conversar sobre o seu resultado? Estamos à disposição! 💬{{#link}}\n🔗 {{link}}{{/link}}',
  },

  // ── Textos que aparecem para terceiros (convites, apps, pastas, páginas)
  { key: 'reuniao_nome_robo', name: 'Reuniões — nome do robô transcritor na chamada', channel: 'texto', body: 'Transcritor{{#marca}} {{marca}}{{/marca}}' },
  { key: 'drive_pasta_raiz', name: 'Google Drive — nome da pasta principal', channel: 'texto', body: 'CRM{{#marca}} {{marca}}{{/marca}}' },
  { key: 'agenda_bloqueio_descricao', name: 'Google Agenda — descrição do bloqueio de horário', channel: 'texto', body: 'Bloqueio de agenda{{#marca}} — {{marca}}{{/marca}}' },
  { key: 'agendamento_pagina_rodape', name: 'Agendamento — rodapé da página pública', channel: 'texto', body: 'Agendamento{{#marca}} — {{marca}}{{/marca}}', desligado: true },
  { key: 'calendario_aluno_nome', name: 'Portal do aluno — nome do calendário exportado', channel: 'texto', body: 'Calendário acadêmico{{#marca}} — {{marca}}{{/marca}}' },
  { key: 'hsm_parametro_vazio', name: 'Fluxos — texto de um parâmetro do modelo da Meta quando o dado falta', channel: 'texto', body: 'você' },
]

// Conteúdo que o sistema gravava ANTES deste catálogo, com as variáveis
// montadas no código ({{saudacao}}, {{link}} já com "Link: "). Registro ainda
// igual a um destes = ninguém editou → passa para o conteúdo novo.
const CONTEUDO_ANTIGO: Record<string, string[]> = {
  agendamento_confirmado_wa: ['{{saudacao}}\n\n✅ *Reunião confirmada: {{reuniao}}*\n📅 {{quando}}{{link}}'],
  agendamento_lembrete_wa: ['{{saudacao}}\n\n⏰ *Lembrete: {{reuniao}}*\n📅 {{quando}}{{link}}'],
  agendamento_operador_wa: ['🗓️ *Novo agendamento: {{reuniao}}*\n👤 {{nome}}{{telefone}}\n📅 {{quando}}{{link}}'],
  agendamento_confirmado_email: ['{{titulo}}: {{reuniao}}'],
  agendamento_lembrete_email: ['{{titulo}}: {{reuniao}}'],
  agendamento_operador_email: ['🗓️ Novo agendamento: {{reuniao}}'],
}
const semEspaco = (t: string | null | undefined) => String(t ?? '').replace(/\s+/g, '')

/**
 * Grava no banco os modelos que ainda não existem (pela `key`). Nunca
 * sobrescreve: o que alguém editou continua como está.
 */
export async function garantirModelosDoSistema(): Promise<void> {
  for (const [key, antigos] of Object.entries(CONTEUDO_ANTIGO)) {
    const atual = await prisma.messageTemplate.findFirst({ where: { key } }).catch(() => null)
    const padrao = MODELOS_PADRAO.find((m) => m.key === key)
    if (!atual || !padrao) continue
    const texto = semEspaco(atual.channel === 'email' ? atual.bodyHtml || atual.body : atual.body)
    // E-mail antigo: o marcador é o título com {{titulo}}, que só o texto do sistema tinha.
    const igual = antigos.some((a) => atual.channel === 'email' ? texto.includes(semEspaco(a)) && texto.includes('{{linkHtml}}') : texto === semEspaco(a))
    if (!igual) continue
    await prisma.messageTemplate.update({
      where: { id: atual.id },
      data: { body: padrao.body, bodyHtml: padrao.bodyHtml ?? null, subject: padrao.subject ?? atual.subject, category: CATEGORIA_SISTEMA },
    }).catch(() => {})
  }
  const existentes = await prisma.messageTemplate.findMany({
    where: { key: { in: MODELOS_PADRAO.map((m) => m.key) } },
    select: { key: true },
  })
  const tem = new Set(existentes.map((e) => e.key))
  for (const m of MODELOS_PADRAO) {
    if (tem.has(m.key)) continue
    await criar(m).catch((e) => console.warn(`[modelosDoSistema] ${m.key}:`, e?.message))
  }
}

async function criar(m: ModeloPadrao) {
  return prisma.messageTemplate.create({
    data: {
      key: m.key,
      name: m.name,
      channel: m.channel,
      category: CATEGORIA_SISTEMA,
      subject: m.subject ?? null,
      body: m.body,
      bodyHtml: m.bodyHtml ?? null,
      active: !m.desligado,
    },
  })
}

export interface ModeloRenderizado { subject: string; body: string }

/**
 * Texto pronto do modelo `key`, ou `null` quando ele está desligado — nesse
 * caso a mensagem NÃO deve sair. Se o registro sumiu do banco (apagado à mão),
 * é recriado com o conteúdo inicial.
 */
export async function renderizarModelo(key: string, vars: Record<string, any> = {}): Promise<ModeloRenderizado | null> {
  let tpl = await prisma.messageTemplate.findFirst({ where: { key } })
  if (!tpl) {
    const padrao = MODELOS_PADRAO.find((m) => m.key === key)
    if (!padrao) {
      console.warn(`[modelosDoSistema] modelo "${key}" não existe — envio não feito`)
      return null
    }
    tpl = await criar(padrao)
  }
  if (!tpl.active) return null
  const marca = (await getBranding().catch(() => null))?.brandName || ''
  const todas = { marca, data_hoje: new Date().toLocaleDateString('pt-BR'), ...vars }
  const corpo = tpl.channel === 'email' ? (decodeHtmlIfEscaped(tpl.bodyHtml) || tpl.body || '') : (tpl.body || '')
  prisma.messageTemplate.update({ where: { id: tpl.id }, data: { usageCount: { increment: 1 } } }).catch(() => {})
  return { subject: interpolate(tpl.subject || tpl.name || '', todas), body: interpolate(corpo, todas) }
}

/** Chaves do catálogo — a tela de Modelos usa para não deixar excluir (só desligar). */
export function chavesDoSistema(): string[] {
  return MODELOS_PADRAO.map((m) => m.key)
}

/** Texto pronto de um modelo (canal `texto` ou curto), ou '' quando desligado. */
export async function textoDoSistema(key: string, vars: Record<string, any> = {}): Promise<string> {
  return (await renderizarModelo(key, vars))?.body.trim() || ''
}

/** Conteúdo CRU (sem interpolar) do modelo, ou null quando desligado. */
export async function modeloCru(key: string): Promise<string | null> {
  let tpl = await prisma.messageTemplate.findFirst({ where: { key }, select: { body: true, active: true } })
  if (!tpl) {
    const padrao = MODELOS_PADRAO.find((m) => m.key === key)
    if (!padrao) return null
    tpl = await criar(padrao)
  }
  return tpl.active ? tpl.body || '' : null
}
