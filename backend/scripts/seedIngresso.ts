// scripts/seedIngresso.ts
//
// Configuração dos modos de ingresso e do catálogo de documentos.
//
// Por que existe: as tabelas `bychat_edu_entry_modes` e
// `bychat_edu_document_types` nasceram vazias. Sem modo de ingresso, o processo
// seletivo não sabe como avaliar o candidato (o evaluator lê
// `entryMode.evaluationType`) e o vínculo acadêmico não consegue declarar a
// forma de ingresso que o Censo exige.
//
// NÃO é dado de demonstração — é configuração. Idempotente por `code`: rodar de
// novo atualiza, não duplica. Rodar com:
//   cd backend && npx tsx scripts/seedIngresso.ts
//
// A forma do Censo de cada modo segue services/acaFormaIngresso.ts. Onde a
// classificação oficial é discutível, o comentário diz o porquê da escolha —
// a secretaria deve confirmar no manual do Censo do ano corrente.

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

interface DocDef { code: string; name: string; category: string; ordem: number }

/** Documentos que qualquer secretaria brasileira pede. Base do catálogo. */
const DOCUMENTOS: DocDef[] = [
  { code: 'rg', name: 'RG (documento de identidade)', category: 'identity', ordem: 10 },
  { code: 'cpf', name: 'CPF', category: 'identity', ordem: 20 },
  { code: 'foto_3x4', name: 'Foto 3x4', category: 'identity', ordem: 30 },
  { code: 'certidao_civil', name: 'Certidão de nascimento ou casamento', category: 'identity', ordem: 40 },
  { code: 'comprovante_residencia', name: 'Comprovante de residência', category: 'identity', ordem: 50 },
  { code: 'titulo_eleitor', name: 'Título de eleitor', category: 'identity', ordem: 60 },
  { code: 'reservista', name: 'Certificado de reservista', category: 'identity', ordem: 70 },
  { code: 'historico_medio', name: 'Histórico escolar do ensino médio', category: 'academic', ordem: 100 },
  { code: 'certificado_medio', name: 'Certificado de conclusão do ensino médio', category: 'academic', ordem: 110 },
  { code: 'diploma_graduacao', name: 'Diploma de graduação', category: 'academic', ordem: 120 },
  { code: 'historico_graduacao', name: 'Histórico escolar da graduação', category: 'academic', ordem: 130 },
  { code: 'declaracao_transferencia', name: 'Declaração de transferência', category: 'academic', ordem: 140 },
  { code: 'ementa_disciplinas', name: 'Ementas das disciplinas cursadas', category: 'academic', ordem: 150 },
  { code: 'curriculo', name: 'Currículo (Lattes ou profissional)', category: 'academic', ordem: 160 },
  { code: 'boletim_enem', name: 'Boletim de notas do Enem', category: 'enem', ordem: 200 },
  { code: 'oficio_remocao', name: 'Ofício de remoção (transferência ex-officio)', category: 'other', ordem: 300 },
  { code: 'decisao_judicial', name: 'Decisão judicial', category: 'other', ordem: 310 },
  { code: 'laudo_pcd', name: 'Laudo médico (pessoa com deficiência)', category: 'other', ordem: 320 },
  { code: 'comprovante_experiencia', name: 'Comprovante de experiência profissional', category: 'other', ordem: 330 },
]

interface ModoDef {
  code: string
  name: string
  icon: string
  description: string
  evaluationType: 'none' | 'docs' | 'enem' | 'exam_online' | 'exam_presencial'
  requiresClassification: boolean
  censoForma: string
  criterioClassificacao: string
  ordem: number
  /** códigos de DocumentType; prefixo `?` = opcional. */
  documentos: string[]
}

