// services/valorPersonalizado.ts
//
// VALOR PERSONALIZADO (04/11/2026) — matrícula interna pelo painel.
//
// No atendimento (inscricaoAssistida), o agente com a permissão "Valor
// personalizado" troca a matrícula e a mensalidade do plano escolhido. Sem teto:
// pode ficar abaixo ou acima da tabela. A troca é gravada na inscrição
// (condicaoNegociada) e aplicada sobre o plano em services/planoFinanceiro,
// então a tela, a cobrança, o contrato e as parcelas fazem a conta de sempre:
// desconto do Pix/boleto à vista e de pontualidade incidem sobre o combinado.
//
// O candidato vê só o valor final — nada aqui chega à resposta dele.
// Depois do pagamento a condição trava (as parcelas já nasceram dela).

import type { FastifyRequest } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { atendenteDe, registrarEventoDaInscricao } from './inscricaoAssistida.js'
import {
  condicaoNegociadaDaInscricao, planoPorId, planosDaOferta, totalDeParcelas,
  type CondicaoNegociada, type PlanoDaOferta,
} from './planoFinanceiro.js'

/** O agente desta requisição pode personalizar valores? null = não é atendimento. */
export async function podeValorPersonalizado(req: FastifyRequest): Promise<{ pode: boolean; userId: number; nome: string } | null> {
  const at = atendenteDe(req)
  if (!at) return null
  const u = await prisma.user.findUnique({ where: { id: at.userId }, select: { role: true } }).catch(() => null)
  if (!u) return { pode: false, userId: at.userId, nome: at.nome }
  if (u.role === 'SUPERADMIN') return { pode: true, userId: at.userId, nome: at.nome }
  const { resolvePermissions } = await import('../lib/permissions.js')
  const perms = await resolvePermissions(at.userId, u.role).catch(() => ({} as any))
  return { pode: !!perms.edu_valor_personalizado?.canEdit, userId: at.userId, nome: at.nome }
}

const reais = (c: number) => Math.round(c) / 100

/** O que a tela do agente mostra sobre o plano em tela (nunca vai ao candidato). */
export async function negociacaoParaAtendimento(req: FastifyRequest, registrationId: number, planoId: number | null | undefined) {
  const quem = await podeValorPersonalizado(req)
  if (!quem) return null
  const atual = await condicaoNegociadaDaInscricao(registrationId)
  const tabela = planoId ? await planoPorId(planoId) : null
  return {
    pode: quem.pode,
    plano: tabela ? {
      id: tabela.id,
      nome: tabela.nome,
      temMatricula: tabela.taxaMatriculaCentavos > 0,
      temMensalidade: tabela.numParcelas > 0,
      totalParcelas: totalDeParcelas(tabela),
      matricula: reais(tabela.taxaMatriculaCentavos),
      mensalidade: reais(tabela.valorParcelaCentavos),
      // Preço próprio por forma (ex.: boleto parcelado mais caro que o cartão):
      // com valor personalizado, todas as formas passam a sair do combinado.
      precoPorForma: [tabela.regras.entrada, tabela.regras.integral].some((f) =>
        [f.pix, f.boleto, f.cartao, f.boletoParcelado].some((x) => x.valorBase !== null)),
    } : null,
    atual: atual ? {
      planoId: atual.planoId,
      matricula: reais(atual.taxaMatriculaCentavos),
      mensalidade: reais(atual.valorParcelaCentavos),
      tabela: { matricula: reais(atual.tabela.taxaMatriculaCentavos), mensalidade: reais(atual.tabela.valorParcelaCentavos) },
      motivo: atual.motivo,
      por: atual.porNome,
      em: atual.em,
    } : null,
  }
}

function lerReais(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  // "1.234,56" e "199,90" (com vírgula: ponto é milhar) ou "199.90" (sem vírgula).
  const t = String(v).trim().replace(/[R$\s]/g, '')
  const n = typeof v === 'number' ? v : Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100)
}

type Resultado = { ok: true; condicao: CondicaoNegociada | null; avisos: string[] } | { ok: false; status: number; erro: string }

async function inscricaoParaMudar(registrationId: number) {
  const reg = await prisma.enrollmentRegistration.findUnique({
    where: { id: registrationId },
    select: {
      id: true, paymentStatus: true, paymentPaidAt: true, condicaoNegociada: true,
      processRegistration: { select: { offeringId: true } },
    },
  })
  if (!reg) return { erro: { ok: false as const, status: 404, erro: 'Inscrição não encontrada.' } }
  if (reg.paymentStatus === 'paid' || reg.paymentPaidAt) {
    return { erro: { ok: false as const, status: 409, erro: 'O pagamento desta inscrição já foi feito: o valor não pode mais ser alterado por aqui.' } }
  }
  return { reg }
}

