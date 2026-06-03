// LegalSettings — dados do controlador (LGPD) exibidos nas páginas públicas
// /privacidade, /termos e /cookies (SSR em backend/src/routes/legal.ts).
// Cada tenant é controlador dos seus titulares → editável por instalação.
// Os campos *_html são opcionais: vazios = usa o texto-modelo embutido.

import { useEffect, useState } from 'preact/hooks'
import { Scale, ExternalLink } from 'lucide-preact'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { Input, Textarea } from '@/components/ui/Input'
import { toast } from '@/lib/toast'
import { useLegalSettings, useUpdateLegalSettings, type LegalConfig } from '@/hooks/useSettings'

const EMPTY: LegalConfig = {
  companyName: '', cnpj: '', dpoEmail: '', version: '1.0',
  privacyHtml: '', termsHtml: '', cookiesHtml: '',
}

export function LegalSettings() {
  const { data, isLoading } = useLegalSettings()
  const update = useUpdateLegalSettings()
  const [draft, setDraft] = useState<LegalConfig>(EMPTY)

  useEffect(() => {
    if (data) setDraft({ ...EMPTY, ...data })
  }, [data])

  const dirty = !!data && (Object.keys(EMPTY) as (keyof LegalConfig)[]).some(
    (k) => (draft[k] ?? '') !== (data[k] ?? ''),
  )

  function set<K extends keyof LegalConfig>(k: K, v: LegalConfig[K]) {
    setDraft((d) => ({ ...d, [k]: v }))
  }

  function handleSave() {
    update.mutate(draft, {
      onSuccess: () => toast('Dados legais (LGPD) salvos', 'success'),
      onError: (e: unknown) => toast((e as Error).message || 'Erro ao salvar', 'danger'),
    })
  }

  if (isLoading) return <Skeleton class="h-96 w-full" />

  return (
    <div class="space-y-4">
      <Card>
        <div class="flex items-start gap-3 mb-4">
          <Scale size={18} class="text-info shrink-0 mt-0.5" />
          <div class="min-w-0">
            <div class="text-sm font-semibold text-fg">Dados legais (LGPD)</div>
            <p class="text-xs text-fg-muted mt-0.5">
              Aparecem nas páginas públicas{' '}
              <a class="text-info hover:underline inline-flex items-center gap-0.5" href="/privacidade" target="_blank" rel="noopener">Política de Privacidade <ExternalLink size={11} /></a>,{' '}
              <a class="text-info hover:underline inline-flex items-center gap-0.5" href="/termos" target="_blank" rel="noopener">Termos <ExternalLink size={11} /></a> e{' '}
              <a class="text-info hover:underline inline-flex items-center gap-0.5" href="/cookies" target="_blank" rel="noopener">Cookies <ExternalLink size={11} /></a>,
              no rodapé e no banner de consentimento. Preencha com os dados da sua empresa.
            </p>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Input
            label="Razão social"
            value={draft.companyName}
            placeholder="Minha Empresa Educacional LTDA"
            onInput={(e) => set('companyName', (e.target as HTMLInputElement).value)}
          />
          <Input
            label="CNPJ"
            value={draft.cnpj}
            placeholder="00.000.000/0001-00"
            onInput={(e) => set('cnpj', (e.target as HTMLInputElement).value)}
          />
          <Input
            label="E-mail do Encarregado (DPO)"
            type="email"
            value={draft.dpoEmail}
            hint="Canal público de atendimento ao titular (art. 41 LGPD)."
            placeholder="dpo@suaempresa.com.br"
            onInput={(e) => set('dpoEmail', (e.target as HTMLInputElement).value)}
          />
          <Input
            label="Versão da política"
            value={draft.version}
            hint="Registrada em cada consentimento. Suba o número ao mudar os textos."
            placeholder="1.0"
            onInput={(e) => set('version', (e.target as HTMLInputElement).value)}
          />
        </div>
      </Card>

      <Card>
        <div class="text-sm font-semibold text-fg mb-1">Textos personalizados (opcional)</div>
        <p class="text-xs text-fg-muted mb-4">
          Deixe em branco para usar o modelo padrão da plataforma. Se preencher, o HTML substitui
          o corpo da página correspondente (o cabeçalho/rodapé com seus dados é mantido).
        </p>
        <div class="space-y-3">
          <Textarea
            label="HTML — Política de Privacidade"
            rows={5}
            value={draft.privacyHtml}
            placeholder="<h1>Política de Privacidade</h1> …"
            onInput={(e) => set('privacyHtml', (e.target as HTMLTextAreaElement).value)}
          />
          <Textarea
            label="HTML — Termos de Uso"
            rows={5}
            value={draft.termsHtml}
            placeholder="<h1>Termos de Uso</h1> …"
            onInput={(e) => set('termsHtml', (e.target as HTMLTextAreaElement).value)}
          />
          <Textarea
            label="HTML — Política de Cookies"
            rows={5}
            value={draft.cookiesHtml}
            placeholder="<h1>Política de Cookies</h1> …"
            onInput={(e) => set('cookiesHtml', (e.target as HTMLTextAreaElement).value)}
          />
        </div>
      </Card>

      {dirty && (
        <div class="flex justify-end gap-2 sticky bottom-3">
          <Button variant="ghost" size="sm" onClick={() => data && setDraft({ ...EMPTY, ...data })} disabled={update.isPending}>
            Descartar
          </Button>
          <Button variant="primary" size="sm" onClick={handleSave} disabled={update.isPending}>
            {update.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </div>
      )}
    </div>
  )
}
