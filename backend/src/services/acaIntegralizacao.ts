// src/services/acaIntegralizacao.ts
//
// Motor de integralização: responde "o que falta para este aluno se formar?".
//
// O Documento Mestre (RF-504 / RN-503) exige que isto seja um serviço puro e
// determinístico, porque cinco lugares diferentes precisam da MESMA resposta:
// portal do aluno, plano de estudos do coordenador, apuração de formandos,
// trava da colação de grau e planejamento de oferta por demanda. Se cada tela
// calculasse do seu jeito, a secretaria e o aluno veriam números diferentes —
// e o errado só apareceria na formatura.
//
// O cálculo é feito SEMPRE contra a matriz do vínculo (RN-004), nunca contra o
// curso genérico: dois alunos do mesmo curso em matrizes diferentes têm
// exigências diferentes, e é isso que o histórico precisa refletir.

import { prisma } from '../lib/prisma.js'
import type { AcaComponenteTipo } from '@prisma/client'
import { resolverEsquema } from './acaAvaliacao.js'

/** Situação de um componente na jornada do aluno. */
export type StatusComponente =
  | 'CUMPRIDO'      // aprovado com nota/frequência
  | 'APROVEITADO'   // dispensado por aproveitamento de estudos
  | 'EM_CURSO'      // matriculado no período corrente
  | 'REPROVADO'     // cursou e não passou — volta a ser pendente
  | 'PENDENTE'      // nunca cursou
  | 'BLOQUEADO'     // pendente e com pré-requisito não cumprido

export interface ComponenteIntegralizacao {
  componenteId: number
  disciplinaId: number
  nome: string
  codigo: string | null
  fase: number
  tipo: AcaComponenteTipo
  cargaHoraria: number
  status: StatusComponente
  /** Nomes dos pré-requisitos que faltam (só quando BLOQUEADO). */
  bloqueadoPor?: string[]
  /** Nota final registrada, quando houver. */
  media?: number | null
}

export interface BaldeCH {
  tipo: AcaComponenteTipo
  exigido: number | null
  cumprido: number
  emCurso: number
  pendente: number
  percentual: number | null
}

export interface Integralizacao {
  vinculoId: number
  matrizId: number | null
  situacao: string
  /** Sem matriz não há o que integralizar — a UI precisa saber disso. */
  semMatriz: boolean
  chTotalMatriz: number
  chCumprida: number
  chEmCurso: number
  percentual: number
  componentes: ComponenteIntegralizacao[]
  baldes: BaldeCH[]
  /** Componentes que o aluno pode cursar agora (pendentes e desbloqueados). */
  disponiveis: number
  /** Verdadeiro quando não falta nada — é o que a esteira de diplomação exige. */
  concluido: boolean
  /**
   * Cumpriu as disciplinas e falta APENAS estágio, TCC ou atividade
   * complementar. É o "Integralizar em Fase Escolar" do SISTEC, e o estado em
   * que a escola técnica tem mais aluno pendurado.
   */
  integralizandoEmFaseEscolar: boolean
  /** O que falta nesse caso — texto para a secretaria cobrar. */
  pendenciasDeFase: string[] 

  /**
   * Regime seriado: disciplinas reprovadas que o aluno arrasta de períodos
   * anteriores. Em regime de crédito o número existe, mas não trava nada.
   */
  dependencias: number
  nomesDependencias: string[]
  /** Teto do regimento (esquema de avaliação); null = sem limite declarado. */
  limiteDependencias: number | null
  /** Falso quando o aluno excede o teto — a matrícula no período seguinte para. */
  podeProgredir: boolean
  motivoProgressao: string | null
}

/**
 * Situações finais que contam como cumprido. `AcaResultado.situacao` usa
 * APROVADO | RECUPERACAO | REPROVADO_NOTA | REPROVADO_FREQUENCIA.
 */
const SITUACOES_APROVADO = new Set(['APROVADO'])
const SITUACOES_REPROVADO = new Set(['REPROVADO_NOTA', 'REPROVADO_FREQUENCIA', 'REPROVADO'])

/**
 * Calcula a integralização de um vínculo. Função pura no sentido que importa:
 * mesma entrada no banco → mesma saída, sem efeito colateral.
 */
