// src/services/propostaDaInscricao.ts
//
// Fase 2 da integração Negociações/Metas/Comissões × Educacional (22/10/2026):
// a inscrição do portal vira PROPOSTA, e a proposta ganha conta em metas e
// comissões pelo motor de sempre (services/commissions.ts).
//
// Decisões do cliente (22/10):
//   - marco da venda POR PORTAL: 'pagamento' (1ª cobrança paga) ou 'jornada'
//     (todas as etapas do portal concluídas);
//   - valor = SÓ o que foi pago (entrada / curso à vista / taxa) — parcelas
//     futuras e as do SEI ficam fora;
//   - vendedor = responsável da ficha NO MOMENTO da inscrição
//     (EnrollmentRegistration.vendedorUserId, Fase 1); comissão vai à pessoa,
//     seja da sede, de polo ou de parceiro.
//
// Configuração por portal em Setting `comercial.portais` =
//   { "<portalId>": { modo: 'desligado'|'ativo', marco: 'pagamento'|'jornada' } }.
// Desligado = nada acontece. A SIMULAÇÃO (simularPortal) roda a mesma decisão
// sem gravar — é o "modo sombra" para conferir antes de ligar.
//
// Uma inscrição tem no máximo UMA proposta (Negotiation.registrationId). Se o
// lead já tem proposta MANUAL aberta do mesmo curso, ela é ADOTADA (ligada) em
// vez de criar outra. Tudo idempotente: rodar de novo não duplica nada.

import { prisma } from '../lib/prisma.js'

// 'assinatura' (09/11/2026): pagamento + contrato aceito ou assinado — a mesma regra do
// Ganho do lead e da liberação do Moodle. Documento não conta.
export type MarcoDaVenda = 'pagamento' | 'jornada' | 'assinatura'
export interface ConfigComercial { modo: 'desligado' | 'ativo'; marco: MarcoDaVenda }
const CHAVE = 'comercial.portais'
const PADRAO: ConfigComercial = { modo: 'desligado', marco: 'pagamento' }

let cache: { valor: Record<string, ConfigComercial>; ate: number } | null = null
export async function configsComerciais(): Promise<Record<string, ConfigComercial>> {
  if (cache && cache.ate > Date.now()) return cache.valor
  const s = await prisma.setting.findUnique({ where: { key: CHAVE }, select: { value: true } }).catch(() => null)
  let v: any = s?.value ?? {}
  if (typeof v === 'string') { try { v = JSON.parse(v) } catch { v = {} } }
  cache = { valor: v && typeof v === 'object' ? v : {}, ate: Date.now() + 30_000 }
  return cache.valor
}
export async function configDoPortal(portalId: number): Promise<ConfigComercial> {
  const c = (await configsComerciais())[String(portalId)]
  return {
    modo: c?.modo === 'ativo' ? 'ativo' : 'desligado',
    marco: c?.marco === 'jornada' || c?.marco === 'assinatura' ? c.marco : 'pagamento',
  }
}
export async function salvarConfigDoPortal(portalId: number, c: Partial<ConfigComercial>): Promise<ConfigComercial> {
  const todas = { ...(await configsComerciais()) }
  const atual = await configDoPortal(portalId)
  todas[String(portalId)] = {
    modo: c.modo === 'ativo' || c.modo === 'desligado' ? c.modo : atual.modo,
    marco: c.marco === 'jornada' || c.marco === 'pagamento' || c.marco === 'assinatura' ? c.marco : atual.marco,
  }
  await prisma.setting.upsert({
    where: { key: CHAVE },
    create: { key: CHAVE, value: todas as any, label: 'Comercial: inscrição do portal → proposta (por portal)', grp: 'educacional', fieldType: 'json' } as any,
    update: { value: todas as any },
  })
  cache = null
  return todas[String(portalId)]!
}

const ABERTA_INSC = ['cancelled', 'rejected', 'merged', 'expired']

