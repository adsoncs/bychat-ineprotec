// Disparos Inteligentes — campanhas pelos números próprios (Evolution).
//
// Diferenças de propósito em relação ao Disparos em Massa (Cloud API), que se
// refletem na tela: aqui não há template aprovado nem custo por mensagem; o que
// está em jogo é a saúde do número. Por isso o wizard tem um passo só de RITMO,
// a revisão obriga a SIMULAR a agenda antes de disparar, e o painel de números
// (aquecimento, teto do dia, estado) fica visível o tempo todo.

import { useEffect, useState } from 'preact/hooks'
import {
  BrainCircuit, Send, Pause, Play, X as XIcon, Trash2, Download, Upload, ArrowLeft, ArrowRight,
  Users, FileSpreadsheet, Clock, Pencil, Plus, Sparkles, ShieldAlert, Activity, MessageSquare, CalendarClock,
  Image as ImageIcon, Reply, BarChart3, Ban, Scale, Gauge,
} from 'lucide-preact'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/cn'
import { LeadsAudiencePicker, Stat, AudienceCard } from '@/components/audience/LeadsAudiencePicker'
import {
  useSenders, useSmartCampaigns, useSmartCampaign, useCreateSmartCampaign, useUpdateSmartCampaign,
  useDeleteSmartCampaign, usePreviewMessage, useSetSmartAudienceLeads, useParseSmartSheet,
  useSmartImportCommit, useSimulateCampaign, useStartSmartCampaign, useSmartCampaignAction,
  useVariantPerformance, useUploadMedia, usePacingProfiles,
  useSuppressions, useAddSuppression, useRemoveSuppression,
  downloadSmartAudienceTemplate, PACING_PRESETS, LEGAL_BASIS,
  type SmartCampaign, type MessageBlock, type PacingConfig, type WindowConfig, type PlanSummary, type Sender,
  type ReplyActions, type RiskReport, type PacingProfile,
} from '@/hooks/useSmartBroadcast'
import { Modal } from '@/components/ui/Modal'
import { useFunnels, useStages } from '@/hooks/useFunnels'
import { useAgents } from '@/hooks/useRouting'

/** Sensibilidade do disjuntor (services/smartBroadcast/guard.ts). */
type GuardLevel = 'strict' | 'normal' | 'off'

const STATUS_LABEL: Record<string, string> = {
  draft: 'Rascunho', scheduled: 'Agendada', running: 'Enviando', paused: 'Pausada',
  completed: 'Concluída', canceled: 'Cancelada', failed: 'Falhou',
}
const STATUS_TONE: Record<string, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  draft: 'neutral', scheduled: 'info', running: 'info', paused: 'warning',
  completed: 'success', canceled: 'neutral', failed: 'danger',
}
const SENDER_STATE: Record<string, { label: string; tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger' }> = {
  warming: { label: 'Aquecendo', tone: 'info' },
  healthy: { label: 'Saudável', tone: 'success' },
  throttled: { label: 'Ritmo reduzido', tone: 'warning' },
  paused: { label: 'Pausado', tone: 'warning' },
  blocked: { label: 'Bloqueado', tone: 'danger' },
}
const WEEKDAYS = [
  { v: 1, label: 'Seg' }, { v: 2, label: 'Ter' }, { v: 3, label: 'Qua' }, { v: 4, label: 'Qui' },
  { v: 5, label: 'Sex' }, { v: 6, label: 'Sáb' }, { v: 0, label: 'Dom' },
]

const DEFAULT_WINDOW: WindowConfig = { days: [1, 2, 3, 4, 5], from: '09:00', to: '18:00', timezone: 'America/Sao_Paulo' }

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

type View = { kind: 'list' } | { kind: 'wizard'; editId: number | null } | { kind: 'detail'; id: number }

export function SmartBroadcastPage() {
  const [view, setView] = useState<View>({ kind: 'list' })
  if (view.kind === 'wizard') {
    return <CampaignWizard editId={view.editId} onClose={() => setView({ kind: 'list' })} onDone={(id) => setView({ kind: 'detail', id })} />
  }
  if (view.kind === 'detail') return <CampaignDetail id={view.id} onBack={() => setView({ kind: 'list' })} />
  return (
    <CampaignList
      onNew={() => setView({ kind: 'wizard', editId: null })}
      onEdit={(id) => setView({ kind: 'wizard', editId: id })}
      onOpen={(id) => setView({ kind: 'detail', id })}
    />
  )
}

