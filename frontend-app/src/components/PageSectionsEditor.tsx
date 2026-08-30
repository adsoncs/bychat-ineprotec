import { useEffect, useMemo, useState } from 'preact/hooks'
import {
  Plus,
  Save,
  Trash2,
  Eye,
  EyeOff,
  ExternalLink,
  Image as ImageIcon,
  Layers,
  ListChecks,
  FormInput,
  Quote,
  Tag as TagIcon,
  Type,
  Video,
  AlignJustify,
  MessageSquare,
  Code,
  Hash,
  ChevronDown,
  GalleryVertical,
  Columns2,
  Minus,
  MoveHorizontal,
  Clock,
  CalendarClock,
  Users,
  Mail,
  Share2,
  Megaphone,
  Map as MapIcon,
  Camera,
  Film,
  Building,
} from '@/components/ui/icon-set'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input, Textarea, Select } from '@/components/ui/Input'
import { ColorPicker } from '@/components/ui/ColorPicker'
import { SortableList } from '@/components/ui/SortableList'
import { Skeleton } from '@/components/ui/Skeleton'
import { Badge } from '@/components/ui/Badge'
import { decodeIfEscaped } from '@/components/ui/RichText'
import { PageImageUploader } from '@/components/PageImageUploader'
import {
  usePage,
  useUpdatePageSections,
  type PageSection,
  type PageSectionStyle,
} from '@/hooks/usePages'
import { useForms } from '@/hooks/useForms'
import { useMeetingTypes } from '@/hooks/useScheduling'
import { useModules } from '@/hooks/useModules'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/cn'

interface PageSectionsEditorProps {
  pageId: number
  pageTitle: string
  onClose: () => void
}

export type SectionTypeId =
  | 'hero'
  | 'navbar'
  | 'sticky_cta'
  | 'bento'
  | 'before_after'
  | 'features'
  | 'form'
  | 'cta'
  | 'testimonials'
  | 'pricing'
  | 'video'
  | 'text'
  | 'footer'
  | 'faq'
  | 'image'
  | 'logo'
  | 'logos'
  | 'gallery'
  | 'carousel_images'
  | 'carousel_videos'
  | 'stats'
  | 'countdown'
  | 'team'
  | 'contact'
  | 'social'
  | 'banner'
  | 'accordion'
  | 'columns'
  | 'map'
  | 'scheduling'
  | 'raw_html'
  | 'spacer'
  | 'divider'

const SECTION_TYPES: {
  value: SectionTypeId
  label: string
  description: string
  icon: typeof ImageIcon
}[] = [
  { value: 'navbar', label: 'Navbar', description: 'Cabeçalho de navegação (fixo)', icon: AlignJustify },
  { value: 'hero', label: 'Hero', description: 'Título grande + CTA', icon: ImageIcon },
  { value: 'features', label: 'Benefícios', description: 'Grade de itens com ícone', icon: ListChecks },
  { value: 'bento', label: 'Bento grid', description: 'Cards modernos assimétricos', icon: Layers },
  { value: 'before_after', label: 'Antes / Depois', description: 'Comparador de imagens arrastável', icon: Camera },
  { value: 'sticky_cta', label: 'Barra CTA fixa', description: 'Faixa de conversão fixa na tela', icon: TagIcon },
  { value: 'form', label: 'Formulário', description: 'Captura de leads', icon: FormInput },
  { value: 'cta', label: 'Chamada (CTA)', description: 'Banner com botão', icon: TagIcon },
  { value: 'testimonials', label: 'Depoimentos', description: 'Citações de clientes', icon: Quote },
  { value: 'pricing', label: 'Planos', description: 'Tabela de preços', icon: Layers },
  { value: 'video', label: 'Vídeo', description: 'Embed de YouTube/Vimeo', icon: Video },
  { value: 'text', label: 'Texto', description: 'Bloco livre de conteúdo', icon: Type },
  { value: 'faq', label: 'FAQ', description: 'Perguntas e respostas (collapse)', icon: MessageSquare },
  { value: 'accordion', label: 'Accordion', description: 'Itens expansíveis com HTML', icon: ChevronDown },
  { value: 'image', label: 'Imagem', description: 'Imagem única com legenda', icon: ImageIcon },
  { value: 'logo', label: 'Logo', description: 'Logo da marca (header)', icon: Building },
  { value: 'logos', label: 'Logos de clientes', description: 'Grade de logos (prova social)', icon: Building },
  { value: 'gallery', label: 'Galeria', description: 'Grade de imagens', icon: GalleryVertical },
  { value: 'carousel_images', label: 'Carrossel imagens', description: 'Slider horizontal de imagens', icon: Camera },
  { value: 'carousel_videos', label: 'Carrossel vídeos', description: 'Slider horizontal de vídeos', icon: Film },
  { value: 'stats', label: 'Estatísticas', description: 'Números de impacto', icon: Hash },
  { value: 'countdown', label: 'Contagem regressiva', description: 'Timer até data alvo', icon: Clock },
  { value: 'team', label: 'Time / Equipe', description: 'Cards de pessoas', icon: Users },
  { value: 'contact', label: 'Contato', description: 'Telefone, email, endereço', icon: Mail },
  { value: 'social', label: 'Redes sociais', description: 'Ícones de redes sociais', icon: Share2 },
  { value: 'banner', label: 'Banner / Aviso', description: 'Faixa horizontal de aviso', icon: Megaphone },
  { value: 'columns', label: 'Colunas', description: 'Layout em N colunas (HTML)', icon: Columns2 },
  { value: 'map', label: 'Mapa', description: 'Embed do Google Maps', icon: MapIcon },
  { value: 'scheduling', label: 'Agendamento', description: 'Agenda de reunião (Calendly)', icon: CalendarClock },
  { value: 'raw_html', label: 'HTML livre', description: 'Código HTML personalizado', icon: Code },
  { value: 'spacer', label: 'Espaçador', description: 'Espaço vertical em branco', icon: MoveHorizontal },
  { value: 'divider', label: 'Divisor', description: 'Linha horizontal', icon: Minus },
  { value: 'footer', label: 'Rodapé', description: 'Texto final da página', icon: AlignJustify },
]

