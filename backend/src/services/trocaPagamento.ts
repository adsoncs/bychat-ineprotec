// services/trocaPagamento.ts
//
// ALTERAR FORMA DE PAGAMENTO (06/11/2026). O aluno muda de ideia depois das
// faturas geradas. Só pelo painel, com permissão própria: o aluno só vê o resultado.
//
// Só o que não foi pago entra na troca. Para cartão, a troca fica PENDENTE: o link
// sai e os títulos antigos continuam valendo até a aprovação, para ele não ficar
// sem cobrança se desistir. Para Pix e boleto, vale na hora. Pagamento que chega em
// título já substituído não se perde: vira um alerta para a equipe conferir.

import { prisma } from '../lib/prisma.js'
import { registrarEventoDaInscricao } from './inscricaoAssistida.js'
import { logEvent } from './leadHistory.js'
import { ASAAS_STATUS_MAP, consultarCobrancaAsaas } from './paymentAsaas.js'
import {
  aplicarAvisoDoAsaas, cancelarNoGateway, configDaInscricao, conexaoAceitaCombinado, conexaoDaInscricao, descreverCombinado,
  gerarCobrancaDoTitulo, hojeBr, TITULO_EM_ABERTO, validarCombinado, type Operador,
} from './pagamentoCombinado.js'

const FECHADAS = ['cancelled', 'transferred', 'merged', 'expired']
const PRAZO_DIAS = 7
const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const somarDias = (iso: string, dias: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10)
const dataBr = (iso: string) => iso.split('-').reverse().join('/')

/** Até 7 dias e sempre antes do próximo vencimento, para não haver cobrança dupla no caminho. */
export function prazoDaTroca(vencimentos: string[], hoje = hojeBr()): string {
  const proximo = vencimentos.filter((v) => v >= hoje).sort()[0]
  const limite = somarDias(hoje, PRAZO_DIAS)
  if (!proximo) return limite
  const vespera = somarDias(proximo, -1)
  if (vespera < hoje) return hoje
  return vespera < limite ? vespera : limite
}

export const tituloElegivel = (t: { status: string; valorPagoCentavos: number; trocaId?: number | null }) =>
  TITULO_EM_ABERTO.includes(t.status as any) && t.valorPagoCentavos === 0

/** Reescreve a condição combinada com o que vale depois da troca: é o que o contrato mostra. */
export async function recontarCombinado(registrationId: number) {
  const reg = await prisma.enrollmentRegistration.findUnique({ where: { id: registrationId }, select: { paymentPlan: true } })
  const plano = (reg?.paymentPlan ?? {}) as Record<string, any>
  if (!plano.combinado) return
  const ts = await prisma.enrollmentTitulo.findMany({ where: { registrationId, origem: 'combinado', status: { in: ['prevista', 'aberta', 'paga'] } }, orderBy: { ordem: 'asc' } })
  if (!ts.length) return
  const linhas: Array<{ meio: string; valorCentavos: number; vencimento: string; parcelasCartao: number; parcelasBoleto?: number }> = []
  const vistos = new Set<number>()
  for (const t of ts) {
    if (vistos.has(t.id)) continue
    // Boleto parcelado inteiro volta a ser uma linha só.
    const grupo = t.totalDoGrupo && t.parcelaDoGrupo === 1 ? ts.filter((x) => x.totalDoGrupo === t.totalDoGrupo && x.trocaId === t.trocaId && x.ordem >= t.ordem && x.ordem < t.ordem + t.totalDoGrupo!) : []
    if (grupo.length === t.totalDoGrupo) {
      grupo.forEach((x) => vistos.add(x.id))
      linhas.push({ meio: 'boleto', valorCentavos: grupo.reduce((s, x) => s + x.valorCentavos, 0), vencimento: t.vencimento, parcelasCartao: 1, parcelasBoleto: grupo.length })
    } else {
      linhas.push({ meio: t.meio, valorCentavos: t.valorCentavos, vencimento: t.vencimento, parcelasCartao: t.parcelasCartao })
    }
  }
  const total = ts.reduce((s, t) => s + t.valorCentavos, 0)
  await prisma.enrollmentRegistration.update({
    where: { id: registrationId },
    data: { paymentPlan: { ...plano, parcelas: ts.length, valorTotal: total / 100, valorTabela: total / 100, combinado: { ...plano.combinado, descricao: descreverCombinado(linhas, total, plano.combinado.descontoPct ?? null) } } as any },
  })
}

