// Cartão na iugu: o número vai do navegador direto para a iugu (iugu.js), e o
// que volta — e segue para o nosso servidor — é um token de uso único. O
// número, o CVV e a validade não passam pelo backend (PCI SAQ A).

import type { DadosDoCartao } from './validacao'

interface IuguCartao {
  valid(): boolean
  errors?: Record<string, unknown>
}

interface IuguJs {
  setAccountID(id: string): void
  setTestMode(teste: boolean): void
  CreditCard(numero: string, mes: string, ano: string, nome: string, sobrenome: string, cvv: string): IuguCartao
  createPaymentToken(cartao: IuguCartao, retorno: (r: { id?: string; errors?: Record<string, unknown> }) => void): void
}

declare global {
  interface Window { Iugu?: IuguJs }
}

const SCRIPT = 'https://js.iugu.com/v2'
let carregando: Promise<IuguJs> | null = null

/** Carrega o iugu.js uma vez só. Já presente na página (ou num teste), usa o que existe. */
function carregar(): Promise<IuguJs> {
  if (window.Iugu) return Promise.resolve(window.Iugu)
  if (carregando) return carregando
  carregando = new Promise<IuguJs>((ok, falha) => {
    const s = document.createElement('script')
    s.src = SCRIPT
    s.async = true
    s.onload = () => (window.Iugu ? ok(window.Iugu) : falha(new Error('iugu.js não inicializou')))
    s.onerror = () => {
      carregando = null
      falha(new Error('Não foi possível carregar o módulo de pagamento. Verifique a conexão e tente de novo.'))
    }
    document.head.appendChild(s)
  })
  return carregando
}

/** Mensagem que a pessoa entende, a partir do mapa de erros do iugu.js. */
function explicar(erros: Record<string, unknown> | undefined): string {
  const k = Object.keys(erros ?? {})
  if (k.includes('number')) return 'Número do cartão inválido.'
  if (k.includes('verification_value')) return 'Código de segurança inválido.'
  if (k.includes('expiration') || k.includes('month') || k.includes('year')) return 'Validade do cartão inválida.'
  if (k.includes('first_name') || k.includes('last_name')) return 'Informe o nome completo, como está no cartão.'
  return 'Não foi possível validar o cartão. Confira os dados.'
}

/**
 * Gera o token do cartão na iugu. Lança erro com `recusado: true` quando o
 * problema é o cartão (a tela mantém o formulário aberto para corrigir).
 */
export async function tokenizarNaIugu(conta: { accountId: string; teste: boolean }, c: DadosDoCartao): Promise<string> {
  const iugu = await carregar()
  iugu.setAccountID(conta.accountId)
  iugu.setTestMode(conta.teste)

  const partes = c.holderName.trim().split(/\s+/)
  const nome = partes.shift() ?? ''
  const sobrenome = partes.join(' ') || nome
  const cartao = iugu.CreditCard(
    c.number.replace(/\D/g, ''),
    c.expiryMonth.padStart(2, '0'),
    c.expiryYear.length === 2 ? `20${c.expiryYear}` : c.expiryYear,
    nome,
    sobrenome,
    c.ccv.replace(/\D/g, ''),
  )
  if (!cartao.valid()) {
    throw Object.assign(new Error(explicar(cartao.errors)), { recusado: true })
  }
  return new Promise<string>((ok, falha) => {
    iugu.createPaymentToken(cartao, (r) => {
      if (r?.errors && Object.keys(r.errors).length) {
        falha(Object.assign(new Error(explicar(r.errors)), { recusado: true }))
      } else if (!r?.id) {
        falha(Object.assign(new Error('Não foi possível validar o cartão. Tente de novo.'), { recusado: true }))
      } else {
        ok(r.id)
      }
    })
  })
}
