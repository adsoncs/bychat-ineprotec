// services/isencaoPorCupom.ts
//
// Cupom que zera o valor (ex.: 100% para ex-aluno) não vira cobrança.
//
// Nenhum gateway emite fatura de R$ 0,00 — a iugu nem chega a ser chamada (o
// conector barra abaixo de R$ 1,00) e o Asaas exige valor mínimo. Antes disto o
// checkout tentava cobrar zero, falhava ("valor mínimo por cobrança é R$ 1,00")
// e a equipe acabava gerando a cobrança cheia, sem o cupom (fabad, 30/10/2026).
//
// Aqui a etapa de pagamento é dada como concluída por ISENÇÃO, com os mesmos
// efeitos de um pagamento confirmado (paymentSync.syncChargeFromProvider): baixa
// do cupom, conversão do portal, evento no histórico e confirmação ao candidato.
// A jornada (contrato, documentos, matrícula) lê `paymentStatus = 'paid'` e segue.

import { prisma } from '../lib/prisma.js'
import { logEvent } from './leadHistory.js'

export const PROVEDOR_ISENCAO = 'isencao'

export async function isentarPorCupom(input: {
  registrationId: number
  method: 'pix' | 'boleto' | 'credit_card'
  paymentPlan: Record<string, unknown>
}): Promise<{ ok: true; methodRow: any; jaEstavaPago: boolean } | { ok: false; erro: string }> {
  const cupom = typeof input.paymentPlan.cupom === 'string' ? input.paymentPlan.cupom : null
  // Só o cupom zera o valor: sem cupom aplicado, valor zero é erro de cadastro
  // (plano sem preço) e não pode virar matrícula gratuita.
  if (!cupom) return { ok: false, erro: 'Valor zerado sem cupom — confira o preço desta inscrição.' }

  const reg = await prisma.enrollmentRegistration.findUnique({
    where: { id: input.registrationId },
    select: { id: true, leadId: true, candidateCode: true, portalId: true, paymentStatus: true },
  })
  if (!reg) return { ok: false, erro: 'Inscrição não encontrada' }

  const agora = new Date()
  const externalId = `isencao-${reg.id}-${agora.getTime()}`
  const plano = { ...input.paymentPlan, valorCobrado: 0, isento: true, isencao: { cupom, em: agora.toISOString() } }

  // Uma transição só para "pago" (mesma régua do paymentSync): dois cliques
  // simultâneos não consomem o cupom duas vezes nem duplicam os efeitos.
  const r = await prisma.enrollmentRegistration.updateMany({
    where: { id: reg.id, OR: [{ paymentStatus: null }, { paymentStatus: { not: 'paid' } }] },
    data: {
      paymentStatus: 'paid',
      paymentPaidAt: agora,
      status: 'paid',
      paymentAmount: 0,
      paymentMethod: 'ISENTO',
      paymentId: externalId,
      paymentUrl: null,
      paymentExpiresAt: null,
      paymentPlan: plano as any,
    },
  })
  if (r.count === 0) {
    const atual = await prisma.enrollmentPaymentMethod.findFirst({ where: { registrationId: reg.id, status: 'paid' }, orderBy: { id: 'desc' } })
    return { ok: true, methodRow: atual, jaEstavaPago: true }
  }

  const methodRow = await prisma.enrollmentPaymentMethod.create({
    data: {
      registrationId: reg.id,
      provider: PROVEDOR_ISENCAO,
      method: input.method,
      externalId,
      status: 'paid',
      amount: 0,
      paidAt: agora,
      expiresAt: null,
    },
  })

  // Efeitos de pagamento confirmado — os mesmos do paymentSync.
  await import('./portalCupom.js').then((m) => m.consumirCupom(reg.id)).catch(() => {})
  await prisma.enrollmentPortal.update({ where: { id: reg.portalId }, data: { conversions: { increment: 1 } } }).catch(() => {})
  if (reg.leadId) {
    logEvent({
      leadId: reg.leadId,
      type: 'payment_received',
      category: 'lifecycle',
      title: `Isento pelo cupom ${cupom} — ${reg.candidateCode}`,
      description: 'Cupom de 100%: a etapa de pagamento foi concluída sem cobrança.',
      channel: 'payment',
      source: PROVEDOR_ISENCAO,
      actorType: 'system',
      metadata: { registrationId: reg.id, amount: 0, isento: true, cupom, paymentId: externalId },
    })
  }
  import('./enrollmentNotify.js').then((m) =>
    m.sendPaymentConfirmation?.({ enrollmentId: reg.id }).catch(() => {}),
  ).catch(() => {})

  return { ok: true, methodRow, jaEstavaPago: false }
}
