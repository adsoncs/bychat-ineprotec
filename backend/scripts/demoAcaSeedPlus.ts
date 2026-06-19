// scripts/demoAcaSeedPlus.ts
// Carga de DEMONSTRAÇÃO dos MÓDULOS NOVOS (F5–F22 + F16/F17/F19), atrelada à
// demo existente (demoAcaSeed.ts). 100% removível: usa os marcadores da demo
// (turma 'DEMO — ', RA 'DEMO', lead source 'demo_aca'/'demo_vest') e prefixo
// 'DEMO' nos cadastros globais. Reexecutável (limpa antes de semear).
//
// Rodar:   JWT_SECRET=x npx tsx scripts/demoAcaSeedPlus.ts
// Limpar:  faz parte do demoAcaTeardown.ts (chama cleanupPlus()).

import { prisma } from '../src/lib/prisma.js'
import { classificar, ensalar } from '../src/services/acaVestibular.js'
import { sincronizarTurmaEad } from '../src/services/acaEad.js'
import { criarDiploma, gerarXmlDiploma, assinarDiploma, registrarDiploma } from '../src/services/acaDiploma.js'
import { gerarCredencial, registrarAcesso } from '../src/services/acaAcesso.js'

const log = (m: string) => console.log('  ' + m)

/** Remove toda a carga DEMO-plus. Seguro: só toca em registros marcados/DEMO. */
export async function cleanupPlus() {
  const turma = await prisma.acaTurma.findFirst({ where: { nome: { startsWith: 'DEMO — ' } }, select: { id: true, matrizId: true } })
  const alunos = await prisma.aluno.findMany({ where: { ra: { startsWith: 'DEMO' } }, select: { id: true } })
  const alunoIds = alunos.map((a) => a.id)
  const mats = alunoIds.length ? await prisma.acaMatricula.findMany({ where: { alunoId: { in: alunoIds } }, select: { id: true } }) : []
  const matIds = mats.map((m) => m.id)

  // per-aluno / per-matrícula
  if (matIds.length) {
    await prisma.acaMovimentacao.deleteMany({ where: { matriculaId: { in: matIds } } }).catch(() => {})
    await prisma.acaAproveitamento.deleteMany({ where: { matriculaId: { in: matIds } } }).catch(() => {})
    await prisma.acaDependencia.deleteMany({ where: { matriculaId: { in: matIds } } }).catch(() => {})
    await prisma.acaTcc.deleteMany({ where: { matriculaId: { in: matIds } } }).catch(() => {})
    await prisma.acaEadMatricula.deleteMany({ where: { matriculaId: { in: matIds } } }).catch(() => {})
    await prisma.acaEadNota.deleteMany({ where: { matriculaId: { in: matIds } } }).catch(() => {})
    await prisma.acaEadAcesso.deleteMany({ where: { matriculaId: { in: matIds } } }).catch(() => {})
    await prisma.acaCDA.deleteMany({ where: { alunoId: { in: alunoIds } } }).catch(() => {})
    await prisma.acaDiploma.deleteMany({ where: { alunoId: { in: alunoIds } } }).catch(() => {})
  }
  if (alunoIds.length) {
    await prisma.acaGedArquivo.deleteMany({ where: { alunoId: { in: alunoIds } } }).catch(() => {})
    const creds = await prisma.acaCredencial.findMany({ where: { alunoId: { in: alunoIds } }, select: { alunoId: true } })
    await prisma.acaAcessoLog.deleteMany({ where: { alunoId: { in: alunoIds } } }).catch(() => {})
    await prisma.acaCredencial.deleteMany({ where: { alunoId: { in: alunoIds } } }).catch(() => {})
    void creds
  }
  if (turma?.matrizId) {
    const comps = await prisma.acaComponente.findMany({ where: { matrizId: turma.matrizId }, select: { id: true } })
    const compIds = comps.map((c) => c.id)
    if (compIds.length) await prisma.acaEquivalencia.deleteMany({ where: { componenteId: { in: compIds } } }).catch(() => {})
  }
  if (turma) await prisma.acaEadTurma.deleteMany({ where: { turmaId: turma.id } }).catch(() => {})

  // contábil (lançamentos+regras DEMO)
  await prisma.acaLancamentoContabil.deleteMany({ where: { historico: { startsWith: 'DEMO' } } }).catch(() => {})
  await prisma.acaRegraContabil.deleteMany({ where: { historico: { startsWith: 'DEMO' } } }).catch(() => {})

  // remessas + recorrentes DEMO (recorrentes por descrição DEMO)
  await prisma.acaCobrancaRecorrente.deleteMany({ where: { descricao: { startsWith: 'DEMO' } } }).catch(() => {})
  const remessas = await prisma.acaRemessa.findMany({ where: { nomeArquivo: { startsWith: 'DEMO' } }, select: { id: true } })
  if (remessas.length) { await prisma.acaParcela.updateMany({ where: { remessaId: { in: remessas.map((r) => r.id) } }, data: { remessaId: null, nossoNumero: null } }).catch(() => {}); await prisma.acaRemessa.deleteMany({ where: { id: { in: remessas.map((r) => r.id) } } }).catch(() => {}) }

  // cadastros globais por nome DEMO
  await prisma.acaContaFinanceira.deleteMany({ where: { nome: { startsWith: 'DEMO' } } }).catch(() => {})
  await prisma.acaContaBancaria.deleteMany({ where: { nome: { startsWith: 'DEMO' } } }).catch(() => {})
  const idx = await prisma.acaIndexador.findMany({ where: { nome: { startsWith: 'DEMO' } }, select: { id: true } })
  if (idx.length) { await prisma.acaIndexadorValor.deleteMany({ where: { indexadorId: { in: idx.map((i) => i.id) } } }).catch(() => {}); await prisma.acaIndexador.deleteMany({ where: { id: { in: idx.map((i) => i.id) } } }).catch(() => {}) }
  await prisma.acaFeriado.deleteMany({ where: { nome: { startsWith: 'DEMO' } } }).catch(() => {})
  await prisma.acaCadastroAux.deleteMany({ where: { nome: { startsWith: 'DEMO' } } }).catch(() => {})
  await prisma.acaContaFinanceira.deleteMany({ where: { codigo: { startsWith: 'DEMO' } } }).catch(() => {})

  // alocação DEMO
  const amb = await prisma.acaAmbiente.findMany({ where: { nome: { startsWith: 'DEMO' } }, select: { id: true } })
  if (amb.length) { await prisma.acaReserva.deleteMany({ where: { ambienteId: { in: amb.map((a) => a.id) } } }).catch(() => {}); await prisma.acaEquipamento.deleteMany({ where: { ambienteId: { in: amb.map((a) => a.id) } } }).catch(() => {}); await prisma.acaAmbiente.deleteMany({ where: { id: { in: amb.map((a) => a.id) } } }).catch(() => {}) }
  await prisma.acaEquipamento.deleteMany({ where: { nome: { startsWith: 'DEMO' } } }).catch(() => {})
  await prisma.acaTipoAmbiente.deleteMany({ where: { nome: { startsWith: 'DEMO' } } }).catch(() => {})
  await prisma.acaTipoEquipamento.deleteMany({ where: { nome: { startsWith: 'DEMO' } } }).catch(() => {})

  // acesso pontos DEMO
  const pontos = await prisma.acaPontoAcesso.findMany({ where: { nome: { startsWith: 'DEMO' } }, select: { id: true } })
  if (pontos.length) { await prisma.acaAcessoLog.deleteMany({ where: { pontoId: { in: pontos.map((p) => p.id) } } }).catch(() => {}); await prisma.acaPontoAcesso.deleteMany({ where: { id: { in: pontos.map((p) => p.id) } } }).catch(() => {}) }

  // docente DEMO (observacao [DEMO])
  const docs = await prisma.acaDocente.findMany({ where: { observacao: { startsWith: '[DEMO]' } }, select: { id: true } })
  if (docs.length) { await prisma.acaAtividadeDocente.deleteMany({ where: { docenteId: { in: docs.map((d) => d.id) } } }).catch(() => {}); await prisma.acaDocenteAceite.deleteMany({ where: { docenteId: { in: docs.map((d) => d.id) } } }).catch(() => {}); await prisma.acaDocente.deleteMany({ where: { id: { in: docs.map((d) => d.id) } } }).catch(() => {}) }
  await prisma.acaTipoAtividadeDocente.deleteMany({ where: { nome: { startsWith: 'DEMO' } } }).catch(() => {})

  // CPA DEMO
  const avs = await prisma.acaAvaliacaoInst.findMany({ where: { nome: { startsWith: 'DEMO' } }, select: { id: true } })
  if (avs.length) await prisma.acaAvaliacaoInst.deleteMany({ where: { id: { in: avs.map((a) => a.id) } } }).catch(() => {}) // cascata dimensões/perguntas; respostas:
  await prisma.acaAvalResposta.deleteMany({ where: { avaliacaoId: { in: avs.map((a) => a.id) } } }).catch(() => {})

  // coordenador DEMO
  await prisma.acaCoordenador.deleteMany({ where: { nome: { startsWith: 'DEMO' } } }).catch(() => {})

  // requerimento avançado DEMO
  await prisma.acaRequerimentoCategoria.deleteMany({ where: { nome: { startsWith: 'DEMO' } } }).catch(() => {})
  await prisma.acaMotivoCancelamento.deleteMany({ where: { nome: { startsWith: 'DEMO' } } }).catch(() => {})
  await prisma.acaInscricaoEmpresa.deleteMany({ where: { nome: { startsWith: 'DEMO' } } }).catch(() => {})

  // vestibular DEMO (processo + registros + leads demo_vest)
  const procs = await prisma.selectionProcess.findMany({ where: { nome: { startsWith: 'DEMO' } }, select: { id: true } })
  const procIds = procs.map((p) => p.id)
  if (procIds.length) {
    const regs = await prisma.processRegistration.findMany({ where: { selectionProcessId: { in: procIds } }, select: { id: true } })
    const regIds = regs.map((r) => r.id)
    await prisma.acaProcessoEnsalamento.deleteMany({ where: { selectionProcessId: { in: procIds } } }).catch(() => {})
    await prisma.acaProcessoSala.deleteMany({ where: { selectionProcessId: { in: procIds } } }).catch(() => {})
    if (regIds.length) { await prisma.acaProcessoNota.deleteMany({ where: { processRegistrationId: { in: regIds } } }).catch(() => {}); await prisma.acaInscricaoExtra.deleteMany({ where: { processRegistrationId: { in: regIds } } }).catch(() => {}) }
    await prisma.acaProcessoComponente.deleteMany({ where: { selectionProcessId: { in: procIds } } }).catch(() => {})
    await prisma.acaGrupoInscricao.deleteMany({ where: { selectionProcessId: { in: procIds } } }).catch(() => {})
    if (regIds.length) await prisma.processRegistration.deleteMany({ where: { id: { in: regIds } } }).catch(() => {})
    await prisma.selectionProcess.deleteMany({ where: { id: { in: procIds } } }).catch(() => {})
  }
  await prisma.lead.deleteMany({ where: { source: 'demo_vest' } }).catch(() => {})

  // configs DEMO (singletons) — só remove se marcadas DEMO
  await prisma.acaDiplomaConfig.deleteMany({ where: { iesEmissora: { startsWith: 'DEMO' } } }).catch(() => {})
  await prisma.acaEadConfig.deleteMany({ where: { lmsNome: { startsWith: 'DEMO' } } }).catch(() => {})
}

