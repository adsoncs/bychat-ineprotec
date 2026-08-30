import { lazy, Suspense } from 'preact/compat'
import { useState } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import { FormInput, Plus, Pencil, Trash2, Code, BarChart3, Eye, Copy, HelpCircle, LayoutTemplate } from '@/components/ui/icon-set'
import { HowItWorksModal } from '@/components/ui/HowItWorksModal'
import {
  useForms, useCreateForm, useUpdateForm, useDeleteForm, useDuplicateForm,
  useFormEmbedCode, useFormSubmissions, useFormTemplates,
  type FormItem, type FormSubmission, type FormTemplate,
} from '@/hooks/useForms'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { formatDateTime } from '@/lib/format'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/cn'

const LazyLeadDetailModal = lazy(() =>
  import('@/routes/pages/LeadsPage').then((m) => ({ default: m.LeadDetailModal })),
)

export function FormsPage() {
  const { data, isLoading } = useForms()
  const [, navigate] = useLocation()
  const [deleting, setDeleting] = useState<FormItem | null>(null)
  const [embedOf, setEmbedOf] = useState<FormItem | null>(null)
  const [submissionsOf, setSubmissionsOf] = useState<FormItem | null>(null)
  const [showHowItWorks, setShowHowItWorks] = useState(false)
  const [pickingTemplate, setPickingTemplate] = useState(false)
  const update = useUpdateForm()
  const duplicate = useDuplicateForm()
  const createForm = useCreateForm()

  function handleNew() {
    createForm.mutate({ name: 'Novo formulário' }, {
      onSuccess: ({ form }) => navigate(`/forms/${form.id}`),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function toggleActive(form: FormItem) {
    update.mutate({ id: form.id, active: !form.active }, {
      onSuccess: () => toast(form.active ? 'Formulário desativado' : 'Formulário ativado', 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  function handleDuplicate(form: FormItem) {
    duplicate.mutate(form.id, {
      onSuccess: () => toast('Formulário duplicado', 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <Page
      title="Formulários"
      description="Formulários publicados e contagem de submissões."
      actions={
        <div class="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setShowHowItWorks(true)}>
            <HelpCircle size={14} /> Como funciona?
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setPickingTemplate(true)}>
            <LayoutTemplate size={14} /> A partir de um modelo
          </Button>
          <Button variant="primary" size="sm" onClick={handleNew}>
            <Plus size={14} /> Novo formulário
          </Button>
        </div>
      }
    >
      {isLoading && (
        <div class="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} class="h-14 w-full" />)}
        </div>
      )}
      {!isLoading && data?.forms.length === 0 && (
        <EmptyState
          icon={<FormInput size={24} />}
          title="Nenhum formulário criado"
          action={<Button size="sm" variant="primary" onClick={handleNew}><Plus size={14} /> Criar primeiro</Button>}
        />
      )}
      {!isLoading && data && data.forms.length > 0 && (
        <Card class="p-0 overflow-hidden">
          <ul class="divide-y divide-border">
            {data.forms.map((f) => (
              <li key={f.id} class="px-4 py-3 flex items-center gap-3 flex-wrap">
                <div class="size-9 rounded-md bg-accent/15 text-accent grid place-items-center shrink-0">
                  <FormInput size={16} />
                </div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="text-sm font-medium text-fg truncate">{f.name}</span>
                    <button type="button" onClick={() => toggleActive(f)} class="cursor-pointer" title="Ativar/desativar">
                      <Badge tone={f.active ? 'accent' : 'neutral'}>{f.active ? 'Ativo' : 'Inativo'}</Badge>
                    </button>
                  </div>
                  <div class="text-2xs text-fg-muted mt-0.5 flex items-center gap-3 flex-wrap">
                    <span class="font-mono">ID: {f.id}</span>
                    <span>Criado em {formatDateTime(f.createdAt)}</span>
                  </div>
                </div>
                <div class="flex gap-1.5 shrink-0 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setSubmissionsOf(f)}
                    class={cn(
                      'inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium border transition-colors',
                      f.submissions > 0
                        ? 'bg-accent text-fg-on-brand border-accent hover:bg-accent-hover'
                        : 'bg-surface-2 text-fg-muted border-border hover:bg-surface-3 hover:text-fg',
                    )}
                    aria-label="Ver conversões"
                    title="Ver conversões"
                  >
                    <BarChart3 size={12} /> {f.submissions} {f.submissions === 1 ? 'conversão' : 'conversões'}
                  </button>
                  <Button variant="secondary" size="sm" onClick={() => setEmbedOf(f)} aria-label="Código de embed" title="Código de embed">
                    <Code size={12} /> Embed
                  </Button>
                  <Button variant="primary" size="sm" onClick={() => navigate(`/forms/${f.id}`)} aria-label="Editar formulário" title="Editar formulário">
                    <Pencil size={12} /> Editar
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleDuplicate(f)}
                    disabled={duplicate.isPending}
                    aria-label="Duplicar formulário"
                    title="Duplicar"
                  >
                    <Copy size={12} /> Duplicar
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setDeleting(f)}
                    aria-label="Excluir formulário"
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

      {deleting && <DeleteFormDialog form={deleting} onClose={() => setDeleting(null)} />}
      {embedOf && <FormEmbedModal form={embedOf} onClose={() => setEmbedOf(null)} />}
      {submissionsOf && <FormSubmissionsModal form={submissionsOf} onClose={() => setSubmissionsOf(null)} />}

      <HowItWorksModal
        open={showHowItWorks}
        onClose={() => setShowHowItWorks(false)}
        title="Como funcionam os Formulários?"
        problem={<>
          Quer capturar leads pelo seu site, landing page ou anúncio? Formulário é a porta de entrada
          padrão: você desenha os campos, copia o código e cola onde quiser. As respostas viram lead
          automaticamente, com etapa do funil, etiqueta e operador já definidos.
        </>}
        steps={[
          {
            title: '📝 Crie o formulário',
            body: <>Botão <strong>Novo formulário</strong>: dá nome, escolhe funil/etapa de destino, equipe responsável. Pode personalizar cor, fonte e estilo na aba Aparência.</>,
          },
          {
            title: '🧱 Configure os campos',
            body: <>Adicione perguntas: texto, e-mail, WhatsApp, dropdown, checkbox, data, número. Cada campo pode ser obrigatório e mapeado pra um <strong>campo do lead</strong> (ex.: "Qual seu interesse?" → etiqueta).</>,
          },
          {
            title: '🔗 Publique com o código de embed',
            body: <>Botão <strong>Embed</strong>: gera um snippet JavaScript pra colar no seu site/landing page. Pode também ser usado como página hospedada por nós (o endereço aparece em Compartilhar).</>,
          },
          {
            title: '👤 Cada submissão vira lead',
            body: <>Cliente preenche, dá submit, e <strong>na hora</strong> nasce um lead no CRM com os dados, já na etapa que você definiu. Dispara fluxos automáticos (mandar WhatsApp de boas-vindas, criar atividade, etc.).</>,
          },
          {
            title: '📊 Acompanhe conversões',
            body: <>Botão <strong>Ver conversões</strong> em cada formulário mostra: quantas submissões, quem submeteu, e o histórico. Útil pra A/B testar versões de formulário e medir o que converte mais.</>,
          },
        ]}
        tip={{
          tone: 'info',
          title: '💡 Duplicar pra testar',
          body: <>Pra rodar um teste A/B: duplique o formulário existente, ajuste cor/texto/campos, embede em landings diferentes e compare as conversões. Use o exportar/importar pra mover entre contas.</>,
        }}
      />

      {pickingTemplate && (
        <FormTemplatePickerModal
          onClose={() => setPickingTemplate(false)}
          onCreated={(form) => navigate(`/forms/${form.id}`)}
        />
      )}
    </Page>
  )
}

function FormTemplatePickerModal({ onClose, onCreated }: { onClose: () => void; onCreated: (f: FormItem) => void }) {
  const { data, isLoading } = useFormTemplates()
  const create = useCreateForm()
  const [picked, setPicked] = useState<FormTemplate | null>(null)
  const [name, setName] = useState('')

  function handleCreate() {
    if (!picked) return
    if (!name.trim()) { toast('Informe o nome do formulário', 'danger'); return }
    create.mutate(
      { name: name.trim(), fields: picked.fields, settings: picked.settings, styling: picked.styling ?? null },
      {
        onSuccess: ({ form }) => { toast('Formulário criado — abrindo editor', 'success'); onClose(); onCreated(form) },
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
          <Button variant="primary" size="sm" onClick={handleCreate} disabled={!picked || !name.trim() || create.isPending}>
            {create.isPending ? 'Criando…' : 'Criar formulário'}
          </Button>
        </>
      }
    >
      {isLoading && <Skeleton class="h-32 w-full" />}
      {!isLoading && data && data.templates.length > 0 && (
        <div class="space-y-3">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {data.templates.map((t) => (
              <button
                key={t.id}
                type="button"
                class={cn(
                  'text-left rounded-md border p-3 cursor-pointer transition-colors',
                  picked?.id === t.id ? 'border-accent bg-accent/5' : 'border-border hover:bg-surface-3',
                )}
                onClick={() => { setPicked(t); if (!name) setName(t.name) }}
              >
                <div class="text-sm font-medium text-fg">{t.name}</div>
                {t.category && <div class="text-2xs uppercase tracking-wider text-fg-muted mt-0.5">{t.category}</div>}
                {t.description && <div class="text-xs text-fg-muted mt-1 line-clamp-2">{t.description}</div>}
                <div class="text-2xs text-fg-muted mt-1.5">{t.fields.length} campos · {t.settings.displayMode === 'conversational' ? 'Conversacional' : 'Clássico'}</div>
              </button>
            ))}
          </div>
          {picked && (
            <div class="border-t border-border pt-3">
              <Input
                label="Nome do novo formulário"
                value={name}
                onInput={(e) => setName((e.target as HTMLInputElement).value)}
                placeholder="Ex.: Captação — Campanha de Leads"
              />
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

function FormEmbedModal({ form, onClose }: { form: FormItem; onClose: () => void }) {
  const { data, isLoading } = useFormEmbedCode(form.id)
  const [copied, setCopied] = useState(false)

  function copy(text: string) {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      toast('Copiado', 'success')
      setTimeout(() => setCopied(false), 1800)
    })
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Código de Embed — ${form.name}`}
      description="Cole este código em qualquer página para exibir o formulário."
      size="lg"
      footer={<Button variant="secondary" size="sm" onClick={onClose}>Fechar</Button>}
    >
      {isLoading && <Skeleton class="h-32 w-full" />}
      {data && data.displayMode === 'conversational' && (
        <div class="space-y-4">
          <div class="space-y-2">
            <div class="text-xs font-semibold uppercase tracking-wider text-fg-muted">Link hospedado (recomendado)</div>
            <div class="flex items-center gap-2">
              <Input value={data.hostedUrl} readOnly class="flex-1 font-mono text-xs" onFocusCapture={(e) => (e.target as HTMLInputElement).select()} />
              <Button variant="secondary" size="sm" class="shrink-0" onClick={() => copy(data.hostedUrl)}>{copied ? 'Copiado!' : 'Copiar'}</Button>
              <a href={data.hostedUrl} target="_blank" rel="noreferrer" class="shrink-0 inline-flex items-center gap-1 h-8 px-3 rounded-md text-xs font-medium bg-accent text-fg-on-brand hover:bg-accent-hover">Abrir</a>
            </div>
            <p class="text-2xs text-fg-muted">Página full-screen, uma pergunta por vez. Compartilhe o link direto ou em campanhas.</p>
          </div>
          <div class="space-y-2">
            <div class="text-xs font-semibold uppercase tracking-wider text-fg-muted">Ou embuta por iframe</div>
            <div class="relative rounded-md bg-zinc-900 border border-zinc-800 p-4">
              <button type="button" onClick={() => copy(data.iframeSnippet)}
                class="absolute top-2 right-2 inline-flex items-center gap-1 h-7 px-3 rounded-md text-2xs font-medium bg-zinc-800 text-zinc-100 border border-zinc-700 hover:bg-zinc-700 transition-colors">
                <Code size={10} /> Copiar
              </button>
              <pre class="text-xs font-mono text-zinc-100 whitespace-pre-wrap break-all m-0 pr-20">{data.iframeSnippet}</pre>
            </div>
          </div>
        </div>
      )}
      {data && data.displayMode !== 'conversational' && (
        <div class="space-y-3">
          <div class="relative rounded-md bg-zinc-900 border border-zinc-800 p-4">
            <button
              type="button"
              onClick={() => copy(data.snippet)}
              class="absolute top-2 right-2 inline-flex items-center gap-1 h-7 px-3 rounded-md text-2xs font-medium bg-zinc-800 text-zinc-100 border border-zinc-700 hover:bg-zinc-700 transition-colors"
            >
              <Code size={10} /> {copied ? 'Copiado!' : 'Copiar'}
            </button>
            <pre class="text-xs font-mono text-zinc-100 whitespace-pre-wrap break-all m-0 pr-20">
              {data.snippet}
            </pre>
          </div>
          <div class="rounded-md border border-info/30 bg-info/10 p-3 text-xs text-info">
            <strong>Web Component com Shadow DOM.</strong> O formulário funciona em qualquer site sem conflito de CSS — não usa iframe, é responsivo e leve.
          </div>
        </div>
      )}
    </Modal>
  )
}

function FormSubmissionsModal({ form, onClose }: { form: FormItem; onClose: () => void }) {
  const { data, isLoading } = useFormSubmissions(form.id, 100)
  const [openLeadId, setOpenLeadId] = useState<number | null>(null)

  return (
    <>
      <Modal
        open
        onOpenChange={(o) => { if (!o) onClose() }}
        title={`Conversões — ${form.name}`}
        description={`${form.submissions} ${form.submissions === 1 ? 'envio' : 'envios'} no total`}
        size="lg"
        footer={<Button variant="secondary" size="sm" onClick={onClose}>Fechar</Button>}
      >
        {isLoading && <Skeleton class="h-32 w-full" />}
        {!isLoading && data?.submissions.length === 0 && (
          <div class="text-sm text-fg-muted text-center py-6">Nenhuma conversão ainda neste formulário.</div>
        )}
        {!isLoading && data && data.submissions.length > 0 && (
          <div class="overflow-x-auto -mx-4">
            <table class="w-full text-sm">
              <thead class="text-fg-muted text-2xs uppercase tracking-wider border-b border-border">
                <tr>
                  <th class="text-left px-4 py-2 font-medium">Lead</th>
                  <th class="text-left px-4 py-2 font-medium">Contato</th>
                  <th class="text-left px-4 py-2 font-medium">Origem</th>
                  <th class="text-left px-4 py-2 font-medium">Data</th>
                  <th class="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-border">
                {data.submissions.map((s) => (
                  <SubmissionRow key={s.id} s={s} onView={(id) => setOpenLeadId(id)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
      {openLeadId !== null && (
        <Suspense fallback={null}>
          <LazyLeadDetailModal id={openLeadId} onClose={() => setOpenLeadId(null)} />
        </Suspense>
      )}
    </>
  )
}

function SubmissionRow({ s, onView }: { s: FormSubmission; onView: (leadId: number) => void }) {
  const fd = s.data ?? {}
  const nome = s.lead?.nome ?? (fd.nome as string | undefined) ?? (fd.name as string | undefined) ?? '—'
  const empresa = s.lead?.empresa ?? (fd.empresa as string | undefined) ?? ''
  const email = s.lead?.email ?? (fd.email as string | undefined) ?? ''
  const whatsapp = s.lead?.whatsapp ?? (fd.whatsapp as string | undefined) ?? (fd.phone as string | undefined) ?? ''
  const utm = [s.utmSource, s.utmMedium].filter(Boolean).join(' / ')

  return (
    <tr class="hover:bg-surface-3">
      <td class="px-4 py-2">
        <div class="text-fg font-medium truncate">{nome}</div>
        {empresa && <div class="text-2xs text-fg-muted truncate">{empresa}</div>}
      </td>
      <td class="px-4 py-2 text-xs">
        {email && <div class="text-fg-muted truncate">{email}</div>}
        {whatsapp && <div class="text-success truncate">{whatsapp}</div>}
        {!email && !whatsapp && <span class="text-fg-muted">—</span>}
      </td>
      <td class="px-4 py-2 text-xs">
        <div class="text-fg-muted truncate max-w-48">{s.pageSlug ? <span class="text-accent">/p/{s.pageSlug}</span> : 'Embed externo'}</div>
        {utm && <div class="text-fg-muted truncate max-w-48">{utm}</div>}
      </td>
      <td class="px-4 py-2 text-xs text-fg-muted whitespace-nowrap">{formatDateTime(s.createdAt)}</td>
      <td class="px-4 py-2 text-right whitespace-nowrap">
        {s.leadId ? (
          <button
            type="button"
            onClick={() => onView(s.leadId!)}
            class="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-xs font-medium bg-accent/15 text-accent border border-accent/40 hover:bg-accent/25"
          >
            <Eye size={10} /> Ver Lead #{s.leadId}
          </button>
        ) : (
          <span class="text-2xs text-fg-muted">Sem lead</span>
        )}
      </td>
    </tr>
  )
}

function DeleteFormDialog({ form, onClose }: { form: FormItem; onClose: () => void }) {
  const del = useDeleteForm()
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Excluir "${form.name}"`}
      description="O formulário vai para a lixeira e pode ser restaurado. Submissões já recebidas são preservadas."
      destructive
      confirmLabel="Excluir"
      loading={del.isPending}
      onConfirm={() => del.mutate(form.id, {
        onSuccess: () => { toast('Formulário movido para a lixeira', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })}
    />
  )
}
