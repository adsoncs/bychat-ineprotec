// services/trilhaTarefas.ts
//
// TRILHA DA SECRETARIA E RÉGUA DO FINANCEIRO (11/11/2026).
//
// Este módulo NÃO envia nada e NÃO cria tarefa sozinho. Ele só percebe situações
// que nenhum outro ponto do sistema anuncia e as transforma em eventos de fluxo:
//
//   enrollment.document_stale     documento enviado sem análise há mais de 1 dia
//   enrollment.matricula_completa paga + contrato + documentos obrigatórios aprovados
//   financeiro.parcela_vencida    parcela vencida há 3 / 15 dias, ou de acordo (quebrado)
//   financeiro.cartao_recusado    cartão recusado e a inscrição continua sem pagamento
//
// O que acontece depois (tarefa para a equipe, aviso ao aluno) é decidido no FLUXO.
// Sem fluxo ativo para o evento, nada é marcado: ligar o fluxo depois pega as
// situações em aberto naquele momento.
//
// Cada situação é anunciada UMA vez (marco gravado no histórico do lead). Tarefas
// criadas por estes fluxos guardam `metadata.trilha.ref`; quando o motivo some
// (documento analisado, parcela paga…), a varredura as fecha sozinha.

import { prisma } from '../lib/prisma.js'
import { eventBus } from '../lib/eventBus.js'

const FECHADAS = ['cancelled', 'merged', 'expired']
const TIPO_MARCO = 'trilha_marco'
const UM_DIA = 86_400_000

export const EVENTOS_DA_TRILHA = [
  'enrollment.document_stale',
  'enrollment.matricula_completa',
  'financeiro.parcela_vencida',
  'financeiro.cartao_recusado',
] as const

// ─── Marcos (uma vez por situação) ─────────────────────

async function jaMarcado(leadId: number, marco: string): Promise<boolean> {
  const e = await prisma.leadEvent.findFirst({
    where: { leadId, type: TIPO_MARCO, metadata: { path: '$.marco', equals: marco } as any },
    select: { id: true },
  })
  return !!e
}

async function marcar(leadId: number, marco: string, titulo: string): Promise<void> {
  await prisma.leadEvent.create({
    data: { leadId, type: TIPO_MARCO, category: 'system', title: titulo.slice(0, 191), source: 'trilha', actorType: 'system', metadata: { marco } },
  })
}

async function fluxosAtivos(): Promise<Set<string>> {
  const wfs = await prisma.workflow.findMany({ where: { active: true }, select: { triggerEvent: true } })
  return new Set(wfs.map((w) => w.triggerEvent))
}

/** Emite o evento uma única vez por marco. Devolve true se emitiu agora. */
async function anunciar(tipo: string, leadId: number, marco: string, titulo: string, payload: Record<string, any>): Promise<boolean> {
  if (await jaMarcado(leadId, marco)) return false
  await marcar(leadId, marco, titulo)
  eventBus.emitDomain({ type: tipo, leadId, payload: { ...payload, trilhaRef: marco }, timestamp: new Date() })
  return true
}

/** Para eventos imediatos (estorno, baixa manual, transferência): sem marco, a origem já é única. */
export function emitirEventoDaTrilha(tipo: string, leadId: number | null | undefined, payload: Record<string, any>): void {
  if (!leadId) return
  eventBus.emitDomain({ type: tipo, leadId, payload, timestamp: new Date() })
}

/** Equipes de quem fez a ação: os fluxos filtram "feito por alguém de fora do Financeiro". */
export async function equipesDoUsuario(userId: number | null | undefined): Promise<number[]> {
  if (!userId) return []
  const ms = await prisma.teamMember.findMany({ where: { userId }, select: { teamId: true } }).catch(() => [])
  return ms.map((m) => m.teamId)
}

