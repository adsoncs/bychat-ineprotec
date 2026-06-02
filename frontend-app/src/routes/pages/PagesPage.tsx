import { useEffect, useState } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  Globe, Plus, Pencil, Trash2, Copy, ExternalLink, Eye, ListTree, BarChart3,
  LayoutTemplate, FileText, Power, PowerOff, Archive, Palette,
  Settings as SettingsIcon, Search, Code, Image as ImageIcon, HelpCircle,
} from 'lucide-preact'
import { HowItWorksModal } from '@/components/ui/HowItWorksModal'
import {
  usePages,
  usePage,
  useCreatePage,
  useUpdatePage,
  usePublishPage,
  useDuplicatePage,
  useDeletePage,
  usePageTemplates,
  usePageConversions,
  type LandingPageItem,
  type PageTemplate,
  type PageConversion,
} from '@/hooks/usePages'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Input, Textarea } from '@/components/ui/Input'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { PageSectionsEditor } from '@/components/PageSectionsEditor'
import { LandingAppearancePanel } from '@/components/LandingAppearancePanel'
import { PageImageUploader } from '@/components/PageImageUploader'
import { formatDateTime } from '@/lib/format'
import { pageStatusLabel } from '@/lib/statusLabels'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/cn'

const statusTone: Record<string, 'accent' | 'neutral' | 'warning' | 'info'> = {
  PUBLISHED: 'accent',
  DRAFT: 'info',
  ARCHIVED: 'neutral',
}

