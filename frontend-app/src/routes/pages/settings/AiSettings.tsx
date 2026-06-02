import { useState, useEffect, useMemo } from 'preact/hooks'
import {
  Brain, Save, CheckCircle, AlertCircle, Bot, Eye, EyeOff, Sliders, Info,
  ExternalLink, Power, AlertTriangle,
} from 'lucide-preact'
import { useSettings, useUpdateSettings, useTestAi } from '@/hooks/useSettings'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Input'
import { toast } from '@/lib/toast'

const AI_KEYS = [
  'ai.anthropic_api_key',
  'ai.openai_api_key',
  'ai.default_provider',
  'ai.default_model',
  'ai.anthropic_model',
  'ai.openai_model',
  'ai.temperature',
  'ai.chat_max_tokens',
  'ai.analysis_max_tokens',
] as const

type ProviderId = 'anthropic' | 'openai'

const AI_TEST_LS_PREFIX = 'bh_ai_test_'

interface ModelOption {
  id: string
  name: string
  desc: string
}

interface AiTestResult {
  ok: boolean
  at: number
  error?: string
}

const ANTHROPIC_MODELS: ModelOption[] = [
  { id: 'claude-opus-4-7', name: 'Claude Opus 4.7', desc: 'Mais inteligente, ideal para análises complexas — maior custo' },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', desc: 'Equilíbrio entre qualidade e custo — recomendado' },
  { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', desc: 'Mais rápido e barato, bom para conversas simples' },
  { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4 (legado)', desc: 'Geração 4 inicial, estável' },
  { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', desc: 'Geração anterior, estável e confiável' },
  { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', desc: 'Geração anterior, mais econômico' },
]

const OPENAI_MODELS: ModelOption[] = [
  { id: 'gpt-4o', name: 'GPT-4o', desc: 'Mais capaz e multimodal — recomendado' },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', desc: 'Versão compacta, rápida e econômica' },
  { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', desc: 'Alta performance com janela de contexto grande' },
  { id: 'gpt-4', name: 'GPT-4', desc: 'Modelo clássico, estável e confiável' },
  { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', desc: 'Mais rápido e barato, menor qualidade' },
  { id: 'o3-mini', name: 'o3-mini', desc: 'Modelo de raciocínio da OpenAI' },
]

const TEMPERATURE_OPTS: ModelOption[] = [
  { id: '0', name: 'Preciso (0)', desc: 'Respostas determinísticas — ideal para extração de dados e JSON' },
  { id: '0.3', name: 'Controlado (0.3)', desc: 'Consistente com leve variação — bom para análises estratégicas' },
  { id: '0.5', name: 'Balanceado (0.5)', desc: 'Natural e confiável — bom para conversas profissionais' },
  { id: '0.7', name: 'Natural (0.7)', desc: 'Conversacional e fluido — recomendado para chatbots' },
  { id: '1.0', name: 'Criativo (1.0)', desc: 'Respostas variadas e criativas — menos previsível' },
]

const CHAT_TOKENS_OPTS: ModelOption[] = [
  { id: '400', name: '400 — Curto', desc: 'Respostas bem curtas, 2-3 frases' },
  { id: '600', name: '600 — Moderado', desc: 'Respostas concisas, bom para perguntas diretas' },
  { id: '800', name: '800 — Padrão', desc: 'Equilíbrio entre detalhe e objetividade — recomendado' },
  { id: '1000', name: '1000 — Detalhado', desc: 'Respostas mais completas, pode ficar verboso' },
  { id: '1500', name: '1500 — Extenso', desc: 'Respostas longas, maior custo por mensagem' },
]

const ANALYSIS_TOKENS_OPTS: ModelOption[] = [
  { id: '800', name: '800 — Resumido', desc: 'Diagnóstico enxuto, pontos principais' },
  { id: '1200', name: '1200 — Padrão', desc: 'Análise completa com bom nível de detalhe — recomendado' },
  { id: '1600', name: '1600 — Detalhado', desc: 'Análise profunda com mais recomendações' },
  { id: '2000', name: '2000 — Extenso', desc: 'Diagnóstico muito detalhado, maior custo' },
  { id: '2500', name: '2500 — Máximo', desc: 'Análise exaustiva, uso intensivo de tokens' },
]

function maskKey(v: string): string {
  if (!v) return ''
  if (v.length <= 12) return '••••••••'
  return v.substring(0, 8) + '••••••••' + v.substring(v.length - 4)
}

export function AiSettings() {
  const { data, isLoading } = useSettings()
  const update = useUpdateSettings()
  const testAi = useTestAi()
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [dirty, setDirty] = useState(false)
  const [testingProvider, setTestingProvider] = useState<ProviderId | null>(null)
  const [testResults, setTestResults] = useState<Record<ProviderId, AiTestResult | null>>(() => ({
    anthropic: loadAiTest('anthropic'),
    openai: loadAiTest('openai'),
  }))

  const initial = useMemo(() => {
    const out: Record<string, string> = {}
    if (data) {
      for (const s of data.settings) {
        if ((AI_KEYS as readonly string[]).includes(s.key)) out[s.key] = stringifyValue(s.value)
      }
    }
    out['ai.default_provider'] ??= 'anthropic'
    out['ai.anthropic_model'] ??= 'claude-sonnet-4-6'
    out['ai.openai_model'] ??= 'gpt-4o-mini'
    out['ai.temperature'] ??= '0.7'
    out['ai.chat_max_tokens'] ??= '800'
    out['ai.analysis_max_tokens'] ??= '1200'
    return out
  }, [data])

  useEffect(() => {
    setDraft(initial)
    setDirty(false)
  }, [initial])

  function patch(key: string, value: string) {
    setDraft((d) => ({ ...d, [key]: value }))
    setDirty(true)
    if (key === 'ai.anthropic_api_key') resetTest('anthropic')
    else if (key === 'ai.openai_api_key') resetTest('openai')
  }

  function resetTest(provider: ProviderId) {
    setTestResults((s) => ({ ...s, [provider]: null }))
    clearAiTest(provider)
  }

  function persistTest(provider: ProviderId, result: AiTestResult) {
    setTestResults((s) => ({ ...s, [provider]: result }))
    saveAiTest(provider, result)
  }

  function handleSave() {
    update.mutate(draft, {
      onSuccess: () => { toast('Configurações salvas', 'success'); setDirty(false) },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function handleTest(provider: ProviderId) {
    if (dirty) {
      toast('Salve antes de testar (a chave precisa estar persistida)', 'warning')
      return
    }
    setTestingProvider(provider)
    testAi.mutate(provider, {
      onSuccess: (r) => {
        persistTest(provider, { ok: true, at: Date.now() })
        toast(`Token ${r.provider} válido`, 'success')
        setTestingProvider(null)
      },
      onError: (e: unknown) => {
        const err = (e as Error).message
        persistTest(provider, { ok: false, at: Date.now(), error: err })
        toast(err, 'danger')
        setTestingProvider(null)
      },
    })
  }

  function activateProvider(provider: ProviderId) {
    update.mutate({ 'ai.default_provider': provider }, {
      onSuccess: () => {
        setDraft((d) => ({ ...d, 'ai.default_provider': provider }))
        toast(`Provedor padrão: ${provider === 'anthropic' ? 'Anthropic' : 'OpenAI'}`, 'success')
      },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  if (isLoading) return <Skeleton class="h-64 w-full" />

  const defaultProvider = (draft['ai.default_provider'] ?? 'anthropic') as ProviderId | 'none'
  const anthropicKey = (draft['ai.anthropic_api_key'] ?? '').trim()
  const openaiKey = (draft['ai.openai_api_key'] ?? '').trim()
  const defaultMissingKey =
    (defaultProvider === 'anthropic' && anthropicKey === '') ||
    (defaultProvider === 'openai' && openaiKey === '')

  return (
    <div class="space-y-3">
      <div class="flex items-center justify-end">
        <Button variant="primary" size="sm" onClick={handleSave} disabled={!dirty || update.isPending}>
          <Save size={14} /> {update.isPending ? 'Salvando…' : 'Salvar'}
        </Button>
      </div>

      <div class="flex items-start gap-2 rounded-md border border-info/30 bg-info/10 p-3 text-xs text-fg-muted">
        <Info size={16} class="mt-0.5 shrink-0 text-info" />
        <div class="flex-1 leading-relaxed">
          A IA é usada para <strong class="text-fg">chatbots</strong>, <strong class="text-fg">análise estratégica</strong>{' '}
          (diagnóstico do lead) e <strong class="text-fg">detecção de vendas</strong> nas conversas. Apenas o provedor
          definido como padrão é consultado primeiro; o outro fica como fallback se a chave estiver configurada.
          <div class="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
            <a
              href="https://console.anthropic.com/settings/keys"
              target="_blank"
              rel="noopener noreferrer"
              class="text-accent inline-flex items-center gap-0.5 hover:underline"
            >
              Criar key Anthropic <ExternalLink size={10} />
            </a>
            <a
              href="https://platform.openai.com/api-keys"
              target="_blank"
              rel="noopener noreferrer"
              class="text-accent inline-flex items-center gap-0.5 hover:underline"
            >
              Criar key OpenAI <ExternalLink size={10} />
            </a>
          </div>
        </div>
      </div>

      {defaultMissingKey && (
        <div class="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-fg-muted">
          <AlertTriangle size={16} class="mt-0.5 shrink-0 text-warning" />
          <div class="flex-1 leading-relaxed">
            O provedor padrão (<strong class="text-fg">{defaultProvider === 'anthropic' ? 'Anthropic' : 'OpenAI'}</strong>)
            está sem API key. Cole a chave no card abaixo ou troque o provedor padrão para um que esteja configurado —
            sem chave, chatbot, análise e detecção de vendas não vão funcionar.
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            <span class="inline-flex items-center gap-2">
              <Brain size={16} class="text-fg-subtle" /> Provedor padrão
            </span>
          </CardTitle>
        </CardHeader>
        <Select
          label="Provedor padrão"
          value={defaultProvider}
          onChange={(e) => patch('ai.default_provider', (e.target as HTMLSelectElement).value)}
          hint="Define qual provedor de IA será usado primeiro para processar conversas"
        >
          <option value="anthropic">Anthropic (Claude)</option>
          <option value="openai">OpenAI (GPT)</option>
          <option value="none">Desativado</option>
        </Select>
      </Card>

      <ProviderCard
        provider="anthropic"
        label="Anthropic (Claude)"
        placeholder="sk-ant-..."
        hint="Crie em console.anthropic.com → API Keys"
        keyValue={draft['ai.anthropic_api_key'] ?? ''}
        onKeyChange={(v) => patch('ai.anthropic_api_key', v)}
        modelValue={draft['ai.anthropic_model'] ?? 'claude-sonnet-4-6'}
        onModelChange={(v) => patch('ai.anthropic_model', v)}
        models={ANTHROPIC_MODELS}
        onTest={() => handleTest('anthropic')}
        testing={testingProvider === 'anthropic' && testAi.isPending}
        testResult={testResults.anthropic}
        dirty={dirty}
        isDefault={defaultProvider === 'anthropic'}
        onSetDefault={() => activateProvider('anthropic')}
        activating={update.isPending}
      />

      <ProviderCard
        provider="openai"
        label="OpenAI (GPT)"
        placeholder="sk-..."
        hint="Crie em platform.openai.com → API Keys"
        keyValue={draft['ai.openai_api_key'] ?? ''}
        onKeyChange={(v) => patch('ai.openai_api_key', v)}
        modelValue={draft['ai.openai_model'] ?? 'gpt-4o-mini'}
        onModelChange={(v) => patch('ai.openai_model', v)}
        models={OPENAI_MODELS}
        onTest={() => handleTest('openai')}
        testing={testingProvider === 'openai' && testAi.isPending}
        testResult={testResults.openai}
        dirty={dirty}
        isDefault={defaultProvider === 'openai'}
        onSetDefault={() => activateProvider('openai')}
        activating={update.isPending}
      />

      <Card>
        <CardHeader>
          <CardTitle>
            <span class="inline-flex items-center gap-2">
              <Sliders size={16} class="text-fg-subtle" /> Parâmetros de geração
            </span>
          </CardTitle>
        </CardHeader>
        <div class="space-y-3">
          <DescribedSelect
            label="Temperatura (criatividade)"
            value={draft['ai.temperature'] ?? '0.7'}
            onChange={(v) => patch('ai.temperature', v)}
            options={TEMPERATURE_OPTS}
            fallback="Controla o quão criativa vs previsível a IA responde"
          />
          <DescribedSelect
            label="Tokens máximos do chat"
            value={draft['ai.chat_max_tokens'] ?? '800'}
            onChange={(v) => patch('ai.chat_max_tokens', v)}
            options={CHAT_TOKENS_OPTS}
            fallback="Define o tamanho máximo das respostas do chatbot"
          />
          <DescribedSelect
            label="Tokens máximos da análise"
            value={draft['ai.analysis_max_tokens'] ?? '1200'}
            onChange={(v) => patch('ai.analysis_max_tokens', v)}
            options={ANALYSIS_TOKENS_OPTS}
            fallback="Define o tamanho máximo do diagnóstico gerado pela IA"
          />
        </div>
      </Card>
    </div>
  )
}

function DescribedSelect({
  label, value, onChange, options, fallback,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: ModelOption[]
  fallback: string
}) {
  const cur = options.find((o) => o.id === String(value))
  return (
    <div>
      <Select
        label={label}
        value={value}
        onChange={(e) => onChange((e.target as HTMLSelectElement).value)}
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </Select>
      <div class="text-[0.6875rem] text-fg-subtle mt-1">{cur?.desc ?? fallback}</div>
    </div>
  )
}

function ProviderCard({
  label, placeholder, hint,
  keyValue, onKeyChange,
  modelValue, onModelChange, models,
  onTest, testing, testResult, dirty,
  isDefault, onSetDefault, activating,
}: {
  provider: ProviderId
  label: string
  placeholder: string
  hint: string
  keyValue: string
  onKeyChange: (v: string) => void
  modelValue: string
  onModelChange: (v: string) => void
  models: ModelOption[]
  onTest: () => void
  testing: boolean
  testResult: AiTestResult | null
  dirty: boolean
  isDefault: boolean
  onSetDefault: () => void
  activating: boolean
}) {
  const [revealed, setRevealed] = useState(false)
  const masked = maskKey(keyValue)
  const curModel = models.find((m) => m.id === modelValue)
  const trimmed = keyValue.trim()
  const configured = trimmed !== ''

  return (
    <Card class={isDefault ? 'border-success/60 ring-1 ring-success/30' : ''}>
      <CardHeader>
        <CardTitle>
          <span class="inline-flex flex-wrap items-center gap-2">
            {label}
            {isDefault && <Badge tone="accent">ATIVO</Badge>}
            {configured
              ? <Badge tone="info" solid>CONFIGURADO</Badge>
              : <Badge tone="neutral">SEM CHAVE</Badge>}
            {testResult && <AiTestBadge result={testResult} />}
          </span>
        </CardTitle>
        <div class="flex items-center gap-2">
          {!isDefault && (
            <Button size="sm" variant="secondary" onClick={onSetDefault} disabled={activating}>
              <Power size={12} /> Ativar como padrão
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            onClick={onTest}
            disabled={testing || !configured || dirty}
          >
            <Bot size={12} /> {testing ? 'Testando…' : 'Testar token'}
          </Button>
        </div>
      </CardHeader>
      <div class="space-y-3">
        <div>
          <div class="text-xs font-medium text-fg-muted mb-1">
            API key{isDefault && <span class="text-danger ml-0.5" aria-label="obrigatório">*</span>}
          </div>
          <div class="flex items-stretch gap-2">
            <input
              type={revealed ? 'text' : 'password'}
              value={keyValue}
              onInput={(e) => onKeyChange((e.target as HTMLInputElement).value)}
              placeholder={placeholder}
              class="flex-1 h-9 px-3 rounded-md bg-surface border border-border text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent"
            />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setRevealed((v) => !v)}
              aria-label={revealed ? 'Ocultar' : 'Mostrar'}
            >
              {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
              {revealed ? 'Ocultar' : 'Mostrar'}
            </Button>
          </div>
          <div class="text-[0.6875rem] text-fg-subtle mt-1">
            {keyValue
              ? <>Chave configurada: <span class="font-mono">{masked}</span></>
              : hint}
          </div>
        </div>

        <div>
          <Select
            label="Modelo"
            value={modelValue}
            onChange={(e) => onModelChange((e.target as HTMLSelectElement).value)}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </Select>
          <div class="text-[0.6875rem] text-fg-subtle mt-1">{curModel?.desc ?? ''}</div>
        </div>

        {testResult?.ok && (
          <div class="text-xs text-accent inline-flex items-center gap-1">
            <CheckCircle size={12} /> Token validado em {new Date(testResult.at).toLocaleString('pt-BR')}
          </div>
        )}
        {testResult && !testResult.ok && (
          <div class="text-xs text-danger inline-flex items-center gap-1">
            <AlertCircle size={12} /> {testResult.error ?? 'Falha ao testar token'}
          </div>
        )}
      </div>
    </Card>
  )
}

function AiTestBadge({ result }: { result: AiTestResult }) {
  const ago = formatAgo(result.at)
  if (result.ok) {
    return (
      <span
        class="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide text-fg-on-brand"
        title={`Verificado em ${new Date(result.at).toLocaleString('pt-BR')}`}
      >
        <CheckCircle size={10} /> Verificado {ago}
      </span>
    )
  }
  return (
    <span
      class="inline-flex items-center gap-1 rounded-md bg-danger px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide text-white"
      title={result.error ?? 'Falha no último teste'}
    >
      <AlertCircle size={10} /> Falhou {ago}
    </span>
  )
}

function stringifyValue(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v.replace(/^"|"$/g, '')
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  try { return JSON.stringify(v) } catch { return '' }
}

function loadAiTest(provider: ProviderId): AiTestResult | null {
  try {
    const raw = localStorage.getItem(AI_TEST_LS_PREFIX + provider)
    if (!raw) return null
    const parsed = JSON.parse(raw) as AiTestResult
    if (typeof parsed?.at !== 'number' || typeof parsed?.ok !== 'boolean') return null
    return parsed
  } catch {
    return null
  }
}

function saveAiTest(provider: ProviderId, r: AiTestResult) {
  try { localStorage.setItem(AI_TEST_LS_PREFIX + provider, JSON.stringify(r)) } catch { /* noop */ }
}

function clearAiTest(provider: ProviderId) {
  try { localStorage.removeItem(AI_TEST_LS_PREFIX + provider) } catch { /* noop */ }
}

function formatAgo(at: number): string {
  const diff = Math.max(0, Date.now() - at)
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return 'agora'
  const min = Math.floor(sec / 60)
  if (min < 60) return `há ${min}min`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `há ${hr}h`
  const day = Math.floor(hr / 24)
  return `há ${day}d`
}
