// src/services/acaReconhecimento.ts
//
// Reconhecimento de saberes e competências (fase T4).
//
// LDB, art. 41: "O conhecimento adquirido na educação profissional e
// tecnológica, inclusive no trabalho, poderá ser objeto de avaliação,
// reconhecimento e certificação para prosseguimento ou conclusão de estudos."
//
// Res. CNE/CP 1/2021, art. 47:
//   §1º — a certificação abrange "o itinerário profissional e social do
//         estudante, que inclui estudos não formais e experiência no trabalho".
//   §2º — o processo formal "deve ser precedido de AUTORIZAÇÃO pelo respectivo
//         sistema de ensino", tendo como referência o PPCP.
//
// O §2º é a trava que costuma ser ignorada na prática: a escola não pode aplicar
// uma prova e dispensar o aluno. Aqui, sem PPCP autorizado e vigente, o processo
// não abre — e cada reconhecimento fica amarrado ao PPCP que o autorizou, que é
// o que se apresenta quando perguntarem sob qual amparo o aluno foi dispensado.

import { prisma } from '../lib/prisma.js'

export class PpcpInvalidoError extends Error {
  constructor(msg: string) { super(msg); this.name = 'PpcpInvalidoError' }
}

/**
 * Marca o PPCP com `vigente`/`vencido`.
 *
 * A regra vive aqui porque as telas de lista e de detalhe dependem dela para
 * habilitar a avaliação — tê-la só na listagem fazia o detalhe tratar projeto
 * válido como inválido.
 */
export function comVigencia<T extends { status: string; vigenciaAte: Date | null }>(ppcp: T) {
  const agora = Date.now()
  const vencido = !!ppcp.vigenciaAte && ppcp.vigenciaAte.getTime() < agora
  return { ...ppcp, vencido, vigente: ppcp.status === 'AUTORIZADO' && !vencido }
}

/**
 * Confere se o PPCP pode amparar um processo agora.
 *
 * Vigência expirada é tão impeditiva quanto ausência de autorização: a
 * autorização venceu, e reconhecer sob ela seria reconhecer sem amparo.
 */
export async function assegurarPpcpVigente(ppcpId: number) {
  const ppcp = await prisma.acaPpcp.findUnique({ where: { id: ppcpId } })
  if (!ppcp) throw new PpcpInvalidoError('PPCP não encontrado')
  if (ppcp.status !== 'AUTORIZADO') {
    throw new PpcpInvalidoError(
      `O PPCP "${ppcp.nome}" está ${ppcp.status.toLowerCase()}. O reconhecimento de saberes exige projeto `
      + 'AUTORIZADO pelo sistema de ensino (Res. CNE/CP 1/2021, art. 47, §2º).',
    )
  }
  if (ppcp.vigenciaAte && ppcp.vigenciaAte.getTime() < Date.now()) {
    throw new PpcpInvalidoError(
      `A autorização do PPCP "${ppcp.nome}" venceu em ${ppcp.vigenciaAte.toLocaleDateString('pt-BR')}. `
      + 'Renove antes de abrir novos processos.',
    )
  }
  return ppcp
}

async function proximoProtocolo(): Promise<string> {
  const ano = new Date().getFullYear()
  const ultimo = await prisma.acaCertificacaoProcesso.findFirst({
    where: { protocolo: { startsWith: `CP-${ano}-` } },
    orderBy: { protocolo: 'desc' },
    select: { protocolo: true },
  })
  const seq = ultimo ? Number(ultimo.protocolo.split('-')[2] ?? 0) + 1 : 1
  return `CP-${ano}-${String(seq).padStart(4, '0')}`
}

export async function abrirProcesso(params: {
  ppcpId: number
  alunoId: number
  matriculaId?: number | null
  itinerario?: string | null
  banca?: string | null
}) {
  await assegurarPpcpVigente(params.ppcpId)

  const aluno = await prisma.aluno.findUnique({ where: { id: params.alunoId }, select: { id: true } })
  if (!aluno) throw new Error('Aluno não encontrado')

  // Processo aberto do mesmo aluno no mesmo PPCP seria avaliação em duplicidade.
  const aberto = await prisma.acaCertificacaoProcesso.findFirst({
    where: { alunoId: params.alunoId, ppcpId: params.ppcpId, status: { in: ['ABERTO', 'EM_AVALIACAO'] } },
    select: { id: true, protocolo: true },
  })
  if (aberto) throw new Error(`Já existe processo em andamento para este aluno (${aberto.protocolo}).`)

  return prisma.acaCertificacaoProcesso.create({
    data: {
      ppcpId: params.ppcpId,
      alunoId: params.alunoId,
      matriculaId: params.matriculaId ?? null,
      protocolo: await proximoProtocolo(),
      itinerario: params.itinerario ?? null,
      banca: params.banca ?? null,
      status: 'ABERTO',
    },
  })
}

