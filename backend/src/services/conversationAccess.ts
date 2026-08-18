// src/services/conversationAccess.ts
//
// O gerenciador de acesso do Conversas — quem enxerga e opera o quê, por canal
// e por tipo de conversa.
//
// ── Por que existe ────────────────────────────────────────────────────────
//
// Até aqui a resposta saía de três lugares que não conversam entre si:
//
//   1. permissão de MÓDULO (ver/criar/editar/excluir por papel);
//   2. ALCANCE do lead — scope own/team/all, herdado do módulo `leads`;
//   3. reserva do NÚMERO (channelVisibility).
//
// Nenhum deles responde ao pedido que o cliente faz em voz alta: "o gestor
// acompanha os grupos da recepção, e mais nada". Para chegar perto era preciso
// mexer em setor, em dono do lead ou no scope do papel inteiro — e cada um
// desses respinga em Leads, Kanban e Relatórios, que leem o mesmo scope.
//
// Aqui a pergunta é feita direto: para cada CANAL e cada TIPO (contato x
// grupo), o que este papel — ou esta pessoa — pode fazer.
//
// ── As regras da casa ─────────────────────────────────────────────────────
//
// • Sem linha para o sujeito, NADA muda. O chamador recebe `configurado:false`
//   e segue pelo caminho antigo, byte a byte. É o que garante que instalar
//   isto não mexe em nenhuma tenant que não pediu.
//
// • Exceção nominal vence o papel — e vence INTEIRA. Se o Juliano tem qualquer
//   linha própria, o conjunto dele é só o dele; as linhas de MANAGER não
//   entram para completar. Meio-a-meio seria impossível de auditar na tela.
//
// • Marcou, mandou. Dentro de um canal liberado o alcance own/team/all não se
//   aplica: o sujeito vê todas as conversas daquele canal, sem filtro de dono
//   nem de setor. Foi a decisão de produto — a marcação é a palavra final.
//
// • A reserva do número (channelVisibility) também sai de cena para quem é
//   regido daqui. Seriam duas autoridades sobre a mesma pergunta, e a segunda
//   sempre venceria por ser mais restritiva — na prática anulando a matriz.
//
// • Conversa entra pela porta que TOCOU, não pela que "pertence a ela". Um
//   grupo corporativo em que o dono também fala pela linha pessoal continua
//   visível a quem tem a linha corporativa: foi assim que o Geral - Kobogó
//   sumiu para a gerência inteira por causa de duas mensagens.

import { prisma } from '../lib/prisma.js'

export type Acao = 'view' | 'create' | 'edit' | 'delete'
export type TipoConversa = 'contact' | 'group'

/** Coringa: qualquer canal, inclusive Instagram, Messenger e conversa sem mensagem. */
export const CANAL_QUALQUER = '*'

export interface Permissoes {
  canView: boolean
  canCreate: boolean
  canEdit: boolean
  canDelete: boolean
}

const NEGADO: Permissoes = { canView: false, canCreate: false, canEdit: false, canDelete: false }

export interface MapaDeAcesso {
  /** false = nenhuma regra para este sujeito; o chamador usa o caminho antigo. */
  configurado: boolean
  /** channelKey → permissões por tipo de conversa. */
  regras: Map<string, { contact: Permissoes; group: Permissoes }>
}

/** Nada configurado — o Conversas segue como sempre foi. */
const NAO_CONFIGURADO: MapaDeAcesso = { configurado: false, regras: new Map() }

// Cache curto, no mesmo espírito do de permissões: a lista de conversas dispara
// uma dezena de contagens por request e todas fazem a mesma pergunta.
const cache = new Map<string, { mapa: MapaDeAcesso; ts: number }>()
const CACHE_TTL = 30_000

export function invalidarCacheDeAcesso(userId?: number) {
  if (userId === undefined) { cache.clear(); return }
  // O papel do usuário pode ter mudado junto; a chave carrega os dois.
  for (const chave of [...cache.keys()]) {
    if (chave.startsWith(`${userId}:`)) cache.delete(chave)
  }
}

function linhaParaPermissoes(r: { canView: boolean; canCreate: boolean; canEdit: boolean; canDelete: boolean }): Permissoes {
  return { canView: r.canView, canCreate: r.canCreate, canEdit: r.canEdit, canDelete: r.canDelete }
}

/**
 * As regras que valem para este usuário.
 *
 * SUPERADMIN nunca é regido daqui: é quem configura a matriz, e trancá-lo fora
 * da própria tela de configuração seria uma armadilha sem saída.
 */