/** Parcelas do acadêmico acompanham, onde houver contrato: as antigas saem, as novas entram. */
async function acompanharNoAcademico(antigas: Array<{ externalId: string | null }>, novosIds: number[]) {
  const ids = antigas.map((t) => t.externalId).filter(Boolean) as string[]
  if (!ids.length) return
  const parcela = await prisma.acaParcela.findFirst({ where: { asaasChargeId: { in: ids } }, select: { contratoId: true } }).catch(() => null)
  if (!parcela) return
  await prisma.acaParcela.updateMany({ where: { asaasChargeId: { in: ids }, situacao: { in: ['ABERTA', 'VENCIDA'] } }, data: { situacao: 'RENEGOCIADA' } })
  const novos = await prisma.enrollmentTitulo.findMany({ where: { id: { in: novosIds } }, orderBy: { ordem: 'asc' } })
  let nro = ((await prisma.acaParcela.aggregate({ where: { contratoId: parcela.contratoId }, _max: { nroParcela: true } }))._max.nroParcela ?? 0) + 1
  for (const t of novos) {
    await prisma.acaParcela.create({ data: {
      contratoId: parcela.contratoId, nroParcela: nro++, tipo: 'MENSALIDADE', valorBrutoCentavos: t.valorCentavos,
      dataVencimento: new Date(`${t.vencimento}T12:00:00-03:00`), situacao: t.status === 'paga' ? 'PAGA' : 'ABERTA',
      ...(t.externalId ? { asaasChargeId: t.externalId, gatewayProvider: t.provider } : {}),
    } })
  }
}

type Resposta = { ok: true; trocaId: number; pendente: boolean; link: string | null; falhas: string[] } | { ok: false; status: number; erro: string }

// Uma troca por matrícula de cada vez. Sem isso, 3 cliques seguidos (o Asaas
// demorando) disparavam 3 exclusões do mesmo parcelamento (ineprotec 12/11).
const trocasEmAndamento = new Set<number>()

export async function criarTroca(registrationId: number, body: any, op: Operador): Promise<Resposta> {
  if (trocasEmAndamento.has(registrationId)) return { ok: false, status: 409, erro: 'Já há uma troca desta matrícula sendo processada. Aguarde a resposta antes de tentar de novo.' }
  trocasEmAndamento.add(registrationId)
  try {
    return await criarTrocaSemTrava(registrationId, body, op)
  } finally {
    trocasEmAndamento.delete(registrationId)
  }
}

