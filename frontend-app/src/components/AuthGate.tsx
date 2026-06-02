import type { ComponentChildren } from 'preact'
import { useEffect } from 'preact/hooks'
import { useAuth } from '@/hooks/useAuth'
import { LoginPage } from '@/routes/pages/LoginPage'
import { ForgotPasswordPage } from '@/routes/pages/ForgotPasswordPage'
import { ResetPasswordPage } from '@/routes/pages/ResetPasswordPage'

const PUBLIC_AUTH_PATHS = new Set([
  '/app/login',
  '/app/forgot-password',
  '/app/reset-password',
])

function renderPublicAuth(pathname: string): ComponentChildren {
  if (pathname === '/app/forgot-password') return <ForgotPasswordPage />
  if (pathname === '/app/reset-password') return <ResetPasswordPage />
  return <LoginPage />
}

interface AuthGateProps {
  children: ComponentChildren
  fallback?: ComponentChildren
}

/**
 * Bloqueia o app shell até que a sessão atual seja resolvida.
 * Quando não autenticado, exibe o LoginPage Preact preservando o path tentado
 * como `?next=` para redirecionar após login.
 *
 * IMPORTANTE: AuthGate está FORA do <WouterRouter base="/app">, então
 * usamos `window.location.pathname` direto (não o `useLocation` do wouter,
 * que aqui retornaria sem o base e geraria loop em `next=/app/login`).
 *
 * Em rotas públicas de auth (/app/login, /forgot-password, /reset-password),
 * renderizamos direto sem chamar `useAuth` — evita disparar `/admin/me`, que
 * em pós-logout retornaria 401 e acionaria `qc.clear()` no handler de
 * `bh:auth:expired`, apagando a cache do `usePublicAppearance` usado pelo
 * LoginPage e causando flicker.
 */
export function AuthGate({ children, fallback }: AuthGateProps) {
  const pathname = typeof window !== 'undefined' ? window.location.pathname : ''
  if (PUBLIC_AUTH_PATHS.has(pathname)) {
    return <>{renderPublicAuth(pathname)}</>
  }
  return <AuthGatedShell fallback={fallback}>{children}</AuthGatedShell>
}

function SessionSplash({ label = 'Verificando sessão…' }: { label?: string }) {
  return (
    <div class="grid min-h-dvh place-items-center bg-surface text-fg-muted">
      <div class="flex items-center gap-3 text-sm">
        <span class="size-4 animate-spin rounded-full border-2 border-border border-t-fg" />
        {label}
      </div>
    </div>
  )
}

function AuthGatedShell({ children, fallback }: AuthGateProps) {
  const { isAuthenticated, isLoading, error } = useAuth()
  const needsLogin = !isLoading && (!isAuthenticated || !!error)

  // Side-effect em useEffect (não em render) + full reload via assign:
  // evita race condition com o WouterRouter renderizando NotFoundPage
  // entre o replaceState e o desmonte do shell.
  useEffect(() => {
    if (!needsLogin) return
    if (typeof window === 'undefined') return
    const pathname = window.location.pathname
    if (pathname === '/app/login') return
    const relative = pathname.startsWith('/app') ? pathname.slice(4) || '/' : pathname
    const next = relative && relative !== '/' ? `?next=${encodeURIComponent(relative)}` : ''
    window.location.assign(`/app/login${next}`)
  }, [needsLogin])

  if (isLoading) {
    return <>{fallback ?? <SessionSplash />}</>
  }

  if (needsLogin) {
    return <SessionSplash label="Sessão expirada — redirecionando…" />
  }

  return <>{children}</>
}
