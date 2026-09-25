// src/services/acaFinanceiro.ts
// Módulo Acadêmico · P5 — Financeiro. A "verdade financeira" vive aqui
// (AcaContrato/AcaParcela em centavos). O Asaas é só o braço bancário (emite
// boleto/PIX e confirma por webhook), reusando services/paymentAsaas.ts e a
// PaymentProviderConnection existente. Idempotência via AcaIntegracaoEvento.

import { prisma } from '../lib/prisma.js'
import { calcularEncargos, getEncargosConfig } from './acaEncargos.js'
import {
  createOrFindAsaasCustomer, createAsaasPayment, fetchAsaasPixQr, getAsaasPaymentStatus,
  ASAAS_STATUS_MAP, isAsaasPaymentEvent, type AsaasConfig, type AsaasWebhookPayload,
} from './paymentAsaas.js'
import {
  iuguDaConexao, criarFaturaIugu, buscarFaturaIugu, baixaExternaIugu, dataIugu,
  type IuguFatura,
} from './paymentIugu.js'
import { appUrl } from '../lib/appUrl.js'

/** Config do Asaas a partir da conexão ativa (apiKey decifrada). null se não houver. */
export async function getAsaasConfig(): Promise<AsaasConfig | null> {
  const conn = await prisma.paymentProviderConnection.findFirst({ where: { provider: 'asaas', active: true }, orderBy: { id: 'desc' } })
  return abrirConexao(conn)
}

async function abrirConexao(conn: { apiKey: string; environment: string } | null): Promise<AsaasConfig | null> {
  if (!conn) return null
  try {
    const { decryptToken } = await import('./cloudApi.js')
    return { apiKey: decryptToken(conn.apiKey), environment: conn.environment === 'production' ? 'production' : 'sandbox', billingType: 'UNDEFINED' }
  } catch { return null }
}

/**
 * A conta do Asaas que deve receber esta parcela.
 *
 * Fase 6 da consolidação ERP × Portal (10/09/2026). O ERP pegava
 * `findFirst({ provider: 'asaas', active: true }, orderBy: id desc)` — a última
 * conexão criada — enquanto o Portal cobra pela conexão configurada no portal
 * (`portal.paymentConnectionId`). Com uma conexão só isso coincide por acaso;
 * com duas (sandbox e produção, ou duas unidades), a entrada da matrícula entra
 * numa conta e as mensalidades noutra, e a conciliação não fecha.
 *
 * A regra passa a ser: **quem recebeu a entrada recebe as mensalidades**. Se a
 * matrícula não veio do portal, ou o portal não define conexão, cai no
 * comportamento antigo — que continua sendo o certo para matrícula feita na
 * secretaria.
 */
export async function contaDaParcela(parcelaId: number): Promise<AsaasConfig | null> {
  const parcela = await prisma.acaParcela.findUnique({
    where: { id: parcelaId },
    select: { contrato: { select: { matricula: { select: { enrollmentRegistrationId: true } } } } },
  })
  const regId = parcela?.contrato?.matricula?.enrollmentRegistrationId ?? null
  if (regId) {
    const reg = await prisma.enrollmentRegistration.findUnique({
      where: { id: regId },
      select: { portal: { select: { paymentConnectionId: true } } },
    })
    const connId = reg?.portal?.paymentConnectionId ?? null
    if (connId) {
      const conn = await prisma.paymentProviderConnection.findFirst({
        where: { id: connId, provider: 'asaas', active: true },
      })
      // Conexão desativada depois da inscrição: melhor cair no padrão do que
      // falhar a cobrança de quem já é aluno.
      const cfg = await abrirConexao(conn)
      if (cfg) return cfg
    }
  }
  return getAsaasConfig()
}

/** Gateways que emitem mensalidade. Pagar.me e simulado só cobram no checkout do portal. */
const GATEWAYS_DO_ERP = ['asaas', 'iugu'] as const

type ConexaoDoErp = {
  id: number; provider: string; apiKey: string; publicKey: string | null
  environment: string; webhookToken: string; active: boolean
}

/**
 * A conexão que cobra esta parcela — mesma regra de `contaDaParcela`, agora
 * para qualquer gateway do ERP: quem recebeu a entrada no portal recebe as
 * mensalidades; sem portal, vale a conexão ativa mais recente.
 */
