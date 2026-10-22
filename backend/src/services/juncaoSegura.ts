// src/services/juncaoSegura.ts
//
// Junção de fichas que não perde nada e tem volta.
//
// O que a mesclagem perdia (análise de 22/10/2026):
//   1. Tabelas que guardam o leadId SEM chave no banco (propostas, envios de
//      formulário, origem, consentimento LGPD, chamadas, comissões…) não eram
//      movidas: ficavam apontando para a ficha apagada. ineprotec: 10 propostas,
//      2 aceitas, sumiram das fichas que ficaram.
//   2. Valor em conflito (e-mail, cidade, campo personalizado, dado de
//      formulário): o da ficha que fica ganhava e o outro sumia. Da segunda
//      junção em diante nem os dados do formulário da absorvida eram guardados.
//   3. Não havia volta: a absorvida era apagada sem cópia.
//
// Aqui: `fotoAntesDeJuntar` registra tudo que é da ficha absorvida (ids por
// tabela + linhas que a junção apagaria), `moverTabelasSemChave` leva o resto,
// `conflitosDaJuncao` guarda os valores que perderiam, e a foto vai para a
// Lixeira como 'lead_merge' — restaurar = `desfazerJuncao`.

import { prisma } from '../lib/prisma.js'

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]

/** Toda tabela que aponta para o lead (gerado do schema em 22/10/2026). */
const TABELAS_DO_LEAD: Array<[tabela: string, coluna: string]> = [
  ['bychat_lead_transfer_requests', 'leadId'], ['bychat_consent_logs', 'leadId'], ['bychat_data_subject_requests', 'leadId'],
  ['bychat_lead_stage_movements', 'leadId'], ['bychat_lead_funnels', 'leadId'], ['bychat_lead_status_history', 'leadId'],
  ['bychat_lead_enrichment', 'leadId'], ['bychat_messages', 'leadId'], ['bychat_conversation_pins', 'leadId'],
  ['bychat_lead_notes', 'leadId'], ['bychat_lead_events', 'leadId'], ['bychat_activities', 'leadId'],
  ['bychat_lead_attachments', 'leadId'], ['bychat_cloud_api_message_logs', 'leadId'], ['bychat_broadcast_recipients', 'leadId'],
  ['bychat_meta_lead_logs', 'leadId'], ['bychat_tracking_visitors', 'leadId'], ['bychat_form_submissions', 'leadId'],
  ['bychat_lead_tags', 'leadId'], ['bychat_outbound_sends', 'leadId'], ['bychat_pixel_visitors', 'leadId'],
  ['bychat_lead_origins', 'leadId'], ['bychat_detected_sales', 'leadId'], ['bychat_conversion_events', 'leadId'],
  ['bychat_lead_touchpoints', 'leadId'], ['bychat_workflow_executions', 'leadId'], ['bychat_inbound_webhook_hits', 'leadId'],
  ['bychat_edu_process_registrations', 'leadId'], ['bychat_voip_calls', 'leadId'], ['bychat_meeting_recordings', 'leadId'],
  ['bychat_negotiations', 'leadId'], ['bychat_enrollment_registrations', 'leadId'], ['bychat_cadence_enrollments', 'leadId'],
  ['bychat_cadence_step_executions', 'leadId'], ['bychat_conversation_audits', 'leadId'], ['bychat_lead_stage_suggestions', 'leadId'],
  ['bychat_bookings', 'leadId'], ['bychat_helpdesk_tickets', 'requesterLeadId'], ['bychat_reputation_companies', 'leadId'],
  ['bychat_web_stack_scans', 'leadId'], ['bychat_education_institutions', 'leadId'], ['bychat_smart_campaign_recipients', 'leadId'],
  ['bychat_commission_entries', 'leadId'], ['bychat_scheduled_messages', 'leadId'], ['bychat_chat_import_jobs', 'leadId'],
  ['bychat_survey_responses', 'leadId'], ['bychat_survey_sessions', 'leadId'], ['bychat_aca_coordenadores', 'leadId'],
  ['bychat_aca_responsaveis', 'leadId'], ['bychat_aca_alunos', 'leadId'], ['bychat_portal_accounts', 'leadId'],
  ['bychat_equipe_conversas', 'leadId'], ['bychat_consumo', 'leadId'],
]

