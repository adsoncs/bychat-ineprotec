// src/services/paymentIugu.ts
// Integração com a iugu (https://dev.iugu.com) — faturas PIX/boleto, cartão
// tokenizado no navegador (iugu.js) e gatilhos.
//
// Como a iugu se encaixa no que já existe:
//   · A credencial é o `api_token` (Basic Auth, usuário = token, senha vazia).
//     Token de teste ou de produção é o que decide o ambiente — não há URL de
//     sandbox. Fica em PaymentProviderConnection.apiKey, cifrado.
//   · O `account_id` é público (o iugu.js precisa dele no navegador para gerar
//     o token do cartão). Fica em PaymentProviderConnection.publicKey.
//   · Toda cobrança é uma FATURA (`/invoices`). PIX e boleto saem prontos na
//     resposta; cartão cria a fatura e cobra nela com `/charge` + token.
//   · O gatilho (webhook) é só um aviso: quem responde "está paga?" é a própria
//     API, consultada com o nosso token. Um POST forjado na URL do webhook, no
//     máximo, faz a gente perguntar à iugu sobre uma fatura — e ela diz a verdade.

import { decryptToken } from './cloudApi.js'

/** Base da API. A variável existe para os testes apontarem para um dublê local. */
const BASE = (process.env.IUGU_API_URL || 'https://api.iugu.com/v1').replace(/\/$/, '')

export interface IuguConfig {
  apiToken: string
  accountId: string | null
  environment: 'production' | 'sandbox'
}

export type IuguMetodo = 'pix' | 'boleto' | 'credit_card'

/** Erro vindo da iugu, com o que ela respondeu — `recusaCartao` separa "cartão negado" de falha nossa. */
export class IuguError extends Error {
  status: number
  data: unknown
  recusaCartao: boolean
  constructor(message: string, status: number, data: unknown, recusaCartao = false) {
    super(message)
    this.status = status
    this.data = data
    this.recusaCartao = recusaCartao
  }
}

/** Monta a config a partir da linha da conexão (chaves cifradas). null se não der para decifrar. */
export function iuguDaConexao(conn: { apiKey: string; publicKey?: string | null; environment: string }): IuguConfig | null {
  try {
    const apiToken = decryptToken(conn.apiKey)
    if (!apiToken) return null
    let accountId: string | null = null
    if (conn.publicKey) {
      try { accountId = decryptToken(conn.publicKey) || null } catch { accountId = null }
    }
    return { apiToken, accountId, environment: conn.environment === 'production' ? 'production' : 'sandbox' }
  } catch {
    return null
  }
}

/** A iugu devolve erro em três formatos: string, lista ou { campo: [mensagens] }. */
function mensagemDeErro(data: any, status: number): string {
  const e = data?.errors ?? data?.message ?? data?.error
  if (!e) return `HTTP ${status}`
  if (typeof e === 'string') return e
  if (Array.isArray(e)) return e.join('; ')
  if (typeof e === 'object') {
    return Object.entries(e)
      .map(([campo, msgs]) => `${campo}: ${Array.isArray(msgs) ? msgs.join(', ') : String(msgs)}`)
      .join('; ')
  }
  return `HTTP ${status}`
}

async function chamar<T = any>(
  cfg: IuguConfig,
  metodo: 'GET' | 'POST' | 'PUT' | 'DELETE',
  caminho: string,
  corpo?: unknown,
  chaveIdempotencia?: string,
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: 'Basic ' + Buffer.from(`${cfg.apiToken}:`).toString('base64'),
    Accept: 'application/json',
  }
  if (corpo !== undefined) headers['Content-Type'] = 'application/json'
  // Rede instável + reenvio = duas faturas. Com a chave, a iugu processa uma
  // só e responde 409 à repetição (válida por 24h).
  if (chaveIdempotencia) headers['Idempotency-Key'] = chaveIdempotencia

  const r = await fetch(`${BASE}${caminho}`, {
    method: metodo,
    headers,
    ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
    signal: AbortSignal.timeout(20_000),
  })
  const texto = await r.text()
  let data: any = {}
  try { data = texto ? JSON.parse(texto) : {} } catch { data = { raw: texto.slice(0, 500) } }
  if (!r.ok) {
    throw new IuguError(`iugu: ${mensagemDeErro(data, r.status)}`, r.status, data)
  }
  return data as T
}

