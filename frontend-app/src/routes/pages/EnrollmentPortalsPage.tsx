import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import { School, Plus, Pencil, Trash2, Copy, ExternalLink, MoreHorizontal, Code, Users as UsersIcon, CheckCircle2, AlertCircle, Loader2, HelpCircle, Search, Check } from '@/components/ui/icon-set'
import { HowItWorksModal } from '@/components/ui/HowItWorksModal'
import {
  useEnrollmentPortals,
  useCreateEnrollmentPortal,
  useUpdateEnrollmentPortal,
  useDeleteEnrollmentPortal,
  useDuplicatePortal,
  checkPortalSlug,
  type CheckSlugResult,
  type EnrollmentPortal,
  type EnrollmentPortalInput,
  type PortalFormMode,
} from '@/hooks/useEnrollmentPortals'
import { useEducationalUnits, useSelectionProcesses } from '@/hooks/useEducational'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Input, Textarea, Select, Switch } from '@/components/ui/Input'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { toast } from '@/lib/toast'
import { ColorPicker } from '@/components/ui/ColorPicker'
import { formatRelative } from '@/lib/format'
import { ICONES_PORTAL, CORES_PORTAL, SeloDoPortal, PolosDoPortal, identidadeDo, tinta } from '@/lib/identidadePortal'
import type { IdentidadePainel } from '@/hooks/useEnrollmentPortals'
import { Pode } from '@/components/auth/Pode'

