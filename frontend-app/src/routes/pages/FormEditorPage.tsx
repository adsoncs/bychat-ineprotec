// Editor de formulário em TELA DEDICADA — builder visual estilo Landing Pages:
// lista de blocos (campos + boas-vindas/sucesso) | canvas iframe (SSR real,
// clique-pra-selecionar) | painel de propriedades. Configurações não-campo num
// drawer. O form publicado (/f/:slug conversacional e embed clássico) é intocado.
import { useMemo, useState, useEffect, useRef } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import {
  ArrowLeft, Save, ExternalLink, Plus, GripVertical, EyeOff, Trash2,
  Monitor, Tablet, Smartphone, Settings, X, Sparkles, CheckCircle2,
  CalendarClock, Target, Megaphone, MessageSquare, Palette, Share2, MousePointerClick,
} from 'lucide-preact'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { Card } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { Badge } from '@/components/ui/Badge'
import { SortableList } from '@/components/ui/SortableList'
import { toast } from '@/lib/toast'
import {
  useForm, useUpdateForm, useFormPreview, resolveFormStyling,
  type FormField, type FormSettings, type FormStyling,
} from '@/hooks/useForms'
import {
  AddFieldPalette, FieldEditorColumn, buildUniqueField,
} from '@/components/FormFieldsEditor'
import { RichText, stripHtml } from '@/components/ui/RichText'
import { FormAppearancePanel } from '@/components/FormAppearancePanel'
import { useFunnels, useStages } from '@/hooks/useFunnels'
import { useTeams } from '@/hooks/useTeams'
import { useModules } from '@/hooks/useModules'
import { useMeetingTypes, useSaveMeetingType } from '@/hooks/useScheduling'

// Pseudo-blocos (telas que não são campo) — combinam com formRenderer.ts no backend.
const WELCOME_ID = '__welcome__'
const SUCCESS_ID = '__success__'

type Device = 'desktop' | 'tablet' | 'mobile'
const DEVICE_WIDTH: Record<Device, string> = { desktop: '100%', tablet: '768px', mobile: '390px' }

// Seções do drawer de Configurações (tudo que não é campo nem welcome/sucesso).
type Section = 'destination' | 'conversion' | 'scheduling' | 'messages' | 'buttons' | 'appearance' | 'share'
const SECTIONS: { id: Section; label: string; icon: any }[] = [
  { id: 'destination', label: 'Destino & Rota',     icon: Target },
  { id: 'scheduling',  label: 'Agendamento',        icon: CalendarClock },
  { id: 'conversion',  label: 'Conversão',          icon: Megaphone },
  { id: 'messages',    label: 'Mensagens',          icon: MessageSquare },
  { id: 'buttons',     label: 'Botões & CTA',       icon: MousePointerClick },
  { id: 'appearance',  label: 'Aparência',          icon: Palette },
  { id: 'share',       label: 'Compartilhar',       icon: Share2 },
]

// Eventos padrão do Meta (Pixel/CAPI). value = nome interno (inglês) que o Meta
// espera; label mostra o nome em PT-BR como aparece no Gerenciador de Eventos.
const META_EVENTS: { value: string; label: string }[] = [
  { value: 'Lead', label: 'Lead (Cadastro de lead)' },
  { value: 'Schedule', label: 'Programar (Schedule)' },
  { value: 'Contact', label: 'Contato (Contact)' },
  { value: 'CompleteRegistration', label: 'Cadastro concluído (CompleteRegistration)' },
  { value: 'SubmitApplication', label: 'Enviar inscrição (SubmitApplication)' },
  { value: 'Subscribe', label: 'Assinar (Subscribe)' },
  { value: 'StartTrial', label: 'Iniciar avaliação (StartTrial)' },
  { value: 'Purchase', label: 'Compra (Purchase)' },
]

function isFieldArray(v: unknown): v is FormField[] {
  return Array.isArray(v) && v.every((it) => typeof it === 'object' && it !== null && 'id' in it && 'type' in it)
}

