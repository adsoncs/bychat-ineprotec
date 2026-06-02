import { useState } from 'preact/hooks'
import { LogIn, AlertCircle, Loader2, ExternalLink } from 'lucide-preact'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import {
  useMetaConfig,
  useConnectMetaWithToken,
  useConnectMetaBisu,
  useSelectMetaPage,
  type MetaPage,
} from '@/hooks/useMeta'
import { fbLogin, metaBusinessRedirectLogin } from '@/lib/facebookSdk'
import { toast } from '@/lib/toast'

interface ConnectMetaModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type Step = 'idle' | 'loggingIn' | 'fetchingPages' | 'pickPage' | 'activating'

export function ConnectMetaModal({ open, onOpenChange }: ConnectMetaModalProps) {
  const { data: config, isLoading: loadingConfig } = useMetaConfig()
  const connectWithToken = useConnectMetaWithToken()
  const connectBisu = useConnectMetaBisu()
  const selectPage = useSelectMetaPage()

  const [step, setStep] = useState<Step>('idle')
  const [error, setError] = useState<string | null>(null)
  const [pages, setPages] = useState<MetaPage[]>([])
  const [tokenType, setTokenType] = useState<string | null>(null)
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null)

  function reset() {
    setStep('idle')
    setError(null)
    setPages([])
    setTokenType(null)
    setSelectedPageId(null)
  }

  function handleClose(o: boolean) {
    if (!o) reset()
    onOpenChange(o)
  }

  async function startLogin() {
    if (!config?.appId) return
    setError(null)
    setStep('loggingIn')
    try {
      if (config.configId) {
        // Facebook Login for Business via OAuth clássico por redirect:
        // redirect_uri controlado por nós e idêntico na troca do code.
        const { code, redirectUri } = await metaBusinessRedirectLogin(
          config.appId,
          config.configId,
        )
        setStep('fetchingPages')
        const resp = await connectBisu.mutateAsync({ code, redirectUri })
        setPages(resp.pages)
        setTokenType(resp.tokenType ?? null)
      } else {
        const result = await fbLogin(config.appId, config.configId)
        setStep('fetchingPages')
        if ('code' in result) {
          const resp = await connectBisu.mutateAsync({
            code: result.code,
            redirectUri: window.location.href,
          })
          setPages(resp.pages)
          setTokenType(resp.tokenType ?? null)
        } else {
          const resp = await connectWithToken.mutateAsync(result.token)
          setPages(resp.pages)
          setTokenType(resp.tokenType ?? null)
        }
      }
      setStep('pickPage')
    } catch (e: unknown) {
      const msg = (e as Error).message || 'Erro desconhecido'
      setError(msg)
      setStep('idle')
    }
  }

  async function activate(pageId: string) {
    setSelectedPageId(pageId)
    setStep('activating')
    setError(null)
    try {
      const resp = await selectPage.mutateAsync(pageId)
      toast(
        resp.webhookSubscribed
          ? `Página "${resp.integration.pageName}" conectada com webhook ativo.`
          : `Página "${resp.integration.pageName}" conectada (webhook precisa de configuração manual).`,
        'success',
      )
      handleClose(false)
    } catch (e: unknown) {
      setError((e as Error).message || 'Falha ao ativar a integração')
      setStep('pickPage')
      setSelectedPageId(null)
    }
  }

  const missingConfig = !loadingConfig && (!config?.appId || !config?.hasSecret)

  return (
    <Modal
      open={open}
      onOpenChange={handleClose}
      title="Conectar Meta Ads"
      description="Conecte uma página do Facebook/Instagram para receber leads de Lead Ads automaticamente."
      size="lg"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => handleClose(false)}>
            Fechar
          </Button>
          {step === 'pickPage' && (
            <Button variant="ghost" size="sm" onClick={reset}>
              Trocar conta
            </Button>
          )}
        </>
      }
    >
      {loadingConfig && <Skeleton class="h-24 w-full" />}

      {!loadingConfig && missingConfig && (
        <div class="space-y-3">
          <div class="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-fg">
            <AlertCircle size={16} class="mt-0.5 shrink-0 text-warning" />
            <div>
              <p class="font-medium">Configuração incompleta</p>
              <p class="mt-0.5 text-xs text-fg-muted">
                {!config?.appId ? 'O Meta App ID' : 'O Meta App Secret'} ainda não foi configurado.
                Acesse Configurações &gt; Integrações para preencher antes de conectar.
              </p>
            </div>
          </div>
          <Button variant="primary" size="sm" onClick={() => window.location.assign('/app/settings/integrations')}>
            <ExternalLink size={14} /> Ir para Integrações
          </Button>
        </div>
      )}

      {!loadingConfig && !missingConfig && step === 'idle' && (
        <div class="space-y-4">
          <p class="text-sm text-fg-muted">
            Você será redirecionado para o Facebook para autorizar o acesso às suas páginas e
            formulários de Lead Ads. Aceite todas as permissões para que os leads cheguem em tempo real.
          </p>
          {config?.configId && (
            <p class="text-xs text-fg-subtle">
              Usando <strong>Facebook Login for Business</strong> — token permanente, sem renovação.
            </p>
          )}
          {error && (
            <div class="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/10 p-3 text-xs text-danger">
              <AlertCircle size={14} class="mt-0.5 shrink-0" /> {error}
            </div>
          )}
          <Button variant="primary" size="md" onClick={startLogin}>
            <LogIn size={16} /> Continuar com Facebook
          </Button>
        </div>
      )}

      {(step === 'loggingIn' || step === 'fetchingPages') && (
        <div class="flex items-center gap-3 py-6 text-sm text-fg-muted">
          <Loader2 size={16} class="animate-spin" />
          {step === 'loggingIn' ? 'Aguardando autorização do Facebook…' : 'Buscando suas páginas…'}
        </div>
      )}

      {step === 'pickPage' && (
        <div class="space-y-3">
          <p class="text-sm text-fg-muted">
            Encontramos <strong>{pages.length}</strong> página{pages.length === 1 ? '' : 's'}.
            Selecione qual deseja conectar.
            {tokenType && (
              <span class="ml-1 text-fg-subtle">
                (token: {tokenType === 'bisu' ? 'BISU permanente' : tokenType})
              </span>
            )}
          </p>
          {error && (
            <div class="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/10 p-3 text-xs text-danger">
              <AlertCircle size={14} class="mt-0.5 shrink-0" /> {error}
            </div>
          )}
          <ul class="divide-y divide-border rounded-md border border-border">
            {pages.map((p) => (
              <li
                key={p.id}
                class="flex items-center justify-between gap-3 px-3 py-2 hover:bg-surface-3"
              >
                <div class="min-w-0">
                  <p class="truncate text-sm font-medium text-fg">{p.name}</p>
                  <p class="truncate text-[0.6875rem] text-fg-subtle">
                    ID {p.id} · {p.category}
                  </p>
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => activate(p.id)}
                  disabled={selectPage.isPending}
                >
                  {selectedPageId === p.id && selectPage.isPending ? 'Conectando…' : 'Conectar'}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {step === 'activating' && (
        <div class="flex items-center gap-3 py-6 text-sm text-fg-muted">
          <Loader2 size={16} class="animate-spin" /> Ativando integração e sincronizando formulários…
        </div>
      )}
    </Modal>
  )
}
