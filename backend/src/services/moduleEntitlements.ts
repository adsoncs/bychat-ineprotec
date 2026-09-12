// src/services/moduleEntitlements.ts
//
// Direito de uso: o que a loja vendeu a esta instalação.
//
// São DUAS perguntas, e a confusão entre elas é o que impede vender módulo:
//
//   tem direito?  → esta tabela, escrita pela loja
//   está ligado?  → Module.active, escrito pelo admin
//
// O módulo funciona quando as duas respondem sim. Se a compra apenas ligasse o
// interruptor, sumiria a diferença entre "não comprou" e "comprou e desligou":
// o cancelamento não saberia o que reverter, e qualquer admin ligaria sozinho
// o que não pagou.
//
// PREÇO NÃO MORA AQUI. Cada instalação tem banco próprio e a loja é central: o
// tenant guarda o que pode usar, a loja guarda quanto custa. Preço aqui
// significaria mudar valor em doze bancos a cada promoção.

import { prisma } from '../lib/prisma.js'
import { MODULE_REGISTRY, UMBRELLA_REQUIRES, type ModuleUmbrella } from '../lib/moduleRegistry.js'

export type OrigemDireito = 'pacote' | 'avulso' | 'cortesia' | 'teste' | 'migracao'

/** Quanto tempo a resposta fica em memória. Curto: comprar precisa valer já. */
const TTL_MS = 30_000
let cache: { em: number; ids: Set<string> } | null = null

export function invalidarCacheDeDireitos(): void {
  cache = null
}

/**
 * Ids dos módulos com direito VIGENTE agora.
 *
 * Um direito vencido simplesmente não entra: não há rotina apagando linha, e
 * não deve haver — o histórico de quem teve o quê é o que permite reativar sem
 * recomprar, e responder "até quando ele teve isso?" meses depois.
 */
export async function modulosComDireito(): Promise<Set<string>> {
  if (cache && Date.now() - cache.em < TTL_MS) return cache.ids
  const agora = new Date()
  const linhas = await prisma.moduleEntitlement.findMany({
    where: { inicioEm: { lte: agora }, OR: [{ expiraEm: null }, { expiraEm: { gt: agora } }] },
    select: { moduleId: true },
  })
  const ids = new Set(linhas.map((l) => l.moduleId))
  // Core nunca depende de compra: é a plataforma. Cobrar à parte por ele seria
  // vender ao cliente o que ele já tem — e desligá-lo derruba o produto.
  for (const m of MODULE_REGISTRY) if (m.core) ids.add(m.id)
  cache = { em: Date.now(), ids }
  return ids
}

export async function temDireito(moduleId: string): Promise<boolean> {
  return (await modulosComDireito()).has(moduleId)
}

/**
 * Concede um pacote inteiro: todo módulo do guarda-chuva, mais os pacotes que
 * ele exige.
 *
 * A recursão não é enfeite: 4 módulos do ERP dependem do Educacional, e vender
 * ERP a quem não o tem entrega telas que não abrem. Melhor conceder junto e
 * calado do que deixar o cliente descobrir na segunda-feira.
 */
export async function concederPacote(input: {
  pacote: ModuleUmbrella
  expiraEm?: Date | null
  referencia?: string
  concedidoPor?: string
}): Promise<{ concedidos: string[]; pacotes: ModuleUmbrella[] }> {
  const pacotes: ModuleUmbrella[] = []
  const fila: ModuleUmbrella[] = [input.pacote]
  while (fila.length) {
    const p = fila.shift()!
    if (pacotes.includes(p)) continue
    pacotes.push(p)
    for (const exigido of UMBRELLA_REQUIRES[p] ?? []) fila.push(exigido)
  }

  const alvos = MODULE_REGISTRY.filter((m) => !m.core && pacotes.includes(m.umbrella))
  for (const m of alvos) {
    await prisma.moduleEntitlement.upsert({
      where: { moduleId_origem: { moduleId: m.id, origem: 'pacote' } },
      create: {
        moduleId: m.id, origem: 'pacote', pacote: m.umbrella,
        expiraEm: input.expiraEm ?? null,
        ...(input.referencia ? { referencia: input.referencia } : {}),
        ...(input.concedidoPor ? { concedidoPor: input.concedidoPor } : {}),
      },
      // Renovar é empurrar a data, não criar linha nova: a assinatura é a
      // mesma, e duplicar o direito quebraria a revogação por pacote.
      update: {
        pacote: m.umbrella,
        expiraEm: input.expiraEm ?? null,
        ...(input.referencia ? { referencia: input.referencia } : {}),
      },
    })
  }
  invalidarCacheDeDireitos()
  return { concedidos: alvos.map((m) => m.id), pacotes }
}

/** Um módulo solto — venda avulsa, cortesia de negociação ou teste com prazo. */
export async function concederModulo(input: {
  moduleId: string
  origem: Exclude<OrigemDireito, 'pacote'>
  expiraEm?: Date | null
  referencia?: string
  concedidoPor?: string
}): Promise<void> {
  const def = MODULE_REGISTRY.find((m) => m.id === input.moduleId)
  if (!def) throw new Error(`Módulo desconhecido: ${input.moduleId}`)
  if (def.core) return // já é da base; conceder seria registrar o óbvio

  await prisma.moduleEntitlement.upsert({
    where: { moduleId_origem: { moduleId: def.id, origem: input.origem } },
    create: {
      moduleId: def.id, origem: input.origem, expiraEm: input.expiraEm ?? null,
      ...(input.referencia ? { referencia: input.referencia } : {}),
      ...(input.concedidoPor ? { concedidoPor: input.concedidoPor } : {}),
    },
    update: { expiraEm: input.expiraEm ?? null, ...(input.referencia ? { referencia: input.referencia } : {}) },
  })
  invalidarCacheDeDireitos()
}

/**
 * Cancelamento: tira o que UM pacote concedeu, e nada mais.
 *
 * Só remove linhas de `origem: 'pacote'` daquele guarda-chuva. Um módulo que
 * também foi dado em cortesia continua de pé — quem prometeu aquilo numa
 * negociação não previa que cancelar outra coisa fosse levá-lo junto.
 */
export async function revogarPacote(pacote: ModuleUmbrella): Promise<number> {
  const { count } = await prisma.moduleEntitlement.deleteMany({ where: { origem: 'pacote', pacote } })
  invalidarCacheDeDireitos()
  return count
}

/** O que esta instalação tem, agrupado por pacote — para a tela e para a loja. */
export async function resumoDeDireitos(): Promise<{
  pacote: string
  modulos: { id: string; nome: string; origem: string; expiraEm: Date | null }[]
}[]> {
  const linhas = await prisma.moduleEntitlement.findMany({ orderBy: { moduleId: 'asc' } })
  const porId = new Map(MODULE_REGISTRY.map((m) => [m.id, m]))
  const grupos = new Map<string, { id: string; nome: string; origem: string; expiraEm: Date | null }[]>()
  for (const l of linhas) {
    const def = porId.get(l.moduleId)
    if (!def) continue // módulo removido do código: o direito sobra sem dono
    const chave = def.umbrella
    const lista = grupos.get(chave) ?? []
    lista.push({ id: def.id, nome: def.name, origem: l.origem, expiraEm: l.expiraEm })
    grupos.set(chave, lista)
  }
  return [...grupos.entries()].map(([pacote, modulos]) => ({ pacote, modulos }))
}
