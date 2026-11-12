// services/descontoFatura.ts — "Dar desconto" numa fatura já gerada (12/11/2026).
//
// Caso que originou: aluna pediu desconto na fatura vencida, a gestão aprovou e
// o painel não tinha como aplicar nem registrar quem deu e por quê. A equipe
// chegou a criar um cupom PÚBLICO para isso — que não serve (cupom só vale na
// 1ª cobrança) e ainda abre o desconto para qualquer um.
//
// Regra do cliente: SEM limite de valor ou de %, mas TUDO fica registrado:
// quem deu, quem aprovou, motivo, valor antes/depois, por qual caminho.
//
// Caminhos, conforme a fatura:
//   - Boleto/Pix já gerado no Asaas → MESMA cobrança com o valor novo (link e
//     avisos seguem valendo; se vencida, ganha nova data, como no "Atualizar").
//   - Título do combinado/acordo ainda não gerado → só o valor local muda.
//   - Cartão (título) → link novo com o valor menor, pela troca de forma de
//     pagamento: a fatura antiga segue valendo até o cartão aprovar.
//   - Cartão fora de título → não dá: orienta a gerar nova forma de pagamento.
//
// Cupom interno: o código de um cupom (de preferência "Desconto da equipe")
// pode ser usado aqui; o valor sai da regra do cupom e o uso é contado.

import { prisma } from '../lib/prisma.js'
import { logEvent } from './leadHistory.js'
import { registrarEventoDaInscricao } from './inscricaoAssistida.js'
import { atualizarValorAsaas, consultarCobrancaAsaas } from './paymentAsaas.js'
import { cobrancaDaChave, codigos, gravarLocal } from './atualizarFatura.js'
import { configDaInscricao, hojeBr, type Operador } from './pagamentoCombinado.js'
import { criarTroca, recontarCombinado } from './trocaPagamento.js'

const FECHADAS = ['cancelled', 'merged', 'expired']
const EM_ABERTO_NO_ASAAS = ['PENDING', 'OVERDUE']
const VALOR_MINIMO = 500 // R$ 5,00: abaixo disso o Asaas recusa cobrança
const MAX_DIAS = 60

const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dataBr = (iso: string) => iso.split('-').reverse().join('/')
const centavos = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').trim().replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? Math.round(n * 100) : NaN
}
const somarDias = (iso: string, dias: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10)

type Erro = { ok: false; status: number; erro: string }
const erro = (status: number, msg: string): Erro => ({ ok: false, status, erro: msg })

export type ResultadoDesconto = {
  ok: true
  descontoId: number
  valorAntes: number
  desconto: number
  valorDepois: number
  vencimento: string | null
  link: string | null
  pendente: boolean
  mensagem: { texto: string; leadId: number | null; whatsapp: string | null }
}

interface Alvo {
  caminho: 'asaas' | 'local' | 'troca'
  rotulo: string
  meio: string | null
  valorCentavos: number
  externalId: string | null
  titulo?: { id: number; origem: string; parcelasCartao: number }
}

// ─── cupom interno ───────────────────────────────────────────────────────────

async function descontoDoCupom(codigo: string, registrationId: number, portalId: number, valor: number):
  Promise<{ couponId: number; code: string; desconto: number; snapshot: any } | { erro: string }> {
  const c = await prisma.coupon.findUnique({ where: { code: codigo.trim().toUpperCase() } })
  if (!c || c.archivedAt) return { erro: 'Cupom não encontrado.' }
  const agora = new Date()
  if (!c.active) return { erro: `O cupom ${c.code} está desativado.` }
  if (c.validFrom && c.validFrom > agora) return { erro: `O cupom ${c.code} ainda não começou a valer.` }
  if (c.validUntil && c.validUntil < agora) return { erro: `O cupom ${c.code} já expirou.` }
  if (c.usageLimit != null && c.usageCount >= c.usageLimit) return { erro: `O cupom ${c.code} já atingiu o limite de usos.` }
  const portais = Array.isArray(c.portalIds) ? (c.portalIds as any[]).map(Number) : []
  if (portais.length && !portais.includes(portalId)) return { erro: `O cupom ${c.code} não vale neste portal.` }
  if (c.minAmount != null && valor < Math.round(Number(c.minAmount) * 100)) return { erro: `O cupom ${c.code} só vale a partir de ${brl(Math.round(Number(c.minAmount) * 100))}.` }
  if (c.perUserLimit > 0) {
    const usos = await prisma.couponRedemption.count({ where: { couponId: c.id, registrationId } })
    if (usos >= c.perUserLimit) return { erro: `O cupom ${c.code} já foi usado nesta inscrição.` }
  }
  let desconto = c.type === 'percent' ? Math.round(valor * Number(c.value) / 100) : Math.round(Number(c.value) * 100)
  if (c.type === 'percent' && c.maxDiscount != null) desconto = Math.min(desconto, Math.round(Number(c.maxDiscount) * 100))
  const { redemptions: _r, ...snapshot } = c as any
  return { couponId: c.id, code: c.code, desconto, snapshot: JSON.parse(JSON.stringify(snapshot)) }
}