async function criarTrocaSemTrava(registrationId: number, body: any, op: Operador): Promise<Resposta> {
  const reg = await prisma.enrollmentRegistration.findUnique({ where: { id: registrationId }, select: { id: true, status: true, leadId: true } })
  if (!reg) return { ok: false, status: 404, erro: 'Inscrição não encontrada.' }
  if (FECHADAS.includes(reg.status)) return { ok: false, status: 409, erro: 'Inscrição cancelada, expirada ou mesclada.' }
  if (!conexaoAceitaCombinado(await conexaoDaInscricao(registrationId))) return { ok: false, status: 409, erro: 'A troca funciona com a conexão Asaas, e este portal não tem uma ativa.' }
  if (await prisma.enrollmentTroca.count({ where: { registrationId, status: 'PENDENTE' } })) return { ok: false, status: 409, erro: 'Já existe uma troca aguardando o cartão. Cancele antes de fazer outra.' }

  const ids = (Array.isArray(body?.titulos) ? body.titulos : []).map(Number).filter(Boolean) as number[]
  if (!ids.length) return { ok: false, status: 400, erro: 'Selecione os pagamentos que vão mudar.' }
  const antigos = await prisma.enrollmentTitulo.findMany({ where: { id: { in: ids }, registrationId }, orderBy: { ordem: 'asc' } })
  if (antigos.length !== new Set(ids).size || !antigos.every(tituloElegivel)) return { ok: false, status: 409, erro: 'Só pagamentos em aberto e sem nada recebido podem mudar. Atualize a página.' }
  if (new Set(antigos.map((t) => `${t.origem}:${t.acordoId ?? ''}`)).size > 1) return { ok: false, status: 400, erro: 'Pagamentos do combinado e de acordo mudam em trocas separadas.' }

  const saldo = antigos.reduce((s, t) => s + t.valorCentavos, 0)
  const hoje = hojeBr()
  const v = validarCombinado({ ...body, total: body?.total ?? saldo / 100 }, hoje, { minLinhas: 1 })
  if ('erro' in v) return { ok: false, status: 400, erro: v.erro }
  const cartoes = v.titulos.filter((t) => t.meio === 'credit_card')
  if (cartoes.length > 1) return { ok: false, status: 400, erro: 'Use um cartão só por troca: é ele que confirma a mudança.' }
  const alterado = v.totalCentavos !== saldo
  // Total menor que o saldo = parte da dívida deixa de existir. Só com o motivo
  // da redução escrito (fica na troca, na linha do tempo e no lead).
  if (v.totalCentavos < saldo && v.motivo.trim().length < 15) {
    return { ok: false, status: 400, erro: `O novo total (${brl(v.totalCentavos)}) é menor que o saldo (${brl(saldo)}): a diferença de ${brl(saldo - v.totalCentavos)} deixa de ser cobrada. Escreva o motivo da redução e quem autorizou.` }
  }

  // Conferência na hora: não substitui o que acabou de ser pago.
  const cfg = await configDaInscricao(registrationId)
  for (const t of antigos) {
    if (!t.externalId || t.provider !== 'asaas' || !cfg) continue
    const p = await consultarCobrancaAsaas(cfg, t.externalId).catch(() => null)
    if (p && ASAAS_STATUS_MAP[p.status] === 'paid') {
      await aplicarAvisoDoAsaas(t.id, 'SYNC', p)
      return { ok: false, status: 409, erro: `O pagamento ${t.ordem} acabou de ser recebido. Atualize a página e confira o saldo.` }
    }
  }

  const antes = antigos.map((t) => ({ id: t.id, ordem: t.ordem, meio: t.meio, valorCentavos: t.valorCentavos, vencimento: t.vencimento }))
  const depois = v.titulos.map((t) => ({ meio: t.meio, valorCentavos: t.valorCentavos, vencimento: t.vencimento, parcelasCartao: t.parcelasCartao }))
  const base = antigos[0]!
  const maiorOrdem = (await prisma.enrollmentTitulo.aggregate({ where: { registrationId, origem: base.origem, acordoId: base.acordoId }, _max: { ordem: true } }))._max.ordem ?? 0
  const novosDados = (trocaId: number, status: string) => v.titulos.map((t, i) => ({
    registrationId, origem: base.origem, acordoId: base.acordoId, trocaId, status, ordem: maiorOrdem + i + 1, meio: t.meio, parcelasCartao: t.parcelasCartao,
    parcelaDoGrupo: t.parcelaDoGrupo, totalDoGrupo: t.totalDoGrupo, valorCentavos: t.valorCentavos, vencimento: t.vencimento,
    ...(t.meio === 'boleto' && v.descontoPct ? { descontoPct: v.descontoPct } : {}),
  }))
  const dadosDaTroca = (status: string, expiraEm: string | null) => ({
    registrationId, leadId: reg.leadId, status, saldoCentavos: saldo, novoTotalCentavos: v.totalCentavos, motivo: v.motivo,
    antes: antes as any, depois: depois as any, expiraEm, criadoPorUserId: op.userId, criadoPorNome: op.nome,
  })
  const registrar = (acao: string, trocaId: number, extra: Record<string, unknown> = {}) => registrarEventoDaInscricao({
    registrationId, etapa: 'pagamento', acao, ator: 'atendente', userId: op.userId, userName: op.nome,
    dados: { troca: trocaId, saldo: saldo / 100, novoTotal: v.totalCentavos / 100, ...(alterado ? { valorAlterado: true, diferenca: (v.totalCentavos - saldo) / 100 } : {}), ...(v.totalCentavos < saldo ? { reducaoDoSaldo: (saldo - v.totalCentavos) / 100 } : {}), motivo: v.motivo, ...extra },
  })

  // Cartão: pendente até a aprovação. Só o link é gerado, os antigos seguem valendo.
  if (cartoes.length) {
    const expiraEm = prazoDaTroca(antigos.map((t) => t.vencimento), hoje)
    if (cartoes[0]!.vencimento > expiraEm) return { ok: false, status: 400, erro: `O cartão precisa ser pago até ${dataBr(expiraEm)}, antes do próximo vencimento.` }
    const troca = await prisma.enrollmentTroca.create({ data: dadosDaTroca('PENDENTE', expiraEm) })
    await prisma.enrollmentTitulo.createMany({ data: novosDados(troca.id, 'aguardando') as any })
    const cartao = await prisma.enrollmentTitulo.findFirst({ where: { trocaId: troca.id, meio: 'credit_card' } })
    const g = await gerarCobrancaDoTitulo(cartao!.id)
    if (!g.ok) {
      await prisma.enrollmentTitulo.updateMany({ where: { trocaId: troca.id }, data: { status: 'cancelada' } })
      await prisma.enrollmentTroca.update({ where: { id: troca.id }, data: { status: 'CANCELADA', encerradaEm: new Date() } })
      return { ok: false, status: 502, erro: g.erro ?? 'Não foi possível gerar o link do cartão.' }
    }
    await registrar('troca_pagamento_criada', troca.id, { prazo: expiraEm })
    const atual = await prisma.enrollmentTitulo.findUnique({ where: { id: cartao!.id }, select: { invoiceUrl: true } })
    return { ok: true, trocaId: troca.id, pendente: true, link: atual?.invoiceUrl ?? null, falhas: g.aviso ? [g.aviso] : [] }
  }

  // Pix e boleto: vale na hora. Se algo não cancelar, o já cancelado volta a "não gerado" e segue como dívida.
  for (const t of antigos) {
    const r = await cancelarNoGateway(cfg, t)
    if (!r.ok) return { ok: false, status: 502, erro: `Não foi possível cancelar o pagamento ${t.ordem}: ${r.message}. Cancele no Asaas e tente de novo.` }
    await prisma.enrollmentTitulo.update({ where: { id: t.id }, data: { status: 'prevista', invoiceUrl: null, boletoPdfUrl: null, boletoLinha: null, pixCopiaCola: null } })
  }
  const troca = await prisma.enrollmentTroca.create({ data: { ...dadosDaTroca('CONCLUIDA', null), encerradaEm: new Date() } })
  await prisma.enrollmentTitulo.updateMany({ where: { id: { in: antigos.map((t) => t.id) } }, data: { status: 'substituida', trocaId: troca.id } })
  await prisma.enrollmentTitulo.createMany({ data: novosDados(troca.id, 'prevista') as any })
  const novos = await prisma.enrollmentTitulo.findMany({ where: { trocaId: troca.id, status: 'prevista' }, orderBy: { ordem: 'asc' } })
  const falhas = await gerarTodos(novos.map((t) => t.id))
  await acompanharNoAcademico(antigos, novos.map((t) => t.id))
  await recontarCombinado(registrationId)
  await registrar('troca_pagamento_concluida', troca.id, { falhas: falhas.length })
  anotarNoLead(reg.leadId, troca.id, saldo, v.totalCentavos, v.motivo, op)
  return { ok: true, trocaId: troca.id, pendente: false, link: null, falhas }
}

