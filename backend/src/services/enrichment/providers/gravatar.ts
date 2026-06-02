// Gravatar: foto e perfil público a partir do hash MD5 do e-mail.
// 100% gratuito, sem chave, ilimitado.

import { createHash } from 'crypto'
import type { Provider, ProviderResult } from '../types.js'

export const gravatarProvider: Provider = async (seed) => {
  const result: ProviderResult = { facts: [] }
  const email = (seed.email || '').trim().toLowerCase()
  if (!email || !email.includes('@')) return result

  const hash = createHash('md5').update(email).digest('hex')

  // Profile JSON (quando existe)
  try {
    const resp = await fetch(`https://www.gravatar.com/${hash}.json`, {
      headers: { 'User-Agent': 'ByChatBeyond/1.0 (+https://bychat.ia.br)' }
    })
    if (resp.ok) {
      const data = await resp.json() as any
      const entry = data?.entry?.[0]
      if (entry) {
        if (entry.thumbnailUrl) {
          result.facts.push({
            source: 'gravatar',
            field: 'photo_url',
            value: `${entry.thumbnailUrl}?s=400`,
            confidence: 0.95,
            rawData: entry,
          })
        }
        if (entry.displayName) {
          result.facts.push({ source: 'gravatar', field: 'name', value: entry.displayName, confidence: 0.7 })
        }
        if (Array.isArray(entry.accounts)) {
          for (const acc of entry.accounts) {
            if (acc.url && acc.shortname) {
              result.facts.push({
                source: 'gravatar',
                field: `social_${acc.shortname}`,
                value: acc.url,
                confidence: 0.9,
              })
            }
          }
        }
        if (Array.isArray(entry.urls)) {
          for (const u of entry.urls) {
            if (u.value) result.facts.push({ source: 'gravatar', field: 'website', value: u.value, confidence: 0.7 })
          }
        }
        return result
      }
    }
  } catch (err: any) {
    result.errors = [`gravatar profile: ${err.message}`]
  }

  // Fallback: só a foto (sempre retorna algo, mas verifica se existe real)
  const photoUrl = `https://www.gravatar.com/avatar/${hash}?s=400&d=404`
  try {
    const head = await fetch(photoUrl, { method: 'HEAD' })
    if (head.ok) {
      result.facts.push({ source: 'gravatar', field: 'photo_url', value: photoUrl, confidence: 0.6 })
    }
  } catch { /* ignore */ }

  return result
}