const MODOS: ModoDef[] = [
  // ── Técnico ──
  {
    code: 'tecnico_ordem_inscricao',
    name: 'Técnico — ordem de inscrição',
    icon: '🎟️',
    description:
      'Sem prova. As vagas são preenchidas por ordem de inscrição, até esgotar. '
      + 'Declarado no Censo como seleção simplificada.',
    evaluationType: 'docs',
    requiresClassification: true,
    censoForma: 'SELECAO_SIMPLIFICADA',
    criterioClassificacao: 'ORDEM_INSCRICAO',
    ordem: 10,
    documentos: ['rg', 'cpf', 'historico_medio', 'certificado_medio', '?foto_3x4', '?comprovante_residencia'],
  },
  {
    code: 'tecnico_analise_historico',
    name: 'Técnico — análise de histórico',
    icon: '📄',
    description:
      'Sem prova. Classifica pela média das notas do histórico do ensino médio.',
    evaluationType: 'docs',
    requiresClassification: true,
    censoForma: 'SELECAO_SIMPLIFICADA',
    criterioClassificacao: 'MEDIA_HISTORICO',
    ordem: 20,
    documentos: ['rg', 'cpf', 'historico_medio', 'certificado_medio', '?foto_3x4'],
  },
  {
    code: 'tecnico_entrevista',
    name: 'Técnico — entrevista',
    icon: '🗣️',
    description: 'Entrevista com banca, registrada com parecer e nota.',
    evaluationType: 'docs',
    requiresClassification: true,
    censoForma: 'SELECAO_SIMPLIFICADA',
    criterioClassificacao: 'ENTREVISTA',
    ordem: 30,
    documentos: ['rg', 'cpf', 'historico_medio', '?curriculo'],
  },

  // ── Pós-graduação e especialização (lato sensu) ──
  // Res. CNE/CES 1/2018, art. 6º: especialização É registrada no Censo da
  // Educação Superior — por isso estes modos declaram forma do Censo.
  {
    code: 'pos_analise_curriculo',
    name: 'Pós-graduação — análise de currículo',
    icon: '📋',
    description:
      'Banca pontua currículo e experiência profissional. Exige diploma de graduação '
      + '(requisito de elegibilidade, não de classificação).',
    evaluationType: 'docs',
    requiresClassification: true,
    censoForma: 'SELECAO_SIMPLIFICADA',
    criterioClassificacao: 'ANALISE_CURRICULO',
    ordem: 40,
    documentos: ['rg', 'cpf', 'diploma_graduacao', 'historico_graduacao', 'curriculo', '?comprovante_experiencia'],
  },
  {
    code: 'especializacao_diploma',
    name: 'Especialização — análise de diploma',
    icon: '🎓',
    description:
      'Sem prova e sem ranking: verifica apenas se o candidato tem o diploma de graduação '
      + 'exigido. É o ingresso mais comum em lato sensu.',
    evaluationType: 'docs',
    requiresClassification: false,
    censoForma: 'SELECAO_SIMPLIFICADA',
    criterioClassificacao: 'ANALISE_DIPLOMA',
    ordem: 50,
    documentos: ['rg', 'cpf', 'diploma_graduacao', 'historico_graduacao', '?foto_3x4'],
  },

  // ── Com prova ──
  {
    code: 'vestibular_online',
    name: 'Vestibular online (redação)',
    icon: '✍️',
    description:
      'Redação digital com correção humana ou assistida por IA. O code é lido pelo '
      + 'evaluator de redação — não renomeie.',
    evaluationType: 'exam_online',
    requiresClassification: true,
    censoForma: 'VESTIBULAR',
    criterioClassificacao: 'REDACAO_ONLINE',
    ordem: 60,
    documentos: ['rg', 'cpf', 'historico_medio', 'certificado_medio'],
  },
  {
    code: 'vestibular_presencial',
    name: 'Vestibular presencial',
    icon: '🏫',
    description: 'Prova aplicada em local físico, com ensalamento e nota de corte.',
    evaluationType: 'exam_presencial',
    requiresClassification: true,
    censoForma: 'VESTIBULAR',
    criterioClassificacao: 'PROVA_PROPRIA',
    ordem: 70,
    documentos: ['rg', 'cpf', 'historico_medio', 'certificado_medio', '?foto_3x4'],
  },
  {
    code: 'enem',
    name: 'Enem',
    icon: '📊',
    description: 'Usa a nota do Enem informada pelo candidato, com nota de corte configurada no processo.',
    evaluationType: 'enem',
    requiresClassification: true,
    censoForma: 'ENEM',
    criterioClassificacao: 'NOTA_ENEM',
    ordem: 80,
    documentos: ['rg', 'cpf', 'boletim_enem', 'historico_medio', 'certificado_medio'],
  },

  // ── Sem disputa por vaga ──
  {
    code: 'transferencia_externa',
    name: 'Transferência de outra instituição',
    icon: '🔁',
    description:
      'Candidato vindo de outra instituição, por vontade própria. Ocupa vaga não preenchida, '
      + 'e por isso é declarado como vaga remanescente — confirme no manual do Censo do ano. '
      + 'Não confundir com transferência ex-officio (aceitação obrigatória).',
    evaluationType: 'docs',
    requiresClassification: false,
    censoForma: 'VAGA_REMANESCENTE',
    criterioClassificacao: 'ANALISE_CURRICULO',
    ordem: 90,
    documentos: ['rg', 'cpf', 'declaracao_transferencia', 'historico_graduacao', 'ementa_disciplinas'],
  },
  {
    code: 'transferencia_exofficio',
    name: 'Transferência ex-officio',
    icon: '⚖️',
    description:
      'Servidor público federal removido no interesse da administração, ou dependente. '
      + 'Aceitação obrigatória pela instituição, a qualquer tempo. Aplica-se também a refugiados.',
    evaluationType: 'none',
    requiresClassification: false,
    censoForma: 'TRANSFERENCIA_EXOFFICIO',
    criterioClassificacao: 'SEM_CLASSIFICACAO',
    ordem: 100,
    documentos: ['rg', 'cpf', 'oficio_remocao', 'historico_graduacao', '?ementa_disciplinas'],
  },
  {
    code: 'decisao_judicial',
    name: 'Decisão judicial',
    icon: '🧑‍⚖️',
    description: 'Vínculo criado por determinação judicial. Não há classificação.',
    evaluationType: 'none',
    requiresClassification: false,
    censoForma: 'DECISAO_JUDICIAL',
    criterioClassificacao: 'SEM_CLASSIFICACAO',
    ordem: 110,
    documentos: ['rg', 'cpf', 'decisao_judicial'],
  },
  {
    code: 'reingresso',
    name: 'Reingresso',
    icon: '↩️',
    description:
      'Candidato que já teve vínculo na instituição e volta. No Censo é vaga remanescente — '
      + '"reingresso" não existe como forma própria.',
    evaluationType: 'docs',
    requiresClassification: false,
    censoForma: 'VAGA_REMANESCENTE',
    criterioClassificacao: 'SEM_CLASSIFICACAO',
    ordem: 120,
    documentos: ['rg', 'cpf', '?historico_graduacao'],
  },
]