/** Baixa manual de um pagamento (comprovante, dinheiro, parcela marcada como paga). */
export async function avisarBaixaManual(p: { registrationId: number | null; leadId?: number | null; userId: number | null; userName: string; oQue: string; valor?: string; nota?: string }): Promise<void> {
  try {
    const base = p.registrationId ? await dadosDaInscricao(p.registrationId) : null
    let leadId = p.leadId ?? null
    if (!leadId && p.registrationId) leadId = (await prisma.enrollmentRegistration.findUnique({ where: { id: p.registrationId }, select: { leadId: true } }))?.leadId ?? null
    emitirEventoDaTrilha('financeiro.baixa_manual', leadId, {
      ...(base ?? {}), oQue: p.oQue, valor: p.valor ?? '', nota: p.nota ?? '',
      operadorUserId: p.userId, operadorNome: p.userName, operadorTeamIds: await equipesDoUsuario(p.userId),
    })
  } catch (err) {
    console.error('[Trilha] aviso de baixa manual falhou:', err)
  }
}

const NOME_DO_ESTORNO: Record<string, string> = {
  PAYMENT_REFUNDED: 'Estorno',
  PAYMENT_PARTIALLY_REFUNDED: 'Estorno parcial',
  PAYMENT_CHARGEBACK_REQUESTED: 'Contestação (chargeback) aberta',
  PAYMENT_CHARGEBACK_DISPUTE: 'Contestação em disputa',
  PAYMENT_AWAITING_CHARGEBACK_REVERSAL: 'Contestação aguardando reversão',
}

