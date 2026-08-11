import { useMemo, useRef, useState } from 'preact/hooks'
import { FileText, Plus, HelpCircle, Search, X, Bold, Italic, Strikethrough, Code } from 'lucide-preact'
import { HowItWorksModal } from '@/components/ui/HowItWorksModal'
import {
  useTemplates,
  useCreateTemplate,
  useUpdateTemplate,
  useDeleteTemplate,
  useTemplateVariables,
  type MessageTemplateItem,
  type TemplateInput,
} from '@/hooks/useTemplates'
import { TemplateAttachmentField, type TemplateAttachment } from '@/components/TemplateAttachmentField'
import { TemplateCompositionFields } from '@/components/TemplateCompositionFields'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Input, Select } from '@/components/ui/Input'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { RichTextEditor, htmlToText } from '@/components/ui/RichTextEditor'
import { SmsCounter } from '@/components/ui/SmsCounter'
import { PhonePreview } from '@/components/ui/PhonePreview'
import { cn } from '@/lib/cn'
import { toast } from '@/lib/toast'

const CATEGORIES = ['general', 'proposal', 'follow_up', 'onboarding', 'report', 'reminder']

const CATEGORY_LABEL: Record<string, string> = {
  general: 'Geral',
  proposal: 'Proposta',
  follow_up: 'Follow-up',
  onboarding: 'Onboarding',
  report: 'Relatório',
  reminder: 'Lembrete',
}

const CHANNEL_TONE: Record<string, 'success' | 'danger' | 'warning' | 'info'> = {
  whatsapp: 'success',
  email: 'danger',
  sms: 'warning',
}

const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: 'WhatsApp',
  email: 'E-mail',
  sms: 'SMS',
}

const CHANNEL_FILTERS: { key: string; label: string; activeClass: string }[] = [
  { key: '', label: 'Todos', activeClass: 'border-accent text-accent bg-accent/10' },
  { key: 'whatsapp', label: 'WhatsApp', activeClass: 'border-success text-success bg-success/10' },
  { key: 'email', label: 'E-mail', activeClass: 'border-danger text-danger bg-danger/10' },
  { key: 'sms', label: 'SMS', activeClass: 'border-warning text-warning bg-warning/10' },
]

const QUICK_VARS = ['nome', 'empresa', 'score', 'maturidade', 'solucao', 'operador', 'data_hoje']

// Conserta HTML salvo entity-encoded por engano (&lt;div&gt;…). Só decodifica quando
// o valor parece TODO escapado (tem &lt;/&gt; e nenhuma tag crua) — não toca HTML válido.
function decodeHtmlIfEscaped(v: string): string {
  const s = v ?? ''
  if (s && /&lt;|&gt;/.test(s) && !/<[a-z!/]/i.test(s)) {
    return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  }
  return s
}