async function main() {
  console.log('▶ Carga de demonstração — módulos novos (plus)')
  await cleanupPlus()

  const turma = await prisma.acaTurma.findFirst({ where: { nome: { startsWith: 'DEMO — ' } }, select: { id: true, matrizId: true, courseOfferingId: true, periodoLetivoId: true } })
  if (!turma) throw new Error('Demo base não encontrada — rode antes: npx tsx scripts/demoAcaSeed.ts')
  const professor = await prisma.user.findFirst({ orderBy: { id: 'asc' }, select: { id: true } })
  const alunos = await prisma.aluno.findMany({ where: { ra: { startsWith: 'DEMO' } }, select: { id: true }, orderBy: { id: 'asc' } })
  const alunoIds = alunos.map((a) => a.id)
  const mats = await prisma.acaMatricula.findMany({ where: { alunoId: { in: alunoIds } }, orderBy: { id: 'asc' }, select: { id: true, alunoId: true, status: true } })
  const ativos = mats.filter((m) => m.status === 'MATRICULADO')
  const trancado = mats.find((m) => m.status === 'TRANCADO')
  const diarios = await prisma.acaDiario.findMany({ where: { turmaId: turma.id }, select: { id: true, disciplinaId: true } })
  const componentes = turma.matrizId ? await prisma.acaComponente.findMany({ where: { matrizId: turma.matrizId }, orderBy: { id: 'asc' }, select: { id: true, disciplinaId: true } }) : []

  // ── F5 Movimentações ──
  try {
    if (trancado) await prisma.acaMovimentacao.create({ data: { matriculaId: trancado.id, alunoId: trancado.alunoId, tipo: 'TRANCAMENTO', statusDe: 'MATRICULADO', statusPara: 'TRANCADO', motivo: 'Trancamento por motivos pessoais (demo)' } })
    if (ativos[7]) await prisma.acaMovimentacao.create({ data: { matriculaId: ativos[7].id, alunoId: ativos[7].alunoId, tipo: 'AFASTAMENTO', statusDe: 'MATRICULADO', statusPara: 'MATRICULADO', motivo: 'Afastamento médico 30 dias (demo)', dataRetornoPrevista: new Date(Date.now() + 30 * 864e5) } })
    log('✓ F5 movimentações')
  } catch (e: any) { log('skip F5: ' + e?.message) }

  // ── F6 Currículo (equivalência + aproveitamento + DP) ──
  try {
    if (componentes.length >= 2) await prisma.acaEquivalencia.create({ data: { componenteId: componentes[0].id, componenteEquivalenteId: componentes[1].id, observacao: 'Equivalência demo' } })
    if (ativos[1] && componentes[2]) await prisma.acaAproveitamento.create({ data: { matriculaId: ativos[1].id, alunoId: ativos[1].alunoId, componenteId: componentes[2].id, origem: 'EXTERNO', instituicaoOrigem: 'Instituto Federal (demo)', cargaHorariaAproveitada: 60, nota: 8.5, status: 'DEFERIDO', decididoEm: new Date() } })
    if (ativos[2] && componentes[3]) await prisma.acaDependencia.create({ data: { matriculaId: ativos[2].id, alunoId: ativos[2].alunoId, componenteId: componentes[3].id, tipo: 'DEPENDENCIA', situacao: 'EM_CURSO' } })
    log('✓ F6 currículo (equivalência/aproveitamento/DP)')
  } catch (e: any) { log('skip F6: ' + e?.message) }

  // ── F14 Docente / RH ──
  try {
    if (professor) {
      const doc = await prisma.acaDocente.upsert({ where: { userId: professor.id }, create: { userId: professor.id, titulacao: 'Mestre', regime: 'HORISTA', valorHoraCentavos: 6000, observacao: '[DEMO] docente exemplo' }, update: { observacao: '[DEMO] docente exemplo' } })
      const tAula = await prisma.acaTipoAtividadeDocente.create({ data: { nome: 'DEMO Aula', fatorHora: 1 } })
      const tPrep = await prisma.acaTipoAtividadeDocente.create({ data: { nome: 'DEMO Preparação', fatorHora: 0.5 } })
      const comp = new Date().toISOString().slice(0, 7)
      await prisma.acaAtividadeDocente.create({ data: { docenteId: doc.id, tipoId: tAula.id, competencia: comp, descricao: 'Aulas do mês', horas: 40, valorHoraCentavos: 6000, fatorHora: 1, valorCentavos: 40 * 6000 } })
      await prisma.acaAtividadeDocente.create({ data: { docenteId: doc.id, tipoId: tPrep.id, competencia: comp, descricao: 'Preparação', horas: 16, valorHoraCentavos: 6000, fatorHora: 0.5, valorCentavos: Math.round(16 * 6000 * 0.5) } })
      for (const d of diarios.slice(0, 2)) await prisma.acaDocenteAceite.upsert({ where: { docenteId_diarioId: { docenteId: doc.id, diarioId: d.id } }, create: { docenteId: doc.id, diarioId: d.id, status: 'ACEITO', decididoEm: new Date() }, update: {} })
      log('✓ F14 docente + atividades + aceites')
    }
  } catch (e: any) { log('skip F14: ' + e?.message) }

  // ── F15 Alocação ──
  try {
    const tipoAmb = await prisma.acaTipoAmbiente.create({ data: { nome: 'DEMO Laboratório' } })
    const tipoEq = await prisma.acaTipoEquipamento.create({ data: { nome: 'DEMO Computador' } })
    const sala = await prisma.acaAmbiente.create({ data: { nome: 'DEMO Lab. Topografia', tipoId: tipoAmb.id, capacidade: 30, localizacao: 'Bloco A' } })
    await prisma.acaEquipamento.create({ data: { nome: 'DEMO Estação Total', tipoId: tipoEq.id, ambienteId: sala.id, patrimonio: 'PAT-001' } })
    const d = new Date(); d.setDate(d.getDate() + 3); d.setHours(12, 0, 0, 0)
    await prisma.acaReserva.create({ data: { ambienteId: sala.id, data: d, horaInicio: '19:00', horaFim: '21:00', finalidade: 'Aula prática de Topografia', responsavel: 'Coordenação (demo)' } })
    log('✓ F15 alocação (ambiente/equipamento/reserva)')
  } catch (e: any) { log('skip F15: ' + e?.message) }

  // ── F9 Financeiro Bancário ──
  try {
    const cf = await prisma.acaContaFinanceira.create({ data: { codigo: 'DEMO-3.1', nome: 'DEMO Mensalidades', tipo: 'RECEITA' } })
    await prisma.acaContaFinanceira.create({ data: { codigo: 'DEMO-1.1', nome: 'DEMO Caixa', tipo: 'RECEITA' } })
    await prisma.acaContaBancaria.create({ data: { nome: 'DEMO Banco do Brasil', bancoCodigo: '001', agencia: '1234', conta: '56789', carteira: '17', cedente: 'INEPROTEC (demo)', documentoCedente: '12345678000199' } })
    const idx = await prisma.acaIndexador.create({ data: { nome: 'DEMO IGPM' } })
    await prisma.acaIndexadorValor.create({ data: { indexadorId: idx.id, competencia: new Date().toISOString().slice(0, 7), valorPct: 0.42 } })
    const fer = new Date(); fer.setMonth(fer.getMonth() + 1); fer.setDate(15)
    await prisma.acaFeriado.create({ data: { data: fer, nome: 'DEMO Feriado municipal' } })
    if (ativos[0]) { const c = await prisma.acaContrato.findUnique({ where: { matriculaId: ativos[0].id }, select: { id: true } }); if (c) await prisma.acaCobrancaRecorrente.create({ data: { contratoId: c.id, alunoId: ativos[0].alunoId, descricao: 'DEMO mensalidade recorrente', valorCentavos: 35000, periodo: 'MENSAL', diaVencimento: 10, contaFinanceiraId: cf.id, proximaGeracao: new Date(Date.now() + 5 * 864e5) } }) }
    // remessa: pega algumas parcelas ABERTAS de contratos demo
    const matIds = mats.map((m) => m.id)
    const contratos = await prisma.acaContrato.findMany({ where: { matriculaId: { in: matIds } }, select: { id: true } })
    const parcelas = await prisma.acaParcela.findMany({ where: { contratoId: { in: contratos.map((c) => c.id) }, situacao: 'ABERTA', remessaId: null }, take: 4, select: { id: true, valorBrutoCentavos: true } })
    if (parcelas.length) {
      const rem = await prisma.acaRemessa.create({ data: { contaBancariaId: 0, sequencial: 1, layout: '400', qtdTitulos: parcelas.length, valorTotalCentavos: parcelas.reduce((s, p) => s + p.valorBrutoCentavos, 0), arquivo: 'DEMO REMESSA CNAB400 (exemplo)\r\n', nomeArquivo: 'DEMO000001.REM', status: 'GERADA' } })
      for (const p of parcelas) await prisma.acaParcela.update({ where: { id: p.id }, data: { remessaId: rem.id, nossoNumero: `1${String(p.id).padStart(8, '0')}` } })
    }
    log('✓ F9 financeiro bancário (contas/indexador/feriado/recorrente/remessa)')
  } catch (e: any) { log('skip F9: ' + e?.message) }

  // ── F10 Cobrança Fiscal (CDA + contábil) ──
  try {
    // CDA a partir de uma parcela vencida demo
    const matIds = mats.map((m) => m.id)
    const contratos = await prisma.acaContrato.findMany({ where: { matriculaId: { in: matIds } }, select: { id: true, matricula: { select: { alunoId: true } } } })
    const venc = await prisma.acaParcela.findFirst({ where: { contratoId: { in: contratos.map((c) => c.id) }, situacao: 'VENCIDA', cdaId: null }, select: { id: true, valorBrutoCentavos: true, contratoId: true } })
    if (venc) {
      const alunoId = contratos.find((c) => c.id === venc.contratoId)!.matricula.alunoId
      const ano = new Date().getFullYear()
      const cda = await prisma.acaCDA.create({ data: { numero: `CDA-${ano}-9001`, alunoId, valorCentavos: venc.valorBrutoCentavos, qtdParcelas: 1, status: 'INSCRITA' } })
      await prisma.acaParcela.update({ where: { id: venc.id }, data: { cdaId: cda.id } })
    }
    // regra contábil + lançamentos de algumas parcelas pagas demo
    const regra = await prisma.acaRegraContabil.create({ data: { evento: 'PARCELA_PAGA', historico: 'DEMO Receb. {aluno} parcela {parcela} {valor}', ativo: true } })
    const pagas = await prisma.acaParcela.findMany({ where: { contratoId: { in: contratos.map((c) => c.id) }, situacao: 'PAGA' }, take: 5, select: { id: true, valorPagoCentavos: true, valorBrutoCentavos: true, nroParcela: true } })
    for (const p of pagas) await prisma.acaLancamentoContabil.create({ data: { historico: `DEMO Receb. mensalidade parcela ${p.nroParcela}`, valorCentavos: p.valorPagoCentavos || p.valorBrutoCentavos, origem: 'PARCELA_PAGA', parcelaId: p.id, regraId: regra.id } })
    log('✓ F10 cobrança fiscal (CDA + lançamentos contábeis)')
  } catch (e: any) { log('skip F10: ' + e?.message) }

  // ── F7 Centrais (responsável + coordenador) ──
  try {
    if (ativos[0]) await prisma.acaResponsavel.create({ data: { alunoId: ativos[0].alunoId, nome: 'Maria (mãe) — demo', parentesco: 'Mãe', tipo: 'FINANCEIRO', telefone: '5562999990000', email: 'resp.demo@exemplo.test' } })
    const off = turma.courseOfferingId ? await prisma.courseOffering.findUnique({ where: { id: turma.courseOfferingId }, select: { courseId: true } }) : null
    if (off) await prisma.acaCoordenador.create({ data: { courseId: off.courseId, nome: 'DEMO Coordenador do Curso', email: 'coord.demo@exemplo.test' } })
    log('✓ F7 centrais (responsável + coordenador)')
  } catch (e: any) { log('skip F7: ' + e?.message) }

  // ── F8 Requerimento avançado (categoria/empresa/motivo) ──
  try {
    await prisma.acaRequerimentoCategoria.create({ data: { nome: 'DEMO Documentos', ordem: 1 } })
    await prisma.acaMotivoCancelamento.create({ data: { nome: 'DEMO Desistência' } })
    await prisma.acaInscricaoEmpresa.create({ data: { nome: 'DEMO Convênio Prefeitura', cnpj: '11222333000144' } })
    log('✓ F8 requerimento avançado (categoria/empresa/motivo)')
  } catch (e: any) { log('skip F8: ' + e?.message) }

  // ── F20 Cadastros auxiliares ──
  try {
    await prisma.acaCadastroAux.createMany({ data: [
      { tipo: 'AREA_CONHECIMENTO', nome: 'DEMO Ciências Agrárias' }, { tipo: 'AREA_CONHECIMENTO', nome: 'DEMO Engenharias' },
      { tipo: 'FORMACAO', nome: 'DEMO Técnico em Agrimensura' }, { tipo: 'ATENDIMENTO_ESPECIAL', nome: 'DEMO Mobilidade reduzida' },
      { tipo: 'TIPO_DOCUMENTO', nome: 'DEMO RG' }, { tipo: 'TIPO_DOCUMENTO', nome: 'DEMO Histórico do Ensino Médio' },
    ] })
    log('✓ F20 cadastros auxiliares')
  } catch (e: any) { log('skip F20: ' + e?.message) }

  // ── F21 GED ──
  try {
    if (ativos[0]) await prisma.acaGedArquivo.createMany({ data: [
      { alunoId: ativos[0].alunoId, tipo: 'RG', nome: 'RG (frente e verso).pdf', url: 'https://exemplo.test/ged/rg.pdf', status: 'CONFERIDO' },
      { alunoId: ativos[0].alunoId, tipo: 'CPF', nome: 'CPF.pdf', url: 'https://exemplo.test/ged/cpf.pdf', status: 'RECEBIDO' },
      { alunoId: ativos[0].alunoId, tipo: 'Histórico', nome: 'Histórico Ensino Médio.pdf', url: 'https://exemplo.test/ged/hist.pdf', status: 'PENDENTE' },
    ] })
    log('✓ F21 GED (documentos do aluno)')
  } catch (e: any) { log('skip F21: ' + e?.message) }

  // ── F22 TCC ──
  try {
    if (ativos[0]) await prisma.acaTcc.create({ data: { matriculaId: ativos[0].id, alunoId: ativos[0].alunoId, titulo: 'Levantamento planialtimétrico com drone (demo)', orientador: 'Prof. Mestre (demo)', status: 'EM_ANDAMENTO' } })
    if (ativos[3]) await prisma.acaTcc.create({ data: { matriculaId: ativos[3].id, alunoId: ativos[3].alunoId, titulo: 'Georreferenciamento de imóveis rurais (demo)', orientador: 'Prof. Mestre (demo)', status: 'APROVADO', nota: 9.2, dataDefesa: new Date() } })
    log('✓ F22 TCC')
  } catch (e: any) { log('skip F22: ' + e?.message) }

  // ── F16 Controle de Acesso ──
  try {
    const ponto = await prisma.acaPontoAcesso.create({ data: { nome: 'DEMO Catraca Principal', local: 'Entrada' } })
    for (const a of ativos.slice(0, 4)) { const cred = await gerarCredencial(a.alunoId); await registrarAcesso({ token: cred.token, pontoId: ponto.id, tipo: 'ENTRADA' }) }
    log('✓ F16 acesso (ponto + credenciais + logs)')
  } catch (e: any) { log('skip F16: ' + e?.message) }

  // ── F13 CPA ──
  try {
    const av = await prisma.acaAvaliacaoInst.create({ data: { nome: 'DEMO CPA 2026/1', descricao: 'Avaliação institucional (demo)', publico: 'ALUNO', status: 'ABERTA' } })
    const dim = await prisma.acaAvalDimensao.create({ data: { avaliacaoId: av.id, nome: 'Infraestrutura', ordem: 1 } })
    const dim2 = await prisma.acaAvalDimensao.create({ data: { avaliacaoId: av.id, nome: 'Didático-pedagógico', ordem: 2 } })
    const q1 = await prisma.acaAvalPergunta.create({ data: { dimensaoId: dim.id, tipo: 'ESCALA', enunciado: 'As salas são adequadas?', ordem: 1 } })
    const q2 = await prisma.acaAvalPergunta.create({ data: { dimensaoId: dim.id, tipo: 'NPS', enunciado: 'Recomendaria a instituição?', ordem: 2 } })
    const q3 = await prisma.acaAvalPergunta.create({ data: { dimensaoId: dim2.id, tipo: 'SIMNAO', enunciado: 'Os professores são pontuais?', ordem: 1 } })
    const q4 = await prisma.acaAvalPergunta.create({ data: { dimensaoId: dim2.id, tipo: 'TEXTO', enunciado: 'Sugestões', ordem: 2 } })
    const respostas = [[5, 10, 1, 'Tudo ótimo'], [4, 9, 1, 'Mais laboratórios'], [3, 6, 0, 'Melhorar o wifi'], [5, 8, 1, '']]
    let s = 0
    for (const r of respostas) { s++; const sess = `demo-${s}`; await prisma.acaAvalResposta.createMany({ data: [{ avaliacaoId: av.id, perguntaId: q1.id, sessaoId: sess, valor: r[0] as number }, { avaliacaoId: av.id, perguntaId: q2.id, sessaoId: sess, valor: r[1] as number }, { avaliacaoId: av.id, perguntaId: q3.id, sessaoId: sess, valor: r[2] as number }, ...(r[3] ? [{ avaliacaoId: av.id, perguntaId: q4.id, sessaoId: sess, texto: r[3] as string }] : [])] }) }
    log('✓ F13 CPA (avaliação + respostas)')
  } catch (e: any) { log('skip F13: ' + e?.message) }

  // ── F17 Diploma Digital (promove 1 demo a CONCLUIDO) ──
  try {
    const cfg = await prisma.acaDiplomaConfig.findFirst()
    if (!cfg) await prisma.acaDiplomaConfig.create({ data: { iesEmissora: 'DEMO Faculdade INEPROTEC', cnpjEmissora: '12345678000199', codigoMecEmissora: '9999', reitor: 'Reitor (demo)', secretario: 'Secretário (demo)', ativo: true } })
    const alvo = ativos[ativos.length - 1]
    if (alvo) {
      await prisma.acaMatricula.update({ where: { id: alvo.id }, data: { status: 'CONCLUIDO', dataConclusao: new Date() } })
      const dip = await criarDiploma(alvo.id)
      await gerarXmlDiploma(dip.id)
      await assinarDiploma(dip.id, 'DEMO assinatura ICP-Brasil (simulada)')
      await registrarDiploma(dip.id, { numero: '2026/0001', livro: '1', folha: '1' })
      log('✓ F17 diploma digital (concluinte + XML + registrado)')
    }
  } catch (e: any) { log('skip F17: ' + e?.message) }

  // ── F19 EAD (marca a turma demo como EAD + sincroniza + notas) ──
  try {
    const cfg = await prisma.acaEadConfig.findFirst()
    if (!cfg) await prisma.acaEadConfig.create({ data: { lmsNome: 'DEMO LMS INEPROTEC', modo: 'SIMULADO', ativo: true } })
    const eadTurma = await prisma.acaEadTurma.upsert({ where: { turmaId: turma.id }, create: { turmaId: turma.id, chEad: 80 }, update: { chEad: 80 } })
    await sincronizarTurmaEad(eadTurma.id)
    if (ativos[0]) await prisma.acaEadNota.create({ data: { matriculaId: ativos[0].id, disciplina: 'Topografia (EAD)', nota: 8.5, origem: 'LMS' } })
    if (ativos[0]) await prisma.acaEadAcesso.create({ data: { matriculaId: ativos[0].id, recurso: 'Videoaula 01 — Introdução' } })
    log('✓ F19 EAD (turma EAD + sincronização + nota)')
  } catch (e: any) { log('skip F19: ' + e?.message) }

  // ── F11 Vestibular (processo + candidatos + classificação + ensalamento) ──
  try {
    const unit = await prisma.educationalUnit.findFirst({ select: { id: true } })
    const offering = await prisma.courseOffering.findFirst({ select: { id: true } })
    if (unit && offering) {
      const proc = await prisma.selectionProcess.create({ data: { unitId: unit.id, nome: 'DEMO Vestibular 2026/2', periodoLetivo: '2026/2', notaCorte: 5, status: 'active', active: true } })
      const cObj = await prisma.acaProcessoComponente.create({ data: { selectionProcessId: proc.id, nome: 'Objetiva', peso: 2 } })
      const cRed = await prisma.acaProcessoComponente.create({ data: { selectionProcessId: proc.id, nome: 'Redação', peso: 1 } })
      const sala = await prisma.acaProcessoSala.create({ data: { selectionProcessId: proc.id, nome: 'DEMO Sala 01', capacidade: 30, local: 'Bloco A' } })
      const notas = [[9, 8], [8, 7], [7, 9], [3, 4], [6, 6]]
      for (let i = 0; i < notas.length; i++) {
        const lead = await prisma.lead.create({ data: { empresa: 'DEMO', nome: `Candidato Demo ${i + 1}`, whatsapp: `5563${String(900000000 + i).slice(0, 9)}`, email: `cand${i}.demo@exemplo.test`, formData: {}, scores: {}, source: 'demo_vest' } })
        const reg = await prisma.processRegistration.create({ data: { leadId: lead.id, offeringId: offering.id, selectionProcessId: proc.id, status: 'inscrito' } })
        await prisma.acaProcessoNota.create({ data: { processRegistrationId: reg.id, componenteId: cObj.id, nota: notas[i][0] } })
        await prisma.acaProcessoNota.create({ data: { processRegistrationId: reg.id, componenteId: cRed.id, nota: notas[i][1] } })
      }
      await classificar(proc.id, `componente:${cObj.id}`)
      await ensalar(proc.id)
      void sala
      log('✓ F11 vestibular (processo + 5 candidatos + classificação + ensalamento)')
    }
  } catch (e: any) { log('skip F11: ' + e?.message) }

  console.log('\n✅ Carga de demonstração (módulos novos) concluída.')
  console.log('   Para remover tudo: JWT_SECRET=x npx tsx scripts/demoAcaTeardown.ts')
}

// Só executa quando rodado diretamente (não quando importado pelo teardown).
import { pathToFileURL } from 'url'
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(() => prisma.$disconnect()).catch((e) => { console.error('ERRO:', e); prisma.$disconnect(); process.exit(1) })
}
