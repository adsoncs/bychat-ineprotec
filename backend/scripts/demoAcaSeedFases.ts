// scripts/demoAcaSeedFases.ts
//
// Carga de DEMONSTRAÇÃO das FASES 1–5 (fundação, motor de regras, portal,
// regulatório e captação). Complementa demoAcaSeed/demoAcaSeedPlus, que foram
// escritos antes destas telas existirem — por isso oito áreas apareciam vazias
// numa apresentação: Instituição, Esquemas de avaliação, Regime especial,
// ENADE, Prova online, Diploma, Termos de eliminação e acervo com custódia.
//
// 100% removível: tudo leva marcador DEMO e `cleanupFases()` entra no
// demoAcaTeardown.
//
// Rodar:   JWT_SECRET=x npx tsx scripts/demoAcaSeedFases.ts
// Limpar:  JWT_SECRET=x npx tsx scripts/demoAcaTeardown.ts
//
// ⚠️ CUIDADO QUE O SCRIPT TOMA — leia antes de mexer:
//
// 1. O esquema de avaliação INSTITUCIONAL tem precedência sobre os parâmetros
//    globais em Setting. Criar um com regra diferente MUDARIA a aprovação de
//    quem já está cursando. Por isso o esquema semeado reproduz exatamente a
//    regra vigente do tenant (média 6, frequência 75) — é demonstração, não
//    mudança de política.
// 2. Regime especial DEFERIDO altera o cálculo de frequência de verdade. O
//    deferido aqui é de aluno DEMO, em período passado.
// 3. A senha de portal semeada é de aluno fictício e está escrita no código de
//    propósito, para a apresentação. Nenhum aluno real recebe senha.

import { pathToFileURL } from 'node:url'
import bcrypt from 'bcryptjs'
import { prisma } from '../src/lib/prisma.js'
import { registrar as registrarEnade } from '../src/services/acaEnade.js'
import { classificarArquivo, eliminar } from '../src/services/acaAcervo.js'
import { criarDiploma, gerarXmlDiploma, assinarDiploma, registrarDiploma } from '../src/services/acaDiploma.js'
import { corrigirDissertativa, entregar, iniciar, salvarResposta, novoToken } from '../src/services/acaProva.js'

const log = (m: string) => console.log('  ' + m)

const TAG_MANTENEDORA = 'DEMO — '
const TAG_QUESTAO = '[DEMO]'
const SENHA_DEMO = 'Demo@2026'