/** Situação da inscrição que decide o que fazer com a proposta. */
async function situacao(registrationId: number) {
  const reg = await prisma.enrollmentRegistration.findUnique({
    where: { id: registrationId },
    select: {
      id: true, candidateCode: true, portalId: true, leadId: true, status: true, mergedIntoId: true,
      paymentStatus: true, paymentAmount: true, paymentPaidAt: true, paymentPlan: true, vendedorUserId: true, condicaoNegociada: true, formData: true, contratoAceite: true,
      portal: { select: { funnelId: true, nome: true } },
      lead: { select: { assignedUserId: true, funnelId: true } },
      processRegistration: { select: { offeringId: true, offering: { select: { courseId: true, nome: true, course: { select: { nome: true } } } } } },
    },
  })
  if (!reg || !reg.leadId) return null
  const curso = reg.processRegistration?.offering?.course?.nome || reg.processRegistration?.offering?.nome || 'Inscrição'
  const pago = reg.paymentStatus === 'paid'
  const estornado = reg.paymentStatus === 'refunded'
  const cancelada = ABERTA_INSC.includes(reg.status) || !!reg.mergedIntoId
  const valor = await valorDaVenda(reg)
  const fechamento = pago ? await fechamentoDaVenda(reg.id) : null
  return { reg, curso, pago, estornado, cancelada, valor, fechamento }
}

const FORMA: Record<string, 'boleto' | 'cartao' | 'pix'> = { boleto: 'boleto', pix: 'pix', credit_card: 'cartao', cartao: 'cartao', debit_card: 'cartao' }

/**
 * Data e forma da venda (07/11/2026, decisões do usuário): o dia em que a FATURA
 * paga foi criada, e não o dia do pagamento; a forma é COMO foi pago (boleto pago
 * pelo Pix do próprio boleto conta como Pix). É ela que define a taxa da comissão
 * no Painel Gerencial.
 */
export async function fechamentoDaVenda(registrationId: number): Promise<{ data: Date; forma: 'boleto' | 'cartao' | 'pix' | null } | null> {
  const reg = await prisma.enrollmentRegistration.findUnique({ where: { id: registrationId }, select: { paymentPaidAt: true, paymentPlan: true, paymentMethod: true, formData: true } })
  if (!reg) return null
  // Transferência de curso: a venda continua sendo a original (data e forma da fatura de lá).
  const tr = (reg.formData as any)?._transferencia?.fechamento
  if (tr?.data) return { data: new Date(tr.data), forma: tr.forma ?? null }
  const pp: any = reg.paymentPlan || {}
  const titulo = await prisma.enrollmentTitulo.findFirst({ where: { registrationId, status: 'paga' }, orderBy: [{ paidAt: 'asc' }, { ordem: 'asc' }], select: { createdAt: true, meio: true, pagoComo: true } })
  if (titulo) return { data: titulo.createdAt, forma: FORMA[String(titulo.pagoComo)] ?? FORMA[titulo.meio] ?? null }
  // O aviso do Asaas grava em paymentMethod o meio usado no pagamento (PIX num boleto).
  const pagoComo = FORMA[String(reg.paymentMethod ?? '').toLowerCase()]
  const cobranca = await prisma.enrollmentPaymentMethod.findFirst({ where: { registrationId, status: 'paid' }, orderBy: [{ paidAt: 'asc' }, { id: 'asc' }], select: { createdAt: true, method: true } })
  if (cobranca) return { data: cobranca.createdAt, forma: pagoComo ?? FORMA[cobranca.method] ?? FORMA[String(pp.meio)] ?? null }
  return reg.paymentPaidAt ? { data: reg.paymentPaidAt, forma: pagoComo ?? FORMA[String(pp.meio)] ?? null } : null
}

/**
 * Valor da proposta = a VENDA inteira (07/11/2026, decisão do usuário): a venda
 * parcelada (cartão, boleto parcelado, combinado) conta pelo total, e quem ainda
 * não pagou já entra com o valor do curso.
 *   - pagamento combinado: o total combinado;
 *   - curso completo (à vista, cartão ou boleto parcelado): o total da opção paga;
 *   - "só a 1ª parcela" ou ainda sem pagamento: o curso pelo plano, com o valor combinado;
 *   - sem plano: o valor combinado à mão, senão o que foi cobrado.
 */
