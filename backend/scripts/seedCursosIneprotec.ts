// scripts/seedCursosIneprotec.ts
//
// Catálogo real de cursos da INEPROTEC, levantado de ineprotec.com.br em
// 29/07/2026. São 21 cursos em cinco níveis diferentes, e a distinção entre eles
// não é cosmética — define qual regulador responde por cada um:
//
//   Técnico (1.200h)                → SISTEC · diploma técnico de nível médio
//   Especialização TÉCNICA (360h)   → SISTEC · nível MÉDIO (Res. CNE/CP 1/2021,
//                                     art. 15, III). NÃO é lato sensu.
//   Pós-graduação lato sensu (400h) → Censo da Educação Superior · Res. CNE/CES
//                                     1/2018 (360h mín., 30% stricto sensu,
//                                     histórico com corpo docente)
//   Qualificação FIC (104–180h)     → SISTEC aceita, com status de reprovação
//   Curso livre (8–60h)             → não regulado
//
// A armadilha aqui é a "Especialização Técnica em Georreferenciamento": ela pede
// diploma TÉCNICO (CFT/CRT), não de graduação, e portanto é de nível médio. Um
// ERP que casasse a palavra "especialização" aplicaria a ela as exigências do
// lato sensu indevidamente — ver ehLatoSensu() em services/acaLatoSensu.ts.
//
// Idempotente por (nome, unitId). Rodar com:
//   cd backend && npx tsx scripts/seedCursosIneprotec.ts

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

interface NivelDef { codigo: string; nome: string; ordem: number; descricao: string }

const NIVEIS: NivelDef[] = [
  { codigo: 'tecnico', nome: 'Técnico', ordem: 10, descricao: 'Habilitação técnica de nível médio (SISTEC, CNCT).' },
  {
    codigo: 'especializacao_tecnica', nome: 'Especialização Técnica', ordem: 20,
    descricao: 'Especialização profissional técnica de nível MÉDIO (Res. CNE/CP 1/2021, art. 15, III). '
      + 'Exige diploma técnico, não de graduação. Não é pós-graduação lato sensu.',
  },
  {
    codigo: 'pos_graduacao', nome: 'Pós-graduação', ordem: 30,
    descricao: 'Pós-graduação lato sensu (especialização). Registrada no Censo da Educação Superior '
      + '(Res. CNE/CES 1/2018, art. 6º) — exige diploma de graduação.',
  },
  {
    codigo: 'qualificacao_fic', nome: 'Qualificação Profissional (FIC)', ordem: 40,
    descricao: 'Formação Inicial e Continuada. Diferente do técnico, o SISTEC aceita status de reprovação em FIC.',
  },
  { codigo: 'curso_livre', nome: 'Curso Livre', ordem: 50, descricao: 'Treinamento sem regulação, certificado próprio.' },
]

interface CursoDef {
  nome: string
  nivel: string
  cargaHoraria: number
  grau: string
  modalidade: string
  duracaoMeses?: number
  eixoTecnologico?: string
  /** Código no CNCT. Só quando confirmado — inventar é pior que deixar vazio. */
  codigoCnct?: string
  certificacaoIntermediaria?: boolean
  perfilConclusao?: string
  descricao?: string
}

