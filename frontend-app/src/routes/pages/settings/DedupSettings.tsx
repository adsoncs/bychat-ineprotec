// DedupSettings — controla dedup.mode.<channel> por canal de captura.
// Categoria A (Captura) sempre cria lead novo. Setting controla se a sinalização
// "duplicado pendente" roda (always_new) ou fica muda (update_existing).

import { useEffect, useMemo, useState } from 'preact/hooks'
import { Copy } from '@/components/ui/icon-set'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { Select } from '@/components/ui/Input'
import { toast } from '@/lib/toast'
import { useSettings, useUpdateSettings } from '@/hooks/useSettings'

const CHANNELS: { key: string; label: string; help: string }[] = [
  { key: 'dedup.mode.forms', label: 'Forms / Landing Pages', help: 'Submissões dos formulários públicos e Web Components.' },
  { key: 'dedup.mode.metaLeadAds', label: 'Meta Lead Ads', help: 'Webhook de leads do Meta (Facebook/Instagram).' },
  { key: 'dedup.mode.enrollmentPortal', label: 'Portal de Matrículas', help: 'Inscrições do portal educacional (cada candidatura = oportunidade).' },
  { key: 'dedup.mode.publicApi', label: 'API Pública', help: 'Endpoints /api/v1/* via API Key.' },
  { key: 'dedup.mode.make', label: 'Make.com', help: 'Integromat / Make app oficial.' },
]

const MODE_OPTIONS: { value: string; label: string; description: string }[] = [
  {
    value: 'always_new',
    label: 'Sempre criar novo (recomendado)',
    description: 'Cada submissão vira um lead novo. Quando casar com um existente, aparece em "Leads duplicados" pra revisão humana.',
  },
  {
    value: 'update_existing',
    label: 'Atualizar existente (silencioso)',
    description: 'Cria o lead novo mas não sinaliza duplicidade. Bom pra integrações com identidade já garantida (sem Categoria A).',
  },
]

export function DedupSettings() {
  const { data, isLoading } = useSettings()
  const update = useUpdateSettings()
  const [draft, setDraft] = useState<Record<string, string>>({})

  const initialFromServer = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {}
    for (const c of CHANNELS) {
      const s = data?.settings.find((x: any) => x.key === c.key)
      let v = 'always_new'
      if (s) {
        const raw = s.value as any
        v = typeof raw === 'string' ? raw : (raw?.mode || raw?.value || 'always_new')
      }
      out[c.key] = v === 'update_existing' ? 'update_existing' : 'always_new'
    }
    return out
  }, [data?.settings])

  // Sincroniza o draft com o servidor quando os dados chegam
  useEffect(() => {
    setDraft(initialFromServer)
  }, [initialFromServer])

  const dirty = CHANNELS.some(c => (draft[c.key] ?? initialFromServer[c.key]) !== initialFromServer[c.key])

  function handleSave() {
    const updates: Record<string, string> = {}
    for (const c of CHANNELS) {
      const v = draft[c.key] ?? initialFromServer[c.key]
      if (v !== undefined && v !== initialFromServer[c.key]) updates[c.key] = v
    }
    if (Object.keys(updates).length === 0) return
    update.mutate(updates as any, {
      onSuccess: () => toast('Configurações de duplicação salvas', 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function handleReset() {
    setDraft(initialFromServer)
  }

  return (
    <div class="space-y-4">
      <Card>
        <div class="flex items-start gap-3 mb-4">
          <Copy size={18} class="text-info shrink-0 mt-0.5" />
          <div class="min-w-0">
            <div class="text-sm font-semibold text-fg">Duplicação por canal de captura</div>
            <p class="text-xs text-fg-muted mt-0.5">
              Cada submissão em Forms, Meta Lead Ads, Portal de Matrículas, API ou Make é tratada como uma <strong>oportunidade nova</strong>. Quando casa com um lead existente (por WhatsApp ou e-mail), o sistema sinaliza pra revisão humana em <a class="text-info hover:underline" href="/app/leads/duplicates">/app/leads/duplicates</a>. Aqui você pode silenciar essa sinalização por canal.
            </p>
          </div>
        </div>

        {isLoading ? (
          <Skeleton class="h-48 w-full" />
        ) : (
          <div class="flex flex-col gap-3">
            {CHANNELS.map(c => {
              const value = draft[c.key] ?? initialFromServer[c.key] ?? 'always_new'
              return (
                <div key={c.key} class="grid grid-cols-1 md:grid-cols-[16rem_1fr_18rem] gap-3 items-start py-2 border-b border-border last:border-b-0">
                  <div>
                    <div class="text-sm font-medium text-fg">{c.label}</div>
                    <p class="text-2xs text-fg-muted mt-0.5">{c.help}</p>
                  </div>
                  <div class="text-xs text-fg-muted">
                    {MODE_OPTIONS.find(o => o.value === value)?.description}
                  </div>
                  <Select
                    value={value}
                    onChange={(e) => {
                      const v = (e.target as HTMLSelectElement).value
                      setDraft(d => ({ ...d, [c.key]: v }))
                    }}
                  >
                    {MODE_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </Select>
                </div>
              )
            })}
          </div>
        )}

        {dirty && (
          <div class="flex justify-end gap-2 mt-4 pt-3 border-t border-border">
            <Button variant="ghost" size="sm" onClick={handleReset} disabled={update.isPending}>
              Descartar
            </Button>
            <Button variant="primary" size="sm" onClick={handleSave} disabled={update.isPending}>
              {update.isPending ? 'Salvando…' : 'Salvar'}
            </Button>
          </div>
        )}
      </Card>
    </div>
  )
}
