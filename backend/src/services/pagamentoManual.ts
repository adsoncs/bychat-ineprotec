// services/pagamentoManual.ts
//
// Pagamento feito FORA do gateway (dinheiro na secretaria, Pix/transferência
// direto na conta, maquininha, boleto de outro banco). Antes a equipe "marcava
// Pago" num select do modal da inscrição: virava receita, comissão e etapa
// concluída sem prova nenhuma de que o dinheiro entrou (03/11/2026).
//
// Agora é uma ação própria, com permissão própria (tela "Pagamento manual" na
// matriz — só admin herda), comprovante obrigatório, valor > 0, data, forma e
// motivo. Os efeitos são os MESMOS de um pagamento confirmado pelo gateway
// (paymentSync.syncChargeFromProvider / isencaoPorCupom): baixa do cupom,
// conversão do portal, evento no histórico do lead e confirmação ao candidato.
// As cobranças abertas no gateway são canceladas, para o candidato não pagar
// duas vezes. Fica no histórico da inscrição em nome de quem registrou.

import { promises as fs } from 'fs'
import { join } from 'path'
import crypto from 'crypto'
import { prisma } from '../lib/prisma.js'
import { logEvent } from './leadHistory.js'
import { registrarEventoDaInscricao } from './inscricaoAssistida.js'

export const PROVEDOR_MANUAL = 'manual'

export const FORMAS_PAGAMENTO_MANUAL: Record<string, string> = {
  dinheiro: 'Dinheiro',
  pix_direto: 'Pix direto na conta',
  transferencia: 'Transferência / depósito',
  cartao_maquininha: 'Cartão na maquininha',
  boleto_externo: 'Boleto de outro banco',
  outro: 'Outro',
}

/** Mesma pasta PROTEGIDA dos documentos do candidato (lib/arquivoProtegido): o
 *  arquivo só abre por link assinado, que as respostas da API já geram. */
export const pastaDosComprovantes = () => join(process.cwd(), '..', 'uploads', 'enrollment-docs')

/**
 * Cobranças pendentes no gateway deixam de valer — SEM mexer no pagamento da
 * inscrição (o `cancelarCobrancasAbertas` da duplicidade zera paymentStatus,
 * o que desfaria este pagamento). iugu: "paga externamente" (a fatura fecha
 * como paga, conciliável); Asaas: cancelada.
 */
async function encerrarCobrancasAbertas(registrationId: number): Promise<string[]> {
  const abertas = await prisma.enrollmentPaymentMethod.findMany({ where: { registrationId, status: 'pending' } })
  if (!abertas.length) return []
  const reg = await prisma.enrollmentRegistration.findUnique({
    where: { id: registrationId },
    select: { portal: { select: { paymentConnection: { select: { provider: true, apiKey: true, publicKey: true, environment: true, active: true } } } } },
  })
  const conn = reg?.portal?.paymentConnection ?? null
  const avisos: string[] = []
  for (const m of abertas) {
    let ok = true
    if (m.externalId && m.provider === 'iugu') {
      const { iuguDaConexao, baixaExternaIugu } = await import('./paymentIugu.js')
      const cfg = conn?.provider === 'iugu' ? iuguDaConexao(conn as any) : null
      const r = cfg ? await baixaExternaIugu(cfg, m.externalId, `inscricao-${registrationId}`, 'Pagamento manual na secretaria') : { ok: false, message: 'conexão iugu indisponível' }
      if (!r.ok) { ok = false; avisos.push(`iugu ${m.externalId}: ${r.message} — dê baixa no painel da iugu`) }
    } else if (m.externalId && m.provider === 'asaas') {
      const { decryptToken } = await import('./cloudApi.js')
      const { cancelarCobrancaAsaas } = await import('./paymentAsaas.js')
      let chave: string | null = null
      try { chave = conn?.provider === 'asaas' ? decryptToken(conn.apiKey) : null } catch { chave = null }
      const r = chave ? await cancelarCobrancaAsaas({ apiKey: chave, environment: conn!.environment === 'production' ? 'production' : 'sandbox' }, m.externalId) : { ok: false, message: 'conexão Asaas indisponível' }
      if (!r.ok) { ok = false; avisos.push(`Asaas ${m.externalId}: ${r.message} — cancele no painel do Asaas`) }
    } else if (m.externalId && !['simulado', PROVEDOR_MANUAL, 'isencao'].includes(m.provider)) {
      ok = false; avisos.push(`${m.provider} ${m.externalId}: cancele no painel do gateway`)
    }
    await prisma.enrollmentPaymentMethod.update({
      where: { id: m.id },
      data: { status: ok ? 'canceled' : 'failed', lastErrorMessage: 'Substituída por pagamento manual' },
    }).catch(() => {})
  }
  return avisos
}