export function TemplatesPage() {
  const [channelFilter, setChannelFilter] = useState('')
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const { data, isLoading } = useTemplates(channelFilter ? { channel: channelFilter } : {})
  const [editing, setEditing] = useState<MessageTemplateItem | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<MessageTemplateItem | null>(null)
  const [showHowItWorks, setShowHowItWorks] = useState(false)

  const filteredTemplates = useMemo(() => {
    if (!data?.templates) return []
    const q = search.trim().toLowerCase()
    return data.templates.filter((t) => {
      if (categoryFilter && t.category !== categoryFilter) return false
      if (!q) return true
      const categoryLabel = t.category ? (CATEGORY_LABEL[t.category] ?? t.category) : ''
      return (
        t.name.toLowerCase().includes(q) ||
        (t.subject ?? '').toLowerCase().includes(q) ||
        t.body.toLowerCase().includes(q) ||
        (t.category ?? '').toLowerCase().includes(q) ||
        categoryLabel.toLowerCase().includes(q)
      )
    })
  }, [data?.templates, search, categoryFilter])

  const totalCount = data?.templates.length ?? 0
  const filteredCount = filteredTemplates.length
  const hasActiveFilter = !!search.trim() || !!categoryFilter

  return (
    <Page
      title="Modelos"
      description="Modelos de mensagens com variáveis dinâmicas."
      actions={
        <div class="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setShowHowItWorks(true)}>
            <HelpCircle size={14} /> Como funciona?
          </Button>
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            <Plus size={14} /> Novo modelo
          </Button>
        </div>
      }
    >
      <div class="flex flex-col sm:flex-row sm:items-center gap-2 mb-3">
        <div class="relative flex-1 min-w-0">
          <Search size={14} class="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle pointer-events-none" />
          <input
            type="text"
            value={search}
            onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
            placeholder="Buscar por nome, assunto, conteúdo…"
            class="w-full h-8 pl-8 pr-8 rounded-md border border-border bg-surface-2 text-xs text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              class="absolute right-2 top-1/2 -translate-y-1/2 text-fg-subtle hover:text-fg"
              aria-label="Limpar busca"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter((e.target as HTMLSelectElement).value)}
          class="h-8 px-2 rounded-md border border-border bg-surface-2 text-xs text-fg focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent"
        >
          <option value="">Todas as categorias</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c] ?? c}</option>)}
        </select>
      </div>

      <div class="flex flex-wrap items-center gap-1.5 mb-3">
        {CHANNEL_FILTERS.map((f) => {
          const active = channelFilter === f.key
          return (
            <button
              key={f.key || 'all'}
              type="button"
              onClick={() => setChannelFilter(f.key)}
              class={cn(
                'px-3.5 h-7 rounded-full border text-xs font-medium transition-colors',
                active ? f.activeClass : 'border-border text-fg-muted hover:text-fg hover:bg-surface-3',
              )}
            >
              {f.label}
            </button>
          )
        })}
        {!isLoading && data && (
          <span class="ml-auto text-[0.6875rem] text-fg-subtle">
            {hasActiveFilter ? `${filteredCount} de ${totalCount}` : `${totalCount} ${totalCount === 1 ? 'modelo' : 'modelos'}`}
          </span>
        )}
      </div>

      {isLoading && (
        <div class="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} class="h-28 w-full" />)}
        </div>
      )}
      {!isLoading && totalCount === 0 && (
        <EmptyState
          icon={<FileText size={24} />}
          title="Nenhum modelo encontrado"
          action={<Button size="sm" variant="primary" onClick={() => setCreating(true)}><Plus size={14} /> Criar primeiro</Button>}
        />
      )}
      {!isLoading && totalCount > 0 && filteredCount === 0 && (
        <EmptyState
          icon={<Search size={24} />}
          title="Nenhum modelo corresponde aos filtros"
          description="Tente outros termos ou limpe os filtros."
          action={
            <Button size="sm" variant="secondary" onClick={() => { setSearch(''); setCategoryFilter(''); setChannelFilter('') }}>
              Limpar filtros
            </Button>
          }
        />
      )}
      {!isLoading && filteredCount > 0 && (
        <div class="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {filteredTemplates.map((t) => {
            const tone = CHANNEL_TONE[t.channel] ?? 'info'
            const channelLabel = CHANNEL_LABEL[t.channel] ?? t.channel
            return (
              <Card key={t.id}>
                <div class="flex items-center gap-2 mb-2">
                  <Badge tone={tone}>{channelLabel}</Badge>
                  {t.category && <Badge tone="neutral">{CATEGORY_LABEL[t.category] ?? t.category}</Badge>}
                  <span class="text-[0.625rem] text-fg-subtle ml-auto">Usado {t.usageCount}x</span>
                </div>
                <div class="text-sm font-medium text-fg mb-1">{t.name}</div>
                {t.key && (
                  <div class="mb-1.5" title="Identificador fixo usado pelo sistema. Você pode renomear o modelo acima à vontade — isto não muda.">
                    <span class="inline-flex items-center gap-1 text-[0.625rem] font-mono text-fg-subtle bg-surface-2 border border-border rounded px-1.5 py-0.5">🔑 {t.key}</span>
                  </div>
                )}
                {t.subject && <div class="text-xs text-fg-muted mb-1 truncate">Assunto: {t.subject}</div>}
                <p class="text-xs text-fg-subtle line-clamp-3 whitespace-pre-line">{t.body}</p>
                <div class="flex gap-1.5 mt-3">
                  <Button variant="secondary" size="sm" onClick={() => setEditing(t)}>Editar</Button>
                  <Button variant="ghost" size="sm" class="text-danger hover:text-danger" onClick={() => setDeleting(t)}>Excluir</Button>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {(creating || editing) && (
        <TemplateFormModal template={editing} onClose={() => { setCreating(false); setEditing(null) }} />
      )}
      {deleting && <DeleteTemplateDialog template={deleting} onClose={() => setDeleting(null)} />}

      <HowItWorksModal
        open={showHowItWorks}
        onClose={() => setShowHowItWorks(false)}
        title="Como funcionam os Modelos?"
        problem={<>
          Quantas vezes seu time digita a mesma mensagem? "Oi {'{{nome}}'}, recebi seu interesse no curso…",
          "Segue a proposta…", "Confirmando reunião amanhã às 10h". Em vez de copiar e colar (e errar
          variáveis), monte uma vez e use em qualquer lugar: cadências, fluxos, conversas, atividades.
        </>}
        steps={[
          {
            title: '✍️ Crie o modelo',
            body: <>Botão <strong>Novo modelo</strong>: nome, canal (WhatsApp/E-mail/SMS), categoria (proposta, follow-up, lembrete) e o conteúdo. Pra e-mail tem campo de assunto também.</>,
          },
          {
            title: '🔣 Use variáveis dinâmicas',
            body: <>Escreva <code>{'{{nome}}'}</code>, <code>{'{{empresa}}'}</code>, <code>{'{{operador}}'}</code>, <code>{'{{data_hoje}}'}</code>. Quando enviar, o sistema substitui pelas informações reais do lead. Variáveis disponíveis aparecem do lado.</>,
          },
          {
            title: '🗂️ Categorize por canal e tipo',
            body: <>Filtros no topo separam por canal (mostra só WhatsApp, só E-mail). Categoria (Proposta, Follow-up, Onboarding…) ajuda a achar rápido na lista — modelos crescem rápido.</>,
          },
          {
            title: '🚀 Use em qualquer lugar',
            body: <>Modelos aparecem em: cadências (cada passo escolhe um modelo), fluxos (ação "enviar mensagem"), conversas (botão de templates no chat), atividades (preenche a sugestão).</>,
          },
          {
            title: '🔄 Edite uma vez, vale pra todo lugar',
            body: <>Modificou o modelo? Todos os lugares que referenciam ele passam a usar a versão nova. Útil pra ajustar copy, mudar oferta, atualizar promoção.</>,
          },
        ]}
        tip={{
          tone: 'info',
          title: '💡 Dica',
          body: <>Mantenha modelos <strong>curtos</strong> (especialmente WhatsApp — limite de 1000 caracteres pra mensagens template do Cloud API). Use parágrafos curtos, evite copy "marketês" que cliente vê na hora que é robô.</>,
        }}
      />
    </Page>
  )
}

function TemplateFormModal({ template, onClose }: { template: MessageTemplateItem | null; onClose: () => void }) {
  const [name, setName] = useState(template?.name ?? '')
  const [channel, setChannel] = useState(template?.channel ?? 'whatsapp')
  const [category, setCategory] = useState(template?.category ?? 'general')
  const [subject, setSubject] = useState(template?.subject ?? '')
  const [body, setBody] = useState(template?.body ?? '')
  const [bodyHtml, setBodyHtml] = useState(decodeHtmlIfEscaped(template?.bodyHtml ?? ''))
  // Atalho do Conversas: normaliza p/ minúsculo, sem "/", só [a-z0-9_-].
  const [shortcut, setShortcut] = useState(template?.shortcut ?? '')
  const [header, setHeader] = useState(template?.header ?? '')
  const [footer, setFooter] = useState(template?.footer ?? '')
  const [options, setOptions] = useState<string[]>(template?.options ?? [])
  const [anexo, setAnexo] = useState<TemplateAttachment | null>(
    template?.attachmentUrl
      ? { url: template.attachmentUrl, name: template.attachmentName || 'arquivo', type: template.attachmentType || 'document' }
      : null,
  )
  const create = useCreateTemplate()
  const update = useUpdateTemplate()
  const { data: variables } = useTemplateVariables()
  const isEdit = !!template
  const loading = create.isPending || update.isPending

  const varKeys = variables?.variables.length ? variables.variables.map((v) => v.key) : QUICK_VARS

  function handleSubmit() {
    // Nunca persistir HTML escapado (ex.: colado como texto): decodifica antes.
    const cleanHtml = decodeHtmlIfEscaped(bodyHtml)
    const finalBody = channel === 'email' ? (body || htmlToText(cleanHtml)) : body
    if (!name.trim() || !finalBody.trim()) {
      toast('Nome e conteúdo são obrigatórios.', 'danger')
      return
    }
    const payload: TemplateInput = {
      name: name.trim(),
      channel,
      category,
      subject: channel === 'email' && subject.trim() ? subject.trim() : null,
      body: finalBody,
      bodyHtml: channel === 'email' && cleanHtml.trim() ? cleanHtml.trim() : null,
      shortcut: shortcut.trim() || null,
      attachmentUrl: anexo?.url ?? null,
      attachmentName: anexo?.name ?? null,
      attachmentType: anexo?.type ?? null,
      header: header.trim() || null,
      footer: footer.trim() || null,
      options: options.map((o) => o.trim()).filter(Boolean),
    }
    const onSuccess = () => { toast(isEdit ? 'Modelo atualizado' : 'Modelo criado', 'success'); onClose() }
    const onError = (e: unknown) => toast((e as Error).message, 'danger')
    if (isEdit) {
      update.mutate({ id: template.id, ...payload }, { onSuccess, onError })
    } else {
      create.mutate(payload, { onSuccess, onError })
    }
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={isEdit ? 'Editar modelo' : 'Novo modelo'}
      description="Use {{nome}}, {{empresa}}, etc. para variáveis dinâmicas."
      size="xl"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={loading}>
            {loading ? 'Salvando…' : isEdit ? 'Salvar' : 'Criar'}
          </Button>
        </>
      }
    >
      <div class="grid gap-3 grid-cols-1 sm:grid-cols-3">
        <Input label="Nome *" value={name} placeholder="Ex: Proposta Comercial" onInput={(e) => setName((e.target as HTMLInputElement).value)} />
        <Select label="Canal *" value={channel} onChange={(e) => setChannel((e.target as HTMLSelectElement).value)}>
          <option value="whatsapp">WhatsApp</option>
          <option value="email">E-mail</option>
          <option value="sms">SMS</option>
        </Select>
        <Select label="Categoria" value={category ?? 'general'} onChange={(e) => setCategory((e.target as HTMLSelectElement).value)}>
          {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c] ?? c}</option>)}
        </Select>
        <div>
          <Input
            label="Atalho no chat"
            value={shortcut}
            placeholder="Ex: doc → digite /doc"
            hint="No Conversas, digite / para ver os atalhos."
            onInput={(e) => setShortcut((e.target as HTMLInputElement).value.replace(/^\//, '').toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
          />
          {!shortcut.trim() && sugestaoAtalho(name) && (
            <button
              type="button"
              class="mt-1 text-xs text-accent hover:underline"
              onClick={() => setShortcut(sugestaoAtalho(name))}
            >
              Usar /{sugestaoAtalho(name)}
            </button>
          )}
        </div>
      </div>

      {channel === 'email' ? (
        <EmailPanel
          subject={subject}
          setSubject={setSubject}
          setBody={setBody}
          bodyHtml={bodyHtml}
          setBodyHtml={setBodyHtml}
          varKeys={varKeys}
        />
      ) : channel === 'whatsapp' ? (
        <ChatPanel kind="whatsapp" body={body} setBody={setBody} varKeys={varKeys} />
      ) : (
        <ChatPanel kind="sms" body={body} setBody={setBody} varKeys={varKeys} />
      )}

      <TemplateCompositionFields
        header={header}
        setHeader={setHeader}
        footer={footer}
        setFooter={setFooter}
        options={options}
        setOptions={setOptions}
        channel={channel}
        body={body}
      />

      <TemplateAttachmentField value={anexo} onChange={setAnexo} channel={channel} />
    </Modal>
  )
}

/** Sugere um atalho a partir do nome. Sem isto quase ninguém preenche o campo
 *  — e um modelo sem atalho não aparece ao digitar "/" no Conversas. */
function sugestaoAtalho(nome: string): string {
  const limpo = nome
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim()
  if (!limpo) return ''
  const irrelevantes = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'para', 'com', 'em', 'no', 'na'])
  const palavras = limpo.split(/\s+/).filter((p) => !irrelevantes.has(p))
  if (!palavras.length) return ''
  const base = palavras.length === 1 ? palavras[0]!.slice(0, 12) : palavras.slice(0, 2).map((p) => p.slice(0, 6)).join('')
  return base.slice(0, 20)
}

