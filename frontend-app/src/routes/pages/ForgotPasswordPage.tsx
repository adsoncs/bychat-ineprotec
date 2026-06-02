import { useState } from 'preact/hooks'
import { Mail, AlertCircle, CheckCircle2, ArrowLeft } from 'lucide-preact'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { api, ApiError } from '@/lib/apiClient'
import { BrandLogo } from '@/components/BrandLogo'
import { usePublicAppearance } from '@/hooks/useSettings'
import { cn } from '@/lib/cn'

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
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

  async function handleSubmit(e: Event) {
    e.preventDefault()
    if (!email.trim()) {
      setError('Informe o email da sua conta.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      await api.post('/admin/forgot-password', { email: email.trim() }, { anonymous: true })
      setSent(true)
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.status === 429) {
          setError('Muitas tentativas. Aguarde cerca de 15 minutos antes de tentar novamente.')
        } else {
          setError(err.message || 'Não foi possível enviar o email. Tente novamente.')
        }
      } else {
        const e = err as { message?: string }
        setError(e.message ?? 'Falha ao enviar. Verifique sua conexão.')
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
      <form class="w-full max-w-sm space-y-4 lg:space-y-6" onSubmit={handleSubmit} aria-labelledby="forgot-title">
        <div class="space-y-2 text-center">
          <h1 id="forgot-title" class="flex justify-center">
            <BrandLogo variant="admin" />
          </h1>
          <h2
            class="text-2xl font-semibold text-fg"
            style={titleColor ? { color: titleColor } : {}}
          >
            Recuperar acesso
          </h2>
          <p
            class="text-sm text-fg-muted"
            style={subtitleColor ? { color: subtitleColor } : {}}
          >
            Informe o email da sua conta.
          </p>
        </div>

        {sent ? (
          <div
            class="flex items-start gap-2 rounded-md border border-success/40 bg-success/10 p-3 text-xs text-success"
            role="status"
          >
            <CheckCircle2 size={14} class="mt-0.5 shrink-0" />
            <span>
              Se existe uma conta com esse email, enviamos um link de redefinição.
              Verifique também a caixa de spam.
            </span>
          </div>
        ) : (
          <>
            <Input
              label="Email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
              disabled={loading}
            />

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
              <Mail size={16} /> {loading ? 'Enviando…' : 'Enviar link de recuperação'}
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
