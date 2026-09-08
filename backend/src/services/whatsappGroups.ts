// src/services/whatsappGroups.ts
//
// Conversas de GRUPO de WhatsApp — só Evolution (Baileys).
//
// Por que só Evolution: o número é uma conta real de WhatsApp e recebe todos os
// grupos de que participa. A Cloud API oficial NÃO serve — a Groups API do Meta
// só gerencia grupos criados por ela mesma ("existing groups cannot be
// retrofitted"), exige selo verde (OBA) e limita a 8 participantes, então os
// grupos reais do cliente ficam invisíveis por lá.
//
// Modelagem: o grupo é um `Lead` com `isGroup=true` e `groupJid` preenchido —
// reusa lista, envio, mensagens e UI de conversa sem model novo. O que muda é
// que ele fica FORA de tudo que trata lead como pessoa: chatbot (spam para todos
// os participantes), enriquecimento e score de IA.
//
// Identidade: grupo não tem telefone. O JID tem ~18 dígitos, então `phoneKey`
// vai explicitamente null (o middleware de lib/prisma.ts respeita o valor
// fornecido) e o grupo nunca colide com um contato real no resolvedor de
// identidade — que, aliás, não roda para grupo.

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { prisma } from '../lib/prisma.js'
import { redis } from '../lib/redis.js'
import { onlyDigits } from '../lib/phone.js'
import { resolveRoutingFromContext } from './teamRouting.js'

/** Nome de exibição quando ainda não sabemos o assunto do grupo. */
function placeholderName(groupJid: string): string {
  return `Grupo ${onlyDigits(groupJid).slice(-6)}`
}

function isPlaceholderName(name: string | null | undefined): boolean {
  return !name || /^Grupo \d{1,6}$/.test(name)
}

export interface GroupProfile {
  /** Nome do grupo como está AGORA no WhatsApp. */
  subject: string | null
  /** URL assinada e temporária da foto (pps.whatsapp.net) — precisa ser baixada. */
  pictureUrl: string | null
}

/**
 * Nome e foto do grupo via Evolution: GET /group/findGroupInfos.
 *
 * A mesma resposta traz `subject` e `pictureUrl` — por isso uma consulta só
 * resolve os dois. Devolve null em qualquer falha: perfil de grupo é enfeite e
 * não pode derrubar o recebimento da mensagem.
 */