function anotarNoLead(leadId: number | null, trocaId: number, saldo: number, total: number, motivo: string, op: Operador | null) {
  if (!leadId) return
  logEvent({
    leadId, type: 'note_added', category: 'operator', title: `Forma de pagamento alterada (troca nº ${trocaId}): ${brl(saldo)}${total !== saldo ? ` → ${brl(total)}` : ''}`,
    channel: 'payment', source: 'troca_pagamento', actorType: op ? 'operator' : 'system', ...(op ? { userId: op.userId, userName: op.nome } : {}), description: motivo,
  } as any)
}

async function gerarTodos(ids: number[]) {
  const falhas: string[] = []
  let avisosJaAjustados = false
  for (const id of ids) {
    const r = await gerarCobrancaDoTitulo(id, { avisosJaAjustados })
    if (!r.ok) falhas.push(`Título ${id}: ${r.erro}`)
    else if (r.aviso && !falhas.includes(r.aviso)) falhas.push(r.aviso)
    else if (r.ok) avisosJaAjustados = true
  }
  return falhas
}

/** O cartão foi aprovado: os antigos saem e o resto da nova condição é gerado. Roda uma vez só. */
export async function concluirTroca(trocaId: number): Promise<void> {
  const r = await prisma.enrollmentTroca.updateMany({ where: { id: trocaId, status: 'PENDENTE' }, data: { status: 'CONCLUIDA', encerradaEm: new Date() } })
  if (r.count !== 1) return
  const troca = await prisma.enrollmentTroca.findUnique({ where: { id: trocaId } })
  if (!troca) return
  const registrationId = troca.registrationId
  const cfg = await configDaInscricao(registrationId)
  const idsAntigos = (troca.antes as any[]).map((a) => Number(a.id))
  const antigos = await prisma.enrollmentTitulo.findMany({ where: { id: { in: idsAntigos } } })
  const problemas: string[] = []
  for (const t of antigos) {
    if (!TITULO_EM_ABERTO.includes(t.status as any)) {
      // Foi pago enquanto o cartão não aprovava: entrou dinheiro pelos dois lados.
      if (t.status === 'paga') {
        await prisma.enrollmentTitulo.update({ where: { id: t.id }, data: { conferirEm: new Date(), lastError: `Pago e também substituído na troca nº ${trocaId}: conferir valor em dobro.` } })
        problemas.push(`pagamento ${t.ordem} já estava pago`)
      }
      continue
    }
    const p = cfg && t.externalId && t.provider === 'asaas' ? await consultarCobrancaAsaas(cfg, t.externalId).catch(() => null) : null
    if (p && ASAAS_STATUS_MAP[p.status] === 'paid') {
      await aplicarAvisoDoAsaas(t.id, 'SYNC', p)
      await prisma.enrollmentTitulo.update({ where: { id: t.id }, data: { conferirEm: new Date(), lastError: `Pago e também substituído na troca nº ${trocaId}: conferir valor em dobro.` } })
      problemas.push(`pagamento ${t.ordem} foi pago junto com o cartão`)
      continue
    }
    const c = await cancelarNoGateway(cfg, t)
    if (!c.ok) {
      await prisma.enrollmentTitulo.update({ where: { id: t.id }, data: { status: 'substituida', trocaId, conferirEm: new Date(), lastError: `Não cancelada no Asaas: ${c.message}. Cancele lá para não ser paga em dobro.` } })
      problemas.push(`pagamento ${t.ordem} não foi cancelado no Asaas`)
      continue
    }
    await prisma.enrollmentTitulo.update({ where: { id: t.id }, data: { status: 'substituida', trocaId } })
  }
  // O cartão segue aberto só se ainda não fechou; o resto da condição nasce agora.
  await prisma.enrollmentTitulo.updateMany({ where: { trocaId, status: 'aguardando', externalId: { not: null } }, data: { status: 'aberta' } })
  await prisma.enrollmentTitulo.updateMany({ where: { trocaId, status: 'aguardando', externalId: null }, data: { status: 'prevista' } })
  const novos = await prisma.enrollmentTitulo.findMany({ where: { trocaId, status: { in: ['prevista', 'aberta', 'paga'] } }, orderBy: { ordem: 'asc' } })
  const falhas = await gerarTodos(novos.filter((t) => t.status === 'prevista').map((t) => t.id))
  await acompanharNoAcademico(antigos.filter((t) => idsAntigos.includes(t.id)), novos.map((t) => t.id))
  await recontarCombinado(registrationId)
  await registrarEventoDaInscricao({
    registrationId, etapa: 'pagamento', acao: 'troca_pagamento_concluida', ator: 'sistema',
    dados: { troca: trocaId, novoTotal: troca.novoTotalCentavos / 100, motivo: troca.motivo, por: troca.criadoPorNome, ...(problemas.length ? { problemas } : {}), ...(falhas.length ? { falhas } : {}) },
  })
  anotarNoLead(troca.leadId, trocaId, troca.saldoCentavos, troca.novoTotalCentavos, troca.motivo, null)
}

