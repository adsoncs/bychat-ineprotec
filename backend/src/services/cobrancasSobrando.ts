// services/cobrancasSobrando.ts
//
// COBRANÇAS SOBRANDO NO ASAAS (23/11/2026). Cobrança em aberto no Asaas
// (aguardando ou vencida) que, pelo sistema, não vale mais nada: a inscrição
// foi apagada ou cancelada, o próprio sistema já deu a cobrança por cancelada,
// ou o aluno pagou por outra opção. Elas sujam o Asaas (e relatórios de "a
// receber") e ainda podem ser pagas por engano.
//
// O financeiro vê a lista na tela "Inadimplência e acordos" e exclui no Asaas.
// Duas certezas:
//   - 'limpar'   → o sistema tem certeza de que é sobra;
//   - 'conferir' → provável sobra (inscrição expirada sem pagamento, cobrança
//                  sem vínculo): decide quem conhece o caso.
// Cobrança legítima (parcela futura de quem pagou a entrada, cobrança atual de
// inscrição em andamento) não entra na lista. Na exclusão a situação é
// conferida de novo, no Asaas e no banco: só sai o que continua sendo sobra.

import { prisma } from '../lib/prisma.js'
import { marcaPorPortal, type MarcaDaUnidade } from '../lib/unidadesFinanceiro.js'
import { decryptToken } from './cloudApi.js'
import { cancelarNoGateway } from './pagamentoCombinado.js'
import { consultarClienteAsaas, consultarCobrancaAsaas, listarCobrancasAsaas, type AsaasConfig } from './paymentAsaas.js'
import { registrarEventoDaInscricao } from './inscricaoAssistida.js'

export type MotivoDaSobra =
  | 'inscricao_inexistente' | 'inscricao_encerrada' | 'cancelada_no_sistema' | 'outra_opcao_paga'
  | 'inscricao_expirada' | 'sem_vinculo'
export type Certeza = 'limpar' | 'conferir'

export interface Sobra {
  conexaoId: number
  conexao: string
  paymentId: string
  valor: number
  vencimento: string
  situacao: 'PENDING' | 'OVERDUE'
  meio: string
  descricao: string
  referencia: string | null
  invoiceUrl: string | null
  criadaEm: string | null
  registrationId: number | null
  portalId: number | null
  /** Unidade (empresa) do portal da inscrição, ou a única que usa esta conta do Asaas. */
  unidade?: MarcaDaUnidade | null
  codigo: string | null
  leadId: number | null
  nome: string | null
  motivo: MotivoDaSobra
  certeza: Certeza
  explicacao: string
}

export interface Operador { userId: number | null; nome: string }

const SITUACOES_ABERTAS = ['PENDING', 'OVERDUE'] as const
const PM_ENCERRADO = ['canceled', 'cancelled', 'failed', 'expired', 'refunded']
const TITULO_ENCERRADO = ['cancelada', 'substituida', 'renegociada']
const MEIO: Record<string, string> = { BOLETO: 'Boleto', PIX: 'Pix', CREDIT_CARD: 'Cartão', UNDEFINED: 'A escolher' }

interface Conexao { id: number; nome: string; cfg: AsaasConfig }

async function conexoesAsaas(): Promise<Conexao[]> {
  const lista = await prisma.paymentProviderConnection.findMany({ where: { provider: 'asaas', active: true }, select: { id: true, name: true, apiKey: true, environment: true } })
  const out: Conexao[] = []
  for (const c of lista) {
    try {
      out.push({ id: c.id, nome: c.name, cfg: { apiKey: decryptToken(c.apiKey), environment: c.environment === 'production' ? 'production' : 'sandbox' } })
    } catch { /* chave ilegível: a conexão fica de fora */ }
  }
  return out
}

/**
 * Contas do Asaas com a unidade (empresa) que as usa: a dos portais ligados a
 * ela (portal.paymentConnectionId). Conta usada por uma unidade só = marca dela;
 * compartilhada = sem marca, e cada linha fica com a unidade da sua inscrição.
 */