function genId(): string {
  return `s_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export function isSectionArray(v: unknown): v is PageSection[] {
  return Array.isArray(v) && v.every((it) => typeof it === 'object' && it !== null && 'id' in it && 'type' in it)
}

function defaultProps(type: SectionTypeId): Record<string, unknown> {
  switch (type) {
    case 'hero':
      return {
        variant: 'centered',
        headline: 'Seu título principal',
        subheadline: 'Descrição curta e persuasiva.',
        ctaText: 'Começar',
        ctaLink: '#form',
        secondaryCtaText: '',
        secondaryCtaLink: '',
        image: '',
        gradientFrom: '',
        gradientTo: '',
        badge: '',
        alignment: 'center',
      }
    case 'navbar':
      return {
        brandText: 'Sua Marca',
        brandImage: '',
        brandLink: '#',
        sticky: true,
        links: [
          { label: 'Benefícios', href: '#features' },
          { label: 'Planos', href: '#pricing' },
        ],
        ctaText: 'Começar',
        ctaLink: '#form',
      }
    case 'sticky_cta':
      return {
        text: 'Oferta por tempo limitado — garanta já!',
        ctaText: 'Quero agora',
        ctaLink: '#form',
        position: 'bottom',
      }
    case 'bento':
      return {
        heading: 'Tudo que você precisa',
        subheading: '',
        items: [
          { icon: '⚡', title: 'Rápido', text: 'Resultados em minutos.', span: '2' },
          { icon: '🔒', title: 'Seguro', text: 'Dados protegidos.', span: '1' },
          { icon: '📈', title: 'Escalável', text: 'Cresce com você.', span: '1' },
          { icon: '🤝', title: 'Suporte', text: 'Time sempre disponível.', span: '2' },
        ],
      }
    case 'before_after':
      return {
        heading: 'Veja a transformação',
        beforeUrl: '',
        afterUrl: '',
        beforeLabel: 'Antes',
        afterLabel: 'Depois',
      }
    case 'features':
      return {
        heading: 'Por que escolher?',
        subheading: '',
        items: [
          { icon: '🚀', title: 'Rápido', description: 'Resultados em poucos dias.' },
          { icon: '🎯', title: 'Preciso', description: 'Estratégias baseadas em dados.' },
          { icon: '💡', title: 'Inteligente', description: 'Tecnologia de ponta.' },
        ],
      }
    case 'form':
      return { heading: 'Fale conosco', subheading: '', formId: null, layout: 'stacked' }
    case 'cta':
      return { heading: 'Pronto para começar?', subheading: 'Dê o próximo passo agora mesmo.', ctaText: 'Quero começar', ctaLink: '#form' }
    case 'testimonials':
      return {
        heading: 'O que dizem',
        items: [{ name: 'Cliente', role: 'CEO', text: 'Depoimento aqui.', avatar: '' }],
      }
    case 'pricing':
      return {
        heading: 'Planos',
        subheading: '',
        anchorId: 'pricing',
        items: [{ name: 'Plano A', price: 'R$ 99/mês', features: ['Feature 1', 'Feature 2'] }],
      }
    case 'video':
      return { heading: '', url: '' }
    case 'text':
      return { content: '' }
    case 'footer':
      return { text: `© ${new Date().getFullYear()} Sua empresa. Todos os direitos reservados.` }
    case 'faq':
      return {
        heading: 'Dúvidas frequentes',
        subheading: '',
        items: [
          { question: 'Como funciona?', answer: 'Resposta breve aqui.' },
          { question: 'Quanto custa?', answer: 'Sem custo para começar.' },
        ],
      }
    case 'accordion':
      return {
        heading: 'Saiba mais',
        subheading: '',
        items: [{ title: 'Tópico', content: '<p>Conteúdo HTML do item.</p>' }],
      }
    case 'image':
      return { heading: '', url: '', alt: '', alignment: 'center', maxWidth: '100%', caption: '' }
    case 'logo':
      return { url: '', alt: 'Logo', link: '/', alignment: 'center', maxHeight: '60px', text: '', padding: '24px' }
    case 'logos':
      return {
        heading: 'Eles confiam em nós',
        variant: 'grid',
        items: [
          { url: '', alt: 'Cliente 1' },
          { url: '', alt: 'Cliente 2' },
        ],
      }
    case 'gallery':
      return {
        heading: 'Galeria',
        columns: 3,
        items: [{ url: '', alt: '' }],
      }
    case 'carousel_images':
      return {
        heading: '',
        subheading: '',
        itemWidth: '320px',
        itemHeight: '220px',
        items: [{ url: '', alt: '' }],
      }
    case 'carousel_videos':
      return {
        heading: '',
        items: [{ url: '', title: '' }],
      }
    case 'stats':
      return {
        heading: 'Nossos números',
        background: '',
        items: [
          { number: '+1.000', label: 'Clientes atendidos' },
          { number: '98%', label: 'Satisfação' },
          { number: '24/7', label: 'Suporte' },
        ],
      }
    case 'countdown':
      return {
        heading: 'A oferta acaba em…',
        subheading: '',
        targetDate: '',
        ctaText: '',
        ctaLink: '#form',
      }
    case 'team':
      return {
        heading: 'Nosso time',
        subheading: '',
        items: [{ name: 'Nome', role: 'Cargo', photo: '', bio: '' }],
      }
    case 'contact':
      return {
        heading: 'Fale com a gente',
        subheading: '',
        items: [
          { type: 'phone', label: 'Telefone', value: '(00) 00000-0000', link: 'tel:0000000000' },
          { type: 'email', label: 'E-mail', value: 'contato@empresa.com', link: 'mailto:contato@empresa.com' },
          { type: 'address', label: 'Endereço', value: 'Rua exemplo, 123', link: '' },
        ],
      }
    case 'social':
      return {
        heading: 'Siga a gente',
        items: [
          { platform: 'instagram', url: 'https://instagram.com/...', label: 'Instagram' },
          { platform: 'linkedin', url: 'https://linkedin.com/...', label: 'LinkedIn' },
        ],
      }
    case 'banner':
      return {
        text: 'Aviso importante!',
        icon: '',
        ctaText: '',
        ctaLink: '#',
        backgroundColor: '',
        textColor: '',
      }
    case 'columns':
      return {
        heading: '',
        gap: '32px',
        columns: [
          { content: '<h3>Coluna 1</h3><p>Conteúdo da primeira coluna.</p>' },
          { content: '<h3>Coluna 2</h3><p>Conteúdo da segunda coluna.</p>' },
        ],
      }
    case 'map':
      return {
        heading: '',
        subheading: '',
        address: '',
        embedUrl: '',
        height: '400',
      }
    case 'scheduling':
      return { heading: 'Agende uma reunião', subheading: '', slug: '', height: '760' }
    case 'raw_html':
      return { html: '<!-- Cole seu HTML aqui -->' }
    case 'spacer':
      return { height: 48 }
    case 'divider':
      return { variant: 'solid', colored: false, padding: '16px', width: '100%' }
  }
}

export function defaultSection(type: SectionTypeId): PageSection {
  return { id: genId(), type, visible: true, props: defaultProps(type) }
}

export function PageSectionsEditor({ pageId, pageTitle, onClose }: PageSectionsEditorProps) {
  const { data, isLoading } = usePage(pageId)
  const update = useUpdatePageSections()

  const [sections, setSections] = useState<PageSection[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [pickingType, setPickingType] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [previewKey, setPreviewKey] = useState(0)

  // Sincroniza apenas na primeira carga. Refetches após salvar (que invalidam
  // ['page', id]) não devem sobrescrever edits em andamento.
  useEffect(() => {
    if (loaded || !data) return
    const next = isSectionArray(data.sections) ? data.sections : []
    setSections(next)
    setActiveId(next[0]?.id ?? null)
    setDirty(false)
    setLoaded(true)
  }, [data, loaded])

  function attemptClose() {
    if (dirty && !confirm('Você tem alterações não salvas. Deseja descartá-las e fechar?')) return
    onClose()
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
        if (v === undefined || v === '') {
          delete next[k]
        } else {
          next[k] = v
        }
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
    update.mutate(
      { id: pageId, sections },
      {
        onSuccess: () => {
          toast('Blocos salvos', 'success')
          setDirty(false)
          // Recarrega o iframe de preview para refletir as mudanças.
          setPreviewKey((k) => k + 1)
        },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      },
    )
  }

  function handlePreview() {
    if (!data?.slug) return
    if (dirty) toast('Você tem alterações não salvas — salve para vê-las no preview', 'warning')
    window.open(`/p/${data.slug}?preview=true`, '_blank', 'noreferrer')
  }

  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o) attemptClose()
      }}
      title={`Editar blocos — ${pageTitle}${dirty ? ' •' : ''}`}
      description="Arraste para reordenar. As alterações só ficam salvas quando você clica em Salvar."
      size="xl"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={attemptClose} disabled={update.isPending}>
            Fechar
          </Button>
          <Button variant="ghost" size="sm" onClick={handlePreview} disabled={!data?.slug}>
            <ExternalLink size={14} /> Pré-visualizar
          </Button>
          <Button variant="primary" size="sm" onClick={handleSave} disabled={!dirty || update.isPending}>
            <Save size={14} /> {update.isPending ? 'Salvando…' : 'Salvar blocos'}
          </Button>
        </>
      }
    >
      {isLoading && <Skeleton class="h-64 w-full" />}
      {!isLoading && (
        <>
          <div class="mb-2 flex items-center justify-end">
            <Button variant="ghost" size="sm" onClick={() => setShowPreview((v) => !v)} disabled={!data?.slug}>
              {showPreview ? <EyeOff size={14} /> : <Eye size={14} />}
              {showPreview ? 'Ocultar preview' : 'Mostrar preview'}
            </Button>
          </div>
          <div class={showPreview
            ? 'grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)_minmax(0,1.4fr)]'
            : 'grid gap-4 lg:grid-cols-[20rem_1fr]'}>
            <SectionsListColumn
              sections={sections}
              activeId={activeId}
              onSelect={setActiveId}
              onReorder={reorder}
              onAddRequest={() => setPickingType((v) => !v)}
              pickingType={pickingType}
              onPick={addSection}
              onToggleVisible={(s) => patchSection(s.id, { visible: !s.visible })}
              onRemove={(id) => removeSection(id)}
            />
            <SectionEditorColumn
              section={active}
              pageId={pageId}
              onPatchProps={(props) => active && patchProps(active.id, props)}
              onPatchStyle={(style) => active && patchStyle(active.id, style)}
            />
            {showPreview && data?.slug && (
              <div class="rounded-md border border-border bg-surface overflow-hidden flex flex-col min-h-[36rem]">
                <div class="flex items-center justify-between border-b border-border px-2 py-1.5 text-2xs text-fg-muted">
                  <span class="truncate">/p/{data.slug}?preview=true{dirty ? ' · alterações não salvas' : ''}</span>
                  <button
                    type="button"
                    class="text-fg-muted hover:text-fg"
                    onClick={() => setPreviewKey((k) => k + 1)}
                    title="Recarregar preview"
                  >
                    Recarregar
                  </button>
                </div>
                <iframe
                  key={previewKey}
                  src={`/p/${data.slug}?preview=true`}
                  class="flex-1 w-full bg-white"
                  title="Pré-visualização"
                  sandbox="allow-scripts allow-same-origin allow-forms"
                />
              </div>
            )}
          </div>
        </>
      )}
    </Modal>
  )
}

interface SectionsListColumnProps {
  sections: PageSection[]
  activeId: string | null
  onSelect: (id: string) => void
  onReorder: (next: PageSection[]) => void
  onAddRequest: () => void
  pickingType: boolean
  onPick: (type: SectionTypeId) => void
  onToggleVisible: (s: PageSection) => void
  onRemove: (id: string) => void
}

export function SectionsListColumn({
  sections,
  activeId,
  onSelect,
  onReorder,
  onAddRequest,
  pickingType,
  onPick,
  onToggleVisible,
  onRemove,
}: SectionsListColumnProps) {
  const modules = useModules()
  const schedulingOn = modules.data?.modules?.some((m) => m.id === 'scheduling' && m.enabled) ?? false
  const palette = SECTION_TYPES.filter((t) => t.value !== 'scheduling' || schedulingOn)
  return (
    <aside class="flex flex-col gap-2">
      <div class="flex items-center justify-between">
        <h4 class="text-xs font-semibold uppercase tracking-wider text-fg-muted">
          Blocos ({sections.length})
        </h4>
        <Button variant="ghost" size="sm" onClick={onAddRequest}>
          <Plus size={12} /> Adicionar
        </Button>
      </div>

      {pickingType && (
        <div class="space-y-1 rounded-md border border-border bg-surface-2 p-2">
          {palette.map((t) => {
            const Icon = t.icon
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => onPick(t.value)}
                class="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-3"
              >
                <Icon size={14} class="mt-0.5 shrink-0 text-fg-muted" />
                <div class="min-w-0">
                  <div class="text-sm text-fg">{t.label}</div>
                  <div class="text-2xs text-fg-muted">{t.description}</div>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {sections.length === 0 ? (
        <p class="text-xs text-fg-muted">Nenhum bloco. Clique em "Adicionar" para começar.</p>
      ) : (
        <SortableList
          items={sections}
          onReorder={onReorder}
          renderItem={(s) => {
            const meta = SECTION_TYPES.find((t) => t.value === (s.type as SectionTypeId))
            const Icon = meta?.icon ?? ImageIcon
            return (
              <div
                class={`group rounded-md border px-2 py-1.5 transition-colors ${
                  activeId === s.id
                    ? 'border-accent bg-accent/10'
                    : 'border-border bg-surface hover:bg-surface-3'
                } ${!s.visible ? 'opacity-60' : ''}`}
              >
                <div class="flex items-center gap-2">
                  <button type="button" class="flex flex-1 items-center gap-2 text-left" onClick={() => onSelect(s.id)}>
                    <Icon size={14} class="shrink-0 text-fg-muted" />
                    <span class="flex-1 truncate text-sm text-fg">
                      {labelForSection(s)}
                    </span>
                    <Badge tone="neutral">{meta?.label ?? s.type}</Badge>
                  </button>
                  <button
                    type="button"
                    class="size-6 grid place-items-center rounded text-fg-muted hover:text-fg hover:bg-surface-3"
                    onClick={() => onToggleVisible(s)}
                    aria-label={s.visible ? 'Ocultar' : 'Mostrar'}
                    title={s.visible ? 'Ocultar' : 'Mostrar'}
                  >
                    {s.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                  </button>
                  <button
                    type="button"
                    class="size-6 grid place-items-center rounded text-fg-muted hover:text-danger hover:bg-surface-3"
                    onClick={() => onRemove(s.id)}
                    aria-label="Remover"
                    title="Remover"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            )
          }}
        />
      )}
    </aside>
  )
}

function labelForSection(s: PageSection): string {
  const props = s.props
  const candidates = ['headline', 'heading', 'title']
  for (const k of candidates) {
    const v = props[k]
    if (typeof v === 'string' && v.trim()) return v
  }
  return SECTION_TYPES.find((t) => t.value === (s.type as SectionTypeId))?.label ?? s.type
}

interface SectionEditorColumnProps {
  section: PageSection | null
  pageId: number
  onPatchProps: (props: Record<string, unknown>) => void
  onPatchStyle: (style: Partial<PageSectionStyle>) => void
}

type SectionTab = 'content' | 'style'

export function SectionEditorColumn({ section, pageId, onPatchProps, onPatchStyle }: SectionEditorColumnProps) {
  const [tab, setTab] = useState<SectionTab>('content')
  if (!section) {
    return (
      <div class="grid h-full place-items-center rounded-md border border-dashed border-border p-8 text-center">
        <p class="text-sm text-fg-muted">Selecione um bloco na lista para editá-lo.</p>
      </div>
    )
  }
  const styleCount = section.style ? Object.values(section.style).filter((v) => v !== undefined && v !== '').length : 0
  return (
    <div class="space-y-3 rounded-md border border-border bg-surface p-4">
      <div class="flex items-center justify-between gap-2 flex-wrap">
        <h4 class="text-sm font-semibold text-fg">
          Editar bloco · {SECTION_TYPES.find((t) => t.value === (section.type as SectionTypeId))?.label ?? section.type}
        </h4>
        <div class="inline-flex items-center rounded-md border border-border overflow-hidden text-xs">
          <button
            type="button"
            class={cn(
              'inline-flex items-center gap-1 h-7 px-2.5 transition-colors',
              tab === 'content' ? 'bg-accent text-fg-on-brand' : 'bg-surface text-fg-muted hover:text-fg'
            )}
            onClick={() => setTab('content')}
            aria-pressed={tab === 'content'}
          >Conteúdo</button>
          <button
            type="button"
            class={cn(
              'inline-flex items-center gap-1 h-7 px-2.5 transition-colors',
              tab === 'style' ? 'bg-accent text-fg-on-brand' : 'bg-surface text-fg-muted hover:text-fg'
            )}
            onClick={() => setTab('style')}
            aria-pressed={tab === 'style'}
          >
            Aparência
            {styleCount > 0 && <Badge tone="accent">{styleCount}</Badge>}
          </button>
        </div>
      </div>
      {tab === 'content' && <SectionPropsForm key={`c-${section.id}`} section={section} onPatch={onPatchProps} />}
      {tab === 'style' && <SectionStyleEditor key={`s-${section.id}`} pageId={pageId} style={section.style ?? {}} onPatch={onPatchStyle} />}
    </div>
  )
}

interface SectionStyleEditorProps {
  pageId: number
  style: PageSectionStyle
  onPatch: (style: Partial<PageSectionStyle>) => void
}

type BgMode = 'none' | 'color' | 'image' | 'gradient'

function detectBgMode(s: PageSectionStyle): BgMode {
  if (s.gradient && (s.gradientFrom || s.gradientTo)) return 'gradient'
  if (s.backgroundImage) return 'image'
  if (s.backgroundColor) return 'color'
  return 'none'
}

const SPACING_PRESETS: { label: string; value: string }[] = [
  { label: 'Nenhum', value: '0px' },
  { label: 'Pequeno', value: '32px' },
  { label: 'Médio', value: '64px' },
  { label: 'Grande', value: '96px' },
  { label: 'Enorme', value: '128px' },
]

function SpacingQuickControl({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div class="space-y-1">
      <div class="flex items-center justify-between gap-2">
        <span class="text-xs text-fg-muted">{label}</span>
        <Input
          value={value}
          onInput={(e) => onChange((e.target as HTMLInputElement).value)}
          placeholder="auto"
          class="h-7 w-24 text-xs"
        />
      </div>
      <div class="inline-flex flex-wrap items-center gap-1">
        {SPACING_PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => onChange(p.value)}
            class={cn(
              'h-6 rounded border px-2 text-2xs transition-colors',
              value === p.value
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-border bg-surface text-fg-muted hover:text-fg hover:bg-surface-3'
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function SectionStyleEditor({ pageId, style, onPatch }: SectionStyleEditorProps) {
  // Modo do fundo precisa ser estado local: derivar só dos valores faz o modo
  // "Imagem" (sem URL ainda) e "Cor"/"Gradiente" (sem valor ainda) nunca ativarem,
  // dando a impressão de que os botões não clicam. O componente é remontado por
  // seção (key={section.id}), então o estado inicial reflete o que está salvo.
  const [bgMode, setBgModeState] = useState<BgMode>(detectBgMode(style))

  function setBgMode(mode: BgMode) {
    setBgModeState(mode)
    if (mode === 'none') {
      onPatch({ backgroundColor: '', backgroundImage: '', gradient: undefined, gradientFrom: '', gradientTo: '', overlayColor: '' })
    } else if (mode === 'color') {
      // Semeia uma cor padrão para o modo "pegar" e o canvas refletir na hora.
      onPatch({ backgroundColor: style.backgroundColor || '#ffffff', backgroundImage: '', gradient: undefined, gradientFrom: '', gradientTo: '', overlayColor: '' })
    } else if (mode === 'image') {
      onPatch({ backgroundColor: '', gradient: undefined, gradientFrom: '', gradientTo: '' })
    } else if (mode === 'gradient') {
      onPatch({ backgroundColor: '', backgroundImage: '', gradient: true, gradientFrom: style.gradientFrom || '#1a73e8', gradientTo: style.gradientTo || '#7c3aed', overlayColor: '' })
    }
  }

  return (
    <div class="space-y-4">
      {/* Animação & efeito (Fase 2 — camada FX) */}
      <fieldset class="rounded-md border border-border p-3 space-y-2">
        <legend class="px-1 text-2xs uppercase tracking-wider text-fg-muted">Animação &amp; efeito</legend>
        <Select
          label="Animação de entrada"
          value={style.animation ?? ''}
          onChange={(e) => onPatch({ animation: (e.target as HTMLSelectElement).value })}
        >
          <option value="">Nenhuma</option>
          <option value="fade-up">Surgir de baixo</option>
          <option value="fade">Aparecer</option>
          <option value="fade-down">Surgir de cima</option>
          <option value="slide-left">Deslizar da direita</option>
          <option value="slide-right">Deslizar da esquerda</option>
          <option value="zoom-in">Zoom suave</option>
          <option value="blur-in">Desfoque → nítido</option>
        </Select>
        {!!style.animation && (
          <Input
            label="Atraso (segundos)"
            type="number"
            value={style.animDelay ?? ''}
            onInput={(e) => onPatch({ animDelay: (e.target as HTMLInputElement).value })}
            placeholder="0"
          />
        )}
        <Select
          label="Efeito de rolagem"
          value={style.effect ?? ''}
          onChange={(e) => onPatch({ effect: (e.target as HTMLSelectElement).value })}
        >
          <option value="">Nenhum</option>
          <option value="parallax">Parallax</option>
        </Select>
        <p class="text-3xs text-fg-muted">Aparece na página publicada (respeita "reduzir movimento"). O preview do editor não reproduz a animação.</p>
      </fieldset>

      {/* Fundo */}
      <fieldset class="rounded-md border border-border p-3 space-y-2">
        <legend class="px-1 text-2xs uppercase tracking-wider text-fg-muted">Fundo da seção</legend>
        <div class="inline-flex items-center rounded-md border border-border overflow-hidden text-xs">
          {(['none', 'color', 'image', 'gradient'] as BgMode[]).map((m) => (
            <button
              key={m}
              type="button"
              class={cn(
                'h-7 px-2.5 transition-colors capitalize',
                bgMode === m ? 'bg-accent text-fg-on-brand' : 'bg-surface text-fg-muted hover:text-fg'
              )}
              onClick={() => setBgMode(m)}
              aria-pressed={bgMode === m}
            >
              {m === 'none' ? 'Padrão' : m === 'color' ? 'Cor' : m === 'image' ? 'Imagem' : 'Gradiente'}
            </button>
          ))}
        </div>

        {bgMode === 'color' && (
          <ColorPicker
            label="Cor de fundo"
            value={style.backgroundColor ?? '#ffffff'}
            onChange={(c) => onPatch({ backgroundColor: c })}
          />
        )}

        {bgMode === 'image' && (
          <div class="space-y-2">
            <PageImageUploader
              pageId={pageId}
              slot="section_bg"
              label="Imagem de fundo"
              value={style.backgroundImage ?? ''}
              onChange={(url) => onPatch({ backgroundImage: url })}
              hint="A imagem é renderizada com cover/center. Use overlay para deixar texto legível."
              previewHeight="lg"
            />
            <Input
              label="Cor de overlay (opcional)"
              value={style.overlayColor ?? ''}
              onInput={(e) => onPatch({ overlayColor: (e.target as HTMLInputElement).value })}
              placeholder="rgba(0,0,0,.5)"
              hint="Deixe vazio para sem overlay. Aceita rgba/hex/oklch."
            />
          </div>
        )}

        {bgMode === 'gradient' && (
          <div class="space-y-2">
            <div class="grid gap-2 sm:grid-cols-2">
              <ColorPicker
                label="De"
                value={style.gradientFrom ?? '#1a73e8'}
                onChange={(c) => onPatch({ gradientFrom: c })}
              />
              <ColorPicker
                label="Para"
                value={style.gradientTo ?? '#7c3aed'}
                onChange={(c) => onPatch({ gradientTo: c })}
              />
            </div>
            <Select
              label="Direção"
              value={style.gradientDirection ?? '135deg'}
              onChange={(e) => onPatch({ gradientDirection: (e.target as HTMLSelectElement).value })}
            >
              <option value="135deg">Diagonal ↘ (135°)</option>
              <option value="45deg">Diagonal ↗ (45°)</option>
              <option value="to right">→ Da esquerda pra direita</option>
              <option value="to left">← Da direita pra esquerda</option>
              <option value="to bottom">↓ De cima pra baixo</option>
              <option value="to top">↑ De baixo pra cima</option>
            </Select>
          </div>
        )}
      </fieldset>

      {/* Texto e alinhamento */}
      <fieldset class="rounded-md border border-border p-3 space-y-2">
        <legend class="px-1 text-2xs uppercase tracking-wider text-fg-muted">Texto</legend>
        <div class="grid gap-2 sm:grid-cols-2">
          <ColorPicker
            label="Cor do texto (opcional)"
            value={style.textColor ?? '#202124'}
            onChange={(c) => onPatch({ textColor: c })}
          />
          <Select
            label="Alinhamento"
            value={style.textAlign ?? ''}
            onChange={(e) => onPatch({ textAlign: ((e.target as HTMLSelectElement).value || undefined) as PageSectionStyle['textAlign'] })}
          >
            <option value="">— padrão —</option>
            <option value="left">Esquerda</option>
            <option value="center">Centro</option>
            <option value="right">Direita</option>
          </Select>
        </div>
      </fieldset>

      {/* Espaçamento e bordas */}
      <fieldset class="rounded-md border border-border p-3 space-y-2">
        <legend class="px-1 text-2xs uppercase tracking-wider text-fg-muted">Espaçamento e formato</legend>

        {/* Respiro rápido — atalho amigável para dar espaço no topo/base da seção */}
        <SpacingQuickControl
          label="Respiro no topo"
          value={style.paddingTop ?? ''}
          onChange={(v) => onPatch({ paddingTop: v })}
        />
        <SpacingQuickControl
          label="Respiro na base"
          value={style.paddingBottom ?? ''}
          onChange={(v) => onPatch({ paddingBottom: v })}
        />
        <p class="text-3xs text-fg-muted">Use os atalhos acima para afastar os elementos das bordas. Os campos avançados abaixo continuam disponíveis.</p>

        <div class="grid gap-2 sm:grid-cols-2">
          <Input
            label="Padding (atalho)"
            value={style.padding ?? ''}
            onInput={(e) => onPatch({ padding: (e.target as HTMLInputElement).value })}
            placeholder="80px 0"
            hint="Sobrescreve top/bottom abaixo. Ex.: 80px 0, 64px 24px."
          />
          <Input
            label="Largura máxima"
            value={style.maxWidth ?? ''}
            onInput={(e) => onPatch({ maxWidth: (e.target as HTMLInputElement).value })}
            placeholder="800px"
            hint="Centraliza horizontalmente. Vazio = largura total."
          />
          <Input
            label="Padding-top"
            value={style.paddingTop ?? ''}
            onInput={(e) => onPatch({ paddingTop: (e.target as HTMLInputElement).value })}
            placeholder="64px"
          />
          <Input
            label="Padding-bottom"
            value={style.paddingBottom ?? ''}
            onInput={(e) => onPatch({ paddingBottom: (e.target as HTMLInputElement).value })}
            placeholder="64px"
          />
          <Input
            label="Border-radius"
            value={style.borderRadius ?? ''}
            onInput={(e) => onPatch({ borderRadius: (e.target as HTMLInputElement).value })}
            placeholder="0px, 12px, 999px"
          />
          <Input
            label="Box-shadow"
            value={style.boxShadow ?? ''}
            onInput={(e) => onPatch({ boxShadow: (e.target as HTMLInputElement).value })}
            placeholder="0 4px 12px rgba(0,0,0,.1)"
          />
          <Input
            label="Borda superior"
            value={style.borderTop ?? ''}
            onInput={(e) => onPatch({ borderTop: (e.target as HTMLInputElement).value })}
            placeholder="1px solid #e5e7eb"
          />
          <Input
            label="Borda inferior"
            value={style.borderBottom ?? ''}
            onInput={(e) => onPatch({ borderBottom: (e.target as HTMLInputElement).value })}
            placeholder="1px solid #e5e7eb"
          />
          <Input
            label="Opacidade"
            value={String(style.opacity ?? '')}
            onInput={(e) => onPatch({ opacity: (e.target as HTMLInputElement).value })}
            placeholder="0.95"
            hint="Entre 0 (transparente) e 1 (opaco). Use com moderação."
          />
          <Select
            label="Overflow"
            value={style.overflow ?? ''}
            onChange={(e) => onPatch({ overflow: (e.target as HTMLSelectElement).value || undefined })}
          >
            <option value="">— padrão —</option>
            <option value="hidden">hidden</option>
            <option value="visible">visible</option>
            <option value="auto">auto</option>
          </Select>
        </div>
      </fieldset>

      <div class="flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onPatch({
            backgroundColor: '', backgroundImage: '', gradient: undefined,
            gradientFrom: '', gradientTo: '', gradientDirection: '',
            overlayColor: '', textColor: '', textAlign: undefined,
            padding: '', paddingTop: '', paddingBottom: '',
            borderRadius: '', borderTop: '', borderBottom: '',
            maxWidth: '', boxShadow: '', opacity: '', overflow: '',
          })}
        >
          Limpar todos os estilos
        </Button>
      </div>
    </div>
  )
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function SectionPropsForm({
  section,
  onPatch,
}: {
  section: PageSection
  onPatch: (props: Record<string, unknown>) => void
}) {
  const p = section.props
  const get = (k: string, fallback = '') => (typeof p[k] === 'string' ? p[k] : fallback)
  const meetingTypes = useMeetingTypes(section.type === 'scheduling')

  switch (section.type as SectionTypeId) {
    case 'hero': {
      const heroVariant = get('variant', 'centered')
      return (
        <div class="space-y-2">
          <Select label="Estilo do hero" value={heroVariant} onChange={(e) => onPatch({ variant: (e.target as HTMLSelectElement).value })}>
            <option value="centered">Centralizado</option>
            <option value="split">Dividido (texto + imagem)</option>
            <option value="gradient">Gradiente / mesh</option>
            <option value="image">Imagem de fundo</option>
          </Select>
          <Input label="Título" value={get('headline')} onInput={(e) => onPatch({ headline: (e.target as HTMLInputElement).value })} />
          <Textarea label="Subtítulo" rows={2} value={get('subheadline')} onInput={(e) => onPatch({ subheadline: (e.target as HTMLTextAreaElement).value })} />
          <div class="grid gap-2 sm:grid-cols-2">
            <Input label="Texto do botão" value={get('ctaText')} onInput={(e) => onPatch({ ctaText: (e.target as HTMLInputElement).value })} />
            <Input label="Link do botão" value={get('ctaLink')} onInput={(e) => onPatch({ ctaLink: (e.target as HTMLInputElement).value })} placeholder="#form ou https://" />
            <Input label="Botão 2 — texto (opcional)" value={get('secondaryCtaText')} onInput={(e) => onPatch({ secondaryCtaText: (e.target as HTMLInputElement).value })} />
            <Input label="Botão 2 — link" value={get('secondaryCtaLink')} onInput={(e) => onPatch({ secondaryCtaLink: (e.target as HTMLInputElement).value })} placeholder="#ou https://" />
            <Input label="Badge (opcional)" value={get('badge')} onInput={(e) => onPatch({ badge: (e.target as HTMLInputElement).value })} />
            <Select label="Alinhamento" value={get('alignment', 'center')} onChange={(e) => onPatch({ alignment: (e.target as HTMLSelectElement).value })}>
              <option value="left">Esquerda</option>
              <option value="center">Centro</option>
              <option value="right">Direita</option>
            </Select>
          </div>
          {heroVariant === 'split' && (
            <div class="grid gap-2 sm:grid-cols-2">
              <Input label="URL da imagem" value={get('image')} onInput={(e) => onPatch({ image: (e.target as HTMLInputElement).value })} placeholder="https://… ou /uploads/…" />
              <Input label="Texto alternativo" value={get('imageAlt')} onInput={(e) => onPatch({ imageAlt: (e.target as HTMLInputElement).value })} />
            </div>
          )}
          {heroVariant === 'image' && (
            <Input label="URL da imagem de fundo" value={get('backgroundImage')} onInput={(e) => onPatch({ backgroundImage: (e.target as HTMLInputElement).value })} placeholder="https://… ou /uploads/…" />
          )}
          {heroVariant === 'gradient' && (
            <fieldset class="rounded-md border border-border p-3 space-y-2">
              <legend class="px-1 text-2xs uppercase tracking-wider text-fg-muted">Cores do gradiente do hero</legend>
              <div class="grid gap-2 sm:grid-cols-2">
                <ColorPicker label="Cor inicial" value={get('gradientFrom') || '#1a73e8'} onChange={(c) => onPatch({ gradientFrom: c })} />
                <ColorPicker label="Cor final" value={get('gradientTo') || '#7c3aed'} onChange={(c) => onPatch({ gradientTo: c })} />
              </div>
              <p class="text-3xs text-fg-muted">Estas são as cores do gradiente do hero. O "Fundo da seção" na aba Aparência não afeta o hero quando o estilo é Gradiente.</p>
            </fieldset>
          )}
        </div>
      )
    }

    case 'navbar':
      return (
        <div class="space-y-2">
          <div class="grid gap-2 sm:grid-cols-2">
            <Input label="Marca (texto)" value={get('brandText')} onInput={(e) => onPatch({ brandText: (e.target as HTMLInputElement).value })} />
            <Input label="Logo (URL, opcional)" value={get('brandImage')} onInput={(e) => onPatch({ brandImage: (e.target as HTMLInputElement).value })} placeholder="/uploads/…" />
          </div>
          <ItemsEditor
            label="Links do menu"
            items={Array.isArray(p.links) ? (p.links as Record<string, unknown>[]) : []}
            onChange={(links) => onPatch({ links })}
            template={{ label: 'Novo link', href: '#' }}
            renderRow={(item, patch) => (
              <div class="grid gap-2 sm:grid-cols-2">
                <Input value={str(item.label)} onInput={(e) => patch({ label: (e.target as HTMLInputElement).value })} placeholder="Texto" />
                <Input value={str(item.href)} onInput={(e) => patch({ href: (e.target as HTMLInputElement).value })} placeholder="#secao ou https://" />
              </div>
            )}
          />
          <div class="grid gap-2 sm:grid-cols-2">
            <Input label="Botão — texto" value={get('ctaText')} onInput={(e) => onPatch({ ctaText: (e.target as HTMLInputElement).value })} />
            <Input label="Botão — link" value={get('ctaLink')} onInput={(e) => onPatch({ ctaLink: (e.target as HTMLInputElement).value })} placeholder="#form" />
          </div>
          <label class="flex items-center gap-2 text-sm text-fg-muted">
            <input type="checkbox" checked={p.sticky !== false} onChange={(e) => onPatch({ sticky: (e.target as HTMLInputElement).checked })} />
            Fixar no topo ao rolar
          </label>
        </div>
      )

    case 'sticky_cta':
      return (
        <div class="space-y-2">
          <Input label="Texto" value={get('text')} onInput={(e) => onPatch({ text: (e.target as HTMLInputElement).value })} />
          <div class="grid gap-2 sm:grid-cols-2">
            <Input label="Texto do botão" value={get('ctaText')} onInput={(e) => onPatch({ ctaText: (e.target as HTMLInputElement).value })} />
            <Input label="Link do botão" value={get('ctaLink')} onInput={(e) => onPatch({ ctaLink: (e.target as HTMLInputElement).value })} placeholder="#form ou https://" />
            <Select label="Posição" value={get('position', 'bottom')} onChange={(e) => onPatch({ position: (e.target as HTMLSelectElement).value })}>
              <option value="bottom">Inferior</option>
              <option value="top">Superior</option>
            </Select>
          </div>
        </div>
      )

    case 'before_after':
      return (
        <div class="space-y-2">
          <Input label="Título da seção" value={get('heading')} onInput={(e) => onPatch({ heading: (e.target as HTMLInputElement).value })} />
          <div class="grid gap-2 sm:grid-cols-2">
            <Input label="Imagem ANTES (URL)" value={get('beforeUrl')} onInput={(e) => onPatch({ beforeUrl: (e.target as HTMLInputElement).value })} placeholder="https://… ou /uploads/…" />
            <Input label="Imagem DEPOIS (URL)" value={get('afterUrl')} onInput={(e) => onPatch({ afterUrl: (e.target as HTMLInputElement).value })} placeholder="https://… ou /uploads/…" />
            <Input label="Rótulo antes" value={get('beforeLabel')} onInput={(e) => onPatch({ beforeLabel: (e.target as HTMLInputElement).value })} />
            <Input label="Rótulo depois" value={get('afterLabel')} onInput={(e) => onPatch({ afterLabel: (e.target as HTMLInputElement).value })} />
          </div>
        </div>
      )

    case 'bento':
      return (
        <div class="space-y-2">
          <Input label="Título da seção" value={get('heading')} onInput={(e) => onPatch({ heading: (e.target as HTMLInputElement).value })} />
          <Input label="Subtítulo" value={get('subheading')} onInput={(e) => onPatch({ subheading: (e.target as HTMLInputElement).value })} />
          <ItemsEditor
            label="Cards"
            items={Array.isArray(p.items) ? (p.items as Record<string, unknown>[]) : []}
            onChange={(items) => onPatch({ items })}
            template={{ icon: '✨', title: 'Novo card', text: '', span: '1' }}
            renderRow={(item, patch) => (
              <div class="space-y-2">
                <div class="grid gap-2 sm:grid-cols-[3rem_1fr]">
                  <Input value={str(item.icon)} onInput={(e) => patch({ icon: (e.target as HTMLInputElement).value })} placeholder="⚡" />
                  <Input value={str(item.title)} onInput={(e) => patch({ title: (e.target as HTMLInputElement).value })} placeholder="Título" />
                </div>
                <Input value={str(item.text)} onInput={(e) => patch({ text: (e.target as HTMLInputElement).value })} placeholder="Descrição" />
                <Select label="Largura" value={str(item.span) || '1'} onChange={(e) => patch({ span: (e.target as HTMLSelectElement).value })}>
                  <option value="1">1 coluna</option>
                  <option value="2">2 colunas</option>
                </Select>
              </div>
            )}
          />
        </div>
      )

    case 'features':
      return (
        <div class="space-y-2">
          <Input label="Título da seção" value={get('heading')} onInput={(e) => onPatch({ heading: (e.target as HTMLInputElement).value })} />
          <Input label="Subtítulo" value={get('subheading')} onInput={(e) => onPatch({ subheading: (e.target as HTMLInputElement).value })} />
          <ItemsEditor
            label="Benefícios"
            items={Array.isArray(p.items) ? (p.items as Record<string, unknown>[]) : []}
            onChange={(items) => onPatch({ items })}
            template={{ icon: '✨', title: 'Novo item', description: '' }}
            renderRow={(item, patch) => (
              <div class="grid gap-2 sm:grid-cols-[3rem_1fr_2fr]">
                <Input value={str(item.icon)} onInput={(e) => patch({ icon: (e.target as HTMLInputElement).value })} placeholder="🚀" />
                <Input value={str(item.title)} onInput={(e) => patch({ title: (e.target as HTMLInputElement).value })} placeholder="Título" />
                <Input value={str(item.description)} onInput={(e) => patch({ description: (e.target as HTMLInputElement).value })} placeholder="Descrição" />
              </div>
            )}
          />
        </div>
      )

    case 'form':
      return (
        <div class="space-y-2">
          <Input label="Título" value={get('heading')} onInput={(e) => onPatch({ heading: (e.target as HTMLInputElement).value })} />
          <Input label="Subtítulo" value={get('subheading')} onInput={(e) => onPatch({ subheading: (e.target as HTMLInputElement).value })} />
          <FormSelect value={p.formId} onChange={(v) => onPatch({ formId: v })} />
          <Select label="Layout" value={get('layout', 'stacked')} onChange={(e) => onPatch({ layout: (e.target as HTMLSelectElement).value })}>
            <option value="stacked">Empilhado</option>
            <option value="inline">Em linha</option>
          </Select>
        </div>
      )

    case 'cta':
      return (
        <div class="space-y-2">
          <Input label="Título" value={get('heading')} onInput={(e) => onPatch({ heading: (e.target as HTMLInputElement).value })} />
          <Textarea label="Subtítulo / Copy" rows={3} value={get('subheading')} onInput={(e) => onPatch({ subheading: (e.target as HTMLTextAreaElement).value })} placeholder="Texto de apoio abaixo do título (opcional)" />
          <Input label="Texto do botão" value={get('ctaText')} onInput={(e) => onPatch({ ctaText: (e.target as HTMLInputElement).value })} />
          <Input label="Link do botão" value={get('ctaLink')} onInput={(e) => onPatch({ ctaLink: (e.target as HTMLInputElement).value })} placeholder="#form ou https://" />
        </div>
      )

    case 'testimonials':
      return (
        <div class="space-y-2">
          <Input label="Título da seção" value={get('heading')} onInput={(e) => onPatch({ heading: (e.target as HTMLInputElement).value })} />
          <ItemsEditor
            label="Depoimentos"
            items={Array.isArray(p.items) ? (p.items as Record<string, unknown>[]) : []}
            onChange={(items) => onPatch({ items })}
            template={{ name: '', role: '', text: '', avatar: '' }}
            renderRow={(item, patch) => (
              <div class="space-y-2">
                <div class="grid gap-2 sm:grid-cols-2">
                  <Input value={str(item.name)} onInput={(e) => patch({ name: (e.target as HTMLInputElement).value })} placeholder="Nome" />
                  <Input value={str(item.role)} onInput={(e) => patch({ role: (e.target as HTMLInputElement).value })} placeholder="Cargo / empresa" />
                </div>
                <Textarea rows={2} value={str(item.text)} onInput={(e) => patch({ text: (e.target as HTMLTextAreaElement).value })} placeholder="Depoimento" />
                <Input value={str(item.avatar)} onInput={(e) => patch({ avatar: (e.target as HTMLInputElement).value })} placeholder="URL do avatar (opcional)" />
              </div>
            )}
          />
        </div>
      )

    case 'pricing':
      return (
        <div class="space-y-2">
          <Input label="Título da seção" value={get('heading')} onInput={(e) => onPatch({ heading: (e.target as HTMLInputElement).value })} />
          <Input label="Subtítulo" value={get('subheading')} onInput={(e) => onPatch({ subheading: (e.target as HTMLInputElement).value })} />
          <Input label="Anchor (#id)" value={get('anchorId')} onInput={(e) => onPatch({ anchorId: (e.target as HTMLInputElement).value })} placeholder="pricing" />
          <ItemsEditor
            label="Planos"
            items={Array.isArray(p.items) ? (p.items as Record<string, unknown>[]) : []}
            onChange={(items) => onPatch({ items })}
            template={{ name: 'Novo plano', price: 'R$ 0', period: 'mês', features: [], ctaText: 'Assinar', ctaLink: '#form' }}
            renderRow={(item, patch) => (
              <div class="space-y-2">
                <div class="grid gap-2 sm:grid-cols-2">
                  <Input value={str(item.name)} onInput={(e) => patch({ name: (e.target as HTMLInputElement).value })} placeholder="Nome do plano" />
                  <Input value={str(item.price)} onInput={(e) => patch({ price: (e.target as HTMLInputElement).value })} placeholder="R$ 99" />
                </div>
                <div class="grid gap-2 sm:grid-cols-2">
                  <Input value={str(item.period)} onInput={(e) => patch({ period: (e.target as HTMLInputElement).value })} placeholder="Período (ex.: mês)" />
                  <Input value={str(item.badge)} onInput={(e) => patch({ badge: (e.target as HTMLInputElement).value })} placeholder="Selo (ex.: Mais popular)" />
                </div>
                <Textarea
                  rows={3}
                  value={Array.isArray(item.features) ? (item.features as string[]).join('\n') : ''}
                  onInput={(e) =>
                    patch({
                      features: (e.target as HTMLTextAreaElement).value
                        .split('\n')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                  placeholder={'Recurso 1\nRecurso 2\nRecurso 3'}
                  hint="Uma linha por recurso"
                />
                <div class="grid gap-2 sm:grid-cols-2">
                  <Input value={str(item.ctaText)} onInput={(e) => patch({ ctaText: (e.target as HTMLInputElement).value })} placeholder="Texto do botão" />
                  <Input value={str(item.ctaLink)} onInput={(e) => patch({ ctaLink: (e.target as HTMLInputElement).value })} placeholder="#form ou https://" />
                </div>
                <label class="flex items-center gap-2 text-sm text-fg-muted">
                  <input type="checkbox" checked={!!item.featured} onChange={(e) => patch({ featured: (e.target as HTMLInputElement).checked })} />
                  Plano em destaque (recomendado)
                </label>
              </div>
            )}
          />
        </div>
      )

    case 'video':
      return (
        <div class="space-y-2">
          <Input label="Título (opcional)" value={get('heading')} onInput={(e) => onPatch({ heading: (e.target as HTMLInputElement).value })} />
          <Input label="URL do vídeo" type="url" value={get('url')} onInput={(e) => onPatch({ url: (e.target as HTMLInputElement).value })} placeholder="https://www.youtube.com/watch?v=..." />
        </div>
      )

    case 'text':
      return (
        <Textarea
          label="Conteúdo (HTML aceito)"
          rows={8}
          class="font-mono text-xs"
          value={decodeIfEscaped(get('content'))}
          onInput={(e) => onPatch({ content: (e.target as HTMLTextAreaElement).value })}
          hint="Aceita HTML: <p>, <ul>/<li>, <strong>, <a href>, <br>, style inline, etc."
        />
      )

    case 'footer':
      return (
        <Input
          label="Texto do rodapé"
          value={get('text')}
          onInput={(e) => onPatch({ text: (e.target as HTMLInputElement).value })}
        />
      )

    case 'faq':
      return (
        <div class="space-y-2">
          <Input label="Título da seção" value={get('heading')} onInput={(e) => onPatch({ heading: (e.target as HTMLInputElement).value })} />
          <Input label="Subtítulo" value={get('subheading')} onInput={(e) => onPatch({ subheading: (e.target as HTMLInputElement).value })} />
          <ItemsEditor
            label="Perguntas"
            items={Array.isArray(p.items) ? (p.items as Record<string, unknown>[]) : []}
            onChange={(items) => onPatch({ items })}
            template={{ question: 'Nova pergunta', answer: '' }}
            renderRow={(item, patch) => (
              <div class="space-y-2">
                <Input value={str(item.question)} onInput={(e) => patch({ question: (e.target as HTMLInputElement).value })} placeholder="Pergunta" />
                <Textarea rows={3} value={str(item.answer)} onInput={(e) => patch({ answer: (e.target as HTMLTextAreaElement).value })} placeholder="Resposta" />
              </div>
            )}
          />
        </div>
      )

    case 'accordion':
      return (
        <div class="space-y-2">
          <Input label="Título da seção" value={get('heading')} onInput={(e) => onPatch({ heading: (e.target as HTMLInputElement).value })} />
          <Input label="Subtítulo" value={get('subheading')} onInput={(e) => onPatch({ subheading: (e.target as HTMLInputElement).value })} />
          <ItemsEditor
            label="Itens"
            items={Array.isArray(p.items) ? (p.items as Record<string, unknown>[]) : []}
            onChange={(items) => onPatch({ items })}
            template={{ title: 'Tópico', content: '' }}
            renderRow={(item, patch) => (
              <div class="space-y-2">
                <Input value={str(item.title)} onInput={(e) => patch({ title: (e.target as HTMLInputElement).value })} placeholder="Título" />
                <Textarea rows={4} class="font-mono text-xs" value={decodeIfEscaped(str(item.content))} onInput={(e) => patch({ content: (e.target as HTMLTextAreaElement).value })} placeholder="Conteúdo (HTML aceito)" />
              </div>
            )}
          />
        </div>
      )

    case 'image':
      return (
        <div class="space-y-2">
          <Input label="Título (opcional)" value={get('heading')} onInput={(e) => onPatch({ heading: (e.target as HTMLInputElement).value })} />
          <Input label="URL da imagem" type="url" value={get('url')} onInput={(e) => onPatch({ url: (e.target as HTMLInputElement).value })} placeholder="https://..." />
          <Input label="Texto alternativo (alt)" value={get('alt')} onInput={(e) => onPatch({ alt: (e.target as HTMLInputElement).value })} />
          <div class="grid gap-2 sm:grid-cols-2">
            <Select label="Alinhamento" value={get('alignment', 'center')} onChange={(e) => onPatch({ alignment: (e.target as HTMLSelectElement).value })}>
              <option value="left">Esquerda</option>
              <option value="center">Centro</option>
              <option value="right">Direita</option>
            </Select>
            <Input label="Largura máxima (CSS)" value={get('maxWidth', '100%')} onInput={(e) => onPatch({ maxWidth: (e.target as HTMLInputElement).value })} placeholder="100% ou 600px" />
          </div>
          <Input label="Legenda (opcional)" value={get('caption')} onInput={(e) => onPatch({ caption: (e.target as HTMLInputElement).value })} />
        </div>
      )

    case 'logo':
      return (
        <div class="space-y-2">
          <Input label="URL da imagem do logo" type="url" value={get('url')} onInput={(e) => onPatch({ url: (e.target as HTMLInputElement).value })} placeholder="https://... (deixe vazio para usar texto)" />
          <Input label="Texto alternativo (alt)" value={get('alt', 'Logo')} onInput={(e) => onPatch({ alt: (e.target as HTMLInputElement).value })} />
          <Input label="Link ao clicar" value={get('link', '/')} onInput={(e) => onPatch({ link: (e.target as HTMLInputElement).value })} placeholder="/" />
          <div class="grid gap-2 sm:grid-cols-3">
            <Select label="Alinhamento" value={get('alignment', 'center')} onChange={(e) => onPatch({ alignment: (e.target as HTMLSelectElement).value })}>
              <option value="left">Esquerda</option>
              <option value="center">Centro</option>
              <option value="right">Direita</option>
            </Select>
            <Input label="Altura máxima" value={get('maxHeight', '60px')} onInput={(e) => onPatch({ maxHeight: (e.target as HTMLInputElement).value })} />
            <Input label="Padding" value={get('padding', '24px')} onInput={(e) => onPatch({ padding: (e.target as HTMLInputElement).value })} />
          </div>
          <Input label="Texto fallback (sem imagem)" value={get('text')} onInput={(e) => onPatch({ text: (e.target as HTMLInputElement).value })} placeholder="Sua Marca" />
        </div>
      )

    case 'logos':
      return (
        <div class="space-y-2">
          <Input label="Título da seção" value={get('heading')} onInput={(e) => onPatch({ heading: (e.target as HTMLInputElement).value })} />
          <Select label="Estilo" value={get('variant', 'grid')} onChange={(e) => onPatch({ variant: (e.target as HTMLSelectElement).value })}>
            <option value="grid">Grade</option>
            <option value="marquee">Marquee (rolagem infinita)</option>
          </Select>
          <ItemsEditor
            label="Logos"
            items={Array.isArray(p.items) ? (p.items as Record<string, unknown>[]) : []}
            onChange={(items) => onPatch({ items })}
            template={{ url: '', alt: '' }}
            renderRow={(item, patch) => (
              <div class="grid gap-2 sm:grid-cols-2">
                <Input value={str(item.url)} onInput={(e) => patch({ url: (e.target as HTMLInputElement).value })} placeholder="https://..." />
                <Input value={str(item.alt)} onInput={(e) => patch({ alt: (e.target as HTMLInputElement).value })} placeholder="Nome do cliente" />
              </div>
            )}
          />
        </div>
      )

    case 'gallery':
      return (
        <div class="space-y-2">
          <Input label="Título da seção" value={get('heading')} onInput={(e) => onPatch({ heading: (e.target as HTMLInputElement).value })} />
          <Select label="Colunas" value={String(num(p.columns, 3))} onChange={(e) => onPatch({ columns: Number((e.target as HTMLSelectElement).value) })}>
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="4">4</option>
            <option value="5">5</option>
          </Select>
          <ItemsEditor
            label="Imagens"
            items={Array.isArray(p.items) ? (p.items as Record<string, unknown>[]) : []}
            onChange={(items) => onPatch({ items })}
            template={{ url: '', alt: '' }}
            renderRow={(item, patch) => (
              <div class="grid gap-2 sm:grid-cols-2">
                <Input value={str(item.url)} onInput={(e) => patch({ url: (e.target as HTMLInputElement).value })} placeholder="URL" />
                <Input value={str(item.alt)} onInput={(e) => patch({ alt: (e.target as HTMLInputElement).value })} placeholder="Alt" />
              </div>
            )}
          />
        </div>
      )

    case 'carousel_images':
      return (
        <div class="space-y-2">
          <Input label="Título" value={get('heading')} onInput={(e) => onPatch({ heading: (e.target as HTMLInputElement).value })} />
          <Input label="Subtítulo" value={get('subheading')} onInput={(e) => onPatch({ subheading: (e.target as HTMLInputElement).value })} />
          <div class="grid gap-2 sm:grid-cols-2">
            <Input label="Largura do item" value={get('itemWidth', '320px')} onInput={(e) => onPatch({ itemWidth: (e.target as HTMLInputElement).value })} />
            <Input label="Altura do item" value={get('itemHeight', '220px')} onInput={(e) => onPatch({ itemHeight: (e.target as HTMLInputElement).value })} />
          </div>
          <ItemsEditor
            label="Slides"
            items={Array.isArray(p.items) ? (p.items as Record<string, unknown>[]) : []}
            onChange={(items) => onPatch({ items })}
            template={{ url: '', alt: '' }}
            renderRow={(item, patch) => (
              <div class="grid gap-2 sm:grid-cols-2">
                <Input value={str(item.url)} onInput={(e) => patch({ url: (e.target as HTMLInputElement).value })} placeholder="URL" />
                <Input value={str(item.alt)} onInput={(e) => patch({ alt: (e.target as HTMLInputElement).value })} placeholder="Alt" />
              </div>
            )}
          />
        </div>
      )

    case 'carousel_videos':
      return (
        <div class="space-y-2">
          <Input label="Título" value={get('heading')} onInput={(e) => onPatch({ heading: (e.target as HTMLInputElement).value })} />
          <ItemsEditor
            label="Vídeos"
            items={Array.isArray(p.items) ? (p.items as Record<string, unknown>[]) : []}
            onChange={(items) => onPatch({ items })}
            template={{ url: '', title: '' }}
            renderRow={(item, patch) => (
              <div class="space-y-2">
                <Input value={str(item.url)} onInput={(e) => patch({ url: (e.target as HTMLInputElement).value })} placeholder="https://youtube.com/..." />
                <Input value={str(item.title)} onInput={(e) => patch({ title: (e.target as HTMLInputElement).value })} placeholder="Título (alt)" />
              </div>
            )}
          />
        </div>
      )

    case 'stats':
      return (
        <div class="space-y-2">
          <Input label="Título da seção" value={get('heading')} onInput={(e) => onPatch({ heading: (e.target as HTMLInputElement).value })} />
          <Input label="Cor de fundo (CSS — opcional)" value={get('background')} onInput={(e) => onPatch({ background: (e.target as HTMLInputElement).value })} placeholder="#1a73e8 ou linear-gradient(...)" />
          <ItemsEditor
            label="Números"
            items={Array.isArray(p.items) ? (p.items as Record<string, unknown>[]) : []}
            onChange={(items) => onPatch({ items })}
            template={{ number: '+0', label: '' }}
            renderRow={(item, patch) => (
              <div class="grid gap-2 sm:grid-cols-2">
                <Input value={str(item.number)} onInput={(e) => patch({ number: (e.target as HTMLInputElement).value })} placeholder="+1.000" />
                <Input value={str(item.label)} onInput={(e) => patch({ label: (e.target as HTMLInputElement).value })} placeholder="Clientes atendidos" />
              </div>
            )}
          />
        </div>
      )

    case 'countdown':
      return (
        <div class="space-y-2">
          <Input label="Título" value={get('heading')} onInput={(e) => onPatch({ heading: (e.target as HTMLInputElement).value })} />
          <Input label="Subtítulo" value={get('subheading')} onInput={(e) => onPatch({ subheading: (e.target as HTMLInputElement).value })} />
          <Input
            label="Data alvo (ISO)"
            type="datetime-local"
            value={get('targetDate')}
            onInput={(e) => onPatch({ targetDate: (e.target as HTMLInputElement).value })}
            hint="Formato: 2026-12-31T23:59"
          />
          <div class="grid gap-2 sm:grid-cols-2">
            <Input label="Texto do botão (opcional)" value={get('ctaText')} onInput={(e) => onPatch({ ctaText: (e.target as HTMLInputElement).value })} />
            <Input label="Link do botão" value={get('ctaLink', '#form')} onInput={(e) => onPatch({ ctaLink: (e.target as HTMLInputElement).value })} />
          </div>
        </div>
      )

    case 'team':
      return (
        <div class="space-y-2">
          <Input label="Título da seção" value={get('heading')} onInput={(e) => onPatch({ heading: (e.target as HTMLInputElement).value })} />
          <Input label="Subtítulo" value={get('subheading')} onInput={(e) => onPatch({ subheading: (e.target as HTMLInputElement).value })} />
          <ItemsEditor
            label="Membros"
            items={Array.isArray(p.items) ? (p.items as Record<string, unknown>[]) : []}
            onChange={(items) => onPatch({ items })}
            template={{ name: '', role: '', photo: '', bio: '' }}
            renderRow={(item, patch) => (
              <div class="space-y-2">
                <div class="grid gap-2 sm:grid-cols-2">
                  <Input value={str(item.name)} onInput={(e) => patch({ name: (e.target as HTMLInputElement).value })} placeholder="Nome" />
                  <Input value={str(item.role)} onInput={(e) => patch({ role: (e.target as HTMLInputElement).value })} placeholder="Cargo" />
                </div>
                <Input value={str(item.photo)} onInput={(e) => patch({ photo: (e.target as HTMLInputElement).value })} placeholder="URL da foto (opcional)" />
                <Textarea rows={2} value={str(item.bio)} onInput={(e) => patch({ bio: (e.target as HTMLTextAreaElement).value })} placeholder="Bio curta (opcional)" />
              </div>
            )}
          />
        </div>
      )

    case 'contact':
      return (
        <div class="space-y-2">
          <Input label="Título da seção" value={get('heading')} onInput={(e) => onPatch({ heading: (e.target as HTMLInputElement).value })} />
          <Input label="Subtítulo" value={get('subheading')} onInput={(e) => onPatch({ subheading: (e.target as HTMLInputElement).value })} />
          <ItemsEditor
            label="Itens de contato"
            items={Array.isArray(p.items) ? (p.items as Record<string, unknown>[]) : []}
            onChange={(items) => onPatch({ items })}
            template={{ type: 'phone', label: '', value: '', link: '' }}
            renderRow={(item, patch) => (
              <div class="space-y-2">
                <div class="grid gap-2 sm:grid-cols-2">
                  <Select value={str(item.type) || 'phone'} onChange={(e) => patch({ type: (e.target as HTMLSelectElement).value })}>
                    <option value="phone">Telefone 📞</option>
                    <option value="email">E-mail ✉️</option>
                    <option value="whatsapp">WhatsApp 💬</option>
                    <option value="address">Endereço 📍</option>
                    <option value="hours">Horário 🕐</option>
                    <option value="site">Site 🌐</option>
                  </Select>
                  <Input value={str(item.label)} onInput={(e) => patch({ label: (e.target as HTMLInputElement).value })} placeholder="Label (ex: Telefone)" />
                </div>
                <Input value={str(item.value)} onInput={(e) => patch({ value: (e.target as HTMLInputElement).value })} placeholder="Valor (ex: (00) 00000-0000)" />
                <Input value={str(item.link)} onInput={(e) => patch({ link: (e.target as HTMLInputElement).value })} placeholder="Link (tel:, mailto:, https://...)" />
              </div>
            )}
          />
        </div>
      )

    case 'social':
      return (
        <div class="space-y-2">
          <Input label="Título (opcional)" value={get('heading')} onInput={(e) => onPatch({ heading: (e.target as HTMLInputElement).value })} placeholder="Siga a gente" />
          <ItemsEditor
            label="Redes sociais"
            items={Array.isArray(p.items) ? (p.items as Record<string, unknown>[]) : []}
            onChange={(items) => onPatch({ items })}
            template={{ platform: 'instagram', url: '', label: '' }}
            renderRow={(item, patch) => (
              <div class="space-y-2">
                <div class="grid gap-2 sm:grid-cols-2">
                  <Select value={str(item.platform) || 'instagram'} onChange={(e) => patch({ platform: (e.target as HTMLSelectElement).value })}>
                    <option value="instagram">Instagram 📸</option>
                    <option value="facebook">Facebook 👤</option>
                    <option value="linkedin">LinkedIn 💼</option>
                    <option value="twitter">Twitter / X 🐦</option>
                    <option value="youtube">YouTube ▶️</option>
                    <option value="tiktok">TikTok 🎵</option>
                    <option value="whatsapp">WhatsApp 💬</option>
                    <option value="github">GitHub 💻</option>
                    <option value="pinterest">Pinterest 📌</option>
                    <option value="telegram">Telegram ✈️</option>
                  </Select>
                  <Input value={str(item.label)} onInput={(e) => patch({ label: (e.target as HTMLInputElement).value })} placeholder="Label (acessibilidade)" />
                </div>
                <Input value={str(item.url)} onInput={(e) => patch({ url: (e.target as HTMLInputElement).value })} placeholder="https://..." />
              </div>
            )}
          />
        </div>
      )

    case 'banner':
      return (
        <div class="space-y-2">
          <Input label="Texto do banner" value={get('text')} onInput={(e) => onPatch({ text: (e.target as HTMLInputElement).value })} />
          <div class="grid gap-2 sm:grid-cols-3">
            <Input label="Ícone (emoji)" value={get('icon')} onInput={(e) => onPatch({ icon: (e.target as HTMLInputElement).value })} placeholder="🎉" />
            <Input label="Cor de fundo" value={get('backgroundColor')} onInput={(e) => onPatch({ backgroundColor: (e.target as HTMLInputElement).value })} placeholder="#0d47a1" />
            <Input label="Cor do texto" value={get('textColor')} onInput={(e) => onPatch({ textColor: (e.target as HTMLInputElement).value })} placeholder="#ffffff" />
          </div>
          <div class="grid gap-2 sm:grid-cols-2">
            <Input label="Texto do CTA (opcional)" value={get('ctaText')} onInput={(e) => onPatch({ ctaText: (e.target as HTMLInputElement).value })} />
            <Input label="Link do CTA" value={get('ctaLink', '#')} onInput={(e) => onPatch({ ctaLink: (e.target as HTMLInputElement).value })} />
          </div>
        </div>
      )

    case 'columns':
      return (
        <div class="space-y-2">
          <Input label="Título (opcional)" value={get('heading')} onInput={(e) => onPatch({ heading: (e.target as HTMLInputElement).value })} />
          <Input label="Espaçamento (gap CSS)" value={get('gap', '32px')} onInput={(e) => onPatch({ gap: (e.target as HTMLInputElement).value })} />
          <ItemsEditor
            label="Colunas"
            items={Array.isArray(p.columns) ? (p.columns as Record<string, unknown>[]) : []}
            onChange={(columns) => onPatch({ columns })}
            template={{ content: '<p>Conteúdo da coluna…</p>' }}
            renderRow={(item, patch) => (
              <Textarea rows={4} class="font-mono text-xs" value={decodeIfEscaped(str(item.content))} onInput={(e) => patch({ content: (e.target as HTMLTextAreaElement).value })} placeholder="HTML da coluna" />
            )}
          />
        </div>
      )

    case 'map':
      return (
        <div class="space-y-2">
          <Input label="Título (opcional)" value={get('heading')} onInput={(e) => onPatch({ heading: (e.target as HTMLInputElement).value })} />
          <Input label="Subtítulo" value={get('subheading')} onInput={(e) => onPatch({ subheading: (e.target as HTMLInputElement).value })} />
          <Input label="Endereço" value={get('address')} onInput={(e) => onPatch({ address: (e.target as HTMLInputElement).value })} placeholder="Av. Paulista, 1000, São Paulo" hint="Se preenchido, gera embed automaticamente" />
          <Input label="URL de embed (opcional)" type="url" value={get('embedUrl')} onInput={(e) => onPatch({ embedUrl: (e.target as HTMLInputElement).value })} placeholder="https://www.google.com/maps/embed?..." />
          <Input label="Altura (px)" value={get('height', '400')} onInput={(e) => onPatch({ height: (e.target as HTMLInputElement).value })} />
        </div>
      )

    case 'scheduling': {
      const items = meetingTypes.data?.items?.filter((m) => m.active) ?? []
      return (
        <div class="space-y-2">
          <Input label="Título (opcional)" value={get('heading')} onInput={(e) => onPatch({ heading: (e.target as HTMLInputElement).value })} />
          <Input label="Subtítulo (opcional)" value={get('subheading')} onInput={(e) => onPatch({ subheading: (e.target as HTMLInputElement).value })} />
          <Select label="Tipo de reunião" value={get('slug')} onChange={(e) => onPatch({ slug: (e.target as HTMLSelectElement).value })}>
            <option value="">— Selecione —</option>
            {items.map((m) => <option key={m.id} value={m.slug}>{m.name}</option>)}
          </Select>
          {meetingTypes.isLoading
            ? <p class="text-xs text-fg-muted">Carregando tipos…</p>
            : items.length === 0 && <p class="text-xs text-fg-muted">Nenhum tipo de reunião ativo. Crie um em Agendamentos.</p>}
          <Input label="Altura (px)" value={get('height', '760')} onInput={(e) => onPatch({ height: (e.target as HTMLInputElement).value })} />
        </div>
      )
    }

    case 'raw_html':
      return (
        <Textarea
          label="HTML personalizado"
          rows={12}
          class="font-mono text-xs"
          value={get('html')}
          onInput={(e) => onPatch({ html: (e.target as HTMLTextAreaElement).value })}
          hint="O HTML é sanitizado: tags como <script>, <iframe> de domínios não-permitidos, eventos JS inline e CSS perigoso são removidos."
        />
      )

    case 'spacer':
      return (
        <Input
          label="Altura (px)"
          type="number"
          value={String(num(p.height, 48))}
          onInput={(e) => onPatch({ height: Number((e.target as HTMLInputElement).value) || 0 })}
        />
      )

    case 'divider':
      return (
        <div class="space-y-2">
          <div class="grid gap-2 sm:grid-cols-3">
            <Select label="Estilo" value={get('variant', 'solid')} onChange={(e) => onPatch({ variant: (e.target as HTMLSelectElement).value })}>
              <option value="solid">Sólido</option>
              <option value="thick">Grosso</option>
              <option value="dotted">Pontilhado</option>
              <option value="dashed">Tracejado</option>
            </Select>
            <Input label="Largura" value={get('width', '100%')} onInput={(e) => onPatch({ width: (e.target as HTMLInputElement).value })} />
            <Input label="Padding" value={get('padding', '16px')} onInput={(e) => onPatch({ padding: (e.target as HTMLInputElement).value })} />
          </div>
          <label class="flex items-center gap-2 text-sm text-fg">
            <input
              type="checkbox"
              checked={!!p.colored}
              onChange={(e) => onPatch({ colored: (e.target as HTMLInputElement).checked })}
            />
            Usar cor primária da página
          </label>
        </div>
      )
  }
}

function FormSelect({
  value,
  onChange,
}: {
  value: unknown
  onChange: (v: number | null) => void
}) {
  const { data } = useForms()
  const current = typeof value === 'number' ? String(value) : ''
  return (
    <Select
      label="Formulário vinculado"
      value={current}
      onChange={(e) => {
        const v = (e.target as HTMLSelectElement).value
        onChange(v ? Number(v) : null)
      }}
    >
      <option value="">Sem formulário</option>
      {data?.forms.map((f) => (
        <option key={f.id} value={f.id}>
          {f.name}
        </option>
      ))}
    </Select>
  )
}

interface ItemsEditorProps {
  label: string
  items: Record<string, unknown>[]
  onChange: (items: Record<string, unknown>[]) => void
  template: Record<string, unknown>
  renderRow: (item: Record<string, unknown>, patch: (p: Record<string, unknown>) => void) => preact.ComponentChildren
}

function ItemsEditor({ label, items, onChange, template, renderRow }: ItemsEditorProps) {
  function patch(idx: number, p: Record<string, unknown>) {
    onChange(items.map((it, i) => (i === idx ? { ...it, ...p } : it)))
  }
  function remove(idx: number) {
    onChange(items.filter((_, i) => i !== idx))
  }
  function move(idx: number, dir: -1 | 1) {
    const ni = idx + dir
    if (ni < 0 || ni >= items.length) return
    const next = [...items]
    const a = next[idx]
    const b = next[ni]
    if (!a || !b) return
    next[idx] = b
    next[ni] = a
    onChange(next)
  }

  return (
    <div class="space-y-2 rounded-md border border-border bg-surface-2 p-3">
      <div class="flex items-center justify-between">
        <span class="text-xs font-medium text-fg-muted">{label} ({items.length})</span>
        <Button variant="ghost" size="sm" onClick={() => onChange([...items, { ...template }])}>
          <Plus size={12} /> Adicionar
        </Button>
      </div>
      {items.length === 0 && <p class="text-xs text-fg-muted">Nenhum item ainda.</p>}
      <div class="space-y-3">
        {items.map((it, i) => (
          <div key={i} class="rounded-md border border-border bg-surface p-2">
            <div class="mb-2 flex items-center justify-between">
              <span class="text-2xs text-fg-muted">#{i + 1}</span>
              <div class="flex gap-0.5">
                <button
                  type="button"
                  class="size-6 grid place-items-center rounded text-fg-muted hover:text-fg hover:bg-surface-3 disabled:opacity-30"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  aria-label="Mover para cima"
                >
                  ↑
                </button>
                <button
                  type="button"
                  class="size-6 grid place-items-center rounded text-fg-muted hover:text-fg hover:bg-surface-3 disabled:opacity-30"
                  onClick={() => move(i, 1)}
                  disabled={i === items.length - 1}
                  aria-label="Mover para baixo"
                >
                  ↓
                </button>
                <button
                  type="button"
                  class="size-6 grid place-items-center rounded text-fg-muted hover:text-danger hover:bg-surface-3"
                  onClick={() => remove(i)}
                  aria-label="Remover"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
            {renderRow(it, (p) => patch(i, p))}
          </div>
        ))}
      </div>
    </div>
  )
}
