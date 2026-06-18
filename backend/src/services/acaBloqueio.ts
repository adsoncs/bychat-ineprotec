// src/services/acaBloqueio.ts
// Módulo Acadêmico · Fin-4 — Bloqueio acadêmico por inadimplência.
// Regra CONFIGURÁVEL: bloqueia rematrícula / boletim quando o aluno tem N
// parcela(s) vencida(s) além da tolerância (em dias).

import { prisma } from '../lib/prisma.js'

const KEYS = ['aca.fin.bloqueio_enabled', 'aca.fin.bloqueio_tolerancia_dias', 'aca.fin.bloqueio_min_parcelas'] as const
const DEFAULTS: Record<string, any> = { 'aca.fin.bloqueio_enabled': false, 'aca.fin.bloqueio_tolerancia_dias': 30, 'aca.fin.bloqueio_min_parcelas': 1 }

export interface BloqueioConfig { enabled: boolean; toleranciaDias: number; minParcelas: number }

export async function getBloqueioConfig(): Promise<BloqueioConfig> {
  const rows = await prisma.setting.findMany({ where: { key: { in: KEYS as unknown as string[] } } })
  const v = (k: string) => { const r = rows.find((x) => x.key === k); return r ? (r.value as any) : DEFAULTS[k] }
  return { enabled: !!v('aca.fin.bloqueio_enabled'), toleranciaDias: Number(v('aca.fin.bloqueio_tolerancia_dias')) || 0, minParcelas: Number(v('aca.fin.bloqueio_min_parcelas')) || 1 }
}

export async function setBloqueioConfig(b: Partial<BloqueioConfig>): Promise<BloqueioConfig> {
  const map: Record<string, any> = { 'aca.fin.bloqueio_enabled': b.enabled, 'aca.fin.bloqueio_tolerancia_dias': b.toleranciaDias, 'aca.fin.bloqueio_min_parcelas': b.minParcelas }
  for (const k of KEYS) {
    if (map[k] === undefined) continue
    const isBool = k === 'aca.fin.bloqueio_enabled'
    const val = isBool ? !!map[k] : Math.max(0, Number(map[k]) || 0)
    await prisma.setting.upsert({ where: { key: k }, update: { value: val as any }, create: { key: k, label: k, grp: 'academico', fieldType: isBool ? 'boolean' : 'number', value: val as any } })
  }
  return getBloqueioConfig()
}

export interface BloqueioStatus { bloqueado: boolean; parcelasVencidas: number; diasMaxAtraso: number; valorVencido: number; motivo: string | null }

/** Avalia o status de bloqueio financeiro de um aluno. */
export async function statusBloqueio(alunoId: number, cfg?: BloqueioConfig): Promise<BloqueioStatus> {
  const c = cfg || (await getBloqueioConfig())
  const mats = await prisma.acaMatricula.findMany({ where: { alunoId }, select: { id: true } })
  const contratos = mats.length ? await prisma.acaContrato.findMany({ where: { matriculaId: { in: mats.map((m) => m.id) } }, select: { id: true } }) : []
  if (!contratos.length) return { bloqueado: false, parcelasVencidas: 0, diasMaxAtraso: 0, valorVencido: 0, motivo: null }
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0)
  const limite = new Date(hoje.getTime() - c.toleranciaDias * 86400_000)
  const vencidas = await prisma.acaParcela.findMany({
    where: { contratoId: { in: contratos.map((x) => x.id) }, situacao: { in: ['ABERTA', 'VENCIDA'] }, dataVencimento: { lt: limite } },
    select: { valorBrutoCentavos: true, dataVencimento: true },
  })
  const diasMax = vencidas.reduce((mx, p) => { const d = Math.floor((hoje.getTime() - new Date(p.dataVencimento).setHours(0, 0, 0, 0)) / 86400_000); return Math.max(mx, d) }, 0)
  const valorVencido = vencidas.reduce((s, p) => s + p.valorBrutoCentavos, 0)
  const bloqueado = c.enabled && vencidas.length >= c.minParcelas
  return {
    bloqueado, parcelasVencidas: vencidas.length, diasMaxAtraso: diasMax, valorVencido,
    motivo: bloqueado ? `${vencidas.length} parcela(s) vencida(s) há mais de ${c.toleranciaDias} dia(s)` : null,
  }
}
