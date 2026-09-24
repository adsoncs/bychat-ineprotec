// src/services/channelVisibility.ts
//
// Quem enxerga as conversas de cada número.
//
// A permissão do painel sempre foi do LEAD: quem é dono dele, ou o setor dele,
// vê a conversa — não importa por qual linha ela aconteceu. Isso basta enquanto
// todos os números são da empresa. Deixa de bastar no instante em que alguém
// conecta a linha PESSOAL: no kobogo foram 11.195 mensagens de 210 contatos
// visíveis para a gerência inteira, porque os leads entraram sem dono num setor
// compartilhado.
//
// Aqui o número declara quem pode acompanhá-lo. Regras, na ordem:
//
//   1. número `all` (padrão) — nada muda, vale a permissão do lead;
//   2. número `restricted` — só o SUPERADMIN, o agente dono e os observadores
//      escolhidos veem qualquer conversa que tenha passado por ele.
//
// "Qualquer conversa que tenha passado por ele" é proposital, e não "conversa
// que hoje pertence a ele": se o contato falou uma vez pela linha pessoal e
// depois pela corporativa, abrir a conversa mostraria o histórico inteiro —
// esconder só metade seria uma proteção que não protege.
//
// Exceção: GRUPO que hoje fala por um número da empresa. O grupo é compartilhado
// com todos os participantes — o que passou nele pela linha pessoal nunca foi
// privado de ninguém —, e escondê-lo tirava da equipe um grupo de trabalho só
// porque o dono o usou pela linha pessoal antes de colocar o número da empresa
// (kobogo, "Suporte Attrae | Kobogó", 24/09/2026). Grupo cujo número de hoje é a
// linha reservada continua escondido; conversa individual segue a regra acima.

import { prisma } from '../lib/prisma.js'

export interface CanaisOcultos {
  /** `instanceName` das instâncias Evolution que este usuário não pode ver. */
  instancias: string[]
  /** ids das conexões Cloud API que este usuário não pode ver. */
  conexoes: number[]
}

const VAZIO: CanaisOcultos = { instancias: [], conexoes: [] }

/**
 * Os canais reservados aos quais o usuário NÃO tem acesso.
 *
 * Devolve vazio para superadmin e quando não há canal reservado nenhum — que é
 * o caso de toda instalação que nunca mexeu nisso.
 */
export async function canaisOcultosPara(userId: number, role: string): Promise<CanaisOcultos> {
  // Superadmin administra a instalação: esconder dele seria esconder de quem
  // configura a própria regra.
  if (role === 'SUPERADMIN') return VAZIO

  const [instancias, conexoes] = await Promise.all([
    prisma.whatsAppInstance.findMany({
      where: { visibility: 'restricted' },
      select: { instanceName: true, ownerUserId: true, viewers: { select: { userId: true } } },
    }),
    prisma.cloudApiConnection.findMany({
      where: { visibility: 'restricted' },
      select: { id: true, ownerUserId: true, viewers: { select: { userId: true } } },
    }),
  ])
  if (!instancias.length && !conexoes.length) return VAZIO

  const podeVer = (dono: number | null, viewers: { userId: number }[]) =>
    dono === userId || viewers.some((v) => v.userId === userId)

  return {
    instancias: instancias.filter((i) => !podeVer(i.ownerUserId, i.viewers)).map((i) => i.instanceName),
    conexoes: conexoes.filter((c) => !podeVer(c.ownerUserId, c.viewers)).map((c) => c.id),
  }
}

/**
 * Cláusula Prisma que remove da listagem tudo que tocou um canal reservado.
 *
 * `messages: { none: ... }` em vez de uma lista de ids: a conta é feita pelo
 * banco e não cresce com o histórico.
 */
export function clausulaDeOcultacao(ocultos: CanaisOcultos): any | null {
  const alvos: any[] = []
  if (ocultos.instancias.length) {
    alvos.push({ provider: 'evolution', evolutionInstance: { in: ocultos.instancias } })
  }
  if (ocultos.conexoes.length) {
    alvos.push({ provider: 'cloud_api', cloudApiConnectionId: { in: ocultos.conexoes } })
  }
  if (!alvos.length) return null
  return { messages: { none: { OR: alvos } } }
}

/** As mensagens que passaram por algum canal oculto (condição de `bychat_messages`). */
function alvosOcultos(ocultos: CanaisOcultos): any[] {
  return [
    ...(ocultos.instancias.length ? [{ provider: 'evolution', evolutionInstance: { in: ocultos.instancias } }] : []),
    ...(ocultos.conexoes.length ? [{ provider: 'cloud_api', cloudApiConnectionId: { in: ocultos.conexoes } }] : []),
  ]
}

