import { useState } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import { useQueryClient } from '@tanstack/react-query'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  ArrowLeft, Mail, MessageSquare, Building2, MapPin, Star,
  MoreHorizontal, GitMerge, GraduationCap, Send, Copy, Trash2, Pencil,
  User as UserIcon, ChevronDown, Paperclip, X as XIcon, Download as DownloadIcon,
} from 'lucide-preact'
import { useLead } from '@/hooks/useLeads'
import { useAgents } from '@/hooks/useRouting'
import { useAssignTicket } from '@/hooks/useChat'
import { useUserStore } from '@/stores/user'
import { Card } from '@/components/ui/Card'
import { Modal } from '@/components/ui/Modal'
import { Input, Textarea } from '@/components/ui/Input'
import { useSendLeadEmail } from '@/hooks/useGoogle'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import {
  LeadDetailContent,
  LEAD_DETAIL_SECTIONS,
  DEFAULT_SECTION,
  isValidSection,
  useLeadActions,
  type LeadDetailSectionId,
} from '@/components/LeadDetailContent'
import { LeadDetailToc } from '@/components/LeadDetailToc'
import { useModuleAccess } from '@/hooks/usePermissions'
import { LeadOutcomeControls, OutcomeBadge } from '@/components/LeadOutcomeControls'
import { SendWhatsAppButton } from '@/components/WhatsappSend'
import { WaCallButton } from '@/components/voip/WaCallButton'
import { CallButton } from '@/components/voip/CallButton'
import { LeadExportModal } from '@/components/LeadExportModal'
import { leadSourceLabel } from '@/lib/leadSourceLabels'
import { formatDateTime } from '@/lib/format'
import { toast } from '@/lib/toast'
import { ApiError } from '@/lib/apiClient'
import { cn } from '@/lib/cn'

interface Props {
  params: { id: string; section?: string }
}

export function LeadDetailPage({ params }: Props) {
  const [, navigate] = useLocation()
  const id = Number(params.id)
  const valid = Number.isFinite(id) && id > 0
  const { data: lead, isLoading } = useLead(valid ? id : 0)

  // Resolve seção a partir da URL — fallback pra DEFAULT_SECTION quando inválida
  const section: LeadDetailSectionId = isValidSection(params.section)
    ? params.section
    : DEFAULT_SECTION

  // Seções com `module` só aparecem quando o módulo está ativo (ex.: Negociação).
  const negActive = useModuleAccess('negotiations').status === 'allowed'
  const tocSections = LEAD_DETAIL_SECTIONS.filter((s) => !(s as { module?: string }).module || negActive)

  const actions = useLeadActions(id, lead, {
    onLeadDeleted: () => navigate('/leads'),
    onLeadDuplicated: (newId) => navigate(`/leads/${newId}`),
  })

  if (!valid) {
    return (
      <div class="space-y-4">
        <Button variant="secondary" size="sm" onClick={() => navigate('/leads')}>
          <ArrowLeft size={12} /> Voltar para Leads
        </Button>
        <Card>
          <p class="text-sm text-fg-muted">ID inválido.</p>
        </Card>
      </div>
    )
  }

  const sectionLabel = LEAD_DETAIL_SECTIONS.find((s) => s.id === section)?.label ?? ''

  return (
    <div class="space-y-4">
      {/* Botão voltar fixo no topo */}
      <Button variant="ghost" size="sm" onClick={() => navigate('/leads')} class="-ml-2">
        <ArrowLeft size={14} />
        <span class="text-xs">Voltar para Leads</span>
      </Button>

      <LeadHeader
        id={id}
        lead={lead}
        isLoading={isLoading}
        actions={actions}
      />

      <div class="grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-6 items-start">
        <aside class="hidden lg:block">
          <LeadDetailToc
            items={tocSections.map((s) => ({ id: s.id, label: s.label }))}
            leadId={id}
            active={section}
          />
        </aside>
        <main class="min-w-0">
          <Card>
            <div class="flex items-center justify-between gap-2 mb-4 pb-2 border-b border-border">
              <h2 class="text-base font-semibold text-fg">{sectionLabel}</h2>
              <SectionPicker section={section} leadId={id} />
            </div>
            <LeadDetailContent id={id} section={section} />
          </Card>
        </main>
      </div>

      {actions.dialogs}
    </div>
  )
}

