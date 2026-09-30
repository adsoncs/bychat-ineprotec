// src/services/inscricaoDuplicada.ts
//
// Duplicidade de inscrições dentro de um portal.
//
// A duplicidade de LEADS (dedup.ts) já existia, mas a inscrição não tinha o
// conceito: a mesma pessoa enviando três vezes gerava três inscrições, cada uma
// num lead novo, e nada na aba Inscrições as ligava (caso do ineprotec, 29/09).
//
// Aqui:
//   · grupos — inscrições da mesma pessoa no portal, por CPF, WhatsApp
//     (phoneKey, o mesmo critério dos leads) ou e-mail;
//   · mesclar — uma fica; as outras viram 'merged' (reversível), têm a cobrança
//     aberta cancelada no gateway, entregam os documentos e o lead é mesclado;
//   · manter separadas — a secretaria decidiu que não é duplicidade;
//   · inscrição aberta — o envio reaproveita em vez de criar outra.

import { prisma } from '../lib/prisma.js'
import { phoneKey } from '../lib/phone.js'
import { normalizeCpf } from '../lib/cpf.js'
import { logEvent } from './leadHistory.js'

/** Status que ainda podem receber a mesma pessoa de volta (sem pagamento). */
const STATUS_ABERTOS = ['pending', 'submitted']
/** Pagou ou virou matrícula: nunca é a descartada numa mesclagem. */
const ehPaga = (r: { status: string; paymentStatus: string | null }) =>
  r.paymentStatus === 'paid' || ['paid', 'enrolled'].includes(r.status)

interface InscricaoBase {
  id: number
  portalId: number
  candidateCode: string
  status: string
  paymentStatus: string | null
  formData: unknown
  createdAt: Date
  leadId: number | null
  lead: { id: number; nome: string; email: string; whatsapp: string } | null
}

/** CPF, telefone e e-mail da inscrição — do formulário, com o lead de reserva. */
export function chavesDaInscricao(r: Pick<InscricaoBase, 'formData' | 'lead'>): string[] {
  const fd = (r.formData ?? {}) as Record<string, unknown>
  const chaves: string[] = []
  const cpf = normalizeCpf(String(fd.cpf ?? ''))
  if (cpf.length === 11) chaves.push(`cpf:${cpf}`)
  const tel = phoneKey(String(fd.whatsapp ?? '') || r.lead?.whatsapp || '')
  if (tel) chaves.push(`tel:${tel}`)
  const email = String(fd.email ?? '').trim().toLowerCase() || (r.lead?.email ?? '').trim().toLowerCase()
  if (email.includes('@')) chaves.push(`email:${email}`)
  return chaves
}

const SELECT_INSCRICAO = {
  id: true, portalId: true, candidateCode: true, status: true, paymentStatus: true, formData: true,
  createdAt: true, leadId: true, duplicataIgnorada: true, contratoAceite: true,
  lead: { select: { id: true, nome: true, email: true, whatsapp: true } },
  processRegistration: { select: { offering: { select: { id: true, nome: true } } } },
  _count: { select: { documents: true } },
} as const

export interface MembroDoGrupo {
  id: number
  candidateCode: string
  nome: string
  curso: string | null
  status: string
  paymentStatus: string | null
  documentos: number
  contratoAceito: boolean
  criadaEm: Date
  paga: boolean
  leadId: number | null
  ignorada: boolean
}

export interface GrupoDeDuplicidade {
  /** O que as une: 'cpf', 'tel', 'email' (pode ter mais de um). */
  porque: string[]
  membros: MembroDoGrupo[]
  /** Sugestão de qual manter: paga > mais avançada > mais recente. */
  sugestaoPrincipalId: number
  /** A secretaria já disse "manter separadas" para todas. */
  ignorado: boolean
  /** Inscrições da mesma pessoa em OUTROS portais — informação, não duplicidade. */
  outrosPortais: { portal: string; candidateCode: string }[]
}

/** Quanto a inscrição já andou — desempate da sugestão de principal. */
function avanco(m: MembroDoGrupo): number {
  return (m.paga ? 1000 : 0) + (m.contratoAceito ? 100 : 0) + m.documentos * 10 + (m.paymentStatus === 'pending' ? 1 : 0)
}

/**
 * Grupos de possível duplicidade do portal. Inscrições já mescladas ficam de
 * fora (são o passado de uma mesclagem, não uma duplicidade viva).
 */
