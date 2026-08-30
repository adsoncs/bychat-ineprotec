import { useState, useMemo, useRef, useEffect } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { Plus, Eye, Pencil, Trash2, Send, Upload, X as XIcon, CheckCircle, HelpCircle, RefreshCw, Cloud } from '@/components/ui/icon-set'
import { HowItWorksModal } from '@/components/ui/HowItWorksModal'
import {
  useCloudApiConnections,
  useCloudApiTemplates,
  useSyncCloudApiTemplates,
  useSendCloudApiTemplate,
  useCreateCloudApiTemplate,
  useUpdateCloudApiTemplate,
  useDeleteCloudApiTemplate,
  parseTemplateComponents,
  uploadCloudApiTemplateMedia,
  type CloudApiConnection,
  type CloudApiTemplate,
  type TemplateButton,
  type TemplateButtonType,
  type HeaderFormat,
  type CreateCloudApiTemplateInput,
} from '@/hooks/useCloudApi'
import { Page } from '@/components/ui/Page'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Input, Select } from '@/components/ui/Input'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { cloudApiTemplateCategoryLabel, cloudApiTemplateStatusLabel, cloudApiTemplateReasonLabel } from '@/lib/statusLabels'
import { toast } from '@/lib/toast'
import { onServerEvent } from '@/lib/realtime'
import { useLocation } from 'wouter-preact'

const MAX_BUTTONS = 10

type CategoryFilter = '' | 'MARKETING' | 'UTILITY' | 'AUTHENTICATION'
type StatusFilter = '' | 'APPROVED' | 'PENDING' | 'REJECTED' | 'PAUSED' | '__DELETED__'

// Estados em que a Meta segura o template após o delete (não some na hora; fica
// ~30 dias). Escondemos da lista padrão e expomos só no chip "Excluídos".
const DELETED_TPL_STATES = ['PENDING_DELETION', 'DELETED']
const DELETED_TPL_FILTER: StatusFilter = '__DELETED__'

// Tom do badge por status (espelha os estados da Meta tratados no backend).
function templateStatusTone(status: string): 'success' | 'warning' | 'danger' | 'info' {
  if (status === 'APPROVED') return 'success'
  if (status === 'PENDING' || status === 'IN_APPEAL' || status === 'FLAGGED') return 'warning'
  if (status === 'REJECTED' || status === 'DISABLED' || status === 'LIMIT_EXCEEDED' || status === 'PAUSED') return 'danger'
  return 'info'
}

