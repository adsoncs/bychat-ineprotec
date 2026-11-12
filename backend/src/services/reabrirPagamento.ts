// services/reabrirPagamento.ts — "Trocar plano / nova cobrança" (12/11/2026).
//
// Caso: aluna escolheu boleto 8x, não pagou, a inscrição virou "expirada" e a
// tela travou plano, valores e geração de cobrança. Pedido do cliente: a
// equipe tem que poder mudar o plano SEMPRE, enquanto nada foi pago.
//
// O que faz:
//   - cancela no gateway a(s) cobrança(s) em aberto, para o aluno não pagar o
//     plano antigo (cancelarCobrancasAbertas — o mesmo da troca de valor);
//   - inscrição expirada volta a "pendente": a aba Financeiro destrava;
//   - registra quem fez, quando e o motivo (inscrição e lead).
// Pagamento combinado tem a própria troca ("Alterar forma de pagamento"):
// aqui ele só destrava a inscrição, sem cancelar os títulos.

import { prisma } from '../lib/prisma.js'
import { logEvent } from './leadHistory.js'
import { registrarEventoDaInscricao } from './inscricaoAssistida.js'

const FECHADAS_DE_VEZ = ['cancelled', 'merged']

export async function estadoParaReabrir(registrationId: number) {
  const reg = await prisma.enrollmentRegistration.findUnique({
    where: { id: registrationId },
    select: { id: true, status: true, paymentStatus: true, paymentPaidAt: true, paymentPlan: true },
  })
  if (!reg) return null
  const combinado = !!(reg.paymentPlan as any)?.combinado
  const pago = reg.paymentStatus === 'paid' || !!reg.paymentPaidAt
  const abertas = await prisma.enrollmentPaymentMethod.findMany({
    where: { registrationId, status: 'pending' }, orderBy: { id: 'desc' },
    select: { id: true, method: true, amount: true, boletoDueAt: true, expiresAt: true, createdAt: true },
  })
  const expirada = reg.status === 'expired'
  const motivoNao = FECHADAS_DE_VEZ.includes(reg.status) ? 'Inscrição cancelada ou mesclada.'
    : pago ? 'O pagamento já foi feito: para mudar, use a transferência de curso ou a troca de forma de pagamento.'
      : !expirada && (combinado || !abertas.length) ? 'Nada travado: plano e cobrança já podem ser alterados.' : null
  return {
    pode: !motivoNao, motivoNao, status: reg.status, expirada, combinado,
    abertas: combinado ? [] : abertas.map((a) => ({
      meio: a.method, valor: Number(a.amount),
      vencimento: (a.boletoDueAt ?? a.expiresAt)?.toISOString() ?? null, criadaEm: a.createdAt.toISOString(),
    })),
  }
}

export async function reabrirPagamento(registrationId: number, body: any, op: { userId: number | null; nome: string | null; req?: any }):
  Promise<{ ok: true; avisos: string[]; canceladas: number } | { ok: false; status: number; erro: string }> {
  const motivo = String(body?.motivo ?? '').trim()
  if (motivo.length < 3) return { ok: false, status: 400, erro: 'Escreva o motivo (ex.: aluna quer mudar para 12x no cartão).' }
  const e = await estadoParaReabrir(registrationId)
  if (!e) return { ok: false, status: 404, erro: 'Inscrição não encontrada.' }
  if (!e.pode) return { ok: false, status: 409, erro: e.motivoNao! }

  const reg = await prisma.enrollmentRegistration.findUnique({ where: { id: registrationId }, select: { leadId: true, candidateCode: true } })
  let avisos: string[] = []
  const canceladas = e.abertas.length
  if (!e.combinado && canceladas) {
    const { cancelarCobrancasAbertas } = await import('./inscricaoDuplicada.js')
    avisos = await cancelarCobrancasAbertas(registrationId, `Troca de plano pelo atendimento: ${motivo}`).catch((x: any) => [String(x?.message || x)])
  }
  if (e.expirada) await prisma.enrollmentRegistration.update({ where: { id: registrationId }, data: { status: 'pending' } })

  const dados = { motivo, canceladas: e.abertas, estavaExpirada: e.expirada, ...(avisos.length ? { avisos } : {}) }
  await registrarEventoDaInscricao({
    registrationId, etapa: 'pagamento', acao: 'pagamento_reaberto', ator: 'atendente',
    userId: op.userId, userName: op.nome, req: op.req ?? null, dados,
  }).catch(() => {})
  if (reg?.leadId) {
    const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    logEvent({
      leadId: reg.leadId, type: 'note_added', category: 'operator', channel: 'payment', source: 'reabrir_pagamento',
      title: `Plano liberado para troca (${reg.candidateCode})${canceladas ? `: ${canceladas} cobrança(s) em aberto cancelada(s)` : ''}`,
      description: `${motivo}${e.abertas.length ? ` · cancelado: ${e.abertas.map((a) => `${a.meio} ${brl(a.valor)}`).join(', ')}` : ''}`,
      actorType: 'operator', userId: op.userId ?? undefined, userName: op.nome ?? undefined, metadata: dados,
    })
  }
  return { ok: true, avisos, canceladas }
}