// ─── Status ───────────────────────────────────────────────────────────────
// Para o vocabulário interno (pending|paid|overdue|refunded|failed), o mesmo
// que Asaas e Pagar.me já usam.
export const IUGU_STATUS_MAP: Record<string, string> = {
  pending: 'pending',
  draft: 'pending',
  in_analysis: 'pending',
  authorized: 'pending',
  partially_paid: 'pending',
  paid: 'paid',
  externally_paid: 'paid',
  // Contestação aberta: o dinheiro ainda está com a instituição. Só vira
  // estorno se a contestação for perdida (chargeback).
  in_protest: 'paid',
  refunded: 'refunded',
  chargeback: 'refunded',
  expired: 'overdue',
  canceled: 'failed',
}

export function statusIugu(bruto: unknown): string {
  return IUGU_STATUS_MAP[String(bruto ?? '').toLowerCase()] || 'pending'
}

/** `iugu_pix` → PIX, como o resto do sistema grava paymentMethod. */
export function meioIugu(bruto: unknown): 'PIX' | 'BOLETO' | 'CREDIT_CARD' | null {
  const s = String(bruto ?? '').toLowerCase()
  if (s.includes('pix')) return 'PIX'
  if (s.includes('bank_slip')) return 'BOLETO'
  if (s.includes('credit_card')) return 'CREDIT_CARD'
  return null
}

// ─── Fatura ───────────────────────────────────────────────────────────────

export interface IuguFatura {
  id: string
  status: string            // interno
  statusBruto: string
  totalCentavos: number
  pagoCentavos: number | null
  pagoEm: Date | null
  meio: 'PIX' | 'BOLETO' | 'CREDIT_CARD' | null
  referencia: string | null // external_reference
  urlSegura: string | null  // página da fatura na iugu (paga por qualquer meio aceito)
  pix: { texto: string; imagemUrl: string | null } | null
  boleto: { linha: string | null; codigoBarras: string | null; pdfUrl: string | null; url: string | null } | null
  cartao: { ultimos4: string | null; bandeira: string | null } | null
  vencimento: string | null
}

export function normalizarFatura(d: any): IuguFatura {
  const bs = d?.bank_slip
  const px = d?.pix
  return {
    id: String(d?.id ?? ''),
    status: statusIugu(d?.status),
    statusBruto: String(d?.status ?? ''),
    totalCentavos: Number(d?.total_cents ?? 0),
    pagoCentavos: d?.paid_cents != null ? Number(d.paid_cents) : null,
    pagoEm: d?.paid_at ? new Date(d.paid_at) : null,
    meio: meioIugu(d?.payment_method),
    referencia: d?.external_reference ? String(d.external_reference) : null,
    urlSegura: d?.secure_url ? String(d.secure_url) : null,
    pix: px?.qrcode_text ? { texto: String(px.qrcode_text), imagemUrl: px.qrcode ? String(px.qrcode) : null } : null,
    boleto: bs && (bs.digitable_line || bs.bank_slip_pdf_url)
      ? {
          linha: bs.digitable_line ? String(bs.digitable_line) : null,
          codigoBarras: bs.barcode_data ? String(bs.barcode_data) : null,
          pdfUrl: bs.bank_slip_pdf_url ? String(bs.bank_slip_pdf_url) : null,
          url: bs.bank_slip_url ? String(bs.bank_slip_url) : null,
        }
      : null,
    cartao: d?.credit_card_last_4 || d?.credit_card_brand
      ? { ultimos4: d.credit_card_last_4 ? String(d.credit_card_last_4) : null, bandeira: d.credit_card_brand ? String(d.credit_card_brand) : null }
      : null,
    vencimento: d?.due_date ? String(d.due_date) : null,
  }
}

