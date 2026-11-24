// src/lib/unidadesFinanceiro.ts
//
// Unidade (empresa) de cada portal, para o Financeiro e a Inadimplência
// separarem o que é de cada uma (ineprotec, 24/11: INEPROTEC × Matrícula EAD
// misturados nas mesmas listas e nos mesmos totais).
//
// A unidade é a do portal da inscrição (EnrollmentPortal.unitId). A cor vem da
// identidade do portal no painel (identidadePainel.cor), a mesma dos cards de
// Portais; sem cor, a tela usa a neutra.

import { prisma } from './prisma.js'

export interface UnidadeDoFinanceiro {
  id: number
  nome: string
  cor: string | null
  portalIds: number[]
}

export interface MarcaDaUnidade { id: number; nome: string; cor: string | null }

function corDe(identidade: unknown): string | null {
  const c = (identidade as any)?.cor
  return typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c) ? c : null
}

function ordemDe(identidade: unknown): number {
  const o = Number((identidade as any)?.ordem)
  return Number.isFinite(o) ? o : 9999
}

/** Unidades que têm portal, na ordem dos portais delas (a do primeiro portal vem antes). */
export async function unidadesDoFinanceiro(): Promise<UnidadeDoFinanceiro[]> {
  const portais = await prisma.enrollmentPortal.findMany({
    select: { id: true, unitId: true, identidadePainel: true, unit: { select: { nome: true } } },
  })
  const porUnidade = new Map<number, { u: UnidadeDoFinanceiro; ordem: number }>()
  for (const p of portais.sort((a, b) => ordemDe(a.identidadePainel) - ordemDe(b.identidadePainel) || a.id - b.id)) {
    const atual = porUnidade.get(p.unitId)
    if (atual) { atual.u.portalIds.push(p.id); atual.u.cor ??= corDe(p.identidadePainel); continue }
    porUnidade.set(p.unitId, {
      u: { id: p.unitId, nome: p.unit?.nome ?? `Unidade ${p.unitId}`, cor: corDe(p.identidadePainel), portalIds: [p.id] },
      ordem: ordemDe(p.identidadePainel),
    })
  }
  return [...porUnidade.values()].sort((a, b) => a.ordem - b.ordem || a.u.id - b.u.id).map((x) => x.u)
}

/** portalId → unidade (id, nome, cor). */
export async function marcaPorPortal(): Promise<Map<number, MarcaDaUnidade>> {
  const out = new Map<number, MarcaDaUnidade>()
  for (const u of await unidadesDoFinanceiro()) for (const pid of u.portalIds) out.set(pid, { id: u.id, nome: u.nome, cor: u.cor })
  return out
}

/** unitId vindo da query (?unitId=2); vazio ou inválido = todas. */
export function unitIdDaQuery(q: any): number | null {
  const n = parseInt(String(q?.unitId ?? ''), 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Ids dos portais de uma unidade. */
export async function portaisDaUnidade(unitId: number): Promise<number[]> {
  const ps = await prisma.enrollmentPortal.findMany({ where: { unitId }, select: { id: true } })
  return ps.map((p) => p.id)
}
