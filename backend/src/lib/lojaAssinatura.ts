// src/lib/lojaAssinatura.ts
//
// A porta por onde a loja central fala com este tenant.
//
// A loja mora fora: é ela que guarda preço, cobrança e a credencial do Asaas do
// Attrae. Aqui só chega o RESULTADO — quais pacotes o cliente tem direito de
// usar e até quando.
//
// ⚠️ Autenticação por HMAC e não por sessão: quem chama é um servidor, não uma
// pessoa. O segredo vive no .env (`LOJA_SEGREDO`), único por instalação, e não
// no banco — o superadmin do cliente lê o banco pela tela de configurações e
// não pode alcançar nada da loja.

import { createHmac, timingSafeEqual } from 'node:crypto'

/** Quanto tempo um pedido assinado continua válido. */
const JANELA_SEGUNDOS = 300

export type ResultadoAssinatura =
  | { ok: true }
  | { ok: false; motivo: 'sem_segredo' | 'sem_assinatura' | 'fora_da_janela' | 'assinatura_invalida' }

/**
 * Confere a assinatura de um pedido da loja.
 *
 * Assina-se `timestamp.corpoCru` — o corpo CRU, não o objeto já interpretado:
 * reserializar JSON reordena chaves e muda espaços, e a assinatura passaria a
 * depender de detalhes do parser dos dois lados.
 *
 * O timestamp entra na mensagem assinada de propósito. Sem ele, um pedido
 * capturado valeria para sempre — bastaria repeti-lo para renovar de graça.
 *
 * ⚠️ Pedido SEM corpo (GET) assina a string vazia, não `"{}"`. É a pegadinha
 * mais provável de quem for escrever o outro lado: um corpo "vazio" serializado
 * como objeto não bate com a ausência de corpo.
 */
export function conferirAssinatura(input: {
  corpoCru: string
  assinatura: string | undefined
  timestamp: string | undefined
  segredo: string | undefined
  agora?: number
}): ResultadoAssinatura {
  if (!input.segredo) return { ok: false, motivo: 'sem_segredo' }
  if (!input.assinatura || !input.timestamp) return { ok: false, motivo: 'sem_assinatura' }

  const enviadoEm = Number(input.timestamp)
  if (!Number.isFinite(enviadoEm)) return { ok: false, motivo: 'fora_da_janela' }
  const agora = input.agora ?? Math.floor(Date.now() / 1000)
  // Janela dos dois lados: relógio adiantado no servidor da loja é tão comum
  // quanto atrasado, e recusar por isso seria falha intermitente e inexplicável.
  if (Math.abs(agora - enviadoEm) > JANELA_SEGUNDOS) return { ok: false, motivo: 'fora_da_janela' }

  const esperada = createHmac('sha256', input.segredo)
    .update(`${input.timestamp}.${input.corpoCru}`)
    .digest('hex')

  // Comparação de tempo constante: `===` vaza, pelo tempo de resposta, quantos
  // caracteres iniciais bateram, e isso basta para descobrir a assinatura byte
  // a byte.
  const a = Buffer.from(esperada, 'utf8')
  const b = Buffer.from(input.assinatura, 'utf8')
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, motivo: 'assinatura_invalida' }
  }
  return { ok: true }
}

/** O mesmo cálculo, para quem assina (a loja, e os testes). */
export function assinarPedido(segredo: string, timestamp: string, corpoCru: string): string {
  return createHmac('sha256', segredo).update(`${timestamp}.${corpoCru}`).digest('hex')
}
