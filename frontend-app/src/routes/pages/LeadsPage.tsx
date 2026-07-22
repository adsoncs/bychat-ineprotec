import { useState, useMemo, useEffect, useRef } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import { useQueryClient } from '@tanstack/react-query'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  Plus, Users, Filter as FilterIcon, X as XIcon, Columns3, Trash2, ArrowRight,
  Copy, Tag as TagIcon, GitMerge, KanbanSquare, Check, Star, StarOff, GraduationCap, Send,
  ClipboardCopy, MoreHorizontal, Eye, FileText, Pencil, MessageCircle, Trophy, XCircle, HelpCircle,
  Sparkles, RefreshCw, UserPlus, ArrowRightLeft, Download as DownloadIcon,
} from 'lucide-preact'
import { api } from '@/lib/apiClient'
import { useAgents } from '@/hooks/useRouting'
import { useTeams, useTeamMembers } from '@/hooks/useTeams'
import { TransferLeadModal } from '@/components/routing/TransferLeadModal'
import { HowItWorksModal } from '@/components/ui/HowItWorksModal'
import { OutcomeBadge } from '@/components/LeadOutcomeControls'
import { useBulkMarkWon, useBulkMarkLost, useLossReasons } from '@/hooks/useLeadOutcome'
import {
  useLeads,
  useCreateManualLead,
  useDeleteLead,
  getRegistrationConflict,
  useLeadNotes,
  useCreateLeadNote,
  useLead,
  useLeadHistory,
  useUpdateLeadStatus,
  useUpdateLeadContact,
  useUpdateLeadCustomFields,
  useBulkUpdateLeadsStatus,
  useBulkDeleteLeads,
  useDuplicateLead,
  useSendLeadsToKanban,
  useAddLeadTags,
  useRemoveLeadTag,
  useBulkLeadTags,
  useLeadDuplicates,
  useQualifyLead,
  useUnqualifyLead,
  useResendLeadReport,
  useRescoreLeadAi,
  useLeadSources,
  type AiScoreReason,
  type LeadListItem,
  type LeadsListFilters,
  type ManualLeadInput,
  type LeadHistoryEvent,
  type LeadContactInput,
} from '@/hooks/useLeads'
import { WhatsappChoiceModal, SendWhatsAppButton } from '@/components/WhatsappSend'
import { useFunnel, useFunnels, useFunnels as useFunnelsQuery, useStages } from '@/hooks/useFunnels'
import { useLeadActivities, type Activity, type ActivityType } from '@/hooks/useActivities'
import { useAppliedFilter, useSetAppliedFilter, useResetAppliedFilter } from '@/hooks/useSavedFilters'
import { useUserStore } from '@/stores/user'
import { SavedFiltersBar } from '@/components/leads/SavedFiltersBar'
import {
  ActivityRow,
  DeleteActivityDialog,
  CreateActivityModal,
  EditActivityModal,
  ACTIVITY_TYPE_META,
  isActivityOverdue,
} from '@/routes/pages/ActivitiesPage'
import { IntelLeadDetail } from '@/components/intelligence/IntelLeadDetail'
import { useEnrollmentLinkByLead } from '@/hooks/useEnrollmentPortals'
import { useCustomFields } from '@/hooks/useCustomFields'
import { useTags } from '@/hooks/useTags'
import { Page } from '@/components/ui/Page'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { SearchInput } from '@/components/ui/SearchInput'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { MergeLeadsModal } from '@/components/MergeLeadsModal'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { LeadsColumnsModal } from '@/components/LeadsColumnsModal'
import { LeadCadencesTab } from '@/components/LeadCadencesTab'
import { LeadNegotiationTab } from '@/components/LeadNegotiationTab'
import { useModuleAccess } from '@/hooks/usePermissions'
import { ScoreByPillar } from '@/components/ScoreByPillar'
import { useLeadsColumnsStore, LEAD_COLUMN_LABELS, type LeadColumnKey } from '@/stores/leadsColumns'
import { formatDateTime } from '@/lib/format'
import { LeadStatusBadge } from '@/components/LeadStatusBadge'
import { leadSourceLabel } from '@/lib/leadSourceLabels'
import { toast } from '@/lib/toast'
import { LeadExportModal } from '@/components/LeadExportModal'
import { cn } from '@/lib/cn'

const DEFAULT_PAGE_SIZE = 50

export function LeadsPage() {
  const [filters, setFilters] = useState<LeadsListFilters>(() => {
    const base: LeadsListFilters = {
      limit: DEFAULT_PAGE_SIZE, offset: 0, sortBy: 'createdAt', sortDir: 'desc',
    }
    if (typeof window !== 'undefined' && window.location.search) {
      const sp = new URLSearchParams(window.location.search)
      const source = sp.get('source')
      if (source) base.source = source
      const dateFrom = sp.get('dateFrom')
      if (dateFrom) base.dateFrom = dateFrom
      const dateTo = sp.get('dateTo')
      if (dateTo) base.dateTo = dateTo
      const stageKey = sp.get('stageKey')
      if (stageKey) base.stageKey = stageKey
      const funnelIdStr = sp.get('funnelId')
      if (funnelIdStr) {
        const fid = parseInt(funnelIdStr, 10)
        if (Number.isInteger(fid)) base.funnelId = fid
      }
    }
    return base
  })
  const [creating, setCreating] = useState(false)
  const [, navigate] = useLocation()

  // Abre o detalhe do lead na página dedicada `/app/leads/:id`.
  // O modal antigo continua sendo usado por Kanban e widgets do dashboard
  // (preview rápido).
  function openLead(id: number) {
    navigate(`/leads/${id}`)
  }
  const [showFilters, setShowFilters] = useState(false)
  const [showColumns, setShowColumns] = useState(false)
  const [showHowItWorks, setShowHowItWorks] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [bulkTagOpen, setBulkTagOpen] = useState(false)
  const [bulkKanbanOpen, setBulkKanbanOpen] = useState(false)
  const [bulkWonOpen, setBulkWonOpen] = useState(false)
  const [bulkLostOpen, setBulkLostOpen] = useState(false)
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false)
  const [bulkExportOpen, setBulkExportOpen] = useState(false)
  const [editLeadId, setEditLeadId] = useState<number | null>(null)
  const [answersLeadId, setAnswersLeadId] = useState<number | null>(null)
  const [whatsappLead, setWhatsappLead] = useState<{ id: number; whatsapp: string | null } | null>(null)
  const [confirmDeleteLead, setConfirmDeleteLead] = useState<{ id: number; label: string } | null>(null)
  const [forceDeleteReg, setForceDeleteReg] = useState<number | null>(null)
  const [transferLead, setTransferLead] = useState<{ id: number; label: string } | null>(null)
  const [moveToKanbanLead, setMoveToKanbanLead] = useState<number | null>(null)

  // Filtros persistidos: ao montar carrega 1x o filtro corrente do operador
  // (sobrevive a logout/relogin). Cada mudança subsequente faz PUT debounced.
  const currentUser = useUserStore((s) => s.user)
  const currentUserId = currentUser?.id != null ? Number(currentUser.id) : undefined
  const appliedFilterQ = useAppliedFilter('leads')
  const setAppliedMut = useSetAppliedFilter()
  const resetAppliedMut = useResetAppliedFilter()
  const appliedHydratedRef = useRef(false)

  useEffect(() => {
    // Hidrata 1x quando a query terminar. URL params já lidos no init têm prioridade
    // — fazem override sobre o filtro persistido (compartilhar link continua funcionando).
    if (appliedHydratedRef.current) return
    if (appliedFilterQ.isLoading) return
    const persisted = appliedFilterQ.data?.filters as Partial<LeadsListFilters> | null | undefined
    if (persisted && typeof persisted === 'object') {
      setFilters((curr) => ({ ...persisted, ...curr, limit: curr.limit, offset: 0, sortBy: curr.sortBy, sortDir: curr.sortDir }))
    }
    appliedHydratedRef.current = true
  }, [appliedFilterQ.isLoading, appliedFilterQ.data])

  useEffect(() => {
    // Não persiste antes de hidratar (evita sobrescrever com state default vazio).
    if (!appliedHydratedRef.current) return
    // Debounce 400ms — evita salvar a cada tecla na busca.
    const handle = setTimeout(() => {
      // Não persiste paginação/ordenação — essas são efêmeras.
      const { limit: _l, offset: _o, sortBy: _sb, sortDir: _sd, search: _s, ...rest } = filters
      setAppliedMut.mutate({ scope: 'leads', filters: rest as Record<string, unknown> })
    }, 400)
    return () => clearTimeout(handle)
  }, [filters])

  function applyFromSaved(saved: Record<string, unknown>) {
    setFilters((curr) => ({
      // mantém paginação/ordenação/busca local
      limit: curr.limit, offset: 0, sortBy: curr.sortBy, sortDir: curr.sortDir, search: curr.search,
      ...(saved as Partial<LeadsListFilters>),
    }))
  }

  function resetAllFilters() {
    setFilters((curr) => ({
      limit: curr.limit, offset: 0, sortBy: curr.sortBy, sortDir: curr.sortDir,
    }))
    resetAppliedMut.mutate({ scope: 'leads' })
  }

  const { data, isLoading, error } = useLeads(filters)
  const delMut = useDeleteLead()
  const resendReportMut = useResendLeadReport()

  function toggleSelected(id: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (!data) return
    const allIds = data.leads.map((l) => l.id)
    const allSelected = allIds.every((id) => selected.has(id))
    setSelected((prev) => {
      const next = new Set(prev)
      if (allSelected) allIds.forEach((id) => next.delete(id))
      else allIds.forEach((id) => next.add(id))
      return next
    })
  }

  function patchFilters(p: Partial<LeadsListFilters>) {
    setFilters((f) => ({ ...f, ...p, offset: 0 }))
  }

  const activeFilterCount =
    (filters.search ? 1 : 0) +
    (filters.status ? 1 : 0) +
    (filters.funnelId !== undefined ? 1 : 0) +
    (filters.outcome ? 1 : 0) +
    (filters.aiScoreLabel ? 1 : 0) +
    (filters.source || (filters.sources && filters.sources.length > 0) ? 1 : 0) +
    (filters.dateFrom || filters.dateTo ? 1 : 0) +
    (filters.stageKey || filters.stageEnteredFrom || filters.stageEnteredTo ? 1 : 0) +
    ((filters.tagIds?.length ?? 0) > 0 ? 1 : 0) +
    (filters.assignedUserId !== undefined || (filters.assignedUserIds && filters.assignedUserIds.length > 0) || filters.onlyUnassigned ? 1 : 0)

  return (
    <Page
      title="Leads"
      description="Lista de leads qualificados."
      actions={
        <>
          <Button variant="ghost" size="sm" onClick={() => setShowHowItWorks(true)}>
            <HelpCircle size={14} /> Como funciona?
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setShowColumns(true)}>
            <Columns3 size={14} /> Colunas
          </Button>
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            <Plus size={14} /> Novo lead
          </Button>
        </>
      }
    >
      <div class="flex items-center gap-3 flex-wrap">
        <SearchInput
          value={filters.search ?? ''}
          onChange={(v) => patchFilters({ search: v || undefined })}
          placeholder="Buscar por empresa, nome, e-mail, WhatsApp…"
          class="w-full sm:max-w-md"
        />
        <QuickStageFilter
          funnelId={filters.funnelId}
          value={filters.status}
          onChange={(v) => patchFilters({ status: v })}
        />
        <Button variant="secondary" size="sm" onClick={() => setShowFilters((v) => !v)}>
          <FilterIcon size={14} />
          Filtros{activeFilterCount > 0 && <Badge tone="accent">{activeFilterCount}</Badge>}
        </Button>
        <SavedFiltersBar
          scope="leads"
          currentFilters={(({ limit: _l, offset: _o, sortBy: _sb, sortDir: _sd, search: _s, ...rest }) => rest as Record<string, unknown>)(filters)}
          hasActiveFilters={activeFilterCount > 0}
          onApply={applyFromSaved}
          onReset={resetAllFilters}
          currentUserId={currentUserId}
        />
        {filters.source && (
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-3/60 px-2.5 py-1 text-xs text-fg hover:bg-surface-3"
            title="Limpar filtro de origem"
            onClick={() => patchFilters({ source: undefined })}
          >
            <span class="text-fg-muted">Origem:</span>
            <span class="font-medium">{leadSourceLabel(filters.source)}</span>
            <XIcon size={12} />
          </button>
        )}
        <AssigneeQuickFilters filters={filters} onChange={patchFilters} />
        {data && (
          <span class="text-xs text-fg-muted">
            <strong class="text-fg tabular-nums">{data.total}</strong> resultados
          </span>
        )}
      </div>

      {showFilters && <FiltersPanel filters={filters} onChange={patchFilters} />}

      <Card class="p-0 overflow-hidden">
        {isLoading && <LeadsLoading />}
        {error && <div class="p-6 text-sm text-danger">Falha ao carregar leads.</div>}
        {!isLoading && data?.leads.length === 0 && (
          <EmptyState
            icon={<Users size={24} />}
            title="Nenhum lead encontrado"
            description={activeFilterCount > 0 ? 'Tente outros termos ou limpe filtros.' : 'Quando seus leads forem qualificados, aparecerão aqui.'}
          />
        )}
        {!isLoading && data && data.leads.length > 0 && (
          <LeadsTable
            rows={data.leads}
            onOpen={openLead}
            selected={selected}
            onToggle={toggleSelected}
            onToggleAll={toggleSelectAll}
            sortBy={filters.sortBy ?? 'createdAt'}
            sortDir={filters.sortDir ?? 'desc'}
            onSort={(col) => {
              setFilters((f) => {
                if (f.sortBy === col) {
                  return { ...f, sortDir: f.sortDir === 'asc' ? 'desc' : 'asc', offset: 0 }
                }
                return { ...f, sortBy: col, sortDir: col === 'createdAt' ? 'desc' : 'asc', offset: 0 }
              })
            }}
            onAction={(action, lead) => {
              switch (action) {
                case 'view': openLead(lead.id); break
                case 'answers': setAnswersLeadId(lead.id); break
                case 'edit': setEditLeadId(lead.id); break
                case 'copy': {
                  const txt = [
                    lead.empresa, lead.nome, lead.whatsapp, lead.email, lead.segmento, lead.cidade,
                  ].filter(Boolean).join(' · ')
                  navigator.clipboard.writeText(txt)
                    .then(() => toast('Dados copiados', 'success'))
                    .catch(() => toast('Falha ao copiar', 'danger'))
                  break
                }
                case 'kanban': setMoveToKanbanLead(lead.id); break
                case 'whatsapp': setWhatsappLead({ id: lead.id, whatsapp: lead.whatsapp }); break
                case 'resend':
                  resendReportMut.mutate(lead.id, {
                    onSuccess: () => toast('Relatório reenviado', 'success'),
                    onError: (e: unknown) => toast((e as Error).message, 'danger'),
                  })
                  break
                case 'delete':
                  setConfirmDeleteLead({ id: lead.id, label: lead.empresa ?? lead.nome ?? `Lead #${lead.id}` })
                  break
                case 'transfer':
                  setTransferLead({ id: lead.id, label: lead.empresa ?? lead.nome ?? `Lead #${lead.id}` })
                  break
              }
            }}
          />
        )}
      </Card>

      {data && data.total > 0 && (
        <LeadsFooter
          total={data.total}
          limit={filters.limit ?? DEFAULT_PAGE_SIZE}
          offset={filters.offset ?? 0}
          onChangeLimit={(n) => setFilters((f) => ({ ...f, limit: n, offset: 0 }))}
          onChangeOffset={(o) => setFilters((f) => ({ ...f, offset: o }))}
        />
      )}

      {creating && <CreateLeadModal onClose={() => setCreating(false)} />}
      {/* LeadDetailModal removido daqui — clique abre a página dedicada /app/leads/:id.
          O componente continua exportado para uso em Kanban e widgets. */}
      <LeadsColumnsModal open={showColumns} onClose={() => setShowColumns(false)} />

      {/* Bulk actions bar */}
      {selected.size > 0 && (
        <BulkActionsBar
          count={selected.size}
          onClear={() => setSelected(new Set())}
          onChangeStatus={() => setBulkStatusOpen(true)}
          onDelete={() => setBulkDeleteOpen(true)}
          onTag={() => setBulkTagOpen(true)}
          onSendToKanban={() => setBulkKanbanOpen(true)}
          onMarkWon={() => setBulkWonOpen(true)}
          onMarkLost={() => setBulkLostOpen(true)}
          onAssignAgent={() => setBulkAssignOpen(true)}
          onExport={() => setBulkExportOpen(true)}
        />
      )}

      {bulkExportOpen && (
        <LeadExportModal
          leadIds={Array.from(selected)}
          open={bulkExportOpen}
          onClose={() => setBulkExportOpen(false)}
        />
      )}

      {bulkAssignOpen && (
        <BulkAssignAgentModal
          leadIds={Array.from(selected)}
          onClose={() => setBulkAssignOpen(false)}
          onDone={() => { setBulkAssignOpen(false); setSelected(new Set()) }}
        />
      )}

      {bulkWonOpen && (
        <BulkOutcomeModal
          kind="won"
          leadIds={Array.from(selected)}
          onClose={() => setBulkWonOpen(false)}
          onDone={() => { setBulkWonOpen(false); setSelected(new Set()) }}
        />
      )}
      {bulkLostOpen && (
        <BulkOutcomeModal
          kind="lost"
          leadIds={Array.from(selected)}
          onClose={() => setBulkLostOpen(false)}
          onDone={() => { setBulkLostOpen(false); setSelected(new Set()) }}
        />
      )}

      {bulkStatusOpen && (
        <BulkStatusModal
          leadIds={Array.from(selected)}
          onClose={() => setBulkStatusOpen(false)}
          onDone={() => { setBulkStatusOpen(false); setSelected(new Set()) }}
        />
      )}

      {bulkDeleteOpen && (
        <BulkDeleteDialog
          leadIds={Array.from(selected)}
          onClose={() => setBulkDeleteOpen(false)}
          onDone={() => { setBulkDeleteOpen(false); setSelected(new Set()) }}
        />
      )}

      {bulkTagOpen && (
        <BulkTagModal
          leadIds={Array.from(selected)}
          onClose={() => setBulkTagOpen(false)}
          onDone={() => { setBulkTagOpen(false); setSelected(new Set()) }}
        />
      )}

      {bulkKanbanOpen && (
        <SendToKanbanModal
          leadIds={Array.from(selected)}
          onClose={() => setBulkKanbanOpen(false)}
          onDone={() => { setBulkKanbanOpen(false); setSelected(new Set()) }}
        />
      )}

      {moveToKanbanLead !== null && (
        <SendToKanbanModal
          leadIds={[moveToKanbanLead]}
          onClose={() => setMoveToKanbanLead(null)}
          onDone={() => setMoveToKanbanLead(null)}
        />
      )}

      {editLeadId !== null && (
        <EditLeadModal id={editLeadId} onClose={() => setEditLeadId(null)} />
      )}

      {answersLeadId !== null && (
        <LeadAnswersModal id={answersLeadId} onClose={() => setAnswersLeadId(null)} />
      )}

      {whatsappLead !== null && (
        <WhatsappChoiceModal
          leadId={whatsappLead.id}
          whatsapp={whatsappLead.whatsapp}
          onClose={() => setWhatsappLead(null)}
        />
      )}

      {transferLead !== null && (
        <TransferLeadModal
          leadId={transferLead.id}
          leadLabel={transferLead.label}
          onClose={() => setTransferLead(null)}
        />
      )}

      {confirmDeleteLead !== null && (
        <ConfirmDialog
          open
          onOpenChange={(o) => { if (!o) { setConfirmDeleteLead(null); setForceDeleteReg(null) } }}
          title={`Excluir lead "${confirmDeleteLead.label}"`}
          description={forceDeleteReg !== null
            ? `⚠️ Este lead tem ${forceDeleteReg} inscrição(ões) no portal de matrículas. Apagá-lo vai desvinculá-las — elas ficam órfãs no módulo de Matrículas (sem lead). Confirme para apagar mesmo assim.`
            : 'O lead vai para a lixeira e pode ser restaurado.'}
          destructive
          confirmLabel={forceDeleteReg !== null ? 'Apagar mesmo assim' : 'Excluir'}
          loading={delMut.isPending}
          onConfirm={() => delMut.mutate({ id: confirmDeleteLead.id, force: forceDeleteReg !== null }, {
            onSuccess: () => { toast('Lead movido para a lixeira', 'success'); setConfirmDeleteLead(null); setForceDeleteReg(null) },
            onError: (e: unknown) => {
              const c = getRegistrationConflict(e)
              if (c && forceDeleteReg === null) setForceDeleteReg(c.count)
              else toast((e as Error).message, 'danger')
            },
          })}
        />
      )}

      <HowItWorksModal
        open={showHowItWorks}
        onClose={() => setShowHowItWorks(false)}
        title="Como funciona a tela de Leads?"
        problem={<>
          Lead é qualquer pessoa que demonstrou interesse no seu negócio — veio do Instagram, do
          formulário, do chatbot, ou foi cadastrada manualmente. Esta é a <strong>central única</strong>{' '}
          onde todos eles ficam, com filtros, etiquetas, score e ações em lote.
        </>}
        steps={[
          {
            title: '🔎 Encontrar quem você procura',
            body: <>Use a busca pra filtrar por nome, e-mail, WhatsApp ou empresa. Os filtros avançados permitem combinar etapa, etiqueta, origem, score, data de cadastro, etc. Salve as colunas que mais usa.</>,
          },
          {
            title: '➕ Criar lead manual ou em massa',
            body: <>Botão <strong>Novo lead</strong> cadastra um a um. Importações em massa vêm pelos formulários, chatbots, integrações (Meta Ads, Google Ads, Make.com) ou via API.</>,
          },
          {
            title: '✅ Selecionar e agir em lote',
            body: <>Marque vários e use o menu de ações: mover etapa, adicionar etiqueta, mandar pro kanban, marcar como Ganho/Perdido, excluir. Boa pra organizar lotes grandes sem clicar lead a lead.</>,
          },
          {
            title: '👤 Abrir o lead pra ver tudo dele',
            body: <>Clique em qualquer lead pra abrir a página de detalhes — histórico de conversas, atividades, anotações, etapa atual, score, vendas, cadências, etc. Toda interação do lead vive lá.</>,
          },
        ]}
        tip={{
          tone: 'info',
          title: '💡 Dica',
          body: <>Se um lead aparece duplicado (mesmo WhatsApp/e-mail), vá em <strong>CRM › Duplicados</strong> pra decidir se mescla ou mantém separado. Evite excluir manualmente.</>,
        }}
      />
    </Page>
  )
}