/**
 * As que guardam o leadId sem chave no banco — a mesclagem antiga não as
 * movia. As de chave continuam com `transferirRelacoesDoLead` (dedup.ts).
 * Um por lead (origem, conversa da equipe): só vai se a que fica não tiver.
 */
const SEM_CHAVE: Array<[tabela: string, coluna: string, umPorLead?: boolean]> = [
  ['bychat_consent_logs', 'leadId'], ['bychat_data_subject_requests', 'leadId'], ['bychat_cloud_api_message_logs', 'leadId'],
  ['bychat_broadcast_recipients', 'leadId'], ['bychat_meta_lead_logs', 'leadId'], ['bychat_tracking_visitors', 'leadId'],
  ['bychat_form_submissions', 'leadId'], ['bychat_pixel_visitors', 'leadId'], ['bychat_lead_origins', 'leadId', true],
  ['bychat_conversion_events', 'leadId'], ['bychat_lead_touchpoints', 'leadId'], ['bychat_workflow_executions', 'leadId'],
  ['bychat_inbound_webhook_hits', 'leadId'], ['bychat_voip_calls', 'leadId'], ['bychat_meeting_recordings', 'leadId'],
  ['bychat_negotiations', 'leadId'], ['bychat_cadence_step_executions', 'leadId'], ['bychat_helpdesk_tickets', 'requesterLeadId'],
  ['bychat_reputation_companies', 'leadId'], ['bychat_web_stack_scans', 'leadId'], ['bychat_education_institutions', 'leadId'],
  ['bychat_smart_campaign_recipients', 'leadId'], ['bychat_commission_entries', 'leadId'], ['bychat_survey_responses', 'leadId'],
  ['bychat_survey_sessions', 'leadId'], ['bychat_aca_coordenadores', 'leadId'], ['bychat_aca_responsaveis', 'leadId'],
  ['bychat_equipe_conversas', 'leadId', true], ['bychat_consumo', 'leadId'],
]

/**
 * Linhas da absorvida que a junção APAGA (cascata) quando a que fica já tem
 * a mesma coisa — guardadas inteiras na foto para o desfazer recriar.
 */
const APAGADAS_NA_JUNCAO: Array<[modelo: string, tabela: string]> = [
  ['leadTag', 'bychat_lead_tags'], ['leadFunnel', 'bychat_lead_funnels'], ['cadenceEnrollment', 'bychat_cadence_enrollments'],
  ['conversationPin', 'bychat_conversation_pins'], ['processRegistration', 'bychat_edu_process_registrations'],
  ['portalAccount', 'bychat_portal_accounts'], ['leadOrigin', 'bychat_lead_origins'], ['equipeConversa', 'bychat_equipe_conversas'],
]

const tabelaExiste = new Map<string, boolean>()
async function existe(tabela: string): Promise<boolean> {
  if (!tabelaExiste.has(tabela)) {
    const r = await prisma.$queryRawUnsafe<any[]>('SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?', tabela).catch(() => [{ n: 0 }])
    tabelaExiste.set(tabela, Number(r[0]?.n) > 0)
  }
  return tabelaExiste.get(tabela)!
}

export interface FotoDaJuncao {
  tipo: 'mesclagem'
  keepId: number
  mergeId: number
  em: string
  lead: any
  /** ids da absorvida por tabela, antes de mover. */
  ids: Record<string, number[]>
  /** linhas que a junção pode apagar (ver APAGADAS_NA_JUNCAO). */
  linhas: Record<string, any[]>
  /** valores da que fica antes e depois da junção (só os campos que mudaram). */
  keepAntes: Record<string, unknown>
  keepDepois: Record<string, unknown>
}

/** Tudo que é da ficha absorvida, antes de qualquer coisa mudar de lugar. */
export async function fotoAntesDeJuntar(keepId: number, mergeId: number): Promise<FotoDaJuncao> {
  const lead = await prisma.lead.findUnique({ where: { id: mergeId } })
  const ids: Record<string, number[]> = {}
  for (const [tabela, coluna] of TABELAS_DO_LEAD) {
    if (!(await existe(tabela))) continue
    const rows = await prisma.$queryRawUnsafe<Array<{ id: number }>>(`SELECT id FROM \`${tabela}\` WHERE \`${coluna}\` = ?`, mergeId).catch(() => [])
    if (rows.length) ids[tabela] = rows.map((r) => Number(r.id))
  }
  const linhas: Record<string, any[]> = {}
  for (const [modelo, tabela] of APAGADAS_NA_JUNCAO) {
    if (!ids[tabela]?.length) continue
    linhas[modelo] = await (prisma as any)[modelo].findMany({ where: { leadId: mergeId } }).catch(() => [])
  }
  return { tipo: 'mesclagem', keepId, mergeId, em: new Date().toISOString(), lead, ids, linhas, keepAntes: {}, keepDepois: {} }
}

