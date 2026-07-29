// src/services/acaCompetencia.ts
//
// Avaliação por competências (fase T3), no modelo da Metodologia SENAI.
//
// A diferença que importa em relação à graduação: aqui **a média não decide**.
// A unidade curricular desenvolve capacidades; o aluno demonstra domínio delas
// contra critérios de avaliação; e os critérios se dividem em CRÍTICOS e
// DESEJÁVEIS. Não atender um crítico significa não estar apto, ainda que todo o
// resto esteja bom — porque o crítico é o que caracteriza a competência.
//
// A tradução para conceito/nota existe (o SENAI publica a tabela e cada
// Departamento Regional escolhe), mas ela EXPRESSA o desempenho; não é o que o
// decide. É por isso que `situacao` aqui não vem de aritmética.

import { prisma } from '../lib/prisma.js'

export type Resultado = 'ATENDE' | 'EM_DESENVOLVIMENTO' | 'NAO_ATENDE'

export interface CriterioAferido {
  criterioId: number
  descricao: string
  evidencia: string | null
  peso: 'CRITICO' | 'DESEJAVEL'
  resultado: Resultado | null
  observacao: string | null
  tentativa: number
}

export interface CapacidadeAferida {
  capacidadeId: number
  tipo: string
  descricao: string
  criterios: CriterioAferido[]
  criticosTotal: number
  criticosAtendidos: number
  desejaveisTotal: number
  desejaveisAtendidos: number
  /** Todos os críticos atendidos. */
  dominada: boolean
}

export type NivelDesempenho = 'A' | 'B' | 'C' | 'D' | null

export interface ApuracaoCompetencia {
  componenteId: number
  matriculaId: number
  capacidades: CapacidadeAferida[]
  criticosTotal: number
  criticosAtendidos: number
  desejaveisTotal: number
  desejaveisAtendidos: number
  /** Critérios ainda sem aferição — o docente não terminou de avaliar. */
  semAfericao: number
  /**
   * Tabela de tradução do SENAI:
   *  A = todos os críticos e desejáveis atendidos
   *  B = todos os críticos, desejáveis parcialmente
   *  C = críticos parcialmente atendidos
   *  D = não desenvolveu
   */
  nivel: NivelDesempenho
  /** Nota equivalente, quando a IES expressa o desempenho em número. */
  notaEquivalente: number | null
  apto: boolean
  /** Explicação em português — a secretaria repete isso para o aluno. */
  explicacao: string
  /** Capacidades a retomar: o caminho da reapresentação. */
  aRetomar: string[]
}

/** Faixa de nota por nível, conforme a tabela publicada pelo SENAI. */
const NOTA_POR_NIVEL: Record<Exclude<NivelDesempenho, null>, number> = {
  A: 9.5, B: 8, C: 5.5, D: 2,
}

/**
 * Apura o desempenho do aluno num componente a partir da lista de verificação.
 *
 * Usa sempre a ÚLTIMA tentativa de cada critério: reapresentação existe para o
 * aluno demonstrar o que não demonstrou antes, então o que vale é a mais
 * recente — mas as anteriores continuam no banco, para o histórico da avaliação.
 */
