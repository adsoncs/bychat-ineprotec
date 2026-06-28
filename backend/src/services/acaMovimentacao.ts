// src/services/acaMovimentacao.ts
// Módulo Acadêmico · F5 — Movimentações Acadêmicas.
// Centraliza as regras de trancamento/afastamento/transferência/remanejamento/
// reclassificação/cancelamento/reingresso. Cada movimentação:
//   1) valida a transição de status da matrícula (reusa as regras de P4);
//   2) atualiza o status (quando aplicável) + grava AcaMatriculaEvento (trilha);
//   3) grava AcaMovimentacao (registro formal, auditável).
// Transferência interna cria uma NOVA matrícula na turma de destino.

import { prisma } from '../lib/prisma.js'

export class MovimentacaoError extends Error {
  code: number
  constructor(message: string, code = 409) { super(message); this.code = code }
}

type Ctx = { userId?: number | null }

async function carregarMatricula(matriculaId: number) {
  const m = await prisma.acaMatricula.findUnique({
    where: { id: matriculaId },
    select: { id: true, alunoId: true, turmaId: true, status: true, courseOfferingId: true },
  })
  if (!m) throw new MovimentacaoError('Matrícula não encontrada', 404)
  return m
}

/** Aplica troca de status + trilha + registro de movimentação numa transação. */
async function aplicar(opts: {
  matricula: { id: number; alunoId: number; status: string }
  para?: string | null
  tipo: any
  ctx: Ctx
  motivo?: string | null
  dataRetornoPrevista?: Date | null
  turmaDestinoId?: number | null
  matriculaDestinoId?: number | null
  instituicaoDestino?: string | null
  extraData?: Record<string, any>
}) {
  const { matricula, para, tipo, ctx } = opts
  return prisma.$transaction(async (tx) => {
    if (para && para !== matricula.status) {
      const data: any = { status: para, ...(opts.extraData || {}) }
      if (para === 'CONCLUIDO') data.dataConclusao = new Date()
      if (['CANCELADO', 'EVADIDO', 'TRANSFERIDO'].includes(para)) data.motivoSaida = opts.motivo || null
      await tx.acaMatricula.update({ where: { id: matricula.id }, data })
      await tx.acaMatriculaEvento.create({
        data: { matriculaId: matricula.id, de: matricula.status, para, obs: opts.motivo || null, userId: ctx.userId ?? null },
      })
    }
    const mov = await tx.acaMovimentacao.create({
      data: {
        matriculaId: matricula.id,
        alunoId: matricula.alunoId,
        tipo,
        statusDe: matricula.status,
        statusPara: para ?? matricula.status,
        turmaDestinoId: opts.turmaDestinoId ?? null,
        matriculaDestinoId: opts.matriculaDestinoId ?? null,
        instituicaoDestino: opts.instituicaoDestino ?? null,
        motivo: opts.motivo ?? null,
        dataRetornoPrevista: opts.dataRetornoPrevista ?? null,
        userId: ctx.userId ?? null,
      },
    })
    return mov
  })
}

export async function trancar(matriculaId: number, motivo: string | null, dataRetornoPrevista: Date | null, ctx: Ctx) {
  const m = await carregarMatricula(matriculaId)
  if (m.status !== 'MATRICULADO') throw new MovimentacaoError(`Só é possível trancar uma matrícula MATRICULADA (atual: ${m.status}).`)
  return aplicar({ matricula: m, para: 'TRANCADO', tipo: 'TRANCAMENTO', ctx, motivo, dataRetornoPrevista })
}

export async function reingressar(matriculaId: number, motivo: string | null, ctx: Ctx) {
  const m = await carregarMatricula(matriculaId)
  if (m.status !== 'TRANCADO') throw new MovimentacaoError(`Reingresso só a partir de TRANCADO (atual: ${m.status}).`)
  return aplicar({ matricula: m, para: 'MATRICULADO', tipo: 'REINGRESSO', ctx, motivo })
}