/** Leva para a ficha que fica o que mora em tabela sem chave para o lead. */
export async function moverTabelasSemChave(tx: Tx, mergeId: number, keepId: number): Promise<void> {
  for (const [tabela, coluna, umPorLead] of SEM_CHAVE) {
    if (!(await existe(tabela))) continue
    if (umPorLead) {
      const ja = await tx.$queryRawUnsafe<any[]>(`SELECT id FROM \`${tabela}\` WHERE \`${coluna}\` = ? LIMIT 1`, keepId)
      if (ja.length) continue
    }
    await tx.$executeRawUnsafe(`UPDATE \`${tabela}\` SET \`${coluna}\` = ? WHERE \`${coluna}\` = ?`, keepId, mergeId)
  }
}

const vazio = (v: unknown) => v == null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length)
const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const texto = (v: unknown) => (typeof v === 'string' ? v.trim() : JSON.stringify(v))

export interface ValorAnterior { campo: string; valor: unknown; de: number; em: string; desfazPor: number }

/**
 * Valores da absorvida que divergem da que fica (e que a junção não leva):
 * vão para `formData._valoresAnteriores` da que fica, em vez de sumir.
 * `nomeTrocado`: a junção pôs o nome da absorvida — o antigo da que fica é que
 * vira valor anterior.
 */
export function conflitosDaJuncao(keep: any, merge: any, nomeTrocado: boolean): ValorAnterior[] {
  const em = new Date().toISOString()
  const out: ValorAnterior[] = []
  const add = (campo: string, a: unknown, b: unknown) => {
    if (vazio(a) || vazio(b) || igual(a, b)) return
    if (typeof a === 'string' && typeof b === 'string' && a.trim().toLowerCase() === b.trim().toLowerCase()) return
    out.push({ campo, valor: b, de: merge.id, em, desfazPor: merge.id })
  }
  if (nomeTrocado) { if (!vazio(keep.nome) && keep.nome !== merge.nome) out.push({ campo: 'nome', valor: keep.nome, de: keep.id, em, desfazPor: merge.id }) }
  else add('nome', keep.nome, merge.nome)
  for (const c of ['email', 'empresa', 'cidade', 'segmento', 'whatsapp', 'solucaoNome', 'maturidade']) add(c, keep[c], merge[c])
  const cfK = (keep.customFields as any) || {}, cfM = (merge.customFields as any) || {}
  for (const k of Object.keys(cfM)) add(`campo:${k}`, cfK[k], cfM[k])
  const fdK = (keep.formData as any) || {}, fdM = (merge.formData as any) || {}
  for (const k of Object.keys(fdM)) if (!k.startsWith('_')) add(`formulario:${k}`, fdK[k], fdM[k])
  return out
}

/** Onde a absorvida estava — para a nota da junção (funil, etapa, equipe, dono). */
export async function destinoDaFicha(lead: any): Promise<string> {
  const [funil, equipe, dono] = await Promise.all([
    lead.funnelId ? prisma.funnel.findUnique({ where: { id: lead.funnelId }, select: { name: true } }) : null,
    lead.teamId ? prisma.team.findUnique({ where: { id: lead.teamId }, select: { name: true } }) : null,
    lead.assignedUserId ? prisma.user.findUnique({ where: { id: lead.assignedUserId }, select: { name: true } }) : null,
  ])
  return [funil ? `funil ${funil.name}${lead.status ? ` (${lead.status})` : ''}` : 'sem funil', equipe ? `equipe ${equipe.name}` : '', dono ? `com ${dono.name}` : 'sem responsável'].filter(Boolean).join(', ')
}

export function resumoDosConflitos(c: ValorAnterior[]): string {
  if (!c.length) return ''
  return 'Valores diferentes guardados como "valor anterior": ' + c.slice(0, 12).map((x) => `${x.campo.replace(/^campo:|^formulario:/, '')} = ${texto(x.valor).slice(0, 60)}`).join('; ') + (c.length > 12 ? ` e mais ${c.length - 12}` : '')
}