export async function conexaoDaParcela(parcelaId: number): Promise<ConexaoDoErp | null> {
  const parcela = await prisma.acaParcela.findUnique({
    where: { id: parcelaId },
    select: { contrato: { select: { matricula: { select: { enrollmentRegistrationId: true } } } } },
  })
  const regId = parcela?.contrato?.matricula?.enrollmentRegistrationId ?? null
  if (regId) {
    const reg = await prisma.enrollmentRegistration.findUnique({
      where: { id: regId },
      select: { portal: { select: { paymentConnectionId: true } } },
    })
    const connId = reg?.portal?.paymentConnectionId ?? null
    if (connId) {
      const conn = await prisma.paymentProviderConnection.findFirst({
        where: { id: connId, provider: { in: [...GATEWAYS_DO_ERP] }, active: true },
      })
      if (conn) return conn
    }
  }
  return prisma.paymentProviderConnection.findFirst({
    where: { provider: { in: [...GATEWAYS_DO_ERP] }, active: true },
    orderBy: { id: 'desc' },
  })
}

/** Vencimento de mensalidade N (1..) no dia `dia`, a partir do próximo mês. */
function vencimentoMensalidade(n: number, dia: number): Date {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth() + n, Math.min(dia, 28))
  return d
}

/** O que foi escolhido e pago no checkout do portal, quando houve um. */
export interface EscolhaDoCheckout {
  /** 'taxa' = pagou a inscrição; 'curso' = pagou o curso (entrada ou total). */
  escopo: 'taxa' | 'curso'
  meio: 'pix' | 'boleto' | 'credit_card'
  parcelas: number
  /** Em centavos, o que efetivamente entrou. */
  valorPagoCentavos: number
  pagoEm: Date
}

/**
 * Lê o plano escolhido na inscrição de origem — só conta se o pagamento foi
 * confirmado. Intenção sem pagamento não abate nada: quem escolheu cartão e
 * abandonou a tela continua devendo o curso inteiro.
 */
async function escolhaDoCheckout(registrationId: number | null | undefined): Promise<EscolhaDoCheckout | null> {
  if (!registrationId) return null
  const reg = await prisma.enrollmentRegistration.findUnique({
    where: { id: registrationId },
    select: { paymentPlan: true, paymentStatus: true, paymentPaidAt: true, paymentAmount: true },
  })
  if (!reg || reg.paymentStatus !== 'paid') return null

  const plano = (reg.paymentPlan ?? {}) as Record<string, unknown>
  const escopo = plano.escopo === 'curso' ? 'curso' : 'taxa'
  // Taxa de inscrição não abate mensalidade: são cobranças diferentes.
  if (escopo !== 'curso') return null

  const meio = ['pix', 'boleto', 'credit_card'].includes(String(plano.meio))
    ? (plano.meio as EscolhaDoCheckout['meio'])
    : 'pix'
  const valor = Number(plano.valorCobrado ?? reg.paymentAmount ?? 0)
  if (!Number.isFinite(valor) || valor <= 0) return null

  return {
    escopo: 'curso',
    meio,
    parcelas: Math.max(1, Math.round(Number(plano.parcelas ?? 1)) || 1),
    valorPagoCentavos: Math.round(valor * 100),
    pagoEm: reg.paymentPaidAt ?? new Date(),
  }
}

/**
 * Marca como pagas as parcelas que o checkout já cobriu, na ordem em que
 * vencem, e devolve quantas foram.
 *
 * No cartão, o valor pago é o total da compra — inclusive o acréscimo de juros,
 * que é do adquirente e não abate mensalidade. Por isso o abatimento anda por
 * parcela, do começo para o fim, até o dinheiro acabar: sobra vira nada, e
 * falta deixa o resto em aberto. Uma parcela parcialmente coberta continua
 * ABERTA, com o valor já pago registrado — cobrar de novo o total seria erro,
 * e dar por quitada seria prejuízo.
 */
export function aplicarPagamentoDoCheckout(parcelas: any[], escolha: EscolhaDoCheckout | null): number {
  if (!escolha) return 0
  let restante = escolha.valorPagoCentavos
  let quitadas = 0

  for (const p of parcelas) {
    if (restante <= 0) break
    const valor = Number(p.valorBrutoCentavos)
    if (restante >= valor) {
      p.situacao = 'PAGA'
      p.valorPagoCentavos = valor
      p.pagoEm = escolha.pagoEm
      restante -= valor
      quitadas++
    } else {
      p.valorPagoCentavos = restante
      restante = 0
    }
  }
  return quitadas
}

