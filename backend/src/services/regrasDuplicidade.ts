// src/services/regrasDuplicidade.ts
//
// Regras de duplicidade que o TIME liga e desliga (Configurações › Duplicação),
// guardadas na Setting `dedup.regras`. Duas camadas:
//
//   · fichas (a pessoa): mesmo WhatsApp / CPF / e-mail / nome+DDD → juntar
//     sozinho, só sinalizar, ou nada; e em quais canais de captura vale;
//   · inscrições (dentro da mesma pessoa): o que fazer quando ela envia outra
//     inscrição com uma aberta — mesmo curso e forma, mesmo curso com outra
//     forma de ingresso, ou outro curso.
//
// Travas FIXAS, fora do painel: CPF diferente nunca junta (celular da família);
// nomes claramente diferentes não juntam por telefone; inscrição paga ou
// matriculada nunca é reaproveitada; a junção automática só vale para o que foi
// sinalizado DEPOIS de a regra ser ligada (`ativadaEm`) — o acervo antigo é
// revisão humana.

import { prisma } from '../lib/prisma.js'
import { normalizeCpf } from '../lib/cpf.js'

export type AcaoFicha = 'juntar' | 'sinalizar' | 'nada'
export type AcaoInscricao = 'retomar' | 'manter' | 'manter_avisar'

export interface RegrasDuplicidade {
  fichas: { whatsapp: AcaoFicha; cpf: AcaoFicha; email: AcaoFicha; nomeDdd: AcaoFicha }
  /** Canais em que a junção automática vale (a sinalização vale em todos). */
  canais: Record<string, boolean>
  inscricoes: { mesmaOferta: AcaoInscricao; mesmoCursoOutraForma: AcaoInscricao; outroCurso: AcaoInscricao }
  /** Quando a junção automática foi ligada — só junta o sinalizado depois disso. */
  ativadaEm?: string | null
}

export const CANAIS_DE_CAPTURA = ['enrollmentPortal', 'metaLeadAds', 'forms', 'publicApi', 'make', 'inbound_webhook'] as const
const NOME_DO_CANAL: Record<string, string> = {
  enrollmentPortal: 'Portal de Matrículas', metaLeadAds: 'Meta Lead Ads', forms: 'formulário', publicApi: 'API', make: 'Make', inbound_webhook: 'webhook',
}

/**
 * Padrão: o comportamento de antes (só sinalizar) — nenhum tenant passa a
 * juntar fichas sem alguém ligar no painel. As inscrições já nascem com a regra
 * nova (outro curso nunca substitui a inscrição aberta).
 */
export const REGRAS_PADRAO: RegrasDuplicidade = {
  fichas: { whatsapp: 'sinalizar', cpf: 'sinalizar', email: 'sinalizar', nomeDdd: 'nada' },
  canais: Object.fromEntries(CANAIS_DE_CAPTURA.map((c) => [c, true])),
  inscricoes: { mesmaOferta: 'retomar', mesmoCursoOutraForma: 'manter_avisar', outroCurso: 'manter' },
  ativadaEm: null,
}

const CHAVE = 'dedup.regras'
let cache: { valor: RegrasDuplicidade; ate: number } | null = null

export function invalidarRegrasDuplicidade(): void { cache = null }

export async function lerRegrasDuplicidade(): Promise<RegrasDuplicidade> {
  if (cache && cache.ate > Date.now()) return cache.valor
  const row = await prisma.setting.findUnique({ where: { key: CHAVE }, select: { value: true } }).catch(() => null)
  let salvo: any = row?.value
  if (typeof salvo === 'string') { try { salvo = JSON.parse(salvo) } catch { salvo = null } }
  const valor: RegrasDuplicidade = {
    fichas: { ...REGRAS_PADRAO.fichas, ...(salvo?.fichas || {}) },
    canais: { ...REGRAS_PADRAO.canais, ...(salvo?.canais || {}) },
    inscricoes: { ...REGRAS_PADRAO.inscricoes, ...(salvo?.inscricoes || {}) },
    ativadaEm: salvo?.ativadaEm ?? null,
  }
  cache = { valor, ate: Date.now() + 60_000 }
  return valor
}

// ── Inscrições ─────────────────────────────────────────────────────────────

const STATUS_ABERTOS = ['pending', 'submitted']

