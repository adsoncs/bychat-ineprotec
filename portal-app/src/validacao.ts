// Validação e máscara dos campos do formulário.
//
// Tudo aqui roda enquanto a pessoa digita, e cada mensagem diz o que fazer, não
// só que está errado: quem está preenchendo isso no ônibus não vai adivinhar o
// que "campo inválido" quer dizer.

export type Tipo = 'text' | 'email' | 'phone' | 'cpf' | 'date' | 'cep' | 'select' | 'textarea' | 'offering-picker'

const digitos = (v: string) => v.replace(/\D+/g, '')

/** CPF pelos dígitos verificadores — não basta ter 11 números. */
export function cpfValido(valor: string): boolean {
  const d = digitos(valor)
  if (d.length !== 11) return false
  if (/^(\d)\1{10}$/.test(d)) return false // 111.111.111-11 e afins passam na conta
  for (const peso of [10, 11]) {
    let soma = 0
    for (let i = 0; i < peso - 1; i++) soma += Number(d[i]) * (peso - i)
    const resto = (soma * 10) % 11 % 10
    if (resto !== Number(d[peso - 1])) return false
  }
  return true
}

export function emailValido(valor: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(valor.trim())
}

/** Celular brasileiro: DDD + 9 dígitos. Fixo não recebe WhatsApp. */
export function celularValido(valor: string): boolean {
  const d = digitos(valor)
  if (d.length !== 11) return false
  const ddd = Number(d.slice(0, 2))
  if (ddd < 11 || ddd > 99) return false
  return d[2] === '9'
}

export function dataValida(valor: string): boolean {
  const m = valor.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) return false
  const [, dd, mm, aaaa] = m
  const d = new Date(Number(aaaa), Number(mm) - 1, Number(dd))
  if (d.getDate() !== Number(dd) || d.getMonth() !== Number(mm) - 1) return false
  const anos = (Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000)
  return anos >= 10 && anos <= 100
}

export function cepValido(valor: string): boolean {
  return digitos(valor).length === 8
}

