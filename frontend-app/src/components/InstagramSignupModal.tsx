import { useState } from 'preact/hooks'
import { LogIn, AlertCircle, Loader2, CheckCircle } from 'lucide-preact'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { Select } from '@/components/ui/Input'
import {
  useInstagramConfig,
  useInstagramEmbeddedSignup,
  type InstagramSignupPage,
} from '@/hooks/useInstagram'
import { fbLogin } from '@/lib/facebookSdk'
import { toast } from '@/lib/toast'

interface Props {
  open: boolean
  onOpenChange: (o: boolean) => void
}

type Step = 'idle' | 'launching' | 'finalizing' | 'pickPage' | 'done'

/**
 * Escopos do Instagram Messenger Platform — usados quando o app não tem um
 * Facebook Login for Business "config_id" configurado e cai no OAuth clássico.
 * O usuário final só faz login com email/senha do Meta — sem colar token.
 */
const IG_OAUTH_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_metadata',
  'pages_messaging',
  'instagram_business_basic',
  'instagram_business_manage_messages',
  'business_management',
].join(',')

export function InstagramSignupModal({ open, onOpenChange }: Props) {
  const { data: config, isLoading: loadingConfig } = useInstagramConfig()
  const signup = useInstagramEmbeddedSignup()

  const [step, setStep] = useState<Step>('idle')
  const [error, setError] = useState<string | null>(null)
  const [pages, setPages] = useState<InstagramSignupPage[]>([])
  const [pickedPageId, setPickedPageId] = useState<string>('')
  const [tempToken, setTempToken] = useState<string>('')
  const [doneInfo, setDoneInfo] = useState<{ pageName: string; igUsername: string } | null>(null)

  function reset() {
    setStep('idle')
    setError(null)
    setPages([])
    setPickedPageId('')
    setTempToken('')
    setDoneInfo(null)
  }

  function handleClose(o: boolean) {
    if (!o) reset()
    onOpenChange(o)
  }

  async function startSignup() {
    if (!config?.appId) return
    setError(null)
    setStep('launching')
    try {
      const r = await fbLogin(config.appId, config.configId ?? null, { scope: IG_OAUTH_SCOPES })
      setStep('finalizing')
      const payload: { code?: string; accessToken?: string } =
        'code' in r ? { code: r.code } : { accessToken: r.token }
      const resp = await signup.mutateAsync(payload)
      if ('needsPageSelection' in resp && resp.needsPageSelection) {
        setPages(resp.pages)
        setTempToken(resp.accessToken)
        setPickedPageId(resp.pages[0]?.pageId ?? '')
        setStep('pickPage')
        return
      }
      if ('connected' in resp) {
        setDoneInfo({ pageName: resp.pageName, igUsername: resp.igUsername })
        setStep('done')
        toast('Instagram conectado', 'success')
      }
    } catch (e: unknown) {
      setError((e as Error).message || 'Erro desconhecido')
      setStep('idle')
    }
  }

  async function finalizePick() {
    if (!pickedPageId || !tempToken) return
    setStep('finalizing')
    setError(null)
    try {
      const resp = await signup.mutateAsync({ accessToken: tempToken, pageId: pickedPageId })
      if ('connected' in resp) {
        setDoneInfo({ pageName: resp.pageName, igUsername: resp.igUsername })
        setStep('done')
        toast('Instagram conectado', 'success')
      }
    } catch (e: unknown) {
      setError((e as Error).message || 'Erro desconhecido')
      setStep('pickPage')
    }
  }

  // Só `appId` é obrigatório — sem configId caímos no OAuth clássico com escopos IG.
  const missingConfig = !loadingConfig && !config?.appId

  return (
    <Modal
      open={open}
      onOpenChange={handleClose}
      title="Conectar Instagram"
      description="Login guiado pelo Meta — escolha a página do Facebook vinculada à conta Instagram Business."
      size="lg"
      footer={
        step === 'done' ? (
          <Button variant="primary" size="sm" onClick={() => handleClose(false)}>
            Concluir
          </Button>
        ) : step === 'pickPage' ? (
          <>
            <Button variant="ghost" size="sm" onClick={() => handleClose(false)}>
              Cancelar
            </Button>
            <Button variant="primary" size="sm" onClick={finalizePick} disabled={!pickedPageId}>
              Conectar página
            </Button>
          </>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => handleClose(false)}>
            Fechar
          </Button>
        )
      }
    >
      {loadingConfig && <Skeleton class="h-24 w-full" />}

      {!loadingConfig && missingConfig && (
        <div class="space-y-3">
          <div class="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
            <AlertCircle size={16} class="mt-0.5 shrink-0 text-warning" />
            <div>
              <p class="font-medium text-fg">App Meta não configurado</p>
              <p class="mt-0.5 text-xs text-fg-muted">
                O administrador da plataforma ainda não cadastrou o <strong>Meta App ID</strong>{' '}
                em Configurações → Integrações Meta. Sem isso, o login com Facebook não pode ser iniciado.
              </p>
            </div>
          </div>
        </div>
      )}

      {!loadingConfig && !missingConfig && step === 'idle' && (
        <div class="space-y-4">
          <p class="text-sm text-fg-muted">
            O Meta vai pedir para você autorizar o app a acessar suas páginas e DMs do Instagram.
            Conclua todos os passos do assistente.
          </p>
          <ul class="space-y-1.5 text-xs text-fg-muted">
            <li>· A conta Instagram precisa ser <strong>Business</strong> ou <strong>Creator</strong>.</li>
            <li>· A página do Facebook precisa estar <strong>vinculada</strong> à conta IG.</li>
            <li>· Se você tiver várias páginas elegíveis, vamos te pedir para escolher uma.</li>
          </ul>
          {error && (
            <div class="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/10 p-3 text-xs text-danger">
              <AlertCircle size={14} class="mt-0.5 shrink-0" /> {error}
            </div>
          )}
          <Button variant="primary" size="md" onClick={startSignup}>
            <LogIn size={16} /> Iniciar login com Meta
          </Button>
        </div>
      )}

      {(step === 'launching' || step === 'finalizing') && (
        <div class="flex items-center gap-3 py-6 text-sm text-fg-muted">
          <Loader2 size={16} class="animate-spin" />
          {step === 'launching' ? 'Aguardando autorização no Meta…' : 'Conectando a página…'}
        </div>
      )}

      {step === 'pickPage' && (
        <div class="space-y-3">
          <p class="text-sm text-fg-muted">
            Você tem mais de uma página com Instagram Business vinculado. Escolha qual conectar:
          </p>
          <Select
            value={pickedPageId}
            onChange={(e) => setPickedPageId((e.target as HTMLSelectElement).value)}
          >
            {pages.map((p) => (
              <option value={p.pageId} key={p.pageId}>
                @{p.igUsername} — {p.pageName}
              </option>
            ))}
          </Select>
          {error && (
            <div class="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/10 p-3 text-xs text-danger">
              <AlertCircle size={14} class="mt-0.5 shrink-0" /> {error}
            </div>
          )}
        </div>
      )}

      {step === 'done' && doneInfo && (
        <div class="rounded-md border border-success/40 bg-success/10 p-3 text-sm">
          <div class="flex items-start gap-2">
            <CheckCircle size={16} class="mt-0.5 shrink-0 text-success" />
            <div>
              <p class="font-medium text-fg">Conectado!</p>
              <p class="text-xs text-fg-muted mt-0.5">
                <strong>@{doneInfo.igUsername}</strong> — página {doneInfo.pageName}.
              </p>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}