/**
 * Lê o pedido (multipart) — o mesmo para a página da inscrição e para o
 * Financeiro do portal: valor, pagoEm (AAAA-MM-DD), forma, motivo e o arquivo
 * `comprovante`. Um caminho só, com as mesmas regras.
 */
export async function pagamentoManualDaRequisicao(req: any, registrationId: number, usuario: { id: number; nome: string }):
  Promise<{ ok: true } | { ok: false; status: number; erro: string }> {
  const file = await req.file?.({ limits: { fileSize: 15 * 1024 * 1024 } }).catch(() => null)
  if (!file) return { ok: false, status: 400, erro: 'Anexe o comprovante do pagamento.' }
  const ext = String(file.filename.split('.').pop() || '').toLowerCase()
  if (!['pdf', 'jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'].includes(ext)) return { ok: false, status: 400, erro: 'Comprovante em PDF ou imagem (JPG, PNG, WebP, HEIC).' }
  const partes: Buffer[] = []
  for await (const c of file.file) partes.push(c)
  if (file.file.truncated) return { ok: false, status: 413, erro: 'Comprovante muito grande (máx. 15 MB).' }
  let buf: Buffer = Buffer.concat(partes)
  try {
    const { validateUploadContent } = await import('../lib/uploadSafety.js')
    buf = validateUploadContent(buf, ext, { allowSvg: false })
  } catch (e: any) { return { ok: false, status: 400, erro: e?.message || 'Arquivo inválido' } }
  const campo = (n: string) => String(file.fields?.[n]?.value ?? '').trim()
  const bruto = campo('valor').replace(/[^\d,.-]/g, '')
  const valorNum = Number(bruto.includes(',') ? bruto.replace(/\./g, '').replace(',', '.') : bruto)
  // Data do pagamento é um DIA. "Futuro" se compara pelo dia de hoje em
  // Brasília — guardar às 12h e comparar com o relógio recusava, às 8h da
  // manhã, um pagamento feito hoje.
  const dia = campo('pagoEm').slice(0, 10)
  const hojeBr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
  if (/^\d{4}-\d{2}-\d{2}$/.test(dia) && dia > hojeBr) return { ok: false, status: 400, erro: 'A data do pagamento não pode ser no futuro.' }
  const pagoEm = /^\d{4}-\d{2}-\d{2}$/.test(dia) ? new Date(`${dia}T12:00:00-03:00`) : new Date(NaN)
  const r = await registrarPagamentoManual({
    registrationId,
    valorCentavos: Number.isFinite(valorNum) ? Math.round(valorNum * 100) : NaN,
    pagoEm, forma: campo('forma'), motivo: campo('motivo'),
    comprovante: { buffer: buf, ext, nomeOriginal: file.filename, mime: file.mimetype || 'application/octet-stream' },
    usuario, req,
  })
  return r.ok ? { ok: true } : r
}

export interface PagamentoManualInput {
  registrationId: number
  valorCentavos: number
  pagoEm: Date
  forma: string
  motivo: string
  comprovante: { buffer: Buffer; ext: string; nomeOriginal: string; mime: string }
  usuario: { id: number; nome: string }
  req?: any
}

export async function registrarPagamentoManual(p: PagamentoManualInput): Promise<
  { ok: true; registrationId: number; methodId: number } | { ok: false; status: number; erro: string }
