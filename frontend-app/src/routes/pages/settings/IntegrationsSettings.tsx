// IntegrationsSettings — área admin pra credenciais globais de integrações que
// não são por-operador. Hoje: Google Ads Developer Token (Fase 25). Conforme
// novas integrações precisarem de credenciais globais, elas entram aqui.

import { useEffect, useMemo, useState } from 'preact/hooks'
import { ExternalLink, KeyRound, Eye, EyeOff } from '@/components/ui/icon-set'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { useSettings, useUpdateSettings } from '@/hooks/useSettings'
import { useGoogleAdsDevTokenStatus } from '@/hooks/useGoogleAds'
import { toast } from '@/lib/toast'

const KEY = 'google.ads.developer_token'

export function IntegrationsSettings() {
  const { data, isLoading } = useSettings()
  const update = useUpdateSettings()
  const tokenStatus = useGoogleAdsDevTokenStatus()
  const [draft, setDraft] = useState('')
  const [show, setShow] = useState(false)

  const initial = useMemo<string>(() => {
    const s = data?.settings.find((x: any) => x.key === KEY)
    if (!s) return ''
    const v = s.value as any
    if (typeof v === 'string') return v
    return v?.token || v?.value || ''
  }, [data?.settings])

  useEffect(() => { setDraft(initial) }, [initial])

  const dirty = draft.trim() !== initial.trim()
  const configured = !!tokenStatus.data?.configured

  function handleSave() {
    update.mutate({ [KEY]: draft.trim() } as any, {
      onSuccess: () => {
        toast('Developer Token salvo', 'success')
        // Refetch do status pra atualizar o badge "Configurado"
        void tokenStatus.refetch()
      },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function handleClear() {
    if (!confirm('Remover o Developer Token? Conexões existentes vão parar de funcionar até cadastrar um novo.')) return
    update.mutate({ [KEY]: '' } as any, {
      onSuccess: () => {
        toast('Developer Token removido', 'success')
        setDraft('')
        void tokenStatus.refetch()
      },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <div class="space-y-4">
      <Card>
        <div class="flex items-start gap-3">
          <KeyRound size={20} class="text-info shrink-0 mt-0.5" />
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <div class="text-sm font-semibold text-fg">Google Ads — Developer Token</div>
              {configured
                ? <Badge tone="accent">Configurado</Badge>
                : <Badge tone="warning" solid>Não configurado</Badge>}
            </div>
            <p class="text-xs text-fg-muted mt-1">
              Token único da aplicação que dá acesso à <strong>Google Ads API</strong>. Cadastrado UMA VEZ por aqui (admin) — operadores leigos só fazem login Google e escolhem a conta. Sem isso, ninguém consegue conectar Google Ads.
            </p>
            <p class="text-2xs text-fg-muted mt-2">
              Como obter: <a href="https://ads.google.com/aw/apicenter" target="_blank" rel="noreferrer" class="text-info hover:underline inline-flex items-center gap-1">Google Ads &gt; Ferramentas &gt; API Center <ExternalLink size={10} /></a> (logado na conta MCC) → "Apply for Basic Access" → Google aprova em ~1-3 dias úteis → o token aparece nessa página.
            </p>
          </div>
        </div>

        {isLoading ? (
          <Skeleton class="h-10 w-full mt-4" />
        ) : (
          <div class="mt-4 space-y-3">
            <div class="flex items-end gap-2">
              <div class="flex-1">
                <Input
                  label="Developer Token"
                  type={show ? 'text' : 'password'}
                  value={draft}
                  onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
                  placeholder="Ex.: AbCdEf123_GhIjKl-MnOpQr"
                  hint="Aproximadamente 22 caracteres alfanuméricos. Só salva quando clicar em Salvar."
                />
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShow((v) => !v)}
                aria-label={show ? 'Ocultar' : 'Mostrar'}
                title={show ? 'Ocultar' : 'Mostrar'}
              >
                {show ? <EyeOff size={14} /> : <Eye size={14} />}
              </Button>
            </div>
            <div class="flex justify-end gap-2 pt-2 border-t border-border">
              {configured && !dirty && (
                <Button variant="ghost" size="sm" onClick={handleClear} disabled={update.isPending} class="!text-danger">
                  Remover
                </Button>
              )}
              {dirty && (
                <>
                  <Button variant="ghost" size="sm" onClick={() => setDraft(initial)} disabled={update.isPending}>
                    Descartar
                  </Button>
                  <Button variant="primary" size="sm" onClick={handleSave} disabled={update.isPending || !draft.trim()}>
                    {update.isPending ? 'Salvando…' : 'Salvar'}
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
