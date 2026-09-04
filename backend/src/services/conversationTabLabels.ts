// src/services/conversationTabLabels.ts
//
// Os nomes E a ordem das abas do Conversas, por instalação.
//
// "Caixa", "Atendimento", "Setor" são o vocabulário de UM jeito de trabalhar.
// Escola fala em "Secretaria", clínica em "Recepção", agência em "Prospecção" —
// e a equipe passa o dia relendo um rótulo que não é o dela. Aqui o admin troca
// o nome sem que nada mais mude: as regras de cada aba continuam as mesmas, só
// a palavra é da casa.
//
// A ORDEM segue a mesma ideia: quem trabalha por fila começa o dia na Caixa,
// quem trabalha por carteira começa em Atendimento. A posição na barra é só
// desenho — o que cada aba mostra continua idêntico. A única consequência de
// regra é combinada: a PRIMEIRA aba de cada barra é a que abre quando o
// operador entra na tela.
//
// Guardado como UMA Setting em JSON. Ler é liberado a qualquer operador (a tela
// precisa dos nomes para desenhar), escrever é de administrador.

import { prisma } from '../lib/prisma.js'

export const TAB_LABELS_KEY = 'conversations.tab_labels'

export const ESCOPOS = ['mine', 'team', 'all'] as const
export const CAIXAS = ['inbox', 'raw', 'snoozed', 'resolved', 'all'] as const

export type Escopo = (typeof ESCOPOS)[number]
export type Caixa = (typeof CAIXAS)[number]

/**
 * Os itens que exibem contador na barra.
 *
 * `groups` entra aqui e NÃO em `CAIXAS` de propósito: as caixas são estados da
 * conversa (em atendimento, na fila, aguardando, resolvida) e o servidor as
 * usa como filtro de `bucket`. Grupos é outro eixo — recorta o TIPO da
 * conversa. Ele tem contador, então precisa da chave; não tem estado, então
 * não entra na lista de caixas nem ganha nome e ordem.
 */
export const ITENS_CONTADOR = [...CAIXAS, 'groups'] as const
export type ItemContador = (typeof ITENS_CONTADOR)[number]


export interface TabOrder {
  scope: Escopo[]
  bucket: Caixa[]
}

export interface TabLabels {
  scope: Record<Escopo, string>
  bucket: Record<Caixa, string>
  order: TabOrder
  /**
   * Mostrar o número de conversas — POR ITEM da barra.
   *
   * Nasce tudo ligado: o contador é útil e tirá-lo sem pedir mudaria a tela de
   * quem já a conhece. Mas contador em toda aba tem custo — quando todas têm
   * número, nenhum número chama atenção — e o que incomoda varia por item: o
   * total de "Todos" com centenas na frente desanima, enquanto o de
   * "Atendimento" é o que orienta o dia. Por isso é um por aba, e não um
   * interruptor só.
   *
   * Vale para a equipe toda, como o nome e a ordem: é a mesma barra.
   */
  showCounts: Record<ItemContador, boolean>
}

/** O vocabulário de fábrica — e o que volta quando o admin limpa um campo. */
export const PADRAO: TabLabels = {
  scope: { mine: 'Meus', team: 'Setor', all: 'Todos' },
  bucket: { inbox: 'Atendimento', raw: 'Caixa', snoozed: 'Aguardando', resolved: 'Resolvidos', all: 'Todos' },
  order: { scope: [...ESCOPOS], bucket: [...CAIXAS] },
  showCounts: Object.fromEntries(ITENS_CONTADOR.map((k) => [k, true])) as Record<ItemContador, boolean>,
}

