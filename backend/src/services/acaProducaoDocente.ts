// src/services/acaProducaoDocente.ts
//
// Produção docente consolidada por competência (T-607).
//
// O que a folha precisa não é a lista de atividades lançadas — é o fechamento
// do mês por professor, somando o que veio do diário (aulas efetivamente
// ministradas) com o que foi lançado à mão (substituições, orientações,
// bancas). Sem essa consolidação, alguém refaz a conta em planilha todo mês, e
// é aí que aparece divergência entre o que o professor deu e o que recebeu.

import { prisma } from '../lib/prisma.js'

export interface LinhaProducao {
  docenteId: number
  userId: number
  nome: string
  titulacao: string | null
  regime: string
  /** Aulas registradas no diário dentro da competência. */
  aulasMinistradas: number
  horasAula: number
  /** Atividades lançadas manualmente (orientação, banca, substituição…). */
  horasAtividades: number
  horasTotal: number
  valorAtividadesCentavos: number
  valorHoraCentavos: number
  /** Aulas × valor-hora, para conferência com o que a folha vai pagar. */
  valorAulasCentavos: number
  valorTotalCentavos: number
  turmas: string[]
}

/** Competência no formato AAAA-MM → intervalo do mês. */
function intervalo(competencia: string): { inicio: Date; fim: Date } {
  const [ano, mes] = competencia.split('-').map(Number)
  const inicio = new Date(ano!, (mes ?? 1) - 1, 1)
  const fim = new Date(ano!, mes ?? 1, 0, 23, 59, 59)
  return { inicio, fim }
}

export async function consolidar(competencia: string): Promise<{ competencia: string; linhas: LinhaProducao[]; totalHoras: number; totalCentavos: number }> {
  if (!/^\d{4}-\d{2}$/.test(competencia)) throw new Error('Competência deve estar no formato AAAA-MM')
  const { inicio, fim } = intervalo(competencia)

  const docentes = await prisma.acaDocente.findMany({
    where: { ativo: true },
    select: { id: true, userId: true, titulacao: true, regime: true, valorHoraCentavos: true },
  })
  if (docentes.length === 0) return { competencia, linhas: [], totalHoras: 0, totalCentavos: 0 }

  const usuarios = await prisma.user.findMany({
    where: { id: { in: docentes.map((d) => d.userId) } },
    select: { id: true, name: true, email: true },
  })
  const nomePorUser = new Map(usuarios.map((u) => [u.id, u.name || u.email]))

  // Aulas do período, por diário → professor da turma.
  const aulas = await prisma.acaAula.findMany({
    where: { data: { gte: inicio, lte: fim } },
    select: { quantidadeAulas: true, diarioId: true },
  })
  const diarioIds = [...new Set(aulas.map((a) => a.diarioId))]
  const diarios = diarioIds.length
    ? await prisma.acaDiario.findMany({
        where: { id: { in: diarioIds } },
        select: { id: true, professorUserId: true, turmaId: true },
      })
    : []
  // AcaDiario guarda turmaId escalar (sem @relation), então o nome da turma
  // vem numa segunda consulta.
  const turmaIds = [...new Set(diarios.map((d) => d.turmaId).filter(Boolean))] as number[]
  const turmas = turmaIds.length
    ? await prisma.acaTurma.findMany({ where: { id: { in: turmaIds } }, select: { id: true, nome: true } })
    : []
  const nomeTurma = new Map(turmas.map((t) => [t.id, t.nome]))
  const diarioInfo = new Map(diarios.map((d) => [d.id, { userId: d.professorUserId as number | null, turma: nomeTurma.get(d.turmaId) }]))

  const porUser = new Map<number, { aulas: number; turmas: Set<string> }>()
  for (const a of aulas) {
    const info = diarioInfo.get(a.diarioId)
    if (!info?.userId) continue
    const acc = porUser.get(info.userId) ?? { aulas: 0, turmas: new Set<string>() }
    acc.aulas += a.quantidadeAulas
    if (info.turma) acc.turmas.add(info.turma)
    porUser.set(info.userId, acc)
  }

  // Atividades lançadas na competência.
  const atividades = await prisma.acaAtividadeDocente.findMany({
    where: { competencia },
    select: { docenteId: true, horas: true, valorCentavos: true },
  })
  const porDocente = new Map<number, { horas: number; valor: number }>()
  for (const at of atividades) {
    const acc = porDocente.get(at.docenteId) ?? { horas: 0, valor: 0 }
    acc.horas += at.horas
    acc.valor += at.valorCentavos
    porDocente.set(at.docenteId, acc)
  }

  const linhas: LinhaProducao[] = docentes.map((d) => {
    const doDiario = porUser.get(d.userId) ?? { aulas: 0, turmas: new Set<string>() }
    const doLancamento = porDocente.get(d.id) ?? { horas: 0, valor: 0 }
    const horasAula = doDiario.aulas // 1 registro de aula = 1 hora-aula
    const valorAulas = horasAula * d.valorHoraCentavos
    return {
      docenteId: d.id, userId: d.userId,
      nome: nomePorUser.get(d.userId) ?? `Usuário #${d.userId}`,
      titulacao: d.titulacao, regime: String(d.regime),
      aulasMinistradas: doDiario.aulas,
      horasAula,
      horasAtividades: doLancamento.horas,
      horasTotal: horasAula + doLancamento.horas,
      valorAtividadesCentavos: doLancamento.valor,
      valorHoraCentavos: d.valorHoraCentavos,
      valorAulasCentavos: valorAulas,
      valorTotalCentavos: valorAulas + doLancamento.valor,
      turmas: [...doDiario.turmas],
    }
  })
  // Quem não produziu no mês não vai para a folha.
  const comProducao = linhas.filter((l) => l.horasTotal > 0 || l.valorTotalCentavos > 0)
  return {
    competencia,
    linhas: comProducao,
    totalHoras: comProducao.reduce((s, l) => s + l.horasTotal, 0),
    totalCentavos: comProducao.reduce((s, l) => s + l.valorTotalCentavos, 0),
  }
}

/** CSV para a folha — o formato que o RH consegue importar sem retrabalho. */
export function paraCsv(dados: { competencia: string; linhas: LinhaProducao[] }): string {
  const cab = ['competencia', 'docenteId', 'nome', 'titulacao', 'regime', 'aulas', 'horas_aula', 'horas_atividades', 'horas_total', 'valor_aulas', 'valor_atividades', 'valor_total', 'turmas']
  const linhas = dados.linhas.map((l) => [
    dados.competencia, l.docenteId, `"${l.nome.replace(/"/g, '""')}"`, l.titulacao ?? '', l.regime,
    l.aulasMinistradas, l.horasAula, l.horasAtividades, l.horasTotal,
    (l.valorAulasCentavos / 100).toFixed(2), (l.valorAtividadesCentavos / 100).toFixed(2), (l.valorTotalCentavos / 100).toFixed(2),
    `"${l.turmas.join('; ')}"`,
  ].join(','))
  return [cab.join(','), ...linhas].join('\n')
}
