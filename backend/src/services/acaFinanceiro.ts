// src/services/acaFinanceiro.ts
// Módulo Acadêmico · P5 — Financeiro. A "verdade financeira" vive aqui
// (AcaContrato/AcaParcela em centavos). O Asaas é só o braço bancário (emite
// boleto/PIX e confirma por webhook), reusando services/paymentAsaas.ts e a
// PaymentProviderConnection existente. Idempotência via AcaIntegracaoEvento.

import { prisma } from '../lib/prisma.js'
import { calcularEncargos, getEncargosConfig } from './acaEncargos.js'
import {
  createOrFindAsaasCustomer, createAsaasPayment, fetchAsaasPixQr,
  ASAAS_STATUS_MAP, isAsaasPaymentEvent, type AsaasConfig, type AsaasWebhookPayload,
} from './paymentAsaas.js'

/** Config do Asaas a partir da conexão ativa (apiKey decifrada). null se não houver. */
export async function getAsaasConfig(): Promise<AsaasConfig | null> {
  const conn = await prisma.paymentProviderConnection.findFirst({ where: { provider: 'asaas', active: true }, orderBy: { id: 'desc' } })
  if (!conn) return null
  try {
    const { decryptToken } = await import('./cloudApi.js')
    return { apiKey: decryptToken(conn.apiKey), environment: conn.environment === 'production' ? 'production' : 'sandbox', billingType: 'UNDEFINED' }
  } catch { return null }
}

/** Vencimento de mensalidade N (1..) no dia `dia`, a partir do próximo mês. */
function vencimentoMensalidade(n: number, dia: number): Date {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth() + n, Math.min(dia, 28))
  return d
}

/**
 * Gera AcaContrato + AcaParcela a partir do PlanoPagamento da oferta da turma.
 * Idempotente (1 contrato por matrícula). Chamado ao EFETIVAR a matrícula.
 */
export async function gerarContratoEParcelas(matriculaId: number): Promise<{ contratoId: number; criadas: number } | { skip: true }> {
  const existe = await prisma.acaContrato.findUnique({ where: { matriculaId }, select: { id: true } })
  if (existe) return { skip: true }

  const mat = await prisma.acaMatricula.findUnique({ where: { id: matriculaId }, include: { turma: { select: { courseOfferingId: true } } } })
  if (!mat) throw new Error('Matrícula não encontrada')
  const offeringId = mat.turma.courseOfferingId
  if (!offeringId) throw new Error('Turma sem oferta vinculada — defina a oferta para gerar o financeiro.')
  const plano = await prisma.acaPlanoPagamento.findFirst({ where: { courseOfferingId: offeringId, ativo: true }, orderBy: { id: 'asc' } })
  if (!plano) throw new Error('Nenhum plano de pagamento ativo para esta oferta.')

  // desconto por bolsa ativa
  const bolsa = await prisma.acaBolsa.findFirst({ where: { alunoId: mat.alunoId, ativo: true } })
  const aplicaBolsa = (centavos: number): number => {
    if (!bolsa) return centavos
    if (bolsa.tipo === 'INTEGRAL') return 0
    if (bolsa.tipo === 'PERCENTUAL') return Math.round(centavos * (1 - bolsa.valor / 100))
    if (bolsa.tipo === 'VALOR') return Math.max(0, centavos - bolsa.valor)
    return centavos
  }

  const mensalidade = aplicaBolsa(plano.valorParcelaCentavos)
  const total = plano.taxaMatriculaCentavos + mensalidade * plano.numParcelas

  const contrato = await prisma.acaContrato.create({ data: {
    matriculaId, planoPagamentoId: plano.id, valorTotalCentavos: total,
    descontoCentavos: (plano.valorParcelaCentavos - mensalidade) * plano.numParcelas, bolsaId: bolsa?.id ?? null,
  } })

  const parcelas: any[] = []
  let nro = 1
  if (plano.taxaMatriculaCentavos > 0) {
    parcelas.push({ contratoId: contrato.id, nroParcela: nro++, tipo: 'MATRICULA', valorBrutoCentavos: plano.taxaMatriculaCentavos, dataVencimento: vencimentoMensalidade(0, plano.diaVencimento) })
  }
  for (let i = 1; i <= plano.numParcelas; i++) {
    parcelas.push({ contratoId: contrato.id, nroParcela: nro++, tipo: 'MENSALIDADE', valorBrutoCentavos: mensalidade, dataVencimento: vencimentoMensalidade(i, plano.diaVencimento) })
  }
  // Inserção em loop (convenção: sem createMany+skipDuplicates)
  for (const p of parcelas) await prisma.acaParcela.create({ data: p })

  return { contratoId: contrato.id, criadas: parcelas.length }
}