export async function gruposDeDuplicidade(portalId: number): Promise<GrupoDeDuplicidade[]> {
  const regs = await prisma.enrollmentRegistration.findMany({
    where: { portalId, status: { not: 'merged' } },
    select: SELECT_INSCRICAO,
    orderBy: { createdAt: 'asc' },
  })

  // União por chave: A e B dividem CPF, B e C dividem e-mail → A, B e C juntos.
  const pai = new Map<number, number>(regs.map((r) => [r.id, r.id]))
  const raiz = (x: number): number => { while (pai.get(x) !== x) x = pai.get(x)!; return x }
  const donoDaChave = new Map<string, number>()
  const motivos = new Map<number, Set<string>>()
  for (const r of regs) {
    for (const k of chavesDaInscricao(r as any)) {
      const outro = donoDaChave.get(k)
      if (outro === undefined) { donoDaChave.set(k, r.id); continue }
      const a = raiz(outro), b = raiz(r.id)
      if (a !== b) pai.set(b, a)
      const tipo = k.slice(0, k.indexOf(':'))
      for (const id of [outro, r.id]) {
        if (!motivos.has(id)) motivos.set(id, new Set())
        motivos.get(id)!.add(tipo)
      }
    }
  }

  const porRaiz = new Map<number, typeof regs>()
  for (const r of regs) {
    const k = raiz(r.id)
    if (!porRaiz.has(k)) porRaiz.set(k, [])
    porRaiz.get(k)!.push(r)
  }

  const grupos: GrupoDeDuplicidade[] = []
  for (const lista of porRaiz.values()) {
    if (lista.length < 2) continue
    const membros: MembroDoGrupo[] = lista.map((r) => ({
      id: r.id,
      candidateCode: r.candidateCode,
      nome: r.lead?.nome || String((r.formData as any)?.nome ?? ''),
      curso: r.processRegistration?.offering?.nome ?? null,
      status: r.status,
      paymentStatus: r.paymentStatus,
      documentos: r._count.documents,
      contratoAceito: !!(r.contratoAceite as any)?.em,
      criadaEm: r.createdAt,
      paga: ehPaga(r),
      leadId: r.leadId,
      ignorada: r.duplicataIgnorada,
    }))
    const ordem = [...membros].sort((a, b) => avanco(b) - avanco(a) || b.criadaEm.getTime() - a.criadaEm.getTime())
    const porque = [...new Set(lista.flatMap((r) => [...(motivos.get(r.id) ?? [])]))]
    grupos.push({
      porque,
      membros: membros.sort((a, b) => b.criadaEm.getTime() - a.criadaEm.getTime()),
      sugestaoPrincipalId: ordem[0]!.id,
      ignorado: membros.every((m) => m.ignorada),
      outrosPortais: [],
    })
  }

  // Mesma pessoa em outros portais: só pelo CPF, que é o identificador forte.
  const cpfs = new Map<string, GrupoDeDuplicidade>()
  for (const g of grupos) {
    for (const r of lista(g, regs)) {
      const cpf = normalizeCpf(String((r.formData as any)?.cpf ?? ''))
      if (cpf.length === 11) cpfs.set(cpf, g)
    }
  }
  if (cpfs.size > 0) {
    const fora = await prisma.enrollmentRegistration.findMany({
      where: { portalId: { not: portalId }, status: { not: 'merged' } },
      select: { candidateCode: true, formData: true, portal: { select: { nome: true } } },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    })
    for (const r of fora) {
      const g = cpfs.get(normalizeCpf(String((r.formData as any)?.cpf ?? '')))
      if (g) g.outrosPortais.push({ portal: r.portal.nome, candidateCode: r.candidateCode })
    }
  }

  // Os que pedem atenção primeiro; os já decididos ("manter separadas") no fim.
  return grupos.sort((a, b) => Number(a.ignorado) - Number(b.ignorado) || b.membros[0]!.criadaEm.getTime() - a.membros[0]!.criadaEm.getTime())
}

function lista(g: GrupoDeDuplicidade, regs: { id: number; formData: unknown }[]) {
  const ids = new Set(g.membros.map((m) => m.id))
  return regs.filter((r) => ids.has(r.id))
}

/** Mapa inscrição → tamanho do grupo, para o selo na lista (só grupos vivos). */
export async function tamanhoDosGrupos(portalId: number): Promise<Map<number, number>> {
  const mapa = new Map<number, number>()
  for (const g of await gruposDeDuplicidade(portalId)) {
    if (g.ignorado) continue
    for (const m of g.membros) mapa.set(m.id, g.membros.length)
  }
  return mapa
}

// ── Cobranças ──────────────────────────────────────────────────────────────

/**
 * Cancela no gateway as cobranças ainda abertas da inscrição. Devolve avisos
 * do que não deu para cancelar — quem chamou decide se mostra.
 */
