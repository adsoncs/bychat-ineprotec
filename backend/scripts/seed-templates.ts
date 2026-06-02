// scripts/seed-templates.ts
// Cria templates padrao de mensagem
// Uso: npx tsx scripts/seed-templates.ts

import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const templates = [
  // ─── WhatsApp ───
  {
    name: 'Proposta Comercial',
    channel: 'whatsapp',
    category: 'proposal',
    body: `Ola {{nome}}! Tudo bem?

Aqui e da *BeyondHub* e estou entrando em contato sobre a {{empresa}}.

Com base no diagnostico que realizamos (Score: {{score}}/100, Maturidade: {{maturidade}}), preparamos uma proposta personalizada da solucao *{{solucao}}* para a sua empresa.

Estou enviando o documento em anexo com todos os detalhes, valores e cronograma.

Ficou com alguma duvida? Estou a disposicao!

Att, {{operador}}
BeyondHub - Consultoria de Growth`,
  },
  {
    name: 'Follow-up pos diagnostico',
    channel: 'whatsapp',
    category: 'follow_up',
    body: `Ola {{nome}}, tudo bem?

Vi que voce completou o diagnostico Raio-X de Growth da {{empresa}} e gostaria de saber se conseguiu analisar os resultados.

Seu score geral foi *{{score}}/100* e a solucao mais indicada e *{{solucao}}*.

Posso agendar uma conversa rapida para explicar os proximos passos? Seria so 15 minutos.

Abracos!
{{operador}} - BeyondHub`,
  },
  {
    name: 'Lembrete de reuniao',
    channel: 'whatsapp',
    category: 'reminder',
    body: `Ola {{nome}}! Tudo certo?

Passando para lembrar da nossa reuniao agendada. Nos vemos em breve!

Caso precise reagendar, e so me avisar por aqui.

Ate la!
{{operador}}`,
  },
  {
    name: 'Boas-vindas novo lead',
    channel: 'whatsapp',
    category: 'onboarding',
    body: `Ola {{nome}}, seja bem-vindo(a) a BeyondHub!

Sou {{operador}} e vou te acompanhar na jornada de crescimento da {{empresa}}.

Vi que voce esta no segmento de *{{segmento}}* em *{{cidade}}* e ja tenho algumas ideias de como podemos ajudar.

Quando seria um bom horario para conversarmos?`,
  },
  {
    name: 'Mensagem livre',
    channel: 'whatsapp',
    category: 'general',
    body: `Ola {{nome}}, tudo bem?

`,
  },

  // ─── Email ───
  {
    name: 'Proposta Comercial',
    channel: 'email',
    category: 'proposal',
    subject: 'Proposta BeyondHub para {{empresa}} - {{solucao}}',
    body: `Prezado(a) {{nome}},

Conforme nosso contato, segue em anexo a proposta comercial personalizada para a {{empresa}}.

Com base no diagnostico realizado, identificamos que a solucao mais adequada e {{solucao}}, considerando o score de {{score}}/100 e nivel de maturidade "{{maturidade}}".

Principais pontos da proposta:
- Solucao recomendada: {{solucao}}
- Segmento: {{segmento}}
- Score atual: {{score}}/100

O documento em anexo contem todos os detalhes, cronograma e investimento.

Fico a disposicao para esclarecer qualquer duvida.

Atenciosamente,
{{operador}}
BeyondHub - Consultoria de Growth`,
    bodyHtml: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#333">
  <div style="background:#1a73e8;padding:24px 32px;border-radius:8px 8px 0 0">
    <h1 style="color:#fff;margin:0;font-size:22px">BeyondHub</h1>
    <p style="color:rgba(255,255,255,0.85);margin:4px 0 0;font-size:14px">Proposta Comercial</p>
  </div>
  <div style="padding:32px;background:#fff;border:1px solid #e8eaed;border-top:none;border-radius:0 0 8px 8px">
    <p>Prezado(a) <strong>{{nome}}</strong>,</p>
    <p>Conforme nosso contato, segue em anexo a proposta comercial personalizada para a <strong>{{empresa}}</strong>.</p>
    <div style="background:#f8f9fa;border-left:4px solid #1a73e8;padding:16px 20px;margin:20px 0;border-radius:0 4px 4px 0">
      <p style="margin:0 0 8px"><strong>Diagnostico Raio-X de Growth</strong></p>
      <table style="font-size:14px;width:100%">
        <tr><td style="padding:4px 0;color:#5f6368">Solucao:</td><td style="padding:4px 0;font-weight:600">{{solucao}}</td></tr>
        <tr><td style="padding:4px 0;color:#5f6368">Score:</td><td style="padding:4px 0;font-weight:600">{{score}}/100</td></tr>
        <tr><td style="padding:4px 0;color:#5f6368">Maturidade:</td><td style="padding:4px 0;font-weight:600">{{maturidade}}</td></tr>
        <tr><td style="padding:4px 0;color:#5f6368">Segmento:</td><td style="padding:4px 0">{{segmento}}</td></tr>
      </table>
    </div>
    <p>O documento em anexo contem todos os detalhes, cronograma e investimento.</p>
    <p>Fico a disposicao para esclarecer qualquer duvida.</p>
    <p style="margin-top:24px">Atenciosamente,<br><strong>{{operador}}</strong><br>BeyondHub - Consultoria de Growth</p>
  </div>
</div>`,
  },
  {
    name: 'Follow-up pos diagnostico',
    channel: 'email',
    category: 'follow_up',
    subject: 'Sobre seu diagnostico Raio-X de Growth - {{empresa}}',
    body: `Ola {{nome}},

Espero que esteja bem! Estou entrando em contato sobre o diagnostico Raio-X de Growth que realizamos para a {{empresa}}.

Resultados:
- Score geral: {{score}}/100
- Maturidade: {{maturidade}}
- Solucao recomendada: {{solucao}}

Gostaria de agendar uma conversa rapida para discutir como podemos ajudar a {{empresa}} a alcancar o proximo nivel.

Qual seria o melhor dia e horario para voce?

Abracos,
{{operador}}
BeyondHub`,
    bodyHtml: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#333">
  <div style="background:#1a73e8;padding:24px 32px;border-radius:8px 8px 0 0">
    <h1 style="color:#fff;margin:0;font-size:22px">BeyondHub</h1>
    <p style="color:rgba(255,255,255,0.85);margin:4px 0 0;font-size:14px">Follow-up - Raio-X de Growth</p>
  </div>
  <div style="padding:32px;background:#fff;border:1px solid #e8eaed;border-top:none;border-radius:0 0 8px 8px">
    <p>Ola <strong>{{nome}}</strong>,</p>
    <p>Espero que esteja bem! Estou entrando em contato sobre o diagnostico que realizamos para a <strong>{{empresa}}</strong>.</p>
    <div style="background:#e8f0fe;padding:20px;border-radius:8px;margin:20px 0;text-align:center">
      <div style="font-size:36px;font-weight:700;color:#1a73e8">{{score}}<span style="font-size:16px;color:#5f6368">/100</span></div>
      <div style="font-size:13px;color:#5f6368;margin-top:4px">Score Geral · {{maturidade}}</div>
      <div style="margin-top:12px;padding:8px 16px;background:#1a73e8;color:#fff;border-radius:20px;display:inline-block;font-size:14px;font-weight:500">{{solucao}}</div>
    </div>
    <p>Gostaria de agendar uma conversa rapida para discutir os proximos passos. Qual seria o melhor dia e horario?</p>
    <p style="margin-top:24px">Abracos,<br><strong>{{operador}}</strong><br>BeyondHub</p>
  </div>
</div>`,
  },
  {
    name: 'Envio de relatorio',
    channel: 'email',
    category: 'report',
    subject: 'Relatorio Raio-X de Growth - {{empresa}}',
    body: `Prezado(a) {{nome}},

Segue em anexo o relatorio completo do diagnostico Raio-X de Growth da {{empresa}}.

Atenciosamente,
{{operador}}
BeyondHub`,
    bodyHtml: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#333">
  <div style="background:#1a73e8;padding:24px 32px;border-radius:8px 8px 0 0">
    <h1 style="color:#fff;margin:0;font-size:22px">BeyondHub</h1>
    <p style="color:rgba(255,255,255,0.85);margin:4px 0 0;font-size:14px">Relatorio de Diagnostico</p>
  </div>
  <div style="padding:32px;background:#fff;border:1px solid #e8eaed;border-top:none;border-radius:0 0 8px 8px">
    <p>Prezado(a) <strong>{{nome}}</strong>,</p>
    <p>Segue em anexo o relatorio completo do diagnostico Raio-X de Growth da <strong>{{empresa}}</strong>.</p>
    <p style="margin-top:24px">Atenciosamente,<br><strong>{{operador}}</strong><br>BeyondHub - Consultoria de Growth</p>
  </div>
</div>`,
  },
  {
    name: 'Mensagem livre',
    channel: 'email',
    category: 'general',
    subject: '',
    body: `Prezado(a) {{nome}},



Atenciosamente,
{{operador}}
BeyondHub`,
    bodyHtml: null,
  },
]

async function seed() {
  console.log('Seeding message templates...')
  const existing = await prisma.messageTemplate.count()
  if (existing > 0) {
    console.log(`  Ja existem ${existing} templates, pulando seed.`)
    await prisma.$disconnect()
    return
  }

  for (const t of templates) {
    await prisma.messageTemplate.create({ data: t as any })
    console.log(`  Criado: [${t.channel}] ${t.name}`)
  }
  console.log(`\nSeed concluido! ${templates.length} templates criados.`)
  await prisma.$disconnect()
}

seed().catch(err => { console.error(err); process.exit(1) })
