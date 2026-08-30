import { useState, useMemo, useEffect } from 'preact/hooks'
import {
  Sparkles, Target, Users, MessageSquare, ChevronLeft, ChevronRight, Loader2,
  Mail, Phone, Briefcase, Smartphone, ListChecks, RefreshCw, Save,
  Zap, Check, Edit2, X as XIcon, ArrowRight, Wand2, Clock,
} from '@/components/ui/icon-set'
import { useLocation } from 'wouter-preact'
import {
  useAiCadenceGenerate,
  useAiCadenceCommit,
  type AiCadenceGenerateInput,
  type AiCadenceGoal,
  type AiCadenceTone,
  type AiCadenceDuration,
  type AiCadenceIntensity,
  type AiCadenceChannel,
  type GeneratedCadence,
  type GeneratedStep,
} from '@/hooks/useSalesCadences'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { Badge } from '@/components/ui/Badge'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/cn'

interface Props {
  open: boolean
  onClose: () => void
  /** se quiser pré-selecionar a equipe da cadência */
  teamId?: number | null
}

// ─── Catálogos visuais (chips/cards do wizard) ─────────────────────

const GOALS: { id: AiCadenceGoal; label: string; description: string; icon: typeof Target }[] = [
  { id: 'prospect',           label: 'Prospecção fria',     description: 'Abrir conversa com lead novo, sem contato prévio', icon: Target },
  { id: 'follow_up_warm',     label: 'Retomada morna',      description: 'Lead que demonstrou interesse mas não respondeu', icon: Sparkles },
  { id: 'reactivate_dormant', label: 'Reativar lead antigo', description: 'Sem resposta há semanas/meses',                  icon: RefreshCw },
  { id: 'qualify_inbound',    label: 'Qualificar entrada',  description: 'Lead chegou pelo site, qualificar e marcar reunião', icon: Zap },
  { id: 'book_meeting',       label: 'Agendar reunião',     description: 'Foco único: marcar reunião de descoberta',      icon: Clock },
  { id: 'post_demo',          label: 'Pós-demonstração',    description: 'Manter o ritmo após reunião sem fechamento',    icon: ArrowRight },
  { id: 'reengage_no_show',   label: 'Não compareceu',      description: 'Lead furou a reunião — reengajar com cuidado',  icon: RefreshCw },
  { id: 'event_invite',       label: 'Convidar p/ evento',  description: 'Webinar, workshop, conteúdo exclusivo',         icon: Users },
  { id: 'breakup',            label: 'Despedida',           description: 'Última cartada antes de descartar o lead',      icon: XIcon },
  { id: 'custom',             label: 'Personalizado',       description: 'Descreva o objetivo livremente',                icon: Wand2 },
]

const TONES: { id: AiCadenceTone; label: string; hint: string }[] = [
  { id: 'consultative', label: 'Consultivo',  hint: 'Perguntas abertas, foco em diagnóstico' },
  { id: 'direct',       label: 'Direto',      hint: 'Vai ao ponto, sem rodeios' },
  { id: 'friendly',     label: 'Amigável',    hint: 'Linguagem informal, próximo' },
  { id: 'formal',       label: 'Formal',      hint: 'Postura executiva, B2B sênior' },
  { id: 'urgent',       label: 'Urgente',     hint: 'Cria escassez, deadline' },
]

const CHANNELS: { id: AiCadenceChannel; label: string; icon: typeof Mail; color: string; bg: string }[] = [
  { id: 'whatsapp', label: 'WhatsApp', icon: MessageSquare, color: '#25d366', bg: '#e7faf0' },
  { id: 'email',    label: 'E-mail',   icon: Mail,          color: '#ea4335', bg: '#fce8e6' },
  { id: 'sms',      label: 'SMS',      icon: Smartphone,    color: '#fbbc04', bg: '#fef7e0' },
  { id: 'call',     label: 'Ligação',  icon: Phone,         color: '#1a73e8', bg: '#e8f0fe' },
  { id: 'linkedin', label: 'LinkedIn', icon: Briefcase,     color: '#0a66c2', bg: '#e7f0fa' },
  { id: 'manual',   label: 'Manual',   icon: ListChecks,    color: '#5f6368', bg: '#f1f3f4' },
]

