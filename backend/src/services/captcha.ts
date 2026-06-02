// src/services/captcha.ts
// Validação server-side de captchas: Google reCAPTCHA v3 e hCaptcha.

export interface CaptchaConfig {
  type: 'recaptcha' | 'hcaptcha' | null | undefined
  secret: string | null | undefined
}

export interface CaptchaResult {
  ok: boolean
  reason?: string
  score?: number
}

export async function verifyCaptcha(config: CaptchaConfig, token: string, remoteIp?: string): Promise<CaptchaResult> {
  if (!config?.type || !config?.secret) return { ok: true }  // captcha desabilitado = permite
  if (!token || typeof token !== 'string') return { ok: false, reason: 'token ausente' }

  try {
    if (config.type === 'recaptcha') {
      const params = new URLSearchParams()
      params.append('secret', config.secret)
      params.append('response', token)
      if (remoteIp) params.append('remoteip', remoteIp)
      const r = await fetch('https://www.google.com/recaptcha/api/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
        signal: AbortSignal.timeout(5000),
      })
      const d: any = await r.json()
      if (!d?.success) return { ok: false, reason: d?.['error-codes']?.join(',') || 'recaptcha rejeitado' }
      // v3 tem score; v2 não. Se score ausente (v2), aceitar.
      if (typeof d.score === 'number' && d.score < 0.5) return { ok: false, reason: 'score baixo', score: d.score }
      return { ok: true, score: d.score }
    }
    if (config.type === 'hcaptcha') {
      const params = new URLSearchParams()
      params.append('secret', config.secret)
      params.append('response', token)
      if (remoteIp) params.append('remoteip', remoteIp)
      const r = await fetch('https://hcaptcha.com/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
        signal: AbortSignal.timeout(5000),
      })
      const d: any = await r.json()
      if (!d?.success) return { ok: false, reason: d?.['error-codes']?.join(',') || 'hcaptcha rejeitado' }
      return { ok: true }
    }
    return { ok: true }
  } catch (e: any) {
    // Em caso de falha no servidor do captcha, não bloqueia (fail-open controlado)
    return { ok: true, reason: `captcha_api_error:${e.message}` }
  }
}