export async function cancelarCobrancasAbertas(registrationId: number, motivo: string): Promise<string[]> {
  const reg = await prisma.enrollmentRegistration.findUnique({
    where: { id: registrationId },
    select: { portal: { select: { paymentConnection: { select: { provider: true, apiKey: true, publicKey: true, environment: true, active: true } } } } },
  })
  const conn = reg?.portal?.paymentConnection ?? null
  const abertas = await prisma.enrollmentPaymentMethod.findMany({ where: { registrationId, status: 'pending' } })
  const avisos: string[] = []
  if (abertas.length === 0) return avisos

  let chave: string | null = null
  if (conn) {
    const { decryptToken } = await import('./cloudApi.js')
    try { chave = decryptToken(conn.apiKey) } catch { chave = null }
  }

  for (const m of abertas) {
    if (m.externalId && m.provider === 'asaas') {
      const { cancelarCobrancaAsaas } = await import('./paymentAsaas.js')
      const r = chave && conn?.provider === 'asaas'
        ? await cancelarCobrancaAsaas({ apiKey: chave, environment: conn.environment === 'production' ? 'production' : 'sandbox' }, m.externalId)
        : { ok: false, message: 'conexão Asaas indisponível' }
      if (!r.ok) avisos.push(`Asaas ${m.externalId}: ${r.message} — cancele no painel do Asaas`)
    } else if (m.externalId && m.provider === 'iugu') {
      const { iuguDaConexao, cancelarFaturaIugu } = await import('./paymentIugu.js')
      const cfg = conn?.provider === 'iugu' ? iuguDaConexao(conn) : null
      const r = cfg ? await cancelarFaturaIugu(cfg, m.externalId) : { ok: false, message: 'conexão iugu indisponível' }
      if (!r.ok) avisos.push(`iugu ${m.externalId}: ${r.message} — cancele no painel da iugu`)
    } else if (m.externalId && m.provider !== 'simulado') {
      avisos.push(`${m.provider} ${m.externalId}: cancele no painel do gateway`)
    }
    await prisma.enrollmentPaymentMethod.update({ where: { id: m.id }, data: { status: 'failed', lastErrorMessage: motivo } })
  }
  await prisma.enrollmentRegistration.update({
    where: { id: registrationId },
    data: { paymentStatus: null, paymentId: null, paymentUrl: null, paymentExpiresAt: null },
  })
  return avisos
}

// ── Mesclar, desfazer, manter separadas ────────────────────────────────────

export interface Operador { userId?: number; nome?: string }

export async function mesclarInscricoes(input: {
  portalId: number
  principalId: number
  outrasIds: number[]
  operador: Operador
}): Promise<{ ok: true; mescladas: number; avisos: string[] } | { ok: false; erro: string }> {
  const outrasIds = [...new Set(input.outrasIds.filter((id) => id !== input.principalId))]
  if (outrasIds.length === 0) return { ok: false, erro: 'Escolha ao menos uma inscrição para mesclar na principal.' }

  const todas = await prisma.enrollmentRegistration.findMany({
    where: { id: { in: [input.principalId, ...outrasIds] } },
    select: { id: true, portalId: true, candidateCode: true, status: true, paymentStatus: true, leadId: true },
  })
  const principal = todas.find((r) => r.id === input.principalId)
  if (!principal || todas.length !== outrasIds.length + 1) return { ok: false, erro: 'Inscrição não encontrada.' }
  if (todas.some((r) => r.portalId !== input.portalId)) return { ok: false, erro: 'Só dá para mesclar inscrições do mesmo portal.' }
  if (todas.some((r) => r.status === 'merged')) return { ok: false, erro: 'Uma das inscrições já foi mesclada.' }
  const pagas = todas.filter((r) => r.id !== principal.id && ehPaga(r))
  if (pagas.length > 0) {
    return { ok: false, erro: `${pagas.map((r) => r.candidateCode).join(', ')} já tem pagamento confirmado e não pode ser descartada. Escolha-a como principal.` }
  }

  const avisos: string[] = []
  const tiposDaPrincipal = new Set(
    (await prisma.enrollmentDocument.findMany({ where: { registrationId: principal.id }, select: { typeCode: true } })).map((d) => d.typeCode),
  )

  for (const outra of todas.filter((r) => r.id !== principal.id)) {
    avisos.push(...await cancelarCobrancasAbertas(outra.id, `Cancelada ao mesclar em ${principal.candidateCode}`))

    // Documento que a principal ainda não tem passa para ela.
    const docs = await prisma.enrollmentDocument.findMany({ where: { registrationId: outra.id }, select: { id: true, typeCode: true } })
    for (const d of docs) {
      if (tiposDaPrincipal.has(d.typeCode)) continue
      await prisma.enrollmentDocument.update({ where: { id: d.id }, data: { registrationId: principal.id } })
      tiposDaPrincipal.add(d.typeCode)
    }

    await prisma.enrollmentRegistration.update({
      where: { id: outra.id },
      data: { status: 'merged', statusAntesDaMescla: outra.status, mergedIntoId: principal.id },
    })

    // Mesma pessoa: o lead da descartada vai para o da principal.
    if (outra.leadId && principal.leadId && outra.leadId !== principal.leadId) {
      const { mergeLeads } = await import('./dedup.js')
      try {
        await mergeLeads({ keepId: principal.leadId, mergeId: outra.leadId, operatorId: input.operador.userId, operatorName: input.operador.nome })
      } catch (e: any) {
        avisos.push(`Lead de ${outra.candidateCode} não foi mesclado: ${e?.message || e}`)
      }
    }
  }

  if (principal.leadId) {
    logEvent({
      leadId: principal.leadId,
      type: 'enrollment_merged',
      category: 'lifecycle',
      channel: 'portal',
      source: 'panel',
      actorType: 'operator',
      userId: input.operador.userId,
      userName: input.operador.nome,
      title: `Inscrições mescladas em ${principal.candidateCode}`,
      description: `${todas.filter((r) => r.id !== principal.id).map((r) => r.candidateCode).join(', ')} → ${principal.candidateCode}`,
      metadata: { principalId: principal.id, mescladas: outrasIds, avisos },
    })
  }
  return { ok: true, mescladas: outrasIds.length, avisos }
}