export async function mapaDeAcesso(userId: number, role: string): Promise<MapaDeAcesso> {
  if (role === 'SUPERADMIN') return NAO_CONFIGURADO

  const chave = `${userId}:${role}`
  const emCache = cache.get(chave)
  if (emCache && Date.now() - emCache.ts < CACHE_TTL) return emCache.mapa

  // Uma consulta só para os dois sujeitos possíveis; decidir qual vale é
  // trabalho de memória, não de banco.
  const linhas = await prisma.conversationAccessRule.findMany({
    where: {
      OR: [
        { subjectType: 'user', subjectId: String(userId) },
        { subjectType: 'role', subjectId: role },
      ],
    },
  })

  const nominais = linhas.filter((l) => l.subjectType === 'user')
  const valendo = nominais.length > 0 ? nominais : linhas.filter((l) => l.subjectType === 'role')

  let mapa: MapaDeAcesso
  if (valendo.length === 0) {
    mapa = NAO_CONFIGURADO
  } else {
    const regras = new Map<string, { contact: Permissoes; group: Permissoes }>()
    for (const l of valendo) {
      const atual = regras.get(l.channelKey) ?? { contact: NEGADO, group: NEGADO }
      if (l.kind === 'group') atual.group = linhaParaPermissoes(l)
      else atual.contact = linhaParaPermissoes(l)
      regras.set(l.channelKey, atual)
    }
    mapa = { configurado: true, regras }
  }

  cache.set(chave, { mapa, ts: Date.now() })
  return mapa
}

/** `instanceName` de cada instância, por id — o banco guarda o nome, a matriz guarda o id. */
async function nomesDeInstancia(ids: number[]): Promise<Map<number, string>> {
  if (!ids.length) return new Map()
  const linhas = await prisma.whatsAppInstance.findMany({
    where: { id: { in: ids } },
    select: { id: true, instanceName: true },
  })
  return new Map(linhas.map((i) => [i.id, i.instanceName]))
}

/** A condição Prisma que casa mensagens de um canal. `null` para chave inválida. */
function condicaoDoCanal(channelKey: string, nomes: Map<number, string>): any | null {
  if (channelKey.startsWith('evolution:')) {
    const id = parseInt(channelKey.slice('evolution:'.length))
    const nome = nomes.get(id)
    return nome ? { provider: 'evolution', evolutionInstance: nome } : null
  }
  if (channelKey.startsWith('cloud:')) {
    const id = parseInt(channelKey.slice('cloud:'.length))
    return Number.isFinite(id) ? { provider: 'cloud_api', cloudApiConnectionId: id } : null
  }
  return null
}

/**
 * Cláusula Prisma que reduz a listagem ao que o sujeito pode VER.
 *
 * Devolve `null` quando não há nada configurado — o chamador então aplica o
 * escopo antigo e o filtro de números reservados, exatamente como antes.
 *
 * Quando há, a cláusula é a lista inteira: escopo e reserva NÃO devem ser
 * aplicados junto, sob pena de a matriz virar enfeite (a regra mais restritiva
 * venceria sempre).
 */
export async function filtroDeConversas(mapa: MapaDeAcesso): Promise<any | null> {
  if (!mapa.configurado) return null

  const coringa = mapa.regras.get(CANAL_QUALQUER)
  const chavesEvolution = [...mapa.regras.keys()].filter((k) => k.startsWith('evolution:'))
  const nomes = await nomesDeInstancia(
    chavesEvolution.map((k) => parseInt(k.slice('evolution:'.length))).filter(Number.isFinite),
  )

  /** Os ramos do OR para um tipo de conversa. */
  const ramosDoTipo = (tipo: TipoConversa): any[] => {
    const ehGrupo = tipo === 'group'
    // Coringa liberado dispensa olhar canal: o tipo inteiro está liberado.
    if (coringa?.[tipo].canView) return [{ isGroup: ehGrupo }]

    const condicoes: any[] = []
    for (const [chave, perms] of mapa.regras) {
      if (chave === CANAL_QUALQUER || !perms[tipo].canView) continue
      const cond = condicaoDoCanal(chave, nomes)
      if (cond) condicoes.push(cond)
    }
    if (!condicoes.length) return []
    return [{ isGroup: ehGrupo, messages: { some: { OR: condicoes } } }]
  }

  const ramos = [...ramosDoTipo('contact'), ...ramosDoTipo('group')]
  // Configurado e sem nada liberado é uma resposta legítima: lista vazia. Sem o
  // `id: -1` o OR vazio do Prisma devolveria a tenant inteira.
  if (!ramos.length) return { id: -1 }
  return { OR: ramos }
}