const CURSOS: CursoDef[] = [
  // ── Técnicos (1.200h, EaD com 20% presencial) ──
  {
    nome: 'Técnico em Agrimensura',
    nivel: 'tecnico', cargaHoraria: 1200, grau: 'tecnico', modalidade: 'ead', duracaoMeses: 12,
    eixoTecnologico: 'Infraestrutura', codigoCnct: '132', certificacaoIntermediaria: true,
    perfilConclusao:
      'Atua em levantamentos topográficos, geodésicos e cartográficos e em serviços de '
      + 'georreferenciamento de imóveis rurais e urbanos.',
    descricao:
      'EaD com 20% da carga horária em encontros presenciais. Cinco módulos: Fundamentos e Bases; '
      + 'Topografia e Cartografia; Geodésia e Georreferenciamento; SIG e Planejamento; Legislação, '
      + 'Avaliação e Gestão. Conclusão em 6 a 12 meses. Ingresso: ensino médio completo.',
  },
  {
    nome: 'Técnico em Eletrotécnica',
    nivel: 'tecnico', cargaHoraria: 1200, grau: 'tecnico', modalidade: 'ead', duracaoMeses: 12,
    // O site não informa o eixo; no CNCT, Eletrotécnica está em Controle e
    // Processos Industriais (junto de Automação Industrial, Eletromecânica e
    // Eletrônica), não em Infraestrutura.
    eixoTecnologico: 'Controle e Processos Industriais', certificacaoIntermediaria: true,
    perfilConclusao:
      'Projeta e executa instalações elétricas prediais, industriais e rurais; realiza manutenção de '
      + 'sistemas elétricos; opera máquinas e equipamentos de geração e distribuição de energia; '
      + 'elabora laudos técnicos e implementa soluções de eficiência energética.',
    descricao:
      'EaD com 20% em encontros presenciais obrigatórios (dispensados para aluno em certificação de '
      + 'competências). Três módulos sequenciais. Conclusão em 6 a 12 meses. Ingresso: ensino médio '
      + 'completo. Código CNCT a confirmar no catálogo.',
  },

  // ── Especialização TÉCNICA — nível MÉDIO, não lato sensu ──
  {
    nome: 'Especialização Técnica em Georreferenciamento de Imóveis Rurais',
    nivel: 'especializacao_tecnica', cargaHoraria: 360, grau: 'especializacao_tecnica',
    modalidade: 'ead', duracaoMeses: 6, eixoTecnologico: 'Infraestrutura',
    perfilConclusao:
      'Executa georreferenciamento de imóveis rurais conforme a norma técnica do INCRA, aplicando '
      + 'geotecnologias e cartografia.',
    descricao:
      'Especialização profissional técnica de nível MÉDIO (Res. CNE/CP 1/2021, art. 15, III) — não é '
      + 'pós-graduação lato sensu. Exige diploma TÉCNICO da área (Agrimensura, Edificações, Estradas, '
      + 'Agropecuária, Agricultura ou correlatas), vinculado a CFT/CRT/CFTA. Inclui 60h de estágio '
      + 'obrigatório e 20% presencial. Ingresso por análise de diploma, sem prova.',
  },

  // ── Pós-graduação lato sensu ──
  {
    nome: 'Pós-graduação em Georreferenciamento de Imóveis Rurais',
    nivel: 'pos_graduacao', cargaHoraria: 400, grau: 'pos_lato', modalidade: 'ead', duracaoMeses: 12,
    perfilConclusao:
      'Especialista apto a coordenar e executar georreferenciamento de imóveis rurais, com domínio de '
      + 'cartografia, geoprocessamento e geodésia aplicada.',
    descricao:
      'Lato sensu — registrada no Censo da Educação Superior (Res. CNE/CES 1/2018, art. 6º). Exige '
      + 'diploma de NÍVEL SUPERIOR (engenharia agrimensura, cartografia, agronomia, florestal, '
      + 'agrícola, geologia, arquitetura, minas ou civil), com registro no CONFEA/CREA ou CAU. '
      + '400h incluindo 40h de trabalho final e 20% de atividades práticas/presenciais. Ingresso por '
      + 'análise de diploma, sem prova.',
  },

  // ── Qualificação profissional (FIC) ──
  {
    nome: 'Ajustador Mecânico', nivel: 'qualificacao_fic', cargaHoraria: 180,
    grau: 'qualificacao', modalidade: 'ead',
    eixoTecnologico: 'Controle e Processos Industriais',
    perfilConclusao: 'Executa ajustes e acabamentos em peças e conjuntos mecânicos, com uso de instrumentos de medição.',
  },
  {
    nome: 'Auxiliar Mecânico de Manutenção', nivel: 'qualificacao_fic', cargaHoraria: 160,
    grau: 'qualificacao', modalidade: 'ead',
    eixoTecnologico: 'Controle e Processos Industriais',
    perfilConclusao: 'Auxilia na manutenção preventiva e corretiva de máquinas e equipamentos industriais.',
  },
  {
    nome: 'Comandos Elétricos', nivel: 'qualificacao_fic', cargaHoraria: 120,
    grau: 'qualificacao', modalidade: 'ead',
    eixoTecnologico: 'Controle e Processos Industriais',
    perfilConclusao: 'Monta e mantém circuitos de comando e proteção de motores elétricos.',
  },
  {
    nome: 'Eletricista Instalador Predial de Baixa Tensão', nivel: 'qualificacao_fic', cargaHoraria: 104,
    grau: 'qualificacao', modalidade: 'ead',
    eixoTecnologico: 'Controle e Processos Industriais',
    perfilConclusao: 'Instala e mantém circuitos elétricos prediais de baixa tensão conforme a NBR 5410.',
  },
  {
    nome: 'Torneiro Mecânico', nivel: 'qualificacao_fic', cargaHoraria: 180,
    grau: 'qualificacao', modalidade: 'ead',
    eixoTecnologico: 'Controle e Processos Industriais',
    perfilConclusao: 'Opera torno mecânico para usinagem de peças conforme desenho técnico.',
  },

  // ── Cursos livres / treinamentos ──
  { nome: 'Acionamento Eletrônico de Máquinas Elétricas', nivel: 'curso_livre', cargaHoraria: 40, grau: 'livre', modalidade: 'ead' },
  { nome: 'Administração da Manutenção', nivel: 'curso_livre', cargaHoraria: 60, grau: 'livre', modalidade: 'ead' },
  { nome: 'Alinhamento de Equipamento Rotativo', nivel: 'curso_livre', cargaHoraria: 30, grau: 'livre', modalidade: 'ead' },
  { nome: 'Análise Termográfica', nivel: 'curso_livre', cargaHoraria: 16, grau: 'livre', modalidade: 'ead' },
  { nome: 'AutoCAD 2D para Mecânica', nivel: 'curso_livre', cargaHoraria: 60, grau: 'livre', modalidade: 'ead' },
  { nome: 'CIPA', nivel: 'curso_livre', cargaHoraria: 20, grau: 'livre', modalidade: 'ead' },
  { nome: 'CIPATRS', nivel: 'curso_livre', cargaHoraria: 20, grau: 'livre', modalidade: 'ead' },
  { nome: 'Controladores Lógicos Programáveis', nivel: 'curso_livre', cargaHoraria: 60, grau: 'livre', modalidade: 'ead' },
  { nome: 'Elaboração de Laudos para Instalações Elétricas', nivel: 'curso_livre', cargaHoraria: 24, grau: 'livre', modalidade: 'ead' },
  { nome: 'NR 06 — Equipamentos de Proteção Individual e Coletiva', nivel: 'curso_livre', cargaHoraria: 8, grau: 'livre', modalidade: 'ead' },
  { nome: 'NR 10 — Trabalho com Eletricidade', nivel: 'curso_livre', cargaHoraria: 8, grau: 'livre', modalidade: 'ead' },
  { nome: 'NR 11 — Transporte e Armazenamento de Materiais', nivel: 'curso_livre', cargaHoraria: 8, grau: 'livre', modalidade: 'ead' },
]

