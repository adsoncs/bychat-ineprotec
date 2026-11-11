// services/atualizarFatura.ts — "Atualizar fatura vencida".
//
// Boleto/Pix vencido ganha nova data na MESMA cobrança do Asaas: o id, o link
// da fatura e os avisos de pagamento seguem valendo, então a baixa continua
// chegando onde já chegava (inscrição, título do combinado/acordo, parcela do
// Meu Portal, parcela do acadêmico). O Asaas renova o código do boleto e o QR
// do Pix. Valor NÃO muda: sem multa nem juros (decisão da ineprotec, 11/11).
//
// Quem pode:
//   - aluno (Meu Portal e tela de pagamento): só a vencida, e só para HOJE;
//   - equipe (inscrição e Financeiro): vencida ou em aberto, de hoje a 60 dias.
// Cartão de crédito não entra: lá o caminho é gerar nova forma de pagamento.

import { prisma } from '../lib/prisma.js'
import { atualizarVencimentoAsaas, consultarCobrancaAsaas, fetchAsaasBoletoLinha, fetchAsaasPixQr } from './paymentAsaas.js'
import { configDaInscricao, hojeBr } from './pagamentoCombinado.js'
import { registrarEventoDaInscricao } from './inscricaoAssistida.js'

type Ator = { tipo: 'candidato'; req?: any } | { tipo: 'atendente'; userId: number | null; nome: string | null; req?: any }

export type ResultadoAtualizacao =
  | { ok: true; vencimento: string; link: string | null; pix: string | null; linha: string | null; boletoPdf: string | null; valor: number; jaEstava: boolean }
  | { ok: false; status: number; erro: string }

const EM_ABERTO_NO_ASAAS = ['PENDING', 'OVERDUE']
const MAX_DIAS_EQUIPE = 60

function somarDias(iso: string, dias: number) {
  const d = new Date(`${iso}T12:00:00-03:00`)
  d.setUTCDate(d.getUTCDate() + dias)
  return hojeBr(d)
}

/** Fim do dia em Brasília: é até quando a cobrança vale (paymentExpiresAt). */
const fimDoDia = (iso: string) => new Date(`${iso}T23:59:00-03:00`)
const meioDia = (iso: string) => new Date(`${iso}T12:00:00-03:00`)

/** De qual cobrança do Asaas a chave fala — e se ela é mesmo desta inscrição. */
async function cobrancaDaChave(registrationId: number, chave: string): Promise<{ id: string } | { erro: string; status: number }> {
  const reg = await prisma.enrollmentRegistration.findUnique({
    where: { id: registrationId },
    select: { id: true, paymentId: true, paymentStatus: true, paymentMethod: true, paymentPlan: true },
  })
  if (!reg) return { erro: 'Inscrição não encontrada.', status: 404 }
  const [tipo, resto] = [chave.slice(0, chave.indexOf(':')), chave.slice(chave.indexOf(':') + 1)]

  if (tipo === 'titulo') {
    const t = await prisma.enrollmentTitulo.findFirst({ where: { id: Number(resto), registrationId } })
    if (!t) return { erro: 'Fatura não encontrada.', status: 404 }
    if (t.meio === 'credit_card') return { erro: 'Cobrança no cartão não muda de data: gere uma nova forma de pagamento.', status: 409 }
    if (!['aberta', 'prevista'].includes(t.status) || !t.externalId) return { erro: 'Esta fatura não está em aberto.', status: 409 }
    if (t.provider && t.provider !== 'asaas') return { erro: 'Só faturas do Asaas podem ser atualizadas por aqui.', status: 409 }
    return { id: t.externalId }
  }
  if (tipo === 'reg') {
    if (Number(resto) !== registrationId) return { erro: 'Fatura não encontrada.', status: 404 }
    if (reg.paymentStatus === 'paid') return { erro: 'Esta fatura já foi paga.', status: 409 }
    if (!reg.paymentId || String(reg.paymentMethod || '').toUpperCase() === 'MANUAL' || reg.paymentId.startsWith('manual')) return { erro: 'Não há cobrança do gateway para atualizar.', status: 409 }
    const m = await prisma.enrollmentPaymentMethod.findFirst({ where: { registrationId, externalId: reg.paymentId }, orderBy: { id: 'desc' } })
    if (m && m.provider !== 'asaas') return { erro: 'Só faturas do Asaas podem ser atualizadas por aqui.', status: 409 }
    if (m?.method === 'credit_card') return { erro: 'Cobrança no cartão não muda de data: gere uma nova forma de pagamento.', status: 409 }
    return { id: reg.paymentId }
  }
  if (tipo === 'asaas') {
    // Parcela gerada no Meu Portal, ou parcela do parcelamento do próprio Asaas.
    const plano = (reg.paymentPlan ?? {}) as any
    const doPortal = Object.values(plano.parcelasPortal ?? {}).some((g: any) => g?.id === resto)
    if (doPortal) return { id: resto }
    if (plano.installmentId) {
      const cfg = await configDaInscricao(registrationId)
      const p = cfg ? await consultarCobrancaAsaas(cfg, resto).catch(() => null) : null
      if (p && p.installment === plano.installmentId) return { id: resto }
    }
    return { erro: 'Fatura não encontrada.', status: 404 }
  }
  return { erro: 'Fatura inválida.', status: 400 }
}