async function valorDaVenda(reg: { paymentAmount: unknown; paymentPlan: unknown; condicaoNegociada: unknown; formData?: unknown; processRegistration: { offeringId: number | null } | null }): Promise<number> {
  // Transferência de curso: a venda é o curso novo pela tabela (o crédito é dinheiro já recebido).
  const tr = (reg.formData as any)?._transferencia
  if (Number(tr?.valorCursoCentavos) > 0) return Number(tr.valorCursoCentavos) / 100
  const pp: any = reg.paymentPlan || {}
  const total = Number(pp.valorTotal) || 0
  if (pp.combinado && total > 0) return total
  if (pp.planoFinanceiro?.opcao === 'integral' && total > 0) return total
  // Baixa manual sem o total do checkout (ex.: 1ª parcela ou crédito de outro curso):
  // a venda é o que o contrato diz — o plano negociado mais o que já foi pago.
  if (pp.pagamentoManual && !(total > 0) && reg.processRegistration?.offeringId && (reg as any).id) {
    const { condicaoDoContrato } = await import('./planoFinanceiro.js')
    const c = await condicaoDoContrato(reg.processRegistration.offeringId, reg.paymentPlan, (reg as any).id).catch(() => null)
    if (c && c.valorTotalCentavos > 0) return c.valorTotalCentavos / 100
  }
  const curso = await valorDoCurso(reg)
  if (curso > 0) return curso
  return Number(reg.paymentAmount ?? pp.valorCobrado ?? 0) || 0
}

async function valorDoCurso(reg: { paymentPlan: unknown; condicaoNegociada: unknown; processRegistration: { offeringId: number | null } | null }): Promise<number> {
  const pf = await import('./planoFinanceiro.js')
  const avulso = pf.lerValorCombinado(reg.condicaoNegociada)
  const planos = await pf.planosDaOferta(reg.processRegistration?.offeringId).catch(() => [])
  if (!planos.length) return avulso ? avulso.valorCentavos / 100 : 0
  const pp: any = reg.paymentPlan || {}
  const escolhido = planos.find((p) => p.id === Number(pp.planoFinanceiro?.planoId)) ?? planos[0]!
  const cn = pf.lerCondicaoNegociada(pp.condicaoNegociada) ?? pf.lerCondicaoNegociada(reg.condicaoNegociada)
  const plano = pf.aplicarCondicaoNegociada(escolhido, cn)
  // Integral só no boleto parcelado a preço próprio: o curso custa o boleto, não o cartão.
  const soBoleto = pf.boletoUnicoDoIntegral(plano)
  if (soBoleto) return Math.round(soBoleto.valorTotal * 100) / 100
  return Math.round(pf.valorIntegral(plano) * 100) / 100
}

async function jornadaConcluida(registrationId: number): Promise<boolean> {
  const { etapasDaInscricao } = await import('./portalJornada.js')
  const j = await etapasDaInscricao(registrationId, 'inscricao').catch(() => null)
  return !!j && j.etapas.length > 0 && j.etapas.every((e: any) => e.situacao === 'feito' || e.liberada)
}

export type AcaoProposta =
  | { tipo: 'nada'; motivo: string }
  | { tipo: 'criar' | 'adotar' | 'atualizar' | 'ganhar' | 'perder' | 'reabrir'; motivo: string; negotiationId?: number; valor: number; vendedorUserId: number | null; ganha?: boolean; manterValor?: boolean }