/**
 * Gera AcaContrato + AcaParcela a partir do PlanoPagamento da oferta da turma.
 * Idempotente (1 contrato por matrícula). Chamado ao EFETIVAR a matrícula.
 *
 * Quando a matrícula veio de uma inscrição do portal cujo checkout cobrou o
 * CURSO (e não a taxa de inscrição), o que já foi pago ali entra abatido: no
 * cartão parcelado o contrato costuma nascer quitado; no boleto parcelado, só
 * a entrada.
 */
export async function gerarContratoEParcelas(matriculaId: number): Promise<{ contratoId: number; criadas: number } | { skip: true }> {
  const existe = await prisma.acaContrato.findUnique({ where: { matriculaId }, select: { id: true } })
  if (existe) return { skip: true }

  const mat = await prisma.acaMatricula.findUnique({ where: { id: matriculaId }, include: { turma: { select: { courseOfferingId: true } } } })
  if (!mat) throw new Error('Matrícula não encontrada')

  // O que a pessoa escolheu no checkout, quando veio do portal. Sem isso, o
  // plano padrão da oferta é aplicado a quem já pagou de outro jeito — e o
  // aluno recebe cobrança de mensalidade que ele já quitou no cartão.
  const escolha = await escolhaDoCheckout(mat.enrollmentRegistrationId)
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

  // Agora o que já foi pago no checkout deixa de virar cobrança.
  //
  // Cartão parcelado é o caso que mais dói: a instituição recebe o valor
  // inteiro do adquirente e quem paga em vezes é o aluno, para o banco dele.
  // Gerar doze mensalidades depois disso seria cobrar duas vezes a mesma coisa.
  // Boleto parcelado é o oposto: só a entrada foi paga, e as demais são
  // exatamente estas parcelas — a primeira já nasce quitada.
  const quitadas = aplicarPagamentoDoCheckout(parcelas, escolha)

  // Inserção em loop (convenção: sem createMany+skipDuplicates)
  for (const p of parcelas) await prisma.acaParcela.create({ data: p })

  // Contrato inteiro pago no ato não fica "ATIVO" esperando cobrança nenhuma.
  if (quitadas > 0 && quitadas === parcelas.length) {
    await prisma.acaContrato.update({ where: { id: contrato.id }, data: { status: 'QUITADO' } })
  }

  // O evento existia no enum, mas ninguém o emitia — os gatilhos configurados
  // para "contrato financeiro criado" nunca rodavam.
  import('./acaAssinatura.js')
    .then((m) => m.dispararEvento('CONTRATO_FINANCEIRO_CRIADO', {
      alunoId: mat.alunoId, matriculaId, contratoId: contrato.id,
    }))
    .catch((e) => console.warn('[acaFinanceiro] gatilho CONTRATO_FINANCEIRO_CRIADO falhou:', e?.message || e))

  return { contratoId: contrato.id, criadas: parcelas.length }
}

/**
 * Emite a cobrança (boleto + PIX) de uma parcela no gateway da conexão dela —
 * Asaas ou iugu. O id da cobrança fica em `asaasChargeId` (nome histórico: é o
 * id no gateway, qualquer que seja) e o gateway em `gatewayProvider`.
 */
export async function criarCobrancaParcela(parcelaId: number): Promise<{ ok: true; asaasChargeId: string } | { ok: false; error: string }> {
  const conn = await conexaoDaParcela(parcelaId)
  if (!conn) return { ok: false, error: 'Nenhuma conexão de pagamento ativa (Configurações › Pagamentos).' }
  if (conn.provider === 'iugu') return criarCobrancaIugu(parcelaId, conn)
  return criarCobrancaAsaas(parcelaId)
}

/** Cria a cobrança (boleto+PIX) no Asaas para uma parcela e guarda as referências. */
export async function criarCobrancaAsaas(parcelaId: number): Promise<{ ok: true; asaasChargeId: string } | { ok: false; error: string }> {
  // A mesma conta que recebeu a entrada no checkout recebe as mensalidades.
  const config = await contaDaParcela(parcelaId)
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
    await prisma.acaParcela.update({ where: { id: parcelaId }, data: { asaasChargeId: pay.id, gatewayProvider: 'asaas', linhaDigitavel: pay.bankSlipUrl || pay.invoiceUrl || null, pixCopiaCola: pix } })
    await prisma.acaIntegracaoEvento.create({ data: { origem: 'ASAAS_COBRANCA', eventoExternoId: pay.id, status: 'SUCESSO', responseJson: { invoiceUrl: pay.invoiceUrl } as any } }).catch(() => {})
    return { ok: true, asaasChargeId: pay.id }
  } catch (e: any) {
    return { ok: false, error: e.message || 'Falha ao criar cobrança no Asaas' }
  }
}