/** Cupons que a equipe pode usar agora nesta inscrição ("Desconto da equipe" primeiro). */
export async function cuponsParaDesconto(registrationId: number) {
  const reg = await prisma.enrollmentRegistration.findUnique({ where: { id: registrationId }, select: { portalId: true } })
  if (!reg) return []
  const agora = new Date()
  const lista = await prisma.coupon.findMany({
    where: { active: true, archivedAt: null, OR: [{ validUntil: null }, { validUntil: { gte: agora } }] },
    orderBy: [{ somenteEquipe: 'desc' }, { code: 'asc' }], take: 200,
  })
  return lista
    .filter((c) => (!c.validFrom || c.validFrom <= agora) && (c.usageLimit == null || c.usageCount < c.usageLimit))
    .filter((c) => { const p = Array.isArray(c.portalIds) ? (c.portalIds as any[]).map(Number) : []; return !p.length || p.includes(reg.portalId) })
    .map((c) => ({
      code: c.code, somenteEquipe: c.somenteEquipe, descricao: c.description,
      regra: c.type === 'percent' ? `${Number(c.value).toLocaleString('pt-BR')}%${c.maxDiscount != null ? ` (até ${brl(Math.round(Number(c.maxDiscount) * 100))})` : ''}` : brl(Math.round(Number(c.value) * 100)),
    }))
}

// ─── qual fatura e por qual caminho ──────────────────────────────────────────

async function resolverAlvo(registrationId: number, chave: string): Promise<Alvo | Erro> {
  if (chave.startsWith('titulo:')) {
    const t = await prisma.enrollmentTitulo.findFirst({ where: { id: Number(chave.slice(7)), registrationId } })
    if (!t) return erro(404, 'Fatura não encontrada.')
    if (!['aberta', 'prevista'].includes(t.status) || t.valorPagoCentavos > 0) return erro(409, 'Só fatura em aberto e sem nada recebido pode ganhar desconto.')
    const rotulo = t.origem === 'acordo' ? `Acordo nº ${t.acordoId} · pagamento ${t.ordem}` : `Pagamento combinado ${t.ordem}`
    const titulo = { id: t.id, origem: t.origem, parcelasCartao: t.parcelasCartao }
    if (t.meio === 'credit_card') return { caminho: 'troca', rotulo, meio: t.meio, valorCentavos: t.valorCentavos, externalId: t.externalId, titulo }
    if (!t.externalId) return { caminho: 'local', rotulo, meio: t.meio, valorCentavos: t.valorCentavos, externalId: null, titulo }
    if (t.provider && t.provider !== 'asaas') return erro(409, 'Só faturas do Asaas podem receber desconto por aqui.')
    return { caminho: 'asaas', rotulo, meio: t.meio, valorCentavos: t.valorCentavos, externalId: t.externalId, titulo }
  }
  const c = await cobrancaDaChave(registrationId, chave)
  if ('erro' in c) {
    return erro(c.status, c.erro.includes('cartão')
      ? 'Cobrança no cartão não muda de valor: cancele e gere uma nova forma de pagamento já com o valor combinado.'
      : c.erro.replace('atualizadas', 'alteradas'))
  }
  const rotulo = chave.startsWith('reg:') ? 'Cobrança da inscrição' : 'Parcela'
  return { caminho: 'asaas', rotulo, meio: null, valorCentavos: 0, externalId: c.id }
}