// ─────────────────────────── LISTA ───────────────────────────
function CampaignList({ onNew, onEdit, onOpen }: { onNew: () => void; onEdit: (id: number) => void; onOpen: (id: number) => void }) {
  const { data, isLoading } = useSmartCampaigns()
  const { data: sendersData } = useSenders()
  const del = useDeleteSmartCampaign()
  const [deleting, setDeleting] = useState<SmartCampaign | null>(null)
  const [showSuppression, setShowSuppression] = useState(false)
  const campaigns = data?.campaigns ?? []

  return (
    <Page
      title="Disparos Inteligentes"
      description="Campanhas pelos seus próprios números, com ritmo humano e proteção automática do chip."
      actions={<div class="flex items-center gap-2">
        <Button variant="ghost" onClick={() => setShowSuppression(true)}><Ban size={14} /> Lista de bloqueio</Button>
        <Button variant="primary" onClick={onNew}><BrainCircuit size={14} /> Nova campanha</Button>
      </div>}
    >
      <div class="space-y-4">
        <SenderHealthPanel senders={sendersData?.senders ?? []} />

        {isLoading ? (
          <div class="text-sm text-fg-muted">Carregando…</div>
        ) : campaigns.length === 0 ? (
          <EmptyState
            icon={<BrainCircuit size={28} />}
            title="Nenhuma campanha ainda"
            description="Aqui o envio sai pelos seus próprios números de WhatsApp, com intervalos irregulares, simulação de digitação e teto diário por número."
          />
        ) : (
          <div class="space-y-2">
            {campaigns.map((c) => (
              <Card key={c.id} class="p-4 flex items-center gap-4 hover:bg-surface-2 cursor-pointer" onClick={() => onOpen(c.id)}>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="text-sm font-medium text-fg truncate">{c.name}</span>
                    <Badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge>
                    {c.riskState === 'halted' && <Badge tone="danger">Interrompida pelo sistema</Badge>}
                    {c.riskState === 'watch' && <Badge tone="warning">Em observação</Badge>}
                  </div>
                  <div class="text-xs text-fg-muted mt-0.5">
                    {(c.senderInstances ?? []).length} número(s) · {c.totalRecipients} destinatários
                    {c.scheduledAt && c.status === 'scheduled' ? ` · começa ${fmtDateTime(c.scheduledAt)}` : ''}
                  </div>
                  {c.riskReason && <div class="text-xs text-danger mt-1">{c.riskReason}</div>}
                </div>
                <div class="text-xs text-fg-muted shrink-0 text-right">
                  <div>✅ {c.sentCount} · 💬 {c.repliedCount} · ❌ {c.failedCount}</div>
                  <div class="text-fg-subtle">{new Date(c.createdAt).toLocaleDateString('pt-BR')}</div>
                </div>
                {['draft', 'paused'].includes(c.status) && (
                  <button type="button" class="size-7 rounded grid place-items-center text-fg-muted hover:text-accent hover:bg-surface-3"
                    onClick={(e) => { e.stopPropagation(); onEdit(c.id) }} title="Editar"><Pencil size={13} /></button>
                )}
                {['draft', 'completed', 'canceled', 'failed'].includes(c.status) && (
                  <button type="button" class="size-7 rounded grid place-items-center text-fg-muted hover:text-danger hover:bg-surface-3"
                    onClick={(e) => { e.stopPropagation(); setDeleting(c) }} title="Excluir"><Trash2 size={13} /></button>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>

      {showSuppression && <SuppressionModal onClose={() => setShowSuppression(false)} />}

      {deleting && (
        <ConfirmDialog open onOpenChange={(o) => { if (!o) setDeleting(null) }} title={`Excluir "${deleting.name}"`}
          description="A campanha e seus destinatários serão removidos." destructive confirmLabel="Excluir" loading={del.isPending}
          onConfirm={() => del.mutate(deleting.id, { onSuccess: () => { toast('Campanha excluída', 'success'); setDeleting(null) } })} />
      )}
    </Page>
  )
}

/** Saúde dos números — o painel que diz se dá para disparar hoje. */
function SenderHealthPanel({ senders }: { senders: Sender[] }) {
  if (!senders.length) return null
  return (
    <Card class="p-4">
      <div class="flex items-center gap-2 mb-3">
        <Activity size={14} class="text-accent" />
        <span class="text-sm font-semibold text-fg">Saúde dos números</span>
        <span class="text-xs text-fg-subtle">o teto sobe sozinho conforme o número aquece</span>
      </div>
      <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {senders.map((s) => {
          const state = SENDER_STATE[s.state] ?? SENDER_STATE.warming
          const pct = s.dailyCap ? Math.min(100, Math.round((s.sentToday / s.dailyCap) * 100)) : 0
          return (
            <div key={s.id} class="rounded-md border border-border bg-surface-2 p-3">
              <div class="flex items-center justify-between gap-2">
                <span class="text-xs font-medium text-fg truncate">{s.name || s.instanceName}</span>
                <Badge tone={state.tone}>{state.label}</Badge>
              </div>
              <div class="text-[0.6875rem] text-fg-muted mt-1">
                Dia {s.warmupDay} do aquecimento · {s.sentToday}/{s.dailyCap} hoje
              </div>
              <div class="h-1 rounded-full bg-surface-3 overflow-hidden mt-2">
                <div class={cn('h-full rounded-full', pct >= 100 ? 'bg-warning' : 'bg-accent')} style={{ width: `${pct}%` }} />
              </div>
              {s.pauseReason && <div class="text-[0.6875rem] text-warning mt-1.5">{s.pauseReason}</div>}
            </div>
          )
        })}
      </div>
    </Card>
  )
}

// ─────────────────────────── WIZARD ───────────────────────────
const STEP_LABELS = ['Configuração', 'Audiência', 'Mensagem', 'Ritmo', 'Revisão']
const STEP_TITLES = [
  '1. Configuração — nome, números de envio e tipo de audiência',
  '2. Audiência — quem vai receber',
  '3. Mensagem — escreva variações; texto único em massa é o que mais gera denúncia',
  '4. Ritmo — intervalos, janela de horário e teto por número',
  '5. Revisão — simule a agenda antes de disparar',
]

function CampaignWizard({ editId, onClose, onDone }: { editId: number | null; onClose: () => void; onDone: (id: number) => void }) {
  const [step, setStep] = useState(1)
  const [campaignId, setCampaignId] = useState<number | null>(editId)
  const isEdit = editId !== null
  const [loadedEdit, setLoadedEdit] = useState(false)
  const [keptAudience, setKeptAudience] = useState<{ created: number; skipped: number } | null>(null)

  // passo 1
  const { data: sendersData } = useSenders()
  const senders = sendersData?.senders ?? []
  const [name, setName] = useState('')
  const [selectedSenders, setSelectedSenders] = useState<Set<string>>(new Set())
  const [audienceType, setAudienceType] = useState<'leads' | 'import'>('leads')
  const [requireOptIn, setRequireOptIn] = useState(false)

  // passo 2
  const [selectedLeads, setSelectedLeads] = useState<Set<number>>(new Set())
  const [sheetHeaders, setSheetHeaders] = useState<string[]>([])
  const [sheetTotal, setSheetTotal] = useState(0)
  const [phoneColumn, setPhoneColumn] = useState('')
  const [nameColumn, setNameColumn] = useState('')

  // passo 3
  const [blocks, setBlocks] = useState<MessageBlock[]>([{ variants: ['', ''] }])
  const [optOutFooter, setOptOutFooter] = useState('Se preferir não receber mais, responda SAIR.')
  const [linkUrl, setLinkUrl] = useState('')
  const preview = usePreviewMessage()
  const upload = useUploadMedia()
  const [samples, setSamples] = useState<string[][]>([])
  const [diversity, setDiversity] = useState<{ ratio: number; distinct: number; sampled: number } | null>(null)

  // passo 4
  const [pacingKey, setPacingKey] = useState<'conservador' | 'padrao' | 'agressivo'>('conservador')
  const [window, setWindow] = useState<WindowConfig>(DEFAULT_WINDOW)
  const [dailyCap, setDailyCap] = useState(20)
  const [replyActions, setReplyActions] = useState<ReplyActions>({ createActivity: true })
  const [usePreferredTime, setUsePreferredTime] = useState(false)
  const [guardLevel, setGuardLevel] = useState<GuardLevel>('normal')
  const [skipNumberCheck, setSkipNumberCheck] = useState(false)
  const [advisories, setAdvisories] = useState<string[]>([])
  const [legalBasis, setLegalBasis] = useState('')
  const { data: profilesData } = usePacingProfiles()
  const { data: funnelsData } = useFunnels()
  const { data: replyStages } = useStages(replyActions.moveToFunnelId)
  const { data: agentsData } = useAgents()

  // passo 5
  const [audienceResult, setAudienceResult] = useState<{ created: number; skipped: number } | null>(null)
  const [plan, setPlan] = useState<PlanSummary | null>(null)
  const [problems, setProblems] = useState<string[]>([])
  const [scheduledAt, setScheduledAt] = useState('')

  const create = useCreateSmartCampaign()
  const update = useUpdateSmartCampaign()
  const setLeads = useSetSmartAudienceLeads()
  const parse = useParseSmartSheet()
  const importCommit = useSmartImportCommit()
  const simulate = useSimulateCampaign()
  const start = useStartSmartCampaign()
  const { data: detail } = useSmartCampaign(isEdit ? campaignId : null)

  useEffect(() => {
    if (!isEdit || loadedEdit || !detail?.campaign) return
    const c = detail.campaign
    setName(c.name)
    setSelectedSenders(new Set((c.senderInstances ?? []).map((s) => s.instanceName)))
    setAudienceType(c.audienceType)
    setRequireOptIn(c.requireOptIn)
    setBlocks((c.messageBlocks ?? []).length ? c.messageBlocks : [{ variants: ['', ''] }])
    setOptOutFooter(c.optOutFooter ?? '')
    setLinkUrl(c.linkUrl ?? '')
    setReplyActions(c.replyActions ?? { createActivity: true })
    setUsePreferredTime(!!c.usePreferredTime)
    setLegalBasis(c.legalBasis ?? '')
    setWindow({ ...DEFAULT_WINDOW, ...(c.windowConfig ?? {}) })
    setDailyCap(c.dailyCapPerNumber ?? 20)
    setSkipNumberCheck(!!(c as any).skipNumberCheck)
    setGuardLevel(((c as any).guardConfig?.level as GuardLevel) ?? 'normal')
    if (c.totalRecipients > 0) setKeptAudience({ created: c.totalRecipients, skipped: c.skippedCount })
    setLoadedEdit(true)
  }, [isEdit, loadedEdit, detail])

  function senderPayload() {
    return senders.filter((s) => selectedSenders.has(s.instanceName)).map((s) => ({ id: s.id, instanceName: s.instanceName }))
  }

  async function step1Next() {
    if (!name.trim()) { toast('Dê um nome à campanha', 'warning'); return }
    if (!selectedSenders.size) { toast('Escolha ao menos um número de envio', 'warning'); return }
    const payload = { name: name.trim(), senderInstances: senderPayload(), audienceType, requireOptIn }
    if (campaignId) await update.mutateAsync({ id: campaignId, ...payload } as any)
    else {
      const res = await create.mutateAsync(payload as any)
      setCampaignId(res.campaign.id)
    }
    setStep(2)
  }

  async function onUpload(file: File) {
    if (!campaignId) return
    const res = await parse.mutateAsync({ id: campaignId, file })
    setSheetHeaders(res.headers); setSheetTotal(res.totalRows)
    setPhoneColumn(res.headers.find((h) => /whats|fone|phone|tel|celular/i.test(h)) || res.headers[0] || '')
    setNameColumn(res.headers.find((h) => /nome|name/i.test(h)) || '')
    toast(`${res.totalRows} linhas lidas`, 'success')
  }

  const audienceTouched = audienceType === 'leads' ? selectedLeads.size > 0 : sheetHeaders.length > 0

  function step2Next() {
    if (!audienceTouched && keptAudience) { setStep(3); return }
    if (audienceType === 'leads' && !selectedLeads.size) { toast('Selecione ao menos um lead', 'warning'); return }
    if (audienceType === 'import' && (!sheetHeaders.length || !phoneColumn)) { toast('Envie a planilha e indique a coluna do WhatsApp', 'warning'); return }
    setStep(3)
  }

  async function refreshPreview() {
    const res = await preview.mutateAsync({ messageBlocks: blocks, optOutFooter, linkUrl, name })
    setSamples(res.samples)
    setDiversity(res.diversity)
  }

  async function attachMedia(bi: number, file: File) {
    try {
      const res = await upload.mutateAsync(file)
      const kind = res.mimetype?.startsWith('image/') ? 'image'
        : res.mimetype?.startsWith('video/') ? 'video'
        : res.mimetype?.startsWith('audio/') ? 'audio' : 'document'
      const next = [...blocks]
      next[bi] = { ...next[bi]!, mediaUrl: res.url, mediaType: kind as any, mediaName: res.filename }
      setBlocks(next)
      toast('Mídia anexada', 'success')
    } catch {
      toast('Falha ao subir a mídia', 'danger')
    }
  }

  async function step3Next() {
    if (!campaignId) return
    const filled = blocks.map((b) => ({ ...b, variants: (b.variants ?? []).filter((v) => v.trim()) })).filter((b) => b.variants.length)
    if (!filled.length) { toast('Escreva ao menos uma mensagem', 'warning'); return }
    await update.mutateAsync({ id: campaignId, messageBlocks: filled, optOutFooter: optOutFooter || null, linkUrl: linkUrl || null } as any)
    setBlocks(filled)
    setStep(4)
  }

  async function step4Next() {
    if (!campaignId) return
    const chosen = pacingOptions.find((o) => o.key === pacingKey) ?? pacingOptions[0]!
    const pacing: PacingConfig = { ...chosen.config }
    delete (pacing as any).label; delete (pacing as any).hint
    await update.mutateAsync({
      id: campaignId, pacingConfig: pacing, windowConfig: window, dailyCapPerNumber: dailyCap,
      replyActions, usePreferredTime, skipNumberCheck, guardConfig: { level: guardLevel },
    } as any)

    // A audiência só é processada agora: as variáveis do texto já estão definidas.
    if (audienceTouched || !keptAudience) {
      const res = audienceType === 'leads'
        ? await setLeads.mutateAsync({ id: campaignId, leadIds: [...selectedLeads] })
        : await importCommit.mutateAsync({ id: campaignId, phoneColumn, nameColumn: nameColumn || undefined })
      setAudienceResult(res)
    } else {
      setAudienceResult(keptAudience)
    }
    setStep(5)
  }

  async function runSimulation() {
    if (!campaignId) return
    try {
      await update.mutateAsync({ id: campaignId, legalBasis: legalBasis || null } as any)
      const res = await simulate.mutateAsync({ id: campaignId, skipNumberCheck })
      setPlan(res.plan); setProblems(res.problems); setAdvisories((res as any).advisories ?? [])
      if (res.problems.length) toast('Simulação concluída com pendências', 'warning')
      else toast('Simulação concluída', 'success')
    } catch (err: any) {
      setPlan(null)
      setAdvisories((err?.advisories as string[]) ?? [])
      toast(err?.message ?? 'Falha na simulação', 'danger')
    }
  }

  async function finish() {
    if (!campaignId) return
    try {
      const res = await start.mutateAsync({ id: campaignId, scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null })
      toast(res.status === 'scheduled' ? 'Campanha agendada' : 'Campanha iniciada', 'success')
      onDone(campaignId)
    } catch (err: any) {
      toast(err?.message ?? 'Não foi possível iniciar', 'danger')
    }
  }

  // Perfis vêm do servidor (semeados lá); os presets locais são só o fallback
  // enquanto a lista carrega.
  const pacingOptions = (profilesData?.profiles ?? []).length
    ? (profilesData!.profiles as PacingProfile[]).map((p) => ({
        key: p.name.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '') as keyof typeof PACING_PRESETS,
        label: p.name,
        hint: p.description ?? '',
        config: {
          minDelayMs: p.minDelayMs, maxDelayMs: p.maxDelayMs, sessionSize: p.sessionSize,
          sessionBreakMs: p.sessionBreakMs, typingEnabled: p.typingEnabled, readReceipts: p.readReceipts,
        } as PacingConfig,
        dailyCapStart: p.dailyCapStart,
      }))
    : (Object.keys(PACING_PRESETS) as Array<keyof typeof PACING_PRESETS>).map((k) => ({
        key: k, label: PACING_PRESETS[k].label, hint: PACING_PRESETS[k].hint,
        config: PACING_PRESETS[k] as PacingConfig, dailyCapStart: 20,
      }))

  const busy = create.isPending || update.isPending || setLeads.isPending || importCommit.isPending || parse.isPending || start.isPending || simulate.isPending

  return (
    <Page title={isEdit ? 'Editar campanha' : 'Nova campanha inteligente'} description={STEP_TITLES[step - 1]}
      actions={<Button variant="ghost" onClick={onClose}><ArrowLeft size={14} /> Voltar à lista</Button>}>
      <ol class="flex items-center gap-2 overflow-x-auto pb-1">
        {STEP_LABELS.map((label, i) => {
          const n = i + 1
          const done = n < step
          const active = n === step
          return (
            <li key={label} class="flex items-center gap-2 shrink-0">
              <div class={cn('flex items-center gap-2 h-9 px-3 rounded-full border text-xs font-medium transition-colors',
                active ? 'bg-accent/15 text-accent border-accent' : done ? 'bg-surface-2 text-fg border-border' : 'bg-surface text-fg-subtle border-border')}>
                <span class={cn('grid place-items-center size-5 rounded-full text-[0.625rem] font-semibold',
                  active ? 'bg-accent text-white' : done ? 'bg-success/20 text-success' : 'bg-surface-3 text-fg-subtle')}>
                  {done ? '✓' : n}
                </span>
                {label}
              </div>
              {n < STEP_LABELS.length && <div class={cn('h-px w-6', done ? 'bg-success/40' : 'bg-border')} />}
            </li>
          )
        })}
      </ol>

      {/* PASSO 1 */}
      {step === 1 && (
        <div class="grid gap-4 items-start lg:grid-cols-[minmax(0,1fr)_22rem] mt-3">
          <Card class="p-5 space-y-4">
            <Input label="Nome da campanha" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} placeholder="Ex.: Retomada de orçamentos — agosto" />

            <div>
              <label class="text-[0.6875rem] text-fg-subtle uppercase tracking-wider">Números de envio</label>
              <p class="text-xs text-fg-muted mt-0.5 mb-2">
                Quem já conversou com um destes números recebe por ele — a conversa continua no mesmo lugar.
              </p>
              <div class="grid gap-2 sm:grid-cols-2">
                {senders.map((s) => {
                  const on = selectedSenders.has(s.instanceName)
                  const blocked = s.state === 'blocked'
                  const state = SENDER_STATE[s.state] ?? SENDER_STATE.warming
                  return (
                    <button key={s.id} type="button" disabled={blocked}
                      onClick={() => {
                        const next = new Set(selectedSenders)
                        on ? next.delete(s.instanceName) : next.add(s.instanceName)
                        setSelectedSenders(next)
                      }}
                      class={cn('text-left rounded-md border p-3 transition-colors',
                        blocked ? 'border-border opacity-50 cursor-not-allowed' : on ? 'border-primary bg-primary/10' : 'border-border hover:bg-surface-2')}>
                      <div class="flex items-center justify-between gap-2">
                        <span class="text-sm font-medium text-fg truncate">{s.name || s.instanceName}</span>
                        <Badge tone={state.tone}>{state.label}</Badge>
                      </div>
                      <div class="text-xs text-fg-muted mt-0.5">
                        até {s.dailyCap}/dia · dia {s.warmupDay} do aquecimento
                      </div>
                    </button>
                  )
                })}
              </div>
              {senders.length === 0 && <p class="text-xs text-warning">Nenhum número conectado. Conecte um WhatsApp antes de criar a campanha.</p>}
            </div>

            <div>
              <label class="text-[0.6875rem] text-fg-subtle uppercase tracking-wider">Audiência</label>
              <div class="grid gap-2 mt-1 sm:grid-cols-2">
                <AudienceCard active={audienceType === 'leads'} onClick={() => setAudienceType('leads')} icon={<Users size={16} />} title="Leads do sistema" desc="Selecionar leads existentes" />
                <AudienceCard active={audienceType === 'import'} onClick={() => setAudienceType('import')} icon={<FileSpreadsheet size={16} />} title="Importar base" desc="Planilha CSV/Excel" />
              </div>
            </div>

            {audienceType === 'leads' && (
              <label class="flex items-start gap-2 text-xs text-fg cursor-pointer">
                <input type="checkbox" checked={requireOptIn} class="mt-0.5"
                  onChange={(e) => setRequireOptIn((e.target as HTMLInputElement).checked)} />
                <span>
                  <b>Só quem já conversou com a gente.</b> Restringe a campanha a contatos com mensagem recebida no histórico —
                  é o público que menos denuncia, porque reconhece quem está falando.
                </span>
              </label>
            )}
          </Card>

          <RiskSidebar />
        </div>
      )}

      {/* PASSO 2 */}
      {step === 2 && (
        <div class="mt-3">
          {keptAudience && !audienceTouched && (
            <div class="flex items-start gap-2 rounded-md border border-info/40 bg-info/10 px-3 py-2 text-xs text-fg mb-3">
              <Users size={14} class="text-info shrink-0 mt-0.5" />
              <span>Esta campanha já tem <b>{keptAudience.created.toLocaleString('pt-BR')}</b> destinatário(s). Avance sem mexer para mantê-los.</span>
            </div>
          )}
          {audienceType === 'leads' ? (
            <LeadsAudiencePicker selected={selectedLeads} onChange={setSelectedLeads} />
          ) : (
            <div class="grid gap-4 items-start lg:grid-cols-[minmax(0,1fr)_22rem]">
              <Card class="p-5 space-y-4">
                <div class="flex items-center gap-2 flex-wrap">
                  <Button variant="ghost" size="sm" onClick={() => downloadSmartAudienceTemplate().catch(() => toast('Falha ao baixar modelo', 'danger'))}>
                    <Download size={13} /> Baixar modelo
                  </Button>
                  <label class="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium border border-border hover:bg-surface-2 cursor-pointer">
                    <Upload size={13} /> Enviar planilha
                    <input type="file" accept=".csv,.xlsx,.xls" class="hidden" onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) onUpload(f) }} />
                  </label>
                </div>
                {sheetHeaders.length === 0 ? (
                  <EmptyState icon={<FileSpreadsheet size={26} />} title="Nenhuma planilha enviada"
                    description="Cada coluna da planilha vira uma variável: a coluna 'cidade' pode ser usada como {{cidade}} no texto." />
                ) : (
                  <div class="grid gap-3 sm:grid-cols-2">
                    <Select label="Coluna do WhatsApp" value={phoneColumn} onChange={(e) => setPhoneColumn((e.target as HTMLSelectElement).value)}>
                      {sheetHeaders.map((h) => <option key={h} value={h}>{h}</option>)}
                    </Select>
                    <Select label="Coluna do nome (opcional)" value={nameColumn} onChange={(e) => setNameColumn((e.target as HTMLSelectElement).value)}>
                      <option value="">—</option>
                      {sheetHeaders.map((h) => <option key={h} value={h}>{h}</option>)}
                    </Select>
                  </div>
                )}
              </Card>
              <Card class="p-4 space-y-3">
                <div class="text-[0.6875rem] font-semibold text-fg-muted uppercase tracking-wider">Planilha</div>
                {sheetHeaders.length === 0 ? (
                  <p class="text-xs text-fg-subtle">Envie um arquivo para ver o resumo aqui.</p>
                ) : (
                  <>
                    <Stat label="Linhas lidas" value={sheetTotal} tone="success" />
                    <div class="flex flex-wrap gap-1">
                      {sheetHeaders.map((h) => <span key={h} class="inline-flex h-6 items-center px-2 rounded-full border border-border text-[0.6875rem] text-fg-muted">{`{{${h.toLowerCase()}}}`}</span>)}
                    </div>
                  </>
                )}
              </Card>
            </div>
          )}
        </div>
      )}

      {/* PASSO 3 — mensagem */}
      {step === 3 && (
        <div class="grid gap-4 items-start lg:grid-cols-[minmax(0,1fr)_24rem] mt-3">
          <Card class="p-5 space-y-4">
            {blocks.map((block, bi) => (
              <div key={bi} class="rounded-md border border-border p-3 space-y-2">
                <div class="flex items-center justify-between">
                  <span class="text-xs font-semibold text-fg">{bi === 0 ? 'Mensagem' : `Bolha ${bi + 1}`}</span>
                  {blocks.length > 1 && (
                    <button type="button" class="text-fg-muted hover:text-danger" onClick={() => setBlocks(blocks.filter((_, i) => i !== bi))}>
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
                {(block.variants ?? []).map((v, vi) => (
                  <Textarea key={vi} rows={3} value={v}
                    label={vi === 0 ? 'Variação principal' : `Variação ${vi + 1}`}
                    placeholder={vi === 0 ? 'Oi {{primeiro_nome}}, {tudo bem|como vai}? …' : 'Outra forma de dizer a mesma coisa'}
                    onInput={(e) => {
                      const next = [...blocks]
                      const variants = [...(next[bi]!.variants ?? [])]
                      variants[vi] = (e.target as HTMLTextAreaElement).value
                      next[bi] = { ...next[bi]!, variants }
                      setBlocks(next)
                    }} />
                ))}
                <div class="flex items-center gap-2 flex-wrap">
                  <Button variant="ghost" size="sm" onClick={() => {
                    const next = [...blocks]
                    next[bi] = { ...next[bi]!, variants: [...(next[bi]!.variants ?? []), ''] }
                    setBlocks(next)
                  }}><Plus size={12} /> Adicionar variação</Button>
                  <label class="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium border border-border hover:bg-surface-2 cursor-pointer">
                    <ImageIcon size={12} /> {block.mediaUrl ? 'Trocar mídia' : 'Anexar mídia'}
                    <input type="file" class="hidden" accept="image/*,video/*,application/pdf,audio/*"
                      onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) attachMedia(bi, f) }} />
                  </label>
                  {block.mediaUrl && (
                    <span class="inline-flex items-center gap-1.5 text-[0.6875rem] text-fg-muted">
                      {block.mediaName || block.mediaType}
                      <button type="button" class="text-fg-muted hover:text-danger" title="Remover mídia"
                        onClick={() => { const n = [...blocks]; n[bi] = { ...n[bi]!, mediaUrl: null, mediaType: null, mediaName: null }; setBlocks(n) }}>
                        <XIcon size={11} />
                      </button>
                    </span>
                  )}
                </div>
              </div>
            ))}

            <div class="flex items-center gap-2 flex-wrap">
              <Button variant="ghost" size="sm" onClick={() => setBlocks([...blocks, { variants: [''] }])}>
                <MessageSquare size={13} /> Quebrar em outra bolha
              </Button>
              <Button variant="ghost" size="sm" onClick={refreshPreview} disabled={preview.isPending}>
                <Sparkles size={13} /> {preview.isPending ? 'Gerando…' : 'Ver como vai sair'}
              </Button>
            </div>

            <div class="grid gap-3 sm:grid-cols-2">
              <Input label="Link da campanha (opcional)" value={linkUrl} placeholder="https://seusite.com.br/oferta"
                onInput={(e) => setLinkUrl((e.target as HTMLInputElement).value)}
                hint="Use {{link}} no texto: cada pessoa recebe a URL com UTMs e um identificador próprio." />
              <Input label="Rodapé de saída" value={optOutFooter} placeholder="Responda SAIR para não receber mais."
                onInput={(e) => setOptOutFooter((e.target as HTMLInputElement).value)}
                hint="Vai na última bolha. Quem pede SAIR entra no opt-out automaticamente." />
            </div>

            <div class="rounded-md border border-info/40 bg-info/10 p-3 text-xs text-fg space-y-1">
              <div><b>Variáveis:</b> <code>{'{{primeiro_nome}}'}</code>, <code>{'{{nome}}'}</code>, <code>{'{{empresa}}'}</code>, <code>{'{{cidade}}'}</code> — e qualquer campo personalizado do lead.</div>
              <div><b>Spintax:</b> <code>{'{Oi|Olá|Bom dia}'}</code> sorteia uma opção em cada envio.</div>
              <div>O recomendado é ao menos <b>uma variável</b> e <b>duas variações</b> — mensagem idêntica para todo mundo é o que mais gera denúncia. Não é obrigatório: sem isso o disparo segue, só pesa na nota de risco.</div>
            </div>
          </Card>

          <Card class="p-4 space-y-3 lg:sticky lg:top-4">
            <div class="text-[0.6875rem] font-semibold text-fg-muted uppercase tracking-wider">Como vai sair</div>
            {diversity && (
              <div class={cn('rounded-md border p-2.5 text-xs',
                diversity.ratio >= 0.5 ? 'border-success/40 bg-success/10' : 'border-warning/40 bg-warning/10')}>
                <b>{Math.round(diversity.ratio * 100)}%</b> das mensagens sairiam diferentes entre si
                <span class="text-fg-muted"> ({diversity.distinct} textos distintos em {diversity.sampled} envios simulados)</span>
                {diversity.ratio < 0.5 && <div class="mt-1 text-fg-muted">Acrescente variações ou use mais variáveis — texto repetido em massa é fácil de agrupar.</div>}
              </div>
            )}
            {!samples.length ? (
              <p class="text-xs text-fg-subtle">Clique em "Ver como vai sair" para gerar 8 exemplos reais, com as variações sorteadas.</p>
            ) : (
              <div class="space-y-2 max-h-[32rem] overflow-auto">
                {samples.map((bubbles, i) => (
                  <div key={i} class="rounded-lg bg-surface-2 p-2.5 space-y-1.5">
                    {bubbles.filter(Boolean).map((t, j) => (
                      <p key={j} class="text-xs text-fg whitespace-pre-wrap break-words">{t}</p>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* PASSO 4 — ritmo */}
      {step === 4 && (
        <div class="grid gap-4 items-start lg:grid-cols-[minmax(0,1fr)_22rem] mt-3">
          <Card class="p-5 space-y-4">
            <div>
              <label class="text-[0.6875rem] text-fg-subtle uppercase tracking-wider">Ritmo</label>
              <div class="grid gap-2 mt-1">
                {pacingOptions.map((p) => (
                  <button key={p.key} type="button" onClick={() => setPacingKey(p.key)}
                    class={cn('text-left rounded-md border p-3 transition-colors', pacingKey === p.key ? 'border-primary bg-primary/10' : 'border-border hover:bg-surface-2')}>
                    <div class="flex items-center gap-2">
                      <span class="text-sm font-medium text-fg">{p.label}</span>
                      {p.key === 'conservador' && <Badge tone="success">Recomendado</Badge>}
                      {p.key === 'agressivo' && <Badge tone="danger">Risco alto</Badge>}
                    </div>
                    <div class="text-xs text-fg-muted mt-0.5">{p.hint}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label class="text-[0.6875rem] text-fg-subtle uppercase tracking-wider">Dias da semana</label>
              <div class="flex flex-wrap gap-1.5 mt-1">
                {WEEKDAYS.map((d) => {
                  const on = window.days.includes(d.v)
                  return (
                    <button key={d.v} type="button"
                      onClick={() => setWindow({ ...window, days: on ? window.days.filter((x) => x !== d.v) : [...window.days, d.v] })}
                      class={cn('h-7 px-3 rounded-full border text-xs font-medium transition-colors',
                        on ? 'bg-accent/15 text-accent border-accent' : 'bg-surface text-fg-muted border-border hover:text-fg')}>
                      {d.label}
                    </button>
                  )
                })}
              </div>
            </div>

            <div class="grid gap-3 sm:grid-cols-3">
              <Input label="Começa às" type="time" value={window.from} onInput={(e) => setWindow({ ...window, from: (e.target as HTMLInputElement).value })} />
              <Input label="Para às" type="time" value={window.to} onInput={(e) => setWindow({ ...window, to: (e.target as HTMLInputElement).value })} />
              <Input label="Máximo por número/dia" type="number" value={dailyCap}
                onInput={(e) => setDailyCap(Number((e.target as HTMLInputElement).value) || 20)}
                hint="Este valor manda. Acima da escada de aquecimento, só com número antigo." />
            </div>

            <div class="pt-3 border-t border-border space-y-3">
              <div class="flex items-center gap-1.5">
                <ShieldAlert size={13} class="text-accent" />
                <span class="text-sm font-medium text-fg">Proteções automáticas</span>
              </div>
              <div class="grid gap-3 sm:grid-cols-2">
                <Select label="Interromper a campanha sozinha" value={guardLevel}
                  onChange={(e) => setGuardLevel((e.target as HTMLSelectElement).value as GuardLevel)}>
                  <option value="strict">Rígido — para no primeiro sinal ruim</option>
                  <option value="normal">Padrão — para só diante de sinal forte</option>
                  <option value="off">Mínimo — só o essencial para salvar o número</option>
                </Select>
                <label class="flex items-start gap-2 text-xs text-fg cursor-pointer pt-6">
                  <input type="checkbox" checked={skipNumberCheck} class="mt-0.5"
                    onChange={(e) => setSkipNumberCheck((e.target as HTMLInputElement).checked)} />
                  <span>
                    <b>Não verificar se os números existem no WhatsApp.</b> A checagem protege o remetente,
                    mas é a etapa mais lenta e depende da conexão responder. Dispense em lista já conhecida.
                  </span>
                </label>
              </div>
              <p class="text-xs text-fg-muted -mt-1">
                {guardLevel === 'strict' && 'Para com 5 falhas seguidas, 20% de números inexistentes ou 150 envios sem resposta.'}
                {guardLevel === 'normal' && 'Para com 8 falhas seguidas, 35% de números inexistentes ou 400 envios sem resposta.'}
                {guardLevel === 'off' && 'A campanha não se interrompe por lista ruim ou silêncio. Sessão derrubada continua bloqueando o número — isso não se desliga.'}
              </p>
            </div>

            <div class="pt-3 border-t border-border space-y-3">
              <div class="flex items-center gap-1.5">
                <Reply size={13} class="text-accent" />
                <span class="text-sm font-medium text-fg">Quando responderem</span>
              </div>
              <p class="text-xs text-fg-muted -mt-1">
                Resposta é o resultado que importa. Quem responde sai da fila de qualquer outra campanha automaticamente —
                aqui você decide o que mais acontece com o lead.
              </p>
              <div class="grid gap-3 sm:grid-cols-3">
                <Select label="Mover para o funil" value={replyActions.moveToFunnelId ?? ''}
                  onChange={(e) => {
                    const v = Number((e.target as HTMLSelectElement).value) || undefined
                    setReplyActions({ ...replyActions, moveToFunnelId: v, moveToStageKey: undefined })
                  }}>
                  <option value="">Não mover</option>
                  {(funnelsData?.funnels ?? []).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </Select>
                <Select label="Etapa" value={replyActions.moveToStageKey ?? ''} disabled={!replyActions.moveToFunnelId}
                  onChange={(e) => setReplyActions({ ...replyActions, moveToStageKey: (e.target as HTMLSelectElement).value || undefined })}>
                  <option value="">Manter</option>
                  {(replyStages?.stages ?? []).map((st) => <option key={st.key} value={st.key}>{st.name}</option>)}
                </Select>
                <Select label="Atribuir a" value={replyActions.assignToUserId ?? ''}
                  onChange={(e) => setReplyActions({ ...replyActions, assignToUserId: Number((e.target as HTMLSelectElement).value) || undefined })}>
                  <option value="">Não atribuir</option>
                  {(agentsData?.agents ?? []).filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name || a.email}</option>)}
                </Select>
              </div>
              <label class="flex items-start gap-2 text-xs text-fg cursor-pointer">
                <input type="checkbox" checked={usePreferredTime} class="mt-0.5"
                  onChange={(e) => setUsePreferredTime((e.target as HTMLInputElement).checked)} />
                <span>
                  <b>Enviar no horário em que cada contato costuma responder.</b> Usa o histórico de mensagens recebidas
                  (mínimo 3) para reordenar a fila; quem não tem histórico segue a ordem normal.
                </span>
              </label>
              <label class="flex items-center gap-2 text-xs text-fg cursor-pointer">
                <input type="checkbox" checked={!!replyActions.createActivity}
                  onChange={(e) => setReplyActions({ ...replyActions, createActivity: (e.target as HTMLInputElement).checked })} />
                Criar atividade de retorno em 30 minutos (lead que responde esfria rápido)
              </label>
            </div>

            <div class="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-fg">
              O envio nunca sai fora desta janela, e cada dia começa com um atraso aleatório de até 35 minutos.
              Se o teto do dia acabar, o restante escorrega para o próximo dia útil — a campanha demora mais e o número sobrevive.
            </div>
          </Card>
          <RiskSidebar />
        </div>
      )}

      {/* PASSO 5 — revisão */}
      {step === 5 && (
        <div class="grid gap-4 items-start lg:grid-cols-[minmax(0,1fr)_22rem] mt-3">
          <Card class="p-5 space-y-4">
            <div class="grid gap-2 grid-cols-1 sm:grid-cols-3">
              <Stat label="Destinatários" value={audienceResult?.created ?? 0} tone="success" />
              <Stat label="Ignorados (opt-out/dup/inválido)" value={audienceResult?.skipped ?? 0} tone="warning" />
              <Stat label="Números no rodízio" value={selectedSenders.size} tone="info" />
            </div>

            <div class="rounded-md border border-border p-3 space-y-2">
              <div class="flex items-center gap-1.5">
                <Scale size={13} class="text-accent" />
                <span class="text-sm font-medium text-fg">Base legal do contato (LGPD)</span>
              </div>
              <Select value={legalBasis} onChange={(e) => setLegalBasis((e.target as HTMLSelectElement).value)}>
                <option value="">Selecione…</option>
                {LEGAL_BASIS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
              </Select>
              <p class="text-xs text-fg-muted">
                {LEGAL_BASIS.find((l) => l.value === legalBasis)?.hint
                  ?? 'Recomendado pela LGPD. Fica registrado na campanha junto de quem a iniciou.'}
              </p>
            </div>

            <div class="flex items-center gap-2 flex-wrap">
              <Button variant="primary" onClick={runSimulation} disabled={simulate.isPending}>
                <CalendarClock size={14} /> {simulate.isPending ? 'Simulando…' : 'Simular agenda'}
              </Button>
              <span class="text-xs text-fg-muted">Calcula tudo e não envia nada. Também confere quais números existem no WhatsApp.</span>
            </div>

            {problems.length > 0 && (
              <div class="rounded-md border border-danger/40 bg-danger/10 p-3 text-xs text-fg space-y-1">
                <div class="flex items-center gap-1.5 font-semibold text-danger"><ShieldAlert size={13} /> Pendências que impedem o disparo</div>
                {problems.map((p) => <div key={p}>• {p}</div>)}
              </div>
            )}

            {advisories.length > 0 && (
              <div class="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-fg space-y-1">
                <div class="flex items-center gap-1.5 font-semibold text-warning">
                  <ShieldAlert size={13} /> Recomendações — você pode disparar assim mesmo
                </div>
                {advisories.map((p) => <div key={p}>• {p}</div>)}
                <div class="pt-1 text-fg-muted">
                  Cada item aqui pesa na nota de risco ao lado. A decisão é sua, e fica registrada na campanha.
                </div>
              </div>
            )}

            {plan && <PlanView plan={plan} />}

            <Input label="Agendar para (opcional)" type="datetime-local" value={scheduledAt}
              onInput={(e) => setScheduledAt((e.target as HTMLInputElement).value)}
              hint="Vazio = começa assim que a janela de horário permitir." />
          </Card>
          <RiskSidebar />
        </div>
      )}

      {/* Navegação */}
      <div class="sticky bottom-0 -mx-1 px-1 pb-1 pt-3 bg-gradient-to-t from-surface via-surface to-transparent">
        <Card class="p-3 flex items-center justify-between gap-3 flex-wrap">
          <div class="text-xs text-fg-muted">
            {step === 1 && (name.trim() && selectedSenders.size ? 'Pronto para escolher a audiência.' : 'Informe o nome e ao menos um número.')}
            {step === 2 && (audienceTouched ? `${(audienceType === 'leads' ? selectedLeads.size : sheetTotal).toLocaleString('pt-BR')} selecionado(s)` : keptAudience ? `Mantendo ${keptAudience.created} destinatário(s)` : 'Selecione a audiência.')}
            {step === 3 && `${blocks.reduce((a, b) => a + (b.variants ?? []).filter((v) => v.trim()).length, 0)} variação(ões) escrita(s)`}
            {step === 4 && `${pacingOptions.find((o) => o.key === pacingKey)?.label ?? '—'} · ${window.from}–${window.to} · até ${dailyCap}/número/dia`}
            {step === 5 && (plan ? `${plan.totalPlanned} mensagem(ns) planejada(s)` : 'Simule antes de disparar.')}
          </div>
          <div class="flex items-center gap-2 ml-auto">
            {step > 1 && <Button variant="ghost" onClick={() => setStep(step - 1)} disabled={busy}><ArrowLeft size={14} /> Voltar</Button>}
            {step === 1 && <Button variant="primary" onClick={step1Next} disabled={busy}>Avançar <ArrowRight size={14} /></Button>}
            {step === 2 && <Button variant="primary" onClick={step2Next} disabled={busy}>Avançar <ArrowRight size={14} /></Button>}
            {step === 3 && <Button variant="primary" onClick={step3Next} disabled={busy}>Avançar <ArrowRight size={14} /></Button>}
            {step === 4 && <Button variant="primary" onClick={step4Next} disabled={busy}>Processar audiência <ArrowRight size={14} /></Button>}
            {step === 5 && (
              // Simular deixou de ser obrigatório: o start replaneja de qualquer
              // forma, e exigir a simulação só adiava o disparo de quem já sabe
              // o que vai enviar.
              <Button variant="primary" onClick={finish} disabled={busy || problems.length > 0 || (audienceResult?.created ?? 0) === 0}>
                {scheduledAt ? <><Clock size={14} /> Agendar</> : <><Send size={14} /> Iniciar campanha</>}
              </Button>
            )}
          </div>
        </Card>
      </div>
    </Page>
  )
}

/**
 * Nota de risco antes do disparo. Junta num lugar só o que já estava espalhado
 * (aquecimento, tamanho da lista, diversidade do texto, qualidade dos números)
 * e diz, em uma frase, se vale apertar o botão.
 */
function RiskPanel({ risk }: { risk: RiskReport }) {
  const tone = risk.level === 'baixo' ? 'success' : risk.level === 'medio' ? 'warning' : 'danger'
  const border = { success: 'border-success/40 bg-success/10', warning: 'border-warning/40 bg-warning/10', danger: 'border-danger/40 bg-danger/10' }[tone]
  const text = { success: 'text-success', warning: 'text-warning', danger: 'text-danger' }[tone]
  return (
    <div class={cn('rounded-md border p-3', border)}>
      <div class="flex items-center gap-2 mb-1">
        <Gauge size={14} class={text} />
        <span class="text-sm font-semibold text-fg">Risco {risk.level === 'medio' ? 'médio' : risk.level}</span>
        <span class={cn('text-sm font-bold ml-auto', text)}>{risk.score}/100</span>
      </div>
      <p class="text-xs text-fg mb-2">{risk.headline}</p>
      {risk.factors.length > 0 && (
        <ul class="space-y-1.5">
          {risk.factors.map((f) => (
            <li key={f.key} class="text-xs">
              <span class={cn('font-medium',
                f.severity === 'danger' ? 'text-danger' : f.severity === 'warning' ? 'text-warning' : 'text-fg')}>
                {f.label}
              </span>
              <span class="text-fg-subtle"> −{f.penalty}</span>
              <div class="text-fg-muted">{f.detail}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Lista de bloqueio: telefones que não recebem disparo de campanha nenhuma. */
function SuppressionModal({ onClose }: { onClose: () => void }) {
  const [search, setSearch] = useState('')
  const [input, setInput] = useState('')
  const [note, setNote] = useState('')
  const { data } = useSuppressions(search)
  const add = useAddSuppression()
  const remove = useRemoveSuppression()

  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose() }} title="Lista de bloqueio" size="lg">
      <div class="space-y-4">
        <p class="text-xs text-fg-muted">
          Telefones aqui não recebem disparo de nenhuma campanha, agora ou depois. Vale para pedido por outro canal,
          número errado, ou determinação jurídica — e sobrevive à exclusão do lead, porque é gravado pelo telefone.
        </p>

        <div class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] items-end">
          <Textarea label="Telefones" rows={3} value={input}
            placeholder={'5562999998888\n5511944742843'}
            onInput={(e) => setInput((e.target as HTMLTextAreaElement).value)}
            hint="Um por linha (ou separados por vírgula)." />
          <Button variant="primary" disabled={add.isPending || !input.trim()}
            onClick={() => add.mutate({ phones: input, note: note || undefined }, {
              onSuccess: (r) => { toast(`${r.added} bloqueado(s)${r.invalid ? ` · ${r.invalid} inválido(s)` : ''}`, 'success'); setInput(''); setNote('') },
              onError: () => toast('Falha ao bloquear', 'danger'),
            })}>
            <Ban size={14} /> Bloquear
          </Button>
        </div>
        <Input label="Motivo (opcional)" value={note} onInput={(e) => setNote((e.target as HTMLInputElement).value)}
          placeholder="Ex.: pediu por telefone para não receber mais" />

        <div class="pt-3 border-t border-border space-y-2">
          <div class="flex items-center justify-between gap-2">
            <Input label="" value={search} placeholder="Buscar telefone…"
              onInput={(e) => setSearch((e.target as HTMLInputElement).value)} />
            <span class="text-xs text-fg-muted shrink-0">{data?.total ?? 0} bloqueado(s)</span>
          </div>
          <div class="max-h-72 overflow-auto divide-y divide-border border border-border rounded-md">
            {(data?.items ?? []).length === 0 ? (
              <div class="px-3 py-6 text-center text-sm text-fg-muted">Nenhum telefone bloqueado.</div>
            ) : (data?.items ?? []).map((it) => (
              <div key={it.id} class="flex items-center gap-2 px-3 py-2 text-xs">
                <span class="text-fg font-mono">{it.phone}</span>
                <span class="text-fg-subtle">{it.note || it.reason}</span>
                <span class="ml-auto text-fg-subtle">{new Date(it.createdAt).toLocaleDateString('pt-BR')}</span>
                <button type="button" class="text-fg-muted hover:text-danger" title="Remover da lista"
                  onClick={() => remove.mutate(it.id, { onSuccess: () => toast('Removido da lista', 'success') })}>
                  <XIcon size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  )
}

/** Lembrete permanente do que está em jogo — o módulo mexe com o chip da empresa. */
function RiskSidebar() {
  return (
    <Card class="p-4 space-y-2 lg:sticky lg:top-4">
      <div class="flex items-center gap-1.5 text-[0.6875rem] font-semibold text-fg-muted uppercase tracking-wider">
        <ShieldAlert size={12} /> O que protege o número
      </div>
      <ul class="text-xs text-fg-muted space-y-1.5 list-disc pl-4">
        <li>Intervalos irregulares e pausas entre sessões, nunca um ritmo fixo.</li>
        <li>"Digitando…" antes de cada mensagem, proporcional ao tamanho do texto.</li>
        <li>Teto diário por número, que sobe conforme o chip aquece.</li>
        <li>Números inexistentes no WhatsApp são descartados antes do envio.</li>
        <li>Quem responde sai da fila; quem pede "PARE" entra no opt-out.</li>
        <li>Queda de sessão ou excesso de falhas pausa a campanha automaticamente.</li>
      </ul>
      <p class="text-[0.6875rem] text-fg-subtle pt-1 border-t border-border">
        Nada disso substitui lista com relacionamento: a maior causa de bloqueio é o destinatário denunciar.
      </p>
    </Card>
  )
}

/** Resumo da agenda calculada — o que o operador vê antes de autorizar. */
function PlanView({ plan }: { plan: PlanSummary }) {
  return (
    <div class="space-y-3">
      {plan.risk && <RiskPanel risk={plan.risk} />}
      <div class="grid gap-2 grid-cols-2 sm:grid-cols-4">
        <Stat label="Planejadas" value={plan.totalPlanned} tone="success" />
        <Stat label="Sem WhatsApp" value={plan.notOnWhatsApp} tone={plan.notOnWhatsApp > 0 ? 'warning' : 'neutral'} />
        <Stat label="Já conversaram" value={plan.byAffinity} tone="info" />
        <Stat label="Dias de campanha" value={plan.perDay.length} />
      </div>
      <div class="text-xs text-fg">
        Começa <b>{fmtDateTime(plan.firstAt)}</b> e termina <b>{fmtDateTime(plan.lastAt)}</b>.
        {plan.diversity?.sampled > 0 && (
          <> Mensagens diferentes entre si: <b>{Math.round((plan.diversity.ratio ?? 0) * 100)}%</b>.</>
        )}
      </div>
      {plan.warnings.length > 0 && (
        <div class="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-fg space-y-1">
          {plan.warnings.map((w) => <div key={w}>⚠ {w}</div>)}
        </div>
      )}
      <div class="grid gap-2 sm:grid-cols-2">
        <div class="rounded-md border border-border p-3">
          <div class="text-[0.6875rem] font-semibold text-fg-muted uppercase tracking-wider mb-1.5">Por número</div>
          {plan.perSender.map((s) => (
            <div key={s.instanceName} class="flex items-center justify-between text-xs py-0.5">
              <span class="text-fg truncate">{s.instanceName}</span>
              <span class="text-fg-muted">{s.count} · até {s.dailyCap}/dia</span>
            </div>
          ))}
        </div>
        <div class="rounded-md border border-border p-3">
          <div class="text-[0.6875rem] font-semibold text-fg-muted uppercase tracking-wider mb-1.5">Por dia</div>
          <div class="max-h-32 overflow-auto">
            {plan.perDay.map((d) => (
              <div key={d.day} class="flex items-center justify-between text-xs py-0.5">
                <span class="text-fg">{d.day.split('-').reverse().join('/')}</span>
                <span class="text-fg-muted">{d.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────── DETALHE ───────────────────────────
function CampaignDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const { data } = useSmartCampaign(id, 8000)
  const { data: sendersData } = useSenders()
  const { data: variantData } = useVariantPerformance(id, 20000)
  const action = useSmartCampaignAction()
  const campaign = data?.campaign
  const metrics = data?.metrics
  const recipients = data?.recipients ?? []
  if (!campaign) return <Page title="Carregando…"><div /></Page>

  const c = campaign.status
  const poolNames = new Set((campaign.senderInstances ?? []).map((s) => s.instanceName))
  const senders = (sendersData?.senders ?? []).filter((s) => poolNames.has(s.instanceName))

  return (
    <Page title={campaign.name}
      description={`${(campaign.senderInstances ?? []).length} número(s) · ${campaign.windowConfig?.from ?? '09:00'}–${campaign.windowConfig?.to ?? '18:00'}`}
      actions={<div class="flex items-center gap-2">
        <Button variant="ghost" onClick={onBack}><ArrowLeft size={14} /> Voltar</Button>
        {c === 'running' && <Button variant="ghost" onClick={() => action.mutate({ id, action: 'pause' })}><Pause size={14} /> Pausar</Button>}
        {c === 'paused' && <Button variant="primary" onClick={() => action.mutate({ id, action: 'resume' })}><Play size={14} /> Retomar</Button>}
        {['running', 'paused', 'scheduled'].includes(c) && <Button variant="ghost" onClick={() => action.mutate({ id, action: 'cancel' })}><XIcon size={14} /> Cancelar</Button>}
      </div>}>
      <div class="space-y-4">
        {campaign.riskReason && (
          <div class="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-fg">
            <ShieldAlert size={14} class="text-danger shrink-0 mt-0.5" />
            <span><b>Proteção acionada:</b> {campaign.riskReason}</span>
          </div>
        )}

        <Card class="p-4">
          <div class="flex items-center gap-2 mb-3 flex-wrap">
            <Badge tone={STATUS_TONE[c]}>{STATUS_LABEL[c]}</Badge>
            <span class="text-xs text-fg-muted">{metrics?.progress ?? 0}% processado</span>
            {metrics?.nextSendAt && <span class="text-xs text-fg-subtle">· próxima mensagem {fmtDateTime(metrics.nextSendAt)}</span>}
          </div>
          <div class="h-1.5 rounded-full bg-surface-3 overflow-hidden mb-3">
            <div class="h-full bg-accent rounded-full transition-[width] duration-500" style={{ width: `${metrics?.progress ?? 0}%` }} />
          </div>
          <div class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
            <Stat label="Total" value={metrics?.total ?? 0} />
            <Stat label="Na agenda" value={(metrics?.counts.pending ?? 0) + (metrics?.counts.scheduled ?? 0)} />
            <Stat label="Enviadas" value={metrics?.counts.sent ?? 0} />
            <Stat label="Entregues" value={metrics?.counts.delivered ?? 0} tone="info" />
            <Stat label="Respondidas" value={metrics?.counts.replied ?? 0} tone="success" />
            <Stat label="Falhas" value={metrics?.counts.failed ?? 0} tone="danger" />
            <Stat label="Taxa de resposta" value={`${metrics?.replyRate ?? 0}%`} tone={(metrics?.replyRate ?? 0) >= 5 ? 'success' : 'warning'} />
          </div>
          {Object.keys(metrics?.skips ?? {}).length > 0 && (
            <div class="text-xs text-fg-muted mt-2">
              Ignorados: {Object.entries(metrics!.skips).map(([k, v]) => `${SKIP_LABEL[k] ?? k} (${v})`).join(' · ')}
            </div>
          )}
        </Card>

        <SenderHealthPanel senders={senders} />

        <VariantPanel variants={variantData?.variants ?? []} />

        <Card class="p-0 overflow-hidden">
          <div class="p-3 border-b border-border flex items-center justify-between gap-2">
            <span class="text-sm font-semibold text-fg">Agenda de envios</span>
            <span class="text-xs text-fg-muted">{recipients.length} listado(s)</span>
          </div>
          <div class="max-h-[min(60vh,44rem)] overflow-auto">
            <table class="w-full text-xs">
              <thead class="sticky top-0 bg-surface-2 text-fg-muted">
                <tr>
                  <th class="text-left font-medium px-3 py-2">Nome</th>
                  <th class="text-left font-medium px-3 py-2 hidden sm:table-cell">Telefone</th>
                  <th class="text-left font-medium px-3 py-2">Número/horário</th>
                  <th class="text-left font-medium px-3 py-2">Situação</th>
                  <th class="text-left font-medium px-3 py-2">Detalhe</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-border">
                {recipients.length === 0 ? (
                  <tr><td colSpan={5} class="px-3 py-6 text-center text-sm text-fg-muted">Nenhum destinatário ainda.</td></tr>
                ) : recipients.map((r) => (
                  <tr key={r.id} class="hover:bg-surface-2">
                    <td class="px-3 py-2 text-fg truncate max-w-[14rem]">{r.name || '—'}</td>
                    <td class="px-3 py-2 text-fg-subtle hidden sm:table-cell">{r.phone}</td>
                    <td class="px-3 py-2 text-fg-subtle">
                      {r.assignedInstance ? <span class="text-fg">{r.assignedInstance}</span> : '—'}
                      {r.plannedAt && <span class="block text-[0.625rem]">{fmtDateTime(r.plannedAt)}</span>}
                    </td>
                    <td class="px-3 py-2">
                      <Badge tone={
                        r.status === 'replied' ? 'success' : r.status === 'failed' ? 'danger'
                          : r.status === 'read' || r.status === 'delivered' ? 'info'
                            : r.status === 'skipped' ? 'warning' : 'neutral'
                      }>{RECIPIENT_STATUS[r.status] ?? r.status}</Badge>
                    </td>
                    <td class="px-3 py-2">
                      {r.error && <span class="text-danger" title={r.error}>{r.error.slice(0, 60)}</span>}
                      {r.skipReason && <span class="text-warning">{SKIP_LABEL[r.skipReason] ?? r.skipReason}</span>}
                      {!r.error && !r.skipReason && <span class="text-fg-subtle truncate block max-w-[18rem]" title={r.sentText ?? ''}>{r.sentText?.slice(0, 60) ?? '—'}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </Page>
  )
}

/**
 * Desempenho por variação de texto. Não é vaidade de copy: variação que ninguém
 * responde é variação que o WhatsApp lê como spam — e o custo disso é o número.
 */
function VariantPanel({ variants }: { variants: Array<{ index: number; text: string; sent: number; replied: number; failed: number; replyRate: number }> }) {
  const withSends = variants.filter((v) => v.sent > 0)
  if (withSends.length < 1) return null
  const best = Math.max(...withSends.map((v) => v.replyRate))
  return (
    <Card class="p-4">
      <div class="flex items-center gap-2 mb-3">
        <BarChart3 size={14} class="text-accent" />
        <span class="text-sm font-semibold text-fg">Desempenho por variação</span>
        <span class="text-xs text-fg-subtle">quem responde mais deve virar a variação principal</span>
      </div>
      <div class="space-y-2">
        {withSends.map((v) => (
          <div key={v.index} class="rounded-md border border-border p-3">
            <div class="flex items-center justify-between gap-3 mb-1">
              <span class="text-xs font-medium text-fg">Variação {v.index + 1}</span>
              <span class="flex items-center gap-2 text-xs">
                <span class="text-fg-muted">{v.sent} envio(s)</span>
                <Badge tone={v.replyRate >= best && best > 0 ? 'success' : v.replyRate > 0 ? 'info' : 'neutral'}>
                  {v.replyRate}% de resposta
                </Badge>
              </span>
            </div>
            <p class="text-xs text-fg-muted whitespace-pre-wrap break-words">{v.text}</p>
          </div>
        ))}
      </div>
    </Card>
  )
}

const RECIPIENT_STATUS: Record<string, string> = {
  pending: 'Aguardando', scheduled: 'Agendada', sending: 'Enviando', sent: 'Enviada',
  delivered: 'Entregue', read: 'Lida', replied: 'Respondeu', failed: 'Falhou', skipped: 'Ignorada',
}
const SKIP_LABEL: Record<string, string> = {
  opt_out: 'pediu para sair', invalid_phone: 'telefone inválido', duplicate: 'duplicado',
  not_on_whatsapp: 'sem WhatsApp', governance: 'bloqueado por regra', cap: 'teto do número',
  canceled: 'cancelada', blacklist: 'lista negra', sender_blocked: 'número bloqueado', no_sender: 'sem número',
  replied_elsewhere: 'já respondeu em outra campanha',
}