/** Nome de aba é rótulo curto: sem marcação, sem quebra, e cabendo na coluna. */
function limpar(valor: unknown, padrao: string): string {
  if (typeof valor !== 'string') return padrao
  const limpo = valor
    // O saneador global já transformou `<b>` em `&lt;b&gt;` antes de chegar
    // aqui — sem tirar a entidade, o operador leria "&lt;b&gt;" na aba.
    .replace(/&(?:lt|gt|amp|quot|apos|#\d+);/gi, '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24)
  return limpo || padrao
}

/**
 * Uma ordem só pode ser uma permutação da lista de abas que existe.
 *
 * Não basta aceitar o que veio: id desconhecido (aba renomeada em versão
 * futura), id repetido ou id faltando some com uma aba da barra — e o operador
 * perde o acesso à caixa sem nenhuma mensagem de erro. Aqui o desconhecido e o
 * repetido caem fora e o que faltou entra no fim, de modo que a barra sempre
 * desenha as abas todas, uma vez cada.
 */
function ordenar<T extends string>(bruto: unknown, validos: readonly T[]): T[] {
  const vistos = new Set<string>()
  const saida: T[] = []
  for (const item of Array.isArray(bruto) ? bruto : []) {
    if (typeof item !== 'string' || vistos.has(item)) continue
    if (!(validos as readonly string[]).includes(item)) continue
    vistos.add(item)
    saida.push(item as T)
  }
  for (const id of validos) if (!vistos.has(id)) saida.push(id)
  return saida
}

/**
 * Contadores, item a item.
 *
 * Aceita o booleano único da primeira versão desta preferência: quem já tinha
 * gravado `showCounts: false` não pode ver os números voltarem sozinhos porque
 * o formato mudou. Fora isso, só `false` explícito desliga — chave ausente é
 * instalação que sempre viu o contador.
 */
function saneiaContadores(bruto: unknown): Record<ItemContador, boolean> {
  if (typeof bruto === 'boolean') {
    return Object.fromEntries(ITENS_CONTADOR.map((k) => [k, bruto])) as Record<ItemContador, boolean>
  }
  const obj = (bruto && typeof bruto === 'object' ? bruto : {}) as any
  return Object.fromEntries(
    ITENS_CONTADOR.map((k) => [k, obj[k] !== false]),
  ) as Record<ItemContador, boolean>
}

export function sanear(bruto: unknown): TabLabels {
  const obj = (bruto && typeof bruto === 'object' ? bruto : {}) as any
  const scope = {} as Record<Escopo, string>
  const bucket = {} as Record<Caixa, string>
  for (const k of ESCOPOS) scope[k] = limpar(obj?.scope?.[k], PADRAO.scope[k])
  for (const k of CAIXAS) bucket[k] = limpar(obj?.bucket?.[k], PADRAO.bucket[k])
  return {
    scope,
    bucket,
    order: {
      scope: ordenar(obj?.order?.scope, ESCOPOS),
      bucket: ordenar(obj?.order?.bucket, CAIXAS),
    },
    showCounts: saneiaContadores(obj?.showCounts),
  }
}

// ── Tema do módulo ─────────────────────────────────────────────────────────

export const TEMA_KEY = 'conversations.theme'
/** `default` = o visual do próprio sistema (nada muda). */
export const TEMAS = ['default', 'wa-dark', 'wa-light'] as const
export type TemaConversas = (typeof TEMAS)[number]

export async function lerTema(): Promise<TemaConversas> {
  const row = await prisma.setting.findUnique({ where: { key: TEMA_KEY } }).catch(() => null)
  const bruto = typeof row?.value === 'string'
    ? row.value.replace(/^"|"$/g, '')
    : (row?.value as string | undefined)
  return (TEMAS as readonly string[]).includes(bruto ?? '') ? (bruto as TemaConversas) : 'default'
}

export async function gravarTema(bruto: unknown): Promise<TemaConversas> {
  const tema: TemaConversas = (TEMAS as readonly string[]).includes(String(bruto))
    ? (String(bruto) as TemaConversas)
    : 'default'
  await prisma.setting.upsert({
    where: { key: TEMA_KEY },
    update: { value: tema as never },
    create: {
      key: TEMA_KEY,
      value: tema as never,
      label: 'Tema do Conversas',
      grp: 'conversations',
      fieldType: 'text',
    },
  })
  return tema
}

export async function lerTabLabels(): Promise<TabLabels> {
  const row = await prisma.setting.findUnique({ where: { key: TAB_LABELS_KEY } }).catch(() => null)
  if (!row?.value) return PADRAO
  // A coluna é Json, mas versões antigas gravaram string JSON — aceita os dois.
  let bruto: unknown = row.value
  if (typeof bruto === 'string') {
    try { bruto = JSON.parse(bruto.replace(/^"|"$/g, '')) } catch { return PADRAO }
  }
  return sanear(bruto)
}

export async function gravarTabLabels(bruto: unknown): Promise<TabLabels> {
  // Corpo sem `order` é de quem só quis mexer nos nomes (a API antiga, ou um
  // painel ainda não atualizado): a ordem já escolhida fica de pé, em vez de
  // voltar para a de fábrica sem ninguém ter pedido.
  const obj = (bruto && typeof bruto === 'object' ? bruto : {}) as any
  // Campo ausente = "não mexi nisso", e não "volte para o padrão". Um painel
  // antigo que só manda nomes não pode zerar a ordem nem religar o contador
  // que a casa desligou.
  const atual = await lerTabLabels()
  const entrada = {
    ...obj,
    order: obj?.order ?? atual.order,
    showCounts: obj?.showCounts === undefined ? atual.showCounts : obj.showCounts,
  }
  const limpo = sanear(entrada)
  await prisma.setting.upsert({
    where: { key: TAB_LABELS_KEY },
    update: { value: limpo as never },
    create: {
      key: TAB_LABELS_KEY,
      value: limpo as never,
      label: 'Nomes e ordem das abas do Conversas',
      grp: 'conversations',
      fieldType: 'json',
    },
  })
  return limpo
}
