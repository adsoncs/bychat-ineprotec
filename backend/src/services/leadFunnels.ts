// src/services/leadFunnels.ts
//
// Um lead em mais de um funil.
//
// O modelo antigo é um campo só: `Lead.funnelId` + `Lead.status`. Um funil por
// lead, e trocar de funil é destrutivo — o lead sai de um e entra no outro,
// perdendo a posição no primeiro. No severiano, com 9 funis ativos, 51 leads já
// fizeram essa troca.
//
// A tabela `LeadFunnel` acrescenta os demais vínculos. O que NÃO muda:
// `Lead.funnelId`/`Lead.status` continuam existindo e valendo como o funil
// PRINCIPAL — é o que o Kanban, o Relatório de Funil, as metas e as condições de
// workflow leem, em 909 pontos do código. Migrar tudo de uma vez seria trocar o
// motor com o carro andando.
//
// Divisão de papéis — e a decisão que sustenta tudo:
//
//   · O funil PRINCIPAL não é espelhado aqui. Ele é lido do próprio Lead, na
//     hora. Cheguei a espelhar por escrita dupla e desfiz: existem DOZE pontos
//     no código que gravam `funnelId`/`status` direto no Lead (rotas de status,
//     make, kommoSync, schedulingService, aiJourneyService, avaliação de
//     matrícula...), e instrumentar todos seria garantir que um dia um deles
//     ficaria de fora e os dois modelos passariam a contar histórias
//     diferentes. Derivar na leitura não tem esse risco: só existe uma fonte.
//
//   · Esta tabela guarda SÓ os funis ADICIONAIS — o que antes não tinha onde
//     ser representado. `adicionarAoFunil` nunca toca no principal.
//
// Trocar de funil segue sendo trocar, pelas rotas de sempre.

import { prisma } from '../lib/prisma.js'
import { logEvent, EVENT_TYPES } from './leadHistory.js'

export interface VinculoDeFunil {
  funnelId: number
  funnelName: string
  stageKey: string | null
  stageName: string | null
  principal: boolean
  entrouEm: Date
  saiuEm: Date | null
  outcome: string | null
}

/**
 * Coloca o lead em MAIS um funil, sem mexer no principal.
 *
 * Devolve `{ ok: false }` com motivo quando não dá — funil inexistente, etapa
 * que não é daquele funil, ou lead já ativo nele.
 */
export async function adicionarAoFunil(input: {
  leadId: number
  funnelId: number
  stageKey?: string | null
  origem?: string
  userId?: number | null
  userName?: string | null
}): Promise<{ ok: true; stageKey: string | null } | { ok: false; erro: string }> {
  const { leadId, funnelId, origem = 'manual', userId = null, userName = null } = input

  const [lead, funil] = await Promise.all([
    prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, funnelId: true } }),
    prisma.funnel.findUnique({ where: { id: funnelId }, select: { id: true, name: true, active: true } }),
  ])
  if (!lead) return { ok: false, erro: 'Lead não encontrado.' }
  if (!funil) return { ok: false, erro: 'Funil não encontrado.' }
  if (!funil.active) return { ok: false, erro: `O funil "${funil.name}" está desativado.` }

  // Etapa: a pedida, se for daquele funil; senão a primeira. Gravar uma etapa de
  // OUTRO funil deixaria o lead numa posição que não existe no quadro — o mesmo
  // cuidado que o moveLeadStage já toma.
  let stageKey = input.stageKey ?? null
  if (stageKey) {
    const existe = await prisma.stage.findFirst({ where: { funnelId, key: stageKey }, select: { key: true } })
    if (!existe) stageKey = null
  }
  if (!stageKey) {
    const primeira = await prisma.stage.findFirst({
      where: { funnelId, active: true },
      orderBy: { position: 'asc' },
      select: { key: true },
    })
    stageKey = primeira?.key ?? null
  }

  // O principal vive no Lead; duplicá-lo aqui faria o mesmo funil aparecer duas
  // vezes na tela e daria ao operador um "remover" que não removeria nada.
  if (lead.funnelId === funnelId) {
    return { ok: false, erro: `"${funil.name}" já é o funil principal deste lead.` }
  }

  const atual = await prisma.leadFunnel.findUnique({
    where: { leadId_funnelId: { leadId, funnelId } },
    select: { id: true, saiuEm: true },
  })
  if (atual && atual.saiuEm === null) {
    return { ok: false, erro: `Este lead já está no funil "${funil.name}".` }
  }

  await prisma.leadFunnel.upsert({
    where: { leadId_funnelId: { leadId, funnelId } },
    create: { leadId, funnelId, stageKey, principal: false, origem },
    update: { stageKey, saiuEm: null, outcome: null, outcomeAt: null, origem },
  })

  logEvent({
    leadId,
    type: EVENT_TYPES.STATUS_CHANGED,
    category: 'lifecycle',
    title: `Lead também entrou no funil "${funil.name}"`,
    source: origem,
    actorType: userId ? 'operator' : 'system',
    userId: userId ?? undefined,
    userName: userName ?? undefined,
    newValue: stageKey ?? undefined,
    metadata: { funnelId, stageKey, adicional: true },
  })

  return { ok: true, stageKey }
}