function BulkActionsBar({
  count, onClear, onChangeStatus, onDelete, onTag, onSendToKanban, onMarkWon, onMarkLost, onAssignAgent, onExport,
}: {
  count: number
  onClear: () => void
  onChangeStatus: () => void
  onDelete: () => void
  onTag: () => void
  onSendToKanban: () => void
  onMarkWon: () => void
  onMarkLost: () => void
  onAssignAgent: () => void
  onExport: () => void
}) {
  return (
    <div
      class="fixed left-1/2 bottom-6 -translate-x-1/2 z-toast flex items-center gap-2 px-3 h-12 rounded-full bg-surface-3 border border-border shadow-xl flex-wrap"
      style={{ zIndex: 'var(--z-toast)' }}
    >
      <button
        type="button"
        onClick={onClear}
        class="size-8 grid place-items-center rounded-full text-fg-muted hover:text-fg hover:bg-surface-2"
        aria-label="Limpar seleção"
      >
        <XIcon size={14} />
      </button>
      <span class="text-sm text-fg">
        <strong class="tabular-nums">{count}</strong> selecionado{count > 1 ? 's' : ''}
      </span>
      <span class="w-px h-6 bg-border" />
      <Button variant="ghost" size="sm" onClick={onChangeStatus}>
        <ArrowRight size={14} /> Status
      </Button>
      <Button variant="ghost" size="sm" onClick={onAssignAgent}>
        <UserPlus size={14} /> Responsável
      </Button>
      <Button variant="success" size="sm" onClick={onMarkWon}>
        <Trophy size={14} /> Ganho
      </Button>
      <Button variant="danger" size="sm" onClick={onMarkLost}>
        <XCircle size={14} /> Perdido
      </Button>
      <Button variant="ghost" size="sm" onClick={onSendToKanban}>
        <KanbanSquare size={14} /> Kanban
      </Button>
      <Button variant="ghost" size="sm" onClick={onTag}>
        <TagIcon size={14} /> Tags
      </Button>
      <Button variant="ghost" size="sm" onClick={onExport}>
        <DownloadIcon size={14} /> Exportar
      </Button>
      <Button variant="danger" size="sm" onClick={onDelete}>
        <Trash2 size={14} /> Excluir
      </Button>
    </div>
  )
}