function EmailPanel({
  subject,
  setSubject,
  setBody,
  bodyHtml,
  setBodyHtml,
  varKeys,
}: {
  subject: string
  setSubject: (s: string) => void
  setBody: (s: string) => void
  bodyHtml: string
  setBodyHtml: (s: string) => void
  varKeys: string[]
}) {
  const [tab, setTab] = useState<'visual' | 'html'>('visual')

  function handleChange(html: string) {
    setBodyHtml(html)
    setBody(htmlToText(html))
  }

  return (
    <>
      <div class="mt-3">
        <Input
          label="Assunto"
          value={subject ?? ''}
          placeholder="Ex: Olá {{nome}}, sua proposta chegou"
          onInput={(e) => setSubject((e.target as HTMLInputElement).value)}
        />
      </div>

      <div class="mt-3">
        <div class="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
          <span class="text-xs font-medium text-fg-muted">Conteúdo do e-mail *</span>
          <div class="inline-flex items-center rounded-md border border-border bg-surface-2 p-0.5">
            <button
              type="button"
              onClick={() => setTab('visual')}
              class={cn(
                'h-6 px-2.5 text-[0.6875rem] font-medium rounded transition-colors',
                tab === 'visual' ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg',
              )}
            >
              Visual
            </button>
            <button
              type="button"
              onClick={() => setTab('html')}
              class={cn(
                'h-6 px-2.5 text-[0.6875rem] font-medium rounded transition-colors',
                tab === 'html' ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg',
              )}
            >
              HTML
            </button>
          </div>
        </div>

        {tab === 'visual' ? (
          <RichTextEditor
            value={bodyHtml || ''}
            onChange={handleChange}
            varKeys={varKeys}
            placeholder="Comece a digitar… Use a barra acima para formatar o e-mail."
            minHeight={260}
          />
        ) : (
          <div class="rounded-md border border-border bg-surface overflow-hidden">
            <textarea
              value={bodyHtml}
              onInput={(e) => handleChange((e.target as HTMLTextAreaElement).value)}
              rows={14}
              placeholder="<p>Olá {{nome}},</p>…"
              spellcheck={false}
              class="w-full px-3 py-2 text-[0.75rem] font-mono bg-surface text-fg outline-none resize-y min-h-[260px]"
            />
            <div class="px-2 py-1.5 border-t border-border text-[0.625rem] text-fg-subtle">
              Edite o HTML diretamente. Mudanças refletem na aba <strong>Visual</strong> e na pré-visualização.
            </div>
          </div>
        )}
      </div>

      <div class="mt-3">
        <span class="text-xs font-medium text-fg-muted block mb-1.5">Pré-visualização</span>
        <PhonePreview channel="email" text={bodyHtml} subject={subject} />
        <p class="text-[0.625rem] text-fg-subtle mt-1.5 text-center">
          Variáveis exibidas com valores de exemplo.
        </p>
      </div>
    </>
  )
}