/** Afastamento: registro formal SEM trocar o status (licença/saúde mantém a matrícula). */
export async function afastar(matriculaId: number, motivo: string | null, dataRetornoPrevista: Date | null, ctx: Ctx) {
  const m = await carregarMatricula(matriculaId)
  if (m.status !== 'MATRICULADO') throw new MovimentacaoError(`Afastamento só para matrícula MATRICULADA (atual: ${m.status}).`)
  return aplicar({ matricula: m, para: null, tipo: 'AFASTAMENTO', ctx, motivo, dataRetornoPrevista })
}

export async function cancelar(matriculaId: number, motivo: string | null, ctx: Ctx) {
  const m = await carregarMatricula(matriculaId)
  if (['CANCELADO', 'CONCLUIDO', 'TRANSFERIDO', 'EVADIDO'].includes(m.status)) {
    throw new MovimentacaoError(`Matrícula já encerrada (${m.status}); não pode ser cancelada.`)
  }
  return aplicar({ matricula: m, para: 'CANCELADO', tipo: 'CANCELAMENTO', ctx, motivo })
}

export async function evadir(matriculaId: number, motivo: string | null, ctx: Ctx) {
  const m = await carregarMatricula(matriculaId)
  if (!['MATRICULADO', 'TRANCADO'].includes(m.status)) {
    throw new MovimentacaoError(`Evasão só a partir de MATRICULADO/TRANCADO (atual: ${m.status}).`)
  }
  return aplicar({ matricula: m, para: 'EVADIDO', tipo: 'EVASAO', ctx, motivo })
}

export async function transferenciaExterna(matriculaId: number, instituicaoDestino: string, motivo: string | null, ctx: Ctx) {
  const m = await carregarMatricula(matriculaId)
  if (!['MATRICULADO', 'TRANCADO'].includes(m.status)) {
    throw new MovimentacaoError(`Transferência externa só a partir de MATRICULADO/TRANCADO (atual: ${m.status}).`)
  }
  if (!instituicaoDestino?.trim()) throw new MovimentacaoError('Informe a instituição de destino.', 400)
  return aplicar({ matricula: m, para: 'TRANSFERIDO', tipo: 'TRANSFERENCIA_EXTERNA', ctx, motivo, instituicaoDestino: instituicaoDestino.trim() })
}

/**
 * Transferência interna / remanejamento: fecha a matrícula de origem (TRANSFERIDO)
 * e cria uma NOVA matrícula MATRICULADA na turma de destino. Não duplica financeiro
 * automaticamente (a secretaria gera o contrato da nova turma se necessário).
 */