/** Tira o lead de um funil adicional. O principal sai por `moveLeadStage`. */
export async function removerDoFunil(input: {
  leadId: number
  funnelId: number
  userId?: number | null
  userName?: string | null
}): Promise<{ ok: true } | { ok: false; erro: string }> {
  const { leadId, funnelId, userId = null, userName = null } = input

  // O principal é checado ANTES de procurar na tabela: ele não TEM linha aqui
  // (vive no Lead), então a busca não o acharia e o operador ouviria "este lead
  // não está nesse funil" — que é falso e manda ele procurar no lugar errado.
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { funnelId: true } })
  if (lead?.funnelId === funnelId) {
    return { ok: false, erro: 'Esse é o funil principal do lead. Mova-o pelo Kanban ou pelo painel da conversa.' }
  }

  const vinculo = await prisma.leadFunnel.findUnique({
    where: { leadId_funnelId: { leadId, funnelId } },
    select: { id: true, saiuEm: true, funnel: { select: { name: true } } },
  })
  if (!vinculo || vinculo.saiuEm !== null) return { ok: false, erro: 'Este lead não está nesse funil.' }

  await prisma.leadFunnel.update({ where: { id: vinculo.id }, data: { saiuEm: new Date() } })
  logEvent({
    leadId,
    type: EVENT_TYPES.STATUS_CHANGED,
    category: 'lifecycle',
    title: `Lead saiu do funil "${vinculo.funnel.name}"`,
    source: 'panel',
    actorType: userId ? 'operator' : 'system',
    userId: userId ?? undefined,
    userName: userName ?? undefined,
    metadata: { funnelId, adicional: true, saiu: true },
  })
  return { ok: true }
}

/** Move a etapa do lead DENTRO de um funil adicional. */
export async function moverEtapaNoFunil(input: {
  leadId: number
  funnelId: number
  stageKey: string
  userId?: number | null
}): Promise<{ ok: true } | { ok: false; erro: string }> {
  const { leadId, funnelId, stageKey, userId = null } = input
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { funnelId: true } })
  if (lead?.funnelId === funnelId) {
    return { ok: false, erro: 'Para o funil principal use a movimentação normal do lead.' }
  }

  const vinculo = await prisma.leadFunnel.findUnique({
    where: { leadId_funnelId: { leadId, funnelId } },
    select: { id: true, saiuEm: true, stageKey: true },
  })
  if (!vinculo || vinculo.saiuEm !== null) return { ok: false, erro: 'Este lead não está nesse funil.' }
  const etapa = await prisma.stage.findFirst({ where: { funnelId, key: stageKey }, select: { key: true } })
  if (!etapa) return { ok: false, erro: 'Essa etapa não existe neste funil.' }
  if (vinculo.stageKey === stageKey) return { ok: true }

  await prisma.leadFunnel.update({ where: { id: vinculo.id }, data: { stageKey } })
  logEvent({
    leadId,
    type: EVENT_TYPES.STATUS_CHANGED,
    category: 'lifecycle',
    title: 'Etapa alterada em funil adicional',
    source: 'panel',
    actorType: userId ? 'operator' : 'system',
    userId: userId ?? undefined,
    oldValue: vinculo.stageKey ?? undefined,
    newValue: stageKey,
    metadata: { funnelId, adicional: true },
  })
  return { ok: true }
}

/**
 * Os funis do lead, o principal primeiro.
 *
 * O principal é lido do PRÓPRIO Lead, não da tabela: é lá que ele vive e é de
 * lá que o resto do sistema o lê. A tabela entra só com os adicionais. É isso
 * que torna impossível os dois modelos divergirem.
 *
 * `incluirHistorico` traz também os adicionais de onde ele já saiu.
 */
export async function funisDoLead(leadId: number, incluirHistorico = false): Promise<VinculoDeFunil[]> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { funnelId: true, status: true, outcome: true, createdAt: true },
  })
  if (!lead) return []

  const adicionais = await prisma.leadFunnel.findMany({
    where: {
      leadId,
      // O principal pode ter uma linha antiga aqui (o lead já esteve nele como
      // adicional antes de virar principal): ela não deve aparecer duas vezes.
      ...(lead.funnelId ? { funnelId: { not: lead.funnelId } } : {}),
      ...(incluirHistorico ? {} : { saiuEm: null }),
    },
    include: { funnel: { select: { id: true, name: true } } },
    orderBy: { entrouEm: 'asc' },
  })

  const idsDeFunis = [
    ...(lead.funnelId ? [lead.funnelId] : []),
    ...adicionais.map((a) => a.funnelId),
  ]
  if (!idsDeFunis.length) return []

  // Nome da etapa por funil: a chave sozinha ("QUALIFICACAO") não é o que a
  // empresa batizou, e cada funil pode chamar a mesma chave de outro jeito.
  const [etapas, funisPrincipais] = await Promise.all([
    prisma.stage.findMany({
      where: { funnelId: { in: [...new Set(idsDeFunis)] } },
      select: { funnelId: true, key: true, name: true },
    }),
    lead.funnelId
      ? prisma.funnel.findUnique({ where: { id: lead.funnelId }, select: { id: true, name: true } })
      : Promise.resolve(null),
  ])
  const nomeDaEtapa = new Map(etapas.map((e) => [`${e.funnelId}:${e.key}`, e.name]))

  const lista: VinculoDeFunil[] = []
  if (lead.funnelId && funisPrincipais) {
    lista.push({
      funnelId: lead.funnelId,
      funnelName: funisPrincipais.name,
      stageKey: lead.status ?? null,
      stageName: lead.status ? (nomeDaEtapa.get(`${lead.funnelId}:${lead.status}`) ?? lead.status) : null,
      principal: true,
      entrouEm: lead.createdAt,
      saiuEm: null,
      outcome: lead.outcome ?? null,
    })
  }
  for (const a of adicionais) {
    lista.push({
      funnelId: a.funnelId,
      funnelName: a.funnel.name,
      stageKey: a.stageKey,
      stageName: a.stageKey ? (nomeDaEtapa.get(`${a.funnelId}:${a.stageKey}`) ?? a.stageKey) : null,
      principal: false,
      entrouEm: a.entrouEm,
      saiuEm: a.saiuEm,
      outcome: a.outcome,
    })
  }
  return lista
}