export async function conexoesAsaasComUnidade(): Promise<Array<Conexao & { unidade: MarcaDaUnidade | null; unidadeIds: number[] }>> {
  const portais = await prisma.enrollmentPortal.findMany({ select: { id: true, unitId: true, paymentConnectionId: true } })
  const marcas = await marcaPorPortal()
  return (await conexoesAsaas()).map((c) => {
    const unidadeIds = [...new Set(portais.filter((p) => p.paymentConnectionId === c.id).map((p) => p.unitId))]
    const um = unidadeIds.length === 1 ? portais.find((p) => p.paymentConnectionId === c.id) : undefined
    return { ...c, unidadeIds, unidade: um ? marcas.get(um.id) ?? null : null }
  })
}

/** Inscrição a que a cobrança se refere, pela referência externa. */
async function inscricaoDaReferencia(ref: string | null): Promise<{ regId: number | null; tituloId: number | null; aca: boolean; conhecida: boolean }> {
  const r = String(ref ?? '')
  let m = r.match(/^enrollment-(\d+)$/)
  if (m) return { regId: Number(m[1]), tituloId: null, aca: false, conhecida: true }
  m = r.match(/^portal-parcela:(\d+):\d+$/) ?? r.match(/^portal-restante:(\d+)$/)
  if (m) return { regId: Number(m[1]), tituloId: null, aca: false, conhecida: true }
  m = r.match(/^titulo-(\d+)$/)
  if (m) {
    const t = await prisma.enrollmentTitulo.findUnique({ where: { id: Number(m[1]) }, select: { registrationId: true } })
    return { regId: t?.registrationId ?? null, tituloId: Number(m[1]), aca: false, conhecida: true }
  }
  if (/^aca-parcela:\d+$/.test(r)) return { regId: null, tituloId: null, aca: true, conhecida: true }
  return { regId: null, tituloId: null, aca: false, conhecida: false }
}

/**
 * Decide se uma cobrança em aberto no Asaas é sobra. `null` = cobrança legítima
 * (ou que não é do módulo de matrículas): não aparece na lista.
 */