/**
 * O que o sujeito pode fazer NESTA conversa.
 *
 * Diferente da listagem, aqui vale o canal EFETIVO (o mesmo critério que decide
 * por qual número respondemos, e o mesmo que rotula a conversa na lista) — e
 * não "tocou alguma vez". Numa conversa só, a pergunta tem uma resposta certa,
 * e ela precisa bater com o número que a tela mostra.
 */
export async function permissoesNaConversa(
  mapa: MapaDeAcesso,
  leadId: number,
): Promise<Permissoes | null> {
  if (!mapa.configurado) return null

  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { isGroup: true } })
  if (!lead) return NEGADO
  const tipo: TipoConversa = lead.isGroup ? 'group' : 'contact'

  const { canalEfetivoDeLeads } = await import('./whatsappProvider.js')
  const efetivo = (await canalEfetivoDeLeads([leadId])).get(leadId)

  // Conversa sem canal WhatsApp resolvido (Instagram, Messenger, sem mensagem):
  // só o coringa alcança.
  let chave: string | null = null
  if (efetivo?.provider === 'evolution' && efetivo.evolutionInstance) {
    const inst = await prisma.whatsAppInstance.findFirst({
      where: { instanceName: efetivo.evolutionInstance },
      select: { id: true },
    })
    if (inst) chave = `evolution:${inst.id}`
  } else if (efetivo?.provider === 'cloud_api' && efetivo.cloudApiConnectionId != null) {
    chave = `cloud:${efetivo.cloudApiConnectionId}`
  }

  // Canal específico vence a coringa; sem regra para ele, a coringa responde.
  const especifica = chave ? mapa.regras.get(chave) : undefined
  if (especifica) return especifica[tipo]
  const coringa = mapa.regras.get(CANAL_QUALQUER)
  if (coringa) return coringa[tipo]

  // Regido pela matriz e sem regra que alcance esta conversa: negado. É o lado
  // da moeda de "a marcação é a palavra final".
  return NEGADO
}

/** Atalho para os guards: pode executar esta ação nesta conversa? */
export function permite(perms: Permissoes, acao: Acao): boolean {
  switch (acao) {
    case 'view': return perms.canView
    case 'create': return perms.canCreate
    case 'edit': return perms.canEdit
    case 'delete': return perms.canDelete
  }
}

/**
 * O sujeito é regido pela matriz e ela lhe dá esta ação em ALGUM canal?
 *
 * Serve às rotas que não falam de uma conversa específica (iniciar conversa
 * nova, importar do celular): sem isto elas escapariam da matriz inteira.
 */
export function permiteEmAlgumCanal(mapa: MapaDeAcesso, acao: Acao): boolean {
  for (const perms of mapa.regras.values()) {
    if (permite(perms.contact, acao) || permite(perms.group, acao)) return true
  }
  return false
}

export interface CanaisPermitidos {
  /** A coringa libera a ação — todo canal serve, inclusive os não listados. */
  qualquer: boolean
  instancias: Set<number>
  conexoes: Set<number>
}

/**
 * Os canais em que o sujeito pode executar a ação, em qualquer tipo de conversa.
 *
 * O seletor de número usa isto: oferecer uma linha pela qual o envio vai ser
 * recusado depois é pior do que não oferecer — o operador escreve a mensagem
 * inteira antes de descobrir.
 */
export function canaisComAcao(mapa: MapaDeAcesso, acao: Acao): CanaisPermitidos {
  const saida: CanaisPermitidos = { qualquer: false, instancias: new Set(), conexoes: new Set() }
  for (const [chave, perms] of mapa.regras) {
    if (!permite(perms.contact, acao) && !permite(perms.group, acao)) continue
    if (chave === CANAL_QUALQUER) { saida.qualquer = true; continue }
    if (chave.startsWith('evolution:')) {
      const id = parseInt(chave.slice('evolution:'.length))
      if (Number.isFinite(id)) saida.instancias.add(id)
    } else if (chave.startsWith('cloud:')) {
      const id = parseInt(chave.slice('cloud:'.length))
      if (Number.isFinite(id)) saida.conexoes.add(id)
    }
  }
  return saida
}