export async function apurar(componenteId: number, matriculaId: number): Promise<ApuracaoCompetencia> {
  const capacidades = await prisma.acaCapacidade.findMany({
    where: { componenteId },
    orderBy: { ordem: 'asc' },
    include: { criterios: { orderBy: { ordem: 'asc' } } },
  })

  const criterioIds = capacidades.flatMap((c) => c.criterios.map((k) => k.id))
  const afericoes = criterioIds.length
    ? await prisma.acaAfericao.findMany({
        where: { criterioId: { in: criterioIds }, matriculaId },
        orderBy: { tentativa: 'asc' },
      })
    : []
  // A última tentativa sobrescreve as anteriores no mapa.
  const ultima = new Map<number, (typeof afericoes)[number]>()
  for (const a of afericoes) ultima.set(a.criterioId, a)

  const detalhadas: CapacidadeAferida[] = capacidades.map((cap) => {
    const criterios: CriterioAferido[] = cap.criterios.map((k) => {
      const a = ultima.get(k.id)
      return {
        criterioId: k.id,
        descricao: k.descricao,
        evidencia: k.evidencia,
        peso: k.peso as 'CRITICO' | 'DESEJAVEL',
        resultado: (a?.resultado as Resultado | undefined) ?? null,
        observacao: a?.observacao ?? null,
        tentativa: a?.tentativa ?? 0,
      }
    })
    const criticos = criterios.filter((k) => k.peso === 'CRITICO')
    const desejaveis = criterios.filter((k) => k.peso === 'DESEJAVEL')
    const criticosAtendidos = criticos.filter((k) => k.resultado === 'ATENDE').length
    return {
      capacidadeId: cap.id,
      tipo: String(cap.tipo),
      descricao: cap.descricao,
      criterios,
      criticosTotal: criticos.length,
      criticosAtendidos,
      desejaveisTotal: desejaveis.length,
      desejaveisAtendidos: desejaveis.filter((k) => k.resultado === 'ATENDE').length,
      // Capacidade sem critério crítico não trava nada — não é "dominada" por
      // omissão, mas também não impede a aptidão.
      dominada: criticos.length > 0 && criticosAtendidos === criticos.length,
    }
  })

  const criticosTotal = detalhadas.reduce((s, c) => s + c.criticosTotal, 0)
  const criticosAtendidos = detalhadas.reduce((s, c) => s + c.criticosAtendidos, 0)
  const desejaveisTotal = detalhadas.reduce((s, c) => s + c.desejaveisTotal, 0)
  const desejaveisAtendidos = detalhadas.reduce((s, c) => s + c.desejaveisAtendidos, 0)
  const semAfericao = detalhadas.reduce(
    (s, c) => s + c.criterios.filter((k) => k.resultado === null).length, 0,
  )

  const todosCriticos = criticosTotal > 0 && criticosAtendidos === criticosTotal
  const todosDesejaveis = desejaveisTotal === 0 || desejaveisAtendidos === desejaveisTotal
  const nenhumCritico = criticosTotal > 0 && criticosAtendidos === 0

  let nivel: NivelDesempenho = null
  if (criticosTotal > 0) {
    if (todosCriticos && todosDesejaveis) nivel = 'A'
    else if (todosCriticos) nivel = 'B'
    else if (nenhumCritico) nivel = 'D'
    else nivel = 'C'
  }

  const aRetomar = detalhadas
    .filter((c) => c.criticosTotal > 0 && !c.dominada)
    .map((c) => c.descricao)

  let explicacao: string
  if (criticosTotal === 0) {
    explicacao = 'Nenhum critério crítico cadastrado neste componente — não há o que apurar por competência.'
  } else if (semAfericao > 0 && !todosCriticos) {
    explicacao = `${semAfericao} critério(s) ainda sem aferição; ${criticosAtendidos} de ${criticosTotal} crítico(s) atendidos.`
  } else if (todosCriticos) {
    explicacao = todosDesejaveis
      ? `Atendeu todos os ${criticosTotal} critério(s) crítico(s) e os desejáveis.`
      : `Atendeu os ${criticosTotal} critério(s) crítico(s); ${desejaveisAtendidos} de ${desejaveisTotal} desejável(is).`
  } else {
    explicacao = `Não atendeu ${criticosTotal - criticosAtendidos} de ${criticosTotal} critério(s) crítico(s) — `
      + 'sem eles a competência não se caracteriza, independentemente do restante.'
  }

  return {
    componenteId, matriculaId,
    capacidades: detalhadas,
    criticosTotal, criticosAtendidos, desejaveisTotal, desejaveisAtendidos, semAfericao,
    nivel,
    notaEquivalente: nivel ? NOTA_POR_NIVEL[nivel] : null,
    // Apto é exatamente "todos os críticos atendidos". Nada de média.
    apto: todosCriticos,
    explicacao,
    aRetomar,
  }
}

