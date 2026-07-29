// src/services/acaAcordo.ts
//
// Negociação de dívida como serviço, para a mesma regra valer na secretaria e
// no portal (T-906). Antes isto vivia dentro da rota admin, então o aluno
// dependia de ligar para renegociar — que é exatamente o atrito que o
// autoatendimento existe para remover.
//
// A diferença entre os dois canais não é a matemática: é a ALÇADA. A secretaria
// negocia livremente; o portal opera dentro de uma política configurável
// (parcelas máximas, entrada mínima, desconto de encargos). Desconto incide
// somente sobre multa e juros — nunca sobre o principal, que é serviço prestado.

import { prisma } from '../lib/prisma.js'
import { getEncargosConfig, calcularEncargos } from './acaEncargos.js'

export interface PoliticaAcordo {
  portalHabilitado: boolean
  maxParcelas: number
  entradaMinimaPct: number
  /** Desconto sobre multa+juros para quem fecha sozinho, como incentivo. */
  descontoEncargosPct: number
  /** Atraso mínimo (em dias) para liberar acordo no portal. */
  atrasoMinimoDias: number
}

const PADRAO: PoliticaAcordo = {
  portalHabilitado: false, // opt-in: a IES decide quando abrir
  maxParcelas: 6,
  entradaMinimaPct: 0,
  descontoEncargosPct: 0,
  atrasoMinimoDias: 0,
}

const CHAVES: Record<keyof PoliticaAcordo, string> = {
  portalHabilitado: 'aca.acordo.portal_habilitado',
  maxParcelas: 'aca.acordo.max_parcelas',
  entradaMinimaPct: 'aca.acordo.entrada_minima_pct',
  descontoEncargosPct: 'aca.acordo.desconto_encargos_pct',
  atrasoMinimoDias: 'aca.acordo.atraso_minimo_dias',
}

export async function getPolitica(): Promise<PoliticaAcordo> {
  const rows = await prisma.setting.findMany({ where: { key: { in: Object.values(CHAVES) } } })
  const v = (k: string) => rows.find((r) => r.key === k)?.value as any
  const numero = (k: string, padrao: number, max?: number) => {
    const n = Number(v(k))
    if (!Number.isFinite(n) || n < 0) return padrao
    return max != null ? Math.min(n, max) : n
  }
  return {
    portalHabilitado: v(CHAVES.portalHabilitado) === true || v(CHAVES.portalHabilitado) === 'true',
    maxParcelas: Math.max(1, Math.trunc(numero(CHAVES.maxParcelas, PADRAO.maxParcelas, 48))),
    entradaMinimaPct: numero(CHAVES.entradaMinimaPct, PADRAO.entradaMinimaPct, 100),
    descontoEncargosPct: numero(CHAVES.descontoEncargosPct, PADRAO.descontoEncargosPct, 100),
    atrasoMinimoDias: Math.trunc(numero(CHAVES.atrasoMinimoDias, PADRAO.atrasoMinimoDias)),
  }
}

export async function salvarPolitica(p: Partial<PoliticaAcordo>): Promise<PoliticaAcordo> {
  for (const [campo, chave] of Object.entries(CHAVES) as Array<[keyof PoliticaAcordo, string]>) {
    if (p[campo] === undefined) continue
    const valor = campo === 'portalHabilitado' ? !!p[campo] : Number(p[campo])
    await prisma.setting.upsert({
      where: { key: chave },
      update: { value: valor as any },
      create: { key: chave, label: chave, grp: 'academico', fieldType: campo === 'portalHabilitado' ? 'boolean' : 'number', value: valor as any },
    })
  }
  return getPolitica()
}

export interface ParcelaNegociavel {
  id: number
  nroParcela: number
  tipo: string
  dataVencimento: Date
  diasAtraso: number
  originalCentavos: number
  multaCentavos: number
  jurosCentavos: number
  totalCentavos: number
}

