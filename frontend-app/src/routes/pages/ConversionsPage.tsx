import { useEffect, useMemo, useState } from 'preact/hooks'
import {
  Send, Settings, ListChecks, Activity, RefreshCw, Eye, EyeOff, AlertTriangle,
  CheckCircle, XCircle, Clock, Sparkles, X as XIcon, HelpCircle,
} from '@/components/ui/icon-set'
import { HowItWorksModal } from '@/components/ui/HowItWorksModal'
import {
  useCapiConfig,
  useUpdateCapiConfig,
  useTestCapiEvent,
  useRetryFailedConversions,
  useConversionEvents,
  useConversionStats,
  useLeadQualityConfig,
  useUpdateLeadQualityConfig,
  CAPI_EVENTS,
  type ConversionEvent,
  type ConversionEventStatus,
  type ConversionPlatform,
} from '@/hooks/useConversions'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { KpiCard } from '@/components/ui/KpiCard'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { Input, Select } from '@/components/ui/Input'
import { PeriodPicker, PeriodIncompleteHint, usePeriod, PRESET_LABELS } from '@/components/ui/PeriodPicker'
import { cn } from '@/lib/cn'
import { toast } from '@/lib/toast'

type Tab = 'config' | 'mapping' | 'events'

const intf = new Intl.NumberFormat('pt-BR')

export function ConversionsPage() {
  const [tab, setTab] = useState<Tab>('config')
  const [eventDetail, setEventDetail] = useState<ConversionEvent | null>(null)
  const [showHowItWorks, setShowHowItWorks] = useState(false)

  return (
    <Page
      title="Conversões Meta Ads"
      description="Envio server-side de eventos de conversão (CAPI) e feedback de qualidade pro Meta otimizar campanhas."
      actions={
        <Button variant="ghost" size="sm" onClick={() => setShowHowItWorks(true)}>
          <HelpCircle size={14} /> Como funciona?
        </Button>
      }
    >
      <div class="flex border-b border-border overflow-x-auto">
        {([
          { id: 'config', label: 'Configuração', Icon: Settings },
          { id: 'mapping', label: 'Mapeamento de etapas', Icon: ListChecks },
          { id: 'events', label: 'Eventos enviados', Icon: Activity },
        ] as const).map((t) => {
          const active = tab === t.id
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              class={cn(
                'h-10 px-4 text-sm flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap',
                active
                  ? 'border-info text-info font-semibold'
                  : 'border-transparent text-fg-muted hover:text-fg',
              )}
            >
              <t.Icon size={14} />
              {t.label}
            </button>
          )
        })}
      </div>

      {tab === 'config' && <ConfigTab />}
      {tab === 'mapping' && <MappingTab />}
      {tab === 'events' && <EventsTab onOpenDetail={setEventDetail} />}

      {eventDetail && (
        <EventDetailDrawer event={eventDetail} onClose={() => setEventDetail(null)} />
      )}

      <HowItWorksModal
        open={showHowItWorks}
        onClose={() => setShowHowItWorks(false)}
        title="Como funcionam as Conversões Meta Ads (CAPI)?"
        problem={<>
          O Meta otimiza o algoritmo de anúncios <strong>com base nas conversões que recebe</strong>.
          Hoje, ele vê quem clicou e quem virou lead — mas não sabe quem fechou venda offline ou
          no WhatsApp. CAPI (Conversions API) é o canal pra você <strong>devolver pro Meta</strong>{' '}
          quem foi cliente real, fechando o ciclo de aprendizado.
        </>}
        steps={[
          {
            title: '⚙️ Configure Pixel + Access Token',
            body: <>Aba <strong>Configuração</strong>: Pixel ID + Access Token do Meta (gerado em Eventos no Gerenciador de Anúncios). Salvar e testar — botão de envio test event aparece se quiser ver chegar lá.</>,
          },
          {
            title: '🗺️ Mapeie eventos do CRM ↔ Meta',
            body: <>Aba <strong>Mapeamento de etapas</strong>: lead virou Qualificado → manda <code>Lead</code> pro Meta; chegou em Proposta → <code>InitiateCheckout</code>; fechou → <code>Purchase</code>. Cada evento do Meta tem sua finalidade.</>,
          },
          {
            title: '🚀 Disparos automáticos',
            body: <>Toda vez que o lead atinge a etapa mapeada (won, qualified, payment), o sistema dispara o evento pro Meta. Inclui valor da venda quando aplicável (Purchase com value).</>,
          },
          {
            title: '🔍 Advanced Matching',
            body: <>O Meta combina o evento com o usuário usando hash do e-mail, telefone, FB Click ID, IP. Quanto mais dados, melhor o match. O sistema reconstrói <code>fbc</code> a partir do <code>ctwaClid</code> automaticamente.</>,
          },
          {
            title: '📊 Eventos enviados',
            body: <>Aba <strong>Eventos</strong>: histórico de cada envio com status (sucesso, falha, retry). Botão <strong>Reenviar falhas</strong> tenta de novo as conversões que não chegaram. Cron de retry roda a cada 10 min.</>,
          },
        ]}
        tip={{
          tone: 'warning',
          title: '⚠️ Cuidado pra não duplicar',
          body: <>Se você já tem Pixel no seu site enviando eventos via browser, o CAPI vai mandar de novo pelo servidor. <strong>Use o mesmo event_id</strong> nos dois lados — o Meta deduplifica. Sem isso, vai inflar suas conversões artificialmente.</>,
        }}
      />
    </Page>
  )
}

