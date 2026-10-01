// Cobranças de uma inscrição: agrupamento das tentativas repetidas e o resumo
// do valor real (cupom e desconto aplicados) — usado no detalhe da inscrição e
// no Financeiro do portal, para as duas telas dizerem a mesma coisa.

interface CobrancaBase {
  id: number
  method: string
  provider: string
  status: string
  amount: string | number | null
  lastErrorMessage: string | null
}

export interface GrupoDeCobrancas<T extends CobrancaBase> {
  chave: string
  /** A mais recente do grupo — é a que aparece. */
  principal: T
  itens: T[]
}

/**
 * Junta tentativas iguais (mesmo meio, gateway, status, valor e mensagem) num
 * grupo só: cinco "PIX · falhou · valor mínimo" viram uma linha "5×" que abre
 * os detalhes. Pendente e paga nunca se juntam — cada uma é uma cobrança viva.
 * A ordem da lista (mais recente primeiro) é mantida.
 */
export function agruparCobrancas<T extends CobrancaBase>(lista: T[]): GrupoDeCobrancas<T>[] {
  const grupos: GrupoDeCobrancas<T>[] = []
  const porChave = new Map<string, GrupoDeCobrancas<T>>()
  for (const c of lista) {
    const viva = c.status === 'pending' || c.status === 'paid'
    const chave = viva
      ? `#${c.id}`
      : [c.status, c.method, c.provider, Number(c.amount ?? 0).toFixed(2), (c.lastErrorMessage ?? '').trim()].join('|')
    const g = porChave.get(chave)
    if (g) g.itens.push(c)
    else {
      const novo = { chave, principal: c, itens: [c] }
      porChave.set(chave, novo)
      grupos.push(novo)
    }
  }
  return grupos
}

export interface ResumoFinanceiro {
  /** Antes de cupom e desconto. */
  valorCheio: number | null
  cupom: string | null
  descontoCupom: number
  descontoAVista: number
  acrescimo: number
  /** O que a instituição recebe nesta cobrança (antes das taxas do gateway). */
  valorCobrado: number | null
  parcelas: number
  meio: string | null
}

/** Lê o plano gravado no checkout (paymentPlan) no formato que as telas mostram. */
export function resumoDoPlano(plano: unknown, pago?: { status: string | null; valor: string | number | null }): ResumoFinanceiro | null {
  if (!plano || typeof plano !== 'object') return null
  const p = plano as Record<string, any>
  const num = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
  const valorCobrado = pago?.status === 'paid' && num(pago.valor) != null ? num(pago.valor) : num(p.valorCobrado)
  return {
    valorCheio: num(p.valorCheio) ?? num(p.valorTabela),
    cupom: p.cupom ? String(p.cupom) : null,
    descontoCupom: num(p.descontoCupom) ?? 0,
    descontoAVista: num(p.descontoAVista) ?? 0,
    acrescimo: num(p.acrescimo) ?? 0,
    valorCobrado,
    parcelas: Math.max(1, num(p.parcelas) ?? 1),
    meio: p.meio ? String(p.meio) : null,
  }
}

export const reais = (v: number | string | null | undefined) =>
  v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
