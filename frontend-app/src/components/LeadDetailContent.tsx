import { useState } from 'preact/hooks'
import { ShieldBan } from 'lucide-preact'
import {
  useLead,
  useDeleteLead,
  useQualifyLead,
  useResendLeadReport,
  getRegistrationConflict,
} from '@/hooks/useLeads'
import { useEnrollmentLinkByLead } from '@/hooks/useEnrollmentPortals'
import { Skeleton } from '@/components/ui/Skeleton'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { DuplicateLeadModal } from '@/components/DuplicateLeadModal'
import { MergeLeadsModal } from '@/components/MergeLeadsModal'
import {
  LeadDetailOverviewTab as LeadOverviewTab,
  LeadDetailTrackingTab as LeadTrackingTab,
  LeadDetailIntelTab as LeadIntelTab,
  LeadDetailActivitiesTab as LeadActivitiesTab,
  LeadDetailTimelineTab as LeadTimelineTab,
  LeadDetailFieldsTab as LeadFieldsTab,
  EditLeadModal,
} from '@/routes/pages/LeadsPage'
import { LeadCadencesTab } from '@/components/LeadCadencesTab'
import { LeadAuditTab } from '@/components/LeadAuditTab'
import { LeadJourneyTab } from '@/components/LeadJourneyTab'
import { LeadNegotiationTab } from '@/components/LeadNegotiationTab'
import { LeadStatusHistoryTab } from '@/components/LeadStatusHistoryTab'
import { useModuleAccess } from '@/hooks/usePermissions'
import { useBlockLeadContact } from '@/hooks/useSecurity'
import { toast } from '@/lib/toast'

// `module` opcional: a seção só aparece quando o módulo está ativo (gating no TOC).
export const LEAD_DETAIL_SECTIONS = [
  { id: 'overview',   label: 'Visão geral' },
  { id: 'negociacao', label: 'Negociação', module: 'negotiations' },
  { id: 'activities', label: 'Atividades' },
  { id: 'resumos',    label: 'Resumos', module: 'status_summary' },
  { id: 'cadences',   label: 'Cadências' },
  { id: 'jornada',    label: 'Jornada IA' },
  { id: 'intel',      label: 'Inteligência' },
  { id: 'tracking',   label: 'Tracking' },
  { id: 'audit',      label: 'Auditoria de Conversas' },
  { id: 'timeline',   label: 'Timeline' },
  { id: 'fields',     label: 'Campos Personalizados' },
] as const

export type LeadDetailSectionId = typeof LEAD_DETAIL_SECTIONS[number]['id']

export const DEFAULT_SECTION: LeadDetailSectionId = 'overview'

export function isValidSection(s: string | undefined | null): s is LeadDetailSectionId {
  return !!s && LEAD_DETAIL_SECTIONS.some((sec) => sec.id === s)
}

/**
 * Seções visíveis para este usuário — esconde as que dependem de um módulo
 * desligado. Os hooks são chamados em ordem fixa (regra dos hooks), por isso a
 * lista de módulos é estática: ao criar uma seção com `module`, acrescente o
 * `useModuleAccess` correspondente aqui.
 */
export function useVisibleLeadSections() {
  const negotiations = useModuleAccess('negotiations').status === 'allowed'
  const statusSummary = useModuleAccess('status_summary').status === 'allowed'
  const allowed: Record<string, boolean> = { negotiations, status_summary: statusSummary }
  return LEAD_DETAIL_SECTIONS.filter((s) => {
    const mod = (s as { module?: string }).module
    return !mod || allowed[mod] === true
  })
}

interface Props {
  id: number
  section: LeadDetailSectionId
}

/**
 * Conteúdo da seção atual do lead. URL determina qual seção renderizar
 * (`/leads/:id/:section`). Sem state local → sem bug intermitente.
 */
export function LeadDetailContent({ id, section }: Props) {
  const { data: lead, isLoading } = useLead(id)

  if (isLoading || !lead) {
    return <Skeleton class="h-64 w-full" />
  }

  // Aviso de contato bloqueado. Sem ele o operador vê as ações automáticas do
  // lead (agendamento, portal, chamado, mensagem) simplesmente não acontecerem,
  // sem nenhuma explicação na tela — o motivo só aparecia no log de Segurança.
  const bloqueio = lead.blocked
  const CRITERIO: Record<string, string> = {
    email: 'e-mail', domain: 'domínio do e-mail', whatsapp: 'WhatsApp', ip: 'IP',
  }

  return (
    <div class="space-y-4">
      {bloqueio && (
        <div class="flex items-start gap-3 rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm">
          <ShieldBan size={18} class="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
          <div>
            <strong class="text-danger">Contato bloqueado</strong>
            <span class="text-muted"> — casa com uma regra de {CRITERIO[bloqueio.criterion] ?? bloqueio.criterion}
              {bloqueio.label ? ` ("${bloqueio.label}")` : ''}. Nenhuma entrada automática dele é aceita:
              formulário, agendamento, portal, chamado, mensagem recebida e integrações.
              {bloqueio.reason ? ` Motivo: ${bloqueio.reason}.` : ''}
            </span>
            <div class="mt-1 text-xs text-muted">
              Para liberar, desligue a regra em Configurações › Segurança › Bloqueio de entrada de leads.
            </div>
          </div>
        </div>
      )}
      {section === 'overview'   && <LeadOverviewTab lead={lead} />}
      {section === 'negociacao' && <LeadNegotiationTab leadId={lead.id} />}
      {section === 'tracking'   && <LeadTrackingTab lead={lead} />}
      {section === 'jornada'    && <LeadJourneyTab leadId={lead.id} />}
      {section === 'intel'      && <LeadIntelTab leadId={lead.id} />}
      {section === 'audit'      && <LeadAuditTab leadId={lead.id} />}
      {section === 'activities' && <LeadActivitiesTab leadId={lead.id} />}
      {section === 'resumos'    && <LeadStatusHistoryTab leadId={lead.id} />}
      {section === 'cadences'   && <LeadCadencesTab leadId={lead.id} />}
      {section === 'timeline'   && <LeadTimelineTab leadId={lead.id} />}
      {section === 'fields'     && <LeadFieldsTab leadId={lead.id} customFields={lead.customFields} />}
    </div>
  )
}