/** URL do gatilho da iugu para esta conexão — a mesma que aparece em Configurações › Pagamentos. */
export function urlGatilhoIugu(webhookToken: string): string | undefined {
  const base = appUrl()
  return base ? `${base}/api/public/payment-webhook/iugu/${webhookToken}` : undefined
}

/**
 * Cria a fatura (boleto + PIX) da parcela na iugu.
 *
 * A iugu exige CPF e e-mail do pagador para boleto e PIX, e recusa vencimento
 * no passado. Parcela já vencida sai com vencimento em dois dias, pelo valor
 * atualizado (multa + juros até hoje, como no Asaas); a partir daí os encargos
 * seguem por conta da própria iugu.
 */
async function criarCobrancaIugu(parcelaId: number, conn: ConexaoDoErp): Promise<{ ok: true; asaasChargeId: string } | { ok: false; error: string }> {
  const cfg = iuguDaConexao(conn)
  if (!cfg) return { ok: false, error: 'Não foi possível abrir as credenciais da iugu — salve o token de novo em Configurações › Pagamentos.' }
  const parcela = await prisma.acaParcela.findUnique({ where: { id: parcelaId }, include: { contrato: { include: { matricula: { include: { aluno: { include: { lead: true } } } } } } } })
  if (!parcela) return { ok: false, error: 'Parcela não encontrada' }
  if (parcela.asaasChargeId) return { ok: true, asaasChargeId: parcela.asaasChargeId }
  if (parcela.situacao === 'PAGA' || parcela.situacao === 'CANCELADA') return { ok: false, error: `Parcela ${parcela.situacao.toLowerCase()} não gera cobrança.` }
  const aluno = parcela.contrato.matricula.aluno
  const cpf = String(aluno.cpf || '').replace(/\D/g, '')
  if (cpf.length !== 11 && cpf.length !== 14) return { ok: false, error: 'Aluno sem CPF válido — a iugu exige CPF para emitir boleto e PIX.' }
  const email = aluno.lead?.email?.trim()
  if (!email) return { ok: false, error: 'Aluno sem e-mail — a iugu exige e-mail para emitir a cobrança.' }

  try {
    const encCfg = await getEncargosConfig()
    const enc = calcularEncargos(parcela, encCfg)
    const hoje = new Date()
    const vencida = dataIugu(parcela.dataVencimento) < dataIugu(hoje)
    const vencimento = vencida ? new Date(hoje.getTime() + 2 * 86400_000) : parcela.dataVencimento
    const fatura = await criarFaturaIugu(cfg, {
      metodos: ['boleto', 'pix'],
      valor: enc.valorCobranca / 100,
      vencimento,
      descricao: `${parcela.tipo === 'MATRICULA' ? 'Matrícula' : 'Mensalidade'} ${parcela.nroParcela} — RA ${aluno.ra}${enc.vencida ? ' (valor atualizado)' : ''}`,
      email,
      pagador: { nome: aluno.lead?.nome || 'Aluno', cpfCnpj: cpf, telefone: aluno.lead?.whatsapp || undefined, email },
      referencia: `aca-parcela:${parcelaId}`,
      // Mesma parcela, mesmo valor, mesmo vencimento: clique duplo não gera
      // duas faturas. Valor ou data diferentes são outra cobrança de verdade.
      chaveIdempotencia: `aca-parcela-${parcelaId}-${enc.valorCobranca}-${dataIugu(vencimento)}`,
      urlNotificacao: urlGatilhoIugu(conn.webhookToken),
      multaPct: encCfg.multaPct,
      jurosMesPct: encCfg.jurosMesPct,
      // Boleto de mensalidade segue pagável depois do vencimento, com os encargos.
      expiraEmDias: 60,
    })
    await prisma.acaParcela.update({
      where: { id: parcelaId },
      data: {
        asaasChargeId: fatura.id,
        gatewayProvider: 'iugu',
        linhaDigitavel: fatura.boleto?.pdfUrl || fatura.urlSegura || null,
        pixCopiaCola: fatura.pix?.texto || null,
        gatewaySyncAt: new Date(),
      },
    })
    await prisma.acaIntegracaoEvento.create({ data: { origem: 'IUGU_COBRANCA', eventoExternoId: fatura.id, status: 'SUCESSO', responseJson: { urlSegura: fatura.urlSegura, linha: fatura.boleto?.linha ?? null } as any } }).catch(() => {})
    return { ok: true, asaasChargeId: fatura.id }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Falha ao criar cobrança na iugu' }
  }
}