/** Parcelas que o aluno pode levar para acordo, já com encargos calculados. */
export async function parcelasNegociaveis(alunoId: number, politica?: PoliticaAcordo): Promise<ParcelaNegociavel[]> {
  const pol = politica ?? (await getPolitica())
  const cfg = await getEncargosConfig()
  const parcelas = await prisma.acaParcela.findMany({
    where: {
      situacao: { in: ['ABERTA', 'VENCIDA'] },
      contrato: { matricula: { alunoId } },
    },
    orderBy: { dataVencimento: 'asc' },
    select: { id: true, nroParcela: true, tipo: true, dataVencimento: true, valorBrutoCentavos: true, situacao: true },
  })
  const hoje = Date.now()
  return parcelas
    .map((p) => {
      const e = calcularEncargos(p as any, cfg)
      const dias = Math.floor((hoje - p.dataVencimento.getTime()) / 86400_000)
      return {
        id: p.id, nroParcela: p.nroParcela, tipo: String(p.tipo),
        dataVencimento: p.dataVencimento,
        diasAtraso: Math.max(0, dias),
        originalCentavos: e.original,
        multaCentavos: e.multa,
        jurosCentavos: e.juros,
        totalCentavos: e.original + e.multa + e.juros,
      }
    })
    .filter((p) => p.diasAtraso >= pol.atrasoMinimoDias)
}

export interface SimulacaoAcordo {
  qtd: number
  valorOriginalCentavos: number
  encargosCentavos: number
  descontoEncargosCentavos: number
  totalCentavos: number
  entradaCentavos: number
  numParcelas: number
  valorParcelaCentavos: number
  /** Limites aplicados, para a tela explicar por que não deixou. */
  politica: PoliticaAcordo
  avisos: string[]
}

/**
 * Simula o acordo. `canalPortal` liga as travas da política — na secretaria a
 * negociação é livre, no portal ela precisa caber nas regras da IES.
 */
export async function simular(params: {
  parcelaIds: number[]
  numParcelas: number
  entradaCentavos?: number
  canalPortal?: boolean
}): Promise<SimulacaoAcordo> {
  const pol = await getPolitica()
  const cfg = await getEncargosConfig()
  const parcelas = await prisma.acaParcela.findMany({
    where: { id: { in: params.parcelaIds } },
    select: { id: true, valorBrutoCentavos: true, dataVencimento: true, situacao: true },
  })
  const elegiveis = parcelas.filter((p) => p.situacao === 'ABERTA' || p.situacao === 'VENCIDA')
  if (elegiveis.length === 0) throw new Error('Nenhuma parcela elegível (apenas em aberto ou vencidas).')

  let valorOriginal = 0, encargos = 0
  for (const p of elegiveis) {
    const e = calcularEncargos(p as any, cfg)
    valorOriginal += e.original
    encargos += e.multa + e.juros
  }

  const avisos: string[] = []
  let numParcelas = Math.max(1, Math.trunc(params.numParcelas || 1))
  if (params.canalPortal && numParcelas > pol.maxParcelas) {
    numParcelas = pol.maxParcelas
    avisos.push(`O parcelamento pelo portal vai até ${pol.maxParcelas}x — ajustado.`)
  }

  // Desconto só sobre multa/juros: o principal é serviço já prestado.
  const descontoEncargos = params.canalPortal
    ? Math.round(encargos * (pol.descontoEncargosPct / 100))
    : 0
  const total = valorOriginal + encargos - descontoEncargos

  let entrada = Math.max(0, Math.round(params.entradaCentavos || 0))
  const entradaMinima = params.canalPortal ? Math.round(total * (pol.entradaMinimaPct / 100)) : 0
  if (entrada < entradaMinima) {
    entrada = entradaMinima
    if (entradaMinima > 0) avisos.push(`Entrada mínima de ${pol.entradaMinimaPct}% aplicada.`)
  }
  if (entrada >= total) throw new Error('A entrada não pode ser igual ou maior que o total.')

  const restante = total - entrada
  return {
    qtd: elegiveis.length,
    valorOriginalCentavos: valorOriginal,
    encargosCentavos: encargos,
    descontoEncargosCentavos: descontoEncargos,
    totalCentavos: total,
    entradaCentavos: entrada,
    numParcelas,
    valorParcelaCentavos: Math.round(restante / numParcelas),
    politica: pol,
    avisos,
  }
}

/** Vencimento mensal preservando o dia. */
function venc(primeiro: Date, i: number): Date {
  const d = new Date(primeiro)
  d.setMonth(d.getMonth() + i)
  return d
}

export interface AceiteAcordo {
  nome?: string | null
  documento?: string | null
  ip?: string | null
  userAgent?: string | null
}

/**
 * Efetiva o acordo: cria o registro, marca as originais como RENEGOCIADA e
 * emite as novas parcelas. Tudo em transação — um acordo pela metade deixaria
 * a dívida duplicada.
 */
