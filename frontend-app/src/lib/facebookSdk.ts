/**
 * Loader do Facebook JavaScript SDK.
 * Carrega o script uma única vez e expõe FB.login com tipagem mínima.
 */

interface FBAuthResponse {
  accessToken?: string
  code?: string
  userID?: string
  expiresIn?: number
}

interface FBLoginResponse {
  status: 'connected' | 'not_authorized' | 'unknown'
  authResponse: FBAuthResponse | null
}

interface FBLoginOptions {
  scope?: string
  auth_type?: 'rerequest' | 'reauthenticate'
  config_id?: string
  response_type?: 'token' | 'code'
  override_default_response_type?: boolean
  extras?: Record<string, unknown>
}

interface FBSdk {
  init: (opts: { appId: string; cookie?: boolean; xfbml?: boolean; version: string }) => void
  login: (cb: (resp: FBLoginResponse) => void, opts?: FBLoginOptions) => void
}

declare global {
  interface Window {
    FB?: FBSdk
    fbAsyncInit?: () => void
  }
}

const SCRIPT_ID = 'facebook-jssdk'
let initialized = false
let loadPromise: Promise<FBSdk> | null = null

export interface LoadFbSdkOptions {
  appId: string
  /** locale do SDK (default pt_BR). */
  locale?: string
  /** versão da Graph API (default v21.0). */
  version?: string
}

/** Carrega o SDK e chama FB.init. Idempotente. */
export function loadFacebookSdk(opts: LoadFbSdkOptions): Promise<FBSdk> {
  if (loadPromise) return loadPromise

  loadPromise = new Promise<FBSdk>((resolve, reject) => {
    const locale = opts.locale ?? 'pt_BR'
    const version = opts.version ?? 'v21.0'

    function doInit() {
      if (!window.FB) return reject(new Error('FB SDK não disponível após carregamento'))
      if (!initialized) {
        window.FB.init({ appId: opts.appId, cookie: true, xfbml: false, version })
        initialized = true
      }
      resolve(window.FB)
    }

    if (window.FB) {
      doInit()
      return
    }

    window.fbAsyncInit = doInit

    if (document.getElementById(SCRIPT_ID)) return // já em carregamento

    const js = document.createElement('script')
    js.id = SCRIPT_ID
    js.async = true
    js.defer = true
    js.crossOrigin = 'anonymous'
    js.src = `https://connect.facebook.net/${locale}/sdk.js`
    js.onerror = () => {
      loadPromise = null
      reject(new Error('Falha ao carregar o SDK do Facebook'))
    }
    document.head.appendChild(js)
  })

  return loadPromise
}

/**
 * Inicia o fluxo de login.
 * - Quando `configId` for passado, usa Facebook Login for Business (BISU, response_type=code).
 * - Caso contrário, login clássico com scope manual (retorna access token de curta duração).
 *   `scope` permite sobrescrever os escopos padrão (ex.: integrações Instagram).
 *
 * Resolve com `{ code }` ou `{ token }`. Rejeita se o usuário cancelar.
 */
export async function fbLogin(
  appId: string,
  configId: string | null,
  opts?: { scope?: string },
): Promise<{ code: string } | { token: string }> {
  const FB = await loadFacebookSdk({ appId })

  return new Promise((resolve, reject) => {
    const handler = (resp: FBLoginResponse) => {
      const auth = resp.authResponse
      if (!auth) return reject(new Error('Login cancelado'))
      if (auth.code) return resolve({ code: auth.code })
      if (auth.accessToken) return resolve({ token: auth.accessToken })
      reject(new Error('Resposta inválida do Facebook'))
    }

    if (configId) {
      FB.login(handler, {
        config_id: configId,
        response_type: 'code',
        override_default_response_type: true,
      })
    } else {
      FB.login(handler, {
        scope:
          opts?.scope ??
          'pages_show_list,pages_read_engagement,leads_retrieval,pages_manage_metadata,pages_manage_ads,ads_read',
      })
    }
  })
}

/**
 * Facebook Login for Business via OAuth clássico por REDIRECT (não JS SDK).
 * Abre /dialog/oauth num popup com um redirect_uri que NÓS controlamos
 * (`${origin}/api/meta/oauth/callback`); o backend devolve o code via
 * postMessage. Determinístico — a troca de code usa exatamente este mesmo
 * redirect_uri (o popup do FB.login usava um redirect_uri interno
 * irreproduzível → OAuthException 100/36008).
 *
 * Resolve com `{ code, redirectUri }`. Rejeita se cancelar/erro.
 */