/**
 * A inscrição aberta da mesma pessoa (CPF) que um novo envio deve REAPROVEITAR,
 * segundo as regras — ou nenhuma (cria outra). `avisar` traz a inscrição irmã
 * quando a regra é "manter as duas e avisar a secretaria".
 */
export async function decidirInscricaoDoCpf(portalId: number, cpfBruto: string, offeringId?: number | null) {
  const cpf = normalizeCpf(cpfBruto)
  if (cpf.length !== 11) return { retomar: null, avisar: null }
  const regras = (await lerRegrasDuplicidade()).inscricoes
  const candidatas = await prisma.enrollmentRegistration.findMany({
    // paymentStatus nulo (ainda sem cobrança) precisa entrar: NOT (x = 'paid')
    // em SQL descarta o NULL — e era justamente a inscrição recém-criada.
    where: { portalId, status: { in: STATUS_ABERTOS }, mergedIntoId: null, OR: [{ paymentStatus: null }, { paymentStatus: { not: 'paid' } }] },
    select: {
      id: true, candidateCode: true, leadId: true, formData: true, processRegistrationId: true, status: true,
      processRegistration: { select: { offeringId: true, offering: { select: { courseId: true } } } },
    },
    orderBy: { createdAt: 'desc' },
    take: 2000,
  })
  const dela = candidatas.filter((r) => normalizeCpf(String((r.formData as any)?.cpf ?? '')) === cpf)
  if (!dela.length) return { retomar: null, avisar: null }
  // Sem curso no envio (portal sem escolha de oferta): é reenvio.
  if (!offeringId) return { retomar: dela[0], avisar: null }
  const nova = await prisma.courseOffering.findUnique({ where: { id: offeringId }, select: { courseId: true } }).catch(() => null)

  const situacao = (r: typeof dela[number]): keyof RegrasDuplicidade['inscricoes'] => {
    const oferta = r.processRegistration?.offeringId ?? null
    // Inscrição ainda sem curso: é a mesma tentativa sendo completada.
    if (oferta == null || oferta === offeringId) return 'mesmaOferta'
    return nova && r.processRegistration?.offering?.courseId === nova.courseId ? 'mesmoCursoOutraForma' : 'outroCurso'
  }
  for (const s of ['mesmaOferta', 'mesmoCursoOutraForma', 'outroCurso'] as const) {
    const r = dela.find((x) => situacao(x) === s)
    if (!r) continue
    if (regras[s] === 'retomar') return { retomar: r, avisar: null }
    if (regras[s] === 'manter_avisar') return { retomar: null, avisar: r }
  }
  return { retomar: null, avisar: null }
}

/** Nota na ficha + mensagem interna: a pessoa ficou com duas inscrições do mesmo curso. */
export async function avisarInscricaoIrma(leadId: number, novaCodigo: string, irma: { candidateCode: string; leadId: number | null }): Promise<void> {
  const texto = `⚠ Mesma pessoa (CPF) com duas inscrições abertas do MESMO curso, em formas de ingresso diferentes: ${irma.candidateCode} e ${novaCodigo}. Confirme com o candidato qual vale e cancele a outra (Inscrições › Duplicidades).`
  const fichas = [...new Set([leadId, irma.leadId].filter((x): x is number => !!x))]
  for (const id of fichas) {
    await prisma.leadNote.create({ data: { leadId: id, userId: null, userName: 'Sistema', content: texto } }).catch(() => {})
    await prisma.message.create({ data: { leadId: id, fromMe: true, isInternal: true, body: texto, senderName: 'Sistema', timestamp: new Date() } }).catch(() => {})
  }
}

// ── Fichas: junção automática ────────────────────────────────────────────

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
const PLACEHOLDER = /^(lead( lp| meta)?|webchat|contato( do whatsapp)?|sem nome|\+?\d[\d\s()+-]*)$/i

/** Primeiro nome comparável; vazio quando o nome é placeholder (telefone, "Lead"). */
export function primeiroNome(nome: string | null | undefined): string {
  const n = semAcento(String(nome ?? ''))
  if (!n || PLACEHOLDER.test(n)) return ''
  return n.split(/\s+/)[0]
}

