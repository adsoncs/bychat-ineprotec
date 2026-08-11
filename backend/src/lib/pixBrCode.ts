// src/lib/pixBrCode.ts
//
// Gera o "PIX copia e cola" (BR Code) a partir da chave da empresa.
//
// É o payload EMV® QRCPS do Banco Central: uma sequência de campos
// ID+tamanho+valor, fechada por um CRC16. O mesmo texto serve para o cliente
// colar no app do banco E para virar QR Code — são a mesma coisa em formatos
// diferentes.
//
// Feito à mão em vez de dependência: a especificação é fechada, são ~60 linhas,
// e uma lib a mais para isso não se paga.

/** Campo EMV: id + tamanho (2 dígitos) + valor. */
function campo(id: string, valor: string): string {
  const v = String(valor ?? '')
  return `${id}${String(v.length).padStart(2, '0')}${v}`
}

/**
 * CRC16/CCITT-FALSE — polinômio 0x1021, inicial 0xFFFF, sem reflexão.
 * O BR Code exige exatamente esta variante; usar outra gera um código que o
 * banco recusa na hora de colar.
 */
export function crc16(payload: string): string {
  let crc = 0xffff
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

/** Sem acento, sem símbolo, caixa alta: o padrão só aceita ASCII imprimível. */
function limpar(texto: string, max: number): string {
  return (texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 .,-]/g, '')
    .trim().toUpperCase().slice(0, max)
}

export type TipoChavePix = 'cpf' | 'cnpj' | 'email' | 'telefone' | 'aleatoria'

/**
 * Normaliza a chave conforme o tipo. CPF/CNPJ e telefone vão só com dígitos
 * (telefone com +55); e-mail e chave aleatória vão como estão, em minúsculas.
 */
export function normalizarChavePix(chave: string, tipo: TipoChavePix): string {
  const bruta = (chave || '').trim()
  if (tipo === 'cpf' || tipo === 'cnpj') return bruta.replace(/\D/g, '')
  if (tipo === 'telefone') {
    const d = bruta.replace(/\D/g, '')
    return d.startsWith('55') ? `+${d}` : `+55${d}`
  }
  return bruta.toLowerCase()
}

export interface DadosPix {
  chave: string
  tipo: TipoChavePix
  /** Nome do recebedor como aparece no app do pagador (máx. 25). */
  beneficiario: string
  /** Cidade do recebedor (máx. 15). */
  cidade: string
  /** Valor em reais. Sem valor, o pagador digita quanto quer pagar. */
  valor?: number | null
  /** Identificador da cobrança (máx. 25). Vazio vira "***". */
  txid?: string | null
  /** Texto curto que aparece para o pagador (máx. 50 no total do campo 26). */
  descricao?: string | null
}

/**
 * Monta o código copia e cola.
 *
 * Sem `valor`, o BR Code é estático e reutilizável — é o caso do "manda a chave
 * pra ele pagar". Com valor, o app do banco já abre com o total preenchido, que
 * reduz erro de digitação em cobrança fechada.
 */
export function gerarPixCopiaECola(d: DadosPix): string {
  const chave = normalizarChavePix(d.chave, d.tipo)
  if (!chave) throw new Error('Chave PIX vazia')

  const conta = campo('00', 'br.gov.bcb.pix') + campo('01', chave)
    + (d.descricao ? campo('02', limpar(d.descricao, 40)) : '')

  const txid = limpar(d.txid || '', 25) || '***'
  const valor = d.valor && d.valor > 0 ? d.valor.toFixed(2) : null

  const semCrc =
    campo('00', '01')
    // 11 = estático reutilizável; 12 = uso único (quando há valor definido).
    + campo('01', valor ? '12' : '11')
    + campo('26', conta)
    + campo('52', '0000')
    + campo('53', '986')
    + (valor ? campo('54', valor) : '')
    + campo('58', 'BR')
    + campo('59', limpar(d.beneficiario, 25) || 'RECEBEDOR')
    + campo('60', limpar(d.cidade, 15) || 'BRASIL')
    + campo('62', campo('05', txid))
    + '6304'

  return semCrc + crc16(semCrc)
}

/** Confere um BR Code recebido: o CRC dos últimos 4 dígitos tem de bater. */
export function validarBrCode(codigo: string): boolean {
  if (!codigo || codigo.length < 8) return false
  const corpo = codigo.slice(0, -4)
  return crc16(corpo) === codigo.slice(-4).toUpperCase()
}