/**
 * Registra a avaliação de um componente.
 *
 * Reconhecer **gera o aproveitamento** na hora, com origem SUFICIENCIA — é assim
 * que a integralização passa a considerar o componente cumprido, sem precisar de
 * um segundo caminho de dispensa. O id do aproveitamento fica guardado para não
 * lançar duas vezes se a avaliação for revista.
 */
export async function avaliarComponente(params: {
  processoId: number
  componenteId: number
  instrumento: string
  resultado: 'RECONHECIDO' | 'NAO_RECONHECIDO'
  parecer?: string | null
  avaliadorNome?: string | null
  decididoPor?: number | null
}) {
  const processo = await prisma.acaCertificacaoProcesso.findUnique({
    where: { id: params.processoId },
    include: { ppcp: { select: { id: true, courseId: true, nome: true } } },
  })
  if (!processo) throw new Error('Processo não encontrado')
  if (processo.status === 'CANCELADO' || processo.status === 'INDEFERIDO') {
    throw new Error('Processo encerrado — reabra antes de avaliar.')
  }
  // Reconfere a vigência: o processo pode ter sido aberto antes de a autorização
  // vencer, e avaliar depois disso seria decidir sem amparo.
  await assegurarPpcpVigente(processo.ppcpId)

  const componente = await prisma.acaComponente.findUnique({
    where: { id: params.componenteId },
    select: { id: true, chTotal: true, matriz: { select: { courseId: true } }, disciplina: { select: { nome: true, cargaHoraria: true } } },
  })
  if (!componente) throw new Error('Componente não encontrado')
  // O PPCP é construído a partir do PPC de um curso; reconhecer componente de
  // outro curso escaparia do projeto autorizado.
  if (componente.matriz.courseId !== processo.ppcp.courseId) {
    throw new Error(`O componente não pertence ao curso do PPCP "${processo.ppcp.nome}".`)
  }
  if (!params.instrumento?.trim()) {
    throw new Error('Informe o instrumento de avaliação aplicado — reconhecer sem dizer como se avaliou não sustenta auditoria.')
  }

  const existente = await prisma.acaCertificacaoAvaliacao.findUnique({
    where: { processoId_componenteId: { processoId: params.processoId, componenteId: params.componenteId } },
  })

  let aproveitamentoId: number | null = existente?.aproveitamentoId ?? null

  if (params.resultado === 'RECONHECIDO' && !aproveitamentoId) {
    if (!processo.matriculaId) {
      throw new Error('O processo precisa de uma matrícula vinculada para lançar o aproveitamento.')
    }
    const ch = componente.chTotal ?? componente.disciplina?.cargaHoraria ?? 0
    const aprov = await prisma.acaAproveitamento.create({
      data: {
        matriculaId: processo.matriculaId,
        alunoId: processo.alunoId,
        componenteId: params.componenteId,
        origem: 'SUFICIENCIA',
        cargaHorariaAproveitada: ch,
        status: 'DEFERIDO',
        parecer: `Reconhecimento de saberes — processo ${processo.protocolo}, PPCP "${processo.ppcp.nome}". `
          + `Instrumento: ${params.instrumento}.${params.parecer ? ` ${params.parecer}` : ''}`,
        decididoPorUserId: params.decididoPor ?? null,
        decididoEm: new Date(),
      },
    })
    aproveitamentoId = aprov.id
  }

  // Deixou de ser reconhecido: o aproveitamento precisa cair, senão a
  // integralização segue contando um componente que a banca recusou.
  if (params.resultado === 'NAO_RECONHECIDO' && aproveitamentoId) {
    await prisma.acaAproveitamento.delete({ where: { id: aproveitamentoId } }).catch(() => {})
    aproveitamentoId = null
  }

  const dados = {
    instrumento: String(params.instrumento).substring(0, 191),
    resultado: params.resultado,
    parecer: params.parecer ?? null,
    avaliadorNome: params.avaliadorNome ?? null,
    avaliadoEm: new Date(),
    aproveitamentoId,
  }

  const avaliacao = existente
    ? await prisma.acaCertificacaoAvaliacao.update({ where: { id: existente.id }, data: dados })
    : await prisma.acaCertificacaoAvaliacao.create({
        data: { processoId: params.processoId, componenteId: params.componenteId, ...dados },
      })

  if (processo.status === 'ABERTO') {
    await prisma.acaCertificacaoProcesso.update({ where: { id: processo.id }, data: { status: 'EM_AVALIACAO' } })
  }
  return avaliacao
}