/** Data AAAA-MM-DD no fuso de Brasília — a iugu recusa vencimento no passado, e UTC já é "amanhã" às 21h. */
export function dataIugu(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

export interface CriarFaturaInput {
  metodos: IuguMetodo[] | 'all'
  valor: number                 // em reais
  vencimento: Date
  descricao: string
  email: string
  pagador: { nome: string; cpfCnpj?: string | undefined; telefone?: string | undefined; email?: string | undefined }
  referencia: string            // external_reference (≤ 60) — é por ela que o aviso volta para nós
  chaveIdempotencia: string
  urlNotificacao?: string | undefined
  maxParcelas?: number | undefined
  multaPct?: number | undefined
  jurosMesPct?: number | undefined
  /** Dias depois do vencimento em que a fatura ainda pode ser paga (0 = só até o vencimento). */
  expiraEmDias?: number | undefined
  semEmailDaIugu?: boolean | undefined
}

const PAYABLE: Record<IuguMetodo, string> = { pix: 'pix', boleto: 'bank_slip', credit_card: 'credit_card' }

function separarTelefone(bruto?: string): { phone_prefix?: string; phone?: string } {
  let d = String(bruto ?? '').replace(/\D/g, '')
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2)
  if (d.length < 10) return {}
  return { phone_prefix: d.slice(0, 2), phone: d.slice(2) }
}

export async function criarFaturaIugu(cfg: IuguConfig, input: CriarFaturaInput): Promise<IuguFatura> {
  const centavos = Math.round(input.valor * 100)
  // Mínimo da iugu por item. Abaixo disso a fatura volta 422 com texto técnico.
  if (centavos < 100) throw new IuguError('iugu: valor mínimo por cobrança é R$ 1,00', 422, null)

  const cpf = String(input.pagador.cpfCnpj ?? '').replace(/\D/g, '')
  const corpo: Record<string, unknown> = {
    email: input.email,
    due_date: dataIugu(input.vencimento),
    items: [{ description: input.descricao.slice(0, 250), quantity: 1, price_cents: centavos }],
    payable_with: input.metodos === 'all' ? ['all'] : input.metodos.map((m) => PAYABLE[m]),
    external_reference: input.referencia.slice(0, 60),
    // Também vai como variável: aparece no painel da iugu para quem for conferir.
    custom_variables: [{ name: 'referencia', value: input.referencia.slice(0, 200) }],
    payer: {
      name: input.pagador.nome.slice(0, 140),
      ...(cpf ? { cpf_cnpj: cpf } : {}),
      ...(input.pagador.email ? { email: input.pagador.email } : {}),
      ...separarTelefone(input.pagador.telefone),
    },
    ...(input.urlNotificacao ? { notification_url: input.urlNotificacao } : {}),
    ...(input.maxParcelas && input.maxParcelas > 1 ? { max_installments_value: input.maxParcelas } : {}),
    ...(input.expiraEmDias !== undefined ? { expires_in: String(Math.max(0, Math.min(120, input.expiraEmDias))) } : {}),
    ...(input.semEmailDaIugu ? { ignore_due_email: true, ignore_canceled_email: true } : {}),
  }
  // Encargos por atraso: multa % + juros diários. A iugu exige multa ligada
  // para cobrar juros, e o juros é informado ao dia (mês / 30).
  if (input.multaPct && input.multaPct > 0) {
    corpo.fines = true
    corpo.late_payment_fine = Math.round(input.multaPct)
    if (input.jurosMesPct && input.jurosMesPct > 0) {
      corpo.per_day_interest = true
      corpo.per_day_interest_value = Math.round((input.jurosMesPct / 30) * 1000) / 1000
    }
  }
  const d = await chamar(cfg, 'POST', '/invoices', corpo, input.chaveIdempotencia)
  return normalizarFatura(d)
}

