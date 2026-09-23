// Conversa de um contato EM UM NÚMERO da empresa.
//
// Regra (22/09/2026): cada conversa tem o seu número e nada sai por outro
// dentro dela (whatsappProvider → canalDaConversa). Quando é preciso falar com
// o mesmo contato por outro número — o operador escolheu "Outro número", o
// disparo em massa sorteou outra linha —, a mensagem vai para a conversa
// DAQUELE número: a que já existe, ou uma nova. É o que o contato vê do lado
// dele: um chat por número.
import { prisma } from '../lib/prisma.js'
import { resolveLeadForContact, semFichaEmDobro, chaveDoContato, adotarNoCanal, type CanalDoContato } from './contactIdentity.js'
import { canalDaConversa } from './whatsappProvider.js'

export function canalDoChannelId(channelId: string): CanalDoContato | null {
  if (channelId.startsWith('cloud:')) {
    const id = parseInt(channelId.slice('cloud:'.length))
    return Number.isFinite(id) ? { cloudApiConnectionId: id } : null
  }
  if (channelId.startsWith('evolution:')) {
    const nome = channelId.slice('evolution:'.length)
    return nome ? { instanceName: nome } : null
  }
  return null
}

function mesmoCanal(a: CanalDoContato, b: { instanceName: string | null; cloudApiConnectionId: number | null }): boolean {
  return a.cloudApiConnectionId ? a.cloudApiConnectionId === b.cloudApiConnectionId : a.instanceName === b.instanceName
}

export interface ConversaNoNumero { leadId: number; criada: boolean }

/**
 * Acha (ou cria) a conversa do contato `origemLeadId` no número `canal`.
 * Nunca muda o número da conversa de origem.
 */
export async function conversaNoNumero(
  origemLeadId: number,
  canal: CanalDoContato,
  opts: { assignedUserId?: number | null; source?: string; motivo?: string } = {},
): Promise<ConversaNoNumero | null> {
  const origem = await prisma.lead.findUnique({ where: { id: origemLeadId } })
  if (!origem || origem.groupJid) return null

  const fixo = await canalDaConversa(origemLeadId)
  // A conversa de origem já é deste número (ou não tem número: passa a ser).
  if (!fixo) {
    await adotarNoCanal(origemLeadId, canal)
    return { leadId: origemLeadId, criada: false }
  }
  if (mesmoCanal(canal, fixo)) return { leadId: origemLeadId, criada: false }

  // Lead legado com o número vindo só das mensagens: grava-o como dono ANTES de
  // procurar pelo outro número — senão a busca "sem dono" adotaria a própria
  // conversa de origem e a mudaria de número.
  if (!origem.instanceName && !origem.cloudApiConnectionId) {
    await adotarNoCanal(origemLeadId, fixo.cloudApiConnectionId ? { cloudApiConnectionId: fixo.cloudApiConnectionId } : { instanceName: fixo.instanceName })
  }

  const telefone = origem.whatsapp || ''
  const chave = chaveDoContato(telefone || origem.waLid, canal.instanceName ?? `cloud:${canal.cloudApiConnectionId}`)
  return semFichaEmDobro(chave, async () => {
    const ja = await resolveLeadForContact({ phone: telefone || null, waLid: origem.waLid }, canal)
    if (ja.lead && ja.lead.id !== origemLeadId) return { leadId: ja.lead.id, criada: false }

    const { generateUid } = await import('./dedup.js')
    const novo = await prisma.lead.create({
      data: {
        uid: await generateUid(),
        nome: origem.nome, nomeOrigem: origem.nomeOrigem,
        whatsapp: origem.whatsapp, waLid: origem.waLid,
        email: origem.email || '', empresa: origem.empresa || '',
        cidade: origem.cidade, segmento: origem.segmento,
        ...(canal.cloudApiConnectionId ? { cloudApiConnectionId: canal.cloudApiConnectionId } : { instanceName: canal.instanceName }),
        formData: { _source: 'whatsapp', _abertaAPartirDe: origemLeadId, ...(opts.motivo ? { _motivo: opts.motivo } : {}) },
        scores: {}, lastStep: 0, completed: false,
        lastActivityAt: new Date(),
        source: opts.source ?? 'manual',
        originType: 'manual',
        teamId: origem.teamId,
        assignedUserId: opts.assignedUserId ?? origem.assignedUserId,
        assignedAt: new Date(),
      },
    })
    return { leadId: novo.id, criada: true }
  })
}