/** Cancela a troca pendente. Os antigos nunca saíram, então nada mais muda. */
export async function encerrarTrocaPendente(trocaId: number, status: 'CANCELADA' | 'EXPIRADA', motivo: string, op: Operador | null): Promise<{ ok: true } | { ok: false; status: number; erro: string }> {
  const t = await prisma.enrollmentTroca.findUnique({ where: { id: trocaId } })
  if (!t || t.status !== 'PENDENTE') return { ok: false, status: 409, erro: 'Esta troca não está mais pendente.' }
  const cfg = await configDaInscricao(t.registrationId)
  const novos = await prisma.enrollmentTitulo.findMany({ where: { trocaId, status: 'aguardando' } })
  for (const n of novos) {
    const p = cfg && n.externalId && n.provider === 'asaas' ? await consultarCobrancaAsaas(cfg, n.externalId).catch(() => null) : null
    if (p && ASAAS_STATUS_MAP[p.status] === 'paid') {
      await aplicarAvisoDoAsaas(n.id, 'SYNC', p)
      return { ok: false, status: 409, erro: 'O cartão acabou de ser aprovado: a troca foi concluída.' }
    }
    const c = await cancelarNoGateway(cfg, n)
    if (!c.ok) return { ok: false, status: 502, erro: `Não foi possível cancelar o link: ${c.message}` }
    await prisma.enrollmentTitulo.update({ where: { id: n.id }, data: { status: 'cancelada', lastError: motivo.slice(0, 200) } })
  }
  await prisma.enrollmentTroca.update({ where: { id: trocaId }, data: { status, encerradaEm: new Date(), notaEncerramento: motivo.slice(0, 500) } })
  await registrarEventoDaInscricao({
    registrationId: t.registrationId, etapa: 'pagamento', acao: status === 'EXPIRADA' ? 'troca_pagamento_expirada' : 'troca_pagamento_cancelada',
    ator: op ? 'atendente' : 'sistema', userId: op?.userId ?? null, userName: op?.nome ?? null, dados: { troca: trocaId, motivo },
  })
  return { ok: true }
}