// ─── conceder ────────────────────────────────────────────────────────────────

const emAndamento = new Set<string>()

export async function concederDesconto(registrationId: number, body: any, op: Operador & { req?: any }): Promise<ResultadoDesconto | Erro> {
  const chave = String(body?.chave ?? '')
  const motivo = String(body?.motivo ?? '').trim()
  const aprovadoPor = String(body?.aprovadoPor ?? '').trim().slice(0, 191) || null
  const modo = String(body?.modo ?? '')
  if (!['valor', 'percentual', 'cupom'].includes(modo)) return erro(400, 'Escolha como dar o desconto: valor, porcentagem ou cupom.')
  if (motivo.length < 5) return erro(400, 'Escreva o motivo do desconto (fica registrado).')

  const reg = await prisma.enrollmentRegistration.findUnique({
    where: { id: registrationId },
    select: { id: true, status: true, leadId: true, portalId: true, candidateCode: true },
  })
  if (!reg) return erro(404, 'Inscrição não encontrada.')
  if (FECHADAS.includes(reg.status)) return erro(409, 'Inscrição cancelada, expirada ou mesclada.')
  if (await prisma.enrollmentTroca.count({ where: { registrationId, status: 'PENDENTE' } })) {
    return erro(409, 'Há uma troca de forma de pagamento aguardando o cartão. Cancele a troca antes de dar desconto.')
  }

  if (emAndamento.has(chave + registrationId)) return erro(409, 'Já há um desconto sendo aplicado nesta fatura. Aguarde.')
  emAndamento.add(chave + registrationId)
  try {
    return await executar(reg, chave, modo as any, motivo, aprovadoPor, body, op)
  } finally {
    emAndamento.delete(chave + registrationId)
  }
}

