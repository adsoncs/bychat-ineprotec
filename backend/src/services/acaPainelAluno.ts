// src/services/acaPainelAluno.ts
//
// Monta o painel do aluno numa resposta só: situação, o que falta, financeiro,
// contrato, documentos e boletim.
//
// O portal antigo mostrava tabelas separadas e deixava a conclusão por conta do
// aluno — que ligava para a secretaria perguntando "e agora?". Aqui a pergunta
// "o que falta para eu estar matriculado?" é respondida pelo próprio sistema,
// porque ele tem todos os dados para responder.

import { prisma } from '../lib/prisma.js'
import { boletimAluno, financeiroAluno } from '../routes/acaPortal.js'
import { statusBloqueio } from './acaBloqueio.js'
import { contratoAtivoDoAluno, dadosContrato } from './acaContrato.js'
// As quatro seções que existiam só no portal SSR do ERP. As funções já estavam
// prontas — o painel da aplicação é que não as consultava, e por isso o aluno
// via menos aqui do que no portal antigo.
import { gradeDoAluno } from '../routes/acaHorario.js'
import { materiaisDoAluno } from '../routes/acaMaterial.js'
import { resumoHoras } from '../routes/acaEstagio.js'
import { proximosEventosDoAluno } from '../routes/acaCalendario.js'
import { ofertasAbertas } from './acaRematricula.js'

export interface Passo {
  chave: string
  titulo: string
  detalhe: string
  situacao: 'feito' | 'pendente' | 'travado'
  acao?: { rotulo: string; href: string } | null
}

