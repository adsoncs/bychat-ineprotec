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

import { prisma } from '../lib/prisma.js'
import { onlyDigits } from '../lib/phone.js'
import { resolveRoutingFromContext } from './teamRouting.js'

/** Nome de exibição quando ainda não sabemos o assunto do grupo. */
function placeholderName(groupJid: string): string {
  return `Grupo ${onlyDigits(groupJid).slice(-6)}`
}

function isPlaceholderName(name: string | null | undefined): boolean {
  return !name || /^Grupo \d{1,6}$/.test(name)
}

/**
 * Assunto (nome) do grupo via Evolution: GET /group/findGroupInfos.
 * Devolve null em qualquer falha — o nome do grupo é enfeite, não pode derrubar
 * o recebimento da mensagem.
 */
export async function fetchGroupSubject(instanceName: string, groupJid: string): Promise<string | null> {
  const base = process.env.EVOLUTION_API_URL || ''
  const key = process.env.EVOLUTION_API_KEY || ''
  if (!base || !key) return null
  try {
    const url = `${base}/group/findGroupInfos/${encodeURIComponent(instanceName)}?groupJid=${encodeURIComponent(groupJid)}`
    const res = await fetch(url, { headers: { apikey: key } })
    if (!res.ok) return null
    const info: any = await res.json()
    const subject = typeof info?.subject === 'string' ? info.subject.trim() : ''
    return subject || null
  } catch {
    return null
  }
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

    // Nome ainda placeholder (a API falhou na criação) ou grupo renomeado no
    // WhatsApp: tenta corrigir sem bloquear o fluxo.
    if (isPlaceholderName(existing.nome)) {
      const subject = await fetchGroupSubject(instanceName, groupJid)
      if (subject && subject !== existing.nome) {
        return prisma.lead.update({ where: { id: existing.id }, data: { nome: subject } })
      }
    }
    return existing
  }

  const [subject, routing, { generateUid }, { deriveLeadOrigin }] = await Promise.all([
    fetchGroupSubject(instanceName, groupJid),
    resolveRoutingFromContext({ source: 'whatsapp', instanceName }),
    import('./dedup.js'),
    import('../lib/leadOrigin.js'),
  ])

  return prisma.lead.create({
    data: {
      uid: await generateUid(),
      nome: subject || placeholderName(groupJid),
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
