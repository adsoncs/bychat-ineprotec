// src/lib/turnCredentials.ts
//
// Gera credenciais TURN efêmeras (mecanismo "TURN REST API" do coturn, com
// `use-auth-secret`). O navegador do operador usa essas credenciais no
// RTCPeerConnection para atravessar NAT nas chamadas WhatsApp (WebRTC).
//
// username = "<expiry_unix_ts>:bychat"
// credential = base64( HMAC-SHA1( TURN_SECRET, username ) )
//
// Config via .env:
//   TURN_SECRET       — mesmo static-auth-secret do /etc/turnserver.conf
//   TURN_URLS         — lista separada por vírgula (turn:host:3478?transport=udp,...)
//   TURN_TTL_SECONDS  — validade da credencial (default 3600)

import { createHmac } from 'node:crypto'

export interface RtcIceServer {
  urls: string | string[]
  username?: string
  credential?: string
}

export interface TurnCredentials {
  iceServers: RtcIceServer[]
  username: string
  credential: string
  ttl: number
  expiresAt: number
}

/**
 * Retorna ICE servers (STUN + TURN com credencial efêmera) prontos para o
 * RTCPeerConnection do frontend. Retorna null se o TURN não estiver configurado.
 */
export function getTurnCredentials(ttlSeconds?: number): TurnCredentials | null {
  const secret = process.env.TURN_SECRET
  const urlsRaw = process.env.TURN_URLS

  if (!secret || !urlsRaw) return null

  const ttl = ttlSeconds ?? Number(process.env.TURN_TTL_SECONDS || 3600)
  const expiresAt = Math.floor(Date.now() / 1000) + ttl
  const username = `${expiresAt}:bychat`
  const credential = createHmac('sha1', secret).update(username).digest('base64')

  const turnUrls = urlsRaw
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean)

  // STUN derivado da 1ª URL TURN (mesmo host:porta) — usado para descoberta de candidatos.
  const stunUrls = turnUrls
    .map((u) => {
      const m = u.match(/^turns?:([^?]+)/)
      return m ? `stun:${m[1]}` : null
    })
    .filter((v, i, arr): v is string => !!v && arr.indexOf(v) === i)

  const iceServers: RtcIceServer[] = []
  if (stunUrls.length) iceServers.push({ urls: stunUrls })
  iceServers.push({ urls: turnUrls, username, credential })

  return { iceServers, username, credential, ttl, expiresAt }
}

/** True se o TURN está configurado (coturn pronto para WebRTC). */
export function isTurnReady(): boolean {
  return !!(process.env.TURN_SECRET && process.env.TURN_URLS)
}