/**
 * Hook que centraliza ações + diálogos do lead (Qualificar/Mesclar/Duplicar/Excluir/etc.)
 * Retorna `dialogs` (JSX) e `actions` (handlers) pra o header/menu chamar.
 */
export function useLeadActions(id: number, lead: ReturnType<typeof useLead>['data'], opts: {
  onLeadDeleted?: () => void
  onLeadDuplicated?: (newId: number) => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [forceDeleteReg, setForceDeleteReg] = useState<number | null>(null)
  const [mergeOpen, setMergeOpen] = useState(false)
  const [duplicateOpen, setDuplicateOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)

  const delMut = useDeleteLead()
  const blockContact = useBlockLeadContact()
  const [confirmBlock, setConfirmBlock] = useState(false)
  const qualify = useQualifyLead()
  const resendReport = useResendLeadReport()
  const enrollLink = useEnrollmentLinkByLead()

  const isEnrollmentLead =
    lead?.source === 'enrollment_portal' || lead?.source === 'enrollment_portal_interest'

  function handleQualify() {
    qualify.mutate(id, {
      onSuccess: () => toast('Lead qualificado', 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

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

  function handleResendReport() {
    resendReport.mutate(id, {
      onSuccess: () => toast('Relatório reenviado por e-mail', 'success'),
      onError: (e: unknown) => toast((e as Error).message, 'danger'),
    })
  }

  const dialogs = (
    <>
      {/* Bloquear a entrada deste contato — o caminho natural quando alguém
          se inscreve toda semana e nunca responde. Não apaga o lead nem impede
          cadastro manual: só barra formulário, anúncio, API e webhook. */}
      <ConfirmDialog
        open={confirmBlock}
        onOpenChange={(o) => { if (!o) setConfirmBlock(false) }}
        title="Bloquear a entrada deste contato"
        description={`Novas inscrições de ${[lead?.email, lead?.whatsapp].filter(Boolean).join(' e ') || 'deste contato'} por formulário, landing page, anúncio, API e webhook deixam de criar lead. O lead atual continua aqui, e você ainda pode cadastrá-lo à mão. Gerencie em Configurações › Segurança.`}
        confirmLabel="Bloquear entrada"
        loading={blockContact.isPending}
        onConfirm={() => blockContact.mutate({ leadId: id }, {
          onSuccess: () => { toast('Contato bloqueado na entrada de leads', 'success'); setConfirmBlock(false) },
          onError: (e: unknown) => toast((e as Error).message || 'Não foi possível bloquear', 'danger'),
        })}
      />

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={(o) => { if (!o) { setConfirmDelete(false); setForceDeleteReg(null) } }}
        title={`Excluir lead "${lead?.empresa ?? id}"`}
        description={forceDeleteReg !== null
          ? `⚠️ Este lead tem ${forceDeleteReg} inscrição(ões) no portal de matrículas. Apagá-lo vai desvinculá-las — elas ficam órfãs no módulo de Matrículas (sem lead). Confirme para apagar mesmo assim.`
          : 'O lead vai para a lixeira e pode ser restaurado.'}
        destructive
        confirmLabel={forceDeleteReg !== null ? 'Apagar mesmo assim' : 'Excluir'}
        loading={delMut.isPending}
        onConfirm={() => delMut.mutate({ id, force: forceDeleteReg !== null }, {
          onSuccess: () => {
            toast('Lead movido para a lixeira', 'success')
            setConfirmDelete(false)
            setForceDeleteReg(null)
            opts.onLeadDeleted?.()
          },
          onError: (e: unknown) => {
            const c = getRegistrationConflict(e)
            if (c && forceDeleteReg === null) setForceDeleteReg(c.count)
            else toast((e as Error).message, 'danger')
          },
        })}
      />

      {mergeOpen && lead && (
        <MergeLeadsModal
          masterId={id}
          masterName={lead.empresa ?? lead.nome ?? `Lead #${id}`}
          onClose={() => setMergeOpen(false)}
          onMerged={() => { setMergeOpen(false); opts.onLeadDeleted?.() }}
        />
      )}

      {duplicateOpen && (
        <DuplicateLeadModal
          leadId={id}
          onClose={() => setDuplicateOpen(false)}
          onDuplicated={(newId) => {
            setDuplicateOpen(false)
            opts.onLeadDuplicated?.(newId)
          }}
        />
      )}

      {editOpen && (
        <EditLeadModal id={id} onClose={() => setEditOpen(false)} />
      )}
    </>
  )

  return {
    dialogs,
    isEnrollmentLead,
    isWebChat: lead?.source === 'web_chat',
    isQualified: !!lead?.qualifiedAt,
    isPending: {
      qualify: qualify.isPending,
      delete: delMut.isPending,
      enrollLink: enrollLink.isPending,
      resendReport: resendReport.isPending,
      blockEntry: blockContact.isPending,
    },
    actions: {
      qualify: handleQualify,
      edit: () => setEditOpen(true),
      delete: () => setConfirmDelete(true),
      merge: () => setMergeOpen(true),
      duplicate: () => setDuplicateOpen(true),
      enrollmentLink: handleEnrollmentLink,
      resendReport: handleResendReport,
      blockEntry: () => setConfirmBlock(true),
    },
  }
}