export async function transferenciaInterna(
  matriculaId: number, turmaDestinoId: number, motivo: string | null, ctx: Ctx, remanejamento = false,
) {
  const m = await carregarMatricula(matriculaId)
  if (!['MATRICULADO', 'TRANCADO', 'INSCRITO', 'PRE_MATRICULA'].includes(m.status)) {
    throw new MovimentacaoError(`Transferência interna não permitida a partir de ${m.status}.`)
  }
  if (turmaDestinoId === m.turmaId) throw new MovimentacaoError('Turma de destino igual à de origem.', 400)
  const destino = await prisma.acaTurma.findUnique({ where: { id: turmaDestinoId }, select: { id: true, ativo: true, courseOfferingId: true } })
  if (!destino) throw new MovimentacaoError('Turma de destino não encontrada.', 404)
  if (!destino.ativo) throw new MovimentacaoError('Turma de destino inativa.')
  const jaExiste = await prisma.acaMatricula.findUnique({ where: { alunoId_turmaId: { alunoId: m.alunoId, turmaId: turmaDestinoId } }, select: { id: true } })
  if (jaExiste) throw new MovimentacaoError('Aluno já possui matrícula na turma de destino.')

  return prisma.$transaction(async (tx) => {
    // 1) fecha origem
    await tx.acaMatricula.update({ where: { id: m.id }, data: { status: 'TRANSFERIDO', motivoSaida: motivo || null } })
    await tx.acaMatriculaEvento.create({ data: { matriculaId: m.id, de: m.status, para: 'TRANSFERIDO', obs: motivo || (remanejamento ? 'Remanejamento' : 'Transferência interna'), userId: ctx.userId ?? null } })
    // 2) cria destino
    const nova = await tx.acaMatricula.create({
      data: {
        alunoId: m.alunoId, turmaId: turmaDestinoId, courseOfferingId: destino.courseOfferingId,
        status: 'MATRICULADO', origem: remanejamento ? 'remanejamento' : 'transferencia_interna',
      },
      select: { id: true },
    })
    await tx.acaMatriculaEvento.create({ data: { matriculaId: nova.id, de: null, para: 'MATRICULADO', obs: remanejamento ? 'Remanejado da turma anterior' : 'Transferido da turma anterior', userId: ctx.userId ?? null } })
    // 3) registro de movimentação (em ambos os "lados" via matriculaDestinoId)
    const mov = await tx.acaMovimentacao.create({
      data: {
        matriculaId: m.id, alunoId: m.alunoId,
        tipo: remanejamento ? 'REMANEJAMENTO' : 'TRANSFERENCIA_INTERNA',
        statusDe: m.status, statusPara: 'TRANSFERIDO',
        turmaDestinoId, matriculaDestinoId: nova.id, motivo: motivo || null, userId: ctx.userId ?? null,
      },
    })
    return { movimentacao: mov, matriculaDestinoId: nova.id }
  })
}

/**
 * Alunos sem rematrícula: matrículas MATRICULADO/TRANCADO em turma de período
 * letivo já ENCERRADO (dataFim < hoje) cujo aluno NÃO tem nenhuma matrícula ativa
 * (MATRICULADO) em turma de período vigente (dataFim >= hoje ou sem dataFim).
 */
export async function alunosSemRematricula() {
  const hoje = new Date()
  // alunos com matrícula ativa em período vigente
  const ativasVigentes = await prisma.acaMatricula.findMany({
    where: { status: 'MATRICULADO', turma: { periodoLetivo: { OR: [{ dataFim: null }, { dataFim: { gte: hoje } }] } } },
    select: { alunoId: true },
  })
  const comVigente = new Set(ativasVigentes.map((a) => a.alunoId))

  const candidatas = await prisma.acaMatricula.findMany({
    where: { status: { in: ['MATRICULADO', 'TRANCADO'] }, turma: { periodoLetivo: { dataFim: { lt: hoje } } } },
    select: {
      id: true, status: true, alunoId: true,
      aluno: { select: { ra: true, lead: { select: { nome: true } } } },
      turma: { select: { id: true, nome: true, periodoLetivo: { select: { codigo: true, dataFim: true } } } },
    },
    orderBy: { id: 'asc' },
  })
  return candidatas.filter((c) => !comVigente.has(c.alunoId))
}

/**
 * Atualiza situações acadêmicas em lote: marca como EVADIDO os candidatos de
 * alunosSemRematricula(). dryRun=true só lista; senão aplica (trilha + movimentação EVASAO).
 */
export async function atualizaSituacoes(opts: { dryRun: boolean; matriculaIds?: number[]; ctx: Ctx }) {
  const candidatas = await alunosSemRematricula()
  const alvo = opts.matriculaIds?.length
    ? candidatas.filter((c) => opts.matriculaIds!.includes(c.id))
    : candidatas
  if (opts.dryRun) return { dryRun: true, total: alvo.length, candidatas: alvo }
  let aplicadas = 0
  for (const c of alvo) {
    try { await evadir(c.id, 'Evasão automática — sem rematrícula no período vigente', opts.ctx); aplicadas++ }
    catch { /* pula matrícula que mudou de estado nesse meio-tempo */ }
  }
  return { dryRun: false, total: alvo.length, aplicadas }
}
