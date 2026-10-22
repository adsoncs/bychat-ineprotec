// src/services/journey/validacaoContato.ts
//
// Validação do contato para a IA: o que o SISTEMA sabe sobre esta pessoa além
// da própria ficha — para confirmar o que ela diz ("já sou aluno", "já me
// inscrevi", "já falei com a Fulana") em vez de perguntar de novo ou seguir às
// cegas. Entra na "Ficha deste lead" (contextoDoLead), que é interna.
//
//   · atendimento: equipe atual, último atendente humano e se ele está ativo;
//   · histórico: se já conversou antes e por quais setores passou;
//   · outras fichas da mesma pessoa (WhatsApp, CPF ou e-mail iguais) e as
//     inscrições delas — a pessoa é uma só mesmo quando as fichas são duas;
//   · vínculo acadêmico: base de alunos e, sem ela, as evidências indiretas.

import { prisma } from '../../lib/prisma.js'
import { normalizeCpf } from '../../lib/cpf.js'

const HUMANO_ATIVO_MS = 24 * 3600_000

const quando = (d: Date) => d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

const STATUS_INSCRICAO: Record<string, string> = {
  pending: 'em andamento', submitted: 'enviada', paid: 'paga', enrolled: 'matriculada',
  cancelled: 'cancelada', rejected: 'reprovada', merged: 'mesclada',
}