export async function calcular(vinculoId: number): Promise<Integralizacao> {
  const vinculo = await prisma.acaVinculo.findUnique({
    where: { id: vinculoId },
    select: { id: true, matrizId: true, alunoId: true, situacao: true, courseId: true },
  })
  if (!vinculo) throw new Error(`Vínculo ${vinculoId} não encontrado`)

  const base: Integralizacao = {
    vinculoId, matrizId: vinculo.matrizId, situacao: vinculo.situacao,
    semMatriz: !vinculo.matrizId,
    chTotalMatriz: 0, chCumprida: 0, chEmCurso: 0, percentual: 0,
    componentes: [], baldes: [], disponiveis: 0, concluido: false,
    integralizandoEmFaseEscolar: false, pendenciasDeFase: [],
    dependencias: 0, nomesDependencias: [], limiteDependencias: null,
    podeProgredir: true, motivoProgressao: null,
  }
  const cursoDoVinculo = vinculo.courseId
  if (!vinculo.matrizId) return base

  // AcaResultado guarda só `matriculaId` escalar (sem relação declarada), então
  // o filtro precisa dos ids das matrículas deste vínculo.
  const matriculasDoVinculo = await prisma.acaMatricula.findMany({ where: { vinculoId }, select: { id: true } })
  const idsMatricula = matriculasDoVinculo.map((m) => m.id)

  const [matriz, resultados, aproveitamentos, preReqs] = await Promise.all([
    prisma.acaMatriz.findUnique({
      where: { id: vinculo.matrizId },
      include: {
        componentes: {
          include: { disciplina: { select: { id: true, nome: true, codigo: true, cargaHoraria: true } } },
          orderBy: [{ fase: 'asc' }, { ordem: 'asc' }],
        },
      },
    }),
    // Resultados do aluno: o vínculo dá as matrículas, a matrícula dá o diário,
    // e o diário aponta a turma/disciplina cursada.
    idsMatricula.length
      ? prisma.acaResultado.findMany({
          where: { matriculaId: { in: idsMatricula } },
          select: { matriculaId: true, diarioId: true, situacao: true, mediaFinal: true },
        })
      : Promise.resolve([] as Array<{ matriculaId: number; diarioId: number; situacao: string; mediaFinal: number | null }>),
    prisma.acaAproveitamento.findMany({
      where: { alunoId: vinculo.alunoId },
      select: { componenteId: true },
    }).catch(() => [] as Array<{ componenteId: number }>),
    prisma.acaPreRequisito.findMany({ select: { componenteId: true, componenteRequeridoId: true } }),
  ])
  if (!matriz) return base

  // Disciplina cursada → melhor situação obtida. O diário conhece a turma, e a
  // turma conhece a disciplina; sem isso não dá para casar resultado↔componente.
  const diarioIds = [...new Set(resultados.map((r) => r.diarioId))]
  const diarios = diarioIds.length
    ? await prisma.acaDiario.findMany({ where: { id: { in: diarioIds } }, select: { id: true, disciplinaId: true } }).catch(() => [])
    : []
  const disciplinaPorDiario = new Map(diarios.map((d: any) => [d.id, d.disciplinaId as number]))

  const porDisciplina = new Map<number, { aprovado: boolean; reprovado: boolean; media: number | null }>()
  for (const r of resultados) {
    const discId = disciplinaPorDiario.get(r.diarioId)
    if (!discId) continue
    const atual = porDisciplina.get(discId) ?? { aprovado: false, reprovado: false, media: null }
    if (SITUACOES_APROVADO.has(r.situacao)) atual.aprovado = true
    if (SITUACOES_REPROVADO.has(r.situacao)) atual.reprovado = true
    if (r.mediaFinal != null && (atual.media == null || r.mediaFinal > atual.media)) atual.media = r.mediaFinal
    porDisciplina.set(discId, atual)
  }

  // Matrículas em turma sem resultado ainda = está cursando agora.
  const matriculas = await prisma.acaMatricula.findMany({
    where: { vinculoId, status: 'MATRICULADO' },
    select: { id: true, turma: { select: { matrizId: true } } },
  })
  const emCursoMatriculaIds = new Set(matriculas.map((m) => m.id))
  const comResultado = new Set(resultados.map((r) => r.matriculaId))
  const cursandoAgora = [...emCursoMatriculaIds].filter((id) => !comResultado.has(id)).length > 0

  const aproveitados = new Set(aproveitamentos.map((a) => a.componenteId))

  // Pré-requisitos: componente → requisitos.
  const reqsPor = new Map<number, number[]>()
  for (const p of preReqs) {
    reqsPor.set(p.componenteId, [...(reqsPor.get(p.componenteId) ?? []), p.componenteRequeridoId])
  }

  // 1ª passada: status individual de cada componente.
  const nomePorComponente = new Map<number, string>()
  const cumpridoPorComponente = new Map<number, boolean>()
  const componentes: ComponenteIntegralizacao[] = matriz.componentes.map((c) => {
    const ch = c.chTotal ?? c.disciplina?.cargaHoraria ?? 0
    const hist = c.disciplinaId ? porDisciplina.get(c.disciplinaId) : undefined
    let status: StatusComponente = 'PENDENTE'
    if (aproveitados.has(c.id)) status = 'APROVEITADO'
    else if (hist?.aprovado) status = 'CUMPRIDO'
    else if (hist?.reprovado) status = 'REPROVADO'

    nomePorComponente.set(c.id, c.disciplina?.nome ?? `#${c.id}`)
    cumpridoPorComponente.set(c.id, status === 'CUMPRIDO' || status === 'APROVEITADO')

    return {
      componenteId: c.id,
      disciplinaId: c.disciplinaId,
      nome: c.disciplina?.nome ?? `Componente #${c.id}`,
      codigo: c.disciplina?.codigo ?? null,
      fase: c.fase,
      tipo: c.tipo,
      cargaHoraria: ch,
      status,
      media: hist?.media ?? null,
    }
  })

  // 2ª passada: o que está pendente e travado por pré-requisito não cumprido.
  for (const comp of componentes) {
    if (comp.status !== 'PENDENTE' && comp.status !== 'REPROVADO') continue
    const faltando = (reqsPor.get(comp.componenteId) ?? [])
      .filter((reqId) => !cumpridoPorComponente.get(reqId))
      .map((reqId) => nomePorComponente.get(reqId) ?? `#${reqId}`)
    if (faltando.length > 0) {
      comp.status = 'BLOQUEADO'
      comp.bloqueadoPor = faltando
    }
  }

  // Marca "em curso" quando há matrícula ativa sem resultado: sem vínculo
  // direto componente↔matrícula, o sinal é por disciplina da turma.
  if (cursandoAgora) {
    const turmasAtivas = await prisma.acaMatricula.findMany({
      where: { vinculoId, status: 'MATRICULADO', id: { notIn: [...comResultado] } },
      select: { turma: { select: { id: true } } },
    })
    const diariosAtivos = turmasAtivas.length
      ? await prisma.acaDiario.findMany({
          where: { turmaId: { in: turmasAtivas.map((t) => t.turma?.id).filter((x): x is number => !!x) } },
          select: { disciplinaId: true },
        }).catch(() => [])
      : []
    const emCurso = new Set(diariosAtivos.map((d: any) => d.disciplinaId as number))
    for (const comp of componentes) {
      if (emCurso.has(comp.disciplinaId) && (comp.status === 'PENDENTE' || comp.status === 'BLOQUEADO' || comp.status === 'REPROVADO')) {
        comp.status = 'EM_CURSO'
        delete comp.bloqueadoPor
      }
    }
  }

  // Consolidação por balde de CH — é assim que o PPC declara a exigência.
  const exigidoPorTipo: Partial<Record<AcaComponenteTipo, number | null>> = {
    OBRIGATORIA: matriz.chObrigatoria, ELETIVA: matriz.chEletiva, OPTATIVA: matriz.chOptativa,
    ESTAGIO: matriz.chEstagio, TCC: matriz.chTcc, ATIVIDADE_COMPLEMENTAR: matriz.chComplementar,
    EXTENSAO: matriz.chExtensao,
  }
  const tipos = [...new Set(componentes.map((c) => c.tipo))]
  const baldes: BaldeCH[] = tipos.map((tipo) => {
    const doTipo = componentes.filter((c) => c.tipo === tipo)
    const cumprido = doTipo.filter((c) => c.status === 'CUMPRIDO' || c.status === 'APROVEITADO').reduce((s, c) => s + c.cargaHoraria, 0)
    const emCurso = doTipo.filter((c) => c.status === 'EM_CURSO').reduce((s, c) => s + c.cargaHoraria, 0)
    const pendente = doTipo.filter((c) => c.status === 'PENDENTE' || c.status === 'BLOQUEADO' || c.status === 'REPROVADO').reduce((s, c) => s + c.cargaHoraria, 0)
    // Quando o PPC não declara o exigido, a referência é a soma da matriz.
    const exigido = exigidoPorTipo[tipo] ?? (cumprido + emCurso + pendente)
    return {
      tipo, exigido,
      cumprido, emCurso, pendente,
      percentual: exigido ? Math.min(100, Math.round((cumprido / exigido) * 100)) : null,
    }
  })

  const chTotalMatriz = componentes.reduce((s, c) => s + c.cargaHoraria, 0)
  const chCumprida = componentes.filter((c) => c.status === 'CUMPRIDO' || c.status === 'APROVEITADO').reduce((s, c) => s + c.cargaHoraria, 0)
  const chEmCurso = componentes.filter((c) => c.status === 'EM_CURSO').reduce((s, c) => s + c.cargaHoraria, 0)

  // "Integralizar em fase escolar": tudo que é aula está cumprido e o que resta
  // é só estágio, TCC ou atividade complementar. A distinção importa porque o
  // SISTEC tem status próprio para isso, e porque a cobrança é outra — não é
  // matricular em disciplina, é cobrar entrega.
  const TIPOS_DE_FASE = new Set<AcaComponenteTipo>(['ESTAGIO', 'TCC', 'ATIVIDADE_COMPLEMENTAR'] as AcaComponenteTipo[])
  const cumprido = (c: ComponenteIntegralizacao) => c.status === 'CUMPRIDO' || c.status === 'APROVEITADO'
  const pendentes = componentes.filter((c) => !cumprido(c))
  const emFaseEscolar = chTotalMatriz > 0
    && pendentes.length > 0
    && pendentes.every((c) => TIPOS_DE_FASE.has(c.tipo))
  const pendenciasFase = emFaseEscolar ? pendentes.map((c) => c.nome) : []

  // Dependência é a disciplina que o aluno CURSOU e não passou — não a que
  // nunca cursou. Confundir as duas faria todo calouro estourar o limite.
  const reprovados = componentes.filter((c) => c.status === 'REPROVADO')
  const esquema = await resolverEsquema({
    matrizId: vinculo.matrizId,
    ...(cursoDoVinculo ? { courseId: cursoDoVinculo } : {}),
  })
  const limite = esquema?.limiteDependencias ?? null
  const excede = limite != null && reprovados.length > limite

  return {
    vinculoId, matrizId: vinculo.matrizId, situacao: vinculo.situacao, semMatriz: false,
    chTotalMatriz, chCumprida, chEmCurso,
    percentual: chTotalMatriz ? Math.round((chCumprida / chTotalMatriz) * 100) : 0,
    componentes, baldes,
    disponiveis: componentes.filter((c) => c.status === 'PENDENTE').length,
    concluido: chTotalMatriz > 0 && componentes.every((c) => c.status === 'CUMPRIDO' || c.status === 'APROVEITADO'),
    integralizandoEmFaseEscolar: emFaseEscolar,
    pendenciasDeFase: pendenciasFase,
    dependencias: reprovados.length,
    nomesDependencias: reprovados.map((c) => c.nome),
    limiteDependencias: limite,
    podeProgredir: !excede,
    motivoProgressao: excede
      ? `${reprovados.length} dependência(s) — o regimento admite no máximo ${limite} para progredir de período.`
      : null,
  }
}

/**
 * Prováveis formandos de um curso: quem já integralizou tudo mas ainda não
 * consta como formado. Alimenta a esteira de diplomação (M11).
 */
export async function provaveisFormandos(courseId?: number): Promise<Array<{ vinculoId: number; alunoId: number; nome: string; percentual: number }>> {
  const vinculos = await prisma.acaVinculo.findMany({
    where: { situacao: 'ATIVO', ...(courseId ? { courseId } : {}), matrizId: { not: null } },
    select: { id: true, alunoId: true, aluno: { select: { lead: { select: { nome: true } } } } },
  })
  const out: Array<{ vinculoId: number; alunoId: number; nome: string; percentual: number }> = []
  for (const v of vinculos) {
    const r = await calcular(v.id)
    if (r.concluido) {
      out.push({ vinculoId: v.id, alunoId: v.alunoId, nome: v.aluno?.lead?.nome ?? `Aluno #${v.alunoId}`, percentual: r.percentual })
    }
  }
  return out
}