/** O número de HOJE da conversa (o mesmo critério da resposta) é um canal oculto? */
function numeroDeHojeOculto(
  ef: { provider: string; evolutionInstance: string | null; cloudApiConnectionId: number | null } | undefined,
  ocultos: CanaisOcultos,
): boolean {
  if (!ef) return true // sem número resolvido: não há o que liberar
  if (ef.provider === 'evolution') return !!ef.evolutionInstance && ocultos.instancias.includes(ef.evolutionInstance)
  if (ef.provider === 'cloud_api') return ef.cloudApiConnectionId != null && ocultos.conexoes.includes(ef.cloudApiConnectionId)
  return false
}

/**
 * Grupos que passaram por canal oculto mas hoje falam por um número da empresa.
 *
 * Calculado à parte e entregue como lista de ids — e não como mais uma
 * subconsulta em `bychat_messages` dentro da listagem: empilhar essas
 * subconsultas com as da matriz derrubou o MySQL 8.0.46 do kobogo (signal 11).
 */
async function gruposLiberados(ocultos: CanaisOcultos): Promise<number[]> {
  const alvos = alvosOcultos(ocultos)
  if (!alvos.length) return []
  const tocaram = await prisma.message.findMany({
    where: { OR: alvos, lead: { isGroup: true } },
    distinct: ['leadId'],
    select: { leadId: true },
  })
  if (!tocaram.length) return []
  const ids = tocaram.map((m) => m.leadId)
  const { canalEfetivoDeLeads } = await import('./whatsappProvider.js')
  const efetivos = await canalEfetivoDeLeads(ids)
  return ids.filter((id) => !numeroDeHojeOculto(efetivos.get(id), ocultos))
}

/** Atalho: a cláusula pronta para um usuário (ou `null` quando não há o que esconder). */
export async function filtroDeCanaisVisiveis(userId: number, role: string): Promise<any | null> {
  const ocultos = await canaisOcultosPara(userId, role)
  const base = clausulaDeOcultacao(ocultos)
  if (!base) return null
  const liberados = await gruposLiberados(ocultos)
  return liberados.length ? { OR: [base, { id: { in: liberados } }] } : base
}

/**
 * Poda uma lista de canais, tirando os reservados que este usuário não vê.
 *
 * Existe porque esconder as CONVERSAS não bastava: o número reservado continuava
 * aparecendo pelo nome e pelo telefone no filtro do Conversas, nos filtros da
 * Supervisão, na lista de instâncias e no seletor de disparo. Saber que a linha
 * existe, de quem é o número e poder mandar mensagem por ela já é ver o que não
 * se deveria — reservado é reservado em todo lugar, não só na caixa de entrada.
 *
 * Genérica de propósito: cada lista tem o seu formato (umas trazem
 * `instanceName`, outras o id da conexão), então quem chama diz como ler o
 * canal de cada item.
 */
export async function podarCanaisReservados<T>(
  itens: T[],
  userId: number,
  role: string,
  ler: (item: T) => { instanceName?: string | null; conexaoId?: number | null },
): Promise<T[]> {
  const ocultos = await canaisOcultosPara(userId, role)
  if (!ocultos.instancias.length && !ocultos.conexoes.length) return itens
  const instancias = new Set(ocultos.instancias)
  const conexoes = new Set(ocultos.conexoes)
  return itens.filter((item) => {
    const { instanceName, conexaoId } = ler(item)
    if (instanceName && instancias.has(instanceName)) return false
    if (conexaoId != null && conexoes.has(conexaoId)) return false
    return true
  })
}

/** Este usuário pode abrir ESTA conversa? Usado no acesso direto por URL. */
export async function podeVerConversa(leadId: number, userId: number, role: string): Promise<boolean> {
  const ocultos = await canaisOcultosPara(userId, role)
  if (!ocultos.instancias.length && !ocultos.conexoes.length) return true

  const tocou = await prisma.message.findFirst({
    where: { leadId, OR: alvosOcultos(ocultos) },
    select: { id: true },
  })
  if (!tocou) return true
  // Grupo que hoje fala por um número da empresa: liberado (ver o topo do arquivo).
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { isGroup: true } })
  if (!lead?.isGroup) return false
  const { canalEfetivoDeLeads } = await import('./whatsappProvider.js')
  const efetivo = (await canalEfetivoDeLeads([leadId])).get(leadId)
  return !numeroDeHojeOculto(efetivo, ocultos)
}