/** Decide (sem gravar) o que a inscrição pede da proposta. */
export async function decidir(registrationId: number, marco: MarcoDaVenda): Promise<{ acao: AcaoProposta; sit: NonNullable<Awaited<ReturnType<typeof situacao>>> | null; propostaId: number | null; adotavel: number | null }> {
  const sit = await situacao(registrationId)
  if (!sit) return { acao: { tipo: 'nada', motivo: 'inscrição sem ficha' }, sit: null, propostaId: null, adotavel: null }
  const { reg, pago, estornado, cancelada, valor } = sit
  const vendedorUserId = reg.vendedorUserId ?? reg.lead?.assignedUserId ?? null
  const propria = await prisma.negotiation.findFirst({ where: { registrationId: reg.id }, orderBy: { id: 'asc' }, select: { id: true, resultado: true, valorUnico: true, valorTabela: true, valorFinal: true, fechadaEm: true, pagamentoForma: true } })
  // Valor ajustado por uma pessoa (desconto ou valor combinado na tela da proposta): o
  // automático grava tabela = final, então diferença entre os dois é decisão humana e vale.
  const valorDoOperador = !!propria && Math.abs(Number(propria.valorTabela ?? 0) - Number(propria.valorFinal ?? 0)) > 0.005

  // Proposta manual aberta do mesmo curso, do mesmo lead, ainda sem inscrição: adotar.
  let adotavel: number | null = null
  if (!propria) {
    const courseId = reg.processRegistration?.offering?.courseId
    const abertas = await prisma.negotiation.findMany({ where: { leadId: reg.leadId!, resultado: null, registrationId: null }, select: { id: true, items: { select: { productId: true } } } })
    if (abertas.length && courseId) {
      const prodIds = [...new Set(abertas.flatMap((a) => a.items.map((i) => i.productId)).filter((x): x is number => !!x))]
      const prods = prodIds.length ? await prisma.product.findMany({ where: { id: { in: prodIds }, courseId }, select: { id: true } }) : []
      const doCurso = abertas.filter((a) => a.items.some((i) => i.productId && prods.some((p) => p.id === i.productId)))
      if (doCurso.length === 1) adotavel = doCurso[0]!.id
    }
  }

  const venda = marco === 'jornada' ? (pago && await jornadaConcluida(reg.id)) : marco === 'assinatura' ? (pago && !!aceiteDoContrato(reg)) : pago
  const desfeita = cancelada || estornado

  if (!propria && !adotavel) {
    if (desfeita) return { acao: { tipo: 'nada', motivo: cancelada ? 'inscrição cancelada, sem proposta' : 'pagamento estornado, sem proposta' }, sit, propostaId: null, adotavel }
    return { acao: { tipo: 'criar', motivo: venda ? 'nova proposta, já ganha (marco atingido)' : 'nova proposta aberta', valor, vendedorUserId, ganha: venda }, sit, propostaId: null, adotavel }
  }
  const alvoId = propria?.id ?? adotavel!
  const resultado = propria?.resultado ?? null
  if (!propria) return { acao: { tipo: 'adotar', motivo: venda ? 'ligar a proposta manual do mesmo curso e ganhar' : 'ligar a proposta manual do mesmo curso', negotiationId: alvoId, valor, vendedorUserId, ganha: venda }, sit, propostaId: null, adotavel }
  if (desfeita) {
    if (resultado === 'lost') return { acao: { tipo: 'nada', motivo: 'proposta já perdida' }, sit, propostaId: alvoId, adotavel }
    return { acao: { tipo: 'perder', motivo: cancelada ? 'inscrição cancelada' : 'pagamento estornado', negotiationId: alvoId, valor, vendedorUserId, manterValor: valorDoOperador }, sit, propostaId: alvoId, adotavel }
  }
  if (resultado === 'won') {
    if (!venda) return { acao: { tipo: 'reabrir', motivo: 'o marco da venda deixou de valer', negotiationId: alvoId, valor, vendedorUserId, manterValor: valorDoOperador }, sit, propostaId: alvoId, adotavel }
    // Ganha continua ganha; o valor acompanha a venda (troca de forma, valor combinado).
    if (!valorDoOperador && Number(propria.valorUnico ?? 0) !== valor) return { acao: { tipo: 'atualizar', motivo: 'valor da venda mudou', negotiationId: alvoId, valor, vendedorUserId, manterValor: valorDoOperador }, sit, propostaId: alvoId, adotavel }
    const f = fechamentoDoMarco(sit, marco)
    if (f && (propria.fechadaEm?.getTime() !== f.data.getTime() || (f.forma && propria.pagamentoForma !== f.forma))) {
      return { acao: { tipo: 'atualizar', motivo: 'data ou forma da fatura', negotiationId: alvoId, valor, vendedorUserId, manterValor: valorDoOperador }, sit, propostaId: alvoId, adotavel }
    }
    return { acao: { tipo: 'nada', motivo: 'proposta já ganha' }, sit, propostaId: alvoId, adotavel }
  }
  if (resultado === 'lost') return { acao: { tipo: 'reabrir', motivo: 'inscrição voltou a valer', negotiationId: alvoId, valor, vendedorUserId, manterValor: valorDoOperador }, sit, propostaId: alvoId, adotavel }
  if (venda) return { acao: { tipo: 'ganhar', motivo: marco === 'jornada' ? 'jornada concluída' : marco === 'assinatura' ? 'pagamento e contrato concluídos' : 'pagamento confirmado', negotiationId: alvoId, valor, vendedorUserId, manterValor: valorDoOperador }, sit, propostaId: alvoId, adotavel }
  if (!valorDoOperador && Number(propria.valorUnico ?? 0) !== valor) return { acao: { tipo: 'atualizar', motivo: 'valor mudou', negotiationId: alvoId, valor, vendedorUserId, manterValor: valorDoOperador }, sit, propostaId: alvoId, adotavel }
  return { acao: { tipo: 'nada', motivo: 'proposta em dia' }, sit, propostaId: alvoId, adotavel }
}