export function FormEditorPage({ params }: { params: { id: string } }) {
  const formId = parseInt(params.id)
  const [, navigate] = useLocation()
  const { data, isLoading } = useForm(Number.isNaN(formId) ? null : formId)
  const update = useUpdateForm()
  const preview = useFormPreview()
  const saveMeetingType = useSaveMeetingType()

  const { data: funnels } = useFunnels()
  const { data: teamsData } = useTeams()
  const teams = (teamsData?.teams ?? []).filter((t) => t.active)
  const modulesQ = useModules()
  const schedulingOn = modulesQ.data?.modules?.some((m) => m.id === 'scheduling' && m.enabled) ?? false
  const meetingTypesQ = useMeetingTypes(schedulingOn)
  const activeMeetingTypes = meetingTypesQ.data?.items?.filter((m) => m.active) ?? []

  // ── estado editável (hidratado uma vez) ──
  const [hydrated, setHydrated] = useState(false)
  const [section, setSection] = useState<Section>('destination')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [device, setDevice] = useState<Device>('desktop')
  const [canvasHtml, setCanvasHtml] = useState('')
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [displayMode, setDisplayMode] = useState<'classic' | 'conversational'>('classic')
  const [fields, setFields] = useState<FormField[]>([])
  // activeId guarda o id de um campo OU as sentinelas __welcome__/__success__.
  const [activeId, setActiveId] = useState<string | null>(null)
  const activeRef = useRef<string | null>(null)
  activeRef.current = activeId
  const [funnelId, setFunnelId] = useState('')
  const [stageKey, setStageKey] = useState('')
  const [defaultTeamId, setDefaultTeamId] = useState('')
  const [partialCapture, setPartialCapture] = useState(true)
  const [qualifyPositiveStage, setQualifyPositiveStage] = useState('')
  const [qualifyNegativeStage, setQualifyNegativeStage] = useState('')
  const [notifyEmails, setNotifyEmails] = useState('')
  const [webhookUrl, setWebhookUrl] = useState('')
  const [styling, setStyling] = useState<FormStyling>(() => ({ ...resolveFormStyling(null) }))
  const [submitText, setSubmitText] = useState('Enviar')
  const [successTitle, setSuccessTitle] = useState('Enviado com sucesso!')
  const [successMessage, setSuccessMessage] = useState('Entraremos em contato em breve.')
  const [successHtml, setSuccessHtml] = useState('')
  const [successMode, setSuccessMode] = useState<'message' | 'redirect'>('message')
  const [redirectUrl, setRedirectUrl] = useState('')
  const [fireConversions, setFireConversions] = useState(false)
  const [metaPixelId, setMetaPixelId] = useState('')
  const [metaEventName, setMetaEventName] = useState('Lead')
  const [googleConversionId, setGoogleConversionId] = useState('')
  const [googleConversionLabel, setGoogleConversionLabel] = useState('')
  const [welcomeEnabled, setWelcomeEnabled] = useState(false)
  const [welcomeTitle, setWelcomeTitle] = useState('')
  const [welcomeText, setWelcomeText] = useState('')
  const [welcomeIcon, setWelcomeIcon] = useState('')
  const [welcomeImageUrl, setWelcomeImageUrl] = useState('')
  const [startButtonText, setStartButtonText] = useState('Começar')
  const [navButtonText, setNavButtonText] = useState('OK')
  const [showProgress, setShowProgress] = useState(true)

  const { data: stagesData } = useStages(funnelId ? Number(funnelId) : null)
  const stages = stagesData?.stages ?? []

  if (data && !hydrated) {
    setName(data.name ?? '')
    setSlug(data.slug ?? '')
    setFields(isFieldArray(data.fields) ? data.fields : [])
    setActiveId((isFieldArray(data.fields) ? data.fields[0]?.id : null) ?? null)
    setFunnelId(data.funnelId ? String(data.funnelId) : '')
    setStageKey(data.stageKey ?? '')
    setDefaultTeamId(data.defaultTeamId ? String(data.defaultTeamId) : '')
    const jn = (data.settings ?? {}).journey ?? {}
    setPartialCapture(jn.partialCapture !== false)
    setQualifyPositiveStage(jn.qualifyPositive?.stageKey ?? '')
    setQualifyNegativeStage(jn.qualifyNegative?.stageKey ?? '')
    setNotifyEmails(data.notifyEmails ?? '')
    setWebhookUrl(data.webhookUrl ?? '')
    setStyling(resolveFormStyling(data.styling))
    const s: FormSettings = data.settings ?? {}
    setSubmitText(s.submitText ?? 'Enviar')
    setSuccessTitle(s.successTitle ?? 'Enviado com sucesso!')
    setSuccessMessage(s.successMessage ?? 'Entraremos em contato em breve.')
    setSuccessHtml(s.successHtml ?? '')
    setRedirectUrl(s.redirectUrl ?? '')
    setSuccessMode(s.successMode ?? ((s.redirectEnabled ?? !!(s.redirectUrl && s.redirectUrl.trim())) ? 'redirect' : 'message'))
    setDisplayMode(s.displayMode === 'conversational' ? 'conversational' : 'classic')
    setFireConversions(s.fireConversions ?? (s.displayMode === 'conversational'))
    const px = s.pixels ?? {}
    setMetaPixelId(px.metaPixelId ?? '')
    setMetaEventName(px.metaEventName ?? 'Lead')
    setGoogleConversionId(px.googleConversionId ?? '')
    setGoogleConversionLabel(px.googleConversionLabel ?? '')
    const cv = s.conversational ?? {}
    setWelcomeEnabled(cv.welcomeEnabled ?? false)
    setWelcomeTitle(cv.welcomeTitle ?? '')
    setWelcomeText(cv.welcomeText ?? '')
    setWelcomeIcon(cv.welcomeIcon ?? '')
    setWelcomeImageUrl(cv.welcomeImageUrl ?? '')
    setStartButtonText(cv.startButtonText ?? 'Começar')
    setNavButtonText(cv.navButtonText ?? 'OK')
    setShowProgress(cv.showProgress ?? true)
    setHydrated(true)
  }

  const touch = () => setDirty(true)
  const activeField = useMemo(() => fields.find((f) => f.id === activeId) ?? null, [fields, activeId])

  function patchField(id: string, partial: Partial<FormField>) {
    setFields((arr) => arr.map((f) => (f.id === id ? { ...f, ...partial } : f))); touch()
  }
  function removeField(id: string) {
    setFields((arr) => {
      const idx = arr.findIndex((f) => f.id === id)
      const next = arr.filter((f) => f.id !== id)
      setActiveId((curr) => (curr !== id ? curr : (next[idx]?.id ?? next[idx - 1]?.id ?? next[0]?.id ?? null)))
      return next
    }); touch()
  }
  function addReadyField(base: Omit<FormField, 'id'>) {
    setFields((arr) => {
      const f = buildUniqueField(base, arr.map((x) => x.key))
      setActiveId(f.id)
      return [...arr, f]
    }); touch()
  }

  const settings: FormSettings = useMemo(() => ({
    submitText: submitText.trim() || 'Enviar',
    successTitle: successTitle.trim() || 'Enviado!',
    successMessage: successMessage.trim() || '',
    successHtml: successHtml.trim(),
    successMode,
    redirectUrl: successMode === 'redirect' ? (redirectUrl.trim() || null) : null,
    redirectEnabled: successMode === 'redirect',
    displayMode,
    fireConversions,
    pixels: {
      metaPixelId: metaPixelId.trim(),
      metaEventName: metaEventName.trim() || 'Lead',
      googleConversionId: googleConversionId.trim(),
      googleConversionLabel: googleConversionLabel.trim(),
    },
    conversational: {
      showProgress, welcomeEnabled,
      welcomeTitle: welcomeTitle.trim(), welcomeText: welcomeText.trim(),
      welcomeIcon: welcomeIcon.trim(), welcomeImageUrl: welcomeImageUrl.trim(),
      startButtonText: startButtonText.trim() || 'Começar', navButtonText: navButtonText.trim() || 'OK',
    },
    journey: {
      partialCapture,
      qualifyPositive: { funnelId: funnelId ? Number(funnelId) : null, stageKey: qualifyPositiveStage || null },
      qualifyNegative: { funnelId: funnelId ? Number(funnelId) : null, stageKey: qualifyNegativeStage || null },
    },
  }), [submitText, successTitle, successMessage, successHtml, successMode, redirectUrl, displayMode, fireConversions, metaPixelId, metaEventName, googleConversionId, googleConversionLabel, showProgress, welcomeEnabled, welcomeTitle, welcomeText, welcomeIcon, welcomeImageUrl, startButtonText, navButtonText, partialCapture, funnelId, qualifyPositiveStage, qualifyNegativeStage])

  // ── Canvas: re-render via endpoint SSR (modo edit), com debounce ──
  useEffect(() => {
    if (!hydrated) return
    const t = setTimeout(() => {
      preview.mutate({ id: formId, fields, settings, styling, edit: true },
        { onSuccess: (html) => setCanvasHtml(html), onError: () => {} })
    }, 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, settings, styling, hydrated])

  // ── Ponte de seleção: cliques dentro do iframe → seleção no painel ──
  useEffect(() => {
    function onMsg(e: MessageEvent) {
      const d = (e.data || {}) as { source?: string; type?: string; id?: string }
      if (d.source !== 'forms-canvas') return
      if (d.type === 'select' && d.id) setActiveId(d.id)
      if (d.type === 'ready' && activeRef.current) postHighlight(activeRef.current, false)
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [])

  function postHighlight(id: string, scroll: boolean) {
    iframeRef.current?.contentWindow?.postMessage({ type: 'forms-highlight', id, scroll }, '*')
  }
  function selectBlock(id: string) {
    setActiveId(id)
    postHighlight(id, true)
  }

  function handleSave() {
    if (!name.trim()) { toast('Dê um nome ao formulário', 'danger'); return }
    if (successMode === 'redirect' && !redirectUrl.trim()) { toast('Informe a URL de redirecionamento', 'danger'); return }
    update.mutate({
      id: formId,
      name: name.trim(),
      slug: slug.trim() || null,
      funnelId: funnelId ? Number(funnelId) : null,
      stageKey: stageKey || null,
      defaultTeamId: defaultTeamId ? Number(defaultTeamId) : null,
      notifyEmails: notifyEmails.trim() || null,
      webhookUrl: webhookUrl.trim() || null,
      fields,
      settings,
      styling,
    }, {
      onSuccess: () => { toast('Formulário salvo', 'success'); setDirty(false) },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }
  function handleBack() {
    if (dirty && !confirm('Você tem alterações não salvas. Sair mesmo assim?')) return
    navigate('/forms')
  }

  // Agendamento é um CAMPO (type 'scheduling'); o tipo de reunião vem dele.
  const schedulingField = fields.find((f) => f.type === 'scheduling')
  const selectedMt = schedulingField?.meetingSlug ? (activeMeetingTypes.find((m) => m.slug === schedulingField.meetingSlug) ?? null) : null

  if (isLoading || (!data && !Number.isNaN(formId))) {
    return <div class="p-6"><Skeleton class="h-96 w-full" /></div>
  }
  if (Number.isNaN(formId) || !data) {
    return <div class="p-6 text-sm text-fg-muted">Formulário não encontrado. <a class="text-accent" onClick={() => navigate('/forms')}>Voltar</a></div>
  }

  const usedKeys = fields.map((f) => f.key)

  // A página é um overlay em tela cheia. Fica em --z-fullscreen (abaixo do modal):
  // a paleta "Adicionar campo" é um Dialog portalizado pro document.body (z-modal
  // 70) — com a página em z 80 ela abria ATRÁS do fundo opaco e o botão parecia
  // não funcionar.
  return (
    <div class="fixed inset-0 bg-surface flex flex-col" style={{ zIndex: 'var(--z-fullscreen)' }}>
      {/* Topbar */}
      <header class="h-14 shrink-0 border-b border-border bg-surface flex items-center gap-2 px-3">
        <Button variant="ghost" size="sm" class="shrink-0" onClick={handleBack}><ArrowLeft size={16} /> Voltar</Button>
        <input
          value={name}
          onInput={(e) => { setName((e.target as HTMLInputElement).value); touch() }}
          class="min-w-0 flex-1 bg-transparent text-sm font-semibold text-fg outline-none"
          placeholder="Nome do formulário"
        />

        {/* Ações (nunca encolhem — só o nome acima encolhe) */}
        <div class="flex items-center gap-2 shrink-0">
          {/* Clássico / Conversacional */}
          <div class="hidden md:inline-flex rounded-md border border-border overflow-hidden text-xs">
            {(['classic', 'conversational'] as const).map((m) => (
              <button key={m} onClick={() => { setDisplayMode(m); touch() }}
                class={`h-7 px-2.5 ${displayMode === m ? 'bg-accent text-fg-on-brand' : 'bg-surface text-fg-muted hover:text-fg'}`}>
                {m === 'classic' ? 'Clássico' : 'Conversacional'}
              </button>
            ))}
          </div>

          {/* Dispositivo */}
          <div class="hidden lg:flex items-center gap-0.5 rounded-md border border-border p-0.5">
            {([['desktop', Monitor], ['tablet', Tablet], ['mobile', Smartphone]] as [Device, typeof Monitor][]).map(([d, Icon]) => (
              <button key={d} type="button" title={d}
                class={`size-7 rounded grid place-items-center transition-colors ${device === d ? 'bg-accent text-fg-on-brand' : 'text-fg-muted hover:text-fg hover:bg-surface-3'}`}
                onClick={() => setDevice(d)}>
                <Icon size={14} />
              </button>
            ))}
          </div>

          <Button variant="ghost" size="sm" onClick={() => setSettingsOpen(true)}><Settings size={14} /> <span class="hidden sm:inline">Configurações</span></Button>
          {slug && (
            <a href={`${location.origin}/f/${slug}`} target="_blank" rel="noreferrer" class="hidden sm:inline-flex items-center gap-1 text-sm text-accent hover:underline px-1"><ExternalLink size={14} /> Abrir</a>
          )}
          <Button variant="primary" size="sm" onClick={handleSave} disabled={!dirty || update.isPending}>
            <Save size={14} /> {update.isPending ? 'Salvando…' : dirty ? 'Salvar' : 'Salvo'}
          </Button>
        </div>
      </header>

      {/* Corpo: lista | canvas | propriedades */}
      <div class="flex-1 min-h-0 grid grid-cols-[18rem_minmax(0,1fr)_22rem]">
        {/* Esquerda: blocos */}
        <div class="min-h-0 min-w-0 border-r border-border overflow-y-auto p-3 bg-surface space-y-2">
          <BlockRow icon={Sparkles} label="Tela de boas-vindas" active={activeId === WELCOME_ID}
            badge={!welcomeEnabled ? 'oculta' : undefined} onClick={() => selectBlock(WELCOME_ID)} />

          <div class="flex items-center justify-between pt-1">
            <h4 class="text-xs font-semibold uppercase tracking-wider text-fg-muted">Campos ({fields.length})</h4>
            <Button variant="ghost" size="sm" onClick={() => setPaletteOpen(true)}><Plus size={12} /> Adicionar</Button>
          </div>
          {fields.length === 0 ? (
            <p class="text-xs text-fg-subtle">Nenhum campo. Clique em "Adicionar" para começar.</p>
          ) : (
            <SortableList items={fields} onReorder={(n) => { setFields(n); touch() }} renderItem={(f) => (
              <div class={`group rounded-md border px-2 py-1.5 transition-colors ${activeId === f.id ? 'border-accent bg-accent/10' : 'border-border bg-surface hover:bg-surface-3'}`}>
                <div class="flex items-center gap-2">
                  <GripVertical size={12} class="text-fg-subtle shrink-0" />
                  <button type="button" class="flex flex-1 items-center gap-2 text-left min-w-0" onClick={() => selectBlock(f.id)}>
                    <span class="flex-1 truncate text-sm text-fg">{stripHtml(f.label) || (f.type === 'statement' ? '(conteúdo)' : '(sem rótulo)')}</span>
                    {f.required && <Badge tone="info">obrig.</Badge>}
                    {f.type === 'hidden' && <EyeOff size={12} class="text-fg-subtle" />}
                  </button>
                  <button type="button" class="size-6 grid place-items-center rounded text-fg-muted hover:text-danger hover:bg-surface-3"
                    onClick={() => removeField(f.id)} title="Remover" aria-label="Remover"><Trash2 size={12} /></button>
                </div>
              </div>
            )} />
          )}

          <BlockRow icon={CheckCircle2} label="Tela de sucesso" active={activeId === SUCCESS_ID}
            onClick={() => selectBlock(SUCCESS_ID)} />
        </div>

        {/* Centro: canvas */}
        <div class="min-h-0 min-w-0 bg-surface-2 overflow-auto p-4">
          <div class="mx-auto mb-3 max-w-[640px] rounded-md bg-amber-50 border border-amber-200 px-3 py-1.5 text-[0.6875rem] text-amber-800">
            Visualização de edição — todos os campos empilhados. No modo conversacional publicado, o formulário mostra uma pergunta por vez.
          </div>
          <div class="bg-white shadow-lg rounded-md overflow-hidden mx-auto transition-[width] duration-200" style={{ width: DEVICE_WIDTH[device], maxWidth: '100%' }}>
            {canvasHtml ? (
              <iframe
                ref={iframeRef}
                srcDoc={canvasHtml}
                class="block bg-white"
                style={{ height: 'calc(100vh - 3.5rem - 4.25rem)', border: '0', width: '100%' }}
                title="Canvas"
                sandbox="allow-scripts allow-same-origin allow-forms"
              />
            ) : (
              <div class="p-10 text-center text-sm text-fg-muted">Gerando pré-visualização…</div>
            )}
          </div>
        </div>

        {/* Direita: propriedades do bloco selecionado */}
        <div class="min-h-0 min-w-0 border-l border-border overflow-y-auto p-3 bg-surface">
          {activeId === WELCOME_ID ? (
            <WelcomeBlockEditor
              displayMode={displayMode}
              enabled={welcomeEnabled} onEnabled={(v) => { setWelcomeEnabled(v); touch() }}
              title={welcomeTitle} onTitle={(v) => { setWelcomeTitle(v); touch() }}
              text={welcomeText} onText={(v) => { setWelcomeText(v); touch() }}
              icon={welcomeIcon} onIcon={(v) => { setWelcomeIcon(v); touch() }}
              imageUrl={welcomeImageUrl} onImageUrl={(v) => { setWelcomeImageUrl(v); touch() }}
              startButtonText={startButtonText} onStartButtonText={(v) => { setStartButtonText(v); touch() }}
              navButtonText={navButtonText} onNavButtonText={(v) => { setNavButtonText(v); touch() }}
              showProgress={showProgress} onShowProgress={(v) => { setShowProgress(v); touch() }}
            />
          ) : activeId === SUCCESS_ID ? (
            <SuccessBlockEditor
              mode={successMode} onMode={(v) => { setSuccessMode(v); touch() }}
              title={successTitle} onTitle={(v) => { setSuccessTitle(v); touch() }}
              html={successHtml} onHtml={(v) => { setSuccessHtml(v); touch() }}
              redirectUrl={redirectUrl} onRedirectUrl={(v) => { setRedirectUrl(v); touch() }}
            />
          ) : activeField ? (
            <FieldEditorColumn field={activeField} funnels={funnels?.funnels ?? []} onPatch={(p) => patchField(activeField.id, p)} onRemove={() => removeField(activeField.id)} />
          ) : (
            <div class="grid h-full place-items-center rounded-md border border-dashed border-border p-8 text-center text-sm text-fg-muted">
              Clique num bloco no canvas (ou na lista) para editar.
            </div>
          )}
        </div>
      </div>

      {/* Drawer de Configurações */}
      {settingsOpen && (
        <div class="fixed inset-0 z-[90]">
          <div class="absolute inset-0 bg-black/40" onClick={() => setSettingsOpen(false)} />
          <div class="absolute right-0 top-0 h-full w-full max-w-3xl bg-surface shadow-2xl flex flex-col">
            <header class="h-12 shrink-0 border-b border-border flex items-center justify-between gap-2 px-3">
              <span class="text-sm font-semibold text-fg truncate">Configurações do formulário</span>
              <div class="flex items-center gap-2 shrink-0">
                <Button variant="primary" size="sm" onClick={handleSave} disabled={!dirty || update.isPending}>
                  <Save size={14} /> {update.isPending ? 'Salvando…' : dirty ? 'Salvar' : 'Salvo'}
                </Button>
                <button class="size-7 grid place-items-center rounded text-fg-muted hover:text-fg hover:bg-surface-3" onClick={() => setSettingsOpen(false)} aria-label="Fechar"><X size={16} /></button>
              </div>
            </header>
            <div class="flex-1 min-h-0 grid grid-cols-[12rem_minmax(0,1fr)]">
              <nav class="border-r border-border p-2 flex flex-col gap-1 overflow-y-auto">
                {SECTIONS.map((s) => {
                  const Icon = s.icon
                  return (
                    <button key={s.id} onClick={() => setSection(s.id)}
                      class={`flex items-center gap-2 rounded-md px-3 py-2 text-sm text-left whitespace-nowrap transition-colors ${section === s.id ? 'bg-accent/10 text-accent font-medium' : 'text-fg-muted hover:bg-surface-2'}`}>
                      <Icon size={16} /> {s.label}
                    </button>
                  )
                })}
              </nav>
              <div class="overflow-y-auto p-4 sm:p-6 space-y-4">
                {section === 'destination' && (
                  <section class="space-y-3 max-w-xl">
                    <SectionTitle>Destino do lead (ao enviar)</SectionTitle>
                    <p class="text-xs text-fg-subtle">Para onde vai o lead criado quando alguém envia o formulário.</p>
                    <div class="grid gap-3 sm:grid-cols-2">
                      <Select label="Funil" value={funnelId} onChange={(e) => { setFunnelId((e.target as HTMLSelectElement).value); setStageKey(''); touch() }}>
                        <option value="">Funil padrão</option>
                        {funnels?.funnels.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                      </Select>
                      <Select label="Etapa inicial" value={stageKey} onChange={(e) => { setStageKey((e.target as HTMLSelectElement).value); touch() }} disabled={!funnelId}>
                        <option value="">{funnelId ? 'Primeira etapa' : 'Selecione um funil'}</option>
                        {stages.filter((s) => s.active).map((s) => <option key={s.id} value={s.key}>{s.name}</option>)}
                      </Select>
                    </div>
                    <Select label="Time que vai atender" value={defaultTeamId} onChange={(e) => { setDefaultTeamId((e.target as HTMLSelectElement).value); touch() }} hint="Leads deste formulário caem direto neste setor.">
                      <option value="">Setor padrão global</option>
                      {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </Select>
                    <div class="rounded-md border border-border bg-surface-2 p-3 space-y-3">
                      <span class="text-xs font-semibold uppercase tracking-wider text-fg-subtle">Jornada no funil</span>
                      <label class="flex items-start gap-2 cursor-pointer">
                        <input type="checkbox" class="size-4 mt-0.5 accent-accent shrink-0" checked={partialCapture} onChange={(e) => { setPartialCapture((e.target as HTMLInputElement).checked); touch() }} />
                        <span>
                          <span class="block text-sm font-medium text-fg">Captura parcial (entra na etapa inicial ao digitar nome+telefone)</span>
                          <span class="block text-[0.6875rem] text-fg-subtle mt-0.5">Cria o lead já no início e move conforme avança. Captura quem abandona. Só no modo conversacional.</span>
                        </span>
                      </label>
                      <p class="text-[0.6875rem] text-fg-subtle">Ramificação por qualificação: marque uma pergunta de <strong>seleção</strong> como qualificadora (no campo) e escolha as etapas abaixo.</p>
                      <div class="grid gap-3 sm:grid-cols-2">
                        <Select label="Etapa se positivo (qualificado)" value={qualifyPositiveStage} onChange={(e) => { setQualifyPositiveStage((e.target as HTMLSelectElement).value); touch() }} disabled={!funnelId}>
                          <option value="">— manter etapa —</option>
                          {stages.filter((s) => s.active).map((s) => <option key={s.id} value={s.key}>{s.name}</option>)}
                        </Select>
                        <Select label="Etapa se negativo (desqualificado)" value={qualifyNegativeStage} onChange={(e) => { setQualifyNegativeStage((e.target as HTMLSelectElement).value); touch() }} disabled={!funnelId}>
                          <option value="">— manter etapa —</option>
                          {stages.filter((s) => s.active).map((s) => <option key={s.id} value={s.key}>{s.name}</option>)}
                        </Select>
                      </div>
                    </div>
                    <Input label="Slug da URL" value={slug} onInput={(e) => { setSlug((e.target as HTMLInputElement).value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')); touch() }} hint={`URL pública: ${location.origin}/f/${slug || '<slug>'}`} />
                    <Input label="E-mails para notificar" value={notifyEmails} onInput={(e) => { setNotifyEmails((e.target as HTMLInputElement).value); touch() }} placeholder="vendas@empresa.com, ..." hint="Alerta a cada submissão." />
                    <Input label="Webhook externo" value={webhookUrl} onInput={(e) => { setWebhookUrl((e.target as HTMLInputElement).value); touch() }} placeholder="https://api.exemplo.com/incoming" />
                  </section>
                )}

                {section === 'scheduling' && (
                  <SchedulingSection
                    schedulingOn={schedulingOn} hasField={!!schedulingField} fieldHasMeeting={!!schedulingField?.meetingSlug}
                    selectedMt={selectedMt} saving={saveMeetingType.isPending}
                    funnels={funnels?.funnels ?? []}
                    onSaveMt={(patch) => {
                      if (!selectedMt) return
                      saveMeetingType.mutate({ id: selectedMt.id, ...patch }, {
                        onSuccess: () => toast('Agendamento atualizado', 'success'),
                        onError: (e: unknown) => toast((e as Error).message, 'danger'),
                      })
                    }}
                  />
                )}

                {section === 'conversion' && (
                  <section class="space-y-4 max-w-xl">
                    <SectionTitle>Conversão (ao enviar)</SectionTitle>
                    <label class="flex items-start gap-3 cursor-pointer rounded-md border border-border bg-surface-2 p-3">
                      <input type="checkbox" class="size-4 mt-0.5 accent-accent" checked={fireConversions} onChange={(e) => { setFireConversions((e.target as HTMLInputElement).checked); touch() }} />
                      <span><span class="block text-sm font-medium text-fg">Disparar conversão ao enviar</span><span class="block text-[0.6875rem] text-fg-subtle mt-0.5">Server-side: Meta CAPI + Google Ads ao criar o lead (usa a config global de Conversões).</span></span>
                    </label>
                    <div>
                      <SectionTitle>Pixels client-side (página hospedada)</SectionTitle>
                      <div class="grid gap-3 sm:grid-cols-2 mt-2">
                        <Input label="Meta Pixel ID" value={metaPixelId} onInput={(e) => { setMetaPixelId((e.target as HTMLInputElement).value); touch() }} placeholder="1234567890" />
                        <Select label="Evento Meta" value={metaEventName} onChange={(e) => { setMetaEventName((e.target as HTMLSelectElement).value); touch() }} hint="Evento padrão do Meta disparado ao concluir. Para agendamento, use Programar (Schedule).">
                          {!META_EVENTS.some((ev) => ev.value === metaEventName) && metaEventName && (
                            <option value={metaEventName}>{metaEventName} (personalizado)</option>
                          )}
                          {META_EVENTS.map((ev) => <option key={ev.value} value={ev.value}>{ev.label}</option>)}
                        </Select>
                        <Input label="Google Conversion ID" value={googleConversionId} onInput={(e) => { setGoogleConversionId((e.target as HTMLInputElement).value); touch() }} placeholder="AW-123456789" />
                        <Input label="Google Conversion Label" value={googleConversionLabel} onInput={(e) => { setGoogleConversionLabel((e.target as HTMLInputElement).value); touch() }} placeholder="AbCdEfGhIj" />
                      </div>
                    </div>
                  </section>
                )}

                {section === 'messages' && (
                  <section class="space-y-3 max-w-xl">
                    <SectionTitle>Mensagens</SectionTitle>
                    <p class="text-xs text-fg-subtle">A tela de sucesso também pode ser editada como bloco no canvas.</p>
                    <SuccessBlockEditor
                      mode={successMode} onMode={(v) => { setSuccessMode(v); touch() }}
                      title={successTitle} onTitle={(v) => { setSuccessTitle(v); touch() }}
                      html={successHtml} onHtml={(v) => { setSuccessHtml(v); touch() }}
                      redirectUrl={redirectUrl} onRedirectUrl={(v) => { setRedirectUrl(v); touch() }}
                    />
                  </section>
                )}

                {section === 'buttons' && (
                  <section class="space-y-3 max-w-xl">
                    <SectionTitle>Botões, CTA & progresso</SectionTitle>
                    <Input label="Texto do botão de envio" value={submitText} onInput={(e) => { setSubmitText((e.target as HTMLInputElement).value); touch() }} hint="Botão que finaliza/envia o formulário." />
                    {displayMode === 'conversational' ? (
                      <>
                        <Input label="Texto do botão da primeira tela" value={startButtonText} onInput={(e) => { setStartButtonText((e.target as HTMLInputElement).value); touch() }} placeholder="Começar" />
                        <Input label="Texto do botão de avançar / continuar" value={navButtonText} onInput={(e) => { setNavButtonText((e.target as HTMLInputElement).value); touch() }} placeholder="OK" />
                        <label class="flex items-center gap-2 text-sm text-fg"><input type="checkbox" class="size-4 accent-accent" checked={showProgress} onChange={(e) => { setShowProgress((e.target as HTMLInputElement).checked); touch() }} /> Mostrar barra de progresso</label>
                      </>
                    ) : (
                      <p class="text-xs text-fg-subtle">No modo clássico só há o botão de envio. Mude para conversacional para controlar avançar/progresso/início.</p>
                    )}
                  </section>
                )}

                {section === 'appearance' && (
                  <FormAppearancePanel value={styling} onChange={(s) => { setStyling(s); touch() }} fields={fields} settings={settings} />
                )}

                {section === 'share' && (
                  <ShareSection slug={slug} formId={formId} displayMode={displayMode} />
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {paletteOpen && (
        <AddFieldPalette usedKeys={usedKeys} onClose={() => setPaletteOpen(false)} onPick={(base) => { addReadyField(base); setPaletteOpen(false) }} />
      )}
    </div>
  )
}

function BlockRow({ icon: Icon, label, active, badge, onClick }: { icon: any; label: string; active: boolean; badge?: string | undefined; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      class={`flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors ${active ? 'border-accent bg-accent/10' : 'border-border bg-surface hover:bg-surface-3'}`}>
      <Icon size={14} class="shrink-0 text-fg-muted" />
      <span class="flex-1 truncate text-sm text-fg">{label}</span>
      {badge && <Badge tone="neutral">{badge}</Badge>}
    </button>
  )
}

function SectionTitle({ children }: { children: any }) {
  return <h3 class="text-xs font-semibold uppercase tracking-wider text-fg-subtle">{children}</h3>
}

// ── Editor do bloco Boas-vindas (props da tela inicial conversacional) ──
function WelcomeBlockEditor(props: {
  displayMode: 'classic' | 'conversational'
  enabled: boolean; onEnabled: (v: boolean) => void
  title: string; onTitle: (v: string) => void
  text: string; onText: (v: string) => void
  icon: string; onIcon: (v: string) => void
  imageUrl: string; onImageUrl: (v: string) => void
  startButtonText: string; onStartButtonText: (v: string) => void
  navButtonText: string; onNavButtonText: (v: string) => void
  showProgress: boolean; onShowProgress: (v: boolean) => void
}) {
  return (
    <div class="space-y-3 rounded-md border border-border bg-surface p-4">
      <h4 class="text-sm font-semibold text-fg">Tela de boas-vindas</h4>
      {props.displayMode !== 'conversational' && (
        <p class="text-[0.6875rem] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">A tela de boas-vindas só aparece no modo <strong>Conversacional</strong>.</p>
      )}
      <label class="flex items-center gap-2 text-sm text-fg">
        <input type="checkbox" class="size-4 accent-accent" checked={props.enabled} onChange={(e) => props.onEnabled((e.target as HTMLInputElement).checked)} />
        Exibir tela de boas-vindas
      </label>
      <Input label="Título" value={props.title} onInput={(e) => props.onTitle((e.target as HTMLInputElement).value)} placeholder="Bem-vindo! Vamos começar?" />
      <Input label="Texto de apoio" value={props.text} onInput={(e) => props.onText((e.target as HTMLInputElement).value)} placeholder="Leva menos de 1 minuto." />
      <div class="grid gap-2 sm:grid-cols-2">
        <Input label="Ícone (emoji)" value={props.icon} onInput={(e) => props.onIcon((e.target as HTMLInputElement).value)} placeholder="👋" />
        <Input label="URL da imagem" value={props.imageUrl} onInput={(e) => props.onImageUrl((e.target as HTMLInputElement).value)} placeholder="https://…" />
      </div>
      <Input label="Texto do botão inicial" value={props.startButtonText} onInput={(e) => props.onStartButtonText((e.target as HTMLInputElement).value)} placeholder="Começar" />
      <Input label="Texto do botão de avançar" value={props.navButtonText} onInput={(e) => props.onNavButtonText((e.target as HTMLInputElement).value)} placeholder="OK" />
      <label class="flex items-center gap-2 text-sm text-fg">
        <input type="checkbox" class="size-4 accent-accent" checked={props.showProgress} onChange={(e) => props.onShowProgress((e.target as HTMLInputElement).checked)} />
        Mostrar barra de progresso
      </label>
    </div>
  )
}

// ── Editor do bloco Tela de sucesso ──
function SuccessBlockEditor(props: {
  mode: 'message' | 'redirect'; onMode: (v: 'message' | 'redirect') => void
  title: string; onTitle: (v: string) => void
  html: string; onHtml: (v: string) => void
  redirectUrl: string; onRedirectUrl: (v: string) => void
}) {
  return (
    <div class="space-y-3 rounded-md border border-border bg-surface p-4">
      <h4 class="text-sm font-semibold text-fg">Tela de sucesso</h4>
      <div class="grid gap-2 sm:grid-cols-2">
        <button type="button" onClick={() => props.onMode('message')}
          class={`rounded-md border p-2.5 text-left text-sm ${props.mode === 'message' ? 'border-accent bg-accent/5 ring-1 ring-accent' : 'border-border bg-surface hover:bg-surface-2'}`}>
          <span class="block font-medium text-fg">Mensagem</span>
          <span class="block text-[0.6875rem] text-fg-subtle mt-0.5">Tela de agradecimento (HTML livre).</span>
        </button>
        <button type="button" onClick={() => props.onMode('redirect')}
          class={`rounded-md border p-2.5 text-left text-sm ${props.mode === 'redirect' ? 'border-accent bg-accent/5 ring-1 ring-accent' : 'border-border bg-surface hover:bg-surface-2'}`}>
          <span class="block font-medium text-fg">Redirecionar</span>
          <span class="block text-[0.6875rem] text-fg-subtle mt-0.5">Leva o lead para uma URL.</span>
        </button>
      </div>
      {props.mode === 'message' ? (
        <>
          <Input label="Título de sucesso" value={props.title} onInput={(e) => props.onTitle((e.target as HTMLInputElement).value)} />
          <RichText label="Mensagem de agradecimento (HTML livre)" value={props.html} onChange={props.onHtml} placeholder="Obrigado! Em breve entraremos em contato." minHeight="5rem" />
        </>
      ) : (
        <Input label="URL de redirecionamento" value={props.redirectUrl} onInput={(e) => props.onRedirectUrl((e.target as HTMLInputElement).value)}
          placeholder="/obrigado ou https://site.com/obrigado"
          hint="Path relativo (/obrigado) ou URL completa. Tokens {{nome}}/{{email}}/{{whatsapp}} são interpolados." />
      )}
    </div>
  )
}

// ── Seção Agendamento ──
function SchedulingSection({ schedulingOn, hasField, fieldHasMeeting, selectedMt, saving, funnels, onSaveMt }: {
  schedulingOn: boolean; hasField: boolean; fieldHasMeeting: boolean; selectedMt: any | null; saving: boolean
  funnels: { id: number; name: string }[]
  onSaveMt: (patch: Record<string, any>) => void
}) {
  const mtFunnelId = selectedMt?.funnelId ?? null
  const { data: mtStagesData } = useStages(mtFunnelId)
  const mtStages = mtStagesData?.stages ?? []

  if (!schedulingOn) {
    return <section class="space-y-2 max-w-xl"><SectionTitle>Agendamento</SectionTitle><Card class="p-4 text-sm text-fg-muted">O módulo de Agenda não está ativo. Ative-o para usar o campo de agendamento.</Card></section>
  }
  return (
    <section class="space-y-3 max-w-xl">
      <SectionTitle>Agendamento</SectionTitle>
      <p class="text-xs text-fg-subtle">O agendamento é um <strong>campo do formulário</strong>. Adicione um campo do tipo <strong>Agendamento</strong> e escolha o tipo de reunião nele. Aqui você define o que acontece <strong>ao concluir</strong>.</p>
      {!hasField && <Card class="p-4 text-sm text-fg-muted">Nenhum campo de agendamento ainda. Adicione um campo do tipo <strong>Agendamento</strong>.</Card>}
      {hasField && !fieldHasMeeting && <Card class="p-4 text-sm text-fg-muted">O campo de agendamento existe, mas falta escolher o <strong>tipo de reunião</strong> nele.</Card>}

      {selectedMt && (
        <div class="rounded-md border border-border bg-surface-2 p-3 space-y-3">
          <span class="text-xs font-semibold uppercase tracking-wider text-fg-subtle">Ao concluir o agendamento</span>
          <p class="text-[0.6875rem] text-fg-subtle">Estas regras valem para o tipo <strong>{selectedMt.name}</strong> e refletem no módulo de Agenda.</p>
          <div class="grid gap-3 sm:grid-cols-2">
            <Select label="Funil" value={mtFunnelId == null ? '' : String(mtFunnelId)} disabled={saving}
              onChange={(e) => { const v = (e.target as HTMLSelectElement).value; onSaveMt({ funnelId: v ? Number(v) : null, stageKey: null }) }}>
              <option value="">— manter —</option>
              {funnels.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </Select>
            <Select label="Mover lead para a etapa" value={selectedMt.stageKey ?? ''} disabled={saving || !mtFunnelId}
              onChange={(e) => onSaveMt({ stageKey: (e.target as HTMLSelectElement).value || null })}>
              <option value="">{mtFunnelId ? '— manter etapa —' : 'Escolha um funil'}</option>
              {mtStages.filter((s) => s.active).map((s) => <option key={s.id} value={s.key}>{s.name}</option>)}
            </Select>
          </div>
          <label class="flex items-center gap-2 cursor-pointer text-sm text-fg">
            <input type="checkbox" class="size-4 accent-accent" checked={!!(selectedMt.pixelConfig as any)?.fireConversions} disabled={saving}
              onChange={(e) => { const fire = (e.target as HTMLInputElement).checked; const prev = (selectedMt.pixelConfig as any) ?? {}; onSaveMt({ pixelConfig: { ...prev, fireConversions: fire } }) }} />
            Disparar conversão (Meta CAPI + Google Ads) ao agendar
          </label>
          <p class="text-[0.6875rem] text-fg-subtle">O lead também é atribuído ao time/operador do tipo de reunião. <a href="/app/scheduling" target="_blank" rel="noreferrer" class="text-accent hover:underline">Gerenciar tipos →</a></p>
        </div>
      )}
    </section>
  )
}

// ── Seção Compartilhar ──
function ShareSection({ slug, formId, displayMode }: { slug: string; formId: number; displayMode: string }) {
  const ref = slug || String(formId)
  const hosted = `${location.origin}/f/${ref}`
  const embed = `<script src="${location.origin}/api/forms/embed/${formId}.js" defer></script>\n<beyond-form form-id="${formId}"></beyond-form>`
  const iframe = `<iframe src="${hosted}?embed=1" style="width:100%;min-height:520px;border:0" loading="lazy"></iframe>`
  const copy = (t: string) => { void navigator.clipboard.writeText(t).then(() => toast('Copiado', 'success')) }
  return (
    <section class="space-y-4 max-w-xl">
      <SectionTitle>Compartilhar</SectionTitle>
      <div class="space-y-2">
        <div class="text-xs font-medium text-fg-muted">Link hospedado</div>
        <div class="flex items-center gap-2">
          <Input value={hosted} readOnly class="flex-1 font-mono text-xs" />
          <Button size="sm" variant="secondary" onClick={() => copy(hosted)}>Copiar</Button>
          <a href={hosted} target="_blank" rel="noreferrer" class="shrink-0 inline-flex items-center h-8 px-3 rounded-md text-xs font-medium bg-accent text-white">Abrir</a>
        </div>
      </div>
      {displayMode === 'conversational' ? (
        <div class="space-y-1"><div class="text-xs font-medium text-fg-muted">Embed (iframe)</div><pre class="rounded-md bg-zinc-900 text-zinc-100 text-[0.7rem] p-3 whitespace-pre-wrap break-all" onClick={() => copy(iframe)}>{iframe}</pre></div>
      ) : (
        <div class="space-y-1"><div class="text-xs font-medium text-fg-muted">Embed (web component)</div><pre class="rounded-md bg-zinc-900 text-zinc-100 text-[0.7rem] p-3 whitespace-pre-wrap break-all" onClick={() => copy(embed)}>{embed}</pre></div>
      )}
      <p class="text-[0.6875rem] text-fg-subtle">Clique no bloco de código para copiar.</p>
    </section>
  )
}