export function metaBusinessRedirectLogin(
  appId: string,
  configId: string,
  graphVersion = 'v21.0',
): Promise<{ code: string; redirectUri: string }> {
  return new Promise((resolve, reject) => {
    const redirectUri = `${window.location.origin}/api/meta/oauth/callback`
    const state = Math.random().toString(36).slice(2) + Date.now().toString(36)
    // auth_type=rerequest força o consent screen toda vez. Sem isso, se o admin
    // já autorizou outras pages em outro tenant do mesmo Meta App, o Facebook
    // pula a seleção de pages e devolve page tokens sem pages_*, derrubando
    // sync-forms com OAuthException 190.
    const url =
      `https://www.facebook.com/${graphVersion}/dialog/oauth` +
      `?client_id=${encodeURIComponent(appId)}` +
      `&config_id=${encodeURIComponent(configId)}` +
      `&response_type=code&override_default_response_type=true` +
      `&auth_type=rerequest` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${encodeURIComponent(state)}`

    const w = 600
    const h = 720
    const left = window.screenX + (window.outerWidth - w) / 2
    const top = window.screenY + (window.outerHeight - h) / 2
    const popup = window.open(
      url,
      'metaOauth',
      `width=${w},height=${h},left=${left},top=${top},menubar=no,toolbar=no`,
    )
    if (!popup) {
      reject(new Error('Popup bloqueado pelo navegador. Permita popups e tente de novo.'))
      return
    }

    let done = false
    const cleanup = () => {
      window.removeEventListener('message', onMsg)
      clearInterval(poll)
    }
    const onMsg = (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin) return
      const d = ev.data
      if (!d || d.type !== 'meta-oauth') return
      if (d.state && d.state !== state) return
      done = true
      cleanup()
      try {
        popup.close()
      } catch {
        /* ignora */
      }
      if (d.error) return reject(new Error(String(d.error)))
      if (!d.code) return reject(new Error('Facebook não retornou o code'))
      resolve({ code: d.code, redirectUri })
    }
    window.addEventListener('message', onMsg)
    const poll = setInterval(() => {
      if (done) return
      if (popup.closed) {
        cleanup()
        reject(new Error('Login cancelado'))
      }
    }, 600)
  })
}

export interface EmbeddedSignupResult {
  /** code (BISU) ou accessToken (fallback). Pelo menos um sempre vem. */
  code?: string
  token?: string
  wabaId: string
  phoneNumberId: string
}

/**
 * Inicia o WhatsApp Embedded Signup. Carrega o SDK, escuta `WA_EMBEDDED_SIGNUP`
 * postMessages do facebook.com, dispara FB.login com extras e resolve com
 * `{ code|token, wabaId, phoneNumberId }`. Rejeita se cancelar ou se Meta não
 * retornar ambos os ids.
 */
export async function fbEmbeddedSignup(
  appId: string,
  configId: string,
): Promise<EmbeddedSignupResult> {
  const FB = await loadFacebookSdk({ appId })

  let wabaId: string | null = null
  let phoneNumberId: string | null = null

  interface WaSignupPayload {
    type?: string
    event?: string
    data?: { waba_id?: string; phone_number_id?: string }
  }

  const msgHandler = (event: MessageEvent) => {
    if (typeof event.origin !== 'string') return
    try {
      const host = new URL(event.origin).hostname
      if (!/(^|\.)facebook\.com$/.test(host)) return
      const raw: unknown = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
      const payload = raw as WaSignupPayload | null
      if (payload?.type !== 'WA_EMBEDDED_SIGNUP') return
      if (payload.event === 'FINISH' || payload.event === 'FINISH_ONLY_WABA') {
        wabaId = payload.data?.waba_id ?? wabaId
        phoneNumberId = payload.data?.phone_number_id ?? phoneNumberId
      }
    } catch {
      // ignora payloads que não são JSON
    }
  }

  window.addEventListener('message', msgHandler)

  try {
    return await new Promise<EmbeddedSignupResult>((resolve, reject) => {
      FB.login(
        (resp) => {
          const auth = resp.authResponse
          if (!auth) return reject(new Error('Conexão cancelada'))
          if (!wabaId || !phoneNumberId) {
            return reject(
              new Error(
                'O Meta não retornou os dados da conta. Conclua todos os passos do assistente do WhatsApp Business e tente novamente.',
              ),
            )
          }
          const result: EmbeddedSignupResult = { wabaId, phoneNumberId }
          if (auth.code) result.code = auth.code
          if (auth.accessToken) result.token = auth.accessToken
          if (!result.code && !result.token) {
            return reject(new Error('Resposta do Facebook sem code nem token'))
          }
          resolve(result)
        },
        {
          config_id: configId,
          response_type: 'code',
          override_default_response_type: true,
          extras: {
            feature: 'whatsapp_embedded_signup',
            featureType: 'whatsapp_business_app_onboarding',
            sessionInfoVersion: '3',
            setup: {},
          },
        },
      )
    })
  } finally {
    window.removeEventListener('message', msgHandler)
  }
}
