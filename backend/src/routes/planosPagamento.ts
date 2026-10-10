// src/routes/planosPagamento.ts
//
// Educacional › Ofertas › Planos de pagamento: os planos que a instituição
// libera para cada oferta (services/planoFinanceiro). O candidato só vê os
// planos ativos, as opções e as formas que estiverem ligadas aqui.

import type { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware, adminOnly } from '../lib/auth.js'
import { lerRegrasDoPlano, type RegrasDoPlano } from '../services/planoFinanceiro.js'

/** Regras de um plano novo: só a entrada no Pix, parcelas cobradas pela plataforma. */
const REGRAS_PADRAO = {
  destino: 'attrae',
  entrada: { ativo: true, pix: { ativo: true, descontoPct: 0 } },
  integral: { ativo: false },
  pontualidade: { ativo: false, descontoPct: 0, diaLimite: 5 },
}

function paraTela(p: {
  id: number; nome: string; numParcelas: number; valorParcelaCentavos: number; taxaMatriculaCentavos: number
  diaVencimento: number; ativo: boolean; regras: unknown
}) {
  const matricula = p.taxaMatriculaCentavos > 0
  return {
    id: p.id,
    nome: p.nome,
    ativo: p.ativo,
    // Na tela, o plano é "N parcelas, a 1ª é a matrícula (ou a 1ª mensalidade)".
    totalParcelas: p.numParcelas + (matricula ? 1 : 0),
    primeira: matricula ? 'matricula' : 'mensalidade',
    valorParcela: p.valorParcelaCentavos / 100,
    valorMatricula: matricula ? p.taxaMatriculaCentavos / 100 : null,
    diaVencimento: p.diaVencimento,
    // Plano antigo do ERP (sem regras) aparece com as regras padrão, desligado
    // do portal até alguém salvar.
    regras: lerRegrasDoPlano(p.regras) ?? lerRegrasDoPlano(REGRAS_PADRAO)!,
    doPortal: lerRegrasDoPlano(p.regras) != null,
  }
}

function lerCorpo(b: any): { erro: string } | {
  nome: string; numParcelas: number; valorParcelaCentavos: number; taxaMatriculaCentavos: number
  diaVencimento: number; ativo: boolean; regras: RegrasDoPlano
} {
  const nome = String(b?.nome ?? '').trim().slice(0, 191)
  if (!nome) return { erro: 'Dê um nome ao plano (ex.: "Semestral — 6 parcelas").' }
  const total = Math.round(Number(b?.totalParcelas))
  if (!Number.isInteger(total) || total < 1 || total > 120) return { erro: 'Número de parcelas inválido (1 a 120).' }
  const valorParcela = Math.round(Number(b?.valorParcela) * 100)
  if (!Number.isFinite(valorParcela) || valorParcela <= 0) return { erro: 'Informe o valor da parcela.' }
  const matricula = b?.primeira === 'matricula'
  const valorMatricula = b?.valorMatricula != null && b.valorMatricula !== '' ? Math.round(Number(b.valorMatricula) * 100) : valorParcela
  if (matricula && (!Number.isFinite(valorMatricula) || valorMatricula <= 0)) return { erro: 'Informe o valor da matrícula.' }
  const diaVencimento = Math.round(Number(b?.diaVencimento ?? 10))
  if (!Number.isInteger(diaVencimento) || diaVencimento < 1 || diaVencimento > 28) return { erro: 'Dia de vencimento entre 1 e 28.' }
  const regras = lerRegrasDoPlano(b?.regras ?? REGRAS_PADRAO)
  if (!regras) return { erro: 'Regras do plano inválidas.' }
  if (!regras.entrada.ativo && !regras.integral.ativo) return { erro: 'Libere ao menos uma opção: pagar a entrada ou o curso completo.' }
  for (const [o, f] of [['entrada', regras.entrada], ['integral', regras.integral]] as const) {
    if (f.ativo && !f.pix.ativo && !f.boleto.ativo && !f.cartao.ativo && !f.boletoParcelado.ativo) {
      return { erro: `Ligue ao menos uma forma de pagamento em "${o === 'entrada' ? 'Pagar a entrada' : 'Pagar o curso completo'}".` }
    }
  }
  if (regras.pontualidade.ativo && regras.pontualidade.diaLimite >= diaVencimento) {
    return { erro: `O dia-limite do desconto de pontualidade precisa ser antes do vencimento (dia ${diaVencimento}).` }
  }
  return {
    nome,
    numParcelas: matricula ? total - 1 : total,
    valorParcelaCentavos: valorParcela,
    taxaMatriculaCentavos: matricula ? valorMatricula : 0,
    diaVencimento,
    ativo: b?.ativo !== false,
    regras,
  }
}

export async function planosPagamentoRoutes(app: FastifyInstance) {
  app.get('/api/admin/educacional/offerings/:id/planos-pagamento', { preHandler: [authMiddleware] }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const oferta = await prisma.courseOffering.findUnique({ where: { id }, select: { id: true } })
    if (!oferta) return reply.code(404).send({ error: 'Oferta não encontrada' })
    const planos = await prisma.acaPlanoPagamento.findMany({ where: { courseOfferingId: id }, orderBy: { id: 'asc' } })
    return { planos: planos.map(paraTela) }
  })

  app.post('/api/admin/educacional/offerings/:id/planos-pagamento', { preHandler: [adminOnly] }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const oferta = await prisma.courseOffering.findUnique({ where: { id }, select: { id: true } })
    if (!oferta) return reply.code(404).send({ error: 'Oferta não encontrada' })
    const d = lerCorpo(req.body)
    if ('erro' in d) return reply.code(400).send({ error: d.erro })
    const p = await prisma.acaPlanoPagamento.create({ data: { ...d, courseOfferingId: id, regras: d.regras as any } })
    return { plano: paraTela(p) }
  })

  app.put('/api/admin/educacional/planos-pagamento/:id', { preHandler: [adminOnly] }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const atual = await prisma.acaPlanoPagamento.findUnique({ where: { id }, select: { id: true } })
    if (!atual) return reply.code(404).send({ error: 'Plano não encontrado' })
    const d = lerCorpo(req.body)
    if ('erro' in d) return reply.code(400).send({ error: d.erro })
    // Contratos já gerados guardam as próprias parcelas: mudar o plano vale
    // para as próximas inscrições, não reescreve o que foi contratado.
    const p = await prisma.acaPlanoPagamento.update({ where: { id }, data: { ...d, regras: d.regras as any } })
    return { plano: paraTela(p) }
  })

  app.delete('/api/admin/educacional/planos-pagamento/:id', { preHandler: [adminOnly] }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const usado = await prisma.acaContrato.count({ where: { planoPagamentoId: id } })
    // Plano com contrato não some: desativa (deixa de aparecer no portal) e
    // continua valendo para quem já contratou.
    if (usado > 0) {
      await prisma.acaPlanoPagamento.update({ where: { id }, data: { ativo: false } })
      return { ok: true, desativado: true, motivo: `Usado em ${usado} contrato(s) — foi desativado em vez de excluído.` }
    }
    await prisma.acaPlanoPagamento.delete({ where: { id } }).catch(() => null)
    return { ok: true }
  })
}