/**
 * Desfaz uma junção a partir da foto: a ficha absorvida volta com o mesmo id,
 * o que era dela volta para ela e os campos que a junção mudou na que ficou
 * voltam ao que eram (só se ninguém mexeu neles depois). O que não der para
 * voltar exatamente sai na lista `pendencias`.
 */
export async function desfazerJuncao(foto: FotoDaJuncao, quem?: { userId?: number; nome?: string }): Promise<{ lead: any; pendencias: string[] }> {
  if (foto?.tipo !== 'mesclagem') throw new Error('Este item não é uma junção de fichas')
  const { keepId, mergeId } = foto
  const keep = await prisma.lead.findUnique({ where: { id: keepId } })
  if (!keep) throw new Error(`A ficha #${keepId}, que recebeu a junção, não existe mais`)
  if (await prisma.lead.findUnique({ where: { id: mergeId }, select: { id: true } })) throw new Error(`A ficha #${mergeId} já existe — a junção parece já ter sido desfeita`)
  const pendencias: string[] = []

  const dados: any = { ...foto.lead }
  // null em campo JSON precisa de Prisma.JsonNull; sem a chave o padrão já é nulo.
  for (const k of Object.keys(dados)) if (dados[k] === null) delete dados[k]
  // Campos de identidade únicos que a junção levou para a que ficou ficam lá.
  for (const c of ['uid', 'waLid', 'optOutToken']) {
    if (dados[c] && (await prisma.lead.findFirst({ where: { [c]: dados[c] } as any, select: { id: true } }).catch(() => null))) {
      if (c === 'uid') dados.uid = null
      else { pendencias.push(`${c} continua na ficha #${keepId}`); dados[c] = null }
    }
  }
  const lead = await prisma.lead.create({ data: dados })

  for (const [tabela, ids] of Object.entries(foto.ids || {})) {
    const coluna = TABELAS_DO_LEAD.find(([t]) => t === tabela)?.[1]
    if (!coluna || !(await existe(tabela))) continue
    for (let i = 0; i < ids.length; i += 1000) {
      const lote = ids.slice(i, i + 1000)
      await prisma.$executeRawUnsafe(`UPDATE \`${tabela}\` SET \`${coluna}\` = ? WHERE \`${coluna}\` = ? AND id IN (${lote.map(() => '?').join(',')})`, mergeId, keepId, ...lote)
        .catch((e) => pendencias.push(`${tabela}: ${e?.message || e}`))
    }
  }
  // Linhas que a junção apagou: recriadas com o mesmo id.
  for (const [modelo, rows] of Object.entries(foto.linhas || {})) {
    for (const row of rows) {
      const ja = await (prisma as any)[modelo].findUnique({ where: { id: row.id }, select: { id: true } }).catch(() => null)
      if (ja) continue
      await (prisma as any)[modelo].create({ data: { ...row, leadId: mergeId } })
        .catch(() => pendencias.push(`${modelo} #${row.id} não pôde ser recriado (a inscrição/registro da mesma oferta ficou unificada na ficha #${keepId})`))
    }
  }

  // Campos da que ficou: só volta o que continua como a junção deixou.
  const volta: any = {}
  for (const [campo, depois] of Object.entries(foto.keepDepois || {})) {
    if (campo === 'formData') continue
    if (igual((keep as any)[campo], depois)) volta[campo] = (foto.keepAntes as any)[campo] ?? null
  }
  const fd: any = { ...((keep.formData as any) || {}) }
  if (Array.isArray(fd._mescladas)) fd._mescladas = fd._mescladas.filter((m: any) => m?.leadId !== mergeId)
  if (Array.isArray(fd._valoresAnteriores)) fd._valoresAnteriores = fd._valoresAnteriores.filter((v: any) => v?.desfazPor !== mergeId)
  if (fd._mergedFrom?.leadId === mergeId) delete fd._mergedFrom
  volta.formData = fd
  await prisma.lead.update({ where: { id: keepId }, data: volta })

  const quemNome = quem?.nome || 'Sistema'
  const titulo = `Junção desfeita: #${mergeId} voltou a ser uma ficha separada de #${keepId}`
  const { logEvent } = await import('./leadHistory.js')
  for (const id of [keepId, mergeId]) {
    logEvent({ leadId: id, type: 'leads_unmerged', category: 'lifecycle', title: titulo, actorType: quem?.userId ? 'operator' : 'system', userId: quem?.userId, userName: quemNome, metadata: { keepId, mergeId, pendencias } } as any)
    await prisma.leadNote.create({ data: { leadId: id, userId: quem?.userId ?? null, userName: quemNome, content: titulo + (pendencias.length ? `. Atenção: ${pendencias.join('; ')}` : '.') } }).catch(() => {})
  }
  return { lead, pendencias }
}

