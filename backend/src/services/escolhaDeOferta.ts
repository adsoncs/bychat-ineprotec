// src/services/escolhaDeOferta.ts
//
// Fase 5 (23/10/2026) — FERRAMENTA TEMPORÁRIA. Ao ligar as propostas antigas às
// ofertas dos portais, o que não tem relação certa vira PENDÊNCIA: quem vendeu
// escolhe a oferta certa na própria proposta. Quando a lista zerar, a chave é
// desligada e este arquivo pode sair.
//
// Setting `comercial.escolhaDeOferta` =
//   { ligado: boolean,
//     pendencias: { "<negotiationId>": { candidatos: number[], pista: string } } }
// Escolher grava SÓ `Negotiation.offeringId` — valor, data, situação e comissão
// da proposta não mudam. Cada escolha vai para a linha do tempo do lead e para
// a auditoria.

import { prisma } from '../lib/prisma.js'

const CHAVE = 'comercial.escolhaDeOferta'
export interface Pendencia { candidatos: number[]; pista: string }
interface Config { ligado: boolean; pendencias: Record<string, Pendencia> }

async function ler(): Promise<Config> {
  const s = await prisma.setting.findUnique({ where: { key: CHAVE }, select: { value: true } }).catch(() => null)
  let v: any = s?.value ?? {}
  if (typeof v === 'string') { try { v = JSON.parse(v) } catch { v = {} } }
  return { ligado: v?.ligado === true, pendencias: v?.pendencias && typeof v.pendencias === 'object' ? v.pendencias : {} }
}
async function gravar(c: Config): Promise<void> {
  await prisma.setting.upsert({
    where: { key: CHAVE },
    create: { key: CHAVE, value: c as any, label: 'Propostas antigas: escolher a oferta (temporário)', grp: 'comercial', fieldType: 'json' } as any,
    update: { value: c as any },
  })
}

/** Carrega a lista de pendências (substitui a anterior) e liga a ferramenta. */
export async function carregarPendencias(pendencias: Record<string, Pendencia>, ligado = true): Promise<number> {
  await gravar({ ligado, pendencias })
  return Object.keys(pendencias).length
}
export async function ligarEscolha(ligado: boolean): Promise<void> {
  const c = await ler(); await gravar({ ...c, ligado })
}

export interface OpcaoDeOferta { id: number; nome: string; portal: string }

/** Todas as ofertas dos portais ativos, para o "outra oferta". */
export async function opcoesDeOferta(): Promise<OpcaoDeOferta[]> {
  const { ofertasDosPortais } = await import('./catalogoDosPortais.js')
  return (await ofertasDosPortais()).map((o) => ({ id: o.offeringId, nome: o.nome, portal: o.portal }))
}

export interface ItemPendente {
  negotiationId: number; leadId: number; leadNome: string | null; titulo: string
  resultado: string | null; valorFinal: number | null; createdAt: string
  responsavelUserId: number | null; responsavel: string | null
  pista: string; candidatos: OpcaoDeOferta[]
  /** Ganha ou aberta = conta em painel e meta; perdida = opcional. */
  prioridade: 'alta' | 'baixa'
}