/** Uma cobrança aberta foi gerada com o valor antigo: cancela para não ser paga. */
async function cancelarAbertas(registrationId: number): Promise<string[]> {
  const abertas = await prisma.enrollmentPaymentMethod.count({ where: { registrationId, status: 'pending' } })
  if (!abertas) return []
  const { cancelarCobrancasAbertas } = await import('./inscricaoDuplicada.js')
  const avisos = await cancelarCobrancasAbertas(registrationId, 'Valor personalizado pelo atendimento').catch((e: any) => [String(e?.message || e)])
  return [`A cobrança aberta com o valor anterior foi cancelada (${abertas}). Gere a nova cobrança.`, ...avisos]
}

export async function salvarValorPersonalizado(req: FastifyRequest, registrationId: number, body: any): Promise<Resultado> {
  const quem = await podeValorPersonalizado(req)
  if (!quem) return { ok: false, status: 403, erro: 'Valor personalizado só existe no atendimento pelo painel.' }
  if (!quem.pode) return { ok: false, status: 403, erro: 'Seu perfil não pode personalizar valores (permissão "Valor personalizado").' }

  const x = await inscricaoParaMudar(registrationId)
  if ('erro' in x) return x.erro!
  const { reg } = x

  const planoId = Number(body?.planoId)
  const planos: PlanoDaOferta[] = await planosDaOferta(reg.processRegistration?.offeringId)
  const plano = planos.find((p) => p.id === planoId)
  if (!plano) return { ok: false, status: 400, erro: 'Escolha um plano de pagamento desta oferta.' }

  const motivo = String(body?.motivo ?? '').trim()
  if (motivo.length < 3) return { ok: false, status: 400, erro: 'Informe o motivo do valor personalizado.' }

  const matricula = plano.taxaMatriculaCentavos > 0 ? lerReais(body?.matricula) : 0
  const mensalidade = plano.numParcelas > 0 || plano.taxaMatriculaCentavos === 0 ? lerReais(body?.mensalidade) : plano.valorParcelaCentavos
  if (plano.taxaMatriculaCentavos > 0 && (matricula === null || matricula <= 0)) {
    return { ok: false, status: 400, erro: 'Informe o valor da matrícula (maior que zero). Para isentar, use um cupom de 100%.' }
  }
  if (mensalidade === null || mensalidade <= 0) return { ok: false, status: 400, erro: 'Informe o valor da mensalidade (maior que zero).' }
  if (matricula === plano.taxaMatriculaCentavos && mensalidade === plano.valorParcelaCentavos) {
    return { ok: false, status: 400, erro: 'Os valores são iguais aos da tabela. Para voltar à tabela, use "Voltar ao valor da tabela".' }
  }

  const condicao: CondicaoNegociada = {
    planoId: plano.id,
    taxaMatriculaCentavos: matricula ?? 0,
    valorParcelaCentavos: mensalidade,
    tabela: { taxaMatriculaCentavos: plano.taxaMatriculaCentavos, valorParcelaCentavos: plano.valorParcelaCentavos },
    motivo: motivo.slice(0, 500),
    porUserId: quem.userId,
    porNome: quem.nome,
    em: new Date().toISOString(),
  }
  await prisma.enrollmentRegistration.update({ where: { id: reg.id }, data: { condicaoNegociada: condicao as any } })
  const avisos = await cancelarAbertas(reg.id)
  await registrarEventoDaInscricao({
    registrationId: reg.id, etapa: 'pagamento', acao: 'valor_personalizado', ator: 'atendente',
    userId: quem.userId, userName: quem.nome, req,
    dados: {
      plano: plano.nome,
      matricula: reais(condicao.taxaMatriculaCentavos), mensalidade: reais(condicao.valorParcelaCentavos),
      tabelaMatricula: reais(plano.taxaMatriculaCentavos), tabelaMensalidade: reais(plano.valorParcelaCentavos),
      motivo: condicao.motivo,
    },
  })
  return { ok: true, condicao, avisos }
}

export async function removerValorPersonalizado(req: FastifyRequest, registrationId: number): Promise<Resultado> {
  const quem = await podeValorPersonalizado(req)
  if (!quem) return { ok: false, status: 403, erro: 'Valor personalizado só existe no atendimento pelo painel.' }
  if (!quem.pode) return { ok: false, status: 403, erro: 'Seu perfil não pode personalizar valores (permissão "Valor personalizado").' }
  const x = await inscricaoParaMudar(registrationId)
  if ('erro' in x) return x.erro!
  if (!x.reg.condicaoNegociada) return { ok: true, condicao: null, avisos: [] }
  await prisma.enrollmentRegistration.update({ where: { id: x.reg.id }, data: { condicaoNegociada: null as any } })
  const avisos = await cancelarAbertas(x.reg.id)
  await registrarEventoDaInscricao({
    registrationId: x.reg.id, etapa: 'pagamento', acao: 'valor_personalizado_removido', ator: 'atendente',
    userId: quem.userId, userName: quem.nome, req, dados: null,
  })
  return { ok: true, condicao: null, avisos }
}