// ── Mesma pessoa, assuntos diferentes ───────────────────────────────────────
// Status 'linked': a ficha aponta (possibleDuplicateOfId) para a outra da mesma
// pessoa, mas as duas seguem separadas, cada uma no seu funil e com o seu
// responsável. Diferente de 'kept_separate' (o time decidiu que são pessoas
// diferentes).

/** Liga `maisNova` a `principal` como mesma pessoa, sem juntar. */
export async function ligarFichas(principal: number, maisNova: number, quem: { userId?: number; nome?: string; motivo?: string }): Promise<void> {
  if (principal === maisNova) throw new Error('Não dá para ligar a ficha com ela mesma')
  const [a, b] = await Promise.all([prisma.lead.findUnique({ where: { id: principal } }), prisma.lead.findUnique({ where: { id: maisNova } })])
  if (!a || !b) throw new Error('Ficha não encontrada')
  await prisma.lead.update({ where: { id: maisNova }, data: { duplicateStatus: 'linked', possibleDuplicateOfId: principal, duplicateResolvedAt: new Date() } })
  const [da, db] = await Promise.all([destinoDaFicha(a), destinoDaFicha(b)])
  const nome = quem.nome || 'Sistema'
  const { logEvent } = await import('./leadHistory.js')
  for (const [id, outra, destino] of [[principal, maisNova, db], [maisNova, principal, da]] as const) {
    await prisma.leadNote.create({ data: { leadId: id, userId: quem.userId ?? null, userName: nome, content: `Mesma pessoa da ficha #${outra} (${destino}). As fichas ficam separadas${quem.motivo ? ` — ${quem.motivo}` : ''}.` } }).catch(() => {})
    logEvent({ leadId: id, type: 'leads_linked', category: 'lifecycle', title: `Ligada à ficha #${outra} como mesma pessoa`, actorType: quem.userId ? 'operator' : 'system', userId: quem.userId, userName: nome, metadata: { outra, motivo: quem.motivo ?? null } } as any)
  }
}

/** Fichas ligadas a esta como mesma pessoa (nos dois sentidos). */
export async function fichasLigadas(leadId: number): Promise<any[]> {
  const eu = await prisma.lead.findUnique({ where: { id: leadId }, select: { duplicateStatus: true, possibleDuplicateOfId: true } })
  const ids = new Set<number>()
  if (eu?.duplicateStatus === 'linked' && eu.possibleDuplicateOfId) ids.add(eu.possibleDuplicateOfId)
  for (const l of await prisma.lead.findMany({ where: { possibleDuplicateOfId: leadId, duplicateStatus: 'linked' }, select: { id: true } })) ids.add(l.id)
  // Irmãs: ligadas à mesma principal.
  if (eu?.duplicateStatus === 'linked' && eu.possibleDuplicateOfId) {
    for (const l of await prisma.lead.findMany({ where: { possibleDuplicateOfId: eu.possibleDuplicateOfId, duplicateStatus: 'linked', id: { not: leadId } }, select: { id: true } })) ids.add(l.id)
  }
  ids.delete(leadId)
  const leads = await prisma.lead.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, nome: true, status: true, funnel: { select: { name: true } }, team: { select: { name: true } }, assignedUser: { select: { name: true } }, lastMessageAt: true },
  })
  return leads.map((l) => ({ id: l.id, nome: l.nome, etapa: l.status, funil: l.funnel?.name ?? null, equipe: l.team?.name ?? null, responsavel: l.assignedUser?.name ?? null, ultimaMensagem: l.lastMessageAt }))
}

// ── Comparação para a tela de revisão ───────────────────────────────────────