const emAndamento = new Map<string, Promise<ResultadoAtualizacao>>()

export async function atualizarFaturaVencida(p: { registrationId: number; chave: string; vencimento?: string | null; ator: Ator }): Promise<ResultadoAtualizacao> {
  const hoje = hojeBr()
  const venc = p.ator.tipo === 'candidato' ? hoje : String(p.vencimento || hoje)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(venc) || venc < hoje) return { ok: false, status: 400, erro: 'Informe a nova data, de hoje em diante.' }
  if (venc > somarDias(hoje, MAX_DIAS_EQUIPE)) return { ok: false, status: 400, erro: `A nova data pode ser no máximo ${MAX_DIAS_EQUIPE} dias à frente.` }

  const alvo = await cobrancaDaChave(p.registrationId, p.chave)
  if ('erro' in alvo) return { ok: false, status: alvo.status, erro: alvo.erro }

  // Dois cliques (ou aluno e equipe juntos): o segundo espera o primeiro.
  const anterior = emAndamento.get(alvo.id)
  if (anterior) await anterior.catch(() => null)
  const tarefa = executar(p, alvo.id, venc, hoje)
  emAndamento.set(alvo.id, tarefa)
  try { return await tarefa } finally { if (emAndamento.get(alvo.id) === tarefa) emAndamento.delete(alvo.id) }
}

async function executar(p: { registrationId: number; chave: string; ator: Ator }, id: string, venc: string, hoje: string): Promise<ResultadoAtualizacao> {
  const cfg = await configDaInscricao(p.registrationId)
  if (!cfg) return { ok: false, status: 503, erro: 'Pagamento indisponível no momento. Fale com a secretaria.' }
  let atual: any
  try { atual = await consultarCobrancaAsaas(cfg, id) } catch (e: any) {
    return { ok: false, status: e?.status === 404 ? 404 : 502, erro: e?.status === 404 ? 'A cobrança não existe mais no Asaas.' : 'Não foi possível consultar a fatura agora. Tente de novo em alguns minutos.' }
  }
  if (atual?.deleted || !EM_ABERTO_NO_ASAAS.includes(String(atual?.status))) {
    const paga = ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'].includes(String(atual?.status))
    return {
      ok: false, status: 409,
      erro: paga ? 'Esta fatura já foi paga. Atualize a página em instantes.'
        : atual?.deleted ? (p.ator.tipo === 'candidato' ? 'Esta cobrança foi cancelada. Fale com a secretaria para gerar uma nova.' : 'A cobrança foi apagada no Asaas: não dá para mudar a data. Gere uma nova forma de pagamento.')
          : 'Esta fatura não está mais em aberto.',
    }
  }
  if (atual.billingType === 'CREDIT_CARD') return { ok: false, status: 409, erro: 'Cobrança no cartão não muda de data: gere uma nova forma de pagamento.' }
  const de = String(atual.dueDate || '')
  if (p.ator.tipo === 'candidato' && de >= hoje) {
    // Ainda no prazo: nada a atualizar, só devolve os códigos.
    return { ok: true, ...(await codigos(cfg, id, atual)), vencimento: de, valor: Number(atual.value) || 0, jaEstava: true }
  }

  let novo = atual
  if (de !== venc) {
    try { novo = await atualizarVencimentoAsaas(cfg, id, venc) } catch (e: any) {
      return { ok: false, status: 502, erro: `O Asaas não aceitou a nova data${e?.message ? ` (${String(e.message).replace(/^Asaas:\s*/, '')})` : ''}.` }
    }
  }
  const c = await codigos(cfg, id, novo)
  await gravarLocal(p.registrationId, id, venc, c)
  // Meu Portal lê as parcelas do Asaas com 1 min de cache: esquece para mostrar a nova data já.
  ;(await import('./areaDoAluno.js')).esquecerConsultasDoAsaas()
  await registrarEventoDaInscricao({
    registrationId: p.registrationId, etapa: 'pagamento', acao: 'fatura_atualizada',
    ator: p.ator.tipo, userId: p.ator.tipo === 'atendente' ? p.ator.userId : null, userName: p.ator.tipo === 'atendente' ? p.ator.nome : null,
    req: p.ator.req ?? null,
    dados: { chave: p.chave, cobranca: id, de, para: venc, valor: Number(novo.value) || 0 },
  }).catch(() => {})
  return { ok: true, ...c, vencimento: venc, valor: Number(novo.value) || 0, jaEstava: de === venc }
}

