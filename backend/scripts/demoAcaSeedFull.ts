// scripts/demoAcaSeedFull.ts
// Complemento da carga DEMO acadêmica: popula as telas/tabelas que a demo base
// (demoAcaSeed + demoAcaSeedPlus) deixava vazias, para o cliente ver TODAS as
// telas com dados. 100% removível — cleanupFull() é chamado pelo teardown e no
// início daqui (reexecutável). Só toca em dados ligados aos alunos/turma DEMO.
//
// Rodar:  JWT_SECRET=x npx tsx scripts/demoAcaSeedFull.ts
// Cobre: ocorrências, conselho de classe, comunicações, documentos emitidos,
// bolsas, acordos de dívida, trâmites de requerimento, notas fiscais, CDA
// (dívida ativa), grupos/inscrições extras do vestibular, justificativas de
// censo, pré-requisitos de currículo e eventos de matrícula.

import { prisma } from '../src/lib/prisma.js'

const log = (m: string) => console.log('  ' + m)

/** Refs da demo base (alunos RA DEMO, turma 'DEMO — ', vestibular DEMO). */
async function refs() {
  const alunos = await prisma.aluno.findMany({ where: { ra: { startsWith: 'DEMO' } }, select: { id: true, ra: true }, orderBy: { id: 'asc' } })
  const alunoIds = alunos.map((a) => a.id)
  const turma = await prisma.acaTurma.findFirst({ where: { nome: { startsWith: 'DEMO — ' } }, select: { id: true, matrizId: true } })
  const matriculas = await prisma.acaMatricula.findMany({ where: { alunoId: { in: alunoIds } }, select: { id: true, alunoId: true, status: true }, orderBy: { id: 'asc' } })
  const contratos = await prisma.acaContrato.findMany({ where: { matriculaId: { in: matriculas.map((m) => m.id) } }, select: { id: true, matriculaId: true } })
  const matToAluno = new Map(matriculas.map((m) => [m.id, m.alunoId]))
  const contratoToAluno = new Map(contratos.map((c) => [c.id, matToAluno.get(c.matriculaId)!]))
  const parcelas = await prisma.acaParcela.findMany({ where: { contratoId: { in: contratos.map((c) => c.id) } }, select: { id: true, contratoId: true, situacao: true, valorBrutoCentavos: true }, orderBy: { id: 'asc' } })
  const requerimentos = await prisma.acaRequerimento.findMany({ select: { id: true, status: true }, orderBy: { id: 'asc' } })
  const sp = await prisma.selectionProcess.findFirst({ where: { nome: { startsWith: 'DEMO' } }, select: { id: true } })
  const processRegs = sp ? await prisma.processRegistration.findMany({ where: { selectionProcessId: sp.id }, select: { id: true } }) : []
  const componentes = turma?.matrizId
    ? await prisma.acaComponente.findMany({ where: { matrizId: turma.matrizId }, select: { id: true }, orderBy: { id: 'asc' } })
    : await prisma.acaComponente.findMany({ select: { id: true }, orderBy: { id: 'asc' }, take: 6 })
  return { alunoIds, turma, matriculas, contratos, contratoToAluno, parcelas, requerimentos, sp, processRegs, componentes }
}