> {
  if (!FORMAS_PAGAMENTO_MANUAL[p.forma]) return { ok: false, status: 400, erro: 'Escolha a forma de pagamento.' }
  if (!Number.isInteger(p.valorCentavos) || p.valorCentavos < 100) {
    return { ok: false, status: 400, erro: 'Informe o valor recebido (mínimo R$ 1,00). Para isentar, use um cupom de 100%.' }
  }
  if (!(p.pagoEm instanceof Date) || isNaN(p.pagoEm.getTime())) return { ok: false, status: 400, erro: 'Informe a data do pagamento.' }
  // O dia já foi conferido por quem chamou; aqui só barra absurdo (meio-dia de amanhã).
  if (p.pagoEm.getTime() > Date.now() + 24 * 3600 * 1000) return { ok: false, status: 400, erro: 'A data do pagamento não pode ser no futuro.' }
  const motivo = String(p.motivo || '').trim()
  if (motivo.length < 10) return { ok: false, status: 400, erro: 'Explique o motivo (ao menos 10 caracteres) — ex.: "pagou em dinheiro na secretaria do polo".' }

  const reg = await prisma.enrollmentRegistration.findUnique({
    where: { id: p.registrationId },
    select: { id: true, leadId: true, candidateCode: true, portalId: true, status: true, paymentStatus: true, paymentPlan: true },
  })
  if (!reg) return { ok: false, status: 404, erro: 'Inscrição não encontrada' }
  if (['cancelled', 'merged', 'expired'].includes(reg.status)) return { ok: false, status: 409, erro: 'Inscrição cancelada, expirada ou mesclada não recebe pagamento.' }
  if (reg.paymentStatus === 'paid') return { ok: false, status: 409, erro: 'Esta inscrição já está paga.' }

  // Comprovante primeiro: sem arquivo gravado, nada muda na inscrição.
  const pasta = pastaDosComprovantes()
  await fs.mkdir(pasta, { recursive: true })
  const arquivo = `comprovante-manual-${reg.id}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${p.comprovante.ext}`
  await fs.writeFile(join(pasta, arquivo), p.comprovante.buffer)

  const agora = new Date()
  const valor = p.valorCentavos / 100
  const externalId = `manual-${reg.id}-${agora.getTime()}`
  const registro = {
    forma: p.forma, valor, pagoEm: p.pagoEm.toISOString(), motivo,
    comprovante: { url: `/uploads/enrollment-docs/${arquivo}`, nome: p.comprovante.nomeOriginal.slice(0, 191), mime: p.comprovante.mime },
    por: { id: p.usuario.id, nome: p.usuario.nome }, em: agora.toISOString(),
  }

  // Uma transição só para "pago" (mesma régua do paymentSync e da isenção).
  // NULL entra: no SQL, "<> 'paid'" deixa de fora a inscrição que nunca gerou
  // cobrança — e ela era dada como "já paga".
  const r = await prisma.enrollmentRegistration.updateMany({
    where: { id: reg.id, OR: [{ paymentStatus: null }, { paymentStatus: { not: 'paid' } }] },
    data: {
      paymentStatus: 'paid',
      paymentPaidAt: p.pagoEm,
      status: 'paid',
      paymentAmount: valor,
      paymentMethod: 'MANUAL',
      paymentId: externalId,
      paymentUrl: null,
      paymentExpiresAt: null,
      paymentPlan: { ...((reg.paymentPlan as object) ?? {}), valorCobrado: valor, pagamentoManual: registro } as any,
    },
  })
  if (r.count === 0) {
    await fs.unlink(join(pasta, arquivo)).catch(() => {})
    return { ok: false, status: 409, erro: 'Esta inscrição já está paga.' }
  }

  // O candidato não pode pagar de novo o Pix/boleto que estava aberto.
  const avisos = await encerrarCobrancasAbertas(reg.id).catch((e) => [`cobranças abertas não conferidas: ${e?.message}`])

  const metodo = await prisma.enrollmentPaymentMethod.create({
    data: {
      registrationId: reg.id, provider: PROVEDOR_MANUAL, method: 'manual', externalId,
      status: 'paid', amount: valor, paidAt: p.pagoEm, expiresAt: null,
    },
  })

  // Efeitos de pagamento confirmado — os mesmos do gateway.
  await import('./portalCupom.js').then((m) => m.consumirCupom(reg.id)).catch(() => {})
  await prisma.enrollmentPortal.update({ where: { id: reg.portalId }, data: { conversions: { increment: 1 } } }).catch(() => {})
  const reais = valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  if (reg.leadId) {
    logEvent({
      leadId: reg.leadId,
      type: 'payment_received',
      category: 'lifecycle',
      title: `Pagamento manual registrado — ${reg.candidateCode} (${reais})`,
      description: `${FORMAS_PAGAMENTO_MANUAL[p.forma]} em ${p.pagoEm.toLocaleDateString('pt-BR')}. Motivo: ${motivo}`,
      channel: 'payment',
      source: PROVEDOR_MANUAL,
      actorType: 'operator',
      userId: p.usuario.id,
      userName: p.usuario.nome,
      metadata: { registrationId: reg.id, amount: valor, forma: p.forma, paymentId: externalId, manual: true },
    })
  }
  await registrarEventoDaInscricao({
    registrationId: reg.id, etapa: 'pagamento', acao: 'pagamento_manual', ator: 'atendente',
    userId: p.usuario.id, userName: p.usuario.nome, req: p.req ?? null,
    dados: { valor, forma: p.forma, pagoEm: p.pagoEm.toISOString(), motivo, cobrancasCanceladas: avisos.length ? avisos : undefined },
  })
  try {
    const { logSecurityEvent } = await import('./security.js')
    await logSecurityEvent({
      ip: p.req?.ip || '', type: 'payment_confirmed_manual', severity: 'medium', path: p.req?.url || '',
      details: `${reg.candidateCode} marcado PAGO manualmente por ${p.usuario.nome} (#${p.usuario.id}) — ${reais}, ${p.forma}`,
    } as any)
  } catch { /* trilha de segurança é complementar */ }
  import('./enrollmentNotify.js').then((m) =>
    m.sendPaymentConfirmation?.({ enrollmentId: reg.id }).catch(() => {}),
  ).catch(() => {})

  return { ok: true, registrationId: reg.id, methodId: metodo.id }
}