function ChatPanel({
  kind,
  body,
  setBody,
  varKeys,
}: {
  kind: 'whatsapp' | 'sms'
  body: string
  setBody: (s: string) => void
  varKeys: string[]
}) {
  return (
    <div class="mt-3 grid gap-3 lg:grid-cols-[1fr_280px]">
      <div>
        <span class="text-xs font-medium text-fg-muted block mb-1.5">
          {kind === 'sms' ? 'Mensagem SMS *' : 'Mensagem WhatsApp *'}
        </span>
        {kind === 'whatsapp' ? (
          <WhatsAppEditor body={body} setBody={setBody} varKeys={varKeys} />
        ) : (
          <SmsEditor body={body} setBody={setBody} varKeys={varKeys} />
        )}
      </div>
      <div class="lg:sticky lg:top-0">
        <span class="text-xs font-medium text-fg-muted block mb-1.5">Pré-visualização</span>
        <PhonePreview channel={kind} text={body} />
        <p class="text-[0.625rem] text-fg-subtle mt-1.5 text-center">
          Variáveis exibidas com valores de exemplo.
        </p>
      </div>
    </div>
  )
}

function WhatsAppEditor({
  body,
  setBody,
  varKeys,
}: {
  body: string
  setBody: (s: string) => void
  varKeys: string[]
}) {
  const taRef = useRef<HTMLTextAreaElement>(null)

  function wrapSelection(prefix: string, suffix: string = prefix) {
    const ta = taRef.current
    if (!ta) return
    const start = ta.selectionStart ?? 0
    const end = ta.selectionEnd ?? 0
    const before = body.slice(0, start)
    const selected = body.slice(start, end) || 'texto'
    const after = body.slice(end)
    const next = `${before}${prefix}${selected}${suffix}${after}`
    setBody(next)
    requestAnimationFrame(() => {
      ta.focus()
      const pos = start + prefix.length + selected.length + suffix.length
      ta.setSelectionRange(pos, pos)
    })
  }

  function insertVar(k: string) {
    const ta = taRef.current
    const token = `{{${k}}}`
    if (!ta) { setBody(body + token); return }
    const start = ta.selectionStart ?? body.length
    const end = ta.selectionEnd ?? body.length
    const next = body.slice(0, start) + token + body.slice(end)
    setBody(next)
    requestAnimationFrame(() => {
      ta.focus()
      const pos = start + token.length
      ta.setSelectionRange(pos, pos)
    })
  }

  return (
    <div class="rounded-md border border-border bg-surface overflow-hidden">
      <div class="flex flex-wrap items-center gap-0.5 px-1.5 py-1 border-b border-border bg-surface-2">
        <WaToolBtn title="Negrito" onClick={() => wrapSelection('*')}><Bold size={14} /></WaToolBtn>
        <WaToolBtn title="Itálico" onClick={() => wrapSelection('_')}><Italic size={14} /></WaToolBtn>
        <WaToolBtn title="Tachado" onClick={() => wrapSelection('~')}><Strikethrough size={14} /></WaToolBtn>
        <WaToolBtn title="Monoespaçado" onClick={() => wrapSelection('```')}><Code size={14} /></WaToolBtn>
        <span class="w-px h-4 bg-border mx-0.5" />
        <span class="text-[0.625rem] text-fg-subtle uppercase tracking-wide ml-1">Variáveis:</span>
        {varKeys.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => insertVar(k)}
            class="inline-flex items-center h-5 px-2 rounded-full text-[0.625rem] font-mono border border-info/40 bg-info/10 text-info hover:bg-info/20 transition-colors"
          >
            {`{{${k}}}`}
          </button>
        ))}
      </div>
      <textarea
        ref={taRef}
        value={body}
        onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)}
        rows={10}
        placeholder={'Olá {{nome}}! Como vai?\n\nUse *negrito*, _itálico_, ~tachado~ ou ```mono``` pra formatar.'}
        class="w-full px-3 py-2 text-sm bg-surface text-fg outline-none resize-y min-h-[180px]"
      />
    </div>
  )
}