/** Remove a carga desta camada. Só toca no que tem marcador DEMO. */
export async function cleanupFases() {
  // Prova online: cascata pela aplicação, mas as questões são globais.
  const provas = await prisma.acaProva.findMany({ where: { titulo: { startsWith: TAG_MANTENEDORA } }, select: { id: true } })
  const provaIds = provas.map((p) => p.id)
  if (provaIds.length) {
    const apls = await prisma.acaProvaAplicacao.findMany({ where: { provaId: { in: provaIds } }, select: { id: true } })
    await prisma.acaProvaResposta.deleteMany({ where: { aplicacaoId: { in: apls.map((a) => a.id) } } }).catch(() => {})
    await prisma.acaProvaAplicacao.deleteMany({ where: { provaId: { in: provaIds } } }).catch(() => {})
    await prisma.acaProvaItem.deleteMany({ where: { provaId: { in: provaIds } } }).catch(() => {})
    await prisma.acaProva.deleteMany({ where: { id: { in: provaIds } } }).catch(() => {})
  }
  await prisma.acaQuestao.deleteMany({ where: { enunciado: { startsWith: TAG_QUESTAO } } }).catch(() => {})

  const alunos = await prisma.aluno.findMany({ where: { ra: { startsWith: 'DEMO' } }, select: { id: true } })
  const alunoIds = alunos.map((a) => a.id)

  if (alunoIds.length) {
    await prisma.acaRegimeEspecial.deleteMany({ where: { alunoId: { in: alunoIds } } }).catch(() => {})
    await prisma.acaEnadeRegularidade.deleteMany({ where: { alunoId: { in: alunoIds } } }).catch(() => {})
    // Documentos do acervo criados por esta camada (marcados na observação).
    await prisma.acaGedArquivo.deleteMany({ where: { alunoId: { in: alunoIds }, observacao: { contains: '[DEMO-FASES]' } } }).catch(() => {})
    // Senha de portal semeada.
    await prisma.aluno.updateMany({
      where: { id: { in: alunoIds } },
      data: { portalSenhaHash: null, portalSenhaDefinidaEm: null, portalTentativas: 0, portalBloqueadoAte: null },
    }).catch(() => {})
    const mats = await prisma.acaMatricula.findMany({ where: { alunoId: { in: alunoIds } }, select: { id: true } })
    await prisma.acaDiploma.deleteMany({ where: { matriculaId: { in: mats.map((m) => m.id) } } }).catch(() => {})
  }

  // ── Educação profissional (fases T1–T4) ──
  const ppcps = await prisma.acaPpcp.findMany({ where: { nome: { startsWith: TAG_MANTENEDORA } }, select: { id: true } })
  for (const pp of ppcps) {
    const procs = await prisma.acaCertificacaoProcesso.findMany({ where: { ppcpId: pp.id }, select: { id: true } })
    for (const pr of procs) await prisma.acaCertificacaoAvaliacao.deleteMany({ where: { processoId: pr.id } }).catch(() => {})
    await prisma.acaCertificacaoProcesso.deleteMany({ where: { ppcpId: pp.id } }).catch(() => {})
    await prisma.acaPpcp.delete({ where: { id: pp.id } }).catch(() => {})
  }
  // Aproveitamentos gerados pelo reconhecimento desta carga.
  await prisma.acaAproveitamento.deleteMany({ where: { parecer: { contains: '[DEMO-FASES]' } } }).catch(() => {})

  // Capacidades/critérios/aferições dos componentes da matriz do piloto.
  const compsDemo = await prisma.acaComponente.findMany({ select: { id: true } })
  for (const c of compsDemo) {
    const caps = await prisma.acaCapacidade.findMany({ where: { componenteId: c.id }, select: { id: true } })
    for (const cap of caps) {
      const krits = await prisma.acaCriterio.findMany({ where: { capacidadeId: cap.id }, select: { id: true } })
      for (const k of krits) await prisma.acaAfericao.deleteMany({ where: { criterioId: k.id } }).catch(() => {})
      await prisma.acaCriterio.deleteMany({ where: { capacidadeId: cap.id } }).catch(() => {})
    }
    await prisma.acaCapacidade.deleteMany({ where: { componenteId: c.id } }).catch(() => {})
  }
  // Módulos e o vínculo dos componentes a eles.
  const modulos = await prisma.acaMatrizModulo.findMany({ select: { id: true } })
  if (modulos.length) {
    await prisma.acaComponente.updateMany({ where: { moduloId: { in: modulos.map((m) => m.id) } }, data: { moduloId: null } }).catch(() => {})
    await prisma.acaMatrizModulo.deleteMany({ where: { id: { in: modulos.map((m) => m.id) } } }).catch(() => {})
  }
  // Identidade técnica do curso e certificados de qualificação.
  await prisma.acaDocumento.deleteMany({ where: { tipo: 'CERTIFICADO_QUALIFICACAO' } }).catch(() => {})
  await prisma.course.updateMany({
    where: { eixoTecnologico: { not: null } },
    data: { eixoTecnologico: null, codigoCnct: null, certificacaoIntermediaria: false, perfilConclusao: null },
  }).catch(() => {})
  // Situação INTEGRALIZANDO aplicada por esta carga volta a ATIVO.
  await prisma.acaVinculo.updateMany({ where: { situacao: 'INTEGRALIZANDO' }, data: { situacao: 'ATIVO' } }).catch(() => {})

  await prisma.acaEliminacaoTermo.deleteMany({ where: { comissao: { startsWith: TAG_MANTENEDORA } } }).catch(() => {})
  await prisma.acaEsquemaAvaliacao.deleteMany({ where: { nome: { startsWith: TAG_MANTENEDORA } } }).catch(() => {})

  // Hierarquia institucional: atos → IES → mantenedora.
  const ies = await prisma.acaIes.findMany({ where: { nome: { startsWith: TAG_MANTENEDORA } }, select: { id: true } })
  if (ies.length) {
    await prisma.acaAtoAutorizativo.deleteMany({ where: { escopo: 'IES', entidadeId: { in: ies.map((i) => i.id) } } }).catch(() => {})
    await prisma.acaIes.deleteMany({ where: { id: { in: ies.map((i) => i.id) } } }).catch(() => {})
  }
  // Atos de CURSO não têm marcador próprio; os desta carga são os que citam a
  // numeração fictícia usada aqui.
  await prisma.acaAtoAutorizativo.deleteMany({
    where: { escopo: 'CURSO', numero: { in: ['Portaria SERES nº 567', 'Portaria SERES nº 89'] } },
  }).catch(() => {})
  await prisma.acaMantenedora.deleteMany({ where: { razaoSocial: { startsWith: TAG_MANTENEDORA } } }).catch(() => {})
}

const diasFrente = (n: number) => new Date(Date.now() + n * 86400_000)
const diasAtras = (n: number) => new Date(Date.now() - n * 86400_000)