export async function efetivar(params: {
  parcelaIds: number[]
  numParcelas: number
  entradaCentavos?: number
  primeiroVencimento?: Date
  observacao?: string | null
  origem?: 'SECRETARIA' | 'PORTAL_ALUNO' | 'PORTAL_RESPONSAVEL'
  canalPortal?: boolean
  aceite?: AceiteAcordo
}) {
  const origem = params.origem ?? 'SECRETARIA'
  const canalPortal = params.canalPortal ?? origem !== 'SECRETARIA'
  const pol = await getPolitica()
  if (canalPortal && !pol.portalHabilitado) {
    throw new Error('A negociação pelo portal não está habilitada nesta instituição.')
  }

  const sim = await simular({
    parcelaIds: params.parcelaIds,
    numParcelas: params.numParcelas,
    ...(params.entradaCentavos !== undefined ? { entradaCentavos: params.entradaCentavos } : {}),
    canalPortal,
  })

  const parcelas = await prisma.acaParcela.findMany({
    where: { id: { in: params.parcelaIds }, situacao: { in: ['ABERTA', 'VENCIDA'] } },
    select: { id: true, contratoId: true, contrato: { select: { matricula: { select: { alunoId: true } } } } },
  })
  const alunoIds = new Set(parcelas.map((p) => p.contrato.matricula.alunoId))
  if (alunoIds.size !== 1) throw new Error('Selecione parcelas de um único aluno.')
  const alunoId = [...alunoIds][0]!
  const contratoId = parcelas[0]!.contratoId
  const primeiro = params.primeiroVencimento ?? venc(new Date(), 1)

  return prisma.$transaction(async (tx) => {
    const acordo = await tx.acaAcordo.create({
      data: {
        alunoId, contratoId,
        valorOriginalCentavos: sim.valorOriginalCentavos,
        valorEncargosCentavos: sim.encargosCentavos,
        descontoEncargosCentavos: sim.descontoEncargosCentavos,
        valorTotalCentavos: sim.totalCentavos,
        entradaCentavos: sim.entradaCentavos,
        numParcelas: sim.numParcelas,
        valorParcelaCentavos: sim.valorParcelaCentavos,
        observacao: params.observacao ? String(params.observacao).slice(0, 1000) : null,
        origem,
        ...(params.aceite
          ? {
              aceiteEm: new Date(),
              aceiteNome: params.aceite.nome?.substring(0, 191) ?? null,
              aceiteDocumento: params.aceite.documento?.substring(0, 30) ?? null,
              aceiteIp: params.aceite.ip?.substring(0, 45) ?? null,
              aceiteUserAgent: params.aceite.userAgent ?? null,
            }
          : {}),
      },
    })

    await tx.acaParcela.updateMany({
      where: { id: { in: parcelas.map((p) => p.id) } },
      data: { situacao: 'RENEGOCIADA', acordoId: acordo.id },
    })

    const maxNro = (await tx.acaParcela.aggregate({ where: { contratoId }, _max: { nroParcela: true } }))._max.nroParcela || 0
    let nro = maxNro + 1
    if (sim.entradaCentavos > 0) {
      await tx.acaParcela.create({
        data: { contratoId, acordoId: acordo.id, nroParcela: nro++, tipo: 'ACORDO', valorBrutoCentavos: sim.entradaCentavos, dataVencimento: new Date(), situacao: 'ABERTA' },
      })
    }
    const restante = sim.totalCentavos - sim.entradaCentavos
    const valores = Array.from({ length: sim.numParcelas }, () => sim.valorParcelaCentavos)
    const soma = sim.valorParcelaCentavos * sim.numParcelas
    // Os centavos que sobram da divisão vão na última parcela.
    if (soma !== restante) valores[sim.numParcelas - 1] = (valores[sim.numParcelas - 1] ?? 0) + (restante - soma)
    for (let i = 0; i < sim.numParcelas; i++) {
      await tx.acaParcela.create({
        data: { contratoId, acordoId: acordo.id, nroParcela: nro++, tipo: 'ACORDO', valorBrutoCentavos: valores[i]!, dataVencimento: venc(primeiro, i), situacao: 'ABERTA' },
      })
    }
    return { acordo, parcelasCriadas: sim.numParcelas + (sim.entradaCentavos > 0 ? 1 : 0), originaisRenegociadas: parcelas.length }
  })
}
