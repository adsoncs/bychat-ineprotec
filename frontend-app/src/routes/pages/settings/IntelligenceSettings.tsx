import { useEffect, useMemo, useState } from 'preact/hooks'
import { Briefcase, Phone, Save, Sparkles } from 'lucide-preact'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { Input, Select } from '@/components/ui/Input'
import {
  usePhoneIdentityConfig,
  useUpdatePhoneIdentityConfig,
  type PhoneIdentityProvider,
} from '@/hooks/useIntelligence'
import { useSettings, useUpdateSettings } from '@/hooks/useSettings'
import { useAiScoreCalibration } from '@/hooks/useLeads'
import { toast } from '@/lib/toast'

export function IntelligenceSettings() {
  return (
    <div class="space-y-4">
      <div class="flex items-center gap-2 text-sm text-fg-muted">
        <Sparkles size={14} class="text-accent" />
        <span>Fontes opt-in usadas pelo motor de enriquecimento de leads. Cada ativação tem implicações de custo e LGPD — leia os avisos antes de ligar.</span>
      </div>
      <BusinessContextCard />
      <AiScoreCalibrationCard />
      <PhoneIdentityCard />
    </div>
  )
}

interface BizField {
  key: string
  label: string
  type: 'text' | 'textarea'
  placeholder: string
}

const BUSINESS_FIELDS: BizField[] = [
  { key: 'business.company_name', label: 'Nome da empresa', type: 'text', placeholder: 'Ex.: Agência Beyond' },
  { key: 'business.industry', label: 'Ramo / segmento de atuação', type: 'text', placeholder: 'Ex.: Agência de marketing e publicidade' },
  { key: 'business.offer_description', label: 'O que vende (oferta principal)', type: 'textarea', placeholder: 'Ex.: Gestão de tráfego pago, criação e estratégia de marketing para PMEs.' },
  { key: 'business.target_audience', label: 'Público-alvo / cliente ideal (ICP)', type: 'textarea', placeholder: 'Ex.: PMEs de serviço com faturamento de R$50k–500k/mês que já investem em anúncios.' },
  { key: 'business.avg_ticket', label: 'Ticket médio', type: 'text', placeholder: 'Ex.: R$ 3.500/mês' },
  { key: 'business.sales_cycle', label: 'Ciclo de venda típico', type: 'text', placeholder: 'Ex.: 7 a 21 dias' },
  { key: 'business.good_lead_signals', label: 'Sinais de um BOM lead', type: 'textarea', placeholder: 'Ex.: já investe em anúncios, tem urgência, decisor respondeu, orçamento compatível.' },
  { key: 'business.bad_lead_signals', label: 'Sinais de um lead RUIM', type: 'textarea', placeholder: 'Ex.: busca serviço grátis, sem orçamento, fora do ICP, curioso/estudante.' },
]

function bizStr(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v.replace(/^"|"$/g, '')
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  try { return JSON.stringify(v) } catch { return '' }
}