/** Quando o contrato foi aceito ou assinado (o mesmo campo que o Moodle confere). */
function aceiteDoContrato(reg: { contratoAceite?: unknown }): Date | null {
  const em = (reg.contratoAceite as any)?.em
  if (!em) return null
  const d = new Date(em)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Data e forma da venda no marco. 'pagamento': a da fatura paga. 'assinatura': o que
 * aconteceu por último, pagamento ou contrato (a forma continua a do pagamento).
 * 'jornada': sem data própria (vale o momento da conclusão).
 */
function fechamentoDoMarco(sit: { fechamento: { data: Date; forma: 'boleto' | 'cartao' | 'pix' | null } | null; reg: { contratoAceite?: unknown; formData?: unknown } }, marco: MarcoDaVenda) {
  if (marco === 'pagamento') return sit.fechamento
  if (marco !== 'assinatura') return null
  // Transferência de curso: a venda continua a original.
  if ((sit.reg.formData as any)?._transferencia?.fechamento?.data) return sit.fechamento
  const aceite = aceiteDoContrato(sit.reg)
  if (!sit.fechamento || !aceite) return sit.fechamento
  return { data: aceite > sit.fechamento.data ? aceite : sit.fechamento.data, forma: sit.fechamento.forma }
}

const emAndamento = new Map<number, Promise<unknown>>()

/**
 * Aplica a decisão (portal com modo 'ativo'). Serializado por inscrição —
 * vários eventos da mesma inscrição em sequência não criam duas propostas.
 */
export function sincronizarPropostaDaInscricao(registrationId: number): Promise<AcaoProposta | null> {
  const anterior = emAndamento.get(registrationId) ?? Promise.resolve()
  const p = anterior.catch(() => null).then(() => aplicar(registrationId))
  emAndamento.set(registrationId, p)
  void p.finally(() => { if (emAndamento.get(registrationId) === p) emAndamento.delete(registrationId) })
  return p
}

async function aplicar(registrationId: number): Promise<AcaoProposta | null> {
  const reg = await prisma.enrollmentRegistration.findUnique({ where: { id: registrationId }, select: { portalId: true } })
  if (!reg) return null
  const cfg = await configDoPortal(reg.portalId)
  if (cfg.modo !== 'ativo') return null
  const { acao, sit } = await decidir(registrationId, cfg.marco)
  if (acao.tipo === 'nada' || !sit) return acao
  const { reg: r, curso, valor } = sit
  const { onNegotiationChanged } = await import('./commissions.js')
  const { logEvent } = await import('./leadHistory.js')
  const agora = new Date()
  const fech = fechamentoDoMarco(sit, cfg.marco)
  const quandoGanhou = cfg.marco === 'jornada' ? agora : (fech?.data ?? r.paymentPaidAt ?? agora)
  const ganha = acao.ganha === true || acao.tipo === 'ganhar'
  const forma = fech?.forma ? { pagamentoForma: fech.forma } : {}
  const valores = acao.manterValor ? {} : { valorTabela: valor, valorFinal: valor, valorUnico: valor, valorRecorrente: 0 }
  let id = acao.negotiationId ?? null

  if (acao.tipo === 'criar') {
    const courseId = r.processRegistration?.offering?.courseId
    const produto = courseId ? await prisma.product.findFirst({ where: { courseId, active: true }, select: { id: true } }) : null
    const n = await prisma.negotiation.create({
      data: {
        leadId: r.leadId!, titulo: `Inscrição ${r.candidateCode} — ${curso}`.slice(0, 191),
        status: ganha ? 'aceita' : 'enviada', ...valores,
        responsavelUserId: acao.vendedorUserId, funnelId: r.portal?.funnelId ?? r.lead?.funnelId ?? null,
        registrationId: r.id, offeringId: r.processRegistration?.offeringId ?? null, origem: 'portal',
        observacoes: 'Gerada pela inscrição do portal (valor = a venda inteira; antes do pagamento, o valor do curso).',
        ...(ganha ? { resultado: 'won', fechadaEm: quandoGanhou, ...forma } : {}),
        items: { create: [{ productId: produto?.id ?? null, nome: curso.slice(0, 191), quantidade: 1, precoUnit: valor, subtotal: valor, cobranca: 'unico' }] },
      } as any,
    })
    id = n.id
  } else if (acao.tipo === 'adotar') {
    await prisma.negotiation.update({ where: { id: id! }, data: {
      registrationId: r.id, offeringId: r.processRegistration?.offeringId ?? null,
      ...(ganha ? { status: 'aceita', resultado: 'won', fechadaEm: quandoGanhou, ...forma, ...valores } : {}),
    } as any })
  } else if (acao.tipo === 'atualizar') {
    const atual = await prisma.negotiation.findUnique({ where: { id: id! }, select: { resultado: true } })
    await prisma.negotiation.update({ where: { id: id! }, data: { ...valores, ...(atual?.resultado === 'won' && fech ? { fechadaEm: fech.data, ...forma } : {}) } as any })
  } else if (acao.tipo === 'ganhar') {
    await prisma.negotiation.update({ where: { id: id! }, data: { status: 'aceita', resultado: 'won', fechadaEm: quandoGanhou, ...forma, ...valores } as any })
  } else if (acao.tipo === 'perder') {
    await prisma.negotiation.update({ where: { id: id! }, data: { status: 'recusada', resultado: 'lost', fechadaEm: agora } as any })
  } else if (acao.tipo === 'reabrir') {
    await prisma.negotiation.update({ where: { id: id! }, data: { status: 'enviada', resultado: null, fechadaEm: null, fechadaPor: null, lostReasonId: null, ...valores } as any })
  }
  if (id) await onNegotiationChanged(id).catch((e) => console.warn('[propostaDaInscricao] comissão:', e?.message || e))
  const titulos: Record<string, string> = {
    criar: ganha ? 'Proposta criada e ganha pela inscrição' : 'Proposta criada pela inscrição',
    adotar: 'Proposta ligada à inscrição', atualizar: 'Valor da proposta atualizado pela inscrição',
    ganhar: 'Proposta ganha pela inscrição', perder: 'Proposta perdida pela inscrição', reabrir: 'Proposta reaberta pela inscrição',
  }
  logEvent({ leadId: r.leadId!, type: 'negotiation_from_enrollment' as any, category: 'lifecycle', title: `${titulos[acao.tipo]} ${r.candidateCode}`, description: acao.motivo, actorType: 'system', metadata: { negotiationId: id, registrationId: r.id, acao: acao.tipo, valor } } as any)
  return acao
}

/** Simulação de um portal: o que cada inscrição faria com a proposta, sem gravar. */
export async function simularPortal(portalId: number, marco?: MarcoDaVenda) {
  const cfg = await configDoPortal(portalId)
  const m = marco ?? cfg.marco
  const regs = await prisma.enrollmentRegistration.findMany({ where: { portalId, mergedIntoId: null, leadId: { not: null } }, orderBy: { id: 'desc' }, take: 1000, select: { id: true } })
  const linhas: Array<{ registrationId: number; codigo: string; curso: string; acao: string; motivo: string; valor: number; vendedorUserId: number | null; ganha: boolean }> = []
  for (const r of regs) {
    const { acao, sit } = await decidir(r.id, m)
    if (!sit) continue
    linhas.push({ registrationId: r.id, codigo: sit.reg.candidateCode, curso: sit.curso, acao: acao.tipo, motivo: acao.motivo, valor: 'valor' in acao ? acao.valor : 0, vendedorUserId: 'vendedorUserId' in acao ? acao.vendedorUserId : null, ganha: acao.tipo === 'ganhar' || ('ganha' in acao && acao.ganha === true) })
  }
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(linhas.map((l) => l.vendedorUserId).filter((x): x is number => !!x))] } }, select: { id: true, name: true } })
  const nome = new Map(users.map((u) => [u.id, u.name]))
  const resumo: Record<string, number> = {}
  for (const l of linhas) resumo[l.acao] = (resumo[l.acao] ?? 0) + 1
  const vendas = linhas.filter((l) => l.ganha)
  return {
    marco: m, total: linhas.length, resumo,
    vendas: { quantidade: vendas.length, valor: Math.round(vendas.reduce((s, l) => s + l.valor, 0) * 100) / 100 },
    linhas: linhas.map((l) => ({ ...l, vendedor: l.vendedorUserId ? nome.get(l.vendedorUserId) ?? `#${l.vendedorUserId}` : null })),
  }
}

