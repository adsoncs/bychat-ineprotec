// src/services/leadSemDono.ts
//
// Nenhum lead com direção fica sem responsável.
//
// Reclamação do cliente (fabad, 22/10): ficha que nascia da inscrição, ou que
// perdia a vez no rodízio, ficava só com a equipe — sem ninguém — até alguém
// distribuir na mão (houve inscrição parada 87 h). O reparo que existia
// (`redistribuirSemDono`) só age quando o contato volta a escrever, e quem se
// inscreveu e parou não escreve.
//
// Duas chaves em Cadastros › Roteamento (padrão desligado):
//
//   inscricaoHerdaDono — a ficha nova do portal (ou a ficha sem dono que a
//       inscrição reaproveita) recebe o responsável que a MESMA pessoa já tem
//       em outra ficha: mesmo WhatsApp ou mesmo CPF, nunca CPF diferente
//       (celular da família). Só quando esse responsável é da equipe do portal
//       ou a outra ficha já está nessa equipe — aluno da Secretaria que se
//       inscreve num curso novo continua indo para o rodízio de Vendas.
//
//   varreduraSemDono — a cada 5 min, lead sem responsável que já tem direção
//       (equipe; senão a equipe dona do funil; senão a equipe do portal da
//       inscrição) recebe alguém pelo rodízio. Ninguém elegível → reserva da
//       equipe (líder; sem líder, quem tem menos leads abertos) + alerta.
//       Equipe fechada pelo horário espera abrir; equipe em modo manual é fila
//       de claim de propósito e fica de fora.

import { prisma } from '../lib/prisma.js'
import { normalizeCpf } from '../lib/cpf.js'
import { phoneKey } from '../lib/phone.js'
import { escolherComPlantao, getAjustesRoteamento } from './teamRouting.js'
import { isTeamOpen } from './routing/workingHours.js'
import { logEvent, EVENT_TYPES } from './leadHistory.js'
import { raiseAlert, resolveAlert } from './alertService.js'

const CARENCIA_MS = 3 * 60_000
const LOTE = 200

const cpfDe = (fd: unknown) => normalizeCpf(String((fd as any)?.cpf ?? ''))

async function usuarioQueAtende(userId: number): Promise<boolean> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { active: true, role: true } })
  return !!u?.active && u.role !== 'VIEWER'
}

/**
 * Responsável que a mesma pessoa já tem em outra ficha, para a inscrição
 * cair com ele. Devolve null quando a chave está desligada, quando não há
 * outra ficha com dono ou quando esse dono não atende a equipe do portal.
 */
export async function donoDaMesmaPessoa(dados: {
  whatsapp?: string | null
  cpf?: string | null
  teamId: number | null
  excetoLeadId?: number | null
}): Promise<{ userId: number; leadId: number } | null> {
  const ajustes = await getAjustesRoteamento()
  if (!ajustes.inscricaoHerdaDono || !dados.teamId) return null
  const chave = phoneKey(dados.whatsapp || '')
  const cpf = normalizeCpf(String(dados.cpf || ''))
  const temCpf = cpf.length === 11

  const porCpf = temCpf
    ? await prisma.enrollmentRegistration.findMany({
        where: { status: { not: 'merged' }, leadId: { not: null } },
        orderBy: { id: 'desc' }, take: 3000, select: { leadId: true, formData: true },
      }).then((rs) => rs.filter((r) => cpfDe(r.formData) === cpf).map((r) => r.leadId as number)).catch(() => [] as number[])
    : []
  const ou: any[] = []
  if (chave) ou.push({ phoneKey: chave })
  if (porCpf.length) ou.push({ id: { in: [...new Set(porCpf)] } })
  if (!ou.length) return null

  const candidatas = await prisma.lead.findMany({
    where: {
      OR: ou, assignedUserId: { not: null }, isGroup: false,
      ...(dados.excetoLeadId ? { id: { not: dados.excetoLeadId } } : {}),
    },
    orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
    take: 10,
    select: { id: true, assignedUserId: true, teamId: true, formData: true },
  }).catch(() => [])

  for (const c of candidatas) {
    // Mesmo WhatsApp com CPF diferente é outra pessoa da casa.
    const cpfDela = cpfDe(c.formData)
    if (temCpf && cpfDela.length === 11 && cpfDela !== cpf) continue
    const userId = c.assignedUserId!
    if (!(await usuarioQueAtende(userId))) continue
    const membro = await prisma.teamMember.findFirst({ where: { teamId: dados.teamId, userId }, select: { id: true } })
    // Outro processo da mesma pessoa (ela já tem inscrição aberta nesta ficha):
    // o responsável é o mesmo, seja de que equipe for (fabad, 22/10).
    const { processosAbertos } = await import('./juncaoSegura.js')
    if (c.teamId !== dados.teamId && !membro && !(await processosAbertos(c.id)).length) continue
    return { userId, leadId: c.id }
  }
  return null
}

