// src/services/acaRelatorioConversao.ts
//
// Conversão da captação: de cada 100 inscrições, quantas viram matrícula — por
// curso, por forma de ingresso e por origem do anúncio.
//
// É a pergunta que decide onde a instituição gasta verba, e até aqui não tinha
// resposta no sistema: o funil dizia "quem está parado", não "o que converte".

import { prisma } from '../lib/prisma.js'

export interface LinhaConversao {
  chave: string
  rotulo: string
  inscricoes: number
  pagas: number
  matriculadas: number
  /** Percentual de inscrições que viraram matrícula. */
  conversao: number
  /** Abaixo deste número de inscrições a porcentagem não significa nada. */
  amostraSuficiente: boolean
}

/** Piso de amostra: "100% de 1 inscrição" não é informação, é ruído. */
const MINIMO_PARA_PERCENTUAL = 10

function montar(
  grupos: Map<string, { rotulo: string; inscricoes: number; pagas: number; matriculadas: number }>,
): LinhaConversao[] {
  return [...grupos.entries()]
    .map(([chave, g]) => ({
      chave,
      rotulo: g.rotulo,
      inscricoes: g.inscricoes,
      pagas: g.pagas,
      matriculadas: g.matriculadas,
      conversao: g.inscricoes ? Math.round((g.matriculadas / g.inscricoes) * 1000) / 10 : 0,
      amostraSuficiente: g.inscricoes >= MINIMO_PARA_PERCENTUAL,
    }))
    .sort((a, b) => b.inscricoes - a.inscricoes)
}

export async function relatorioDeConversao(filtros: { desde?: Date; ate?: Date; portalId?: number } = {}) {
  const registros = await prisma.enrollmentRegistration.findMany({
    where: {
      ...(filtros.portalId ? { portalId: filtros.portalId } : {}),
      ...(filtros.desde || filtros.ate
        ? { createdAt: { ...(filtros.desde ? { gte: filtros.desde } : {}), ...(filtros.ate ? { lte: filtros.ate } : {}) } }
        : {}),
    },
    select: {
      id: true, status: true, paymentPaidAt: true, utmSource: true, utmCampaign: true, leadId: true,
      processRegistration: {
        select: {
          offering: { select: { id: true, nome: true } },
          selectionProcess: { select: { id: true, nome: true, entryMode: { select: { id: true, name: true } } } },
        },
      },
    },
  })

  // Matriculado de verdade é quem tem AcaMatricula MATRICULADO — o status da
  // inscrição sozinho não distingue "efetivada" de "documentos aprovados".
  const leadIds = registros.map((r) => r.leadId).filter((x): x is number => !!x)
  const alunos = leadIds.length
    ? await prisma.aluno.findMany({ where: { leadId: { in: leadIds } }, select: { id: true, leadId: true } })
    : []
  const alunoPorLead = new Map(alunos.map((a) => [a.leadId, a.id]))
  const matriculados = alunos.length
    ? await prisma.acaMatricula.findMany({
        where: { alunoId: { in: alunos.map((a) => a.id) }, status: 'MATRICULADO' },
        select: { alunoId: true },
      })
    : []
  const alunosMatriculados = new Set(matriculados.map((m) => m.alunoId))

  const porCurso = new Map<string, { rotulo: string; inscricoes: number; pagas: number; matriculadas: number }>()
  const porIngresso = new Map<string, { rotulo: string; inscricoes: number; pagas: number; matriculadas: number }>()
  const porOrigem = new Map<string, { rotulo: string; inscricoes: number; pagas: number; matriculadas: number }>()

  const somar = (
    mapa: Map<string, { rotulo: string; inscricoes: number; pagas: number; matriculadas: number }>,
    chave: string, rotulo: string, pago: boolean, matriculado: boolean,
  ) => {
    const g = mapa.get(chave) ?? { rotulo, inscricoes: 0, pagas: 0, matriculadas: 0 }
    g.inscricoes++
    if (pago) g.pagas++
    if (matriculado) g.matriculadas++
    mapa.set(chave, g)
  }

  for (const r of registros) {
    const alunoId = r.leadId ? alunoPorLead.get(r.leadId) : undefined
    const matriculado = !!alunoId && alunosMatriculados.has(alunoId)
    const pago = !!r.paymentPaidAt || r.status === 'paid'

    const oferta = r.processRegistration?.offering
    somar(porCurso, String(oferta?.id ?? 'sem'), oferta?.nome ?? 'Sem curso escolhido', pago, matriculado)

    const modo = r.processRegistration?.selectionProcess?.entryMode
    somar(porIngresso, String(modo?.id ?? 'sem'), modo?.name ?? 'Sem forma de ingresso', pago, matriculado)

    // Sem UTM é tráfego direto: quem digitou o endereço ou veio de link salvo.
    const origem = (r.utmSource || '').trim().toLowerCase() || 'direto'
    somar(porOrigem, origem, origem === 'direto' ? 'Direto / sem origem' : origem, pago, matriculado)
  }

  const total = registros.length
  const totalMatriculadas = registros.filter((r) => {
    const a = r.leadId ? alunoPorLead.get(r.leadId) : undefined
    return !!a && alunosMatriculados.has(a)
  }).length

  return {
    total,
    matriculadas: totalMatriculadas,
    conversaoGeral: total ? Math.round((totalMatriculadas / total) * 1000) / 10 : 0,
    amostraSuficiente: total >= MINIMO_PARA_PERCENTUAL,
    minimoParaPercentual: MINIMO_PARA_PERCENTUAL,
    porCurso: montar(porCurso),
    porFormaDeIngresso: montar(porIngresso),
    porOrigem: montar(porOrigem),
  }
}