function WaToolBtn({ children, onClick, title }: { children: preact.ComponentChildren; onClick: () => void; title: string }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={title}
      class="inline-flex items-center justify-center h-7 min-w-7 px-1.5 rounded-md text-fg-muted hover:bg-surface-3 hover:text-fg transition-colors"
    >
      {children}
    </button>
  )
}

function SmsEditor({
  body,
  setBody,
  varKeys,
}: {
  body: string
  setBody: (s: string) => void
  varKeys: string[]
}) {
  const taRef = useRef<HTMLTextAreaElement>(null)
  function insertVar(k: string) {
    const ta = taRef.current
    const token = `{{${k}}}`
    if (!ta) { setBody(body + token); return }
    const start = ta.selectionStart ?? body.length
    const end = ta.selectionEnd ?? body.length
    setBody(body.slice(0, start) + token + body.slice(end))
    requestAnimationFrame(() => {
      ta.focus()
      const pos = start + token.length
      ta.setSelectionRange(pos, pos)
    })
  }

  return (
    <div class="rounded-md border border-border bg-surface overflow-hidden">
      <div class="flex flex-wrap items-center gap-1 px-1.5 py-1 border-b border-border bg-surface-2">
        <span class="text-[0.625rem] text-fg-subtle uppercase tracking-wide ml-1">Variáveis:</span>
        {varKeys.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => insertVar(k)}
            class="inline-flex items-center h-5 px-2 rounded-full text-[0.625rem] font-mono border border-info/40 bg-info/10 text-info hover:bg-info/20 transition-colors"
          >
            {`{{${k}}}`}
          </button>
        ))}
      </div>
      <textarea
        ref={taRef}
        value={body}
        onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)}
        rows={6}
        placeholder="Olá {{nome}}, lembrete: sua reunião com {{operador}} é hoje."
        class="w-full px-3 py-2 text-sm bg-surface text-fg outline-none resize-y min-h-[120px]"
      />
      <div class="px-2 py-1.5 border-t border-border">
        <SmsCounter text={body} />
      </div>
    </div>
  )
}

function DeleteTemplateDialog({ template, onClose }: { template: MessageTemplateItem; onClose: () => void }) {
  const del = useDeleteTemplate()
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Excluir "${template.name}"`}
      description="O modelo vai para a lixeira e pode ser restaurado."
      destructive
      confirmLabel="Excluir"
      loading={del.isPending}
      onConfirm={() => del.mutate(template.id, {
        onSuccess: () => { toast('Modelo movido para a lixeira', 'success'); onClose() },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })}
    />
  )
}
