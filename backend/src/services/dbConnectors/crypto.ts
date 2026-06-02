// AES-256-GCM pra senhas de DBs externos. Chave derivada do JWT_SECRET
// via scrypt — não exige variável de ambiente adicional.

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'

const ALG = 'aes-256-gcm'
const KEY_SALT = 'bychat:db-connectors:v1'

function getKey(): Buffer {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET não configurado — necessário pra crypto de conectores.')
  return scryptSync(secret, KEY_SALT, 32)
}

export function encryptPassword(plain: string): string {
  if (!plain) return ''
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALG, getKey(), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`
}

export function decryptPassword(payload: string): string {
  if (!payload) return ''
  const [version, ivB64, tagB64, encB64] = payload.split(':')
  if (version !== 'v1' || !ivB64 || !tagB64 || !encB64) {
    throw new Error('Formato de senha encrypted inválido')
  }
  const decipher = createDecipheriv(ALG, getKey(), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  const dec = Buffer.concat([decipher.update(Buffer.from(encB64, 'base64')), decipher.final()])
  return dec.toString('utf8')
}
