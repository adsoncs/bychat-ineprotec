// src/services/portalCupom.ts
//
// Cupom no checkout do portal.
//
// O módulo de cupons já existia com tudo — escopo por portal, teto, limite por
// CPF, snapshot no resgate — e nunca chegou ao checkout: três cupons cadastrados
// e zero resgates. Este serviço é a ponte que faltava.
//
// Três regras decididas com o cliente (09/09/2026):
//
//  1. Cupom e desconto à vista do PIX NÃO se somam: vale o maior dos dois, e a
//     tela diz qual venceu. Empilhar desconto é o jeito mais fácil de vender
//     mais barato do que se pretendia.
//  2. Quando o portal cobra o CURSO, o cupom incide sobre o total — é o que a
//     pessoa entende por "20% de desconto no curso", e o financeiro recebe o
//     contrato já abatido.
//  3. O cupom só é CONSUMIDO quando o pagamento é confirmado. Quem gera boleto
//     e some não queima cupom de campanha. Entre gerar e pagar, a cobrança
//     pendente vale como reserva (ver `reservados`).

import { prisma } from '../lib/prisma.js'

export interface CupomAplicado {
  code: string
  descricao: string | null
  /** Valor antes de qualquer desconto. */
  valorCheio: number
  descontoCupom: number
  /** Desconto à vista do PIX, para comparação. */
  descontoAVista: number
  /** O que efetivamente será cobrado. */
  valorFinal: number
  /** Qual regra venceu — é o que a tela mostra ao candidato. */
  origem: 'cupom' | 'a_vista' | 'nenhum'
}

export interface CupomRecusado {
  valido: false
  motivo: string
}

const normalizar = (s: unknown): string =>
  String(s || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 50)

const centavos = (v: number) => Math.round(v * 100) / 100

/** Desconto do cupom sobre um valor, respeitando o teto do tipo percentual. */
export function descontoDoCupom(cupom: { type: string; value: unknown; maxDiscount?: unknown }, valor: number): number {
  if (cupom.type === 'percent') {
    let d = (valor * Number(cupom.value)) / 100
    if (cupom.maxDiscount !== null && cupom.maxDiscount !== undefined) {
      d = Math.min(d, Number(cupom.maxDiscount))
    }
    return centavos(Math.min(d, valor))
  }
  return centavos(Math.min(Number(cupom.value), valor))
}

/**
 * Quantas cobranças pendentes já estão segurando este cupom.
 *
 * É a reserva: entre gerar a cobrança e pagar, o cupom fica separado para quem
 * o pegou. Como a conta olha só cobranças ainda dentro do prazo, a reserva se
 * desfaz sozinha quando a cobrança expira — sem job de limpeza e sem coluna
 * nova para manter em dia.
 */