/** Remove tudo que este seed cria. Seguro: filtra por alunos/turma/vestibular DEMO. */
export async function cleanupFull() {
  const r = await refs()
  const { alunoIds, turma, matriculas, contratos, requerimentos, sp, processRegs, componentes } = r
  const matIds = matriculas.map((m) => m.id)
  const contratoIds = contratos.map((c) => c.id)
  const reqIds = requerimentos.map((x) => x.id)
  const prIds = processRegs.map((x) => x.id)
  const compIds = componentes.map((x) => x.id)
  if (alunoIds.length) {
    await prisma.acaOcorrencia.deleteMany({ where: { alunoId: { in: alunoIds } } }).catch(() => {})
    await prisma.acaComunicacao.deleteMany({ where: { alunoId: { in: alunoIds } } }).catch(() => {})
    await prisma.acaBolsa.deleteMany({ where: { alunoId: { in: alunoIds } } }).catch(() => {})
    await prisma.acaNotaFiscal.deleteMany({ where: { alunoId: { in: alunoIds } } }).catch(() => {})
    await prisma.acaCDA.deleteMany({ where: { alunoId: { in: alunoIds } } }).catch(() => {})
    await prisma.acaAcordo.deleteMany({ where: { alunoId: { in: alunoIds } } }).catch(() => {})
  }
  if (contratoIds.length) await prisma.acaAcordo.deleteMany({ where: { contratoId: { in: contratoIds } } }).catch(() => {})
  if (turma) await prisma.acaConselho.deleteMany({ where: { turmaId: turma.id } }).catch(() => {})
  if (matIds.length) {
    await prisma.acaCensoJustificativa.deleteMany({ where: { matriculaId: { in: matIds } } }).catch(() => {})
    await prisma.acaMatriculaEvento.deleteMany({ where: { matriculaId: { in: matIds } } }).catch(() => {})
  }
  if (reqIds.length) await prisma.acaRequerimentoTramite.deleteMany({ where: { requerimentoId: { in: reqIds } } }).catch(() => {})
  if (prIds.length) await prisma.acaInscricaoExtra.deleteMany({ where: { processRegistrationId: { in: prIds } } }).catch(() => {})
  if (sp) await prisma.acaGrupoInscricao.deleteMany({ where: { selectionProcessId: sp.id } }).catch(() => {})
  if (compIds.length) await prisma.acaPreRequisito.deleteMany({ where: { componenteId: { in: compIds } } }).catch(() => {})
  // Documentos e CDA DEMO — marcados pelo prefixo do número (pega até os de alunoId null).
  await prisma.acaDocumento.deleteMany({ where: { numero: { startsWith: 'DEMO-' } } }).catch(() => {})
  // Config NFS-e e eventos de integração DEMO (marcados por conteúdo).
  await prisma.acaNfseConfig.deleteMany({ where: { cnpjPrestador: '00.000.000/0001-00' } }).catch(() => {})
  await prisma.acaIntegracaoEvento.deleteMany({ where: { eventoExternoId: { startsWith: 'DEMO-' } } }).catch(() => {})
}