// ─── Picker mobile (fallback ao TOC quando lg:hidden) ────────────

function SectionPicker({ section, leadId }: { section: LeadDetailSectionId; leadId: number }) {
  const [, navigate] = useLocation()
  const negActive = useModuleAccess('negotiations').status === 'allowed'
  const sections = LEAD_DETAIL_SECTIONS.filter((s) => !(s as { module?: string }).module || negActive)
  return (
    <select
      class="lg:hidden h-8 px-2 rounded-md border border-border bg-surface text-xs text-fg"
      value={section}
      onChange={(e) => navigate(`/leads/${leadId}/${(e.target as HTMLSelectElement).value}`)}
    >
      {sections.map((s) => (
        <option key={s.id} value={s.id}>{s.label}</option>
      ))}
    </select>
  )
}

// ─── Header com avatar, info chave e ações ────────────────────────

interface HeaderProps {
  id: number
  lead: ReturnType<typeof useLead>['data']
  isLoading: boolean
  actions: ReturnType<typeof useLeadActions>
}

function LeadHeader({ id, lead, isLoading, actions }: HeaderProps) {
  const [exportOpen, setExportOpen] = useState(false)
  if (isLoading || !lead) {
    return <Skeleton class="h-32 w-full" />
  }

  const title = lead.nome || lead.empresa || `Lead #${id}`
  const subtitle = lead.nome && lead.empresa ? lead.empresa : null
  const score = lead.scores?.geral
  const tags = lead.tags ?? []
  const initials = (title.trim().charAt(0) || '?').toUpperCase()

  return (
    <Card class="!p-0 overflow-hidden">
      <div class="p-5 flex items-start gap-5">
        <div class="shrink-0">
          <div class="size-14 rounded-xl bg-gradient-to-br from-accent/30 to-accent/10 grid place-items-center text-xl font-semibold text-fg ring-1 ring-border">
            {initials}
          </div>
        </div>

        <div class="min-w-0 flex-1 space-y-2">
          <div>
            <h1 class="text-xl font-semibold text-fg leading-tight truncate">{title}</h1>
            {subtitle && (
              <p class="text-sm text-fg-muted truncate">{subtitle}</p>
            )}
          </div>

          <div class="flex items-center gap-2 flex-wrap text-xs">
            <code class="text-fg-subtle">{lead.uid ?? `#${id}`}</code>
            <span class="inline-flex items-center px-2 h-5 rounded-md border border-info/40 bg-info/15 text-info font-medium">
              {lead.status ?? 'NOVO'}
            </span>
            {lead.qualifiedAt && (
              <span class="inline-flex items-center gap-1 px-2 h-5 rounded-md border border-warning/40 bg-warning/15 text-warning font-medium">
                <Star size={10} /> Qualificado
              </span>
            )}
            <OutcomeBadge outcome={lead.outcome} lostReason={lead.lostReason ?? null} note={lead.outcomeNote} />
            <LeadOwnerBadge leadId={id} assignedUser={lead.assignedUser} />
            <span class="text-fg-subtle">·</span>
            <span class="text-fg-muted">{leadSourceLabel(lead.source)}</span>
            <span class="text-fg-subtle">·</span>
            <span class="text-fg-muted">criado {formatDateTime(lead.createdAt)}</span>
          </div>

          <div class="flex items-center gap-3 flex-wrap text-xs">
            <ContactChip icon={MessageSquare} value={lead.whatsapp} label="WhatsApp" />
            <ContactChip icon={Mail} value={lead.email} label="E-mail" />
            <ContactChip icon={Building2} value={lead.empresa} label="Empresa" copyable={false} />
            <ContactChip icon={MapPin} value={lead.cidade} label="Cidade" copyable={false} />
          </div>

          {tags.length > 0 && (
            <div class="flex flex-wrap gap-1 pt-1">
              {tags.map(({ tag }) => (
                <span
                  key={tag.id}
                  class="inline-flex items-center gap-1 h-5 px-1.5 rounded-full text-[0.6875rem] font-medium"
                  style={{ background: `${tag.color}22`, color: tag.color }}
                >
                  <span class="size-1.5 rounded-full" style={{ background: tag.color }} />
                  {tag.name}
                </span>
              ))}
            </div>
          )}
        </div>

        {score !== undefined && score !== null && (
          <div class="shrink-0 text-right">
            <p class="text-[0.625rem] font-medium uppercase tracking-wider text-fg-subtle">Score</p>
            <div class="flex items-baseline gap-1 justify-end">
              <span class="text-3xl font-semibold text-fg tabular-nums leading-none">{Math.round(score)}</span>
              <span class="text-xs text-fg-muted">/100</span>
            </div>
          </div>
        )}
      </div>

      <div class="flex items-center gap-2 px-5 py-2.5 border-t border-border bg-surface-2/30 flex-wrap">
        {!actions.isQualified ? (
          <Button
            variant="primary"
            size="sm"
            onClick={actions.actions.qualify}
            disabled={actions.isPending.qualify}
          >
            <Star size={12} /> Qualificar
          </Button>
        ) : (
          <span class="inline-flex items-center gap-1.5 text-xs text-warning">
            <Star size={12} /> Lead qualificado
          </span>
        )}

        <span class="h-5 w-px bg-border mx-1" />

        <LeadOutcomeControls
          leadId={id}
          outcome={lead.outcome}
          outcomeAt={lead.outcomeAt}
          outcomeByUser={lead.outcomeByUser ?? null}
          outcomeNote={lead.outcomeNote}
          lostReason={lead.lostReason ?? null}
        />

        <span class="h-5 w-px bg-border mx-1" />

        <SendWhatsAppButton leadId={id} whatsapp={lead.whatsapp} />

        <SendEmailButton leadId={id} email={lead.email} />


        <WaCallButton leadId={id} phone={lead.whatsapp ?? ''} label="Ligar com WhatsApp" />

        <CallButton leadId={id} phone={lead.whatsapp} label="Ligar com VoIP" />

        <Button variant="secondary" size="sm" onClick={() => setExportOpen(true)} title="Exportar todos os dados deste lead">
          <DownloadIcon size={14} /> Exportar
        </Button>

        <div class="ml-auto">
          <ActionsMenu actions={actions} />
        </div>
      </div>

      {exportOpen && (
        <LeadExportModal leadIds={[id]} open={exportOpen} onClose={() => setExportOpen(false)} />
      )}
    </Card>
  )
}

