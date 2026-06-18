// src/services/acaEncargos.ts
// Módulo Acadêmico · Fin-2 — Juros, multa e desconto de pontualidade.
// Regras CONFIGURÁVEIS (Settings grp=academico). Cálculo puro p/ reuso na
// Central Financeira, na cobrança Asaas e na baixa.

import { prisma } from '../lib/prisma.js'

const KEYS = ['aca.fin.multa_pct', 'aca.fin.juros_mes_pct', 'aca.fin.carencia_dias', 'aca.fin.desconto_pontualidade_pct'] as const
const DEFAULTS: Record<string, number> = { 'aca.fin.multa_pct': 2, 'aca.fin.juros_mes_pct': 1, 'aca.fin.carencia_dias': 0, 'aca.fin.desconto_pontualidade_pct': 0 }

export interface EncargosConfig { multaPct: number; jurosMesPct: number; carenciaDias: number; descontoPontualidadePct: number }

export async function getEncargosConfig(): Promise<EncargosConfig> {
  const rows = await prisma.setting.findMany({ where: { key: { in: KEYS as unknown as string[] } } })
  const v = (k: string) => { const r = rows.find((x) => x.key === k); return r ? Number(r.value as any) : DEFAULTS[k] }
  return { multaPct: v('aca.fin.multa_pct'), jurosMesPct: v('aca.fin.juros_mes_pct'), carenciaDias: v('aca.fin.carencia_dias'), descontoPontualidadePct: v('aca.fin.desconto_pontualidade_pct') }
}

export async function setEncargosConfig(b: Partial<EncargosConfig>): Promise<EncargosConfig> {
  const map: Record<string, any> = { 'aca.fin.multa_pct': b.multaPct, 'aca.fin.juros_mes_pct': b.jurosMesPct, 'aca.fin.carencia_dias': b.carenciaDias, 'aca.fin.desconto_pontualidade_pct': b.descontoPontualidadePct }
  for (const k of KEYS) {
    if (map[k] === undefined) continue
    const val = Math.max(0, Number(map[k]) || 0)
    await prisma.setting.upsert({ where: { key: k }, update: { value: val as any }, create: { key: k, label: k, grp: 'academico', fieldType: 'number', value: val as any } })
  }
  return getEncargosConfig()
}

export interface ParcelaCalc { valorBrutoCentavos: number; dataVencimento: Date | string; situacao: string }
export interface Encargos {
  original: number; multa: number; juros: number; desconto: number
  diasAtraso: number; vencida: boolean
  valorCobranca: number   // o que cobrar/atualizar (principal + multa + juros)
  valorAtual: number      // o que receber agora (cobrança OU principal-desconto se pontual)
}

const inicioDia = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }

/** Calcula encargos de uma parcela em relação a `ref` (default hoje). */
export function calcularEncargos(p: ParcelaCalc, cfg: EncargosConfig, ref = new Date()): Encargos {
  const original = p.valorBrutoCentavos
  const base: Encargos = { original, multa: 0, juros: 0, desconto: 0, diasAtraso: 0, vencida: false, valorCobranca: original, valorAtual: original }
  if (p.situacao === 'PAGA' || p.situacao === 'CANCELADA' || p.situacao === 'RENEGOCIADA') return base

  const venc = inicioDia(new Date(p.dataVencimento))
  const hoje = inicioDia(ref)
  const diasAtraso = Math.floor((hoje.getTime() - venc.getTime()) / 86400_000)
  base.diasAtraso = Math.max(0, diasAtraso)

  if (diasAtraso > cfg.carenciaDias) {
    const efetivos = diasAtraso - cfg.carenciaDias
    const multa = Math.round(original * (cfg.multaPct / 100))
    const juros = Math.round(original * (cfg.jurosMesPct / 100) * (efetivos / 30))
    base.multa = multa; base.juros = juros; base.vencida = true
    base.valorCobranca = original + multa + juros
    base.valorAtual = base.valorCobranca
  } else if (diasAtraso <= 0 && cfg.descontoPontualidadePct > 0) {
    const desconto = Math.round(original * (cfg.descontoPontualidadePct / 100))
    base.desconto = desconto
    base.valorAtual = original - desconto
  }
  return base
}