export async function classificar(p: any): Promise<Pick<Sobra, 'motivo' | 'certeza' | 'explicacao' | 'registrationId'> | null> {
  if (!p?.id || p.deleted || !SITUACOES_ABERTAS.includes(p.status)) return null
  const ref = await inscricaoDaReferencia(p.externalReference ?? null)
  if (ref.aca) {
    const parcela = await prisma.acaParcela.findFirst({ where: { asaasChargeId: p.id }, select: { situacao: true } }).catch(() => null)
    if (parcela && ['CANCELADA', 'RENEGOCIADA', 'PAGA'].includes(parcela.situacao)) {
      return { motivo: 'cancelada_no_sistema', certeza: 'limpar', registrationId: null, explicacao: `A parcela do acadêmico está ${parcela.situacao.toLowerCase()} no sistema.` }
    }
    return null
  }

  const pm = await prisma.enrollmentPaymentMethod.findFirst({ where: { externalId: p.id }, select: { id: true, status: true, registrationId: true } })
  const ti = await prisma.enrollmentTitulo.findFirst({
    where: { OR: [{ externalId: p.id }, ...(p.installment ? [{ installmentId: String(p.installment) }] : [])] },
    select: { id: true, status: true, registrationId: true },
  })
  const regId = ref.regId ?? pm?.registrationId ?? ti?.registrationId ?? null

  if (!ref.conhecida && !pm && !ti) {
    return { motivo: 'sem_vinculo', certeza: 'conferir', registrationId: null, explicacao: 'Cobrança criada fora do sistema (ou de outro módulo): não há inscrição ligada a ela. Confira antes de excluir.' }
  }
  const reg = regId
    ? await prisma.enrollmentRegistration.findUnique({ where: { id: regId }, select: { id: true, status: true, paymentStatus: true, paymentId: true, mergedIntoId: true } })
    : null
  if (!reg) {
    return { motivo: 'inscricao_inexistente', certeza: 'limpar', registrationId: null, explicacao: 'A inscrição desta cobrança foi apagada do sistema (teste ou duplicada).' }
  }
  if (pm && PM_ENCERRADO.includes(pm.status)) {
    return { motivo: 'cancelada_no_sistema', certeza: 'limpar', registrationId: reg.id, explicacao: 'O sistema já deu esta cobrança por cancelada (foi trocada por outra), mas ela continua aberta no Asaas.' }
  }
  if (ti && TITULO_ENCERRADO.includes(ti.status)) {
    return { motivo: 'cancelada_no_sistema', certeza: 'limpar', registrationId: reg.id, explicacao: `A parcela foi ${ti.status === 'substituida' ? 'substituída' : ti.status} no sistema, mas continua aberta no Asaas.` }
  }
  if (reg.mergedIntoId || reg.status === 'cancelled' || reg.status === 'transferred' || reg.status === 'merged') {
    const como = reg.mergedIntoId || reg.status === 'merged' ? 'juntada a outra' : reg.status === 'transferred' ? 'transferida para outro curso' : 'cancelada'
    return { motivo: 'inscricao_encerrada', certeza: 'limpar', registrationId: reg.id, explicacao: `A inscrição foi ${como}; esta cobrança não vale mais.` }
  }
  // Opção de pagamento que sobrou: o aluno pagou por outra cobrança. Não vale
  // para parcela do combinado nem parcela do portal (essas são o resto da dívida).
  if (pm && !ti && reg.paymentStatus === 'paid' && reg.paymentId !== p.id && /^enrollment-\d+$/.test(String(p.externalReference ?? ''))) {
    return { motivo: 'outra_opcao_paga', certeza: 'limpar', registrationId: reg.id, explicacao: 'O aluno já pagou a matrícula por outra cobrança; esta era uma opção que ficou para trás.' }
  }
  if (reg.status === 'expired' && reg.paymentStatus !== 'paid') {
    return { motivo: 'inscricao_expirada', certeza: 'conferir', registrationId: reg.id, explicacao: 'A inscrição expirou sem pagamento. Exclua se o aluno desistiu; mantenha se ainda está negociando.' }
  }
  return null
}

async function sobraDe(c: Conexao, p: any, cache: Map<string, string | null>): Promise<Sobra | null> {
  const k = await classificar(p)
  if (!k) return null
  const reg = k.registrationId
    ? await prisma.enrollmentRegistration.findUnique({ where: { id: k.registrationId }, select: { candidateCode: true, portalId: true, leadId: true, lead: { select: { nome: true } } } })
    : null
  let nome = reg?.lead?.nome ?? null
  if (!nome && p.customer) {
    if (!cache.has(p.customer)) {
      const cli = await consultarClienteAsaas(c.cfg, p.customer).catch(() => null)
      cache.set(p.customer, cli?.name ?? null)
    }
    nome = cache.get(p.customer) ?? null
  }
  return {
    conexaoId: c.id, conexao: c.nome, paymentId: p.id, valor: Number(p.value) || 0, vencimento: String(p.dueDate ?? ''),
    situacao: p.status, meio: MEIO[p.billingType] ?? String(p.billingType ?? ''), descricao: String(p.description ?? ''),
    referencia: p.externalReference ?? null, invoiceUrl: p.invoiceUrl ?? null, criadaEm: p.dateCreated ?? null,
    registrationId: k.registrationId, portalId: reg?.portalId ?? null, codigo: reg?.candidateCode ?? null, leadId: reg?.leadId ?? null, nome,
    motivo: k.motivo, certeza: k.certeza, explicacao: k.explicacao,
  }
}