/** Estorno/contestação vindo do Asaas, de qualquer cobrança (inscrição, título, parcela do portal). */
export async function avisarEstornoAsaas(event: string, payment: any): Promise<void> {
  try {
    const ref = String(payment?.externalReference || '')
    let registrationId: number | null = null
    const m1 = ref.match(/^enrollment-(\d+)$/)
    const m2 = ref.match(/^titulo-(\d+)$/)
    const m3 = ref.match(/^portal-parcela:(\d+):(\d+)$/)
    if (m1) registrationId = Number(m1[1])
    else if (m3) registrationId = Number(m3[1])
    else if (m2) registrationId = (await prisma.enrollmentTitulo.findUnique({ where: { id: Number(m2[1]) }, select: { registrationId: true } }))?.registrationId ?? null
    if (!registrationId && payment?.id) registrationId = (await prisma.enrollmentRegistration.findFirst({ where: { paymentId: String(payment.id) }, select: { id: true } }))?.id ?? null
    if (!registrationId) return
    const base = await dadosDaInscricao(registrationId)
    const leadId = (await prisma.enrollmentRegistration.findUnique({ where: { id: registrationId }, select: { leadId: true } }))?.leadId
    if (!base || !leadId) return
    // O Asaas reenvia o mesmo aviso: uma vez por (cobrança, tipo de evento).
    const marco = `estorno:${payment?.id}:${event}`
    await anunciar('financeiro.estorno', leadId, marco, `${NOME_DO_ESTORNO[event] ?? event}: ${base.candidateCode}`, {
      ...base, evento: NOME_DO_ESTORNO[event] ?? event, paymentId: String(payment?.id ?? ''),
      valor: payment?.value != null ? Number(payment.value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '',
    })
  } catch (err) {
    console.error('[Trilha] aviso de estorno falhou:', err)
  }
}

// ─── Dados comuns da inscrição ─────────────────────────

export async function dadosDaInscricao(registrationId: number): Promise<Record<string, any> | null> {
  const r = await prisma.enrollmentRegistration.findUnique({
    where: { id: registrationId },
    select: {
      id: true, candidateCode: true, leadId: true, formData: true,
      portal: { select: { id: true, nome: true, slug: true } },
      processRegistration: { select: { offering: { select: { nome: true, course: { select: { nome: true } } } } } },
    },
  })
  if (!r) return null
  const fd = (r.formData ?? {}) as Record<string, any>
  return {
    enrollmentId: r.id,
    candidateCode: r.candidateCode,
    portalNome: r.portal?.nome ?? '',
    portalSlug: r.portal?.slug ?? '',
    courseName: r.processRegistration?.offering?.nome ?? r.processRegistration?.offering?.course?.nome ?? 'não informado',
    escola: String(fd.campusNome ?? '').trim() || 'não definida — confira o polo',
  }
}

/** Situação dos documentos obrigatórios da inscrição (pela jornada do portal). */
export async function documentosDaInscricao(registrationId: number): Promise<{ exige: boolean; faltando: string[]; aprovadosTodos: boolean; dispensada: boolean }> {
  const { etapasDaInscricao } = await import('./portalJornada.js')
  const j = await etapasDaInscricao(registrationId, 'painel').catch(() => null)
  const et = j?.etapas.find((e) => e.chave === 'documentos')
  if (!et) return { exige: false, faltando: [], aprovadosTodos: true, dispensada: false }
  const p = et.progresso
  return {
    exige: true,
    faltando: et.dispensada ? [] : (p?.faltando ?? []),
    aprovadosTodos: !!et.dispensada || (!!p && p.aprovados >= p.total),
    dispensada: !!et.dispensada,
  }
}

/** Paga, contrato feito (ou não exigido/dispensado) e documentos obrigatórios aprovados. */
async function matriculaCompleta(registrationId: number): Promise<boolean> {
  const { etapasDaInscricao } = await import('./portalJornada.js')
  const j = await etapasDaInscricao(registrationId, 'painel').catch(() => null)
  if (!j) return false
  for (const e of j.etapas) {
    if (e.chave === 'pagamento' || e.chave === 'contrato' || e.chave === 'analise') {
      if (e.situacao !== 'feito') return false
    }
    if (e.chave === 'documentos') {
      if (e.dispensada) continue
      const p = e.progresso
      if (!p || p.recusados > 0 || p.aprovados < p.total) return false
    }
  }
  return true
}

// ─── Varredura ─────────────────────────────────────────

export interface ResultadoVarredura { emitidos: Record<string, number>; fechadas: number }

export async function varrerTrilha(opts: { simular?: boolean } = {}): Promise<ResultadoVarredura> {
  const ativos = opts.simular ? new Set<string>(EVENTOS_DA_TRILHA) : await fluxosAtivos()
  const emitidos: Record<string, number> = {}
  const conta = (t: string) => { emitidos[t] = (emitidos[t] ?? 0) + 1 }
  const anunciarOuContar = async (tipo: string, leadId: number, marco: string, titulo: string, payload: Record<string, any>) => {
    if (opts.simular) { if (!(await jaMarcado(leadId, marco))) conta(tipo); return }
    if (await anunciar(tipo, leadId, marco, titulo, payload)) conta(tipo)
  }

  // S1 · documento enviado e parado sem análise há mais de 1 dia. Cada documento
  // é anunciado uma vez, mas a tarefa é UMA por matrícula (lista os documentos):
  // aluno que manda 6 documentos de uma vez não vira 6 tarefas.
  if (ativos.has('enrollment.document_stale')) {
    const docs = await prisma.enrollmentDocument.findMany({
      where: { status: 'pending', uploadedAt: { lt: new Date(Date.now() - UM_DIA) }, registration: { status: { notIn: FECHADAS }, mergedIntoId: null, leadId: { not: null } } },
      orderBy: { uploadedAt: 'asc' },
      select: { id: true, label: true, typeCode: true, uploadedAt: true, registrationId: true, registration: { select: { leadId: true } }, type: { select: { name: true } } },
    })
    // Só a ÚLTIMA versão de cada tipo conta: a pendente antiga, já substituída por
    // um envio mais novo (aprovado ou não), não está "parada" (12/11/2026).
    const superadas = await versoesSuperadas(docs.map((d) => d.registrationId))
    const porInscricao = new Map<number, typeof docs>()
    for (const d of docs) {
      if (superadas.has(d.id)) continue
      ;(porInscricao.get(d.registrationId) ?? porInscricao.set(d.registrationId, []).get(d.registrationId)!).push(d)
    }
    for (const [regId, lista] of porInscricao) {
      const leadId = lista[0]!.registration!.leadId!
      const novos = []
      for (const d of lista) if (!(await jaMarcado(leadId, `doc_parado:${d.id}`))) novos.push(d)
      if (!novos.length) continue
      const base = await dadosDaInscricao(regId)
      if (!base) continue
      const nome = (d: (typeof docs)[number]) => d.type?.name || d.label || d.typeCode
      if (opts.simular) { conta('enrollment.document_stale'); continue }
      for (const d of novos) await marcar(leadId, `doc_parado:${d.id}`, `Documento parado sem análise: ${nome(d)} (${base.candidateCode})`)
      eventBus.emitDomain({
        type: 'enrollment.document_stale', leadId, timestamp: new Date(),
        payload: {
          ...base, trilhaRef: `doc_parado:${regId}`,
          docName: lista.map(nome).join(', '), qtdDocumentos: lista.length,
          enviadoEm: lista[0]!.uploadedAt.toLocaleDateString('pt-BR'),
        },
      })
      conta('enrollment.document_stale')
    }
  }

  // S3·S4·S5 · matrícula completa
  if (ativos.has('enrollment.matricula_completa')) {
    const regs = await prisma.enrollmentRegistration.findMany({
      where: { status: { notIn: FECHADAS }, mergedIntoId: null, leadId: { not: null }, paymentStatus: 'paid' },
      select: { id: true, leadId: true },
    })
    for (const r of regs) {
      if (await jaMarcado(r.leadId!, `completa:${r.id}`)) continue
      if (!(await matriculaCompleta(r.id))) continue
      const base = await dadosDaInscricao(r.id)
      if (!base) continue
      await anunciarOuContar('enrollment.matricula_completa', r.leadId!, `completa:${r.id}`, `Matrícula completa: ${base.candidateCode}`, base)
    }
  }

  // F1·F2 · parcela vencida (3 dias → cobrar; 15 dias ou acordo → negociar)
  if (ativos.has('financeiro.parcela_vencida')) {
    const { carregarItens } = await import('./inadimplencia.js')
    const itens = await carregarItens().catch(() => [])
    for (const i of itens) {
      if (!i.leadId || i.diasAtraso < 3) continue
      const marco = i.acordoId ? 'acordo_quebrado' : i.diasAtraso >= 15 ? '15d' : '3d'
      const chaveMarco = `vencida:${i.chave}:${marco}`
      // Vista já com 15 dias: não abre também a de 3 (seria cobrar e negociar juntos).
      if (marco === '15d' && !opts.simular && !(await jaMarcado(i.leadId, `vencida:${i.chave}:3d`))) await marcar(i.leadId, `vencida:${i.chave}:3d`, `Parcela vencida (já com ${i.diasAtraso} dias): ${i.titulo}`)
      const base = i.registrationId ? await dadosDaInscricao(i.registrationId) : null
      await anunciarOuContar('financeiro.parcela_vencida', i.leadId, chaveMarco, `Parcela vencida há ${i.diasAtraso} dias: ${i.titulo}`, {
        candidateCode: 'acadêmico', ...(base ?? {}), marco, diasAtraso: i.diasAtraso, parcela: i.titulo, chaveParcela: i.chave,
        vencimento: i.vencimento.split('-').reverse().join('/'),
        valor: (i.atualizado / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
        acordoId: i.acordoId ?? '',
      })
    }
  }

  // F3 · cartão recusado e a inscrição continua sem pagamento (30 min de folga para nova tentativa)
  if (ativos.has('financeiro.cartao_recusado')) {
    const falhas = await prisma.enrollmentPaymentMethod.findMany({
      where: {
        method: 'credit_card', status: 'failed',
        createdAt: { lt: new Date(Date.now() - 30 * 60_000), gt: new Date(Date.now() - 7 * UM_DIA) },
        registration: { status: { notIn: FECHADAS }, mergedIntoId: null, leadId: { not: null }, NOT: { paymentStatus: 'paid' } },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, registrationId: true, amount: true, lastErrorMessage: true, registration: { select: { leadId: true } } },
    })
    const vistas = new Set<number>()
    for (const f of falhas) {
      if (vistas.has(f.registrationId)) continue // uma por inscrição: a tentativa mais recente
      vistas.add(f.registrationId)
      const base = await dadosDaInscricao(f.registrationId)
      if (!base) continue
      await anunciarOuContar('financeiro.cartao_recusado', f.registration.leadId!, `cartao:${f.id}`, `Cartão recusado: ${base.candidateCode}`, {
        ...base, valor: f.amount != null ? Number(f.amount).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '',
        motivo: String(f.lastErrorMessage ?? '').slice(0, 200),
      })
    }
  }

  const fechadas = opts.simular ? 0 : await fecharTarefasResolvidas()
  return { emitidos, fechadas }
}

/** Documentos que já têm um envio MAIS NOVO do mesmo tipo na mesma inscrição. */
async function versoesSuperadas(registrationIds: number[]): Promise<Set<number>> {
  const ids = [...new Set(registrationIds)]
  if (!ids.length) return new Set()
  const todos = await prisma.enrollmentDocument.findMany({
    where: { registrationId: { in: ids } }, select: { id: true, registrationId: true, typeCode: true, uploadedAt: true },
  })
  const maisNovo = new Map<string, { id: number; t: number }>()
  for (const d of todos) {
    const k = `${d.registrationId}:${d.typeCode}`, t = d.uploadedAt.getTime(), m = maisNovo.get(k)
    if (!m || t > m.t || (t === m.t && d.id > m.id)) maisNovo.set(k, { id: d.id, t })
  }
  return new Set(todos.filter((d) => maisNovo.get(`${d.registrationId}:${d.typeCode}`)!.id !== d.id).map((d) => d.id))
}

// ─── Tarefas que se fecham sozinhas ────────────────────

async function fecharTarefasResolvidas(): Promise<number> {
  const tarefas = await prisma.activity.findMany({
    where: { status: { in: ['pending', 'overdue'] }, templateCode: { in: ['TR-S1', 'TR-S2', 'TR-F1', 'TR-F2', 'TR-F3'] } },
    select: { id: true, templateCode: true, metadata: true, description: true },
  })
  if (!tarefas.length) return 0
  let vencidas: Set<string> | null = null
  let fechadas = 0
  for (const t of tarefas) {
    const m = (t.metadata ?? {}) as any
    const regId = Number(m.enrollmentId) || null
    let motivo: string | null = null
    if (t.templateCode === 'TR-S1') {
      if (!regId) continue
      const pend = await prisma.enrollmentDocument.findMany({ where: { registrationId: regId, status: 'pending' }, select: { id: true } })
      const superadas = pend.length ? await versoesSuperadas([regId]) : new Set<number>()
      if (!pend.some((d) => !superadas.has(d.id))) motivo = 'todos os documentos enviados foram analisados'
    } else if (t.templateCode === 'TR-S2') {
      if (!regId) continue
      const docs = await documentosDaInscricao(regId)
      if (!docs.faltando.length) motivo = 'o aluno enviou os documentos que faltavam'
    } else if (t.templateCode === 'TR-F1' || t.templateCode === 'TR-F2') {
      const chave = String(m.chaveParcela ?? '')
      if (!chave) continue
      if (!vencidas) {
        const { carregarItens } = await import('./inadimplencia.js')
        vencidas = new Set((await carregarItens().catch(() => [])).map((i) => i.chave))
      }
      if (!vencidas.has(chave)) motivo = 'a parcela foi paga ou deixou de estar em aberto'
    } else if (t.templateCode === 'TR-F3') {
      if (!regId) continue
      const r = await prisma.enrollmentRegistration.findUnique({ where: { id: regId }, select: { paymentStatus: true } })
      if (r?.paymentStatus === 'paid') motivo = 'o pagamento foi confirmado'
    }
    if (!motivo) continue
    await prisma.activity.update({
      where: { id: t.id },
      data: { status: 'completed', completedAt: new Date(), result: `Fechada sozinha: ${motivo}.` },
    })
    fechadas++
  }
  return fechadas
}

// ─── Agenda ────────────────────────────────────────────

let rodando = false
export function startTrilhaTarefas(): void {
  const rodar = async () => {
    if (rodando) return
    rodando = true
    try {
      const r = await varrerTrilha()
      const total = Object.values(r.emitidos).reduce((s, n) => s + n, 0)
      if (total || r.fechadas) console.log(`[Trilha] eventos: ${JSON.stringify(r.emitidos)} · tarefas fechadas sozinhas: ${r.fechadas}`)
    } catch (err) {
      console.error('[Trilha] erro na varredura:', err)
    } finally {
      rodando = false
    }
  }
  setTimeout(rodar, 60_000)
  setInterval(rodar, 15 * 60_000)
  console.log('[Trilha] varredura da Secretaria/Financeiro a cada 15 min')
}