async function reservados(code: string): Promise<number> {
  const linhas = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*) AS n
      FROM bychat_enrollment_registrations
     WHERE paymentStatus = 'pending'
       AND paymentExpiresAt > NOW()
       AND JSON_UNQUOTE(JSON_EXTRACT(paymentPlan, '$.cupom')) = ${code}
  `.catch(() => [{ n: BigInt(0) }])
  return Number(linhas[0]?.n ?? 0)
}

/**
 * Avalia um cupom para uma inscrição e devolve o que será cobrado.
 *
 * `descontoAVistaPct` é o desconto do PIX configurado no portal; entra na conta
 * porque o candidato leva o melhor dos dois, nunca os dois.
 */
export async function avaliarCupom(params: {
  codigo: string
  valor: number
  portalId: number
  cpf?: string | null
  descontoAVistaPct?: number
}): Promise<CupomAplicado | CupomRecusado> {
  const code = normalizar(params.codigo)
  const valor = Number(params.valor)
  if (code.length < 3) return { valido: false, motivo: 'Código inválido.' }
  if (!Number.isFinite(valor) || valor <= 0) return { valido: false, motivo: 'Valor inválido.' }

  const c = await prisma.coupon.findUnique({ where: { code } })
  if (!c) return { valido: false, motivo: 'Cupom não encontrado.' }
  if (!c.active) return { valido: false, motivo: 'Este cupom não está mais ativo.' }

  const agora = new Date()
  if (c.validFrom && c.validFrom > agora) return { valido: false, motivo: 'Este cupom ainda não começou a valer.' }
  if (c.validUntil && c.validUntil < agora) return { valido: false, motivo: 'Este cupom já expirou.' }

  if (c.minAmount && valor < Number(c.minAmount)) {
    return {
      valido: false,
      motivo: `Este cupom vale a partir de ${Number(c.minAmount).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.`,
    }
  }

  if (Array.isArray(c.portalIds) && (c.portalIds as unknown[]).length > 0) {
    if (!(c.portalIds as unknown[]).map(Number).includes(params.portalId)) {
      return { valido: false, motivo: 'Este cupom não vale para esta inscrição.' }
    }
  }

  // Estoque: o que já foi usado mais o que está reservado em cobrança aberta.
  if (c.usageLimit) {
    const emUso = c.usageCount + await reservados(code)
    if (emUso >= c.usageLimit) return { valido: false, motivo: 'Este cupom se esgotou.' }
  }

  // Limite por pessoa. Sem CPF não dá para saber de quem é, então o limite é
  // conferido de novo no momento de consumir, onde o CPF sempre existe.
  const cpf = String(params.cpf ?? '').replace(/\D/g, '')
  if (cpf && c.perUserLimit > 0) {
    const usos = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*) AS n
        FROM bychat_coupon_redemptions r
        JOIN bychat_enrollment_registrations e ON e.id = r.registrationId
       WHERE r.couponId = ${c.id}
         AND JSON_UNQUOTE(JSON_EXTRACT(e.formData, '$.cpf')) LIKE ${`%${cpf.slice(-9)}%`}
    `.catch(() => [{ n: BigInt(0) }])
    if (Number(usos[0]?.n ?? 0) >= c.perUserLimit) {
      return { valido: false, motivo: 'Você já usou este cupom.' }
    }
  }

  const descontoCupom = descontoDoCupom(c, valor)
  const pct = Math.max(0, Number(params.descontoAVistaPct ?? 0))
  const descontoAVista = pct > 0 ? centavos((valor * pct) / 100) : 0

  // Vale o maior — nunca os dois.
  const usaCupom = descontoCupom >= descontoAVista && descontoCupom > 0
  const desconto = usaCupom ? descontoCupom : descontoAVista

  return {
    code: c.code,
    descricao: c.description,
    valorCheio: centavos(valor),
    descontoCupom,
    descontoAVista,
    valorFinal: centavos(Math.max(0, valor - desconto)),
    origem: desconto <= 0 ? 'nenhum' : usaCupom ? 'cupom' : 'a_vista',
  }
}

/**
 * Consome o cupom de uma inscrição que acabou de ser paga.
 *
 * Idempotente pelo par (cupom, inscrição): reentrega de webhook e cron de
 * reconciliação passam por aqui, e cupom contado duas vezes some do estoque sem
 * ninguém ter usado. Nunca lança — falha de cupom não pode derrubar a baixa de
 * um pagamento que já entrou.
 */
export async function consumirCupom(registrationId: number): Promise<{ consumido: boolean; motivo?: string }> {
  try {
    const reg = await prisma.enrollmentRegistration.findUnique({
      where: { id: registrationId },
      select: { id: true, paymentPlan: true, paymentAmount: true },
    })
    const plano = (reg?.paymentPlan ?? {}) as Record<string, unknown>
    const code = normalizar(plano.cupom)
    if (!code) return { consumido: false, motivo: 'sem cupom' }

    const jaTem = await prisma.couponRedemption.findFirst({
      where: { registrationId, coupon: { code } },
      select: { id: true },
    })
    if (jaTem) return { consumido: false, motivo: 'já registrado' }

    const c = await prisma.coupon.findUnique({ where: { code } })
    if (!c) return { consumido: false, motivo: 'cupom não existe mais' }

    const antes = Number(plano.valorCheio ?? plano.valorTabela ?? reg?.paymentAmount ?? 0)
    const desconto = Number(plano.descontoCupom ?? 0)

    await prisma.couponRedemption.create({
      data: {
        couponId: c.id,
        registrationId,
        amountBefore: antes,
        discountValue: desconto,
        amountAfter: Math.max(0, antes - desconto),
        // Guarda como o cupom era no momento do uso: mudar a regra depois não
        // pode reescrever o que já aconteceu.
        couponSnapshot: {
          code: c.code, type: c.type, value: Number(c.value),
          maxDiscount: c.maxDiscount ? Number(c.maxDiscount) : null,
          description: c.description,
        },
      },
    })
    await prisma.coupon.update({ where: { id: c.id }, data: { usageCount: { increment: 1 } } })
    return { consumido: true }
  } catch (e: any) {
    console.warn('[portalCupom] falha ao consumir:', e?.message || e)
    return { consumido: false, motivo: 'erro' }
  }
}