export async function buscarFaturaIugu(cfg: IuguConfig, id: string): Promise<IuguFatura> {
  const d = await chamar(cfg, 'GET', `/invoices/${encodeURIComponent(id)}`)
  return normalizarFatura(d)
}

/** Cancela uma fatura pendente/expirada. Já cancelada ou paga: não é erro para nós. */
export async function cancelarFaturaIugu(cfg: IuguConfig, id: string): Promise<{ ok: boolean; message?: string }> {
  try {
    await chamar(cfg, 'PUT', `/invoices/${encodeURIComponent(id)}/cancel`)
    return { ok: true }
  } catch (e: any) {
    return { ok: false, message: e?.message }
  }
}

/** Estorno (cartão e PIX). Parcial só no cartão, pela regra da iugu. */
export async function estornarFaturaIugu(cfg: IuguConfig, id: string, centavosParcial?: number): Promise<IuguFatura> {
  const d = await chamar(cfg, 'POST', `/invoices/${encodeURIComponent(id)}/refund`,
    centavosParcial ? { partial_value_refund_cents: Math.round(centavosParcial) } : {})
  return normalizarFatura(d)
}

/** Baixa na iugu de uma fatura que foi paga por fora (dinheiro na secretaria, transferência…). */
export async function baixaExternaIugu(cfg: IuguConfig, id: string, referenciaNossa: string, descricao: string): Promise<{ ok: boolean; message?: string }> {
  try {
    await chamar(cfg, 'PUT', `/invoices/${encodeURIComponent(id)}/externally_pay`, {
      external_payment_id: referenciaNossa.slice(0, 32),
      external_payment_description: descricao.slice(0, 50),
    })
    return { ok: true }
  } catch (e: any) {
    return { ok: false, message: e?.message }
  }
}

// ─── Cartão ───────────────────────────────────────────────────────────────

export interface CobrarCartaoInput {
  faturaId: string
  token: string                 // gerado pelo iugu.js no navegador — uso único
  parcelas: number
  chaveIdempotencia: string
}

/**
 * Cobra no cartão uma fatura já criada. Devolve a fatura atualizada.
 *
 * Recusa do emissor não é exceção de rede: a iugu responde 200 com
 * `success: false` e a mensagem do banco. Viramos isso em IuguError com
 * `recusaCartao` — a rota mostra "tente outro cartão" em vez de "tente mais tarde".
 */
export async function cobrarCartaoIugu(cfg: IuguConfig, input: CobrarCartaoInput): Promise<IuguFatura> {
  let r: any
  try {
    r = await chamar(cfg, 'POST', '/charge', {
      token: input.token,
      invoice_id: input.faturaId,
      ...(input.parcelas > 1 ? { months: Math.min(12, input.parcelas) } : {}),
    }, input.chaveIdempotencia)
  } catch (e: any) {
    // Token vencido/inválido chega como 4xx — do ponto de vista de quem paga,
    // é o mesmo "confira os dados do cartão".
    if (e instanceof IuguError && e.status >= 400 && e.status < 500) {
      throw new IuguError(e.message, e.status, e.data, true)
    }
    throw e
  }
  if (!r?.success) {
    const msg = String(r?.message || r?.info_message || 'Transação não autorizada')
    throw new IuguError(`iugu: ${msg}${r?.LR ? ` (LR ${r.LR})` : ''}`, 402, r, true)
  }
  // A resposta do /charge é curta; a fatura traz status, bandeira e final do cartão.
  try {
    return await buscarFaturaIugu(cfg, String(r.invoice_id || input.faturaId))
  } catch {
    return {
      ...normalizarFatura({ id: r.invoice_id || input.faturaId, status: 'paid' }),
      cartao: { ultimos4: r.last4 ?? null, bandeira: r.brand ?? null },
    }
  }
}