/** Cria a cobrança (boleto+PIX) no Asaas para uma parcela e guarda as referências. */
export async function criarCobrancaAsaas(parcelaId: number): Promise<{ ok: true; asaasChargeId: string } | { ok: false; error: string }> {
  const config = await getAsaasConfig()
  if (!config) return { ok: false, error: 'Nenhuma conexão Asaas ativa (Configurações › Pagamentos).' }
  const parcela = await prisma.acaParcela.findUnique({ where: { id: parcelaId }, include: { contrato: { include: { matricula: { include: { aluno: { include: { lead: true } } } } } } } })
  if (!parcela) return { ok: false, error: 'Parcela não encontrada' }
  if (parcela.asaasChargeId) return { ok: true, asaasChargeId: parcela.asaasChargeId }
  const aluno = parcela.contrato.matricula.aluno

  try {
    // 1) garante o customer (cacheia no contrato)
    let customerId = parcela.contrato.asaasCustomerId
    if (!customerId) {
      const cust = await createOrFindAsaasCustomer(config, { name: aluno.lead.nome, email: aluno.lead.email || undefined, cpfCnpj: aluno.cpf || undefined, phone: aluno.lead.whatsapp || undefined } as any)
      customerId = cust.id
      await prisma.acaContrato.update({ where: { id: parcela.contrato.id }, data: { asaasCustomerId: customerId } })
    }
    // 2) cria a cobrança — valor já com multa+juros se vencida (Fin-2)
    const enc = calcularEncargos(parcela, await getEncargosConfig())
    const pay = await createAsaasPayment(config, {
      customerId, value: enc.valorCobranca / 100, dueDate: parcela.dataVencimento,
      description: `${parcela.tipo} ${parcela.nroParcela} — RA ${aluno.ra}${enc.vencida ? ' (atualizado)' : ''}`, externalReference: `aca-parcela:${parcelaId}`,
    })
    // 3) PIX copia-e-cola (best-effort)
    let pix: string | null = null
    try { const q = await fetchAsaasPixQr(config, pay.id); pix = q?.payload || null } catch { /* */ }
    await prisma.acaParcela.update({ where: { id: parcelaId }, data: { asaasChargeId: pay.id, linhaDigitavel: pay.bankSlipUrl || pay.invoiceUrl || null, pixCopiaCola: pix } })
    await prisma.acaIntegracaoEvento.create({ data: { origem: 'ASAAS_COBRANCA', eventoExternoId: pay.id, status: 'SUCESSO', responseJson: { invoiceUrl: pay.invoiceUrl } as any } }).catch(() => {})
    return { ok: true, asaasChargeId: pay.id }
  } catch (e: any) {
    return { ok: false, error: e.message || 'Falha ao criar cobrança no Asaas' }
  }
}

/** Baixa manual de uma parcela (sem gateway). valorPago já considera encargos/desconto (Fin-2). */
export async function darBaixaManual(parcelaId: number): Promise<void> {
  const p = await prisma.acaParcela.findUnique({ where: { id: parcelaId }, select: { id: true, valorBrutoCentavos: true, dataVencimento: true, situacao: true, contratoId: true } })
  if (!p) throw new Error('Parcela não encontrada')
  const enc = calcularEncargos(p, await getEncargosConfig())
  await prisma.acaParcela.update({ where: { id: parcelaId }, data: { situacao: 'PAGA', valorPagoCentavos: enc.valorAtual, pagoEm: new Date() } })
  await quitarSeCompleto(p.contratoId)
}

/** Processa um evento de pagamento do Asaas (webhook) — IDEMPOTENTE. */
export async function processarWebhookAsaas(payload: AsaasWebhookPayload): Promise<{ ok: boolean; baixou?: boolean; motivo?: string }> {
  if (!payload?.event || !isAsaasPaymentEvent(payload.event) || !payload.payment?.id) return { ok: true, motivo: 'ignorado' }
  const eventoExternoId = `${payload.payment.id}:${payload.event}`
  // idempotência: já processado?
  const dup = await prisma.acaIntegracaoEvento.findUnique({ where: { origem_eventoExternoId: { origem: 'ASAAS_WEBHOOK', eventoExternoId } }, select: { id: true } })
  if (dup) return { ok: true, motivo: 'duplicado' }
  await prisma.acaIntegracaoEvento.create({ data: { origem: 'ASAAS_WEBHOOK', eventoExternoId, status: 'PENDENTE', requestJson: payload as any } })

  const interno = ASAAS_STATUS_MAP[payload.event] || payload.event
  const pago = ['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'PAYMENT_RECEIVED_IN_CASH'].includes(payload.event)
  const parcela = await prisma.acaParcela.findFirst({ where: { asaasChargeId: payload.payment.id }, select: { id: true, valorBrutoCentavos: true, contratoId: true } })
  let baixou = false
  if (parcela && pago) {
    await prisma.acaParcela.update({ where: { id: parcela.id }, data: { situacao: 'PAGA', valorPagoCentavos: parcela.valorBrutoCentavos, pagoEm: payload.payment.paymentDate ? new Date(payload.payment.paymentDate) : new Date() } })
    await quitarSeCompleto(parcela.contratoId)
    baixou = true
  } else if (parcela && payload.event === 'PAYMENT_OVERDUE') {
    await prisma.acaParcela.update({ where: { id: parcela.id }, data: { situacao: 'VENCIDA' } })
  }
  await prisma.acaIntegracaoEvento.updateMany({ where: { origem: 'ASAAS_WEBHOOK', eventoExternoId }, data: { status: 'SUCESSO', responseJson: { interno, baixou } as any } })
  return { ok: true, baixou }
}

/** Marca o contrato como QUITADO quando todas as parcelas estão pagas/canceladas. */
async function quitarSeCompleto(contratoId: number): Promise<void> {
  const abertas = await prisma.acaParcela.count({ where: { contratoId, situacao: { in: ['ABERTA', 'VENCIDA'] } } })
  if (abertas === 0) await prisma.acaContrato.update({ where: { id: contratoId }, data: { status: 'QUITADO' } }).catch(() => {})
}
