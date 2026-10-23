// src/services/catalogoDosPortais.ts
//
// Fase 5 da integração Negociações × Educacional (23/10/2026): o CATÁLOGO é
// um espelho dos PORTAIS. A fonte da verdade de curso, nome e preço é a oferta
// do portal; o produto que o vendedor escolhe na proposta é cópia dela.
//
//   - 1 produto por oferta de portal ativo (sku `oferta-<id>`, courseId da oferta);
//   - nome = nome da oferta; categoria = nome do portal (o mesmo curso em dois
//     portais — escola e consultoria — aparece separado no seletor);
//   - preço = valor do curso inteiro pelo 1º plano ativo da oferta (sem plano:
//     o produto não é criado, porque não há preço de verdade para copiar);
//   - oferta que saiu dos portais → o produto espelho é desativado (nunca apagado:
//     as propostas antigas continuam apontando para ele).
// Produtos cadastrados à mão não são tocados.
//
// Chave em Setting `catalogo.espelhoPortais` ({ ligado }). Ligado, a cópia
// roda a cada 10 min; o botão do Catálogo roda na hora.

import { prisma } from '../lib/prisma.js'

const CHAVE = 'catalogo.espelhoPortais'
export const SKU = (offeringId: number) => `oferta-${offeringId}`
export const ofertaDoSku = (sku: string | null | undefined): number | null => {
  const m = /^oferta-(\d+)$/.exec(String(sku ?? ''))
  return m ? Number(m[1]) : null
}

export async function espelhoLigado(): Promise<boolean> {
  const s = await prisma.setting.findUnique({ where: { key: CHAVE }, select: { value: true } }).catch(() => null)
  let v: any = s?.value ?? {}
  if (typeof v === 'string') { try { v = JSON.parse(v) } catch { v = {} } }
  return v?.ligado === true
}
export async function salvarEspelho(ligado: boolean): Promise<void> {
  await prisma.setting.upsert({
    where: { key: CHAVE },
    create: { key: CHAVE, value: { ligado } as any, label: 'Catálogo: espelho das ofertas dos portais', grp: 'comercial', fieldType: 'json' } as any,
    update: { value: { ligado } as any },
  })
}

interface OfertaDoPortal { offeringId: number; nome: string; courseId: number; portal: string; preco: number | null }

/** Ofertas dos portais ativos, com o portal (o de menor id, se estiver em dois) e o preço do curso. */
export async function ofertasDosPortais(): Promise<OfertaDoPortal[]> {
  const { valorIntegral, planosDaOferta } = await import('./planoFinanceiro.js')
  const portais = await prisma.enrollmentPortal.findMany({ where: { active: true }, select: { id: true, nome: true, selectionProcessIds: true }, orderBy: { id: 'asc' } })
  const processoDoPortal = new Map<number, string>()
  for (const p of portais) {
    for (const sp of (Array.isArray(p.selectionProcessIds) ? p.selectionProcessIds : []) as unknown[]) {
      const id = Number(sp)
      if (Number.isInteger(id) && !processoDoPortal.has(id)) processoDoPortal.set(id, p.nome)
    }
  }
  if (!processoDoPortal.size) return []
  const ofertas = await prisma.courseOffering.findMany({
    where: { selectionProcessId: { in: [...processoDoPortal.keys()] }, active: true },
    select: { id: true, nome: true, courseId: true, selectionProcessId: true },
    orderBy: { id: 'asc' },
  })
  const out: OfertaDoPortal[] = []
  for (const o of ofertas) {
    const plano = (await planosDaOferta(o.id))[0]
    out.push({ offeringId: o.id, nome: o.nome, courseId: o.courseId, portal: processoDoPortal.get(o.selectionProcessId!)!, preco: plano ? valorIntegral(plano) : null })
  }
  return out
}

export interface ResultadoEspelho {
  criados: { oferta: number; nome: string }[]
  atualizados: { oferta: number; nome: string; mudou: string[] }[]
  desativados: { produto: number; nome: string }[]
  semPlano: { oferta: number; nome: string; portal: string }[]
  iguais: number
}

/** Copia as ofertas dos portais para o Catálogo. `gravar: false` só simula. */
export async function sincronizarCatalogo(opts: { gravar: boolean }): Promise<ResultadoEspelho> {
  const r: ResultadoEspelho = { criados: [], atualizados: [], desativados: [], semPlano: [], iguais: 0 }
  const ofertas = await ofertasDosPortais()
  const espelhos = await prisma.product.findMany({ where: { sku: { startsWith: 'oferta-' } } })
  const porOferta = new Map(espelhos.map((p) => [ofertaDoSku(p.sku), p]))
  const vistas = new Set<number>()
  for (const o of ofertas) {
    if (o.preco == null) { r.semPlano.push({ oferta: o.offeringId, nome: o.nome, portal: o.portal }); continue }
    vistas.add(o.offeringId)
    const alvo = { nome: o.nome.slice(0, 191), categoria: o.portal.slice(0, 100), preco: o.preco, courseId: o.courseId, cobranca: 'unico', active: true, disponivel: true }
    const atual = porOferta.get(o.offeringId)
    if (!atual) {
      if (opts.gravar) await prisma.product.create({ data: { ...alvo, sku: SKU(o.offeringId) } as any })
      r.criados.push({ oferta: o.offeringId, nome: o.nome })
      continue
    }
    const mudou: string[] = []
    if (atual.nome !== alvo.nome) mudou.push('nome')
    if (atual.categoria !== alvo.categoria) mudou.push('categoria')
    if (atual.preco == null || Number(atual.preco) !== alvo.preco) mudou.push('preço')
    if (atual.courseId !== alvo.courseId) mudou.push('curso')
    if (!atual.active || !atual.disponivel || atual.cobranca !== 'unico') mudou.push('ativo')
    if (!mudou.length) { r.iguais++; continue }
    if (opts.gravar) await prisma.product.update({ where: { id: atual.id }, data: alvo as any })
    r.atualizados.push({ oferta: o.offeringId, nome: o.nome, mudou })
  }
  for (const p of espelhos) {
    const of = ofertaDoSku(p.sku)
    if (of != null && !vistas.has(of) && p.active) {
      if (opts.gravar) await prisma.product.update({ where: { id: p.id }, data: { active: false } })
      r.desativados.push({ produto: p.id, nome: p.nome })
    }
  }
  return r
}

/**
 * A oferta da proposta, pelos produtos espelho dos itens: todos apontando para
 * a MESMA oferta → ela; nenhum ou mais de uma → null (não adivinha).
 */
export async function ofertaPelosItens(productIds: (number | null | undefined)[]): Promise<number | null> {
  const ids = [...new Set(productIds.filter((x): x is number => !!x))]
  if (!ids.length) return null
  const prods = await prisma.product.findMany({ where: { id: { in: ids } }, select: { sku: true } })
  const ofertas = new Set(prods.map((p) => ofertaDoSku(p.sku)))
  if (ofertas.size !== 1 || ofertas.has(null)) return null
  return [...ofertas][0]!
}

let ligado = false
export function ligarEspelhoDoCatalogo(): void {
  if (ligado) return
  ligado = true
  setInterval(async () => {
    if (!(await espelhoLigado())) return
    await sincronizarCatalogo({ gravar: true }).catch((e) => console.warn('[catalogoDosPortais]', (e as Error).message))
  }, 10 * 60_000).unref()
}