/** Equipe que o lead já tem; senão a dona do funil; senão a do portal da inscrição. */
async function direcaoDoLead(lead: { id: number; teamId: number | null; funnelId: number | null }): Promise<number | null> {
  if (lead.teamId) return lead.teamId
  if (lead.funnelId) {
    const t = await prisma.team.findFirst({ where: { funnelId: lead.funnelId, active: true }, orderBy: { id: 'asc' }, select: { id: true } })
    if (t) return t.id
  }
  const reg = await prisma.enrollmentRegistration.findFirst({
    where: { leadId: lead.id, status: { not: 'merged' } },
    orderBy: { id: 'desc' },
    select: { portal: { select: { teamId: true } } },
  }).catch(() => null)
  return reg?.portal?.teamId ?? null
}

/** Líder ativo da equipe; sem líder, o membro ativo com menos leads abertos. */
async function reservaDaEquipe(teamId: number): Promise<number | null> {
  const membros = await prisma.teamMember.findMany({
    where: { teamId, user: { active: true, role: { not: 'VIEWER' } } },
    select: { userId: true, isLeader: true },
    orderBy: { id: 'asc' },
  })
  if (!membros.length) return null
  const lider = membros.find((m) => m.isLeader)
  if (lider) return lider.userId
  const abertos = await prisma.lead.groupBy({
    by: ['assignedUserId'],
    where: { assignedUserId: { in: membros.map((m) => m.userId) }, outcome: null },
    _count: { _all: true },
  })
  const n = new Map(abertos.map((a) => [a.assignedUserId, a._count._all]))
  return [...membros].sort((a, b) => (n.get(a.userId) ?? 0) - (n.get(b.userId) ?? 0))[0].userId
}

/**
 * Uma volta da varredura. Só grava em lead que continua sem responsável na
 * hora da gravação — quem foi assumido no meio do caminho fica como está.
 */
