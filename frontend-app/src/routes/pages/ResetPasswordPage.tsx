import { useMemo, useState } from 'preact/hooks'
import { KeyRound, AlertCircle, CheckCircle2, ArrowLeft } from '@/components/ui/icon-set'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { api, ApiError } from '@/lib/apiClient'
import { BrandLogo } from '@/components/BrandLogo'
import { usePublicAppearance } from '@/hooks/useSettings'
import { cn } from '@/lib/cn'

const MIN_LENGTH = 10

function validatePassword(pw: string): string | null {
  if (!pw || pw.length < MIN_LENGTH) return `A senha deve ter no mínimo ${MIN_LENGTH} caracteres.`
  if (!/[A-Z]/.test(pw)) return 'Inclua pelo menos uma letra maiúscula.'
  if (!/[a-z]/.test(pw)) return 'Inclua pelo menos uma letra minúscula.'
  if (!/[0-9]/.test(pw)) return 'Inclua pelo menos um número.'
  return null
}

export function ResetPasswordPage() {
  const token = useMemo(() => {
    try {
      return new URL(window.location.href).searchParams.get('token') ?? ''
    } catch {
      return ''
    }
  }, [])

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const { data: appearance } = usePublicAppearance()

  const cfg = appearance?.appearance ?? {}
  const imageUrl = cfg['appearance.login_image_url'] ?? ''
  const imagePosition = (cfg['appearance.login_image_position'] ?? 'left') as 'left' | 'right'
  const imageFocus = cfg['appearance.login_image_focus'] ?? 'center'
  const formBg = cfg['appearance.login_form_bg'] ?? ''
  const buttonBg = cfg['appearance.login_button_bg'] ?? ''
  const buttonText = cfg['appearance.login_button_text'] ?? ''
  const titleColor = cfg['appearance.login_title_color'] ?? ''
  const subtitleColor = cfg['appearance.login_subtitle_color'] ?? ''
  const heroFrom = cfg['appearance.login_hero_from'] ?? ''
  const heroTo = cfg['appearance.login_hero_to'] ?? ''
  const buttonStyle =
    buttonBg || buttonText
      ? {
          ...(buttonBg ? { background: buttonBg, borderColor: buttonBg } : {}),
          ...(buttonText ? { color: buttonText } : {}),
        }
      : {}

  async function handleSubmit(e: Event) {
    e.preventDefault()
    if (!token) {
      setError('Link inválido. Solicite um novo email de recuperação.')
      return
    }
    const pwErr = validatePassword(password)
    if (pwErr) {
      setError(pwErr)
      return
    }
    if (password !== confirm) {
      setError('As senhas não coincidem.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      await api.post('/admin/reset-password', { token, password }, { anonymous: true })
      setDone(true)
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.status === 400) {
          setError(err.message || 'Link inválido ou expirado. Solicite um novo.')
        } else {
          setError(err.message || `Falha ao redefinir (HTTP ${err.status}).`)
        }
      } else {
        const e = err as { message?: string }
        setError(e.message ?? 'Falha ao redefinir. Verifique sua conexão.')
      }
    } finally {
      setLoading(false)
    }
  }

  function goLogin(e: Event) {
    e.preventDefault()
    window.location.assign('/app/login')
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
      <form class="w-full max-w-sm space-y-4 lg:space-y-6" onSubmit={handleSubmit} aria-labelledby="reset-title">
        <div class="space-y-2 text-center">
          <h1 id="reset-title" class="flex justify-center">
            <BrandLogo variant="admin" />
          </h1>
          <h2
            class="text-2xl font-semibold text-fg"
            style={titleColor ? { color: titleColor } : {}}
          >
            Definir nova senha
          </h2>
          <p
            class="text-sm text-fg-muted"
            style={subtitleColor ? { color: subtitleColor } : {}}
          >
            Crie uma senha forte. Mínimo de {MIN_LENGTH} caracteres, com maiúscula, minúscula e número.
          </p>
        </div>

        {!token && !done && (
          <div
            class="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/10 p-3 text-xs text-danger"
            role="alert"
          >
            <AlertCircle size={14} class="mt-0.5 shrink-0" />
            <span>
              Link inválido. Solicite um novo email de recuperação.
            </span>
          </div>
        )}

        {done ? (
          <>
            <div
              class="flex items-start gap-2 rounded-md border border-success/40 bg-success/10 p-3 text-xs text-success"
              role="status"
            >
              <CheckCircle2 size={14} class="mt-0.5 shrink-0" />
              <span>Senha atualizada. Use sua nova senha para entrar.</span>
            </div>
            <Button
              variant="primary"
              size="md"
              class="w-full"
              type="button"
              onClick={goLogin}
              style={buttonStyle}
            >
              Ir para o login
            </Button>
          </>
        ) : (
          <>
            <div class="space-y-3">
              <Input
                label="Nova senha"
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
                disabled={loading || !token}
              />

              <Input
                label="Confirmar nova senha"
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onInput={(e) => setConfirm((e.target as HTMLInputElement).value)}
                disabled={loading || !token}
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
              disabled={loading || !token}
              style={buttonStyle}
            >
              <KeyRound size={16} /> {loading ? 'Salvando…' : 'Redefinir senha'}
            </Button>
          </>
        )}

        <button
          type="button"
          onClick={goLogin}
          class="flex w-full items-center justify-center gap-1 text-xs text-fg-muted hover:text-fg"
        >
          <ArrowLeft size={12} /> Voltar para o login
        </button>
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
