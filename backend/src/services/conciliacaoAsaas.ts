// src/services/conciliacaoAsaas.ts
//
// Conciliação por conta do Asaas (ineprotec, 24/11): o financeiro confere o
// extrato de cada empresa separado — INEPROTEC na conta 1, Matrícula EAD na 2.
// Para cada pagamento que ENTROU no Asaas no período, diz se o sistema também
// o tem como pago:
//
//   conciliado         → o sistema achou a cobrança e ela está paga;
//   aberto_no_sistema  → o Asaas recebeu, mas o sistema ainda mostra em aberto
//                        (aviso do Asaas perdido): é o que precisa de ação;
//   sem_vinculo        → dinheiro na conta que não é de nenhuma cobrança do
//                        sistema (criada à mão no Asaas, outro módulo).
//
// Só leitura: não dá baixa sozinho. A data é a do pagamento no Asaas
// (paymentDate, data pura — ver dataDoPagamento).

import { prisma } from '../lib/prisma.js'
import { marcaPorPortal, type MarcaDaUnidade } from '../lib/unidadesFinanceiro.js'
import { conexoesAsaasComUnidade } from './cobrancasSobrando.js'
import { consultarClienteAsaas, listarCobrancasAsaas } from './paymentAsaas.js'

export type SituacaoConciliacao = 'conciliado' | 'aberto_no_sistema' | 'sem_vinculo'

export interface LinhaConciliacao {
  paymentId: string
  data: string
  valor: number
  liquido: number
  meio: string
  descricao: string
  situacao: SituacaoConciliacao
  explicacao: string
  registrationId: number | null
  portalId: number | null
  codigo: string | null
  leadId: number | null
  nome: string | null
  invoiceUrl: string | null
}

export interface ContaConciliada {
  conexaoId: number
  conexao: string
  unidade: MarcaDaUnidade | null
  recebido: number
  liquido: number
  taxas: number
  pagamentos: number
  conciliados: number
  divergentes: number
  linhas: LinhaConciliacao[]
  falha: string | null
}

const RECEBIDOS = ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'] as const
const MEIO: Record<string, string> = { BOLETO: 'Boleto', PIX: 'Pix', CREDIT_CARD: 'Cartão', UNDEFINED: 'A escolher' }
const ehData = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

/** O que o sistema sabe desta cobrança do Asaas. */
export async function noSistema(p: any): Promise<{ situacao: SituacaoConciliacao; explicacao: string; registrationId: number | null }> {
  const id = String(p.id)
  const ref = String(p.externalReference ?? '')

  // Parcela do acadêmico (ERP).
  const aca = await prisma.acaParcela.findFirst({ where: { asaasChargeId: id }, select: { situacao: true } }).catch(() => null)
  if (aca) {
    return aca.situacao === 'PAGA'
      ? { situacao: 'conciliado', explicacao: 'Parcela do acadêmico paga.', registrationId: null }
      : { situacao: 'aberto_no_sistema', explicacao: `Parcela do acadêmico está ${String(aca.situacao).toLowerCase()} no sistema.`, registrationId: null }
  }

  // Título (pagamento combinado, acordo).
  const ti = await prisma.enrollmentTitulo.findFirst({
    where: { OR: [{ externalId: id }, ...(p.installment ? [{ installmentId: String(p.installment) }] : [])] },
    select: { status: true, registrationId: true, ordem: true },
  })
  if (ti) {
    return ti.status === 'paga'
      ? { situacao: 'conciliado', explicacao: `Título ${ti.ordem} pago.`, registrationId: ti.registrationId }
      : { situacao: 'aberto_no_sistema', explicacao: `O título ${ti.ordem} está "${ti.status}" no sistema.`, registrationId: ti.registrationId }
  }

  // Parcela gerada pelo aluno no Meu Portal (boleto parcelado).
  const mp = ref.match(/^portal-parcela:(\d+):(\d+)$/)
  if (mp) {
    const reg = await prisma.enrollmentRegistration.findUnique({ where: { id: Number(mp[1]) }, select: { id: true, paymentPlan: true } })
    const g = (reg?.paymentPlan as any)?.parcelasPortal?.[mp[2]!]
    if (reg && g?.id === id) {
      return g.situacao === 'paga'
        ? { situacao: 'conciliado', explicacao: `Parcela ${mp[2]} do Meu Portal paga.`, registrationId: reg.id }
        : { situacao: 'aberto_no_sistema', explicacao: `A parcela ${mp[2]} do Meu Portal ainda está em aberto no sistema.`, registrationId: reg.id }
    }
  }

  // 1ª cobrança da inscrição (taxa / matrícula).
  const pm = await prisma.enrollmentPaymentMethod.findFirst({ where: { externalId: id }, select: { status: true, registrationId: true } })
  const regPorRef = ref.match(/^enrollment-(\d+)$/)
  const regId = pm?.registrationId ?? (regPorRef ? Number(regPorRef[1]) : null)
  if (regId) {
    const reg = await prisma.enrollmentRegistration.findUnique({ where: { id: regId }, select: { id: true, paymentStatus: true, paymentId: true, mergedIntoId: true, candidateCode: true } })
    // Só a referência "enrollment-<id>" não basta: em outra base (ou depois de
    // apagar a inscrição) o número aponta para outra pessoa. Vale se a cobrança
    // está registrada na inscrição ou se a descrição traz o código dela.
    const confere = !!reg && (!!pm || reg.paymentId === id || String(p.description ?? '').includes(reg.candidateCode))
    if (reg && confere) {
      if (pm?.status === 'paid' || (reg.paymentId === id && reg.paymentStatus === 'paid')) {
        return { situacao: 'conciliado', explicacao: 'Matrícula / 1ª cobrança paga.', registrationId: reg.id }
      }
      return { situacao: 'aberto_no_sistema', explicacao: reg.paymentStatus === 'paid' ? 'A inscrição está paga por OUTRA cobrança: o aluno pagou duas vezes.' : 'O Asaas recebeu, mas a inscrição ainda está sem pagamento no sistema.', registrationId: reg.id }
    }
  }
  return { situacao: 'sem_vinculo', explicacao: 'Não é de nenhuma cobrança do sistema (criada direto no Asaas ou por outro módulo).', registrationId: null }
}