/** Varre as cobranças em aberto de todas as contas Asaas e devolve as sobras. */
export async function listarSobras(unitId: number | null = null): Promise<{ sobras: Sobra[]; verificadas: number; falhas: string[] }> {
  let sobras: Sobra[] = []
  const falhas: string[] = []
  let verificadas = 0
  const marcas = await marcaPorPortal()
  const todas = await conexoesAsaasComUnidade()
  const marcaDaConta = (conexaoId: number) => todas.find((c) => c.id === conexaoId)?.unidade ?? null
  const conexoes = unitId ? todas.filter((c) => c.unidadeIds.includes(unitId)) : todas
  for (const c of conexoes) {
    const cache = new Map<string, string | null>()
    for (const status of SITUACOES_ABERTAS) {
      try {
        for (let offset = 0, voltas = 0; voltas < 50; voltas++) {
          const pagina = await listarCobrancasAsaas(c.cfg, { status, offset, limit: 100 })
          for (const p of pagina.data) {
            verificadas++
            const s = await sobraDe(c, p, cache)
            if (s) sobras.push(s)
          }
          if (!pagina.hasMore) break
          offset += 100
        }
      } catch (e: any) {
        falhas.push(`${c.nome}: ${String(e?.message || e)}`)
      }
    }
  }
  for (const x of sobras) x.unidade = (x.portalId ? marcas.get(x.portalId) : null) ?? marcaDaConta(x.conexaoId)
  // Conta compartilhada entre unidades: fica o que é desta (ou sem dono identificado).
  if (unitId) sobras = sobras.filter((x) => !x.unidade || x.unidade.id === unitId)
  sobras.sort((a, b) => (a.certeza === b.certeza ? a.vencimento.localeCompare(b.vencimento) : a.certeza === 'limpar' ? -1 : 1))
  return { sobras, verificadas, falhas }
}

/**
 * Exclui no Asaas as cobranças escolhidas. Cada uma é conferida de novo (no
 * Asaas e no banco) antes: se foi paga ou deixou de ser sobra, fica.
 */
export async function excluirSobras(itens: Array<{ conexaoId: number; paymentId: string }>, op: Operador) {
  const conexoes = new Map((await conexoesAsaas()).map((c) => [c.id, c]))
  const resultado: Array<{ paymentId: string; ok: boolean; mensagem?: string }> = []
  for (const it of itens.slice(0, 200)) {
    const c = conexoes.get(Number(it.conexaoId))
    const id = String(it.paymentId ?? '')
    if (!c || !/^pay_[A-Za-z0-9]+$/.test(id)) { resultado.push({ paymentId: id, ok: false, mensagem: 'Cobrança inválida.' }); continue }
    try {
      const p = await consultarCobrancaAsaas(c.cfg, id)
      const k = await classificar(p)
      if (!k) { resultado.push({ paymentId: id, ok: false, mensagem: p?.deleted ? 'Já estava excluída.' : 'Deixou de ser sobra (foi paga ou voltou a valer). Ficou como está.' }); continue }
      const r = await cancelarNoGateway(c.cfg, { externalId: id, installmentId: null, provider: 'asaas' })
      if (!r.ok) { resultado.push({ paymentId: id, ok: false, mensagem: r.message }); continue }
      await prisma.enrollmentPaymentMethod.updateMany({ where: { externalId: id, status: { notIn: ['paid', ...PM_ENCERRADO] } }, data: { status: 'canceled' } })
      await prisma.enrollmentTitulo.updateMany({ where: { externalId: id, status: { in: ['aberta', 'prevista', 'aguardando'] } }, data: { status: 'cancelada' } })
      if (k.registrationId) {
        await registrarEventoDaInscricao({
          registrationId: k.registrationId, etapa: 'pagamento', acao: 'cobranca_sobrando_excluida', ator: 'atendente', userId: op.userId, userName: op.nome,
          dados: { cobranca: id, valor: p.value ?? null, vencimento: p.dueDate ?? null, motivo: k.motivo },
        })
      }
      resultado.push({ paymentId: id, ok: true })
    } catch (e: any) {
      resultado.push({ paymentId: id, ok: false, mensagem: String(e?.message || e) })
    }
  }
  return { resultado, excluidas: resultado.filter((r) => r.ok).length }
}