export async function resumoDaFicha(id: number): Promise<any> {
  const l = await prisma.lead.findUnique({
    where: { id },
    include: { funnel: { select: { name: true } }, team: { select: { name: true } }, assignedUser: { select: { name: true } } },
  })
  if (!l) return null
  const [mensagens, propostas, inscricoes, aluno, humano, ultimas] = await Promise.all([
    prisma.message.count({ where: { leadId: id, isInternal: false } }),
    prisma.negotiation.count({ where: { leadId: id } }).catch(() => 0),
    prisma.enrollmentRegistration.findMany({ where: { leadId: id, status: { not: 'merged' } }, select: { candidateCode: true, status: true, paymentStatus: true } }).catch(() => []),
    prisma.aluno.findUnique({ where: { leadId: id }, select: { id: true } }).catch(() => null),
    import('./journey/validacaoContato.js').then((m) => m.atendimentoHumanoAtivo(id)).catch(() => null),
    prisma.message.findMany({ where: { leadId: id, isInternal: false, body: { not: '' } }, orderBy: { id: 'desc' }, take: 6, select: { fromMe: true, body: true, senderName: true, timestamp: true } }),
  ])
  const fd: any = l.formData || {}
  return {
    id: l.id, uid: l.uid, nome: l.nome, whatsapp: l.whatsapp, email: l.email, cidade: l.cidade, empresa: l.empresa, segmento: l.segmento,
    cpf: fd.cpf ?? null, origem: l.source, criadaEm: l.createdAt,
    funil: l.funnel?.name ?? null, etapa: l.status, equipe: l.team?.name ?? null, responsavel: l.assignedUser?.name ?? null,
    customFields: l.customFields ?? {}, mensagens, propostas, inscricoes, aluno: !!aluno, atendimentoHumano: humano?.nome ?? null,
    ultimasMensagens: ultimas.reverse().map((m) => ({ de: m.fromMe ? (m.senderName || 'Empresa') : 'Contato', texto: (m.body || '').slice(0, 300), em: m.timestamp })),
  }
}

/** O que o sistema recomenda para o par: juntar, ligar como mesma pessoa ou revisar. */
export async function sugestaoDeJuncao(aId: number, bId: number, matchType = 'whatsapp'): Promise<{ acao: 'juntar' | 'ligar' | 'revisar'; motivo: string }> {
  const { impedimentoParaJuntar, ehOutroAssunto } = await import('./regrasDuplicidade.js')
  const motivo = await impedimentoParaJuntar(aId, bId, matchType)
  if (!motivo) return { acao: 'juntar', motivo: 'Mesma pessoa e mesmo assunto, sem conflito de CPF, nome ou atendimento.' }
  if (ehOutroAssunto(motivo)) return { acao: 'ligar', motivo: `Mesma pessoa, ${motivo}: cada ficha segue no seu funil.` }
  return { acao: 'revisar', motivo }
}

export async function compararFichas(aId: number, bId: number): Promise<any> {
  const [a, b] = await Promise.all([resumoDaFicha(aId), resumoDaFicha(bId)])
  if (!a || !b) throw new Error('Ficha não encontrada')
  const [la, lb] = await Promise.all([prisma.lead.findUnique({ where: { id: aId } }), prisma.lead.findUnique({ where: { id: bId } })])
  const conflitos = conflitosDaJuncao(la, lb, false).filter((c) => !c.campo.startsWith('formulario:'))
    .map((c) => ({ campo: c.campo, a: c.campo.startsWith('campo:') ? (la!.customFields as any)?.[c.campo.slice(6)] : (la as any)[c.campo], b: c.valor }))
  const parecer = await prisma.leadEvent.findFirst({ where: { leadId: { in: [aId, bId] }, type: 'duplicate_ai_opinion', metadata: { path: '$.par', equals: [Math.min(aId, bId), Math.max(aId, bId)] } as any }, orderBy: { id: 'desc' }, select: { metadata: true, createdAt: true } }).catch(() => null)
  return { a, b, conflitos, sugestao: await sugestaoDeJuncao(aId, bId), parecerIa: parecer ? { ...(parecer.metadata as any), em: parecer.createdAt } : null }
}

// ── Parecer da IA (só quando alguém pede, na tela de revisão) ────────────────

