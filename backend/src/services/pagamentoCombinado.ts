// services/pagamentoCombinado.ts
//
// PAGAMENTO COMBINADO (06/11/2026). Um curso pago em mais de um meio: Pix hoje,
// boleto no mês seguinte, o resto no cartão. Cada pagamento é um título com
// cobrança própria no gateway e referência `titulo-<id>`, para o aviso de um
// não mexer na situação da inscrição como se fosse a cobrança principal.
//
// A matrícula é confirmada no 1º pagamento recebido, como no boleto parcelado.
// O cartão sempre vai pela página do Asaas: nenhum dado de cartão passa pelo
// painel. O Asaas não agenda cartão por vencimento, então "hoje" e "depois" são
// a mesma cobrança hospedada, com data diferente; a recusa e o não pagamento
// aparecem na tela de inadimplência.

import { prisma } from '../lib/prisma.js'
import { decryptToken } from './cloudApi.js'
import {
  ASAAS_STATUS_MAP, dataDoPagamento, cancelarCobrancaAsaas, cancelarParcelamentoAsaas, consultarCobrancaAsaas, listarParcelasAsaas, silenciarAvisosDeCriacaoAsaas, createAsaasOrder, createAsaasPayment,
  createOrFindAsaasCustomer, fetchAsaasBoletoLinha, fetchAsaasPixQr, type AsaasConfig,
} from './paymentAsaas.js'
import { criarCobrancaSimulada, ehSimulado } from './pagamentoSimulado.js'
import { registrarEventoDaInscricao, type AtorDoEvento } from './inscricaoAssistida.js'
import { logEvent } from './leadHistory.js'

export const MEIOS = ['pix', 'boleto', 'credit_card'] as const
export type MeioDoTitulo = (typeof MEIOS)[number]
export type StatusDoTitulo = 'prevista' | 'aberta' | 'paga' | 'cancelada' | 'estornada' | 'renegociada' | 'substituida' | 'aguardando'
export const TITULO_EM_ABERTO: StatusDoTitulo[] = ['prevista', 'aberta']
/** Nova forma esperando o cartão de uma troca: ainda não é dívida, e os antigos seguem valendo. */
const PODE_RECEBER = ['prevista', 'aberta', 'aguardando']

const FECHADAS = ['cancelled', 'transferred', 'merged', 'expired']
const MAX_LINHAS = 6
const VALOR_MINIMO = 500 // R$ 5,00: abaixo disso o Asaas recusa cobrança
const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const NOME_DO_MEIO: Record<string, string> = { pix: 'Pix', boleto: 'Boleto', credit_card: 'Cartão' }
const dataBr = (iso: string) => iso.split('-').reverse().join('/')

