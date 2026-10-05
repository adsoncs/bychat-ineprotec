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
//   2. número `restricted` — só o dono e os observadores escolhidos veem o que
//      passou por ele. Vale também para o SUPERADMIN: administrar a instalação
//      não é motivo para ler a linha pessoal de outra pessoa (kobogo, 05/10/2026).
//      O superadmin continua vendo o NÚMERO na tela de configuração
//      (`gerenciar`), que é onde ele decide quem acompanha.
//
// Conversa individual que só passou pela linha reservada some inteira. A que
// passou por ela E por um número da empresa continua visível, sem as mensagens
// da linha reservada (`filtroDeMensagensVisiveis`): esconder a conversa toda
// tirava da equipe um cliente da empresa por causa de uma conversa pessoal
// antiga, e mostrar tudo expunha a parte pessoal.
//
// Exceção: GRUPO que hoje fala por um número da empresa aparece inteiro. O grupo
// é compartilhado com todos os participantes — o que passou nele pela linha
// pessoal nunca foi privado de ninguém —, e escondê-lo tirava da equipe um grupo
// de trabalho só porque o dono o usou pela linha pessoal antes de colocar o
// número da empresa (kobogo, "Suporte Attrae | Kobogó", 24/09/2026). Grupo cujo
// número de hoje é a linha reservada continua escondido.
//
// A reserva vale pelo NOME da instância gravado em cada mensagem. Apagar o
// cadastro de um número reservado com histórico tira a proteção de tudo que
// passou por ele — foi assim que 9.692 mensagens pessoais voltaram a aparecer
// no kobogo. Por isso a exclusão é barrada enquanto houver histórico
// (`historicoDoCanalReservado`).

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
 * Devolve vazio quando não há canal reservado nenhum — que é o caso de toda
 * instalação que nunca mexeu nisso. `gerenciar` é a tela de configuração dos
 * números: lá o superadmin precisa ver a linha para decidir quem a acompanha,
 * mesmo sem poder ler as conversas dela.
 */