const reais = (centavos: number) =>
  (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export async function painelDoAluno(alunoId: number) {
  const aluno = await prisma.aluno.findUnique({
    where: { id: alunoId },
    select: { id: true, ra: true, cpf: true, fotoUrl: true, lead: { select: { id: true, nome: true, email: true, whatsapp: true } } },
  })
  if (!aluno) return null

  const matriculas = await prisma.acaMatricula.findMany({
    where: { alunoId },
    orderBy: { id: 'desc' },
    select: {
      id: true, status: true, listaEspera: true, dataMatricula: true,
      turma: { select: { nome: true, periodoLetivo: { select: { codigo: true, descricao: true } } } },
      vinculo: { select: { situacao: true, courseId: true } },
    },
  })
  const matricula = matriculas[0] ?? null

  const [parcelas, bloqueio, boletim] = await Promise.all([
    financeiroAluno(alunoId),
    statusBloqueio(alunoId),
    boletimAluno(alunoId).catch(() => []),
  ])

  // Requerimentos e rematrícula existiam só no portal antigo — quem entrava
  // pela tela nova precisava voltar para a antiga para pedir uma declaração.
  const [tiposDeRequerimento, requerimentos, ofertasParaRematricula] = await Promise.all([
    prisma.acaRequerimentoTipo.findMany({
      where: { ativo: true }, orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
      select: { id: true, nome: true, descricao: true, slaDias: true, custoCentavos: true },
    }).catch(() => []),
    prisma.acaRequerimento.findMany({
      where: { alunoId }, orderBy: { createdAt: 'desc' }, take: 20,
      select: { id: true, protocolo: true, tipoNome: true, assunto: true, status: true, resposta: true, prazoEm: true, createdAt: true },
    }).catch(() => []),
    ofertasAbertas(alunoId).catch(() => []),
  ])

  const [grade, materiais, horas, eventos] = await Promise.all([
    gradeDoAluno(alunoId).catch(() => []),
    materiaisDoAluno(alunoId).catch(() => []),
    resumoHoras(alunoId).catch(() => null),
    proximosEventosDoAluno(alunoId).catch(() => []),
  ])

  const contratoId = await contratoAtivoDoAluno(alunoId).catch(() => null)
  const contrato = contratoId ? await dadosContrato(contratoId).catch(() => null) : null

  // Assinatura eletrônica (Autentique) da matrícula corrente, se houver.
  const envelope = matricula
    ? await prisma.acaAssinatura.findFirst({
        where: { matriculaId: matricula.id },
        orderBy: { id: 'desc' },
        select: { id: true, status: true, titulo: true, enviadoEm: true, finalizadoEm: true, signatarios: { select: { status: true, linkAssinatura: true } } },
      })
    : null

  // Documentos da inscrição — é o que a secretaria confere antes de efetivar.
  const inscricao = await prisma.enrollmentRegistration.findFirst({
    where: { leadId: aluno.lead.id },
    orderBy: { id: 'desc' },
    select: {
      id: true, candidateCode: true, status: true,
      portal: { select: { brandPrimaryColor: true, nome: true } },
      documents: { select: { status: true, label: true } },
      processRegistration: {
        select: {
          selectionProcess: {
            select: {
              useCustomDocuments: true,
              documentRequirements: { select: { required: true } },
              entryMode: { select: { documentRequirements: { select: { required: true } } } },
            },
          },
        },
      },
    },
  })

  const sp = inscricao?.processRegistration?.selectionProcess as any
  const exigidos: Array<{ required: boolean }> = sp
    ? (sp.useCustomDocuments && sp.documentRequirements?.length ? sp.documentRequirements : (sp.entryMode?.documentRequirements ?? []))
    : []
  const obrigatorios = exigidos.filter((e) => e.required).length
  const docsOk = (inscricao?.documents ?? []).filter((d) => d.status === 'approved').length
  const docsEmAnalise = (inscricao?.documents ?? []).filter((d) => d.status === 'pending').length
  const docsRecusados = (inscricao?.documents ?? []).filter((d) => d.status === 'rejected').length

  // ── Financeiro ──
  const hoje = new Date()
  const abertas = parcelas.filter((p: any) => p.situacao === 'ABERTA')
  const vencidas = abertas.filter((p: any) => new Date(p.dataVencimento) < hoje)
  const proxima = abertas
    .filter((p: any) => new Date(p.dataVencimento) >= hoje)
    .sort((a: any, b: any) => +new Date(a.dataVencimento) - +new Date(b.dataVencimento))[0] ?? null
  const totalAberto = abertas.reduce((s: number, p: any) => s + (p.valorBrutoCentavos ?? 0), 0)

  // ── O que falta, em ordem ──
  const passos: Passo[] = []

  if (inscricao) {
    passos.push({
      chave: 'inscricao',
      titulo: 'Inscrição enviada',
      detalhe: `Código ${inscricao.candidateCode}`,
      situacao: 'feito',
    })
  }

  if (obrigatorios > 0) {
    const completo = docsOk >= obrigatorios
    passos.push({
      chave: 'documentos',
      titulo: 'Documentos',
      detalhe: docsRecusados > 0
        ? `${docsRecusados} documento(s) recusado(s) — reenvie para seguir`
        : completo
          ? `${docsOk} de ${obrigatorios} aprovados`
          : docsEmAnalise > 0
            ? `${docsEmAnalise} em análise · ${docsOk} de ${obrigatorios} aprovados`
            : `${docsOk} de ${obrigatorios} enviados`,
      situacao: completo && docsRecusados === 0 ? 'feito' : 'pendente',
      acao: completo && docsRecusados === 0 ? null : { rotulo: 'Enviar documentos', href: '/portal/documentos' },
    })
  }

  if (contrato || envelope) {
    const assinado = envelope?.status === 'ASSINADO' || !!contrato?.aceiteEm
    passos.push({
      chave: 'contrato',
      titulo: 'Contrato',
      detalhe: assinado
        ? `Assinado${contrato?.aceiteEm ? ' em ' + new Date(contrato.aceiteEm).toLocaleDateString('pt-BR') : ''}`
        : 'Falta a sua assinatura',
      // Deixou de ser 'travado': o contrato existe e pode ser assinado aqui
      // mesmo. Antes dependia de a secretaria enviar um envelope, e o botão
      // levava ao provedor externo — no modo simulado, a um domínio inexistente.
      situacao: assinado ? 'feito' : 'pendente',
      acao: assinado ? null : { rotulo: 'Ler e assinar', href: '/portal/contrato' },
    })
  }

  if (parcelas.length) {
    passos.push({
      chave: 'financeiro',
      titulo: 'Pagamento',
      detalhe: vencidas.length
        ? `${vencidas.length} parcela(s) vencida(s) — ${reais(vencidas.reduce((s: number, p: any) => s + p.valorBrutoCentavos, 0))}`
        : proxima
          ? `Próxima em ${new Date(proxima.dataVencimento).toLocaleDateString('pt-BR')} — ${reais(proxima.valorBrutoCentavos)}`
          : 'Sem parcelas em aberto',
      situacao: vencidas.length ? 'pendente' : 'feito',
      acao: abertas.length ? { rotulo: 'Ver parcelas', href: '#financeiro' } : null,
    })
  }

  if (matricula) {
    const efetivada = matricula.status === 'MATRICULADO'
    passos.push({
      chave: 'matricula',
      titulo: 'Matrícula',
      detalhe: matricula.listaEspera
        ? 'Em lista de espera — avisamos assim que abrir vaga'
        : efetivada
          ? `Matriculado em ${matricula.turma.nome}`
          : `Situação: ${matricula.status.toLowerCase()}`,
      situacao: efetivada ? 'feito' : 'pendente',
    })
  }

  return {
    aluno: {
      id: aluno.id,
      nome: aluno.lead.nome,
      ra: aluno.ra,
      email: aluno.lead.email,
      whatsapp: aluno.lead.whatsapp,
      fotoUrl: aluno.fotoUrl,
    },
    matricula: matricula && {
      id: matricula.id,
      status: matricula.status,
      listaEspera: matricula.listaEspera,
      turma: matricula.turma.nome,
      periodo: matricula.turma.periodoLetivo?.codigo ?? null,
      situacaoVinculo: matricula.vinculo?.situacao ?? null,
    },
    passos,
    bloqueio,
    financeiro: {
      totalAbertoCentavos: totalAberto,
      vencidas: vencidas.length,
      parcelas: parcelas.map((p: any) => ({
        id: p.id,
        numero: p.nroParcela,
        tipo: p.tipo,
        valorCentavos: p.valorBrutoCentavos,
        vencimento: p.dataVencimento,
        situacao: p.situacao,
        pagoEm: p.pagoEm ?? null,
        linhaDigitavel: p.linhaDigitavel ?? null,
        pix: p.pixCopiaCola ?? null,
        temCobranca: !!p.asaasChargeId,
      })),
    },
    contrato: contrato && {
      aceiteEm: contrato.aceiteEm ?? null,
      termo: contrato.termo ?? null,
    },
    assinatura: envelope && {
      status: envelope.status,
      titulo: envelope.titulo,
      link: envelope.signatarios?.find((s) => s.linkAssinatura)?.linkAssinatura ?? null,
    },
    // Sem isto o aluno sai do portal com a cor da instituição e cai numa tela
    // com a cor padrão do sistema.
    marca: inscricao?.portal?.brandPrimaryColor ?? null,
    instituicao: inscricao?.portal?.nome ?? null,
    documentos: {
      obrigatorios,
      aprovados: docsOk,
      emAnalise: docsEmAnalise,
      recusados: docsRecusados,
    },
    boletim,
    // Vida acadêmica — o que o portal SSR mostrava e a aplicação não tinha.
    grade,
    materiais,
    horas,
    eventos,
    requerimentos: {
      tipos: tiposDeRequerimento,
      abertos: requerimentos.filter((r) => r.status !== 'DEFERIDO' && r.status !== 'INDEFERIDO').length,
      lista: requerimentos,
    },
    rematricula: {
      // Só oferece rematrícula quando há oferta aberta para este aluno.
      disponivel: Array.isArray(ofertasParaRematricula) && ofertasParaRematricula.length > 0,
      ofertas: ofertasParaRematricula,
    },
  }
}
