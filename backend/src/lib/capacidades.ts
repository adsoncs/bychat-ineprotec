// src/lib/capacidades.ts
//
// Catálogo de capacidades do novo modelo de Papéis e Permissões
// (spec: "Papéis e Permissões — especificação", plano: /root/planos/papeis-permissoes.md).
//
// Uma capacidade é `<recurso>.<ação>`. Duas famílias:
//   • básicas  — `<módulo ou tela>.<view|create|edit|delete>`, geradas do
//     MODULE_REGISTRY e das telas do Educacional. São os MESMOS ids que o
//     painel já usa (`useCan('leads', 'edit')`), então o papel-espelho da
//     fase 1 reproduz o acesso de hoje sem tocar no front.
//   • nomeadas — ações que pesam e precisam ser dadas ou negadas sozinhas
//     (aprovar documento, estornar, configurar portal). Entram em uso na
//     fase 3/4, quando as rotas passam a pedi-las.
//
// O catálogo é derivado do código: módulo novo no registro = capacidades
// novas aqui, sem lista à mão para envelhecer.

import { MODULE_REGISTRY } from './moduleRegistry.js'
import { EDU_TELAS } from './eduTelas.js'

export type AcaoBasica = 'view' | 'create' | 'edit' | 'delete'

export interface Capacidade {
  id: string
  /** Agrupamento na tela de Papéis (categoria do módulo, ou 'educacional'). */
  area: string
  nome: string
  /** Módulo que precisa estar ativo para a capacidade existir. */
  modulo: string
  tipo: 'basica' | 'nomeada'
  /** Só nas básicas. */
  acao?: AcaoBasica
  /** Nas nomeadas: a básica que ela refina (quem tem a básica hoje, ganha a nomeada no espelho). */
  derivaDe?: string
  /** Pode ligar "não vale para o que é seu" (separação de funções). */
  separavel?: boolean
}

const NOME_ACAO: Record<AcaoBasica, string> = { view: 'ver', create: 'criar', edit: 'editar', delete: 'excluir' }

/** Ações sensíveis com nome próprio. `derivaDe` = de onde o espelho tira quem já pode. */
export const NOMEADAS: Array<Omit<Capacidade, 'tipo' | 'area'> & { area?: string }> = [
  { id: 'portal.configurar', nome: 'Configurar portal (formulário, pagamento, marca, excluir)', modulo: 'enrollment_portals', derivaDe: 'enrollment_portals.edit' },
  { id: 'inscricao.enviar_link', nome: 'Enviar link e acesso ao candidato', modulo: 'enrollment_portals', derivaDe: 'enrollment_portals.edit' },
  { id: 'inscricao.cancelar', nome: 'Cancelar inscrição', modulo: 'enrollment_portals', derivaDe: 'enrollment_portals.edit' },
  { id: 'inscricao.mesclar', nome: 'Mesclar inscrições duplicadas', modulo: 'enrollment_portals', derivaDe: 'enrollment_portals.edit' },
  { id: 'documento.aprovar', nome: 'Aprovar ou recusar documento', modulo: 'educacional', derivaDe: 'edu_revisao_documentos.edit', separavel: true },
  { id: 'redacao.corrigir', nome: 'Corrigir redação', modulo: 'educacional', derivaDe: 'edu_avaliacoes.edit', separavel: true },
  { id: 'enem.validar', nome: 'Validar nota do ENEM', modulo: 'educacional', derivaDe: 'edu_avaliacoes.edit', separavel: true },
  { id: 'analise.emitir_parecer', nome: 'Emitir parecer acadêmico', modulo: 'educacional', derivaDe: 'edu_revisao_documentos.edit', separavel: true },
  { id: 'cobranca.dar_baixa', nome: 'Dar baixa manual em cobrança', modulo: 'enrollment_portals', derivaDe: 'edu_financeiro_portal.edit', separavel: true },
  { id: 'cobranca.estornar', nome: 'Estornar pagamento', modulo: 'enrollment_portals', derivaDe: 'edu_financeiro_portal.edit', separavel: true },
  { id: 'matricula.efetivar', nome: 'Efetivar matrícula no ERP', modulo: 'aca_matriculas', derivaDe: 'aca_matriculas.edit' },
  { id: 'lead.exportar', nome: 'Exportar leads', modulo: 'leads', derivaDe: 'leads.view' },
  { id: 'lead.transferir', nome: 'Transferir lead', modulo: 'leads', derivaDe: 'leads.edit' },
  // Opções da transferência (cada empresa escolhe quem pode). Sem elas, transferir
  // troca só equipe/operador e o lead fica no funil e na etapa em que está.
  { id: 'transferencia.mover_funil', nome: 'Ao transferir, mover o lead de funil e etapa', modulo: 'leads' },
  { id: 'transferencia.abrir_outro_funil', nome: 'Ao transferir, abrir o lead também em outro funil', modulo: 'leads' },
  { id: 'usuarios.gerenciar', nome: 'Gerenciar usuários', modulo: 'users', derivaDe: 'users.edit' },
  { id: 'papeis.gerenciar', nome: 'Gerenciar papéis, equipes e pacotes', modulo: 'users', derivaDe: 'users.edit' },
  { id: 'integracoes.configurar', nome: 'Configurar integrações', modulo: 'settings', derivaDe: 'settings.edit' },
]

let cache: Capacidade[] | null = null

/** O catálogo inteiro (independe de módulo ativo; a tela filtra pelos ativos). */
export function catalogo(): Capacidade[] {
  if (cache) return cache
  const out: Capacidade[] = []
  const vistos = new Set<string>()
  const add = (c: Capacidade) => { if (!vistos.has(c.id)) { vistos.add(c.id); out.push(c) } }
  for (const m of MODULE_REGISTRY) {
    for (const a of m.actions) add({ id: `${m.id}.${a}`, area: m.category, nome: `${m.name}: ${NOME_ACAO[a]}`, modulo: m.id, tipo: 'basica', acao: a })
  }
  for (const t of EDU_TELAS) {
    for (const a of t.actions) add({ id: `${t.id}.${a}`, area: 'educacional', nome: `${t.name}: ${NOME_ACAO[a]}`, modulo: t.parent, tipo: 'basica', acao: a })
  }
  for (const n of NOMEADAS) add({ ...n, area: n.area ?? 'sensivel', tipo: 'nomeada' })
  cache = out
  return out
}

export function capacidadeExiste(id: string): boolean {
  return catalogo().some((c) => c.id === id)
}

/** Capacidades básicas de um recurso (módulo ou tela) — o que `ResolvedPerms[recurso]` traduz. */
export function basicasDe(recurso: string): Capacidade[] {
  return catalogo().filter((c) => c.tipo === 'basica' && c.id.startsWith(`${recurso}.`))
}