/**
 * Aplica à parcela o estado de uma fatura da iugu (vindo do gatilho ou da
 * reconciliação). IDEMPOTENTE: a baixa é uma escrita condicional — de dois
 * avisos simultâneos, só um muda a parcela para PAGA.
 */
export async function aplicarFaturaIuguNaParcela(fatura: IuguFatura): Promise<{ ok: boolean; baixou?: boolean; motivo?: string }> {
  const m = String(fatura.referencia || '').match(/^aca-parcela:(\d+)$/)
  const parcela = await prisma.acaParcela.findFirst({
    where: m ? { id: parseInt(m[1]!), asaasChargeId: fatura.id } : { asaasChargeId: fatura.id, gatewayProvider: 'iugu' },
    select: { id: true, contratoId: true, situacao: true, valorBrutoCentavos: true },
  })
  if (!parcela) return { ok: true, motivo: 'parcela não encontrada' }

  let baixou = false
  if (fatura.status === 'paid') {
    const r = await prisma.acaParcela.updateMany({
      where: { id: parcela.id, situacao: { not: 'PAGA' } },
      data: {
        situacao: 'PAGA',
        valorPagoCentavos: fatura.pagoCentavos ?? fatura.totalCentavos ?? parcela.valorBrutoCentavos,
        pagoEm: fatura.pagoEm ?? new Date(),
        gatewaySyncAt: new Date(),
      },
    })
    baixou = r.count === 1
    if (baixou) await quitarSeCompleto(parcela.contratoId)
  } else if (fatura.status === 'overdue' && parcela.situacao === 'ABERTA') {
    await prisma.acaParcela.update({ where: { id: parcela.id }, data: { situacao: 'VENCIDA', gatewaySyncAt: new Date() } })
  } else if (fatura.status === 'failed' && parcela.situacao !== 'PAGA') {
    // Fatura cancelada na iugu (pelo painel, ou substituída): a parcela volta a
    // não ter cobrança, e o botão "Cobrar" reaparece em vez de apontar para um
    // boleto que o banco não aceita mais.
    await prisma.acaParcela.updateMany({
      where: { id: parcela.id, asaasChargeId: fatura.id },
      data: { asaasChargeId: null, gatewayProvider: null, linhaDigitavel: null, pixCopiaCola: null, gatewaySyncAt: new Date() },
    })
  } else {
    await prisma.acaParcela.update({ where: { id: parcela.id }, data: { gatewaySyncAt: new Date() } }).catch(() => {})
  }
  if (baixou) {
    await prisma.acaIntegracaoEvento.create({
      data: { origem: 'IUGU_WEBHOOK', eventoExternoId: `${fatura.id}:paid`, status: 'SUCESSO', responseJson: { parcelaId: parcela.id, pagoCentavos: fatura.pagoCentavos } as any },
    }).catch(() => {})
  }
  return { ok: true, baixou }
}

/**
 * Reconciliação das mensalidades emitidas na iugu. Chamada no mesmo tick do
 * cron de pagamentos: confere até 10 parcelas em aberto por vez, as mais
 * antigas de conferência primeiro, e não repete a mesma em menos de 30 min.
 */