async function main() {
  console.log('Carga DEMO — fases 1 a 5')
  await cleanupFases()

  const alunos = await prisma.aluno.findMany({
    where: { ra: { startsWith: 'DEMO' } },
    select: { id: true, ra: true, lead: { select: { nome: true } } },
    orderBy: { id: 'asc' },
  })
  if (alunos.length === 0) {
    console.log('  Nenhum aluno DEMO encontrado. Rode antes: npx tsx scripts/demoAcaSeed.ts')
    return
  }

  // ─────────── Fase 1: hierarquia institucional ───────────
  const mant = await prisma.acaMantenedora.create({
    data: {
      razaoSocial: `${TAG_MANTENEDORA}Instituto Educacional Modelo Ltda.`,
      nomeFantasia: 'Instituto Modelo',
      cnpj: '12.345.678/0001-90',
      repNome: 'Carlos Eduardo Prado', repCargo: 'Diretor-presidente',
      email: 'mantenedora@exemplo.edu.br', telefone: '(62) 3333-0000',
      enderecoJson: { logradouro: 'Av. das Nações, 1200', municipio: 'Goiânia', uf: 'GO', cep: '74000-000' } as any,
    },
  })
  const ies = await prisma.acaIes.create({
    data: {
      mantenedoraId: mant.id,
      nome: `${TAG_MANTENEDORA}Faculdade Modelo`,
      sigla: 'FMOD',
      codigoEmec: '99999',
      categoriaAdmin: 'PRIVADA_COM_FINS_LUCRATIVOS',
      organizacaoAcad: 'FACULDADE',
      dirigenteNome: 'Profa. Helena Marques', dirigenteEmail: 'direcao@exemplo.edu.br',
      piNome: 'Prof. Antônio Vieira', piEmail: 'pi@exemplo.edu.br',
      enderecoJson: { logradouro: 'Av. das Nações, 1200', municipio: 'Goiânia', uf: 'GO', cep: '74000-000' } as any,
    },
  })
  const curso = await prisma.course.findFirst({ select: { id: true } })
  const cursoId = curso?.id ?? 1

  // Um ato perto do vencimento de propósito: é o alerta de 180/90/30 dias que
  // a tela precisa mostrar numa apresentação.
  await prisma.acaAtoAutorizativo.createMany({
    data: [
      { escopo: 'IES', entidadeId: ies.id, tipo: 'credenciamento', numero: 'Portaria MEC nº 1.234', dataPublicacao: diasAtras(1800), validadeAte: diasFrente(900), observacao: 'Credenciamento institucional.' },
      { escopo: 'CURSO', entidadeId: cursoId, tipo: 'reconhecimento', numero: 'Portaria SERES nº 567', dataPublicacao: diasAtras(1100), validadeAte: diasFrente(75), observacao: 'Reconhecimento do curso — renovação a providenciar.' },
      { escopo: 'CURSO', entidadeId: cursoId, tipo: 'autorizacao', numero: 'Portaria SERES nº 89', dataPublicacao: diasAtras(2200), validadeAte: diasAtras(30), observacao: 'Ato vencido, substituído pelo reconhecimento.' },
    ],
  })
  log(`Instituição: mantenedora + IES (e-MEC 99999) + 3 atos (1 vence em 75 dias)`)

  // ─────────── Fase 2: esquema de avaliação ───────────
  // Reproduz a regra vigente do tenant. Ver o aviso no topo do arquivo.
  const esquema = await prisma.acaEsquemaAvaliacao.create({
    data: {
      escopo: 'INSTITUCIONAL', escopoId: null,
      nome: `${TAG_MANTENEDORA}Regimento geral`,
      descricao: 'Duas avaliações com pesos iguais, exame para quem fica entre 4 e 6.',
      mediaAprovacao: 6, frequenciaMinima: 75,
      exameHabilitado: true, exameMinimo: 4, formulaFinal: '(MP + EX)/2', mediaFinalAprovacao: 5,
      casasDecimais: 1, arredondamento: 'MATEMATICO',
      segundaChamadaHabilitada: true, limiteDependencias: 3,
      componentes: {
        create: [
          { sigla: 'N1', nome: '1ª avaliação', peso: 1, ordem: 0 },
          { sigla: 'N2', nome: '2ª avaliação', peso: 1, ordem: 1 },
        ],
      },
    },
  })
  log(`Esquema de avaliação institucional #${esquema.id} (média 6, exame 4–6, 2ª chamada, limite 3 DPs)`)

  // ─────────── Fase 3: regime especial ───────────
  const [a1, a2, a3] = alunos
  await prisma.acaRegimeEspecial.createMany({
    data: [
      { alunoId: a1!.id, tipo: 'GESTANTE', status: 'DEFERIDO', dataInicio: diasAtras(60), dataFim: diasAtras(5), amparoLegal: 'Lei nº 6.202/1975', planoAtividades: 'Trabalhos das unidades 3 e 4 entregues por e-mail.', deferidoEm: diasAtras(58) },
      { alunoId: a2!.id, tipo: 'SAUDE', status: 'SOLICITADO', dataInicio: diasAtras(3), dataFim: diasFrente(25), amparoLegal: 'Decreto-Lei nº 1.044/1969', observacao: 'Atestado de 30 dias anexado pelo responsável.' },
      { alunoId: a3!.id, tipo: 'MILITAR', status: 'ENCERRADO', dataInicio: diasAtras(200), dataFim: diasAtras(150), amparoLegal: 'Lei nº 4.375/1964 (serviço militar)' },
    ],
  })
  log('Regime especial: 1 deferido (encerrado no tempo), 1 aguardando análise, 1 encerrado')

  // Senha de portal num aluno demo, para mostrar o login por CPF/RA.
  await prisma.aluno.update({
    where: { id: a1!.id },
    data: { portalSenhaHash: await bcrypt.hash(SENHA_DEMO, 10), portalSenhaDefinidaEm: new Date() },
  })
  log(`Portal: ${a1!.lead?.nome ?? a1!.ra} entra com RA ${a1!.ra} e senha ${SENHA_DEMO}`)

  // ─────────── Fase 4: ENADE, acervo e diploma ───────────
  const anoBase = new Date().getFullYear() - 1
  for (const [i, a] of alunos.entries()) {
    // Mistura proposital: painel com tudo regular não mostra para que serve.
    const situacao = i % 4 === 0 ? 'PENDENTE' : i % 4 === 1 ? 'PARTICIPOU' : i % 4 === 2 ? 'DISPENSADO' : 'INSCRITO'
    await registrarEnade({
      alunoId: a.id, ano: anoBase,
      condicao: i < 4 ? 'INGRESSANTE' : 'CONCLUINTE',
      situacao: situacao as any,
      ...(situacao === 'DISPENSADO' ? { dispensaMotivo: 'Colação de grau fora do calendário do ciclo.' } : {}),
    }).catch(() => {})
  }
  log(`ENADE: ${alunos.length} registros no ciclo ${anoBase} (participou, dispensado, inscrito e pendente)`)

  // Acervo: documentos temporários já vencidos, para a tela de eliminação ter o
  // que mostrar, e classificação aplicada em tudo.
  // createManyAndReturn é exclusivo do PostgreSQL; aqui é MySQL.
  const docsAcervo: Array<{ id: number }> = []
  for (const d of [
      { alunoId: a1!.id, tipo: 'ATESTADO', nome: 'Atestado médico (2018)', url: 'https://arquivo.exemplo/ates-2018.pdf', status: 'CONFERIDO', observacao: '[DEMO-FASES] acervo', createdAt: diasAtras(2900) },
      { alunoId: a2!.id, tipo: 'COMPROVANTE_RESIDENCIA', nome: 'Comprovante de residência (2018)', url: 'https://arquivo.exemplo/comp-2018.pdf', status: 'CONFERIDO', observacao: '[DEMO-FASES] acervo', createdAt: diasAtras(2800) },
      { alunoId: a3!.id, tipo: 'REQUERIMENTO', nome: 'Requerimento de trancamento (2022)', url: 'https://arquivo.exemplo/req-2022.pdf', status: 'CONFERIDO', observacao: '[DEMO-FASES] acervo', createdAt: diasAtras(1500) },
      { alunoId: a1!.id, tipo: 'DIPLOMA', nome: 'Diploma de graduação (cópia)', url: 'https://arquivo.exemplo/dip.pdf', status: 'CONFERIDO', observacao: '[DEMO-FASES] acervo', createdAt: diasAtras(900) },
  ]) {
    docsAcervo.push(await prisma.acaGedArquivo.create({ data: d, select: { id: true } }))
  }
  const todosDocs = await prisma.acaGedArquivo.findMany({ where: { classificacao: null }, select: { id: true } })
  for (const d of todosDocs) await classificarArquivo(d.id).catch(() => {})
  log(`Acervo: ${docsAcervo.length} documentos antigos + classificação aplicada em ${todosDocs.length}`)

  // Termo de eliminação sobre os que passaram do prazo.
  const vencidos = await prisma.acaGedArquivo.findMany({
    where: { temporalidade: 'TEMPORARIO', guardaAte: { not: null, lte: new Date() }, eliminadoEm: null },
    select: { id: true }, take: 2,
  })
  if (vencidos.length > 0) {
    const t = await eliminar({
      arquivoIds: vencidos.map((v) => v.id),
      comissao: `${TAG_MANTENEDORA}Comissão Permanente de Avaliação de Documentos`,
      responsavel: 'Secretaria Acadêmica',
      observacao: 'Eliminação de rotina após o prazo de guarda.',
    }).catch(() => null)
    if (t) log(`Termo de eliminação ${t.termo.numero}: ${t.eliminados} documento(s)`)
  }

  // Diploma do aluno já formado.
  const formado = await prisma.acaMatricula.findFirst({
    where: { status: 'CONCLUIDO', aluno: { ra: { startsWith: 'DEMO' } } },
    select: { id: true, alunoId: true },
  })
  if (formado) {
    // O aluno formado precisa estar regular no ENADE, senão a trava barra — e
    // é justamente essa trava que a demonstração deve mostrar funcionando.
    await registrarEnade({ alunoId: formado.alunoId, ano: anoBase, condicao: 'CONCLUINTE', situacao: 'PARTICIPOU' }).catch(() => {})
    const dip = await criarDiploma(formado.id).catch((e) => { log(`Diploma não emitido: ${e?.message}`); return null })
    if (dip) {
      await gerarXmlDiploma(dip.id).catch(() => {})
      await assinarDiploma(dip.id).catch(() => {})
      await registrarDiploma(dip.id).catch(() => {})
      log(`Diploma ${dip.id} emitido, assinado e registrado`)
    }
  }

  // ─────────── Fase 5: prova online ───────────
  const objetivas = [
    { area: 'Matemática', enunciado: `${TAG_QUESTAO} Se 3x + 5 = 20, qual o valor de x?`, alternativas: [{ id: 'a', texto: '3' }, { id: 'b', texto: '5' }, { id: 'c', texto: '15' }, { id: 'd', texto: '25' }], gabarito: 'b' },
    { area: 'Português', enunciado: `${TAG_QUESTAO} Assinale a frase com concordância correta.`, alternativas: [{ id: 'a', texto: 'Fazem dois anos que estudo aqui.' }, { id: 'b', texto: 'Faz dois anos que estudo aqui.' }, { id: 'c', texto: 'Fazem-se dois anos que estudo aqui.' }], gabarito: 'b' },
    { area: 'Conhecimentos gerais', enunciado: `${TAG_QUESTAO} O Censo da Educação Superior é conduzido por qual órgão?`, alternativas: [{ id: 'a', texto: 'INEP' }, { id: 'b', texto: 'IBGE' }, { id: 'c', texto: 'CAPES' }], gabarito: 'a' },
    { area: 'Matemática', enunciado: `${TAG_QUESTAO} Qual é 15% de 240?`, alternativas: [{ id: 'a', texto: '24' }, { id: 'b', texto: '36' }, { id: 'c', texto: '48' }], gabarito: 'b' },
    { area: 'Português', enunciado: `${TAG_QUESTAO} "Não obstante" indica qual relação?`, alternativas: [{ id: 'a', texto: 'Concessão' }, { id: 'b', texto: 'Conclusão' }, { id: 'c', texto: 'Adição' }], gabarito: 'a' },
  ]
  const criadasObj = []
  for (const q of objetivas) {
    criadasObj.push(await prisma.acaQuestao.create({
      data: { area: q.area, enunciado: q.enunciado, tipo: 'OBJETIVA', alternativas: q.alternativas as any, gabarito: q.gabarito, peso: 1 },
    }))
  }
  const redacao = await prisma.acaQuestao.create({
    data: {
      area: 'Redação', tipo: 'DISSERTATIVA', peso: 3,
      enunciado: `${TAG_QUESTAO} Redija um texto dissertativo-argumentativo sobre o acesso ao ensino superior no interior do país.`,
      rubricaJson: [
        { id: 'norma', criterio: 'Domínio da norma culta', pontosMax: 4 },
        { id: 'tema', criterio: 'Compreensão do tema', pontosMax: 4 },
        { id: 'argum', criterio: 'Argumentação e repertório', pontosMax: 4 },
        { id: 'coesao', criterio: 'Coesão e coerência', pontosMax: 4 },
        { id: 'proposta', criterio: 'Proposta de intervenção', pontosMax: 4 },
      ] as any,
    },
  })
  const prova = await prisma.acaProva.create({
    data: {
      titulo: `${TAG_MANTENEDORA}Vestibular ${new Date().getFullYear()}/2`,
      instrucoes: 'Leia com atenção. A prova encerra automaticamente ao fim do tempo.',
      duracaoMinutos: 180, notaMaxima: 100, publicada: true,
      itens: {
        create: [
          ...criadasObj.map((q, i) => ({ questaoId: q.id, ordem: i, peso: 1 })),
          { questaoId: redacao.id, ordem: 5, peso: 3 },
        ],
      },
    },
  })

  // Três candidatos em estados diferentes: é o que mostra a tela viva.
  const candidatos = [
    { nome: 'Marina Alves Ferreira', cpf: '111.222.333-44', estado: 'CORRIGIDA' },
    { nome: 'Rafael Souza Lima', cpf: '222.333.444-55', estado: 'ENTREGUE' },
    { nome: 'Beatriz Nogueira', cpf: '333.444.555-66', estado: 'PENDENTE' },
  ]
  for (const c of candidatos) {
    const token = novoToken()
    const ap = await prisma.acaProvaAplicacao.create({
      data: { provaId: prova.id, token, candidatoNome: c.nome, candidatoCpf: c.cpf },
    })
    if (c.estado === 'PENDENTE') continue

    await iniciar(token)
    // Respostas: a primeira candidata acerta mais que o segundo.
    const acertaTudo = c.estado === 'CORRIGIDA'
    for (const [i, q] of criadasObj.entries()) {
      const alternativas = q.alternativas as Array<{ id: string }>
      const errada = alternativas.find((a) => a.id !== q.gabarito)?.id ?? 'a'
      const marcar = acertaTudo || i < 2 ? q.gabarito! : errada
      await salvarResposta(token, q.id, marcar)
    }
    await salvarResposta(token, redacao.id,
      'O acesso ao ensino superior no interior ainda esbarra na distância e no custo de deslocamento. '
      + 'A expansão de polos e da oferta a distância reduziu parte do problema, mas a permanência do estudante '
      + 'continua dependendo de apoio financeiro e de acompanhamento pedagógico. Propõe-se articular bolsas '
      + 'municipais com tutoria presencial nos polos, de modo que o ingresso não se perca na evasão.')
    await entregar(token)

    if (c.estado === 'CORRIGIDA') {
      await corrigirDissertativa({
        aplicacaoId: ap.id, questaoId: redacao.id,
        rubrica: { norma: 3.5, tema: 4, argum: 3, coesao: 3, proposta: 3.5 },
        parecer: 'Texto coeso e com proposta viável; pontuação e concordância pedem revisão.',
      })
    }
  }
  log(`Prova online: ${criadasObj.length} objetivas + 1 redação com rubrica, 3 candidatos (corrigido, aguardando correção e não iniciado)`)

  // ─────────── Produção docente na competência corrente ───────────
  const competencia = new Date().toISOString().slice(0, 7)
  const docentes = await prisma.acaDocente.findMany({ where: { ativo: true }, select: { id: true }, take: 3 })
  const tipoAtiv = await prisma.acaTipoAtividadeDocente.findFirst({ select: { id: true } })
  if (docentes.length && tipoAtiv) {
    for (const [i, d] of docentes.entries()) {
      const horas = 4 + i * 2
      await prisma.acaAtividadeDocente.create({
        data: {
          docenteId: d.id, tipoId: tipoAtiv.id, competencia,
          descricao: 'Orientação de TCC e banca (demonstração)',
          horas, valorCentavos: horas * 8000,
        },
      }).catch(() => {})
    }
    log(`Produção docente: lançamentos na competência ${competencia}`)
  }

  // ═══════════ Educação profissional técnica (fases T1–T4) ═══════════
  //
  // Sem esta parte, as telas de módulos, competências, qualificação e
  // reconhecimento aparecem vazias numa apresentação — foi o que a reanálise
  // encontrou: o seed foi escrito antes dessas fases existirem.

  const cursoPiloto = await prisma.course.findFirst({ where: { id: curso?.id ?? 1 }, select: { id: true, nome: true } })
  if (cursoPiloto) {
    await prisma.course.update({
      where: { id: cursoPiloto.id },
      data: {
        grau: 'tecnico',
        eixoTecnologico: 'Infraestrutura',
        codigoCnct: '132',
        certificacaoIntermediaria: true,
        perfilConclusao: 'Executa levantamentos topográficos e cadastrais, opera instrumentos de medição, '
          + 'processa dados e elabora plantas e memoriais sob supervisão de profissional habilitado.',
      },
    })
    log(`Curso técnico: eixo Infraestrutura, CNCT 132, perfil de conclusão e certificação intermediária`)
  }

  // ── T2: módulos com terminalidade ──
  const matrizPiloto = await prisma.acaMatriz.findFirst({
    where: { courseId: cursoPiloto?.id ?? 1 },
    include: { componentes: { orderBy: [{ fase: 'asc' }, { ordem: 'asc' }], select: { id: true, fase: true } } },
  })
  if (matrizPiloto && matrizPiloto.componentes.length >= 4) {
    const mod1 = await prisma.acaMatrizModulo.create({
      data: {
        matrizId: matrizPiloto.id, numero: 1, nome: 'Fundamentos de Agrimensura',
        tituloQualificacao: 'Auxiliar de Agrimensura', codigoCbo: '3123-05', cargaHoraria: 400,
        descricao: 'Etapa com terminalidade: quem conclui recebe certificado de qualificação.',
      },
    })
    const mod2 = await prisma.acaMatrizModulo.create({
      data: {
        matrizId: matrizPiloto.id, numero: 2, nome: 'Topografia e Georreferenciamento',
        tituloQualificacao: 'Auxiliar Técnico em Topografia', codigoCbo: '3123-05', cargaHoraria: 400,
      },
    })
    const mod3 = await prisma.acaMatrizModulo.create({
      data: { matrizId: matrizPiloto.id, numero: 3, nome: 'Projetos e Legislação' },
    })
    // Distribui os componentes: metade no módulo 1, o resto entre 2 e 3.
    const comps = matrizPiloto.componentes
    const corte1 = Math.ceil(comps.length / 3)
    const corte2 = corte1 * 2
    for (const [i, c] of comps.entries()) {
      const moduloId = i < corte1 ? mod1.id : i < corte2 ? mod2.id : mod3.id
      await prisma.acaComponente.update({ where: { id: c.id }, data: { moduloId } })
    }
    log(`Módulos: 3 (2 com terminalidade) · ${comps.length} componentes distribuídos`)

    // ── T3: capacidades e critérios em 2 componentes ──
    // Só nos primeiros: rubrica é trabalho pedagógico, e a demonstração precisa
    // mostrar tanto o componente modelado quanto o que ainda não foi.
    const RUBRICA = [
      {
        tipo: 'TECNICA' as const,
        descricao: 'Operar instrumentos de medição em levantamento planimétrico',
        criterios: [
          { descricao: 'Nivela e centra o equipamento sobre o ponto', evidencia: 'Bolha centrada e prumo sobre o marco', peso: 'CRITICO' as const },
          { descricao: 'Registra a caderneta sem erro de leitura', evidencia: 'Caderneta conferida pelo docente', peso: 'CRITICO' as const },
          { descricao: 'Conclui a medição no tempo previsto', peso: 'DESEJAVEL' as const },
        ],
      },
      {
        tipo: 'SOCIAL' as const,
        descricao: 'Trabalhar em equipe durante o levantamento de campo',
        criterios: [
          { descricao: 'Comunica leituras e comandos de forma clara', evidencia: 'Equipe executa sem repetição de medida', peso: 'CRITICO' as const },
          { descricao: 'Colabora na organização dos equipamentos', peso: 'DESEJAVEL' as const },
        ],
      },
      {
        tipo: 'ORGANIZATIVA' as const,
        descricao: 'Organizar o material e a documentação do serviço',
        criterios: [
          { descricao: 'Confere e devolve o equipamento em condição de uso', evidencia: 'Checklist de devolução assinado', peso: 'DESEJAVEL' as const },
        ],
      },
    ]
    const compsComRubrica = comps.slice(0, 2)
    let totalCriterios = 0
    const criteriosCriados: Array<{ id: number; peso: string }> = []
    for (const c of compsComRubrica) {
      for (const [i, cap] of RUBRICA.entries()) {
        const nova = await prisma.acaCapacidade.create({
          data: { componenteId: c.id, tipo: cap.tipo, descricao: cap.descricao, ordem: i },
        })
        for (const [j, k] of cap.criterios.entries()) {
          const criado = await prisma.acaCriterio.create({
            data: {
              capacidadeId: nova.id, descricao: k.descricao,
              evidencia: 'evidencia' in k ? (k as any).evidencia : null,
              peso: k.peso, ordem: j,
            },
          })
          if (c.id === compsComRubrica[0]!.id) criteriosCriados.push({ id: criado.id, peso: k.peso })
          totalCriterios++
        }
      }
    }
    log(`Capacidades: ${RUBRICA.length} por componente em 2 componentes · ${totalCriterios} critérios`)

    // Aferições: 3 alunos em estados diferentes — apto, em desenvolvimento e
    // sem nada. Painel com todos iguais não mostra para que a régua serve.
    const matriculasDemo = await prisma.acaMatricula.findMany({
      where: { alunoId: { in: alunos.slice(0, 3).map((a) => a.id) }, status: 'MATRICULADO' },
      select: { id: true },
      take: 3,
    })
    if (matriculasDemo.length >= 2 && criteriosCriados.length > 0) {
      // 1º aluno: atende tudo → apto, nível A.
      for (const k of criteriosCriados) {
        await prisma.acaAfericao.create({
          data: { criterioId: k.id, matriculaId: matriculasDemo[0]!.id, resultado: 'ATENDE', observacao: 'Demonstrou em campo.' },
        })
      }
      // 2º aluno: falha um CRÍTICO e atende o resto → 75% dos critérios e NÃO apto.
      const criticos = criteriosCriados.filter((k) => k.peso === 'CRITICO')
      for (const k of criteriosCriados) {
        const falha = criticos.length > 0 && k.id === criticos[0]!.id
        await prisma.acaAfericao.create({
          data: {
            criterioId: k.id, matriculaId: matriculasDemo[1]!.id,
            resultado: falha ? 'NAO_ATENDE' : 'ATENDE',
            observacao: falha ? 'Não centrou o equipamento sobre o marco — retomar na próxima situação.' : null,
          },
        })
      }
      log('Aferições: 1 aluno apto (nível A) e 1 com crítico pendente (mostra que média não decide)')
    }

    // ── T1: um aluno em "Integralizar em Fase Escolar" ──
    // O piloto não tem componente de estágio, então a situação é aplicada
    // diretamente para a tela de conformidade ter o que mostrar.
    const vinculoFase = await prisma.acaVinculo.findFirst({ where: { situacao: 'ATIVO' }, select: { id: true } })
    if (vinculoFase) {
      await prisma.acaVinculo.update({ where: { id: vinculoFase.id }, data: { situacao: 'INTEGRALIZANDO' } })
      await prisma.acaVinculoMovimentacao.create({
        data: {
          vinculoId: vinculoFase.id, de: 'ATIVO', para: 'INTEGRALIZANDO',
          motivo: 'Componentes curriculares cumpridos; pendente estágio supervisionado (demonstração).',
        },
      }).catch(() => {})
      log('Situação "Integralizar em Fase Escolar" aplicada a 1 vínculo (status do SISTEC)')
    }

    // ── T4: PPCP autorizado + processo de reconhecimento deferido ──
    const ppcp = await prisma.acaPpcp.create({
      data: {
        courseId: cursoPiloto?.id ?? 1,
        nome: `${TAG_MANTENEDORA}Certificação de saberes — Agrimensura`,
        metodologia: 'Análise de portfólio profissional, prova prática em campo e entrevista técnica com banca.',
        status: 'AUTORIZADO',
        atoAutorizacao: 'Parecer CEE nº 128/2025',
        orgaoAutorizador: 'Conselho Estadual de Educação',
        autorizadoEm: diasAtras(300),
        vigenciaAte: diasFrente(700),
      },
    })
    const alunoRec = alunos[3] ?? alunos[0]!
    const matRec = await prisma.acaMatricula.findFirst({ where: { alunoId: alunoRec.id }, select: { id: true } })
    if (matRec) {
      const proc = await prisma.acaCertificacaoProcesso.create({
        data: {
          ppcpId: ppcp.id, alunoId: alunoRec.id, matriculaId: matRec.id,
          protocolo: `CP-${new Date().getFullYear()}-9001`,
          status: 'DEFERIDO',
          itinerario: 'Sete anos como auxiliar em empresa de topografia; curso livre de AutoCAD (120h) sem certificação formal; '
            + 'atuação em levantamentos para regularização fundiária.',
          banca: 'Prof. Antônio Vieira (coordenação), Profa. Helena Marques (docente), Eng. Marcos Lima (mercado)',
          parecerFinal: 'Reconhecidas 2 unidades curriculares conforme PPCP autorizado.',
          decididoEm: diasAtras(20),
        },
      })
      let reconhecidos = 0
      for (const [i, c] of comps.slice(0, 2).entries()) {
        const compDet = await prisma.acaComponente.findUnique({
          where: { id: c.id }, select: { chTotal: true, disciplina: { select: { cargaHoraria: true } } },
        })
        const ch = compDet?.chTotal ?? compDet?.disciplina?.cargaHoraria ?? 0
        const aprov = await prisma.acaAproveitamento.create({
          data: {
            matriculaId: matRec.id, alunoId: alunoRec.id, componenteId: c.id,
            origem: 'SUFICIENCIA', cargaHorariaAproveitada: ch, status: 'DEFERIDO',
            parecer: `[DEMO-FASES] Reconhecimento de saberes — processo ${proc.protocolo}.`,
            decididoEm: diasAtras(20),
          },
        })
        await prisma.acaCertificacaoAvaliacao.create({
          data: {
            processoId: proc.id, componenteId: c.id,
            instrumento: i === 0 ? 'Demonstração em situação real de trabalho' : 'Análise de portfólio + entrevista técnica',
            resultado: 'RECONHECIDO',
            parecer: 'Demonstrou domínio das capacidades da unidade curricular.',
            avaliadorNome: 'Banca de certificação',
            aproveitamentoId: aprov.id,
          },
        })
        reconhecidos++
      }
      log(`Reconhecimento de saberes: PPCP autorizado + processo ${proc.protocolo} deferido (${reconhecidos} unidades)`)
    }

    // ── T2 na prática: alunos com o módulo 1 CONCLUÍDO ──
    //
    // Sem isto a fila de "certificados a emitir" fica vazia — e ela é o que a
    // escola técnica vende. Dois alunos completam o módulo 1 por aproveitamento:
    // um já com certificado emitido (aparece no histórico) e um na fila.
    const compsMod1 = comps.filter((_, i) => i < corte1)
    const candidatos = [alunos[4], alunos[5]].filter(Boolean).slice(0, 2)
    let naFila = 0
    for (const [idx, al] of candidatos.entries()) {
      const mat = await prisma.acaMatricula.findFirst({ where: { alunoId: al!.id }, select: { id: true } })
      const vinc = await prisma.acaVinculo.findFirst({ where: { alunoId: al!.id }, select: { id: true } })
      if (!mat || !vinc) continue
      for (const c of compsMod1) {
        const det = await prisma.acaComponente.findUnique({
          where: { id: c.id }, select: { chTotal: true, disciplina: { select: { cargaHoraria: true } } },
        })
        await prisma.acaAproveitamento.create({
          data: {
            matriculaId: mat.id, alunoId: al!.id, componenteId: c.id,
            origem: 'INTERNO', status: 'DEFERIDO',
            cargaHorariaAproveitada: det?.chTotal ?? det?.disciplina?.cargaHoraria ?? 0,
            parecer: '[DEMO-FASES] Módulo concluído — carga de demonstração.',
            decididoEm: diasAtras(40),
          },
        }).catch(() => {})
      }
      // O primeiro já recebeu o certificado; o segundo fica na fila, para a tela
      // mostrar os dois estados.
      if (idx === 0) {
        const { emitirCertificadoQualificacao } = await import('../src/services/acaQualificacao.js')
        await emitirCertificadoQualificacao(vinc.id, mod1.id, null).catch((e) => log(`  certificado não emitido: ${e?.message}`))
      } else {
        naFila++
      }
    }
    log(`Qualificação: ${candidatos.length} aluno(s) com o módulo 1 concluído — 1 certificado emitido, ${naFila} na fila`)
  }

  console.log('\nPronto. Para remover tudo: npx tsx scripts/demoAcaTeardown.ts')
}

// O teardown IMPORTA `cleanupFases` deste arquivo. Sem este guard, importar o
// módulo executaria main() e a limpeza terminaria re-semeando tudo — foi
// exatamente o que aconteceu na primeira execução do teste.
if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
}