const MAX_EMAIL_ATTACH_TOTAL = 18 * 1024 * 1024 // 18MB (teto seguro p/ o Gmail)

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function SendEmailButton({ leadId, email }: { leadId: number; email: string | null | undefined }) {
  const [open, setOpen] = useState(false)
  const [to, setTo] = useState(email || '')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const send = useSendLeadEmail(leadId)

  const totalBytes = files.reduce((s, f) => s + f.size, 0)

  function openModal() {
    setTo(email || '')
    setSubject('')
    setBody('')
    setFiles([])
    setOpen(true)
  }

  function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return
    const incoming = Array.from(list)
    setFiles((prev) => {
      // dedup por nome+tamanho
      const seen = new Set(prev.map((f) => `${f.name}:${f.size}`))
      const merged = [...prev]
      for (const f of incoming) {
        if (f.size > 15 * 1024 * 1024) { toast(`"${f.name}" excede 15MB e foi ignorado`, 'danger'); continue }
        if (!seen.has(`${f.name}:${f.size}`)) merged.push(f)
      }
      if (merged.reduce((s, f) => s + f.size, 0) > MAX_EMAIL_ATTACH_TOTAL) {
        toast('Os anexos somam mais de 18MB — remova algum arquivo', 'danger')
        return prev
      }
      return merged
    })
  }

  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx))
  }

  async function handleSend() {
    if (!to.trim() || !subject.trim() || !body.trim()) { toast('Preencha destinatário, assunto e mensagem', 'danger'); return }
    if (totalBytes > MAX_EMAIL_ATTACH_TOTAL) { toast('Os anexos somam mais de 18MB', 'danger'); return }
    try {
      const r = await send.mutateAsync({ to: to.trim(), subject: subject.trim(), body: body.trim(), files: files.length ? files : undefined })
      const n = (r as any)?.attachments || 0
      toast(n > 0 ? `E-mail enviado com ${n} anexo(s) e registrado nas atividades` : 'E-mail enviado e registrado nas atividades', 'success')
      setOpen(false)
    } catch (e: unknown) {
      toast((e as Error).message, 'danger')
    }
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={openModal} disabled={!email} title={email ? 'Enviar e-mail' : 'Lead sem e-mail'}>
        <Mail size={12} /> Enviar e-mail
      </Button>
      {open && (
        <Modal
          open
          onOpenChange={(o) => { if (!o) setOpen(false) }}
          title="Enviar e-mail"
          description="Enviado pela caixa da empresa (Gmail). A resposta do cliente é registrada nas atividades."
          size="lg"
          footer={
            <>
              <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={send.isPending}>Cancelar</Button>
              <Button variant="primary" size="sm" onClick={handleSend} disabled={send.isPending}>
                {send.isPending ? 'Enviando…' : 'Enviar'}
              </Button>
            </>
          }
        >
          <div class="space-y-3">
            <Input label="Para" value={to} onInput={(e) => setTo((e.target as HTMLInputElement).value)} placeholder="cliente@email.com" />
            <Input label="Assunto" value={subject} onInput={(e) => setSubject((e.target as HTMLInputElement).value)} />
            <Textarea label="Mensagem" value={body} onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)} rows={8} />
            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <label class="text-xs font-medium text-fg-muted">Anexos</label>
                <label class="inline-flex items-center gap-1 text-xs text-primary cursor-pointer hover:underline">
                  <Paperclip size={12} /> Adicionar arquivos
                  <input
                    type="file"
                    multiple
                    class="hidden"
                    onChange={(e) => { const el = e.target as HTMLInputElement; addFiles(el.files); el.value = '' }}
                  />
                </label>
              </div>
              {files.length > 0 && (
                <ul class="space-y-1">
                  {files.map((f, i) => (
                    <li key={`${f.name}:${f.size}:${i}`} class="flex items-center justify-between gap-2 rounded-md border border-border bg-bg-subtle px-2 py-1 text-xs">
                      <span class="flex items-center gap-1.5 min-w-0">
                        <Paperclip size={12} class="text-fg-subtle shrink-0" />
                        <span class="truncate">{f.name}</span>
                        <span class="text-fg-subtle shrink-0">({fmtBytes(f.size)})</span>
                      </span>
                      <button type="button" class="text-fg-subtle hover:text-danger shrink-0" onClick={() => removeFile(i)} title="Remover">
                        <XIcon size={13} />
                      </button>
                    </li>
                  ))}
                  <li class="text-right text-[0.6875rem] text-fg-subtle">Total: {fmtBytes(totalBytes)} / 18 MB</li>
                </ul>
              )}
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}