/** Pendências visíveis: a gestão vê todas; o agente, as propostas dele. */
export async function listarPendencias(opts: { userId?: number | null } = {}): Promise<{ ligado: boolean; itens: ItemPendente[]; totalGeral: number }> {
  const c = await ler()
  const ids = Object.keys(c.pendencias).map(Number).filter((n) => Number.isInteger(n) && n > 0)
  if (!c.ligado || !ids.length) return { ligado: c.ligado, itens: [], totalGeral: ids.length }
  const negs = await prisma.negotiation.findMany({
    where: { id: { in: ids }, ...(opts.userId ? { responsavelUserId: opts.userId } : {}) },
    select: { id: true, leadId: true, titulo: true, resultado: true, valorFinal: true, createdAt: true, responsavelUserId: true },
  })
  const userIds = [...new Set(negs.map((n) => n.responsavelUserId).filter((x): x is number => !!x))]
  const users = new Map((await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]))
  const nomes = new Map((await prisma.lead.findMany({ where: { id: { in: negs.map((n) => n.leadId) } }, select: { id: true, nome: true } })).map((l) => [l.id, l.nome]))
  const opcoes = new Map((await opcoesDeOferta()).map((o) => [o.id, o]))
  const itens = negs.map((n): ItemPendente => {
    const p = c.pendencias[String(n.id)]!
    return {
      negotiationId: n.id, leadId: n.leadId, leadNome: nomes.get(n.leadId) ?? null, titulo: n.titulo,
      resultado: n.resultado, valorFinal: n.valorFinal == null ? null : Number(n.valorFinal), createdAt: n.createdAt.toISOString(),
      responsavelUserId: n.responsavelUserId, responsavel: n.responsavelUserId ? users.get(n.responsavelUserId) ?? null : null,
      pista: p.pista, candidatos: p.candidatos.map((id) => opcoes.get(id)).filter((o): o is OpcaoDeOferta => !!o),
      prioridade: n.resultado === 'lost' ? 'baixa' : 'alta',
    }
  })
  itens.sort((a, b) => (a.prioridade === b.prioridade ? b.createdAt.localeCompare(a.createdAt) : a.prioridade === 'alta' ? -1 : 1))
  return { ligado: true, itens, totalGeral: ids.length }
}

export async function pendenciaDaProposta(negotiationId: number): Promise<ItemPendente | null> {
  const c = await ler()
  if (!c.ligado || !c.pendencias[String(negotiationId)]) return null
  return (await listarPendencias()).itens.find((i) => i.negotiationId === negotiationId) ?? null
}

/**
 * Grava a escolha: a oferta (ou "sem curso") e tira a proposta da lista.
 * `offeringId` precisa ser uma oferta de portal ativo.
 */
export async function escolherOferta(negotiationId: number, escolha: { offeringId: number | null; semCurso?: boolean }, quem: { userId: number | null; nome: string | null }): Promise<{ ok: true } | { ok: false; erro: string }> {
  const n = await prisma.negotiation.findUnique({ where: { id: negotiationId }, select: { id: true, leadId: true, titulo: true, offeringId: true } })
  if (!n) return { ok: false, erro: 'Negociação não encontrada' }
  let rotulo = 'sem curso'
  if (!escolha.semCurso) {
    const o = (await opcoesDeOferta()).find((x) => x.id === escolha.offeringId)
    if (!o) return { ok: false, erro: 'Escolha uma oferta dos portais' }
    rotulo = `${o.nome} (${o.portal})`
  }
  await prisma.negotiation.update({ where: { id: negotiationId }, data: { offeringId: escolha.semCurso ? null : escolha.offeringId } })
  const c = await ler()
  delete c.pendencias[String(negotiationId)]
  await gravar(c)
  const { logEvent } = await import('./leadHistory.js')
  logEvent({
    leadId: n.leadId, type: 'negotiation_offering_set' as any, category: 'lifecycle',
    title: `Curso da proposta "${n.titulo}": ${rotulo}`,
    source: 'panel', actorType: 'operator', userId: quem.userId ?? undefined, userName: quem.nome ?? undefined,
    metadata: { negotiationId, antes: n.offeringId, depois: escolha.semCurso ? null : escolha.offeringId, semCurso: !!escolha.semCurso },
  })
  const { logUserAudit } = await import('./userAudit.js')
  await logUserAudit({ action: 'negotiation.offering_set', actorId: quem.userId, actorName: quem.nome, targetType: 'lead', targetLabel: `Negociação #${negotiationId} → ${rotulo}`.slice(0, 191), changes: { negotiationId, antes: n.offeringId, depois: escolha.semCurso ? null : escolha.offeringId } })
  return { ok: true }
}

/** Proposta ganhou oferta por outro caminho (item espelho): sai da lista. */
export async function resolverSeLigada(negotiationId: number): Promise<void> {
  const c = await ler()
  if (!c.pendencias[String(negotiationId)]) return
  const n = await prisma.negotiation.findUnique({ where: { id: negotiationId }, select: { offeringId: true } })
  if (n?.offeringId) { delete c.pendencias[String(negotiationId)]; await gravar(c) }
}