async function executar(
  reg: { id: number; leadId: number | null; portalId: number; candidateCode: string },
  chave: string, modo: 'valor' | 'percentual' | 'cupom', motivo: string, aprovadoPor: string | null, body: any, op: Operador & { req?: any },
): Promise<ResultadoDesconto | Erro> {
  const registrationId = reg.id
  const alvo = await resolverAlvo(registrationId, chave)
  if ('erro' in alvo) return alvo

  // O valor que vale é o do Asaas, quando a cobrança existe lá.
  const hoje = hojeBr()
  const cfg = alvo.caminho === 'asaas' ? await configDaInscricao(registrationId) : null
  let atual: any = null
  if (alvo.caminho === 'asaas') {
    if (!cfg) return erro(503, 'Pagamento indisponível no momento.')
    try { atual = await consultarCobrancaAsaas(cfg, alvo.externalId!) } catch (e: any) {
      return erro(e?.status === 404 ? 404 : 502, e?.status === 404 ? 'A cobrança não existe mais no Asaas.' : 'Não foi possível consultar a fatura agora. Tente de novo em alguns minutos.')
    }
    if (atual?.deleted || !EM_ABERTO_NO_ASAAS.includes(String(atual?.status))) {
      return erro(409, ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'].includes(String(atual?.status)) ? 'Esta fatura já foi paga.' : 'Esta fatura não está mais em aberto.')
    }
    if (atual.billingType === 'CREDIT_CARD') return erro(409, 'Cobrança no cartão não muda de valor: cancele e gere uma nova forma de pagamento já com o valor combinado.')
    alvo.valorCentavos = Math.round(Number(atual.value) * 100)
    alvo.meio = alvo.meio ?? (atual.billingType === 'PIX' ? 'pix' : 'boleto')
  }
  const antes = alvo.valorCentavos

  // Quanto.
  let desconto = 0, percentual: number | null = null
  let cupom: { couponId: number; code: string; desconto: number; snapshot: any } | null = null
  if (modo === 'valor') {
    desconto = centavos(body?.valor)
    if (!(desconto > 0)) return erro(400, 'Informe o valor do desconto.')
  } else if (modo === 'percentual') {
    percentual = Number(String(body?.percentual ?? '').replace(',', '.'))
    if (!(percentual > 0 && percentual < 100)) return erro(400, 'Informe a porcentagem do desconto (entre 0 e 100).')
    desconto = Math.round(antes * percentual / 100)
  } else {
    const r = await descontoDoCupom(String(body?.cupom ?? ''), registrationId, reg.portalId, antes)
    if ('erro' in r) return erro(400, r.erro)
    cupom = r
    desconto = r.desconto
  }
  const depois = antes - desconto
  if (depois <= 0) return erro(400, 'O desconto não pode zerar a fatura: para quitar, use a baixa manual.')
  if (alvo.caminho !== 'local' && depois < VALOR_MINIMO) return erro(400, `Com o desconto a fatura fica em ${brl(depois)}, e o Asaas não aceita cobrança abaixo de ${brl(VALOR_MINIMO)}. Use a baixa manual.`)

  const textoMotivo = `${motivo}${aprovadoPor ? ` (aprovado por ${aprovadoPor})` : ''}`
  let vencimento: string | null = null
  let link: string | null = null
  let pendente = false
  let trocaId: number | null = null

  if (alvo.caminho === 'asaas') {
    const de = String(atual.dueDate || hoje)
    const pedida = body?.vencimento ? String(body.vencimento) : null
    vencimento = pedida || (de < hoje ? hoje : de)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(vencimento) || vencimento < hoje) return erro(400, 'O vencimento precisa ser de hoje em diante.')
    if (vencimento > somarDias(hoje, MAX_DIAS)) return erro(400, `O vencimento pode ser no máximo ${MAX_DIAS} dias à frente.`)
    let novo: any
    try { novo = await atualizarValorAsaas(cfg!, alvo.externalId!, depois / 100, vencimento) } catch (e: any) {
      return erro(502, `O Asaas não aceitou o novo valor${e?.message ? ` (${String(e.message).replace(/^Asaas:\s*/, '')})` : ''}.`)
    }
    const c = await codigos(cfg, alvo.externalId!, novo)
    link = c.link
    await gravarLocal(registrationId, alvo.externalId!, vencimento, c)
    await gravarValorLocal(registrationId, alvo.externalId!, depois)
    ;(await import('./areaDoAluno.js')).esquecerConsultasDoAsaas()
  } else if (alvo.caminho === 'local') {
    await prisma.enrollmentTitulo.update({ where: { id: alvo.titulo!.id }, data: { valorCentavos: depois } })
  } else {
    // Cartão: link novo com o valor menor; o antigo segue valendo até aprovar.
    const r = await criarTroca(registrationId, {
      titulos: [alvo.titulo!.id], total: depois / 100,
      motivo: `Desconto de ${brl(desconto)}: ${textoMotivo}`,
      linhas: [{ meio: 'credit_card', valor: depois / 100, vencimento: hoje, parcelas: alvo.titulo!.parcelasCartao }],
    }, { userId: op.userId, nome: op.nome })
    if (!r.ok) return erro(r.status, r.erro)
    trocaId = r.trocaId
    pendente = r.pendente
    link = r.link
  }
  if (alvo.titulo?.origem === 'combinado' && alvo.caminho !== 'troca') await recontarCombinado(registrationId).catch(() => {})

  const registro = await prisma.enrollmentDesconto.create({
    data: {
      registrationId, leadId: reg.leadId, chave, fatura: alvo.rotulo, meio: alvo.meio, externalId: alvo.externalId,
      modo, percentual, couponId: cupom?.couponId ?? null, couponCode: cupom?.code ?? null,
      valorAntesCentavos: antes, descontoCentavos: desconto, valorDepoisCentavos: depois,
      situacao: pendente ? 'aguardando_cartao' : 'aplicado', trocaId,
      motivo, aprovadoPor, criadoPorUserId: op.userId, criadoPorNome: op.nome,
    },
  })
  if (cupom) {
    await prisma.couponRedemption.create({
      data: { couponId: cupom.couponId, registrationId, amountBefore: antes / 100, discountValue: desconto / 100, amountAfter: depois / 100, couponSnapshot: { ...cupom.snapshot, aplicadoPelaEquipe: { descontoId: registro.id, por: op.nome, fatura: alvo.rotulo } } },
    })
    await prisma.coupon.update({ where: { id: cupom.couponId }, data: { usageCount: { increment: 1 } } })
  }

  const dados = {
    desconto: registro.id, fatura: alvo.rotulo, chave, modo, ...(percentual ? { percentual } : {}), ...(cupom ? { cupom: cupom.code } : {}),
    antes: antes / 100, valorDesconto: desconto / 100, depois: depois / 100, motivo, aprovadoPor, ...(trocaId ? { troca: trocaId } : {}), ...(vencimento ? { vencimento } : {}),
  }
  await registrarEventoDaInscricao({
    registrationId, etapa: 'pagamento', acao: 'desconto_concedido', ator: 'atendente', userId: op.userId, userName: op.nome, req: op.req ?? null, dados,
  }).catch(() => {})
  if (reg.leadId) {
    logEvent({
      leadId: reg.leadId, type: 'note_added', category: 'operator', channel: 'payment', source: 'desconto_fatura',
      title: `Desconto de ${brl(desconto)} na fatura (${alvo.rotulo}): ${brl(antes)} → ${brl(depois)}`,
      description: `${textoMotivo}${cupom ? ` · cupom ${cupom.code}` : ''}${pendente ? ' · aguardando o pagamento no cartão' : ''}`,
      actorType: 'operator', userId: op.userId, userName: op.nome, metadata: dados,
    })
  }

  return {
    ok: true, descontoId: registro.id, valorAntes: antes / 100, desconto: desconto / 100, valorDepois: depois / 100,
    vencimento, link, pendente, mensagem: await mensagemDoDesconto(registrationId, { desconto, depois, vencimento, link, pendente }),
  }
}