// ── Máscaras ──────────────────────────────────────────────────────────────
export function mascarar(tipo: Tipo, valor: string): string {
  const d = digitos(valor)
  switch (tipo) {
    case 'cpf':
      return d.slice(0, 11)
        .replace(/(\d{3})(\d)/, '$1.$2')
        .replace(/(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
        .replace(/(\d{3})\.(\d{3})\.(\d{3})(\d{1,2})/, '$1.$2.$3-$4')
    case 'phone': {
      const n = d.slice(0, 11)
      if (n.length <= 2) return n
      if (n.length <= 7) return `(${n.slice(0, 2)}) ${n.slice(2)}`
      return `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}`
    }
    case 'date':
      return d.slice(0, 8).replace(/(\d{2})(\d)/, '$1/$2').replace(/(\d{2})\/(\d{2})(\d)/, '$1/$2/$3')
    case 'cep':
      return d.slice(0, 8).replace(/(\d{5})(\d)/, '$1-$2')
    default:
      return valor
  }
}

/** Teclado do celular: número onde só entra número. */
export function modoEntrada(tipo: Tipo): string | undefined {
  if (tipo === 'cpf' || tipo === 'phone' || tipo === 'cep' || tipo === 'date') return 'numeric'
  if (tipo === 'email') return 'email'
  return undefined
}

export interface Campo {
  type: Tipo
  name: string
  label: string
  required?: boolean
  options?: string[]
  placeholder?: string
  helpText?: string
  visibleWhen?: { entryMode?: string[] }
}

/**
 * Mensagem de erro do campo, ou null. `parcial` vale enquanto a pessoa digita:
 * não acusa "CPF incompleto" no terceiro dígito, só quando ela sai do campo.
 */
export function erroDoCampo(campo: Campo, valor: string, parcial = false): string | null {
  const v = String(valor ?? '').trim()
  if (!v) return campo.required && !parcial ? `${campo.label} é obrigatório.` : null

  switch (campo.type) {
    case 'cpf':
      if (digitos(v).length < 11) return parcial ? null : 'Faltam dígitos no CPF — são 11 ao todo.'
      return cpfValido(v) ? null : 'Esse CPF não confere. Verifique os números digitados.'
    case 'email':
      if (parcial) return null
      return emailValido(v) ? null : 'E-mail incompleto. O formato é nome@provedor.com.'
    case 'phone':
      if (digitos(v).length < 11) return parcial ? null : 'Informe DDD e o número com 9 dígitos.'
      return celularValido(v) ? null : 'Precisa ser um celular com WhatsApp (DDD + 9 dígitos).'
    case 'date':
      if (v.length < 10) return parcial ? null : 'Data incompleta — use dia/mês/ano.'
      return dataValida(v) ? null : 'Essa data não existe ou está fora do esperado.'
    case 'cep':
      if (digitos(v).length < 8) return parcial ? null : 'CEP tem 8 dígitos.'
      return cepValido(v) ? null : 'CEP inválido.'
    default:
      return null
  }
}

// ── Cartão de crédito ────────────────────────────────────────────────────────
//
// A mesma checagem que o servidor faz, repetida aqui pelo motivo de sempre:
// dizer o erro enquanto a pessoa digita. Cada tentativa que chega ao provedor
// com número errado conta como transação recusada na conta da instituição.

/** Dígito verificador do cartão. Pega a maioria dos erros de digitação. */
export function luhnValido(numero: string): boolean {
  const n = numero.replace(/\D/g, '')
  if (n.length < 13 || n.length > 19) return false
  let soma = 0
  let dobra = false
  for (let i = n.length - 1; i >= 0; i--) {
    let d = n.charCodeAt(i) - 48
    if (dobra) {
      d *= 2
      if (d > 9) d -= 9
    }
    soma += d
    dobra = !dobra
  }
  return soma % 10 === 0
}

/** Bandeira pelo prefixo — serve para mostrar o nome e ajustar o tamanho do CVV. */
export function bandeira(numero: string): { nome: string; digitosCcv: number } | null {
  const n = numero.replace(/\D/g, '')
  if (!n) return null
  if (/^4/.test(n)) return { nome: 'Visa', digitosCcv: 3 }
  if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(n)) return { nome: 'Mastercard', digitosCcv: 3 }
  if (/^3[47]/.test(n)) return { nome: 'American Express', digitosCcv: 4 }
  if (/^(606282|3841)/.test(n)) return { nome: 'Hipercard', digitosCcv: 3 }
  if (/^(4011|4312|4389|5041|5066|5090|6277|6363|650)/.test(n)) return { nome: 'Elo', digitosCcv: 3 }
  if (/^3(0[0-5]|[68])/.test(n)) return { nome: 'Diners', digitosCcv: 3 }
  return null
}

/** Agrupa em blocos de 4 (6-4-5 no Amex, que é como vem impresso no cartão). */
export function mascaraCartao(valor: string): string {
  const n = valor.replace(/\D/g, '').slice(0, 19)
  const amex = /^3[47]/.test(n)
  const blocos = amex ? [4, 6, 5] : [4, 4, 4, 4, 3]
  const saida: string[] = []
  let i = 0
  for (const t of blocos) {
    if (i >= n.length) break
    saida.push(n.slice(i, i + t))
    i += t
  }
  return saida.join(' ')
}

/** MM/AA enquanto digita. */
export function mascaraValidade(valor: string): string {
  const n = valor.replace(/\D/g, '').slice(0, 4)
  if (n.length <= 2) return n
  return `${n.slice(0, 2)}/${n.slice(2)}`
}

export interface DadosDoCartao {
  holderName: string
  number: string
  expiryMonth: string
  expiryYear: string
  ccv: string
}

/**
 * Diz o que falta no cartão, campo a campo. Devolve `{}` quando está tudo certo.
 * `parcial` vale enquanto a pessoa digita: não acusa o que ainda não terminou.
 */
export function errosDoCartao(c: Partial<DadosDoCartao>, parcial = false): Record<string, string> {
  const e: Record<string, string> = {}
  const numero = (c.number ?? '').replace(/\D/g, '')

  if (!numero) {
    if (!parcial) e.number = 'Informe o número do cartão.'
  } else if (numero.length < 13) {
    if (!parcial) e.number = 'Número incompleto.'
  } else if (!luhnValido(numero)) {
    e.number = 'Esse número não confere — verifique os dígitos.'
  }

  const nome = (c.holderName ?? '').trim()
  if (!nome) {
    if (!parcial) e.holderName = 'Informe o nome como está no cartão.'
  } else if (nome.length < 2) {
    e.holderName = 'Nome muito curto.'
  } else if (!nome.includes(' ') && !parcial) {
    e.holderName = 'Use o nome completo, como aparece no cartão.'
  }

  const mes = (c.expiryMonth ?? '').padStart(2, '0')
  const ano = c.expiryYear ?? ''
  if (!mes || !ano) {
    if (!parcial) e.validade = 'Informe a validade.'
  } else if (!/^(0[1-9]|1[0-2])$/.test(mes)) {
    e.validade = 'Mês inválido.'
  } else {
    const cheio = ano.length === 2 ? `20${ano}` : ano
    const vence = new Date(Number(cheio), Number(mes), 0, 23, 59, 59)
    if (Number.isNaN(vence.getTime())) e.validade = 'Validade inválida.'
    else if (vence < new Date()) e.validade = 'Cartão vencido.'
  }

  const ccv = (c.ccv ?? '').replace(/\D/g, '')
  const esperado = bandeira(numero)?.digitosCcv ?? 3
  if (!ccv) {
    if (!parcial) e.ccv = 'Informe o código de segurança.'
  } else if (ccv.length < esperado) {
    if (!parcial) e.ccv = `O código tem ${esperado} dígitos.`
  }

  return e
}