export function PagesPage() {
  const { data, isLoading } = usePages()
  const [, navigate] = useLocation()
  const [editing, setEditing] = useState<LandingPageItem | null>(null)
  const [editingSections, setEditingSections] = useState<LandingPageItem | null>(null)
  const [editingAppearance, setEditingAppearance] = useState<LandingPageItem | null>(null)
  const [creating, setCreating] = useState(false)
  const [pickingTemplate, setPickingTemplate] = useState(false)
  const [deleting, setDeleting] = useState<LandingPageItem | null>(null)
  const [conversionsOf, setConversionsOf] = useState<LandingPageItem | null>(null)
  const [showHowItWorks, setShowHowItWorks] = useState(false)
  const publish = usePublishPage()
  const duplicate = useDuplicatePage()

  function changeStatus(p: LandingPageItem, target: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED') {
    if (p.status === target) return
    publish.mutate({ id: p.id, status: target }, {
      onSuccess: () => {
        const msg = target === 'PUBLISHED' ? 'Página publicada' : target === 'ARCHIVED' ? 'Página arquivada' : 'Página despublicada'
        toast(msg, 'success')
      },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function handleDuplicate(p: LandingPageItem) {
    duplicate.mutate(p.id, {
      onSuccess: () => toast('Página duplicada', 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <Page
      title="Landing Pages"
      description="Controle total: blocos, aparência (logo, cores, fontes, botões), SEO, mídia social, tracking e código personalizado."
      actions={
        <>
          <Button variant="ghost" size="sm" onClick={() => setShowHowItWorks(true)}>
            <HelpCircle size={14} /> Como funciona?
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setPickingTemplate(true)}>
            <LayoutTemplate size={14} /> A partir de um modelo
          </Button>
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            <Plus size={14} /> Nova página
          </Button>
        </>
      }
    >
      {isLoading && (
        <div class="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} class="h-14 w-full" />)}
        </div>
      )}
      {!isLoading && data?.pages.length === 0 && (
        <EmptyState
          icon={<Globe size={24} />}
          title="Nenhuma landing page criada"
          action={<Button size="sm" variant="primary" onClick={() => setCreating(true)}><Plus size={14} /> Criar primeira</Button>}
        />
      )}
      {!isLoading && data && data.pages.length > 0 && (
        <Card class="p-0 overflow-hidden">
          <ul class="divide-y divide-border">
            {data.pages.map((p) => (
              <li key={p.id} class="px-4 py-3 flex items-center gap-3 flex-wrap">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="text-sm text-fg truncate">{p.title}</span>
                    <Badge tone={statusTone[p.status] ?? 'neutral'}>{pageStatusLabel(p.status)}</Badge>
                  </div>
                  <div class="text-xs text-fg-muted mt-0.5 truncate">/{p.slug} · atualizado em {formatDateTime(p.updatedAt)}</div>
                </div>
                <div class="hidden md:flex gap-4 text-right shrink-0">
                  <Stat label="Views" value={p.views} />
                </div>
                {/* Ações sempre visíveis (paridade com Formulários). flex-wrap permite quebrar em telas estreitas. */}
                <div class="flex gap-1.5 shrink-0 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setConversionsOf(p)}
                    class={cn(
                      'inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium border transition-colors',
                      p.submissions > 0
                        ? 'bg-accent text-fg-on-brand border-accent hover:bg-accent-hover'
                        : 'bg-surface-2 text-fg-muted border-border hover:bg-surface-3 hover:text-fg',
                    )}
                    aria-label="Ver conversões"
                    title="Ver conversões"
                  >
                    <BarChart3 size={12} /> {p.submissions} {p.submissions === 1 ? 'conversão' : 'conversões'}
                  </button>
                  <a
                    href={`/p/${p.slug}?preview=true`}
                    target="_blank"
                    rel="noreferrer"
                    class="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium border border-border bg-surface-2 text-fg-muted hover:bg-surface-3 hover:text-fg transition-colors"
                    aria-label="Pré-visualizar"
                    title="Pré-visualizar"
                  >
                    <Eye size={12} /> Pré-visualizar
                  </a>
                  {p.status === 'PUBLISHED' && (
                    <a
                      href={`/p/${p.slug}`}
                      target="_blank"
                      rel="noreferrer"
                      class="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium border border-accent bg-accent text-fg-on-brand hover:bg-accent-hover transition-colors"
                      aria-label="Abrir página publicada"
                      title="Abrir página publicada"
                    >
                      <ExternalLink size={12} /> Abrir
                    </a>
                  )}
                  <Button variant="primary" size="sm" onClick={() => navigate(`/pages/${p.id}/editor`)} aria-label="Abrir editor" title="Abrir editor visual (blocos + preview ao vivo)">
                    <ListTree size={12} /> Editor
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setEditingAppearance(p)} aria-label="Aparência" title="Aparência (logo, cores, fontes, botões, espaçamento, CSS)">
                    <Palette size={12} /> Aparência
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setEditing(p)} aria-label="Configurar página" title="Configurar (SEO, mídia, tracking, código)">
                    <Pencil size={12} /> Editar
                  </Button>
                  <StatusMenu page={p} onChange={(s) => changeStatus(p, s)} />
                  <Button variant="secondary" size="sm" onClick={() => handleDuplicate(p)} aria-label="Duplicar" title="Duplicar">
                    <Copy size={12} /> Duplicar
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setDeleting(p)}
                    aria-label="Excluir"
                    title="Excluir"
                    class="!text-danger border-danger/30 hover:bg-danger/10"
                  >
                    <Trash2 size={12} />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {(creating || editing) && (
        <PageFormModal page={editing} onClose={() => { setCreating(false); setEditing(null) }} />
      )}
      {editingSections && (
        <PageSectionsEditor
          pageId={editingSections.id}
          pageTitle={editingSections.title}
          onClose={() => setEditingSections(null)}
        />
      )}
      {editingAppearance && (
        <LandingAppearanceModal pageId={editingAppearance.id} onClose={() => setEditingAppearance(null)} />
      )}
      {deleting && <DeletePageDialog page={deleting} onClose={() => setDeleting(null)} />}
      {pickingTemplate && (
        <TemplatePickerModal
          onClose={() => setPickingTemplate(false)}
          onCreated={(p) => setEditingSections(p)}
        />
      )}
      {conversionsOf && <ConversionsModal page={conversionsOf} onClose={() => setConversionsOf(null)} />}

      <HowItWorksModal
        open={showHowItWorks}
        onClose={() => setShowHowItWorks(false)}
        title="Como funcionam as Landing Pages?"
        problem={<>
          Você quer rodar uma campanha (curso, promoção, lançamento) e precisa de uma <strong>página
          dedicada</strong> que converta. Sem precisar de WordPress, designer ou desenvolvedor — você
          monta aqui, publica e o tráfego do anúncio já cai num formulário que vira lead.
        </>}
        steps={[
          {
            title: '🎨 Começa por um modelo (ou do zero)',
            body: <>Botão <strong>A partir de um modelo</strong> mostra layouts prontos (curso, evento, lançamento, captura). Ou <strong>Nova página</strong> pra montar livre. Cada página tem URL única (ex.: bychat.ia.br/p/black-friday).</>,
          },
          {
            title: '🧱 Monte com blocos',
            body: <>Banner, texto, vídeo, depoimentos, FAQ, formulário, contagem regressiva, galeria. Arraste, reordene, edite o conteúdo. Cada bloco tem opção de cor/fonte própria.</>,
          },
          {
            title: '✏️ Aparência global',
            body: <>Painel <strong>Aparência</strong>: defina logo, cor primária, fonte, estilo de botão, formato dos cantos. Vale pra todos os blocos automaticamente. Tem 7 presets prontos.</>,
          },
          {
            title: '🔍 SEO, redes sociais e tracking',
            body: <>Configure título/descrição (Google), imagem do compartilhamento (WhatsApp/Insta), pixel do Meta, Google Analytics. Tudo numa aba só, sem mexer no código.</>,
          },
          {
            title: '🚀 Publique',
            body: <>Botão <strong>Publicar</strong> coloca no ar. Use <strong>Arquivar</strong> pra tirar do ar sem perder o conteúdo. <strong>Conversões</strong> mostra quem preencheu o formulário e virou lead.</>,
          },
        ]}
        tip={{
          tone: 'info',
          title: '💡 Dica',
          body: <>Pra rodar A/B: <strong>duplique</strong> uma página, troque headline/call-to-action, publique nas duas URLs, mande tráfego no mesmo anúncio dividido — depois compare conversões.</>,
        }}
      />
    </Page>
  )
}

type LpStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'

const STATUS_OPTIONS: { value: LpStatus; label: string; icon: typeof Power }[] = [
  { value: 'DRAFT', label: 'Rascunho', icon: PowerOff },
  { value: 'PUBLISHED', label: 'Publicada', icon: Power },
  { value: 'ARCHIVED', label: 'Arquivada', icon: Archive },
]

function StatusMenu({ page, onChange }: { page: LandingPageItem; onChange: (s: LpStatus) => void }) {
  const current = STATUS_OPTIONS.find((o) => o.value === page.status) ?? STATUS_OPTIONS[0]!
  const Icon = current.icon
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          class="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium border border-border bg-surface-2 text-fg-muted hover:bg-surface-3 hover:text-fg transition-colors"
          aria-label={`Status: ${current.label}`}
          title={`Status: ${current.label}`}
        >
          <Icon size={12} /> {current.label}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          class="min-w-[10rem] rounded-md bg-surface-2 border border-border shadow-lg p-1"
          style={{ zIndex: 'var(--z-popover)' }}
        >
          {STATUS_OPTIONS.map((opt) => {
            const OptIcon = opt.icon
            const isCurrent = opt.value === page.status
            return (
              <DropdownMenu.Item
                key={opt.value}
                class={`flex items-center gap-2 h-8 px-2 rounded-sm text-sm cursor-pointer hover:bg-surface-3 outline-none ${isCurrent ? 'text-fg font-medium' : ''}`}
                onSelect={() => onChange(opt.value)}
              >
                <OptIcon size={14} />
                <span class="flex-1">{opt.label}</span>
                {isCurrent && <span class="text-accent">●</span>}
              </DropdownMenu.Item>
            )
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function TemplatePickerModal({ onClose, onCreated }: { onClose: () => void; onCreated: (p: LandingPageItem) => void }) {
  const { data, isLoading } = usePageTemplates()
  const create = useCreatePage()
  const [picked, setPicked] = useState<PageTemplate | null>(null)
  const [title, setTitle] = useState('')

  function handleCreate() {
    if (!picked) return
    if (!title.trim()) { toast('Informe o título', 'danger'); return }
    create.mutate(
      {
        title: title.trim(),
        ...({ templateId: picked.id, sections: picked.sections } as Record<string, unknown>),
      },
      {
        onSuccess: (res) => {
          toast('Página criada — abrindo editor de blocos', 'success')
          onClose()
          onCreated(res.page)
        },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      },
    )
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Criar a partir de modelo"
      size="lg"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={create.isPending}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleCreate} disabled={!picked || !title.trim() || create.isPending}>
            {create.isPending ? 'Criando…' : 'Criar página'}
          </Button>
        </>
      }
    >
      {isLoading && <Skeleton class="h-32 w-full" />}
      {!isLoading && data?.templates.length === 0 && (
        <div class="text-sm text-fg-muted text-center py-6">Nenhum modelo disponível.</div>
      )}
      {!isLoading && data && data.templates.length > 0 && (
        <div class="space-y-3">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {data.templates.map((t) => (
              <button
                key={t.id}
                type="button"
                class={`text-left rounded-md border p-3 cursor-pointer transition-colors ${
                  picked?.id === t.id ? 'border-accent bg-accent/5' : 'border-border hover:bg-surface-3'
                }`}
                onClick={() => { setPicked(t); if (!title) setTitle(t.name) }}
              >
                {t.thumbnailUrl && (
                  <img src={t.thumbnailUrl} alt="" class="w-full aspect-video object-cover rounded mb-2" />
                )}
                <div class="text-sm font-medium text-fg">{t.name}</div>
                {t.category && <div class="text-[0.6875rem] uppercase tracking-wider text-fg-subtle mt-0.5">{t.category}</div>}
                {t.description && <div class="text-xs text-fg-muted mt-1 line-clamp-2">{t.description}</div>}
              </button>
            ))}
          </div>
          {picked && (
            <div class="border-t border-border pt-3">
              <Input
                label="Título da nova página"
                value={title}
                onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
                placeholder="Ex.: Vestibular 2027/1"
              />
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

// Wrapper de modal pra carregar o detalhe da página antes de montar o painel.
function LandingAppearanceModal({ pageId, onClose }: { pageId: number; onClose: () => void }) {
  const { data: page, isLoading } = usePage(pageId)
  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Aparência da landing page"
      description="Controle total de cores, tipografia, botões, espaçamento e CSS. Preview ao vivo à direita."
      size="xl"
      unconstrained
    >
      {isLoading || !page
        ? <Skeleton class="h-96 w-full" />
        : <div class="h-[78vh] px-4 sm:px-6"><LandingAppearancePanel page={page} onClose={onClose} /></div>}
    </Modal>
  )
}

function ConversionsModal({ page, onClose }: { page: LandingPageItem; onClose: () => void }) {
  const { data, isLoading } = usePageConversions(page.id, 100)

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Conversões — ${page.title}`}
      description={`/${page.slug} · ${page.submissions} submissões totais`}
      size="lg"
      footer={<Button variant="secondary" size="sm" onClick={onClose}>Fechar</Button>}
    >
      {isLoading && <Skeleton class="h-32 w-full" />}
      {!isLoading && data?.conversions.length === 0 && (
        <div class="text-sm text-fg-muted text-center py-6 inline-flex items-center gap-2 justify-center w-full">
          <FileText size={16} /> Nenhuma conversão registrada.
        </div>
      )}
      {!isLoading && data && data.conversions.length > 0 && (
        <div class="overflow-x-auto -mx-4">
          <table class="w-full text-sm">
            <thead class="text-fg-subtle text-[0.6875rem] uppercase tracking-wider border-b border-border">
              <tr>
                <th class="text-left px-4 py-2 font-medium">Lead</th>
                <th class="text-left px-4 py-2 font-medium">Contato</th>
                <th class="text-left px-4 py-2 font-medium">Origem</th>
                <th class="text-left px-4 py-2 font-medium">Quando</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-border">
              {data.conversions.map((c) => <ConversionRow key={c.id} c={c} />)}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  )
}

function ConversionRow({ c }: { c: PageConversion }) {
  const fd = c.data ?? {}
  const nome = c.lead?.nome ?? (fd.nome as string | undefined) ?? '—'
  const empresa = c.lead?.empresa ?? (fd.empresa as string | undefined)
  const contact = c.lead?.email ?? c.lead?.whatsapp ?? (fd.email as string | undefined) ?? (fd.whatsapp as string | undefined) ?? ''
  const utm = [c.utmSource, c.utmMedium, c.utmCampaign].filter(Boolean).join(' / ')

  return (
    <tr class="hover:bg-surface-3">
      <td class="px-4 py-2">
        <div class="text-fg truncate">{nome}</div>
        {empresa && <div class="text-xs text-fg-subtle truncate">{empresa}</div>}
      </td>
      <td class="px-4 py-2 text-xs text-fg-muted truncate max-w-48">{contact || '—'}</td>
      <td class="px-4 py-2 text-xs text-fg-muted truncate max-w-48">{utm || '(direto)'}</td>
      <td class="px-4 py-2 text-xs text-fg-subtle whitespace-nowrap">{formatDateTime(c.createdAt)}</td>
    </tr>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div class="text-sm text-fg tabular-nums font-medium">{value}</div>
      <div class="text-[0.625rem] text-fg-subtle uppercase">{label}</div>
    </div>
  )
}

type FormTab = 'geral' | 'seo' | 'tracking' | 'code'

const FORM_TABS: { id: FormTab; label: string; icon: typeof Globe }[] = [
  { id: 'geral',    label: 'Geral',           icon: SettingsIcon },
  { id: 'seo',      label: 'SEO & Mídia',     icon: Search },
  { id: 'tracking', label: 'Tracking',        icon: BarChart3 },
  { id: 'code',     label: 'Código',          icon: Code },
]

function PageFormModal({ page, onClose }: { page: LandingPageItem | null; onClose: () => void }) {
  const isEdit = !!page
  const detail = usePage(isEdit ? page.id : null)
  const [tab, setTab] = useState<FormTab>('geral')

  const [title, setTitle] = useState(page?.title ?? '')
  const [slug, setSlug] = useState(page?.slug ?? '')
  const [metaTitle, setMetaTitle] = useState('')
  const [metaDescription, setMetaDescription] = useState('')
  const [ogImage, setOgImage] = useState('')
  const [favicon, setFavicon] = useState('')
  const [trackingEnabled, setTrackingEnabled] = useState(true)
  const [conversionEvent, setConversionEvent] = useState('')
  const [customHead, setCustomHead] = useState('')
  const [customCss, setCustomCss] = useState('')
  const [loaded, setLoaded] = useState(!isEdit) // criar não precisa esperar
  const create = useCreatePage()
  const update = useUpdatePage()
  const loading = create.isPending || update.isPending

  // Sincroniza apenas no primeiro carregamento. Refetches após salvar (que
  // invalidam ['page', id]) não devem sobrescrever edits do usuário.
  useEffect(() => {
    if (loaded || !detail.data) return
    setTitle(detail.data.title)
    setSlug(detail.data.slug)
    setMetaTitle(detail.data.metaTitle ?? '')
    setMetaDescription(detail.data.metaDescription ?? '')
    setOgImage(detail.data.ogImage ?? '')
    setFavicon(detail.data.favicon ?? '')
    setTrackingEnabled(detail.data.trackingEnabled)
    setConversionEvent(detail.data.conversionEvent ?? '')
    setCustomHead(detail.data.customHead ?? '')
    setCustomCss(detail.data.customCss ?? '')
    setLoaded(true)
  }, [detail.data, loaded])

  function handleSubmit() {
    if (!loaded) return // proteção: não salvar antes de carregar
    if (!title.trim()) { toast('Título obrigatório', 'danger'); return }
    const payload = {
      title: title.trim(),
      slug: slug || undefined,
      metaTitle: metaTitle || null,
      metaDescription: metaDescription || null,
      ogImage: ogImage || null,
      favicon: favicon || null,
      trackingEnabled,
      conversionEvent: conversionEvent || null,
      customHead: customHead || null,
      customCss: customCss || null,
    }
    if (isEdit) {
      update.mutate({ id: page.id, ...payload }, {
        onSuccess: () => { toast('Página atualizada', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    } else {
      create.mutate(payload, {
        onSuccess: () => { toast('Página criada (rascunho). Use os botões "Aparência" e "Editar blocos" para configurar.', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    }
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={isEdit ? `Configurar "${page.title}"` : 'Nova landing page'}
      description={isEdit
        ? 'Geral, SEO & Mídia, Tracking e Código personalizado. Para Aparência e Blocos use os editores próprios.'
        : 'Crie a página em rascunho. Em seguida configure Aparência (logo, cores, fontes…) e Blocos.'
      }
      size="xl"
      unconstrained={isEdit}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={loading || !loaded}>
            {loading ? 'Salvando…' : !loaded ? 'Carregando…' : 'Salvar'}
          </Button>
        </>
      }
    >
      {!loaded ? (
        <div class="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} class="h-10 w-full" />)}
        </div>
      ) : !isEdit ? (
        <div class="space-y-3">
          <Input label="Título" value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} placeholder="Ex.: Vestibular 2027/1" />
          <div class="rounded-md border border-info/40 bg-info/10 p-3 text-xs text-fg-muted">
            Depois de criar, você pode configurar SEO, Mídia, Tracking, Aparência completa (logo, cores, fontes, botões) e os Blocos.
          </div>
        </div>
      ) : (
        <div class="space-y-4">
          <div class="flex items-center gap-0.5 border-b border-border overflow-x-auto -mx-4 px-4">
            {FORM_TABS.map((t) => {
              const Icon = t.icon
              const active = tab === t.id
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  class={cn(
                    'inline-flex items-center gap-1.5 h-9 px-3 -mb-px text-xs font-medium border-b-2 whitespace-nowrap',
                    active ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:text-fg',
                  )}
                  aria-pressed={active}
                >
                  <Icon size={12} /> {t.label}
                </button>
              )
            })}
          </div>

          {tab === 'geral' && (
            <div class="space-y-3">
              <Input
                label="Título"
                value={title}
                onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
              />
              <Input
                label="Slug (URL)"
                value={slug}
                onInput={(e) => setSlug((e.target as HTMLInputElement).value)}
                hint={`Endereço final: /p/${slug || '...'}`}
              />
            </div>
          )}

          {tab === 'seo' && (
            <div class="space-y-4">
              <div class="space-y-3">
                <h4 class="text-xs font-semibold uppercase tracking-wider text-fg-muted">SEO</h4>
                <Input
                  label="Meta title"
                  value={metaTitle}
                  onInput={(e) => setMetaTitle((e.target as HTMLInputElement).value)}
                  placeholder="(usa o título se vazio)"
                  hint="Aparece na aba do navegador e no Google. Limite ~60 caracteres."
                />
                <Textarea
                  label="Meta description"
                  value={metaDescription}
                  onInput={(e) => setMetaDescription((e.target as HTMLTextAreaElement).value)}
                  rows={3}
                  hint="Resumo que aparece nos resultados do Google. ~160 caracteres."
                />
              </div>
              <div class="grid gap-3 sm:grid-cols-2">
                <div>
                  <h4 class="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-muted inline-flex items-center gap-1">
                    <ImageIcon size={12} /> Imagem social (Open Graph)
                  </h4>
                  <PageImageUploader
                    pageId={page.id}
                    slot="og"
                    label="Open Graph"
                    value={ogImage}
                    onChange={setOgImage}
                    hint="Aparece quando alguém compartilha o link no WhatsApp, Facebook, etc. 1200×630px é o ideal."
                    previewHeight="lg"
                  />
                </div>
                <div>
                  <h4 class="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-muted inline-flex items-center gap-1">
                    <ImageIcon size={12} /> Favicon
                  </h4>
                  <PageImageUploader
                    pageId={page.id}
                    slot="favicon"
                    label="Favicon"
                    value={favicon}
                    onChange={setFavicon}
                    hint="Ícone na aba do navegador. PNG, SVG, ICO. 32×32 ou 64×64 é ideal."
                    allowVector
                    previewHeight="sm"
                  />
                </div>
              </div>
            </div>
          )}

          {tab === 'tracking' && (
            <div class="space-y-3">
              <label class="flex items-start gap-2 cursor-pointer p-3 rounded-md border border-border hover:bg-surface-3 transition-colors">
                <input
                  type="checkbox"
                  checked={trackingEnabled}
                  onChange={(e) => setTrackingEnabled((e.target as HTMLInputElement).checked)}
                  class="mt-0.5"
                />
                <div class="flex-1">
                  <div class="text-sm text-fg">Tracking de visitantes habilitado</div>
                  <div class="text-xs text-fg-subtle mt-0.5">
                    Conta visitas, sessões, eventos e atribui leads ao tráfego que gerou. Desligue só se a página for puramente institucional.
                  </div>
                </div>
              </label>
              <Input
                label="Evento de conversão custom (opcional)"
                value={conversionEvent}
                onInput={(e) => setConversionEvent((e.target as HTMLInputElement).value)}
                placeholder="lead_qualificado, inscricao_premium, …"
                hint="Quando vazio, usa o evento padrão da plataforma. Útil pra distinguir conversões em dashboards."
              />
              <div class="rounded-md border border-info/40 bg-info/10 p-3 text-xs text-fg-muted">
                Para Pixel do Meta, GA4 ou outras plataformas, use a aba <strong>Código</strong> (HEAD personalizado) ou a aba
                <strong> CSS / HEAD</strong> dentro do painel <strong>Aparência</strong>.
              </div>
            </div>
          )}

          {tab === 'code' && (
            <div class="space-y-3">
              <Textarea
                label="HEAD personalizado (HTML)"
                value={customHead}
                onInput={(e) => setCustomHead((e.target as HTMLTextAreaElement).value)}
                rows={6}
                placeholder={'<!-- Pixel do Meta -->\n<script>...</script>\n<!-- GA4 -->\n<script async src="https://www.googletagmanager.com/gtag/js?id=G-..."></script>'}
                hint="Inserido no <head>. Útil para pixels, scripts de tracking, meta tags adicionais."
              />
              <Textarea
                label="CSS personalizado"
                value={customCss}
                onInput={(e) => setCustomCss((e.target as HTMLTextAreaElement).value)}
                rows={6}
                placeholder=".lp-section { padding: 80px 0; } .btn--primary:hover { transform: scale(1.05); }"
                hint="Aplicado depois do tema — sobrescreve qualquer regra padrão."
              />
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

function DeletePageDialog({ page, onClose }: { page: LandingPageItem; onClose: () => void }) {
  const del = useDeletePage()
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Excluir "${page.title}"`}
      description="A página vai para a lixeira e pode ser restaurada."
      destructive
      confirmLabel="Excluir"
      loading={del.isPending}
      onConfirm={() => del.mutate(page.id, {
        onSuccess: () => { toast('Página movida para a lixeira', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })}
    />
  )
}