function BulkTagModal({
  leadIds, onClose, onDone,
}: { leadIds: number[]; onClose: () => void; onDone: () => void }) {
  const { data: tagsData } = useTags(false)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [action, setAction] = useState<'add' | 'remove'>('add')
  const mutation = useBulkLeadTags()

  function toggle(id: number) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function submit() {
    if (picked.size === 0) { toast('Escolha ao menos uma tag', 'danger'); return }
    mutation.mutate({ leadIds, tagIds: Array.from(picked), action }, {
      onSuccess: (r) => {
        toast(`${r.affected} lead(s) ${action === 'add' ? 'tagueados' : 'destagueados'}`, 'success')
        onDone()
      },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Tags em ${leadIds.length} lead${leadIds.length > 1 ? 's' : ''}`}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={mutation.isPending}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={submit} disabled={mutation.isPending}>
            {mutation.isPending ? 'Aplicando…' : (action === 'add' ? 'Adicionar tags' : 'Remover tags')}
          </Button>
        </>
      }
    >
      <div class="space-y-3">
        <div class="flex gap-2">
          <button
            type="button"
            class={`flex-1 h-9 px-3 rounded-md text-sm font-medium border ${action === 'add' ? 'border-accent bg-accent/5 text-accent' : 'border-border text-fg-muted hover:bg-surface-3'}`}
            onClick={() => setAction('add')}
          >
            Adicionar
          </button>
          <button
            type="button"
            class={`flex-1 h-9 px-3 rounded-md text-sm font-medium border ${action === 'remove' ? 'border-danger bg-danger/5 text-danger' : 'border-border text-fg-muted hover:bg-surface-3'}`}
            onClick={() => setAction('remove')}
          >
            Remover
          </button>
        </div>
        {!tagsData || tagsData.tags.length === 0 ? (
          <div class="text-sm text-fg-muted">Nenhuma tag cadastrada.</div>
        ) : (
          <div class="flex flex-wrap gap-1.5 max-h-64 overflow-y-auto">
            {tagsData.tags.map((t) => {
              const isPicked = picked.has(t.id)
              return (
                <button
                  key={t.id}
                  type="button"
                  class={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-xs ${
                    isPicked ? 'border-accent ring-1 ring-accent/30' : 'border-border hover:bg-surface-3'
                  }`}
                  style={{ background: isPicked ? `${t.color}22` : undefined, color: isPicked ? t.color : undefined }}
                  onClick={() => toggle(t.id)}
                >
                  {isPicked && <Check size={11} />}
                  <span class="size-2 rounded-full" style={{ background: t.color }} />
                  {t.name}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </Modal>
  )
}

function SendToKanbanModal({
  leadIds, onClose, onDone,
}: { leadIds: number[]; onClose: () => void; onDone: () => void }) {
  const { data: funnelsData } = useFunnels()
  const [funnelId, setFunnelId] = useState<number | ''>('')
  const [stageKey, setStageKey] = useState('')
  const { data: funnelDetail } = useFunnel(typeof funnelId === 'number' ? funnelId : null)
  const stages = funnelDetail?.stages ?? []
  const send = useSendLeadsToKanban()

  // Auto-seleciona funil padrão
  const initialFunnel = useMemo(() => {
    if (!funnelsData) return ''
    const def = funnelsData.funnels.find((f) => f.isDefault) ?? funnelsData.funnels[0]
    return def?.id ?? ''
  }, [funnelsData])

  if (typeof funnelId !== 'number' && initialFunnel !== '') {
    setFunnelId(initialFunnel)
  }

  function submit() {
    send.mutate({
      leadIds,
      funnelId: typeof funnelId === 'number' ? funnelId : undefined,
      stageKey: stageKey || undefined,
    }, {
      onSuccess: (r) => { toast(`${r.sent} lead(s) enviados ao kanban`, 'success'); onDone() },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Enviar ${leadIds.length} lead${leadIds.length > 1 ? 's' : ''} ao kanban`}
      description="Define o funil e a etapa inicial. Se omitir a etapa, usa a primeira do funil."
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={send.isPending}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={submit} disabled={send.isPending}>
            {send.isPending ? 'Enviando…' : 'Enviar ao kanban'}
          </Button>
        </>
      }
    >
      <div class="space-y-3">
        <Select
          label="Funil"
          value={funnelId === '' ? '' : String(funnelId)}
          onChange={(e) => {
            const v = (e.target as HTMLSelectElement).value
            setFunnelId(v ? Number(v) : '')
            setStageKey('')
          }}
        >
          <option value="">Padrão</option>
          {(funnelsData?.funnels ?? []).map((f) => (
            <option key={f.id} value={f.id}>{f.name}{f.isDefault ? ' (padrão)' : ''}</option>
          ))}
        </Select>
        <Select
          label="Etapa inicial"
          value={stageKey}
          onChange={(e) => setStageKey((e.target as HTMLSelectElement).value)}
        >
          <option value="">Primeira etapa do funil</option>
          {stages.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
        </Select>
      </div>
    </Modal>
  )
}

function BulkStatusModal({ leadIds, onClose, onDone }: { leadIds: number[]; onClose: () => void; onDone: () => void }) {
  const [status, setStatus] = useState('')
  const mutation = useBulkUpdateLeadsStatus()

  function submit() {
    if (!status.trim()) { toast('Informe a chave da etapa (ex.: NOVO, CONTATADO)', 'danger'); return }
    mutation.mutate({ leadIds, status: status.trim().toUpperCase() }, {
      onSuccess: (r) => { toast(`${r.moved}/${r.total} leads movidos`, 'success'); onDone() },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Mudar status de ${leadIds.length} leads`}
      description="Use a chave da etapa exatamente como configurada no funil (ex.: NOVO, CONTATADO, FECHADO)."
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={mutation.isPending}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={submit} disabled={mutation.isPending}>
            {mutation.isPending ? 'Movendo…' : 'Mover'}
          </Button>
        </>
      }
    >
      <Input
        label="Chave da etapa"
        value={status}
        onInput={(e) => setStatus((e.target as HTMLInputElement).value)}
        placeholder="NOVO"
      />
    </Modal>
  )
}

function BulkDeleteDialog({ leadIds, onClose, onDone }: { leadIds: number[]; onClose: () => void; onDone: () => void }) {
  const mutation = useBulkDeleteLeads()
  const [forceReg, setForceReg] = useState<{ leads: number; regs: number } | null>(null)
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Excluir ${leadIds.length} leads`}
      description={forceReg
        ? `⚠️ ${forceReg.leads} dos leads selecionados têm inscrições no portal de matrículas (${forceReg.regs} no total). Apagá-los vai desvinculá-las — ficam órfãs no módulo de Matrículas. Confirme para apagar mesmo assim.`
        : 'Os leads vão para a lixeira e podem ser restaurados pelo painel de Lixeira.'}
      destructive
      confirmLabel={forceReg ? 'Apagar mesmo assim' : 'Excluir'}
      loading={mutation.isPending}
      onConfirm={() => mutation.mutate({ leadIds, force: forceReg !== null }, {
        onSuccess: (r) => { toast(`${r.deleted} leads movidos para a lixeira`, 'success'); onDone() },
        onError: (e: unknown) => {
          const c = getRegistrationConflict(e)
          if (c && !forceReg) setForceReg({ leads: c.leadIds?.length ?? 0, regs: c.count })
          else toast((e as Error).message, 'danger')
        },
      })}
    />
  )
}

// Bulk Ganho / Perdido (Fase 23)
function BulkOutcomeModal({
  kind, leadIds, onClose, onDone,
}: {
  kind: 'won' | 'lost'
  leadIds: number[]
  onClose: () => void
  onDone: () => void
}) {
  const won = useBulkMarkWon()
  const lost = useBulkMarkLost()
  const reasons = useLossReasons()
  const [value, setValue] = useState('')
  const [reasonId, setReasonId] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const isPending = kind === 'won' ? won.isPending : lost.isPending

  function handleConfirm() {
    if (kind === 'won') {
      const numericValue = value.trim() ? Number(value.replace(/\./g, '').replace(',', '.')) : null
      if (value.trim() && (numericValue == null || !Number.isFinite(numericValue) || numericValue < 0)) {
        toast('Valor inválido', 'danger')
        return
      }
      won.mutate({ ids: leadIds, value: numericValue, note: note.trim() || null }, {
        onSuccess: (r) => {
          toast(`${r.processed} marcado(s) como Ganho${r.failed > 0 ? ` · ${r.failed} falhou` : ''}`, 'success')
          onDone()
        },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    } else {
      lost.mutate({ ids: leadIds, reasonId, note: note.trim() || null }, {
        onSuccess: (r) => {
          toast(`${r.processed} marcado(s) como Perdido${r.failed > 0 ? ` · ${r.failed} falhou` : ''}`, 'success')
          onDone()
        },
        onError: (e: unknown) => toast((e as Error).message, 'danger'),
      })
    }
  }

  const items = reasons.data?.data ?? []

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={kind === 'won' ? `Marcar ${leadIds.length} leads como Ganho` : `Marcar ${leadIds.length} leads como Perdido`}
      description="Cadências e atividades pendentes desses leads serão canceladas."
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancelar</Button>
          <Button variant={kind === 'won' ? 'success' : 'danger'} size="sm" onClick={handleConfirm} disabled={isPending}>
            {kind === 'won'
              ? <><Trophy size={12} /> {isPending ? 'Salvando…' : 'Confirmar Ganho'}</>
              : <><XCircle size={12} /> {isPending ? 'Salvando…' : 'Confirmar Perdido'}</>}
          </Button>
        </>
      }
    >
      <div class="space-y-3">
        {kind === 'won' && (
          <div>
            <label class="block text-xs font-medium text-fg mb-1">Valor da venda <span class="text-fg-subtle">(opcional, aplicado a todos)</span></label>
            <Input
              type="text"
              inputMode="decimal"
              placeholder="Ex: 1500,00"
              value={value}
              onInput={(e) => setValue((e.target as HTMLInputElement).value)}
            />
          </div>
        )}
        {kind === 'lost' && (
          <div>
            <div class="flex items-center justify-between mb-1">
              <label class="text-xs font-medium text-fg">Objeção (aplicada a todos)</label>
              <a
                href="/app/settings"
                target="_blank"
                rel="noreferrer"
                class="text-[0.6875rem] text-accent hover:underline"
                title="Abre Configurações > Objeções em nova aba"
              >
                Gerenciar objeções
              </a>
            </div>
            <select
              class="w-full h-9 rounded-md border border-border bg-surface px-2 text-sm text-fg"
              value={reasonId == null ? '' : String(reasonId)}
              onChange={(e) => {
                const v = (e.target as HTMLSelectElement).value
                setReasonId(v ? parseInt(v) : null)
              }}
            >
              <option value="">Selecione…</option>
              {items.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label class="block text-xs font-medium text-fg mb-1">Observação <span class="text-fg-subtle">(opcional)</span></label>
          <Textarea
            value={note}
            onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)}
            placeholder="Mesma observação para todos"
          />
        </div>
      </div>
    </Modal>
  )
}

// Lead Routing F6: filtros rápidos por responsável.
// "Meus leads" e "Sem responsável" são mutuamente exclusivos — clicar um limpa o outro.
function AssigneeQuickFilters({
  filters, onChange,
}: {
  filters: LeadsListFilters
  onChange: (patch: Partial<LeadsListFilters>) => void
}) {
  const mine = filters.assignedUserId === 'me'
  const unassigned = filters.onlyUnassigned === true
  return (
    <>
      <button
        type="button"
        class={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs',
          mine
            ? 'bg-accent text-fg-on-brand border-accent'
            : 'bg-surface-3/60 text-fg-muted border-border hover:bg-surface-3',
        )}
        onClick={() => onChange({
          assignedUserId: mine ? undefined : 'me',
          onlyUnassigned: undefined,
          offset: 0,
        })}
      >
        Meus leads
      </button>
      <button
        type="button"
        class={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs',
          unassigned
            ? 'bg-warning text-white border-warning'
            : 'bg-surface-3/60 text-fg-muted border-border hover:bg-surface-3',
        )}
        onClick={() => onChange({
          onlyUnassigned: unassigned ? undefined : true,
          assignedUserId: undefined,
          offset: 0,
        })}
      >
        Sem responsável
      </button>
    </>
  )
}

function QuickStageFilter({
  funnelId, value, onChange,
}: {
  funnelId: number | undefined
  value: string | undefined
  onChange: (v: string | undefined) => void
}) {
  const { data } = useStages(funnelId)
  const stages = (data?.stages ?? []).filter((s) => s.active)
  return (
    <select
      class="h-9 px-2 rounded-md bg-surface border border-border text-xs text-fg cursor-pointer focus:outline-none focus:border-accent"
      value={value ?? ''}
      onChange={(e) => {
        const v = (e.target as HTMLSelectElement).value
        onChange(v || undefined)
      }}
      aria-label="Filtrar por etapa"
    >
      <option value="">Todas as etapas</option>
      {stages.map((s) => (
        <option key={s.id} value={s.key}>{s.name}</option>
      ))}
    </select>
  )
}

function FiltersPanel({ filters, onChange }: { filters: LeadsListFilters; onChange: (p: Partial<LeadsListFilters>) => void }) {
  const { data: funnels } = useFunnels()
  const { data: tagsData } = useTags()
  const { data: stagesData } = useStages(filters.funnelId)
  const { data: agentsData } = useAgents()
  const { data: sourcesData } = useLeadSources()
  const tagIds = filters.tagIds ?? []
  const assignedUserIds = filters.assignedUserIds ?? []
  const sources = filters.sources ?? []
  const availableSources = sourcesData?.sources ?? []

  function toggleTag(id: number) {
    if (tagIds.includes(id)) onChange({ tagIds: tagIds.filter((t) => t !== id) })
    else onChange({ tagIds: [...tagIds, id] })
  }

  function toggleAgent(id: number) {
    if (assignedUserIds.includes(id)) onChange({ assignedUserIds: assignedUserIds.filter((x) => x !== id) })
    else onChange({ assignedUserIds: [...assignedUserIds, id] })
  }

  function toggleSource(key: string) {
    if (sources.includes(key)) onChange({ sources: sources.filter((x) => x !== key) })
    else onChange({ sources: [...sources, key] })
  }

  return (
    <Card>
      <div class="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <Select
          label="Funil"
          value={filters.funnelId !== undefined ? String(filters.funnelId) : ''}
          onChange={(e) => {
            const v = (e.target as HTMLSelectElement).value
            onChange({ funnelId: v ? Number(v) : undefined })
          }}
        >
          <option value="">Todos</option>
          {funnels?.funnels.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </Select>

        <Select
          label="Resultado"
          value={filters.outcome ?? ''}
          onChange={(e) => {
            const v = (e.target as HTMLSelectElement).value
            onChange({ outcome: (v || undefined) as LeadsListFilters['outcome'] })
          }}
        >
          <option value="">Todos</option>
          <option value="open">Em andamento</option>
          <option value="won">Ganhos</option>
          <option value="lost">Perdidos</option>
          <option value="classified">Classificados (ganho ou perdido)</option>
        </Select>

        <Select
          label="Score IA"
          value={filters.aiScoreLabel ?? ''}
          onChange={(e) => {
            const v = (e.target as HTMLSelectElement).value
            onChange({ aiScoreLabel: (v || undefined) as LeadsListFilters['aiScoreLabel'] })
          }}
          hint="Faixa qualitativa do lead score por IA"
        >
          <option value="">Qualquer</option>
          <option value="hot">🔥 Quente (70-100)</option>
          <option value="warm">🌤 Morno (40-69)</option>
          <option value="cold">❄️ Frio (0-39)</option>
        </Select>

        <div class="flex flex-col gap-1">
          <span class="text-xs font-medium text-fg-muted">Período (cadastro)</span>
          <div class="flex gap-1">
            <input
              type="date"
              class="flex-1 h-9 px-2 rounded-md bg-surface border border-border text-xs text-fg focus:outline-none focus:border-accent"
              value={filters.dateFrom ?? ''}
              onInput={(e) => onChange({ dateFrom: (e.target as HTMLInputElement).value || undefined })}
            />
            <input
              type="date"
              class="flex-1 h-9 px-2 rounded-md bg-surface border border-border text-xs text-fg focus:outline-none focus:border-accent"
              value={filters.dateTo ?? ''}
              onInput={(e) => onChange({ dateTo: (e.target as HTMLInputElement).value || undefined })}
            />
          </div>
        </div>
      </div>

      {/* Responsável (multi) */}
      <div class="mt-4 pt-4 border-t border-border">
        <div class="flex items-center justify-between mb-2">
          <span class="text-[0.6875rem] font-semibold text-fg-muted uppercase tracking-wider">
            Responsável
          </span>
          {assignedUserIds.length > 0 && (
            <button
              type="button"
              class="text-[0.6875rem] text-fg-muted hover:text-fg"
              onClick={() => onChange({ assignedUserIds: undefined })}
            >
              Limpar
            </button>
          )}
        </div>
        <div class="flex flex-wrap gap-1.5">
          {(agentsData?.agents ?? []).filter((a) => a.active).map((a) => {
            const active = assignedUserIds.includes(a.id)
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => toggleAgent(a.id)}
                class={cn(
                  'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border text-xs font-medium transition-colors',
                  active ? 'bg-accent/15 text-accent border-accent' : 'bg-surface text-fg-muted border-border hover:text-fg',
                )}
              >
                {a.name || a.email}
              </button>
            )
          })}
          {(!agentsData || agentsData.agents.length === 0) && (
            <span class="text-xs text-fg-subtle">Sem operadores cadastrados</span>
          )}
        </div>
      </div>

      {/* Origem (multi) */}
      <div class="mt-4 pt-4 border-t border-border">
        <div class="flex items-center justify-between mb-2">
          <span class="text-[0.6875rem] font-semibold text-fg-muted uppercase tracking-wider">
            Origem
          </span>
          {sources.length > 0 && (
            <button
              type="button"
              class="text-[0.6875rem] text-fg-muted hover:text-fg"
              onClick={() => onChange({ sources: undefined })}
            >
              Limpar
            </button>
          )}
        </div>
        <div class="flex flex-wrap gap-1.5">
          {availableSources.length === 0 ? (
            <span class="text-xs text-fg-subtle italic">Nenhuma origem encontrada</span>
          ) : availableSources.map((src) => {
            const key = src.value ?? ''
            const active = sources.includes(key)
            return (
              <button
                key={key || 'null'}
                type="button"
                onClick={() => toggleSource(key)}
                class={cn(
                  'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border text-xs font-medium transition-colors',
                  active ? 'bg-accent/15 text-accent border-accent' : 'bg-surface text-fg-muted border-border hover:text-fg',
                )}
              >
                {leadSourceLabel(src.value)}
                <span class="text-fg-subtle text-[0.625rem]">{src.count}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Sub-bloco: Data de entrada na etapa */}
      <div class="mt-4 pt-4 border-t border-border">
        <div class="text-[0.6875rem] font-semibold text-fg-muted uppercase tracking-wider mb-2">
          Data de entrada na etapa
        </div>
        <div class="grid gap-3 grid-cols-1 sm:grid-cols-3">
          <Select
            label="Etapa"
            value={filters.stageKey ?? ''}
            onChange={(e) => {
              const v = (e.target as HTMLSelectElement).value
              onChange({ stageKey: v || undefined })
            }}
          >
            <option value="">Qualquer etapa</option>
            {stagesData?.stages.filter((s) => s.active).map((s) => (
              <option key={s.id} value={s.key}>{s.name}</option>
            ))}
          </Select>
          <div class="flex flex-col gap-1">
            <span class="text-xs font-medium text-fg-muted">Entrou a partir de</span>
            <input
              type="date"
              class="h-9 px-2 rounded-md bg-surface border border-border text-xs text-fg focus:outline-none focus:border-accent"
              value={filters.stageEnteredFrom ?? ''}
              onInput={(e) => onChange({ stageEnteredFrom: (e.target as HTMLInputElement).value || undefined })}
            />
          </div>
          <div class="flex flex-col gap-1">
            <span class="text-xs font-medium text-fg-muted">Entrou até</span>
            <input
              type="date"
              class="h-9 px-2 rounded-md bg-surface border border-border text-xs text-fg focus:outline-none focus:border-accent"
              value={filters.stageEnteredTo ?? ''}
              onInput={(e) => onChange({ stageEnteredTo: (e.target as HTMLInputElement).value || undefined })}
            />
          </div>
        </div>
      </div>

      {tagsData && tagsData.tags.length > 0 && (
        <div class="mt-3">
          <span class="text-xs font-medium text-fg-muted block mb-1.5">Etiquetas</span>
          <div class="flex flex-wrap gap-1.5">
            {tagsData.tags.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => toggleTag(t.id)}
                class={cn(
                  'inline-flex items-center gap-1 h-6 px-2 rounded-full text-xs font-medium transition-all',
                  tagIds.includes(t.id) ? 'ring-2 ring-accent' : 'opacity-60 hover:opacity-100',
                )}
                style={{ background: `${t.color}22`, color: t.color }}
              >
                <span class="size-1.5 rounded-full" style={{ background: t.color }} />
                {t.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {(filters.funnelId !== undefined || filters.outcome !== undefined || filters.aiScoreLabel !== undefined
         || filters.dateFrom !== undefined || filters.dateTo !== undefined || tagIds.length > 0
         || filters.stageKey !== undefined || filters.stageEnteredFrom !== undefined || filters.stageEnteredTo !== undefined
         || assignedUserIds.length > 0 || sources.length > 0) && (
        <button
          type="button"
          class="mt-3 inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg"
          onClick={() => onChange({
            funnelId: undefined, outcome: undefined, aiScoreLabel: undefined,
            dateFrom: undefined, dateTo: undefined, tagIds: undefined,
            stageKey: undefined, stageEnteredFrom: undefined, stageEnteredTo: undefined,
            assignedUserIds: undefined, sources: undefined,
            scoreMin: undefined, scoreMax: undefined,
          })}
        >
          <XIcon size={12} /> Limpar filtros
        </button>
      )}
    </Card>
  )
}

function LeadsLoading() {
  return (
    <div class="p-4 flex flex-col gap-2">
      {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} class="h-10 w-full" />)}
    </div>
  )
}

function LeadsFooter({
  total, limit, offset, onChangeLimit, onChangeOffset,
}: {
  total: number
  limit: number
  offset: number
  onChangeLimit: (n: number) => void
  onChangeOffset: (o: number) => void
}) {
  const page = Math.floor(offset / limit) + 1
  const totalPages = Math.max(1, Math.ceil(total / limit))
  const from = total === 0 ? 0 : offset + 1
  const to = Math.min(offset + limit, total)

  const visible = useMemo(() => {
    const set = new Set<number>([1, totalPages, page, page - 1, page + 1, page - 2, page + 2])
    return [...set].filter((n) => n >= 1 && n <= totalPages).sort((a, b) => a - b)
  }, [page, totalPages])

  const items: ({ kind: 'page'; n: number } | { kind: 'gap' })[] = []
  let prev = 0
  for (const n of visible) {
    if (n - prev > 1) items.push({ kind: 'gap' })
    items.push({ kind: 'page', n })
    prev = n
  }

  return (
    <div class="flex items-center justify-between gap-2 text-xs flex-wrap">
      <span class="text-fg-muted">
        Mostrando <span class="text-fg tabular-nums">{from}</span>–<span class="text-fg tabular-nums">{to}</span> de <span class="text-fg tabular-nums">{total}</span>
      </span>
      <div class="flex items-center gap-1 flex-wrap">
        <button
          type="button"
          class="h-7 px-2 rounded-md border border-border bg-surface text-fg-muted hover:text-fg hover:bg-surface-3 disabled:opacity-40 disabled:hover:bg-surface"
          onClick={() => onChangeOffset(0)}
          disabled={page <= 1}
          aria-label="Primeira página"
        >«</button>
        <button
          type="button"
          class="h-7 px-2 rounded-md border border-border bg-surface text-fg-muted hover:text-fg hover:bg-surface-3 disabled:opacity-40 disabled:hover:bg-surface"
          onClick={() => onChangeOffset(Math.max(0, offset - limit))}
          disabled={page <= 1}
          aria-label="Página anterior"
        >‹</button>
        {items.map((it, i) => it.kind === 'gap'
          ? <span key={`gap-${i}`} class="px-1 text-fg-subtle">…</span>
          : (
            <button
              key={`p-${it.n}`}
              type="button"
              class={cn(
                'h-7 min-w-[2rem] px-2 rounded-md border text-xs font-medium tabular-nums',
                it.n === page ? 'border-accent bg-accent text-fg-on-brand' : 'border-border bg-surface text-fg-muted hover:text-fg hover:bg-surface-3',
              )}
              onClick={() => onChangeOffset((it.n - 1) * limit)}
            >{it.n}</button>
          ),
        )}
        <button
          type="button"
          class="h-7 px-2 rounded-md border border-border bg-surface text-fg-muted hover:text-fg hover:bg-surface-3 disabled:opacity-40 disabled:hover:bg-surface"
          onClick={() => onChangeOffset(offset + limit)}
          disabled={page >= totalPages}
          aria-label="Próxima página"
        >›</button>
        <button
          type="button"
          class="h-7 px-2 rounded-md border border-border bg-surface text-fg-muted hover:text-fg hover:bg-surface-3 disabled:opacity-40 disabled:hover:bg-surface"
          onClick={() => onChangeOffset((totalPages - 1) * limit)}
          disabled={page >= totalPages}
          aria-label="Última página"
        >»</button>
        <select
          class="h-7 ml-2 px-2 rounded-md border border-border bg-surface text-xs text-fg cursor-pointer focus:outline-none focus:border-accent"
          value={limit}
          onChange={(e) => onChangeLimit(Number((e.target as HTMLSelectElement).value))}
          aria-label="Itens por página"
        >
          {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n}/pag</option>)}
        </select>
      </div>
    </div>
  )
}

type LeadSortBy = NonNullable<LeadsListFilters['sortBy']>
type LeadRowAction = 'view' | 'answers' | 'edit' | 'copy' | 'kanban' | 'whatsapp' | 'resend' | 'delete' | 'transfer'

const COL_TO_SORT: Partial<Record<LeadColumnKey, LeadSortBy>> = {
  empresa: 'empresa',
  nome: 'nome',
  status: 'status',
  data: 'createdAt',
}

function LeadsTable({
  rows, onOpen, selected, onToggle, onToggleAll, sortBy, sortDir, onSort, onAction,
}: {
  rows: LeadListItem[]
  onOpen: (id: number) => void
  selected: Set<number>
  onToggle: (id: number) => void
  onToggleAll: () => void
  sortBy: LeadSortBy
  sortDir: 'asc' | 'desc'
  onSort: (col: LeadSortBy) => void
  onAction: (action: LeadRowAction, lead: LeadListItem) => void
}) {
  const visible = useLeadsColumnsStore((s) => s.visible)
  const allSelected = rows.length > 0 && rows.every((l) => selected.has(l.id))
  const someSelected = rows.some((l) => selected.has(l.id)) && !allSelected
  return (
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-surface-3 text-fg-subtle text-[0.6875rem] uppercase tracking-wider">
          <tr>
            <th class="w-10 px-4 py-2">
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => { if (el) el.indeterminate = someSelected }}
                onChange={onToggleAll}
                aria-label="Selecionar todos"
              />
            </th>
            {visible.map((col) => {
              const sortKey = COL_TO_SORT[col]
              if (!sortKey) {
                return (
                  <th key={col} class="text-left px-4 py-2 font-medium">
                    {LEAD_COLUMN_LABELS[col]}
                  </th>
                )
              }
              const active = sortBy === sortKey
              const arrow = active ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''
              return (
                <th
                  key={col}
                  class="text-left px-4 py-2 font-medium cursor-pointer select-none hover:text-fg"
                  onClick={() => onSort(sortKey)}
                  aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  {LEAD_COLUMN_LABELS[col]}{arrow}
                </th>
              )
            })}
            <th class="w-10 px-2 py-2"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border">
          {rows.map((l) => {
            const isSelected = selected.has(l.id)
            return (
              <tr
                key={l.id}
                class={cn('hover:bg-surface-3 cursor-pointer', isSelected && 'bg-accent/10 hover:bg-accent/15')}
                onClick={() => onOpen(l.id)}
              >
                <td class="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onToggle(l.id)}
                    aria-label={`Selecionar lead ${l.empresa ?? l.id}`}
                  />
                </td>
                {visible.map((col) => <LeadCell key={col} col={col} lead={l} />)}
                <td class="px-1 py-2" onClick={(e) => e.stopPropagation()}>
                  <LeadRowActionsMenu lead={l} onAction={onAction} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function LeadRowActionsMenu({
  lead, onAction,
}: { lead: LeadListItem; onAction: (a: LeadRowAction, l: LeadListItem) => void }) {
  const isWebChat = lead.source === 'web_chat'
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          class="size-8 grid place-items-center rounded-md text-fg-muted hover:text-fg hover:bg-surface-3"
          aria-label={`Opções para lead ${lead.empresa ?? lead.nome ?? lead.id}`}
          title="Opções"
        >
          <MoreHorizontal size={16} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          class="min-w-[12rem] rounded-md bg-surface-2 border border-border shadow-lg p-1"
          style={{ zIndex: 'var(--z-popover)' }}
        >
          <DropdownMenu.Item
            class="flex items-center gap-2 h-8 px-2 rounded-sm text-sm cursor-pointer hover:bg-surface-3 outline-none"
            onSelect={() => onAction('view', lead)}
          >
            <Eye size={14} /> Ver detalhes
          </DropdownMenu.Item>
          {isWebChat && (
            <DropdownMenu.Item
              class="flex items-center gap-2 h-8 px-2 rounded-sm text-sm cursor-pointer hover:bg-surface-3 outline-none"
              onSelect={() => onAction('answers', lead)}
            >
              <FileText size={14} /> Ver respostas
            </DropdownMenu.Item>
          )}
          <DropdownMenu.Item
            class="flex items-center gap-2 h-8 px-2 rounded-sm text-sm cursor-pointer hover:bg-surface-3 outline-none"
            onSelect={() => onAction('edit', lead)}
          >
            <Pencil size={14} /> Editar lead
          </DropdownMenu.Item>
          <DropdownMenu.Item
            class="flex items-center gap-2 h-8 px-2 rounded-sm text-sm cursor-pointer hover:bg-surface-3 outline-none"
            onSelect={() => onAction('copy', lead)}
          >
            <Copy size={14} /> Copiar dados
          </DropdownMenu.Item>
          <DropdownMenu.Item
            class="flex items-center gap-2 h-8 px-2 rounded-sm text-sm cursor-pointer hover:bg-surface-3 outline-none"
            onSelect={() => onAction('kanban', lead)}
          >
            <KanbanSquare size={14} /> Mover para Funil
          </DropdownMenu.Item>
          {lead.assignedUserId != null && (
            <DropdownMenu.Item
              class="flex items-center gap-2 h-8 px-2 rounded-sm text-sm cursor-pointer hover:bg-surface-3 outline-none"
              onSelect={() => onAction('transfer', lead)}
            >
              <ArrowRightLeft size={14} /> Transferir para…
            </DropdownMenu.Item>
          )}
          {lead.whatsapp && (
            <DropdownMenu.Item
              class="flex items-center gap-2 h-8 px-2 rounded-sm text-sm cursor-pointer hover:bg-surface-3 outline-none"
              onSelect={() => onAction('whatsapp', lead)}
            >
              <MessageCircle size={14} /> WhatsApp
            </DropdownMenu.Item>
          )}
          {isWebChat && (
            <DropdownMenu.Item
              class="flex items-center gap-2 h-8 px-2 rounded-sm text-sm cursor-pointer hover:bg-surface-3 outline-none"
              onSelect={() => onAction('resend', lead)}
            >
              <Send size={14} /> Reenviar relatório
            </DropdownMenu.Item>
          )}
          <DropdownMenu.Separator class="h-px bg-border my-1" />
          <DropdownMenu.Item
            class="flex items-center gap-2 h-8 px-2 rounded-sm text-sm cursor-pointer hover:bg-danger/10 text-danger outline-none"
            onSelect={() => onAction('delete', lead)}
          >
            <Trash2 size={14} /> Excluir lead
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function LeadCell({ col, lead }: { col: LeadColumnKey; lead: LeadListItem }) {
  switch (col) {
    case 'empresa':
      return (
        <td class="px-4 py-2">
          <div class="text-fg truncate max-w-[16rem]">{lead.empresa ?? '—'}</div>
        </td>
      )
    case 'nome':
      return (
        <td class="px-4 py-2">
          <div class="text-fg truncate max-w-[12rem]">{lead.nome ?? '—'}</div>
        </td>
      )
    case 'whatsapp':
      return <td class="px-4 py-2 text-xs text-fg-muted whitespace-nowrap">{lead.whatsapp ?? '—'}</td>
    case 'email':
      return <td class="px-4 py-2 text-xs text-fg-muted truncate max-w-[14rem]">{lead.email ?? '—'}</td>
    case 'segmento':
      return <td class="px-4 py-2 text-xs text-fg-muted">{lead.segmento ?? '—'}</td>
    case 'cidade':
      return <td class="px-4 py-2 text-xs text-fg-muted">{lead.cidade ?? '—'}</td>
    case 'status':
      return (
        <td class="px-4 py-2">
          <div class="inline-flex items-center gap-1.5 flex-wrap">
            {lead.status ? <LeadStatusBadge status={lead.status} label={lead.statusLabel} /> : <span class="text-fg-subtle">—</span>}
            {lead.outcome && <OutcomeBadge outcome={lead.outcome} />}
          </div>
        </td>
      )
    case 'score':
      return <td class="px-4 py-2 tabular-nums text-fg-muted">{lead.scores?.geral ?? '—'}</td>
    case 'aiScore':
      return (
        <td class="px-4 py-2">
          <AiScoreBadge score={lead.aiScore ?? null} label={lead.aiScoreLabel ?? null} />
        </td>
      )
    case 'tags':
      return (
        <td class="px-4 py-2">
          {lead.tags && lead.tags.length > 0 ? (
            <div class="flex flex-wrap gap-1 max-w-[14rem]">
              {lead.tags.slice(0, 3).map(({ tag }) => (
                <span
                  key={tag.id}
                  class="text-[0.625rem] px-1.5 py-0.5 rounded-full font-medium"
                  style={{ background: `${tag.color}22`, color: tag.color }}
                >
                  {tag.name}
                </span>
              ))}
              {lead.tags.length > 3 && <span class="text-[0.625rem] text-fg-subtle">+{lead.tags.length - 3}</span>}
            </div>
          ) : <span class="text-fg-subtle">—</span>}
        </td>
      )
    case 'funil':
      return <td class="px-4 py-2 text-xs text-fg-muted truncate max-w-[10rem]">{lead.funnel?.name ?? '—'}</td>
    case 'origem':
      return <td class="px-4 py-2 text-xs text-fg-muted">{leadSourceLabel(lead.source)}</td>
    case 'data':
      return <td class="px-4 py-2 text-xs text-fg-muted whitespace-nowrap">{formatDateTime(lead.createdAt)}</td>
    case 'uid':
      return <td class="px-4 py-2 font-mono text-[0.6875rem] text-fg-subtle truncate max-w-[8rem]">{lead.uid ?? '—'}</td>
    case 'assignee':
      return (
        <td class="px-4 py-2 text-xs">
          {lead.assignedUser ? (
            <span class="text-fg" title={lead.assignedUser.email ?? lead.assignedUser.name}>
              {lead.assignedUser.name}
            </span>
          ) : (
            <span class="text-fg-subtle italic">Sem responsável</span>
          )}
        </td>
      )
    default:
      return <td class="px-4 py-2 text-fg-subtle">—</td>
  }
}

function CreateLeadModal({ onClose }: { onClose: () => void }) {
  const [empresa, setEmpresa] = useState('')
  const [nome, setNome] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [email, setEmail] = useState('')
  const [segmento, setSegmento] = useState('')
  const [cidade, setCidade] = useState('')
  const [funnelId, setFunnelId] = useState('')
  const [teamId, setTeamId] = useState('')
  const [assignedUserId, setAssignedUserId] = useState('')
  const { data: funnels } = useFunnels()
  const { data: teamsData } = useTeams()
  const { data: agentsData } = useAgents()
  const { data: teamMembersData } = useTeamMembers(teamId ? Number(teamId) : null)
  const create = useCreateManualLead()

  // Responsável: se uma equipe foi escolhida, lista só os membros dela (mantém
  // coerência equipe↔responsável). Sem equipe, lista todos os agentes ativos.
  const responsibleOptions = teamId
    ? (teamMembersData?.members ?? [])
        .filter((m) => m.user.active)
        .map((m) => ({ id: m.user.id, name: m.user.name || m.user.email }))
    : (agentsData?.agents ?? [])
        .filter((a) => a.active && a.role !== 'VIEWER')
        .map((a) => ({ id: a.id, name: a.name || a.email }))

  function handleSubmit() {
    if (!nome.trim() || !whatsapp.trim() || !email.trim()) {
      toast('Nome, WhatsApp e e-mail são obrigatórios', 'danger')
      return
    }
    const payload: ManualLeadInput = {
      nome: nome.trim(),
      whatsapp: whatsapp.trim(),
      email: email.trim(),
      empresa: empresa.trim() || undefined,
      segmento: segmento || undefined,
      cidade: cidade || undefined,
      funnelId: funnelId ? Number(funnelId) : undefined,
      teamId: teamId ? Number(teamId) : undefined,
      assignedUserId: assignedUserId ? Number(assignedUserId) : undefined,
    }
    create.mutate(payload, {
      onSuccess: () => { toast('Lead criado', 'success'); onClose() },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Novo lead manual"
      description="Lead será criado já qualificado."
      size="lg"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={create.isPending}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={create.isPending}>
            {create.isPending ? 'Salvando…' : 'Criar'}
          </Button>
        </>
      }
    >
      <div class="grid gap-3 grid-cols-1 sm:grid-cols-2">
        <Input label="Nome *" value={nome} onInput={(e) => setNome((e.target as HTMLInputElement).value)} />
        <Input label="WhatsApp *" value={whatsapp} onInput={(e) => setWhatsapp((e.target as HTMLInputElement).value)} placeholder="5511999999999" />
        <Input label="E-mail *" type="email" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} />
        <Input label="Empresa" value={empresa} onInput={(e) => setEmpresa((e.target as HTMLInputElement).value)} />
        <Input label="Segmento" value={segmento} onInput={(e) => setSegmento((e.target as HTMLInputElement).value)} />
        <Input label="Cidade" value={cidade} onInput={(e) => setCidade((e.target as HTMLInputElement).value)} />
        <Select label="Funil" value={funnelId} onChange={(e) => setFunnelId((e.target as HTMLSelectElement).value)}>
          <option value="">Padrão</option>
          {funnels?.funnels.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </Select>
        <Select
          label="Equipe"
          value={teamId}
          onChange={(e) => {
            setTeamId((e.target as HTMLSelectElement).value)
            setAssignedUserId('') // troca de equipe reseta o responsável
          }}
        >
          <option value="">Padrão (fila do setor)</option>
          {(teamsData?.teams ?? []).filter((t) => t.active).map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </Select>
        <Select label="Responsável" value={assignedUserId} onChange={(e) => setAssignedUserId((e.target as HTMLSelectElement).value)}>
          <option value="">Sem responsável</option>
          {responsibleOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </Select>
      </div>
    </Modal>
  )
}

type DetailTab = 'overview' | 'negociacao' | 'activities' | 'timeline' | 'fields' | 'tracking' | 'intel' | 'cadences'

export function LeadDetailModal({ id, onClose }: { id: number; onClose: () => void }) {
  const { data: lead, isLoading } = useLead(id)
  const [tab, setTab] = useState<DetailTab>('overview')
  const negActive = useModuleAccess('negotiations').status === 'allowed'
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [forceDeleteReg, setForceDeleteReg] = useState<number | null>(null)
  const [mergeOpen, setMergeOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const delMut = useDeleteLead()
  const dup = useDuplicateLead()
  const enrollLink = useEnrollmentLinkByLead()

  function handleEnrollmentLink() {
    enrollLink.mutate(id, {
      onSuccess: (r) => {
        if (r.url) {
          void navigator.clipboard.writeText(r.url).then(() => toast('Link de matrícula copiado', 'success'))
          window.open(r.url, '_blank')
        } else {
          toast('Lead não tem inscrição ativa', 'warning')
        }
      },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }
  const qualify = useQualifyLead()
  const unqualify = useUnqualifyLead()
  const resendReport = useResendLeadReport()

  function copyBriefing() {
    if (!lead) return
    const sc = lead.scores ?? {}
    const fd: Record<string, unknown> = lead.formData ?? {}
    const maturidade = (fd.maturidade as { label?: string } | string | undefined)
    const matLabel = typeof maturidade === 'string' ? maturidade : (maturidade?.label ?? '–')
    const solucao = fd.solucao as { nome?: string } | undefined
    const txt = [
      `BRIEFING — ${lead.empresa ?? '–'}`,
      `Contato: ${lead.nome ?? '–'} | WhatsApp: ${lead.whatsapp ?? '–'} | ${lead.email ?? '–'}`,
      `Segmento: ${lead.segmento ?? '–'} | ${lead.cidade ?? '–'}`,
      `Score: ${sc.geral ?? 0}/100 | Maturidade: ${matLabel}`,
      `Solução: ${solucao?.nome ?? '–'}`,
      `Status: ${lead.status ?? '–'}`,
    ].join('\n')
    navigator.clipboard.writeText(txt)
      .then(() => toast('Briefing copiado', 'success'))
      .catch(() => toast('Falha ao copiar briefing', 'danger'))
  }

  return (
    <>
      <Modal
        open
        onOpenChange={(o) => { if (!o) onClose() }}
        title={lead ? (lead.empresa ?? lead.nome ?? `Lead #${id}`) : `Lead #${id}`}
        description={lead?.uid ? `UID: ${lead.uid}` : undefined}
        size="xl"
        footer={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (lead?.qualifiedAt) {
                  unqualify.mutate(id, {
                    onSuccess: () => toast('Lead desqualificado', 'success'),
                    onError: (e: unknown) => toast((e as Error).message, 'danger'),
                  })
                } else {
                  qualify.mutate(id, {
                    onSuccess: () => toast('Lead qualificado', 'success'),
                    onError: (e: unknown) => toast((e as Error).message, 'danger'),
                  })
                }
              }}
              disabled={qualify.isPending || unqualify.isPending || !lead}
            >
              {lead?.qualifiedAt ? <><StarOff size={12} /> Desqualificar</> : <><Star size={12} /> Qualificar</>}
            </Button>
            <Button variant="ghost" size="sm" onClick={copyBriefing} disabled={!lead}>
              <ClipboardCopy size={12} /> Copiar briefing
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setEditOpen(true)} disabled={!lead}>
              <Pencil size={12} /> Editar
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setMergeOpen(true)} disabled={!lead}>
              <GitMerge size={12} /> Mesclar
            </Button>
            <Button variant="ghost" size="sm" onClick={handleEnrollmentLink} disabled={!lead || enrollLink.isPending}>
              <GraduationCap size={12} /> {enrollLink.isPending ? 'Buscando…' : 'Link matrícula'}
            </Button>
            {lead?.source === 'web_chat' && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => resendReport.mutate(id, {
                  onSuccess: () => toast('Relatório reenviado por e-mail', 'success'),
                  onError: (e: unknown) => toast((e as Error).message, 'danger'),
                })}
                disabled={resendReport.isPending}
              >
                <Send size={12} /> {resendReport.isPending ? 'Enviando…' : 'Reenviar relatório'}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => dup.mutate({ id }, {
                onSuccess: (r) => { toast('Lead duplicado', 'success'); onClose(); window.setTimeout(() => window.location.assign(`/app/leads/${r.id}`), 50) },
                onError: (e: unknown) => toast((e as Error).message, 'danger'),
              })}
              disabled={dup.isPending}
            >
              <Copy size={12} /> Duplicar
            </Button>
            <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)} disabled={delMut.isPending}>
              Excluir
            </Button>
          </>
        }
      >
        <nav class="flex gap-1 mb-4 border-b border-border">
          {[
            { id: 'overview' as DetailTab, label: 'Visão geral' },
            ...(negActive ? [{ id: 'negociacao' as DetailTab, label: 'Negociação' }] : []),
            { id: 'tracking' as DetailTab, label: 'Tracking' },
            { id: 'intel' as DetailTab, label: 'Inteligência' },
            { id: 'activities' as DetailTab, label: 'Atividades' },
            { id: 'cadences' as DetailTab, label: 'Cadências' },
            { id: 'timeline' as DetailTab, label: 'Timeline' },
            { id: 'fields' as DetailTab, label: 'Campos Personalizados' },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              class={cn(
                'px-3 h-9 text-sm font-medium border-b-2 transition-colors',
                tab === t.id ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:text-fg',
              )}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {isLoading && <Skeleton class="h-32 w-full" />}
        {lead && tab === 'overview' && (
          <OverviewTab lead={lead} />
        )}
        {lead && tab === 'negociacao' && <LeadNegotiationTab leadId={lead.id} />}
        {lead && tab === 'tracking' && <TrackingTab lead={lead} />}
        {lead && tab === 'intel' && <IntelTab leadId={lead.id} />}
        {lead && tab === 'activities' && <ActivitiesTab leadId={lead.id} />}
        {lead && tab === 'cadences' && <LeadCadencesTab leadId={lead.id} />}
        {lead && tab === 'timeline' && <TimelineTab leadId={lead.id} />}
        {lead && tab === 'fields' && <FieldsTab leadId={lead.id} customFields={lead.customFields} />}
      </Modal>

      {confirmDelete && (
        <ConfirmDialog
          open
          onOpenChange={(o) => { if (!o) { setConfirmDelete(false); setForceDeleteReg(null) } }}
          title={`Excluir lead "${lead?.empresa ?? id}"`}
          description={forceDeleteReg !== null
            ? `⚠️ Este lead tem ${forceDeleteReg} inscrição(ões) no portal de matrículas. Apagá-lo vai desvinculá-las — elas ficam órfãs no módulo de Matrículas (sem lead). Confirme para apagar mesmo assim.`
            : 'O lead vai para a lixeira e pode ser restaurado.'}
          destructive
          confirmLabel={forceDeleteReg !== null ? 'Apagar mesmo assim' : 'Excluir'}
          loading={delMut.isPending}
          onConfirm={() => delMut.mutate({ id, force: forceDeleteReg !== null }, {
            onSuccess: () => { toast('Lead movido para a lixeira', 'success'); setConfirmDelete(false); setForceDeleteReg(null); onClose() },
            onError: (e: unknown) => {
              const c = getRegistrationConflict(e)
              if (c && forceDeleteReg === null) setForceDeleteReg(c.count)
              else toast((e as Error).message, 'danger')
            },
          })}
        />
      )}

      {mergeOpen && lead && (
        <MergeLeadsModal
          masterId={id}
          masterName={lead.empresa ?? lead.nome ?? `Lead #${id}`}
          onClose={() => setMergeOpen(false)}
          onMerged={() => { setMergeOpen(false); onClose() }}
        />
      )}

      {editOpen && (
        <EditLeadModal id={id} onClose={() => setEditOpen(false)} />
      )}
    </>
  )
}