function BusinessContextCard() {
  const { data, isLoading } = useSettings()
  const update = useUpdateSettings()
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [dirty, setDirty] = useState(false)

  const initial = useMemo(() => {
    const out: Record<string, string> = {}
    const keys = BUSINESS_FIELDS.map((f) => f.key)
    if (data) {
      for (const s of data.settings) {
        if (keys.includes(s.key)) out[s.key] = bizStr(s.value)
      }
    }
    for (const k of keys) out[k] ??= ''
    return out
  }, [data])

  useEffect(() => { setDraft(initial); setDirty(false) }, [initial])

  function patch(key: string, value: string) {
    setDraft((d) => ({ ...d, [key]: value }))
    setDirty(true)
  }

  function handleSave() {
    update.mutate(draft, {
      onSuccess: () => { toast('Contexto do negócio salvo', 'success'); setDirty(false) },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  const filled = BUSINESS_FIELDS.filter((f) => (draft[f.key] ?? '').trim() !== '').length

  return (
    <Card class="p-4">
      <div class="flex items-start justify-between gap-2 mb-2">
        <div>
          <div class="text-sm font-semibold text-fg flex items-center gap-2">
            <Briefcase size={14} class="text-accent" /> Contexto do Negócio
          </div>
          <div class="text-xs text-fg-muted mt-0.5">
            Descreva o que sua empresa vende e como é um bom cliente. A IA usa isso para calcular o
            <strong class="text-fg"> Lead Score preditivo</strong> — quanto melhor o contexto, melhor a análise de chance de fechamento.
          </div>
        </div>
        <Badge tone={filled > 0 ? 'success' : 'neutral'} solid={filled > 0}>
          {filled}/{BUSINESS_FIELDS.length}
        </Badge>
      </div>

      {isLoading ? (
        <Skeleton class="h-48 w-full" />
      ) : (
        <div class="space-y-3">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {BUSINESS_FIELDS.filter((f) => f.type === 'text').map((f) => (
              <Input
                key={f.key}
                label={f.label}
                value={draft[f.key] ?? ''}
                placeholder={f.placeholder}
                onInput={(e) => patch(f.key, (e.target as HTMLInputElement).value)}
              />
            ))}
          </div>
          {BUSINESS_FIELDS.filter((f) => f.type === 'textarea').map((f) => (
            <div key={f.key}>
              <label class="text-xs text-fg-muted block mb-1">{f.label}</label>
              <textarea
                value={draft[f.key] ?? ''}
                onInput={(e) => patch(f.key, (e.target as HTMLTextAreaElement).value)}
                placeholder={f.placeholder}
                rows={2}
                class="w-full text-sm rounded-md border border-border bg-surface px-2 py-1.5 focus:outline-none focus:border-accent"
                maxLength={1000}
              />
            </div>
          ))}
          <div class="flex items-center justify-end pt-1">
            <Button variant="primary" size="sm" onClick={handleSave} disabled={!dirty || update.isPending}>
              <Save size={12} /> {update.isPending ? 'Salvando…' : 'Salvar'}
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}

function AiScoreCalibrationCard() {
  const { data, isLoading } = useAiScoreCalibration()
  return (
    <Card class="p-4">
      <div class="text-sm font-semibold text-fg flex items-center gap-2 mb-1">
        <Sparkles size={14} class="text-accent" /> Calibração do Score IA (previsto × real)
      </div>
      <div class="text-xs text-fg-muted mb-3">
        Compara as faixas do Lead Score preditivo com o desfecho real (ganho/perdido). Quanto maior a taxa
        de ganho na faixa "quente", melhor calibrada está a IA.
      </div>
      {isLoading ? (
        <Skeleton class="h-24 w-full" />
      ) : !data || data.scored === 0 ? (
        <div class="text-sm text-fg-muted">Ainda sem leads pontuados pela IA.</div>
      ) : (
        <div class="overflow-x-auto">
          <table class="w-full text-xs">
            <thead>
              <tr class="text-fg-subtle text-left border-b border-border">
                <th class="py-1.5 pr-3 font-medium">Faixa</th>
                <th class="py-1.5 px-3 font-medium">Total</th>
                <th class="py-1.5 px-3 font-medium">Ganhos</th>
                <th class="py-1.5 px-3 font-medium">Perdidos</th>
                <th class="py-1.5 px-3 font-medium">Em aberto</th>
                <th class="py-1.5 pl-3 font-medium">Taxa de ganho</th>
              </tr>
            </thead>
            <tbody>
              {data.buckets.map((b) => (
                <tr key={b.bucket} class="border-b border-border/50">
                  <td class="py-1.5 pr-3 text-fg">{b.bucket}</td>
                  <td class="py-1.5 px-3 tabular-nums text-fg-muted">{b.total}</td>
                  <td class="py-1.5 px-3 tabular-nums text-success">{b.won}</td>
                  <td class="py-1.5 px-3 tabular-nums text-danger">{b.lost}</td>
                  <td class="py-1.5 px-3 tabular-nums text-fg-muted">{b.open}</td>
                  <td class="py-1.5 pl-3 tabular-nums text-fg font-semibold">
                    {b.winRate === null ? '—' : `${Math.round(b.winRate * 100)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div class="text-[0.6875rem] text-fg-subtle mt-2">{data.scored} leads pontuados pela IA.</div>
        </div>
      )}
    </Card>
  )
}

function PhoneIdentityCard() {
  const { data, isLoading } = usePhoneIdentityConfig()
  const update = useUpdatePhoneIdentityConfig()

  const [enabled, setEnabled] = useState(false)
  const [provider, setProvider] = useState<PhoneIdentityProvider>('mock')
  const [endpoint, setEndpoint] = useState('')
  const [token, setToken] = useState('')
  const [purpose, setPurpose] = useState('')

  useEffect(() => {
    if (!data) return
    setEnabled(data.enabled)
    setProvider(data.provider)
    setEndpoint(data.endpoint)
    setPurpose(data.purpose)
    setToken('')
  }, [data])

  function handleSave() {
    if (enabled && provider !== 'mock' && !endpoint.trim()) {
      toast('Endpoint é obrigatório quando o provedor não é "mock"', 'danger')
      return
    }
    update.mutate(
      {
        enabled,
        provider,
        endpoint: endpoint.trim(),
        purpose: purpose.trim(),
        token: token.trim() || undefined,
      },
      {
        onSuccess: () => { toast('Configuração salva', 'success'); setToken('') },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      },
    )
  }

  const isMock = provider === 'mock'
  const tokenPlaceholder = data?.tokenConfigured
    ? '••• (deixe vazio para manter o token atual)'
    : 'Bearer token do PSP/serviço'

  return (
    <Card class="p-4">
      <div class="flex items-start justify-between gap-2 mb-2">
        <div>
          <div class="text-sm font-semibold text-fg flex items-center gap-2">
            <Phone size={14} class="text-accent" /> Verificar dono do zap (PIX/DICT)
          </div>
          <div class="text-xs text-fg-muted mt-0.5">
            Consulta o titular de um número de telefone (nome, CPF mascarado e banco) via DICT ou serviço terceiro.
            Quando ativa, roda como provider tier 2 do motor de enriquecimento.
          </div>
        </div>
        <Badge tone={enabled ? 'success' : 'neutral'} solid={enabled}>
          {enabled ? 'ATIVO' : 'DESATIVADO'}
        </Badge>
      </div>

      <div class="rounded-md border border-warning/30 bg-warning/10 p-2.5 text-xs text-fg my-3">
        <strong class="text-warning">Atenção LGPD:</strong> esta consulta retorna dados pessoais.
        Garanta base legal documentada (Art. 7º) e finalidade clara — o campo "Finalidade" abaixo é
        persistido junto a cada consulta para fins de auditoria.
      </div>

      {isLoading ? (
        <Skeleton class="h-32 w-full" />
      ) : (
        <div class="space-y-3">
          <label class="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled((e.target as HTMLInputElement).checked)}
              class="mt-0.5"
            />
            <div>
              <div class="text-sm text-fg">Ativar consulta de identidade do telefone</div>
              <div class="text-xs text-fg-muted">Enquanto desativado, o provider é no-op — não chama nada externo, custo zero.</div>
            </div>
          </label>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select
              label="Provedor"
              value={provider}
              onChange={(e) => setProvider((e.target as HTMLSelectElement).value as PhoneIdentityProvider)}
            >
              <option value="mock">Mock (dados falsos — uso em desenvolvimento)</option>
              <option value="custom_http">HTTP genérico (cola endpoint do PSP)</option>
              <option value="celcoin">Celcoin (usa endpoint customizado)</option>
            </Select>
            <Input
              label={isMock ? 'Endpoint (não aplicável a mock)' : 'Endpoint *'}
              value={endpoint}
              onInput={(e) => setEndpoint((e.target as HTMLInputElement).value)}
              placeholder="https://api.psp.example.com/dict/lookup"
              disabled={isMock}
            />
          </div>

          <Input
            label="Token / chave secreta"
            type="password"
            value={token}
            onInput={(e) => setToken((e.target as HTMLInputElement).value)}
            placeholder={tokenPlaceholder}
            hint="Criptografado em repouso. Deixe vazio para manter o atual."
            disabled={isMock}
          />

          <div>
            <label class="text-xs text-fg-muted block mb-1">Finalidade declarada (LGPD)</label>
            <textarea
              value={purpose}
              onInput={(e) => setPurpose((e.target as HTMLTextAreaElement).value)}
              placeholder="Ex.: Validação de identidade do lead, conforme termo de consentimento aceito no cadastro."
              rows={2}
              class="w-full text-sm rounded-md border border-border bg-surface px-2 py-1.5 focus:outline-none focus:border-accent"
              maxLength={500}
            />
            <div class="text-[0.6875rem] text-fg-subtle mt-0.5">
              Registrado em cada consulta para auditoria. {purpose.length}/500.
            </div>
          </div>

          <div class="flex items-center justify-between pt-1">
            <div class="text-[0.6875rem] text-fg-subtle">
              {data?.tokenConfigured ? '✓ Token gravado (criptografado)' : '○ Sem token configurado'}
            </div>
            <Button variant="primary" size="sm" onClick={handleSave} disabled={update.isPending}>
              <Save size={12} /> {update.isPending ? 'Salvando…' : 'Salvar'}
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}
