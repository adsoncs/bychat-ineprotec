// src/lib/etapaDoFunil.ts
//
// Trava de etapa × funil. A chave da etapa (`status` do lead) só vale dentro do
// funil dela: gravar no lead uma chave que o funil não tem deixa a ficha fora
// de todas as colunas do quadro — some do kanban e das métricas sem erro
// nenhum. Quem move lead por configuração (agendamento, desfecho da reunião)
// confere aqui antes.
import { prisma } from './prisma.js'

/** A etapa `key` existe (e está ativa) no funil `funnelId`? */
export async function etapaExisteNoFunil(funnelId: number | null | undefined, key: string | null | undefined): Promise<boolean> {
  if (!funnelId || !key) return false
  const s = await prisma.stage.findFirst({ where: { funnelId, key, active: true }, select: { id: true } })
  return !!s
}

/** Primeira etapa ativa do funil (para lead novo quando a etapa configurada não existe nele). */
export async function primeiraEtapaDoFunil(funnelId: number | null | undefined): Promise<string | null> {
  if (!funnelId) return null
  const s = await prisma.stage.findFirst({ where: { funnelId, active: true }, orderBy: { position: 'asc' }, select: { key: true } })
  return s?.key ?? null
}

/** Das chaves informadas, quais NÃO existem no funil. */
export async function etapasForaDoFunil(funnelId: number, keys: Array<string | null | undefined>): Promise<string[]> {
  const pedidas = [...new Set(keys.filter((k): k is string => !!k))]
  if (!pedidas.length) return []
  const achadas = await prisma.stage.findMany({ where: { funnelId, key: { in: pedidas }, active: true }, select: { key: true } })
  const ok = new Set(achadas.map((s) => s.key))
  return pedidas.filter((k) => !ok.has(k))
}