// ── Configuração ────────────────────────────────────────

function ConfigTab() {
  const { data, isLoading } = useCapiConfig()
  const update = useUpdateCapiConfig()
  const test = useTestCapiEvent()

  const [pixelId, setPixelId] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [testEventCode, setTestEventCode] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [tokenChanged, setTokenChanged] = useState(false)
  const [autoSendOnLeadWon, setAutoSendOnLeadWon] = useState(false)

  // Sync inicial quando a config carrega
  useEffect(() => {
    if (!data) return
    setPixelId(data.pixelId || '')
    setTestEventCode(data.testEventCode || '')
    setAutoSendOnLeadWon(!!(data as any).autoSendOnLeadWon)
  }, [data])

  function handleSave() {
    const payload: any = {
      pixelId: pixelId.trim(),
      testEventCode: testEventCode.trim(),
      autoSendOnLeadWon,
    }
    // Envia accessToken sempre que o usuário tiver digitado algo. O flag
    // tokenChanged controla apenas a UX de "Editar token existente"; pra
    // setup inicial (data.hasToken=false) ele fica falso e bloqueava o save.
    if (accessToken.trim()) payload.accessToken = accessToken.trim()
    update.mutate(payload, {
      onSuccess: () => {
        toast('Configuração salva', 'success')
        setAccessToken('')
        setTokenChanged(false)
      },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function handleTest() {
    test.mutate(undefined, {
      onSuccess: (r) => {
        if (r.ok) {
          const trace = r.response?.events_received ?? r.response?.fbtrace_id
          toast(`Evento de teste enviado · ${trace ? `trace: ${trace}` : 'OK'}`, 'success')
        } else {
          toast(`Falha: ${r.error || 'erro desconhecido'}`, 'danger')
        }
      },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <div class="space-y-4 max-w-2xl">
      <Card>
        <div class="space-y-3">
          <div>
            <h3 class="text-sm font-semibold text-fg mb-1 flex items-center gap-2">
              <Sparkles size={14} class="text-info" /> Meta Conversions API
            </h3>
            <p class="text-xs text-fg-muted">
              Envia eventos de conversão server-side para o Meta enriquecer a otimização das campanhas.
              Cada evento (Lead, Purchase, etc.) inclui dados do contato com hash SHA-256 conforme exige a Meta.
            </p>
          </div>

          {isLoading ? (
            <Skeleton class="h-32 w-full" />
          ) : (
            <>
              <Input
                label="Pixel ID"
                placeholder="Ex: 1234567890123456"
                value={pixelId}
                onInput={(e) => setPixelId((e.target as HTMLInputElement).value)}
              />

              <div class="space-y-1">
                <label class="text-xs font-medium text-fg-muted">Access Token (Conversions API)</label>
                {data?.hasToken && !tokenChanged ? (
                  <div class="flex items-center gap-2 px-3 h-9 rounded-md border border-border bg-surface-2 text-xs text-fg-muted">
                    <CheckCircle size={12} class="text-success" />
                    <span class="flex-1">Token configurado · clique em editar para substituir</span>
                    <button
                      type="button"
                      class="text-info hover:underline text-2xs"
                      onClick={() => setTokenChanged(true)}
                    >
                      Editar
                    </button>
                  </div>
                ) : (
                  <div class="flex items-stretch gap-2">
                    <input
                      type={showToken ? 'text' : 'password'}
                      class="flex-1 h-9 rounded-md border border-border bg-surface-2 px-3 text-sm text-fg focus:outline-none focus:border-info"
                      placeholder="EAAxxxxxxxxxx…"
                      value={accessToken}
                      onInput={(e) => setAccessToken((e.target as HTMLInputElement).value)}
                    />
                    <button
                      type="button"
                      class="size-9 grid place-items-center rounded-md border border-border bg-surface-2 text-fg-muted hover:bg-surface-3"
                      onClick={() => setShowToken((v) => !v)}
                      title={showToken ? 'Ocultar' : 'Mostrar'}
                    >
                      {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                    {data?.hasToken && (
                      <button
                        type="button"
                        class="px-3 h-9 rounded-md border border-border bg-surface-2 text-xs text-fg-muted hover:bg-surface-3"
                        onClick={() => { setTokenChanged(false); setAccessToken('') }}
                      >
                        Cancelar
                      </button>
                    )}
                  </div>
                )}
                <p class="text-2xs text-fg-muted">
                  Gerado em Meta Business Suite &gt; Configurações da conta &gt; Eventos do site &gt; Configurar &gt; Conversions API.
                </p>
              </div>

              <Input
                label="Test Event Code (opcional)"
                placeholder="Ex: TEST12345"
                value={testEventCode}
                onInput={(e) => setTestEventCode((e.target as HTMLInputElement).value)}
                hint="Eventos enviados aparecem em Test Events no Events Manager. Deixe vazio em produção."
              />

              <label class="flex items-start gap-2 p-3 rounded-md border border-border bg-surface-2/40 cursor-pointer">
                <input
                  type="checkbox"
                  class="mt-0.5"
                  checked={autoSendOnLeadWon}
                  onChange={(e) => setAutoSendOnLeadWon((e.target as HTMLInputElement).checked)}
                />
                <span class="text-xs">
                  <span class="block font-medium text-fg">Enviar Purchase ao marcar lead como Ganho</span>
                  <span class="block text-fg-muted mt-0.5">
                    Quando ativado, classificar um lead como Ganho dispara automaticamente o evento <code>Purchase</code> no CAPI (com dedup pelo lead). O mapeamento por etapa continua funcionando em paralelo.
                  </span>
                </span>
              </label>

              <div class="flex flex-wrap gap-2 pt-2">
                <Button variant="primary" size="sm" disabled={update.isPending} onClick={handleSave}>
                  {update.isPending ? 'Salvando…' : 'Salvar configuração'}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={test.isPending || !data?.configured}
                  onClick={handleTest}
                >
                  <Sparkles size={12} /> {test.isPending ? 'Enviando…' : 'Enviar evento de teste'}
                </Button>
                {!data?.configured && (
                  <span class="text-xs text-warning flex items-center gap-1">
                    <AlertTriangle size={12} /> Configure pixel + token antes de testar
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </Card>

      <Card class="text-xs text-fg-muted">
        <h4 class="text-sm font-semibold text-fg mb-2">Como funciona</h4>
        <ul class="list-disc pl-4 space-y-1">
          <li>Quando um lead muda de etapa do funil mapeada, o sistema dispara o evento CAPI correspondente automaticamente.</li>
          <li>Eventos importantes (Lead qualificado, Venda confirmada, Chatbot completo, Inscrição) também disparam automaticamente.</li>
          <li>Falhas ficam com status <code>failed</code> e são reprocessadas automaticamente a cada 10 min (até 3 tentativas).</li>
          <li>Cada envio é persistido em <code>ConversionEvent</code> com o ID do evento (dedup com pixel browser).</li>
        </ul>
      </Card>

      <LeadQualityCard />
    </div>
  )
}

// ── Lead Ads Quality Feedback ────────────────────────────

function LeadQualityCard() {
  const { data, isLoading } = useLeadQualityConfig()
  const update = useUpdateLeadQualityConfig()

  function handleToggle() {
    if (!data) return
    update.mutate({ enabled: !data.enabled }, {
      onSuccess: (r) => toast(r.enabled ? 'Lead Quality Feedback ativado' : 'Desativado', 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <Card class="space-y-3">
      <div class="flex items-start justify-between gap-3 flex-wrap">
        <div class="min-w-0 flex-1">
          <h4 class="text-sm font-semibold text-fg flex items-center gap-2">
            <Sparkles size={14} class="text-info" /> Meta Lead Ads — Quality Feedback
          </h4>
          <p class="text-xs text-fg-muted mt-1 leading-relaxed">
            Devolve ao Meta a qualidade dos leads vindos de formulários Lead Ads. Funciona
            <strong class="text-fg"> só para leads que entraram via formulário Meta</strong> (Facebook/Instagram).
            Ajuda a otimização de campanhas — Meta busca perfis parecidos com quem virou <code>CONVERTED</code>
            e exclui parecidos com <code>INVALID</code>.
          </p>
        </div>
        <Badge tone={data?.enabled ? 'accent' : 'neutral'}>
          {isLoading ? '...' : data?.enabled ? 'Ativo' : 'Desativado'}
        </Badge>
      </div>

      <div class="rounded-md border border-border bg-surface-2/40 p-3 text-2xs text-fg-muted space-y-1">
        <div class="font-medium text-fg mb-1">Disparos automáticos quando ativo:</div>
        <ul class="list-disc pl-4 space-y-0.5">
          <li><strong class="text-fg">INTERESTED</strong> — quando o lead vira qualificado</li>
          <li><strong class="text-fg">CONVERTED</strong> — quando o lead é marcado como Ganho</li>
          <li><strong class="text-fg">INVALID</strong> — quando o lead é marcado como Perdido com motivo de spam/fake/duplicado</li>
          <li><strong class="text-fg">NOT_INTERESTED</strong> — quando o lead é marcado como Perdido com outros motivos</li>
        </ul>
      </div>

      {data && (
        <div class="grid grid-cols-2 gap-3 text-xs">
          <div class="rounded-md border border-border bg-surface-2/40 p-3">
            <div class="text-2xs uppercase tracking-wider text-fg-muted">Enviados (30d)</div>
            <div class="text-xl font-semibold text-accent tabular-nums mt-0.5">{data.stats.sent}</div>
          </div>
          <div class="rounded-md border border-border bg-surface-2/40 p-3">
            <div class="text-2xs uppercase tracking-wider text-fg-muted">Falhas (30d)</div>
            <div class={`text-xl font-semibold tabular-nums mt-0.5 ${data.stats.failed > 0 ? 'text-danger' : 'text-fg-muted'}`}>
              {data.stats.failed}
            </div>
          </div>
        </div>
      )}

      <div class="flex flex-wrap gap-2 pt-1">
        <Button variant="primary" size="sm" disabled={update.isPending || isLoading} onClick={handleToggle}>
          {update.isPending ? 'Salvando…' : data?.enabled ? 'Desativar feedback' : 'Ativar feedback'}
        </Button>
      </div>

      {data && data.recent.length > 0 && (
        <details class="text-xs">
          <summary class="cursor-pointer text-fg-muted hover:text-fg">Últimos envios ({data.recent.length})</summary>
          <ul class="mt-2 divide-y divide-border rounded-md border border-border overflow-hidden">
            {data.recent.map((r) => (
              <li key={r.id} class="px-3 py-2 flex items-center gap-3 text-2xs">
                {r.status === 'quality_feedback_sent' ? (
                  <CheckCircle size={12} class="text-accent shrink-0" />
                ) : (
                  <XCircle size={12} class="text-danger shrink-0" />
                )}
                <span class="font-mono text-fg-muted shrink-0">#{r.leadId ?? '?'}</span>
                <span class="flex-1 truncate text-fg">{r.errorMessage}</span>
                <span class="text-fg-muted shrink-0">{new Date(r.createdAt).toLocaleString('pt-BR')}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  )
}

// ── Mapeamento de etapas ────────────────────────────────

// Hints traduzidos: o sistema procura essas palavras-chave (PT-BR/EN) no nome
// ou key da etapa pra sugerir o evento Meta correspondente. Mais palavras = mais
// etapas customizadas vão receber sugestão automática (ex.: "Convocado", "Prova").
const DEFAULT_STAGE_HINTS: Record<string, string> = {
  // Início de funil → Lead
  NOVO: 'Lead',
  LEAD: 'Lead',
  QUALIFICADO: 'Lead',
  // Contato / atendimento → Contact
  CONTATO: 'Contact',
  ATENDIMENTO: 'Contact',
  // Reunião / agendamento → Schedule
  AGENDADO: 'Schedule',
  AGENDAMENTO: 'Schedule',
  REUNIAO: 'Schedule',
  REUNIÃO: 'Schedule',
  CONVOCADO: 'Schedule',
  CONVOCAÇÃO: 'Schedule',
  // Cadastro → CompleteRegistration
  CADASTRO: 'CompleteRegistration',
  REGISTRO: 'CompleteRegistration',
  // Inscrição (form longo / processo seletivo) → SubmitApplication
  INSCRICAO: 'SubmitApplication',
  INSCRIÇÃO: 'SubmitApplication',
  CANDIDATURA: 'SubmitApplication',
  PROVA: 'SubmitApplication',
  // Trial → StartTrial
  TRIAL: 'StartTrial',
  TESTE: 'StartTrial',
  EXPERIMENTAL: 'StartTrial',
  // Checkout / proposta → InitiateCheckout
  PROPOSTA: 'InitiateCheckout',
  CHECKOUT: 'InitiateCheckout',
  PAGAMENTO: 'InitiateCheckout',
  BOLETO: 'InitiateCheckout',
  // Matrícula / assinatura → Subscribe
  INSCRITO: 'Subscribe',
  MATRICULADO: 'Subscribe',
  MATRICULA: 'Subscribe',
  MATRÍCULA: 'Subscribe',
  ASSINATURA: 'Subscribe',
  // Venda final → Purchase
  GANHO: 'Purchase',
  CONVERTIDO: 'Purchase',
  VENDA: 'Purchase',
  FECHADO: 'Purchase',
  PAGO: 'Purchase',
  APROVADO: 'Purchase',
}

function suggestEvent(stageName: string, stageKey: string): string | null {
  const upperName = stageName.toUpperCase()
  const upperKey = stageKey.toUpperCase()
  for (const [hint, evt] of Object.entries(DEFAULT_STAGE_HINTS)) {
    if (upperName.includes(hint) || upperKey.includes(hint)) return evt
  }
  return null
}

function MappingTab() {
  const { data, isLoading, refetch, isFetching } = useCapiConfig()
  const update = useUpdateCapiConfig()
  const [mappings, setMappings] = useState<Record<string, string>>({})

  useEffect(() => {
    if (data) setMappings(data.stageMappings || {})
  }, [data])

  function setMapping(stageKey: string, eventName: string) {
    setMappings((m) => {
      const next = { ...m }
      if (eventName) next[stageKey] = eventName
      else delete next[stageKey]
      return next
    })
  }

  function applySuggestions() {
    const allFunnelStages = (data?.funnels ?? []).flatMap((f) => f.stages)
    setMappings((m) => {
      const next = { ...m }
      for (const s of allFunnelStages) {
        if (next[s.key]) continue // não sobrescreve o que admin já definiu
        const sug = suggestEvent(s.name, s.key)
        if (sug) next[s.key] = sug
      }
      return next
    })
  }

  function handleSave() {
    update.mutate({ stageMappings: mappings }, {
      onSuccess: () => toast('Mapeamento salvo', 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  const dirty = useMemo(() => {
    if (!data) return false
    return JSON.stringify(mappings) !== JSON.stringify(data.stageMappings || {})
  }, [mappings, data])

  function handleRefresh() {
    refetch().then((r) => {
      const total = r.data?.funnels.reduce((s, f) => s + f.stages.length, 0) ?? 0
      const funnels = r.data?.funnels.length ?? 0
      toast(`${funnels} funil(is) · ${total} etapa(s) carregadas`, 'success')
    }).catch((e: unknown) => toast((e as Error).message, 'danger'))
  }

  return (
    <div class="space-y-4">
      <Card class="flex items-center justify-between gap-3 text-xs text-fg-muted">
        <span class="flex-1">
          Quando um lead chega numa etapa abaixo, o evento CAPI mapeado é disparado para o Meta. Use isso para informar à
          plataforma quando um lead vira qualificado, agenda, fecha venda etc. Etapas sem mapeamento são ignoradas.
          {' '}<span class="text-fg-muted">Os nomes técnicos em inglês após o "·" são exigidos pelo Meta — escolha o que mais se aproxima da sua etapa.</span>
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRefresh}
          disabled={isFetching}
          title="Recarregar funis e etapas (use após criar/editar funil)"
        >
          <RefreshCw size={12} class={isFetching ? 'animate-spin' : ''} />
          {isFetching ? 'Atualizando…' : 'Atualizar funis'}
        </Button>
      </Card>

      {isLoading && <Skeleton class="h-40 w-full" />}

      {!isLoading && data && data.funnels.length === 0 && (
        <Card>
          <EmptyState
            icon={<ListChecks size={20} />}
            title="Nenhum funil ativo"
            description="Cadastre um funil em Configurações > Funis para mapear suas etapas."
          />
        </Card>
      )}

      {!isLoading && data && data.funnels.map((f) => (
        <Card key={f.id} class="p-0 overflow-hidden">
          <div class="p-3 border-b border-border flex items-center justify-between">
            <h4 class="text-sm font-semibold text-fg">{f.name}</h4>
            <span class="text-2xs text-fg-muted">{f.stages.length} etapas</span>
          </div>
          <div class="divide-y divide-border">
            {f.stages.map((s) => {
              const selected = mappings[s.key]
              const evtMeta = selected ? CAPI_EVENTS.find((e) => e.value === selected) : null
              return (
                <div key={s.key} class="flex items-start gap-3 px-3 py-2.5 hover:bg-surface-2">
                  <div class="flex-1 min-w-0">
                    <div class="text-sm text-fg">{s.name}</div>
                    <div class="text-3xs text-fg-muted font-mono truncate">{s.key}</div>
                    {evtMeta && (
                      <div class="text-2xs text-fg-muted mt-1 leading-relaxed">{evtMeta.description}</div>
                    )}
                  </div>
                  <Select
                    value={mappings[s.key] ?? ''}
                    onChange={(e) => setMapping(s.key, (e.target as HTMLSelectElement).value)}
                    class="w-72 shrink-0"
                  >
                    <option value="">— não disparar —</option>
                    {CAPI_EVENTS.map((evt) => (
                      <option key={evt.value} value={evt.value}>{evt.label}</option>
                    ))}
                  </Select>
                </div>
              )
            })}
          </div>
        </Card>
      ))}

      {!isLoading && data && data.funnels.length > 0 && (
        <div class="flex flex-wrap gap-2">
          <Button variant="primary" size="sm" disabled={!dirty || update.isPending} onClick={handleSave}>
            {update.isPending ? 'Salvando…' : dirty ? 'Salvar mapeamento' : 'Tudo salvo'}
          </Button>
          <Button variant="secondary" size="sm" onClick={applySuggestions}>
            <Sparkles size={12} /> Sugerir mapeamento padrão
          </Button>
        </div>
      )}
    </div>
  )
}

// ── Eventos enviados ────────────────────────────────────

function EventsTab({ onOpenDetail }: { onOpenDetail: (e: ConversionEvent) => void }) {
  const { range, preset, customFrom, customTo, setPreset, setCustom } = usePeriod('conversions')
  const [platform, setPlatform] = useState<ConversionPlatform | ''>('')
  const [status, setStatus] = useState<ConversionEventStatus | ''>('')

  const stats = useConversionStats(range)
  const events = useConversionEvents({
    from: range.dateFrom,
    to: range.dateTo,
    ...(platform ? { platform: platform as ConversionPlatform } : {}),
    ...(status ? { status: status as ConversionEventStatus } : {}),
    limit: 100,
  })
  const retry = useRetryFailedConversions()

  return (
    <div class="space-y-4">
      <section class="grid gap-3 grid-cols-2 sm:grid-cols-4">
        <KpiCard
          label="Total de eventos"
          value={stats.data?.overview.total ?? '—'}
          loading={stats.isLoading}
          icon={<Activity size={16} />}
        />
        <KpiCard
          label="Enviados"
          value={stats.data?.overview.sent ?? '—'}
          loading={stats.isLoading}
          icon={<CheckCircle size={16} />}
        />
        <KpiCard
          label="Falharam"
          value={stats.data?.overview.failed ?? '—'}
          loading={stats.isLoading}
          icon={<XCircle size={16} />}
          hint={stats.data && stats.data.overview.failed > 0 ? 'Reprocessam a cada 10min' : undefined}
        />
        <KpiCard
          label="Pendentes"
          value={stats.data?.overview.pending ?? '—'}
          loading={stats.isLoading}
          icon={<Clock size={16} />}
        />
      </section>

      <Card>
        <div class="flex flex-col gap-1 mb-3">
          <span class="text-xs font-medium text-fg-muted">Período</span>
          <PeriodPicker preset={preset} customFrom={customFrom} customTo={customTo} onPreset={setPreset} onCustom={setCustom} />
          <PeriodIncompleteHint show={range.incomplete} />
        </div>
        <div class="grid gap-3 sm:grid-cols-3 items-end">
          <div class="flex flex-col gap-1">
            <span class="text-xs font-medium text-fg-muted">Plataforma</span>
            <Select value={platform} onChange={(e) => setPlatform((e.target as HTMLSelectElement).value as any)}>
              <option value="">Todas</option>
              <option value="meta_capi">Meta CAPI</option>
              <option value="google_ads">Google Ads</option>
            </Select>
          </div>
          <div class="flex flex-col gap-1">
            <span class="text-xs font-medium text-fg-muted">Status</span>
            <Select value={status} onChange={(e) => setStatus((e.target as HTMLSelectElement).value as any)}>
              <option value="">Todos</option>
              <option value="sent">Enviado</option>
              <option value="failed">Falhou</option>
              <option value="pending">Pendente</option>
              <option value="skipped">Ignorado</option>
            </Select>
          </div>
          <Button
            variant="secondary"
            size="sm"
            disabled={retry.isPending}
            onClick={() => retry.mutate(undefined, {
              onSuccess: (r) => toast(`${r.retried} eventos reprocessados`, 'success'),
              onError: (e: unknown) => toast((e as Error).message, 'danger'),
            })}
          >
            <RefreshCw size={12} class={retry.isPending ? 'animate-spin' : ''} />
            {retry.isPending ? 'Processando…' : 'Reprocessar falhados'}
          </Button>
        </div>
      </Card>

      {stats.data && stats.data.byEvent.length > 0 && (
        <Card class="p-0 overflow-hidden">
          <div class="p-3 border-b border-border">
            <h4 class="text-sm font-semibold text-fg">Por evento ({PRESET_LABELS[preset]})</h4>
          </div>
          <table class="w-full text-sm">
            <thead class="bg-surface-3 text-fg-muted text-2xs uppercase tracking-wider">
              <tr>
                <th class="text-left px-3 py-2 font-medium">Evento</th>
                <th class="text-left px-3 py-2 font-medium">Plataforma</th>
                <th class="text-right px-3 py-2 font-medium">Total</th>
                <th class="text-right px-3 py-2 font-medium">Enviados</th>
                <th class="text-right px-3 py-2 font-medium">Falhas</th>
                <th class="text-right px-3 py-2 font-medium">Taxa</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-border">
              {stats.data.byEvent.map((e, i) => {
                const rate = e.count > 0 ? (e.sent / e.count) * 100 : 0
                return (
                  <tr key={i}>
                    <td class="px-3 py-2 text-xs text-fg font-medium">{e.eventName}</td>
                    <td class="px-3 py-2 text-xs text-fg-muted">{e.platform}</td>
                    <td class="px-3 py-2 text-xs text-fg text-right tabular-nums">{intf.format(e.count)}</td>
                    <td class="px-3 py-2 text-xs text-success text-right tabular-nums">{intf.format(e.sent)}</td>
                    <td class="px-3 py-2 text-xs text-danger text-right tabular-nums">{intf.format(e.failed)}</td>
                    <td class="px-3 py-2 text-xs text-right tabular-nums">{rate.toFixed(0)}%</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}

      <Card class="p-0 overflow-hidden">
        <div class="p-3 border-b border-border">
          <h4 class="text-sm font-semibold text-fg">Histórico</h4>
        </div>
        {events.isLoading && (
          <div class="p-4 flex flex-col gap-2">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} class="h-10 w-full" />)}
          </div>
        )}
        {!events.isLoading && events.data && events.data.events.length === 0 && (
          <EmptyState
            icon={<Send size={20} />}
            title="Nenhum evento no filtro"
            description={!stats.data?.overview.total ? 'Configure CAPI e mapeie etapas para começar a enviar.' : undefined}
          />
        )}
        {!events.isLoading && events.data && events.data.events.length > 0 && (
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="bg-surface-3 text-fg-muted text-2xs uppercase tracking-wider">
                <tr>
                  <th class="text-left px-3 py-2 font-medium">Evento</th>
                  <th class="text-left px-3 py-2 font-medium">Lead</th>
                  <th class="text-left px-3 py-2 font-medium">Plataforma</th>
                  <th class="text-left px-3 py-2 font-medium w-24">Status</th>
                  <th class="text-right px-3 py-2 font-medium">Valor</th>
                  <th class="text-right px-3 py-2 font-medium w-44">Enviado em</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-border">
                {events.data.events.map((e) => (
                  <tr key={e.id} class="hover:bg-surface-3 cursor-pointer" onClick={() => onOpenDetail(e)}>
                    <td class="px-3 py-2 text-xs text-fg font-medium">{e.eventName}</td>
                    <td class="px-3 py-2 text-xs">
                      <a href={`/app/leads/${e.leadId}`} class="text-info hover:underline" onClick={(ev) => ev.stopPropagation()}>
                        #{e.leadId}
                      </a>
                    </td>
                    <td class="px-3 py-2 text-xs text-fg-muted">{e.platform}</td>
                    <td class="px-3 py-2"><EventStatusBadge status={e.status} /></td>
                    <td class="px-3 py-2 text-xs text-right tabular-nums">
                      {e.value != null && Number(e.value) > 0 ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: e.currency || 'BRL' }).format(Number(e.value)) : '–'}
                    </td>
                    <td class="px-3 py-2 text-xs text-fg-muted text-right">
                      {e.sentAt ? new Date(e.sentAt).toLocaleString('pt-BR') : new Date(e.createdAt).toLocaleString('pt-BR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

function EventStatusBadge({ status }: { status: ConversionEventStatus }) {
  if (status === 'sent') return <Badge tone="success">enviado</Badge>
  if (status === 'failed') return <Badge tone="danger">falhou</Badge>
  if (status === 'pending') return <Badge tone="warning">pendente</Badge>
  return <Badge tone="info">{status}</Badge>
}

// ── Drawer detalhe ─────────────────────────────────────

function EventDetailDrawer({ event, onClose }: { event: ConversionEvent; onClose: () => void }) {
  useEffect(() => {
    function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onEsc)
    return () => document.removeEventListener('keydown', onEsc)
  }, [onClose])

  return (
    <div class="fixed inset-0 z-40">
      <div class="absolute inset-0 bg-black/50" onClick={onClose} />
      <div class="absolute right-0 top-0 bottom-0 w-full max-w-xl bg-surface-2 border-l border-border overflow-y-auto">
        <div class="sticky top-0 bg-surface-2 border-b border-border p-4 flex items-center gap-2 z-10">
          <h3 class="text-sm font-semibold text-fg flex-1">{event.eventName} · #{event.id}</h3>
          <Button variant="ghost" size="sm" onClick={onClose}><XIcon size={14} /></Button>
        </div>
        <div class="p-4 space-y-4">
          <div class="flex flex-wrap gap-2 items-center">
            <EventStatusBadge status={event.status} />
            <Badge tone="info">{event.platform}</Badge>
            {event.retries > 0 && <Badge tone="warning">{event.retries} tentativas</Badge>}
          </div>
          <Row label="Lead" value={<a href={`/app/leads/${event.leadId}`} class="text-info hover:underline">#{event.leadId}</a>} />
          {event.funnelStage && <Row label="Etapa do funil" value={event.funnelStage} />}
          {event.value != null && Number(event.value) > 0 && (
            <Row label="Valor" value={new Intl.NumberFormat('pt-BR', { style: 'currency', currency: event.currency || 'BRL' }).format(Number(event.value))} />
          )}
          <Row label="Event ID" value={<code class="font-mono text-2xs">{event.eventId}</code>} />
          {event.pixelId && <Row label="Pixel ID" value={<code class="font-mono text-2xs">{event.pixelId}</code>} />}
          {event.gclid && <Row label="GCLID" value={<code class="font-mono text-2xs">{event.gclid}</code>} />}
          {event.fbclid && <Row label="FBCLID" value={<code class="font-mono text-2xs">{event.fbclid}</code>} />}

          <div class="space-y-1">
            <h4 class="text-xs font-semibold text-fg-muted uppercase">Timeline</h4>
            <div class="space-y-1 text-xs">
              <TimelineRow label="Criado" at={event.createdAt} />
              <TimelineRow label="Enviado" at={event.sentAt} done={event.status === 'sent'} fail={event.status === 'failed'} />
            </div>
          </div>

          {event.errorMessage && (
            <div>
              <h4 class="text-xs font-semibold text-danger uppercase mb-1">Erro</h4>
              <pre class="text-2xs bg-danger/10 text-danger p-2 rounded overflow-x-auto whitespace-pre-wrap">{event.errorMessage}</pre>
            </div>
          )}

          {event.response && (
            <div>
              <h4 class="text-xs font-semibold text-fg-muted uppercase mb-1">Resposta da API</h4>
              <pre class="text-2xs bg-surface-3 p-2 rounded overflow-x-auto">{JSON.stringify(event.response, null, 2)}</pre>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: any }) {
  return (
    <div class="flex items-center gap-2 text-xs">
      <span class="text-fg-muted w-28 shrink-0">{label}:</span>
      <span class="text-fg flex-1 break-words">{value}</span>
    </div>
  )
}

function TimelineRow({ label, at, done = false, fail = false }: { label: string; at: string | null; done?: boolean; fail?: boolean }) {
  return (
    <div class="flex min-w-0 flex-wrap items-center gap-2">
      <span class={cn(
        'size-1.5 rounded-full',
        fail ? 'bg-danger' : done ? 'bg-success' : at ? 'bg-info' : 'bg-fg-muted/30',
      )} />
      <span class={cn('w-24', at ? 'text-fg' : 'text-fg-muted')}>{label}</span>
      <span class="text-fg-muted">{at ? new Date(at).toLocaleString('pt-BR') : '—'}</span>
    </div>
  )
}
