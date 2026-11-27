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

// ── O que a pessoa já informou (varredura de todas as fichas dela) ──────────
// A IA não pode pedir de novo o que a pessoa já deu — nesta ficha, numa ficha
// de outro número da empresa ou numa inscrição que começou no portal. Junta os
// dados pessoais, os campos personalizados, as anotações e o fim da última
// conversa das OUTRAS fichas da mesma pessoa (mesmo WhatsApp ou CPF; CPF
// diferente fica de fora — celular da família). 27/11/2026, ineprotec.
const ROTULO_DADO: Array<[string, string]> = [
  ['nome', 'Nome completo'], ['nomeSocial', 'Nome social'], ['cpf', 'CPF'], ['email', 'E-mail'],
  ['nascimento', 'Data de nascimento'], ['rg', 'RG'], ['rgOrgaoEmissor', 'Órgão emissor do RG'],
  ['naturalidade', 'Naturalidade'], ['racaCor', 'Raça/cor'], ['nomeMae', 'Nome da mãe'], ['nomePai', 'Nome do pai'],
  ['cep', 'CEP'], ['logradouro', 'Endereço'], ['numero', 'Número'], ['complemento', 'Complemento'], ['bairro', 'Bairro'],
  ['municipio', 'Cidade'], ['cidade', 'Cidade'], ['uf', 'UF'], ['tipoSanguineo', 'Tipo sanguíneo'],
  ['responsavelNome', 'Responsável (nome)'], ['responsavelParentesco', 'Responsável (parentesco)'],
  ['responsavelCpf', 'Responsável (CPF)'], ['responsavelTelefone', 'Responsável (telefone)'], ['responsavelEmail', 'Responsável (e-mail)'],
]
const curto = (v: unknown, n = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

export async function conhecidoDaPessoa(leadId: number): Promise<string> {
  const fichas = await fichasDaMesmaPessoa(leadId).catch(() => [leadId])
  const outras = fichas.filter((id) => id !== leadId)
  const [leads, regs] = await Promise.all([
    prisma.lead.findMany({ where: { id: { in: fichas } }, select: { id: true, nome: true, email: true, cidade: true, formData: true, customFields: true } }).catch(() => [] as any[]),
    prisma.enrollmentRegistration.findMany({ where: { leadId: { in: fichas }, status: { not: 'merged' } }, orderBy: { id: 'desc' }, take: 8, select: { formData: true, candidateCode: true } }).catch(() => [] as any[]),
  ])
  const linhas: string[] = []

  // Dados pessoais: inscrição mais nova primeiro (é o dado que a pessoa digitou
  // no portal), depois as fichas (esta antes das outras).
  const fontes: Array<{ fd: any; de: string }> = [
    ...regs.map((r: any) => ({ fd: r.formData || {}, de: `inscrição ${r.candidateCode}` })),
    ...[...leads].sort((a: any, b: any) => (a.id === leadId ? -1 : b.id === leadId ? 1 : b.id - a.id))
      .map((l: any) => ({ fd: { ...(l.formData || {}), ...(l.email ? { email: l.email } : {}), ...(l.cidade ? { cidade: l.cidade } : {}) }, de: l.id === leadId ? 'esta ficha' : `ficha #${l.id}` })),
  ]
  const vistos = new Set<string>()
  const dados: string[] = []
  for (const [chave, rotulo] of ROTULO_DADO) {
    if (vistos.has(rotulo)) continue
    for (const f of fontes) {
      const v = curto(f.fd?.[chave])
      if (!v || /^(lead( lp)?|webchat|null|undefined)$/i.test(v)) continue
      if (chave === 'nome' && v.split(' ').length < 2) continue // primeiro nome do perfil não é nome completo
      dados.push(`- ${rotulo}: ${v} (${f.de})`)
      vistos.add(rotulo)
      break
    }
  }
  if (dados.length) linhas.push(`DADOS QUE A PESSOA JÁ INFORMOU (nunca pergunte de novo; na inscrição use estes valores — no máximo confirme numa frase se estiverem incompletos):\n${dados.join('\n')}`)

  if (!outras.length) return linhas.join('\n')

  // Campos personalizados das outras fichas que esta ainda não tem.
  const desta = leads.find((l: any) => l.id === leadId)
  const jaTem = new Set(Object.entries((desta?.customFields || {}) as Record<string, unknown>).filter(([, v]) => v != null && String(v).trim() !== '').map(([k]) => k))
  const extras = new Map<string, string>()
  for (const l of leads.filter((x: any) => x.id !== leadId).sort((a: any, b: any) => b.id - a.id)) {
    for (const [k, v] of Object.entries((l.customFields || {}) as Record<string, unknown>)) {
      if (jaTem.has(k) || extras.has(k) || v == null || String(v).trim() === '' || String(v) === '[]') continue
      if (/^(utm_|gclid|fbclid|ga_client_id|referrer|url_origem)/.test(k)) continue
      extras.set(k, `${curto(Array.isArray(v) ? v.join(', ') : v, 300)} (ficha #${l.id})`)
    }
  }
  if (extras.size) {
    const defs = await prisma.customField.findMany({ where: { key: { in: [...extras.keys()] } }, select: { key: true, label: true } }).catch(() => [] as Array<{ key: string; label: string }>)
    const rot = new Map(defs.map((d) => [d.key, d.label]))
    // Dado pessoal já está na lista de cima; o resto do CRM antigo é bastidor.
    const bastidor = /crm anterior|registro de atendimento|^empresa$|origem|campus|^cpf$|e-?mail|^nome/i
    const itens = [...extras].filter(([k]) => !bastidor.test(rot.get(k) || k)).slice(0, 15)
    if (itens.length) linhas.push(`Campos já preenchidos em OUTRAS fichas da mesma pessoa:\n${itens.map(([k, v]) => `- ${curto(rot.get(k) || k, 140)}: ${v}`).join('\n')}`)
  }

  // Aviso automático de duplicidade não é conversa da equipe.
  const notas = await prisma.leadNote.findMany({ where: { leadId: { in: outras }, NOT: [{ content: { startsWith: 'Nova inscrição duplicada' } }, { content: { startsWith: 'Possível duplicado' } }] }, orderBy: { createdAt: 'desc' }, take: 5, select: { leadId: true, content: true, userName: true, createdAt: true } }).catch(() => [] as any[])
  if (notas.length) linhas.push(`Anotações da equipe em OUTRAS fichas da mesma pessoa:\n${notas.map((n: any) => `- ${n.createdAt.toLocaleDateString('pt-BR')}${n.userName ? ` (${n.userName})` : ''}, ficha #${n.leadId}: ${curto(n.content, 300)}`).join('\n')}`)

  // Fim da última conversa em outra ficha (90 dias): o assunto que ficou pendente.
  const ultima = await prisma.message.findFirst({
    where: { leadId: { in: outras }, isInternal: false, timestamp: { gte: new Date(Date.now() - 90 * 86400_000) } },
    orderBy: { id: 'desc' }, select: { leadId: true },
  }).catch(() => null)
  if (ultima) {
    const msgs = await prisma.message.findMany({
      where: { leadId: ultima.leadId, isInternal: false }, orderBy: { id: 'desc' }, take: 10,
      select: { fromMe: true, body: true, senderName: true, timestamp: true },
    }).catch(() => [] as any[])
    const txt = msgs.reverse().filter((m: any) => m.body && !/^\[(image|audio|video|document|sticker)\]$/i.test(m.body))
      .map((m: any) => `- ${quando(m.timestamp)} ${m.fromMe ? (m.senderName || 'empresa') : 'pessoa'}: ${curto(m.body, 220)}`)
    if (txt.length) linhas.push(`Fim da última conversa em outra ficha (#${ultima.leadId}) — contexto, não repita o que já foi respondido:\n${txt.join('\n')}`)
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
  let desde = new Date(Date.now() - HUMANO_ATIVO_MS)
  // Conversa devolvida ao bot ("devolver ao bot" ou retomada automática): o que
  // a equipe falou ANTES disso não é atendimento em curso. Sem isto, a escolha
  // do menu logo depois da devolução caía em "fulano está atendendo" e a IA
  // repetia a triagem (ineprotec, 27/11/2026).
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { formData: true } }).catch(() => null)
  const devolvido = new Date(String((lead?.formData as any)?._botResumedAt ?? ''))
  if (!isNaN(devolvido.getTime()) && devolvido > desde) desde = devolvido
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