/**
 * Desfaz a mesclagem de UMA inscrição: volta ao status de antes. O que já foi
 * movido (documentos, lead mesclado) continua na principal — mesclar leads não
 * tem volta, e a tela diz isso.
 */
export async function desfazerMescla(registrationId: number, operador: Operador): Promise<{ ok: boolean; erro?: string }> {
  const r = await prisma.enrollmentRegistration.findUnique({
    where: { id: registrationId },
    select: { id: true, status: true, statusAntesDaMescla: true, candidateCode: true, leadId: true, mergedIntoId: true },
  })
  if (!r) return { ok: false, erro: 'Inscrição não encontrada.' }
  if (r.status !== 'merged') return { ok: false, erro: 'Esta inscrição não está mesclada.' }
  await prisma.enrollmentRegistration.update({
    where: { id: r.id },
    data: { status: r.statusAntesDaMescla || 'pending', statusAntesDaMescla: null, mergedIntoId: null, duplicataIgnorada: true },
  })
  // Desfazer é dizer "não são a mesma inscrição": a principal também sai do
  // aviso, senão o par voltaria a aparecer como duplicidade na hora.
  if (r.mergedIntoId) {
    await prisma.enrollmentRegistration.update({ where: { id: r.mergedIntoId }, data: { duplicataIgnorada: true } }).catch(() => {})
  }
  if (r.leadId) {
    logEvent({
      leadId: r.leadId, type: 'enrollment_unmerged', category: 'lifecycle', channel: 'portal', source: 'panel',
      actorType: 'operator', userId: operador.userId, userName: operador.nome,
      title: `Mesclagem desfeita: ${r.candidateCode}`,
    })
  }
  return { ok: true }
}

export async function manterSeparadas(portalId: number, ids: number[]): Promise<number> {
  const r = await prisma.enrollmentRegistration.updateMany({
    where: { portalId, id: { in: ids } },
    data: { duplicataIgnorada: true },
  })
  return r.count
}

// ── Envio: retomar a inscrição aberta ───────────────────────────────────────

/**
 * Inscrição ABERTA da mesma pessoa (CPF) no portal — ainda sem pagamento, não
 * cancelada nem mesclada. O envio a retoma em vez de criar outra. Paga não
 * entra: uma nova inscrição depois de pagar é outra matrícula.
 */
export async function inscricaoAbertaDoCpf(portalId: number, cpfBruto: string) {
  const cpf = normalizeCpf(cpfBruto)
  if (cpf.length !== 11) return null
  const candidatas = await prisma.enrollmentRegistration.findMany({
    // paymentStatus nulo (ainda sem cobrança) precisa entrar: NOT (x = 'paid')
    // em SQL descarta o NULL — e era justamente a inscrição recém-criada.
    where: { portalId, status: { in: STATUS_ABERTOS }, mergedIntoId: null, OR: [{ paymentStatus: null }, { paymentStatus: { not: 'paid' } }] },
    select: { id: true, candidateCode: true, leadId: true, formData: true, processRegistrationId: true, status: true, processRegistration: { select: { offeringId: true } } },
    orderBy: { createdAt: 'desc' },
    take: 2000,
  })
  return candidatas.find((r) => normalizeCpf(String((r.formData as any)?.cpf ?? '')) === cpf) ?? null
}
