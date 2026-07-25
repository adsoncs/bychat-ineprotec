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
