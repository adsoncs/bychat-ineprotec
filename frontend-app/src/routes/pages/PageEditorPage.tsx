import { useState, useEffect, useMemo, useRef } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import { ArrowLeft, Save, ExternalLink, Monitor, Tablet, Smartphone } from 'lucide-preact'
import {
  usePage,
  useUpdatePageSections,
  usePublishPage,
  useLandingPagePreview,
  type PageSection,
  type PageSectionStyle,
} from '@/hooks/usePages'
import {
  SectionsListColumn,
  SectionEditorColumn,
  defaultSection,
  isSectionArray,
  type SectionTypeId,
} from '@/components/PageSectionsEditor'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { toast } from '@/lib/toast'

type Device = 'desktop' | 'tablet' | 'mobile'
const DEVICE_WIDTH: Record<Device, string> = { desktop: '100%', tablet: '768px', mobile: '390px' }

export function PageEditorPage({ params }: { params: { id: string } }) {
  const pageId = parseInt(params.id)
  const { data, isLoading } = usePage(pageId)
  const update = useUpdatePageSections()
  const publish = usePublishPage()
  const preview = useLandingPagePreview()
  const [, navigate] = useLocation()

  const [sections, setSections] = useState<PageSection[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [pickingType, setPickingType] = useState(false)
  const [device, setDevice] = useState<Device>('desktop')
  const [canvasHtml, setCanvasHtml] = useState('')
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const activeRef = useRef<string | null>(null)
  activeRef.current = activeId

  // Carrega as seções só na primeira vez (refetch após salvar não sobrescreve edits).
  useEffect(() => {
    if (loaded || !data) return
    const next = isSectionArray(data.sections) ? data.sections : []
    setSections(next)
    setActiveId(next[0]?.id ?? null)
    setLoaded(true)
  }, [data, loaded])

  // Re-renderiza o canvas (iframe = SSR real, modo editor) quando as seções mudam.
  useEffect(() => {
    if (!loaded) return
    const t = setTimeout(() => {
      preview.mutate(
        { id: pageId, sections, edit: true },
        { onSuccess: (html) => setCanvasHtml(html), onError: () => {} },
      )
    }, 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections, loaded])

  // Ponte de seleção: escuta cliques vindos de dentro do iframe.
  useEffect(() => {
    function onMsg(e: MessageEvent) {
      const d = (e.data || {}) as { source?: string; type?: string; id?: string }
      if (d.source !== 'lp-canvas') return
      if (d.type === 'select' && d.id) setActiveId(d.id)
      // Após cada re-render o iframe avisa 'ready' → restauramos a seleção.
      if (d.type === 'ready' && activeRef.current) postHighlight(activeRef.current, false)
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [])

  function postHighlight(id: string, scroll: boolean) {
    iframeRef.current?.contentWindow?.postMessage({ type: 'lp-highlight', id, scroll }, '*')
  }

  function selectFromList(id: string) {
    setActiveId(id)
    postHighlight(id, true)
  }

  const active = useMemo(() => sections.find((s) => s.id === activeId) ?? null, [sections, activeId])

  function patchSection(id: string, partial: Partial<PageSection>) {
    setSections((arr) => arr.map((s) => (s.id === id ? { ...s, ...partial } : s)))
    setDirty(true)
  }
  function patchProps(id: string, props: Record<string, unknown>) {
    setSections((arr) => arr.map((s) => (s.id === id ? { ...s, props: { ...s.props, ...props } } : s)))
    setDirty(true)
  }
  function patchStyle(id: string, style: Partial<PageSectionStyle>) {
    setSections((arr) => arr.map((s) => {
      if (s.id !== id) return s
      const next = { ...(s.style ?? {}) } as Record<string, unknown>
      for (const k of Object.keys(style) as (keyof PageSectionStyle)[]) {
        const v = style[k]
        if (v === undefined || v === '') delete next[k]
        else next[k] = v
      }
      return { ...s, style: next }
    }))
    setDirty(true)
  }
  function addSection(type: SectionTypeId) {
    const s = defaultSection(type)
    setSections((arr) => [...arr, s])
    setActiveId(s.id)
    setDirty(true)
    setPickingType(false)
  }
  function removeSection(id: string) {
    setSections((arr) => arr.filter((s) => s.id !== id))
    setActiveId((curr) => (curr === id ? null : curr))
    setDirty(true)
  }
  function reorder(next: PageSection[]) {
    setSections(next)
    setDirty(true)
  }

  function handleSave() {
    update.mutate({ id: pageId, sections }, {
      onSuccess: () => { toast('Blocos salvos', 'success'); setDirty(false) },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }
  function handlePublish() {
    update.mutate({ id: pageId, sections }, {
      onSuccess: () => {
        setDirty(false)
        publish.mutate({ id: pageId, status: 'PUBLISHED' }, {
          onSuccess: () => toast('Página publicada', 'success'),
          onError: (e: unknown) => toast((e as Error).message, 'danger'),
        })
      },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }
  function handleBack() {
    if (dirty && !confirm('Você tem alterações não salvas. Sair mesmo assim?')) return
    navigate('/pages')
  }
  function openPublic() {
    if (!data?.slug) return
    if (dirty) toast('Salve para ver as alterações no preview público', 'warning')
    window.open(`/p/${data.slug}?preview=true`, '_blank', 'noreferrer')
  }

  return (
    <div class="fixed inset-0 z-[80] bg-surface flex flex-col">
      {/* Topbar do editor */}
      <header class="h-14 shrink-0 border-b border-border bg-surface flex items-center gap-2 px-3">
        <Button variant="ghost" size="sm" onClick={handleBack}>
          <ArrowLeft size={16} /> Voltar
        </Button>
        <div class="min-w-0 flex-1">
          <div class="text-sm font-semibold text-fg truncate">
            {data?.title ?? 'Landing Page'}{dirty ? ' •' : ''}
          </div>
          <div class="text-[0.6875rem] text-fg-muted truncate">/p/{data?.slug ?? ''}</div>
        </div>

        {/* Toggle de dispositivo */}
        <div class="hidden sm:flex items-center gap-0.5 rounded-md border border-border p-0.5">
          {([
            ['desktop', Monitor], ['tablet', Tablet], ['mobile', Smartphone],
          ] as [Device, typeof Monitor][]).map(([d, Icon]) => (
            <button
              key={d}
              type="button"
              class={`size-7 rounded grid place-items-center transition-colors ${device === d ? 'bg-accent text-fg-on-brand' : 'text-fg-muted hover:text-fg hover:bg-surface-3'}`}
              onClick={() => setDevice(d)}
              aria-label={d}
              title={d}
            >
              <Icon size={14} />
            </button>
          ))}
        </div>

        <Button variant="ghost" size="sm" onClick={openPublic} disabled={!data?.slug}>
          <ExternalLink size={14} /> Pré-visualizar
        </Button>
        <Button variant="secondary" size="sm" onClick={handleSave} disabled={!dirty || update.isPending}>
          <Save size={14} /> {update.isPending ? 'Salvando…' : 'Salvar'}
        </Button>
        <Button variant="primary" size="sm" onClick={handlePublish} disabled={update.isPending || publish.isPending}>
          {publish.isPending ? 'Publicando…' : 'Publicar'}
        </Button>
      </header>

      {isLoading ? (
        <div class="flex-1 p-6"><Skeleton class="h-full w-full" /></div>
      ) : (
        <div class="flex-1 min-h-0 grid grid-cols-[18rem_minmax(0,1fr)_22rem]">
          {/* Coluna esquerda: lista de blocos */}
          <div class="min-h-0 min-w-0 border-r border-border overflow-y-auto p-3 bg-surface">
            <SectionsListColumn
              sections={sections}
              activeId={activeId}
              onSelect={selectFromList}
              onReorder={reorder}
              onAddRequest={() => setPickingType((v) => !v)}
              pickingType={pickingType}
              onPick={addSection}
              onToggleVisible={(s) => patchSection(s.id, { visible: !s.visible })}
              onRemove={(id) => removeSection(id)}
            />
          </div>

          {/* Centro: canvas (iframe = SSR real, clicável) */}
          <div class="min-h-0 min-w-0 bg-surface-2 overflow-auto p-4">
            <div
              class="bg-white shadow-lg rounded-md overflow-hidden mx-auto transition-[width] duration-200"
              style={{ width: DEVICE_WIDTH[device], maxWidth: '100%' }}
            >
              {canvasHtml ? (
                <iframe
                  ref={iframeRef}
                  srcDoc={canvasHtml}
                  class="block bg-white"
                  style={{ height: 'calc(100vh - 3.5rem - 2rem)', border: '0', width: '100%' }}
                  title="Canvas"
                  sandbox="allow-scripts allow-same-origin allow-forms"
                />
              ) : (
                <div class="p-10 text-center text-sm text-fg-muted">
                  Gerando pré-visualização…
                </div>
              )}
            </div>
          </div>

          {/* Direita: propriedades do bloco selecionado */}
          <div class="min-h-0 min-w-0 border-l border-border overflow-y-auto p-3 bg-surface">
            {active ? (
              <SectionEditorColumn
                section={active}
                pageId={pageId}
                onPatchProps={(props) => patchProps(active.id, props)}
                onPatchStyle={(style) => patchStyle(active.id, style)}
              />
            ) : (
              <div class="text-sm text-fg-muted p-4 text-center">
                Clique em um bloco no preview (ou na lista) para editar suas propriedades.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
