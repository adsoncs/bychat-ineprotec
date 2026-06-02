import { useState } from 'preact/hooks'
import { LogIn, AlertCircle } from 'lucide-preact'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { api, setToken, ApiError } from '@/lib/apiClient'
import { useUserStore, type CurrentUser } from '@/stores/user'
import { BrandLogo } from '@/components/BrandLogo'
import { usePublicAppearance } from '@/hooks/useSettings'
import { cn } from '@/lib/cn'

interface LoginResponse {
  token: string
  user: CurrentUser
}

/**
 * Resolve o destino pós-login. Aceita só paths relativos ao app, descarta
 * `/login` (que geraria loop) e qualquer URL absoluta (XSS via open redirect).
 */
function resolveNext(): string {
  try {
    const raw = new URL(window.location.href).searchParams.get('next') ?? ''
    if (!raw) return '/dashboard'
    if (!raw.startsWith('/')) return '/dashboard'
    if (raw.startsWith('//')) return '/dashboard' // protocol-relative → bloqueado
    if (raw === '/login' || raw.startsWith('/login?') || raw.startsWith('/login/')) return '/dashboard'
    return raw
  } catch {
    return '/dashboard'
  }
}

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const setUser = useUserStore((s) => s.setUser)
  const { data: appearance } = usePublicAppearance()

  const cfg = appearance?.appearance ?? {}
  const imageUrl = cfg['appearance.login_image_url'] ?? ''
  const imagePosition = (cfg['appearance.login_image_position'] ?? 'left') as 'left' | 'right'
  const imageFocus = cfg['appearance.login_image_focus'] ?? 'center'
  const overlayDimRaw = parseInt(cfg['appearance.login_overlay_dim'] ?? '40', 10)
  const overlayDim = Math.min(80, Math.max(0, Number.isFinite(overlayDimRaw) ? overlayDimRaw : 40))
  const title = cfg['appearance.login_title'] ?? 'Bem-vindo de volta'
  const subtitle = cfg['appearance.login_subtitle'] ?? 'Acesse sua conta para continuar'
  const overlayTitle = cfg['appearance.login_overlay_title'] ?? ''
  const overlaySubtitle = cfg['appearance.login_overlay_subtitle'] ?? ''
  const footerText = cfg['appearance.login_footer_text'] ?? ''
  const formBg = cfg['appearance.login_form_bg'] ?? ''
  const buttonBg = cfg['appearance.login_button_bg'] ?? ''
  const buttonText = cfg['appearance.login_button_text'] ?? ''
  const titleColor = cfg['appearance.login_title_color'] ?? ''
  const subtitleColor = cfg['appearance.login_subtitle_color'] ?? ''
  const overlayTextColor = cfg['appearance.login_overlay_text_color'] ?? ''
  const heroFrom = cfg['appearance.login_hero_from'] ?? ''
  const heroTo = cfg['appearance.login_hero_to'] ?? ''

  async function handleSubmit(e: Event) {
    e.preventDefault()
    if (!email.trim() || !password) {
      setError('Preencha email e senha.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const resp = await api.post<LoginResponse>(
        '/admin/login',
        { email: email.trim(), password },
        { anonymous: true },
      )
      setToken(resp.token)
      setUser(resp.user)
      const target = resolveNext()
      window.location.assign(`/app${target}`)
    } catch (err: unknown) {
      // Mensagens específicas para os casos mais comuns (rate limit do
      // Nginx/Fastify retorna 429 ou 503 sem corpo JSON estruturado).
      if (err instanceof ApiError) {
        if (err.status === 429 || err.status === 503) {
          setError(
            'Muitas tentativas de login deste navegador. Aguarde cerca de 1 minuto antes de tentar novamente.',
          )
        } else if (err.status === 401) {
          setError('Email ou senha incorretos.')
        } else if (err.status === 403) {
          setError(err.message || 'Conta bloqueada. Contate o administrador.')
        } else {
          setError(err.message || `Falha ao fazer login (HTTP ${err.status}).`)
        }
      } else {
        const e = err as { message?: string }
        setError(e.message ?? 'Falha ao fazer login. Verifique sua conexão.')
      }
    } finally {
      setLoading(false)
    }
  }

  const hero = (
    <aside
      class={cn(
        'relative h-[30dvh] min-h-[180px] shrink-0 overflow-hidden bg-accent/10 lg:h-auto lg:min-h-dvh',
        imagePosition === 'right' ? 'lg:order-2' : 'lg:order-1',
      )}
      aria-hidden="true"
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          class="absolute inset-0 h-full w-full object-cover"
          style={{ objectPosition: imageFocus }}
          loading="eager"
        />
      ) : (
        <div
          class="absolute inset-0"
          style={{
            background:
              heroFrom || heroTo
                ? `linear-gradient(135deg, ${heroFrom || 'var(--color-accent, #1a73e8)'} 0%, ${heroTo || 'var(--color-accent-hover, #1557b0)'} 100%)`
                : 'linear-gradient(135deg, var(--color-accent, #1a73e8) 0%, var(--color-accent-hover, #1557b0) 100%)',
          }}
        />
      )}
      {(overlayTitle || overlaySubtitle) && (
        <div
          class="absolute inset-0"
          style={{ background: `rgba(0,0,0,${overlayDim / 100})` }}
        />
      )}
      {(overlayTitle || overlaySubtitle) && (
        <div
          class="absolute inset-0 flex flex-col items-center justify-center px-4 text-center text-white sm:px-6 lg:px-10"
          style={overlayTextColor ? { color: overlayTextColor } : {}}
        >
          {overlayTitle && (
            <h2 class="max-w-md text-lg font-semibold leading-tight drop-shadow-md sm:text-xl lg:max-w-none lg:whitespace-nowrap lg:text-3xl">
              {overlayTitle}
            </h2>
          )}
          {overlaySubtitle && (
            <p
              class="mt-1 max-w-md text-xs drop-shadow-md sm:text-sm lg:mt-3 lg:max-w-none lg:whitespace-nowrap lg:text-base"
              style={!overlayTextColor ? { color: 'rgba(255,255,255,0.9)' } : {}}
            >
              {overlaySubtitle}
            </p>
          )}
        </div>
      )}
    </aside>
  )

  const formPanel = (
    <main
      class={cn(
        'flex min-h-0 flex-1 items-center justify-center overflow-y-auto bg-surface px-4 py-6 sm:px-8 lg:min-h-dvh lg:flex-none lg:overflow-visible lg:py-10',
        imagePosition === 'right' ? 'lg:order-1' : 'lg:order-2',
      )}
      style={formBg ? { background: formBg } : {}}
    >
      <form
        class="w-full max-w-sm space-y-4 lg:space-y-6"
        onSubmit={handleSubmit}
        aria-labelledby="login-title"
      >
        <div class="space-y-2 text-center">
          <h1 id="login-title" class="flex justify-center">
            <BrandLogo variant="admin" />
          </h1>
          <h2
            class="text-2xl font-semibold text-fg"
            style={titleColor ? { color: titleColor } : {}}
          >
            {title}
          </h2>
          {subtitle && (
            <p
              class="text-sm text-fg-muted"
              style={subtitleColor ? { color: subtitleColor } : {}}
            >
              {subtitle}
            </p>
          )}
        </div>

        <div class="space-y-3">
          <Input
            label="Email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
            disabled={loading}
          />

          <Input
            label="Senha"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
            disabled={loading}
          />
        </div>

        {error && (
          <div
            class="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/10 p-3 text-xs text-danger"
            role="alert"
          >
            <AlertCircle size={14} class="mt-0.5 shrink-0" /> {error}
          </div>
        )}

        <Button
          variant="primary"
          size="md"
          class="w-full"
          type="submit"
          disabled={loading}
          style={
            buttonBg || buttonText
              ? {
                  ...(buttonBg ? { background: buttonBg, borderColor: buttonBg } : {}),
                  ...(buttonText ? { color: buttonText } : {}),
                }
              : {}
          }
        >
          <LogIn size={16} /> {loading ? 'Entrando…' : 'Entrar'}
        </Button>

        <div class="text-center">
          <a
            href="/app/forgot-password"
            class="text-xs text-fg-muted underline-offset-2 hover:text-fg hover:underline"
          >
            Esqueceu sua senha?
          </a>
        </div>

        {footerText && (
          <p class="pt-4 text-center text-xs text-fg-muted">{footerText}</p>
        )}
      </form>
    </main>
  )

  return (
    <div class="flex h-dvh flex-col overflow-hidden lg:grid lg:h-auto lg:min-h-dvh lg:grid-cols-2 lg:overflow-visible">
      {hero}
      {formPanel}
    </div>
  )
}