export async function validacaoDoContato(leadId: number): Promise<string> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true, email: true, phoneKey: true, formData: true, createdAt: true, outcome: true,
      possibleDuplicateOfId: true, duplicateStatus: true,
      team: { select: { name: true } },
    },
  }).catch(() => null)
  if (!lead) return ''
  const linhas: string[] = []
  const agora = Date.now()

  // ── Atendimento ──
  if (lead.team?.name) linhas.push(`Equipe atual: ${lead.team.name}`)
  const nomesDaEquipe = new Set((await prisma.user.findMany({ select: { name: true } }).catch(() => [] as Array<{ name: string }>)).map((u) => u.name))
  const enviadas = await prisma.message.findMany({
    where: { leadId, fromMe: true, isInternal: false, senderName: { not: null } },
    orderBy: { id: 'desc' }, take: 60, select: { senderName: true, timestamp: true },
  }).catch(() => [] as Array<{ senderName: string | null; timestamp: Date }>)
  const humana = enviadas.find((m) => m.senderName && nomesDaEquipe.has(m.senderName))
  if (humana) {
    const ativo = agora - humana.timestamp.getTime() < HUMANO_ATIVO_MS
    linhas.push(`Último atendimento humano: ${humana.senderName}, em ${quando(humana.timestamp)}${ativo ? ' — ATENDIMENTO HUMANO EM ANDAMENTO (menos de 24h)' : ''}`)
  } else {
    linhas.push('Atendimento humano: nenhuma pessoa da equipe falou com este contato ainda')
  }

  // ── Histórico ──
  const primeira = await prisma.message.findFirst({ where: { leadId, isInternal: false, fromMe: false }, orderBy: { id: 'asc' }, select: { timestamp: true } }).catch(() => null)
  const recebidas = await prisma.message.count({ where: { leadId, isInternal: false, fromMe: false } }).catch(() => 0)
  const conversaAntiga = primeira && agora - primeira.timestamp.getTime() > 30 * 60_000
  linhas.push(conversaAntiga
    ? `Contato que JÁ CONVERSOU antes: ${recebidas} mensagens desde ${primeira!.timestamp.toLocaleDateString('pt-BR')} (não é primeiro contato)`
    : `Primeira conversa: começou ${primeira ? `em ${quando(primeira.timestamp)}` : 'agora'}`)
  const setores = await prisma.leadEvent.findMany({
    where: { leadId, type: { in: ['routing_rule_matched', 'operator_assigned'] }, createdAt: { gte: new Date(agora - 60 * 86400_000) } },
    orderBy: { id: 'desc' }, take: 8, select: { title: true, createdAt: true },
  }).catch(() => [] as Array<{ title: string; createdAt: Date }>)
  if (setores.length) linhas.push(`Encaminhamentos recentes (mais novo primeiro):\n${setores.map((e) => `- ${e.createdAt.toLocaleDateString('pt-BR')}: ${e.title}`).join('\n')}`)

  // ── Novidades desde a última mensagem enviada ao contato ──
  // A ficha é a foto de agora; sem isto a IA não sabe que algo MUDOU (redação
  // aprovada, pagamento confirmado) e repete a pendência que disse antes.
  const ultimaNossa = await prisma.message.findFirst({ where: { leadId, fromMe: true, isInternal: false }, orderBy: { id: 'desc' }, select: { timestamp: true } }).catch(() => null)
  if (ultimaNossa) {
    const novidades = await prisma.leadEvent.findMany({
      where: {
        leadId, createdAt: { gt: ultimaNossa.timestamp },
        OR: ['status_changed', 'enrollment', 'payment', 'document', 'essay', 'contract', 'contrato', 'lead_qualified', 'lead_lost', 'sale_detected', 'leads_merged'].map((t) => ({ type: { startsWith: t } })),
      },
      orderBy: { id: 'asc' }, take: 6, select: { title: true, createdAt: true },
    }).catch(() => [] as Array<{ title: string; createdAt: Date }>)
    if (novidades.length) linhas.push(`NOVIDADES desde a última mensagem enviada a este contato (${quando(ultimaNossa.timestamp)}) — dê a novidade e siga dela:\n${novidades.map((e) => `- ${quando(e.createdAt)}: ${e.title}`).join('\n')}`)
  }

  // ── Outras fichas da mesma pessoa ──
  const cpfs = new Set<string>()
  const cpfDaFicha = normalizeCpf(String((lead.formData as any)?.cpf ?? ''))
  if (cpfDaFicha.length === 11) cpfs.add(cpfDaFicha)
  const regsDaFicha = await prisma.enrollmentRegistration.findMany({ where: { leadId }, select: { formData: true } }).catch(() => [] as any[])
  for (const r of regsDaFicha) { const c = normalizeCpf(String((r.formData as any)?.cpf ?? '')); if (c.length === 11) cpfs.add(c) }

  const ou: any[] = []
  if (lead.phoneKey) ou.push({ phoneKey: lead.phoneKey })
  if (lead.email?.includes('@')) ou.push({ email: lead.email })
  if (lead.possibleDuplicateOfId) ou.push({ id: lead.possibleDuplicateOfId })
  ou.push({ possibleDuplicateOfId: leadId })
  const porCpf = cpfs.size ? await prisma.enrollmentRegistration.findMany({
    where: { leadId: { not: leadId }, status: { not: 'merged' } }, orderBy: { id: 'desc' }, take: 3000, select: { leadId: true, formData: true },
  }).catch(() => [] as any[]) : []
  const idsPorCpf = [...new Set(porCpf.filter((r: any) => cpfs.has(normalizeCpf(String(r.formData?.cpf ?? '')))).map((r: any) => r.leadId as number))]
  if (idsPorCpf.length) ou.push({ id: { in: idsPorCpf } })

  const outras = await prisma.lead.findMany({
    where: { id: { not: leadId }, OR: ou },
    take: 5, orderBy: { id: 'desc' },
    select: {
      id: true, nome: true, whatsapp: true, email: true, phoneKey: true, formData: true, createdAt: true,
      team: { select: { name: true } }, assignedUser: { select: { name: true } },
      enrollmentRegistrations: {
        where: { status: { not: 'merged' } }, orderBy: { id: 'desc' }, take: 3,
        select: { candidateCode: true, status: true, paymentStatus: true, processRegistration: { select: { offering: { select: { nome: true } } } } },
      },
    },
  }).catch(() => [] as any[])
  if (outras.length) {
    const desc = outras.map((o: any) => {
      const porque = [
        lead.phoneKey && o.phoneKey === lead.phoneKey ? 'mesmo WhatsApp' : '',
        lead.email && o.email && o.email.toLowerCase() === lead.email.toLowerCase() ? 'mesmo e-mail' : '',
        idsPorCpf.includes(o.id) ? 'mesmo CPF' : '',
        o.id === lead.possibleDuplicateOfId ? 'sinalizada como duplicata' : '',
      ].filter(Boolean).join(', ') || 'sinalizada como duplicata'
      const cpfOutra = normalizeCpf(String(o.formData?.cpf ?? ''))
      const conflito = cpfDaFicha.length === 11 && cpfOutra.length === 11 && cpfOutra !== cpfDaFicha
      const insc = o.enrollmentRegistrations.map((r: any) => `${r.candidateCode} ${r.processRegistration?.offering?.nome ?? ''} (${STATUS_INSCRICAO[r.status] ?? r.status}${r.paymentStatus === 'paid' ? ', pago' : ''})`).join('; ')
      return `- ficha #${o.id} "${o.nome}" (${porque}) — ${o.team?.name ?? 'sem equipe'}${o.assignedUser?.name ? `, com ${o.assignedUser.name}` : ''}, criada em ${o.createdAt.toLocaleDateString('pt-BR')}${insc ? `. Inscrições: ${insc}` : ''}${conflito ? ' ⚠ CPF DIFERENTE: pode ser outra pessoa (ex.: celular da família)' : ''}`
    })
    linhas.push(`OUTRAS FICHAS QUE PARECEM SER DA MESMA PESSOA (considere tudo o que está nelas; não peça de novo o que já existe lá):\n${desc.join('\n')}`)
  }

  // ── Vínculo acadêmico ──
  const idsDaPessoa = [leadId, ...outras.filter((o: any) => !o.formData?.cpf || !cpfDaFicha || normalizeCpf(String(o.formData.cpf)) === cpfDaFicha).map((o: any) => o.id as number)]
  const aluno = await prisma.aluno.findFirst({
    where: { OR: [{ leadId: { in: idsDaPessoa } }, ...(cpfs.size ? [{ cpf: { in: [...cpfs] } }] : [])] },
    select: { ra: true, ativo: true, matriculas: { orderBy: { id: 'desc' }, take: 3, select: { status: true, dataMatricula: true } } },
  }).catch(() => null)
  if (aluno) {
    linhas.push(`ALUNO CONFIRMADO na base de alunos${aluno.ra ? ` (RA ${aluno.ra})` : ''}${aluno.ativo ? '' : ' — cadastro INATIVO'}${aluno.matriculas.length ? `. Matrículas: ${aluno.matriculas.map((m) => `${m.status} desde ${m.dataMatricula.toLocaleDateString('pt-BR')}`).join('; ')}` : ''}`)
  } else {
    const evid: string[] = []
    const regsPessoa = await prisma.enrollmentRegistration.findMany({
      where: { leadId: { in: idsDaPessoa }, status: { not: 'merged' }, OR: [{ status: { in: ['paid', 'enrolled'] } }, { paymentStatus: 'paid' }] },
      select: { candidateCode: true, status: true, processRegistration: { select: { offering: { select: { nome: true } } } } },
    }).catch(() => [] as any[])
    for (const r of regsPessoa) evid.push(`inscrição ${r.candidateCode} ${r.processRegistration?.offering?.nome ?? ''} ${STATUS_INSCRICAO[r.status] ?? r.status}`.trim())
    const negs = await prisma.negotiation.count({ where: { leadId: { in: idsDaPessoa }, status: 'aceita' } }).catch(() => 0)
    if (negs) evid.push(`${negs} negociação(ões) aceita(s)`)
    if (lead.outcome === 'won') evid.push('ficha marcada como ganha (matrícula fechada)')
    const baseTemAlunos = (await prisma.aluno.count().catch(() => 0)) > 0
    linhas.push(evid.length
      ? `Vínculo acadêmico (indireto${baseTemAlunos ? ', não está na base de alunos' : ''}): ${evid.join('; ')}`
      : `Vínculo acadêmico: nenhuma evidência de que seja aluno${baseTemAlunos ? ' (não está na base de alunos)' : ' (a base de alunos ainda não foi carregada — "sou aluno" não pode ser confirmado nem negado pelo sistema)'}`)
  }

  return linhas.join('\n')
}