export async function fetchGroupInfo(instanceName: string, groupJid: string): Promise<GroupProfile | null> {
  const base = process.env.EVOLUTION_API_URL || ''
  const key = process.env.EVOLUTION_API_KEY || ''
  if (!base || !key) return null
  try {
    const url = `${base}/group/findGroupInfos/${encodeURIComponent(instanceName)}?groupJid=${encodeURIComponent(groupJid)}`
    // Timeout explícito: a Evolution pendura a resposta quando a linha está
    // desconectada, e sem isto uma instância morta seguraria o webhook.
    const res = await fetch(url, { headers: { apikey: key }, signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return null
    const info: any = await res.json()
    const subject = typeof info?.subject === 'string' ? info.subject.trim() : ''
    const pictureUrl = typeof info?.pictureUrl === 'string' ? info.pictureUrl.trim() : ''
    return { subject: subject || null, pictureUrl: pictureUrl || null }
  } catch {
    return null
  }
}

/** Só o assunto — mantido porque é o que o import de conversas do celular usa. */
export async function fetchGroupSubject(instanceName: string, groupJid: string): Promise<string | null> {
  return (await fetchGroupInfo(instanceName, groupJid))?.subject ?? null
}

// ─── Perfil do grupo (nome + foto): manter em dia ────────────────────────────
//
// Grupo é renomeado e troca de foto no WhatsApp sem avisar ninguém — não existe
// evento garantido e o `subject` só chegava aqui na PRIMEIRA mensagem. Resultado
// no kobogo (08/09/2026): um grupo virou "Suporte Attrae | Kobogó" no aparelho e
// continuou "CRM | Clínica Elementus" na tela, então quem buscava pelo nome novo
// não achava a conversa.
//
// Duas portas, de propósito: o evento `groups.update` (reflexo imediato, quando
// a Evolution entrega) e uma revalidação com TTL na chegada de mensagem — que
// funciona mesmo sem o evento configurado na instância.

const AVATAR_DIR = join(process.cwd(), '..', 'uploads', 'avatars')

/** Uma consulta de perfil por grupo a cada 6h: o nome muda raramente, a mensagem chega toda hora. */
const PERFIL_TTL_S = 6 * 60 * 60

/**
 * Baixa a foto do grupo para `/uploads/avatars/<leadId>.jpg`, como já é feito
 * com a foto do contato: a URL da Evolution é ASSINADA e EXPIRA (`oe=`), então
 * guardá-la crua faz a imagem sumir da tela depois de alguns dias.
 *
 * Devolve a URL pública só quando os bytes MUDARAM — o `?v=` faz o navegador
 * rebaixar a imagem, e trocá-lo a cada varredura seria trabalho à toa.
 */
async function baixarFotoDoGrupo(leadId: number, pictureUrl: string, atual: string | null): Promise<string | null> {
  try {
    const res = await fetch(pictureUrl, { signal: AbortSignal.timeout(20_000) })
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (!buf.length) return null
    const file = join(AVATAR_DIR, `${leadId}.jpg`)
    const novoHash = createHash('sha1').update(buf).digest('hex')
    let hashAtual = ''
    try { hashAtual = createHash('sha1').update(await readFile(file)).digest('hex') } catch { /* sem arquivo → baixa */ }
    const jaHospedada = !!atual && atual.startsWith('/uploads/avatars/')
    if (novoHash === hashAtual && jaHospedada) return null
    await mkdir(AVATAR_DIR, { recursive: true })
    await writeFile(file, buf)
    return `/uploads/avatars/${leadId}.jpg?v=${Date.now()}`
  } catch {
    return null
  }
}

export interface GrupoSincronizavel {
  id: number
  nome: string | null
  profilePicUrl?: string | null
}

/**
 * Põe nome e foto do grupo em dia com o WhatsApp.
 *
 * `force` pula o TTL — é o caminho do evento `groups.update`, do backfill e do
 * grupo que ainda está com nome placeholder. Sem ele, uma varredura por grupo a
 * cada 6h basta e não transforma cada mensagem numa consulta à Evolution.
 *
 * Nunca lança: perfil desatualizado é chato, mensagem perdida é grave.
 */
export async function sincronizarPerfilDoGrupo(
  lead: GrupoSincronizavel,
  instanceName: string,
  groupJid: string,
  opts: { force?: boolean; subject?: string | null } = {},
): Promise<{ nome?: string; profilePicUrl?: string } | null> {
  if (!instanceName || !groupJid) return null

  if (!opts.force) {
    try {
      const primeiro = await redis.set(`evogrpperfil:${lead.id}`, '1', 'EX', PERFIL_TTL_S, 'NX')
      if (primeiro === null) return null
    } catch { /* Redis fora: consulta assim mesmo — uma chamada extra custa menos que o nome errado */ }
  }

  try {
    // O evento traz o nome novo pronto; a foto só a consulta sabe.
    const info = await fetchGroupInfo(instanceName, groupJid)
    const subject = ((opts.subject ?? info?.subject) || '').trim()
    const data: { nome?: string; profilePicUrl?: string } = {}

    if (subject && subject !== lead.nome) data.nome = subject.slice(0, 191)

    if (info?.pictureUrl) {
      const url = await baixarFotoDoGrupo(lead.id, info.pictureUrl, lead.profilePicUrl ?? null)
      if (url) data.profilePicUrl = url
    }

    if (!Object.keys(data).length) return null

    await prisma.lead.update({ where: { id: lead.id }, data })
    // Import dinâmico: o realtime é uma rota, e o serviço não pode depender dela
    // no topo sem criar ciclo de import.
    try {
      const { broadcastRealtimeEvent } = await import('../routes/realtime.js')
      broadcastRealtimeEvent({ type: 'lead:updated', payload: { id: lead.id, ...data }, scope: { leadId: lead.id } })
    } catch { /* realtime é enfeite: o F5 mostra do mesmo jeito */ }
    return data
  } catch {
    return null
  }
}

/**
 * Mesma sincronização, partindo do JID — é o que o webhook tem em mãos quando
 * chega `groups.update`. Grupo que não existe por aqui (conexão com grupos
 * desligados) simplesmente não faz nada.
 */
export async function sincronizarGrupoPorJid(
  groupJid: string,
  instanceName: string,
  opts: { force?: boolean; subject?: string | null } = {},
): Promise<{ nome?: string; profilePicUrl?: string } | null> {
  if (!groupJid.endsWith('@g.us')) return null
  const lead = await prisma.lead.findFirst({
    where: { groupJid },
    orderBy: { createdAt: 'asc' },
    select: { id: true, nome: true, profilePicUrl: true, instanceName: true },
  })
  if (!lead) return null
  // O titular manda: é a linha por onde a conversa fala. Só cai na instância que
  // entregou o evento quando o grupo ainda não tem titular.
  return sincronizarPerfilDoGrupo(lead, lead.instanceName || instanceName, groupJid, opts)
}

export interface GroupLeadInput {
  groupJid: string
  instanceName: string
}

/**
 * Acha (ou cria) o Lead que representa o grupo, dedupando por `groupJid`.
 *
 * O roteamento segue o dono da conexão (setor ou agente configurado na
 * instância), igual a qualquer lead que chega por ela — decisão de produto: um
 * grupo sem dono viraria conversa órfã numa fila que ninguém olha.
 */
export async function resolveGroupLead({ groupJid, instanceName }: GroupLeadInput) {
  const existing = await prisma.lead.findFirst({
    where: { groupJid },
    orderBy: { createdAt: 'asc' },
  })

  if (existing) {
    // Titular do grupo: adota este número quando o grupo ainda não tem um (é o
    // caso de todo grupo criado antes desta regra) ou quando o titular morreu.
    const dono = await ensureGroupChannelOwner(existing, instanceName)
    if (dono !== existing.instanceName) existing.instanceName = dono

    // Perfil em dia. Placeholder é o caso urgente (o nome na tela não diz nada a
    // ninguém): espera a consulta. Grupo já nomeado revalida em segundo plano,
    // com TTL — é o que pega renome e troca de foto sem depender de evento.
    if (isPlaceholderName(existing.nome)) {
      const perfil = await sincronizarPerfilDoGrupo(existing, dono, groupJid, { force: true })
      if (perfil?.nome) return { ...existing, nome: perfil.nome }
    } else {
      void sincronizarPerfilDoGrupo(existing, dono, groupJid).catch(() => {})
    }
    return existing
  }

  const [info, routing, { generateUid }, { deriveLeadOrigin }] = await Promise.all([
    fetchGroupInfo(instanceName, groupJid),
    resolveRoutingFromContext({ source: 'whatsapp', instanceName }),
    import('./dedup.js'),
    import('../lib/leadOrigin.js'),
  ])

  const criado = await prisma.lead.create({
    data: {
      uid: await generateUid(),
      nome: info?.subject || placeholderName(groupJid),
      empresa: '',
      // Não é telefone: guardamos só os dígitos do JID para caber no campo, e o
      // JID completo em `groupJid` (fonte da verdade para envio e dedup).
      whatsapp: onlyDigits(groupJid).slice(0, 30),
      phoneKey: null,
      // Titular do grupo — ver `ensureGroupChannelOwner`. Quem criou a conversa
      // é o dono natural dela; o admin troca depois, dentro da conversa.
      instanceName,
      email: '',
      formData: { _source: 'whatsapp_group' },
      scores: {},
      lastStep: 0,
      completed: false,
      lastActivityAt: new Date(),
      source: 'whatsapp',
      originType: deriveLeadOrigin({ source: 'whatsapp', channel: 'whatsapp' }),
      isGroup: true,
      groupJid,
      teamId: routing.teamId,
      assignedUserId: routing.userId,
      assignedAt: routing.userId ? new Date() : null,
    },
  })

  // Foto em segundo plano: o grupo já aparece na lista sem ela, e a mensagem
  // que criou a conversa não pode esperar um download.
  if (info?.pictureUrl) {
    void baixarFotoDoGrupo(criado.id, info.pictureUrl, null)
      .then((url) => (url ? prisma.lead.update({ where: { id: criado.id }, data: { profilePicUrl: url } }) : null))
      .catch(() => {})
  }

  return criado
}

/**
 * Canal TITULAR do grupo — o número a que a conversa pertence.
 *
 * Quando duas linhas da mesma empresa participam do MESMO grupo, o WhatsApp
 * entrega cada mensagem para as duas. Sem titular, o canal da conversa saía da
 * última mensagem recebida — uma loteria entre as irmãs: no kobogo os dois
 * grupos "Acesso Remoto" apareciam no mesmo número, e a resposta saía por ele.
 *
 * O titular vive em `Lead.instanceName`, o mesmo campo que num contato já diz
 * por qual número ele chegou — grupo é lead, a semântica é a mesma.
 *
 * Regras de adoção, nesta ordem:
 *  1. Grupo sem titular (todos os criados antes desta regra) adota a linha que
 *     está entregando a mensagem — mantém o comportamento de hoje, e o admin
 *     troca depois na conversa.
 *  2. Titular apagado ou desativado deixa de valer e a linha viva assume: sem
 *     isso o grupo emudeceria junto com a instância desligada.
 *  3. Caso normal: o titular é mantido, venha a mensagem por qual linha vier.
 *
 * NÃO descarta mensagem: quem impede a duplicata é o dedup por `externalId`
 * dentro do lead (rotas/whatsapp.ts). Travar a entrada no titular deixaria o
 * grupo mudo sempre que ele caísse — a linha irmã continua sendo porta válida.
 */
export async function ensureGroupChannelOwner(
  lead: { id: number; instanceName: string | null },
  instanceName: string,
): Promise<string> {
  const atual = lead.instanceName
  if (atual === instanceName) return atual
  if (atual) {
    const viva = await prisma.whatsAppInstance.findFirst({
      where: { instanceName: atual, active: true },
      select: { id: true },
    })
    if (viva) return atual
  }
  await prisma.lead.update({ where: { id: lead.id }, data: { instanceName } }).catch(() => {})
  return instanceName
}

/**
 * Titular de cada grupo, já descartando o que aponta para linha desligada.
 *
 * É a fonte única de "de quem é esta conversa de grupo" para o rótulo do canal,
 * o filtro por número e o número por onde a resposta sai — os três precisam
 * responder igual, senão a conversa aparece na lista de um número mostrando o
 * nome de outro. Titular de instância inativa não vale: o canal cai de volta na
 * regra geral (a última mensagem), em vez de apontar para um número desligado.
 *
 * Sem `leadIds` devolve todos os grupos — é o que o filtro por número precisa,
 * que parte do canal e não de uma lista de conversas.
 */
export async function titularesDeGrupos(leadIds?: number[]): Promise<Map<number, string>> {
  const mapa = new Map<number, string>()
  if (leadIds && !leadIds.length) return mapa

  const grupos = await prisma.lead.findMany({
    where: {
      isGroup: true,
      instanceName: { not: null },
      ...(leadIds ? { id: { in: leadIds } } : {}),
    },
    select: { id: true, instanceName: true },
  })
  if (!grupos.length) return mapa

  const vivas = new Set(
    (await prisma.whatsAppInstance.findMany({
      where: { instanceName: { in: [...new Set(grupos.map((g) => g.instanceName as string))] }, active: true },
      select: { instanceName: true },
    })).map((i) => i.instanceName),
  )
  for (const g of grupos) {
    if (g.instanceName && vivas.has(g.instanceName)) mapa.set(g.id, g.instanceName)
  }
  return mapa
}

/**
 * Nome de quem falou no grupo, para o cabeçalho da mensagem. O `pushName` do
 * payload é do PARTICIPANTE que enviou (não do grupo); sem ele, cai para os
 * dígitos do JID do participante.
 */
export function groupSenderName(pushName: string | null | undefined, participantJid: string | null | undefined): string {
  const name = (pushName || '').trim()
  if (name) return name.slice(0, 100)
  const digits = onlyDigits(participantJid || '')
  return digits ? digits.slice(0, 100) : 'Participante'
}

/**
 * A conexão desta mensagem aceita grupos? OFF (default) = descarta, que é o
 * comportamento histórico de toda instalação.
 */
export async function instanceAcceptsGroups(instanceName: string): Promise<boolean> {
  const inst = await prisma.whatsAppInstance.findFirst({
    where: { instanceName },
    select: { receiveGroups: true },
  })
  return inst?.receiveGroups === true
}
