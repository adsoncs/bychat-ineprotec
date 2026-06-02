import { useState } from 'preact/hooks'
import { LogIn, AlertCircle, Loader2, ExternalLink, CheckCircle } from 'lucide-preact'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { useCloudApiConfig, useCloudApiSignup } from '@/hooks/useCloudApi'
import { fbEmbeddedSignup } from '@/lib/facebookSdk'
import { toast } from '@/lib/toast'

interface EmbeddedSignupModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type Step = 'idle' | 'launching' | 'finalizing' | 'done'

export function EmbeddedSignupModal({ open, onOpenChange }: EmbeddedSignupModalProps) {
  const { data: config, isLoading: loadingConfig } = useCloudApiConfig()
  const signup = useCloudApiSignup()

  const [step, setStep] = useState<Step>('idle')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{
    name: string
    phone: string
    templates: number
    webhookSubscribed: boolean
  } | null>(null)

  function reset() {
    setStep('idle')
    setError(null)
    setResult(null)
  }

  function handleClose(o: boolean) {
    if (!o) reset()
    onOpenChange(o)
  }

  async function startSignup() {
    if (!config?.appId || !config?.configId) return
    setError(null)
    setStep('launching')
    try {
      const fb = await fbEmbeddedSignup(config.appId, config.configId)
      setStep('finalizing')
      const resp = await signup.mutateAsync({
        wabaId: fb.wabaId,
        phoneNumberId: fb.phoneNumberId,
        code: fb.code,
        accessToken: fb.token,
      })
      setResult({
        name: resp.connection.displayName ?? resp.connection.displayPhone ?? resp.connection.wabaId,
        phone: resp.connection.displayPhone ?? '',
        templates: resp.templatesSynced ?? 0,
        webhookSubscribed: resp.webhookSubscribed,
      })
      setStep('done')
      toast('Conta WhatsApp Cloud conectada', 'success')
    } catch (e: unknown) {
      const msg = (e as Error).message || 'Erro desconhecido'
      setError(msg)
      setStep('idle')
    }
  }

  const missingConfig = !loadingConfig && (!config?.appId || !config?.configId)

  return (
    <Modal
      open={open}
      onOpenChange={handleClose}
      title="Conectar WhatsApp Cloud API"
      description="Embedded Signup oficial do Meta — token permanente, sem renovação."
      size="lg"
      footer={
        step === 'done' ? (
          <Button variant="primary" size="sm" onClick={() => handleClose(false)}>
            Concluir
          </Button>
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
          <div class="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-fg">
            <AlertCircle size={16} class="mt-0.5 shrink-0 text-warning" />
            <div>
              <p class="font-medium">Integração não configurada</p>
              <p class="mt-0.5 text-xs text-fg-muted">
                {!config?.appId
                  ? 'O Meta App ID precisa estar configurado.'
                  : 'O Config ID do Facebook Login for Business precisa estar configurado.'}
                {' '}Acesse Configurações &gt; Integrações para preencher.
              </p>
            </div>
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={() => window.location.assign('/app/settings/integrations')}
          >
            <ExternalLink size={14} /> Ir para Integrações
          </Button>
        </div>
      )}

      {!loadingConfig && !missingConfig && step === 'idle' && (
        <div class="space-y-4">
          <p class="text-sm text-fg-muted">
            O assistente do Meta vai pedir para você selecionar (ou criar) uma conta WhatsApp Business
            (WABA) e um número. Conclua <strong>todos</strong> os passos para que recebamos o
            <code class="mx-1 rounded bg-surface-3 px-1">waba_id</code> e o
            <code class="mx-1 rounded bg-surface-3 px-1">phone_number_id</code>.
          </p>
          <ul class="space-y-1.5 text-xs text-fg-muted">
            <li>· O número precisa ter <strong>dois fatores ativos</strong> e não pode estar registrado em outro app.</li>
            <li>· Templates aprovados na sua WABA serão importados automaticamente.</li>
            <li>· O webhook é inscrito automaticamente após a conexão.</li>
          </ul>
          {error && (
            <div class="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/10 p-3 text-xs text-danger">
              <AlertCircle size={14} class="mt-0.5 shrink-0" /> {error}
            </div>
          )}
          <Button variant="primary" size="md" onClick={startSignup}>
            <LogIn size={16} /> Iniciar Embedded Signup
          </Button>
        </div>
      )}

      {(step === 'launching' || step === 'finalizing') && (
        <div class="flex items-center gap-3 py-6 text-sm text-fg-muted">
          <Loader2 size={16} class="animate-spin" />
          {step === 'launching'
            ? 'Aguardando você concluir o assistente do Meta…'
            : 'Validando WABA, criando token permanente e sincronizando templates…'}
        </div>
      )}

      {step === 'done' && result && (
        <div class="space-y-3">
          <div class="flex items-start gap-2 rounded-md border border-success/40 bg-success/10 p-3 text-sm text-fg">
            <CheckCircle size={16} class="mt-0.5 shrink-0 text-success" />
            <div class="space-y-1">
              <p class="font-medium">Conta conectada</p>
              <p class="text-xs text-fg-muted">
                <strong>{result.name}</strong>
                {result.phone ? ` — ${result.phone}` : ''}
              </p>
              <p class="text-xs text-fg-muted">
                {result.templates} template{result.templates === 1 ? '' : 's'} sincronizado{result.templates === 1 ? '' : 's'} ·
                {' '}webhook {result.webhookSubscribed ? 'inscrito' : 'precisa ser configurado manualmente'}.
              </p>
            </div>
          </div>
          {!result.webhookSubscribed && (
            <p class="text-xs text-fg-subtle">
              A inscrição automática do webhook falhou. Verifique nas configurações da WABA do Meta
              Developers se o callback está apontando para a URL exibida no painel.
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}
