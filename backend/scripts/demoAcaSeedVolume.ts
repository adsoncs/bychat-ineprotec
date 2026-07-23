// scripts/demoAcaSeedVolume.ts
// Terceira camada da demo acadêmica: dá VOLUME às telas que ficavam com 1–2
// registros (listas magras não deixam o cliente ver filtros/variedade de status).
// Complementa demoAcaSeed (base) + demoAcaSeedPlus (módulos novos) +
// demoAcaSeedFull (telas vazias).
//
// Rodar:  JWT_SECRET=x npx tsx scripts/demoAcaSeedVolume.ts
// Limpar: faz parte do demoAcaTeardown.ts (chama cleanupVolume()).
//
// Marcadores de remoção: users de docente com e-mail @demo.local, e todo o
// restante ligado aos alunos/turma/diários DEMO da carga base.

import { prisma } from '../src/lib/prisma.js'

const log = (m: string) => console.log('  ' + m)
const DOC_MAIL = '@demo.local' // marcador dos usuários-docente da demo
// hash bcrypt de uma senha aleatória — contas de demonstração não fazem login.
const DUMMY_HASH = '$2b$10$abcdefghijklmnopqrstuvREPLACEDdemoOnlyHashXXXXXXXXXXXX'

async function refs() {
  const alunos = await prisma.aluno.findMany({ where: { ra: { startsWith: 'DEMO' } }, select: { id: true }, orderBy: { id: 'asc' } })
  const alunoIds = alunos.map((a) => a.id)
  const turma = await prisma.acaTurma.findFirst({ where: { nome: { startsWith: 'DEMO — ' } }, select: { id: true } })
  const matriculas = await prisma.acaMatricula.findMany({ where: { alunoId: { in: alunoIds } }, select: { id: true, alunoId: true, status: true }, orderBy: { id: 'asc' } })
  const diarios = turma ? await prisma.acaDiario.findMany({ where: { turmaId: turma.id }, select: { id: true }, orderBy: { id: 'asc' } }) : []
  const periodo = await prisma.acaPeriodoLetivo.findFirst({ select: { id: true } })
  const offering = await prisma.courseOffering.findFirst({ select: { id: true } })
  return { alunoIds, turma, matriculas, diarios, periodo, offering }
}

/** Remove tudo que este seed cria. */
export async function cleanupVolume() {
  const { alunoIds, turma, matriculas, diarios } = await refs()
  const matIds = matriculas.map((m) => m.id)
  const diarioIds = diarios.map((d) => d.id)

  if (alunoIds.length) {
    await prisma.acaResponsavel.deleteMany({ where: { alunoId: { in: alunoIds } } }).catch(() => {})
    await prisma.acaTcc.deleteMany({ where: { alunoId: { in: alunoIds } } }).catch(() => {})
    await prisma.acaEstagio.deleteMany({ where: { alunoId: { in: alunoIds } } }).catch(() => {})
    await prisma.acaAtividadeComplementar.deleteMany({ where: { alunoId: { in: alunoIds } } }).catch(() => {})
    await prisma.acaGedArquivo.deleteMany({ where: { alunoId: { in: alunoIds } } }).catch(() => {})
  }
  if (matIds.length) await prisma.acaMovimentacao.deleteMany({ where: { matriculaId: { in: matIds } } }).catch(() => {})
  if (diarioIds.length) {
    await prisma.acaMaterial.deleteMany({ where: { diarioId: { in: diarioIds } } }).catch(() => {})
    await prisma.acaPlanoEnsino.deleteMany({ where: { diarioId: { in: diarioIds } } }).catch(() => {})
  }
  // Calendário / espaços / financeiro — marcados pelo prefixo DEMO no nome.
  await prisma.acaFeriado.deleteMany({ where: { nome: { startsWith: 'DEMO ' } } }).catch(() => {})
  if (turma) await prisma.acaEvento.deleteMany({ where: { turmaId: turma.id } }).catch(() => {})
  await prisma.acaEvento.deleteMany({ where: { titulo: { startsWith: 'DEMO ' } } }).catch(() => {})
  await prisma.acaReserva.deleteMany({ where: { finalidade: { startsWith: 'DEMO' } } }).catch(() => {})
  await prisma.acaEquipamento.deleteMany({ where: { nome: { startsWith: 'DEMO ' } } }).catch(() => {})
  await prisma.acaAmbiente.deleteMany({ where: { nome: { startsWith: 'DEMO ' } } }).catch(() => {})
  await prisma.acaTipoAmbiente.deleteMany({ where: { nome: { startsWith: 'DEMO ' } } }).catch(() => {})
  await prisma.acaTipoEquipamento.deleteMany({ where: { nome: { startsWith: 'DEMO ' } } }).catch(() => {})
  await prisma.acaPlanoPagamento.deleteMany({ where: { nome: { startsWith: 'DEMO ' } } }).catch(() => {})
  await prisma.acaContaFinanceira.deleteMany({ where: { codigo: { startsWith: 'D.' } } }).catch(() => {})
  // ── Parte 2 ──
  // CPA (dimensões/perguntas caem por cascade da avaliação).
  await prisma.acaAvaliacaoInst.deleteMany({ where: { nome: { startsWith: 'DEMO ' } } }).catch(() => {})
  if (matIds.length) {
    await prisma.acaAproveitamento.deleteMany({ where: { matriculaId: { in: matIds } } }).catch(() => {})
    await prisma.acaDependencia.deleteMany({ where: { matriculaId: { in: matIds } } }).catch(() => {})
    // EAD notas/acessos e diplomas desta camada (os da base usam codigoValidacao próprio).
    await prisma.acaEadNota.deleteMany({ where: { matriculaId: { in: matIds } } }).catch(() => {})
    await prisma.acaEadAcesso.deleteMany({ where: { matriculaId: { in: matIds } } }).catch(() => {})
    await prisma.acaDiploma.deleteMany({ where: { codigoValidacao: { startsWith: 'DEMOVAL-' } } }).catch(() => {})
  }
  await prisma.acaEquivalencia.deleteMany({ where: { observacao: { startsWith: 'Equivalência reconhecida' } } }).catch(() => {})
  if (turma) await prisma.acaHorario.deleteMany({ where: { turmaId: turma.id } }).catch(() => {})
  await prisma.acaRequerimentoCategoria.deleteMany({ where: { nome: { startsWith: 'DEMO ' } } }).catch(() => {})
  await prisma.acaMotivoCancelamento.deleteMany({ where: { nome: { startsWith: 'DEMO ' } } }).catch(() => {})
  // Banco: remessas → cobranças → contas (ordem por dependência lógica).
  const contasB = await prisma.acaContaBancaria.findMany({ where: { nome: { startsWith: 'DEMO ' } }, select: { id: true } })
  if (contasB.length) await prisma.acaRemessa.deleteMany({ where: { contaBancariaId: { in: contasB.map((c) => c.id) } } }).catch(() => {})
  if (alunoIds.length) await prisma.acaCobrancaRecorrente.deleteMany({ where: { alunoId: { in: alunoIds } } }).catch(() => {})
  await prisma.acaContaBancaria.deleteMany({ where: { nome: { startsWith: 'DEMO ' } } }).catch(() => {})
  // Acesso: logs → pontos.
  const pontosD = await prisma.acaPontoAcesso.findMany({ where: { nome: { startsWith: 'DEMO ' } }, select: { id: true } })
  if (pontosD.length) await prisma.acaAcessoLog.deleteMany({ where: { pontoId: { in: pontosD.map((p) => p.id) } } }).catch(() => {})
  await prisma.acaPontoAcesso.deleteMany({ where: { nome: { startsWith: 'DEMO ' } } }).catch(() => {})

  // Docentes demo + seus usuários (atividades caem por cascade do docente).
  const users = await prisma.user.findMany({ where: { email: { endsWith: DOC_MAIL } }, select: { id: true } })
  const userIds = users.map((u) => u.id)
  if (userIds.length) {
    await prisma.acaDocente.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {})
    await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => {})
  }
  await prisma.acaTipoAtividadeDocente.deleteMany({ where: { nome: { startsWith: 'DEMO ' } } }).catch(() => {})
}