/** Link vencido e sem pagamento: desfaz sozinho. Chamada pela rotina de 30 em 30 minutos. */
export async function expirarTrocas(hoje = hojeBr()): Promise<number> {
  const vencidas = await prisma.enrollmentTroca.findMany({ where: { status: 'PENDENTE', expiraEm: { lt: hoje } }, select: { id: true } })
  let n = 0
  for (const t of vencidas) if ((await encerrarTrocaPendente(t.id, 'EXPIRADA', 'Prazo do cartão encerrado', null)).ok) n++
  return n
}

export async function estadoDaTroca(registrationId: number) {
  const reg = await prisma.enrollmentRegistration.findUnique({ where: { id: registrationId }, select: { contratoAceite: true } })
  const [titulos, trocas, assinaturas] = await Promise.all([
    prisma.enrollmentTitulo.findMany({ where: { registrationId }, orderBy: { ordem: 'asc' } }),
    prisma.enrollmentTroca.findMany({ where: { registrationId }, orderBy: { id: 'desc' } }),
    prisma.acaAssinatura.count({ where: { registrationId } }).catch(() => 0),
  ])
  const nome: Record<string, string> = { pix: 'Pix', boleto: 'Boleto', credit_card: 'Cartão' }
  const pendente = trocas.find((t) => t.status === 'PENDENTE') ?? null
  const cartao = pendente ? titulos.find((t) => t.trocaId === pendente.id && t.meio === 'credit_card') : null
  return {
    elegiveis: titulos.filter((t) => tituloElegivel(t)).map((t) => ({
      id: t.id, ordem: t.ordem, origem: t.origem, acordoId: t.acordoId, meio: nome[t.meio] ?? t.meio, valor: t.valorCentavos, vencimento: t.vencimento,
      grupo: t.totalDoGrupo ? `${t.parcelaDoGrupo} de ${t.totalDoGrupo}` : null,
    })),
    pendente: pendente ? { id: pendente.id, expiraEm: pendente.expiraEm, novoTotal: pendente.novoTotalCentavos, saldo: pendente.saldoCentavos, motivo: pendente.motivo, por: pendente.criadoPorNome, link: cartao?.invoiceUrl ?? null, parcelas: cartao?.parcelasCartao ?? 1 } : null,
    historico: trocas.map((t) => ({
      id: t.id, status: t.status, saldo: t.saldoCentavos, novoTotal: t.novoTotalCentavos, motivo: t.motivo, por: t.criadoPorNome, em: t.createdAt.toISOString(),
      encerradaEm: t.encerradaEm?.toISOString() ?? null, nota: t.notaEncerramento, antes: t.antes, depois: t.depois,
    })),
    contratoAssinado: !!reg?.contratoAceite || assinaturas > 0,
    prazoDias: PRAZO_DIAS,
  }
}