/**
 * Fichas que são, com prova forte, da MESMA pessoa: mesmo WhatsApp (phoneKey)
 * ou mesmo CPF — nunca uma com CPF diferente (celular da família). Usada para a
 * IA continuar uma inscrição feita em outra ficha em vez de recomeçar.
 */
export async function fichasDaMesmaPessoa(leadId: number): Promise<number[]> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { phoneKey: true, formData: true } }).catch(() => null)
  if (!lead) return [leadId]
  const cpfDe = (fd: unknown) => normalizeCpf(String((fd as any)?.cpf ?? ''))
  const regs = await prisma.enrollmentRegistration.findMany({ where: { status: { not: 'merged' } }, orderBy: { id: 'desc' }, take: 3000, select: { leadId: true, formData: true } }).catch(() => [] as any[])
  const cpfsDoLead = (id: number, fd: unknown) => new Set([cpfDe(fd), ...regs.filter((r: any) => r.leadId === id).map((r: any) => cpfDe(r.formData))].filter((c) => c.length === 11))
  const meus = cpfsDoLead(leadId, lead.formData)
  const porCpf = regs.filter((r: any) => r.leadId && r.leadId !== leadId && meus.has(cpfDe(r.formData))).map((r: any) => r.leadId as number)
  const candidatas = await prisma.lead.findMany({
    where: { id: { not: leadId }, OR: [...(lead.phoneKey ? [{ phoneKey: lead.phoneKey }] : []), { id: { in: porCpf } }] },
    take: 5, select: { id: true, formData: true },
  }).catch(() => [] as Array<{ id: number; formData: unknown }>)
  const ids = candidatas.filter((c) => {
    const deles = cpfsDoLead(c.id, c.formData)
    return !meus.size || !deles.size || [...deles].some((x) => meus.has(x))
  }).map((c) => c.id)
  return [leadId, ...ids]
}