async function cpfsDaFicha(leadId: number): Promise<Set<string>> {
  const l = await prisma.lead.findUnique({ where: { id: leadId }, select: { formData: true } }).catch(() => null)
  const regs = await prisma.enrollmentRegistration.findMany({ where: { leadId }, select: { formData: true } }).catch(() => [] as any[])
  return new Set([l?.formData, ...regs.map((r: any) => r.formData)].map((fd: any) => normalizeCpf(String(fd?.cpf ?? ''))).filter((c) => c.length === 11))
}

/**
 * Por que estas duas fichas NÃO podem ser juntadas sozinhas (ou null se podem).
 * É a parte fixa da regra: vale qualquer que seja a configuração.
 */
export async function impedimentoParaJuntar(aId: number, bId: number, matchType: string): Promise<string | null> {
  const [a, b] = await Promise.all([aId, bId].map((id) => prisma.lead.findUnique({ where: { id }, select: { nome: true } })))
  if (!a || !b) return 'ficha não encontrada'
  const [ca, cb] = await Promise.all([cpfsDaFicha(aId), cpfsDaFicha(bId)])
  if (ca.size && cb.size && ![...ca].some((x) => cb.has(x))) return 'CPFs diferentes (pode ser outra pessoa usando o mesmo número)'
  const cpfIgual = ca.size > 0 && [...ca].some((x) => cb.has(x))
  if (!cpfIgual && matchType !== 'cpf') {
    const na = primeiroNome(a.nome), nb = primeiroNome(b.nome)
    if (na && nb && na !== nb) return `nomes diferentes ("${a.nome}" × "${b.nome}")`
  }
  const alunos = await prisma.aluno.count({ where: { leadId: { in: [aId, bId] } } }).catch(() => 0)
  if (alunos > 1) return 'as duas fichas têm cadastro de aluno'
  // Mesma pessoa, ASSUNTO diferente: quem conversa com Matrículas e manda o
  // formulário de Expansão precisa aparecer na Expansão. A junção mantém o funil
  // e a equipe da ficha que fica — o destino da outra sumia (fabad, 22/10,
  // fichas 1379→1175 e 1340→917). Funis diferentes (ou, sem funil, equipes
  // diferentes) = duas fichas, cada uma no seu lugar, sinalizadas.
  const destino = (id: number) => prisma.lead.findUnique({ where: { id }, select: { funnelId: true, teamId: true, funnel: { select: { name: true } }, team: { select: { name: true } } } })
  const [da, db] = await Promise.all([destino(aId), destino(bId)])
  if (da?.funnelId && db?.funnelId && da.funnelId !== db.funnelId) return `assuntos diferentes (funil "${da.funnel?.name}" × "${db.funnel?.name}")`
  if ((!da?.funnelId || !db?.funnelId) && da?.teamId && db?.teamId && da.teamId !== db.teamId) return `assuntos diferentes (equipe "${da.team?.name}" × "${db.team?.name}")`
  // Duas pessoas da equipe conversando com o contato agora, uma em cada ficha:
  // juntar mistura os dois atendimentos no meio. Fica para o time decidir.
  const { atendimentoHumanoAtivo } = await import('./journey/validacaoContato.js')
  const [ha, hb] = await Promise.all([atendimentoHumanoAtivo(aId), atendimentoHumanoAtivo(bId)])
  if (ha && hb && ha.nome !== hb.nome) return `duas conversas em andamento com pessoas diferentes (${ha.nome} × ${hb.nome})`
  return null
}

/** Motivo de não juntar que é "mesma pessoa, outro assunto": liga as fichas. */
export const ehOutroAssunto = (motivo: string | null) => !!motivo && motivo.startsWith('assuntos diferentes')

/** Qual fica: a que tem mais conversa; empate, a mais antiga (menor id). */
async function qualFica(aId: number, bId: number): Promise<[number, number]> {
  const [ma, mb] = await Promise.all([aId, bId].map((id) => prisma.message.count({ where: { leadId: id } })))
  if (ma !== mb) return ma > mb ? [aId, bId] : [bId, aId]
  return aId < bId ? [aId, bId] : [bId, aId]
}

/**
 * Rodada da junção automática: fichas sinalizadas como duplicata (pendentes) por
 * um critério que o time marcou como "juntar", num canal ligado, depois de a
 * regra ser ativada. Espera 2 min depois da sinalização — o canal que criou a
 * ficha ainda pode estar gravando nela (inscrição do portal, por exemplo).
 */
