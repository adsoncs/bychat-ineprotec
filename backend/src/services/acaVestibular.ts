// src/services/acaVestibular.ts
// Módulo Acadêmico · F11 — Processo Seletivo (camada admin). Classificação,
// convocação por chamadas e ensalamento. Reusa ProcessRegistration (status/
// notaClassificacao/posicaoClassificacao/convocadoEm) do módulo educacional.

import { prisma } from '../lib/prisma.js'

const RECLASSIFICAVEIS = ['inscrito', 'pago_taxa', 'classificado', 'convocado', 'reprovado']

/**
 * Classifica os candidatos de um processo: nota final = média ponderada dos
 * componentes (fallback p/ notaClassificacao existente), ordena desc com
 * critério de desempate, aplica nota de corte e grava posição/status.
 * criterio: 'inscricao' (mais antigo vence) | 'componente:<id>' (maior naquele).
 */
export async function classificar(selectionProcessId: number, criterio = 'inscricao') {
  const proc = await prisma.selectionProcess.findUnique({ where: { id: selectionProcessId }, select: { id: true, notaCorte: true } })
  if (!proc) throw new Error('Processo seletivo não encontrado')
  const componentes = await prisma.acaProcessoComponente.findMany({ where: { selectionProcessId } })
  const pesoTotal = componentes.reduce((s, c) => s + c.peso, 0)
  const regs = await prisma.processRegistration.findMany({
    where: { selectionProcessId, status: { in: RECLASSIFICAVEIS } },
    select: { id: true, inscritoEm: true, notaClassificacao: true },
  })
  if (!regs.length) return { total: 0, classificados: 0, reprovados: 0 }
  const notas = await prisma.acaProcessoNota.findMany({ where: { processRegistrationId: { in: regs.map((r) => r.id) } } })
  const notaMap = new Map<string, number>()
  for (const n of notas) notaMap.set(`${n.processRegistrationId}:${n.componenteId}`, n.nota)
  const compNotaDe = (regId: number, compId: number) => notaMap.get(`${regId}:${compId}`) ?? null

  const calc = regs.map((r) => {
    let final: number
    if (componentes.length && pesoTotal > 0) {
      let soma = 0
      for (const c of componentes) soma += (compNotaDe(r.id, c.id) ?? 0) * c.peso
      final = Math.round((soma / pesoTotal) * 100) / 100
    } else {
      final = r.notaClassificacao ?? 0
    }
    return { id: r.id, inscritoEm: r.inscritoEm, notaFinal: final }
  })

  // desempate
  const desempCompId = criterio.startsWith('componente:') ? Number(criterio.split(':')[1]) : null
  calc.sort((a, b) => {
    if (b.notaFinal !== a.notaFinal) return b.notaFinal - a.notaFinal
    if (desempCompId) {
      const na = compNotaDe(a.id, desempCompId) ?? -1, nb = compNotaDe(b.id, desempCompId) ?? -1
      if (nb !== na) return nb - na
    }
    return a.inscritoEm.getTime() - b.inscritoEm.getTime() // mais antigo primeiro
  })

  const corte = proc.notaCorte ?? null
  let pos = 0, classificados = 0, reprovados = 0
  const agora = new Date()
  for (const c of calc) {
    const reprovado = corte != null && c.notaFinal < corte
    if (reprovado) {
      reprovados++
      await prisma.processRegistration.update({ where: { id: c.id }, data: { notaClassificacao: c.notaFinal, posicaoClassificacao: null, status: 'reprovado', classificadoEm: agora } })
    } else {
      pos++; classificados++
      await prisma.processRegistration.update({ where: { id: c.id }, data: { notaClassificacao: c.notaFinal, posicaoClassificacao: pos, status: 'classificado', classificadoEm: agora } })
    }
  }
  return { total: calc.length, classificados, reprovados }
}

/** Convoca as próximas `qtdVagas` posições classificadas ainda não convocadas. */
export async function convocar(selectionProcessId: number, qtdVagas: number) {
  const elegiveis = await prisma.processRegistration.findMany({
    where: { selectionProcessId, status: 'classificado', posicaoClassificacao: { not: null } },
    orderBy: { posicaoClassificacao: 'asc' }, take: Math.max(0, qtdVagas), select: { id: true },
  })
  const agora = new Date()
  for (const e of elegiveis) await prisma.processRegistration.update({ where: { id: e.id }, data: { status: 'convocado', convocadoEm: agora } })
  return { convocados: elegiveis.length }
}

/**
 * Distribui os candidatos (ordem de classificação, fallback inscrição) nas salas
 * conforme a capacidade. Refaz o ensalamento do processo a cada execução.
 */
export async function ensalar(selectionProcessId: number) {
  const salas = await prisma.acaProcessoSala.findMany({ where: { selectionProcessId }, orderBy: { id: 'asc' } })
  if (!salas.length) throw new Error('Cadastre ao menos uma sala antes de ensalar')
  const regs = await prisma.processRegistration.findMany({
    where: { selectionProcessId, status: { in: ['inscrito', 'pago_taxa', 'classificado', 'convocado'] } },
    orderBy: [{ posicaoClassificacao: 'asc' }, { inscritoEm: 'asc' }], select: { id: true },
  })
  await prisma.acaProcessoEnsalamento.deleteMany({ where: { selectionProcessId } })
  let idx = 0, alocados = 0
  for (const sala of salas) {
    for (let seat = 1; seat <= sala.capacidade && idx < regs.length; seat++, idx++) {
      await prisma.acaProcessoEnsalamento.create({ data: { selectionProcessId, processRegistrationId: regs[idx].id, salaId: sala.id, ordem: seat } })
      alocados++
    }
  }
  return { alocados, semSala: regs.length - alocados }
}
