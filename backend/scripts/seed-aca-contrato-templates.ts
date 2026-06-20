// scripts/seed-aca-contrato-templates.ts
// Templates iniciais de contrato por tipo de negócio (idempotente por nome).
// Rodar: JWT_SECRET=x npx tsx scripts/seed-aca-contrato-templates.ts

import { prisma } from '../src/lib/prisma.js'

const CLAUSULAS_COMUNS = (extra: string) => [
  'Pelo presente instrumento particular de Contrato de Prestação de Serviços Educacionais, de um lado a {{instituicao}}, CNPJ {{cnpj}} (CONTRATADA), e de outro {{aluno.nome}}, CPF {{aluno.cpf}} (CONTRATANTE), têm entre si justo e contratado o seguinte:',
  '',
  `CLÁUSULA 1ª — OBJETO. A CONTRATADA prestará ao CONTRATANTE os serviços educacionais referentes a {{curso}}. ${extra}`,
  '',
  'CLÁUSULA 2ª — PREÇO E PAGAMENTO. Pelos serviços, o CONTRATANTE pagará o valor total de {{valor}}, em {{parcelas}} parcela(s), nas datas e forma do plano de pagamento acordado, sob pena de incidência de juros e multa em caso de atraso.',
  '',
  'CLÁUSULA 3ª — OBRIGAÇÕES DO CONTRATANTE. Cumprir o regimento interno, frequentar as atividades e manter seus dados cadastrais atualizados.',
  '',
  'CLÁUSULA 4ª — RESCISÃO. O contrato poderá ser rescindido nos termos do regimento e da legislação consumerista vigente.',
  '',
  'CLÁUSULA 5ª — ASSINATURA ELETRÔNICA. As partes reconhecem a validade jurídica da assinatura eletrônica deste instrumento (MP 2.200-2/2001 e Lei 14.063/2020).',
  '',
  'E por estarem assim justas e contratadas, as partes assinam eletronicamente em {{data}}.',
].join('\n')

const TEMPLATES = [
  { nome: 'Contrato — Graduação', tipoNegocio: 'GRADUACAO', descricao: 'Curso de graduação (bacharelado/licenciatura/tecnólogo)', extra: 'O curso observa as Diretrizes Curriculares Nacionais e o calendário acadêmico semestral.', deadlineDias: 10 },
  { nome: 'Contrato — Pós-graduação', tipoNegocio: 'POS_GRADUACAO', descricao: 'Pós-graduação lato sensu', extra: 'O curso de pós-graduação observa a carga horária mínima regulamentar e a entrega de trabalho de conclusão, quando exigido.', deadlineDias: 10 },
  { nome: 'Contrato — Especialização', tipoNegocio: 'ESPECIALIZACAO', descricao: 'Especialização lato sensu', extra: 'A especialização será ministrada conforme matriz e exige aproveitamento mínimo para certificação.', deadlineDias: 10 },
  { nome: 'Contrato — Curso Técnico (tradicional)', tipoNegocio: 'TECNICO_TRADICIONAL', descricao: 'Curso técnico de nível médio, modular/tradicional', extra: 'O curso técnico observa o Catálogo Nacional de Cursos Técnicos e a carga horária de estágio supervisionado, quando aplicável.', deadlineDias: 7 },
  { nome: 'Contrato — Certificação por Competência', tipoNegocio: 'CERTIFICACAO_COMPETENCIA', descricao: 'Reconhecimento/certificação de competências', extra: 'A certificação por competência ocorre mediante avaliação e validação de saberes, nos termos da legislação e do regimento da instituição.', deadlineDias: 7 },
  { nome: 'Contrato — Curso Livre / Extensão', tipoNegocio: 'CURSO_LIVRE', descricao: 'Curso livre, extensão ou capacitação', extra: 'O curso livre tem natureza de qualificação profissional e não confere grau acadêmico.', deadlineDias: 5 },
]

async function main() {
  let novos = 0, atualizados = 0
  for (let i = 0; i < TEMPLATES.length; i++) {
    const t = TEMPLATES[i]
    const corpo = CLAUSULAS_COMUNS(t.extra)
    const existente = await prisma.acaContratoTemplate.findFirst({ where: { nome: t.nome }, select: { id: true } })
    const data = {
      nome: t.nome, tipoNegocio: t.tipoNegocio as any, descricao: t.descricao, corpoTexto: corpo, ordem: i,
      config: { deadlineDias: t.deadlineDias, reminder: 'WEEKLY', sortable: false, refusable: true, mensagem: 'Olá! Segue seu contrato para assinatura eletrônica.' },
      signatariosPadrao: [{ papel: 'ALUNO', acao: 'SIGN', deliveryMethod: 'EMAIL' }, { papel: 'RESPONSAVEL', acao: 'SIGN', deliveryMethod: 'EMAIL' }],
    }
    if (existente) { await prisma.acaContratoTemplate.update({ where: { id: existente.id }, data }); atualizados++ }
    else { await prisma.acaContratoTemplate.create({ data }); novos++ }
    console.log(`  ✓ ${t.nome}`)
  }
  console.log(`\n✅ Templates de contrato: ${novos} novos, ${atualizados} atualizados.`)
}
main().then(() => prisma.$disconnect()).catch((e) => { console.error('ERRO:', e); prisma.$disconnect(); process.exit(1) })