async function main() {
  console.log('DEMO-Volume acadêmico — engrossando listas magras…')
  await cleanupVolume()
  const { alunoIds, turma, matriculas, diarios, periodo, offering } = await refs()
  if (!alunoIds.length || !turma) { console.error('Base demo ausente — rode demoAcaSeed/Plus/Full antes.'); return }

  // ── Docentes (corpo docente completo) ──
  const profs = [
    { nome: 'Prof. Ricardo Almeida Souza', tit: 'Doutor', reg: 'INTEGRAL' as const, hora: 9000, orient: true },
    { nome: 'Profa. Helena Martins Costa', tit: 'Mestre', reg: 'PARCIAL' as const, hora: 7500, orient: true },
    { nome: 'Prof. Marcos Vinícius Prado', tit: 'Especialista', reg: 'HORISTA' as const, hora: 6000, orient: false },
    { nome: 'Profa. Juliana Reis Barbosa', tit: 'Mestre', reg: 'INTEGRAL' as const, hora: 8200, orient: true },
    { nome: 'Prof. Anderson Luiz Ferraz', tit: 'Especialista', reg: 'HORISTA' as const, hora: 5800, orient: false },
    { nome: 'Profa. Patrícia Nogueira Lima', tit: 'Doutor', reg: 'PARCIAL' as const, hora: 8800, orient: true },
  ]
  for (let i = 0; i < profs.length; i++) {
    const p = profs[i]
    const u = await prisma.user.create({
      data: { name: p.nome, email: `docente${i + 1}${DOC_MAIL}`, passwordHash: DUMMY_HASH, role: 'VIEWER', active: true },
    })
    await prisma.acaDocente.create({
      data: {
        userId: u.id, titulacao: p.tit, regime: p.reg, valorHoraCentavos: p.hora, ativo: true, orientador: p.orient,
        observacao: 'Docente de demonstração.',
        dadosJson: { departamento: 'Ciências Agrárias e Exatas', tipo: 'CLT', qualificacao: p.tit },
      },
    })
  }
  log(`docentes: ${profs.length}`)

  // ── Responsáveis (1–2 por aluno) ──
  const parentescos = ['Mãe', 'Pai', 'Avó', 'Tio', 'Responsável legal']
  let resp = 0
  for (let i = 0; i < alunoIds.length; i++) {
    await prisma.acaResponsavel.create({
      data: {
        alunoId: alunoIds[i], nome: `Responsável ${i + 1} (Demo)`, cpf: `000.000.000-${String(i).padStart(2, '0')}`,
        parentesco: parentescos[i % parentescos.length], tipo: i % 3 === 0 ? 'FINANCEIRO' : i % 3 === 1 ? 'PEDAGOGICO' : 'LEGAL',
        telefone: `(18) 99${String(100000 + i).slice(-6)}`, email: `responsavel${i + 1}.demo@exemplo.com`, ativo: true,
      },
    })
    resp++
    if (i % 3 === 0) {
      await prisma.acaResponsavel.create({
        data: {
          alunoId: alunoIds[i], nome: `Segundo responsável ${i + 1} (Demo)`, parentesco: 'Pai',
          tipo: 'FAMILIAR', telefone: `(18) 98${String(200000 + i).slice(-6)}`, ativo: true,
        },
      })
      resp++
    }
  }
  log(`responsáveis: ${resp}`)

  // ── Movimentações acadêmicas (todos os tipos) ──
  const movs: Array<{ tipo: any; de: string; para: string; motivo: string; extra?: any }> = [
    { tipo: 'TRANCAMENTO', de: 'MATRICULADO', para: 'TRANCADO', motivo: 'Trancamento a pedido — motivos pessoais.' },
    { tipo: 'REINGRESSO', de: 'TRANCADO', para: 'MATRICULADO', motivo: 'Reingresso após trancamento.' },
    { tipo: 'TRANSFERENCIA_EXTERNA', de: 'MATRICULADO', para: 'TRANSFERIDO', motivo: 'Mudança de cidade.', extra: { instituicaoDestino: 'ETEC Presidente Prudente' } },
    { tipo: 'AFASTAMENTO', de: 'MATRICULADO', para: 'AFASTADO', motivo: 'Afastamento por licença médica.' },
    { tipo: 'REMANEJAMENTO', de: 'MATRICULADO', para: 'MATRICULADO', motivo: 'Remanejamento de turno (noturno → matutino).' },
    { tipo: 'EVASAO', de: 'MATRICULADO', para: 'EVADIDO', motivo: 'Sem frequência há mais de 60 dias.' },
    { tipo: 'CANCELAMENTO', de: 'MATRICULADO', para: 'CANCELADO', motivo: 'Cancelamento por inadimplência.' },
    { tipo: 'RECLASSIFICACAO', de: 'MATRICULADO', para: 'MATRICULADO', motivo: 'Reclassificação por aproveitamento de estudos.' },
  ]
  for (let i = 0; i < movs.length; i++) {
    const m = matriculas[i % matriculas.length]
    await prisma.acaMovimentacao.create({
      data: {
        matriculaId: m.id, alunoId: m.alunoId, tipo: movs[i].tipo, statusDe: movs[i].de, statusPara: movs[i].para,
        motivo: movs[i].motivo, protocolo: `MOV-2026-${String(i + 1).padStart(4, '0')}`,
        dataEfeito: new Date(2026, 2 + (i % 6), 5 + i),
        dataRetornoPrevista: movs[i].tipo === 'TRANCAMENTO' || movs[i].tipo === 'AFASTAMENTO' ? new Date(2026, 8, 1) : null,
        ...(movs[i].extra || {}),
      },
    })
  }
  log(`movimentações: ${movs.length}`)

  // ── Calendário: feriados + eventos ──
  const feriados = [
    ['2026-01-01', 'Confraternização Universal'], ['2026-02-16', 'Carnaval'], ['2026-02-17', 'Carnaval'],
    ['2026-04-03', 'Sexta-feira Santa'], ['2026-04-21', 'Tiradentes'], ['2026-05-01', 'Dia do Trabalho'],
    ['2026-06-04', 'Corpus Christi'], ['2026-09-07', 'Independência'], ['2026-10-12', 'Nossa Senhora Aparecida'],
    ['2026-11-02', 'Finados'], ['2026-11-15', 'Proclamação da República'], ['2026-12-25', 'Natal'],
  ]
  let fer = 0
  for (const [d, n] of feriados) {
    await prisma.acaFeriado.create({ data: { data: new Date(d + 'T00:00:00'), nome: `DEMO ${n}` } }).then(() => { fer++ }).catch(() => {})
  }
  log(`feriados: ${fer}`)

  const eventos = [
    { tipo: 'MATRICULA', titulo: 'Período de matrículas 2026/2', ini: '2026-07-01', fim: '2026-07-20', cor: '#1a73e8' },
    { tipo: 'PROVA', titulo: 'Semana de avaliações — 1º bimestre', ini: '2026-04-13', fim: '2026-04-17', cor: '#ea4335' },
    { tipo: 'PROVA', titulo: 'Semana de avaliações — 2º bimestre', ini: '2026-06-15', fim: '2026-06-19', cor: '#ea4335' },
    { tipo: 'REUNIAO', titulo: 'Reunião de pais e responsáveis', ini: '2026-08-15', cor: '#f9ab00' },
    { tipo: 'REUNIAO', titulo: 'Conselho de classe — 1º semestre', ini: '2026-07-08', cor: '#f9ab00' },
    { tipo: 'EVENTO', titulo: 'Semana de Tecnologia e Inovação', ini: '2026-09-14', fim: '2026-09-18', cor: '#2e7d32' },
    { tipo: 'EVENTO', titulo: 'Feira de Profissões', ini: '2026-05-22', cor: '#2e7d32' },
    { tipo: 'EVENTO', titulo: 'Aula de campo — Topografia', ini: '2026-05-08', cor: '#2e7d32' },
    { tipo: 'RECESSO', titulo: 'Recesso escolar de julho', ini: '2026-07-21', fim: '2026-07-31', cor: '#8e24aa' },
    { tipo: 'EVENTO', titulo: 'Colação de grau', ini: '2026-12-18', cor: '#00897b' },
  ]
  for (const e of eventos) {
    await prisma.acaEvento.create({
      data: {
        periodoLetivoId: periodo?.id ?? null, turmaId: null, tipo: e.tipo, titulo: `DEMO ${e.titulo}`,
        descricao: 'Evento de demonstração do calendário acadêmico.',
        dataInicio: new Date(e.ini + 'T00:00:00'), dataFim: e.fim ? new Date(e.fim + 'T00:00:00') : null,
        diaInteiro: true, cor: e.cor,
      },
    })
  }
  log(`eventos de calendário: ${eventos.length}`)

  // ── Espaços físicos: tipos, ambientes, equipamentos, reservas ──
  const tiposAmb = ['Sala de aula', 'Laboratório', 'Auditório', 'Quadra']
  const tipoAmbIds: number[] = []
  for (const t of tiposAmb) tipoAmbIds.push((await prisma.acaTipoAmbiente.create({ data: { nome: `DEMO ${t}`, ativo: true } })).id)

  const ambientes = [
    { nome: 'Sala 101', tipo: 0, cap: 40, loc: 'Bloco A — Térreo' },
    { nome: 'Sala 102', tipo: 0, cap: 40, loc: 'Bloco A — Térreo' },
    { nome: 'Sala 201', tipo: 0, cap: 35, loc: 'Bloco A — 1º andar' },
    { nome: 'Laboratório de Informática', tipo: 1, cap: 30, loc: 'Bloco B — Térreo' },
    { nome: 'Laboratório de Topografia', tipo: 1, cap: 25, loc: 'Bloco B — 1º andar' },
    { nome: 'Auditório Central', tipo: 2, cap: 120, loc: 'Bloco C' },
    { nome: 'Quadra Poliesportiva', tipo: 3, cap: 80, loc: 'Área externa' },
  ]
  const ambIds: number[] = []
  for (const a of ambientes) {
    ambIds.push((await prisma.acaAmbiente.create({ data: { nome: `DEMO ${a.nome}`, tipoId: tipoAmbIds[a.tipo], capacidade: a.cap, localizacao: a.loc, ativo: true } })).id)
  }
  log(`ambientes: ${ambientes.length} (${tiposAmb.length} tipos)`)

  const tiposEqp = ['Projetor', 'Computador', 'Equipamento de campo']
  const tipoEqpIds: number[] = []
  for (const t of tiposEqp) tipoEqpIds.push((await prisma.acaTipoEquipamento.create({ data: { nome: `DEMO ${t}`, ativo: true } })).id)
  const equipamentos = [
    { nome: 'Projetor Epson X05', tipo: 0, amb: 0, pat: 'PAT-0001' },
    { nome: 'Projetor Epson X05', tipo: 0, amb: 5, pat: 'PAT-0002' },
    { nome: 'Estação Total Leica', tipo: 2, amb: 4, pat: 'PAT-0101' },
    { nome: 'GPS Geodésico RTK', tipo: 2, amb: 4, pat: 'PAT-0102' },
    { nome: 'Nível Óptico Automático', tipo: 2, amb: 4, pat: 'PAT-0103' },
    { nome: 'Desktop Dell OptiPlex', tipo: 1, amb: 3, pat: 'PAT-0201' },
    { nome: 'Desktop Dell OptiPlex', tipo: 1, amb: 3, pat: 'PAT-0202' },
    { nome: 'Teodolito Digital', tipo: 2, amb: 4, pat: 'PAT-0104' },
  ]
  for (const e of equipamentos) {
    await prisma.acaEquipamento.create({ data: { nome: `DEMO ${e.nome}`, tipoId: tipoEqpIds[e.tipo], ambienteId: ambIds[e.amb], patrimonio: e.pat, ativo: true } })
  }
  log(`equipamentos: ${equipamentos.length} (${tiposEqp.length} tipos)`)

  const reservas = [
    { amb: 5, d: '2026-08-15', hi: '19:00', hf: '21:00', fim: 'Reunião de pais e responsáveis', resp: 'Direção' },
    { amb: 3, d: '2026-08-12', hi: '08:00', hf: '10:00', fim: 'Aula prática de Informática', resp: 'Prof. Marcos Prado' },
    { amb: 4, d: '2026-08-12', hi: '14:00', hf: '17:00', fim: 'Prática de Topografia', resp: 'Prof. Ricardo Almeida' },
    { amb: 6, d: '2026-08-20', hi: '10:00', hf: '12:00', fim: 'Gincana interclasses', resp: 'Coordenação' },
    { amb: 0, d: '2026-08-18', hi: '19:00', hf: '22:00', fim: 'Aula de reposição — Cálculo', resp: 'Profa. Helena Costa' },
    { amb: 5, d: '2026-09-14', hi: '08:00', hf: '18:00', fim: 'Semana de Tecnologia', resp: 'Coordenação', cancel: true },
  ]
  for (const r of reservas) {
    await prisma.acaReserva.create({
      data: {
        ambienteId: ambIds[r.amb], data: new Date(r.d + 'T00:00:00'), horaInicio: r.hi, horaFim: r.hf,
        finalidade: `DEMO ${r.fim}`, responsavel: r.resp, status: (r as any).cancel ? 'CANCELADA' : 'ATIVA',
      },
    })
  }
  log(`reservas: ${reservas.length}`)

  // ── Financeiro: planos de pagamento + plano de contas ──
  if (offering) {
    const planos = [
      { nome: 'À vista (5% desconto)', n: 1, v: 332500, taxa: 0 },
      { nome: 'Semestral — 6x', n: 6, v: 58000, taxa: 15000 },
      { nome: 'Anual — 12x', n: 12, v: 35000, taxa: 15000 },
      { nome: 'Anual — 12x com bolsa parcial', n: 12, v: 24500, taxa: 10000 },
    ]
    for (const pl of planos) {
      await prisma.acaPlanoPagamento.create({
        data: { courseOfferingId: offering.id, nome: `DEMO ${pl.nome}`, numParcelas: pl.n, valorParcelaCentavos: pl.v, taxaMatriculaCentavos: pl.taxa, diaVencimento: 10, ativo: true },
      })
    }
    log(`planos de pagamento: ${planos.length}`)
  }

  const contas: Array<[string, string, 'RECEITA' | 'DESPESA']> = [
    ['D.1.1', 'Mensalidades', 'RECEITA'], ['D.1.2', 'Taxa de matrícula', 'RECEITA'],
    ['D.1.3', 'Cursos livres e extensão', 'RECEITA'], ['D.1.4', 'Taxas de secretaria', 'RECEITA'],
    ['D.1.5', 'Multas e juros', 'RECEITA'], ['D.2.1', 'Folha de pagamento — docentes', 'DESPESA'],
    ['D.2.2', 'Folha de pagamento — administrativo', 'DESPESA'], ['D.2.3', 'Aluguel e condomínio', 'DESPESA'],
    ['D.2.4', 'Energia, água e internet', 'DESPESA'], ['D.2.5', 'Material didático', 'DESPESA'],
    ['D.2.6', 'Manutenção e limpeza', 'DESPESA'], ['D.2.7', 'Marketing e captação', 'DESPESA'],
  ]
  for (const [cod, nome, tipo] of contas) {
    await prisma.acaContaFinanceira.create({ data: { codigo: cod, nome, tipo, ativo: true } }).catch(() => {})
  }
  log(`plano de contas: ${contas.length}`)

  // ── Ensino: planos de ensino + materiais ──
  const ementas = [
    { e: 'Fundamentos de topografia, planimetria e altimetria.', o: 'Capacitar o aluno a executar levantamentos topográficos.' },
    { e: 'Cálculo diferencial e integral aplicado à agrimensura.', o: 'Desenvolver raciocínio matemático aplicado.' },
    { e: 'Desenho técnico e representação gráfica com CAD.', o: 'Produzir plantas e memoriais descritivos.' },
    { e: 'Georreferenciamento e sistemas de informação geográfica.', o: 'Operar GNSS e processar dados geoespaciais.' },
    { e: 'Legislação agrária e regularização fundiária.', o: 'Interpretar a legislação aplicável ao setor.' },
  ]
  let planos = 0
  for (let i = 0; i < diarios.length; i++) {
    await prisma.acaPlanoEnsino.create({
      data: {
        diarioId: diarios[i].id, ementa: ementas[i % ementas.length].e, objetivos: ementas[i % ementas.length].o,
        conteudo: 'Unidade I — Fundamentos. Unidade II — Aplicações práticas. Unidade III — Projeto integrador.',
        metodologia: 'Aulas expositivas dialogadas, práticas de campo e laboratório, estudos de caso.',
        bibliografia: 'BORGES, A. C. Topografia aplicada à engenharia civil. 3. ed. São Paulo: Blucher.',
        criterios: 'Duas avaliações escritas (peso 3 cada), trabalho prático (peso 2) e projeto integrador (peso 2).',
      },
    }).then(() => { planos++ }).catch(() => {})
  }
  log(`planos de ensino: ${planos}`)

  const materiais = [
    { t: 'Apostila — Introdução à Topografia', tipo: 'ARQUIVO', u: 'https://exemplo.local/apostila-topografia.pdf' },
    { t: 'Vídeo-aula: uso da Estação Total', tipo: 'VIDEO', u: 'https://exemplo.local/video/estacao-total' },
    { t: 'Norma ABNT NBR 13133', tipo: 'LINK', u: 'https://exemplo.local/nbr13133' },
    { t: 'Lista de exercícios — Planimetria', tipo: 'ARQUIVO', u: 'https://exemplo.local/lista-planimetria.pdf' },
    { t: 'Tutorial AutoCAD para plantas', tipo: 'VIDEO', u: 'https://exemplo.local/video/autocad' },
    { t: 'Manual do GPS Geodésico', tipo: 'ARQUIVO', u: 'https://exemplo.local/manual-gps.pdf' },
    { t: 'Portal de Regularização Fundiária', tipo: 'LINK', u: 'https://exemplo.local/regularizacao' },
    { t: 'Slides — Georreferenciamento', tipo: 'ARQUIVO', u: 'https://exemplo.local/slides-geo.pdf' },
  ]
  for (let i = 0; i < materiais.length; i++) {
    await prisma.acaMaterial.create({
      data: { diarioId: diarios[i % diarios.length].id, titulo: materiais[i].t, tipo: materiais[i].tipo, url: materiais[i].u, descricao: 'Material de apoio (demonstração).' },
    })
  }
  log(`materiais de aula: ${materiais.length}`)

  // ── TCC, estágios, atividades complementares, GED ──
  const tccs = [
    { t: 'Georreferenciamento de imóveis rurais: estudo de caso em Araçatuba', st: 'APROVADO', nota: 9.2, or: 'Prof. Ricardo Almeida Souza' },
    { t: 'Uso de drones no levantamento topográfico de pequenas propriedades', st: 'ENTREGUE', nota: null, or: 'Profa. Helena Martins Costa' },
    { t: 'Aplicação de GNSS RTK na demarcação de lotes urbanos', st: 'EM_ANDAMENTO', nota: null, or: 'Profa. Juliana Reis Barbosa' },
    { t: 'Regularização fundiária urbana: entraves e soluções', st: 'APROVADO', nota: 8.5, or: 'Profa. Patrícia Nogueira Lima' },
    { t: 'Comparativo entre métodos de nivelamento geométrico e trigonométrico', st: 'REGISTRADO', nota: null, or: 'Prof. Ricardo Almeida Souza' },
    { t: 'SIG aplicado ao planejamento territorial municipal', st: 'REPROVADO', nota: 4.0, or: 'Profa. Helena Martins Costa' },
  ]
  for (let i = 0; i < tccs.length; i++) {
    const m = matriculas[i % matriculas.length]
    await prisma.acaTcc.create({
      data: {
        matriculaId: m.id, alunoId: m.alunoId, titulo: tccs[i].t, orientador: tccs[i].or,
        resumo: 'Trabalho de conclusão de curso (demonstração).', status: tccs[i].st, nota: tccs[i].nota,
        dataDefesa: ['APROVADO', 'REPROVADO'].includes(tccs[i].st) ? new Date(2026, 10, 10 + i) : null,
      },
    })
  }
  log(`TCCs: ${tccs.length}`)

  const estagios = [
    { e: 'Prefeitura Municipal de Araçatuba — Secretaria de Obras', s: 'Eng. Carlos Tadeu', h: 240, st: 'CONCLUIDO' },
    { e: 'Topografia Silva & Associados', s: 'Téc. Marina Alves', h: 180, st: 'EM_ANDAMENTO' },
    { e: 'Agrimensura Vale do Tietê', s: 'Eng. Roberto Nunes', h: 300, st: 'EM_ANDAMENTO' },
    { e: 'Cartório de Registro de Imóveis', s: 'Dra. Sônia Prado', h: 120, st: 'CONCLUIDO' },
    { e: 'GeoTech Levantamentos', s: 'Eng. Paulo Menezes', h: 200, st: 'CANCELADO' },
  ]
  for (let i = 0; i < estagios.length; i++) {
    await prisma.acaEstagio.create({
      data: {
        alunoId: alunoIds[i % alunoIds.length], empresa: estagios[i].e, supervisor: estagios[i].s,
        cargaHorariaH: estagios[i].h, status: estagios[i].st,
        dataInicio: new Date(2026, 2, 1), dataFim: estagios[i].st === 'CONCLUIDO' ? new Date(2026, 6, 30) : null,
        descricao: 'Estágio supervisionado (demonstração).',
      },
    })
  }
  log(`estágios: ${estagios.length}`)

  const ativs = [
    { t: 'Semana de Tecnologia e Inovação', c: 'Evento', h: 20, st: 'APROVADA' },
    { t: 'Curso de AutoCAD (online)', c: 'Curso', h: 40, st: 'APROVADA' },
    { t: 'Monitoria de Cálculo', c: 'Monitoria', h: 60, st: 'APROVADA' },
    { t: 'Palestra: Drones na Agrimensura', c: 'Palestra', h: 4, st: 'APROVADA' },
    { t: 'Projeto de extensão — Cidadania Fundiária', c: 'Extensão', h: 80, st: 'PENDENTE' },
    { t: 'Visita técnica ao INCRA', c: 'Visita técnica', h: 8, st: 'APROVADA' },
    { t: 'Curso de Excel avançado', c: 'Curso', h: 30, st: 'PENDENTE' },
    { t: 'Certificado sem comprovação válida', c: 'Curso', h: 15, st: 'REJEITADA' },
  ]
  for (let i = 0; i < ativs.length; i++) {
    await prisma.acaAtividadeComplementar.create({
      data: {
        alunoId: alunoIds[i % alunoIds.length], titulo: ativs[i].t, categoria: ativs[i].c, horas: ativs[i].h,
        data: new Date(2026, 3 + (i % 5), 10), status: ativs[i].st,
        observacao: ativs[i].st === 'REJEITADA' ? 'Comprovante ilegível — reenviar.' : null,
      },
    })
  }
  log(`atividades complementares: ${ativs.length}`)

  const geds = [
    { t: 'RG', n: 'rg-frente-verso.pdf', st: 'CONFERIDO' }, { t: 'CPF', n: 'cpf.pdf', st: 'CONFERIDO' },
    { t: 'Certidão de nascimento', n: 'certidao.pdf', st: 'CONFERIDO' }, { t: 'Histórico escolar', n: 'historico-em.pdf', st: 'RECEBIDO' },
    { t: 'Comprovante de residência', n: 'comprovante-residencia.pdf', st: 'RECEBIDO' }, { t: 'Foto 3x4', n: 'foto3x4.jpg', st: 'CONFERIDO' },
    { t: 'Certificado de conclusão', n: 'certificado-em.pdf', st: 'PENDENTE' }, { t: 'Título de eleitor', n: 'titulo.pdf', st: 'PENDENTE' },
    { t: 'Comprovante de vacinação', n: 'vacina.pdf', st: 'RECEBIDO' }, { t: 'Contrato assinado', n: 'contrato-assinado.pdf', st: 'CONFERIDO' },
  ]
  for (let i = 0; i < geds.length; i++) {
    await prisma.acaGedArquivo.create({
      data: {
        alunoId: alunoIds[i % alunoIds.length], tipo: geds[i].t, nome: geds[i].n,
        url: `https://exemplo.local/ged/${geds[i].n}`, status: geds[i].st,
        observacao: geds[i].st === 'PENDENTE' ? 'Documento pendente de envio pelo aluno.' : null,
      },
    })
  }
  log(`arquivos GED: ${geds.length}`)

  // ══════════ Parte 2 — telas específicas ainda magras ══════════
  const componentes = await prisma.acaComponente.findMany({ select: { id: true }, orderBy: { id: 'asc' } })
  const disciplinas = await prisma.acaDisciplina.findMany({ select: { id: true }, orderBy: { id: 'asc' } })
  const docentesDb = await prisma.acaDocente.findMany({ select: { id: true, userId: true, valorHoraCentavos: true }, orderBy: { id: 'asc' } })

  // ── CPA / Avaliação institucional ──
  const avals = [
    { nome: 'CPA 2026/1 — Autoavaliação Institucional', pub: 'TODOS' as const, st: 'ENCERRADA' as const },
    { nome: 'Avaliação de Desempenho Docente 2026/1', pub: 'ALUNO' as const, st: 'ABERTA' as const },
    { nome: 'Pesquisa de Clima — Corpo Docente', pub: 'PROFESSOR' as const, st: 'RASCUNHO' as const },
  ]
  const dims = ['Infraestrutura', 'Corpo docente', 'Coordenação e secretaria', 'Organização didático-pedagógica']
  const perguntasPorDim = [
    ['As salas de aula são adequadas e confortáveis?', 'Os laboratórios atendem às necessidades do curso?', 'A limpeza e conservação são satisfatórias?'],
    ['O professor demonstra domínio do conteúdo?', 'As aulas são bem planejadas?', 'O professor é acessível para dúvidas?'],
    ['O atendimento da secretaria é ágil?', 'A coordenação está disponível quando necessário?'],
    ['O plano de ensino foi apresentado no início?', 'A avaliação é coerente com o conteúdo?', 'Recomendaria este curso? (0 a 10)'],
  ]
  let dimN = 0, pergN = 0
  for (const a of avals) {
    const av = await prisma.acaAvaliacaoInst.create({
      data: {
        nome: `DEMO ${a.nome}`, descricao: 'Instrumento de avaliação (demonstração).', publico: a.pub, status: a.st,
        anonima: true, inicio: new Date('2026-05-01'), fim: new Date('2026-06-30'),
      },
    })
    for (let i = 0; i < dims.length; i++) {
      const dm = await prisma.acaAvalDimensao.create({ data: { avaliacaoId: av.id, nome: dims[i], ordem: i } })
      dimN++
      const qs = perguntasPorDim[i]
      for (let j = 0; j < qs.length; j++) {
        await prisma.acaAvalPergunta.create({
          data: { dimensaoId: dm.id, tipo: qs[j].includes('0 a 10') ? 'NPS' : 'ESCALA', enunciado: qs[j], ordem: j },
        })
        pergN++
      }
    }
  }
  log(`CPA: ${avals.length} avaliações, ${dimN} dimensões, ${pergN} perguntas`)

  // ── Currículo: equivalências, aproveitamentos, dependências ──
  let equiv = 0
  for (let i = 0; i + 1 < Math.min(componentes.length, 9); i += 2) {
    await prisma.acaEquivalencia.create({
      data: { componenteId: componentes[i].id, componenteEquivalenteId: componentes[i + 1].id, bidirecional: i % 4 === 0, observacao: 'Equivalência reconhecida pelo colegiado (demonstração).' },
    }).then(() => { equiv++ }).catch(() => {})
  }
  log(`equivalências: ${equiv}`)

  const aprovs = [
    { origem: 'EXTERNO' as const, inst: 'ETEC Araçatuba', disc: 'Desenho Técnico', ch: 60, nota: 8.5, st: 'DEFERIDO' as const },
    { origem: 'EXTERNO' as const, inst: 'IFSP — Campus Birigui', disc: 'Matemática Aplicada', ch: 80, nota: 7.8, st: 'DEFERIDO' as const },
    { origem: 'SUFICIENCIA' as const, inst: null, disc: 'Informática Básica', ch: 40, nota: 9.0, st: 'DEFERIDO' as const },
    { origem: 'EXTERNO' as const, inst: 'Faculdade Anhanguera', disc: 'Cartografia', ch: 40, nota: 5.5, st: 'INDEFERIDO' as const },
    { origem: 'INTERNO' as const, inst: null, disc: 'Topografia I', ch: 80, nota: null, st: 'SOLICITADO' as const },
  ]
  for (let i = 0; i < aprovs.length; i++) {
    const m = matriculas[i % matriculas.length]
    await prisma.acaAproveitamento.create({
      data: {
        matriculaId: m.id, alunoId: m.alunoId, componenteId: componentes[i % componentes.length].id,
        origem: aprovs[i].origem, instituicaoOrigem: aprovs[i].inst, disciplinaOrigem: aprovs[i].disc,
        cargaHorariaAproveitada: aprovs[i].ch, nota: aprovs[i].nota, status: aprovs[i].st,
        parecer: aprovs[i].st === 'INDEFERIDO' ? 'Carga horária insuficiente (mínimo 60h).' : aprovs[i].st === 'DEFERIDO' ? 'Deferido conforme análise de ementa.' : null,
        decididoEm: aprovs[i].st !== 'SOLICITADO' ? new Date(2026, 2, 20) : null,
      },
    })
  }
  log(`aproveitamentos: ${aprovs.length}`)

  const deps = [
    { tipo: 'DEPENDENCIA' as const, sit: 'EM_CURSO' }, { tipo: 'DEPENDENCIA' as const, sit: 'CUMPRIDA' },
    { tipo: 'ADAPTACAO' as const, sit: 'EM_CURSO' }, { tipo: 'DEPENDENCIA' as const, sit: 'PENDENTE' },
    { tipo: 'ADAPTACAO' as const, sit: 'CUMPRIDA' },
  ]
  for (let i = 0; i < deps.length; i++) {
    const m = matriculas[i % matriculas.length]
    await prisma.acaDependencia.create({
      data: {
        matriculaId: m.id, alunoId: m.alunoId, componenteId: componentes[(i + 3) % componentes.length].id,
        tipo: deps[i].tipo, turmaId: turma.id, situacao: deps[i].sit,
        observacao: 'Cursando em regime de dependência (demonstração).',
      },
    })
  }
  log(`dependências: ${deps.length}`)

  // ── Financeiro/Banco: contas bancárias, cobranças recorrentes, remessas ──
  const bancos = [
    { nome: 'Banco do Brasil — Conta Principal', cod: '001', ag: '1234-5', cc: '98765-4', cart: '17', conv: '1234567', cnab: '240' },
    { nome: 'Caixa Econômica Federal', cod: '104', ag: '0987', cc: '00012345-6', cart: '14', conv: '7654321', cnab: '240' },
    { nome: 'Sicredi — Conta Movimento', cod: '748', ag: '0710', cc: '45678-9', cart: '01', conv: '112233', cnab: '400' },
  ]
  const contaBancIds: number[] = []
  for (const b of bancos) {
    const c = await prisma.acaContaBancaria.create({
      data: {
        nome: `DEMO ${b.nome}`, bancoCodigo: b.cod, agencia: b.ag, conta: b.cc, carteira: b.cart, convenio: b.conv,
        cnab: b.cnab, cedente: 'INEPROTEC — Instituto de Educação Profissional', documentoCedente: '00.000.000/0001-00',
        sequencialRemessa: 3, ativo: true,
      },
    })
    contaBancIds.push(c.id)
  }
  log(`contas bancárias: ${bancos.length}`)

  const contratosDb = await prisma.acaContrato.findMany({ where: { matriculaId: { in: matriculas.map((m) => m.id) } }, select: { id: true, matriculaId: true } })
  const matToAluno2 = new Map(matriculas.map((m) => [m.id, m.alunoId]))
  const recs = [
    { desc: 'Mensalidade — plano anual', v: 35000, per: 'MENSAL' as const },
    { desc: 'Material didático — parcela', v: 12000, per: 'BIMESTRAL' as const },
    { desc: 'Taxa de laboratório', v: 8000, per: 'SEMESTRAL' as const },
    { desc: 'Seguro educacional', v: 2500, per: 'MENSAL' as const },
  ]
  let recN = 0
  for (let i = 0; i < Math.min(recs.length, contratosDb.length); i++) {
    const ct = contratosDb[i]
    await prisma.acaCobrancaRecorrente.create({
      data: {
        contratoId: ct.id, alunoId: matToAluno2.get(ct.matriculaId)!, descricao: recs[i].desc,
        valorCentavos: recs[i].v, periodo: recs[i].per, diaVencimento: 10,
        proximaGeracao: new Date(2026, 8, 10), ativo: i !== 3,
      },
    })
    recN++
  }
  log(`cobranças recorrentes: ${recN}`)

  const remessas = [
    { seq: 1, lay: '240', qtd: 32, val: 1120000, st: 'PROCESSADA' },
    { seq: 2, lay: '240', qtd: 28, val: 980000, st: 'ENVIADA' },
    { seq: 3, lay: '400', qtd: 15, val: 525000, st: 'GERADA' },
  ]
  for (let i = 0; i < remessas.length; i++) {
    const r = remessas[i]
    await prisma.acaRemessa.create({
      data: {
        contaBancariaId: contaBancIds[i % contaBancIds.length], sequencial: r.seq, layout: r.lay,
        qtdTitulos: r.qtd, valorTotalCentavos: r.val, arquivo: `REMESSA DEMO ${r.seq} — conteúdo CNAB omitido`,
        nomeArquivo: `CB${String(r.seq).padStart(6, '0')}.REM`, status: r.st,
      },
    })
  }
  log(`remessas CNAB: ${remessas.length}`)

  // ── Docentes: tipos de atividade + lançamentos de horas ──
  const tiposAtiv = [
    { n: 'Aula presencial', f: 1 }, { n: 'Aula prática/laboratório', f: 1.2 },
    { n: 'Orientação de TCC', f: 1.5 }, { n: 'Reunião pedagógica', f: 0.8 }, { n: 'Correção de avaliações', f: 0.5 },
  ]
  const tipoAtivIds: number[] = []
  for (const t of tiposAtiv) tipoAtivIds.push((await prisma.acaTipoAtividadeDocente.create({ data: { nome: `DEMO ${t.n}`, fatorHora: t.f, ativo: true } })).id)

  let ativDoc = 0
  const comps2 = ['2026-05', '2026-06', '2026-07']
  for (const doc of docentesDb.slice(0, 6)) {
    for (let i = 0; i < 3; i++) {
      const tIdx = (ativDoc + i) % tiposAtiv.length
      const horas = [20, 12, 8][i]
      const fator = tiposAtiv[tIdx].f
      const vh = doc.valorHoraCentavos || 6000
      await prisma.acaAtividadeDocente.create({
        data: {
          docenteId: doc.id, tipoId: tipoAtivIds[tIdx], competencia: comps2[i % comps2.length],
          descricao: `${tiposAtiv[tIdx].n} — turma de demonstração`, horas, valorHoraCentavos: vh,
          fatorHora: fator, valorCentavos: Math.round(horas * vh * fator),
          status: i === 0 ? 'PAGA' : i === 1 ? 'APROVADA' : 'LANCADA',
        },
      })
      ativDoc++
    }
  }
  log(`atividades docentes: ${ativDoc} (${tiposAtiv.length} tipos)`)

  // ── Controle de acesso: pontos + credenciais + logs ──
  const pontos = [
    { n: 'Catraca — Entrada Principal', l: 'Recepção' },
    { n: 'Catraca — Bloco B', l: 'Corredor dos laboratórios' },
    { n: 'Leitor — Biblioteca', l: 'Bloco C' },
  ]
  const pontoIds: number[] = []
  for (const pt of pontos) pontoIds.push((await prisma.acaPontoAcesso.create({ data: { nome: `DEMO ${pt.n}`, local: pt.l, ativo: true } })).id)
  log(`pontos de acesso: ${pontos.length}`)

  let logs = 0
  for (let i = 0; i < 24; i++) {
    const aluno = alunoIds[i % alunoIds.length]
    const autorizado = i % 7 !== 6
    await prisma.acaAcessoLog.create({
      data: {
        alunoId: aluno, pontoId: pontoIds[i % pontoIds.length], tipo: i % 2 === 0 ? 'ENTRADA' : 'SAIDA',
        autorizado, motivo: autorizado ? null : 'Credencial inativa ou matrícula trancada',
        createdAt: new Date(2026, 7, 10 + (i % 5), 7 + (i % 12), (i * 7) % 60),
      },
    })
    logs++
  }
  log(`logs de acesso: ${logs}`)

  // ── Grade de horários (turma demo) ──
  let hor = 0
  const gradeDias = [1, 2, 3, 4, 5]
  for (let d = 0; d < gradeDias.length; d++) {
    for (let s = 0; s < 2; s++) {
      await prisma.acaHorario.create({
        data: {
          turmaId: turma.id, disciplinaId: disciplinas[(d * 2 + s) % disciplinas.length].id,
          professorUserId: docentesDb[(d + s) % Math.max(docentesDb.length, 1)]?.userId ?? null,
          sala: s === 0 ? 'DEMO Sala 101' : 'DEMO Laboratório de Topografia',
          diaSemana: gradeDias[d], horaInicio: s === 0 ? '19:00' : '20:50', horaFim: s === 0 ? '20:40' : '22:30',
        },
      })
      hor++
    }
  }
  log(`grade de horários: ${hor} aulas/semana`)

  // ── Cadastros auxiliares: categorias e motivos ──
  const cats = ['Documentação', 'Financeiro', 'Acadêmico', 'Estágio e TCC']
  let catN = 0
  for (let i = 0; i < cats.length; i++) {
    await prisma.acaRequerimentoCategoria.create({ data: { nome: `DEMO ${cats[i]}`, ordem: i, ativo: true } }).then(() => { catN++ }).catch(() => {})
  }
  const motivos = ['Mudança de cidade', 'Dificuldade financeira', 'Incompatibilidade de horário', 'Problemas de saúde', 'Transferência para outra instituição']
  let motN = 0
  for (const m of motivos) {
    await prisma.acaMotivoCancelamento.create({ data: { nome: `DEMO ${m}`, ativo: true } }).then(() => { motN++ }).catch(() => {})
  }
  log(`categorias de requerimento: ${catN} | motivos de cancelamento: ${motN}`)

  // ── EAD: notas e trilha de acessos ao AVA ──
  const eadMats = await prisma.acaEadMatricula.findMany({ select: { matriculaId: true }, orderBy: { matriculaId: 'asc' } })
  const discEad = ['Topografia I', 'Cálculo Aplicado', 'Desenho Técnico', 'Georreferenciamento', 'Legislação Agrária']
  let eadNotas = 0
  for (let i = 0; i < eadMats.length; i++) {
    for (let j = 0; j < 2; j++) {
      await prisma.acaEadNota.create({
        data: {
          matriculaId: eadMats[i].matriculaId, disciplina: discEad[(i + j) % discEad.length],
          nota: Math.round((5 + ((i * 3 + j * 7) % 50) / 10) * 10) / 10, origem: j === 0 ? 'LMS' : 'MANUAL',
        },
      })
      eadNotas++
    }
  }
  const recursosEad = ['Videoaula 01 — Introdução', 'PDF — Apostila unidade I', 'Fórum de dúvidas', 'Questionário unidade I', 'Videoaula 02 — Prática', 'Entrega de atividade']
  let eadAcessos = 0
  for (let i = 0; i < eadMats.length; i++) {
    for (let j = 0; j < 3; j++) {
      await prisma.acaEadAcesso.create({
        data: {
          matriculaId: eadMats[i].matriculaId, recurso: recursosEad[(i + j) % recursosEad.length],
          acessadoEm: new Date(2026, 6, 5 + ((i + j) % 20), 8 + ((i * 2 + j) % 12), 0),
        },
      })
      eadAcessos++
    }
  }
  log(`EAD: ${eadNotas} notas, ${eadAcessos} acessos ao AVA`)

  // ── Diplomas (1 por matrícula concluída; a base já emitiu um registrado) ──
  const concluidas = matriculas.filter((m) => m.status === 'CONCLUIDO')
  const jaTem = new Set((await prisma.acaDiploma.findMany({ select: { matriculaId: true } })).map((d) => d.matriculaId))
  const statusDip: Array<'RASCUNHO' | 'XML_GERADO' | 'ASSINADO' | 'REGISTRADO'> = ['REGISTRADO', 'ASSINADO', 'XML_GERADO', 'RASCUNHO']
  let dips = 0
  for (const m of concluidas) {
    if (jaTem.has(m.id)) continue
    const st = statusDip[dips % statusDip.length]
    await prisma.acaDiploma.create({
      data: {
        matriculaId: m.id, alunoId: m.alunoId, status: st,
        numero: st === 'REGISTRADO' ? `DIP-2026-${String(1000 + dips)}` : null,
        livro: st === 'REGISTRADO' ? '01' : null, folha: st === 'REGISTRADO' ? String(20 + dips) : null,
        cargaHoraria: 1200, dataColacao: new Date('2026-12-18'),
        dataEmissao: ['REGISTRADO', 'ASSINADO'].includes(st) ? new Date('2026-12-20') : null,
        codigoValidacao: `DEMOVAL-${m.id}-${dips}`,
      },
    }).then(() => { dips++ }).catch(() => {})
  }
  log(`diplomas: +${dips}`)

  console.log('DEMO-Volume concluído.')
}

// Só executa quando rodado diretamente (não quando importado pelo teardown).
import { pathToFileURL } from 'url'
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((e) => { console.error('ERRO:', e.message); process.exitCode = 1 })
    .finally(async () => { await prisma.$disconnect(); process.exit(process.exitCode || 0) })
}
