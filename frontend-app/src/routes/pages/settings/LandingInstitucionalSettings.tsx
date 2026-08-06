import { useEffect, useMemo, useState } from 'preact/hooks'
import { Save, ExternalLink } from 'lucide-preact'
import { useAuth } from '@/hooks/useAuth'
import { useLandingContact, useSaveLandingContact } from '@/hooks/useLandingContact'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { toast } from '@/lib/toast'

// Seção embutida em Configurações › Aparência › aba "Landing Page".
// Para não-SUPERADMIN a seção simplesmente não aparece (endpoint também é
// superadminOnly). Tem load/save próprios — independe do draft de Aparência.
export function LandingInstitucionalSettings() {
  const { user } = useAuth()
  const isSuper = user?.role === 'SUPERADMIN'
  if (!isSuper) return null
  return <LandingInstitucionalBody />
}

function LandingInstitucionalBody() {
  const { data, isLoading, isError } = useLandingContact()
  const save = useSaveLandingContact()

  const [whatsappNumber, setWhatsappNumber] = useState('')
  const [whatsappMessage, setWhatsappMessage] = useState('')
  const [loginUrl, setLoginUrl] = useState('/app')
  const [saveMsg, setSaveMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => {
    if (!data) return
    setWhatsappNumber(data.whatsappNumber ?? '')
    setWhatsappMessage(data.whatsappMessage ?? '')
    setLoginUrl(data.loginUrl ?? '/app')
  }, [data])

  const digits = useMemo(() => whatsappNumber.replace(/\D/g, ''), [whatsappNumber])
  const waPreview = useMemo(
    () => `https://wa.me/${digits}?text=${encodeURIComponent(whatsappMessage)}`,
    [digits, whatsappMessage],
  )

  function handleSave() {
    setSaveMsg(null)
    if (!/^\d{10,15}$/.test(digits)) {
      setSaveMsg({ kind: 'err', text: 'WhatsApp inválido. Use o formato internacional só com dígitos (ex.: 5511944742843).' })
      return
    }
    if (!whatsappMessage.trim()) {
      setSaveMsg({ kind: 'err', text: 'A mensagem inicial do WhatsApp é obrigatória.' })
      return
    }
    if (loginUrl && !/^(\/|https?:\/\/)/.test(loginUrl.trim())) {
      setSaveMsg({ kind: 'err', text: 'O link de login deve começar com / ou http(s)://.' })
      return
    }

    setSaveMsg({ kind: 'ok', text: 'Salvando…' })
    save.mutate(
      { whatsappNumber: digits, whatsappMessage: whatsappMessage.trim(), loginUrl: loginUrl.trim() || '/app' },
      {
        onSuccess: () => {
          setSaveMsg({ kind: 'ok', text: '✓ Salvo — já vale na próxima visita à landing' })
          toast('Contatos da landing salvos', 'success')
        },
        onError: (e: unknown) => {
          const text = (e instanceof Error && e.message) || 'Erro ao salvar'
          setSaveMsg({ kind: 'err', text })
          toast(text, 'danger')
        },
      },
    )
  }

  if (isLoading) return <Skeleton class="h-96 w-full" />
  if (isError) return <div class="text-sm text-danger">Erro ao carregar configuração.</div>

  return (
    <div class="space-y-4">
      <div>
        <h2 class="text-base font-semibold text-fg">Landing Institucional</h2>
        <p class="text-xs text-fg-muted mt-0.5">
          Contatos da vitrine pública (<strong>bychat.ia.br</strong>). Os textos e seções
          continuam no código — aqui você ajusta só os canais, sem precisar de rebuild.
        </p>
      </div>

      <section class="rounded-lg border border-border bg-surface-2 overflow-hidden">
        <div class="px-4 py-2 border-b border-border bg-surface">
          <div class="text-sm font-semibold text-fg">WhatsApp dos CTAs</div>
        </div>
        <div class="p-4 grid gap-3.5">
          <div>
            <label class="text-[0.6875rem] font-medium text-fg-muted block mb-1">
              Número (formato internacional, só dígitos)
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={whatsappNumber}
              placeholder="5511944742843"
              onInput={(e) => setWhatsappNumber((e.target as HTMLInputElement).value)}
              class="w-full h-9 px-3 rounded-md bg-surface border border-border text-sm text-fg focus:outline-none focus:border-accent"
            />
            <div class="text-[0.6875rem] text-fg-muted mt-1">
              Ex.: 55 + DDD + número = <code>5511944742843</code>. Alimenta todos os botões
              "Falar no WhatsApp" e "Agende uma demonstração".
            </div>
          </div>
          <div>
            <label class="text-[0.6875rem] font-medium text-fg-muted block mb-1">
              Mensagem inicial pré-preenchida
            </label>
            <textarea
              value={whatsappMessage}
              onInput={(e) => setWhatsappMessage((e.target as HTMLTextAreaElement).value)}
              rows={3}
              class="w-full px-3 py-2 rounded-md bg-surface border border-border text-sm text-fg focus:outline-none focus:border-accent resize-y"
            />
          </div>
          <a
            href={waPreview}
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1.5 text-xs text-accent hover:underline w-fit"
          >
            <ExternalLink size={12} /> Testar link gerado
          </a>
        </div>
      </section>

      <section class="rounded-lg border border-border bg-surface-2 overflow-hidden">
        <div class="px-4 py-2 border-b border-border bg-surface">
          <div class="text-sm font-semibold text-fg">Botão "Entrar"</div>
        </div>
        <div class="p-4">
          <label class="text-[0.6875rem] font-medium text-fg-muted block mb-1">
            Destino do botão Entrar
          </label>
          <input
            type="text"
            value={loginUrl}
            placeholder="/app"
            onInput={(e) => setLoginUrl((e.target as HTMLInputElement).value)}
            class="w-full h-9 px-3 rounded-md bg-surface border border-border text-sm text-fg focus:outline-none focus:border-accent"
          />
          <div class="text-[0.6875rem] text-fg-muted mt-1">
            Padrão <code>/app</code>. Só altere se o login do sistema mudar de endereço.
          </div>
        </div>
      </section>

      <div class="flex items-center gap-3">
        <Button variant="primary" size="md" onClick={handleSave} disabled={save.isPending}>
          <Save size={14} /> Salvar
        </Button>
        {saveMsg && (
          <span class={`text-xs ${saveMsg.kind === 'ok' ? 'text-accent' : 'text-danger'}`}>
            {saveMsg.text}
          </span>
        )}
      </div>
    </div>
  )
}