/** Níveis que a instituição oferta. Só "Técnico" existia. */
const NIVEIS = [
  { codigo: 'pos_graduacao', nome: 'Pós-graduação', ordem: 20 },
  { codigo: 'especializacao', nome: 'Especialização', ordem: 30 },
]

async function main() {
  console.log('── Documentos ──')
  const docIds = new Map<string, number>()
  for (const d of DOCUMENTOS) {
    const row = await prisma.documentType.upsert({
      where: { code: d.code },
      create: { code: d.code, name: d.name, category: d.category, ordem: d.ordem, active: true },
      update: { name: d.name, category: d.category, ordem: d.ordem },
    })
    docIds.set(d.code, row.id)
  }
  console.log(`  ${docIds.size} tipos de documento`)

  console.log('── Modos de ingresso ──')
  for (const m of MODOS) {
    const modo = await prisma.entryMode.upsert({
      where: { code: m.code },
      create: {
        code: m.code, name: m.name, icon: m.icon, description: m.description,
        evaluationType: m.evaluationType, requiresClassification: m.requiresClassification,
        censoForma: m.censoForma, criterioClassificacao: m.criterioClassificacao,
        ordem: m.ordem, active: true,
      },
      update: {
        name: m.name, icon: m.icon, description: m.description,
        evaluationType: m.evaluationType, requiresClassification: m.requiresClassification,
        censoForma: m.censoForma, criterioClassificacao: m.criterioClassificacao,
        ordem: m.ordem,
      },
    })
    // Requisitos documentais: upsert por par, sem apagar o que a escola ajustou.
    let i = 0
    for (const spec of m.documentos) {
      const opcional = spec.startsWith('?')
      const code = opcional ? spec.slice(1) : spec
      const documentTypeId = docIds.get(code)
      if (!documentTypeId) { console.warn(`  ! documento "${code}" não existe no catálogo`); continue }
      i += 10
      await prisma.entryModeDocumentRequirement.upsert({
        where: { entryModeId_documentTypeId: { entryModeId: modo.id, documentTypeId } },
        create: { entryModeId: modo.id, documentTypeId, required: !opcional, ordem: i },
        update: { required: !opcional, ordem: i },
      })
    }
    console.log(`  ${m.code} → ${m.censoForma} / ${m.criterioClassificacao} (${m.documentos.length} docs)`)
  }

  console.log('── Níveis de ensino ──')
  for (const n of NIVEIS) {
    const existe = await prisma.educationalLevel.findFirst({ where: { OR: [{ codigo: n.codigo }, { nome: n.nome }] } })
    if (existe) { console.log(`  ${n.nome} já existe (#${existe.id})`); continue }
    const row = await prisma.educationalLevel.create({
      data: { codigo: n.codigo, nome: n.nome, ordem: n.ordem, active: true },
    })
    console.log(`  ${n.nome} criado (#${row.id})`)
  }

  console.log('\nPronto. Configure a forma do Censo de cada processo seletivo escolhendo o modo de ingresso.')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