export function WhatsappTemplatesPage() {
  const { data: conns, isLoading } = useCloudApiConnections()
  const { data: tpl } = useCloudApiTemplates()
  const [, navigate] = useLocation()
  const [previewTpl, setPreviewTpl] = useState<CloudApiTemplate | null>(null)
  const [sendingTpl, setSendingTpl] = useState<CloudApiTemplate | null>(null)
  const [editingTpl, setEditingTpl] = useState<CloudApiTemplate | null>(null)
  const [creatingTpl, setCreatingTpl] = useState(false)
  const [deletingTpl, setDeletingTpl] = useState<CloudApiTemplate | null>(null)
  const [tplSearch, setTplSearch] = useState('')
  const [tplCategory, setTplCategory] = useState<CategoryFilter>('')
  const [tplStatus, setTplStatus] = useState<StatusFilter>('')
  const [showHowItWorks, setShowHowItWorks] = useState(false)
  const sync = useSyncCloudApiTemplates()
  const delTpl = useDeleteCloudApiTemplate()

  // Aviso em tempo real quando a Meta aprova/reprova/pausa um template (webhook
  // message_template_status_update ou reconciliação periódica).
  useEffect(() => {
    const off = onServerEvent((ev) => {
      if (ev.type !== 'cloudapi:template_status') return
      const p = (ev.payload ?? {}) as { name?: string; status?: string; statusReason?: string }
      const label = cloudApiTemplateStatusLabel(p.status ?? '')
      if (p.status === 'APPROVED') {
        toast(`Modelo "${p.name}" foi aprovado pela Meta`, 'success')
      } else if (p.status === 'REJECTED' || p.status === 'PAUSED' || p.status === 'DISABLED') {
        const reason = p.statusReason ? ` — ${cloudApiTemplateReasonLabel(p.statusReason)}` : ''
        toast(`Modelo "${p.name}": ${label}${reason}`, 'danger')
      } else {
        toast(`Modelo "${p.name}": ${label}`, 'info')
      }
    })
    return off
  }, [])

  const tplStats = useMemo(() => {
    const all = tpl?.templates ?? []
    return {
      total: all.length,
      approved: all.filter((t) => t.status === 'APPROVED').length,
      pending: all.filter((t) => t.status === 'PENDING').length,
      rejected: all.filter((t) => t.status === 'REJECTED').length,
      // Em exclusão: a Meta mantém o template ~30 dias após o delete (PENDING_DELETION).
      deleting: all.filter((t) => DELETED_TPL_STATES.includes(t.status)).length,
    }
  }, [tpl?.templates])

  const filteredTemplates = useMemo(() => {
    let list = tpl?.templates ?? []
    const q = tplSearch.trim().toLowerCase()
    if (q) list = list.filter((t) => t.name.toLowerCase().includes(q))
    if (tplCategory) list = list.filter((t) => t.category === tplCategory)
    if (tplStatus === DELETED_TPL_FILTER) {
      // Chip "Excluídos": mostra só os que a Meta ainda segura em exclusão.
      list = list.filter((t) => DELETED_TPL_STATES.includes(t.status))
    } else if (tplStatus) {
      list = list.filter((t) => t.status === tplStatus)
    } else {
      // "Todos status" esconde os em exclusão — após excluir, somem da lista.
      list = list.filter((t) => !DELETED_TPL_STATES.includes(t.status))
    }
    return list
  }, [tpl?.templates, tplSearch, tplCategory, tplStatus])

  function handleSyncAll() {
    const wabas = Array.from(new Set((conns?.connections ?? []).map((c) => c.wabaId)))
    if (wabas.length === 0) return
    let done = 0
    let synced = 0
    wabas.forEach((wabaId) => {
      sync.mutate({ wabaId }, {
        onSuccess: (r) => { synced += r.synced; done++; if (done === wabas.length) toast(`${synced} modelos sincronizados`, 'success') },
        onError: (e: unknown) => { done++; toast((e as Error).message, 'danger') },
      })
    })
  }

  const hasConnections = (conns?.connections.length ?? 0) > 0

  return (
    <Page
      title="Modelos de Mensagem"
      description="Modelos HSM aprovados pela Meta, usados no WhatsApp API (oficial) para iniciar conversas e disparos."
      actions={
        hasConnections ? (
          <div class="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setShowHowItWorks(true)}>
              <HelpCircle size={14} /> Como funciona?
            </Button>
            <Button variant="secondary" size="sm" onClick={handleSyncAll} disabled={sync.isPending}>
              <RefreshCw size={14} class={sync.isPending ? 'animate-spin' : ''} /> Sincronizar
            </Button>
            <Button variant="primary" size="sm" onClick={() => setCreatingTpl(true)}>
              <Plus size={14} /> Novo modelo
            </Button>
          </div>
        ) : undefined
      }
    >
      {isLoading && (
        <div class="p-6 text-center text-sm text-fg-muted">Carregando…</div>
      )}

      {!isLoading && !hasConnections && (
        <EmptyState
          icon={<Cloud size={24} />}
          title="Nenhuma conta WhatsApp API conectada"
          description="Os modelos de mensagem dependem de uma conexão oficial (WABA). Conecte um número em WhatsApp API antes de criar modelos."
          action={
            <Button variant="primary" size="sm" onClick={() => navigate('/cloud-api')}>
              <Cloud size={14} /> Ir para WhatsApp API
            </Button>
          }
        />
      )}

      {!isLoading && hasConnections && (
        <Card class="p-0 overflow-hidden">
          {tpl && tpl.templates.length > 0 && (
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 p-4 border-b border-border">
              <TplKpi label="Total" value={tplStats.total} />
              <TplKpi label="Aprovados" value={tplStats.approved} tone="success" />
              <TplKpi label="Pendentes" value={tplStats.pending} tone="warning" />
              <TplKpi label="Rejeitados" value={tplStats.rejected} tone="danger" />
            </div>
          )}

          {tpl && tpl.templates.length > 0 && (
            <div class="p-4 border-b border-border flex flex-col sm:flex-row gap-2 sm:items-center flex-wrap">
              <Input
                value={tplSearch}
                onInput={(e) => setTplSearch((e.target as HTMLInputElement).value)}
                placeholder="Buscar por nome…"
                class="sm:w-56"
              />
              <div class="flex flex-wrap gap-1">
                <FilterChip label="Todas as categorias" active={tplCategory === ''} onClick={() => setTplCategory('')} />
                <FilterChip label="Marketing" active={tplCategory === 'MARKETING'} onClick={() => setTplCategory('MARKETING')} />
                <FilterChip label="Utilitário" active={tplCategory === 'UTILITY'} onClick={() => setTplCategory('UTILITY')} />
                <FilterChip label="Autenticação" active={tplCategory === 'AUTHENTICATION'} onClick={() => setTplCategory('AUTHENTICATION')} />
              </div>
              <div class="flex flex-wrap gap-1 sm:ml-auto">
                <FilterChip label="Todos status" active={tplStatus === ''} onClick={() => setTplStatus('')} />
                <FilterChip label="Aprovado" active={tplStatus === 'APPROVED'} onClick={() => setTplStatus('APPROVED')} tone="success" />
                <FilterChip label="Pendente" active={tplStatus === 'PENDING'} onClick={() => setTplStatus('PENDING')} tone="warning" />
                <FilterChip label="Rejeitado" active={tplStatus === 'REJECTED'} onClick={() => setTplStatus('REJECTED')} tone="danger" />
                {tplStats.deleting > 0 && (
                  <FilterChip label={`Excluídos (${tplStats.deleting})`} active={tplStatus === DELETED_TPL_FILTER} onClick={() => setTplStatus(DELETED_TPL_FILTER)} />
                )}
              </div>
            </div>
          )}

          {tpl && tpl.templates.length > 0 ? (
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead class="bg-surface-3 text-fg-muted text-2xs uppercase tracking-wider">
                  <tr>
                    <th class="text-left px-4 py-2 font-medium">Nome</th>
                    <th class="text-left px-4 py-2 font-medium">Idioma</th>
                    <th class="text-left px-4 py-2 font-medium">Categoria</th>
                    <th class="text-left px-4 py-2 font-medium">Status</th>
                    <th class="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-border">
                  {filteredTemplates.length === 0 && (
                    <tr>
                      <td colSpan={5} class="px-4 py-6 text-center text-sm text-fg-muted">
                        Nenhum modelo combina com os filtros.
                      </td>
                    </tr>
                  )}
                  {filteredTemplates.map((t) => (
                    <tr key={t.id} class="hover:bg-surface-3 group">
                      <td class="px-4 py-2 font-mono text-xs text-fg">{t.name}</td>
                      <td class="px-4 py-2 text-fg-muted">{t.language}</td>
                      <td class="px-4 py-2"><Badge tone="info">{cloudApiTemplateCategoryLabel(t.category)}</Badge></td>
                      <td class="px-4 py-2">
                        <Badge tone={templateStatusTone(t.status)}>
                          {cloudApiTemplateStatusLabel(t.status)}
                        </Badge>
                        {t.statusReason && t.status !== 'APPROVED' && (
                          <div class="mt-0.5 text-2xs leading-tight text-danger" title={t.statusReason}>
                            {cloudApiTemplateReasonLabel(t.statusReason)}
                          </div>
                        )}
                      </td>
                      <td class="px-4 py-2">
                        <div class="flex justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button type="button" class="size-7 rounded grid place-items-center text-fg-muted hover:text-fg hover:bg-surface-3" onClick={() => setPreviewTpl(t)} aria-label="Visualizar" title="Visualizar">
                            <Eye size={11} />
                          </button>
                          {t.status === 'APPROVED' && (
                            <button type="button" class="size-7 rounded grid place-items-center text-fg-muted hover:text-fg hover:bg-surface-3" onClick={() => setSendingTpl(t)} aria-label="Enviar" title="Enviar">
                              <Send size={11} />
                            </button>
                          )}
                          <button type="button" class="size-7 rounded grid place-items-center text-fg-muted hover:text-fg hover:bg-surface-3" onClick={() => setEditingTpl(t)} aria-label="Editar" title="Editar (cria nova versão)">
                            <Pencil size={11} />
                          </button>
                          <button type="button" class="size-7 rounded grid place-items-center text-fg-muted hover:text-danger hover:bg-surface-3" onClick={() => setDeletingTpl(t)} aria-label="Excluir" title="Excluir">
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div class="p-6 text-center text-sm text-fg-muted">
              Nenhum modelo criado. Sincronize os existentes na Meta ou crie um novo.
            </div>
          )}
        </Card>
      )}

      {previewTpl && <PreviewTemplateModal template={previewTpl} onClose={() => setPreviewTpl(null)} />}
      {sendingTpl && <SendTemplateModal template={sendingTpl} onClose={() => setSendingTpl(null)} />}
      {(creatingTpl || editingTpl) && (
        <TemplateFormModal
          template={editingTpl}
          connections={conns?.connections ?? []}
          onClose={() => { setCreatingTpl(false); setEditingTpl(null) }}
        />
      )}
      {deletingTpl && (
        <ConfirmDialog
          open
          onOpenChange={(o) => { if (!o) setDeletingTpl(null) }}
          title={`Excluir modelo "${deletingTpl.name}"`}
          description="O modelo é removido localmente e na Meta. Mensagens já enviadas com ele não são afetadas."
          destructive
          confirmLabel="Excluir"
          loading={delTpl.isPending}
          onConfirm={() => delTpl.mutate(deletingTpl.id, {
            onSuccess: () => { toast('Modelo excluído', 'success'); setDeletingTpl(null) },
            onError: (e: unknown) => toast((e as Error).message, 'danger'),
          })}
        />
      )}

      <HowItWorksModal
        open={showHowItWorks}
        onClose={() => setShowHowItWorks(false)}
        title="Como funcionam os modelos de mensagem?"
        problem={<>
          No WhatsApp API (oficial da Meta), toda mensagem que <strong>inicia</strong> uma conversa precisa
          ser um <strong>modelo aprovado</strong> (HSM). A Meta revisa o texto antes de liberar.
        </>}
        steps={[
          {
            title: '📝 Criar o modelo',
            body: <>Clique em <strong>Novo modelo</strong>, escreva o corpo, use <code>{'{{1}}'}</code> para personalização, escolha a categoria e envie para revisão da Meta.</>,
          },
          {
            title: '⏳ Aguardar aprovação',
            body: <>A Meta revisa em algumas horas. O status muda sozinho aqui (Pendente → Aprovado/Rejeitado) via webhook. Você recebe um aviso quando mudar.</>,
          },
          {
            title: '🚀 Usar o modelo',
            body: <>Modelos <strong>Aprovados</strong> podem ser enviados a leads (botão Enviar), usados em cadências/fluxos e em Disparos em Massa.</>,
          },
          {
            title: '🎯 Categorias',
            body: <>Marketing (promoção), Utilitário (transacional, ex.: confirmação) e Autenticação (códigos). A categoria afeta o preço por mensagem — utilitário custa menos que marketing.</>,
          },
        ]}
        tip={{
          tone: 'info',
          title: '💡 Excluir um modelo',
          body: <>Ao excluir, a Meta mantém modelos já usados por ~30 dias em "Exclusão pendente" — eles somem da lista, mas aparecem no chip <strong>Excluídos</strong> até a Meta purgar de vez.</>,
        }}
      />
    </Page>
  )
}

function TplKpi({ label, value, tone = 'neutral' }: { label: string; value: number; tone?: 'neutral' | 'success' | 'warning' | 'danger' }) {
  const toneCls =
    tone === 'success' ? 'text-success' :
    tone === 'warning' ? 'text-warning' :
    tone === 'danger' ? 'text-danger' : 'text-fg'
  return (
    <div class="rounded-md border border-border bg-surface-2 px-3 py-2">
      <div class="text-3xs uppercase tracking-wider text-fg-muted">{label}</div>
      <div class={`text-xl font-semibold tabular-nums ${toneCls}`}>{value}</div>
    </div>
  )
}

function FilterChip({
  label, active, onClick, tone = 'neutral',
}: {
  label: string
  active: boolean
  onClick: () => void
  tone?: 'neutral' | 'success' | 'warning' | 'danger'
}) {
  const activeCls =
    tone === 'success' ? 'bg-success/15 text-success border-success/40' :
    tone === 'warning' ? 'bg-warning/15 text-warning border-warning/40' :
    tone === 'danger' ? 'bg-danger/15 text-danger border-danger/40' :
    'bg-accent/15 text-accent border-accent/40'
  return (
    <button
      type="button"
      class={`text-2xs px-2.5 py-1 rounded-full border transition-colors ${
        active ? activeCls : 'border-border text-fg-muted hover:text-fg hover:bg-surface-3'
      }`}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

function PreviewTemplateModal({ template, onClose }: { template: CloudApiTemplate; onClose: () => void }) {
  const parsed = useMemo(() => parseTemplateComponents(template.components), [template])

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={template.name}
      description={`${template.language} · ${cloudApiTemplateCategoryLabel(template.category)} · ${cloudApiTemplateStatusLabel(template.status)}`}
      size="lg"
      footer={<Button variant="secondary" size="sm" onClick={onClose}>Fechar</Button>}
    >
      <div class="rounded-md bg-[#dcf8c6] p-3 text-sm text-fg max-w-md mx-auto" style={{ color: '#111' }}>
        {parsed.header && (
          <div class="font-semibold mb-2">
            {parsed.header.format === 'TEXT'
              ? parsed.header.text
              : <span class="text-xs italic">[Mídia: {parsed.header.format}]</span>}
          </div>
        )}
        <div class="whitespace-pre-wrap">{parsed.body}</div>
        {parsed.footer && <div class="text-xs mt-2 opacity-70">{parsed.footer}</div>}
        {parsed.buttons.length > 0 && (
          <div class="mt-3 -mx-3 -mb-3 border-t border-black/10">
            {parsed.buttons.map((b, i) => (
              <div key={i} class="px-3 py-2 text-xs text-center border-b border-black/10 last:border-0" style={{ color: '#1a73e8' }}>
                {b.text ?? b.url ?? b.phoneNumber ?? b.type}
              </div>
            ))}
          </div>
        )}
      </div>
      {parsed.variables.length > 0 && (
        <div class="text-2xs text-fg-muted mt-3">
          Variáveis no body: <code>{parsed.variables.join(', ')}</code>
        </div>
      )}
    </Modal>
  )
}

function SendTemplateModal({ template, onClose }: { template: CloudApiTemplate; onClose: () => void }) {
  const parsed = useMemo(() => parseTemplateComponents(template.components), [template])
  const [phone, setPhone] = useState('')
  const [bodyVars, setBodyVars] = useState<string[]>(() => parsed.variables.map(() => ''))
  const send = useSendCloudApiTemplate()

  function handleSubmit() {
    if (!phone.trim()) { toast('Telefone obrigatório', 'danger'); return }
    if (parsed.variables.length > 0 && bodyVars.some((v) => !v.trim())) {
      toast('Preencha todas as variáveis do body', 'danger')
      return
    }
    const components: unknown[] = []
    if (parsed.variables.length > 0) {
      components.push({
        type: 'body',
        parameters: bodyVars.map((v) => ({ type: 'text', text: v.trim() })),
      })
    }
    send.mutate({
      phone: phone.trim(),
      templateId: template.id,
      components: components.length > 0 ? components : undefined,
    }, {
      onSuccess: (r) => { toast(`Modelo enviado (id: ${r.messageId})`, 'success'); onClose() },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Enviar "${template.name}"`}
      description={`${template.language} · ${cloudApiTemplateCategoryLabel(template.category)}`}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={send.isPending}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={send.isPending}>
            {send.isPending ? 'Enviando…' : 'Enviar'}
          </Button>
        </>
      }
    >
      <div class="space-y-3">
        <Input
          label="Telefone destinatário"
          value={phone}
          onInput={(e) => setPhone((e.target as HTMLInputElement).value)}
          placeholder="5511999999999"
          hint="Inclua código do país sem '+'"
        />
        {parsed.variables.length > 0 && (
          <div class="space-y-2">
            <div class="text-xs uppercase tracking-wider text-fg-muted">Variáveis do body</div>
            {parsed.variables.map((v, i) => (
              <Input
                key={v}
                label={v}
                value={bodyVars[i] ?? ''}
                onInput={(e) => {
                  const next = [...bodyVars]
                  next[i] = (e.target as HTMLInputElement).value
                  setBodyVars(next)
                }}
              />
            ))}
          </div>
        )}
        <div class="rounded-md border border-border p-3 bg-surface text-xs text-fg-muted whitespace-pre-wrap">
          <div class="text-fg-muted text-3xs uppercase tracking-wider mb-1">Pré-visualização</div>
          {parsed.header?.format === 'TEXT' && parsed.header.text && (
            <div class="font-semibold text-fg mb-1">{interpolatePreview(parsed.header.text, bodyVars, parsed.variables)}</div>
          )}
          <div class="text-fg">{interpolatePreview(parsed.body, bodyVars, parsed.variables)}</div>
          {parsed.footer && <div class="text-2xs mt-1">{parsed.footer}</div>}
        </div>
      </div>
    </Modal>
  )
}

function interpolatePreview(text: string, values: string[], vars: string[]): string {
  let out = text
  vars.forEach((v, i) => {
    const val = values[i]
    if (val !== undefined && val !== '') {
      out = out.split(v).join(val)
    } else {
      out = out.split(v).join('___')
    }
  })
  return out
}

function TemplateFormModal({
  template, connections, onClose,
}: {
  template: CloudApiTemplate | null
  connections: CloudApiConnection[]
  onClose: () => void
}) {
  const isEdit = !!template
  const initial = useMemo(() => template ? parseTemplateComponents(template.components) : null, [template])
  const [name, setName] = useState(template?.name ?? '')
  const [language, setLanguage] = useState(template?.language ?? 'pt_BR')
  const [category, setCategory] = useState<'MARKETING' | 'UTILITY' | 'AUTHENTICATION'>(
    (template?.category as 'MARKETING' | 'UTILITY' | 'AUTHENTICATION') ?? 'MARKETING',
  )
  const [wabaId, setWabaId] = useState(template?.wabaId ?? connections[0]?.wabaId ?? '')
  const [headerFormat, setHeaderFormat] = useState<HeaderFormat>(initial?.header?.format ?? 'NONE')
  const [headerText, setHeaderText] = useState(initial?.header?.text ?? '')
  const [headerHandle, setHeaderHandle] = useState<string>('')
  const [headerHandleName, setHeaderHandleName] = useState<string>('')
  const [headerUploading, setHeaderUploading] = useState(false)
  const headerFileRef = useRef<HTMLInputElement>(null)
  const bodyTextRef = useRef<HTMLTextAreaElement>(null)
  const [bodyText, setBodyText] = useState(initial?.body ?? '')
  const [bodyExamples, setBodyExamples] = useState<string[]>([])
  const [footer, setFooter] = useState(initial?.footer ?? '')
  const [buttons, setButtons] = useState<TemplateButton[]>(initial?.buttons ?? [])
  const create = useCreateCloudApiTemplate()
  const update = useUpdateCloudApiTemplate()
  const loading = create.isPending || update.isPending

  const bodyVars = useMemo(() => {
    const m = bodyText.match(/\{\{\d+\}\}/g)
    if (!m) return [] as string[]
    return Array.from(new Set(m)).sort((a, b) => {
      const na = Number(a.replace(/\D/g, ''))
      const nb = Number(b.replace(/\D/g, ''))
      return na - nb
    })
  }, [bodyText])

  // Mantém o array de exemplos sincronizado com a quantidade de variáveis
  useEffect(() => {
    setBodyExamples((prev) => {
      const next = bodyVars.map((_, i) => prev[i] ?? '')
      return next
    })
  }, [bodyVars])

  function insertVariable() {
    const used = new Set(bodyVars.map((v) => Number(v.replace(/\D/g, ''))))
    let next = 1
    while (used.has(next)) next++
    const placeholder = `{{${next}}}`
    const ta = bodyTextRef.current
    if (ta) {
      const start = ta.selectionStart ?? bodyText.length
      const end = ta.selectionEnd ?? bodyText.length
      const newText = bodyText.slice(0, start) + placeholder + bodyText.slice(end)
      setBodyText(newText)
      // Posiciona o cursor após a variável inserida
      requestAnimationFrame(() => {
        ta.focus()
        ta.selectionStart = start + placeholder.length
        ta.selectionEnd = start + placeholder.length
      })
    } else {
      setBodyText(bodyText + placeholder)
    }
  }

  async function handleHeaderFile(ev: Event) {
    const input = ev.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    setHeaderUploading(true)
    try {
      const handle = await uploadCloudApiTemplateMedia(file)
      setHeaderHandle(handle)
      setHeaderHandleName(file.name)
      toast('Mídia carregada', 'success', 1_500)
    } catch (e: unknown) {
      toast((e as Error).message || 'Falha no upload', 'danger')
    } finally {
      setHeaderUploading(false)
      if (headerFileRef.current) headerFileRef.current.value = ''
    }
  }

  function clearHeaderHandle() {
    setHeaderHandle('')
    setHeaderHandleName('')
  }

  function addButton(type: TemplateButtonType) {
    if (buttons.length >= MAX_BUTTONS) {
      toast(`Máximo de ${MAX_BUTTONS} botões por modelo`, 'danger')
      return
    }
    setButtons((prev) => [...prev, { type, text: type === 'COPY_CODE' ? undefined : '' }])
  }

  function updateButton(idx: number, patch: Partial<TemplateButton>) {
    setButtons((prev) => prev.map((b, i) => i === idx ? { ...b, ...patch } : b))
  }

  function removeButton(idx: number) {
    setButtons((prev) => prev.filter((_, i) => i !== idx))
  }

  function handleSubmit() {
    if (!name.trim()) { toast('Nome obrigatório', 'danger'); return }
    if (!bodyText.trim()) { toast('Body obrigatório', 'danger'); return }
    if (!wabaId) { toast('Selecione uma conexão WhatsApp API', 'danger'); return }

    if (bodyVars.length > 0 && bodyExamples.some((s) => !s.trim())) {
      toast('Preencha um exemplo para cada variável do body', 'danger')
      return
    }

    if (headerFormat !== 'NONE' && headerFormat !== 'TEXT' && !isEdit && !headerHandle) {
      toast('Faça upload da mídia do header', 'danger')
      return
    }

    const payload: CreateCloudApiTemplateInput = {
      name: name.trim(),
      language,
      category,
      wabaId,
      bodyText: bodyText.trim(),
      bodyExamples: bodyVars.length > 0 ? bodyExamples.map((s) => s.trim()) : undefined,
      footer: footer.trim() || undefined,
      buttons: buttons.length > 0 ? buttons : undefined,
    }
    if (headerFormat === 'TEXT') {
      payload.header = { format: 'TEXT', text: headerText.trim() }
    } else if (headerFormat !== 'NONE') {
      payload.header = headerHandle
        ? { format: headerFormat, handle: headerHandle }
        : { format: headerFormat }
    }

    const onErr = (e: unknown) => toast((e as Error).message, 'danger')
    if (isEdit && template) {
      update.mutate({ id: template.id, ...payload }, {
        onSuccess: () => { toast('Modelo atualizado (vai para revisão na Meta)', 'success'); onClose() },
        onError: onErr,
      })
    } else {
      create.mutate(payload, {
        onSuccess: () => { toast('Modelo criado (vai para revisão na Meta)', 'success'); onClose() },
        onError: onErr,
      })
    }
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={isEdit ? `Editar "${template?.name}"` : 'Novo modelo'}
      size="xl"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={loading}>
            {loading ? 'Enviando…' : isEdit ? 'Salvar' : 'Criar modelo'}
          </Button>
        </>
      }
    >
      <div class="grid lg:grid-cols-2 gap-4">
        {/* Form */}
        <div class="space-y-4">
          <Section title="Identificação">
            <div class="grid grid-cols-2 gap-3">
              <Input
                label="Nome (slug)"
                value={name}
                onInput={(e) => setName((e.target as HTMLInputElement).value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
                placeholder="bem_vindo_2027"
                hint="lowercase, números, _ apenas"
                disabled={isEdit}
              />
              <Select label="Idioma" value={language} onChange={(e) => setLanguage((e.target as HTMLSelectElement).value)}>
                <option value="pt_BR">Português (BR)</option>
                <option value="en">English</option>
                <option value="es">Español</option>
                <option value="es_AR">Español (AR)</option>
              </Select>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <Select
                label="Categoria"
                value={category}
                onChange={(e) => setCategory((e.target as HTMLSelectElement).value as typeof category)}
              >
                <option value="MARKETING">Marketing</option>
                <option value="UTILITY">Utilitário</option>
                <option value="AUTHENTICATION">Autenticação</option>
              </Select>
              <Select label="Conexão (WABA)" value={wabaId} onChange={(e) => setWabaId((e.target as HTMLSelectElement).value)} disabled={isEdit}>
                {connections.map((c) => (
                  <option key={c.wabaId} value={c.wabaId}>{c.displayName ?? c.displayPhone} · {c.wabaId}</option>
                ))}
              </Select>
            </div>
          </Section>

          <Section title="Cabeçalho">
            <Select
              label="Formato"
              value={headerFormat}
              onChange={(e) => {
                const v = (e.target as HTMLSelectElement).value as HeaderFormat
                setHeaderFormat(v)
                if (v === 'NONE' || v === 'TEXT') clearHeaderHandle()
              }}
            >
              <option value="NONE">Sem cabeçalho</option>
              <option value="TEXT">Texto</option>
              <option value="IMAGE">Imagem</option>
              <option value="VIDEO">Vídeo</option>
              <option value="DOCUMENT">Documento</option>
            </Select>
            {headerFormat === 'TEXT' && (
              <Input
                label="Texto"
                value={headerText}
                maxLength={60}
                onInput={(e) => setHeaderText((e.target as HTMLInputElement).value)}
                placeholder="Ex.: Olá, {{1}}!"
                hint={`${headerText.length}/60 caracteres`}
              />
            )}
            {headerFormat !== 'NONE' && headerFormat !== 'TEXT' && (
              <div class="space-y-2">
                <input
                  ref={headerFileRef}
                  type="file"
                  class="hidden"
                  accept={
                    headerFormat === 'IMAGE' ? 'image/*' :
                    headerFormat === 'VIDEO' ? 'video/*' :
                    '.pdf,.doc,.docx'
                  }
                  onChange={handleHeaderFile}
                  disabled={headerUploading}
                />
                <div class="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => headerFileRef.current?.click()}
                    disabled={headerUploading}
                  >
                    <Upload size={12} /> {headerUploading ? 'Enviando…' : 'Enviar mídia'}
                  </Button>
                  {headerHandle && (
                    <span class="inline-flex items-center gap-1 text-2xs text-success">
                      <CheckCircle size={12} /> {headerHandleName || 'mídia carregada'}
                      <button
                        type="button"
                        class="text-fg-muted hover:text-danger"
                        onClick={clearHeaderHandle}
                        aria-label="Remover mídia"
                      >
                        <XIcon size={12} />
                      </button>
                    </span>
                  )}
                </div>
                <div class="text-2xs text-fg-muted">
                  A Meta exige uma mídia de exemplo para a aprovação do modelo. Em produção, cada envio pode usar uma mídia diferente.
                </div>
              </div>
            )}
          </Section>

          <Section title="Corpo (obrigatório)">
            <div class="flex items-center justify-between">
              <span class="text-2xs text-fg-muted">
                Use <code>{'{{1}}'}</code>, <code>{'{{2}}'}</code>… para personalização.
              </span>
              <Button size="sm" variant="ghost" onClick={insertVariable}>
                <Plus size={12} /> Variável
              </Button>
            </div>
            <textarea
              ref={bodyTextRef}
              value={bodyText}
              maxLength={1024}
              onInput={(e) => setBodyText((e.target as HTMLTextAreaElement).value)}
              rows={5}
              placeholder="Olá {{1}}, seu pedido {{2}} foi confirmado!"
              class="min-h-[5rem] w-full px-3 py-2 rounded-md bg-surface border border-border text-sm text-fg placeholder:text-fg-muted focus:outline-none focus:border-accent resize-y"
            />
            <div class="text-2xs text-fg-muted">{bodyText.length}/1024 caracteres</div>
            {bodyVars.length > 0 && (
              <div class="space-y-2 mt-2">
                <div class="text-2xs uppercase tracking-wider text-fg-muted">
                  Exemplos para revisão (obrigatório)
                </div>
                {bodyVars.map((v, i) => (
                  <div key={v} class="flex items-center gap-2">
                    <span class="text-2xs font-mono text-accent w-12 shrink-0">{v}</span>
                    <Input
                      class="flex-1"
                      value={bodyExamples[i] ?? ''}
                      onInput={(e) => {
                        const next = [...bodyExamples]
                        next[i] = (e.target as HTMLInputElement).value
                        setBodyExamples(next)
                      }}
                      placeholder={`Exemplo para ${v}`}
                    />
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="Rodapé (opcional)">
            <Input
              label="Texto curto"
              value={footer ?? ''}
              maxLength={60}
              onInput={(e) => setFooter((e.target as HTMLInputElement).value)}
              placeholder="Ex.: Sua Instituição · CNPJ ..."
              hint={`${(footer ?? '').length}/60 caracteres`}
            />
          </Section>

          <Section title={`Botões (${buttons.length}/${MAX_BUTTONS})`}>
            <div class="flex flex-wrap gap-1.5 mb-2">
              <Button size="sm" variant="ghost" onClick={() => addButton('QUICK_REPLY')} disabled={buttons.length >= MAX_BUTTONS}>+ Quick reply</Button>
              <Button size="sm" variant="ghost" onClick={() => addButton('URL')} disabled={buttons.length >= MAX_BUTTONS}>+ URL</Button>
              <Button size="sm" variant="ghost" onClick={() => addButton('PHONE_NUMBER')} disabled={buttons.length >= MAX_BUTTONS}>+ Telefone</Button>
              <Button size="sm" variant="ghost" onClick={() => addButton('COPY_CODE')} disabled={buttons.length >= MAX_BUTTONS}>+ Copiar código</Button>
            </div>
            <div class="space-y-2">
              {buttons.map((b, i) => (
                <div key={i} class="rounded-md border border-border p-2 bg-surface">
                  <div class="flex items-center justify-between mb-1.5">
                    <span class="text-2xs uppercase tracking-wider text-fg-muted">{b.type}</span>
                    <button
                      type="button"
                      class="text-2xs text-danger hover:underline"
                      onClick={() => removeButton(i)}
                    >
                      Remover
                    </button>
                  </div>
                  {b.type !== 'COPY_CODE' && (
                    <Input
                      label="Rótulo"
                      value={b.text ?? ''}
                      maxLength={25}
                      onInput={(e) => updateButton(i, { text: (e.target as HTMLInputElement).value })}
                      hint={`${(b.text ?? '').length}/25 caracteres`}
                    />
                  )}
                  {b.type === 'URL' && (
                    <Input
                      label="URL"
                      type="url"
                      value={b.url ?? ''}
                      onInput={(e) => updateButton(i, { url: (e.target as HTMLInputElement).value })}
                      placeholder="https://… (pode usar {{1}} no fim)"
                    />
                  )}
                  {b.type === 'PHONE_NUMBER' && (
                    <Input
                      label="Telefone (E.164)"
                      value={b.phoneNumber ?? ''}
                      onInput={(e) => updateButton(i, { phoneNumber: (e.target as HTMLInputElement).value })}
                      placeholder="+5511999999999"
                    />
                  )}
                  {b.type === 'COPY_CODE' && (
                    <Input
                      label="Código exemplo"
                      value={b.codeExample ?? ''}
                      onInput={(e) => updateButton(i, { codeExample: (e.target as HTMLInputElement).value })}
                      placeholder="PROMO2026"
                    />
                  )}
                </div>
              ))}
            </div>
          </Section>

          {isEdit && (
            <div class="text-2xs text-warning">
              Editar reenvia o modelo para revisão na Meta — pode ficar Pendente por algumas horas.
            </div>
          )}
        </div>

        {/* Pré-visualização */}
        <div class="lg:sticky lg:top-0 self-start">
          <div class="text-xs uppercase tracking-wider text-fg-muted mb-2">Pré-visualização</div>
          <div class="rounded-md p-3 text-sm" style={{ background: '#dcf8c6', color: '#111' }}>
            {headerFormat === 'TEXT' && headerText && <div class="font-semibold mb-2">{headerText}</div>}
            {headerFormat !== 'NONE' && headerFormat !== 'TEXT' && (
              <div class="aspect-video bg-black/10 rounded mb-2 grid place-items-center text-xs italic">
                [{headerFormat}]{headerHandle && ' (mídia carregada)'}
              </div>
            )}
            <div class="whitespace-pre-wrap">{bodyText || '(corpo vazio)'}</div>
            {footer && <div class="text-xs mt-2 opacity-70">{footer}</div>}
            {buttons.length > 0 && (
              <div class="mt-3 -mx-3 -mb-3 border-t border-black/10">
                {buttons.map((b, i) => (
                  <div key={i} class="px-3 py-2 text-xs text-center border-b border-black/10 last:border-0" style={{ color: '#1a73e8' }}>
                    {b.text ?? b.url ?? b.phoneNumber ?? b.codeExample ?? b.type}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}

function Section({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <div>
      <div class="text-xs uppercase tracking-wider text-fg-muted mb-2">{title}</div>
      <div class="space-y-2">{children}</div>
    </div>
  )
}