// ─── Conta e gatilhos ────────────────────────────────────────────────────

export async function pingIugu(cfg: IuguConfig): Promise<{ ok: boolean; message: string }> {
  try {
    if (cfg.accountId) {
      const d: any = await chamar(cfg, 'GET', `/accounts/${encodeURIComponent(cfg.accountId)}`)
      const nome = d?.name || d?.commercial_name || 'conta iugu'
      const verificada = d?.is_verified === true ? 'verificada' : d?.is_verified === false ? 'ainda NÃO verificada (não recebe)' : null
      return { ok: true, message: `Conectado: ${nome}${verificada ? ` — ${verificada}` : ''}` }
    }
    await chamar(cfg, 'GET', '/customers?limit=1')
    return { ok: true, message: 'Token válido. Informe o ID da conta para liberar o cartão no checkout.' }
  } catch (e: any) {
    if (e instanceof IuguError && e.status === 401) return { ok: false, message: 'Token recusado pela iugu (401). Confira o token e se ele já foi aprovado no painel.' }
    return { ok: false, message: e?.message || 'Falha ao falar com a iugu' }
  }
}

/** Eventos que interessam: mudança de status (inclui pago/cancelado/expirado), estorno e falha de cobrança. */
export const IUGU_EVENTOS = ['invoice.status_changed', 'invoice.refund', 'invoice.payment_failed'] as const

/**
 * Cadastra os gatilhos na conta, apontando para a nossa URL. Idempotente:
 * o que já existe com a mesma URL e evento não é duplicado.
 */
export async function registrarGatilhosIugu(cfg: IuguConfig, url: string, autorizacao?: string | null)
  : Promise<{ criados: string[]; existentes: string[] }> {
  const lista: any = await chamar(cfg, 'GET', '/web_hooks')
  const atuais: any[] = Array.isArray(lista) ? lista : Array.isArray(lista?.items) ? lista.items : []
  const criados: string[] = []
  const existentes: string[] = []
  for (const ev of IUGU_EVENTOS) {
    if (atuais.some((w) => w?.event === ev && w?.url === url)) { existentes.push(ev); continue }
    await chamar(cfg, 'POST', '/web_hooks', {
      event: ev,
      url,
      ...(autorizacao ? { authorization: autorizacao } : {}),
    })
    criados.push(ev)
  }
  return { criados, existentes }
}

/**
 * Lê o corpo do gatilho. A iugu manda `application/x-www-form-urlencoded`
 * com chaves no formato `data[id]`, `data[status]` — aqui já chega convertido
 * em objeto pelo parser da rota, mas aceitamos as duas formas.
 */
export function lerGatilhoIugu(body: any): { evento: string; faturaId: string | null; status: string | null; contaId: string | null } {
  const b = body || {}
  const data = b.data && typeof b.data === 'object' ? b.data : {}
  const pega = (k: string) => data[k] ?? b[`data[${k}]`] ?? null
  return {
    evento: String(b.event ?? ''),
    faturaId: pega('id') ? String(pega('id')) : null,
    status: pega('status') ? String(pega('status')) : null,
    contaId: pega('account_id') ? String(pega('account_id')) : null,
  }
}

/** `a=1&data[id]=X&data[status]=paid` → { a: '1', data: { id: 'X', status: 'paid' } } (um nível). */
export function formularioParaObjeto(texto: string): Record<string, any> {
  const out: Record<string, any> = {}
  for (const [k, v] of new URLSearchParams(texto)) {
    const m = k.match(/^([^[\]]+)\[([^[\]]+)\]$/)
    if (m) {
      const [, raiz, filho] = m as unknown as [string, string, string]
      if (typeof out[raiz] !== 'object' || out[raiz] === null) out[raiz] = {}
      out[raiz][filho] = v
    } else {
      out[k] = v
    }
  }
  return out
}