const SISTEMA_PARECER = `Você ajuda a equipe de um CRM a decidir se duas fichas de contato são da mesma pessoa e se tratam do mesmo assunto.
Responda SOMENTE com JSON: {"mesmaPessoa":"sim"|"nao"|"talvez","mesmoAssunto":"sim"|"nao"|"talvez","recomendacao":"juntar"|"ligar"|"separar","motivo":"até 2 frases em português"}.
- juntar: mesma pessoa e mesmo assunto (uma conversa só).
- ligar: mesma pessoa, assuntos diferentes (ex.: matrícula e parceria) — as fichas seguem separadas.
- separar: pessoas diferentes (ex.: parentes usando o mesmo celular, CPFs diferentes, nomes incompatíveis).
Considere nome, CPF, e-mail, cidade, funil/equipe, inscrições e o que foi dito nas conversas. Na dúvida sobre ser a mesma pessoa, recomende "separar".`

export async function parecerDaIa(aId: number, bId: number): Promise<any> {
  const [a, b] = await Promise.all([resumoDaFicha(aId), resumoDaFicha(bId)])
  if (!a || !b) throw new Error('Ficha não encontrada')
  const ficha = (f: any) => [
    `Ficha #${f.id}: nome "${f.nome}", WhatsApp ${f.whatsapp || '—'}, e-mail ${f.email || '—'}, CPF ${f.cpf || '—'}, cidade ${f.cidade || '—'}`,
    `Funil ${f.funil || '—'} (etapa ${f.etapa || '—'}), equipe ${f.equipe || '—'}, responsável ${f.responsavel || '—'}, origem ${f.origem || '—'}, criada em ${new Date(f.criadaEm).toLocaleDateString('pt-BR')}`,
    `Inscrições: ${f.inscricoes.map((i: any) => `${i.candidateCode} (${i.status})`).join(', ') || 'nenhuma'}; aluno: ${f.aluno ? 'sim' : 'não'}; ${f.mensagens} mensagens`,
    `Campos: ${JSON.stringify(f.customFields).slice(0, 400)}`,
    'Últimas mensagens:', ...f.ultimasMensagens.map((m: any) => `- ${m.de}: ${m.texto}`),
  ].join('\n')
  const { getAnthropicKey, getAnthropicModel, getOpenAiKey, getOpenAiModel, getPrimaryProvider } = await import('../lib/aiKeys.js')
  const { registrarUsoIA } = await import('../lib/consumo.js')
  const user = `${ficha(a)}\n\n${ficha(b)}`
  const [prim, ak, ok] = await Promise.all([getPrimaryProvider(), getAnthropicKey(), getOpenAiKey()])
  let texto = ''
  for (const p of prim === 'openai' ? ['openai', 'anthropic'] : ['anthropic', 'openai']) {
    if (p === 'anthropic' && ak) {
      const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': ak, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: await getAnthropicModel(), max_tokens: 300, system: SISTEMA_PARECER, messages: [{ role: 'user', content: user }] }) })
      if (!r.ok) throw new Error(`IA indisponível (Anthropic ${r.status})`)
      const d: any = await r.json(); registrarUsoIA('parecer_duplicidade', 'anthropic', d, { leadId: aId }); texto = d.content?.[0]?.text || ''; break
    }
    if (p === 'openai' && ok) {
      const r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ok}` }, body: JSON.stringify({ model: await getOpenAiModel(), max_tokens: 300, messages: [{ role: 'system', content: SISTEMA_PARECER }, { role: 'user', content: user }] }) })
      if (!r.ok) throw new Error(`IA indisponível (OpenAI ${r.status})`)
      const d: any = await r.json(); registrarUsoIA('parecer_duplicidade', 'openai', d, { leadId: aId }); texto = d.choices?.[0]?.message?.content || ''; break
    }
  }
  if (!texto) throw new Error('Nenhuma chave de IA configurada')
  const m = texto.match(/\{[\s\S]*\}/)
  let parecer: any
  try { parecer = JSON.parse(m ? m[0] : texto) } catch { throw new Error('A IA não devolveu um parecer válido') }
  const par = [Math.min(aId, bId), Math.max(aId, bId)]
  const { logEvent } = await import('./leadHistory.js')
  logEvent({ leadId: par[0], type: 'duplicate_ai_opinion', category: 'lifecycle', title: `Parecer da IA sobre a ficha #${par[1]}: ${parecer.recomendacao}`, description: parecer.motivo, actorType: 'system', metadata: { ...parecer, par } } as any)
  return parecer
}