export async function canaisOcultosPara(
  userId: number,
  role: string,
  opts: { gerenciar?: boolean } = {},
): Promise<CanaisOcultos> {
  if (opts.gerenciar && role === 'SUPERADMIN') return VAZIO

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
 * Condição de `bychat_messages` para "mensagem que NÃO veio por canal oculto".
 *
 * Escrita por extenso em vez de `NOT: { OR: alvos }`: com `evolutionInstance`
 * nulo o NOT do SQL vira nulo e a mensagem sumiria junto — e há mensagens
 * antigas sem instância gravada.
 */
function condicaoMensagemVisivel(ocultos: CanaisOcultos): any | null {
  const e: any[] = []
  if (ocultos.instancias.length) {
    e.push({ OR: [{ provider: { not: 'evolution' } }, { evolutionInstance: null }, { evolutionInstance: { notIn: ocultos.instancias } }] })
  }
  if (ocultos.conexoes.length) {
    e.push({ OR: [{ provider: { not: 'cloud_api' } }, { cloudApiConnectionId: null }, { cloudApiConnectionId: { notIn: ocultos.conexoes } }] })
  }
  return e.length ? { AND: e } : null
}

/**
 * Conversas que passaram por canal oculto mas continuam visíveis:
 *  - GRUPO que hoje fala por um número da empresa (aparece inteiro);
 *  - conversa INDIVIDUAL que também passou por número da empresa (aparece sem
 *    as mensagens do canal oculto — ver `filtroDeMensagensVisiveis`).
 *
 * Calculado à parte e entregue como lista de ids — e não como mais uma
 * subconsulta em `bychat_messages` dentro da listagem: empilhar essas
 * subconsultas com as da matriz derrubou o MySQL 8.0.46 do kobogo (signal 11).
 */
async function conversasLiberadas(ocultos: CanaisOcultos): Promise<number[]> {
  const alvos = alvosOcultos(ocultos)
  if (!alvos.length) return []
  const tocaram = await prisma.message.findMany({
    where: { OR: alvos },
    distinct: ['leadId'],
    select: { leadId: true, lead: { select: { isGroup: true } } },
  })
  if (!tocaram.length) return []
  const grupos = tocaram.filter((m) => m.lead.isGroup).map((m) => m.leadId)
  const individuais = tocaram.filter((m) => !m.lead.isGroup).map((m) => m.leadId)

  const liberados: number[] = []
  if (grupos.length) {
    const { canalEfetivoDeLeads } = await import('./whatsappProvider.js')
    const efetivos = await canalEfetivoDeLeads(grupos)
    liberados.push(...grupos.filter((id) => !numeroDeHojeOculto(efetivos.get(id), ocultos)))
  }
  const visivel = condicaoMensagemVisivel(ocultos)
  if (individuais.length && visivel) {
    const mistas = await prisma.message.findMany({
      where: { leadId: { in: individuais }, ...visivel },
      distinct: ['leadId'],
      select: { leadId: true },
    })
    liberados.push(...mistas.map((m) => m.leadId))
  }
  return liberados
}

/**
 * Condição extra para as mensagens que ESTE usuário lê nesta conversa, ou
 * `null` quando não há o que tirar. Só conversa individual: grupo liberado
 * aparece inteiro (ver o topo do arquivo).
 */
export async function filtroDeMensagensVisiveis(
  userId: number,
  role: string,
  isGroup: boolean,
): Promise<any | null> {
  if (isGroup) return null
  return condicaoMensagemVisivel(await canaisOcultosPara(userId, role))
}

/** A mensagem veio por um canal que este conjunto esconde? (para eventos em tempo real) */
export function mensagemOculta(
  m: { provider: string | null; evolutionInstance: string | null; cloudApiConnectionId: number | null },
  ocultos: CanaisOcultos,
): boolean {
  if (m.provider === 'evolution') return !!m.evolutionInstance && ocultos.instancias.includes(m.evolutionInstance)
  if (m.provider === 'cloud_api') return m.cloudApiConnectionId != null && ocultos.conexoes.includes(m.cloudApiConnectionId)
  return false
}

/**
 * Quantas mensagens passaram por este canal — o que deixaria de estar
 * protegido se o cadastro reservado fosse apagado.
 */
export async function historicoDoCanalReservado(
  canal: { instanceName: string } | { conexaoId: number },
): Promise<number> {
  return prisma.message.count({
    where: 'instanceName' in canal
      ? { provider: 'evolution', evolutionInstance: canal.instanceName }
      : { provider: 'cloud_api', cloudApiConnectionId: canal.conexaoId },
  })
}

/** Atalho: a cláusula pronta para um usuário (ou `null` quando não há o que esconder). */
export async function filtroDeCanaisVisiveis(userId: number, role: string): Promise<any | null> {
  const ocultos = await canaisOcultosPara(userId, role)
  const base = clausulaDeOcultacao(ocultos)
  if (!base) return null
  const liberados = await conversasLiberadas(ocultos)
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
  opts: { gerenciar?: boolean } = {},
): Promise<T[]> {
  const ocultos = await canaisOcultosPara(userId, role, opts)
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
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { isGroup: true } })
  if (!lead) return false
  if (!lead.isGroup) {
    // Individual que também passou por número da empresa: abre, sem as
    // mensagens do canal oculto (ver o topo do arquivo).
    const visivel = condicaoMensagemVisivel(ocultos)
    if (!visivel) return false
    const outra = await prisma.message.findFirst({ where: { leadId, ...visivel }, select: { id: true } })
    return !!outra
  }
  // Grupo que hoje fala por um número da empresa: liberado (ver o topo do arquivo).
  const { canalEfetivoDeLeads } = await import('./whatsappProvider.js')
  const efetivo = (await canalEfetivoDeLeads([leadId])).get(leadId)
  return !numeroDeHojeOculto(efetivo, ocultos)
}
