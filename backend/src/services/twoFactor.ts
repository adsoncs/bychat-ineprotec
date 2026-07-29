// src/services/twoFactor.ts
//
// Segundo fator por TOTP (RFC 6238) — G16 / RN-1401.
//
// A implementação é própria, com `node:crypto`, em vez de mais uma dependência:
// TOTP é HMAC-SHA1 sobre o contador de 30 segundos, cabe em poucas linhas, e
// uma biblioteca a menos é uma superfície de supply-chain a menos num sistema
// que guarda histórico escolar.
//
// Quem exige 2FA aqui é o perfil: um operador que altera nota, defere regime
// especial ou emite diploma faz coisas que não se desfazem. Senha sozinha,
// nesse contexto, é uma credencial que circula em post-it.

import { createHmac, randomBytes, timingSafeEqual, createHash } from 'node:crypto'
import { prisma } from '../lib/prisma.js'

const PASSO_SEGUNDOS = 30
const DIGITOS = 6
/** Aceita o código do passo anterior e do seguinte: relógio de celular atrasa. */
const JANELA = 1

// ─────────── Base32 (alfabeto RFC 4648, sem padding) ───────────

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function paraBase32(buf: Buffer): string {
  let bits = 0, valor = 0, saida = ''
  for (const byte of buf) {
    valor = (valor << 8) | byte
    bits += 8
    while (bits >= 5) {
      saida += ALFABETO[(valor >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) saida += ALFABETO[(valor << (5 - bits)) & 31]
  return saida
}

export function deBase32(s: string): Buffer {
  const limpo = s.toUpperCase().replace(/[^A-Z2-7]/g, '')
  let bits = 0, valor = 0
  const bytes: number[] = []
  for (const c of limpo) {
    const i = ALFABETO.indexOf(c)
    if (i < 0) continue
    valor = (valor << 5) | i
    bits += 5
    if (bits >= 8) {
      bytes.push((valor >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

// ─────────── TOTP ───────────

function gerarCodigo(segredo: Buffer, contador: number): string {
  const buf = Buffer.alloc(8)
  // O contador é de 64 bits; o JS só garante inteiro seguro em 53, então a
  // parte alta é escrita separadamente.
  buf.writeUInt32BE(Math.floor(contador / 2 ** 32), 0)
  buf.writeUInt32BE(contador >>> 0, 4)
  const hmac = createHmac('sha1', segredo).update(buf).digest()
  const offset = hmac[hmac.length - 1]! & 0x0f
  const binario = ((hmac[offset]! & 0x7f) << 24)
    | ((hmac[offset + 1]! & 0xff) << 16)
    | ((hmac[offset + 2]! & 0xff) << 8)
    | (hmac[offset + 3]! & 0xff)
  return String(binario % 10 ** DIGITOS).padStart(DIGITOS, '0')
}

/** Confere o código contra a janela de tolerância, em tempo constante. */
export function verificarTotp(segredoBase32: string, codigo: string, agora = Date.now()): boolean {
  const limpo = String(codigo || '').replace(/\D/g, '')
  if (limpo.length !== DIGITOS) return false
  const segredo = deBase32(segredoBase32)
  if (segredo.length === 0) return false
  const contador = Math.floor(agora / 1000 / PASSO_SEGUNDOS)
  for (let d = -JANELA; d <= JANELA; d++) {
    const esperado = gerarCodigo(segredo, contador + d)
    // timingSafeEqual exige mesmo tamanho — ambos têm DIGITOS caracteres.
    if (timingSafeEqual(Buffer.from(esperado), Buffer.from(limpo))) return true
  }
  return false
}

export function novoSegredo(): string {
  return paraBase32(randomBytes(20))
}

/** URI do padrão otpauth — é o que vira QR no aplicativo autenticador. */
export function uriOtpAuth(params: { segredo: string; conta: string; emissor: string }): string {
  const label = encodeURIComponent(`${params.emissor}:${params.conta}`)
  const q = new URLSearchParams({
    secret: params.segredo,
    issuer: params.emissor,
    algorithm: 'SHA1',
    digits: String(DIGITOS),
    period: String(PASSO_SEGUNDOS),
  })
  return `otpauth://totp/${label}?${q}`
}

// ─────────── Códigos de recuperação ───────────
//
// Sem eles, perder o celular vira chamado de suporte com verificação de
// identidade improvisada — que é justamente a brecha que o 2FA deveria fechar.

const hashCodigo = (c: string) => createHash('sha256').update(c.replace(/\W/g, '').toUpperCase()).digest('hex')

export function gerarCodigosRecuperacao(qtd = 8): { visiveis: string[]; hashes: string[] } {
  const visiveis: string[] = []
  for (let i = 0; i < qtd; i++) {
    const bruto = randomBytes(5).toString('hex').toUpperCase() // 10 caracteres
    visiveis.push(`${bruto.slice(0, 5)}-${bruto.slice(5)}`)
  }
  return { visiveis, hashes: visiveis.map(hashCodigo) }
}

/**
 * Consome um código de recuperação. Uso único: o código válido é removido da
 * lista antes de a função retornar — repetir o mesmo código não entra de novo.
 */
export async function consumirCodigoRecuperacao(userId: number, codigo: string): Promise<boolean> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { twoFactorBackupCodes: true } })
  if (!u?.twoFactorBackupCodes) return false
  let lista: string[]
  try { lista = JSON.parse(u.twoFactorBackupCodes) } catch { return false }
  if (!Array.isArray(lista)) return false
  const alvo = hashCodigo(codigo)
  const i = lista.indexOf(alvo)
  if (i < 0) return false
  lista.splice(i, 1)
  await prisma.user.update({ where: { id: userId }, data: { twoFactorBackupCodes: JSON.stringify(lista) } })
  return true
}