export async function reconciliarParcelasIugu(): Promise<{ conferidas: number; baixadas: number; erros: number }> {
  const limite = new Date(Date.now() - 30 * 60_000)
  const parcelas = await prisma.acaParcela.findMany({
    where: {
      gatewayProvider: 'iugu',
      asaasChargeId: { not: null },
      situacao: { in: ['ABERTA', 'VENCIDA'] },
      OR: [{ gatewaySyncAt: null }, { gatewaySyncAt: { lt: limite } }],
    },
    orderBy: { gatewaySyncAt: 'asc' },
    take: 10,
    select: { id: true, asaasChargeId: true },
  })
  let baixadas = 0
  let erros = 0
  for (const p of parcelas) {
    try {
      const conn = await conexaoDaParcela(p.id)
      const cfg = conn?.provider === 'iugu' ? iuguDaConexao(conn) : null
      if (!cfg) { erros++; continue }
      const fatura = await buscarFaturaIugu(cfg, p.asaasChargeId!)
      const r = await aplicarFaturaIuguNaParcela(fatura)
      if (r.baixou) baixadas++
    } catch {
      erros++
      await prisma.acaParcela.update({ where: { id: p.id }, data: { gatewaySyncAt: new Date() } }).catch(() => {})
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return { conferidas: parcelas.length, baixadas, erros }
}

/** Baixa manual de uma parcela (sem gateway). valorPago já considera encargos/desconto (Fin-2). */
export async function darBaixaManual(parcelaId: number): Promise<void> {
  const p = await prisma.acaParcela.findUnique({ where: { id: parcelaId }, select: { id: true, valorBrutoCentavos: true, dataVencimento: true, situacao: true, contratoId: true } })
  if (!p) throw new Error('Parcela não encontrada')
  const enc = calcularEncargos(p, await getEncargosConfig())
  await prisma.acaParcela.update({ where: { id: parcelaId }, data: { situacao: 'PAGA', valorPagoCentavos: enc.valorAtual, pagoEm: new Date() } })
  await quitarSeCompleto(p.contratoId)
  // Com boleto emitido na iugu, a fatura precisa saber que foi paga por fora —
  // senão o aluno segue recebendo lembrete e pode pagar de novo.
  const emitida = await prisma.acaParcela.findUnique({ where: { id: parcelaId }, select: { asaasChargeId: true, gatewayProvider: true } })
  if (emitida?.gatewayProvider === 'iugu' && emitida.asaasChargeId) {
    const conn = await conexaoDaParcela(parcelaId)
    const cfg = conn?.provider === 'iugu' ? iuguDaConexao(conn) : null
    if (cfg) {
      const r = await baixaExternaIugu(cfg, emitida.asaasChargeId, `aca-parcela-${parcelaId}`, 'Baixa manual na secretaria')
      if (!r.ok) console.warn(`[acaFinanceiro] baixa externa na iugu falhou (parcela ${parcelaId}): ${r.message}`)
    }
  }
}

/** Processa um evento de pagamento do Asaas (webhook) — IDEMPOTENTE. */
export async function processarWebhookAsaas(payload: AsaasWebhookPayload): Promise<{ ok: boolean; baixou?: boolean; motivo?: string }> {
  if (!payload?.event || !isAsaasPaymentEvent(payload.event) || !payload.payment?.id) return { ok: true, motivo: 'ignorado' }
  const eventoExternoId = `${payload.payment.id}:${payload.event}`
  // idempotência: já processado?
  const dup = await prisma.acaIntegracaoEvento.findUnique({ where: { origem_eventoExternoId: { origem: 'ASAAS_WEBHOOK', eventoExternoId } }, select: { id: true } })
  if (dup) return { ok: true, motivo: 'duplicado' }
  await prisma.acaIntegracaoEvento.create({ data: { origem: 'ASAAS_WEBHOOK', eventoExternoId, status: 'PENDENTE', requestJson: payload as any } })

  const interno = ASAAS_STATUS_MAP[String(payload.payment.status ?? '')] || payload.event
  const pagoNoAviso = ['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'PAYMENT_RECEIVED_IN_CASH'].includes(payload.event)
  const parcela = await prisma.acaParcela.findFirst({ where: { asaasChargeId: payload.payment.id }, select: { id: true, valorBrutoCentavos: true, contratoId: true } })
  // O aviso diz "pago"; quem confirma é o Asaas. Esta rota é pública, então o
  // corpo pode ser de qualquer um — sem a consulta, um POST com o id de uma
  // cobrança dava baixa na mensalidade sem dinheiro nenhum ter entrado.
  let pago = false
  if (parcela && pagoNoAviso) {
    const cfg = await contaDaParcela(parcela.id)
    const real = cfg ? await getAsaasPaymentStatus(cfg, payload.payment.id).catch(() => null) : null
    pago = !!real && ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'].includes(String((real as any).status ?? ''))
    if (!pago) {
      // Sai o registro de "já processado": se ficasse, um aviso forjado antes
      // do pagamento faria o aviso VERDADEIRO, depois, ser descartado como
      // duplicado — e a mensalidade paga nunca teria baixa.
      await prisma.acaIntegracaoEvento.deleteMany({ where: { origem: 'ASAAS_WEBHOOK', eventoExternoId } })
      console.warn(`[acaFinanceiro] aviso Asaas ${eventoExternoId} não confirmado na API (status: ${real ? String((real as any).status ?? '?') : 'sem resposta'}) — ignorado`)
      return { ok: true, motivo: 'não confirmado no Asaas' }
    }
  }
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