/** O valor novo em tudo o que guarda essa cobrança. */
async function gravarValorLocal(registrationId: number, id: string, depois: number) {
  await prisma.enrollmentTitulo.updateMany({ where: { registrationId, externalId: id }, data: { valorCentavos: depois } })
  await prisma.enrollmentPaymentMethod.updateMany({ where: { registrationId, externalId: id }, data: { amount: depois / 100 } })
  const reg = await prisma.enrollmentRegistration.findUnique({ where: { id: registrationId }, select: { paymentId: true, paymentStatus: true, paymentPlan: true } })
  if (!reg) return
  const data: Record<string, any> = {}
  if (reg.paymentId === id && reg.paymentStatus !== 'paid') data.paymentAmount = depois / 100
  const plano = (reg.paymentPlan ?? {}) as any
  const pp = plano.parcelasPortal as Record<string, any> | undefined
  const n = pp ? Object.keys(pp).find((k) => pp[k]?.id === id) : undefined
  if (pp && n) data.paymentPlan = { ...plano, parcelasPortal: { ...pp, [n]: { ...pp[n], valor: depois / 100 } } }
  if (Object.keys(data).length) await prisma.enrollmentRegistration.update({ where: { id: registrationId }, data })
  await prisma.acaParcela.updateMany({ where: { asaasChargeId: id, valorPagoCentavos: 0 }, data: { valorBrutoCentavos: depois } }).catch(() => {})
}

async function mensagemDoDesconto(registrationId: number, r: { desconto: number; depois: number; vencimento: string | null; link: string | null; pendente: boolean }) {
  const reg = await prisma.enrollmentRegistration.findUnique({ where: { id: registrationId }, select: { candidateCode: true, leadId: true, formData: true, lead: { select: { nome: true, whatsapp: true } } } })
  const nome = String(reg?.lead?.nome || (reg?.formData as any)?.nome || '').trim().split(/\s+/)[0] || ''
  const linhas = [
    `Olá${nome ? `, ${nome}` : ''}! Conforme combinado, aplicamos um desconto de ${brl(r.desconto)} na sua fatura (inscrição ${reg?.candidateCode ?? ''}).`,
    `Novo valor: ${brl(r.depois)}${r.vencimento ? `, com vencimento em ${dataBr(r.vencimento)}` : ''}.`,
    r.link ? `\n${r.pendente ? 'Para pagar no cartão com o novo valor' : 'Para pagar'}, é só abrir: ${r.link}` : '',
  ]
  return { texto: linhas.filter(Boolean).join('\n').trim(), leadId: reg?.leadId ?? null, whatsapp: reg?.lead?.whatsapp ?? null }
}