export async function juntarDuplicatasAutomaticas(): Promise<{ juntadas: number; mantidas: number }> {
  const regras = await lerRegrasDuplicidade()
  const desde = regras.ativadaEm ? new Date(regras.ativadaEm) : null
  const criterios = (Object.entries(regras.fichas) as Array<[string, AcaoFicha]>).filter(([, v]) => v === 'juntar').map(([k]) => k)
  if (!desde || !criterios.length) return { juntadas: 0, mantidas: 0 }
  const matchDe: Record<string, string> = { whatsapp: 'whatsapp', email: 'email', cpf: 'cpf', nomeDdd: 'nome' }
  const pendentes = await prisma.lead.findMany({
    where: {
      duplicateStatus: 'pending_review', possibleDuplicateOfId: { not: null },
      duplicateFlaggedAt: { gte: desde, lte: new Date(Date.now() - 2 * 60_000) },
      duplicateMatchedBy: { in: criterios.map((c) => matchDe[c]) },
    },
    select: { id: true, possibleDuplicateOfId: true, duplicateMatchedBy: true },
    take: 50,
  })
  const { mergeLeads } = await import('./dedup.js')
  const { logEvent, EVENT_TYPES } = await import('./leadHistory.js')
  let juntadas = 0, mantidas = 0
  for (const p of pendentes) {
    // Canal de captura: o da sinalização (evento DUPLICATE_DETECTED da ficha nova).
    const ev = await prisma.leadEvent.findFirst({ where: { leadId: p.id, type: EVENT_TYPES.DUPLICATE_DETECTED }, orderBy: { id: 'desc' }, select: { source: true } }).catch(() => null)
    const canal = ev?.source || ''
    const jaAvaliada = await prisma.leadEvent.findFirst({ where: { leadId: p.id, type: 'duplicate_auto_kept' }, select: { id: true } }).catch(() => null)
    if (jaAvaliada || (canal && regras.canais[canal] === false)) continue
    const outro = p.possibleDuplicateOfId!
    const motivo = await impedimentoParaJuntar(p.id, outro, p.duplicateMatchedBy || '')
    if (ehOutroAssunto(motivo)) {
      // Mesma pessoa, assunto diferente: as duas fichas seguem, cada uma no seu
      // funil, ligadas como "mesma pessoa" (aparece na ficha e para a IA).
      const { ligarFichas } = await import('./juncaoSegura.js')
      await ligarFichas(outro, p.id, { nome: 'Sistema (regra de duplicidade)', motivo: motivo! }).catch(() => null)
      mantidas++
      continue
    }
    if (motivo) {
      mantidas++
      const texto = `Duplicata NÃO juntada automaticamente com a ficha #${outro}: ${motivo}. Fica para revisão do time.`
      await prisma.leadNote.create({ data: { leadId: p.id, userId: null, userName: 'Sistema', content: texto } }).catch(() => {})
      logEvent({ leadId: p.id, type: 'duplicate_auto_kept', category: 'lifecycle', title: 'Duplicata mantida para revisão', description: texto, actorType: 'system', source: canal || undefined, metadata: { outro, motivo } })
      continue
    }
    const [keepId, mergeId] = await qualFica(p.id, outro)
    try {
      await mergeLeads({ keepId, mergeId, operatorName: 'Sistema (regra de duplicidade)' })
      juntadas++
      await prisma.leadNote.create({ data: { leadId: keepId, userId: null, userName: 'Sistema', content: `Ficha #${mergeId} juntada automaticamente a esta (mesmo ${p.duplicateMatchedBy === 'email' ? 'e-mail' : p.duplicateMatchedBy === 'cpf' ? 'CPF' : p.duplicateMatchedBy === 'nome' ? 'nome e DDD' : 'WhatsApp'}${canal ? `, entrada por ${NOME_DO_CANAL[canal] ?? canal}` : ''}). Regra: Configurações › Duplicação.` } }).catch(() => {})
    } catch (e: any) {
      mantidas++
      logEvent({ leadId: p.id, type: 'duplicate_auto_kept', category: 'lifecycle', title: 'Duplicata mantida para revisão', description: `Junção automática falhou: ${e?.message || e}`, actorType: 'system', metadata: { outro } })
    }
  }
  return { juntadas, mantidas }
}