export { OverviewTab as LeadDetailOverviewTab }
function OverviewTab({
  lead,
}: {
  lead: NonNullable<ReturnType<typeof useLead>['data']>
}) {
  const { data: funnels } = useFunnelsQuery()
  const funnel = funnels?.funnels.find((f) => f.id === lead.funnelId)

  return (
    <div class="space-y-4">
      <div class="grid gap-3 grid-cols-1 sm:grid-cols-2">
        <Field label="Empresa" value={lead.empresa} />
        <Field label="Nome" value={lead.nome} />
        <Field label="WhatsApp" value={lead.whatsapp} />
        <Field label="E-mail" value={lead.email} />
        <Field label="Origem" value={leadSourceLabel(lead.source)} />
        <Field label="Criado em" value={formatDateTime(lead.createdAt)} />
        {lead.agendamento && (
          <Field label="Agendamento" value={formatDateTime(lead.agendamento.startAt)} />
        )}
        <Field label="Funil" value={funnel?.name ?? '—'} />
      </div>

      <AiSummaryPanel lead={lead} />

      <AiScorePanel lead={lead} />

      <LeadStagePicker leadId={lead.id} funnelId={lead.funnelId} currentStatus={lead.status} />

      <LeadTagsInline lead={lead} />

      <ScoreByPillar scores={lead.scores} />

      <DuplicatesHint leadId={lead.id} />

      <LeadNotesSection leadId={lead.id} />
    </div>
  )
}

