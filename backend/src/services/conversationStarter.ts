// src/services/conversationStarter.ts
//
// Abrir conversa com um número que ainda não está no painel.
//
// O time comercial recebe um contato por fora (indicação, evento, ligação) e
// precisa falar com ele agora — sem esperar o contato mandar a primeira
// mensagem para o lead nascer pelo webhook.
//
// A regra que manda aqui é a de identidade: se já existe lead com o mesmo
// telefone canônico (`phoneKey`), a conversa é a DELE. Criar um segundo lead
// para o mesmo número é o começo de toda base duplicada.

import { prisma } from '../lib/prisma.js'
import { phoneKey, onlyDigits } from '../lib/phone.js'
import { generateUid } from './dedup.js'

export interface StartConversationInput {
  nome: string
  telefone: string
  /** Número de saída escolhido; a primeira mensagem trava a conversa nele. */
  channelId?: string | null
  actor: { userId: number; role: string; name?: string | null }
  /** Pula a checagem "existe no WhatsApp" (número internacional, teste). */
  ignorarChecagem?: boolean
}

export type StartConversationResult =
  | { ok: true; leadId: number; criado: boolean; jaTinhaConversa: boolean }
  | { ok: false; status: number; error: string; code?: string; leadId?: number }

export async function startConversation(input: StartConversationInput): Promise<StartConversationResult> {
  const nome = (input.nome || '').trim()
  const digitos = onlyDigits(input.telefone)
  if (!digitos || digitos.length < 10) {
    return { ok: false, status: 400, error: 'Informe um número válido com DDD.' }
  }
  const chave = phoneKey(digitos)
  if (!chave) {
    return { ok: false, status: 400, error: 'Número não reconhecido como telefone válido.' }
  }

  // 1. Já existe? Então a conversa é a dele — nunca um segundo lead.
  const existente = await prisma.lead.findFirst({
    where: { phoneKey: chave },
    orderBy: { createdAt: 'desc' },
    select: { id: true, nome: true, conversationOpenedAt: true, conversationClosedAt: true },
  })

  // 2. Número tem WhatsApp? Abrir conversa com número que não existe gera um
  //    ticket morto e queima envio depois. A checagem usa a instância do
  //    remetente; se falhar (Evolution fora do ar), segue em frente — barrar o
  //    operador por indisponibilidade nossa seria pior.
  if (!input.ignorarChecagem) {
    try {
      const wp = await import('./whatsappProvider.js')
      // A checagem "existe no WhatsApp" só existe na Evolution (a Cloud API não
      // expõe isso). Então procura-se uma instância Evolution ativa em vez de
      // usar o provider padrão — que no beyond é Cloud API e fazia a validação
      // passar batido, deixando número inexistente virar conversa.
      let provider: any = null
      if (input.channelId?.startsWith('evolution:')) {
        provider = (await wp.getProviderForChannel(input.channelId)).provider
      } else {
        const inst = await prisma.whatsAppInstance.findFirst({
          where: { active: true },
          select: { instanceName: true },
          orderBy: { id: 'asc' },
        })
        if (inst) provider = (await wp.getProviderForChannel(`evolution:${inst.instanceName}`)).provider
      }
      if (provider?.providerName === 'evolution' && typeof provider.checkNumbers === 'function') {
        const r = await provider.checkNumbers([digitos])
        if (r.length && r[0] && r[0].exists === false) {
          return {
            ok: false,
            status: 422,
            code: 'NO_WHATSAPP',
            error: 'Este número não tem WhatsApp. Confira o DDD e o dígito 9.',
          }
        }
      }
    } catch { /* indisponibilidade da checagem não bloqueia o atendimento */ }
  }

  let leadId: number
  let criado = false

  if (existente) {
    leadId = existente.id
    // Só completa o nome quando o lead ainda não tem um — não sobrescreve o que
    // o contato informou por outro canal.
    if (nome && !(existente.nome || '').trim()) {
      await prisma.lead.update({ where: { id: leadId }, data: { nome } })
    }
  } else {
    const { resolveDefaultTeamId } = await import('./teamRouting.js')
    const teamId = await resolveDefaultTeamId().catch(() => null)
    const novo = await prisma.lead.create({
      data: {
        uid: await generateUid(),
        nome: nome || digitos,
        whatsapp: digitos,
        phoneKey: chave,
        email: '',
        empresa: '',
        scores: {},
        status: 'NOVO',
        source: 'manual',
        teamId,
        assignedUserId: input.actor.userId,
        formData: { origem: 'conversa_manual', criadoPor: input.actor.name || input.actor.userId },
      },
      select: { id: true },
    })
    leadId = novo.id
    criado = true
  }

  const jaTinhaConversa = !!existente?.conversationOpenedAt && !existente?.conversationClosedAt

  const { ensureConversationOpen } = await import('./leadConversation.js')
  await ensureConversationOpen(leadId, {
    byUserId: input.actor.userId,
    byUserName: input.actor.name || undefined,
    reason: 'manual_start',
  }).catch(() => {})

  return { ok: true, leadId, criado, jaTinhaConversa }
}