/**
 * Registra a aferição de um critério.
 *
 * Reafirmar o mesmo resultado atualiza a tentativa corrente; mudar de resultado
 * abre uma tentativa nova. Sem isso, a reapresentação apagaria a história e não
 * daria para mostrar a evolução do aluno — que é o que o modelo por competência
 * pede ao acompanhar o desenvolvimento.
 */
export async function aferir(params: {
  criterioId: number
  matriculaId: number
  resultado: Resultado
  observacao?: string | null
  docenteUserId?: number | null
}) {
  const anteriores = await prisma.acaAfericao.findMany({
    where: { criterioId: params.criterioId, matriculaId: params.matriculaId },
    orderBy: { tentativa: 'desc' },
    take: 1,
  })
  const ultima = anteriores[0]

  if (ultima && ultima.resultado === params.resultado) {
    return prisma.acaAfericao.update({
      where: { id: ultima.id },
      data: {
        observacao: params.observacao ?? ultima.observacao,
        afericaoEm: new Date(),
        docenteUserId: params.docenteUserId ?? ultima.docenteUserId,
      },
    })
  }

  return prisma.acaAfericao.create({
    data: {
      criterioId: params.criterioId,
      matriculaId: params.matriculaId,
      resultado: params.resultado,
      observacao: params.observacao ?? null,
      tentativa: (ultima?.tentativa ?? 0) + 1,
      docenteUserId: params.docenteUserId ?? null,
    },
  })
}

/** Lista de verificação de um diário: capacidades × alunos, para o docente. */
export async function listaDeVerificacao(diarioId: number) {
  const diario = await prisma.acaDiario.findUnique({
    where: { id: diarioId },
    select: { id: true, disciplinaId: true, turmaId: true },
  })
  if (!diario) throw new Error('Diário não encontrado')

  // O componente é achado pela disciplina do diário na matriz da turma.
  const turma = await prisma.acaTurma.findUnique({
    where: { id: diario.turmaId },
    select: { matrizId: true },
  })
  const componente = turma?.matrizId
    ? await prisma.acaComponente.findFirst({
        where: { matrizId: turma.matrizId, disciplinaId: diario.disciplinaId },
        select: { id: true },
      })
    : null
  if (!componente) {
    return { componenteId: null, capacidades: [], alunos: [], semComponente: true as const }
  }

  const capacidades = await prisma.acaCapacidade.findMany({
    where: { componenteId: componente.id },
    orderBy: { ordem: 'asc' },
    include: { criterios: { orderBy: { ordem: 'asc' } } },
  })
  const matriculas = await prisma.acaMatricula.findMany({
    where: { turmaId: diario.turmaId, status: 'MATRICULADO', listaEspera: false },
    select: { id: true, aluno: { select: { ra: true, lead: { select: { nome: true } } } } },
    orderBy: { aluno: { lead: { nome: 'asc' } } },
  })

  const alunos = []
  for (const m of matriculas) {
    const ap = await apurar(componente.id, m.id)
    alunos.push({
      matriculaId: m.id,
      nome: m.aluno?.lead?.nome ?? `Matrícula ${m.id}`,
      ra: m.aluno?.ra ?? null,
      apto: ap.apto,
      nivel: ap.nivel,
      criticosAtendidos: ap.criticosAtendidos,
      criticosTotal: ap.criticosTotal,
      semAfericao: ap.semAfericao,
      resultados: Object.fromEntries(
        ap.capacidades.flatMap((c) => c.criterios.map((k) => [k.criterioId, k.resultado])),
      ),
    })
  }

  return { componenteId: componente.id, capacidades, alunos, semComponente: false as const }
}