export async function conciliar(f: { de?: string; ate?: string; unitId?: number | null }): Promise<{ de: string; ate: string; contas: ContaConciliada[] }> {
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
  const ate = ehData(f.ate) ? f.ate! : hoje
  const de = ehData(f.de) ? f.de! : ate
  let conexoes = await conexoesAsaasComUnidade()
  if (f.unitId) conexoes = conexoes.filter((c) => c.unidadeIds.includes(f.unitId!))
  const marcas = await marcaPorPortal()
  const contas: ContaConciliada[] = []
  for (const c of conexoes) {
    const conta: ContaConciliada = { conexaoId: c.id, conexao: c.nome, unidade: c.unidade, recebido: 0, liquido: 0, taxas: 0, pagamentos: 0, conciliados: 0, divergentes: 0, linhas: [], falha: null }
    const vistos = new Set<string>()
    const clientes = new Map<string, string | null>()
    try {
      for (const status of RECEBIDOS) {
        for (let offset = 0, voltas = 0; voltas < 30; voltas++) {
          const pagina = await listarCobrancasAsaas(c.cfg, { status, 'paymentDate[ge]': de, 'paymentDate[le]': ate, offset, limit: 100 })
          for (const p of pagina.data) {
            if (!p?.id || p.deleted || vistos.has(p.id)) continue
            vistos.add(p.id)
            const k = await noSistema(p)
            const reg = k.registrationId
              ? await prisma.enrollmentRegistration.findUnique({ where: { id: k.registrationId }, select: { candidateCode: true, portalId: true, leadId: true, lead: { select: { nome: true } } } })
              : null
            // Conta compartilhada: a linha é da unidade do portal da inscrição.
            if (f.unitId && reg?.portalId && marcas.get(reg.portalId)?.id !== f.unitId) continue
            let nome = reg?.lead?.nome ?? null
            if (!nome && p.customer) {
              if (!clientes.has(p.customer)) clientes.set(p.customer, (await consultarClienteAsaas(c.cfg, p.customer).catch(() => null))?.name ?? null)
              nome = clientes.get(p.customer) ?? null
            }
            const valor = Number(p.value) || 0
            const liquido = Number(p.netValue ?? p.value) || 0
            conta.linhas.push({
              paymentId: p.id, data: String(p.paymentDate ?? p.clientPaymentDate ?? ''), valor, liquido,
              meio: MEIO[p.billingType] ?? String(p.billingType ?? ''), descricao: String(p.description ?? ''),
              situacao: k.situacao, explicacao: k.explicacao, registrationId: k.registrationId,
              portalId: reg?.portalId ?? null, codigo: reg?.candidateCode ?? null, leadId: reg?.leadId ?? null, nome,
              invoiceUrl: p.invoiceUrl ?? null,
            })
            conta.recebido += valor; conta.liquido += liquido; conta.pagamentos++
            if (k.situacao === 'conciliado') conta.conciliados++; else conta.divergentes++
          }
          if (!pagina.hasMore) break
          offset += 100
        }
      }
    } catch (e: any) {
      conta.falha = String(e?.message || e)
    }
    const r2 = (x: number) => Math.round(x * 100) / 100
    conta.recebido = r2(conta.recebido); conta.liquido = r2(conta.liquido); conta.taxas = r2(conta.recebido - conta.liquido)
    // Divergências primeiro: é o que o financeiro precisa tratar.
    const ordem: Record<SituacaoConciliacao, number> = { aberto_no_sistema: 0, sem_vinculo: 1, conciliado: 2 }
    conta.linhas.sort((a, b) => ordem[a.situacao] - ordem[b.situacao] || b.data.localeCompare(a.data))
    contas.push(conta)
  }
  return { de, ate, contas }
}