function LeadStagePicker({
  leadId, funnelId, currentStatus,
}: {
  leadId: number
  funnelId: number | null
  currentStatus: string | null
}) {
  const { data: stagesData, isLoading } = useStages(funnelId)
  const updateStatus = useUpdateLeadStatus()
  const [pendingKey, setPendingKey] = useState<string | null>(null)

  const stages = (stagesData?.stages ?? []).filter((s) => s.active).sort((a, b) => a.position - b.position)
  const currentStage = stages.find((s) => s.key === currentStatus)
  const isOrphan = !!currentStatus && !currentStage && stages.length > 0

  function pick(stageKey: string) {
    if (stageKey === currentStatus || updateStatus.isPending) return
    setPendingKey(stageKey)
    updateStatus.mutate({ id: leadId, status: stageKey }, {
      onSuccess: () => toast('Status atualizado', 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
      onSettled: () => setPendingKey(null),
    })
  }

  if (!funnelId) {
    return (
      <div>
        <span class="text-xs font-medium text-fg-muted block mb-1.5">Status (etapa do funil)</span>
        <div class="rounded-md border border-dashed border-border p-3 text-xs text-fg-subtle">
          Lead sem funil definido. Atribua um funil para escolher a etapa.
        </div>
      </div>
    )
  }

  return (
    <div>
      <span class="text-xs font-medium text-fg-muted block mb-1.5">Status (etapa do funil)</span>
      {isLoading && <Skeleton class="h-9 w-full" />}
      {!isLoading && stages.length === 0 && (
        <div class="rounded-md border border-dashed border-border p-3 text-xs text-fg-subtle">
          Este funil não tem etapas ativas. Configure em Funis → Etapas.
        </div>
      )}
      {!isLoading && stages.length > 0 && (
        <div class="flex flex-wrap gap-1.5">
          {stages.map((s) => {
            const active = s.key === currentStatus
            const loading = pendingKey === s.key
            const color = s.color ?? '#5f6368'
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => pick(s.key)}
                disabled={updateStatus.isPending}
                class={cn(
                  'inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-xs font-medium transition-colors',
                  !active && 'bg-surface text-fg-muted border-border hover:text-fg disabled:opacity-50',
                  loading && 'opacity-70',
                )}
                style={active ? { background: `${color}1a`, color, borderColor: color } : undefined}
                aria-pressed={active}
              >
                <span class="size-2 rounded-full" style={{ background: color }} />
                {s.name}
                {loading && <span class="text-[0.6875rem]">…</span>}
              </button>
            )
          })}
        </div>
      )}
      {isOrphan && (
        <div class="mt-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-[0.6875rem] text-fg-muted">
          Status atual <strong class="text-fg">{currentStatus}</strong> não corresponde a nenhuma etapa ativa do funil. Selecione uma das etapas acima para corrigir.
        </div>
      )}
    </div>
  )
}