const DURATIONS: { id: AiCadenceDuration; label: string; hint: string }[] = [
  { id: 'short',  label: 'Curta',  hint: '5-7 dias · 5-7 passos' },
  { id: 'medium', label: 'Média',  hint: '10-14 dias · 8-12 passos' },
  { id: 'long',   label: 'Longa',  hint: '21-30 dias · 12-18 passos' },
]

const INTENSITIES: { id: AiCadenceIntensity; label: string; hint: string }[] = [
  { id: 'light',      label: 'Suave',     hint: '2-3 passos/semana' },
  { id: 'moderate',   label: 'Moderado',  hint: '4-5 passos/semana' },
  { id: 'aggressive', label: 'Agressivo', hint: '6-8 passos/semana, em vários canais' },
]

// ─── Wizard ───────────────────────────────────────────────────────

type Step = 'goal' | 'audience' | 'tone' | 'preview'

const STEP_ORDER: Step[] = ['goal', 'audience', 'tone', 'preview']
const STEP_LABEL: Record<Step, string> = {
  goal:     'Objetivo',
  audience: 'Público & Oferta',
  tone:     'Tom & Canais',
  preview:  'Revisar & Salvar',
}

export function AiCadenceWizard({ open, onClose, teamId }: Props) {
  const [, navigate] = useLocation()
  const [step, setStep] = useState<Step>('goal')

  // Estado do wizard
  const [goal, setGoal] = useState<AiCadenceGoal>('prospect')
  const [customGoal, setCustomGoal] = useState('')
  const [industry, setIndustry] = useState('')
  const [targetRole, setTargetRole] = useState('')
  const [painPoints, setPainPoints] = useState('')
  const [productName, setProductName] = useState('')
  const [valueProp, setValueProp] = useState('')
  const [tone, setTone] = useState<AiCadenceTone>('consultative')
  const [channels, setChannels] = useState<Set<AiCadenceChannel>>(new Set(['whatsapp', 'email']))
  const [duration, setDuration] = useState<AiCadenceDuration>('medium')
  const [intensity, setIntensity] = useState<AiCadenceIntensity>('moderate')
  const [includeBreakup, setIncludeBreakup] = useState(true)

  // Resultado da IA
  const [generated, setGenerated] = useState<GeneratedCadence | null>(null)
  const [meta, setMeta] = useState<{ inputTokens: number; outputTokens: number; costUsd: number; provider: string; model: string } | null>(null)
  const [refineText, setRefineText] = useState('')

  const generate = useAiCadenceGenerate()
  const commit = useAiCadenceCommit()

  // Reset ao fechar
  useEffect(() => {
    if (!open) {
      setStep('goal')
      setGenerated(null)
      setMeta(null)
      setRefineText('')
    }
  }, [open])

  function toggleChannel(c: AiCadenceChannel) {
    setChannels((prev) => {
      const next = new Set(prev)
      if (next.has(c)) next.delete(c); else next.add(c)
      return next
    })
  }

  function buildInput(): AiCadenceGenerateInput {
    return {
      goal,
      ...(goal === 'custom' && customGoal.trim() ? { customGoalDescription: customGoal.trim() } : {}),
      audience: {
        ...(industry.trim()    ? { industry:    industry.trim()    } : {}),
        ...(targetRole.trim()  ? { targetRole:  targetRole.trim()  } : {}),
        ...(painPoints.trim()  ? { painPoints:  painPoints.trim()  } : {}),
      },
      offer: {
        ...(productName.trim() ? { productName: productName.trim() } : {}),
        ...(valueProp.trim()   ? { valueProp:   valueProp.trim()   } : {}),
      },
      tone,
      channels: Array.from(channels),
      duration,
      intensity,
      language: 'pt-BR',
      includeBreakup,
    }
  }

  async function handleGenerate() {
    if (channels.size === 0) {
      toast('Selecione ao menos um canal.', 'warning')
      return
    }
    setStep('preview')
    setGenerated(null)
    setMeta(null)
    generate.mutate(buildInput(), {
      onSuccess: (r) => {
        setGenerated({ cadence: r.cadence, steps: r.steps, reasoning: r.reasoning })
        setMeta({ inputTokens: r.inputTokens, outputTokens: r.outputTokens, costUsd: r.costUsd, provider: r.provider, model: r.model })
      },
      onError: (e: unknown) => {
        toast((e as Error).message, 'danger')
        setStep('tone') // volta pro último passo pra ajustar
      },
    })
  }

  async function handleRefine() {
    if (!generated) return
    const instruction = refineText.trim()
    if (!instruction) {
      toast('Diga o que quer ajustar (ex.: "mais agressivo", "tom mais consultivo", "encurte para 5 passos").', 'warning')
      return
    }
    generate.mutate(
      { ...buildInput(), refineFrom: generated, refineInstruction: instruction },
      {
        onSuccess: (r) => {
          setGenerated({ cadence: r.cadence, steps: r.steps, reasoning: r.reasoning })
          setMeta({ inputTokens: r.inputTokens, outputTokens: r.outputTokens, costUsd: r.costUsd, provider: r.provider, model: r.model })
          setRefineText('')
          toast('Cadência refinada', 'success')
        },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      },
    )
  }

  function handleCommit(status: 'draft' | 'active') {
    if (!generated) return
    commit.mutate(
      { generated, status, teamId: teamId ?? null },
      {
        onSuccess: (cad) => {
          toast(status === 'draft' ? 'Cadência criada como rascunho' : 'Cadência criada e ativada', 'success')
          onClose()
          // Builder Visual (Fase 26): cai direto no canvas pra revisar/refinar
          // visualmente os steps gerados pela IA. As métricas continuam a 1
          // clique de distância (botão Métricas no header do builder).
          navigate(`/sales-cadences/${cad.id}/builder`)
        },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      },
    )
  }

  function updateStep(idx: number, patch: Partial<GeneratedStep>) {
    setGenerated((prev) => {
      if (!prev) return prev
      const steps = prev.steps.map((s, i) => i === idx ? { ...s, ...patch } : s)
      return { ...prev, steps }
    })
  }
  function updateStepTemplate(idx: number, patch: Partial<GeneratedStep['template']>) {
    setGenerated((prev) => {
      if (!prev) return prev
      const steps = prev.steps.map((s, i) => i === idx ? { ...s, template: { ...s.template, ...patch } } : s)
      return { ...prev, steps }
    })
  }

  // ─── Validação por passo ─────────────────────────────────
  const canAdvance = useMemo(() => {
    if (step === 'goal') return goal !== 'custom' || customGoal.trim().length > 5
    if (step === 'audience') return true // tudo opcional, mas a IA recebe contexto melhor
    if (step === 'tone') return channels.size > 0
    return false
  }, [step, goal, customGoal, channels])

  const currentIdx = STEP_ORDER.indexOf(step)

  function next() {
    if (step === 'tone') {
      void handleGenerate()
      return
    }
    const nextStep = STEP_ORDER[currentIdx + 1]
    if (nextStep) setStep(nextStep)
  }
  function prev() {
    if (step === 'preview') {
      // Voltar do preview = nova geração com mesmos parâmetros = perde o draft.
      // Confirmar pra evitar acidente.
      if (generated && !window.confirm('Voltar vai descartar a cadência gerada. Continuar?')) return
      setGenerated(null)
      setMeta(null)
      setStep('tone')
      return
    }
    const prevStep = STEP_ORDER[currentIdx - 1]
    if (prevStep) setStep(prevStep)
  }

  // ─── UI ───────────────────────────────────────────────────
  return (
    <Modal
      open={open}
      onOpenChange={(o) => { if (!o) onClose() }}
      title="✨ Criar cadência com IA"
      description="Descreva o objetivo, o público e o tom — a IA gera a sequência de passos, mensagens e tempos com base em boas práticas de prospecção."
      size="xl"
      footer={
        <div class="flex items-center justify-between w-full gap-2">
          <div class="text-2xs text-fg-muted">
            {meta && (
              <span>
                {meta.provider === 'anthropic' ? 'Claude' : 'OpenAI'} {meta.model} ·{' '}
                {meta.inputTokens + meta.outputTokens} tokens · ~${meta.costUsd.toFixed(4)} USD
              </span>
            )}
          </div>
          <div class="flex items-center gap-2">
            {step !== 'goal' && (
              <Button variant="secondary" size="sm" onClick={prev} disabled={generate.isPending || commit.isPending}>
                <ChevronLeft size={12} /> Voltar
              </Button>
            )}
            {step !== 'preview' && (
              <Button variant="primary" size="sm" onClick={next} disabled={!canAdvance || generate.isPending}>
                {step === 'tone'
                  ? (<><Sparkles size={12} /> Gerar com IA</>)
                  : (<>Avançar <ChevronRight size={12} /></>)}
              </Button>
            )}
            {step === 'preview' && generated && (
              <>
                <Button variant="secondary" size="sm" onClick={() => handleCommit('draft')} disabled={commit.isPending}>
                  <Save size={12} /> Salvar rascunho
                </Button>
                <Button variant="primary" size="sm" onClick={() => handleCommit('active')} disabled={commit.isPending}>
                  <Zap size={12} /> {commit.isPending ? 'Salvando…' : 'Salvar e ativar'}
                </Button>
              </>
            )}
          </div>
        </div>
      }
    >
      {/* Stepper */}
      <ol class="flex items-center gap-1 mb-5 text-2xs">
        {STEP_ORDER.map((s, i) => {
          const done = i < currentIdx
          const active = i === currentIdx
          return (
            <li key={s} class="flex items-center gap-1 flex-1">
              <span
                class={cn(
                  'inline-flex items-center justify-center size-6 rounded-full border font-semibold tabular-nums',
                  done && 'bg-success text-fg-on-brand border-success',
                  active && !done && 'bg-accent text-fg-on-brand border-accent',
                  !done && !active && 'bg-surface text-fg-muted border-border',
                )}
              >
                {done ? <Check size={12} /> : i + 1}
              </span>
              <span class={cn('font-medium', active ? 'text-fg' : 'text-fg-muted')}>{STEP_LABEL[s]}</span>
              {i < STEP_ORDER.length - 1 && <span class="flex-1 h-px bg-border ml-1" />}
            </li>
          )
        })}
      </ol>

      {step === 'goal' && (
        <div class="space-y-4">
          <div>
            <h3 class="text-sm font-semibold text-fg mb-1">Qual o objetivo desta cadência?</h3>
            <p class="text-xs text-fg-muted">A IA usa isso pra escolher tipo de mensagem, intensidade e CTA.</p>
          </div>
          <div class="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {GOALS.map((g) => {
              const Icon = g.icon
              const active = goal === g.id
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setGoal(g.id)}
                  class={cn(
                    'text-left rounded-md border p-3 transition-all',
                    active ? 'border-accent bg-accent/5 ring-1 ring-accent' : 'border-border bg-surface hover:bg-surface-3',
                  )}
                  aria-pressed={active}
                >
                  <div class="flex items-center gap-2 mb-1">
                    <Icon size={14} class={active ? 'text-accent' : 'text-fg-muted'} />
                    <span class="text-sm font-medium text-fg">{g.label}</span>
                  </div>
                  <p class="text-2xs text-fg-muted leading-snug">{g.description}</p>
                </button>
              )
            })}
          </div>
          {goal === 'custom' && (
            <Textarea
              label="Descreva o objetivo customizado"
              value={customGoal}
              onInput={(e) => setCustomGoal((e.target as HTMLTextAreaElement).value)}
              placeholder="Ex.: Reativar clientes que pararam de comprar há +90 dias com oferta de upgrade…"
              rows={3}
            />
          )}
        </div>
      )}

      {step === 'audience' && (
        <div class="space-y-4">
          <div>
            <h3 class="text-sm font-semibold text-fg mb-1">Quem é o público e o que você está oferecendo?</h3>
            <p class="text-xs text-fg-muted">Quanto mais específico, mais a IA personaliza as mensagens. Tudo opcional, mas recomendado.</p>
          </div>
          <div class="grid gap-3 grid-cols-1 sm:grid-cols-2">
            <Input
              label="Indústria / segmento"
              value={industry}
              onInput={(e) => setIndustry((e.target as HTMLInputElement).value)}
              placeholder="Ex.: Educação, SaaS B2B, Saúde"
            />
            <Input
              label="Cargo / papel-alvo"
              value={targetRole}
              onInput={(e) => setTargetRole((e.target as HTMLInputElement).value)}
              placeholder="Ex.: Diretor de marketing, RH, Founder"
            />
          </div>
          <Textarea
            label="Dores conhecidas do público"
            value={painPoints}
            onInput={(e) => setPainPoints((e.target as HTMLTextAreaElement).value)}
            placeholder="Ex.: Captação cara, dificuldade em qualificar leads, conversão baixa…"
            rows={2}
          />
          <div class="border-t border-border pt-4 space-y-3">
            <div class="grid gap-3 grid-cols-1 sm:grid-cols-2">
              <Input
                label="Produto / serviço"
                value={productName}
                onInput={(e) => setProductName((e.target as HTMLInputElement).value)}
                placeholder="Ex.: ByChat Beyond, plataforma de captação"
              />
              <Input
                label="Proposta de valor (1 frase)"
                value={valueProp}
                onInput={(e) => setValueProp((e.target as HTMLInputElement).value)}
                placeholder="Ex.: Triplicar a taxa de resposta na prospecção B2B"
              />
            </div>
          </div>
        </div>
      )}

      {step === 'tone' && (
        <div class="space-y-4">
          <div>
            <h3 class="text-sm font-semibold text-fg mb-1">Como você quer falar com esse público?</h3>
            <p class="text-xs text-fg-muted">Tom, canais permitidos, duração e intensidade.</p>
          </div>

          <div>
            <label class="text-xs font-medium text-fg-muted block mb-1.5">Tom da mensagem</label>
            <div class="flex flex-wrap gap-1.5">
              {TONES.map((t) => {
                const active = tone === t.id
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTone(t.id)}
                    class={cn(
                      'rounded-md border px-3 py-2 text-left transition-colors',
                      active ? 'border-accent bg-accent/5 ring-1 ring-accent' : 'border-border bg-surface hover:bg-surface-3',
                    )}
                    aria-pressed={active}
                  >
                    <div class="text-sm font-medium text-fg">{t.label}</div>
                    <div class="text-2xs text-fg-muted">{t.hint}</div>
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <label class="text-xs font-medium text-fg-muted block mb-1.5">
              Canais permitidos <span class="text-fg-muted">({channels.size} selecionado{channels.size === 1 ? '' : 's'})</span>
            </label>
            <div class="grid gap-1.5 grid-cols-2 sm:grid-cols-3">
              {CHANNELS.map((c) => {
                const Icon = c.icon
                const active = channels.has(c.id)
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleChannel(c.id)}
                    class={cn(
                      'flex items-center gap-2 rounded-md border px-3 py-2 transition-colors text-left',
                      active && 'ring-1 ring-offset-0',
                      !active && 'bg-surface text-fg-muted border-border hover:text-fg hover:bg-surface-3',
                    )}
                    style={active ? { background: c.bg, color: c.color, borderColor: c.color } : undefined}
                    aria-pressed={active}
                  >
                    <Icon size={14} />
                    <span class="text-sm font-medium">{c.label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div class="grid gap-3 grid-cols-1 sm:grid-cols-2">
            <div>
              <label class="text-xs font-medium text-fg-muted block mb-1.5">Duração</label>
              <div class="flex flex-col gap-1.5">
                {DURATIONS.map((d) => {
                  const active = duration === d.id
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => setDuration(d.id)}
                      class={cn(
                        'rounded-md border px-3 py-2 text-left',
                        active ? 'border-accent bg-accent/5 ring-1 ring-accent' : 'border-border bg-surface hover:bg-surface-3',
                      )}
                      aria-pressed={active}
                    >
                      <div class="text-sm font-medium text-fg">{d.label}</div>
                      <div class="text-2xs text-fg-muted">{d.hint}</div>
                    </button>
                  )
                })}
              </div>
            </div>
            <div>
              <label class="text-xs font-medium text-fg-muted block mb-1.5">Intensidade</label>
              <div class="flex flex-col gap-1.5">
                {INTENSITIES.map((i) => {
                  const active = intensity === i.id
                  return (
                    <button
                      key={i.id}
                      type="button"
                      onClick={() => setIntensity(i.id)}
                      class={cn(
                        'rounded-md border px-3 py-2 text-left',
                        active ? 'border-accent bg-accent/5 ring-1 ring-accent' : 'border-border bg-surface hover:bg-surface-3',
                      )}
                      aria-pressed={active}
                    >
                      <div class="text-sm font-medium text-fg">{i.label}</div>
                      <div class="text-2xs text-fg-muted">{i.hint}</div>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          <label class="flex items-center gap-2 text-xs text-fg-muted cursor-pointer">
            <input
              type="checkbox"
              class="size-4 cursor-pointer accent-accent"
              checked={includeBreakup}
              onChange={(e) => setIncludeBreakup((e.target as HTMLInputElement).checked)}
            />
            Incluir break-up no final (mensagem de despedida educada que encerra a cadência)
          </label>
        </div>
      )}

      {step === 'preview' && (
        <PreviewPanel
          loading={generate.isPending && !generated}
          generated={generated}
          onUpdateStep={updateStep}
          onUpdateStepTemplate={updateStepTemplate}
          refineText={refineText}
          onRefineTextChange={setRefineText}
          onRefine={handleRefine}
          refining={generate.isPending && !!generated}
        />
      )}
    </Modal>
  )
}

// ─── Preview & edição inline da cadência gerada ───────────────────

function PreviewPanel({
  loading, generated, onUpdateStep, onUpdateStepTemplate,
  refineText, onRefineTextChange, onRefine, refining,
}: {
  loading: boolean
  generated: GeneratedCadence | null
  onUpdateStep: (idx: number, patch: Partial<GeneratedStep>) => void
  onUpdateStepTemplate: (idx: number, patch: Partial<GeneratedStep['template']>) => void
  refineText: string
  onRefineTextChange: (v: string) => void
  onRefine: () => void
  refining: boolean
}) {
  if (loading) {
    return (
      <div class="flex flex-col items-center justify-center py-12 gap-3 text-center">
        <Loader2 size={32} class="animate-spin text-accent" />
        <p class="text-sm font-medium text-fg">Gerando sua cadência…</p>
        <p class="text-xs text-fg-muted max-w-md">
          A IA está montando a sequência de passos, escrevendo as mensagens e ajustando os tempos.
          Isso costuma levar 10-20 segundos.
        </p>
      </div>
    )
  }
  if (!generated) {
    return <Skeleton class="h-64 w-full" />
  }

  const { cadence, steps, reasoning } = generated

  return (
    <div class="space-y-4">
      {/* Card resumo da cadência */}
      <div class="rounded-md border border-accent/40 bg-gradient-to-br from-accent/5 to-info/5 p-3">
        <div class="flex items-start gap-2 mb-2">
          <Sparkles size={16} class="text-accent shrink-0 mt-0.5" />
          <div class="flex-1 min-w-0">
            <h3 class="text-base font-semibold text-fg">{cadence.name}</h3>
            <p class="text-xs text-fg-muted leading-relaxed mt-0.5">{cadence.description}</p>
          </div>
        </div>
        <div class="flex flex-wrap gap-1.5 mt-2 text-2xs">
          {cadence.pauseOnReply && <Badge tone="info">Pausa ao responder</Badge>}
          {cadence.exitOnConversion && <Badge tone="success">Sai na conversão</Badge>}
          {cadence.exitOnStatuses?.length > 0 && (
            <Badge tone="neutral">Sai em: {cadence.exitOnStatuses.join(', ')}</Badge>
          )}
          <Badge tone="neutral">{steps.length} {steps.length === 1 ? 'passo' : 'passos'}</Badge>
        </div>
      </div>

      {/* Insights da IA */}
      {(reasoning.summary || reasoning.bestPractices.length > 0) && (
        <div class="rounded-md border border-border bg-surface-2 p-3 text-xs space-y-2">
          {reasoning.summary && <p class="text-fg leading-relaxed">{reasoning.summary}</p>}
          {reasoning.bestPractices.length > 0 && (
            <ul class="space-y-1">
              {reasoning.bestPractices.map((bp, i) => (
                <li key={i} class="flex items-start gap-1.5 text-fg-muted">
                  <Check size={11} class="text-success shrink-0 mt-0.5" />
                  <span>{bp}</span>
                </li>
              ))}
            </ul>
          )}
          {reasoning.recommendedNext && (
            <div class="text-fg-muted italic border-t border-border pt-2 mt-2">
              <span class="text-fg-muted not-italic font-medium">Próximo passo:</span> {reasoning.recommendedNext}
            </div>
          )}
        </div>
      )}

      {/* Steps */}
      <div>
        <div class="flex items-center justify-between mb-2">
          <h4 class="text-sm font-semibold text-fg">Sequência de passos</h4>
          <span class="text-2xs text-fg-muted">Clique no lápis para editar a mensagem</span>
        </div>
        <ol class="space-y-2">
          {steps.map((s, idx) => (
            <StepCard
              key={idx}
              step={s}
              onUpdate={(patch) => onUpdateStep(idx, patch)}
              onUpdateTemplate={(patch) => onUpdateStepTemplate(idx, patch)}
            />
          ))}
        </ol>
      </div>

      {/* Refinar */}
      <div class="rounded-md border border-border bg-surface-2 p-3 space-y-2">
        <div class="flex items-center gap-2">
          <Wand2 size={14} class="text-accent" />
          <span class="text-sm font-medium text-fg">Refinar com IA</span>
        </div>
        <p class="text-2xs text-fg-muted">
          Ex.: "torne mais consultivo", "encurte para 5 passos", "use mais WhatsApp", "tom mais urgente".
        </p>
        <div class="flex gap-2">
          <Input
            label=""
            value={refineText}
            onInput={(e) => onRefineTextChange((e.target as HTMLInputElement).value)}
            placeholder="O que ajustar?"
            class="flex-1"
            disabled={refining}
          />
          <Button variant="primary" size="sm" onClick={onRefine} disabled={refining || !refineText.trim()}>
            {refining ? <><Loader2 size={12} class="animate-spin" /> Gerando…</> : <><Sparkles size={12} /> Refinar</>}
          </Button>
        </div>
      </div>
    </div>
  )
}

const CHANNEL_META: Record<string, { label: string; color: string; bg: string; icon: typeof Mail }> = {
  whatsapp: { label: 'WhatsApp', color: '#25d366', bg: '#e7faf0', icon: MessageSquare },
  email:    { label: 'E-mail',   color: '#ea4335', bg: '#fce8e6', icon: Mail },
  sms:      { label: 'SMS',      color: '#fbbc04', bg: '#fef7e0', icon: Smartphone },
  call:     { label: 'Ligação',  color: '#1a73e8', bg: '#e8f0fe', icon: Phone },
  linkedin: { label: 'LinkedIn', color: '#0a66c2', bg: '#e7f0fa', icon: Briefcase },
  manual:   { label: 'Manual',   color: '#5f6368', bg: '#f1f3f4', icon: ListChecks },
}

function StepCard({
  step, onUpdate, onUpdateTemplate,
}: {
  step: GeneratedStep
  onUpdate: (patch: Partial<GeneratedStep>) => void
  onUpdateTemplate: (patch: Partial<GeneratedStep['template']>) => void
}) {
  const [editing, setEditing] = useState(false)
  const meta = CHANNEL_META[step.channel] ?? CHANNEL_META.manual!
  const Icon = meta.icon
  const dayLabel = step.dayOffset === 0 ? 'Imediato' : `Dia ${step.dayOffset}`
  const hourLabel = step.hourOffset > 0 ? ` +${step.hourOffset}h` : ''

  return (
    <li class="rounded-md border border-border bg-surface">
      <div class="flex items-start gap-3 p-3">
        <div
          class="size-9 rounded-full grid place-items-center shrink-0 mt-0.5"
          style={{ background: meta.bg, color: meta.color }}
        >
          <Icon size={14} />
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-xs font-semibold text-fg-muted tabular-nums">#{step.order + 1}</span>
            <span
              class="text-2xs font-semibold px-2 py-0.5 rounded-full"
              style={{ background: meta.bg, color: meta.color }}
            >
              {meta.label}
            </span>
            <span class="text-2xs text-fg-muted inline-flex items-center gap-1">
              <Clock size={10} /> {dayLabel}{hourLabel}
            </span>
            {step.isManual && <Badge tone="warning">Manual</Badge>}
            {step.isBreakUp && <Badge tone="danger">Despedida</Badge>}
            <span class="flex-1" />
            <button
              type="button"
              class="size-7 rounded grid place-items-center text-fg-muted hover:text-fg hover:bg-surface-3"
              onClick={() => setEditing((e) => !e)}
              aria-label={editing ? 'Fechar edição' : 'Editar mensagem'}
              title={editing ? 'Fechar edição' : 'Editar mensagem'}
            >
              {editing ? <XIcon size={12} /> : <Edit2 size={12} />}
            </button>
          </div>
          {step.rationale && (
            <p class="text-2xs text-fg-muted italic mt-1">{step.rationale}</p>
          )}

          {!editing && step.template?.body && (
            <>
              {step.channel === 'email' && step.template.subject && (
                <div class="text-xs text-fg-muted mt-2">
                  <span class="text-fg-muted">Assunto:</span> <span class="text-fg">{step.template.subject}</span>
                </div>
              )}
              <pre class="text-xs text-fg whitespace-pre-wrap font-sans bg-surface-2 rounded p-2 mt-2 leading-relaxed">
                {step.template.body}
              </pre>
              {step.template.variables.length > 0 && (
                <div class="flex flex-wrap gap-1 mt-1.5">
                  {step.template.variables.map((v) => (
                    <span
                      key={v.key}
                      class="text-2xs font-mono text-fg-muted bg-surface-3 px-1.5 py-0.5 rounded"
                      title={`${v.label}${v.default ? ` · default: ${v.default}` : ''}`}
                    >
                      {`{{${v.key}}}`}
                    </span>
                  ))}
                </div>
              )}
            </>
          )}

          {editing && (
            <div class="space-y-2 mt-2">
              <div class="grid gap-2 grid-cols-2 sm:grid-cols-4">
                <Input
                  label="Dia"
                  type="number"
                  value={String(step.dayOffset)}
                  onInput={(e) => onUpdate({ dayOffset: Math.max(0, Number((e.target as HTMLInputElement).value)) })}
                />
                <Input
                  label="Hora +"
                  type="number"
                  value={String(step.hourOffset)}
                  onInput={(e) => onUpdate({ hourOffset: Math.max(0, Number((e.target as HTMLInputElement).value)) })}
                />
              </div>
              {step.channel === 'email' && (
                <Input
                  label="Assunto"
                  value={step.template.subject ?? ''}
                  onInput={(e) => onUpdateTemplate({ subject: (e.target as HTMLInputElement).value })}
                />
              )}
              <Textarea
                label="Mensagem"
                rows={5}
                value={step.template.body}
                onInput={(e) => onUpdateTemplate({ body: (e.target as HTMLTextAreaElement).value })}
                hint="Variáveis: {{nome}}, {{empresa}}, {{operador}}, {{data_hoje}}, {{whatsapp}}, {{email}}"
              />
            </div>
          )}
        </div>
      </div>
    </li>
  )
}
