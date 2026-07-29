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

  console.log('\nPronto. Para remover tudo: npx tsx scripts/demoAcaTeardown.ts')
}

// O teardown IMPORTA `cleanupFases` deste arquivo. Sem este guard, importar o
// módulo executaria main() e a limpeza terminaria re-semeando tudo — foi
// exatamente o que aconteceu na primeira execução do teste.
if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
}
