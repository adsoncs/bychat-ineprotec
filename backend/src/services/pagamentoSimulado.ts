// src/services/pagamentoSimulado.ts
//
// Provedor de pagamento SIMULADO — mesma ideia do modo simulado da assinatura
// (services/autentique.ts): permite construir e testar o fluxo inteiro de
// cobrança — PIX na tela, boleto, acompanhamento, baixa e efeitos posteriores —
// sem credencial de gateway e sem mover dinheiro.
//
// ⚠️ Regra de segurança: a confirmação manual de pagamento só existe para
// conexões cujo provider é 'simulado'. Uma conexão real (asaas/pagarme) nunca
// aceita "marcar como pago" por rota — senão o modo de teste viraria uma porta
// para quitar cobrança de verdade.

import crypto from 'crypto'

export const PROVIDER_SIMULADO = 'simulado'

export interface CobrancaSimulada {
  chargeId: string
  status: string
  pixQrCode?: string
  pixQrCodeUrl?: string
  boletoLine?: string
  boletoBarcode?: string
  boletoPdfUrl?: string
  cardLastDigits?: string
  cardBrand?: string
  expiresAt: Date
}

/** Dígitos pseudo-aleatórios estáveis para o mesmo insumo. */
function digitos(semente: string, tamanho: number): string {
  const h = crypto.createHash('sha256').update(semente).digest('hex')
  let out = ''
  for (const c of h) {
    out += String(parseInt(c, 16) % 10)
    if (out.length >= tamanho) break
  }
  return out.slice(0, tamanho)
}

/**
 * Gera uma cobrança de mentira com a mesma forma da de verdade: o payload PIX
 * segue o formato EMV (BR Code), então o QR renderiza e o "copia e cola" tem a
 * cara certa na tela — só não é aceito por banco nenhum.
 */
export function criarCobrancaSimulada(input: {
  metodo: 'pix' | 'boleto' | 'credit_card'
  valor: number
  vencimento: Date
  referencia: string
  descricao?: string
}): CobrancaSimulada {
  const chargeId = `sim_${digitos(input.referencia + Date.now(), 12)}`
  const base: CobrancaSimulada = {
    chargeId,
    status: input.metodo === 'credit_card' ? 'CONFIRMED' : 'PENDING',
    expiresAt: input.vencimento,
  }

  if (input.metodo === 'pix') {
    const valor = input.valor.toFixed(2)
    const txid = digitos(chargeId, 25)
    // BR Code simplificado — campos na ordem do padrão, com CRC fixo de teste.
    base.pixQrCode = [
      '00020126', '580014BR.GOV.BCB.PIX',
      `0136${'00000000-0000-4000-8000-' + digitos(chargeId, 12)}`,
      '52040000', '5303986', `54${String(valor.length).padStart(2, '0')}${valor}`,
      '5802BR', '5913PAGAMENTO SIM', '6009SAO PAULO',
      `62${String(txid.length + 4).padStart(2, '0')}05${String(txid.length).padStart(2, '0')}${txid}`,
      '6304SIMU',
    ].join('')
  }

  if (input.metodo === 'boleto') {
    const d = digitos(chargeId, 47)
    base.boletoLine = `${d.slice(0, 5)}.${d.slice(5, 10)} ${d.slice(10, 15)}.${d.slice(15, 21)} ${d.slice(21, 26)}.${d.slice(26, 32)} ${d.slice(32, 33)} ${d.slice(33, 47)}`
    base.boletoBarcode = d.slice(0, 44)
    base.boletoPdfUrl = null as unknown as string // não há PDF em modo simulado
  }

  if (input.metodo === 'credit_card') {
    base.cardLastDigits = digitos(chargeId, 4)
    base.cardBrand = 'SIMULADO'
  }

  return base
}

/** O provedor desta conexão é o simulado? */
export const ehSimulado = (provider: string | null | undefined): boolean =>
  String(provider || '').toLowerCase() === PROVIDER_SIMULADO
