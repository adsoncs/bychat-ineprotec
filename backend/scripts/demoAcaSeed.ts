// scripts/demoAcaSeed.ts
// Carga de DEMONSTRAÇÃO do módulo acadêmico — isolada e 100% removível.
// Marcadores: turma com nome 'DEMO — …', alunos com RA 'DEMO####', leads source='demo_aca'.
// Remover com: scripts/demoAcaTeardown.ts
//
// Cobre: alunos (vários status), turma, matriz/diários, aulas+frequência variada,
// avaliações+notas, fechamento (resultados mistos), financeiro (pagas/vencidas/abertas).

import { prisma } from '../src/lib/prisma.js'
import { gerarContratoEParcelas } from '../src/services/acaFinanceiro.js'

const TURMA_TAG = 'DEMO — '

const NOMES = [
  'Ana Beatriz Moraes', 'Bruno Carvalho Lima', 'Carla Souza Andrade', 'Diego Ferreira Nunes',
  'Eduarda Ribeiro Pinto', 'Felipe Augusto Rocha', 'Gabriela Martins Dias', 'Henrique Oliveira Sá',
  'Isabela Cardoso Melo', 'João Pedro Tavares',
]
// perfil pedagógico por aluno (média-alvo / faltas-alvo em aulas)
//  bom | mediano | recuperacao | reprovado_nota | reprovado_freq
const PERFIL = ['bom', 'bom', 'mediano', 'mediano', 'recuperacao', 'bom', 'mediano', 'reprovado_nota', 'reprovado_freq', 'bom']
// status de matrícula por aluno
// índice 5 = lista de espera; índice 8 (perfil reprovado_freq) fica ATIVO p/ aparecer
// no fechamento; índice 9 = trancado (evasão).
const STATUS: Array<{ status: string; lista?: boolean }> = [
  { status: 'MATRICULADO' }, { status: 'MATRICULADO' }, { status: 'MATRICULADO' }, { status: 'MATRICULADO' },
  { status: 'MATRICULADO' }, { status: 'MATRICULADO', lista: true }, { status: 'MATRICULADO' }, { status: 'MATRICULADO' },
  { status: 'MATRICULADO' }, { status: 'TRANCADO' },
]

function notasDoPerfil(perfil: string): { p1: number; p2: number; trab: number } {
  switch (perfil) {
    case 'bom': return { p1: 8.5, p2: 9, trab: 9.5 }
    case 'mediano': return { p1: 6.5, p2: 7, trab: 8 }
    case 'recuperacao': return { p1: 4.5, p2: 5, trab: 6 } // média ~5 → recuperação
    case 'reprovado_nota': return { p1: 2.5, p2: 3, trab: 4 } // média ~3 → reprovado nota
    case 'reprovado_freq': return { p1: 8, p2: 8, trab: 8 } // nota boa, mas reprovado por falta
    default: return { p1: 7, p2: 7, trab: 7 }
  }
}
function faltasDoPerfil(perfil: string): number { // nº de aulas faltadas (de 8 aulas × 2 = 16h)
  if (perfil === 'reprovado_freq') return 4 // 8h faltas → 50%
  if (perfil === 'recuperacao') return 1
  if (perfil === 'reprovado_nota') return 2
  return 0
}