function ContactChip({
  icon: Icon, value, label, copyable = true,
}: {
  icon: any
  value: string | null | undefined
  label: string
  copyable?: boolean
}) {
  if (!value) return null
  if (!copyable) {
    return (
      <span class="inline-flex items-center gap-1.5 text-fg">
        <Icon size={12} class="text-fg-subtle shrink-0" />
        <span class="truncate max-w-[16rem]">{value}</span>
      </span>
    )
  }
  return (
    <button
      type="button"
      class="inline-flex items-center gap-1.5 px-2 h-6 rounded-md hover:bg-surface-3 transition-colors text-fg"
      onClick={() => { navigator.clipboard.writeText(value).catch(() => {}) }}
      title={`Copiar ${label}`}
    >
      <Icon size={12} class="text-fg-subtle shrink-0" />
      <span class="truncate max-w-[16rem]">{value}</span>
    </button>
  )
}

// ─── Menu kebab com ações secundárias ─────────────────────────────

/**
 * Adia a execução pra o próximo tick — necessário pra abrir Modal a partir de
 * DropdownMenu.Item, senão o auto-close do menu compete com a abertura do modal
 * e o modal acaba fechando junto (ou nem abre).
 */
function deferred(fn: () => void) {
  return () => { setTimeout(fn, 0) }
}

