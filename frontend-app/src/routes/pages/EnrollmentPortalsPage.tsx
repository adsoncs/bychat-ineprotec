import { useEffect, useRef, useState } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import { School, Plus, Pencil, Trash2, Copy, ExternalLink, MoreHorizontal, Code, Users as UsersIcon, CheckCircle2, AlertCircle, Loader2, HelpCircle } from 'lucide-preact'
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
import { Input, Textarea, Select } from '@/components/ui/Input'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { toast } from '@/lib/toast'

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
          <Button variant="primary" size="sm" onClick={() => setCreating(true)} disabled={noUnits}>
            <Plus size={14} /> Novo portal
          </Button>
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
            <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
              <Plus size={14} /> Criar primeiro portal
            </Button>
          }
        />
      )}

      {!isLoading && portals.length > 0 && (
        <div class="grid gap-2 grid-cols-1 lg:grid-cols-2">
          {portals.map((p) => (
            <PortalCard
              key={p.id}
              portal={p}
              onOpen={() => navigate(`/enrollment-portals/${p.id}`)}
              onEdit={() => setEditing(p)}
              onDelete={() => setDeleting(p)}
              onDuplicate={() => handleDuplicate(p)}
            />
          ))}
        </div>
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
            body: <>Cada portal tem um <strong>slug</strong> (URL pública: bychat.ia.br/p/seu-portal) e uma <strong>unidade</strong> associada. Pode ter um portal por curso, por unidade ou um geral — depende da sua operação.</>,
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

function PortalCard({
  portal: p, onOpen, onEdit, onDelete, onDuplicate,
}: {
  portal: EnrollmentPortal
  onOpen: () => void
  onEdit: () => void
  onDelete: () => void
  onDuplicate: () => void
}) {
  const formModeLabel = p.formMode === 'interest' ? 'Interesse (curto)' : 'Inscrição completa'
  const publicUrl = p.customDomain
    ? `https://${p.customDomain}/${p.slug}`
    : `${window.location.origin}/portal/${p.slug}`

  return (
    <Card>
      <div class="flex items-start gap-3 group">
        <span class="size-10 rounded-md bg-surface-3 grid place-items-center text-fg-muted shrink-0">
          <School size={16} />
        </span>
        <button type="button" class="min-w-0 flex-1 text-left" onClick={onOpen}>
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-sm font-medium text-fg truncate hover:text-accent">{p.nome}</span>
            <code class="text-[0.625rem] text-fg-subtle">{p.slug}</code>
            {!p.active && <span class="text-[0.625rem] uppercase text-fg-subtle">Inativo</span>}
          </div>
          <div class="text-xs text-fg-subtle">
            {p.unit?.nome ?? '—'} · {formModeLabel}
            {p.team && <> · {p.team.name}</>}
          </div>
          {p._count && (
            <div class="text-[0.6875rem] text-fg-muted tabular-nums mt-1">
              {p._count.registrations} inscrição(ões)
              {p.requirePayment && <> · pagamento obrigatório</>}
              {p.formMode === 'interest' && <> · TTL link {p.magicLinkTtlDays}d</>}
            </div>
          )}
        </button>
        <PortalActionsMenu portal={p} publicUrl={publicUrl} onEdit={onEdit} onDelete={onDelete} onDuplicate={onDuplicate} onOpen={onOpen} />
      </div>
    </Card>
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
          <button type="button" class="w-full text-left px-3 py-1.5 text-xs text-fg hover:bg-surface-3 inline-flex items-center gap-2" onClick={() => { setOpen(false); onEdit() }}>
            <Pencil size={12} /> Editar portal
          </button>
          <button type="button" class="w-full text-left px-3 py-1.5 text-xs text-fg hover:bg-surface-3 inline-flex items-center gap-2" onClick={() => { setOpen(false); onDuplicate() }}>
            <Copy size={12} /> Duplicar
          </button>
          <div class="my-1 h-px bg-border" />
          <button type="button" class="w-full text-left px-3 py-1.5 text-xs text-danger hover:bg-surface-3 inline-flex items-center gap-2" onClick={() => { setOpen(false); onDelete() }}>
            <Trash2 size={12} /> Excluir
          </button>
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
  const [formMode, setFormMode] = useState<PortalFormMode>(portal?.formMode ?? 'full')
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

  const create = useCreateEnrollmentPortal()
  const update = useUpdateEnrollmentPortal()
  const loading = create.isPending || update.isPending

  const fullPortals = existingPortals.filter((p) => p.formMode === 'full' && p.id !== portal?.id)

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
              <div class="text-xs text-fg-subtle mt-1">Formulário completo com escolha de oferta, dados e documentos.</div>
            </label>
            <label class={`rounded-md border p-3 cursor-pointer ${formMode === 'interest' ? 'border-accent bg-accent/5' : 'border-border'}`}>
              <input
                type="radio"
                class="mr-2"
                checked={formMode === 'interest'}
                onChange={() => setFormMode('interest')}
              />
              <span class="text-sm font-medium text-fg">Captura de interesse</span>
              <div class="text-xs text-fg-subtle mt-1">Formulário curto que envia magic link p/ continuar em outro portal.</div>
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
              <option value="">Selecione…</option>
              {fullPortals.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </Select>
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
      <div class="mt-1 text-[0.6875rem] text-fg-subtle inline-flex items-center gap-1">
        <Loader2 size={10} class="animate-spin" /> Verificando…
      </div>
    )
  }
  if (status !== 'done' || !result) return null

  if (result.available) {
    return (
      <div class="mt-1 text-[0.6875rem] text-success inline-flex items-center gap-1">
        <CheckCircle2 size={10} /> Disponível
        {result.normalized && result.normalized !== slug && <> (será salvo como <code>{result.normalized}</code>)</>}
      </div>
    )
  }

  if (result.reason === 'too-short') {
    return (
      <div class="mt-1 text-[0.6875rem] text-danger inline-flex items-center gap-1">
        <AlertCircle size={10} /> Muito curto (mínimo 3 caracteres)
      </div>
    )
  }

  if (result.reason === 'taken') {
    return (
      <div class="mt-1 text-[0.6875rem] text-danger inline-flex items-center gap-1 flex-wrap">
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
      <div class="text-xs uppercase tracking-wider text-fg-subtle mb-2">{title}</div>
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