// ─── leitura: na inscrição e no relatório ────────────────────────────────────

/** Situação real: o do cartão só vale se a troca concluiu. */
async function comSituacao<T extends { trocaId: number | null; situacao: string }>(lista: T[]): Promise<Array<T & { situacaoReal: string }>> {
  const ids = [...new Set(lista.map((d) => d.trocaId).filter(Boolean))] as number[]
  const trocas = ids.length ? await prisma.enrollmentTroca.findMany({ where: { id: { in: ids } }, select: { id: true, status: true } }) : []
  const st = new Map(trocas.map((t) => [t.id, t.status]))
  return lista.map((d) => {
    if (!d.trocaId) return { ...d, situacaoReal: d.situacao }
    const s = st.get(d.trocaId)
    return { ...d, situacaoReal: s === 'CONCLUIDA' ? 'aplicado' : s === 'PENDENTE' ? 'aguardando_cartao' : 'nao_usado' }
  })
}

const paraTela = (d: any) => ({
  id: d.id, registrationId: d.registrationId, leadId: d.leadId, fatura: d.fatura, meio: d.meio, modo: d.modo,
  percentual: d.percentual != null ? Number(d.percentual) : null, cupom: d.couponCode,
  antes: d.valorAntesCentavos / 100, desconto: d.descontoCentavos / 100, depois: d.valorDepoisCentavos / 100,
  situacao: d.situacaoReal, motivo: d.motivo, aprovadoPor: d.aprovadoPor, por: d.criadoPorNome, em: d.createdAt.toISOString(),
})

export async function descontosDaInscricao(registrationId: number) {
  const lista = await prisma.enrollmentDesconto.findMany({ where: { registrationId }, orderBy: { createdAt: 'desc' } })
  return (await comSituacao(lista)).map(paraTela)
}

export async function relatorioDeDescontos(f: { de?: string; ate?: string; portalId?: number; por?: string }) {
  const where: any = {}
  if (f.de || f.ate) where.createdAt = { ...(f.de ? { gte: new Date(`${f.de}T00:00:00-03:00`) } : {}), ...(f.ate ? { lte: new Date(`${f.ate}T23:59:59-03:00`) } : {}) }
  if (f.por) where.criadoPorNome = f.por
  if (f.portalId) {
    const regs = await prisma.enrollmentRegistration.findMany({ where: { portalId: f.portalId }, select: { id: true } })
    where.registrationId = { in: regs.map((r) => r.id) }
  }
  const lista = await comSituacao(await prisma.enrollmentDesconto.findMany({ where, orderBy: { createdAt: 'desc' }, take: 1000 }))
  const regs = await prisma.enrollmentRegistration.findMany({
    where: { id: { in: [...new Set(lista.map((d) => d.registrationId))] } },
    select: { id: true, portalId: true, candidateCode: true, formData: true, portal: { select: { nome: true } }, lead: { select: { nome: true } } },
  })
  const porReg = new Map(regs.map((r) => [r.id, r]))
  const itens = lista.map((d) => {
    const r = porReg.get(d.registrationId) as any
    return { ...paraTela(d), portalId: r?.portalId ?? null, codigo: r?.candidateCode ?? null, aluno: r?.lead?.nome || r?.formData?.nome || null, portal: r?.portal?.nome ?? null }
  })
  const valendo = itens.filter((i) => i.situacao !== 'nao_usado')
  const porPessoa: Record<string, { quantidade: number; valor: number }> = {}
  for (const i of valendo) {
    const k = i.por || '—'
    porPessoa[k] = { quantidade: (porPessoa[k]?.quantidade ?? 0) + 1, valor: Math.round(((porPessoa[k]?.valor ?? 0) + i.desconto) * 100) / 100 }
  }
  return {
    itens,
    total: Math.round(valendo.reduce((s, i) => s + i.desconto, 0) * 100) / 100,
    quantidade: valendo.length,
    aguardando: itens.filter((i) => i.situacao === 'aguardando_cartao').length,
    porPessoa,
  }
}