function ActionsMenu({ actions }: { actions: ReturnType<typeof useLeadActions> }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          class="inline-flex items-center gap-1 h-8 px-2.5 rounded-md text-xs font-medium border border-border hover:bg-surface-3 transition-colors text-fg"
          aria-label="Mais ações"
        >
          <MoreHorizontal size={14} /> Ações
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          class="min-w-[14rem] rounded-lg bg-surface-2 border border-border shadow-xl p-1"
          style={{ zIndex: 'var(--z-popover)' }}
        >
          <MenuItem onSelect={deferred(actions.actions.edit)} icon={Pencil}>
            Editar lead
          </MenuItem>
          <MenuItem onSelect={deferred(actions.actions.merge)} icon={GitMerge}>
            Mesclar duplicatas
          </MenuItem>
          <MenuItem onSelect={deferred(actions.actions.duplicate)} icon={Copy}>
            Duplicar lead
          </MenuItem>
          {actions.isEnrollmentLead && (
            <MenuItem
              onSelect={actions.actions.enrollmentLink}
              icon={GraduationCap}
              disabled={actions.isPending.enrollLink}
            >
              {actions.isPending.enrollLink ? 'Buscando link…' : 'Link de matrícula'}
            </MenuItem>
          )}
          {actions.isWebChat && (
            <MenuItem
              onSelect={actions.actions.resendReport}
              icon={Send}
              disabled={actions.isPending.resendReport}
            >
              {actions.isPending.resendReport ? 'Enviando…' : 'Reenviar relatório'}
            </MenuItem>
          )}
          <DropdownMenu.Separator class="h-px bg-border my-1" />
          <MenuItem onSelect={deferred(actions.actions.delete)} icon={Trash2} destructive>
            Excluir lead
          </MenuItem>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

// ─── Badge de responsável (admin pode trocar) ─────────────────────

const OWNER_BADGE_BASE = 'inline-flex items-center gap-1 px-2 h-5 rounded-md font-medium'

function LeadOwnerBadge({
  leadId,
  assignedUser,
}: {
  leadId: number
  assignedUser: { id: number; name: string; email?: string } | null | undefined
}) {
  const me = useUserStore((s) => s.user)
  const canChange = me?.role === 'SUPERADMIN' || me?.role === 'ADMIN'
  const hasOwner = !!assignedUser
  const label = assignedUser?.name || assignedUser?.email || 'Sem responsável'
  const badgeClass = cn(
    OWNER_BADGE_BASE,
    hasOwner
      ? 'border border-accent/40 bg-accent/10 text-accent'
      : 'border border-border bg-surface-3 text-fg-muted',
  )

  if (!canChange) {
    return (
      <span class={badgeClass} title={label}>
        <UserIcon size={10} />
        <span class="truncate max-w-[10rem]">{label}</span>
      </span>
    )
  }
  return (
    <LeadOwnerPicker
      leadId={leadId}
      assignedUser={assignedUser ?? null}
      badgeClass={badgeClass}
      label={label}
    />
  )
}

function LeadOwnerPicker({
  leadId,
  assignedUser,
  badgeClass,
  label,
}: {
  leadId: number
  assignedUser: { id: number; name: string; email?: string } | null
  badgeClass: string
  label: string
}) {
  const [open, setOpen] = useState(false)
  const { data: agentsData, isLoading } = useAgents()
  const assign = useAssignTicket()
  const qc = useQueryClient()

  const candidates = (agentsData?.agents ?? []).filter((a) => a.active && a.role !== 'VIEWER')

  const handleAssign = async (userId: number | null) => {
    try {
      await assign.mutateAsync({ leadId, userId })
      await qc.invalidateQueries({ queryKey: ['lead', leadId] })
      void qc.invalidateQueries({ queryKey: ['leads'] })
      void qc.invalidateQueries({ queryKey: ['kanban'] })
      toast(userId === null ? 'Responsável removido' : 'Responsável alterado', 'success')
      setOpen(false)
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Falha ao atribuir'
      toast(msg, 'danger')
    }
  }

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          class={cn(badgeClass, 'hover:opacity-80 cursor-pointer')}
          title="Alterar responsável"
        >
          <UserIcon size={10} />
          <span class="truncate max-w-[10rem]">{label}</span>
          <ChevronDown size={10} class="opacity-70" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          class="min-w-[18rem] max-h-[22rem] overflow-y-auto rounded-lg bg-surface-2 border border-border shadow-xl p-1"
          style={{ zIndex: 'var(--z-popover)' }}
        >
          <div class="px-2 py-1.5 text-[0.625rem] font-medium uppercase tracking-wider text-fg-subtle">
            Atribuir responsável
          </div>
          {isLoading && (
            <div class="px-2 py-2 text-xs text-fg-muted">Carregando agentes…</div>
          )}
          {!isLoading && candidates.length === 0 && (
            <div class="px-2 py-2 text-xs text-fg-muted">Nenhum agente disponível</div>
          )}
          {candidates.map((a) => {
            const isCurrent = a.id === assignedUser?.id
            return (
              <DropdownMenu.Item
                key={a.id}
                class={cn(
                  'flex items-center gap-2 h-9 px-2.5 rounded text-sm cursor-pointer outline-none',
                  'text-fg hover:bg-surface-3 data-[highlighted]:bg-surface-3',
                  isCurrent && 'bg-accent/10',
                  assign.isPending && 'opacity-50 pointer-events-none',
                )}
                onSelect={(e) => {
                  e.preventDefault()
                  if (!isCurrent) void handleAssign(a.id)
                }}
              >
                <UserIcon size={12} class="text-fg-subtle shrink-0" />
                <span class="flex-1 truncate">{a.name}</span>
                <span class="text-[0.625rem] text-fg-subtle uppercase tracking-wider">{a.role}</span>
                {isCurrent && <span class="text-[0.625rem] text-accent font-medium">atual</span>}
              </DropdownMenu.Item>
            )
          })}
          {assignedUser && (
            <>
              <DropdownMenu.Separator class="h-px bg-border my-1" />
              <DropdownMenu.Item
                class={cn(
                  'flex items-center gap-2 h-9 px-2.5 rounded text-sm cursor-pointer outline-none',
                  'text-danger hover:bg-danger/10 data-[highlighted]:bg-danger/10',
                  assign.isPending && 'opacity-50 pointer-events-none',
                )}
                onSelect={(e) => {
                  e.preventDefault()
                  void handleAssign(null)
                }}
              >
                <Trash2 size={12} class="text-danger shrink-0" />
                Remover responsável
              </DropdownMenu.Item>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function MenuItem({
  icon: Icon, children, onSelect, destructive, disabled,
}: {
  icon: any
  children: preact.ComponentChildren
  onSelect: () => void
  destructive?: boolean
  disabled?: boolean
}) {
  return (
    <DropdownMenu.Item
      class={cn(
        'flex items-center gap-2.5 h-9 px-2.5 rounded text-sm cursor-pointer outline-none',
        destructive
          ? 'text-danger hover:bg-danger/10 data-[highlighted]:bg-danger/10'
          : 'text-fg hover:bg-surface-3 data-[highlighted]:bg-surface-3',
        disabled && 'opacity-50 pointer-events-none',
      )}
      onSelect={() => { if (!disabled) onSelect() }}
    >
      <Icon size={14} class={destructive ? 'text-danger' : 'text-fg-subtle'} />
      {children}
    </DropdownMenu.Item>
  )
}
