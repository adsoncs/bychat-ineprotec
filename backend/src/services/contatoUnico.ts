// src/services/contatoUnico.ts
//
// Um número, uma conversa.
//
// Canais automáticos (formulário, Meta Lead Ads, portal, API) podem criar uma
// segunda ficha para quem já existe; ela nasce marcada como possível duplicado
// (dedup.ts → flagDuplicate) e espera alguém mesclar. O que NUNCA pode haver é
// duas conversas com o mesmo número: o candidato responde num chat, o agente
// escreve no outro, e cada um acha que o outro sumiu (fabad, 13/10: leads 119 ×
// 432 e 286 × 425, agentes diferentes no mesmo WhatsApp).
//
// As travas daqui seguem a MESMA régua do resolvedor de mensagens recebidas
// (contactIdentity → acharLeadDoContato): a ficha onde a resposta do contato
// cai é a única de onde se pode escrever para ele.

import { prisma } from '../lib/prisma.js'
import { phoneKey } from '../lib/phone.js'
import { acharLeadDoContato, type CanalDoContato } from './contactIdentity.js'

export interface ContatoDuplicado {
  error: string
  code: 'CONTATO_DUPLICADO'
  leadId: number
  nome: string
  responsavel: string | null
}

async function descrever(leadId: number, motivo: (nome: string, resp: string | null) => string): Promise<ContatoDuplicado | null> {
  const outro = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, nome: true, assignedUser: { select: { name: true, email: true } } },
  })
  if (!outro) return null
  const nome = (outro.nome || '').trim() || `#${outro.id}`
  const responsavel = outro.assignedUser?.name || outro.assignedUser?.email || null
  return { error: motivo(nome, responsavel), code: 'CONTATO_DUPLICADO', leadId: outro.id, nome, responsavel }
}

/**
 * Telefone ou e-mail que já é de OUTRA ficha. Usado na edição de dados do
 * contato — o caminho manual não pode criar o que os canais automáticos só
 * conseguem com aviso.
 */
export async function contatoJaCadastrado(
  leadId: number,
  novo: { whatsapp?: string | null; email?: string | null },
): Promise<ContatoDuplicado | null> {
  const pk = novo.whatsapp ? phoneKey(novo.whatsapp) : null
  if (pk) {
    const outro = await prisma.lead.findFirst({
      where: { phoneKey: pk, id: { not: leadId } },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    })
    if (outro) {
      return descrever(outro.id, (nome, resp) =>
        `Este WhatsApp já é do contato "${nome}" (#${outro.id}${resp ? `, com ${resp}` : ''}). Abra aquela ficha; se forem a mesma pessoa, use Mesclar.`)
    }
  }
  const em = String(novo.email || '').trim().toLowerCase()
  if (em.includes('@')) {
    const outro = await prisma.lead.findFirst({
      where: { email: em, id: { not: leadId } },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    })
    if (outro) {
      return descrever(outro.id, (nome, resp) =>
        `Este e-mail já é do contato "${nome}" (#${outro.id}${resp ? `, com ${resp}` : ''}). Abra aquela ficha; se forem a mesma pessoa, use Mesclar.`)
    }
  }
  return null
}

/**
 * A conversa deste número vive em OUTRA ficha? Devolve qual, para o painel
 * mandar o agente para lá em vez de abrir um segundo chat.
 *
 * "Outra ficha" é a que o resolvedor de mensagens recebidas escolheria para
 * este número e este canal — ficha principal antes de duplicata pendente. Se a
 * resposta do contato cairia nesta mesma ficha, não há conflito.
 */
export async function conversaEmOutraFicha(leadId: number): Promise<ContatoDuplicado | null> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, whatsapp: true, phoneKey: true, instanceName: true, cloudApiConnectionId: true, isGroup: true },
  })
  if (!lead || lead.isGroup) return null
  const fone = lead.phoneKey || lead.whatsapp
  if (!fone) return null

  const canal: CanalDoContato | null = lead.cloudApiConnectionId
    ? { cloudApiConnectionId: lead.cloudApiConnectionId }
    : lead.instanceName ? { instanceName: lead.instanceName } : null
  // Só leitura: sem adotar canal nem reconciliar identidade.
  const dono = await acharLeadDoContato(fone, { canal, reconciliar: false })
  if (!dono || dono.id === lead.id) return null

  return descrever(dono.id, (nome, resp) =>
    `Este número já tem conversa no contato "${nome}" (#${dono.id}${resp ? `, com ${resp}` : ''}). Continue por lá — duas conversas com o mesmo WhatsApp dividem o atendimento. Se forem a mesma pessoa, use Mesclar.`)
}