async function main() {
  const unit = await prisma.educationalUnit.findFirst({ orderBy: { id: 'asc' }, select: { id: true, nome: true } })
  if (!unit) throw new Error('Nenhuma unidade educacional cadastrada — crie a unidade antes.')
  console.log(`Unidade: #${unit.id} ${unit.nome}\n`)

  console.log('── Níveis de ensino ──')
  const nivelIds = new Map<string, number>()
  for (const n of NIVEIS) {
    // Busca por código E por nome: níveis criados antes (ex.: "Técnico", sem
    // código) precisam ser reaproveitados, não duplicados.
    const existe = await prisma.educationalLevel.findFirst({
      where: { OR: [{ codigo: n.codigo }, { nome: n.nome }] },
      select: { id: true, codigo: true },
    })
    if (existe) {
      const row = await prisma.educationalLevel.update({
        where: { id: existe.id },
        data: { nome: n.nome, ordem: n.ordem, descricao: n.descricao, ...(existe.codigo ? {} : { codigo: n.codigo }) },
      })
      nivelIds.set(n.codigo, row.id)
      console.log(`  #${row.id} ${n.nome} (atualizado)`)
    } else {
      const row = await prisma.educationalLevel.create({
        data: { codigo: n.codigo, nome: n.nome, ordem: n.ordem, descricao: n.descricao, active: true },
      })
      nivelIds.set(n.codigo, row.id)
      console.log(`  #${row.id} ${n.nome} (criado)`)
    }
  }

  // O nível "Especialização" do seed anterior era ambíguo: não dizia se era a
  // técnica (nível médio) ou a lato sensu. Com os dois níveis corretos criados,
  // ele só confundiria a secretaria na hora de cadastrar o curso.
  const ambiguo = await prisma.educationalLevel.findFirst({
    where: { nome: 'Especialização', codigo: 'especializacao' },
    select: { id: true, _count: { select: { courses: true, offerings: true, selectionProcesses: true } } },
  })
  if (ambiguo) {
    const usos = ambiguo._count.courses + ambiguo._count.offerings + ambiguo._count.selectionProcesses
    if (usos === 0) {
      await prisma.educationalLevel.delete({ where: { id: ambiguo.id } })
      console.log(`  #${ambiguo.id} "Especialização" (ambíguo, 0 usos) removido`)
    } else {
      await prisma.educationalLevel.update({ where: { id: ambiguo.id }, data: { active: false } })
      console.log(`  #${ambiguo.id} "Especialização" tem ${usos} uso(s) — inativado em vez de removido`)
    }
  }

  console.log('\n── Cursos ──')
  let criados = 0
  let atualizados = 0
  for (const c of CURSOS) {
    const levelId = nivelIds.get(c.nivel)!
    const dados = {
      levelId, cargaHoraria: c.cargaHoraria, grau: c.grau, modalidade: c.modalidade,
      duracaoMeses: c.duracaoMeses ?? null,
      eixoTecnologico: c.eixoTecnologico ?? null,
      codigoCnct: c.codigoCnct ?? null,
      certificacaoIntermediaria: c.certificacaoIntermediaria ?? false,
      perfilConclusao: c.perfilConclusao ?? null,
      descricao: c.descricao ?? null,
    }
    const existe = await prisma.course.findFirst({ where: { nome: c.nome, unitId: unit.id }, select: { id: true } })
    if (existe) {
      await prisma.course.update({ where: { id: existe.id }, data: dados })
      atualizados++
      console.log(`  ~ #${existe.id} ${c.nome} — ${c.cargaHoraria}h`)
    } else {
      const row = await prisma.course.create({ data: { unitId: unit.id, nome: c.nome, active: true, ...dados } })
      criados++
      console.log(`  + #${row.id} ${c.nome} — ${c.cargaHoraria}h`)
    }
  }

  console.log(`\n${criados} criado(s), ${atualizados} atualizado(s), ${CURSOS.length} no catálogo.`)

  // Resumo por nível: é a leitura que diz se a classificação regulatória saiu
  // como esperado.
  console.log('\n── Resumo por nível ──')
  for (const n of NIVEIS) {
    const id = nivelIds.get(n.codigo)!
    const qtd = await prisma.course.count({ where: { levelId: id, unitId: unit.id } })
    const soma = await prisma.course.aggregate({ where: { levelId: id, unitId: unit.id }, _sum: { cargaHoraria: true } })
    console.log(`  ${n.nome.padEnd(34)} ${String(qtd).padStart(2)} curso(s) · ${soma._sum.cargaHoraria ?? 0}h`)
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