/** Ao ligar o portal: aplica a todas as inscrições existentes (mesma decisão da simulação). */
export async function aplicarPortal(portalId: number): Promise<Record<string, number>> {
  const regs = await prisma.enrollmentRegistration.findMany({ where: { portalId, mergedIntoId: null, leadId: { not: null } }, select: { id: true } })
  const cont: Record<string, number> = {}
  for (const r of regs) {
    const a = await sincronizarPropostaDaInscricao(r.id).catch(() => null)
    if (a) cont[a.tipo] = (cont[a.tipo] ?? 0) + 1
  }
  return cont
}

/**
 * Escuta os eventos da inscrição (pagamento, documentos, contrato, cancelamento…)
 * e, a cada 10 min, revisa as inscrições mexidas nas últimas 48 h — rede de
 * segurança para o que não emite evento (estorno, baixa manual, expiração).
 */
let ligado = false
export function ligarPropostaDaInscricao(): void {
  if (ligado) return
  ligado = true
  import('../lib/eventBus.js').then(({ eventBus }) => {
    eventBus.on('*', async (event: any) => {
      if (typeof event?.type !== 'string' || !event.type.startsWith('enrollment.')) return
      const id = Number(event.payload?.enrollmentId ?? event.payload?.registrationId)
      if (Number.isInteger(id) && id > 0) await sincronizarPropostaDaInscricao(id).catch(() => null)
    })
  }).catch(() => {})
  setInterval(async () => {
    const ativos = Object.entries(await configsComerciais()).filter(([, c]) => c?.modo === 'ativo').map(([k]) => Number(k))
    if (!ativos.length) return
    const regs = await prisma.enrollmentRegistration.findMany({ where: { portalId: { in: ativos }, updatedAt: { gte: new Date(Date.now() - 48 * 3600_000) } }, select: { id: true }, take: 2000 }).catch(() => [])
    for (const r of regs) await sincronizarPropostaDaInscricao(r.id).catch(() => null)
  }, 10 * 60_000).unref()
}