async function codigos(cfg: any, id: string, p: any) {
  const comBoleto = p.billingType === 'BOLETO' || p.billingType === 'UNDEFINED'
  const [pix, linha] = await Promise.all([
    fetchAsaasPixQr(cfg, id).catch(() => null),
    comBoleto ? fetchAsaasBoletoLinha(cfg, id).catch(() => null) : Promise.resolve(null),
  ])
  return { link: p.invoiceUrl || null, boletoPdf: comBoleto ? (p.bankSlipUrl || null) : null, pix: pix?.payload ?? null, linha: linha?.linha ?? null }
}

/** Tudo o que guarda a data dessa cobrança passa a ter a nova. */
async function gravarLocal(registrationId: number, id: string, venc: string, c: { pix: string | null; linha: string | null; link: string | null; boletoPdf: string | null }) {
  await prisma.enrollmentTitulo.updateMany({
    where: { registrationId, externalId: id },
    data: { vencimento: venc, lastError: null, ...(c.pix ? { pixCopiaCola: c.pix } : {}), ...(c.linha ? { boletoLinha: c.linha } : {}), ...(c.link ? { invoiceUrl: c.link } : {}) },
  })
  await prisma.enrollmentPaymentMethod.updateMany({
    where: { registrationId, externalId: id, status: { in: ['pending', 'overdue', 'expired', 'failed'] } },
    data: { status: 'pending', expiresAt: fimDoDia(venc), boletoDueAt: meioDia(venc), lastErrorMessage: null, ...(c.pix ? { qrCode: c.pix } : {}), ...(c.linha ? { boletoLine: c.linha } : {}) },
  })
  const reg = await prisma.enrollmentRegistration.findUnique({ where: { id: registrationId }, select: { paymentId: true, paymentStatus: true, status: true, paymentPlan: true } })
  if (!reg) return
  const data: Record<string, any> = {}
  // A cobrança principal da inscrição (ou a entrada do combinado): volta a valer até o fim do dia.
  if (reg.paymentId === id && reg.paymentStatus !== 'paid') {
    data.paymentStatus = 'pending'
    data.paymentExpiresAt = fimDoDia(venc)
    if (reg.status === 'expired') data.status = 'pending'
  }
  const plano = (reg.paymentPlan ?? {}) as any
  const pp = plano.parcelasPortal as Record<string, any> | undefined
  const n = pp ? Object.keys(pp).find((k) => pp[k]?.id === id) : undefined
  if (pp && n) data.paymentPlan = { ...plano, parcelasPortal: { ...pp, [n]: { ...pp[n], vencimento: venc, ...(c.link ? { invoiceUrl: c.link } : {}), ...(c.boletoPdf ? { boletoPdf: c.boletoPdf } : {}) } } }
  if (Object.keys(data).length) await prisma.enrollmentRegistration.update({ where: { id: registrationId }, data })
  await prisma.acaParcela.updateMany({ where: { asaasChargeId: id }, data: { dataVencimento: meioDia(venc) } }).catch(() => {})
}

/** Mensagem pronta para a equipe mandar ao aluno depois de atualizar. */
export async function mensagemDaFaturaAtualizada(registrationId: number, r: { vencimento: string; link: string | null; pix: string | null; linha: string | null; valor: number }) {
  const reg = await prisma.enrollmentRegistration.findUnique({ where: { id: registrationId }, select: { candidateCode: true, leadId: true, formData: true, lead: { select: { nome: true, whatsapp: true } } } })
  const nome = String(reg?.lead?.nome || (reg?.formData as any)?.nome || '').trim().split(/\s+/)[0] || ''
  const valor = r.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const dia = r.vencimento.split('-').reverse().join('/')
  const linhas = [
    `Olá${nome ? `, ${nome}` : ''}! Atualizamos a sua fatura de ${valor} (inscrição ${reg?.candidateCode ?? ''}). O novo vencimento é ${dia}.`,
    r.link ? `\nPara pagar, é só abrir: ${r.link}` : '',
    r.pix ? `\nPix copia e cola:\n${r.pix}` : '',
    r.linha ? `\nLinha digitável do boleto:\n${r.linha}` : '',
  ]
  return { texto: linhas.filter(Boolean).join('\n').trim(), leadId: reg?.leadId ?? null, whatsapp: reg?.lead?.whatsapp ?? null }
}
