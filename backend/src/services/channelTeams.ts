// src/services/channelTeams.ts
//
// Setores donos de um número de WhatsApp — Evolution (WhatsAppInstance) ou
// Cloud API (CloudApiConnection). Antes o dono era um só: `defaultTeamId` (um
// setor) OU `ownerUserId` (um agente). Um número de recepção atendido por
// Comercial e Suporte obrigava a escolher um deles, e o outro setor não podia
// responder por aquela linha.
//
// Convenção que mantém o roteamento existente intacto:
//
//   `defaultTeamId` continua sendo o setor ÚNICO. Fica preenchido quando há
//   exatamente um setor dono e NULO quando há vários. Com vários, o lead entra
//   sem setor e quem decide é o chatbot/menu — foi a regra combinada, e ela cai
//   naturalmente do código que já existe (todo lugar que lê `defaultTeamId`
//   simplesmente não encontra setor e segue para a decisão seguinte).
//
// A lista N:N é a fonte da verdade de QUEM PODE responder pelo número; o campo
// único é derivado dela.

import { prisma } from '../lib/prisma.js'

export type ChannelKind = 'evolution' | 'cloud'

/** Setores donos de um canal (ids), na ordem de cadastro. */
export async function channelTeamIds(kind: ChannelKind, channelId: number): Promise<number[]> {
  if (kind === 'evolution') {
    const rows = await prisma.whatsAppInstanceTeam.findMany({
      where: { instanceId: channelId }, select: { teamId: true }, orderBy: { id: 'asc' },
    })
    return rows.map((r) => r.teamId)
  }
  const rows = await prisma.cloudApiConnectionTeam.findMany({
    where: { connectionId: channelId }, select: { teamId: true }, orderBy: { id: 'asc' },
  })
  return rows.map((r) => r.teamId)
}

/**
 * Substitui a lista de setores donos e sincroniza `defaultTeamId`.
 * Setor dono e agente dono continuam mutuamente exclusivos: definir setores
 * limpa o agente (quem chama valida e avisa antes).
 */
export async function setChannelTeams(kind: ChannelKind, channelId: number, teamIds: number[]): Promise<number[]> {
  const ids = Array.from(new Set(teamIds.map(Number).filter((n) => Number.isInteger(n) && n > 0)))
  // Só setores que existem e estão ativos — id órfão viraria dono fantasma.
  const validos = ids.length
    ? (await prisma.team.findMany({ where: { id: { in: ids }, active: true }, select: { id: true } })).map((t) => t.id)
    : []
  const ordenados = ids.filter((id) => validos.includes(id))

  if (kind === 'evolution') {
    await prisma.whatsAppInstanceTeam.deleteMany({ where: { instanceId: channelId } })
    for (const teamId of ordenados) {
      await prisma.whatsAppInstanceTeam.create({ data: { instanceId: channelId, teamId } }).catch(() => {})
    }
    await prisma.whatsAppInstance.update({
      where: { id: channelId },
      data: {
        defaultTeamId: ordenados.length === 1 ? ordenados[0]! : null,
        ...(ordenados.length ? { ownerUserId: null } : {}),
      },
    }).catch(() => {})
  } else {
    await prisma.cloudApiConnectionTeam.deleteMany({ where: { connectionId: channelId } })
    for (const teamId of ordenados) {
      await prisma.cloudApiConnectionTeam.create({ data: { connectionId: channelId, teamId } }).catch(() => {})
    }
    await prisma.cloudApiConnection.update({
      where: { id: channelId },
      data: {
        defaultTeamId: ordenados.length === 1 ? ordenados[0]! : null,
        ...(ordenados.length ? { ownerUserId: null } : {}),
      },
    }).catch(() => {})
  }
  return ordenados
}

/** Setores ativos de um usuário. */
export async function userTeamIds(userId: number): Promise<number[]> {
  const rows = await prisma.teamMember.findMany({
    where: { userId, team: { active: true } }, select: { teamId: true }, orderBy: { id: 'asc' },
  })
  return rows.map((r) => r.teamId)
}

/** O usuário pertence a algum dos setores donos deste canal? */
export async function userSharesChannelTeam(userId: number, kind: ChannelKind, channelId: number): Promise<boolean> {
  const [donos, meus] = await Promise.all([channelTeamIds(kind, channelId), userTeamIds(userId)])
  if (donos.length === 0) return false
  return donos.some((t) => meus.includes(t))
}

/**
 * Canal cujo setor dono o usuário compartilha — o "número do setor dele".
 * Usado no envio, depois do canal pessoal do agente: quem não tem número
 * próprio fala pela linha do seu setor em vez de cair no número global.
 * Evolution tem preferência sobre Cloud API por entregar texto livre fora da
 * janela de 24h.
 */
export async function channelForUserTeams(
  userId: number,
): Promise<{ kind: ChannelKind; id: number; instanceName?: string; phoneNumberId?: string; token?: string } | null> {
  const meus = await userTeamIds(userId)
  if (meus.length === 0) return null

  const evo = await prisma.whatsAppInstanceTeam.findFirst({
    where: { teamId: { in: meus }, instance: { active: true } },
    orderBy: { id: 'asc' },
    select: { instance: { select: { id: true, instanceName: true } } },
  })
  if (evo?.instance) return { kind: 'evolution', id: evo.instance.id, instanceName: evo.instance.instanceName }

  const cloud = await prisma.cloudApiConnectionTeam.findFirst({
    where: { teamId: { in: meus }, connection: { active: true } },
    orderBy: { id: 'asc' },
    select: { connection: { select: { id: true, phoneNumberId: true, systemUserToken: true } } },
  })
  if (cloud?.connection) {
    return {
      kind: 'cloud', id: cloud.connection.id,
      phoneNumberId: cloud.connection.phoneNumberId, token: cloud.connection.systemUserToken,
    }
  }
  return null
}