function LeadNotesSection({ leadId }: { leadId: number }) {
  const { data, isLoading } = useLeadNotes(leadId)
  const create = useCreateLeadNote()
  const [draft, setDraft] = useState('')

  function submit() {
    const content = draft.trim()
    if (!content) return
    create.mutate({ id: leadId, content }, {
      onSuccess: () => { setDraft(''); toast('Anotação registrada', 'success') },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  const notes = data?.notes ?? []

  return (
    <div class="space-y-3">
      <div>
        <span class="text-xs font-medium text-fg-muted block mb-1.5">Anotação interna</span>
        <Textarea
          label=""
          value={draft}
          onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
          placeholder="Escreva uma anotação para a equipe…"
          rows={3}
          disabled={create.isPending}
        />
        <div class="mt-2 flex items-center justify-between gap-2">
          <span class="text-[0.6875rem] text-fg-subtle">
            Toda anotação fica salva como histórico, com autor e data/hora — visível a todos os operadores.
          </span>
          <Button
            variant="primary"
            size="sm"
            onClick={submit}
            disabled={!draft.trim() || create.isPending}
          >
            {create.isPending ? 'Adicionando…' : 'Adicionar'}
          </Button>
        </div>
      </div>

      <div>
        <div class="text-[0.6875rem] uppercase tracking-wider text-fg-subtle font-medium mb-2">
          Histórico de anotações {notes.length > 0 && <span class="text-fg-muted normal-case tracking-normal">({notes.length})</span>}
        </div>
        {isLoading && <Skeleton class="h-20 w-full" />}
        {!isLoading && notes.length === 0 && (
          <div class="rounded-md border border-dashed border-border p-3 text-xs text-fg-subtle">
            Nenhuma anotação registrada ainda.
          </div>
        )}
        {!isLoading && notes.length > 0 && (
          <ul class="space-y-2">
            {notes.map((n) => {
              const isLegacy = !n.userName
              return (
                <li key={n.id} class="rounded-md border border-border bg-surface-2 p-3">
                  <div class="flex items-center justify-between gap-2 text-[0.6875rem] text-fg-subtle">
                    <span class={cn('font-medium', isLegacy ? 'italic text-fg-subtle' : 'text-fg-muted')}>
                      {isLegacy ? 'Autor desconhecido (anotação legada)' : n.userName}
                    </span>
                    <span>{formatDateTime(n.createdAt)}</span>
                  </div>
                  <div class="mt-1 text-sm text-fg whitespace-pre-wrap break-words">{n.content}</div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

function LeadTagsInline({ lead }: { lead: NonNullable<ReturnType<typeof useLead>['data']> }) {
  const { data: tagsData } = useTags(false)
  const addTags = useAddLeadTags()
  const removeTag = useRemoveLeadTag()
  const [picking, setPicking] = useState(false)

  const currentIds = new Set(lead.tags?.map((lt) => lt.tag.id) ?? [])
  const available = (tagsData?.tags ?? []).filter((t) => !currentIds.has(t.id))

  return (
    <div>
      <span class="text-xs font-medium text-fg-muted block mb-1.5">Etiquetas</span>
      <div class="flex flex-wrap gap-1.5 items-center">
        {(lead.tags ?? []).map(({ tag }) => (
          <span
            key={tag.id}
            class="inline-flex items-center gap-1 h-6 px-2 rounded-full text-xs font-medium"
            style={{ background: `${tag.color}22`, color: tag.color }}
          >
            <span class="size-1.5 rounded-full" style={{ background: tag.color }} />
            {tag.name}
            <button
              type="button"
              class="ml-1 size-3 grid place-items-center rounded-full hover:bg-current/10"
              onClick={() => removeTag.mutate({ leadId: lead.id, tagId: tag.id }, {
                onSuccess: () => toast(`Tag "${tag.name}" removida`, 'success'),
                onError: (e: unknown) => toast((e as Error).message, 'danger'),
              })}
              aria-label={`Remover tag ${tag.name}`}
              disabled={removeTag.isPending}
            >
              <XIcon size={10} />
            </button>
          </span>
        ))}
        <div class="relative">
          <button
            type="button"
            class="inline-flex items-center gap-1 h-6 px-2 rounded-full text-xs font-medium border border-dashed border-border text-fg-muted hover:bg-surface-3 hover:text-fg"
            onClick={() => setPicking((v) => !v)}
          >
            <Plus size={11} /> Tag
          </button>
          {picking && available.length > 0 && (
            <div class="absolute left-0 top-7 z-10 rounded-md border border-border bg-surface-2 shadow-lg p-2 min-w-48 max-w-64 max-h-64 overflow-y-auto">
              {available.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  class="flex items-center gap-2 w-full px-2 py-1 rounded text-left text-xs text-fg-muted hover:bg-surface-3"
                  onClick={() => {
                    addTags.mutate({ leadId: lead.id, tagIds: [t.id] }, {
                      onSuccess: () => { toast(`Tag "${t.name}" adicionada`, 'success'); setPicking(false) },
                      onError: (e: unknown) => toast((e as Error).message, 'danger'),
                    })
                  }}
                  disabled={addTags.isPending}
                >
                  <span class="size-2 rounded-full" style={{ background: t.color }} />
                  {t.name}
                </button>
              ))}
            </div>
          )}
          {picking && available.length === 0 && (
            <div class="absolute left-0 top-7 z-10 rounded-md border border-border bg-surface-2 shadow-lg p-2 min-w-48 text-xs text-fg-subtle">
              Todas as tags já estão aplicadas.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function DuplicatesHint({ leadId }: { leadId: number }) {
  const { data } = useLeadDuplicates(leadId)
  const { data: lead } = useLead(leadId)
  const [mergeOpen, setMergeOpen] = useState(false)
  if (!data || data.duplicates.length === 0) return null
  const count = data.duplicates.length
  return (
    <>
      <div class="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-fg-muted flex items-center gap-2 flex-wrap">
        <GitMerge size={14} class="text-warning shrink-0" />
        <span>
          Detectamos <strong class="text-fg">{count}</strong> possível{count === 1 ? '' : 'eis'} duplicata{count === 1 ? '' : 's'} deste lead.
        </span>
        <Button variant="secondary" size="sm" onClick={() => setMergeOpen(true)} class="ml-auto">
          <GitMerge size={12} /> Mesclar agora
        </Button>
      </div>
      {mergeOpen && lead && (
        <MergeLeadsModal
          masterId={leadId}
          masterName={lead.empresa ?? lead.nome ?? `Lead #${leadId}`}
          onClose={() => setMergeOpen(false)}
          onMerged={() => setMergeOpen(false)}
        />
      )}
    </>
  )
}

export { TrackingTab as LeadDetailTrackingTab }
function TrackingTab({ lead }: { lead: NonNullable<ReturnType<typeof useLead>['data']> }) {
  const hasMeta = !!(lead.campaignId ?? lead.campaignName ?? lead.adsetName ?? lead.adName)
  const hasGoogle = !!(lead.googleCampaignId ?? lead.googleCampaignName ?? lead.googleAdGroupName ?? lead.googleKeyword)
  const hasUtm = !!(lead.utmSource ?? lead.utmMedium ?? lead.utmCampaign)
  const hasClickIds = !!(lead.fbclid ?? lead.gclid ?? lead.ctwaClid)

  if (!hasMeta && !hasGoogle && !hasUtm && !hasClickIds && !lead.metaPageId && !lead.trackingVisitorId && !lead.trackableLinkId) {
    return <EmptyState title="Sem dados de tracking" description="Este lead não tem informações de campanha, UTM ou tracking ID." />
  }

  return (
    <div class="space-y-4">
      {hasMeta && (
        <Card>
          <CardHeader><CardTitle>Meta Ads</CardTitle></CardHeader>
          <div class="grid gap-3 grid-cols-1 sm:grid-cols-2 text-xs">
            <Field label="Página" value={lead.metaPageName ?? lead.metaPageId} />
            <Field label="Form ID" value={lead.metaFormId} />
            <Field label="Campanha" value={lead.campaignName ?? lead.campaignId} />
            <Field label="Adset" value={lead.adsetName ?? lead.adsetId} />
            <Field label="Anúncio" value={lead.adName ?? lead.adId} />
          </div>
        </Card>
      )}
      {hasGoogle && (
        <Card>
          <CardHeader><CardTitle>Google Ads</CardTitle></CardHeader>
          <div class="grid gap-3 grid-cols-1 sm:grid-cols-2 text-xs">
            <Field label="Campanha" value={lead.googleCampaignName ?? lead.googleCampaignId} />
            <Field label="Grupo de anúncios" value={lead.googleAdGroupName ?? lead.googleAdGroupId} />
            <Field label="Palavra-chave" value={lead.googleKeyword} />
            <Field label="Correspondência" value={lead.googleMatchType} />
            <Field label="Rede" value={lead.googleNetwork} />
            <Field label="Dispositivo" value={lead.googleDevice} />
          </div>
        </Card>
      )}
      {hasUtm && (
        <Card>
          <CardHeader><CardTitle>UTMs</CardTitle></CardHeader>
          <div class="grid gap-3 grid-cols-2 sm:grid-cols-3 text-xs">
            <Field label="utm_source" value={lead.utmSource} />
            <Field label="utm_medium" value={lead.utmMedium} />
            <Field label="utm_campaign" value={lead.utmCampaign} />
            <Field label="utm_content" value={lead.utmContent} />
            <Field label="utm_term" value={lead.utmTerm} />
          </div>
        </Card>
      )}
      {hasClickIds && (
        <Card>
          <CardHeader><CardTitle>IDs de clique</CardTitle></CardHeader>
          <div class="grid gap-3 grid-cols-1 sm:grid-cols-3 text-xs">
            <Field label="fbclid" value={lead.fbclid} />
            <Field label="gclid" value={lead.gclid} />
            <Field label="ctwa_clid" value={lead.ctwaClid} />
          </div>
        </Card>
      )}
      {(lead.trackingVisitorId ?? lead.trackableLinkId) && (
        <Card>
          <CardHeader><CardTitle>Outras atribuições</CardTitle></CardHeader>
          <div class="grid gap-3 grid-cols-1 sm:grid-cols-2 text-xs">
            <Field label="Tracking visitor ID" value={lead.trackingVisitorId} />
            <Field label="Trackable link ID" value={lead.trackableLinkId !== null && lead.trackableLinkId !== undefined ? `#${lead.trackableLinkId}` : null} />
          </div>
        </Card>
      )}
    </div>
  )
}

export { IntelTab as LeadDetailIntelTab }
function IntelTab({ leadId }: { leadId: number }) {
  // Mesmo componente usado no `IntelDetailModal` da página global Inteligência —
  // todas as ações (LGPD, scan rápido/completo, contestar/restaurar/excluir
  // fatos, baixar JSON/PDF, progresso ao vivo) ficam disponíveis aqui também.
  return <IntelLeadDetail leadId={leadId} />
}

export { ActivitiesTab as LeadDetailActivitiesTab }
type LeadActivityStatusFilter = 'all' | 'overdue' | 'today' | 'upcoming' | 'completed'

function bucketOf(a: Activity): LeadActivityStatusFilter | 'other' {
  if (a.status === 'completed' || a.status === 'sent') return 'completed'
  if (a.status === 'cancelled' || a.status === 'failed') return 'other'
  // status pending — classifica pela data
  if (isActivityOverdue(a)) return 'overdue'
  const d = new Date(a.scheduledAt)
  const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999)
  if (d.getTime() <= todayEnd.getTime()) return 'today'
  return 'upcoming'
}

function ActivitiesTab({ leadId }: { leadId: number }) {
  const { data: lead } = useLead(leadId)
  const { data, isLoading } = useLeadActivities(leadId)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<Activity | null>(null)
  const [editing, setEditing] = useState<Activity | null>(null)
  const [typeFilter, setTypeFilter] = useState<ActivityType | ''>('')
  const [statusFilter, setStatusFilter] = useState<LeadActivityStatusFilter>('all')

  const activities = data?.activities ?? []

  const counts = useMemo(() => {
    const c = { all: activities.length, overdue: 0, today: 0, upcoming: 0, completed: 0 }
    for (const a of activities) {
      const b = bucketOf(a)
      if (b !== 'other') c[b]++
    }
    return c
  }, [activities])

  const filtered = useMemo(() => {
    return activities.filter((a) => {
      if (typeFilter && a.type !== typeFilter) return false
      if (statusFilter !== 'all' && bucketOf(a) !== statusFilter) return false
      return true
    })
  }, [activities, typeFilter, statusFilter])

  const preselectedLead = lead
    ? {
        id: lead.id,
        label: lead.nome ?? lead.empresa ?? lead.whatsapp ?? `Lead #${lead.id}`,
        whatsapp: lead.whatsapp,
        email: lead.email,
      }
    : undefined

  const STATUS_CHIPS: { id: LeadActivityStatusFilter; label: string; color?: string; bg?: string }[] = [
    { id: 'all',       label: 'Todas' },
    { id: 'overdue',   label: 'Atrasadas',  color: '#ea4335', bg: '#fce8e6' },
    { id: 'today',     label: 'Hoje',       color: '#1a73e8', bg: '#e8f0fe' },
    { id: 'upcoming',  label: 'Próximas',   color: '#fa7b17', bg: '#feefe3' },
    { id: 'completed', label: 'Concluídas', color: '#34a853', bg: '#e6f4ea' },
  ]

  return (
    <div class="space-y-3">
      <div class="flex items-center justify-between gap-2">
        <div class="text-sm text-fg-muted">
          {activities.length === 0
            ? 'Nenhuma atividade agendada'
            : `${activities.length} atividade${activities.length === 1 ? '' : 's'}`}
        </div>
        <Button variant="primary" size="sm" onClick={() => setCreating(true)} disabled={!lead}>
          <Plus size={14} /> Nova
        </Button>
      </div>

      {/* Filtros de status (contagem em tempo real a partir das activities carregadas) */}
      <div class="flex flex-wrap gap-1.5">
        {STATUS_CHIPS.map((chip) => {
          const active = statusFilter === chip.id
          const n = counts[chip.id]
          return (
            <button
              key={chip.id}
              type="button"
              onClick={() => setStatusFilter(chip.id)}
              class={cn(
                'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border text-xs font-medium transition-colors',
                !active && 'bg-surface text-fg-muted border-border hover:text-fg',
                active && !chip.color && 'bg-accent/15 text-accent border-accent',
              )}
              style={active && chip.color ? { background: chip.bg, color: chip.color, borderColor: chip.color } : undefined}
              aria-pressed={active}
            >
              {chip.label}
              <span class={cn('tabular-nums', active ? 'opacity-80' : 'text-fg-subtle')}>
                {n}
              </span>
            </button>
          )
        })}
      </div>

      {/* Filtros de tipo */}
      <div class="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setTypeFilter('')}
          class={cn(
            'h-7 px-2.5 rounded-full border text-xs font-medium transition-colors',
            typeFilter === ''
              ? 'bg-accent/15 text-accent border-accent'
              : 'bg-surface text-fg-muted border-border hover:text-fg',
          )}
        >
          Todos os tipos
        </button>
        {(Object.keys(ACTIVITY_TYPE_META) as ActivityType[]).map((t) => {
          const meta = ACTIVITY_TYPE_META[t]
          const Icon = meta.icon
          const active = typeFilter === t
          return (
            <button
              key={t}
              type="button"
              onClick={() => setTypeFilter(t)}
              class={cn(
                'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border text-xs font-medium transition-colors',
                !active && 'bg-surface text-fg-muted border-border hover:text-fg',
              )}
              style={active ? { background: meta.bg, color: meta.color, borderColor: meta.color } : undefined}
            >
              <Icon size={10} /> {meta.label}
            </button>
          )
        })}
      </div>

      {isLoading && <Skeleton class="h-32 w-full" />}
      {!isLoading && filtered.length === 0 && (
        <EmptyState
          title="Nenhuma atividade"
          description={
            statusFilter !== 'all' || typeFilter
              ? 'Nada nesse filtro. Tente "Todas" ou outro tipo.'
              : 'As atividades agendadas para este lead aparecerão aqui.'
          }
        />
      )}
      {!isLoading && filtered.length > 0 && (
        <ul class="divide-y divide-border rounded-md border border-border overflow-hidden">
          {filtered.map((a) => (
            <ActivityRow key={a.id} activity={a} onEdit={() => setEditing(a)} onDelete={() => setDeleting(a)} />
          ))}
        </ul>
      )}

      {creating && preselectedLead && (
        <CreateActivityModal preselectedLead={preselectedLead} onClose={() => setCreating(false)} />
      )}
      {editing && <EditActivityModal activity={editing} onClose={() => setEditing(null)} />}
      {deleting && <DeleteActivityDialog activity={deleting} onClose={() => setDeleting(null)} />}
    </div>
  )
}

// Rótulos PT-BR das categorias de evento. Usado nos chips de filtro e no badge
// de cada evento da timeline. Inclui 'integration' (vem do backend) para que
// eventos de webhook/CSV/etc não apareçam com a string crua em inglês.
const HISTORY_CATEGORY_LABELS: Record<string, string> = {
  lifecycle:     'Ciclo de vida',
  communication: 'Comunicação',
  operator:      'Operador',
  system:        'Sistema',
  monitoring:    'Monitoramento',
  integration:   'Integração',
}

const HISTORY_CATEGORIES: { id: string; label: string }[] = [
  { id: 'lifecycle',     label: HISTORY_CATEGORY_LABELS.lifecycle! },
  { id: 'communication', label: HISTORY_CATEGORY_LABELS.communication! },
  { id: 'operator',      label: HISTORY_CATEGORY_LABELS.operator! },
  { id: 'system',        label: HISTORY_CATEGORY_LABELS.system! },
  { id: 'monitoring',    label: HISTORY_CATEGORY_LABELS.monitoring! },
  { id: 'integration',   label: HISTORY_CATEGORY_LABELS.integration! },
]

const HISTORY_CHANNELS: { id: string; label: string }[] = [
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'email', label: 'Email' },
  { id: 'sms', label: 'SMS' },
  { id: 'web', label: 'Web' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'telegram', label: 'Telegram' },
  { id: 'payment', label: 'Pagamento' },
]

export { TimelineTab as LeadDetailTimelineTab }
function TimelineTab({ leadId }: { leadId: number }) {
  const [category, setCategory] = useState<string | undefined>(undefined)
  const [channel, setChannel] = useState<string | undefined>(undefined)
  const { data, isLoading } = useLeadHistory(leadId, { category, channel })

  return (
    <div class="space-y-3">
      <div class="space-y-2">
        <div class="flex flex-wrap gap-1.5">
          <FilterChip label="Todas" active={!category} onClick={() => setCategory(undefined)} />
          {HISTORY_CATEGORIES.map((c) => (
            <FilterChip key={c.id} label={c.label} active={category === c.id} onClick={() => setCategory(c.id)} />
          ))}
        </div>
        <div class="flex flex-wrap gap-1.5">
          <FilterChip label="Todos canais" active={!channel} onClick={() => setChannel(undefined)} />
          {HISTORY_CHANNELS.map((c) => (
            <FilterChip key={c.id} label={c.label} active={channel === c.id} onClick={() => setChannel(c.id)} />
          ))}
        </div>
      </div>
      {isLoading && <Skeleton class="h-32 w-full" />}
      {!isLoading && (!data || data.events.length === 0) && (
        <EmptyState title="Sem eventos no histórico" description="Ajuste os filtros ou aguarde novas interações." />
      )}
      {!isLoading && data && data.events.length > 0 && (
        <div class="space-y-1 max-h-[26rem] overflow-y-auto">
          {data.events.map((e) => <TimelineEvent key={e.id} event={e} />)}
        </div>
      )}
    </div>
  )
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      class={`px-2.5 py-1 rounded-full text-[0.6875rem] font-medium border ${
        active ? 'border-accent bg-accent/10 text-accent' : 'border-border text-fg-muted hover:bg-surface-3'
      }`}
    >
      {label}
    </button>
  )
}

function TimelineEvent({ event }: { event: LeadHistoryEvent }) {
  const tone = event.category === 'lifecycle' ? 'accent' : event.category === 'operator' ? 'info' : 'neutral'
  // Capitaliza a primeira letra do fallback caso a categoria venha do backend
  // sem rótulo mapeado — evita texto cru em inglês ("monitoring") na UI.
  const categoryLabel = HISTORY_CATEGORY_LABELS[event.category]
    ?? (event.category.charAt(0).toUpperCase() + event.category.slice(1))
  return (
    <div class="flex gap-3 py-2 border-b border-border last:border-b-0">
      <div class="shrink-0 mt-0.5">
        <Badge tone={tone}>{categoryLabel}</Badge>
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-sm text-fg">{event.title}</div>
        {event.description && <div class="text-xs text-fg-muted mt-0.5">{event.description}</div>}
        {event.oldValue !== null && event.newValue !== null && (
          <div class="text-xs mt-1">
            <span class="text-danger line-through">{event.oldValue}</span>
            <span class="text-fg-subtle mx-1">→</span>
            <span class="text-success">{event.newValue}</span>
          </div>
        )}
        <div class="text-[0.6875rem] text-fg-subtle mt-1">
          {event.actorName && <span class="mr-2">{event.actorName}</span>}
          {formatDateTime(event.createdAt)}
        </div>
      </div>
    </div>
  )
}

export { FieldsTab as LeadDetailFieldsTab }
function FieldsTab({ customFields }: { leadId: number; customFields: Record<string, unknown> | null }) {
  const { data, isLoading } = useCustomFields()

  if (isLoading) return <Skeleton class="h-32 w-full" />
  if (!data || data.fields.length === 0) {
    return <EmptyState title="Nenhum campo personalizado configurado" description="Configure campos em Configurações → Campos personalizados." />
  }

  // agrupar por group
  const grouped: Record<string, typeof data.fields> = {}
  for (const f of data.fields) {
    if (!f.active) continue
    const list = grouped[f.group] ?? []
    list.push(f)
    grouped[f.group] = list
  }

  function readValue(key: string): string {
    const v = customFields?.[key]
    if (v === null || v === undefined || v === '') return '—'
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v)
    try { return JSON.stringify(v) } catch { return '—' }
  }

  return (
    <div class="space-y-4">
      {Object.entries(grouped).map(([group, fields]) => (
        <div key={group}>
          <div class="text-[0.6875rem] uppercase tracking-wider text-fg-subtle font-medium mb-2">{group}</div>
          <div class="grid gap-3 grid-cols-1 sm:grid-cols-2">
            {fields.map((f) => (
              <Field key={f.id} label={f.label} value={readValue(f.key)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div class="text-[0.6875rem] text-fg-subtle uppercase tracking-wider">{label}</div>
      <div class="text-sm text-fg truncate">{value ?? '—'}</div>
    </div>
  )
}

const AI_SCORE_TONE = {
  hot: { bg: 'bg-success/15', fg: 'text-success', txt: 'Quente' },
  warm: { bg: 'bg-warning/15', fg: 'text-warning', txt: 'Morno' },
  cold: { bg: 'bg-fg-subtle/15', fg: 'text-fg-muted', txt: 'Frio' },
} as const

function aiScoreTone(label: string | null): { bg: string; fg: string; txt: string } {
  if (label === 'hot') return AI_SCORE_TONE.hot
  if (label === 'warm') return AI_SCORE_TONE.warm
  return AI_SCORE_TONE.cold
}

function AiScoreBadge({ score, label }: { score: number | null; label: string | null }) {
  if (score === null || score === undefined) {
    return <span class="text-fg-subtle text-xs">—</span>
  }
  const tone = aiScoreTone(label)
  return (
    <span class={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${tone.bg} ${tone.fg}`} title={`Lead Score por IA: ${score} (${tone.txt})`}>
      <Sparkles size={11} /> {score}
    </span>
  )
}

// Card "Resumo do Lead (IA)" — resumo em linguagem natural das RESPOSTAS dos
// campos personalizados (no contexto do negócio/funil). Vem ACIMA do score e é
// gerado na MESMA chamada de IA (campo aiScoreReason.resumoRespostas) — custo zero.
function AiSummaryPanel({ lead }: { lead: { id: number; aiScoreReason: AiScoreReason | null; aiScoredAt: string | null } }) {
  const rescore = useRescoreLeadAi()
  const resumo = lead.aiScoreReason?.resumoRespostas?.trim()

  function handleRefresh() {
    rescore.mutate(lead.id, {
      onSuccess: () => toast('Resumo atualizado', 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <div class="rounded-lg border border-border bg-surface p-4">
      <div class="flex items-start justify-between gap-3">
        <div class="flex items-center gap-2 text-sm font-semibold text-fg">
          <Sparkles size={15} class="text-accent" /> Resumo do Lead (IA)
        </div>
        <Button size="sm" variant="secondary" onClick={handleRefresh} disabled={rescore.isPending}>
          <RefreshCw size={12} class={rescore.isPending ? 'animate-spin' : ''} />
          {rescore.isPending ? 'Gerando…' : 'Atualizar'}
        </Button>
      </div>

      {resumo ? (
        <>
          <p class="mt-3 text-sm leading-relaxed text-fg">{resumo}</p>
          {lead.aiScoredAt && (
            <div class="mt-2 text-[0.6875rem] text-fg-subtle">
              Síntese das respostas dos campos personalizados · {formatDateTime(lead.aiScoredAt)}
            </div>
          )}
        </>
      ) : (
        <div class="mt-3 text-sm text-fg-muted">
          Sem resumo ainda. Ele é gerado junto com o Lead Score quando o lead tem respostas de
          campos personalizados. Use <strong>Atualizar</strong> ou aguarde a análise automática.
        </div>
      )}
    </div>
  )
}

// Card do Lead Score preditivo por IA no detalhe do lead (Fase 3).
function AiScorePanel({ lead }: { lead: { id: number; aiScore: number | null; aiScoreLabel: string | null; aiScoreReason: AiScoreReason | null; aiScoredAt: string | null } }) {
  const rescore = useRescoreLeadAi()
  const r = lead.aiScoreReason
  const tone = aiScoreTone(lead.aiScoreLabel)

  function handleRescore() {
    rescore.mutate(lead.id, {
      onSuccess: (d) => toast(d.aiScore != null ? `Score recalculado: ${d.aiScore}` : 'Score recalculado', 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  return (
    <div class="rounded-lg border border-border bg-surface p-4">
      <div class="flex items-start justify-between gap-3">
        <div class="flex items-center gap-2 text-sm font-semibold text-fg">
          <Sparkles size={15} class="text-accent" /> Lead Score preditivo (IA)
        </div>
        <Button size="sm" variant="secondary" onClick={handleRescore} disabled={rescore.isPending}>
          <RefreshCw size={12} class={rescore.isPending ? 'animate-spin' : ''} />
          {rescore.isPending ? 'Calculando…' : 'Recalcular'}
        </Button>
      </div>

      {lead.aiScore === null || lead.aiScore === undefined ? (
        <div class="mt-3 text-sm text-fg-muted">
          Ainda sem score da IA. Use <strong>Recalcular</strong> ou aguarde a análise automática na entrada do lead.
          {' '}Configure o <strong>Contexto do Negócio</strong> em Configurações &gt; Inteligência para análises melhores.
        </div>
      ) : (
        <div class="mt-3 space-y-3">
          <div class="flex items-center gap-3">
            <div class={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-xl font-bold ${tone.bg} ${tone.fg}`}>
              {lead.aiScore}
            </div>
            <div class="min-w-0">
              <div class={`text-sm font-semibold ${tone.fg}`}>{tone.txt}</div>
              {r && (
                <div class="text-xs text-fg-muted">
                  Chance estimada: {Math.round((r.probability ?? 0) * 100)}% · confiança {Math.round((r.confidence ?? 0) * 100)}%
                </div>
              )}
              {lead.aiScoredAt && (
                <div class="text-[0.6875rem] text-fg-subtle">
                  Atualizado {formatDateTime(lead.aiScoredAt)}{r ? ` · ${r.phase === 'definitive' ? 'definitivo' : r.phase === 'manual' ? 'manual' : 'provisório'}` : ''}
                </div>
              )}
            </div>
          </div>

          {r?.summary && <div class="text-sm text-fg">{r.summary}</div>}

          {r && (r.positives?.length > 0 || r.risks?.length > 0) && (
            <div class="grid gap-3 sm:grid-cols-2">
              {r.positives?.length > 0 && (
                <div>
                  <div class="text-[0.6875rem] font-semibold uppercase tracking-wider text-success mb-1">Sinais a favor</div>
                  <ul class="space-y-1 text-xs text-fg-muted">
                    {r.positives.map((p, i) => <li key={i}>• {p}</li>)}
                  </ul>
                </div>
              )}
              {r.risks?.length > 0 && (
                <div>
                  <div class="text-[0.6875rem] font-semibold uppercase tracking-wider text-danger mb-1">Riscos</div>
                  <ul class="space-y-1 text-xs text-fg-muted">
                    {r.risks.map((p, i) => <li key={i}>• {p}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}

          {r && (
            <div class="text-[0.6875rem] text-fg-subtle border-t border-border pt-2">
              {r.provider}/{r.model} · ~US$ {Number(r.costUsd ?? 0).toFixed(5)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ───────────────────────────────────────────────
// EditLeadModal — campos básicos de contato
// ───────────────────────────────────────────────

// Opções de um campo select personalizado podem vir como [{label,value}] ou ["a","b"].
function normalizeCfOptions(raw: unknown): Array<{ label: string; value: string }> {
  if (!Array.isArray(raw)) return []
  return raw
    .map((o: any) => typeof o === 'string'
      ? { label: o, value: o }
      : { label: String(o?.label ?? o?.value ?? ''), value: String(o?.value ?? o?.label ?? '') })
    .filter((o) => o.value !== '')
}

// Input de um campo personalizado no editar-lead, respeitando o tipo do campo.
function CustomFieldEditInput({ field, value, onChange }: { field: any; value: string; onChange: (v: string) => void }) {
  const t = String(field.type || 'text')
  if (t === 'select' || t === 'multiselect') {
    const opts = normalizeCfOptions(field.options)
    return (
      <Select label={field.label} value={value} onChange={(e) => onChange((e.target as HTMLSelectElement).value)}>
        <option value="">—</option>
        {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </Select>
    )
  }
  if (t === 'textarea') {
    return <Textarea label={field.label} value={value} rows={2} onInput={(e) => onChange((e.target as HTMLTextAreaElement).value)} />
  }
  if (t === 'checkbox') {
    return (
      <label class="flex items-center gap-2 text-sm text-fg sm:mt-6">
        <input type="checkbox" checked={value === 'true'} onChange={(e) => onChange((e.target as HTMLInputElement).checked ? 'true' : 'false')} />
        {field.label}
      </label>
    )
  }
  const inputType = t === 'number' || t === 'currency' ? 'number' : t === 'date' ? 'date' : t === 'email' ? 'email' : t === 'url' ? 'url' : 'text'
  return <Input label={field.label} type={inputType} value={value} onInput={(e) => onChange((e.target as HTMLInputElement).value)} />
}

export function EditLeadModal({ id, onClose }: { id: number; onClose: () => void }) {
  const { data: lead, isLoading } = useLead(id)
  const { data: cfData } = useCustomFields()
  const update = useUpdateLeadContact()
  const updateCf = useUpdateLeadCustomFields()
  const [form, setForm] = useState<LeadContactInput>({})
  const [cf, setCf] = useState<Record<string, string>>({})
  const [initialized, setInitialized] = useState(false)

  // Campos personalizados editáveis manualmente: os marcados como visíveis na
  // LISTA de leads ou no CARD do Kanban (showInList/showInKanban). Assim, todo
  // campo que o usuário escolheu exibir pode também ser preenchido à mão aqui.
  const editableCustom = (cfData?.fields ?? []).filter(
    (f) => f.active && (f.showInList !== false || f.showInKanban === true),
  )

  if (lead && !initialized) {
    setForm({
      empresa: lead.empresa ?? '',
      nome: lead.nome ?? '',
      whatsapp: lead.whatsapp ?? '',
      email: lead.email ?? '',
      segmento: lead.segmento ?? '',
      cidade: lead.cidade ?? '',
    })
    const cfv = (lead.customFields ?? {}) as Record<string, unknown>
    const initCf: Record<string, string> = {}
    for (const f of editableCustom) {
      const v = cfv[f.key]
      initCf[f.key] = v === null || v === undefined ? '' : String(v)
    }
    setCf(initCf)
    setInitialized(true)
  }

  function set<K extends keyof LeadContactInput>(key: K, v: LeadContactInput[K]) {
    setForm((f) => ({ ...f, [key]: v }))
  }
  function setCustom(key: string, v: string) {
    setCf((c) => ({ ...c, [key]: v }))
  }

  function finish() { toast('Lead atualizado', 'success'); onClose() }

  function save() {
    if (!form.nome?.trim() || !form.whatsapp?.trim() || !form.email?.trim()) {
      toast('Nome, WhatsApp e e-mail são obrigatórios', 'danger')
      return
    }
    update.mutate({ id, ...form }, {
      onSuccess: () => {
        // Persiste os campos personalizados editáveis (merge no backend; vazio limpa).
        if (editableCustom.length > 0) {
          const payload: Record<string, unknown> = {}
          for (const f of editableCustom) payload[f.key] = cf[f.key] ?? ''
          updateCf.mutate({ id, fields: payload }, {
            onSuccess: finish,
            onError: (e: unknown) => toast((e as Error).message, 'danger'),
          })
        } else { finish() }
      },
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  const saving = update.isPending || updateCf.isPending

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={`Editar lead${lead?.nome ? ` — ${lead.nome}` : ''}`}
      size="lg"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={save} disabled={saving || isLoading}>
            {saving ? 'Salvando…' : 'Salvar'}
          </Button>
        </>
      }
    >
      {isLoading && <Skeleton class="h-32 w-full" />}
      {lead && (
        <div class="space-y-4">
          <div class="grid gap-3 grid-cols-1 sm:grid-cols-2">
            <Input label="Nome *" value={form.nome ?? ''} onInput={(e) => set('nome', (e.target as HTMLInputElement).value)} />
            <Input label="WhatsApp *" value={form.whatsapp ?? ''} onInput={(e) => set('whatsapp', (e.target as HTMLInputElement).value)} />
            <Input label="E-mail *" type="email" value={form.email ?? ''} onInput={(e) => set('email', (e.target as HTMLInputElement).value)} />
            <Input label="Empresa" value={form.empresa ?? ''} onInput={(e) => set('empresa', (e.target as HTMLInputElement).value)} />
            <Input label="Segmento" value={form.segmento ?? ''} onInput={(e) => set('segmento', (e.target as HTMLInputElement).value)} />
            <Input label="Cidade" value={form.cidade ?? ''} onInput={(e) => set('cidade', (e.target as HTMLInputElement).value)} />
          </div>

          {editableCustom.length > 0 && (
            <div>
              <div class="text-[0.6875rem] uppercase tracking-wider text-fg-subtle font-medium mb-2">Campos personalizados</div>
              <div class="grid gap-3 grid-cols-1 sm:grid-cols-2">
                {editableCustom.map((f) => (
                  <CustomFieldEditInput key={f.id} field={f} value={cf[f.key] ?? ''} onChange={(v) => setCustom(f.key, v)} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

// ───────────────────────────────────────────────
// LeadAnswersModal — respostas do diagnóstico web_chat (ANSWER_MAP)
// ───────────────────────────────────────────────

interface AnswerField {
  key: string
  label: string
  long?: boolean
  array?: boolean
  values?: Record<string, string>
}

interface AnswerSection {
  section: string
  icon: string
  fields: AnswerField[]
}

const ANSWER_MAP: AnswerSection[] = [
  { section: 'Informações básicas', icon: '👤', fields: [
    { key: 'nome', label: 'Nome' },
    { key: 'empresa', label: 'Empresa' },
    { key: 'whatsapp', label: 'WhatsApp' },
    { key: 'email', label: 'E-mail' },
    { key: 'site', label: 'Site' },
    { key: 'instagram', label: 'Instagram' },
    { key: 'segmento', label: 'Segmento' },
    { key: 'cidade', label: 'Cidade / Estado' },
    { key: 'tamanho', label: 'Tamanho da empresa', values: { solopreneur: 'Solopreneur / MEI', micro: 'Micro (2-10)', pequena: 'Pequena (11-30)', media: 'Média (30+)' } },
    { key: 'tempo', label: 'Tempo de mercado', values: { menos1: 'Menos de 1 ano', '1a3': '1 a 3 anos', '3a7': '3 a 7 anos', mais7: 'Mais de 7 anos' } },
  ] },
  { section: 'Momento atual', icon: '📍', fields: [
    { key: 'desafio', label: 'Principal desafio', long: true },
    { key: 'momento', label: 'Momento da empresa', values: { crescendo: 'Crescendo mas desorganizada', estagnada: 'Estagnada', caindo: 'Faturamento caindo', inicio: 'Apenas começando' } },
    { key: 'meta', label: 'Meta dos próximos 3-6 meses', long: true },
    { key: 'dificuldades', label: 'Áreas com dificuldade', array: true, values: { marketing: 'Marketing', vendas: 'Vendas', posicionamento: 'Posicionamento', processo: 'Processos', tecnologia: 'Tecnologia', dados: 'Dados', equipe: 'Equipe', financeiro: 'Financeiro' } },
  ] },
  { section: 'Marketing e captação', icon: '📢', fields: [
    { key: 'investe_mkt', label: 'Investe em marketing?', values: { 'sim-pago': 'Sim, tráfego pago', 'sim-organico': 'Sim, orgânico', 'sim-ambos': 'Sim, ambos', nao: 'Não investe' } },
    { key: 'canais', label: 'Canais ativos', array: true, values: { instagram: 'Instagram', google: 'Google Ads', meta: 'Meta Ads', youtube: 'YouTube', tiktok: 'TikTok', email: 'E-mail', whatsapp: 'WhatsApp', indicacao: 'Indicação' } },
    { key: 'resultado_positivo', label: 'O que já trouxe resultado', long: true },
    { key: 'resultado_negativo', label: 'O que não funcionou', long: true },
    { key: 'dificuldade_leads', label: 'Dificuldade em gerar leads?', values: { 'sim-muito': 'Muita dificuldade', 'sim-pouco': 'Alguma dificuldade', 'nao-mas': 'Gera, mas não converte', nao: 'Não, está bom' } },
    { key: 'tem_site', label: 'Possui site/landing page?', values: { 'sim-bom': 'Sim, bem estruturado', 'sim-fraco': 'Sim, mas fraco', construindo: 'Em construção', nao: 'Não possui' } },
    { key: 'tem_criativos', label: 'Produz conteúdo?', values: { 'sim-consistente': 'Sim, consistente', 'sim-esporadico': 'Sim, esporádico', raramente: 'Raramente', nao: 'Não' } },
  ] },
  { section: 'Oferta e posicionamento', icon: '🎯', fields: [
    { key: 'produto', label: 'Principal produto/serviço', long: true },
    { key: 'diferencial', label: 'Diferencial percebido', long: true },
    { key: 'mercado_entende', label: 'Mercado entende o diferencial?', values: { sim: 'Sim, claramente', parcialmente: 'Parcialmente', nao: 'Não', 'nao-sei': 'Não sei' } },
    { key: 'prova_social', label: 'Prova social?', values: { 'sim-forte': 'Muitas e fortes', 'sim-fraca': 'Poucas/fracas', construindo: 'Construindo', nao: 'Não possui' } },
    { key: 'forca_oferta', label: 'Força da oferta', values: { 'muito-forte': 'Muito forte', boa: 'Boa, pode melhorar', fraca: 'Fraca/confusa', reformulando: 'Reformulando' } },
    { key: 'upsell', label: 'Upsell/produto complementar?', values: { 'sim-estruturado': 'Sim, estruturado', 'sim-informal': 'Sim, informal', 'nao-mas-quero': 'Não, mas quero', nao: 'Não' } },
  ] },
  { section: 'Vendas e comercial', icon: '💼', fields: [
    { key: 'atendimento', label: 'Como leads são atendidos', long: true },
    { key: 'time_comercial', label: 'Time comercial?', values: { 'sim-estruturado': 'Sim, estruturado', 'sim-informal': 'Sim, informal', 'apenas-eu': 'Apenas eu', nao: 'Não tem' } },
    { key: 'funil', label: 'Funil de vendas?', values: { 'sim-documentado': 'Sim, documentado', 'sim-informal': 'Sim, informal', parcial: 'Parcial', nao: 'Não tem' } },
    { key: 'perde_vendas', label: 'Perde vendas por falta de processo?', values: { 'sim-muito': 'Sim, frequentemente', 'sim-pouco': 'Às vezes', raramente: 'Raramente', nao: 'Não' } },
    { key: 'usa_crm', label: 'Usa CRM?', values: { 'sim-ativo': 'Sim, ativo', 'sim-pouco': 'Sim, pouco usado', planilha: 'Só planilha', nada: 'Nada' } },
  ] },
  { section: 'Dados e gestão', icon: '📊', fields: [
    { key: 'acompanha_numeros', label: 'Acompanha números?', values: { 'sim-bem': 'Controle total', 'sim-basico': 'Básico', pouco: 'Pouco', nao: 'Não' } },
    { key: 'numeros_conhece', label: 'Números que acompanha', array: true, values: { faturamento: 'Faturamento', cac: 'CAC', cpl: 'CPL', conversao: 'Conversão', ticket: 'Ticket médio', churn: 'Churn', roas: 'ROAS', nenhum: 'Nenhum' } },
    { key: 'falta_clareza', label: 'Falta clareza nos dados?', values: { 'sim-muito': 'Muita', 'sim-pouco': 'Um pouco', nao: 'Não', 'nao-uso': 'Não uso dados' } },
    { key: 'usa_ferramentas', label: 'Ferramentas que usa', array: true, values: { planilha: 'Planilha', dashboard: 'Dashboard', crm: 'CRM', erp: 'ERP', automacao: 'Automação', nenhuma: 'Nenhuma' } },
    { key: 'problemas_op', label: 'Problemas operacionais', long: true },
  ] },
  { section: 'Capacidade de execução', icon: '🚀', fields: [
    { key: 'produz_video', label: 'Produz vídeos/conteúdo?', values: { 'sim-frequencia': 'Com frequência', 'sim-dificuldade': 'Com dificuldade', raramente: 'Raramente', nao: 'Não' } },
    { key: 'apoio_interno', label: 'Apoio interno para marketing?', values: { 'sim-dedicado': 'Pessoa dedicada', 'sim-parcial': 'Parcial', 'tudo-eu': 'Faço tudo', nao: 'Não tem' } },
    { key: 'capacidade', label: 'Capacidade para mais demanda?', values: { 'sim-facilidade': 'Facilmente', 'sim-esforco': 'Com esforço', 'no-limite': 'No limite', nao: 'Não' } },
    { key: 'orcamento', label: 'Orçamento para crescimento?', values: { disponivel: 'Tem orçamento', limitado: 'Limitado', 'precisa-roi': 'Precisa ver ROI', 'nao-tem': 'Sem orçamento' } },
    { key: 'faixa_investimento', label: 'Faixa de investimento mensal', values: { '0': 'Sem orçamento definido', '1': 'Até R$1.000/mês', '2': 'R$1.000–2.500/mês', '3': 'R$2.500–5.000/mês', '4': 'R$5.000–10.000/mês', '5': 'R$10.000–20.000/mês', '6': 'Acima de R$20.000/mês' } },
  ] },
]

function formatAnswer(field: AnswerField, val: unknown): preact.ComponentChildren {
  if (val === undefined || val === null || val === '') {
    return <span class="text-fg-subtle italic">Não respondido</span>
  }
  if (field.array && Array.isArray(val)) {
    return (
      <div class="flex flex-wrap gap-1">
        {val.map((v) => {
          const k = typeof v === 'string' || typeof v === 'number' ? String(v) : ''
          return (
            <span key={k} class="inline-flex px-2 py-0.5 rounded-full text-[0.6875rem] bg-surface-3 text-fg">
              {field.values?.[k] ?? k}
            </span>
          )
        })}
      </div>
    )
  }
  const s = typeof val === 'string' || typeof val === 'number' ? String(val) : ''
  if (field.values) return field.values[s] ?? s
  return s
}

function LeadAnswersModal({ id, onClose }: { id: number; onClose: () => void }) {
  const { data: lead, isLoading } = useLead(id)
  const fd: Record<string, unknown> = lead?.formData ?? {}
  const sc = lead?.scores ?? {}
  const completed = (lead as { completed?: boolean } | null | undefined)?.completed ?? false
  const lastStep = (lead as { lastStep?: number } | null | undefined)?.lastStep ?? 0
  const visaoGeral = (lead?.analysis as { visaoGeral?: string } | null | undefined)?.visaoGeral

  const pillarColors = ['#1a73e8', '#34a853', '#9334e6', '#f9ab00', '#ea4335', '#e91e63', '#00bcd4', '#ff9800']

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title={lead?.nome ?? lead?.empresa ?? `Lead #${id}`}
      description={lead?.empresa ? `${lead.empresa}${lead.segmento ? ` · ${lead.segmento}` : ''}` : undefined}
      size="xl"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>Fechar</Button>
          {lead?.whatsapp && <SendWhatsAppButton leadId={id} whatsapp={lead.whatsapp} onSent={onClose} />}
        </>
      }
    >
      {isLoading && <Skeleton class="h-64 w-full" />}
      {lead && (
        <div class="space-y-5">
          {/* Score block */}
          <div class="rounded-md border border-border bg-surface-2 p-4">
            <div class="flex items-center justify-between mb-3">
              <span class="text-sm font-medium text-fg">Score geral</span>
              <span class="text-2xl font-medium text-accent tabular-nums">
                {Number(sc.geral ?? 0)}<span class="text-xs text-fg-muted ml-1">/100</span>
              </span>
            </div>
            <div class="space-y-2">
              {Object.keys(sc).filter((k) => k !== 'geral').map((k, i) => {
                const color = pillarColors[i % pillarColors.length]
                const v = Number(sc[k] ?? 0)
                return (
                  <div key={k} class="flex items-center gap-2">
                    <span class="w-24 text-xs text-fg-muted font-medium shrink-0 capitalize">{k}</span>
                    <div class="flex-1 h-1.5 bg-surface-3 rounded-full overflow-hidden">
                      <div class="h-full rounded-full" style={{ width: `${v}%`, background: color }} />
                    </div>
                    <span class="text-xs font-medium tabular-nums w-8 text-right" style={{ color }}>{v}</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Sections */}
          {ANSWER_MAP.map((sec, idx) => {
            const reached = completed || idx <= lastStep
            return (
              <div key={sec.section}>
                <div class="flex items-center gap-2 mb-2">
                  <span class="text-base">{sec.icon}</span>
                  <span class="text-xs font-medium text-accent uppercase tracking-wider">{sec.section}</span>
                  {!reached && (
                    <span class="ml-auto text-[0.6875rem] text-fg-subtle bg-surface-3 px-2 py-0.5 rounded">Não preenchido</span>
                  )}
                </div>
                <div class="grid gap-2 grid-cols-1 sm:grid-cols-2">
                  {sec.fields.map((f) => {
                    const val = fd[f.key]
                    const isLong = Boolean(f.long && val)
                    return (
                      <div
                        key={f.key}
                        class={cn(
                          'rounded-md border border-border bg-surface p-3',
                          isLong && 'sm:col-span-2',
                        )}
                      >
                        <div class="text-[0.6875rem] text-fg-muted font-medium mb-1">{f.label}</div>
                        <div class="text-sm text-fg whitespace-pre-wrap">
                          {reached ? formatAnswer(f, val) : <span class="text-fg-subtle italic">Etapa não alcançada</span>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}

          {/* Diagnóstico IA */}
          {visaoGeral && (
            <div>
              <div class="flex items-center gap-2 mb-2">
                <span class="text-base">🧠</span>
                <span class="text-xs font-medium text-accent uppercase tracking-wider">Diagnóstico da IA</span>
              </div>
              <div class="rounded-md border border-border bg-surface p-4 text-sm text-fg whitespace-pre-wrap max-h-80 overflow-y-auto leading-relaxed">
                {visaoGeral}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}



// Lead Routing: atribuir responsável em lote.
// Modo "single" — todos os leads vão pra 1 agente.
// Modo "rodízio" — distribui alternadamente entre 2+ agentes selecionados (chunks paralelos).
function BulkAssignAgentModal({
  leadIds, onClose, onDone,
}: { leadIds: number[]; onClose: () => void; onDone: () => void }) {
  const { data: agentsData, isLoading } = useAgents()
  const qc = useQueryClient()
  const [mode, setMode] = useState<'single' | 'rotate'>('single')
  const [singleUserId, setSingleUserId] = useState<number | null>(null)
  const [rotateUserIds, setRotateUserIds] = useState<number[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })

  const allAgents = (agentsData?.agents ?? []).filter((a) => a.isAgent && a.active)

  const toggleRotate = (userId: number) => {
    setRotateUserIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId],
    )
  }

  const handleApply = async () => {
    if (leadIds.length === 0) return
    let plan: Array<{ leadId: number; userId: number }> = []
    if (mode === 'single') {
      if (!singleUserId) {
        toast('Selecione um agente', 'danger')
        return
      }
      plan = leadIds.map((leadId) => ({ leadId, userId: singleUserId }))
    } else {
      if (rotateUserIds.length < 2) {
        toast('Selecione pelo menos 2 agentes para o rodízio', 'danger')
        return
      }
      plan = leadIds.map((leadId, idx) => ({
        leadId,
        userId: rotateUserIds[idx % rotateUserIds.length]!,
      }))
    }

    setSubmitting(true)
    setProgress({ done: 0, total: plan.length })

    const CHUNK = 5
    let failed = 0
    let done = 0
    for (let i = 0; i < plan.length; i += CHUNK) {
      const chunk = plan.slice(i, i + CHUNK)
      const results = await Promise.allSettled(
        chunk.map((item) =>
          api.post(`/atendimento/tickets/${item.leadId}/assign`, { userId: item.userId }),
        ),
      )
      for (const r of results) {
        done++
        if (r.status === 'rejected') failed++
      }
      setProgress({ done, total: plan.length })
    }

    qc.invalidateQueries({ queryKey: ['leads'] })
    qc.invalidateQueries({ queryKey: ['kanban'] })

    if (failed === 0) {
      toast(`${plan.length} leads atribuídos`, 'success')
    } else {
      toast(`${plan.length - failed}/${plan.length} atribuídos (${failed} falharam)`, 'danger')
    }
    setSubmitting(false)
    onDone()
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o && !submitting) onClose() }}
      title={`Atribuir responsável — ${leadIds.length} leads`}
      description="Escolha o modo: tudo pra 1 agente ou distribuição em rodízio entre vários."
      size="lg"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button variant="primary" size="sm" onClick={handleApply} disabled={submitting || isLoading}>
            {submitting ? `Aplicando ${progress.done}/${progress.total}…` : 'Aplicar'}
          </Button>
        </>
      }
    >
      <div class="space-y-4">
        <div class="flex bg-surface-3 border border-border rounded p-0.5 w-fit">
          {(['single', 'rotate'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              disabled={submitting}
              class={`px-3 py-1.5 text-xs rounded transition-colors ${
                mode === m ? 'bg-accent text-fg-on-brand' : 'text-fg-muted hover:text-fg'
              }`}
            >
              {m === 'single' ? 'Atribuir a 1 agente' : 'Rodízio entre vários'}
            </button>
          ))}
        </div>

        {isLoading ? (
          <Skeleton class="h-32 w-full" />
        ) : allAgents.length === 0 ? (
          <div class="text-sm text-fg-muted bg-surface-2 border border-border rounded p-3">
            Nenhum agente ativo encontrado. Configure agentes em Cadastros &gt; Roteamento de Leads.
          </div>
        ) : mode === 'single' ? (
          <div>
            <div class="text-xs text-fg-muted mb-2">Todos os {leadIds.length} leads vão para:</div>
            <div class="space-y-1 max-h-72 overflow-y-auto">
              {allAgents.map((a) => (
                <label key={a.id} class="flex items-center gap-2 p-2 rounded hover:bg-surface-2 cursor-pointer">
                  <input
                    type="radio"
                    name="single-agent"
                    checked={singleUserId === a.id}
                    onChange={() => setSingleUserId(a.id)}
                    disabled={submitting}
                  />
                  <div class="flex-1">
                    <div class="text-sm">{a.name}</div>
                    <div class="text-xs text-fg-muted">{a.email}</div>
                  </div>
                  <div class="text-xs text-fg-muted">{a.openLeadCount} abertos</div>
                </label>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <div class="text-xs text-fg-muted mb-2">
              Distribuir alternadamente entre os agentes marcados (ordem clicada = ordem do rodízio):
            </div>
            <div class="space-y-1 max-h-72 overflow-y-auto">
              {allAgents.map((a) => {
                const idx = rotateUserIds.indexOf(a.id)
                const selected = idx >= 0
                return (
                  <label key={a.id} class="flex items-center gap-2 p-2 rounded hover:bg-surface-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleRotate(a.id)}
                      disabled={submitting}
                    />
                    <div class="flex-1">
                      <div class="text-sm flex items-center gap-2">
                        {a.name}
                        {selected && (
                          <span class="text-[0.625rem] bg-accent/15 text-accent font-bold px-1.5 py-0.5 rounded">
                            #{idx + 1}
                          </span>
                        )}
                      </div>
                      <div class="text-xs text-fg-muted">{a.email}</div>
                    </div>
                    <div class="text-xs text-fg-muted">{a.openLeadCount} abertos</div>
                  </label>
                )
              })}
            </div>
            {rotateUserIds.length >= 2 && (
              <div class="mt-3 text-xs text-fg-muted bg-surface-2 border border-border rounded p-2">
                <strong>{leadIds.length}</strong> leads → <strong>{rotateUserIds.length}</strong> agentes
                = aprox. <strong>{Math.ceil(leadIds.length / rotateUserIds.length)}</strong> leads por agente
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