export interface ResumoProcesso {
  processo: any
  ppcp: any
  reconhecidos: number
  naoReconhecidos: number
  cargaHorariaReconhecida: number
  avaliacoes: Array<{
    id: number
    componenteId: number
    componente: string
    instrumento: string
    resultado: string
    parecer: string | null
    cargaHoraria: number
    aproveitamentoId: number | null
  }>
}

export async function resumoProcesso(processoId: number): Promise<ResumoProcesso | null> {
  const processo = await prisma.acaCertificacaoProcesso.findUnique({
    where: { id: processoId },
    include: { ppcp: true, avaliacoes: true },
  })
  if (!processo) return null

  const compIds = processo.avaliacoes.map((a) => a.componenteId)
  const comps = compIds.length
    ? await prisma.acaComponente.findMany({
        where: { id: { in: compIds } },
        select: { id: true, chTotal: true, disciplina: { select: { nome: true, cargaHoraria: true } } },
      })
    : []
  const mapa = new Map(comps.map((c) => [c.id, c]))

  const avaliacoes = processo.avaliacoes.map((a) => {
    const c = mapa.get(a.componenteId)
    return {
      id: a.id,
      componenteId: a.componenteId,
      componente: c?.disciplina?.nome ?? `Componente #${a.componenteId}`,
      instrumento: a.instrumento,
      resultado: String(a.resultado),
      parecer: a.parecer,
      cargaHoraria: c?.chTotal ?? c?.disciplina?.cargaHoraria ?? 0,
      aproveitamentoId: a.aproveitamentoId,
    }
  })

  const reconhecidas = avaliacoes.filter((a) => a.resultado === 'RECONHECIDO')
  return {
    processo,
    ppcp: comVigencia(processo.ppcp),
    reconhecidos: reconhecidas.length,
    naoReconhecidos: avaliacoes.length - reconhecidas.length,
    cargaHorariaReconhecida: reconhecidas.reduce((s, a) => s + a.cargaHoraria, 0),
    avaliacoes,
  }
}

/** Fecha o processo com parecer final. */
export async function decidirProcesso(params: {
  processoId: number
  status: 'DEFERIDO' | 'INDEFERIDO' | 'CANCELADO'
  parecerFinal?: string | null
  decididoPor?: number | null
}) {
  const processo = await prisma.acaCertificacaoProcesso.findUnique({
    where: { id: params.processoId },
    include: { avaliacoes: true },
  })
  if (!processo) throw new Error('Processo não encontrado')

  if (params.status === 'DEFERIDO' && processo.avaliacoes.length === 0) {
    throw new Error('Não há avaliação registrada — deferir aqui seria reconhecer sem avaliar.')
  }

  // Indeferir ou cancelar depois de ter reconhecido algo deixaria aproveitamento
  // órfão sustentando integralização de um processo negado.
  if (params.status !== 'DEFERIDO') {
    const comAproveitamento = processo.avaliacoes.filter((a) => a.aproveitamentoId)
    for (const a of comAproveitamento) {
      await prisma.acaAproveitamento.delete({ where: { id: a.aproveitamentoId! } }).catch(() => {})
      await prisma.acaCertificacaoAvaliacao.update({ where: { id: a.id }, data: { aproveitamentoId: null } })
    }
  }

  return prisma.acaCertificacaoProcesso.update({
    where: { id: params.processoId },
    data: {
      status: params.status,
      parecerFinal: params.parecerFinal ?? null,
      decididoPor: params.decididoPor ?? null,
      decididoEm: new Date(),
    },
  })
}