async function main() {
  // pilar: turma piloto (origem da oferta/período/matriz)
  const piloto = await prisma.acaTurma.findFirst({ orderBy: { id: 'asc' }, select: { courseOfferingId: true, periodoLetivoId: true, matrizId: true } })
  if (!piloto) throw new Error('Nenhuma turma piloto encontrada — rode a configuração inicial do curso antes.')
  if (!piloto.courseOfferingId) throw new Error('Turma piloto sem oferta vinculada (necessária p/ financeiro).')

  const professor = await prisma.user.findFirst({ select: { id: true, name: true }, orderBy: { id: 'asc' } })

  // turma demo
  const turma = await prisma.acaTurma.create({ data: {
    nome: `${TURMA_TAG}Téc. Agrimensura (Demonstração)`, courseOfferingId: piloto.courseOfferingId,
    periodoLetivoId: piloto.periodoLetivoId, matrizId: piloto.matrizId, faseAtual: 1, capacidade: 40, ativo: true,
  } })
  console.log(`✓ turma demo #${turma.id}`)

  // disciplinas da matriz (4 primeiras) → diários
  const componentes = piloto.matrizId
    ? await prisma.acaComponente.findMany({ where: { matrizId: piloto.matrizId }, orderBy: [{ fase: 'asc' }, { id: 'asc' }], take: 4, select: { disciplinaId: true } })
    : []
  const diarios = []
  for (const c of componentes) {
    const dia = await prisma.acaDiario.create({ data: { turmaId: turma.id, disciplinaId: c.disciplinaId, professorUserId: professor?.id ?? null } })
    // 8 aulas (2h cada)
    const aulas = []
    for (let i = 0; i < 8; i++) {
      const dt = new Date(2026, 1, 3 + i * 7) // toda semana a partir de 03/02/2026
      aulas.push(await prisma.acaAula.create({ data: { diarioId: dia.id, data: dt, conteudo: `Aula ${i + 1}`, quantidadeAulas: 2 } }))
    }
    // avaliações
    const av1 = await prisma.acaAvaliacao.create({ data: { diarioId: dia.id, nome: 'Prova 1', peso: 2, valorMaximo: 10, ordem: 1 } })
    const av2 = await prisma.acaAvaliacao.create({ data: { diarioId: dia.id, nome: 'Prova 2', peso: 2, valorMaximo: 10, ordem: 2 } })
    const avt = await prisma.acaAvaliacao.create({ data: { diarioId: dia.id, nome: 'Trabalho', peso: 1, valorMaximo: 10, ordem: 3 } })
    diarios.push({ dia, aulas, av1, av2, avt })
  }
  console.log(`✓ ${diarios.length} diário(s) com aulas e avaliações`)

  // plano de ensino + materiais (O2.7) no 1º diário
  if (diarios.length) {
    const d0 = diarios[0].dia
    await prisma.acaPlanoEnsino.upsert({ where: { diarioId: d0.id }, update: {}, create: { diarioId: d0.id, ementa: 'Fundamentos de desenho técnico aplicado à agrimensura.', conteudo: 'Normas ABNT; projeções ortogonais; escalas; cotagem.' } })
    if ((await prisma.acaMaterial.count({ where: { diarioId: d0.id } })) === 0) {
      await prisma.acaMaterial.create({ data: { diarioId: d0.id, titulo: 'Apostila de Desenho Técnico (PDF)', url: 'https://exemplo.test/apostila.pdf', tipo: 'LINK' } })
      await prisma.acaMaterial.create({ data: { diarioId: d0.id, titulo: 'Vídeo-aula: introdução', url: 'https://exemplo.test/video', tipo: 'VIDEO' } })
    }
  }

  // alunos + matrículas
  const matsAtivas: number[] = []
  const matsParaResultado: Array<{ matId: number; perfil: string }> = []
  for (let i = 0; i < NOMES.length; i++) {
    const nome = NOMES[i]
    const primeiro = nome.split(' ')[0].toLowerCase()
    const lead = await prisma.lead.create({ data: {
      empresa: 'DEMO', nome, whatsapp: `5562${String(900000000 + i).slice(0, 9)}`, email: `${primeiro}.demo@exemplo.test`,
      source: 'demo_aca', formData: {}, scores: {},
    } })
    const ra = `DEMO${String(i + 1).padStart(4, '0')}`
    const aluno = await prisma.aluno.create({ data: { leadId: lead.id, ra, cpf: `000.000.${String(100 + i)}-0${i % 10}`, dataNascimento: new Date(2000, i % 12, (i % 27) + 1) } })
    const st = STATUS[i]
    const mat = await prisma.acaMatricula.create({ data: { alunoId: aluno.id, turmaId: turma.id, status: st.status as any, listaEspera: !!st.lista, courseOfferingId: piloto.courseOfferingId } })
    if (st.status === 'MATRICULADO' && !st.lista) {
      matsAtivas.push(mat.id)
      matsParaResultado.push({ matId: mat.id, perfil: PERFIL[i] })
    }
  }
  console.log(`✓ ${NOMES.length} alunos (ativos: ${matsAtivas.length})`)

  // frequência + notas + resultados por diário, só p/ alunos ativos
  for (const { dia, aulas, av1, av2, avt } of diarios) {
    for (const { matId, perfil } of matsParaResultado) {
      // frequência: marca presença, faltando as N primeiras aulas conforme perfil
      const faltar = faltasDoPerfil(perfil)
      for (let a = 0; a < aulas.length; a++) {
        await prisma.acaFrequencia.create({ data: { aulaId: aulas[a].id, matriculaId: matId, presente: a >= faltar } })
      }
      // notas
      const { p1, p2, trab } = notasDoPerfil(perfil)
      await prisma.acaNota.create({ data: { avaliacaoId: av1.id, matriculaId: matId, valor: p1 } })
      await prisma.acaNota.create({ data: { avaliacaoId: av2.id, matriculaId: matId, valor: p2 } })
      await prisma.acaNota.create({ data: { avaliacaoId: avt.id, matriculaId: matId, valor: trab } })
    }
  }
  console.log('✓ frequência e notas lançadas')

  // FECHA os 2 primeiros diários (gera AcaResultado com situações mistas)
  const totalAulasRelogio = 8 * 2 // 16
  for (const { dia, av1, av2, avt } of diarios.slice(0, 2)) {
    for (const { matId, perfil } of matsParaResultado) {
      const { p1, p2, trab } = notasDoPerfil(perfil)
      const media = Math.round(((p1 * 2 + p2 * 2 + trab * 1) / 5) * 10) / 10
      const faltasRelogio = faltasDoPerfil(perfil) * 2
      const freqPct = Math.round(((totalAulasRelogio - faltasRelogio) / totalAulasRelogio) * 100)
      const situacao = freqPct < 75 ? 'REPROVADO_FREQUENCIA' : media >= 6 ? 'APROVADO' : media >= 4 ? 'RECUPERACAO' : 'REPROVADO_NOTA'
      await prisma.acaResultado.create({ data: { diarioId: dia.id, matriculaId: matId, mediaFinal: media, frequenciaPct: freqPct, situacao, fechadoEm: new Date() } })
    }
  }
  console.log('✓ 2 diários fechados (resultados)')

  // FINANCEIRO: gera contrato+parcelas e marca pagas/vencidas/abertas
  let pagas = 0, vencidas = 0
  for (let idx = 0; idx < matsAtivas.length; idx++) {
    const matId = matsAtivas[idx]
    await gerarContratoEParcelas(matId).catch((e) => console.warn('  fin skip:', e?.message))
    const contrato = await prisma.acaContrato.findUnique({ where: { matriculaId: matId }, select: { id: true } })
    if (!contrato) continue
    const parcelas = await prisma.acaParcela.findMany({ where: { contratoId: contrato.id }, orderBy: { nroParcela: 'asc' } })
    // matrícula (1ª) + 2 mensalidades pagas
    for (let p = 0; p < Math.min(3, parcelas.length); p++) {
      await prisma.acaParcela.update({ where: { id: parcelas[p].id }, data: { situacao: 'PAGA', valorPagoCentavos: parcelas[p].valorBrutoCentavos, pagoEm: new Date(2026, 1 + p, 8) } })
      pagas++
    }
    // 1-2 alunos com parcela vencida (inadimplência)
    if (idx % 3 === 0 && parcelas.length > 3) {
      await prisma.acaParcela.update({ where: { id: parcelas[3].id }, data: { situacao: 'VENCIDA', dataVencimento: new Date(2026, 4, 10) } })
      vencidas++
    }
  }
  console.log(`✓ financeiro: ${matsAtivas.length} contratos · ${pagas} parcelas pagas · ${vencidas} vencidas`)

  // requerimentos de exemplo (O2.2) — usa os alunos ativos
  const tipos = await prisma.acaRequerimentoTipo.findMany({ where: { ativo: true }, orderBy: { ordem: 'asc' } })
  if (tipos.length && matsParaResultado.length >= 3) {
    const alunosReq = await prisma.acaMatricula.findMany({ where: { id: { in: matsParaResultado.slice(0, 3).map((m) => m.matId) } }, select: { alunoId: true } })
    const exemplos = [
      { tipo: tipos[0], assunto: 'Declaração para estágio', status: 'ABERTO' },
      { tipo: tipos.find((t) => t.nome.includes('Revisão')) || tipos[3], assunto: 'Revisão da nota de Desenho Técnico', status: 'EM_ANALISE' },
      { tipo: tipos.find((t) => t.nome.includes('Histórico')) || tipos[2], assunto: 'Histórico para transferência', status: 'DEFERIDO' },
    ]
    const ano = new Date().getFullYear()
    let seq = (await prisma.acaRequerimento.count({ where: { protocolo: { startsWith: `REQ-${ano}-` } } }))
    for (let i = 0; i < exemplos.length && i < alunosReq.length; i++) {
      const e = exemplos[i]
      seq++
      await prisma.acaRequerimento.create({ data: {
        protocolo: `REQ-${ano}-${String(seq).padStart(4, '0')}`, alunoId: alunosReq[i].alunoId, tipoId: e.tipo.id, tipoNome: e.tipo.nome,
        assunto: e.assunto, status: e.status, prazoEm: new Date(Date.now() + e.tipo.slaDias * 86400_000),
        resposta: e.status === 'DEFERIDO' ? 'Documento disponível no portal.' : null,
        respondidoEm: e.status === 'DEFERIDO' ? new Date() : null,
      } })
    }
    console.log('✓ 3 requerimentos de exemplo')

    // estágio + atividades (O2.9) no 1º aluno ativo
    const a0 = alunosReq[0].alunoId
    if ((await prisma.acaEstagio.count({ where: { alunoId: a0 } })) === 0) {
      await prisma.acaEstagio.create({ data: { alunoId: a0, empresa: 'Topografia XYZ Ltda', supervisor: 'Eng. Marcos Lima', cargaHorariaH: 200, status: 'CONCLUIDO' } })
      await prisma.acaAtividadeComplementar.create({ data: { alunoId: a0, titulo: 'Semana de Agrimensura', horas: 40, status: 'APROVADA' } })
      await prisma.acaAtividadeComplementar.create({ data: { alunoId: a0, titulo: 'Palestra: GPS Geodésico', horas: 8, status: 'PENDENTE' } })
      console.log('✓ estágio + atividades de exemplo')
    }
  }

  // eventos de calendário (O2.5) — idempotente por título
  const evs = [
    { titulo: 'Início das aulas', tipo: 'EVENTO', dias: 2 },
    { titulo: 'Prova 1 — Desenho Técnico', tipo: 'PROVA', dias: 20, periodoLetivoId: piloto.periodoLetivoId },
    { titulo: 'Recesso', tipo: 'RECESSO', dias: 45 },
  ]
  for (const e of evs) {
    const ex = await prisma.acaEvento.findFirst({ where: { titulo: e.titulo } })
    if (ex) continue
    await prisma.acaEvento.create({ data: { titulo: e.titulo, tipo: e.tipo, dataInicio: new Date(Date.now() + e.dias * 86400_000), periodoLetivoId: (e as any).periodoLetivoId ?? null } })
  }
  console.log('✓ eventos de calendário')

  // grade de horários (O2.6) — 1ª e 2ª disciplina, Seg/Qua noite
  if (componentes.length >= 2 && professor) {
    const ex = await prisma.acaHorario.count({ where: { turmaId: turma.id } })
    if (ex === 0) {
      await prisma.acaHorario.create({ data: { turmaId: turma.id, disciplinaId: componentes[0].disciplinaId, professorUserId: professor.id, sala: 'A1', diaSemana: 1, horaInicio: '19:00', horaFim: '20:40' } })
      await prisma.acaHorario.create({ data: { turmaId: turma.id, disciplinaId: componentes[1].disciplinaId, professorUserId: professor.id, sala: 'A1', diaSemana: 3, horaInicio: '19:00', horaFim: '20:40' } })
      console.log('✓ grade de horários')
    }
  }

  console.log('\n✅ Carga de demonstração concluída.')
  console.log(`   Turma: ${TURMA_TAG}… (#${turma.id})  |  Alunos: ${NOMES.length} (RA DEMO0001–DEMO00${NOMES.length})`)
  console.log('   Para remover: JWT_SECRET=x npx tsx scripts/demoAcaTeardown.ts')
}

main().then(() => prisma.$disconnect()).catch((e) => { console.error('ERRO:', e); prisma.$disconnect(); process.exit(1) })