export async function distribuirLeadsSemDono(opts: { soLeadIds?: number[] } = {}): Promise<{ distribuidos: number; reserva: number; semNinguem: number; aguardandoHorario: number }> {
  const out = { distribuidos: 0, reserva: 0, semNinguem: 0, aguardandoHorario: 0 }
  const ajustes = await getAjustesRoteamento()
  if (!ajustes.varreduraSemDono) return out

  const leads = await prisma.lead.findMany({
    where: {
      assignedUserId: null, isGroup: false, outcome: null,
      // Liberada ao resolver: fica na fila "Liberadas" até alguém puxar.
      conversaLiberadaEm: null,
      createdAt: { lt: new Date(Date.now() - CARENCIA_MS) },
      ...(opts.soLeadIds ? { id: { in: opts.soLeadIds } } : {}),
    },
    orderBy: { id: 'asc' },
    take: LOTE,
    select: { id: true, nome: true, teamId: true, funnelId: true },
  })
  const equipesSemNinguem = new Map<number, number>()

  for (const lead of leads) {
    const teamId = await direcaoDoLead(lead)
    if (!teamId) continue
    const team = await prisma.team.findUnique({ where: { id: teamId }, select: { name: true, active: true, routingMode: true, workingHoursEnabled: true } })
    if (!team?.active || (team.routingMode || 'manual') === 'manual') continue

    let destinoTeam = teamId
    let userId: number | null = null
    let motivo = 'varredura_sem_dono'
    const rota = await escolherComPlantao(teamId, 'varredura')
    if (rota.userId) {
      destinoTeam = rota.teamId
      userId = rota.userId
    } else if (team.workingHoursEnabled && !(await isTeamOpen(teamId))) {
      // Fechada pelo horário e sem plantão: a próxima volta depois de abrir entrega.
      out.aguardandoHorario++
      continue
    } else {
      userId = await reservaDaEquipe(teamId)
      motivo = 'reserva_da_equipe'
      if (!userId) {
        equipesSemNinguem.set(teamId, (equipesSemNinguem.get(teamId) ?? 0) + 1)
        out.semNinguem++
        continue
      }
    }

    const r = await prisma.lead.updateMany({
      where: { id: lead.id, assignedUserId: null },
      data: { assignedUserId: userId, assignedAt: new Date(), ...(lead.teamId === destinoTeam ? {} : { teamId: destinoTeam }) },
    })
    if (!r.count) continue
    const nome = (await prisma.user.findUnique({ where: { id: userId }, select: { name: true } }))?.name || `#${userId}`
    logEvent({
      leadId: lead.id,
      type: EVENT_TYPES.OPERATOR_ASSIGNED,
      category: 'operator',
      title: motivo === 'reserva_da_equipe'
        ? `Lead sem responsável: ninguém disponível em ${team.name} — ficou com ${nome} (reserva da equipe)`
        : `Lead sem responsável distribuído pelo rodízio: ${nome}`,
      actorType: 'system',
      metadata: { userId, teamId: destinoTeam, motivo },
    } as any)
    if (motivo === 'reserva_da_equipe') {
      out.reserva++
      await raiseAlert({
        dedupeKey: `lead:sem-dono:reserva:${lead.id}`, kind: 'lead_sem_dono', severity: 'warning', audience: 'owner',
        ownerUserId: userId,
        title: `Lead ficou com você como reserva: ${lead.nome || 'sem nome'}`,
        body: `Ninguém da equipe ${team.name} estava disponível no rodízio. O lead ficou com ${nome} para não ficar sem responsável — transfira se for o caso.`,
        entityType: 'lead', entityId: lead.id, teamId: destinoTeam,
        metadata: { leadId: lead.id },
      }).catch(() => null)
    } else {
      out.distribuidos++
    }
  }

  // Equipe sem nenhum membro ativo: o lead não tem para quem ir. A gestão é
  // avisada uma vez por equipe; o alerta fecha quando a equipe volta a ter gente.
  const equipes = await prisma.team.findMany({ where: { active: true }, select: { id: true, name: true } })
  for (const t of equipes) {
    const chave = `team:sem-ninguem-para-lead:${t.id}`
    const n = equipesSemNinguem.get(t.id)
    if (n) {
      await raiseAlert({
        dedupeKey: chave, kind: 'lead_sem_dono', severity: 'critical', audience: 'management',
        title: `Equipe ${t.name} sem ninguém para receber leads`,
        body: `${n} lead(s) desta equipe estão sem responsável e não há membro ativo para receber. Inclua alguém na equipe ou mova os leads.`,
        teamId: t.id, metadata: { teamId: t.id, leads: n },
      }).catch(() => null)
    } else if (!opts.soLeadIds) {
      await resolveAlert(chave).catch(() => false)
    }
  }
  return out
}

/**
 * Lead marcado Perdido num funil que tem a etapa de Perdido configurada volta
 * ao sistema sem responsável (chave routing.perdidoSemDono). A equipe fica: se
 * o contato voltar a escrever, o rodízio dela entrega de novo (chave
 * redistribuirSemDono); a varredura não pega perdido (só lead em aberto).
 */
export async function liberarDonoDoPerdido(leadId: number, quem?: string | null): Promise<boolean> {
  const ajustes = await getAjustesRoteamento()
  if (!ajustes.perdidoSemDono) return false
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { funnelId: true, assignedUserId: true, outcome: true, assignedUser: { select: { name: true } } } })
  if (!lead?.assignedUserId || lead.outcome !== 'lost' || !lead.funnelId) return false
  const etapaPerdido = await prisma.stage.findFirst({ where: { funnelId: lead.funnelId, terminalKind: 'lost' }, select: { id: true } })
  if (!etapaPerdido) return false
  const { comoRegraDeRoteamento } = await import('../lib/donoDoLead.js')
  const r = await comoRegraDeRoteamento(() => prisma.lead.updateMany({ where: { id: leadId, assignedUserId: lead.assignedUserId }, data: { assignedUserId: null, assignedAt: null } }))
  if (!r.count) return false
  logEvent({
    leadId,
    type: 'operator_released',
    category: 'operator',
    title: `Perdido: lead devolvido ao sistema sem responsável (estava com ${lead.assignedUser?.name ?? '#' + lead.assignedUserId})`,
    actorType: 'system',
    metadata: { previousAssignedUserId: lead.assignedUserId, motivo: 'perdido_sem_dono', por: quem ?? null },
  } as any)
  return true
}