/**
 * Pessoa da equipe que falou com o contato nas últimas 24h (a conversa é dela).
 * Mensagem humana = remetente com o nome de um usuário do sistema; bots e
 * automações gravam o próprio nome.
 */
export async function atendimentoHumanoAtivo(leadId: number): Promise<{ nome: string } | null> {
  const desde = new Date(Date.now() - HUMANO_ATIVO_MS)
  const msgs = await prisma.message.findMany({
    where: { leadId, fromMe: true, isInternal: false, senderName: { not: null }, timestamp: { gte: desde } },
    orderBy: { id: 'desc' }, take: 40, select: { senderName: true },
  }).catch(() => [] as Array<{ senderName: string | null }>)
  if (!msgs.length) return null
  const nomes = new Set((await prisma.user.findMany({ where: { name: { in: [...new Set(msgs.map((m) => m.senderName!))] } }, select: { name: true } }).catch(() => [] as Array<{ name: string }>)).map((u) => u.name))
  const m = msgs.find((x) => x.senderName && nomes.has(x.senderName))
  return m ? { nome: m.senderName! } : null
}

/**
 * Resumo para quem assume a conversa: o que o sistema confirmou sobre a
 * pessoa, para o time não refazer as perguntas. Vai numa mensagem INTERNA.
 */
export async function resumoParaEquipe(leadId: number): Promise<string[]> {
  const fichas = await fichasDaMesmaPessoa(leadId).catch(() => [leadId])
  const linhas: string[] = []
  const aluno = await prisma.aluno.findFirst({ where: { leadId: { in: fichas } }, select: { ra: true, ativo: true } }).catch(() => null)
  const regs = await prisma.enrollmentRegistration.findMany({
    where: { leadId: { in: fichas }, status: { not: 'merged' } }, orderBy: { id: 'desc' }, take: 4,
    select: { candidateCode: true, status: true, paymentStatus: true, leadId: true, processRegistration: { select: { offering: { select: { nome: true } } } } },
  }).catch(() => [] as any[])
  const pagas = regs.filter((r: any) => r.paymentStatus === 'paid' || ['paid', 'enrolled'].includes(r.status))
  linhas.push(aluno
    ? `Aluno confirmado na base${aluno.ra ? ` (RA ${aluno.ra})` : ''}${aluno.ativo ? '' : ', cadastro inativo'}`
    : pagas.length ? 'Vínculo: tem inscrição paga/matriculada (indício de aluno)' : 'Vínculo de aluno: não confirmado pelo sistema (a base de alunos ainda não está completa)')
  for (const r of regs) linhas.push(`Inscrição ${r.candidateCode} — ${r.processRegistration?.offering?.nome ?? 'sem curso'} (${STATUS_INSCRICAO[r.status] ?? r.status}${r.paymentStatus === 'paid' ? ', pago' : ''})${r.leadId !== leadId ? ` · na ficha #${r.leadId}` : ''}`)
  const outras = fichas.filter((id) => id !== leadId)
  if (outras.length) linhas.push(`⚠ Mesma pessoa em outra(s) ficha(s): ${outras.map((id) => `#${id}`).join(', ')} — avalie mesclar`)
  return linhas
}
