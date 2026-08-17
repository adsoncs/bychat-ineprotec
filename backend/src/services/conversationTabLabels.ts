// src/services/conversationTabLabels.ts
//
// Os nomes das abas do Conversas, por instalação.
//
// "Caixa", "Atendimento", "Setor" são o vocabulário de UM jeito de trabalhar.
// Escola fala em "Secretaria", clínica em "Recepção", agência em "Prospecção" —
// e a equipe passa o dia relendo um rótulo que não é o dela. Aqui o admin troca
// o nome sem que nada mais mude: as regras de cada aba continuam as mesmas, só
// a palavra é da casa.
//
// Guardado como UMA Setting em JSON. Ler é liberado a qualquer operador (a tela
// precisa dos nomes para desenhar), escrever é de administrador.

import { prisma } from '../lib/prisma.js'

export const TAB_LABELS_KEY = 'conversations.tab_labels'

export const ESCOPOS = ['mine', 'team', 'all'] as const
export const CAIXAS = ['inbox', 'raw', 'snoozed', 'resolved', 'all'] as const

export type Escopo = (typeof ESCOPOS)[number]
export type Caixa = (typeof CAIXAS)[number]

export interface TabLabels {
  scope: Record<Escopo, string>
  bucket: Record<Caixa, string>
}

/** O vocabulário de fábrica — e o que volta quando o admin limpa um campo. */
export const PADRAO: TabLabels = {
  scope: { mine: 'Meus', team: 'Setor', all: 'Todos' },
  bucket: { inbox: 'Atendimento', raw: 'Caixa', snoozed: 'Aguardando', resolved: 'Resolvidos', all: 'Todos' },
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

export function sanear(bruto: unknown): TabLabels {
  const obj = (bruto && typeof bruto === 'object' ? bruto : {}) as any
  const scope = {} as Record<Escopo, string>
  const bucket = {} as Record<Caixa, string>
  for (const k of ESCOPOS) scope[k] = limpar(obj?.scope?.[k], PADRAO.scope[k])
  for (const k of CAIXAS) bucket[k] = limpar(obj?.bucket?.[k], PADRAO.bucket[k])
  return { scope, bucket }
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
  const limpo = sanear(bruto)
  await prisma.setting.upsert({
    where: { key: TAB_LABELS_KEY },
    update: { value: limpo as never },
    create: {
      key: TAB_LABELS_KEY,
      value: limpo as never,
      label: 'Nomes das abas do Conversas',
      grp: 'conversations',
      fieldType: 'json',
    },
  })
  return limpo
}