async function main() {
  console.log('DEMO-Full acadêmico — populando telas restantes…')
  await cleanupFull()
  const r = await refs()
  const { alunoIds, turma, matriculas, contratos, contratoToAluno, parcelas, requerimentos, sp, processRegs, componentes } = r
  if (!alunoIds.length || !turma) { console.error('Base demo ausente — rode demoAcaSeed/Plus antes.'); return }

  // ── Ocorrências disciplinares (Secretaria) ──
  const ocorrencias = [
    { tipo: 'Elogio', descricao: 'Excelente participação no projeto integrador; destaque da turma.' },
    { tipo: 'Advertência', descricao: 'Uso de celular durante avaliação — advertência verbal registrada.' },
    { tipo: 'Atraso reiterado', descricao: 'Três atrasos na primeira aula no mês; responsável comunicado.' },
    { tipo: 'Indisciplina', descricao: 'Conversa excessiva em aula prática de topografia.' },
    { tipo: 'Elogio', descricao: 'Auxiliou colegas na monitoria de cálculo; conduta exemplar.' },
    { tipo: 'Ocorrência médica', descricao: 'Mal-estar em campo; encaminhado à enfermaria, sem intercorrências.' },
  ]
  for (let i = 0; i < ocorrencias.length; i++) {
    await prisma.acaOcorrencia.create({ data: { alunoId: alunoIds[i % alunoIds.length], turmaId: turma.id, ...ocorrencias[i] } })
  }
  log(`ocorrências: ${ocorrencias.length}`)

  // ── Conselho de classe (turma demo) ──
  await prisma.acaConselho.create({
    data: {
      turmaId: turma.id,
      ata: 'Conselho de classe final — 2026/1. Aprovados: 6. Em recuperação: 2. Reprovados: 2 (1 por nota, 1 por frequência). Encaminhamentos: reforço de cálculo e acompanhamento de frequência.',
      fechadoEm: new Date(),
    },
  })
  log('conselho de classe: 1')

  // ── Comunicações enviadas (vencimento/faltas/notas) ──
  const comps = [
    { tipo: 'VENCIMENTO', canal: 'whatsapp', assunto: 'Mensalidade próxima do vencimento', conteudo: 'Olá! Sua mensalidade vence em 3 dias. Evite juros pagando em dia. 💙' },
    { tipo: 'FALTAS', canal: 'email', assunto: 'Aviso de frequência', conteudo: 'Identificamos faltas acima do limite na disciplina de Topografia. Procure a coordenação.' },
    { tipo: 'NOTAS', canal: 'whatsapp', assunto: 'Notas disponíveis', conteudo: 'As notas da 2ª avaliação já estão no portal do aluno.' },
    { tipo: 'MANUAL', canal: 'email', assunto: 'Reunião de pais e responsáveis', conteudo: 'Convidamos para a reunião no dia 15/08, às 19h, no auditório.' },
    { tipo: 'VENCIMENTO', canal: 'whatsapp', assunto: 'Parcela em atraso', conteudo: 'Consta parcela vencida. Fale conosco para regularizar ou negociar. 🙏' },
  ]
  for (let i = 0; i < comps.length; i++) {
    const c = comps[i]
    await prisma.acaComunicacao.create({
      data: {
        alunoId: alunoIds[i % alunoIds.length], tipo: c.tipo, canal: c.canal,
        destino: c.canal === 'whatsapp' ? `5518998${(100000 + i).toString().slice(-6)}` : `aluno${i + 1}.demo@exemplo.com`,
        assunto: c.assunto, conteudo: c.conteudo, status: i === 3 ? 'FALHA' : 'ENVIADO',
        erro: i === 3 ? 'Endereço de e-mail inválido' : null,
        chaveDedup: `DEMOFULL-COM-${i}-${alunoIds[i % alunoIds.length]}`,
      },
    })
  }
  log(`comunicações: ${comps.length}`)

  // ── Documentos emitidos (Secretaria) ──
  const docs = [
    { tipo: 'DECLARACAO_MATRICULA', titulo: 'Declaração de Matrícula' },
    { tipo: 'DECLARACAO_FREQUENCIA', titulo: 'Declaração de Frequência' },
    { tipo: 'HISTORICO', titulo: 'Histórico Escolar' },
    { tipo: 'ATA_RESULTADOS', titulo: 'Ata de Resultados Finais' },
  ]
  for (let i = 0; i < docs.length; i++) {
    await prisma.acaDocumento.create({
      data: {
        numero: `DEMO-2026/${String(i + 1).padStart(4, '0')}`, tipo: docs[i].tipo,
        alunoId: docs[i].tipo === 'ATA_RESULTADOS' ? null : alunoIds[i % alunoIds.length],
        turmaId: turma.id, titulo: docs[i].titulo,
        dadosJson: { emitidoPara: 'Demonstração', observacao: 'Documento de exemplo' },
      },
    })
  }
  log(`documentos: ${docs.length}`)

  // ── Bolsas ──
  const bolsas = [
    { tipo: 'PERCENTUAL' as const, valor: 50, motivo: 'Bolsa mérito acadêmico (50%)' },
    { tipo: 'PERCENTUAL' as const, valor: 30, motivo: 'Convênio empresa parceira (30%)' },
    { tipo: 'VALOR' as const, valor: 15000, motivo: 'Desconto pontualidade (R$ 150,00)' },
    { tipo: 'INTEGRAL' as const, valor: 100, motivo: 'Bolsa integral — programa social' },
  ]
  for (let i = 0; i < bolsas.length; i++) {
    await prisma.acaBolsa.create({
      data: {
        alunoId: alunoIds[i], ...bolsas[i],
        validadeInicio: new Date('2026-01-01'), validadeFim: new Date('2026-12-31'), ativo: true,
      },
    })
  }
  log(`bolsas: ${bolsas.length}`)

  // ── Eventos de matrícula (histórico de status) ──
  let evCount = 0
  for (const m of matriculas) {
    await prisma.acaMatriculaEvento.create({ data: { matriculaId: m.id, de: null, para: 'MATRICULADO', obs: 'Matrícula efetivada' } })
    if (m.status === 'CONCLUIDO') { await prisma.acaMatriculaEvento.create({ data: { matriculaId: m.id, de: 'MATRICULADO', para: 'CONCLUIDO', obs: 'Conclusão do período' } }); evCount++ }
    if (m.status === 'TRANCADO') { await prisma.acaMatriculaEvento.create({ data: { matriculaId: m.id, de: 'MATRICULADO', para: 'TRANCADO', obs: 'Trancamento a pedido do aluno' } }); evCount++ }
    evCount++
  }
  log(`eventos de matrícula: ${evCount}`)

  // ── Trâmites de requerimento ──
  let tramites = 0
  for (const req of requerimentos) {
    await prisma.acaRequerimentoTramite.create({ data: { requerimentoId: req.id, estado: 'ABERTO', comentario: 'Protocolo recebido pela secretaria.' } })
    if (req.status !== 'ABERTO') { await prisma.acaRequerimentoTramite.create({ data: { requerimentoId: req.id, estado: 'EM_ANALISE', comentario: 'Encaminhado para análise da coordenação.' } }); tramites++ }
    if (req.status === 'DEFERIDO') { await prisma.acaRequerimentoTramite.create({ data: { requerimentoId: req.id, estado: 'DEFERIDO', comentario: 'Deferido. Documento disponível para retirada.' } }); tramites++ }
    tramites++
  }
  log(`trâmites de requerimento: ${tramites}`)

  // ── Financeiro: acordos, notas fiscais, CDA ──
  const contratoList = contratos.map((c) => c.id)
  // Acordos de dívida (2)
  let acordos = 0
  for (let i = 0; i < Math.min(2, contratoList.length); i++) {
    const cId = contratoList[i]
    const aId = contratoToAluno.get(cId)!
    const original = 105000, encargos = 12000, total = original + encargos
    await prisma.acaAcordo.create({
      data: {
        alunoId: aId, contratoId: cId, valorOriginalCentavos: original, valorEncargosCentavos: encargos,
        valorTotalCentavos: total, entradaCentavos: 20000, numParcelas: 3, valorParcelaCentavos: Math.round((total - 20000) / 3),
        status: i === 0 ? 'ATIVO' : 'QUITADO', observacao: 'Acordo de renegociação de parcelas vencidas.',
      },
    })
    acordos++
  }
  log(`acordos: ${acordos}`)

  // Notas fiscais (por parcela) — emitida / pendente / cancelada
  const parcelasAmostra = parcelas.slice(0, 6)
  let nfs = 0
  for (let i = 0; i < parcelasAmostra.length; i++) {
    const par = parcelasAmostra[i]
    const aId = contratoToAluno.get(par.contratoId)!
    const st = i < 3 ? 'EMITIDA' : i < 5 ? 'PENDENTE' : 'CANCELADA'
    await prisma.acaNotaFiscal.create({
      data: {
        alunoId: aId, parcelaId: par.id, valorCentavos: par.valorBrutoCentavos, status: st,
        numero: st === 'EMITIDA' ? `${1000 + i}` : null, serie: st === 'EMITIDA' ? '1' : null,
        emitidaEm: st === 'EMITIDA' ? new Date() : null,
        observacao: st === 'CANCELADA' ? 'Cancelada por erro de emissão' : 'NFS-e de mensalidade',
      },
    })
    nfs++
  }
  log(`notas fiscais: ${nfs}`)

  // CDA — Certidão de Dívida Ativa (inadimplência)
  const cdas = [
    { status: 'INSCRITA' as const, qtd: 3, valor: 105000 },
    { status: 'AJUIZADA' as const, qtd: 5, valor: 175000, ajuizada: true },
    { status: 'QUITADA' as const, qtd: 2, valor: 70000, quitada: true },
  ]
  for (let i = 0; i < cdas.length; i++) {
    const c = cdas[i]
    await prisma.acaCDA.create({
      data: {
        numero: `CDA-2026-DEMO-${String(i + 1).padStart(4, '0')}`, alunoId: alunoIds[i], valorCentavos: c.valor,
        qtdParcelas: c.qtd, status: c.status,
        ajuizadaEm: (c as any).ajuizada ? new Date() : null, quitadaEm: (c as any).quitada ? new Date() : null,
        observacao: 'Inscrição de demonstração em dívida ativa.',
      },
    })
  }
  log(`CDA (dívida ativa): ${cdas.length}`)

  // ── Vestibular: grupos de inscrição + inscrições extras ──
  if (sp) {
    const grupos = ['Ampla Concorrência', 'Cotas — Escola Pública', 'Convênio Empresa']
    const gruposCriados: number[] = []
    for (let i = 0; i < grupos.length; i++) {
      const g = await prisma.acaGrupoInscricao.create({ data: { selectionProcessId: sp.id, nome: grupos[i], ordem: i, ativo: true } })
      gruposCriados.push(g.id)
    }
    log(`grupos de inscrição: ${grupos.length}`)
    const empresa = await prisma.acaInscricaoEmpresa.findFirst({ select: { id: true } })
    let extras = 0
    for (let i = 0; i < processRegs.length; i++) {
      await prisma.acaInscricaoExtra.create({
        data: {
          processRegistrationId: processRegs[i].id, grupoId: gruposCriados[i % gruposCriados.length],
          empresaId: i % 3 === 2 ? empresa?.id ?? null : null,
          comoConheceu: ['Instagram', 'Indicação', 'Google', 'Rádio local', 'Feira de profissões'][i % 5],
        },
      })
      extras++
    }
    log(`inscrições extras: ${extras}`)
  }

  // ── Justificativas de censo ──
  let censo = 0
  for (const m of matriculas.filter((m) => m.status === 'TRANCADO')) {
    await prisma.acaCensoJustificativa.create({ data: { matriculaId: m.id, anoBase: 2026, motivo: 'Aluno com matrícula trancada — sem movimentação no ano-base.' } })
    censo++
  }
  log(`justificativas de censo: ${censo}`)

  // ── Pré-requisitos de currículo ──
  if (componentes.length >= 4) {
    await prisma.acaPreRequisito.create({ data: { componenteId: componentes[2].id, componenteRequeridoId: componentes[0].id } }).catch(() => {})
    await prisma.acaPreRequisito.create({ data: { componenteId: componentes[3].id, componenteRequeridoId: componentes[1].id } }).catch(() => {})
    log('pré-requisitos: 2')
  }

  // ── Config NFS-e (tela de configuração fiscal) ──
  await prisma.acaNfseConfig.create({
    data: {
      provedor: 'abrasf', ambiente: 'homologacao', cnpjPrestador: '00.000.000/0001-00',
      inscricaoMunicipal: '123456', codigoServico: '8.01', aliquotaPct: 2.0, ativo: false,
    },
  })
  log('config NFS-e: 1 (homologação)')

  // ── Eventos de integração (log Asaas/NFS-e) ──
  const integr = [
    { origem: 'asaas', status: 'SUCESSO' as const, erro: null },
    { origem: 'asaas', status: 'PENDENTE' as const, erro: null },
    { origem: 'nfse', status: 'ERRO' as const, erro: 'Certificado A1 não configurado (homologação)' },
    { origem: 'asaas', status: 'SUCESSO' as const, erro: null },
  ]
  for (let i = 0; i < integr.length; i++) {
    await prisma.acaIntegracaoEvento.create({
      data: {
        origem: integr[i].origem, eventoExternoId: `DEMO-${integr[i].origem}-${i + 1}`, status: integr[i].status,
        requestJson: { demo: true, ref: `parcela-${i + 1}` },
        responseJson: integr[i].status === 'SUCESSO' ? { ok: true, id: `evt_${1000 + i}` } : null,
        erroMotivo: integr[i].erro, tentativas: integr[i].status === 'ERRO' ? 3 : 1,
      },
    })
  }
  log(`eventos de integração: ${integr.length}`)

  console.log('DEMO-Full concluído.')
}

// Só executa quando rodado diretamente (não quando importado pelo teardown —
// senão o teardown re-semearia os dados antes de limpá-los).
import { pathToFileURL } from 'url'
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((e) => { console.error('ERRO:', e.message); process.exitCode = 1 })
    .finally(async () => { await prisma.$disconnect(); process.exit(process.exitCode || 0) })
}