export function EnrollmentPortalsPage() {
  const { data, isLoading } = useEnrollmentPortals()
  const { data: unitsData, isLoading: loadingUnits } = useEducationalUnits()
  const { data: processesData } = useSelectionProcesses({ status: 'active' })
  const [, navigate] = useLocation()
  const [editing, setEditing] = useState<EnrollmentPortal | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<EnrollmentPortal | null>(null)
  const [showHowItWorks, setShowHowItWorks] = useState(false)
  const duplicate = useDuplicatePortal()

  const portals = data?.portals ?? []
  const units = unitsData?.units ?? []
  const processes = processesData?.processes ?? []
  const noUnits = !loadingUnits && units.length === 0

  function handleDuplicate(p: EnrollmentPortal) {
    duplicate.mutate(p.id, {
      onSuccess: (r) => {
        toast(`Portal duplicado: ${r.portal.nome}`, 'success')
        navigate(`/enrollment-portals/${r.portal.id}`)
      },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <Page
      title="Portal de Matrículas"
      description="Páginas públicas onde candidatos se inscrevem e enviam documentos para os processos seletivos."
      actions={
        <div class="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setShowHowItWorks(true)}>
            <HelpCircle size={14} /> Como funciona?
          </Button>
          <Pode tela="enrollment_portals" acao="create"><Button variant="primary" size="sm" onClick={() => setCreating(true)} disabled={noUnits}>
            <Plus size={14} /> Novo portal
          </Button></Pode>
        </div>
      }
    >
      {noUnits && (
        <Card>
          <div class="text-sm text-fg-muted">
            Cadastre uma <a href="/app/educational/units" class="text-accent hover:underline">unidade</a> antes
            de criar um portal.
          </div>
        </Card>
      )}

      {isLoading && (
        <div class="grid gap-2 grid-cols-1 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} class="h-28 w-full" />)}
        </div>
      )}

      {!isLoading && !noUnits && portals.length === 0 && (
        <EmptyState
          icon={<School size={24} />}
          title="Nenhum portal de matrículas"
          description="Crie um portal para gerar uma página pública e começar a receber inscrições."
          action={
            <Pode tela="enrollment_portals" acao="create"><Button size="sm" variant="primary" onClick={() => setCreating(true)}>
              <Plus size={14} /> Criar primeiro portal
            </Button></Pode>
          }
        />
      )}

      {!isLoading && portals.length > 0 && (
        <ListaDePortais
          portals={portals}
          renderCard={(p) => (
            <PortalCard
              key={p.id}
              portal={p}
              onOpen={() => navigate(`/enrollment-portals/${p.id}`)}
              onEdit={() => setEditing(p)}
              onDelete={() => setDeleting(p)}
              onDuplicate={() => handleDuplicate(p)}
            />
          )}
        />
      )}

      {(creating || editing) && (
        <PortalFormModal
          portal={editing}
          units={units}
          processes={processes}
          existingPortals={portals}
          onClose={() => { setCreating(false); setEditing(null) }}
        />
      )}

      {deleting && (
        <DeletePortalDialog
          portal={deleting}
          onClose={() => setDeleting(null)}
        />
      )}

      <HowItWorksModal
        open={showHowItWorks}
        onClose={() => setShowHowItWorks(false)}
        title="Como funciona o Portal de Matrículas?"
        problem={<>
          Pra captar candidatos pra cursos/turmas, você precisa de uma página que <strong>colete dados,
          mostre as ofertas, receba documentos e cobrança</strong>. O Portal de Matrículas faz tudo isso
          — sem precisar desenvolver site, com URL pública, identidade visual personalizável e
          integração direta com o funil de matrículas.
        </>}
        steps={[
          {
            title: '🏗️ Crie um portal',
            body: <>Cada portal tem um <strong>slug</strong> (URL pública: {typeof window !== 'undefined' ? window.location.host : ''}/p/seu-portal) e uma <strong>unidade</strong> associada. Pode ter um portal por curso, por unidade ou um geral — depende da sua operação.</>,
          },
          {
            title: '🧱 Modo do formulário',
            body: <>Use os <strong>campos padrão</strong> (nome, e-mail, CPF…) ou abra o construtor visual e monte os blocos: identificação, escolha de oferta, foto, documentos. Modo livre = controle total.</>,
          },
          {
            title: '🎓 Vincule processos seletivos',
            body: <>Cada portal aceita um ou vários <strong>processos seletivos</strong> (Vestibular 2026.1, Transferência, ENEM). O candidato escolhe e o sistema aplica regras (provas, descontos, vagas).</>,
          },
          {
            title: '🎨 Branding e SEO',
            body: <>Aba <strong>Aparência</strong>: logo, cores, fonte, banner topo. Aba <strong>SEO</strong>: título Google, descrição, imagem de compartilhamento. Tudo configurável sem mexer em código.</>,
          },
          {
            title: '💳 Provedor de pagamento + CTA pós-envio',
            body: <>Escolha qual <strong>conexão de pagamento</strong> usar (de Pagamentos). Defina o que acontece depois que candidato envia: agradecimento simples, redirecionamento, exibir boleto/PIX, integração com Make.com.</>,
          },
        ]}
        tip={{
          tone: 'info',
          title: '💡 Acompanhe inscrições',
          body: <>Cada portal tem aba <strong>Inscrições</strong> com tudo que entrou: candidato, status, documentos, pagamento, etapa do funil. Use <strong>Embed</strong> pra colar o portal em iframe no site da escola.</>,
        }}
      />
    </Page>
  )
}

// Busca, filtro por empresa e situação; com 2+ empresas, agrupa por empresa.
// Ordem: a "Ordem na lista" da identidade, depois o nome.
function ListaDePortais({ portals, renderCard }: {
  portals: EnrollmentPortal[]
  renderCard: (p: EnrollmentPortal) => preact.ComponentChildren
}) {
  const [busca, setBusca] = useState('')
  const [empresa, setEmpresa] = useState<string>('todas')
  const [situacao, setSituacao] = useState<'todos' | 'ativos' | 'inativos'>('todos')

  const ordenados = useMemo(() => [...portals].sort((a, b) => {
    const oa = identidadeDo(a).ordem ?? 1000, ob = identidadeDo(b).ordem ?? 1000
    return oa - ob || a.nome.localeCompare(b.nome, 'pt-BR')
  }), [portals])
  const empresas = useMemo(() => {
    const m = new Map<string, { nome: string; cor: string; total: number }>()
    for (const p of ordenados) {
      const id = identidadeDo(p)
      const k = id.empresa ?? ''
      const e = m.get(k) ?? { nome: id.empresa ?? 'Sem empresa', cor: id.cor, total: 0 }
      e.total++; m.set(k, e)
    }
    return [...m.entries()].sort((a, b) => (a[0] === '' ? 1 : b[0] === '' ? -1 : a[1].nome.localeCompare(b[1].nome, 'pt-BR')))
  }, [ordenados])
  const q = busca.trim().toLowerCase()
  const visiveis = ordenados.filter((p) => {
    const id = identidadeDo(p)
    if (empresa !== 'todas' && (id.empresa ?? '') !== empresa) return false
    if (situacao === 'ativos' && !p.active) return false
    if (situacao === 'inativos' && p.active) return false
    if (!q) return true
    return [p.nome, p.slug, p.codePrefix, id.empresa, id.descricao, p.unit?.nome, p.team?.name].some((v) => (v ?? '').toLowerCase().includes(q))
  })
  const agrupar = empresas.length > 1 && empresa === 'todas'
  const grupos = agrupar
    ? empresas.map(([k, e]) => ({ k, e, itens: visiveis.filter((p) => (identidadeDo(p).empresa ?? '') === k) })).filter((g) => g.itens.length)
    : [{ k: '*', e: null, itens: visiveis }]
  const ativos = portals.filter((p) => p.active).length

  const chip = (ativo: boolean) => cnChip(ativo)
  return (
    <div class="space-y-4">
      <div class="flex flex-col lg:flex-row lg:items-center gap-2">
        <label class="relative flex-1 min-w-0">
          <Search size={14} class="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted pointer-events-none" />
          <input
            type="search"
            value={busca}
            onInput={(e) => setBusca((e.target as HTMLInputElement).value)}
            placeholder="Buscar por nome, empresa, código, equipe…"
            class="w-full h-9 pl-8 pr-3 rounded-md border border-border bg-surface-inset text-sm text-fg placeholder:text-fg-muted focus:outline-none focus:border-accent"
          />
        </label>
        <div class="flex items-center gap-1 rounded-md border border-border p-0.5 self-start lg:self-auto" role="group" aria-label="Situação">
          {([['todos', `Todos ${portals.length}`], ['ativos', `Ativos ${ativos}`], ['inativos', `Inativos ${portals.length - ativos}`]] as const).map(([k, r]) => (
            <button key={k} type="button" aria-pressed={situacao === k} onClick={() => setSituacao(k)}
              class={`h-7 px-2.5 rounded text-xs tabular-nums ${situacao === k ? 'bg-surface-3 text-fg font-medium' : 'text-fg-muted hover:text-fg'}`}>{r}</button>
          ))}
        </div>
      </div>
      {empresas.length > 1 && (
        <div class="flex flex-wrap gap-1.5" role="group" aria-label="Empresa">
          <button type="button" class={chip(empresa === 'todas')} aria-pressed={empresa === 'todas'} onClick={() => setEmpresa('todas')}>
            Todas as empresas
          </button>
          {empresas.map(([k, e]) => (
            <button key={k || '-'} type="button" class={chip(empresa === k)} aria-pressed={empresa === k} onClick={() => setEmpresa(k)}>
              <span class="size-2 rounded-full" style={{ background: k ? e.cor : 'var(--color-fg-muted, #888)' }} />
              {e.nome} <span class="text-fg-muted tabular-nums">{e.total}</span>
            </button>
          ))}
        </div>
      )}
      {visiveis.length === 0 ? (
        <Card><div class="text-xs text-fg-muted italic text-center py-8">Nenhum portal com esses filtros.</div></Card>
      ) : grupos.map((g) => (
        <section key={g.k} class="space-y-2">
          {g.e && (
            <div class="flex items-center gap-2 pt-1">
              <span class="h-4 w-1 rounded-full" style={{ background: g.k ? g.e.cor : 'var(--color-border, #888)' }} />
              <h2 class="text-xs font-semibold uppercase tracking-wider text-fg">{g.e.nome}</h2>
              <span class="text-2xs text-fg-muted tabular-nums">{g.itens.length} portal(is)</span>
            </div>
          )}
          <div class="grid gap-3 grid-cols-1 lg:grid-cols-2">{g.itens.map(renderCard)}</div>
        </section>
      ))}
    </div>
  )
}

function cnChip(ativo: boolean) {
  return `inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border text-xs ${ativo ? 'border-accent bg-accent/10 text-fg font-medium' : 'border-border text-fg-muted hover:text-fg hover:border-border-strong'}`
}

function PortalCard({
  portal: p, onOpen, onEdit, onDelete, onDuplicate,
}: {
  portal: EnrollmentPortal
  onOpen: () => void
  onEdit: () => void
  onDelete: () => void
  onDuplicate: () => void
}) {
  const formModeLabel = p.formMode === 'interest' ? 'Captura de interesse' : 'Inscrição completa'
  const publicUrl = p.customDomain
    ? `https://${p.customDomain}/portal/${p.slug}`
    : `${window.location.origin}/portal/${p.slug}`
  const id = identidadeDo(p)
  const r = p.resumo
  const copiar = (e: Event) => {
    e.stopPropagation()
    void navigator.clipboard.writeText(publicUrl).then(() => toast('URL copiada', 'success'))
  }

  return (
    <div
      class={`relative rounded-lg border border-border bg-surface-2 overflow-hidden transition-shadow hover:shadow-md ${p.active ? '' : 'opacity-75'}`}
      style={{ borderLeft: `3px solid ${id.cor}` }}
    >
      <div class="p-4 flex items-start gap-3">
        <SeloDoPortal icone={id.icone} cor={id.cor} tamanho={44} />
        <button type="button" class="min-w-0 flex-1 text-left" onClick={onOpen}>
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-sm font-semibold text-fg truncate hover:text-accent">{p.nome}</span>
            <span
              class={`inline-flex items-center gap-1 rounded-full px-1.5 py-px text-3xs font-medium uppercase tracking-wide ${p.active ? 'bg-success/15 text-success' : 'bg-surface-3 text-fg-muted'}`}
            >
              <span class={`size-1.5 rounded-full ${p.active ? 'bg-success' : 'bg-fg-muted'}`} />
              {p.active ? 'Ativo' : 'Inativo'}
            </span>
          </div>
          <div class="mt-1 flex items-center gap-1.5 flex-wrap text-2xs">
            {id.empresa && (
              <span class="rounded px-1.5 py-px font-medium text-fg ring-1 ring-inset" style={{ background: tinta(id.cor, 18), ["--tw-ring-color" as any]: tinta(id.cor, 40) }}>{id.empresa}</span>
            )}
            <code class="rounded bg-surface-3 px-1.5 py-px text-fg-muted font-mono">{p.codePrefix}</code>
            <span class="text-fg-muted">{formModeLabel}</span>
            {p.team && <span class="text-fg-muted">· {p.team.name}</span>}
          </div>
          {id.descricao && <div class="mt-1.5 text-xs text-fg-muted line-clamp-2">{id.descricao}</div>}
          {id.mostrarPolo && (p.polos?.length ?? 0) > 0 && <div class="mt-1.5"><PolosDoPortal polos={p.polos!.map((x) => x.nome)} /></div>}
        </button>
        <PortalActionsMenu portal={p} publicUrl={publicUrl} onEdit={onEdit} onDelete={onDelete} onDuplicate={onDuplicate} onOpen={onOpen} />
      </div>
      <div class="grid grid-cols-3 border-t border-border divide-x divide-border">
        <Numero rotulo="Inscrições" valor={p._count?.registrations ?? 0} />
        <Numero rotulo="Últimos 30 dias" valor={r?.ultimos30 ?? 0} />
        <Numero rotulo="Pagas" valor={r?.pagas ?? 0} />
      </div>
      <div class="flex items-center gap-2 border-t border-border px-4 py-2 text-2xs text-fg-muted">
        <span class="truncate flex-1 font-mono" title={publicUrl}>/portal/{p.slug}</span>
        <span class="shrink-0 hidden sm:inline">{r?.ultimaInscricao ? `última inscrição ${formatRelative(r.ultimaInscricao)}` : 'sem inscrições'}</span>
        <button type="button" onClick={copiar} class="shrink-0 size-6 grid place-items-center rounded hover:bg-surface-3 hover:text-fg" aria-label="Copiar URL pública" title="Copiar URL pública">
          <Copy size={12} />
        </button>
        <a href={publicUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} class="shrink-0 size-6 grid place-items-center rounded hover:bg-surface-3 hover:text-fg" aria-label="Abrir portal público" title="Abrir portal público">
          <ExternalLink size={12} />
        </a>
      </div>
    </div>
  )
}

function Numero({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <div class="px-4 py-2.5">
      <div class="text-base font-semibold text-fg tabular-nums leading-none">{valor.toLocaleString('pt-BR')}</div>
      <div class="mt-1 text-3xs uppercase tracking-wide text-fg-muted">{rotulo}</div>
    </div>
  )
}

function PortalActionsMenu({
  portal: p, publicUrl, onEdit, onDelete, onDuplicate, onOpen,
}: {
  portal: EnrollmentPortal
  publicUrl: string
  onEdit: () => void
  onDelete: () => void
  onDuplicate: () => void
  onOpen: () => void
}) {
  const [open, setOpen] = useState(false)
  const isInterest = p.formMode === 'interest'
  const embedSnippet = `<iframe src="${publicUrl}?embed=1" style="width:100%;height:680px;border:0" allowtransparency="true"></iframe>`

  useEffect(() => {
    if (!open) return
    function close() { setOpen(false) }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [open])

  function copy(text: string, label: string) {
    void navigator.clipboard.writeText(text).then(() => toast(`${label} copiado`, 'success'))
  }

  return (
    <div class="relative shrink-0" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        class="size-8 rounded grid place-items-center text-fg-muted hover:text-fg hover:bg-surface-3 border border-border"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}
        aria-label="Ações"
      >
        <MoreHorizontal size={14} />
      </button>
      {open && (
        <div class="absolute right-0 top-full mt-1 w-56 rounded-md border border-border bg-surface-2 shadow-lg py-1 z-20">
          <a href={publicUrl} target="_blank" rel="noopener noreferrer" class="w-full text-left px-3 py-1.5 text-xs text-fg hover:bg-surface-3 inline-flex items-center gap-2">
            <ExternalLink size={12} /> Abrir portal público
          </a>
          <button type="button" class="w-full text-left px-3 py-1.5 text-xs text-fg hover:bg-surface-3 inline-flex items-center gap-2" onClick={() => { setOpen(false); copy(publicUrl, 'URL') }}>
            <Copy size={12} /> Copiar URL pública
          </button>
          {isInterest && (
            <button type="button" class="w-full text-left px-3 py-1.5 text-xs text-fg hover:bg-surface-3 inline-flex items-center gap-2" onClick={() => { setOpen(false); copy(embedSnippet, 'Embed iframe') }}>
              <Code size={12} /> Copiar embed (iframe)
            </button>
          )}
          <button type="button" class="w-full text-left px-3 py-1.5 text-xs text-fg hover:bg-surface-3 inline-flex items-center gap-2" onClick={() => { setOpen(false); onOpen() }}>
            <UsersIcon size={12} /> Ver inscrições ({p._count?.registrations ?? 0})
          </button>
          <div class="my-1 h-px bg-border" />
          <Pode tela="enrollment_portals" acao="edit"><button type="button" class="w-full text-left px-3 py-1.5 text-xs text-fg hover:bg-surface-3 inline-flex items-center gap-2" onClick={() => { setOpen(false); onEdit() }}>
            <Pencil size={12} /> Editar portal
          </button></Pode>
          <Pode tela="enrollment_portals" acao="create"><button type="button" class="w-full text-left px-3 py-1.5 text-xs text-fg hover:bg-surface-3 inline-flex items-center gap-2" onClick={() => { setOpen(false); onDuplicate() }}>
            <Copy size={12} /> Duplicar
          </button></Pode>
          <div class="my-1 h-px bg-border" />
          <Pode tela="enrollment_portals" acao="delete"><button type="button" class="w-full text-left px-3 py-1.5 text-xs text-danger hover:bg-surface-3 inline-flex items-center gap-2" onClick={() => { setOpen(false); onDelete() }}>
            <Trash2 size={12} /> Excluir
          </button></Pode>
        </div>
      )}
    </div>
  )
}

function PortalFormModal({
  portal, units, processes, existingPortals, onClose,
}: {
  portal: EnrollmentPortal | null
  units: { id: number; nome: string }[]
  processes: { id: number; nome: string; periodoLetivo?: string | null }[]
  existingPortals: EnrollmentPortal[]
  onClose: () => void
}) {
  const isEdit = !!portal
  const [nome, setNome] = useState(portal?.nome ?? '')
  const [slug, setSlug] = useState(portal?.slug ?? '')
  const [unitId, setUnitId] = useState(portal?.unitId ?? units[0]?.id ?? 0)
  // Portais antigos ficaram gravados como 'multi_step': é inscrição completa.
  const [formMode, setFormMode] = useState<PortalFormMode>(portal?.formMode === 'interest' ? 'interest' : 'full')
  const [continuationPortalId, setContinuationPortalId] = useState<number | ''>(
    portal?.continuationPortalId ?? '',
  )
  const [selectionProcessIds, setSelectionProcessIds] = useState<number[]>(
    portal?.selectionProcessIds ?? [],
  )
  const [codePrefix, setCodePrefix] = useState(portal?.codePrefix ?? 'MAT')
  const [magicLinkTtlDays, setMagicLinkTtlDays] = useState(String(portal?.magicLinkTtlDays ?? 30))
  const [alwaysCreateNew, setAlwaysCreateNew] = useState(portal?.alwaysCreateNew ?? false)
  const [active, setActive] = useState(portal?.active ?? true)
  const [ctaBehavior, setCtaBehavior] = useState<'message' | 'redirect'>(portal?.ctaBehavior ?? 'message')
  const [ctaMessage, setCtaMessage] = useState(portal?.ctaMessage ?? '')
  const [ctaTarget, setCtaTarget] = useState(portal?.ctaTarget ?? '')
  const [requirePayment, setRequirePayment] = useState(portal?.requirePayment ?? false)
  const [metaTitle, setMetaTitle] = useState(portal?.metaTitle ?? '')
  const [metaDescription, setMetaDescription] = useState(portal?.metaDescription ?? '')
  const [identidade, setIdentidade] = useState<IdentidadePainel>({
    icone: portal?.identidadePainel?.icone ?? null,
    cor: portal?.identidadePainel?.cor ?? null,
    empresa: portal?.identidadePainel?.empresa ?? null,
    descricao: portal?.identidadePainel?.descricao ?? null,
    ordem: portal?.identidadePainel?.ordem ?? null,
    mostrarPolo: portal?.identidadePainel?.mostrarPolo === true,
  })

  const create = useCreateEnrollmentPortal()
  const update = useUpdateEnrollmentPortal()
  const loading = create.isPending || update.isPending

  // Tudo que não é captura de interesse é inscrição completa (inclui o legado 'multi_step').
  const fullPortals = existingPortals.filter((p) => p.formMode !== 'interest' && p.id !== portal?.id)

  // ── Validação de slug em tempo real ──
  const [slugCheck, setSlugCheck] = useState<{ status: 'idle' | 'checking' | 'done'; result: CheckSlugResult | null }>({ status: 'idle', result: null })
  const slugReqRef = useRef(0)
  useEffect(() => {
    const trimmed = slug.trim()
    if (!trimmed) {
      setSlugCheck({ status: 'idle', result: null })
      return
    }
    setSlugCheck((s) => ({ status: 'checking', result: s.result }))
    const reqId = ++slugReqRef.current
    const timer = setTimeout(() => {
      checkPortalSlug(trimmed, portal?.id ?? null)
        .then((result) => {
          if (reqId !== slugReqRef.current) return
          setSlugCheck({ status: 'done', result })
        })
        .catch(() => {
          if (reqId !== slugReqRef.current) return
          setSlugCheck({ status: 'done', result: null })
        })
    }, 350)
    return () => clearTimeout(timer)
  }, [slug, portal?.id])

  function applySuggestedSlug() {
    if (slugCheck.result?.suggestion) setSlug(slugCheck.result.suggestion)
  }

  function toggleProcess(id: number) {
    setSelectionProcessIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  function handleSubmit() {
    if (!nome.trim()) { toast('Nome é obrigatório', 'danger'); return }
    if (!unitId) { toast('Selecione uma unidade', 'danger'); return }
    if (formMode === 'interest' && !continuationPortalId) {
      toast('Portal de interesse precisa de um portal de continuação', 'danger'); return
    }
    if (formMode === 'full' && selectionProcessIds.length === 0) {
      toast('Vincule ao menos um processo seletivo', 'danger'); return
    }
    if (slug.trim() && slugCheck.status === 'done' && slugCheck.result && !slugCheck.result.available) {
      toast(slugCheck.result.reason === 'taken' ? 'Slug já está em uso' : 'Slug inválido', 'danger')
      return
    }

    const payload: EnrollmentPortalInput = {
      nome: nome.trim(),
      unitId,
      slug: slug.trim() || null,
      formMode,
      continuationPortalId: formMode === 'interest' && typeof continuationPortalId === 'number'
        ? continuationPortalId
        : null,
      selectionProcessIds,
      codePrefix: codePrefix.trim() || 'MAT',
      magicLinkTtlDays: parseInt(magicLinkTtlDays) || 30,
      alwaysCreateNew,
      active,
      ctaBehavior,
      ctaMessage: ctaBehavior === 'message' ? (ctaMessage.trim() || null) : null,
      ctaTarget: ctaBehavior === 'redirect' ? (ctaTarget.trim() || null) : null,
      requirePayment,
      metaTitle: metaTitle.trim() || null,
      metaDescription: metaDescription.trim() || null,
      identidadePainel: identidade,
    }

    if (isEdit) {
      update.mutate({ id: portal.id, ...payload }, {
        onSuccess: () => { toast('Portal atualizado', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    } else {
      create.mutate(payload, {
        onSuccess: () => { toast('Portal criado', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    }
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={isEdit ? 'Editar portal' : 'Novo portal de matrículas'}
      size="xl"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={loading}>
            {loading ? 'Salvando…' : 'Salvar'}
          </Button>
        </>
      }
    >
      <div class="space-y-5">
        <Section title="Identificação">
          <div class="grid grid-cols-1 sm:grid-cols-[2fr_1fr] gap-3">
            <Input
              label="Nome interno"
              value={nome}
              onInput={(e) => setNome((e.target as HTMLInputElement).value)}
              placeholder="Ex.: Vestibular 2027/1 - Centro"
            />
            <div>
              <Input
                label="Slug (URL)"
                value={slug ?? ''}
                onInput={(e) => setSlug((e.target as HTMLInputElement).value)}
                placeholder="auto-gerado"
                hint="Ex.: vestibular-2027-1"
              />
              <SlugCheckHint
                slug={slug.trim()}
                status={slugCheck.status}
                result={slugCheck.result}
                onApplySuggestion={applySuggestedSlug}
              />
            </div>
          </div>
          <Select
            label="Unidade"
            value={String(unitId)}
            onChange={(e) => setUnitId(Number((e.target as HTMLSelectElement).value))}
          >
            {units.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
          </Select>
        </Section>

        <IdentidadeNoPainel
          valor={identidade}
          onChange={setIdentidade}
          nome={nome}
          codePrefix={codePrefix}
          corDaMarca={portal?.brandPrimaryColor ?? null}
          polos={(portal?.polos ?? []).map((x) => x.nome)}
          empresas={[...new Set(existingPortals.map((p) => p.identidadePainel?.empresa).filter((x): x is string => !!x))]}
        />

        <Section title="Modo do formulário">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label class={`rounded-md border p-3 cursor-pointer ${formMode === 'full' ? 'border-accent bg-accent/5' : 'border-border'}`}>
              <input
                type="radio"
                class="mr-2"
                checked={formMode === 'full'}
                onChange={() => setFormMode('full')}
              />
              <span class="text-sm font-medium text-fg">Inscrição completa</span>
              <div class="text-xs text-fg-muted mt-1">Formulário completo com escolha de oferta, dados e documentos.</div>
            </label>
            <label class={`rounded-md border p-3 cursor-pointer ${formMode === 'interest' ? 'border-accent bg-accent/5' : 'border-border'}`}>
              <input
                type="radio"
                class="mr-2"
                checked={formMode === 'interest'}
                onChange={() => setFormMode('interest')}
              />
              <span class="text-sm font-medium text-fg">Captura de interesse</span>
              <div class="text-xs text-fg-muted mt-1">Formulário curto que envia magic link p/ continuar em outro portal.</div>
            </label>
          </div>
          {formMode === 'interest' && (
            <Select
              label="Portal de continuação"
              value={continuationPortalId === '' ? '' : String(continuationPortalId)}
              onChange={(e) => {
                const v = (e.target as HTMLSelectElement).value
                setContinuationPortalId(v ? Number(v) : '')
              }}
              hint="O lead recebe link para finalizar a inscrição no portal completo."
            >
              <option value="">{fullPortals.length ? 'Selecione…' : 'Nenhum portal de inscrição completa'}</option>
              {fullPortals.map((p) => <option key={p.id} value={p.id}>{p.nome}{p.active === false ? ' (inativo)' : ''}</option>)}
            </Select>
          )}
          {formMode === 'interest' && fullPortals.length === 0 && (
            <div class="text-xs text-warning mt-2">
              A captura de interesse manda a pessoa terminar a inscrição num portal de inscrição completa, e ainda não há outro portal assim.
              Crie primeiro o portal completo e depois volte aqui.
            </div>
          )}
        </Section>

        {formMode === 'full' && (
          <Section title="Processos seletivos vinculados">
            {processes.length === 0 ? (
              <div class="text-xs text-fg-muted">
                Nenhum processo seletivo ativo. Cadastre em{' '}
                <a href="/app/educational/selection-processes" class="text-accent hover:underline">Processos seletivos</a>.
              </div>
            ) : (
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-48 overflow-y-auto">
                {processes.map((p) => (
                  <label key={p.id} class="flex items-center gap-2 text-sm text-fg-muted px-2 py-1.5 rounded hover:bg-surface-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectionProcessIds.includes(p.id)}
                      onChange={() => toggleProcess(p.id)}
                    />
                    <span class="truncate">{p.nome}{p.periodoLetivo ? ` · ${p.periodoLetivo}` : ''}</span>
                  </label>
                ))}
              </div>
            )}
          </Section>
        )}

        <Section title="Operação">
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Input
              label="Prefixo do código"
              value={codePrefix}
              onInput={(e) => setCodePrefix((e.target as HTMLInputElement).value)}
              hint="Ex.: MAT → MAT-A1B2C3"
            />
            <Input
              label="TTL magic link (dias)"
              type="number"
              value={magicLinkTtlDays}
              onInput={(e) => setMagicLinkTtlDays((e.target as HTMLInputElement).value)}
            />
            <label class="flex items-center gap-2 text-sm text-fg-muted self-end pb-1.5">
              <input
                type="checkbox"
                checked={alwaysCreateNew}
                onChange={(e) => setAlwaysCreateNew((e.target as HTMLInputElement).checked)}
              />
              Sempre criar lead novo
            </label>
          </div>
          <label class="flex items-center gap-2 text-sm text-fg-muted">
            <input type="checkbox" checked={requirePayment} onChange={(e) => setRequirePayment((e.target as HTMLInputElement).checked)} />
            Exigir pagamento da taxa de inscrição
          </label>
          <label class="flex items-center gap-2 text-sm text-fg-muted">
            <input type="checkbox" checked={active} onChange={(e) => setActive((e.target as HTMLInputElement).checked)} />
            Portal ativo
          </label>
        </Section>

        <Section title="Após o envio (CTA)">
          <Select
            label="Comportamento"
            value={ctaBehavior}
            onChange={(e) => setCtaBehavior((e.target as HTMLSelectElement).value as 'message' | 'redirect')}
          >
            <option value="message">Exibir mensagem</option>
            <option value="redirect">Redirecionar URL</option>
          </Select>
          {ctaBehavior === 'message' ? (
            <Textarea
              label="Mensagem de sucesso"
              value={ctaMessage ?? ''}
              onInput={(e) => setCtaMessage((e.target as HTMLTextAreaElement).value)}
              placeholder="Inscrição recebida com sucesso!…"
            />
          ) : (
            <Input
              label="URL de redirecionamento"
              type="url"
              value={ctaTarget ?? ''}
              onInput={(e) => setCtaTarget((e.target as HTMLInputElement).value)}
              placeholder="https://"
            />
          )}
        </Section>

        <Section title="SEO (opcional)">
          <Input
            label="Meta title"
            value={metaTitle ?? ''}
            onInput={(e) => setMetaTitle((e.target as HTMLInputElement).value)}
          />
          <Textarea
            label="Meta description"
            value={metaDescription ?? ''}
            onInput={(e) => setMetaDescription((e.target as HTMLTextAreaElement).value)}
            rows={2}
          />
        </Section>

        {!isEdit && (
          <div class="rounded-md border border-border bg-surface p-3 text-xs text-fg-muted">
            Recursos avançados (branding, payment provider, custom CSS/JS, captcha) podem ser configurados depois pelo admin do portal.
          </div>
        )}
      </div>
    </Modal>
  )
}

// Ícone, cor, empresa, descrição interna e ordem — só a equipe vê. A prévia
// mostra o card como vai ficar na lista de portais.
function IdentidadeNoPainel({ valor, onChange, nome, codePrefix, corDaMarca, empresas, polos }: {
  polos: string[]
  valor: IdentidadePainel
  onChange: (v: IdentidadePainel) => void
  nome: string
  codePrefix: string
  corDaMarca: string | null
  empresas: string[]
}) {
  const pôr = (parcial: Partial<IdentidadePainel>) => onChange({ ...valor, ...parcial })
  const id = identidadeDo({ identidadePainel: valor })
  const hex = /^#[0-9a-f]{6}$/i
  const marca = corDaMarca && hex.test(corDaMarca) ? corDaMarca.toLowerCase() : null
  const corPersonalizada = !!valor.cor && !CORES_PORTAL.some((c) => c.cor === valor.cor)
  return (
    <Section title="Identidade no painel">
      <div class="text-xs text-fg-muted -mt-1">
        Diferencia este portal (e a empresa dele) para a equipe: na lista de portais, no cabeçalho do portal e na inscrição. O candidato não vê.
      </div>

      {/* Prévia */}
      <div class="rounded-lg border border-border bg-surface-2 p-3 flex items-center gap-3" style={{ borderLeft: `3px solid ${id.cor}` }}>
        <SeloDoPortal icone={id.icone} cor={id.cor} tamanho={44} />
        <div class="min-w-0">
          <div class="text-sm font-semibold text-fg truncate">{nome.trim() || 'Nome do portal'}</div>
          <div class="mt-1 flex items-center gap-1.5 flex-wrap text-2xs">
            {id.empresa && <span class="rounded px-1.5 py-px font-medium text-fg ring-1 ring-inset" style={{ background: tinta(id.cor, 18), ["--tw-ring-color" as any]: tinta(id.cor, 40) }}>{id.empresa}</span>}
            <code class="rounded bg-surface-3 px-1.5 py-px text-fg-muted font-mono">{codePrefix || 'MAT'}</code>
          </div>
          {id.descricao && <div class="mt-1 text-xs text-fg-muted truncate">{id.descricao}</div>}
          {id.mostrarPolo && polos.length > 0 && <div class="mt-1"><PolosDoPortal polos={polos} /></div>}
        </div>
        <span class="ml-auto text-3xs uppercase tracking-wide text-fg-muted shrink-0 self-start">Prévia</span>
      </div>

      <div>
        <div class="text-xs font-medium text-fg mb-1.5">Ícone</div>
        <div class="grid grid-cols-8 sm:grid-cols-12 gap-1" role="radiogroup" aria-label="Ícone do portal">
          {ICONES_PORTAL.map(({ chave, rotulo, Icone }) => {
            const sel = id.icone === chave
            return (
              <button
                key={chave}
                type="button"
                role="radio"
                aria-checked={sel}
                aria-label={rotulo}
                title={rotulo}
                onClick={() => pôr({ icone: chave })}
                class={`aspect-square rounded-md grid place-items-center border transition-colors ${sel ? '' : 'border-transparent text-fg-muted hover:bg-surface-3 hover:text-fg'}`}
                style={sel ? { background: tinta(id.cor, 16), color: id.cor, borderColor: tinta(id.cor, 50) } : undefined}
              >
                <Icone size={16} />
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <div class="text-xs font-medium text-fg mb-1.5">Cor</div>
        <div class="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Cor do portal">
          {CORES_PORTAL.map(({ cor, nome: n }) => {
            const sel = valor.cor === cor
            return (
              <button
                key={cor}
                type="button"
                role="radio"
                aria-checked={sel}
                aria-label={n}
                title={n}
                onClick={() => pôr({ cor })}
                class={`size-7 rounded-full grid place-items-center ring-offset-2 ring-offset-surface ${sel ? 'ring-2' : 'hover:scale-110 transition-transform'}`}
                style={{ background: cor, ['--tw-ring-color' as any]: cor }}
              >
                {sel && <Check size={14} class="text-white" />}
              </button>
            )
          })}
          {marca && (
            <button type="button" onClick={() => pôr({ cor: marca })}
              class={`h-7 px-2 rounded-full border text-2xs inline-flex items-center gap-1.5 ${valor.cor === marca ? 'border-accent text-fg' : 'border-border text-fg-muted hover:text-fg'}`}>
              <span class="size-3 rounded-full" style={{ background: marca }} /> Cor da marca do portal
            </button>
          )}
        </div>
        <div class="mt-2 max-w-56">
          <ColorPicker
            label={corPersonalizada ? 'Cor personalizada' : 'Outra cor'}
            value={valor.cor ?? id.cor}
            onChange={(c: string) => { const v = c.slice(0, 7).toLowerCase(); if (hex.test(v)) pôr({ cor: v }) }}
          />
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-[2fr_1fr] gap-3">
        <div>
          <Input
            label="Empresa / marca"
            value={valor.empresa ?? ''}
            list="empresas-dos-portais"
            maxLength={60}
            onInput={(e) => pôr({ empresa: (e.target as HTMLInputElement).value || null })}
            placeholder="Ex.: INEPROTEC"
            hint="Agrupa os portais na lista e aparece como etiqueta no card."
          />
          <datalist id="empresas-dos-portais">{empresas.map((e) => <option key={e} value={e} />)}</datalist>
        </div>
        <Input
          label="Ordem na lista"
          type="number"
          min={0}
          max={999}
          value={valor.ordem == null ? '' : String(valor.ordem)}
          onInput={(e) => { const v = (e.target as HTMLInputElement).value; pôr({ ordem: v === '' ? null : Math.max(0, Math.min(999, parseInt(v) || 0)) }) }}
          placeholder="Automática"
          hint="Menor aparece primeiro."
        />
      </div>
      <Switch
        checked={valor.mostrarPolo === true}
        onChange={(v) => pôr({ mostrarPolo: v })}
        label="Mostrar polo"
        hint={polos.length
          ? `Mostra no card os polos deste portal (${polos.join(', ')}) e, na inscrição, o polo dela.`
          : 'Este portal ainda não tem polo cadastrado nas ofertas: ligado, o polo aparece quando existir.'}
      />
      <Input
        label="Descrição interna"
        value={valor.descricao ?? ''}
        maxLength={200}
        onInput={(e) => pôr({ descricao: (e.target as HTMLInputElement).value || null })}
        placeholder="Ex.: Técnicos por consultoria — Tradicional e Certificação por Competência"
        hint="Uma linha para a equipe saber para que serve o portal."
      />
    </Section>
  )
}

function SlugCheckHint({
  slug, status, result, onApplySuggestion,
}: {
  slug: string
  status: 'idle' | 'checking' | 'done'
  result: CheckSlugResult | null
  onApplySuggestion: () => void
}) {
  if (!slug) return null
  if (status === 'checking') {
    return (
      <div class="mt-1 text-2xs text-fg-muted inline-flex items-center gap-1">
        <Loader2 size={10} class="animate-spin" /> Verificando…
      </div>
    )
  }
  if (status !== 'done' || !result) return null

  if (result.available) {
    return (
      <div class="mt-1 text-2xs text-success inline-flex items-center gap-1">
        <CheckCircle2 size={10} /> Disponível
        {result.normalized && result.normalized !== slug && <> (será salvo como <code>{result.normalized}</code>)</>}
      </div>
    )
  }

  if (result.reason === 'too-short') {
    return (
      <div class="mt-1 text-2xs text-danger inline-flex items-center gap-1">
        <AlertCircle size={10} /> Muito curto (mínimo 3 caracteres)
      </div>
    )
  }

  if (result.reason === 'taken') {
    return (
      <div class="mt-1 text-2xs text-danger inline-flex items-center gap-1 flex-wrap">
        <AlertCircle size={10} /> Em uso por outro portal
        {result.suggestion && (
          <button
            type="button"
            class="text-accent hover:underline ml-1"
            onClick={onApplySuggestion}
          >
            usar <code>{result.suggestion}</code>?
          </button>
        )}
      </div>
    )
  }

  return null
}

function Section({ title, children }: { title: string; children: preact.ComponentChildren }) {
  return (
    <div>
      <div class="text-xs uppercase tracking-wider text-fg-muted mb-2">{title}</div>
      <div class="space-y-3">{children}</div>
    </div>
  )
}

function DeletePortalDialog({ portal, onClose }: { portal: EnrollmentPortal; onClose: () => void }) {
  const del = useDeleteEnrollmentPortal()
  const inUse = (portal._count?.registrations ?? 0) > 0

  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Excluir "${portal.nome}"`}
      description={
        inUse
          ? `Não é possível excluir: há ${portal._count?.registrations} inscrição(ões) vinculada(s) a este portal.`
          : 'O portal é excluído permanentemente. Esta ação não pode ser desfeita.'
      }
      destructive
      confirmLabel={inUse ? 'OK' : 'Excluir'}
      loading={del.isPending}
      onConfirm={() => {
        if (inUse) { onClose(); return }
        del.mutate(portal.id, {
          onSuccess: () => { toast('Portal excluído', 'success'); onClose() },
          onError: (e: unknown) => toast((e as Error).message, 'danger'),
        })
      }}
    />
  )
}