export const hojeBr = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d)
const somarDias = (iso: string, dias: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10)
const emCentavos = (v: unknown) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? Math.round(n * 100) : NaN }
const dataValida = (v: unknown): string | null => {
  const s = String(v ?? '')
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`)) ? s : null
}

export interface LinhaDoCombinado { meio: MeioDoTitulo; valorCentavos: number; vencimento: string; parcelasCartao: number; parcelasBoleto: number }
/** Uma cobrança. Boleto parcelado vira uma por parcela, com data própria. */
export interface TituloDoCombinado { meio: MeioDoTitulo; valorCentavos: number; vencimento: string; parcelasCartao: number; parcelaDoGrupo: number | null; totalDoGrupo: number | null }
export interface CombinadoValidado {
  totalCentavos: number
  linhas: LinhaDoCombinado[]
  titulos: TituloDoCombinado[]
  motivo: string
  /** Desconto até o vencimento nos boletos. null = o agente deixou desligado. */
  descontoPct: number | null
}

const MAX_BOLETO = 24

/** A mesma data `meses` depois; no mês sem esse dia, o último dia dele. */
function somarMeses(iso: string, meses: number): string {
  const [a, m, d] = iso.split('-').map(Number) as [number, number, number]
  const alvo = new Date(Date.UTC(a, m - 1 + meses, 1))
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate()
  alvo.setUTCDate(Math.min(d, ultimo))
  return alvo.toISOString().slice(0, 10)
}

/** Os centavos que sobram da divisão vão na última parcela. */
function expandir(l: LinhaDoCombinado): TituloDoCombinado[] {
  if (l.parcelasBoleto <= 1) return [{ meio: l.meio, valorCentavos: l.valorCentavos, vencimento: l.vencimento, parcelasCartao: l.parcelasCartao, parcelaDoGrupo: null, totalDoGrupo: null }]
  const n = l.parcelasBoleto
  const parcela = Math.floor(l.valorCentavos / n)
  return Array.from({ length: n }, (_, i) => ({
    meio: l.meio, parcelasCartao: 1, parcelaDoGrupo: i + 1, totalDoGrupo: n,
    valorCentavos: i === n - 1 ? l.valorCentavos - parcela * (n - 1) : parcela,
    vencimento: somarMeses(l.vencimento, i),
  }))
}

/** Regras do formulário. Não toca o banco: é o que os testes exercitam. */
export function validarCombinado(body: any, hoje = hojeBr(), opts: { minLinhas?: number } = {}): CombinadoValidado | { erro: string } {
  const motivo = String(body?.motivo ?? '').trim()
  if (motivo.length < 3) return { erro: 'Informe o motivo da condição combinada.' }
  const totalCentavos = emCentavos(body?.total)
  if (!(totalCentavos > 0)) return { erro: 'Informe o valor total negociado.' }
  const brutas = Array.isArray(body?.linhas) ? body.linhas : []
  const minLinhas = opts.minLinhas ?? 2
  if (brutas.length < minLinhas) return { erro: minLinhas > 1 ? `Um pagamento combinado precisa de pelo menos ${minLinhas} pagamentos.` : 'Informe a nova forma de pagamento.' }
  if (brutas.length > MAX_LINHAS) return { erro: `O limite é de ${MAX_LINHAS} pagamentos.` }

  const linhas: LinhaDoCombinado[] = []
  for (const [i, l] of brutas.entries()) {
    const nome = `Pagamento ${i + 1}`
    if (!MEIOS.includes(l?.meio)) return { erro: `${nome}: escolha a forma de pagamento.` }
    const valorCentavos = emCentavos(l?.valor)
    if (!(valorCentavos >= VALOR_MINIMO)) return { erro: `${nome}: o valor mínimo é ${brl(VALOR_MINIMO)}.` }
    const vencimento = dataValida(l?.vencimento)
    if (!vencimento) return { erro: `${nome}: informe a data.` }
    if (vencimento < hoje) return { erro: `${nome}: a data não pode estar no passado.` }
    if (vencimento > somarDias(hoje, 400)) return { erro: `${nome}: a data pode ser de até 400 dias.` }
    const parcelasCartao = l.meio === 'credit_card' ? Math.round(Number(l?.parcelas ?? 1)) : 1
    if (!(parcelasCartao >= 1 && parcelasCartao <= 12)) return { erro: `${nome}: o cartão aceita de 1 a 12 vezes.` }
    const parcelasBoleto = l.meio === 'boleto' ? Math.round(Number(l?.parcelas ?? 1)) : 1
    if (!(parcelasBoleto >= 1 && parcelasBoleto <= MAX_BOLETO)) return { erro: `${nome}: o boleto aceita de 1 a ${MAX_BOLETO} vezes.` }
    if (Math.floor(valorCentavos / parcelasBoleto) < VALOR_MINIMO) return { erro: `${nome}: cada parcela precisa ser de pelo menos ${brl(VALOR_MINIMO)}.` }
    linhas.push({ meio: l.meio, valorCentavos, vencimento, parcelasCartao, parcelasBoleto })
  }
  const soma = linhas.reduce((s, l) => s + l.valorCentavos, 0)
  if (soma !== totalCentavos) return { erro: `A soma dos pagamentos (${brl(soma)}) precisa fechar com o total (${brl(totalCentavos)}).` }
  if (linhas.some((l) => l.vencimento < linhas[0]!.vencimento)) return { erro: 'O 1º pagamento precisa ser o de data mais próxima.' }

  let descontoPct: number | null = null
  if (body?.pontualidade?.ativo) {
    const pct = Number(String(body.pontualidade.pct ?? '').replace(',', '.'))
    if (!(pct > 0 && pct <= 90)) return { erro: 'O desconto de pontualidade deve ser de 0,01% a 90%.' }
    if (!linhas.some((l) => l.meio === 'boleto')) return { erro: 'O desconto de pontualidade só vale nos boletos, e não há boleto nesta combinação.' }
    descontoPct = pct
  }
  return { totalCentavos, linhas, titulos: linhas.flatMap(expandir), motivo: motivo.slice(0, 500), descontoPct }
}

/** "1) Pix R$ 500,00 em 06/11/2026; 2) Cartão em 5x ..." — vai para o contrato. */
export function descreverCombinado(
  linhas: Array<{ meio: string; valorCentavos: number; vencimento: string; parcelasCartao: number; parcelasBoleto?: number }>,
  totalCentavos: number,
  descontoPct: number | null = null,
): string {
  const itens = linhas.map((l, i) => {
    if ((l.parcelasBoleto ?? 1) > 1) {
      const t = expandir({ ...l, meio: 'boleto', parcelasBoleto: l.parcelasBoleto! })
      const ultima = t[t.length - 1]!
      const resto = ultima.valorCentavos !== t[0]!.valorCentavos ? ` (última de ${brl(ultima.valorCentavos)})` : ''
      return `${i + 1}) Boleto em ${t.length}x de ${brl(t[0]!.valorCentavos)}${resto}, total de ${brl(l.valorCentavos)}, a partir de ${dataBr(l.vencimento)}`
    }
    const forma = l.meio === 'credit_card' && l.parcelasCartao > 1 ? `Cartão em ${l.parcelasCartao}x` : NOME_DO_MEIO[l.meio] ?? l.meio
    return `${i + 1}) ${forma}: ${brl(l.valorCentavos)} em ${dataBr(l.vencimento)}`
  })
  const desconto = descontoPct ? `; boletos com ${descontoPct.toLocaleString('pt-BR')}% de desconto até o vencimento` : ''
  return `Pagamento combinado de ${brl(totalCentavos)}: ${itens.join('; ')}${desconto}`
}

// ─── Gateway ──────────────────────────────────────────

type Conexao = { provider: string; environment: string | null; apiKey: string | null; active: boolean }

export async function conexaoDaInscricao(registrationId: number) {
  const r = await prisma.enrollmentRegistration.findUnique({
    where: { id: registrationId },
    select: { portal: { select: { paymentConnection: { select: { provider: true, environment: true, apiKey: true, active: true } } } } },
  })
  return (r?.portal?.paymentConnection ?? null) as Conexao | null
}

function configAsaas(c: Conexao | null): AsaasConfig | null {
  if (!c || c.provider !== 'asaas' || !c.apiKey) return null
  try { return { apiKey: decryptToken(c.apiKey), environment: c.environment === 'production' ? 'production' : 'sandbox' } } catch { return null }
}

export async function configDaInscricao(registrationId: number): Promise<AsaasConfig | null> {
  return configAsaas(await conexaoDaInscricao(registrationId))
}

/** Primeira versão: só Asaas (e o simulado, para exercitar o fluxo). */
export const conexaoAceitaCombinado = (c: { provider: string; active: boolean } | null) =>
  !!c && c.active && (c.provider === 'asaas' || ehSimulado(c.provider))

/** Cria a cobrança do título no gateway. Se falhar, ele fica "prevista" com o erro à mostra. */
export async function gerarCobrancaDoTitulo(tituloId: number, opts: { avisosJaAjustados?: boolean } = {}): Promise<{ ok: boolean; erro?: string; aviso?: string }> {
  const t = await prisma.enrollmentTitulo.findUnique({
    where: { id: tituloId },
    include: { registration: { select: { id: true, candidateCode: true, leadId: true, formData: true, portal: { select: { nome: true } }, lead: { select: { nome: true, email: true, whatsapp: true } } } } },
  })
  if (!t) return { ok: false, erro: 'Pagamento não encontrado.' }
  if (!(t.status === 'prevista' || (t.status === 'aguardando' && !t.externalId))) return { ok: true }
  const statusGerado = t.status === 'aguardando' ? 'aguardando' : 'aberta'
  const conn = await conexaoDaInscricao(t.registrationId)
  if (!conexaoAceitaCombinado(conn)) {
    const erro = 'O portal desta inscrição não tem conexão Asaas ativa.'
    await prisma.enrollmentTitulo.update({ where: { id: t.id }, data: { lastError: erro } })
    return { ok: false, erro }
  }
  const reg = t.registration
  const fd = (reg.formData ?? {}) as Record<string, any>
  const valor = t.valorCentavos / 100
  const vencimento = new Date(`${t.vencimento}T12:00:00-03:00`)
  const prefixo = t.origem === 'acordo' ? `Acordo ${t.acordoId}` : 'Pagamento combinado'
  const descricao = `${prefixo} ${t.ordem} — ${reg.portal?.nome ?? 'Curso'} (${reg.candidateCode})`
  const referencia = `titulo-${t.id}`
  try {
    if (ehSimulado(conn!.provider)) {
      const sim = criarCobrancaSimulada({ metodo: t.meio as MeioDoTitulo, valor, vencimento, referencia, descricao })
      await prisma.enrollmentTitulo.update({
        where: { id: t.id },
        data: {
          status: statusGerado, provider: 'simulado', externalId: sim.chargeId, lastError: null,
          boletoLinha: sim.boletoLine ?? null, boletoPdfUrl: sim.boletoPdfUrl ?? null, pixCopiaCola: sim.pixQrCode ?? null,
        },
      })
      return { ok: true }
    }
    const cfg = configAsaas(conn)
    if (!cfg) throw new Error('Não foi possível abrir a chave do Asaas.')
    const cliente = {
      name: reg.lead?.nome || String(fd.nome || 'Aluno'), email: reg.lead?.email || fd.email || undefined,
      cpfCnpj: String(fd.cpf || '').replace(/\D/g, '') || undefined, mobilePhone: reg.lead?.whatsapp || fd.whatsapp || undefined,
      externalReference: `lead-${reg.leadId ?? 'unknown'}`,
    }
    if (!cliente.cpfCnpj) throw new Error('A inscrição não tem CPF: o Asaas exige para gerar a cobrança.')

    // Antes de criar a cobrança: o aviso de criação sai assim que ela nasce.
    const c = await createOrFindAsaasCustomer(cfg, cliente)
    const aviso = opts.avisosJaAjustados ? undefined : await silenciarAvisosDeCriacaoAsaas(cfg, c.id).then(() => undefined).catch((e: any) => `Avisos do Asaas não ajustados (${String(e?.message).slice(0, 120)}): o aluno pode receber e-mail e SMS desta cobrança.`)
    if (aviso) {
      await registrarEventoDaInscricao({ registrationId: t.registrationId, etapa: 'pagamento', acao: 'avisos_asaas_nao_ajustados', ator: 'sistema', dados: { titulo: t.id, aviso } })
    }

    if (t.meio === 'credit_card') {
      const o = await createAsaasOrder(cfg, {
        method: 'credit_card', customer: cliente as any, value: valor, dueDate: vencimento, description: descricao,
        externalReference: referencia, hospedado: true,
        ...(t.parcelasCartao > 1 ? { installmentCount: t.parcelasCartao } : {}),
      })
      await prisma.enrollmentTitulo.update({
        where: { id: t.id },
        data: { status: statusGerado, provider: 'asaas', externalId: o.paymentId, installmentId: o.installmentId ?? null, invoiceUrl: o.invoiceUrl ?? null, lastError: null },
      })
      return { ok: true, ...(aviso ? { aviso } : {}) }
    }

    const desconto = t.meio === 'boleto' && t.descontoPct ? Number(t.descontoPct) : 0
    const p = await createAsaasPayment(cfg, {
      customerId: c.id, billingType: t.meio === 'pix' ? 'PIX' : 'BOLETO', value: valor, dueDate: vencimento,
      description: descricao, externalReference: referencia,
      ...(desconto > 0 ? { descontoAntecipado: { dias: 0, pct: desconto } } : {}),
    } as any)
    const [pix, linha] = await Promise.all([
      // Boleto parcelado: muitas cobranças de uma vez; o Pix fica na página de pagamento.
      t.totalDoGrupo ? Promise.resolve(null) : fetchAsaasPixQr(cfg, p.id).catch(() => null),
      t.meio === 'boleto' ? fetchAsaasBoletoLinha(cfg, p.id).catch(() => null) : Promise.resolve(null),
    ])
    await prisma.enrollmentTitulo.update({
      where: { id: t.id },
      data: {
        status: statusGerado, provider: 'asaas', externalId: p.id, invoiceUrl: p.invoiceUrl ?? null, boletoPdfUrl: p.bankSlipUrl ?? null,
        boletoLinha: linha?.linha ?? null, pixCopiaCola: pix?.payload ?? null, lastError: null,
      },
    })
    return { ok: true, ...(aviso ? { aviso } : {}) }
  } catch (e: any) {
    const erro = String(e?.message || 'Falha ao gerar a cobrança.').slice(0, 500)
    await prisma.enrollmentTitulo.update({ where: { id: t.id }, data: { lastError: erro } })
    return { ok: false, erro }
  }
}

// ─── Criar e desfazer ─────────────────────────────────

export interface Operador { userId: number; nome: string }
type Resultado<T> = ({ ok: true } & T) | { ok: false; status: number; erro: string }

export async function criarCombinado(registrationId: number, body: any, op: Operador): Promise<Resultado<{ falhas: string[] }>> {
  const v = validarCombinado(body)
  if ('erro' in v) return { ok: false, status: 400, erro: v.erro }
  const reg = await prisma.enrollmentRegistration.findUnique({
    where: { id: registrationId }, select: { id: true, status: true, paymentStatus: true, paymentPlan: true, leadId: true },
  })
  if (!reg) return { ok: false, status: 404, erro: 'Inscrição não encontrada.' }
  if (reg.paymentStatus === 'paid') return { ok: false, status: 409, erro: 'A inscrição já tem pagamento confirmado.' }
  if (FECHADAS.includes(reg.status)) return { ok: false, status: 409, erro: 'Inscrição cancelada, expirada ou mesclada.' }
  if (!conexaoAceitaCombinado(await conexaoDaInscricao(registrationId))) {
    return { ok: false, status: 409, erro: 'O pagamento combinado funciona com a conexão Asaas, e este portal não tem uma ativa.' }
  }
  const jaTem = await prisma.enrollmentTitulo.count({ where: { registrationId, origem: 'combinado', status: { in: TITULO_EM_ABERTO } } })
  if (jaTem) return { ok: false, status: 409, erro: 'Já existe um pagamento combinado nesta inscrição. Desfaça antes de criar outro.' }

  // Cobranças antigas, com outro valor, não podem continuar pagáveis.
  const { cancelarCobrancasAbertas } = await import('./inscricaoDuplicada.js')
  const avisos = await cancelarCobrancasAbertas(registrationId, 'Substituída pelo pagamento combinado')
  if (avisos.length) return { ok: false, status: 502, erro: `Não foi possível cancelar a cobrança anterior: ${avisos.join('; ')}` }

  const criados = []
  for (const [i, l] of v.titulos.entries()) {
    criados.push(await prisma.enrollmentTitulo.create({
      data: {
        registrationId, origem: 'combinado', ordem: i + 1, meio: l.meio, parcelasCartao: l.parcelasCartao,
        parcelaDoGrupo: l.parcelaDoGrupo, totalDoGrupo: l.totalDoGrupo,
        valorCentavos: l.valorCentavos, vencimento: l.vencimento,
        ...(l.meio === 'boleto' && v.descontoPct ? { descontoPct: v.descontoPct } : {}),
      },
    }))
  }
  const descricao = descreverCombinado(v.linhas, v.totalCentavos, v.descontoPct)
  const plano = (reg.paymentPlan ?? {}) as Record<string, any>
  const primeiro = v.titulos[0]!
  await prisma.enrollmentRegistration.update({
    where: { id: registrationId },
    data: {
      paymentAmount: primeiro.valorCentavos / 100,
      paymentMethod: 'COMBINADO',
      paymentStatus: 'pending',
      paymentExpiresAt: new Date(`${primeiro.vencimento}T23:59:00-03:00`),
      atendidoPorUserId: op.userId,
      paymentPlan: {
        ...(plano.planoFinanceiro ? { planoFinanceiro: plano.planoFinanceiro } : {}),
        meio: 'combinado', escopo: 'curso', rotulo: 'Pagamento combinado', parcelas: v.titulos.length,
        valorTotal: v.totalCentavos / 100, valorTabela: v.totalCentavos / 100, valorCobrado: primeiro.valorCentavos / 100,
        combinado: { descricao, motivo: v.motivo, descontoPct: v.descontoPct, por: op.nome, porUserId: op.userId, em: new Date().toISOString() },
      } as any,
    },
  })

  const falhas: string[] = []
  let avisosJaAjustados = false
  for (const t of criados) {
    const r = await gerarCobrancaDoTitulo(t.id, { avisosJaAjustados })
    if (!r.ok) falhas.push(`Pagamento ${t.ordem}: ${r.erro}`)
    else if (r.aviso && !falhas.includes(r.aviso)) falhas.push(r.aviso)
    else if (r.ok) avisosJaAjustados = true
  }
  const um = await prisma.enrollmentTitulo.findUnique({ where: { id: criados[0]!.id }, select: { externalId: true, invoiceUrl: true } })
  if (um?.externalId) {
    await prisma.enrollmentRegistration.update({ where: { id: registrationId }, data: { paymentId: um.externalId, paymentUrl: um.invoiceUrl ?? null } })
  }
  await registrarEventoDaInscricao({
    registrationId, etapa: 'pagamento', acao: 'combinado_criado', ator: 'atendente', userId: op.userId, userName: op.nome,
    dados: { total: v.totalCentavos / 100, descricao, motivo: v.motivo, falhas: falhas.length },
  })
  return { ok: true, falhas }
}

/** Tira do Asaas a cobrança do título, inteira quando for parcelada. */
// Exclusões que o PRÓPRIO sistema pediu ao Asaas. O aviso de exclusão que chega
// delas não é sumiço de dívida: quem pediu grava o novo estado (substituída,
// cancelada com motivo, prevista para gerar de novo). Fica marcada por 2 min
// depois do sucesso, que é quando o aviso costuma chegar.
const exclusoesDoSistema = new Set<string>()
export function exclusaoPedidaPeloSistema(payment: any): boolean {
  return [payment?.id, payment?.installment].some((x) => x && exclusoesDoSistema.has(String(x)))
}

export async function cancelarNoGateway(cfg: AsaasConfig | null, t: { externalId: string | null; installmentId: string | null; provider: string | null }): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!t.externalId || t.provider !== 'asaas') return { ok: true }
  if (!cfg) return { ok: false, message: 'conexão Asaas indisponível' }
  const ids = [t.externalId, t.installmentId].filter(Boolean) as string[]
  ids.forEach((x) => exclusoesDoSistema.add(x))
  const r = t.installmentId ? await cancelarParcelamentoAsaas(cfg, t.installmentId) : await cancelarCobrancaAsaas(cfg, t.externalId)
  // Falhou: a marca sai já — se o Asaas ainda apagar depois, o aviso trata como
  // exclusão de fora e a dívida continua (ver aplicarAvisoDoAsaas).
  if (!r.ok) ids.forEach((x) => exclusoesDoSistema.delete(x))
  else setTimeout(() => ids.forEach((x) => exclusoesDoSistema.delete(x)), 120_000).unref?.()
  return r.ok ? { ok: true } : { ok: false, message: (r as any).message }
}

/**
 * Cancela o que está em aberto, no gateway e aqui. Chamada também por
 * cancelarCobrancasAbertas: qualquer fluxo que zera as cobranças da inscrição
 * (retomada, novo valor, mescla) passa a zerar o combinado junto.
 */
export async function cancelarTitulosAbertos(registrationId: number, motivo: string, filtro: { origem?: string; acordoId?: number } = { origem: 'combinado' }): Promise<string[]> {
  // Troca pendente: o link do cartão também sai, e os antigos são tratados logo abaixo.
  if (filtro.origem === 'combinado') {
    const { encerrarTrocaPendente } = await import('./trocaPagamento.js')
    const pendentes = await prisma.enrollmentTroca.findMany({ where: { registrationId, status: 'PENDENTE' }, select: { id: true } })
    for (const p of pendentes) await encerrarTrocaPendente(p.id, 'CANCELADA', motivo, null)
  }
  const abertos = await prisma.enrollmentTitulo.findMany({ where: { registrationId, status: { in: TITULO_EM_ABERTO }, ...filtro } })
  if (!abertos.length) return []
  const cfg = configAsaas(await conexaoDaInscricao(registrationId))
  const avisos: string[] = []
  for (const t of abertos) {
    const r = await cancelarNoGateway(cfg, t)
    if (!r.ok) {
      avisos.push(`Asaas ${t.externalId}: ${r.message} — cancele no painel do Asaas`)
      await prisma.enrollmentTitulo.update({ where: { id: t.id }, data: { lastError: `Não cancelada: ${r.message}` } })
      continue
    }
    await prisma.enrollmentTitulo.update({ where: { id: t.id }, data: { status: 'cancelada', lastError: motivo.slice(0, 200) } })
  }
  // Sem nada pago nem em aberto, a combinação deixa de existir: a tela volta ao checkout.
  if (filtro.origem === 'combinado' && !avisos.length) {
    const resta = await prisma.enrollmentTitulo.count({ where: { registrationId, origem: 'combinado', status: { in: ['prevista', 'aberta', 'paga'] } } })
    if (!resta) {
      const reg = await prisma.enrollmentRegistration.findUnique({ where: { id: registrationId }, select: { paymentPlan: true } })
      const { combinado: _c, ...resto } = (reg?.paymentPlan ?? {}) as Record<string, any>
      await prisma.enrollmentRegistration.update({ where: { id: registrationId }, data: { paymentMethod: null, paymentPlan: { ...(resto.planoFinanceiro ? { planoFinanceiro: resto.planoFinanceiro } : {}) } as any } })
    }
  }
  return avisos
}

export async function desfazerCombinado(registrationId: number, op: Operador): Promise<Resultado<{ avisos: string[] }>> {
  if (await prisma.enrollmentTroca.count({ where: { registrationId, status: 'PENDENTE' } })) return { ok: false, status: 409, erro: 'Há uma troca aguardando o cartão. Cancele a troca antes de desfazer.' }
  const pagos = await prisma.enrollmentTitulo.count({ where: { registrationId, origem: 'combinado', status: 'paga' } })
  if (pagos) return { ok: false, status: 409, erro: 'Já há pagamento recebido nesta combinação: ela não pode ser desfeita.' }
  const avisos = await cancelarTitulosAbertos(registrationId, 'Combinação desfeita')
  if (avisos.length) return { ok: false, status: 502, erro: avisos.join('; ') }
  const reg = await prisma.enrollmentRegistration.findUnique({ where: { id: registrationId }, select: { paymentPlan: true } })
  const { combinado: _c, ...resto } = (reg?.paymentPlan ?? {}) as Record<string, any>
  await prisma.enrollmentRegistration.update({
    where: { id: registrationId },
    data: { paymentStatus: null, paymentId: null, paymentUrl: null, paymentExpiresAt: null, paymentMethod: null, paymentAmount: null, paymentPlan: { ...(resto.planoFinanceiro ? { planoFinanceiro: resto.planoFinanceiro } : {}) } as any },
  })
  await registrarEventoDaInscricao({ registrationId, etapa: 'pagamento', acao: 'combinado_desfeito', ator: 'atendente', userId: op.userId, userName: op.nome })
  return { ok: true, avisos: [] }
}

// ─── Mudança de situação ──────────────────────────────

/** 1º pagamento recebido: mesmos efeitos do webhook da cobrança principal, uma vez só. */
async function confirmarInscricao(registrationId: number, quando: Date, fonte: string) {
  const r = await prisma.enrollmentRegistration.updateMany({
    where: { id: registrationId, OR: [{ paymentStatus: null }, { paymentStatus: { not: 'paid' } }] },
    data: { paymentStatus: 'paid', paymentPaidAt: quando, status: 'paid' },
  })
  if (r.count !== 1) return
  const reg = await prisma.enrollmentRegistration.findUnique({ where: { id: registrationId }, select: { portalId: true, leadId: true, candidateCode: true } })
  if (reg?.portalId) await prisma.enrollmentPortal.update({ where: { id: reg.portalId }, data: { conversions: { increment: 1 } } }).catch(() => {})
  if (reg?.leadId) {
    logEvent({
      leadId: reg.leadId, type: 'payment_received', category: 'lifecycle', title: `Pagamento recebido — ${reg.candidateCode}`,
      channel: 'payment', source: fonte, actorType: 'system', metadata: { registrationId, combinado: true },
    })
  }
  import('./enrollmentNotify.js').then((m) => m.sendPaymentConfirmation?.({ enrollmentId: registrationId }).catch(() => {})).catch(() => {})
}

/** O valor da inscrição nos relatórios passa a ser o que já entrou. */
async function atualizarRecebido(registrationId: number) {
  // Parcelamento pago em parte já entrou, mesmo com o título ainda em aberto.
  const pagos = await prisma.enrollmentTitulo.aggregate({ where: { registrationId, origem: 'combinado', status: { in: ['paga', 'aberta', 'aguardando'] } }, _sum: { valorPagoCentavos: true } })
  const soma = pagos._sum.valorPagoCentavos ?? 0
  if (soma <= 0) return
  const reg = await prisma.enrollmentRegistration.findUnique({ where: { id: registrationId }, select: { paymentPlan: true } })
  const plano = (reg?.paymentPlan ?? {}) as Record<string, any>
  if (!plano.combinado) return
  await prisma.enrollmentRegistration.update({
    where: { id: registrationId },
    data: { paymentAmount: soma / 100, paymentPlan: { ...plano, valorCobrado: soma / 100 } as any },
  })
}

async function fecharAcordoSeQuitado(acordoId: number | null) {
  if (!acordoId) return
  const abertos = await prisma.enrollmentTitulo.count({ where: { acordoId, origem: 'acordo', status: { in: TITULO_EM_ABERTO } } })
  if (!abertos) await prisma.enrollmentAcordo.updateMany({ where: { id: acordoId, status: 'ATIVO' }, data: { status: 'QUITADO' } })
}

export async function registrarPagamentoDoTitulo(tituloId: number, p: {
  valorPagoCentavos?: number; quando?: Date; fonte: string; baixaManual?: string | null; pagoComo?: string | null
  ator?: AtorDoEvento; userId?: number | null; userName?: string | null
}): Promise<boolean> {
  const quando = p.quando ?? new Date()
  const t = await prisma.enrollmentTitulo.findUnique({ where: { id: tituloId } })
  if (!t) return false
  const r = await prisma.enrollmentTitulo.updateMany({
    where: { id: tituloId, status: { in: PODE_RECEBER } },
    data: { status: 'paga', paidAt: quando, valorPagoCentavos: p.valorPagoCentavos ?? t.valorCentavos, lastError: null, ...(p.pagoComo ? { pagoComo: p.pagoComo } : {}), ...(p.baixaManual ? { baixaManual: p.baixaManual.slice(0, 500) } : {}) },
  })
  if (r.count !== 1) return false
  if (t.trocaId && t.status === 'aguardando') await (await import('./trocaPagamento.js')).concluirTroca(t.trocaId)
  if (t.externalId) {
    await prisma.acaParcela.updateMany({
      where: { asaasChargeId: t.externalId, situacao: { in: ['ABERTA', 'VENCIDA'] } },
      data: { situacao: 'PAGA', pagoEm: quando, valorPagoCentavos: p.valorPagoCentavos ?? t.valorCentavos },
    }).catch(() => {})
  }
  await confirmarInscricao(t.registrationId, quando, p.fonte)
  await atualizarRecebido(t.registrationId)
  await fecharAcordoSeQuitado(t.acordoId)
  await registrarEventoDaInscricao({
    registrationId: t.registrationId, etapa: 'pagamento', acao: 'titulo_pago', ator: p.ator ?? 'sistema',
    userId: p.userId ?? null, userName: p.userName ?? null,
    dados: { ordem: t.ordem, meio: t.meio, valor: t.valorCentavos / 100, fonte: p.fonte, ...(p.baixaManual ? { baixaManual: p.baixaManual } : {}) },
  })
  return true
}

/** billingType do Asaas no pagamento → meio do sistema. */
export const meioDoAsaas = (b: unknown): string | null => ({ PIX: 'pix', BOLETO: 'boleto', CREDIT_CARD: 'credit_card', DEBIT_CARD: 'credit_card' } as Record<string, string>)[String(b ?? '').toUpperCase()] ?? null

/** Quanto de um parcelamento já foi pago. Pura: é o que os testes exercitam. */
export function situacaoDoParcelamento(parcelas: Array<{ status?: string; deleted?: boolean; value?: number }>) {
  const vivas = parcelas.filter((p) => !p.deleted)
  const pagas = vivas.filter((p) => ASAAS_STATUS_MAP[String(p.status)] === 'paid')
  return { quitado: vivas.length > 0 && pagas.length === vivas.length, pagoCentavos: pagas.reduce((s, p) => s + Math.round(Number(p.value ?? 0) * 100), 0) }
}

/** Aviso do Asaas para `titulo-<id>`. A inscrição só muda na confirmação do pagamento. */
export async function aplicarAvisoDoAsaas(tituloId: number, event: string, payment: any): Promise<number | null> {
  const t = await prisma.enrollmentTitulo.findUnique({ where: { id: tituloId }, select: { id: true, registrationId: true, status: true, externalId: true, installmentId: true, trocaId: true, conferirEm: true } })
  if (!t) return null
  const apagada = event === 'PAYMENT_DELETED' || payment?.deleted === true
  const novo = apagada ? 'canceled' : (ASAAS_STATUS_MAP[payment?.status] || 'pending')
  // Dinheiro em título que já saiu da condição: não se perde nem conta em silêncio.
  if (novo === 'paid' && ['substituida', 'renegociada', 'cancelada'].includes(t.status)) {
    if (!t.conferirEm) {
      await prisma.enrollmentTitulo.update({
        where: { id: t.id },
        data: { conferirEm: new Date(), valorPagoCentavos: payment?.value != null ? Math.round(Number(payment.value) * 100) : 0, paidAt: dataDoPagamento(payment?.paymentDate), lastError: 'Pagamento recebido em título já substituído: tratar crédito ou devolução.' },
      })
      await registrarEventoDaInscricao({ registrationId: t.registrationId, etapa: 'pagamento', acao: 'pagamento_em_titulo_substituido', ator: 'sistema', dados: { titulo: t.id, valor: payment?.value ?? null } })
    }
    return t.registrationId
  }
  if (novo === 'paid') {
    const quando = dataDoPagamento(payment?.paymentDate)
    // Compra aprovada no cartão: a troca conclui já na 1ª parcela confirmada.
    if (t.trocaId && t.status === 'aguardando' && t.installmentId) await (await import('./trocaPagamento.js')).concluirTroca(t.trocaId)
    if (t.installmentId) {
      // Cada parcela avisa. O título só fecha com todas pagas; o valor pago é o que
      // o Asaas diz, e a 1ª parcela já basta para confirmar a matrícula.
      const cfg = configAsaas(await conexaoDaInscricao(t.registrationId))
      const lista = cfg ? await listarParcelasAsaas(cfg, t.installmentId).catch(() => null) : null
      await confirmarInscricao(t.registrationId, quando, 'asaas')
      if (!lista) return t.registrationId // a sincronização tenta de novo
      const s = situacaoDoParcelamento(lista)
      if (!s.quitado) {
        await prisma.enrollmentTitulo.updateMany({ where: { id: t.id, status: { in: ['aberta', 'aguardando'] } }, data: { valorPagoCentavos: s.pagoCentavos } })
        await atualizarRecebido(t.registrationId)
        return t.registrationId
      }
      await registrarPagamentoDoTitulo(t.id, { fonte: 'asaas', quando, valorPagoCentavos: s.pagoCentavos, pagoComo: meioDoAsaas(payment?.billingType) })
      return t.registrationId
    }
    await registrarPagamentoDoTitulo(t.id, {
      fonte: 'asaas', quando, pagoComo: meioDoAsaas(payment?.billingType),
      ...(payment?.value != null ? { valorPagoCentavos: Math.round(Number(payment.value) * 100) } : {}),
    })
  } else if (apagada && (TITULO_EM_ABERTO as string[]).concat('aguardando').includes(t.status) && t.externalId === payment?.id) {
    // Título renegociado já saiu de "em aberto": o aviso de exclusão não o altera.
    if (exclusaoPedidaPeloSistema(payment)) {
      // Exclusão pedida por um fluxo daqui: ele mesmo grava o estado novo.
    } else if (t.status === 'aguardando') {
      // Link do cartão de uma troca pendente: os títulos antigos seguem valendo.
      await prisma.enrollmentTitulo.update({ where: { id: t.id }, data: { status: 'cancelada', lastError: 'Excluída no Asaas' } })
    } else {
      // Apagada no Asaas sem passar por um fluxo daqui (no painel do Asaas, ou um
      // pedido que respondeu erro e concluiu depois). A DÍVIDA NÃO SOME: o título
      // volta a "não gerado", com alerta em Inadimplência › A conferir. Para baixar
      // o valor é preciso outra cobrança no lugar ou uma baixa com motivo.
      const quando = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
      await prisma.enrollmentTitulo.update({ where: { id: t.id }, data: {
        status: 'prevista', externalId: null, installmentId: null, invoiceUrl: null, boletoPdfUrl: null, boletoLinha: null, pixCopiaCola: null,
        conferirEm: new Date(), conferidoEm: null,
        lastError: `Cobrança ${payment?.id ?? ''} excluída no Asaas em ${quando}, fora do sistema. A dívida continua: gere uma nova cobrança (troca ou 2ª via) ou registre o motivo da baixa.`.slice(0, 500),
      } })
      await registrarEventoDaInscricao({ registrationId: t.registrationId, etapa: 'pagamento', acao: 'cobranca_excluida_no_asaas', ator: 'sistema', dados: { titulo: t.id, cobranca: payment?.id ?? null, parcelamento: payment?.installment ?? null, valor: payment?.value ?? null, dividaMantida: true } })
    }
  } else if (novo === 'refunded' && t.status === 'paga') {
    await prisma.enrollmentTitulo.update({ where: { id: t.id }, data: { status: 'estornada', valorPagoCentavos: 0 } })
    await atualizarRecebido(t.registrationId)
    await registrarEventoDaInscricao({ registrationId: t.registrationId, etapa: 'pagamento', acao: 'titulo_estornado', ator: 'sistema', dados: { titulo: t.id } })
  }
  return t.registrationId
}

/** Aviso do Asaas para a parcela gerada pelo aluno no Meu Portal (`portal-parcela:reg:n`). */
export async function aplicarAvisoDaParcelaDoPortal(registrationId: number, numero: number, event: string, payment: any): Promise<boolean> {
  const reg = await prisma.enrollmentRegistration.findUnique({ where: { id: registrationId }, select: { paymentPlan: true } })
  const plano = (reg?.paymentPlan ?? null) as Record<string, any> | null
  const atual = plano?.parcelasPortal?.[String(numero)]
  if (!plano || !atual) return false
  const apagada = event === 'PAYMENT_DELETED' || payment?.deleted === true
  const novo = apagada ? 'canceled' : (ASAAS_STATUS_MAP[payment?.status] || 'pending')
  const situacao = novo === 'paid' ? 'paga' : novo === 'canceled' ? 'cancelada' : novo === 'refunded' ? 'estornada' : 'aberta'
  if (atual.situacao === situacao || atual.situacao === 'renegociada') return true
  const pagaEm = payment?.paymentDate ?? hojeBr()
  await prisma.enrollmentRegistration.update({
    where: { id: registrationId },
    data: { paymentPlan: { ...plano, parcelasPortal: { ...plano.parcelasPortal, [String(numero)]: { ...atual, situacao, ...(novo === 'paid' ? { pagaEm } : {}) } } } as any },
  })
  // Parcela paga pelo Meu Portal: entra no histórico da inscrição e no do lead.
  // Antes só o Meu Portal sabia — a inscrição e o Financeiro não registravam nada.
  if (situacao === 'paga' || situacao === 'estornada') {
    await registrarEventoDaInscricao({ registrationId, etapa: 'pagamento', acao: situacao === 'paga' ? 'parcela_paga' : 'parcela_estornada', ator: 'sistema', dados: { parcela: numero, valor: atual.valor ?? null, cobranca: atual.id ?? null, pagaEm: situacao === 'paga' ? pagaEm : null, vencimento: atual.vencimento ?? null } })
    const r = await prisma.enrollmentRegistration.findUnique({ where: { id: registrationId }, select: { leadId: true, candidateCode: true } })
    if (r?.leadId) {
      const total = Number(plano.parcelas) || null
      logEvent({
        leadId: r.leadId, type: situacao === 'paga' ? 'payment_received' : 'payment_refunded', category: 'lifecycle', channel: 'payment', source: 'asaas', actorType: 'system',
        title: `${situacao === 'paga' ? 'Parcela paga' : 'Parcela estornada'} — ${numero}${total ? ` de ${total}` : ''} · ${r.candidateCode}`,
        description: atual.valor != null ? `R$ ${Number(atual.valor).toFixed(2).replace('.', ',')}${atual.vencimento ? ` · vencimento ${String(atual.vencimento).split('-').reverse().join('/')}` : ''}` : undefined,
        metadata: { parcela: numero, paymentId: atual.id ?? null, origem: 'meu_portal' },
      })
    }
  }
  return true
}

/** Rede de segurança: aviso perdido não pode virar inadimplência falsa. */
export async function sincronizarRecebiveis(limite = 200): Promise<{ conferidos: number; erros: number }> {
  let conferidos = 0, erros = 0
  const titulos = await prisma.enrollmentTitulo.findMany({
    where: { status: { in: ['aberta', 'aguardando'] }, provider: 'asaas', externalId: { not: null } },
    orderBy: { updatedAt: 'asc' }, take: limite, select: { id: true, registrationId: true, externalId: true },
  })
  const configs = new Map<number, AsaasConfig | null>()
  const cfgDe = async (regId: number) => {
    if (!configs.has(regId)) configs.set(regId, configAsaas(await conexaoDaInscricao(regId)))
    return configs.get(regId) ?? null
  }
  for (const t of titulos) {
    const cfg = await cfgDe(t.registrationId)
    if (!cfg) continue
    try {
      const p = await consultarCobrancaAsaas(cfg, t.externalId!)
      await aplicarAvisoDoAsaas(t.id, p.deleted ? 'PAYMENT_DELETED' : 'SYNC', p)
      await prisma.enrollmentTitulo.updateMany({ where: { id: t.id, status: { in: ['aberta', 'aguardando'] } }, data: { updatedAt: new Date() } })
      conferidos++
    } catch { erros++ }
  }
  const regs = await prisma.enrollmentRegistration.findMany({
    where: { paymentStatus: 'paid', paymentPlan: { path: '$.meio', equals: 'boleto' } },
    select: { id: true, paymentPlan: true }, orderBy: { updatedAt: 'desc' },
  })
  for (const r of regs) {
    const parcelas = ((r.paymentPlan as any)?.parcelasPortal ?? {}) as Record<string, any>
    for (const [n, g] of Object.entries(parcelas)) {
      if (!g?.id || ['paga', 'cancelada', 'estornada', 'renegociada'].includes(g.situacao)) continue
      const cfg = await cfgDe(r.id)
      if (!cfg) continue
      try {
        const p = await consultarCobrancaAsaas(cfg, g.id)
        await aplicarAvisoDaParcelaDoPortal(r.id, Number(n), p.deleted ? 'PAYMENT_DELETED' : 'SYNC', p)
        conferidos++
      } catch { erros++ }
    }
  }
  // Depois de conferir: cartão pago no prazo conclui a troca, e só o resto expira.
  await (await import('./trocaPagamento.js')).expirarTrocas().catch(() => 0)
  return { conferidos, erros }
}

export function startSincronizarRecebiveis() {
  const rodar = () => { void sincronizarRecebiveis().catch(() => {}) }
  setTimeout(rodar, 90_000).unref?.()
  setInterval(rodar, 30 * 60_000).unref?.()
}

// ─── Leitura ──────────────────────────────────────────

export const situacaoDoTitulo = (t: { status: string; vencimento: string; externalId?: string | null }, hoje = hojeBr()) =>
  t.status === 'aguardando'
    ? (t.externalId ? 'aberta' : 'prevista')
    : TITULO_EM_ABERTO.includes(t.status as StatusDoTitulo)
      ? (t.vencimento < hoje ? 'vencida' : t.status === 'prevista' ? 'prevista' : 'aberta')
      : t.status === 'renegociada' || t.status === 'substituida' ? 'cancelada' : t.status

export function faturaDoTitulo(t: any, total: number) {
  const situacao = situacaoDoTitulo(t)
  const aberta = situacao === 'aberta' || situacao === 'vencida'
  return {
    chave: `titulo:${t.id}`,
    titulo: t.status !== 'substituida' && t.trocaId ? 'Nova forma de pagamento' : t.origem === 'acordo' ? `Acordo nº ${t.acordoId} · pagamento ${t.ordem}` : `Pagamento ${t.ordem}${total >= t.ordem ? ` de ${total}` : ''}`,
    detalhe: t.status === 'substituida' ? 'Substituído por outra forma de pagamento' : t.status === 'aguardando' && t.externalId ? `${t.parcelasCartao > 1 ? `Em ${t.parcelasCartao}x no cartão. ` : ''}Quando aprovado, substitui os pagamentos em aberto` : t.status === 'renegociada' ? `Renegociado no acordo nº ${t.acordoId}` : t.totalDoGrupo ? `Boleto ${t.parcelaDoGrupo} de ${t.totalDoGrupo}` : t.meio === 'credit_card' && t.parcelasCartao > 1 ? `em ${t.parcelasCartao}x no cartão` : null,
    valor: t.valorCentavos / 100,
    vencimento: t.vencimento,
    situacao,
    pagaEm: t.paidAt ? new Date(t.paidAt).toISOString() : null,
    meio: NOME_DO_MEIO[t.meio] ?? t.meio,
    pagar: aberta ? (t.invoiceUrl || null) : null,
    boletoPdf: aberta ? (t.boletoPdfUrl || null) : null,
    recibo: null,
    pix: aberta ? (t.pixCopiaCola || null) : null,
    linha: aberta ? (t.boletoLinha || null) : null,
    buscarCodigos: false,
    podeGerar: false,
    podeAtualizar: situacao === 'vencida' && t.meio !== 'credit_card' && !!t.externalId && (!t.provider || t.provider === 'asaas'),
  }
}

export async function faturasDosTitulos(registrationId: number, somente?: 'combinado' | 'acordo') {
  const titulos = await prisma.enrollmentTitulo.findMany({
    where: { registrationId, ...(somente ? { origem: somente } : {}), NOT: { status: 'cancelada' } },
    orderBy: [{ origem: 'desc' }, { ordem: 'asc' }],
  })
  // A numeração é a da combinação original: a nova forma entra com rótulo próprio.
  const total = titulos.filter((t) => t.origem === 'combinado' && (!t.trocaId || t.status === 'substituida')).length
  // O que ainda não tem cobrança, à espera do cartão de uma troca, não aparece ao aluno.
  return titulos.filter((t) => !(t.status === 'aguardando' && !t.externalId)).map((t) => faturaDoTitulo(t, total))
}

/** O que a tela de pagamento do aluno e a aba Financeiro mostram. null = sem combinação. */
export async function resumoDoCombinado(registrationId: number) {
  const reg = await prisma.enrollmentRegistration.findUnique({ where: { id: registrationId }, select: { paymentPlan: true } })
  const c = (reg?.paymentPlan as any)?.combinado
  if (!c) return null
  const titulos = await prisma.enrollmentTitulo.findMany({ where: { registrationId, origem: 'combinado', NOT: { status: 'cancelada' } }, orderBy: { ordem: 'asc' } })
  return {
    descricao: String(c.descricao ?? ''), motivo: c.motivo ?? null, por: c.por ?? null, em: c.em ?? null, descontoPct: c.descontoPct ?? null,
    total: titulos.filter((t) => !['substituida', 'aguardando'].includes(t.status)).reduce((s, t) => s + t.valorCentavos, 0) / 100,
    pago: titulos.reduce((s, t) => s + (t.status === 'paga' ? t.valorPagoCentavos : 0), 0) / 100,
    pagamentos: titulos.filter((t) => !(t.status === 'aguardando' && !t.externalId)).map((t) => ({ ...faturaDoTitulo(t, titulos.filter((x) => !x.trocaId || x.status === 'substituida').length), id: t.id, status: t.status, erro: t.lastError, provider: t.provider })),
  }
}

/** Parcelas do acadêmico: cada título vira uma parcela, ligada à mesma cobrança. */
export async function parcelasDoCombinado(registrationId: number | null | undefined) {
  if (!registrationId) return null
  const reg = await prisma.enrollmentRegistration.findUnique({ where: { id: registrationId }, select: { paymentPlan: true } })
  if (!(reg?.paymentPlan as any)?.combinado) return null
  const titulos = await prisma.enrollmentTitulo.findMany({ where: { registrationId, origem: 'combinado', status: { in: ['prevista', 'aberta', 'paga'] } }, orderBy: { ordem: 'asc' } })
  return titulos.length ? titulos : null
}
